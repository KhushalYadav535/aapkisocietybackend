const express = require('express');
const router = express.Router();
const meetingController = require('../controllers/meeting.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', meetingController.getMeetings);
router.get('/:id', meetingController.getById);
router.post('/', authorize('ADMIN', 'COMMITTEE'), meetingController.create);
router.put('/:id/status', authorize('ADMIN', 'COMMITTEE'), meetingController.updateStatus);

// Polls
router.get('/polls/all', meetingController.getPolls);
router.post('/polls', authorize('ADMIN', 'COMMITTEE'), meetingController.createPoll);
router.post('/polls/:id/vote', meetingController.vote);
router.put('/polls/:id/close', authorize('ADMIN', 'COMMITTEE'), meetingController.closePoll);

module.exports = router;