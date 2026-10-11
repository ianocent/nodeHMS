import { prisma } from '../config/prisma';
﻿import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { success, error, badRequest, notFound } from '../utils/response';
import { TABLES } from '../utils/tableMeta';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES, ITEM_LOST_FOUND_STATUS, STATUS_LOST, statusFlag } from '../utils/cmsConfig';
import { storageRoot } from '../utils/storage';
function saveLostFoundImage(id: bigint | number, base64: any, fieldName: string): string | null {
  if (typeof base64 !== 'string') return null;
  if (!base64.startsWith('data:image')) return base64; // pass through existing URL
  const m = base64.match(/^data:image\/(\w+);base64,(.*)$/);
  if (!m) return null;
  try {
    const ext = m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    const root = process.env.STORAGE_PATH || path.join(process.cwd(), 'storage');
    const dir = path.join(root, 'lost-and-found');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${id}-${fieldName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(dir, fileName), buf);
    return `/lost-and-found/${fileName}`;
  } catch (e: any) {
    console.error(`LF image save failed for ${fieldName}:`, e?.message);
    return null;
  }
}

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

/**
 * `parent_id` arrives either as a bare id or as the `{value,label}` object the grid /
 * select widgets emit. `BigInt({value,label})` throws, which is why saving a Phone Book
 * Group 2/3 row failed once the parent column started rendering a name.
 */
