import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StaahService } from '../../services/staah.service';
import crypto from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function addDays(dateStr: string | Date, days: number): Date {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

const memoryCache = new Map<string, { hash: string, expiry: number }>();

export async function processSyncStaahRoomAvailability(job: any) {
  try {
    const data = job.data || {};
    const propertyId = BigInt(data.propertyId);
    
    const now = new Date();
    now.setHours(0,0,0,0);

    const dateFromStr = data.dateFrom || formatDate(now);
    const dateToStr = data.dateTo || formatDate(addDays(now, 60));
    const roomTypeId = data.roomTypeId ? BigInt(data.roomTypeId) : null;

    const iface = await prisma.staah_interfaces.findFirst({
      where: { property_id: propertyId }
    });

    if (!iface) {
      console.warn(`SyncStaahRoomAvailability: no Staah interface for ${propertyId}`);
      return;
    }

    const mappingWhere: any = {
      staah_interface_id: iface.id,
      status: 'active',
      room_type_id: { not: null }
    };
    if (roomTypeId) mappingWhere.room_type_id = roomTypeId;

    const mappings = await prisma.staah_room_mappings.findMany({ where: mappingWhere });

    if (!mappings.length) {
      console.info(`SyncStaahRoomAvailability: no active room mappings for ${propertyId}`);
      return;
    }

    const roomsPayload: any[] = [];

    for (const mapping of mappings) {
      const totalPhysical = await prisma.rooms.count({
        where: {
          room_type_id: mapping.room_type_id,
          property_id: propertyId,
          status: 1,
          deleted_at: null
        }
      });

      if (totalPhysical <= 0) continue;

      const dateEntries = [];
      const period = new Date(dateFromStr);
      const end = new Date(dateToStr);

      let currentRange: any = null;

      while (period <= end) {
        const dateStr = formatDate(period);

        const reservedCount = await prisma.reservations.count({
          where: {
            room_type_id: mapping.room_type_id,
            date: new Date(dateStr),
            folios: {
              status_reservation: { in: [0, 3] } // check_in = 0, reservation = 3
            }
          }
        });

        const available = Math.max(0, totalPhysical - reservedCount);
        const availableStr = String(available);

        if (!currentRange) {
          currentRange = { from: dateStr, to: dateStr, roomstosell: availableStr };
        } else if (currentRange.roomstosell === availableStr && formatDate(addDays(currentRange.to, 1)) === dateStr) {
          currentRange.to = dateStr;
        } else {
          if (currentRange.from === currentRange.to) {
            currentRange.value = currentRange.from;
            delete currentRange.from;
            delete currentRange.to;
          }
          dateEntries.push(currentRange);
          currentRange = { from: dateStr, to: dateStr, roomstosell: availableStr };
        }

        period.setDate(period.getDate() + 1);
      }

      if (currentRange) {
        if (currentRange.from === currentRange.to) {
          currentRange.value = currentRange.from;
          delete currentRange.from;
          delete currentRange.to;
        }
        dateEntries.push(currentRange);
      }

      roomsPayload.push({
        roomid: mapping.staah_room_id,
        date: dateEntries
      });
    }

    if (!roomsPayload.length) {
      console.info(`SyncStaahRoomAvailability: nothing to push for ${propertyId}`);
      return;
    }

    const payloadObj = { hotelid: iface.hotel_id, room: roomsPayload };
    const hash = crypto.createHash('md5').update(JSON.stringify(roomsPayload)).digest('hex');
    const cacheKey = `staah_avail_hash_${propertyId}`;

    const cached = memoryCache.get(cacheKey);
    if (cached && cached.hash === hash && cached.expiry > Date.now()) {
      console.info(`SyncStaahRoomAvailability: unchanged, skipping for ${propertyId}`);
      return;
    }

    const staahService = new StaahService();
    let isSuccess = false;
    let responseObj: any = null;

    try {
      responseObj = await staahService.storeRates(payloadObj);
      const statusStr = String(responseObj?.Status || responseObj?.status || '').toLowerCase();
      isSuccess = statusStr === 'success';
    } catch (err: any) {
      console.error(`SyncStaahRoomAvailability storeRates error for ${propertyId}:`, err.message);
      responseObj = { error: err.message };
    }

    await prisma.staah_sync_logs.create({
      data: {
        staah_interface_id: iface.id,
        type: 'availability',
        direction: 'push',
        status: isSuccess ? 'success' : 'failed',
        hotel_id: iface.hotel_id,
        date_from: new Date(dateFromStr),
        date_to: new Date(dateToStr),
        payload: JSON.stringify(payloadObj),
        response: JSON.stringify(responseObj),
        message: 'Availability sync (roomstosell only)',
        synced_at: new Date()
      }
    });

    if (isSuccess) {
      memoryCache.set(cacheKey, { hash, expiry: Date.now() + 24 * 3600 * 1000 });
    }

    console.log(`SyncStaahRoomAvailability: done for ${propertyId}, status: ${isSuccess ? 'success' : 'failed'}`);
    return isSuccess ? 'success' : 'failed';
  } catch (err: any) {
    console.error('SyncStaahRoomAvailability error:', err);
    throw err;
  }
}
