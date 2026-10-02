import { Router } from 'express';
import { StaahController } from '../controllers/staah.controller';
import { StaahWebhookController } from '../controllers/staah-webhook.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { staahRateLimit } from '../middleware/staahSecurity';

const router = Router();

// Real menu IDs for the STAAH feature (menus table). These were all wrongly
// set to 69, which is "Virtual Folio" (/reservation/vr) — every STAAH action
// was therefore gated on an unrelated menu's CRUD grant.
//   1184 → Staah Webhook Reservations (/module/staah-reservation)
//   1185 → Staah Management          (/module/staah-manager)
//   1186 → Staah OTA Mapping         (/master-setup/staah-ota-mapping)
const MENU = {
  reservations: 1184,
  management: 1185,
  otaMapping: 1186,
} as const;

// ─────────────────────────────────────────────────
// STAAH Webhook Routes (no auth - called by Staah)
// Rate-limited: Laravel parity 10k/hour per source
// ─────────────────────────────────────────────────

router.get('/staah/webhook/health', staahRateLimit, StaahWebhookController.healthCheck);
router.post('/staah/webhook/reservation-push', staahRateLimit, StaahWebhookController.handleReservationPush);
router.post('/staah/webhook/confirm-booking', staahRateLimit, StaahWebhookController.processConfirmBooking);

// ═══════════════════════════════════════════════════
// STAAH Interface Management  → menu 1185
// ═══════════════════════════════════════════════════

