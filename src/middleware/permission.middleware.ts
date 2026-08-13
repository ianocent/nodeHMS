import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../utils/response';
import { PERMISSION_CODES, PermissionAction } from '../config/permissions';
import { RoleMenuCrud } from './auth.middleware';

/**
 * Permission middleware — checks menuId-based CRUD permission.
 * Replicates Laravel HasPermissions::hasCrudPermission().
 *
 * Usage: router.get('/users', requirePermission(1116, 'view'), handler)
 *
 * Super-users (developer/anyaman) bypass all checks.
 */
export function requirePermission(menuId: bigint | number, action: PermissionAction) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      forbidden(res, 'Not authenticated');
      return;
    }

    // Super-user bypass
    if (user.superUser) {
      next();
      return;
    }

    // Check if permission code is active in config
    const permConfig = PERMISSION_CODES[action];
    if (!permConfig) {
      forbidden(res, `Unknown permission '${action}'`);
      return;
    }

    // Check role_menu_crud for this menuId
    const crud = user.permissions.get(BigInt(menuId));
    // Only view/add/edit/delete are stored in role_menu_crud table
    const crudKey = action as keyof RoleMenuCrud;
    if (!crud || !crud[crudKey]) {
      forbidden(res, `Missing '${action}' permission for menu ${menuId}`);
      return;
    }

    next();
  };
}

/**
 * Check transaction-level permission within a menu.
 * Replicates HasPermissions::hasTransactionPermission().
 */
export function requireTransactionPermission(
  menuId: bigint | number,
  transactionAction: string
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      forbidden(res, 'Not authenticated');
      return;
    }
    if (user.superUser) {
      next();
      return;
    }

    const crud = user.permissions.get(BigInt(menuId));
    if (!crud?.transactionActions) {
      forbidden(res, `Missing transaction permission for menu ${menuId}`);
      return;
    }

    // transaction_actions is JSON string: {"can_edit": true, "can_void": false, ...}
    try {
      const actions = JSON.parse(crud.transactionActions);
      if (!actions[transactionAction]) {
        forbidden(res, `Missing transaction action '${transactionAction}' for menu ${menuId}`);
        return;
      }
    } catch {
      forbidden(res, 'Invalid transaction permissions');
      return;
    }

    next();
  };
}

/**
 * Inject permission flags into response (like HasPermissions in formatData).
 * Returns { view, add, edit, delete } for a given menuId.
 */
export function getPermissionFlags(user: Express.Request['user'], menuId: bigint | number) {
  if (!user) return { view: false, add: false, edit: false, delete: false };
  if (user.superUser) return { view: true, add: true, edit: true, delete: true };

  const crud = user.permissions.get(BigInt(menuId));
  return {
    view: crud?.view ?? false,
    add: crud?.add ?? false,
    edit: crud?.edit ?? false,
    delete: crud?.delete ?? false,
  };
}
