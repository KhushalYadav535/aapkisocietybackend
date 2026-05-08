const express = require('express');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/privacy.controller');

const router = express.Router();
router.use(authenticate);

router.get('/consent', controller.getConsent);
router.put('/consent', [
  body('billing_comms').optional().isBoolean(),
  body('statutory_notices').optional().isBoolean(),
  body('marketing').optional().isBoolean()
], validate, controller.updateConsent);
router.post('/requests', [
  body('type').optional().isIn(['ERASURE', 'PORTABILITY']),
  body('reason').optional().trim()
], validate, controller.createErasureRequest);

module.exports = router;
