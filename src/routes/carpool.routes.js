const express = require('express');
const router = express.Router();
const carpoolController = require('../controllers/carpool.controller');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', carpoolController.getAll);
router.post('/', carpoolController.create);
router.patch('/:id/status', carpoolController.updateStatus);
router.delete('/:id', carpoolController.deleteCarpool);

module.exports = router;
