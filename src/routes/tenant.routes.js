const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenant.controller');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/', requirePermission('TENANT_MANAGE'), tenantController.getAll);
router.get('/mine', tenantController.getMyTenants);
router.post('/', tenantController.create);
router.post('/:id/approve', requirePermission('TENANT_MANAGE'), tenantController.approve);
router.post('/:id/reject', requirePermission('TENANT_MANAGE'), tenantController.reject);
router.put('/:id/extend', tenantController.extendLease);
router.post('/:id/terminate', requirePermission('TENANT_MANAGE'), tenantController.terminate);

module.exports = router;