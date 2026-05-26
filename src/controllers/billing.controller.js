const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');

const _tenantBillingInitLocks = new Map();

const ensureTenantBillingTables = async (client) => {
  // Ensure billing_heads table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS billing_heads (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      default_amount NUMERIC(15,2) DEFAULT 0,
      tax_rate NUMERIC(5,2) DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      head_type TEXT DEFAULT 'CHARGE', -- CHARGE, MAINTENANCE, TAX, FEE
      frequency TEXT DEFAULT 'MONTHLY', -- MONTHLY, QUARTERLY, YEARLY, ONE-TIME
      is_system BOOLEAN DEFAULT FALSE,
      ledger_account_id TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const schema = client.database || 'default'; // we just need a key, but wait, client doesn't expose schema easily here.
  // Actually, we can just use a single promise per tenant?
  // We can't access tenantId from `client` easily. Let's just catch the specific error and ignore it, because it means the table exists!
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bills (
        id TEXT PRIMARY KEY,
        society_id TEXT,
        flat_id TEXT,
        member_id TEXT,
        bill_number TEXT,
        bill_date DATE,
        due_date DATE,
        amount NUMERIC,
        tax_amount NUMERIC,
        total_amount NUMERIC,
        paid_amount NUMERIC DEFAULT 0,
        status TEXT,
        bill_type TEXT,
        billing_period TEXT,
        description TEXT,
        created_by TEXT,
        approved_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS bill_items (
        id TEXT PRIMARY KEY,
        bill_id TEXT,
        head_name TEXT,
        amount NUMERIC,
        tax_rate NUMERIC,
        tax_amount NUMERIC,
        total NUMERIC
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        society_id TEXT,
        bill_id TEXT,
        member_id TEXT,
        amount NUMERIC,
        payment_method TEXT,
        payment_reference TEXT,
        gateway_transaction_id TEXT,
        status TEXT,
        payment_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (err) {
    // If the error is 'type already exists', it means another request just created it.
    if (err.message && err.message.includes('already exists')) {
      console.log('Ignored concurrent table creation error in billing:', err.message);
      return;
    }
    throw err;
  }
};

exports.getAllBills = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTenantBillingTables(client);
        let query = 'SELECT * FROM bills ORDER BY created_at DESC';
        let params = [];
        if (req.user.role === 'RESIDENT') {
          query = 'SELECT * FROM bills WHERE member_id = $1 ORDER BY created_at DESC';
          params = [req.user.id];
        }
        const r = await client.query(query, params);
        return res.json({ bills: r.rows });
      }).catch((err) => { console.error('Billing error:', err); return res.status(500).json({ error: 'Failed to process request' }); });
    }
    const db = getDb();
    let bills;
    if (req.user.role === 'RESIDENT') {
      bills = db.get('bills').filter({ member_id: req.user.id }).sortBy('created_at').reverse().value();
    } else if (req.user.role === 'PLATFORM_ADMIN') {
      bills = db.get('bills').sortBy('created_at').reverse().take(100).value();
    } else {
      bills = db.get('bills').filter({ society_id: req.user.society_id }).sortBy('created_at').reverse().value();
    }
    res.json({ bills });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
};

exports.getBillById = (req, res) => {
  try {
    const db = getDb();
    const bill = db.get('bills').find({ id: req.params.id }).value();
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    const items = db.get('bill_items').filter({ bill_id: bill.id }).value();
    res.json({ bill: { ...bill, items } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bill' });
  }
};

exports.createBill = (req, res) => {
  try {
    const { flat_id, member_id, amount, tax_amount, bill_type, billing_period, description, due_date, items } = req.body;
    const now = new Date().toISOString();
    const total = (parseFloat(amount) || 0) + (parseFloat(tax_amount) || 0);

    const bill = {
      id: uuidv4(), society_id: req.user.society_id, flat_id: flat_id || null,
      member_id: member_id || null, bill_number: `BIL-${Date.now().toString(36).toUpperCase()}`,
      bill_date: now.split('T')[0], due_date: due_date || null,
      amount: parseFloat(amount), tax_amount: parseFloat(tax_amount) || 0,
      total_amount: total, paid_amount: 0, status: 'PENDING_APPROVAL',
      bill_type: bill_type || 'MAINTENANCE', billing_period: billing_period || null,
      description: description || null, created_by: req.user.id, approved_by: null,
      created_at: now, updated_at: now
    };
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTenantBillingTables(client);
        await client.query(
          `INSERT INTO bills (id,society_id,flat_id,member_id,bill_number,bill_date,due_date,amount,tax_amount,total_amount,paid_amount,status,bill_type,billing_period,description,created_by,approved_by,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [bill.id, bill.society_id, bill.flat_id, bill.member_id, bill.bill_number, bill.bill_date, bill.due_date, bill.amount, bill.tax_amount, bill.total_amount, bill.paid_amount, bill.status, bill.bill_type, bill.billing_period, bill.description, bill.created_by, bill.approved_by, bill.created_at, bill.updated_at]
        );
        if (items && items.length > 0) {
          const itemPromises = items.map(item => {
            const itemTax = (item.amount * (item.tax_rate || 0)) / 100;
            return client.query(
              `INSERT INTO bill_items (id,bill_id,head_name,amount,tax_rate,tax_amount,total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [uuidv4(), bill.id, item.head_name, item.amount, item.tax_rate || 0, itemTax, item.amount + itemTax]
            );
          });
          await Promise.all(itemPromises);
        }
        return res.status(201).json({ bill });
      }).catch((error) => {
        console.error('Create bill error:', error);
        return res.status(500).json({ error: 'Failed to create bill' });
      });
    }
    const db = getDb();
    db.get('bills').push(bill).write();

    if (items && items.length > 0) {
      for (const item of items) {
        const itemTax = (item.amount * (item.tax_rate || 0)) / 100;
        db.get('bill_items').push({
          id: uuidv4(), bill_id: bill.id, head_name: item.head_name,
          amount: item.amount, tax_rate: item.tax_rate || 0,
          tax_amount: itemTax, total: item.amount + itemTax
        }).write();
      }
    }

    res.status(201).json({ bill });
  } catch (error) {
    console.error('Create bill error:', error);
    res.status(500).json({ error: 'Failed to create bill' });
  }
};

exports.approveBill = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTenantBillingTables(client);
        await client.query('UPDATE bills SET status = $1, approved_by = $2, updated_at = NOW() WHERE id = $3', ['APPROVED', req.user.id, req.params.id]);
        const r = await client.query('SELECT * FROM bills WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ bill: r.rows[0], message: 'Bill approved' });
      }).catch(() => res.status(500).json({ error: 'Failed to approve bill' }));
    }
    const db = getDb();
    db.get('bills').find({ id: req.params.id }).assign({ status: 'APPROVED', approved_by: req.user.id, updated_at: new Date().toISOString() }).write();
    const bill = db.get('bills').find({ id: req.params.id }).value();
    res.json({ bill, message: 'Bill approved' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve bill' });
  }
};

exports.rejectBill = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTenantBillingTables(client);
        await client.query('UPDATE bills SET status = $1, updated_at = NOW() WHERE id = $2', ['REJECTED', req.params.id]);
        const r = await client.query('SELECT * FROM bills WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ bill: r.rows[0], message: 'Bill rejected' });
      }).catch(() => res.status(500).json({ error: 'Failed to reject bill' }));
    }
    const db = getDb();
    db.get('bills').find({ id: req.params.id }).assign({ status: 'REJECTED', updated_at: new Date().toISOString() }).write();
    const bill = db.get('bills').find({ id: req.params.id }).value();
    res.json({ bill, message: 'Bill rejected' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject bill' });
  }
};

