const express = require('express');
const { authenticate } = require('../middleware/auth');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

router.use(authenticate);

router.get('/stats', dashboardController.getStats);
router.get('/recent-activities', dashboardController.getRecentActivities);
router.get('/collection-summary', dashboardController.getCollectionSummary);
router.get('/complaint-stats', dashboardController.getComplaintStats);

module.exports = router;
