import { Router } from 'express';
import { EventController } from '../controllers/event.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// Venues
router.get('/event-venues', authMiddleware, requirePermission(211, 'view'), EventController.venueList);
router.get('/event-venues/master', authMiddleware, requirePermission(211, 'view'), EventController.venueMaster);
router.post('/event-venues', authMiddleware, requirePermission(211, 'add'), EventController.venueStore);
router.put('/event-venues/:id', authMiddleware, requirePermission(211, 'edit'), EventController.venueUpdate);
router.delete('/event-venues/:id', authMiddleware, requirePermission(211, 'delete'), EventController.venueDestroy);

// Singular aliases
router.get('/event-venue', authMiddleware, requirePermission(211, 'view'), EventController.venueList);
router.get('/event-venue/master', authMiddleware, requirePermission(211, 'view'), EventController.venueMaster);
router.post('/event-venue', authMiddleware, requirePermission(211, 'add'), EventController.venueStore);
router.put('/event-venue/:id', authMiddleware, requirePermission(211, 'edit'), EventController.venueUpdate);
router.delete('/event-venue/:id', authMiddleware, requirePermission(211, 'delete'), EventController.venueDestroy);

// Layouts
router.get('/event-layouts', authMiddleware, requirePermission(211, 'view'), EventController.layoutList);
router.post('/event-layouts', authMiddleware, requirePermission(211, 'add'), EventController.layoutStore);
router.put('/event-layouts/:id', authMiddleware, requirePermission(211, 'edit'), EventController.layoutUpdate);
router.delete('/event-layouts/:id', authMiddleware, requirePermission(211, 'delete'), EventController.layoutDestroy);

// Singular aliases
router.get('/event-layout', authMiddleware, requirePermission(211, 'view'), EventController.layoutList);
router.post('/event-layout', authMiddleware, requirePermission(211, 'add'), EventController.layoutStore);
router.put('/event-layout/:id', authMiddleware, requirePermission(211, 'edit'), EventController.layoutUpdate);
router.delete('/event-layout/:id', authMiddleware, requirePermission(211, 'delete'), EventController.layoutDestroy);

// Events
router.get('/events', authMiddleware, requirePermission(211, 'view'), EventController.eventList);
router.get('/events/create', authMiddleware, requirePermission(211, 'add'), EventController.eventCreate);
router.post('/events', authMiddleware, requirePermission(211, 'add'), EventController.eventStore);
router.get('/events/:id', authMiddleware, requirePermission(211, 'view'), EventController.eventShow);
router.put('/events/:id', authMiddleware, requirePermission(211, 'edit'), EventController.eventUpdate);
router.delete('/events/:id', authMiddleware, requirePermission(211, 'delete'), EventController.eventDestroy);

// Singular aliases
router.get('/event', authMiddleware, requirePermission(211, 'view'), EventController.eventList);
router.get('/event/create', authMiddleware, requirePermission(211, 'add'), EventController.eventCreate);
router.post('/event', authMiddleware, requirePermission(211, 'add'), EventController.eventStore);
router.get('/event/:id', authMiddleware, requirePermission(211, 'view'), EventController.eventShow);
router.put('/event/:id', authMiddleware, requirePermission(211, 'edit'), EventController.eventUpdate);
router.delete('/event/:id', authMiddleware, requirePermission(211, 'delete'), EventController.eventDestroy);

// Packages
router.get('/event-packages', authMiddleware, requirePermission(211, 'view'), EventController.packageList);
router.post('/event-packages', authMiddleware, requirePermission(211, 'add'), EventController.packageStore);
router.put('/event-packages/:id', authMiddleware, requirePermission(211, 'edit'), EventController.packageUpdate);
router.delete('/event-packages/:id', authMiddleware, requirePermission(211, 'delete'), EventController.packageDestroy);

// Singular aliases
router.get('/event-package', authMiddleware, requirePermission(211, 'view'), EventController.packageList);
router.post('/event-package', authMiddleware, requirePermission(211, 'add'), EventController.packageStore);
router.put('/event-package/:id', authMiddleware, requirePermission(211, 'edit'), EventController.packageUpdate);
router.delete('/event-package/:id', authMiddleware, requirePermission(211, 'delete'), EventController.packageDestroy);

// Inventory
router.get('/event-inventories', authMiddleware, requirePermission(211, 'view'), EventController.inventoryList);
router.post('/event-inventories', authMiddleware, requirePermission(211, 'add'), EventController.inventoryStore);
router.put('/event-inventories/:id', authMiddleware, requirePermission(211, 'edit'), EventController.inventoryUpdate);
router.delete('/event-inventories/:id', authMiddleware, requirePermission(211, 'delete'), EventController.inventoryDestroy);

