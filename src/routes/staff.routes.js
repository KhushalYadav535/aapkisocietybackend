const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staff.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', staffController.getAll);
router.get('/list', staffController.getStaff);
router.post('/', authorize('ADMIN', 'TREASURER', 'COMMITTEE'), staffController.createStaff);
router.post('/check-in', staffController.checkIn);
router.post('/check-out', staffController.checkOut);
router.post('/mark-absent', authorize('ADMIN', 'COMMITTEE'), staffController.markAbsent);
router.get('/summary', staffController.getSummary);
router.delete('/:id', authorize('ADMIN'), staffController.deactivate);

module.exports = router;