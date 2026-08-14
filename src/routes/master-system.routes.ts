import { Router } from 'express';
import { MasterDataController } from '../controllers/master-data.controller';
import { AccountingController } from '../controllers/accounting.controller';
import { PosController } from '../controllers/pos.controller';
import { SystemController } from '../controllers/system.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// ═════════════════════════════════════════════════════════
// Master Data — Code Post (Product Categories)
// ════════════════════════════════════════════════════════

router.get('/code-post', authMiddleware, requirePermission(69, 'view'), MasterDataController.codePostList);
router.get('/code-post/create', authMiddleware, requirePermission(69, 'add'), (req, res) => { req.params.model = 'code_posts'; MasterDataController.masterForm(req, res); });
router.post('/code-post', authMiddleware, requirePermission(69, 'add'), MasterDataController.codePostCreate);
router.get('/code-post/:id', authMiddleware, requirePermission(69, 'view'), MasterDataController.codePostShow);
router.get('/code-post/:id/edit', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codePostEdit);
router.get('/code-post/:id/update', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codePostEdit);
router.put('/code-post/:id', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codePostUpdate);
router.delete('/code-post/:id', authMiddleware, requirePermission(69, 'delete'), MasterDataController.codePostDestroy);

// ═════════════════════════════════════════════════════════
// Master Data — Code Item (Products)
// ═════════════════════════════════════════════════════════

router.get('/code-item', authMiddleware, requirePermission(69, 'view'), MasterDataController.codeItemList);
router.get('/code-item/create', authMiddleware, requirePermission(69, 'add'), (req, res) => { req.params.model = 'code_items'; MasterDataController.masterForm(req, res); });
router.post('/code-item', authMiddleware, requirePermission(69, 'add'), MasterDataController.codeItemCreate);
router.get('/code-item/:id', authMiddleware, requirePermission(69, 'view'), MasterDataController.codeItemShow);
router.get('/code-item/:id/edit', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeItemEdit);
router.get('/code-item/:id/update', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeItemEdit);
router.put('/code-item/:id', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeItemUpdate);
router.delete('/code-item/:id', authMiddleware, requirePermission(69, 'delete'), MasterDataController.codeItemDestroy);

// ══════════════════════════════════════════════════════════
// Master Data — Code Billing
// ═════════════════════════════════════════════════════════

router.get('/code-billing', authMiddleware, requirePermission(69, 'view'), MasterDataController.codeBillingList);
router.get('/code-billing/create', authMiddleware, requirePermission(69, 'add'), (req, res) => { req.params.model = 'code_billings'; MasterDataController.masterForm(req, res); });
router.post('/code-billing', authMiddleware, requirePermission(69, 'add'), MasterDataController.codeBillingCreate);
router.get('/code-billing/:id', authMiddleware, requirePermission(69, 'view'), MasterDataController.codeBillingShow);
router.get('/code-billing/:id/edit', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeBillingEdit);
router.get('/code-billing/:id/update', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeBillingEdit);
router.put('/code-billing/:id', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeBillingUpdate);
router.delete('/code-billing/:id', authMiddleware, requirePermission(69, 'delete'), MasterDataController.codeBillingDestroy);

// ══════════════════════════════════════════════════════════
// Master Data — Code GL
// ═════════════════════════════════════════════════════════

router.get('/code-gls', authMiddleware, requirePermission(69, 'view'), MasterDataController.codeGlList);
router.get('/code-gls/create', authMiddleware, requirePermission(69, 'add'), (req, res) => { req.params.model = 'code_gls'; MasterDataController.masterForm(req, res); });
router.post('/code-gls', authMiddleware, requirePermission(69, 'add'), MasterDataController.codeGlCreate);
router.get('/code-gls/:id', authMiddleware, requirePermission(69, 'view'), MasterDataController.codeGlShow);
router.get('/code-gls/:id/edit', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeGlEdit);
router.get('/code-gls/:id/update', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeGlEdit);
router.put('/code-gls/:id', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeGlUpdate);
router.delete('/code-gls/:id', authMiddleware, requirePermission(69, 'delete'), MasterDataController.codeGlDestroy);

// Singular alias
router.get('/code-gl', authMiddleware, requirePermission(69, 'view'), MasterDataController.codeGlList);
router.get('/code-gl/create', authMiddleware, requirePermission(69, 'add'), (req, res) => { req.params.model = 'code_gls'; MasterDataController.masterForm(req, res); });
router.post('/code-gl', authMiddleware, requirePermission(69, 'add'), MasterDataController.codeGlCreate);
router.get('/code-gl/:id', authMiddleware, requirePermission(69, 'view'), MasterDataController.codeGlShow);
router.get('/code-gl/:id/edit', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeGlEdit);
router.get('/code-gl/:id/update', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeGlEdit);
router.put('/code-gl/:id', authMiddleware, requirePermission(69, 'edit'), MasterDataController.codeGlUpdate);
router.delete('/code-gl/:id', authMiddleware, requirePermission(69, 'delete'), MasterDataController.codeGlDestroy);

// ══════════════════════════════════════════════════════════
// POS — Transactions & Matrix Sales
// ═════════════════════════════════════════════════════════

router.get('/transaction/pos', authMiddleware, requirePermission(69, 'view'), PosController.listTransactions);
router.get('/pos-matrix-sales', authMiddleware, requirePermission(69, 'view'), PosController.listMatrixSales);

