const { getDb } = require('../config/database');

const requireFeature = (featureKey) => {
  return (req, res, next) => {
    if (req.user.role === 'PLATFORM_ADMIN') return next();
    const db = getDb();
    const societyId = req.user.society_id;
    const override = db.get('feature_flags').find({ feature_key: featureKey, society_id: societyId }).value();
    const enabled = override ? !!override.enabled : true;
    if (!enabled) {
      return res.status(403).json({
        error: `This feature requires upgrade or enablement: ${featureKey}`,
        code: 'FEATURE_DISABLED',
        feature_key: featureKey
      });
    }
    next();
  };
};

module.exports = { requireFeature };
