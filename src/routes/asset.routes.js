const express = require('express');
const router = express.Router();
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/asset.controller');

router.use(authenticate);

// All authenticated users can view assets and scan QR
router.get('/', ctrl.getAll);
router.get('/amc-alerts', ctrl.getAmcAlerts);
router.get('/by-qr/:qrCode', ctrl.getByQr);
router.get('/:id/service-logs', ctrl.getServiceLogs);

// Admin manages assets
router.post('/', requirePermission('ASSET_MANAGE'), ctrl.create);
router.put('/:id', requirePermission('ASSET_MANAGE'), ctrl.update);
router.post('/:id/service-log', requirePermission('ASSET_MANAGE'), ctrl.addServiceLog);
router.delete('/:id', requirePermission('ASSET_MANAGE'), ctrl.remove);

module.exports = router;
