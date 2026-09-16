
const { getDb } = require('./src/config/database');
(async () => {
  const db = getDb();
  const res = await db.query('SELECT onboarding_state FROM platform.societies WHERE name = \', ['AapkiSociety Demo']);
  console.log('State:', res.rows[0]?.onboarding_state);
  process.exit(0);
})();

