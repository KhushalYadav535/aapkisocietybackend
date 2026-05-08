const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled, pool, ensurePlatformSchema } = require('../config/postgres');

exports.getStats = (req, res) => {
  try {
    // Platform admin: platform-level overview (no tenant schema)
    if (isPostgresEnabled && req.user.role === 'PLATFORM_ADMIN') {
      return ensurePlatformSchema().then(async () => {
        const [usersR] = await Promise.all([
          pool.query('SELECT COUNT(*)::int AS c FROM platform.users WHERE is_active = 1')
        ]);
        return res.json({
          stats: {
            total_members: usersR.rows[0]?.c || 0,
            total_flats: 0,
            pending_complaints: 0,
            pending_bills: 0,
            today_visitors: 0,
            total_collection: 0,
            monthly_collection: 0,
            active_notices: 0,
          }
        });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch stats' }));
    }

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const isResident = req.user.role === 'RESIDENT';
        const [usersR, flatsR, complaintsR, billsR, visitorsR, paymentsR, noticesR, monthlyPaymentsR] = await Promise.all([
          client.query('SELECT COUNT(*)::int AS c FROM platform.users WHERE society_id = $1 AND is_active = 1', [req.user.society_id]),
          client.query('SELECT COUNT(*)::int AS c FROM platform.flats WHERE society_id = $1', [req.user.society_id]),
          isResident
            ? client.query("SELECT COUNT(*)::int AS c FROM complaints WHERE raised_by = $1 AND status IN ('OPEN','IN_PROGRESS')", [req.user.id])
            : client.query("SELECT COUNT(*)::int AS c FROM complaints WHERE status IN ('OPEN','IN_PROGRESS')"),
          isResident
            ? client.query("SELECT COUNT(*)::int AS c FROM bills WHERE member_id = $1 AND status NOT IN ('PAID','REJECTED')", [req.user.id])
            : client.query("SELECT COUNT(*)::int AS c FROM bills WHERE status NOT IN ('PAID','REJECTED')"),
          client.query('SELECT COUNT(*)::int AS c FROM visitors WHERE DATE(check_in) = CURRENT_DATE'),
          isResident
            ? client.query("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'SUCCESS' AND member_id = $1", [req.user.id])
            : client.query("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'SUCCESS'"),
          client.query('SELECT COUNT(*)::int AS c FROM notices WHERE is_published = 1'),
          isResident
            ? client.query("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'SUCCESS' AND member_id = $1 AND date_trunc('month', payment_date) = date_trunc('month', NOW())", [req.user.id])
            : client.query("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'SUCCESS' AND date_trunc('month', payment_date) = date_trunc('month', NOW())")
        ]);
        return res.json({
          stats: {
            // For RESIDENT we intentionally don't expose society-wide totals.
            total_members: isResident ? 0 : (usersR.rows[0]?.c || 0),
            total_flats: isResident ? 0 : (flatsR.rows[0]?.c || 0),
            pending_complaints: complaintsR.rows[0]?.c || 0,
            pending_bills: billsR.rows[0]?.c || 0,
            // Visitors are society-wide; for residents don't show this KPI.
            today_visitors: isResident ? 0 : (visitorsR.rows[0]?.c || 0),
            total_collection: Number(paymentsR.rows[0]?.s || 0),
            monthly_collection: Number(monthlyPaymentsR.rows[0]?.s || 0),
            active_notices: noticesR.rows[0]?.c || 0,
          }
        });
      }).catch((error) => {
        console.error('Dashboard stats error:', error);
        return res.status(500).json({ error: 'Failed to fetch stats' });
      });
    }
    const db = getDb();
    const sid = req.user.society_id;
    const isResident = req.user.role === 'RESIDENT';
    const isPlatformAdmin = req.user.role === 'PLATFORM_ADMIN';

    if (isPlatformAdmin) {
      const totalMembers = db.get('users').filter({ is_active: 1 }).size().value();
      return res.json({
        stats: {
          total_members: totalMembers || 0,
          total_flats: 0,
          pending_complaints: 0,
          pending_bills: 0,
          today_visitors: 0,
          total_collection: 0,
          monthly_collection: 0,
          active_notices: 0,
        }
      });
    }

    const totalMembers = isResident ? 0 : db.get('users').filter({ society_id: sid, is_active: 1 }).size().value();
    const totalFlats = isResident ? 0 : db.get('flats').filter({ society_id: sid }).size().value();
    const pendingComplaints = isResident
      ? db.get('complaints').filter(c => c.society_id === sid && c.raised_by === req.user.id && ['OPEN', 'IN_PROGRESS'].includes(c.status)).size().value()
      : db.get('complaints').filter(c => c.society_id === sid && ['OPEN', 'IN_PROGRESS'].includes(c.status)).size().value();
    const pendingBills = isResident
      ? db.get('bills').filter(b => b.society_id === sid && b.member_id === req.user.id && !['PAID', 'REJECTED'].includes(b.status)).size().value()
      : db.get('bills').filter(b => b.society_id === sid && !['PAID', 'REJECTED'].includes(b.status)).size().value();
    const today = new Date().toISOString().split('T')[0];
    const todayVisitors = db.get('visitors').filter(v => v.society_id === sid && v.check_in && v.check_in.startsWith(today)).size().value();
    const totalCollection = isResident
      ? db.get('payments').filter({ society_id: sid, status: 'SUCCESS', member_id: req.user.id }).reduce((sum, p) => sum + (p.amount || 0), 0).value()
      : db.get('payments').filter({ society_id: sid, status: 'SUCCESS' }).reduce((sum, p) => sum + (p.amount || 0), 0).value();
    const activeNotices = db.get('notices').filter({ society_id: sid, is_published: 1 }).size().value();

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartStr = monthStart.toISOString();
    const monthlyCollection = isResident
      ? db.get('payments').filter(p => p.society_id === sid && p.member_id === req.user.id && p.status === 'SUCCESS' && p.payment_date >= monthStartStr).reduce((sum, p) => sum + (p.amount || 0), 0).value()
      : db.get('payments').filter(p => p.society_id === sid && p.status === 'SUCCESS' && p.payment_date >= monthStartStr).reduce((sum, p) => sum + (p.amount || 0), 0).value();

    res.json({
      stats: {
        total_members: totalMembers || 0,
        total_flats: totalFlats || 0,
        pending_complaints: pendingComplaints || 0,
        pending_bills: pendingBills || 0,
        today_visitors: isResident ? 0 : (todayVisitors || 0),
        total_collection: totalCollection || 0,
        monthly_collection: monthlyCollection || 0,
        active_notices: activeNotices || 0,
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

exports.getRecentActivities = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.role === 'PLATFORM_ADMIN') {
      return res.json({ activities: [] });
    }
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const isResident = req.user.role === 'RESIDENT';
        const [cR, pR, nR] = await Promise.all([
          isResident
            ? client.query('SELECT id,title,status,priority,created_at FROM complaints WHERE raised_by = $1 ORDER BY created_at DESC LIMIT 5', [req.user.id])
            : client.query('SELECT id,title,status,priority,created_at FROM complaints ORDER BY created_at DESC LIMIT 5'),
          isResident
            ? client.query('SELECT id,amount,status,payment_date FROM payments WHERE member_id = $1 ORDER BY payment_date DESC LIMIT 5', [req.user.id])
            : client.query('SELECT id,amount,status,payment_date FROM payments ORDER BY payment_date DESC LIMIT 5'),
          client.query('SELECT id,title,priority,created_at FROM notices WHERE is_published = 1 ORDER BY publish_date DESC LIMIT 5')
        ]);
        const recentComplaints = cR.rows.map(c => ({ id: c.id, title: c.title, status: c.status, priority: c.priority, created_at: c.created_at, type: 'complaint' }));
        const recentPayments = pR.rows.map(p => ({ id: p.id, amount: p.amount, status: p.status, created_at: p.payment_date, type: 'payment' }));
        const recentNotices = nR.rows.map(n => ({ id: n.id, title: n.title, priority: n.priority, created_at: n.created_at, type: 'notice' }));
        const activities = [...recentComplaints, ...recentPayments, ...recentNotices].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10);
        return res.json({ activities });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch activities' }));
    }
    const db = getDb();
    const sid = req.user.society_id;
    const isResident = req.user.role === 'RESIDENT';
    const isPlatformAdmin = req.user.role === 'PLATFORM_ADMIN';

    if (isPlatformAdmin) return res.json({ activities: [] });

    const recentComplaints = (isResident
      ? db.get('complaints').filter({ society_id: sid, raised_by: req.user.id })
      : db.get('complaints').filter({ society_id: sid })
    ).sortBy('created_at').reverse().take(5).value()
      .map(c => ({ id: c.id, title: c.title, status: c.status, priority: c.priority, created_at: c.created_at, type: 'complaint' }));

    const recentPayments = (isResident
      ? db.get('payments').filter({ society_id: sid, member_id: req.user.id })
      : db.get('payments').filter({ society_id: sid })
    ).sortBy('payment_date').reverse().take(5).value()
      .map(p => ({ id: p.id, amount: p.amount, status: p.status, created_at: p.payment_date, type: 'payment' }));

    const recentNotices = db.get('notices').filter({ society_id: sid, is_published: 1 }).sortBy('publish_date').reverse().take(5).value()
      .map(n => ({ id: n.id, title: n.title, priority: n.priority, created_at: n.created_at, type: 'notice' }));

    const activities = [...recentComplaints, ...recentPayments, ...recentNotices]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);

    res.json({ activities });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
};

