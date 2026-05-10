const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');
const { getDb } = require('../config/database');

exports.getCollectionReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const societyId = req.user.society_id;

    let report = { monthly: [], yearly: [], summary: {} };

    if (isPostgresEnabled) {
      await ensurePlatformSchema();

      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `society_${societyId}`;

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
      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `society_${societyId}`;

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
      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `society_${societyId}`;

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
      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `society_${societyId}`;

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
      const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `society_${societyId}`;

      const [memRes, billRes, compRes, visRes, noticeRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = 1) as active FROM ${schema === 'platform' ? 'platform' : `society_${societyId}`}.users`),
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
      const schema = `society_${societyId}`;
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