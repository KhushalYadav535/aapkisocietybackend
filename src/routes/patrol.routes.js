const express = require('express');
const router = express.Router();
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/patrol.controller');

router.use(authenticate);

// View checkpoints and logs — all staff roles
router.get('/checkpoints', ctrl.getCheckpoints);
router.get('/logs', ctrl.getLogs);
router.get('/summary', ctrl.getSummary);

// Guard scans QR
router.post('/scan', requirePermission('PATROL_MANAGE'), ctrl.scan);

// Admin manages checkpoints
router.post('/checkpoints', requirePermission('PATROL_MANAGE'), ctrl.createCheckpoint);
router.delete('/checkpoints/:id', requirePermission('PATROL_MANAGE'), ctrl.deleteCheckpoint);

module.exports = router;
