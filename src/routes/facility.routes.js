const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const facilityController = require('../controllers/facility.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', facilityController.getAll);
router.get('/:id', facilityController.getById);
router.post('/', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), [
  body('name').trim().notEmpty().withMessage('Facility name required'),
], validate, facilityController.create);
router.put('/:id', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), facilityController.update);

router.get('/:id/bookings', facilityController.getBookings);
router.post('/:id/book', [
  body('booking_date').notEmpty().withMessage('Booking date required'),
], validate, facilityController.book);
router.put('/bookings/:bookingId/cancel', facilityController.cancelBooking);

module.exports = router;
