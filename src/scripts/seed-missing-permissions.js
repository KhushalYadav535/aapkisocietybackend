require('dotenv').config();
const { pool } = require('../config/postgres');
const { v4: uuidv4 } = require('uuid');

async function seedMissingPermissions() {
  console.log('Starting Missing Permissions Seeding...');
  if (!pool) {
    console.error('Postgres pool not initialized.');
    process.exit(1);
  }

  const newPermissions = [
    { module: 'VISITOR', action: 'MANAGE', code: 'VISITOR_MANAGE' },
    { module: 'VENDOR', action: 'MANAGE', code: 'VENDOR_MANAGE' },
    { module: 'VEHICLE', action: 'MANAGE', code: 'VEHICLE_MANAGE' },
    { module: 'TENANT', action: 'MANAGE', code: 'TENANT_MANAGE' },
    { module: 'TAX', action: 'VIEW', code: 'TAX_VIEW' },
    { module: 'TAX', action: 'MANAGE', code: 'TAX_MANAGE' },
    { module: 'STAFF', action: 'MANAGE', code: 'STAFF_MANAGE' },
    { module: 'SOS', action: 'RESPOND', code: 'SOS_RESPOND' },
    { module: 'REPORT', action: 'VIEW', code: 'REPORT_VIEW' },
    { module: 'PATROL', action: 'MANAGE', code: 'PATROL_MANAGE' },
    { module: 'MEETING', action: 'MANAGE', code: 'MEETING_MANAGE' },
    { module: 'FACILITY', action: 'MANAGE', code: 'FACILITY_MANAGE' },
    { module: 'DOCUMENT', action: 'MANAGE', code: 'DOCUMENT_MANAGE' },
    { module: 'COMPLIANCE', action: 'MANAGE', code: 'COMPLIANCE_MANAGE' },
    { module: 'ASSET', action: 'MANAGE', code: 'ASSET_MANAGE' },
    { module: 'ACCOUNTING', action: 'MANAGE', code: 'ACCOUNTING_MANAGE' },
    { module: 'AUDIT', action: 'VIEW', code: 'AUDIT_VIEW' },
    { module: 'EMERGENCY', action: 'MANAGE', code: 'EMERGENCY_MANAGE' },
    { module: 'NOTIFICATION', action: 'MANAGE', code: 'NOTIFICATION_MANAGE' },
    { module: 'PLAN', action: 'MANAGE', code: 'PLAN_MANAGE' }
  ];

  try {
    const { rows: societies } = await pool.query('SELECT id FROM platform.societies');
    console.log(`Found ${societies.length} societies.`);

    for (const society of societies) {
      const societyId = society.id;
      const schemaName = `society_${societyId.replace(/-/g, '_')}`;
      console.log(`\nSeeding society: ${societyId} (schema: ${schemaName})`);

      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schemaName}", platform, public`);

        // Check if permissions already exist
        const { rows: existingPerms } = await client.query('SELECT code FROM permissions');
        const existingCodes = new Set(existingPerms.map(p => p.code));

        const permsToInsert = newPermissions.filter(p => !existingCodes.has(p.code));
        if (permsToInsert.length === 0) {
          console.log(`No new permissions to insert for ${societyId}.`);
          continue;
        }

        console.log(`Inserting ${permsToInsert.length} new permissions...`);
        const permIds = [];
        for (const p of permsToInsert) {
          const id = uuidv4();
          await client.query('INSERT INTO permissions (id, module, action, code) VALUES ($1, $2, $3, $4)', [id, p.module, p.action, p.code]);
          permIds.push(id);
        }

        // Get SOCIETY_ADMIN role id
        const { rows: roles } = await client.query('SELECT id FROM roles WHERE code = $1', ['SOCIETY_ADMIN']);
        if (roles.length > 0) {
          const roleId = roles[0].id;
          console.log(`Assigning new permissions to SOCIETY_ADMIN (${roleId})...`);
          for (const permId of permIds) {
            await client.query(`
              INSERT INTO role_permissions (role_id, permission_id) 
              VALUES ($1, $2)
              ON CONFLICT DO NOTHING
            `, [roleId, permId]); // Requires ON CONFLICT DO NOTHING just in case, but let's see if role_permissions has a constraint
            // Wait, does role_permissions have a unique constraint? Even without it, this loop just inserts. 
            // We should just insert.
          }
        } else {
          console.log('WARNING: SOCIETY_ADMIN role not found!');
        }
      } catch (err) {
        console.error(`Error in society ${societyId}:`, err);
      } finally {
        client.release();
      }
    }
    console.log('\nSeeding completed successfully.');
  } catch (error) {
    console.error('Seeding failed:', error);
  } finally {
    process.exit(0);
  }
}

seedMissingPermissions();
