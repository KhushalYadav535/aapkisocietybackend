const { pool, isPostgresEnabled, ensurePlatformSchema, getTenantSchemaName } = require('../config/postgres');
const { getDb } = require('../config/database');

exports.getCollectionReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const societyId = req.user.society_id;

    let report = { monthly: [], yearly: [], summary: {} };

    if (isPostgresEnabled) {
      await ensurePlatformSchema();

      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `\"${getTenantSchemaName(societyId)}\"`;

      const monthlyQuery = `
        SELECT
          DATE_TRUNC('month', payment_date) as month,
          COUNT(*) as total_payments,
          SUM(amount) as total_collected
        FROM ${schema}.payments
        WHERE status = 'SUCCESS'
        ${start_date ? 'AND payment_date >= $1' : ''}
        ${end_date ? 'AND payment_date <= $2' : ''}
        GROUP BY DATE_TRUNC('month', payment_date)
        ORDER BY month DESC
        LIMIT 12
      `;

      const params = [];
      if (start_date) params.push(start_date);
      if (end_date) params.push(end_date);

      const monthlyRes = await pool.query(monthlyQuery, params);

      const summaryQuery = `
        SELECT
          COUNT(DISTINCT p.id) as total_payments,
          COALESCE(SUM(p.amount), 0) as total_collected,
          COALESCE(SUM(b.total_amount), 0) as total_billed,
          COALESCE(SUM(b.total_amount) - COALESCE(SUM(p.amount), 0), 0) as outstanding
        FROM ${schema}.bills b
        LEFT JOIN ${schema}.payments p ON p.bill_id = b.id AND p.status = 'SUCCESS'
        WHERE 1=1
        ${start_date ? 'AND b.bill_date >= $1' : ''}
        ${end_date ? 'AND b.bill_date <= $2' : ''}
      `;

      const summaryRes = await pool.query(summaryQuery, params);

      report.monthly = monthlyRes.rows.map(r => ({
        month: r.month,
        total_payments: parseInt(r.total_payments),
        total_collected: parseFloat(r.total_collected || 0)
      }));

      if (summaryRes.rows[0]) {
        const s = summaryRes.rows[0];
        const totalBilled = parseFloat(s.total_billed || 0);
        const totalCollected = parseFloat(s.total_collected || 0);
        report.summary = {
          total_payments: parseInt(s.total_payments || 0),
          total_collected: totalCollected,
          total_billed: totalBilled,
          outstanding: totalBilled - totalCollected,
          collection_rate: totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0
        };
      }
    } else {
      const db = getDb();
      const payments = db.get('payments').filter(p => p.status === 'SUCCESS').value();
      const bills = db.get('bills').value();

      const totalCollected = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const totalBilled = bills.reduce((sum, b) => sum + (b.total_amount || 0), 0);

      report.summary = {
        total_payments: payments.length,
        total_collected: totalCollected,
        total_billed: totalBilled,
        outstanding: totalBilled - totalCollected,
        collection_rate: totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0
      };

      const monthGroups = {};
      payments.forEach(p => {
        const month = new Date(p.payment_date).toISOString().slice(0, 7);
        if (!monthGroups[month]) monthGroups[month] = { count: 0, total: 0 };
        monthGroups[month].count++;
        monthGroups[month].total += p.amount || 0;
      });

      report.monthly = Object.entries(monthGroups)
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => b.month.localeCompare(a.month))
        .slice(0, 12);
    }

    res.json({ report });
  } catch (error) {
    console.error('Collection report error:', error);
    res.status(500).json({ error: 'Failed to generate collection report' });
  }
};

exports.getComplaintReport = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    let report = { by_status: {}, by_category: {}, by_priority: {}, monthly: [] };

    if (isPostgresEnabled) {
      await ensurePlatformSchema();
      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `\"${getTenantSchemaName(societyId)}\"`;

      const statsRes = await pool.query(`
        SELECT status, COUNT(*) as count FROM ${schema}.complaints GROUP BY status
      `);

      const catRes = await pool.query(`
        SELECT category, COUNT(*) as count FROM ${schema}.complaints GROUP BY category
      `);

      const priorityRes = await pool.query(`
        SELECT priority, COUNT(*) as count FROM ${schema}.complaints GROUP BY priority
      `);

      const monthlyRes = await pool.query(`
        SELECT
          DATE_TRUNC('month', created_at) as month,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'RESOLVED') as resolved
        FROM ${schema}.complaints
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month DESC
        LIMIT 12
      `);

      statsRes.rows.forEach(r => { report.by_status[r.status] = parseInt(r.count); });
      catRes.rows.forEach(r => { report.by_category[r.category] = parseInt(r.count); });
      priorityRes.rows.forEach(r => { report.by_priority[r.priority] = parseInt(r.count); });
      report.monthly = monthlyRes.rows.map(r => ({
        month: r.month,
        total: parseInt(r.total),
        resolved: parseInt(r.resolved || 0)
      }));
    } else {
      const db = getDb();
      const complaints = db.get('complaints').value();

      complaints.forEach(c => {
        report.by_status[c.status] = (report.by_status[c.status] || 0) + 1;
        report.by_category[c.category] = (report.by_category[c.category] || 0) + 1;
        report.by_priority[c.priority] = (report.by_priority[c.priority] || 0) + 1;
      });

      const monthGroups = {};
      complaints.forEach(c => {
        const month = new Date(c.created_at).toISOString().slice(0, 7);
        if (!monthGroups[month]) monthGroups[month] = { total: 0, resolved: 0 };
        monthGroups[month].total++;
        if (c.status === 'RESOLVED') monthGroups[month].resolved++;
      });

      report.monthly = Object.entries(monthGroups)
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => b.month.localeCompare(a.month))
        .slice(0, 12);
    }

    res.json({ report });
  } catch (error) {
    console.error('Complaint report error:', error);
    res.status(500).json({ error: 'Failed to generate complaint report' });
  }
};

