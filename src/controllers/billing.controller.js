const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const _tenantBillingInitLocks = new Map();

const ensureTenantBillingTables = async (client) => {
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
      }).catch(() => res.status(500).json({ error: 'Failed to get billing summary' }));
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
