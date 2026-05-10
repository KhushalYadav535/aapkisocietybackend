const { v4: uuidv4 } = require('uuid');
const { withTenant, isPostgresEnabled } = require('../config/postgres');
const { getDb } = require('../config/database');
const { logAudit } = require('./audit.controller');

// ─── Table bootstrap ──────────────────────────────────────────────────────────
const ensureAccountingTables = async (client) => {
  // Chart of Accounts
  await client.query(`
    CREATE TABLE IF NOT EXISTS ledger_accounts (
      id           TEXT PRIMARY KEY,
      code         TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      category     TEXT NOT NULL,   -- ASSET | LIABILITY | INCOME | EXPENSE | EQUITY
      sub_category TEXT,
      is_system    BOOLEAN DEFAULT FALSE,
      is_active    BOOLEAN DEFAULT TRUE,
      opening_balance NUMERIC(15,2) DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Vouchers (immutable after approval per PRD §4.1.2)
  await client.query(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id             TEXT PRIMARY KEY,
      voucher_number TEXT NOT NULL UNIQUE,
      voucher_type   TEXT NOT NULL,   -- RECEIPT | PAYMENT | JOURNAL | CONTRA | CREDIT_NOTE | DEBIT_NOTE
      amount         NUMERIC(15,2) NOT NULL,
      narration      TEXT,
      status         TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | PENDING_APPROVAL | APPROVED | REVERSED
      maker_id       TEXT NOT NULL,
      checker_id     TEXT,
      reversal_of    TEXT,
      fiscal_year    TEXT NOT NULL,
      voucher_date   DATE NOT NULL,
      society_id     TEXT,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Ledger entries (double-entry — Dr = Cr per voucher)
  await client.query(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id          TEXT PRIMARY KEY,
      voucher_id  TEXT NOT NULL,
      account_id  TEXT NOT NULL,
      entry_type  TEXT NOT NULL,   -- DEBIT | CREDIT
      amount      NUMERIC(15,2) NOT NULL,
      narration   TEXT,
      entry_date  DATE NOT NULL,
      society_id  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Indexes (PRD §4.2)
  await client.query(`CREATE INDEX IF NOT EXISTS idx_vouchers_date_type   ON vouchers       (voucher_date, voucher_type)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_vouchers_status       ON vouchers       (status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ledger_account_date  ON ledger_entries (account_id, entry_date)`);
};

// Seed a minimal COA if none exists
const seedDefaultCOA = async (client) => {
  const { rows } = await client.query('SELECT COUNT(*) AS cnt FROM ledger_accounts');
  if (parseInt(rows[0].cnt, 10) > 0) return;

  const defaults = [
    { code: '1001', name: 'Cash',                  category: 'ASSET',     sub_category: 'Current Asset',    is_system: true },
    { code: '1002', name: 'Bank Account',           category: 'ASSET',     sub_category: 'Current Asset',    is_system: true },
    { code: '1003', name: 'Accounts Receivable',    category: 'ASSET',     sub_category: 'Current Asset',    is_system: true },
    { code: '2001', name: 'Accounts Payable',       category: 'LIABILITY', sub_category: 'Current Liability', is_system: true },
    { code: '2002', name: 'Security Deposits',      category: 'LIABILITY', sub_category: 'Non-Current',       is_system: true },
    { code: '3001', name: 'Society Capital',        category: 'EQUITY',    sub_category: 'Equity',            is_system: true },
    { code: '4001', name: 'Maintenance Income',     category: 'INCOME',    sub_category: 'Revenue',           is_system: true },
    { code: '4002', name: 'Interest Income',        category: 'INCOME',    sub_category: 'Revenue',           is_system: true },
    { code: '4003', name: 'Penalty Income',         category: 'INCOME',    sub_category: 'Revenue',           is_system: true },
    { code: '4004', name: 'Parking Charges',        category: 'INCOME',    sub_category: 'Revenue',           is_system: false },
    { code: '5001', name: 'Electricity Expense',    category: 'EXPENSE',   sub_category: 'Utility',           is_system: false },
    { code: '5002', name: 'Water Expense',          category: 'EXPENSE',   sub_category: 'Utility',           is_system: false },
    { code: '5003', name: 'Maintenance Expense',    category: 'EXPENSE',   sub_category: 'Operations',        is_system: false },
    { code: '5004', name: 'Salary Expense',         category: 'EXPENSE',   sub_category: 'HR',                is_system: false },
    { code: '5005', name: 'Security Expense',       category: 'EXPENSE',   sub_category: 'Operations',        is_system: false },
    { code: '5006', name: 'Repairs & Maintenance',  category: 'EXPENSE',   sub_category: 'Operations',        is_system: false },
    { code: '5007', name: 'Administrative Expense', category: 'EXPENSE',   sub_category: 'Admin',             is_system: false },
  ];

  for (const acct of defaults) {
    await client.query(
      `INSERT INTO ledger_accounts (id, code, name, category, sub_category, is_system, is_active, opening_balance)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,0) ON CONFLICT (code) DO NOTHING`,
      [uuidv4(), acct.code, acct.name, acct.category, acct.sub_category || null, acct.is_system]
    );
  }
};

// ─── Utility ──────────────────────────────────────────────────────────────────
const currentFiscalYear = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};

const generateVoucherNumber = (type) => {
  const prefix = { RECEIPT: 'REC', PAYMENT: 'PAY', JOURNAL: 'JNL', CONTRA: 'CON', CREDIT_NOTE: 'CRN', DEBIT_NOTE: 'DBN' }[type] || 'VCH';
  const fy = currentFiscalYear().replace('-', '');
  return `${prefix}-${fy}-${Date.now().toString(36).toUpperCase()}`;
};

// ─── Controllers ──────────────────────────────────────────────────────────────

// GET /api/accounting/accounts
exports.getAccounts = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        await seedDefaultCOA(client);
        const { rows } = await client.query('SELECT * FROM ledger_accounts WHERE is_active = TRUE ORDER BY code');
        return res.json({ accounts: rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch accounts' }));
    }
    const db = getDb();
    const accounts = db.get('ledger_accounts').filter({ is_active: true }).sortBy('code').value() || [];
    res.json({ accounts });
  } catch {
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
};

// POST /api/accounting/accounts
exports.createAccount = async (req, res) => {
  try {
    const { code, name, category, sub_category, opening_balance } = req.body;
    if (!code || !name || !category) return res.status(400).json({ error: 'code, name, category are required' });

    const id = uuidv4();
    const now = new Date().toISOString();
    const account = { id, code, name, category, sub_category: sub_category || null, is_system: false, is_active: true, opening_balance: parseFloat(opening_balance) || 0, created_at: now, updated_at: now };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        await client.query(
          `INSERT INTO ledger_accounts (id,code,name,category,sub_category,is_system,is_active,opening_balance) VALUES ($1,$2,$3,$4,$5,FALSE,TRUE,$6)`,
          [id, code, name, category, sub_category || null, parseFloat(opening_balance) || 0]
        );
        await logAudit(req, 'ACCOUNT_CREATED', 'ledger_account', id, null, account, client);
        return res.status(201).json({ account });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to create account' }));
    }
    const db = getDb();
    if (!db.get('ledger_accounts').value()) db.set('ledger_accounts', []).write();
    db.get('ledger_accounts').push(account).write();
    res.status(201).json({ account });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to create account' });
  }
};

// GET /api/accounting/vouchers
exports.getVouchers = async (req, res) => {
  try {
    const { status, type, from, to } = req.query;
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        let q = 'SELECT * FROM vouchers WHERE 1=1';
        const params = [];
        let idx = 1;
        if (status)  { q += ` AND status = $${idx++}`;       params.push(status); }
        if (type)    { q += ` AND voucher_type = $${idx++}`;  params.push(type); }
        if (from)    { q += ` AND voucher_date >= $${idx++}`; params.push(from); }
        if (to)      { q += ` AND voucher_date <= $${idx++}`; params.push(to); }
        q += ' ORDER BY voucher_date DESC, created_at DESC';
        const { rows } = await client.query(q, params);
        return res.json({ vouchers: rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch vouchers' }));
    }
    const db = getDb();
    let vouchers = db.get('vouchers').filter({ society_id: req.user.society_id }).value() || [];
    if (status) vouchers = vouchers.filter(v => v.status === status);
    if (type)   vouchers = vouchers.filter(v => v.voucher_type === type);
    res.json({ vouchers });
  } catch {
    res.status(500).json({ error: 'Failed to fetch vouchers' });
  }
};

// POST /api/accounting/vouchers  — Maker creates, status = DRAFT
exports.createVoucher = async (req, res) => {
  try {
    const { voucher_type, voucher_date, narration, entries } = req.body;
    if (!voucher_type || !voucher_date || !entries || entries.length < 2) {
      return res.status(400).json({ error: 'voucher_type, voucher_date and at least 2 entries are required' });
    }

    // Validate double-entry balance
    const totalDr = entries.filter(e => e.entry_type === 'DEBIT').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const totalCr = entries.filter(e => e.entry_type === 'CREDIT').reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    if (Math.abs(totalDr - totalCr) > 0.001) {
      return res.status(400).json({ error: `Debit (₹${totalDr.toFixed(2)}) ≠ Credit (₹${totalCr.toFixed(2)}). Double-entry violated.` });
    }

    const id = uuidv4();
    const voucher_number = generateVoucherNumber(voucher_type);
    const fiscal_year = currentFiscalYear();
    const now = new Date().toISOString();

    const voucher = {
      id, voucher_number, voucher_type, amount: totalDr,
      narration: narration || null, status: 'DRAFT',
      maker_id: req.user.id, checker_id: null, reversal_of: null,
      fiscal_year, voucher_date, society_id: req.user.society_id,
      created_at: now, updated_at: now
    };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        await client.query(
          `INSERT INTO vouchers (id,voucher_number,voucher_type,amount,narration,status,maker_id,checker_id,reversal_of,fiscal_year,voucher_date,society_id)
           VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,NULL,NULL,$7,$8,$9)`,
          [id, voucher_number, voucher_type, totalDr, narration || null, req.user.id, fiscal_year, voucher_date, req.user.society_id]
        );
        for (const entry of entries) {
          await client.query(
            `INSERT INTO ledger_entries (id,voucher_id,account_id,entry_type,amount,narration,entry_date,society_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [uuidv4(), id, entry.account_id, entry.entry_type, parseFloat(entry.amount), entry.narration || narration || null, voucher_date, req.user.society_id]
          );
        }
        await logAudit(req, 'VOUCHER_CREATED', 'voucher', id, null, voucher, client);
        return res.status(201).json({ voucher, message: 'Voucher created — pending approval' });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to create voucher' }));
    }

    // LowDB fallback
    const db = getDb();
    if (!db.get('vouchers').value()) db.set('vouchers', []).write();
    if (!db.get('ledger_entries').value()) db.set('ledger_entries', []).write();
    db.get('vouchers').push(voucher).write();
    for (const entry of entries) {
      db.get('ledger_entries').push({ id: uuidv4(), voucher_id: id, account_id: entry.account_id, entry_type: entry.entry_type, amount: parseFloat(entry.amount), narration: entry.narration || narration || null, entry_date: voucher_date, society_id: req.user.society_id, created_at: now }).write();
    }
    res.status(201).json({ voucher, message: 'Voucher created — pending approval' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Failed to create voucher' });
  }
};

