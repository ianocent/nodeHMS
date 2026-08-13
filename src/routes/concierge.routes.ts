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

// Frontend /cms/concierge/phone-book-group-{1,2,3} aliases
router.get('/concierge/phone-book-group-1', authMiddleware, ConciergeController.phoneBookGroupList);
router.get('/concierge/phone-book-group-2', authMiddleware, ConciergeController.phoneBookGroupList);
router.get('/concierge/phone-book-group-3', authMiddleware, ConciergeController.phoneBookGroupList);
router.post('/concierge/phone-book-group-1', authMiddleware, ConciergeController.phoneBookGroupStore);
router.post('/concierge/phone-book-group-2', authMiddleware, ConciergeController.phoneBookGroupStore);
router.post('/concierge/phone-book-group-3', authMiddleware, ConciergeController.phoneBookGroupStore);

// Frontend /cms/concierge/phone-book aliases
router.get('/concierge/phone-book', authMiddleware, ConciergeController.phoneBookList);
router.get('/concierge/phone-book/tree', authMiddleware, ConciergeController.phoneBookGroupTree);
router.post('/concierge/phone-book', authMiddleware, ConciergeController.phoneBookStore);
router.put('/concierge/phone-book/:id', authMiddleware, ConciergeController.phoneBookUpdate);
router.delete('/concierge/phone-book/:id', authMiddleware, ConciergeController.phoneBookDestroy);

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

// Frontend /concierge/baggage alias
router.get('/concierge/baggage', authMiddleware, ConciergeController.baggageList);
router.post('/concierge/baggage', authMiddleware, ConciergeController.baggageStore);
router.put('/concierge/baggage/:id', authMiddleware, ConciergeController.baggageUpdate);
router.delete('/concierge/baggage/:id', authMiddleware, ConciergeController.baggageDestroy);

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

// Frontend /cms/concierge/lostfound aliases
router.get('/concierge/lostfound', authMiddleware, ConciergeController.lostFoundList);
router.get('/concierge/lostfound/create', authMiddleware, ConciergeController.lostFoundForm);
router.get('/concierge/lostfound/:id/update', authMiddleware, ConciergeController.lostFoundForm);
router.post('/concierge/lostfound', authMiddleware, ConciergeController.lostFoundStore);
router.put('/concierge/lostfound/:id', authMiddleware, ConciergeController.lostFoundUpdate);
router.delete('/concierge/lostfound/:id', authMiddleware, ConciergeController.lostFoundDestroy);

// Frontend /cms/concierge/car-park aliases
router.get('/concierge/car-park', authMiddleware, ConciergeController.carParkList);
router.post('/concierge/car-park', authMiddleware, ConciergeController.carParkStore);
router.put('/concierge/car-park/:id', authMiddleware, ConciergeController.carParkUpdate);
router.delete('/concierge/car-park/:id', authMiddleware, ConciergeController.carParkDestroy);

export default router;
