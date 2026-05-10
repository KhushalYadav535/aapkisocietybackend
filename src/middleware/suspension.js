const { pool, isPostgresEnabled } = require('../config/postgres');
const { isPlatformRole } = require('../constants/roles');

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const enforceSuspension = async (req, res, next) => {
  try {
    if (!isPostgresEnabled || !pool) return next();
    if (isPlatformRole(req.user?.role)) return next();
    if (READ_METHODS.includes(req.method)) return next();

    const societyId = req.user?.society_id;
    if (!societyId) return next();

    const result = await pool.query(
      'SELECT subscription_status FROM platform.societies WHERE id = $1 LIMIT 1',
      [societyId]
    );
    const status = result.rows[0]?.subscription_status;

    if (status === 'SUSPENDED') {
      return res.status(403).json({
        error: 'Society subscription is suspended. Only read access is allowed.',
        code: 'SOCIETY_SUSPENDED'
      });
    }

    if (status === 'OFFBOARDED') {
      return res.status(403).json({
        error: 'Society has been discontinued. Contact platform admin to reactivate.',
        code: 'SOCIETY_OFFBOARDED'
      });
    }

    next();
  } catch (err) {
    console.error('[Suspension middleware]', err.message);
    next();
  }
};

module.exports = { enforceSuspension };
