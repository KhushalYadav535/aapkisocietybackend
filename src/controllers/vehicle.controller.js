const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, ensurePlatformSchema } = require('../config/postgres');

const ensureVehicleTables = async (societyId) => {
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS \"society_${societyId}\"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \"society_${societyId}\".vehicles (
        id TEXT PRIMARY KEY,
        society_id TEXT,
        flat_id TEXT,
        vehicle_number TEXT,
        vehicle_type TEXT,
        make_model TEXT,
        color TEXT,
        sticker_number TEXT,
        parking_slot TEXT,
        rc_book_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \"society_${societyId}\".parking_slots (
        id TEXT PRIMARY KEY,
        society_id TEXT,
        slot_number TEXT,
        slot_type TEXT,
        floor TEXT,
        section TEXT,
        flat_id TEXT,
        is_available INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    if (err.message && err.message.includes('already exists')) {
      return;
    }
    throw err;
  }
};

exports.getAll = (req, res) => {
  try {
    const { flat_id, type, search } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureVehicleTables(societyId).then(async () => {
        let query = `SELECT v.*, u.flat_number, u.wing, u.first_name, u.last_name
          FROM \"society_${societyId}\".vehicles v
          LEFT JOIN platform.users u ON u.id = v.flat_id
          WHERE v.society_id = $1`;
        const params = [societyId];
        let idx = 2;

        if (flat_id) { query += ` AND v.flat_id = $${idx++}`; params.push(flat_id); }
        if (type) { query += ` AND v.vehicle_type = $${idx++}`; params.push(type); }
        if (search) {
          query += ` AND (v.vehicle_number ILIKE $${idx} OR v.make_model ILIKE $${idx} OR u.flat_number ILIKE $${idx})`;
          params.push(`%${search}%`); idx++;
        }
        query += ' ORDER BY v.created_at DESC';
        const r = await pool.query(query, params);
        return res.json({ vehicles: r.rows });
      }).catch((err) => { console.error('Vehicle API error:', err.message); return res.status(500).json({ error: 'Failed to fetch vehicles' }); });
    }

    const db = getDb();
    const users = db.get('users').value();
    let vehicles = db.get('vehicles').filter(v => v.society_id === societyId).value();

    if (flat_id) vehicles = vehicles.filter(v => v.flat_id === flat_id);
    if (type) vehicles = vehicles.filter(v => v.vehicle_type === type);
    if (search) {
      const s = search.toLowerCase();
      vehicles = vehicles.filter(v =>
        v.vehicle_number.toLowerCase().includes(s) ||
        (v.make_model && v.make_model.toLowerCase().includes(s))
      );
    }

    vehicles = vehicles.map(v => {
      const user = users.find(u => u.id === v.flat_id);
      return { ...v, flat_number: user?.flat_number, wing: user?.wing, first_name: user?.first_name, last_name: user?.last_name };
    });

    res.json({ vehicles: vehicles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
};

exports.create = (req, res) => {
  try {
    let { flat_id, vehicle_number, vehicle_type, make_model, color, sticker_number, parking_slot, rc_book_url, is_active } = req.body;
    const societyId = req.user.society_id;
    
    // Residents can only register vehicles for themselves
    if (req.user.role === 'RESIDENT') {
      flat_id = req.user.id;
    } else if (!flat_id) {
      return res.status(400).json({ error: 'flat_id is required for admins' });
    }

    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureVehicleTables(societyId).then(async () => {
        const existing = await pool.query(
          `SELECT * FROM \"society_${societyId}\".vehicles WHERE vehicle_number = $1 AND society_id = $2`,
          [vehicle_number.toUpperCase(), societyId]
        );
        if (existing.rows.length > 0) return res.status(409).json({ error: 'Vehicle already registered' });

        const id = uuidv4();
        await pool.query(
          `INSERT INTO \"society_${societyId}\".vehicles (id, society_id, flat_id, vehicle_number, vehicle_type, make_model, color, sticker_number, parking_slot, rc_book_url, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [id, societyId, flat_id, vehicle_number.toUpperCase(), vehicle_type, make_model, color, sticker_number, parking_slot, rc_book_url, is_active !== false, now]
        );
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".vehicles WHERE id = $1`, [id]);
        return res.status(201).json({ vehicle: r.rows[0] });
      }).catch((err) => { console.error('Vehicle API error:', err.message); return res.status(500).json({ error: 'Failed to register vehicle' }); });
    }

    const db = getDb();
    if (!db.get('vehicles').value()) db.set('vehicles', []).write();

    const existing = db.get('vehicles').find(v =>
      v.vehicle_number && v.vehicle_number.toUpperCase() === vehicle_number.toUpperCase()
    ).value();

    if (existing) return res.status(409).json({ error: 'Vehicle already registered' });

    const vehicle = {
      id: uuidv4(), society_id: societyId, flat_id, vehicle_number: vehicle_number.toUpperCase(),
      vehicle_type, make_model, color, sticker_number, parking_slot,
      rc_book_url, is_active: is_active !== false, created_at: now, updated_at: now
    };

    db.get('vehicles').push(vehicle).write();
    res.status(201).json({ vehicle });
  } catch (error) {
    res.status(500).json({ error: 'Failed to register vehicle' });
  }
};

exports.update = (req, res) => {
  try {
    const { id } = req.params;
    const { vehicle_number, vehicle_type, make_model, color, sticker_number, parking_slot, is_active } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureVehicleTables(societyId).then(async () => {
        const fields = [];
        const values = [];
        let idx = 1;

        if (vehicle_number) { fields.push(`vehicle_number = $${idx++}`); values.push(vehicle_number.toUpperCase()); }
        if (vehicle_type) { fields.push(`vehicle_type = $${idx++}`); values.push(vehicle_type); }
        if (make_model !== undefined) { fields.push(`make_model = $${idx++}`); values.push(make_model); }
        if (color !== undefined) { fields.push(`color = $${idx++}`); values.push(color); }
        if (sticker_number !== undefined) { fields.push(`sticker_number = $${idx++}`); values.push(sticker_number); }
        if (parking_slot !== undefined) { fields.push(`parking_slot = $${idx++}`); values.push(parking_slot); }
        if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }
        fields.push(`updated_at = $${idx++}`); values.push(now);
        values.push(id);

        await pool.query(`UPDATE \"society_${societyId}\".vehicles SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".vehicles WHERE id = $1`, [id]);
        return res.json({ vehicle: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update vehicle' }));
    }

    const db = getDb();
    const updates = {};
    if (vehicle_number) updates.vehicle_number = vehicle_number.toUpperCase();
    if (vehicle_type) updates.vehicle_type = vehicle_type;
    if (make_model !== undefined) updates.make_model = make_model;
    if (color !== undefined) updates.color = color;
    if (sticker_number !== undefined) updates.sticker_number = sticker_number;
    if (parking_slot !== undefined) updates.parking_slot = parking_slot;
    if (is_active !== undefined) updates.is_active = is_active;
    updates.updated_at = now;

    db.get('vehicles').find({ id }).assign(updates).write();
    res.json({ vehicle: db.get('vehicles').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update vehicle' });
  }
};

exports.delete = (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureVehicleTables(societyId).then(async () => {
        await pool.query(`DELETE FROM \"society_${societyId}\".vehicles WHERE id = $1`, [id]);
        return res.json({ message: 'Vehicle removed' });
      }).catch(() => res.status(500).json({ error: 'Failed to remove vehicle' }));
    }

    const db = getDb();
    db.get('vehicles').remove({ id }).write();
    res.json({ message: 'Vehicle removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove vehicle' });
  }
};

exports.getParkingSlots = (req, res) => {
  try {
    const { type } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureVehicleTables(societyId).then(async () => {
        let query = `SELECT ps.*, v.vehicle_number, u.flat_number, u.wing
          FROM \"society_${societyId}\".parking_slots ps
          LEFT JOIN \"society_${societyId}\".vehicles v ON v.parking_slot = ps.slot_number AND v.vehicle_type = ps.slot_type
          LEFT JOIN platform.users u ON u.id = ps.flat_id
          WHERE ps.society_id = $1`;
        const params = [societyId];
        if (type) { query += ` AND ps.slot_type = $2`; params.push(type); }
        query += ' ORDER BY ps.slot_number';

        const r = await pool.query(query, params);
        return res.json({ slots: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch parking slots' }));
    }

    const db = getDb();
    let slots = db.get('parking_slots') ? db.get('parking_slots').filter(s => s.society_id === societyId).value() : [];
    const vehicles = db.get('vehicles') ? db.get('vehicles').value() : [];
    const users = db.get('users').value();

    if (type) slots = slots.filter(s => s.slot_type === type);

    slots = slots.map(s => {
      const vehicle = vehicles.find(v => v.parking_slot === s.slot_number && v.vehicle_type === s.slot_type && v.is_active);
      const user = users.find(u => u.id === s.flat_id);
      return { ...s, vehicle_number: vehicle?.vehicle_number, flat_number: user?.flat_number, wing: user?.wing };
    });

    res.json({ slots });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch parking slots' });
  }
};

exports.createParkingSlot = (req, res) => {
  try {
    const { slot_number, slot_type, floor, section, flat_id } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (!['ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'].includes(req.user.role)) return res.status(403).json({ error: 'Not authorized' });

    if (isPostgresEnabled) {
      return ensureVehicleTables(societyId).then(async () => {
        const existing = await pool.query(
          `SELECT * FROM \"society_${societyId}\".parking_slots WHERE society_id = $1 AND slot_number = $2 AND slot_type = $3`,
          [societyId, slot_number, slot_type]
        );
        if (existing.rows.length > 0) return res.status(409).json({ error: 'Slot already exists' });

        const id = uuidv4();
        await pool.query(
          `INSERT INTO \"society_${societyId}\".parking_slots (id, society_id, slot_number, slot_type, floor, section, flat_id, is_available, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)`,
          [id, societyId, slot_number, slot_type, floor, section, flat_id, now]
        );
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".parking_slots WHERE id = $1`, [id]);
        return res.status(201).json({ slot: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to create parking slot' }));
    }

    const db = getDb();
    if (!db.get('parking_slots').value()) db.set('parking_slots', []).write();

    const slot = {
      id: uuidv4(), society_id: societyId, slot_number, slot_type, floor, section,
      flat_id, is_available: 1, created_at: now
    };
    db.get('parking_slots').push(slot).write();
    res.status(201).json({ slot });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create parking slot' });
  }
};

exports.assignSlot = (req, res) => {
  try {
    const { id } = req.params;
    const { flat_id } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureVehicleTables(societyId).then(async () => {
        await pool.query(
          `UPDATE \"society_${societyId}\".parking_slots SET flat_id = $1, is_available = 0, updated_at = $2 WHERE id = $3`,
          [flat_id, now, id]
        );
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".parking_slots WHERE id = $1`, [id]);
        return res.json({ slot: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to assign slot' }));
    }

    const db = getDb();
    db.get('parking_slots').find({ id }).assign({ flat_id, is_available: 0, updated_at: now }).write();
    res.json({ slot: db.get('parking_slots').find({ id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign slot' });
  }
};