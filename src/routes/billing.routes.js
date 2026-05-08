const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const { requireFeature } = require('../middleware/feature');
const { requireTenantContext } = require('../middleware/tenant');
const billingController = require('../controllers/billing.controller');

const router = express.Router();

router.use(authenticate);
router.use(requireTenantContext);
router.use(requireFeature('billing_engine'));

router.get('/bills', billingController.getAllBills);
router.get('/bills/:id', billingController.getBillById);
router.post('/bills', authorize('ADMIN', 'TREASURER', 'MAKER'), [
  body('flat_id').optional(),
  body('amount').isNumeric().withMessage('Amount must be numeric'),
  body('bill_type').optional().trim(),
], validate, billingController.createBill);
router.put('/bills/:id/approve', authorize('ADMIN', 'TREASURER', 'CHECKER'), billingController.approveBill);
router.put('/bills/:id/reject', authorize('ADMIN', 'TREASURER', 'CHECKER'), billingController.rejectBill);

router.post('/generate-monthly', authorize('ADMIN', 'TREASURER'), billingController.generateMonthlyBills);

router.get('/payments', billingController.getPayments);
router.post('/payments', billingController.recordPayment);

router.get('/summary', billingController.getBillingSummary);

module.exports = router;
