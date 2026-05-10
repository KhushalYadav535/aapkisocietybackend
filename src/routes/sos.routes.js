const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/sos.controller');

router.use(authenticate);

// Anyone can raise SOS
router.post('/', ctrl.raise);
router.get('/active-count', ctrl.activeCount);

// All authenticated users can view alerts
router.get('/', ctrl.getAll);

// Guard/Admin can respond & resolve
router.put('/:id/respond', authorize('ADMIN', 'COMMITTEE', 'GUARD', 'PLATFORM_ADMIN'), ctrl.respond);
router.put('/:id/resolve', authorize('ADMIN', 'COMMITTEE', 'GUARD', 'PLATFORM_ADMIN'), ctrl.resolve);

module.exports = router;