exports.getBillingReport = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    let report = { by_status: {}, by_type: {}, monthly: [], summary: {} };

    if (isPostgresEnabled) {
      await ensurePlatformSchema();
      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `\"${getTenantSchemaName(societyId)}\"`;

      const statusRes = await pool.query(`
        SELECT status, COUNT(*) as count, SUM(total_amount) as amount FROM ${schema}.bills GROUP BY status
      `);

      const typeRes = await pool.query(`
        SELECT bill_type, COUNT(*) as count, SUM(total_amount) as amount FROM ${schema}.bills GROUP BY bill_type
      `);

      const monthlyRes = await pool.query(`
        SELECT
          DATE_TRUNC('month', bill_date) as month,
          COUNT(*) as total_bills,
          SUM(total_amount) as total_amount,
          SUM(paid_amount) as paid_amount
        FROM ${schema}.bills
        GROUP BY DATE_TRUNC('month', bill_date)
        ORDER BY month DESC
        LIMIT 12
      `);

      statusRes.rows.forEach(r => {
        report.by_status[r.status] = { count: parseInt(r.count), amount: parseFloat(r.amount || 0) };
      });

      typeRes.rows.forEach(r => {
        report.by_type[r.bill_type] = { count: parseInt(r.count), amount: parseFloat(r.amount || 0) };
      });

      report.monthly = monthlyRes.rows.map(r => ({
        month: r.month,
        total_bills: parseInt(r.total_bills),
        total_amount: parseFloat(r.total_amount || 0),
        paid_amount: parseFloat(r.paid_amount || 0)
      }));
    } else {
      const db = getDb();
      const bills = db.get('bills').value();

      bills.forEach(b => {
        report.by_status[b.status] = report.by_status[b.status] || { count: 0, amount: 0 };
        report.by_status[b.status].count++;
        report.by_status[b.status].amount += b.total_amount || 0;

        report.by_type[b.bill_type] = report.by_type[b.bill_type] || { count: 0, amount: 0 };
        report.by_type[b.bill_type].count++;
        report.by_type[b.bill_type].amount += b.total_amount || 0;
      });
    }

    res.json({ report });
  } catch (error) {
    console.error('Billing report error:', error);
    res.status(500).json({ error: 'Failed to generate billing report' });
  }
};

