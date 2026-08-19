const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });
(async () => {
  try {
    const folio = await p.folios.findUnique({ where: { id: 39661n }, select: { id: true, folio_number: true, check_in_date: true, check_out_date: true, status_reservation: true, type_reservation: true, is_day_use: true, is_pending: true, first_name: true, last_name: true, guest_profile_id: true, company_name: true } });
    console.log('FOLIO', JSON.stringify(folio, (k, v) => typeof v === 'bigint' ? String(v) : v));
    const resv = await p.reservations.findMany({ where: { folio_id: 39661n, deleted_at: null }, orderBy: { date: 'asc' }, select: { id: true, date: true, check_in_date: true, check_out_date: true, room_id: true, room_id_next: true, room_type_id: true, rate_id: true, adult: true, child: true, add_bed: true, is_posting: true, quantity: true, amount: true, rate_name: true, room_name: true } });
    console.log('RESV_COUNT', resv.length);
    console.log('RESV_SAMPLE', JSON.stringify(resv.slice(0, 8), (k, v) => typeof v === 'bigint' ? String(v) : v));
    console.log('RESV_NULL_DATES', resv.filter(r => !r.date || !r.check_in_date || !r.check_out_date).length);
    console.log('RESV_NULL_ROOM', resv.filter(r => !r.room_id).length);
  } catch (e) {
    console.log('ERR:', e.message);
  }
  await p.$disconnect();
})();