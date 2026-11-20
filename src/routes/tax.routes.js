const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/tax.controller');

const router = express.Router();
router.use(authenticate);

const TAX_ROLES = ['ADMIN', 'TREASURER', 'CHECKER', 'TREASURY_CHECKER', 'COMMITTEE', 'PLATFORM_ADMIN'];

router.get('/returns', authorize(...TAX_ROLES), controller.list);
router.get('/gstr-1', authorize(...TAX_ROLES), controller.getGSTR1View);
router.get('/gstr-3b', authorize(...TAX_ROLES), controller.getGSTR3BView);
router.get('/gst-reconciliation', authorize(...TAX_ROLES), controller.getGSTReconciliation);
router.get('/gstr-9', authorize(...TAX_ROLES), controller.getGSTR9View);
router.post('/gst/export', authorize(...TAX_ROLES), [
  body('return_type').optional().isIn(['GSTR-1', 'GSTR-3B', 'GSTR-9', 'GSTR-7']),
  body('period').notEmpty()
], validate, controller.createGSTR);
router.post('/tds/export', authorize(...TAX_ROLES), [
  body('form_type').optional().isIn(['26Q', '24Q', '16A', 'ITNS-281']),
  body('period').notEmpty()
], validate, controller.createTDS);

module.exports = router;
