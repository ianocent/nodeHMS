import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { calculateCodePost } from '../utils/cmsConfig';
import { occupancyPrice } from '../utils/reservationPricing';
import { StaahService } from '../services/staah.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const staahService = new StaahService();

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
    return out;
  }
  return val;
}

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function buildAriPayload(interface_: any, dateFrom: string, dateTo: string): Promise<any[]> {
  const roomMappings = await prisma.staah_room_mappings.findMany({
    where: { staah_interface_id: interface_.id, deleted_at: null, status: 'active' },
  });
  const rateMappings = await prisma.staah_rate_mappings.findMany({
    where: { staah_interface_id: interface_.id, deleted_at: null, status: 'active' },
  });
  if (!roomMappings.length || !rateMappings.length) return [];

  // Rate -> its own code_post drives the pushed price (Laravel SyncPriceStaah uses
  // Folio::getReservation totals = net after code_post tax/service/pb1 calc), NOT raw rate_rates.
  const rateIds = [...new Set(rateMappings.map((rtm: any) => rtm.rate_id))];
  const rateRows = await prisma.rates.findMany({
    where: { id: { in: rateIds } },
    select: { id: true, code_post_id: true },
  });
  const codePostByRate = new Map<number, any>();
  const cpIds = [...new Set(rateRows.map((r: any) => r.code_post_id).filter(Boolean))] as bigint[];
  if (cpIds.length) {
    const cps = await prisma.code_posts.findMany({ where: { id: { in: cpIds } } });
    const cpById = new Map(cps.map((c: any) => [Number(c.id), c]));
    for (const r of rateRows) codePostByRate.set(Number(r.id), cpById.get(Number(r.code_post_id)) ?? null);
  }
  const property = await prisma.properties.findUnique({ where: { id: interface_.property_id }, select: { is_tax: true } });
  const isTax = (property as any)?.is_tax === 1;

  const todayStr = formatDate(new Date());

  const roomByType = new Map(roomMappings.map((rm: any) => [rm.room_type_id, rm]));

  // Room stock = active physical rooms per room type (Laravel `roomstosell`)
  const roomCountByType = new Map<number, number>();
  for (const rm of roomMappings) {
    const cnt = await prisma.rooms.count({ where: { room_type_id: rm.room_type_id, status: 1, deleted_at: null } });
    roomCountByType.set(Number(rm.room_type_id), cnt);
  }

  // Occupancy combos from StaahRoomContentBreakdown (Laravel SyncPriceStaah:117-131);
  // fallback to the two standard points when none configured.
  const breakdowns = await prisma.staah_room_content_breakdowns.findMany({
    where: {
      property_id: interface_.property_id,
      staah_interface_id: interface_.id,
      status: 1,
      deleted_at: null,
    },
  });
  const combosByType = new Map<number, { adult: number; child: number }[]>();
  for (const b of breakdowns) {
    const list = combosByType.get(Number(b.room_type_id)) ?? [];
    list.push({ adult: Number(b.adult), child: Number(b.child) });
    combosByType.set(Number(b.room_type_id), list);
  }
  const DEFAULT_COMBOS = [{ adult: 1, child: 0 }, { adult: 2, child: 0 }];

  // Room type fallback rate (Laravel Folio::getReservation :2258-2263 — when no
  // rate_rates row / stop_sell=1 for the night, price = room_types.rate flat).
  const roomTypeRows = await prisma.room_types.findMany({
    where: { id: { in: [...roomByType.keys()] } },
    select: { id: true, rate: true },
  });
  const roomTypeRateById = new Map<number, number>(roomTypeRows.map((rt: any) => [Number(rt.id), Number(rt.rate ?? 0)]));

  function staahPrice(net: number, codePost: any): number {
    if (!codePost) return net;
    const calc = calculateCodePost(
      {
        tax: codePost.tax ?? false,
        tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
        local_tax: codePost.local_tax ?? false,
        local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
        service_charge: codePost.service_charge ?? false,
        service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
        service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
        tax_include_local_tax: codePost.tax_include_local_tax ?? false,
      },
      net,
      isTax
    );
    return Number(calc.total ?? net);
  }

  const rateByRateId = new Map(rateMappings.map((rtm: any) => [rtm.rate_id, rtm]));
  const rateRates = await prisma.rate_rates.findMany({
    where: {
      rate_id: { in: [...rateByRateId.keys()] },
      room_type_id: { in: [...roomByType.keys()] },
      date: { gte: new Date(`${dateFrom}T00:00:00Z`), lte: new Date(`${dateTo}T23:59:59Z`) },
      deleted_at: null,
    },
    orderBy: { date: 'asc' },
  });
  // Restrictions/price lookup per (room_type|rate|date) — Laravel keys RateRate rows the same way.
  const rrByKey = new Map<string, any>();
  for (const rr of rateRates) {
    rrByKey.set(`${rr.room_type_id}|${rr.rate_id}|${formatDate(rr.date)}`, rr);
  }

  const rooms: any[] = [];
  for (const [roomTypeId, roomMapping] of roomByType) {
    // Rate ids paired with this room type — derived from the rate grid itself
    // (staah_rate_mappings carry no room-type link, same as Laravel's per-rate run).
    const rateIdsForRoom = new Set<number>(
      rateRates.filter((rr: any) => rr.room_type_id === roomTypeId).map((rr: any) => Number(rr.rate_id))
    );
    if (!rateIdsForRoom.size) continue;

    const roomStock = roomCountByType.get(Number(roomTypeId)) ?? 0;
    const combos = combosByType.get(Number(roomTypeId)) ?? DEFAULT_COMBOS;
    const dates: any[] = [];
    let currentRange: any = null;

    // Every night in range is pushed (Laravel getReservation emits one row per night
    // even when the rate_rates grid has a gap -> room_types.rate fallback price).
    const startD = new Date(`${dateFrom}T00:00:00Z`);
    const endD = new Date(`${dateTo}T00:00:00Z`);
    for (let d = new Date(startD); d <= endD; d = new Date(d.getTime() + 86400000)) {
      const dateStr = formatDate(d);
      if (dateStr < todayStr) continue; // past dates never pushed

      for (const rateIdNum of rateIdsForRoom) {
        const rateMapping: any = rateByRateId.get(BigInt(rateIdNum));
        if (!rateMapping) continue;
        const rr = rrByKey.get(`${BigInt(roomTypeId)}|${BigInt(rateIdNum)}|${dateStr}`);
        const codePost = codePostByRate.get(rateIdNum) ?? null;
        const fallbackRate = roomTypeRateById.get(Number(roomTypeId)) ?? 0;

        const prices: any[] = [];
        for (const combo of combos) {
          // Laravel Folio::getReservation (:2246-2266): stop_sell=1 rows are treated as
          // missing -> room type flat rate; otherwise occupancy formula on rate_rates.
          const base = rr && !rr.stop_sell ? occupancyPrice(rr, combo.adult, combo.child) : fallbackRate;
          const total = staahPrice(base, codePost);
          if (total > 0) prices.push({ NumberOfGuests: String(combo.adult + combo.child), value: String(total) });
        }
        if (!prices.length) continue;

        const ratePlanId = rateMapping.staah_rate_plan_id;
        const closed = rr?.stop_sell ? '1' : '0';
        const minStay = String(rr?.min_night ?? 1);
        const maxStay = String(rr?.max_night ?? 99);
        const closedArrival = rr?.stop_arrival ? '1' : '0';
        const closedDeparture = rr?.stop_departure ? '1' : '0';
        const extraAdult = Number(rr?.extra_adult ?? 0).toFixed(2);
        const extraChild = Number(rr?.extra_child ?? 0).toFixed(2);
        const matchKey = JSON.stringify([prices, ratePlanId, closed, minStay, maxStay, closedArrival, closedDeparture, extraAdult, extraChild, roomStock]);

        if (currentRange === null) {
          currentRange = {
            from: dateStr, to: dateStr,
            rate: [{ rateplanid: ratePlanId }],
            price: prices, closed, minimumstay: minStay, maximumstay: maxStay,
            closedonarrival: closedArrival, closedondeparture: closedDeparture,
            extraadultrate: extraAdult, extrachildrate: extraChild,
            roomstosell: String(roomStock),
            matchKey,
          };
        } else if (currentRange.matchKey === matchKey && formatDate(new Date(new Date(currentRange.to + 'T00:00:00Z').getTime() + 86400000)) === dateStr) {
          currentRange.to = dateStr;
        } else {
          delete currentRange.matchKey;
          if (currentRange.from === currentRange.to) {
            currentRange = { value: currentRange.from, ...currentRange };
            delete currentRange.from;
            delete currentRange.to;
          }
          dates.push(currentRange);
          currentRange = {
            from: dateStr, to: dateStr,
            rate: [{ rateplanid: ratePlanId }],
            price: prices, closed, minimumstay: minStay, maximumstay: maxStay,
            closedonarrival: closedArrival, closedondeparture: closedDeparture,
            extraadultrate: extraAdult, extrachildrate: extraChild,
            roomstosell: String(roomStock),
            matchKey,
          };
        }
      }
    }
    if (currentRange !== null) {
      delete currentRange.matchKey;
      if (currentRange.from === currentRange.to) {
        currentRange = { value: currentRange.from, ...currentRange };
        delete currentRange.from;
        delete currentRange.to;
      }
      dates.push(currentRange);
    }
    if (dates.length) {
      rooms.push({ roomid: roomMapping.staah_room_id, date: dates });
    }
  }
  return rooms;
}

