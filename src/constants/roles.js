const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const ASSIGNABLE_ROLES = {
  PLATFORM_ADMIN: ["PLATFORM_ADMIN", "ADMIN", "TREASURER", "MAKER", "CHECKER", "COMMITTEE", "RESIDENT", "GUARD"],
  ADMIN: ["ADMIN", "TREASURER", "MAKER", "CHECKER", "COMMITTEE", "RESIDENT", "GUARD"]
};
const MFA_REQUIRED_ROLES = ["ADMIN", "TREASURER", "CHECKER"];

const getAssignableRoles = (creatorRole) => ASSIGNABLE_ROLES[normalizeRole(creatorRole)] || [];

const canAssignRole = (creatorRole, targetRole) => {
  const normalizedTarget = normalizeRole(targetRole);
  return getAssignableRoles(creatorRole).includes(normalizedTarget);
};

module.exports = {
  normalizeRole,
  getAssignableRoles,
  canAssignRole,
  MFA_REQUIRED_ROLES
};
