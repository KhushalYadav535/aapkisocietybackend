const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/compliance.controller');

const router = express.Router();
router.use(authenticate);

router.get('/calendar', authorize('ADMIN', 'TREASURER', 'COMMITTEE'), controller.getCalendar);
router.post('/calendar', authorize('ADMIN', 'TREASURER'), [
  body('type').notEmpty(),
  body('title').notEmpty(),
  body('due_date').notEmpty()
], validate, controller.addEvent);
router.put('/calendar/:id', authorize('ADMIN', 'TREASURER'), [
  body('status').isIn(['PENDING', 'COMPLETED', 'OVERDUE'])
], validate, controller.updateEvent);

module.exports = router;
