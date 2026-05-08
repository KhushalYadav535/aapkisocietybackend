const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/mandate.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.getMandates);
router.post('/', authorize('RESIDENT', 'ADMIN', 'TREASURER'), [
  body('type').isIn(['UPI_AUTOPAY', 'NACH']).withMessage('Invalid mandate type'),
  body('amount_limit').optional().isNumeric()
], validate, controller.createMandate);
router.put('/:id/status', authorize('RESIDENT', 'ADMIN', 'TREASURER'), [
  body('status').isIn(['ACTIVE', 'PAUSED', 'CANCELLED', 'FAILED']).withMessage('Invalid status')
], validate, controller.updateMandateStatus);

module.exports = router;
