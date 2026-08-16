import { Router } from 'express';
import { FrontDeskController } from '../controllers/front-desk.controller';
import { PosController } from '../controllers/pos.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// Static paths MUST be before /front-desk/:id to avoid param shadowing
// Shift
router.get('/front-desk/shifts', authMiddleware, FrontDeskController.shiftList);
router.post('/front-desk/shifts/start', authMiddleware, FrontDeskController.shiftStart);
router.post('/front-desk/shifts/end', authMiddleware, FrontDeskController.shiftEnd);
router.get('/front-desk/shift-rosters', authMiddleware, FrontDeskController.shiftRosterList);

// Singular aliases for shift
router.get('/front-desk/shift', authMiddleware, FrontDeskController.shiftList);
router.post('/front-desk/shift/start', authMiddleware, FrontDeskController.shiftStart);
router.post('/front-desk/shift/end', authMiddleware, FrontDeskController.shiftEnd);
router.get('/front-desk/shift-roster', authMiddleware, FrontDeskController.shiftRosterList);

// Front desk routes (menuId: 63 from Laravel)
router.get('/front-desk', authMiddleware, requirePermission(63, 'view'), FrontDeskController.list);
router.get('/front-desk/:id', authMiddleware, requirePermission(63, 'view'), FrontDeskController.show);
router.post('/front-desk/check-in', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.checkIn);
router.post('/front-desk/check-out', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.checkOut);
router.get('/front-desk/folio', authMiddleware, requirePermission(63, 'view'), FrontDeskController.transactionFolio);
router.post('/front-desk/batch-check-out', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.batchCheckOut);

// Singular aliases for frontend compatibility
router.get('/front-desk', authMiddleware, requirePermission(63, 'view'), FrontDeskController.list);
router.get('/front-desk/:id', authMiddleware, requirePermission(63, 'view'), FrontDeskController.show);
router.post('/front-desk/batch-check-out', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.batchCheckOut);

// Transaction
router.get('/transactions', authMiddleware, FrontDeskController.transactionList);
router.post('/transactions', authMiddleware, FrontDeskController.transactionStore);
router.get('/transactions/:id', authMiddleware, FrontDeskController.transactionShow);
router.post('/transactions/:id/void', authMiddleware, FrontDeskController.transactionVoid);

// Singular aliases for transactions
router.get('/transaction', authMiddleware, FrontDeskController.transactionList);
router.post('/transaction', authMiddleware, FrontDeskController.transactionStore);
router.get('/transaction/folio', authMiddleware, FrontDeskController.transactionFolio);
router.get('/transaction/create', authMiddleware, FrontDeskController.transactionCreate);
router.get('/transaction/pos', authMiddleware, requirePermission(69, 'view'), PosController.listTransactions);
router.get('/transaction/:id', authMiddleware, FrontDeskController.transactionShow);
router.post('/transaction/:id/void', authMiddleware, FrontDeskController.transactionVoid);
router.put('/front-desk/data/:id', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.updateData);

// Batch Posting
router.get('/batch-postings', authMiddleware, FrontDeskController.batchPostingList);
router.post('/batch-postings', authMiddleware, FrontDeskController.batchPostingStore);

// Singular aliases for batch posting
router.get('/batch-posting', authMiddleware, FrontDeskController.batchPostingList);
router.post('/batch-posting', authMiddleware, FrontDeskController.batchPostingStore);

// Deposit
router.get('/deposits', authMiddleware, FrontDeskController.depositList);

// Singular alias for deposit
router.get('/deposit', authMiddleware, FrontDeskController.depositList);

// Door Lock
router.get('/door-locks', authMiddleware, FrontDeskController.doorLockList);

// Singular alias for door lock
router.get('/door-lock', authMiddleware, FrontDeskController.doorLockList);

export default router;
