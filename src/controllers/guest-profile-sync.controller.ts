import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

/**
 * POST /middleware/guest/profile-sync
 *
 * Push the booking engine's guest profile into HMS.
 *
 * The booking engine keeps the guest in its own MySQL `users` table and HMS keeps them in
 * Postgres `guest_profiles`. Until now nothing connected the two, so:
 *
 *  - The guest edits their address, date of birth, city on `/{slug}/guest-profile`, gets a
 *    "Success", and the front desk at `3000/profile/guest/main?data=<id>` still shows the
 *    old values — the guest profile page and the PMS disagreed about the same person.
 *  - Every new booking re-collected name, email and phone from the booking form, because
 *    the PMS copy is what a reservation is written from and it was never populated from
 *    the profile the guest had already filled in.
 *
 * Matching is by email, which is the identity `storeReservation` already settled on (see
 * Phase 10c): email is what the guest can correct, a name is not. Scope is per property —
 * `guest_profiles.property_id` is the hotel that owns the profile, and merging profiles
 * across hotels would mean moving folios between them.
 *
 * Only fields the caller actually sent are written, so a partial push (the booking engine
 * has no photo of the guest in the PMS sense, for instance) cannot blank a value the PMS
 * already holds.
 */
export class GuestProfileSyncController {
  static async sync(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
      const email = String(body.email ?? '').trim().toLowerCase();

      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        res.status(400).json({ code: 400, message: 'The email field is required.' });
        return;
      }

      const clientUid = body.client_uid === undefined || body.client_uid === null
        ? ''
        : String(body.client_uid).trim();

      // Same ambiguity `resolveBookingEngineProperty` documents: `client_uid` is '1' for
      // three different properties in the booking engine. Fall back to the folio the guest
      // just booked, which is already resolved to one property server-side.
      let pid: bigint | null = null;
      if (body.property_id !== undefined && body.property_id !== null && body.property_id !== '') {
        pid = toBigInt(body.property_id);
      }
      if (pid === null && clientUid !== '') {
        pid = await resolveByClientUid(clientUid);
      }
      if (pid === null && body.booking_engine_uuid) {
        const folio: any = await prisma.folios.findFirst({
          where: { booking_engine_uuid: String(body.booking_engine_uuid), deleted_at: null },
          orderBy: { id: 'desc' },
          select: { property_id: true },
        });
        if (folio?.property_id !== null && folio?.property_id !== undefined) pid = BigInt(String(folio.property_id));
      }
      if (pid === null) {
        res.status(404).json({ code: 404, message: 'Could not resolve the property for this guest.' });
        return;
      }

