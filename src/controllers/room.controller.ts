import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATUS_ACTIVE = 1;
const MENU_ID = 1120;

// Room statuses (config cms.room_status)
const ROOM_STATUSES = {
  vacant: { id: 0, name: 'Vacant' },
  occupied: { id: 1, name: 'Occupied' },
  dirty: { id: 2, name: 'Dirty' },
  out_of_order: { id: 3, name: 'Out of Order' },
};

// Maid statuses (config cms.maid_status)
const MAID_STATUSES = {
  clean: { id: 0, name: 'Clean' },
  dirty: { id: 1, name: 'Dirty' },
  inspect: { id: 2, name: 'Inspect' },
};

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
        configMap.get(mt.model_id)!.push(mt.types);
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
      const dateParam = req.query.date as string;
      const businessDate = dateParam ? new Date(dateParam) : new Date();
      businessDate.setHours(0, 0, 0, 0);

      const roomTypeIds = parseBigIntArray(req.query.room_types_X as string);
      const roomStatuses = parseBigIntArray(req.query.room_statuses_X as string);
      const maidStatuses = parseBigIntArray(req.query.maid_statuses_X as string);
      const roomConfigIds = parseBigIntArray(req.query.room_configurations_X as string);
      const buildingIds = parseBigIntArray(req.query.buildings_X as string);
      const floorIds = parseBigIntArray(req.query.floors_X as string);

      // Build room filter
      const roomWhere: any = { deleted_at: null, is_physical: true };
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
          other_rooms: {
            where: { deleted_at: null },
            select: { id: true, name: true, is_physical: true, sort: true },
          },
        },
      });

      // Filter by room configurations via model_has_types
      let roomIds = rooms.map((r) => r.id);
      if (roomConfigIds && roomConfigIds.length > 0) {
        const mht = await prisma.model_has_types.findMany({
          where: {
            model_id: { in: roomIds },
            model_type: 'App\\Models\\Room',
            type_id: { in: roomConfigIds },
          },
          select: { model_id: true },
        });
        const filteredIds = new Set(mht.map((m) => m.model_id));
        roomIds = roomIds.filter((id) => filteredIds.has(id));
      }

      // Filter by buildings and floors (types linked via model_has_types)
      if ((buildingIds && buildingIds.length > 0) || (floorIds && floorIds.length > 0)) {
        const typeFilter: any[] = [];
        if (buildingIds && buildingIds.length > 0) {
          typeFilter.push({ type_id: { in: buildingIds }, group: 'building' });
        }
        if (floorIds && floorIds.length > 0) {
          typeFilter.push({ type_id: { in: floorIds }, group: 'floor' });
        }
        // We'll need to do post-filtering by getting model_has_types for rooms
      }

      let filteredRooms = rooms.filter((r) => roomIds.includes(r.id));

      // Get reservations for the business date
      const nextDate = new Date(businessDate);
      nextDate.setDate(nextDate.getDate() + 1);

      const reservations = await prisma.reservations.findMany({
        where: {
          room_id: { in: roomIds, not: null },
          date: { gte: businessDate, lt: nextDate },
          deleted_at: null,
          folios: {
            deleted_at: null,
            status_reservation: { in: [1, 2] }, // reservation or check_in
          },
        },
        select: {
          room_id: true,
          folio_id: true,
          status_reservation: true,
          adult: true,
          child: true,
          folios: {
            select: {
              folio_number: true,
              first_name: true,
              last_name: true,
              company_name: true,
              check_in_date: true,
              check_out_date: true,
              status_reservation: true,
            },
          },
        },
      });

      const resvByRoom = new Map<bigint, any[]>();
      for (const r of reservations) {
        if (!r.room_id) continue;
        if (!resvByRoom.has(r.room_id)) resvByRoom.set(r.room_id, []);
        resvByRoom.get(r.room_id)!.push(r);
      }

      // Get buildings & floors for each room via model_has_types
      const allMht = await prisma.model_has_types.findMany({
        where: {
          model_id: { in: roomIds },
          model_type: 'App\\Models\\Room',
        },
        include: {
          types: { select: { id: true, name: true, group: true } },
        },
      });

      const buildingMap = new Map<bigint, any>();
      const floorMap = new Map<bigint, any>();
      const roomBuildingMap = new Map<bigint, bigint>();
      const roomFloorMap = new Map<bigint, bigint>();

      for (const mht of allMht) {
        if (mht.types.group === 'building') {
          buildingMap.set(mht.type_id, { id: Number(mht.type_id), name: mht.types.name });
          roomBuildingMap.set(mht.model_id, mht.type_id);
        }
        if (mht.types.group === 'floor') {
          floorMap.set(mht.type_id, { id: Number(mht.type_id), name: mht.types.name });
          roomFloorMap.set(mht.model_id, mht.type_id);
        }
      }

      // Filter by building/floor if specified
      if (buildingIds && buildingIds.length > 0) {
        filteredRooms = filteredRooms.filter((r) => {
          const bId = roomBuildingMap.get(r.id);
          return bId && buildingIds.includes(bId);
        });
      }
      if (floorIds && floorIds.length > 0) {
        filteredRooms = filteredRooms.filter((r) => {
          const fId = roomFloorMap.get(r.id);
          return fId && floorIds.includes(fId);
        });
      }

      // Build nested structure: building -> floor -> rooms
      const buildingGroup: Record<string, any> = {};
      const dataArray: any[] = [];

      for (const room of filteredRooms) {
        const bId = roomBuildingMap.get(room.id);
        const fId = roomFloorMap.get(room.id);
        const building = bId ? buildingMap.get(bId) : null;
        const floor = fId ? floorMap.get(fId) : null;
        const buildingKey = building ? `${building.id}` : '0';
        const floorKey = floor ? `${floor.id}` : '0';

        const roomReservations = resvByRoom.get(room.id) || [];
        const currentReservation = roomReservations.length > 0
          ? bigintToNumber(roomReservations[0].folios)
          : null;

        const roomData = {
          id: Number(room.id),
          name: room.name,
          room_type_id: Number(room.room_type_id),
          room_type_name: room.room_types?.name || null,
          room_status: room.room_status,
          maid_status: room.maid_status,
          max_pax: room.max_pax,
          total_bed: room.total_bed,
          sort: room.sort,
          is_physical: room.is_physical,
          current_reservation: currentReservation,
          sub_rooms: room.other_rooms?.map((sr: any) => ({
            id: Number(sr.id),
            name: sr.name,
            is_physical: sr.is_physical,
          })) || [],
        };

        dataArray.push(roomData);

        if (!buildingGroup[buildingKey]) {
          buildingGroup[buildingKey] = {
            id: building?.id || 0,
            name: building?.name || 'No Building',
            floors: {},
          };
        }
        if (!buildingGroup[buildingKey].floors[floorKey]) {
          buildingGroup[buildingKey].floors[floorKey] = {
            id: floor?.id || 0,
            name: floor?.name || 'No Floor',
            rooms: [],
          };
        }
        buildingGroup[buildingKey].floors[floorKey].rooms.push(roomData);
      }

      const buildingGrouped = Object.values(buildingGroup).map((b: any) => ({
        ...b,
        floors: Object.values(b.floors),
      }));

      // Master data for filter dropdowns
      const [roomTypes, roomConfigs, buildingTypes, floorTypes] = await Promise.all([
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
      ]);

      const master = {
        room_statuses: Object.values(ROOM_STATUSES).map((s) => ({ value: s.id, label: s.name })),
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        maid_statuses: Object.values(MAID_STATUSES).map((s) => ({ value: s.id, label: s.name })),
        room_configurations: roomConfigs.map((rc: any) => ({ value: Number(rc.id), label: rc.name })),
        buildings: buildingTypes.map((b: any) => ({ value: Number(b.id), label: b.name })),
        floors: floorTypes.map((f: any) => ({ value: Number(f.id), label: f.name })),
        room_type_groups: [],
      };

      const meta = {
        room_types_X: roomTypeIds?.map((id) => Number(id)) || [],
        room_statuses_X: roomStatuses?.map((id) => Number(id)) || [],
        maid_statuses_X: maidStatuses?.map((id) => Number(id)) || [],
        room_configurations_X: roomConfigIds?.map((id) => Number(id)) || [],
        buildings_X: buildingIds?.map((id) => Number(id)) || [],
        floors_X: floorIds?.map((id) => Number(id)) || [],
        date: businessDate.toISOString().split('T')[0],
      };

      success(res, buildingGrouped, 'Success', 200, {
        master,
        data: dataArray,
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

      const [statuses, activeRooms, roomTypes, roomConfigs, inRoomEquipments] = await Promise.all([
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
      ]);

      const master = {
        statuses,
        rooms: activeRooms.map((r: any) => ({ value: Number(r.id), label: r.name })),
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        room_configurations: roomConfigs.map((rc: any) => ({ value: Number(rc.id), label: rc.name })),
        in_room_equipments: inRoomEquipments.map((e: any) => ({ value: Number(e.id), label: e.name })),
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
        room_configurations: mht.filter((m) => m.types.group === 'room-configuration').map((m) => m.types),
        in_room_equipments: mht.filter((m) => m.types.group === 'in-room-equipment').map((m) => m.types),
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

      const [room, activeRooms, roomTypes, roomConfigs, inRoomEquipments] = await Promise.all([
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
   * POST /api/room-types/:roomTypeId/images
   */
  static async imageStore(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const roomTypeIdParam = Array.isArray(req.params.roomTypeId) ? req.params.roomTypeId[0] : req.params.roomTypeId;
      const roomTypeId = roomTypeIdParam ? BigInt(roomTypeIdParam) : null;
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
