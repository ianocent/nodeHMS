import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { normalizeJson } from '../utils/json';

function localSuccess(res: any, data: any = null, message = 'Success', code = 200, meta?: any) {
  const payload = { code, message, data, ...meta };
  res.status(code).json(normalizeJson(payload));
}

function localError(res: any, message: string, code = 500, errors: any = null) {
  res.status(code).json(normalizeJson({ code, message, data: null, errors }));
}

function localBadRequest(res: any, message = 'Bad request', errors?: any) {
  localError(res, message, 400, errors);
}

function localNotFound(res: any, message = 'Not found') {
  localError(res, message, 404);
}

import { calculateCodePost } from '../utils/cmsConfig';
import { generateFolioNumber } from '../utils/folioNumber';
import { nextGuestAccount } from '../utils/guestAccount';
import { ROOM_STATUSES } from '../utils/cmsStatus';
import { redactPayload } from '../middleware/staahSecurity';


// Laravel config/cms.php parity
const STATUS_RESERVATION = {
  check_in: 0,
  check_out: 1,
  cancel_reservation: 2,
  reservation: 3,
  in_house: 4,
  pending: 5,
};
const STATUS_ACTIVE = 1;

function toNum(v: any): any {
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(toNum);
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = toNum(v[k]);
    return o;
  }
  return v;
}

function fmtDate(d: Date): string {
  return d.toISOString().substring(0, 10);
}