exports.getVisitorReport = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    let report = { total: 0, checked_in: 0, checked_out: 0, by_purpose: {}, daily: [] };

    if (isPostgresEnabled) {
      await ensurePlatformSchema();
      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `\"${getTenantSchemaName(societyId)}\"`;

      const totalRes = await pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'CHECKED_IN') as checked_in, COUNT(*) FILTER (WHERE status = 'CHECKED_OUT') as checked_out FROM ${schema}.visitors`);
      const purposeRes = await pool.query(`SELECT purpose, COUNT(*) as count FROM ${schema}.visitors GROUP BY purpose`);
      const dailyRes = await pool.query(`
        SELECT DATE(check_in) as date, COUNT(*) as count FROM ${schema}.visitors
        WHERE check_in >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(check_in)
        ORDER BY date DESC
      `);

      report.total = parseInt(totalRes.rows[0]?.total || 0);
      report.checked_in = parseInt(totalRes.rows[0]?.checked_in || 0);
      report.checked_out = parseInt(totalRes.rows[0]?.checked_out || 0);
      purposeRes.rows.forEach(r => { report.by_purpose[r.purpose || 'Unknown'] = parseInt(r.count); });
      report.daily = dailyRes.rows.map(r => ({ date: r.date, count: parseInt(r.count) }));
    } else {
      const db = getDb();
      const visitors = db.get('visitors').value();

      report.total = visitors.length;
      report.checked_in = visitors.filter(v => v.status === 'CHECKED_IN').length;
      report.checked_out = visitors.filter(v => v.status === 'CHECKED_OUT').length;

      visitors.forEach(v => {
        const purpose = v.purpose || 'Unknown';
        report.by_purpose[purpose] = (report.by_purpose[purpose] || 0) + 1;
      });
    }

    res.json({ report });
  } catch (error) {
    console.error('Visitor report error:', error);
    res.status(500).json({ error: 'Failed to generate visitor report' });
  }
};

exports.getDashboardSummary = async (req, res) => {
  try {
    const societyId = req.user.society_id;

    let summary = {
      members: { total: 0, active: 0 },
      bills: { total: 0, pending: 0, overdue: 0, collected: 0 },
      complaints: { total: 0, open: 0, resolved: 0 },
      visitors: { today: 0, inside: 0 },
      notices: { total: 0, published: 0 }
    };

    if (isPostgresEnabled) {
      await ensurePlatformSchema();
      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `\"${getTenantSchemaName(societyId)}\"`;

      const [memRes, billRes, compRes, visRes, noticeRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = 1) as active FROM ${schema === 'platform' ? 'platform' : `\"${getTenantSchemaName(societyId)}\"`}.users`),
        pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'PENDING' OR status = 'PENDING_APPROVAL') as pending, COUNT(*) FILTER (WHERE status = 'OVERDUE') as overdue, COALESCE(SUM(paid_amount), 0) as collected FROM ${schema}.bills`),
        pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'OPEN') as open, COUNT(*) FILTER (WHERE status = 'RESOLVED') as resolved FROM ${schema}.complaints`),
        pool.query(`SELECT COUNT(*) FILTER (WHERE DATE(check_in) = CURRENT_DATE) as today, COUNT(*) FILTER (WHERE status = 'CHECKED_IN') as inside FROM ${schema}.visitors`),
        pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_published = 1) as published FROM ${schema}.notices`)
      ]);

      summary.members = { total: parseInt(memRes.rows[0]?.total || 0), active: parseInt(memRes.rows[0]?.active || 0) };
      summary.bills = { total: parseInt(billRes.rows[0]?.total || 0), pending: parseInt(billRes.rows[0]?.pending || 0), overdue: parseInt(billRes.rows[0]?.overdue || 0), collected: parseFloat(billRes.rows[0]?.collected || 0) };
      summary.complaints = { total: parseInt(compRes.rows[0]?.total || 0), open: parseInt(compRes.rows[0]?.open || 0), resolved: parseInt(compRes.rows[0]?.resolved || 0) };
      summary.visitors = { today: parseInt(visRes.rows[0]?.today || 0), inside: parseInt(visRes.rows[0]?.inside || 0) };
      summary.notices = { total: parseInt(noticeRes.rows[0]?.total || 0), published: parseInt(noticeRes.rows[0]?.published || 0) };
    } else {
      const db = getDb();
      const members = db.get('users').value();
      const bills = db.get('bills').value();
      const complaints = db.get('complaints').value();
      const visitors = db.get('visitors').value();
      const notices = db.get('notices').value();

      summary.members = { total: members.length, active: members.filter(m => m.is_active).length };
      summary.bills = { total: bills.length, pending: bills.filter(b => ['PENDING', 'PENDING_APPROVAL'].includes(b.status)).length, overdue: bills.filter(b => b.status === 'OVERDUE').length, collected: bills.reduce((s, b) => s + (b.paid_amount || 0), 0) };
      summary.complaints = { total: complaints.length, open: complaints.filter(c => c.status === 'OPEN').length, resolved: complaints.filter(c => c.status === 'RESOLVED').length };
      summary.visitors = { today: visitors.filter(v => v.check_in && v.check_in.startsWith(new Date().toISOString().split('T')[0])).length, inside: visitors.filter(v => v.status === 'CHECKED_IN').length };
      summary.notices = { total: notices.length, published: notices.filter(n => n.is_published).length };
    }

    res.json({ summary });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to generate dashboard summary' });
  }
};

