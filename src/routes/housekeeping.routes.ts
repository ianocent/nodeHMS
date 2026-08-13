import { Router } from 'express';
import { HousekeepingController } from '../controllers/housekeeping.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

router.get('/housekeeping/setups', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupList);
router.post('/housekeeping/setups', authMiddleware, requirePermission(158, 'add'), HousekeepingController.setupStore);
router.get('/housekeeping/setups/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupShow);
router.put('/housekeeping/setups/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.setupUpdate);
router.delete('/housekeeping/setups/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.setupDestroy);
router.get('/housekeeping/room-status', authMiddleware, requirePermission(158, 'view'), HousekeepingController.roomStatus);
router.get('/housekeeping/work-orders', authMiddleware, requirePermission(158, 'view'), HousekeepingController.workOrderList);
router.post('/housekeeping/work-orders', authMiddleware, requirePermission(158, 'add'), HousekeepingController.workOrderStore);
router.get('/housekeeping/work-orders/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.workOrderShow);
router.put('/housekeeping/work-orders/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.workOrderUpdate);
router.delete('/housekeeping/work-orders/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.workOrderDestroy);
router.get('/housekeeping/stocks', authMiddleware, requirePermission(158, 'view'), HousekeepingController.stockList);
router.get('/housekeeping/rosters', authMiddleware, requirePermission(158, 'view'), HousekeepingController.rosterList);
router.get('/housekeeping/checklist-history', authMiddleware, requirePermission(158, 'view'), HousekeepingController.checklistHistory);
router.get('/housekeeping/housekeeper-history', authMiddleware, requirePermission(158, 'view'), HousekeepingController.housekeeperHistory);

// Singular aliases for frontend compatibility
router.get('/housekeeping-setup', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupList);
router.get('/housekeeping-setup/create', authMiddleware, requirePermission(158, 'add'), async (req, res) => {
  const { success } = await import('../utils/response');
  success(res, { statuses: [], fields: [] }, 'Success');
});
router.post('/housekeeping-setup', authMiddleware, requirePermission(158, 'add'), HousekeepingController.setupStore);
router.get('/housekeeping-setup/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupShow);
router.put('/housekeeping-setup/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.setupUpdate);
router.delete('/housekeeping-setup/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.setupDestroy);
router.get('/housekeeping-setups', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupList);
router.get('/housekeeping-setups/create', authMiddleware, requirePermission(158, 'add'), async (req, res) => {
  const { success } = await import('../utils/response');
  success(res, { statuses: [], fields: [] }, 'Success');
});
router.post('/housekeeping-setups', authMiddleware, requirePermission(158, 'add'), HousekeepingController.setupStore);
router.get('/housekeeping-setups/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupShow);
router.put('/housekeeping-setups/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.setupUpdate);
router.delete('/housekeeping-setups/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.setupDestroy);

export default router;
