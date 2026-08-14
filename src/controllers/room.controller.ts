import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { AuthController } from './auth.controller';
import {
  ROOM_STATUSES,
  MAID_STATUSES,
  STATUS_RESERVATION_MAP,
  getColorRoom,
  getColorCodeRoom,
  getColorMaid,
  getColorCodeMaid,
  getColorCodeReservation,
  dashLabel,
  ucfirst,
  folioUrl,
} from '../utils/cmsStatus';
import { laravelPaging, TABLES, listPermission } from '../utils/tableMeta';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATUS_ACTIVE = 1;
const MENU_ID = 1120;

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
    return out;
  }
  return val;
}

function parseBigIntArray(arr: string | string[] | undefined): bigint[] | undefined {
  if (!arr) return undefined;
  const items = Array.isArray(arr) ? arr : arr.split(',');
  return items.filter(Boolean).map((s: string) => BigInt(s.trim()));
}

// ────────────────────────────────────────────────────────────
// RoomController — room_types, rooms, images, inventories
// ────────────────────────────────────────────────────────────
export class RoomController {
  // ════════════════════════════════════════════════════════════
  // ROOM TYPES
  // ════════════════════════════════════════════════════════════

  /**
   * GET /api/room-types
   */
  static async typeList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const reservation = req.query.reservation as string;
      const propertyId = req.user?.lastProperty;

