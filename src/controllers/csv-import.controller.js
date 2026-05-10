const { v4: uuidv4 } = require('uuid');
const { pool, isPostgresEnabled, withTenant } = require('../config/postgres');
const { isPlatformRole } = require('../constants/roles');
const { logAudit } = require('./audit.controller');

// ─── Import Members from CSV/JSON array ──────────────────────────────
exports.importMembers = async (req, res) => {
  try {
    const role = req.user.role;
    if (!['ADMIN', 'TREASURER'].includes(role) && !isPlatformRole(role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { members, society_id } = req.body;
    const targetSociety = society_id || req.user.society_id;
    if (!targetSociety) return res.status(400).json({ error: 'society_id is required' });
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: 'members array is required' });
    }
    if (members.length > 500) {
      return res.status(400).json({ error: 'Max 500 members per import' });
    }

    const bcrypt = require('bcryptjs');
    const results = { imported: 0, skipped: 0, errors: [] };

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      if (!m.email || !m.first_name) {
        results.errors.push({ row: i + 1, error: 'Missing email or first_name' });
        results.skipped++;
        continue;
      }
      try {
        const existing = await pool.query('SELECT id FROM platform.users WHERE email = $1 LIMIT 1', [m.email.toLowerCase()]);
        if (existing.rows.length) {
          results.errors.push({ row: i + 1, email: m.email, error: 'Email already exists' });
          results.skipped++;
          continue;
        }
        const id = uuidv4();
        const password = await bcrypt.hash(m.password || 'Welcome@123', 10);
        await pool.query(`
          INSERT INTO platform.users (id, email, password, first_name, last_name, role, society_id, flat_number, wing, phone, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        `, [
          id, m.email.toLowerCase(), password,
          m.first_name, m.last_name || null,
          m.role || 'RESIDENT', targetSociety,
          m.flat_number || null, m.wing || null, m.phone || null
        ]);
        results.imported++;
      } catch (err) {
        results.errors.push({ row: i + 1, email: m.email, error: err.message });
        results.skipped++;
      }
    }

    await logAudit(req, 'CSV_IMPORT_MEMBERS', 'IMPORT', targetSociety, null, { imported: results.imported, skipped: results.skipped });
    res.json({ message: `Imported ${results.imported} members`, ...results });
  } catch (error) {
    console.error('Import members error:', error);
    res.status(500).json({ error: 'Failed to import members' });
  }
};

// ─── Import Flats from CSV/JSON array ────────────────────────────────
exports.importFlats = async (req, res) => {
  try {
    const role = req.user.role;
    if (!['ADMIN'].includes(role) && !isPlatformRole(role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { flats, society_id } = req.body;
    const targetSociety = society_id || req.user.society_id;
    if (!targetSociety) return res.status(400).json({ error: 'society_id is required' });
    if (!Array.isArray(flats) || flats.length === 0) {
      return res.status(400).json({ error: 'flats array is required' });
    }

    const results = { imported: 0, skipped: 0, errors: [] };

    for (let i = 0; i < flats.length; i++) {
      const f = flats[i];
      if (!f.flat_number) {
        results.errors.push({ row: i + 1, error: 'Missing flat_number' });
        results.skipped++;
        continue;
      }
      try {
        const id = uuidv4();
        await pool.query(`
          INSERT INTO platform.flats (id, society_id, wing_id, flat_number, floor_number, area_sqft, flat_type, is_occupied, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        `, [id, targetSociety, f.wing_id || null, f.flat_number, f.floor_number || null, f.area_sqft || null, f.flat_type || null, f.is_occupied || 0]);
        results.imported++;
      } catch (err) {
        results.errors.push({ row: i + 1, flat_number: f.flat_number, error: err.message });
        results.skipped++;
      }
    }

    await logAudit(req, 'CSV_IMPORT_FLATS', 'IMPORT', targetSociety, null, { imported: results.imported, skipped: results.skipped });
    res.json({ message: `Imported ${results.imported} flats`, ...results });
  } catch (error) {
    console.error('Import flats error:', error);
    res.status(500).json({ error: 'Failed to import flats' });
  }
};
