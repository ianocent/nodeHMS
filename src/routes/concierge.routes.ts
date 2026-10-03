import { Router } from 'express';
import { ConciergeController } from '../controllers/concierge.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { makeUpload } from '../utils/upload';

const router = Router();

// Baggage file upload (Laravel BaggageController: 'file' => 'nullable|file|mimes:pdf,jpg,png,doc,docx|max:2048')
const baggageUpload = makeUpload(['pdf', 'jpg', 'png', 'doc', 'docx']);

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
//
// The level has to reach the controller: base scopes each list with
// `PhoneBookGroup<N>::where('group', N)` and gives level 2/3 a Parent Group
// select built from level N-1. All three routes used to hit the same
// unparameterised handler, so every tab listed all three levels.
const phoneBookGroupList = (level: number) => (req: any, res: any) => {
  req.params.groupLevel = String(level);
  return ConciergeController.phoneBookGroupList(req, res);
};
// The store/update/destroy routes need the level for the same reason: the list reads
// `group = N`, so a row saved without `group` lands on the schema default 0 and is
// invisible in all three tabs. Laravel pins it (`'group' => 1` in
// PhoneBookGroup1Controller@store).
const phoneBookGroupStore = (level: number) => (req: any, res: any) => {
  req.params.groupLevel = String(level);
  return ConciergeController.phoneBookGroupStore(req, res);
};
const phoneBookGroupUpdate = (level: number) => (req: any, res: any) => {
  req.params.groupLevel = String(level);
  return ConciergeController.phoneBookGroupUpdate(req, res);
};
router.get('/concierge/phone-book-group-1', authMiddleware, phoneBookGroupList(1));
router.get('/concierge/phone-book-group-2', authMiddleware, phoneBookGroupList(2));
router.get('/concierge/phone-book-group-3', authMiddleware, phoneBookGroupList(3));
router.post('/concierge/phone-book-group-1', authMiddleware, phoneBookGroupStore(1));
router.post('/concierge/phone-book-group-2', authMiddleware, phoneBookGroupStore(2));
router.post('/concierge/phone-book-group-3', authMiddleware, phoneBookGroupStore(3));
// The form endpoints need the level too: PhoneBookGroup2/3Controller validate
// `parent_id` as required and expose a Parent Group select built from level N-1.
const phoneBookGroupForm = (level: number) => (req: any, res: any) => {
  req.params.groupLevel = String(level);
  return ConciergeController.phoneBookGroupForm(req, res);
};
router.get('/concierge/phone-book-group-1/create', authMiddleware, phoneBookGroupForm(1));
router.get('/concierge/phone-book-group-2/create', authMiddleware, phoneBookGroupForm(2));
router.get('/concierge/phone-book-group-3/create', authMiddleware, phoneBookGroupForm(3));
router.get('/concierge/phone-book-group-1/:id', authMiddleware, phoneBookGroupForm(1));
router.get('/concierge/phone-book-group-2/:id', authMiddleware, phoneBookGroupForm(2));
router.get('/concierge/phone-book-group-3/:id', authMiddleware, phoneBookGroupForm(3));
router.get('/concierge/phone-book-group-1/:id/update', authMiddleware, phoneBookGroupForm(1));
router.get('/concierge/phone-book-group-1/:id/edit', authMiddleware, phoneBookGroupForm(1));
router.get('/concierge/phone-book-group-2/:id/update', authMiddleware, phoneBookGroupForm(2));
router.get('/concierge/phone-book-group-2/:id/edit', authMiddleware, phoneBookGroupForm(2));
router.get('/concierge/phone-book-group-3/:id/update', authMiddleware, phoneBookGroupForm(3));
router.get('/concierge/phone-book-group-3/:id/edit', authMiddleware, phoneBookGroupForm(3));
router.put('/concierge/phone-book-group-1/:id', authMiddleware, phoneBookGroupUpdate(1));
router.put('/concierge/phone-book-group-2/:id', authMiddleware, phoneBookGroupUpdate(2));
router.put('/concierge/phone-book-group-3/:id', authMiddleware, phoneBookGroupUpdate(3));
router.delete('/concierge/phone-book-group-1/:id', authMiddleware, ConciergeController.phoneBookGroupDestroy);
router.delete('/concierge/phone-book-group-2/:id', authMiddleware, ConciergeController.phoneBookGroupDestroy);
router.delete('/concierge/phone-book-group-3/:id', authMiddleware, ConciergeController.phoneBookGroupDestroy);

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
router.post('/baggages', authMiddleware, baggageUpload.single('file'), ConciergeController.baggageStore);
router.put('/baggages/:id', authMiddleware, baggageUpload.single('file'), ConciergeController.baggageUpdate);
router.delete('/baggages/:id', authMiddleware, ConciergeController.baggageDestroy);

// Singular aliases for frontend compatibility
router.get('/baggage', authMiddleware, ConciergeController.baggageList);
router.post('/baggage', authMiddleware, baggageUpload.single('file'), ConciergeController.baggageStore);
router.put('/baggage/:id', authMiddleware, baggageUpload.single('file'), ConciergeController.baggageUpdate);
router.delete('/baggage/:id', authMiddleware, ConciergeController.baggageDestroy);

// Frontend /concierge/baggage alias
router.get('/concierge/baggage', authMiddleware, ConciergeController.baggageList);
router.post('/concierge/baggage', authMiddleware, baggageUpload.single('file'), ConciergeController.baggageStore);
router.put('/concierge/baggage/:id', authMiddleware, baggageUpload.single('file'), ConciergeController.baggageUpdate);
router.delete('/concierge/baggage/:id', authMiddleware, ConciergeController.baggageDestroy);
router.get('/concierge/baggage/create', authMiddleware, ConciergeController.baggageForm);
router.get('/concierge/baggage/:id', authMiddleware, ConciergeController.baggageForm);
router.get('/concierge/baggage/:id/update', authMiddleware, ConciergeController.baggageForm);
router.get('/concierge/baggage/:id/edit', authMiddleware, ConciergeController.baggageForm);

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
router.get('/concierge/lostfound/:id/edit', authMiddleware, ConciergeController.lostFoundForm);
router.post('/concierge/lostfound', authMiddleware, ConciergeController.lostFoundStore);
router.put('/concierge/lostfound/:id', authMiddleware, ConciergeController.lostFoundUpdate);
router.delete('/concierge/lostfound/:id', authMiddleware, ConciergeController.lostFoundDestroy);

// Frontend /cms/concierge/car-park aliases
router.get('/concierge/car-park', authMiddleware, ConciergeController.carParkList);
router.post('/concierge/car-park', authMiddleware, ConciergeController.carParkStore);
router.put('/concierge/car-park/:id', authMiddleware, ConciergeController.carParkUpdate);
router.delete('/concierge/car-park/:id', authMiddleware, ConciergeController.carParkDestroy);
router.get('/concierge/car-park/create', authMiddleware, ConciergeController.carParkForm);
router.get('/concierge/car-park/:id', authMiddleware, ConciergeController.carParkForm);
router.get('/concierge/car-park/:id/update', authMiddleware, ConciergeController.carParkForm);
router.get('/concierge/car-park/:id/edit', authMiddleware, ConciergeController.carParkForm);

// Frontend /cms/concierge/lostfound show
router.get('/concierge/lostfound/:id', authMiddleware, ConciergeController.lostFoundForm);

export default router;
