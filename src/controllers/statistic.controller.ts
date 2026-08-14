import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error } from '../utils/response';
import { AuthController } from './auth.controller';
import { getPermissionFlags } from '../middleware/permission.middleware';
import {
  ROOM_STATUSES,
  MAID_STATUSES,
  STATUS_RESERVATION_MAP,
  getColorRoom,
  getColorMaid,
  getColorReservation,
  dashLabel,
} from '../utils/cmsStatus';
import { laravelPaging } from '../utils/tableMeta';

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

export class StatisticController {

  static async dashboard(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      const [totalRooms, availableRooms, checkIns, checkOuts, occupancy, inHouse] = await Promise.all([
        prisma.rooms.count({ where: { property_id: pid, deleted_at: null } }),
        prisma.rooms.count({ where: { property_id: pid, deleted_at: null, status: 0 } }),
        prisma.folios.count({ where: { property_id: pid, status_reservation: 2, check_in_date: { gte: today, lt: tomorrow }, deleted_at: null } }),
        prisma.folios.count({ where: { property_id: pid, status_reservation: 3, check_out_date: { gte: today, lt: tomorrow }, deleted_at: null } }),
        prisma.folios.count({ where: { property_id: pid, status_reservation: 2, deleted_at: null } }),
        prisma.folios.count({ where: { property_id: pid, status_reservation: { in: [1, 2] }, deleted_at: null } }),
      ]);

      const occupancyRate = totalRooms > 0 ? ((occupancy / totalRooms) * 100).toFixed(1) : '0.0';

      success(res, {
        total_rooms: totalRooms,
        available_rooms: availableRooms,
        check_ins: checkIns,
        check_outs: checkOuts,
        in_house: occupancy,
        occupancy_rate: `${occupancyRate}%`,
      }, 'Success');
    } catch (err: any) { console.error('Dashboard error:', err); error(res, 'Failed to load dashboard', 500); }
  }

  static async roomAvailability(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid === 0n ? null : pid);

      let start = businessDate;
      let end = (req.query.end as string) || (req.query.date_to as string) || '';
      const hasRange = req.query.date_from && req.query.date_to;
      if (hasRange) {
        start = req.query.date_from as string;
        end = req.query.date_to as string;
      } else if (!end) {
        const d = new Date(start + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 7);
        end = d.toISOString().substring(0, 10);
      }

      const diffDate = Math.floor((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;
      const NIGHT = diffDate - 1;

      const table: any[] = [
        { label: 'Unit', key: 'unit', type: 'none', is_link: true, is_search: false },
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Room Status', key: 'room_status', is_drag: true, type: 'none', is_search: false },
        { label: 'Maid Status', key: 'maid_status', is_drag: true, type: 'none', is_search: false },
      ];
      for (let i = 0; i <= NIGHT; i++) {
        const d = new Date(start + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + i);
        table.push({
          label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/,/g, ''),
          key: d.toISOString().substring(0, 10),
          type: 'select',
          options: [
            { value: 'vacant', label: 'Vacant' },
            { value: 'blocked', label: 'Blocked' },
          ],
          is_drag: true,
          is_search: false,
        });
      }

      // Rooms (onlyActive + filters)
      const roomWhere: any = { deleted_at: null, status: 1 };
      if (pid) roomWhere.property_id = pid;
      const roomTypeIds = ((req.query.room_type as string) || '').split(',').filter(Boolean).map(BigInt);
      const roomConfIds = ((req.query.room_conf as string) || '').split(',').filter(Boolean).map(BigInt);
      const roomTypeGroupIds = ((req.query.room_type_group as string) || '').split(',').filter(Boolean).map(BigInt);
      if (roomTypeIds.length > 0) roomWhere.room_type_id = { in: roomTypeIds };

      const rooms = await prisma.rooms.findMany({
        where: roomWhere,
        orderBy: { sort: 'asc' },
        include: { room_types: { select: { id: true, name: true } } },
      });

      let roomIds = rooms.map((r) => r.id);

      // room_conf: rooms via model_has_types
      if (roomConfIds.length > 0) {
        const mht = await prisma.model_has_types.findMany({
          where: { model_id: { in: roomIds }, model_type: 'App\\Models\\Room', type_id: { in: roomConfIds } },
          select: { model_id: true },
        });
        const set = new Set(mht.map((m) => m.model_id));
        roomIds = roomIds.filter((id) => set.has(id));
      }

      // room_type_group: room types via model_has_types on RoomType
      if (roomTypeGroupIds.length > 0) {
        const rtMht = await prisma.model_has_types.findMany({
          where: { model_type: 'App\\Models\\RoomType', type_id: { in: roomTypeGroupIds } },
          select: { model_id: true },
        });
        const rtSet = new Set(rtMht.map((m) => m.model_id));
        roomIds = roomIds.filter((id) => {
          const room = rooms.find((r) => r.id === id);
          return room && rtSet.has(room.room_type_id);
        });
      }

      const startDate = new Date(start + 'T00:00:00Z');
      const endDate = new Date(end + 'T00:00:00Z');
      endDate.setUTCDate(endDate.getUTCDate() + 1);

      const [roomAvailabilities, reservations, workOrders] = await Promise.all([
        prisma.room_availabilities.findMany({
          where: { date: { gte: startDate, lt: endDate } },
          orderBy: { date: 'asc' },
        }),
        prisma.reservations.findMany({
          where: {
            room_id: { in: roomIds, not: null },
            date: { gte: startDate, lt: endDate },
            deleted_at: null,
            folios: { deleted_at: null, status_reservation: { not: 2 } },
          },
          include: {
            folios: { select: { id: true, folio_number: true, status_reservation: true } },
          },
        }),
        prisma.work_orders.findMany({
          where: { room_id: { in: roomIds, not: null }, end_date: null, deleted_at: null },
          orderBy: { date: 'asc' },
        }),
      ]);

      const fmtDate = (d: Date | null | undefined): string =>
        d ? d.toISOString().substring(0, 10) : '';
      const addDays = (base: string, days: number): string => {
        const d = new Date(base + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().substring(0, 10);
      };

      const checkDateRoom = (roomId: bigint, date: string): any => {
        // reservation
        const getReservation = reservations.filter(
          (r) => r.room_id === roomId && fmtDate(r.date) === date
        );
        if (getReservation.length > 0) {
          const first = getReservation[0];
          const folioGroup = reservations.filter(
            (r) => r.room_id === roomId && r.folios?.folio_number === first.folios?.folio_number
          );
          const groupMin = folioGroup.length > 0 ? fmtDate(folioGroup[0].date) : date;
          let isColspan = false;
          let colspan = 0;
          let isSkip = false;
          if (fmtDate(first.date) === groupMin) {
            isColspan = true;
            colspan = folioGroup.length;
          } else {
            isSkip = true;
          }
          const folio = first.folios;
          const statusLabel = dashLabel(folio?.status_reservation ?? 0, STATUS_RESERVATION_MAP);
          return {
            value: [
              {
                label:
                  '<div class="tooltiptbl w-full text-center"><a href="/reservation/fit/reservation?parent=62&data=' +
                  (folio?.id ?? '') +
                  '&card=0&pageload=">' +
                  statusLabel +
                  '-' +
                  (folio?.folio_number ?? '') +
                  '</a><span class="tooltiptext">' +
                  (folio?.folio_number ?? '') +
                  '<br/>' +
                  STATUS_RESERVATION_MAP[folio?.status_reservation ?? 0] +
                  '</span></div>',
                color: getColorReservation(folio?.status_reservation ?? 0),
                is_color: true,
              },
            ],
            href: '',
            is_colspan: isColspan,
            colspan,
            is_skip: isSkip,
          };
        }

        // room availability (blocked)
        const getRoomAvail = roomAvailabilities.filter(
          (a) => Number(a.room_id) === Number(roomId) && fmtDate(a.date) === date
        );
        if (getRoomAvail.length > 0) {
          const first = getRoomAvail[0];
          const group = roomAvailabilities.filter(
            (a) => Number(a.room_id) === Number(roomId) && a.uniqueCode === first.uniqueCode
          );
          const groupMin = group.length > 0 ? fmtDate(group[0].date) : date;
          let isColspan = false;
          let colspan = 0;
          let isSkip = false;
          if (fmtDate(first.date) === groupMin) {
            isColspan = true;
            colspan = group.length;
          } else {
            isSkip = true;
          }
          const reason = first.reason ?? '';
          return {
            value: [
              {
                label:
                  '<div class="tooltiptbl w-full text-center">Blocked<br/>(' +
                  reason +
                  ')<span class="tooltiptext">Blocked<br/>' +
                  reason +
                  '</span></div>',
                color: getColorRoom(3),
                is_color: true,
              },
            ],
            href: '',
            is_colspan: isColspan,
            colspan,
            is_skip: isSkip,
          };
        }

        // work order (OOO)
        const getWorkOrder = workOrders.filter(
          (w) => w.room_id === roomId && fmtDate(w.date) <= date
        );
        if (getWorkOrder.length > 0) {
          const first = getWorkOrder[0];
          let isColspan = false;
          let colspan = 0;
          let isSkip = false;
          if (date === fmtDate(first.date) || (fmtDate(first.date) < start && start === date)) {
            const totalColspan = first.end_date == null
              ? diffDate
              : Math.max(1, Math.floor((Date.parse(fmtDate(first.end_date) + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000));
            isColspan = true;
            colspan = totalColspan;
          } else {
            isSkip = true;
          }
          const desc = first.work_description ?? '';
          return {
            value: [
              {
                label:
                  '<div class="tooltiptbl w-full text-center">OOO<br/>(' +
                  desc +
                  ')<span class="tooltiptext">OOO<br/>' +
                  desc +
                  '</span></div>',
                color: getColorRoom(4),
                is_color: true,
              },
            ],
            href: '',
            is_colspan: isColspan,
            colspan,
            is_skip: isSkip,
          };
        }

        // vacant
        return {
          value: '',
          href: '<a href="?parent=55&add=1&data=' + Number(roomId) + '&date=' + date + '">Change</a>',
          is_colspan: false,
          colspan: 0,
          is_skip: false,
        };
      };

      const statusToName = (id: number, map: Record<string, { id: number; name: string }>): string =>
        Object.values(map).find((s) => s.id === id)?.name ?? '';

      const data = rooms.filter((r) => roomIds.includes(r.id)).map((room: any) => {
        const row: any = {
          id: Number(room.id),
          unit: room.name,
          room_type: room.room_types?.name ?? null,
          room_status_url: '-',
          room_status_colspan: 1,
          room_status: [
            {
              label: dashLabel(room.room_status ?? 0, Object.fromEntries(Object.values(ROOM_STATUSES).map((s) => [s.id, s.name]))),
              color: getColorRoom(room.room_status ?? 0),
              is_color: true,
            },
          ],
          maid_status_url: '-',
          maid_status_colpan: 1,
          maid_status: [
            {
              label: dashLabel(room.maid_status ?? 0, Object.fromEntries(Object.values(MAID_STATUSES).map((s) => [s.id, s.name]))),
              color: getColorMaid(room.maid_status ?? 0),
              is_color: true,
            },
          ],
        };
        for (let i = 0; i <= NIGHT; i++) {
          const date = addDays(start, i);
          const cell = checkDateRoom(room.id, date);
          row[date + '_href'] = cell.href;
          if (cell.is_colspan) row[date + '_colspan'] = cell.colspan;
          row[date] = cell.is_skip ? 'skip_' : cell.value;
        }
        return row;
      });

      const [roomTypes, roomConfigs, roomTypeGroups] = await Promise.all([
        prisma.room_types.findMany({
          where: { deleted_at: null, status: 1, property_id: pid as bigint },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: 1, group: 'room-configuration' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: 1, group: 'room-type-grouping' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
      ]);

      const master = {
        status_rooms: [
          { label: 'Vacant', value: 'vacant' },
          { label: 'Blocked', value: 'blocked' },
        ],
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        room_configurations: roomConfigs.map((rc: any) => ({ value: Number(rc.id), label: rc.name })),
        room_type_groups: roomTypeGroups.map((g: any) => ({ value: Number(g.id), label: g.name })),
      };

      success(res, data, 'Data has been loaded', 200, {
        table,
        pagging: laravelPaging(data.length, 9999, 1),
        permission: getPermissionFlags(req.user, 1141),
        master,
      } as any);
    } catch (err: any) {
      console.error('Room availability error:', err);
      error(res, 'Failed to load room availability', 500);
    }
  }

  static async byRoomType(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const date = req.query.date as string || new Date().toISOString().split('T')[0];
      const d = new Date(date); d.setHours(0, 0, 0, 0);

      const roomTypes = await prisma.room_types.findMany({ where: { property_id: pid, deleted_at: null } });
      const stats = await Promise.all(roomTypes.map(async (rt: any) => {
        const totalRooms = await prisma.rooms.count({ where: { room_type_id: rt.id, deleted_at: null } });
        const occupied = await prisma.folios.count({
          where: {
            property_id: pid,
            status_reservation: { in: [1, 2] },
            check_in_date: { lte: d },
            check_out_date: { gte: d },
            deleted_at: null,
            reservations: { some: { room_type_id: rt.id, deleted_at: null } },
          },
        });
        return { room_type_id: Number(rt.id), room_type: rt.name, total: totalRooms, occupied, available: totalRooms - occupied };
      }));

      success(res, stats, 'Success');
    } catch (err: any) { console.error('Statistic by room type error:', err); error(res, 'Failed to load statistic', 500); }
  }

  static async messages(req: Request, res: Response): Promise<void> {
    try {
      const data = await prisma.statistic_messages.findMany({ orderBy: { id: 'desc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load statistic messages', 500); }
  }

  static async rateCodes(req: Request, res: Response): Promise<void> {
    try {
      const data = await prisma.statistic_rate_codes.findMany({ orderBy: { id: 'desc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load statistic rate codes', 500); }
  }

  static async roomStatisticGrid(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
      const nd = new Date(d); nd.setDate(nd.getDate() + 1);

      const where: any = { property_id: pid, deleted_at: null };
      const [rooms, total] = await Promise.all([
        prisma.rooms.findMany({ where, orderBy: { sort: 'asc' }, include: { room_types: { select: { name: true } } } }),
        prisma.rooms.count({ where }),
      ]);

      const modelTypes = await prisma.model_has_types.findMany({
        where: { model_id: { in: rooms.map((r: any) => r.id) }, model_type: 'App\\Models\\Room' },
        include: { types: { select: { id: true, name: true, group: true } } },
      });
      const typeMap = new Map<bigint, any[]>();
      for (const mt of modelTypes) {
        if (!typeMap.has(mt.model_id)) typeMap.set(mt.model_id, []);
        typeMap.get(mt.model_id)!.push(mt.types);
      }

      const folios = await prisma.folios.findMany({
        where: {
          property_id: pid,
          status_reservation: { notIn: [4, 5] },
          check_in_date: { lt: nd },
          check_out_date: { gte: d },
          deleted_at: null,
        },
        select: { id: true, folio_number: true, status_reservation: true, check_in_date: true, check_out_date: true, reservations: { select: { room_id: true } } },
      });
      const folioMap = new Map<bigint, any>();
      for (const f of folios) {
        const roomId = (f as any).reservations?.[0]?.room_id;
        if (roomId && !folioMap.has(roomId)) folioMap.set(roomId, f);
      }

      const data = rooms.map((r: any) => {
        const types = typeMap.get(r.id) || [];
        const building = types.find((t: any) => t.group === 'building');
        const floor = types.find((t: any) => t.group === 'floor');
        const folio = folioMap.get(r.id);
        return {
          id: Number(r.id),
          name: r.name,
          room_type_name: r.room_types?.name || null,
          building: building ? { value: Number(building.id), label: building.name } : [],
          floor: floor ? { value: Number(floor.id), label: floor.name } : [],
          building_name: building?.name || '',
          floor_name: floor?.name || '',
          room_status: { value: r.room_status, label: '', colorCode: '' },
          maid_status: { value: r.maid_status, label: '' },
          max_pax: r.max_pax,
          total_bed: r.total_bed,
          folio: folio ? {
            folio_id: Number(folio.id),
            folio_number: folio.folio_number,
            folio_status: String(folio.status_reservation),
            folio_status_color_code: null,
            check_in_date: folio.check_in_date,
            check_out_date: folio.check_out_date,
            url: null,
          } : null,
        };
      });

      const building = [...new Set(data.map((x: any) => x.building_name))].filter(Boolean).map((bname: any) => ({
        value: bname, label: bname,
        floors: [...new Set(data.filter((x: any) => x.building_name === bname).map((x: any) => x.floor_name))].map((fname: any) => ({
          value: fname, label: fname, layout: '', code_image: '',
          rooms: data.filter((x: any) => x.building_name === bname && x.floor_name === fname),
        })),
      }));

      const meta: any = {
        building,
        data,
        table: [
          { label: 'Room Name', key: 'name', type: 'none', is_search: true },
          { label: 'Room Type', key: 'room_type_name', type: 'none', is_search: false },
          { label: 'Building', key: 'building_name', type: 'none', is_search: false },
          { label: 'Floor', key: 'floor_name', type: 'none', is_search: false },
          { label: 'Status', key: 'room_status', type: 'badge', is_search: false },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      };
      success(res, null, 'Success', 200, meta);
    } catch (err: any) { console.error('Room statistic grid error:', err); error(res, 'Failed to load room statistic', 500); }
  }
}
