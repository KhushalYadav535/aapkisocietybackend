const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled, withTenant, ensurePlatformSchema } = require('../config/postgres');

const ensureStaffTables = async (societyId) => {
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS \"society_${societyId}\"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \"society_${societyId}\".staff (
        id TEXT PRIMARY KEY,
        society_id TEXT,
        name TEXT NOT NULL,
        phone TEXT,
        staff_type TEXT,
        address TEXT,
        aadhaar_number TEXT,
        salary NUMERIC DEFAULT 0,
        duty_timing TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \"society_${societyId}\".staff_attendance (
        id TEXT PRIMARY KEY,
        society_id TEXT,
        staff_id TEXT,
        attendance_date TIMESTAMPTZ,
        check_in TIMESTAMPTZ,
        check_out TIMESTAMPTZ,
        status TEXT DEFAULT 'PRESENT',
        staff_type TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
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
    const { date, staff_id, type } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureStaffTables(societyId).then(async () => {
        let query = `SELECT sa.*, s.name as staff_name, s.staff_type FROM \"society_${societyId}\".staff_attendance sa LEFT JOIN \"society_${societyId}\".staff s ON sa.staff_id = s.id WHERE 1=1`;
        const params = [];
        let idx = 1;

        if (date) { query += ` AND DATE(sa.attendance_date) = $${idx++}`; params.push(date); }
        if (staff_id) { query += ` AND sa.staff_id = $${idx++}`; params.push(staff_id); }
        if (type) { query += ` AND s.staff_type = $${idx++}`; params.push(type); }

        query += ' ORDER BY sa.attendance_date DESC, sa.check_in DESC';
        const r = await pool.query(query, params);
        return res.json({ records: r.rows });
      }).catch((err) => { console.error('Staff attendance error:', err.message); return res.status(500).json({ error: 'Failed to fetch attendance' }); });
    }

    const db = getDb();
    let records = db.get('staff_attendance').value() || [];

    if (date) records = records.filter(r => r.attendance_date && r.attendance_date.startsWith(date));
    if (staff_id) records = records.filter(r => r.staff_id === staff_id);
    if (type) records = records.filter(r => r.staff_type === type);

    records.sort((a, b) => new Date(b.attendance_date) - new Date(a.attendance_date));

    res.json({ records });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
};

exports.getStaff = (req, res) => {
  try {
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureStaffTables(societyId).then(async () => {
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".staff WHERE society_id = $1 AND is_active = 1 ORDER BY name`, [societyId]);
        return res.json({ staff: r.rows });
      }).catch((err) => { console.error('Get staff error:', err.message); return res.status(500).json({ error: 'Failed to fetch staff' }); });
    }

    const db = getDb();
    const staff = (db.get('staff').value() || []).filter(s => s.society_id === societyId);
    res.json({ staff });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
};

