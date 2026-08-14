import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { TABLES, laravelPaging } from '../utils/tableMeta';

const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
const adminAdapter = new PrismaPg(adminPool);
const adminPrisma = new PrismaClient({ adapter: adminAdapter });

function getPrisma() {
  return adminPrisma;
}

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function parsePagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 10;
  const search = query.search as string;
  const sort = query.sort as string || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  return { page, limit, search, sort, order };
}

export class AdminController {

  // ================================================================
  //  ROLE
  // ================================================================
  static async roleList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.name = { contains: search, mode: 'insensitive' }; }

      const [data, total] = await Promise.all([
        getPrisma().roles.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().roles.count({ where }),
      ]);

      const permFlags = getPermissionFlags(req.user, 1117);
      const rows = bigintToNumber(data).map((r: any, i: number) => ({ ...r, no: (page - 1) * limit + i + 1 }));
      success(res, rows, 'Success', 200, {
        table: TABLES.role,
        permission: {
          view: true, add: req.user?.superUser || permFlags.add,
          edit: req.user?.superUser || permFlags.edit, delete: req.user?.superUser || permFlags.delete,
        },
        pagging: laravelPaging(total, limit, page),
      });
    } catch (err: any) { console.error('Role list error:', err); error(res, 'Failed to list roles', 500); }
  }

  static async roleShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const role = await getPrisma().roles.findUnique({ where: { id } });
      if (!role) { notFound(res, 'Role not found'); return; }
      success(res, bigintToNumber(role), 'Success');
    } catch (err: any) { error(res, 'Failed to load role', 500); }
  }

  static async roleCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const [menus, templates] = await Promise.all([
        getPrisma().menus.findMany({ where: { status: 1, deleted_at: null }, orderBy: [{ left: 'asc' }] }),
        getPrisma().role_templates.findMany({ where: { property_id: pid, is_active: true }, orderBy: { sort: 'asc' } }),
      ]);
      success(res, { menus: bigintToNumber(menus), templates: bigintToNumber(templates) }, 'Success');
    } catch (err: any) { error(res, 'Failed to load form data', 500); }
  }

  static async roleStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { name, display_name, guard_name, status, menu_cruds } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const role = await getPrisma().roles.create({
        data: {
          property_id: pid, name, display_name: display_name || null,
          guard_name: guard_name || 'web', status: status ?? 1,
          created_at: new Date(), updated_at: new Date(), created_by: req.user?.id,
        },
      });

      if (menu_cruds && Array.isArray(menu_cruds)) {
        for (const mc of menu_cruds) {
          await getPrisma().role_menu_crud.create({
            data: {
              role_id: role.id, menu_id: BigInt(mc.menu_id),
              view: mc.view ?? false, add: mc.add ?? false, edit: mc.edit ?? false, delete: mc.delete ?? false,
              transaction_actions: mc.transaction_actions || null,
            },
          });
        }
      }

      success(res, bigintToNumber(role), 'Role created');
    } catch (err: any) { console.error('Role store error:', err); error(res, 'Failed to create role', 500); }
  }

  static async roleEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const [role, menus, templates, menuCruds] = await Promise.all([
        getPrisma().roles.findUnique({ where: { id } }),
        getPrisma().menus.findMany({ where: { status: 1, deleted_at: null }, orderBy: [{ left: 'asc' }] }),
        getPrisma().role_templates.findMany({ where: { property_id: pid, is_active: true }, orderBy: { sort: 'asc' } }),
        getPrisma().role_menu_crud.findMany({ where: { role_id: id } }),
      ]);
      if (!role) { notFound(res, 'Role not found'); return; }
      success(res, { ...bigintToNumber(role), menus, templates: bigintToNumber(templates), menu_cruds: bigintToNumber(menuCruds) }, 'Success');
    } catch (err: any) { error(res, 'Failed to load role', 500); }
  }

  static async roleUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { name, display_name, guard_name, status, menu_cruds } = req.body;
      const existing = await getPrisma().roles.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Role not found'); return; }

      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (name !== undefined) data.name = name;
      if (display_name !== undefined) data.display_name = display_name;
      if (guard_name !== undefined) data.guard_name = guard_name;
      if (status !== undefined) data.status = status;

      await getPrisma().roles.update({ where: { id }, data });

      if (menu_cruds && Array.isArray(menu_cruds)) {
        await getPrisma().role_menu_crud.deleteMany({ where: { role_id: id } });
        for (const mc of menu_cruds) {
          await getPrisma().role_menu_crud.create({
            data: {
              role_id: id, menu_id: BigInt(mc.menu_id),
              view: mc.view ?? false, add: mc.add ?? false, edit: mc.edit ?? false, delete: mc.delete ?? false,
              transaction_actions: mc.transaction_actions || null,
            },
          });
        }
      }

      success(res, null, 'Role updated');
    } catch (err: any) { error(res, 'Failed to update role', 500); }
  }

  static async roleDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await getPrisma().roles.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Role not found'); return; }
      await getPrisma().roles.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id, status: 0 } });
      success(res, null, 'Role deleted');
    } catch (err: any) { error(res, 'Failed to delete role', 500); }
  }

  static async roleRestore(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await getPrisma().roles.update({ where: { id }, data: { deleted_at: null, status: 1 } });
      success(res, null, 'Role restored');
    } catch (err: any) { error(res, 'Failed to restore role', 500); }
  }

  static async roleGetTemplates(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const data = await getPrisma().role_templates.findMany({ where: { property_id: pid }, orderBy: { sort: 'asc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to list templates', 500); }
  }

  static async roleUpsertTemplate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { id, key, label, name, code, description, dashboard, grants, transaction_grants, color_ring, color_bg, color_badge_bg, color_badge_text, is_active, sort } = req.body;

      if (id) {
        const updated = await getPrisma().role_templates.update({
          where: { id: BigInt(id) }, data: { key, label, name, code, description, dashboard, grants, transaction_grants, color_ring, color_bg, color_badge_bg, color_badge_text, is_active, sort, updated_at: new Date(), updated_by: req.user?.id },
        });
        success(res, bigintToNumber(updated), 'Template updated');
      } else {
        if (!key || !label || !name || !code) { badRequest(res, 'key, label, name, code are required'); return; }
        const created = await getPrisma().role_templates.create({
          data: { property_id: pid, key, label, name, code, description, dashboard, grants, transaction_grants, color_ring, color_bg, color_badge_bg, color_badge_text, is_active, sort, created_by: req.user?.id },
        });
        success(res, bigintToNumber(created), 'Template created');
      }
    } catch (err: any) { error(res, 'Failed to save template', 500); }
  }

  // ================================================================
  //  PERMISSION
  // ================================================================
  static async permissionList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = { deleted_at: null };
      if (search) { where.name = { contains: search, mode: 'insensitive' }; }
      const [data, total] = await Promise.all([
        getPrisma().permissions.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().permissions.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { error(res, 'Failed to list permissions', 500); }
  }

  static async permissionStore(req: Request, res: Response): Promise<void> {
    try {
      const { name, guard_name, display_name, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }
      const perm = await getPrisma().permissions.create({
        data: { name, guard_name: guard_name || 'web', display_name: display_name || null, status: status ?? 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(perm), 'Permission created');
    } catch (err: any) { error(res, 'Failed to create permission', 500); }
  }

  static async permissionShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const perm = await getPrisma().permissions.findUnique({ where: { id } });
      if (!perm) { notFound(res, 'Permission not found'); return; }
      success(res, bigintToNumber(perm), 'Success');
    } catch (err: any) { error(res, 'Failed to load permission', 500); }
  }

  static async permissionUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { name, guard_name, display_name, status } = req.body;
      const existing = await getPrisma().permissions.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Permission not found'); return; }
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (name !== undefined) data.name = name;
      if (guard_name !== undefined) data.guard_name = guard_name;
      if (display_name !== undefined) data.display_name = display_name;
      if (status !== undefined) data.status = status;
      await getPrisma().permissions.update({ where: { id }, data });
      success(res, null, 'Permission updated');
    } catch (err: any) { error(res, 'Failed to update permission', 500); }
  }

  static async permissionDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await getPrisma().permissions.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Permission deleted');
    } catch (err: any) { error(res, 'Failed to delete permission', 500); }
  }

  static async permissionRestore(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await getPrisma().permissions.update({ where: { id }, data: { deleted_at: null } });
      success(res, null, 'Permission restored');
    } catch (err: any) { error(res, 'Failed to restore permission', 500); }
  }

  // ================================================================
  //  MENU
  // ================================================================
  static async menuList(req: Request, res: Response): Promise<void> {
    try {
      const where: any = { deleted_at: null };
      const menus = await getPrisma().menus.findMany({ where, orderBy: [{ left: 'asc' }] });

      const buildTree = (parentId: bigint | null): any[] =>
        menus.filter(m => m.parent_id === parentId).map(m => ({
          ...bigintToNumber(m), label: (() => { try { const p = JSON.parse(m.name); return p?.en || p?.id || m.name; } catch { return m.name; } })(),
          children: buildTree(m.id),
        }));

      success(res, buildTree(null), 'Success');
    } catch (err: any) { error(res, 'Failed to list menus', 500); }
  }

  static async menuShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const menu = await getPrisma().menus.findUnique({ where: { id } });
      if (!menu) { notFound(res, 'Menu not found'); return; }
      success(res, bigintToNumber(menu), 'Success');
    } catch (err: any) { error(res, 'Failed to load menu', 500); }
  }

  static async menuStore(req: Request, res: Response): Promise<void> {
    try {
      const { parent_id, name, url, visibility, uri_table, type_table, target, media, data, left, right, child_type, sort, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }
      const menu = await getPrisma().menus.create({
        data: {
          parent_id: parent_id ? BigInt(parent_id) : null, name, url: url || null,
          visibility: visibility || null, uri_table: uri_table || null, type_table: type_table || null,
          target: target ?? 0, media: media || null, data: data || null,
          left: left ?? 0, right: right ?? 0, child_type: child_type || null,
          sort: sort ?? 0, status: status ?? 1,
          created_at: new Date(), updated_at: new Date(), created_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(menu), 'Menu created');
    } catch (err: any) { error(res, 'Failed to create menu', 500); }
  }

  static async menuUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { parent_id, name, url, visibility, uri_table, type_table, target, media, data, left, right, child_type, sort, status } = req.body;
      const existing = await getPrisma().menus.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Menu not found'); return; }
      const upd: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (parent_id !== undefined) upd.parent_id = parent_id ? BigInt(parent_id) : null;
      if (name !== undefined) upd.name = name;
      if (url !== undefined) upd.url = url;
      if (visibility !== undefined) upd.visibility = visibility;
      if (uri_table !== undefined) upd.uri_table = uri_table;
      if (type_table !== undefined) upd.type_table = type_table;
      if (target !== undefined) upd.target = target;
      if (media !== undefined) upd.media = media;
      if (data !== undefined) upd.data = data;
      if (left !== undefined) upd.left = left;
      if (right !== undefined) upd.right = right;
      if (child_type !== undefined) upd.child_type = child_type;
      if (sort !== undefined) upd.sort = sort;
      if (status !== undefined) upd.status = status;
      await getPrisma().menus.update({ where: { id }, data: upd });
      success(res, null, 'Menu updated');
    } catch (err: any) { error(res, 'Failed to update menu', 500); }
  }

  static async menuDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await getPrisma().menus.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id, status: 0 } });
      success(res, null, 'Menu deleted');
    } catch (err: any) { error(res, 'Failed to delete menu', 500); }
  }

  static async menuRestore(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await getPrisma().menus.update({ where: { id }, data: { deleted_at: null, status: 1 } });
      success(res, null, 'Menu restored');
    } catch (err: any) { error(res, 'Failed to restore menu', 500); }
  }

  static async menuSort(req: Request, res: Response): Promise<void> {
    try {
      const { items } = req.body;
      if (items && Array.isArray(items)) {
        for (const item of items) {
          await getPrisma().menus.update({ where: { id: BigInt(item.id) }, data: { sort: item.sort ?? 0, parent_id: item.parent_id ? BigInt(item.parent_id) : null, updated_at: new Date() } });
        }
      }
      success(res, null, 'Menu sorted');
    } catch (err: any) { error(res, 'Failed to sort menus', 500); }
  }

  static async menuListBySlug(req: Request, res: Response): Promise<void> {
    try {
      const slug = String(req.params.slug);
      const menu = await getPrisma().menus.findFirst({ where: { uri_table: '/cms/' + slug, deleted_at: null } });
      if (!menu) {
        success(res, { code: 404, message: 'Not Found' }, 'Not Found', 404);
        return;
      }
      const breadcrumbs = req.path.split('/').filter(Boolean).map((segment, index, arr) => ({
        label: segment,
        url: '/' + arr.slice(0, index + 1).join('/'),
      }));
      let label = String(menu.name ?? '');
      try {
        const parsed = JSON.parse(label);
        label = parsed.en ?? parsed.id ?? parsed.name ?? label;
      } catch (e) { /* plain string name */ }
      const meta: any = {
        typeTable: menu.type_table,
        uriTable: menu.uri_table,
        label,
        isDrag: true,
        uriSaveDrag: (menu.uri_table || '') + '/sort',
        breadcrumbs,
      };
      success(res, null, 'Success', 200, meta);
    } catch (err: any) { error(res, 'Failed to list menus by slug', 500); }
  }

  static async menuGetParentByIdChildren(req: Request, res: Response): Promise<void> {
    try {
      const ischildren = String(req.query.ischildren ?? '1') === '1' ? 1 : 0;
      let rawId = String(req.params.id ?? '');
      // Laravel parity: special-case reservation vr path maps to menu 69
      if (String(req.query.path) === '/reservation/vr/reservation') rawId = '69';

      let menu: any = null;
      if (rawId && rawId !== 'null' && rawId !== 'undefined') {
        menu = await getPrisma().menus.findUnique({ where: { id: idParam(rawId) } });
      }
      if (!menu || menu.deleted_at) {
        // Laravel: HTTP 404 but body code 200 + empty data (frontend checks body code only)
        success(res, [], 'Success');
        return;
      }

      // Walk up parent chain to root (Laravel: while ($data->parent_id != null) $data = $data->parent)
      let root: any = menu;
      const visited = new Set<string>();
      while (root.parent_id && !visited.has(root.parent_id.toString())) {
        visited.add(root.parent_id.toString());
        const parent: any = await getPrisma().menus.findUnique({ where: { id: root.parent_id } });
        if (!parent) break;
        root = parent;
      }
      if (!root) { error(res, 'Not Found', 404); return; }

      // Property market-segment filters (menus 19-22)
      const pid = req.user?.lastProperty ?? null;
      const property = pid ? await getPrisma().properties.findUnique({ where: { id: pid } }) : null;
      const excluded: bigint[] = [];
      if (property) {
        if (!property.market_segment_1) excluded.push(19n);
        if (!property.market_segment_2) excluded.push(20n);
        if (!property.market_segment_3) excluded.push(21n);
        if (!property.market_segment_4) excluded.push(22n);
      }

      const allMenus = await getPrisma().menus.findMany({
        where: { deleted_at: null },
        orderBy: [{ left: 'asc' }, { sort: 'asc' }],
      });

      const children = buildMenuResources(root.id, allMenus, excluded, ischildren, 0, req.user);
      success(res, children, 'Success');
    } catch (err: any) {
      console.error('Menu get parent by id children error:', err);
      error(res, 'Failed to get children', 500);
    }
  }

  // ================================================================
  //  SETTING
  // ================================================================
  static async settingList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const data = await getPrisma().settings.findMany({ where: { property_id: pid } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to list settings', 500); }
  }

  static async settingStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { key, value } = req.body;
      if (!key) { badRequest(res, 'key is required'); return; }
      const existing = await getPrisma().settings.findUnique({ where: { id: BigInt(req.body.id) } });
      if (req.body.id && existing) {
        await getPrisma().settings.update({ where: { id: BigInt(req.body.id) }, data: { key, value } });
      } else {
        await getPrisma().settings.upsert({ where: { id: BigInt(-1) }, create: { property_id: pid, key, value }, update: { value } });
      }
      success(res, null, 'Setting saved');
    } catch (err: any) { error(res, 'Failed to save setting', 500); }
  }

  static async settingCheckValue(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { key } = req.query;
      if (!key) { badRequest(res, 'key is required'); return; }
      const setting = await getPrisma().settings.findFirst({ where: { property_id: pid, key: key as string } });
      success(res, setting ? { key: setting.key, value: setting.value } : null, 'Success');
    } catch (err: any) { error(res, 'Failed to check setting', 500); }
  }

  // ================================================================
  //  TASK
  // ================================================================
  static async taskList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { page, limit } = parsePagination(req.query);
      const where: any = { deleted_at: null };
      const [data, total] = await Promise.all([
        getPrisma().tasks.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().tasks.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { error(res, 'Failed to list tasks', 500); }
  }

  static async taskStore(req: Request, res: Response): Promise<void> {
    try {
      const { to_user_id, to_role_id, department, room_number, type, message, priority } = req.body;
      if (!type) { badRequest(res, 'type is required'); return; }
      const task = await getPrisma().tasks.create({
        data: {
          created_by: req.user!.id, to_user_id: to_user_id ? BigInt(to_user_id) : null,
          to_role_id: to_role_id ? BigInt(to_role_id) : null, department: department || null,
          room_number: room_number || null, type, message: message || null,
          priority: priority || 'Medium', created_on: new Date(), created_at: new Date(), updated_at: new Date(),
        },
      });
      success(res, bigintToNumber(task), 'Task created');
    } catch (err: any) { error(res, 'Failed to create task', 500); }
  }

  // ================================================================
  //  FIXX TREE (Menu repair)
  // ================================================================
  static async menuFixTree(req: Request, res: Response): Promise<void> {
    try {
      const menus = await getPrisma().menus.findMany({ where: { deleted_at: null }, orderBy: { id: 'asc' } });
      let left = 1;
      const stack: any[] = [];
      for (const menu of menus) {
        if (!menu.parent_id) {
          menu.left = left++;
          menu.right = left++;
          await getPrisma().menus.update({ where: { id: menu.id }, data: { left: menu.left, right: menu.right } });
        }
      }
      success(res, { message: 'Tree fixed' }, 'Success');
    } catch (err: any) { error(res, 'Failed to fix tree', 500); }
  }

  // ================================================================
  //  FORCE LOGOUT
  // ================================================================
  static async forceLogout(req: Request, res: Response): Promise<void> {
    try {
      const email = String(req.params.email);
      const user = await getPrisma().users.findFirst({ where: { email } });
      if (!user) { notFound(res, 'User not found'); return; }
      await getPrisma().personal_access_tokens.deleteMany({
        where: { tokenable_id: user.id, tokenable_type: 'App\\Models\\User' },
      });
      success(res, null, 'User force logged out');
    } catch (err: any) { error(res, 'Failed to force logout', 500); }
  }

  static async forceBulkLogout(req: Request, res: Response): Promise<void> {
    try {
      await getPrisma().personal_access_tokens.deleteMany({
        where: { tokenable_type: 'App\\Models\\User' },
      });
      success(res, null, 'All users force logged out');
    } catch (err: any) { error(res, 'Failed to force bulk logout', 500); }
  }

  // ================================================================
  //  USER LIST (Laravel-compatible /user/get-user)
  // ================================================================
  static async userList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = { deleted_at: null };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }
      const client = getPrisma();
      console.log('[DEBUG] userList client created');
      const [users, total] = await Promise.all([
        client.users.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        client.users.count({ where: { deleted_at: null } }),
      ]);
      console.log('[DEBUG] userList found', users.length, 'users');
      const userIds = users.map(u => u.id);
      const modelRoles = await getPrisma().model_has_roles.findMany({
        where: { model_id: { in: userIds }, model_type: 'App\\Models\\User' },
        include: { roles: true },
      });
      const rolesMap = new Map<bigint, any[]>();
      for (const mr of modelRoles) {
        if (!rolesMap.has(mr.model_id)) rolesMap.set(mr.model_id, []);
        rolesMap.get(mr.model_id)!.push(mr.roles);
      }
      const formatted = users.map(u => ({ ...bigintToNumber(u), roles: rolesMap.get(u.id) || [] }));
      const rows = formatted.map((u, i) => ({ ...u, no: (page - 1) * limit + i + 1 }));
      success(res, rows, 'Success', 200, {
        table: TABLES.user,
        pagging: laravelPaging(total, limit, page),
        permission: {
          view: true, add: req.user?.superUser || getPermissionFlags(req.user, 1116).add,
          edit: req.user?.superUser || getPermissionFlags(req.user, 1116).edit,
          delete: req.user?.superUser || getPermissionFlags(req.user, 1116).delete,
        },
      });
    } catch (err: any) {
      console.error('[ERROR] userList:', err?.message, err?.stack);
      error(res, 'Failed to list users', 500);
    }
  }

  // ================================================================
  //  LOG (Activity Log / Spatie)
  // ================================================================
  static async logList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const where: any = {};
      const [data, total] = await Promise.all([
        getPrisma().logs.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().logs.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { error(res, 'Failed to list logs', 500); }
  }

  // ================================================================
  //  FCM TOKEN
  // ================================================================
  static async saveFcmToken(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.body;
      if (!token) { badRequest(res, 'token is required'); return; }
      await getPrisma().users.update({ where: { id: req.user!.id }, data: { fcm_token: token } });
      success(res, null, 'FCM token saved');
    } catch (err: any) { error(res, 'Failed to save FCM token', 500); }
  }

  // ================================================================
  //  PROPERTY
  // ================================================================
  static async propertyList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const trash = req.query.trash === '1';
      const where: any = trash ? { deleted_at: { not: null } } : { deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        getPrisma().properties.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { cities: true },
        }),
        getPrisma().properties.count({ where }),
      ]);

      const mapped = data.map(p => ({
        ...bigintToNumber(p),
        id: Number(p.id),
        name: p.name,
        alias: p.alias,
        image: p.logo || p.image,
        email: p.email,
        address: p.address,
        phone: p.telp ? Number(p.telp) : null,
        relation: p.cities ? { cities: { label: p.cities.name } } : null,
      }));

      success(res, mapped, 'Success', 200, {
        table: TABLES.property,
        pagging: laravelPaging(total, limit, page),
        permission: {
          view: true, add: req.user?.superUser || getPermissionFlags(req.user, 1134).add,
          edit: req.user?.superUser || getPermissionFlags(req.user, 1134).edit,
          delete: req.user?.superUser || getPermissionFlags(req.user, 1134).delete,
        },
      });
    } catch (err: any) {
      console.error('Property list error:', err);
      error(res, 'Failed to list properties', 500);
    }
  }

  static async propertyAuth(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const property = await getPrisma().properties.findUnique({
        where: { id },
        select: { id: true, name: true, alias: true, logo: true, image: true, address: true, email: true, telp: true },
      });
      if (!property) { notFound(res, 'Property not found'); return; }

      // Update user's last used property
      const user = await getPrisma().users.update({
        where: { id: req.user!.id },
        data: { last_property: id },
      });

      // Get current token from auth middleware
      let tokenHeader = req.headers['x-token'] as string;
      if (!tokenHeader) {
        const authHeader = req.headers['authorization'] as string;
        if (authHeader?.startsWith('Bearer ')) tokenHeader = authHeader.slice(7);
      }

      success(res, {
        id: Number(property.id),
        name: property.name,
        alias: property.alias,
        image: property.logo || property.image,
        address: property.address,
        email: property.email,
        phone: property.telp ? Number(property.telp) : null,
        name_user: user.name,
        username: user.username,
        email_user: user.email,
        role: req.user!.roles,
        access_token: tokenHeader,
        last_property: Number(user.last_property),
      }, 'Success');
    } catch (err: any) {
      console.error('Property auth error:', err);
      error(res, 'Failed to authenticate property', 500);
    }
  }

  // ================================================================
  //  SIDEBAR MENU (Laravel MenuResources parity: url with ?parent=&module=)
  // ================================================================
  static async menuListAll(req: Request, res: Response): Promise<void> {
    try {
      const allMenus = await getPrisma().menus.findMany({
        where: { deleted_at: null, status: 1 },
        orderBy: [{ left: 'asc' }, { sort: 'asc' }],
      });

      // Property market-segment filters (menus 19-22)
      const pid = req.user?.lastProperty ?? null;
      const property = pid ? await getPrisma().properties.findUnique({ where: { id: pid } }) : null;
      const excluded: bigint[] = [];
      if (property) {
        if (!property.market_segment_1) excluded.push(19n);
        if (!property.market_segment_2) excluded.push(20n);
        if (!property.market_segment_3) excluded.push(21n);
        if (!property.market_segment_4) excluded.push(22n);
      }

      // Sidebar request has no ischildren param -> Laravel MenuResources uses mappedId for every row
      const roots = allMenus.filter(m => !m.parent_id && !excluded.includes(m.id));
      const data = roots.map(m => toMenuResource(m, allMenus, excluded, 0, 0, req.user));

      const page = parseInt(String(req.query.page)) || 1;
      const limit = parseInt(String(req.query.limit)) || 99999;
      const totalPages = Math.max(1, Math.ceil(allMenus.length / limit));
      const pagging = {
        limit_data: limit,
        total_data: allMenus.length,
        start_paging: page,
        end_paging: totalPages,
        prev_jump: page > 1 ? 1 : 0,
        prev: page > 1 ? page - 1 : 0,
        next: page < totalPages ? page + 1 : 0,
        next_jump: page < totalPages ? totalPages : 0,
      };

      const perms = menuPermissions(1115n, req.user);
      success(res, data, 'Success', 200, {
        pagging,
        permission: { view: perms.view, add: perms.edit, edit: perms.edit, delete: perms.edit },
        datas: allMenus.map(m => ({ ...bigintToNumber(m), name: parseJsonField(m.name, {}) })),
        isNotAdmin: false,
      });
    } catch (err: any) {
      console.error('Menu list all error:', err);
      error(res, 'Failed to list menus', 500);
    }
  }

  // ================================================================
  //  ALL USERS (for uall dropdown)
  // ================================================================
  static async userListAll(req: Request, res: Response): Promise<void> {
    try {
      const users = await getPrisma().users.findMany({
        where: { status: 1 },
        select: { id: true, name: true, username: true, email: true },
        orderBy: { name: 'asc' },
      });
      success(res, bigintToNumber(users), 'Success');
    } catch (err: any) {
      console.error('User list all error:', err);
      error(res, 'Failed to list users', 500);
    }
  }

  // ================================================================
  //  ALL ROLES (for rall dropdown)
  // ================================================================
  static async roleListAll(req: Request, res: Response): Promise<void> {
    try {
      const roles = await getPrisma().roles.findMany({
        where: { deleted_at: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      success(res, bigintToNumber(roles), 'Success');
    } catch (err: any) {
      console.error('Role list all error:', err);
      error(res, 'Failed to list roles', 500);
    }
  }
}

function parseJsonField(val: any, fallback: any): any {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return val; }
}

function menuPermissions(menuId: bigint, user: any): { view: boolean; edit: boolean; approve: boolean } {
  if (!user) return { view: false, edit: false, approve: false };
  if (user.superUser) return { view: true, edit: true, approve: true };
  const crud = user.permissions?.get(menuId);
  return {
    view: !!crud?.view,
    edit: !!crud?.edit,
    // Prisma role_menu_crud has no approve column; fall back to view (Laravel: approve)
    approve: !!crud?.view,
  };
}

// Laravel MenuResources parity (recursive)
function toMenuResource(
  m: any,
  allMenus: any[],
  excluded: bigint[],
  ischildren: number,
  depth: number,
  user: any
): any {
  const id = Number(m.id);
  const mappedId = [66, 67, 68].includes(id) ? 63 : id;
  const parent = depth === 1 && ischildren === 1
    ? (m.parent_id ? Number(m.parent_id) : null)
    : mappedId;
  const rawUrl = m.url || '';
  const url = rawUrl
    ? rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'parent=' + parent + '&module=' + (m.visibility ?? '')
    : rawUrl;
  const aliasUrl = rawUrl.includes('?') ? rawUrl.split('?')[0] : rawUrl;
  const perms = menuPermissions(m.id, user);

  const resource: any = {
    no: m.sort ?? 0,
    id: mappedId,
    parent_id: m.parent_id ? Number(m.parent_id) : null,
    page_id: null,
    name: parseJsonField(m.name, {}),
    url,
    alias_url: aliasUrl,
    recursive: depth,
    media: parseJsonField(m.media, {}),
    target: m.target,
    module: m.visibility ?? '',
    status: m.status ?? 0,
    is_view: perms.view,
    is_edit: perms.edit,
    is_need_approval: perms.approve,
    place: '',
  };

  const children = allMenus.filter(c =>
    c.parent_id && c.parent_id.toString() === m.id.toString() && !excluded.includes(c.id)
  );
  if (children.length > 0) {
    resource.place = m.child_type === 'form' ? 'form' : 'table';
    resource.relation = {
      children: children.map(c => toMenuResource(c, allMenus, excluded, ischildren, depth + 1, user)),
    };
  }
  return resource;
}

function buildMenuResources(
  parentId: bigint,
  allMenus: any[],
  excluded: bigint[],
  ischildren: number,
  depth: number,
  user: any
): any[] {
  return allMenus
    .filter(m => m.parent_id && m.parent_id.toString() === parentId.toString() && !excluded.includes(m.id))
    .map(m => toMenuResource(m, allMenus, excluded, ischildren, depth, user));
}
