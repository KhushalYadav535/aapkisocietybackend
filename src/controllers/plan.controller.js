const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled } = require('../config/postgres');

const ensurePlanTable = async () => {
  if (!isPostgresEnabled) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.plans (
      id TEXT PRIMARY KEY,
      name TEXT,
      code TEXT UNIQUE,
      price NUMERIC DEFAULT 0,
      features JSONB DEFAULT '[]'::jsonb,
      color TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};
exports.ensurePlanTable = ensurePlanTable;

exports.getAll = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensurePlanTable().then(async () => {
        const r = await pool.query('SELECT * FROM platform.plans ORDER BY created_at DESC');
        return res.json({ plans: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch plans' }));
    }
    const db = getDb();
    const plans = db.get('plans').value() || [];
    res.json({ plans });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
};

exports.create = (req, res) => {
  try {
    const { name, code, price, features, color } = req.body;
    const normalizedCode = code != null ? String(code).trim().toUpperCase() : '';
    if (!name || !normalizedCode) {
      return res.status(400).json({ error: 'Name and plan code are required' });
    }
    let featureList = features;
    if (typeof featureList === 'string') {
      featureList = featureList.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(featureList)) featureList = [];
    if (isPostgresEnabled) {
      return ensurePlanTable().then(async () => {
        const existing = await pool.query('SELECT id FROM platform.plans WHERE UPPER(TRIM(code)) = $1 LIMIT 1', [normalizedCode]);
        if (existing.rows[0]) return res.status(400).json({ error: 'Plan code already exists' });
        const now = new Date().toISOString();
        const plan = {
          id: uuidv4(),
          name: String(name).trim(),
          code: normalizedCode,
          price: price !== undefined && price !== '' ? Number(price) : 0,
          features: featureList,
          color: color || 'bg-gray-100 text-gray-600',
          created_at: now,
          updated_at: now
        };
        await pool.query(
          `INSERT INTO platform.plans (id,name,code,price,features,color,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
          [plan.id, plan.name, plan.code, plan.price, JSON.stringify(plan.features), plan.color, plan.created_at, plan.updated_at]
        );
        return res.status(201).json({ plan });
      }).catch(() => res.status(500).json({ error: 'Failed to create plan' }));
    }
    const db = getDb();

    const now = new Date().toISOString();
    const plan = {
      id: uuidv4(),
      name: String(name).trim(),
      code: normalizedCode,
      price: price !== undefined && price !== '' ? Number(price) : 0,
      features: featureList,
      color: color || 'bg-gray-100 text-gray-600',
      created_at: now,
      updated_at: now
    };
    db.get('plans').push(plan).write();
    res.status(201).json({ plan });
  } catch (error) {
    console.error('Create plan error:', error);
    res.status(500).json({ error: 'Failed to create plan' });
  }
};

exports.update = (req, res) => {
  try {
    const { name, price, features, color } = req.body;
    let featurePayload = features;
    if (typeof featurePayload === 'string') {
      featurePayload = featurePayload.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (isPostgresEnabled) {
      return ensurePlanTable().then(async () => {
        await pool.query(
          `UPDATE platform.plans SET
            name = COALESCE($1, name),
            price = COALESCE($2, price),
            features = COALESCE($3::jsonb, features),
            color = COALESCE($4, color),
            updated_at = NOW()
          WHERE id = $5`,
          [
            name ?? null,
            price !== undefined && price !== '' ? Number(price) : null,
            featurePayload !== undefined ? JSON.stringify(featurePayload) : null,
            color ?? null,
            req.params.id
          ]
        );
        const r = await pool.query('SELECT * FROM platform.plans WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ plan: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update plan' }));
    }
    const db = getDb();
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (price !== undefined && price !== '') updates.price = Number(price);
    if (featurePayload !== undefined) updates.features = featurePayload;
    if (color !== undefined) updates.color = color;
    db.get('plans').find({ id: req.params.id }).assign(updates).write();
    const plan = db.get('plans').find({ id: req.params.id }).value();
    res.json({ plan });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update plan' });
  }
};

exports.delete = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensurePlanTable().then(async () => {
        await pool.query('DELETE FROM platform.plans WHERE id = $1', [req.params.id]);
        return res.json({ message: 'Plan deleted successfully' });
      }).catch(() => res.status(500).json({ error: 'Failed to delete plan' }));
    }
    const db = getDb();
    db.get('plans').remove({ id: req.params.id }).write();
    res.json({ message: 'Plan deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete plan' });
  }
};