exports.generateMonthlyBills = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTenantBillingTables(client);
        const { amount, billing_period, due_date, bill_type } = req.body;
        const users = await client.query("SELECT id, flat_number FROM platform.users WHERE society_id = $1 AND role = 'RESIDENT' AND is_active = 1", [req.user.society_id]);
        const now = new Date().toISOString();
        const chunkSize = 100;
        for (let i = 0; i < users.rows.length; i += chunkSize) {
          const chunk = users.rows.slice(i, i + chunkSize);
          const values = [];
          const placeholders = [];
          let paramIdx = 1;
          for (const member of chunk) {
            const id = uuidv4();
            const billNum = `BIL-${Date.now().toString(36).toUpperCase()}-${member.flat_number || 'NA'}`;
            placeholders.push(`($${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},0,$${paramIdx-1},0,$${paramIdx++},$${paramIdx++},$${paramIdx++},NULL,$${paramIdx++},NULL,$${paramIdx++},$${paramIdx-1})`);
            values.push(
              id, req.user.society_id, null, member.id, billNum,
              now.split('T')[0], due_date || null, parseFloat(amount),
              'PENDING', bill_type || 'MAINTENANCE', billing_period || null,
              req.user.id, now
            );
          }
          if (placeholders.length > 0) {
            await client.query(
              `INSERT INTO bills (id,society_id,flat_id,member_id,bill_number,bill_date,due_date,amount,tax_amount,total_amount,paid_amount,status,bill_type,billing_period,description,created_by,approved_by,created_at,updated_at)
               VALUES ${placeholders.join(', ')}`,
              values
            );
          }
        }
        return res.status(201).json({ message: `Generated ${users.rows.length} bills`, bills_count: users.rows.length });
      }).catch((error) => {
        console.error('Generate bills error:', error);
        return res.status(500).json({ error: 'Failed to generate bills' });
      });
    }
    const db = getDb();
    const { amount, billing_period, due_date, bill_type } = req.body;
    const members = db.get('users').filter({ society_id: req.user.society_id, role: 'RESIDENT', is_active: 1 }).value();
    const now = new Date().toISOString();
    let count = 0;

    for (const member of members) {
      const bill = {
        id: uuidv4(), society_id: req.user.society_id, flat_id: null,
        member_id: member.id, bill_number: `BIL-${Date.now().toString(36).toUpperCase()}-${member.flat_number || 'NA'}`,
        bill_date: now.split('T')[0], due_date: due_date || null,
        amount: parseFloat(amount), tax_amount: 0, total_amount: parseFloat(amount),
        paid_amount: 0, status: 'PENDING', bill_type: bill_type || 'MAINTENANCE',
        billing_period: billing_period || null, description: null,
        created_by: req.user.id, approved_by: null, created_at: now, updated_at: now
      };
      db.get('bills').push(bill).write();
      count++;
    }

    res.status(201).json({ message: `Generated ${count} bills`, bills_count: count });
  } catch (error) {
    console.error('Generate bills error:', error);
    res.status(500).json({ error: 'Failed to generate bills' });
  }
};

