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

module.exports = router;