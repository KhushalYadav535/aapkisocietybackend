const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const complaintController = require('../controllers/complaint.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', complaintController.getAll);
router.get('/:id', complaintController.getById);
// ADMIN/COMMITTEE/PLATFORM_ADMIN can also log complaints on behalf of residents
router.post('/', authorize('RESIDENT', 'ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('description').optional().trim(),
  body('category').optional().trim(),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
], validate, complaintController.create);
router.put('/:id', complaintController.update);
router.put('/:id/assign', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), complaintController.assign);
router.put('/:id/resolve', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), complaintController.resolve);
// Any authenticated user can close their own complaint; controller enforces ownership
router.put('/:id/close', complaintController.close);

module.exports = router;

