import { prisma } from '../config/prisma';
﻿import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { success, error, badRequest, notFound } from '../utils/response';
import { TABLES } from '../utils/tableMeta';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES, ITEM_LOST_FOUND_STATUS, STATUS_LOST } from '../utils/cmsConfig';
import { storageRoot } from '../utils/storage';


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
      // Base PhoneBookGroup{1,2,3}Controller@index all scope to their own level
      // (`PhoneBookGroup1::where('group', 1)`), and the route decides the level.
      // Without it every tab listed all three levels mixed together.
      const levelRaw = String((req.params as any).groupLevel ?? '1');
      const level = [1, 2, 3].includes(Number(levelRaw)) ? Number(levelRaw) : 1;

      const where: any = { property_id: pid, group: level, deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.phone_book_groups.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.phone_book_groups.count({ where }),
      ]);

      // PhoneBookGroup2/3Controller@formatTable expose a Parent Group select
      // populated from the level above.
      const table = JSON.parse(JSON.stringify(TABLES[level === 1 ? 'phoneBookGroup1' : level === 2 ? 'phoneBookGroup2' : 'phoneBookGroup3']));
      if (level > 1) {
        const parents = await prisma.phone_book_groups.findMany({
          where: { property_id: pid, group: level - 1, deleted_at: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        const parentCol = table.find((c: any) => c.key === 'parent_id');
        if (parentCol) {
          parentCol.options = parents.map((p: any) => ({ value: Number(p.id), label: p.name }));
        }
      }

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      // Base pins the level on create (PhoneBookGroup1Controller@store: `'group' => 1`).
      // Without it the row fell to the schema default 0, and since every list filters
      // `group = N` a newly added Phone Book Group was invisible in all three tabs.
      const levelRaw = String((req.params as any).groupLevel ?? '1');
      const level = [1, 2, 3].includes(Number(levelRaw)) ? Number(levelRaw) : 1;

      const data = await prisma.phone_book_groups.create({
        data: { property_id: pid, group: level, parent_id: parent_id ? BigInt(parent_id) : null, name, sort: sort || 0, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Group created', 200);
    } catch (err: any) { console.error('Phone book group store error:', err); error(res, 'Failed to create group', 500); }
  }

  static async phoneBookGroupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { parent_id, name, sort, status } = req.body;
      // Keep the level pinned so an edit can never demote a row out of its tab.
      const levelRaw = String((req.params as any).groupLevel ?? '1');
      const level = [1, 2, 3].includes(Number(levelRaw)) ? Number(levelRaw) : 1;
      await prisma.phone_book_groups.update({ where: { id }, data: { group: level, parent_id: parent_id ? BigInt(parent_id) : null, name, sort, status, updated_at: new Date(), updated_by: req.user?.id } });
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
      // The phone-book page sends `phone_book_group_id` (base PhoneBookController@index
      // reads the same name); `group_id` was the only alias accepted, so the list
      // was never scoped to the group picked in the tree.
      const groupId = (req.query.phone_book_group_id ?? req.query.group_id) as string;
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.name = { contains: search, mode: 'insensitive' }; }
      if (groupId) where.phone_book_group_id = BigInt(groupId);

      const [data, total] = await Promise.all([
        prisma.phone_books.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit, include: { phone_book_groups: { select: { name: true } } } }),
        prisma.phone_books.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: TABLES.phoneBook,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      success(res, bigintToNumber(data), 'Phone book created', 200);
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
        table: TABLES.baggage,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Baggage list error:', err); error(res, 'Failed to list baggage', 500); }
  }

  static async baggageStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { date, name, tag_no, remark, phone_number, status } = req.body;
      if (!date) { badRequest(res, 'The date field is required.'); return; }
      if (!name) { badRequest(res, 'The name field is required.'); return; }

      let filePath: string | null = null;
      let file: string | null = req.body.file ?? null;
      if ((req as any).file) {
        const f = (req as any).file as Express.Multer.File;
        const ext = f.originalname.split('.').pop()?.toLowerCase() || 'dat';
        file = f.originalname;
        filePath = `file-baggage/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const abs = path.join(storageRoot(), filePath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.buffer);
      }

      const data = await prisma.baggages.create({
        data: { property_id: pid, date: new Date(date), name, tag_no, remark, file, file_path: filePath, phone_number, status: (status === 'true' || status === 1 || status === '1') ? 1 : 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Baggage created', 200);
    } catch (err: any) { console.error('Baggage store error:', err); error(res, 'Failed to create baggage', 500); }
  }

  static async baggageUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { date, name, tag_no, remark, phone_number, status } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (date !== undefined) data.date = new Date(date);
      if (name !== undefined) data.name = name;
      if (tag_no !== undefined) data.tag_no = tag_no;
      if (remark !== undefined) data.remark = remark;
      if (phone_number !== undefined) data.phone_number = phone_number;
      if (status !== undefined) data.status = (status === 'true' || status === 1 || status === '1') ? 1 : 0;
      if ((req as any).file) {
        const f = (req as any).file as Express.Multer.File;
        const ext = f.originalname.split('.').pop()?.toLowerCase() || 'dat';
        data.file = f.originalname;
        data.file_path = `file-baggage/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const abs = path.join(storageRoot(), data.file_path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.buffer);
      }
      await prisma.baggages.update({ where: { id }, data });
      success(res, null, 'Baggage updated');
    } catch (err: any) { console.error('Baggage update error:', err); error(res, 'Failed to update baggage', 500); }
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

      // CarPark::formatTable() fills the Room select from Room::all().
      const rooms = await prisma.rooms.findMany({
        where: { property_id: pid, deleted_at: null, status: 1 },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const carParkTable = JSON.parse(JSON.stringify(TABLES.carPark));
      const roomCol = carParkTable.find((c: any) => c.key === 'room');
      if (roomCol) {
        roomCol.options = rooms.map((r: any) => ({ value: Number(r.id), label: r.name }));
      }

      success(res, bigintToNumber(data), 'Success', 200, {
        table: carParkTable,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      success(res, bigintToNumber(data), 'Car park created', 200);
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

      // LostAndFound::formatTable() declares status_lost / item_status / room as
      // selects without inline options; the option lists come from cms config and
      // the room master (same sources LostAndFoundController@create uses).
      const rooms = await prisma.rooms.findMany({
        where: { property_id: pid, deleted_at: null, status: 1 },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const lostFoundTable = JSON.parse(JSON.stringify(TABLES.lostFound));
      const setOptions = (key: string, options: any[]) => {
        const col = lostFoundTable.find((c: any) => c.key === key);
        if (col) col.options = options;
      };
      setOptions('status_lost', STATUS_LOST);
      setOptions('item_status', ITEM_LOST_FOUND_STATUS);
      setOptions('room', rooms.map((r: any) => ({ value: Number(r.id), label: r.name })));

      success(res, bigintToNumber(data), 'Success', 200, {
        table: lostFoundTable,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      success(res, bigintToNumber(data), 'Lost & found created', 200);
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

