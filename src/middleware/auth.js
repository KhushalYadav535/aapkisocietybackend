const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');
const { normalizeRole, MFA_REQUIRED_ROLES } = require('../constants/roles');
const { getTenantSchemaName } = require('../config/postgres');

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

const requirePermission = (permissionCode) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    
    const role = normalizeRole(req.user.role);
    if (role === 'ADMIN' || role === 'PLATFORM_ADMIN') {
      return next();
    }

    const societyId = req.query.society_id || req.body.society_id || req.params.societyId || req.user.society_id;
    if (!societyId) {
      return res.status(400).json({ error: 'society_id context is required for permission check.' });
    }

    try {
      if (!isPostgresEnabled) {
        return next(); // Fallback if no DB
      }

      const schema = getTenantSchemaName(societyId);
      const query = `
        SELECT p.code 
        FROM "${schema}".society_position_assignments spa
        JOIN "${schema}".position_roles pr ON spa.position_id = pr.position_id
        JOIN "${schema}".role_permissions rp ON pr.role_id = rp.role_id
        JOIN "${schema}".permissions p ON rp.permission_id = p.id
        WHERE spa.user_id = $1 
          AND spa.status = 'ACTIVE' 
          AND CURRENT_DATE BETWEEN spa.start_date AND spa.end_date
          AND p.code = $2
        LIMIT 1
      `;
      
      const result = await pool.query(query, [req.user.id, permissionCode]);
      
      if (result.rows.length === 0) {
        return res.status(403).json({ 
          error: 'Insufficient permissions.', 
          code: 'MISSING_PERMISSION', 
          required: permissionCode 
        });
      }
      
      next();
    } catch (err) {
      console.error('Permission check error:', err);
      // Fallback: If tables don't exist yet, we can fallback to role-based for now, or just fail.
      // Failing secure is better.
      return res.status(500).json({ error: 'Internal server error during permission check.' });
    }
  };
};

module.exports = { authenticate, authorize, requireMFA, requirePermission };
