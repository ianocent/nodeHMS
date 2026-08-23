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
      'dispatch-staah-availability',
      'night-audit-post',
      'sync-price-booking-engine',
      'sync-check-status-booking-engine',
      'sync-staah-availability',
      'sync-staah-room-type',
      'create-staah-booking',
      'check-request-status'
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

    await bossInstance.work('night-audit-post', async (job: any) => {
      const { processNightAuditPost } = await import('../queue/jobs/nightAuditPost');
      await processNightAuditPost(job);
    });

    // ── STAAH / Booking Engine jobs (Laravel Jobs/ parity) ──
    await bossInstance.work('sync-price-booking-engine', async (job: any) => {
      const { processSyncPriceBookingEngine } = await import('../queue/jobs/syncPriceBookingEngine');
      await processSyncPriceBookingEngine(job);
    });

    await bossInstance.work('sync-check-status-booking-engine', async (job: any) => {
      const { processSyncCheckStatusBookingEngine } = await import('../queue/jobs/syncCheckStatusBookingEngine');
      await processSyncCheckStatusBookingEngine(job);
    });

    await bossInstance.work('sync-staah-availability', async (job: any) => {
      const { processSyncStaahAvailability } = await import('../queue/jobs/syncStaahAvailability');
      await processSyncStaahAvailability(job);
    });

    await bossInstance.work('sync-staah-room-type', async (job: any) => {
      const { processSyncStaahRoomType } = await import('../queue/jobs/syncStaahRoomType');
      await processSyncStaahRoomType(job);
    });

    await bossInstance.work('create-staah-booking', async (job: any) => {
      const { processCreateStaahBooking } = await import('../queue/jobs/createStaahBooking');
      await processCreateStaahBooking(job);
    });

    // Batch report queue consumer (Laravel Kernel :44-59 'check.request.status')
    await bossInstance.work('check-request-status', async (job: any) => {
      const { processBatchReportRequest } = await import('../queue/jobs/batchReportRequest');
      await processBatchReportRequest(job);
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
  await bossInstance.schedule('sync-price-staah', '* * * * *'); // Kernel :35 everyMinute
  // Laravel Kernel :20-21/:25 have PullStaahReservations + reconcile availability
  // COMMENTED OUT — node crons for them are gated behind an opt-in env flag so
  // default behavior matches base instead of polling STAAH every 5 minutes.
  if (process.env.STAAH_POLL_CRON_ENABLED === 'true') {
    await bossInstance.schedule('pull-staah-reservations', '*/5 * * * *'); // every 5 minutes
    await bossInstance.schedule('dispatch-staah-availability', '*/5 * * * *'); // every 5 minutes
  }
  await bossInstance.schedule('check-expired-request-bookings', '0 * * * *'); // hourly
  await bossInstance.schedule('night-audit-post', '0 2 * * *'); // daily at 2 AM - night audit
  await bossInstance.schedule('check-request-status', '*/30 * * * * *'); // Laravel :58 everyThirtySeconds — queued batch reports
    // Laravel Kernel :30/:40 — booking engine price + payment status checks, every minute.
    await bossInstance.schedule('sync-price-booking-engine', '* * * * *');
    await bossInstance.schedule('sync-check-status-booking-engine', '* * * * *');
    // sync-staah-availability / sync-staah-room-type / create-staah-booking are
    // event-driven only (no cron) — same as Laravel dispatch sites.

    return bossInstance;
  } catch (error) {
    console.error('Failed to start queue:', error);
    return null;
  }
}

// Event-driven enqueue helper — mirrors Laravel `Job::dispatch(...)`.
// Safe no-op when the queue is not running (e.g. DATABASE_URL unset).
export async function enqueueJob(queueName: string, data: Record<string, any>): Promise<void> {
  try {
    if (!connectionString) return;
    const bossInstance = await getBoss();
    await bossInstance.send(queueName, data);
  } catch (err: any) {
    console.error(`[queue] enqueue ${queueName} failed:`, err?.message);
  }
}

export const queue = getBoss();
