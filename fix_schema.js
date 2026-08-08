const fs = require('fs');
let c = fs.readFileSync('src/controllers/reports.controller.js', 'utf8');

c = c.replace(
  /const \{ pool, isPostgresEnabled, ensurePlatformSchema \} = require\('\.\.\/config\/postgres'\);/, 
  "const { pool, isPostgresEnabled, ensurePlatformSchema, getTenantSchemaName } = require('../config/postgres');"
);

// Fix const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `"society_${societyId}"`;
c = c.replace(
  /const schema = req\.user\.role === 'PLATFORM_ADMIN' \? 'platform' : `\\"society_\$\{societyId\}\\"`/g,
  "const schema = req.user.role === 'PLATFORM_ADMIN' ? 'platform' : `\\\"${getTenantSchemaName(societyId)}\\\"`"
);

// Fix const schema = `"society_${societyId}"`;
c = c.replace(
  /const schema = `\\"society_\$\{societyId\}\\"`/g,
  "const schema = `\\\"${getTenantSchemaName(societyId)}\\\"`"
);

// Fix ${schema === 'platform' ? 'platform' : `"society_${societyId}"`}
c = c.replace(
  /\$\{schema === 'platform' \? 'platform' : `\\"society_\$\{societyId\}\\"`\}/g,
  "${schema === 'platform' ? 'platform' : `\\\"${getTenantSchemaName(societyId)}\\\"`}"
);

fs.writeFileSync('src/controllers/reports.controller.js', c);
console.log('Fixed reports.controller.js');
