const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/tax.controller');

const router = express.Router();
router.use(authenticate);

router.get('/returns', authorize('ADMIN', 'TREASURER'), controller.list);
router.get('/gstr-1', authorize('ADMIN', 'TREASURER'), controller.getGSTR1View);
router.get('/gstr-3b', authorize('ADMIN', 'TREASURER'), controller.getGSTR3BView);
router.get('/gst-reconciliation', authorize('ADMIN', 'TREASURER'), controller.getGSTReconciliation);
router.get('/gstr-9', authorize('ADMIN', 'TREASURER'), controller.getGSTR9View);
router.post('/gst/export', authorize('ADMIN', 'TREASURER'), [
  body('return_type').optional().isIn(['GSTR-1', 'GSTR-3B', 'GSTR-9', 'GSTR-7']),
  body('period').notEmpty()
], validate, controller.createGSTR);
router.post('/tds/export', authorize('ADMIN', 'TREASURER'), [
  body('form_type').optional().isIn(['26Q', '24Q', '16A', 'ITNS-281']),
  body('period').notEmpty()
], validate, controller.createTDS);

module.exports = router;
