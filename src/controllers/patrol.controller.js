const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled } = require('../config/postgres');

const ensurePatrolTables = async (societyId) => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS \"society_${societyId}\"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \"society_${societyId}\".patrol_checkpoints (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      location_name TEXT NOT NULL,
      qr_code TEXT UNIQUE NOT NULL,
      floor TEXT,
      area TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \"society_${societyId}\".patrol_logs (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      checkpoint_id TEXT,
      checkpoint_name TEXT,
      scanned_by TEXT,
      scanned_at TIMESTAMPTZ DEFAULT NOW(),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

// GET /api/patrol/checkpoints
exports.getCheckpoints = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (isPostgresEnabled) {
      await ensurePatrolTables(societyId);
      const r = await pool.query(
        `SELECT * FROM \"society_${societyId}\".patrol_checkpoints WHERE society_id=$1 AND is_active=1 ORDER BY location_name`,
        [societyId]
      );
      return res.json({ checkpoints: r.rows });
    }
    const db = getDb();
    const cps = db.get('patrol_checkpoints') ? db.get('patrol_checkpoints').filter(c => c.society_id === societyId && c.is_active !== 0).value() : [];
    res.json({ checkpoints: cps });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch checkpoints' });
  }
};

// POST /api/patrol/checkpoints — admin creates checkpoint with QR
exports.createCheckpoint = async (req, res) => {
  try {
    const { location_name, floor, area } = req.body;
    const societyId = req.user.society_id;
    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });

    const id = uuidv4();
    const qr_code = `PATROL-${societyId}-${id}`;
    const now = new Date().toISOString();
    const checkpoint = { id, society_id: societyId, location_name, qr_code, floor: floor || null, area: area || null, is_active: 1, created_at: now };

    if (isPostgresEnabled) {
      await ensurePatrolTables(societyId);
      await pool.query(
        `INSERT INTO \"society_${societyId}\".patrol_checkpoints (id,society_id,location_name,qr_code,floor,area,is_active,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, societyId, location_name, qr_code, floor || null, area || null, 1, now]
      );
      return res.status(201).json({ checkpoint });
    }

    const db = getDb();
    if (!db.get('patrol_checkpoints').value()) db.set('patrol_checkpoints', []).write();
    db.get('patrol_checkpoints').push(checkpoint).write();
    res.status(201).json({ checkpoint });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create checkpoint' });
  }
};

// DELETE /api/patrol/checkpoints/:id
exports.deleteCheckpoint = async (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;
    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });
    if (isPostgresEnabled) {
      await ensurePatrolTables(societyId);
      await pool.query(`UPDATE \"society_${societyId}\".patrol_checkpoints SET is_active=0 WHERE id=$1`, [id]);
      return res.json({ message: 'Checkpoint deactivated' });
    }
    const db = getDb();
    db.get('patrol_checkpoints').find({ id }).assign({ is_active: 0 }).write();
    res.json({ message: 'Checkpoint deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete checkpoint' });
  }
};

// POST /api/patrol/scan — guard scans QR code
exports.scan = async (req, res) => {
  try {
    const { qr_code, notes } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    let checkpoint;
    if (isPostgresEnabled) {
      await ensurePatrolTables(societyId);
      const cpRes = await pool.query(
        `SELECT * FROM \"society_${societyId}\".patrol_checkpoints WHERE qr_code=$1 AND society_id=$2 AND is_active=1`,
        [qr_code, societyId]
      );
      if (cpRes.rows.length === 0) return res.status(404).json({ error: 'Invalid QR code or checkpoint not found' });
      checkpoint = cpRes.rows[0];

      const logId = uuidv4();
      await pool.query(
        `INSERT INTO \"society_${societyId}\".patrol_logs (id,society_id,checkpoint_id,checkpoint_name,scanned_by,scanned_at,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [logId, societyId, checkpoint.id, checkpoint.location_name, req.user.id, now, notes || null, now]
      );
      return res.json({ success: true, checkpoint_name: checkpoint.location_name, scanned_at: now });
    }

    const db = getDb();
    const cps = db.get('patrol_checkpoints').value() || [];
    checkpoint = cps.find(c => c.qr_code === qr_code && c.society_id === societyId && c.is_active !== 0);
    if (!checkpoint) return res.status(404).json({ error: 'Invalid QR code or checkpoint not found' });

    if (!db.get('patrol_logs').value()) db.set('patrol_logs', []).write();
    const log = { id: uuidv4(), society_id: societyId, checkpoint_id: checkpoint.id, checkpoint_name: checkpoint.location_name, scanned_by: req.user.id, scanned_at: now, notes: notes || null, created_at: now };
    db.get('patrol_logs').push(log).write();
    res.json({ success: true, checkpoint_name: checkpoint.location_name, scanned_at: now });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log patrol scan' });
  }
};

// GET /api/patrol/logs — get patrol history
exports.getLogs = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { checkpoint_id, date, guard_id } = req.query;

    if (isPostgresEnabled) {
      await ensurePatrolTables(societyId);
      let q = `
        SELECT pl.*, u.first_name, u.last_name
        FROM \"society_${societyId}\".patrol_logs pl
        LEFT JOIN platform.users u ON u.id = pl.scanned_by
        WHERE pl.society_id=$1`;
      const params = [societyId]; let idx = 2;
      if (checkpoint_id) { q += ` AND pl.checkpoint_id=$${idx++}`; params.push(checkpoint_id); }
      if (guard_id) { q += ` AND pl.scanned_by=$${idx++}`; params.push(guard_id); }
      if (date) { q += ` AND DATE(pl.scanned_at)=$${idx++}`; params.push(date); }
      q += ' ORDER BY pl.scanned_at DESC LIMIT 200';
      const r = await pool.query(q, params);
      return res.json({ logs: r.rows });
    }

    const db = getDb();
    const users = db.get('users').value();
    let logs = db.get('patrol_logs') ? db.get('patrol_logs').filter(l => l.society_id === societyId).value() : [];
    if (checkpoint_id) logs = logs.filter(l => l.checkpoint_id === checkpoint_id);
    if (guard_id) logs = logs.filter(l => l.scanned_by === guard_id);
    if (date) logs = logs.filter(l => l.scanned_at && l.scanned_at.startsWith(date));
    logs = logs.map(l => {
      const u = users.find(x => x.id === l.scanned_by);
      return { ...l, first_name: u?.first_name, last_name: u?.last_name };
    }).sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch patrol logs' });
  }
};

// GET /api/patrol/summary — today's patrol summary per checkpoint
exports.getSummary = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (isPostgresEnabled) {
      await ensurePatrolTables(societyId);
      const r = await pool.query(`
        SELECT pc.location_name, pc.area, COUNT(pl.id)::int AS scan_count, MAX(pl.scanned_at) AS last_scanned
        FROM \"society_${societyId}\".patrol_checkpoints pc
        LEFT JOIN \"society_${societyId}\".patrol_logs pl ON pl.checkpoint_id=pc.id AND DATE(pl.scanned_at)=CURRENT_DATE
        WHERE pc.society_id=$1 AND pc.is_active=1
        GROUP BY pc.id, pc.location_name, pc.area
        ORDER BY pc.location_name`, [societyId]
      );
      return res.json({ summary: r.rows });
    }
    res.json({ summary: [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get patrol summary' });
  }
};