exports.getPayments = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTenantBillingTables(client);
        let query = 'SELECT * FROM payments ORDER BY payment_date DESC';
        let params = [];
        if (req.user.role === 'RESIDENT') {
          query = 'SELECT * FROM payments WHERE member_id = $1 ORDER BY payment_date DESC';
          params = [req.user.id];
        }
        const r = await client.query(query, params);
        return res.json({ payments: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch payments' }));
    }
    const db = getDb();
    let payments;
    if (req.user.role === 'RESIDENT') {
      payments = db.get('payments').filter({ member_id: req.user.id }).sortBy('payment_date').reverse().value();
    } else {
      payments = db.get('payments').filter({ society_id: req.user.society_id }).sortBy('payment_date').reverse().value();
    }
    res.json({ payments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
};

exports.recordPayment = (req, res) => {
  try {
    const { bill_id, amount, payment_method, payment_reference, member_id } = req.body;
    const now = new Date().toISOString();
    
    let targetMemberId = req.user.id;
    if (['ADMIN', 'TREASURER', 'MAKER', 'CHECKER'].includes(req.user.role) && member_id) {
      targetMemberId = member_id;
    }

    const payment = {
      id: uuidv4(), society_id: req.user.society_id, bill_id: bill_id || null,
      member_id: targetMemberId, amount: parseFloat(amount),
      payment_method: payment_method || 'ONLINE', payment_reference: payment_reference || null,
      gateway_transaction_id: null, status: 'SUCCESS', payment_date: now, created_at: now
    };
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTenantBillingTables(client);
        await client.query(
          `INSERT INTO payments (id,society_id,bill_id,member_id,amount,payment_method,payment_reference,gateway_transaction_id,status,payment_date,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [payment.id, payment.society_id, payment.bill_id, payment.member_id, payment.amount, payment.payment_method, payment.payment_reference, payment.gateway_transaction_id, payment.status, payment.payment_date]
        );
        if (bill_id) {
          const r = await client.query('SELECT paid_amount,total_amount FROM bills WHERE id = $1 LIMIT 1', [bill_id]);
          const bill = r.rows[0];
          if (bill) {
            const newPaid = Number(bill.paid_amount || 0) + parseFloat(amount);
            const newStatus = newPaid >= Number(bill.total_amount || 0) ? 'PAID' : 'PARTIALLY_PAID';
            await client.query('UPDATE bills SET paid_amount = $1, status = $2, updated_at = $3 WHERE id = $4', [newPaid, newStatus, now, bill_id]);
          }
        }
        return res.status(201).json({ message: 'Payment recorded successfully', payment_id: payment.id });
      }).catch((error) => {
        console.error('Payment error:', error);
        return res.status(500).json({ error: 'Failed to record payment' });
      });
    }
    const db = getDb();
    db.get('payments').push(payment).write();

    if (bill_id) {
      const bill = db.get('bills').find({ id: bill_id }).value();
      if (bill) {
        const newPaid = (bill.paid_amount || 0) + parseFloat(amount);
        const newStatus = newPaid >= bill.total_amount ? 'PAID' : 'PARTIALLY_PAID';
        db.get('bills').find({ id: bill_id }).assign({ paid_amount: newPaid, status: newStatus, updated_at: now }).write();
      }
    }

    res.status(201).json({ message: 'Payment recorded successfully', payment_id: payment.id });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
};

exports.getBillingSummary = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTenantBillingTables(client);
        const isResident = req.user.role === 'RESIDENT';
        const billsQuery = isResident
          ? "SELECT COALESCE(SUM(total_amount), 0) AS total_billed, COUNT(CASE WHEN status NOT IN ('PAID', 'REJECTED') THEN 1 END) AS pending_bills, COUNT(CASE WHEN status != 'PAID' AND due_date < CURRENT_DATE THEN 1 END) AS overdue_bills FROM bills WHERE member_id = $1"
          : "SELECT COALESCE(SUM(total_amount), 0) AS total_billed, COUNT(CASE WHEN status NOT IN ('PAID', 'REJECTED') THEN 1 END) AS pending_bills, COUNT(CASE WHEN status != 'PAID' AND due_date < CURRENT_DATE THEN 1 END) AS overdue_bills FROM bills";

        const paymentsQuery = isResident
          ? "SELECT COALESCE(SUM(amount), 0) AS total_collected FROM payments WHERE status = 'SUCCESS' AND member_id = $1"
          : "SELECT COALESCE(SUM(amount), 0) AS total_collected FROM payments WHERE status = 'SUCCESS'";

        const [billsR, paymentsR] = await Promise.all([
          client.query(billsQuery, isResident ? [req.user.id] : []),
          client.query(paymentsQuery, isResident ? [req.user.id] : [])
        ]);

        const totalBilled = Number(billsR.rows[0].total_billed);
        const pendingBills = Number(billsR.rows[0].pending_bills);
        const overdueBills = Number(billsR.rows[0].overdue_bills);
        const totalCollected = Number(paymentsR.rows[0].total_collected);

        return res.json({
          summary: {
            total_billed: totalBilled,
            total_collected: totalCollected,
            outstanding: totalBilled - totalCollected,
            pending_bills: pendingBills,
            overdue_bills: overdueBills,
            collection_rate: totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : 0
          }
        });
      }).catch((err) => {
        console.error('Billing summary database error:', err);
        return res.status(500).json({ error: 'Failed to get billing summary' });
      });
    }
    const db = getDb();
    const sid = req.user.society_id;
    const isResident = req.user.role === 'RESIDENT';
    const bills = isResident
      ? db.get('bills').filter({ society_id: sid, member_id: req.user.id }).value()
      : db.get('bills').filter({ society_id: sid }).value();
    const payments = isResident
      ? db.get('payments').filter({ society_id: sid, status: 'SUCCESS', member_id: req.user.id }).value()
      : db.get('payments').filter({ society_id: sid, status: 'SUCCESS' }).value();

    const totalBilled = bills.reduce((sum, b) => sum + (b.total_amount || 0), 0);
    const totalCollected = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const pendingBills = bills.filter(b => !['PAID', 'REJECTED'].includes(b.status)).length;
    const now = new Date().toISOString().split('T')[0];
    const overdueBills = bills.filter(b => b.status !== 'PAID' && b.due_date && b.due_date < now).length;

    res.json({
      summary: {
        total_billed: totalBilled, total_collected: totalCollected,
        outstanding: totalBilled - totalCollected, pending_bills: pendingBills,
        overdue_bills: overdueBills,
        collection_rate: totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get billing summary' });
  }
};

// --- Utility: ensure dunning tables ---
const ensureDunningTables = async (client) => {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS dunning_history (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        bill_id TEXT,
        reminder_date DATE,
        reminder_type TEXT,
        status TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS dunning_config (
        id TEXT PRIMARY KEY,
        grace_days INTEGER DEFAULT 5,
        reminder_sequence JSONB DEFAULT '[3,7,15,30]',
        interest_rate NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (err) {
    if (err.message && err.message.includes('already exists')) return;
    throw err;
  }
};

exports.getArrearsAging = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  return withTenant(req.user.society_id, async (client) => {
    await ensureTenantBillingTables(client);
    const buckets = [
      { label: '0-30 days', days_from: 0, days_to: 30 },
      { label: '31-60 days', days_from: 31, days_to: 60 },
      { label: '61-90 days', days_from: 61, days_to: 90 },
      { label: '91-180 days', days_from: 91, days_to: 180 },
      { label: '180+ days', days_from: 181, days_to: 99999 },
    ];
    const result = [];
    for (const b of buckets) {
      const r = await client.query(`
        SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) AS total_amount,
               COUNT(*) AS bill_count,
               MIN(bill_date) AS oldest_date
        FROM bills
        WHERE status NOT IN ('PAID', 'REJECTED')
          AND due_date < CURRENT_DATE
          AND (total_amount - COALESCE(paid_amount, 0)) > 0
          AND CURRENT_DATE - due_date BETWEEN $1 AND $2
      `, [b.days_from, b.days_to]);
      result.push({
        label: b.label,
        days_from: b.days_from,
        days_to: b.days_to === 99999 ? null : b.days_to,
        total_amount: Number(r.rows[0].total_amount),
        bill_count: Number(r.rows[0].bill_count),
        oldest_date: r.rows[0].oldest_date || null,
      });
    }
    return res.json({ buckets: result, generated_at: new Date().toISOString() });
  }).catch((err) => { console.error('getArrearsAging error:', err); res.status(500).json({ error: 'Failed to get arrears aging' }); });
};

exports.getDefaultersList = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  return withTenant(req.user.society_id, async (client) => {
    await ensureTenantBillingTables(client);
    const r = await client.query(`
      SELECT
        b.member_id,
        COALESCE(u.name, 'Unknown') AS member_name,
        COALESCE(u.flat_number, 'N/A') AS flat_number,
        COALESCE(u.wing, 'N/A') AS wing,
        SUM(b.total_amount - COALESCE(b.paid_amount, 0)) AS total_outstanding,
        MIN(b.bill_date) AS oldest_bill_date,
        MAX(CURRENT_DATE - b.due_date) AS days_overdue,
        COUNT(b.id) AS bill_count
      FROM bills b
      LEFT JOIN platform.users u ON b.member_id = u.id
      WHERE b.society_id = $1
        AND b.status NOT IN ('PAID', 'REJECTED')
        AND (b.total_amount - COALESCE(b.paid_amount, 0)) > 0
      GROUP BY b.member_id, u.name, u.flat_number, u.wing
      ORDER BY total_outstanding DESC
    `, [req.user.society_id]);
    return res.json({
      defaulters: r.rows.map(row => ({
        member_id: row.member_id,
        member_name: row.member_name,
        flat_number: row.flat_number,
        wing: row.wing,
        total_outstanding: Number(row.total_outstanding),
        oldest_bill_date: row.oldest_bill_date,
        days_overdue: Number(row.days_overdue),
        bill_count: Number(row.bill_count),
      }))
    });
  }).catch((err) => { console.error('getDefaultersList error:', err); res.status(500).json({ error: 'Failed to get defaulters list' }); });
};

exports.getDunningHistory = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  return withTenant(req.user.society_id, async (client) => {
    await ensureDunningTables(client);
    const r = await client.query(`
      SELECT
        dh.id, dh.member_id, dh.bill_id, dh.reminder_date,
        dh.reminder_type, dh.status, dh.created_at,
        COALESCE(u.name, 'Unknown') AS member_name,
        b.bill_number, b.total_amount, b.due_date
      FROM dunning_history dh
      LEFT JOIN platform.users u ON dh.member_id = u.id
      LEFT JOIN bills b ON dh.bill_id = b.id
      ORDER BY dh.created_at DESC
      LIMIT 500
    `);
    return res.json({ records: r.rows });
  }).catch((err) => { console.error('getDunningHistory error:', err); res.status(500).json({ error: 'Failed to get dunning history' }); });
};

exports.getDunningConfig = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  return withTenant(req.user.society_id, async (client) => {
    await ensureDunningTables(client);
    const r = await client.query('SELECT * FROM dunning_config LIMIT 1');
    if (r.rows.length > 0) {
      return res.json({ config: r.rows[0] });
    }
    // Create default config
    const defaultConfig = {
      id: uuidv4(),
      grace_days: 5,
      reminder_sequence: [3, 7, 15, 30],
      interest_rate: 0,
    };
    await client.query(
      'INSERT INTO dunning_config (id, grace_days, reminder_sequence, interest_rate) VALUES ($1, $2, $3, $4)',
      [defaultConfig.id, defaultConfig.grace_days, JSON.stringify(defaultConfig.reminder_sequence), defaultConfig.interest_rate]
    );
    return res.json({ config: { ...defaultConfig, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
  }).catch((err) => { console.error('getDunningConfig error:', err); res.status(500).json({ error: 'Failed to get dunning config' }); });
};

exports.sendReminder = (req, res) => {
  if (!isPostgresEnabled || !req.user.society_id) {
    return res.status(400).json({ error: 'PostgreSQL not enabled or society not identified' });
  }
  return withTenant(req.user.society_id, async (client) => {
    await ensureDunningTables(client);
    const { bill_id, type } = req.body;
    const reminderDate = new Date().toISOString().split('T')[0];
    const validTypes = ['EMAIL', 'SMS', 'APP'];
    const reminderType = validTypes.includes(type) ? type : 'APP';

    // Get member_id from bill if not provided via bill lookup
    let memberId = req.user.id;
    if (bill_id) {
      const billR = await client.query('SELECT member_id FROM bills WHERE id = $1 LIMIT 1', [bill_id]);
      if (billR.rows.length > 0) memberId = billR.rows[0].member_id;
    }

    const record = {
      id: uuidv4(),
      member_id: memberId,
      bill_id: bill_id || null,
      reminder_date: reminderDate,
      reminder_type: reminderType,
      status: 'SENT',
    };

    await client.query(
      'INSERT INTO dunning_history (id, member_id, bill_id, reminder_date, reminder_type, status) VALUES ($1, $2, $3, $4, $5, $6)',
      [record.id, record.member_id, record.bill_id, record.reminder_date, record.reminder_type, record.status]
    );
    return res.status(201).json({ message: 'Reminder sent successfully', record });
  }).catch((err) => { console.error('sendReminder error:', err); res.status(500).json({ error: 'Failed to send reminder' }); });
};

// ============== BILLING HEADS CRUD ==============

exports.getAllBillingHeads = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const { rows } = await client.query(
          'SELECT * FROM billing_heads WHERE society_id = $1 AND is_active = TRUE ORDER BY created_at DESC',
          [req.user.society_id]
        );
        return res.json({ heads: rows });
      }).catch((err) => { console.error('getAllBillingHeads error:', err); return res.status(500).json({ error: 'Failed to fetch billing heads' }); });
    }
    const db = getDb();
    const heads = db.get('billing_heads')?.filter({ society_id: req.user.society_id, is_active: true }).value() || [];
    res.json({ heads });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch billing heads' });
  }
};

exports.getBillingHeadById = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const { rows } = await client.query('SELECT * FROM billing_heads WHERE id = $1 AND society_id = $2', [req.params.id, req.user.society_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Billing head not found' });
        return res.json({ head: rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch billing head' }));
    }
    const db = getDb();
    const head = db.get('billing_heads')?.find({ id: req.params.id }).value();
    if (!head) return res.status(404).json({ error: 'Billing head not found' });
    res.json({ head });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch billing head' });
  }
};

exports.createBillingHead = (req, res) => {
  try {
    const { name, description, default_amount, tax_rate, head_type, frequency, ledger_account_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const head = {
      id: uuidv4(),
      society_id: req.user.society_id,
      name,
      description: description || null,
      default_amount: parseFloat(default_amount) || 0,
      tax_rate: parseFloat(tax_rate) || 0,
      is_active: true,
      head_type: head_type || 'CHARGE',
      frequency: frequency || 'MONTHLY',
      is_system: false,
      ledger_account_id: ledger_account_id || null,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await client.query(
          `INSERT INTO billing_heads (id, society_id, name, description, default_amount, tax_rate, is_active, head_type, frequency, is_system, ledger_account_id, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [head.id, head.society_id, head.name, head.description, head.default_amount, head.tax_rate, head.is_active, head.head_type, head.frequency, head.is_system, head.ledger_account_id, head.created_by, head.created_at, head.updated_at]
        );
        return res.status(201).json({ head });
      }).catch((err) => { console.error('createBillingHead error:', err); return res.status(500).json({ error: 'Failed to create billing head' }); });
    }
    const db = getDb();
    if (!db.get('billing_heads')) db.set('billing_heads', []).write();
    db.get('billing_heads').push(head).write();
    res.status(201).json({ head });
  } catch (error) {
    console.error('createBillingHead error:', error);
    res.status(500).json({ error: 'Failed to create billing head' });
  }
};

