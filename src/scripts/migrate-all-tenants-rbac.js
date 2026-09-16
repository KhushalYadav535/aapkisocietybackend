require('dotenv').config();
const { pool, createTenantSchema, seedDefaultTenantRBAC, getTenantSchemaName } = require('../config/postgres');

async function migrateAllTenants() {
  console.log('🚀 Starting RBAC Migration across all societies in platform.societies...\n');
  if (!pool) {
    console.error('❌ Postgres pool not initialized.');
    process.exit(1);
  }

  try {
    const { rows: societies } = await pool.query('SELECT id, name FROM platform.societies');
    console.log(`Found ${societies.length} societies to check/seed.\n`);

    for (const society of societies) {
      const societyId = society.id;
      const schemaName = getTenantSchemaName(societyId);
      console.log(`➡️  Checking society: ${society.name} (${societyId} - ${schemaName})`);

      // 1. Ensure tenant schema and base tables exist
      await createTenantSchema(societyId);

      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schemaName}", platform, public`);
        
        // 2. Run seedDefaultTenantRBAC
        await seedDefaultTenantRBAC(client);
        
        const posCount = await client.query('SELECT count(*) FROM position_master');
        const roleCount = await client.query('SELECT count(*) FROM roles');
        const permCount = await client.query('SELECT count(*) FROM permissions');
        console.log(`   ✅ Positions: ${posCount.rows[0].count} | Roles: ${roleCount.rows[0].count} | Permissions: ${permCount.rows[0].count}`);
      } catch (err) {
        console.error(`   ❌ Error on society ${societyId}:`, err.message);
      } finally {
        client.release();
      }
    }

    console.log('\n🎉 Successfully migrated all tenant schemas with default RBAC!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrateAllTenants();
