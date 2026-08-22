import { Router } from 'express';
import { ReservationController } from '../controllers/reservation.controller';
import { FolioController } from '../controllers/folio.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// Reservation routes (menuId: 60 = Reservation parent menu from actual DB)
// Child menus: 62=FIT, 63=GIT, 69=VR, 1162=DayUse — all share same transaction actions
// IMPORTANT: Static paths MUST be before :id param routes to avoid BigInt crash

// ── Plural static routes ──
router.get('/reservations', authMiddleware, requirePermission(60, 'view'), ReservationController.list);
router.get('/reservations/create', authMiddleware, requirePermission(60, 'add'), ReservationController.create);
router.post('/reservations', authMiddleware, requirePermission(60, 'add'), ReservationController.store);
router.get('/reservations/calendar', authMiddleware, requirePermission(60, 'view'), ReservationController.calendar);
router.get('/reservations/arrivals', authMiddleware, requirePermission(60, 'view'), ReservationController.arrivals);
router.get('/reservations/departures', authMiddleware, requirePermission(60, 'view'), ReservationController.departures);
router.get('/reservations/in-house', authMiddleware, requirePermission(60, 'view'), ReservationController.inHouse);
router.get('/reservations/pending', authMiddleware, requirePermission(60, 'view'), ReservationController.pending);
router.post('/reservations/on-check', authMiddleware, requirePermission(60, 'view'), ReservationController.onCheck);
router.post('/reservations/update-bulk', authMiddleware, requirePermission(60, 'edit'), ReservationController.updateBulk);

// ── Plural param routes ──
router.get('/reservations/:id', authMiddleware, requirePermission(60, 'view'), ReservationController.show);
router.get('/reservations/:id/edit', authMiddleware, requirePermission(60, 'edit'), ReservationController.edit);
router.put('/reservations/:id', authMiddleware, requirePermission(60, 'edit'), ReservationController.update);
router.delete('/reservations/:id', authMiddleware, requirePermission(60, 'delete'), ReservationController.destroy);
router.post('/reservations/:id/restore', authMiddleware, requirePermission(60, 'edit'), ReservationController.restore);
router.post('/reservations/:id/unassign-room', authMiddleware, requirePermission(60, 'edit'), ReservationController.unassignRoom);
router.post('/reservations/:id/replicate', authMiddleware, requirePermission(60, 'add'), ReservationController.replicate);
router.post('/reservations/:id/assign-room', authMiddleware, requirePermission(60, 'edit'), ReservationController.assignRoom);

// ── Reservation items (room grid per folio, ReservationItemController parity) ──
router.get('/reservation-item', authMiddleware, requirePermission(60, 'view'), ReservationController.reservationItemIndex);
router.put('/reservation-item/:id', authMiddleware, requirePermission(60, 'edit'), ReservationController.reservationItemUpdate);

// ── Singular static routes ──
router.get('/reservation', authMiddleware, requirePermission(60, 'view'), ReservationController.list);
router.get('/reservation/create', authMiddleware, requirePermission(60, 'add'), ReservationController.create);
router.post('/reservation', authMiddleware, requirePermission(60, 'add'), ReservationController.store);
router.get('/reservation/calendar', authMiddleware, requirePermission(60, 'view'), ReservationController.calendar);
router.get('/reservation/arrivals', authMiddleware, requirePermission(60, 'view'), ReservationController.arrivals);
router.get('/reservation/departures', authMiddleware, requirePermission(60, 'view'), ReservationController.departures);
router.get('/reservation/in-house', authMiddleware, requirePermission(60, 'view'), ReservationController.inHouse);
router.get('/reservation/pending', authMiddleware, requirePermission(60, 'view'), ReservationController.pending);
router.post('/reservation/on-check', authMiddleware, requirePermission(60, 'view'), ReservationController.onCheck);
router.post('/reservation/update-bulk', authMiddleware, requirePermission(60, 'edit'), ReservationController.updateBulk);
router.put('/reservation/ledger/move/:id', authMiddleware, requirePermission(60, 'edit'), ReservationController.moveLedger);

