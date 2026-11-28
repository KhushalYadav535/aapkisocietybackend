const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbac.controller');
const { authenticate, authorize } = require('../middleware/auth');

// Get active permissions for the currently logged in user (societyId via query or req.user)
router.get('/me/permissions', authenticate, rbacController.getActivePermissions);

// Admin-only routes for managing RBAC (strictly ADMIN and PLATFORM_ADMIN)
router.get('/societies/:societyId/positions', authenticate, authorize('ADMIN', 'PLATFORM_ADMIN'), rbacController.getPositions);
router.get('/societies/:societyId/assignments', authenticate, authorize('ADMIN', 'PLATFORM_ADMIN'), rbacController.getAssignments);
router.post('/societies/:societyId/positions/assign', authenticate, authorize('ADMIN', 'PLATFORM_ADMIN'), rbacController.assignPosition);
router.put('/societies/:societyId/assignments/:assignmentId/end', authenticate, authorize('ADMIN', 'PLATFORM_ADMIN'), rbacController.endAssignment);
router.delete('/societies/:societyId/assignments/:assignmentId', authenticate, authorize('ADMIN', 'PLATFORM_ADMIN'), rbacController.endAssignment);

module.exports = router;
