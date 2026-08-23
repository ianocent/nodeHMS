require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
(async () => {
  const where = {
    deleted_at: null, is_pos_trx: false,
    type_reservation: 'vr',
    status_reservation: { notIn: [2] },
  };
  const cnt = await prisma.folios.count({ where });
  console.log('VR_COUNT_NODE_QUERY', cnt);
  const byProp = await prisma.folios.groupBy({ by: ['property_id'], _count: true, where: { type_reservation: 'vr', deleted_at: null } });
  console.log('BY_PROP', JSON.stringify(byProp.map((b) => ({ p: Number(b.property_id), c: b._count }))));
  const byStatus = await prisma.folios.groupBy({ by: ['status_reservation'], _count: true, where: { type_reservation: 'vr', deleted_at: null } });
  console.log('BY_STATUS', JSON.stringify(byStatus));
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });