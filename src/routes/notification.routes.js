const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/notification.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', authorize('ADMIN', 'TREASURER', 'COMMITTEE'), controller.list);
router.post('/', authorize('ADMIN', 'TREASURER'), [
  body('channel').isIn(['SMS', 'EMAIL']).withMessage('Only SMS/EMAIL supported in MVP'),
  body('body').notEmpty().withMessage('Message body required')
], validate, controller.send);

module.exports = router;
