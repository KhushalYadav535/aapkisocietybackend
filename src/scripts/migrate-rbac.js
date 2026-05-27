require('dotenv').config();
const { pool, createTenantSchema } = require('../config/postgres');
const { v4: uuidv4 } = require('uuid');

async function migrateRbac() {
  console.log('Starting RBAC Migration...');
  if (!pool) {
    console.error('Postgres pool not initialized.');
    process.exit(1);
  }

  try {
    // 1. Get all societies
    const { rows: societies } = await pool.query('SELECT id FROM platform.societies');
    console.log(`Found ${societies.length} societies to migrate.`);

    for (const society of societies) {
      const societyId = society.id;
      const schemaName = `society_${societyId.replace(/-/g, '_')}`;
      console.log(`\nMigrating society: ${societyId} (schema: ${schemaName})`);

      // Ensure schema and tables exist
      await createTenantSchema(societyId);

      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schemaName}", platform, public`);

        // Clean slate
        await client.query('TRUNCATE TABLE society_position_assignments CASCADE');
        await client.query('TRUNCATE TABLE position_roles CASCADE');
        await client.query('TRUNCATE TABLE role_permissions CASCADE');
        await client.query('TRUNCATE TABLE position_master CASCADE');
        await client.query('TRUNCATE TABLE roles CASCADE');
        await client.query('TRUNCATE TABLE permissions CASCADE');
        await client.query('TRUNCATE TABLE audit_logs CASCADE');

        // Create Permissions
        const permissionsData = [
          { module: 'NOTICE', action: 'CREATE', code: 'NOTICE_CREATE' },
          { module: 'NOTICE', action: 'PUBLISH', code: 'NOTICE_PUBLISH' },
          { module: 'BILLING', action: 'APPROVE', code: 'BILL_APPROVE' },
          { module: 'USER', action: 'CREATE', code: 'USER_CREATE' },
          { module: 'COMPLAINT', action: 'ASSIGN', code: 'COMPLAINT_ASSIGN' },
          { module: 'SOCIETY', action: 'MANAGE', code: 'SOCIETY_MANAGE' }
        ];
        const permissionsMap = {};
        for (const p of permissionsData) {
          const id = uuidv4();
          await client.query('INSERT INTO permissions (id, module, action, code) VALUES ($1, $2, $3, $4)', [id, p.module, p.action, p.code]);
          permissionsMap[p.code] = id;
        }

        // Create Roles
        const rolesData = [
          { code: 'SOCIETY_ADMIN', name: 'Society Admin', description: 'Full access to society' },
          { code: 'FINANCE_MANAGER', name: 'Finance Manager', description: 'Manage finances' },
          { code: 'RESIDENT', name: 'Resident', description: 'Basic resident access' }
        ];
        const rolesMap = {};
        for (const r of rolesData) {
          const id = uuidv4();
          await client.query('INSERT INTO roles (id, code, name, description) VALUES ($1, $2, $3, $4)', [id, r.code, r.name, r.description]);
          rolesMap[r.code] = id;
        }

        // Role-Permissions mapping
        const assignPerms = async (roleCode, permCodes) => {
          const roleId = rolesMap[roleCode];
          for (const pc of permCodes) {
            const permId = permissionsMap[pc];
            if(permId) {
              await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [roleId, permId]);
            }
          }
        };
        await assignPerms('SOCIETY_ADMIN', ['NOTICE_CREATE', 'NOTICE_PUBLISH', 'BILL_APPROVE', 'USER_CREATE', 'COMPLAINT_ASSIGN', 'SOCIETY_MANAGE']);
        await assignPerms('FINANCE_MANAGER', ['BILL_APPROVE']);
        await assignPerms('RESIDENT', []);

        // Create Positions
        const positionsData = [
          { code: 'SECRETARY', name: 'Secretary', is_elected: 1, hierarchy_order: 1 },
          { code: 'TREASURER', name: 'Treasurer', is_elected: 1, hierarchy_order: 2 },
          { code: 'MEMBER', name: 'Committee Member', is_elected: 1, hierarchy_order: 3 },
          { code: 'RESIDENT', name: 'Resident', is_elected: 0, hierarchy_order: 10 }
        ];
        const positionsMap = {};
        for (const pos of positionsData) {
          const id = uuidv4();
          await client.query('INSERT INTO position_master (id, code, name, is_elected, hierarchy_order, is_system_defined) VALUES ($1, $2, $3, $4, $5, 1)', 
            [id, pos.code, pos.name, pos.is_elected, pos.hierarchy_order]);
          positionsMap[pos.code] = id;
        }

        // Position-Roles mapping
        const assignPosRole = async (posCode, roleCodes) => {
          const posId = positionsMap[posCode];
          for (const rc of roleCodes) {
            const roleId = rolesMap[rc];
            if(roleId) {
              await client.query('INSERT INTO position_roles (position_id, role_id) VALUES ($1, $2)', [posId, roleId]);
            }
          }
        };
        await assignPosRole('SECRETARY', ['SOCIETY_ADMIN']);
        await assignPosRole('TREASURER', ['FINANCE_MANAGER']);
        await assignPosRole('MEMBER', ['RESIDENT']);
        await assignPosRole('RESIDENT', ['RESIDENT']);

        // Migrate Users
        const { rows: users } = await pool.query('SELECT id, role FROM platform.users WHERE society_id = $1', [societyId]);
        let migratedCount = 0;
        for (const user of users) {
          let posCode = 'RESIDENT';
          const r = (user.role || '').toUpperCase();
          if (r.includes('ADMIN') || r.includes('SECRETARY')) posCode = 'SECRETARY';
          else if (r.includes('TREASURER')) posCode = 'TREASURER';
          else if (r.includes('COMMITTEE')) posCode = 'MEMBER';
          
          const posId = positionsMap[posCode];
          if (posId) {
            await client.query(`
              INSERT INTO society_position_assignments 
              (id, user_id, position_id, start_date, end_date, status) 
              VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year', 'ACTIVE')
            `, [uuidv4(), user.id, posId]);
            migratedCount++;
          }
        }
        console.log(`Migrated ${migratedCount} users to positions in ${societyId}.`);

      } finally {
        client.release();
      }
    }
    console.log('RBAC Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    process.exit(0);
  }
}

migrateRbac();
