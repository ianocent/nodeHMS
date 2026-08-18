import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES } from '../utils/cmsConfig';
import { ROOM_STATUSES, MAID_STATUSES } from '../utils/cmsStatus';
import { TABLES } from '../utils/tableMeta';
import { AuthController } from './auth.controller';
import { firebaseService } from '../services/firebase.service';

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

function num(v: any, fallback: any = 0): any {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

async function syncWorkOrderTypes(modelId: bigint, areaId: any, workTypeId: any): Promise<void> {
  const ids = [areaId, workTypeId].filter((v: any) => v !== undefined && v !== null && v !== '');
  const unique = new Set(ids.map((v: any) => BigInt(v)));
  for (const typeId of unique) {
    await prisma.model_has_types.create({
      data: { model_id: modelId, model_type: 'App\\Models\\WorkOrder', type_id: typeId },
    });
  }
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Setup list error:', err); error(res, 'Failed to list setups', 500); }
  }

  static async setupStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { code, item_name, category, used_by, description, is_required, sort, status } = req.body;
      if (!code || !item_name) { badRequest(res, 'code and item_name are required'); return; }

      const data = await prisma.housekeeping_setups.create({
        data: { property_id: pid, code, item_name, category, used_by, description, is_required: is_required ?? true, sort: num(sort, 0), status: status ?? true, created_at: new Date(), created_by: req.user?.id },
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
      const data: any = {};
      if (code !== undefined) data.code = code;
      if (item_name !== undefined) data.item_name = item_name;
      if (category !== undefined) data.category = category;
      if (used_by !== undefined) data.used_by = used_by;
      if (description !== undefined) data.description = description;
      if (is_required !== undefined) data.is_required = is_required;
      if (sort !== undefined) data.sort = num(sort, 0);
      if (status !== undefined) data.status = status;
      data.updated_at = new Date();
      data.updated_by = req.user?.id;
      await prisma.housekeeping_setups.update({ where: { id }, data });
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
  // Replicates Laravel HouseKeepingRoomStatusController@index
  static async roomStatus(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const rawDate = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const dateStr = rawDate.replace(/\//g, '-').slice(0, 10);
      const date = new Date(dateStr + 'T00:00:00');
      const roomStatus = req.query.room_status as string;
      const maidStatus = req.query.maid_status as string;
      const floor = req.query.floor as string;
      const building = req.query.building as string;
      const roomType = req.query.room_type as string;

      const where: any = { property_id: pid, deleted_at: null, is_physical: true };
      if (search) where.name = { contains: search, mode: 'insensitive' };
      if (roomStatus) where.room_status = { in: roomStatus.split(',').map(Number) };
      if (maidStatus) where.maid_status = { in: maidStatus.split(',').map(Number) };
      if (roomType) where.room_type_id = { in: roomType.split(',').map((v: string) => BigInt(v)) };

      const [typeLinks, rooms] = await Promise.all([
        prisma.model_has_types.findMany({
          where: { model_type: { contains: 'Room' }, types: { group: { in: ['floor', 'building'] } } },
          include: { types: { select: { id: true, name: true, group: true } } },
        }),
        prisma.rooms.findMany({
          where,
          orderBy: { name: 'asc' },
          include: { room_types: true },
        }),
      ]);

      let filtered = rooms;
      const typeGroup = (roomId: bigint, group: string): any => {
        const link = typeLinks.find((l: any) => l.model_id === roomId && l.types?.group === group);
        return link?.types ? { value: Number(link.types.id), label: link.types.name } : [];
      };
      if (floor) {
        const floorIds = floor.split(',').map(Number);
        filtered = filtered.filter((r: any) => { const t = typeGroup(r.id, 'floor'); return t.value != null && floorIds.includes(t.value); });
      }
      if (building) {
        const buildingIds = building.split(',').map(Number);
        filtered = filtered.filter((r: any) => { const t = typeGroup(r.id, 'building'); return t.value != null && buildingIds.includes(t.value); });
      }
      const total = filtered.length;
      const data = filtered.slice((page - 1) * limit, page * limit);
      const roomIds = filtered.map((r: any) => r.id);

      const [histories, folioRows] = await Promise.all([
        prisma.housekeeper_history.findMany({
          where: { room_id: { in: roomIds }, date, done_inspection: null },
          select: { room_id: true, user_id: true },
        }),
        prisma.reservations.findMany({
          where: {
            room_id: { in: roomIds },
            deleted_at: null,
            property_id: pid,
            check_in_date: { lte: date },
            check_out_date: { gte: date },
          },
          select: { room_id: true, folio_id: true },
        }),
      ]);
      const hkUserIds = [...new Set(histories.filter((h: any) => h.user_id).map((h: any) => h.user_id))];
      const hkUsers = hkUserIds.length ? await prisma.users.findMany({ where: { id: { in: hkUserIds } }, select: { id: true, name: true } }) : [];
      const hkUserMap = new Map(hkUsers.map((u: any) => [Number(u.id), u.name]));

      const folioIds = [...new Set(folioRows.map((f: any) => f.folio_id))];
      const folioMap = new Map<number, any>();
      if (folioIds.length) {
        const folios = await prisma.folios.findMany({ where: { id: { in: folioIds }, deleted_at: null }, select: { id: true, first_name: true, last_name: true, is_do_not_disturb: true } });
        folios.forEach((f: any) => folioMap.set(Number(f.id), f));
      }
      const hkByRoom = new Map<number, { value: number; label: string }[]>();
      histories.forEach((h: any) => {
        const rid = Number(h.room_id);
        const name = hkUserMap.get(Number(h.user_id));
        if (name && !(hkByRoom.get(rid) || []).some((x: any) => x.value === Number(h.user_id))) {
          hkByRoom.set(rid, [...(hkByRoom.get(rid) || []), { value: Number(h.user_id), label: name }]);
        }
      });
      const guestByRoom = new Map<number, any>();
      folioRows.forEach((fr: any) => {
        const folio = folioMap.get(Number(fr.folio_id));
        if (folio && !guestByRoom.has(Number(fr.room_id))) {
          guestByRoom.set(Number(fr.room_id), folio);
        }
      });

      const formatted = data.map((room: any) => {
        const folio = guestByRoom.get(Number(room.id));
        const statusLabel = (code: any, map: Record<string, { id: number; name: string }>) => {
          const found = Object.values(map).find((s) => s.id === Number(code));
          return { value: Number(code), label: found?.name ?? String(code ?? '') };
        };
        return {
          id: Number(room.id),
          name: room.name,
          description: room.description,
          phone_ext: room.phone_ext,
          max_pax: room.max_pax,
          total_bed: room.total_bed,
          with_tv: !!room.with_tv,
          with_shower: !!room.with_shower,
          floor: typeGroup(room.id, 'floor'),
          building: typeGroup(room.id, 'building'),
          is_do_not_disturb: !!(folio?.is_do_not_disturb ?? room.is_do_not_disturb ?? false),
          guest: folio ? `${folio.first_name ?? ''} ${folio.last_name ?? ''}`.trim() : null,
          cleaning_time: room.cleaning_time,
          linen_days: room.linen_days,
          remark: room.remark,
          created_at: room.created_at,
          created_by: room.created_by ? Number(room.created_by) : null,
          sort: room.sort,
          room_status: statusLabel(room.room_status, ROOM_STATUSES),
          maid_status: statusLabel(room.maid_status, MAID_STATUSES),
          status: { value: 1, label: room.status ? 'Active' : 'Inactive' },
          room_type_id: { value: Number(room.room_type_id), label: room.room_types?.name ?? '' },
          property: { value: Number(pid), label: '' },
          room_id: { value: Number(room.id), label: room.name },
          housekeeper: hkByRoom.get(Number(room.id)) || [],
        };
      });

      const businessDate = await AuthController.getBusinessDate(pid).catch(() => null);

      success(res, formatted, 'Success', 200, {
        table: [
          { label: 'Unit', key: 'name', type: 'none', is_link: false, is_search: false },
          { label: 'Housekeeper', key: 'housekeeper', type: 'select_multiple', is_search: false, options: [] },
          { label: 'Clean Status', key: 'maid_status', type: 'none', is_search: false, options: Object.values(MAID_STATUSES).map((s) => ({ value: s.id, label: s.name })) },
          { label: 'Room Status', key: 'room_status', type: 'none', is_search: false, options: Object.values(ROOM_STATUSES).map((s) => ({ value: s.id, label: s.name })) },
          { label: 'Room type', key: 'room_type_id', type: 'none', is_search: false, options: [] },
          { label: 'Guest Name', key: 'guest', type: 'none', is_search: false },
          { label: 'DND', key: 'is_do_not_disturb', type: 'none', is_search: false },
          { label: 'Cleaning time', key: 'cleaning_time', type: 'none', is_search: false },
          { label: 'Linen days', key: 'linen_days', type: 'none', is_search: false },
          { label: 'Bed', key: 'total_bed', type: 'none', is_search: false },
          { label: 'Phone Ext', key: 'phone_ext', type: 'none', is_search: false },
          { label: 'Max Pax', key: 'max_pax', type: 'none', is_search: false },
          { label: 'With TV', key: 'with_tv', type: 'none', is_search: false },
          { label: 'With Shower', key: 'with_shower', type: 'none', is_search: false },
          { label: 'Floor', key: 'floor', type: 'none', is_search: false },
          { label: 'Tower', key: 'building', type: 'none', is_search: false },
        ],
        master: {
          roomStatuses: Object.values(ROOM_STATUSES).map((s) => ({ value: s.id, label: s.name })),
          business_date: businessDate,
          currentHousekeepers: [],
        },
        permission: { view: true, add: true, edit: true, delete: true },
        search_data: [
          { label: 'Room Status', key: 'room_status', type: 'select', valueOptions: Object.values(ROOM_STATUSES).map((s) => ({ value: s.id, label: s.name })) },
          { label: 'Maid Status', key: 'maid_status', type: 'select', valueOptions: Object.values(MAID_STATUSES).map((s) => ({ value: s.id, label: s.name })) },
          { label: 'Floor', key: 'floor', type: 'select', valueOptions: [] },
          { label: 'Building', key: 'building', type: 'select', valueOptions: [] },
          { label: 'Room Type', key: 'room_type', type: 'select', valueOptions: [] },
        ],
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, total) },
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

  // Replicates Laravel WorkOrderController@index
  static async workOrderList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid };
      if (search) where.work_description = { contains: search, mode: 'insensitive' };

      const [data, total, typeLinks] = await Promise.all([
        prisma.work_orders.findMany({
          where,
          orderBy: { id: 'desc' },
          include: { rooms: { select: { name: true } }, users_work_orders_reported_byTousers: { select: { name: true } }, users_work_orders_assign_toTousers: { select: { name: true } } },
        }),
        prisma.work_orders.count({ where }),
        prisma.model_has_types.findMany({
          where: { model_type: { contains: 'WorkOrder' }, types: { group: { in: ['area', 'work-type'] } } },
          include: { types: { select: { id: true, name: true, group: true } } },
        }),
      ]);
      const typeByWork = new Map<number, any>();
      typeLinks.forEach((l: any) => {
        const key = Number(l.model_id);
        const cur = typeByWork.get(key) || {};
        if (l.types?.group === 'area') cur.area = { value: Number(l.types.id), label: l.types.name, value_name: l.types.name.toLowerCase() };
        if (l.types?.group === 'work-type') cur.work_type = { value: Number(l.types.id), label: l.types.name };
        typeByWork.set(key, cur);
      });

      const formatted = data.map((w: any) => {
        const t: any = typeByWork.get(Number(w.id)) || {};
        return {
          id: Number(w.id),
          property_id: w.property_id ? Number(w.property_id) : null,
          reported_by: { value: w.reported_by ? Number(w.reported_by) : null, label: w.users_work_orders_reported_byTousers?.name ?? null },
          room_id: w.room_id ? { value: Number(w.room_id), label: w.rooms?.name ?? '' } : [],
          date: w.date,
          area: t.area || [],
          work_type: t.work_type || [],
          work_description: w.work_description,
          notes: w.notes,
          assign_to: { value: w.assign_to ? Number(w.assign_to) : null, label: w.users_work_orders_assign_toTousers?.name ?? null },
          estimated_time: w.estimated_time,
          start_date: w.start_date,
          end_date: w.end_date,
          start_time: w.start_time,
          end_time: w.end_time,
          status_work_order: w.start_time == null ? 'Open' : (w.end_time == null ? 'On Process' : 'Finish'),
          images: w.images ? (Array.isArray(w.images) ? w.images : (() => { try { return JSON.parse(w.images); } catch { return []; } })()) : [],
          created_at: w.created_at,
          updated_at: w.updated_at,
          deleted_at: w.deleted_at,
          created_by: w.created_by ? Number(w.created_by) : null,
          updated_by: w.updated_by ? Number(w.updated_by) : null,
          status: { value: 1, label: w.status ? 'Active' : 'Inactive' },
        };
      });

      const [areaTypes, workTypeTypes] = await Promise.all([
        prisma.types.findMany({ where: { deleted_at: null, status: 1, group: 'area' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.types.findMany({ where: { deleted_at: null, status: 1, group: 'work-type' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);
      const areas = areaTypes.map((t: any) => ({ value: Number(t.id), label: t.name, value_name: t.name.toLowerCase() }));
      const workTypes = workTypeTypes.map((t: any) => ({ value: Number(t.id), label: t.name }));
      const rooms = await prisma.rooms.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });

      success(res, formatted, 'Success', 200, {
        table: [
          { label: 'Reported by', key: 'reported_by', type: 'select', options: [], is_search: true },
          { label: 'Reported date', key: 'date', type: 'date', is_search: true },
          { label: 'Status', key: 'status_work_order', type: 'none', is_search: false },
          { label: 'Room', key: 'room_id', type: 'select', options: rooms.map((r: any) => ({ value: Number(r.id), label: r.name })), is_search: true },
          { label: 'Area', key: 'area', type: 'select', options: areas, is_search: true },
          { label: 'Work type', key: 'work_type', type: 'select', options: workTypes, is_search: true },
          { label: 'Work Description', key: 'work_description', type: 'text', is_search: false },
          { label: 'Start Date', key: 'start_date', type: 'date', is_search: false },
          { label: 'Start time', key: 'start_time', type: 'text', is_search: false },
          { label: 'End Date', key: 'end_date', type: 'date', is_search: false },
          { label: 'End time', key: 'end_time', type: 'text', is_search: false },
          { label: 'Assign To', key: 'assign_to', type: 'select', options: [], is_search: true },
        ],
        search_data: [
          { label: 'Reported by', key: 'reported_by', type: 'select', valueOptions: [] },
          { label: 'Reported date', key: 'date', type: 'date', valueOptions: [] },
          { label: 'Room', key: 'room_id', type: 'select', valueOptions: rooms.map((r: any) => ({ value: Number(r.id), label: r.name })) },
          { label: 'Area', key: 'area', type: 'select', valueOptions: areas },
          { label: 'Work type', key: 'work_type', type: 'select', valueOptions: workTypes },
          { label: 'Assign To', key: 'assign_to', type: 'select', valueOptions: [] },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Work order list error:', err); error(res, 'Failed to list work orders', 500); }
  }

  static async workOrderStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { reported_by, unique_code, area, work_type, date, room_id, work_description, notes, assign_to } = req.body;
      if (!work_description) { badRequest(res, 'work_description is required'); return; }

      const areaId = typeof area === 'object' && area !== null ? area?.value : area;
      const workTypeId = typeof work_type === 'object' && work_type !== null ? work_type?.value : work_type;
      const unique = unique_code ?? Buffer.from(new Date().toISOString().replace(/\D/g, '').slice(0, 14)).toString('base64');

      const data = await prisma.work_orders.create({
        data: {
          property_id: pid,
          reported_by: reported_by ? BigInt(reported_by) : null,
          unique_code: unique,
          area: areaId != null ? String(areaId) : null,
          work_type: workTypeId != null ? String(workTypeId) : null,
          date: date ? new Date(date) : null,
          room_id: room_id ? BigInt(room_id) : null,
          work_description,
          notes,
          assign_to: assign_to ? BigInt(assign_to) : null,
          status: 1,
          created_at: new Date(),
          created_by: req.user?.id,
        },
      });
      await syncWorkOrderTypes(data.id, areaId, workTypeId);
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
      const [rooms, users, areaTypes, workTypeTypes] = await Promise.all([
        prisma.rooms.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.users.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.types.findMany({ where: { deleted_at: null, status: 1, group: 'area' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.types.findMany({ where: { deleted_at: null, status: 1, group: 'work-type' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);
      const master = {
        rooms: rooms.map(r => ({ value: Number(r.id), label: r.name })),
        users: users.map(u => ({ value: Number(u.id), label: u.name })),
        assign_to: users.map(u => ({ value: Number(u.id), label: u.name })),
        areas: areaTypes.map((t: any) => ({ value: Number(t.id), label: t.name, value_name: t.name.toLowerCase() })),
        workTypes: workTypeTypes.map((t: any) => ({ value: Number(t.id), label: t.name })),
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
      const { reported_by, unique_code, area, work_type, date, room_id, work_description, notes, assign_to, status_work_order, status, estimated_time, start_date, end_date, start_time, end_time } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (reported_by !== undefined) data.reported_by = reported_by ? BigInt(reported_by) : null;
      if (unique_code !== undefined) data.unique_code = unique_code;
      if (area !== undefined) data.area = area != null ? String(area) : null;
      if (work_type !== undefined) data.work_type = work_type != null ? String(work_type) : null;
      if (date !== undefined) data.date = date ? new Date(date) : null;
      if (room_id !== undefined) data.room_id = room_id ? BigInt(room_id) : null;
      if (work_description !== undefined) data.work_description = work_description;
      if (notes !== undefined) data.notes = notes;
      if (assign_to !== undefined) data.assign_to = assign_to ? BigInt(assign_to) : null;
      if (status_work_order !== undefined) data.status_work_order = num(status_work_order, 0);
      if (status !== undefined) data.status = num(status, 1);
      if (estimated_time !== undefined) data.estimated_time = estimated_time ? new Date(estimated_time) : null;
      if (start_date !== undefined) data.start_date = start_date ? new Date(start_date) : null;
      if (end_date !== undefined) data.end_date = end_date ? new Date(end_date) : null;
      if (start_time !== undefined) data.start_time = start_time;
      if (end_time !== undefined) data.end_time = end_time;
      await prisma.work_orders.update({ where: { id }, data });
      const areaId = typeof area === 'object' && area !== null ? area?.value : area;
      const workTypeId = typeof work_type === 'object' && work_type !== null ? work_type?.value : work_type;
      if (areaId !== undefined || workTypeId !== undefined) {
        await prisma.model_has_types.deleteMany({ where: { model_id: id, model_type: { contains: 'WorkOrder' } } });
        await syncWorkOrderTypes(id, areaId, workTypeId);
      }
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Housekeeper history error:', err); error(res, 'Failed to fetch housekeeper history', 500); }
  }

  // ==================== ROOM STATUS: CHECKLIST ====================
  // Replicates Laravel HouseKeepingRoomStatusController@checklist
  static async roomStatusChecklist(req: Request, res: Response): Promise<void> {
    try {
      const room = await prisma.rooms.findUnique({ where: { id: BigInt(req.query.room_id as string) } });
      if (!room) { notFound(res, 'Room not found'); return; }

      const usedBy = String(req.query.used_by ?? '').toLowerCase().trim();
      const pid = BigInt(req.user?.lastProperty ?? 0);

      const setups = await prisma.housekeeping_setups.findMany({
        where: { status: true, property_id: pid, deleted_at: null },
        include: {
          housekeeping_setup_room_types: { where: { room_type_id: room.room_type_id ?? BigInt(0) } },
          housekeeping_setup_rooms: { where: { room_id: room.id } },
        },
        orderBy: { sort: 'asc' },
      });

      const rows = setups
        .filter((s) => {
          if (usedBy === 'hk') return s.used_by === 'hk' || s.used_by === 'both' || s.used_by_hk === true;
          if (usedBy === 'hkspv') return s.used_by === 'hkspv' || s.used_by === 'both' || s.used_by_hkspv === true;
          return true;
        })
        .filter((s) => s.housekeeping_setup_rooms.length > 0 || s.housekeeping_setup_room_types.length > 0)
        .map((s) => {
          const roomQty = s.housekeeping_setup_rooms[0];
          const typeQty = s.housekeeping_setup_room_types[0];
          const qty = roomQty ? roomQty.qty : typeQty ? typeQty.qty : 1;
          return {
            id: Number(s.id),
            code: s.code,
            item_name: s.item_name,
            category: s.category,
            description: s.description,
            qty,
            is_required: s.is_required,
            mandatory_inspection: s.mandatory_inspection,
            used_by: s.used_by,
          };
        });

      success(res, rows, 'Success');
    } catch (err: any) { console.error('Room status checklist error:', err); error(res, 'Failed to load checklist', 500); }
  }

  // ==================== ROOM STATUS: SAVE CHECKLIST ====================
  // Replicates Laravel HouseKeepingRoomStatusController@saveChecklist
  static async roomStatusSaveChecklist(req: Request, res: Response): Promise<void> {
    try {
      const { history_id, type, checklist, reclean_notes } = req.body;
      if (!history_id) { badRequest(res, 'history_id is required'); return; }

      const history = await prisma.housekeeper_history.findUnique({ where: { id: BigInt(history_id) } });
      if (!history) { notFound(res, 'History not found'); return; }

      const items = checklist ?? [];
      const data: any = {};

      if (type === 'hk') {
        data.hk_checklist = JSON.stringify(items);
      } else {
        data.hkspv_checklist = JSON.stringify(items);
        const hasUnchecked = Object.values(items).some((v) => !v);
        data.need_rec_cleaning = hasUnchecked;
        data.reclean_notes = reclean_notes ?? null;

        if (hasUnchecked && history.room_id) {
          await prisma.rooms.update({ where: { id: history.room_id }, data: { maid_status: 0 } });
        }
      }

      await prisma.housekeeper_history.update({ where: { id: history.id }, data });
      success(res, null, 'Success');
    } catch (err: any) { console.error('Room status save checklist error:', err); error(res, 'Failed to save checklist', 500); }
  }

  // ==================== ROOM STATUS: BATCH UPDATE ====================
  // Replicates Laravel HouseKeepingRoomStatusController@batchUpdate
  static async roomStatusBatch(req: Request, res: Response): Promise<void> {
    try {
      const { housekeeper, selectedRoomId, date } = req.body;
      if (!Array.isArray(housekeeper) || !selectedRoomId || !date) { badRequest(res, 'housekeeper, selectedRoomId and date are required'); return; }

      const pid = BigInt(req.user?.lastProperty ?? 0);
      const dateObj = new Date(date);

      for (const [roomIdStr, isSelected] of Object.entries(selectedRoomId)) {
        if (isSelected !== true) continue;
        const roomId = BigInt(roomIdStr);

        let history = await prisma.housekeeper_history.findFirst({
          where: { room_id: roomId, date: dateObj, done_inspection: null },
          orderBy: { id: 'desc' },
        });

        if (!history) {
          history = await prisma.housekeeper_history.create({
            data: { room_id: roomId, date: dateObj, property_id: pid, status: 1, created_at: new Date(), created_by: req.user?.id },
          });
        }

        await prisma.housekeeper_history_user.deleteMany({ where: { housekeeper_history_id: history.id } });

        if (housekeeper.length > 0) {
          await prisma.housekeeper_history_user.createMany({
            data: housekeeper.map((hk: any) => ({
              housekeeper_history_id: history.id,
              user_id: BigInt(hk?.value ?? hk?.id ?? hk),
              property_id: pid,
              status: 1,
            })),
          });
        }
      }

      success(res, null, 'Batch update successful');
    } catch (err: any) { console.error('Room status batch error:', err); error(res, 'An error occurred during batch update: ' + (err as any).message, 500); }
  }

  // ==================== ROOM STATUS: CURRENT HOUSEKEEPERS ====================
  // Replicates Laravel HouseKeepingRoomStatusController@currentHousekeepers
  static async currentHousekeepers(req: Request, res: Response): Promise<void> {
    try {
      const dateStr = String(req.query.date ?? '');
      const dateObj = dateStr && dateStr !== '0' ? new Date(dateStr) : new Date();
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const nowHm = new Date().toISOString().slice(11, 16); // HH:MM (UTC, konsisten dgn penyimpanan shift_roster)

      const rosters = await prisma.rosters.findMany({
        where: { date: dateObj, property_id: pid, is_assigned: 1 },
      });

      const result: { value: number; label: string }[] = [];
      for (const r of rosters) {
        if (r.shift_id === null || r.shift_id === undefined) continue;
        const shift = await prisma.shift_roster.findUnique({ where: { id: BigInt(r.shift_id) } });
        if (!shift?.time_start || !shift?.time_end) continue;
        const ts = shift.time_start.toISOString().slice(11, 16);
        const te = shift.time_end.toISOString().slice(11, 16);
        const inShift = ts <= te ? nowHm >= ts && nowHm <= te : nowHm >= ts || nowHm <= te;
        if (!inShift) continue;
        const user = await prisma.users.findUnique({ where: { id: BigInt(r.user_id) }, select: { id: true, name: true } });
        if (user) result.push({ value: Number(user.id), label: user.name ?? 'Unknown User' });
      }

      const unique = [...new Map(result.map((u) => [u.value, u])).values()];
      success(res, unique, 'Current housekeepers retrieved successfully');
    } catch (err: any) { console.error('Current housekeepers error:', err); error(res, 'Failed to get current housekeepers', 500); }
  }

  // ==================== ROOM STATUS: UPDATE STATUS ====================
  // Replicates Laravel HouseKeepingRoomStatusController@updateStatus
  static async roomStatusUpdateStatus(req: Request, res: Response): Promise<void> {
    try {
      const roomId = idParam(req.params.id);
      const room = await prisma.rooms.findUnique({ where: { id: roomId } });
      if (!room) { notFound(res, 'Not Found'); return; }

      const { type, checklist, reclean_notes, date } = req.body;
      if (!type) { badRequest(res, 'type is required'); return; }
      const dateObj = date ? new Date(date) : new Date();

      if (room.room_status === ROOM_STATUSES.due_out.id) {
        error(res, 'Room need to be checked out first', 400);
        return;
      }

      const history = await prisma.housekeeper_history.findFirst({
        where: { room_id: roomId, date: dateObj },
        orderBy: { id: 'desc' },
      });
      if (!history) { notFound(res, 'Housekeeper not found'); return; }

      const now = new Date();
      const data: any = {};
      let maidStatus: number | null = null;

      if (type === 'start_clean_time') {
        data.start_clean_time = now;
        data.end_clean_time = null;
        data.done_inspection = null;
        maidStatus = MAID_STATUSES.maid_in_room.id;
      } else if (type === 'end_clean_time') {
        data.end_clean_time = now;
        data.hk_checklist = JSON.stringify(checklist ?? []);
        data.need_rec_cleaning = false;
        maidStatus = MAID_STATUSES.inspection_required.id;

        // Notif ke semua HKSPV yang punya permission perform_inspection (Laravel FcmNotificationService parity)
        try {
          const inspectRoles = await prisma.role_permissions.findMany({
            where: { permissions: { name: 'perform_inspection' } },
            select: { role_id: true },
          });
          const roleIds = inspectRoles.map((rp) => rp.role_id);
          const assigned = roleIds.length > 0
            ? await prisma.model_has_roles.findMany({
                where: { role_id: { in: roleIds }, model_type: 'App\\Models\\User' },
                select: { model_id: true },
              })
            : [];
          const userIds = assigned.map((a) => a.model_id);
          const hkspvUsers = userIds.length > 0
            ? await prisma.users.findMany({ where: { id: { in: userIds }, fcm_token: { not: null } }, select: { fcm_token: true } })
            : [];
          const tokens = hkspvUsers.map((u) => u.fcm_token!).filter(Boolean);
          if (tokens.length > 0) {
            const roomName = room.name ?? `Room #${room.id}`;
            await firebaseService.sendToMultipleTokens(tokens, {
              title: '🔍 Inspection Required',
              body: `Kamar ${roomName} sudah selesai dibersihkan, silakan lakukan inspeksi.`,
              data: {
                type: 'inspection_required',
                room_id: String(Number(roomId)),
                date: dateObj.toISOString().slice(0, 10),
              },
            });
          }
        } catch (fcmErr: any) {
          console.error('Notif inspection error:', fcmErr?.message ?? fcmErr);
        }
      } else if (type === 'done_inspection') {
        data.done_inspection = now;
        data.hkspv_checklist = JSON.stringify(checklist ?? []);
        data.need_rec_cleaning = false;
        data.reclean_notes = null;
        data.inspected_by = req.user?.id;
        maidStatus = MAID_STATUSES.clean.id;
      } else if (type === 'still_need_to_clean') {
        data.start_clean_time = null;
        data.end_clean_time = null;
        data.done_inspection = null;
        data.need_rec_cleaning = true;
        data.reclean_notes = reclean_notes ?? null;
        data.inspected_by = req.user?.id;
        data.inspection_time = now;
        maidStatus = MAID_STATUSES.dirty.id;
      } else {
        badRequest(res, 'Invalid type'); return;
      }

      await prisma.housekeeper_history.update({ where: { id: history.id }, data });
      if (maidStatus !== null) await prisma.rooms.update({ where: { id: roomId }, data: { maid_status: maidStatus } });

      success(res, null, 'Success');
    } catch (err: any) { console.error('Room status update error:', err); error(res, 'Failed to update status', 500); }
  }

  // ==================== HOUSEKEEPER HISTORY BY ROOM ====================
  // Replicates Laravel HouseKeeperHistoryController@index (room + date range, daily rows)
  static async housekeeperHistoryList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const roomIdRaw = req.query.room_id as string;
      const fromDate = req.query.from_date as string;
      const toDate = req.query.to_date as string;

      if (!roomIdRaw) {
        success(res, [], 'No room ID provided.', 200, {
          table: housekeeperHistoryTable(),
          pagination: { current_page: page, last_page: 1, per_page: limit, total: 0, from: 0, to: 0 },
          permission: { view: true, add: true, edit: true, delete: true },
          search_data: [],
        });
        return;
      }

      const room = await prisma.rooms.findUnique({ where: { id: BigInt(roomIdRaw) } });
      const where: any = { room_id: BigInt(roomIdRaw), deleted_at: null };
      if (fromDate && toDate) {
        where.date = { gte: new Date(fromDate + 'T00:00:00.000Z'), lte: new Date(toDate + 'T23:59:59.999Z') };
      } else if (fromDate) {
        where.date = { gte: new Date(fromDate + 'T00:00:00.000Z') };
      } else if (toDate) {
        where.date = { lte: new Date(toDate + 'T23:59:59.999Z') };
      }

      const data = await prisma.housekeeper_history.findMany({ where, orderBy: { id: 'asc' } });
      const totalData = data.length;

      const userIds = new Set<bigint>();
      data.forEach((h) => { if (h.user_id) userIds.add(h.user_id); if (h.inspected_by) userIds.add(h.inspected_by); });
      const historyUsers = await prisma.housekeeper_history_user.findMany({
        where: { housekeeper_history_id: { in: data.map((d) => d.id) }, deleted_at: null },
      });
      historyUsers.forEach((hu) => userIds.add(hu.user_id ?? BigInt(0)));
      const users = await prisma.users.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } });
      const userMap = new Map(users.map((u) => [u.id, u.name ?? 'Unknown']));
      const roomMap = room ? new Map([[room.id, room.name ?? `Room #${room.id}`]]) : new Map();

      const historyByUser = new Map<bigint, { value: number; label: string }[]>();
      historyUsers.forEach((hu) => {
        if (hu.housekeeper_history_id === null || hu.housekeeper_history_id === undefined) return;
        const key = hu.housekeeper_history_id;
        if (!historyByUser.has(key)) historyByUser.set(key, []);
        if (hu.user_id !== null && hu.user_id !== undefined) {
          historyByUser.get(key)!.push({ value: Number(hu.user_id), label: userMap.get(hu.user_id) ?? 'Unknown' });
        }
      });

      const fmt = (d: Date | null): string => (d ? d.toISOString().slice(0, 19).replace('T', ' ') : '');
      const fmtDate = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');

      const result: any[] = [];
      if (fromDate && toDate) {
        const start = new Date(fromDate + 'T00:00:00.000Z');
        const end = new Date(toDate + 'T00:00:00.000Z');
        const nights = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
        for (let i = 0; i <= nights; i++) {
          const night = new Date(start.getTime() + i * 86400000);
          const nightStr = night.toISOString().slice(0, 10);
          const daily = data.filter((h) => fmtDate(h.date) === nightStr);
          if (daily.length === 0) {
            result.push({
              id: '', property_id: '', user_id: [], room_id: { value: room ? Number(room.id) : null, label: room?.name ?? null },
              housekeeper: [], start_clean_time: '', end_clean_time: '', done_inspection: '', reclean_notes: '',
              date: nightStr, created_at: '', updated_at: '', deleted_at: '', created_by: '', updated_by: '', deleted_by: '', status: '',
            });
          } else {
            daily.forEach((h) => {
              result.push({
                id: Number(h.id),
                property_id: h.property_id ? Number(h.property_id) : '',
                user_id: h.user_id ? { value: Number(h.user_id), label: userMap.get(h.user_id) ?? null } : [],
                room_id: { value: room ? Number(room.id) : null, label: room?.name ?? null },
                housekeeper: historyByUser.get(h.id) ?? [],
                start_clean_time: fmt(h.start_clean_time),
                end_clean_time: fmt(h.end_clean_time),
                done_inspection: h.done_inspection ? !!h.done_inspection : '',
                reclean_notes: h.reclean_notes ?? '',
                inspected_by: h.inspected_by ? { value: Number(h.inspected_by), label: userMap.get(h.inspected_by) ?? null } : [],
                inspection_time: fmt(h.inspection_time),
                date: fmtDate(h.date),
                created_at: fmt(h.created_at),
                updated_at: fmt(h.updated_at),
                deleted_at: h.deleted_at ? fmt(h.deleted_at) : '',
                created_by: h.created_by ? Number(h.created_by) : '',
                updated_by: h.updated_by ? Number(h.updated_by) : '',
                deleted_by: h.deleted_by ? Number(h.deleted_by) : '',
                status: h.status ?? '',
              });
            });
          }
        }
      } else {
        data.forEach((h) => {
          result.push({
            id: Number(h.id),
            property_id: h.property_id ? Number(h.property_id) : '',
            user_id: h.user_id ? { value: Number(h.user_id), label: userMap.get(h.user_id) ?? null } : [],
            room_id: { value: room ? Number(room.id) : null, label: room?.name ?? null },
            housekeeper: historyByUser.get(h.id) ?? [],
            start_clean_time: fmt(h.start_clean_time),
            end_clean_time: fmt(h.end_clean_time),
            done_inspection: h.done_inspection ? !!h.done_inspection : '',
            reclean_notes: h.reclean_notes ?? '',
            inspected_by: h.inspected_by ? { value: Number(h.inspected_by), label: userMap.get(h.inspected_by) ?? null } : [],
            inspection_time: fmt(h.inspection_time),
            date: fmtDate(h.date),
            created_at: fmt(h.created_at),
            updated_at: fmt(h.updated_at),
            deleted_at: h.deleted_at ? fmt(h.deleted_at) : '',
            created_by: h.created_by ? Number(h.created_by) : '',
            updated_by: h.updated_by ? Number(h.updated_by) : '',
            deleted_by: h.deleted_by ? Number(h.deleted_by) : '',
            status: h.status ?? '',
          });
        });
      }

      success(res, result, 'Success', 200, {
        table: housekeeperHistoryTable(),
        pagination: { current_page: page, last_page: Math.ceil(totalData / limit), per_page: limit, total: totalData, from: totalData ? (page - 1) * limit + 1 : 0, to: Math.min(totalData, page * limit) },
        permission: { view: true, add: true, edit: true, delete: true },
        search_data: [],
      });
    } catch (err: any) { console.error('Housekeeper history list error:', err); error(res, 'Failed to fetch housekeeper history', 500); }
  }

  static async shiftUserList(req: Request, res: Response) {
    try {
      const { mode, search = '', page = '1' } = req.query;
      if (mode !== 'users') {
        success(res, [], 'Success', 200, { pagination: { current_page: 1, last_page: 1, per_page: 15, total: 0, from: 0, to: 0 } });
        return;
      }
      const limit = 15;
      const pageNum = Math.max(1, Number(page) || 1);
      const skip = (pageNum - 1) * limit;
      const lastProperty = req.user?.lastProperty ? BigInt(req.user.lastProperty) : null;

      // users whose roles hold perform_cleaning=true on menu 172 (room-status)
      const rmcs = await prisma.role_menu_crud.findMany({
        where: { menu_id: BigInt(172) },
        select: { role_id: true, transaction_actions: true },
      });
      const roleIds = rmcs.filter((r) => {
        if (!r.transaction_actions) return false;
        try {
          const ta = JSON.parse(r.transaction_actions);
          return ta.perform_cleaning === true || ta.perform_cleaning === 1 || ta.perform_cleaning === 'true';
        } catch { return false; }
      }).map((r) => r.role_id);

      const userIds: bigint[] = [];
      if (roleIds.length) {
        const mhr = await prisma.model_has_roles.findMany({
          where: { role_id: { in: roleIds }, model_type: 'App\\Models\\User' },
          select: { model_id: true },
        });
        mhr.forEach((m) => userIds.push(m.model_id));
      }
      let filteredIds = userIds;
      if (lastProperty) {
        const userProp = await prisma.model_has_properties.findMany({
          where: { property_id: lastProperty, model_type: 'App\\Models\\User' },
          select: { model_id: true },
        });
        const userPropSet = new Set(userProp.map((p) => p.model_id));
        filteredIds = userIds.filter((id) => userPropSet.has(id));
      }

      const where: Prisma.usersWhereInput = { id: { in: filteredIds } };
      if (search) where.name = { contains: String(search) };
      const [totalData, users] = await Promise.all([
        prisma.users.count({ where }),
        prisma.users.findMany({
          where,
          orderBy: { name: 'asc' },
          skip,
          take: limit,
          select: { id: true, name: true },
        }),
      ]);
      const result = users.map((u) => ({ id: Number(u.id), name: u.name }));
      success(res, result, 'Success', 200, {
        pagination: { current_page: pageNum, last_page: Math.ceil(totalData / limit), per_page: limit, total: totalData, from: totalData ? skip + 1 : 0, to: Math.min(totalData, skip + limit) },
      });
    } catch (err: any) { console.error('Shift user list error:', err); error(res, 'Failed to load shift user list', 500); }
  }
}

function housekeeperHistoryTable(): any[] {
  return [
    { label: 'Date', key: 'date', type: 'date', is_search: false },
    { label: 'Room', key: 'room_id', type: 'select', is_search: false, options: [] },
    { label: 'Housekeeper', key: 'housekeeper', type: 'select_multiple', is_search: false, options: [] },
    { label: 'Start Clean Time', key: 'start_clean_time', type: 'text', is_search: false },
    { label: 'End Clean Time', key: 'end_clean_time', type: 'text', is_search: false },
    { label: 'Done Inspection', key: 'done_inspection', type: 'checkbox', is_search: false },
    { label: 'Reclean Notes', key: 'reclean_notes', type: 'text', is_search: false },
    { label: 'Inspected By', key: 'inspected_by', type: 'select', is_search: false },
    { label: 'Inspected Time', key: 'inspection_time', type: 'select', is_search: false },
  ];
}

