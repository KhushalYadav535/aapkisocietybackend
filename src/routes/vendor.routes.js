const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendor.controller');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/', vendorController.getAll);
router.get('/categories', vendorController.getCategories);
router.post('/', requirePermission('VENDOR_MANAGE'), vendorController.create);
router.put('/:id', requirePermission('VENDOR_MANAGE'), vendorController.update);
router.delete('/:id', requirePermission('VENDOR_MANAGE'), vendorController.delete);
router.post('/:id/rate', vendorController.rate);
router.get('/:id/reviews', vendorController.getReviews);

module.exports = router;