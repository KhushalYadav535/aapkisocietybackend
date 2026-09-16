const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { pool, isPostgresEnabled } = require('../config/postgres');
const { sendDemoBookingNotificationEmail } = require('../utils/email');
const { normalizePhone } = require('../utils/phone');

const ensureDemoBookingsTable = async (client) => {
  const c = client || pool;
  if (!c) return;
  await c.query(`
    CREATE TABLE IF NOT EXISTS platform.demo_bookings (
      id TEXT PRIMARY KEY,
      society_name TEXT NOT NULL,
      city TEXT,
      flat_count INTEGER DEFAULT 100,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      status TEXT DEFAULT 'NEW',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.bookDemo = async (req, res) => {
  try {
    const { societyName, city, flatCount, name, phone, email } = req.body;

    if (!societyName || !name || !phone) {
      return res.status(400).json({ error: 'Society Name, Contact Name, and Phone number are required.' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const parsedFlats = parseInt(flatCount, 10) || 100;
    const phoneData = normalizePhone(phone);
    const cleanedPhone = phoneData.clean || phone.trim();

    const booking = {
      id,
      society_name: societyName.trim(),
      city: (city || '').trim(),
      flat_count: parsedFlats,
      name: name.trim(),
      phone: cleanedPhone,
      display_phone: phoneData.display || cleanedPhone,
      email: (email || '').trim(),
      status: 'NEW',
      notes: null,
      created_at: now,
      updated_at: now,
    };

    // 1. Store in Database
    if (isPostgresEnabled && pool) {
      try {
        await ensureDemoBookingsTable(pool);
        await pool.query(`
          INSERT INTO platform.demo_bookings (
            id, society_name, city, flat_count, name, phone, email, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        `, [
          booking.id,
          booking.society_name,
          booking.city,
          booking.flat_count,
          booking.name,
          booking.phone,
          booking.email || null,
          booking.status,
        ]);
      } catch (dbErr) {
        console.error('[Demo-Controller] PostgreSQL save error:', dbErr.message);
      }
    }

    // LowDB Fallback
    try {
      const db = getDb();
      if (!db.has('demo_bookings').value()) {
        db.set('demo_bookings', []).write();
      }
      db.get('demo_bookings').push(booking).write();
    } catch (lowdbErr) {
      // Ignored if purely in postgres
    }

    // 2. High-Visibility Terminal Notice
    console.log(`\n=============================================================`);
    console.log(`🎉 [NEW DEMO WALKTHROUGH BOOKED]`);
    console.log(`Society : ${booking.society_name} (${booking.flat_count} Flats, ${booking.city})`);
    console.log(`Contact : ${booking.name} | Phone: ${booking.phone} (${booking.display_phone}) | Email: ${booking.email || 'N/A'}`);
    console.log(`Dispatched to: ${process.env.DEMO_NOTIFICATION_EMAILS || 'khushalyadav535@gmail.com'}`);
    console.log(`=============================================================\n`);

    // 3. Dispatch Email Notification
    sendDemoBookingNotificationEmail({
      ...booking,
      societyName: booking.society_name,
      flatCount: booking.flat_count
    }).catch(mailErr => {
      console.error('[Demo-Controller] Email dispatch error:', mailErr.message);
    });

    return res.status(201).json({
      success: true,
      message: 'Demo request received successfully! Our specialist will reach out shortly.',
      booking: {
        id: booking.id,
        society_name: booking.society_name,
        name: booking.name,
        phone: booking.phone
      }
    });

  } catch (error) {
    console.error('[Demo-Controller] Error booking demo:', error);
    return res.status(500).json({ error: 'Internal server error processing demo request.' });
  }
};

exports.getAllDemoBookings = async (req, res) => {
  try {
    if (isPostgresEnabled && pool) {
      await ensureDemoBookingsTable(pool);
      const r = await pool.query('SELECT * FROM platform.demo_bookings ORDER BY created_at DESC');
      return res.json({ bookings: r.rows });
    }
    const db = getDb();
    const bookings = db.get('demo_bookings').value() || [];
    return res.json({ bookings });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve demo bookings' });
  }
};
