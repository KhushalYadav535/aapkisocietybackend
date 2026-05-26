const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');
const { normalizeRole, canAssignRole } = require('../constants/roles');

const safeUser = (u) => ({ id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, phone: u.phone, role: u.role, society_id: u.society_id, flat_number: u.flat_number, wing: u.wing, is_active: u.is_active, created_at: u.created_at });

exports.getAll = (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    if (isPostgresEnabled) {
      return (async () => {
        const cols = 'id,email,first_name,last_name,phone,role,society_id,flat_number,wing,is_active,created_at';
        let query, countQuery, params, countParams;
        if (req.user.role !== 'PLATFORM_ADMIN') {
          query = `SELECT ${cols} FROM platform.users WHERE society_id = $1 ORDER BY flat_number ASC LIMIT $2 OFFSET $3`;
          countQuery = 'SELECT COUNT(*)::int AS total FROM platform.users WHERE society_id = $1';
          params = [req.user.society_id, limit, offset];
          countParams = [req.user.society_id];
        } else {
          query = `SELECT ${cols} FROM platform.users ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
          countQuery = 'SELECT COUNT(*)::int AS total FROM platform.users';
          params = [limit, offset];
          countParams = [];
        }
        const [r, cR] = await Promise.all([
          pool.query(query, params),
          pool.query(countQuery, countParams)
        ]);
        const total = cR.rows[0]?.total || 0;
        return res.json({ members: r.rows.map(safeUser), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
      })().catch(() => res.status(500).json({ error: 'Failed to fetch members' }));
    }
    const db = getDb();
    let members;
    if (req.user.role === 'PLATFORM_ADMIN') {
      members = db.get('users').sortBy('created_at').reverse().value().map(safeUser);
    } else {
      members = db.get('users').filter({ society_id: req.user.society_id }).sortBy('flat_number').value().map(safeUser);
    }
    const total = members.length;
    const paginated = members.slice(offset, offset + limit);
    res.json({ members: paginated, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
};

exports.getById = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return (async () => {
        const r = await pool.query('SELECT * FROM platform.users WHERE id = $1 LIMIT 1', [req.params.id]);
        const member = r.rows[0];
        if (!member) return res.status(404).json({ error: 'Member not found' });
        return res.json({ member: safeUser(member) });
      })().catch(() => res.status(500).json({ error: 'Failed to fetch member' }));
    }
    const db = getDb();
    const member = db.get('users').find({ id: req.params.id }).value();
    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json({ member: safeUser(member) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch member' });
  }
};

exports.create = async (req, res) => {
  try {
    const { email, first_name, last_name, phone, role, flat_number, wing, password } = req.body;
    const normalizedRole = normalizeRole(role || 'RESIDENT');
    if (!canAssignRole(req.user.role, normalizedRole)) {
      return res.status(403).json({ error: `You cannot assign role: ${normalizedRole}` });
    }
    if (isPostgresEnabled) {
      const r = await pool.query('SELECT id FROM platform.users WHERE email = $1 LIMIT 1', [email]);
      if (r.rows[0]) return res.status(409).json({ error: 'Email already registered' });
    } else {
      const db = getDb();
      const existing = db.get('users').find({ email }).value();
      if (existing) return res.status(409).json({ error: 'Email already registered' });
    }

    const plaintext = String(password || '').trim();
    const effectivePassword = plaintext.length >= 6 ? plaintext : 'Welcome@123';
    const passwordHash = await bcrypt.hash(effectivePassword, 12);
    const now = new Date().toISOString();
    const newUser = {
      id: uuidv4(), email, password: passwordHash, first_name, last_name,
      phone: phone || null, role: normalizedRole, society_id: req.user.society_id,
      flat_number, wing: wing || null, is_active: 1, is_verified: 1, mfa_enabled: 0,
      avatar_url: null, created_at: now, updated_at: now
    };
    if (isPostgresEnabled) {
      await pool.query(
        `INSERT INTO platform.users (id,email,password,first_name,last_name,phone,role,society_id,flat_number,wing,is_active,is_verified,mfa_enabled,avatar_url,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [newUser.id, newUser.email, newUser.password, newUser.first_name, newUser.last_name, newUser.phone, newUser.role, newUser.society_id, newUser.flat_number, newUser.wing, newUser.is_active, newUser.is_verified, newUser.mfa_enabled, newUser.avatar_url, newUser.created_at, newUser.updated_at]
      );
    } else {
      const db = getDb();
      db.get('users').push(newUser).write();
    }
    res.status(201).json({
      member: safeUser(newUser),
      message: plaintext.length >= 6
        ? 'Member created.'
        : 'Member created with default password: Welcome@123'
    });
  } catch (error) {
    console.error('Create member error:', error);
    res.status(500).json({ error: 'Failed to create member' });
  }
};

exports.update = (req, res) => {
  try {
    if (req.body.role !== undefined) {
      const normalizedRole = normalizeRole(req.body.role);
      if (!canAssignRole(req.user.role, normalizedRole)) {
        return res.status(403).json({ error: `You cannot assign role: ${normalizedRole}` });
      }
      req.body.role = normalizedRole;
    }

    if (isPostgresEnabled) {
      return (async () => {
        const fields = ['first_name', 'last_name', 'phone', 'role', 'flat_number', 'wing'];
        const setParts = [];
        const values = [];
        fields.forEach((f) => {
          if (req.body[f] !== undefined) {
            values.push(req.body[f]);
            setParts.push(`${f} = $${values.length}`);
          }
        });
        values.push(req.params.id);
        const setClause = setParts.length ? `${setParts.join(', ')}, updated_at = NOW()` : 'updated_at = NOW()';
        await pool.query(`UPDATE platform.users SET ${setClause} WHERE id = $${values.length}`, values);
        const r = await pool.query('SELECT * FROM platform.users WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ member: safeUser(r.rows[0]) });
      })().catch(() => res.status(500).json({ error: 'Failed to update member' }));
    }
    const db = getDb();
    const updates = {};
    ['first_name', 'last_name', 'phone', 'role', 'flat_number', 'wing'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    updates.updated_at = new Date().toISOString();
    db.get('users').find({ id: req.params.id }).assign(updates).write();
    const member = db.get('users').find({ id: req.params.id }).value();
    res.json({ member: safeUser(member) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update member' });
  }
};

exports.deactivate = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return (async () => {
        await pool.query('UPDATE platform.users SET is_active = 0, updated_at = NOW() WHERE id = $1', [req.params.id]);
        return res.json({ message: 'Member deactivated successfully' });
      })().catch(() => res.status(500).json({ error: 'Failed to deactivate member' }));
    }
    const db = getDb();
    db.get('users').find({ id: req.params.id }).assign({ is_active: 0, updated_at: new Date().toISOString() }).write();
    res.json({ message: 'Member deactivated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate member' });
  }
};

exports.transferOwnership = (req, res) => {
  try {
    res.json({ message: 'Ownership transfer initiated', status: 'PENDING_REVIEW' });
  } catch (error) {
    res.status(500).json({ error: 'Transfer failed' });
  }
};