function parentIdValue(raw: any): bigint | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = raw && typeof raw === 'object' ? raw.value : raw;
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
  return /^\d+$/.test(String(v)) ? BigInt(String(v)) : null;
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
        prisma.phone_book_groups.findMany({
          where,
          orderBy: { sort: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          // PhoneBookGroup{2,3}::formatData() emits `parent_id => {value, label:parentGroup->name}`
          // and both controllers eager-load `->with('parentGroup')`. Without the include
          // the row only carried the raw BigInt id, and the grid renders numbers as-is,
          // so Phone Book Group 2 and 3 showed an ID in the Parent Group column.
          include: { phone_book_groups: { select: { id: true, name: true } } },
        } as any),
        prisma.phone_book_groups.count({ where }),
      ]);

      const rows = level > 1
        ? data.map((d: any) => ({
            ...d,
            parent_id: d.parent_id === null || d.parent_id === undefined
              ? null
              : { value: Number(d.parent_id), label: d.phone_book_groups?.name ?? null },
          }))
        : data;

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

      success(res, bigintToNumber(rows), 'Success', 200, {
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
        data: { property_id: pid, group: level, parent_id: parentIdValue(parent_id), name, sort: sort || 0, status: statusFlag(status), created_at: new Date(), created_by: req.user?.id },
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
      await prisma.phone_book_groups.update({ where: { id }, data: { group: level, parent_id: parentIdValue(parent_id), name, sort, status: status === undefined ? undefined : statusFlag(status), updated_at: new Date(), updated_by: req.user?.id } });
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
      if (status !== undefined) data.status = statusFlag(status);
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
      // Room arrives as a react-select {value,label} and Folio as an autocomplete
      // object; parseInt({}) is NaN and Prisma rejects the whole insert.
      const roomId = room && typeof room === 'object' ? (room.value ?? room.id) : room;
      const folioId = folio && typeof folio === 'object' ? (folio.value ?? folio.id) : folio;

      const data = await prisma.car_parks.create({
        data: { property_id: pid, room: roomId ? parseInt(String(roomId)) : null, remark, car_park_lot, vehicle_no, folio: folioId != null ? String(folioId) : null, status: statusFlag(status), created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Car park created', 200);
    } catch (err: any) { console.error('Car park store error:', err); error(res, 'Failed to create car park', 500); }
  }

  static async carParkUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { room, remark, car_park_lot, vehicle_no, folio, status } = req.body;
      await prisma.car_parks.update({ where: { id }, data: { room: room ? parseInt(room) : null, remark, car_park_lot, vehicle_no, folio, status: status === undefined ? undefined : statusFlag(status), updated_at: new Date(), updated_by: req.user?.id } });
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
  /**
   * Rows written before the storage fix keep the whole image as a raw base64
   * data-URI in `photo_1..5`. Each of those columns is ~4 MB, so listing the
   * table shipped a 31 MB response and the list felt like it hung. Move the blob
   * onto disk once, store the path, and hand back the lightweight row.
   */
  private static async normalizeLostFoundPhotos(row: any): Promise<any> {
    if (!row || typeof row !== 'object') return row;
    const patch: any = {};
    for (const f of ['photo_1', 'photo_2', 'photo_3', 'photo_4', 'photo_5']) {
      const v = (row as any)[f];
      if (typeof v !== 'string' || !/^\s*data:image\//i.test(v)) continue;
      const saved = saveLostFoundImage(row.id, v, f);
      if (saved) patch[f] = saved;
    }
    if (Object.keys(patch).length === 0) return row;
    try {
      await prisma.lost_and_founds.update({ where: { id: row.id }, data: patch });
    } catch (e: any) {
      console.error('LF photo migrate failed:', e?.message);
    }
    return { ...row, ...patch };
  }

  static async lostFoundList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      // LostAndFound uses the HasProperties trait (app/Models/LostAndFound.php:17), so
      // Eloquent's global `property` scope narrows every query — index() included — to
      // `request()->user()->last_property`. The node port used to list every property's
      // rows here, leaking other hotels' lost & found into the grid.
      const where: any = { property_id: pid, deleted_at: null };
      if (search) { where.item = { contains: search, mode: 'insensitive' }; }

      const [data, total] = await Promise.all([
        prisma.lost_and_founds.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.lost_and_founds.count({ where }),
      ]);
      const rows = await Promise.all(data.map((r: any) => ConciergeController.normalizeLostFoundPhotos(r)));

      // Room master doubles as the `room` select's option list (LostAndFound::formatTable
      // declares the column without inline options) and as the label source for
      // the shaped rows below.
      const rooms = await prisma.rooms.findMany({
        where: { property_id: pid, deleted_at: null, status: 1 },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      // LostAndFound::formatData() (:24-68) wraps status_lost / item_status / folio
      // / room into {value,label}; the grid's select columns and the edit form's
      // react-select both need that shape or they render blank.
      const roomById = new Map(rooms.map((r: any) => [Number(r.id), r.name]));
      const folioIds = rows.map((r: any) => r.folio).filter((v: any) => v && /^\d+$/.test(String(v)));
      const folioRows = folioIds.length
        ? await prisma.folios.findMany({
            where: { id: { in: folioIds.map((v: any) => BigInt(String(v))) } },
            select: { id: true, folio_number: true, check_in_date: true, check_out_date: true },
          })
        : [];
      const folioById = new Map<bigint, any>(folioRows.map((f: any) => [f.id, f]));

      const shaped = rows.map((r: any) => {
        const folio = r.folio ? folioById.get(BigInt(String(r.folio))) : null;
        return {
          ...r,
          status_lost: { value: r.status_lost, label: r.status_lost },
          item_status: { value: r.item_status, label: r.item_status },
          folio: { value: r.folio, label: folio?.folio_number ?? null },
          room: { value: r.room, label: roomById.get(Number(r.room)) ?? null },
          checkin: folio?.check_in_date ?? null,
          checkout: folio?.check_out_date ?? null,
        };
      });

      // LostAndFound::formatTable() declares status_lost / item_status / room as
      // selects without inline options; the option lists come from cms config and
      // the room master (same sources LostAndFoundController@create uses).
      const lostFoundTable = JSON.parse(JSON.stringify(TABLES.lostFound));
      const setOptions = (key: string, options: any[]) => {
        const col = lostFoundTable.find((c: any) => c.key === key);
        if (col) col.options = options;
      };
      setOptions('status_lost', STATUS_LOST);
      setOptions('item_status', ITEM_LOST_FOUND_STATUS);
      setOptions('room', rooms.map((r: any) => ({ value: Number(r.id), label: r.name })));

      success(res, bigintToNumber(shaped), 'Success', 200, {
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
      const clean: any = await ConciergeController.normalizeLostFoundPhotos(data);
      // Same {value,label} contract as the list — the edit form binds
      // select-multi / autocomplete widgets to it (LostAndFound::formatData).
      const roomRow = clean.room ? await prisma.rooms.findUnique({ where: { id: Number(clean.room) }, select: { name: true } }) : null;
      const folioRow = clean.folio
        ? await prisma.folios.findUnique({ where: { id: BigInt(String(clean.folio)) }, select: { folio_number: true, check_in_date: true, check_out_date: true } })
        : null;
      const shaped: any = {
        ...clean,
        status_lost: { value: clean.status_lost, label: clean.status_lost },
        item_status: { value: clean.item_status, label: clean.item_status },
        folio: { value: clean.folio, label: folioRow?.folio_number ?? null },
        room: { value: clean.room, label: roomRow?.name ?? null },
      };
      success(res, bigintToNumber(shaped), 'Success', 200, {
        master,
        // Laravel edit (:324-326, :331) sends the folio's stay window separately;
        // the form reads check-in / check-out from `reservation`.
        reservation: folioRow ? { check_in_date: folioRow.check_in_date, check_out_date: folioRow.check_out_date } : null,
      });
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
      const levelRaw = String((req.params as any).groupLevel ?? '1');
      const level = [1, 2, 3].includes(Number(levelRaw)) ? Number(levelRaw) : 1;

      // Level 2 and 3 rows hang off a level N-1 parent (PhoneBookGroup2/3
      // validate `parent_id` as required on store), so the form needs that list.
      if (level > 1) {
        master.parent_groups = await prisma.phone_book_groups.findMany({
          where: { property_id: pid, group: level - 1, deleted_at: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
      }

      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) {
        success(res, { status: 0 }, 'Success', 200, { master });
        return;
      }
      const data = await prisma.phone_book_groups.findFirst({
        where: { id: BigInt(idRaw), property_id: pid },
        include: { phone_book_groups: { select: { id: true, name: true } } },
      } as any);
      if (!data || data.deleted_at) { notFound(res, 'Phone book group not found'); return; }
      // Same {value,label} contract as the list so the Parent Group select resolves its
      // label on the edit form (react-select only resolves {label,value} objects).
      const row: any = level > 1
        ? {
            ...data,
            parent_id: data.parent_id === null || data.parent_id === undefined
              ? null
              : { value: Number(data.parent_id), label: (data as any).phone_book_groups?.name ?? null },
          }
        : data;
      success(res, bigintToNumber(row), 'Success', 200, { master });
    } catch (err: any) { console.error('Phone book group form error:', err); error(res, 'Failed to load phone book group', 500); }
  }

  // ==================== PHONE BOOK ENTRIES (PhoneBookController) ====================
  // node only exposed the group CRUD, so /cms/concierge/phone-book 404'd and
  // creating an entry was impossible.
  static async phoneBookList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const groupId = (req.query as any).phone_book_group_id;
      const search = (req.query as any).search as string;
      const where: any = { property_id: pid, deleted_at: null };
      if (groupId) where.phone_book_group_id = BigInt(groupId);
      if (search) {
        where.OR = ['name', 'address', 'telp', 'fax', 'email', 'contact_name', 'remark'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' } }));
      }
      if (!groupId) {
        success(res, [], 'No guest ID provided.', 200, {
          table: (TABLES as any).phoneBook,
          permission: getPermissionFlags(req.user, 76),
          search_data: [],
          pagination: { current_page: page, last_page: 1, per_page: limit, total: 0, from: 0, to: 0 },
        });
        return;
      }
      const [data, total] = await Promise.all([
        prisma.phone_books.findMany({ where, orderBy: { id: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.phone_books.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: (TABLES as any).phoneBook,
        permission: { ...getPermissionFlags(req.user, 76), add: getPermissionFlags(req.user, 76).add, edit: getPermissionFlags(req.user, 76).edit, delete: getPermissionFlags(req.user, 76).delete },
        search_data: [],
        pagination: { current_page: page, last_page: Math.max(1, Math.ceil(total / limit)), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Phone book list error:', err); error(res, 'Failed to list phone book', 500); }
  }

  static async phoneBookTree(_req: Request, res: Response): Promise<void> {
    try {
      const groups = await prisma.phone_book_groups.findMany({ orderBy: { sort: 'asc' } });
      const build = (parentId: bigint | null): any[] =>
        groups.filter((g: any) => (parentId === null ? g.parent_id === null : g.parent_id === parentId))
          .map((g: any) => ({ ...bigintToNumber(g), parentGroup: null, children: build(g.id) }));
      success(res, build(null), 'Success', 200);
    } catch (err: any) { error(res, 'Failed to load phone book tree', 500); }
  }

  static async phoneBookStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { name, address, telp, fax, email, contact_name, remark, sort, status } = req.body;
      // The grid sends `phone_book_group_id` in the query string (like every other
      // TableView inline save), not the body — reading it from the body only made
      // every Phone Book create fail with "group id is required".
      const groupIdRaw = (req.body?.phone_book_group_id ?? (req.query as any)?.phone_book_group_id) as any;
      const groupId = groupIdRaw && typeof groupIdRaw === 'object' ? (groupIdRaw.value ?? groupIdRaw.id) : groupIdRaw;
      if (!name) { badRequest(res, 'The name field is required.'); return; }
      if (!address) { badRequest(res, 'The address field is required.'); return; }
      if (!telp) { badRequest(res, 'The telp field is required.'); return; }
      if (!groupId || !/^\d+$/.test(String(groupId))) { badRequest(res, 'The phone book group id field is required.'); return; }
      const group = await prisma.phone_book_groups.findFirst({ where: { id: BigInt(groupId), deleted_at: null } });
      if (!group) { badRequest(res, 'The selected phone book group id is invalid.'); return; }
      const data = await prisma.phone_books.create({
        data: {
          property_id: pid,
          phone_book_group_id: BigInt(groupId),
          name, address, telp, fax, email, contact_name, remark,
          sort: sort ?? 0,
          status: status === undefined || status === null ? 1 : (statusFlag(status) ?? 1),
          created_at: new Date(),
          created_by: req.user?.id ?? null,
        },
      });
      success(res, bigintToNumber(data), 'Phone book created successfully.', 200);
    } catch (err: any) { console.error('Phone book store error:', err); error(res, 'Failed to create phone book', 500); }
  }

  static async phoneBookUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { name, address, telp, fax, email, contact_name, remark, status } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id ?? null };
      for (const [k, v] of Object.entries({ name, address, telp, fax, email, contact_name, remark })) {
        if (v !== undefined) data[k] = v;
      }
      if (status !== undefined) data.status = statusFlag(status);
      await prisma.phone_books.update({ where: { id }, data });
      success(res, null, 'Phone book updated successfully.', 200);
    } catch (err: any) { error(res, 'Failed to update phone book', 500); }
  }

  static async phoneBookDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.phone_books.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id ?? null } });
      success(res, [], 'Note deleted successfully.', 200);
    } catch (err: any) { error(res, 'Failed to delete phone book', 500); }
  }

  /**
   * Laravel LostAndFoundController@store (:259-260) generates the reference
   * number server-side from the highest existing row, so the client never sends
   * one. Mirrors it here: LST + 6-digit zero-padded sequence.
   */
  private static async nextLostFoundRefNo(): Promise<string> {
    // Laravel reads only the newest row (LostAndFoundController:259-260), so a
    // soft-deleted or NULL-ref_no row resets the sequence to LST000001 and the
    // next create collides. Take the highest sequence that actually exists.
    const rows = await prisma.lost_and_founds.findMany({
      where: { ref_no: { not: null } },
      orderBy: { ref_no: 'desc' },
      select: { ref_no: true },
      take: 1,
    });
    const digits = String(rows[0]?.ref_no ?? '').replace(/^LST/i, '').replace(/[^0-9]/g, '');
    const next = (parseInt(digits, 10) || 0) + 1;
    return `LST${String(next).padStart(6, '0')}`;
  }

  /** Columns of lost_and_founds the form owns, copied straight off the payload. */
  private static lostFoundColumns(body: any): Record<string, any> {
    const cols: Record<string, any> = {};
    const text = ['item', 'item_status', 'hotel_location', 'owner_item', 'contact_number',
      'founder_of_item', 'contact_number_founder',
      'item_description', 'instruction', 'additional_information', 'status_lost'];
    for (const k of text) {
      if (body[k] !== undefined) cols[k] = body[k] === '' ? null : body[k];
    }
    // `folio` / `folio_founder` are TEXT columns in Postgres but the form posts a
    // numeric id (and, through the autocomplete, a {value,label} object). Prisma
    // rejected the Int with "Argument `folio`: Invalid value provided. Expected
    // String or Null, provided Int", so every create 500'd.
    for (const k of ['folio', 'folio_founder']) {
      if (body[k] === undefined) continue;
      const raw: any = body[k];
      // The autocomplete widget emits {value,label}; the plain select emits
      // {value,label} too but some call sites send {id,label}. Accept both.
      const v = raw && typeof raw === 'object' ? (raw.value ?? raw.id) : raw;
      cols[k] = v === undefined || v === null || v === '' ? null : String(v);
    }
    for (const k of ['room', 'room_founder']) {
      if (body[k] !== undefined) {
        const v = body[k] && typeof body[k] === 'object' ? body[k].value : body[k];
        cols[k] = v === undefined || v === null || v === '' ? null : parseInt(String(v), 10);
      }
    }
    if (body.report_date !== undefined) cols.report_date = body.report_date ? new Date(body.report_date) : null;
    return cols;
  }

  static async lostFoundStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const body = req.body || {};
      const item = body.item;
      if (!item) { badRequest(res, 'item is required'); return; }
      if (!body.report_date) { badRequest(res, 'report_date is required'); return; }
      if (!body.item_status) { badRequest(res, 'item_status is required'); return; }
      if (!body.hotel_location) { badRequest(res, 'hotel_location is required'); return; }

      const cols = ConciergeController.lostFoundColumns(body);

      // Laravel store (:252-257): a chosen folio overrides Room with the room of
      // that folio's first reservation.
      if (cols.folio) {
        const folio = await prisma.folios.findUnique({
          where: { id: BigInt(String(cols.folio)) },
          select: { reservations: { where: { deleted_at: null }, orderBy: { id: 'asc' }, take: 1, select: { room_id: true } } },
        });
        const roomId = folio?.reservations?.[0]?.room_id;
        if (roomId !== null && roomId !== undefined) cols.room = Number(roomId);
      }

      const data = await prisma.lost_and_founds.create({
        data: {
          ...cols,
          property_id: pid,
          ref_no: await ConciergeController.nextLostFoundRefNo(),
          status: body.status !== undefined ? statusFlag(body.status) : 1,
          created_at: new Date(),
          created_by: req.user?.id ?? null,
        },
      });

      const updatePhotos: any = {};
      for (const f of ['photo_1', 'photo_2', 'photo_3', 'photo_4', 'photo_5']) {
        if (body[f]) {
          const saved = saveLostFoundImage(data.id, body[f], f);
          if (saved) updatePhotos[f] = saved;
        }
      }
      if (Object.keys(updatePhotos).length > 0) {
        await prisma.lost_and_founds.update({ where: { id: data.id }, data: updatePhotos });
      }

      success(res, bigintToNumber({ ...data, ...updatePhotos }), 'Lost and found item created successfully.', 200);
    } catch (err: any) { console.error('Lost & found store error:', err); error(res, 'Failed to create lost & found', 500); }
  }

  static async lostFoundUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const body = req.body || {};
      const updateData: any = { ...ConciergeController.lostFoundColumns(body) };
      if (body.status !== undefined) updateData.status = statusFlag(body.status);
      updateData.updated_at = new Date();
      updateData.updated_by = req.user?.id ?? null;

      for (const f of ['photo_1', 'photo_2', 'photo_3', 'photo_4', 'photo_5']) {
        if (body[f] !== undefined) {
          const saved = saveLostFoundImage(id, body[f], f);
          if (saved) updateData[f] = saved;
        }
      }

      await prisma.lost_and_founds.update({ where: { id }, data: updateData });
      success(res, null, 'Lost and found item updated successfully.');
    } catch (err: any) { console.error('Lost & found update error:', err); error(res, 'Failed to update lost & found', 500); }
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

