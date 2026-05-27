const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize, requirePermission } = require('../middleware/auth');
const noticeController = require('../controllers/notice.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', noticeController.getAll);
router.get('/:id', noticeController.getById);
// MAKER can draft notices for ADMIN approval; COMMITTEE/TREASURER can create
router.post('/', requirePermission('NOTICE_CREATE'), [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('content').trim().notEmpty().withMessage('Content required'),
  body('category').optional().trim(),
  body('priority').optional().isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
], validate, noticeController.create);
router.put('/:id', requirePermission('NOTICE_CREATE'), noticeController.update);
router.put('/:id/publish', requirePermission('NOTICE_PUBLISH'), noticeController.publish);
router.delete('/:id', requirePermission('NOTICE_CREATE'), noticeController.remove);

module.exports = router;

