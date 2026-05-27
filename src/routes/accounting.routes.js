const express = require('express');
const router = express.Router();
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/accounting.controller');

// All accounting routes require authentication
router.use(authenticate);

// ── Chart of Accounts ─────────────────────────────────────────────────────────
router.get('/accounts',         ctrl.getAccounts);
router.post('/accounts', requirePermission('ACCOUNTING_MANAGE'), ctrl.createAccount);

// ── Vouchers ──────────────────────────────────────────────────────────────────
router.get('/vouchers',          ctrl.getVouchers);
router.post('/vouchers', requirePermission('ACCOUNTING_MANAGE'), ctrl.createVoucher);
router.put('/vouchers/:id/approve', requirePermission('ACCOUNTING_MANAGE'), ctrl.approveVoucher);
router.put('/vouchers/:id/reverse', requirePermission('ACCOUNTING_MANAGE'), ctrl.reverseVoucher);
router.get('/vouchers/:id/entries', ctrl.getVoucherEntries);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/trial-balance', requirePermission('ACCOUNTING_MANAGE'), ctrl.getTrialBalance);
router.get('/ledger/:accountId', requirePermission('ACCOUNTING_MANAGE'), ctrl.getLedger);
router.get('/income-statement', requirePermission('ACCOUNTING_MANAGE'), ctrl.getIncomeStatement);
router.get('/balance-sheet', requirePermission('ACCOUNTING_MANAGE'), ctrl.getBalanceSheet);
router.get('/bank-reconciliation', requirePermission('ACCOUNTING_MANAGE'), ctrl.getBankReconciliationStatement);

module.exports = router;
