import { Router } from 'express';
import { HousekeepingController } from '../controllers/housekeeping.controller';
import { RoomController } from '../controllers/room.controller';
import { ServiceSchedulerController } from '../controllers/service-scheduler.controller';
import { genericController } from '../controllers/generic.controller';
import { success } from '../utils/response';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

const generic = genericController;

router.get('/housekeeping/setups', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupList);
router.post('/housekeeping/setups', authMiddleware, requirePermission(158, 'add'), HousekeepingController.setupStore);
router.get('/housekeeping/setups/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupShow);
router.put('/housekeeping/setups/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.setupUpdate);
router.delete('/housekeeping/setups/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.setupDestroy);
router.get('/housekeeping/room-status', authMiddleware, requirePermission(158, 'view'), HousekeepingController.roomStatus);
router.get('/housekeeping/room-status/master', authMiddleware, requirePermission(158, 'view'), HousekeepingController.roomStatusMaster);
// static paths BEFORE /room-status/:id (Express :id would swallow them)
router.get('/housekeeping/room-status/checklist', authMiddleware, requirePermission(158, 'view'), HousekeepingController.roomStatusChecklist);
router.post('/housekeeping/room-status/batch', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.roomStatusBatch);
router.post('/housekeeping/room-status/save-checklist', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.roomStatusSaveChecklist);
router.get('/housekeeping/room-status/current-housekeepers', authMiddleware, requirePermission(158, 'view'), HousekeepingController.currentHousekeepers);
router.put('/housekeeping/room-status/status/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.roomStatusUpdateStatus);
router.get('/housekeeping/history', authMiddleware, requirePermission(158, 'view'), HousekeepingController.housekeeperHistoryList);
router.get('/housekeeping/shift-user-list', authMiddleware, requirePermission(158, 'view'), HousekeepingController.shiftUserList);
router.get('/housekeeping/room-status/create', authMiddleware, requirePermission(158, 'add'), RoomController.create);
router.get('/housekeeping/room-status/:id', authMiddleware, requirePermission(158, 'view'), RoomController.show);
router.get('/housekeeping/room-status/:id/update', authMiddleware, requirePermission(158, 'edit'), RoomController.edit);
router.post('/housekeeping/room-status', authMiddleware, requirePermission(158, 'add'), RoomController.store);
router.put('/housekeeping/room-status/:id', authMiddleware, requirePermission(158, 'edit'), RoomController.update);
router.delete('/housekeeping/room-status/:id', authMiddleware, requirePermission(158, 'delete'), RoomController.destroy);
router.get('/housekeeping/work-orders', authMiddleware, requirePermission(158, 'view'), HousekeepingController.workOrderList);
router.post('/housekeeping/work-orders', authMiddleware, requirePermission(158, 'add'), HousekeepingController.workOrderStore);
router.get('/housekeeping/work-orders/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.workOrderShow);
router.put('/housekeeping/work-orders/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.workOrderUpdate);
router.delete('/housekeeping/work-orders/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.workOrderDestroy);
router.get('/housekeeping/stocks', authMiddleware, requirePermission(158, 'view'), HousekeepingController.stockList);
router.get('/housekeeping/rosters', authMiddleware, requirePermission(158, 'view'), HousekeepingController.rosterList);
router.get('/housekeeping/rosters/create', authMiddleware, requirePermission(158, 'add'), (req, res) => { req.params.model = 'rosters'; generic.createForm(req, res); });
router.post('/housekeeping/rosters', authMiddleware, requirePermission(158, 'add'), (req, res) => { req.params.model = 'rosters'; generic.create(req, res); });
router.get('/housekeeping/rosters/:id', authMiddleware, requirePermission(158, 'view'), (req, res) => { req.params.model = 'rosters'; generic.show(req, res); });
router.get('/housekeeping/rosters/:id/update', authMiddleware, requirePermission(158, 'edit'), (req, res) => { req.params.model = 'rosters'; generic.editForm(req, res); });
router.put('/housekeeping/rosters/:id', authMiddleware, requirePermission(158, 'edit'), (req, res) => { req.params.model = 'rosters'; generic.update(req, res); });
router.delete('/housekeeping/rosters/:id', authMiddleware, requirePermission(158, 'delete'), (req, res) => { req.params.model = 'rosters'; generic.destroy(req, res); });
router.get('/housekeeping/checklist-history', authMiddleware, requirePermission(158, 'view'), HousekeepingController.checklistHistory);
router.get('/housekeeping/housekeeper-history', authMiddleware, requirePermission(158, 'view'), HousekeepingController.housekeeperHistory);

// ── Work Order singular aliases (frontend uses /housekeeping/work-order) ──
router.get('/housekeeping/work-order/summary', authMiddleware, requirePermission(158, 'view'), HousekeepingController.workOrderSummary);
router.get('/housekeeping/work-order', authMiddleware, requirePermission(158, 'view'), HousekeepingController.workOrderList);
router.get('/housekeeping/work-order/create', authMiddleware, requirePermission(158, 'add'), HousekeepingController.workOrderForm);
router.post('/housekeeping/work-order', authMiddleware, requirePermission(158, 'add'), HousekeepingController.workOrderStore);
router.get('/housekeeping/work-order/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.workOrderShow);
router.get('/housekeeping/work-order/:id/update', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.workOrderForm);
router.put('/housekeeping/work-order/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.workOrderUpdate);
router.delete('/housekeeping/work-order/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.workOrderDestroy);

// ── Roster List (roster_list model) ──
const rosterModel = (req: any) => { req.params.model = 'roster_list'; };
router.get('/housekeeping/roster-list', authMiddleware, requirePermission(158, 'view'), (req, res) => { rosterModel(req); generic.list(req, res); });
router.get('/housekeeping/roster-list/create', authMiddleware, requirePermission(158, 'add'), (req, res) => { rosterModel(req); generic.createForm(req, res); });
router.post('/housekeeping/roster-list', authMiddleware, requirePermission(158, 'add'), (req, res) => { rosterModel(req); generic.create(req, res); });
router.get('/housekeeping/roster-list/:id', authMiddleware, requirePermission(158, 'view'), (req, res) => { rosterModel(req); generic.show(req, res); });
router.get('/housekeeping/roster-list/:id/update', authMiddleware, requirePermission(158, 'edit'), (req, res) => { rosterModel(req); generic.editForm(req, res); });
router.put('/housekeeping/roster-list/:id', authMiddleware, requirePermission(158, 'edit'), (req, res) => { rosterModel(req); generic.update(req, res); });
router.delete('/housekeeping/roster-list/:id', authMiddleware, requirePermission(158, 'delete'), (req, res) => { rosterModel(req); generic.destroy(req, res); });

// ── Shift Roster (shift_roster model) ──
const shiftRosterModel = (req: any) => { req.params.model = 'shift_roster'; };
router.get('/housekeeping/shift-roster', authMiddleware, requirePermission(158, 'view'), (req, res) => { shiftRosterModel(req); generic.list(req, res); });
router.get('/housekeeping/shift-roster/create', authMiddleware, requirePermission(158, 'add'), (req, res) => { shiftRosterModel(req); generic.createForm(req, res); });
router.post('/housekeeping/shift-roster', authMiddleware, requirePermission(158, 'add'), (req, res) => { shiftRosterModel(req); generic.create(req, res); });
router.get('/housekeeping/shift-roster/:id', authMiddleware, requirePermission(158, 'view'), (req, res) => { shiftRosterModel(req); generic.show(req, res); });
router.get('/housekeeping/shift-roster/:id/update', authMiddleware, requirePermission(158, 'edit'), (req, res) => { shiftRosterModel(req); generic.editForm(req, res); });
router.put('/housekeeping/shift-roster/:id', authMiddleware, requirePermission(158, 'edit'), (req, res) => { shiftRosterModel(req); generic.update(req, res); });
router.delete('/housekeeping/shift-roster/:id', authMiddleware, requirePermission(158, 'delete'), (req, res) => { shiftRosterModel(req); generic.destroy(req, res); });

// ── Stock (stocks model) ──
const stocksModel = (req: any) => { req.params.model = 'stocks'; };
router.get('/housekeeping/stock', authMiddleware, requirePermission(158, 'view'), (req, res) => { stocksModel(req); generic.list(req, res); });
router.post('/housekeeping/stock', authMiddleware, requirePermission(158, 'add'), (req, res) => { stocksModel(req); generic.create(req, res); });
router.put('/housekeeping/stock/:id', authMiddleware, requirePermission(158, 'edit'), (req, res) => { stocksModel(req); generic.update(req, res); });
router.delete('/housekeeping/stock/:id', authMiddleware, requirePermission(158, 'delete'), (req, res) => { stocksModel(req); generic.destroy(req, res); });

// ── Work Order Stock (work_order_stocks model) ──
const workOrderStocksModel = (req: any) => { req.params.model = 'work_order_stocks'; };
router.get('/work-order-stock', authMiddleware, requirePermission(158, 'view'), (req, res) => { workOrderStocksModel(req); generic.list(req, res); });
router.post('/work-order-stock', authMiddleware, requirePermission(158, 'add'), (req, res) => { workOrderStocksModel(req); generic.create(req, res); });
router.put('/work-order-stock/:id', authMiddleware, requirePermission(158, 'edit'), (req, res) => { workOrderStocksModel(req); generic.update(req, res); });
router.delete('/work-order-stock/:id', authMiddleware, requirePermission(158, 'delete'), (req, res) => { workOrderStocksModel(req); generic.destroy(req, res); });

// ── Service Scheduler (parity ServiceSchedulerController) ──
router.get('/housekeeping/service-scheduler', authMiddleware, requirePermission(158, 'view'), ServiceSchedulerController.index);
router.get('/housekeeping/service-scheduler/housekeepers', authMiddleware, requirePermission(158, 'view'), ServiceSchedulerController.housekeepers);
router.get('/housekeeping/service-scheduler/shifts', authMiddleware, requirePermission(158, 'view'), ServiceSchedulerController.shifts);
router.get('/housekeeping/service-scheduler/create', authMiddleware, requirePermission(158, 'add'), (req, res) => { req.params.model = 'rosters'; generic.createForm(req, res); });
router.post('/housekeeping/service-scheduler', authMiddleware, requirePermission(158, 'add'), (req, res) => { req.params.model = 'rosters'; generic.create(req, res); });
router.get('/housekeeping/service-scheduler/:id', authMiddleware, requirePermission(158, 'view'), (req, res) => { req.params.model = 'rosters'; generic.show(req, res); });
router.get('/housekeeping/service-scheduler/:id/update', authMiddleware, requirePermission(158, 'edit'), (req, res) => { req.params.model = 'rosters'; generic.editForm(req, res); });
router.put('/housekeeping/service-scheduler/:id', authMiddleware, requirePermission(158, 'edit'), (req, res) => { req.params.model = 'rosters'; generic.update(req, res); });
router.delete('/housekeeping/service-scheduler/:id', authMiddleware, requirePermission(158, 'delete'), (req, res) => { req.params.model = 'rosters'; generic.destroy(req, res); });

// Singular aliases for frontend compatibility
router.get('/housekeeping-setup', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupList);
router.get('/housekeeping-setup/create', authMiddleware, requirePermission(158, 'add'), async (req, res) => {
  const { success } = await import('../utils/response');
  success(res, { statuses: [], fields: [] }, 'Success');
});
router.post('/housekeeping-setup', authMiddleware, requirePermission(158, 'add'), HousekeepingController.setupStore);
router.get('/housekeeping-setup/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupShow);
router.get('/housekeeping-setup/:id/update', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.setupShow);
router.put('/housekeeping-setup/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.setupUpdate);
router.delete('/housekeeping-setup/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.setupDestroy);
router.get('/housekeeping-setups', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupList);
router.get('/housekeeping-setups/create', authMiddleware, requirePermission(158, 'add'), async (req, res) => {
  const { success } = await import('../utils/response');
  success(res, { statuses: [], fields: [] }, 'Success');
});
router.post('/housekeeping-setups', authMiddleware, requirePermission(158, 'add'), HousekeepingController.setupStore);
router.get('/housekeeping-setups/:id', authMiddleware, requirePermission(158, 'view'), HousekeepingController.setupShow);
router.get('/housekeeping-setups/:id/update', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.setupShow);
router.put('/housekeeping-setups/:id', authMiddleware, requirePermission(158, 'edit'), HousekeepingController.setupUpdate);
router.delete('/housekeeping-setups/:id', authMiddleware, requirePermission(158, 'delete'), HousekeepingController.setupDestroy);

// ── /stock alias (frontend /cms/stock) ──
const stockModelAlias = (req: any) => { req.params.model = 'stocks'; };
router.get('/stock', authMiddleware, requirePermission(158, 'view'), (req, res) => { stockModelAlias(req); generic.list(req, res); });
router.post('/stock', authMiddleware, requirePermission(158, 'add'), (req, res) => { stockModelAlias(req); generic.create(req, res); });
router.put('/stock/:id', authMiddleware, requirePermission(158, 'edit'), (req, res) => { stockModelAlias(req); generic.update(req, res); });
router.delete('/stock/:id', authMiddleware, requirePermission(158, 'delete'), (req, res) => { stockModelAlias(req); generic.destroy(req, res); });

export default router;
