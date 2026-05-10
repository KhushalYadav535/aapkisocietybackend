const jwt = require('jsonwebtoken');

const requireMfaReauth = (req, res, next) => {
  const reauthToken = req.headers['x-mfa-reauth'];
  if (!reauthToken) {
    return res.status(403).json({
      error: 'This action requires MFA re-authentication.',
      code: 'MFA_REAUTH_REQUIRED'
    });
  }
  try {
    const decoded = jwt.verify(reauthToken, process.env.JWT_SECRET);
    if (decoded.purpose !== 'mfa_reauth') {
      return res.status(403).json({ error: 'Invalid MFA re-auth token' });
    }
    if (decoded.id !== req.user.id) {
      return res.status(403).json({ error: 'MFA token user mismatch' });
    }
    const ageMs = Date.now() - (decoded.iat * 1000);
    if (ageMs > 5 * 60 * 1000) {
      return res.status(403).json({ error: 'MFA re-auth token expired. Please re-authenticate.' });
    }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired MFA re-auth token' });
  }
};

module.exports = { requireMfaReauth };
