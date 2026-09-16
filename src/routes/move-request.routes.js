const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, requirePermission } = require('../middleware/auth');
const moveRequestController = require('../controllers/move-request.controller');

const router = express.Router();

router.use(authenticate);

router.get('/verify', moveRequestController.verifyNoc);
router.get('/', moveRequestController.getAll);
router.get('/:id', moveRequestController.getById);

router.post(
  '/',
  [
    body('applicant_name').trim().notEmpty().withMessage('Applicant name required'),
    body('applicant_phone').trim().notEmpty().withMessage('Applicant phone required'),
    body('flat_number').trim().notEmpty().withMessage('Flat number required'),
    body('move_date').notEmpty().withMessage('Move date required'),
  ],
  validate,
  moveRequestController.create
);

router.put(
  '/:id/status',
  requirePermission('SOCIETY_MANAGE'),
  [
    body('status').isIn(['APPROVED', 'REJECTED', 'COMPLETED', 'PENDING']).withMessage('Valid status required'),
  ],
  validate,
  moveRequestController.updateStatus
);

module.exports = router;
