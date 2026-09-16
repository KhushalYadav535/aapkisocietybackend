const express = require('express');
const router = express.Router();
const bloodController = require('../controllers/blood.controller');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/donors', bloodController.getDonors);
router.post('/my-group', bloodController.updateBloodGroup);
router.get('/requests', bloodController.getRequests);
router.post('/requests', bloodController.createRequest);
router.patch('/requests/:id/status', bloodController.updateStatus);

module.exports = router;
