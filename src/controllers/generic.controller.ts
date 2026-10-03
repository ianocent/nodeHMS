import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { STATUSES } from '../utils/cmsConfig';
import { TABLES } from '../utils/tableMeta';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { writeAudit, isUnchanged } from '../utils/audit';
import { AuthController } from './auth.controller';
import { coerceValue, fieldType, hasField, isIgnoredSearchToken, modelExists, safeOrderBy, searchPredicate } from '../utils/querySafety';
import { uniqueExtendError } from '../utils/uniqueExtend';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const genericPool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Soft-delete aware uniqueness for models handled by this generic CRUD. Laravel
 * declares it inline (ContentRoomController@store:94):
 *   'room_type_id' => 'required|exists:room_types,id|unique:content_rooms,room_type_id,NULL,id,deleted_at,NULL'
 * Left unscoped on purpose - a room type belongs to exactly one property, so a global
 * check cannot reject a legitimate row.
 */
const GENERIC_UNIQUE_RULES: Record<string, Array<{ column: string; label: string }>> = {
  // Key must match the Prisma delegate, not the singular: routes already set
  // `req.params.model = 'content_rooms'`, and toPlural() passes underscore names through
  // unchanged, so `content_room` would resolve to a non-existent delegate.
  content_rooms: [{ column: 'room_type_id', label: 'room type id' }],
};
const genericAdapter = new PrismaPg(genericPool);
const genericPrisma = new PrismaClient({ adapter: genericAdapter });

function getPrisma() {
  return genericPrisma;
}

function parseJsonField(val: any, fallback: any): any {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return val; }
}

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
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

function idParam(val: any): bigint | null {
  if (Array.isArray(val)) val = val[0];
  if (val === undefined || val === null || val === '') return null;
  const s = String(val);
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s);
}

function parseCompanyGuest(v: any): { model_type: string | null; model_id: bigint | null } {
  if (typeof v !== 'string') return { model_type: null, model_id: null };
  const m = v.match(/^(\d+)-(CompanyProfile|GuestProfile)$/);
  if (!m) return { model_type: null, model_id: null };
  return { model_type: `App\\Models\\${m[2]}`, model_id: BigInt(m[1]) };
}

function allotmentBody(data: any): any {
  const out: any = {};
  for (const k of ['start_date', 'end_date', 'description', 'status', 'release_allotment']) {
    if (k in data && data[k] !== undefined) out[k] = data[k];
  }
  if (typeof out.release_allotment === 'string') out.release_allotment = parseInt(out.release_allotment) || 0;
  if (typeof out.status === 'string') out.status = parseInt(out.status) || 0;
  const parsed = parseCompanyGuest(data.company_guest);
  if (parsed.model_type) {
    out.model_type = parsed.model_type;
    out.model_id = parsed.model_id;
  }
  return out;
}

const AUDIT_KEYS = ['id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by', 'deleted_by', 'undefined'];

// Laravel ShiftRosterController::buildAndValidateRanges (:163-209):
// max 3 ranges, per-range cap 8 jam (overnight wraps +24h), total cap 16 jam,
// index 0 selalu sinkron dengan time_start/time_end.
function validateShiftRosterRanges(body: any): string | null {
  let ranges: { start: any; end: any }[] =
    Array.isArray(body.time_ranges) && body.time_ranges.length > 0
      ? body.time_ranges.map((r: any) => ({ start: r.start, end: r.end }))
      : [{ start: body.time_start, end: body.time_end }];
  if (!ranges.length) ranges = [{ start: body.time_start, end: body.time_end }];

  // index 0 always mirrors the scalar fields
  ranges[0] = { start: body.time_start, end: body.time_end };

  if (ranges.length > 3) return 'Maksimal 3 time range per shift.';

  const toMin = (t: any): number | null => {
    const s = String(t ?? '');
    if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };

  let totalHours = 0;
  for (let i = 0; i < ranges.length; i++) {
    const sm = toMin(ranges[i].start);
    const em = toMin(ranges[i].end);
    if (sm === null || em === null) return 'Format jam harus H:i.';
    let durMinutes = em - sm;
    if (durMinutes <= 0) durMinutes += 24 * 60; // overnight shift
    const durHours = durMinutes / 60;
    if (durHours > 8) return `Range ${i + 1} tidak boleh lebih dari 8 jam.`;
    totalHours += durHours;
  }
  if (totalHours > 16) return 'Total jam kerja tidak boleh lebih dari 16 jam.';

  body.time_ranges = ranges;
  return null;
}

