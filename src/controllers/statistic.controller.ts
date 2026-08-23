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
import { priceNight } from '../utils/reservationPricing';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// saveReservation-lite for drag rebuild — priced per-night row creation against an arbitrary tx client.
async function priceNightPublic(tx: any, opts: {
  rateId: bigint | null;
  roomTypeId: bigint;
  night: Date;
  getNight: number;
  adult: number;
  child: number;
  isTax: boolean;
  rateCodePost: any;
}) {
  return priceNight({
    prisma: tx as any,
    ...opts,
    quantity: 1,
    promos: [],
  } as any);
}

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

export class StatisticController {

  // Laravel StatisticController@index (:29-227) — 7-section widget payload
  // (Total Room / Departure FIT / Arrival FIT / Arrival & Departure GIT /
  //  Total Arrival GIT & FIT / Forecast / Housekeeping).
  static async index(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = (req.user as any)?.bussinesDate || new Date().toISOString().split('T')[0];
      const bd = new Date(businessDate + 'T00:00:00.000Z');
      const bdNext = new Date(bd.getTime() + 86400000);

      const rooms = await prisma.rooms.findMany({
        where: { property_id: pid, deleted_at: null, status: 1 },
        select: { id: true, room_status: true, maid_status: true, room_type_id: true },
      });
      const availHolds = await prisma.room_availabilities.findMany({
        where: { property_id: Number(pid), deleted_at: null, date: { gte: bd, lt: bdNext } },
        select: { room_id: true },
      });
      const heldRoomIds = new Set(availHolds.map((a) => Number(a.room_id)));

      const MAIDS: Array<[number, string]> = [[0, 'Clean'], [1, 'Dirty'], [2, 'Maid in Room'], [3, 'Inspection Required']];
      const STATUS_ALIAS: Record<number, string> = { 0: 'Vacant', 1: 'Occupied', 2: 'Due Out', 3: 'Blocked', 4: 'Out of Order' };

      // ── Room::getListAndMaidStatusRoom (:206-271) ──
      const countBy = (pred: (r: any) => boolean) => rooms.filter(pred).length;
      const dataRoom: any[] = [
        { name: 'Total Rooms', data: rooms.length },
        { name: 'OOO', data: countBy((r) => r.room_status === 4) },
        { name: 'Blocked Rooms', data: rooms.filter((r) => heldRoomIds.has(Number(r.id))).length },
        { name: 'Saleable Room', data: countBy((r) => [0, 1, 2].includes(r.room_status)) },
      ];
      const dataRoomMaid: any[] = [];
      for (const sid of Object.keys(STATUS_ALIAS).map(Number)) {
        dataRoomMaid.push({ name: `-> ${STATUS_ALIAS[sid]}`, data: countBy((r) => r.room_status === sid) });
        for (const [mid, alias] of MAIDS) {
          dataRoomMaid.push({ name: alias, data: countBy((r) => r.room_status === sid && r.maid_status === mid) });
        }
      }
      const dataRoomMaidAll: any[] = MAIDS.map(([mid, alias]) => ({ name: alias, data: countBy((r) => r.maid_status === mid) }));

      // ── Folio::getArrival (:3917-3977) / getDeparture (:3979-4041) ──
      const arrivalFolios = await prisma.folios.findMany({
        where: { property_id: pid, deleted_at: null, status_reservation: { in: [0, 3] }, check_in_date: { gte: bd, lt: bdNext } },
        select: { type_reservation: true, status_reservation: true, parent: true },
      });
      const departureFolios = await prisma.folios.findMany({
        where: { property_id: pid, deleted_at: null, status_reservation: { in: [0, 1] }, check_out_date: { gte: bd, lt: bdNext } },
        select: { type_reservation: true, status_reservation: true, parent: true },
      });
      const isFit = (f: any) => String(f.type_reservation ?? '').toLowerCase() === 'fit';
      const isGitSub = (f: any) => String(f.type_reservation ?? '').toLowerCase() === 'git' && Number(f.parent ?? 0) !== 0;

      const arrivalStats = (rows: any[], actualStatus: number) => {
        const fitExp = rows.filter(isFit).length;
        const fitAct = rows.filter((f) => f.status_reservation === actualStatus && isFit(f)).length;
        const gitRows = rows.filter(isGitSub);
        const gitExp = gitRows.length;
        const gitAct = rows.filter((f) => f.status_reservation === actualStatus && isGitSub(f)).length;
        return {
          fit: { expected: fitExp, actual: fitAct, due: fitExp - fitAct },
          git: {
            total_git: new Set(gitRows.map((f) => String(f.parent))).size,
            expected: gitExp,
            actual: gitAct,
            due: gitExp - gitAct,
          },
        };
      };
      const arrS = arrivalStats(arrivalFolios, 0);
      const depS = arrivalStats(departureFolios, 1);

      const dataDeparture = [
        { name: 'Expected', data: depS.fit.expected },
        { name: 'Actual', data: depS.fit.actual },
        { name: 'Due to Depart', data: depS.fit.due },
      ];
      const dataArrivalFIT = [
        { name: 'Expected', data: arrS.fit.expected },
        { name: 'Actual', data: arrS.fit.actual },
        { name: 'Due to Arrival', data: arrS.fit.due },
      ];
      const dataArrivalGitFinal = [
        { name: 'Total Room group', data: depS.git.total_git },
        { name: '-> Departure', data: '' },
        { name: 'Expected', data: depS.git.expected },
        { name: 'Actual', data: depS.git.actual },
        { name: 'Due to Departure', data: depS.git.due },
        { name: '-> Arrival', data: '' },
        { name: 'Expected', data: arrS.git.expected },
        { name: 'Actual', data: arrS.git.actual },
        { name: 'Due to Arrival', data: arrS.git.due },
      ];
      const dataArrivalGitandFIT = [
        { name: 'Expected', data: arrS.fit.expected + arrS.git.expected },
        { name: 'Actual', data: arrS.fit.actual + arrS.git.actual },
        { name: 'Due to Arrival', data: arrS.fit.due + arrS.git.due },
      ];

      // ── Reservation::getForecast (:1068-1211) ──
      const forecastResvs = await prisma.reservations.findMany({
        where: { property_id: pid, deleted_at: null, date: { gte: bd, lt: bdNext }, folios: { is: { status_reservation: { notIn: [2] } } } },
        select: {
          adult: true, child: true, amount: true,
          folios: { select: { status_reservation: true, check_in_date: true, guest_profile_id: true } },
        },
      });
      const folioOf = (r: any) => r.folios ?? {};
      const sameDay = (d: Date | string | null | undefined) => d != null && fmtDay(d as any) === businessDate;
      function fmtDay(d: Date | string): string {
        const dt = typeof d === 'string' ? new Date(d.length <= 10 ? d + 'T00:00:00.000Z' : d) : d;
        return dt.toISOString().slice(0, 10);
      }

      const roomBooked = forecastResvs.filter((r) => folioOf(r).status_reservation === 3 && sameDay(folioOf(r).check_in_date)).length;
      const roomInHouse = forecastResvs.filter((r) => folioOf(r).status_reservation === 0 && sameDay(folioOf(r).check_in_date)).length;
      const pendingResv = forecastResvs.filter((r) => folioOf(r).status_reservation === 5 && sameDay(folioOf(r).check_in_date)).length;

      // Available: active rooms with NO availability hold ever and no qualifying reservation tonight
      const soldResvTonight = await prisma.reservations.findMany({
        where: {
          property_id: pid, deleted_at: null, date: { gte: bd, lt: bdNext }, room_id: { not: null },
          folios: { is: { status_reservation: { notIn: [1, 2, 5] } } },
        },
        select: { room_id: true },
      });
      const occupiedRoomIds = new Set(soldResvTonight.map((s) => Number(s.room_id)));
      const allHoldRoomIds = new Set(
        (await prisma.room_availabilities.findMany({ where: { deleted_at: null, property_id: Number(pid) }, select: { room_id: true } })).map((a) => Number(a.room_id))
      );
      const roomAvailable = rooms.filter((r) => !allHoldRoomIds.has(Number(r.id)) && !occupiedRoomIds.has(Number(r.id))).length;

      const roomSold = countBy((r) => [1, 2].includes(r.room_status));
      const denom = roomAvailable <= 0 ? 1 : roomAvailable;
      const pct = (v: number) => `${(Math.round(v * 10000) / 10000 * 100).toFixed(2)}%`;
      const occAdult = forecastResvs.reduce((s, r) => s + (Number(r.adult) || 0), 0);
      const occChild = forecastResvs.reduce((s, r) => s + (Number(r.child) || 0), 0);

      // Guest-status tiers via model_has_types (guest-status group)
      const guestIds = [...new Set(forecastResvs.map((r) => folioOf(r).guest_profile_id).filter((g) => g != null))] as bigint[];
      const tierCount: Record<string, number> = { VIP: 0, VVIP: 0, VVVIP: 0 };
      if (guestIds.length) {
        const links = await prisma.model_has_types.findMany({
          where: { model_type: 'App\\Models\\GuestProfile', model_id: { in: guestIds } },
          select: { model_id: true, types: { select: { name: true } } },
        });
        const inHouseGuestIds = new Set(
          forecastResvs
            .filter((r) => [0, 3, 4].includes(folioOf(r).status_reservation))
            .map((r) => String(folioOf(r).guest_profile_id)),
        );
        for (const l of links) {
          const nm = String(l.types?.name ?? '').toUpperCase();
          if (tierCount[nm] !== undefined && inHouseGuestIds.has(String(l.model_id))) tierCount[nm] += 1;
        }
      }

      const roomRevenueSum = forecastResvs.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const revenueDenom = forecastResvs.length > 0 ? forecastResvs.length : 1;
      const moneyFormatLocal = (n: number) =>
        'Rp ' + n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const dataForecast = [
        { name: 'Booked Rev.', data: roomBooked },
        { name: 'Room In House', data: roomInHouse },
        { name: 'Room Available', data: roomAvailable },
        { name: 'Pending Rev.', data: pendingResv },
        { name: 'Occ % include Pending', data: pct((roomSold + roomBooked) / denom) },
        { name: 'Occ % exclude Pending', data: pct((roomSold + pendingResv) / denom) },
        { name: 'Occ (Adult/Child)', data: `${occAdult}/${occChild}` },
        { name: 'VIP', data: tierCount.VIP },
        { name: 'VVIP', data: tierCount.VVIP },
        { name: 'VVVIP', data: tierCount.VVVIP },
        { name: 'Room Revenue', data: moneyFormatLocal(roomRevenueSum) },
        { name: 'Average Room Rate (ARR)', data: moneyFormatLocal(roomRevenueSum / revenueDenom) },
      ];

      const data = [
        { label: 'Total Room', sub_label: 'This information is about the room in the hotel', list: dataRoom },
        { label: 'Departure FIT', sub_label: 'This information is about the departure in the hotel', list: dataDeparture },
        { label: 'Arrival FIT', sub_label: 'This information is about the arrival FIT in the hotel', list: dataArrivalFIT },
        { label: 'Arrival & Departure GIT', sub_label: 'This information is about the arrival GIT in the hotel', list: dataArrivalGitFinal },
        { label: 'Total Arrival GIT & FIT', sub_label: 'This information is about the total arrival GIT & FIT in the hotel', list: dataArrivalGitandFIT },
        { label: 'Forecast', sub_label: 'This information is about the forecast in the hotel', list: dataForecast },
        { label: 'Housekeeping', sub_label: 'This information is about the housekeeping in the hotel', list: dataRoomMaid },
      ];

      const property = await prisma.properties.findUnique({ where: { id: pid } });
      success(res, bigintToNumber(data), 'Data has been loaded', 200, { property: bigintToNumber(property) } as any);
    } catch (err: any) {
      console.error('Statistic index error:', err);
      error(res, 'Failed to load statistic index', 500);
    }
  }

  static async dashboard(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      const [totalRooms, availableRooms, checkIns, checkOuts, occupancy, inHouse] = await Promise.all([
        prisma.rooms.count({ where: { property_id: Number(pid) } }),
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
        pagination: laravelPaging(data.length, 9999, 1),
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
      const businessDate = (req.user as any)?.bussinesDate || new Date().toISOString().split('T')[0];
      const startParam = (req.query.start as string) || (req.query.date as string) || businessDate;
      const endParam = (req.query.end as string) || null;

      const start = new Date(startParam); start.setHours(0, 0, 0, 0);
      const endBase = endParam ? new Date(endParam) : new Date(startParam);
      endBase.setDate(endBase.getDate() + 7);
      const end = new Date(endBase); end.setHours(0, 0, 0, 0);

      const NIGHT = Math.round((end.getTime() - start.getTime()) / 86400000);
      const days: string[] = [];
      for (let i = 0; i < NIGHT; i++) {
        const d = new Date(start); d.setDate(d.getDate() + i);
        days.push(d.toISOString().split('T')[0]);
      }

      // â”€â”€ Table (Laravel statisticsRoomType parity) â”€â”€
      const doubleClick = [
        {
          id: 0, type: 'form', key: 'daily_rate_code', label: 'Daily Rate Code',
          endpoint: '/cms/statistic/statistic-room-type/add-rate-code',
          form: [{ label: 'Message', key: 'text', type: 'base', type_input: 'text' }],
        },
        {
          id: 0, type: 'form', key: 'add_message', label: 'Add Message',
          endpoint: '/cms/statistic/statistic-room-type/add-message',
          form: [{ label: 'Message', key: 'text', type: 'textarea', type_input: 'text' }],
        },
      ];
      const table: any[] = [
        { label: 'Room Type', key: 'name', type: 'none', is_search: false },
        { label: 'Total Room', key: 'total', type: 'none', is_html: true, is_search: false },
      ];
      for (const day of days) {
        table.push({
          label: new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, ''),
          key: day,
          is_body_double_click: true,
          is_header_double_click: true,
          double_click_action: doubleClick.map((dc: any) => ({ ...dc, date: day })),
          type: 'none',
          is_html: true,
          is_search: false,
        });
      }

      // â”€â”€ Data sources â”€â”€
      const [roomTypes, messages, rateCodes, overbookingRows, availRows, workOrderRows, reservationRows] = await Promise.all([
        prisma.room_types.findMany({ where: { property_id: Number(pid) }, orderBy: { sort: 'asc' } }),
        prisma.statistic_messages.findMany({ where: { property_id: Number(pid), date: { gte: start, lte: end } } }),
        prisma.statistic_rate_codes.findMany({ where: { property_id: Number(pid), date: { gte: start, lte: end } } }),
        prisma.overbookings.findMany({ where: { property_id: pid, deleted_at: null, date: { gte: start, lte: end } } }),
        prisma.room_availabilities.findMany({ where: { property_id: Number(pid), deleted_at: null, date: { gte: start, lte: end } } }),
        prisma.work_orders.findMany({ where: { property_id: Number(pid) } }),
        prisma.reservations.findMany({
          where: { property_id: pid, deleted_at: null, date: { gte: start, lte: end }, room_id: { not: null } },
          select: { id: true, date: true, room_id: true, room_type_id: true, status_reservation: true },
        }),
      ]);

      const rooms = await prisma.rooms.findMany({ where: { property_id: Number(pid) }, select: { id: true, room_type_id: true } });

      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const msgByDate = new Map(messages.map((m: any) => [fmt(m.date), m.text]));
      const rcByDate = new Map(rateCodes.map((r: any) => [fmt(r.date), r.text]));
      const obByKey = new Map<string, number>();
      for (const ob of overbookingRows) {
        const k = fmt(ob.date) + ':' + String(ob.room_type_id);
        obByKey.set(k, (obByKey.get(k) || 0) + ob.overbooking);
      }
      const blockByDate = new Map<string, number>();
      for (const a of availRows) blockByDate.set(fmt(a.date), (blockByDate.get(fmt(a.date)) || 0) + 1);
      const soldByKey = new Map<string, number>();
      for (const r of reservationRows) {
        const k = fmt(r.date) + ':' + String(r.room_type_id || 0);
        if (r.room_type_id) soldByKey.set(k, (soldByKey.get(k) || 0) + 1);
      }

      const totalByType = new Map<bigint, number>();
      for (const rm of rooms) totalByType.set(rm.room_type_id, (totalByType.get(rm.room_type_id) || 0) + 1);
      let totalRoomAll = 0;
      for (const v of totalByType.values()) totalRoomAll += v;

      const isOooOn = (wo: any, day: string): boolean => {
        const d = new Date(day + 'T00:00:00');
        if (!wo.start_date || wo.start_date > d) return false;
        if (wo.end_date) return wo.end_date > d;
        return true;
      };
      const oooByDate = new Map<string, number>();
      for (const day of days) oooByDate.set(day, workOrderRows.filter((w: any) => isOooOn(w, day)).length);
      const soldByDate = new Map<string, number>();
      for (const day of days) {
        const key = day;
        let c = 0;
        for (const r of reservationRows) if (fmt(r.date) === key && r.status_reservation !== 3) c++;
        soldByDate.set(key, c);
      }

      // â”€â”€ Rows â”€â”€
      const data: any[] = [];
      const push = (row: any) => data.push({ id: 0, name: '', total: '', ...row });

      const msgRow: any = { id: 0, name: 'Message', total: '' };
      for (const day of days) {
        const t = msgByDate.get(day);
        msgRow[day] = t ? `<div class="bg-success px-1 py-1 text-white rounded-md mt-1 text-center">${t}</div>` : '';
      }
      push(msgRow);

      const rcRow: any = { id: 0, name: 'Daily Rate Code', total: '' };
      for (const day of days) {
        const t = rcByDate.get(day);
        rcRow[day] = t ? `<div class="bg-cyan px-1 py-1 text-white rounded-md mt-1 text-center">${t}</div>` : '';
      }
      push(rcRow);

      const blankRow: any = { id: 0, name: '', total: '' };
      for (const day of days) blankRow[day] = '';
      push(blankRow);

      for (const rt of roomTypes) {
        const row: any = { id: Number(rt.id), name: rt.name, total: totalByType.get(rt.id) || 0 };
        for (const day of days) {
          const overbooking = obByKey.get(day + ':' + String(rt.id)) || 0;
          row[day] = (totalByType.get(rt.id) || 0) + overbooking;
        }
        data.push(row);
      }

      for (let i = 0; i < 3; i++) push({});

      const totalRow: any = { id: 0, name: 'Total Room', total: '' };
      for (const day of days) totalRow[day] = totalRoomAll;
      push(totalRow);

      const soldRow: any = { id: 0, name: 'Room Sold', total: '' };
      for (const day of days) soldRow[day] = soldByDate.get(day) || 0;
      push(soldRow);

      const oooRow: any = { id: 0, name: 'Out of Order', total: '' };
      for (const day of days) oooRow[day] = oooByDate.get(day) || 0;
      push(oooRow);

      const blockRow: any = { id: 0, name: 'Blocked', total: '' };
      for (const day of days) blockRow[day] = blockByDate.get(day) || 0;
      push(blockRow);

      const availRow: any = { id: 0, name: 'Available Room', total: '' };
      for (const day of days) {
        availRow[day] = totalRoomAll - (soldByDate.get(day) || 0) - (oooByDate.get(day) || 0) - (blockByDate.get(day) || 0);
      }
      push(availRow);

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        permission: getPermissionFlags(req.user, 1141),
        pagination: laravelPaging(data.length, 9999, 1),
      } as any);
    } catch (err: any) { console.error('Statistic by room type error:', err); error(res, 'Failed to load statistic', 500); }
  }

  static async messages(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const data = await prisma.statistic_messages.findMany({
        where: { property_id: Number(pid) },
        orderBy: { id: 'desc' },
      });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load statistic messages', 500); }
  }

  static async rateCodes(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const data = await prisma.statistic_rate_codes.findMany({
        where: { property_id: Number(pid) },
        orderBy: { id: 'desc' },
      });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load statistic rate codes', 500); }
  }

  // Laravel StatisticController@statisticsRoomTypeGrouping (:1782-2410)
  static async statisticsRoomTypeGrouping(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = (req.user as any)?.bussinesDate || new Date().toISOString().split('T')[0];
      const startParam = (req.query.start as string) || businessDate;
      const endParam = (req.query.end as string) || null;

      const start = new Date(startParam + 'T00:00:00');
      const endBase = new Date((endParam || startParam) + 'T00:00:00');
      endBase.setDate(endBase.getDate() + 7);
      const end = endBase;

      const NIGHT = Math.round((end.getTime() - start.getTime()) / 86400000);
      const fmt = (d: Date | string | null): string => {
        if (!d) return '';
        const dt = typeof d === 'string' ? new Date(d.length <= 10 ? d + 'T00:00:00' : d) : d;
        return dt.toISOString().split('T')[0];
      };
      const dayList: string[] = [];
      for (let i = 0; i <= NIGHT; i++) {
        const d = new Date(start); d.setDate(d.getDate() + i);
        dayList.push(d.toISOString().split('T')[0]);
      }

      const getTooltip = (data: any, label: any = '') =>
        `<div class="tooltiptbl w-full text-center">${label !== '' ? label : data}<span class="tooltiptext">${data}<br/></span></div>`;
      const getOccupancy = (totalRoom: number, roomSold: number) => {
        const occ = Math.round((roomSold / (totalRoom <= 0 ? 1 : totalRoom)) * 10000) / 10000;
        return occ * 100 + '%';
      };

      // ── Table ──
      const table: any[] = [
        { label: 'Room Type', key: 'name', type: 'none', is_search: false },
        { label: 'Total Room', key: 'total', type: 'none', is_html: true, is_search: false },
      ];
      for (const day of dayList) {
        table.push({
          label: new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, ''),
          key: day,
          type: 'none',
          is_body_double_click: true,
          is_header_double_click: true,
          double_click_action: [
            { id: 0, type: 'form', key: 'daily_rate_code', date: day, label: 'Daily Rate Code', endpoint: '/cms/statistic/statistic-room-type/add-rate-code', form: [{ label: 'Message', key: 'text', type: 'base', type_input: 'text' }] },
            { id: 0, type: 'form', key: 'add_message', date: day, label: 'Add Message', endpoint: '/cms/statistic/statistic-room-type/add-message', form: [{ label: 'Message', key: 'text', type: 'textarea', type_input: 'text' }] },
          ],
          is_html: true,
          is_search: false,
        });
      }

      // ── Data sources ──
      const [groupingTypes, messages, rateCodes, overbookingRows, availRows, workOrderRows] = await Promise.all([
        prisma.types.findMany({
          where: { property_id: pid, group: 'room-type-grouping', deleted_at: null },
          orderBy: [{ status: 'desc' }, { sort: 'asc' }],
        }),
        prisma.statistic_messages.findMany({ where: { property_id: Number(pid), date: { gte: start, lte: end } } }),
        prisma.statistic_rate_codes.findMany({ where: { property_id: Number(pid), date: { gte: start, lte: end } } }),
        prisma.overbookings.findMany({ where: { property_id: pid, deleted_at: null, date: { gte: start, lte: end } } }),
        prisma.room_availabilities.findMany({ where: { property_id: Number(pid), deleted_at: null, date: { gte: start, lte: end } } }),
        prisma.work_orders.findMany({
          where: {
            property_id: pid,
            deleted_at: null,
            status: 1,
            date: { lte: start },
            room_id: { not: null },
            OR: [{ end_date: { gte: start } }, { end_date: null }],
          },
        }),
      ]);

      const rtLinks = groupingTypes.length
        ? await prisma.model_has_types.findMany({
            where: { model_type: 'App\\Models\\RoomType', type_id: { in: groupingTypes.map((t: any) => t.id) } },
            select: { model_id: true, type_id: true },
          })
        : [];

      const membersByGroup = new Map<bigint, bigint[]>();
      for (const t of groupingTypes) {
        const ids = rtLinks.filter((l: any) => Number(l.type_id) === Number(t.id)).map((l: any) => l.model_id as bigint);
        membersByGroup.set(t.id, ids);
      }
      const allMemberRtIds = [...new Set([...membersByGroup.values()].flat())];

      const rooms = await prisma.rooms.findMany({
        where: { property_id: pid, deleted_at: null, status: 1 },
        select: { id: true, name: true, room_type_id: true, room_status: true },
      });
      const roomsById = new Map(rooms.map((r: any) => [r.id, r]));
      const pluckRoom = rooms.filter((r: any) => allMemberRtIds.includes(r.room_type_id)).map((r: any) => r.id);
      const pluckRoomSet = new Set(pluckRoom.map(Number));

      const reservationRows = await prisma.reservations.findMany({
        where: { property_id: pid, deleted_at: null, date: { gte: start, lte: end } },
        select: {
          id: true, folio_id: true, date: true, room_id: true, room_type_id: true, adult: true, child: true,
          folios: { select: { id: true, folio_number: true, check_in_date: true, check_out_date: true, status_reservation: true, type_reservation: true } },
        },
      });
      const firstResByFolio = new Map<bigint, any>();
      for (const r of reservationRows) {
        if (!firstResByFolio.has(r.folio_id)) firstResByFolio.set(r.folio_id, r);
      }

      const [allotmentRows, allotmentExpiredRows, folioAllotmentRows] = await Promise.all([
        prisma.room_allotments.findMany({
          where: { property_id: pid, deleted_at: null, allotments: { is: { start_date: { lte: end }, end_date: { gte: start } } } },
          include: { allotments: { select: { start_date: true, end_date: true } } },
        }),
        prisma.room_allotments.findMany({
          where: { property_id: pid, deleted_at: null, allotments: { is: { end_date: { lt: start } } } },
          include: { allotments: { select: { end_date: true } } },
        }),
        prisma.folios.findMany({
          where: { property_id: pid, deleted_at: null, use_allotment: true, check_in_date: { lte: end }, check_out_date: { gte: start } },
          select: { check_in_date: true, check_out_date: true },
        }),
      ]);

      const sumAllotmentData = (rows: any[]): number =>
        rows.reduce((acc, ra) => {
          try { const vals: any = Object.values(JSON.parse(ra.data || '{}')); return acc + vals.reduce((a: number, v: any) => a + (Number(v) || 0), 0); } catch { return acc; }
        }, 0);

      // ── Lookup maps ──
      const msgByDate = new Map(messages.map((m: any) => [fmt(m.date), m.text]));
      const rcByDate = new Map(rateCodes.map((r: any) => [fmt(r.date), r.text]));
      const obByKey = new Map<string, number>();
      for (const ob of overbookingRows) {
        const k = fmt(ob.date) + ':' + String(ob.room_type_id);
        obByKey.set(k, (obByKey.get(k) || 0) + ob.overbooking);
      }
      const availByKey = new Map<string, number[]>();
      for (const a of availRows) {
        const k = fmt(a.date);
        if (!availByKey.has(k)) availByKey.set(k, []);
        availByKey.get(k)!.push(Number(a.room_id));
      }
      const folioStatus = (r: any) => r.folios?.status_reservation ?? null;

      // ── Rows ──
      const data: any[] = [];
      const pushBlank = () => {
        const row: any = { id: 0, name: '', total: '' };
        for (const day of dayList) row[day] = '';
        data.push(row);
      };

      const msgRow: any = { id: 0, name: 'Message', total: '' };
      for (const day of dayList) {
        const t = msgByDate.get(day);
        msgRow[day] = t ? `<div class="bg-success px-1 py-1 text-white rounded-md mt-1 text-center">${t}</div>` : '';
      }
      data.push(msgRow);

      const rcRow: any = { id: 0, name: 'Daily Rate Code', total: '' };
      for (const day of dayList) {
        const t = rcByDate.get(day);
        rcRow[day] = t ? `<div class="bg-cyan px-1 py-1 text-white rounded-md mt-1 text-center">${t}</div>` : '';
      }
      data.push(rcRow);

      pushBlank();

      // Group rows
      interface GroupMeta { memberRtIds: bigint[]; groupRooms: any[]; blocked: Map<string, number>; ooo: Map<string, number>; cellValue: Map<string, number>; }
      const groupMeta = new Map<number, GroupMeta>();
      let totalRoomAll = 0;
      for (const gt of groupingTypes) {
        const memberRtIds = membersByGroup.get(gt.id) || [];
        const groupRooms = rooms.filter((r: any) => memberRtIds.includes(r.room_type_id));
        const totalRoom = groupRooms.length;
        totalRoomAll += totalRoom;
        const meta: GroupMeta = { memberRtIds, groupRooms, blocked: new Map(), ooo: new Map(), cellValue: new Map() };
        const row: any = { id: Number(gt.id), name: gt.name, total: totalRoom };
        for (const day of dayList) {
          const blockedIds = availByKey.get(day)?.filter((rid) => groupRooms.some((gr: any) => Number(gr.id) === rid)) || [];
          row.blocked = row.blocked || {};
          row.blocked_room_names = row.blocked_room_names || {};
          row.out_of_order = row.out_of_order || {};
          row.room_sold = row.room_sold || {};
          meta.blocked.set(day, blockedIds.length);
          row.blocked[day] = blockedIds.length;
          row.blocked_room_names[day] = blockedIds.map((rid) => roomsById.get(BigInt(rid))?.name).filter(Boolean).join(', ');
          const oooCount = groupRooms.filter((gr: any) => gr.room_status === 4).length;
          meta.ooo.set(day, oooCount);
          row.out_of_order[day] = oooCount;
          const roomSold = reservationRows.filter((r: any) =>
            fmt(r.date) === day && memberRtIds.includes(r.room_type_id) && folioStatus(r) !== 2 && folioStatus(r) !== 5
          ).length;
          row.room_sold[day] = roomSold;
          const overbooking = memberRtIds.reduce((acc, rtId) => acc + (obByKey.get(day + ':' + String(rtId)) || 0), 0);
          meta.cellValue.set(day, totalRoom + overbooking);
          row[day] = totalRoom + overbooking;
        }
        data.push(row);
        groupMeta.set(Number(gt.id), meta);
      }

      for (let i = 0; i < 3; i++) pushBlank();

      // Total Room
      const totalRow: any = { id: 0, name: 'Total Room', total: '' };
      for (const day of dayList) totalRow[day] = totalRoomAll;
      data.push(totalRow);

      // Room Sold (folio != cancel only)
      const resNotCancel = reservationRows.filter((r: any) => folioStatus(r) !== 2);
      const soldCount = (day: string) => resNotCancel.filter((r: any) =>
        fmt(r.date) === day && r.room_id != null && pluckRoomSet.has(Number(r.room_id))
      ).length;
      const soldRow: any = { id: 0, name: 'Room Sold', total: '' };
      for (const day of dayList) soldRow[day] = soldCount(day);
      data.push(soldRow);

      // Out of Order
      const isOooStrict = (w: any, day: string): boolean => {
        const s = w.start_date ? fmt(w.start_date) : null;
        const e = w.end_date ? fmt(w.end_date) : null;
        if (!s || s > day) return false;
        return e == null || e > day;
      };
      const oooCount = (day: string) => workOrderRows.filter((w: any) => isOooStrict(w, day)).length;
      const oooRow: any = { id: 0, name: 'Out of Order', total: '' };
      for (const day of dayList) oooRow[day] = oooCount(day);
      data.push(oooRow);

      // Blocked
      const blockCount = (day: string) => (availByKey.get(day) || []).filter((rid) => pluckRoomSet.has(rid)).length;
      const blockRow: any = { id: 0, name: 'Blocked', total: '' };
      for (const day of dayList) blockRow[day] = blockCount(day);
      data.push(blockRow);

      // Available Room (Laravel quirk: OOO here uses end_date >= day)
      const isOooLoose = (w: any, day: string): boolean => {
        const s = w.start_date ? fmt(w.start_date) : null;
        const e = w.end_date ? fmt(w.end_date) : null;
        if (!s || s > day) return false;
        return e == null || e >= day;
      };
      const availRow: any = { id: 0, name: 'Available Room', total: '' };
      for (const day of dayList) {
        availRow[day] = totalRoomAll - soldCount(day)
          - workOrderRows.filter((w: any) => isOooLoose(w, day)).length
          - blockCount(day);
      }
      data.push(availRow);

      // Allotment Setup "x/y"
      const setupCount = (day: string) => sumAllotmentData(allotmentRows.filter((ra: any) =>
        fmt(ra.allotments.start_date) <= day && fmt(ra.allotments.end_date) >= day));
      const usedCount = (day: string) => folioAllotmentRows.filter((f: any) =>
        fmt(f.check_in_date) <= day && fmt(f.check_out_date) >= day)
        .reduce((acc: number, f: any) => acc + (Math.round((new Date(fmt(f.check_out_date)).getTime() - new Date(fmt(f.check_in_date)).getTime()) / 86400000) + 1), 0);
      const setupRow: any = { id: 0, name: 'Allotment Setup', total: '' };
      for (const day of dayList) setupRow[day] = setupCount(day) + '/' + usedCount(day);
      data.push(setupRow);

      // Allotment Used
      const usedRow: any = { id: 0, name: 'Allotment Used', total: '' };
      for (const day of dayList) usedRow[day] = usedCount(day);
      data.push(usedRow);

      // Allotment Expired
      const expiredCount = sumAllotmentData(allotmentExpiredRows);
      const expiredRow: any = { id: 0, name: 'Allotment Expired', total: '' };
      for (const day of dayList) expiredRow[day] = expiredCount;
      data.push(expiredRow);

      // Allotment Available
      const allotAvailRow: any = { id: 0, name: 'Allotment Available', total: '' };
      for (const day of dayList) allotAvailRow[day] = setupCount(day);
      data.push(allotAvailRow);

      // Occupancy rows (property-wide active rooms)
      const totalRoomsProp = rooms.length;
      const totalRoomsNoOoo = rooms.filter((r: any) => r.room_status !== 4).length;
      const occupancyRow: any = { id: 0, name: 'Occupancy', total: '' };
      for (const day of dayList) occupancyRow[day] = getOccupancy(totalRoomsProp, soldCount(day));
      data.push(occupancyRow);

      const occupancyOooRow: any = { id: 0, name: 'Occupancy with OOO', total: '' };
      for (const day of dayList) occupancyOooRow[day] = getOccupancy(totalRoomsNoOoo, soldCount(day));
      data.push(occupancyOooRow);

      // Occupancy ext GPT — exclude GIT+pending
      const soldGptCount = (day: string) => resNotCancel.filter((r: any) => {
        if (fmt(r.date) !== day || r.room_id == null || !pluckRoomSet.has(Number(r.room_id))) return false;
        const t = r.folios?.type_reservation;
        return (t === 'git' && folioStatus(r) !== 5) || t !== 'git';
      }).length;
      const occupancyGptRow: any = { id: 0, name: 'Occupancy ext GPT', total: '' };
      for (const day of dayList) occupancyGptRow[day] = getOccupancy(totalRoomsProp, soldGptCount(day));
      data.push(occupancyGptRow);

      // Total Arrivals Pax
      const arrivalsPaxRow: any = { id: 0, name: 'Total Arrivals Pax', total: '' };
      for (const day of dayList) {
        const rowsD = resNotCancel.filter((r: any) =>
          fmt(r.folios?.check_in_date) === day && r.room_id != null && pluckRoomSet.has(Number(r.room_id)));
        const uniqFolio = [...new Set(rowsD.map((r: any) => String(r.folio_id)))];
        arrivalsPaxRow[day] = uniqFolio.reduce((acc, fid) => {
          const r: any = reservationRows.find((x: any) => String(x.folio_id) === fid);
          return acc + (r.adult || 0) + (r.child || 0);
        }, 0);
      }
      data.push(arrivalsPaxRow);

      // Total Departures Pax (PHP quirk preserved: adult ?? (0 + child ?? 0))
      const departureFolios = await prisma.folios.findMany({
        where: { property_id: pid, deleted_at: null, check_out_date: { gte: start, lte: end }, status_reservation: { not: 2 } },
        select: { check_out_date: true, reservations: { select: { adult: true, child: true }, take: 1, orderBy: { id: 'asc' } } },
      });
      const depPaxRow: any = { id: 0, name: 'Total Departures Pax', total: '' };
      for (const day of dayList) {
        depPaxRow[day] = departureFolios.filter((f: any) => fmt(f.check_out_date) === day).reduce((acc: number, f: any) => {
          const first: any = f.reservations?.[0];
          const a = first?.adult;
          return acc + (a != null ? a : (first?.child || 0));
        }, 0);
      }
      data.push(depPaxRow);

      // Total Arrivals Rooms
      const arrRoomRow: any = { id: 0, name: 'Total Arrivals Rooms', total: '' };
      for (const day of dayList) {
        arrRoomRow[day] = resNotCancel.filter((r: any) =>
          fmt(r.folios?.check_in_date) === day && fmt(r.date) === day && pluckRoomSet.has(Number(r.room_id))).length;
      }
      data.push(arrRoomRow);

      // Total Departures Rooms
      const depRoomRow: any = { id: 0, name: 'Total Departures Rooms', total: '' };
      for (const day of dayList) {
        depRoomRow[day] = departureFolios.filter((f: any) => fmt(f.check_out_date) === day).length;
      }
      data.push(depRoomRow);

      // ── Tooltip pass (Laravel :2291-2389) ──
      for (const item of data) {
        item.double_click_action = {};
        for (const day of dayList) {
          item.double_click_action[day] = [
            { id: item.id, type: 'form', key: 'daily_rate_code', date: day, label: 'Daily Rate Code', endpoint: '/cms/statistic/statistic-room-type/add-rate-code', form: [{ label: 'Message', key: 'text', type: 'base', type_input: 'text' }] },
            { id: item.id, type: 'form', key: 'add_message', date: day, label: 'Add Message', endpoint: '/cms/statistic/statistic-room-type/add-message', form: [{ label: 'Message', key: 'text', type: 'textarea', type_input: 'text' }] },
            { id: item.id, type: 'info', key: 'more_info', date: day, label: 'More Info', description: item[day] },
            { id: item.id, type: 'url', key: 'print', date: day, label: 'Print', url: '' },
          ];

          if (item.id > 0) {
            const meta = groupMeta.get(item.id)!;
            const dataCurrent = item[day];
            const soldRes = reservationRows.filter((r: any) =>
              meta.memberRtIds.includes(r.room_type_id) && fmt(r.date) === day &&
              folioStatus(r) !== 2 && folioStatus(r) !== 5);
            const pendingRes = reservationRows.filter((r: any) =>
              meta.memberRtIds.includes(r.room_type_id) && fmt(r.date) === day && folioStatus(r) === 5);
            const resLine = (r: any) => `Folio #${r.folios?.folio_number ?? ''} Room#${roomsById.get(r.room_id)?.name ?? 'Unassign'} IN-${fmt(r.folios?.check_in_date)} OUT-${fmt(r.folios?.check_out_date)}`;
            let description = `Room Type Group ${item.name} on ${new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/,/g, '')}<br>`;
            const available = Number(dataCurrent) - soldRes.length - (meta.blocked.get(day) || 0) - (meta.ooo.get(day) || 0);
            description += `Available Room = ${available}<br>`;
            description += `Rooms Sold = ${soldRes.length}<br>`;
            description += `Blocked Room = ${meta.blocked.get(day) || 0}<br>`;
            description += `Out of Order = ${meta.ooo.get(day) || 0}<br>`;
            description += '<br>';
            description += 'Reserved Room: <br>';
            description += soldRes.map(resLine).join('<br>');
            description += '<br>';
            description += 'Pending Reservation: <br>';
            description += pendingRes.map(resLine).join('<br>');
            item[day] = getTooltip(description, available);
          } else {
            item[day] = getTooltip(item[day]);
          }
        }
      }

      success(res, bigintToNumber(data), 'Data has been loaded', 200, {
        table,
        permission: getPermissionFlags(req.user, 1141),
        pagination: laravelPaging(data.length, 9999, 1),
      } as any);
    } catch (err: any) { console.error('Statistic room type grouping error:', err); error(res, 'Failed to load statistic grouping', 500); }
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      };
success(res, null, 'Success', 200, meta);
    } catch (err: any) { console.error('Room statistic grid error:', err); error(res, 'Failed to load room statistic', 500); }
  }

  // Laravel: StatisticController@getFolioDetail (cms.php route statistic/room-availability/folio/{folioNumber})
  static async getFolioDetail(req: Request, res: Response): Promise<void> {
    try {
      const folioNumber = String(req.params.folioNumber ?? '').trim();
      const folio = await prisma.folios.findFirst({
        where: { folio_number: folioNumber, deleted_at: null },
      });
      if (!folio) { error(res, 'Folio tidak ditemukan: ' + folioNumber, 404); return; }

      const reservation = await prisma.reservations.findFirst({
        where: { folio_id: folio.id, deleted_at: null },
        orderBy: { check_in_date: 'desc' },
      });
      if (!reservation) { error(res, 'Reservation tidak ditemukan untuk folio: ' + folioNumber, 404); return; }

      const firstName = String(folio.first_name ?? '').trim();
      const lastName = String(folio.last_name ?? '').trim();
      let guestName = `${firstName} ${lastName}`.trim();
      const companyName = String(folio.company_name ?? 'N/A');

      if (!guestName && folio.guest_profile_id) {
        const guestProfile = await prisma.guest_profiles.findFirst({
          where: { id: folio.guest_profile_id, deleted_at: null },
        });
        if (guestProfile) {
          guestName = `${String(guestProfile.first_name ?? '').trim()} ${String(guestProfile.last_name ?? '').trim()}`.trim();
        }
      }

      const statusMap: Record<number, string> = {
        0: 'Check-In', 1: 'Check-Out', 2: 'Cancelled', 3: 'Reservation', 4: 'In House', 5: 'Pending',
      };

      let rateName = reservation.rate_name ?? null;
      if (rateName === null && reservation.rate_id) {
        const rate = await prisma.rates.findFirst({
          where: { id: reservation.rate_id, deleted_at: null, property_id: folio.property_id ?? undefined },
        });
        rateName = rate?.name ?? null;
      }

      success(res, {
        folio_number: folio.folio_number,
        guest_name: guestName || '-',
        company_name: companyName.toUpperCase() || '-',
        rate_name: rateName ?? '-',
        check_in_date: reservation.check_in_date ?? '-',
        check_out_date: reservation.check_out_date ?? '-',
        room_name: reservation.room_name ?? '-',
        status: statusMap[folio.status_reservation ?? 0] ?? 'Unknown',
        type_reservation: String(folio.type_reservation ?? '').toUpperCase() || '-',
      });
    } catch (err: any) {
      console.error('getFolioDetail error:', err);
      error(res, 'getFolioDetail error: ' + (err?.message ?? 'unknown'), 500);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Room availability mutations (Laravel StatisticController.php:538-703)
  // ─────────────────────────────────────────────────────────────────────────────

  static async updateRoomAvailability(req: Request, res: Response): Promise<void> {
    try {
      const pid = Number(req.user?.lastProperty ?? 0);
      const roomId = Number(Array.isArray(req.params.room) ? req.params.room[0] : req.params.room);
      const body = req.body || {};

      // Body keys that parse as dates -> values 'vacant'|'blocked'
      const dateEntries = Object.entries(body).filter(
        ([k, v]) => /^\d{4}-\d{2}-\d{2}/.test(k) && typeof v === 'string' && ['vacant', 'blocked'].includes(v as string)
      ) as [string, string][];

      if (dateEntries.length > 0) {
        const dates = dateEntries.map(([k]) => new Date(`${(k as string).substring(0, 10)}T00:00:00.000Z`));
        const conflict = await prisma.reservations.findFirst({
          where: {
            room_id: roomId,
            deleted_at: null,
            date: { gte: dates[0], lte: dates[dates.length - 1] },
            folios: { is: { status_reservation: { not: 2 }, deleted_at: null } }, // not cancel
          },
        });
        if (conflict) {
          res.status(400).json({ code: 400, message: 'Cannot update room availability, because there is a reservation on the date' });
          return;
        }
      }

      for (const [key, value] of dateEntries) {
        const dayStart = new Date(`${key.substring(0, 10)}T00:00:00.000Z`);
        const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
        const existing = await prisma.room_availabilities.findFirst({
          where: { room_id: roomId, date: { gte: dayStart, lt: dayEnd }, deleted_at: null },
        });
        if (existing && value === 'vacant') {
          await prisma.room_availabilities.update({ where: { id: existing.id }, data: { deleted_at: new Date() } });
        } else if (!existing && value === 'blocked') {
          await prisma.room_availabilities.create({
            data: { property_id: pid, room_id: roomId, date: dayStart, status: BigInt(1), reason: (body as any).reason ?? null },
          });
        }
      }

      success(res, body, 'Data has been updated', 200);
    } catch (err: any) {
      console.error('updateRoomAvailability error:', err);
      error(res, 'Failed to update room availability', 500);
    }
  }

  static async updateRoomAvailabilityBulk(req: Request, res: Response): Promise<void> {
    try {
      const pid = Number(req.user?.lastProperty ?? 0);
      const roomId = Number(Array.isArray(req.params.room) ? req.params.room[0] : req.params.room);
      const { start_date, end_date, room_status, reason } = req.body || {};
      const value = room_status?.value;
      if (!start_date || !end_date || !value || !['vacant', 'blocked'].includes(value) || !reason) {
        res.status(400).json({ code: 400, message: 'start_date, end_date, room_status.value (vacant|blocked) and reason are required' });
        return;
      }
      const start = new Date(`${String(start_date).substring(0, 10)}T00:00:00.000Z`);
      const end = new Date(`${String(end_date).substring(0, 10)}T00:00:00.000Z`);
      const nights = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      // Reservation conflict guard
      const conflict = await prisma.reservations.findFirst({
        where: {
          room_id: roomId,
          deleted_at: null,
          date: { gte: start, lte: end },
          folios: { is: { status_reservation: { not: 2 }, deleted_at: null } },
        },
      });
      if (conflict) {
        res.status(400).json({ code: 400, message: 'Cannot update room availability, because there is a reservation on the date' });
        return;
      }

      const businessDate = await AuthController.getBusinessDate(BigInt(pid));
      const bDate = new Date(`${businessDate}T00:00:00.000Z`);
      const room = await prisma.rooms.findUnique({ where: { id: roomId } });

      const uniqueCode = Buffer.from(new Date().toISOString().replace(/[-:TZ.]/g, '').substring(0, 14)).toString('base64');
      const dataBlock: any[] = [];
      const dataVacant: number[] = [];

      for (let i = 0; i <= nights; i++) {
        const day = new Date(start); day.setDate(day.getDate() + i);
        const existing = await prisma.room_availabilities.findFirst({
          where: { room_id: roomId, date: { gte: day, lt: new Date(day.getTime() + 86400000) }, deleted_at: null },
        });

        if (bDate.getTime() === day.getTime() && room) {
          if (room.room_status !== ROOM_STATUSES.vacant.id && value === 'blocked') {
            res.status(400).json({ code: 400, message: 'Room status is not vacant' });
            return;
          }
          if (value === 'blocked') {
            await prisma.rooms.update({ where: { id: room.id }, data: { room_status: ROOM_STATUSES.block.id } });
          } else {
            await prisma.rooms.update({ where: { id: room.id }, data: { room_status: ROOM_STATUSES.vacant.id, maid_status: MAID_STATUSES.dirty.id } });
          }
        }

        if (value === 'vacant' && existing) {
          dataVacant.push(existing.id);
        } else if (value === 'blocked') {
          dataBlock.push({ property_id: pid, room_id: roomId, date: day, status: BigInt(1), reason, uniqueCode });
        }
      }

      if (dataVacant.length > 0) {
        await prisma.room_availabilities.updateMany({ where: { id: { in: dataVacant } }, data: { deleted_at: new Date() } });
      }
      if (dataBlock.length > 0) {
        await prisma.room_availabilities.deleteMany({ where: { room_id: roomId, date: { gte: start, lte: end } } });
        await prisma.room_availabilities.createMany({ data: dataBlock });
      }

      success(res, null, 'Data has been updated', 200, undefined);
      void value;
    } catch (err: any) {
      console.error('updateRoomAvailabilityBulk error:', err);
      error(res, 'Failed to bulk-update room availability', 500);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drag & drop room move (Laravel StatisticController.php:736-1017)
  // ─────────────────────────────────────────────────────────────────────────────

  private static safeParseDate(value: any): Date | null {
    if (value === undefined || value === null || value === '' || value === '-') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  static async previewDragRoomAvailability(req: Request, res: Response): Promise<void> {
    try {
      const folioIdInput = String(req.body?.folioId ?? '').trim();
      const folioNumber = /^\d+$/.test(folioIdInput) ? `F${folioIdInput}` : folioIdInput;

      const folio: any = await prisma.folios.findFirst({ where: { folio_number: folioNumber, deleted_at: null } });
      if (!folio) { res.status(404).json({ code: 404, message: `Folio not found: ${folioNumber}` }); return; }

      const toRoomName = String(req.body?.toRoom ?? '').trim();
      const targetRoom = await prisma.rooms.findFirst({ where: { name: toRoomName, deleted_at: null } });
      if (!targetRoom) { res.status(400).json({ code: 400, message: `Target room not found: ${req.body?.toRoom}` }); return; }

      const reservation: any = await prisma.reservations.findFirst({
        where: { folio_id: folio.id, deleted_at: null },
        orderBy: { check_in_date: 'asc' },
      });
      if (!reservation) { res.status(404).json({ code: 404, message: 'Reservation not found' }); return; }

      const oldCheckIn = StatisticController.safeParseDate(reservation.check_in_date);
      const oldCheckOut = StatisticController.safeParseDate(reservation.check_out_date);
      if (!oldCheckIn || !oldCheckOut) {
        res.status(400).json({ code: 400, message: 'Reservation has invalid check-in or check-out date in database' });
        return;
      }

      const newCheckIn = StatisticController.safeParseDate(req.body?.checkInDate);
      const newCheckOut = StatisticController.safeParseDate(req.body?.checkOutDate);
      if (!newCheckIn) { res.status(400).json({ code: 400, message: `Invalid checkInDate: ${req.body?.checkInDate}` }); return; }
      if (!newCheckOut) { res.status(400).json({ code: 400, message: `Invalid checkOutDate: ${req.body?.checkOutDate}` }); return; }
      if (newCheckIn >= newCheckOut) { res.status(400).json({ code: 400, message: 'checkInDate must be before checkOutDate' }); return; }

      const night = Math.round((newCheckOut.getTime() - newCheckIn.getTime()) / (1000 * 60 * 60 * 24));
      const warnings: string[] = [];

      let isSubfolio = false;
      let parentData: any = null;
      if (String(folio.type_reservation ?? '').toLowerCase() === 'git' && Number(folio.parent) !== 0) {
        isSubfolio = true;
        const parent: any = await prisma.folios.findFirst({ where: { id: folio.parent } });
        if (parent) {
          parentData = {
            parent_check_in: parent.check_in_date,
            parent_check_out: parent.check_out_date,
            parent_folio: parent.folio_number,
          };
          const pIn = StatisticController.safeParseDate(parent.check_in_date);
          const pOut = StatisticController.safeParseDate(parent.check_out_date);
          if (pIn && pOut && (newCheckIn < pIn || newCheckOut > pOut)) {
            warnings.push('Subfolio stay cannot exceed parent folio stay period');
          }
        }
      }

      const conflict = await prisma.reservations.findFirst({
        where: {
          room_id: targetRoom.id,
          deleted_at: null,
          folio_id: { not: folio.id },
          check_in_date: { lt: newCheckOut },
          check_out_date: { gt: newCheckIn },
          folios: { is: { status_reservation: { notIn: [1, 2] }, deleted_at: null } }, // not checked-out / cancelled
        },
      });
      if (conflict) warnings.push('Target room already occupied on those dates');

      const guestName = `${folio.first_name ?? ''} ${folio.last_name ?? ''}`.trim();

      res.json({
        code: 200,
        data: {
          folio_id: Number(folio.id),
          folio_number: folio.folio_number,
          guest_name: guestName || '-',
          type_reservation: String(folio.type_reservation ?? '').toUpperCase(),
          from_room: req.body?.fromRoom,
          to_room: req.body?.toRoom,
          old_check_in: oldCheckIn.toISOString().substring(0, 10),
          old_check_out: oldCheckOut.toISOString().substring(0, 10),
          new_check_in: newCheckIn.toISOString().substring(0, 10),
          new_check_out: newCheckOut.toISOString().substring(0, 10),
          night,
          is_subfolio: isSubfolio,
          parent: parentData,
          can_move: warnings.length === 0,
          warnings,
        },
      });
    } catch (err: any) {
      console.error('previewDragRoomAvailability error:', err);
      error(res, err?.message ?? 'preview drag failed', 500);
    }
  }

  static async dragRoomAvailability(req: Request, res: Response): Promise<void> {
    try {
      const { toRoom, folioId, checkInDate, checkOutDate } = req.body || {};
      if (!toRoom || !folioId || !checkInDate || !checkOutDate) {
        res.status(400).json({ code: 400, message: 'toRoom, toDate, folioId, checkInDate and checkOutDate are required' });
        return;
      }
      const folioIdInput = String(folioId).trim();
      const folioNumber = /^\d+$/.test(folioIdInput) ? `F${folioIdInput}` : folioIdInput;

      const folio: any = await prisma.folios.findFirst({ where: { folio_number: folioNumber, deleted_at: null } });
      if (!folio) { res.status(404).json({ code: 404, message: `Folio tidak ditemukan: ${folioNumber}` }); return; }

      // Status guard — only pure Reservation/Pending may move (Laravel :903-917)
      const activeReservation: any = await prisma.reservations.findFirst({
        where: { folio_id: folio.id, deleted_at: null },
        orderBy: { id: 'desc' },
      });
      const st = activeReservation?.status_reservation;
      if ([0, 1].includes(st)) {
        res.status(400).json({
          code: 400,
          message: `Move Reservation only allowed in Reservation status (current: ${STATUS_RESERVATION_MAP[st] ?? st})`,
        });
        return;
      }

      const targetRoom = await prisma.rooms.findFirst({ where: { name: String(toRoom).trim(), deleted_at: null } });
      if (!targetRoom) { res.status(404).json({ code: 404, message: `Room tujuan tidak ditemukan: ${toRoom}` }); return; }

      const newCheckIn = StatisticController.safeParseDate(checkInDate);
      const newCheckOut = StatisticController.safeParseDate(checkOutDate);
      if (!newCheckIn) { res.status(400).json({ code: 400, message: `Invalid checkInDate: ${checkInDate}` }); return; }
      if (!newCheckOut) { res.status(400).json({ code: 400, message: `Invalid checkOutDate: ${checkOutDate}` }); return; }
      if (newCheckIn >= newCheckOut) { res.status(400).json({ code: 400, message: 'Check In Date harus kurang dari Check Out Date' }); return; }

      const conflict = await prisma.reservations.findFirst({
        where: {
          room_id: targetRoom.id,
          deleted_at: null,
          folio_id: { not: folio.id },
          check_in_date: { lt: newCheckOut },
          check_out_date: { gt: newCheckIn },
          folios: { is: { status_reservation: { notIn: [1, 2] }, deleted_at: null } },
        },
      });
      if (conflict) { res.status(409).json({ code: 409, message: 'Room sudah terisi pada rentang tanggal tersebut' }); return; }

      const latestReservation: any = await prisma.reservations.findFirst({
        where: { folio_id: folio.id, deleted_at: null },
        orderBy: { id: 'desc' },
      });
      if (!latestReservation) { res.status(404).json({ code: 404, message: 'Tidak ada reservation di folio' }); return; }

      await prisma.$transaction(async (tx: any) => {
        // Delete existing reservations for this folio (soft delete, Laravel :973-975)
        await tx.reservations.updateMany({
          where: { folio_id: folio.id, deleted_at: null },
          data: { deleted_at: new Date(), deleted_by: req.user?.id ?? null },
        });

        // Rebuild per-night rows in the target room with pricing (saveReservation parity)
        const nights = Math.max(1, Math.round((newCheckOut.getTime() - newCheckIn.getTime()) / (1000 * 60 * 60 * 24)));
        const rateIdBig = latestReservation.rate_id ? BigInt(latestReservation.rate_id) : null;
        const rateRow = rateIdBig ? await tx.rates.findUnique({ where: { id: rateIdBig }, select: { code_post_id: true } }) : null;
        const rateCodePost = rateRow?.code_post_id ? await tx.code_posts.findUnique({ where: { id: rateRow.code_post_id } }) : null;
        const property = await tx.properties.findUnique({ where: { id: folio.property_id }, select: { is_tax: true } });
        const isTax = (property as any)?.is_tax === 1;

        for (let i = 0; i < nights; i++) {
          const nightDate = new Date(newCheckIn); nightDate.setDate(nightDate.getDate() + i);
          const pricing = await priceNightPublic(tx, {
            rateId: rateIdBig,
            roomTypeId: targetRoom.room_type_id,
            night: nightDate,
            getNight: nights,
            adult: Number(latestReservation.adult || 1),
            child: Number(latestReservation.child || 0),
            isTax,
            rateCodePost,
          });
          await tx.reservations.create({
            data: {
              property_id: folio.property_id,
              folio_id: folio.id,
              rate_id: rateIdBig,
              room_type_id: targetRoom.room_type_id,
              room_id: targetRoom.id,
              eta: latestReservation.eta,
              etd: latestReservation.etd,
              adult: latestReservation.adult || 1,
              child: latestReservation.child || 0,
              add_bed: latestReservation.add_bed || 0,
              check_in_date: newCheckIn,
              check_out_date: newCheckOut,
              date: nightDate,
              status_reservation: latestReservation.status_reservation,
              status: latestReservation.status,
              night: nights,
              amount: pricing.amount,
              amountt: pricing.amount,
              total: pricing.total,
              service_charge: pricing.service_charge,
              pb1: pricing.pb1,
              tax3: pricing.tax3,
              created_by: req.user?.id ?? null,
            },
          });
        }
      });

      res.json({ code: 200, message: `Reservation berhasil dipindahkan ke ${String(toRoom).trim()}` });
    } catch (err: any) {
      console.error('dragRoomAvailability error:', err);
      error(res, err?.message ?? 'drag failed', 500);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // statistic-room-type detail / add-message / add-rate-code (Laravel :2412-2550)
  // ─────────────────────────────────────────────────────────────────────────────

  static async statisticsRoomTypeMouseOver(req: Request, res: Response): Promise<void> {
    try {
      const { room_type_id, date } = req.body || {};
      if (!room_type_id || !date) { res.status(400).json({ code: 400, message: 'room_type_id and date are required' }); return; }

      const roomType: any = await prisma.room_types.findUnique({ where: { id: BigInt(room_type_id) }, include: { rooms: true } });
      if (!roomType) { res.status(400).json({ code: 400, message: 'Room Type not found' }); return; }

      const dayStart = new Date(`${String(date).substring(0, 10)}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      const roomIds = roomType.rooms.map((r: any) => r.id);

      const reservations: any[] = await prisma.reservations.findMany({
        where: {
          date: { gte: dayStart, lt: dayEnd },
          room_type_id: roomType.id,
          deleted_at: null,
          folios: { is: { status_reservation: { not: 2 }, deleted_at: null } },
        },
        include: { folios: { select: { folio_number: true, status_reservation: true } }, rooms: { select: { name: true } } },
      });

      const totalRoom = roomType.rooms.length;
      const totalRoomSold = reservations.length;
      const soldForOccupancy = reservations.filter((r: any) => r.folios?.status_reservation !== 5).length;
      const occupancyPct = ((soldForOccupancy / (totalRoom <= 0 ? 1 : totalRoom)) * 100).toFixed(4);

      const oooRoom = await prisma.work_orders.count({
        where: { start_date: { lte: dayStart }, OR: [{ end_date: null }, { end_date: { gte: dayStart } }], room_id: { in: roomIds }, deleted_at: null },
      });
      const blockRoom = await prisma.room_availabilities.count({
        where: { date: { gte: dayStart, lt: dayEnd }, room_id: { in: roomIds }, deleted_at: null },
      });

      const listFolio = reservations.map((item: any) => ({
        folio_number: item.folios?.folio_number ?? null,
        room_id: item.rooms?.name ?? null,
      }));

      res.json({
        data: {
          name: `${roomType.name} on ${dayStart.toISOString().substring(0, 10)}`,
          total_room: totalRoom,
          total_room_sold: totalRoomSold,
          block_room: blockRoom,
          ooo_room: oooRoom,
          total_allotment: 0,
          total_allotment_used: 0,
          occupancy: `${Number(occupancyPct)}%`,
          list_folio: listFolio,
        },
        code: 200,
        message: 'Data has been loaded',
      });
    } catch (err: any) {
      console.error('statisticsRoomTypeMouseOver error:', err);
      error(res, err?.message ?? 'mouseover failed', 500);
    }
  }

  static async statisticsRoomTypeAddMessage(req: Request, res: Response): Promise<void> {
    try {
      const { date } = req.body || {};
      if (!date) { res.status(400).json({ code: 400, message: 'The date field is required.' }); return; }
      const pid = Number(req.user?.lastProperty ?? 0);
      const text = String(req.body?.form?.text ?? '');
      const dayStart = new Date(`${String(date).substring(0, 10)}T00:00:00.000Z`);

      const existing = await prisma.statistic_messages.findFirst({ where: { date: dayStart, property_id: pid } });
      let row;
      if (!existing) {
        row = await prisma.statistic_messages.create({ data: { date: dayStart, text, property_id: pid } });
      } else {
        row = await prisma.statistic_messages.update({ where: { id: existing.id }, data: { text } });
      }
      res.json({ data: row, code: 200, message: 'Data has been saved' });
    } catch (err: any) {
      console.error('statisticsRoomTypeAddMessage error:', err);
      error(res, err?.message ?? 'add message failed', 500);
    }
  }

  static async statisticsRoomTypeAddRateCode(req: Request, res: Response): Promise<void> {
    try {
      const { date } = req.body || {};
      if (!date) { res.status(400).json({ code: 400, message: 'The date field is required.' }); return; }
      const pid = Number(req.user?.lastProperty ?? 0);
      const text = String(req.body?.form?.text ?? '');
      const dayStart = new Date(`${String(date).substring(0, 10)}T00:00:00.000Z`);

      const existing = await prisma.statistic_rate_codes.findFirst({ where: { date: dayStart, property_id: pid } });
      let row;
      if (!existing) {
        row = await prisma.statistic_rate_codes.create({ data: { date: dayStart, text, property_id: pid } });
      } else {
        row = await prisma.statistic_rate_codes.update({ where: { id: existing.id }, data: { text } });
      }
      res.json({ data: row, code: 200, message: 'Data has been saved' });
    } catch (err: any) {
      console.error('statisticsRoomTypeAddRateCode error:', err);
      error(res, err?.message ?? 'add rate-code failed', 500);
    }
  }
}