// PUT /api/accounting/vouchers/:id/approve  — Checker approves (cannot be same as maker)
exports.approveVoucher = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        const { rows } = await client.query('SELECT * FROM vouchers WHERE id = $1 LIMIT 1', [req.params.id]);
        const voucher = rows[0];
        if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
        if (voucher.maker_id === req.user.id) {
          return res.status(403).json({ error: 'MAKER_CHECKER_VIOLATION: You cannot approve your own voucher.' });
        }
        if (voucher.status === 'APPROVED') return res.status(400).json({ error: 'Already approved' });

        await client.query(
          `UPDATE vouchers SET status = 'APPROVED', checker_id = $1, updated_at = NOW() WHERE id = $2`,
          [req.user.id, req.params.id]
        );
        await logAudit(req, 'VOUCHER_APPROVED', 'voucher', req.params.id, { status: voucher.status }, { status: 'APPROVED' }, client);
        return res.json({ message: 'Voucher approved and posted to ledger' });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to approve' }));
    }
    // LowDB
    const db = getDb();
    const voucher = db.get('vouchers').find({ id: req.params.id }).value();
    if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
    if (voucher.maker_id === req.user.id) return res.status(403).json({ error: 'MAKER_CHECKER_VIOLATION: You cannot approve your own voucher.' });
    db.get('vouchers').find({ id: req.params.id }).assign({ status: 'APPROVED', checker_id: req.user.id, updated_at: new Date().toISOString() }).write();
    res.json({ message: 'Voucher approved' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to approve' });
  }
};

