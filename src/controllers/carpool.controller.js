const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureCarpoolTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS carpools (
      id TEXT PRIMARY KEY,
      society_id TEXT NOT NULL,
      driver_id TEXT NOT NULL,
      driver_name TEXT NOT NULL,
      driver_flat TEXT NOT NULL,
      driver_wing TEXT NOT NULL,
      driver_phone TEXT,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      departure_date DATE NOT NULL,
      departure_time TEXT NOT NULL,
      vehicle_type TEXT DEFAULT 'CAR',
      vehicle_number TEXT,
      available_seats INTEGER DEFAULT 3,
      cost_per_seat NUMERIC DEFAULT 0,
      notes TEXT,
      status TEXT DEFAULT 'OPEN',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing from user profile' });

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureCarpoolTable(client);
        const query = `
          SELECT * FROM carpools 
          WHERE society_id = $1 
          ORDER BY departure_date ASC, departure_time ASC
        `;
        const r = await client.query(query, [societyId]);
        return res.json({ carpools: r.rows });
      }).catch((err) => {
        console.error('Fetch carpools error:', err);
        return res.status(500).json({ error: 'Failed to fetch carpools' });
      });
    }

    const db = getDb();
    const carpools = (db.get('carpools').value() || [])
      .filter(c => c.society_id === societyId)
      .sort((a, b) => new Date(`${a.departure_date} ${a.departure_time}`) - new Date(`${b.departure_date} ${b.departure_time}`));
    return res.json({ carpools });
  } catch (error) {
    console.error('Fetch carpools error:', error);
    return res.status(500).json({ error: 'Server error fetching carpools' });
  }
};

exports.create = async (req, res) => {
  try {
    const societyId = req.user.society_id;
    if (!societyId) return res.status(400).json({ error: 'Society ID missing' });

    const {
      origin,
      destination,
      departure_date,
      departure_time,
      vehicle_type,
      vehicle_number,
      available_seats,
      cost_per_seat,
      notes
    } = req.body;

    if (!origin || !destination || !departure_date || !departure_time) {
      return res.status(400).json({ error: 'Origin, destination, departure date and time are required' });
    }

    const id = uuidv4();
    const driverId = req.user.id;
    const driverName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Resident';
    const driverFlat = req.user.flat_number || 'N/A';
    const driverWing = req.user.wing || 'A';
    const driverPhone = req.user.phone || '';

    const newCarpool = {
      id,
      society_id: societyId,
      driver_id: driverId,
      driver_name: driverName,
      driver_flat: driverFlat,
      driver_wing: driverWing,
      driver_phone: driverPhone,
      origin: origin.trim(),
      destination: destination.trim(),
      departure_date,
      departure_time,
      vehicle_type: vehicle_type || 'CAR',
      vehicle_number: vehicle_number ? vehicle_number.trim() : null,
      available_seats: parseInt(available_seats) || 3,
      cost_per_seat: parseFloat(cost_per_seat) || 0,
      notes: notes ? notes.trim() : null,
      status: 'OPEN',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureCarpoolTable(client);
        const insertQuery = `
          INSERT INTO carpools (
            id, society_id, driver_id, driver_name, driver_flat, driver_wing, driver_phone,
            origin, destination, departure_date, departure_time, vehicle_type, vehicle_number,
            available_seats, cost_per_seat, notes, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())
          RETURNING *
        `;
        const r = await client.query(insertQuery, [
          newCarpool.id, newCarpool.society_id, newCarpool.driver_id, newCarpool.driver_name,
          newCarpool.driver_flat, newCarpool.driver_wing, newCarpool.driver_phone,
          newCarpool.origin, newCarpool.destination, newCarpool.departure_date, newCarpool.departure_time,
          newCarpool.vehicle_type, newCarpool.vehicle_number, newCarpool.available_seats,
          newCarpool.cost_per_seat, newCarpool.notes, newCarpool.status
        ]);
        return res.status(201).json({ success: true, carpool: r.rows[0] });
      }).catch((err) => {
        console.error('Create carpool error:', err);
        return res.status(500).json({ error: 'Failed to create carpool' });
      });
    }

    const db = getDb();
    if (!db.get('carpools').value()) {
      db.set('carpools', []).write();
    }
    db.get('carpools').push(newCarpool).write();
    return res.status(201).json({ success: true, carpool: newCarpool });
  } catch (error) {
    console.error('Create carpool error:', error);
    return res.status(500).json({ error: 'Server error creating carpool' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const societyId = req.user.society_id;

    if (!['OPEN', 'FULL', 'COMPLETED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureCarpoolTable(client);
        const r = await client.query(
          `UPDATE carpools SET status = $1, updated_at = NOW() 
           WHERE id = $2 AND society_id = $3 RETURNING *`,
          [status, id, societyId]
        );
        if (r.rows.length === 0) return res.status(404).json({ error: 'Carpool not found' });
        return res.json({ success: true, carpool: r.rows[0] });
      });
    }

    const db = getDb();
    const item = db.get('carpools').find({ id, society_id: societyId }).value();
    if (!item) return res.status(404).json({ error: 'Carpool not found' });
    db.get('carpools').find({ id, society_id: societyId }).assign({ status, updated_at: new Date().toISOString() }).write();
    return res.json({ success: true, carpool: { ...item, status } });
  } catch (error) {
    console.error('Update carpool error:', error);
    return res.status(500).json({ error: 'Server error updating carpool' });
  }
};

exports.deleteCarpool = async (req, res) => {
  try {
    const { id } = req.params;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await ensureCarpoolTable(client);
        await client.query('DELETE FROM carpools WHERE id = $1 AND society_id = $2', [id, societyId]);
        return res.json({ success: true, message: 'Carpool deleted' });
      });
    }

    const db = getDb();
    db.get('carpools').remove({ id, society_id: societyId }).write();
    return res.json({ success: true, message: 'Carpool deleted' });
  } catch (error) {
    console.error('Delete carpool error:', error);
    return res.status(500).json({ error: 'Server error deleting carpool' });
  }
};
