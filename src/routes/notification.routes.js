const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize , requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/notification.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('NOTIFICATION_MANAGE'), controller.list);
router.post('/', requirePermission('NOTIFICATION_MANAGE'), [
  body('channel').isIn(['SMS', 'EMAIL']).withMessage('Only SMS/EMAIL supported in MVP'),
  body('body').notEmpty().withMessage('Message body required')
], validate, controller.send);

// v4 notification endpoints
const v4Ctrl = require('../controllers/notification-v4.controller');
router.get('/v4', v4Ctrl.getNotifications);
router.post('/v4', v4Ctrl.createNotification);
router.put('/v4/:notification_id/read', v4Ctrl.markAsRead);
router.put('/v4/read-all', v4Ctrl.markAllAsRead);
router.post('/v4/renewal-reminders', v4Ctrl.sendRenewalReminders);
router.post('/v4/trial-reminders', v4Ctrl.sendTrialReminders);
router.get('/v4/renewal-banner', v4Ctrl.getRenewalBanner);

module.exports = router;