// GET /api/reports/defaulters — Defaulter Aging Report
exports.getDefaulterAging = async (req, res) => {
  try {
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      await ensurePlatformSchema();
      const schema = `\"${getTenantSchemaName(societyId)}\"`;
      const r = await pool.query(`
        SELECT
          u.id AS member_id,
          u.first_name, u.last_name, u.flat_number, u.wing, u.phone, u.email,
          COUNT(b.id)::int AS total_bills,
          COALESCE(SUM(b.total_amount - COALESCE(b.paid_amount,0)), 0)::numeric AS outstanding,
          MIN(b.due_date) AS oldest_due_date,
          SUM(CASE WHEN b.due_date >= CURRENT_DATE - 30 AND b.due_date < CURRENT_DATE THEN b.total_amount - COALESCE(b.paid_amount,0) ELSE 0 END)::numeric AS bucket_0_30,
          SUM(CASE WHEN b.due_date >= CURRENT_DATE - 60 AND b.due_date < CURRENT_DATE - 30 THEN b.total_amount - COALESCE(b.paid_amount,0) ELSE 0 END)::numeric AS bucket_31_60,
          SUM(CASE WHEN b.due_date >= CURRENT_DATE - 90 AND b.due_date < CURRENT_DATE - 60 THEN b.total_amount - COALESCE(b.paid_amount,0) ELSE 0 END)::numeric AS bucket_61_90,
          SUM(CASE WHEN b.due_date < CURRENT_DATE - 90 THEN b.total_amount - COALESCE(b.paid_amount,0) ELSE 0 END)::numeric AS bucket_90_plus
        FROM ${schema}.bills b
        JOIN platform.users u ON u.id = b.member_id
        WHERE b.society_id = $1
          AND b.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
          AND b.due_date < CURRENT_DATE
        GROUP BY u.id, u.first_name, u.last_name, u.flat_number, u.wing, u.phone, u.email
        HAVING SUM(b.total_amount - COALESCE(b.paid_amount,0)) > 0
        ORDER BY outstanding DESC
      `, [societyId]);

      const totals = r.rows.reduce((acc, row) => {
        acc.total_outstanding += parseFloat(row.outstanding || 0);
        acc.bucket_0_30 += parseFloat(row.bucket_0_30 || 0);
        acc.bucket_31_60 += parseFloat(row.bucket_31_60 || 0);
        acc.bucket_61_90 += parseFloat(row.bucket_61_90 || 0);
        acc.bucket_90_plus += parseFloat(row.bucket_90_plus || 0);
        return acc;
      }, { total_outstanding: 0, bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 });

      return res.json({ defaulters: r.rows, totals, total_defaulters: r.rows.length });
    }

    // LowDB fallback
    const db = getDb();
    const users = db.get('users').value();
    const bills = db.get('bills').filter(b =>
      b.society_id === societyId &&
      ['PENDING','OVERDUE','PARTIALLY_PAID'].includes(b.status) &&
      b.due_date && new Date(b.due_date) < new Date()
    ).value();

    const now = new Date();
    const d30 = new Date(); d30.setDate(d30.getDate() - 30);
    const d60 = new Date(); d60.setDate(d60.getDate() - 60);
    const d90 = new Date(); d90.setDate(d90.getDate() - 90);

    const memberMap = {};
    bills.forEach(b => {
      if (!memberMap[b.member_id]) memberMap[b.member_id] = { bills: [], oldest_due: null };
      memberMap[b.member_id].bills.push(b);
      if (!memberMap[b.member_id].oldest_due || new Date(b.due_date) < new Date(memberMap[b.member_id].oldest_due))
        memberMap[b.member_id].oldest_due = b.due_date;
    });

    const defaulters = Object.entries(memberMap).map(([memberId, data]) => {
      const u = users.find(x => x.id === memberId) || {};
      const outstanding = data.bills.reduce((s, b) => s + (b.total_amount - (b.paid_amount || 0)), 0);
      const bucket = (from, to) => data.bills.filter(b => {
        const d = new Date(b.due_date);
        return (!to || d >= to) && d < from;
      }).reduce((s, b) => s + (b.total_amount - (b.paid_amount || 0)), 0);

      return {
        member_id: memberId, first_name: u.first_name, last_name: u.last_name,
        flat_number: u.flat_number, wing: u.wing, phone: u.phone, email: u.email,
        total_bills: data.bills.length, outstanding,
        oldest_due_date: data.oldest_due,
        bucket_0_30: bucket(now, d30), bucket_31_60: bucket(d30, d60),
        bucket_61_90: bucket(d60, d90), bucket_90_plus: bucket(d90, null)
      };
    }).filter(d => d.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);

    const totals = defaulters.reduce((acc, d) => {
      acc.total_outstanding += d.outstanding;
      acc.bucket_0_30 += d.bucket_0_30;
      acc.bucket_31_60 += d.bucket_31_60;
      acc.bucket_61_90 += d.bucket_61_90;
      acc.bucket_90_plus += d.bucket_90_plus;
      return acc;
    }, { total_outstanding: 0, bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 });

    res.json({ defaulters, totals, total_defaulters: defaulters.length });
  } catch (error) {
    console.error('Defaulter aging error:', error);
    res.status(500).json({ error: 'Failed to generate defaulter aging report' });
  }
};

// ─── Trial Balance Report (delegates to accounting) ─────────────────
exports.getTrialBalance = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: { accounts: [], totals: { debit: 0, credit: 0 } } });
    const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `"society_${societyId}"`;

    const result = await pool.query(`
      SELECT a.id, a.name, a.group_name, a.sub_group,
        COALESCE(SUM(CASE WHEN ve.debit_amount > 0 THEN ve.debit_amount ELSE 0 END), 0) AS debit,
        COALESCE(SUM(CASE WHEN ve.credit_amount > 0 THEN ve.credit_amount ELSE 0 END), 0) AS credit
      FROM ${schema}.accounts a
      LEFT JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      LEFT JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED'
        ${from_date ? "AND v.voucher_date >= '" + from_date + "'" : ''}
        ${to_date ? "AND v.voucher_date <= '" + to_date + "'" : ''}
      GROUP BY a.id, a.name, a.group_name, a.sub_group
      HAVING SUM(COALESCE(ve.debit_amount,0)) > 0 OR SUM(COALESCE(ve.credit_amount,0)) > 0
      ORDER BY a.group_name, a.name
    `);

    const accounts = result.rows.map(r => ({ ...r, debit: parseFloat(r.debit), credit: parseFloat(r.credit) }));
    const totals = accounts.reduce((acc, a) => ({ debit: acc.debit + a.debit, credit: acc.credit + a.credit }), { debit: 0, credit: 0 });

    res.json({ report: { accounts, totals, period: { from: from_date, to: to_date } } });
  } catch (error) {
    console.error('Trial balance report error:', error);
    res.status(500).json({ error: 'Failed to generate trial balance report' });
  }
};