// PUT /api/accounting/vouchers/:id/reverse  — Creates reversal voucher
exports.reverseVoucher = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        const { rows } = await client.query('SELECT * FROM vouchers WHERE id = $1 LIMIT 1', [req.params.id]);
        const original = rows[0];
        if (!original) return res.status(404).json({ error: 'Voucher not found' });
        if (original.status !== 'APPROVED') return res.status(400).json({ error: 'Only APPROVED vouchers can be reversed' });

        // Get original entries
        const { rows: entries } = await client.query('SELECT * FROM ledger_entries WHERE voucher_id = $1', [req.params.id]);

        const reversalId = uuidv4();
        const reversalNumber = generateVoucherNumber(original.voucher_type) + '-REV';
        const today = new Date().toISOString().split('T')[0];

        await client.query(
          `INSERT INTO vouchers (id,voucher_number,voucher_type,amount,narration,status,maker_id,checker_id,reversal_of,fiscal_year,voucher_date,society_id)
           VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,NULL,$7,$8,$9,$10)`,
          [reversalId, reversalNumber, original.voucher_type, original.amount, `Reversal of ${original.voucher_number}`, req.user.id, req.params.id, currentFiscalYear(), today, req.user.society_id]
        );
        // Flip Dr ↔ Cr
        for (const e of entries) {
          await client.query(
            `INSERT INTO ledger_entries (id,voucher_id,account_id,entry_type,amount,narration,entry_date,society_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [uuidv4(), reversalId, e.account_id, e.entry_type === 'DEBIT' ? 'CREDIT' : 'DEBIT', e.amount, `Reversal: ${e.narration || ''}`, today, req.user.society_id]
          );
        }
        // Mark original as reversed
        await client.query(`UPDATE vouchers SET status = 'REVERSED', updated_at = NOW() WHERE id = $1`, [req.params.id]);
        await logAudit(req, 'VOUCHER_REVERSED', 'voucher', req.params.id, { status: 'APPROVED' }, { status: 'REVERSED', reversal_voucher: reversalId }, client);
        return res.status(201).json({ message: 'Reversal voucher created', reversal_voucher_id: reversalId });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to reverse' }));
    }
    res.status(501).json({ error: 'Not implemented for LowDB mode' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to reverse' });
  }
};

// GET /api/accounting/vouchers/:id/entries
exports.getVoucherEntries = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        const { rows } = await client.query(
          `SELECT le.*, la.name AS account_name, la.code AS account_code, la.category AS account_category
           FROM ledger_entries le
           LEFT JOIN ledger_accounts la ON la.id = le.account_id
           WHERE le.voucher_id = $1 ORDER BY le.entry_type`,
          [req.params.id]
        );
        return res.json({ entries: rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch entries' }));
    }
    const db = getDb();
    const entries = db.get('ledger_entries').filter({ voucher_id: req.params.id }).value() || [];
    res.json({ entries });
  } catch {
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
};

// GET /api/accounting/trial-balance
exports.getTrialBalance = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        await seedDefaultCOA(client);
        const { from, to } = req.query;

        let dateFilter = '';
        const params = [];
        let idx = 1;
        if (from)  { dateFilter += ` AND le.entry_date >= $${idx++}`; params.push(from); }
        if (to)    { dateFilter += ` AND le.entry_date <= $${idx++}`; params.push(to); }

        const { rows } = await client.query(`
          SELECT
            la.id, la.code, la.name, la.category, la.sub_category,
            la.opening_balance,
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT'  THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_accounts la
          LEFT JOIN ledger_entries le ON le.account_id = la.id
            AND le.voucher_id IN (SELECT id FROM vouchers WHERE status = 'APPROVED' ${dateFilter ? dateFilter.replace(/le\./g, '') : ''})
          WHERE la.is_active = TRUE
          GROUP BY la.id, la.code, la.name, la.category, la.sub_category, la.opening_balance
          ORDER BY la.code
        `, params);

        const totalDr = rows.reduce((s, r) => s + parseFloat(r.total_debit), 0);
        const totalCr = rows.reduce((s, r) => s + parseFloat(r.total_credit), 0);

        return res.json({ accounts: rows, total_debit: totalDr, total_credit: totalCr, balanced: Math.abs(totalDr - totalCr) < 0.01 });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to generate trial balance' }));
    }
    res.json({ accounts: [], total_debit: 0, total_credit: 0, balanced: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to generate trial balance' });
  }
};

// GET /api/accounting/ledger/:accountId
exports.getLedger = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        const { from, to, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Get opening balance before the from date
        let openingBalance = 0;
        let params = [req.params.accountId];
        let idx = 2;
        let openingFilter = '';
        if (from) {
          openingFilter = ` AND le.entry_date < $${idx++}`;
          params.push(from);
        }
        const { rows: openingRows } = await client.query(`
          SELECT
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_entries le
          JOIN vouchers v ON v.id = le.voucher_id AND v.status = 'APPROVED'
          WHERE le.account_id = $1${openingFilter}
        `, params);
        openingBalance = parseFloat(openingRows[0].total_debit) - parseFloat(openingRows[0].total_credit);

        // Fetch paginated ledger entries
        let q = `
          SELECT le.*, v.voucher_number, v.voucher_type, v.narration AS voucher_narration,
                 la.name AS account_name, la.code AS account_code
          FROM ledger_entries le
          JOIN vouchers v ON v.id = le.voucher_id AND v.status = 'APPROVED'
          JOIN ledger_accounts la ON la.id = le.account_id
          WHERE le.account_id = $1
        `;
        params = [req.params.accountId];
        idx = 2;
        if (from) { q += ` AND le.entry_date >= $${idx++}`; params.push(from); }
        if (to)   { q += ` AND le.entry_date <= $${idx++}`; params.push(to); }
        q += ` ORDER BY le.entry_date ASC, le.created_at ASC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(parseInt(limit), offset);

        const { rows } = await client.query(q, params);

        // Get total count for pagination
        let countParams = [req.params.accountId];
        idx = 2;
        let countFilter = '';
        if (from) { countFilter += ` AND le.entry_date >= $${idx++}`; countParams.push(from); }
        if (to)   { countFilter += ` AND le.entry_date <= $${idx++}`; countParams.push(to); }
        const { rows: countRows } = await client.query(
          `SELECT COUNT(*) AS total FROM ledger_entries le JOIN vouchers v ON v.id = le.voucher_id AND v.status = 'APPROVED' WHERE le.account_id = $1${countFilter}`,
          countParams
        );
        const total = parseInt(countRows[0].total);

        // Running balance (starts from opening balance)
        let balance = openingBalance;
        const enriched = rows.map(r => {
          balance += r.entry_type === 'DEBIT' ? parseFloat(r.amount) : -parseFloat(r.amount);
          return { ...r, running_balance: balance };
        });

        return res.json({
          entries: enriched,
          opening_balance: openingBalance,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            total_pages: Math.ceil(total / parseInt(limit))
          }
        });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to fetch ledger' }));
    }
    res.json({ entries: [], opening_balance: 0, pagination: { page: 1, limit: 50, total: 0, total_pages: 0 } });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to fetch ledger' });
  }
};

