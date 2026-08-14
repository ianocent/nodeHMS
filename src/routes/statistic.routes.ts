import { Router } from 'express';
import { StatisticController } from '../controllers/statistic.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.get('/dashboard', authMiddleware, StatisticController.dashboard);
router.get('/room-availabilities', authMiddleware, StatisticController.roomAvailability);
router.get('/room-availability', authMiddleware, StatisticController.roomAvailability);
router.get('/statistic/by-room-type', authMiddleware, StatisticController.byRoomType);
router.get('/statistic/statistic-room-type', authMiddleware, StatisticController.byRoomType);
router.get('/statistic/statistic-room-type-grouping', authMiddleware, StatisticController.byRoomType);
router.get('/statistic/room-availability', authMiddleware, StatisticController.roomAvailability);
router.get('/statistic/messages', authMiddleware, StatisticController.messages);
router.get('/statistic/rate-codes', authMiddleware, StatisticController.rateCodes);
router.get('/statistic', authMiddleware, StatisticController.roomStatisticGrid);

export default router;