// ─── Income & Expenditure Statement ─────────────────────────────────
exports.getIncomeExpenditure = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: { income: [], expenditure: [], surplus: 0 } });
    const schema = `"society_${societyId}"`;

    const incomeR = await pool.query(`
      SELECT a.name, a.sub_group, COALESCE(SUM(ve.credit_amount), 0) AS amount
      FROM ${schema}.accounts a
      JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED'
      WHERE a.group_name IN ('INCOME', 'Revenue')
        ${from_date ? "AND v.voucher_date >= '" + from_date + "'" : ''}
        ${to_date ? "AND v.voucher_date <= '" + to_date + "'" : ''}
      GROUP BY a.name, a.sub_group ORDER BY amount DESC
    `);

    const expR = await pool.query(`
      SELECT a.name, a.sub_group, COALESCE(SUM(ve.debit_amount), 0) AS amount
      FROM ${schema}.accounts a
      JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED'
      WHERE a.group_name IN ('EXPENSE', 'Expenditure')
        ${from_date ? "AND v.voucher_date >= '" + from_date + "'" : ''}
        ${to_date ? "AND v.voucher_date <= '" + to_date + "'" : ''}
      GROUP BY a.name, a.sub_group ORDER BY amount DESC
    `);

    const totalIncome = incomeR.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    const totalExpenditure = expR.rows.reduce((s, r) => s + parseFloat(r.amount), 0);

    res.json({ report: { income: incomeR.rows, expenditure: expR.rows, total_income: totalIncome, total_expenditure: totalExpenditure, surplus: totalIncome - totalExpenditure, period: { from: from_date, to: to_date } } });
  } catch (error) {
    console.error('I&E report error:', error);
    res.status(500).json({ error: 'Failed to generate I&E report' });
  }
};

// ─── Balance Sheet ──────────────────────────────────────────────────
exports.getBalanceSheet = async (req, res) => {
  try {
    const { as_of_date } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: { assets: [], liabilities: [], equity: [] } });
    const schema = `"society_${societyId}"`;
    const dateFilter = as_of_date ? `AND v.voucher_date <= '${as_of_date}'` : '';

    const assetsR = await pool.query(`
      SELECT a.name, a.sub_group,
        COALESCE(SUM(ve.debit_amount),0) - COALESCE(SUM(ve.credit_amount),0) AS balance
      FROM ${schema}.accounts a
      LEFT JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      LEFT JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED' ${dateFilter}
      WHERE a.group_name IN ('ASSET', 'Current Assets', 'Fixed Assets', 'Bank Accounts')
      GROUP BY a.name, a.sub_group ORDER BY a.sub_group, a.name
    `);

    const liabR = await pool.query(`
      SELECT a.name, a.sub_group,
        COALESCE(SUM(ve.credit_amount),0) - COALESCE(SUM(ve.debit_amount),0) AS balance
      FROM ${schema}.accounts a
      LEFT JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      LEFT JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED' ${dateFilter}
      WHERE a.group_name IN ('LIABILITY', 'Current Liabilities', 'Loans')
      GROUP BY a.name, a.sub_group ORDER BY a.sub_group, a.name
    `);

    const totalAssets = assetsR.rows.reduce((s, r) => s + parseFloat(r.balance || 0), 0);
    const totalLiabilities = liabR.rows.reduce((s, r) => s + parseFloat(r.balance || 0), 0);

    res.json({ report: { assets: assetsR.rows, liabilities: liabR.rows, total_assets: totalAssets, total_liabilities: totalLiabilities, net_worth: totalAssets - totalLiabilities, as_of_date: as_of_date || new Date().toISOString().split('T')[0] } });
  } catch (error) {
    console.error('Balance sheet error:', error);
    res.status(500).json({ error: 'Failed to generate balance sheet' });
  }
};

