const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const noticeController = require('../controllers/notice.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', noticeController.getAll);
router.get('/:id', noticeController.getById);
// MAKER can draft notices for ADMIN approval; COMMITTEE/TREASURER can create
router.post('/', authorize('ADMIN', 'COMMITTEE', 'TREASURER', 'MAKER', 'PLATFORM_ADMIN'), [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('content').trim().notEmpty().withMessage('Content required'),
  body('category').optional().trim(),
  body('priority').optional().isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
], validate, noticeController.create);
router.put('/:id', authorize('ADMIN', 'COMMITTEE', 'TREASURER', 'PLATFORM_ADMIN'), noticeController.update);
router.put('/:id/publish', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), noticeController.publish);
router.delete('/:id', authorize('ADMIN', 'PLATFORM_ADMIN'), noticeController.remove);

module.exports = router;

