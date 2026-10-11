import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { badRequest, error, notFound, success } from '../utils/response';
import { STATUS_OPTIONS, crudPermission, laravelPaging, listPermission } from '../utils/tableMeta';
import { storedImageUrl } from '../utils/storage';

// Laravel parity: App\Http\Controllers\Cms\Hotel\LoyaltyFacilityController +
// LoyaltyTermController (routes/cms.php:1432-1433, inside the `content` prefix).
// The booking engine reads both through GET /middleware/loyalty/properties
// (MiddlewareBookingEngineController::loyaltyProperties, web.php:139), so both
// tables are read-only from the outside and written only from the HMS UI.
//
// config('cms.loyalty_facilities') / config('cms.loyalty_terms')
//
// The reference ships 7 keys (pool, restaurant, wifi, parking, gym, spa,
// concierge) which is far too few to describe a real hotel, so anything the
// operator wanted to add had nowhere to go. The list below covers the amenity
// set a hotel actually advertises. `icon` is the react-icons name the booking
// engine renders (hmsBookingEngine/frontend/components/template/loyalty.tsx
// FACILITY_CONFIG), so adding a key here means adding it there too.
export const LOYALTY_FACILITY_KEYS = [
  // ── Food & drink ────────────────────────────────────────────────────────────
  { value: 'restaurant', label: 'Restaurant', icon: 'Utensils' },
  { value: 'restaurant_indo', label: 'Indonesian Restaurant', icon: 'Utensils' },
  { value: 'restaurant_japanese', label: 'Japanese Restaurant', icon: 'Utensils' },
  { value: 'restaurant_chinese', label: 'Chinese Restaurant', icon: 'Utensils' },
  { value: 'restaurant_western', label: 'Western Restaurant', icon: 'Utensils' },
  { value: 'cafe', label: 'Cafe', icon: 'Coffee' },
  { value: 'bar', label: 'Bar', icon: 'Cocktail' },
  { value: 'lounge', label: 'Lounge', icon: 'Couch' },
  { value: 'room_service', label: 'Room Service', icon: 'ConciergeBell' },
  { value: 'breakfast', label: 'Breakfast', icon: 'Coffee' },
  { value: 'buffet', label: 'Buffet', icon: 'Utensils' },
  { value: 'pool_bar', label: 'Pool Bar', icon: 'Cocktail' },

  // ── Wellness ───────────────────────────────────────────────────────────────
  { value: 'pool', label: 'Swimming Pool', icon: 'SwimmingPool' },
  { value: 'pool_indoor', label: 'Indoor Pool', icon: 'SwimmingPool' },
  { value: 'pool_outdoor', label: 'Outdoor Pool', icon: 'SwimmingPool' },
  { value: 'kids_pool', label: 'Kids Pool', icon: 'SwimmingPool' },
  { value: 'spa', label: 'Spa', icon: 'Spa' },
  { value: 'massage', label: 'Massage', icon: 'HandPaper' },
  { value: 'sauna', label: 'Sauna', icon: 'HotTub' },
  { value: 'steam_room', label: 'Steam Room', icon: 'HotTub' },
  { value: 'jacuzzi', label: 'Jacuzzi', icon: 'HotTub' },
  { value: 'hot_spring', label: 'Hot Spring', icon: 'HotTub' },
  { value: 'onsen', label: 'Onsen', icon: 'HotTub' },
  { value: 'gym', label: 'Fitness Centre', icon: 'Dumbbell' },
  { value: 'yoga', label: 'Yoga', icon: 'Fire' },

  // ── Connectivity & business ─────────────────────────────────────────────────
  { value: 'wifi', label: 'Free WiFi', icon: 'Wifi' },
  { value: 'internet', label: 'High-Speed Internet', icon: 'Globe' },
  { value: 'business_center', label: 'Business Centre', icon: 'Briefcase' },
  { value: 'meeting_room', label: 'Meeting Room', icon: 'Users' },
  { value: 'conference_room', label: 'Conference Room', icon: 'Users' },

  // ── Transport & parking ─────────────────────────────────────────────────────
  { value: 'parking', label: 'Free Parking', icon: 'Parking' },
  { value: 'valet_parking', label: 'Valet Parking', icon: 'Parking' },
  { value: 'ev_charging', label: 'EV Charging', icon: 'Car' },
  { value: 'airport_shuttle', label: 'Airport Shuttle', icon: 'ShuttleVan' },
  { value: 'airport_transfer', label: 'Airport Transfer', icon: 'ShuttleVan' },
  { value: 'taxi', label: 'Taxi Service', icon: 'Taxi' },
  { value: 'bike_rental', label: 'Bicycle Rental', icon: 'Bicycle' },

  // ── Services ────────────────────────────────────────────────────────────────
  { value: 'concierge', label: 'Concierge', icon: 'ConciergeBell' },
  { value: 'room_service_24h', label: '24-Hour Reception', icon: 'ConciergeBell' },
  { value: 'laundry', label: 'Laundry Service', icon: 'Tshirt' },
  { value: 'dry_cleaning', label: 'Dry Cleaning', icon: 'Tshirt' },
  { value: 'ironing', label: 'Ironing Service', icon: 'Tshirt' },
  { value: 'luggage_storage', label: 'Luggage Storage', icon: 'Suitcase' },
  { value: 'currency_exchange', label: 'Currency Exchange', icon: 'MoneyBillWave' },
  { value: 'atm', label: 'ATM', icon: 'MoneyBillWave' },
  { value: 'tour_desk', label: 'Tour Desk', icon: 'MapMarkedAlt' },
  { value: 'ticketing', label: 'Ticket Service', icon: 'TicketAlt' },
  { value: 'shuttle', label: 'Shuttle Service', icon: 'ShuttleVan' },

  // ── Family & kids ───────────────────────────────────────────────────────────
  { value: 'kids_club', label: "Kids' Club", icon: 'Child' },
  { value: 'baby_crib', label: 'Baby Crib', icon: 'Baby' },
  { value: 'stroller', label: 'Stroller', icon: 'Child' },
  { value: 'family_room', label: 'Family Room', icon: 'Users' },

  // ── In-room ─────────────────────────────────────────────────────────────────
  { value: 'air_conditioning', label: 'Air Conditioning', icon: 'Snowflake' },
  { value: 'non_smoking_room', label: 'Non-Smoking Room', icon: 'Ban' },
  { value: 'smoking_room', label: 'Smoking Room', icon: 'Smoking' },
  { value: 'mini_bar', label: 'Mini Bar', icon: 'GlassCheers' },
  { value: 'coffee_maker', label: 'Coffee Maker', icon: 'Coffee' },
  { value: 'tea_maker', label: 'Tea Maker', icon: 'MugHot' },
  { value: 'flat_tv', label: 'Flat-Screen TV', icon: 'Tv' },
  { value: 'cable_tv', label: 'Cable TV', icon: 'Tv' },
  { value: 'safe', label: 'In-Room Safe', icon: 'Lock' },
  { value: 'hairdryer', label: 'Hairdryer', icon: 'Wind' },
  { value: 'minibar', label: 'Minibar', icon: 'GlassCheers' },
  { value: 'kettle', label: 'Electric Kettle', icon: 'MugHot' },
  { value: 'bathtub', label: 'Bathtub', icon: 'Bath' },
  { value: 'shower', label: 'Shower', icon: 'Shower' },

  // ── Outdoors & scenery ─────────────────────────────────────────────────────
  { value: 'garden', label: 'Garden', icon: 'Tree' },
  { value: 'beach_access', label: 'Private Beach', icon: 'UmbrellaBeach' },
  { value: 'beachfront', label: 'Beachfront', icon: 'UmbrellaBeach' },
  { value: 'pool_view', label: 'Pool View', icon: 'SwimmingPool' },
  { value: 'mountain_view', label: 'Mountain View', icon: 'Mountain' },
  { value: 'sea_view', label: 'Sea View', icon: 'Water' },
  { value: 'sun_terrace', label: 'Sun Terrace', icon: 'Sun' },
  { value: 'bbq', label: 'BBQ Facility', icon: 'Fire' },
  { value: 'picnic_area', label: 'Picnic Area', icon: 'Tree' },

  // ── Security & accessibility ────────────────────────────────────────────────
  { value: 'security', label: '24-Hour Security', icon: 'ShieldAlt' },
  { value: 'cctv', label: 'CCTV', icon: 'Video' },
  { value: 'fire_safety', label: 'Fire Safety', icon: 'Fire' },
  { value: 'wheelchair_accessible', label: 'Wheelchair Accessible', icon: 'AccessibleIcon' },
  { value: 'wheelchair_accessible_lift', label: 'Wheelchair Lift', icon: 'AccessibleIcon' },
  { value: 'smoking_area', label: 'Designated Smoking Area', icon: 'Smoking' },
];

