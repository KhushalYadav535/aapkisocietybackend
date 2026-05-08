const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');

exports.token = (req, res) => {
  const { client_id, client_secret, grant_type = 'client_credentials', scope = '' } = req.body;
  if (grant_type !== 'client_credentials') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  const db = getDb();
  const client = db.get('oauth_clients').find({ client_id, client_secret, is_active: 1 }).value();
  if (!client) return res.status(401).json({ error: 'invalid_client' });

  const token = jwt.sign({
    sub: client_id,
    tenant: client.society_id || null,
    scope
  }, process.env.JWT_SECRET, { expiresIn: '1h' });

  db.get('access_tokens').push({
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    client_id,
    token,
    scope,
    created_at: new Date().toISOString()
  }).write();

  res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope });
};
