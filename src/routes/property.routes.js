const express = require('express');
const router = express.Router();
const listingCtrl = require('../controllers/property-listing.controller');
const { authenticate } = require('../middleware/auth');

router.post('/listings', authenticate, listingCtrl.createListing);
router.get('/listings', authenticate, listingCtrl.getListings);
router.get('/listings/approval-queue', authenticate, listingCtrl.getApprovalQueue);
router.post('/listings/:id/approve', authenticate, listingCtrl.approveListing);
router.post('/listings/:id/reject', authenticate, listingCtrl.rejectListing);
router.post('/listings/:id/close', authenticate, listingCtrl.closeListing);
router.post('/listings/:id/renew', authenticate, listingCtrl.renewListing);
router.get('/listings/revenue', authenticate, listingCtrl.getPlatformRevenue);
router.get('/listings/society-revenue', authenticate, listingCtrl.getSocietyRevenue);
router.put('/listings/:id/visibility', authenticate, listingCtrl.toggleVisibility);

module.exports = router;