exports.createStaff = (req, res) => {
  try {
    const { name, phone, staff_type, address, aadhaar_number, salary, duty_timing } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureStaffTables(societyId).then(async () => {
        const id = uuidv4();
        await pool.query(
          `INSERT INTO \"society_${societyId}\".staff (id, society_id, name, phone, staff_type, address, aadhaar_number, salary, duty_timing, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10)`,
          [id, societyId, name, phone, staff_type, address, aadhaar_number, salary, duty_timing, now]
        );
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".staff WHERE id = $1`, [id]);
        return res.status(201).json({ staff: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to create staff' }));
    }

    const db = getDb();
    const staff = db.get('staff') || [];
    const newStaff = {
      id: uuidv4(), society_id: societyId, name, phone, staff_type,
      address, aadhaar_number, salary, duty_timing,
      is_active: 1, created_at: now, updated_at: now
    };
    db.get('staff').push(newStaff).write();
    res.status(201).json({ staff: newStaff });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create staff' });
  }
};

exports.checkIn = (req, res) => {
  try {
    const { staff_id } = req.body;
    const societyId = req.user.society_id;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    if (isPostgresEnabled) {
      return ensureStaffTables(societyId).then(async () => {
        const existing = await pool.query(
          `SELECT * FROM \"society_${societyId}\".staff_attendance WHERE staff_id = $1 AND DATE(attendance_date) = CURRENT_DATE`,
          [staff_id]
        );
        if (existing.rows.length > 0) {
          return res.status(400).json({ error: 'Already checked in today' });
        }
        const id = uuidv4();
        await pool.query(
          `INSERT INTO \"society_${societyId}\".staff_attendance (id, society_id, staff_id, attendance_date, check_in, status)
           VALUES ($1, $2, $3, $4, $5, 'PRESENT')`,
          [id, societyId, staff_id, now, now]
        );
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".staff_attendance WHERE id = $1`, [id]);
        return res.status(201).json({ record: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Check-in failed' }));
    }

    const db = getDb();
    const existing = db.get('staff_attendance').find(r =>
      r.staff_id === staff_id && r.attendance_date && r.attendance_date.startsWith(dateStr)
    ).value();

    if (existing) return res.status(400).json({ error: 'Already checked in today' });

    const record = {
      id: uuidv4(), society_id: societyId, staff_id, attendance_date: now.toISOString(),
      check_in: now.toISOString(), check_out: null, status: 'PRESENT', notes: null,
      created_at: now.toISOString()
    };
    db.get('staff_attendance').push(record).write();
    res.status(201).json({ record });
  } catch (error) {
    res.status(500).json({ error: 'Check-in failed' });
  }
};

exports.checkOut = (req, res) => {
  try {
    const { staff_id, notes } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureStaffTables(societyId).then(async () => {
        await pool.query(
          `UPDATE \"society_${societyId}\".staff_attendance
           SET check_out = $1, notes = COALESCE($2, notes)
           WHERE staff_id = $3 AND DATE(attendance_date) = CURRENT_DATE AND check_out IS NULL`,
          [now, notes, staff_id]
        );
        const r = await pool.query(
          `SELECT * FROM \"society_${societyId}\".staff_attendance WHERE staff_id = $1 AND DATE(attendance_date) = CURRENT_DATE`,
          [staff_id]
        );
        return res.json({ record: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Check-out failed' }));
    }

    const db = getDb();
    const record = db.get('staff_attendance').find(r =>
      r.staff_id === staff_id && r.attendance_date && r.attendance_date.startsWith(now.split('T')[0]) && !r.check_out
    ).value();

    if (!record) return res.status(400).json({ error: 'No active check-in found' });

    db.get('staff_attendance').find({ id: record.id }).assign({ check_out: now, notes: notes || record.notes }).write();
    res.json({ record: db.get('staff_attendance').find({ id: record.id }).value() });
  } catch (error) {
    res.status(500).json({ error: 'Check-out failed' });
  }
};

exports.markAbsent = (req, res) => {
  try {
    const { staff_id, date, reason } = req.body;
    const societyId = req.user.society_id;
    const now = new Date().toISOString();

    if (isPostgresEnabled) {
      return ensureStaffTables(societyId).then(async () => {
        const id = uuidv4();
        await pool.query(
          `INSERT INTO \"society_${societyId}\".staff_attendance (id, society_id, staff_id, attendance_date, status, notes)
           VALUES ($1, $2, $3, $4, 'ABSENT', $5)`,
          [id, societyId, staff_id, date || now.split('T')[0], reason]
        );
        const r = await pool.query(`SELECT * FROM \"society_${societyId}\".staff_attendance WHERE id = $1`, [id]);
        return res.status(201).json({ record: r.rows[0] });
      }).catch(() => res.status(500).json({ error: 'Failed to mark absent' }));
    }

    const db = getDb();
    const record = {
      id: uuidv4(), society_id: societyId, staff_id,
      attendance_date: (date || now.split('T')[0]) + 'T00:00:00.000Z',
      check_in: null, check_out: null, status: 'ABSENT',
      notes: reason, created_at: now
    };
    db.get('staff_attendance').push(record).write();
    res.status(201).json({ record });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark absent' });
  }
};

exports.getSummary = (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureStaffTables(societyId).then(async () => {
        const summaryRes = await pool.query(`
          SELECT
            staff_type,
            COUNT(*) FILTER (WHERE status = 'PRESENT') as present,
            COUNT(*) FILTER (WHERE status = 'ABSENT') as absent,
            COUNT(*) as total
          FROM \"society_${societyId}\".staff_attendance
          WHERE 1=1
          ${start_date ? `AND attendance_date >= '${start_date}'` : ''}
          ${end_date ? `AND attendance_date <= '${end_date}'` : ''}
          GROUP BY staff_type
        `);

        const staffCountRes = await pool.query(
          `SELECT staff_type, COUNT(*) as count FROM \"society_${societyId}\".staff WHERE is_active = 1 GROUP BY staff_type`
        );

        return res.json({ summary: summaryRes.rows, staffCount: staffCountRes.rows });
      }).catch(() => res.status(500).json({ error: 'Failed to fetch summary' }));
    }

    const db = getDb();
    let records = db.get('staff_attendance').value();
    if (start_date) records = records.filter(r => r.attendance_date >= start_date);
    if (end_date) records = records.filter(r => r.attendance_date <= end_date);

    const summary = {};
    records.forEach(r => {
      const type = r.staff_type || 'OTHER';
      if (!summary[type]) summary[type] = { present: 0, absent: 0, total: 0 };
      summary[type].total++;
      if (r.status === 'PRESENT') summary[type].present++;
      else if (r.status === 'ABSENT') summary[type].absent++;
    });

    const staff = db.get('staff').filter(s => s.is_active).value();
    const staffCount = {};
    staff.forEach(s => { staffCount[s.staff_type] = (staffCount[s.staff_type] || 0) + 1; });

    res.json({ summary: Object.entries(summary).map(([staff_type, data]) => ({ staff_type, ...data })), staffCount: Object.entries(staffCount).map(([staff_type, count]) => ({ staff_type, count })) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
};

exports.deactivate = (req, res) => {
  try {
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return ensureStaffTables(societyId).then(async () => {
        await pool.query(`UPDATE \"society_${societyId}\".staff SET is_active = 0 WHERE id = $1`, [req.params.id]);
        return res.json({ message: 'Staff deactivated' });
      }).catch(() => res.status(500).json({ error: 'Failed to deactivate' }));
    }

    const db = getDb();
    db.get('staff').find({ id: req.params.id }).assign({ is_active: 0 }).write();
    res.json({ message: 'Staff deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate staff' });
  }
};

exports.addReview = async (req, res) => {
  try {
    const { staff_id, rating, review_text } = req.body;
    const societyId = req.user.society_id;

    if (!staff_id || !rating) {
      return res.status(400).json({ error: 'Staff ID and rating (1-5) are required' });
    }

    const numRating = parseInt(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const reviewId = uuidv4();
    const residentName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Resident';
    const flatNumber = req.user.flat_number || 'N/A';
    const wing = req.user.wing || 'A';

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        await client.query(`
          INSERT INTO staff_reviews (
            id, society_id, staff_id, resident_id, resident_name,
            flat_number, wing, rating, review_text, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        `, [reviewId, societyId, staff_id, req.user.id, residentName, flatNumber, wing, numRating, review_text || '']);

        const aggRes = await client.query(`
          SELECT ROUND(AVG(rating), 1) as avg_rating, COUNT(*)::int as total_reviews
          FROM staff_reviews
          WHERE staff_id = $1 AND society_id = $2
        `, [staff_id, societyId]);

        const avg = aggRes.rows[0]?.avg_rating || numRating;
        const total = aggRes.rows[0]?.total_reviews || 1;

        try {
          await client.query(`
            UPDATE staff SET avg_rating = $1, total_reviews = $2 WHERE id = $3
          `, [avg, total, staff_id]);
        } catch (_) {}

        return res.status(201).json({
          success: true,
          review: { id: reviewId, staff_id, rating: numRating, review_text, resident_name: residentName, flat_number: flatNumber },
          stats: { avg_rating: avg, total_reviews: total }
        });
      });
    }

    const db = getDb();
    if (!db.get('staff_reviews').value()) {
      db.set('staff_reviews', []).write();
    }
    const newRev = {
      id: reviewId,
      society_id: societyId,
      staff_id,
      resident_id: req.user.id,
      resident_name: residentName,
      flat_number: flatNumber,
      wing,
      rating: numRating,
      review_text: review_text || '',
      created_at: new Date().toISOString()
    };
    db.get('staff_reviews').push(newRev).write();

    const allRevs = (db.get('staff_reviews').value() || []).filter(r => r.staff_id === staff_id);
    const avg = Math.round((allRevs.reduce((acc, r) => acc + r.rating, 0) / allRevs.length) * 10) / 10;

    return res.status(201).json({
      success: true,
      review: newRev,
      stats: { avg_rating: avg, total_reviews: allRevs.length }
    });
  } catch (error) {
    console.error('Add staff review error:', error);
    return res.status(500).json({ error: 'Server error submitting review' });
  }
};

exports.getReviews = async (req, res) => {
  try {
    const { staff_id } = req.query;
    const societyId = req.user.society_id;

    if (isPostgresEnabled) {
      return withTenant(societyId, async (client) => {
        let q = 'SELECT * FROM staff_reviews WHERE society_id = $1';
        let params = [societyId];
        if (staff_id) {
          params.push(staff_id);
          q += ` AND staff_id = $2`;
        }
        q += ' ORDER BY created_at DESC';
        const r = await client.query(q, params);
        return res.json({ reviews: r.rows });
      });
    }

    const db = getDb();
    let reviews = (db.get('staff_reviews').value() || []).filter(r => r.society_id === societyId);
    if (staff_id) {
      reviews = reviews.filter(r => r.staff_id === staff_id);
    }
    reviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return res.json({ reviews });
  } catch (error) {
    return res.status(500).json({ error: 'Server error fetching reviews' });
  }
};