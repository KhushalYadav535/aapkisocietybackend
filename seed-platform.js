const { pool, ensurePlatformSchema } = require('./src/config/postgres');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function init() {
  try {
    await ensurePlatformSchema();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform.societies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        registration_number TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        pincode TEXT,
        total_units INTEGER DEFAULT 0,
        total_wings INTEGER DEFAULT 1,
        contact_name TEXT,
        contact_email TEXT UNIQUE,
        contact_phone TEXT,
        password_hash TEXT,
        subscription_plan TEXT DEFAULT 'CORE',
        subscription_status TEXT DEFAULT 'TRIAL',
        onboarding_state TEXT DEFAULT 'REGISTRATION_FORM',
        kyc_documents JSONB,
        kyc_approved_by TEXT,
        kyc_approval_comment TEXT,
        kyc_approved_at TIMESTAMPTZ,
        renewal_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform.flats (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        flat_number TEXT NOT NULL,
        wing TEXT,
        floor INTEGER,
        flat_type TEXT,
        owner_name TEXT,
        owner_email TEXT,
        owner_phone TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('Platform schema and tables created successfully');

    const existing = await pool.query('SELECT COUNT(*) FROM platform.societies');
    if (parseInt(existing.rows[0].count) > 0) {
      console.log('Already seeded, skipping...');
      process.exit(0);
    }

    const societies = [
      { name: 'Sunrise Residency', reg: 'MH/2024/1234', city: 'Mumbai', state: 'Maharashtra', plan: 'AI_PRO', status: 'ACTIVE', units: 50, wings: 2, email: 'admin@sunrise.co.in' },
      { name: 'Green Valley Society', reg: 'MH/2024/5678', city: 'Pune', state: 'Maharashtra', plan: 'COMPLIANCE', status: 'ACTIVE', units: 30, wings: 1, email: 'admin@greenvalley.co.in' },
      { name: 'Harmony Heights', reg: 'KA/2025/9012', city: 'Bangalore', state: 'Karnataka', plan: 'CORE', status: 'TRIAL', units: 40, wings: 2, email: 'admin@harmony.co.in' },
      { name: 'Blue Sky Apartments', reg: 'DL/2025/3456', city: 'Delhi', state: 'Delhi', plan: 'AI_PRO', status: 'SUSPENDED', units: 25, wings: 1, email: 'admin@bluesky.co.in' },
      { name: 'Silver Oaks', reg: 'TN/2025/7890', city: 'Chennai', state: 'Tamil Nadu', plan: 'COMPLIANCE', status: 'ACTIVE', units: 60, wings: 3, email: 'admin@silveroaks.co.in' },
    ];

    for (const s of societies) {
      const id = uuidv4();
      const password = await bcrypt.hash('password123', 10);
      await pool.query(`
        INSERT INTO platform.societies (id, name, registration_number, city, state, total_units, total_wings, contact_name, contact_email, password_hash, subscription_plan, subscription_status, onboarding_state, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ACTIVE', NOW(), NOW())
      `, [id, s.name, s.reg, s.city, s.state, s.units, s.wings, 'Admin', s.email, password, s.plan, s.status]);

      for (let i = 1; i <= s.units; i++) {
        const flatId = uuidv4();
        const wing = s.wings > 1 ? 'A' : '';
        await pool.query(`
          INSERT INTO platform.flats (id, society_id, flat_number, wing) VALUES ($1, $2, $3, $4)
        `, [flatId, id, String(i).padStart(3, '0'), wing]);
      }
    }

    console.log('Seeded 5 sample societies with flats');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

init();