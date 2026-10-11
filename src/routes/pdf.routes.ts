import { Router } from 'express';
import { PdfController } from '../controllers/pdf.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Endpoint for generating PDF documents efficiently.
// Replaces Laravel's GuestFolioReportController, AccommodationConfirmationController, etc.
//
// `authMiddleware` is the exported name; the earlier `requireAuth` import did not exist, so
// this file failed to compile — which meant no PDF route was ever mounted.
router.get('/:type/:id', authMiddleware, PdfController.renderPdf);

export default router;
