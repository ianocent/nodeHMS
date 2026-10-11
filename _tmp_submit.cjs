// Throwaway: replay shiftConfirmationSubmit's logic for property 999 user 157.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function businessDate(propertyId) {
  const a = await prisma.log_audits.findFirst({
    where: { deleted_at: null, property_id: Number(propertyId) },
    orderBy: { date: 'desc' },
  });
  if (!a) return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const [y, m, d] = a.date.toISOString().substring(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().substring(0, 10);
}

const sumOf = (items) =>
  items.reduce((s, t) => s + (t.type_amount === 'PLUS' ? Number(t.total ?? 0) : -Number(t.total ?? 0)), 0);

(async () => {
  const propertyId = 999n;
  const targetUserId = 157n;
  const bd = await businessDate(propertyId);
  const day = new Date(bd + 'T00:00:00.000Z');
  const nextDay = new Date(day.getTime() + 86400000);
  const dateRange = { gte: day, lt: nextDay };

  let open = await prisma.transactions.findMany({
    where: {
      property_id: propertyId,
      created_by: targetUserId,
      date: dateRange,
      is_posting: 0,
      is_endshift: 0,
      deleted_at: null,
    },
  });
  let remaining = open.length;
  console.log(`open (is_posting=0 AND is_endshift=0) = ${open.length}`);

  const typePayments = await prisma.type_payments.findMany({ where: { status: 1, deleted_at: null } });
  for (const tp of typePayments) {
    const items = open.filter((t) => t.type_payment_id === tp.id);
    if (!items.length) continue;
    const sum = sumOf(items);
    console.log(`  passA ${tp.id}-payment ${tp.name}: n=${items.length} sum=${sum}`);
    if (Math.round(sum) === 0) { remaining -= items.length; }
  }

  const defaultCodes = await prisma.code_posts.findMany({ where: { type: 'DEFAULT', deleted_at: null } });
  for (const cp of defaultCodes) {
    const items = open.filter((t) => String(t.code ?? '') === String(cp.id));
    if (!items.length) continue;
    const sum = sumOf(items);
    console.log(`  passB ${cp.id}-code ${cp.name}: n=${items.length} sum=${sum}`);
    if (Math.round(sum) === 0) { remaining -= items.length; }
  }

  console.log(`\nremaining = ${remaining}  -> ${remaining > 0 ? "SHOULD BLOCK with status:error" : "WOULD SUCCEED (bug)"}`);
  await prisma.$disconnect();
  await pool.end();
})().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});