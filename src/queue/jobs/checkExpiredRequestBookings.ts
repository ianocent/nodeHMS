import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StaahService } from '../../services/staah.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function processCheckExpiredRequestBookings(job: any) {
  try {
    const now = new Date();
    const warningThreshold = new Date(now.getTime() - 23 * 3600 * 1000);
    const expiryThreshold = new Date(now.getTime() - 24 * 3600 * 1000);

    // 1. Find bookings needing warning (23-24 hours old)
    // Get bookings that don't have a warning log yet
    const warnedBookingIds = await prisma.staah_sync_logs.findMany({
      where: { type: 'request_booking_warning' },
      select: { booking_id: true }
    });
    const warnedIds = new Set(warnedBookingIds.map(w => w.booking_id).filter(Boolean));

    const needsWarning = await prisma.staah_reservations.findMany({
      where: {
        status: { in: ['request', '3'] },
        folio_id: null,
        reservation_id: null,
        created_at: {
          gte: expiryThreshold,
          lte: warningThreshold
        }
      }
    });

    // Filter out already warned
    const toWarn = needsWarning.filter(r => r.booking_id && !warnedIds.has(r.booking_id));

    for (const reservation of toWarn) {
      try {
        await prisma.staah_sync_logs.create({
          data: {
            staah_interface_id: reservation.staah_interface_id,
            booking_id: reservation.booking_id,
            type: 'request_booking_warning',
            direction: 'internal',
            status: 'success',
            hotel_id: reservation.hotel_id,
            payload: JSON.stringify({
              booking_id: reservation.booking_id,
              expires_in: '1 hour',
              guest_name: reservation.guest_name,
            }),
            message: 'Warning sent: Request booking expires in 1 hour',
            synced_at: new Date(),
          }
        });
        console.warn(`[CheckExpired] Warning: Request booking ${reservation.booking_id} expiring soon.`);
      } catch (err: any) {
        console.error(`[CheckExpired] Failed to send warning for ${reservation.booking_id}:`, err.message);
      }
    }

    // 2. Find expired bookings (> 24 hours)
    const expired = await prisma.staah_reservations.findMany({
      where: {
        status: { in: ['request', '3'] },
        folio_id: null,
        reservation_id: null,
        created_at: {
          lt: expiryThreshold
        }
      }
    });

    const staahService = new StaahService();

    for (const reservation of expired) {
      try {
        const response = await staahService.cancelRequestBooking(reservation.booking_id || '');
        const statusStr = response?.Status?.toLowerCase() || 'fail';
        
        await prisma.staah_sync_logs.create({
          data: {
            staah_interface_id: reservation.staah_interface_id,
            booking_id: reservation.booking_id,
            type: 'request_booking_auto_cancel',
            direction: 'push',
            status: statusStr === 'success' ? 'success' : 'failed',
            hotel_id: reservation.hotel_id,
            payload: JSON.stringify({ bookingid: reservation.booking_id, status: 'cancel' }),
            response: JSON.stringify(response),
            message: 'Auto-cancelled expired request booking (24+ hours)',
            synced_at: new Date(),
          }
        });

        await prisma.staah_reservations.update({
          where: { id: reservation.id },
          data: {
            status: 'cancelled_expired',
            message: 'Auto-cancelled: No action taken within 24 hours',
            updated_at: new Date()
          }
        });
        console.log(`[CheckExpired] Auto-cancelled expired request booking ${reservation.booking_id}.`);
      } catch (err: any) {
        console.error(`[CheckExpired] Failed to auto-cancel ${reservation.booking_id}:`, err.message);
        
        await prisma.staah_reservations.update({
          where: { id: reservation.id },
          data: {
            status: 'expired',
            message: `Expired: Failed to auto-cancel at Staah - ${err.message}`,
            updated_at: new Date()
          }
        });
      }
    }

    console.log(`[CheckExpired] Completed. Warnings: ${needsWarning.length}, Expired: ${expired.length}`);
    return { warnings: needsWarning.length, expired: expired.length };
  } catch (err: any) {
    console.error('[CheckExpired] error:', err);
    throw err;
  }
}
