import { Router } from 'express';
import { BookingEngineController } from '../controllers/booking-engine.controller';

// Mobile Booking Engine API (Laravel routes/web.php parity, no auth).
export const bookingRoutes = Router();

bookingRoutes.post('/roomUnavailable', BookingEngineController.roomAvailability);
bookingRoutes.post('/checkDataReservation', BookingEngineController.checkDataReservation);
bookingRoutes.post('/masterBookingEngine', BookingEngineController.masterBookingEngine);
bookingRoutes.post('/storeReservation', BookingEngineController.storeReservation);
bookingRoutes.post('/preCheckIn', BookingEngineController.preCheckIn);
bookingRoutes.post('/cancelReservation', BookingEngineController.cancelReservation);
