const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');

const ensurePrivacyTables = async () => {
  if (!isPostgresEnabled) return;
  await ensurePlatformSchema();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.consent_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      consent JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.privacy_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      society_id TEXT,
      type TEXT,
      status TEXT,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.updateConsent = (req, res) => {
  if (isPostgresEnabled) {
    return ensurePrivacyTables().then(async () => {
      const now = new Date().toISOString();
      const { billing_comms = true, statutory_notices = true, marketing = false } = req.body;
      const consent = { billing_comms, statutory_notices, marketing };
      await pool.query(
        'UPDATE platform.users SET consent = $1::jsonb, updated_at = $2 WHERE id = $3',
        [JSON.stringify(consent), now, req.user.id]
      ).catch(async () => {
        await pool.query('ALTER TABLE platform.users ADD COLUMN IF NOT EXISTS consent JSONB DEFAULT \'{}\'::jsonb');
        await pool.query('UPDATE platform.users SET consent = $1::jsonb, updated_at = $2 WHERE id = $3', [JSON.stringify(consent), now, req.user.id]);
      });
      await pool.query(
        'INSERT INTO platform.consent_logs (id,user_id,consent,updated_at) VALUES ($1,$2,$3::jsonb,$4)',
        [uuidv4(), req.user.id, JSON.stringify(consent), now]
      );
      return res.json({ message: 'Consent updated' });
    }).catch(() => res.status(500).json({ error: 'Failed to update consent' }));
  }
  const db = getDb();
  const now = new Date().toISOString();
  const { billing_comms = true, statutory_notices = true, marketing = false } = req.body;
  db.get('users').find({ id: req.user.id }).assign({
    consent: { billing_comms, statutory_notices, marketing },
    updated_at: now
  }).write();
  db.get('consent_logs').push({
    id: uuidv4(),
    user_id: req.user.id,
    consent: { billing_comms, statutory_notices, marketing },
    updated_at: now
  }).write();
  res.json({ message: 'Consent updated' });
};

exports.getConsent = (req, res) => {
  if (isPostgresEnabled) {
    return ensurePrivacyTables().then(async () => {
      const r = await pool.query('SELECT consent FROM platform.users WHERE id = $1 LIMIT 1', [req.user.id]);
      const consent = r.rows[0]?.consent || { billing_comms: true, statutory_notices: true, marketing: false };
      return res.json({ consent });
    }).catch(() => res.status(500).json({ error: 'Failed to fetch consent' }));
  }
  const db = getDb();
  const user = db.get('users').find({ id: req.user.id }).value();
  res.json({ consent: user?.consent || { billing_comms: true, statutory_notices: true, marketing: false } });
};

exports.createErasureRequest = (req, res) => {
  if (isPostgresEnabled) {
    return ensurePrivacyTables().then(async () => {
      const request = {
        id: uuidv4(),
        user_id: req.user.id,
        society_id: req.user.society_id,
        type: req.body.type || 'ERASURE',
        status: 'PENDING',
        reason: req.body.reason || null,
        created_at: new Date().toISOString()
      };
      await pool.query(
        `INSERT INTO platform.privacy_requests (id,user_id,society_id,type,status,reason,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [request.id, request.user_id, request.society_id, request.type, request.status, request.reason, request.created_at]
      );
      return res.status(201).json({ request });
    }).catch(() => res.status(500).json({ error: 'Failed to create privacy request' }));
  }
  const db = getDb();
  const request = {
    id: uuidv4(),
    user_id: req.user.id,
    society_id: req.user.society_id,
    type: req.body.type || 'ERASURE',
    status: 'PENDING',
    reason: req.body.reason || null,
    created_at: new Date().toISOString()
  };
  db.get('privacy_requests').push(request).write();
  res.status(201).json({ request });
};