exports.updateBillingHead = (req, res) => {
  try {
    const { name, description, default_amount, tax_rate, head_type, frequency, is_active, ledger_account_id } = req.body;

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const { rows } = await client.query('SELECT * FROM billing_heads WHERE id = $1 AND society_id = $2', [req.params.id, req.user.society_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Billing head not found' });
        if (rows[0].is_system) return res.status(403).json({ error: 'Cannot modify system billing head' });

        await client.query(
          `UPDATE billing_heads SET name = $1, description = $2, default_amount = $3, tax_rate = $4, head_type = $5, frequency = $6, is_active = $7, ledger_account_id = $8, updated_at = NOW()
           WHERE id = $9`,
          [name, description || null, parseFloat(default_amount) || 0, parseFloat(tax_rate) || 0, head_type, frequency, is_active !== undefined ? is_active : true, ledger_account_id, req.params.id]
        );
        const { rows: updated } = await client.query('SELECT * FROM billing_heads WHERE id = $1', [req.params.id]);
        return res.json({ head: updated[0] });
      }).catch((err) => { console.error('updateBillingHead error:', err); return res.status(500).json({ error: 'Failed to update billing head' }); });
    }
    const db = getDb();
    const head = db.get('billing_heads')?.find({ id: req.params.id }).value();
    if (!head) return res.status(404).json({ error: 'Billing head not found' });
    if (head.is_system) return res.status(403).json({ error: 'Cannot modify system billing head' });

    db.get('billing_heads').find({ id: req.params.id }).assign({
      name, description, default_amount: parseFloat(default_amount) || 0, tax_rate: parseFloat(tax_rate) || 0,
      head_type, frequency, is_active: is_active !== undefined ? is_active : true, ledger_account_id, updated_at: new Date().toISOString()
    }).write();
    res.json({ head: db.get('billing_heads').find({ id: req.params.id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update billing head' });
  }
};

exports.deleteBillingHead = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const { rows } = await client.query('SELECT * FROM billing_heads WHERE id = $1 AND society_id = $2', [req.params.id, req.user.society_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Billing head not found' });
        if (rows[0].is_system) return res.status(403).json({ error: 'Cannot delete system billing head' });

        await client.query('UPDATE billing_heads SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [req.params.id]);
        return res.json({ message: 'Billing head deactivated' });
      }).catch((err) => { console.error('deleteBillingHead error:', err); return res.status(500).json({ error: 'Failed to delete billing head' }); });
    }
    const db = getDb();
    const head = db.get('billing_heads')?.find({ id: req.params.id }).value();
    if (!head) return res.status(404).json({ error: 'Billing head not found' });
    if (head.is_system) return res.status(403).json({ error: 'Cannot delete system billing head' });

    db.get('billing_heads').find({ id: req.params.id }).assign({ is_active: false, updated_at: new Date().toISOString() }).write();
    res.json({ message: 'Billing head deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete billing head' });
  }
};

// ============== DUPLICATE BILL PREVENTION ==============

exports.checkDuplicateBill = (req, res) => {
  try {
    const { member_id, billing_period, bill_type } = req.body;
    if (!member_id || !billing_period) {
      return res.status(400).json({ error: 'member_id and billing_period are required' });
    }

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const { rows } = await client.query(
          `SELECT id, bill_number, total_amount, status FROM bills
           WHERE member_id = $1 AND billing_period = $2 AND bill_type = $3 AND status NOT IN ('REJECTED')
           LIMIT 1`,
          [member_id, billing_period, bill_type || 'MAINTENANCE']
        );
        if (rows.length > 0) {
          return res.json({ is_duplicate: true, existing_bill: rows[0] });
        }
        return res.json({ is_duplicate: false });
      }).catch((err) => { console.error('checkDuplicateBill error:', err); return res.status(500).json({ error: 'Failed to check duplicate' }); });
    }
    const db = getDb();
    const existing = db.get('bills')?.find({ member_id, billing_period, bill_type: bill_type || 'MAINTENANCE' }).value();
    if (existing && existing.status !== 'REJECTED') {
      return res.json({ is_duplicate: true, existing_bill: existing });
    }
    res.json({ is_duplicate: false });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check duplicate' });
  }
};

