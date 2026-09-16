const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:root@localhost:5432/aapkisociety' });

async function check() {
  const societyRes = await pool.query("SELECT id FROM platform.societies LIMIT 1");
  const societyId = societyRes.rows[0].id;
  
  const schemaName = 'society_' + societyId.replace(/-/g, '_');
  console.log('Schema:', schemaName);
  
  await pool.query(`DELETE FROM ${schemaName}.complaints`);
  console.log('Complaints cleared');
  process.exit(0);
}
check();
