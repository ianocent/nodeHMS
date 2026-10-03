import { prisma } from '../config/prisma';
import { Request, Response } from 'express';

// Laravel parity: App\Http\Controllers\Cms\Hotel\Middleware\PreRegistrationController
// (routes/web.php:141-145, `Route::prefix('middleware')`, NO auth).
// hmsBookingEngine proxies the guest portal form through
// config('cms.apihms_middleware_curl') = APP_HMS_URL . '/middleware', so these
// handlers are the ones that actually persist the guest data on the HMS side.
//
// Pre-registration is pure HMS/Postgres - the booking engine never stores it.

// config('cms.status_reservation') check_out.id = 1, cancel_reservation.id = 2
// (mirrors STATUS_RESERVATION_MAP in utils/cmsStatus.ts).
const BLOCKED_STATUS_RESERVATION = [1, 2];

function normalizeDate(value: any): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function fail(res: Response, code: number, message: string): void {
  res.status(code).json({ code, message });
}

async function findFolio(folioNumber: string, token: string | null) {
  const folio: any = await prisma.folios.findFirst({
    where: { folio_number: folioNumber },
    include: {
      guest_profiles: true,
      properties: { select: { name: true } },
      reservations: {
        where: { deleted_at: null },
        orderBy: { id: 'desc' },
        take: 1,
        include: { room_types: true, rooms: { select: { name: true } } },
      },
    },
  });

  if (!folio) {
    return { folio: null, error: { code: 404, message: 'Folio tidak ditemukan.' } };
  }

  if (folio.status_reservation !== null && BLOCKED_STATUS_RESERVATION.includes(Number(folio.status_reservation))) {
    return { folio: null, error: { code: 400, message: 'Reservasi telah dibatalkan atau selesai.' } };
  }

  if (folio.pre_registration_completed_at) {
    return { folio: null, error: { code: 400, message: 'Pre-registration sudah pernah disimpan.' } };
  }

  if (token) {
    if (!folio.pre_registration_token || folio.pre_registration_token !== token) {
      return { folio: null, error: { code: 400, message: 'Token tidak valid.' } };
    }
    if (folio.pre_registration_expires_at && new Date(folio.pre_registration_expires_at).getTime() < Date.now()) {
      return { folio: null, error: { code: 400, message: 'Link pre-registration telah kedaluwarsa.' } };
    }
  }

  return { folio, error: null };
}

export class PreRegistrationController {
  /** GET|POST /middleware/pre-registration/verify */
  static async verify(req: Request, res: Response): Promise<void> {
    try {
      const folioNumber = req.body?.folio_number ?? req.query.folio_number;
      const token = req.body?.token ?? req.query.token ?? null;

      if (!folioNumber || typeof folioNumber !== 'string' || folioNumber.length > 20) {
        fail(res, 400, 'The folio number field is required. (or max:20)');
        return;
      }
      if (token && String(token).length > 64) {
        fail(res, 400, 'The token field must not be greater than 64 characters.');
        return;
      }

      const result = await findFolio(folioNumber, token ? String(token) : null);
      if (!result.folio) {
        fail(res, result.error!.code, result.error!.message);
        return;
      }

      const folio: any = result.folio;
      const guest: any = folio.guest_profiles;

      const [city, country, titleType] = await Promise.all([
        guest?.city_id ? prisma.cities.findUnique({ where: { id: BigInt(guest.city_id) }, select: { name: true } }) : null,
        guest?.country_id ? prisma.countries.findUnique({ where: { id: BigInt(guest.country_id) }, select: { name: true } }) : null,
        guest
          ? prisma.model_has_types.findFirst({
              where: { model_id: guest.id, model_type: 'App\\Models\\GuestProfile' },
              include: { types: { select: { name: true, group: true } } },
            })
          : null,
      ]);

      const title = titleType?.types?.group === 'guest-title' ? titleType.types.name : '';
      const reservation: any = folio.reservations?.[0] ?? null;
      const roomType: any = reservation?.room_types ?? null;

      res.json({
        code: 200,
        message: 'Success',
        data: {
          title,
          first_name: guest?.first_name ?? '',
          last_name: guest?.last_name ?? '',
          gender: guest?.gender ?? '',
          birth_of_date: normalizeDate(guest?.birth_of_date),
          email: guest?.email ?? folio.email ?? '',
          mobile_phone: guest?.mobile_phone ?? '',
          address: guest?.address ?? '',
          region: guest?.region ?? '',
          city: city?.name ?? '',
          country: country?.name ?? '',
          postal_code: guest?.postal_code ?? '',
          card_type: guest?.card_type ?? '',
          card_number: guest?.card_number ?? '',
          card_expiry: guest?.card_expiry ?? '',
          property_name: folio.properties?.name ?? '',
          check_in_date: normalizeDate(folio.check_in_date),
          check_out_date: normalizeDate(folio.check_out_date),
          room_type: roomType?.name ?? '',
          room_name: reservation?.rooms?.name ?? '',
          room_desc: roomType?.description ?? '',
        },
      });
    } catch (err: any) {
      console.error('Pre-registration verify error:', err);
      fail(res, 500, 'Failed to verify: ' + (err?.message ?? 'unknown error'));
    }
  }

