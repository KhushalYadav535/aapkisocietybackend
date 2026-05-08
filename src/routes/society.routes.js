const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { requireTenantContext } = require('../middleware/tenant');
const societyController = require('../controllers/society.controller');

const router = express.Router();

router.use(authenticate);
router.use(requireTenantContext);

router.post('/', authorize('PLATFORM_ADMIN', 'ADMIN'), [
  body('name').trim().notEmpty().withMessage('Society name required'),
  body('registration_number').optional().trim(),
  body('address').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('pincode').optional().trim(),
], validate, societyController.create);

router.get('/', societyController.getAll);
router.get('/:id', societyController.getById);
router.put('/:id', authorize('PLATFORM_ADMIN', 'ADMIN'), societyController.update);
router.get('/:id/wings', societyController.getWings);
router.post('/:id/wings', authorize('ADMIN'), societyController.addWing);
router.get('/:id/flats', societyController.getFlats);
router.post('/:id/flats', authorize('ADMIN'), societyController.addFlat);

router.put('/:id/suspend', authorize('PLATFORM_ADMIN'), societyController.suspend);
router.put('/:id/reactivate', authorize('PLATFORM_ADMIN'), societyController.reactivate);
router.delete('/:id', authorize('PLATFORM_ADMIN'), societyController.deleteSociety);

module.exports = router;
