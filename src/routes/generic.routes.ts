import { Router } from 'express';
import { GenericController } from '../controllers/generic.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';

const router = Router();
const ctrl = new GenericController();

// All generic routes require authentication
router.use(authMiddleware);

// Generic CRUD for any model — mounted at /generic/:model
// GET    /generic/:model              → list (paginated, searchable, sortable)
// POST   /generic/:model              → create
// GET    /generic/:model/:id          → show
// PUT    /generic/:model/:id          → update
// DELETE /generic/:model/:id          → destroy (soft delete)
// POST   /generic/:model/:id/restore  → restore (undo soft delete)

router.get('/:model', ctrl.list.bind(ctrl));
router.post('/:model', ctrl.create.bind(ctrl));
router.get('/:model/:id', ctrl.show.bind(ctrl));
router.put('/:model/:id', ctrl.update.bind(ctrl));
router.delete('/:model/:id', ctrl.destroy.bind(ctrl));
router.post('/:model/:id/restore', ctrl.restore.bind(ctrl));

export default router;