// ══════════════════════════════════════════════════════════
// Accounting — List by type (invoice, credit-note, debit-note, payment, refund, adjustment)
// ══════════════════════════════════════════════════════════

router.get('/accounting/get/:type', authMiddleware, requirePermission(69, 'view'), AccountingController.autocomplete);
router.get('/accounting/:type', authMiddleware, requirePermission(69, 'view'), AccountingController.list);
router.get('/accounting/:type/create', authMiddleware, requirePermission(69, 'add'), AccountingController.createForm);
router.post('/accounting/:type', authMiddleware, requirePermission(69, 'add'), AccountingController.store);
router.put('/accounting/:type/:id', authMiddleware, requirePermission(69, 'edit'), AccountingController.updateStatus);
router.post('/accounting/:type/update-status', authMiddleware, requirePermission(69, 'edit'), AccountingController.updateStatus);
router.get('/accounting/:type/:id', authMiddleware, requirePermission(69, 'view'), AccountingController.show);

// ══════════════════════════════════════════════════════════
// Allocation Accounting
// ═════════════════════════════════════════════════════════

router.get('/allocation-accounting', authMiddleware, requirePermission(69, 'view'), AccountingController.allocationList);
router.post('/allocation-accounting/store', authMiddleware, requirePermission(69, 'add'), AccountingController.allocationStore);
router.get('/allocation-accounting/get-doc', authMiddleware, requirePermission(69, 'view'), AccountingController.allocationGetDoc);
router.get('/allocation-history', authMiddleware, requirePermission(69, 'view'), AccountingController.allocationList);

// ══════════════════════════════════════════════════════════
// System — Shift Confirmation & End of Day
// ══════════════════════════════════════════════════════════

router.get('/shift-confirmation', authMiddleware, requirePermission(69, 'view'), SystemController.shiftConfirmationList);
router.post('/shift-confirmation/confirmation', authMiddleware, requirePermission(69, 'edit'), SystemController.shiftConfirmationSubmit);
router.get('/shift/detail', authMiddleware, requirePermission(69, 'view'), SystemController.shiftDetail);
router.post('/night-audit/post-audit', authMiddleware, requirePermission(69, 'edit'), SystemController.nightAuditPost);
router.get('/check-value', authMiddleware, requirePermission(69, 'view'), SystemController.checkValue);

// ══════════════════════════════════════════════════════════
// System — Balance Reports
// ═════════════════════════════════════════════════════════

router.get('/system-balance/:type', authMiddleware, requirePermission(69, 'view'), SystemController.systemBalance);

// ══════════════════════════════════════════════════════════
// System — Logs, Setup, Post Code Budget
// ═════════════════════════════════════════════════════════

router.get('/log', authMiddleware, requirePermission(69, 'view'), SystemController.logList);
router.get('/setup', authMiddleware, requirePermission(69, 'view'), SystemController.setup);
router.get('/setup/get-type', authMiddleware, requirePermission(69, 'view'), SystemController.setupGetType);
router.get('/setup/create', authMiddleware, requirePermission(69, 'add'), SystemController.setupCreate);
router.get('/setup/:id', authMiddleware, requirePermission(69, 'view'), SystemController.setupShow);
router.post('/setup', authMiddleware, requirePermission(69, 'add'), SystemController.setupStore);
router.put('/setup/:id', authMiddleware, requirePermission(69, 'edit'), SystemController.setupUpdate);
router.delete('/setup/:id', authMiddleware, requirePermission(69, 'delete'), SystemController.setupDestroy);
router.get('/post-code-budget', authMiddleware, requirePermission(69, 'view'), SystemController.postCodeBudget);

// Night Audit — Room Change
router.get('/room-changes', authMiddleware, requirePermission(69, 'view'), SystemController.roomChangeList);
router.post('/room-changes', authMiddleware, requirePermission(69, 'add'), SystemController.roomChangeStore);

// Log Audit
router.get('/log-audits', authMiddleware, requirePermission(69, 'view'), SystemController.logAuditList);

// Night Audit — Shift data
router.get('/night-audit/shift', authMiddleware, SystemController.nightAuditShift);

// Night Audit — Check audit
router.post('/night-audit/check-audit', authMiddleware, SystemController.nightAuditCheck);

// Night Audit — Audit date (for header business date)
router.get('/night-audit/audit', authMiddleware, SystemController.nightAuditAudit);

// Night Audit — Room change / No show / Over stay lists
router.get('/night-audit/room-change', authMiddleware, SystemController.nightAuditRoomChange);
router.get('/night-audit/no-show', authMiddleware, SystemController.nightAuditNoShow);
router.get('/night-audit/over-stay', authMiddleware, SystemController.nightAuditOverStay);

// Dashboard data
router.get('/get-dashboard', authMiddleware, SystemController.getDashboard);
router.get('/get-dashboard/:code', authMiddleware, SystemController.getDashboardDetail);

// Helper endpoints
router.get('/helper/task-notification', authMiddleware, SystemController.helperTaskNotification);
router.get('/helper/total-cancel-booking-engine', authMiddleware, SystemController.helperTotalCancelBookingEngine);
router.post('/helper/release-last-user-folio', authMiddleware, SystemController.helperReleaseLastUserFolio);

// Additional helper endpoints for frontend compatibility
router.post('/helper/check-last-user-folio', authMiddleware, SystemController.helperCheckLastUserFolio);
router.post('/helper/replace-last-user-folio', authMiddleware, SystemController.helperReplaceLastUserFolio);

export default router;
