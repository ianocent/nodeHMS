import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Public routes (no auth required)
// Replicates Laravel cms.php lines 259-260 + 291-293
router.post('/login', AuthController.login);
router.post('/forget-password', AuthController.forgetPassword);
router.get('/force-logout/:email', AuthController.forceLogout);
router.get('/force-bulk-logout', AuthController.forceBulkLogout);

// Protected routes (require auth:sanctum)
// Replicates Laravel cms.php lines 294-295 + 409-410
router.post('/logout', authMiddleware, AuthController.logout);
router.post('/change-password', authMiddleware, AuthController.changePassword);
router.post('/refresh', authMiddleware, AuthController.refresh);
router.post('/force-logout/:email', authMiddleware, AuthController.forceLogout);
router.post('/force-bulk-logout', authMiddleware, AuthController.forceBulkLogout);

export default router;
