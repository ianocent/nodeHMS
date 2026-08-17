import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES } from '../utils/cmsConfig';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bigintToNumber(val: any): any {
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

function laravelPaging(total: number, limit: number, page: number) {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return {
    current_page: page,
    last_page: lastPage,
    per_page: limit,
    total,
    from: total === 0 ? 0 : (page - 1) * limit + 1,
    to: Math.min(page * limit, total),
  };
}

const TABLE = [
  { label: 'Name', key: 'name', type: 'text', is_search: true },
  { label: 'Code', key: 'code', type: 'text', is_search: true },
  { label: 'Module', key: 'module', type: 'text', is_search: false },
  { label: 'Status', key: 'status', type: 'checkbox', is_search: false },
];

/**
 * Approval Matrix â€” custom module (frontend-only pages /approval-matrix).
 * Not present in Laravel backend; provides list/create/update endpoints
 * the frontend already calls.
 */
export class ApprovalMatrixController {

  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const name = (req.query.name as string) || '';
      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const user = req.user as any;
      const pid = user?.lastProperty ?? user?.last_property ?? BigInt(0);

      const where: any = trash ? { deleted_at: { not: null } } : { deleted_at: null };
      where.property_id = pid;
      if (name) where.name = { contains: name, mode: 'insensitive' };

      const total = await prisma.approval_matrices.count({ where });
      const rows = await prisma.approval_matrices.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      });

      const menuIds = [...new Set(rows.map((r: any) => r.module_id).filter((v: any) => v !== null && v !== undefined))];
      const menus = menuIds.length
        ? await prisma.menus.findMany({ where: { id: { in: menuIds } }, select: { id: true, name: true } })
        : [];
      const menuMap = new Map(menus.map((m: any) => [m.id, m.name]));

      const data = rows.map((r: any) => ({
        id: Number(r.id),
        name: r.name,
        code: r.code,
        module: r.module_id !== null && r.module_id !== undefined ? menuMap.get(r.module_id) || String(r.module_id) : '',
        module_id: r.module_id !== null && r.module_id !== undefined ? Number(r.module_id) : null,
        status: r.status ?? 0,
        role_ids: r.role_ids,
      }));

      success(res, bigintToNumber(data), 'Success', 200, {
        table: TABLE,
        permission: getPermissionFlags(req.user as any, 0),
        pagination: laravelPaging(total, limit, page),
      });
    } catch (err: any) {
      console.error('ApprovalMatrix list error:', err);
      error(res, 'Failed to list approval matrix', 500);
    }
  }

  static async createForm(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user as any;
      const pid = user?.lastProperty ?? user?.last_property ?? BigInt(0);
      const [roles, modules] = await Promise.all([
        prisma.roles.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.menus.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
      ]);
      success(res, {
        master: {
          roles: roles.map((r: any) => ({ value: Number(r.id), label: r.name })),
          modules: modules.map((m: any) => ({ value: Number(m.id), label: m.name })),
          statuses: STATUSES,
        },
      }, 'Success');
    } catch (err: any) {
      console.error('ApprovalMatrix createForm error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  static async editForm(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const [row, roles, modules] = await Promise.all([
        prisma.approval_matrices.findUnique({ where: { id } }),
        prisma.roles.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.menus.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
      ]);
      if (!row || row.deleted_at) { notFound(res, 'Approval matrix not found'); return; }

      const roleIds: number[] = Array.isArray(row.role_ids) ? row.role_ids.map((v: any) => Number(v)) : [];

      success(res, {
        master: {
          roles: roles.map((r: any) => ({ value: Number(r.id), label: r.name })),
          modules: modules.map((m: any) => ({ value: Number(m.id), label: m.name })),
          statuses: STATUSES,
        },
        data: {
          id: Number(row.id),
          name: row.name,
          code: row.code,
          status: row.status,
          module_id: row.module_id !== null && row.module_id !== undefined ? Number(row.module_id) : null,
          relation: {
            roles: roles.filter((r: any) => roleIds.includes(Number(r.id))),
          },
        },
      }, 'Success');
    } catch (err: any) {
      console.error('ApprovalMatrix editForm error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  static async store(req: Request, res: Response): Promise<void> {
    try {
      const { name, code, role_ids, module_id, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }
      const user = req.user as any;
      const pid = user?.lastProperty ?? user?.last_property ?? BigInt(0);

      const row = await prisma.approval_matrices.create({
        data: {
          property_id: pid,
          name,
          code: code || null,
          module_id: module_id !== undefined && module_id !== null && module_id !== '' ? BigInt(String(module_id)) : null,
          role_ids: Array.isArray(role_ids) ? role_ids.map((v: any) => Number(v)) : [],
          status: status !== undefined && status !== null && status !== '' ? Number(status) : 0,
          created_at: new Date(),
          updated_at: new Date(),
          created_by: user?.id ?? null,
        },
      });

      success(res, { id: Number(row.id) }, 'Success');
    } catch (err: any) {
      console.error('ApprovalMatrix store error:', err);
      error(res, 'Failed to save approval matrix', 500);
    }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.approval_matrices.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) { notFound(res, 'Approval matrix not found'); return; }

      const { name, code, role_ids, module_id, status } = req.body;
      const user = req.user as any;

      const row = await prisma.approval_matrices.update({
        where: { id },
        data: {
          name: name ?? existing.name,
          code: code !== undefined ? code : existing.code,
          module_id: module_id !== undefined && module_id !== null && module_id !== ''
            ? BigInt(String(module_id))
            : existing.module_id,
          role_ids: Array.isArray(role_ids) ? role_ids.map((v: any) => Number(v)) : (existing.role_ids ?? []),
          status: status !== undefined && status !== null && status !== '' ? Number(status) : existing.status,
          updated_at: new Date(),
          updated_by: user?.id ?? null,
        },
      });

      success(res, { id: Number(row.id) }, 'Success');
    } catch (err: any) {
      console.error('ApprovalMatrix update error:', err);
      error(res, 'Failed to update approval matrix', 500);
    }
  }
}

