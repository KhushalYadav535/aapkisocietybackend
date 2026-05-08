const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const visitorController = require('../controllers/visitor.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', visitorController.getAll);
router.get('/:id', visitorController.getById);
router.post('/', [
  body('visitor_name').trim().notEmpty().withMessage('Visitor name required'),
  body('purpose').optional().trim(),
  body('visitor_phone').optional().trim(),
], validate, visitorController.create);
router.put('/:id/checkout', visitorController.checkout);
router.put('/:id/approve', visitorController.approve);
router.get('/today/count', visitorController.todayCount);

module.exports = router;
