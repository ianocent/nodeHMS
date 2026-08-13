import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

const MENU_ID = 158;

export class HousekeepingController {

  // ==================== SETUP ====================
  static async setupList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid, deleted_at: null };
      if (search) where.item_name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.housekeeping_setups.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.housekeeping_setups.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Setup list error:', err); error(res, 'Failed to list setups', 500); }
  }

  static async setupStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { code, item_name, category, used_by, description, is_required, sort, status } = req.body;
      if (!code || !item_name) { badRequest(res, 'code and item_name are required'); return; }

      const data = await prisma.housekeeping_setups.create({
        data: { property_id: pid, code, item_name, category, used_by, description, is_required: is_required ?? true, sort: sort || 0, status: status ?? true, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Setup created', 201);
    } catch (err: any) { console.error('Setup store error:', err); error(res, 'Failed to create setup', 500); }
  }

  static async setupShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const data = await prisma.housekeeping_setups.findUnique({ where: { id } });
      if (!data) { notFound(res, 'Setup not found'); return; }
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load setup', 500); }
  }

  static async setupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { code, item_name, category, used_by, description, is_required, sort, status } = req.body;
      await prisma.housekeeping_setups.update({ where: { id }, data: { code, item_name, category, used_by, description, is_required, sort, status, updated_at: new Date(), updated_by: req.user?.id } });
      success(res, null, 'Setup updated');
    } catch (err: any) { error(res, 'Failed to update setup', 500); }
  }

  static async setupDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.housekeeping_setups.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Setup deleted');
    } catch (err: any) { error(res, 'Failed to delete setup', 500); }
  }

  // ==================== ROOM STATUS ====================
  static async roomStatus(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.name = { contains: search, mode: 'insensitive' }; }

      const [data, total] = await Promise.all([
        prisma.rooms.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.rooms.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Room status error:', err); error(res, 'Failed to fetch room status', 500); }
  }

  // ==================== WORK ORDER ====================
  static async workOrderList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid };
      if (search) where.work_description = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.work_orders.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: { rooms: { select: { name: true } } } }),
        prisma.work_orders.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Work order list error:', err); error(res, 'Failed to list work orders', 500); }
  }

  static async workOrderStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { reported_by, unique_code, area, work_type, date, room_id, work_description, notes, assign_to } = req.body;
      if (!work_description) { badRequest(res, 'work_description is required'); return; }

      const data = await prisma.work_orders.create({
        data: { property_id: pid, reported_by: reported_by ? BigInt(reported_by) : null, unique_code, area, work_type, date: date ? new Date(date) : null, room_id: room_id ? BigInt(room_id) : null, work_description, notes, assign_to: assign_to ? BigInt(assign_to) : null, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Work order created', 201);
    } catch (err: any) { console.error('Work order store error:', err); error(res, 'Failed to create work order', 500); }
  }

  static async workOrderShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const data = await         prisma.work_orders.findUnique({ where: { id }, include: { rooms: { select: { name: true } }, work_order_stocks: true } });
      if (!data) { notFound(res, 'Work order not found'); return; }
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load work order', 500); }
  }

  static async workOrderUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { reported_by, unique_code, area, work_type, date, room_id, work_description, notes, assign_to, status_work_order } = req.body;
      await prisma.work_orders.update({
        where: { id },
        data: { reported_by: reported_by ? BigInt(reported_by) : null, unique_code, area, work_type, date: date ? new Date(date) : null, room_id: room_id ? BigInt(room_id) : null, work_description, notes, assign_to: assign_to ? BigInt(assign_to) : null, status_work_order, updated_at: new Date(), updated_by: req.user?.id },
      });
      success(res, null, 'Work order updated');
    } catch (err: any) { error(res, 'Failed to update work order', 500); }
  }

  static async workOrderDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.work_orders.update({ where: { id }, data: { status: 0 } });
      success(res, null, 'Work order deleted');
    } catch (err: any) { error(res, 'Failed to delete work order', 500); }
  }

  // ==================== STOCK ====================
  static async stockList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.name = { contains: search, mode: 'insensitive' }; }

      const [data, total] = await Promise.all([
        prisma.stocks.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.stocks.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Stock list error:', err); error(res, 'Failed to list stocks', 500); }
  }

  // ==================== SCHEDULE / ROSTER ====================
  static async rosterList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.rosters.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.rosters.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Roster list error:', err); error(res, 'Failed to list rosters', 500); }
  }

  // ==================== CHECKLIST ====================
  static async checklistHistory(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { housekeeping_setups: { property_id: pid } };

      const [data, total] = await Promise.all([
        prisma.housekeeping_history_checklists.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: { housekeeping_setups: true } }),
        prisma.housekeeping_history_checklists.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Checklist history error:', err); error(res, 'Failed to fetch checklist history', 500); }
  }

  // ==================== HOUSEKEEPER HISTORY ====================
  static async housekeeperHistory(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        prisma.housekeeper_history.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.housekeeper_history.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Housekeeper history error:', err); error(res, 'Failed to fetch housekeeper history', 500); }
  }
}
