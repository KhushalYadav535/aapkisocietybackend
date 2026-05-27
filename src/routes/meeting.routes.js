const express = require('express');
const router = express.Router();
const meetingController = require('../controllers/meeting.controller');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/', meetingController.getMeetings);
router.get('/:id', meetingController.getById);
router.post('/', requirePermission('MEETING_MANAGE'), meetingController.create);
router.put('/:id/status', requirePermission('MEETING_MANAGE'), meetingController.updateStatus);

// Polls
router.get('/polls/all', meetingController.getPolls);
router.post('/polls', requirePermission('MEETING_MANAGE'), meetingController.createPoll);
router.post('/polls/:id/vote', meetingController.vote);
router.put('/polls/:id/close', requirePermission('MEETING_MANAGE'), meetingController.closePoll);

module.exports = router;