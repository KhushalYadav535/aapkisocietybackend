const { pool, isPostgresEnabled } = require('../config/postgres');
const { getDb } = require('../config/database');

const requireTenantContext = async (req, res, next) => {
  if (req.user.role === 'PLATFORM_ADMIN') return next();

  // If user has no society_id, attempt to auto-resolve to active society
  if (!req.user.society_id) {
    try {
      if (isPostgresEnabled && pool) {
        const defaultSoc = await pool.query(
          "SELECT id FROM platform.societies WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1"
        );
        if (defaultSoc.rows.length > 0) {
          req.user.society_id = defaultSoc.rows[0].id;
          await pool.query('UPDATE platform.users SET society_id = $1, updated_at = NOW() WHERE id = $2', [req.user.society_id, req.user.id]);
        }
      } else {
        const db = getDb();
        const defaultSoc = db.get('societies').find({ status: 'ACTIVE' }).value();
        if (defaultSoc) {
          req.user.society_id = defaultSoc.id;
          db.get('users').find({ id: req.user.id }).assign({ society_id: defaultSoc.id }).write();
        }
      }
    } catch (e) {
      console.error('Failed to auto-resolve tenant context in requireTenantContext:', e);
    }
  }

  if (!req.user.society_id) {
    return res.status(400).json({ error: 'Tenant context missing for user' });
  }
  const requestedTenant = req.headers['x-tenant-id'];
  if (requestedTenant && requestedTenant !== req.user.society_id) {
    return res.status(403).json({ error: 'Cross-tenant access denied' });
  }
  next();
};

module.exports = { requireTenantContext };
