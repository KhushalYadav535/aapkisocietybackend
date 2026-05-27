const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const documentController = require('../controllers/document.controller');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/documents')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Invalid file type'));
  }
});

router.use(authenticate);

router.get('/', documentController.getAll);
router.get('/categories', documentController.getCategories);
router.get('/:id', documentController.getById);
router.post('/', requirePermission('DOCUMENT_MANAGE'), upload.single('file'), documentController.upload);
router.put('/:id', requirePermission('DOCUMENT_MANAGE'), documentController.update);
router.delete('/:id', requirePermission('DOCUMENT_MANAGE'), documentController.delete);

module.exports = router;