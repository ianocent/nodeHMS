import { Router } from 'express';
import { PoolController } from '../controllers/pool.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// ═══ menu 1202: areas (manage_pool_master) ═══
router.get('/pool/areas', authMiddleware, requirePermission(1202, 'view'), PoolController.areaList);
router.post('/pool/areas', authMiddleware, requirePermission(1202, 'add'), PoolController.areaStore);
router.get('/pool/areas/:id', authMiddleware, requirePermission(1202, 'view'), PoolController.areaShow);
router.put('/pool/areas/:id', authMiddleware, requirePermission(1202, 'edit'), PoolController.areaUpdate);
router.delete('/pool/areas/:id', authMiddleware, requirePermission(1202, 'delete'), PoolController.areaDestroy);

// ═══ menu 1203: setups (manage_pool_master) — static sebelum /:id ═══
router.get('/pool/setups', authMiddleware, requirePermission(1203, 'view'), PoolController.setupList);
router.get('/pool/setups/create', authMiddleware, requirePermission(1203, 'add'), PoolController.setupCreate);
router.post('/pool/setups', authMiddleware, requirePermission(1203, 'add'), PoolController.setupStore);
router.get('/pool/setups/:id', authMiddleware, requirePermission(1203, 'view'), PoolController.setupShow);
router.put('/pool/setups/:id', authMiddleware, requirePermission(1203, 'edit'), PoolController.setupUpdate);
router.delete('/pool/setups/:id', authMiddleware, requirePermission(1203, 'delete'), PoolController.setupDestroy);

// ═══ menu 1204: attendance (check_in_pool/check_out_pool/override) — static dulu ═══
router.get('/pool/attendances', authMiddleware, requirePermission(1204, 'view'), PoolController.attendanceList);
router.get('/pool/attendances/shifts', authMiddleware, requirePermission(1204, 'view'), PoolController.attendanceShifts);
router.get('/pool/attendances/staff-search', authMiddleware, requirePermission(1204, 'view'), PoolController.staffSearch);
router.post('/pool/attendances/check-in', authMiddleware, requirePermission(1204, 'add'), PoolController.attendanceCheckIn);
router.post('/pool/attendances/check-out', authMiddleware, requirePermission(1204, 'edit'), PoolController.attendanceCheckOut);
router.get('/pool/attendances/:id', authMiddleware, requirePermission(1204, 'view'), PoolController.attendanceShow);
router.put('/pool/attendances/:id/checklist', authMiddleware, requirePermission(1204, 'edit'), PoolController.attendanceSaveChecklist);
router.put('/pool/attendances/:id/override', authMiddleware, requirePermission(1204, 'edit'), PoolController.attendanceOverride);

// ═══ menu 1205: usage (post_pool_usage/void_pool_usage) — static dulu ═══
router.get('/pool/usages', authMiddleware, requirePermission(1205, 'view'), PoolController.usageList);
router.get('/pool/usages/guest-search', authMiddleware, requirePermission(1205, 'view'), PoolController.guestSearch);
router.get('/pool/usages/code-items', authMiddleware, requirePermission(1205, 'view'), PoolController.usageCodeItems);
router.post('/pool/usages', authMiddleware, requirePermission(1205, 'add'), PoolController.usageStore);
router.get('/pool/usages/:id', authMiddleware, requirePermission(1205, 'view'), PoolController.usageShow);
router.put('/pool/usages/:id', authMiddleware, requirePermission(1205, 'edit'), PoolController.usageUpdate);
router.post('/pool/usages/:id/post', authMiddleware, requirePermission(1205, 'edit'), PoolController.usagePost);
router.post('/pool/usages/:id/void', authMiddleware, requirePermission(1205, 'edit'), PoolController.usageVoid);

// ═══ menu 1206: recap (view) ═══
router.get('/pool/recap', authMiddleware, requirePermission(1206, 'view'), PoolController.recap);

export default router;