export const LOYALTY_TERM_TYPES = [
  { value: 'terms_condition', label: 'Terms & Condition' },
  { value: 'privacy_policy', label: 'Privacy Policy' },
  { value: 'register_agreement', label: 'Register Agreement' },
  { value: 'login_agreement', label: 'Login Agreement' },
];

// The reference reaches these tables through the default `mysql` connection; in node
// they are plain Postgres tables (see sql/2026-10-03_lifestyle_tables.sql), so raw
// SQL keeps the controller working without a `prisma generate` round-trip.
//
// Table names deliberately keep `lifestyle`. Everything the operator sees — menu labels,
// routes, controller, error messages — is `loyalty` now, but the tables were renamed in
// a migration-shaped change that buys nothing: they hold no user-facing string, and
// `sql/2026-10-03_lifestyle_tables.sql` plus the Laravel reference still name them.
// Renaming them would mean a table migration on top of a pure rename task.
const FACILITY_TABLE = 'property_lifestyle_facilities';
const TERM_TABLE = 'property_lifestyle_terms';

function parsePaging(query: any) {
  return {
    page: parseInt(query.page as string) || 1,
    limit: Math.min(parseInt(query.limit as string) || 10, 100),
    search: (query.search as string) || '',
  };
}

function pid(req: Request): bigint {
  return BigInt(req.user?.lastProperty ?? 0);
}

