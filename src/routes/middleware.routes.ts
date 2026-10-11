import { Router } from 'express';
import { prisma } from '../config/prisma';
import { brandingBanners } from '../controllers/branding.controller';
import { LoyaltyFacilityController } from '../controllers/loyalty-facility.controller';
import { PreRegistrationController } from '../controllers/pre-registration.controller';
import { GuestNotificationController } from '../controllers/guest-notification.controller';
import { GuestEventController } from '../controllers/guest-event.controller';
import { GuestProfileSyncController } from '../controllers/guest-profile-sync.controller';

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

// web.php:139 -> MiddlewareBookingEngineController::propertiesForBookingEngine.
// `/lifestyle/properties` stays as an alias: hmsBookingEngine/frontend fetches this
// path from components/template/loyalty.tsx and components/loyalty/TermsAgreement.tsx,
// and a stale cached bundle can still ask for the old slug.
middlewareRoutes.get('/loyalty/properties', LoyaltyFacilityController.propertiesForBookingEngine);
middlewareRoutes.get('/lifestyle/properties', LoyaltyFacilityController.propertiesForBookingEngine);

// Public branding artwork for the pre-auth login screen. Not a Laravel parity
// route: the reference login uses a static background, while the node frontend
// (frontend-node/.../login/login.tsx) crossfades the property banners here.
middlewareRoutes.get('/branding/banners', brandingBanners);

// Guest notifications for the booking engine header bell. Public and keyed on email
// because the booking engine has no HMS session — it holds its own `users` row and
// passes the address over. See GuestNotificationController for why that is acceptable
// and what it deliberately does not return.
middlewareRoutes.get('/guest/notifications', GuestNotificationController.list);

// Realtime channel for the same data. The SSE stream replaces the 45s poll as the primary
// path — a guest returning from Xendit gets their pre-registration prompt in about a
// second instead of up to 45 — and the poll stays as the fallback for a client that cannot
// hold a stream.
//
// Registered after `/guest/notifications` deliberately: that path is a prefix of neither
// of these, but keeping the plain read first means a stale caller asking for the old URL
// keeps working unchanged.
middlewareRoutes.get('/guest/stream', GuestEventController.stream);
middlewareRoutes.get('/guest/events', GuestEventController.list);

// Inbound half of the webhook. The booking engine pushes here when the invoice settles,
// so the prompt does not wait on HMS's next queue run. Idempotent by construction: it
// broadcasts, and the durable record is the folio.
middlewareRoutes.post('/guest/notify', GuestEventController.notify);

// Guest edits their profile in the booking engine (MySQL `users`), the PMS keeps them in
// Postgres `guest_profiles`. This is the only thing that moves data between the two, so
// a corrected address reaches the front desk and a reservation can be written from a
// profile the guest already filled in.
middlewareRoutes.post('/guest/profile-sync', GuestProfileSyncController.sync);

// Laravel MiddlewareController@cleanFromDirty: Housekeeping "Clean All Rooms" sets
// every room of the property whose maid_status = 1 (dirty) back to 0 (clean).
middlewareRoutes.get('/room/clean-from-dirty', async (req: any, res: any) => {
  try {
    const clientUid = String(req.query.client_uid ?? '');
    if (!clientUid) return res.status(400).json({ code: 400, message: 'The client uid field is required.' });
    const property = await prisma.properties.findFirst({
      where: { OR: [{ client_uid: clientUid }, { name: clientUid }] },
      select: { id: true },
    });
    if (!property) return res.status(404).json({ code: 404, message: 'Client not found.' });
    await prisma.rooms.updateMany({
      where: { property_id: property.id, maid_status: 1 },
      data: { maid_status: 0, updated_at: new Date() },
    });
    res.json({ code: 200, message: 'Success' });
  } catch (err: any) {
    console.error('clean-from-dirty error:', err);
    res.status(500).json({ code: 500, message: 'Failed' });
  }
});