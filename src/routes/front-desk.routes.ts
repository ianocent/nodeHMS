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
router.get('/front-desk/:id/update', authMiddleware, requirePermission(63, 'view'), FrontDeskController.show);
router.post('/front-desk/check-in', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.checkIn);
router.post('/front-desk/check-out', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.checkOut);
router.get('/front-desk/folio', authMiddleware, requirePermission(63, 'view'), FrontDeskController.transactionFolio);
router.post('/front-desk/batch-check-out', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.batchCheckOut);

// Singular aliases for frontend compatibility
router.get('/front-desk', authMiddleware, requirePermission(63, 'view'), FrontDeskController.list);
router.get('/front-desk/:id', authMiddleware, requirePermission(63, 'view'), FrontDeskController.show);
router.get('/front-desk/:id/update', authMiddleware, requirePermission(63, 'view'), FrontDeskController.show);
router.post('/front-desk/batch-check-out', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.batchCheckOut);

// Transaction
router.get('/transactions', authMiddleware, FrontDeskController.transactionList);
router.post('/transactions', authMiddleware, FrontDeskController.transactionStore);
// Laravel route shape: POST transaction/void?folio_id= (static path BEFORE :id routes)
router.post('/transactions/void', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionVoidBulk);
router.post('/transaction/void', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionVoidBulk);
// Laravel cms.php:1138-1148 — transfer/consolidate/split/refund
router.post('/transaction/transfer', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionTransfer);
router.post('/transactions/transfer', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionTransfer);
router.post('/transaction/consolidate', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionConsolidate);
router.post('/transactions/consolidate', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionConsolidate);
router.post('/transaction/split', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionSplit);
router.post('/transactions/split', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionSplit);
router.post('/transaction/refund', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionRefund);
router.post('/transactions/refund', authMiddleware, requirePermission(63, 'edit'), FrontDeskController.transactionRefund);
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

// GLOBALSAVE commit — Laravel cms.php:1006 (BatchPostingController@batchPosting); temps → transactions
router.post('/batch-posting/batch-posting', authMiddleware, FrontDeskController.batchPostingCommit);
router.post('/batch-postings/batch-postings', authMiddleware, FrontDeskController.batchPostingCommit);

// Deposit
router.get('/deposits', authMiddleware, FrontDeskController.depositList);

// Singular alias for deposit
router.get('/deposit', authMiddleware, FrontDeskController.depositList);

// Door Lock
router.get('/door-locks', authMiddleware, FrontDeskController.doorLockList);

// Singular alias for door lock
router.get('/door-lock', authMiddleware, FrontDeskController.doorLockList);

export default router;
