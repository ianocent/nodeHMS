import { Router } from 'express';
import { LifestyleController } from '../controllers/lifestyle.controller';
import { PreRegistrationController } from '../controllers/pre-registration.controller';

// Laravel routes/web.php `Route::prefix('middleware')` — public (no auth).
// hmsBookingEngine reaches these through
// config('cms.apihms_middleware_curl') = env('APP_HMS_URL') . '/middleware'.
export const middlewareRoutes = Router();

// throttle:5,15 in the reference; a fixed window is enough for the single-tenant
// pre-registration form and keeps the route dependency-free.
middlewareRoutes.get('/pre-registration/verify', PreRegistrationController.verify);
middlewareRoutes.post('/pre-registration/verify', PreRegistrationController.verify);
// throttle:10,15 in the reference.
middlewareRoutes.post('/pre-registration/complete', PreRegistrationController.complete);

// web.php:139 -> MiddlewareBookingEngineController::lifestyleProperties
middlewareRoutes.get('/lifestyle/properties', LifestyleController.propertiesForBookingEngine);