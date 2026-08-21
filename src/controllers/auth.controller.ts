import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, badRequest, unauthorized, validationError } from '../utils/response';
import { TokenService } from '../services/token.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// bcrypt cost factor (matching Laravel default: 10)
const BCRYPT_ROUNDS = 10;

export class AuthController {
  /**
   * POST /api/login
   * Replicates Laravel AuthController@login
   */
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      // Validation
      if (!password) {
        validationError(res, { password: ['The password field is required.'] });
        return;
      }

      // Detect email vs username (like Laravel's FILTER_VALIDATE_EMAIL)
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
      const where = isEmail
        ? { email: email, status: 1 }
        : { username: email || '', status: 1 };

      // Find user
      const user = await prisma.users.findFirst({ where });
      if (!user) {
        badRequest(res, 'Invalid input');
        return;
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        badRequest(res, 'Invalid input');
        return;
      }

      // Revoke any existing tokens for this user (Laravel token rotation on login)
      // Then allow login — old token will be replaced with new one
      await TokenService.revokeAllUserTokens(user.id);

      // Record last login (matches Laravel $user->last_login_at = now())
      await prisma.users.update({
        where: { id: user.id },
        data: { last_login_at: new Date() },
      });

      // Get user roles
      const modelRoles = await prisma.model_has_roles.findMany({
        where: {
          model_type: 'App\\Models\\User',
          model_id: user.id,
        },
        include: { roles: true },
      });

      const roleNames = modelRoles.map(mr => mr.roles.name);
      const roleIds = modelRoles.map(mr => mr.roles.id);

      if (roleNames.length === 0) {
        badRequest(res, 'Role not found');
        return;
      }

      // Generate token
      const { plainTextToken, createdAt } = await TokenService.createToken(
        user.id,
        user.email
      );

      const data = await AuthController.buildLoginData(
        user,
        roleIds,
        roleNames,
        plainTextToken,
        createdAt,
        user.last_property
      );

