const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled } = require('../config/postgres');

const ensureSosTables = async (societyId) => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS \"society_${societyId}\"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \"society_${societyId}\".sos_alerts (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      raised_by TEXT,
      flat_number TEXT,
      wing TEXT,
      alert_type TEXT,
      description TEXT,
      status TEXT DEFAULT 'ACTIVE',
      responded_by TEXT,
      responded_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

// POST /api/sos — raise SOS alert
exports.raise = async (req, res) => {
  try {
    const { alert_type, description } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();
    const alert = {
      id: uuidv4(), society_id: societyId,
      raised_by: req.user.id,
      flat_number: req.user.flat_number || null,
      wing: req.user.wing || null,
      alert_type: alert_type || 'GENERAL',
      description: description || null,
      status: 'ACTIVE',
      responded_by: null, responded_at: null, resolved_at: null,
      created_at: now
    };

    if (isPostgresEnabled) {
      await ensureSosTables(societyId);
      await pool.query(
        `INSERT INTO \"society_${societyId}\".sos_alerts
         (id,society_id,raised_by,flat_number,wing,alert_type,description,status,responded_by,responded_at,resolved_at,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [alert.id, alert.society_id, alert.raised_by, alert.flat_number, alert.wing,
         alert.alert_type, alert.description, alert.status,
         alert.responded_by, alert.responded_at, alert.resolved_at, alert.created_at]
      );
      return res.status(201).json({ alert });
    }

    const db = getDb();
    if (!db.get('sos_alerts').value()) db.set('sos_alerts', []).write();
    db.get('sos_alerts').push(alert).write();
    res.status(201).json({ alert });
  } catch (error) {
    console.error('SOS raise error:', error.message);
    res.status(500).json({ error: 'Failed to raise SOS alert' });
  }
};

// GET /api/sos — get all alerts for society
exports.getAll = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { status } = req.query;

    if (isPostgresEnabled) {
      await ensureSosTables(societyId);
      let q = `
        SELECT s.*, u.first_name, u.last_name, u.phone,
               r.first_name AS responder_first_name, r.last_name AS responder_last_name
        FROM \"society_${societyId}\".sos_alerts s
        LEFT JOIN platform.users u ON u.id = s.raised_by
        LEFT JOIN platform.users r ON r.id = s.responded_by
        WHERE s.society_id = $1`;
      const params = [societyId];
      if (status) { q += ` AND s.status = $2`; params.push(status); }
      q += ' ORDER BY s.created_at DESC';
      const r = await pool.query(q, params);
      return res.json({ alerts: r.rows });
    }

    const db = getDb();
    const users = db.get('users').value();
    let alerts = db.get('sos_alerts') ? db.get('sos_alerts').filter(a => a.society_id === societyId).value() : [];
    if (status) alerts = alerts.filter(a => a.status === status);
    alerts = alerts.map(a => {
      const u = users.find(x => x.id === a.raised_by);
      return { ...a, first_name: u?.first_name, last_name: u?.last_name, phone: u?.phone };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch SOS alerts' });
  }
};

// PUT /api/sos/:id/respond — guard/admin acknowledges
exports.respond = async (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      await ensureSosTables(societyId);
      await pool.query(
        `UPDATE \"society_${societyId}\".sos_alerts SET status='RESPONDED', responded_by=$1, responded_at=$2 WHERE id=$3`,
        [req.user.id, now, id]
      );
      const r = await pool.query(`SELECT * FROM \"society_${societyId}\".sos_alerts WHERE id=$1`, [id]);
      return res.json({ alert: r.rows[0] });
    }

    const db = getDb();
    db.get('sos_alerts').find({ id }).assign({ status: 'RESPONDED', responded_by: req.user.id, responded_at: now }).write();
    res.json({ alert: db.get('sos_alerts').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to respond to SOS' });
  }
};

// PUT /api/sos/:id/resolve — mark resolved
exports.resolve = async (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      await ensureSosTables(societyId);
      await pool.query(
        `UPDATE \"society_${societyId}\".sos_alerts SET status='RESOLVED', resolved_at=$1 WHERE id=$2`,
        [now, id]
      );
      const r = await pool.query(`SELECT * FROM \"society_${societyId}\".sos_alerts WHERE id=$1`, [id]);
      return res.json({ alert: r.rows[0] });
    }

    const db = getDb();
    db.get('sos_alerts').find({ id }).assign({ status: 'RESOLVED', resolved_at: now }).write();
    res.json({ alert: db.get('sos_alerts').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve SOS' });
  }
};

// GET /api/sos/active-count — for dashboard badge
exports.activeCount = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (isPostgresEnabled) {
      await ensureSosTables(societyId);
      const r = await pool.query(
        `SELECT COUNT(*)::int AS count FROM \"society_${societyId}\".sos_alerts WHERE society_id=$1 AND status='ACTIVE'`,
        [societyId]
      );
      return res.json({ count: r.rows[0]?.count || 0 });
    }
    const db = getDb();
    const count = db.get('sos_alerts') ? db.get('sos_alerts').filter(a => a.society_id === societyId && a.status === 'ACTIVE').size().value() : 0;
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get count' });
  }
};
