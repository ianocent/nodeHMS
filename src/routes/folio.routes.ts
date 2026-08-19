import { Router } from 'express';
import { FolioController } from '../controllers/folio.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// Folio management routes (menuId: 60 = Reservation parent menu)
// Folios belong to reservations, use same permission scope
// These extend the reservation/folio management capabilities

// Folio search for dropdowns
router.get('/folios/search', authMiddleware, requirePermission(60, 'view'), FolioController.search);
router.get('/folios/quick-search', authMiddleware, requirePermission(60, 'view'), FolioController.quickSearch);

// Folio ledger
router.get('/folios/:id/ledger', authMiddleware, requirePermission(60, 'view'), FolioController.ledger);

// Folio subfolios (GIT children)
router.get('/folios/:id/subfolios', authMiddleware, requirePermission(60, 'view'), FolioController.subfolios);

// Folio master data
router.get('/folios/master', authMiddleware, requirePermission(60, 'view'), FolioController.master);

// Folio unified status update
router.post('/folios/:id/update-status', authMiddleware, requirePermission(60, 'edit'), FolioController.updateStatus);

// Folio data (remark, instruction, notes)
router.put('/folios/:id/data', authMiddleware, requirePermission(60, 'edit'), FolioController.updateData);

// Guest profile folio management
router.get('/guest-profiles/:id/folios', authMiddleware, requirePermission(82, 'view'), FolioController.guestFolios);
router.post('/guest-profiles/:id/folios', authMiddleware, requirePermission(82, 'add'), FolioController.createGuestFolio);
router.delete('/guest-profiles/:id/folios/:folioId', authMiddleware, requirePermission(82, 'delete'), FolioController.deleteGuestFolio);

// Company profile folio management
router.get('/company-profiles/:id/folios', authMiddleware, requirePermission(83, 'view'), FolioController.companyFolios);
router.post('/company-profiles/:id/folios', authMiddleware, requirePermission(83, 'add'), FolioController.createCompanyFolio);
router.delete('/company-profiles/:id/folios/:folioId', authMiddleware, requirePermission(83, 'delete'), FolioController.deleteCompanyFolio);

// Singular aliases for frontend compatibility
router.get('/folio/search', authMiddleware, requirePermission(60, 'view'), FolioController.search);
router.get('/folio/quick-search', authMiddleware, requirePermission(60, 'view'), FolioController.quickSearch);
router.get('/folio/:id/ledger', authMiddleware, requirePermission(60, 'view'), FolioController.ledger);
router.get('/folio/:id/subfolios', authMiddleware, requirePermission(60, 'view'), FolioController.subfolios);
router.get('/folio/master', authMiddleware, requirePermission(60, 'view'), FolioController.master);
router.post('/folio/:id/update-status', authMiddleware, requirePermission(60, 'edit'), FolioController.updateStatus);
router.put('/folio/:id/data', authMiddleware, requirePermission(60, 'edit'), FolioController.updateData);

router.get('/guest-profile/:id/folios', authMiddleware, requirePermission(82, 'view'), FolioController.guestFolios);
router.post('/guest-profile/:id/folios', authMiddleware, requirePermission(82, 'add'), FolioController.createGuestFolio);
router.delete('/guest-profile/:id/folios/:folioId', authMiddleware, requirePermission(82, 'delete'), FolioController.deleteGuestFolio);

router.get('/company-profile/:id/folios', authMiddleware, requirePermission(83, 'view'), FolioController.companyFolios);
router.post('/company-profile/:id/folios', authMiddleware, requirePermission(83, 'add'), FolioController.createCompanyFolio);
router.delete('/company-profile/:id/folios/:folioId', authMiddleware, requirePermission(83, 'delete'), FolioController.deleteCompanyFolio);

export default router;