// ============== BULK BILL GENERATION WITH HEADS ==============

exports.generateBulkBillsWithHeads = (req, res) => {
  try {
    const { head_ids, billing_period, due_date, include_arrears, arrears_head_id } = req.body;

    if (!head_ids || !Array.isArray(head_ids) || head_ids.length === 0) {
      return res.status(400).json({ error: 'head_ids array is required' });
    }
    if (!billing_period) {
      return res.status(400).json({ error: 'billing_period is required' });
    }

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        // Get all active billing heads
        const { rows: heads } = await client.query(
          'SELECT * FROM billing_heads WHERE id = ANY($1) AND is_active = TRUE',
          [head_ids]
        );

        if (heads.length === 0) {
          return res.status(400).json({ error: 'No valid billing heads found' });
        }

        // Get all resident members
        const { rows: members } = await client.query(
          "SELECT id, name, flat_number, wing FROM platform.users WHERE society_id = $1 AND role = 'RESIDENT' AND is_active = 1",
          [req.user.society_id]
        );

        const now = new Date().toISOString();
        const generatedBills = [];
        const skippedBills = [];
        const chunkSize = 100;

        for (let i = 0; i < members.length; i += chunkSize) {
          const chunk = members.slice(i, i + chunkSize);
          const values = [];
          const placeholders = [];
          let paramIdx = 1;

          for (const member of chunk) {
            // Check for duplicate bill
            const { rows: existing } = await client.query(
              `SELECT id FROM bills WHERE member_id = $1 AND billing_period = $2 AND status NOT IN ('REJECTED') LIMIT 1`,
              [member.id, billing_period]
            );

            if (existing.length > 0) {
              skippedBills.push({ member_id: member.id, reason: 'duplicate_bill' });
              continue;
            }

            // Calculate total amount from billing heads
            let totalAmount = 0;
            let totalTax = 0;

            for (const head of heads) {
              const headAmount = parseFloat(head.default_amount) || 0;
              const headTax = (headAmount * parseFloat(head.tax_rate || 0)) / 100;
              totalAmount += headAmount;
              totalTax += headTax;
            }

            // Add arrears if requested
            let arrearsAmount = 0;
            if (include_arrears) {
              const { rows: arrearsRows } = await client.query(
                `SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) AS total_arrears
                 FROM bills WHERE member_id = $1 AND status NOT IN ('PAID', 'REJECTED') AND due_date < CURRENT_DATE`,
                [member.id]
              );
              arrearsAmount = parseFloat(arrearsRows[0].total_arrears) || 0;
              if (arrearsAmount > 0) {
                totalAmount += arrearsAmount;
              }
            }

            const billId = uuidv4();
            const billNum = `BIL-${Date.now().toString(36).toUpperCase()}-${member.flat_number || 'NA'}`;
            const grandTotal = totalAmount + totalTax;

            placeholders.push(`($${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++})`);
            values.push(
              billId, req.user.society_id, null, member.id, billNum,
              now.split('T')[0], due_date || null, totalAmount, totalTax, grandTotal,
              0, 'PENDING', heads[0].head_type || 'MAINTENANCE', billing_period,
              include_arrears && arrearsAmount > 0 ? `Includes arrears: ₹${arrearsAmount.toFixed(2)}` : null,
              req.user.id, null, now, now
            );

            generatedBills.push({
              bill_id: billId, bill_number: billNum, member_id: member.id,
              member_name: member.name, flat_number: member.flat_number,
              amount: totalAmount, tax_amount: totalTax, total_amount: grandTotal,
              billing_period, heads_count: heads.length
            });

            // Insert bill items
            for (const head of heads) {
              const headAmount = parseFloat(head.default_amount) || 0;
              const headTax = (headAmount * parseFloat(head.tax_rate || 0)) / 100;
              const itemId = uuidv4();
              await client.query(
                `INSERT INTO bill_items (id, bill_id, head_name, amount, tax_rate, tax_amount, total) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [itemId, billId, head.name, headAmount, head.tax_rate || 0, headTax, headAmount + headTax]
              );
            }

            // Add arrears as separate item if applicable
            if (include_arrears && arrearsAmount > 0) {
              const arrearsHeadName = 'Arrears (Carried Forward)';
              await client.query(
                `INSERT INTO bill_items (id, bill_id, head_name, amount, tax_rate, tax_amount, total) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [uuidv4(), billId, arrearsHeadName, arrearsAmount, 0, 0, arrearsAmount]
              );
            }
          }

          if (placeholders.length > 0) {
            await client.query(
              `INSERT INTO bills (id,society_id,flat_id,member_id,bill_number,bill_date,due_date,amount,tax_amount,total_amount,paid_amount,status,bill_type,billing_period,description,created_by,approved_by,created_at,updated_at)
               VALUES ${placeholders.join(', ')}`,
              values
            );
          }
        }

        return res.status(201).json({
          message: `Generated ${generatedBills.length} bills`,
          bills_count: generatedBills.length,
          skipped_count: skippedBills.length,
          bills: generatedBills
        });
      }).catch((error) => {
        console.error('generateBulkBillsWithHeads error:', error);
        return res.status(500).json({ error: 'Failed to generate bills' });
      });
    }

    // LowDB fallback
    const db = getDb();
    res.status(501).json({ error: 'Bulk generation with heads not implemented for LowDB mode' });
  } catch (error) {
    console.error('generateBulkBillsWithHeads error:', error);
    res.status(500).json({ error: 'Failed to generate bills' });
  }
};

// ============== INDIVIDUAL BILL GENERATION WITH HEADS ==============