      const guests = await prisma.guest_profiles.findMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          property_id: pid,
          deleted_at: null,
        },
        orderBy: { id: 'asc' },
        take: 2,
      });

      if (guests.length === 0) {
        // Nothing to update. The PMS creates the profile when the first reservation is
        // stored, so this is the normal state for a guest who updated their profile
        // before their first booking.
        res.json({
          code: 200,
          message: 'No HMS guest profile to update yet.',
          data: { updated: 0 },
        });
        return;
      }

      const guest = guests[0];

      const data: any = {};
      if (hasText(body.first_name)) data.first_name = String(body.first_name).trim();
      if (hasText(body.last_name)) data.last_name = String(body.last_name).trim();
      if (hasText(body.gender)) data.gender = String(body.gender).trim();
      if (hasText(body.address)) data.address = String(body.address).trim();
      if (hasText(body.postal_code)) data.postal_code = String(body.postal_code).trim();

      // Phone: digits only, and only when something usable survives. The booking engine
      // stores it with the dial code (`6281389962997`) while the PMS forms have always
      // mixed both, so the value is accepted as sent rather than re-parsed.
      const phone = String(body.mobile_phone ?? '').replace(/\D/g, '');
      if (phone.length >= 8 && phone.length <= 20) data.mobile_phone = phone;

      if (hasText(body.dob)) {
        const dob = new Date(String(body.dob));
        if (!Number.isNaN(dob.getTime())) data.birth_of_date = dob;
      }

      // `guest_profiles.country_id` / `.city_id` are INTEGER while `countries.id` and
      // `cities.id` are bigint, so the same range-guarded conversion `toIntFk` does in the
      // pre-registration controller applies here. Silently truncating would attach the
      // guest to a different country.
      if (hasText(body.country)) {
        const countryId = await resolveCountry(String(body.country).trim());
        if (countryId !== null) data.country_id = toIntFk(countryId, 'guest.country_id');
      }
      if (hasText(body.city)) {
        const cityId = await resolveCity(String(body.city).trim());
        if (cityId !== null) data.city_id = toIntFk(cityId, 'guest.city_id');
      }

      const keys = Object.keys(data);
      if (keys.length === 0) {
        res.json({ code: 200, message: 'Nothing to sync.', data: { updated: 0, fields: [] } });
        return;
      }

      await prisma.guest_profiles.update({ where: { id: guest.id }, data });

      // A folio is the legal document for ONE stay, so it is not rewritten here. But the
      // folio that is still open for this guest — the one they are being asked to complete
      // — should carry the snapshot they just gave, or the pre-registration page shows the
      // booking-time values next to the corrected ones. Only the most recent booking-engine
      // folio that has not been completed is touched.
      if (body.sync_open_folio !== false) {
        const openFolio: any = await prisma.folios.findFirst({
          where: {
            guest_profile_id: guest.id,
            booking_engine_uuid: { not: null },
            pre_registration_completed_at: null,
            deleted_at: null,
          },
          orderBy: { id: 'desc' },
          select: { id: true },
        });
        if (openFolio?.id) {
          const folioData: any = {};
          if (data.first_name !== undefined) folioData.first_name = data.first_name;
          if (data.last_name !== undefined) folioData.last_name = data.last_name;
          if (data.address !== undefined) folioData.address = data.address;
          if (data.postal_code !== undefined) folioData.postal_code = data.postal_code;
          if (data.mobile_phone !== undefined) folioData.mobile_phone = data.mobile_phone;
          if (data.gender !== undefined) folioData.gender = data.gender;
          if (data.country_id !== undefined) folioData.country_id = data.country_id;
          if (data.city_id !== undefined) folioData.city_id = data.city_id;
          if (Object.keys(folioData).length > 0) {
            await prisma.folios.update({ where: { id: openFolio.id }, data: folioData });
          }
        }
      }

      res.json({
        code: 200,
        message: 'Guest profile synced to HMS.',
        data: {
          updated: 1,
          guest_profile_id: String(guest.id),
          fields: keys,
          duplicates: guests.length > 1 ? guests.slice(1).map((g: any) => String(g.id)) : [],
        },
      });
    } catch (err: any) {
      console.error('Guest profile sync error:', err);
      res.status(500).json({ code: 500, message: 'Failed to sync guest profile: ' + (err?.message ?? 'unknown') });
    }
  }
}

function hasText(v: any): boolean {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function toBigInt(v: any): bigint | null {
  const digits = String(v).replace(/\D/g, '');
  if (!digits) return null;
  try {
    return BigInt(digits);
  } catch {
    return null;
  }
}

function toIntFk(id: bigint | number, label: string): number | null {
  const n = Number(id);
  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
    // Storing a truncated id would attach the guest to a different country/city, which is
    // worse than storing nothing.
    console.warn(`[GuestProfileSyncController] ${label}: ${id} is outside int4 — skipped`);
    return null;
  }
  return n;
}

async function resolveByClientUid(clientUid: string): Promise<bigint | null> {
  const rows: any[] = await prisma.properties.findMany({
    where: { client_uid: clientUid, deleted_at: null },
    orderBy: { id: 'asc' },
    select: { id: true },
    take: 5,
  });
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    console.warn(
      `[GuestProfileSyncController] client_uid="${clientUid}" matches ${rows.length} properties ` +
        `(${rows.map((r) => String(r.id)).join(', ')}); using the first.`,
    );
  }
  return BigInt(String(rows[0].id));
}

async function resolveCountry(value: string): Promise<bigint | null> {
  const asId = toBigInt(value);
  const rows: any[] = await prisma.$queryRaw`
    select id from countries
     where (${asId}::bigint is not null and id = ${asId}::bigint)
        or lower(name) = lower(${value})
        or lower(iso2) = lower(${value})
     order by id asc
     limit 1
  `;
  return rows[0]?.id !== undefined ? BigInt(String(rows[0].id)) : null;
}

async function resolveCity(value: string): Promise<bigint | null> {
  const asId = toBigInt(value);
  const rows: any[] = await prisma.$queryRaw`
    select id from cities
     where (${asId}::bigint is not null and id = ${asId}::bigint)
        or lower(name) = lower(${value})
     order by id asc
     limit 1
  `;
  return rows[0]?.id !== undefined ? BigInt(String(rows[0].id)) : null;
}

export default GuestProfileSyncController;