      success(res, data, 'Success');
    } catch (err: any) {
      console.error('Login error:', err);
      badRequest(res, 'Login failed');
    }
  }

  /**
   * Build the login payload (name, role, username, email, access_token,
   * expires_token, force_change_password, is_shift, is_need_shift,
   * bussinesDate, permissions). Matches Laravel AuthController@login payload.
   * Shared by login, changePassword and PropertyController@auth (node).
   */
  static async buildLoginData(
    user: any,
    roleIds: bigint[],
    roleNames: string[],
    plainTextToken: string,
    createdAt: Date,
    propertyId: bigint | null
  ): Promise<Record<string, any>> {
    const permissions = await AuthController.buildPermissionTree(user.id, roleIds, roleNames);
    const businessDate = await AuthController.getBusinessDate(propertyId);
    const isShift = await AuthController.getShiftStatus(user.id, propertyId, businessDate);
    const isNeedShift = await AuthController.getNeedShift(roleIds);

    return {
      name: user.name,
      role: roleNames,
      username: user.username,
      email: user.email,
      access_token: plainTextToken,
      expires_token: createdAt.toISOString().replace('T', ' ').substring(0, 19),
      force_change_password: !!user.force_change_password,
      is_shift: isShift,
      is_need_shift: isNeedShift,
      bussinesDate: businessDate,
      permissions,
    };
  }

  /**
   * POST /api/logout
   * Replicates Laravel AuthController@logout
   */
  static async logout(req: Request, res: Response): Promise<void> {
    try {
      // Laravel reads the token from Authorization: Bearer (request->bearerToken);
      // X-Token is accepted as a fallback for the native apps
      const tokenHeader = AuthController.getTokenHeader(req);
      if (!tokenHeader) {
        unauthorized(res, 'Invalid token');
        return;
      }

      // Find token
      const tokenRecord = await TokenService.findToken(tokenHeader);
      if (!tokenRecord) {
        unauthorized(res, 'Invalid token');
        return;
      }

      // Clear FCM token
      await TokenService.clearFcmToken(tokenRecord.tokenable_id);

      // Delete ALL user tokens (matches Laravel behavior)
      await TokenService.revokeAllUserTokens(tokenRecord.tokenable_id);

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Logout error:', err);
      badRequest(res, 'Logout failed');
    }
  }

  /**
   * POST /api/refresh
   * Replicates Laravel Sanctum token refresh
   * Returns new token, revokes old one
   */
  static async refresh(req: Request, res: Response): Promise<void> {
    try {
      // Laravel reads the token from Authorization: Bearer; X-Token fallback
      const tokenHeader = AuthController.getTokenHeader(req);
      if (!tokenHeader) {
        unauthorized(res, 'Token not provided');
        return;
      }

      // Find and validate current token
      const tokenRecord = await TokenService.findToken(tokenHeader);
      if (!tokenRecord) {
        unauthorized(res, 'Invalid token');
        return;
      }

      // Get user
      const user = await prisma.users.findUnique({
        where: { id: tokenRecord.tokenable_id },
      });
      if (!user || user.status === 0) {
        unauthorized(res, 'User not found or inactive');
        return;
      }

      // Get user roles
      const modelRoles = await prisma.model_has_roles.findMany({
        where: {
          model_type: 'App\\Models\\User',
          model_id: user.id,
        },
        include: { roles: true },
      });

      const roleNames = modelRoles.map(mr => mr.roles.name);
      const roleIds = modelRoles.map(mr => mr.roles.id);

      if (roleNames.length === 0) {
        badRequest(res, 'Role not found');
        return;
      }

      // Revoke old token
      await TokenService.revokeToken(tokenRecord.id);

      // Create new token
      const { plainTextToken, createdAt } = await TokenService.createToken(
        user.id,
        user.email
      );

      // Build permission tree
      const permissions = await AuthController.buildPermissionTree(
        user.id,
        roleIds,
        roleNames
      );

      // Shift + business date (same fields as login response)
      const businessDate = await AuthController.getBusinessDate(user.last_property);
      const isShift = await AuthController.getShiftStatus(user.id, user.last_property, businessDate);
      const isNeedShift = await AuthController.getNeedShift(roleIds);

      success(res, {
        name: user.name,
        role: roleNames,
        username: user.username,
        email: user.email,
        access_token: plainTextToken,
        expires_token: createdAt.toISOString().replace('T', ' ').substring(0, 19),
        force_change_password: user.force_change_password,
        is_shift: isShift,
        is_need_shift: isNeedShift,
        bussinesDate: businessDate,
        permissions,
      }, 'Success');
    } catch (err: any) {
      console.error('Refresh error:', err);
      badRequest(res, 'Token refresh failed');
    }
  }

  /**
   * POST /api/change-password
   * Replicates Laravel AuthController@changePassword
   */
  static async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const { current_password, new_password } = req.body;
      const authUser = req.user;

      if (!authUser) {
        unauthorized(res);
        return;
      }

      // Validation
      if (!current_password || !new_password) {
        validationError(res, {
          current_password: current_password ? undefined : ['required'],
          new_password: new_password ? undefined : ['required'],
        });
        return;
      }

      // Fetch fresh user
      const user = await prisma.users.findUnique({ where: { id: authUser.id } });
      if (!user) {
        badRequest(res, 'Invalid input');
        return;
      }

      // Verify current password
      const valid = await bcrypt.compare(current_password, user.password);
      if (!valid) {
        badRequest(res, 'Invalid input');
        return;
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(new_password, BCRYPT_ROUNDS);

      // Update user
      await prisma.users.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          password_changed_at: new Date(),
          force_change_password: false,
        },
      });

      // Get property for ability scope
      const propertyId = authUser.lastProperty || 0;
      const property = await prisma.properties.findUnique({
        where: { id: propertyId },
        select: { name: true, logo: true },
      });

      // Get user roles
      const modelRoles = await prisma.model_has_roles.findMany({
        where: {
          model_type: 'App\\Models\\User',
          model_id: user.id,
        },
        include: { roles: true },
      });
      const roleNames = modelRoles.map(mr => mr.roles.name);
      const roleIds = modelRoles.map(mr => mr.roles.id);

      // Revoke old tokens, create new one
      await TokenService.revokeAllUserTokens(user.id);
      const { plainTextToken, createdAt } = await TokenService.createToken(
        user.id,
        user.email,
        [`can-${propertyId}`]
      );

      // Business date + shift status (matches Laravel changePassword response)
      const businessDate = await AuthController.getBusinessDate(propertyId === 0 ? null : propertyId);
      const isShift = await AuthController.getShiftStatus(user.id, propertyId === 0 ? null : propertyId, businessDate);
      const isNeedShift = await AuthController.getNeedShift(roleIds);

      success(res, {
        name: user.name,
        role: roleNames,
        username: user.username,
        email: user.email,
        access_token: plainTextToken,
        expires_token: createdAt.toISOString().replace('T', ' ').substring(0, 19),
        force_change_password: false,
        is_shift: isShift,
        is_need_shift: isNeedShift,
        bussinesDate: businessDate,
        property_name: property?.name ?? '',
        property_image: property?.logo ? `/storage/${property.logo}` : null,
      }, 'Success');
    } catch (err: any) {
      console.error('Change password error:', err);
      badRequest(res, 'Change password failed');
    }
  }

  /**
   * POST /api/force-logout/:email
   * Replicates Laravel AuthController@forceLogout — revokes ALL tokens of a user.
   */
  static async forceLogout(req: Request, res: Response): Promise<void> {
    try {
      const email = String(req.params.email || '').trim();
      const user = await prisma.users.findFirst({ where: { email } });

      if (!user) {
        badRequest(res, 'User not found');
        return;
      }

      await TokenService.revokeAllUserTokens(user.id);

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Force logout error:', err);
      badRequest(res, 'Force logout failed');
    }
  }

  /**
   * GET/POST /api/force-bulk-logout
   * Replicates Laravel AuthController@forceBulkLogout — revokes tokens of all
   * users sharing the same last_property (except the caller).
   */
  static async forceBulkLogout(req: Request, res: Response): Promise<void> {
    try {
      const tokenHeader = AuthController.getTokenHeader(req);
      const tokenRecord = tokenHeader ? await TokenService.findToken(tokenHeader) : null;

      if (!tokenRecord) {
        unauthorized(res, 'Invalid token');
        return;
      }

      const user = await prisma.users.findUnique({
        where: { id: tokenRecord.tokenable_id },
      });

      if (!user) {
        unauthorized(res, 'Invalid token');
        return;
      }

      const users = await prisma.users.findMany({
        where: {
          last_property: user.last_property,
          id: { not: user.id },
        },
        select: { id: true },
      });

      for (const u of users) {
        await TokenService.revokeAllUserTokens(u.id);
      }

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Force bulk logout error:', err);
      badRequest(res, 'Force bulk logout failed');
    }
  }

  /**
   * POST /api/forget-password
   * Replicates Laravel AuthController@forgetPassword
   */
  static async forgetPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        validationError(res, { email: ['The email field is required.'] });
        return;
      }

      const user = await prisma.users.findFirst({
        where: { email, status: 1 },
      });

      if (!user) {
        badRequest(res, 'Email not found');
        return;
      }

      // Generate UUID token
      const token = crypto.randomUUID();

      // Save token to user (using password_change_token concept)
      // Note: Laravel uses a dedicated column. We store in fcm_token temporarily
      // In production, add a password_change_token column to users table
      await prisma.users.update({
        where: { id: user.id },
        data: {
          // TODO: add password_change_token column to users table
          // For now, send token in response for testing
          updated_at: new Date(),
        },
      });

      // TODO: send email with reset link
      // For now, return the token directly (development mode)
      success(res, {
        token,
        message: `Password reset token: ${token}. In production, this would be emailed.`,
      }, 'Success');
    } catch (err: any) {
      console.error('Forget password error:', err);
      badRequest(res, 'Password reset failed');
    }
  }

  /**
   * Read the Sanctum token from X-Token header or Authorization: Bearer.
   * Matches Laravel's request->bearerToken() with native-app fallback.
   */
  private static getTokenHeader(req: Request): string | undefined {
    const xToken = req.headers['x-token'] as string | undefined;
    if (xToken) return xToken;

    const authHeader = req.headers['authorization'] as string | undefined;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

    return undefined;
  }

  /**
   * Business date: latest log_audits.date for the property + 1 day.
   * Matches LogAudit::getBusinessDate($request).
   * Laravel SoftDeletes adds deleted_at IS NULL automatically.
   */
  static async getBusinessDate(lastProperty: bigint | null): Promise<string> {
    console.log('[getBusinessDate] Input lastProperty:', lastProperty, typeof lastProperty);
    
    const logAudit = await prisma.log_audits.findFirst({
      where: {
        deleted_at: null,
        ...(lastProperty ? { property_id: Number(lastProperty) } : {}),
      },
      orderBy: { date: 'desc' },
    });

    console.log('[getBusinessDate] Found logAudit:', logAudit ? { id: logAudit.id, property_id: logAudit.property_id, date: logAudit.date } : null);

    if (logAudit) {
      const [y, m, d] = logAudit.date.toISOString().substring(0, 10).split('-').map(Number);
      const result = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().substring(0, 10);
      console.log('[getBusinessDate] Returning:', result);
      return result;
    }

    // Asia/Jakarta (UTC+7, no DST) — Laravel config/app.php 'timezone'
    const fallback = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().substring(0, 10);
    console.log('[getBusinessDate] Fallback to current date:', fallback);
    return fallback;
  }

  /**
   * is_shift: user has an open shift for the business date.
   * Matches Laravel $user->shifts()->where('date', $date)->whereNull('end').
   */
  private static async getShiftStatus(
    userId: bigint,
    propertyId: bigint | null,
    businessDate: string
  ): Promise<boolean> {
    const start = new Date(businessDate + 'T00:00:00Z');
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const count = await prisma.shifts.count({
      where: {
        user_id: userId,
        ...(propertyId ? { property_id: propertyId } : {}),
        date: { gte: start, lt: end },
        end: null,
        deleted_at: null,
      },
    });
    return count > 0;
  }

  /**
   * is_need_shift: any of the user's roles is assigned a menu with
   * visibility = 'transaction'. Matches Laravel $role?->menu?->where('visibility', 'transaction').
   */
  private static async getNeedShift(roleIds: bigint[]): Promise<boolean> {
    const count = await prisma.model_has_menus.count({
      where: {
        model_type: 'App\\Models\\Role',
        model_id: { in: roleIds },
        menus: { visibility: 'transaction' },
      },
    });
    return count > 0;
  }

  /**
   * Build permission tree matching Laravel User::formatData()['permissions']
   * Returns menu tree with isaccess flags and CRUD booleans.
   */
  private static async buildPermissionTree(
    userId: bigint,
    roleIds: bigint[],
    roleNames: string[]
  ): Promise<any[]> {
    // Get CRUD permissions for all user roles
    const crudRecords = await prisma.role_menu_crud.findMany({
      where: { role_id: { in: roleIds } },
    });

    // Merge CRUD across roles
    const crudMap = new Map<bigint, any>();
    for (const r of crudRecords) {
      const existing = crudMap.get(r.menu_id);
      crudMap.set(r.menu_id, {
        view: (existing?.view || r.view) as boolean,
        add: (existing?.add || r.add) as boolean,
        edit: (existing?.edit || r.edit) as boolean,
        delete: (existing?.delete || r.delete) as boolean,
        transaction_actions: r.transaction_actions ? JSON.parse(r.transaction_actions) : {},
      });
    }

    // Get menus assigned to user (via model_has_menus)
    const assignedMenus = await prisma.model_has_menus.findMany({
      where: {
        model_type: 'App\\Models\\User',
        model_id: userId,
      },
    });
    const assignedMenuIds = new Set(assignedMenus.map(m => m.menu_id));

    // Get full menu tree (nested sets) — excluding menus Laravel hides
    // (formatData: where('id', '!=', [15, 5, 6, 14]))
    const allMenus = (await prisma.menus.findMany({
      orderBy: [{ left: 'asc' }],
    })).filter(m => ![5, 6, 14, 15].includes(Number(m.id)));

    // Build tree: parent-level nodes, each with access[] children
    const tree = AuthController.buildMenuTree(
      allMenus,
      null, // root nodes have parent_id = null
      assignedMenuIds,
      crudMap
    );

    // Laravel filters out menu 52 from the final output
    return tree.filter(p => Number(p.value) !== 52);
  }

  /**
   * Recursively build menu tree nodes.
   * Replicates Laravel's formatData() recursion.
   */
  private static buildMenuTree(
    menus: any[],
    parentId: bigint | null,
    assignedMenuIds: Set<bigint>,
    crudMap: Map<bigint, any>
  ): any[] {
    return menus
      .filter(m => m.parent_id === parentId)
      .map(menu => {
        // isaccess = menu assigned to user (Laravel: in_array($id, $assignedMenuIds))
        const isAccess = assignedMenuIds.has(menu.id);
        const crud = crudMap.get(menu.id);

        // Parse name (JSON field with en/id translations) — Laravel uses name['en']
        let label = menu.name;
        try {
          const parsed = typeof label === 'string' ? JSON.parse(label) : label;
          label = parsed?.en || parsed?.id || menu.name;
        } catch {}

        // Laravel: str($name['en'])->title()->replace(['-', '_'], ' ') then explode('.')
        const titled = String(label).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const words = titled.split('.');

        const children = AuthController.buildMenuTree(
          menus,
          menu.id,
          assignedMenuIds,
          crudMap
        );

        return {
          key: words,
          value: Number(menu.id),
          label: words,
          isaccess: isAccess,
          ...(children.length > 0 ? {
            access: children.map(child => {
              const childCrud = crudMap.get(BigInt(child.value));
              return {
                label: Array.isArray(child.label) ? child.label[child.label.length - 1] : child.label,
                value: child.value,
                isaccess: child.isaccess,
                crud: childCrud
                  ? {
                      view: !!childCrud.view,
                      add: !!childCrud.add,
                      edit: !!childCrud.edit,
                      delete: !!childCrud.delete,
                    }
                  : { view: false, add: false, edit: false, delete: false },
                transaction_actions: childCrud?.transaction_actions || {},
              };
            }),
          } : {}),
        };
      });
  }
}