// ─── Cash Flow Report ───────────────────────────────────────────────
exports.getCashFlow = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: { inflows: [], outflows: [], net: 0 } });
    const schema = `"society_${societyId}"`;

    const inflowR = await pool.query(`
      SELECT a.name, COALESCE(SUM(ve.debit_amount), 0) AS amount
      FROM ${schema}.accounts a
      JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED' AND v.voucher_type = 'RECEIPT'
        ${from_date ? "AND v.voucher_date >= '" + from_date + "'" : ''}
        ${to_date ? "AND v.voucher_date <= '" + to_date + "'" : ''}
      WHERE a.group_name IN ('Bank Accounts', 'Cash')
      GROUP BY a.name ORDER BY amount DESC
    `);

    const outflowR = await pool.query(`
      SELECT a.name, COALESCE(SUM(ve.credit_amount), 0) AS amount
      FROM ${schema}.accounts a
      JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED' AND v.voucher_type = 'PAYMENT'
        ${from_date ? "AND v.voucher_date >= '" + from_date + "'" : ''}
        ${to_date ? "AND v.voucher_date <= '" + to_date + "'" : ''}
      WHERE a.group_name IN ('Bank Accounts', 'Cash')
      GROUP BY a.name ORDER BY amount DESC
    `);

    const totalInflow = inflowR.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    const totalOutflow = outflowR.rows.reduce((s, r) => s + parseFloat(r.amount), 0);

    res.json({ report: { inflows: inflowR.rows, outflows: outflowR.rows, total_inflow: totalInflow, total_outflow: totalOutflow, net: totalInflow - totalOutflow } });
  } catch (error) {
    console.error('Cash flow error:', error);
    res.status(500).json({ error: 'Failed to generate cash flow report' });
  }
};

// ─── Staff Attendance Report ────────────────────────────────────────
exports.getStaffAttendance = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: [] });
    const schema = `"society_${societyId}"`;

    const result = await pool.query(`
      SELECT s.id, s.name, s.role as staff_role,
        COUNT(sa.id) AS total_records,
        COUNT(sa.id) FILTER (WHERE sa.status = 'PRESENT') AS present,
        COUNT(sa.id) FILTER (WHERE sa.status = 'ABSENT') AS absent,
        COUNT(sa.id) FILTER (WHERE sa.status = 'HALF_DAY') AS half_days,
        ROUND(COUNT(sa.id) FILTER (WHERE sa.status = 'PRESENT')::numeric / NULLIF(COUNT(sa.id), 0) * 100, 1) AS attendance_pct
      FROM ${schema}.staff s
      LEFT JOIN ${schema}.staff_attendance sa ON sa.staff_id = s.id
        ${from_date ? "AND sa.date >= '" + from_date + "'" : ''}
        ${to_date ? "AND sa.date <= '" + to_date + "'" : ''}
      GROUP BY s.id, s.name, s.role
      ORDER BY attendance_pct ASC
    `);

    res.json({ report: result.rows });
  } catch (error) {
    console.error('Staff attendance report error:', error);
    res.status(500).json({ error: 'Failed to generate staff attendance report' });
  }
};

// ─── Facility Usage Report ──────────────────────────────────────────
exports.getFacilityUsage = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: [] });
    const schema = `"society_${societyId}"`;

    const result = await pool.query(`
      SELECT f.id, f.name, f.type,
        COUNT(fb.id) AS total_bookings,
        COUNT(fb.id) FILTER (WHERE fb.status = 'CONFIRMED') AS confirmed,
        COUNT(fb.id) FILTER (WHERE fb.status = 'CANCELLED') AS cancelled,
        COALESCE(SUM(fb.amount), 0) AS total_revenue
      FROM ${schema}.facilities f
      LEFT JOIN ${schema}.facility_bookings fb ON fb.facility_id = f.id
        ${from_date ? "AND fb.booking_date >= '" + from_date + "'" : ''}
        ${to_date ? "AND fb.booking_date <= '" + to_date + "'" : ''}
      GROUP BY f.id, f.name, f.type
      ORDER BY total_bookings DESC
    `);

    res.json({ report: result.rows });
  } catch (error) {
    console.error('Facility usage report error:', error);
    res.status(500).json({ error: 'Failed to generate facility usage report' });
  }
};

