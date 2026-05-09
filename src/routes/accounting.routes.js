const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/accounting.controller');

// All accounting routes require authentication
router.use(authenticate);

// ── Chart of Accounts ─────────────────────────────────────────────────────────
router.get('/accounts',         ctrl.getAccounts);
router.post('/accounts',        authorize('ADMIN', 'TREASURER', 'MAKER', 'CHECKER'), ctrl.createAccount);

// ── Vouchers ──────────────────────────────────────────────────────────────────
router.get('/vouchers',          ctrl.getVouchers);
router.post('/vouchers',         authorize('ADMIN', 'TREASURER', 'MAKER', 'CHECKER', 'ACCOUNTANT'), ctrl.createVoucher);
router.put('/vouchers/:id/approve', authorize('ADMIN', 'TREASURER', 'CHECKER'), ctrl.approveVoucher);
router.put('/vouchers/:id/reverse', authorize('ADMIN', 'TREASURER'), ctrl.reverseVoucher);
router.get('/vouchers/:id/entries', ctrl.getVoucherEntries);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/trial-balance', authorize('ADMIN', 'TREASURER', 'MAKER', 'CHECKER', 'COMMITTEE', 'AUDITOR'), ctrl.getTrialBalance);
router.get('/ledger/:accountId', authorize('ADMIN', 'TREASURER', 'MAKER', 'CHECKER', 'COMMITTEE', 'AUDITOR'), ctrl.getLedger);

module.exports = router;
