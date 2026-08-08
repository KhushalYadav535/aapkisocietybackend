/**
 * Seed Treasury Maker & Checker Positions with full RBAC
 * Run: node src/scripts/seed-maker-checker.js
 */
require('dotenv').config();
const { pool, createTenantSchema, getTenantSchemaName } = require('../config/postgres');
const { v4: uuidv4 } = require('uuid');

async function seedMakerChecker() {
  console.log('🏦 Seeding Treasury Maker & Checker RBAC...\n');
  if (!pool) { console.error('❌ Postgres pool not initialized.'); process.exit(1); }

  try {
    const { rows: societies } = await pool.query('SELECT id, name FROM platform.societies');
    console.log(`Found ${societies.length} societies.\n`);

    for (const society of societies) {
      const societyId = society.id;
      const schema = getTenantSchemaName(societyId);
      console.log(`\n➡️  Society: ${society.name} (${societyId})`);

      // Ensure schema tables exist
      await createTenantSchema(societyId);

      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schema}", platform, public`);

        // ─────────────────────────────────────────────────────
        // 1. Upsert Permissions
        // ─────────────────────────────────────────────────────
        const newPermissions = [
          { module: 'VOUCHER', action: 'CREATE',   code: 'VOUCHER_CREATE',   desc: 'Create payment/receipt vouchers' },
          { module: 'VOUCHER', action: 'APPROVE',  code: 'VOUCHER_APPROVE',  desc: 'Approve/reject vouchers (4-eye principle)' },
          { module: 'VOUCHER', action: 'VIEW',     code: 'VOUCHER_VIEW',     desc: 'View vouchers and ledger' },
          { module: 'BILLING', action: 'CREATE',   code: 'BILLING_CREATE',   desc: 'Create bills (Maker)' },
          { module: 'BILLING', action: 'APPROVE',  code: 'BILLING_APPROVE',  desc: 'Approve bills (Checker)' },
          { module: 'LEDGER',  action: 'VIEW',     code: 'LEDGER_VIEW',      desc: 'View accounting ledger' },
          { module: 'TAX',     action: 'VIEW',     code: 'TAX_VIEW',         desc: 'View tax reports' },
          { module: 'TAX',     action: 'MANAGE',   code: 'TAX_MANAGE',       desc: 'Manage and export tax reports' },
          { module: 'REPORT',  action: 'VIEW',     code: 'REPORT_VIEW',      desc: 'View financial reports' },
          { module: 'NOTICE',  action: 'CREATE',   code: 'NOTICE_CREATE',    desc: 'Create notices' },
          { module: 'NOTICE',  action: 'PUBLISH',  code: 'NOTICE_PUBLISH',   desc: 'Publish notices' },
          { module: 'COMPLAINT', action: 'ASSIGN', code: 'COMPLAINT_ASSIGN', desc: 'Assign complaints' },
          { module: 'USER',    action: 'CREATE',   code: 'USER_CREATE',      desc: 'Create users' },
          { module: 'SOCIETY', action: 'MANAGE',   code: 'SOCIETY_MANAGE',   desc: 'Manage society settings' },
          { module: 'BILL',    action: 'APPROVE',  code: 'BILL_APPROVE',     desc: 'Approve bills' },
        ];

        const permissionsMap = {};
        for (const p of newPermissions) {
          // Check if exists
          const existing = await client.query('SELECT id FROM permissions WHERE code = $1', [p.code]);
          let permId;
          if (existing.rows.length > 0) {
            permId = existing.rows[0].id;
            console.log(`  ✓ Permission exists: ${p.code}`);
          } else {
            permId = uuidv4();
            await client.query(
              'INSERT INTO permissions (id, module, action, code) VALUES ($1, $2, $3, $4)',
              [permId, p.module, p.action, p.code]
            );
            console.log(`  ✅ Created permission: ${p.code}`);
          }
          permissionsMap[p.code] = permId;
        }

        // ─────────────────────────────────────────────────────
        // 2. Upsert Roles
        // ─────────────────────────────────────────────────────
        const newRoles = [
          { code: 'SOCIETY_ADMIN',     name: 'Society Admin',       description: 'Full access to society management' },
          { code: 'TREASURY_MAKER',    name: 'Treasury Maker',      description: 'Creates vouchers, bills, and financial entries for checker approval' },
          { code: 'TREASURY_CHECKER',  name: 'Treasury Checker',    description: 'Reviews and approves vouchers/bills created by maker (4-eye principle)' },
          { code: 'FINANCE_MANAGER',   name: 'Finance Manager',     description: 'Full access to finance module - bills, vouchers, tax, ledger' },
          { code: 'COMMITTEE_MEMBER',  name: 'Committee Member',    description: 'Basic committee access - notices, complaints' },
          { code: 'RESIDENT',          name: 'Resident',            description: 'Basic resident access' },
        ];

        const rolesMap = {};
        for (const r of newRoles) {
          const existing = await client.query('SELECT id FROM roles WHERE code = $1', [r.code]);
          let roleId;
          if (existing.rows.length > 0) {
            roleId = existing.rows[0].id;
            console.log(`  ✓ Role exists: ${r.code}`);
          } else {
            roleId = uuidv4();
            await client.query(
              'INSERT INTO roles (id, code, name, description) VALUES ($1, $2, $3, $4)',
              [roleId, r.code, r.name, r.description]
            );
            console.log(`  ✅ Created role: ${r.code}`);
          }
          rolesMap[r.code] = roleId;
        }

        // ─────────────────────────────────────────────────────
        // 3. Role ↔ Permission Mapping (clear old, re-seed)
        // ─────────────────────────────────────────────────────
        const rolePermissions = {
          SOCIETY_ADMIN: [
            'NOTICE_CREATE', 'NOTICE_PUBLISH', 'BILL_APPROVE', 'USER_CREATE',
            'COMPLAINT_ASSIGN', 'SOCIETY_MANAGE', 'VOUCHER_CREATE', 'VOUCHER_APPROVE',
            'VOUCHER_VIEW', 'BILLING_CREATE', 'BILLING_APPROVE', 'LEDGER_VIEW',
            'TAX_VIEW', 'TAX_MANAGE', 'REPORT_VIEW'
          ],
          TREASURY_MAKER: [
            'VOUCHER_CREATE', 'VOUCHER_VIEW', 'BILLING_CREATE', 'LEDGER_VIEW',
            'TAX_VIEW', 'REPORT_VIEW'
          ],
          TREASURY_CHECKER: [
            'VOUCHER_APPROVE', 'VOUCHER_VIEW', 'BILLING_APPROVE', 'BILL_APPROVE',
            'LEDGER_VIEW', 'TAX_VIEW', 'TAX_MANAGE', 'REPORT_VIEW'
          ],
          FINANCE_MANAGER: [
            'VOUCHER_CREATE', 'VOUCHER_APPROVE', 'VOUCHER_VIEW', 'BILLING_CREATE',
            'BILLING_APPROVE', 'BILL_APPROVE', 'LEDGER_VIEW', 'TAX_VIEW', 'TAX_MANAGE', 'REPORT_VIEW'
          ],
          COMMITTEE_MEMBER: [
            'NOTICE_CREATE', 'COMPLAINT_ASSIGN', 'VOUCHER_VIEW', 'REPORT_VIEW'
          ],
          RESIDENT: []
        };

        for (const [roleCode, permCodes] of Object.entries(rolePermissions)) {
          const roleId = rolesMap[roleCode];
          if (!roleId) continue;
          // Delete old role-permissions for this role
          await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
          for (const permCode of permCodes) {
            const permId = permissionsMap[permCode];
            if (permId) {
              await client.query(
                'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [roleId, permId]
              );
            }
          }
          console.log(`  ✅ Role-Permissions set for: ${roleCode} (${permCodes.length} permissions)`);
        }

        // ─────────────────────────────────────────────────────
        // 4. Upsert Positions
        // ─────────────────────────────────────────────────────
        const newPositions = [
          { code: 'SECRETARY',        name: 'Secretary',           is_elected: 1, hierarchy_order: 1, roles: ['SOCIETY_ADMIN'] },
          { code: 'TREASURER',        name: 'Treasurer',           is_elected: 1, hierarchy_order: 2, roles: ['FINANCE_MANAGER'] },
          { code: 'TREASURY_MAKER',   name: 'Treasury Maker',      is_elected: 0, hierarchy_order: 3, roles: ['TREASURY_MAKER'] },
          { code: 'TREASURY_CHECKER', name: 'Treasury Checker',    is_elected: 0, hierarchy_order: 4, roles: ['TREASURY_CHECKER'] },
          { code: 'MEMBER',           name: 'Committee Member',    is_elected: 1, hierarchy_order: 5, roles: ['COMMITTEE_MEMBER'] },
          { code: 'RESIDENT',         name: 'Resident',            is_elected: 0, hierarchy_order: 10, roles: ['RESIDENT'] },
        ];

        const positionsMap = {};
        for (const pos of newPositions) {
          const existing = await client.query('SELECT id FROM position_master WHERE code = $1', [pos.code]);
          let posId;
          if (existing.rows.length > 0) {
            posId = existing.rows[0].id;
            console.log(`  ✓ Position exists: ${pos.code}`);
          } else {
            posId = uuidv4();
            await client.query(
              'INSERT INTO position_master (id, code, name, is_elected, hierarchy_order, is_system_defined) VALUES ($1, $2, $3, $4, $5, 1)',
              [posId, pos.code, pos.name, pos.is_elected, pos.hierarchy_order]
            );
            console.log(`  ✅ Created position: ${pos.code}`);
          }
          positionsMap[pos.code] = posId;

          // Set position → roles mapping
          await client.query('DELETE FROM position_roles WHERE position_id = $1', [posId]);
          for (const roleCode of pos.roles) {
            const roleId = rolesMap[roleCode];
            if (roleId) {
              await client.query(
                'INSERT INTO position_roles (position_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [posId, roleId]
              );
            }
          }
        }

        console.log(`  ✅ Positions seeded for society ${society.name}`);

      } finally {
        client.release();
      }
    }

    console.log('\n🎉 Maker-Checker RBAC seeding completed successfully!');
    console.log('\n📋 Summary of what was created:');
    console.log('   Positions:   SECRETARY | TREASURER | TREASURY_MAKER | TREASURY_CHECKER | MEMBER | RESIDENT');
    console.log('   MAKER perms: VOUCHER_CREATE, VOUCHER_VIEW, BILLING_CREATE, LEDGER_VIEW, TAX_VIEW, REPORT_VIEW');
    console.log('   CHECKER perms: VOUCHER_APPROVE, VOUCHER_VIEW, BILLING_APPROVE, BILL_APPROVE, LEDGER_VIEW, TAX_VIEW, TAX_MANAGE, REPORT_VIEW');
    console.log('\n🔧 Next steps:');
    console.log('   1. Go to Members page → Create member with Role = MAKER or CHECKER');
    console.log('   2. Go to Settings → Role Management → Assign Position "Treasury Maker" or "Treasury Checker" to that member');
    console.log('   3. The member will now have the correct permissions based on their position!');

  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

seedMakerChecker();
