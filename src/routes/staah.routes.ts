import { Router } from 'express';
import { StaahController } from '../controllers/staah.controller';
import { StaahWebhookController } from '../controllers/staah-webhook.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// ═══════════════════════════════════════════════════
// STAAH Webhook Routes (no auth — called by Staah)
// ═══════════════════════════════════════════════════

router.get('/staah/webhook/health', StaahWebhookController.healthCheck);
router.post('/staah/webhook/reservation-push', StaahWebhookController.handleReservationPush);
router.post('/staah/webhook/confirm-booking', StaahWebhookController.processConfirmBooking);

// ═══════════════════════════════════════════════════
// STAAH Interface Management
// ═══════════════════════════════════════════════════

router.get('/staah/interfaces', authMiddleware, requirePermission(69, 'view'), StaahController.interfaceList);
router.post('/staah/interfaces', authMiddleware, requirePermission(69, 'add'), StaahController.interfaceCreate);
router.get('/staah/interfaces/master', authMiddleware, requirePermission(69, 'view'), StaahController.master);
router.get('/staah/interfaces/rates-calendar', authMiddleware, requirePermission(69, 'view'), StaahController.ratesCalendar);
router.get('/staah/interfaces/test-connection', authMiddleware, requirePermission(69, 'view'), StaahController.testConnection);
router.get('/staah/interfaces/:id', authMiddleware, requirePermission(69, 'view'), StaahController.interfaceShow);
router.get('/staah/interfaces/:id/edit', authMiddleware, requirePermission(69, 'edit'), StaahController.interfaceEdit);
router.put('/staah/interfaces/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.interfaceUpdate);
router.delete('/staah/interfaces/:id', authMiddleware, requirePermission(69, 'delete'), StaahController.interfaceDestroy);

// ═══════════════════════════════════════════════════
// STAAH Room Mappings
// ═══════════════════════════════════════════════════

router.get('/staah/room-mappings', authMiddleware, requirePermission(69, 'view'), StaahController.roomMappingList);
router.get('/staah/room-mappings/:id/edit', authMiddleware, requirePermission(69, 'edit'), StaahController.roomMappingEdit);
router.put('/staah/room-mappings/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.roomMappingUpdate);

// ═══════════════════════════════════════════════════
// STAAH Rate Mappings
// ═══════════════════════════════════════════════════

router.get('/staah/rate-mappings', authMiddleware, requirePermission(69, 'view'), StaahController.rateMappingList);
router.get('/staah/rate-mappings/:id/edit', authMiddleware, requirePermission(69, 'edit'), StaahController.rateMappingEdit);
router.put('/staah/rate-mappings/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.rateMappingUpdate);

// ═══════════════════════════════════════════════════
// STAAH Reservations (from webhook pulls)
// ═══════════════════════════════════════════════════

router.get('/staah/reservations', authMiddleware, requirePermission(69, 'view'), StaahController.reservationList);
router.post('/staah/reservations/:id/confirm', authMiddleware, requirePermission(69, 'edit'), StaahController.reservationConfirm);
router.post('/staah/reservations/:id/cancel', authMiddleware, requirePermission(69, 'edit'), StaahController.reservationCancel);
router.post('/staah/reservations/:id/pending', authMiddleware, requirePermission(69, 'edit'), StaahController.reservationPending);

// ═══════════════════════════════════════════════════
// STAAH Sync Logs
// ═══════════════════════════════════════════════════

router.get('/staah/sync-logs', authMiddleware, requirePermission(69, 'view'), StaahController.syncLogList);
router.post('/staah/sync-logs/:id/retry', authMiddleware, requirePermission(69, 'edit'), StaahController.syncLogRetry);

// ═══════════════════════════════════════════════════
// STAAH OTA Company Mappings
// ═══════════════════════════════════════════════════

router.get('/staah/ota-mappings', authMiddleware, requirePermission(69, 'view'), StaahController.otaMappingList);
router.post('/staah/ota-mappings/sync', authMiddleware, requirePermission(69, 'edit'), StaahController.otaMappingSync);
router.post('/staah/ota-mappings', authMiddleware, requirePermission(69, 'edit'), StaahController.otaMappingCreate);
router.put('/staah/ota-mappings/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.otaMappingUpdate);
router.delete('/staah/ota-mappings/:id', authMiddleware, requirePermission(69, 'delete'), StaahController.otaMappingDestroy);

// ═══════════════════════════════════════════════════
// STAAH Room Content Breakdowns
// ═══════════════════════════════════════════════════

router.get('/staah/content-breakdowns', authMiddleware, requirePermission(69, 'view'), StaahController.contentBreakdownList);
router.post('/staah/content-breakdowns', authMiddleware, requirePermission(69, 'edit'), StaahController.contentBreakdownCreate);
router.put('/staah/content-breakdowns/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.contentBreakdownUpdate);
router.delete('/staah/content-breakdowns/:id', authMiddleware, requirePermission(69, 'delete'), StaahController.contentBreakdownDestroy);

// ═══════════════════════════════════════════════════
// STAAH Push / Pull / Sync Actions
// ═══════════════════════════════════════════════════

router.post('/staah/interfaces/:id/sync-availability', authMiddleware, requirePermission(69, 'edit'), StaahController.syncAvailability);
router.post('/staah/interfaces/:id/pull', authMiddleware, requirePermission(69, 'edit'), StaahController.pullFromStaah);
router.post('/staah/interfaces/:id/push-room', authMiddleware, requirePermission(69, 'edit'), StaahController.pushRoom);
router.post('/staah/interfaces/:id/push-rate', authMiddleware, requirePermission(69, 'edit'), StaahController.pushRate);
router.post('/staah/interfaces/:id/ari-push', authMiddleware, requirePermission(69, 'edit'), StaahController.ariPush);
router.post('/staah/sync-price', authMiddleware, requirePermission(69, 'edit'), StaahController.syncPriceStaah);

// Singular aliases for frontend compatibility
router.get('/staah/interface', authMiddleware, requirePermission(69, 'view'), StaahController.interfaceList);
router.post('/staah/interface', authMiddleware, requirePermission(69, 'add'), StaahController.interfaceCreate);
router.get('/staah/interface/master', authMiddleware, requirePermission(69, 'view'), StaahController.master);
router.get('/staah/interface/rates-calendar', authMiddleware, requirePermission(69, 'view'), StaahController.ratesCalendar);
router.get('/staah/interface/test-connection', authMiddleware, requirePermission(69, 'view'), StaahController.testConnection);
router.get('/staah/interface/:id', authMiddleware, requirePermission(69, 'view'), StaahController.interfaceShow);
router.get('/staah/interface/:id/edit', authMiddleware, requirePermission(69, 'edit'), StaahController.interfaceEdit);
router.put('/staah/interface/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.interfaceUpdate);
router.delete('/staah/interface/:id', authMiddleware, requirePermission(69, 'delete'), StaahController.interfaceDestroy);

router.get('/staah/room-mapping', authMiddleware, requirePermission(69, 'view'), StaahController.roomMappingList);
router.get('/staah/room-mapping/:id/edit', authMiddleware, requirePermission(69, 'edit'), StaahController.roomMappingEdit);
router.put('/staah/room-mapping/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.roomMappingUpdate);

router.get('/staah/rate-mapping', authMiddleware, requirePermission(69, 'view'), StaahController.rateMappingList);
router.get('/staah/rate-mapping/:id/edit', authMiddleware, requirePermission(69, 'edit'), StaahController.rateMappingEdit);
router.put('/staah/rate-mapping/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.rateMappingUpdate);

router.get('/staah/reservation', authMiddleware, requirePermission(69, 'view'), StaahController.reservationList);
router.post('/staah/reservation/:id/confirm', authMiddleware, requirePermission(69, 'edit'), StaahController.reservationConfirm);
router.post('/staah/reservation/:id/cancel', authMiddleware, requirePermission(69, 'edit'), StaahController.reservationCancel);
router.post('/staah/reservation/:id/pending', authMiddleware, requirePermission(69, 'edit'), StaahController.reservationPending);

router.get('/staah/sync-log', authMiddleware, requirePermission(69, 'view'), StaahController.syncLogList);

router.get('/staah/ota-mapping', authMiddleware, requirePermission(69, 'view'), StaahController.otaMappingList);
router.post('/staah/ota-mapping', authMiddleware, requirePermission(69, 'edit'), StaahController.otaMappingCreate);
router.put('/staah/ota-mapping/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.otaMappingUpdate);
router.delete('/staah/ota-mapping/:id', authMiddleware, requirePermission(69, 'delete'), StaahController.otaMappingDestroy);

router.get('/staah/content-breakdown', authMiddleware, requirePermission(69, 'view'), StaahController.contentBreakdownList);
router.post('/staah/content-breakdown', authMiddleware, requirePermission(69, 'edit'), StaahController.contentBreakdownCreate);
router.put('/staah/content-breakdown/:id', authMiddleware, requirePermission(69, 'edit'), StaahController.contentBreakdownUpdate);
router.delete('/staah/content-breakdown/:id', authMiddleware, requirePermission(69, 'delete'), StaahController.contentBreakdownDestroy);

router.post('/staah/interface/:id/sync-availability', authMiddleware, requirePermission(69, 'edit'), StaahController.syncAvailability);
router.post('/staah/interface/:id/pull', authMiddleware, requirePermission(69, 'edit'), StaahController.pullFromStaah);
router.post('/staah/interface/:id/push-room', authMiddleware, requirePermission(69, 'edit'), StaahController.pushRoom);
router.post('/staah/interface/:id/push-rate', authMiddleware, requirePermission(69, 'edit'), StaahController.pushRate);
router.post('/staah/interface/:id/ari-push', authMiddleware, requirePermission(69, 'edit'), StaahController.ariPush);

export default router;
