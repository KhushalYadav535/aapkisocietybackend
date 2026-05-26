const express = require('express');
const { authenticate } = require('../middleware/auth');
const dashboardController = require('../controllers/dashboard.controller');

const router = express.Router();

router.use(authenticate);

// Short-lived cache: dashboard data is fresh enough at 30s.
// stale-while-revalidate lets the browser show old data instantly
// while fetching fresh data silently in the background.
const dashboardCache = (req, res, next) => {
  res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  next();
};

router.get('/stats', dashboardCache, dashboardController.getStats);
router.get('/recent-activities', dashboardCache, dashboardController.getRecentActivities);
router.get('/collection-summary', dashboardCache, dashboardController.getCollectionSummary);
router.get('/complaint-stats', dashboardCache, dashboardController.getComplaintStats);

module.exports = router;
