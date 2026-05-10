const PLATFORM_ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  COMPLIANCE_MANAGER: 'COMPLIANCE_MANAGER',
  PARTNER: 'PARTNER'
};

const TENANT_ROLES = {
  ADMIN: 'ADMIN',
  TREASURER: 'TREASURER',
  MAKER: 'MAKER',
  CHECKER: 'CHECKER',
  COMMITTEE: 'COMMITTEE',
  RESIDENT: 'RESIDENT',
  GUARD: 'GUARD'
};

const ALL_ROLES = { ...PLATFORM_ROLES, ...TENANT_ROLES };

const normalizeRole = (role) =>
  String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

const ASSIGNABLE_ROLES = {
  PLATFORM_ADMIN: ['PLATFORM_ADMIN', 'ADMIN', 'TREASURER', 'MAKER', 'CHECKER', 'COMMITTEE', 'RESIDENT', 'GUARD'],
  ADMIN: ['ADMIN', 'TREASURER', 'MAKER', 'CHECKER', 'COMMITTEE', 'RESIDENT', 'GUARD']
};
const MFA_REQUIRED_ROLES = ['ADMIN', 'TREASURER', 'CHECKER'];
const PLATFORM_MFA_ROLES = ['SUPPORT_AGENT'];

const getAssignableRoles = (creatorRole) => ASSIGNABLE_ROLES[normalizeRole(creatorRole)] || [];

const canAssignRole = (creatorRole, targetRole) => {
  const normalizedTarget = normalizeRole(targetRole);
  return getAssignableRoles(creatorRole).includes(normalizedTarget);
};

const isPlatformRole = (role) => Object.values(PLATFORM_ROLES).includes(normalizeRole(role));
const isTenantRole = (role) => Object.values(TENANT_ROLES).includes(normalizeRole(role));

module.exports = {
  normalizeRole,
  getAssignableRoles,
  canAssignRole,
  MFA_REQUIRED_ROLES,
  PLATFORM_MFA_ROLES,
  isPlatformRole,
  isTenantRole,
  PLATFORM_ROLES,
  TENANT_ROLES,
  ALL_ROLES
};
