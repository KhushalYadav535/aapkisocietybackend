const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/emergency-contacts.controller');

router.use(authenticate);

// All residents can view contacts
router.get('/', ctrl.getAll);

// Only admin/committee can manage
router.post('/', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), ctrl.create);
router.put('/:id', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), ctrl.update);
router.delete('/:id', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), ctrl.remove);

module.exports = router;
