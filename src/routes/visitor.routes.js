const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const visitorController = require('../controllers/visitor.controller');

const router = express.Router();

router.use(authenticate);

// All roles can view visitors list
router.get('/', visitorController.getAll);
router.get('/:id', visitorController.getById);
// Any resident/guard/admin can log a visitor
router.post('/', [
  body('visitor_name').trim().notEmpty().withMessage('Visitor name required'),
  body('purpose').optional().trim(),
  body('visitor_phone').optional().trim(),
], validate, visitorController.create);
// Guard can check in/out; admin can also approve
router.put('/:id/checkout', requirePermission('VISITOR_MANAGE'), visitorController.checkout);
router.put('/:id/approve', requirePermission('VISITOR_MANAGE'), visitorController.approve);
router.get('/today/count', visitorController.todayCount);

module.exports = router;

