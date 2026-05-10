const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/aapkisociety' });

async function test() {
  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS platform');
    await client.query('SET search_path TO non_existent_tenant, platform, public');
    await client.query(`
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      flat_id TEXT,
      member_id TEXT,
      bill_number TEXT,
      bill_date DATE,
      due_date DATE,
      amount NUMERIC,
      tax_amount NUMERIC,
      total_amount NUMERIC,
      paid_amount NUMERIC DEFAULT 0,
      status TEXT,
      bill_type TEXT,
      billing_period TEXT,
      description TEXT,
      created_by TEXT,
      approved_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      society_id TEXT,
      bill_id TEXT,
      member_id TEXT,
      amount NUMERIC,
      payment_method TEXT,
      payment_reference TEXT,
      gateway_transaction_id TEXT,
      status TEXT,
      payment_date TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  
  const billsQuery = "SELECT COALESCE(SUM(total_amount), 0) AS total_billed, COUNT(CASE WHEN status NOT IN ('PAID', 'REJECTED') THEN 1 END) AS pending_bills, COUNT(CASE WHEN status != 'PAID' AND due_date < CURRENT_DATE THEN 1 END) AS overdue_bills FROM bills WHERE member_id = $1";
  const paymentsQuery = "SELECT COALESCE(SUM(amount), 0) AS total_collected FROM payments WHERE status = 'SUCCESS' AND member_id = $1";
  
  const [billsR, paymentsR] = await Promise.all([
    client.query(billsQuery, ['user1']),
    client.query(paymentsQuery, ['user1'])
  ]);
  console.log('SUCCESS');
  } catch(e) {
    console.log('ERROR', e);
  } finally {
    client.release();
    pool.end();
  }
}
test();
