import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { success, error, badRequest, notFound } from '../utils/response';
import { calculateCodePost } from '../utils/cmsConfig';
import { occupancyPrice } from '../utils/reservationPricing';
import { StaahService } from '../services/staah.service';
import { createStaahBookingCore } from './staah-webhook.controller';
import { enqueueJob } from '../config/queue';

const staahService = new StaahService();

function bigintToNumber(val: any): any {
    if (val instanceof Date) {
      const u = val.getUTCFullYear();
      const iso = val.toISOString();
      if (u === 1970 && val.getUTCMonth() === 0 && val.getUTCDate() === 1) return iso.slice(11, 19);
      const s = iso.slice(0, 19).replace('T', ' ');
      return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
    }
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
    return out;
  }
  return val;
}

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function buildAriPayload(interface_: any, dateFrom: string, dateTo: string, onlyRateId?: bigint | number): Promise<any[]> {
  const roomMappings = await prisma.staah_room_mappings.findMany({
    where: { staah_interface_id: interface_.id, deleted_at: null, status: 'active' },
  });
  let rateMappings = await prisma.staah_rate_mappings.findMany({
    where: { staah_interface_id: interface_.id, deleted_at: null, status: 'active' },
  });
  if (onlyRateId !== undefined) {
    const want = BigInt(onlyRateId);
    rateMappings = rateMappings.filter((r: any) => BigInt(r.rate_id) === want);
  }
  if (!roomMappings.length || !rateMappings.length) return [];

  // Rate -> its own code_post drives the pushed price (Laravel SyncPriceStaah uses
  // Folio::getReservation totals = net after code_post tax/service/pb1 calc), NOT raw rate_rates.
  // Laravel SyncPriceStaah:361 pushes `str($range['rate_code'])->replace(' ', '-')` as
  // rateplanid — i.e. derived from rates.code, NOT staah_rate_mappings.staah_rate_plan_id.
  const rateIds = [...new Set(rateMappings.map((rtm: any) => rtm.rate_id))];
  const rateRows = await prisma.rates.findMany({
    where: { id: { in: rateIds } },
    select: { id: true, code_post_id: true, code: true, name: true },
  });
  const ratePlanIdByRateId = new Map<string, string>();
  for (const r of rateRows) {
    // Laravel: $range['rate_code'] comes from $rate->code (no ?? name fallback in SyncPriceStaah)
    const raw = r.code || r.name || '';
    ratePlanIdByRateId.set(String(r.id), String(raw).replace(/\s+/g, '-'));
  }
  const codePostByRate = new Map<number, any>();
  const cpIds = [...new Set(rateRows.map((r: any) => r.code_post_id).filter(Boolean))] as bigint[];
  if (cpIds.length) {
    const cps = await prisma.code_posts.findMany({ where: { id: { in: cpIds } } });
    const cpById = new Map(cps.map((c: any) => [Number(c.id), c]));
    for (const r of rateRows) codePostByRate.set(Number(r.id), cpById.get(Number(r.code_post_id)) ?? null);
  }
  const property = await prisma.properties.findUnique({ where: { id: interface_.property_id }, select: { is_tax: true } });
  const isTax = (property as any)?.is_tax === 1;

  const todayStr = formatDate(new Date());

  const roomByType = new Map(roomMappings.map((rm: any) => [rm.room_type_id, rm]));

  // Room stock = active physical rooms per room type (Laravel `roomstosell`)
  const roomCountByType = new Map<number, number>();
  for (const rm of roomMappings) {
    const cnt = await prisma.rooms.count({ where: { room_type_id: rm.room_type_id, property_id: interface_.property_id, status: 1, deleted_at: null } });
    roomCountByType.set(Number(rm.room_type_id), cnt);
  }

  // Occupancy combos from StaahRoomContentBreakdown (Laravel SyncPriceStaah:117-131);
  // fallback to the two standard points when none configured.
  const breakdowns = await prisma.staah_room_content_breakdowns.findMany({
    where: {
      property_id: interface_.property_id,
      staah_interface_id: interface_.id,
      status: 1,
      deleted_at: null,
    },
  });
  const combosByType = new Map<number, { adult: number; child: number }[]>();
  for (const b of breakdowns) {
    const list = combosByType.get(Number(b.room_type_id)) ?? [];
    list.push({ adult: Number(b.adult), child: Number(b.child) });
    combosByType.set(Number(b.room_type_id), list);
  }
  const DEFAULT_COMBOS = [{ adult: 1, child: 0 }, { adult: 2, child: 0 }];

  // Room type fallback rate (Laravel Folio::getReservation :2258-2263 — when no
  // rate_rates row / stop_sell=1 for the night, price = room_types.rate flat).
  const roomTypeRows = await prisma.room_types.findMany({
    where: { id: { in: [...roomByType.keys()] } },
    select: { id: true, rate: true },
  });
  const roomTypeRateById = new Map<number, number>(roomTypeRows.map((rt: any) => [Number(rt.id), Number(rt.rate ?? 0)]));

  function staahPrice(net: number, codePost: any): number {
    if (!codePost) return net;
    const calc = calculateCodePost(
      {
        tax: codePost.tax ?? false,
        tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
        local_tax: codePost.local_tax ?? false,
        local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
        service_charge: codePost.service_charge ?? false,
        service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
        service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
        tax_include_local_tax: codePost.tax_include_local_tax ?? false,
      },
      net,
      isTax
    );
    return Number(calc.total ?? net);
  }

  const rateByRateId = new Map(rateMappings.map((rtm: any) => [rtm.rate_id, rtm]));
  const rateRates = await prisma.rate_rates.findMany({
    where: {
      rate_id: { in: [...rateByRateId.keys()] },
      room_type_id: { in: [...roomByType.keys()] },
      date: { gte: new Date(`${dateFrom}T00:00:00Z`), lte: new Date(`${dateTo}T23:59:59Z`) },
      deleted_at: null,
    },
    orderBy: { date: 'asc' },
  });
  // Restrictions/price lookup per (room_type|rate|date) — Laravel keys RateRate rows the same way.
  const rrByKey = new Map<string, any>();
  for (const rr of rateRates) {
    rrByKey.set(`${rr.room_type_id}|${rr.rate_id}|${formatDate(rr.date)}`, rr);
  }

  const rooms: any[] = [];
  // Laravel SyncPriceStaah:245 groups by `unique_id_staah` = "{rate_id}-{staah_room_id}",
  // so one room[] entry is emitted PER (rate, room) pair — not one per room type.
  for (const [roomTypeId, roomMapping] of roomByType) {
    // Rate ids paired with this room type — derived from the rate grid itself
    // (staah_rate_mappings carry no room-type link, same as Laravel's per-rate run).
    const rateIdsForRoom = new Set<number>(
      rateRates.filter((rr: any) => rr.room_type_id === roomTypeId).map((rr: any) => Number(rr.rate_id))
    );
    if (!rateIdsForRoom.size) continue;

    const roomStock = roomCountByType.get(Number(roomTypeId)) ?? 0;
    const combos = combosByType.get(Number(roomTypeId)) ?? DEFAULT_COMBOS;
    const startD = new Date(`${dateFrom}T00:00:00Z`);
    const endD = new Date(`${dateTo}T00:00:00Z`);

    for (const rateIdNum of rateIdsForRoom) {
      const rateMapping: any = rateByRateId.get(BigInt(rateIdNum));
      if (!rateMapping) continue;
      const codePost = codePostByRate.get(rateIdNum) ?? null;
      const fallbackRate = roomTypeRateById.get(Number(roomTypeId)) ?? 0;
      const ratePlanId = ratePlanIdByRateId.get(String(rateIdNum)) ?? String(rateMapping.staah_rate_plan_id ?? '');

      const dates: any[] = [];
      let currentRange: any = null;

      // Every night in range is pushed (Laravel getReservation emits one row per night
      // even when the rate_rates grid has a gap -> room_types.rate fallback price).
      for (let d = new Date(startD); d <= endD; d = new Date(d.getTime() + 86400000)) {
        const dateStr = formatDate(d);
        if (dateStr < todayStr) continue; // past dates never pushed

        const rr = rrByKey.get(`${BigInt(roomTypeId)}|${BigInt(rateIdNum)}|${dateStr}`);

        const prices: any[] = [];
        for (const combo of combos) {
          // Laravel Folio::getReservation (:2246-2266): stop_sell=1 rows are treated as
          // missing -> room type flat rate; otherwise occupancy formula on rate_rates.
          const base = rr && !rr.stop_sell ? occupancyPrice(rr, combo.adult, combo.child) : fallbackRate;
          const total = staahPrice(base, codePost);
          if (total > 0) prices.push({ NumberOfGuests: String(combo.adult + combo.child), value: String(total) });
        }
        if (!prices.length) continue;

        const closed = rr?.stop_sell ? '1' : '0';
        const minStay = String(rr?.min_night ?? 1);
        const maxStay = String(rr?.max_night ?? 99);
        const closedArrival = rr?.stop_arrival ? '1' : '0';
        const closedDeparture = rr?.stop_departure ? '1' : '0';
        const extraAdult = Number(rr?.extra_adult ?? 0).toFixed(2);
        const extraChild = Number(rr?.extra_child ?? 0).toFixed(2);
        // Laravel range keys: price_key (json of price[]) + restriction_key
        // (room_stock, stop_sell, min_night, max_night, stop_arrival, stop_departure)
        const matchKey = JSON.stringify([prices, roomStock, closed, minStay, maxStay, closedArrival, closedDeparture]);

        if (currentRange === null) {
          currentRange = {
            from: dateStr, to: dateStr,
            rate: [{ rateplanid: ratePlanId }],
            price: prices, roomstosell: String(roomStock), closed,
            minimumstay: minStay, maximumstay: maxStay,
            closedonarrival: closedArrival, closedondeparture: closedDeparture,
            extraadultrate: extraAdult, extrachildrate: extraChild,
            matchKey,
          };
        } else if (currentRange.matchKey === matchKey && formatDate(new Date(new Date(currentRange.to + 'T00:00:00Z').getTime() + 86400000)) === dateStr) {
          currentRange.to = dateStr;
        } else {
          dates.push(finishAriRange(currentRange));
          currentRange = {
            from: dateStr, to: dateStr,
            rate: [{ rateplanid: ratePlanId }],
            price: prices, roomstosell: String(roomStock), closed,
            minimumstay: minStay, maximumstay: maxStay,
            closedonarrival: closedArrival, closedondeparture: closedDeparture,
            extraadultrate: extraAdult, extrachildrate: extraChild,
            matchKey,
          };
        }
      }
      if (currentRange !== null) dates.push(finishAriRange(currentRange));
      if (dates.length) {
        rooms.push({ roomid: roomMapping.staah_room_id, date: dates });
      }
    }
  }
  return rooms;
}

