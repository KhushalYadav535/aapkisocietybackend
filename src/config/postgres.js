const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString }) : null;
const isPostgresEnabled = !!pool;
const isPostgresOnly = String(process.env.POSTGRES_ONLY || 'false').toLowerCase() === 'true';
const getTenantSchemaName = (tenantId) => `tenant_${String(tenantId).replace(/-/g, '_')}`;

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
};

const createTenantSchema = async (tenantId) => {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const schema = getTenantSchemaName(tenantId);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  return schema;
};

const withTenant = async (tenantId, callback) => {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const client = await pool.connect();
  try {
    const schema = getTenantSchemaName(tenantId);
    await client.query(`SET search_path TO ${schema}, platform, public`);
    return await callback(client);
  } finally {
    client.release();
  }
};

module.exports = { pool, isPostgresEnabled, isPostgresOnly, getTenantSchemaName, ensurePlatformSchema, createTenantSchema, withTenant };