const TIME_ONLY_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const out: any = {};
  for (const [k, v] of Object.entries(body)) {
    if (AUDIT_KEYS.includes(k)) continue;
    if (v === undefined) continue;
    const isDate = /(date|_at)$/i.test(k);
    if (isDate) {
      if (v === '') continue;
      if (typeof v === 'object') {
        if (v instanceof Date) { out[k] = v; continue; }
        continue;
      }
      const d = new Date(v as string | number);
      if (!isNaN(d.getTime())) out[k] = d;
      continue;
    }
    // Time-only strings ("HH:MM") must become ISO-8601 DateTime for Prisma columns
    // like shift_roster.time_start/time_end/overtime_start/overtime_end.
    if (typeof v === 'string' && /time/i.test(k)) {
      if (TIME_ONLY_RE.test(v)) {
        const [h, m, s] = v.split(':');
        out[k] = new Date(Date.UTC(1970, 0, 1, Number(h), Number(m), s ? Number(s) : 0));
      } else if (v === '') {
        continue;
      } else {
        out[k] = v;
      }
      continue;
    }
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (Object.keys(v).length === 0) continue;
      if ('value' in v) {
        out[k] = v.value;
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

/**
 * Normalises a sanitised payload against the model's real scalar types.
 *
 * The client renders `status` and other 0/1 flags as checkboxes, so they arrive
 * as real booleans, and numeric inputs arrive as strings. Prisma refuses both
 * outright for an Int column ("Expected Int or Null, provided Boolean"), which
 * turned every create on such a table into a 500. Coercing here - keyed off the
 * generated DMMF rather than a hand-written per-model list - means a model is
 * correct the moment it is added, not when someone remembers to patch it.
 *
 * Only fields that actually exist on the model are touched, so relations and
 * unknown keys are left for Prisma to reject as before.
 */
function coerceToSchema(model: string, data: any): any {
  for (const key of Object.keys(data)) {
    const type = fieldType(model, key);
    if (!type) continue;
    const value = data[key];
    if (value === null || value === undefined) continue;

    switch (type) {
      case 'Int':
      case 'Float': {
        if (typeof value === 'boolean') { data[key] = value ? 1 : 0; break; }
        if (typeof value === 'string') {
          const n = Number(value);
          if (Number.isFinite(n)) data[key] = n;
        }
        break;
      }
      case 'BigInt': {
        if (typeof value === 'boolean') { data[key] = value ? 1n : 0n; break; }
        if (typeof value === 'string' && /^\d+$/.test(value.trim())) data[key] = BigInt(value.trim());
        break;
      }
      case 'Boolean': {
        if (typeof value === 'boolean') break;
        if (typeof value === 'number') { data[key] = value !== 0; break; }
        if (typeof value === 'string') {
          const s = value.trim().toLowerCase();
          if (['true', '1', 'yes', 'on'].includes(s)) data[key] = true;
          else if (['false', '0', 'no', 'off'].includes(s)) data[key] = false;
        }
        break;
      }
      case 'String': {
        // A {value,label} object is already unwrapped by sanitizeBody, but a
        // numeric id still has to become text (rate_inclusives.stock, etc).
        if (typeof value === 'number' || typeof value === 'bigint') data[key] = String(value);
        else if (typeof value === 'boolean') data[key] = value ? '1' : '0';
        break;
      }
      default:
        break;
    }
  }
  return data;
}

// Models whose rows must stay scoped to the authenticated user's property.
// Models whose tables carry property_id and are auto-scoped in Laravel
// (HasProperties global scope). Route params arrive in singular or plural
// form depending on the caller, so both spellings are matched.
const PROPERTY_SCOPED_MODELS = new Set([
  'shift_roster', 'shift_rosters', 'roster_list', 'roster_lists', 'rosters',
  'content_room', 'content_rooms', 'payment_matrix', 'payment_matrices',
  'staah_interface', 'staah_interfaces', 'staah_reservation', 'staah_reservations',
  'staah_ota_company_mapping', 'staah_ota_company_mappings', 'stop_sell', 'stop_sells',
  // operational masters (HasProperties parity sweep 2026-08-23)
  'baggage', 'baggages', 'holiday', 'holidays',
  'lost_and_found', 'lost_and_founds', 'wake_up_call', 'wake_up_calls',
  'phonebook', 'phonebooks', 'stock', 'stocks',
  'email_builder', 'email_builders', 'email_group', 'email_groups',
  'cancelation_rule', 'cancelation_rules', 'cancelation_rule_date', 'cancelation_rule_dates',
  'day_use_rate', 'day_use_rates', 'car_park', 'car_parks',
  'hotel_competitor', 'hotel_competitors', 'master_hotel_competitor', 'master_hotel_competitors',
]);

/**
 * Models that reach the property through a relation instead of a local
 * `property_id` column. `staah_reservations` is property-scoped via its
 * `staah_interfaces` row (Laravel: StaahReservationController asserts
 * `$reservation->staah_interfaces->property_id === $user->last_property`).
 * Adding a local `property_id` filter to these throws
 * `Unknown argument 'property_id'`, which surfaced as a 500 on the
 * /cms/staah-reservation list.
 */
const PROPERTY_VIA_RELATION: Record<string, string> = {
  staah_reservation: 'staah_interfaces',
  staah_reservations: 'staah_interfaces',
};

// menuId-based permission per generic model (Laravel hasCrudPermission parity).
const MODEL_MENU: Record<string, number> = {
  staah_reservations: 1184,
  staah_interfaces: 1185,
  staah_ota_company_mappings: 1186,
  rates: 109,
  yields: 1102,
  holidays: 89,
  // Laravel MessageController@index -> hasCrudPermission(63, 'add'|'edit')
  messages: 63,
};

const TIME_FIELDS = ['time_start', 'time_end', 'overtime_start', 'overtime_end'];

// DateTime -> "HH:MM" (stored as 1970-01-01T{HH:MM}Z for time-only values).
function formatTimeFields(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const out: any = { ...row };
  for (const key of TIME_FIELDS) {
    const v = row[key];
    if (v instanceof Date && !isNaN(v.getTime())) out[key] = v.toISOString().slice(11, 16);
    else if (typeof v === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) out[key] = v.slice(0, 5);
  }
  return out;
}

function formatTimeRows(data: any): any {
  if (Array.isArray(data)) return data.map(formatTimeFields);
  return formatTimeFields(data);
}

function parsePagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = Math.min(parseInt(query.limit as string) || 10, 100);
  const search = query.search as string;
  const sort = query.sort as string || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  const trash = query.trash === '1' || query.trash === 'true';
  return { page, limit, search, sort, order, trash };
}

export class GenericController {
  private getPermission(req: Request, model: string): { view: number; add: number; edit: number; delete: number } {
    const menuId = MODEL_MENU[model];
    if (!menuId) return { view: 1, add: 1, edit: 1, delete: 1 };
    return getPermissionFlags(req.user as any, menuId);
  }

  private async listTable(model: string, propertyId: bigint | null): Promise<any[] | null> {
    const plural = this.toPlural(model);
    const cfg = TABLES[model] || TABLES[plural];
    if (!cfg) return null;
    const table = cfg.map((c: any) => ({ ...c }));
    if (plural === 'yields' || plural === 'room_allotments') {
      const roomTypes = await getPrisma().room_types.findMany({
        where: { deleted_at: null, status: 1, ...(propertyId ? { property_id: propertyId } : {}) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const rtIndex = table.findIndex((t: any) => t.key === 'room_type_id');
      if (rtIndex >= 0) table[rtIndex].options = roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name }));
    }
    
    if (plural === 'hotel_competitors') {
      const mhc = await getPrisma().master_hotel_competitors.findMany({
        where: { deleted_at: null, status: 1, ...(propertyId ? { property_id: propertyId } : {}) },
        select: { id: true, name: true },
        orderBy: { sort: 'asc' },
      });
      const rtIndex = table.findIndex((t: any) => t.key === 'master_hotel_competitor_id');
      if (rtIndex >= 0) table[rtIndex].options = mhc.map((m: any) => ({ value: Number(m.id), label: m.name }));
    }
    return table;
  }

  /**
   * Last-resort column list for models with no `TABLES` entry.
   *
   * Reads the Prisma DMMF field list for the model, so it is derived from the
   * SCHEMA and is identical whether or not the query returned rows. Scalars only
   * (relations are skipped), audit/technical columns filtered out, and never an
   * empty result — `table-edit` treats a zero-column `table` as "no table".
   */
  private modelShapeTable(model: string): any[] {
    const plural = this.toPlural(model);
    const keys = this.modelFields(plural);

    const HIDE = new Set([
      'property_id', 'created_by', 'updated_by', 'deleted_by',
      'created_at', 'updated_at', 'deleted_at',
    ]);

    const table = keys
      .filter((k) => !HIDE.has(k))
      .map((key) => ({
        label: key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        key,
        type: key === 'id' || key.endsWith('_id') || key.endsWith('_by')
          ? 'none'
          : key === 'status'
          ? 'checkbox'
          : key === 'name' || key === 'code' || key === 'description'
          ? 'text'
          : 'string',
        is_search: key === 'name' || key === 'code' || key === 'description',
      }));

    if (table.length === 0) {
      // A model with no scalar fields still needs one renderable column.
      table.push({ label: 'Id', key: 'id', type: 'none', is_search: false });
    }
    table.push({ label: 'Action', key: 'action', type: 'action', is_search: false });
    return table;
  }

  /** Scalar field names for a Prisma model, read from the generated DMMF. */
  private modelFields(plural: string): string[] {
    try {
      const dmmf = (require('@prisma/client') as any)?.Prisma?.dmmf;
      const modelDef = dmmf?.datamodel?.models?.find((m: any) => m.name === plural);
      if (!modelDef) return [];
      return modelDef.fields
        .filter((f: any) => !f.isRelation)
        .map((f: any) => f.name);
    } catch {
      return [];
    }
  }

  private getPrismaModel(modelName: string): any {
    const client = getPrisma();
    const model = (client as any)[this.toPlural(modelName)];
    if (!model) throw new Error(`Model "${modelName}" not found`);
    return model;
  }

  private toPlural(name: string): string {
    // If caller already supplied a plural/DB-style name, return as-is
    // Protect against names like "payment_matrices" or "stocks" which
    // are already the Prisma delegate keys.
    if (!name) return name;
    // Snake-case singular route models whose Prisma delegates are plural
    if (name === 'hotel_competitor' || name === 'master_hotel_competitor') return name + 's';
    if (name.includes('_') || name.endsWith('s')) return name;

    const kebabOverrides: Record<string, string> = {
      'stop-sell-booking': 'stop_sells',
      'stop-sell': 'stop_sells',
      'content-room': 'content_rooms',
      'channel-manager-interface': 'channel_manager_interfaces',
      'rate-room': 'rates',
      'payment-matrix': 'payment_matrices',
      'staah-manager': 'staah_interfaces',
      'staah-reservation': 'staah_reservations',
      'staah-ota-mapping': 'staah_ota_company_mappings',
      'allotment-room': 'room_allotments',
      'room-allotment': 'room_allotments',
    };
    if (kebabOverrides[name]) return kebabOverrides[name];
    const irregular: Record<string, string> = {
      user: 'users',
      property: 'properties',
      role: 'roles',
      menu: 'menus',
      city: 'cities',
      country: 'countries',
      code_billing: 'code_billings',
      code_item: 'code_items',
      code_gl: 'code_gls',
      code_post: 'code_posts',
      type_payment: 'type_payments',
      company_profile: 'company_profiles',
      guest_profile: 'guest_profiles',
      guest_profile_preference: 'guest_profile_preferences',
      reservation: 'reservations',
      room: 'rooms',
      room_type: 'room_types',
      rate: 'rates',
      promotion: 'promotions',
      stocks: 'stocks',
      work_order_stocks: 'work_order_stocks',
      roster_list: 'roster_list',
      shift_roster: 'shift_roster',
    };
    if (Object.values(irregular).includes(name)) return name;
    return irregular[name] || (name.endsWith('y') ? name.slice(0, -1) + 'ies' : name + 's');
  }

  private parseSearchFields(modelName: string, search: string): any {
    const searchFields: Record<string, string[]> = {
      users: ['name', 'email', 'username'],
      properties: ['name', 'alias', 'email'],
      roles: ['name'],
      menus: ['name'],
      cities: ['name'],
      countries: ['name'],
      code_billings: ['name', 'code'],
      code_items: ['name', 'code'],
      code_gls: ['name', 'code'],
      code_posts: ['name', 'code'],
      type_payments: ['name', 'code'],
      company_profiles: ['name', 'email'],
      guest_profiles: ['name', 'email'],
      reservations: ['folio_number', 'guest_name'],
      rooms: ['name', 'room_number'],
      room_types: ['name', 'code'],
      rates: ['name', 'code'],
      promotions: ['name', 'code'],
    };
    return searchFields[modelName] || ['name'];
  }

  private softDeleteCache = new Map<string, boolean>();

  private async modelHasSoftDelete(model: string): Promise<boolean> {
    if (this.softDeleteCache.has(model)) return this.softDeleteCache.get(model)!;
    let has = true;
    try {
      // Resolve through toPlural: the route model is often singular ('menu')
      // while the Prisma delegate is plural ('menus'). Indexing the delegate
      // with the raw route name would throw a TypeError and silently report
      // "no soft delete" for every singular-named model.
      const delegate = (getPrisma() as any)[this.toPlural(model)];
      if (!delegate) { has = false; }
      else {
        await delegate.findFirst({ where: { deleted_at: null } });
      }
    } catch {
      has = false;
    }
    this.softDeleteCache.set(model, has);
    return has;
  }

  async list(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      console.log('Generic list request for model:', model);
      const { page, limit, search, sort, order, trash } = parsePagination(req.query);
      const modelDelegate = this.getPrismaModel(model);
      console.log('Model delegate:', modelDelegate ? 'found' : 'NOT FOUND');
      const prismaModel = this.toPlural(model);
      const searchFields = this.parseSearchFields(model, search || '');
      const hasSoftDelete = await this.modelHasSoftDelete(model);

      const where: any = trash
        ? (hasSoftDelete ? { deleted_at: { not: null } } : {})
        : (hasSoftDelete ? { deleted_at: null } : {});
      for (const [k, v] of Object.entries(req.query)) {
        if (['page', 'limit', 'search', 'sort', 'order', 'trash'].includes(k)) continue;
        if (!k.endsWith('_id') || isIgnoredSearchToken(v)) continue;
        // Laravel never forwards a request param straight into where(); only
        // columns that exist on the model may be filtered this way.
        const columnType = modelExists(prismaModel) ? fieldType(prismaModel, k) : undefined;
        if (!columnType) continue;
        const coerced = coerceValue(columnType, v);
        if (coerced === undefined) continue;
        where[k] = coerced;
      };
      const pluralForm = this.toPlural(model);
      const viaRelation = PROPERTY_VIA_RELATION[model] || PROPERTY_VIA_RELATION[pluralForm];
      if (viaRelation) {
        if (!where[viaRelation] && req.user?.lastProperty) {
          where[viaRelation] = { property_id: BigInt(req.user.lastProperty) };
        }
      } else if (
        (PROPERTY_SCOPED_MODELS.has(model) || PROPERTY_SCOPED_MODELS.has(pluralForm))
        && !where.property_id && req.user?.lastProperty
      ) {
        where.property_id = BigInt(req.user.lastProperty);
      }
      if (req.query.group && String(req.query.group)) {
        try {
          await modelDelegate.findFirst({ where: { group: String(req.query.group) }, select: { id: true } });
          where.group = String(req.query.group);
        } catch { /* model has no group column */ }
      }
      if (search && searchFields.length > 0) {
        const predicates = searchFields
          .map((f: string) => searchPredicate(prismaModel, f, search))
          .filter(Boolean);
        if (predicates.length) where.OR = predicates;
      }

      const orderBy: any = safeOrderBy(
        prismaModel,
        sort,
        hasField(prismaModel, 'id') ? { id: order === 'desc' ? 'desc' : 'asc' } : undefined
      );

      const [data, total] = await Promise.all([
        modelDelegate.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          ...(model === 'yield' || model === 'yields' || model === 'room_allotment' || model === 'room_allotments' ? { include: { room_types: { select: { id: true, name: true } } } } : {}),
          ...(model === 'hotel_competitor' || model === 'hotel_competitors' ? { include: { master_hotel_competitors: { select: { id: true, name: true } } } } : {})
        }),
        modelDelegate.count({ where }),
      ]);
      
      let outData = data;
      if (model === 'yield' || model === 'yields' || model === 'room_allotment' || model === 'room_allotments') {
        outData = outData.map((d: any) => ({
          ...d,
          room_type_id: d.room_types ? { value: Number(d.room_types.id), label: d.room_types.name } : d.room_type_id
        }));
      }
      if (model === 'hotel_competitor' || model === 'hotel_competitors') {
        outData = outData.map((d: any) => ({
          ...d,
          master_hotel_competitor_id: d.master_hotel_competitors ? { value: Number(d.master_hotel_competitors.id), label: d.master_hotel_competitors.name } : d.master_hotel_competitor_id
        }));
      }

      // Column definitions must be static. Deriving them from the first returned
      // record (the old `Object.keys(data[0] || {})`) meant an EMPTY result set
      // produced zero columns, so table-edit rendered a header-less table and the
      // in-table add row had no inputs at all — the symptom hit by the concierge
      // phone-book pages. Fall back to the Prisma model shape instead, which is
      // populated by the schema rather than by the data.
      let table = await this.listTable(model, req.user?.lastProperty ?? null);
      if (!table || table.length === 0) {
        table = this.modelShapeTable(model);
      }
      const permission = this.getPermission(req, model);

      success(res, formatTimeRows(bigintToNumber(outData)), 'Success', 200, {
        table,
        permission,
        search_data: [],
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      if (err.message.includes('not found')) notFound(res, err.message);
      else { console.error('Generic list error:', err.message, err.stack); error(res, 'Failed to list', 500); }
    }
  }

  async show(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const modelDelegate = this.getPrismaModel(model);
      const id = idParam(String(req.params.id));
      if (id === null) { notFound(res, 'Record not found'); return; }
      const record = await modelDelegate.findUnique({ where: { id } });
      if (!record) { notFound(res, 'Record not found'); return; }
      const permission = this.getPermission(req, model);
      success(res, formatTimeRows(bigintToNumber(record)), 'Success', 200, { table: [], search_data: [], permission });
    } catch (err: any) {
      if (err.message.includes('not found')) notFound(res, err.message);
      else { console.error('Generic show error:', err); error(res, 'Failed to load', 500); }
    }
  }

  // Laravel AllotmentController@getGuestAndCompany parity
  async getGuestAndCompany(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 5;
      const search = req.query.search ? String(req.query.search) : '';
      const prisma = getPrisma();
      const companyWhere: any = { deleted_at: null, status: 1 };
      if (search) companyWhere.name = { contains: search, mode: 'insensitive' };
      const guestWhere: any = { deleted_at: null, status: 1 };
      if (search) {
        guestWhere.OR = [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [companies, guests] = await Promise.all([
        prisma.company_profiles.findMany({ where: companyWhere, skip: (page - 1) * limit, take: limit, orderBy: { id: 'asc' } }),
        prisma.guest_profiles.findMany({ where: guestWhere, skip: (page - 1) * limit, take: limit, orderBy: { id: 'asc' } }),
      ]);

      const companyRows = companies.map((c: any) => ({ id: `${Number(c.id)}-CompanyProfile`, name: `${c.name}(Company Profile)` }));
      const guestRows = guests.map((g: any) => ({ id: `${Number(g.id)}-GuestProfile`, name: `${g.first_name}(Guest Profile)` }));
      const merge = [...companyRows, ...guestRows];

      success(res, merge, 'Success', 200, {
        table: [
          { label: 'Name', key: 'name', type: 'none', is_search: false },
        ],
        search_data: [],
        pagination: { current_page: page, last_page: Math.max(1, Math.ceil(merge.length / limit)), per_page: limit, total: merge.length, from: merge.length ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, merge.length) },
      });
    } catch (err: any) {
      console.error('Generic get guest and company error:', err);
      error(res, 'Failed to load data', 500);
    }
  }

  private async buildMaster(model: string, propertyId: bigint | null): Promise<{ [key: string]: any }> {
    const prisma = getPrisma();
    const base: { [key: string]: any } = { statuses: STATUSES };
    try {
      if (model === 'overbooking') {
        const roomTypes = await prisma.room_types.findMany({
          where: { deleted_at: null, status: 1, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        base.room_types = roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name }));
      } else if (model === 'allotment') {
        const companies = await prisma.company_profiles.findMany({
          where: { deleted_at: null, status: 1, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        base.company_guest = companies.map((c: any) => ({ value: `${Number(c.id)}-CompanyProfile`, label: c.name }));
      } else if (model === 'hotel_competitor') {
        const masterHotelCompetitors = await prisma.master_hotel_competitors.findMany({
          where: { deleted_at: null, status: 1, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        base.master_hotel_competitor_id = masterHotelCompetitors.map((m: any) => ({ value: Number(m.id), label: m.name }));
      } else if (model === 'menu' || model === 'menus') {
        // Laravel Basic\MenuController@create -> master.menus + master.statuses
        const menus = await prisma.menus.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        base.menus = menus.map((m: any) => ({ value: Number(m.id), label: m.name }));
      }
      return base;
    } catch (err: any) {
      console.error('Generic buildMaster error for model:', model, err);
      return base;
    }
  }

  /**
   * GET /overbooking — date × room-type matrix.
   *
   * The reference (OverbookingController@index) does not return a flat list. It
   * builds a grid: one row per day between start_date and end_date, one column
   * per selected room type, and the cell value is that day's `overbooking`
   * count. The generic list handler returned raw rows instead, so the screen
   * showed the wrong shape entirely.
   *
   * Room types arrive either as `room_type_<id>=1` keys (what Laravel's
   * `srcstr('room_type_')` reads) or as a comma list in `room_type`.
   */
  async overbookingList(req: Request, res: Response): Promise<void> {
    try {
      const prisma = getPrisma();
      const propertyId = req.user?.lastProperty ? BigInt(req.user.lastProperty) : null;
      const businessDate = await AuthController.getBusinessDate(propertyId);
      const today = businessDate || new Date().toISOString().slice(0, 10);

      const startRaw = String(req.query.start_date ?? '').trim();
      const endRaw = String(req.query.end_date ?? '').trim();
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? startRaw : today;
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endRaw)
        ? endRaw
        : new Date(new Date(startDate + 'T00:00:00Z').getTime() + 7 * 86400000)
            .toISOString()
            .slice(0, 10);

      // `room_type_<id>=1` is the Laravel contract; `room_type=1,2,3` is what the
      // node form actually sends, so accept both.
      const roomTypeIds = new Set<bigint>();
      for (const [key, value] of Object.entries(req.query)) {
        const m = /^room_type_(\d+)$/.exec(key);
        if (!m) continue;
        const truthy = value === '' || value === '1' || value === 'true';
        if (truthy) roomTypeIds.add(BigInt(m[1]));
      }
      const csv = String(req.query.room_type ?? '').trim();
      if (csv) {
        for (const part of csv.split(',')) {
          const t = part.trim();
          if (/^\d+$/.test(t)) roomTypeIds.add(BigInt(t));
        }
      }
      if (roomTypeIds.size === 0) {
        // No selection: fall back to every active room type so the grid is not
        // blank the moment the page opens.
        const all = await prisma.room_types.findMany({
          where: { deleted_at: null, status: 1, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        all.forEach((rt: any) => roomTypeIds.add(BigInt(rt.id)));
      }

      const [roomTypes, rows] = await Promise.all([
        prisma.room_types.findMany({
          where: { id: { in: [...roomTypeIds] }, deleted_at: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.overbookings.findMany({
          where: {
            deleted_at: null,
            ...(propertyId ? { property_id: propertyId } : {}),
            room_type_id: { in: [...roomTypeIds] },
            date: {
              gte: new Date(startDate + 'T00:00:00Z'),
              lte: new Date(endDate + 'T23:59:59.999Z'),
            },
          },
          select: { date: true, room_type_id: true, overbooking: true },
        }),
      ]);

      const table: any[] = [
        { label: 'Date', key: 'date', type: 'date', is_search: false },
        ...roomTypes.map((rt: any) => ({
          label: String(rt.name).replace(/\b\w/g, (c: string) => c.toUpperCase()),
          key: String(rt.id),
          type: 'number',
          is_search: false,
        })),
      ];

      // date string -> room_type_id -> value
      const grid = new Map<string, Record<string, number>>();
      for (const r of rows) {
        const d = new Date(r.date as any).toISOString().slice(0, 10);
        if (!grid.has(d)) grid.set(d, {});
        grid.get(d)![String(r.room_type_id)] = Number(r.overbooking ?? 0);
      }

      const data: any[] = [];
      for (let t = Date.parse(startDate + 'T00:00:00Z'); t <= Date.parse(endDate + 'T00:00:00Z'); t += 86400000) {
        const d = new Date(t).toISOString().slice(0, 10);
        const row: any = { date: d };
        for (const rt of roomTypes) row[String(rt.id)] = grid.get(d)?.[String(rt.id)] ?? 0;
        data.push(row);
      }

      success(res, data, 'Success', 200, {
        table,
        search_data: [],
        permission: this.getPermission(req, 'overbooking'),
        pagination: {
          current_page: 1,
          per_page: data.length,
          total: data.length,
          from: data.length ? 1 : 0,
          to: data.length,
          last_page: 1,
        },
      });
    } catch (err: any) {
      console.error('Overbooking list error:', err);
      error(res, 'Failed to load overbooking', 500);
    }
  }

  async createForm(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const permission = this.getPermission(req, model);
      const master = await this.buildMaster(model, req.user?.lastProperty ?? null);
      const extra: any = { table: [], master, search_data: [], permission };
      const data: any = { status: 1 };
      if (model === 'overbooking') {
        // Must live inside `data` — success() only copies whitelisted keys out
        // of `meta`, so anything else passed there is silently dropped and the
        // search form ended up with no start/end date.
        data.business_date = await AuthController.getBusinessDate(req.user?.lastProperty ?? null);
      }
      success(res, data, 'Success', 200, extra);
    } catch (err: any) {
      error(res, 'Failed to load form data', 500);
    }
  }

  async editForm(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const modelDelegate = this.getPrismaModel(model);
      const id = idParam(String(req.params.id));
      if (id === null) { notFound(res, 'Record not found'); return; }
      const record = await modelDelegate.findUnique({ where: { id } });
      if (!record) { notFound(res, 'Record not found'); return; }
      const permission = this.getPermission(req, model);
      const master = await this.buildMaster(model, req.user?.lastProperty ?? null);
      let out = record;
      if (model === 'allotment') {
        // Laravel Allotment global field parity: company_guest "id-ModelName", name, profiles
        let name: string | null = null;
        if (record.model_type && record.model_id) {
          const cls = String(record.model_type).split('\\').pop();
          const table = cls === 'CompanyProfile' ? 'company_profiles' : cls === 'GuestProfile' ? 'guest_profiles' : null;
          if (table) {
            const target: any = await (getPrisma() as any)[table].findUnique({ where: { id: record.model_id } });
            if (target) name = cls === 'CompanyProfile' ? target.name : `${target.first_name} ${target.last_name ?? ''}`.trim();
          }
        }
        out = {
          ...record,
          company_guest: record.model_id ? `${Number(record.model_id)}-${String(record.model_type).includes('GuestProfile') ? 'GuestProfile' : 'CompanyProfile'}` : null,
          name,
          profiles: [],
        };
      }
      
      out = bigintToNumber(out);
      const plural = model.endsWith('y') ? model.slice(0, -1) + 'ies' : model + 's';
      const cfg = (TABLES as any)[model] || (TABLES as any)[plural];
      if (cfg) {
        for (const col of cfg) {
          if ((col.type === 'select' || col.type === 'checkbox') && col.key) {
            const key = col.key;
            if (out[key] !== null && out[key] !== undefined && typeof out[key] !== 'object') {
              let label = String(out[key]);
              if (col.options && Array.isArray(col.options)) {
                const opt = col.options.find((o: any) => String(o.value) === String(out[key]));
                if (opt) label = opt.label;
              } else if (master[key] && Array.isArray(master[key])) {
                const opt = master[key].find((o: any) => String(o.value) === String(out[key]));
                if (opt) label = opt.label;
              } else if (col.type === 'checkbox') {
                 label = out[key] ? 'Yes' : 'No';
              }
              out[key] = { value: out[key], label };
            }
          }
        }
      }
      
      success(res, formatTimeRows(out), 'Success', 200, { table: [], master, search_data: [], permission });
    } catch (err: any) {
      if (err.message.includes('not found')) notFound(res, err.message);
      else { console.error('Generic edit form error:', err); error(res, 'Failed to load', 500); }
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const modelDelegate = this.getPrismaModel(model);

      for (const rule of GENERIC_UNIQUE_RULES[model] ?? []) {
        const msg = await uniqueExtendError(
          getPrisma(),
          this.toPlural(model),
          rule.column,
          rule.label,
          (req.body as any)?.[rule.column]
        );
        if (msg) { badRequest(res, msg); return; }
      }

      // Laravel ShiftRosterController@store validation parity
      if (model === 'shift_roster') {
        if (!req.body.name || !req.body.time_start || !req.body.time_end) {
          badRequest(res, 'name, time_start and time_end are required');
          return;
        }
        const rangeError = validateShiftRosterRanges(req.body);
        if (rangeError) { badRequest(res, rangeError); return; }
      }

      const data = model === 'allotment' ? allotmentBody(sanitizeBody(req.body)) : sanitizeBody(req.body);
      if (!data.property_id && req.user?.lastProperty) data.property_id = BigInt(req.user.lastProperty);
      // The DMMF is keyed by the Prisma model name (`yields`), while routes set
      // `req.params.model` to the singular route segment (`yield`), so the schema
      // lookups have to go through toPlural() like the delegate lookup does.
      const dmmfModel = this.toPlural(model);
      coerceToSchema(dmmfModel, data);
      // Not every table carries the audit stamps - `yields` has neither column, so
      // stamping them unconditionally made Prisma reject the whole insert with
      // "Unknown argument" and every Yield Management create 500'd.
      if (hasField(dmmfModel, 'created_at')) data.created_at = new Date();
      if (hasField(dmmfModel, 'updated_at')) data.updated_at = new Date();
      let record;
      try {
        record = await modelDelegate.create({ data });
      } catch (e: any) {
        // `yields` (Yield Management) declares property_id as required, but the
        // retry below used to strip it on any error mentioning the column, turning
        // a type error into "Argument property_id is missing". Only models that
        // genuinely have no property_id column may drop it.
        if (e?.message?.includes('property_id') && !hasField(dmmfModel, 'property_id')) {
          delete data.property_id;
          record = await modelDelegate.create({ data });
        } else {
          throw e;
        }
      }
      const permission = this.getPermission(req, model);
      await writeAudit(getPrisma(), req, {
        table: this.toPlural(model),
        event: 'created',
        subjectId: (record as any)?.id,
        attributes: record,
      });
      success(res, bigintToNumber(record), 'Created', 200, { table: [], search_data: [], permission });
    } catch (err: any) {
      console.error('Generic create error:', err);
      if (err.code === 'P2002') badRequest(res, 'Duplicate entry');
      else error(res, 'Failed to create', 500);
    }
  }

async update(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const id = String(req.params.id);
      const modelDelegate = this.getPrismaModel(model);
      const parsedId = idParam(String(id));
      if (parsedId === null) { notFound(res, 'Record not found'); return; }
      const existing = await modelDelegate.findUnique({ where: { id: parsedId } });
      if (!existing) { notFound(res, 'Record not found'); return; }

      // Laravel ShiftRosterController@update validation parity
      if (model === 'shift_roster') {
        if (!req.body.name || !req.body.time_start || !req.body.time_end) {
          badRequest(res, 'name, time_start and time_end are required');
          return;
        }
        const rangeError = validateShiftRosterRanges(req.body);
        if (rangeError) { badRequest(res, rangeError); return; }
      }

      const data = model === 'allotment' ? allotmentBody(sanitizeBody(req.body)) : sanitizeBody(req.body);
      const dmmfModel = this.toPlural(model);
      coerceToSchema(dmmfModel, data);
      if (hasField(dmmfModel, 'updated_at')) data.updated_at = new Date();
      const record = await modelDelegate.update({ where: { id: parsedId }, data });
      await writeAudit(getPrisma(), req, {
        table: this.toPlural(model),
        event: 'updated',
        subjectId: parsedId,
        attributes: record,
        old: existing,
        // Laravel `logOnlyDirty()`: a save that changed nothing is not logged.
        unchanged: isUnchanged(existing, record),
      });
      success(res, bigintToNumber(record), 'Updated');
    } catch (err: any) {
      console.error('Generic update error:', err);
      if (err.code === 'P2025') notFound(res, 'Record not found');
      else error(res, 'Failed to update', 500);
    }
  }

  async destroy(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const id = String(req.params.id);
      const modelDelegate = this.getPrismaModel(model);
      const parsedId = idParam(String(id));
      if (parsedId === null) { notFound(res, 'Record not found'); return; }
      const existing = await modelDelegate.findUnique({ where: { id: parsedId } });
      if (!existing) { notFound(res, 'Record not found'); return; }
      if (await this.modelHasSoftDelete(model)) {
        await modelDelegate.update({ where: { id: parsedId }, data: { deleted_at: new Date() } });
      } else {
        await modelDelegate.delete({ where: { id: parsedId } });
      }
      await writeAudit(getPrisma(), req, {
        table: this.toPlural(model),
        event: 'deleted',
        subjectId: parsedId,
        attributes: existing,
        old: existing,
      });
      success(res, null, 'Deleted');
    } catch (err: any) {
      console.error('Generic destroy error:', err);
      if (err.code === 'P2025') notFound(res, 'Record not found');
      else error(res, 'Failed to delete', 500);
    }
  }

  async restore(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const id = String(req.params.id);
      const modelDelegate = this.getPrismaModel(model);
      const parsedId = idParam(String(id));
      if (parsedId === null) { notFound(res, 'Record not found'); return; }
      if (!(await this.modelHasSoftDelete(model))) { badRequest(res, 'Model has no soft delete'); return; }
      const existing = await modelDelegate.findUnique({ where: { id: parsedId } });
      if (!existing) { notFound(res, 'Record not found'); return; }
      await modelDelegate.update({ where: { id: parsedId }, data: { deleted_at: null } });
      await writeAudit(getPrisma(), req, {
        table: this.toPlural(model),
        event: 'restored',
        subjectId: parsedId,
        attributes: existing,
        old: existing,
      });
      success(res, null, 'Restored');
    } catch (err: any) {
      console.error('Generic restore error:', err);
      if (err.code === 'P2025') notFound(res, 'Record not found');
      else error(res, 'Failed to restore', 500);
    }
  }
}

export const genericController = new GenericController();