/** Laravel SyncPriceStaah:374-381 / SyncStaahAvailability::finalizeRange — single day = `value`. */
function finishAriRange(range: any): any {
  const { matchKey, from, to, ...rest } = range;
  return from === to ? { value: from, ...rest } : { from, to, ...rest };
}

/** Laravel parity: `!empty($x)` in PHP — '', '0', 0, null, [] are all "empty". */
function isEmptyVal(v: any): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function toJsonb(v: any): any {
  return v === undefined ? undefined : (v as any);
}

/** Laravel StaahSyncLog::create parity. */
async function writeSyncLog(
  staahInterfaceId: bigint, type: string, direction: string, status: string, hotelId: string,
  payload: any, response: any, message: string | null,
  extra: { roomId?: string; ratePlanId?: string; dateFrom?: Date; dateTo?: Date } = {},
): Promise<void> {
  try {
    await prisma.staah_sync_logs.create({
      data: {
        staah_interface_id: staahInterfaceId,
        type, direction, status, hotel_id: hotelId,
        room_id: extra.roomId ?? null,
        rate_plan_id: extra.ratePlanId ?? null,
        date_from: extra.dateFrom ?? null,
        date_to: extra.dateTo ?? null,
        payload: toJsonb(payload ?? {}),
        response: toJsonb(response ?? {}),
        message: message ?? null,
        synced_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  } catch (e: any) {
    console.error('staah_sync_logs insert failed:', e?.message);
  }
}

async function writeAriLog(
  staahInterfaceId: bigint, hotelId: string, status: string, payload: any, response: any,
  roomId: string | null, ratePlanId: string | null, message: string | null,
  dateFrom?: string, dateTo?: string,
): Promise<void> {
  await writeSyncLog(staahInterfaceId, 'ari', 'push', status, hotelId, payload, response, message, {
    roomId: roomId ?? undefined,
    ratePlanId: ratePlanId ?? undefined,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00Z`) : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T00:00:00Z`) : undefined,
  });
}

// ═══════════════════════════════════════════════
// STAah Interfaces CRUD
// ═══════════════════════════════════════════════

export class StaahController {
  static async interfaceList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.staah_interfaces.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_interfaces.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      console.error('Staah interface list error:', err);
      error(res, 'Failed to list interfaces', 500);
    }
  }

  static async interfaceCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { hotel_id, hotel_type, time_zone, language_code, currency_code, hotel_info, hotel_description } = req.body;

      if (!hotel_id) { badRequest(res, 'hotel_id is required'); return; }

      const existing = await prisma.staah_interfaces.findFirst({
        where: { hotel_id, deleted_at: null },
      });
      if (existing) { badRequest(res, 'hotel_id already registered'); return; }

      const result = await prisma.staah_interfaces.create({
        data: {
          property_id: pid,
          hotel_id,
          hotel_type: hotel_type || 'Hotel',
          time_zone: time_zone || 'Asia/Jakarta',
          language_code: language_code || 'en',
          currency_code: currency_code || 'IDR',
          hotel_info,
          hotel_description,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Interface created');
    } catch (err: any) {
      console.error('Staah interface create error:', err);
      error(res, 'Failed to create interface', 500);
    }
  }

  // ---------------------------------------------------------------------------
  // Staah Manager create/edit form + save.
  //
  // Laravel parity: StaahInterfaceController@create/@edit return a `form` key at
  // the TOP LEVEL of the envelope (there is no `data` key at all):
  //
  //   { code: 200, message: 'Success', form: { action, isFormData, list: [...] } }
  //
  // The ported frontend renders `initCreateUpdate?.form`, so these two handlers
  // must emit that exact shape. Previously /cms/staah-manager/{id}/edit was
  // wired to the generic CRUD controller, which returns `{ table, master,
  // search_data, permission }` and no `form` — hence the blank edit page.
  // ---------------------------------------------------------------------------

  /**
   * Laravel indexes /cms/staah-manager by `hotel_id` (StaahInterfaceController@index
   * sets `'id' => $interface->hotel_id`), while the generic list handed the
   * numeric primary key to the FE. Accept both so either URL shape resolves.
   */
  private static async resolveInterface(raw: any, propertyId: bigint): Promise<any | null> {
    const key = String(raw ?? '').trim();
    if (!key) return null;
    const numeric = /^\d+$/.test(key);
    const found = await prisma.staah_interfaces.findFirst({
      where: numeric
        ? { property_id: propertyId, deleted_at: null, OR: [{ id: BigInt(key) }, { hotel_id: key }] }
        : { property_id: propertyId, deleted_at: null, hotel_id: key },
    });
    return found;
  }

  private static async propertyForm(action: string, iface: any | null, propertyId: bigint): Promise<any> {
    const properties = await prisma.properties.findMany({
      where: { id: propertyId, deleted_at: null },
      select: {
        id: true, name: true, alias: true, email: true, telp: true, whatsapp: true,
        fax: true, address: true, latitude: true, longitude: true, city_id: true, country_id: true,
      },
      orderBy: { name: 'asc' },
    });
    const propertyOptions = properties.map((p) => ({ value: Number(p.id), label: p.name }));
    const data: any = (iface?.data as any) ?? {};

    // Laravel parity: on create the form is pre-filled from the local property so
    // the operator does not retype data the HMS already knows.
    if (!iface) {
      const prop: any = properties[0];
      if (prop) {
        let postalCode = '';
        const postalMatch = /\b(\d{5})\b/.exec(prop.address ?? '');
        if (postalMatch) postalCode = postalMatch[1];

        let cityName = '';
        if (prop.city_id) {
          const city = await prisma.cities.findUnique({ where: { id: BigInt(prop.city_id) }, select: { name: true } });
          cityName = city?.name ?? '';
        }
        if (!cityName && prop.address) {
          const parts = prop.address.split(',');
          let afterLastComma = (parts[parts.length - 1] ?? '').trim();
          const dashPos = afterLastComma.indexOf('-');
          if (dashPos > -1) afterLastComma = afterLastComma.slice(0, dashPos).trim();
          cityName = afterLastComma.replace(/\s+\d{5}$/, '');
        }
        let countryName = 'ID';
        if (prop.country_id) {
          const country = await prisma.countries.findUnique({ where: { id: BigInt(prop.country_id) }, select: { name: true } });
          if (country?.name) countryName = country.name;
        }

        Object.assign(data, {
          hotel_name: prop.alias ?? prop.name ?? '',
          email: prop.email ?? '',
          address_line: prop.address ?? '',
          city_name: cityName,
          postal_code: postalCode,
          country_name: countryName,
          latitude: prop.latitude ?? '',
          longitude: prop.longitude ?? '',
          contact_given_name: prop.name ?? '',
          contact_surname: prop.alias ?? prop.name ?? '',
        });

        if (!Array.isArray(data.phones) || data.phones.length === 0) {
          const phones: any[] = [];
          if (prop.telp) phones.push({ PhoneNumber: String(prop.telp), PhoneTechType: '1' });
          if (prop.whatsapp) phones.push({ PhoneNumber: prop.whatsapp, PhoneTechType: '5' });
          if (prop.fax) phones.push({ PhoneNumber: String(prop.fax), PhoneTechType: '3' });
          data.phones = phones.length ? phones : [{ PhoneNumber: prop.telp ? String(prop.telp) : '', PhoneTechType: '5' }];
        }
      }
    }

    const hotelTypeLabel = (v: any): string => (v === '2' ? 'Motel' : v === '3' ? 'Vacation Rental' : 'Hotel');
    const phoneLabel = (v: any): string => (v === '1' ? 'Voice' : v === '3' ? 'Fax' : 'Mobile');
    const ifacePropertyName = iface ? await StaahController.propertyName(iface.property_id) : null;

    const phoneRows = Array.isArray(data.phones) ? data.phones : [];
    const facilityRows = Array.isArray(data.facilities) ? data.facilities : [];

    const propertySteps: any[] = [
      {
        name: 'Property Info',
        input: [
          {
            type: 'select',
            value: iface
              ? [{ value: String(iface.property_id), label: ifacePropertyName ?? '' }]
              : propertyOptions[0]
              ? [{ value: String(propertyOptions[0].value), label: propertyOptions[0].label }]
              : [],
            name: 'property_id', label: 'Local HMS Property', required: true, options: propertyOptions,
          },
          { type: 'text', value: data.hotel_name ?? '', name: 'hotel_name', label: 'HotelName', required: true },
          { type: 'text', value: iface?.hotel_id ?? '', name: 'hotel_id', label: 'hotelid / HotelCode', required: true },
          {
            type: 'select',
            value: [{ value: String(iface?.hotel_type ?? '1'), label: hotelTypeLabel(iface?.hotel_type ?? '1') }],
            name: 'hotel_type', label: 'HotelType', required: true,
            options: [
              { value: '1', label: 'Hotel' },
              { value: '2', label: 'Motel' },
              { value: '3', label: 'Vacation Rental' },
            ],
          },
          { type: 'text', value: iface?.time_zone ?? 'Asia/Jakarta', name: 'time_zone', label: 'TimeZone' },
          { type: 'text', value: iface?.language_code ?? 'en', name: 'language_code', label: 'LanguageCode', required: true },
          { type: 'text', value: iface?.currency_code ?? 'IDR', name: 'currency_code', label: 'CurrencyCode', required: true },
          { type: 'text', value: data.platform ?? 'STAAH', name: 'platform', label: 'Platform' },
          { type: 'text', value: data.property_license_number ?? '', name: 'property_license_number', label: 'PropertyLicenseNumber' },
          { type: 'text', value: data.official_checkin_time ?? '', name: 'official_checkin_time', label: 'OfficialCheckinTime' },
          { type: 'text', value: data.official_checkout_time ?? '', name: 'official_checkout_time', label: 'OfficialCheckoutTime' },
        ],
      },
      {
        name: 'Contact & Address',
        input: [
          { type: 'text', value: data.contact_given_name ?? '', name: 'contact_given_name', label: 'GivenName', required: true },
          { type: 'text', value: data.contact_surname ?? '', name: 'contact_surname', label: 'Surname', required: true },
          { type: 'text', value: data.email ?? '', name: 'email', label: 'Email / NotificationEmail', required: true },
          {
            type: 'addrowtbl', name: 'phones', label: 'Phones',
            items: [
              { type: 'text', name: 'PhoneNumber', label: 'Phone Number', required: true },
              {
                type: 'select', name: 'PhoneTechType', label: 'Type (1=Voice,3=Fax,5=Mobile)', required: true,
                options: [
                  { value: '1', label: 'Voice' },
                  { value: '3', label: 'Fax' },
                  { value: '5', label: 'Mobile' },
                ],
              },
            ],
            value: phoneRows.map((f: any) => ({
              PhoneNumber: f?.PhoneNumber ?? '',
              PhoneTechType: { value: String(f?.PhoneTechType?.value ?? f?.PhoneTechType ?? '5'), label: phoneLabel(f?.PhoneTechType?.value ?? f?.PhoneTechType ?? '5') },
            })),
          },
          { type: 'text', value: data.address_line ?? '', name: 'address_line', label: 'AddressLine', required: true },
          { type: 'text', value: data.city_name ?? '', name: 'city_name', label: 'CityName', required: true },
          { type: 'text', value: data.postal_code ?? '', name: 'postal_code', label: 'PostalCode', required: true },
          { type: 'text', value: data.country_name ?? 'ID', name: 'country_name', label: 'CountryName', required: true },
        ],
      },
      {
        name: 'Position & Description',
        input: [
          { type: 'text', value: data.latitude ?? '', name: 'latitude', label: 'Latitude', required: true },
          { type: 'text', value: data.longitude ?? '', name: 'longitude', label: 'Longitude', required: true },
          { type: 'textareaonly', value: iface?.hotel_description ?? '', name: 'hotel_description', label: 'HotelDescription' },
        ],
      },
      {
        name: 'Facilities',
        input: [
          {
            type: 'addrowtbl', name: 'facilities', label: 'Hotel Facilities',
            items: [
              { type: 'text', name: 'Group', label: 'Group', required: true },
              { type: 'text', name: 'name', label: 'Facility Name', required: true },
            ],
            value: facilityRows.map((f: any) => ({ Group: f?.Group ?? 'Facilities', name: f?.name ?? '' })),
          },
        ],
      },
    ];

    if (iface) {
      const hid = iface.hotel_id;
      propertySteps.push(
        { name: 'Room Types', input: [{ type: 'table', uri: '/cms/staah-room-mapping/' + hid, isEditTable: false }] },
        { name: 'Rate Plans', input: [{ type: 'table', uri: '/cms/staah-rate-mapping/' + hid, isEditTable: false }] },
        { name: 'Sync Logs', input: [{ type: 'table', uri: '/cms/staah-sync-log/' + hid, isEditTable: false }] },
      );
    }

    return {
      action,
      isFormData: false,
      list: [{
        lang: iface ? 'Edit Staah Property' : 'Create Staah Property',
        step: propertySteps,
      }],
    };
  }

  private static async propertyName(propertyId: any): Promise<string | null> {
    const prop = await prisma.properties.findUnique({ where: { id: BigInt(propertyId) }, select: { name: true } });
    return prop?.name ?? null;
  }

  static async interfaceCreateForm(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const form = await StaahController.propertyForm('/cms/staah-manager', null, pid);
      success(res, null, 'Success', 200, { form } as any);
    } catch (err: any) {
      console.error('Staah interface create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  static async interfaceEditForm(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const iface = await StaahController.resolveInterface(req.params.id, pid);
      if (!iface) { notFound(res, 'Record not found'); return; }
      const form = await StaahController.propertyForm(`/cms/staah-manager/${iface.hotel_id}`, iface, pid);
      success(res, null, 'Success', 200, { form } as any);
    } catch (err: any) {
      console.error('Staah interface edit form error:', err);
      error(res, 'Failed to load', 500);
    }
  }

  /**
   * Laravel parity: StaahInterfaceController::normalizeFieldValue().
   * A `{ value, label }` select collapses to its scalar; a nested array takes its
   * first entry; an EMPTY array becomes null so validation reports a clear field
   * instead of exploding. Non-scalar arrays (phones/facilities rows) pass through.
   */
  private static normalizeFieldValue(value: any): any {
    if (Array.isArray(value)) {
      // A JSON array never carries a `value` key, so only the nested
      // `{ value, label }` inside the first entry needs unwrapping here.
      if (value.length > 0) {
        const first = value[0];
        if (first && typeof first === 'object' && !Array.isArray(first) && 'value' in first) return first.value;
        if (typeof first !== 'object' || first === null) return first;
      }
      if (value.length === 0) return null;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if ('value' in value) return (value as any).value;
    }
    return value;
  }

  /** Laravel parity: StaahInterfaceController::extractFormInput(). */
  private static extractFormInput(body: any): Record<string, any> {
    const form = body?.form;
    if (Array.isArray(form)) {
      const input: Record<string, any> = {};
      for (const section of form[0]?.step ?? []) {
        for (const field of section?.input ?? []) {
          if (field?.name) input[field.name] = StaahController.normalizeFieldValue(field.value ?? null);
        }
      }
      return input;
    }
    const input: Record<string, any> = {};
    for (const [k, v] of Object.entries(body ?? {})) input[k] = StaahController.normalizeFieldValue(v);
    return input;
  }

  /** Laravel parity: App\Models\StaahInterface::formatPropertyPayload(). */
  private static formatPropertyPayload(iface: any, property: any, type: 'New' | 'Overlay'): any {
    const data: any = (iface.data as any) ?? {};
    const contactGivenName = data.contact_given_name ?? property?.name ?? iface.hotel_id;
    const contactSurname = data.contact_surname ?? property?.name ?? iface.hotel_id;
    const addressLine = data.address_line ?? property?.address ?? '-';
    const cityName = data.city_name ?? 'Jakarta';
    const postalCode = data.postal_code ?? '12345';
    const countryName = data.country_name ?? 'ID';
    const email = data.email ?? property?.email ?? 'no-reply@example.com';
    let topPhone = String(data.phone ?? property?.telp ?? '+620000000000').replace(/[^0-9+]/g, '');
    if (!topPhone.startsWith('+')) topPhone = '+' + topPhone;

    const address = { AddressLine: addressLine, CityName: cityName, PostalCode: postalCode, CountryName: countryName };

    const rawPhones: any[] = Array.isArray(data.phones) && data.phones.length
      ? data.phones
      : [{ PhoneNumber: '+62000000', PhoneTechType: '5' }];

    const phones = rawPhones
      .map((p: any) => {
        const techType = p?.PhoneTechType?.value ?? p?.PhoneTechType ?? '5';
        let phone = String(p?.PhoneNumber ?? '').replace(/[^0-9+]/g, '');
        if (!phone.startsWith('+')) phone = '+' + phone;
        // STAAH rejects numbers outside 6..15 digits (excluding '+').
        const digits = phone.replace(/[^\d]/g, '');
        if (digits.length < 6 || digits.length > 15) return null;
        return { PhoneNumber: phone, PhoneTechType: String(techType) };
      })
      .filter(Boolean);

    return {
      HotelDescriptiveContents: {
        HotelDescriptiveContent: {
          HotelName: data.hotel_name ?? property?.alias ?? property?.name ?? iface.hotel_id,
          HotelType: String(iface.hotel_type),
          TimeZone: iface.time_zone,
          Platform: data.platform ?? 'STAAH',
          hotelid: iface.hotel_id,
          LanguageCode: iface.language_code,
          CurrencyCode: iface.currency_code,
          HotelDescriptiveContentNotifType: type,
          PropertyLicenseNumber: data.property_license_number ?? null,
          OfficialCheckinTime: data.official_checkin_time ?? null,
          OfficialCheckoutTime: data.official_checkout_time ?? null,
          ContactInfos: {
            ContactInfo: [
              { ContactProfileType: 'PhysicalLocation', Addresses: { Address: address } },
              {
                ContactProfileType: 'availability',
                Names: { Name: { GivenName: contactGivenName, Surname: contactSurname } },
                Addresses: { Address: address },
                NotificationEmail: email,
                Emails: { Email: [email] },
                Phones: { Phone: phones },
              },
            ],
          },
          HotelInfo: {
            Position: {
              Latitude: String(data.latitude ?? property?.latitude ?? '0'),
              Longitude: String(data.longitude ?? property?.longitude ?? '0'),
            },
          },
          Facilities: { Facility: Array.isArray(data.facilities) ? data.facilities : [] },
          HotelDescription: iface.hotel_description,
        },
      },
    };
  }

  private static validatePropertyInput(input: Record<string, any>, currentPropertyId: bigint): string | null {
    const required = [
      'property_id', 'hotel_name', 'hotel_id', 'language_code', 'currency_code',
      'email', 'address_line', 'city_name', 'postal_code', 'country_name',
      'latitude', 'longitude',
    ];
    for (const key of required) {
      const v = input[key];
      if (v === null || v === undefined || v === '') return `${key} is required`;
    }
    if (String(input.property_id) !== String(currentPropertyId)) return 'property_id must be the current property';
    if (String(input.country_name).length > 2) return 'country_name may not be greater than 2 characters';
    if (!/^\S+@\S+\.\S+$/.test(String(input.email))) return 'email must be a valid email address';
    if (!Number.isFinite(Number(input.latitude))) return 'latitude must be numeric';
    if (!Number.isFinite(Number(input.longitude))) return 'longitude must be numeric';
    return null;
  }

  /**
   * Laravel parity: StaahInterfaceController::saveProperty().
   * The property payload is pushed to STAAH FIRST; only a STAAH-accepted push is
   * persisted locally, and every attempt is journalled in `staah_sync_logs`.
   * `req.method` decides create vs update (POST / PUT).
   */
  static async saveProperty(req: Request, res: Response): Promise<void> {
    const pid = req.user?.lastProperty ?? 0n;
    const isUpdate = req.method === 'PUT';
    let iface: any = null;

    try {
      const input = StaahController.extractFormInput(req.body);
      const problem = StaahController.validatePropertyInput(input, pid);
      if (problem) { badRequest(res, problem); return; }

      if (isUpdate) {
        iface = await StaahController.resolveInterface(req.params.id, pid);
        if (!iface) { notFound(res, 'Record not found'); return; }
      }

      const duplicate = await prisma.staah_interfaces.findFirst({
        where: {
          hotel_id: String(input.hotel_id),
          deleted_at: null,
          ...(iface ? { NOT: { id: iface.id } } : {}),
        },
      });
      if (duplicate) { badRequest(res, 'Staah Hotel ID already exists'); return; }

      const property = await prisma.properties.findUnique({
        where: { id: pid },
        select: {
          id: true, name: true, alias: true, email: true, telp: true, address: true,
          latitude: true, longitude: true,
        },
      });

      const phones = (Array.isArray(input.phones) ? input.phones : [])
        .map((p: any) => {
          const techType = p?.PhoneTechType?.value ?? p?.PhoneTechType ?? '5';
          return { PhoneNumber: p?.PhoneNumber, PhoneTechType: techType };
        })
        .filter((p: any) => !p.PhoneNumber);

      const facilities = (Array.isArray(input.facilities) ? input.facilities : [])
        .map((f: any) => (f?.name ? { Group: f.Group ?? 'Facilities', Name: f.name } : null))
        .filter(Boolean);

      const draft = {
        property_id: pid,
        hotel_id: String(input.hotel_id),
        time_zone: input.time_zone ?? 'Asia/Jakarta',
        hotel_type: input.hotel_type ?? '1',
        language_code: input.language_code,
        currency_code: input.currency_code,
        hotel_description: input.hotel_description ?? null,
        status: 'active',
        data: {
          hotel_name: input.hotel_name,
          platform: input.platform ?? 'STAAH',
          property_license_number: input.property_license_number ?? null,
          official_checkin_time: input.official_checkin_time ?? null,
          official_checkout_time: input.official_checkout_time ?? null,
          contact_given_name: input.contact_given_name ?? null,
          contact_surname: input.contact_surname ?? null,
          email: input.email,
          phones,
          address_line: input.address_line,
          city_name: input.city_name,
          postal_code: input.postal_code,
          country_name: input.country_name,
          latitude: input.latitude,
          longitude: input.longitude,
          facilities,
        },
      };

      const payload = StaahController.formatPropertyPayload(draft, property, isUpdate ? 'Overlay' : 'New');
      const response = await staahService.createUpdateProperty(payload);

      if (!StaahService.isSuccess(response)) {
        const msg = StaahService.extractErrorMsg(response);
        console.error('Staah save: STAAH rejected the property payload', { hotel_id: input.hotel_id, message: msg });
        await prisma.staah_sync_logs.create({
          data: {
            staah_interface_id: iface?.id ?? null,
            type: 'property',
            direction: 'push',
            status: 'failed',
            hotel_id: String(input.hotel_id),
            payload: payload as any,
            response: (response ?? null) as any,
            message: `STAAH rejected property payload: ${msg}`,
            synced_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        error(res, `STAAH rejected property payload: ${msg}`, 500);
        return;
      }

      const saved = await prisma.$transaction(async (tx) => {
        const row = iface
          ? await tx.staah_interfaces.update({
              where: { id: iface.id },
              data: {
                ...draft,
                data: { ...(draft.data as any), last_property_response: response },
                last_sync_at: new Date(),
                updated_at: new Date(),
              },
            })
          : await tx.staah_interfaces.create({
              data: { ...draft, data: draft.data as any, last_sync_at: new Date(), created_at: new Date(), updated_at: new Date() },
            });

        await tx.staah_sync_logs.create({
          data: {
            staah_interface_id: row.id,
            type: 'property',
            direction: 'push',
            status: 'success',
            hotel_id: row.hotel_id,
            payload: payload as any,
            response: (response ?? null) as any,
            message: 'Property pushed to Staah and saved locally',
            synced_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        return row;
      });

      console.log('STAAH property saved successfully', {
        hotel_id: saved.hotel_id,
        property_id: String(pid),
        action: isUpdate ? 'update' : 'create',
      });
      success(res, { id: saved.hotel_id }, 'Staah property saved successfully');
    } catch (err: any) {
      console.error('Staah save failed:', err);
      error(res, err?.message ?? 'Failed to save property', 500);
    }
  }

  static async interfaceShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const result = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!result || result.property_id !== pid) { notFound(res, 'Interface not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load interface', 500);
    }
  }

  static async interfaceEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const result = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!result || result.property_id !== pid) { notFound(res, 'Interface not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load interface', 500);
    }
  }

  static async interfaceUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const { hotel_type, time_zone, language_code, currency_code, hotel_info, hotel_description, status } = req.body;

      const existing = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!existing || existing.property_id !== pid) { notFound(res, 'Interface not found'); return; }

      const data: any = { updated_at: new Date() };
      if (hotel_type !== undefined) data.hotel_type = hotel_type;
      if (time_zone !== undefined) data.time_zone = time_zone;
      if (language_code !== undefined) data.language_code = language_code;
      if (currency_code !== undefined) data.currency_code = currency_code;
      if (hotel_info !== undefined) data.hotel_info = hotel_info;
      if (hotel_description !== undefined) data.hotel_description = hotel_description;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_interfaces.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Interface updated');
    } catch (err: any) {
      error(res, 'Failed to update interface', 500);
    }
  }

  static async interfaceDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const existing = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!existing || existing.property_id !== pid) { notFound(res, 'Interface not found'); return; }
      await prisma.staah_interfaces.update({ where: { id }, data: { deleted_at: new Date(), status: 'inactive' } });
      success(res, null, 'Interface deleted');
    } catch (err: any) {
      error(res, 'Failed to delete interface', 500);
    }
  }

  static async testConnection(req: Request, res: Response): Promise<void> {
    try {
      const result = await staahService.testConnection();
      success(res, result, result.success ? 'Connection successful' : 'Connection failed');
    } catch (err: any) {
      error(res, 'STAAH connection test failed: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Room Mappings
  // ═══════════════════════════════════════════════

  // Column definitions for the three sub-tables embedded in the property form.
// The form renders them via `type: 'table'` + `uri`, and `table-edit` treats a
// missing/empty `table` as "no table", so these have to travel with the rows.
private static readonly ROOM_MAPPING_TABLE = [
  { label: 'Staah Room ID', key: 'staah_room_id', type: 'text', is_search: true },
  { label: 'Local Room Type', key: 'room_type_name', type: 'text', is_search: true },
  { label: 'Max Occupancy', key: 'max_occupancy', type: 'none', is_search: false },
  { label: 'Max Child', key: 'max_child_occupancy', type: 'none', is_search: false },
  { label: 'Quantity', key: 'quantity', type: 'none', is_search: false },
  { label: 'Status', key: 'status', type: 'checkbox', is_search: false },
];

private static readonly RATE_MAPPING_TABLE = [
  { label: 'Staah Rate Plan', key: 'staah_rate_plan_id', type: 'text', is_search: true },
  { label: 'Local Rate', key: 'rate_name', type: 'text', is_search: true },
  { label: 'Meal Plan', key: 'meal_plan_id', type: 'none', is_search: false },
  { label: 'Status', key: 'status', type: 'checkbox', is_search: false },
];

private static readonly SYNC_LOG_TABLE = [
  { label: 'Type', key: 'type', type: 'text', is_search: true },
  { label: 'Direction', key: 'direction', type: 'text', is_search: false },
  { label: 'Status', key: 'status', type: 'text', is_search: false },
  { label: 'Hotel ID', key: 'hotel_id', type: 'text', is_search: true },
  { label: 'Message', key: 'message', type: 'text', is_search: false },
  { label: 'Synced At', key: 'synced_at', type: 'none', is_search: false },
];

/**
 * Resolve the `?hotel_id=` path segment used by the embedded sub-tables.
 *
 * Laravel keys those tables by the STAAH `hotel_id` STRING (e.g. "999"), while
 * these handlers originally assumed the numeric interface primary key. Accept
 * both so `/cms/staah-room-mapping/999` and `/cms/staah-room-mapping/7` resolve
 * to the same interface.
 *
 * @returns null (no filter), an interface id, or the string 'notfound'.
 */
private static scopeByInterfaceParam(req: Request, interfaces: { id: bigint; hotel_id: string }[]): bigint | null | 'notfound' {
  const raw = req.params.hotel_id ?? req.query.hotel_id ?? req.query.interface_id;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const key = String(raw).trim();
  const hit = interfaces.find(i => i.hotel_id === key || String(i.id) === key);
  return hit ? hit.id : 'notfound';
}

static async roomMappingList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const interfaces = await prisma.staah_interfaces.findMany({
        where: { property_id: pid, deleted_at: null },
        select: { id: true, hotel_id: true },
      });
      const interfaceIds = interfaces.map(i => i.id);
      const scoped = StaahController.scopeByInterfaceParam(req, interfaces);
      if (scoped === 'notfound') { notFound(res, 'Interface not found for this property'); return; }

      const where: any = { deleted_at: null, staah_interface_id: { in: interfaceIds } };
      if (scoped !== null) where.staah_interface_id = scoped;

      const [data, total] = await Promise.all([
        prisma.staah_room_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { room_types: { select: { id: true, name: true } } },
        }),
        prisma.staah_room_mappings.count({ where }),
      ]);

      const rows = (bigintToNumber(data) as any[]).map((r) => ({ ...r, room_type_name: r?.room_types?.name ?? null }));
      success(res, rows, 'Success', 200, {
        pagination: { total, limit, page },
        table: StaahController.ROOM_MAPPING_TABLE,
      } as any);
    } catch (err: any) {
      error(res, 'Failed to list room mappings', 500);
    }
  }

  static async roomMappingEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const result = await prisma.staah_room_mappings.findUnique({
        where: { id },
        include: { room_types: { select: { id: true, name: true } }, staah_interfaces: { select: { id: true, hotel_id: true, property_id: true } } },
      });
      if (!result || (result as any).staah_interfaces?.property_id !== pid) { notFound(res, 'Room mapping not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load room mapping', 500);
    }
  }

  static async roomMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const { room_type_id, max_occupancy, max_child_occupancy, quantity, staah_room_id, status } = req.body;

      const existing = await prisma.staah_room_mappings.findUnique({
        where: { id },
        include: { staah_interfaces: { select: { property_id: true } } },
      });
      if (!existing || (existing as any).staah_interfaces?.property_id !== pid) { notFound(res, 'Room mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (room_type_id !== undefined) data.room_type_id = BigInt(room_type_id);
      if (max_occupancy !== undefined) data.max_occupancy = max_occupancy;
      if (max_child_occupancy !== undefined) data.max_child_occupancy = max_child_occupancy;
      if (quantity !== undefined) data.quantity = quantity;
      if (staah_room_id !== undefined) data.staah_room_id = staah_room_id;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_room_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Room mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update room mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Rate Mappings
  // ═══════════════════════════════════════════════

  static async rateMappingList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const interfaces = await prisma.staah_interfaces.findMany({
        where: { property_id: pid, deleted_at: null },
        select: { id: true, hotel_id: true },
      });
      const interfaceIds = interfaces.map(i => i.id);
      const scoped = StaahController.scopeByInterfaceParam(req, interfaces);
      if (scoped === 'notfound') { notFound(res, 'Interface not found for this property'); return; }

      const where: any = { deleted_at: null, staah_interface_id: { in: interfaceIds } };
      if (scoped !== null) where.staah_interface_id = scoped;

      const [data, total] = await Promise.all([
        prisma.staah_rate_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { rates: { select: { id: true, name: true } } },
        }),
        prisma.staah_rate_mappings.count({ where }),
      ]);

      const rows = (bigintToNumber(data) as any[]).map((r) => ({ ...r, rate_name: r?.rates?.name ?? null }));
      success(res, rows, 'Success', 200, {
        pagination: { total, limit, page },
        table: StaahController.RATE_MAPPING_TABLE,
      } as any);
    } catch (err: any) {
      error(res, 'Failed to list rate mappings', 500);
    }
  }

  static async rateMappingEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const result = await prisma.staah_rate_mappings.findUnique({
        where: { id },
        include: { rates: { select: { id: true, name: true } }, staah_interfaces: { select: { id: true, hotel_id: true, property_id: true } } },
      });
      if (!result || (result as any).staah_interfaces?.property_id !== pid) { notFound(res, 'Rate mapping not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load rate mapping', 500);
    }
  }

  static async rateMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const { rate_id, staah_rate_plan_id, meal_plan_id, status } = req.body;

      const existing = await prisma.staah_rate_mappings.findUnique({
        where: { id },
        include: { staah_interfaces: { select: { property_id: true } } },
      });
      if (!existing || (existing as any).staah_interfaces?.property_id !== pid) { notFound(res, 'Rate mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (rate_id !== undefined) data.rate_id = BigInt(rate_id);
      if (staah_rate_plan_id !== undefined) data.staah_rate_plan_id = staah_rate_plan_id;
      if (meal_plan_id !== undefined) data.meal_plan_id = meal_plan_id;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_rate_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Rate mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update rate mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Reservations (Webhook-pulled)
  // ═══════════════════════════════════════════════

  static async reservationList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as string;

      const interfaces = await prisma.staah_interfaces.findMany({
        where: { property_id: pid, deleted_at: null },
        select: { id: true },
      });
      const interfaceIds = interfaces.map(i => i.id);

      const where: any = { staah_interface_id: { in: interfaceIds } };
      if (status) where.status = status;

      const [data, total] = await Promise.all([
        prisma.staah_reservations.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            staah_interfaces: { select: { hotel_id: true } },
            folios: { select: { id: true, folio_number: true, booking_no: true } },
          },
        }),
        prisma.staah_reservations.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list reservations', 500);
    }
  }

  // Loads a staah_reservation and enforces the property guard.
  // Laravel parity: StaahReservationController checks
  // $interface->property_id == $request->user()->last_property.
  private static async loadGuardedReservation(req: Request): Promise<any | null> {
    const id = idParam(req.params.id);
    const pid = req.user?.lastProperty ?? 0n;
    const staahRes = await prisma.staah_reservations.findUnique({
      where: { id },
      include: { staah_interfaces: { select: { property_id: true } } },
    });
    if (!staahRes) return null;
    if ((staahRes as any).staah_interfaces?.property_id !== pid) return false as any;
    return staahRes;
  }

  static async reservationConfirm(req: Request, res: Response): Promise<void> {
    try {
      const staahRes = await StaahController.loadGuardedReservation(req);
      if (staahRes === null) { notFound(res, 'Reservation not found'); return; }
      if (staahRes === false) { error(res, 'Unauthorized access to this property', 403); return; }

      // 1. Create folio + reservation rows locally (Laravel: StaahWebhookService::processConfirmBooking)
      const reservationData = (staahRes.mapped_data as any) || (staahRes.payload as any);
      if (!reservationData) {
        error(res, 'Local booking creation failed: No mapped_data or payload found', 500);
        return;
      }
      const bookingResult = await createStaahBookingCore(
        Number(staahRes.staah_interface_id),
        reservationData
      );

      // 2. Confirm the request booking back to STAAH
      const staahResponse = await staahService.confirmRequestBooking(staahRes.booking_id);
      if (staahResponse?.Status !== 'Success') {
        error(res, 'Failed to Confirm to Staah: ' + JSON.stringify(staahResponse), 500);
        return;
      }

      // 3. Persist status
      await prisma.staah_reservations.update({
        where: { id: staahRes.id },
        data: {
          status: '1',
          message: 'Confirmed and saved to local HMS',
          folio_id: BigInt(bookingResult.folioId),
          updated_at: new Date(),
        },
      });

      success(res, { folio_id: Number(bookingResult.folioId) }, 'Reservation Confirmed Successfully!');
    } catch (err: any) {
      console.error('StaahReservationController@confirm failed:', err?.message);
      error(res, err?.message || 'Failed to confirm reservation', 500);
    }
  }

  static async reservationCancel(req: Request, res: Response): Promise<void> {
    try {
      const staahRes = await StaahController.loadGuardedReservation(req);
      if (staahRes === null) { notFound(res, 'Reservation not found'); return; }
      if (staahRes === false) { error(res, 'Unauthorized access to this property', 403); return; }

      // Cancel on the STAAH side first
      const staahResponse = await staahService.cancelRequestBooking(staahRes.booking_id);
      if (staahResponse?.Status !== 'Success') {
        error(res, 'Failed to Cancel to Staah: ' + JSON.stringify(staahResponse), 500);
        return;
      }

      await prisma.staah_reservations.update({
        where: { id: staahRes.id },
        data: { status: '2', message: 'Cancelled successfully', updated_at: new Date() },
      });

      // Re-open inventory for the freed dates (Laravel: SyncStaahRoomAvailability::dispatch)
      enqueueJob('sync-staah-room-availability', {
        propertyId: Number((staahRes as any).staah_interfaces.property_id),
        dateFrom: staahRes.check_in_date,
        dateTo: staahRes.check_out_date,
        roomTypeId: staahRes.room_type_id ? Number(staahRes.room_type_id) : null,
      });

      success(res, null, 'Reservation Cancelled Successfully!');
    } catch (err: any) {
      console.error('StaahReservationController@cancel failed:', err?.message);
      error(res, err?.message || 'Failed to cancel reservation', 500);
    }
  }

  static async reservationPending(req: Request, res: Response): Promise<void> {
    try {
      const staahRes = await StaahController.loadGuardedReservation(req);
      if (staahRes === null) { notFound(res, 'Reservation not found'); return; }
      if (staahRes === false) { error(res, 'Unauthorized access to this property', 403); return; }

      await prisma.staah_reservations.update({
        where: { id: staahRes.id },
        data: { status: '3', message: 'Set to pending successfully', updated_at: new Date() },
      });

      success(res, null, 'Reservation Set to Pending Successfully!');
    } catch (err: any) {
      console.error('StaahReservationController@pending failed:', err?.message);
      error(res, err?.message || 'Failed to update reservation', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Sync Logs
  // ═══════════════════════════════════════════════

  static async syncLogList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const interfaces = await prisma.staah_interfaces.findMany({
        where: { property_id: pid, deleted_at: null },
        select: { id: true, hotel_id: true },
      });
      const interfaceIds = interfaces.map(i => i.id);
      const scoped = StaahController.scopeByInterfaceParam(req, interfaces);
      if (scoped === 'notfound') { notFound(res, 'Interface not found for this property'); return; }

      const where: any = { staah_interface_id: { in: interfaceIds } };
      if (scoped !== null) where.staah_interface_id = scoped;

      const [data, total] = await Promise.all([
        prisma.staah_sync_logs.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_sync_logs.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { total, limit, page },
        table: StaahController.SYNC_LOG_TABLE,
      } as any);
    } catch (err: any) {
      error(res, 'Failed to list sync logs', 500);
    }
  }

  static async syncLogRetry(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const log = await prisma.staah_sync_logs.findUnique({ where: { id } });
      if (!log) { notFound(res, 'Sync log not found'); return; }

      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id: log.staah_interface_id ? BigInt(log.staah_interface_id) : 0n } });
      if (!interface_ || interface_.property_id !== pid) { error(res, 'Interface not found', 404); return; }

      const payload = log.payload ? JSON.parse(log.payload as string) : {};
      let result: any;

      switch (log.type) {
        case 'ari':
        case 'price':
          result = await staahService.storeRates(payload);
          break;
        case 'room':
          for (const room of payload.room || []) {
            result = await staahService.createUpdateDeleteRoomType(room);
          }
          break;
        case 'rate':
          for (const rate of payload.rate || []) {
            result = await staahService.createUpdateDeleteRatePlan(rate);
          }
          break;
        default:
          error(res, 'Unknown sync type for retry', 400);
          return;
      }

      const ok = String(result?.Status ?? result?.status ?? 'unknown').toLowerCase() === 'success';
      await prisma.staah_sync_logs.update({
        where: { id },
        data: {
          status: ok ? 'success' : 'failed',
          response: JSON.stringify(result),
          message: ok ? 'Retry successful' : 'Retry failed',
          synced_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, result, ok ? 'Retry successful' : 'Retry failed');
    } catch (err: any) {
      error(res, 'Retry failed: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah OTA Company Mappings
  // ═══════════════════════════════════════════════

  static async otaMappingList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        prisma.staah_ota_company_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_ota_company_mappings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list OTA mappings', 500);
    }
  }

  static async otaMappingCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { channel_id, company_profile_id, staah_interface_id } = req.body;

      if (!channel_id || !company_profile_id) {
        badRequest(res, 'channel_id and company_profile_id are required');
        return;
      }

      const result = await prisma.staah_ota_company_mappings.create({
        data: {
          property_id: pid,
          channel_id: String(channel_id),
          company_profile_id: BigInt(company_profile_id),
          staah_interface_id: staah_interface_id ? BigInt(staah_interface_id) : null,
          status: true,
        },
      });

      success(res, bigintToNumber(result), 'OTA mapping created');
    } catch (err: any) {
      console.error('OTA mapping create error:', err);
      error(res, 'Failed to create OTA mapping', 500);
    }
  }

  static async otaMappingSync(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const interface_ = await prisma.staah_interfaces.findFirst({
        where: { property_id: pid, deleted_at: null },
      });
      if (!interface_) { error(res, 'Staah interface not found', 404); return; }

      const mappings = await staahService.listingRoomType(interface_.hotel_id);
      const rates = await staahService.listingRatePlan(interface_.hotel_id);

      const staahChannels = mappings.Data?.map((r: any) => ({
        channel_id: r.ChannelID || r.channel_id || r.id,
        channel_name: r.ChannelName || r.channel_name || r.name,
      })) || [];

      const existingMappings = await prisma.staah_ota_company_mappings.findMany({
        where: { property_id: pid },
      });

      const created = [];
      for (const ch of staahChannels) {
        const exists = existingMappings.find((m: any) => m.channel_id === ch.channel_id);
        if (!exists) {
          const createdMapping = await prisma.staah_ota_company_mappings.create({
            data: {
              property_id: pid,
              channel_id: ch.channel_id,
              company_profile_id: 0n,
              staah_interface_id: interface_.id,
              status: true,
            },
          });
          created.push(bigintToNumber(createdMapping));
        }
      }

      success(res, { synced: created.length, total_channels: staahChannels.length, created }, 'OTA mappings synced');
    } catch (err: any) {
      error(res, 'OTA mapping sync failed: ' + err.message, 500);
    }
  }

  static async otaMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const { company_profile_id, status } = req.body;

      const existing = await prisma.staah_ota_company_mappings.findUnique({ where: { id } });
      if (!existing || existing.property_id !== pid) { notFound(res, 'OTA mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (company_profile_id !== undefined) data.company_profile_id = BigInt(company_profile_id);
      if (status !== undefined) data.status = Boolean(status);

      const result = await prisma.staah_ota_company_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'OTA mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update OTA mapping', 500);
    }
  }

  static async otaMappingDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const existing = await prisma.staah_ota_company_mappings.findUnique({ where: { id } });
      if (!existing || existing.property_id !== pid) { notFound(res, 'OTA mapping not found'); return; }
      await prisma.staah_ota_company_mappings.delete({ where: { id } });
      success(res, null, 'OTA mapping deleted');
    } catch (err: any) {
      error(res, 'Failed to delete OTA mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Room Content Breakdowns
  // ═══════════════════════════════════════════════

  static async contentBreakdownList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.staah_room_content_breakdowns.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { room_types: { select: { id: true, name: true } } },
        }),
        prisma.staah_room_content_breakdowns.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list content breakdowns', 500);
    }
  }

  static async contentBreakdownCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { staah_interface_id, room_type_id, description, adult, child } = req.body;

      if (!staah_interface_id || !room_type_id || !description) {
        badRequest(res, 'staah_interface_id, room_type_id, and description are required');
        return;
      }

      const result = await prisma.staah_room_content_breakdowns.create({
        data: {
          property_id: pid,
          staah_interface_id: BigInt(staah_interface_id),
          room_type_id: BigInt(room_type_id),
          description,
          adult: adult || 0,
          child: child || 0,
        },
      });

      success(res, bigintToNumber(result), 'Content breakdown created');
    } catch (err: any) {
      error(res, 'Failed to create content breakdown', 500);
    }
  }

  static async contentBreakdownUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const { description, adult, child, status } = req.body;

      const existing = await prisma.staah_room_content_breakdowns.findUnique({ where: { id } });
      if (!existing || existing.property_id !== pid) { notFound(res, 'Content breakdown not found'); return; }

      const data: any = { updated_at: new Date() };
      if (description !== undefined) data.description = description;
      if (adult !== undefined) data.adult = adult;
      if (child !== undefined) data.child = child;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_room_content_breakdowns.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Content breakdown updated');
    } catch (err: any) {
      error(res, 'Failed to update content breakdown', 500);
    }
  }

  static async contentBreakdownDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;
      const existing = await prisma.staah_room_content_breakdowns.findUnique({ where: { id } });
      if (!existing || existing.property_id !== pid) { notFound(res, 'Content breakdown not found'); return; }
      await prisma.staah_room_content_breakdowns.update({
        where: { id },
        data: { deleted_at: new Date() },
      });
      success(res, null, 'Content breakdown deleted');
    } catch (err: any) {
      error(res, 'Failed to delete content breakdown', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Push/Pull/Sync Actions
  // ═══════════════════════════════════════════════

  /**
   * Laravel StaahInterfaceController::syncAvailability — dispatches the STAAH ARI
   * (Availability/Rate/Inventory) push for a date range. Accepts either
   * `staah_interface_id` (frontend-node sends this) or `hotel_id` (Laravel sends this).
   */
  static async syncAvailability(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = { ...(req.body ?? {}), ...(req.params ?? {}) } as any;
      const dateFrom: string | undefined = body.date_from;
      const dateTo: string | undefined = body.date_to;
      if (!dateFrom || !dateTo || dateTo < dateFrom) {
        badRequest(res, 'date_from and date_to are required (date_to >= date_from)');
        return;
      }

      const interface_ = body.staah_interface_id
        ? await prisma.staah_interfaces.findUnique({ where: { id: idParam(body.staah_interface_id) } })
        : body.hotel_id
          ? await prisma.staah_interfaces.findFirst({ where: { hotel_id: String(body.hotel_id), deleted_at: null } })
          : null;
      if (!interface_ || interface_.property_id !== pid) { notFound(res, 'Staah interface not found'); return; }

      const rooms = await buildAriPayload(interface_, dateFrom, dateTo);
      const payload = { hotelid: interface_.hotel_id, room: rooms };

      if (!rooms.length) {
        await writeAriLog(interface_.id, interface_.hotel_id, 'skipped', payload, null, null, null, 'No mapped room/rate rows for the range');
        success(res, null, 'Staah ARI sync skipped (no data)');
        return;
      }

      const result = await staahService.storeRates(payload);
      const ok = StaahService.isSuccess(result);
      const roomId = [...new Set(rooms.map((r: any) => r.roomid))].join(',');
      const ratePlanId = [...new Set(rooms.flatMap((r: any) => r.date.flatMap((d: any) => (d.rate ?? []).map((x: any) => x.rateplanid))))].join(',');
      await writeAriLog(interface_.id, interface_.hotel_id, ok ? 'success' : 'failed', payload, result, roomId, ratePlanId, ok ? null : StaahService.extractErrorMsg(result), dateFrom, dateTo);
      if (!ok) {
        error(res, 'Staah API Error: ' + StaahService.extractErrorMsg(result), 502);
        return;
      }
      success(res, result, 'Staah ARI sync dispatched');
    } catch (err: any) {
      error(res, 'ARI sync failed: ' + err.message, 500);
    }
  }

  static async pullFromStaah(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = { ...(req.body ?? {}), ...(req.params ?? {}) } as any;
      const interface_ = body.staah_interface_id || req.params.id
        ? await prisma.staah_interfaces.findUnique({ where: { id: idParam(body.staah_interface_id ?? req.params.id) } })
        : await prisma.staah_interfaces.findFirst({ where: { property_id: pid, deleted_at: null } });
      if (!interface_ || interface_.property_id !== pid) { notFound(res, 'Interface not found'); return; }

      // Laravel StaahInterfaceController::pullFromStaah — pull properties → rooms → rates,
      // then diff against local master data and return matched/unmatched mapping analysis.
      const propertiesRaw: any = await staahService.listingProperty();
      const properties: any[] = propertiesRaw?.data?.properties ?? propertiesRaw?.properties ?? propertiesRaw?.data ?? propertiesRaw ?? [];
      const warnings: Record<string, any> = {};
      let roomTypes: any[] = [];
      let ratePlans: any[] = [];

      for (const prop of Array.isArray(properties) ? properties : []) {
        const hotelId = prop?.propertyid ?? prop?.hotelid ?? '';
        if (!hotelId) continue;
        try {
          const rr: any = await staahService.listingRoomType(String(hotelId));
          const rooms = rr?.data?.rooms ?? rr?.rooms ?? rr?.data ?? [];
          for (const room of Array.isArray(rooms) ? rooms : []) if (room && typeof room === 'object') roomTypes.push({ ...room, _hotelid: hotelId });
        } catch (e: any) {
          (warnings.rooms ??= {})[hotelId] = e.message;
        }
        try {
          const rrate: any = await staahService.listingRatePlan(String(hotelId));
          const rates = rrate?.data?.rateplans ?? rrate?.rateplans ?? rrate?.data ?? [];
          for (const rate of Array.isArray(rates) ? rates : []) if (rate && typeof rate === 'object') ratePlans.push({ ...rate, _hotelid: hotelId });
        } catch (e: any) {
          (warnings.rates ??= {})[hotelId] = e.message;
        }
      }

      const norm = (s: any) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
      const [localProperties, localRoomTypes, localRates] = await Promise.all([
        prisma.properties.findMany({ where: { id: pid, deleted_at: null, status: 1 }, select: { id: true, name: true } }),
        prisma.room_types.findMany({ where: { property_id: pid, deleted_at: null, status: 1 }, select: { id: true, name: true } }),
        prisma.rates.findMany({ where: { property_id: pid, deleted_at: null, status: 1, staah: true }, select: { id: true, name: true, code: true } }),
      ]);

      const diff = (rows: any[], staahIdOf: (r: any) => any, staahNameOf: (r: any) => any, locals: any[], localMatch: (l: any, key: string) => boolean) =>
        rows.map((r) => {
          const key = norm(staahIdOf(r));
          const m = locals.find((l) => localMatch(l, key));
          return { staah_id: staahIdOf(r) ?? 'N/A', staah_name: staahNameOf(r) ?? 'N/A', hotel_id: r._hotelid ?? null, local_id: m ? String(m.id) : null, local_name: m ? m.name : null, status: m ? 'matched' : 'unmatched' };
        });

      const propertyMapping = diff(properties, (p) => p.propertyid ?? p.hotelid, (p) => p.propertyname ?? p.HotelName, localProperties, (l, k) => norm(l.name) === k);
      const roomMapping = diff(roomTypes, (r) => r.roomid, (r) => r.roomname ?? r.roomtype, localRoomTypes, (l, k) => norm(l.name) === k);
      const rateMapping = diff(ratePlans, (r) => r.rateplanid, (r) => r.rateplanname ?? r.name, localRates, (l, k) => norm(l.name) === k || norm(l.code) === k);

      const summarize = (arr: any[]) => ({ total: arr.length, matched: arr.filter((i) => i.status === 'matched').length, unmatched: arr.filter((i) => i.status === 'unmatched').length });

      success(res, {
        properties: propertyMapping, rooms: roomMapping, rates: rateMapping,
        summary: { properties: summarize(propertyMapping), rooms: summarize(roomMapping), rates: summarize(rateMapping) },
        ...(Object.keys(warnings).length ? { warnings } : {}),
      }, 'Data fetched from Staah API');
    } catch (err: any) {
      error(res, 'Pull failed: ' + err.message, 500);
    }
  }

  /**
   * Frontend-node calls `/cms/staah-manager/sync-from-staah`, but Laravel base
   * never registered a route for it either — so the button was dead in both.
   * Re-uses pullFromStaah's STAAH→local diff, then force-refreshes mappings.
   * NOTE: this performs soft-deletes on local mappings (deleted_at), it does
   * not hard-delete rows.
   */
  static async syncFromStaah(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = { ...(req.body ?? {}), ...(req.params ?? {}) } as any;
      const interface_ = body.staah_interface_id
        ? await prisma.staah_interfaces.findUnique({ where: { id: idParam(body.staah_interface_id) } })
        : await prisma.staah_interfaces.findFirst({ where: { property_id: pid, deleted_at: null } });
      if (!interface_ || interface_.property_id !== pid) { notFound(res, 'Staah interface not found'); return; }

      // 1. Pull the fresh STAAH content for this hotel.
      const roomRaw: any = await staahService.listingRoomType(interface_.hotel_id);
      const rooms = roomRaw?.data?.rooms ?? roomRaw?.rooms ?? roomRaw?.data ?? [];
      const rateRaw: any = await staahService.listingRatePlan(interface_.hotel_id);
      const ratePlans = rateRaw?.data?.rateplans ?? rateRaw?.rateplans ?? rateRaw?.data ?? [];

      const norm = (s: any) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
      const [localRoomTypes, localRates] = await Promise.all([
        prisma.room_types.findMany({ where: { property_id: pid, deleted_at: null, status: 1 }, select: { id: true, name: true } }),
        prisma.rates.findMany({ where: { property_id: pid, deleted_at: null, status: 1, staah: true }, select: { id: true, name: true, code: true } }),
      ]);

      const matchedRoomIds = new Set<string>();
      let roomCreated = 0, roomUpdated = 0;
      for (const r of Array.isArray(rooms) ? rooms : []) {
        const staahRoomId = r?.roomid ?? r?.RoomId;
        if (!staahRoomId) continue;
        const local = localRoomTypes.find((l: any) => norm(l.name) === norm(staahRoomId));
        if (!local) continue;
        matchedRoomIds.add(String(local.id));
        const existing = await prisma.staah_room_mappings.findFirst({
          where: { staah_interface_id: interface_.id, room_type_id: local.id, deleted_at: null },
        });
        const occupancy = r?.occupancy ?? r?.maxoccupancy;
        const data = {
          ...(isEmptyVal(existing?.data) ? {} : (existing?.data as any)),
          staah_raw: r,
        };
        if (existing) {
          await prisma.staah_room_mappings.update({
            where: { id: existing.id },
            data: {
              staah_room_id: String(staahRoomId),
              status: 'active', last_sync_at: new Date(), data,
              max_occupancy: Number(occupancy) > 0 ? Number(occupancy) : existing.max_occupancy,
              updated_at: new Date(),
            },
          });
          roomUpdated++;
        } else {
          await prisma.staah_room_mappings.create({
            data: {
              staah_interface_id: interface_.id, room_type_id: local.id,
              staah_room_id: String(staahRoomId),
              max_occupancy: Number(occupancy) > 0 ? Number(occupancy) : 2,
              status: 'active', last_sync_at: new Date(), data,
              created_at: new Date(), updated_at: new Date(),
            },
          });
          roomCreated++;
        }
      }

      const matchedRateIds = new Set<string>();
      let rateCreated = 0, rateUpdated = 0;
      for (const r of Array.isArray(ratePlans) ? ratePlans : []) {
        const staahRatePlanId = r?.rateplanid ?? r?.RatePlanId;
        if (!staahRatePlanId) continue;
        const local = localRates.find((l: any) => norm(l.name) === norm(staahRatePlanId) || norm(l.code) === norm(staahRatePlanId));
        if (!local) continue;
        matchedRateIds.add(String(local.id));
        const existing = await prisma.staah_rate_mappings.findFirst({
          where: { staah_interface_id: interface_.id, rate_id: local.id, deleted_at: null },
        });
        const data = {
          ...(isEmptyVal(existing?.data) ? {} : (existing?.data as any)),
          staah_raw: r,
        };
        if (existing) {
          await prisma.staah_rate_mappings.update({
            where: { id: existing.id },
            data: { staah_rate_plan_id: String(staahRatePlanId), status: 'active', last_sync_at: new Date(), data, updated_at: new Date() },
          });
          rateUpdated++;
        } else {
          await prisma.staah_rate_mappings.create({
            data: {
              staah_interface_id: interface_.id, rate_id: local.id,
              staah_rate_plan_id: String(staahRatePlanId),
              status: 'active', last_sync_at: new Date(), data,
              created_at: new Date(), updated_at: new Date(),
            },
          });
          rateCreated++;
        }
      }

      // 2. Soft-delete mappings whose counterpart no longer exists on STAAH.
      const staleRooms = await prisma.staah_room_mappings.findMany({
        where: { staah_interface_id: interface_.id, deleted_at: null },
        select: { id: true, room_type_id: true },
      });
      let roomRemoved = 0;
      for (const m of staleRooms) {
        if (matchedRoomIds.has(String(m.room_type_id))) continue;
        await prisma.staah_room_mappings.update({
          where: { id: m.id }, data: { deleted_at: new Date(), status: 'inactive', updated_at: new Date() },
        });
        roomRemoved++;
      }

      const staleRates = await prisma.staah_rate_mappings.findMany({
        where: { staah_interface_id: interface_.id, deleted_at: null },
        select: { id: true, rate_id: true },
      });
      let rateRemoved = 0;
      for (const m of staleRates) {
        if (matchedRateIds.has(String(m.rate_id))) continue;
        await prisma.staah_rate_mappings.update({
          where: { id: m.id }, data: { deleted_at: new Date(), status: 'inactive', updated_at: new Date() },
        });
        rateRemoved++;
      }

      const summary = { rooms: { created: roomCreated, updated: roomUpdated, removed: roomRemoved }, rates: { created: rateCreated, updated: rateUpdated, removed: rateRemoved } };
      await writeSyncLog(interface_.id, 'mapping', 'pull', 'success', interface_.hotel_id, { summary }, { summary }, 'Sync from Staah completed', {});
      success(res, summary, 'Sync from Staah completed. Mappings have been refreshed.');
    } catch (err: any) {
      error(res, 'Sync from Staah failed: ' + err.message, 500);
    }
  }

  /**
   * Laravel StaahInterfaceController::pullReservations — manual reservation
   * pull is disabled because STAAH pushes reservations through the webhook.
   */
  static async pullReservations(_req: Request, res: Response): Promise<void> {
    error(res, 'Manual pull is disabled. Staah automatically pushes reservations via Webhook.', 400);
  }

  /**
   * Laravel StaahInterfaceController_Push::pushRoomToStaah
   * Payload shape: { SellableProducts: { hotelid, SellableProduct: [{ InvStatusType, roomid, GuestRoom }] } }
   */
  static async pushRoom(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = { ...(req.body ?? {}), ...(req.params ?? {}) } as any;
      const ROOM_ACTIONS = ['Initial', 'Modify', 'Active', 'Deactivated', 'Delete'];
      const action: string = body.action || 'Modify';
      if (!ROOM_ACTIONS.includes(action)) { badRequest(res, `action must be one of: ${ROOM_ACTIONS.join(', ')}`); return; }
      if (!body.room_type_id) { badRequest(res, 'room_type_id is required'); return; }

      const roomType = await prisma.room_types.findFirst({ where: { id: idParam(body.room_type_id), deleted_at: null } });
      if (!roomType) { notFound(res, 'Room type not found'); return; }
      if (roomType.property_id !== pid) { notFound(res, 'Room type not found'); return; }

      const interface_ = await prisma.staah_interfaces.findFirst({ where: { property_id: roomType.property_id, deleted_at: null } });
      if (!interface_) { notFound(res, 'Staah interface not found for this property'); return; }
      const hotelId = interface_.hotel_id;

      const roomMapping = await prisma.staah_room_mappings.findFirst({
        where: { staah_interface_id: interface_.id, room_type_id: roomType.id },
      });
      const roomId = roomMapping?.staah_room_id || String(roomType.name).toLowerCase().replace(/\s+/g, '');

      const guestRoom: any = {
        Room: { roomid: roomId, RoomType: roomType.name },
        Description: { Text: roomType.name, RoomDescription: roomType.description || roomType.name },
      };

      if (roomMapping) {
        const md: any = roomMapping.data ?? {};
        guestRoom.Occupancy = {
          MaxOccupancy: String(roomMapping.max_occupancy ?? 2),
          MaxChildOccupancy: String(roomMapping.max_child_occupancy ?? 1),
        };
        guestRoom.Room.Quantity = String(roomMapping.quantity ?? 1);
        if (!isEmptyVal(md.RoomRate)) {
          guestRoom.Room.RoomRate = String(md.RoomRate);
        } else {
          // fallback: room type base rate (min_rate then rate)
          const rt: any = roomType;
          let baseRate = Number((rt as any).min_rate ?? 0);
          if (baseRate <= 0) baseRate = Number((rt as any).rate ?? 0);
          if (baseRate > 0) guestRoom.Room.RoomRate = String(baseRate);
        }
        if (!isEmptyVal(md.RoomType)) guestRoom.Room.RoomType = md.RoomType;
        if (!isEmptyVal(roomMapping.description)) guestRoom.Description.Text = roomMapping.description;
        if (!isEmptyVal(roomMapping.room_description)) guestRoom.Description.RoomDescription = roomMapping.room_description;
        if (roomMapping.size_measurement) {
          guestRoom.Room.SizeMeasurement = String(roomMapping.size_measurement);
          guestRoom.Room.SizeMeasurementUnit = roomMapping.size_measurement_unit || 'sqm';
        }
        if (!isEmptyVal(md.Facilities?.Facility)) guestRoom.Facilities = md.Facilities;
        if (roomMapping.latitude && roomMapping.longitude) {
          guestRoom.Position = { Latitude: String(roomMapping.latitude), Longitude: String(roomMapping.longitude) };
        }
        const address: any = {};
        if (roomMapping.address_line) address.AddressLine = roomMapping.address_line;
        if (roomMapping.city_name) address.CityName = roomMapping.city_name;
        if (roomMapping.country_name) address.CountryName = roomMapping.country_name;
        if (roomMapping.postal_code) address.PostalCode = roomMapping.postal_code;
        if (Object.keys(address).length) guestRoom.Address = address;
      }

      const sellableProduct: any = { InvStatusType: action, roomid: roomId, GuestRoom: guestRoom };
      if (action !== 'Initial') sellableProduct.InvNotifType = 'Overlay';

      const payload = { SellableProducts: { hotelid: hotelId, SellableProduct: [sellableProduct] } };

      const response = await staahService.createUpdateDeleteRoomType(payload);
      if (!StaahService.isSuccess(response)) {
        const msg = StaahService.extractErrorMsg(response);
        await writeSyncLog(interface_.id, 'room_type', 'push', 'failed', hotelId, payload, response, `Staah API Error: ${msg}`, { roomId });
        error(res, 'Staah API Error: ' + msg, 502);
        return;
      }

      const mergedRoomData = { ...((roomMapping?.data as any) ?? {}), last_push_response: response as any };
      if (roomMapping) {
        await prisma.staah_room_mappings.update({
          where: { id: roomMapping.id },
          data: { staah_room_id: roomId, status: 'active', last_sync_at: new Date(), data: mergedRoomData, updated_at: new Date() },
        });
      } else {
        await prisma.staah_room_mappings.create({
          data: {
            staah_interface_id: interface_.id, room_type_id: roomType.id, staah_room_id: roomId,
            status: 'active', last_sync_at: new Date(), data: mergedRoomData,
            created_at: new Date(), updated_at: new Date(),
          },
        });
      }
      await writeSyncLog(interface_.id, 'room_type', 'push', 'success', hotelId, payload, response, 'Room type pushed to Staah', { roomId });
      success(res, null, 'Room type pushed to Staah successfully');
    } catch (err: any) {
      error(res, 'Push failed: ' + err.message, 500);
    }
  }

  /**
   * Laravel StaahInterfaceController_Push::pushRateToStaah
   * Payload shape: { RatePlans: { hotelid, RatePlan: [{ RatePlanNotifType, rateplanid, MealPlanID, Description }] } }
   */
  static async pushRate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = { ...(req.body ?? {}), ...(req.params ?? {}) } as any;
      const RATE_ACTIONS = ['New', 'Overlay', 'Remove', 'Activate', 'Delete'];
      const action: string = body.action || 'Overlay';
      if (!RATE_ACTIONS.includes(action)) { badRequest(res, `action must be one of: ${RATE_ACTIONS.join(', ')}`); return; }
      if (!body.rate_id) { badRequest(res, 'rate_id is required'); return; }

      const rate = await prisma.rates.findFirst({ where: { id: idParam(body.rate_id), deleted_at: null } });
      if (!rate || rate.property_id !== pid) { notFound(res, 'Rate not found'); return; }

      const interface_ = await prisma.staah_interfaces.findFirst({ where: { property_id: rate.property_id, deleted_at: null } });
      if (!interface_) { notFound(res, 'Staah interface not found for this property'); return; }
      const hotelId = interface_.hotel_id;

      const rateMapping = await prisma.staah_rate_mappings.findFirst({
        where: { staah_interface_id: interface_.id, rate_id: rate.id },
      });
      const rateId = rateMapping?.staah_rate_plan_id || String(rate.code || rate.name).toLowerCase().replace(/\s+/g, '');
      const mealPlanId = rateMapping?.meal_plan_id ?? 15;

      const payload = {
        RatePlans: {
          hotelid: hotelId,
          RatePlan: [{
            RatePlanNotifType: action,
            rateplanid: rateId,
            MealPlanID: String(mealPlanId),
            Description: { Name: rate.name, Text: rate.description ?? '' },
          }],
        },
      };

      const response = await staahService.createUpdateDeleteRatePlan(payload);
      if (!StaahService.isSuccess(response)) {
        const msg = StaahService.extractErrorMsg(response);
        await writeSyncLog(interface_.id, 'rate_plan', 'push', 'failed', hotelId, payload, response, `Staah API Error: ${msg}`, { ratePlanId: rateId });
        error(res, 'Staah API Error: ' + msg, 502);
        return;
      }

      const mergedRateData = { ...((rateMapping?.data as any) ?? {}), last_push_response: response as any };
      if (rateMapping) {
        await prisma.staah_rate_mappings.update({
          where: { id: rateMapping.id },
          data: { staah_rate_plan_id: rateId, meal_plan_id: mealPlanId, status: 'active', last_sync_at: new Date(), data: mergedRateData, updated_at: new Date() },
        });
      } else {
        await prisma.staah_rate_mappings.create({
          data: {
            staah_interface_id: interface_.id, rate_id: rate.id, staah_rate_plan_id: rateId,
            meal_plan_id: mealPlanId, status: 'active', last_sync_at: new Date(), data: mergedRateData,
            created_at: new Date(), updated_at: new Date(),
          },
        });
      }
      await writeSyncLog(interface_.id, 'rate_plan', 'push', 'success', hotelId, payload, response, 'Rate plan pushed to Staah', { ratePlanId: rateId });
      success(res, null, 'Rate plan pushed to Staah successfully');
    } catch (err: any) {
      error(res, 'Push failed: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Master Data (config constants)
  // ═══════════════════════════════════════════════

  static async master(req: Request, res: Response): Promise<void> {
    const result = {
      meal_plans: [
        { value: 1, label: 'All inclusive' },
        { value: 2, label: 'Breakfast' },
        { value: 11, label: 'European plan' },
        { value: 15, label: 'Room only (Default)' },
      ],
      hotel_types: [
        { value: 1, label: 'Hotel' },
        { value: 2, label: 'Motel' },
        { value: 3, label: 'Vacational Rental' },
      ],
      languages: [
        { value: 'en', label: 'English' },
        { value: 'id', label: 'Bahasa Indonesia' },
      ],
      currencies: [
        { value: 'IDR', label: 'IDR' },
        { value: 'USD', label: 'USD' },
        { value: 'GBP', label: 'GBP' },
      ],
      time_zones: [
        { value: 'Asia/Jakarta', label: 'Asia/Jakarta (GMT+7)' },
        { value: 'Asia/Singapore', label: 'Asia/Singapore (GMT+8)' },
        { value: 'Europe/London', label: 'Europe/London' },
      ],
      status_reservations: [
        { value: '1', label: 'Confirmed' },
        { value: '2', label: 'Cancelled' },
        { value: '3', label: 'Pending' },
      ],
    };

    success(res, [], 'Success', 200, { master: result } as any);
  }

  // ═══════════════════════════════════════════════
  // STAah Rates Calendar (grid view)
  // ═══════════════════════════════════════════════

  static async ratesCalendar(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { date_from, date_to, room_type_id, rate_id } = req.body;
      if (!date_from || !date_to) {
        error(res, 'date_from and date_to are required', 400);
        return;
      }

      const interface_ = await prisma.staah_interfaces.findFirst({
        where: { property_id: pid, deleted_at: null },
      });
      if (!interface_) {
        error(res, 'Staah interface not found for property', 404);
        return;
      }

      const roomTypes = await prisma.room_types.findMany({
        where: { property_id: pid, deleted_at: null, status: 1 },
        ...(room_type_id ? { where: { ...{ property_id: pid, deleted_at: null, status: 1 }, id: BigInt(room_type_id) } } : {}),
        select: { id: true, name: true },
      });

      const rates = await prisma.rates.findMany({
        where: {
          property_id: pid,
          deleted_at: null,
          status: 1,
          staah: true,
          ...(rate_id ? { id: BigInt(rate_id) } : {}),
        },
        select: { id: true, name: true, code: true },
      });

      if (!roomTypes.length || !rates.length) {
        success(res, { grid: [], dates: [], roomTypes, rates }, 'No room types or rates mapped to STAAH');
        return;
      }

      const rateRates = await prisma.rate_rates.findMany({
        where: {
          rate_id: { in: rates.map((r: any) => r.id) },
          room_type_id: { in: roomTypes.map((rt: any) => Number(rt.id)) },
          date: { gte: new Date(`${date_from}T00:00:00Z`), lte: new Date(`${date_to}T23:59:59Z`) },
          deleted_at: null,
        },
        orderBy: { date: 'asc' },
      });

      const dates: string[] = [];
      const period = new Date(date_from);
      const endDate = new Date(date_to);
      while (period <= endDate) {
        dates.push(period.toISOString().split('T')[0]);
        period.setDate(period.getDate() + 1);
      }

      const grid: any[] = [];
      for (const rt of roomTypes) {
        const row: any = { room_type: { id: rt.id, name: rt.name, staah_room_id: rt.name.toLowerCase().replace(/\s+/g, '') }, rates: [] };
        for (const rate of rates) {
          const rateData: any = { rate: { id: rate.id, name: rate.name, code: rate.code || '', staah_rate_plan_id: (rate.code || rate.name || '').toLowerCase().replace(/\s+/g, '') }, dates: {} };
          for (const date of dates) {
            const rr = rateRates.find((r: any) => r.rate_id === rate.id && r.room_type_id === rt.id && r.date.toISOString().split('T')[0] === date);
            if (rr) {
              rateData.dates[date] = {
                one_adult: Number(rr.one_adult),
                two_adult: Number(rr.two_adult),
                extra_adult: Number(rr.extra_adult),
                extra_child: Number(rr.extra_child),
                stop_sell: rr.stop_sell,
                min_night: rr.min_night,
                max_night: rr.max_night,
                stop_arrival: rr.stop_arrival,
                stop_departure: rr.stop_departure,
              };
            }
          }
          row.rates.push(rateData);
        }
        grid.push(row);
      }

      success(res, { grid, dates, roomTypes, rates }, 'Rates calendar generated');
    } catch (err: any) {
      console.error('Rates calendar error:', err);
      error(res, 'Failed to generate rates calendar: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // ARI Push (Availability, Rate, Inventory)
  // ═══════════════════════════════════════════════

  /** Alias of syncAvailability — same ARI payload + sync-log behaviour. */
  static async ariPush(req: Request, res: Response): Promise<void> {
    return StaahController.syncAvailability(req, res);
  }

  /**
   * Laravel SyncPriceStaah job / RateController::syncStaah — pushes one rate's
   * date range. When no rate_id is supplied, picks the oldest unsynced
   * staah rate (Laravel: Rate::where('staah',1)->where('sync_staah',0)->first()).
   */
  static async syncPriceStaah(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = { ...(req.body ?? {}), ...(req.params ?? {}) } as any;
      const rateId = body.rate_id ?? body.id ?? (req.params as any).rate;

      const rate = rateId
        ? await prisma.rates.findFirst({ where: { id: idParam(rateId), property_id: pid, deleted_at: null } })
        : await prisma.rates.findFirst({
            where: { property_id: pid, staah: true, sync_staah: false, deleted_at: null },
            orderBy: { id: 'asc' },
          });
      if (!rate) { success(res, null, 'No rate found'); return; }

      const interface_ = await prisma.staah_interfaces.findFirst({
        where: { property_id: rate.property_id, deleted_at: null },
      });
      if (!interface_) { error(res, 'Staah interface not found for property ' + rate.property_id, 404); return; }

      const dateFrom = formatDate(rate.start_date);
      const dateTo = formatDate(rate.end_date);

      // Laravel marks sync_staah = 1 BEFORE pushing (raw DB::table('rates')->update)
      await prisma.rates.update({ where: { id: rate.id }, data: { sync_staah: true } });

      const rooms = await buildAriPayload(interface_, dateFrom, dateTo, rate.id);
      const roomId = [...new Set(rooms.map((r: any) => r.roomid))].join(',');
      const ratePlanId = [...new Set(rooms.flatMap((r: any) => r.date.flatMap((d: any) => (d.rate ?? []).map((x: any) => x.rateplanid))))].join(',');

      if (!rooms.length) {
        await writeSyncLog(interface_.id, 'price', 'push', 'skipped', interface_.hotel_id, {}, {}, 'No valid rates', {
          roomId, ratePlanId, dateFrom: rate.start_date, dateTo: rate.end_date,
        });
        success(res, null, 'No valid rates');
        return;
      }

      const payload = { hotelid: interface_.hotel_id, room: rooms };
      const result = await staahService.storeRates(payload);
      const ok = StaahService.isSuccess(result);
      await writeSyncLog(
        interface_.id, 'price', 'push', ok ? 'success' : 'failed', interface_.hotel_id, payload, result,
        ok ? null : 'Staah API Error: ' + StaahService.extractErrorMsg(result),
        { roomId, ratePlanId, dateFrom: rate.start_date, dateTo: rate.end_date },
      );
      if (!ok) { error(res, 'Staah API Error: ' + StaahService.extractErrorMsg(result), 502); return; }
      success(res, result, 'Price synced successfully');
    } catch (err: any) {
      error(res, 'Price sync failed: ' + err.message, 500);
    }
  }
}
