const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const firstMsg = errors.array()[0]?.msg || 'Validation failed';
    return res.status(400).json({
      error: firstMsg,
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
};

module.exports = { validate };
