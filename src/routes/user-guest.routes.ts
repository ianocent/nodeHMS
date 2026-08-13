import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { GuestController } from '../controllers/guest.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// User routes (menuId: 1116 from Laravel cms.php)
// Static paths must be BEFORE :id to avoid BigInt crash
router.get('/users', authMiddleware, requirePermission(1116, 'view'), UserController.list);
router.get('/users/create', authMiddleware, requirePermission(1116, 'add'), UserController.create);
router.post('/users', authMiddleware, requirePermission(1116, 'add'), UserController.store);
router.get('/users/online/list', authMiddleware, requirePermission(1116, 'view'), UserController.onlineList);
router.get('/users/simple/list', authMiddleware, requirePermission(1116, 'view'), UserController.simpleList);
router.get('/users/all/list', authMiddleware, requirePermission(1116, 'view'), UserController.listAll);
router.get('/users/:id', authMiddleware, requirePermission(1116, 'view'), UserController.show);
router.get('/users/:id/edit', authMiddleware, requirePermission(1116, 'edit'), UserController.edit);
router.put('/users/:id', authMiddleware, requirePermission(1116, 'edit'), UserController.update);
router.delete('/users/:id', authMiddleware, requirePermission(1116, 'delete'), UserController.destroy);
router.post('/users/:id/restore', authMiddleware, requirePermission(1116, 'edit'), UserController.restore);

// Singular aliases for user
router.get('/user', authMiddleware, requirePermission(1116, 'view'), UserController.list);
router.get('/user/create', authMiddleware, requirePermission(1116, 'add'), UserController.create);
router.post('/user', authMiddleware, requirePermission(1116, 'add'), UserController.store);
router.get('/user/online/list', authMiddleware, requirePermission(1116, 'view'), UserController.onlineList);
router.get('/user/simple/list', authMiddleware, requirePermission(1116, 'view'), UserController.simpleList);
router.get('/user/all/list', authMiddleware, requirePermission(1116, 'view'), UserController.listAll);
router.get('/user/:id', authMiddleware, requirePermission(1116, 'view'), UserController.show);
router.get('/user/:id/edit', authMiddleware, requirePermission(1116, 'edit'), UserController.edit);
router.put('/user/:id', authMiddleware, requirePermission(1116, 'edit'), UserController.update);
router.delete('/user/:id', authMiddleware, requirePermission(1116, 'delete'), UserController.destroy);
router.post('/user/:id/restore', authMiddleware, requirePermission(1116, 'edit'), UserController.restore);

