const requireTenantContext = (req, res, next) => {
  if (req.user.role === 'PLATFORM_ADMIN') return next();
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
