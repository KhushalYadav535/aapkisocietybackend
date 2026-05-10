const express = require('express');
const router = express.Router();
const exportCtrl = require('../controllers/export.controller');
const { authenticate } = require('../middleware/auth');

router.post('/tally', authenticate, exportCtrl.tallyExport);
router.post('/tally/tds', authenticate, exportCtrl.tallyTdsExport);
router.post('/tally/validate', authenticate, exportCtrl.tallyValidation);
router.post('/excel', authenticate, exportCtrl.excelExport);
router.post('/excel/multi-sheet', authenticate, exportCtrl.multiSheetExcelExport);
router.post('/pdf', authenticate, exportCtrl.pdfExport);
router.post('/history', authenticate, exportCtrl.recordExportHistory);
router.get('/history', authenticate, exportCtrl.getExportHistory);

module.exports = router;