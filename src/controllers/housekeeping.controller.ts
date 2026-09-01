import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { dataSearch } from '../utils/search';
import { STATUSES } from '../utils/cmsConfig';
import { ROOM_STATUSES, MAID_STATUSES } from '../utils/cmsStatus';
import { TABLES } from '../utils/tableMeta';
import { AuthController } from './auth.controller';
import { firebaseService } from '../services/firebase.service';
import { notificationService } from '../services/notification.service';
import * as fs from 'fs';
import * as path from 'path';

// Laravel WorkOrderController:229-248 parity — decode base64 data-URIs and write
// to local storage. Root dir configurable via STORAGE_PATH (default ./storage).
function saveWorkOrderImages(workOrderId: number, images: any[]): string[] {
  const saved: string[] = [];
  const root = process.env.STORAGE_PATH || path.join(process.cwd(), 'storage');
  for (const raw of images) {
    if (typeof raw !== 'string') continue;
    // Existing paths pass through untouched (= Laravel update behavior).
    if (!raw.startsWith('data:image')) { saved.push(raw); continue; }
    const m = raw.match(/^data:image\/(\w+);base64,(.*)$/);
    if (!m) continue;
    try {
      const ext = m[1].toLowerCase();
      const buf = Buffer.from(m[2], 'base64');
      const dir = path.join(root, 'work-orders');
      fs.mkdirSync(dir, { recursive: true });
      const fileName = `${workOrderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      fs.writeFileSync(path.join(dir, fileName), buf);
      saved.push(`/work-orders/${fileName}`);
    } catch (e: any) {
      console.error('WO image save failed:', e?.message);
    }
  }
  return saved;
}

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

function fmtDateOnly(d: any): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d).substring(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDateTime(d: any): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d).replace('T', ' ').substring(0, 19);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
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
        permission: getPermissionFlags(req.user, 158),
        table: [
          { label: 'Code', key: 'code', type: 'text', is_search: true },
          { label: 'Item Name', key: 'item_name', type: 'text', is_search: true },
          { label: 'Category', key: 'category', type: 'text', is_search: true },
          { label: 'Used By', key: 'used_by', type: 'text', is_search: true },
          { label: 'Status', key: 'status', type: 'checkbox', is_search: true, options: STATUSES },
        ],
        search_data: [
          { label: 'Code', key: 'code', type: 'text', is_search: true },
          { label: 'Item Name', key: 'item_name', type: 'text', is_search: true },
          { label: 'Status', key: 'status', type: 'select', valueOptions: STATUSES },
        ],
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Setup list error:', err); error(res, 'Failed to list setups', 500); }
  }

  static async setupStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { code, item_name, category, used_by, description, is_required, mandatory_inspection, sort, status, room_types_detail = [], rooms_detail = [] } = req.body;
      if (!code || !item_name) { badRequest(res, 'code and item_name are required'); return; }

      // Laravel HousekeepingSetupController@store (:139-186): setup + qty pivots.
      const data = await prisma.housekeeping_setups.create({
        data: {
          property_id: pid,
          code: String(code).toUpperCase(),
          item_name,
          category,
          used_by,
          description,
          is_required: is_required ?? true,
          mandatory_inspection: mandatory_inspection ?? false,
          sort: num(sort, 0),
          status: status ?? true,
          created_at: new Date(),
          created_by: req.user?.id,
        },
      });

      for (const row of room_types_detail) {
        if (!row?.room_type_id) continue;
        await prisma.housekeeping_setup_room_types.create({
          data: {
            property_id: pid,
            housekeeping_setup_id: data.id,
            room_type_id: BigInt(row.room_type_id),
            qty: Number(row.qty ?? 1),
            is_required: row.is_required ?? true,
          },
        });
      }
      for (const row of rooms_detail) {
        if (!row?.room_id) continue;
        await prisma.housekeeping_setup_rooms.create({
          data: {
            property_id: pid,
            housekeeping_setup_id: data.id,
            room_id: BigInt(row.room_id),
            qty: Number(row.qty ?? 1),
            is_required: row.is_required ?? true,
          },
        });
      }

      success(res, bigintToNumber(data), 'Setup created', 201);
    } catch (err: any) { console.error('Setup store error:', err); error(res, 'Failed to create setup', 500); }
  }

  static async setupShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      // Laravel edit() returns the setup WITH its rooms/room-types qty details.
      const data = await prisma.housekeeping_setups.findUnique({
        where: { id },
        include: {
          housekeeping_setup_room_types: { select: { room_type_id: true, qty: true, is_required: true } },
          housekeeping_setup_rooms: { select: { room_id: true, qty: true, is_required: true } },
        },
      });
      if (!data) { notFound(res, 'Setup not found'); return; }
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load setup', 500); }
  }

  static async setupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { code, item_name, category, used_by, description, is_required, mandatory_inspection, sort, status, room_types_detail = [], rooms_detail = [] } = req.body;
      const data: any = {};
      if (code !== undefined) data.code = String(code).toUpperCase();
      if (item_name !== undefined) data.item_name = item_name;
      if (category !== undefined) data.category = category;
      if (used_by !== undefined) data.used_by = used_by;
      if (description !== undefined) data.description = description;
      if (is_required !== undefined) data.is_required = is_required;
      if (mandatory_inspection !== undefined) data.mandatory_inspection = mandatory_inspection;
      if (sort !== undefined) data.sort = num(sort, 0);
      if (status !== undefined) data.status = status;
      data.updated_at = new Date();
      data.updated_by = req.user?.id;
      await prisma.housekeeping_setups.update({ where: { id }, data });

      // Laravel update (:344-378): full replace both qty pivots.
      if (Array.isArray(room_types_detail)) {
        await prisma.housekeeping_setup_room_types.deleteMany({ where: { housekeeping_setup_id: id } });
        for (const row of room_types_detail) {
          if (!row?.room_type_id) continue;
          await prisma.housekeeping_setup_room_types.create({
            data: {
              property_id: BigInt(req.user?.lastProperty ?? 0),
              housekeeping_setup_id: id,
              room_type_id: BigInt(row.room_type_id),
              qty: Number(row.qty ?? 1),
              is_required: row.is_required ?? true,
            },
          });
        }
      }
      if (Array.isArray(rooms_detail)) {
        await prisma.housekeeping_setup_rooms.deleteMany({ where: { housekeeping_setup_id: id } });
        for (const row of rooms_detail) {
          if (!row?.room_id) continue;
          await prisma.housekeeping_setup_rooms.create({
            data: {
              property_id: BigInt(req.user?.lastProperty ?? 0),
              housekeeping_setup_id: id,
              room_id: BigInt(row.room_id),
              qty: Number(row.qty ?? 1),
              is_required: row.is_required ?? true,
            },
          });
        }
      }

      success(res, null, 'Setup updated');
    } catch (err: any) { console.error('Setup update error:', err); error(res, 'Failed to update setup', 500); }
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
      // UTC midnight — must match how assignments store the date (T00:00:00.000Z)
      const date = new Date(dateStr + 'T00:00:00.000Z');
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
          select: { id: true, room_id: true },
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
      // Assignment lives in the housekeeper_history_user pivot — history.user_id is unused
      const historyIds = histories.map((h) => h.id);
      const hkPivots = historyIds.length
        ? await prisma.housekeeper_history_user.findMany({
            where: { housekeeper_history_id: { in: historyIds }, deleted_at: null },
            select: { housekeeper_history_id: true, user_id: true },
          })
        : [];
      const roomIdByHistory = new Map(histories.map((h) => [Number(h.id), Number(h.room_id)]));
      const hkPairs = hkPivots.map((p) => ({ room_id: roomIdByHistory.get(Number(p.housekeeper_history_id)), user_id: p.user_id }));
      const hkUserIds = [...new Set(hkPairs.filter((h) => h.user_id).map((h) => Number(h.user_id)))];
      const hkUsers = hkUserIds.length ? await prisma.users.findMany({ where: { id: { in: hkUserIds.map((i) => BigInt(i)) } }, select: { id: true, name: true } }) : [];
      const hkUserMap = new Map(hkUsers.map((u: any) => [Number(u.id), u.name]));

      const folioIds = [...new Set(folioRows.map((f: any) => f.folio_id))];
      const folioMap = new Map<number, any>();
      if (folioIds.length) {
        const folios = await prisma.folios.findMany({ where: { id: { in: folioIds }, deleted_at: null }, select: { id: true, first_name: true, last_name: true, is_do_not_disturb: true } });
        folios.forEach((f: any) => folioMap.set(Number(f.id), f));
      }
      const hkByRoom = new Map<number, { value: number; label: string }[]>();
      hkPairs.forEach((h: any) => {
        const rid = Number(h.room_id);
        const name = hkUserMap.get(Number(h.user_id));
        if (!rid || !name) return;
        const cur = hkByRoom.get(rid) || [];
        if (!cur.some((x: any) => x.value === Number(h.user_id))) {
          hkByRoom.set(rid, [...cur, { value: Number(h.user_id), label: name }]);
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

      // Housekeeper dropdown options — users whose role grants any HK transaction
      // action (perform_cleaning / perform_inspection / assign_housekeeper) via
      // role_menu_crud.transaction_actions, scoped to the property.
      // (= Laravel ServiceSchedulerController@housekeepers JSON_EXTRACT parity)
      const hkActions = ['perform_cleaning', 'perform_inspection', 'assign_housekeeper'];
      const rmcs = await prisma.role_menu_crud.findMany({ select: { role_id: true, transaction_actions: true } });
      const hkRoleIds = rmcs
        .filter((r) => {
          if (!r.transaction_actions) return false;
          try {
            const ta = JSON.parse(r.transaction_actions);
            return hkActions.some((a) => ta[a] === true || ta[a] === 1 || ta[a] === 'true');
          } catch { return false; }
        })
        .map((r) => r.role_id);
      let housekeeperOptions: any[] = [];
      if (hkRoleIds.length > 0) {
        const links = await prisma.model_has_roles.findMany({
          where: { model_type: 'App\\Models\\User', role_id: { in: hkRoleIds } },
          select: { model_id: true },
          distinct: ['model_id'],
        });
        let hkUserIds = [...new Set(links.map((l: any) => Number(l.model_id)))];
        // property scope
        const userProps = await prisma.model_has_properties.findMany({
          where: { property_id: pid, model_type: 'App\\Models\\User' },
          select: { model_id: true },
        });
        const propSet = new Set(userProps.map((p: any) => Number(p.model_id)));
        hkUserIds = hkUserIds.filter((id) => propSet.has(id));
        if (hkUserIds.length > 0) {
          const hks = await prisma.users.findMany({
            where: { deleted_at: null, id: { in: hkUserIds.map((id) => BigInt(id)) } },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          });
          housekeeperOptions = hks.map((u: any) => ({ value: Number(u.id), label: u.name }));
        }
      }

      success(res, formatted, 'Success', 200, {
        table: [
          { label: 'Unit', key: 'name', type: 'none', is_link: false, is_search: false },
          { label: 'Housekeeper', key: 'housekeeper', type: 'select_multiple', is_search: false, options: housekeeperOptions },
          { label: 'Clean Status', key: 'maid_status', type: 'none', is_search: false, options: Object.values(MAID_STATUSES).map((s) => ({ value: s.id, label: s.name })) },
          { label: 'Room Status', key: 'room_status', type: 'none', is_search: false, options: Object.values(ROOM_STATUSES).map((s) => ({ value: s.id, label: s.name })) },
          { label: 'Room type', key: 'room_type_id', type: 'none', is_search: false, options: [] },
          { label: 'Guest Name', key: 'guest', type: 'none', is_search: false },
          { label: 'DND', key: 'is_do_not_disturb', type: 'none', is_search: false },
          { label: 'Cleaning time', key: 'cleaning_time', type: 'date', is_search: false },
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
          housekeepers: housekeeperOptions,
        },
        permission: getPermissionFlags(req.user, 158),
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
        permission: getPermissionFlags(req.user, 158),
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Work order list error:', err); error(res, 'Failed to list work orders', 500); }
  }

static async workOrderStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { reported_by, unique_code, area, work_type, date, room_id, work_description, notes, assign_to } = req.body;

      // Laravel validator parity (WorkOrderController:143-152)
      if (!reported_by) { badRequest(res, 'The reported by field is required.'); return; }
      if (!date) { badRequest(res, 'The date field is required.'); return; }
      if (!work_description) { badRequest(res, 'work_description is required'); return; }

      const areaId = typeof area === 'object' && area !== null ? area?.value : area;
      const workTypeId = typeof work_type === 'object' && work_type !== null ? work_type?.value : work_type;
      const unique = unique_code ?? Buffer.from(new Date().toISOString().replace(/\D/g, '').slice(0, 14)).toString('base64');

      const bussinesDate = await AuthController.getBusinessDate(pid);

      // ── Laravel store guards (:155-206) ──
      let roomRow: any = null;
      if (room_id) {
        roomRow = await prisma.rooms.findUnique({ where: { id: BigInt(room_id) } });
        if (!roomRow) { notFound(res, 'Room not found'); return; }

        // Reserved check: reservation on this room+date whose folio is reservation/check-in
        const reserved = await prisma.reservations.findFirst({
          where: {
            room_id: BigInt(room_id),
            date: new Date(date),
            deleted_at: null,
            folios: { is: { status_reservation: { in: [3, 0] }, deleted_at: null } },
          },
          select: { id: true },
        });
        if (reserved) { notFound(res, 'Room is already reserved'); return; }

        // Vacant check
        if (roomRow.room_status !== ROOM_STATUSES.vacant.id) {
          badRequest(res, 'Room status is not vacant');
          return;
        }

        // Duplicate open work order
        const dupWo = await prisma.work_orders.findFirst({
          where: {
            date: { lte: new Date(date) },
            room_id: BigInt(room_id),
            OR: [{ end_date: { gt: new Date(date) } }, { end_date: null }],
            status: 1,
            deleted_at: null,
          },
          select: { id: true },
        });
        if (dupWo) {
          badRequest(res, 'Work order is already exists for this room');
          return;
        }
      }

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

      // Image upload — Laravel WorkOrderController:229-248 (base64 -> storage/work-orders).
      if (Array.isArray(req.body.images) && req.body.images.length > 0) {
        const paths = saveWorkOrderImages(Number(data.id), req.body.images);
        if (paths.length) {
          await prisma.work_orders.update({ where: { id: data.id }, data: { images: JSON.stringify(paths) } });
        }
      }

      // Sync room_status=OOO — hanya jika tanggal WO == business date (Laravel :208-212)
      if (data.room_id && date && bussinesDate === String(date).slice(0, 10)) {
        await prisma.rooms.update({
          where: { id: data.room_id },
          data: { room_status: ROOM_STATUSES.out_of_order.id, updated_at: new Date() },
        });
      }

      // FCM assignment notification (Laravel sendWorkOrderAssignmentNotification)
      if (assign_to) {
        try {
          const assignedUser = await prisma.users.findUnique({ where: { id: BigInt(assign_to) }, select: { fcm_token: true } });
          if (assignedUser?.fcm_token) {
            const roomName = roomRow?.name ?? 'Room TBD';
            const workType = workTypeId != null ? String(workTypeId) : 'Maintenance';
            await firebaseService.sendToToken({
              token: assignedUser.fcm_token,
              payload: {
                title: '🛠️ New Work Order Assigned',
                body: `Anda ditugaskan untuk mengerjakan Work Order di ${roomName} - ${workType}`,
                data: {
                  type: 'work_order_assignment',
                  work_order_id: String(Number(data.id)),
                  room_id: data.room_id ? String(Number(data.room_id)) : '',
                  date: date ?? '',
                },
              },
            });
          }
        } catch (fcmErr: any) {
          console.error('Notif Work Order Assignment Error:', fcmErr?.message);
        }
      }

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
      const { area, work_type, assign_to, status_work_order, start_date, end_date, start_time, end_time, work_description, notes } = req.body;

      const oldWo = await prisma.work_orders.findUnique({ where: { id }, select: { room_id: true, start_date: true, assign_to: true, deleted_at: true, images: true } });
      if (!oldWo || oldWo.deleted_at) { notFound(res, 'Work order not found'); return; }

      const pid = BigInt(req.user?.lastProperty ?? 0);
      const bussinesDate = await AuthController.getBusinessDate(pid);

      // Normalize assign_to: object {value,label} atau scalar (Laravel update :331-338)
      let assignToVal = typeof assign_to === 'object' && assign_to !== null ? assign_to?.value : assign_to;
      if (assignToVal === '' || assignToVal === undefined) assignToVal = null;

      // Laravel whitelist (:394-397): only these fields are updatable.
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (work_description !== undefined) data.work_description = work_description;
      if (notes !== undefined) data.notes = notes;
      if (status_work_order !== undefined) data.status_work_order = num(status_work_order, 0);
      if (assignToVal !== null && assignToVal !== undefined) data.assign_to = BigInt(assignToVal);

      // Images: keep existing paths, decode new base64 entries (:402-430).
      if (Array.isArray(req.body.images)) {
        const existingImages: string[] = (() => {
          try { const arr = JSON.parse(String((oldWo as any).images ?? '[]')); return Array.isArray(arr) ? arr : []; } catch { return []; }
        })();
        const merged = saveWorkOrderImages(Number(id), req.body.images);
        data.images = JSON.stringify(merged.length ? merged : existingImages);
      }

      // start/end dipaksa ke business date + waktu sekarang (Laravel :370-389)
      if (start_date !== undefined && start_date !== null) {
        data.start_date = new Date(`${bussinesDate}T00:00:00`);
        data.start_time = new Date().toTimeString().slice(0, 8);
      }
      if (end_date !== undefined && end_date !== null) {
        data.end_date = new Date(`${bussinesDate}T00:00:00`);
        data.end_time = new Date().toTimeString().slice(0, 8);
        if (!oldWo.start_date) {
          data.start_date = new Date(`${bussinesDate}T00:00:00`);
          data.start_time = new Date().toTimeString().slice(0, 8);
        }
      }

      await prisma.work_orders.update({ where: { id }, data });

      // Room status sync — Laravel HANYA menyentuh room saat end_date diset:
      // OOO -> vacant+dirty (:390-401). Room change TIDAK pernah mengubah room lama/baru.
      if (data.end_date !== undefined && data.end_date !== null && oldWo.room_id) {
        const roomRow = await prisma.rooms.findUnique({ where: { id: oldWo.room_id }, select: { room_status: true } });
        if (roomRow && roomRow.room_status === ROOM_STATUSES.out_of_order.id) {
          await prisma.rooms.update({
            where: { id: oldWo.room_id },
            data: { room_status: ROOM_STATUSES.vacant.id, maid_status: MAID_STATUSES.dirty.id, updated_at: new Date() },
          });
        }
      }

      const areaId = typeof area === 'object' && area !== null ? area?.value : area;
      const workTypeId = typeof work_type === 'object' && work_type !== null ? work_type?.value : work_type;
      if (areaId !== undefined || workTypeId !== undefined) {
        await prisma.model_has_types.deleteMany({ where: { model_id: id, model_type: { contains: 'WorkOrder' } } });
        await syncWorkOrderTypes(id, areaId, workTypeId);
      }

      // FCM saat assignment BARU (Laravel :411-415)
      if (assignToVal !== null && assignToVal !== undefined && String(assignToVal) !== String(oldWo.assign_to ?? '')) {
        try {
          const assignedUser = await prisma.users.findUnique({ where: { id: BigInt(assignToVal) }, select: { fcm_token: true } });
          if (assignedUser?.fcm_token) {
            const woRoom = await prisma.rooms.findUnique({ where: { id: BigInt(oldWo.room_id!) }, select: { name: true } }).catch(() => null);
            await firebaseService.sendToToken({
              token: assignedUser.fcm_token,
              payload: {
                title: '🛠️ New Work Order Assigned',
                body: `Anda ditugaskan untuk mengerjakan Work Order di ${woRoom?.name ?? 'Room TBD'} - Maintenance`,
                data: {
                  type: 'work_order_assignment',
                  work_order_id: String(Number(id)),
                  room_id: oldWo.room_id ? String(Number(oldWo.room_id)) : '',
                  date: '',
                },
              },
            });
          }
        } catch (fcmErr: any) {
          console.error('Notif Work Order Assignment Error:', fcmErr?.message);
        }
      }

      success(res, null, 'Work order updated');
    } catch (err: any) { console.error('Failed to update work order:', err); error(res, 'Failed to update work order', 500); }
  }

static async workOrderDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const wo = await prisma.work_orders.findUnique({ where: { id }, select: { room_id: true, deleted_at: true } });
      if (!wo || wo.deleted_at) { notFound(res, 'Work order not found'); return; }

      // Soft delete (Laravel SoftDeletes)
      await prisma.work_orders.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });

      // Restore room HANYA jika masih OOO (Laravel :486-496)
      if (wo.room_id) {
        const roomRow = await prisma.rooms.findUnique({ where: { id: wo.room_id }, select: { room_status: true } });
        if (roomRow && roomRow.room_status === ROOM_STATUSES.out_of_order.id) {
          await prisma.rooms.update({
            where: { id: wo.room_id },
            data: { room_status: ROOM_STATUSES.vacant.id, maid_status: MAID_STATUSES.dirty.id, updated_at: new Date() },
          });
        }
      }

      success(res, null, 'Work order deleted');
    } catch (err: any) { error(res, 'Failed to delete work order', 500); }
  }

  // Laravel WorkOrderController@restore (:506-512): withTrashed -> restore
  static async workOrderRestore(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const wo = await prisma.work_orders.findUnique({ where: { id }, select: { deleted_at: true } });
      if (!wo) { notFound(res, 'Work order not found'); return; }
      if (!wo.deleted_at) { badRequest(res, 'Work order is not deleted'); return; }

      await prisma.work_orders.update({ where: { id }, data: { deleted_at: null, updated_at: new Date(), updated_by: req.user?.id } });
      success(res, null, 'Work order restored successfully');
    } catch (err: any) { error(res, 'Failed to restore work order', 500); }
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
        permission: getPermissionFlags(req.user, 158),
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Stock list error:', err); error(res, 'Failed to list stocks', 500); }
  }

// ==================== SCHEDULE / ROSTER ====================
  // Replicates Laravel RostersController@index (date range, roster_list_id + AUTO-SERVICE-SCHEDULER,
  // sort() macro, formatData rows, formatTable, permission 164, search_data)
  static async rosterList(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Number(req.query.limit) || 1000);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const dateFrom = req.query.date_from as string | undefined;
      const dateTo = req.query.date_to as string | undefined;
      const rosterListId = req.query.roster_list_id as string | undefined;
      const sort = String(req.query.sort ?? '').trim();

      const where: Prisma.rostersWhereInput = { property_id: pid, deleted_at: null };
      if (dateFrom && dateTo) {
        where.date = { gte: new Date(dateFrom as string), lte: new Date(dateTo as string) };
      }
      if (rosterListId) {
        // roster_list_id filter PLUS any roster from AUTO-SERVICE-SCHEDULER-* roster lists
        const autoLists = await prisma.roster_list.findMany({
          where: { property_id: pid, name: { contains: 'AUTO-SERVICE-SCHEDULER-%' }, deleted_at: null },
          select: { id: true },
        });
        where.OR = [
          { roster_list_id: Number(rosterListId) },
          ...autoLists.map((l: { id: bigint | number }) => ({ roster_list_id: Number(l.id) })),
        ];
      }

      // sort() macro parity: '-field' desc / 'field' asc; default orderByDesc(status), orderByDesc(id)
      let orderBy: Prisma.rostersOrderByWithRelationInput | Prisma.rostersOrderByWithRelationInput[];
      const allowedSort = ['id', 'property_id', 'user_id', 'shift_id', 'roster_list_id', 'date', 'is_assigned', 'status'];
      if (sort) {
        const desc = sort.startsWith('-');
        const field = (desc ? sort.slice(1) : sort).trim();
        orderBy = allowedSort.includes(field) ? { [field]: desc ? 'desc' : 'asc' } : [{ status: 'desc' }, { id: 'desc' }];
      } else {
        orderBy = [{ status: 'desc' }, { id: 'desc' }];
      }

      const [data, total] = await Promise.all([
        prisma.rosters.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
        prisma.rosters.count({ where }),
      ]);

      const table = [
        { label: 'No', key: 'no', type: 'none', is_search: false },
        { label: 'name', key: 'name', type: 'text', is_search: true },
      ];
      const rows = data.map((r: any) => ({
        id: Number(r.id),
        property_id: r.property_id !== null ? Number(r.property_id) : null,
        user_id: Number(r.user_id),
        date: r.date ? fmtDateOnly(r.date) : null,
        shift_id: r.shift_id,
        roster_list_id: r.roster_list_id,
        is_assigned: r.is_assigned,
        created_at: r.created_at ? fmtDateTime(r.created_at) : null,
        updated_at: r.updated_at ? fmtDateTime(r.updated_at) : null,
        deleted_at: r.deleted_at ? fmtDateTime(r.deleted_at) : null,
        created_by: r.created_by !== null ? Number(r.created_by) : null,
        updated_by: r.updated_by !== null ? Number(r.updated_by) : null,
        deleted_by: r.deleted_by !== null ? Number(r.deleted_by) : null,
        status: r.status,
      }));

      success(res, rows, 'Success', 200, {
        table,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(total, page * limit) },
        permission: getPermissionFlags(req.user as any, 164),
        search_data: dataSearch(req, table) as any,
      });
    } catch (err: any) { console.error('Roster list error:', err); error(res, 'Failed to list rosters', 500); }
  }

  // Replicates Laravel RostersController@store (array payload, skip existing user+date+shift,
  // restore trashed, AUTO-SERVICE-SCHEDULER roster_list firstOrCreate)
  static async rosterStore(req: Request, res: Response): Promise<any> {
    try {
      const body = req.body;
      const items = Array.isArray(body) ? body : [body];
      const pid = req.user?.lastProperty ? BigInt(req.user.lastProperty) : null;
      if (!pid) { badRequest(res, 'Property not found'); return; }

      const skipped: string[] = [];
      const rostered: any[] = [];
      for (const raw of items) {
        const item = raw ?? {};
        if (item.date == null || item.is_assigned == null || item.shift_id == null || item.user_id == null) {
          return badRequest(res, 'date, is_assigned, shift_id and user_id are required');
        }
        const date = new Date(item.date as string);
        if (isNaN(date.getTime())) return badRequest(res, 'date must be a valid date');

        let rosterListId: number;
        if (item.roster_list_id != null && String(item.roster_list_id) !== '') {
          rosterListId = Number(item.roster_list_id);
        } else {
          const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          const name = `AUTO-SERVICE-SCHEDULER-${month}`;
          let list = await prisma.roster_list.findFirst({ where: { property_id: pid, name, deleted_at: null } });
          if (!list) {
            list = await prisma.roster_list.create({
              data: { property_id: pid, name, status: 1, created_by: req.user?.id ?? null, created_at: new Date(), updated_at: new Date() },
            });
          }
          rosterListId = Number(list.id);
        }

        const existing = await prisma.rosters.findFirst({
          where: { property_id: pid, user_id: BigInt(item.user_id), date, shift_id: Number(item.shift_id) },
        });
        if (existing) {
          if (existing.deleted_at) {
            await prisma.rosters.update({
              where: { id: existing.id },
              data: { deleted_at: null, is_assigned: item.is_assigned === true || item.is_assigned === 1 ? 1 : 0, updated_at: new Date() },
            });
            rostered.push(existing);
          } else {
            const u = await prisma.users.findUnique({ where: { id: existing.user_id }, select: { name: true } });
            skipped.push(`${u?.name ?? 'User #' + item.user_id} has been registered on ${fmtDateOnly(date)} with the same shift`);
          }
          continue;
        }

        const record = await prisma.rosters.create({
          data: {
            property_id: pid,
            roster_list_id: rosterListId,
            user_id: BigInt(item.user_id),
            shift_id: Number(item.shift_id),
            date,
            is_assigned: item.is_assigned === true || item.is_assigned === 1 ? 1 : 0,
            status: 1,
            created_by: req.user?.id ?? null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        rostered.push(record);
      }

      if (rostered.length === 0 && skipped.length > 0) {
        return res.status(409).json({ code: 409, message: 'Data is register: ' + skipped.join('; ') });
      }
      return res.status(200).json({
        code: 200,
        message: 'Data saved successfully' + (skipped.length ? '. Dilewati: ' + skipped.join('; ') : ''),
        data: bigintToNumber(rostered),
        skipped,
      });
    } catch (err: any) {
      console.error('Roster store error:', err);
      if (err?.code === 'P2002') return badRequest(res, 'Duplicate entry');
      error(res, 'Failed to save rosters', 500);
    }
  }

  // Replicates Laravel RostersController@update (shift_id required, is_assigned/roster_list_id optional)
  static async rosterUpdate(req: Request, res: Response): Promise<any> {
    try {
      const id = BigInt(String(req.params.id));
      const existing = await prisma.rosters.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Roster not found'); return; }
      if (req.body.shift_id == null) { badRequest(res, 'shift_id is required'); return; }
      await prisma.rosters.update({
        where: { id },
        data: {
          shift_id: Number(req.body.shift_id),
          is_assigned: req.body.is_assigned === undefined ? existing.is_assigned : (req.body.is_assigned === true || req.body.is_assigned === 1 ? 1 : 0),
          roster_list_id: req.body.roster_list_id === undefined ? existing.roster_list_id : Number(req.body.roster_list_id),
          updated_by: req.user?.id ?? null,
          updated_at: new Date(),
        },
      });
      const updated = await prisma.rosters.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Data updated successfully', 200);
    } catch (err: any) { console.error('Roster update error:', err); error(res, 'Failed to update roster', 500); }
  }

  // Replicates Laravel RostersController@destroy (hard-delete related housekeeper history + soft-delete roster)
  static async rosterDestroy(req: Request, res: Response): Promise<any> {
    try {
      const id = BigInt(String(req.params.id));
      const existing = await prisma.rosters.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Roster not found'); return; }

      const pid = existing.property_id ?? BigInt(0);
      const histories = await prisma.housekeeper_history.findMany({
        where: { date: existing.date, property_id: pid },
        select: { id: true },
      });
      const historyIds = histories.map((h) => h.id);
      if (historyIds.length) {
        await prisma.housekeeper_history_user.deleteMany({ where: { housekeeper_history_id: { in: historyIds } } });
        await prisma.housekeeper_history.deleteMany({ where: { id: { in: historyIds } } });
      }
      await prisma.rosters.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id ?? null } });
      success(res, [], 'Data and related entries deleted successfully.', 200);
    } catch (err: any) { console.error('Roster destroy error:', err); error(res, 'Failed to delete roster', 500); }
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

  // ==================== ROOM STATUS: UPDATE (assign housekeeper + cleaning time) ====================
  // Laravel HouseKeepingRoomStatusController@update (:316-410) — PUT housekeeping/room-status/{room}.
  static async roomStatusUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const roomId = BigInt(idParam);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const body = req.body || {};

      const normIds = (v: any): bigint[] => {
        if (v === undefined || v === null) return [];
        const arr = Array.isArray(v) ? v : [v];
        return arr
          .map((x) => (x && typeof x === 'object' ? x.value : x))
          .filter((x) => x !== null && x !== undefined && x !== '' && /^\d+$/.test(String(x)))
          .map((x) => BigInt(String(x)));
      };
      const housekeeperOri = normIds(body.housekeeper_ori);
      const housekeeperNew = normIds(body.housekeeper);

      const room = await prisma.rooms.findUnique({ where: { id: roomId } });
      if (!room || room.deleted_at) { notFound(res, 'Not Found'); return; }

      if (!body.cleaning_time) { badRequest(res, 'The cleaning time field is required.'); return; }
      await prisma.rooms.update({ where: { id: roomId }, data: { cleaning_time: new Date(body.cleaning_time), updated_at: new Date() } });

      const dateStr = String(body.date ?? (req.user as any)?.bussinesDate ?? new Date().toISOString().slice(0, 10));
      const dateObj = new Date(dateStr.length <= 10 ? dateStr + 'T00:00:00.000Z' : dateStr);

      let history = await prisma.housekeeper_history.findFirst({
        where: { room_id: roomId, date: dateObj, done_inspection: null },
        orderBy: { created_at: 'desc' },
      });
      if (!history) {
        history = await prisma.housekeeper_history.create({
          data: { room_id: roomId, date: dateObj, property_id: pid, status: 1, created_at: new Date(), created_by: req.user?.id },
        });
      }

      await prisma.housekeeper_history_user.deleteMany({ where: { housekeeper_history_id: history.id } });

      const finalIds = housekeeperNew.length > 0 ? housekeeperNew : housekeeperOri;
      if (finalIds.length > 0) {
        await prisma.housekeeper_history_user.createMany({
          data: finalIds.map((uid) => ({
            property_id: pid,
            user_id: uid,
            housekeeper_history_id: history!.id,
            status: 1,
            created_by: req.user?.id ?? null,
            created_at: new Date(),
          })),
        });
      }

      const refreshedRoom = await prisma.rooms.findUnique({ where: { id: roomId } });
      success(res, bigintToNumber(refreshedRoom), 'Success', 200);
    } catch (err: any) {
      console.error('HK room-status update error:', err);
      error(res, 'Failed to update room status', 500);
    }
  }

  // ==================== ROOM STATUS: EDIT FORM ====================
  // Laravel HouseKeepingRoomStatusController@edit (:186-258) — GET :id/update.
  // Returns the ROOM row + master incl. houseKeeperHistory (scoped to caller's
  // perform_cleaning/perform_inspection rights) so the FE can show its action buttons.
  static async roomStatusEdit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const roomId = BigInt(idParam);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const userId = req.user?.id ?? 0n;

      const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: { room_types: { select: { id: true, name: true } } },
      });
      if (!room || room.deleted_at) { notFound(res, 'Not Found'); return; }

      const businessDate = await AuthController.getBusinessDate(pid);

      // Caller rights (= hasTransactionPermission on menu 172)
      const userRoleLinks = await prisma.model_has_roles.findMany({
        where: { model_type: 'App\\Models\\User', model_id: userId },
        select: { role_id: true },
      });
      const roleIds = userRoleLinks.map((r) => r.role_id);
      let canClean = false; let canInspect = false;
      if (roleIds.length > 0) {
        const rmcs = await prisma.role_menu_crud.findMany({
          where: { role_id: { in: roleIds } },
          select: { transaction_actions: true },
        });
        for (const r of rmcs) {
          if (!r.transaction_actions) continue;
          try {
            const ta = JSON.parse(r.transaction_actions);
            if (ta.perform_cleaning === true || ta.perform_cleaning === 1 || ta.perform_cleaning === 'true') canClean = true;
            if (ta.perform_inspection === true || ta.perform_inspection === 1 || ta.perform_inspection === 'true') canInspect = true;
          } catch { /* ignore */ }
        }
      }

      const attachUsers = async (histories: any[]): Promise<any[]> => {
        const ids = histories.map((h) => h.id);
        if (!ids.length) return histories;
        const pivots = await prisma.housekeeper_history_user.findMany({
          where: { housekeeper_history_id: { in: ids }, deleted_at: null },
          select: { housekeeper_history_id: true, user_id: true },
        });
        const uIds = [...new Set(pivots.map((p) => Number(p.user_id)).filter(Boolean))];
        const users = uIds.length ? await prisma.users.findMany({ where: { id: { in: uIds.map((i) => BigInt(i)) } }, select: { id: true, name: true } }) : [];
        const nameMap = new Map(users.map((u) => [Number(u.id), u.name]));
        return histories.map((h) => ({
          ...h,
          users: pivots
            .filter((p) => Number(p.housekeeper_history_id) === Number(h.id))
            .map((p) => ({ user_id: Number(p.user_id), userData: { id: Number(p.user_id), name: nameMap.get(Number(p.user_id)) ?? '' } })),
        }));
      };

      const bdDate = new Date(String(businessDate) + 'T00:00:00.000Z');
      const baseWhere = { room_id: roomId, date: bdDate };
      let houseKeeperHistory: any = null;

      if (canClean && !canInspect) {
        const rows: any[] = await attachUsers(
          await prisma.housekeeper_history.findMany({
            where: { ...baseWhere, done_inspection: null },
            orderBy: { created_at: 'desc' },
          }),
        );
        houseKeeperHistory = rows.find((h) => (h.users || []).some((u: any) => Number(u.user_id) === Number(userId))) ?? null;
      } else if (canInspect) {
        let rows = await prisma.housekeeper_history.findMany({
          where: { ...baseWhere, NOT: { done_inspection: null as any }, start_clean_time: { not: null } },
          orderBy: { created_at: 'desc' },
        });
        rows = rows.filter((h) => h.end_clean_time != null);
        houseKeeperHistory = (await attachUsers(rows))[0] ?? null;
      }
      if (!houseKeeperHistory) {
        const rows = await attachUsers(
          await prisma.housekeeper_history.findMany({ where: baseWhere, orderBy: { created_at: 'desc' } }),
        );
        houseKeeperHistory = rows[0] ?? null;
      }

      // Master data (= Laravel edit() tail)
      const [roomTypes, roomsList] = await Promise.all([
        prisma.room_types.findMany({ where: { deleted_at: null }, select: { id: true, name: true } }),
        prisma.rooms.findMany({ where: { deleted_at: null }, select: { id: true, name: true } }),
      ]);
      const hkActions = ['perform_cleaning', 'perform_inspection', 'assign_housekeeper'];
      const rmcsAll = await prisma.role_menu_crud.findMany({ select: { role_id: true, transaction_actions: true } });
      const hkRoleIds = rmcsAll
        .filter((r) => {
          if (!r.transaction_actions) return false;
          try {
            const ta = JSON.parse(r.transaction_actions);
            return hkActions.some((a) => ta[a] === true || ta[a] === 1 || ta[a] === 'true');
          } catch { return false; }
        })
        .map((r) => r.role_id);
      let housekeepers: any[] = [];
      if (hkRoleIds.length > 0) {
        const links = await prisma.model_has_roles.findMany({
          where: { model_type: 'App\\Models\\User', role_id: { in: hkRoleIds } },
          select: { model_id: true },
          distinct: ['model_id'],
        });
        const propLinks = await prisma.model_has_properties.findMany({
          where: { property_id: pid, model_type: 'App\\Models\\User' },
          select: { model_id: true },
        });
        const propSet = new Set(propLinks.map((p: any) => Number(p.model_id)));
        const hkUserIds = [...new Set(links.map((l) => Number(l.model_id)))].filter((id) => propSet.has(id));
        if (hkUserIds.length > 0) {
          const hks = await prisma.users.findMany({
            where: { deleted_at: null, id: { in: hkUserIds.map((i) => BigInt(i)) } },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          });
          housekeepers = hks.map((u: any) => ({ value: Number(u.id), label: u.name }));
        }
      }

      const mht = await prisma.model_has_types.findMany({
        where: { model_id: roomId, model_type: 'App\\Models\\Room' },
        include: { types: { select: { id: true, name: true, group: true } } },
      });
      const floorType = mht.find((m) => m.types.group === 'floor');
      const buildingType = mht.find((m) => m.types.group === 'building');

      const statusLabel = (code: any, map: Record<string, { id: number; name: string }>) => {
        const found = Object.values(map).find((s) => s.id === Number(code));
        return { value: Number(code), label: found?.name ?? String(code ?? '') };
      };

      success(res, bigintToNumber(room), 'Success', 200, {
        master: {
          statuses: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }],
          maidStatuses: Object.values(MAID_STATUSES).map((s) => ({ value: s.id, label: s.name })),
          roomStatuses: Object.values(ROOM_STATUSES).map((s) => ({ value: s.id, label: s.name })),
          roomTypes: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
          rooms: roomsList.map((r: any) => ({ value: Number(r.id), label: r.name })),
          current_user_id: Number(userId),
          housekeepers,
          houseKeeperHistory: bigintToNumber(houseKeeperHistory),
          business_date: businessDate,
        },
        // extra field mirrors used by the FE form
        room_status: statusLabel(room.room_status, ROOM_STATUSES),
        maid_status: statusLabel(room.maid_status, MAID_STATUSES),
        room_type_id: { value: Number(room.room_type_id), label: room.room_types?.name ?? '' },
        floor: floorType ? { value: Number(floorType.types.id), label: floorType.types.name } : {},
        building: buildingType ? { value: Number(buildingType.types.id), label: buildingType.types.name } : {},
      } as any);
    } catch (err: any) {
      console.error('HK room-status edit error:', err);
      error(res, 'Failed to load room status form', 500);
    }
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

        // NOTE: Laravel does NOT touch maid_status here — removed the EXTRA dirty write.
      }

      // FCM ke setiap HK yang di-assign (Laravel :813-845)
      try {
        const assignedRoomIds = Object.entries(selectedRoomId)
          .filter(([, v]) => v === true)
          .map(([k]) => k);
        const roomNames = assignedRoomIds.length
          ? (await prisma.rooms.findMany({ where: { id: { in: assignedRoomIds.map((id) => BigInt(id)) } }, select: { name: true } }))
              .map((r: any) => r.name)
              .join(', ')
          : '';

        for (const hk of housekeeper) {
          const hkId = BigInt(hk?.value ?? hk?.id ?? hk);
          const hkUser = await prisma.users.findUnique({ where: { id: hkId }, select: { fcm_token: true } });
          if (hkUser?.fcm_token) {
            await firebaseService.sendToToken({
              token: hkUser.fcm_token,
              payload: {
                title: '🧹 Room Assignment',
                body: `Kamu telah di-assign untuk membersihkan: ${roomNames}`,
                data: {
                  type: 'hk_assignment',
                  room_ids: assignedRoomIds.join(','),
                  date: String(date),
                },
              },
            });
          }
        }
      } catch (fcmErr: any) {
        console.error('Notif assign error:', fcmErr?.message);
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

      // ── Laravel authorization parity (HouseKeepingRoomStatusController:859-890) ──
      // Auth check runs against the OPEN history (done_inspection still null).
      const openHistory = await prisma.housekeeper_history.findFirst({
        where: { room_id: roomId, date: dateObj, done_inspection: null },
        orderBy: { created_at: 'desc' },
      });
      if (!openHistory) { notFound(res, 'Housekeeper history not found'); return; }

      const currentUserId = req.user?.id;
      const isAssigned = currentUserId
        ? await prisma.housekeeper_history_user.findFirst({
            where: { housekeeper_history_id: openHistory.id, user_id: BigInt(currentUserId) },
          })
        : null;

      // Laravel: canInspect & canClean both = hasCrudPermission(172, 'edit')
      const canEdit = getPermissionFlags(req.user, 172).edit;
      if (!canEdit) {
        res.status(403).json({ code: 403, message: 'Unauthorized' });
        return;
      }
      // HK (tanpa permission edit) harus di-assign ke room tersebut.
      // Catatan: di Laravel kedua flag identik (172 edit), sehingga cek ini
      // hanya tercapai bila flag berbeda di masa depan — dipertahankan apa adanya.
      if (!canEdit && !isAssigned) {
        res.status(403).json({ code: 403, message: 'You are not assigned to this room' });
        return;
      }

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
          // Also push SSE to web users with perform_inspection permission
          if (userIds.length > 0) {
            const roomName = room.name ?? `Room #${room.id}`;
            notificationService.pushToMany(userIds.map(id => BigInt(id)), 'housekeeping-notification', {
              type: 'inspection_required',
              message: `Kamar ${roomName} sudah selesai dibersihkan, silakan lakukan inspeksi.`,
              room_id: String(Number(roomId)),
              room_number: room.name,
              date: dateObj.toISOString().slice(0, 10),
              time: new Date().toISOString(),
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

      if (!roomIdRaw || roomIdRaw === 'null' || roomIdRaw === 'undefined' || !/^\d+$/.test(roomIdRaw)) {
        success(res, [], 'No room ID provided.', 200, {
          table: housekeeperHistoryTable(),
          pagination: { current_page: page, last_page: 1, per_page: limit, total: 0, from: 0, to: 0 },
          permission: getPermissionFlags(req.user, 158),
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
        permission: getPermissionFlags(req.user, 158),
        search_data: [],
      });
    } catch (err: any) { console.error('Housekeeper history list error:', err); error(res, 'Failed to fetch housekeeper history', 500); }
  }

  // Replicates Laravel ShiftUserListController@index mode=users:
  // property-scoped users, optional type cleaning/inspection via role_menu_crud
  // JSON_EXTRACT(transaction_actions, '$.perform_cleaning'|'$.perform_inspection') = true
  static async shiftUserList(req: Request, res: Response) {
    try {
      const { mode, type } = req.query;
      if (mode !== 'users') {
        success(res, [], 'Success', 200, { pagination: { current_page: 1, last_page: 1, per_page: 15, total: 0, from: 0, to: 0 } });
        return;
      }
      const lastProperty = req.user?.lastProperty ? BigInt(req.user.lastProperty) : null;

      let userIds: bigint[] | null = null;
      if (type === 'cleaning' || type === 'inspection') {
        const flag = type === 'cleaning' ? 'perform_cleaning' : 'perform_inspection';
        const rmcs = await prisma.role_menu_crud.findMany({
          select: { role_id: true, transaction_actions: true },
        });
        const roleIds = rmcs.filter((r) => {
          if (!r.transaction_actions) return false;
          try {
            const ta = JSON.parse(r.transaction_actions);
            return ta[flag] === true || ta[flag] === 1 || ta[flag] === 'true';
          } catch { return false; }
        }).map((r) => r.role_id);
        if (roleIds.length) {
          const mhr = await prisma.model_has_roles.findMany({
            where: { role_id: { in: roleIds }, model_type: 'App\\Models\\User' },
            select: { model_id: true },
          });
          userIds = mhr.map((m) => m.model_id);
        } else {
          userIds = [];
        }
      }

      const where: Prisma.usersWhereInput = {};
      if (userIds) where.id = { in: userIds };
      if (lastProperty) {
        const userProp = await prisma.model_has_properties.findMany({
          where: { property_id: lastProperty, model_type: 'App\\Models\\User' },
          select: { model_id: true },
        });
        const userPropSet = new Set(userProp.map((p) => p.model_id));
        const users = await prisma.users.findMany({
          where,
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        });
        const result = users.filter((u) => userPropSet.has(u.id)).map((u) => ({ id: Number(u.id), name: u.name }));
        success(res, result, 'Success', 200);
        return;
      }
      const users = await prisma.users.findMany({
        where,
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      });
      success(res, users.map((u) => ({ id: Number(u.id), name: u.name })), 'Success', 200);
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

