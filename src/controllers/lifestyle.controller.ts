import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { badRequest, error, notFound, success } from '../utils/response';
import { STATUS_OPTIONS, crudPermission, laravelPaging, listPermission } from '../utils/tableMeta';
import { storedImageUrl } from '../utils/storage';

// Laravel parity: App\Http\Controllers\Cms\Hotel\LifestyleFacilityController +
// LifestyleTermController (routes/cms.php:1432-1433, inside the `content` prefix).
// The booking engine reads both through GET /middleware/lifestyle/properties
// (MiddlewareBookingEngineController::lifestyleProperties, web.php:139), so both
// tables are read-only from the outside and written only from the HMS UI.
//
// config('cms.lifestyle_facilities') / config('cms.lifestyle_terms')
export const LIFESTYLE_FACILITY_KEYS = [
  { value: 'pool', label: 'Pool', icon: 'SwimmingPool' },
  { value: 'restaurant', label: 'Restaurant', icon: 'Utensils' },
  { value: 'wifi', label: 'Wifi', icon: 'Wifi' },
  { value: 'parking', label: 'Parking', icon: 'Parking' },
  { value: 'gym', label: 'Gym', icon: 'Dumbbell' },
  { value: 'spa', label: 'Spa', icon: 'Spa' },
  { value: 'concierge', label: 'Concierge', icon: 'ConciergeBell' },
];

export const LIFESTYLE_TERM_TYPES = [
  { value: 'terms_condition', label: 'Terms & Condition' },
  { value: 'privacy_policy', label: 'Privacy Policy' },
  { value: 'register_agreement', label: 'Register Agreement' },
  { value: 'login_agreement', label: 'Login Agreement' },
];

// The reference reaches these tables through the default `mysql` connection; in node
// they are plain Postgres tables (see sql/2026-10-03_lifestyle_tables.sql), so raw
// SQL keeps the controller working without a `prisma generate` round-trip.
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