// ── Reservation sub-feature statics (must precede /reservation/:id) ──
router.get('/reservation/code-item', authMiddleware, requirePermission(60, 'view'), ReservationController.codeItemList);
// Laravel storeAdditionalItem (cms.php:964, :3539)
router.post('/reservation/code-item', authMiddleware, requirePermission(60, 'add'), ReservationController.additionalItemStore);
// Laravel updateAdditionalItem / deleteAdditionalItem (cms.php:965-966)
router.put('/reservation/code-item/:codeItem', authMiddleware, requirePermission(60, 'edit'), ReservationController.additionalItemUpdate);
router.delete('/reservation/code-item/:codeItem', authMiddleware, requirePermission(60, 'delete'), ReservationController.additionalItemDestroy);
router.get('/reservation/inclusive', authMiddleware, requirePermission(60, 'view'), ReservationController.inclusiveList);
// Laravel storeInclusives / deleteInclusives (cms.php:959,961)
router.post('/reservation/inclusive', authMiddleware, requirePermission(60, 'add'), ReservationController.inclusiveStore);
router.delete('/reservation/inclusive/:rateInclusive', authMiddleware, requirePermission(60, 'delete'), ReservationController.inclusiveDestroy);
router.get('/reservation/masterInclusive', authMiddleware, requirePermission(60, 'view'), ReservationController.masterInclusiveList);
router.get('/reservation/masterinclusive', authMiddleware, requirePermission(60, 'view'), ReservationController.masterInclusiveList);
router.get('/reservation/master', authMiddleware, requirePermission(60, 'view'), ReservationController.getMaster);
router.get('/reservation/subfolio/:id', authMiddleware, requirePermission(60, 'view'), ReservationController.subfolioList);
// Laravel getFolio (cms.php:951) — autocomplete folio list; static MUST precede /reservation/:id
router.get('/reservation/folio', authMiddleware, requirePermission(60, 'view'), ReservationController.folioList);
// Laravel getLedger (cms.php:952)
router.get('/reservation/ledger/:folio', authMiddleware, requirePermission(60, 'view'), ReservationController.ledgerList);

// ── Helper endpoints (Laravel getRate/getRateByCompany/getPackageByRateId/getCharge/getAvailableRoomType/getRoomGit/updateRoomParentGIT) ──
router.get('/reservation/rate', authMiddleware, requirePermission(60, 'view'), ReservationController.rateListHelper);
router.get('/reservation/rate-by-company-id', authMiddleware, requirePermission(60, 'view'), ReservationController.rateByCompany);
router.get('/reservation/package-by-rate-id', authMiddleware, requirePermission(60, 'view'), ReservationController.packageByRateId);
router.post('/reservation/charge', authMiddleware, requirePermission(60, 'view'), ReservationController.getCharge);
router.get('/reservation/available-room', authMiddleware, requirePermission(60, 'view'), ReservationController.availableRoomType);
router.get('/reservation/room-git', authMiddleware, requirePermission(60, 'view'), ReservationController.roomGit);
router.put('/reservation/update-room-parent-git', authMiddleware, requirePermission(60, 'edit'), ReservationController.updateRoomParentGIT);

// ── Singular param routes ──
router.get('/reservation/:id', authMiddleware, requirePermission(60, 'view'), ReservationController.show);
router.get('/reservation/:id/edit', authMiddleware, requirePermission(60, 'edit'), ReservationController.edit);
router.get('/reservation/:id/update', authMiddleware, requirePermission(60, 'edit'), ReservationController.edit);
router.put('/reservation/:id', authMiddleware, requirePermission(60, 'edit'), ReservationController.update);
router.delete('/reservation/:id', authMiddleware, requirePermission(60, 'delete'), ReservationController.destroy);
router.post('/reservation/:id/restore', authMiddleware, requirePermission(60, 'edit'), ReservationController.restore);
router.post('/reservation/:id/unassign-room', authMiddleware, requirePermission(60, 'edit'), ReservationController.unassignRoom);
router.post('/reservation/:id/replicate', authMiddleware, requirePermission(60, 'add'), ReservationController.replicate);
router.post('/reservation/:id/assign-room', authMiddleware, requirePermission(60, 'edit'), ReservationController.assignRoom);

// update-status (mirror Laravel ReservationController@updateStatus)
router.post('/reservation/update-status/:folio', authMiddleware, requirePermission(60, 'edit'), FolioController.updateStatus);
router.put('/reservation/update-status/:folio', authMiddleware, requirePermission(60, 'edit'), FolioController.updateStatus);

// ── Reservation items (sub-resource) ──
router.get('/reservations/:folioId/items', authMiddleware, requirePermission(60, 'view'), ReservationController.listItems);
router.post('/reservations/:folioId/items', authMiddleware, requirePermission(60, 'add'), ReservationController.addItem);
router.put('/reservations/:folioId/items/:itemId', authMiddleware, requirePermission(60, 'edit'), ReservationController.updateItem);
router.delete('/reservations/:folioId/items/:itemId', authMiddleware, requirePermission(60, 'delete'), ReservationController.deleteItem);

// Singular aliases for items
router.get('/reservation/:folioId/items', authMiddleware, requirePermission(60, 'view'), ReservationController.listItems);
router.post('/reservation/:folioId/items', authMiddleware, requirePermission(60, 'add'), ReservationController.addItem);
router.put('/reservation/:folioId/items/:itemId', authMiddleware, requirePermission(60, 'edit'), ReservationController.updateItem);
router.delete('/reservation/:folioId/items/:itemId', authMiddleware, requirePermission(60, 'delete'), ReservationController.deleteItem);

export default router;
