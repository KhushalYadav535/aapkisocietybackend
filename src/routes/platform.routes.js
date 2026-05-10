const express = require('express');
const router = express.Router();
const platformCtrl = require('../controllers/platform.controller');
const { authenticate } = require('../middleware/auth');
const { isPlatformRole } = require('../constants/roles');

const { requireMfaReauth } = require('../middleware/mfaReauth');

const platformAuth = (req, res, next) => {
  if (!isPlatformRole(req.user.role)) {
    return res.status(403).json({ error: 'Platform admin access required' });
  }
  next();
};

// ─── Public Routes ──────────────────────────────────────────────────────
router.post('/societies/register', platformCtrl.registerSociety);
router.get('/verify/:token', platformCtrl.verifyEmail);

// ─── Authenticated Platform Routes ──────────────────────────────────────
router.get('/societies', authenticate, platformAuth, platformCtrl.getAllSocieties);
router.get('/societies/kyc-queue', authenticate, platformAuth, platformCtrl.getKYCPending);
router.get('/societies/:id', authenticate, platformAuth, platformCtrl.getSocietyById);
router.post('/kyc/submit', authenticate, platformCtrl.submitKYC);
router.post('/kyc/approve', authenticate, platformAuth, platformCtrl.approveKYC);
router.post('/kyc/reject', authenticate, platformAuth, platformCtrl.rejectKYC);
router.post('/subscription/renew', authenticate, platformAuth, platformCtrl.recordManualRenewal);
router.post('/subscription/update', authenticate, platformAuth, requireMfaReauth, platformCtrl.updateSubscription);
router.post('/features/update', authenticate, platformAuth, platformCtrl.updateFeatureFlags);
router.get('/stats', authenticate, platformAuth, platformCtrl.getPlatformStats);
router.get('/plans', authenticate, platformCtrl.getPlans);
router.get('/renewals', authenticate, platformAuth, platformCtrl.getRenewalCalendar);
router.post('/kyc/reupload', authenticate, platformAuth, platformCtrl.requestReUpload);
router.post('/configuration', authenticate, platformCtrl.saveConfiguration);
router.get('/onboarding/:id', authenticate, platformCtrl.getOnboardingProgress);
router.post('/trial/activate', authenticate, platformAuth, platformCtrl.activateTrial);
router.get('/pricing', platformCtrl.calculatePricing);

// CSV Import
const csvImportCtrl = require('../controllers/csv-import.controller');
router.post('/import/members', authenticate, csvImportCtrl.importMembers);
router.post('/import/flats', authenticate, csvImportCtrl.importFlats);

module.exports = router;