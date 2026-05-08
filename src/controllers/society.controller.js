const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, createTenantSchema } = require('../config/postgres');

const ensureSocietyTables = async () => {
  if (!isPostgresEnabled) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.societies (
      id TEXT PRIMARY KEY,
      name TEXT,
      registration_number TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      gst_number TEXT,
      pan_number TEXT,
      total_units INTEGER DEFAULT 0,
      total_wings INTEGER DEFAULT 0,
      status TEXT,
      subscription_plan TEXT,
      subscription_status TEXT,
      active_modules JSONB DEFAULT '[]'::jsonb,
      bank_name TEXT,
      bank_account_number TEXT,
      bank_ifsc TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.wings (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      name TEXT,
      total_floors INTEGER DEFAULT 0,
      flats_per_floor INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.flats (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      wing_id TEXT,
      flat_number TEXT,
      floor_number INTEGER,
      area_sqft NUMERIC,
      flat_type TEXT,
      is_occupied INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.create = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        const { name, registration_number, address, city, state, pincode, gst_number, pan_number, total_units, total_wings, subscription_plan, active_modules } = req.body;
        const now = new Date().toISOString();
        const society = {
          id: uuidv4(), name, registration_number: registration_number || null,
          address: address || null, city: city || null, state: state || 'Maharashtra',
          pincode: pincode || null, gst_number: gst_number || null, pan_number: pan_number || null,
          total_units: total_units || 0, total_wings: total_wings || 0, status: 'ACTIVE',
          subscription_plan: subscription_plan || 'CORE', subscription_status: 'ACTIVE',
          active_modules: active_modules || ['MEMBERS', 'BILLING', 'NOTICES', 'COMPLAINTS'],
          created_at: now, updated_at: now
        };
        await pool.query(
          `INSERT INTO platform.societies
          (id,name,registration_number,address,city,state,pincode,gst_number,pan_number,total_units,total_wings,status,subscription_plan,subscription_status,active_modules,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
          [society.id, society.name, society.registration_number, society.address, society.city, society.state, society.pincode, society.gst_number, society.pan_number, society.total_units, society.total_wings, society.status, society.subscription_plan, society.subscription_status, JSON.stringify(society.active_modules), society.created_at, society.updated_at]
        );
        await createTenantSchema(society.id);
        return res.status(201).json({ society });
      }).catch((error) => {
        console.error('Create society error:', error);
        return res.status(500).json({ error: 'Failed to create society' });
      });
    }
    const db = getDb();
    const { name, registration_number, address, city, state, pincode, gst_number, pan_number, total_units, total_wings, subscription_plan, active_modules } = req.body;
    const now = new Date().toISOString();
    const society = {
      id: uuidv4(), name, registration_number: registration_number || null,
      address: address || null, city: city || null, state: state || 'Maharashtra',
      pincode: pincode || null, gst_number: gst_number || null, pan_number: pan_number || null,
      total_units: total_units || 0, total_wings: total_wings || 0, status: 'ACTIVE',
      subscription_plan: subscription_plan || 'CORE', subscription_status: 'ACTIVE',
      active_modules: active_modules || ['MEMBERS', 'BILLING', 'NOTICES', 'COMPLAINTS'],
      created_at: now, updated_at: now
    };
    db.get('societies').push(society).write();
    res.status(201).json({ society });
  } catch (error) {
    console.error('Create society error:', error);
    res.status(500).json({ error: 'Failed to create society' });
  }
};

exports.getAll = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        let query = 'SELECT * FROM platform.societies ORDER BY created_at DESC';
        let params = [];
        if (req.user.role !== 'PLATFORM_ADMIN') {
          query = 'SELECT * FROM platform.societies WHERE id = $1';
          params = [req.user.society_id];
        }
        const r = await pool.query(query, params);
        return res.json({ societies: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch societies' }));
    }
    const db = getDb();
    let societies;
    if (req.user.role === 'PLATFORM_ADMIN') {
      societies = db.get('societies').sortBy('created_at').reverse().value();
    } else {
      societies = db.get('societies').filter({ id: req.user.society_id }).value();
    }
    res.json({ societies });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch societies' });
  }
};

exports.getById = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        const r = await pool.query('SELECT * FROM platform.societies WHERE id = $1 LIMIT 1', [req.params.id]);
        const society = r.rows[0];
        if (!society) return res.status(404).json({ error: 'Society not found' });
        return res.json({ society });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch society' }));
    }
    const db = getDb();
    const society = db.get('societies').find({ id: req.params.id }).value();
    if (!society) return res.status(404).json({ error: 'Society not found' });
    res.json({ society });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch society' });
  }
};

exports.update = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        const fields = ['name', 'address', 'city', 'state', 'pincode', 'gst_number', 'pan_number', 'total_units', 'bank_name', 'bank_account_number', 'bank_ifsc', 'subscription_plan'];
        const setParts = [];
        const values = [];
        fields.forEach((f) => {
          if (req.body[f] !== undefined) {
            values.push(req.body[f]);
            setParts.push(`${f} = $${values.length}`);
          }
        });
        if (req.body.active_modules !== undefined) {
          values.push(JSON.stringify(req.body.active_modules));
          setParts.push(`active_modules = $${values.length}::jsonb`);
        }
        values.push(req.params.id);
        const setClause = setParts.length ? `${setParts.join(', ')}, updated_at = NOW()` : 'updated_at = NOW()';
        await pool.query(`UPDATE platform.societies SET ${setClause} WHERE id = $${values.length}`, values);
        const r = await pool.query('SELECT * FROM platform.societies WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ society: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update society' }));
    }
    const db = getDb();
    const updates = {};
    const fields = ['name', 'address', 'city', 'state', 'pincode', 'gst_number', 'pan_number', 'total_units', 'bank_name', 'bank_account_number', 'bank_ifsc', 'subscription_plan', 'active_modules'];
    fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    updates.updated_at = new Date().toISOString();
    db.get('societies').find({ id: req.params.id }).assign(updates).write();
    const society = db.get('societies').find({ id: req.params.id }).value();
    res.json({ society });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update society' });
  }
};

exports.getWings = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        const r = await pool.query('SELECT * FROM platform.wings WHERE society_id = $1', [req.params.id]);
        return res.json({ wings: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch wings' }));
    }
    const db = getDb();
    const wings = db.get('wings').filter({ society_id: req.params.id }).value();
    res.json({ wings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wings' });
  }
};

exports.addWing = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        const { name, total_floors, flats_per_floor } = req.body;
        const wing = { id: uuidv4(), society_id: req.params.id, name, total_floors: total_floors || 0, flats_per_floor: flats_per_floor || 0, created_at: new Date().toISOString() };
        await pool.query(
          `INSERT INTO platform.wings (id,society_id,name,total_floors,flats_per_floor,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [wing.id, wing.society_id, wing.name, wing.total_floors, wing.flats_per_floor, wing.created_at]
        );
        return res.status(201).json({ wing });
      }).catch(() => res.status(500).json({ error: 'Failed to add wing' }));
    }
    const db = getDb();
    const { name, total_floors, flats_per_floor } = req.body;
    const wing = { id: uuidv4(), society_id: req.params.id, name, total_floors: total_floors || 0, flats_per_floor: flats_per_floor || 0, created_at: new Date().toISOString() };
    db.get('wings').push(wing).write();
    res.status(201).json({ wing });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add wing' });
  }
};

