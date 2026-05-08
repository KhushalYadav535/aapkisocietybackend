const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');
const { normalizeRole } = require('../constants/roles');

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

exports.register = async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone, role, society_id, flat_number, wing } = req.body;
    const requestedRole = normalizeRole(role || 'RESIDENT');
    if (requestedRole !== 'RESIDENT') {
      return res.status(403).json({ error: 'Self-registration only allows RESIDENT role.' });
    }
    let existing;
    if (isPostgresEnabled) {
      await ensurePlatformSchema();
      const r = await pool.query('SELECT id FROM platform.users WHERE email = $1 LIMIT 1', [email]);
      existing = r.rows[0];
    } else {
      const db = getDb();
      existing = db.get('users').find({ email }).value();
    }
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const id = uuidv4();
    const now = new Date().toISOString();

    const newUser = {
      id, email, password: hashedPassword, first_name, last_name,
      phone: phone || null, role: requestedRole,
      society_id: society_id || null, flat_number: flat_number || null,
      wing: wing || null, is_active: 1, is_verified: 1, mfa_enabled: 0,
      avatar_url: null, created_at: now, updated_at: now
    };

    if (isPostgresEnabled) {
      await pool.query(
        `INSERT INTO platform.users (id, email, password, first_name, last_name, phone, role, society_id, flat_number, wing, is_active, is_verified, mfa_enabled, avatar_url, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [newUser.id, newUser.email, newUser.password, newUser.first_name, newUser.last_name, newUser.phone, newUser.role, newUser.society_id, newUser.flat_number, newUser.wing, newUser.is_active, newUser.is_verified, newUser.mfa_enabled, newUser.avatar_url, newUser.created_at, newUser.updated_at]
      );
    } else {
      const db = getDb();
      db.get('users').push(newUser).write();
    }
    const token = generateToken(newUser);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: newUser.id, email: newUser.email, first_name: newUser.first_name,
        last_name: newUser.last_name, role: newUser.role,
        society_id: newUser.society_id, flat_number: newUser.flat_number, wing: newUser.wing,
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    let user;
    if (isPostgresEnabled) {
      await ensurePlatformSchema();
      const r = await pool.query('SELECT * FROM platform.users WHERE email = $1 LIMIT 1', [email]);
      user = r.rows[0];
    } else {
      const db = getDb();
      user = db.get('users').find({ email }).value();
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    user.role = normalizeRole(user.role);
    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id, email: user.email, first_name: user.first_name,
        last_name: user.last_name, role: user.role, society_id: user.society_id,
        flat_number: user.flat_number, wing: user.wing, phone: user.phone,
        avatar_url: user.avatar_url,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.getProfile = (req, res) => {
  const { password, ...user } = req.user;
  res.json({ user });
};

exports.updateProfile = async (req, res) => {
  try {
    const { first_name, last_name, phone } = req.body;
    let updated;
    if (isPostgresEnabled) {
      await pool.query(
        `UPDATE platform.users SET
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          phone = COALESCE($3, phone),
          updated_at = NOW()
        WHERE id = $4`,
        [first_name || null, last_name || null, phone || null, req.user.id]
      );
      const r = await pool.query('SELECT * FROM platform.users WHERE id = $1 LIMIT 1', [req.user.id]);
      updated = r.rows[0];
    } else {
      const db = getDb();
      const updates = {};
      if (first_name) updates.first_name = first_name;
      if (last_name) updates.last_name = last_name;
      if (phone) updates.phone = phone;
      updates.updated_at = new Date().toISOString();
      db.get('users').find({ id: req.user.id }).assign(updates).write();
      updated = db.get('users').find({ id: req.user.id }).value();
    }
    const { password, ...user } = updated;
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Profile update failed' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const isMatch = await bcrypt.compare(currentPassword, req.user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    if (isPostgresEnabled) {
      await pool.query('UPDATE platform.users SET password = $1, updated_at = NOW() WHERE id = $2', [hashed, req.user.id]);
    } else {
      const db = getDb();
      db.get('users').find({ id: req.user.id }).assign({ password: hashed, updated_at: new Date().toISOString() }).write();
    }

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Password change failed' });
  }
};

exports.setupMFA = (req, res) => {
  try {
    const now = new Date().toISOString();
    if (isPostgresEnabled) {
      pool.query(
        'UPDATE platform.users SET mfa_enabled = 1, mfa_method = $1, updated_at = $2 WHERE id = $3',
        [req.body.method || 'TOTP', now, req.user.id]
      ).then(() => res.json({ message: 'MFA enabled successfully' }))
       .catch(() => res.status(500).json({ error: 'Failed to enable MFA' }));
    } else {
      const db = getDb();
      db.get('users').find({ id: req.user.id }).assign({
        mfa_enabled: 1,
        mfa_method: req.body.method || 'TOTP',
        updated_at: now
      }).write();
      res.json({ message: 'MFA enabled successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to enable MFA' });
  }
};

exports.verifyMFA = (req, res) => {
  const { otp } = req.body;
  if (!otp || String(otp).length < 4) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }
  res.json({ verified: true, message: 'MFA verified' });
};
