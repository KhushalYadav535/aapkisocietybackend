const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');
const { normalizeRole, MFA_REQUIRED_ROLES } = require('../constants/roles');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    let user;
    if (isPostgresEnabled) {
      await ensurePlatformSchema();
      const r = await pool.query('SELECT * FROM platform.users WHERE id = $1 AND is_active = 1 LIMIT 1', [decoded.id]);
      user = r.rows[0];
    } else {
      const db = getDb();
      user = db.get('users').find({ id: decoded.id, is_active: 1 }).value();
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token or user deactivated.' });
    }

    user.role = normalizeRole(user.role);
    const mfaExempt = ['/api/auth/mfa/setup', '/api/auth/mfa/verify', '/api/auth/me', '/api/auth/login', '/mfa/setup', '/mfa/verify', '/me', '/login'];
    if (MFA_REQUIRED_ROLES.includes(user.role) && !user.mfa_enabled && !mfaExempt.includes(req.path)) {
      return res.status(403).json({
        error: 'MFA setup required for this role.',
        code: 'MFA_REQUIRED',
        setup_path: '/api/auth/mfa/setup'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const allowed = roles.map(normalizeRole);
    const userRole = normalizeRole(req.user.role);
    if (!allowed.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
};

const requireMFA = (req, res, next) => {
  req.user.role = normalizeRole(req.user.role);
  const exemptPaths = ['/api/auth/mfa/setup', '/api/auth/mfa/verify', '/api/auth/me', '/mfa/setup', '/mfa/verify', '/me'];
  if (MFA_REQUIRED_ROLES.includes(req.user.role) && !req.user.mfa_enabled && !exemptPaths.includes(req.path)) {
    return res.status(403).json({
      error: 'MFA setup required for this role.',
      code: 'MFA_REQUIRED',
      setup_path: '/api/auth/mfa/setup'
    });
  }
  next();
};

module.exports = { authenticate, authorize, requireMFA };
