const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const controller = require('../controllers/oauth.controller');

const router = express.Router();

router.post('/token', [
  body('client_id').notEmpty(),
  body('client_secret').notEmpty(),
  body('grant_type').optional().isString()
], validate, controller.token);

module.exports = router;
