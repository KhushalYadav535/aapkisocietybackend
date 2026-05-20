const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, createTenantSchema, ensurePlatformSocietiesSchema } = require('../config/postgres');

const ensureSocietyTables = async () => {
  if (!isPostgresEnabled) return;
  await ensurePlatformSocietiesSchema();
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
  
  // New Master Tables
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.unit_category_master (id TEXT PRIMARY KEY, name TEXT UNIQUE)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.unit_type_master (id TEXT PRIMARY KEY, category_id TEXT, name TEXT UNIQUE, notes TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.unit_subtype_master (id TEXT PRIMARY KEY, name TEXT UNIQUE, notes TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.occupancy_type_master (id TEXT PRIMARY KEY, name TEXT UNIQUE, why_important TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform.ownership_type_master (id TEXT PRIMARY KEY, name TEXT UNIQUE)`);
  
  // Alter flats table to include new attributes
  const alters = [
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS unit_category TEXT`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS unit_subtype TEXT`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS occupancy_type TEXT`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS ownership_type TEXT`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS rera_unit_id TEXT`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS super_builtup_area NUMERIC`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS carpet_area NUMERIC`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS uds_sqft NUMERIC`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS maintenance_slab TEXT`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS vastu_facing TEXT`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS meter_numbers TEXT`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS gst_applicable INTEGER DEFAULT 0`,
    `ALTER TABLE platform.flats ADD COLUMN IF NOT EXISTS occupancy_certificate_status TEXT`
  ];
  for (const sql of alters) {
    try { await pool.query(sql); } catch(e) { }
  }

  // Auto-seed masters if empty
  try {
    const countRes = await pool.query('SELECT count(*) as count FROM platform.unit_category_master');
    if (parseInt(countRes.rows[0].count) === 0) {
      await seedMasters(pool);
    }
  } catch (e) { console.error('Error auto-seeding masters', e); }
};

const seedMasters = async (client) => {
  const categories = ['Residential', 'Commercial', 'Plot', 'Mixed Use'];
  for (const cat of categories) {
    await client.query(`INSERT INTO platform.unit_category_master (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [uuidv4(), cat]);
  }
  const types = [
    { cat: 'Residential', name: '1 RK', notes: 'Room + Kitchen' },
    { cat: 'Residential', name: 'Studio Apartment', notes: 'Single-room compact unit' },
    { cat: 'Residential', name: '1 BHK', notes: 'Bedroom-Hall-Kitchen' },
    { cat: 'Residential', name: '2 BHK', notes: 'Most common urban format' },
    { cat: 'Residential', name: '3 BHK', notes: 'Premium standard' },
    { cat: 'Residential', name: 'Penthouse', notes: 'Top-floor luxury' },
    { cat: 'Residential', name: 'Villa', notes: 'Premium standalone' },
    { cat: 'Residential', name: 'Row House', notes: 'Connected side walls' },
    { cat: 'Commercial', name: 'Shop', notes: 'Retail' },
    { cat: 'Commercial', name: 'Office Unit', notes: 'Office' }
  ];
  for (const t of types) {
    await client.query(`INSERT INTO platform.unit_type_master (id, category_id, name, notes) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [uuidv4(), t.cat, t.name, t.notes]);
  }
  const subtypes = [
    { name: 'Standard', notes: 'Default' }, { name: 'Duplex', notes: 'Two floors' }, { name: 'Triplex', notes: 'Three floors' },
    { name: 'Premium', notes: 'Premium features' }, { name: 'Corner', notes: 'Corner layout' }, { name: 'Garden Facing', notes: 'Faces garden' },
    { name: 'Unit with Covered Parking', notes: 'Parking linked' }, { name: 'Unit with Open Parking', notes: 'Parking linked' }
  ];
  for (const s of subtypes) {
    await client.query(`INSERT INTO platform.unit_subtype_master (id, name, notes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [uuidv4(), s.name, s.notes]);
  }
  const occupancies = [
    { name: 'Owner Occupied', why: 'Resident owner' }, { name: 'Tenant Occupied', why: 'Rental tracking' },
    { name: 'Vacant Unit', why: 'Maintenance handling' }, { name: 'Corporate Lease', why: 'Company rented' }
  ];
  for (const o of occupancies) {
    await client.query(`INSERT INTO platform.occupancy_type_master (id, name, why_important) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [uuidv4(), o.name, o.why]);
  }
  const ownerships = ['Freehold', 'Leasehold', 'Cooperative Society Ownership', 'Condominium Ownership', 'Joint Ownership'];
  for (const o of ownerships) {
    await client.query(`INSERT INTO platform.ownership_type_master (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [uuidv4(), o]);
  }
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
    const data = req.body;
    const flat = { 
      id: uuidv4(), society_id: req.params.id, wing_id: data.wing_id || null, 
      flat_number: data.flat_number, floor_number: data.floor_number || null, 
      area_sqft: data.area_sqft || data.super_builtup_area || data.carpet_area || null, 
      flat_type: data.flat_type || null, is_occupied: 0, created_at: new Date().toISOString(),
      unit_category: data.unit_category || null, unit_subtype: data.unit_subtype || null,
      occupancy_type: data.occupancy_type || null, ownership_type: data.ownership_type || null,
      rera_unit_id: data.rera_unit_id || null, super_builtup_area: data.super_builtup_area || null,
      carpet_area: data.carpet_area || null, uds_sqft: data.uds_sqft || null,
      maintenance_slab: data.maintenance_slab || null, vastu_facing: data.vastu_facing || null,
      meter_numbers: data.meter_numbers || null, gst_applicable: data.gst_applicable ? 1 : 0,
      occupancy_certificate_status: data.occupancy_certificate_status || null
    };

    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        await pool.query(
          `INSERT INTO platform.flats (id,society_id,wing_id,flat_number,floor_number,area_sqft,flat_type,is_occupied,created_at,unit_category,unit_subtype,occupancy_type,ownership_type,rera_unit_id,super_builtup_area,carpet_area,uds_sqft,maintenance_slab,vastu_facing,meter_numbers,gst_applicable,occupancy_certificate_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [flat.id, flat.society_id, flat.wing_id, flat.flat_number, flat.floor_number, flat.area_sqft, flat.flat_type, flat.is_occupied, flat.created_at, flat.unit_category, flat.unit_subtype, flat.occupancy_type, flat.ownership_type, flat.rera_unit_id, flat.super_builtup_area, flat.carpet_area, flat.uds_sqft, flat.maintenance_slab, flat.vastu_facing, flat.meter_numbers, flat.gst_applicable, flat.occupancy_certificate_status]
        );
        return res.status(201).json({ flat });
      }).catch((e) => {
        console.error(e);
        res.status(500).json({ error: 'Failed to add flat' });
      });
    }
    const db = getDb();
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

exports.getHomeTypeMasters = async (req, res) => {
  try {
    if (isPostgresEnabled) {
      return ensureSocietyTables().then(async () => {
        const catRes = await pool.query('SELECT * FROM platform.unit_category_master');
        const typeRes = await pool.query('SELECT * FROM platform.unit_type_master');
        const subtypeRes = await pool.query('SELECT * FROM platform.unit_subtype_master');
        const occRes = await pool.query('SELECT * FROM platform.occupancy_type_master');
        const ownRes = await pool.query('SELECT * FROM platform.ownership_type_master');
        
        return res.json({
          unit_category_master: catRes.rows,
          unit_type_master: typeRes.rows,
          unit_subtype_master: subtypeRes.rows,
          occupancy_type_master: occRes.rows,
          ownership_type_master: ownRes.rows
        });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch home type masters' }));
    }
    const db = getDb();
    
    // Seed lowdb if empty
    if (db.get('unit_category_master').value() && db.get('unit_category_master').value().length === 0) {
      const categories = ['Residential', 'Commercial', 'Plot', 'Mixed Use'];
      for (const cat of categories) db.get('unit_category_master').push({ id: uuidv4(), name: cat }).write();
      
      const types = [
        { cat: 'Residential', name: '1 RK', notes: 'Room + Kitchen' },
        { cat: 'Residential', name: 'Studio Apartment', notes: 'Single-room compact unit' },
        { cat: 'Residential', name: '1 BHK', notes: 'Bedroom-Hall-Kitchen' },
        { cat: 'Residential', name: '2 BHK', notes: 'Most common urban format' },
        { cat: 'Residential', name: '3 BHK', notes: 'Premium standard' },
        { cat: 'Residential', name: 'Penthouse', notes: 'Top-floor luxury' },
        { cat: 'Residential', name: 'Villa', notes: 'Premium standalone' },
        { cat: 'Residential', name: 'Row House', notes: 'Connected side walls' },
        { cat: 'Commercial', name: 'Shop', notes: 'Retail' },
        { cat: 'Commercial', name: 'Office Unit', notes: 'Office' }
      ];
      for (const t of types) db.get('unit_type_master').push({ id: uuidv4(), category_id: t.cat, name: t.name, notes: t.notes }).write();
      
      const subtypes = [
        { name: 'Standard', notes: 'Default' }, { name: 'Duplex', notes: 'Two floors' }, { name: 'Triplex', notes: 'Three floors' },
        { name: 'Premium', notes: 'Premium features' }, { name: 'Corner', notes: 'Corner layout' }, { name: 'Garden Facing', notes: 'Faces garden' },
        { name: 'Unit with Covered Parking', notes: 'Parking linked' }, { name: 'Unit with Open Parking', notes: 'Parking linked' }
      ];
      for (const s of subtypes) db.get('unit_subtype_master').push({ id: uuidv4(), name: s.name, notes: s.notes }).write();
      
      const occupancies = [
        { name: 'Owner Occupied', why: 'Resident owner' }, { name: 'Tenant Occupied', why: 'Rental tracking' },
        { name: 'Vacant Unit', why: 'Maintenance handling' }, { name: 'Corporate Lease', why: 'Company rented' }
      ];
      for (const o of occupancies) db.get('occupancy_type_master').push({ id: uuidv4(), name: o.name, why_important: o.why }).write();
      
      const ownerships = ['Freehold', 'Leasehold', 'Cooperative Society Ownership', 'Condominium Ownership', 'Joint Ownership'];
      for (const o of ownerships) db.get('ownership_type_master').push({ id: uuidv4(), name: o }).write();
    }

    return res.json({
      unit_category_master: db.get('unit_category_master').value() || [],
      unit_type_master: db.get('unit_type_master').value() || [],
      unit_subtype_master: db.get('unit_subtype_master').value() || [],
      occupancy_type_master: db.get('occupancy_type_master').value() || [],
      ownership_type_master: db.get('ownership_type_master').value() || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch home type masters' });
  }
};