exports.createBillWithHeads = (req, res) => {
  try {
    const { member_id, head_ids, billing_period, due_date, custom_items } = req.body;

    if (!member_id) {
      return res.status(400).json({ error: 'member_id is required' });
    }
    if (!billing_period) {
      return res.status(400).json({ error: 'billing_period is required' });
    }

    // Check for duplicate bill
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        // Check duplicate
        const { rows: existing } = await client.query(
          `SELECT id, bill_number FROM bills WHERE member_id = $1 AND billing_period = $2 AND status NOT IN ('REJECTED') LIMIT 1`,
          [member_id, billing_period]
        );

        if (existing.length > 0) {
          return res.status(409).json({
            error: 'Duplicate bill exists for this member and billing period',
            existing_bill: existing[0]
          });
        }

        // Get member details
        const { rows: members } = await client.query(
          "SELECT id, name, flat_number, wing FROM platform.users WHERE id = $1",
          [member_id]
        );
        if (members.length === 0) {
          return res.status(404).json({ error: 'Member not found' });
        }
        const member = members[0];

        // Calculate amounts from billing heads
        let totalAmount = 0;
        let totalTax = 0;
        const billItems = [];

        if (head_ids && Array.isArray(head_ids) && head_ids.length > 0) {
          const { rows: heads } = await client.query(
            'SELECT * FROM billing_heads WHERE id = ANY($1) AND is_active = TRUE',
            [head_ids]
          );

          for (const head of heads) {
            const headAmount = parseFloat(head.default_amount) || 0;
            const headTax = (headAmount * parseFloat(head.tax_rate || 0)) / 100;
            totalAmount += headAmount;
            totalTax += headTax;
            billItems.push({
              head_name: head.name,
              amount: headAmount,
              tax_rate: head.tax_rate || 0,
              tax_amount: headTax,
              total: headAmount + headTax
            });
          }
        }

        // Add custom items
        if (custom_items && Array.isArray(custom_items)) {
          for (const item of custom_items) {
            const itemAmount = parseFloat(item.amount) || 0;
            const itemTax = (itemAmount * parseFloat(item.tax_rate || 0)) / 100;
            totalAmount += itemAmount;
            totalTax += itemTax;
            billItems.push({
              head_name: item.name,
              amount: itemAmount,
              tax_rate: item.tax_rate || 0,
              tax_amount: itemTax,
              total: itemAmount + itemTax
            });
          }
        }

        // Check for arrears and add if present
        let arrearsAmount = 0;
        const { rows: arrearsRows } = await client.query(
          `SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) AS total_arrears
           FROM bills WHERE member_id = $1 AND status NOT IN ('PAID', 'REJECTED') AND due_date < CURRENT_DATE`,
          [member_id]
        );
        arrearsAmount = parseFloat(arrearsRows[0].total_arrears) || 0;
        if (arrearsAmount > 0) {
          totalAmount += arrearsAmount;
          billItems.push({
            head_name: 'Arrears (Carried Forward)',
            amount: arrearsAmount,
            tax_rate: 0,
            tax_amount: 0,
            total: arrearsAmount
          });
        }

        const now = new Date().toISOString();
        const billId = uuidv4();
        const billNumber = `BIL-${Date.now().toString(36).toUpperCase()}-${member.flat_number || 'NA'}`;
        const grandTotal = totalAmount + totalTax;

        // Insert bill
        await client.query(
          `INSERT INTO bills (id, society_id, flat_id, member_id, bill_number, bill_date, due_date, amount, tax_amount, total_amount, paid_amount, status, bill_type, billing_period, description, created_by, approved_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [billId, req.user.society_id, null, member.id, billNumber, now.split('T')[0], due_date || null, totalAmount, totalTax, grandTotal, 0, 'PENDING', 'MAINTENANCE', billing_period, arrearsAmount > 0 ? `Includes arrears: ₹${arrearsAmount.toFixed(2)}` : null, req.user.id, null, now, now]
        );

        // Insert bill items
        for (const item of billItems) {
          await client.query(
            `INSERT INTO bill_items (id, bill_id, head_name, amount, tax_rate, tax_amount, total) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [uuidv4(), billId, item.head_name, item.amount, item.tax_rate, item.tax_amount, item.total]
          );
        }

        return res.status(201).json({
          bill: {
            id: billId, bill_number: billNumber, member_id: member.id, member_name: member.name,
            flat_number: member.flat_number, billing_period, amount: totalAmount, tax_amount: totalTax,
            total_amount: grandTotal, status: 'PENDING', items: billItems, arrears_included: arrearsAmount
          }
        });
      }).catch((error) => {
        console.error('createBillWithHeads error:', error);
        return res.status(500).json({ error: 'Failed to create bill' });
      });
    }

    const db = getDb();
    res.status(501).json({ error: 'Bill generation with heads not implemented for LowDB mode' });
  } catch (error) {
    console.error('createBillWithHeads error:', error);
    res.status(500).json({ error: 'Failed to create bill' });
  }
};

// ============== ARREARS CARRY-FORWARD FROM LEDGER ==============

exports.getMemberArrears = (req, res) => {
  try {
    const { member_id } = req.params;

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        // Get unpaid bills with outstanding amounts
        const { rows: bills } = await client.query(
          `SELECT b.id, b.bill_number, b.bill_date, b.due_date, b.total_amount, b.paid_amount, b.status,
                  b.total_amount - COALESCE(b.paid_amount, 0) as outstanding
           FROM bills b
           WHERE b.member_id = $1 AND b.status NOT IN ('PAID', 'REJECTED')
           ORDER BY b.due_date ASC`,
          [member_id]
        );

        const totalArrears = bills.reduce((sum, b) => sum + parseFloat(b.outstanding || 0), 0);
        const oldestArrearsDate = bills.length > 0 ? bills[0].due_date : null;
        const daysOverdue = oldestArrearsDate
          ? Math.floor((new Date() - new Date(oldestArrearsDate)) / (1000 * 60 * 60 * 24))
          : 0;

        return res.json({
          member_id,
          total_arrears: totalArrears,
          bills_count: bills.length,
          oldest_arrears_date: oldestArrearsDate,
          days_overdue: daysOverdue,
          bills: bills.map(b => ({
            id: b.id, bill_number: b.bill_number, bill_date: b.bill_date,
            due_date: b.due_date, total_amount: parseFloat(b.total_amount),
            paid_amount: parseFloat(b.paid_amount || 0), outstanding: parseFloat(b.outstanding),
            status: b.status
          }))
        });
      }).catch((err) => { console.error('getMemberArrears error:', err); return res.status(500).json({ error: 'Failed to get arrears' }); });
    }

    const db = getDb();
    const bills = db.get('bills')?.filter({ member_id, status: { $nin: ['PAID', 'REJECTED'] } }).value() || [];
    const totalArrears = bills.reduce((sum, b) => sum + ((b.total_amount || 0) - (b.paid_amount || 0)), 0);
    res.json({ member_id, total_arrears: totalArrears, bills_count: bills.length, bills });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get arrears' });
  }
};