// Singular aliases
router.get('/event-inventory', authMiddleware, requirePermission(211, 'view'), EventController.inventoryList);
router.post('/event-inventory', authMiddleware, requirePermission(211, 'add'), EventController.inventoryStore);
router.put('/event-inventory/:id', authMiddleware, requirePermission(211, 'edit'), EventController.inventoryUpdate);
router.delete('/event-inventory/:id', authMiddleware, requirePermission(211, 'delete'), EventController.inventoryDestroy);

// Event Management Items
router.get('/event-items', authMiddleware, requirePermission(211, 'view'), EventController.itemList);

// Singular alias
router.get('/event-item', authMiddleware, requirePermission(211, 'view'), EventController.itemList);

// Deposit Plans (nested under event)
router.get('/events/:eventId/deposit-plans', authMiddleware, requirePermission(211, 'view'), EventController.depositPlanList);
router.post('/events/:eventId/deposit-plans', authMiddleware, requirePermission(211, 'add'), EventController.depositPlanStore);
router.delete('/events/deposit-plans/:id', authMiddleware, requirePermission(211, 'delete'), EventController.depositPlanDestroy);

// Singular aliases for deposit plans
router.get('/event/:eventId/deposit-plans', authMiddleware, requirePermission(211, 'view'), EventController.depositPlanList);
router.post('/event/:eventId/deposit-plans', authMiddleware, requirePermission(211, 'add'), EventController.depositPlanStore);
router.delete('/event/deposit-plans/:id', authMiddleware, requirePermission(211, 'delete'), EventController.depositPlanDestroy);

// Deposit Actuals (nested under event)
router.get('/events/:eventId/deposit-actuals', authMiddleware, requirePermission(211, 'view'), EventController.depositActualList);
router.post('/events/:eventId/deposit-actuals', authMiddleware, requirePermission(211, 'add'), EventController.depositActualStore);
router.delete('/events/deposit-actuals/:id', authMiddleware, requirePermission(211, 'delete'), EventController.depositActualDestroy);

// Singular aliases for deposit actuals
router.get('/event/:eventId/deposit-actuals', authMiddleware, requirePermission(211, 'view'), EventController.depositActualList);
router.post('/event/:eventId/deposit-actuals', authMiddleware, requirePermission(211, 'add'), EventController.depositActualStore);
router.delete('/event/deposit-actuals/:id', authMiddleware, requirePermission(211, 'delete'), EventController.depositActualDestroy);

// Instructions (nested under event)
router.get('/events/:eventId/instructions', authMiddleware, requirePermission(211, 'view'), EventController.instructionList);
router.post('/events/:eventId/instructions', authMiddleware, requirePermission(211, 'edit'), EventController.instructionSave);

// Singular aliases for instructions
router.get('/event/:eventId/instructions', authMiddleware, requirePermission(211, 'view'), EventController.instructionList);
router.post('/event/:eventId/instructions', authMiddleware, requirePermission(211, 'edit'), EventController.instructionSave);

// Event Management
router.get('/event-managements', authMiddleware, requirePermission(211, 'view'), EventController.managementList);
router.get('/event-management', authMiddleware, requirePermission(211, 'view'), EventController.managementList);
router.get('/event-management-item', authMiddleware, requirePermission(211, 'view'), EventController.itemList);
router.get('/event-management-items', authMiddleware, requirePermission(211, 'view'), EventController.itemList);
router.post('/event-management-item', authMiddleware, requirePermission(211, 'add'), EventController.itemStore);
router.put('/event-management-item/:id', authMiddleware, requirePermission(211, 'edit'), EventController.itemUpdate);
router.delete('/event-management-item/:id', authMiddleware, requirePermission(211, 'delete'), EventController.itemDestroy);

// Event Timeline
router.get('/event-timeline/timeline', authMiddleware, requirePermission(211, 'view'), EventController.timeline);

// Frontend master-* page aliases (TableView only, forms are stubs)
router.get('/master-venue', authMiddleware, requirePermission(211, 'view'), EventController.venueList);
router.get('/master-layout', authMiddleware, requirePermission(211, 'view'), EventController.layoutList);
router.get('/master-inventory', authMiddleware, requirePermission(211, 'view'), EventController.inventoryList);
router.get('/master-capacity', authMiddleware, requirePermission(211, 'view'), EventController.capacityList);

export default router;
