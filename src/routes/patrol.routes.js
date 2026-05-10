const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/patrol.controller');

router.use(authenticate);

// View checkpoints and logs — all staff roles
router.get('/checkpoints', ctrl.getCheckpoints);
router.get('/logs', ctrl.getLogs);
router.get('/summary', ctrl.getSummary);

// Guard scans QR
router.post('/scan', authorize('ADMIN', 'COMMITTEE', 'GUARD', 'PLATFORM_ADMIN'), ctrl.scan);

// Admin manages checkpoints
router.post('/checkpoints', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), ctrl.createCheckpoint);
router.delete('/checkpoints/:id', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), ctrl.deleteCheckpoint);

module.exports = router;
