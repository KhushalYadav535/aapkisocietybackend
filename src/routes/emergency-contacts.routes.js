const express = require('express');
const router = express.Router();
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/emergency-contacts.controller');

router.use(authenticate);

// All residents can view contacts
router.get('/', ctrl.getAll);

// Only admin/committee can manage
router.post('/', requirePermission('EMERGENCY_MANAGE'), ctrl.create);
router.put('/:id', requirePermission('EMERGENCY_MANAGE'), ctrl.update);
router.delete('/:id', requirePermission('EMERGENCY_MANAGE'), ctrl.remove);

module.exports = router;