// ─── Member Directory Report ────────────────────────────────────────
exports.getMemberReport = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: { members: [], summary: {} } });

    const result = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.flat_number, u.wing, u.role, u.is_active,
        u.created_at, COUNT(b.id) AS total_bills,
        COALESCE(SUM(b.total_amount - COALESCE(b.paid_amount, 0)), 0) AS outstanding
      FROM platform.users u
      LEFT JOIN "society_${societyId}".bills b ON b.member_id = u.id AND b.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      WHERE u.society_id = $1
      GROUP BY u.id ORDER BY u.wing, u.flat_number
    `, [societyId]);

    const members = result.rows;
    const summary = {
      total: members.length,
      active: members.filter(m => m.is_active).length,
      by_role: {},
      by_wing: {},
    };
    members.forEach(m => {
      summary.by_role[m.role] = (summary.by_role[m.role] || 0) + 1;
      if (m.wing) summary.by_wing[m.wing] = (summary.by_wing[m.wing] || 0) + 1;
    });

    res.json({ report: { members, summary } });
  } catch (error) {
    console.error('Member report error:', error);
    res.status(500).json({ error: 'Failed to generate member report' });
  }
};

// ─── Maintenance Due Report ─────────────────────────────────────────
exports.getMaintenanceDue = async (req, res) => {
  try {
    const { month } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: [] });
    const schema = `"society_${societyId}"`;

    const result = await pool.query(`
      SELECT u.flat_number, u.wing, u.first_name || ' ' || u.last_name AS name,
        b.total_amount, b.paid_amount, b.total_amount - COALESCE(b.paid_amount, 0) AS due,
        b.due_date, b.status, b.billing_period
      FROM ${schema}.bills b
      JOIN platform.users u ON u.id = b.member_id
      WHERE b.society_id = $1 AND b.status IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
        ${month ? "AND b.billing_period = '" + month + "'" : ''}
      ORDER BY u.wing, u.flat_number
    `, [societyId]);

    const totalDue = result.rows.reduce((s, r) => s + parseFloat(r.due || 0), 0);
    res.json({ report: result.rows, total_due: totalDue, count: result.rows.length });
  } catch (error) {
    console.error('Maintenance due report error:', error);
    res.status(500).json({ error: 'Failed to generate maintenance due report' });
  }
};

// ─── Interest Calculation Report ────────────────────────────────────
exports.getInterestReport = async (req, res) => {
  try {
    const { rate_pa, as_of_date } = req.query;
    const societyId = req.user.society_id;
    const interestRate = parseFloat(rate_pa || 18) / 100 / 365;
    if (!isPostgresEnabled) return res.json({ report: [] });
    const schema = `"society_${societyId}"`;
    const asOf = as_of_date || new Date().toISOString().split('T')[0];

    const result = await pool.query(`
      SELECT u.flat_number, u.wing, u.first_name || ' ' || u.last_name AS name,
        b.id AS bill_id, b.total_amount, b.paid_amount,
        b.total_amount - COALESCE(b.paid_amount, 0) AS principal,
        b.due_date,
        GREATEST(DATE '${asOf}' - b.due_date, 0) AS days_overdue
      FROM ${schema}.bills b
      JOIN platform.users u ON u.id = b.member_id
      WHERE b.society_id = $1 AND b.status IN ('OVERDUE', 'PARTIALLY_PAID')
        AND b.due_date < '${asOf}'
      ORDER BY u.wing, u.flat_number
    `, [societyId]);

    const report = result.rows.map(r => {
      const principal = parseFloat(r.principal || 0);
      const daysOverdue = parseInt(r.days_overdue || 0);
      const interest = principal * interestRate * daysOverdue;
      return { ...r, principal, days_overdue: daysOverdue, interest: Math.round(interest * 100) / 100, total_with_interest: Math.round((principal + interest) * 100) / 100 };
    });

    const totalInterest = report.reduce((s, r) => s + r.interest, 0);
    const totalPrincipal = report.reduce((s, r) => s + r.principal, 0);

    res.json({ report, summary: { total_principal: totalPrincipal, total_interest: totalInterest, grand_total: totalPrincipal + totalInterest, rate_pa: parseFloat(rate_pa || 18), as_of_date: asOf } });
  } catch (error) {
    console.error('Interest report error:', error);
    res.status(500).json({ error: 'Failed to generate interest report' });
  }
};

// ─── Receipts & Payments Account ────────────────────────────────────
exports.getReceiptsPayments = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: { receipts: [], payments: [], opening_balance: 0, closing_balance: 0 } });
    const schema = `"society_${societyId}"`;

    const receiptsR = await pool.query(`
      SELECT a.name, a.sub_group, COALESCE(SUM(ve.debit_amount), 0) AS amount
      FROM ${schema}.accounts a
      JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED' AND v.voucher_type = 'RECEIPT'
      WHERE a.group_name IN ('Bank Accounts', 'Cash', 'ASSET')
        ${from_date ? "AND v.voucher_date >= '" + from_date + "'" : ''}
        ${to_date ? "AND v.voucher_date <= '" + to_date + "'" : ''}
      GROUP BY a.name, a.sub_group ORDER BY amount DESC
    `);

    const paymentsR = await pool.query(`
      SELECT a.name, a.sub_group, COALESCE(SUM(ve.credit_amount), 0) AS amount
      FROM ${schema}.accounts a
      JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED' AND v.voucher_type = 'PAYMENT'
      WHERE a.group_name IN ('Bank Accounts', 'Cash', 'ASSET')
        ${from_date ? "AND v.voucher_date >= '" + from_date + "'" : ''}
        ${to_date ? "AND v.voucher_date <= '" + to_date + "'" : ''}
      GROUP BY a.name, a.sub_group ORDER BY amount DESC
    `);

    const openingR = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN a.group_name IN ('Bank Accounts','Cash') THEN COALESCE(a.opening_balance,0) ELSE 0 END), 0) AS opening
      FROM ${schema}.accounts a
      WHERE a.group_name IN ('Bank Accounts', 'Cash')
    `);

    const totalReceipts = receiptsR.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    const totalPayments = paymentsR.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    const openingBalance = parseFloat(openingR.rows[0]?.opening || 0);
    const closingBalance = openingBalance + totalReceipts - totalPayments;

    res.json({ report: { receipts: receiptsR.rows, payments: paymentsR.rows, total_receipts: totalReceipts, total_payments: totalPayments, opening_balance: openingBalance, closing_balance: closingBalance, period: { from: from_date, to: to_date } } });
  } catch (error) {
    console.error('Receipts & Payments error:', error);
    res.status(500).json({ error: 'Failed to generate receipts & payments report' });
  }
};

