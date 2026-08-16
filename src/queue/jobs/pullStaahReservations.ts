import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StaahService } from '../../services/staah.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function processPullStaahReservations(job: any) {
  console.log('PULL SCHEDULER: Starting Staah reservations sync...');

  try {
    const interfaces = await prisma.staah_interfaces.findMany({
      where: { status: 'active', deleted_at: null }
    });

    const staahService = new StaahService();

    for (const iface of interfaces) {
      try {
        const response = await staahService.listingReservations(iface.hotel_id || '');
        const reservations = response?.reservations || response?.Reservations || [];
        const notificationIdsToAck: string[] = [];

        for (const res of reservations) {
          const bookingId = res.channel_booking_id || res.id || null;
          if (!bookingId) continue;

          const status = String(res.status || '').toLowerCase();
          const roomStayStatus = String(res.rooms?.[0]?.roomstaystatus || '').toLowerCase();

          const isNew = status === 'new' || roomStayStatus === 'new';
          const isModified = status === 'modified' || roomStayStatus === 'modified';
          const isCancelled = ['cancelled', 'cancel'].includes(status) || ['cancelled', 'cancel'].includes(roomStayStatus);

          let notifId = res.reservation_notif_id;
          if (!notifId && res.reservation_notif?.reservation_notif_id?.length) {
            notifId = res.reservation_notif.reservation_notif_id[0];
          }

          if (notifId) {
            notificationIdsToAck.push(notifId);
          }

          const existing = await prisma.staah_reservations.findFirst({
            where: { staah_interface_id: iface.id, booking_id: bookingId }
          });

          if (!existing && isNew) {
            console.log(`PULL SCHEDULER: Saving NEW pending Staah booking ${bookingId}`);
            
            // NOTE: Missing StaahWebhookService equivalent in Node.js.
            // A complete implementation would process the webhook and create a pending Folio here.
            await prisma.staah_reservations.create({
              data: {
                staah_interface_id: iface.id,
                hotel_id: iface.hotel_id || '',
                booking_id: bookingId,
                status: 'pending', // equivalent to 3 or request
                payload: JSON.stringify(res),
                mapped_data: JSON.stringify(res),
                created_at: new Date(),
                updated_at: new Date(),
              }
            });
            console.log(`[PullStaah] Created pending local record for ${bookingId}`);
            
          } else if (existing) {
            if (isCancelled && existing.status !== '2') {
              console.log(`PULL SCHEDULER: Cancelling booking ${bookingId}`);
              await prisma.staah_reservations.update({
                where: { id: existing.id },
                data: {
                  status: '2', // Cancelled
                  message: 'Cancelled from Staah Pull API',
                  updated_at: new Date()
                }
              });
            } else if (isModified) {
              console.log(`PULL SCHEDULER: Updating MODIFIED booking ${bookingId} to HMS`);
              
              const roomData = res.rooms?.[0] || {};
              const customer = res.customer || {};
              
              let fName = roomData.first_name || customer.first_name || '';
              let lName = roomData.last_name || customer.last_name || '';
              if (!fName && roomData.guest_name) {
                const parts = String(roomData.guest_name).split(' ');
                fName = parts[0];
                lName = parts.slice(1).join(' ');
              }

              const checkIn = res.arrival_date || res.checkindate || existing.check_in_date;
              const checkOut = res.departure_date || res.checkoutdate || existing.check_out_date;

              await prisma.staah_reservations.update({
                where: { id: existing.id },
                data: {
                  mapped_data: JSON.stringify(res),
                  payload: JSON.stringify(res),
                  status: 'modified',
                  guest_name: `${fName} ${lName}`.trim(),
                  message: 'Modified from Staah Pull API',
                  check_in_date: checkIn ? new Date(checkIn) : null,
                  check_out_date: checkOut ? new Date(checkOut) : null,
                  updated_at: new Date()
                }
              });

              if (existing.folio_id) {
                const folio = await prisma.folios.findUnique({ where: { id: existing.folio_id } });
                if (folio) {
                   await prisma.folios.update({
                     where: { id: folio.id },
                     data: {
                       first_name: fName,
                       last_name: lName,
                       check_in_date: checkIn ? new Date(checkIn) : null,
                       check_out_date: checkOut ? new Date(checkOut) : null,
                       updated_at: new Date()
                     }
                   });
                   
                   if (folio.guest_profile_id) {
                     await prisma.guest_profiles.update({
                       where: { id: folio.guest_profile_id },
                       data: {
                         first_name: fName,
                         last_name: lName,
                         updated_at: new Date()
                       }
                     });
                   }
                }
              }
            }
          }
        }

        if (notificationIdsToAck.length > 0) {
          try {
            const uniqueAcks = Array.from(new Set(notificationIdsToAck));
            await staahService.acknowledgeReservationNotifications(iface.hotel_id || '', uniqueAcks);
            console.log(`PULL SCHEDULER: Acknowledged Staah reservation notifications for Hotel ${iface.hotel_id}`);
          } catch (err: any) {
            console.warn(`PULL SCHEDULER: Failed to acknowledge notifications for Hotel ${iface.hotel_id}: ${err.message}`);
          }
        }
      } catch (err: any) {
        console.error(`PULL SCHEDULER ERROR for Hotel ${iface.hotel_id}:`, err.message);
      }
    }
    
    return 'success';
  } catch (err: any) {
    console.error('PULL SCHEDULER FATAL ERROR:', err);
    throw err;
  }
}