router.get('/staah/interfaces', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.interfaceList);
router.post('/staah/interfaces', authMiddleware, requirePermission(MENU.management, 'add'), StaahController.interfaceCreate);
router.get('/staah/interfaces/master', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.master);
router.get('/staah/interfaces/rates-calendar', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.ratesCalendar);
router.get('/staah/interfaces/test-connection', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.testConnection);
router.get('/staah/interfaces/:id', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.interfaceShow);
router.get('/staah/interfaces/:id/edit', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.interfaceEdit);
router.put('/staah/interfaces/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.interfaceUpdate);
router.delete('/staah/interfaces/:id', authMiddleware, requirePermission(MENU.management, 'delete'), StaahController.interfaceDestroy);

// ═══════════════════════════════════════════════════
// STAAH Room Mappings  → menu 1185
// ═══════════════════════════════════════════════════

router.get('/staah/room-mappings', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.roomMappingList);
router.get('/staah/room-mappings/:id/edit', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.roomMappingEdit);
router.put('/staah/room-mappings/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.roomMappingUpdate);

// ═══════════════════════════════════════════════════
// STAAH Rate Mappings  → menu 1185
// ═══════════════════════════════════════════════════

router.get('/staah/rate-mappings', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.rateMappingList);
router.get('/staah/rate-mappings/:id/edit', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.rateMappingEdit);
router.put('/staah/rate-mappings/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.rateMappingUpdate);

// ═══════════════════════════════════════════════════
// STAAH Reservations (from webhook pushes)  → menu 1184
// ═══════════════════════════════════════════════════

router.get('/staah/reservations', authMiddleware, requirePermission(MENU.reservations, 'view'), StaahController.reservationList);
router.post('/staah/reservations/:id/confirm', authMiddleware, requirePermission(MENU.reservations, 'edit'), StaahController.reservationConfirm);
router.post('/staah/reservations/:id/cancel', authMiddleware, requirePermission(MENU.reservations, 'edit'), StaahController.reservationCancel);
router.post('/staah/reservations/:id/pending', authMiddleware, requirePermission(MENU.reservations, 'edit'), StaahController.reservationPending);

// ═══════════════════════════════════════════════════
// STAAH Sync Logs  → menu 1185
// ═══════════════════════════════════════════════════

router.get('/staah/sync-logs', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.syncLogList);
router.post('/staah/sync-logs/:id/retry', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.syncLogRetry);

// ═══════════════════════════════════════════════════
// STAAH OTA Company Mappings  → menu 1186
// ═══════════════════════════════════════════════════

router.get('/staah/ota-mappings', authMiddleware, requirePermission(MENU.otaMapping, 'view'), StaahController.otaMappingList);
router.post('/staah/ota-mappings/sync', authMiddleware, requirePermission(MENU.otaMapping, 'edit'), StaahController.otaMappingSync);
router.post('/staah/ota-mappings', authMiddleware, requirePermission(MENU.otaMapping, 'edit'), StaahController.otaMappingCreate);
router.put('/staah/ota-mappings/:id', authMiddleware, requirePermission(MENU.otaMapping, 'edit'), StaahController.otaMappingUpdate);
router.delete('/staah/ota-mappings/:id', authMiddleware, requirePermission(MENU.otaMapping, 'delete'), StaahController.otaMappingDestroy);

// ═══════════════════════════════════════════════════
// STAAH Room Content Breakdowns  → menu 1185
// ═══════════════════════════════════════════════════

router.get('/staah/content-breakdowns', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.contentBreakdownList);
router.post('/staah/content-breakdowns', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.contentBreakdownCreate);
router.put('/staah/content-breakdowns/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.contentBreakdownUpdate);
router.delete('/staah/content-breakdowns/:id', authMiddleware, requirePermission(MENU.management, 'delete'), StaahController.contentBreakdownDestroy);

// ═══════════════════════════════════════════════════
// STAAH Push / Pull / Sync Actions  → menu 1185
// ═══════════════════════════════════════════════════

router.post('/staah/interfaces/:id/sync-availability', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.syncAvailability);
router.post('/staah/interfaces/:id/pull', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pullFromStaah);
router.post('/staah/interfaces/:id/push-room', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pushRoom);
router.post('/staah/interfaces/:id/push-rate', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pushRate);
router.post('/staah/interfaces/:id/ari-push', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.ariPush);
router.post('/staah/sync-price', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.syncPriceStaah);

// Singular aliases for frontend compatibility
router.get('/staah/interface', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.interfaceList);
router.post('/staah/interface', authMiddleware, requirePermission(MENU.management, 'add'), StaahController.interfaceCreate);
router.get('/staah/interface/master', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.master);
router.get('/staah/interface/rates-calendar', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.ratesCalendar);
router.get('/staah/interface/test-connection', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.testConnection);
router.get('/staah/interface/:id', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.interfaceShow);
router.get('/staah/interface/:id/edit', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.interfaceEdit);
router.put('/staah/interface/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.interfaceUpdate);
router.delete('/staah/interface/:id', authMiddleware, requirePermission(MENU.management, 'delete'), StaahController.interfaceDestroy);

router.get('/staah/room-mapping', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.roomMappingList);
router.get('/staah/room-mapping/:id/edit', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.roomMappingEdit);
router.put('/staah/room-mapping/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.roomMappingUpdate);

router.get('/staah/rate-mapping', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.rateMappingList);
router.get('/staah/rate-mapping/:id/edit', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.rateMappingEdit);
router.put('/staah/rate-mapping/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.rateMappingUpdate);

router.get('/staah/reservation', authMiddleware, requirePermission(MENU.reservations, 'view'), StaahController.reservationList);
router.post('/staah/reservation/:id/confirm', authMiddleware, requirePermission(MENU.reservations, 'edit'), StaahController.reservationConfirm);
router.post('/staah/reservation/:id/cancel', authMiddleware, requirePermission(MENU.reservations, 'edit'), StaahController.reservationCancel);
router.post('/staah/reservation/:id/pending', authMiddleware, requirePermission(MENU.reservations, 'edit'), StaahController.reservationPending);

router.get('/staah/sync-log', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.syncLogList);

router.get('/staah/ota-mapping', authMiddleware, requirePermission(MENU.otaMapping, 'view'), StaahController.otaMappingList);
router.post('/staah/ota-mapping', authMiddleware, requirePermission(MENU.otaMapping, 'edit'), StaahController.otaMappingCreate);
router.put('/staah/ota-mapping/:id', authMiddleware, requirePermission(MENU.otaMapping, 'edit'), StaahController.otaMappingUpdate);
router.delete('/staah/ota-mapping/:id', authMiddleware, requirePermission(MENU.otaMapping, 'delete'), StaahController.otaMappingDestroy);

router.get('/staah/content-breakdown', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.contentBreakdownList);
router.post('/staah/content-breakdown', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.contentBreakdownCreate);
router.put('/staah/content-breakdown/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.contentBreakdownUpdate);
router.delete('/staah/content-breakdown/:id', authMiddleware, requirePermission(MENU.management, 'delete'), StaahController.contentBreakdownDestroy);

router.post('/staah/interface/:id/sync-availability', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.syncAvailability);
router.post('/staah/interface/:id/pull', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pullFromStaah);
router.post('/staah/interface/:id/push-room', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pushRoom);
router.post('/staah/interface/:id/push-rate', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pushRate);
router.post('/staah/interface/:id/ari-push', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.ariPush);

// ─────────────────────────────────────────────────
// Laravel-path aliases (`/cms/staah-manager/*`).
// The Laravel base reference exposes these exact paths and the ported
// frontend calls them; without these aliases the buttons 404.
// NOTE: extra.routes.ts also declares the generic CRUD `/staah-manager*`
// routes, but `staahRoutes` is mounted BEFORE `extraRoutes` in index.ts, so
// the handlers below win and the generic ones are unreachable dead paths.
// ─────────────────────────────────────────────────
// Create/edit form + save. Laravel's StaahInterfaceController@create/@edit
// answer with a top-level `form` envelope (and no `data` key at all); the
// generic controller never emits `form`, which left the edit screen blank.
router.get('/staah-manager/create', authMiddleware, requirePermission(MENU.management, 'add'), StaahController.interfaceCreateForm);
router.get('/staah-manager/:id/edit', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.interfaceEditForm);
router.post('/staah-manager', authMiddleware, requirePermission(MENU.management, 'add'), StaahController.saveProperty);
router.put('/staah-manager/:id', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.saveProperty);
router.delete('/staah-manager/:id', authMiddleware, requirePermission(MENU.management, 'delete'), StaahController.interfaceDestroy);

router.post('/staah-manager/test-connection', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.testConnection);
router.post('/staah-manager/sync-availability', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.syncAvailability);
router.post('/staah-manager/ari-push', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.ariPush);
router.post('/staah-manager/push-room', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pushRoom);
router.post('/staah-manager/push-rate', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pushRate);
router.post('/staah-manager/pull', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.pullFromStaah);
router.post('/staah-manager/sync-from-staah', authMiddleware, requirePermission(MENU.management, 'edit'), StaahController.syncFromStaah);
router.post('/staah-manager/pull-reservations', authMiddleware, requirePermission(MENU.reservations, 'view'), StaahController.pullReservations);
router.post('/staah-manager/rates-calendar', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.ratesCalendar);
router.get('/staah-manager/rates-calendar', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.ratesCalendar);

// Sub-tables embedded in the property form (`type: 'table'` + `uri`). Laravel
// serves these from StaahInterfaceController@roomMapping/@rateMapping and
// StaahSyncLogController@index, keyed by the STAAH hotel_id string.
// Express 5 / path-to-regexp v8 rejects the `:hotel_id?` optional-param syntax,
// so the optional segment is registered as a separate route.
router.get('/staah-room-mapping', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.roomMappingList);
router.get('/staah-room-mapping/:hotel_id', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.roomMappingList);
router.get('/staah-rate-mapping', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.rateMappingList);
router.get('/staah-rate-mapping/:hotel_id', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.rateMappingList);
router.get('/staah-sync-log', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.syncLogList);
router.get('/staah-sync-log/:hotel_id', authMiddleware, requirePermission(MENU.management, 'view'), StaahController.syncLogList);

export default router;
