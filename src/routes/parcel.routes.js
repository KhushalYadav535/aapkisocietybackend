const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const parcelController = require('../controllers/parcel.controller');

const router = express.Router();

router.use(authenticate);

router.get('/stats', parcelController.getStats);
router.get('/', parcelController.getAll);

router.post(
  '/',
  [
    body('flat_number').trim().notEmpty().withMessage('Flat number required'),
    body('delivery_company').trim().notEmpty().withMessage('Delivery company required'),
  ],
  validate,
  parcelController.create
);

router.put(
  '/:id/collect',
  [
    body('pickup_pin').trim().notEmpty().withMessage('Pickup PIN required'),
  ],
  validate,
  parcelController.verifyAndCollect
);

router.put('/:id/return', parcelController.markReturned);

module.exports = router;
