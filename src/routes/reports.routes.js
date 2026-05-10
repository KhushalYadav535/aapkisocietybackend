const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/collection', reportsController.getCollectionReport);
router.get('/complaints', reportsController.getComplaintReport);
router.get('/billing', reportsController.getBillingReport);
router.get('/visitors', reportsController.getVisitorReport);
router.get('/dashboard-summary', reportsController.getDashboardSummary);
router.get('/defaulters', authorize('ADMIN', 'COMMITTEE', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getDefaulterAging);
router.get('/trial-balance', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getTrialBalance);
router.get('/income-expenditure', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getIncomeExpenditure);
router.get('/balance-sheet', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getBalanceSheet);
router.get('/cash-flow', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getCashFlow);
router.get('/staff-attendance', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), reportsController.getStaffAttendance);
router.get('/facility-usage', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), reportsController.getFacilityUsage);
router.get('/members', authorize('ADMIN', 'COMMITTEE', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getMemberReport);
router.get('/maintenance-due', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getMaintenanceDue);
router.get('/interest', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getInterestReport);
router.get('/receipts-payments', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getReceiptsPayments);
router.get('/fund-summary', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getFundSummary);
router.get('/budget-variance', authorize('ADMIN', 'TREASURER', 'PLATFORM_ADMIN'), reportsController.getBudgetVariance);

module.exports = router;