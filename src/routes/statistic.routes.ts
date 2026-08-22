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
router.get('/statistic/room-availability/folio/:folioNumber', authMiddleware, StatisticController.getFolioDetail);
router.put('/statistic/room-availability/:room', authMiddleware, StatisticController.updateRoomAvailability);
router.post('/statistic/room-availability-bulk/:room', authMiddleware, StatisticController.updateRoomAvailabilityBulk);
router.post('/statistic/drag-room-availability', authMiddleware, StatisticController.dragRoomAvailability);
router.post('/statistic/preview-drag-room-availability', authMiddleware, StatisticController.previewDragRoomAvailability);
router.post('/statistic/statistic-room-type/detail', authMiddleware, StatisticController.statisticsRoomTypeMouseOver);
router.post('/statistic/statistic-room-type/add-message', authMiddleware, StatisticController.statisticsRoomTypeAddMessage);
router.post('/statistic/statistic-room-type/add-rate-code', authMiddleware, StatisticController.statisticsRoomTypeAddRateCode);
router.get('/statistic/messages', authMiddleware, StatisticController.messages);
router.get('/statistic/rate-codes', authMiddleware, StatisticController.rateCodes);
router.get('/statistic', authMiddleware, StatisticController.roomStatisticGrid);

export default router;