// Guest routes (menuId: 82 from Laravel cms.php)
// Static paths must be BEFORE /guests/:id to avoid BigInt crash
router.get('/guests', authMiddleware, requirePermission(82, 'view'), GuestController.list);
router.get('/guests/create', authMiddleware, requirePermission(82, 'add'), GuestController.create);
router.post('/guests', authMiddleware, requirePermission(82, 'add'), GuestController.store);
router.get('/guests/simple/list', authMiddleware, requirePermission(82, 'view'), GuestController.simpleList);
router.get('/guests/autocomplete', authMiddleware, requirePermission(82, 'view'), GuestController.autocomplete);
router.get('/guests/countries', authMiddleware, requirePermission(82, 'view'), GuestController.countries);
router.get('/guests/cities', authMiddleware, requirePermission(82, 'view'), GuestController.cities);
router.get('/guests/:id', authMiddleware, requirePermission(82, 'view'), GuestController.show);
router.get('/guests/:id/edit', authMiddleware, requirePermission(82, 'edit'), GuestController.edit);
router.put('/guests/:id', authMiddleware, requirePermission(82, 'edit'), GuestController.update);
router.delete('/guests/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.destroy);
router.post('/guests/:id/restore', authMiddleware, requirePermission(82, 'edit'), GuestController.restore);

// Guest Documents
router.get('/guests/:guestId/documents', authMiddleware, requirePermission(82, 'view'), GuestController.documentList);
router.post('/guests/:guestId/documents', authMiddleware, requirePermission(82, 'add'), GuestController.documentStore);
router.delete('/guests/documents/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.documentDestroy);

// Guest Family
router.get('/guests/:guestId/family', authMiddleware, requirePermission(82, 'view'), GuestController.familyList);
router.post('/guests/:guestId/family', authMiddleware, requirePermission(82, 'add'), GuestController.familyStore);
router.delete('/guests/family/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.familyDestroy);

// Guest History
router.get('/guests/:guestId/history', authMiddleware, requirePermission(82, 'view'), GuestController.historyList);

// Guest Preferences
router.get('/guests/:guestId/preferences', authMiddleware, requirePermission(82, 'view'), GuestController.preferenceList);
router.post('/guests/:guestId/preferences', authMiddleware, requirePermission(82, 'add'), GuestController.preferenceStore);
router.delete('/guests/preferences/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.preferenceDestroy);

// Guest Loyalty Cards
router.get('/guests/:guestId/loyalty-cards', authMiddleware, requirePermission(82, 'view'), GuestController.loyaltyList);
router.post('/guests/:guestId/loyalty-cards', authMiddleware, requirePermission(82, 'add'), GuestController.loyaltyStore);
router.delete('/guests/loyalty-cards/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.loyaltyDestroy);

// Singular aliases for guest and nested resources
// IMPORTANT: Static paths must be BEFORE /guest/:id to avoid BigInt crash
router.get('/guest', authMiddleware, requirePermission(82, 'view'), GuestController.list);
router.get('/guest/create', authMiddleware, requirePermission(82, 'add'), GuestController.create);
router.post('/guest', authMiddleware, requirePermission(82, 'add'), GuestController.store);
router.get('/guest/simple/list', authMiddleware, requirePermission(82, 'view'), GuestController.simpleList);
router.get('/guest/autocomplete', authMiddleware, requirePermission(82, 'view'), GuestController.autocomplete);
router.get('/guest/countries', authMiddleware, requirePermission(82, 'view'), GuestController.countries);
router.get('/guest/cities', authMiddleware, requirePermission(82, 'view'), GuestController.cities);
router.get('/guest/:id', authMiddleware, requirePermission(82, 'view'), GuestController.show);
router.get('/guest/:id/edit', authMiddleware, requirePermission(82, 'edit'), GuestController.edit);
router.put('/guest/:id', authMiddleware, requirePermission(82, 'edit'), GuestController.update);
router.delete('/guest/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.destroy);
router.post('/guest/:id/restore', authMiddleware, requirePermission(82, 'edit'), GuestController.restore);
router.get('/guest/:guestId/documents', authMiddleware, requirePermission(82, 'view'), GuestController.documentList);
router.post('/guest/:guestId/documents', authMiddleware, requirePermission(82, 'add'), GuestController.documentStore);
router.get('/guest/:guestId/family', authMiddleware, requirePermission(82, 'view'), GuestController.familyList);
router.post('/guest/:guestId/family', authMiddleware, requirePermission(82, 'add'), GuestController.familyStore);
router.get('/guest/:guestId/history', authMiddleware, requirePermission(82, 'view'), GuestController.historyList);
router.get('/guest/:guestId/preferences', authMiddleware, requirePermission(82, 'view'), GuestController.preferenceList);
router.post('/guest/:guestId/preferences', authMiddleware, requirePermission(82, 'add'), GuestController.preferenceStore);
router.get('/guest/:guestId/loyalty-cards', authMiddleware, requirePermission(82, 'view'), GuestController.loyaltyList);
router.post('/guest/:guestId/loyalty-cards', authMiddleware, requirePermission(82, 'add'), GuestController.loyaltyStore);

// DELETE routes (different HTTP method, safe after :id)
router.delete('/guest/documents/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.documentDestroy);
router.delete('/guest/family/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.familyDestroy);
router.delete('/guest/preferences/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.preferenceDestroy);
router.delete('/guest/loyalty-cards/:id', authMiddleware, requirePermission(82, 'delete'), GuestController.loyaltyDestroy);

export default router;