const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/collection', reportsController.getCollectionReport);
router.get('/complaints', reportsController.getComplaintReport);
router.get('/billing', reportsController.getBillingReport);
router.get('/visitors', reportsController.getVisitorReport);
router.get('/dashboard-summary', reportsController.getDashboardSummary);
router.get('/defaulters', requirePermission('REPORT_VIEW'), reportsController.getDefaulterAging);
router.get('/trial-balance', requirePermission('REPORT_VIEW'), reportsController.getTrialBalance);
router.get('/income-expenditure', requirePermission('REPORT_VIEW'), reportsController.getIncomeExpenditure);
router.get('/balance-sheet', requirePermission('REPORT_VIEW'), reportsController.getBalanceSheet);
router.get('/cash-flow', requirePermission('REPORT_VIEW'), reportsController.getCashFlow);
router.get('/staff-attendance', requirePermission('REPORT_VIEW'), reportsController.getStaffAttendance);
router.get('/facility-usage', requirePermission('REPORT_VIEW'), reportsController.getFacilityUsage);
router.get('/members', requirePermission('REPORT_VIEW'), reportsController.getMemberReport);
router.get('/maintenance-due', requirePermission('REPORT_VIEW'), reportsController.getMaintenanceDue);
router.get('/interest', requirePermission('REPORT_VIEW'), reportsController.getInterestReport);
router.get('/receipts-payments', requirePermission('REPORT_VIEW'), reportsController.getReceiptsPayments);
router.get('/fund-summary', requirePermission('REPORT_VIEW'), reportsController.getFundSummary);
router.get('/budget-variance', requirePermission('REPORT_VIEW'), reportsController.getBudgetVariance);

module.exports = router;