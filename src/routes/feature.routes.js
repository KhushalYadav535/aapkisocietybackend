const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/feature.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), controller.getFlags);
router.put('/', authorize('ADMIN', 'PLATFORM_ADMIN'), [
  body('feature_key').notEmpty().withMessage('feature_key is required'),
  body('enabled').isBoolean().withMessage('enabled must be boolean')
], validate, controller.upsertFlag);

module.exports = router;
