const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { withTenant, isPostgresEnabled } = require('../config/postgres');

const ensureFacilityTables = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS facilities (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      name TEXT,
      description TEXT,
      type TEXT,
      capacity INTEGER,
      rate_per_hour NUMERIC DEFAULT 0,
      rate_per_day NUMERIC DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      rules TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS facility_bookings (
      id TEXT PRIMARY KEY,
      facility_id TEXT,
      society_id TEXT,
      booked_by TEXT,
      booking_date DATE,
      start_time TEXT,
      end_time TEXT,
      purpose TEXT,
      status TEXT,
      amount NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.getAll = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureFacilityTables(client);
        const r = await client.query('SELECT * FROM facilities WHERE society_id = $1', [req.user.society_id]);
        return res.json({ facilities: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch facilities' }));
    }
    const db = getDb();
    const facilities = db.get('facilities').filter({ society_id: req.user.society_id }).value();
    res.json({ facilities });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch facilities' });
  }
};

exports.getById = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureFacilityTables(client);
        const r = await client.query('SELECT * FROM facilities WHERE id = $1 LIMIT 1', [req.params.id]);
        const facility = r.rows[0];
        if (!facility) return res.status(404).json({ error: 'Facility not found' });
        return res.json({ facility });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch facility' }));
    }
    const db = getDb();
    const facility = db.get('facilities').find({ id: req.params.id }).value();
    if (!facility) return res.status(404).json({ error: 'Facility not found' });
    res.json({ facility });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch facility' });
  }
};

exports.create = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureFacilityTables(client);
        const { name, description, type, capacity, rate_per_hour, rate_per_day, rules } = req.body;
        const facility = {
          id: uuidv4(), society_id: req.user.society_id, name,
          description: description || null, type: type || 'COMMON_AREA',
          capacity: capacity || null, rate_per_hour: rate_per_hour || 0,
          rate_per_day: rate_per_day || 0, is_active: 1, rules: rules || null,
          created_at: new Date().toISOString()
        };
        await client.query(
          `INSERT INTO facilities (id,society_id,name,description,type,capacity,rate_per_hour,rate_per_day,is_active,rules,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [facility.id, facility.society_id, facility.name, facility.description, facility.type, facility.capacity, facility.rate_per_hour, facility.rate_per_day, facility.is_active, facility.rules, facility.created_at]
        );
        return res.status(201).json({ facility });
      }).catch(() => res.status(500).json({ error: 'Failed to create facility' }));
    }
    const db = getDb();
    const { name, description, type, capacity, rate_per_hour, rate_per_day, rules } = req.body;
    const facility = {
      id: uuidv4(), society_id: req.user.society_id, name,
      description: description || null, type: type || 'COMMON_AREA',
      capacity: capacity || null, rate_per_hour: rate_per_hour || 0,
      rate_per_day: rate_per_day || 0, is_active: 1, rules: rules || null,
      created_at: new Date().toISOString()
    };
    db.get('facilities').push(facility).write();
    res.status(201).json({ facility });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create facility' });
  }
};

exports.update = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureFacilityTables(client);
        const fields = ['name', 'description', 'type', 'capacity', 'rate_per_hour', 'rate_per_day', 'rules', 'is_active'];
        const setParts = [];
        const values = [];
        fields.forEach((f) => {
          if (req.body[f] !== undefined) {
            values.push(req.body[f]);
            setParts.push(`${f} = $${values.length}`);
          }
        });
        values.push(req.params.id);
        const setClause = setParts.length ? setParts.join(', ') : 'id = id';
        await client.query(`UPDATE facilities SET ${setClause} WHERE id = $${values.length}`, values);
        const r = await client.query('SELECT * FROM facilities WHERE id = $1 LIMIT 1', [req.params.id]);
        return res.json({ facility: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to update facility' }));
    }
    const db = getDb();
    const updates = {};
    ['name', 'description', 'type', 'capacity', 'rate_per_hour', 'rate_per_day', 'rules', 'is_active'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    db.get('facilities').find({ id: req.params.id }).assign(updates).write();
    const facility = db.get('facilities').find({ id: req.params.id }).value();
    res.json({ facility });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update facility' });
  }
};

exports.getBookings = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureFacilityTables(client);
        const r = await client.query('SELECT * FROM facility_bookings WHERE facility_id = $1 ORDER BY booking_date DESC', [req.params.id]);
        return res.json({ bookings: r.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch bookings' }));
    }
    const db = getDb();
    const bookings = db.get('facility_bookings').filter({ facility_id: req.params.id }).sortBy('booking_date').reverse().value();
    res.json({ bookings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

exports.book = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureFacilityTables(client);
        const { booking_date, start_time, end_time, purpose } = req.body;
        const f = await client.query('SELECT * FROM facilities WHERE id = $1 LIMIT 1', [req.params.id]);
        const facility = f.rows[0];
        if (!facility) return res.status(404).json({ error: 'Facility not found' });
        const booking = {
          id: uuidv4(), facility_id: req.params.id, society_id: req.user.society_id,
          booked_by: req.user.id, booking_date, start_time: start_time || null,
          end_time: end_time || null, purpose: purpose || null,
          status: 'CONFIRMED', amount: facility.rate_per_hour || 0,
          created_at: new Date().toISOString()
        };
        await client.query(
          `INSERT INTO facility_bookings (id,facility_id,society_id,booked_by,booking_date,start_time,end_time,purpose,status,amount,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [booking.id, booking.facility_id, booking.society_id, booking.booked_by, booking.booking_date, booking.start_time, booking.end_time, booking.purpose, booking.status, booking.amount, booking.created_at]
        );
        return res.status(201).json({ booking });
      }).catch(() => res.status(500).json({ error: 'Failed to book facility' }));
    }
    const db = getDb();
    const { booking_date, start_time, end_time, purpose } = req.body;
    const facility = db.get('facilities').find({ id: req.params.id }).value();
    if (!facility) return res.status(404).json({ error: 'Facility not found' });

    const booking = {
      id: uuidv4(), facility_id: req.params.id, society_id: req.user.society_id,
      booked_by: req.user.id, booking_date, start_time: start_time || null,
      end_time: end_time || null, purpose: purpose || null,
      status: 'CONFIRMED', amount: facility.rate_per_hour || 0,
      created_at: new Date().toISOString()
    };
    db.get('facility_bookings').push(booking).write();
    res.status(201).json({ booking });
  } catch (error) {
    res.status(500).json({ error: 'Failed to book facility' });
  }
};

exports.cancelBooking = (req, res) => {
  try {
    if (isPostgresEnabled && req.user.society_id) {
      return withTenant(req.user.society_id, async (client) => {
        await ensureFacilityTables(client);
        let query = 'UPDATE facility_bookings SET status = $1 WHERE id = $2';
        let params = ['CANCELLED', req.params.bookingId];
        if (req.user.role === 'RESIDENT') {
          query += ' AND booked_by = $3';
          params.push(req.user.id);
        }
        const result = await client.query(query, params);
        if (result.rowCount === 0) return res.status(403).json({ error: 'Not authorized or booking not found' });
        return res.json({ message: 'Booking cancelled' });
      }).catch(() => res.status(500).json({ error: 'Failed to cancel booking' }));
    }
    const db = getDb();
    const booking = db.get('facility_bookings').find({ id: req.params.bookingId }).value();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (req.user.role === 'RESIDENT' && booking.booked_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    db.get('facility_bookings').find({ id: req.params.bookingId }).assign({ status: 'CANCELLED' }).write();
    res.json({ message: 'Booking cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
};