// GET /api/accounting/income-statement
exports.getIncomeStatement = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        await seedDefaultCOA(client);
        const { start_date, end_date } = req.query;

        const { rows } = await client.query(`
          SELECT
            la.id, la.code, la.name, la.sub_category,
            la.opening_balance,
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT'  THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_accounts la
          LEFT JOIN ledger_entries le ON le.account_id = la.id
            AND le.voucher_id IN (SELECT id FROM vouchers WHERE status = 'APPROVED' AND voucher_date BETWEEN $1 AND $2)
          WHERE la.is_active = TRUE AND la.sub_category = 'INCOME'
          GROUP BY la.id, la.code, la.name, la.sub_category, la.opening_balance
          ORDER BY la.code
        `, [start_date || '1900-01-01', end_date || '2100-12-31']);

        const expenseRows = await client.query(`
          SELECT
            la.id, la.code, la.name, la.sub_category,
            la.opening_balance,
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT'  THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_accounts la
          LEFT JOIN ledger_entries le ON le.account_id = la.id
            AND le.voucher_id IN (SELECT id FROM vouchers WHERE status = 'APPROVED' AND voucher_date BETWEEN $1 AND $2)
          WHERE la.is_active = TRUE AND la.sub_category = 'EXPENSE'
          GROUP BY la.id, la.code, la.name, la.sub_category, la.opening_balance
          ORDER BY la.code
        `, [start_date || '1900-01-01', end_date || '2100-12-31']);

        const income = rows.map(r => ({
          account_name: r.name,
          code: r.code,
          amount: parseFloat(r.total_credit) - parseFloat(r.total_debit)
        }));

        const expenses = expenseRows.rows.map(r => ({
          account_name: r.name,
          code: r.code,
          amount: parseFloat(r.total_debit) - parseFloat(r.total_credit)
        }));

        const total_income = income.reduce((s, i) => s + i.amount, 0);
        const total_expenses = expenses.reduce((s, e) => s + e.amount, 0);
        const net_result = total_income - total_expenses;

        return res.json({
          income,
          expenses,
          total_income,
          total_expenses,
          net_result,
          period: { start_date, end_date }
        });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to generate income statement' }));
    }
    res.json({ income: [], expenses: [], total_income: 0, total_expenses: 0, net_result: 0, period: { start_date: null, end_date: null } });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to generate income statement' });
  }
};

