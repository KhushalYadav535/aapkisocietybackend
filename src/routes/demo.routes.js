const express = require('express');
const router = express.Router();
const demoController = require('../controllers/demo.controller');
const { authenticate } = require('../middleware/auth');

// Public route to book demo from landing page (no auth required)
router.post('/book', demoController.bookDemo);

// Authenticated route for admins to view demo leads
router.get('/list', authenticate, demoController.getAllDemoBookings);

module.exports = router;
