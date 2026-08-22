// Laravel Jobs/CreateStaahBooking.php parity — async booking creation from the
// STAAH webhook payload. Loads the pending staah_reservations row, runs the
// shared creation core, and surfaces failures on the row for the UI.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createStaahBookingCore } from '../../controllers/staah-webhook.controller';
import { enqueueJob } from '../../config/queue';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function processCreateStaahBooking(job: any) {
  const data = job.data || {};
  const staahReservationId = Number(data.staahReservationId);
  if (!staahReservationId) {
    console.warn('[CreateStaahBooking] missing staahReservationId');
    return 'skipped';
  }

  const staahRes = await prisma.staah_reservations.findUnique({ where: { id: BigInt(staahReservationId) } });
  if (!staahRes) {
    console.warn(`[CreateStaahBooking] staah_reservations ${staahReservationId} not found`);
    return 'not found';
  }
  // Already linked to a folio — nothing to do.
  if (staahRes.reservation_id || staahRes.folio_id) {
    return 'already processed';
  }

  const reservationData = (staahRes.mapped_data as any) || (staahRes.payload as any);
  if (!reservationData) {
    await prisma.staah_reservations.update({
      where: { id: staahRes.id },
      data: { status: '3', message: 'Failed: no mapped_data/payload', processed_at: new Date() },
    });
    return 'failed';
  }

  try {
    const result = await createStaahBookingCore(Number(staahRes.staah_interface_id), reservationData);
    await prisma.staah_reservations.update({
      where: { id: staahRes.id },
      data: {
        status: '1',
        folio_id: result.folioId,
        reservation_id: result.folioId,
        message: 'Confirmed',
        processed_at: new Date(),
      },
    });
    // Laravel StaahWebhookService pushes availability after booking creation (:864, :1194)
    const iface = await prisma.staah_interfaces.findUnique({ where: { id: staahRes.staah_interface_id }, select: { property_id: true } });
    enqueueJob('sync-staah-room-availability', { propertyId: Number(iface?.property_id ?? 0) });
    console.log(`[CreateStaahBooking] folio ${result.bookingNo} created for ${staahRes.booking_id}`);
    return 'success';
  } catch (err: any) {
    console.error(`[CreateStaahBooking] failed for ${staahRes.booking_id}:`, err?.message);
    // Laravel parity: mark the error on the row so it shows up in the UI list.
    await prisma.staah_reservations.update({
      where: { id: staahRes.id },
      data: { message: `Failed: ${err?.message ?? 'unknown error'}`, processed_at: new Date() },
    });
    return 'failed';
  }
}
