const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { requireTenantContext } = require('../middleware/tenant');
const memberController = require('../controllers/member.controller');

const router = express.Router();

router.use(authenticate);
router.use(requireTenantContext);

// All roles can view members list (controller filters by society)
router.get('/', memberController.getAll);
router.get('/:id', memberController.getById);
// ADMIN + COMMITTEE + PLATFORM_ADMIN can create members
router.post('/', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), [
  body('email').isEmail().withMessage('Valid email required'),
  body('first_name').trim().notEmpty().withMessage('First name required'),
  body('last_name').trim().notEmpty().withMessage('Last name required'),
  body('flat_number').trim().notEmpty().withMessage('Flat number required'),
], validate, memberController.create);
router.put('/:id', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), memberController.update);
router.delete('/:id', authorize('ADMIN', 'PLATFORM_ADMIN'), memberController.deactivate);
router.post('/:id/transfer', authorize('ADMIN', 'PLATFORM_ADMIN'), memberController.transferOwnership);

module.exports = router;

