import { Router } from 'express';
import { ReportController } from '../controllers/report.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// ═══════════════════════════════════════════════════════════
// Report Permissions (diurus master-system.routes -> ReportPermissionController, parity Laravel)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// Report Batch Management
// ═══════════════════════════════════════════════════════════

router.get('/cms/report/batch', authMiddleware, requirePermission(69, 'view'), ReportController.batchList);
router.post('/cms/report/batch', authMiddleware, requirePermission(69, 'add'), ReportController.batchSave);
router.get('/cms/report/batch/download-reports-batch', authMiddleware, requirePermission(69, 'view'), ReportController.batchList);

// ═══════════════════════════════════════════════════════════
// Report — Specific routes (BEFORE wildcard)
// ═══════════════════════════════════════════════════════════

router.get('/cms/report/batch/folio/:id/:docType', authMiddleware, requirePermission(69, 'view'), ReportController.folioDocument);
router.get('/cms/report/event/:id/:reportType', authMiddleware, requirePermission(69, 'view'), ReportController.eventReport);
router.get('/cms/report/company-profile', authMiddleware, requirePermission(69, 'view'), ReportController.companyProfileReport);
router.get('/cms/report/companyprofile', authMiddleware, requirePermission(69, 'view'), ReportController.companyProfileReport);

// ═══════════════════════════════════════════════════════════
// Report — Wildcard handler (after-night-audit, before-night-audit, account, frontoffice, etc.)
// ═══════════════════════════════════════════════════════════

router.get('/cms/report/{*path}', authMiddleware, requirePermission(69, 'view'), ReportController.handleReport);

// ═══════════════════════════════════════════════════════════
// System — Night Audit, Staff, Countries, City
// ═══════════════════════════════════════════════════════════

router.get('/cms/night-audit/audit', authMiddleware, requirePermission(69, 'view'), ReportController.nightAudit);
router.get('/cms/staff', authMiddleware, requirePermission(69, 'view'), ReportController.staffList);
router.get('/cms/master/countries', authMiddleware, requirePermission(69, 'view'), ReportController.masterCountries);
router.get('/cms/cityByCountry', authMiddleware, requirePermission(69, 'view'), ReportController.cityByCountry);
router.get('/cms/citybycountry', authMiddleware, requirePermission(69, 'view'), ReportController.cityByCountry);

// ═══════════════════════════════════════════════════════════
// Guest Listing Report (under /cms/guest path)
// ═══════════════════════════════════════════════════════════

router.get('/cms/guest/guest-listing-report', authMiddleware, requirePermission(69, 'view'), ReportController.guestListingReportCms);

export default router;
