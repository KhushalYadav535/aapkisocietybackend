const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicle.controller');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', vehicleController.getAll);
// RESIDENT can add their own vehicle; controller links it to req.user
router.post('/', vehicleController.create);
// Any owner or admin can update
router.put('/:id', vehicleController.update);
router.delete('/:id', authorize('ADMIN', 'PLATFORM_ADMIN'), vehicleController.delete);
router.get('/parking-slots', vehicleController.getParkingSlots);
router.post('/parking-slots', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), vehicleController.createParkingSlot);
router.post('/parking-slots/:id/assign', authorize('ADMIN', 'COMMITTEE', 'PLATFORM_ADMIN'), vehicleController.assignSlot);

module.exports = router;