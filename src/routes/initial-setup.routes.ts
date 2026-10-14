import { Router } from 'express';
import * as InitialSetup from '../controllers/initial-setup.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

/**
 * INITIAL SETUP (menuId 1200)
 *
 * Run once per newly joined property: clone the master setup from a reference
 * property, then fill in whatever the clone did not cover.
 */
const router = Router();

// menu 1200 - Initial Setup
router.get('/initial-setup/properties', authMiddleware, requirePermission(1200, 'view'), InitialSetup.properties);
router.get('/initial-setup/tags', authMiddleware, requirePermission(1200, 'view'), InitialSetup.tags);
router.get('/initial-setup/room-types', authMiddleware, requirePermission(1200, 'view'), InitialSetup.roomTypeList);
router.get('/initial-setup/overview', authMiddleware, requirePermission(1200, 'view'), InitialSetup.overview);
router.get('/initial-setup/checklist', authMiddleware, requirePermission(1200, 'view'), InitialSetup.checklist);
router.get('/initial-setup/templates', authMiddleware, requirePermission(1200, 'view'), InitialSetup.templates);
router.get('/initial-setup/scripts', authMiddleware, requirePermission(1200, 'view'), InitialSetup.scripts);
router.get('/initial-setup/audit', authMiddleware, requirePermission(1200, 'view'), InitialSetup.audit);

// writes
router.post('/initial-setup/room-types', authMiddleware, requirePermission(1200, 'edit'), InitialSetup.roomTypeStore);
router.post('/initial-setup/room-types/from-groupings', authMiddleware, requirePermission(1200, 'edit'), InitialSetup.roomTypesFromGroupings);
router.post('/initial-setup/clone', authMiddleware, requirePermission(1200, 'edit'), InitialSetup.clone);
router.post('/initial-setup/bulk-upsert', authMiddleware, requirePermission(1200, 'edit'), InitialSetup.bulkUpsert);
router.post('/initial-setup/generate-rooms', authMiddleware, requirePermission(1200, 'edit'), InitialSetup.generateRooms);
router.post('/initial-setup/scripts/:id/run', authMiddleware, requirePermission(1200, 'edit'), InitialSetup.runScript);
router.post('/initial-setup/schema-cache/refresh', authMiddleware, requirePermission(1200, 'edit'), InitialSetup.refreshSchemaCache);

export default router;