function coerceStatus(value: any, fallback = 1): number {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  if (value && typeof value === 'object' && value.value !== undefined) return coerceStatus(value.value, fallback);
  return fallback;
}

function idParam(value: any): bigint | null {
  const s = String(value ?? '');
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s);
}

// properties.telp / .fax are BigInt columns, and this handler answers through
// res.json() (not the success() helper), so the usual bigint normalisation never
// runs and JSON.stringify throws "Do not know how to serialize a BigInt".
function jsonSafe(value: any): any {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^\d{16,}$/.test(value)) return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      try {
        return Number(value.toNumber());
      } catch {
        return String(value);
      }
    }
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

export class LoyaltyFacilityController {
  // ── Facility ────────────────────────────────────────────────────────────────
  static async facilityList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePaging(req.query);
      const propertyId = pid(req);
      const offset = (page - 1) * limit;

      const where = search
        ? `and (label ilike '%' || $2 || '%' or facility_key ilike '%' || $2 || '%')`
        : '';
      const params: any[] = search ? [propertyId.toString(), search] : [propertyId.toString()];

      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, property_id, facility_key, label, icon, sort, status, created_at, updated_at
           from ${FACILITY_TABLE}
          where property_id = $1 and deleted_at is null ${where}
          order by sort asc, id asc
          limit ${limit} offset ${offset}`,
        ...params
      );
      const totalRows: any[] = await prisma.$queryRawUnsafe(
        `select count(*)::int as total from ${FACILITY_TABLE} where property_id = $1 and deleted_at is null ${where}`,
        ...params
      );
      const total = Number(totalRows[0]?.total ?? 0);

      const crud = crudPermission(req.user, 69n);
      success(res, rows, 'Success', 200, {
        table: [
          { label: 'Status', key: 'status', type: 'checkbox', options: STATUS_OPTIONS, is_search: true },
          { label: 'Facility Key', key: 'facility_key', type: 'select', options: LOYALTY_FACILITY_KEYS, is_search: true },
          { label: 'Label', key: 'label', type: 'text', is_search: false },
          { label: 'Icon', key: 'icon', type: 'text', is_search: false },
          { label: 'Sort', key: 'sort', type: 'number', is_search: false },
        ],
        permission: listPermission(req, crud),
        pagging: laravelPaging(total, limit, page),
        master: { facility_keys: LOYALTY_FACILITY_KEYS },
        pagination: {
          current_page: page,
          last_page: Math.max(1, Math.ceil(total / limit)),
          per_page: limit,
          total,
          from: total ? offset + 1 : 0,
          to: Math.min(offset + limit, total),
        },
      });
    } catch (err: any) {
      console.error('Loyalty facility list error:', err);
      error(res, 'Failed to list loyalty facilities', 500);
    }
  }

  static async facilityForm(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) {
        success(res, { status: 1 }, 'Success', 200, { master: { facility_keys: LOYALTY_FACILITY_KEYS } });
        return;
      }
      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, property_id, facility_key, label, icon, sort, status, created_at, updated_at
           from ${FACILITY_TABLE} where id = $1 and deleted_at is null`,
        id.toString()
      );
      if (!rows.length) { notFound(res, 'Loyalty facility not found'); return; }
      success(res, rows[0], 'Success', 200, { master: { facility_keys: LOYALTY_FACILITY_KEYS } });
    } catch (err: any) {
      console.error('Loyalty facility form error:', err);
      error(res, 'Failed to load Loyalty facility', 500);
    }
  }

  static async facilityStore(req: Request, res: Response): Promise<void> {
    try {
      const { facility_key, label, icon, sort, status } = req.body ?? {};
      if (!facility_key) { badRequest(res, 'The facility key field is required.'); return; }
      const propertyId = pid(req);
      const now = new Date();
      const rows: any[] = await prisma.$queryRawUnsafe(
        `insert into ${FACILITY_TABLE} (property_id, facility_key, label, icon, sort, status, created_at, updated_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $7, $8)
         returning id, property_id, facility_key, label, icon, sort, status, created_at, updated_at`,
        propertyId.toString(),
        String(facility_key),
        label ?? null,
        icon ?? null,
        Number(sort ?? 0),
        coerceStatus(status),
        now,
        req.user?.id ? String(req.user.id) : null
      );
      success(res, rows[0], 'Loyalty facility created successfully.', 200);
    } catch (err: any) {
      console.error('Loyalty facility store error:', err);
      error(res, 'Failed to create Loyalty facility', 500);
    }
  }

  static async facilityUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const { facility_key, label, icon, sort, status } = req.body ?? {};
      const existing: any[] = await prisma.$queryRawUnsafe(
        `select id from ${FACILITY_TABLE} where id = $1 and deleted_at is null`,
        id.toString()
      );
      if (!existing.length) { notFound(res, 'Loyalty facility not found'); return; }

      const sets: string[] = [];
      const params: (string | null)[] = [id.toString()];
      const push = (col: string, val: any) => {
        params.push(val === null || val === undefined ? null : String(val));
        sets.push(`${col} = $${params.length}`);
      };
      if (facility_key !== undefined) push('facility_key', facility_key);
      if (label !== undefined) push('label', label);
      if (icon !== undefined) push('icon', icon);
      if (sort !== undefined) push('sort', Number(sort));
      if (status !== undefined) push('status', coerceStatus(status));
      push('updated_at', new Date());
      if (req.user?.id) push('updated_by', String(req.user.id));
      if (!sets.length) { success(res, existing[0], 'Loyalty facility updated successfully.'); return; }

      const rows: any[] = await prisma.$queryRawUnsafe(
        `update ${FACILITY_TABLE} set ${sets.join(', ')} where id = $1
         returning id, property_id, facility_key, label, icon, sort, status, created_at, updated_at`,
        ...params
      );
      success(res, rows[0], 'Loyalty facility updated successfully.');
    } catch (err: any) {
      console.error('Loyalty facility update error:', err);
      error(res, 'Failed to update Loyalty facility', 500);
    }
  }

  static async facilityDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const rows: any[] = await prisma.$queryRawUnsafe(
        `update ${FACILITY_TABLE} set deleted_at = now(), updated_at = now(), updated_by = $2
          where id = $1 and deleted_at is null returning id`,
        id.toString(),
        req.user?.id ? String(req.user.id) : null
      );
      if (!rows.length) { notFound(res, 'Loyalty facility not found'); return; }
      success(res, [], 'Loyalty facility deleted successfully.');
    } catch (err: any) {
      console.error('Loyalty facility destroy error:', err);
      error(res, 'Failed to delete Loyalty facility', 500);
    }
  }

  // ── Term ───────────────────────────────────────────────────────────────────
  static async termList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePaging(req.query);
      const propertyId = pid(req);
      const offset = (page - 1) * limit;

      const where = search
        ? `and (title ilike '%' || $2 || '%' or content ilike '%' || $2 || '%' or type ilike '%' || $2 || '%')`
        : '';
      const params: any[] = search ? [propertyId.toString(), search] : [propertyId.toString()];

      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, property_id, type, title, content, language, sort, status, created_at, updated_at
           from ${TERM_TABLE}
          where property_id = $1 and deleted_at is null ${where}
          order by sort asc, id asc
          limit ${limit} offset ${offset}`,
        ...params
      );
      const totalRows: any[] = await prisma.$queryRawUnsafe(
        `select count(*)::int as total from ${TERM_TABLE} where property_id = $1 and deleted_at is null ${where}`,
        ...params
      );
      const total = Number(totalRows[0]?.total ?? 0);

      const crud = crudPermission(req.user, 69n);
      success(res, rows, 'Success', 200, {
        table: [
          { label: 'Status', key: 'status', type: 'checkbox', options: STATUS_OPTIONS, is_search: true },
          { label: 'Type', key: 'type', type: 'select', options: LOYALTY_TERM_TYPES, is_search: true },
          { label: 'Title', key: 'title', type: 'text', is_search: true },
          { label: 'Content', key: 'content', type: 'textarea', is_html: true, is_search: false },
          { label: 'Language', key: 'language', type: 'text', is_search: false },
          { label: 'Sort', key: 'sort', type: 'number', is_search: false },
        ],
        permission: listPermission(req, crud),
        pagging: laravelPaging(total, limit, page),
        master: { term_types: LOYALTY_TERM_TYPES },
        pagination: {
          current_page: page,
          last_page: Math.max(1, Math.ceil(total / limit)),
          per_page: limit,
          total,
          from: total ? offset + 1 : 0,
          to: Math.min(offset + limit, total),
        },
      });
    } catch (err: any) {
      console.error('Loyalty term list error:', err);
      error(res, 'Failed to list Loyalty terms', 500);
    }
  }

  static async termForm(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) {
        success(res, { status: 1 }, 'Success', 200, { master: { term_types: LOYALTY_TERM_TYPES } });
        return;
      }
      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, property_id, type, title, content, language, sort, status, created_at, updated_at
           from ${TERM_TABLE} where id = $1 and deleted_at is null`,
        id.toString()
      );
      if (!rows.length) { notFound(res, 'Loyalty term not found'); return; }
      success(res, rows[0], 'Success', 200, { master: { term_types: LOYALTY_TERM_TYPES } });
    } catch (err: any) {
      console.error('Loyalty term form error:', err);
      error(res, 'Failed to load Loyalty term', 500);
    }
  }

  static async termStore(req: Request, res: Response): Promise<void> {
    try {
      const { type, title, content, language, sort, status } = req.body ?? {};
      if (!type) { badRequest(res, 'The type field is required.'); return; }
      const propertyId = pid(req);
      const now = new Date();
      const rows: any[] = await prisma.$queryRawUnsafe(
        `insert into ${TERM_TABLE} (property_id, type, title, content, language, sort, status, created_at, updated_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
         returning id, property_id, type, title, content, language, sort, status, created_at, updated_at`,
        propertyId.toString(),
        String(type),
        title ?? null,
        content ?? null,
        language ?? 'id',
        Number(sort ?? 0),
        coerceStatus(status),
        now,
        req.user?.id ? String(req.user.id) : null
      );
      success(res, rows[0], 'Loyalty term created successfully.', 200);
    } catch (err: any) {
      console.error('Loyalty term store error:', err);
      error(res, 'Failed to create Loyalty term', 500);
    }
  }

  static async termUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const { type, title, content, language, sort, status } = req.body ?? {};
      const existing: any[] = await prisma.$queryRawUnsafe(
        `select id from ${TERM_TABLE} where id = $1 and deleted_at is null`,
        id.toString()
      );
      if (!existing.length) { notFound(res, 'Loyalty term not found'); return; }

      const sets: string[] = [];
      const params: (string | null)[] = [id.toString()];
      const push = (col: string, val: any) => {
        params.push(val === null || val === undefined ? null : String(val));
        sets.push(`${col} = $${params.length}`);
      };
      if (type !== undefined) push('type', type);
      if (title !== undefined) push('title', title);
      if (content !== undefined) push('content', content);
      if (language !== undefined) push('language', language);
      if (sort !== undefined) push('sort', Number(sort));
      if (status !== undefined) push('status', coerceStatus(status));
      push('updated_at', new Date());
      if (req.user?.id) push('updated_by', String(req.user.id));
      if (!sets.length) { success(res, existing[0], 'Loyalty term updated successfully.'); return; }

      const rows: any[] = await prisma.$queryRawUnsafe(
        `update ${TERM_TABLE} set ${sets.join(', ')} where id = $1
         returning id, property_id, type, title, content, language, sort, status, created_at, updated_at`,
        ...params
      );
      success(res, rows[0], 'Loyalty term updated successfully.');
    } catch (err: any) {
      console.error('Loyalty term update error:', err);
      error(res, 'Failed to update Loyalty term', 500);
    }
  }

  static async termDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) { notFound(res, 'Not found'); return; }
      const rows: any[] = await prisma.$queryRawUnsafe(
        `update ${TERM_TABLE} set deleted_at = now(), updated_at = now(), updated_by = $2
          where id = $1 and deleted_at is null returning id`,
        id.toString(),
        req.user?.id ? String(req.user.id) : null
      );
      if (!rows.length) { notFound(res, 'Loyalty term not found'); return; }
      success(res, [], 'Loyalty term deleted successfully.');
    } catch (err: any) {
      console.error('Loyalty term destroy error:', err);
      error(res, 'Failed to delete Loyalty term', 500);
    }
  }

  /**
   * GET /middleware/loyalty/properties — public.
   * MiddlewareBookingEngineController::loyaltyProperties (web.php:139): every active
   * property with its active facilities + terms, consumed by the booking engine.
   */
  static async propertiesForBookingEngine(_req: Request, res: Response): Promise<void> {
    try {
      const properties: any[] = await prisma.properties.findMany({
        // `is_booking_engine` is the per-property publication switch the property form
        // writes. `status` alone is HMS-wide, so every active property used to appear in
        // the guest portal whether or not its content was ready — an operator could not
        // take one hotel off the portal without taking it off HMS entirely.
        where: { status: 1, is_booking_engine: 1, deleted_at: null },
        include: { cities: { select: { name: true } } },
        orderBy: { id: 'asc' },
      });

      const out: any[] = [];
      for (const p of properties) {
        const pidValue = String(p.id);
        const [facilities, terms, country, banners] = await Promise.all([
          prisma.$queryRawUnsafe(
            `select facility_key, label, icon from ${FACILITY_TABLE}
              where property_id = $1 and deleted_at is null and status = 1
              order by sort asc, id asc`,
            pidValue
          ) as Promise<any[]>,
          prisma.$queryRawUnsafe(
            `select type, title, content, language from ${TERM_TABLE}
              where property_id = $1 and deleted_at is null and status = 1
              order by sort asc, id asc`,
            pidValue
          ) as Promise<any[]>,
          // `properties` has no Prisma relation to `countries` (only `cities`), so the
          // country name is resolved through country_id.
          p.country_id
            ? prisma.countries.findUnique({ where: { id: BigInt(p.country_id) }, select: { name: true } })
            : null,
          // The first active banner of the Booking Engine Setup > Banner tab becomes the
          // guest-portal hero, so editing a banner in the HMS immediately changes
          // http://localhost:3002/loyalty. properties.image is NULL on every row, so
          // without this the portal has no CMS-controlled visual at all.
          prisma.content_banners.findFirst({
            where: { property_id: p.id, status: 1, deleted_at: null, image: { not: null } },
            orderBy: { id: 'asc' },
            select: { image: true },
          }),
        ]);

        const heroImage = banners?.image ? storedImageUrl(banners.image) : storedImageUrl(p.image);

        out.push({
          id: String(p.id),
          name: p.name,
          slug: p.slug,
          // properties.logo / .image hold inline base64 data-URIs on most rows, so
          // `'/storage/' + logo` would emit a multi-hundred-KB bogus URL.
          // storedImageUrl() refuses data-URI columns (returns null) and normalises the
          // '/'-prefixed path rows, which is what the booking engine expects.
          logo: storedImageUrl(p.logo),
          image: storedImageUrl(p.image),
          hero_image: heroImage,
          address: p.address,
          city: (p as any).cities?.name ?? null,
          country: country?.name ?? null,
          latitude: p.latitude,
          longitude: p.longitude,
          whatsapp: p.whatsapp,
          telp: p.telp,
          email: p.email,
          facilities: facilities.map((f) => ({ key: f.facility_key, label: f.label, icon: f.icon })),
          terms: terms.map((t) => ({ type: t.type, title: t.title, content: t.content, language: t.language })),
        });
      }

      // The reference answers with `code` as the STRING '200' here.
      res.json(jsonSafe({ code: '200', message: 'Success', data: out }));
    } catch (err: any) {
      console.error('Loyalty properties error:', err);
      error(res, 'Failed to load loyalty properties', 500);
    }
  }
}