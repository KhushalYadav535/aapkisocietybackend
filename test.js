require('dotenv').config();
const { pool, getTenantSchemaName } = require('./src/config/postgres');
const schema = getTenantSchemaName('4ab49e06-89ca-41fa-b0b7-4878dc4c1743');
pool.query(`SELECT * FROM "${schema}".position_master`).then(res => {
  console.log('positions:', res.rows.length);
  return pool.query('SELECT * FROM platform.users WHERE society_id = $1', ['4ab49e06-89ca-41fa-b0b7-4878dc4c1743']);
}).then(res => {
  console.log('members:', res.rows.length);
  pool.end();
}).catch(e => {
  console.error(e);
  pool.end();
});