// ═══════════════════════════════════════════════
// STAah Interfaces CRUD
// ═══════════════════════════════════════════════

export class StaahController {
  static async interfaceList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.staah_interfaces.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_interfaces.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      console.error('Staah interface list error:', err);
      error(res, 'Failed to list interfaces', 500);
    }
  }

  static async interfaceCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { hotel_id, hotel_type, time_zone, language_code, currency_code, hotel_info, hotel_description } = req.body;

      if (!hotel_id) { badRequest(res, 'hotel_id is required'); return; }

      const existing = await prisma.staah_interfaces.findFirst({
        where: { hotel_id, deleted_at: null },
      });
      if (existing) { badRequest(res, 'hotel_id already registered'); return; }

      const result = await prisma.staah_interfaces.create({
        data: {
          property_id: pid,
          hotel_id,
          hotel_type: hotel_type || 'Hotel',
          time_zone: time_zone || 'Asia/Jakarta',
          language_code: language_code || 'en',
          currency_code: currency_code || 'IDR',
          hotel_info,
          hotel_description,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Interface created');
    } catch (err: any) {
      console.error('Staah interface create error:', err);
      error(res, 'Failed to create interface', 500);
    }
  }

  static async interfaceShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Interface not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load interface', 500);
    }
  }

  static async interfaceEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Interface not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load interface', 500);
    }
  }

  static async interfaceUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { hotel_type, time_zone, language_code, currency_code, hotel_info, hotel_description, status } = req.body;

      const existing = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Interface not found'); return; }

      const data: any = { updated_at: new Date() };
      if (hotel_type !== undefined) data.hotel_type = hotel_type;
      if (time_zone !== undefined) data.time_zone = time_zone;
      if (language_code !== undefined) data.language_code = language_code;
      if (currency_code !== undefined) data.currency_code = currency_code;
      if (hotel_info !== undefined) data.hotel_info = hotel_info;
      if (hotel_description !== undefined) data.hotel_description = hotel_description;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_interfaces.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Interface updated');
    } catch (err: any) {
      error(res, 'Failed to update interface', 500);
    }
  }

  static async interfaceDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Interface not found'); return; }
      await prisma.staah_interfaces.update({ where: { id }, data: { deleted_at: new Date(), status: 'inactive' } });
      success(res, null, 'Interface deleted');
    } catch (err: any) {
      error(res, 'Failed to delete interface', 500);
    }
  }

  static async testConnection(req: Request, res: Response): Promise<void> {
    try {
      const result = await staahService.testConnection();
      success(res, result, result.success ? 'Connection successful' : 'Connection failed');
    } catch (err: any) {
      error(res, 'STAAH connection test failed: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Room Mappings
  // ═══════════════════════════════════════════════

  static async roomMappingList(req: Request, res: Response): Promise<void> {
    try {
      const interfaceId = req.params.hotel_id ? idParam(req.params.hotel_id) : null;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null };
      if (interfaceId) where.staah_interface_id = interfaceId;

      const [data, total] = await Promise.all([
        prisma.staah_room_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { room_types: { select: { id: true, name: true } } },
        }),
        prisma.staah_room_mappings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list room mappings', 500);
    }
  }

  static async roomMappingEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.staah_room_mappings.findUnique({
        where: { id },
        include: { room_types: { select: { id: true, name: true } }, staah_interfaces: { select: { id: true, hotel_id: true } } },
      });
      if (!result) { notFound(res, 'Room mapping not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load room mapping', 500);
    }
  }

  static async roomMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { room_type_id, max_occupancy, max_child_occupancy, quantity, staah_room_id, status } = req.body;

      const existing = await prisma.staah_room_mappings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Room mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (room_type_id !== undefined) data.room_type_id = BigInt(room_type_id);
      if (max_occupancy !== undefined) data.max_occupancy = max_occupancy;
      if (max_child_occupancy !== undefined) data.max_child_occupancy = max_child_occupancy;
      if (quantity !== undefined) data.quantity = quantity;
      if (staah_room_id !== undefined) data.staah_room_id = staah_room_id;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_room_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Room mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update room mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Rate Mappings
  // ═══════════════════════════════════════════════

  static async rateMappingList(req: Request, res: Response): Promise<void> {
    try {
      const interfaceId = req.params.hotel_id ? idParam(req.params.hotel_id) : null;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null };
      if (interfaceId) where.staah_interface_id = interfaceId;

      const [data, total] = await Promise.all([
        prisma.staah_rate_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { rates: { select: { id: true, name: true } } },
        }),
        prisma.staah_rate_mappings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list rate mappings', 500);
    }
  }

  static async rateMappingEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.staah_rate_mappings.findUnique({
        where: { id },
        include: { rates: { select: { id: true, name: true } }, staah_interfaces: { select: { id: true, hotel_id: true } } },
      });
      if (!result) { notFound(res, 'Rate mapping not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load rate mapping', 500);
    }
  }

  static async rateMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { rate_id, staah_rate_plan_id, meal_plan_id, status } = req.body;

      const existing = await prisma.staah_rate_mappings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Rate mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (rate_id !== undefined) data.rate_id = BigInt(rate_id);
      if (staah_rate_plan_id !== undefined) data.staah_rate_plan_id = staah_rate_plan_id;
      if (meal_plan_id !== undefined) data.meal_plan_id = meal_plan_id;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_rate_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Rate mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update rate mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Reservations (Webhook-pulled)
  // ═══════════════════════════════════════════════

  static async reservationList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as string;

      const where: any = {};
      if (status) where.status = status;

      const [data, total] = await Promise.all([
        prisma.staah_reservations.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            staah_interfaces: { select: { hotel_id: true } },
            folios: { select: { id: true, folio_number: true, booking_no: true } },
          },
        }),
        prisma.staah_reservations.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list reservations', 500);
    }
  }

  static async reservationConfirm(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const staahRes = await prisma.staah_reservations.findUnique({ where: { id } });
      if (!staahRes) { notFound(res, 'Reservation not found'); return; }

      await prisma.staah_reservations.update({
        where: { id },
        data: { status: '1', message: 'Confirmed', updated_at: new Date() },
      });

      success(res, null, 'Reservation confirmed');
    } catch (err: any) {
      error(res, 'Failed to confirm reservation', 500);
    }
  }

  static async reservationCancel(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const staahRes = await prisma.staah_reservations.findUnique({ where: { id } });
      if (!staahRes) { notFound(res, 'Reservation not found'); return; }

      await prisma.staah_reservations.update({
        where: { id },
        data: { status: '2', message: 'Cancelled', updated_at: new Date() },
      });

      success(res, null, 'Reservation cancelled');
    } catch (err: any) {
      error(res, 'Failed to cancel reservation', 500);
    }
  }

  static async reservationPending(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const staahRes = await prisma.staah_reservations.findUnique({ where: { id } });
      if (!staahRes) { notFound(res, 'Reservation not found'); return; }

      await prisma.staah_reservations.update({
        where: { id },
        data: { status: '3', message: 'Pending Review', updated_at: new Date() },
      });

      success(res, null, 'Reservation set to pending');
    } catch (err: any) {
      error(res, 'Failed to update reservation', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Sync Logs
  // ═══════════════════════════════════════════════

  static async syncLogList(req: Request, res: Response): Promise<void> {
    try {
      const interfaceId = req.params.hotel_id ? idParam(req.params.hotel_id) : null;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = {};
      if (interfaceId) where.staah_interface_id = interfaceId;

      const [data, total] = await Promise.all([
        prisma.staah_sync_logs.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_sync_logs.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list sync logs', 500);
    }
  }

  static async syncLogRetry(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const log = await prisma.staah_sync_logs.findUnique({ where: { id } });
      if (!log) { notFound(res, 'Sync log not found'); return; }

      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id: log.staah_interface_id ? BigInt(log.staah_interface_id) : 0n } });
      if (!interface_) { error(res, 'Interface not found', 404); return; }

      const payload = log.payload ? JSON.parse(log.payload as string) : {};
      let result: any;

      switch (log.type) {
        case 'ari':
        case 'price':
          result = await staahService.storeRates(payload);
          break;
        case 'room':
          for (const room of payload.room || []) {
            result = await staahService.createUpdateDeleteRoomType(room);
          }
          break;
        case 'rate':
          for (const rate of payload.rate || []) {
            result = await staahService.createUpdateDeleteRatePlan(rate);
          }
          break;
        default:
          error(res, 'Unknown sync type for retry', 400);
          return;
      }

      const ok = String(result?.Status ?? result?.status ?? 'unknown').toLowerCase() === 'success';
      await prisma.staah_sync_logs.update({
        where: { id },
        data: {
          status: ok ? 'success' : 'failed',
          response: JSON.stringify(result),
          message: ok ? 'Retry successful' : 'Retry failed',
          synced_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, result, ok ? 'Retry successful' : 'Retry failed');
    } catch (err: any) {
      error(res, 'Retry failed: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah OTA Company Mappings
  // ═══════════════════════════════════════════════

  static async otaMappingList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        prisma.staah_ota_company_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_ota_company_mappings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list OTA mappings', 500);
    }
  }

  static async otaMappingCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { channel_id, company_profile_id, staah_interface_id } = req.body;

      if (!channel_id || !company_profile_id) {
        badRequest(res, 'channel_id and company_profile_id are required');
        return;
      }

      const result = await prisma.staah_ota_company_mappings.create({
        data: {
          property_id: pid,
          channel_id: String(channel_id),
          company_profile_id: BigInt(company_profile_id),
          staah_interface_id: staah_interface_id ? BigInt(staah_interface_id) : null,
          status: true,
        },
      });

      success(res, bigintToNumber(result), 'OTA mapping created');
    } catch (err: any) {
      console.error('OTA mapping create error:', err);
      error(res, 'Failed to create OTA mapping', 500);
    }
  }

  static async otaMappingSync(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const interface_ = await prisma.staah_interfaces.findFirst({
        where: { property_id: pid, deleted_at: null },
      });
      if (!interface_) { error(res, 'Staah interface not found', 404); return; }

      const mappings = await staahService.listingRoomType(interface_.hotel_id);
      const rates = await staahService.listingRatePlan(interface_.hotel_id);

      const staahChannels = mappings.Data?.map((r: any) => ({
        channel_id: r.ChannelID || r.channel_id || r.id,
        channel_name: r.ChannelName || r.channel_name || r.name,
      })) || [];

      const existingMappings = await prisma.staah_ota_company_mappings.findMany({
        where: { property_id: pid },
      });

      const created = [];
      for (const ch of staahChannels) {
        const exists = existingMappings.find((m: any) => m.channel_id === ch.channel_id);
        if (!exists) {
          const createdMapping = await prisma.staah_ota_company_mappings.create({
            data: {
              property_id: pid,
              channel_id: ch.channel_id,
              company_profile_id: 0n,
              staah_interface_id: interface_.id,
              status: true,
            },
          });
          created.push(bigintToNumber(createdMapping));
        }
      }

      success(res, { synced: created.length, total_channels: staahChannels.length, created }, 'OTA mappings synced');
    } catch (err: any) {
      error(res, 'OTA mapping sync failed: ' + err.message, 500);
    }
  }

  static async otaMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { company_profile_id, status } = req.body;

      const existing = await prisma.staah_ota_company_mappings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'OTA mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (company_profile_id !== undefined) data.company_profile_id = BigInt(company_profile_id);
      if (status !== undefined) data.status = Boolean(status);

      const result = await prisma.staah_ota_company_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'OTA mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update OTA mapping', 500);
    }
  }

  static async otaMappingDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.staah_ota_company_mappings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'OTA mapping not found'); return; }
      await prisma.staah_ota_company_mappings.delete({ where: { id } });
      success(res, null, 'OTA mapping deleted');
    } catch (err: any) {
      error(res, 'Failed to delete OTA mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Room Content Breakdowns
  // ═══════════════════════════════════════════════

  static async contentBreakdownList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.staah_room_content_breakdowns.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { room_types: { select: { id: true, name: true } } },
        }),
        prisma.staah_room_content_breakdowns.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list content breakdowns', 500);
    }
  }

  static async contentBreakdownCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { staah_interface_id, room_type_id, description, adult, child } = req.body;

      if (!staah_interface_id || !room_type_id || !description) {
        badRequest(res, 'staah_interface_id, room_type_id, and description are required');
        return;
      }

      const result = await prisma.staah_room_content_breakdowns.create({
        data: {
          property_id: pid,
          staah_interface_id: BigInt(staah_interface_id),
          room_type_id: BigInt(room_type_id),
          description,
          adult: adult || 0,
          child: child || 0,
        },
      });

      success(res, bigintToNumber(result), 'Content breakdown created');
    } catch (err: any) {
      error(res, 'Failed to create content breakdown', 500);
    }
  }

  static async contentBreakdownUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { description, adult, child, status } = req.body;

      const existing = await prisma.staah_room_content_breakdowns.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Content breakdown not found'); return; }

      const data: any = { updated_at: new Date() };
      if (description !== undefined) data.description = description;
      if (adult !== undefined) data.adult = adult;
      if (child !== undefined) data.child = child;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_room_content_breakdowns.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Content breakdown updated');
    } catch (err: any) {
      error(res, 'Failed to update content breakdown', 500);
    }
  }

  static async contentBreakdownDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.staah_room_content_breakdowns.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Content breakdown not found'); return; }
      await prisma.staah_room_content_breakdowns.update({
        where: { id },
        data: { deleted_at: new Date() },
      });
      success(res, null, 'Content breakdown deleted');
    } catch (err: any) {
      error(res, 'Failed to delete content breakdown', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Push/Pull/Sync Actions
  // ═══════════════════════════════════════════════

  static async syncAvailability(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const result = await staahService.listingProperty();
      success(res, result, 'Availability synced');
    } catch (err: any) {
      error(res, 'Sync failed: ' + err.message, 500);
    }
  }

  static async pullFromStaah(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const rooms = await staahService.listingRoomType(interface_.hotel_id);
      const rates = await staahService.listingRatePlan(interface_.hotel_id);

      success(res, { rooms, rates }, 'Data pulled from STAAH');
    } catch (err: any) {
      error(res, 'Pull failed: ' + err.message, 500);
    }
  }

  static async pushRoom(req: Request, res: Response): Promise<void> {
    try {
      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id: idParam(req.params.id) } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const mappings = await prisma.staah_room_mappings.findMany({
        where: { staah_interface_id: interface_.id, deleted_at: null },
        include: { room_types: true },
      });

      for (const mapping of mappings) {
        await staahService.createUpdateDeleteRoomType({
          hotelid: interface_.hotel_id,
          roomid: mapping.staah_room_id,
          room_type: (mapping as any).room_types?.name || 'Room',
          max_occupancy: mapping.max_occupancy,
          quantity: mapping.quantity,
        });
      }

      success(res, { pushed: mappings.length }, 'Room types pushed');
    } catch (err: any) {
      error(res, 'Push failed: ' + err.message, 500);
    }
  }

  static async pushRate(req: Request, res: Response): Promise<void> {
    try {
      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id: idParam(req.params.id) } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const mappings = await prisma.staah_rate_mappings.findMany({
        where: { staah_interface_id: interface_.id, deleted_at: null },
      });

      for (const mapping of mappings) {
        await staahService.createUpdateDeleteRatePlan({
          hotelid: interface_.hotel_id,
          rateplanid: mapping.staah_rate_plan_id,
          mealplanid: mapping.meal_plan_id,
        });
      }

      success(res, { pushed: mappings.length }, 'Rate plans pushed');
    } catch (err: any) {
      error(res, 'Push failed: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Master Data (config constants)
  // ═══════════════════════════════════════════════

  static async master(req: Request, res: Response): Promise<void> {
    const result = {
      meal_plans: [
        { value: 1, label: 'All inclusive' },
        { value: 2, label: 'Breakfast' },
        { value: 11, label: 'European plan' },
        { value: 15, label: 'Room only (Default)' },
      ],
      hotel_types: [
        { value: 1, label: 'Hotel' },
        { value: 2, label: 'Motel' },
        { value: 3, label: 'Vacational Rental' },
      ],
      languages: [
        { value: 'en', label: 'English' },
        { value: 'id', label: 'Bahasa Indonesia' },
      ],
      currencies: [
        { value: 'IDR', label: 'IDR' },
        { value: 'USD', label: 'USD' },
        { value: 'GBP', label: 'GBP' },
      ],
      time_zones: [
        { value: 'Asia/Jakarta', label: 'Asia/Jakarta (GMT+7)' },
        { value: 'Asia/Singapore', label: 'Asia/Singapore (GMT+8)' },
        { value: 'Europe/London', label: 'Europe/London' },
      ],
      status_reservations: [
        { value: '1', label: 'Confirmed' },
        { value: '2', label: 'Cancelled' },
        { value: '3', label: 'Pending' },
      ],
    };

    success(res, [], 'Success', 200, { master: result } as any);
  }

  // ═══════════════════════════════════════════════
  // STAah Rates Calendar (grid view)
  // ═══════════════════════════════════════════════

  static async ratesCalendar(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { date_from, date_to, room_type_id, rate_id } = req.body;
      if (!date_from || !date_to) {
        error(res, 'date_from and date_to are required', 400);
        return;
      }

      const interface_ = await prisma.staah_interfaces.findFirst({
        where: { property_id: pid, deleted_at: null },
      });
      if (!interface_) {
        error(res, 'Staah interface not found for property', 404);
        return;
      }

      const roomTypes = await prisma.room_types.findMany({
        where: { property_id: pid, deleted_at: null, status: 1 },
        ...(room_type_id ? { where: { ...{ property_id: pid, deleted_at: null, status: 1 }, id: BigInt(room_type_id) } } : {}),
        select: { id: true, name: true },
      });

      const rates = await prisma.rates.findMany({
        where: {
          property_id: pid,
          deleted_at: null,
          status: 1,
          staah: true,
          ...(rate_id ? { id: BigInt(rate_id) } : {}),
        },
        select: { id: true, name: true, code: true },
      });

      if (!roomTypes.length || !rates.length) {
        success(res, { grid: [], dates: [], roomTypes, rates }, 'No room types or rates mapped to STAAH');
        return;
      }

      const rateRates = await prisma.rate_rates.findMany({
        where: {
          rate_id: { in: rates.map((r: any) => r.id) },
          room_type_id: { in: roomTypes.map((rt: any) => Number(rt.id)) },
          date: { gte: new Date(`${date_from}T00:00:00Z`), lte: new Date(`${date_to}T23:59:59Z`) },
          deleted_at: null,
        },
        orderBy: { date: 'asc' },
      });

      const dates: string[] = [];
      const period = new Date(date_from);
      const endDate = new Date(date_to);
      while (period <= endDate) {
        dates.push(period.toISOString().split('T')[0]);
        period.setDate(period.getDate() + 1);
      }

      const grid: any[] = [];
      for (const rt of roomTypes) {
        const row: any = { room_type: { id: rt.id, name: rt.name, staah_room_id: rt.name.toLowerCase().replace(/\s+/g, '') }, rates: [] };
        for (const rate of rates) {
          const rateData: any = { rate: { id: rate.id, name: rate.name, code: rate.code || '', staah_rate_plan_id: (rate.code || rate.name || '').toLowerCase().replace(/\s+/g, '') }, dates: {} };
          for (const date of dates) {
            const rr = rateRates.find((r: any) => r.rate_id === rate.id && r.room_type_id === rt.id && r.date.toISOString().split('T')[0] === date);
            if (rr) {
              rateData.dates[date] = {
                one_adult: Number(rr.one_adult),
                two_adult: Number(rr.two_adult),
                extra_adult: Number(rr.extra_adult),
                extra_child: Number(rr.extra_child),
                stop_sell: rr.stop_sell,
                min_night: rr.min_night,
                max_night: rr.max_night,
                stop_arrival: rr.stop_arrival,
                stop_departure: rr.stop_departure,
              };
            }
          }
          row.rates.push(rateData);
        }
        grid.push(row);
      }

      success(res, { grid, dates, roomTypes, rates }, 'Rates calendar generated');
    } catch (err: any) {
      console.error('Rates calendar error:', err);
      error(res, 'Failed to generate rates calendar: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // ARI Push (Availability, Rate, Inventory)
  // ═══════════════════════════════════════════════

static async ariPush(req: Request, res: Response): Promise<void> {
  try {
    const id = idParam(req.params.id);
    const { date_from, date_to } = req.body;
    if (!date_from || !date_to) {
      error(res, 'date_from and date_to are required', 400);
      return;
    }

    const interface_ = await prisma.staah_interfaces.findUnique({ where: { id } });
    if (!interface_) { notFound(res, 'Interface not found'); return; }

    const rooms = await buildAriPayload(interface_, date_from, date_to);
    if (!rooms.length) {
      success(res, [], 'No data to push');
      return;
    }

    const payload = { hotelid: interface_.hotel_id, room: rooms };
    const result = await staahService.storeRates(payload);
    await prisma.staah_sync_logs.create({
      data: {
        staah_interface_id: interface_.id,
        type: 'ari',
        direction: 'push',
        status: String(result?.Status ?? result?.status ?? 'unknown').toLowerCase() === 'success' ? 'success' : 'failed',
        hotel_id: interface_.hotel_id,
        room_id: rooms.map((r: any) => r.roomid).join(','),
        date_from: new Date(`${date_from}T00:00:00Z`),
        date_to: new Date(`${date_to}T23:59:59Z`),
        payload: JSON.stringify(payload),
        response: JSON.stringify(result),
        synced_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    success(res, result, 'ARI pushed successfully');
  } catch (err: any) {
    error(res, 'ARI push failed: ' + err.message, 500);
  }
}

static async syncPriceStaah(req: Request, res: Response): Promise<void> {
  try {
    const rate = await prisma.rates.findFirst({
      where: { staah: true, sync_staah: false, deleted_at: null },
      orderBy: { id: 'asc' },
    });
    if (!rate) { success(res, null, 'No rate found'); return; }

    const interface_ = await prisma.staah_interfaces.findFirst({
      where: { property_id: rate.property_id, deleted_at: null },
    });
    if (!interface_) { error(res, 'Staah interface not found for property ' + rate.property_id, 404); return; }

    const dateFrom = formatDate(rate.start_date);
    const dateTo = formatDate(rate.end_date);

    await prisma.rates.update({
      where: { id: rate.id },
      data: { sync_staah: true },
    });

    const rooms = await buildAriPayload(interface_, dateFrom, dateTo);
    if (!rooms.length) {
      await prisma.staah_sync_logs.create({
        data: {
          staah_interface_id: interface_.id,
          type: 'price',
          direction: 'push',
          status: 'skipped',
          hotel_id: interface_.hotel_id,
          room_id: rooms.map((r: any) => r.roomid).join(','),
          date_from: rate.start_date,
          date_to: rate.end_date,
          payload: {},
          response: {},
          message: 'No valid rates',
          synced_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      success(res, null, 'No valid rates');
      return;
    }

    const payload = { hotelid: interface_.hotel_id, room: rooms };
    const result = await staahService.storeRates(payload);
    const ok = String(result?.Status ?? result?.status ?? 'unknown').toLowerCase() === 'success';
    await prisma.staah_sync_logs.create({
      data: {
        staah_interface_id: interface_.id,
        type: 'price',
        direction: 'push',
        status: ok ? 'success' : 'failed',
        hotel_id: interface_.hotel_id,
        room_id: rooms.map((r: any) => r.roomid).join(','),
        date_from: rate.start_date,
        date_to: rate.end_date,
        payload: JSON.stringify(payload),
        response: JSON.stringify(result),
        synced_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    success(res, result, ok ? 'Price synced successfully' : 'Price sync failed');
  } catch (err: any) {
    error(res, 'Price sync failed: ' + err.message, 500);
  }
}
}
