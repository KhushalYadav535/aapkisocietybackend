const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const societyId = uuidv4();
    await pool.query('INSERT INTO platform.societies (id, name, onboarding_state, subscription_status) VALUES ($1, $2, $3, $4)', [societyId, 'Demo Society', 'CONFIGURATION_WIZARD', 'ACTIVE']);
    
    const userId = uuidv4();
    const hash = await bcrypt.hash('password123', 10);
    await pool.query('INSERT INTO platform.users (id, society_id, first_name, last_name, email, password, role) VALUES ($1, $2, $3, $4, $5, $6, $7)', [userId, societyId, 'Demo', 'Admin', 'admin@demo.com', hash, 'ADMIN']);
    
    console.log('Successfully created admin@demo.com with password password123 in CONFIGURATION_WIZARD state');
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