// GET /api/accounting/balance-sheet
exports.getBalanceSheet = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        await seedDefaultCOA(client);
        const { as_on_date } = req.query;

        const { rows: assetRows } = await client.query(`
          SELECT
            la.id, la.code, la.name, la.category,
            la.opening_balance,
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT'  THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_accounts la
          LEFT JOIN ledger_entries le ON le.account_id = la.id
            AND le.voucher_id IN (SELECT id FROM vouchers WHERE status = 'APPROVED' AND voucher_date <= $1)
          WHERE la.is_active = TRUE AND la.category = 'ASSET'
          GROUP BY la.id, la.code, la.name, la.category, la.opening_balance
          ORDER BY la.code
        `, [as_on_date || new Date().toISOString().split('T')[0]]);

        const { rows: liabilityRows } = await client.query(`
          SELECT
            la.id, la.code, la.name, la.category,
            la.opening_balance,
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT'  THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_accounts la
          LEFT JOIN ledger_entries le ON le.account_id = la.id
            AND le.voucher_id IN (SELECT id FROM vouchers WHERE status = 'APPROVED' AND voucher_date <= $1)
          WHERE la.is_active = TRUE AND la.category = 'LIABILITY'
          GROUP BY la.id, la.code, la.name, la.category, la.opening_balance
          ORDER BY la.code
        `, [as_on_date || new Date().toISOString().split('T')[0]]);

        const { rows: capitalRows } = await client.query(`
          SELECT
            la.id, la.code, la.name, la.category,
            la.opening_balance,
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT'  THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_accounts la
          LEFT JOIN ledger_entries le ON le.account_id = la.id
            AND le.voucher_id IN (SELECT id FROM vouchers WHERE status = 'APPROVED' AND voucher_date <= $1)
          WHERE la.is_active = TRUE AND la.category = 'CAPITAL'
          GROUP BY la.id, la.code, la.name, la.category, la.opening_balance
          ORDER BY la.code
        `, [as_on_date || new Date().toISOString().split('T')[0]]);

        const assets = assetRows.map(r => ({
          name: r.name,
          code: r.code,
          amount: parseFloat(r.total_debit) - parseFloat(r.total_credit)
        }));

        const liabilities = liabilityRows.map(r => ({
          name: r.name,
          code: r.code,
          amount: parseFloat(r.total_credit) - parseFloat(r.total_debit)
        }));

        const capital = capitalRows.map(r => ({
          name: r.name,
          code: r.code,
          amount: parseFloat(r.total_credit) - parseFloat(r.total_debit)
        }));

        const total_assets = assets.reduce((s, a) => s + a.amount, 0);
        const total_liabilities = liabilities.reduce((s, l) => s + l.amount, 0);
        const total_capital = capital.reduce((s, c) => s + c.amount, 0);
        const balanced = Math.abs(total_assets - (total_liabilities + total_capital)) < 0.01;

        return res.json({
          assets,
          liabilities,
          capital,
          totals: {
            assets: total_assets,
            liabilities: total_liabilities,
            capital: total_capital
          },
          balanced,
          as_on_date: as_on_date || new Date().toISOString().split('T')[0]
        });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to generate balance sheet' }));
    }
    res.json({ assets: [], liabilities: [], capital: [], totals: { assets: 0, liabilities: 0, capital: 0 }, balanced: true, as_on_date: null });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to generate balance sheet' });
  }
};

