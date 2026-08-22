import { Router } from 'express';
import { FrontDeskExtrasController } from '../controllers/front-desk-extras.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Wake-up call — Laravel cms.php resource + restore/delete (permission flags in payload, menu 63)
router.get('/wake-up-call', authMiddleware, FrontDeskExtrasController.wakeUpCallIndex);
router.post('/wake-up-call', authMiddleware, FrontDeskExtrasController.wakeUpCallStore);
router.get('/wake-up-call/:id', authMiddleware, FrontDeskExtrasController.wakeUpCallShow);
router.put('/wake-up-call/:id', authMiddleware, FrontDeskExtrasController.wakeUpCallUpdate);
router.patch('/wake-up-call/:id', authMiddleware, FrontDeskExtrasController.wakeUpCallUpdate);
router.delete('/wake-up-call/:id', authMiddleware, FrontDeskExtrasController.wakeUpCallDestroy);
router.patch('/wake-up-call/:id/restore', authMiddleware, FrontDeskExtrasController.wakeUpCallRestore);
router.delete('/wake-up-call/:id/delete', authMiddleware, FrontDeskExtrasController.wakeUpCallDelete);

// Auto transfer
router.get('/auto-transfer', authMiddleware, FrontDeskExtrasController.autoTransferIndex);
router.post('/auto-transfer', authMiddleware, FrontDeskExtrasController.autoTransferStore);
router.delete('/auto-transfer/:id', authMiddleware, FrontDeskExtrasController.autoTransferDestroy);
router.delete('/auto-transfer/:id/delete', authMiddleware, FrontDeskExtrasController.autoTransferDestroy);

// Billing to (ledgers)
router.get('/billing-to', authMiddleware, FrontDeskExtrasController.billingToIndex);
router.put('/billing-to/:ledger', authMiddleware, FrontDeskExtrasController.billingToUpdate);

// Door lock keys
router.get('/new-key', authMiddleware, FrontDeskExtrasController.doorLockNew);
router.get('/duplicate-key', authMiddleware, FrontDeskExtrasController.doorLockDuplicate);
router.get('/erase-key', authMiddleware, FrontDeskExtrasController.doorLockErase);

// Deposit payment lifecycle
router.get('/deposit-payment', authMiddleware, FrontDeskExtrasController.depositPaymentIndex);
router.post('/deposit-payment', authMiddleware, FrontDeskExtrasController.depositPaymentStore);
router.put('/deposit-payment/:id', authMiddleware, FrontDeskExtrasController.depositPaymentUpdate);
router.patch('/deposit-payment/:id', authMiddleware, FrontDeskExtrasController.depositPaymentUpdate);
router.delete('/deposit-payment/:id', authMiddleware, FrontDeskExtrasController.depositPaymentDestroy);
router.delete('/deposit-payment/:id/delete', authMiddleware, FrontDeskExtrasController.depositPaymentDelete);
router.patch('/deposit-payment/:id/restore', authMiddleware, FrontDeskExtrasController.depositPaymentRestore);

export default router;
