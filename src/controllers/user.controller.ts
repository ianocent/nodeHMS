import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bigintToNumber(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

const BCRYPT_ROUNDS = 10;
const STATUS = { active: 1, inactive: 0 };

export class UserController {
  /**
   * GET /api/users
   * List users with pagination, search, sort
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string || 'id';
      const order = req.query.order === 'desc' ? 'desc' : 'asc';
      const propertyId = req.user?.lastProperty;

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ];
      }

      const isSuperUser = req.user?.superUser || false;
      if (!isSuperUser && propertyId) {
        where.last_property = propertyId;
      }

      const [users, total] = await Promise.all([
        prisma.users.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.users.count({ where })
      ]);

      // Get roles for each user via model_has_roles
      const userIds = users.map(u => u.id);
      const modelRoles = await prisma.model_has_roles.findMany({
        where: { model_id: { in: userIds }, model_type: 'App\\Models\\User' },
        include: { roles: true }
      });

      const rolesMap = new Map<bigint, any[]>();
      for (const mr of modelRoles) {
        if (!rolesMap.has(mr.model_id)) rolesMap.set(mr.model_id, []);
        rolesMap.get(mr.model_id)!.push(mr.roles);
      }

      // Format users with roles
      const formattedUsers = users.map(u => ({
        ...u,
        id: Number(u.id),
        roles: rolesMap.get(u.id) || [],
        last_property: u.last_property ? Number(u.last_property) : null
      }));

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Username', key: 'username', type: 'none', is_search: true },
        { label: 'Email', key: 'email', type: 'none', is_search: true },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Role', key: 'roles', type: 'none', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      const permFlags = getPermissionFlags(req.user, 1116);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete
      };

      success(res, bigintToNumber(formattedUsers), 'Success', 200, {
        table,
        permission,
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total)
        }
      });
    } catch (err: any) {
      console.error('User list error:', err);
      error(res, 'Failed to fetch users', 500);
    }
  }

  /**
   * GET /api/users/create
   * Get master data for user creation form
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const [companies, properties, roles] = await Promise.all([
        prisma.companies.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.properties.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.roles.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } })
      ]);

      const master = {
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        properties: properties.map((p: any) => ({ value: Number(p.id), label: p.name })),
        roles: roles.map((r: any) => ({ value: Number(r.id), label: r.name })),
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ]
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('User create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /api/users
   * Create new user
   */
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const { company_id, property_ids, role_id, name, username, email, phone, password, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!company_id) errors.company_id = ['The company id field is required.'];
      if (!role_id) errors.role_id = ['The role id field is required.'];
      if (!name) errors.name = ['The name field is required.'];
      if (!username) errors.username = ['The username field is required.'];
      if (!email) errors.email = ['The email field is required.'];
      if (!password) errors.password = ['The password field is required.'];

      const existing = await prisma.users.findFirst({
        where: { OR: [{ username }, { email }], deleted_at: null }
      });
      if (existing) {
        if (existing.username === username) errors.username = ['The username has already been taken.'];
        if (existing.email === email) errors.email = ['The email has already been taken.'];
      }

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const user = await prisma.users.create({
        data: {
          name,
          username,
          email,
          phone,
          password: hashedPassword,
          status: status || STATUS.active,
          email_verified_at: new Date(),
          remember_token: require('crypto').randomBytes(30).toString('hex'),
          last_property: property_ids?.[0] || req.user?.lastProperty
        }
      });

      // Create role assignment
      if (role_id) {
        await prisma.model_has_roles.create({
          data: { role_id: BigInt(role_id), model_id: user.id, model_type: 'App\\Models\\User' }
        });
      }

      // Create property assignments
      if (property_ids?.length) {
        for (const pid of property_ids) {
          await prisma.model_has_menus.create({
            data: { model_id: user.id, model_type: 'App\\Models\\User', menu_id: pid }
          });
        }
      }

      // Create company assignment
      if (company_id) {
        await prisma.model_has_company_profiles.create({
          data: { model_id: user.id, model_type: 'App\\Models\\User', company_profile_id: BigInt(company_id) }
        });
      }

      if (req.body.pin_enshift) {
        await prisma.users.update({
          where: { id: user.id },
          data: { pin_enshift: req.body.pin_enshift }
        });
      }

      const created = await prisma.users.findUnique({ where: { id: user.id } });
      success(res, bigintToNumber({ ...created!, id: Number(created!.id) }), 'Success', 200);
    } catch (err: any) {
      console.error('User store error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Username or email already exists');
      } else {
        error(res, 'Failed to create user', 500);
      }
    }
  }

  /**
   * GET /api/users/:id
   * Show single user
   */
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const user = await prisma.users.findUnique({ where: { id } });

      if (!user || user.deleted_at) {
        notFound(res, 'User not found');
        return;
      }

      const modelRoles = await prisma.model_has_roles.findMany({
        where: { model_id: id, model_type: 'App\\Models\\User' },
        include: { roles: true }
      });

      success(res, bigintToNumber({ ...user, id: Number(user.id), roles: modelRoles.map((mr: any) => mr.roles) }), 'Success');
    } catch (err: any) {
      console.error('User show error:', err);
      error(res, 'Failed to fetch user', 500);
    }
  }

  /**
   * GET /api/users/:id/edit
   * Get user with master data for edit form
   */
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const [user, companies, properties, roles, modelRoles] = await Promise.all([
        prisma.users.findUnique({ where: { id } }),
        prisma.companies.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.properties.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.roles.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.model_has_roles.findMany({
          where: { model_id: id, model_type: 'App\\Models\\User' },
          include: { roles: true }
        })
      ]);

      if (!user || user.deleted_at) {
        notFound(res, 'User not found');
        return;
      }

      const master = {
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        properties: properties.map((p: any) => ({ value: Number(p.id), label: p.name })),
        roles: roles.map((r: any) => ({ value: Number(r.id), label: r.name })),
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' }
        ]
      };

      success(res, bigintToNumber({ ...user, id: Number(user.id), roles: modelRoles.map((mr: any) => mr.roles), master }), 'Success');
    } catch (err: any) {
      console.error('User edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /api/users/:id
   * Update user
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const { company_id, property_ids, role_id, name, username, email, phone, password, status, pin_enshift } = req.body;

      const user = await prisma.users.findUnique({ where: { id } });
      if (!user || user.deleted_at) {
        notFound(res, 'User not found');
        return;
      }

      const errors: Record<string, string[]> = {};
      if (!company_id) errors.company_id = ['The company id field is required.'];
      if (!role_id) errors.role_id = ['The role id field is required.'];
      if (!name) errors.name = ['The name field is required.'];
      if (!username) errors.username = ['The username field is required.'];
      if (!email) errors.email = ['The email field is required.'];
      if (!status) errors.status = ['The status field is required.'];

      const existing = await prisma.users.findFirst({
        where: { OR: [{ username }, { email }], id: { not: id }, deleted_at: null }
      });
      if (existing) {
        if (existing.username === username) errors.username = ['The username has already been taken.'];
        if (existing.email === email) errors.email = ['The email has already been taken.'];
      }

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const data: any = {
        name,
        username,
        email,
        phone,
        status: Array.isArray(status) ? (status[0]?.value || STATUS.active) : status
      };

      if (password) {
        data.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
        data.password_changed_at = new Date();
        data.force_change_password = false;
      }

      if (pin_enshift !== undefined) {
        data.pin_enshift = pin_enshift;
      }

      await prisma.users.update({ where: { id }, data });

      // Sync properties
      if (property_ids?.length) {
        await prisma.model_has_menus.deleteMany({ where: { model_id: id, model_type: 'App\\Models\\User' } });
        for (const pid of property_ids) {
          await prisma.model_has_menus.create({
            data: { model_id: id, model_type: 'App\\Models\\User', menu_id: pid }
          });
        }
      }

      // Sync companies
      if (company_id) {
        await prisma.model_has_company_profiles.deleteMany({ where: { model_id: id, model_type: 'App\\Models\\User' } });
        await prisma.model_has_company_profiles.create({
          data: { model_id: id, model_type: 'App\\Models\\User', company_profile_id: BigInt(company_id) }
        });
      }

      // Update role
      if (role_id) {
        await prisma.model_has_roles.deleteMany({ where: { model_id: id, model_type: 'App\\Models\\User' } });
        await prisma.model_has_roles.create({
          data: { role_id: BigInt(role_id), model_id: id, model_type: 'App\\Models\\User' }
        });
      }

      const updated = await prisma.users.findUnique({ where: { id } });
      const modelRoles = await prisma.model_has_roles.findMany({
        where: { model_id: id, model_type: 'App\\Models\\User' },
        include: { roles: true }
      });

      success(res, bigintToNumber({ ...updated!, id: Number(updated!.id), roles: modelRoles.map((mr: any) => mr.roles) }), 'Success');
    } catch (err: any) {
      console.error('User update error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Username or email already exists');
      } else {
        error(res, 'Failed to update user', 500);
      }
    }
  }

  /**
   * DELETE /api/users/:id
   * Soft delete user
   */
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const user = await prisma.users.findUnique({ where: { id } });

      if (!user) {
        notFound(res, 'User not found');
        return;
      }

      await prisma.users.update({
        where: { id },
        data: { deleted_at: new Date(), status: 0 }
      });

      await prisma.personal_access_tokens.deleteMany({
        where: { tokenable_id: id, tokenable_type: 'App\\Models\\User' }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('User destroy error:', err);
      error(res, 'Failed to delete user', 500);
    }
  }

  /**
   * POST /api/users/:id/restore
   * Restore soft-deleted user
   */
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const user = await prisma.users.findUnique({ where: { id } });

      if (!user) {
        notFound(res, 'User not found');
        return;
      }

      await prisma.users.update({
        where: { id },
        data: { deleted_at: null, status: 0 }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('User restore error:', err);
      error(res, 'Failed to restore user', 500);
    }
  }

  /**
   * GET /api/users/online/list
   * List online users (active tokens)
   */
  static async onlineList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty;

      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

      const where: any = {
        last_used_at: { gte: thirtyMinAgo },
        tokenable_type: 'App\\Models\\User'
      };

      const tokens = await prisma.personal_access_tokens.findMany({
        where,
        orderBy: { last_used_at: 'desc' }
      });

      // Get user IDs and fetch users
      const userIds = tokens.map(t => t.tokenable_id);
      const users = await prisma.users.findMany({
        where: { id: { in: userIds } }
      });

      // Get roles for these users
      const modelRoles = await prisma.model_has_roles.findMany({
        where: { model_id: { in: userIds }, model_type: 'App\\Models\\User' },
        include: { roles: true }
      });

      const rolesMap = new Map<bigint, any[]>();
      for (const mr of modelRoles) {
        if (!rolesMap.has(mr.model_id)) rolesMap.set(mr.model_id, []);
        rolesMap.get(mr.model_id)!.push(mr.roles);
      }

      const userMap = new Map(users.map(u => [u.id, u]));

      const onlineUsers = tokens.map(t => {
        const user = userMap.get(t.tokenable_id);
        return {
          name: user?.name || '',
          email: user?.email || '',
          roles: rolesMap.get(t.tokenable_id)?.map((r: any) => r.name).join(', ') || '',
          last_login: t.last_used_at
        };
      });

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        { label: 'Email', key: 'email', type: 'none', is_search: false },
        { label: 'Roles', key: 'roles', type: 'none', is_search: false },
        { label: 'Last Login', key: 'last_login', type: 'none', is_search: false }
      ];

      success(res, onlineUsers, 'Success', 200, {
        table,
        pagging: {
          current_page: page,
          last_page: Math.ceil(onlineUsers.length / limit),
          per_page: limit,
          total: onlineUsers.length,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, onlineUsers.length)
        }
      });
    } catch (err: any) {
      console.error('Online users error:', err);
      error(res, 'Failed to fetch online users', 500);
    }
  }

  /**
   * GET /api/users/simple/list
   * Simple user list for dropdowns
   */
  static async simpleList(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const search = req.query.search as string;

      const where: any = { deleted_at: null, status: 1 };
      if (propertyId) where.last_property = propertyId;
      if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }];

      const users = await prisma.users.findMany({
        where,
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
      });

      const data = users.map(u => ({ id: Number(u.id), name: u.name, email: u.email }));
      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        { label: 'Email', key: 'email', type: 'none', is_search: false }
      ];

      success(res, data, 'Success', 200, { table });
    } catch (err: any) {
      console.error('Simple user list error:', err);
      error(res, 'Failed to fetch users', 500);
    }
  }

  /**
   * GET /api/users/all/list
   * All users for dropdown (no pagination)
   */
  static async listAll(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const where: any = { deleted_at: null, status: 1 };
      if (propertyId) where.last_property = propertyId;

      const users = await prisma.users.findMany({
        where,
        select: { id: true, name: true, username: true },
        orderBy: { name: 'asc' }
      });

      success(res, users.map(u => ({ id: Number(u.id), name: u.name, username: u.username })), 'Success');
    } catch (err: any) {
      console.error('List all users error:', err);
      error(res, 'Failed to fetch users', 500);
    }
  }
}