// GET /api/accounting/bank-reconciliation
exports.getBankReconciliationStatement = async (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureAccountingTables(client);
        const { account_id, month, year, bank_statement_balance } = req.query;

        if (!account_id || !month || !year) {
          return res.status(400).json({ error: 'account_id, month, and year are required' });
        }

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, parseInt(month), 0).toISOString().split('T')[0];

        // Get bank account ledger entries for the month
        const { rows: ledgerEntries } = await client.query(`
          SELECT le.*, v.voucher_number, v.narration AS voucher_narration
          FROM ledger_entries le
          JOIN vouchers v ON v.id = le.voucher_id AND v.status = 'APPROVED'
          WHERE le.account_id = $1 AND le.entry_date BETWEEN $2 AND $3
          ORDER BY le.entry_date ASC
        `, [account_id, startDate, endDate]);

        // Get opening balance (before start date)
        const { rows: openingRows } = await client.query(`
          SELECT
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_entries le
          JOIN vouchers v ON v.id = le.voucher_id AND v.status = 'APPROVED'
          WHERE le.account_id = $1 AND le.entry_date < $2
        `, [account_id, startDate]);

        const openingDebit = parseFloat(openingRows[0].total_debit);
        const openingCredit = parseFloat(openingRows[0].total_credit);
        let bank_balance_book = openingDebit - openingCredit;

        let unpresented_cheques = [];
        let uncredited_deposits = [];

        // Identify unpresented cheques (credits from bank account - these are payments issued)
        // and uncredited deposits (debits that may not have cleared)
        for (const entry of ledgerEntries) {
          const amount = parseFloat(entry.amount);
          if (entry.entry_type === 'CREDIT') {
            bank_balance_book += amount;
          } else {
            bank_balance_book -= amount;
          }

          // Check narration/comments for cheque/deposit indicators
          const narration = (entry.voucher_narration || entry.narration || '').toLowerCase();
          if (entry.entry_type === 'CREDIT' && (narration.includes('cheque') || narration.includes('payment') || narration.includes('issued'))) {
            unpresented_cheques.push({
              date: entry.entry_date,
              amount,
              payee: narration.replace(/cheque\s*/gi, '').trim() || 'Unknown'
            });
          }
          if (entry.entry_type === 'DEBIT' && (narration.includes('deposit') || narration.includes('receipt') || narration.includes('received'))) {
            uncredited_deposits.push({
              date: entry.entry_date,
              amount
            });
          }
        }

        // Get the closing balance from the bank account ledger
        const { rows: closingRows } = await client.query(`
          SELECT
            COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount ELSE 0 END), 0) AS total_debit,
            COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE 0 END), 0) AS total_credit
          FROM ledger_entries le
          JOIN vouchers v ON v.id = le.voucher_id AND v.status = 'APPROVED'
          WHERE le.account_id = $1 AND le.entry_date <= $2
        `, [account_id, endDate]);

        const closingDebit = parseFloat(closingRows[0].total_debit);
        const closingCredit = parseFloat(closingRows[0].total_credit);
        bank_balance_book = closingDebit - closingCredit;

        const stmtBalance = parseFloat(bank_statement_balance) || closingDebit - closingCredit;
        const unpresentedTotal = unpresented_cheques.reduce((s, c) => s + c.amount, 0);
        const uncreditedTotal = uncredited_deposits.reduce((s, d) => s + d.amount, 0);

        // Adjusted bank balance = Statement balance + unpresented cheques - uncredited deposits
        const adjusted_bank_balance = stmtBalance + unpresentedTotal - uncreditedTotal;
        const balanced = Math.abs(adjusted_bank_balance - bank_balance_book) < 0.01;

        return res.json({
          bank_balance_book,
          bank_statement_balance: stmtBalance,
          unpresented_cheques,
          uncredited_deposits,
          adjustments: {
            added: unpresentedTotal,
            omitted: uncreditedTotal
          },
          adjusted_bank_balance,
          balanced,
          period: { month: parseInt(month), year: parseInt(year) }
        });
      }).catch((e) => res.status(500).json({ error: e.message || 'Failed to generate bank reconciliation' }));
    }
    res.json({
      bank_balance_book: 0,
      bank_statement_balance: 0,
      unpresented_cheques: [],
      uncredited_deposits: [],
      adjustments: { added: 0, omitted: 0 },
      adjusted_bank_balance: 0,
      balanced: true,
      period: { month: null, year: null }
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to generate bank reconciliation' });
  }
};