exports.getArrearsSummaryFromLedger = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        // Get total outstanding from bills (accounts receivable)
        const { rows: summary } = await client.query(`
          SELECT
            COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as total_outstanding,
            COUNT(CASE WHEN status NOT IN ('PAID', 'REJECTED') THEN 1 END) as total_bills,
            COUNT(CASE WHEN due_date < CURRENT_DATE AND status NOT IN ('PAID', 'REJECTED') THEN 1 END) as overdue_bills,
            COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE AND status NOT IN ('PAID', 'REJECTED') THEN total_amount - COALESCE(paid_amount, 0) ELSE 0 END), 0) as overdue_amount
          FROM bills
          WHERE society_id = $1
        `, [req.user.society_id]);

        // Get aging buckets
        const buckets = [
          { label: '0-30 days', days_from: 0, days_to: 30 },
          { label: '31-60 days', days_from: 31, days_to: 60 },
          { label: '61-90 days', days_from: 61, days_to: 90 },
          { label: '91+ days', days_from: 91, days_to: 9999 },
        ];

        const agingData = [];
        for (const b of buckets) {
          const r = await client.query(`
            SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as amount, COUNT(*) as count
            FROM bills
            WHERE society_id = $1 AND status NOT IN ('PAID', 'REJECTED')
              AND due_date < CURRENT_DATE
              AND (CURRENT_DATE - due_date) BETWEEN $2 AND $3
          `, [req.user.society_id, b.days_from, b.days_to]);
          agingData.push({
            label: b.label,
            amount: parseFloat(r.rows[0].amount),
            count: parseInt(r.rows[0].count)
          });
        }

        return res.json({
          total_outstanding: parseFloat(summary.rows[0].total_outstanding),
          total_bills: parseInt(summary.rows[0].total_bills),
          overdue_bills: parseInt(summary.rows[0].overdue_bills),
          overdue_amount: parseFloat(summary.rows[0].overdue_amount),
          aging: agingData
        });
      }).catch((err) => { console.error('getArrearsSummaryFromLedger error:', err); return res.status(500).json({ error: 'Failed to get arrears summary' }); });
    }

    const db = getDb();
    const bills = db.get('bills')?.filter({ society_id: req.user.society_id, status: { $nin: ['PAID', 'REJECTED'] } }).value() || [];
    const totalOutstanding = bills.reduce((sum, b) => sum + ((b.total_amount || 0) - (b.paid_amount || 0)), 0);
    res.json({ total_outstanding: totalOutstanding, total_bills: bills.length, aging: [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get arrears summary' });
  }
};

// ============== BILL PDF GENERATION ==============

exports.generateBillPDF = (req, res) => {
  try {
    const billId = req.params.id;

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        // Get bill with member details
        const { rows: billRows } = await client.query(`
          SELECT b.*, u.name as member_name, u.flat_number, u.wing, u.email as member_email, u.phone as member_phone
          FROM bills b
          LEFT JOIN platform.users u ON b.member_id = u.id
          WHERE b.id = $1 AND b.society_id = $2
        `, [billId, req.user.society_id]);

        if (billRows.length === 0) {
          return res.status(404).json({ error: 'Bill not found' });
        }

        const bill = billRows[0];

        // Get bill items
        const { rows: items } = await client.query(
          'SELECT * FROM bill_items WHERE bill_id = $1',
          [billId]
        );

        // Get society details
        const { rows: societyRows } = await client.query(
          'SELECT name, address FROM platform.societies WHERE id = $1',
          [req.user.society_id]
        );
        const society = societyRows[0] || { name: 'Society', address: '' };

        // Generate PDF
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="Bill-${bill.bill_number}.pdf"`);
          res.send(pdfBuffer);
        });

        // PDF Content
        doc.fontSize(20).font('Helvetica-Bold').text(society.name || 'AapkiSociety', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica').text(society.address || 'Society Address', { align: 'center' });
        doc.moveDown();

        // Bill Header
        doc.fontSize(16).font('Helvetica-Bold').text('TAX INVOICE / BILL', { align: 'center' });
        doc.moveDown();

        // Bill Details Table
        doc.fontSize(10).font('Helvetica');
        const leftCol = 50;
        const rightCol = 350;

        doc.text(`Bill Number: ${bill.bill_number}`, leftCol);
        doc.text(`Date: ${bill.bill_date}`, rightCol);
        doc.moveDown(0.5);
        doc.text(`Billing Period: ${bill.billing_period || 'N/A'}`, leftCol);
        doc.text(`Due Date: ${bill.due_date || 'N/A'}`, rightCol);
        doc.moveDown(0.5);
        doc.text(`Status: ${bill.status}`, leftCol);
        doc.moveDown();

        // Member Details
        doc.fontSize(12).font('Helvetica-Bold').text('Bill To:');
        doc.fontSize(10).font('Helvetica');
        doc.text(`Name: ${bill.member_name || 'N/A'}`);
        doc.text(`Flat: ${bill.wing ? bill.wing + ' - ' : ''}${bill.flat_number || 'N/A'}`);
        if (bill.member_email) doc.text(`Email: ${bill.member_email}`);
        if (bill.member_phone) doc.text(`Phone: ${bill.member_phone}`);
        doc.moveDown();

        // Items Table Header
        const tableTop = doc.y;
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Description', 50, tableTop, { width: 200 });
        doc.text('Amount', 280, tableTop, { width: 80, align: 'right' });
        doc.text('Tax', 360, tableTop, { width: 60, align: 'right' });
        doc.text('Total', 420, tableTop, { width: 80, align: 'right' });

        doc.moveTo(50, tableTop + 15).lineTo(500, tableTop + 15).stroke();
        doc.moveDown();

        // Items
        let y = tableTop + 20;
        doc.font('Helvetica');
        for (const item of items) {
          doc.text(item.head_name || 'Item', 50, y, { width: 200 });
          doc.text(parseFloat(item.amount).toFixed(2), 280, y, { width: 80, align: 'right' });
          doc.text(parseFloat(item.tax_amount).toFixed(2), 360, y, { width: 60, align: 'right' });
          doc.text(parseFloat(item.total).toFixed(2), 420, y, { width: 80, align: 'right' });
          y += 15;
        }

        doc.moveTo(50, y).lineTo(500, y).stroke();
        y += 10;

        // Totals
        doc.font('Helvetica-Bold');
        doc.text('Subtotal:', 350, y, { width: 70, align: 'right' });
        doc.text(parseFloat(bill.amount || 0).toFixed(2), 420, y, { width: 80, align: 'right' });
        y += 15;

        doc.text('Tax:', 350, y, { width: 70, align: 'right' });
        doc.text(parseFloat(bill.tax_amount || 0).toFixed(2), 420, y, { width: 80, align: 'right' });
        y += 15;

        doc.fontSize(12).text('TOTAL:', 350, y, { width: 70, align: 'right' });
        doc.text(parseFloat(bill.total_amount || 0).toFixed(2), 420, y, { width: 80, align: 'right' });
        y += 20;

        // Payment Info
        doc.fontSize(10).font('Helvetica');
        doc.text(`Paid Amount: ₹${parseFloat(bill.paid_amount || 0).toFixed(2)}`, 50, y);
        doc.moveDown();
        doc.text(`Outstanding: ₹${(parseFloat(bill.total_amount) - parseFloat(bill.paid_amount || 0)).toFixed(2)}`, 50, doc.y);

        // Footer
        doc.fontSize(8).text('Thank you for your payment!', 50, 750, { align: 'center' });

        doc.end();
      }).catch((err) => { console.error('generateBillPDF error:', err); return res.status(500).json({ error: 'Failed to generate PDF' }); });
    }

    res.status(501).json({ error: 'PDF generation not implemented for LowDB mode' });
  } catch (error) {
    console.error('generateBillPDF error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

// ============== EXCEL EXPORT FOR REPORTS ==============

exports.exportBillsExcel = (req, res) => {
  try {
    const { from_date, to_date, status, member_id } = req.query;

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        let query = `
          SELECT b.bill_number, b.bill_date, b.due_date, b.billing_period, b.bill_type,
                 b.total_amount, b.paid_amount, b.total_amount - COALESCE(b.paid_amount, 0) as outstanding,
                 b.status, u.name as member_name, u.flat_number, u.wing
          FROM bills b
          LEFT JOIN platform.users u ON b.member_id = u.id
          WHERE b.society_id = $1
        `;
        const params = [req.user.society_id];
        let idx = 2;

        if (from_date) { query += ` AND b.bill_date >= $${idx++}`; params.push(from_date); }
        if (to_date) { query += ` AND b.bill_date <= $${idx++}`; params.push(to_date); }
        if (status) { query += ` AND b.status = $${idx++}`; params.push(status); }
        if (member_id) { query += ` AND b.member_id = $${idx++}`; params.push(member_id); }

        query += ' ORDER BY b.bill_date DESC';

        const { rows } = await client.query(query, params);

        // Create Excel data
        const data = rows.map(b => ({
          'Bill Number': b.bill_number,
          'Bill Date': b.bill_date,
          'Due Date': b.due_date,
          'Billing Period': b.billing_period,
          'Type': b.bill_type,
          'Member Name': b.member_name || '',
          'Flat': b.flat_number || '',
          'Wing': b.wing || '',
          'Total Amount': parseFloat(b.total_amount || 0),
          'Paid Amount': parseFloat(b.paid_amount || 0),
          'Outstanding': parseFloat(b.outstanding || 0),
          'Status': b.status
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Bills');

        // Add summary sheet
        const summaryData = [{
          'Total Bills': data.length,
          'Total Amount': data.reduce((s, d) => s + d['Total Amount'], 0),
          'Total Collected': data.reduce((s, d) => s + d['Paid Amount'], 0),
          'Total Outstanding': data.reduce((s, d) => s + d['Outstanding'], 0)
        }];
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="billing-report.xlsx"');
        res.send(buffer);
      }).catch((err) => { console.error('exportBillsExcel error:', err); return res.status(500).json({ error: 'Failed to export Excel' }); });
    }

    res.status(501).json({ error: 'Excel export not implemented for LowDB mode' });
  } catch (error) {
    console.error('exportBillsExcel error:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
};

exports.exportArrearsExcel = (req, res) => {
  try {
    const { from_date, to_date } = req.query;

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        let query = `
          SELECT b.member_id, u.name as member_name, u.flat_number, u.wing, u.email, u.phone,
                 COUNT(b.id) as bill_count,
                 SUM(b.total_amount) as total_billed,
                 SUM(COALESCE(b.paid_amount, 0)) as total_paid,
                 SUM(b.total_amount - COALESCE(b.paid_amount, 0)) as total_outstanding,
                 MIN(b.due_date) as oldest_due_date,
                 MAX(CASE WHEN b.due_date < CURRENT_DATE THEN (CURRENT_DATE - b.due_date) ELSE 0 END) as max_days_overdue
          FROM bills b
          LEFT JOIN platform.users u ON b.member_id = u.id
          WHERE b.society_id = $1 AND b.status NOT IN ('PAID', 'REJECTED')
            AND (b.total_amount - COALESCE(b.paid_amount, 0)) > 0
        `;
        const params = [req.user.society_id];
        let idx = 2;

        if (from_date) { query += ` AND b.bill_date >= $${idx++}`; params.push(from_date); }
        if (to_date) { query += ` AND b.bill_date <= $${idx++}`; params.push(to_date); }

        query += ' GROUP BY b.member_id, u.name, u.flat_number, u.wing, u.email, u.phone ORDER BY total_outstanding DESC';

        const { rows } = await client.query(query, params);

        const data = rows.map(r => ({
          'Member Name': r.member_name || '',
          'Flat': r.flat_number || '',
          'Wing': r.wing || '',
          'Email': r.email || '',
          'Phone': r.phone || '',
          'Bill Count': parseInt(r.bill_count),
          'Total Billed': parseFloat(r.total_billed || 0),
          'Total Paid': parseFloat(r.total_paid || 0),
          'Outstanding': parseFloat(r.total_outstanding || 0),
          'Oldest Due Date': r.oldest_due_date,
          'Days Overdue': parseInt(r.max_days_overdue || 0)
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Arrears');

        const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="arrears-report.xlsx"');
        res.send(buffer);
      }).catch((err) => { console.error('exportArrearsExcel error:', err); return res.status(500).json({ error: 'Failed to export Excel' }); });
    }

    res.status(501).json({ error: 'Excel export not implemented for LowDB mode' });
  } catch (error) {
    console.error('exportArrearsExcel error:', error);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
};

// ============== EXPORT REPORTS AS PDF ==============

exports.exportBillsPDFReport = (req, res) => {
  try {
    const { from_date, to_date, status } = req.query;

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        let query = `
          SELECT b.bill_number, b.bill_date, b.due_date, b.total_amount, b.paid_amount,
                 b.total_amount - COALESCE(b.paid_amount, 0) as outstanding, b.status,
                 u.name as member_name, u.flat_number, u.wing
          FROM bills b
          LEFT JOIN platform.users u ON b.member_id = u.id
          WHERE b.society_id = $1
        `;
        const params = [req.user.society_id];
        let idx = 2;

        if (from_date) { query += ` AND b.bill_date >= $${idx++}`; params.push(from_date); }
        if (to_date) { query += ` AND b.bill_date <= $${idx++}`; params.push(to_date); }
        if (status) { query += ` AND b.status = $${idx++}`; params.push(status); }

        query += ' ORDER BY b.bill_date DESC';

        const { rows } = await client.query(query, params);

        // Get society details
        const { rows: societyRows } = await client.query('SELECT name, address FROM platform.societies WHERE id = $1', [req.user.society_id]);
        const society = societyRows[0] || { name: 'Society', address: '' };

        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'attachment; filename="billing-report.pdf"');
          res.send(pdfBuffer);
        });

        // Report Header
        doc.fontSize(18).font('Helvetica-Bold').text(society.name, { align: 'center' });
        doc.fontSize(12).text('Billing Report', { align: 'center' });
        if (from_date || to_date) {
          doc.fontSize(10).text(`Period: ${from_date || 'Start'} to ${to_date || 'Today'}`, { align: 'center' });
        }
        doc.moveDown();

        // Summary
        const totalBilled = rows.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
        const totalPaid = rows.reduce((s, r) => s + parseFloat(r.paid_amount || 0), 0);
        const totalOutstanding = rows.reduce((s, r) => s + parseFloat(r.outstanding || 0), 0);

        doc.fontSize(10).font('Helvetica');
        doc.text(`Total Bills: ${rows.length}`, 50);
        doc.text(`Total Billed: ₹${totalBilled.toFixed(2)}`, 50);
        doc.text(`Total Collected: ₹${totalPaid.toFixed(2)}`, 50);
        doc.text(`Total Outstanding: ₹${totalOutstanding.toFixed(2)}`, 50);
        doc.moveDown();

        // Table Header
        const tableTop = doc.y;
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Bill No.', 50, tableTop);
        doc.text('Date', 130, tableTop);
        doc.text('Member', 190, tableTop);
        doc.text('Flat', 280, tableTop);
        doc.text('Amount', 340, tableTop, { width: 60, align: 'right' });
        doc.text('Paid', 400, tableTop, { width: 60, align: 'right' });
        doc.text('Status', 460, tableTop);

        doc.moveTo(50, tableTop + 12).lineTo(550, tableTop + 12).stroke();
        doc.moveDown();

        // Table Rows
        let y = tableTop + 18;
        doc.font('Helvetica');
        for (const bill of rows) {
          doc.text(bill.bill_number || '', 50, y, { width: 80 });
          doc.text(bill.bill_date || '', 130, y, { width: 60 });
          doc.text((bill.member_name || '').substring(0, 20), 190, y, { width: 90 });
          doc.text(bill.flat_number || '', 280, y, { width: 60 });
          doc.text(parseFloat(bill.total_amount || 0).toFixed(2), 340, y, { width: 60, align: 'right' });
          doc.text(parseFloat(bill.paid_amount || 0).toFixed(2), 400, y, { width: 60, align: 'right' });
          doc.text(bill.status || '', 460, y);
          y += 12;

          if (y > 700) {
            doc.addPage();
            y = 50;
          }
        }

        doc.fontSize(8).text(`Generated on: ${new Date().toISOString()}`, 50, 750, { align: 'center' });
        doc.end();
      }).catch((err) => { console.error('exportBillsPDFReport error:', err); return res.status(500).json({ error: 'Failed to generate PDF report' }); });
    }

    res.status(501).json({ error: 'PDF report not implemented for LowDB mode' });
  } catch (error) {
    console.error('exportBillsPDFReport error:', error);
    res.status(500).json({ error: 'Failed to generate PDF report' });
  }
};
