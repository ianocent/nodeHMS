import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES } from '../utils/cmsConfig';
import { ROOM_STATUSES, MAID_STATUSES } from '../utils/cmsStatus';
import { TABLES } from '../utils/tableMeta';
import { AuthController } from './auth.controller';

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
      const pid = BigInt(req.user?.lastProperty ?? 0);
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
      const pid = BigInt(req.user?.lastProperty ?? 0);
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
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.name = { contains: search, mode: 'insensitive' }; }

      const [data, total] = await Promise.all([
        prisma.rooms.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.rooms.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: TABLES.room,
        permission: { view: true, add: true, edit: true, delete: true },
        search_data: [
          { label: 'Room Status', key: 'room_status', type: 'select', valueOptions: [{ value: 0, label: 'Vacant' }, { value: 1, label: 'Occupied' }, { value: 2, label: 'Out of Order' }, { value: 3, label: 'Maid Clean' }, { value: 4, label: 'Inspect' }] },
          { label: 'Maid Status', key: 'maid_status', type: 'select', valueOptions: [{ value: 0, label: 'Not Assigned' }, { value: 1, label: 'Cleaning' }, { value: 2, label: 'Check Out' }, { value: 3, label: 'Inspect' }] },
        ],
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Room status error:', err); error(res, 'Failed to fetch room status', 500); }
  }

  // Replicates Laravel HouseKeepingRoomStatusController@masterFilter
  static async roomStatusMaster(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const mapConfig = (list: { id: number; name: string }[]) => list.map((item) => ({ value: item.id, label: item.name }));
      const types = await prisma.types.findMany({
        where: { deleted_at: null, status: 1, group: { in: ['building', 'floor'] } },
        select: { id: true, name: true, group: true },
        orderBy: { name: 'asc' },
      });
      const builders = types.filter((t: any) => t.group === 'building').map((t: any) => ({ value: Number(t.id), label: t.name }));
      const floors = types.filter((t: any) => t.group === 'floor').map((t: any) => ({ value: Number(t.id), label: t.name }));
      const [housekeepers, roomTypes] = await Promise.all([
        prisma.users.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.room_types.findMany({
          where: { deleted_at: null, status: 1, ...(req.user?.lastProperty ? { property_id: pid } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);
      const businessDate = await AuthController.getBusinessDate(req.user?.lastProperty ?? null);
      success(res, null, 'Success', 200, {
        master: {
          statuses: STATUSES.map((s) => ({ value: s.value, label: s.label })),
          maidStatuses: mapConfig(Object.values(MAID_STATUSES)),
          roomStatuses: mapConfig(Object.values(ROOM_STATUSES)),
          housekeepers: housekeepers.map((u: any) => ({ value: Number(u.id), label: u.name })),
          houseKeeperHistory: null,
          builder: builders,
          floor: floors,
          business_date: businessDate,
          roomTypes: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        },
      });
    } catch (err: any) { console.error('Room status master error:', err); error(res, 'Failed to load master', 500); }
  }

  // ==================== WORK ORDER ====================
  static async workOrderSummary(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid };
      const [all, open, onProcess, finish] = await Promise.all([
        prisma.work_orders.count({ where }),
        prisma.work_orders.count({ where: { ...where, start_date: null } }),
        prisma.work_orders.count({ where: { ...where, start_date: { not: null }, end_date: null } }),
        prisma.work_orders.count({ where: { ...where, start_date: { not: null }, end_date: { not: null } } }),
      ]);
      success(res, { all, open, on_process: onProcess, finish }, 'Success');
    } catch (err: any) { console.error('Work order summary error:', err); error(res, 'Failed to load work order summary', 500); }
  }

  static async workOrderList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid };
      if (search) where.work_description = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.work_orders.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: { rooms: { select: { name: true } } } }),
        prisma.work_orders.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'No', key: 'sort', type: 'number', is_search: false },
          { label: 'Work Description', key: 'work_description', type: 'text', is_search: true },
          { label: 'Area', key: 'area', type: 'text', is_search: true },
          { label: 'Room', key: 'room_id', type: 'number', is_search: true },
          { label: 'Status', key: 'status', type: 'checkbox', is_search: true },
          { label: 'Assign To', key: 'assign_to', type: 'number', is_search: false },
        ],
        search_data: [
          { label: 'Status', key: 'status', type: 'select', valueOptions: [{ value: 1, label: 'Open' }, { value: 0, label: 'Closed' }] },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Work order list error:', err); error(res, 'Failed to list work orders', 500); }
  }

  static async workOrderStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
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

  static async workOrderForm(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const [rooms, users] = await Promise.all([
        prisma.rooms.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.users.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);
      const master = {
        rooms: rooms.map(r => ({ value: Number(r.id), label: r.name })),
        assign_to: users.map(u => ({ value: Number(u.id), label: u.name })),
      };
      if (!idRaw || !/^\d+$/.test(idRaw)) {
        success(res, { status: 1 }, 'Success', 200, { master });
        return;
      }
      const data = await prisma.work_orders.findUnique({
        where: { id: BigInt(idRaw) },
        include: { rooms: { select: { name: true } }, work_order_stocks: true },
      });
      if (!data) { notFound(res, 'Work order not found'); return; }
      success(res, bigintToNumber(data), 'Success', 200, { master });
    } catch (err: any) { error(res, 'Failed to load work order form', 500); }
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
      const pid = BigInt(req.user?.lastProperty ?? 0);
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
      const pid = BigInt(req.user?.lastProperty ?? 0);
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
      const pid = BigInt(req.user?.lastProperty ?? 0);
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
      const pid = BigInt(req.user?.lastProperty ?? 0);
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