  /** POST /middleware/pre-registration/complete */
  static async complete(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const errors: string[] = [];
      if (!body.folio_number || typeof body.folio_number !== 'string' || body.folio_number.length > 20) {
        errors.push('The folio number field is required. (or max:20)');
      }
      if (!body.first_name || !body.last_name) errors.push('The first name field is required. (and last name)');
      if (!body.email || !/^\S+@\S+\.\S+$/.test(String(body.email))) errors.push('The email field is required. (or invalid)');
      if (!body.mobile_phone) errors.push('The mobile phone field is required.');
      if (body.token && String(body.token).length > 64) errors.push('The token must not be greater than 64 characters.');
      if (errors.length) {
        fail(res, 400, errors[0]);
        return;
      }

      const result = await findFolio(String(body.folio_number), body.token ? String(body.token) : null);
      if (!result.folio) {
        fail(res, result.error!.code, result.error!.message);
        return;
      }

      const folio: any = result.folio;
      let guest: any = folio.guest_profiles;

      if (!guest) {
        // GuestProfile::create with the next GA###### account number.
        const last = await prisma.guest_profiles.findFirst({
          where: { property_id: folio.property_id },
          orderBy: { account: 'desc' },
        });
        const nextNum = Number(String(last?.account ?? 'GA000000').slice(2)) + 1;
        const account = 'GA' + String(nextNum).padStart(6, '0');
        guest = await prisma.guest_profiles.create({
          data: { property_id: folio.property_id, account, status: 1 },
        });
      }

      // Reference resolves city/country with a LIKE match and, when a country was
      // given, narrows the city search to that country first.
      let country: any = null;
      if (body.country) {
        country = await prisma.countries.findFirst({
          where: { name: { contains: String(body.country), mode: 'insensitive' } },
        });
      }

      let city: any = null;
      if (body.city) {
        const cityWhere: any = { name: { contains: String(body.city), mode: 'insensitive' } };
        if (country) cityWhere.country_id = BigInt(country.id);
        city = await prisma.cities.findFirst({ where: cityWhere });
      }

      const data: any = {
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        mobile_phone: body.mobile_phone,
        gender: body.gender ?? null,
        birth_of_date: body.birth_of_date ? new Date(body.birth_of_date) : null,
        address: body.address ?? null,
        region: body.region ?? null,
        city_id: city ? city.id : null,
        country_id: country ? country.id : null,
        nationality_id: country ? country.id : null,
        postal_code: body.postal_code ?? null,
        card_type: body.card_type ?? null,
        card_number: body.card_number ?? null,
        card_expiry: body.card_expiry ?? null,
        updated_at: new Date(),
      };
      await prisma.guest_profiles.update({ where: { id: guest.id }, data });

      if (body.title) {
        const titleType = await prisma.types.findFirst({
          where: {
            group: 'guest-title',
            name: { equals: String(body.title).trim(), mode: 'insensitive' },
          },
        });
        if (titleType) {
          await prisma.model_has_types.upsert({
            where: {
              type_id_model_id_model_type: {
                type_id: titleType.id,
                model_id: guest.id,
                model_type: 'App\\Models\\GuestProfile',
              },
            },
            create: { type_id: titleType.id, model_id: guest.id, model_type: 'App\\Models\\GuestProfile' },
            update: {},
          });
        }
      }

      const folioData: any = { pre_registration_completed_at: new Date() };
      if (!folio.guest_profile_id) folioData.guest_profile_id = guest.id;
      await prisma.folios.update({ where: { id: folio.id }, data: folioData });

      res.json({ code: 200, message: 'Pre-registration berhasil disimpan.' });
    } catch (err: any) {
      console.error('Pre-registration complete error:', err);
      fail(res, 500, 'Failed to submit: ' + (err?.message ?? 'unknown error'));
    }
  }
}