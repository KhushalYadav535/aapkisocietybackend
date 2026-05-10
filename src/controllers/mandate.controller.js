const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, withTenant } = require('../config/postgres');

const ensureMandateTables = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mandates (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      member_id TEXT,
      type TEXT,
      amount_limit NUMERIC,
      status TEXT,
      provider_ref TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getMandates = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureMandateTables(client);
        let query = 'SELECT * FROM mandates WHERE society_id = $1 ORDER BY created_at DESC';
        let params = [req.user.society_id];
        if (req.user.role === 'RESIDENT') {
          query = 'SELECT * FROM mandates WHERE member_id = $1 ORDER BY created_at DESC';
          params = [req.user.id];
        }
        const r = await client.query(query, params);
        return res.json({ mandates: r.rows });
      }).catch((err) => { console.error('Mandate error:', err); return res.status(500).json({ error: 'Failed to fetch mandates' }); });
    }
    
    const db = getDb();
    let mandates;
    if (req.user.role === 'RESIDENT') {
      mandates = db.get('mandates').filter({ member_id: req.user.id }).value() || [];
    } else {
      mandates = db.get('mandates').filter({ society_id: req.user.society_id }).value() || [];
    }
    res.json({ mandates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch mandates' });
  }
};

exports.createMandate = (req, res) => {
  try {
    const now = new Date().toISOString();
    const mandate = {
      id: uuidv4(),
      society_id: req.user.society_id,
      member_id: req.user.id,
      type: req.body.type || 'UPI_AUTOPAY',
      amount_limit: Number(req.body.amount_limit || 0),
      status: 'ACTIVE',
      provider_ref: req.body.provider_ref || null,
      created_at: now,
      updated_at: now
    };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureMandateTables(client);
        await client.query(
          `INSERT INTO mandates (id, society_id, member_id, type, amount_limit, status, provider_ref, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [mandate.id, mandate.society_id, mandate.member_id, mandate.type, mandate.amount_limit, mandate.status, mandate.provider_ref, mandate.created_at, mandate.updated_at]
        );
        return res.status(201).json({ mandate });
      }).catch((err) => { console.error('Create mandate error:', err); return res.status(500).json({ error: 'Failed to create mandate' }); });
    }

    const db = getDb();
    db.get('mandates').push(mandate).write();
    res.status(201).json({ mandate });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create mandate' });
  }
};

exports.updateMandateStatus = (req, res) => {
  try {
    const status = req.body.status;
    const now = new Date().toISOString();

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureMandateTables(client);
        await client.query(`UPDATE mandates SET status = $1, updated_at = $2 WHERE id = $3`, [status, now, req.params.id]);
        const r = await client.query(`SELECT * FROM mandates WHERE id = $1`, [req.params.id]);
        return res.json({ mandate: r.rows[0] });
      }).catch((err) => { console.error('Update mandate error:', err); return res.status(500).json({ error: 'Failed to update mandate' }); });
    }

    const db = getDb();
    db.get('mandates').find({ id: req.params.id }).assign({ status, updated_at: now }).write();
    const mandate = db.get('mandates').find({ id: req.params.id }).value();
    if (!mandate) return res.status(404).json({ error: 'Mandate not found' });
    res.json({ mandate });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update mandate' });
  }
};
