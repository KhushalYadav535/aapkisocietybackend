const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureFeatureTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      feature_key TEXT,
      enabled BOOLEAN DEFAULT true,
      reason TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getFlags = (req, res) => {
  if (isPostgresEnabled && req.user.society_id) {
    const societyId = req.query.society_id || req.user.society_id;
    return withTenant(societyId, async (client) => {
      await ensureFeatureTable(client);
      const r = await client.query('SELECT * FROM feature_flags WHERE society_id = $1', [societyId]);
      return res.json({ flags: r.rows });
    }).catch(() => res.status(500).json({ error: 'Failed to fetch feature flags' }));
  }
  const db = getDb();
  const societyId = req.query.society_id || req.user.society_id;
  const flags = db.get('feature_flags').filter({ society_id: societyId }).value();
  res.json({ flags });
};

exports.upsertFlag = (req, res) => {
  if (isPostgresEnabled && req.user.society_id) {
    const { society_id, feature_key, enabled, reason } = req.body;
    const societyId = society_id || req.user.society_id;
    return withTenant(societyId, async (client) => {
      await ensureFeatureTable(client);
      const now = new Date().toISOString();
      const existing = await client.query('SELECT id FROM feature_flags WHERE society_id = $1 AND feature_key = $2 LIMIT 1', [societyId, feature_key]);
      if (existing.rows[0]) {
        await client.query(
          'UPDATE feature_flags SET enabled = $1, reason = $2, updated_by = $3, updated_at = $4 WHERE id = $5',
          [!!enabled, reason || null, req.user.id, now, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO feature_flags (id,society_id,feature_key,enabled,reason,created_by,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
          [uuidv4(), societyId, feature_key, !!enabled, reason || null, req.user.id, now]
        );
      }
      const r = await client.query('SELECT * FROM feature_flags WHERE society_id = $1 AND feature_key = $2 LIMIT 1', [societyId, feature_key]);
      return res.json({ flag: r.rows[0] });
    }).catch(() => res.status(500).json({ error: 'Failed to upsert feature flag' }));
  }
  const db = getDb();
  const { society_id, feature_key, enabled, reason } = req.body;
  const societyId = society_id || req.user.society_id;
  const now = new Date().toISOString();
  const existing = db.get('feature_flags').find({ society_id: societyId, feature_key }).value();

  if (existing) {
    db.get('feature_flags').find({ id: existing.id }).assign({
      enabled: !!enabled,
      reason: reason || null,
      updated_by: req.user.id,
      updated_at: now
    }).write();
  } else {
    db.get('feature_flags').push({
      id: uuidv4(),
      society_id: societyId,
      feature_key,
      enabled: !!enabled,
      reason: reason || null,
      created_by: req.user.id,
      created_at: now,
      updated_at: now
    }).write();
  }
  const flag = db.get('feature_flags').find({ society_id: societyId, feature_key }).value();
  res.json({ flag });
};
