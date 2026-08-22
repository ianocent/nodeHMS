// Laravel Jobs/SyncPriceBookingEngine.php parity — pushes priced rows for the
// next "online" rate (online=1, sync_online=0) to the Booking Engine webhooks.
// Prices derive from the same getReservation pipeline as STAAH: occupancy
// formula on rate_rates, room_types.rate fallback, code_post markup.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { calculateCodePost } from '../../utils/cmsConfig';
import { occupancyPrice } from '../../utils/reservationPricing';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function processSyncPriceBookingEngine(_job: any) {
  try {
    const rate = await prisma.rates.findFirst({
      where: { online: 1, sync_online: 0, deleted_at: null },
    });
    if (!rate) return 'no rate found';

    const property = await prisma.properties.findUnique({ where: { id: rate.property_id } });
    if (!property) return 'no property found';

    await prisma.rates.update({ where: { id: rate.id }, data: { sync_online: 1 } });

    const contents = await prisma.content_rooms.findMany({
      where: { property_id: rate.property_id, status: 1, deleted_at: null },
      include: { content_room_breakdowns: { where: { deleted_at: null } } },
    });

    // Rate -> its own code post drives markup (= Folio::getReservation via rate.codePost).
    const rateRow: any = await prisma.rates.findUnique({
      where: { id: rate.id },
      select: { code_post_id: true },
    });
    let codePost: any = null;
    if (rateRow?.code_post_id) {
      codePost = await prisma.code_posts.findUnique({ where: { id: BigInt(rateRow.code_post_id) } });
    }
    const isTax = (property as any)?.is_tax === 1;

    function markup(net: number): number {
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

    const startStr = rate.start_date ? formatDate(new Date(rate.start_date)) : formatDate(new Date());
    const endStr = rate.end_date
      ? formatDate(new Date(rate.end_date))
      : formatDate(new Date(Date.now() + 60 * 86400000));

    const startD = new Date(`${startStr}T00:00:00Z`);
    const endD = new Date(`${endStr}T00:00:00Z`);

    const rows: any[] = [];
    for (const content of contents) {
      if (!content.room_type_id) continue;
      const roomTypeId = BigInt(content.room_type_id);
      const roomType: any = await prisma.room_types.findUnique({ where: { id: roomTypeId }, select: { name: true, rate: true, description: true } });
      if (!roomType) continue;
      const totalRoom = await prisma.rooms.count({ where: { room_type_id: roomTypeId, status: 1, deleted_at: null } });

      const breakdowns = content.content_room_breakdowns.filter((b: any) => !b.deleted_at && (b.status ?? 1) === 1);
      for (const breakdown of breakdowns) {
        const adult = Number(breakdown.adult ?? 0);
        const child = Number(breakdown.child ?? 0);
        for (let d = new Date(startD); d <= endD; d = new Date(d.getTime() + 86400000)) {
          const dateStr = formatDate(d);
          // getReservation pricing: stop_sell rows fall back to the flat room type rate.
          const rr: any = await prisma.rate_rates.findFirst({
            where: { rate_id: rate.id, room_type_id: roomTypeId, date: new Date(`${dateStr}T00:00:00Z`), stop_sell: 0 },
          });
          const base = rr ? occupancyPrice(rr, adult, child) : Number(roomType.rate ?? 0);
          const total = markup(base);
          if (!(total > 0)) continue;

          rows.push({
            room_type_name: roomType.name,
            room_type_id: Number(roomTypeId),
            room_type_description: roomType.description ?? '',
            adult,
            child,
            room_stock: totalRoom,
            date: dateStr,
            price: total,
            property_id: Number(content.property_id),
            rate_id: Number(rate.id),
            rate_code: (rate as any).code ?? '',
            unique_id: `${Number(rate.id)}-${roomType.name}-${dateStr}-${adult}-${child}`,
            unique_id_staah: `${Number(rate.id)}-${roomType.name}`,
          });
        }
      }
    }

    // Unique by unique_id then chunk 1000 (Laravel chunk(1000)).
    const seen = new Set<string>();
    const uniqueRows = rows.filter((r) => (seen.has(r.unique_id) ? false : (seen.add(r.unique_id), true)));
    const chunks: any[][] = [];
    for (let i = 0; i < uniqueRows.length; i += 1000) chunks.push(uniqueRows.slice(i, i + 1000));

    const baseUrl = process.env.BOOKING_ENGINE_URL;
    if (!baseUrl) {
      console.error('[SyncPriceBookingEngine] BOOKING_ENGINE_URL not configured');
      return 'error';
    }

    await fetch(`${baseUrl}/webhook/delete-room-price-by-rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: Number(rate.property_id), rate_id: Number(rate.id) }),
    });

    for (const chunk of chunks) {
      try {
        await fetch(`${baseUrl}/webhook/room-price`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
      } catch (err: any) {
        console.error('[SyncPriceBookingEngine] chunk push failed:', err?.message);
      }
    }

    console.log(`[SyncPriceBookingEngine] pushed ${uniqueRows.length} rows (${chunks.length} chunks) for rate ${rate.id}`);
    return 'success';
  } catch (err: any) {
    console.error('[SyncPriceBookingEngine] error:', err?.message);
    return 'error';
  }
}