exports.getCollectionSummary = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.role === 'PLATFORM_ADMIN') {
      return res.json({ collection_summary: [] });
    }
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const isResident = req.user.role === 'RESIDENT';
        const promises = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          const year = d.getFullYear();
          const month = d.getMonth() + 1;
          const p = isResident
            ? client.query('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = $1 AND member_id = $2 AND EXTRACT(YEAR FROM payment_date) = $3 AND EXTRACT(MONTH FROM payment_date) = $4', ['SUCCESS', req.user.id, year, month]).then(r => ({ month: i, total: Number(r.rows[0]?.s || 0) }))
            : client.query('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = $1 AND EXTRACT(YEAR FROM payment_date) = $2 AND EXTRACT(MONTH FROM payment_date) = $3', ['SUCCESS', year, month]).then(r => ({ month: i, total: Number(r.rows[0]?.s || 0) }));
          promises.push(p);
        }
        const months = await Promise.all(promises);
        return res.json({ collection_summary: months });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch collection summary' }));
    }
    const db = getDb();
    const sid = req.user.society_id;
    const isResident = req.user.role === 'RESIDENT';
    const isPlatformAdmin = req.user.role === 'PLATFORM_ADMIN';
    if (isPlatformAdmin) return res.json({ collection_summary: [] });
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const total = db.get('payments')
        .filter(p => p.society_id === sid && p.status === 'SUCCESS' && (!isResident || p.member_id === req.user.id) && p.payment_date && p.payment_date.startsWith(prefix))
        .reduce((sum, p) => sum + (p.amount || 0), 0).value();
      months.push({ month: i, total: total || 0 });
    }
    res.json({ collection_summary: months });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch collection summary' });
  }
};

