/**
 * AapkiSociety — PostgreSQL Production Seeder
 * Run: node src/seeders/seed.postgres.js
 *
 * Requires DATABASE_URL in .env (or set as env variable before running)
 * Example:
 *   $env:DATABASE_URL="postgresql://Sentient%20Database:Sentient1234%40@213.210.37.237:32769/rwgpCqF1XHG9teUO"
 *   node src/seeders/seed.postgres.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set. Add it to .env or set it as an environment variable.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🔗 Connected to PostgreSQL...');

    // ─── 1. Platform Schema & Tables ────────────────────────────────────────
    await client.query('CREATE SCHEMA IF NOT EXISTS platform');

    await client.query(`
      CREATE TABLE IF NOT EXISTS platform.societies (
        id TEXT PRIMARY KEY, name TEXT, registration_number TEXT,
        address TEXT, city TEXT, state TEXT, pincode TEXT,
        gst_number TEXT, pan_number TEXT, gst_status TEXT,
        total_units INTEGER DEFAULT 0, total_wings INTEGER DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        subscription_plan TEXT DEFAULT 'CORE',
        subscription_status TEXT DEFAULT 'REGISTRATION_FORM',
        onboarding_state TEXT DEFAULT 'REGISTRATION_FORM',
        verification_token TEXT,
        kyc_documents JSONB DEFAULT '{}',
        kyc_approved_by TEXT, kyc_approval_comment TEXT, kyc_approved_at TIMESTAMPTZ,
        kyc_rejected_by TEXT, kyc_rejection_reason TEXT, kyc_rejected_at TIMESTAMPTZ,
        reapplication_unlocked_at TIMESTAMPTZ,
        active_modules JSONB DEFAULT '[]',
        contact_name TEXT, contact_email TEXT, contact_phone TEXT,
        bank_name TEXT, bank_account_number TEXT, bank_ifsc TEXT,
        renewal_date DATE,
        subscription_action TEXT, subscription_action_reason TEXT,
        subscription_action_by TEXT, subscription_action_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS platform.wings (
        id TEXT PRIMARY KEY, society_id TEXT, name TEXT,
        total_floors INTEGER DEFAULT 0, flats_per_floor INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS platform.flats (
        id TEXT PRIMARY KEY, society_id TEXT, wing_id TEXT,
        flat_number TEXT, floor_number INTEGER, area_sqft NUMERIC,
        flat_type TEXT, is_occupied INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS platform.notifications (
        id TEXT PRIMARY KEY, title TEXT, message TEXT,
        type TEXT DEFAULT 'SYSTEM',
        target_type TEXT DEFAULT 'ALL',
        target_id TEXT, target_society_id TEXT,
        priority TEXT DEFAULT 'NORMAL',
        action_url TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS platform.scrollers (
        id TEXT PRIMARY KEY, level TEXT DEFAULT 'PLATFORM',
        message TEXT, urgency_level TEXT DEFAULT 'NORMAL',
        start_at TIMESTAMPTZ, end_at TIMESTAMPTZ,
        target_audience TEXT DEFAULT 'ALL',
        created_by TEXT, impressions INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS platform.users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL, first_name TEXT, last_name TEXT,
        role TEXT NOT NULL, society_id TEXT, flat_number TEXT,
        wing TEXT, phone TEXT, avatar_url TEXT,
        is_active INTEGER DEFAULT 1, is_verified INTEGER DEFAULT 1,
        mfa_enabled INTEGER DEFAULT 0, mfa_method TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('✅ Platform schema & tables ready');

    // ─── 2. Wipe existing seed data (safe re-run) ───────────────────────────
    await client.query(`DELETE FROM platform.users WHERE email LIKE '%@sunrise.com' OR email = 'platform@aapkisociety.com'`);
    await client.query(`DELETE FROM platform.wings WHERE society_id IN (SELECT id FROM platform.societies WHERE name = 'Sunrise Heights CHS')`);
    await client.query(`DELETE FROM platform.flats WHERE society_id IN (SELECT id FROM platform.societies WHERE name = 'Sunrise Heights CHS')`);
    await client.query(`DELETE FROM platform.societies WHERE name = 'Sunrise Heights CHS'`);

    const now = new Date().toISOString();
    const societyId = uuidv4();

    // ─── 3. Society ──────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO platform.societies
        (id,name,registration_number,address,city,state,pincode,total_units,total_wings,status,subscription_plan,subscription_status,onboarding_state,active_modules,gst_status,contact_name,contact_email,contact_phone,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    `, [
      societyId, 'Sunrise Heights CHS', 'MH/CHS/2024/1234',
      '123, MG Road, Andheri West', 'Mumbai', 'Maharashtra', '400053',
      120, 4, 'ACTIVE', 'AI_PRO', 'ACTIVE',
      'ACTIVE',
      JSON.stringify(['MEMBERS', 'BILLING', 'NOTICES', 'COMPLAINTS', 'VISITORS', 'FACILITIES', 'PROPERTY_LISTINGS', 'SCRollER']),
      'REGISTERED', 'Admin User', 'admin@sunrise.com', '9876543210',
      now, now
    ]);
    console.log('✅ Society created');

    // ─── 4. Wings ────────────────────────────────────────────────────────────
    const wingNames = ['A', 'B', 'C', 'D'];
    const wingIds = {};
    for (const w of wingNames) {
      const wid = uuidv4();
      wingIds[w] = wid;
      await client.query(`
        INSERT INTO platform.wings (id,society_id,name,total_floors,flats_per_floor,created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [wid, societyId, `Wing ${w}`, 10, 4, now]);
    }
    console.log('✅ Wings created (A, B, C, D)');

    // ─── 5. Flats ────────────────────────────────────────────────────────────
    const flatTypes = ['1BHK', '2BHK', '3BHK'];
    for (const w of wingNames) {
      for (let floor = 1; floor <= 3; floor++) {
        for (let flat = 1; flat <= 4; flat++) {
          await client.query(`
            INSERT INTO platform.flats (id,society_id,wing_id,flat_number,floor_number,area_sqft,flat_type,is_occupied,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `, [
            uuidv4(), societyId, wingIds[w],
            `${w}-${floor}0${flat}`, floor,
            850 + Math.floor(Math.random() * 500),
            flatTypes[Math.floor(Math.random() * 3)],
            1, now
          ]);
        }
      }
    }
    console.log('✅ Flats created (48 flats across 4 wings)');

    // ─── 6. Users ────────────────────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash('Admin@123', 12);
    const adminId = uuidv4();
    const treasurerId = uuidv4();

    const mkUser = (id, email, first, last, phone, role, flat, wing) => [
      id, email, hashedPassword, first, last, role,
      role === 'PLATFORM_ADMIN' ? null : societyId,
      flat, wing, phone, null, 1, 1, 0, now, now
    ];

    const userInsertSQL = `
      INSERT INTO platform.users
        (id,email,password,first_name,last_name,role,society_id,flat_number,wing,phone,avatar_url,is_active,is_verified,mfa_enabled,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (email) DO NOTHING
    `;

    await client.query(userInsertSQL, mkUser(uuidv4(), 'platform@aapkisociety.com', 'Platform', 'Admin', '9999999999', 'PLATFORM_ADMIN', null, null));
    await client.query(userInsertSQL, mkUser(adminId, 'admin@sunrise.com', 'Rajesh', 'Sharma', '9876543210', 'ADMIN', 'A-101', 'A'));
    await client.query(userInsertSQL, mkUser(treasurerId, 'treasurer@sunrise.com', 'Priya', 'Patel', '9876543211', 'TREASURER', 'A-102', 'A'));
    await client.query(userInsertSQL, mkUser(uuidv4(), 'committee@sunrise.com', 'Amit', 'Desai', '9876543212', 'COMMITTEE', 'B-201', 'B'));

    const residentDefs = [
      { first: 'Suresh', last: 'Kumar',  flat: 'A-301', wing: 'A' },
      { first: 'Meena',  last: 'Iyer',   flat: 'A-401', wing: 'A' },
      { first: 'Vikram', last: 'Singh',  flat: 'B-101', wing: 'B' },
      { first: 'Neha',   last: 'Gupta',  flat: 'B-301', wing: 'B' },
      { first: 'Arun',   last: 'Joshi',  flat: 'C-101', wing: 'C' },
      { first: 'Kavita', last: 'Reddy',  flat: 'C-201', wing: 'C' },
      { first: 'Deepak', last: 'Nair',   flat: 'D-101', wing: 'D' },
      { first: 'Anjali', last: 'Mehta',  flat: 'D-201', wing: 'D' },
    ];

    const residentIds = [];
    for (const r of residentDefs) {
      const rid = uuidv4();
      residentIds.push(rid);
      const phone = `98765${Math.floor(10000 + Math.random() * 90000)}`;
      await client.query(userInsertSQL, mkUser(rid, `${r.first.toLowerCase()}@sunrise.com`, r.first, r.last, phone, 'RESIDENT', r.flat, r.wing));
    }
    console.log(`✅ Users created (1 Platform Admin, 3 Staff, ${residentDefs.length} Residents)`);

    // ─── 7. Tenant Schema ────────────────────────────────────────────────────
    const tenantSchema = `society_${societyId.replace(/-/g, '_')}`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${tenantSchema}"`);
    await client.query(`SET search_path TO "${tenantSchema}", platform, public`);

    // Tenant tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        id TEXT PRIMARY KEY, society_id TEXT, raised_by TEXT, assigned_to TEXT,
        title TEXT, description TEXT, category TEXT, priority TEXT, status TEXT,
        resolution_notes TEXT, resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS notices (
        id TEXT PRIMARY KEY, society_id TEXT, title TEXT, content TEXT,
        category TEXT, priority TEXT, published_by TEXT,
        is_published INTEGER DEFAULT 0, publish_date TIMESTAMPTZ,
        expiry_date DATE, attachment_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        id TEXT PRIMARY KEY, society_id TEXT, visitor_name TEXT,
        visitor_phone TEXT, purpose TEXT, flat_id TEXT,
        visiting_member_id TEXT, vehicle_number TEXT,
        check_in TIMESTAMPTZ, check_out TIMESTAMPTZ, status TEXT,
        approved_by TEXT, guard_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS facilities (
        id TEXT PRIMARY KEY, society_id TEXT, name TEXT, description TEXT,
        type TEXT, capacity INTEGER, rate_per_hour NUMERIC DEFAULT 0,
        rate_per_day NUMERIC DEFAULT 0, is_active INTEGER DEFAULT 1,
        rules TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS bills (
        id TEXT PRIMARY KEY, society_id TEXT, flat_id TEXT, member_id TEXT,
        bill_number TEXT, bill_date DATE, due_date DATE,
        amount NUMERIC, tax_amount NUMERIC, total_amount NUMERIC,
        paid_amount NUMERIC DEFAULT 0, status TEXT, bill_type TEXT,
        billing_period TEXT, description TEXT, created_by TEXT, approved_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY, society_id TEXT, bill_id TEXT, member_id TEXT,
        amount NUMERIC, payment_method TEXT, payment_reference TEXT,
        gateway_transaction_id TEXT, status TEXT,
        payment_date TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log(`✅ Tenant schema '${tenantSchema}' ready`);

    // ─── 8. Complaints ───────────────────────────────────────────────────────
    const complaintDefs = [
      { title: 'Water leakage in parking area',    category: 'PLUMBING',   priority: 'HIGH',   status: 'OPEN' },
      { title: 'Lift not working in Wing B',       category: 'ELECTRICAL', priority: 'URGENT', status: 'IN_PROGRESS' },
      { title: 'Garden maintenance required',      category: 'GENERAL',    priority: 'LOW',    status: 'RESOLVED' },
      { title: 'Security camera not functioning',  category: 'SECURITY',   priority: 'HIGH',   status: 'OPEN' },
      { title: 'Common area lights flickering',    category: 'ELECTRICAL', priority: 'MEDIUM', status: 'IN_PROGRESS' },
    ];
    for (const c of complaintDefs) {
      await client.query(`
        INSERT INTO complaints (id,society_id,raised_by,assigned_to,title,description,category,priority,status,resolution_notes,resolved_at,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [
        uuidv4(), societyId,
        residentIds[Math.floor(Math.random() * residentIds.length)],
        null, c.title, null, c.category, c.priority, c.status,
        c.status === 'RESOLVED' ? 'Issue resolved by maintenance team' : null,
        c.status === 'RESOLVED' ? now : null,
        now, now
      ]);
    }
    console.log('✅ Complaints seeded (5)');

    // ─── 9. Notices ──────────────────────────────────────────────────────────
    const noticeDefs = [
      { title: 'Annual General Meeting - June 2026', content: 'Dear residents, the AGM is scheduled for June 15, 2026 at 6:00 PM in the community hall. All members are requested to attend.', category: 'AGM', priority: 'HIGH' },
      { title: 'Water Tank Cleaning Schedule',       content: 'Water tank cleaning will be done on May 20, 2026. Please store water for the day.',                                            category: 'MAINTENANCE', priority: 'NORMAL' },
      { title: 'Diwali Celebration 2026',            content: 'Society Diwali celebration planned for October. Suggestions welcome from all residents.',                                      category: 'EVENT',       priority: 'NORMAL' },
      { title: 'New Parking Rules Effective June 1', content: 'New parking allocation rules will be effective from June 1, 2026. Please check the notice board for details.',               category: 'RULES',       priority: 'HIGH' },
    ];
    for (const n of noticeDefs) {
      await client.query(`
        INSERT INTO notices (id,society_id,title,content,category,priority,published_by,is_published,publish_date,expiry_date,attachment_url,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [uuidv4(), societyId, n.title, n.content, n.category, n.priority, adminId, 1, now, null, null, now, now]);
    }
    console.log('✅ Notices seeded (4)');

    // ─── 10. Visitors ────────────────────────────────────────────────────────
    const visitorDefs = [
      { name: 'Ramesh Delivery', phone: '9876500001', purpose: 'Package Delivery', status: 'CHECKED_OUT' },
      { name: 'Anil Plumber',    phone: '9876500002', purpose: 'Plumbing Repair',  status: 'CHECKED_IN' },
      { name: 'Sita Verma',      phone: '9876500003', purpose: 'Guest Visit',      status: 'CHECKED_IN' },
      { name: 'Courier Service', phone: '9876500004', purpose: 'Document Delivery',status: 'CHECKED_OUT' },
    ];
    for (const v of visitorDefs) {
      await client.query(`
        INSERT INTO visitors (id,society_id,visitor_name,visitor_phone,purpose,flat_id,visiting_member_id,vehicle_number,check_in,check_out,status,approved_by,guard_notes,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `, [
        uuidv4(), societyId, v.name, v.phone, v.purpose,
        null, null, null, now,
        v.status === 'CHECKED_OUT' ? now : null,
        v.status, null, null, now
      ]);
    }
    console.log('✅ Visitors seeded (4)');

    // ─── 11. Facilities ──────────────────────────────────────────────────────
    const facilityDefs = [
      { name: 'Community Hall',         type: 'HALL',        capacity: 200, rate_per_hour: 500, rate_per_day: 5000 },
      { name: 'Swimming Pool',          type: 'POOL',        capacity: 30,  rate_per_hour: 0,   rate_per_day: 0 },
      { name: 'Gymnasium',              type: 'GYM',         capacity: 20,  rate_per_hour: 0,   rate_per_day: 0 },
      { name: "Children's Play Area",   type: 'PLAYGROUND',  capacity: 50,  rate_per_hour: 0,   rate_per_day: 0 },
      { name: 'EV Charging Station',    type: 'EV_CHARGING', capacity: 4,   rate_per_hour: 15,  rate_per_day: 0 },
    ];
    for (const f of facilityDefs) {
      await client.query(`
        INSERT INTO facilities (id,society_id,name,description,type,capacity,rate_per_hour,rate_per_day,is_active,rules,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [uuidv4(), societyId, f.name, null, f.type, f.capacity, f.rate_per_hour, f.rate_per_day, 1, null, now]);
    }
    console.log('✅ Facilities seeded (5)');

    // ─── 12. Bills ───────────────────────────────────────────────────────────
    const billStatuses = ['PENDING', 'APPROVED', 'PAID', 'OVERDUE'];
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
    const tenDaysLater = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];
    const billIds = [];
    for (const rid of residentIds) {
      const status = billStatuses[Math.floor(Math.random() * billStatuses.length)];
      const bid = uuidv4();
      billIds.push({ id: bid, memberId: rid, status });
      await client.query(`
        INSERT INTO bills (id,society_id,flat_id,member_id,bill_number,bill_date,due_date,amount,tax_amount,total_amount,paid_amount,status,bill_type,billing_period,description,created_by,approved_by,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `, [
        bid, societyId, null, rid,
        `BIL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`,
        fiveDaysAgo, tenDaysLater, 3500, 0, 3500,
        status === 'PAID' ? 3500 : 0,
        status, 'MAINTENANCE', 'May 2026', null,
        adminId, null, now, now
      ]);
    }
    console.log('✅ Bills seeded (8)');

    // ─── 13. Payments ────────────────────────────────────────────────────────
    const payMethods = ['UPI', 'NACH', 'NEFT', 'CASH', 'CHEQUE'];
    for (let i = 0; i < 5; i++) {
      const pDate = new Date(Date.now() - i * 86400000).toISOString();
      await client.query(`
        INSERT INTO payments (id,society_id,bill_id,member_id,amount,payment_method,payment_reference,gateway_transaction_id,status,payment_date,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        uuidv4(), societyId, null,
        residentIds[i % residentIds.length], 3500,
        payMethods[i], null, null, 'SUCCESS', pDate, pDate
      ]);
    }
    console.log('✅ Payments seeded (5)');

    // ─── Done ────────────────────────────────────────────────────────────────
    console.log('\n🎉 Production database seeded successfully!\n');
    console.log('📋 Login Credentials (password: Admin@123 for all):');
    console.log('   Platform Admin : platform@aapkisociety.com');
    console.log('   Society Admin  : admin@sunrise.com');
    console.log('   Treasurer      : treasurer@sunrise.com');
    console.log('   Committee      : committee@sunrise.com');
    console.log('   Resident       : suresh@sunrise.com (and 7 others)');
    console.log(`\n   Society ID     : ${societyId}`);
    console.log(`   Tenant Schema  : ${tenantSchema}`);

  } catch (err) {
    console.error('\n❌ Seed failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

seed();
