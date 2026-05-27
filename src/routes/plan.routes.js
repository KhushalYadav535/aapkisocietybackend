const express = require('express');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const planController = require('../controllers/plan.controller');

const router = express.Router();

router.use(authenticate);

// Only PLATFORM_ADMIN can manage plans
router.get('/', requirePermission('PLAN_MANAGE'), planController.getAll);
router.post('/', requirePermission('PLAN_MANAGE'), planController.create);
router.put('/:id', requirePermission('PLAN_MANAGE'), planController.update);
router.delete('/:id', requirePermission('PLAN_MANAGE'), planController.delete);

module.exports = router;
