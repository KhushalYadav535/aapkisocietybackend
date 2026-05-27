const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staff.controller');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/', staffController.getAll);
router.get('/list', staffController.getStaff);
router.post('/', requirePermission('STAFF_MANAGE'), staffController.createStaff);
router.post('/check-in', staffController.checkIn);
router.post('/check-out', staffController.checkOut);
router.post('/mark-absent', requirePermission('STAFF_MANAGE'), staffController.markAbsent);
router.get('/summary', staffController.getSummary);
router.delete('/:id', requirePermission('STAFF_MANAGE'), staffController.deactivate);

module.exports = router;