const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/tax.controller');

const router = express.Router();
router.use(authenticate);

router.get('/returns', requirePermission('TAX_VIEW'), controller.list);
router.get('/gstr-1', requirePermission('TAX_VIEW'), controller.getGSTR1View);
router.get('/gstr-3b', requirePermission('TAX_VIEW'), controller.getGSTR3BView);
router.get('/gst-reconciliation', requirePermission('TAX_VIEW'), controller.getGSTReconciliation);
router.get('/gstr-9', requirePermission('TAX_VIEW'), controller.getGSTR9View);
router.post('/gst/export', requirePermission('TAX_MANAGE'), [
  body('return_type').optional().isIn(['GSTR-1', 'GSTR-3B', 'GSTR-9', 'GSTR-7']),
  body('period').notEmpty()
], validate, controller.createGSTR);
router.post('/tds/export', requirePermission('TAX_MANAGE'), [
  body('form_type').optional().isIn(['26Q', '24Q', '16A', 'ITNS-281']),
  body('period').notEmpty()
], validate, controller.createTDS);

module.exports = router;
