import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { calculateCodePost } from '../../utils/cmsConfig';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ROOM_STATUSES = {
  vacant: { id: 0, name: 'Vacant' },
  occupied: { id: 1, name: 'Occupied' },
  due_out: { id: 2, name: 'Due Out' },
  block: { id: 3, name: 'Blocked' },
  out_of_order: { id: 4, name: 'Out of Order' },
};

const MAID_STATUSES = {
  clean: { id: 0, name: 'Clean' },
  dirty: { id: 1, name: 'Dirty' },
  maid_in_room: { id: 2, name: 'Maid in Room' },
  inspection_required: { id: 3, name: 'Inspection Required' },
};

const STATUS_RESERVATION = {
  check_in: 0,
  check_out: 1,
  cancel_reservation: 2,
  reservation: 3,
  in_house: 4,
  pending: 5,
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function getBusinessDate(propertyId: bigint | null): Promise<string> {
  const logAudit = await prisma.log_audits.findFirst({
    where: {
      deleted_at: null,
      ...(propertyId ? { property_id: Number(propertyId) } : {}),
    },
    orderBy: { date: 'desc' },
  });

  if (logAudit) {
    const [y, m, d] = logAudit.date.toISOString().substring(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().substring(0, 10);
  }

  // Asia/Jakarta (UTC+7, no DST)
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().substring(0, 10);
}

async function postTrx(folio: any, codePostId: number, amount: number, type: string) {
  const codePost = await prisma.code_posts.findUnique({ where: { id: BigInt(codePostId) } });
  if (!codePost) return;

  const property = await prisma.properties.findUnique({ where: { id: folio.property_id } });
  const isTax = property?.is_tax === 1;

  const calc = codePost ? calculateCodePost(
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
    amount,
    false
  ) : { amount, service: 0, tax3: 0, pb1: 0, total: amount };

  await prisma.transactions.create({
    data: {
      property_id: folio.property_id,
      folio_id: folio.id,
      type: type === 'room_revenue' ? 'room_revenue' : (type === 'extra_bed' ? 'extra_bed' : 'additional_item'),
      type_amount: 'PLUS',
      date: new Date(),
      code: String(codePostId),
      code_name: codePost.name,
      amount: calc.amount,
      svr_chrg: calc.service,
      tax3: calc.tax3,
      pb1: calc.pb1,
      total: calc.total,
      surcharge: 0,
      status: 1,
      created_at: new Date(),
    },
  });
}

export async function processNightAuditPost(job: any) {
  try {
    const propertyId = job.data?.propertyId ? BigInt(job.data.propertyId) : null;
    const properties = propertyId
      ? [await prisma.properties.findUnique({ where: { id: propertyId } })].filter(Boolean)
      : await prisma.properties.findMany({ where: { status: 1, deleted_at: null } });

    for (const property of properties) {
      const pid = Number(property!.id);
      console.log(`[NightAuditPost] Processing property: ${pid}`);

      const dateStr = await getBusinessDate(BigInt(pid));
      const dateObj = new Date(dateStr + 'T00:00:00.000Z');
      const nextObj = addDays(dateObj, 1);
      const prevObj = addDays(dateObj, -1);

      const dayRange = { gte: dateObj, lt: nextObj };
      const nextRange = { gte: nextObj, lt: addDays(nextObj, 1) };

      // 1. Post room revenue for checked-in folios
      const reservations = await prisma.reservations.findMany({
        where: {
          property_id: pid,
          date: dayRange,
          is_posting: 0,
          deleted_at: null,
          folios: {
            is: {
              status_reservation: STATUS_RESERVATION.check_in,
              is_virtual: false,
            },
          },
        },
        include: { folios: true, rates: true },
      });

      for (const resv of reservations) {
        const folio = resv.folios;
        if (resv.rate_id) {
          await postTrx(folio, Number(resv.rate_id), Number(resv.total ?? 0), 'room_revenue');
        }
        if (Number(resv.total_extra_bed ?? 0) > 0 && resv.rates?.code_post_extra_bed_id) {
          await postTrx(folio, Number(resv.rates.code_post_extra_bed_id), Number(resv.total_extra_bed), 'extra_bed');
        }
        await prisma.reservations.updateMany({ where: { id: resv.id }, data: { is_posting: 1 } });
      }

      // 2. Post inclusive items per folio
      const mhciRows: any[] = await prisma.$queryRaw`
        SELECT model_id FROM model_has_code_items WHERE model_type = 'App\Models\Folio'
      `;
      const mhciFolioIds = mhciRows.map((m: any) => BigInt(String(m.model_id)));
      const inclusiveFolios = await prisma.folios.findMany({
        where: { property_id: pid, status_reservation: STATUS_RESERVATION.check_in, deleted_at: null, id: { in: mhciFolioIds } },
        orderBy: { created_at: 'asc' },
      });
      for (const folio of inclusiveFolios) {
        const items: any[] = await prisma.$queryRaw`
          SELECT * FROM model_has_code_items
          WHERE model_id = ${folio.id} AND model_type = 'App\Models\Folio'
            AND start_date <= ${dateObj} AND end_date >= ${dateObj}
        `;
        if (items.length === 0) continue;
        for (const item of items) {
          const codeItemId = Number(item.code_item_id);
          if (!codeItemId) continue;
          const codeItem = await prisma.code_items.findUnique({ where: { id: BigInt(codeItemId) } });
          if (!codeItem?.code_post_id) continue;
          const upsales = Number(item.upsales ?? 0);
          const sales = Number(item.sales ?? 0);
          await postTrx(folio, Number(codeItem.code_post_id), upsales > 0 ? upsales : sales, 'additional_item');
        }
        await prisma.$executeRaw`
          UPDATE model_has_code_items SET is_posting = 1
          WHERE model_id = ${folio.id} AND model_type = 'App\Models\Folio'
            AND start_date <= ${dateObj} AND end_date >= ${dateObj}
        `;
      }

      // 3. Room status transitions
      // 3a. Vacant + available tomorrow -> Block
      const availTomorrow = (await prisma.room_availabilities.findMany({
        where: { property_id: pid, date: nextRange },
      })).map((a) => a.room_id);
      const roomsVacant = await prisma.rooms.findMany({ where: { property_id: pid, room_status: 0, id: { in: availTomorrow } } });
      if (roomsVacant.length > 0) {
        await prisma.rooms.updateMany({ where: { id: { in: roomsVacant.map((r) => r.id) } }, data: { room_status: 3 } });
      }

      // 3b. Blocked + NOT available tomorrow -> Vacant + Dirty
      const roomsBlock = await prisma.rooms.findMany({ where: { property_id: pid, room_status: 3, NOT: { id: { in: availTomorrow } } } });
      if (roomsBlock.length > 0) {
        await prisma.rooms.updateMany({ where: { id: { in: roomsBlock.map((r) => r.id) } }, data: { room_status: 0, maid_status: 1 } });
      }

      // 3c. Vacant + active work order -> OOO (4)
      const workOrderRooms = (await prisma.work_orders.findMany({
        where: { property_id: pid, date: nextRange, end_date: null },
      })).map((w) => Number(w.room_id)).filter((x) => x > 0);
      const roomsOOO = await prisma.rooms.findMany({ where: { property_id: pid, room_status: 0, id: { in: workOrderRooms } } });
      if (roomsOOO.length > 0) {
        await prisma.rooms.updateMany({ where: { id: { in: roomsOOO.map((r) => r.id) } }, data: { room_status: 4 } });
      }

      // 4. LogAudit upsert
      const existing = await prisma.log_audits.findFirst({ where: { date: dateObj, property_id: pid } });
      if (existing) {
        await prisma.log_audits.update({ where: { id: existing.id }, data: { status: BigInt(1) } });
      } else {
        await prisma.log_audits.create({ data: { date: dateObj, property_id: pid, status: BigInt(1) } });
      }

      console.log(`[NightAuditPost] Completed for property ${pid}`);
    }
    return 'success';
  } catch (err: any) {
    console.error('[NightAuditPost] error:', err);
    throw err;
  }
}