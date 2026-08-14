import { Router } from 'express';
import { ReservationController } from '../controllers/reservation.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// Reservation routes (menuId: 80 from Laravel cms.php)
// IMPORTANT: Static paths MUST be before :id param routes to avoid BigInt crash

// ── Plural static routes ──
router.get('/reservations', authMiddleware, requirePermission(80, 'view'), ReservationController.list);
router.get('/reservations/create', authMiddleware, requirePermission(80, 'add'), ReservationController.create);
router.post('/reservations', authMiddleware, requirePermission(80, 'add'), ReservationController.store);
router.get('/reservations/calendar', authMiddleware, requirePermission(80, 'view'), ReservationController.calendar);
router.get('/reservations/arrivals', authMiddleware, requirePermission(80, 'view'), ReservationController.arrivals);
router.get('/reservations/departures', authMiddleware, requirePermission(80, 'view'), ReservationController.departures);
router.get('/reservations/in-house', authMiddleware, requirePermission(80, 'view'), ReservationController.inHouse);
router.get('/reservations/pending', authMiddleware, requirePermission(80, 'view'), ReservationController.pending);
router.post('/reservations/on-check', authMiddleware, requirePermission(80, 'view'), ReservationController.onCheck);
router.post('/reservations/update-bulk', authMiddleware, requirePermission(80, 'edit'), ReservationController.updateBulk);

// ── Plural param routes ──
router.get('/reservations/:id', authMiddleware, requirePermission(80, 'view'), ReservationController.show);
router.get('/reservations/:id/edit', authMiddleware, requirePermission(80, 'edit'), ReservationController.edit);
router.put('/reservations/:id', authMiddleware, requirePermission(80, 'edit'), ReservationController.update);
router.delete('/reservations/:id', authMiddleware, requirePermission(80, 'delete'), ReservationController.destroy);
router.post('/reservations/:id/restore', authMiddleware, requirePermission(80, 'edit'), ReservationController.restore);
router.post('/reservations/:id/check-in', authMiddleware, requirePermission(80, 'edit'), ReservationController.checkIn);
router.post('/reservations/:id/check-out', authMiddleware, requirePermission(80, 'edit'), ReservationController.checkOut);
router.post('/reservations/:id/cancel', authMiddleware, requirePermission(80, 'edit'), ReservationController.cancel);
router.post('/reservations/:id/confirm', authMiddleware, requirePermission(80, 'edit'), ReservationController.confirm);
router.post('/reservations/:id/unassign-room', authMiddleware, requirePermission(80, 'edit'), ReservationController.unassignRoom);
router.post('/reservations/:id/replicate', authMiddleware, requirePermission(80, 'add'), ReservationController.replicate);
router.post('/reservations/:id/assign-room', authMiddleware, requirePermission(80, 'edit'), ReservationController.assignRoom);

// ── Reservation items (room grid per folio, ReservationItemController parity) ──
router.get('/reservation-item', authMiddleware, requirePermission(80, 'view'), ReservationController.reservationItemIndex);
router.put('/reservation-item/:id', authMiddleware, requirePermission(80, 'edit'), ReservationController.reservationItemUpdate);

// ── Singular static routes ──
router.get('/reservation', authMiddleware, requirePermission(80, 'view'), ReservationController.list);
router.get('/reservation/create', authMiddleware, requirePermission(80, 'add'), ReservationController.create);
router.post('/reservation', authMiddleware, requirePermission(80, 'add'), ReservationController.store);
router.get('/reservation/calendar', authMiddleware, requirePermission(80, 'view'), ReservationController.calendar);
router.get('/reservation/arrivals', authMiddleware, requirePermission(80, 'view'), ReservationController.arrivals);
router.get('/reservation/departures', authMiddleware, requirePermission(80, 'view'), ReservationController.departures);
router.get('/reservation/in-house', authMiddleware, requirePermission(80, 'view'), ReservationController.inHouse);
router.get('/reservation/pending', authMiddleware, requirePermission(80, 'view'), ReservationController.pending);
router.post('/reservation/on-check', authMiddleware, requirePermission(80, 'view'), ReservationController.onCheck);
router.post('/reservation/update-bulk', authMiddleware, requirePermission(80, 'edit'), ReservationController.updateBulk);

// ── Reservation sub-feature statics (must precede /reservation/:id) ──
router.get('/reservation/code-item', authMiddleware, requirePermission(80, 'view'), ReservationController.codeItemList);
router.post('/reservation/code-item', authMiddleware, requirePermission(80, 'add'), ReservationController.codeItemList);
router.get('/reservation/inclusive', authMiddleware, requirePermission(80, 'view'), ReservationController.inclusiveList);
router.get('/reservation/masterInclusive', authMiddleware, requirePermission(80, 'view'), ReservationController.masterInclusiveList);
router.get('/reservation/master', authMiddleware, requirePermission(80, 'view'), ReservationController.getMaster);
router.get('/reservation/subfolio/:id', authMiddleware, requirePermission(80, 'view'), ReservationController.subfolioList);

// ── Singular param routes ──
router.get('/reservation/:id', authMiddleware, requirePermission(80, 'view'), ReservationController.show);
router.get('/reservation/:id/edit', authMiddleware, requirePermission(80, 'edit'), ReservationController.edit);
router.get('/reservation/:id/update', authMiddleware, requirePermission(80, 'edit'), ReservationController.edit);
router.put('/reservation/:id', authMiddleware, requirePermission(80, 'edit'), ReservationController.update);
router.delete('/reservation/:id', authMiddleware, requirePermission(80, 'delete'), ReservationController.destroy);
router.post('/reservation/:id/restore', authMiddleware, requirePermission(80, 'edit'), ReservationController.restore);
router.post('/reservation/:id/check-in', authMiddleware, requirePermission(80, 'edit'), ReservationController.checkIn);
router.post('/reservation/:id/check-out', authMiddleware, requirePermission(80, 'edit'), ReservationController.checkOut);
router.post('/reservation/:id/cancel', authMiddleware, requirePermission(80, 'edit'), ReservationController.cancel);
router.post('/reservation/:id/confirm', authMiddleware, requirePermission(80, 'edit'), ReservationController.confirm);
router.post('/reservation/:id/unassign-room', authMiddleware, requirePermission(80, 'edit'), ReservationController.unassignRoom);
router.post('/reservation/:id/replicate', authMiddleware, requirePermission(80, 'add'), ReservationController.replicate);
router.post('/reservation/:id/assign-room', authMiddleware, requirePermission(80, 'edit'), ReservationController.assignRoom);

// ── Reservation items (sub-resource) ──
router.get('/reservations/:folioId/items', authMiddleware, requirePermission(80, 'view'), ReservationController.listItems);
router.post('/reservations/:folioId/items', authMiddleware, requirePermission(80, 'add'), ReservationController.addItem);
router.put('/reservations/:folioId/items/:itemId', authMiddleware, requirePermission(80, 'edit'), ReservationController.updateItem);
router.delete('/reservations/:folioId/items/:itemId', authMiddleware, requirePermission(80, 'delete'), ReservationController.deleteItem);

// Singular aliases for items
router.get('/reservation/:folioId/items', authMiddleware, requirePermission(80, 'view'), ReservationController.listItems);
router.post('/reservation/:folioId/items', authMiddleware, requirePermission(80, 'add'), ReservationController.addItem);
router.put('/reservation/:folioId/items/:itemId', authMiddleware, requirePermission(80, 'edit'), ReservationController.updateItem);
router.delete('/reservation/:folioId/items/:itemId', authMiddleware, requirePermission(80, 'delete'), ReservationController.deleteItem);

export default router;
