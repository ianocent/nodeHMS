import { Router } from 'express';
import { BookingEngineController } from '../controllers/booking-engine.controller';

// Mobile Booking Engine API (Laravel routes/web.php parity, no auth).
export const bookingRoutes = Router();

// GET variants: hmsBookingEngine calls GET /booking/roomUnavailable?client_uid= etc (web.php parity)
bookingRoutes.get('/roomUnavailable', BookingEngineController.roomAvailability);
bookingRoutes.get('/masterBookingEngine', BookingEngineController.masterBookingEngine);
bookingRoutes.get('/preCheckIn', BookingEngineController.preCheckIn);
bookingRoutes.get('/cancelReservation', BookingEngineController.cancelReservation);
bookingRoutes.get('/checkDataReservation', BookingEngineController.checkDataReservation);
bookingRoutes.post('/roomUnavailable', BookingEngineController.roomAvailability);
bookingRoutes.post('/checkDataReservation', BookingEngineController.checkDataReservation);
bookingRoutes.post('/masterBookingEngine', BookingEngineController.masterBookingEngine);
bookingRoutes.post('/storeReservation', BookingEngineController.storeReservation);
bookingRoutes.post('/preCheckIn', BookingEngineController.preCheckIn);
bookingRoutes.post('/cancelReservation', BookingEngineController.cancelReservation);
