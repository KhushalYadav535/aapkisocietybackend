const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const marketplaceController = require('../controllers/marketplace.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', marketplaceController.getAll);
router.get('/:id', marketplaceController.getById);

router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Listing title required'),
    body('category').trim().notEmpty().withMessage('Category required'),
  ],
  validate,
  marketplaceController.create
);

router.put(
  '/:id/status',
  [
    body('status').isIn(['AVAILABLE', 'RESERVED', 'SOLD']).withMessage('Status must be AVAILABLE, RESERVED, or SOLD'),
  ],
  validate,
  marketplaceController.updateStatus
);

router.delete('/:id', marketplaceController.deleteListing);

module.exports = router;
