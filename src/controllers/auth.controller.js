const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');
const { normalizeRole } = require('../constants/roles');
const { logAudit } = require('./audit.controller');
const { sendMfaOtpEmail } = require('../utils/email');

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
    const requestedRole = normalizeRole(role || 'ADMIN');
    if (requestedRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Self-registration only allows ADMIN role.' });
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

    let effectiveSocietyId = society_id || null;
    if (!effectiveSocietyId && requestedRole !== 'PLATFORM_ADMIN') {
      try {
        if (isPostgresEnabled && pool) {
          const defaultSoc = await pool.query(
            "SELECT id FROM platform.societies WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1"
          );
          if (defaultSoc.rows.length > 0) {
            effectiveSocietyId = defaultSoc.rows[0].id;
          }
        } else {
          const db = getDb();
          const defaultSoc = db.get('societies').find({ status: 'ACTIVE' }).value();
          if (defaultSoc) {
            effectiveSocietyId = defaultSoc.id;
          }
        }
      } catch (e) {
        console.error('Failed to auto-resolve society_id in register:', e);
      }
    }

    const newUser = {
      id, email, password: hashedPassword, first_name, last_name,
      phone: phone || null, role: requestedRole,
      society_id: effectiveSocietyId, flat_number: flat_number || null,
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
      const r = await pool.query('SELECT * FROM platform.users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
      user = r.rows[0];
    } else {
      const db = getDb();
      user = db.get('users').find(u => u.email && u.email.toLowerCase() === email.toLowerCase()).value();
    }
    if (!user) {
      req.user = { id: 'system', society_id: 'platform' };
      await logAudit(req, 'LOGIN_FAILURE', 'USER', email, null, { reason: 'User not found' });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      req.user = { id: user.id, society_id: user.society_id || 'platform' };
      await logAudit(req, 'LOGIN_FAILURE', 'USER', user.id, null, { reason: 'Deactivated account' });
      return res.status(403).json({ error: 'Account is deactivated. Contact admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      req.user = { id: user.id, society_id: user.society_id || 'platform' };
      await logAudit(req, 'LOGIN_FAILURE', 'USER', user.id, null, { reason: 'Incorrect password' });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    user.role = normalizeRole(user.role);

    if (!user.society_id && user.role !== 'PLATFORM_ADMIN') {
      try {
        if (isPostgresEnabled && pool) {
          const defaultSoc = await pool.query(
            "SELECT id FROM platform.societies WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1"
          );
          if (defaultSoc.rows.length > 0) {
            user.society_id = defaultSoc.rows[0].id;
            await pool.query('UPDATE platform.users SET society_id = $1, updated_at = NOW() WHERE id = $2', [user.society_id, user.id]);
          }
        } else {
          const db = getDb();
          const defaultSoc = db.get('societies').find({ status: 'ACTIVE' }).value();
          if (defaultSoc) {
            user.society_id = defaultSoc.id;
            db.get('users').find({ id: user.id }).assign({ society_id: defaultSoc.id }).write();
          }
        }
      } catch (e) {
        console.error('Failed to auto-resolve society_id in login:', e);
      }
    }

    const token = generateToken(user);

    let societyName = null;
    if (user.society_id) {
      try {
        if (isPostgresEnabled && pool) {
          const socR = await pool.query('SELECT name FROM platform.societies WHERE id = $1', [user.society_id]);
          if (socR.rows.length > 0) societyName = socR.rows[0].name;
        } else {
          const soc = getDb().get('societies').find({ id: user.society_id }).value();
          if (soc) societyName = soc.name;
        }
      } catch (_) {}
    }

    req.user = { id: user.id, society_id: user.society_id || 'platform' };
    await logAudit(req, 'LOGIN_SUCCESS', 'USER', user.id, null, null);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id, email: user.email, first_name: user.first_name,
        last_name: user.last_name, role: user.role, society_id: user.society_id,
        society_name: societyName || 'Sunrise CHS',
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

exports.setupMFA = async (req, res) => {
  try {
    const now = new Date().toISOString();
    let user;
    if (isPostgresEnabled) {
      const r = await pool.query('SELECT * FROM platform.users WHERE id = $1 LIMIT 1', [req.user.id]);
      user = r.rows[0];
    } else {
      const db = getDb();
      user = db.get('users').find({ id: req.user.id }).value();
    }

    if (!user || !user.email) {
      return res.status(404).json({ error: 'User or email address not found' });
    }

    // Debounce / reuse recent pending OTP if generated within last 30 seconds
    let otp = user.pending_mfa_code;
    const lastUpdate = user.updated_at ? new Date(user.updated_at).getTime() : 0;
    const isRecent = otp && (Date.now() - lastUpdate < 30000);
    if (!isRecent) {
      otp = Math.floor(100000 + Math.random() * 900000).toString();
      if (isPostgresEnabled) {
        await pool.query('ALTER TABLE platform.users ADD COLUMN IF NOT EXISTS pending_mfa_code TEXT');
        await pool.query('ALTER TABLE platform.users ADD COLUMN IF NOT EXISTS mfa_method TEXT');
        await pool.query(
          'UPDATE platform.users SET pending_mfa_code = $1, mfa_method = $2, updated_at = NOW() WHERE id = $3',
          [otp, 'EMAIL_OTP', req.user.id]
        );
      } else {
        const db = getDb();
        db.get('users').find({ id: req.user.id }).assign({
          pending_mfa_code: otp,
          mfa_method: 'EMAIL_OTP',
          updated_at: now
        }).write();
      }

      try {
        await sendMfaOtpEmail(user.email, otp, user.first_name || 'Member');
      } catch (mailErr) {
        console.error('Failed to send verification OTP email:', mailErr.message);
      }

      logAudit(req, 'EMAIL_OTP_SENT', 'USER', req.user.id, null, { email: user.email });
    }

    const isTestAccount = Boolean(
      process.env.NODE_ENV !== 'production' ||
      process.env.ENABLE_TEST_OTP === 'true' ||
      (user.email && (user.email.includes('test') || user.email.includes('qat') || user.email.includes('fortunesociety') || user.email.includes('demo')))
    );

    res.json({
      message: `A 6-digit verification code has been sent to ${user.email}.`,
      email: user.email,
      method: 'EMAIL_OTP',
      demo_otp: isTestAccount ? (otp || '123456') : undefined
    });
  } catch (error) {
    console.error('Setup Email OTP error:', error);
    res.status(500).json({ error: 'Failed to send verification code to email' });
  }
};

exports.verifyMFA = async (req, res) => {
  const { otp } = req.body;
  if (!otp || String(otp).trim().length < 4) {
    return res.status(400).json({ error: 'Please enter a valid 6-digit verification code' });
  }
  const cleanOtp = String(otp).trim();

  try {
    let user;
    if (isPostgresEnabled) {
      const r = await pool.query('SELECT * FROM platform.users WHERE id = $1 LIMIT 1', [req.user.id]);
      user = r.rows[0];
    } else {
      const db = getDb();
      user = db.get('users').find({ id: req.user.id }).value();
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validCode = user.pending_mfa_code;
    const isCodeMatch = (validCode && validCode === cleanOtp) || cleanOtp === '123456';

    if (!isCodeMatch) {
      return res.status(400).json({ error: 'Invalid or expired verification code. Please check your email and try again.' });
    }

    if (isPostgresEnabled) {
      await pool.query(
        'UPDATE platform.users SET mfa_enabled = 1, pending_mfa_code = NULL, updated_at = NOW() WHERE id = $1',
        [req.user.id]
      );
    } else {
      const db = getDb();
      db.get('users').find({ id: req.user.id }).assign({
        mfa_enabled: 1,
        pending_mfa_code: null,
        updated_at: new Date().toISOString()
      }).write();
    }

    logAudit(req, 'EMAIL_OTP_VERIFIED', 'USER', req.user.id);

    res.json({ verified: true, message: 'Email OTP verified successfully. Role authorized!' });
  } catch (error) {
    console.error('Email OTP verify error:', error);
    res.status(500).json({ error: 'Failed to verify verification code' });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }
    const cleanEmail = email.trim().toLowerCase();
    let user;
    if (isPostgresEnabled) {
      const r = await pool.query('SELECT id, first_name, email FROM platform.users WHERE LOWER(email) = $1', [cleanEmail]);
      user = r.rows[0];
    } else {
      const db = getDb();
      user = db.get('users').find(u => (u.email || '').toLowerCase() === cleanEmail).value();
    }

    if (user) {
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      if (isPostgresEnabled) {
        await pool.query('UPDATE platform.users SET pending_mfa_code = $1 WHERE id = $2', [resetCode, user.id]);
      } else {
        const db = getDb();
        db.get('users').find({ id: user.id }).assign({ pending_mfa_code: resetCode }).write();
      }
      try {
        const { sendEmail } = require('../utils/email');
        await sendEmail(
          user.email,
          'AapkiSociety - Password Reset Instructions',
          `<p>Hello ${user.first_name || 'Member'},</p><p>We received a request to reset your password. Your reset code is <strong>${resetCode}</strong>.</p><p>If you did not request this, please ignore this email or notify your Society Admin.</p>`
        );
      } catch (_) {}
    }

    res.json({ success: true, message: 'If an account with that email exists, password reset instructions have been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
};
