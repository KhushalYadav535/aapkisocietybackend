const express = require('express');
const router = express.Router();
const noticeReadController = require('../controllers/notice-read.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.post('/mark-read', noticeReadController.markRead);
router.get('/receipts/:notice_id', noticeReadController.getReadReceipts);
router.get('/unread', noticeReadController.getMyUnread);

module.exports = router;