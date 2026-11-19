const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : null;
const isPostgresEnabled = !!pool;
const isPostgresOnly = String(process.env.POSTGRES_ONLY || 'false').toLowerCase() === 'true';
const getTenantSchemaName = (tenantId) => `society_${String(tenantId).replace(/-/g, '_')}`;

/**
 * Ensures platform.societies matches what platform/society flows expect.
 * Older deployments only had a minimal table from society.controller; ALTER adds missing columns.
 */
// ─── Schema-init caching ────────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS + ALTER TABLE queries are expensive (~200-600ms).
// They only need to run once per process boot; afterwards the result is cached.
let _societiesSchemaReady = false;
let _societiesSchemaPromise = null;
let _dbExistsChecked = false;

const ensureDatabaseExists = async () => {
  if (!connectionString || _dbExistsChecked) return;
  _dbExistsChecked = true;
  try {
    const url = new URL(connectionString);
    const dbName = url.pathname.replace(/^\//, '');
    if (!dbName || dbName === 'postgres') return;

    const adminUrl = new URL(connectionString);
    adminUrl.pathname = '/postgres';
    const { Client } = require('pg');
    const adminClient = new Client({ connectionString: adminUrl.toString() });
    await adminClient.connect();
    const res = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rows.length === 0) {
      console.log(`Creating PostgreSQL database "${dbName}"...`);
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ PostgreSQL database "${dbName}" created successfully!`);
    }
    await adminClient.end();
  } catch (_) {
    // If PostgreSQL isn't running or /postgres is inaccessible, proceed to let LowDB fallback handle it
  }
};

const ensurePlatformSocietiesSchema = async () => {
  if (!pool) return;
  if (_societiesSchemaReady) return;
  if (_societiesSchemaPromise) return _societiesSchemaPromise;
  _societiesSchemaPromise = _doEnsurePlatformSocietiesSchema()
    .then(() => { _societiesSchemaReady = true; })
    .catch((err) => { _societiesSchemaPromise = null; throw err; });
  return _societiesSchemaPromise;
};

const _doEnsurePlatformSocietiesSchema = async () => {
  if (!pool) return;
  await ensureDatabaseExists();
  await pool.query('CREATE SCHEMA IF NOT EXISTS platform');
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
      gst_status TEXT,
      total_units INTEGER DEFAULT 0,
      total_wings INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      subscription_plan TEXT DEFAULT 'CORE',
      subscription_status TEXT DEFAULT 'REGISTRATION_FORM',
      onboarding_state TEXT DEFAULT 'REGISTRATION_FORM',
      verification_token TEXT,
      kyc_documents JSONB DEFAULT '{}'::jsonb,
      kyc_approved_by TEXT,
      kyc_approval_comment TEXT,
      kyc_approved_at TIMESTAMPTZ,
      kyc_rejected_by TEXT,
      kyc_rejection_reason TEXT,
      kyc_rejected_at TIMESTAMPTZ,
      reapplication_unlocked_at TIMESTAMPTZ,
      active_modules JSONB DEFAULT '[]'::jsonb,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      bank_name TEXT,
      bank_account_number TEXT,
      bank_ifsc TEXT,
      renewal_date DATE,
      subscription_action TEXT,
      subscription_action_reason TEXT,
      subscription_action_by TEXT,
      subscription_action_at TIMESTAMPTZ,
      password_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      settings JSONB DEFAULT '{}'::jsonb
    )
  `);
  const alters = [
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS name TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS registration_number TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS address TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS city TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS state TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS pincode TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS gst_number TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS pan_number TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS gst_status TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS total_units INTEGER DEFAULT 0`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS total_wings INTEGER DEFAULT 0`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING'`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'CORE'`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'REGISTRATION_FORM'`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS onboarding_state TEXT DEFAULT 'REGISTRATION_FORM'`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS verification_token TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS kyc_documents JSONB DEFAULT '{}'::jsonb`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS kyc_approved_by TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS kyc_approval_comment TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS kyc_approved_at TIMESTAMPTZ`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS kyc_rejected_by TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS kyc_rejected_at TIMESTAMPTZ`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS reapplication_unlocked_at TIMESTAMPTZ`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS active_modules JSONB DEFAULT '[]'::jsonb`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS contact_name TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS contact_email TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS contact_phone TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS bank_name TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS bank_account_number TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS bank_ifsc TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS renewal_date DATE`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS subscription_action TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS subscription_action_reason TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS subscription_action_by TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS subscription_action_at TIMESTAMPTZ`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS password_hash TEXT`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb`
  ];
  for (const sql of alters) {
    await pool.query(sql);
  }
};

let _platformSchemaReady = false;
let _platformSchemaPromise = null;

const ensurePlatformSchema = async () => {
  if (!pool) return;
  if (_platformSchemaReady) return;
  if (_platformSchemaPromise) return _platformSchemaPromise;
  _platformSchemaPromise = _doEnsurePlatformSchema()
    .then(() => { _platformSchemaReady = true; })
    .catch((err) => { _platformSchemaPromise = null; throw err; });
  return _platformSchemaPromise;
};

const _doEnsurePlatformSchema = async () => {
  if (!pool) return;
  await ensureDatabaseExists();
  await pool.query('CREATE SCHEMA IF NOT EXISTS platform');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      role TEXT NOT NULL,
      society_id TEXT,
      flat_number TEXT,
      wing TEXT,
      phone TEXT,
      avatar_url TEXT,
      is_active INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 1,
      mfa_enabled INTEGER DEFAULT 0,
      mfa_method TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT,
      body TEXT,
      type TEXT DEFAULT 'INFO',
      is_read INTEGER DEFAULT 0,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.scrollers (
      id TEXT PRIMARY KEY,
      level TEXT DEFAULT 'PLATFORM',
      message TEXT,
      urgency_level TEXT DEFAULT 'NORMAL',
      start_at TIMESTAMPTZ,
      end_at TIMESTAMPTZ,
      target_audience TEXT DEFAULT 'ALL',
      target_wing TEXT,
      created_by TEXT,
      impressions INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      scroll_speed TEXT DEFAULT 'MEDIUM',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform.export_history (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      society_id TEXT,
      export_type TEXT,
      report_type TEXT,
      format TEXT,
      row_count INTEGER DEFAULT 0,
      file_size INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Migrate: add scroll_speed column if missing on existing scrollers table, and blood_group on users
  try {
    await pool.query(`ALTER TABLE platform.scrollers ADD COLUMN IF NOT EXISTS scroll_speed TEXT DEFAULT 'MEDIUM'`);
    await pool.query(`ALTER TABLE platform.users ADD COLUMN IF NOT EXISTS blood_group TEXT`);
  } catch (_) { }
  await ensurePlatformSocietiesSchema();

  // Auto-heal orphaned users who have no society_id assigned
  try {
    await pool.query(`
      UPDATE platform.users
      SET society_id = (SELECT id FROM platform.societies WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1)
      WHERE (society_id IS NULL OR society_id = '') AND role != 'PLATFORM_ADMIN'
        AND EXISTS (SELECT 1 FROM platform.societies WHERE status = 'ACTIVE');
    `);
  } catch (err) {
    console.error('Failed to heal orphaned users in platform.users:', err.message);
  }
};

const createTenantSchema = async (tenantId) => {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const schema = getTenantSchemaName(tenantId);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

  // Provision core tenant tables so dashboard & module queries never hit missing-relation errors
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}", platform, public`);
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, code TEXT, name TEXT, category TEXT,
        sub_category TEXT, group_name TEXT, sub_group TEXT,
        opening_balance NUMERIC DEFAULT 0, current_balance NUMERIC DEFAULT 0,
        is_active INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS vouchers (
        id TEXT PRIMARY KEY, voucher_number TEXT, voucher_type TEXT,
        voucher_date DATE, narration TEXT, status TEXT DEFAULT 'DRAFT',
        created_by TEXT, approved_by TEXT, reversed_by_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS voucher_entries (
        id TEXT PRIMARY KEY, voucher_id TEXT, account_id TEXT,
        debit_amount NUMERIC DEFAULT 0, credit_amount NUMERIC DEFAULT 0,
        narration TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS scrollers (
        id TEXT PRIMARY KEY, level TEXT DEFAULT 'SOCIETY',
        message TEXT, urgency_level TEXT DEFAULT 'NORMAL',
        start_at TIMESTAMPTZ, end_at TIMESTAMPTZ,
        target_audience TEXT DEFAULT 'ALL', target_wing TEXT,
        scroll_speed TEXT DEFAULT 'MEDIUM',
        created_by TEXT, impressions INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS property_listings (
        id TEXT PRIMARY KEY, society_id TEXT, listing_type TEXT,
        flat_number TEXT, wing TEXT, floor INTEGER, carpet_area NUMERIC,
        super_builtup_area NUMERIC, bedrooms INTEGER, bathrooms INTEGER,
        parking INTEGER, price NUMERIC, rent_amount NUMERIC,
        furnishing TEXT, available_from DATE, description TEXT,
        contact_name TEXT, contact_phone TEXT, photos JSONB DEFAULT '[]',
        visibility TEXT DEFAULT 'PUBLIC',
        status TEXT DEFAULT 'PENDING_PAYMENT', created_by TEXT,
        fee_amount NUMERIC DEFAULT 0, paid_amount NUMERIC DEFAULT 0,
        approved_by TEXT, approved_at TIMESTAMPTZ, rejection_reason TEXT,
        expires_at TIMESTAMPTZ, duration_days INTEGER DEFAULT 30,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS facility_bookings (
        id TEXT PRIMARY KEY, society_id TEXT, facility_id TEXT,
        booked_by TEXT, booking_date DATE, start_time TEXT, end_time TEXT,
        purpose TEXT, status TEXT DEFAULT 'PENDING',
        approved_by TEXT, amount NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // RBAC Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS position_master (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        is_elected INTEGER DEFAULT 0,
        hierarchy_order INTEGER DEFAULT 99,
        is_system_defined INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        module TEXT NOT NULL,
        action TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
        permission_id TEXT REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS position_roles (
        position_id TEXT REFERENCES position_master(id) ON DELETE CASCADE,
        role_id TEXT REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (position_id, role_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS society_position_assignments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        position_id TEXT REFERENCES position_master(id) ON DELETE CASCADE,
        start_date DATE,
        end_date DATE,
        status TEXT DEFAULT 'ACTIVE',
        election_reference TEXT,
        delegated_to_user_id TEXT,
        delegation_start DATE,
        delegation_end DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS parcels (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        flat_number TEXT NOT NULL,
        wing TEXT NOT NULL,
        recipient_name TEXT,
        delivery_company TEXT NOT NULL,
        tracking_number TEXT,
        parcel_count INTEGER DEFAULT 1,
        pickup_pin TEXT NOT NULL,
        status TEXT DEFAULT 'AT_GATE',
        photo_url TEXT,
        notes TEXT,
        received_by_guard_id TEXT,
        collected_by_name TEXT,
        collected_at TIMESTAMPTZ,
        returned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS move_requests (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        user_id TEXT,
        request_type TEXT NOT NULL,
        applicant_name TEXT NOT NULL,
        applicant_phone TEXT NOT NULL,
        applicant_email TEXT,
        flat_number TEXT NOT NULL,
        wing TEXT NOT NULL,
        move_date DATE NOT NULL,
        time_slot TEXT NOT NULL,
        vehicle_number TEXT,
        mover_agency TEXT,
        status TEXT DEFAULT 'PENDING',
        rejection_reason TEXT,
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        certificate_number TEXT,
        verification_token TEXT,
        documents JSONB DEFAULT '[]'::jsonb,
        lift_charges_paid INTEGER DEFAULT 0,
        security_deposit NUMERIC DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_items (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        seller_name TEXT NOT NULL,
        seller_flat TEXT NOT NULL,
        seller_wing TEXT NOT NULL,
        seller_phone TEXT,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        listing_type TEXT DEFAULT 'SELL',
        price NUMERIC DEFAULT 0,
        original_price NUMERIC,
        condition TEXT DEFAULT 'GOOD',
        photos JSONB DEFAULT '[]'::jsonb,
        status TEXT DEFAULT 'AVAILABLE',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_reviews (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        staff_id TEXT NOT NULL,
        resident_id TEXT NOT NULL,
        resident_name TEXT NOT NULL,
        flat_number TEXT NOT NULL,
        wing TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        review_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS blood_requests (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        requester_name TEXT NOT NULL,
        flat_number TEXT NOT NULL,
        wing TEXT,
        blood_group_needed TEXT NOT NULL,
        patient_name TEXT,
        hospital_name TEXT NOT NULL,
        contact_phone TEXT NOT NULL,
        units_needed INTEGER DEFAULT 1,
        urgency TEXT DEFAULT 'URGENT',
        status TEXT DEFAULT 'ACTIVE',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rule_violations (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        reported_by_id TEXT NOT NULL,
        reported_by_name TEXT NOT NULL,
        reported_by_flat TEXT,
        reported_by_wing TEXT,
        violator_flat TEXT,
        violator_wing TEXT,
        violator_vehicle_number TEXT,
        violation_type TEXT NOT NULL,
        description TEXT NOT NULL,
        photo_url TEXT,
        fine_amount NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'REPORTED',
        committee_notes TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Extended migration alters for core tables
    try {
      await client.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS passcode TEXT`);
      await client.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS passcode_type TEXT`);
      await client.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS amc_vendor_name TEXT`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS amc_end_date DATE`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS amc_cost NUMERIC`);
      await client.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS avg_rating NUMERIC DEFAULT 5.0`);
      await client.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0`);
    } catch (_) { }

    // Auto-seed default RBAC roles and permissions
    await seedDefaultTenantRBAC(client);
  } finally {
    client.release();
  }
  return schema;
};

const ensureTenantFeatureTables = async (tenantId) => {
  if (!pool) return;
  const schema = getTenantSchemaName(tenantId);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}", platform, public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS parcels (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        flat_number TEXT NOT NULL,
        wing TEXT NOT NULL,
        recipient_name TEXT,
        delivery_company TEXT NOT NULL,
        tracking_number TEXT,
        parcel_count INTEGER DEFAULT 1,
        pickup_pin TEXT NOT NULL,
        status TEXT DEFAULT 'AT_GATE',
        photo_url TEXT,
        notes TEXT,
        received_by_guard_id TEXT,
        collected_by_name TEXT,
        collected_at TIMESTAMPTZ,
        returned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS move_requests (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        user_id TEXT,
        request_type TEXT NOT NULL,
        applicant_name TEXT NOT NULL,
        applicant_phone TEXT NOT NULL,
        applicant_email TEXT,
        flat_number TEXT NOT NULL,
        wing TEXT NOT NULL,
        move_date DATE NOT NULL,
        time_slot TEXT NOT NULL,
        vehicle_number TEXT,
        mover_agency TEXT,
        status TEXT DEFAULT 'PENDING',
        rejection_reason TEXT,
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        certificate_number TEXT,
        verification_token TEXT,
        documents JSONB DEFAULT '[]'::jsonb,
        lift_charges_paid INTEGER DEFAULT 0,
        security_deposit NUMERIC DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_items (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        seller_name TEXT NOT NULL,
        seller_flat TEXT NOT NULL,
        seller_wing TEXT NOT NULL,
        seller_phone TEXT,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        listing_type TEXT DEFAULT 'SELL',
        price NUMERIC DEFAULT 0,
        original_price NUMERIC,
        condition TEXT DEFAULT 'GOOD',
        photos JSONB DEFAULT '[]'::jsonb,
        status TEXT DEFAULT 'AVAILABLE',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_reviews (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        staff_id TEXT NOT NULL,
        resident_id TEXT NOT NULL,
        resident_name TEXT NOT NULL,
        flat_number TEXT NOT NULL,
        wing TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        review_text TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS blood_requests (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        requester_name TEXT NOT NULL,
        flat_number TEXT NOT NULL,
        wing TEXT,
        blood_group_needed TEXT NOT NULL,
        patient_name TEXT,
        hospital_name TEXT NOT NULL,
        contact_phone TEXT NOT NULL,
        units_needed INTEGER DEFAULT 1,
        urgency TEXT DEFAULT 'URGENT',
        status TEXT DEFAULT 'ACTIVE',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rule_violations (
        id TEXT PRIMARY KEY,
        society_id TEXT NOT NULL,
        reported_by_id TEXT NOT NULL,
        reported_by_name TEXT NOT NULL,
        reported_by_flat TEXT,
        reported_by_wing TEXT,
        violator_flat TEXT,
        violator_wing TEXT,
        violator_vehicle_number TEXT,
        violation_type TEXT NOT NULL,
        description TEXT NOT NULL,
        photo_url TEXT,
        fine_amount NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'REPORTED',
        committee_notes TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    try {
      await client.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS passcode TEXT`);
      await client.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS passcode_type TEXT`);
      await client.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS amc_vendor_name TEXT`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS amc_end_date DATE`);
      await client.query(`ALTER TABLE assets ADD COLUMN IF NOT EXISTS amc_cost NUMERIC`);
      await client.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS avg_rating NUMERIC DEFAULT 5.0`);
      await client.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0`);
    } catch (_) { }
  } catch (err) {
    console.error('Error ensuring tenant feature tables:', err);
  } finally {
    client.release();
  }
};

const seedDefaultTenantRBAC = async (client) => {
  const defaultPermissions = [
    { module: 'NOTICE', action: 'CREATE', code: 'NOTICE_CREATE' },
    { module: 'NOTICE', action: 'PUBLISH', code: 'NOTICE_PUBLISH' },
    { module: 'BILLING', action: 'APPROVE', code: 'BILL_APPROVE' },
    { module: 'USER', action: 'CREATE', code: 'USER_CREATE' },
    { module: 'COMPLAINT', action: 'ASSIGN', code: 'COMPLAINT_ASSIGN' },
    { module: 'SOCIETY', action: 'MANAGE', code: 'SOCIETY_MANAGE' },
    { module: 'VOUCHER', action: 'CREATE', code: 'VOUCHER_CREATE' },
    { module: 'VOUCHER', action: 'APPROVE', code: 'VOUCHER_APPROVE' },
    { module: 'VOUCHER', action: 'VIEW', code: 'VOUCHER_VIEW' },
    { module: 'BILLING', action: 'CREATE', code: 'BILLING_CREATE' },
    { module: 'BILLING', action: 'APPROVE', code: 'BILLING_APPROVE' },
    { module: 'LEDGER', action: 'VIEW', code: 'LEDGER_VIEW' },
    { module: 'TAX', action: 'VIEW', code: 'TAX_VIEW' },
    { module: 'TAX', action: 'MANAGE', code: 'TAX_MANAGE' },
    { module: 'REPORT', action: 'VIEW', code: 'REPORT_VIEW' },
    { module: 'VISITOR', action: 'MANAGE', code: 'VISITOR_MANAGE' },
    { module: 'PATROL', action: 'MANAGE', code: 'PATROL_MANAGE' },
    { module: 'SOS', action: 'RESPOND', code: 'SOS_RESPOND' },
    { module: 'VENDOR', action: 'MANAGE', code: 'VENDOR_MANAGE' },
    { module: 'VEHICLE', action: 'MANAGE', code: 'VEHICLE_MANAGE' },
    { module: 'TENANT', action: 'MANAGE', code: 'TENANT_MANAGE' },
    { module: 'STAFF', action: 'MANAGE', code: 'STAFF_MANAGE' },
    { module: 'MEETING', action: 'MANAGE', code: 'MEETING_MANAGE' },
    { module: 'FACILITY', action: 'MANAGE', code: 'FACILITY_MANAGE' },
    { module: 'DOCUMENT', action: 'MANAGE', code: 'DOCUMENT_MANAGE' },
    { module: 'COMPLIANCE', action: 'MANAGE', code: 'COMPLIANCE_MANAGE' },
    { module: 'ASSET', action: 'MANAGE', code: 'ASSET_MANAGE' },
    { module: 'ACCOUNTING', action: 'MANAGE', code: 'ACCOUNTING_MANAGE' },
    { module: 'AUDIT', action: 'VIEW', code: 'AUDIT_VIEW' },
    { module: 'EMERGENCY', action: 'MANAGE', code: 'EMERGENCY_MANAGE' },
    { module: 'NOTIFICATION', action: 'MANAGE', code: 'NOTIFICATION_MANAGE' },
    { module: 'PLAN', action: 'MANAGE', code: 'PLAN_MANAGE' }
  ];

  for (const p of defaultPermissions) {
    await client.query(
      `INSERT INTO permissions (id, module, action, code) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (code) DO NOTHING`,
      [uuidv4(), p.module, p.action, p.code]
    );
  }

  const defaultRoles = [
    { code: 'SOCIETY_ADMIN', name: 'Society Admin', description: 'Full access to society' },
    { code: 'FINANCE_MANAGER', name: 'Finance Manager', description: 'Manage finances & accounting' },
    { code: 'TREASURY_MAKER', name: 'Treasury Maker', description: 'Creates vouchers & bills' },
    { code: 'TREASURY_CHECKER', name: 'Treasury Checker', description: 'Approves vouchers & bills' },
    { code: 'COMMITTEE_MEMBER', name: 'Committee Member', description: 'Committee oversight access' },
    { code: 'GUARD', name: 'Security Guard', description: 'Gate, patrol, visitor, & SOS response' },
    { code: 'RESIDENT', name: 'Resident', description: 'Resident basic access' }
  ];

  for (const r of defaultRoles) {
    await client.query(
      `INSERT INTO roles (id, code, name, description) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (code) DO NOTHING`,
      [uuidv4(), r.code, r.name, r.description]
    );
  }

  // Get permission IDs
  const permsRows = await client.query('SELECT id, code FROM permissions');
  const permsMap = {};
  permsRows.rows.forEach(p => { permsMap[p.code] = p.id; });

  // Get role IDs
  const rolesRows = await client.query('SELECT id, code FROM roles');
  const rolesMap = {};
  rolesRows.rows.forEach(r => { rolesMap[r.code] = r.id; });

  const rolePermMap = {
    SOCIETY_ADMIN: Object.keys(permsMap),
    FINANCE_MANAGER: [
      'BILL_APPROVE', 'BILLING_CREATE', 'BILLING_APPROVE', 'VOUCHER_CREATE',
      'VOUCHER_APPROVE', 'VOUCHER_VIEW', 'LEDGER_VIEW', 'TAX_VIEW', 'TAX_MANAGE',
      'REPORT_VIEW', 'ACCOUNTING_MANAGE', 'AUDIT_VIEW'
    ],
    TREASURY_MAKER: [
      'VOUCHER_CREATE', 'VOUCHER_VIEW', 'BILLING_CREATE', 'LEDGER_VIEW', 'TAX_VIEW', 'REPORT_VIEW'
    ],
    TREASURY_CHECKER: [
      'VOUCHER_APPROVE', 'VOUCHER_VIEW', 'BILLING_APPROVE', 'BILL_APPROVE', 'LEDGER_VIEW', 'TAX_VIEW', 'TAX_MANAGE', 'REPORT_VIEW', 'AUDIT_VIEW'
    ],
    COMMITTEE_MEMBER: [
      'NOTICE_CREATE', 'COMPLAINT_ASSIGN', 'VOUCHER_VIEW', 'REPORT_VIEW', 'MEETING_MANAGE', 'FACILITY_MANAGE', 'DOCUMENT_MANAGE', 'SOS_RESPOND'
    ],
    GUARD: [
      'VISITOR_MANAGE', 'PATROL_MANAGE', 'SOS_RESPOND'
    ],
    RESIDENT: []
  };

  for (const [roleCode, permList] of Object.entries(rolePermMap)) {
    const roleId = rolesMap[roleCode];
    if (!roleId) continue;
    for (const pCode of permList) {
      const pId = permsMap[pCode];
      if (pId) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) 
           VALUES ($1, $2) 
           ON CONFLICT DO NOTHING`,
          [roleId, pId]
        );
      }
    }
  }

  const defaultPositions = [
    { code: 'SECRETARY', name: 'Secretary', is_elected: 1, hierarchy_order: 1, roles: ['SOCIETY_ADMIN'] },
    { code: 'TREASURER', name: 'Treasurer', is_elected: 1, hierarchy_order: 2, roles: ['FINANCE_MANAGER'] },
    { code: 'TREASURY_MAKER', name: 'Treasury Maker', is_elected: 0, hierarchy_order: 3, roles: ['TREASURY_MAKER'] },
    { code: 'TREASURY_CHECKER', name: 'Treasury Checker', is_elected: 0, hierarchy_order: 4, roles: ['TREASURY_CHECKER'] },
    { code: 'MEMBER', name: 'Committee Member', is_elected: 1, hierarchy_order: 5, roles: ['COMMITTEE_MEMBER'] },
    { code: 'GUARD', name: 'Security Guard', is_elected: 0, hierarchy_order: 6, roles: ['GUARD'] },
    { code: 'RESIDENT', name: 'Resident', is_elected: 0, hierarchy_order: 10, roles: ['RESIDENT'] }
  ];

  for (const pos of defaultPositions) {
    await client.query(
      `INSERT INTO position_master (id, code, name, is_elected, hierarchy_order, is_system_defined) 
       VALUES ($1, $2, $3, $4, $5, 1) 
       ON CONFLICT (code) DO NOTHING`,
      [uuidv4(), pos.code, pos.name, pos.is_elected, pos.hierarchy_order]
    );
  }

  const posRows = await client.query('SELECT id, code FROM position_master');
  const posMap = {};
  posRows.rows.forEach(p => { posMap[p.code] = p.id; });

  for (const pos of defaultPositions) {
    const posId = posMap[pos.code];
    if (!posId) continue;
    for (const rCode of pos.roles) {
      const rId = rolesMap[rCode];
      if (rId) {
        await client.query(
          `INSERT INTO position_roles (position_id, role_id) 
           VALUES ($1, $2) 
           ON CONFLICT DO NOTHING`,
          [posId, rId]
        );
      }
    }
  }
};

const withTenant = async (tenantId, callback) => {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const client = await pool.connect();
  try {
    const schema = getTenantSchemaName(tenantId);
    await client.query(`SET search_path TO "${schema}", platform, public`);
    return await callback(client);
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  isPostgresEnabled,
  isPostgresOnly,
  getTenantSchemaName,
  ensurePlatformSchema,
  ensurePlatformSocietiesSchema,
  createTenantSchema,
  ensureTenantFeatureTables,
  seedDefaultTenantRBAC,
  ensureDatabaseExists,
  withTenant
};