export class LifestyleController {
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
          { label: 'Facility Key', key: 'facility_key', type: 'select', options: LIFESTYLE_FACILITY_KEYS, is_search: true },
          { label: 'Label', key: 'label', type: 'text', is_search: false },
          { label: 'Icon', key: 'icon', type: 'text', is_search: false },
          { label: 'Sort', key: 'sort', type: 'number', is_search: false },
        ],
        permission: listPermission(req, crud),
        pagging: laravelPaging(total, limit, page),
        master: { facility_keys: LIFESTYLE_FACILITY_KEYS },
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
      console.error('Lifestyle facility list error:', err);
      error(res, 'Failed to list lifestyle facilities', 500);
    }
  }

  static async facilityForm(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) {
        success(res, { status: 1 }, 'Success', 200, { master: { facility_keys: LIFESTYLE_FACILITY_KEYS } });
        return;
      }
      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, property_id, facility_key, label, icon, sort, status, created_at, updated_at
           from ${FACILITY_TABLE} where id = $1 and deleted_at is null`,
        id.toString()
      );
      if (!rows.length) { notFound(res, 'Lifestyle facility not found'); return; }
      success(res, rows[0], 'Success', 200, { master: { facility_keys: LIFESTYLE_FACILITY_KEYS } });
    } catch (err: any) {
      console.error('Lifestyle facility form error:', err);
      error(res, 'Failed to load lifestyle facility', 500);
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
      success(res, rows[0], 'Lifestyle facility created successfully.', 200);
    } catch (err: any) {
      console.error('Lifestyle facility store error:', err);
      error(res, 'Failed to create lifestyle facility', 500);
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
      if (!existing.length) { notFound(res, 'Lifestyle facility not found'); return; }

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
      if (!sets.length) { success(res, existing[0], 'Lifestyle facility updated successfully.'); return; }

      const rows: any[] = await prisma.$queryRawUnsafe(
        `update ${FACILITY_TABLE} set ${sets.join(', ')} where id = $1
         returning id, property_id, facility_key, label, icon, sort, status, created_at, updated_at`,
        ...params
      );
      success(res, rows[0], 'Lifestyle facility updated successfully.');
    } catch (err: any) {
      console.error('Lifestyle facility update error:', err);
      error(res, 'Failed to update lifestyle facility', 500);
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
      if (!rows.length) { notFound(res, 'Lifestyle facility not found'); return; }
      success(res, [], 'Lifestyle facility deleted successfully.');
    } catch (err: any) {
      console.error('Lifestyle facility destroy error:', err);
      error(res, 'Failed to delete lifestyle facility', 500);
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
          { label: 'Type', key: 'type', type: 'select', options: LIFESTYLE_TERM_TYPES, is_search: true },
          { label: 'Title', key: 'title', type: 'text', is_search: true },
          { label: 'Content', key: 'content', type: 'textarea', is_html: true, is_search: false },
          { label: 'Language', key: 'language', type: 'text', is_search: false },
          { label: 'Sort', key: 'sort', type: 'number', is_search: false },
        ],
        permission: listPermission(req, crud),
        pagging: laravelPaging(total, limit, page),
        master: { term_types: LIFESTYLE_TERM_TYPES },
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
      console.error('Lifestyle term list error:', err);
      error(res, 'Failed to list lifestyle terms', 500);
    }
  }

  static async termForm(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      if (!id) {
        success(res, { status: 1 }, 'Success', 200, { master: { term_types: LIFESTYLE_TERM_TYPES } });
        return;
      }
      const rows: any[] = await prisma.$queryRawUnsafe(
        `select id, property_id, type, title, content, language, sort, status, created_at, updated_at
           from ${TERM_TABLE} where id = $1 and deleted_at is null`,
        id.toString()
      );
      if (!rows.length) { notFound(res, 'Lifestyle term not found'); return; }
      success(res, rows[0], 'Success', 200, { master: { term_types: LIFESTYLE_TERM_TYPES } });
    } catch (err: any) {
      console.error('Lifestyle term form error:', err);
      error(res, 'Failed to load lifestyle term', 500);
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
      success(res, rows[0], 'Lifestyle term created successfully.', 200);
    } catch (err: any) {
      console.error('Lifestyle term store error:', err);
      error(res, 'Failed to create lifestyle term', 500);
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
      if (!existing.length) { notFound(res, 'Lifestyle term not found'); return; }

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
      if (!sets.length) { success(res, existing[0], 'Lifestyle term updated successfully.'); return; }

      const rows: any[] = await prisma.$queryRawUnsafe(
        `update ${TERM_TABLE} set ${sets.join(', ')} where id = $1
         returning id, property_id, type, title, content, language, sort, status, created_at, updated_at`,
        ...params
      );
      success(res, rows[0], 'Lifestyle term updated successfully.');
    } catch (err: any) {
      console.error('Lifestyle term update error:', err);
      error(res, 'Failed to update lifestyle term', 500);
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
      if (!rows.length) { notFound(res, 'Lifestyle term not found'); return; }
      success(res, [], 'Lifestyle term deleted successfully.');
    } catch (err: any) {
      console.error('Lifestyle term destroy error:', err);
      error(res, 'Failed to delete lifestyle term', 500);
    }
  }

  /**
   * GET /middleware/lifestyle/properties — public.
   * MiddlewareBookingEngineController::lifestyleProperties (web.php:139): every active
   * property with its active facilities + terms, consumed by the booking engine.
   */
  static async propertiesForBookingEngine(_req: Request, res: Response): Promise<void> {
    try {
      const properties: any[] = await prisma.properties.findMany({
        where: { status: 1, deleted_at: null },
        include: { cities: { select: { name: true } } },
        orderBy: { id: 'asc' },
      });

      const out: any[] = [];
      for (const p of properties) {
        const pidValue = String(p.id);
        const [facilities, terms, country] = await Promise.all([
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
        ]);

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
      console.error('Lifestyle properties error:', err);
      error(res, 'Failed to load lifestyle properties', 500);
    }
  }
}