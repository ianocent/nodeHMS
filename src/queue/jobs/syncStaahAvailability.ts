// Laravel Jobs/SyncStaahAvailability.php parity — raw ARI push after rate grid
// / interface writes. Prices are the RAW one_adult/two_adult values (this job,
// unlike SyncPriceStaah, does not apply code_post markup in Laravel either).
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StaahService } from '../../services/staah.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function isSuccessResponse(res: any): boolean {
  const status = String(res?.Status ?? res?.status ?? '').toLowerCase();
  return status === 'success' || res?.success === true;
}

export async function processSyncStaahAvailability(job: any) {
  const data = job.data || {};
  const propertyId = Number(data.propertyId);
  const dateFrom: string = data.dateFrom || formatDate(new Date());
  const dateTo: string = data.dateTo || formatDate(new Date(Date.now() + 60 * 86400000));
  const rateIdFilter: number | null = data.rateId ? Number(data.rateId) : null;

  const iface = await prisma.staah_interfaces.findFirst({ where: { property_id: BigInt(propertyId) } });
  if (!iface) {
    console.warn(`[SyncStaahAvailability] no StaahInterface for property ${propertyId}`);
    return 'no interface';
  }

  const roomMappings = await prisma.staah_room_mappings.findMany({
    where: { staah_interface_id: iface.id, deleted_at: null, status: 'active' },
  });
  const rateMappingsAll = await prisma.staah_rate_mappings.findMany({
    where: { staah_interface_id: iface.id, deleted_at: null, status: 'active' },
    ...(rateIdFilter ? { where: { staah_interface_id: iface.id, deleted_at: null, status: 'active', rate_id: BigInt(rateIdFilter) } } : {}),
  });
  const rateMappings = rateMappingsAll.length ? rateMappingsAll : rateMappingsAll;
  if (!roomMappings.length || !rateMappings.length) {
    await prisma.staah_sync_logs.create({
      data: {
        staah_interface_id: iface.id,
        type: 'ari',
        direction: 'push',
        status: 'skipped',
        hotel_id: iface.hotel_id,
        date_from: new Date(`${dateFrom}T00:00:00Z`),
        date_to: new Date(`${dateTo}T00:00:00Z`),
        payload: { reason: 'no mappings', propertyId, dateFrom, dateTo },
      },
    });
    return 'skipped';
  }

  const rateRates = await prisma.rate_rates.findMany({
    where: {
      rate_id: { in: rateMappings.map((r: any) => r.rate_id) },
      room_type_id: { in: roomMappings.map((r: any) => r.room_type_id) },
      date: { gte: new Date(`${dateFrom}T00:00:00Z`), lte: new Date(`${dateTo}T23:59:59Z`) },
    },
    orderBy: { date: 'asc' },
  });

  const rooms: any[] = [];
  for (const roomMapping of roomMappings) {
    const ratesForRoom = rateRates
      .filter((rr: any) => rr.room_type_id === roomMapping.room_type_id)
      .sort((a: any, b: any) => a.date.getTime() - b.date.getTime());
    if (!ratesForRoom.length) continue;

    const dates: any[] = [];
    let currentRange: any = null;
    for (const rr of ratesForRoom) {
      const dateStr = formatDate(rr.date);
      const rateMapping: any = rateMappings.find((rm: any) => rm.rate_id === rr.rate_id);
      if (!rateMapping) continue;

      const prices: any[] = [];
      if (Number(rr.one_adult) > 0) prices.push({ NumberOfGuests: '1', value: String(Number(rr.one_adult)) });
      if (Number(rr.two_adult) > 0) prices.push({ NumberOfGuests: '2', value: String(Number(rr.two_adult)) });

      const ratePlanId = rateMapping.staah_rate_plan_id;
      const closed = rr.stop_sell ? '1' : '0';
      const minStay = String(rr.min_night);
      const maxStay = String(rr.max_night);
      const closedArrival = rr.stop_arrival ? '1' : '0';
      const closedDeparture = rr.stop_departure ? '1' : '0';
      const extraAdult = Number(rr.extra_adult ?? 0).toFixed(2);
      const extraChild = Number(rr.extra_child ?? 0).toFixed(2);
      const matchKey = JSON.stringify([prices, ratePlanId, closed, minStay, maxStay, closedArrival, closedDeparture, extraAdult, extraChild]);

      if (currentRange === null) {
        currentRange = {
          from: dateStr, to: dateStr,
          rate: [{ rateplanid: ratePlanId }],
          price: prices, closed, minimumstay: minStay, maximumstay: maxStay,
          closedonarrival: closedArrival, closedondeparture: closedDeparture,
          extraadultrate: extraAdult, extrachildrate: extraChild,
          matchKey,
        };
      } else if (
        currentRange.matchKey === matchKey &&
        formatDate(new Date(new Date(currentRange.to + 'T00:00:00Z').getTime() + 86400000)) === dateStr
      ) {
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
          matchKey,
        };
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

  const payload = { hotelid: iface.hotel_id, room: rooms };
  if (!rooms.length) {
    await prisma.staah_sync_logs.create({
      data: {
        staah_interface_id: iface.id,
        type: 'ari',
        direction: 'push',
        status: 'skipped',
        hotel_id: iface.hotel_id,
        date_from: new Date(`${dateFrom}T00:00:00Z`),
        date_to: new Date(`${dateTo}T00:00:00Z`),
        payload: payload as any,
      },
    });
    return 'no rows';
  }

  const staahService = new StaahService();
  const response: any = await staahService.storeRates(payload as any);
  const ok = isSuccessResponse(response);

  await prisma.staah_sync_logs.create({
    data: {
      staah_interface_id: iface.id,
      type: 'ari',
      direction: 'push',
      status: ok ? 'success' : 'failed',
      hotel_id: iface.hotel_id,
      room_id: [...new Set(rooms.map((r) => r.roomid))].join(','),
      rate_plan_id: [
        ...new Set(
          rooms.flatMap((r) => r.date.flatMap((d: any) => (d.rate ?? []).map((x: any) => x.rateplanid)))
        ),
      ].join(','),
      date_from: new Date(`${dateFrom}T00:00:00Z`),
      date_to: new Date(`${dateTo}T00:00:00Z`),
      payload: payload as any,
      response: response as any,
      synced_at: new Date(),
    },
  });

  return ok ? 'success' : 'failed';
}
