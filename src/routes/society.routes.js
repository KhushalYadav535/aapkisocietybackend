const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize, requirePermission } = require('../middleware/auth');
const { requireTenantContext } = require('../middleware/tenant');
const societyController = require('../controllers/society.controller');

const router = express.Router();

router.use(authenticate);

// Creation of a new society by an Admin who doesn't have a society_id yet must be allowed
const tenantContextExceptCreate = (req, res, next) => {
  if (req.user.role === 'PLATFORM_ADMIN') return next();
  if (req.method === 'POST' && (req.path === '/' || req.path === '')) return next();
  return requireTenantContext(req, res, next);
};
router.use(tenantContextExceptCreate);

router.post('/', authorize('ADMIN', 'PLATFORM_ADMIN'), [
  body('name').trim().notEmpty().withMessage('Society name required'),
  body('registration_number').optional().trim(),
  body('address').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('pincode').optional().trim(),
], validate, societyController.create);

router.get('/', societyController.getAll);
router.get('/masters/home-types', societyController.getHomeTypeMasters);
router.get('/:id', societyController.getById);
router.put('/:id', requirePermission('SOCIETY_MANAGE'), societyController.update);
router.put('/:id/setup', requirePermission('SOCIETY_MANAGE'), societyController.completeSetup);
router.get('/:id/wings', societyController.getWings);
router.post('/:id/wings', requirePermission('SOCIETY_MANAGE'), societyController.addWing);
router.get('/:id/flats', societyController.getFlats);
router.post('/:id/flats', requirePermission('SOCIETY_MANAGE'), societyController.addFlat);
router.delete('/:id/flats/:flatId', requirePermission('SOCIETY_MANAGE'), societyController.deleteFlat);

router.put('/:id/suspend', authorize('PLATFORM_ADMIN'), societyController.suspend);
router.put('/:id/reactivate', authorize('PLATFORM_ADMIN'), societyController.reactivate);
router.delete('/:id', authorize('PLATFORM_ADMIN'), societyController.deleteSociety);

module.exports = router;
