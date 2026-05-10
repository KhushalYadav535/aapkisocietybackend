const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled } = require('../config/postgres');

const ensureAssetTables = async (societyId) => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS \"society_${societyId}\"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \"society_${societyId}\".assets (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      asset_name TEXT NOT NULL,
      asset_code TEXT UNIQUE,
      category TEXT,
      location TEXT,
      make_model TEXT,
      serial_number TEXT,
      purchase_date DATE,
      purchase_amount NUMERIC(12,2),
      warranty_expiry DATE,
      amc_vendor TEXT,
      amc_expiry DATE,
      amc_amount NUMERIC(12,2),
      last_serviced DATE,
      next_service_due DATE,
      status TEXT DEFAULT 'ACTIVE',
      notes TEXT,
      qr_code TEXT UNIQUE,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \"society_${societyId}\".asset_service_logs (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      asset_id TEXT,
      service_type TEXT,
      service_date DATE,
      vendor_name TEXT,
      cost NUMERIC(12,2),
      description TEXT,
      next_due DATE,
      logged_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

// GET /api/assets
exports.getAll = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { category, status, expiring_soon } = req.query;
    if (isPostgresEnabled) {
      await ensureAssetTables(societyId);
      let q = `SELECT * FROM \"society_${societyId}\".assets WHERE society_id=$1`;
      const params = [societyId]; let idx = 2;
      if (category) { q += ` AND category=$${idx++}`; params.push(category); }
      if (status) { q += ` AND status=$${idx++}`; params.push(status); }
      if (expiring_soon === 'true') {
        q += ` AND (amc_expiry IS NOT NULL AND amc_expiry <= CURRENT_DATE + INTERVAL '30 days')`;
      }
      q += ' ORDER BY asset_name';
      const r = await pool.query(q, params);
      return res.json({ assets: r.rows });
    }
    const db = getDb();
    let assets = db.get('assets') ? db.get('assets').filter(a => a.society_id === societyId).value() : [];
    if (category) assets = assets.filter(a => a.category === category);
    if (status) assets = assets.filter(a => a.status === status);
    if (expiring_soon === 'true') {
      const soon = new Date(); soon.setDate(soon.getDate() + 30);
      assets = assets.filter(a => a.amc_expiry && new Date(a.amc_expiry) <= soon);
    }
    res.json({ assets });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch assets' });
  }
};

