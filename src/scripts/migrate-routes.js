const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../routes');

const permissionMap = {
  'visitor.routes.js': { default: 'VISITOR_MANAGE' },
  'vendor.routes.js': { default: 'VENDOR_MANAGE' },
  'vehicle.routes.js': { default: 'VEHICLE_MANAGE' },
  'tenant.routes.js': { default: 'TENANT_MANAGE' },
  'tax.routes.js': { default: 'TAX_MANAGE', get: 'TAX_VIEW' },
  'staff.routes.js': { default: 'STAFF_MANAGE' },
  'sos.routes.js': { default: 'SOS_RESPOND' },
  'reports.routes.js': { default: 'REPORT_VIEW' },
  'patrol.routes.js': { default: 'PATROL_MANAGE' },
  'meeting.routes.js': { default: 'MEETING_MANAGE' },
  'facility.routes.js': { default: 'FACILITY_MANAGE' },
  'document.routes.js': { default: 'DOCUMENT_MANAGE' },
  'compliance.routes.js': { default: 'COMPLIANCE_MANAGE' },
  'asset.routes.js': { default: 'ASSET_MANAGE' },
  'accounting.routes.js': { default: 'ACCOUNTING_MANAGE' },
  'audit.routes.js': { default: 'AUDIT_VIEW' },
  'emergency-contacts.routes.js': { default: 'EMERGENCY_MANAGE' },
  'notification.routes.js': { default: 'NOTIFICATION_MANAGE' },
  'plan.routes.js': { default: 'PLAN_MANAGE' },
};

const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));

files.forEach(file => {
  const mapping = permissionMap[file];
  if (!mapping) return;

  const filePath = path.join(routesDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  let modified = false;

  // Add requirePermission import if missing but authorize is there
  if (content.includes('authorize') && !content.includes('requirePermission')) {
    content = content.replace(
      /const \{([^}]*authorize[^}]*)\} = require\('\.\.\/middleware\/auth'\);/,
      (match, p1) => {
        return `const {${p1}, requirePermission } = require('../middleware/auth');`;
      }
    );
    modified = true;
  }

  // Replace authorize('...') with requirePermission('...')
  const routerRegex = /router\.(get|post|put|delete|patch)\(([^,]+),\s*authorize\([^)]+\)/g;
  
  content = content.replace(routerRegex, (match, method, routePath) => {
    let perm = mapping.default;
    if (method.toLowerCase() === 'get' && mapping.get) {
      perm = mapping.get;
    }
    return `router.${method}(${routePath}, requirePermission('${perm}')`;
  });

  // Also catch stray authorize() arrays like authorize('ADMIN'), [ body()... ]
  const bareAuthorizeRegex = /authorize\([^)]+\)/g;
  content = content.replace(bareAuthorizeRegex, (match) => {
    // If it's a society route and uses PLATFORM_ADMIN, keep it?
    // Wait, let's just replace all remaining.
    if (match.includes('PLATFORM_ADMIN') && !match.includes('ADMIN')) {
      // Actually, requirePermission handles PLATFORM_ADMIN bypass automatically.
    }
    return `requirePermission('${mapping.default}')`;
  });

  if (content !== fs.readFileSync(filePath, 'utf-8')) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated ${file}`);
  }
});

console.log('Backend routes codemod complete!');
