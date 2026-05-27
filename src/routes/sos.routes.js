const express = require('express');
const router = express.Router();
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/sos.controller');

router.use(authenticate);

// Anyone can raise SOS
router.post('/', ctrl.raise);
router.get('/active-count', ctrl.activeCount);

// All authenticated users can view alerts
router.get('/', ctrl.getAll);

// Guard/Admin can respond & resolve
router.put('/:id/respond', requirePermission('SOS_RESPOND'), ctrl.respond);
router.put('/:id/resolve', requirePermission('SOS_RESPOND'), ctrl.resolve);

module.exports = router;
