import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { notificationService } from '../services/notification.service';
import { TokenService } from '../services/token.service';
import { IS_TAXS, IS_TAX_EXCLUDE_RESTAURANTS, REGIONS, STATUSES, SUBSCRIBE_TYPES, getStatusLabel } from '../utils/cmsConfig';
import { badRequest, error, notFound, success, validationError } from '../utils/response';
import { deleteStoredFile, isInlineImageData, mimeFromPath, resolveStoredPath, savePropertyLogo, storedImageUrl } from '../utils/storage';
import { MANDATORY_FIELD_LABELS, normalizeMandatoryList } from '../utils/guestMandatory';
import { TABLES, laravelPaging } from '../utils/tableMeta';
import { AuthController } from './auth.controller';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
const adminAdapter = new PrismaPg(adminPool);
const adminPrisma = new PrismaClient({ adapter: adminAdapter });
const STORAGE_PATH = process.env.STORAGE_PATH || path.join(process.cwd(), 'storage');

function getPrisma() {
  return adminPrisma;
}

// In-memory stand-in for Laravel Cache (hk notification read keys)
const taskHkReadCache = new Map<string, any>();

function bigintToNumber(val: any): any {
    if (val instanceof Date) {
      const u = val.getUTCFullYear();
      const iso = val.toISOString();
      if (u === 1970 && val.getUTCMonth() === 0 && val.getUTCDate() === 1) return iso.slice(11, 19);
      const s = iso.slice(0, 19).replace('T', ' ');
      return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
    }
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
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

export function normalizePermissionFlag(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

// Laravel RoleController::saveCrudPermissions() — the role form posts
// permissions as { [groupMenuId]: { [childMenuId]: { view, add, edit,
// transaction_actions } } }, so the rows have to be flattened out of that
// two-level map before they reach role_menu_crud.
async function saveRolePermissions(roleId: bigint, permissions: any): Promise<void> {
  const prisma = getPrisma();
  const validMenuIds = new Set(
    (await prisma.menus.findMany({ select: { id: true } })).map((m: any) => m.id.toString()),
  );

  // Laravel always keeps menu 52 in the legacy pivot.
  const menuIdsToSync: bigint[] = [52n];
  const rows: any[] = [];

  for (const [groupKey, children] of Object.entries(permissions || {})) {
    if (!groupKey || !validMenuIds.has(String(groupKey))) continue;
    if (!children || typeof children !== 'object' || Array.isArray(children)) continue;

    let groupHasView = false;

    for (const [childKey, actions] of Object.entries(children as Record<string, any>)) {
      if (!childKey || !validMenuIds.has(String(childKey))) continue;
      const a: any = actions && typeof actions === 'object' && !Array.isArray(actions) ? actions : {};
      const hasCrudPermission = [a.view, a.add, a.edit].some((value: any) => normalizePermissionFlag(value));
      const transactionActions = a.transaction_actions && typeof a.transaction_actions === 'object' && !Array.isArray(a.transaction_actions)
        ? JSON.stringify(a.transaction_actions)
        : null;
      const view = normalizePermissionFlag(a.view);
      const add = normalizePermissionFlag(a.add);
      const edit = normalizePermissionFlag(a.edit);

      if (hasCrudPermission || transactionActions) {
        const childId = BigInt(childKey);
        rows.push({
          role_id: roleId,
          menu_id: childId,
          view,
          add,
          edit,
          delete: false,
          transaction_actions: transactionActions,
        });
        if (view) {
          menuIdsToSync.push(childId);
          groupHasView = true;
        }
      }
    }

    if (groupHasView) menuIdsToSync.push(BigInt(groupKey));
  }

  await prisma.role_menu_crud.deleteMany({ where: { role_id: roleId } });
  if (rows.length) await prisma.role_menu_crud.createMany({ data: rows });

  // Keep the legacy menu pivot in sync — formatData() reads isaccess from here.
  await prisma.model_has_menus.deleteMany({
    where: { model_id: roleId, model_type: 'App\\Models\\Role' },
  });
  await prisma.model_has_menus.createMany({
    data: Array.from(new Set(menuIdsToSync.map(String))).map(mid => ({
      menu_id: BigInt(mid),
      model_id: roleId,
      model_type: 'App\\Models\\Role',
    })),
  });
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

      const permissions = await getPrisma().permissions.findMany({
        where: { status: 1, deleted_at: null },
        select: { id: true, name: true },
      });

      success(res, rows, 'Success', 200, {
        table: TABLES.role,
        permission: {
          view: true, add: req.user?.superUser || permFlags.add,
          edit: req.user?.superUser || permFlags.edit, delete: req.user?.superUser || permFlags.delete,
        },
        pagination: laravelPaging(total, limit, page),
        master: {
          permissions: bigintToNumber(permissions).map((p: any) => ({ value: p.id, label: p.name })),
          statuses: STATUSES,
        },
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
        getPrisma().menus.findMany({ where: { deleted_at: null, status: 1, id: { notIn: [15, 5, 6, 14, 1123, 1126] } }, orderBy: [{ left: 'asc' }] }),
        getPrisma().role_templates.findMany({ where: { property_id: pid, is_active: true }, orderBy: { sort: 'asc' } }),
      ]);

      const buildTree = (parentId: bigint | null): any[] =>
        // @ts-ignore
        menus.filter(m => m.parent_id === parentId).map(m => {
          let label = String(m.name ?? '');
          try {
            const parsed = JSON.parse(label);
            label = parsed.en ?? parsed.id ?? parsed.name ?? label;
          } catch (e) { /* keep as string */ }

          const labelParts = label.replace(/[-_]/g, ' ').split('.').map(s => {
            return s.charAt(0).toUpperCase() + s.slice(1);
          });

          const children = buildTree(m.id);

          return {
            key: labelParts,
            value: Number(m.id),
            label: labelParts,
            isaccess: false,
            crud: { view: false, add: false, edit: false, delete: false },
            transaction_actions: {},
            children,
          };
        });

      const rawTree = buildTree(null);
      const permissions = rawTree.map(root => {
        const accessList: any[] = [];
        const walkChildren = (nodes: any[]) => {
          for (const n of nodes) {
            accessList.push({
              label: n.label[n.label.length - 1],
              value: n.value,
              isaccess: n.isaccess,
              crud: n.crud,
              transaction_actions: n.transaction_actions,
            });
            if (n.children && n.children.length > 0) {
              walkChildren(n.children);
            }
          }
        };
        if (root.children) walkChildren(root.children);

        return {
          key: root.key,
          value: root.value,
          label: root.label,
          isaccess: root.isaccess,
          access: accessList,
        };
      }).filter(p => p.value !== 52);

      const formattedRole = {
        id: 0,
        name: '',
        code: 'web',
        list_dashboard: [],
        permissions,
        created_at: new Date(),
        created_by: Number(req.user?.id ?? 0),
        status: { value: true, label: 'Active' },
        relation: { permissions: [] },
      };

      // @ts-ignore
      const templateData = templates.map(t => ({
        id: Number(t.id),
        key: t.key,
        name: t.name,
        label: t.label,
        code: t.code,
        desc: t.description,
        dashboard: t.dashboard ? (typeof t.dashboard === 'string' ? JSON.parse(t.dashboard) : t.dashboard) : [],
        grants: t.grants ? (typeof t.grants === 'string' ? JSON.parse(t.grants) : t.grants) : [],
        transactionGrants: t.transaction_grants ? (typeof t.transaction_grants === 'string' ? JSON.parse(t.transaction_grants) : t.transaction_grants) : null,
        colors: {
          ringColor: t.color_ring,
          bgColor: t.color_bg,
          badgeBg: t.color_badge_bg,
          badgeText: t.color_badge_text,
        },
      }));

      import('../utils/cmsConfig').then(({ DASHBOARDS }) => {
        success(res, formattedRole, 'Success', 200, {
          master: {
            statuses: STATUSES,
            dashboards: DASHBOARDS,
            templates: templateData,
          }
        });
      });
    } catch (err: any) { console.error(err); error(res, 'Failed to load form data', 500); }
  }

  static async roleStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      // The role form posts { name, code, status, dashboard, permissions }.
      const { name, display_name, guard_name, status, dashboard, permissions, menu_cruds } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const role = await getPrisma().roles.create({
        data: {
          property_id: pid, name, display_name: display_name || null,
          guard_name: guard_name || 'web',
          // Laravel RoleController@store:27 — dashboard is an array of codes.
          list_dashboard: Array.isArray(dashboard) ? dashboard.map((d: any) => typeof d === 'object' && d !== null && d.value ? d.value : d).filter(Boolean).join(',') : (dashboard || ''),
          status: status === true || status === 'true' || status === 1 || status === '1' || status?.value === 1 || status?.value === true ? 1 : (status === false || status === 'false' || status === 0 || status === '0' || status?.value === 0 || status?.value === false ? 0 : (Number(status) || 1)),
          created_at: new Date(), updated_at: new Date(), created_by: req.user?.id,
        },
      });

      if (permissions && typeof permissions === 'object') {
        await saveRolePermissions(role.id, permissions);
      } else if (menu_cruds && Array.isArray(menu_cruds)) {
        for (const mc of menu_cruds) {
          await getPrisma().role_menu_crud.create({
            data: {
              role_id: role.id, menu_id: BigInt(mc.menu_id),
              view: normalizePermissionFlag(mc.view),
              add: normalizePermissionFlag(mc.add),
              edit: normalizePermissionFlag(mc.edit),
              delete: normalizePermissionFlag(mc.delete),
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
      const [role, menus, templates, menuCruds, assignedMenus] = await Promise.all([
        getPrisma().roles.findUnique({ where: { id } }),
        getPrisma().menus.findMany({ where: { deleted_at: null, status: 1, id: { notIn: [15, 5, 6, 14, 1123, 1126] } }, orderBy: [{ left: 'asc' }] }),
        getPrisma().role_templates.findMany({ where: { property_id: pid, is_active: true }, orderBy: { sort: 'asc' } }),
        getPrisma().role_menu_crud.findMany({ where: { role_id: id } }),
        // Laravel Role::formatData():73 — isaccess comes from the legacy menu
        // pivot (Role::menu()), not from the existence of a crud row.
        getPrisma().model_has_menus.findMany({
          where: { model_id: id, model_type: 'App\\Models\\Role' },
          select: { menu_id: true },
        }),
      ]);
      if (!role) { notFound(res, 'Role not found'); return; }

      const assignedMenuIds = new Set(assignedMenus.map((am: any) => am.menu_id.toString()));

      const buildTree = (parentId: bigint | null): any[] =>
        // @ts-ignore
        menus.filter(m => m.parent_id === parentId).map(m => {
          let label = String(m.name ?? '');
          try {
            const parsed = JSON.parse(label);
            label = parsed.en ?? parsed.id ?? parsed.name ?? label;
          } catch (e) { /* keep as string */ }

          const labelParts = label.replace(/[-_]/g, ' ').split('.').map(s => {
            return s.charAt(0).toUpperCase() + s.slice(1);
          });

          const children = buildTree(m.id);
          // @ts-ignore
          const mc = menuCruds.find(c => c.menu_id === m.id);
          const isaccess = assignedMenuIds.has(m.id.toString());

          return {
            key: labelParts,
            value: Number(m.id),
            label: labelParts, // top level uses array for label, children use string for label
            isaccess,
            crud: {
              view: mc ? !!mc.view : false,
              add: mc ? !!mc.add : false,
              edit: mc ? !!mc.edit : false,
              delete: mc ? !!mc.delete : false,
            },
            transaction_actions: mc && mc.transaction_actions ? (typeof mc.transaction_actions === 'string' ? JSON.parse(mc.transaction_actions) : mc.transaction_actions) : {},
            children,
          };
        });

      const rawTree = buildTree(null);
      // Flatten children like Laravel does in `formatData()`
      const permissions = rawTree.map(root => {
        // Flat map all descendants for access array
        const accessList: any[] = [];
        const walkChildren = (nodes: any[]) => {
          for (const n of nodes) {
            accessList.push({
              label: n.label[n.label.length - 1],
              value: n.value,
              isaccess: n.isaccess,
              crud: n.crud,
              transaction_actions: n.transaction_actions,
            });
            if (n.children && n.children.length > 0) {
              walkChildren(n.children);
            }
          }
        };
        if (root.children) walkChildren(root.children);

        return {
          key: root.key,
          value: root.value,
          label: root.label,
          isaccess: root.isaccess,
          access: accessList,
        };
      }).filter(p => p.value !== 52); // Filter out menu 52 as Laravel does

      const formattedRole = {
        id: Number(role.id),
        name: role.name,
        code: role.guard_name,
        // @ts-ignore
        list_dashboard: role.list_dashboard ? role.list_dashboard.split(',').filter(Boolean).map(d => ({
          // @ts-ignore
          label: d.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: d
        })) : [],
        permissions,
        created_at: role.created_at,
        created_by: Number(role.created_by),
        status: {
          value: !!role.status,
          label: STATUSES.find(s => s.value === role.status)?.label || (role.status ? 'Active' : 'Inactive'),
        },
        relation: {
          permissions: [],
        },
      };

      // @ts-ignore
      const templateData = templates.map(t => ({
        id: Number(t.id),
        key: t.key,
        name: t.name,
        label: t.label,
        code: t.code,
        desc: t.description,
        dashboard: t.dashboard ? (typeof t.dashboard === 'string' ? JSON.parse(t.dashboard) : t.dashboard) : [],
        grants: t.grants ? (typeof t.grants === 'string' ? JSON.parse(t.grants) : t.grants) : [],
        transactionGrants: t.transaction_grants ? (typeof t.transaction_grants === 'string' ? JSON.parse(t.transaction_grants) : t.transaction_grants) : null,
        colors: {
          ringColor: t.color_ring,
          bgColor: t.color_bg,
          badgeBg: t.color_badge_bg,
          badgeText: t.color_badge_text,
        },
      }));

      import('../utils/cmsConfig').then(({ DASHBOARDS }) => {
        success(res, formattedRole, 'Success', 200, {
          master: {
            statuses: STATUSES,
            dashboards: DASHBOARDS,
            templates: templateData,
          }
        });
      });
    } catch (err: any) { console.error(err); error(res, 'Failed to load role', 500); }
  }

  static async roleUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { name, display_name, guard_name, status, dashboard, permissions, menu_cruds } = req.body;
      const existing = await getPrisma().roles.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Role not found'); return; }

      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (name !== undefined) data.name = name;
      if (display_name !== undefined) data.display_name = display_name;
      if (guard_name !== undefined) data.guard_name = guard_name;
      if (dashboard !== undefined) {
        data.list_dashboard = Array.isArray(dashboard) ? dashboard.map((d: any) => typeof d === 'object' && d !== null && d.value ? d.value : d).filter(Boolean).join(',') : (dashboard || '');
      }
      // Frontend sends status as {value,label} object (formattedRole parity) â€” coerce to int
      if (status !== undefined) data.status = status === true || status === 'true' || status === 1 || status === '1' || status?.value === 1 || status?.value === true ? 1 : (status === false || status === 'false' || status === 0 || status === '0' || status?.value === 0 || status?.value === false ? 0 : Number(status));

      await getPrisma().roles.update({ where: { id }, data });

      try {
        if (permissions && typeof permissions === 'object') {
          await saveRolePermissions(id, permissions);
        } else if (menu_cruds && Array.isArray(menu_cruds)) {
          await getPrisma().role_menu_crud.deleteMany({ where: { role_id: id } });
          for (const mc of menu_cruds) {
            try {
              const menuIdRaw = mc?.menu_id ?? mc?.menuId ?? null;
              if (!menuIdRaw || !/^\d+$/.test(String(menuIdRaw))) {
                console.warn('Skipping invalid menu_crud entry (invalid menu_id)', { roleId: String(id), entry: mc });
                continue;
              }
              await getPrisma().role_menu_crud.create({
                data: {
                  role_id: id,
                  menu_id: BigInt(String(menuIdRaw)),
                  view: normalizePermissionFlag(mc.view),
                  add: normalizePermissionFlag(mc.add),
                  edit: normalizePermissionFlag(mc.edit),
                  delete: normalizePermissionFlag(mc.delete),
                  transaction_actions: mc.transaction_actions || null,
                },
              });
            } catch (innerErr: any) {
              console.error('Failed to create role_menu_crud row', { roleId: String(id), entry: mc, error: innerErr });
            }
          }
        }
      } catch (permErr: any) {
        console.error('Failed while saving role permissions/menu_cruds', { roleId: String(id), body: req.body, error: permErr });
        throw permErr;
      }

      success(res, null, 'Role updated');
    } catch (err: any) { console.error('Role update error:', err); error(res, 'Failed to update role', 500); }
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

      // Handle JSON fields (frontend sends array of objects, Prisma expects String)
      const dashboardStr = dashboard ? (typeof dashboard === 'string' ? dashboard : JSON.stringify(dashboard)) : null;
      const grantsStr = grants ? (typeof grants === 'string' ? grants : JSON.stringify(grants)) : null;
      const transactionGrantsStr = transaction_grants ? (typeof transaction_grants === 'string' ? transaction_grants : JSON.stringify(transaction_grants)) : null;

      if (id) {
        const updated = await getPrisma().role_templates.update({
          where: { id: BigInt(id) }, data: { key, label, name, code, description, dashboard: dashboardStr, grants: grantsStr, transaction_grants: transactionGrantsStr, color_ring, color_bg, color_badge_bg, color_badge_text, is_active, sort, updated_at: new Date(), updated_by: req.user?.id },
        });
        success(res, bigintToNumber(updated), 'Template updated');
      } else {
        if (!key || !label || !name || !code) { badRequest(res, 'key, label, name, code are required'); return; }
        const created = await getPrisma().role_templates.create({
          data: { property_id: pid, key, label, name, code, description, dashboard: dashboardStr, grants: grantsStr, transaction_grants: transactionGrantsStr, color_ring, color_bg, color_badge_bg, color_badge_text, is_active, sort, created_by: req.user?.id },
        });
        success(res, bigintToNumber(created), 'Template created');
      }
    } catch (err: any) { console.error('Template save error:', err); error(res, 'Failed to save template', 500); }
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { error(res, 'Failed to list permissions', 500); }
  }

  static async permissionCreate(req: Request, res: Response): Promise<void> {
    try {
      success(res, { status: 1 }, 'Success', 200, {
        master: { statuses: STATUSES },
      });
    } catch (err: any) { error(res, 'Failed to load permission', 500); }
  }

  static async permissionStore(req: Request, res: Response): Promise<void> {
    try {
      const { name, guard_name, display_name, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }
      const perm = await getPrisma().permissions.create({
        data: { name, guard_name: guard_name || 'web', display_name: display_name || null, status: status === true || status === 'true' || status === 1 || status === '1' || status?.value === 1 || status?.value === true ? 1 : (status === false || status === 'false' || status === 0 || status === '0' || status?.value === 0 || status?.value === false ? 0 : (Number(status) || 1)), created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(perm), 'Permission created');
    } catch (err: any) { error(res, 'Failed to create permission', 500); }
  }

  static async permissionShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const perm = await getPrisma().permissions.findUnique({ where: { id } });
      if (!perm) { notFound(res, 'Permission not found'); return; }
      const master = { statuses: STATUSES };
      success(res, bigintToNumber(perm), 'Success', 200, { master });
    } catch (err: any) { error(res, 'Failed to load permission', 500); }
  }

  static async permissionEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const perm = await getPrisma().permissions.findUnique({ where: { id } });
      if (!perm) { notFound(res, 'Permission not found'); return; }
      const master = { statuses: STATUSES };
      success(res, bigintToNumber(perm), 'Success', 200, { master });
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
      if (status !== undefined) data.status = status === true || status === 'true' || status === 1 || status === '1' || status?.value === 1 || status?.value === true ? 1 : (status === false || status === 'false' || status === 0 || status === '0' || status?.value === 0 || status?.value === false ? 0 : Number(status));
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
        // @ts-ignore
        menus.filter(m => m.parent_id === parentId).map(m => ({
          ...bigintToNumber(m), label: labelFromMenuName(m.name),
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
          sort: sort ?? 0, status: status === true || status === 'true' || status === 1 || status === '1' || status?.value === 1 || status?.value === true ? 1 : (status === false || status === 'false' || status === 0 || status === '0' || status?.value === 0 || status?.value === false ? 0 : (Number(status) || 1)),
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
      if (sort !== undefined) upd.sort = Number(sort);
      if (status !== undefined) upd.status = status === true || status === 'true' || status === 1 || status === '1' || status?.value === 1 || status?.value === true ? 1 : (status === false || status === 'false' || status === 0 || status === '0' || status?.value === 0 || status?.value === false ? 0 : Number(status));
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
          await getPrisma().menus.update({ where: { id: BigInt(item.id) }, data: { sort: Number(item.sort ?? 0), parent_id: item.parent_id ? BigInt(item.parent_id) : null, updated_at: new Date() } });
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
      const group = req.query.group as string;
      const where: any = { property_id: pid };
      if (group) where.group = group;
      
      const data = await getPrisma().settings.findMany({ where });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to list settings', 500); }
  }

  static async settingStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = Array.isArray(req.body) ? req.body : [req.body];
      
      for (const item of body) {
        if (!item.key) continue;
        const keyStr = item.key.replace(/ /g, '_');
        const existing = await getPrisma().settings.findFirst({ where: { property_id: pid, key: keyStr } });
        if (existing) {
          await getPrisma().settings.update({ where: { id: existing.id }, data: { value: item.value } });
        } else {
          await getPrisma().settings.create({ data: { property_id: pid, key: keyStr, value: item.value } });
        }
      }
      success(res, null, 'Setting saved');
    } catch (err: any) { console.error('Settings save error:', err); error(res, 'Failed to save setting', 500); }
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      // Push SSE notification to target user
      if (to_user_id) {
        notificationService.push(BigInt(to_user_id), 'task-created', {
          id: Number(task.id),
          type: 'task',
          message: task.message || 'New task assigned',
          room_number: task.room_number,
          priority: task.priority,
          time: task.created_at?.toISOString() || new Date().toISOString(),
        });
      }
      success(res, bigintToNumber(task), 'Task created');
    } catch (err: any) { error(res, 'Failed to create task', 500); }
  }

  // Laravel TaskController@markAsRead (PUT /task/:id/read) â€” also routes hk_/insp_ prefix to markHkRead
  static async taskMarkAsRead(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const user = req.user!;
      if (!raw) { badRequest(res, 'Task not found'); return; }

      if (String(raw).startsWith('hk_') || String(raw).startsWith('insp_')) {
        const roomId = String(raw).replace(/^(hk_|insp_)/, '');
        const type = String(raw).startsWith('insp_') ? 'inspection_required' : 'housekeeper_assignment';
        const body = req.body || {};
        const hk = await AdminController.taskMarkHkReadInner(user, type, roomId, body.date);
        res.json(hk);
        return;
      }

      const task = await getPrisma().tasks.findUnique({ where: { id: BigInt(raw) } });
      if (!task) { notFound(res, 'Task not found'); return; }
      await getPrisma().task_reads.upsert({
        where: { task_id_user_id: { task_id: task.id, user_id: user.id } },
        create: { task_id: task.id, user_id: user.id, read_at: new Date() },
        update: { read_at: new Date() },
      });
      res.json({ code: 200, message: 'Task marked as read' });
    } catch (err: any) { console.error('Task mark as read error:', err); error(res, 'Failed to mark task as read', 500); }
  }

  // Laravel TaskController@markHkRead (POST /task/mark-hk-read)
  static async taskMarkHkRead(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const hk = await AdminController.taskMarkHkReadInner(req.user!, body.type, body.room_id, body.date);
      res.json(hk);
    } catch (err: any) { console.error('Task mark hk read error:', err); error(res, 'Failed to mark notification as read', 500); }
  }

  private static async taskMarkHkReadInner(user: any, type: string, roomId: string, date: string): Promise<any> {
    if (!roomId) return { code: 400, message: 'Room ID is required' };
    const day = date || new Date().toISOString().substring(0, 10);
    taskHkReadCache.set(`hk_notification_read_${user.id}_${type}_${roomId}_${day}`, true);
    taskHkReadCache.set(`${`hk_notification_read_${user.id}_${type}_${roomId}_${day}`}_time`, new Date().toISOString());
    return {
      code: 200,
      message: 'Notification marked as read',
      is_read: true,
      id: `${type === 'inspection_required' ? 'insp_' : 'hk_'}${roomId}`,
    };
  }

  // Laravel TaskController@update (PUT /task/:id)
  static async taskUpdate(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Task not found'); return; }
      const status = String(req.body?.status ?? '');
      if (!['Open', 'In Progress', 'Closed'].includes(status)) { badRequest(res, 'The selected status is invalid.'); return; }
      const task = await getPrisma().tasks.update({
        where: { id: BigInt(raw) },
        data: { status: status as any, updated_at: new Date() },
      });
      // Push SSE notification to task owner
      if (task.to_user_id) {
        notificationService.push(task.to_user_id, 'task-updated', {
          id: Number(task.id),
          type: 'task',
          status: task.status,
          message: `Task status changed to ${task.status}`,
          room_number: task.room_number,
          time: new Date().toISOString(),
        });
      }
      res.json({ code: 200, message: 'Task status updated successfully', data: bigintToNumber(task) });
    } catch (err: any) { console.error('Task update error:', err); error(res, 'Failed to update task', 500); }
  }

  // Laravel TaskController@reply (POST /task/:id/reply)
  static async taskReply(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Task not found'); return; }
      const message = String(req.body?.message ?? '');
      if (!message) { badRequest(res, 'The message field is required.'); return; }
      const parent = await getPrisma().tasks.findUnique({ where: { id: BigInt(raw) } });
      if (!parent) { notFound(res, 'Task not found'); return; }
      const reply = await getPrisma().tasks.create({
        data: {
          created_by: req.user!.id,
          parent_id: parent.id,
          message,
          type: 'Reply',
          status: 'Open',
          created_on: new Date(),
          room_number: parent.room_number,
          to_user_id: parent.created_by,
          to_role_id: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      // Push SSE notification to task creator (parent task owner)
      if (parent.created_by) {
        notificationService.push(parent.created_by, 'task-reply', {
          id: Number(reply.id),
          parent_id: Number(parent.id),
          type: 'task',
          message: reply.message || 'New reply',
          room_number: reply.room_number,
          time: reply.created_at?.toISOString() || new Date().toISOString(),
        });
      }
      res.json({ code: 200, message: 'Reply sent successfully', data: bigintToNumber(reply) });
    } catch (err: any) { console.error('Task reply error:', err); error(res, 'Failed to send reply', 500); }
  }

  // Laravel TaskController@thread (GET /task/:id/thread)
  static async taskThread(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Task not found'); return; }
      const user = req.user!;
      const task = await getPrisma().tasks.findUnique({
        where: { id: BigInt(raw) },
        include: { users_tasks_created_byTousers: { select: { id: true, name: true, username: true } } },
      });
      if (!task) { notFound(res, 'Task not found'); return; }
      const replies = await getPrisma().tasks.findMany({
        where: { parent_id: task.id },
        include: { users_tasks_created_byTousers: { select: { id: true, name: true, username: true } } },
        orderBy: { created_at: 'asc' },
      });
      // @ts-ignore
      const myReads = await getPrisma().task_reads.findMany({ where: { user_id: user.id, task_id: { in: [task.id, ...replies.map(r => r.id)] } }, select: { task_id: true } });
      // @ts-ignore
      const readIds = new Set(myReads.map(r => r.task_id.toString()));
      const fmt = (d: any) => (d instanceof Date ? d.toISOString().substring(0, 16).replace('T', ' ') : String(d ?? '').substring(0, 16));
      const fromName = (createdBy: bigint, creator: any) => creator?.name || creator?.username || `User #${createdBy}`;
      const taskFrom = task.created_by === user.id ? 'You' : fromName(task.created_by, task.users_tasks_created_byTousers);
      res.json({
        code: 200,
        data: {
          task: {
            id: Number(task.id),
            message: task.message,
            type: task.type,
            status: task.status,
            created_at: fmt(task.created_at),
            room_number: task.room_number,
            from: taskFrom,
            isMe: task.created_by === user.id,
            is_read: readIds.has(task.id.toString()),
          },
          // @ts-ignore
          replies: replies.map(r => ({
            id: Number(r.id),
            message: r.message,
            created_at: fmt(r.created_at),
            from: r.created_by === user.id ? 'You' : fromName(r.created_by, r.users_tasks_created_byTousers),
            isMe: r.created_by === user.id,
            is_read: readIds.has(r.id.toString()),
          })),
        },
      });
    } catch (err: any) { console.error('Task thread error:', err); error(res, 'Failed to load thread', 500); }
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
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid, deleted_at: null };
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
        client.users.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        client.users.count({ where }),
      ]);
      console.log('[DEBUG] userList found', users.length, 'users');
      // @ts-ignore
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
      // @ts-ignore
      const formatted = users.map(u => ({ ...bigintToNumber(u), roles: rolesMap.get(u.id) || [] }));
      // @ts-ignore
      const rows = formatted.map((u, i) => ({ ...u, no: (page - 1) * limit + i + 1 }));
      success(res, rows, 'Success', 200, {
        table: TABLES.user,
        pagination: laravelPaging(total, limit, page),
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      // Laravel PropertyController@index:36-37 — the default limit is 999 (not 10)
      // and the property page sends its search term as `name`, not `search`.
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 999;
      const search = (req.query.search as string) || (req.query.name as string) || '';
      const order = req.query.order === 'asc' ? 'asc' : 'desc';

      // The property page reuses `trash` as a status filter: 0 = all, 1 = active,
      // -1 = inactive. It is not a soft-delete switch.
      const statusFilter = parseInt(req.query.trash as string) || 0;
      const where: any = { deleted_at: null };
      if (statusFilter === 1) where.status = 1;
      else if (statusFilter === -1) where.status = 0;
      if (search) where.name = { contains: search, mode: 'insensitive' };

      // Laravel PropertyController@index:30-52 — only users with the developer or
      // anyaman role (auth.middleware sets superUser for exactly those) see every
      // property; everyone else is limited to the properties they are linked to.
      // This endpoint also backs the /choose-property page.
      if (!req.user?.superUser && req.user?.id) {
        const links = await getPrisma().model_has_properties.findMany({
          where: { model_id: req.user.id, model_type: 'App\\Models\\User' },
          select: { property_id: true },
        });
        where.id = { in: links.map((l: any) => l.property_id) };
      }

      const [data, total] = await Promise.all([
        getPrisma().properties.findMany({
          where,
          orderBy: { id: order },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            name: true,
            alias: true,
            email: true,
            address: true,
            telp: true,
            logo: true,
            status: true,
            join_date: true,
            ip_whitelist: true,
            subscribe_type: true,
            market_segment_1: true,
            cities: { select: { name: true } },
            _count: { select: { rooms: { where: { deleted_at: null } } } },
          },
        }),
        getPrisma().properties.count({ where }),
      ]);

      // Return a lightweight URL instead of massive Base64 blobs.
      // Frontend <img src={row.image}> will lazily fetch the actual image.
      // @ts-ignore
      const mapped = data.map(p => {
        // Laravel Property::formatData() maps market_segment_1 through
        // config('cms.subscribe_type'), so the label follows that boolean.
        const subscribe = SUBSCRIBE_TYPES.find(s => s.value === (p.market_segment_1 ? 1 : 0));
        return {
          id: Number(p.id),
          name: p.name,
          alias: p.alias,
          // Absolute-from-API-root paths: the frontend prefixes env.uriApi, the
          // same convention as table-view-document and work-order images.
          // storedImageUrl() returns null for legacy base64 columns, so those
          // rows fall through to the /cms/property/:id/image handler instead of
          // emitting '/storage' + <base64>.
          image: storedImageUrl(p.logo) || `/cms/property/${Number(p.id)}/image`,
          email: p.email,
          address: p.address,
          phone: p.telp ? Number(p.telp) : null,
          // Remaining formatTable() columns. subscribe_types and city are also
          // mirrored under `relation` for consumers that read the nested shape.
          status: getStatusLabel(p.status),
          room_count: p._count.rooms,
          subscribe_types: [{ value: p.subscribe_type, label: subscribe?.label ?? 'Monthly' }],
          join_date: p.join_date ? new Date(p.join_date).toISOString().substring(0, 10) : null,
          whitelist_ip: p.ip_whitelist || '',
          city: p.cities?.name || null,
          relation: p.cities
            ? { cities: { label: p.cities.name }, subscribe_types: [{ value: p.subscribe_type, label: subscribe?.label ?? 'Monthly' }] }
            : null,
        };
      });

      success(res, mapped, 'Success', 200, {
        table: TABLES.property,
        pagination: laravelPaging(total, limit, page),
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

  /**
   * GET /cms/property/:id/image
   * Serves property logo/image as binary (not encrypted) so <img src> works.
   * This keeps the list endpoint tiny while images load lazily.
   */
  // static async propertyImage(req: Request, res: Response): Promise<void> {
  //   try {
  //     const id = BigInt(String(req.params.id));
  //     const property = await getPrisma().properties.findUnique({
  //       where: { id },
  //       select: { logo: true, image: true },
  //     });
  //     if (!property) { res.status(404).send('Not found'); return; }

  //     const raw = property.logo || property.image;
  //     if (!raw) { res.status(404).send('No image'); return; }

  //     // If it's a Base64 data URI like "data:image/png;base64,iVBOR..."
  //     const dataUriMatch = raw.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  //     if (dataUriMatch) {
  //       const mimeType = dataUriMatch[1];
  //       const base64Data = dataUriMatch[2];
  //       const buffer = Buffer.from(base64Data, 'base64');
  //       res.setHeader('Content-Type', mimeType);
  //       res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 1 day
  //       res.send(buffer);
  //       return;
  //     }

  //     // If it's a plain Base64 string without data URI prefix
  //     if (/^[A-Za-z0-9+/=]{100,}$/.test(raw.replace(/\s/g, ''))) {
  //       const buffer = Buffer.from(raw, 'base64');
  //       res.setHeader('Content-Type', 'image/png');
  //       res.setHeader('Cache-Control', 'public, max-age=86400');
  //       res.send(buffer);
  //       return;
  //     }

  //     // If it's a URL path, redirect to it
  //     res.redirect(raw);
  //   } catch (err: any) {
  //     console.error('Property image error:', err);
  //     res.status(500).send('Error');
  //   }
  // }

  // Fallback route: properties without a usable `logo` path (seeded rows, or
  // legacy rows whose column still holds a base64 blob) resolve to
  // storage/cms/property/<id>/image.png. New uploads are served straight off
  // /storage by express.static and never reach this handler.
  static async propertyImage(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      if (!/^\d+$/.test(id)) { res.status(400).send('Bad id'); return; }

      const property = await getPrisma().properties.findUnique({
        where: { id: BigInt(id) },
        select: { logo: true },
      });
      if (!property) { res.status(404).send('Not found'); return; }

      // Legacy row: the column is the image itself, so stream it back inline
      // rather than 404-ing while the backfill script has yet to run.
      if (isInlineImageData(property.logo)) {
        const m = String(property.logo).match(/^data:(image\/\w+);base64,(.*)$/s);
        if (m) {
          res.setHeader('Content-Type', m[1]);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.send(Buffer.from(m[2], 'base64'));
          return;
        }
      }

      const candidates = [
        property.logo ? resolveStoredPath(property.logo) : null,
        path.join(STORAGE_PATH, 'cms', 'property', id, 'image.png'),
        path.join(STORAGE_PATH, 'property', id, 'image.png'),
      ].filter((p): p is string => !!p && fs.existsSync(p));

      const filePath = candidates[0];
      if (!filePath) { res.status(404).send('No image'); return; }

      res.setHeader('Content-Type', mimeFromPath(filePath));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(filePath);
    } catch (err: any) {
      console.error('Property image error:', err);
      res.status(500).send('Error');
    }
  }

  static async propertyAuth(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const property = await getPrisma().properties.findUnique({
        where: { id },
        select: { id: true, name: true, alias: true, address: true, email: true, telp: true, logo: true, mandatory_check_in: true },
      });
      if (!property) { notFound(res, 'Property not found'); return; }

      // Update user's last used property
      const user = await getPrisma().users.update({
        where: { id: req.user!.id },
        data: { last_property: id },
      });

      // Get user roles
      const modelRoles = await getPrisma().model_has_roles.findMany({
        where: {
          model_type: 'App\\Models\\User',
          model_id: user.id,
        },
        include: { roles: true },
      });
      // @ts-ignore
      const roleNames = modelRoles.map(mr => mr.roles.name);
      // @ts-ignore
      const roleIds = modelRoles.map(mr => mr.roles.id);
      if (roleNames.length === 0) { badRequest(res, 'Role not found'); return; }

      // Fresh token scoped to the property (Laravel: createToken($email, ['can-'.$id]))
      const { plainTextToken, createdAt } = await TokenService.createToken(user.id, user.email, [`can-${id}`]);

      // Full login payload scoped to the new property
      const data = await AuthController.buildLoginData(user, roleIds, roleNames, plainTextToken, createdAt, id);

      // Raw response — Laravel PropertyController@auth puts name/image/mandatory_check_in
      // at the TOP LEVEL and the user payload inside `data` (Profile.tsx reads
      // datajsonp?.name + datajsonp?.data.* after choosing a property).
      // Use lightweight URL path instead of massive Base64 blob.
      res.status(200).json({
        code: 200,
        message: 'Success',
        name: property.name,
        image: storedImageUrl(property.logo) || `/cms/property/${Number(id)}/image`,
        // Laravel sends the configured list verbatim. Was hardcoded `[]`,
        // which meant the client never learned a check-in gate existed.
        mandatory_check_in: normalizeMandatoryList((property as any).mandatory_check_in),
        data,
      });
    } catch (err: any) {
      console.error('Property auth error:', err);
      error(res, 'Failed to authenticate property', 500);
    }
  }

  // Replicates Laravel PropertyController@create master (statuses/companies/is_taxs/is_tax_exclude_restaurants/market_segments/subscribe_types/regions) + node extras.
  private static async buildPropertyMaster(): Promise<{ [key: string]: any }> {
    const [cities, countries, companies] = await Promise.all([
      Promise.resolve([]),
      getPrisma().countries.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      getPrisma().companies.findMany({
        where: { deleted_at: null, status: 1 },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      cities: cities.map((c: any) => ({ value: Number(c.id), label: c.name })),
      countries: countries.map((c: any) => ({ value: Number(c.id), label: c.name })),
      statuses: STATUSES,
      // Values MUST be guest_profiles column names — the check-in gate reads
      // them straight off the guest row.
      mandatory_check_in_options: Object.entries(MANDATORY_FIELD_LABELS).map(([value, label]) => ({ value, label })),
      companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
      is_taxs: IS_TAXS,
      is_tax_exclude_restaurants: IS_TAX_EXCLUDE_RESTAURANTS,
      market_segments: STATUSES,
      subscribe_types: SUBSCRIBE_TYPES,
      regions: REGIONS,
    };
  }

  static async propertyCreate(req: Request, res: Response): Promise<void> {
    try {
      const master = await AdminController.buildPropertyMaster();
      success(res, { status: 1 }, 'Success', 200, {
        table: [],
        master,
        search_data: [],
        permission: { view: true, add: true, edit: true, delete: true },
      });
    } catch (err: any) {
      console.error('Property create form error:', err);
      error(res, 'Failed to load form', 500);
    }
  }

  static async propertyStore(req: Request, res: Response): Promise<void> {
    try {
      const b = req.body || {};
      if (!b.name) { validationError(res, { name: ['The name field is required.'] }); return; }
      const now = new Date();
      // Laravel PropertyController@store decodes the base64 logo to
      // storage/property/<name>-<ts>.<ext> and persists only that path.
      const logoPath = savePropertyLogo(b.logo, b.name);
      const optBigInt = (v: any) => (v === null || v === undefined || v === '' ? null : BigInt(String(v)));
      const data: any = {
        name: b.name,
        alias: b.alias || null,
        email: b.email || null,
        telp: b.telp ? BigInt(String(b.telp)) : null,
        fax: b.fax ? BigInt(String(b.fax)) : null,
        address: b.address || null,
        logo: logoPath,
        image: b.image || null,
        slug: b.slug || null,
        whatsapp: b.whatsapp || null,
        bank_name: b.bank_name || null,
        bank_account_no: b.bank_account_no || null,
        city_id: b.city_id ? BigInt(String(b.city_id)) : null,
        country_id: b.country_id ? BigInt(String(b.country_id)) : null,
        region: b.region || null,
        latitude: b.latitude || null,
        longitude: b.longitude || null,
        status: b.status !== undefined && b.status !== null ? Number(b.status) : 1,
        is_tax: b.is_tax === undefined || b.is_tax === null ? 0 : Number(!!b.is_tax),
        is_tax_exclude_room: b.is_tax_exclude_room === undefined || b.is_tax_exclude_room === null ? 0 : Number(!!b.is_tax_exclude_room),
        is_tax_exclude_restaurant: b.is_tax_exclude_restaurant === undefined || b.is_tax_exclude_restaurant === null ? 0 : Number(!!b.is_tax_exclude_restaurant),
        subscribe_type: b.subscribe_type === undefined ? false : !!b.subscribe_type,
        market_segment_1: b.market_segment_1 === undefined ? true : !!b.market_segment_1,
        market_segment_2: b.market_segment_2 === undefined ? true : !!b.market_segment_2,
        market_segment_3: b.market_segment_3 === undefined ? true : !!b.market_segment_3,
        market_segment_4: b.market_segment_4 === undefined ? true : !!b.market_segment_4,
        source: b.source === undefined ? true : !!b.source,
        ip_whitelist: Array.isArray(b.ip_whitelist) ? b.ip_whitelist.map((ip: any) => typeof ip === 'object' && ip !== null && ip.value ? ip.value : ip).filter(Boolean).join(',') : (b.ip_whitelist || null),
        ip_doorlock: b.ip_doorlock || null,
        // Form posts an array of guest_profiles column names; column is jsonb.
        mandatory_check_in: normalizeMandatoryList(b.mandatory_check_in),
        day_use_item_code: optBigInt(b.day_use_item_code),
        pb1_account_uid: optBigInt(b.pb1_account_uid),
        service_charge_account_uid: optBigInt(b.service_charge_account_uid),
        tax_account_uid: optBigInt(b.tax_account_uid),
        surcharge_account_uid: optBigInt(b.surcharge_account_uid),
        advance_deposit_current_day_account_uid: optBigInt(b.advance_deposit_current_day_account_uid),
        advance_deposit_previous_day_account_uid: optBigInt(b.advance_deposit_previous_day_account_uid),
        guest_ledger_current_day_account_uid: optBigInt(b.guest_ledger_current_day_account_uid),
        guest_ledger_previous_day_account_uid: optBigInt(b.guest_ledger_previous_day_account_uid),
        contract_expired: b.contract_expired ? new Date(b.contract_expired) : new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
        join_date: b.join_date ? new Date(b.join_date) : now,
        created_by: req.user?.id ? BigInt(String(req.user.id)) : null,
        created_at: now,
        updated_at: now,
      };
      const record = await getPrisma().properties.create({ data });
      success(res, { ...bigintToNumber(record), id: Number(record.id) }, 'Created', 200, {
        table: [], search_data: [], permission: { view: true, add: true, edit: true, delete: true },
      });
    } catch (err: any) {
      console.error('Property store error:', err);
      if ((err as any).code === 'P2002') badRequest(res, 'Duplicate entry');
      else error(res, 'Failed to create property', 500);
    }
  }

  static async propertyEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const property = await getPrisma().properties.findUnique({
        where: { id },
        include: { cities: { select: { id: true, name: true } } },
      });
      if (!property) { notFound(res, 'Property not found'); return; }

      const [master, companies, gls, item, roomCount] = await Promise.all([
        AdminController.buildPropertyMaster(),
        // Laravel formatData():262 — the property's own company, first one only.
        getPrisma().model_has_companies.findMany({
          where: { model_id: id, model_type: 'App\\Models\\Property' },
          select: { company_id: true },
        }),
        getPrisma().code_gls.findMany({ select: { id: true, name: true, description: true } }),
        property.day_use_item_code
          ? getPrisma().code_items.findUnique({
              where: { id: property.day_use_item_code },
              select: { id: true, name: true, description: true },
            })
          : Promise.resolve(null),
        getPrisma().rooms.count({ where: { property_id: id, deleted_at: null } }),
      ]);

      const p: any = property;
      const statusOpt = getStatusLabel(p.status);
      const glOpt = (v: any) => {
        if (v === null || v === undefined) return { value: null, label: '' };
        const gl = gls.find((g: any) => g.id.toString() === v.toString());
        return { value: Number(v), label: gl ? `${gl.description} (${gl.name})` : '' };
      };
      // Laravel formatData():283 derives the subscribe_type label from
      // market_segment_1, not from the subscribe_type column itself.
      const subscribeLabel = p.market_segment_1 ? 'Yearly' : 'Monthly';
      const companyIds = companies.map((c: any) => c.company_id);
      const company = companyIds.length
        ? master.companies.find((c: any) => companyIds.some((cid: any) => cid.toString() === String(c.value)))
        : null;

      const data = {
        id: Number(p.id),
        city: p.cities?.name ?? null,
        url: `/cms/property/auth/${Number(p.id)}`,
        name: p.name,
        alias: p.alias,
        telp: p.telp !== null ? Number(p.telp) : null,
        whatsapp: p.whatsapp,
        email: p.email,
        address: p.address,
        room_count: roomCount,
        is_tax: { value: !!p.is_tax, label: p.is_tax ? 'Yes' : 'No' },
        is_tax_exclude_room: { value: !!p.is_tax_exclude_room, label: p.is_tax_exclude_room ? 'Yes' : 'No' },
        is_tax_exclude_restaurant: { value: !!p.is_tax_exclude_restaurant, label: p.is_tax_exclude_restaurant ? 'Yes' : 'No' },
        image: storedImageUrl(p.logo) || `/cms/property/${Number(p.id)}/image`,
        logo: storedImageUrl(p.logo) || `/cms/property/${Number(p.id)}/image`,
        ip_doorlock: p.ip_doorlock,
        // TagsInput expects a list, Laravel formatData():224 explodes on comma.
        ip_whitelist: p.ip_whitelist ? String(p.ip_whitelist).split(',').map(s => s.trim()) : [],
        latitude: p.latitude,
        longitude: p.longitude,
        region: p.region,
        country_id: p.country_id !== null ? Number(p.country_id) : null,
        city_id: p.city_id !== null ? Number(p.city_id) : null,
        pb1_account_uid: glOpt(p.pb1_account_uid),
        service_charge_account_uid: glOpt(p.service_charge_account_uid),
        tax_account_uid: glOpt(p.tax_account_uid),
        surcharge_account_uid: glOpt(p.surcharge_account_uid),
        advance_deposit_current_day_account_uid: glOpt(p.advance_deposit_current_day_account_uid),
        advance_deposit_previous_day_account_uid: glOpt(p.advance_deposit_previous_day_account_uid),
        guest_ledger_current_day_account_uid: glOpt(p.guest_ledger_current_day_account_uid),
        guest_ledger_previous_day_account_uid: glOpt(p.guest_ledger_previous_day_account_uid),
        day_use_item_code: item
          ? { value: Number(item.id), label: `${item.description ?? ''} (${item.name})` }
          : { value: null, label: '' },
        contract_expired: p.contract_expired ? new Date(p.contract_expired).toISOString().substring(0, 10) : null,
        join_date: p.join_date ? new Date(p.join_date).toISOString().substring(0, 10) : null,
        status: { value: statusOpt.value, label: statusOpt.label },
        market_segment_1: { value: p.market_segment_1 ? 1 : 0, label: p.market_segment_1 ? 'Active' : 'Inactive' },
        market_segment_2: { value: p.market_segment_2 ? 1 : 0, label: p.market_segment_2 ? 'Active' : 'Inactive' },
        market_segment_3: { value: p.market_segment_3 ? 1 : 0, label: p.market_segment_3 ? 'Active' : 'Inactive' },
        market_segment_4: { value: p.market_segment_4 ? 1 : 0, label: p.market_segment_4 ? 'Active' : 'Inactive' },
        source: { value: p.source ? 1 : 0, label: p.source ? 'Active' : 'Inactive' },
        is_market_segment_1: !!p.market_segment_1,
        is_market_segment_2: !!p.market_segment_2,
        is_market_segment_3: !!p.market_segment_3,
        is_market_segment_4: !!p.market_segment_4,
        is_source: !!p.source,
        // `external_ar` is not a column; `mandatory_check_in` now is.
        external_ar: { value: '0', label: 'Inactive' },
        is_external: false,
        mandatory_check_in: normalizeMandatoryList(p.mandatory_check_in),
        subscribe_type: { value: p.subscribe_type ? 1 : 0, label: subscribeLabel },
        created_at: bigintToNumber(p.created_at),
        created_by: p.created_by !== null ? Number(p.created_by) : null,
        relation: {
          companies: company || null,
          cities: { value: p.cities ? Number(p.cities.id) : null, label: p.cities?.name ?? null },
          regions: { value: p.region, label: p.region },
          countries: { value: p.country_id !== null ? Number(p.country_id) : null, label: null },
          subscribe_types: { value: p.subscribe_type ? 1 : 0, label: subscribeLabel },
        },
      };

      success(res, data, 'Success', 200, {
        table: [],
        master,
        search_data: [],
        permission: { view: true, add: true, edit: true, delete: true },
      });
    } catch (err: any) {
      console.error('Property edit form error:', err);
      error(res, 'Failed to load property', 500);
    }
  }

  static async propertyUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const existing = await getPrisma().properties.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Property not found'); return; }
      const b = req.body || {};
      // A base64 data-URI means "new upload": write it to storage and swap the
      // stored path. Anything else (existing path, empty) keeps the current logo,
      // matching Laravel PropertyController@update's else-branch.
      const uploaded = savePropertyLogo(b.logo, b.name ?? existing.name);
      // Laravel PropertyController@update persists every column the form posts
      // (market segments, tax flags, GL accounts, whitelist, dates), so the
      // node version has to write them too or the form looks like it forgets.
      const optBigInt = (v: any, cur: any) =>
        v === null || v === undefined || v === '' ? null : BigInt(String(v));
      const optBool = (v: any, cur: any) => (v === undefined ? cur : !!v);
      const optInt = (v: any, cur: any) => (v === undefined || v === null ? cur : Number(v));
      const data: any = {
        name: b.name ?? existing.name,
        alias: b.alias !== undefined ? b.alias : existing.alias,
        email: b.email !== undefined ? b.email : existing.email,
        telp: b.telp ? BigInt(String(b.telp)) : (b.telp === null || b.telp === '' ? null : existing.telp),
        fax: b.fax ? BigInt(String(b.fax)) : (b.fax === null || b.fax === '' ? null : existing.fax),
        address: b.address !== undefined ? b.address : existing.address,
        logo: uploaded ?? existing.logo,
        image: b.image !== undefined ? b.image : existing.image,
        slug: b.slug !== undefined ? b.slug : existing.slug,
        whatsapp: b.whatsapp !== undefined ? b.whatsapp : existing.whatsapp,
        bank_name: b.bank_name !== undefined ? b.bank_name : existing.bank_name,
        bank_account_no: b.bank_account_no !== undefined ? b.bank_account_no : existing.bank_account_no,
        city_id: b.city_id ? BigInt(String(b.city_id)) : (b.city_id === null || b.city_id === '' ? null : existing.city_id),
        country_id: b.country_id ? BigInt(String(b.country_id)) : (b.country_id === null || b.country_id === '' ? null : existing.country_id),
        region: b.region !== undefined ? b.region : existing.region,
        latitude: b.latitude !== undefined ? b.latitude : existing.latitude,
        longitude: b.longitude !== undefined ? b.longitude : existing.longitude,
        status: b.status !== undefined && b.status !== null ? Number(b.status) : existing.status,
        is_tax: optInt(b.is_tax, existing.is_tax),
        is_tax_exclude_room: optInt(b.is_tax_exclude_room, existing.is_tax_exclude_room),
        is_tax_exclude_restaurant: optInt(b.is_tax_exclude_restaurant, existing.is_tax_exclude_restaurant),
        subscribe_type: optBool(b.subscribe_type, existing.subscribe_type),
        market_segment_1: optBool(b.market_segment_1, existing.market_segment_1),
        market_segment_2: optBool(b.market_segment_2, existing.market_segment_2),
        market_segment_3: optBool(b.market_segment_3, existing.market_segment_3),
        market_segment_4: optBool(b.market_segment_4, existing.market_segment_4),
        source: optBool(b.source, existing.source),
        // The form posts a list of IPs; the column is a comma-joined string.
        ip_whitelist: b.ip_whitelist === undefined
          ? existing.ip_whitelist
          : (Array.isArray(b.ip_whitelist) ? b.ip_whitelist.map((ip: any) => typeof ip === 'object' && ip !== null && ip.value ? ip.value : ip).filter(Boolean).join(',') : b.ip_whitelist),
        ip_doorlock: b.ip_doorlock !== undefined ? b.ip_doorlock : existing.ip_doorlock,
        // An empty selection clears the gate (Laravel merges `[]` when the
        // payload is not an array); absent key leaves it untouched.
        ...(b.mandatory_check_in !== undefined
          ? { mandatory_check_in: normalizeMandatoryList(b.mandatory_check_in) }
          : {}),
        contract_expired: b.contract_expired ? new Date(b.contract_expired) : existing.contract_expired,
        join_date: b.join_date ? new Date(b.join_date) : existing.join_date,
        day_use_item_code: b.day_use_item_code === undefined ? existing.day_use_item_code : optBigInt(b.day_use_item_code, existing.day_use_item_code),
        pb1_account_uid: b.pb1_account_uid === undefined ? existing.pb1_account_uid : optBigInt(b.pb1_account_uid, existing.pb1_account_uid),
        service_charge_account_uid: b.service_charge_account_uid === undefined ? existing.service_charge_account_uid : optBigInt(b.service_charge_account_uid, existing.service_charge_account_uid),
        tax_account_uid: b.tax_account_uid === undefined ? existing.tax_account_uid : optBigInt(b.tax_account_uid, existing.tax_account_uid),
        surcharge_account_uid: b.surcharge_account_uid === undefined ? existing.surcharge_account_uid : optBigInt(b.surcharge_account_uid, existing.surcharge_account_uid),
        advance_deposit_current_day_account_uid: b.advance_deposit_current_day_account_uid === undefined ? existing.advance_deposit_current_day_account_uid : optBigInt(b.advance_deposit_current_day_account_uid, existing.advance_deposit_current_day_account_uid),
        advance_deposit_previous_day_account_uid: b.advance_deposit_previous_day_account_uid === undefined ? existing.advance_deposit_previous_day_account_uid : optBigInt(b.advance_deposit_previous_day_account_uid, existing.advance_deposit_previous_day_account_uid),
        guest_ledger_current_day_account_uid: b.guest_ledger_current_day_account_uid === undefined ? existing.guest_ledger_current_day_account_uid : optBigInt(b.guest_ledger_current_day_account_uid, existing.guest_ledger_current_day_account_uid),
        guest_ledger_previous_day_account_uid: b.guest_ledger_previous_day_account_uid === undefined ? existing.guest_ledger_previous_day_account_uid : optBigInt(b.guest_ledger_previous_day_account_uid, existing.guest_ledger_previous_day_account_uid),
        updated_by: req.user?.id ? BigInt(String(req.user.id)) : null,
        updated_at: new Date(),
      };
      const record = await getPrisma().properties.update({ where: { id }, data });
      // Only unlink after the row is committed, and never the seeded
      // storage/cms|property/<id>/image.png fallbacks.
      if (uploaded && existing.logo && !/^\/cms\/|^\/property\/\d+\//.test(existing.logo)) {
        deleteStoredFile(existing.logo);
      }
      success(res, { ...bigintToNumber(record), id: Number(record.id) }, 'Updated');
    } catch (err: any) {
      console.error('Property update error:', err);
      error(res, 'Failed to update property', 500);
    }
  }

  static async propertyDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const existing = await getPrisma().properties.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Property not found'); return; }
      await getPrisma().properties.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Deleted');
    } catch (err: any) {
      console.error('Property destroy error:', err);
      error(res, 'Failed to delete property', 500);
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
      // @ts-ignore
      const roots = allMenus.filter(m => !m.parent_id && !excluded.includes(m.id));
      // @ts-ignore
      const data = roots.map(m => toMenuResource(m, allMenus, excluded, 0, 0, req.user));

      const page = parseInt(String(req.query.page)) || 1;
      const limit = parseInt(String(req.query.limit)) || 99999;
      const totalPages = Math.max(1, Math.ceil(allMenus.length / limit));
      const pagination = {
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
        // Laravel MenuController@index parity â€” table-drag renders data?.table?.map + row.status?.label
        table: [
          { label: 'Status', key: 'status', type: 'none', is_search: false },
          { label: 'Name', key: 'name', type: 'none', is_search: true },
          { label: 'Url', key: 'url', type: 'none', is_search: false },
        ],
        pagination,
        permission: { view: perms.view, add: perms.edit, edit: perms.edit, delete: perms.edit },
        // @ts-ignore
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
      const pid = req.user?.lastProperty ?? 0n;
      const users = await getPrisma().users.findMany({
        where: { property_id: pid, status: 1 },
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
      const pid = req.user?.lastProperty ?? 0n;
      const roles = await getPrisma().roles.findMany({
        where: { property_id: pid, deleted_at: null },
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

// Normalize menu label: dash/underscore -> space, every word title-cased
// ("work_orders" -> "Work Orders", "ROOM-S" -> "Room S", "shift" -> "Shift").
// Applies to plain slugs and JSON translation values ({en,id}).
function titleCaseMenuLabel(str: string): string {
  return str
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeMenuLabel(val: any): any {
  const parsed = parseJsonField(val, {});
  if (typeof parsed === 'string') {
    const title = titleCaseMenuLabel(parsed);
    return { en: title, id: title };
  }
  if (parsed && typeof parsed === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = typeof v === 'string' ? titleCaseMenuLabel(v) : v;
    }
    return out;
  }
  return parsed;
}

function labelFromMenuName(val: any): string {
  const parsed = parseJsonField(val, {});
  if (typeof parsed === 'string') return titleCaseMenuLabel(parsed);
  if (parsed && typeof parsed === 'object') {
    const en = typeof parsed.en === 'string' ? titleCaseMenuLabel(parsed.en) : parsed.en;
    const id = typeof parsed.id === 'string' ? titleCaseMenuLabel(parsed.id) : parsed.id;
    return en || id || '';
  }
  return '';
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

// parent menu id -> (child url -> child visibility), restricted to leaf children.
// Container rows often reuse one of their leaf children's path as the landing
// target, so that leaf is the authoritative owner of what the path renders.
const menuChildModuleCache = new WeakMap<any[], Map<string, Map<string, string>>>();

function menuChildModules(allMenus: any[]): Map<string, Map<string, string>> {
  const cached = menuChildModuleCache.get(allMenus);
  if (cached) return cached;

  const withChildren = new Set<string>();
  for (const m of allMenus) {
    if (m.parent_id) withChildren.add(m.parent_id.toString());
  }

  const map = new Map<string, Map<string, string>>();
  for (const m of allMenus) {
    const url = m.url || '';
    if (!m.parent_id || !url || url.includes('?') || !m.visibility) continue;
    if (withChildren.has(m.id.toString())) continue;
    const key = m.parent_id.toString();
    const byUrl = map.get(key) || new Map<string, string>();
    if (!byUrl.has(url)) byUrl.set(url, m.visibility);
    map.set(key, byUrl);
  }

  menuChildModuleCache.set(allMenus, map);
  return map;
}

// A menu's `visibility` column doubles as the `module` query param, so a wrong
// value hijacks frontend routing (menus 1121 stored "country" while its url is a
// market segment path, rendering an empty Country table). When a direct leaf
// child owns the same path with a different, non-empty visibility, the child wins.
export function resolveMenuModule(m: any, allMenus: any[]): string {
  const own = m.visibility ?? '';
  const rawUrl = m.url || '';
  if (!rawUrl || rawUrl.includes('?')) return own;
  const byUrl = menuChildModules(allMenus).get(m.id.toString());
  const owner = byUrl ? byUrl.get(rawUrl) : undefined;
  return owner && owner !== own ? owner : own;
}

// Laravel MenuResources parity (recursive)
export function toMenuResource(
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
  const rawModule = m.visibility ?? '';
  const moduleUri = resolveMenuModule(m, allMenus);
  const url = rawUrl
    ? rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'parent=' + parent + '&module=' + moduleUri
    : rawUrl;
  const aliasUrl = rawUrl.includes('?') ? rawUrl.split('?')[0] : rawUrl;
  const perms = menuPermissions(m.id, user);

  const resource: any = {
    no: m.sort ?? 0,
    id: mappedId,
    parent_id: m.parent_id ? Number(m.parent_id) : null,
    page_id: null,
    name: normalizeMenuLabel(m.name),
    url,
    alias_url: aliasUrl,
    recursive: depth,
    media: parseJsonField(m.media, {}),
    target: m.target,
    module: rawModule,
    // table-drag renders status as {value,label} object (Laravel MenuResources getStatus parity)
    status: { value: m.status ?? 0, label: m.status ? 'Active' : 'Inactive' },
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