// ─── Fund-wise Summary ──────────────────────────────────────────────
exports.getFundSummary = async (req, res) => {
  try {
    const { as_of_date } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: { funds: [] } });
    const schema = `"society_${societyId}"`;
    const dateFilter = as_of_date ? `AND v.voucher_date <= '${as_of_date}'` : '';

    const result = await pool.query(`
      SELECT a.sub_group AS fund_name,
        COALESCE(SUM(ve.credit_amount), 0) - COALESCE(SUM(ve.debit_amount), 0) AS balance,
        COUNT(DISTINCT a.id) AS accounts_count
      FROM ${schema}.accounts a
      LEFT JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      LEFT JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED' ${dateFilter}
      WHERE a.group_name IN ('Capital Account', 'Reserves & Surplus', 'Corpus Fund', 'Sinking Fund', 'Repair Fund', 'Education Fund', 'Reserve Fund')
        OR a.sub_group ILIKE '%fund%'
      GROUP BY a.sub_group
      HAVING COALESCE(SUM(ve.credit_amount), 0) - COALESCE(SUM(ve.debit_amount), 0) != 0
      ORDER BY balance DESC
    `);

    const totalFunds = result.rows.reduce((s, r) => s + parseFloat(r.balance), 0);
    res.json({ report: { funds: result.rows, total_fund_balance: totalFunds, as_of_date: as_of_date || new Date().toISOString().split('T')[0] } });
  } catch (error) {
    console.error('Fund summary error:', error);
    res.status(500).json({ error: 'Failed to generate fund summary report' });
  }
};

// ─── Budget vs Actual Variance ──────────────────────────────────────
exports.getBudgetVariance = async (req, res) => {
  try {
    const { fy } = req.query;
    const societyId = req.user.society_id;
    if (!isPostgresEnabled) return res.json({ report: [] });
    const schema = `"society_${societyId}"`;

    // Ensure budget table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.budgets (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        account_name TEXT,
        category TEXT,
        fy TEXT,
        budgeted_amount NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const fyStart = fy ? `${fy}-04-01` : `${new Date().getFullYear()}-04-01`;
    const fyEnd = fy ? `${parseInt(fy) + 1}-03-31` : `${new Date().getFullYear() + 1}-03-31`;

    const result = await pool.query(`
      SELECT b.account_name, b.category, b.budgeted_amount,
        COALESCE(SUM(ve.debit_amount), 0) AS actual_expense,
        COALESCE(SUM(ve.credit_amount), 0) AS actual_income
      FROM ${schema}.budgets b
      LEFT JOIN ${schema}.accounts a ON a.id = b.account_id OR a.name = b.account_name
      LEFT JOIN ${schema}.voucher_entries ve ON ve.account_id = a.id
      LEFT JOIN ${schema}.vouchers v ON v.id = ve.voucher_id AND v.status = 'APPROVED'
        AND v.voucher_date BETWEEN $1 AND $2
      WHERE b.fy = $3 OR b.fy IS NULL
      GROUP BY b.account_name, b.category, b.budgeted_amount
      ORDER BY b.category, b.account_name
    `, [fyStart, fyEnd, fy || new Date().getFullYear().toString()]);

    const report = result.rows.map(r => {
      const budgeted = parseFloat(r.budgeted_amount || 0);
      const actual = r.category === 'INCOME' ? parseFloat(r.actual_income) : parseFloat(r.actual_expense);
      const variance = budgeted - actual;
      const variancePct = budgeted > 0 ? Math.round((variance / budgeted) * 10000) / 100 : 0;
      return { ...r, actual, variance, variance_pct: variancePct, status: variance >= 0 ? 'UNDER_BUDGET' : 'OVER_BUDGET' };
    });

    const totals = report.reduce((acc, r) => {
      acc.total_budgeted += parseFloat(r.budgeted_amount || 0);
      acc.total_actual += r.actual;
      return acc;
    }, { total_budgeted: 0, total_actual: 0 });
    totals.total_variance = totals.total_budgeted - totals.total_actual;

    res.json({ report, totals, fy: fy || new Date().getFullYear().toString() });
  } catch (error) {
    console.error('Budget variance error:', error);
    res.status(500).json({ error: 'Failed to generate budget variance report' });
  }
};