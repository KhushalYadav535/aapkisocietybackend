const express = require('express');
const router = express.Router();
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/audit.controller');

router.use(authenticate);
router.use(requirePermission('AUDIT_VIEW'));

router.get('/',        ctrl.getLogs);
router.get('/actions', ctrl.getActionTypes);
router.get('/stats',   ctrl.getAuditStats);

module.exports = router;
