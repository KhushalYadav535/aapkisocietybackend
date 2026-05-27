const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize, requirePermission } = require('../middleware/auth');
const { requireFeature } = require('../middleware/feature');
const { requireTenantContext } = require('../middleware/tenant');
const billingController = require('../controllers/billing.controller');

const router = express.Router();

router.use(authenticate);
router.use(requireTenantContext);
router.use(requireFeature('billing_engine'));

// All authenticated users can view bills (controller filters by their role/membership)
router.get('/bills', billingController.getAllBills);
router.get('/bills/:id', billingController.getBillById);
// MAKER creates, CHECKER approves (4-eyes principle), TREASURER/ADMIN manage all
router.post('/bills', authorize('ADMIN', 'TREASURER', 'MAKER', 'PLATFORM_ADMIN'), [
  body('flat_id').optional(),
  body('amount').isNumeric().withMessage('Amount must be numeric'),
  body('bill_type').optional().trim(),
], validate, billingController.createBill);
router.put('/bills/:id/approve', requirePermission('BILL_APPROVE'), billingController.approveBill);
router.put('/bills/:id/reject', requirePermission('BILL_APPROVE'), billingController.rejectBill);

router.post('/generate-monthly', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.generateMonthlyBills);

// All roles can view payments (filtered by ownership in controller); RESIDENT can pay their bills
router.get('/payments', billingController.getPayments);
router.post('/payments', billingController.recordPayment);

router.get('/summary', billingController.getBillingSummary);
router.get('/arrears-aging', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.getArrearsAging);
router.get('/defaulters', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.getDefaultersList);
router.get('/dunning-history', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.getDunningHistory);
router.get('/dunning-config', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.getDunningConfig);
router.post('/send-reminder', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.sendReminder);

// Billing Heads CRUD
router.get('/heads', billingController.getAllBillingHeads);
router.get('/heads/:id', billingController.getBillingHeadById);
router.post('/heads', authorize('ADMIN', 'TREASURER', 'MAKER', 'PLATFORM_ADMIN'), [
  body('name').notEmpty().withMessage('Name is required'),
], validate, billingController.createBillingHead);
router.put('/heads/:id', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.updateBillingHead);
router.delete('/heads/:id', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.deleteBillingHead);

// Duplicate bill prevention
router.post('/check-duplicate', billingController.checkDuplicateBill);

// Generate bills with billing heads
router.post('/generate-bulk', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.generateBulkBillsWithHeads);
router.post('/generate-with-heads', authorize('ADMIN', 'TREASURER', 'MAKER', 'PLATFORM_ADMIN'), billingController.createBillWithHeads);

// Arrears from ledger
router.get('/member-arrears/:member_id', billingController.getMemberArrears);
router.get('/arrears-summary', billingController.getArrearsSummaryFromLedger);

// Export functionality
router.get('/export/excel', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.exportBillsExcel);
router.get('/export/arrears-excel', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.exportArrearsExcel);
router.get('/export/pdf', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), billingController.exportBillsPDFReport);

// Bill PDF generation
router.get('/bills/:id/pdf', billingController.generateBillPDF);

module.exports = router;

