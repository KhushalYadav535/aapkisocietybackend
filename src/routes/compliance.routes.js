const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/compliance.controller');

const router = express.Router();
router.use(authenticate);

router.get('/calendar', requirePermission('COMPLIANCE_MANAGE'), controller.getCalendar);
router.post('/calendar', requirePermission('COMPLIANCE_MANAGE'), [
  body('type').notEmpty(),
  body('title').notEmpty(),
  body('due_date').notEmpty()
], validate, controller.addEvent);
router.put('/calendar/:id', requirePermission('COMPLIANCE_MANAGE'), [
  body('status').isIn(['PENDING', 'COMPLETED', 'OVERDUE'])
], validate, controller.updateEvent);

module.exports = router;
