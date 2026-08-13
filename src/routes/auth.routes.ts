import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Public routes (no auth required)
// Replicates Laravel cms.php lines 291-293
router.post('/login', AuthController.login);
router.post('/forget-password', AuthController.forgetPassword);

// Protected routes (require auth:sanctum)
// Replicates Laravel cms.php lines 410-411
router.post('/logout', authMiddleware, AuthController.logout);
router.post('/change-password', authMiddleware, AuthController.changePassword);
router.post('/refresh', authMiddleware, AuthController.refresh);

export default router;
