const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbac.controller');
const { authenticate, requirePermission } = require('../middleware/auth');

// Get active permissions for the currently logged in user (societyId via query or req.user)
router.get('/me/permissions', authenticate, rbacController.getActivePermissions);

// Admin routes for managing RBAC (require SOCIETY_MANAGE permission)
router.get('/societies/:societyId/positions', authenticate, requirePermission('SOCIETY_MANAGE'), rbacController.getPositions);
router.get('/societies/:societyId/assignments', authenticate, requirePermission('SOCIETY_MANAGE'), rbacController.getAssignments);
router.post('/societies/:societyId/positions/assign', authenticate, requirePermission('SOCIETY_MANAGE'), rbacController.assignPosition);

module.exports = router;