exports.getFlats = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        const r = await pool.query('SELECT * FROM platform.flats WHERE society_id = $1', [req.params.id]);
        return res.json({ flats: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch flats' }));
    }
    const db = getDb();
    const flats = db.get('flats').filter({ society_id: req.params.id }).value();
    res.json({ flats });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch flats' });
  }
};

exports.addFlat = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        const { flat_number, wing_id, floor_number, area_sqft, flat_type } = req.body;
        const flat = { id: uuidv4(), society_id: req.params.id, wing_id: wing_id || null, flat_number, floor_number: floor_number || null, area_sqft: area_sqft || null, flat_type: flat_type || null, is_occupied: 0, created_at: new Date().toISOString() };
        await pool.query(
          `INSERT INTO platform.flats (id,society_id,wing_id,flat_number,floor_number,area_sqft,flat_type,is_occupied,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [flat.id, flat.society_id, flat.wing_id, flat.flat_number, flat.floor_number, flat.area_sqft, flat.flat_type, flat.is_occupied, flat.created_at]
        );
        return res.status(201).json({ flat });
      }).catch(() => res.status(500).json({ error: 'Failed to add flat' }));
    }
    const db = getDb();
    const { flat_number, wing_id, floor_number, area_sqft, flat_type } = req.body;
    const flat = { id: uuidv4(), society_id: req.params.id, wing_id: wing_id || null, flat_number, floor_number: floor_number || null, area_sqft: area_sqft || null, flat_type: flat_type || null, is_occupied: 0, created_at: new Date().toISOString() };
    db.get('flats').push(flat).write();
    res.status(201).json({ flat });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add flat' });
  }
};

exports.suspend = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        await pool.query('UPDATE platform.societies SET status = $1, updated_at = NOW() WHERE id = $2', ['SUSPENDED', req.params.id]);
        return res.json({ message: 'Society suspended successfully' });
      }).catch(() => res.status(500).json({ error: 'Failed to suspend society' }));
    }
    const db = getDb();
    db.get('societies').find({ id: req.params.id }).assign({ status: 'SUSPENDED', updated_at: new Date().toISOString() }).write();
    res.json({ message: 'Society suspended successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to suspend society' });
  }
};

exports.reactivate = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        await pool.query('UPDATE platform.societies SET status = $1, updated_at = NOW() WHERE id = $2', ['ACTIVE', req.params.id]);
        return res.json({ message: 'Society reactivated successfully' });
      }).catch(() => res.status(500).json({ error: 'Failed to reactivate society' }));
    }
    const db = getDb();
    db.get('societies').find({ id: req.params.id }).assign({ status: 'ACTIVE', updated_at: new Date().toISOString() }).write();
    res.json({ message: 'Society reactivated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reactivate society' });
  }
};

exports.deleteSociety = (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        await pool.query('DELETE FROM platform.societies WHERE id = $1', [req.params.id]);
        return res.json({ message: 'Society deleted permanently' });
      }).catch(() => res.status(500).json({ error: 'Failed to delete society' }));
    }
    const db = getDb();
    db.get('societies').remove({ id: req.params.id }).write();
    res.json({ message: 'Society deleted permanently' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete society' });
  }
};
