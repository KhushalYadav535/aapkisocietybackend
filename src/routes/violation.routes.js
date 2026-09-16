const express = require('express');
const router = express.Router();
const violationController = require('../controllers/violation.controller');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', violationController.getAll);
router.post('/', violationController.create);
router.patch('/:id/action', violationController.updateAction);

module.exports = router;
