require('dotenv').config();
const { pool, getTenantSchemaName } = require('./src/config/postgres');

async function testPositionsAPI() {
  const societyId = '4ab49e06-89ca-41fa-b0b7-4878dc4c1743';
  const schema = getTenantSchemaName(societyId);
  console.log('Schema:', schema);
  
  const result = await pool.query(`SELECT * FROM "${schema}".position_master ORDER BY hierarchy_order ASC`);
  console.log('\nAll positions:');
  console.table(result.rows.map(r => ({ code: r.code, name: r.name, hierarchy_order: r.hierarchy_order })));
  
  // Test like the API controller does
  console.log('\nJSON output (what API returns):');
  console.log(JSON.stringify({ positions: result.rows }, null, 2));
  
  pool.end();
}
testPositionsAPI().catch(e => { console.error(e); pool.end(); });
