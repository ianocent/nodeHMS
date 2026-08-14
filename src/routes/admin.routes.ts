import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { genericController } from '../controllers/generic.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();

// Force logout (public & protected versions)
router.get('/force-logout/:email', authMiddleware, AdminController.forceLogout);
router.get('/force-bulk-logout', authMiddleware, AdminController.forceBulkLogout);

// Menu fix tree
router.get('/fixtree', authMiddleware, AdminController.menuFixTree);

// User listing (Laravel-compatible /user/get-user)
router.get('/user/get-user', authMiddleware, AdminController.userList);
router.get('/user', authMiddleware, AdminController.userList);
router.get('/user/online', authMiddleware, requirePermission(1116, 'view'), AdminController.userList);

// Role routes (menuId: 1117)
router.get('/roles', authMiddleware, requirePermission(1117, 'view'), AdminController.roleList);
router.get('/roles/create', authMiddleware, requirePermission(1117, 'add'), AdminController.roleCreate);
router.post('/roles', authMiddleware, requirePermission(1117, 'add'), AdminController.roleStore);
router.get('/roles/:id', authMiddleware, requirePermission(1117, 'view'), AdminController.roleShow);
router.get('/roles/:id/edit', authMiddleware, requirePermission(1117, 'edit'), AdminController.roleEdit);
router.put('/roles/:id', authMiddleware, requirePermission(1117, 'edit'), AdminController.roleUpdate);
router.delete('/roles/:id', authMiddleware, requirePermission(1117, 'delete'), AdminController.roleDestroy);
router.post('/roles/:id/restore', authMiddleware, requirePermission(1117, 'edit'), AdminController.roleRestore);
router.get('/role/get-role', authMiddleware, requirePermission(1117, 'view'), AdminController.roleList);
router.get('/role/templates', authMiddleware, requirePermission(1117, 'view'), AdminController.roleGetTemplates);
router.post('/role/templates', authMiddleware, requirePermission(1117, 'add'), AdminController.roleUpsertTemplate);
router.put('/role/templates/:id', authMiddleware, requirePermission(1117, 'edit'), AdminController.roleUpsertTemplate);

// Permission routes (menuId: 1118)
router.get('/permissions', authMiddleware, requirePermission(1118, 'view'), AdminController.permissionList);
router.post('/permissions', authMiddleware, requirePermission(1118, 'add'), AdminController.permissionStore);
router.get('/permissions/:id', authMiddleware, requirePermission(1118, 'view'), AdminController.permissionShow);
router.put('/permissions/:id', authMiddleware, requirePermission(1118, 'edit'), AdminController.permissionUpdate);
router.delete('/permissions/:id', authMiddleware, requirePermission(1118, 'delete'), AdminController.permissionDestroy);
router.post('/permissions/:id/restore', authMiddleware, requirePermission(1118, 'edit'), AdminController.permissionRestore);

// Menu routes (menuId: 1115)
router.get('/menus', authMiddleware, requirePermission(1115, 'view'), AdminController.menuList);
router.post('/menus', authMiddleware, requirePermission(1115, 'add'), AdminController.menuStore);
router.get('/menus/:id', authMiddleware, requirePermission(1115, 'view'), AdminController.menuShow);
router.put('/menus/:id', authMiddleware, requirePermission(1115, 'edit'), AdminController.menuUpdate);
router.delete('/menus/:id', authMiddleware, requirePermission(1115, 'delete'), AdminController.menuDestroy);
router.post('/menus/:id/restore', authMiddleware, requirePermission(1115, 'edit'), AdminController.menuRestore);
router.put('/menu/sort', authMiddleware, requirePermission(1115, 'edit'), AdminController.menuSort);
router.get('/list/:slug', authMiddleware, AdminController.menuListBySlug);
router.get('/menu/get-parent-by-id-children', authMiddleware, AdminController.menuGetParentByIdChildren);
router.get('/menu/get-parent-by-id-children/:id', authMiddleware, AdminController.menuGetParentByIdChildren);

// Setting routes
router.get('/settings', authMiddleware, AdminController.settingList);
router.post('/settings', authMiddleware, AdminController.settingStore);
router.get('/check-value', authMiddleware, AdminController.settingCheckValue);

// Task routes
router.get('/tasks', authMiddleware, AdminController.taskList);
router.post('/tasks', authMiddleware, AdminController.taskStore);

// Log routes
router.get('/log', authMiddleware, AdminController.logList);

// FCM Token
router.post('/save-fcm-token', authMiddleware, AdminController.saveFcmToken);
router.post('/user/fcm-token', authMiddleware, AdminController.saveFcmToken);

// Property routes (choose-property page)
router.get('/property', authMiddleware, AdminController.propertyList);
router.get('/property/auth/:id', authMiddleware, AdminController.propertyAuth);
router.get('/property/create', authMiddleware, AdminController.propertyCreate);
router.post('/property', authMiddleware, AdminController.propertyStore);
router.get('/property/:id/update', authMiddleware, AdminController.propertyEdit);
router.put('/property/:id', authMiddleware, AdminController.propertyUpdate);
router.delete('/property/:id', authMiddleware, AdminController.propertyDestroy);

// Singular aliases for permissions
router.get('/permission', authMiddleware, requirePermission(1118, 'view'), AdminController.permissionList);
router.post('/permission', authMiddleware, requirePermission(1118, 'add'), AdminController.permissionStore);
router.get('/permission/:id', authMiddleware, requirePermission(1118, 'view'), AdminController.permissionShow);
router.put('/permission/:id', authMiddleware, requirePermission(1118, 'edit'), AdminController.permissionUpdate);
router.delete('/permission/:id', authMiddleware, requirePermission(1118, 'delete'), AdminController.permissionDestroy);
router.post('/permission/:id/restore', authMiddleware, requirePermission(1118, 'edit'), AdminController.permissionRestore);

// Singular aliases for settings
router.get('/setting', authMiddleware, AdminController.settingList);
router.post('/setting', authMiddleware, AdminController.settingStore);

// Singular aliases for tasks
router.get('/task', authMiddleware, AdminController.taskList);
router.post('/task', authMiddleware, AdminController.taskStore);

// Generic CRUD routes (Phase 5.2)
router.get('/generic/:model', authMiddleware, genericController.list);
router.get('/generic/:model/:id', authMiddleware, genericController.show);
router.post('/generic/:model', authMiddleware, genericController.create);
router.put('/generic/:model/:id', authMiddleware, genericController.update);
router.delete('/generic/:model/:id', authMiddleware, genericController.destroy);
router.post('/generic/:model/:id/restore', authMiddleware, genericController.restore);

// Sidebar routes (singular names for frontend compatibility)
router.get('/menu', authMiddleware, AdminController.menuListAll);
router.get('/role', authMiddleware, AdminController.roleList);
router.get('/role/create', authMiddleware, AdminController.roleCreate);
router.post('/role', authMiddleware, AdminController.roleStore);
router.get('/role/:id', authMiddleware, AdminController.roleShow);
router.get('/role/:id/update', authMiddleware, AdminController.roleEdit);
router.put('/role/:id', authMiddleware, AdminController.roleUpdate);
router.delete('/role/:id', authMiddleware, AdminController.roleDestroy);
router.post('/role/:id/restore', authMiddleware, AdminController.roleRestore);

// All users / roles dropdowns
router.get('/uall', authMiddleware, AdminController.userListAll);
router.get('/rall', authMiddleware, AdminController.roleListAll);

export default router;
