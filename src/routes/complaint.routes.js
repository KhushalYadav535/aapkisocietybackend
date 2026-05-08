const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const complaintController = require('../controllers/complaint.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', complaintController.getAll);
router.get('/:id', complaintController.getById);
router.post('/', authorize('RESIDENT'), [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('description').optional().trim(),
  body('category').optional().trim(),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
], validate, complaintController.create);
router.put('/:id', complaintController.update);
router.put('/:id/assign', authorize('ADMIN', 'COMMITTEE'), complaintController.assign);
router.put('/:id/resolve', authorize('ADMIN', 'COMMITTEE'), complaintController.resolve);
router.put('/:id/close', complaintController.close);

module.exports = router;