// GET /api/assets/by-qr/:qrCode — scan QR to get asset info
exports.getByQr = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    const { qrCode } = req.params;
    if (isPostgresEnabled) {
      await ensureAssetTables(societyId);
      const r = await pool.query(
        `SELECT * FROM \"society_${societyId}\".assets WHERE qr_code=$1 AND society_id=$2`,
        [qrCode, societyId]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
      // also fetch service logs
      const logs = await pool.query(
        `SELECT * FROM \"society_${societyId}\".asset_service_logs WHERE asset_id=$1 ORDER BY service_date DESC LIMIT 10`,
        [r.rows[0].id]
      );
      return res.json({ asset: r.rows[0], service_logs: logs.rows });
    }
    const db = getDb();
    const asset = db.get('assets') ? db.get('assets').find(a => a.qr_code === qrCode && a.society_id === societyId).value() : null;
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    const logs = db.get('asset_service_logs') ? db.get('asset_service_logs').filter(l => l.asset_id === asset.id).sortBy('service_date').reverse().take(10).value() : [];
    res.json({ asset, service_logs: logs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch asset' });
  }
};

// POST /api/assets
exports.create = async (req, res) => {
  try {
    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });

    const societyId = req.user.society_id;
    const { asset_name, category, location, make_model, serial_number, purchase_date, purchase_amount, warranty_expiry, amc_vendor, amc_expiry, amc_amount, last_serviced, next_service_due, status, notes } = req.body;
    const now = new Date().toISOString();
    const id = uuidv4();
    const asset_code = `ASSET-${Date.now().toString(36).toUpperCase()}`;
    const qr_code = `ASSET-${societyId}-${id}`;

    const asset = { id, society_id: societyId, asset_name, asset_code, category: category || null, location: location || null, make_model: make_model || null, serial_number: serial_number || null, purchase_date: purchase_date || null, purchase_amount: purchase_amount || null, warranty_expiry: warranty_expiry || null, amc_vendor: amc_vendor || null, amc_expiry: amc_expiry || null, amc_amount: amc_amount || null, last_serviced: last_serviced || null, next_service_due: next_service_due || null, status: status || 'ACTIVE', notes: notes || null, qr_code, created_by: req.user.id, created_at: now, updated_at: now };

    if (isPostgresEnabled) {
      await ensureAssetTables(societyId);
      await pool.query(
        `INSERT INTO \"society_${societyId}\".assets (id,society_id,asset_name,asset_code,category,location,make_model,serial_number,purchase_date,purchase_amount,warranty_expiry,amc_vendor,amc_expiry,amc_amount,last_serviced,next_service_due,status,notes,qr_code,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [id, societyId, asset_name, asset_code, category || null, location || null, make_model || null, serial_number || null, purchase_date || null, purchase_amount || null, warranty_expiry || null, amc_vendor || null, amc_expiry || null, amc_amount || null, last_serviced || null, next_service_due || null, status || 'ACTIVE', notes || null, qr_code, req.user.id, now, now]
      );
      return res.status(201).json({ asset });
    }

    const db = getDb();
    if (!db.get('assets').value()) db.set('assets', []).write();
    db.get('assets').push(asset).write();
    res.status(201).json({ asset });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create asset' });
  }
};

// PUT /api/assets/:id
exports.update = async (req, res) => {
  try {
    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });

    const { id } = req.params;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();
    const fields = req.body;

    if (isPostgresEnabled) {
      await ensureAssetTables(societyId);
      const keys = Object.keys(fields).filter(k => !['id', 'society_id', 'qr_code', 'created_by', 'created_at'].includes(k));
      if (keys.length === 0) return res.status(400).json({ error: 'No fields to update' });
      const setClauses = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
      const values = keys.map(k => fields[k]);
      values.push(now); const setFull = `${setClauses}, updated_at=$${values.length}`;
      values.push(id);
      await pool.query(`UPDATE \"society_${societyId}\".assets SET ${setFull} WHERE id=$${values.length}`, values);
      const r = await pool.query(`SELECT * FROM \"society_${societyId}\".assets WHERE id=$1`, [id]);
      return res.json({ asset: r.rows[0] });
    }

    const db = getDb();
    db.get('assets').find({ id }).assign({ ...fields, updated_at: now }).write();
    res.json({ asset: db.get('assets').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update asset' });
  }
};

// POST /api/assets/:id/service-log
exports.addServiceLog = async (req, res) => {
  try {
    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });

    const { id: assetId } = req.params;
    const { service_type, service_date, vendor_name, cost, description, next_due } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();
    const logId = uuidv4();

    const log = { id: logId, society_id: societyId, asset_id: assetId, service_type, service_date, vendor_name: vendor_name || null, cost: cost || null, description: description || null, next_due: next_due || null, logged_by: req.user.id, created_at: now };

    if (isPostgresEnabled) {
      await ensureAssetTables(societyId);
      await pool.query(
        `INSERT INTO \"society_${societyId}\".asset_service_logs (id,society_id,asset_id,service_type,service_date,vendor_name,cost,description,next_due,logged_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [logId, societyId, assetId, service_type, service_date, vendor_name || null, cost || null, description || null, next_due || null, req.user.id, now]
      );
      // Update asset's last_serviced and next_service_due
      if (service_date) {
        await pool.query(
          `UPDATE \"society_${societyId}\".assets SET last_serviced=$1, next_service_due=$2, updated_at=$3 WHERE id=$4`,
          [service_date, next_due || null, now, assetId]
        );
      }
      return res.status(201).json({ log });
    }

    const db = getDb();
    if (!db.get('asset_service_logs').value()) db.set('asset_service_logs', []).write();
    db.get('asset_service_logs').push(log).write();
    if (service_date) db.get('assets').find({ id: assetId }).assign({ last_serviced: service_date, next_service_due: next_due || null, updated_at: now }).write();
    res.status(201).json({ log });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add service log' });
  }
};

