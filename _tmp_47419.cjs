require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

(async () => {
  const folio = await prisma.folios.findUnique({
    where: { id: 47419n },
    select: {
      id: true, folio_number: true, type_reservation: true, company_profile_id: true,
      guest_profile_id: true, status_reservation: true, check_in_date: true, check_out_date: true,
      reservations: {
        where: { deleted_at: null },
        select: {
          id: true, folio_id: true, room_id: true, room_type_id: true, rate_id: true,
          adult: true, child: true, is_posting: true, status_reservation: true,
          rooms: { select: { name: true, room_status: true, maid_status: true } },
        },
      },
    },
  });
  if (!folio) { console.log('folio 47419 NOT FOUND'); process.exit(0); }
  console.log('folio', folio.folio_number, folio.type_reservation, 'status_res=', folio.status_reservation);
  console.log('  company=', folio.company_profile_id, 'guest=', folio.guest_profile_id);
  console.log('  dates=', folio.check_in_date, '->', folio.check_out_date);
  for (const r of folio.reservations) {
    console.log(`  res #${r.id} folio_id=${r.folio_id} room_id=${r.room_id} room=${r.rooms?.name ?? null}`);
    console.log(`     room_status=${r.rooms?.room_status} maid_status=${r.rooms?.maid_status} adult=${r.adult} child=${r.child} is_posting=${r.is_posting}`);
    const t = await prisma.model_has_types.findMany({
      where: { model_type: 'App\\Models\\Reservation', model_id: r.id },
      include: { types: { select: { id: true, name: true, group: true } } },
    });
    console.log('     pivot=', JSON.stringify(t.map((i) => [i.types.group, i.type_id.toString(), i.types.name])));
  }
  await prisma.$disconnect();
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
