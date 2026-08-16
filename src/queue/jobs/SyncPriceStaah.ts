import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StaahService } from '../../services/staah.service';
import { calculateCodePost } from '../../utils/cmsConfig';

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

export async function processSyncPriceStaah(job: any) {
  try {
    const rate = await prisma.rates.findFirst({
      where: { staah: true, sync_staah: false, deleted_at: null },
      include: {
        code_posts: true,
      }
    });

    if (!rate) return 'no rate found';

    console.log(`[SyncPriceStaah] Processing Rate: ${rate.id}`);

    const property = await prisma.properties.findUnique({
      where: { id: rate.property_id }
    });

    if (!property) return 'no property found';

    const staahInterface = await prisma.staah_interfaces.findFirst({
      where: { property_id: rate.property_id }
    });

    if (!staahInterface) return 'no staah interface found';

    await prisma.rates.update({
      where: { id: rate.id },
      data: { sync_staah: true }
    });

    const roomMappings = await prisma.staah_room_mappings.findMany({
      where: {
        staah_interface_id: staahInterface.id,
        status: 'active',
        deleted_at: null
      },
      include: {
        room_types: true
      }
    });

    const rateRates = await prisma.rate_rates.findMany({
      where: { rate_id: rate.id, deleted_at: null }
    });

    const rateRatesMap = new Map();
    rateRates.forEach(rr => {
      const dateStr = rr.date ? formatDate(rr.date) : '';
      rateRatesMap.set(`${rr.room_type_id}|${dateStr}`, rr);
    });

    const data: any[] = [];

    for (const mapping of roomMappings) {
      const roomType = mapping.room_types;
      if (!roomType) continue;

      const roomsCount = await prisma.rooms.count({
        where: { room_type_id: roomType.id, status: 1, deleted_at: null }
      });

      const staahRoomId = mapping.staah_room_id || roomType.name?.toLowerCase().replace(/\s/g, '');

      const breakdowns = await prisma.staah_room_content_breakdowns.findMany({
        where: {
          property_id: rate.property_id,
          staah_interface_id: staahInterface.id,
          room_type_id: mapping.room_type_id,
          status: 1,
          deleted_at: null
        }
      });

      for (const breakdown of breakdowns) {
        const startDate = rate.start_date!;
        const endDate = rate.end_date!;
        const nights = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)));

        const reservationPrices = [];
        
        for (let i = 0; i < nights; i++) {
          const nightDate = addDays(startDate, i);
          const nightStr = formatDate(nightDate);
          const rrKey = `${mapping.room_type_id}|${nightStr}`;
          const rr = rateRatesMap.get(rrKey);

          let totalRatePrice = 0;
          if (rr) {
             const adultCount = Number(breakdown.adult || 0);
             const childCount = Number(breakdown.child || 0);
             if (adultCount >= 1) totalRatePrice += Number(rr.one_adult || 0);
             if (adultCount >= 2) totalRatePrice += Number(rr.two_adult || 0) - Number(rr.one_adult || 0); 
             if (adultCount > 2) totalRatePrice += (adultCount - 2) * Number(rr.extra_adult || 0);
             if (childCount > 0) totalRatePrice += childCount * Number(rr.extra_child || 0);
          } else {
             totalRatePrice += Number(roomType.rate || 0);
          }

          let calculatedPrice = totalRatePrice;
          const codePost = rate.code_posts;
          if (codePost) {
             const isTax = property.is_tax === 1;
             const calcRes = calculateCodePost(codePost as any, totalRatePrice, isTax);
             calculatedPrice = calcRes.total;
          }

          reservationPrices.push({
            date: nightStr,
            total: calculatedPrice,
            rr
          });
        }

        data.push({
           data: reservationPrices,
           adult: breakdown.adult,
           child: breakdown.child,
           room_type_name: roomType.name,
           staah_room_id: staahRoomId,
           room_type_id: roomType.id,
           totalRoom: roomsCount,
           rate_id: rate.id,
           rate_code: rate.code,
           property_id: rate.property_id,
           start_date: startDate,
           end_date: endDate
        });
      }
    }

    const staahService = new StaahService();
    console.log(`[SyncPriceStaah] Completed price sync prep for Rate: ${rate.id}`);
    // await staahService.storeRates(payload);
    
    return 'success';
  } catch (err: any) {
    console.error('[SyncPriceStaah] error:', err);
    throw err;
  }
}