function dayAfter(d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function diffDays(ci: Date, co: Date): number {
  return Math.round((co.getTime() - ci.getTime()) / 86400000);
}

function bn(val: any): bigint | null {
  if (val === null || val === undefined || val === '') return null;
  return BigInt(val);
}



/**
 * Which HMS property a booking-engine payload belongs to.
 *
 * The payload carries `client_uid` and nothing else that identifies the hotel — no
 * slug, no HMS property id. `client_uid` is NOT unique: the booking engine's
 * `properties` table has '1' for KURETAKESO (999), HOTEL olive (1002) and Ow! Hotel
 * (1003). The old lookup was `findFirst({ where: { client_uid }, orderBy: { id } })`,
 * so every online booking for HOTEL OLIVE or Ow! Hotel was written under KURETAKESO —
 * wrong property, wrong folio series, wrong availability pool.
 *
 * Two extra signals disambiguate, both already in the payload:
 *
 *  1. `room_type_id` is the booking engine's own room type id. HMS `room_types.id` is a
 *     global primary key, so `id = room_type_id` can only belong to one property.
 *     (The ids do not line up value-for-value across the two systems — the engine's 21
 *     is "standart king bed", HMS's 21 is "SUPERIOR DOUBLE BED" — but a given id exists
 *     in only one property on the HMS side, which is all this needs.)
 *  2. `room_type_name` matches `room_types.description` case-insensitively, which is
 *     what the rest of this handler already trusts.
 *
 * Falls back to the old lowest-id behaviour, loudly, when neither narrows it to one.
 */
export async function resolveBookingEngineProperty(
  client: any,
  body: any
): Promise<any | null> {
  const clientUid = body.client_uid ?? body.clientUid;
  const candidates: any[] = await client.properties.findMany({
    where: { client_uid: clientUid },
    orderBy: { id: 'asc' },
  });
  if (candidates.length <= 1) return candidates[0] ?? null;

  const ids = candidates.map((p: any) => BigInt(p.id));
  const roomTypeId = bn(body.room_type_id);
  const roomTypeName = body.room_type_name ? String(body.room_type_name).trim() : '';

  const roomTypes: any[] = await client.room_types.findMany({
    where: {
      property_id: { in: ids },
      deleted_at: null,
      status: STATUS_ACTIVE,
      ...(roomTypeId ? { id: roomTypeId } : {}),
      ...(roomTypeName ? { description: { equals: roomTypeName.toLowerCase(), mode: 'insensitive' } } : {}),
    },
    select: { id: true, property_id: true, description: true },
  });

  if (roomTypes.length === 1) {
    const match = candidates.find((p: any) => BigInt(p.id) === BigInt(roomTypes[0].property_id));
    console.warn(
      `[booking-engine] client_uid="${clientUid}" matched ${candidates.length} properties; ` +
        `resolved to ${match?.name} via room type "${roomTypes[0].description}"`
    );
    return match ?? null;
  }

  console.warn(
    `[booking-engine] client_uid="${clientUid}" is ambiguous across ` +
      `${candidates.map((p: any) => p.name).join(', ')} and the room type did not narrow it ` +
      `(room_type_id=${body.room_type_id ?? 'null'}, room_type_name="${roomTypeName}"). ` +
      `Falling back to ${candidates[0]?.name}.`
  );
  return candidates[0] ?? null;
}

/**
 * Body or an empty object.
 *
 * `req.body` is undefined — not `{}` — when a request arrives without a
 * Content-Type that express.json()/urlencoded() claims. Every handler in this
 * controller is registered for BOTH GET and POST (booking.routes.ts), and the
 * booking engine calls the GET variants:
 *
 *   GET /booking/roomUnavailable?client_uid=1
 *
 * So `req.body.client_uid` threw "Cannot read properties of undefined" and the
 * availability pull answered 500. SearchController::getRoomAvailability wraps that
 * call in try/catch and falls back to empty collections, which is why the symptom
 * upstream was "no rooms available" rather than a visible failure.
 */
/**
 * Payload fields for a handler that is registered for BOTH GET and POST.
 *
 * `req.body` is undefined — not `{}` — when a request arrives without a Content-Type
 * that express.json()/urlencoded() claims, and the booking engine calls the GET variants:
 *
 *   GET /booking/roomUnavailable?client_uid=1&room_type_name=DELUXE%20TWIN
 *
 * Query params are merged in, body winning, because the same route is reachable both ways
 * and every field the handlers read (`client_uid`, `room_type_id`, `room_type_name`,
 * `check_in_date`, …) is passed as a query param on the GET calls. Returning `req.body`
 * alone meant `bodyOf(req).client_uid` was undefined on those, and the old call sites each
 * papered over it with `?? req.query.client_uid` — which is why `checkDataReservation`
 * answered 400 "The client uid field is required." when the booking engine called it with
 * `?0=1&1=1&2=1&3=1` (its own query string is malformed, but the handler should still see
 * whatever did arrive rather than nothing at all).
 */
function bodyOf(req: Request): any {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const query = req.query && typeof req.query === 'object' ? (req.query as any) : {};
  return { ...query, ...body };
}

/**
 * Booking Engine mobile API (Laravel MiddlewareBookingEngineController parity).
 * Routes in web.php: /booking/*, public token-less (client_uid based).
 */
export class BookingEngineController {
  // ── POST /booking/roomUnavailable ──
  static async roomAvailability(req: Request, res: Response): Promise<void> {
    try {
      const clientUid = String(bodyOf(req).client_uid ?? req.query.client_uid ?? '');
      if (!clientUid) {
        localBadRequest(res, 'The client uid field is required.');
        return;
      }
      const property = await resolveBookingEngineProperty(prisma, bodyOf(req));
      if (!property) {
        localNotFound(res, 'Property not found.');
        return;
      }
      const pid = property.id;

      const logAudit = await prisma.log_audits.findFirst({
        where: { property_id: Number(pid), deleted_at: null },
        orderBy: { date: 'desc' },
      });
      const date = logAudit ? fmtDate(dayAfter(logAudit.date)) : fmtDate(new Date());

      const rooms = await prisma.rooms.findMany({
        where: { property_id: pid, deleted_at: null, status: STATUS_ACTIVE },
        orderBy: { name: 'asc' },
        include: { room_types: true },
      });

      const reservations = await prisma.reservations.findMany({
        where: {
          property_id: pid,
          date: { gte: new Date(date) },
          folios: { status_reservation: { not: STATUS_RESERVATION.cancel_reservation } },
        },
        include: { folios: true },
      });

      const now = fmtDate(new Date());
      const stopSells = await prisma.stop_sells.findMany({
        where: { property_id: pid, type: 'booking_engine', date: { gte: new Date(now) }, deleted_at: null },
      });
      const stopSellRoomTypes = await prisma.room_types.findMany({
        where: { id: { in: stopSells.map((s) => s.room_type_id) } },
        include: { rooms: true },
      });
      const stopSellRoomMap = new Map<number, any>();
      for (const rt of stopSellRoomTypes) stopSellRoomMap.set(Number(rt.id), rt);

      const workOrders = await prisma.work_orders.findMany({
        where: { property_id: pid, end_time: null, room_id: { not: null }, deleted_at: null },
      });
      const workOrderRoomIds = new Set(workOrders.map((w) => Number(w.room_id)));

      const data: any[] = [];
      for (const room of rooms) {
        for (const r of reservations.filter((x) => x.room_id === room.id)) {
          data.push({ room_id: toNum(room.id), date: fmtDate(r.date), room_type_id: toNum(room.room_type_id) });
        }
        if (workOrderRoomIds.has(Number(room.id))) {
          for (let i = 0; i <= 365; i++) {
            data.push({ room_id: toNum(room.id), date: fmtDate(addDays(new Date(now), i)), room_type_id: toNum(room.room_type_id), type: 'work_order' });
          }
        }
      }
      for (const ss of stopSells) {
        const rt = stopSellRoomMap.get(Number(ss.room_type_id));
        for (const room of rt?.rooms ?? []) {
          data.push({ room_id: toNum(room.id), date: fmtDate(ss.date), room_type_id: toNum(ss.room_type_id) });
        }
      }
      for (const r of reservations.filter((x) => x.room_id === null || x.room_id === 0n)) {
        data.push({ room_id: null, date: fmtDate(r.date), room_type_id: toNum(r.room_type_id) });
      }

      const contentRooms = await prisma.content_rooms.findMany({
        where: { property_id: pid, deleted_at: null, status: STATUS_ACTIVE },
      });
      const connectRoomType: any[] = [];
      for (const cr of contentRooms) {
        let roomTypeIds: number[] = [];
        try { roomTypeIds = (JSON.parse(cr.data || '{}')?.room_type_ids ?? []) as number[]; } catch { roomTypeIds = []; }
        if (roomTypeIds.length > 0) {
          const totals = [];
          for (const rtId of roomTypeIds) {
            const cnt = await prisma.rooms.count({
              where: { room_type_id: bn(rtId) ?? 0n, property_id: pid, deleted_at: null, status: STATUS_ACTIVE },
            });
            totals.push({ room_type_id: rtId, total_room: cnt });
          }
          connectRoomType.push({ room_type_id: toNum(cr.room_type_id), room_type_id_connect: true, total_room: totals });
        } else {
          connectRoomType.push({ room_type_id: toNum(cr.room_type_id), room_type_id_connect: false, total_room: [] });
        }
      }

      localSuccess(res, data, 'Data has been loaded', 200, { connect_room_type: connectRoomType });
    } catch (err: any) {
      console.error('roomAvailability error:', err);
      localError(res, 'Failed to load room availability', 500);
    }
  }

  // ── POST /booking/checkDataReservation ──
  static async checkDataReservation(req: Request, res: Response): Promise<void> {
    try {
      const { client_uid, room_type_name, check_in_date, check_out_date } = bodyOf(req);
      if (!client_uid) { localBadRequest(res, 'The client uid field is required.'); return; }
      if (!room_type_name) { localBadRequest(res, 'The room type name field is required.'); return; }
      if (!check_in_date) { localBadRequest(res, 'The check in date field is required.'); return; }
      if (!check_out_date) { localBadRequest(res, 'The check out date field is required.'); return; }

      const property = await resolveBookingEngineProperty(prisma, bodyOf(req));
      if (!property) { localNotFound(res, 'Property not found.'); return; }

      const roomType = await prisma.room_types.findFirst({
        where: {
          property_id: property.id,
          description: { equals: String(room_type_name).toLowerCase(), mode: 'insensitive' },
          deleted_at: null,
          status: STATUS_ACTIVE,
        },
      });
      if (!roomType) { localNotFound(res, 'Room Type not found.'); return; }

      const available = await BookingEngineController.getAvailableRoomTypeCount(
        roomType.id, property.id, check_in_date, check_out_date
      );
      localSuccess(res, { status: available > 0 }, 'Data has been loaded');
    } catch (err: any) {
      console.error('checkDataReservation error:', err);
      localError(res, 'Failed to check data reservation', 500);
    }
  }

  // ── POST /booking/masterBookingEngine ──
  static async masterBookingEngine(req: Request, res: Response): Promise<void> {
    try {
      const clientUid = String(bodyOf(req).client_uid ?? req.query.client_uid ?? '');
      if (!clientUid) { localBadRequest(res, 'The client uid field is required.'); return; }
      const property = await resolveBookingEngineProperty(prisma, bodyOf(req));
      if (!property) { localNotFound(res, 'Property not found.'); return; }
      const pid = property.id;

      const rooms = await prisma.rooms.findMany({
        where: { property_id: pid, deleted_at: null, status: STATUS_ACTIVE },
        orderBy: { name: 'asc' },
      });

      const roomTypes = await prisma.room_types.findMany({
        where: { property_id: pid, deleted_at: null, status: STATUS_ACTIVE },
        orderBy: { name: 'asc' },
        include: { rooms: true },
      });

      const images = await prisma.room_type_image.findMany({
        where: { property_id: pid, room_type_id: { in: roomTypes.map((rt) => rt.id) } },
      });
      const imageMap = new Map<number, string | null>();
      for (const img of images) if (img.room_type_id) imageMap.set(Number(img.room_type_id), img.image);

      const roomIds = roomTypes.flatMap((rt) => rt.rooms.map((r) => r.id));
      const roomTypeLinks = await prisma.model_has_types.findMany({
        where: { model_type: 'App\\Models\\Room', model_id: { in: roomIds } },
        include: { types: true },
      });
      const roomLinkMap = new Map<number, any[]>();
      for (const link of roomTypeLinks) {
        const key = Number(link.model_id);
        if (link.types?.group === 'room-configuration') {
          const list = roomLinkMap.get(key) ?? [];
          list.push(link.types);
          roomLinkMap.set(key, list);
        }
      }

      const feature = ['Free cancelation', 'Pay on arrival', 'Book now pay later'];
      const roomTypeOut = roomTypes.map((rt) => {
        const facilities: any[] = [];
        for (const room of rt.rooms ?? []) {
          for (const t of roomLinkMap.get(Number(room.id)) ?? []) {
            facilities.push({ id: toNum(t.id), name: t.name, image: t.image ? '/storage/' + t.image : null });
          }
        }
        const uniq = new Map<number, any>();
        for (const f of facilities) if (!uniq.has(f.id)) uniq.set(f.id, f);
        return {
          ...toNum(rt),
          image: imageMap.get(Number(rt.id)) ?? null,
          facilities: [...uniq.values()],
          feature: [feature[Math.floor(Math.random() * feature.length)], feature[Math.floor(Math.random() * feature.length)]],
        };
      });

      const rates = await prisma.rates.findMany({
        where: { property_id: pid, deleted_at: null, status: STATUS_ACTIVE, module: 'rate' },
        orderBy: { name: 'asc' },
      });

      localSuccess(res, { room: toNum(rooms), room_type: roomTypeOut, rate: toNum(rates) }, 'Data has been loaded');
    } catch (err: any) {
      console.error('masterBookingEngine error:', err);
      localError(res, 'Failed to load booking engine master', 500);
    }
  }

  // ── POST /booking/storeReservation ──
  static async storeReservation(req: Request, res: Response): Promise<void> {
      const logText = (text: string) => {
        let safe = text;
        try { safe = JSON.stringify(redactPayload(JSON.parse(text))); } catch { /* keep raw */ }
        return prisma.third_party_logs.create({ data: { name: 'save-syn-bo', text: safe } });
      };

    try {
      // Local handle for the whole handler: it reads ~30 body fields, and each
      // `req.body.x` would throw on a body-less call.
      const body = bodyOf(req);
      const required = ['client_uid', 'room_type_id', 'check_in_date', 'check_out_date', 'first_name', 'last_name', 'email', 'mobile_phone', 'rate_id', 'child', 'adult', 'uuid'];
      for (const f of required) {
        if (body[f] === undefined || body[f] === null || body[f] === '') {
          await logText(JSON.stringify({ validator: `The ${f.replace(/_/g, ' ')} field is required.` }));
          localBadRequest(res, `The ${f.replace(/_/g, ' ')} field is required.`);
          return;
        }
      }

      // Phone number is normalised here, at the last point before it is stored, because
      // it reaches this handler from a template literal in the booking engine frontend
      // (`confirm.tsx`) that had no dial code resolved: `undefined89643727587 `. That
      // string went into `folios`, `guest_profiles` and the Xendit invoice verbatim, and
      // it is the primary identifier a hotel uses to find a guest at the desk.
      //
      // Only digits survive, so a stray "undefined", "+", space or dash cannot ride along.
      // Rejected rather than repaired when nothing usable is left — an empty phone is not
      // a phone, and silently storing null would hide a broken form from the front desk.
      const mobilePhone = String(body.mobile_phone).replace(/\D/g, '');
      if (mobilePhone.length < 8 || mobilePhone.length > 20) {
        await logText(
          JSON.stringify({ validator: 'The mobile phone field is not a valid number.', mobile_phone: String(body.mobile_phone) }),
        );
        localBadRequest(res, 'The mobile phone field is not a valid number.');
        return;
      }
      body.mobile_phone = mobilePhone;

      const property = await resolveBookingEngineProperty(prisma, body);
      if (!property) {
        await logText(JSON.stringify({ validator: 'Property not found.' }));
        localNotFound(res, 'Property not found.');
        return;
      }
      const pid = property.id;
      const isTax = property.is_tax === 1;

      const user = await prisma.users.findFirst({ where: { last_property: pid } });
      if (!user) {
        await logText(JSON.stringify({ validator: 'User not found.' }));
        localNotFound(res, 'User not found.');
        return;
      }

      const logAudit = await prisma.log_audits.findFirst({
        where: { property_id: Number(pid), deleted_at: null },
        orderBy: { date: 'desc' },
      });
      const bizDate = logAudit ? fmtDate(dayAfter(logAudit.date)) : fmtDate(new Date());

      const roomType = body.room_type_name
        ? await prisma.room_types.findFirst({
            where: {
              property_id: pid,
              description: { equals: String(body.room_type_name).toLowerCase(), mode: 'insensitive' },
              deleted_at: null,
              status: STATUS_ACTIVE,
            },
          })
        : null;
      if (body.room_type_name && !roomType) {
        await logText(JSON.stringify({ validator: 'Room Type not found.' }));
        localNotFound(res, 'Room Type not found.');
        return;
      }
      const finalRoomTypeId = roomType ? roomType.id : bn(body.room_type_id);

      let availableCount = await BookingEngineController.getAvailableRoomTypeCount(
        finalRoomTypeId!, pid, body.check_in_date, body.check_out_date
      );
      if (availableCount <= 0) {
        const connect = await BookingEngineController.checkRoomConnect(finalRoomTypeId!, pid, {
          check_in_date: body.check_in_date,
          check_out_date: body.check_out_date,
        });
        if (!connect.status) {
          await logText(JSON.stringify({ validator: 'Room not available' }));
          localBadRequest(res, 'Room not available');
          return;
        }
        body.room_type_id = String(connect.room_type_id);
      }

      const companyProfile = await prisma.company_profiles.findFirst({
        where: { property_id: pid, is_company_booking_engine: true, deleted_at: null, status: STATUS_ACTIVE },
      });
      if (!companyProfile) {
        await logText(JSON.stringify({ validator: 'Company Profile not found.' }));
        localNotFound(res, 'Company Profile not found.');
        return;
      }

      // Email is the identity. Same address = same person, so a repeat booking reuses
      // the existing profile instead of forking a second one — and the guest keeps one
      // history instead of one history per spelling of their name.
      //
      // Matching on first_name + last_name (what the reference Laravel does, at
      // MiddlewareBookingEngineController.php:472) forks on every name change: the
      // measured result was `Rianto Dwi Putra` and `ianocent amemiya` on the same
      // uzumakirianto@gmail.com, two rows, because a booking engine sends the name as
      // typed and typing varies.
      //
      // Scoped to `property_id` because that is the shape of the table — every profile
      // belongs to one hotel, and a folio belongs to the hotel it was booked at, so
      // merging across properties would move folios between hotels. 71 addresses are
      // currently live in more than one property; those stay separate on purpose.
      //
      // `orderBy id asc` picks the oldest row, so the profile that predates any later
      // split is the one that survives. `mode: 'insensitive'` because 21,552 stored
      // addresses carry uppercase.
      //
      // The name is NOT overwritten on an email match. Same address with a different
      // name can be a different person typing into someone else's booking, and that
      // case is not settled yet — so the profile keeps the name it has and the guest
      // updates it themselves through pre-registration, which writes what they declare.
      const guestEmail = String(body.email ?? '').trim().toLowerCase();
      let guestProfile: any = null;
      if (guestEmail) {
        guestProfile = await prisma.guest_profiles.findFirst({
          where: {
            property_id: pid,
            deleted_at: null,
            status: STATUS_ACTIVE,
            email: { equals: guestEmail, mode: 'insensitive' },
          },
          orderBy: { id: 'asc' },
        });
      }
      if (!guestProfile) {
        // No usable email to match on: 22,055 profiles have none. Fall back to the name
        // so a walk-in or a guest who books without an address is still not duplicated.
        guestProfile = await prisma.guest_profiles.findFirst({
          where: {
            property_id: pid,
            deleted_at: null,
            status: STATUS_ACTIVE,
            first_name: body.first_name,
            last_name: body.last_name,
          },
        });
      }
      if (!guestProfile) {
        guestProfile = await prisma.guest_profiles.create({
          data: {
            property_id: pid,
            account: await nextGuestAccount(),
            first_name: body.first_name,
            last_name: body.last_name,
            email: body.email,
            mobile_phone: body.mobile_phone,
            status: STATUS_ACTIVE,
          },
        });
      }

      const typeGroups = ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source'];
      // Property-scoped (Laravel Type uses the HasProperties global scope).
      // Without this, pickFirst below returns whichever property's segment
      // happens to come first in id order — not this booking's.
      const typeList = await prisma.types.findMany({
        where: { group: { in: typeGroups }, deleted_at: null, status: STATUS_ACTIVE, property_id: pid },
      });
      const pickFirst = (group: string): { value: string; label: string } | undefined => {
        const t = typeList.find((x) => x.group === group);
        return t ? { value: String(t.id), label: t.name } : undefined;
      };

      let isPending = !!body.is_pending;
      const reservationList = Array.isArray(body.reservation_list) && body.reservation_list.length > 0
        ? body.reservation_list
        : [{
            check_in_date: body.check_in_date,
            check_out_date: body.check_out_date,
            night: diffDays(new Date(body.check_in_date), new Date(body.check_out_date)),
            adult: body.adult,
            child: body.child,
            add_bed: 0,
            rate_id: body.rate_id,
            room_type_id: String(finalRoomTypeId),
            room_id: null,
          }];

      for (const item of reservationList) {
        if (item.room_type_id) {
          const rtId = bn(item.room_type_id);
          if (rtId) {
            const rt = await prisma.room_types.findFirst({
              where: { id: rtId, property_id: pid, deleted_at: null },
            });
            if (rt) {
              const roomList = await BookingEngineController.getAvailableRoom(rt.id, pid, item.check_in_date, item.check_out_date);
              if (roomList.length === 0) isPending = true;
              const cnt = await BookingEngineController.getAvailableRoomTypeCount(rt.id, pid, item.check_in_date, item.check_out_date);
              if (cnt <= 0) isPending = true;
            }
          }
        }
      }

      // A retry of the same booking must reuse its folio. The nightly rows are deduped
      // on { folio_id, date }, so a second folio means a second full set of charges for
      // one booking — which is exactly what the (now fixed) /payment retry path and a
      // guest refreshing an expired checkout both lead to. Neither this endpoint nor the
      // Laravel reference dedups on booking_engine_uuid, so the guard lives here.
      const existingFolio = await prisma.folios.findFirst({
        where: { property_id: pid, booking_engine_uuid: body.uuid, deleted_at: null },
        orderBy: { id: 'desc' },
      });
      if (existingFolio) {
        // The previous attempt was voided by syncCheckStatusBookingEngine when Xendit
        // reported the invoice expired/voided, which parks the folio on
        // cancel_reservation. A genuine new attempt has to reactivate it, otherwise the
        // guest pays and nothing is reserved.
        await prisma.folios.update({
          where: { id: existingFolio.id },
          data: {
            status_reservation: isPending ? STATUS_RESERVATION.pending : STATUS_RESERVATION.reservation,
          },
        });
        await logText(
          JSON.stringify({
            idempotent: 'storeReservation reused folio',
            folio_id: String(existingFolio.id),
            folio_number: existingFolio.folio_number,
            uuid: body.uuid,
          }),
        );
        localSuccess(
          res,
          { folio_id: String(existingFolio.id), folio_number: existingFolio.folio_number, reused: true },
          'Success',
        );
        return;
      }

      const yymm = new Date().toISOString().substring(2, 7).replace('-', '');
      const bookingNoPrefix = 'OL' + String(pid).padStart(3, '0') + yymm;
      // Count the tail in JS instead of /(\d+)$/ on booking_no: that regex is anchored
      // only at the end, so on "OL99926100001" it captures "99926100001" rather than
      // "00001" and every retry after the first booking of a month produced
      // OL999261099926100002. Ordering by the string also picks that malformed row as
      // "last", which would reset the counter to 0001 and collide.
      const sameSeries = await prisma.folios.findMany({
        where: { booking_no: { startsWith: bookingNoPrefix } },
        select: { booking_no: true },
      });
      let maxSeq = 0;
      for (const row of sameSeries) {
        const tail = String(row.booking_no ?? '').slice(bookingNoPrefix.length);
        if (/^\d{1,4}$/.test(tail)) maxSeq = Math.max(maxSeq, parseInt(tail, 10));
      }
      const bookingNo = bookingNoPrefix + String(maxSeq + 1).padStart(4, '0');

      // Same series as booking_no, generated the Laravel way (utils/folioNumber.ts).
      // Computed BEFORE the insert so the row is never briefly numberless, which is
      // what put a literal "null" in the notification list and made pre-registration
      // lookups impossible.
      const folioNumber = await generateFolioNumber(prisma, {
        propertyId: pid,
        typeReservation: 'fit',
      });

      try {
        const folioData: any = {
          property_id: pid,
          company_profile_id: companyProfile.id,
          company_name: companyProfile.name || null,
          guest_profile_id: guestProfile.id,
          first_name: body.first_name,
          last_name: body.last_name,
          email: body.email,
          mobile_phone: body.mobile_phone,
          is_booking_engine: true,
          is_payment_booking_engine: true,
          is_compliment_tour_leader: false,
          booking_engine_uuid: body.uuid,
          booking_no: bookingNo,
          folio_number: folioNumber,
          type_reservation: 'fit',
          res_date: new Date(),
          res_time: new Date(),
          check_in_date: new Date(body.check_in_date),
          check_out_date: new Date(body.check_out_date),
          status_reservation: isPending ? STATUS_RESERVATION.pending : STATUS_RESERVATION.reservation,
          total_amount: body.totalAmount !== undefined ? Number(body.totalAmount) : 0,
          status: STATUS_ACTIVE,
        };
        let folio: any;
        try {
          folio = await prisma.folios.create({ data: folioData });
        } catch (createErr: any) {
          // Two bookings that read the same "last folio" race on the UNIQUE
          // folio_number index. Recompute and retry instead of handing the guest a 500
          // for a payment that otherwise succeeded.
          const duplicate = createErr?.code === 'P2002' || /folio_number|duplicate key/i.test(String(createErr?.message ?? ''));
          if (!duplicate) throw createErr;
          await logText(JSON.stringify({ retry: 'folio_number collision', first: folioNumber }));
          folioData.folio_number = await generateFolioNumber(prisma, {
            propertyId: pid,
            typeReservation: 'fit',
          });
          folio = await prisma.folios.create({ data: folioData });
        }

        await BookingEngineController.syncTypes(folio.id, typeList, pickFirst);

        // saveReservation parity (per-night pricing)
        const rateId = bn(body.rate_id);
        const rate = rateId ? await prisma.rates.findUnique({ where: { id: rateId }, include: { code_posts: true } }) : null;
        const codePost = rate?.code_posts ?? null;
        const codePostExtraBed = rate?.code_post_extra_bed_id
          ? await prisma.code_posts.findUnique({ where: { id: rate.code_post_extra_bed_id } })
          : null;

        for (const item of reservationList) {
          const ci = new Date(item.check_in_date);
          const coRaw = new Date(item.check_out_date);
          const co = coRaw <= ci ? addDays(ci, 1) : coRaw;
          const nights = diffDays(ci, co);
          const itemRateId = bn(item.rate_id) ?? rateId;
          const itemRoomTypeId = bn(item.room_type_id) ?? finalRoomTypeId;
          if (!itemRateId || !itemRoomTypeId) continue;

          for (let i = 0; i < nights; i++) {
            const night = addDays(ci, i);
            const adult = Number(item.adult || 1);
            const child = Number(item.child || 0);
            const addBed = Number(item.add_bed || 0);
            const oneAdult = adult === 1;
            const twoAdult = adult > 1;
            const extraAdult = adult > 2;
            const hasChild = child > 0;

            const rateRates = await prisma.rate_rates.findMany({
              where: {
                rate_id: itemRateId,
                room_type_id: itemRoomTypeId,
                date: night,
                min_night: { lte: nights },
                max_night: { gte: nights },
                stop_sell: 0,
                deleted_at: null,
              },
            });

            let totalRatePrice = 0;
            if (rateRates.length === 0) {
              const rt = await prisma.room_types.findUnique({ where: { id: itemRoomTypeId } });
              totalRatePrice = Number(rt?.rate ?? 0);
            } else {
              for (const rr of rateRates) {
                if (oneAdult) totalRatePrice += Number(rr.one_adult);
                if (twoAdult) totalRatePrice += Number(rr.two_adult);
                if (extraAdult) totalRatePrice += (adult - 2) * Number(rr.extra_adult);
                if (hasChild) totalRatePrice += child * Number(rr.extra_child);
              }
            }

            let totalRatePriceExtraBed = 0;
            if (addBed > 0) {
              const extraBeds = await prisma.rate_extra_bed_inclusives.findMany({
                where: { rate_id: itemRateId, deleted_at: null },
              });
              for (const eb of extraBeds) totalRatePriceExtraBed += Number(eb.cost) * addBed;
            }

            let calc = { amount: 0, service: 0, tax3: 0, pb1: 0, total: 0 };
            if (codePost) calc = calculateCodePost(codePost as any, totalRatePrice, isTax);
            let calcEb = { amount: 0, service: 0, tax3: 0, pb1: 0, total: 0 };
            if (codePostExtraBed) calcEb = calculateCodePost(codePostExtraBed as any, totalRatePriceExtraBed, isTax);

            const existing = await prisma.reservations.findFirst({
              where: { folio_id: folio.id, date: night },
            });
            const resData = {
              rate_id: itemRateId,
              rate_name: rate?.name || null,
              room_type_id: itemRoomTypeId,
              room_id: item.room_id ? bn(item.room_id) : null,
              adult,
              child,
              add_bed: addBed,
              check_in_date: ci,
              check_out_date: co,
              date: night,
              night: nights,
              data: JSON.stringify({
                rate_price: calc.amount,
                service: calc.service,
                pb1: calc.pb1,
                tax3: calc.tax3,
                total: calc.total,
              }),
              amountt: calc.amount,
              service_charge: calc.service,
              total: calc.total,
              amount_extra_bed: calcEb.amount,
              service_charge_extra_bed: calcEb.service,
              total_extra_bed: calcEb.total,
              status_reservation: isPending ? STATUS_RESERVATION.pending : STATUS_RESERVATION.reservation,
              status: STATUS_ACTIVE,
            };
            if (existing) {
              await prisma.reservations.update({ where: { id: existing.id }, data: resData });
            } else {
              await prisma.reservations.create({
                data: { ...resData, folio_id: folio.id, property_id: pid, created_by: user.id },
              });
            }
          }
        }

        // checkYields parity (min_rate)
        const yieldsCheck = await BookingEngineController.checkYields(folio.id, pid, isTax);
        if (!yieldsCheck) {
          await prisma.folios.update({
            where: { id: folio.id },
            data: { status_reservation: STATUS_RESERVATION.pending },
          });
        }

        localSuccess(res, {}, 'Success');
      } catch (err: any) {
        await logText(JSON.stringify({ validator: err.message || 'Something went wrong' }));
        console.error('storeReservation error:', err);
        localError(res, 'Something went wrong', 400);
      }
    } catch (err: any) {
      console.error('storeReservation outer error:', err);
      localError(res, 'Something went wrong', 400);
    }
  }

  // ── POST /booking/preCheckIn ──
  static async preCheckIn(req: Request, res: Response): Promise<void> {
    try {
      const { client_uid, uuid, date_arrival } = bodyOf(req);
      if (!client_uid) { localBadRequest(res, 'The client uid field is required.'); return; }
      if (!uuid) { localBadRequest(res, 'The uuid field is required.'); return; }
      if (!date_arrival) { localBadRequest(res, 'The date arrival field is required.'); return; }
      const property = await resolveBookingEngineProperty(prisma, bodyOf(req));
      if (!property) { localNotFound(res, 'Property not found.'); return; }
      const folio = await prisma.folios.findFirst({
        where: { property_id: property.id, booking_engine_uuid: uuid },
      });
      if (!folio) { localNotFound(res, 'Folio not found.'); return; }
      await prisma.folios.update({
        where: { id: folio.id },
        data: { date_arrival: new Date(date_arrival) },
      });
      localSuccess(res, {}, 'Success');
    } catch (err: any) {
      console.error('preCheckIn error:', err);
      localError(res, 'Failed to pre check in', 500);
    }
  }

  // ── POST /booking/cancelReservation ──
  static async cancelReservation(req: Request, res: Response): Promise<void> {
    try {
      const { client_uid, uuid } = bodyOf(req);
      if (!client_uid) { localBadRequest(res, 'The client uid field is required.'); return; }
      if (!uuid) { localBadRequest(res, 'The uuid field is required.'); return; }
      const property = await resolveBookingEngineProperty(prisma, bodyOf(req));
      if (!property) { localNotFound(res, 'Property not found.'); return; }
      const folio = await prisma.folios.findFirst({
        where: { property_id: property.id, booking_engine_uuid: uuid },
      });
      if (!folio) { localNotFound(res, 'Folio not found.'); return; }
      await prisma.folios.update({
        where: { id: folio.id },
        data: { is_request_cancel: true },
      });
      localSuccess(res, {}, 'Success');
    } catch (err: any) {
      console.error('cancelReservation error:', err);
      localError(res, 'Failed to cancel reservation', 500);
    }
  }

  // ── Helpers (RoomType model parity) ──

  private static async getAvailableRoomsBase(roomTypeId: bigint, pid: bigint, ci: string, co: string, excludeBlocked: boolean): Promise<any[]> {
    const ciDate = new Date(ci);
    const coDate = new Date(co);
    const blocked = excludeBlocked
      ? [ROOM_STATUSES.block.id, ROOM_STATUSES.out_of_order.id]
      : [ROOM_STATUSES.out_of_order.id];
    const rooms = await prisma.rooms.findMany({
      where: {
        room_type_id: roomTypeId,
        property_id: pid,
        deleted_at: null,
        status: STATUS_ACTIVE,
        room_status: { notIn: blocked },
        NOT: {
          work_orders: {
            some: {
              date: { lte: ciDate },
              AND: [{ end_date: { gt: coDate } }, { end_date: { not: null } }],
              deleted_at: null,
            },
          },
        },
      },
      orderBy: { room_status: 'asc' },
    });

    // room_availabilities (schema: room_id Int, no relation to rooms)
    const avail = await prisma.room_availabilities.findMany({
      where: { date: { gte: ciDate, lt: coDate }, deleted_at: null },
    });
    const availRoomIds = new Set(avail.map((a) => Number(a.room_id)));
    const filteredRooms = rooms.filter((r) => !availRoomIds.has(Number(r.id)));

    const reservations = await prisma.reservations.findMany({
      where: {
        date: { gte: ciDate, lt: coDate },
        folios: { status_reservation: { in: [STATUS_RESERVATION.check_in, STATUS_RESERVATION.reservation] } },
        OR: [{ room_type_id: roomTypeId }, { room_type_id_next: roomTypeId }],
      },
      select: { room_id: true },
    });
    const occupiedIds = new Set(
      reservations.filter((r) => r.room_id && r.room_id > 0n).map((r) => r.room_id!.toString())
    );
    return filteredRooms.filter((r) => !occupiedIds.has(r.id.toString()));
  }

  private static async getAvailableRoom(roomTypeId: bigint, pid: bigint, ci: string, co: string): Promise<any[]> {
    return BookingEngineController.getAvailableRoomsBase(roomTypeId, pid, ci, co, false);
  }

  private static async getAvailableRoomTypeCount(roomTypeId: bigint, pid: bigint, ci: string, co: string): Promise<number> {
    const rooms = await BookingEngineController.getAvailableRoomsBase(roomTypeId, pid, ci, co, true);
    const ciDate = new Date(ci);
    const coDate = new Date(co);
    const reservations = await prisma.reservations.findMany({
      where: {
        date: { gte: ciDate, lt: coDate },
        folios: { status_reservation: { in: [STATUS_RESERVATION.check_in, STATUS_RESERVATION.reservation] } },
        OR: [{ room_type_id: roomTypeId }, { room_type_id_next: roomTypeId }],
      },
      select: { folio_id: true, room_id: true },
    });
    const nullFolios = new Set(
      reservations.filter((r) => r.room_id === null || r.room_id === 0n).map((r) => r.folio_id.toString())
    );
    const count = rooms.length - nullFolios.size;
    return count < 0 ? 0 : count;
  }

  private static async checkRoomConnect(
    roomTypeId: bigint,
    pid: bigint,
    valueData: { check_in_date: string; check_out_date: string }
  ): Promise<{ status: boolean; room_type_id?: bigint }> {
    const contentRoom = await prisma.content_rooms.findFirst({
      where: { property_id: pid, room_type_id: roomTypeId, deleted_at: null, status: STATUS_ACTIVE },
    });
    if (!contentRoom) return { status: false };
    let roomTypeIds: number[] = [];
    try { roomTypeIds = (JSON.parse(contentRoom.data || '{}')?.room_type_ids ?? []) as number[]; } catch { roomTypeIds = []; }
    for (const rtId of roomTypeIds) {
      const rt = bn(rtId);
      if (!rt) continue;
      const checkRoomType = await prisma.room_types.findFirst({
        where: { id: rt, property_id: pid, deleted_at: null },
      });
      if (checkRoomType) {
        const rooms = await BookingEngineController.getAvailableRoom(checkRoomType.id, pid, valueData.check_in_date, valueData.check_out_date);
        const cnt = await BookingEngineController.getAvailableRoomTypeCount(checkRoomType.id, pid, valueData.check_in_date, valueData.check_out_date);
        if (rooms.length > 0 || cnt > 0) {
          return { status: true, room_type_id: checkRoomType.id };
        }
      }
    }
    return { status: false };
  }

  // Laravel HasTypes::syncTypes parity (type groups only)
  private static async syncTypes(
    folioId: bigint,
    typeList: any[],
    pickFirst: (g: string) => { value: string; label: string } | undefined
  ): Promise<void> {
    const groups = ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source'];
    const ids: string[] = [];
    for (const g of groups) {
      const picked = pickFirst(g);
      if (picked) ids.push(picked.value);
    }
    const typeIds = typeList.filter((t) => ids.includes(String(t.id))).map((t) => t.id);
    await prisma.model_has_types.deleteMany({ where: { model_type: 'App\\Models\\Folio', model_id: folioId } });
    if (typeIds.length > 0) {
      await prisma.model_has_types.createMany({
        data: typeIds.map((tid) => ({
          model_type: 'App\\Models\\Folio',
          model_id: folioId,
          type_id: tid,
        })),
      });
    }
  }

  // Laravel Folio::checkYields parity (simplified: first reservation + yields min_rate)
  private static async checkYields(folioId: bigint, pid: bigint, isTax: boolean): Promise<boolean> {
    const folio = await prisma.folios.findUnique({ where: { id: folioId } });
    if (!folio || (folio.type_reservation !== 'fit' && folio.type_reservation !== 'git')) return true;
    const reservation = await prisma.reservations.findFirst({
      where: { folio_id: folioId },
      orderBy: { date: 'asc' },
    });
    if (!reservation) return true;
    const sameDayCount = await prisma.reservations.count({
      where: {
        date: reservation.date,
        room_type_id: reservation.room_type_id,
        folios: { status_reservation: { not: STATUS_RESERVATION.cancel_reservation } },
      },
    });
    const roomType = await prisma.room_types.findUnique({ where: { id: reservation.room_type_id ?? 0n } });
    if (!roomType || !reservation.room_type_id) return true;
    const totalRooms = await prisma.rooms.count({
      where: { room_type_id: reservation.room_type_id, property_id: pid, deleted_at: null },
    });
    const occupancy = totalRooms > 0 ? Math.round((sameDayCount / totalRooms) * 100) : 0;
    const yieldRow = await prisma.yields.findFirst({
      where: {
        start_date: { lte: reservation.date },
        end_date: { gte: reservation.date },
        occupancy_from: { lte: occupancy },
        occupancy_to: { gte: occupancy },
        OR: [{ room_type_id: reservation.room_type_id }, { is_general: 1 }],
        status: STATUS_ACTIVE,
      },
      orderBy: { is_general: 'asc' },
    });
    if (yieldRow) {
      const amount = isTax ? Number(reservation.total ?? 0) : Number(reservation.amountt ?? 0);
      if (Number(yieldRow.min_rate) > amount) return false;
    }
    return true;
  }
}
