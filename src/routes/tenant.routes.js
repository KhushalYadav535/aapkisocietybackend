const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenant.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), tenantController.getAll);
router.get('/mine', tenantController.getMyTenants);
router.post('/', tenantController.create);
router.post('/:id/approve', authorize('ADMIN', 'COMMITTEE'), tenantController.approve);
router.post('/:id/reject', authorize('ADMIN', 'COMMITTEE'), tenantController.reject);
router.put('/:id/extend', tenantController.extendLease);
router.post('/:id/terminate', authorize('ADMIN', 'COMMITTEE'), tenantController.terminate);

module.exports = router;