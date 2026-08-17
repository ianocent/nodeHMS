import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { buildDefaultTable } from '../utils/table';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES, ITEM_LOST_FOUND_STATUS, STATUS_LOST } from '../utils/cmsConfig';

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

function parsePagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 10;
  const search = query.search as string;
  const sort = query.sort as string || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  return { page, limit, search, sort, order };
}

export class ConciergeController {

  // ==================== PHONE BOOK GROUP ====================
  static async phoneBookGroupList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.phone_book_groups.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.phone_book_groups.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Phone book group list error:', err); error(res, 'Failed to list groups', 500); }
  }

  static async phoneBookGroupTree(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const groups = await prisma.phone_book_groups.findMany({ where: { property_id: pid, deleted_at: null }, orderBy: { sort: 'asc' } });
      const children = await prisma.phone_book_groups.findMany({ where: { property_id: pid, parent_id: { not: null }, deleted_at: null }, select: { parent_id: true } });
      const tree = buildTree(groups);
      success(res, bigintToNumber(tree), 'Success');
    } catch (err: any) { console.error('Phone book group tree error:', err); error(res, 'Failed to build tree', 500); }
  }

  static async phoneBookGroupStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { parent_id, name, sort, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const data = await prisma.phone_book_groups.create({
        data: { property_id: pid, parent_id: parent_id ? BigInt(parent_id) : null, name, sort: sort || 0, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Group created', 201);
    } catch (err: any) { console.error('Phone book group store error:', err); error(res, 'Failed to create group', 500); }
  }

  static async phoneBookGroupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { parent_id, name, sort, status } = req.body;
      await prisma.phone_book_groups.update({ where: { id }, data: { parent_id: parent_id ? BigInt(parent_id) : null, name, sort, status, updated_at: new Date(), updated_by: req.user?.id } });
      success(res, null, 'Group updated');
    } catch (err: any) { error(res, 'Failed to update group', 500); }
  }

  static async phoneBookGroupDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.phone_book_groups.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Group deleted');
    } catch (err: any) { error(res, 'Failed to delete group', 500); }
  }

  // ==================== PHONE BOOK ====================
  static async phoneBookList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const groupId = req.query.group_id as string;
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.name = { contains: search, mode: 'insensitive' }; }
      if (groupId) where.phone_book_group_id = BigInt(groupId);

      const [data, total] = await Promise.all([
        prisma.phone_books.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit, include: { phone_book_groups: { select: { name: true } } } }),
        prisma.phone_books.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: buildDefaultTable(data),
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Phone book list error:', err); error(res, 'Failed to list phone books', 500); }
  }

  static async phoneBookStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { phone_book_group_id, name, address, telp, fax, email, contact_name, remark, sort, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const data = await prisma.phone_books.create({
        data: { property_id: pid, phone_book_group_id: BigInt(phone_book_group_id), name, address, telp, fax, email, contact_name, remark, sort: sort || 0, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Phone book created', 201);
    } catch (err: any) { console.error('Phone book store error:', err); error(res, 'Failed to create phone book', 500); }
  }

  static async phoneBookUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { phone_book_group_id, name, address, telp, fax, email, contact_name, remark, sort, status } = req.body;
      await prisma.phone_books.update({ where: { id }, data: { phone_book_group_id: phone_book_group_id ? BigInt(phone_book_group_id) : undefined, name, address, telp, fax, email, contact_name, remark, sort, status, updated_at: new Date(), updated_by: req.user?.id } });
      success(res, null, 'Phone book updated');
    } catch (err: any) { error(res, 'Failed to update phone book', 500); }
  }

  static async phoneBookDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.phone_books.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Phone book deleted');
    } catch (err: any) { error(res, 'Failed to delete phone book', 500); }
  }

  // ==================== BAGGAGE ====================
  static async baggageList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.name = { contains: search, mode: 'insensitive' }; }

      const [data, total] = await Promise.all([
        prisma.baggages.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.baggages.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: buildDefaultTable(data),
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Baggage list error:', err); error(res, 'Failed to list baggage', 500); }
  }

  static async baggageStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { date, name, tag_no, remark, phone_number, status } = req.body;
      if (!date) { badRequest(res, 'date is required'); return; }

      const data = await prisma.baggages.create({
        data: { property_id: pid, date: new Date(date), name, tag_no, remark, phone_number, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Baggage created', 201);
    } catch (err: any) { console.error('Baggage store error:', err); error(res, 'Failed to create baggage', 500); }
  }

  static async baggageUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { date, name, tag_no, remark, phone_number, status } = req.body;
      await prisma.baggages.update({ where: { id }, data: { date: date ? new Date(date) : undefined, name, tag_no, remark, phone_number, status, updated_at: new Date(), updated_by: req.user?.id } });
      success(res, null, 'Baggage updated');
    } catch (err: any) { error(res, 'Failed to update baggage', 500); }
  }

  static async baggageDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.baggages.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Baggage deleted');
    } catch (err: any) { error(res, 'Failed to delete baggage', 500); }
  }

  // ==================== CAR PARK ====================
  static async carParkList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.vehicle_no = { contains: search, mode: 'insensitive' }; }

      const [data, total] = await Promise.all([
        prisma.car_parks.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.car_parks.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: buildDefaultTable(data),
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Car park list error:', err); error(res, 'Failed to list car parks', 500); }
  }

  static async carParkStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { room, remark, car_park_lot, vehicle_no, folio, status } = req.body;
      if (!vehicle_no) { badRequest(res, 'vehicle_no is required'); return; }

      const data = await prisma.car_parks.create({
        data: { property_id: pid, room: room ? parseInt(room) : null, remark, car_park_lot, vehicle_no, folio, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Car park created', 201);
    } catch (err: any) { console.error('Car park store error:', err); error(res, 'Failed to create car park', 500); }
  }

  static async carParkUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { room, remark, car_park_lot, vehicle_no, folio, status } = req.body;
      await prisma.car_parks.update({ where: { id }, data: { room: room ? parseInt(room) : null, remark, car_park_lot, vehicle_no, folio, status, updated_at: new Date(), updated_by: req.user?.id } });
      success(res, null, 'Car park updated');
    } catch (err: any) { error(res, 'Failed to update car park', 500); }
  }

  static async carParkDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.car_parks.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Car park deleted');
    } catch (err: any) { error(res, 'Failed to delete car park', 500); }
  }

  // ==================== LOST & FOUND ====================
  static async lostFoundList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.item = { contains: search, mode: 'insensitive' }; }

      const [data, total] = await Promise.all([
        prisma.lost_and_founds.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.lost_and_founds.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: buildDefaultTable(data),
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Lost & found list error:', err); error(res, 'Failed to list lost & found', 500); }
  }

  static async lostFoundForm(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const master: any = {
        statuses: STATUSES,
        itemsStatus: ITEM_LOST_FOUND_STATUS,
        reservations: [],
        statusLost: STATUS_LOST,
      };
      try {
        const rooms = await prisma.rooms.findMany({
          where: { deleted_at: null, status: 1, ...(req.user?.lastProperty ? { property_id: pid } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        master.rooms = rooms.map((r: any) => ({ value: Number(r.id), label: r.name }));
      } catch (e: any) {
        master.rooms = [];
        console.error('Lost & found rooms error:', e);
      }
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) {
        success(res, { status: 0 }, 'Success', 200, { master });
        return;
      }
      const data = await prisma.lost_and_founds.findUnique({ where: { id: BigInt(idRaw) } });
      if (!data || data.deleted_at) { notFound(res, 'Lost & found not found'); return; }
      success(res, bigintToNumber(data), 'Success', 200, { master });
    } catch (err: any) { console.error('Lost & found form error:', err); error(res, 'Failed to load lost & found', 500); }
  }

  // ==================== FORM / SHOW (frontend suffix routes) ====================
  static async baggageForm(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const master: any = { statuses: STATUSES };
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) {
        success(res, { status: 0 }, 'Success', 200, { master });
        return;
      }
      const data = await prisma.baggages.findFirst({ where: { id: BigInt(idRaw), property_id: pid } });
      if (!data || data.deleted_at) { notFound(res, 'Baggage not found'); return; }
      success(res, bigintToNumber(data), 'Success', 200, { master });
    } catch (err: any) { console.error('Baggage form error:', err); error(res, 'Failed to load baggage', 500); }
  }

  static async carParkForm(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const master: any = { statuses: STATUSES };
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) {
        success(res, { status: 0 }, 'Success', 200, { master });
        return;
      }
      const data = await prisma.car_parks.findFirst({ where: { id: BigInt(idRaw), property_id: pid } });
      if (!data || data.deleted_at) { notFound(res, 'Car park not found'); return; }
      success(res, bigintToNumber(data), 'Success', 200, { master });
    } catch (err: any) { console.error('Car park form error:', err); error(res, 'Failed to load car park', 500); }
  }

  static async phoneBookGroupForm(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const master: any = { statuses: STATUSES };
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) {
        success(res, { status: 0 }, 'Success', 200, { master });
        return;
      }
      const data = await prisma.phone_book_groups.findFirst({ where: { id: BigInt(idRaw), property_id: pid } });
      if (!data || data.deleted_at) { notFound(res, 'Phone book group not found'); return; }
      success(res, bigintToNumber(data), 'Success', 200, { master });
    } catch (err: any) { console.error('Phone book group form error:', err); error(res, 'Failed to load phone book group', 500); }
  }

  static async lostFoundStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { ref_no, report_date, item, room, room_founder, owner_item, item_status, hotel_location, description, instruction, status } = req.body;
      if (!item) { badRequest(res, 'item is required'); return; }

      const data = await prisma.lost_and_founds.create({
        data: { property_id: pid, ref_no, report_date: report_date ? new Date(report_date) : null, item, room: room ? parseInt(room) : null, room_founder: room_founder ? parseInt(room_founder) : null, owner_item, item_status, hotel_location, item_description: description, instruction, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Lost & found created', 201);
    } catch (err: any) { console.error('Lost & found store error:', err); error(res, 'Failed to create lost & found', 500); }
  }

  static async lostFoundUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { ref_no, report_date, item, room, room_founder, owner_item, item_status, hotel_location, description, instruction, status } = req.body;
      await prisma.lost_and_founds.update({ where: { id }, data: { report_date: report_date ? new Date(report_date) : undefined, item, room: room ? parseInt(room) : null, room_founder: room_founder ? parseInt(room_founder) : null, owner_item, item_status, hotel_location, item_description: description, instruction, status, updated_at: new Date(), updated_by: req.user?.id } });
      success(res, null, 'Lost & found updated');
    } catch (err: any) { error(res, 'Failed to update lost & found', 500); }
  }

  static async lostFoundDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.lost_and_founds.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Lost & found deleted');
    } catch (err: any) { error(res, 'Failed to delete lost & found', 500); }
  }
}

function buildTree(items: any[], parentId: bigint | null = null): any[] {
  return items
    .filter((i: any) => i.parent_id === parentId)
    .map((i: any) => ({ ...i, children: buildTree(items, i.id) }));
}