exports.getComplaintStats = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.role === 'PLATFORM_ADMIN') {
      return res.json({ complaint_stats: { open: 0, in_progress: 0, resolved: 0, closed: 0 } });
    }
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        const isResident = req.user.role === 'RESIDENT';
        const r = await client.query(
          isResident
            ? 'SELECT status, COUNT(*)::int AS c FROM complaints WHERE raised_by = $1 GROUP BY status'
            : 'SELECT status, COUNT(*)::int AS c FROM complaints GROUP BY status',
          isResident ? [req.user.id] : []
        );
        const map = Object.fromEntries(r.rows.map(x => [x.status, x.c]));
        return res.json({
          complaint_stats: {
            open: map.OPEN || 0,
            in_progress: map.IN_PROGRESS || 0,
            resolved: map.RESOLVED || 0,
            closed: map.CLOSED || 0,
          }
        });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch complaint stats' }));
    }
    const db = getDb();
    const sid = req.user.society_id;
    const isResident = req.user.role === 'RESIDENT';
    const isPlatformAdmin = req.user.role === 'PLATFORM_ADMIN';
    if (isPlatformAdmin) return res.json({ complaint_stats: { open: 0, in_progress: 0, resolved: 0, closed: 0 } });
    const all = isResident
      ? db.get('complaints').filter({ society_id: sid, raised_by: req.user.id }).value()
      : db.get('complaints').filter({ society_id: sid }).value();

    res.json({
      complaint_stats: {
        open: all.filter(c => c.status === 'OPEN').length,
        in_progress: all.filter(c => c.status === 'IN_PROGRESS').length,
        resolved: all.filter(c => c.status === 'RESOLVED').length,
        closed: all.filter(c => c.status === 'CLOSED').length,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch complaint stats' });
  }
};
