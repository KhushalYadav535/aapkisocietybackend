const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/asset.controller');

router.use(authenticate);

// All authenticated users can view assets and scan QR
router.get('/', ctrl.getAll);
router.get('/amc-alerts', ctrl.getAmcAlerts);
router.get('/by-qr/:qrCode', ctrl.getByQr);
router.get('/:id/service-logs', ctrl.getServiceLogs);

// Admin manages assets
router.post('/', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), ctrl.create);
router.put('/:id', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), ctrl.update);
router.post('/:id/service-log', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), ctrl.addServiceLog);
router.delete('/:id', authorize('ADMIN', 'PLATFORM_ADMIN'), ctrl.remove);

module.exports = router;
