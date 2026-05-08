const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const planController = require('../controllers/plan.controller');

const router = express.Router();

router.use(authenticate);

// Only PLATFORM_ADMIN can manage plans
router.get('/', authorize('PLATFORM_ADMIN'), planController.getAll);
router.post('/', authorize('PLATFORM_ADMIN'), planController.create);
router.put('/:id', authorize('PLATFORM_ADMIN'), planController.update);
router.delete('/:id', authorize('PLATFORM_ADMIN'), planController.delete);

module.exports = router;
