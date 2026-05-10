const express = require('express');
const router = express.Router();
const scrollerCtrl = require('../controllers/scroller.controller');
const { authenticate } = require('../middleware/auth');

router.post('/platform', authenticate, scrollerCtrl.createPlatformScroller);
router.get('/platform', authenticate, scrollerCtrl.getActiveScrollers);
router.put('/:level/:scroller_id', authenticate, scrollerCtrl.updateScroller);
router.delete('/:level/:scroller_id', authenticate, scrollerCtrl.deleteScroller);
router.post('/platform/impression', authenticate, scrollerCtrl.trackImpression);

router.post('/society', authenticate, scrollerCtrl.createSocietyScroller);

module.exports = router;