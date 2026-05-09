const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/audit.controller');

router.use(authenticate);
router.use(authorize('ADMIN', 'TREASURER', 'COMMITTEE', 'PLATFORM_ADMIN', 'AUDITOR'));

router.get('/',        ctrl.getLogs);
router.get('/actions', ctrl.getActionTypes);
router.get('/stats',   ctrl.getAuditStats);

module.exports = router;
