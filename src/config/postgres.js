const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : null;
const isPostgresEnabled = !!pool;
const isPostgresOnly = String(process.env.POSTGRES_ONLY || 'false').toLowerCase() === 'true';
const getTenantSchemaName = (tenantId) => `society_${String(tenantId).replace(/-/g, '_')}`;

/**
 * Ensures platform.societies matches what platform/society flows expect.
 * Older deployments only had a minimal table from society.controller; ALTER adds missing columns.
 */
const ensurePlatformSocietiesSchema = async () => {
  if (!pool) return;
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
      updated_at TIMESTAMPTZ DEFAULT NOW()
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
    `ALTER TABLE platform.societies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`
  ];
  for (const sql of alters) {
    await pool.query(sql);
  }
};

const ensurePlatformSchema = async () => {
  if (!pool) return;
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
  // Migrate: add scroll_speed column if missing on existing scrollers table
  try {
    await pool.query(`ALTER TABLE platform.scrollers ADD COLUMN IF NOT EXISTS scroll_speed TEXT DEFAULT 'MEDIUM'`);
  } catch (_) {}
  await ensurePlatformSocietiesSchema();
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
  } finally {
    client.release();
  }
  return schema;
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
  withTenant
};
