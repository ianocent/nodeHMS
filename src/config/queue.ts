// pg-boss is ESM, use dynamic import at runtime
let PgBoss: any;

async function getPgBoss() {
  if (!PgBoss) {
    const module = await import('pg-boss');
    PgBoss = module.PgBoss || module.default || module;
  }
  return PgBoss;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set. Queue will not start.');
}

let boss: any;

async function getBoss() {
  if (!boss) {
    const PgBossClass = await getPgBoss();
    boss = new PgBossClass(connectionString || '');
  }
  return boss;
}

export async function initQueue() {
  if (!connectionString) return null;
  
  const bossInstance = await getBoss();
  bossInstance.on('error', (error: Error) => console.error('pg-boss error:', error));

  try {
    await bossInstance.start();
    console.log('Queue started successfully (pg-boss).');
    
    // Ensure queues exist before scheduling (pg-boss 12+ requirement)
    const queues = [
      'sync-price-staah',
      'check-expired-request-bookings',
      'pull-staah-reservations',
      'sync-staah-room-availability',
      'dispatch-staah-availability'
    ];
    for (const q of queues) {
      try { await bossInstance.createQueue(q); } catch {}
    }

    // Register job handlers (workers)
    await bossInstance.work('sync-price-staah', async (job: any) => {
      const { processSyncPriceStaah } = await import('../queue/jobs/SyncPriceStaah');
      await processSyncPriceStaah(job);
    });

    await bossInstance.work('check-expired-request-bookings', async (job: any) => {
      const { processCheckExpiredRequestBookings } = await import('../queue/jobs/checkExpiredRequestBookings');
      await processCheckExpiredRequestBookings(job);
    });

    await bossInstance.work('pull-staah-reservations', async (job: any) => {
      const { processPullStaahReservations } = await import('../queue/jobs/pullStaahReservations');
      await processPullStaahReservations(job);
    });

    await bossInstance.work('sync-staah-room-availability', async (job: any) => {
      const { processSyncStaahRoomAvailability } = await import('../queue/jobs/syncStaahRoomAvailability');
      await processSyncStaahRoomAvailability(job);
    });

    // Dispatcher for per-property availability sync
    await bossInstance.work('dispatch-staah-availability', async (job: any) => {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const interfaces = await prisma.staah_interfaces.findMany({ where: { status: 'active' } });
      for (const iface of interfaces) {
         await bossInstance.send('sync-staah-room-availability', { propertyId: Number(iface.property_id) });
      }
      await prisma.$disconnect();
    });

    // Schedule cron jobs (equivalent to Laravel Console/Kernel.php)
    await bossInstance.schedule('sync-price-staah', '* * * * *'); // every minute
    await bossInstance.schedule('pull-staah-reservations', '*/5 * * * *'); // every 5 minutes
    await bossInstance.schedule('dispatch-staah-availability', '*/5 * * * *'); // every 5 minutes
    await bossInstance.schedule('check-expired-request-bookings', '0 * * * *'); // hourly

    return bossInstance;
  } catch (error) {
    console.error('Failed to start queue:', error);
    return null;
  }
}

export const queue = getBoss();
