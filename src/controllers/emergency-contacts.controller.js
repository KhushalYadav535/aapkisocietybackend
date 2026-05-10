const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled } = require('../config/postgres');

const ensureContactTables = async (societyId) => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS society_${societyId}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS society_${societyId}.emergency_contacts (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      alternate_phone TEXT,
      notes TEXT,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

// GET /api/emergency-contacts
exports.getAll = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (isPostgresEnabled) {
      await ensureContactTables(societyId);
      const r = await pool.query(
        `SELECT * FROM society_${societyId}.emergency_contacts WHERE society_id=$1 AND is_active=1 ORDER BY display_order, category, name`,
        [societyId]
      );
      return res.json({ contacts: r.rows });
    }
    const db = getDb();
    const contacts = db.get('emergency_contacts') ? db.get('emergency_contacts').filter(c => c.society_id === societyId && c.is_active !== 0).sortBy(['display_order', 'category', 'name']).value() : [];
    res.json({ contacts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch emergency contacts' });
  }
};

// POST /api/emergency-contacts
exports.create = async (req, res) => {
  try {
    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });

    const { category, name, phone, alternate_phone, notes, display_order } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();
    const id = uuidv4();
    const contact = { id, society_id: societyId, category, name, phone, alternate_phone: alternate_phone || null, notes: notes || null, display_order: display_order || 0, is_active: 1, created_by: req.user.id, created_at: now, updated_at: now };

    if (isPostgresEnabled) {
      await ensureContactTables(societyId);
      await pool.query(
        `INSERT INTO society_${societyId}.emergency_contacts (id,society_id,category,name,phone,alternate_phone,notes,display_order,is_active,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, societyId, category, name, phone, alternate_phone || null, notes || null, display_order || 0, 1, req.user.id, now, now]
      );
      return res.status(201).json({ contact });
    }

    const db = getDb();
    if (!db.get('emergency_contacts').value()) db.set('emergency_contacts', []).write();
    db.get('emergency_contacts').push(contact).write();
    res.status(201).json({ contact });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create emergency contact' });
  }
};

// PUT /api/emergency-contacts/:id
exports.update = async (req, res) => {
  try {
    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });

    const { id } = req.params;
    const { category, name, phone, alternate_phone, notes, display_order } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      await ensureContactTables(societyId);
      await pool.query(
        `UPDATE society_${societyId}.emergency_contacts SET category=$1,name=$2,phone=$3,alternate_phone=$4,notes=$5,display_order=$6,updated_at=$7 WHERE id=$8`,
        [category, name, phone, alternate_phone || null, notes || null, display_order || 0, now, id]
      );
      const r = await pool.query(`SELECT * FROM society_${societyId}.emergency_contacts WHERE id=$1`, [id]);
      return res.json({ contact: r.rows[0] });
    }

    const db = getDb();
    db.get('emergency_contacts').find({ id }).assign({ category, name, phone, alternate_phone: alternate_phone || null, notes: notes || null, display_order: display_order || 0, updated_at: now }).write();
    res.json({ contact: db.get('emergency_contacts').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update emergency contact' });
  }
};

// DELETE /api/emergency-contacts/:id
exports.remove = async (req, res) => {
  try {
    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });

    const { id } = req.params;
    const societyId = req.user.society_id;
    if (isPostgresEnabled) {
      await ensureContactTables(societyId);
      await pool.query(`UPDATE society_${societyId}.emergency_contacts SET is_active=0 WHERE id=$1`, [id]);
      return res.json({ message: 'Contact removed' });
    }
    const db = getDb();
    db.get('emergency_contacts').find({ id }).assign({ is_active: 0 }).write();
    res.json({ message: 'Contact removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove contact' });
  }
};
