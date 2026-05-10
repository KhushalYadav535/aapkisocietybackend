const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendor.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', vendorController.getAll);
router.get('/categories', vendorController.getCategories);
router.post('/', authorize('ADMIN', 'COMMITTEE'), vendorController.create);
router.put('/:id', authorize('ADMIN', 'COMMITTEE'), vendorController.update);
router.delete('/:id', authorize('ADMIN'), vendorController.delete);
router.post('/:id/rate', vendorController.rate);
router.get('/:id/reviews', vendorController.getReviews);

module.exports = router;