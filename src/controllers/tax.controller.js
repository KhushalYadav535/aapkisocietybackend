const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureTaxTables = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS gst_returns (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      return_type TEXT,
      period TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS tds_returns (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      form_type TEXT,
      period TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

exports.createGSTR = (req, res) => {
  try {
    const { return_type, period, payload } = req.body;
    const now = new Date().toISOString();
    const record = {
      id: uuidv4(),
      society_id: req.user.society_id,
      return_type: return_type || 'GSTR-1',
      period,
      payload: payload || {},
      status: 'GENERATED',
      created_at: now
    };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTaxTables(client);
        await client.query(
          `INSERT INTO gst_returns (id, society_id, return_type, period, payload, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$7)`,
          [record.id, record.society_id, record.return_type, record.period, JSON.stringify(record.payload), record.status, record.created_at]
        );
        return res.status(201).json({ record });
      }).catch(() => res.status(500).json({ error: 'Failed to generate GSTR' }));
    }

    const db = getDb();
    db.get('gst_returns').push(record).write();
    res.status(201).json({ record });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate GSTR' });
  }
};

exports.createTDS = (req, res) => {
  try {
    const { form_type, period, payload } = req.body;
    const now = new Date().toISOString();
    const record = {
      id: uuidv4(),
      society_id: req.user.society_id,
      form_type: form_type || '26Q',
      period,
      payload: payload || {},
      status: 'GENERATED',
      created_at: now
    };

    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTaxTables(client);
        await client.query(
          `INSERT INTO tds_returns (id, society_id, form_type, period, payload, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$7)`,
          [record.id, record.society_id, record.form_type, record.period, JSON.stringify(record.payload), record.status, record.created_at]
        );
        return res.status(201).json({ record });
      }).catch(() => res.status(500).json({ error: 'Failed to generate TDS' }));
    }

    const db = getDb();
    db.get('tds_returns').push(record).write();
    res.status(201).json({ record });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate TDS' });
  }
};

exports.list = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureTaxTables(client);
        const [gstR, tdsR] = await Promise.all([
          client.query('SELECT * FROM gst_returns ORDER BY created_at DESC'),
          client.query('SELECT * FROM tds_returns ORDER BY created_at DESC')
        ]);
        return res.json({
          gst_returns: gstR.rows,
          tds_returns: tdsR.rows
        });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch tax returns' }));
    }

    const db = getDb();
    res.json({
      gst_returns: db.get('gst_returns').filter({ society_id: req.user.society_id }).value() || [],
      tds_returns: db.get('tds_returns').filter({ society_id: req.user.society_id }).value() || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tax returns' });
  }
};