      const where: any = { deleted_at: null };
      if (propertyId) where.property_id = propertyId;
      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }

      const [roomTypes, total] = await Promise.all([
        prisma.room_types.findMany({
          where,
          orderBy: { sort: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            rooms: {
              where: { deleted_at: null },
              select: { id: true },
            },
          },
        }),
        prisma.room_types.count({ where }),
      ]);

      const formatted = roomTypes.map((rt: any) => ({
        ...bigintToNumber(rt),
        room_count: rt.rooms?.length || 0,
        rooms: undefined,
      }));

      let table: any[];
      if (reservation !== undefined) {
        table = [
          { label: 'Room Type', key: 'name', type: 'none', is_search: true },
          { label: 'Rate', key: 'rate', type: 'none', is_search: false },
          { label: 'Room Count', key: 'room_count', type: 'none', is_search: false },
          { label: 'Specification', key: 'specification', type: 'none', is_search: false },
          { label: 'Description', key: 'description', type: 'none', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ];
      } else {
        table = [
          { label: 'No', key: 'no', type: 'none', is_search: false },
          { label: 'Room Type', key: 'name', type: 'none', is_search: true },
          { label: 'Sort', key: 'sort', type: 'none', is_search: false },
          { label: 'Rate', key: 'rate', type: 'none', is_search: false },
          { label: 'Room Count', key: 'room_count', type: 'none', is_search: false },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ];
      }

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, formatted, 'Success', 200, {
        table,
        permission,
        search_data: [],
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Room type list error:', err);
      error(res, 'Failed to fetch room types', 500);
    }
  }

  /**
   * GET /api/room-types/create
   */
  static async typeCreate(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const roomTypeGroupings = await prisma.types.findMany({
        where: {
          deleted_at: null,
          status: STATUS_ACTIVE,
          group: 'room-type-grouping',
        },
        select: { id: true, name: true },
        orderBy: { sort: 'asc' },
      });

      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' },
        ],
        roomTypeGroupings: roomTypeGroupings.map((t: any) => ({ value: Number(t.id), label: t.name })),
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('Room type create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /api/room-types
   */
  static async typeStore(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const { name, description, specification, is_physical, rate, min_rate, sort, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];
      if (rate !== undefined && isNaN(Number(rate))) errors.rate = ['The rate must be numeric.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const roomType = await prisma.room_types.create({
        data: {
          property_id: propertyId!,
          name,
          description: description || null,
          specification: specification || null,
          is_physical: is_physical !== undefined ? Boolean(is_physical) : true,
          rate: rate || 0,
          min_rate: min_rate || 0,
          sort: sort || 0,
          status: status !== undefined ? Number(status) : STATUS_ACTIVE,
          created_by: userId,
        },
      });

      success(res, bigintToNumber(roomType), 'Success', 200);
    } catch (err: any) {
      console.error('Room type store error:', err);
      error(res, 'Failed to create room type', 500);
    }
  }

  /**
   * GET /api/room-types/:id
   */
  static async typeShow(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || !/^\d+$/.test(String(idParam))) { notFound(res, 'Not Found'); return; }
      const id = BigInt(idParam);

      const roomType = await prisma.room_types.findUnique({
        where: { id },
        include: {
          rooms: {
            where: { deleted_at: null },
            select: { id: true, name: true },
            orderBy: { sort: 'asc' },
          },
        },
      });

      if (!roomType || roomType.deleted_at) {
        notFound(res, 'Room type not found');
        return;
      }

      success(res, bigintToNumber(roomType), 'Success');
    } catch (err: any) {
      console.error('Room type show error:', err);
      error(res, 'Failed to fetch room type', 500);
    }
  }

  /**
   * GET /api/room-type/get-configuration/:id — Laravel RoomTypeController@getRoomConfiguration parity
   */
  static async getRoomConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || !/^\d+$/.test(String(idParam))) { notFound(res, 'Not Found'); return; }
      const id = BigInt(idParam);
      const roomType = await prisma.room_types.findUnique({ where: { id } });
      if (!roomType || roomType.deleted_at) { notFound(res, 'Not Found'); return; }
      const mht = await prisma.model_has_types.findMany({
        where: { model_type: 'App\\Models\\Room', model_id: { in: (await prisma.rooms.findMany({ where: { room_type_id: id, deleted_at: null }, select: { id: true } })).map((r: any) => r.id) } },
        select: { type_id: true },
      });
      const types = await prisma.types.findMany({
        where: { id: { in: mht.map((m: any) => m.type_id) }, group: 'room-configuration', deleted_at: null },
        select: { id: true, name: true },
      });
      const seen = new Set<string>();
      const data = types.filter((t: any) => { const k = String(t.id); if (seen.has(k)) return false; seen.add(k); return true; }).map((t: any) => ({ value: 'idx_' + t.id, label: t.name }));
      success(res, data, 'Success');
    } catch (err: any) {
      console.error('Room type get-configuration error:', err);
      error(res, 'Failed to fetch room type', 500);
    }
  }

  /**
   * GET /api/room-type/get-room/:id — Laravel RoomTypeController@getRoom parity (available rooms for room type)
   */
  static async getRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || !/^\d+$/.test(String(idParam))) {
        success(res, [], 'Success', 200, {
          table: TABLES.room,
          pagging: laravelPaging(0, 9999, 1),
          permission: listPermission(req, { add: true }),
          search_data: [],
        });
        return;
      }
      const id = BigInt(idParam);
      const roomType = await prisma.room_types.findUnique({ where: { id } });
      if (!roomType || roomType.deleted_at) {
        success(res, [], 'Success', 200, {
          table: TABLES.room,
          pagging: laravelPaging(0, 9999, 1),
          permission: listPermission(req, { add: true }),
          search_data: [],
        });
        return;
      }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 9999;
      const startDate = req.query.check_in_date as string;
      const endDate = req.query.check_out_date as string;
      if (!startDate || !endDate) { badRequest(res, 'Check In Date and Check Out Date is required'); return; }
      let folioId: bigint | null = null;
      const rawFolio = req.query.folio_id as string;
      if (rawFolio && rawFolio !== '0' && /^\d+$/.test(rawFolio)) {
        const f = await prisma.folios.findUnique({ where: { id: BigInt(rawFolio) } });
        if (f) folioId = f.id;
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      const [blockedByAvailability, blockedByWorkOrder, busyReservations, rooms] = await Promise.all([
        prisma.room_availabilities.findMany({ where: { date: { gte: start, lt: end } }, select: { room_id: true } }),
        prisma.work_orders.findMany({ where: { date: { lte: start }, deleted_at: null, OR: [{ end_date: { gt: end } }, { end_date: null }] }, select: { room_id: true } }),
        prisma.reservations.findMany({
          where: {
            date: { gte: start, lt: end },
            OR: [{ room_type_id: id }, { room_type_id_next: id }],
            folios: { status_reservation: { in: [0, 3] }, deleted_at: null, ...(folioId ? { id: { not: folioId } } : {}) },
            room_id: { gt: 0 },
          },
          select: { room_id: true },
        }),
        prisma.rooms.findMany({
          where: { room_type_id: id, status: 1, deleted_at: null, room_status: { not: 4 } },
          orderBy: [{ room_status: 'asc' }, { sort: 'asc' }],
        }),
      ]);

      const blocked = new Set<string>();
      for (const b of blockedByAvailability) blocked.add(String(b.room_id));
      for (const w of blockedByWorkOrder) blocked.add(String(w.room_id));
      for (const r of busyReservations) blocked.add(String(r.room_id));
      const available = rooms.filter((r) => !blocked.has(String(r.id)));

      const mht = await prisma.model_has_types.findMany({
        where: { model_type: 'App\\Models\\Room', model_id: { in: available.map((r) => r.id) } },
        include: { types: { select: { id: true, name: true, group: true } } },
      });
      const mhtByRoom = new Map<bigint, any[]>();
      for (const m of mht) { const arr = mhtByRoom.get(m.model_id) || []; arr.push(m.types); mhtByRoom.set(m.model_id, arr); }

      const table = [
        { label: 'No', key: 'no', type: 'none', is_search: false },
        { label: 'Room', key: 'name', type: 'link', is_search: true },
        { label: 'Floor', key: 'floor', type: 'none', is_search: false },
        { label: 'Building', key: 'building', type: 'none', is_search: false },
        { label: 'Room Status', key: 'room_status', type: 'badge', is_search: false },
        { label: 'Maid Status', key: 'maid_status', type: 'badge', is_search: false },
        { label: 'Room Type', key: 'room_type_id', type: 'select', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
      ];

      const data = available.map((room: any, i: number) => {
        const types = mhtByRoom.get(room.id) || [];
        const floor = types.find((t: any) => t.group === 'floor');
        const buildingT = types.find((t: any) => t.group === 'building');
        const roomStatus = room.room_status ?? 0;
        const maidStatus = room.maid_status ?? 0;
        return {
          no: i + 1,
          id: Number(room.id),
          name: room.name,
          floor: floor ? { value: Number(floor.id), label: floor.name } : [],
          building: buildingT ? { value: Number(buildingT.id), label: buildingT.name } : [],
          room_status: {
            value: roomStatus,
            label: ROOM_STATUSES[Object.keys(ROOM_STATUSES).find((k) => ROOM_STATUSES[k].id === roomStatus) ?? 'vacant']?.name ?? 'Vacant',
            color: getColorRoom(roomStatus),
            colorCode: getColorCodeRoom(roomStatus),
          },
          maid_status: {
            value: maidStatus,
            label: MAID_STATUSES[Object.keys(MAID_STATUSES).find((k) => MAID_STATUSES[k].id === maidStatus) ?? 'clean']?.name ?? 'Clean',
            color: getColorMaid(maidStatus),
            colorCode: getColorCodeMaid(maidStatus),
          },
          room_type_id: { value: Number(id), label: roomType.name },
          status: { value: room.status ?? 0, label: room.status === STATUS_ACTIVE ? 'Active' : 'Inactive' },
        };
      });

      success(res, data, 'Success', 200, {
        table,
        pagging: laravelPaging(data.length, limit, page),
        permission: listPermission(req, { add: true }),
        search_data: [],
        folio_id: folioId ? Number(folioId) : 0,
        getAvailableRoom: data.map((d: any) => d.id),
      } as any);
    } catch (err: any) {
      console.error('Room type get-room error:', err);
      error(res, 'Failed to fetch room type', 500);
    }
  }

  /**
   * GET /api/room-type/get-room-v2/:id — Laravel RoomTypeController@getRoomFormatSelect parity
   */
  static async getRoomFormatSelect(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || !/^\d+$/.test(String(idParam))) { success(res, [], 'Success'); return; }
      const id = BigInt(idParam);
      const roomType = await prisma.room_types.findUnique({ where: { id } });
      if (!roomType || roomType.deleted_at) { success(res, [], 'Success'); return; }
      const startDate = req.query.check_in_date as string;
      const endDate = req.query.check_out_date as string;
      if (!startDate || !endDate) { badRequest(res, 'The check in date field is required.'); return; }
      const start = new Date(startDate);
      const end = new Date(endDate);
      const [blockedByAvailability, blockedByWorkOrder, busyReservations, rooms] = await Promise.all([
        prisma.room_availabilities.findMany({ where: { date: { gte: start, lt: end } }, select: { room_id: true } }),
        prisma.work_orders.findMany({ where: { date: { lte: start }, deleted_at: null, OR: [{ end_date: { gt: end } }, { end_date: null }] }, select: { room_id: true } }),
        prisma.reservations.findMany({
          where: {
            date: { gte: start, lt: end },
            OR: [{ room_type_id: id }, { room_type_id_next: id }],
            folios: { status_reservation: { in: [0, 3] }, deleted_at: null },
            room_id: { gt: 0n },
          },
          select: { room_id: true },
        }),
        prisma.rooms.findMany({
          where: { room_type_id: id, status: 1, deleted_at: null, room_status: { not: 4 } },
          orderBy: [{ room_status: 'asc' }, { sort: 'asc' }],
        }),
      ]);
      const blocked = new Set<string>();
      for (const b of blockedByAvailability) blocked.add(String(b.room_id));
      for (const w of blockedByWorkOrder) blocked.add(String(w.room_id));
      for (const r of busyReservations) blocked.add(String(r.room_id));
      const data = rooms.filter((r) => !blocked.has(String(r.id))).map((r: any) => ({ value: Number(r.id), label: r.name }));
      success(res, data, 'Success');
    } catch (err: any) {
      console.error('Room type get-room-v2 error:', err);
      error(res, 'Failed to fetch room type', 500);
    }
  }

  /**
   * GET /api/room-types/:id/edit
   */
  static async typeEdit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const roomType = await prisma.room_types.findUnique({ where: { id } });
      if (!roomType || roomType.deleted_at) {
        notFound(res, 'Room type not found');
        return;
      }

      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' },
        ],
      };

      success(res, { ...bigintToNumber(roomType), master }, 'Success');
    } catch (err: any) {
      console.error('Room type edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /api/room-types/:id
   */
  static async typeUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.room_types.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Room type not found');
        return;
      }

      const { name, description, specification, is_physical, rate, min_rate, sort, status } = req.body;

      const updateData: any = { updated_at: new Date(), updated_by: userId };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (specification !== undefined) updateData.specification = specification;
      if (is_physical !== undefined) updateData.is_physical = Boolean(is_physical);
      if (rate !== undefined) updateData.rate = rate;
      if (min_rate !== undefined) updateData.min_rate = min_rate;
      if (sort !== undefined) updateData.sort = sort;
      if (status !== undefined) updateData.status = Number(status);

      await prisma.room_types.update({ where: { id }, data: updateData });

      const updated = await prisma.room_types.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Room type update error:', err);
      error(res, 'Failed to update room type', 500);
    }
  }

  /**
   * DELETE /api/room-types/:id
   */
  static async typeDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.room_types.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Room type not found');
        return;
      }

      await prisma.room_types.update({
        where: { id },
        data: { deleted_at: new Date(), status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Room type destroy error:', err);
      error(res, 'Failed to delete room type', 500);
    }
  }

  /**
   * POST /api/room-types/:id/restore
   */
  static async typeRestore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.room_types.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Room type not found');
        return;
      }

      await prisma.room_types.update({
        where: { id },
        data: { deleted_at: null, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Room type restore error:', err);
      error(res, 'Failed to restore room type', 500);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ROOMS
  // ════════════════════════════════════════════════════════════

  /**
   * GET /api/rooms
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string;
      const group = req.query.group as string;
      const propertyId = req.user?.lastProperty;

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null };
      if (propertyId) where.property_id = propertyId;
      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }

      if (sort) {
        const order = req.query.order === 'desc' ? 'desc' : 'asc';
        where.sort = order;
      }

      const [rooms, total] = await Promise.all([
        prisma.rooms.findMany({
          where,
          orderBy: { sort: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            room_types: { select: { name: true } },
            rooms: { select: { name: true } },
          },
        }),
        prisma.rooms.count({ where }),
      ]);

      // Get configurations (types linked via model_has_types) for each room
      const roomIds = rooms.map((r) => r.id);
      const modelTypes = await prisma.model_has_types.findMany({
        where: {
          model_id: { in: roomIds },
          model_type: 'App\\Models\\Room',
        },
        include: {
          types: { select: { id: true, name: true, group: true } },
        },
      });

      const configMap = new Map<bigint, any[]>();
      for (const mt of modelTypes) {
        if (!configMap.has(mt.model_id)) configMap.set(mt.model_id, []);
        configMap.get(mt.model_id)!.push(bigintToNumber(mt.types));
      }

      const formatted = rooms.map((r: any) => ({
        ...bigintToNumber(r),
        room_type_name: r.room_types?.name || null,
        parent_room_name: r.rooms?.name || null,
        room_types: undefined,
        rooms: undefined,
        room_configurations: configMap.get(r.id) || [],
      }));

      const table = group === 'room'
        ? [
            { label: 'Room Name', key: 'name', type: 'none', is_search: true },
            { label: 'Room Type', key: 'room_type_name', type: 'none', is_search: false },
            { label: 'Max Pax', key: 'max_pax', type: 'none', is_search: false },
            { label: 'Total Bed', key: 'total_bed', type: 'none', is_search: false },
            { label: 'Action', key: 'action', type: 'action', is_search: false },
          ]
        : [
            { label: 'No', key: 'no', type: 'none', is_search: false },
            { label: 'Room Name', key: 'name', type: 'none', is_search: true },
            { label: 'Room Type', key: 'room_type_name', type: 'none', is_search: false },
            { label: 'Parent Room', key: 'parent_room_name', type: 'none', is_search: false },
            { label: 'Sort', key: 'sort', type: 'none', is_search: false },
            { label: 'Status', key: 'status', type: 'badge', is_search: false },
            { label: 'Action', key: 'action', type: 'action', is_search: false },
          ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, formatted, 'Success', 200, {
        table,
        permission,
        search_data: [],
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Room list error:', err);
      error(res, 'Failed to fetch rooms', 500);
    }
  }

  /**
   * GET /api/rooms/statistics
   */
  static async statistics(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const dateParam = (req.query.date as string) || (req.body?.date as string) || '';
      const businessDate = dateParam || (await AuthController.getBusinessDate(propertyId ?? null));

      // Filters: GET ?room_types_X=1,2 OR POST body keys room_types_1: true (Laravel srcstr parity)
      const prefixIds = (prefix: string): bigint[] | undefined => {
        const q = parseBigIntArray(req.query[prefix + 'X'] as string);
        if (q && q.length > 0) return q;
        const src = req.body && typeof req.body === 'object' ? req.body : {};
        const ids: bigint[] = [];
        for (const k of Object.keys(src)) {
          if (k.startsWith(prefix) && src[k]) {
            const id = k.slice(prefix.length);
            if (/^\d+$/.test(id)) ids.push(BigInt(id));
          }
        }
        return ids.length > 0 ? ids : undefined;
      };

      const roomTypeIds = prefixIds('room_types_');
      const roomStatuses = prefixIds('room_statuses_');
      const maidStatuses = prefixIds('maid_statuses_');
      const roomConfigIds = prefixIds('room_configurations_');
      const buildingIds = prefixIds('buildings_');
      const floorIds = prefixIds('floors_');

      // Build room filter
      const roomWhere: any = { deleted_at: null, status: STATUS_ACTIVE };
      if (propertyId) roomWhere.property_id = propertyId;
      if (roomTypeIds && roomTypeIds.length > 0) {
        roomWhere.room_type_id = { in: roomTypeIds };
      }
      if (roomStatuses && roomStatuses.length > 0) {
        roomWhere.room_status = { in: roomStatuses.map(Number) };
      }
      if (maidStatuses && maidStatuses.length > 0) {
        roomWhere.maid_status = { in: maidStatuses.map(Number) };
      }

      // Get rooms
      const rooms = await prisma.rooms.findMany({
        where: roomWhere,
        orderBy: { sort: 'asc' },
        include: {
          room_types: { select: { id: true, name: true } },
          properties: { select: { id: true, name: true } },
          other_rooms: {
            where: { deleted_at: null },
            select: { id: true, name: true, is_physical: true, sort: true },
          },
        },
      });

      let roomIds = rooms.map((r) => r.id);
      const parentRoomName = new Map<bigint, string>();
      for (const r of rooms) {
        if (r.room_id) parentRoomName.set(r.room_id, r.name);
      }

      // Filter by room configurations / buildings / floors via model_has_types
      if (
        (roomConfigIds && roomConfigIds.length > 0) ||
        (buildingIds && buildingIds.length > 0) ||
        (floorIds && floorIds.length > 0)
      ) {
        const mht = await prisma.model_has_types.findMany({
          where: { model_id: { in: roomIds }, model_type: 'App\\Models\\Room' },
          select: { model_id: true, type_id: true },
        });
        const pass = (ids: bigint[]) => new Set(mht.filter((m) => ids.includes(m.type_id)).map((m) => m.model_id));
        const confSet = roomConfigIds?.length ? pass(roomConfigIds) : null;
        const buildSet = buildingIds?.length ? pass(buildingIds) : null;
        const floorSet = floorIds?.length ? pass(floorIds) : null;
        roomIds = roomIds.filter(
          (id) =>
            (!confSet || confSet.has(id)) &&
            (!buildSet || buildSet.has(id)) &&
            (!floorSet || floorSet.has(id))
        );
      }

      // Reservations for the business date (folio not cancelled(2) / checked out(1))
      const dayStart = new Date(businessDate + 'T00:00:00Z');
      const nextDate = new Date(dayStart);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);

      const reservations = await prisma.reservations.findMany({
        where: {
          room_id: { in: roomIds, not: null },
          date: { gte: dayStart, lt: nextDate },
          deleted_at: null,
          folios: {
            deleted_at: null,
            status_reservation: { notIn: [1, 2] },
          },
        },
        select: {
          room_id: true,
          folios: {
            select: {
              id: true,
              folio_number: true,
              status_reservation: true,
              type_reservation: true,
              first_name: true,
              last_name: true,
              company_name: true,
              check_in_date: true,
              check_out_date: true,
            },
          },
        },
      });

      const folioByRoom = new Map<bigint, any>();
      for (const r of reservations) {
        if (!r.room_id || !r.folios) continue;
        if (!folioByRoom.has(r.room_id)) folioByRoom.set(r.room_id, bigintToNumber(r.folios));
      }

      // Room <-> floor/building/configuration via model_has_types
      const allMht = await prisma.model_has_types.findMany({
        where: { model_id: { in: roomIds }, model_type: 'App\\Models\\Room' },
        include: { types: { select: { id: true, name: true, group: true } } },
      });
      const mhtByRoom = new Map<bigint, any[]>();
      for (const m of allMht) {
        if (!mhtByRoom.has(m.model_id)) mhtByRoom.set(m.model_id, []);
        mhtByRoom.get(m.model_id)!.push(m.types);
      }

      // Room type groupings (group 'room-type-grouping')
      const rtIds = rooms.map((r) => r.room_type_id).filter((id): id is bigint => id !== null);
      let rtGroupMht: { model_id: bigint; types: any }[] = [];
      if (rtIds.length > 0) {
        rtGroupMht = await prisma.model_has_types.findMany({
          where: { model_id: { in: rtIds }, model_type: 'App\\Models\\RoomType' },
          include: { types: { select: { id: true, name: true, group: true } } },
        });
        rtGroupMht = rtGroupMht.filter((m) => m.types?.group === 'room-type-grouping');
      }
      const rtGroupByName = new Map<bigint, any>();
      for (const m of rtGroupMht) {
        if (!rtGroupByName.has(m.model_id)) rtGroupByName.set(m.model_id, m.types);
      }

      // Floor plan templates (group 'template-floor-plan')
      const templates = await prisma.types.findMany({
        where: { deleted_at: null, status: STATUS_ACTIVE, group: 'template-floor-plan' },
        select: { id: true, description: true, text: true },
        orderBy: { sort: 'asc' },
      });
      const templateMeta: any[] = [];
      if (templates.length > 0) {
        const tmplMht = await prisma.model_has_types.findMany({
          where: { model_id: { in: templates.map((t) => t.id) }, model_type: 'App\\Models\\Type' },
          include: { types: { select: { id: true, name: true, group: true } } },
        });
        const tmplBuilding = new Map<bigint, string>();
        const tmplFloor = new Map<bigint, string>();
        for (const m of tmplMht) {
          if (m.types?.group === 'building') tmplBuilding.set(m.model_id, m.types.name);
          if (m.types?.group === 'floor') tmplFloor.set(m.model_id, m.types.name);
        }
        for (const t of templates) {
          templateMeta.push({
            value: Number(t.id),
            label: (t.description || '').toLowerCase().replace(/\s+/g, '-'),
            code_image: t.text ?? '',
            building: tmplBuilding.get(t.id) ?? '',
            floor: tmplFloor.get(t.id) ?? '',
          });
        }
      }
      const buildingGroup: Record<string, any> = {};
      for (const tmpl of templateMeta) {
        const bKey = tmpl.building || 'No Building';
        const fKey = tmpl.floor || 'No Floor';
        if (!buildingGroup[bKey]) buildingGroup[bKey] = { value: bKey, label: bKey, floors: {} };
        if (!buildingGroup[bKey].floors[fKey]) {
          buildingGroup[bKey].floors[fKey] = { ...tmpl, layout: tmpl.label };
        }
      }
      const building = Object.values(buildingGroup).map((b: any) => ({
        ...b,
        floors: Object.values(b.floors),
      }));

      // Rows: Laravel Room::formatData() parity
      const data = rooms
        .filter((r) => roomIds.includes(r.id))
        .map((room: any) => {
          const types = mhtByRoom.get(room.id) || [];
          const floor = types.find((t: any) => t.group === 'floor');
          const buildingT = types.find((t: any) => t.group === 'building');
          const roomConfig = types
            .filter((t: any) => t.group === 'room-configuration')
            .map((t: any) => ({ value: Number(t.id), label: t.name }));
          const folio = folioByRoom.get(room.id);
          const roomStatus = room.room_status ?? 0;
          const maidStatus = room.maid_status ?? 0;
          return {
            id: Number(room.id),
            name: room.name,
            map_id: ucfirst(room.map_id),
            floor: floor ? { value: Number(floor.id), label: floor.name } : [],
            building: buildingT ? { value: Number(buildingT.id), label: buildingT.name } : [],
            building_name: buildingT?.name || '',
            floor_name: floor?.name || '',
            room_status: {
              value: roomStatus,
              label: ROOM_STATUSES[Object.keys(ROOM_STATUSES).find((k) => ROOM_STATUSES[k].id === roomStatus) ?? 'vacant']?.name ?? 'Vacant',
              color: getColorRoom(roomStatus),
              colorCode: getColorCodeRoom(roomStatus),
            },
            room_status_color: {
              label: dashLabel(roomStatus, Object.fromEntries(Object.values(ROOM_STATUSES).map((s) => [s.id, s.name]))),
              color: getColorRoom(roomStatus),
              colorCode: getColorCodeRoom(roomStatus),
              is_color: true,
            },
            maid_status: {
              value: maidStatus,
              label: MAID_STATUSES[Object.keys(MAID_STATUSES).find((k) => MAID_STATUSES[k].id === maidStatus) ?? 'clean']?.name ?? 'Clean',
              color: getColorMaid(maidStatus),
              colorCode: getColorCodeMaid(maidStatus),
            },
            room_clean_status_color: {
              label: dashLabel(maidStatus, Object.fromEntries(Object.values(MAID_STATUSES).map((s) => [s.id, s.name]))),
              color: getColorMaid(maidStatus),
              is_color: true,
            },
            room_type_id: {
              value: room.room_types?.id ? Number(room.room_types.id) : null,
              label: room.room_types?.name || null,
            },
            room_type_grouping: rtGroupByName.get(room.room_type_id)
              ? {
                  value: Number(rtGroupByName.get(room.room_type_id).id),
                  label: rtGroupByName.get(room.room_type_id).name,
                }
              : [],
            status: { value: room.status ?? 0, label: room.status === STATUS_ACTIVE ? 'Active' : 'Inactive' },
            property: room.properties
              ? { value: Number(room.properties.id), label: room.properties.name }
              : [],
            room_id: room.room_id
              ? { value: Number(room.room_id), label: parentRoomName.get(room.room_id) || '' }
              : [],
            room_configuration: roomConfig,
            description: room.description,
            remark: room.remark,
            phone_ext: room.phone_ext,
            max_pax: room.max_pax,
            total_bed: room.total_bed,
            with_tv: !!room.with_tv,
            with_shower: !!room.with_shower,
            address_code: room.address_code,
            sort: room.sort,
            is_physical: room.is_physical,
            housekeeper: '',
            guest: '',
            is_do_not_disturb: false,
            sub_rooms:
              room.other_rooms?.map((sr: any) => ({
                id: Number(sr.id),
                name: sr.name,
                is_physical: sr.is_physical,
              })) || [],
            folio: folio
              ? {
                  folio_id: folio.id,
                  url: folioUrl(folio) || '/reservation/fit?parent=62&add=1&room_id=' + Number(room.id),
                  folio_status_color_code: getColorCodeReservation(folio.status_reservation ?? 0),
                  folio_number: folio.folio_number,
                  folio_status: STATUS_RESERVATION_MAP[folio.status_reservation ?? 0] || 'Pending',
                }
              : null,
          };
        });

      // Master data for filter dropdowns
      const [roomTypes, roomConfigs, buildingTypes, floorTypes, roomTypeGroups] = await Promise.all([
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, property_id: propertyId! },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'room-configuration' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'building' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'floor' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'room-type-grouping' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
      ]);

      const master = {
        room_statuses: Object.values(ROOM_STATUSES).map((s) => ({ value: s.id, label: s.name })),
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        maid_statuses: Object.values(MAID_STATUSES).map((s) => ({ value: s.id, label: s.name })),
        room_configurations: roomConfigs.map((rc: any) => ({ value: Number(rc.id), label: rc.name })),
        buildings: buildingTypes.map((b: any) => ({ value: Number(b.id), label: b.name })),
        floors: floorTypes.map((f: any) => ({ value: Number(f.id), label: f.name })),
        room_type_groups: roomTypeGroups.map((g: any) => ({ value: Number(g.id), label: g.name })),
        templates: templateMeta,
      };

      const meta = {
        room_types_X: roomTypeIds?.map((id) => Number(id)) || [],
        room_statuses_X: roomStatuses?.map((id) => Number(id)) || [],
        maid_statuses_X: maidStatuses?.map((id) => Number(id)) || [],
        room_configurations_X: roomConfigIds?.map((id) => Number(id)) || [],
        buildings_X: buildingIds?.map((id) => Number(id)) || [],
        floors_X: floorIds?.map((id) => Number(id)) || [],
        date: businessDate,
      };

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      success(res, data, 'Success', 200, {
        master,
        building,
        pagging: laravelPaging(data.length, limit, page),
        permission: getPermissionFlags(req.user, MENU_ID),
        meta,
      } as any);
    } catch (err: any) {
      console.error('Room statistics error:', err);
      error(res, 'Failed to fetch statistics', 500);
    }
  }

  /**
   * GET /api/rooms/create
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const [statuses, activeRooms, roomTypes, roomConfigs, inRoomEquipments, floors, buildings] = await Promise.all([
        Promise.resolve([
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' },
        ]),
        prisma.rooms.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'room-configuration' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'in-room-equipment' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'floor' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'building' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
      ]);

      const master = {
        statuses,
        rooms: activeRooms.map((r: any) => ({ value: Number(r.id), label: r.name })),
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        room_configurations: roomConfigs.map((rc: any) => ({ value: Number(rc.id), label: rc.name })),
        in_room_equipments: inRoomEquipments.map((e: any) => ({ value: Number(e.id), label: e.name })),
        in_room_equiptments: inRoomEquipments.map((e: any) => ({ value: Number(e.id), label: e.name })),
        floors: floors.map((f: any) => ({ value: Number(f.id), label: f.name })),
        buildings: buildings.map((b: any) => ({ value: Number(b.id), label: b.name })),
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('Room create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /api/rooms
   */
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const {
        room_type_id,
        room_id,
        name,
        description,
        is_physical,
        phone_ext,
        map_id,
        max_pax,
        total_bed,
        with_tv,
        with_shower,
        cleaning_time,
        linen_days,
        remark,
        room_status,
        maid_status,
        address_code,
        sort,
        status,
        room_configuration_ids,
      } = req.body;

      const errors: Record<string, string[]> = {};
      if (!room_type_id) errors.room_type_id = ['The room type id field is required.'];
      if (!name) errors.name = ['The name field is required.'];
      if (!max_pax && max_pax !== 0) errors.max_pax = ['The max pax field is required.'];
      if (!total_bed && total_bed !== 0) errors.total_bed = ['The total bed field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const room = await prisma.rooms.create({
        data: {
          property_id: propertyId!,
          room_type_id: BigInt(room_type_id),
          room_id: room_id ? BigInt(room_id) : null,
          name,
          description: description || null,
          is_physical: is_physical !== undefined ? Boolean(is_physical) : true,
          phone_ext: phone_ext || null,
          map_id: map_id || null,
          max_pax: Number(max_pax) || 0,
          total_bed: Number(total_bed) || 0,
          with_tv: with_tv !== undefined ? Number(with_tv) : 0,
          with_shower: with_shower !== undefined ? Number(with_shower) : 0,
          cleaning_time: cleaning_time ? new Date(cleaning_time) : new Date('1970-01-01T00:00:00'),
          linen_days: linen_days !== undefined ? Number(linen_days) : 0,
          remark: remark || null,
          room_status: room_status !== undefined ? Number(room_status) : 0,
          maid_status: maid_status !== undefined ? Number(maid_status) : 0,
          address_code: address_code || null,
          sort: sort !== undefined ? Number(sort) : 0,
          status: status !== undefined ? Number(status) : STATUS_ACTIVE,
          created_by: userId,
        },
      });

      // Sync room configurations via model_has_types
      if (room_configuration_ids && Array.isArray(room_configuration_ids) && room_configuration_ids.length > 0) {
        await prisma.model_has_types.createMany({
          data: room_configuration_ids.map((typeId: any) => ({
            type_id: BigInt(typeId),
            model_id: room.id,
            model_type: 'App\\Models\\Room',
          })),
        });
      }

      success(res, bigintToNumber(room), 'Success', 200);
    } catch (err: any) {
      console.error('Room store error:', err);
      error(res, 'Failed to create room', 500);
    }
  }

  /**
   * GET /api/rooms/:id
   */
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const room = await prisma.rooms.findUnique({
        where: { id },
        include: {
          room_types: { select: { id: true, name: true } },
          rooms: { select: { id: true, name: true } },
          other_rooms: { where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { sort: 'asc' } },
        },
      });

      if (!room || room.deleted_at) {
        notFound(res, 'Room not found');
        return;
      }

      // Get configurations
      const mht = await prisma.model_has_types.findMany({
        where: { model_id: id, model_type: 'App\\Models\\Room' },
        include: { types: { select: { id: true, name: true, group: true } } },
      });

      const result = {
        ...bigintToNumber(room),
        room_configurations: bigintToNumber(mht.filter((m) => m.types.group === 'room-configuration').map((m) => m.types)),
        in_room_equipments: bigintToNumber(mht.filter((m) => m.types.group === 'in-room-equipment').map((m) => m.types)),
      };

      success(res, result, 'Success');
    } catch (err: any) {
      console.error('Room show error:', err);
      error(res, 'Failed to fetch room', 500);
    }
  }

  /**
   * GET /api/rooms/:id/edit
   */
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const [room, activeRooms, roomTypes, roomConfigs, inRoomEquipments, floors, buildings] = await Promise.all([
        prisma.rooms.findUnique({
          where: { id },
          include: {
            room_types: { select: { id: true, name: true } },
            rooms: { select: { id: true, name: true } },
          },
        }),
        prisma.rooms.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'room-configuration' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'in-room-equipment' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'floor' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'building' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
      ]);

      if (!room || room.deleted_at) {
        notFound(res, 'Room not found');
        return;
      }

      // Get selected configurations
      const mht = await prisma.model_has_types.findMany({
        where: { model_id: id, model_type: 'App\\Models\\Room' },
        select: { type_id: true },
      });
      const selectedConfigIds = mht.map((m) => Number(m.type_id));

      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' },
        ],
        rooms: activeRooms.map((r: any) => ({ value: Number(r.id), label: r.name })),
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        room_configurations: roomConfigs.map((rc: any) => ({ value: Number(rc.id), label: rc.name })),
        in_room_equipments: inRoomEquipments.map((e: any) => ({ value: Number(e.id), label: e.name })),
        in_room_equiptments: inRoomEquipments.map((e: any) => ({ value: Number(e.id), label: e.name })),
        floors: floors.map((f: any) => ({ value: Number(f.id), label: f.name })),
        buildings: buildings.map((b: any) => ({ value: Number(b.id), label: b.name })),
        selected_room_configurations: selectedConfigIds,
      };

      success(res, { ...bigintToNumber(room), master }, 'Success');
    } catch (err: any) {
      console.error('Room edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /api/rooms/:id
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rooms.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Room not found');
        return;
      }

      const {
        room_type_id,
        room_id,
        name,
        description,
        is_physical,
        phone_ext,
        map_id,
        max_pax,
        total_bed,
        with_tv,
        with_shower,
        cleaning_time,
        linen_days,
        remark,
        room_status,
        maid_status,
        address_code,
        sort,
        status,
        room_configuration_ids,
      } = req.body;

      const updateData: any = { updated_at: new Date(), updated_by: userId };
      if (room_type_id !== undefined) updateData.room_type_id = BigInt(room_type_id);
      if (room_id !== undefined) updateData.room_id = room_id ? BigInt(room_id) : null;
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (is_physical !== undefined) updateData.is_physical = Boolean(is_physical);
      if (phone_ext !== undefined) updateData.phone_ext = phone_ext;
      if (map_id !== undefined) updateData.map_id = map_id;
      if (max_pax !== undefined) updateData.max_pax = Number(max_pax);
      if (total_bed !== undefined) updateData.total_bed = Number(total_bed);
      if (with_tv !== undefined) updateData.with_tv = Number(with_tv);
      if (with_shower !== undefined) updateData.with_shower = Number(with_shower);
      if (cleaning_time !== undefined) updateData.cleaning_time = new Date(cleaning_time);
      if (linen_days !== undefined) updateData.linen_days = Number(linen_days);
      if (remark !== undefined) updateData.remark = remark;
      if (room_status !== undefined) updateData.room_status = Number(room_status);
      if (maid_status !== undefined) updateData.maid_status = Number(maid_status);
      if (address_code !== undefined) updateData.address_code = address_code;
      if (sort !== undefined) updateData.sort = Number(sort);
      if (status !== undefined) updateData.status = Number(status);

      await prisma.rooms.update({ where: { id }, data: updateData });

      // Sync room configurations via model_has_types
      if (room_configuration_ids !== undefined && Array.isArray(room_configuration_ids)) {
        await prisma.model_has_types.deleteMany({
          where: { model_id: id, model_type: 'App\\Models\\Room' },
        });
        if (room_configuration_ids.length > 0) {
          await prisma.model_has_types.createMany({
            data: room_configuration_ids.map((typeId: any) => ({
              type_id: BigInt(typeId),
              model_id: id,
              model_type: 'App\\Models\\Room',
            })),
          });
        }
      }

      const updated = await prisma.rooms.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Room update error:', err);
      error(res, 'Failed to update room', 500);
    }
  }

  /**
   * DELETE /api/rooms/:id
   */
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rooms.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Room not found');
        return;
      }

      await prisma.rooms.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Room destroy error:', err);
      error(res, 'Failed to delete room', 500);
    }
  }

  /**
   * DELETE /api/rooms/:id/force
   */
  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.rooms.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Room not found');
        return;
      }

      await prisma.rooms.delete({ where: { id } });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Room force delete error:', err);
      error(res, 'Failed to force delete room', 500);
    }
  }

  /**
   * POST /api/rooms/:id/restore
   */
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.rooms.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Room not found');
        return;
      }

      await prisma.rooms.update({
        where: { id },
        data: { deleted_at: null, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Room restore error:', err);
      error(res, 'Failed to restore room', 500);
    }
  }

  /**
   * GET /api/rooms/:id/configuration
   */
  static async getConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const room = await prisma.rooms.findUnique({ where: { id } });
      if (!room || room.deleted_at) {
        notFound(res, 'Room not found');
        return;
      }

      const mht = await prisma.model_has_types.findMany({
        where: {
          model_id: id,
          model_type: 'App\\Models\\Room',
          types: { group: 'room-configuration' },
        },
        include: {
          types: { select: { id: true, name: true, group: true } },
        },
      });

      const configurations = mht.map((m) => bigintToNumber(m.types));
      success(res, configurations, 'Success');
    } catch (err: any) {
      console.error('Room configuration error:', err);
      error(res, 'Failed to fetch room configuration', 500);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ROOM TYPE IMAGES
  // ════════════════════════════════════════════════════════════

  /**
   * GET /api/room-types/:roomTypeId/images
   */
  static async imageList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const roomTypeIdParam = Array.isArray(req.params.roomTypeId) ? req.params.roomTypeId[0] : req.params.roomTypeId;
      const roomTypeId = roomTypeIdParam ? BigInt(roomTypeIdParam) : undefined;
      const propertyId = req.user?.lastProperty;

      const where: any = { deleted_at: null };
      if (propertyId) where.property_id = propertyId;
      if (roomTypeId) where.room_type_id = roomTypeId;

      const [images, total] = await Promise.all([
        prisma.room_type_image.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.room_type_image.count({ where }),
      ]);

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      const table = [
        { label: 'No', key: 'no', type: 'none', is_search: false },
        { label: 'Image', key: 'image', type: 'image', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      success(res, bigintToNumber(images), 'Success', 200, {
        table,
        permission,
        search_data: [],
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Room type image list error:', err);
      error(res, 'Failed to fetch images', 500);
    }
  }

  /**
   * GET /api/room-type-images/create | /api/room-type-images/:id/update
   * Form data for room type image add/edit
   */
  static async imageForm(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const roomTypes = await prisma.room_types.findMany({
        where: { deleted_at: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const master = {
        room_types: roomTypes.map((r: any) => ({ value: Number(r.id), label: r.name })),
      };
      if (!idParam || !/^\d+$/.test(idParam)) {
        success(res, { status: 1 }, 'Success', 200, { master });
        return;
      }
      const record = await prisma.room_type_image.findUnique({ where: { id: BigInt(idParam) } });
      if (!record || record.deleted_at) { notFound(res, 'Image is not found'); return; }
      success(res, bigintToNumber(record), 'Success', 200, { master });
    } catch (err: any) {
      console.error('Room type image form error:', err);
      error(res, 'Failed to load image form', 500);
    }
  }

  /**
   * POST /api/room-types/:roomTypeId/images
   */
  static async imageStore(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const roomTypeIdParam = Array.isArray(req.params.roomTypeId) ? req.params.roomTypeId[0] : req.params.roomTypeId;
      const roomTypeId = roomTypeIdParam ? BigInt(roomTypeIdParam) : (req.body.room_type_id ? BigInt(req.body.room_type_id) : null);
      const { image } = req.body;

      const errors: Record<string, string[]> = {};
      if (!roomTypeId) errors.room_type_id = ['The room type id field is required.'];
      if (!image) errors.image = ['The image field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const record = await prisma.room_type_image.create({
        data: {
          property_id: propertyId!,
          room_type_id: roomTypeId!,
          image: image || null,
          status: STATUS_ACTIVE,
          created_by: userId,
        },
      });

      success(res, bigintToNumber(record), 'Success', 201);
    } catch (err: any) {
      console.error('Room type image store error:', err);
      error(res, 'Failed to store image', 500);
    }
  }

  /**
   * PUT /api/room-type-images/:id
   */
  static async imageUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;
      const { image } = req.body;

      const existing = await prisma.room_type_image.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Image not found');
        return;
      }

      const updateData: any = { updated_at: new Date(), updated_by: userId };
      if (image !== undefined) updateData.image = image;

      await prisma.room_type_image.update({ where: { id }, data: updateData });

      const updated = await prisma.room_type_image.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Room type image update error:', err);
      error(res, 'Failed to update image', 500);
    }
  }

  /**
   * DELETE /api/room-type-images/:id
   */
  static async imageDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.room_type_image.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Image not found');
        return;
      }

      await prisma.room_type_image.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Room type image destroy error:', err);
      error(res, 'Failed to delete image', 500);
    }
  }

  /**
   * POST /api/room-type-images/:id/restore
   */
  static async imageRestore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.room_type_image.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Image not found');
        return;
      }

      await prisma.room_type_image.update({
        where: { id },
        data: { deleted_at: null },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Room type image restore error:', err);
      error(res, 'Failed to restore image', 500);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ROOM INVENTORIES
  // ════════════════════════════════════════════════════════════

  /**
   * GET /api/rooms/:roomId/inventories
   */
  static async inventoryList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const roomIdParam = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
      const roomId = roomIdParam ? BigInt(roomIdParam) : undefined;
      const propertyId = req.user?.lastProperty;

      const where: any = { deleted_at: null };
      if (propertyId) where.property_id = propertyId;
      if (roomId) where.room_id = roomId;

      const [inventories, total] = await Promise.all([
        prisma.room_inventories.findMany({
          where,
          orderBy: { sort: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            code_items: { select: { id: true, name: true } },
          },
        }),
        prisma.room_inventories.count({ where }),
      ]);

      const formatted = inventories.map((inv: any) => ({
        ...bigintToNumber(inv),
        code_item_name: inv.code_items?.name || null,
      }));

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      const table = [
        { label: 'No', key: 'no', type: 'none', is_search: false },
        { label: 'Item', key: 'code_item_name', type: 'none', is_search: true },
        { label: 'Qty', key: 'qty', type: 'none', is_search: false },
        { label: 'Remark', key: 'remark', type: 'none', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      success(res, formatted, 'Success', 200, {
        table,
        permission,
        search_data: [],
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Room inventory list error:', err);
      error(res, 'Failed to fetch inventories', 500);
    }
  }

  /**
   * POST /api/rooms/:roomId/inventories
   */
  static async inventoryStore(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const roomIdParam = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
      const roomId = roomIdParam ? BigInt(roomIdParam) : null;
      const { qty, code_item_id, remark } = req.body;

      const errors: Record<string, string[]> = {};
      if (!roomId) errors.room_id = ['The room id field is required.'];
      if (qty === undefined) errors.qty = ['The qty field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const inventory = await prisma.room_inventories.create({
        data: {
          property_id: propertyId!,
          room_id: roomId!,
          code_item_id: code_item_id ? BigInt(code_item_id) : null,
          qty: Number(qty) || 0,
          remark: remark || null,
          status: STATUS_ACTIVE,
          created_by: userId,
        },
      });

      success(res, bigintToNumber(inventory), 'Success', 201);
    } catch (err: any) {
      console.error('Room inventory store error:', err);
      error(res, 'Failed to create inventory item', 500);
    }
  }

  /**
   * PUT /api/room-inventories/:id
   */
  static async inventoryUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;
      const { qty, code_item_id, remark } = req.body;

      const existing = await prisma.room_inventories.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Inventory item not found');
        return;
      }

      const updateData: any = { updated_at: new Date(), updated_by: userId };
      if (qty !== undefined) updateData.qty = Number(qty);
      if (code_item_id !== undefined) updateData.code_item_id = code_item_id ? BigInt(code_item_id) : null;
      if (remark !== undefined) updateData.remark = remark;

      await prisma.room_inventories.update({ where: { id }, data: updateData });

      const updated = await prisma.room_inventories.findUnique({
        where: { id },
        include: { code_items: { select: { id: true, name: true } } },
      });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Room inventory update error:', err);
      error(res, 'Failed to update inventory item', 500);
    }
  }

  /**
   * DELETE /api/room-inventories/:id
   */
  static async inventoryDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.room_inventories.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Inventory item not found');
        return;
      }

      await prisma.room_inventories.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Room inventory destroy error:', err);
      error(res, 'Failed to delete inventory item', 500);
    }
  }

  // ════════════════════════════════════════════════════════════
  // ROOM RESERVATIONS
  // ════════════════════════════════════════════════════════════

  /**
   * GET /api/rooms/:roomId/reservations
   */
  static async reservationList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const roomIdParam = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
      const roomId = roomIdParam ? BigInt(roomIdParam) : undefined;
      const propertyId = req.user?.lastProperty;

      const where: any = {
        deleted_at: null,
        room_id: roomId,
      };
      if (propertyId) where.property_id = propertyId;

      // Search by folio_number, status, dates
      if (search) {
        where.OR = [
          { folios: { folio_number: { contains: search, mode: 'insensitive' } } },
          { status_reservation: { equals: isNaN(Number(search)) ? undefined : Number(search) } },
        ];
      }

      const [reservations, total] = await Promise.all([
        prisma.reservations.findMany({
          where,
          orderBy: { date: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            folios: {
              select: {
                id: true,
                folio_number: true,
                first_name: true,
                last_name: true,
                company_name: true,
                check_in_date: true,
                check_out_date: true,
                status_reservation: true,
                type_reservation: true,
              },
            },
            room_types: { select: { id: true, name: true } },
            rates: { select: { id: true, name: true } },
          },
        }),
        prisma.reservations.count({ where }),
      ]);

      const formatted = reservations.map((r: any) => ({
        id: Number(r.id),
        date: r.date,
        check_in_date: r.check_in_date,
        check_out_date: r.check_out_date,
        night: r.night,
        adult: r.adult,
        child: r.child,
        status_reservation: r.status_reservation,
        folio_number: r.folios?.folio_number || null,
        guest_name: r.folios ? `${r.folios.first_name || ''} ${r.folios.last_name || ''}`.trim() : null,
        company_name: r.folios?.company_name || null,
        room_type_name: r.room_types?.name || null,
        rate_name: r.rates?.name || null,
      }));

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      const table = [
        { label: 'No', key: 'no', type: 'none', is_search: false },
        { label: 'Folio Number', key: 'folio_number', type: 'none', is_search: true },
        { label: 'Guest Name', key: 'guest_name', type: 'none', is_search: false },
        { label: 'Room Type', key: 'room_type_name', type: 'none', is_search: false },
        { label: 'Check In', key: 'check_in_date', type: 'date', is_search: false },
        { label: 'Check Out', key: 'check_out_date', type: 'date', is_search: false },
        { label: 'Status', key: 'status_reservation', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      success(res, formatted, 'Success', 200, {
        table,
        permission,
        search_data: [],
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Room reservation list error:', err);
      error(res, 'Failed to fetch reservations', 500);
    }
  }
}