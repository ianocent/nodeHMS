import { Router } from 'express';
import { ConciergeController } from '../controllers/concierge.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Phone Book Groups
router.get('/phone-book-groups', authMiddleware, ConciergeController.phoneBookGroupList);
router.get('/phone-book-groups/tree', authMiddleware, ConciergeController.phoneBookGroupTree);
router.post('/phone-book-groups', authMiddleware, ConciergeController.phoneBookGroupStore);
router.put('/phone-book-groups/:id', authMiddleware, ConciergeController.phoneBookGroupUpdate);
router.delete('/phone-book-groups/:id', authMiddleware, ConciergeController.phoneBookGroupDestroy);

// Singular aliases for frontend compatibility
router.get('/phone-book-group', authMiddleware, ConciergeController.phoneBookGroupList);
router.get('/phone-book-group/tree', authMiddleware, ConciergeController.phoneBookGroupTree);
router.post('/phone-book-group', authMiddleware, ConciergeController.phoneBookGroupStore);
router.put('/phone-book-group/:id', authMiddleware, ConciergeController.phoneBookGroupUpdate);
router.delete('/phone-book-group/:id', authMiddleware, ConciergeController.phoneBookGroupDestroy);

// Phone Books
router.get('/phone-books', authMiddleware, ConciergeController.phoneBookList);
router.post('/phone-books', authMiddleware, ConciergeController.phoneBookStore);
router.put('/phone-books/:id', authMiddleware, ConciergeController.phoneBookUpdate);
router.delete('/phone-books/:id', authMiddleware, ConciergeController.phoneBookDestroy);

// Singular aliases for frontend compatibility
router.get('/phone-book', authMiddleware, ConciergeController.phoneBookList);
router.post('/phone-book', authMiddleware, ConciergeController.phoneBookStore);
router.put('/phone-book/:id', authMiddleware, ConciergeController.phoneBookUpdate);
router.delete('/phone-book/:id', authMiddleware, ConciergeController.phoneBookDestroy);

// Baggage
router.get('/baggages', authMiddleware, ConciergeController.baggageList);
router.post('/baggages', authMiddleware, ConciergeController.baggageStore);
router.put('/baggages/:id', authMiddleware, ConciergeController.baggageUpdate);
router.delete('/baggages/:id', authMiddleware, ConciergeController.baggageDestroy);

// Singular aliases for frontend compatibility
router.get('/baggage', authMiddleware, ConciergeController.baggageList);
router.post('/baggage', authMiddleware, ConciergeController.baggageStore);
router.put('/baggage/:id', authMiddleware, ConciergeController.baggageUpdate);
router.delete('/baggage/:id', authMiddleware, ConciergeController.baggageDestroy);

// Car Park
router.get('/car-parks', authMiddleware, ConciergeController.carParkList);
router.post('/car-parks', authMiddleware, ConciergeController.carParkStore);
router.put('/car-parks/:id', authMiddleware, ConciergeController.carParkUpdate);
router.delete('/car-parks/:id', authMiddleware, ConciergeController.carParkDestroy);

// Singular aliases for frontend compatibility
router.get('/car-park', authMiddleware, ConciergeController.carParkList);
router.post('/car-park', authMiddleware, ConciergeController.carParkStore);
router.put('/car-park/:id', authMiddleware, ConciergeController.carParkUpdate);
router.delete('/car-park/:id', authMiddleware, ConciergeController.carParkDestroy);

// Lost & Found
router.get('/lost-and-founds', authMiddleware, ConciergeController.lostFoundList);
router.post('/lost-and-founds', authMiddleware, ConciergeController.lostFoundStore);
router.put('/lost-and-founds/:id', authMiddleware, ConciergeController.lostFoundUpdate);
router.delete('/lost-and-founds/:id', authMiddleware, ConciergeController.lostFoundDestroy);

// Singular aliases for frontend compatibility
router.get('/lost-and-found', authMiddleware, ConciergeController.lostFoundList);
router.post('/lost-and-found', authMiddleware, ConciergeController.lostFoundStore);
router.put('/lost-and-found/:id', authMiddleware, ConciergeController.lostFoundUpdate);
router.delete('/lost-and-found/:id', authMiddleware, ConciergeController.lostFoundDestroy);

export default router;