// GET /api/assets/:id/service-logs
exports.getServiceLogs = async (req, res) => {
  try {
    const { id: assetId } = req.params;
    const societyId = req.user.society_id;
    if (isPostgresEnabled) {
      await ensureAssetTables(societyId);
      const r = await pool.query(
        `SELECT sl.*, u.first_name, u.last_name FROM \"society_${societyId}\".asset_service_logs sl LEFT JOIN platform.users u ON u.id = sl.logged_by WHERE sl.asset_id=$1 ORDER BY sl.service_date DESC`,
        [assetId]
      );
      return res.json({ logs: r.rows });
    }
    const db = getDb();
    const users = db.get('users').value();
    const logs = db.get('asset_service_logs') ? db.get('asset_service_logs').filter(l => l.asset_id === assetId).value() : [];
    res.json({ logs: logs.map(l => { const u = users.find(x => x.id === l.logged_by); return { ...l, first_name: u?.first_name, last_name: u?.last_name }; }) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch service logs' });
  }
};

// GET /api/assets/amc-alerts — assets with expiring AMC in next 60 days
exports.getAmcAlerts = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (isPostgresEnabled) {
      await ensureAssetTables(societyId);
      const r = await pool.query(`
        SELECT *, 
          CASE WHEN amc_expiry <= CURRENT_DATE THEN 'EXPIRED'
               WHEN amc_expiry <= CURRENT_DATE + INTERVAL '30 days' THEN 'CRITICAL'
               WHEN amc_expiry <= CURRENT_DATE + INTERVAL '60 days' THEN 'WARNING'
               ELSE 'OK' END AS amc_status
        FROM \"society_${societyId}\".assets
        WHERE society_id=$1 AND amc_expiry IS NOT NULL AND amc_expiry <= CURRENT_DATE + INTERVAL '60 days'
        ORDER BY amc_expiry`, [societyId]
      );
      return res.json({ alerts: r.rows });
    }
    const db = getDb();
    const now = new Date();
    const d60 = new Date(); d60.setDate(d60.getDate() + 60);
    const d30 = new Date(); d30.setDate(d30.getDate() + 30);
    const assets = db.get('assets') ? db.get('assets').filter(a => a.society_id === societyId && a.amc_expiry && new Date(a.amc_expiry) <= d60).value() : [];
    const alerts = assets.map(a => ({
      ...a,
      amc_status: new Date(a.amc_expiry) <= now ? 'EXPIRED' : new Date(a.amc_expiry) <= d30 ? 'CRITICAL' : 'WARNING'
    }));
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch AMC alerts' });
  }
};

// DELETE /api/assets/:id
exports.remove = async (req, res) => {
  try {
    if (!['ADMIN', 'PLATFORM_ADMIN'].includes(req.user.role))
      return res.status(403).json({ error: 'Not authorized' });
    const { id } = req.params;
    const societyId = req.user.society_id;
    if (isPostgresEnabled) {
      await ensureAssetTables(societyId);
      await pool.query(`UPDATE \"society_${societyId}\".assets SET status='DECOMMISSIONED' WHERE id=$1`, [id]);
      return res.json({ message: 'Asset decommissioned' });
    }
    const db = getDb();
    db.get('assets').find({ id }).assign({ status: 'DECOMMISSIONED' }).write();
    res.json({ message: 'Asset decommissioned' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove asset' });
  }
};
