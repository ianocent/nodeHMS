import { Router } from 'express';
import { RoomController } from '../controllers/room.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// ═══════════════════════════════════════════════
// Phase 4.2 — Room Management (menuId: 1120)
// ═══════════════════════════════════════════════

// ── Room Types ──
router.get('/room-types', authMiddleware, requirePermission(1120, 'view'), RoomController.typeList);
router.get('/room-types/create', authMiddleware, requirePermission(1120, 'add'), RoomController.typeCreate);
router.post('/room-types', authMiddleware, requirePermission(1120, 'add'), RoomController.typeStore);
router.get('/room-types/:id', authMiddleware, requirePermission(1120, 'view'), RoomController.typeShow);
router.get('/room-types/:id/edit', authMiddleware, requirePermission(1120, 'edit'), RoomController.typeEdit);
router.put('/room-types/:id', authMiddleware, requirePermission(1120, 'edit'), RoomController.typeUpdate);
router.delete('/room-types/:id', authMiddleware, requirePermission(1120, 'delete'), RoomController.typeDestroy);
router.post('/room-types/:id/restore', authMiddleware, requirePermission(1120, 'edit'), RoomController.typeRestore);

// Singular aliases for frontend compatibility
router.get('/room-type', authMiddleware, requirePermission(1120, 'view'), RoomController.typeList);
router.get('/room-type/create', authMiddleware, requirePermission(1120, 'add'), RoomController.typeCreate);
router.post('/room-type', authMiddleware, requirePermission(1120, 'add'), RoomController.typeStore);
// Static sub-routes BEFORE /room-type/:id (param shadowing)
router.get('/room-type/get-configuration/:id', authMiddleware, requirePermission(1120, 'view'), RoomController.getRoomConfiguration);
router.get('/room-type/get-room/:id', authMiddleware, requirePermission(1120, 'view'), RoomController.getRoom);
router.get('/room-type/get-room-v2/:id', authMiddleware, requirePermission(1120, 'view'), RoomController.getRoomFormatSelect);
router.get('/room-type/:id', authMiddleware, requirePermission(1120, 'view'), RoomController.typeShow);
router.get('/room-type/:id/edit', authMiddleware, requirePermission(1120, 'edit'), RoomController.typeEdit);
router.put('/room-type/:id', authMiddleware, requirePermission(1120, 'edit'), RoomController.typeUpdate);
router.delete('/room-type/:id', authMiddleware, requirePermission(1120, 'delete'), RoomController.typeDestroy);
router.post('/room-type/:id/restore', authMiddleware, requirePermission(1120, 'edit'), RoomController.typeRestore);
router.get('/room-type/:id/update', authMiddleware, requirePermission(1120, 'edit'), RoomController.typeEdit);

// ── Rooms ──
router.get('/rooms', authMiddleware, requirePermission(1120, 'view'), RoomController.list);
router.get('/rooms/statistics', authMiddleware, requirePermission(1120, 'view'), RoomController.statistics);
router.get('/rooms-statistic', authMiddleware, requirePermission(1120, 'view'), RoomController.statistics);
router.get('/rooms/create', authMiddleware, requirePermission(1120, 'add'), RoomController.create);
router.post('/rooms', authMiddleware, requirePermission(1120, 'add'), RoomController.store);
router.get('/rooms/:id', authMiddleware, requirePermission(1120, 'view'), RoomController.show);
router.get('/rooms/:id/edit', authMiddleware, requirePermission(1120, 'edit'), RoomController.edit);
router.put('/rooms/:id', authMiddleware, requirePermission(1120, 'edit'), RoomController.update);
router.delete('/rooms/:id', authMiddleware, requirePermission(1120, 'delete'), RoomController.destroy);
router.delete('/rooms/:id/force', authMiddleware, requirePermission(1120, 'delete'), RoomController.delete);
router.post('/rooms/:id/restore', authMiddleware, requirePermission(1120, 'edit'), RoomController.restore);
router.get('/rooms/:id/configuration', authMiddleware, requirePermission(1120, 'view'), RoomController.getConfiguration);

// Singular aliases for frontend compatibility
router.get('/room', authMiddleware, requirePermission(1120, 'view'), RoomController.list);
router.get('/room/statistics', authMiddleware, requirePermission(1120, 'view'), RoomController.statistics);
router.get('/room-statistic', authMiddleware, requirePermission(1120, 'view'), RoomController.statistics);
router.get('/room-statistics', authMiddleware, requirePermission(1120, 'view'), RoomController.statistics);
router.get('/room-statistic/create', authMiddleware, requirePermission(1120, 'add'), RoomController.create);
router.get('/room/create', authMiddleware, requirePermission(1120, 'add'), RoomController.create);
router.post('/room', authMiddleware, requirePermission(1120, 'add'), RoomController.store);
router.get('/room/:id', authMiddleware, requirePermission(1120, 'view'), RoomController.show);
router.get('/room/:id/edit', authMiddleware, requirePermission(1120, 'edit'), RoomController.edit);
router.get('/room/:id/update', authMiddleware, requirePermission(1120, 'edit'), RoomController.edit);
router.put('/room/:id', authMiddleware, requirePermission(1120, 'edit'), RoomController.update);
router.delete('/room/:id', authMiddleware, requirePermission(1120, 'delete'), RoomController.destroy);
router.delete('/room/:id/force', authMiddleware, requirePermission(1120, 'delete'), RoomController.delete);
router.post('/room/:id/restore', authMiddleware, requirePermission(1120, 'edit'), RoomController.restore);
router.get('/room/:id/configuration', authMiddleware, requirePermission(1120, 'view'), RoomController.getConfiguration);

// ── Room Type Images ──
router.get('/room-types/:roomTypeId/images', authMiddleware, requirePermission(1120, 'view'), RoomController.imageList);
router.get('/room-type-images', authMiddleware, requirePermission(1120, 'view'), RoomController.imageList);
router.get('/room-type-images/create', authMiddleware, requirePermission(1120, 'add'), RoomController.imageForm);
router.post('/room-type-images', authMiddleware, requirePermission(1120, 'add'), RoomController.imageStore);
router.post('/room-types/:roomTypeId/images', authMiddleware, requirePermission(1120, 'add'), RoomController.imageStore);
router.get('/room-type-images/:id', authMiddleware, requirePermission(1120, 'view'), RoomController.imageForm);
router.get('/room-type-images/:id/update', authMiddleware, requirePermission(1120, 'edit'), RoomController.imageForm);
router.put('/room-type-images/:id', authMiddleware, requirePermission(1120, 'edit'), RoomController.imageUpdate);
router.delete('/room-type-images/:id', authMiddleware, requirePermission(1120, 'delete'), RoomController.imageDestroy);
router.post('/room-type-images/:id/restore', authMiddleware, requirePermission(1120, 'edit'), RoomController.imageRestore);

// ── Room Inventories ──
router.get('/rooms/:roomId/inventories', authMiddleware, requirePermission(1120, 'view'), RoomController.inventoryList);
router.post('/rooms/:roomId/inventories', authMiddleware, requirePermission(1120, 'add'), RoomController.inventoryStore);
router.put('/room-inventories/:id', authMiddleware, requirePermission(1120, 'edit'), RoomController.inventoryUpdate);
router.delete('/room-inventories/:id', authMiddleware, requirePermission(1120, 'delete'), RoomController.inventoryDestroy);

// ── Room Reservations ──
router.get('/rooms/:roomId/reservations', authMiddleware, requirePermission(1120, 'view'), RoomController.reservationList);

export default router;
