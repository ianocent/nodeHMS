import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, notFound } from '../utils/response';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
    return out;
  }
  return val;
}

function toBigInt(val: any): bigint {
  if (typeof val === 'bigint') return val;
  return BigInt(val);
}

export class StaahWebhookController {
  static async healthCheck(req: Request, res: Response): Promise<void> {
    success(res, { status: 'ok', service: 'STAAH Webhook', timestamp: new Date().toISOString() }, 'Webhook active');
  }

  static async handleReservationPush(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body;

      // Extract reservation data
      const reservation = extractReservation(payload);
      if (!reservation) {
        error(res, 'No reservation data in payload', 400);
        return;
      }

      // Extract hotel ID
      const hotelId = reservation.hotel_id || reservation.hotelid || reservation.Su_hotelid
        || payload.hotel_id || payload.hotelid || payload.Su_hotelid;
      if (!hotelId) {
        error(res, 'Hotel ID not found in payload', 400);
        return;
      }

      // Extract notification ID
      const notificationId = payload.reservation_notif?.reservation_notif_id?.[0]
        || payload.reservation_notif_id
        || reservation.reservation_notif_id
        || reservation.reservation_notif?.reservation_notif_id?.[0]
        || null;

      // Find Staah interface
      const interface_ = await prisma.staah_interfaces.findFirst({
        where: { hotel_id: hotelId, deleted_at: null },
      });
      if (!interface_) {
        error(res, `Hotel ${hotelId} not registered`, 404);
        return;
      }

      // Check if already processed
      const existingBookingId = extractValue(reservation, ['channel_booking_id', 'id', 'bookingid', 'booking_id', 'reservationid']);
      if (existingBookingId) {
        const existing = await prisma.staah_reservations.findFirst({
          where: { booking_id: existingBookingId, staah_interface_id: interface_.id },
        });
        if (existing && existing.reservation_id) {
          success(res, { notification_id: notificationId, booking_id: existingBookingId }, 'Already processed');
          return;
        }
      }

      // Extract dates
      const checkInDate = extractDate(reservation, ['arrival_date', 'checkindate', 'check_in_date', 'arrivaldate', 'arrival']);
      const checkOutDate = extractDate(reservation, ['departure_date', 'checkoutdate', 'check_out_date', 'departuredate', 'departure']);
      const rooms = extractRooms(reservation);
      const room = rooms[0] || {};
      const customer = reservation.customer || reservation.Customer || {};

      const guestName = extractValue(room, ['first_name', 'firstname', 'GivenName'])
        || extractValue(customer, ['first_name', 'firstname', 'GivenName', 'name'])
        || extractValue(reservation, ['first_name', 'firstname', 'GivenName', 'guestname', 'name']);

      const guestLastName = extractValue(room, ['last_name', 'lastname', 'Surname'])
        || extractValue(customer, ['last_name', 'lastname', 'Surname'])
        || extractValue(reservation, ['last_name', 'lastname', 'Surname']);

      let fullName = guestName || '';
      if (guestLastName) fullName += ' ' + guestLastName;

      const guestEmail = extractValue(customer, ['email', 'Email'])
        || extractValue(reservation, ['email', 'Email', 'emailaddress']);
      const guestPhone = extractValue(customer, ['phone', 'telephone', 'PhoneNumber', 'mobile_phone'])
        || extractValue(reservation, ['phone', 'telephone', 'PhoneNumber', 'mobile']);

      // Save to Staah Reservations as Pending
      const staahRes = await prisma.staah_reservations.upsert({
        where: {
          staah_interface_id_booking_id: {
            staah_interface_id: interface_.id,
            booking_id: existingBookingId || 'unknown',
          },
        },
        create: {
          staah_interface_id: interface_.id,
          hotel_id: hotelId,
          booking_id: existingBookingId || 'unknown',
          notification_id: notificationId,
          status: '3',
          guest_name: fullName.trim(),
          guest_email: guestEmail,
          guest_phone: guestPhone,
          check_in_date: checkInDate ? new Date(checkInDate) : null,
          check_out_date: checkOutDate ? new Date(checkOutDate) : null,
          payload: payload,
          mapped_data: reservation,
          message: 'Pending Review',
        },
        update: {
          notification_id: notificationId,
          guest_name: fullName.trim(),
          guest_email: guestEmail,
          guest_phone: guestPhone,
          check_in_date: checkInDate ? new Date(checkInDate) : null,
          check_out_date: checkOutDate ? new Date(checkOutDate) : null,
          payload: payload,
          mapped_data: reservation,
          message: 'Pending Review',
        },
      });

      success(res, {
        id: Number(staahRes.id),
        notification_id: notificationId,
        booking_id: existingBookingId,
        status: 'pending',
      }, 'Saved to Staah Reservations');
    } catch (err: any) {
      console.error('Staah webhook error:', err);
      error(res, 'Webhook processing failed: ' + err.message, 500);
    }
  }

  static async processConfirmBooking(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const folioId = toBigInt(id);

      const staahRes = await prisma.staah_reservations.findUnique({ where: { id: folioId } });
      if (!staahRes) {
        notFound(res, 'Staah reservation not found');
        return;
      }

      const interface_ = await prisma.staah_interfaces.findUnique({
        where: { id: staahRes.staah_interface_id },
      });
      if (!interface_) {
        notFound(res, 'Staah interface not found');
        return;
      }

      const reservationData = staahRes.mapped_data as any || (staahRes.payload as any);
      if (!reservationData) {
        error(res, 'No mapped_data or payload found', 400);
        return;
      }

      // Step 1: Find or create guest profile
      const propertyId = Number(interface_.property_id);
      const guestProfile = await findOrCreateGuestProfile(propertyId, reservationData);

      // Step 2: Resolve company from OTA/channel mapping
      const companyProfileId = await resolveCompanyProfileId(propertyId, reservationData);

      // Step 3: Find room + rate mappings
      const rooms = extractRooms(reservationData);
      const room = rooms[0] || {};
      const staahRoomId = extractValue(room, ['id', 'roomid', 'room_id', 'RoomID', 'InvCode']);
      const staahRateId = extractValue(room, ['rate_id', 'rateplanid', 'rate_plan_id', 'RatePlanID']);

      const roomMapping = await findRoomMapping(Number(interface_.id), staahRoomId);
      const rateMapping = await findRateMapping(Number(interface_.id), staahRateId);

      if (!roomMapping || !rateMapping) {
        error(res, `Room or rate mapping not found: room=${staahRoomId}, rate=${staahRateId}`, 404);
        return;
      }

      // Step 4: Generate booking number and create folio
      const bookingNo = await generateBookingNo(propertyId);
      const checkInDate = extractDate(reservationData, ['arrival_date', 'checkindate', 'check_in_date', 'arrivaldate', 'arrival']);
      const checkOutDate = extractDate(reservationData, ['departure_date', 'checkoutdate', 'check_out_date', 'departuredate', 'departure']);

      const folio = await prisma.folios.create({
        data: {
          property_id: BigInt(propertyId),
          type_reservation: 'fit',
          guest_profile_id: BigInt(guestProfile.id),
          company_profile_id: companyProfileId ? BigInt(companyProfileId) : 0n,
          is_compliment_tour_leader: false,
          first_name: guestProfile.first_name,
          last_name: guestProfile.last_name,
          email: guestProfile.email,
          telp: guestProfile.mobile_phone,
          check_in_date: checkInDate ? new Date(checkInDate) : null,
          check_out_date: checkOutDate ? new Date(checkOutDate) : null,
          booking_no: bookingNo,
          status_reservation: 1,
          status: 1,
          is_booking_engine: false,
          parent: 0n,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Step 5: Create reservation records per night
      const nightDiff = checkInDate && checkOutDate
        ? Math.ceil((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      for (let i = 0; i < nightDiff; i++) {
        const date = checkInDate ? new Date(checkInDate) : new Date();
        date.setDate(date.getDate() + i);

        await prisma.reservations.create({
          data: {
            property_id: BigInt(propertyId),
            rate_id: BigInt(rateMapping.rate_id),
            folio_id: folio.id,
            room_type_id: BigInt(roomMapping.room_type_id),
            check_in_date: checkInDate ? new Date(checkInDate) : null,
            check_out_date: checkOutDate ? new Date(checkOutDate) : null,
            date: date,
            night: nightDiff,
            adult: room.numberofadults || room.adult || 2,
            child: room.numberofchildren || room.child || 0,
            status_reservation: 1,
            status: 1,
          },
        });
      }

      // Step 6: Update StaahReservation with folio reference
      await prisma.staah_reservations.update({
        where: { id: staahRes.id },
        data: {
          status: '1',
          folio_id: folio.id,
          reservation_id: folio.id,
          message: 'Confirmed',
          processed_at: new Date(),
        },
      });

      success(res, { folio_id: Number(folio.id), booking_no: bookingNo }, 'Booking confirmed');
    } catch (err: any) {
      console.error('Staah confirm booking error:', err);
      error(res, 'Failed to confirm booking: ' + err.message, 500);
    }
  }
}

// ── Helper functions ──

function extractReservation(payload: any): any | null {
  const reservations = payload.reservations || payload.Reservations
    || payload.data?.reservations || payload.data?.Reservations
    || payload.BookingDetails || [];

  if (payload.bookingid || payload.booking_id) return payload;
  if (Array.isArray(reservations) && reservations.length > 0) return reservations[0];
  if (reservations.bookingid || reservations.booking_id) return reservations;
  return null;
}

function extractValue(obj: any, keys: string[]): any {
  if (!obj) return null;
  for (const key of keys) {
    const val = obj[key] || obj[key.charAt(0).toUpperCase() + key.slice(1)];
    if (val) return val;
  }
  return null;
}

function extractDate(obj: any, keys: string[]): string | null {
  const val = extractValue(obj, keys);
  if (!val) return null;
  try {
    return new Date(val).toISOString();
  } catch {
    return String(val);
  }
}

function extractRooms(reservation: any): any[] {
  const roomData = reservation.room_stay || reservation.RoomStay
    || reservation.rooms || reservation.Rooms
    || reservation.room_details || reservation.RoomDetails
    || [];
  if (Array.isArray(roomData)) return roomData;
  if (roomData.room_type || roomData.RoomType) return [roomData];
  return [];
}

async function findOrCreateGuestProfile(propertyId: number, reservationData: any): Promise<any> {
  const prisma = new PrismaClient();

  const rooms = extractRooms(reservationData);
  const room = rooms[0] || {};
  const customer = reservationData.customer || reservationData.Customer || {};

  const firstName = extractValue(room, ['first_name', 'firstname', 'GivenName'])
    || extractValue(customer, ['first_name', 'firstname', 'GivenName', 'name'])
    || 'Unknown';
  const lastName = extractValue(room, ['last_name', 'lastname', 'Surname'])
    || extractValue(customer, ['last_name', 'lastname', 'Surname'])
    || '';
  const email = extractValue(customer, ['email', 'Email'])
    || extractValue(reservationData, ['email', 'Email']);
  const phone = extractValue(customer, ['phone', 'telephone', 'PhoneNumber', 'mobile_phone'])
    || extractValue(reservationData, ['phone', 'telephone', 'PhoneNumber']);

  const existing = await prisma.guest_profiles.findFirst({
    where: {
      property_id: BigInt(propertyId),
      OR: [
        ...(email ? [{ email }] : []),
        ...(firstName ? [{ first_name: { contains: firstName } }] : []),
      ],
    },
  });

  if (existing) return existing;

  const lastAccount = await prisma.guest_profiles.findFirst({
    where: { property_id: BigInt(propertyId) },
    orderBy: { account: 'desc' },
  });

  const lastNum = lastAccount ? parseInt((lastAccount.account as string || 'GA000000').slice(2)) : 0;
  const newAccount = 'GA' + String(lastNum + 1).padStart(6, '0');

  return prisma.guest_profiles.create({
    data: {
      property_id: BigInt(propertyId),
      account: newAccount,
      first_name: firstName,
      last_name: lastName,
      email: email,
      mobile_phone: phone,
      status_profile: 1,
    },
  });
}

async function resolveCompanyProfileId(propertyId: number, reservationData: any): Promise<number | null> {
  const prisma = new PrismaClient();
  const affiliation = reservationData.affiliation || {};
  const channelId = affiliation.OTA_Code || null;

  if (!channelId) return null;

  const mapping = await prisma.staah_ota_company_mappings.findFirst({
    where: {
      property_id: BigInt(propertyId),
      channel_id: String(channelId),
      status: true,
    },
  });

  return mapping ? Number(mapping.company_profile_id) : null;
}

async function findRoomMapping(interfaceId: number, staahRoomId: string): Promise<any> {
  const prisma = new PrismaClient();
  const cleanId = staahRoomId?.replace(/[- ]/g, '').toLowerCase();

  const result: any = await prisma.$queryRawUnsafe(`
    SELECT * FROM staah_room_mappings
    WHERE staah_interface_id = $1
      AND LOWER(REPLACE(REPLACE(staah_room_id, '-', ''), ' ', '')) = $2
      AND status IN ('active', '1', '1')
      AND deleted_at IS NULL
    LIMIT 1
  `, interfaceId, cleanId);

  return Array.isArray(result) && result.length > 0 ? result[0] : null;
}

async function findRateMapping(interfaceId: number, staahRateId: string): Promise<any> {
  const prisma = new PrismaClient();
  const cleanId = staahRateId?.replace(/[- ]/g, '').toLowerCase();

  const result: any = await prisma.$queryRawUnsafe(`
    SELECT * FROM staah_rate_mappings
    WHERE staah_interface_id = $1
      AND LOWER(REPLACE(REPLACE(staah_rate_plan_id, '-', ''), ' ', '')) = $2
      AND status IN ('active', '1', '1')
      AND deleted_at IS NULL
    LIMIT 1
  `, interfaceId, cleanId);

  return Array.isArray(result) && result.length > 0 ? result[0] : null;
}

async function generateBookingNo(propertyId: number): Promise<string> {
  const prisma = new PrismaClient();
  const prefix = 'OL' + String(propertyId).padStart(3, '0');

  const last = await prisma.folios.findFirst({
    where: { booking_no: { startsWith: prefix }, parent: 0n },
    orderBy: { booking_no: 'desc' },
  });

  const lastNum = last?.booking_no ? parseInt(last.booking_no.slice(prefix.length)) : 0;
  return prefix + String(lastNum + 1).padStart(4, '0');
}
