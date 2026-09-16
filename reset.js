require('dotenv').config();
const { pool } = require('./src/config/postgres');
(async () => {
  await pool.query('DELETE FROM platform.users WHERE email = $1', ['admin@demo.com']);
  await pool.query('DELETE FROM platform.societies WHERE name = $1', ['AapkiSociety Demo']);
  console.log('Reset complete!');
  process.exit(0);
})();
