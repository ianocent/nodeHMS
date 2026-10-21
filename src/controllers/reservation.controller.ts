import { prisma } from '../config/prisma';
// @ts-ignore
import { Prisma } from '@prisma/client';
// @ts-ignore
import { Request, Response } from 'express';
import { enqueueJob } from '../config/queue';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { writeAudit } from '../utils/audit';
import { calculateCodePost, moneyFormat } from '../utils/cmsConfig';
import { getColorMaid, getColorRoom, MAID_STATUSES, ROOM_STATUSES, STATUS_RESERVATION_MAP } from '../utils/cmsStatus';
import { mandatoryCheckInBlock, readPropertyMandatory } from '../utils/guestMandatory';
import { pushCondition, searchPredicate } from '../utils/querySafety';
import { applyPromoDiscounts, findPromosForNight, priceNight, PromoLike } from '../utils/reservationPricing';
import { badRequest, error, notFound, success, validationError } from '../utils/response';
import { availableRoom } from '../utils/roomAvailability';
import { applySearchField, dataSearch } from '../utils/search';
import { AuthController } from './auth.controller';
import {
  folioBalanceMinorUnits,
  isFolioSettledMinorPublic,
  performChangeStayDate,
  performCheckIn,
  performCheckOut,
  performReverseStay,
} from './front-desk.controller';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}


// Status reservation constants (matching Laravel config/cms.php)
const STATUS_RESERVATION = {
  check_in: { id: 0, code: 'check_in', name: 'Check In' },
  check_out: { id: 1, code: 'check_out', name: 'Check Out' },
  cancel_reservation: { id: 2, code: 'cancel_reservation', name: 'Cancelled' },
  reservation: { id: 3, code: 'reservation', name: 'Reservation' },
  in_house: { id: 4, code: 'in_house', name: 'In House' },
  pending: { id: 5, code: 'pending', name: 'Pending' },
};

// Type reservation constants (matching Laravel config/cms.php type_reservation)
const TYPE_RESERVATION = {
  fit: { code: 'fit', name: 'FIT' },
  git: { code: 'git', name: 'GIT' },
  vr: { code: 'vr', name: 'VR' },
  'day-use': { code: 'day-use', name: 'Day Use' },
};

// Matches Laravel getColorReservation() + Folio formatData status_reservation_color
const COLOR_RESERVATION: Record<number, string> = {
  0: 'bg-green',
  1: 'bg-purple',
  2: 'bg-red',
  3: 'bg-cyan',
  4: 'bg-blue',
  5: 'bg-yellow',
};

function statusReservationLabel(status: number): string {
  const found = Object.values(STATUS_RESERVATION).find((s: any) => s.id === status);
  return (found ? found.name : String(status)).replace(/ /g, '-');
}

const STATUS_ACTIVE = 1;
const MENU_ID = 60; // Reservation menu ID

// Reservation action icons (matching Laravel config/cms.php action_reservation.action)
const ACTION_RESERVATION: { key: string; name: string; icon: string; line?: boolean }[] = [
  { key: 'fit', name: 'New FIT', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'git', name: 'New GIT', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'vr', name: 'New VR', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'edit', name: 'Edit', icon: '/theme/cms/images/reservation/icon/Edit_Reservation.svg', line: true },
  { key: 'assign_room', name: 'Assign Room', icon: '/theme/cms/images/reservation/icon/Asign_room.svg' },
  { key: 'un_assign_room', name: 'Un Assign Room', icon: '/theme/cms/images/reservation/icon/Asign_room.svg' },
  { key: 'confirm_change_room', name: 'Confirm Change Room', icon: '/theme/cms/images/reservation/icon/Confirm_Reservation.svg' },
  { key: 'cancel_change_room', name: 'Cancel Change Room', icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg', line: true },
  { key: 'check_in', name: 'Check In', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'un_check_in', name: 'Un Check In', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'cancel_reservation', name: 'Cancel Reservation', icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg' },
  { key: 'un_cancel_reservation', name: 'Un Cancel Reservation', icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg' },
  { key: 'check_out', name: 'Check Out', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'un_check_out', name: 'Re-Check In', icon: '/theme/cms/images/reservation/icon/Checkout.svg', line: true },
  { key: 'copy_reservation', name: 'Copy Reservation', icon: '/theme/cms/images/reservation/icon/Add_Message.svg', line: true },
  { key: 'move_reservation', name: 'Move Reservation', icon: '/theme/cms/images/reservation/icon/Checkin.svg', line: true },
  { key: 'confirm_reservation', name: 'Confirm Reservation', icon: '/theme/cms/images/reservation/icon/Add_Message.svg', line: true },
  { key: 'add_message', name: 'Add Message', icon: '/theme/cms/images/reservation/icon/Add_Message.svg' },
  { key: 'view_message', name: 'View Message', icon: '/theme/cms/images/reservation/icon/View_Message.svg' },
  { key: 'add_remark', name: 'Add Remark', icon: '/theme/cms/images/reservation/icon/Add_Message.svg' },
  { key: 'view_remark', name: 'View Remark', icon: '/theme/cms/images/reservation/icon/View_Message.svg' },
  { key: 'new_key', name: 'New Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'duplicate_key', name: 'Duplicate Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'erase_key', name: 'Erase Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'check_out_view', name: 'Check Out View', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'confirmation_letter', name: 'Send Email Confirmation Letter', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'guest_invoice_all_billing', name: 'Send Email Guest Invoice All Billing', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'guest_invoice_ledger', name: 'Send Email Guest Invoice Ledger', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
];

// Rule map per status code (matching Laravel config/cms.php action_reservation.rule)
const ACTION_RULE: Record<string, string[]> = {
  reservation: ['fit', 'git', 'vr', 'edit', 'move_reservation', 'assign_room', 'un_assign_room', 'confirm_change_room', 'cancel_change_room', 'check_in', 'check_out_view', 'cancel_reservation', 'copy_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark', 'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger'],
  check_in: ['fit', 'git', 'vr', 'edit', 'confirm_change_room', 'cancel_change_room', 'check_in', 'un_check_in', 'check_out', 'check_out_view', 'copy_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark', 'new_key', 'duplicate_key', 'erase_key', 'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger'],
  check_out: ['fit', 'git', 'vr', 'edit', 'un_check_out', 'check_out_view', 'copy_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark', 'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger'],
  cancel_reservation: ['fit', 'git', 'vr', 'edit', 'copy_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark'],
  default: ['fit', 'git', 'vr', 'edit', 'move_reservation', 'assign_room', 'un_assign_room', 'confirm_change_room', 'cancel_change_room', 'check_in', 'un_check_in', 'cancel_reservation', 'check_out_view', 'copy_reservation', 'confirm_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark', 'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger'],
};

function fmtLocalDate(d: any): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d).substring(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
    return out;
  }
  return val;
}

function reservationBn(val: any): any {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(reservationBn);
  // Prisma.Decimal columns (amount / total / service_charge / pb1 / tax3 and the
  // extra-bed set) used to fall through to the generic object branch and come out
  // as the Decimal.js internals: `{"s":1,"e":5,"d":[650000]}`. The Room grid then
  // posted that object back as `total`, Number() of it is NaN, and every save of
  // a night carried NaN into prisma.update() - which aborts the whole write with
  // PrismaClientValidationError. This is why changing the Rate Code only failed
  // "sometimes": it broke whenever the grid value was posted back without the
  // price being re-fetched first. Mirrors normalizeJson()/bigintToNumber().
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') {
    return Number((val as any).toNumber());
  }
  if (val && typeof val === 'object') { const o: any = {}; for (const [k, v] of Object.entries(val)) o[k] = reservationBn(v); return o; }
  return val;
}

//  Helper-endpoint parity helpers (Laravel ReservationController) 
function fmtDateOnly(d: any): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().substring(0, 10);
  return String(d).substring(0, 10);
}

/**
 * Money coming from the grids is a formatted string ("537.190,08" de-DE) or a
 * plain number. `Number()` alone turns both of those into NaN, and a single NaN
 * reaching prisma.update() aborts the ENTIRE save with a PrismaClientValidationError
 * that reads like an unrelated "Unknown argument" error. Always returns a finite number.
 */
function toFiniteMoney(v: any, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v && typeof v === 'object') {
    if (typeof v.toNumber === 'function') { const n = Number(v.toNumber()); return Number.isFinite(n) ? n : fallback; }
    return fallback; // a stray serialised object is not a price
  }
  let s = String(v ?? '').trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'nan') return fallback;
  // de-DE: "1.234.567,50"  ->  1234567.5   |   en-US: "1,234,567.50" -> 1234567.5
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function dataSearchLocal(req: Request, table: any[]): Record<string, any> {
  const meta: Record<string, any> = {};
  const fields = String(req.query.search_field || '').split(';').filter((f: string) => f.trim() !== '');
  const values = String(req.query.search_value || '').split(';').filter((v: string) => v.trim() !== '');
  fields.forEach((field: string, i: number) => {
    const col = table.find((c: any) => c.key === field);
    const raw = values[i] ?? '';
    meta[field] =
      col && ['select', 'checkbox', 'select_multiple'].includes(col.type)
        ? { label: col.options?.find((o: any) => String(o.value) === String(raw))?.label ?? null, value: raw }
        : String(raw);
  });
  for (const [k, v] of Object.entries(req.query)) {
    if (['search_field', 'search_value', 'page', 'limit', 'search', 'sort', 'group'].includes(k)) continue;
    meta[k] = String(v);
  }
  return meta;
}

function paggingMetaLocal(total: number, limit: number, page: number) {
  const lastPage = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  return {
    current_page: page,
    last_page: lastPage,
    per_page: limit,
    total,
    from,
    to: Math.min(total, page * limit),
  };
}

// eta/etd arrive as "HH:MM" strings (FE) or Date-parseable values; the column is
// DateTime — combine a bare time with the night date so it stays on that day.
function parseTimeLike(value: any, base: Date): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = String(value).trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const d = new Date(base);
    d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0);
    return d;
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Checkbox groups arrive from the FE as `[{ name, value }]` arrays (the same
// shape as checkbokmulti), so the old `=== true || Number(x) === 1` test never
// matched and is_24_hour was persisted as 0 for every reservation.
function flagToInt(value: any): number {
  if (value === true || value === 1 || value === '1') return 1;
  if (Array.isArray(value)) return value.some((v: any) => v && (v.value === true || v.value === 1 || v.value === '1')) ? 1 : 0;
  if (value && typeof value === 'object') return value.value === true || value.value === 1 || value.value === '1' ? 1 : 0;
  return 0;
}

function dayKeyF(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

// Numeric columns (adult/child/add_bed/quantity/night) arrive from the FE as
// strings because every input posts text/plain. Prisma rejects a String for an
// Int field outright, so coerce at the boundary — and treat "" / null / NaN as
// "not supplied" so the column default applies instead of persisting 0 for a
// field the user never touched.
function intOr(value: any, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// Market segment / source are attached to a company through model_has_types,
// not as columns (PHP: `$company->type->where('group', 'market-segment-1')`).
// Picking a company therefore already determines them — the reservation must
// not force the user to re-enter them on the reservation form.
// Laravel ReservationController@store:619-660 — when `company_profile_id` is absent and
// the booking is flagged walk-in (or house-use), the company is resolved server-side from
// the company's `company-type` tag instead of being demanded from the form:
//
//   CompanyProfile::with('type')->getWalkIn()->first()   // type group 'company-type', name LIKE '%Walk In%'
//   CompanyProfile::with('type')->getHouseUse()->first() // ... LIKE '%House Use%'
//
// Three things the naive port got wrong:
//   - it filtered `company_profiles.type_company` by the literal 'Walk In', but that
//     column stores a types.id (3085 = "Corporate"), so it never matched and
//     `master.is_walk_in` came back null;
//   - the tag names are not consistently cased in this dataset ("Walk In" / "WALK IN",
//     "House use" / "HOUSE USE") and Postgres LIKE is case-sensitive;
//   - it took the first matching *link*, but some linked company ids no longer exist.
//     Laravel's `->first()` orders by the company itself, so resolve to the first ACTIVE
//     company in id order instead.
async function resolveSpecialCompanyProfile(
  kind: 'walk-in' | 'house-use'
): Promise<{
  id: bigint;
  name: string | null;
  /** `{ value: <types.id>, label: <types.name> }` or null, read from model_has_types. */
  market_segment_1: { value: number; label: string } | null;
  market_segment_2: { value: number; label: string } | null;
  market_segment_3: { value: number; label: string } | null;
  market_segment_4: { value: number; label: string } | null;
  source: { value: number; label: string } | null;
} | null> {
  const nameFragment = kind === 'walk-in' ? 'walk in' : 'house use';
  const links = await prisma.model_has_types.findMany({
    where: {
      model_type: 'App\\Models\\CompanyProfile',
      types: { group: 'company-type', name: { contains: nameFragment, mode: 'insensitive' } },
    },
    select: { model_id: true },
  });
  if (links.length === 0) return null;
  const company = await prisma.company_profiles.findFirst({
    where: {
      id: { in: links.map((l: any) => l.model_id) },
      deleted_at: null,
      status: STATUS_ACTIVE,
    },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  if (!company) return null;

  // Market segments and source live in `model_has_types`, NOT in the
  // `sync_mkt_segment_*` / `source` columns. Those columns are OTA sync
  // strings and are empty on every walk-in row, which is why the FIT form
  // arrived with blank market segments and could not store them.
  const typeLinks = await prisma.model_has_types.findMany({
    where: {
      model_type: 'App\\Models\\CompanyProfile',
      model_id: company.id,
      types: {
        deleted_at: null,
        group: {
          in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source'],
        },
      },
    },
    select: { types: { select: { id: true, name: true, group: true } } },
  });

  const opt = (group: string) => {
    const hit = typeLinks.find((l: any) => l.types?.group === group)?.types;
    return hit ? { value: Number(hit.id), label: hit.name } : null;
  };

  return {
    id: company.id,
    name: company.name,
    market_segment_1: opt('market-segment-1'),
    market_segment_2: opt('market-segment-2'),
    market_segment_3: opt('market-segment-3'),
    market_segment_4: opt('market-segment-4'),
    source: opt('source'),
  };
}

async function companyMarketSegments(companyId: bigint): Promise<Record<string, bigint>> {
  const links = await prisma.model_has_types.findMany({
    where: {
      model_type: 'App\\Models\\CompanyProfile',
      model_id: companyId,
      types: { group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source'] } },
    },
    include: { types: { select: { id: true, group: true } } },
  });
  const out: Record<string, bigint> = {};
  for (const l of links) {
    const g = l.types?.group;
    if (!g) continue;
    const key = g === 'source' ? 'source' : g.replace(/-/g, '_');
    if (!(key in out)) out[key] = BigInt(l.type_id);
  }
  return out;
}

// Laravel updateRoomParentGIT :3160-3183 reads the segments off the MASTER FOLIO's
// own types pivot (`$folio->type->where('group', 'market-segment-1')`) and merges
// them onto the request, then :3211 runs syncTypes() on every new p-block. Not the
// company's pivot - the folio's.
async function folioMarketSegments(folioId: bigint, client: any = prisma): Promise<Record<string, bigint>> {
  const links = await client.model_has_types.findMany({
    where: {
      model_type: { contains: 'Folio' },
      model_id: folioId,
      types: { group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source'] } },
    },
    include: { types: { select: { id: true, group: true } } },
  });
  const out: Record<string, bigint> = {};
  for (const l of links) {
    const g = l.types?.group;
    if (!g) continue;
    const key = g === 'source' ? 'source' : g.replace(/-/g, '_');
    if (!(key in out)) out[key] = BigInt(l.type_id);
  }
  return out;
}

// Body values win (the FE pre-fills them from the company); the pivot is the
// fallback so an empty/missing field still resolves to the company's segment.
// `preferCompany`: company was just changed, so the posted segments are the OLD
// company's carried-over values - the new company's own segments must win.
async function resolveMarketSegments(body: any, companyId: bigint | null, preferCompany = false): Promise<Record<string, bigint | null>> {
  const fromCompany: Record<string, bigint> = companyId
    ? await companyMarketSegments(companyId).catch((): Record<string, bigint> => ({}))
    : {};
  const pick = (key: string): bigint | null => {
    const raw = body?.[key];
    const v = raw && typeof raw === 'object' ? (raw as any).value : raw;
    if (preferCompany && fromCompany[key] != null) return fromCompany[key];
    if (v === undefined || v === null || v === '' || String(v) === '0') {
      return fromCompany[key] ?? null;
    }
    try { return BigInt(v); } catch { return null; }
  };
  return {
    market_segment_1: pick('market_segment_1'),
    market_segment_2: pick('market_segment_2'),
    market_segment_3: pick('market_segment_3'),
    market_segment_4: pick('market_segment_4'),
    source: pick('source'),
  };
}

// Laravel HasTypes::syncTypes keeps the pivot in sync for BOTH the folio and each
// reservation row:
//
//   ReservationController::store  -> $folio->syncTypes($request)   (:720)
//   ReservationController::update -> $folio->syncTypes($request)   (:1564)
//   Folio::saveReservation         -> $reservation->syncTypes($req) (:2645)
//
// The detail form reads market segment / source off whichever pivot it finds,
// and the folio list + `formatUpdate` read the FOLIO one. Writing only the
// reservation pivot is what left the fields blank after both create and edit.
// `model_type` is the pivot discriminator, so both targets share this helper.
async function syncTypesPivot(
  modelType: 'App\\Models\\Folio' | 'App\\Models\\Reservation',
  modelId: bigint,
  segments: Record<string, bigint | null>,
  // Optional transaction client so callers that already hold one keep the pivot
  // writes inside the same atomic block instead of escaping on a second connection.
  client: any = prisma,
): Promise<void> {
  for (const [key, typeId] of Object.entries(segments)) {
    if (!typeId) continue;
    // `source` is a single word, not underscore-separated, so the generic
    // replace below already yields the right group. It must NOT be skipped:
    // the detail form reads source off this pivot, so omitting it left the
    // field permanently blank after a create.
    const group = key.replace(/_/g, '-');
    const existing = await client.model_has_types.findFirst({
      where: { model_type: modelType, model_id: modelId, types: { group } },
    });
    if (existing) {
      if (BigInt(existing.type_id) !== typeId) {
        await client.model_has_types.updateMany({
          where: { type_id: existing.type_id, model_type: modelType, model_id: modelId },
          data: { type_id: typeId },
        });
      }
    } else {
      await client.model_has_types.create({
        data: { type_id: typeId, model_type: modelType, model_id: modelId },
      });
    }
  }
}

async function syncReservationTypes(
  reservationId: bigint,
  segments: Record<string, bigint | null>,
  client: any = prisma,
): Promise<void> {
  return syncTypesPivot('App\\Models\\Reservation', reservationId, segments, client);
}

function rateTableColumns(codePostOptions: any[], withStatus: boolean): any[] {
  const cols: any[] = [];
  if (withStatus) {
    cols.push({ label: 'Status', key: 'status', type: 'checkbox', options: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }], is_search: true });
  }
  cols.push(
    { label: 'Rate Code', key: 'code', type: 'text', is_link: true, uri: '/rate-management/rate', is_search: true },
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Description', key: 'description', type: 'text', is_search: true },
    { label: 'Start Date', key: 'start_date', type: 'date', is_search: true },
    { label: 'End Date', key: 'end_date', type: 'date', is_search: true },
    { label: 'Post Code', key: 'code_post_id', type: 'select', options: codePostOptions, is_search: true },
    { label: 'Post Code Extra Bed', key: 'code_post_extra_bed_id', type: 'select', options: codePostOptions, is_search: true },
  );
  return cols;
}

function rateRowData(r: any, codePostById: Map<any, any>): any {
  return {
    id: Number(r.id),
    name: r.module == 'rate' ? r.name : 'BAR',
    description: r.description,
    rate_type: r.rate_type,
    online: r.online === 1,
    staah: r.staah === true,
    staah_ori: r.staah === true,
    print_rate: r.print_rate === 1,
    is_day_use: r.is_day_use === true,
    min_advance_booking: r.min_advance_booking,
    max_advance_booking: r.max_advance_booking,
    code: r.code,
    contract_rate: { value: Number(r.id), label: r.code },
    code_color: [{ value: r.code, label: r.code }],
    is_color: true,
    // Laravel Rate::formatData parity: company rates (any model_has_company_profiles
    // row) sort first and render with the success (green) highlight.
    sort_by_company: r.module == 'rate' ? ((r.model_has_company_profiles?.length ?? 0) > 0 ? 1 : 2) : 0,
    color: r.module == 'rate' ? ((r.model_has_company_profiles?.length ?? 0) > 0 ? 'bg-success' : 'bg-primary') : 'bg-secondary',
    companyProfile: r.model_has_company_profiles?.length ? r.model_has_company_profiles : [],
    start_date: fmtDateOnly(r.start_date),
    end_date: fmtDateOnly(r.end_date),
    term_condition: r.term_condition,
    cancellation_policy: r.cancellation_policy,
    notes: r.notes,
    code_post_id: { value: r.code_post_id ? Number(r.code_post_id) : null, label: codePostById.get(r.code_post_id) || '' },
    code_post_extra_bed_id: { value: r.code_post_extra_bed_id ? Number(r.code_post_extra_bed_id) : null, label: codePostById.get(r.code_post_extra_bed_id) || '' },
    sort: r.sort,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function barRowData(b: any, codePostById: Map<any, any>): any {
  return {
    id: Number(b.id),
    name: 'BAR',
    description: 'BAR',
    rate_type: 'BAR',
    code: 'BAR',
    contract_rate: { value: Number(b.id), label: 'BAR' },
    code_color: [{ value: 'BAR', label: 'BAR' }],
    is_color: true,
    sort_by_company: 0,
    color: 'bg-secondary',
    start_date: fmtDateOnly(b.start_date),
    end_date: fmtDateOnly(b.end_date),
    code_post_id: { value: Number(b.code_post_id), label: codePostById.get(b.code_post_id) || '' },
    code_post_extra_bed_id: { value: null, label: '' },
    sort: b.sort,
    status: b.status,
  };
}

// Laravel RoomType::onlyAvailable parity — returns available room ids for [dateStart, dateEnd)
//
// `excludeFolioId` lets an existing reservation keep (or take) its own room:
// without it, re-assigning a folio to a room it already occupies would report
// the room as taken by itself.
async function onlyAvailableRoomIds(
  propertyId: bigint | number,
  dateStart: string,
  dateEnd: string,
  excludeFolioId?: bigint,
): Promise<Set<number>> {
  const pId = BigInt(Number(propertyId));
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  const [rooms, availability, workOrders, reservations] = await Promise.all([
    prisma.rooms.findMany({
      // Both out_of_order and blocked rooms are unsellable. Excluding only OOO
      // let a room the grid shows as Blocked appear in every room picker.
      where: {
        deleted_at: null,
        status: 1,
        property_id: pId,
        room_status: { notIn: [ROOM_STATUSES.out_of_order.id, ROOM_STATUSES.block.id] },
      },
      select: { id: true },
    }),
    prisma.room_availabilities.findMany({
      where: { deleted_at: null, property_id: Number(propertyId), date: { gte: start, lt: end } },
      select: { room_id: true },
    }),
    prisma.work_orders.findMany({
      where: { deleted_at: null, status: 1, room_id: { not: null }, date: { gte: start }, end_date: { lt: end } },
      select: { room_id: true },
    }),
    prisma.reservations.findMany({
      where: {
        date: { gte: start, lte: end },
        status_reservation: { in: [STATUS_RESERVATION.check_in.id, STATUS_RESERVATION.reservation.id] },
        ...(excludeFolioId ? { folio_id: { not: excludeFolioId } } : {}),
      },
      select: { room_id: true, room_id_next: true, room_status_name: true },
    }),
  ]);
  const blocked = new Set<number>();
  for (const a of availability) blocked.add(Number(a.room_id));
  for (const w of workOrders) blocked.add(Number(w.room_id));
  for (const r of reservations) {
    // No due-out exemption. The old check read `reservations.room_status_name`,
    // a denormalised column nothing in this codebase ever writes, so the
    // exemption could never fire and every occupied room blocked correctly by
    // accident. An overlapping reservation on this folio must also not block
    // itself, hence the caller-side folio exclusion.
    if (r.room_id != null) blocked.add(Number(r.room_id));
    if (r.room_id_next != null) blocked.add(Number(r.room_id_next));
  }
  const available = new Set<number>();
  for (const room of rooms) if (!blocked.has(Number(room.id))) available.add(Number(room.id));
  return available;
}

// Laravel Folio::getRevenueCharge parity
async function getRevenueCharge(rows: any[]): Promise<any> {
  const byDate = new Map<string, number>();
  const chargeRoom = new Map<string, number>();
  const chargePb1 = new Map<string, number>();
  const chargeService = new Map<string, number>();
  const chargeTotal = new Map<string, number>();
  for (const row of rows) {
    const d = fmtDateOnly(row.date);
    if (!d) continue;
    const qty = Number(row.quantity ?? 1);
    const amount = Number(row.amountt ?? 0) * qty;
    const pb1 = Number(row.pb1 ?? 0) * qty;
    const service = Number(row.service_charge ?? 0) * qty;
    byDate.set(d, (byDate.get(d) ?? 0) + amount);
    chargeRoom.set(d, (chargeRoom.get(d) ?? 0) + amount + pb1);
    chargePb1.set(d, (chargePb1.get(d) ?? 0) + pb1);
    chargeService.set(d, (chargeService.get(d) ?? 0) + service);
    chargeTotal.set(d, (chargeTotal.get(d) ?? 0) + amount + pb1 + service);
  }
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return {
    date: [...byDate.entries()].map(([date, charge]) => ({ date, charge: moneyFormat(charge) })),
    charge: [
      { label: 'Room Charge', value: moneyFormat(sum(chargeRoom)) },
      { label: 'PB1', value: moneyFormat(sum(chargePb1)) },
      { label: 'Service Charge', value: moneyFormat(sum(chargeService)) },
      { label: 'Total Room Charge', value: moneyFormat(sum(chargeTotal)) },
    ],
  };
}

// Laravel Folio ledger rebuild parity (Folio.php:2690-2734).
// Rebuild folio ledgers from CodeBilling x CompanyProfileBillingSetup.
export async function rebuildFolioLedgers(folioId: bigint, propertyId: bigint, companyProfileId: bigint | null, guestProfileId: bigint | null, client: any = prisma): Promise<void> {
  const codeBillings = await client.code_billings.findMany({
    where: { deleted_at: null, status: STATUS_ACTIVE },
  });
  const setups = companyProfileId
    ? await client.company_profile_billing_setups.findMany({
        where: { deleted_at: null, company_profile_id: companyProfileId },
      })
    : [];
  const setupByBilling = new Map<number, any>(setups.map((s: any) => [Number(s.code_billing_id), s]));

  await client.ledgers.deleteMany({ where: { folio_id: Number(folioId) } });

  let sort = 0;
  for (const cb of codeBillings) {
    const setup = setupByBilling.get(Number(cb.id));
    let profileableType: string;
    let profileableId: number | null = null;
    if (setup) {
      if (String(setup.billing) === '1') {
        profileableType = 'App\\Models\\CompanyProfile';
        profileableId = companyProfileId ? Number(companyProfileId) : null;
      } else {
        profileableType = 'App\\Models\\GuestProfile';
        profileableId = guestProfileId ? Number(guestProfileId) : null;
      }
    } else if (companyProfileId) {
      profileableType = 'App\\Models\\CompanyProfile';
      profileableId = Number(companyProfileId);
    } else {
      profileableType = 'App\\Models\\GuestProfile';
      profileableId = guestProfileId ? Number(guestProfileId) : null;
    }
    await client.ledgers.create({
      data: {
        property_id: Number(propertyId),
        folio_id: Number(folioId),
        code_billing_id: cb.id,
        status: 1,
        sort: sort++,
        ...(profileableId ? { profileable_type: profileableType, profileable_id: profileableId } : {}),
      },
    });
  }
}

async function fetchCodePostOptions(): Promise<{ options: any[]; byId: Map<any, any> }> {
  const allCodePosts = await prisma.code_posts.findMany({
    where: { deleted_at: null, status: STATUS_ACTIVE, type: 'DEFAULT' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return {
    options: allCodePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
    byId: new Map(allCodePosts.map((cp: any) => [cp.id, cp.name])),
  };
}

const safeParseFolioData = (raw: any): any => {
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { return {}; }
};

/**
 * Card Type options for the folio edit form.
 *
 * The list used to be a hardcoded ['KTP', 'Paspor', 'SIM', 'KITAS'], but that
 * predates the data: `guest_profiles.card_type` also holds values like 'NRIC'
 * (Indonesian hotels overwhelmingly use KTP, but NRIC rows exist). A guest whose
 * card_type was anything outside the hardcoded four came back from the edit
 * endpoint with that value set, yet the dropdown had no matching option, so the
 * select rendered blank and saving then wrote the blank back -- which is how the
 * reservation screen and the guest profile ended up disagreeing about the same
 * guest's card.
 *
 * So: keep the known defaults first (stable order for the common ones), then
 * append every distinct value that is actually in use for this property. If the
 * lookup fails we still return the defaults rather than an empty dropdown.
 */
const DEFAULT_CARD_TYPES = ['KTP', 'Paspor', 'SIM', 'KITAS'];
async function buildCardTypeOptions(propertyId?: bigint | null): Promise<{ value: string; label: string }[]> {
  const options = DEFAULT_CARD_TYPES.map((c) => ({ value: c, label: c }));
  const seen = new Set(options.map((o) => o.value.toLowerCase()));
  try {
    const distinct = await prisma.guest_profiles.findMany({
      where: {
        card_type: { not: null },
        deleted_at: null,
        ...(propertyId ? { property_id: propertyId } : {}),
      },
      distinct: ['card_type'],
      select: { card_type: true },
    });
    for (const row of distinct) {
      const value = (row.card_type ?? '').trim();
      if (!value || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      options.push({ value, label: value });
    }
  } catch (err: any) {
    console.error('Card type option lookup failed:', err?.message || err);
  }
  return options;
}

/**
 * Laravel Reservation::boot() mirrors every denormalised column on create and
 * on update:
 *   company_profile_name <- company_profile_id
 *   room_type_name       <- room_type_id
 *   room_name            <- room_id
 *   rate_name            <- rate_id
 * and Folio::saveReservation stores `company_profile_id` straight onto each
 * per-night reservation row.
 *
 * Node only wrote the ids, so every reservation created here ended up with
 * `company_profile_id = NULL` and all four *_name columns NULL. The FIT Room
 * grid reads Company and Staf straight off those columns, which is why both
 * cells came out empty.
 *
 * Values are resolved in one batched query per call and merged into whatever
 * `data` the caller already assembled.
 */
async function withReservationNames(data: any, keys: string[] = []): Promise<any> {
  const pick = (v: any) => (v === undefined || v === null || v === '' ? null : v);
  const companyId = pick(data.company_profile_id);
  const roomTypeId = pick(data.room_type_id);
  const roomTypeNextId = pick(data.room_type_id_next);
  const roomId = pick(data.room_id);
  const roomNextId = pick(data.room_id_next);
  const rateId = pick(data.rate_id);

  const ids = (v: any) => (v != null ? [BigInt(String(v))] : []);
  const [companyRows, roomTypeRows, roomRows, rateRows] = await Promise.all([
    companyId != null
      ? prisma.company_profiles.findMany({ where: { id: BigInt(String(companyId)) }, select: { name: true } })
      : Promise.resolve([] as any[]),
    [...ids(roomTypeId), ...ids(roomTypeNextId)].length
      ? prisma.room_types.findMany({
          where: { id: { in: [...ids(roomTypeId), ...ids(roomTypeNextId)] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as any[]),
    [...ids(roomId), ...ids(roomNextId)].length
      ? prisma.rooms.findMany({
          where: { id: { in: [...ids(roomId), ...ids(roomNextId)] } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as any[]),
    rateId != null
      ? prisma.rates.findMany({ where: { id: BigInt(String(rateId)) }, select: { name: true } })
      : Promise.resolve([] as any[]),
  ]);

  const roomTypeName = new Map(roomTypeRows.map((r: any) => [String(r.id), r.name]));
  const roomName = new Map(roomRows.map((r: any) => [String(r.id), r.name]));

  data.company_profile_name =
    data.company_profile_name ?? (companyId != null ? companyRows[0]?.name ?? null : null);
  data.room_type_name =
    data.room_type_name ?? (roomTypeId != null ? roomTypeName.get(String(roomTypeId)) ?? null : null);
  data.room_name = data.room_name ?? (roomId != null ? roomName.get(String(roomId)) ?? null : null);
  data.rate_name = data.rate_name ?? (rateId != null ? rateRows[0]?.name ?? null : null);
  return data;
}

// Folio::saveReservation with is_update=1 — delete unposted rows then re-price
// and recreate per-night rows for the given list items (store-loop parity).
async function saveReservationRows(folio: any, items: any[], userId: bigint | undefined): Promise<void> {
  const propertyId = folio.property_id;
  const property = await prisma.properties.findUnique({ where: { id: propertyId }, select: { is_tax: true } });
  const isTax = property?.is_tax === 1;

  await prisma.reservations.deleteMany({ where: { folio_id: folio.id, is_posting: 0, deleted_at: null } });

  const rateIds = [...new Set(items.map((i) => String(i.rate_id)).filter((r) => r && r !== '0'))].map((s) => BigInt(s));
  const rateRows = rateIds.length ? await prisma.rates.findMany({ where: { id: { in: rateIds } }, select: { id: true, code_post_id: true } }) : [];
  const codePostById = new Map<number, any>();
  const cpIds = [...new Set(rateRows.map((r) => Number(r.code_post_id)).filter(Boolean))];
  if (cpIds.length) {
    const cps = await prisma.code_posts.findMany({ where: { id: { in: cpIds as any } } });
    cps.forEach((c: any) => codePostById.set(Number(c.id), c));
  }

  for (const item of items) {
    const itemCheckIn = new Date(item.check_in_date);
    let itemCheckOut = new Date(item.check_out_date);
    let nights = Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / 86400000);
    if (nights < 1) nights = 1;
    const rateIdBig = item.rate_id && String(item.rate_id) !== '0' ? BigInt(item.rate_id) : null;
    const roomTypeIdEff = item.room_type_id ? BigInt(item.room_type_id) : null;

    for (let i = 0; i < nights; i++) {
      const nightDate = new Date(itemCheckIn);
      nightDate.setDate(nightDate.getDate() + i);

      const pricing = await priceNight({
        // @ts-ignore
        prisma,
        rateId: rateIdBig,
        roomTypeId: roomTypeIdEff,
        night: nightDate,
        getNight: nights,
        adult: Number(item.adult || 1),
        child: Number(item.child || 0),
        quantity: 1,
        isTax,
        rateCodePost: rateIdBig ? codePostById.get(Number(rateRows.find((r) => Number(r.id) === Number(rateIdBig))?.code_post_id ?? -1)) ?? null : null,
        promos: [],
      });

      await prisma.reservations.create({
        data: await withReservationNames({
          property_id: propertyId,
          folio_id: folio.id,
          // Folio::saveReservation :2539 writes the folio's company onto every
          // per-night row; without it the Room grid Company cell was blank.
          company_profile_id: item.company_profile_id ?? folio.company_profile_id ?? null,
          rate_id: rateIdBig,
          room_type_id: item.room_type_id ? BigInt(item.room_type_id) : null,
          room_id: item.room_id ? BigInt(item.room_id) : null,
          adult: intOr(item.adult, 1),
          child: intOr(item.child, 0),
          add_bed: intOr(item.add_bed, 0),
          check_in_date: new Date(item.check_in_date),
          check_out_date: itemCheckOut,
          date: nightDate,
          status_reservation: folio.status_reservation ?? 3,
          status: STATUS_ACTIVE,
          night: nights,
          amount: pricing.amount,
          amountt: pricing.amount,
          total: pricing.total,
          service_charge: pricing.service_charge,
          pb1: pricing.pb1,
          tax3: pricing.tax3,
          eta: item.eta ?? null,
          etd: item.etd ?? null,
          data: JSON.stringify({ rate_price: pricing.rate_price, service: pricing.service_charge, pb1: pricing.pb1, tax3: pricing.tax3, total: pricing.total }),
          created_by: userId ?? null,
        }),
      });
    }
  }

  await rebuildFolioLedgers(folio.id, propertyId, folio.company_profile_id ?? null, folio.guest_profile_id ?? null);
}

// Laravel ReservationItemController@updateSubFolio (:1010-1091)
async function updateSubFolioImpl(req: Request, res: Response, id: bigint): Promise<void> {
  const body = req.body || {};
  const folio = await prisma.folios.findUnique({
    where: { id },
    include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1 } },
  });
  if (!folio || folio.deleted_at) { notFound(res, 'Folio not found'); return; }

  // Resolve the stay window, falling back to the folio's own dates when the
  // grid only posts a guest/room change without dates.
  const toNight = (v: any): string | null => {
    if (v == null || v === '') return null;
    const s = v instanceof Date ? v.toISOString() : String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  const checkInNight = toNight(body.check_in_date) ?? toNight(folio.check_in_date);
  const checkOutNight = toNight(body.check_out_date) ?? toNight(folio.check_out_date);
  if (!checkInNight || !checkOutNight) { badRequest(res, 'Check In Date or Check Out Date Not Valid'); return; }

  // Laravel :1027-1033 — the guest change is saved BEFORE the status gate, so a
  // sub-folio guest edit persists even when the stay edit itself is rejected.
  // The folio name/contact columns are mirrors of the profile that the folio
  // list renders (Laravel ReservationController@update :1512-1516 re-copies
  // them) — without this mirror the folio list kept showing the old Guest Name.
  if (body.guest_profile_id !== undefined) {
    const guestUpdate: any = {
      guest_profile_id: body.guest_profile_id ? BigInt(body.guest_profile_id) : null,
      updated_at: new Date(),
    };
    if (body.guest_profile_id) {
      const profile = await prisma.guest_profiles.findUnique({
        where: { id: BigInt(body.guest_profile_id) },
        select: {
          first_name: true, last_name: true, email: true, telp: true,
          mobile_phone: true, address: true, postal_code: true, gender: true,
          city_id: true, country_id: true, nationality_id: true,
        },
      });
      if (profile) {
        guestUpdate.first_name = profile.first_name ?? null;
        guestUpdate.last_name = profile.last_name ?? null;
        guestUpdate.email = profile.email ?? null;
        guestUpdate.telp = profile.telp ?? null;
        guestUpdate.mobile_phone = profile.mobile_phone ?? null;
        guestUpdate.address = profile.address ?? null;
        guestUpdate.postal_code = profile.postal_code ?? null;
        guestUpdate.gender = profile.gender ?? null;
        guestUpdate.city_id = profile.city_id;
        guestUpdate.country_id = profile.country_id;
        guestUpdate.nationality_id = profile.nationality_id;
      }
    }
    await prisma.folios.update({ where: { id: folio.id }, data: guestUpdate });
  }

  // Room availability over the requested stay window
  const roomId = body.room_id ? BigInt(body.room_id) : null;
  const windowStart = new Date(checkInNight + 'T00:00:00.000Z');
  const windowEnd = new Date(checkOutNight + 'T00:00:00.000Z');
  if (roomId != null) {
    const [holds, wos, overlaps] = await Promise.all([
      prisma.room_availabilities.count({ where: { deleted_at: null, room_id: Number(roomId), date: { gte: windowStart, lt: windowEnd } } }),
      prisma.work_orders.count({ where: { deleted_at: null, status: 1, room_id: roomId, date: { lte: windowStart }, OR: [{ end_date: null }, { end_date: { gt: windowEnd } }] } }),
      prisma.reservations.count({
        where: { date: { gte: windowStart, lt: windowEnd }, folio_id: { not: folio.id }, deleted_at: null, folios: { is: { status_reservation: { in: [0, 3] } } }, OR: [{ room_id: roomId }, { room_id_next: roomId }] },
      }),
    ]);
    if (holds > 0 || wos > 0 || overlaps > 0) { badRequest(res, 'Room Already Used'); return; }
  }

  if (folio.status_reservation !== STATUS_RESERVATION.reservation.id) {
    badRequest(res, 'Folio status is not reservation');
    return;
  }

  // Stay must be inside the parent folio's window (= Laravel :1042-1048)
  if (Number(folio.parent ?? 0) !== 0) {
    const parentFolio = await prisma.folios.findUnique({ where: { id: BigInt(Number(folio.parent)) } });
    if (parentFolio && parentFolio.check_in_date != null && parentFolio.check_out_date != null
      && (new Date(checkInNight) < new Date(new Date(parentFolio.check_in_date).toISOString().slice(0, 10))
        || new Date(checkOutNight) > new Date(new Date(parentFolio.check_out_date).toISOString().slice(0, 10)))) {
      badRequest(res, 'Check In Date or Check Out Date Not Valid');
      return;
    }
  }

  await prisma.folios.update({
    where: { id: folio.id },
    data: {
      check_in_date: windowStart,
      check_out_date: windowEnd,
      updated_at: new Date(),
    },
  });

  const firstResv = folio.reservations[0];
  const arr = [{
    eta: firstResv?.eta ?? null,
    etd: firstResv?.etd ?? null,
    room_type_id: body.room_type_id,
    room_id: roomId,
    check_in_date: checkInNight,
    check_out_date: checkOutNight,
    adult: firstResv?.adult ?? 1,
    child: firstResv?.child ?? 0,
    add_bed: 0,
    rate_id: body.rate_id ?? String(firstResv?.rate_id ?? ''),
  }];
  const refreshed = await prisma.folios.findUnique({ where: { id: folio.id } });
  await saveReservationRows(refreshed!, arr, req.user?.id);
  success(res, bigintToNumber(refreshed), 'Success', 200);
}

// Laravel ReservationItemController@updateParentFolio (:1093-1149)
async function updateParentFolioImpl(req: Request, res: Response, id: bigint): Promise<void> {
  const body = req.body || {};
  const required = ['room_type_id', 'room_id', 'rate_id', 'rate', 'remark_room'];
  for (const f of required) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      badRequest(res, `The ${f.replace(/_/g, ' ')} field is required.`);
      return;
    }
  }

  const folio = await prisma.folios.findUnique({ where: { id } });
  if (!folio || folio.deleted_at) { notFound(res, 'Not Found'); return; }

  await prisma.folios.update({
    where: { id },
    data: { check_in_date: new Date(body.check_in_date), check_out_date: new Date(body.check_out_date), updated_at: new Date() },
  });

  const children = await prisma.folios.findMany({ where: { parent: id, deleted_at: null } });
  for (const child of children) {
    const firstResv = await prisma.reservations.findFirst({ where: { folio_id: child.id, deleted_at: null }, orderBy: { date: 'asc' } });
    await prisma.folios.update({
      where: { id: child.id },
      data: { check_in_date: new Date(body.check_in_date), check_out_date: new Date(body.check_out_date), updated_at: new Date() },
    });
    const arr = [{
      rate_id: body.rate_id,
      eta: firstResv?.eta ?? null,
      etd: firstResv?.etd ?? null,
      room_type_id: body.room_type_id,
      room_id: body.room_id,
      check_in_date: body.check_in_date,
      check_out_date: body.check_out_date,
      adult: firstResv?.adult ?? 1,
      child: firstResv?.child ?? 0,
      add_bed: 0,
    }];
    const refreshedChild = await prisma.folios.findUnique({ where: { id: child.id } });
    await saveReservationRows(refreshedChild!, arr, req.user?.id);
  }
  success(res, bigintToNumber(folio), 'Success', 200);
}
async function createFolioWithRetry(propertyId: bigint, typeReservation: string, folioData: (num: string) => any, maxRetries = 5) {
  // Laravel Folio@savingLegacy/generateCodeReservation parity (Global.php folioNumberFormat + Folio.php getCodeReservation/getLastResevation)
  const code =
    typeReservation === 'git' ? 'G'
    : typeReservation === 'fit' ? 'F'
    : typeReservation === 'day-use' ? 'D'
    : 'V';
  const propStr = String(propertyId).padStart(3, '0');
  const now = new Date();
  const ym = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `${code}${propStr}${ym}`;
  const storedType = typeReservation === 'day-use' ? 'fit' : typeReservation;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const lastFolio = await prisma.folios.findFirst({
      where: {
        folio_number: { startsWith: prefix },
        parent: 0,
        deleted_at: null,
        type_reservation: storedType,
      },
      orderBy: { folio_number: 'desc' },
      select: { folio_number: true },
    });
    let nextSeq = 1;
    if (lastFolio?.folio_number) {
      const rest = lastFolio.folio_number.slice(prefix.length);
      const m = rest.match(/^(\d{4})/);
      if (m) nextSeq = parseInt(m[1], 10) + 1;
    }
    const folioNumber = prefix + String(nextSeq).padStart(4, '0');
    try {
      return await prisma.folios.create({ data: folioData(folioNumber) });
    } catch (err: any) {
      // Prisma 7 with the pg driver adapter no longer populates
      // `meta.target` ("Unique constraint failed on the (not available)"),
      // so keying the retry off `meta.target.includes('folio_number')` never
      // matched and every duplicate-key race surfaced as a 500. Match on the
      // P2002 code and inspect the adapter's original constraint instead.
      if (err?.code === 'P2002') {
        const constraint = String(
          err?.meta?.driverAdapterError?.cause?.constraint
          ?? err?.meta?.driverAdapterError?.cause?.originalMessage
          ?? '',
        );
        // A violation on the primary key means the id sequence is out of sync
        // with the table — retrying a different folio number cannot help.
        if (constraint.includes('folio_number')) continue;
        throw new Error(
          `Folio id sequence out of sync (constraint: ${constraint || 'unknown'}). ` +
          'Run the sequence repair SQL in the project root before retrying.',
        );
      }
      throw err;
    }
  }
  throw new Error('Failed to generate unique folio number after retries');
}

/**
 * GIT-parent date propagation — Laravel ReservationController::update
 * (:1598-1700). When a parent GIT folio's stay moves (check-in pulled earlier
 * and/or check-out pushed later), every selected sub-folio follows: the folio
 * window shifts and its per-night reservation rows are rebuilt to match.
 *
 * Parity notes:
 * - shiftFront  = how many days the parent's check-in moved EARLIER
 *                 (`req.check_in_date < parent.check_in_date`).
 * - shiftBack   = how many days the parent's check-out moved LATER
 *                 (`req.check_out_date > parent.check_out_date`).
 * - Laravel guards the newly opened front nights against the sub-folio's own
 *   room (Room::AvailableRoom) and 400s with 'Room Not Available for Subfolio
 *   ...' when occupied.
 */
async function shiftGitSubFolioStay(
  subFolioId: bigint,
  shiftFrontDays: number,
  shiftBackDays: number
): Promise<void> {
  if (shiftFrontDays <= 0 && shiftBackDays <= 0) return;

  const subFolio: any = await prisma.folios.findUnique({ where: { id: subFolioId } });
  if (!subFolio) return;

  const oldCheckIn = subFolio.check_in_date ? new Date(subFolio.check_in_date) : null;
  const oldCheckOut = subFolio.check_out_date ? new Date(subFolio.check_out_date) : null;
  if (!oldCheckIn || !oldCheckOut) return;

  const addDays = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const newCheckIn = shiftFrontDays > 0 ? addDays(oldCheckIn, -shiftFrontDays) : oldCheckIn;
  const newCheckOut = shiftBackDays > 0 ? addDays(oldCheckOut, shiftBackDays) : oldCheckOut;

  // Room-availability guard on the newly opened front nights (Laravel :1619-1632).
  if (shiftFrontDays > 0) {
    const firstReserSub = await prisma.reservations.findFirst({
      where: { folio_id: subFolioId, deleted_at: null },
      orderBy: { date: 'asc' },
    });
    const roomSubOld = firstReserSub?.room_id
      ? await prisma.rooms.findUnique({ where: { id: firstReserSub.room_id } })
      : null;
    if (roomSubOld && firstReserSub?.room_id) {
      const conflict = await prisma.reservations.findFirst({
        where: {
          room_id: firstReserSub.room_id,
          deleted_at: null,
          folio_id: { not: subFolioId },
          check_in_date: { lt: newCheckOut },
          check_out_date: { gt: newCheckIn },
          folios: { is: { status_reservation: { notIn: [1, 2] }, deleted_at: null } },
        },
      });
      if (conflict) {
        throw new Error(`Room Not Available for Subfolio ${subFolio.folio_number ?? subFolioId}`);
      }
    }
  }

  const netShift = shiftBackDays - shiftFrontDays;
  await prisma.folios.update({
    where: { id: subFolioId },
    data: {
      check_in_date: newCheckIn,
      check_out_date: newCheckOut,
      updated_at: new Date(),
    },
  });

  if (netShift === 0) {
    // Window extended on one side only with rows covering it already? Never
    // happens in practice here: extension adds nights the parent does not have,
    // so the sub rows must move with the window. Keep the safe no-op when the
    // net is zero (both sides moved an equal amount — dates unchanged).
    return;
  }

  // Rebuild the per-night rows exactly like Laravel's saveReservation call:
  // every existing (non-audited) row is soft-deleted and re-created with its
  // date shifted; the first row carries folio window dates, other rows carry
  // day-scope check_in/check_out.
  const rows = await prisma.reservations.findMany({
    where: { folio_id: subFolioId, deleted_at: null },
    orderBy: { date: 'asc' },
  });
  if (rows.length === 0) return;

  await prisma.reservations.updateMany({
    where: { folio_id: subFolioId, deleted_at: null },
    data: { deleted_at: new Date() },
  });

  const nights = Math.max(
    1,
    Math.round((newCheckOut.getTime() - newCheckIn.getTime()) / (1000 * 60 * 60 * 24))
  );

  for (let i = 0; i < nights; i++) {
    const src = rows[Math.min(i, rows.length - 1)];
    const rowDate = addDays(newCheckIn, i);
    await prisma.reservations.create({
      data: {
        property_id: src.property_id,
        folio_id: src.folio_id,
        rate_id: src.rate_id,
        room_type_id: src.room_type_id,
        room_id: src.room_id,
        eta: src.eta,
        etd: src.etd,
        adult: src.adult ?? 1,
        child: src.child ?? 0,
        add_bed: src.add_bed ?? 0,
        check_in_date: i === 0 ? newCheckIn : rowDate,
        check_out_date: i === 0 ? newCheckOut : addDays(rowDate, 1),
        date: rowDate,
        status_reservation: src.status_reservation,
        status: src.status,
        night: nights,
        amount: src.amount,
        amountt: src.amountt,
        total: src.total,
        service_charge: src.service_charge,
        pb1: src.pb1,
        tax3: src.tax3,
        created_by: src.created_by,
      },
    });
  }
}
export class ReservationController {
  // Replicates Laravel ReservationController@moveLedger (PUT /reservation/ledger/move/:id).
  static async moveLedger(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Transaction not found'); return; }
      const id = BigInt(idRaw);
      const ledgerTo = String(req.body?.ledger_to ?? '');
      if (!ledgerTo) { notFound(res, 'The ledger to field is required.'); return; }

      const transaction = await prisma.transactions.findUnique({ where: { id } });
      if (!transaction) { notFound(res, 'Transaction not found'); return; }

      await prisma.transactions.update({ where: { id }, data: { bill_to: ledgerTo, updated_at: new Date(), updated_by: req.user?.id } });

      // Laravel :4211-4225 — re-point profileable to the ledger target
      // (ledger_to = '<profileId>-company' | '<profileId>-guest').
      const parts = String(ledgerTo).split('-');
      const last = parts[parts.length - 1];
      const profileId = parts[0] && /^\d+$/.test(parts[0]) ? BigInt(parts[0]) : null;
      if (profileId != null && (last === 'company' || last === 'guest')) {
        const modelType = last === 'company' ? 'App\\Models\\CompanyProfile' : 'App\\Models\\GuestProfile';
        await prisma.transactions.update({
          where: { id },
          data: { model_type: modelType, model_id: profileId, updated_at: new Date() },
        });
      }

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Move ledger error:', err);
      error(res, 'Failed to move ledger', 500);
    }
  }

  
  // GET /api/reservations
  
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search_field = req.query.search_field as string;
      const search_value = req.query.search_value as string;
      const propertyId = req.user?.lastProperty;
      const is_day_use = req.query.dayuse === '1';
      const parentId = req.query.parent_id ? BigInt(req.query.parent_id as string) : null;

      const trash = req.query.trash === '1' || req.query.trash === 'true';

      // Laravel: `->statusReservation(['reservation','pending'], $displayStatus)`.
      // The default pair is only a fallback — when the user picks statuses in the
      // filter bar those win. Without this the "Status Folio" dropdown was dead
      // UI, and a virtual folio that had been checked in vanished from
      // /reservation/vr entirely (it only reappeared on the check-out screen).
      const displayStatusRaw = (req.query.display_status as string) || '';
      const statusCodes = displayStatusRaw
        .split(',')
        .map((c: string) => c.trim())
        .filter(Boolean);
      let statusWhere: any = { in: [STATUS_RESERVATION.reservation.id, STATUS_RESERVATION.pending.id] };
      if (statusCodes.length > 0) {
        const ids = statusCodes
          .map((code: string) => Object.values(STATUS_RESERVATION).find((s: any) => s.code === code)?.id)
          .filter((v: any) => v !== undefined && v !== null);
        if (ids.length > 0) statusWhere = { in: ids };
      }

      const where: any = {
        deleted_at: trash ? { not: null } : null,
        is_pos_trx: false,
        status_reservation: statusWhere,
      };

if (propertyId) where.property_id = propertyId;
      if (is_day_use) where.is_day_use = true;
      if (parentId !== null) where.parent = parentId;

      // Filter by type_reservation (fit, git, vr, day-use) - Laravel getDisplayTypes parity
      const displayTypes: string[] = [];
      if (req.query.fit === '1') displayTypes.push(TYPE_RESERVATION.fit.code);
      if (req.query.git === '1') displayTypes.push(TYPE_RESERVATION.git.code);
      if (req.query.vr === '1') displayTypes.push(TYPE_RESERVATION.vr.code);
      if (req.query.dayuse === '1') displayTypes.push(TYPE_RESERVATION['day-use'].code);
      if (displayTypes.length > 0) {
        where.type_reservation = { in: displayTypes };
      }

const table = [
        { label: 'Res Date', key: 'res_date', type: 'date' },
        { label: 'Type', key: 'type_reservation' },
{ label: 'MSG', key: 'message_bool', type: 'boolean', action: 'message' },
      { label: 'IGN', key: 'ign', type: 'boolean', action: 'ign' },
        { label: 'DND', key: 'is_do_not_disturb', type: 'boolean' },
        { label: 'Remark', key: 'remark_bool', type: 'boolean' },
        { label: 'Status', key: 'status_reservation_color', is_html: true },
        { label: 'Folio', key: 'folio_number', is_link: true, uri: '/reservation/fit/reservation' },
        { label: 'Guest Name', key: 'guest_name' },
        { label: 'Guest', key: 'guest_status_color', is_html: true },
        { label: 'Stay', key: 'stay' },
        { label: 'Room', key: 'room' },
        { label: 'Room Next', key: 'room_next' },
        { label: 'Company', key: 'company' },
        { label: 'Room Type', key: 'room_type' },
        { label: 'Room Status', key: 'room_status_color', is_html: true },
        { label: 'Clean Status', key: 'room_clean_status_color', is_html: true },
        { label: 'Check In', key: 'check_in_date', type: 'date' },
        { label: 'Check Out', key: 'check_out_date', type: 'date' },
        { label: 'Balance', key: 'balance' },
        { label: 'Sharer', key: 'sharer' },
        { label: 'A', key: 'aa' },
        { label: 'C', key: 'cc' },
      ];

      applySearchField(where, req, table, 'folios');

      const [folios, total] = await Promise.all([
        prisma.folios.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            properties: { select: { name: true } },
            reservations: {
              where: { deleted_at: null },
              orderBy: { date: 'asc' },
              select: {
                is_posting: true,
                room_name: true,
                room_type_name: true,
                room_id_next: true,
                adult: true,
                child: true,
                room_types: { select: { name: true } },
                rooms: { select: { name: true, room_status: true, maid_status: true } },
              },
            },
          },
        }),
        prisma.folios.count({ where }),
      ]);

const folioIds = folios.map((f: any) => f.id);
      const [batchTransactions, batchGuests, openMessageFolios] = await Promise.all([
        prisma.transactions.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null } }),
        prisma.guest_profiles.findMany({
          where: { id: { in: folios.filter((f: any) => !((f.first_name || '').trim()) && f.guest_profile_id).map((f: any) => f.guest_profile_id) } },
          select: { id: true, first_name: true, last_name: true },
        }),
        // Folio::formatDataFrontDesk() -> message_bool =
        //   $this->message()->where('is_open', 1)->count() > 0
        folioIds.length
          ? prisma.messages.groupBy({
              by: ['folio_id'],
              where: { folio_id: { in: folioIds }, is_open: true, deleted_at: null },
              _count: { _all: true },
            }).catch(() => [])
          : [],
      ]);
      const messageBoolByFolio = new Set((openMessageFolios as any[]).map((r) => String(r.folio_id)));
      const txnByFolio = new Map<string, any[]>();
      for (const t of batchTransactions) {
        const key = String(t.folio_id);
        if (!txnByFolio.has(key)) txnByFolio.set(key, []);
        txnByFolio.get(key)!.push(t);
      }
      const guestByProfileId = new Map(batchGuests.map((g: any) => [String(g.id), g]));

const formatted = folios.map((f: any) => {
        let guestName = `${f.first_name || ''} ${f.last_name || ''}`.trim();
        if (!guestName && f.guest_profile_id) {
          const gp = guestByProfileId.get(String(f.guest_profile_id));
          if (gp) guestName = `${gp.first_name || ''} ${gp.last_name || ''}`.trim();
        }

        // Folio::lastReservation() parity: first reservation with is_posting = 0
        // ordered by date asc, falling back to the most recent reservation.
        const allReservations = f.reservations ?? [];
        const notPostedReservations = allReservations.filter((r: any) => Number(r.is_posting ?? 0) === 0);
        const lastReservation = notPostedReservations.length > 0
          ? notPostedReservations[0]
          : [...allReservations].sort(
              (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            )[0];
        const roomName = lastReservation?.rooms?.name || lastReservation?.room_name || '';
        const roomTypeName = lastReservation?.room_types?.name || lastReservation?.room_type_name || '';
        const roomNext = lastReservation?.room_id_next ? (lastReservation.rooms?.name || '') : '';

        // Get balance from transactions (batched)
        const transactions = txnByFolio.get(String(f.id)) || [];
        const balance = transactions.reduce((sum: number, t: any) => sum + Number(t.total || 0), 0);

        // Stay calculation
        const checkIn = f.check_in_date ? new Date(f.check_in_date) : null;
        const checkOut = f.check_out_date ? new Date(f.check_out_date) : null;
        const stay = checkIn && checkOut ? Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)) : 0;

        // Adult/Child from last reservation
        const aa = lastReservation?.adult || 0;
        const cc = lastReservation?.child || 0;

        // Status reservation color (matching front-desk)
        const statusReservationColor = (folio: any): { label: string; color: string; is_color: boolean }[] => {
          if (folio.status_reservation === STATUS_RESERVATION.reservation.id && folio.is_request_cancel) {
            return [{ label: 'Request-Cancel', color: 'bg-yellow', is_color: true }];
          }
          return [{
            label: statusReservationLabel(folio.status_reservation),
            color: COLOR_RESERVATION[folio.status_reservation] || 'bg-success',
            is_color: true,
          }];
        };

        // Room/Clean Status from the room the last reservation points at,
        // mirroring Folio::formatList(). Empty array when no room is attached.
        const attachedRoom = lastReservation?.rooms ?? null;
        const roomStatusId = attachedRoom ? Number(attachedRoom.room_status) : null;
        const maidStatusId = attachedRoom ? Number(attachedRoom.maid_status) : null;
        const roomStatusName = roomStatusId != null
          ? (Object.values(ROOM_STATUSES).find((s: any) => s.id === roomStatusId) as any)?.name
          : null;
        const maidStatusName = maidStatusId != null
          ? (Object.values(MAID_STATUSES).find((s: any) => s.id === maidStatusId) as any)?.name
          : null;
        const roomStatusColor: { label: string; color: string; is_color: boolean }[] =
          attachedRoom && roomStatusName && roomStatusId != null
            ? [{ label: roomStatusName.replace(/\s+/g, '-'), color: getColorRoom(roomStatusId), is_color: true }]
            : [];
        const roomCleanStatusColor: { label: string; color: string; is_color: boolean }[] =
          attachedRoom && maidStatusName && maidStatusId != null
            ? [{ label: maidStatusName.replace(/\s+/g, '-'), color: getColorMaid(maidStatusId), is_color: true }]
            : [];

        return {
          id: Number(f.id),
          value: Number(f.id),
          name: f.folio_number,
          res_date: f.res_date,
          type_reservation: f.type_reservation?.toUpperCase(),
          message_bool: messageBoolByFolio.has(String(f.id)),
          // Folio::isIncognito() -> `$this->is_incognito == 1`
          ign: !!f.is_incognito,
          remark_bool: !!(f.remark || f.posting_instruction || f.check_out_instruction || f.check_in_instruction),
          is_do_not_disturb: !!f.is_do_not_disturb,
          status_reservation_color: statusReservationColor(f),
          room_clean_status_color: roomCleanStatusColor,
          room_status_color: roomStatusColor,
          folio_number: f.folio_number,
          guest_name: guestName || '-',
          guest_status: { label: 'Regular', color: 'bg-green' },
          guest_status_color: [{ label: 'Regular', color: 'bg-green', is_color: true }],
          date_arrival: f.check_in_date,
          stay,
          room: roomName,
          room_next: roomNext,
          company: f.company_name || '',
          room_type: roomTypeName,
          check_in_date: f.check_in_date,
          check_out_date: f.check_out_date,
          balance: balance.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
          sharer: '',
          is_popup_other_guest: false,
          aa,
          cc,
          actions: [],
        };
      });

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

success(res, formatted, 'Success', 200, {
        table,
        permission,
        search_data: dataSearch(req, table) as any,
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
      console.error('Reservation list error:', err);
      error(res, 'Failed to fetch reservations', 500);
    }
  }

  
  // GET /cms/reservation-item (ReservationItemController parity - room grid per folio)
  
  static async reservationItemIndex(req: Request, res: Response): Promise<void> {
    const tableRom = [
      { label: 'Doc Date', key: 'date', type: 'none', is_search: true },
      { label: 'Company', key: 'company_id', type: 'select', is_search: true },
      { label: 'Type', key: 'room_type_id', type: 'select', is_search: true },
      { label: 'Room', key: 'room_id', type: 'select', is_search: true },
      { label: 'Total', key: 'total', type: 'text', is_search: true },
      { label: 'Reason', key: 'remark_room', type: 'select', is_search: true },
      { label: 'Market Segment 1', key: 'market_segment_1', type: 'select', is_search: true },
      { label: 'Market Segment 2', key: 'market_segment_2', type: 'select', is_search: true },
      { label: 'Market Segment 3', key: 'market_segment_3', type: 'select', is_search: true },
      { label: 'Market Segment 4', key: 'market_segment_4', type: 'select', is_search: true },
      { label: 'Source', key: 'source', type: 'select', is_search: true },
      { label: 'Staf', key: 'updated_by', type: 'text', is_search: true },
    ];

    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 9999;
      const folioIdParam = req.query.folio_id as string;
      const permission = {
        view: true,
        add: true,
        edit: true,
        delete: true,
      };
      const pagination = (total: number) => ({
        current_page: page,
        last_page: Math.ceil(total / limit),
        per_page: limit,
        total,
        from: total === 0 ? 0 : (page - 1) * limit + 1,
        to: Math.min(page * limit, total),
      });
      const empty = (msg: string) =>
        success(res, [], 'No guest ID provided.', 200, {
          table: tableRom,
          pagination: pagination(0),
          permission,
          search_data: [],
        });

      if (!folioIdParam) {
        empty('folio_id required');
        return;
      }

      const folio = await prisma.folios.findUnique({ where: { id: BigInt(folioIdParam) } });
      if (!folio || folio.deleted_at) {
        empty('folio not found');
        return;
      }

      const [rows, types, property, reasonTypes] = await Promise.all([
        prisma.reservations.findMany({
          where: { folio_id: folio.id, deleted_at: null },
          orderBy: { date: 'asc' },
          // Laravel Reservation::formatData falls back to the `roomType` / `room`
          // relations when the denormalised `room_type_name` / `room_name`
          // columns are empty. Without these includes Company / Room Type / Room
          // / Staf all rendered blank in the Folio Room grid.
          include: {
            rates: { select: { code: true } },
            room_types: { select: { id: true, name: true } },
            rooms: { select: { id: true, name: true } },
          },
        }),
        prisma.types.findMany({
          where: {
            deleted_at: null,
            status: STATUS_ACTIVE,
            property_id: req.user?.lastProperty ?? 0,
            group: { in: ['remark-room', 'market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source'] },
          },
          select: { id: true, name: true, group: true },
        }),
        prisma.properties.findUnique({
          where: { id: req.user?.lastProperty as bigint },
          select: { id: true, name: true, market_segment_1: true, market_segment_2: true, market_segment_3: true, market_segment_4: true },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, property_id: req.user?.lastProperty ?? 0, group: 'cancellation-reservation' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const rowIds = rows.map((r) => r.id);
      const mht = await prisma.model_has_types.findMany({
        where: { model_type: 'App\\Models\\Reservation', model_id: { in: rowIds } },
        include: { types: true },
      });
      const typeByRow: Record<string, any[]> = {};
      for (const m of mht) {
        (typeByRow[String(m.model_id)] = typeByRow[String(m.model_id)] || []).push(m.types);
      }
      const typeGroup = (rowId: bigint, group: string) => {
        const list = typeByRow[String(rowId)] || [];
        const found = list.find((t) => t.group === group);
        return found ? { value: Number(found.id), label: found.name } : [];
      };

      const statusReservationMap: Record<number, string> = {
        0: 'Check In',
        1: 'Check Out',
        2: 'Cancelled',
        3: 'Reservation',
        4: 'In House',
        5: 'Pending',
      };

      // Laravel formatData: 'company_idx' falls back to the folio's company and
      // 'company_id' to the CompanyProfile name; 'Staf' is updatedBy->name.
      const folioCompanyId = folio.company_profile_id ? Number(folio.company_profile_id) : null;
      const folioCompanyName = folioCompanyId
        ? (await prisma.company_profiles.findUnique({
            where: { id: BigInt(folioCompanyId) },
            select: { name: true },
          }))?.name ?? null
        : null;
      const companyIds = Array.from(
        new Set([
          ...rows.map((r: any) => Number(r.company_profile_id)).filter((n: number) => n > 0),
          ...(folioCompanyId ? [folioCompanyId] : []),
        ]),
      );
      const staffIds = Array.from(
        new Set([
          ...rows.map((r: any) => Number(r.updated_by)).filter((n: number) => n > 0),
          ...rows.map((r: any) => Number(r.created_by)).filter((n: number) => n > 0),
        ]),
      );
      const [companyRows, staffRows] = await Promise.all([
        companyIds.length
          ? prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
          : Promise.resolve([] as any[]),
        staffIds.length
          ? prisma.users.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
          : Promise.resolve([] as any[]),
      ]);
      const companyName = new Map(companyRows.map((c: any) => [Number(c.id), c.name]));
      const staffName = new Map(staffRows.map((u: any) => [Number(u.id), u.name]));

      const data = rows.map((r: any) => ({
        id: Number(r.id),
        rate_id: r.rate_id ? Number(r.rate_id) : null,
        rate: {
          value: r.rate_id ? Number(r.rate_id) : null,
          label: r.rate_name || r.rates?.code || '',
        },
        action_table: r.is_posting ? false : true,
        // Laravel reads `updatedBy?->name` only, but a row that has never been edited
        // carries `updated_by = NULL` even though `created_by` is set - the Staf
        // cell was blank for every freshly created reservation.
        updated_by: r.updated_by
          ? staffName.get(Number(r.updated_by)) ?? null
          : r.created_by
            ? staffName.get(Number(r.created_by)) ?? null
            : null,
        date: r.date,
        remark_room: typeGroup(r.id, 'remark-room'),
        market_segment_1: typeGroup(r.id, 'market-segment-1'),
        market_segment_2: typeGroup(r.id, 'market-segment-2'),
        market_segment_3: typeGroup(r.id, 'market-segment-3'),
        market_segment_4: typeGroup(r.id, 'market-segment-4'),
        source: typeGroup(r.id, 'source'),
        // Reservations stored before the company was mirrored onto the row kept
        // both columns NULL, so fall back to the folio's company - same source
        // Laravel's `company_idx` uses - instead of showing an empty cell.
        company_id:
          r.company_profile_name ||
          companyName.get(Number(r.company_profile_id)) ||
          folioCompanyName ||
          null,
        company_idx: r.company_profile_id ? Number(r.company_profile_id) : folioCompanyId,
        // Laravel Reservation::formatData (:865-867) formats these three money
        // columns with moneyFormat; raw numbers rendered without thousand
        // separators/decimals in the FIT Room grid.
        rate_price: moneyFormat(Number(r.amount || 0)),
        total_extra_bed: moneyFormat(Number(r.total_extra_bed || 0)),
        total: moneyFormat(Number(r.total || 0)),
        check_in_date: r.check_in_date,
        check_out_date: r.check_out_date,
        room_type_id: {
          value: r.room_type_id ? Number(r.room_type_id) : null,
          label: r.room_type_name || r.room_types?.name || '',
        },
        room_type: r.room_types?.name || r.room_type_name || '',
        room_id: {
          value: r.room_id ? Number(r.room_id) : null,
          label: r.room_name || r.rooms?.name || '',
        },
        room: r.rooms?.name || r.room_name || '',
        stay: '0',
        night: r.night,
        status_reservation: {
          value: r.status_reservation ?? 0,
          label: statusReservationMap[r.status_reservation ?? 0] || 'Pending',
        },
        adult: r.adult,
        child: r.child,
        created_at: r.created_at,
        updated_at: r.updated_at,
        deleted_at: r.deleted_at,
        created_by: r.created_by ? Number(r.created_by) : null,
        deleted_by: r.deleted_by ? Number(r.deleted_by) : null,
        status: r.status,
      }));

      const marketProperty = property
        ? {
            id: Number(property.id),
            name: property.name,
            is_market_segment_1: property.market_segment_1 === true,
            is_market_segment_2: property.market_segment_2 === true,
            is_market_segment_3: property.market_segment_3 === true,
            is_market_segment_4: property.market_segment_4 === true,
          }
        : {};

      success(res, data, 'Success', 200, {
        table: tableRom,
        pagination: pagination(data.length),
        permission,
        folio: {
          ...(reservationBn(folio) as any),
          // Laravel Folio::formatData :2874 - the FE Room tab switches to the
          // room-git grid only when this flag is true.
          is_parent_git: String(folio.type_reservation ?? '').toLowerCase() === 'git' && Number(folio.parent ?? 0) === 0,
        },
        market_property: marketProperty,
        master: {
          reasons: reasonTypes.map((t) => ({ value: t.name, label: t.name })),
        },
        search_data: [],
      });
    } catch (err: any) {
      console.error('Reservation item index error:', err);
      error(res, 'Failed to fetch reservation items', 500);
    }
  }

  
  // PUT /cms/reservation-item/:id (ReservationItemController update parity - basic)
  
  static async reservationItemUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      // ── Laravel :276-297 — action routing matrix ──
      // Laravel routes FIRST and resolves rows inside each branch: move /
      // VR / sub-folio / is_parentfolio payloads POST the FOLIO id as the path
      // id (Folio::find($id) at :295, :311, :721, :885), while assignRoom and
      // the generic path use the reservation id (Reservation::find at :785,
      // :329). Looking up only the reservation table up-front 404'd every
      // folio-id payload, so "Move Reservation", sub-folio room/guest edits
      // and parent-folio edits were never saved.
      // The reservation row is resolved non-fatally here — the generic path
      // validates it below, exactly where Laravel does (Reservation::find
      // at :329).
      const existing = await prisma.reservations.findUnique({ where: { id } });
      if ((req.body || {}).type_reservation !== undefined) {
        const typeUpper = String(req.body.type_reservation ?? '').toUpperCase();
        const roomActions = ['assign_room', 'un_check_out', 'un_check_in', 'check_out', 'check_in'];
        if (roomActions.concat('move_reservation').includes(req.body.status_reservation) && typeUpper === 'VR') {
          return await ReservationController.updateVR(req, res);
        }
        if (roomActions.includes(req.body.status_reservation) && typeUpper !== 'GIT') {
          return await ReservationController.assignRoom(req, res);
        }
        if (req.body.status_reservation === 'move_reservation' && typeUpper !== 'GIT') {
          return await ReservationController.moveReservationItems(req, res);
        }
        // Laravel :292-294 — `$request->is_list_parent_git` is compared loosely,
        // so an ABSENT flag (= null) matches `== 0`: room actions on GIT child
        // rows must go to assignRoom, not fall into the generic path.
        if (roomActions.includes(req.body.status_reservation) && typeUpper === 'GIT' && Number(req.body.is_list_parent_git ?? 0) === 0) {
          return await ReservationController.assignRoom(req, res);
        }
        // Laravel :294 — the GIT + is_list_parent_git==1 branch covers
        // ['move_reservation','un_check_out','un_check_in','check_out',
        // 'check_in'] only; assign_room is NOT routed to updateSubFolio and
        // falls through to the is_parentfolio/generic handling.
        if (['move_reservation', 'un_check_out', 'un_check_in', 'check_out', 'check_in'].includes(req.body.status_reservation) && typeUpper === 'GIT' && Number(req.body.is_list_parent_git ?? 0) === 1) {
          return await updateSubFolioImpl(req, res, id);
        }
        if (req.body.status_reservation === 'move_reservation' && typeUpper === 'GIT') {
          // The grid posts is_list_parent_git only for the MASTER list; sub-folio
          // rows arrive without it. A GIT child (parent != 0) is a sub-folio row
          // and must be saved through updateSubFolio — the previous fallthrough
          // ended in the generic path, which rejected the payload with "The rate
          // id field is required." So Move/Extend and sub-folio room/guest edits
          // never persisted.
          let routeFolio: any = await prisma.folios.findUnique({ where: { id }, select: { id: true, parent: true, deleted_at: true } });
          // Some callers post the reservation-item id — resolve its folio too
          // (moveReservationItems already accepts both kinds of id).
          if (!routeFolio && existing) {
            routeFolio = await prisma.folios.findUnique({ where: { id: existing.folio_id }, select: { id: true, parent: true, deleted_at: true } });
          }
          if (routeFolio && !routeFolio.deleted_at && Number(routeFolio.parent ?? 0) !== 0) {
            return await updateSubFolioImpl(req, res, BigInt(routeFolio.id));
          }
        }
      }

      const { rate_id, room_type_id, room_id, total, apply_mode } = req.body;

      // Laravel :299-308 — rate_id required on the generic path
      if (rate_id === undefined || rate_id === null || rate_id === '') {
        badRequest(res, 'The rate id field is required.');
        return;
      }

      // Laravel :310-312 — parent folio edit delegates to updateParentFolio
      if (req.body.is_parentfolio) {
        return await updateParentFolioImpl(req, res, id);
      }

      // Laravel :329 — the generic path is the only branch that needs the
      // RESERVATION row (path id = reservation id). Folio-id payloads that
      // fell through every action branch would crash on `reservations` below,
      // so drop them here.
      if (!existing || existing.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // Laravel :314-324 validates `remark_room` as required. The Room grid can
      // only post that key when the user actually picked a tag, and ~3 of 4
      // unposted reservations have no remark-room type at all, so the strict
      // check rejected every ordinary save with "The remark room field is
      // required." before any change was applied. The tag is optional here:
      // the syncTypes loop further down already skips an empty value, and a
      // reservation that already has a remark keeps it (clearing it is a
      // separate explicit action).
      if (total === undefined || total === null || total === '') {
        badRequest(res, 'The total field is required.');
        return;
      }

      const reservation = existing;
      const folioRow = await prisma.folios.findUnique({ where: { id: reservation.folio_id } });
      if (!folioRow) { notFound(res, 'Not Found'); return; }

      const dayStart = new Date(new Date(reservation.date).toISOString().slice(0, 10) + 'T00:00:00.000Z');
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      // Laravel :333-344 — target room availability for this night
      const checkRoomId = room_id != null && room_id !== '' ? BigInt(room_id) : null;
      if (checkRoomId != null) {
        const [availHolds, woCount, overlapping] = await Promise.all([
          prisma.room_availabilities.count({ where: { deleted_at: null, room_id: Number(checkRoomId), date: { gte: dayStart, lt: dayEnd } } }),
          prisma.work_orders.count({ where: { deleted_at: null, status: 1, room_id: checkRoomId, date: { lte: dayStart }, OR: [{ end_date: null }, { end_date: { gt: dayEnd } }] } }),
          prisma.reservations.count({
            where: {
              date: { gte: dayStart, lt: dayEnd },
              folio_id: { not: folioRow.id },
              deleted_at: null,
              folios: { is: { status_reservation: { in: [0, 3] } } },
              OR: [{ room_id: checkRoomId }, { room_id_next: checkRoomId }],
            },
          }),
        ]);
        const roomRow = await prisma.rooms.findUnique({ where: { id: checkRoomId }, select: { room_status: true } });
        const blockedOrOoo = roomRow ? [3, 4].includes(roomRow.room_status) : true;
        if (availHolds > 0 || woCount > 0 || overlapping > 0 || blockedOrOoo) {
          badRequest(res, 'Room Already Used');
          return;
        }
      }

      // Laravel :345-362 — room-type availability when type changes
      const newRoomTypeId = room_type_id !== undefined && room_type_id !== null && room_type_id !== '' ? BigInt(room_type_id) : null;
      if (newRoomTypeId != null && Number(reservation.room_type_id) !== Number(newRoomTypeId)) {
        const roomsOfType = await prisma.rooms.findMany({ where: { room_type_id: newRoomTypeId, deleted_at: null, status: 1 } });
        const roomIdsOfType = roomsOfType.map((r) => r.id);
        const [heldRooms, woRooms] = await Promise.all([
          prisma.room_availabilities.findMany({ where: { deleted_at: null, room_id: { in: roomIdsOfType.map(Number) }, date: { gte: dayStart, lt: dayEnd } }, select: { room_id: true } }),
          prisma.work_orders.findMany({ where: { deleted_at: null, status: 1, room_id: { in: roomIdsOfType }, date: { lte: dayStart }, OR: [{ end_date: null }, { end_date: { gt: dayEnd } }] }, select: { room_id: true } }),
        ]);
        const excludedStatuses = new Set<number>([...heldRooms.map((h) => Number(h.room_id)), ...woRooms.map((w) => Number(w.room_id))]);
        const freeRooms = roomsOfType.filter((r) => ![3, 4].includes(r.room_status) && !excludedStatuses.has(Number(r.id)));
        const soldRows = await prisma.reservations.findMany({
          where: {
            date: { gte: dayStart, lt: dayEnd },
            folio_id: { not: folioRow.id },
            deleted_at: null,
            folios: { is: { status_reservation: { in: [0, 3] } } },
            OR: [{ room_type_id: newRoomTypeId }, { room_type_id_next: newRoomTypeId }],
          },
          select: { room_id: true },
        });
        const soldRoomIds = new Set(soldRows.filter((s) => s.room_id != null && Number(s.room_id) > 0).map((s) => String(s.room_id)));
        const availableCount = freeRooms.filter((r) => !soldRoomIds.has(String(r.id))).length;
        if (availableCount <= 0) {
          badRequest(res, 'Room Type Already Used');
          return;
        }
      }

      // Laravel :364-371 — Sub-GIT cannot change rate code
      const folioTypeLower = String(folioRow.type_reservation ?? '').toLowerCase();
      const isSubGit = folioTypeLower === 'git' && Number(folioRow.parent ?? 0) !== 0;
      if (isSubGit && Number(reservation.rate_id) !== Number(rate_id)) {
        badRequest(res, 'Cannot change rate Code');
        return;
      }

      // ── Prefetch everything the night loop needs, once ───────────────────
      // buildItemUpdateData used to re-query the rate, both code posts, the
      // property tax flag, the night count, the promo list and the name mirrors
      // for EVERY night it touched. A 30-night "This Night and Following Nights"
      // save fired ~450 sequential round-trips, which is what surfaced to the user
      // as "Error saat save this night and the following nights".
      const recalcAmounts = req.body.is_calculate === true || req.body.is_calculate === undefined;
      const rateRow = await prisma.rates.findUnique({ where: { id: BigInt(rate_id) } });
      const codePost = rateRow?.code_post_id
        ? await prisma.code_posts.findUnique({ where: { id: BigInt(rateRow.code_post_id) } })
        : null;
      const codePostExtraBed = rateRow?.code_post_extra_bed_id
        ? await prisma.code_posts.findUnique({ where: { id: BigInt(rateRow.code_post_extra_bed_id) } })
        : null;
      // Laravel CodePost::calculate: property.is_tax=1 => inclusive (input is gross)
      const propRow: any = await prisma.properties.findUnique({ where: { id: folioRow.property_id }, select: { is_tax: true } });
      const isTaxInc = Number(propRow?.is_tax) === 1 || propRow?.is_tax === true;

      const pricing: Record<string, any> = {};
      if (recalcAmounts && codePost) {
        const flags = {
          tax: codePost.tax ?? false,
          tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
          local_tax: codePost.local_tax ?? false,
          local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
          service_charge: codePost.service_charge ?? false,
          service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
          service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
          tax_include_local_tax: codePost.tax_include_local_tax ?? false,
        };
        const nights = await prisma.reservations.count({ where: { folio_id: folioRow.id, deleted_at: null } });
        const promos: PromoLike[] = folioRow.promo_code
          // @ts-ignore
          ? await findPromosForNight(prisma, BigInt(rate_id), dayStart, nights, String(folioRow.promo_code))
          : [];
        // `total` must never reach Number() unguarded. It arrives from the Room grid
        // and has been seen as a de-DE formatted string, as a plain number, and (before
        // the reservationBn Decimal fix) as a serialised Decimal object. Number() of
        // the latter two edge cases is NaN, NaN propagated through calculateCodePost
        // into every money column, and Prisma rejected the whole update.
        const baseAmount = toFiniteMoney(total, toFiniteMoney(existing.total, 0));
        const amountNet = applyPromoDiscounts(baseAmount, promos);
        const calc = calculateCodePost(flags as any, amountNet, isTaxInc);
        Object.assign(pricing, {
          amount: toFiniteMoney(calc.amount, baseAmount),
          service_charge: toFiniteMoney(calc.service, 0),
          pb1: toFiniteMoney(calc.pb1, 0),
          tax3: toFiniteMoney(calc.tax3, 0),
          total: toFiniteMoney(calc.total, baseAmount),
        });
        if (codePostExtraBed) {
          const extraBedBase = toFiniteMoney(req.body.total_extra_bed, 0);
          const calcExtra = calculateCodePost(flags as any, extraBedBase, isTaxInc);
          Object.assign(pricing, {
            amount_extra_bed: toFiniteMoney(calcExtra.amount, extraBedBase),
            service_charge_extra_bed: toFiniteMoney(calcExtra.service, 0),
            pb1_extra_bed: toFiniteMoney(calcExtra.pb1, 0),
            tax3_extra_bed: toFiniteMoney(calcExtra.tax3, 0),
            total_extra_bed: toFiniteMoney(calcExtra.total, extraBedBase),
          });
        }
      } else if (recalcAmounts) {
        // Laravel :388-390 sets data.total = floatval(request.total) before the code-post
        // branch, so a rate without a code post still saves the price shown on the grid.
        pricing.total = toFiniteMoney(total, toFiniteMoney(existing.total, 0));
        const extraBedPosted = req.body.total_extra_bed;
        if (extraBedPosted !== undefined && extraBedPosted !== null && extraBedPosted !== '') {
          pricing.total_extra_bed = toFiniteMoney(extraBedPosted, toFiniteMoney((existing as any).total_extra_bed, 0));
        }
      }

      // Company as it will land on every touched night.
      const nextCompanyId = req.body.company_profile_id !== undefined
        ? (req.body.company_profile_id ? BigInt(req.body.company_profile_id) : null)
        : (reservation.company_profile_id ?? null);

      // Reservation::boot() updating hook re-mirrors the *_name columns on every
      // save, so a changed company / room type / room shows its new label in the
      // FIT Room grid instead of the stale (often NULL) one.
      const buildItemUpdateData = async (target: any = reservation): Promise<any> => {
        const d: any = {
          updated_by: userId,
          updated_at: new Date(),
          room_type_id: newRoomTypeId ?? reservation.room_type_id,
          company_profile_id: req.body.company_profile_id !== undefined ? nextCompanyId : (target.company_profile_id ?? reservation.company_profile_id),
          // `checkRoomId ?? null` wiped the room on every sibling night whenever
          // the form omitted room_id (e.g. editing only Company). Keep the row's
          // own room when the request does not carry one - Laravel never reaches
          // that branch because its grid always posts room_id.
          room_id: req.body.room_id !== undefined ? checkRoomId : target.room_id ?? null,
          rate_id: BigInt(rate_id),
          ...pricing,
        };
        return await withReservationNames(d);
      };

      // Room-status transitions when folio checked-in (= Laravel :429-444)
      if (folioRow.status_reservation === 0 && reservation.room_id) {
        const roomCurrent = await prisma.rooms.findUnique({ where: { id: reservation.room_id } });
        if (roomCurrent && roomCurrent.room_status === 1) {
          await prisma.rooms.update({ where: { id: roomCurrent.id }, data: { room_status: 0, maid_status: 1, updated_at: new Date() } });
          if (checkRoomId != null) {
            await prisma.rooms.updateMany({ where: { id: checkRoomId }, data: { room_status: 1, maid_status: 0, updated_at: new Date() } });
          }
        }
      }

      // ── Cascade to sibling nights (Laravel :514-667) with stopper semantics ──
      const oldRoomSig = `${Number(reservation.room_type_id)}-${Number(reservation.room_id)}`;
      const mode = apply_mode ?? 'following';
      let siblings: any[] = [];
      if (mode !== 'single') {
        siblings = await prisma.reservations.findMany({
          where: {
            folio_id: folioRow.id,
            deleted_at: null,
            is_posting: 0,
            id: { not: id },
            ...(mode === 'all' ? {} : { date: { gt: reservation.date } }),
          },
          orderBy: { date: 'asc' },
        });
      }

      // Resolve which nights the stopper rule lets us touch BEFORE writing, so a
      // collision on night 7 no longer leaves nights 1-6 already committed.
      const oldRoomSigOf = (row: any) => `${Number(row.room_type_id)}-${Number(row.room_id)}`;
      const candidates: any[] = [];
      for (const sib of siblings) {
        if (oldRoomSigOf(sib) !== oldRoomSig) break; // stopper: stop at the first different room
        candidates.push(sib);
      }

      if (checkRoomId != null && candidates.length > 0) {
        const from = candidates[0].date;
        const lastNight = candidates[candidates.length - 1].date;
        const rangeEnd = new Date(new Date(lastNight).toISOString().slice(0, 10) + 'T00:00:00.000Z');
        rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);
        // One range query instead of three per night: any hit inside the span
        // blocks the whole cascade, exactly as Laravel's per-night
        // AvailableRoom() would have.
        const [holds, wos, overlaps] = await Promise.all([
          prisma.room_availabilities.count({
            where: { deleted_at: null, room_id: Number(checkRoomId), date: { gte: new Date(from), lt: rangeEnd } },
          }),
          prisma.work_orders.count({
            where: { deleted_at: null, status: 1, room_id: checkRoomId, date: { lte: lastNight }, OR: [{ end_date: null }, { end_date: { gt: rangeEnd } }] },
          }),
          prisma.reservations.count({
            where: {
              date: { gte: new Date(from), lt: rangeEnd },
              folio_id: { not: folioRow.id },
              deleted_at: null,
              folios: { is: { status_reservation: { in: [0, 3] } } },
              OR: [{ room_id: checkRoomId }, { room_id_next: checkRoomId }],
            },
          }),
        ]);
        if (holds > 0 || wos > 0 || overlaps > 0) {
          badRequest(res, 'Room Already Used');
          return;
        }
      }

      // Laravel opens DB::beginTransaction() around this whole block (:326) and
      // rolls back on the "Room Already Used" branches. Without it a partial
      // cascade stayed committed and the next save re-applied on top of it.
      const payloads: Array<{ id: bigint; data: any }> = [
        { id, data: await buildItemUpdateData() },
      ];
      for (const sib of candidates) {
        payloads.push({ id: sib.id, data: await buildItemUpdateData(sib) });
      }

      await prisma.$transaction(
        payloads.map((p) => prisma.reservations.update({ where: { id: p.id }, data: p.data })),
        { timeout: 60000, maxWait: 15000 },
      );

      // ── Market Segment / Source must follow the change onto every night ──────
      // QA: "This Night and Following Nights" only moved the edited row, so the
      // other nights kept the old segment and source. Laravel has the same gap;
      // sync the pivot for every night we just wrote.
      //
      // resolveMarketSegments() also fills any segment the form left blank from
      // the Company's own market-segment pivot, so changing Company updates the
      // segment + source instead of only the company id.
      const companyChanged = req.body.company_profile_id !== undefined
        && String(nextCompanyId ?? '') !== String(reservation.company_profile_id ?? '');
      const segmentValues = await resolveMarketSegments(req.body, nextCompanyId, companyChanged);
      const rawRemark = (req.body as any).remark_room;
      const remarkRaw = rawRemark && typeof rawRemark === 'object' ? (rawRemark as any).value : rawRemark;
      let remarkTag: bigint | null = null;
      if (remarkRaw !== undefined && remarkRaw !== null && remarkRaw !== '' && String(remarkRaw) !== '0') {
        try { remarkTag = BigInt(remarkRaw); } catch { remarkTag = null; }
      }
      const typePayload: Record<string, bigint | null> = { ...segmentValues, remark_room: remarkTag };

      const allTypes = await prisma.types.findMany({ select: { id: true, group: true } });
      const typeIdsByGroup = new Map<string, bigint[]>();
      for (const t of allTypes) {
        if (!t.group) continue;
        const arr = typeIdsByGroup.get(t.group) || [];
        arr.push(t.id);
        typeIdsByGroup.set(t.group, arr);
      }

      // Drop any existing pivot row for the group BEFORE inserting. The old
      // findFirst() filtered on the `types` relation, so a row whose type was
      // soft-deleted (or whose model_type still carries legacy leading tabs)
      // was invisible to it - the create then hit model_has_types_pkey and the
      // whole Room-tab save failed with a 400. Matching on the type id set
      // instead of the relation sees every variant.
      for (const p of payloads) {
        for (const [key, typeId] of Object.entries(typePayload)) {
          if (typeId === undefined || typeId === null) continue;
          const group = key === 'source' ? 'source' : key.replace(/_/g, '-');
          const groupTypeIds = typeIdsByGroup.get(group) || [];
          await prisma.model_has_types.deleteMany({
            where: {
              model_id: p.id,
              model_type: { contains: 'Reservation' },
              type_id: { in: [...groupTypeIds, BigInt(typeId)] },
            },
          });
          await prisma.model_has_types.create({
            data: { type_id: BigInt(typeId), model_type: 'App\\Models\\Reservation', model_id: p.id },
          });
        }
      }

      // Availability push per unposted room type (= Laravel :674-687)
      const unpostedTypes = await prisma.reservations.findMany({
        where: { folio_id: folioRow.id, is_posting: 0, deleted_at: null },
        select: { room_type_id: true },
        distinct: ['room_type_id'],
      });
      for (const rt of unpostedTypes) {
        if (rt.room_type_id == null) continue;
        enqueueJob('sync-staah-room-availability', {
          propertyId: Number(folioRow.property_id),
          dateFrom: folioRow.check_in_date ? new Date(folioRow.check_in_date).toISOString().slice(0, 10) : undefined,
          dateTo: folioRow.check_out_date ? new Date(folioRow.check_out_date).toISOString().slice(0, 10) : undefined,
          roomTypeId: Number(rt.room_type_id),
        });
      }

      const updated = await prisma.reservations.findUnique({ where: { id } });
      success(res, reservationBn(updated), 'Success');
    } catch (err: any) {
      console.error('Reservation item update error:', err);
      error(res, err?.message || 'Failed to update reservation item', 400);
    }
  }

  
  // GET /api/reservations/create
  
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      if (!propertyId) {
        error(res, 'No property selected', 400);
        return;
      }

      // Run queries individually — one failure shouldn't kill everything
      let roomTypes: any[] = [];
      let companies: any[] = [];
      let types: any[] = [];
      let walkInCompany: any = null;
      let houseUseCompany: any = null;
      let property: any = null;
      let logAudit: any = null;

      const results = await Promise.allSettled([
        // 0: room_types (property-scoped)
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, property_id: propertyId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        // 1: companies (all properties — PHP doesn't scope this)
        prisma.company_profiles.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true, type_company: true, sync_mkt_segment_1: true, sync_mkt_segment_2: true, sync_mkt_segment_3: true, sync_mkt_segment_4: true, source: true },
          orderBy: { name: 'asc' },
        }),
        // 2: types for market segments, source, guest-status, cancellation
        prisma.types.findMany({
          where: {
            deleted_at: null,
            status: STATUS_ACTIVE,
            property_id: propertyId,
            group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source', 'guest-status', 'cancellation-reservation'] },
          },
          select: { id: true, name: true, group: true },
        }),
        // 3 + 4: walk-in / house-use company, resolved through the company-type tag.
        // The old lookup filtered `type_company: 'Walk In'`, but that column holds a
        // types.id (3085 = "Corporate"), so it never matched and the FIT form received
        // `master.is_walk_in = null` — leaving the company fields blank and making save
        // fail with "The company profile id field is required." Laravel resolves it via
        // CompanyProfile::scopeGetWalkIn / scopeGetHouseUse.
        Promise.resolve(null),
        Promise.resolve(null),
        // 5: property config
        prisma.properties.findUnique({
          where: { id: propertyId },
          select: { market_segment_1: true, market_segment_2: true, market_segment_3: true, market_segment_4: true, source: true, name: true, image: true, logo: true },
        }),
        // 6: business date from log_audits
        prisma.log_audits.findFirst({
          where: { deleted_at: null, property_id: Number(propertyId) },
          orderBy: { date: 'desc' },
          select: { date: true },
        }),
      ]);

      // Unpack settled results — log failures but continue with defaults
      const labels = ['room_types', 'companies', 'types', 'walkIn', 'houseUse', 'property', 'logAudit'];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`Reservation create - ${labels[i]} query failed:`, r.reason?.message || r.reason);
        }
      });

      if (results[0].status === 'fulfilled') roomTypes = results[0].value;
      if (results[1].status === 'fulfilled') companies = results[1].value;
      if (results[2].status === 'fulfilled') types = results[2].value;
      walkInCompany = await resolveSpecialCompanyProfile('walk-in');
      houseUseCompany = await resolveSpecialCompanyProfile('house-use');
      if (results[5].status === 'fulfilled') property = results[5].value;
      if (results[6].status === 'fulfilled') logAudit = results[6].value;

      const groupBy = (arr: any[], key: string) =>
        arr.reduce((acc, item) => {
          (acc[item[key]] = acc[item[key]] || []).push(item);
          return acc;
        }, {} as any);

      const grouped = groupBy(types, 'group');

      const statusGuests = (grouped['guest-status'] || []).map((t: any) => ({ value: Number(t.id), label: t.name }));
      const normalGuest = statusGuests.filter((s: any) => /normal/i.test(s.label));
      const otherGuest = statusGuests.filter((s: any) => !/normal/i.test(s.label));
      const sortedStatusGuests = [...normalGuest, ...otherGuest];

      // Business date from log_audits
      let businessDate: string;
      if (logAudit?.date) {
        const d = new Date(logAudit.date);
        businessDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().substring(0, 10);
      } else {
        // Fallback: today + 7h (WIB)
        const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
        businessDate = now.toISOString().substring(0, 10);
      }

      // Room data if room_id query param (PHP: ReservationController@create :239-263)
      let dataRoom: any = null;
      const roomId = req.query.room_id as string;
      if (roomId && roomId !== 'null' && roomId !== 'undefined' && /^\d+$/.test(roomId)) {
        try {
          const room = await prisma.rooms.findUnique({ where: { id: BigInt(roomId) } });
          if (room) {
            const roomType = room.room_type_id ? await prisma.room_types.findUnique({ where: { id: room.room_type_id } }) : null;
            const rateWalkIn = await prisma.rates.findFirst({
              where: { deleted_at: null, status: STATUS_ACTIVE, name: { contains: 'Walk In', mode: 'insensitive' } },
              orderBy: { module: 'desc' },
            });
            dataRoom = {
              room: { id: Number(room.id), name: room.name },
              room_type: { id: Number(room.room_type_id), name: roomType?.name ?? '' },
              rate: rateWalkIn ? { id: Number(rateWalkIn.id), name: rateWalkIn.name } : null,
            };
          }
        } catch (roomErr: any) {
          console.error('Reservation create - room lookup failed:', roomErr.message);
        }
      }

      const master: any = {
        statuses: [
          { value: STATUS_ACTIVE, label: 'Active' },
          { value: 0, label: 'Inactive' },
        ],
        status_reservations: [
          { value: STATUS_RESERVATION.reservation.code, label: STATUS_RESERVATION.reservation.name },
          { value: STATUS_RESERVATION.pending.code, label: STATUS_RESERVATION.pending.name },
          { value: STATUS_RESERVATION.check_in.code, label: STATUS_RESERVATION.check_in.name },
          { value: STATUS_RESERVATION.check_out.code, label: STATUS_RESERVATION.check_out.name },
          { value: STATUS_RESERVATION.cancel_reservation.code, label: STATUS_RESERVATION.cancel_reservation.name },
        ],
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        market_segment_1: (grouped['market-segment-1'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_2: (grouped['market-segment-2'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_3: (grouped['market-segment-3'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_4: (grouped['market-segment-4'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        source: (grouped['source'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        status_guests: sortedStatusGuests,
        reason_cancels: (grouped['cancellation-reservation'] || []).map((t: any) => ({ value: t.name, label: t.name })),
        typemulti: [
          { label: 'Normal', value: 'normal' },
          { label: 'Walk In', value: 'is_walk_in' },
          { label: 'House Use', value: 'is_house_use' },
          { label: 'Complimentary', value: 'complimentary' },
        ],
        legend: [
          { label: 'BAR', color: 'bg-secondary text-white rounded-md font-semibold' },
          { label: 'COMPANY APPLICABLE', color: 'bg-success text-white rounded-md font-semibold' },
          { label: 'APPLICABLE FOR ALL', color: 'bg-primary text-white rounded-md font-semibold' },
        ],
        business_date: businessDate,
        // `market_segment_*` / `source` are already `{ value, label }` from
        // resolveSpecialCompanyProfile (model_has_types), which is the shape
        // the step-4 selects and the save payload both expect.
        is_walk_in: walkInCompany ? { id: Number(walkInCompany.id), name: walkInCompany.name, market_segment_1: walkInCompany.market_segment_1, market_segment_2: walkInCompany.market_segment_2, market_segment_3: walkInCompany.market_segment_3, market_segment_4: walkInCompany.market_segment_4, source: walkInCompany.source } : null,
        is_house_use: houseUseCompany ? { id: Number(houseUseCompany.id), name: houseUseCompany.name, market_segment_1: houseUseCompany.market_segment_1, market_segment_2: houseUseCompany.market_segment_2, market_segment_3: houseUseCompany.market_segment_3, market_segment_4: houseUseCompany.market_segment_4, source: houseUseCompany.source } : null,
        markets: property ? {
          is_market_segment_1: property.market_segment_1,
          is_market_segment_2: property.market_segment_2,
          is_market_segment_3: property.market_segment_3,
          is_market_segment_4: property.market_segment_4,
          is_source: property.source,
        } : null,
      };

      if (dataRoom) {
        master.data_room = dataRoom;
      }

      success(res, [], 'Success', 200, { master });
    } catch (err: any) {
      console.error('Reservation create form error:', err?.message || err);
      error(res, 'Failed to load form data: ' + (err?.message || 'unknown'), 500);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // POST /api/reservations
  // ─────────────────────────────────────────────────────────────â”€
  static async store(req: Request, res: Response): Promise<void> {
    // store() has no prisma.$transaction (PHP wraps it in DB::transaction), so
    // a failure after the folio insert used to leave an orphan folio behind —
    // folio #47418 had 0 reservations after a failed create. Track what this
    // call creates and undo it best-effort in the catch.
    const createdFolios: bigint[] = [];
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      // PHP: ReservationController@store :315-324 — merge checkbokmulti/typemulti into body
      const body = req.body;
      if (Array.isArray(body.checkbokmulti) && body.checkbokmulti.length > 0) {
        for (const key of body.checkbokmulti) {
          body[key] = true;
        }
      }
      if (body.typemulti && typeof body.typemulti === 'object' && body.typemulti.value) {
        body[body.typemulti.value] = true;
      }

      const {
        type_reservation = 'fit',
        guest_profile_id,
        company_profile_id: bodyCompanyProfileId,
        first_name,
        last_name,
        email,
        telp,
        remark,
        remark_ins,
        booking_agent_id,
        contact_person_id,
        is_pending,
        cash_on_arrival,
        guaranted,
        is_walk_in,
        is_house_use,
        complimentary,
        is_compliment_tour_leader,
        print_status,
        use_allotment,
        is_incognito,
        check_in_date,
        check_out_date,
        reservation_list = [],
        room_reservation_list: roomReservationListRaw,
        room_reservation_list_raw,
        promo_code,
        dept_branch,
      } = body;

      // The GIT form posts `room_reservation_list`; older clients (and the
      // room-git table hook) post `room_reservation_list_raw`. Accept either so
      // the create is not rejected with "Room reservation list is required".
      const roomReservationSource = roomReservationListRaw ?? room_reservation_list_raw;
      const room_reservation_list = Array.isArray(roomReservationSource)
        ? roomReservationSource
        : Object.values(roomReservationSource || {});

      // Laravel ReservationController@store:619-660 resolves the company from the
      // company-type tag when the caller did not send one and the booking is a walk-in
      // or house-use, then merges that company's market segments / source into the
      // payload. Anything the form did send still wins.
      let company_profile_id = bodyCompanyProfileId;
      let specialCompanyMissing = false;
      if (!company_profile_id) {
        if (is_walk_in) {
          const walkIn = await resolveSpecialCompanyProfile('walk-in');
          if (walkIn) company_profile_id = walkIn.id;
          else specialCompanyMissing = true;
        } else if (is_house_use) {
          const houseUse = await resolveSpecialCompanyProfile('house-use');
          if (houseUse) company_profile_id = houseUse.id;
          else specialCompanyMissing = true;
        }
      }
      if (company_profile_id) {
        const specialSegments = await companyMarketSegments(company_profile_id);
        body.market_segment_1 = body.market_segment_1 ?? specialSegments.market_segment_1 ?? null;
        body.market_segment_2 = body.market_segment_2 ?? specialSegments.market_segment_2 ?? null;
        body.market_segment_3 = body.market_segment_3 ?? specialSegments.market_segment_3 ?? null;
        body.market_segment_4 = body.market_segment_4 ?? specialSegments.market_segment_4 ?? null;
        body.source = body.source ?? specialSegments.source ?? null;
      }

      // Validation — Laravel ReservationController@store :326-360 + :410-469.
      // Top-level check_in_date/check_out_date are only required in the `else`
      // branch (git / day-use / vr). For `fit` the dates live per-row inside
      // reservation_list and are validated there instead, so demanding them at
      // the top level 422'd every FIT create.
      const errors: Record<string, string[]> = {};
      if (!guest_profile_id) errors.guest_profile_id = ['The guest profile id field is required.'];
      if (!company_profile_id) {
        errors.company_profile_id = specialCompanyMissing
          ? [(is_walk_in ? 'Company Walk In' : 'Company House Use') + ' not found']
          : ['The company profile id field is required.'];
      }

      if (type_reservation === 'fit' || type_reservation === 'vr') {
        if (reservation_list.length === 0) {
          errors['reservation_list'] = ['Reservation list is required'];
        } else {
          reservation_list.forEach((row: any, idx: number) => {
            // Laravel marks only the two dates `required`. rate_id and
            // room_type_id are `nullable` there, so requiring them here would
            // reject payloads the reference accepts.
            if (!row?.check_in_date) {
              errors[`reservation_list.${idx}.check_in_date`] = ['Check in date is required'];
            }
            if (!row?.check_out_date) {
              errors[`reservation_list.${idx}.check_out_date`] = ['Check out date is required'];
            }
            if (row?.check_in_date && row?.check_out_date && new Date(row.check_out_date) <= new Date(row.check_in_date)) {
              errors[`reservation_list.${idx}.check_out_date`] = ['Check out date must be after check in date'];
            }
          });
        }
      } else {
        if (!check_in_date) errors.check_in_date = ['Check in date is required'];
        if (!check_out_date) errors.check_out_date = ['Check out date is required'];
        if (check_in_date && check_out_date && new Date(check_out_date) <= new Date(check_in_date)) {
          errors.check_out_date = ['Check out date must be after check in date'];
        }
        if (type_reservation === 'git') {
          if (room_reservation_list.length === 0) {
            errors.room_reservation_list = ['Room reservation list is required'];
          } else {
            room_reservation_list.forEach((row: any, idx: number) => {
              if (!row?.id) errors[`room_reservation_list.${idx}.id`] = ['Room type is required'];
            });
          }
        }
      }

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      // Resolve company_profile_id for walk-in / house-use. The pre-validation pass
      // above normally already filled company_profile_id, so these are a safety net;
      // both used to query `type_company: 'Walk In'`, which never matches because that
      // column stores a types.id.
      let resolvedCompanyId = company_profile_id ? BigInt(company_profile_id) : null;
      if (!resolvedCompanyId && is_walk_in) {
        const walkInCompany = await resolveSpecialCompanyProfile('walk-in');
        if (!walkInCompany) {
          badRequest(res, 'Company Walk In not found');
          return;
        }
        resolvedCompanyId = walkInCompany.id;
      }
      if (!resolvedCompanyId && is_house_use) {
        const houseUseCompany = await resolveSpecialCompanyProfile('house-use');
        if (!houseUseCompany) {
          badRequest(res, 'Company House Use not found');
          return;
        }
        resolvedCompanyId = houseUseCompany.id;
      }

      // Get guest profile data
      const guestProfile = await prisma.guest_profiles.findUnique({
        where: { id: BigInt(guest_profile_id) },
      });

      // Laravel ReservationController@store :677 - folio.title = guest's guest-title type name
      let guestTitleName: string | null = null;
      try {
        const titleLinks = await prisma.model_has_types.findMany({
          where: { model_type: { contains: 'GuestProfile' }, model_id: BigInt(guest_profile_id) },
          include: { types: true },
        });
        guestTitleName = (titleLinks.find((l: any) => l.types?.group === 'guest-title') as any)?.types?.name ?? null;
      } catch { guestTitleName = null; }

      // Get company name
      const companyProfile = resolvedCompanyId
        ? await prisma.company_profiles.findUnique({ where: { id: resolvedCompanyId } })
        : null;

      // Market segment follows the chosen company (PHP merges it from
      // `$company->type` for walk-in/house-use; here it is the general rule so
      // the form never asks the user to retype what the company already has).
      const marketSegments = await resolveMarketSegments(body, resolvedCompanyId);

      // Pricing inputs (Laravel Folio::saveReservation engine)
      const property = await prisma.properties.findUnique({ where: { id: propertyId! }, select: { is_tax: true } });
      const isTax = (property as any)?.is_tax === 1;
      // Laravel marks `reservation_list.*.rate_id` nullable (ReservationController:414),
      // and the GIT room grid rows carry no rate_id at all. `String(undefined)` is
      // the truthy string "undefined", so the old `r && r !== '0'` guard let it
      // through and `BigInt("undefined")` aborted the whole create with
      // "Cannot convert undefined to a BigInt".
      // GIT rows carry no rate_id: Laravel (ReservationController@store :773) prices
      // every sub-folio with the request-level `rate_id`, so load it too.
      const uniqueRateIds = [
        ...new Set(
          [...reservation_list.map((i: any) => i?.rate_id), ...room_reservation_list.map((i: any) => i?.rate_id), body.rate_id]
            .map((v: any) => (v === undefined || v === null ? '' : String(v)))
            .filter((r: string) => /^\d+$/.test(r) && r !== '0')
        ),
      ] as string[];
      const rateRows = uniqueRateIds.length
        ? await prisma.rates.findMany({
            where: { id: { in: uniqueRateIds.map((r) => BigInt(r)) } },
            select: { id: true, code_post_id: true, code_post_extra_bed_id: true, name: true },
          })
        : [];
      const rateByIdPricing = new Map<number, any>(rateRows.map((r) => [Number(r.id), r]));
      const codePostIds = [...new Set(rateRows.flatMap((r) => [r.code_post_id, r.code_post_extra_bed_id]).filter(Boolean))] as bigint[];
      const codePostRows = codePostIds.length
        ? await prisma.code_posts.findMany({ where: { id: { in: codePostIds } } })
        : [];
      const codePostById = new Map<number, any>(codePostRows.map((c) => [Number(c.id), c]));
      // Laravel trusts FE applied_promo objects verbatim (Folio.php:2469-2471).
      const bodyAppliedPromos: PromoLike[] = Array.isArray(req.body.applied_promo) ? req.body.applied_promo : [];

      async function promosForNight(rateIdStr: string | null | undefined, night: Date, getNight: number): Promise<PromoLike[]> {
        if (bodyAppliedPromos.length > 0) return bodyAppliedPromos;
        if (!promo_code || !rateIdStr || rateIdStr === '0') return [];
        const rateIdBig = BigInt(rateIdStr);
        // @ts-ignore
        return findPromosForNight(prisma, rateIdBig, night, getNight, promo_code);
      }

      // Determine reservation status
      let statusReservation = is_pending
        ? STATUS_RESERVATION.pending.id
        : STATUS_RESERVATION.reservation.id;

      // Calculate actual check-in/check-out. FIT carries the dates per-row inside
      // reservation_list (Laravel :410-421), so fall back to the earliest row
      // in / latest row out when the top-level fields are absent. Without this
      // `new Date(undefined)` would throw "Invalid Date" on create.
      let actualCheckIn = check_in_date ?? null;
      let actualCheckOut = check_out_date ?? null;

      if (!actualCheckIn || !actualCheckOut) {
        const rowDates = reservation_list
          .filter((r: any) => r?.check_in_date && r?.check_out_date)
          .map((r: any) => ({
            in: new Date(r.check_in_date).getTime(),
            out: new Date(r.check_out_date).getTime(),
          }));
        if (rowDates.length > 0) {
          actualCheckIn = actualCheckIn ?? new Date(Math.min(...rowDates.map((d: any) => d.in))).toISOString();
          actualCheckOut = actualCheckOut ?? new Date(Math.max(...rowDates.map((d: any) => d.out))).toISOString();
        }
      }

      if (!actualCheckIn || !actualCheckOut) {
        validationError(res, {
          check_in_date: ['Check in date is required'],
          check_out_date: ['Check out date is required'],
        });
        return;
      }

      if (type_reservation === 'day-use') {
        actualCheckOut = actualCheckIn; // Day-use: same date
      }

      // Generate folio number
      const folio = await createFolioWithRetry(propertyId!, type_reservation, (folioNumber) => ({        folio_number: folioNumber,
        parent: 0,
        property_id: propertyId!,
        type_reservation: type_reservation === 'day-use' ? 'fit' : type_reservation,
        guest_profile_id: guest_profile_id ? BigInt(guest_profile_id) : null,
        company_profile_id: resolvedCompanyId!,
        company_name: companyProfile?.name || null,
        first_name: guestProfile?.first_name || first_name || null,
        last_name: guestProfile?.last_name || last_name || null,
        title: guestTitleName,
        telp: guestProfile?.telp || telp || null,
        email: guestProfile?.email || email || null,
        remark: remark || null,
        remark_ins: remark_ins || null,
        dept_branch: dept_branch || null,
        booking_agent_id: booking_agent_id ? BigInt(booking_agent_id) : null,
        contact_person_id: contact_person_id ? BigInt(contact_person_id) : null,
        is_pending: is_pending || false,
        cash_on_arrival: cash_on_arrival || false,
        guaranted: guaranted || false,
        is_walk_in: is_walk_in || false,
        is_house_use: is_house_use || false,
        complimentary: complimentary || false,
        is_compliment_tour_leader: is_compliment_tour_leader || false,
        // Laravel mass-assigns every folio column the form posts, so the toggle
        // switches (Print, Use Allotment, Incognito) persisted at create. The
        // Node store() dropped them — the switches flipped back on reload.
        print_status: print_status === true || print_status === 1 || print_status === '1',
        use_allotment: use_allotment === true || use_allotment === 1 || use_allotment === '1',
        is_incognito: is_incognito === true || is_incognito === 1 || is_incognito === '1',
        is_day_use: type_reservation === 'day-use',
        is_virtual: type_reservation === 'vr',
        promo_code: promo_code || null,
        check_in_date: new Date(actualCheckIn),
        check_out_date: new Date(actualCheckOut),
        res_date: new Date(),
        res_time: new Date(),
        status: STATUS_ACTIVE,
        status_reservation: statusReservation,
        gender: guestProfile?.gender || null,
        birth_of_date: guestProfile?.birth_of_date || null,
        mobile_phone: guestProfile?.mobile_phone || null,
        nationality_id: guestProfile?.nationality_id || null,
        address: guestProfile?.address || null,
        city_id: guestProfile?.city_id || null,
        country_id: guestProfile?.country_id || null,
        postal_code: guestProfile?.postal_code || null,
        image: guestProfile?.image || null,
        card_type: guestProfile?.card_type || null,
        card_number: guestProfile?.card_number || null,
        card_expiry: guestProfile?.card_expiry || null,
        created_by: userId,
      }));
      createdFolios.push(folio.id);

      // Laravel ReservationController::store :720 — `$folio->syncTypes($request)`
      // writes the market segment / source onto the FOLIO pivot. The folio list
      // and `formatUpdate` read it from there, so without this the fields came
      // back blank on a freshly created reservation.
      await syncTypesPivot('App\\Models\\Folio', folio.id, marketSegments);

      // Create reservation items (per-night entries, priced via Folio::saveReservation parity)
      if (type_reservation !== 'git' && reservation_list.length > 0) {
        for (const item of reservation_list) {
          const itemCheckIn = new Date(item.check_in_date);
          let itemCheckOut = new Date(item.check_out_date);
          let nights = Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / (1000 * 60 * 60 * 24));

          // Day-use: Laravel Folio.php:494-501 forces +1 day on items so the night exists.
          if (type_reservation === 'day-use' && nights < 1) {
            itemCheckOut = new Date(itemCheckIn);
            itemCheckOut.setDate(itemCheckOut.getDate() + 1);
            nights = 1;
          }

          // Day-use: single priced night multiplied by quantity (Folio.php:2446-2448).
          const getNight = type_reservation === 'day-use' ? 0 : nights;
          const loopCount = type_reservation === 'day-use' ? 1 : nights;
          const rateIdBig = item.rate_id && String(item.rate_id) !== '0' ? BigInt(item.rate_id) : null;

          // Room resolution — Laravel Folio::saveReservation :2548-2584, the same
          // rule update() applies. A pending folio holds no room at all
          // (ReservationController::store :726-733 nulls room_id); otherwise a
          // room picked as `room_id_next` is promoted into `room_id` when the
          // item is `immediately` or the folio is still in `reservation`, so the
          // physical room attaches at reservation time and not only at check-in.
          const isPendingRsv = statusReservation === STATUS_RESERVATION.pending.id;
          const isImmediate = item.immediately === true || Number(item.immediately) === 1;
          const promoteRoom = isImmediate || statusReservation === STATUS_RESERVATION.reservation.id;
          let roomIdEff: bigint | null = isPendingRsv
            ? null
            : promoteRoom
              ? (item.room_id_next ? BigInt(item.room_id_next) : (item.room_id ? BigInt(item.room_id) : null))
              : (item.room_id ? BigInt(item.room_id) : null);
          let roomTypeIdEff: bigint | null = isPendingRsv
            ? null
            : promoteRoom
              ? (item.room_type_id_next ? BigInt(item.room_type_id_next) : (item.room_type_id ? BigInt(item.room_type_id) : null))
              : (item.room_type_id ? BigInt(item.room_type_id) : null);
          const roomNextIdEff = isPendingRsv || promoteRoom ? null : (item.room_id_next ? BigInt(item.room_id_next) : null);
          const roomTypeNextIdEff = isPendingRsv || promoteRoom ? null : (item.room_type_id_next ? BigInt(item.room_type_id_next) : null);

          // Laravel Folio::saveReservation :2512-2522 — `is_auto_assign_room`
          // picks a free room of the chosen room type at save time. The Node
          // port ignored the toggle, so "Auto Assign" creates were left with
          // no room attached until someone assigned manually.
          if (!roomIdEff && roomTypeIdEff) {
            const autoAssign = flagToInt(item.is_auto_assign_room) === 1;
            if (autoAssign) {
              const nightsTotal = Math.max(1, Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / 86400000));
              const candidates = await prisma.rooms.findMany({
                where: { property_id: propertyId!, room_type_id: roomTypeIdEff, deleted_at: null },
                orderBy: { id: 'asc' },
                take: 50,
              });
              for (const candidate of candidates) {
                // Room must be free across the WHOLE stay, checked per night.
                let freeForStay = true;
                for (let n = 0; n < nightsTotal; n++) {
                  const nd = new Date(itemCheckIn); nd.setDate(nd.getDate() + n);
                  const ndEnd = new Date(nd); ndEnd.setDate(ndEnd.getDate() + 1);
                  if (!(await availableRoom(prisma as any, candidate.id, nd, ndEnd, folio.id))) { freeForStay = false; break; }
                }
                if (freeForStay) {
                  roomIdEff = candidate.id;
                  break;
                }
              }
            }
          }

          for (let i = 0; i < loopCount; i++) {
            const nightDate = new Date(itemCheckIn);
            nightDate.setDate(nightDate.getDate() + i);

            const pricing = await priceNight({
              // @ts-ignore
              prisma,
              rateId: rateIdBig,
              roomTypeId: roomTypeIdEff,
              night: nightDate,
              getNight,
              adult: Number(item.adult || 1),
              child: Number(item.child || 0),
              quantity: type_reservation === 'day-use' ? Number(item.quantity || 1) : 1,
              isTax,
              rateCodePost: rateIdBig ? codePostById.get(Number(rateRows.find((r) => Number(r.id) === Number(rateIdBig))?.code_post_id ?? -1)) ?? null : null,
              promos: await promosForNight(item.rate_id ? String(item.rate_id) : null, nightDate, getNight),
            });

            // Extra-bed pricing (Folio.php:2454-2462 + 2490-2497):
            // RateExtraBedInclusive cost × add_bed, tax via rate.code_post_extra_bed.
            let ebAmount = 0, ebService = 0, ebPb1 = 0, ebTax3 = 0, ebTotal = 0;
            const addBedCount = Number(item.add_bed || 0);
            if (addBedCount > 0 && rateIdBig) {
              const extraBeds = await prisma.rate_extra_bed_inclusives.findMany({
                where: { rate_id: rateIdBig, deleted_at: null },
              });
              const ebBase = extraBeds.reduce((s, it) => s + Number(it.cost ?? 0) * addBedCount, 0);
              const ebPostId = rateRows.find((r) => Number(r.id) === Number(rateIdBig))?.code_post_extra_bed_id;
              const cpEb = ebPostId ? codePostById.get(Number(ebPostId)) : null;
              if (cpEb) {
                const calcEb = calculateCodePost(cpEb as any, ebBase, isTax);
                ebAmount = calcEb.amount; ebService = calcEb.service;
                ebPb1 = calcEb.pb1; ebTax3 = calcEb.tax3; ebTotal = calcEb.total;
              } else {
                ebAmount = ebBase; ebTotal = ebBase;
              }
            }

            const createdReservation = await prisma.reservations.create({
              data: await withReservationNames({
                property_id: propertyId!,
                folio_id: folio.id,
                // Folio::saveReservation :2539 stores the folio company on every
                // per-night row; the FIT Room grid reads Company from here.
                company_profile_id: item.company_profile_id ?? resolvedCompanyId,
                rate_id: rateIdBig,
                room_type_id: roomTypeIdEff,
                room_id: roomIdEff,
                room_type_id_next: roomTypeNextIdEff,
                room_id_next: roomNextIdEff,
                adult: intOr(item.adult, 1),
                child: intOr(item.child, 0),
                add_bed: intOr(item.add_bed, 0),
                // Per-item fields persisted by Laravel saveReservation (:2610-2633)
                eta: parseTimeLike(item.eta, nightDate),
                etd: parseTimeLike(item.etd, nightDate),
                is_24_hour: flagToInt(item.is_24_hour),
                package_id: item.package_id ? BigInt(item.package_id) : null,
                quantity: intOr(item.quantity, 1),
                quantity_extra_day_use: intOr(item.quantity_extra_day_use, 0),
                is_extra_day_use: item.is_extra_day_use === true || Number(item.is_extra_day_use) === 1 ? 1 : 0,
                check_in_date: new Date(item.check_in_date),
                check_out_date: itemCheckOut,
                date: nightDate,
                status_reservation: statusReservation,
                status: STATUS_ACTIVE,
                night: nights,
                amount: pricing.amount,
                amountt: pricing.amount,
                total: pricing.total,
                service_charge: pricing.service_charge,
                pb1: pricing.pb1,
                tax3: pricing.tax3,
                amount_extra_bed: ebAmount,
                service_charge_extra_bed: ebService,
                pb1_extra_bed: ebPb1,
                tax3_extra_bed: ebTax3,
                total_extra_bed: ebTotal,
                data: JSON.stringify({
                  rate_price: pricing.rate_price,
                  service: pricing.service_charge,
                  pb1: pricing.pb1,
                  tax3: pricing.tax3,
                  total: pricing.total,
                }),
                created_by: userId,
              }),
            });
            await syncReservationTypes(createdReservation.id, marketSegments);
          }
        }
      }

      // Ledger rebuild (Laravel Folio.php:2690-2734)
      await rebuildFolioLedgers(folio.id, propertyId!, resolvedCompanyId, guest_profile_id ? BigInt(guest_profile_id) : null);

      // GIT: create sub-folios per room type
      if (type_reservation === 'git' && room_reservation_list.length > 0) {
        let subIndex = 1;
        for (const roomItem of room_reservation_list) {
          // Both ids come straight off the room-git grid and are nullable in
          // practice. Guard BEFORE creating the sub-folio so a blank row is
          // skipped instead of aborting the create (BigInt(undefined)) or
          // leaving an orphan folio behind.
          if (!/^\d+$/.test(String(roomItem?.id ?? ''))) {
            console.warn('[reservation store] GIT room row without a room type id, skipped:', roomItem);
            continue;
          }
          const gitRateRaw = String(roomItem.rate_id ?? body.rate_id ?? '');
          const gitRateId = /^\d+$/.test(gitRateRaw) && gitRateRaw !== '0' ? BigInt(gitRateRaw) : null;
          const gitRoomTypeId = BigInt(String(roomItem.id));
          // Laravel ReservationController@store :752 - `for ($i = 0; $i < $value['qty']; $i++)`.
          // The room-git grid posts EVERY active room type; only the rows the user
          // actually typed a Qty into are meant to become rooms. The old
          // `Number(qty) > 0 ? qty : 1` fallback turned each untouched row into one
          // sub-folio, so a block where the guest booked 2 rooms of one type came
          // back with a sub-folio per room type in the hotel - and the Master Folio
          // room grid then showed that bogus qty back to the user. An empty /
          // zero / negative / non-numeric qty must create NOTHING.
          const qtyRaw = Number(roomItem.qty);
          const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 0;
          if (qty === 0) continue;
          for (let i = 0; i < qty; i++) {
            const subFolioNumber = `${folio.folio_number}/${String(subIndex).padStart(3, '0')}`;

            const subFolio = await prisma.folios.create({
              data: {
                folio_number: subFolioNumber,
                parent: folio.id,
                property_id: propertyId!,
                type_reservation: 'git',
                guest_profile_id: guest_profile_id ? BigInt(guest_profile_id) : null,
                company_profile_id: resolvedCompanyId!,
                company_name: companyProfile?.name || null,
                first_name: guestProfile?.first_name || first_name || null,
                last_name: guestProfile?.last_name || last_name || null,
                // Laravel copies every request column onto the sub-folio.
                title: guestTitleName,
                telp: guestProfile?.telp || telp || null,
                email: guestProfile?.email || email || null,
                remark_ins: remark_ins || null,
                dept_branch: dept_branch || null,
                booking_agent_id: booking_agent_id ? BigInt(booking_agent_id) : null,
                contact_person_id: contact_person_id ? BigInt(contact_person_id) : null,
                cash_on_arrival: cash_on_arrival || false,
                guaranted: guaranted || false,
                complimentary: complimentary || false,
                promo_code: promo_code || null,
                gender: guestProfile?.gender || null,
                birth_of_date: guestProfile?.birth_of_date || null,
                mobile_phone: guestProfile?.mobile_phone || null,
                nationality_id: guestProfile?.nationality_id || null,
                address: guestProfile?.address || null,
                city_id: guestProfile?.city_id || null,
                country_id: guestProfile?.country_id || null,
                postal_code: guestProfile?.postal_code || null,
                remark: remark || null,
                is_pending: is_pending || false,
                // Laravel copies every request column onto the sub-folio — the
                // toggles were dropped here, so a GIT block's children always
                // came back with cleared switches.
                print_status: print_status === true || print_status === 1 || print_status === '1',
                use_allotment: use_allotment === true || use_allotment === 1 || use_allotment === '1',
                is_incognito: is_incognito === true || is_incognito === 1 || is_incognito === '1',
                is_compliment_tour_leader: false,
                check_in_date: new Date(actualCheckIn),
                check_out_date: new Date(actualCheckOut),
                res_date: new Date(),
                // folios.res_time is a `timestamp without time zone` column in
                // Postgres, so Prisma rejects an "HH:mm" string
                // ("input contains invalid characters. Expected ISO-8601
                // DateTime"). Same value the parent folio already writes.
                res_time: new Date(),
                status: STATUS_ACTIVE,
                status_reservation: statusReservation,
                created_by: userId,
              },
            });
            createdFolios.push(subFolio.id);
            await syncTypesPivot('App\\Models\\Folio', subFolio.id, marketSegments);

            const gitCheckIn = new Date(actualCheckIn);
            const gitCheckOut = new Date(actualCheckOut);
            let gitNights = Math.ceil((gitCheckOut.getTime() - gitCheckIn.getTime()) / (1000 * 60 * 60 * 24));
            if (gitNights < 1) gitNights = 1;

            for (let n = 0; n < gitNights; n++) {
              const nightDate = new Date(gitCheckIn);
              nightDate.setDate(nightDate.getDate() + n);

              const pricing = await priceNight({
                // @ts-ignore
                prisma,
                rateId: gitRateId,
                roomTypeId: gitRoomTypeId,
                night: nightDate,
                getNight: gitNights,
                adult: Number(roomItem.adult || 1),
                child: Number(roomItem.child || 0),
                quantity: 1,
                isTax,
                rateCodePost: gitRateId ? codePostById.get(Number(rateRows.find((r) => Number(r.id) === Number(gitRateId))?.code_post_id ?? -1)) ?? null : null,
                promos: await promosForNight(roomItem.rate_id ? String(roomItem.rate_id) : null, nightDate, gitNights),
              });

              const gitReservation = await prisma.reservations.create({
                data: await withReservationNames({
                  property_id: propertyId!,
                  folio_id: subFolio.id,
                  company_profile_id: roomItem.company_profile_id ?? resolvedCompanyId,
                  rate_id: gitRateId,
                  room_type_id: gitRoomTypeId,
                  eta: parseTimeLike(body.eta, nightDate),
                  etd: parseTimeLike(body.etd, nightDate),
                  adult: intOr(roomItem.adult, 1),
                  child: intOr(roomItem.child, 0),
                  check_in_date: new Date(actualCheckIn),
                  check_out_date: new Date(actualCheckOut),
                  date: nightDate,
                  status_reservation: statusReservation,
                  status: STATUS_ACTIVE,
                  night: gitNights,
                  amount: pricing.amount,
                  amountt: pricing.amount,
                  total: pricing.total,
                  service_charge: pricing.service_charge,
                  pb1: pricing.pb1,
                  tax3: pricing.tax3,
                  data: JSON.stringify({
                    rate_price: pricing.rate_price,
                    service: pricing.service_charge,
                    pb1: pricing.pb1,
                    tax3: pricing.tax3,
                    total: pricing.total,
                  }),
                  created_by: userId,
                }),
              });
              await syncReservationTypes(gitReservation.id, marketSegments);
            }

            // Laravel Folio::saveReservation rebuilds ledgers per (sub)folio.
            await rebuildFolioLedgers(subFolio.id, propertyId!, resolvedCompanyId, guest_profile_id ? BigInt(guest_profile_id) : null);

            subIndex++;
          }
        }
        // Laravel happily stores a GIT parent with zero children when no row
        // carries a Qty, so keep that behaviour - but say so loudly, because the
        // user sees an empty block with no explanation on the folio screen.
        if (subIndex === 1) {
          console.warn(
            '[reservation store] GIT created with no rooms: every room_reservation_list row had qty 0/blank',
          );
        }
      }

      const message = is_pending
        ? 'Room is not available, reservation is Created as Pending'
        : 'Success';

      const result = bigintToNumber(folio);
      // Laravel Folio::saveReservation dispatches SyncStaahRoomAvailability (:2743)
      enqueueJob('sync-staah-room-availability', {
        propertyId: Number((folio as any).property_id ?? 0),
        dateFrom: (folio as any).check_in_date ? formatDate(new Date((folio as any).check_in_date)) : undefined,
        dateTo: (folio as any).check_out_date ? formatDate(new Date((folio as any).check_out_date)) : undefined,
      });
      success(res, result, message, 200);
    } catch (err: any) {
      // Best-effort rollback for this store attempt (matches PHP DB::rollBack).
      try {
        if (createdFolios.length > 0) {
          await prisma.reservations.deleteMany({ where: { folio_id: { in: createdFolios } } });
          await prisma.folios.deleteMany({ where: { id: { in: createdFolios } } });
        }
      } catch (rbErr: any) {
        // swallow rollback errors
      }
      error(res, `Failed to create reservation: ${err?.message || 'unknown'}`, 500);
    }
  }

  
  // GET /api/reservations/:id
  
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || idParam === 'null' || idParam === 'undefined' || !/^\d+$/.test(idParam)) {
        notFound(res, 'Reservation not found');
        return;
      }
      const id = BigInt(idParam);

      const folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' } },
          properties: { select: { name: true } },
        },
      });

      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      success(res, bigintToNumber(folio), 'Success', 200, { permission: { view: true }, search_data: { statuses: ['reservation', 'pending', 'check_in', 'check_out', 'cancel_reservation'] } } as any);
    } catch (err: any) {
      console.error('Reservation show error:', err);
      error(res, 'Failed to fetch reservation', 500);
    }
  }

  
  // GET /api/reservations/:id/edit
  
  // Replicates Laravel Folio::formatData (+ ReservationController@edit master) â€” GET /reservation/:id/update
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = new Date();
      const bdate = await AuthController.getBusinessDate(pid === 0n ? null : pid);

// Try find folio by id; if not found, fall back to reservations.id -> folio_id
      let folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          company_profiles_folios_company_profile_idTocompany_profiles: true,
          company_profiles_folios_booking_agent_idTocompany_profiles: true,
          reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, include: { room_types: true, rates: true } },
        },
      });

      if (!folio || folio.deleted_at) {
        // Fallback: id may be a reservation id; lookup its folio_id
        const resv = await prisma.reservations.findUnique({ where: { id, deleted_at: null }, select: { folio_id: true } });
        if (resv?.folio_id) {
          folio = await prisma.folios.findUnique({
            where: { id: resv.folio_id },
            include: {
              company_profiles_folios_company_profile_idTocompany_profiles: true,
              company_profiles_folios_booking_agent_idTocompany_profiles: true,
              reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, include: { room_types: true, rates: true } },
            },
          });
        }
      }

      if (!folio || folio.deleted_at) { notFound(res, 'Not Found'); return; }

      const [guestProfile, countryOf, countryNationality, cityOf, contactPerson] = await Promise.all([
        folio.guest_profile_id ? prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } }) : null,
        folio.country_id ? prisma.countries.findUnique({ where: { id: BigInt(folio.country_id) } }).catch(() => null) : null,
        folio.nationality_id ? prisma.countries.findUnique({ where: { id: BigInt(folio.nationality_id) } }).catch(() => null) : null,
        folio.city_id ? prisma.cities.findUnique({ where: { id: BigInt(folio.city_id) } }).catch(() => null) : null,
        folio.contact_person_id ? prisma.company_profile_contact_persons.findUnique({ where: { id: folio.contact_person_id } }).catch(() => null) : null,
      ]);

      const isParentGit = folio.type_reservation?.toLowerCase() === 'git' && Number(folio.parent) === 0;
      const isSubGit = folio.type_reservation?.toLowerCase() === 'git' && Number(folio.parent) !== 0;
      const isVr = folio.type_reservation === 'vr';
      const isCancel = folio.status_reservation === 2;
      const isCheckout = folio.status_reservation === 1;
      const isCheckin = folio.status_reservation === 0;

      // GIT parent: reservations come from first child folio (Laravel childFolio()->first())
      let reservations = folio.reservations;
      let childFolio: any = null;
      if (isParentGit) {
        childFolio = await prisma.folios.findFirst({
          where: { parent: id, deleted_at: null },
          orderBy: { id: 'asc' },
          include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, include: { room_types: true, rates: true } } },
        });
        if (childFolio) reservations = childFolio.reservations;
      }
      // Laravel Folio::formatAction check_in: parent GIT needs >=1 child folio with status reservation (3)
      const childReservationCount = isParentGit
        ? await prisma.folios.count({ where: { parent: id, deleted_at: null, status_reservation: 3 } })
        : 0;
      const reservationsMeta = isParentGit && childFolio ? childFolio : folio;

      // Folio::formatDataFrontDesk() -> message_bool =
      //   $this->message()->where('is_open', 1)->count() > 0
      const hasOpenMessage =
        (await prisma.messages.count({ where: { folio_id: id, is_open: true, deleted_at: null } })) > 0;

      const [typeLinks, roomRows, reservationTypeLinks] = await Promise.all([
        prisma.model_has_types.findMany({ where: { model_type: { contains: 'Folio' }, model_id: id }, include: { types: true } }),
        // Market segment / source live on the Reservation pivot (Folio.php:2645
        // `$reservation->syncTypes($request)`), not the Folio one, so the detail
        // form has to read them per item — reading only the folio pivot left
        // every field blank.
        prisma.model_has_types.findMany({
          where: {
            model_type: 'App\\Models\\Reservation',
            model_id: { in: reservations.map((r: any) => r.id) },
          },
          include: { types: true },
        }),
        prisma.rooms.findMany({
          where: {
            OR: [
              { id: { in: reservations.filter((r: any) => r.room_id).map((r: any) => r.room_id) } },
              { id: { in: reservations.filter((r: any) => r.room_id_next).map((r: any) => r.room_id_next) } },
            ],
          },
        }),
      ]);
      const roomMap = new Map(roomRows.map((r: any) => [Number(r.id), r]));

      // Per-reservation type lookup, keyed by reservation id then group.
      const resTypesById = new Map<string, any[]>();
      for (const l of reservationTypeLinks as any[]) {
        const k = String(l.model_id);
        const arr = resTypesById.get(k);
        if (arr) arr.push(l.types);
        else resTypesById.set(k, [l.types]);
      }
      const reservationType = (reservationId: any, group: string): any => {
        const t = (resTypesById.get(String(reservationId)) || []).find((x: any) => x?.group === group);
        return t ? { value: Number(t.id), label: t.name } : [];
      };

      const folioTypes = (group: string): any => {
        const t = typeLinks.find((l: any) => l.types?.group === group);
        return t?.types ? { value: Number(t.types.id), label: t.types.name } : [];
      };

      const [companies, roomTypes, types, property, contacts] = await Promise.all([
        prisma.company_profiles.findMany({ where: { deleted_at: null, status: STATUS_ACTIVE, property_id: pid }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.room_types.findMany({ where: { deleted_at: null, status: STATUS_ACTIVE, property_id: pid }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, property_id: pid, group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source', 'guest-status'] } },
          select: { id: true, name: true, group: true },
        }),
        prisma.properties.findUnique({ where: { id: pid }, include: { cities: true } }),
        prisma.company_profile_contact_persons.findMany({ where: { deleted_at: null, property_id: pid }, select: { id: true, name: true } }),
      ]);

      const uidCols = [
        'pb1_account_uid',
        'service_charge_account_uid',
        'tax_account_uid',
        'surcharge_account_uid',
        'advance_deposit_current_day_account_uid',
        'advance_deposit_previous_day_account_uid',
        'guest_ledger_current_day_account_uid',
        'guest_ledger_previous_day_account_uid',
        'day_use_item_code',
      ];
      const uidIds = uidCols.map((c: string) => (property as any)?.[c]).filter((v: any) => v != null).map((v: any) => BigInt(v));
      const codePosts = uidIds.length ? await prisma.code_posts.findMany({ where: { id: { in: uidIds } }, select: { id: true, name: true } }) : [];
      const cpMap = new Map(codePosts.map((c: any) => [Number(c.id), c]));
      const cpLabel = (v: any): { value: number | null; label: string } => {
        if (v == null) return { value: null, label: '' };
        const cp = cpMap.get(Number(v));
        return { value: Number(v), label: cp ? `${cp.description} (${cp.name})` : '' };
      };

      const contactMap = new Map(contacts.map((c: any) => [Number(c.id), c.name]));
      const roomCount = await prisma.rooms.count({ where: { property_id: pid, deleted_at: null } });

      const groupBy = (arr: any[], key: string) =>
        arr.reduce((acc, item) => { (acc[item[key]] = acc[item[key]] || []).push(item); return acc; }, {} as any);
      const grouped = groupBy(types, 'group');
      const toOpt = (arr: any[]) => arr.map((t: any) => ({ value: Number(t.id), label: t.name }));
      const statusGuestArr = toOpt(grouped['guest-status'] || []);
      const statusGuestSorted = [
        ...statusGuestArr.filter((i: any) => i.label.toLowerCase().includes('normal')),
        ...statusGuestArr.filter((i: any) => !i.label.toLowerCase().includes('normal')),
      ];
      const normalFallback = statusGuestArr.find((i: any) => i.label.toLowerCase().includes('normal')) || { value: 1, label: 'Normal' };

      // ---- master ----
      // `buildCardTypeOptions` is async (it reads the distinct card_type values
      // actually in use for this property). It used to be assigned without
      // `await`, so the promise went into the response body and serialised as
      // `{}` -- the folio detail form's Card Type select therefore had no
      // options and opened empty.
      const cardtypes = await buildCardTypeOptions(req.user?.lastProperty);
      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' },
        ],
        nrics: [
          { value: 0, label: 'KTP' }, { value: 1, label: 'Paspor' }, { value: 2, label: 'SIM' }, { value: 3, label: 'KITAS' },
        ],
        genders: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }],
        regions: ['Asia', 'Europe', 'Africa', 'America', 'Oceania', 'Polar'].map((r) => ({ value: r, label: r })),
        market_segment_1: toOpt(grouped['market-segment-1'] || []),
        market_segment_2: toOpt(grouped['market-segment-2'] || []),
        market_segment_3: toOpt(grouped['market-segment-3'] || []),
        market_segment_4: toOpt(grouped['market-segment-4'] || []),
        source: toOpt(grouped['source'] || []),
        status_reservations: Object.entries(STATUS_RESERVATION).map(([k, v]: any) => ({ value: v.id, label: v.name })),
        status_guests: statusGuestSorted,
        typemulti: [
          { label: 'Normal', value: 'normal' },
          { label: 'Walk In', value: 'is_walk_in' },
          { label: 'House Use', value: 'is_house_use' },
          { label: 'Complimentary', value: 'complimentary' },
        ],
        cardtypes,
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        legend: [
          { label: 'BAR', color: 'bg-secondary text-white rounded-md font-semibold' },
          { label: 'COMPANY APPLICABLE', color: 'bg-success text-white rounded-md font-semibold' },
          { label: 'APPLICABLE FOR ALL', color: 'bg-primary text-white rounded-md font-semibold' },
        ],
        markets: {
          id: Number(property?.id ?? 0),
          city: property?.cities?.name ?? null,
          name: property?.name ?? '',
          email: property?.email ?? null,
          telp: property?.telp ? String(property.telp) : null,
          is_tax: { value: !!property?.is_tax, label: property?.is_tax ? 'Yes' : 'No' },
          is_tax_exclude_restaurant: { value: !!property?.is_tax_exclude_restaurant, label: property?.is_tax_exclude_restaurant ? 'Yes' : 'No' },
          is_tax_exclude_room: { value: !!property?.is_tax_exclude_room, label: property?.is_tax_exclude_room ? 'Yes' : 'No' },
          pb1_account_uid: cpLabel(property?.pb1_account_uid),
          service_charge_account_uid: cpLabel(property?.service_charge_account_uid),
          tax_account_uid: cpLabel(property?.tax_account_uid),
          surcharge_account_uid: cpLabel(property?.surcharge_account_uid),
          advance_deposit_current_day_account_uid: cpLabel(property?.advance_deposit_current_day_account_uid),
          advance_deposit_previous_day_account_uid: cpLabel(property?.advance_deposit_previous_day_account_uid),
          guest_ledger_current_day_account_uid: cpLabel(property?.guest_ledger_current_day_account_uid),
          guest_ledger_previous_day_account_uid: cpLabel(property?.guest_ledger_previous_day_account_uid),
          day_use_item_code: cpLabel(property?.day_use_item_code),
          room_count: roomCount,
          is_market_segment_1: !!property?.market_segment_1,
          is_market_segment_2: !!property?.market_segment_2,
          is_market_segment_3: !!property?.market_segment_3,
          is_market_segment_4: !!property?.market_segment_4,
          is_source: !!property?.source,
          mandatory_check_in: await readPropertyMandatory(prisma, folio.property_id),
        },
      };

      // ---- reservation items (Laravel reservationListFormat grouped by rate-adult-child-add_bed-room_type-room) ----
      const roomStatusLabel = (code: any, name: string | null): string => {
        if (name) return name;
        const m = Object.values(ROOM_STATUSES).find((s: any) => s.id === Number(code));
        return m?.name ?? String(code ?? '');
      };
      const maidStatusLabel = (code: any): string => {
        const m = Object.values(MAID_STATUSES).find((s: any) => s.id === Number(code));
        return m?.name ?? '';
      };

      const isDayUse = !!folio.is_day_use;
      const lastReservation = reservations[reservations.length - 1] || null;
      const lastRoom = lastReservation?.room_id ? roomMap.get(Number(lastReservation.room_id)) : null;

      const base64Key = (r: any) => `${r.rate_id}-${r.adult}-${r.child}-${r.add_bed}-${r.room_type_id}-${r.room_id}`;
      const groupsMap = new Map<string, any[]>();
      reservations.forEach((r: any) => {
        const k = base64Key(r);
        if (!groupsMap.has(k)) groupsMap.set(k, []);
        groupsMap.get(k)!.push(r);
      });

      const reservationItems: any[] = [];
      groupsMap.forEach((rows: any[]) => {
        const first = rows[0];
        const checkInDate = reservationsMeta.check_in_date ? new Date(reservationsMeta.check_in_date).toISOString().slice(0, 10) : (first.date ? new Date(first.date).toISOString().slice(0, 10) : '');
        let checkOutDate: string;
        if (isParentGit || reservationsMeta.check_out_date) {
          checkOutDate = new Date(reservationsMeta.check_out_date).toISOString().slice(0, 10);
        } else if (groupsMap.size > 1) {
          const lastRow = rows[rows.length - 1];
          const d = lastRow.date ? new Date(lastRow.date) : new Date();
          d.setDate(d.getDate() + 1);
          checkOutDate = d.toISOString().slice(0, 10);
        } else {
          checkOutDate = folio.check_out_date ? new Date(folio.check_out_date).toISOString().slice(0, 10) : (first.date ? new Date(first.date).toISOString().slice(0, 10) : '');
        }

        let isPosting = first.is_posting;
        if (isCheckin && businessDate.toISOString().slice(0, 10) <= checkOutDate && businessDate.toISOString().slice(0, 10) > checkInDate) isPosting = -1;
        if (isVr) isPosting = -1;
        if (folio.is_day_use && isCheckin) isPosting = 0;

        const night = isDayUse ? 0 : Math.max(0, Math.round((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / 86400000));

        const rateLabel = first.rate_name ?? first.rates?.code ?? '';
        reservationItems.push({
          id: Number(first.id),
          eta: first.eta ? new Date(first.eta).toISOString().slice(0, 16) : null,
          etd: first.etd ? new Date(first.etd).toISOString().slice(0, 16) : null,
          ata: first.ata ? new Date(first.ata).toISOString().slice(0, 16) : null,
          atd: first.atd ? new Date(first.atd).toISOString().slice(0, 16) : null,
          adult: first.adult,
          child: first.child,
          add_bed: first.add_bed,
          reason: first.remark,
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          room_type_id: first.room_type_id ? { value: Number(first.room_type_id), label: first.room_type_name ?? first.room_types?.name ?? '' } : [],
          room_id: first.room_id ? { value: Number(first.room_id), label: first.room_name ?? roomMap.get(Number(first.room_id))?.name ?? '' } : [],
          room_type_id_origin: first.room_type_id ? { value: Number(first.room_type_id), label: first.room_types?.name ?? '' } : [],
          room_id_origin: { value: first.room_id ? Number(first.room_id) : 0, label: first.room_id ? (roomMap.get(Number(first.room_id))?.name ?? '') : '' },
          room_type_id_next: first.room_type_id_next ? { value: Number(first.room_type_id_next), label: '' } : [],
          room_id_next: first.room_id_next ? { value: Number(first.room_id_next), label: roomMap.get(Number(first.room_id_next))?.name ?? '' } : [],
          change_room: first.room_id_next != null,
          night,
          is_room_change: !!first.room_type_id_next,
          rate_id: first.rate_id ? { value: Number(first.rate_id), label: rateLabel } : [],
          is_posting: isPosting,
          date: first.date ? new Date(first.date).toISOString().slice(0, 10) : null,
          package_id: first.package_id ? { value: Number(first.package_id), time: null, label: '' } : [],
          quantity: first.quantity,
          quantity_extra_day_use: first.quantity_extra_day_use,
          is_extra_day_use: !!first.is_extra_day_use,
          is_24_hour: !!first.is_24_hour,
          // Read off this reservation's own pivot rows (see resTypesById above).
          market_segment_1: reservationType(first.id, 'market-segment-1'),
          market_segment_2: reservationType(first.id, 'market-segment-2'),
          market_segment_3: reservationType(first.id, 'market-segment-3'),
          market_segment_4: reservationType(first.id, 'market-segment-4'),
          source: reservationType(first.id, 'source'),
          remark_room: reservationType(first.id, 'remark-room'),
        });
      });

      // ---- revenue (Laravel Folio::getRevenue, Folio.php:1015-1105) ----
      //
      // Two shapes, and the parent-GIT one is NOT "the first child folio":
      //
      //   parent GIT : every child folio that is not cancelled contributes
      //                all of its reservations, and each date row is labelled
      //                `d/m/Y (NNN)` with the sub-folio suffix, so the block
      //                total matches the block's real size.
      //   otherwise  : this folio's own reservations, labelled `d/m/Y`.
      //
      // The old version read `childFolio` (childFolio()->first()) only, so a
      // GIT block of N rooms reported the price of a single room — the Finance
      // grid on the saved reservation disagreed with the on-check preview the
      // user had just seen.
      const revenueDate: any[] = [];
      let roomCharge = 0, pb1 = 0, service = 0, tax3 = 0;
      const pushRevenue = (r: any, dateLabel: string) => {
        const charge = Number(r.amount ?? 0);
        revenueDate.push({ date: dateLabel, charge: moneyFormat(charge) });
        roomCharge += charge;
        pb1 += Number(r.pb1 ?? 0);
        service += Number(r.service_charge ?? 0);
        tax3 += Number(r.tax3 ?? 0);
      };
      const revenueDayLabel = (d: any): string =>
        d ? new Date(d).toLocaleDateString('en-GB') : '';

      if (isParentGit) {
        // Laravel: $this->childFolio()->NotCancelReservation()->get()
        const childFoliosForRevenue = await prisma.folios.findMany({
          where: {
            parent: id,
            deleted_at: null,
            status_reservation: { not: STATUS_RESERVATION.cancel_reservation.id },
          },
          orderBy: { id: 'asc' },
          include: {
            reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' } },
          },
        });
        const parentNumber = String(folio.folio_number ?? '');
        for (const child of childFoliosForRevenue) {
          // Laravel: str_replace($this->folio_number.'/', '', $child->folio_number)
          const suffix = String(child.folio_number ?? '')
            .replace(`${parentNumber}/`, '')
            .trim();
          for (const r of child.reservations as any[]) {
            pushRevenue(r, suffix ? `${revenueDayLabel(r.date)} (${suffix})` : revenueDayLabel(r.date));
          }
        }
      } else {
        for (const r of reservations) pushRevenue(r, revenueDayLabel(r.date));
      }
      const revenue = {
        date: revenueDate,
        charge: [
          { label: 'Room Charge', value: moneyFormat(roomCharge) },
          { label: 'PB1', value: moneyFormat(pb1) },
          { label: 'Service Charge', value: moneyFormat(service) },
          { label: 'Total Room Charge', value: moneyFormat(roomCharge + pb1 + tax3 + service) },
        ],
      };

      // ---- balance (Laravel getBalance) ----
      const balanceWhere = { where: { deleted_at: null } as any };
      const balanceTargets = isParentGit
        ? [{ id, parent: true }, ...(await prisma.folios.findMany({ where: { parent: id, deleted_at: null }, select: { id: true } })).map((f: any) => ({ id: f.id, parent: false }))]
        : [{ id, parent: isSubGit }];
      const txns = await prisma.transactions.findMany({ where: { folio_id: { in: balanceTargets.map((t: any) => t.id) }, deleted_at: null }, select: { folio_id: true, model_type: true, type_amount: true, total: true } });
      let balance = 0;
      txns.forEach((t: any) => {
        const target = balanceTargets.find((x: any) => x.id === t.folio_id);
        if (!target) return;
        if (target.parent) {
          if (t.model_type?.includes('CompanyProfile')) {
            balance += t.type_amount === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0);
          }
        } else if (isSubGit) {
          if (t.model_type?.includes('GuestProfile')) {
            balance += t.type_amount === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0);
          }
        } else {
          balance += t.type_amount === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0);
        }
      });

      const guestName = (f: string | null, l: string | null, account?: string | null): string =>
        (f ?? '') !== '' || (l ?? '') !== '' ? `${f ?? ''} ${l ?? ''}`.trim() : (account ?? '');

      const statusReservationValue = folio.status_reservation === 3 && folio.is_request_cancel
        ? { value: folio.status_reservation, label: 'Request Cancel' }
        : { value: folio.status_reservation ?? 3, label: STATUS_RESERVATION_MAP[folio.status_reservation ?? 3] ?? 'Reservation' };

      // ---- actions (Laravel Folio::formatAction parity) ----
      // APP_URL is this API's own origin, and the action icons are served out of its
      // storage root. The old fallback pointed at port 8000 — the port the Laravel app
      // used before it moved to 8001 — so an unset APP_URL silently produced 404 icons
      // on every reservation row instead of an obvious config error.
      const appUrl = (process.env.APP_URL || 'http://localhost:3001').replace(/\/+$/, '');
      const actions = (() => {
        const mapAction = (list: typeof ACTION_RESERVATION) =>
          list.map((a) => ({ label: a.name, key: a.key, icon: appUrl + a.icon, line: a.line ?? false }));

        if (String(req.query.night_audit) === '1') {
          const nightKeys: Record<string, string[]> = {
            'room-change': ['confirm_change_room', 'edit', 'cancel_change_room'],
            'no-show': ['cancel_reservation', 'edit'],
            'over-stay': ['check_out', 'edit'],
          };
          const keys = nightKeys[String(req.query.audit_type ?? '')] ?? [];
          return mapAction(ACTION_RESERVATION.filter((a) => keys.includes(a.key)));
        }

        const statusCodeMap: Record<number, string> = { 0: 'check_in', 1: 'check_out', 2: 'cancel_reservation', 3: 'reservation', 4: 'in_house', 5: 'pending' };
        const statusCode = statusCodeMap[folio.status_reservation ?? 3] ?? 'default';
        const ruleKeys = ACTION_RULE[statusCode] ?? ACTION_RULE.default;
        const isFit = String(folio.type_reservation ?? '') === 'fit';
        const isGit = String(folio.type_reservation ?? '') === 'git';
        const isParentGit = isGit && Number(folio.parent) === 0;
        const isPending = folio.is_pending === true || folio.status_reservation === 5;
        const ownRes: any[] = folio.reservations ?? [];

        return mapAction(ACTION_RESERVATION.filter((a) => {
          if ((a.key === 'confirm_change_room' || a.key === 'cancel_change_room') && !ownRes.some((r: any) => r.room_id_next != null)) return false;
          if ((a.key === 'confirm_reservation' || a.key === 'cancel_reservation') && folio.status_reservation === 2) return false;
          if (a.key === 'un_check_in' && fmtLocalDate(folio.check_in_date) !== bdate) return false;
          if ((req.query.group === 'fit' || req.query.group === 'git') && ['check_in', 'check_out', 'un_check_in', 'un_check_out'].includes(a.key)) return false;
          if (isParentGit && a.key === 'assign_room') return false;
          if (a.key === 'move_reservation' && isGit) return false;
          if (a.key === 'copy_reservation' && !isFit) return false;
          if (a.key === 'check_in' && folio.status_reservation === 0) {
            if (!isParentGit) return false;
            if (childReservationCount === 0) return false;
          }
          if (isPending) return ['edit', 'cancel_reservation', 'confirm_reservation', 'copy_reservation', 'add_message', 'view_message'].includes(a.key);
          if (a.key === 'vr' || a.key === 'git' || a.key === 'fit') return a.key.toLowerCase() === String(folio.type_reservation ?? '').toLowerCase();
          return ruleKeys.includes(a.key);
        }));
      })();

      const data = {
        id: Number(folio.id),
        is_parent: Number(folio.parent) > 0 ? false : true,
        is_parent_git: isParentGit,
        is_sub_git: isSubGit,
        is_vr: isVr,
        is_cancel: isCancel || isCheckout || folio.is_pending,
        is_checkin: isCheckin,
        is_early_checkout: folio.check_out_date ? businessDate.toISOString().slice(0, 10) < new Date(folio.check_out_date).toISOString().slice(0, 10) : false,
        is_has_auto_transfer: false,
        is_has_folio_auto_transfer: false,
        company_profile_id: folio.company_profile_id ? Number(folio.company_profile_id) : null,
        date_arrival: folio.date_arrival ? new Date(folio.date_arrival).toLocaleDateString('en-GB').replace(/\//g, '-') : null,
        reservation: {
          folio: folio.folio_number,
          status_reservation: statusReservationValue,
          company_id: { value: folio.company_profile_id ? Number(folio.company_profile_id) : null, label: folio.company_profiles_folios_company_profile_idTocompany_profiles?.name ?? null },
          room_status: lastRoom ? { value: Number(lastRoom.room_status), label: roomStatusLabel(lastRoom.room_status, lastReservation?.room_status_name) } : [],
          cash_on_arrival: !!folio.cash_on_arrival,
          guaranted: !!folio.guaranted,
          print_status: !!folio.print_status,
          use_allotment: !!folio.use_allotment,
          is_do_not_disturb: !!folio.is_do_not_disturb,
          is_incognito: !!folio.is_incognito,
          is_long_stay: !!folio.is_long_stay,
          is_compliment_tour_leader: !!folio.is_compliment_tour_leader,
          is_pending: !!folio.is_pending,
          res_date: folio.res_date ? new Date(folio.res_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '',
          res_time: folio.res_time ? new Date(folio.res_time).toISOString().slice(11, 16) : '00:00',
          cut_off_date: folio.check_in_date ? new Date(new Date(folio.check_in_date).getTime() - 86400000).toLocaleDateString('en-GB').replace(/\//g, '-') : '',
          booking_agent_id: folio.booking_agent_id ? { value: Number(folio.booking_agent_id), label: folio.booking_agent_id ? '' : null } : [],
          contact_person_id: folio.contact_person_id ? { value: Number(folio.contact_person_id), label: contactMap.get(Number(folio.contact_person_id)) ?? '' } : [],
          limit_1: folio.limit_1,
          limit_2: folio.limit_2,
          flight_or_car: folio.flight_or_car,
          loyalty_card: folio.loyalty_card,
          loyalty_card_number: folio.loyalty_card_number,
          booking_no: folio.booking_no,
          market_segment_1: folioTypes('market-segment-1'),
          market_segment_2: folioTypes('market-segment-2'),
          market_segment_3: folioTypes('market-segment-3'),
          market_segment_4: folioTypes('market-segment-4'),
          source: folioTypes('source'),
          remark: folio.remark,
          promo_code: folio.promo_code,
        },
        guest: {
          guest_name: guestName(guestProfile?.first_name ?? null, guestProfile?.last_name ?? null, guestProfile?.account),
          guest_profile_id: folio.guest_profile_id ? Number(folio.guest_profile_id) : null,
          // All three card fields read from the folio, with the guest profile as
          // the fallback. They used to be mixed -- `card_type` and `card_expiry`
          // from the folio, `card_number` from the guest profile -- so for a guest
          // whose folio had no card copied onto it the form showed an empty Card
          // Type next to a filled NRIC, and saving then wrote the blank back.
          // The profile wins when the folio has nothing, because that is where the
          // card is actually kept (guest_profiles is the master copy).
          card_type: { value: folio.card_type ?? guestProfile?.card_type ?? null, label: folio.card_type ?? guestProfile?.card_type ?? null },
          card_number: folio.card_number ?? guestProfile?.card_number ?? null,
          card_expiry: folio.card_expiry ?? guestProfile?.card_expiry ?? null,
          email: guestProfile?.email ?? null,
          status_profile: folioTypes('guest-status') || normalFallback,
          gender: folio.gender ? { value: folio.gender, label: folio.gender } : [],
          birth_of_date: guestProfile?.birth_of_date ? new Date(guestProfile.birth_of_date).toISOString().slice(0, 10) : null,
          telp: guestProfile?.telp,
          mobile_phone: guestProfile?.mobile_phone,
          nationality_id: { value: folio.nationality_id ?? null, label: countryNationality?.name ?? null },
          is_subscribe: !!folio.is_subscribe,
          is_do_not_contact: !!folio.is_subscribe,
          guest_stay: null,
          address: folio.address,
          city_id: { value: folio.city_id ?? null, label: cityOf?.name ?? null },
          country_id: { value: folio.country_id ?? null, label: countryOf?.name ?? null },
          postal_code: folio.postal_code,
          guest_status: folioTypes('guest-status') || normalFallback,
          image: folio.image,
        },
        special_instruction: {
          remark: String(folio.remark ?? ''),
          is_gh: !!folio.is_gh,
          check_in_instruction: String(folio.check_in_instruction ?? ''),
          check_out_instruction: String(folio.check_out_instruction ?? ''),
          posting_instruction: String(folio.posting_instruction ?? ''),
          remark_ins: folio.remark ?? null,
        },
        reservation_items: reservationItems,
        reservation_confirm: reservationItems.filter((r: any) => r.change_room),
        is_change_room: reservations.some((r: any) => r.room_id_next != null),
        balance: moneyFormat(balance),
        revenue,
          // Room status stays a plain string here; the edit form reads
          // `.label`, so keep both shapes consistent (see FE room_status branch).
          room_status: lastRoom
            ? { value: Number(lastRoom.room_status), label: roomStatusLabel(lastRoom.room_status, lastReservation?.room_status_name) }
            : [],
          // Clean/maid status from the attached room, as a coloured pill so the
          // detail screen shows the same pair the folio list does.
          room_clean_status: lastRoom
            ? [{ label: maidStatusLabel(lastRoom.maid_status), color: getColorMaid(Number(lastRoom.maid_status)), is_color: true }]
            : [],
        total_night: folio.check_in_date && folio.check_out_date ? Math.round((new Date(folio.check_out_date).getTime() - new Date(folio.check_in_date).getTime()) / 86400000) : 0,
        is_do_not_move: true,
        type_reservation: String(folio.type_reservation ?? '').toUpperCase(),
        guest_profile_id: folio.guest_profile_id ? Number(folio.guest_profile_id) : null,
        check_in_date: folio.check_in_date,
        check_out_date: folio.check_out_date,
        guest_name: guestName(folio.first_name, folio.last_name, guestProfile?.account),
        company: (folio.company_name ?? '') !== '' ? folio.company_name : folio.company_profiles_folios_company_profile_idTocompany_profiles?.name ?? null,
        actions,
        guest_status: folioTypes('guest-status') || normalFallback,
        guest_status_color: [
          {
            label: String((folioTypes('guest-status') || normalFallback).label ?? 'Normal').replace(/\s+/g, '-'),
            color: ['VIP', 'VVIP', 'VVVIP'].includes(String((folioTypes('guest-status') || normalFallback).label ?? '').toUpperCase()) ? 'bg-yellow' : 'bg-green',
            is_color: true,
          },
        ],
        stay: null,
        room: lastRoom?.name ?? null,
        room_type: lastReservation?.room_type_name ?? lastReservation?.room_types?.name ?? null,
        status_reservation: statusReservationValue.label,
        status_reservation_color: [{ label: String(statusReservationValue.label).replace(/\s+/g, '-'), color: '', is_color: true }],
        room_clean_status_color: lastRoom
          ? [{
              label: String(
                lastReservation?.maid_status_name
                || (Object.values(MAID_STATUSES).find((s: any) => s.id === Number(lastRoom.maid_status)) as any)?.name
                || '',
              ).replace(/\s+/g, '-'),
              color: getColorMaid(Number(lastRoom.maid_status)),
              is_color: true,
            }]
          : [],
        room_status_color: lastRoom
          ? [{
              label: String(roomStatusLabel(lastRoom.room_status, lastReservation?.room_status_name)).replace(/\s+/g, '-'),
              color: getColorRoom(Number(lastRoom.room_status)),
              is_color: true,
            }]
          : [],
        remark_folio: folio.remark,
        remark: folio.remark,
        remark_bool: !!(folio.remark !== '' || folio.posting_instruction !== '' || folio.check_out_instruction !== '' || folio.check_in_instruction !== ''),
        ign: !!folio.is_incognito,
        message_bool: hasOpenMessage,
        folio_number: folio.folio_number,
        formated_guest_profile: guestProfile ? `${guestProfile.account}, ${folio.first_name ?? ''} ${folio.last_name ?? ''}` : null,
        created_at: folio.created_at,
        updated_at: folio.updated_at,
        deleted_at: folio.deleted_at,
        created_by: folio.created_by ? Number(folio.created_by) : null,
        updated_by: folio.updated_by ? Number(folio.updated_by) : null,
        comm_code: folioTypes('comm-code'),
        status: { value: 1, label: 'Active' },
        sharer: '',
        aa: reservations[0]?.adult,
        cc: reservations[0]?.child,
        mandatory_check_in: mandatoryCheckInBlock(
          guestProfile,
          await readPropertyMandatory(prisma, folio.property_id),
        ),
      };

      success(res, data, 'Success', 200, { master });
    } catch (err: any) {
      console.error('Reservation edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  
  // PUT /api/reservations/:id
  
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.folios.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      const {
        guest_profile_id,
        company_profile_id,
        first_name,
        last_name,
        email,
        telp,
        mobile_phone,
        card_type,
        card_number,
        card_expiry,
        remark,
        remark_ins,
        booking_agent_id,
        contact_person_id,
        check_in_date,
        check_out_date,
        reservation_list,
        is_pending,
        status_reservation,
        dept_branch,
        cash_on_arrival,
        guaranted,
        print_status,
        use_allotment,
        is_do_not_disturb,
        is_incognito,
        is_long_stay,
      } = req.body;

      // Resolve company name
      let companyName = existing.company_name;
      if (company_profile_id && company_profile_id !== Number(existing.company_profile_id)) {
        const cp = await prisma.company_profiles.findUnique({ where: { id: BigInt(company_profile_id) } });
        companyName = cp?.name || companyName;
      }

      // Calculate new check-in/check-out from reservation_list
      let actualCheckIn = check_in_date || existing.check_in_date;
      let actualCheckOut = check_out_date || existing.check_out_date;
      if (reservation_list && reservation_list.length > 0) {
        const checkIns = reservation_list.map((r: any) => new Date(r.check_in_date).getTime());
        const checkOuts = reservation_list.map((r: any) => new Date(r.check_out_date).getTime());
        actualCheckIn = new Date(Math.min(...checkIns));
        actualCheckOut = new Date(Math.max(...checkOuts));
      }

      // Update folio
      const updateData: any = {
        updated_at: new Date(),
        updated_by: userId,
      };
      const isIdVal = (v: any) => v !== undefined && v !== null && v !== '' && v !== 0 && v !== '0';
      if (isIdVal(guest_profile_id)) updateData.guest_profile_id = BigInt(guest_profile_id);
      else if (guest_profile_id === null || guest_profile_id === '' || guest_profile_id === 0 || guest_profile_id === '0') updateData.guest_profile_id = null;
      if (isIdVal(company_profile_id)) updateData.company_profile_id = BigInt(company_profile_id);
      else if (company_profile_id === null || company_profile_id === '') updateData.company_profile_id = null;
      if (first_name !== undefined) updateData.first_name = first_name;
      if (last_name !== undefined) updateData.last_name = last_name;
      if (email !== undefined) updateData.email = email;
      if (telp !== undefined) updateData.telp = telp;
      // The form labels this field "Phone" but sends it as `mobile_phone`
      // (see ActSv in reservation-fit/form/index.tsx). Without this line the
      // value was loaded into the form, sent on save, and then silently dropped,
      // so Phone never persisted from the reservation screen.
      if (mobile_phone !== undefined) updateData.mobile_phone = mobile_phone;
      // Card fields are mirrored to the guest profile as well (see the guestPatch
      // block below). They were previously only preloaded, never written, so a
      // Card Type / NRIC typed on the reservation screen was discarded on save
      // and the profile kept showing its own -- which is why the two screens
      // disagreed about the same guest's ID.
      if (card_type !== undefined) updateData.card_type = card_type;
      if (card_number !== undefined) updateData.card_number = card_number;
      if (card_expiry !== undefined) updateData.card_expiry = card_expiry;
      if (remark !== undefined) updateData.remark = remark;
      if (remark_ins !== undefined) updateData.remark_ins = remark_ins;
      if (booking_agent_id !== undefined) updateData.booking_agent_id = booking_agent_id ? BigInt(booking_agent_id) : null;
      if (contact_person_id !== undefined) updateData.contact_person_id = contact_person_id ? BigInt(contact_person_id) : null;
      if (companyName !== undefined) updateData.company_name = companyName;
      if (actualCheckIn) updateData.check_in_date = new Date(actualCheckIn);
      if (actualCheckOut) updateData.check_out_date = new Date(actualCheckOut);
      if (is_pending !== undefined) {
        updateData.is_pending = !!is_pending;
        if (is_pending) {
          updateData.status_reservation = STATUS_RESERVATION.pending.id;
        } else if (updateData.status_reservation === undefined) {
          updateData.status_reservation = STATUS_RESERVATION.reservation.id;
        }
      }
      if (status_reservation !== undefined) {
        // Frontend mengirim label ("Check In"), code ("check_in"), atau id (0). Normalisasi ke id.
        let sr: any = status_reservation;
        if (typeof sr === 'object' && sr !== null) sr = sr.value ?? sr.id;
        if (typeof sr === 'string' && !/^\d+$/.test(sr)) {
          const lower = sr.toLowerCase();
          const found = Object.values(STATUS_RESERVATION).find((s: any) =>
            s.code.toLowerCase() === lower || s.name.toLowerCase() === lower || lower.includes(s.name.toLowerCase())
          );
          sr = found ? found.id : (lower === 'request cancel' ? STATUS_RESERVATION.reservation.id : undefined);
        }
        if (sr !== undefined) updateData.status_reservation = Number(sr);
      }
      if (dept_branch !== undefined) updateData.dept_branch = dept_branch;
      if (cash_on_arrival !== undefined) updateData.cash_on_arrival = !!cash_on_arrival;
      if (guaranted !== undefined) updateData.guaranted = !!guaranted;
      if (print_status !== undefined) updateData.print_status = !!print_status;
      if (use_allotment !== undefined) updateData.use_allotment = !!use_allotment;
      if (is_do_not_disturb !== undefined) updateData.is_do_not_disturb = !!is_do_not_disturb;
      if (is_incognito !== undefined) updateData.is_incognito = !!is_incognito;
      if (is_long_stay !== undefined) updateData.is_long_stay = !!is_long_stay;

      await prisma.folios.update({ where: { id }, data: updateData });

      // GIT parent propagation — Laravel ReservationController::update
      // (:1604-1700). A parent GIT folio that moved its stay pushes the change
      // to the sub-folios the request selected (`sub_folio_selected`), or to
      // every child when none was picked. Without this a parent Extend/Move
      // saved the parent date while every child tab stayed untouched.
      const oldFolioCheckIn = existing.check_in_date ? new Date(existing.check_in_date) : null;
      const oldFolioCheckOut = existing.check_out_date ? new Date(existing.check_out_date) : null;
      const newFolioCheckIn = updateData.check_in_date ?? oldFolioCheckIn;
      const newFolioCheckOut = updateData.check_out_date ?? oldFolioCheckOut;
      if (
        String(existing.type_reservation ?? '').toLowerCase() === 'git' &&
        oldFolioCheckIn && oldFolioCheckOut && newFolioCheckIn && newFolioCheckOut
      ) {
        const dayDiff = (a: Date, b: Date) =>
          Math.round((new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24));
        const shiftFrontDays = Math.max(0, dayDiff(oldFolioCheckIn, newFolioCheckIn)); // newCheckIn earlier
        const shiftBackDays = Math.max(0, dayDiff(newFolioCheckOut, oldFolioCheckOut)); // newCheckOut later
        if (shiftFrontDays > 0 || shiftBackDays > 0) {
          const subFolioRequested = Array.isArray((req.body as any)?.sub_folio_selected)
            ? (req.body as any).sub_folio_selected
            : null;
          const subFolios = subFolioRequested
            ? subFolioRequested.map((v: any) => BigInt(v))
            : await prisma.folios.findMany({
                where: { parent: id, deleted_at: null },
                select: { id: true },
              }).then((rows: any[]) => rows.map((r) => r.id));
          for (const subId of subFolios) {
            try {
              await shiftGitSubFolioStay(subId, shiftFrontDays, shiftBackDays);
            } catch (err: any) {
              console.error('GIT sub-folio date propagation failed:', err);
              res.status(400).json({ code: 400, message: err?.message ?? 'Sub-folio date propagation failed' });
              return;
            }
          }
        }
      }

      // Mirror the guest fields onto `guest_profiles`.
      //
      // The folio keeps its own copy of first_name / last_name / telp / email,
      // but every screen that renders "Guest Name" for a folio reads
      // `guestProfile.first_name` (see the `guest` block in this file's show
      // formatter). So editing the name on the reservation screen updated the
      // folio and then appeared to revert on reload, and the guest profile page
      // never saw the change either.
      //
      // Only fields actually present in the payload are written, so this stays a
      // no-op for callers that do not send guest data. The reference copies the
      // other way round (guest -> folio); doing both keeps the two screens in
      // agreement, which is what the user expects from editing either one.
      const guestProfileId = updateData.guest_profile_id ?? existing.guest_profile_id;
      const guestChanged = guestProfileId && guestProfileId !== existing.guest_profile_id;

      // When the guest profile changes, mirror first_name/last_name onto the
      // folio even if the FE didn't send them — otherwise the folio listing
      // keeps showing the old Guest Name (reads folio.first_name/last_name first,
      // falls back to guest_profiles only when both are blank).
      let resolvedFirstName = first_name;
      let resolvedLastName = last_name;
      if (guestChanged && (resolvedFirstName === undefined || resolvedLastName === undefined)) {
        const profile = await prisma.guest_profiles.findUnique({
          where: { id: guestProfileId },
          select: { first_name: true, last_name: true },
        });
        if (profile) {
          if (resolvedFirstName === undefined) resolvedFirstName = profile.first_name ?? null;
          if (resolvedLastName === undefined) resolvedLastName = profile.last_name ?? null;
        }
      }

      const guestPatch: any = {};
      if (resolvedFirstName !== undefined) {
        updateData.first_name = resolvedFirstName;
        guestPatch.first_name = resolvedFirstName;
      }
      if (resolvedLastName !== undefined) {
        updateData.last_name = resolvedLastName;
        guestPatch.last_name = resolvedLastName;
      }
      if (email !== undefined) {
        updateData.email = email;
        guestPatch.email = email;
      }
      if (telp !== undefined) {
        updateData.telp = telp;
        guestPatch.telp = telp;
      }
      if (mobile_phone !== undefined) {
        updateData.mobile_phone = mobile_phone;
        guestPatch.mobile_phone = mobile_phone;
      }
      if (card_type !== undefined) {
        updateData.card_type = card_type;
        guestPatch.card_type = card_type;
      }
      if (card_number !== undefined) {
        updateData.card_number = card_number;
        guestPatch.card_number = card_number;
      }
      if (card_expiry !== undefined) {
        updateData.card_expiry = card_expiry;
        guestPatch.card_expiry = card_expiry;
      }
      if (Object.keys(guestPatch).length > 0 && guestProfileId) {
        try {
          await prisma.guest_profiles.update({
            where: { id: BigInt(guestProfileId) },
            data: { ...guestPatch, updated_at: new Date(), updated_by: userId ?? undefined },
          });
        } catch (err: any) {
          // Never fail the reservation save because the guest mirror did not
          // stick (e.g. a concurrent soft-delete).
          console.error('Guest profile sync from reservation failed:', err?.message || err);
        }
      }

      // Laravel ReservationController::update :1564 — `$folio->syncTypes($request)`.
      // This was missing entirely, so a market segment / source chosen in the
      // edit form returned 200 and was then discarded on the next load.
      // Body values win; the company's own segment is the fallback (same
      // precedence as store()).
      const updCompanyId = (updateData.company_profile_id ?? existing.company_profile_id ?? null) as bigint | null;
      const updMarketSegments = await resolveMarketSegments(req.body, updCompanyId);
      await syncTypesPivot('App\\Models\\Folio', id, updMarketSegments);

      // Update reservation items if provided
      if (reservation_list && reservation_list.length > 0) {
        // Laravel Folio.php:2524-2530 / 2639-2642 / 2656-2664 — nights already
        // posted by the night audit are NEVER deleted or overwritten; only
        // unposted nights outside the new range are removed.
        const property = await prisma.properties.findUnique({ where: { id: existing.property_id }, select: { is_tax: true } });
        const isTaxUpd = (property as any)?.is_tax === 1;
        // VR/GIT rows carry no rate_id (nullable per Laravel ReservationController:1099).
        // `String(undefined)` yields the truthy "undefined" → `BigInt("undefined")` threw
        // and the whole update returned 500 "Failed to update reservation". Same guard as store().
        const updRateIds = [
          ...new Set(
            reservation_list
              .map((i: any) => i?.rate_id)
              .map((v: any) => (v === undefined || v === null ? '' : String(v)))
              .filter((r: string) => /^\d+$/.test(r) && r !== '0')
          ),
        ] as string[];
        const updRateRows = updRateIds.length
          ? await prisma.rates.findMany({
              where: { id: { in: updRateIds.map((r) => BigInt(r)) } },
              select: { id: true, code_post_id: true, name: true },
            })
          : [];
        const updCpIds = [...new Set(updRateRows.map((r) => r.code_post_id).filter(Boolean))] as bigint[];
        const updCpRows = updCpIds.length ? await prisma.code_posts.findMany({ where: { id: { in: updCpIds } } }) : [];
        const updCpById = new Map<number, any>(updCpRows.map((c) => [Number(c.id), c]));

        const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10);
        const oldRows = await prisma.reservations.findMany({ where: { folio_id: id, deleted_at: null } });

        for (const item of reservation_list) {
          const itemCheckIn = new Date(item.check_in_date);
          let itemCheckOut = new Date(item.check_out_date);
          let nights = Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / (1000 * 60 * 60 * 24));
          const itemIsDayUse = String(existing.type_reservation ?? '').toLowerCase() === 'day-use';
          if (nights < 1 || itemIsDayUse) {
            itemCheckOut = new Date(itemCheckIn);
            itemCheckOut.setDate(itemCheckOut.getDate() + 1);
            nights = Math.max(nights, 1);
          }
          const getNightUpd = itemIsDayUse ? 0 : nights;
          const rateIdUpd = item.rate_id && String(item.rate_id) !== '0' ? BigInt(item.rate_id) : null;
          const cpRow = rateIdUpd ? updCpById.get(Number(updRateRows.find((r) => Number(r.id) === Number(rateIdUpd))?.code_post_id ?? -1)) ?? null : null;

          // Room resolution — Laravel Folio::saveReservation :2548-2584.
          //
          // The edit form always posts the picked room as `room_id_next`
          // (`idpost: "room_id_next"` on the "Room" autocomplete). When the
          // guest has not checked in yet — i.e. the item is flagged
          // `immediately`, or the folio is still in `reservation` status —
          // Laravel promotes that pick straight into `room_id` and clears the
          // `_next` columns, so the physical room attaches immediately.
          // Writing `room_id_next` verbatim (as this handler used to) left
          // `room_id` null, which is why a room chosen in the form appeared to
          // save and then vanished: nothing was holding it.
          const folioStatusUpd = updateData.status_reservation ?? existing.status_reservation;
          const isImmediate = item.immediately === true || Number(item.immediately) === 1;
          const promoteRoom = isImmediate || folioStatusUpd === STATUS_RESERVATION.reservation.id;
          const effRoomId: bigint | null = promoteRoom
            ? (item.room_id_next ? BigInt(item.room_id_next) : (item.room_id ? BigInt(item.room_id) : null))
            : (item.room_id ? BigInt(item.room_id) : null);
          const effRoomTypeId: bigint | null = promoteRoom
            ? (item.room_type_id_next ? BigInt(item.room_type_id_next) : (item.room_type_id ? BigInt(item.room_type_id) : null))
            : (item.room_type_id ? BigInt(item.room_type_id) : null);
          // Once promoted there is no pending move left to record.
          const effRoomNextId = promoteRoom ? null : (item.room_id_next ? BigInt(item.room_id_next) : null);
          const effRoomTypeNextId = promoteRoom ? null : (item.room_type_id_next ? BigInt(item.room_type_id_next) : null);

          for (let i = 0; i < nights; i++) {
            const nightDate = new Date(itemCheckIn);
            nightDate.setDate(nightDate.getDate() + i);
            const key = dayKey(nightDate);

            const postedRow = oldRows.find((r) => r.is_posting === 1 && r.date && dayKey(r.date) === key && !r.deleted_at);
            if (postedRow) continue; // never touch audited nights

            const pricing = await priceNight({
              // @ts-ignore
              prisma,
              rateId: rateIdUpd,
              roomTypeId: effRoomTypeId,
              night: nightDate,
              getNight: getNightUpd,
              adult: Number(item.adult || 1),
              child: Number(item.child || 0),
              quantity: itemIsDayUse ? Number(item.quantity || 1) : 1,
              isTax: isTaxUpd,
              rateCodePost: cpRow,
              promos: [],
            });

            const rowData: any = {
              rate_id: rateIdUpd,
              rate_name: rateIdUpd ? updRateRows.find((r) => Number(r.id) === Number(rateIdUpd))?.name ?? null : null,
              room_type_id: effRoomTypeId,
              room_id: effRoomId,
              room_type_id_next: effRoomTypeNextId,
              room_id_next: effRoomNextId,
              adult: intOr(item.adult, 1),
              child: intOr(item.child, 0),
              add_bed: intOr(item.add_bed, 0),
              check_in_date: itemCheckIn,
              check_out_date: itemCheckOut,
              date: nightDate,
              status_reservation: updateData.status_reservation || existing.status_reservation,
              status: STATUS_ACTIVE,
              night: nights,
              amount: pricing.amount,
              amountt: pricing.amount,
              total: pricing.total,
              service_charge: pricing.service_charge,
              pb1: pricing.pb1,
              tax3: pricing.tax3,
              eta: parseTimeLike(item.eta, nightDate),
              etd: parseTimeLike(item.etd, nightDate),
              is_24_hour: flagToInt(item.is_24_hour),
              package_id: item.package_id ? BigInt(item.package_id) : null,
              quantity: intOr(item.quantity, 1),
              quantity_extra_day_use: intOr(item.quantity_extra_day_use, 0),
              is_extra_day_use: item.is_extra_day_use === true || Number(item.is_extra_day_use) === 1 ? 1 : 0,
              data: JSON.stringify({
                rate_price: pricing.rate_price,
                service: pricing.service_charge,
                pb1: pricing.pb1,
                tax3: pricing.tax3,
                total: pricing.total,
              }),
              updated_by: userId,
              updated_at: new Date(),
            };

            const existingRow = oldRows.find((r) => (!r.is_posting || r.is_posting === 0) && r.date && dayKey(r.date) === key && !r.deleted_at);
            if (existingRow) {
              await prisma.reservations.update({ where: { id: existingRow.id }, data: rowData });
            } else {
              await prisma.reservations.create({
                data: await withReservationNames({
                  ...rowData,
                  property_id: existing.property_id,
                  folio_id: id,
                  company_profile_id: rowData.company_profile_id ?? existing.company_profile_id ?? null,
                  created_by: userId,
                }) as any,
              });
            }
          }
        }

        // Remove unposted rows that fell outside the new stay window
        const newNightKeys = new Set<string>();
        for (const item of reservation_list) {
          const ciI = new Date(item.check_in_date);
          const coI = new Date(item.check_out_date);
          const n = Math.max(1, Math.ceil((coI.getTime() - ciI.getTime()) / 86400000));
          for (let i = 0; i < n; i++) {
            const d = new Date(ciI);
            d.setDate(d.getDate() + i);
            newNightKeys.add(dayKey(d));
          }
        }
        for (const row of oldRows) {
          if (row.deleted_at || (row.is_posting ?? 0) === 1) continue;
          if (row.date && !newNightKeys.has(dayKey(row.date))) {
            await prisma.reservations.update({
              where: { id: row.id },
              data: { deleted_at: new Date(), deleted_by: userId },
            });
          }
        }
      }

      // Room-status fixup on checked-in folios after dates changed
      // (Laravel Folio.php:2671-2688): due_out → occupied when extended past
      // business date; occupied → due_out when checkout lands on business date.
      if ((updateData.status_reservation ?? existing.status_reservation) === STATUS_RESERVATION.check_in.id) {
        const lastResv = await prisma.reservations.findFirst({
          where: { folio_id: id, deleted_at: null },
          orderBy: { date: 'desc' },
        });
        if (lastResv?.room_id) {
          const room = await prisma.rooms.findUnique({ where: { id: lastResv.room_id } });
          const bDateStr = await AuthController.getBusinessDate(existing.property_id ?? null);
          const coStr = existing.check_out_date ? dayKeyF(existing.check_out_date) : null;
          if (room && bDateStr && coStr) {
            if (room.room_status === ROOM_STATUSES.due_out.id && coStr > bDateStr) {
              await prisma.rooms.update({ where: { id: room.id }, data: { room_status: ROOM_STATUSES.occupied.id, updated_at: new Date() } });
            } else if (room.room_status === ROOM_STATUSES.occupied.id && coStr === bDateStr) {
              await prisma.rooms.update({ where: { id: room.id }, data: { room_status: ROOM_STATUSES.due_out.id, updated_at: new Date() } });
            }
          }
        }
      }

      const updated = await prisma.folios.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success', 200, { permission: { view: true }, search_data: { statuses: ['reservation', 'pending', 'check_in', 'check_out', 'cancel_reservation'] } } as any);
    } catch (err: any) {
      console.error('Reservation update error:', err);
      error(res, 'Failed to update reservation', 500);
    }
  }

  
  // DELETE /api/reservations/:id
  
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const folio = await prisma.folios.findUnique({ where: { id } });
      if (!folio) {
        notFound(res, 'Not Found');
        return;
      }

      await prisma.folios.update({
        where: { id },
        data: { deleted_at: new Date(), status: 0 },
      });

      // Also soft-delete child folios (GIT)
      await prisma.folios.updateMany({
        where: { parent: id, deleted_at: null },
        data: { deleted_at: new Date(), status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Reservation destroy error:', err);
      error(res, 'Failed to delete reservation', 500);
    }
  }

  
  // POST /api/reservations/:id/restore
  
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const folio = await prisma.folios.findUnique({ where: { id } });
      if (!folio) {
        notFound(res, 'Not Found');
        return;
      }

      await prisma.folios.update({
        where: { id },
        data: { deleted_at: null, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Reservation restore error:', err);
      error(res, 'Failed to restore reservation', 500);
    }
  }

  
  // GET /api/reservations/calendar
  
  static async calendar(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const start = req.query.start as string;
      const end = req.query.end as string;

      const where: any = {
        deleted_at: null,
        property_id: propertyId!,
        status_reservation: { notIn: [STATUS_RESERVATION.cancel_reservation.id] },
      };

      if (start && end) {
        where.check_in_date = { lte: new Date(end) };
        where.check_out_date = { gte: new Date(start) };
      } else {
        // Defensive default window so a bare request never returns the whole
        // table (was ~39MB). Calendar pages always send start/end.
        const from = new Date();
        from.setMonth(from.getMonth() - 2);
        const to = new Date();
        to.setFullYear(to.getFullYear() + 1);
        where.check_in_date = { lte: to };
        where.check_out_date = { gte: from };
      }

      const folios = await prisma.folios.findMany({
        where,
        include: {
          reservations: {
            where: { deleted_at: null },
            select: { room_name: true, room_type_name: true, rate_name: true, date: true },
          },
        },
        orderBy: { check_in_date: 'asc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation calendar error:', err);
      error(res, 'Failed to fetch calendar', 500);
    }
  }

  
  // GET /api/reservations/arrivals
  
  static async arrivals(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          property_id: propertyId!,
          is_pos_trx: false,
          status_reservation: STATUS_RESERVATION.reservation.id,
          check_in_date: { gte: today },
        },
        include: {
          reservations: { where: { deleted_at: null }, select: { room_name: true, room_type_name: true, rate_name: true } },
        },
        orderBy: { check_in_date: 'asc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation arrivals error:', err);
      error(res, 'Failed to fetch arrivals', 500);
    }
  }

  
  // GET /api/reservations/departures
  
  static async departures(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          property_id: propertyId!,
          is_pos_trx: false,
          status_reservation: STATUS_RESERVATION.check_in.id,
          check_out_date: { gte: today },
        },
        include: {
          reservations: { where: { deleted_at: null }, select: { room_name: true, room_type_name: true, rate_name: true } },
        },
        orderBy: { check_out_date: 'asc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation departures error:', err);
      error(res, 'Failed to fetch departures', 500);
    }
  }

  
  // GET /api/reservations/in-house
  
  static async inHouse(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          property_id: propertyId!,
          is_pos_trx: false,
          status_reservation: STATUS_RESERVATION.check_in.id,
        },
        include: {
          reservations: { where: { deleted_at: null }, select: { room_name: true, room_type_name: true, rate_name: true } },
        },
        orderBy: { check_in_date: 'desc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation in-house error:', err);
      error(res, 'Failed to fetch in-house reservations', 500);
    }
  }

  
  // GET /api/reservations/pending
  
  static async pending(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          property_id: propertyId!,
          is_pos_trx: false,
          status_reservation: STATUS_RESERVATION.pending.id,
        },
        include: {
          reservations: { where: { deleted_at: null }, select: { room_name: true, room_type_name: true, rate_name: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation pending error:', err);
      error(res, 'Failed to fetch pending reservations', 500);
    }
  }

  
  // POST /api/reservations/on-check
  
  static async onCheck(req: Request, res: Response): Promise<void> {
    try {
      const { room_reservation_list, check_in_date, check_out_date, rate_id } = req.body;

      if (!room_reservation_list || !check_in_date || !check_out_date) {
        // Name the field that is actually absent instead of listing all three.
        // "all three are required" was useless in the field: the caller always
        // had the dates on screen, so the message sent everyone hunting for a
        // problem that was never there.
        const missing = [
          !room_reservation_list ? 'room_reservation_list' : null,
          !check_in_date ? 'check_in_date' : null,
          !check_out_date ? 'check_out_date' : null,
        ].filter(Boolean);
        const brief = (v: any) =>
          v === undefined ? 'undefined' : v === null ? 'null' : `${typeof v}:${JSON.stringify(String(v)).slice(0, 60)}`;
        console.warn(
          `[on-check] rejected — missing ${missing.join(', ')}\n` +
            `    check_in_date  = ${brief(check_in_date)}\n` +
            `    check_out_date = ${brief(check_out_date)}\n` +
            `    room_reservation_list = ${Array.isArray(room_reservation_list) ? `array(${room_reservation_list.length})` : brief(room_reservation_list)}\n` +
            `    body keys: ${Object.keys(req.body ?? {}).join(', ')}`,
        );
        badRequest(res, `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required`);
        return;
      }

      const pid = BigInt(req.user?.lastProperty ?? 0);
      const roomList = Array.isArray(room_reservation_list) ? room_reservation_list : Object.values(room_reservation_list || {});
      const roomTypeIds = roomList
        .filter((item: any) => item?.id !== undefined && item?.id !== null && item?.id !== '')
        .map((item: any) => BigInt(item.id));
      if (roomTypeIds.length === 0) {
        badRequest(res, 'room_reservation_list is required');
        return;
      }

      // Batch availability: one query for all reserved rooms + all rooms across requested types.
      const [reservedRoomRows, allRoomRows] = await Promise.all([
        prisma.reservations.findMany({
          where: {
            property_id: pid,
            room_type_id: { in: roomTypeIds },
            date: { gte: new Date(check_in_date), lt: new Date(check_out_date) },
            deleted_at: null,
            folios: {
              deleted_at: null,
              status_reservation: { in: [STATUS_RESERVATION.reservation.id, STATUS_RESERVATION.check_in.id] },
            },
          },
          select: { room_type_id: true, room_id: true },
          distinct: ['room_id'],
        }),
        prisma.rooms.findMany({
          where: {
            property_id: pid,
            room_type_id: { in: roomTypeIds },
            deleted_at: null,
            status: STATUS_ACTIVE,
            is_physical: true,
          },
          select: { room_type_id: true, id: true },
        }),
      ]);

      const reservedByType = new Map<string, Set<number>>();
      for (const r of reservedRoomRows) {
        if (r.room_id === null) continue;
        const key = String(r.room_type_id);
        if (!reservedByType.has(key)) reservedByType.set(key, new Set<number>());
        reservedByType.get(key)!.add(Number(r.room_id));
      }
      const roomsByType = new Map<string, number[]>();
      for (const r of allRoomRows) {
        const key = String(r.room_type_id);
        if (!roomsByType.has(key)) roomsByType.set(key, []);
        roomsByType.get(key)!.push(Number(r.id));
      }

let allAvailable = true;
      const roomIds: Record<number, number[]> = {};

      // Laravel onCheck (ReservationController.php:2038-2051):
      //     if ($COUNT < $value['qty']) { $onCheck = false; }
      //     for ($i = 0; $i < $value['qty']; $i++) { $arr[] = [...]; }
      //
      // The room-git grid posts EVERY room type the rate covers, so a blank Qty
      // is the normal state for all but the rows the user actually filled in.
      // `Number(item.qty || 1)` turned each of those blank rows into one priced
      // night, so previewing 2 rooms of SUPERIOR TRIPLE BED also priced
      // SUPERIOR TWIN BED and SUPERIOR tWIN hOLIWOOD at 500.000 each — the
      // preview read 2.200.000 while the save stored the correct 1.200.000.
      // Same bug class as the one fixed in store(); `qty` means exactly what
      // the user typed, 0 included.
      const requestedQty = (item: any): number => {
        const raw = Number(item?.qty);
        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
      };

      for (const item of roomList) {
        if (item?.id === undefined || item?.id === null || item?.id === '') continue;
        const roomTypeId = BigInt(item.id);
        const reservedIds = reservedByType.get(String(roomTypeId)) || new Set<number>();
        const availableRoomIds = (roomsByType.get(String(roomTypeId)) || []).filter((id) => !reservedIds.has(id));
        roomIds[Number(item.id)] = availableRoomIds;

        // Only a Qty the user actually asked for can fail the check. Requiring
        // one room for a row they left blank made every block unsavable.
        if (requestedQty(item) > 0 && availableRoomIds.length < requestedQty(item)) {
          allAvailable = false;
        }
      }

      const fakeReservationList: any[] = [];
      for (const item of roomList) {
        if (item?.id === undefined || item?.id === null || item?.id === '') continue;
        const qty = requestedQty(item);
        for (let i = 0; i < qty; i++) {
          // Laravel onCheck (:2041-2051) maps the room-git row's `id` (the room
          // TYPE id) onto `room_type_id`. Passing the row through untouched left
          // roomTypeId null inside getCharge, so the per-night price shown after
          // a successful availability check was always the rate's default.
          fakeReservationList.push({
            rate_id,
            room_type_id: item.id,
            check_in_date,
            check_out_date,
            adult: item.adult,
            child: item.child,
            add_bed: 0,
          });
        }
      }
      if (fakeReservationList.length === 0) {
        // Nothing was requested, so there is nothing to price. getCharge()
        // answers 400 for an empty list; say so in the same shape the form
        // already handles instead of surfacing a raw validation error.
        badRequest(res, 'Enter a Qty for at least one room type before checking availability.');
        return;
      }
      const fakeReq = { ...req, body: { ...req.body, reservation_list: fakeReservationList } } as any;
      const fakeRes = {
        json: (payload: any) => {
          success(res, { check: allAvailable, roomIds, date: payload?.data?.date, charge: payload?.data?.charge }, 'Success');
        },
        status: (s: number) => fakeRes,
      } as any;
      await ReservationController.getCharge(fakeReq, fakeRes);
    } catch (err: any) {
      console.error('Reservation onCheck error:', err);
      error(res, 'Failed to check availability', 500);
    }
  }

  // PUT /reservation/data/{folio} — Laravel ReservationController@storeData (:2225-2272)
  static async storeData(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const folio = await prisma.folios.findUnique({ where: { id: BigInt(idParam) } });
      if (!folio || folio.deleted_at) { notFound(res, 'Not Found'); return; }
      const body = req.body || {};
      const type = String(body.type ?? '');
      if (!type) { badRequest(res, 'The type field is required.'); return; }

      const isParentGit = String(folio.type_reservation ?? '').toLowerCase() === 'git' && Number(folio.parent ?? 0) === 0;
      if (isParentGit && type === 'assign_room') {
        badRequest(res, 'Parent GIT cannot be Assign Room');
        return;
      }

      if (type === 'remark') {
        await prisma.folios.update({ where: { id: folio.id }, data: { remark: body.remark ?? null, updated_at: new Date() } });
      } else if (type === 'message') {
        // folios.message column doesn't exist — persist into data JSON like remark flows
        const dataJson = folio.data ? safeParseFolioData(folio.data) : {};
        await prisma.folios.update({ where: { id: folio.id }, data: { data: JSON.stringify({ ...dataJson, message: body.message ?? null }), updated_at: new Date() } });
      } else if (type === 'assign_room') {
        await prisma.reservations.updateMany({
          where: { folio_id: folio.id, deleted_at: null },
          data: { room_id_next: body.room_id_next ? BigInt(body.room_id_next) : null },
        });
      }
      await prisma.folios.update({ where: { id: folio.id }, data: { updated_at: new Date() } });
      const refreshed = await prisma.folios.findUnique({ where: { id: folio.id } });
      success(res, bigintToNumber(refreshed), 'Success', 200);
    } catch (err: any) { console.error('storeData error:', err); error(res, 'Failed to store folio data', 500); }
  }

  // PUT /reservation/changeRoom/{folio} — Laravel ReservationController@ChangeRoom (:1954-2162)
  static async changeRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const folioId = BigInt(idParam);
      const list: any[] = Array.isArray(req.body?.reservation_list) ? req.body.reservation_list : [];
      if (list.length === 0) { badRequest(res, 'The reservation list field is required.'); return; }

      for (const item of list) {
        if (!item.check_in_date || !item.check_out_date) { badRequest(res, 'The check in date field is required.'); return; }
      }

      const folioResvs = await prisma.reservations.findMany({
        where: { folio_id: folioId, deleted_at: null },
        include: { rates: true },
      });

      let sumPriceAll = 0; let gstAll = 0; let serviceAll = 0;
      const pricePerRateAll: any[] = [];

      for (const value of list) {
        const matched = folioResvs.filter((r) => r.check_in_date != null && r.check_in_date >= new Date(value.check_in_date) && r.check_in_date <= new Date(value.check_out_date));
        const first = matched[0];
        if (!first) continue;
        const getNight = Math.max(1, Math.ceil((new Date(value.check_out_date).getTime() - new Date(value.check_in_date).getTime()) / 86400000));
        const adult = Number(first.adult || 1);
        const child = Number(first.child || 0);

        let sumPriceR = 0; let gstR = 0; let serviceR = 0;
        const pricePerRateR: any[] = [];
        for (let i = 0; i < getNight; i++) {
          const night = new Date(new Date(value.check_in_date).getTime() + i * 86400000);
          const rr = await prisma.rate_rates.findFirst({
            where: { rate_id: first.rate_id ?? undefined, room_type_id: value.room_type_id ? BigInt(value.room_type_id) : undefined, date: night },
          });
          if (!rr) continue;
          let perRate = 0;
          // Laravel quirk (:2009-2029): uses one_adult/two_adult/extra_adult + `$rate->child`
          if (adult === 1) perRate += Number(rr.one_adult ?? 0);
          if (adult > 1) perRate += Number(rr.two_adult ?? 0);
          if (adult > 2) perRate += (adult - 2) * Number(rr.extra_adult ?? 0);
          if (child > 0) perRate += child * Number((rr as any).child ?? (rr as any).extra_child ?? 0);
          sumPriceR += perRate;
          pricePerRateR.push({ date: rr.date, charge: perRate });
        }

        const rate = first.rate_id ? await prisma.rates.findUnique({ where: { id: first.rate_id } }) : null;
        const codePost = rate?.code_post_id ? await prisma.code_posts.findUnique({ where: { id: BigInt(rate.code_post_id) } }) : null;
        if (codePost) {
          if (codePost.local_tax) gstR += sumPriceR * (Number(codePost.local_tax_percentage ?? 0) / 100);
          if (codePost.service_charge) serviceR += sumPriceR * (Number(codePost.service_charge_percentage ?? 0) / 100);
        }

        const fmt = (n: number) => n.toFixed(2);
        const chargeReservation: any[] = [
          { label: 'Room Charge', value: fmt(sumPriceR) },
          { label: `GST${codePost?.local_tax_percentage ?? ''}%`, value: fmt(gstR) },
          { label: `Service Charge${codePost?.service_charge_percentage ?? ''}%`, value: fmt(serviceR) },
        ];
        const totalReservation = sumPriceR + gstR + serviceR;
        chargeReservation.push({ label: 'Total Room Charge', value: fmt(totalReservation) });

        for (const values of matched) {
          await prisma.reservations.update({
            where: { id: values.id },
            data: {
              room_type_id: value.room_type_id ? BigInt(value.room_type_id) : values.room_type_id,
              room_id: value.room_id ? BigInt(value.room_id) : values.room_id,
              room_type_id_next: value.room_type_id_next ? BigInt(value.room_type_id_next) : null,
              room_id_next: value.room_id_next ? BigInt(value.room_id_next) : null,
              data: JSON.stringify({ date: pricePerRateR, charge: chargeReservation }),
              updated_at: new Date(),
            },
          });
        }

        sumPriceAll += sumPriceR; gstAll += gstR; serviceAll += serviceR;
        pricePerRateAll.push(...pricePerRateR);
      }

      const fmt2 = (n: number) => n.toFixed(2);
      const lastCodePostPct = { lt: '', sc: '' };
      const charge: any[] = [
        { label: 'Room Charge', value: fmt2(sumPriceAll) },
        { label: `GST${lastCodePostPct.lt}%`, value: fmt2(gstAll) },
        { label: `Service Charge${lastCodePostPct.sc}%`, value: fmt2(serviceAll) },
      ];
      const total = sumPriceAll + gstAll + serviceAll;
      charge.push({ label: 'Total Room Charge', value: fmt2(total) });

      const folioRow = await prisma.folios.findUnique({ where: { id: folioId } });
      const folioData = folioRow?.data ? safeParseFolioData(folioRow.data) : {};
      await prisma.folios.update({
        where: { id: folioId },
        data: { data: JSON.stringify({ ...folioData, date: pricePerRateAll, charge }), updated_at: new Date() },
      });

      const refreshed = await prisma.folios.findUnique({ where: { id: folioId } });
      success(res, bigintToNumber(refreshed), 'Success', 200);
    } catch (err: any) { console.error('ChangeRoom error:', err); error(res, err?.message || 'Failed to change room', 500); }
  }

  // PATCH /reservation-item/:id/restore — ReservationItemController@restore (:1195-1210)
  static async reservationItemRestore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.reservations.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.reservations.update({ where: { id: row.id }, data: { deleted_at: null, status: 0, updated_at: new Date() } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('reservation item restore error:', err); error(res, 'Failed to restore reservation item', 500); }
  }

  // DELETE /reservation-item/:id/delete — force delete (:1174-1188)
  static async reservationItemDeleteForce(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.reservations.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.reservations.delete({ where: { id: row.id } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('reservation item force-delete error:', err); error(res, 'Failed to delete reservation item', 500); }
  }

  // DELETE /reservation-item/:id — soft delete + inactive (:1156-1172)
  static async reservationItemDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.reservations.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.reservations.update({ where: { id: row.id }, data: { deleted_at: new Date(), status: 0, updated_at: new Date() } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('reservation item destroy error:', err); error(res, 'Failed to delete reservation item', 500); }
  }

  
  // POST /api/reservation/un-assign-room/:id — Laravel ReservationController@unAssignRoom (Folio-bound)
  // Clears room_id on every live reservation row of the folio.
  static async unassignRoomByFolio(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const folioId = BigInt(idParam);
      const userId = req.user?.id;

      const folio = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Folio Not Found');
        return;
      }

      await prisma.reservations.updateMany({
        where: { folio_id: folioId, deleted_at: null },
        data: { room_id: null, room_id_next: null, updated_at: new Date(), updated_by: userId },
      });

      enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });

      const updatedFolio = await prisma.folios.findUnique({
        where: { id: folioId },
        include: { reservations: { where: { deleted_at: null } } },
      });
      success(res, bigintToNumber(updatedFolio), 'Success');
    } catch (err: any) {
      console.error('Reservation unassign room (folio) error:', err);
      error(res, 'Failed to unassign room', 400);
    }
  }

  // POST /api/reservations/:id/unassign-room
  
  static async unassignRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const reservation = await prisma.reservations.findUnique({ where: { id } });
      if (!reservation || reservation.deleted_at) {
        notFound(res, 'Reservation Not Found');
        return;
      }

      const folio = await prisma.folios.findUnique({ where: { id: reservation.folio_id } });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Folio Not Found');
        return;
      }

      await prisma.reservations.updateMany({
        where: {
          folio_id: folio.id,
          deleted_at: null,
          date: { gte: reservation.date },
          room_type_id: reservation.room_type_id,
          status: 0
        },
        data: { room_id: null, updated_at: new Date(), updated_by: userId },
      });

      const updatedFolio = await prisma.folios.findUnique({
        where: { id: folio.id },
        include: { reservations: { where: { deleted_at: null } } },
      });

      success(res, bigintToNumber(updatedFolio), 'Success');
    } catch (err: any) {
      console.error('Reservation unassign room error:', err);
      error(res, 'Failed to unassign room', 400);
    }
  }

  
  // POST /api/reservations/:id/replicate
  
  static async replicate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;
      const propertyId = req.user?.lastProperty;

      const existing = await prisma.folios.findUnique({
        where: { id },
        include: { reservations: { where: { deleted_at: null } } },
      });

      if (!existing || existing.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // Generate new folio number (Laravel folioNumberFormat parity)
      const newFolio = await createFolioWithRetry(propertyId!, existing.type_reservation, (folioNumber) => ({
          folio_number: folioNumber,
          parent: BigInt(0),
          property_id: existing.property_id,
          type_reservation: existing.type_reservation,
          guest_profile_id: existing.guest_profile_id,
          company_profile_id: existing.company_profile_id,
          company_name: existing.company_name,
          first_name: existing.first_name,
          last_name: existing.last_name,
          title: existing.title,
          telp: existing.telp,
          email: existing.email,
          remark: existing.remark,
          remark_ins: existing.remark_ins,
          booking_agent_id: existing.booking_agent_id,
          contact_person_id: existing.contact_person_id,
          check_in_date: existing.check_in_date,
          check_out_date: existing.check_out_date,
          res_date: new Date(),
                // `res_time` is a timestamp column, not TIME — an "HH:mm" string
                // makes Prisma throw and aborts the whole GIT create.
          res_time: new Date(),
          status: STATUS_ACTIVE,
          status_reservation: STATUS_RESERVATION.reservation.id,
          is_compliment_tour_leader: false,
          gender: existing.gender,
          nationality_id: existing.nationality_id,
          created_by: userId,
      }));

      // Replicate reservation items
      for (const resv of existing.reservations) {
        await prisma.reservations.create({
          data: await withReservationNames({
            property_id: resv.property_id,
            folio_id: newFolio.id,
            company_profile_id: resv.company_profile_id,
            rate_id: resv.rate_id,
            room_type_id: resv.room_type_id,
            room_type_name: resv.room_type_name,
            room_id: resv.room_id,
            room_name: resv.room_name,
            adult: resv.adult,
            child: resv.child,
            add_bed: resv.add_bed,
            check_in_date: resv.check_in_date,
            check_out_date: resv.check_out_date,
            date: resv.date,
            eta: resv.eta,
            etd: resv.etd,
            status_reservation: STATUS_RESERVATION.reservation.id,
            status: STATUS_ACTIVE,
            night: resv.night,
            amount: resv.amount,
            amountt: resv.amountt,
            total: resv.total,
            service_charge: resv.service_charge,
            pb1: resv.pb1,
            tax3: resv.tax3,
            created_by: userId,
          }),
        });
      }

      success(res, bigintToNumber(newFolio), 'Success');
    } catch (err: any) {
      console.error('Reservation replicate error:', err);
      error(res, 'Failed to replicate reservation', 500);
    }
  }

  
  // POST /api/reservations/update-bulk
  
  /**
   * Bulk folio action over a GIT group.
   *
   * This used to be `updateMany` on `folios` + `updateMany` on `reservations`:
   * a bare status flip with no settlement gate, no room-availability check, no
   * room-status write and no audit. Two of its four real call paths
   * (`un_check_in`, `un_check_out`) were not even in the status switch, so they
   * returned 400 and the group could not be reversed at all.
   *
   * It now drives the SAME `performCheckIn` / `performCheckOut` operations the
   * single-folio endpoints use, reports per-folio failures, and closes the parent
   * once every p-block is out.
   */
  static async updateBulk(req: Request, res: Response): Promise<void> {
    try {
      const { status_reservation, folio_ids, remark, reason, parent_folio_id, to_virtual } = req.body;

      if (!status_reservation || !Array.isArray(folio_ids) || folio_ids.length === 0) {
        badRequest(res, 'status_reservation and folio_ids are required');
        return;
      }

      const parsed: bigint[] = [];
      for (const raw of folio_ids) {
        try { parsed.push(BigInt(raw)); } catch { /* skip malformed id */ }
      }
      if (parsed.length === 0) { badRequest(res, 'No valid folio id supplied'); return; }

      // Laravel requires a remark on cancel (Folio.php :1516-1518) even when it
      // is triggered from the bulk grid; the Reason dropdown is validated by
      // every bulk caller, so a batch cannot be cancelled quietly without one.
      if (status_reservation === 'cancel_reservation' && !String(remark ?? '').trim()) {
        badRequest(res, 'The remark field is required.');
        return;
      }
      if (status_reservation === 'cancel_reservation' && !reason) {
        badRequest(res, 'The reason field is required.');
        return;
      }
      // Laravel setUpdateStatus validates `remark` required for the same bulk
      // per-folio actions it validates one-shot (Folio.php :1425-1427,
      // :1516-1518, :1832-1834).
      if (
        (status_reservation === 'un_check_in' || status_reservation === 'un_check_out') &&
        !String(remark ?? '').trim()
      ) {
        badRequest(res, 'The remark field is required.');
        return;
      }

      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid);
      const userId = req.user?.id ?? null;

      const succeeded: string[] = [];
      const failed: { folio_id: number; folio_number: string | null; message: string }[] = [];

      // Plain status actions that need no stay-level validation. These are the
      // administrative flips (pending / reservation / cancel) and are still done
      // one at a time so a per-folio guard can reject a single p-block.
      const PLAIN_ACTIONS: Record<string, number> = {
        reservation: STATUS_RESERVATION.reservation.id,
        pending: STATUS_RESERVATION.pending.id,
        cancel_reservation: STATUS_RESERVATION.cancel_reservation.id,
      };

      for (const id of parsed) {
        const folio = await prisma.folios.findUnique({
          where: { id },
          select: { id: true, folio_number: true, status_reservation: true, type_reservation: true, parent: true },
        });
        if (!folio) {
          failed.push({ folio_id: Number(id), folio_number: null, message: 'Folio not found' });
          continue;
        }

        try {
          if (status_reservation === 'check_in') {
            const r = await performCheckIn(id, { propertyId: pid, businessDate, remark, userId });
            if (r.ok) succeeded.push(String(id));
            else failed.push({ folio_id: Number(id), folio_number: folio.folio_number, message: r.message });
            continue;
          }

          if (status_reservation === 'check_out') {
            const r = await performCheckOut(id, { businessDate, userId });
            if (r.ok) succeeded.push(String(id));
            else failed.push({ folio_id: Number(id), folio_number: folio.folio_number, message: r.message });
            continue;
          }

          if (status_reservation === 'un_check_in' || status_reservation === 'un_check_out') {
            const r = await performReverseStay(id, {
              businessDate,
              userId,
              toVirtual: to_virtual,
              remark,
              reason,
            });
            if (r.ok) succeeded.push(String(id));
            else failed.push({ folio_id: Number(id), folio_number: folio.folio_number, message: r.message });
            continue;
          }

          if (status_reservation === 'change_date') {
            const r = await performChangeStayDate(id, {
              userId,
              checkInDate: (req.body as any)?.check_in_date ?? null,
              checkOutDate: (req.body as any)?.check_out_date ?? null,
              days: (req.body as any)?.days,
              reason,
              remark,
            });
            if (r.ok) succeeded.push(String(id));
            else failed.push({ folio_id: Number(id), folio_number: folio.folio_number, message: r.message });
            continue;
          }

          const statusId = PLAIN_ACTIONS[status_reservation];
          if (statusId === undefined) {
            badRequest(res, `Invalid status_reservation: ${status_reservation}`);
            return;
          }

          // Cancelling a folio with money on it has to be settled first, exactly
          // like the single-folio cancel path.
          if (status_reservation === 'cancel_reservation') {
            const current = folio.status_reservation as number;
            if (current !== STATUS_RESERVATION.reservation.id && current !== STATUS_RESERVATION.pending.id) {
              failed.push({
                folio_id: Number(id),
                folio_number: folio.folio_number,
                message: 'Only reservation and pending status can be canceled',
              });
              continue;
            }
            const balanceMinor = await folioBalanceMinorUnits(folio as any);
            if (!isFolioSettledMinorPublic(balanceMinor)) {
              failed.push({ folio_id: Number(id), folio_number: folio.folio_number, message: 'Payment required' });
              continue;
            }
          }

          await prisma.folios.update({
            where: { id },
            data: { status_reservation: statusId, remark: remark || undefined, updated_by: userId, updated_at: new Date() },
          });
          await prisma.reservations.updateMany({
            where: { folio_id: id, deleted_at: null },
            data: { status_reservation: statusId },
          });
          if (status_reservation === 'cancel_reservation') {
            // Laravel parity (Folio.php:1515-1586) — a cancelled folio keeps
            // its cancellation reason/password remark in the `data` JSON (the
            // cancelled-folio report reads it), resets the pending room-change
            // pointers and cascades the cancel to its child folios.
            // The single updateStatus path does the same.
            const fresh = await prisma.folios.findUnique({ where: { id }, select: { data: true, type_reservation: true, parent: true } });
            await prisma.reservations.updateMany({
              where: { folio_id: id, deleted_at: null },
              data: { room_id_next: null, room_type_id_next: null },
            });
            if (fresh) {
              let parsedData: any = {};
              try { parsedData = fresh.data ? JSON.parse(fresh.data as string) : {}; } catch { parsedData = {}; }
              await prisma.folios.update({
                where: { id },
                data: {
                  data: JSON.stringify({
                    ...parsedData,
                    remark_cancel_reservation: remark ?? null,
                    reason_cancel_reservation: reason ?? null,
                  }),
                },
              });
              const isGitParent =
                String(fresh.type_reservation ?? '').toLowerCase() === 'git' && Number(fresh.parent ?? 0) === 0;
              if (isGitParent) {
                await prisma.folios.updateMany({
                  where: { parent: id },
                  data: { status_reservation: statusId },
                });
              }
            }
          }
          // @ts-ignore
          await writeAudit(prisma, req, {
            table: 'folios',
            event: 'updated',
            subjectId: id,
            name: `folio-${String(status_reservation).replace(/_/g, '-')}`,
            description: `Folio ${folio.folio_number ?? id}: ${status_reservation} (bulk)`,
            logName: 'front_desk',
            old: { status_reservation: folio.status_reservation },
            attributes: { status_reservation: statusId },
            meta: { folio_number: folio.folio_number, action: status_reservation, bulk: true, reason: reason ?? null, remark: remark ?? null },
          });
          succeeded.push(String(id));
        } catch (err: any) {
          console.error('updateBulk per-folio error:', err);
          failed.push({ folio_id: Number(id), folio_number: folio.folio_number, message: err?.message ?? 'Unexpected error' });
        }
      }

      // Group close-out parity with Laravel (ReservationController.php:3409-3449):
      // - After a bulk check-in, the parent GIT folio joins the house (check_in).
      // - After a bulk un-check-in with no child left checked in, the parent
      //   reverts to reservation.
      // - After a bulk un-check-out, the parent goes back to check_in so the
      //   group stays "in house"; when every non-cancelled p-block is checked
      //   out the master folio follows (check_out).
      // The parent id comes from the payload, and if absent (non-GIT buttons
      // funnel here too) it is derived from the child folios' `parent` column.
      let parentClosed: number | null = null;
      let parentUpdated: number | null = null;
      const requestedParentId =
        parent_folio_id != null && parent_folio_id !== '' ? BigInt(parent_folio_id) : null;
      let parentId = requestedParentId;
      if (parentId === null) {
        // Derive: each parsed folio already knows its parent from the batch loop.
        const childIds = parsed;
        const parentRows = await prisma.folios.findMany({
          where: { id: { in: childIds } },
          select: { parent: true },
          distinct: ['parent'],
        });
        const nonzero = parentRows.find((r: any) => BigInt(r.parent ?? 0) !== 0n);
        if (nonzero) parentId = BigInt(nonzero.parent);
      }
      const parentStatusActions: Record<string, number | null> = {
        check_in: STATUS_RESERVATION.check_in.id,
        un_check_in: STATUS_RESERVATION.reservation.id,
        un_check_out: STATUS_RESERVATION.check_in.id,
        check_out: STATUS_RESERVATION.check_out.id,
      };
      const desiredParentStatus = parentStatusActions[status_reservation] ?? null;
      if (parentId !== null && desiredParentStatus !== null && succeeded.length > 0) {
        const parent = await prisma.folios.findUnique({ where: { id: parentId } });
        if (
          parent &&
          Number(parent.status_reservation) !== desiredParentStatus &&
          String(parent.type_reservation ?? '').toLowerCase().includes('git')
        ) {
          if (status_reservation === 'check_in') {
            await prisma.folios.update({
              where: { id: parentId },
              data: {
                status_reservation: desiredParentStatus,
                updated_by: userId,
                updated_at: new Date(),
              },
            });
            parentUpdated = Number(parentId);
          } else if (status_reservation === 'un_check_in') {
            const checkedInCount = await prisma.folios.count({
              where: { parent: parentId, status_reservation: STATUS_RESERVATION.check_in.id },
            });
            if (checkedInCount === 0) {
              await prisma.folios.update({
                where: { id: parentId },
                data: {
                  status_reservation: STATUS_RESERVATION.reservation.id,
                  updated_by: userId,
                  updated_at: new Date(),
                },
              });
              parentUpdated = Number(parentId);
            }
          } else if (status_reservation === 'un_check_out') {
            // Laravel :3437-3445 — the master may only revert to Check In when
            // NO child folio still carries the Check Out status (the one just
            // un-checked-out has already left that status). A single un-check-out
            // in a group with other checked-out p-blocks must not pull the
            // master back into the house.
            const stillCheckOut = await prisma.folios.count({
              where: {
                parent: parentId,
                status_reservation: STATUS_RESERVATION.check_out.id,
              },
            });
            if (stillCheckOut === 0) {
              await prisma.folios.update({
                where: { id: parentId },
                data: {
                  status_reservation: STATUS_RESERVATION.check_in.id,
                  updated_by: userId,
                  updated_at: new Date(),
                },
              });
              parentUpdated = Number(parentId);
            }
          } else if (status_reservation === 'check_out') {
            const remaining = await prisma.folios.count({
              where: {
                parent: parentId,
                status_reservation: STATUS_RESERVATION.check_in.id,
              },
            });
            if (remaining === 0) {
              // Laravel :3420 — AND the master's own balance (ex-posting) must
              // settle: ceil(getBalanceWithOutPosting()) in [0,1,-1]. Without
              // this gate the master flipped to Check Out the moment the last
              // in-house p-block left, even though the master folio still
              // carried money — the QA report "Master Folio berubah status jadi
              // Check Out saat salah 1 Subfolio terCheckOut". The master only
              // checks out once every active subfolio is out AND the master
              // itself is settled.
              const balanceMinor = await folioBalanceMinorUnits(parent);
              if (isFolioSettledMinorPublic(balanceMinor)) {
                await prisma.folios.update({
                  where: { id: parentId },
                  data: {
                    status_reservation: STATUS_RESERVATION.check_out.id,
                    check_out_date: new Date(businessDate + 'T00:00:00.000Z'),
                    updated_by: userId,
                    updated_at: new Date(),
                  },
                });
                parentClosed = Number(parentId);
                parentUpdated = Number(parentId);
              }
            }
          }
          if (parentUpdated !== null) {
            // @ts-ignore
            await writeAudit(prisma, req, {
              table: 'folios',
              event: 'updated',
              subjectId: parentId,
              name: 'git-parent-status-sync',
              description: `GIT parent ${parent.folio_number ?? parentId} -> ${status_reservation} (bulk follow-up)`,
              logName: 'front_desk',
              meta: {
                folio_number: parent.folio_number,
                action: status_reservation,
                children_succeeded: succeeded.length,
                business_date: businessDate,
              },
            });
          }
        }
      }

      // Bulk change_date resizes the parent GIT window to the new stay
      // (Laravel :3401-3403 rebuilds the master dates alongside the children).
      if (
        status_reservation === 'change_date' &&
        parentId !== null &&
        succeeded.length > 0 &&
        (req.body as any)?.check_in_date && (req.body as any)?.check_out_date
      ) {
        await prisma.folios.update({
          where: { id: parentId },
          data: {
            check_in_date: new Date(`${String((req.body as any).check_in_date).substring(0, 10)}T00:00:00.000Z`),
            check_out_date: new Date(`${String((req.body as any).check_out_date).substring(0, 10)}T00:00:00.000Z`),
            updated_by: userId,
            updated_at: new Date(),
          },
        });
        parentUpdated = Number(parentId);
      }

      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'folios',
        event: 'updated',
        subjectId: null,
        name: `git-bulk-${String(status_reservation).replace(/_/g, '-')}`,
        description: `Bulk ${status_reservation}: ${succeeded.length} ok, ${failed.length} rejected`,
        logName: 'front_desk',
        meta: {
          action: status_reservation,
          succeeded,
          failed,
          parent_folio_id: parentId != null ? String(parentId) : null,
          parent_auto_closed: parentClosed,
          parent_updated: parentUpdated,
          business_date: businessDate,
        },
      });

      enqueueJob('sync-staah-room-availability', { propertyId: Number(req.user?.lastProperty ?? 0) });
      // Partial success still returns 200 with the breakdown — the old handler
      // reported `updated: ids.length` regardless of what actually happened.
      success(res, {
        updated: succeeded.length,
        succeeded: succeeded.map(Number),
        failed,
        parent_closed: parentClosed,
        parent_updated: parentUpdated,
        status_reservation: status_reservation,
      }, failed.length > 0 && succeeded.length === 0 ? 'No folio was updated' : 'Success');
    } catch (err: any) {
      console.error('Reservation updateBulk error:', err);
      error(res, 'Failed to bulk update reservations', 500);
    }
  }

  
  // POST /api/reservations/:id/assign-room
  
  static async assignRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;
      const { room_id, room_type_id } = req.body;

      const reservation = await prisma.reservations.findUnique({ where: { id } });
      if (!reservation || reservation.deleted_at) {
        notFound(res, 'Reservation not found');
        return;
      }

      if (room_type_id && Number(room_type_id) !== Number(reservation.room_type_id)) {
        badRequest(res, 'Cannot change room type');
        return;
      }

      const folio = await prisma.folios.findUnique({ where: { id: reservation.folio_id } });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Folio Not Found');
        return;
      }

      if (room_id) {
        const targetRoomId = BigInt(room_id);
        const ci = fmtDateOnly(folio.check_in_date);
        const co = fmtDateOnly(folio.check_out_date);
        if (!ci || !co) {
          badRequest(res, 'Reservation dates are required before assigning a room');
          return;
        }
        
        const room = await prisma.rooms.findUnique({ where: { id: targetRoomId }, select: { room_type_id: true } });
        if (!room) { badRequest(res, 'Room not found'); return; }
        if (Number(room.room_type_id) !== Number(reservation.room_type_id)) {
          badRequest(res, 'Room does not belong to the selected room type');
          return;
        }
        
        const propertyId = folio.property_id ?? req.user?.lastProperty;
        const availableIds = propertyId
          ? await onlyAvailableRoomIds(propertyId, ci, co, folio.id)
          : new Set<number>();
        if (!availableIds.has(Number(targetRoomId))) {
          badRequest(res, 'Room is not available for the selected dates');
          return;
        }
      }

      const preRoomIds = await prisma.reservations.findMany({
        where: { folio_id: folio.id, deleted_at: null },
        select: { room_id: true },
        orderBy: { date: 'asc' },
      });

      const updateData: any = {
        updated_at: new Date(),
        updated_by: userId,
      };
      if (room_id) updateData.room_id = BigInt(room_id);
      if (room_type_id) updateData.room_type_id = BigInt(room_type_id);

      await prisma.$transaction(
        async (tx) => {
          if (reservation.room_id && folio.status_reservation === 3) { // 3 is STATUS_RESERVATION.check_in.id
            await tx.rooms.update({
              where: { id: reservation.room_id },
              data: { room_status: 1, maid_status: 3 } // vacant, dirty
            });
          }

          await tx.reservations.updateMany({
            where: { 
              folio_id: folio.id, 
              deleted_at: null,
              date: { gte: reservation.date },
              room_type_id: reservation.room_type_id,
              status: 0
            },
            data: updateData,
          });
        },
        { timeout: 20000 }
      );

      const updatedFolio = await prisma.folios.findUnique({
        where: { id: folio.id },
        include: { reservations: { where: { deleted_at: null } } },
      });

      enqueueJob('sync-staah-room-availability', {
        propertyId: Number((updatedFolio as any)?.property_id ?? 0),
        dateFrom: (updatedFolio as any)?.check_in_date ? formatDate(new Date((updatedFolio as any).check_in_date)) : undefined,
        dateTo: (updatedFolio as any)?.check_out_date ? formatDate(new Date((updatedFolio as any).check_out_date)) : undefined,
      });
      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'folios',
        event: 'updated',
        subjectId: folio.id,
        name: 'folio-room-assigned',
        description: `Room ${room_id ?? 'none'} assigned to folio ${folio.folio_number ?? folio.id}`,
        logName: 'front_desk',
        old: { room_id: preRoomIds[0]?.room_id != null ? String(preRoomIds[0].room_id) : null },
        attributes: { room_id: room_id ? String(room_id) : null, room_type_id: room_type_id ? String(room_type_id) : null },
        meta: { folio_number: folio.folio_number, availability_checked: !!room_id },
      });

      success(res, bigintToNumber(updatedFolio), 'Success');
    } catch (err: any) {
      console.error('Reservation assign room error:', err);
      error(res, 'Failed to assign room', 500);
    }
  }

  
  // Reservation Items (sub-resource)
  

  // GET /api/reservations/:folioId/items
  static async listItems(req: Request, res: Response): Promise<void> {
    try {
      const folioIdParam = Array.isArray(req.params.folioId) ? req.params.folioId[0] : req.params.folioId;
      const folioId = BigInt(folioIdParam);

      const items = await prisma.reservation_items.findMany({
        where: { reservation_id: folioId, deleted_at: null },
        orderBy: { date: 'asc' },
      });

      success(res, bigintToNumber(items), 'Success');
    } catch (err: any) {
      console.error('Reservation items list error:', err);
      error(res, 'Failed to fetch reservation items', 500);
    }
  }

  // POST /api/reservations/:folioId/items
  static async addItem(req: Request, res: Response): Promise<void> {
    try {
      const folioIdParam = Array.isArray(req.params.folioId) ? req.params.folioId[0] : req.params.folioId;
      const folioId = BigInt(folioIdParam);
      const userId = req.user?.id;
      const propertyId = req.user?.lastProperty;
      const { type, date, code_post_id, code_item_id, description, amount, total, type_amount } = req.body;

      const item = await prisma.reservation_items.create({
        data: {
          property_id: propertyId!,
          reservation_id: folioId,
          type: type || null,
          date: new Date(date),
          code_post_id: code_post_id ? BigInt(code_post_id) : null,
          code_item_id: code_item_id ? BigInt(code_item_id) : null,
          description: description || null,
          amount: amount || 0,
          total: total || 0,
          type_amount: type_amount || 'PLUS',
          status: STATUS_ACTIVE,
          created_by: userId,
        },
      });

      success(res, bigintToNumber(item), 'Success', 200);
    } catch (err: any) {
      console.error('Reservation item add error:', err);
      error(res, 'Failed to add reservation item', 500);
    }
  }

  // PUT /api/reservations/:folioId/items/:itemId
  static async updateItem(req: Request, res: Response): Promise<void> {
    try {
      const itemIdParam = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
      const itemId = BigInt(itemIdParam);
      const userId = req.user?.id;
      const { type, date, code_post_id, code_item_id, description, amount, total, type_amount } = req.body;

      const existing = await prisma.reservation_items.findUnique({ where: { id: itemId } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Item not found');
        return;
      }

      const updateData: any = { updated_at: new Date(), updated_by: userId };
      if (type !== undefined) updateData.type = type;
      if (date !== undefined) updateData.date = new Date(date);
      if (code_post_id !== undefined) updateData.code_post_id = code_post_id ? BigInt(code_post_id) : null;
      if (code_item_id !== undefined) updateData.code_item_id = code_item_id ? BigInt(code_item_id) : null;
      if (description !== undefined) updateData.description = description;
      if (amount !== undefined) updateData.amount = amount;
      if (total !== undefined) updateData.total = total;
      if (type_amount !== undefined) updateData.type_amount = type_amount;

      await prisma.reservation_items.update({ where: { id: itemId }, data: updateData });

      const updated = await prisma.reservation_items.findUnique({ where: { id: itemId } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Reservation item update error:', err);
      error(res, 'Failed to update reservation item', 500);
    }
  }

  // DELETE /api/reservations/:folioId/items/:itemId
  static async deleteItem(req: Request, res: Response): Promise<void> {
    try {
      const itemIdParam = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
      const itemId = BigInt(itemIdParam);
      const userId = req.user?.id;

      const existing = await prisma.reservation_items.findUnique({ where: { id: itemId } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Item not found');
        return;
      }

      await prisma.reservation_items.update({
        where: { id: itemId },
        data: { deleted_at: new Date() },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Reservation item delete error:', err);
      error(res, 'Failed to delete reservation item', 500);
    }
  }

  // ── Laravel ReservationItemController::updateVR (:705-782) ──
  // Update VR folio dates/guest + repricing via saveReservation engine.
  static async updateVR(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const { check_in_date, check_out_date, guest_profile_id } = req.body;
      if (!check_in_date || !check_out_date || !guest_profile_id) {
        badRequest(res, 'check_in_date, check_out_date and guest_profile_id are required');
        return;
      }

      const folio: any = await prisma.folios.findUnique({ where: { id } });
      if (!folio || folio.deleted_at) { notFound(res, 'Folio not found'); return; }

      const bussinesDate = await AuthController.getBusinessDate(folio.property_id ?? null);
      await prisma.folios.update({
        where: { id },
        data: {
          check_in_date: new Date(check_in_date),
          check_out_date: new Date(check_out_date),
          guest_profile_id: BigInt(guest_profile_id),
          updated_at: new Date(),
          updated_by: req.user?.id,
        },
      });

      // Reprice all reservation nights using the pricing engine.
      const resvs = await prisma.reservations.findMany({ where: { folio_id: id, deleted_at: null }, orderBy: { date: 'asc' } });
      if (resvs.length > 0) {
        const firstResv = resvs[0];
        const getNight = Math.max(1, Math.ceil((new Date(check_out_date).getTime() - new Date(check_in_date).getTime()) / 86400000));
        let cpRow: any = null;
        if (firstResv.rate_id) {
          const rate: any = await prisma.rates.findUnique({ where: { id: firstResv.rate_id }, select: { code_post_id: true } });
          if (rate?.code_post_id) cpRow = await prisma.code_posts.findUnique({ where: { id: BigInt(rate.code_post_id) } });
        }
        const property: any = await prisma.properties.findUnique({ where: { id: folio.property_id }, select: { is_tax: true } });

        // Delete old rows
        await prisma.reservations.deleteMany({ where: { folio_id: id, deleted_at: null } });

        for (let i = 0; i < getNight; i++) {
          const nightDate = new Date(`${bussinesDate || check_in_date}T00:00:00`);
          nightDate.setDate(nightDate.getDate() + i);
          const pricing = await priceNight({
            // @ts-ignore
            prisma,
            rateId: firstResv.rate_id,
            roomTypeId: firstResv.room_type_id,
            night: nightDate,
            getNight,
            adult: Number(firstResv.adult ?? 1),
            child: Number(firstResv.child ?? 0),
            quantity: 1,
            isTax: property?.is_tax === 1,
            rateCodePost: cpRow,
            promos: [],
          });
          await prisma.reservations.create({
            data: await withReservationNames({
              property_id: folio.property_id,
              folio_id: id,
              company_profile_id: firstResv.company_profile_id ?? folio.company_profile_id ?? null,
              rate_id: firstResv.rate_id,
              room_type_id: firstResv.room_type_id,
              room_id: firstResv.room_id,
              adult: Number(firstResv.adult ?? 1),
              child: Number(firstResv.child ?? 0),
              add_bed: firstResv.add_bed ?? 0,
              check_in_date: new Date(check_in_date),
              check_out_date: new Date(check_out_date),
              date: nightDate,
              night: getNight,
              amount: pricing.amount,
              total: pricing.total,
              service_charge: pricing.service_charge,
              pb1: pricing.pb1,
              tax3: pricing.tax3,
              status_reservation: STATUS_RESERVATION.reservation.id,
              status: 1,
              created_by: req.user?.id,
            }),
          });
        }
      }

      enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
      success(res, bigintToNumber(folio), 'Success');
    } catch (err: any) { console.error('updateVR error:', err); error(res, 'Failed to update VR', 500); }
  }

  // ── Laravel ReservationItemController::moveReservation (:880-1009) ──
  // Shift reservation item dates by a delta (from_date → to_date).
  static async moveReservationItems(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = String(req.params.id);
      if (!/^\d+$/.test(idRaw)) { badRequest(res, 'Invalid id'); return; }
      const id = BigInt(idRaw);

      // Laravel ReservationItemController::moveReservation (:880+) resolves the
      // FOLIO row from the path id. The row grid posts the folio id as col0, but
      // some callers pass a reservation-item id — accept both.
      let folio: any = null;
      const asReservation = await prisma.reservations.findUnique({ where: { id } });
      if (asReservation) {
        folio = await prisma.folios.findUnique({ where: { id: asReservation.folio_id } });
      }
      if (!folio) folio = await prisma.folios.findUnique({ where: { id } });
      if (!folio) { notFound(res, 'Folio not found'); return; }
      const folioId = folio.id as bigint;

      if (String(folio?.type_reservation ?? '').toLowerCase() === 'git' && Number(folio?.parent) === 0) {
        badRequest(res, 'Action not allowed'); return;
      }

      // Original period: request wins, folio dates fall back (Laravel :894-895).
      const checkInRaw = req.body?.check_in_date ?? req.body?.from_date;
      const checkOutRaw = req.body?.check_out_date ?? req.body?.to_date;
      const checkInStr = checkInRaw ? String(checkInRaw).substring(0, 10) : (folio.check_in_date ? new Date(folio.check_in_date).toISOString().substring(0, 10) : null);
      const checkOutStr = checkOutRaw ? String(checkOutRaw).substring(0, 10) : (folio.check_out_date ? new Date(folio.check_out_date).toISOString().substring(0, 10) : null);
      if (!checkInStr || !checkOutStr) { badRequest(res, 'check_in_date and check_out_date are required'); return; }

      // Where to_room (a room NAME in Laravel) is used, else room_id (numeric).
      const targetRoomName = String(req.body?.to_room ?? '').trim();
      let targetRoom: any = null;
      if (targetRoomName) {
        targetRoom = await prisma.rooms.findFirst({ where: { property_id: folio.property_id, name: targetRoomName, deleted_at: null } });
      } else if (req.body?.room_id && String(req.body.room_id) !== '0') {
        targetRoom = await prisma.rooms.findFirst({ where: { property_id: folio.property_id, id: BigInt(req.body.room_id), deleted_at: null } });
      }
      if (!targetRoom) { badRequest(res, 'Target room is required'); return; }

      const checkInDate = new Date(`${checkInStr}T00:00:00.000Z`);
      const checkOutDate = new Date(`${checkOutStr}T00:00:00.000Z`);
      if (checkInDate > checkOutDate) { badRequest(res, 'Check In Date must be less than Check Out Date'); return; }

      const businessDate = await AuthController.getBusinessDate(folio.property_id);
      if (checkInStr < businessDate) { badRequest(res, 'Check In Date must be greater than or equal to business date'); return; }

      // Availability of the target room across the whole window (Laravel :929-944).
      const conflict = await prisma.reservations.findFirst({
        where: {
          room_id: targetRoom.id,
          deleted_at: null,
          folio_id: { not: folioId },
          date: { gte: checkInDate, lt: checkOutDate },
        },
      });
      if (conflict) { badRequest(res, 'Target room is already occupied during this period'); return; }

      // Latest reservation is the template (Laravel :946-953).
      const latestReservation: any = await prisma.reservations.findFirst({
        where: { folio_id: folioId, deleted_at: null },
        orderBy: { id: 'desc' },
      });
      if (!latestReservation) { badRequest(res, 'No reservation found for this folio'); return; }

      // Step 1: clear the old unposted rows in the window (Laravel :955-960).
      const removed = await prisma.reservations.deleteMany({
        where: { folio_id: folioId, is_posting: 0, deleted_at: null, date: { gte: checkInDate, lt: checkOutDate } },
      });

      // Step 2: rebuild in the target room (Laravel :962-983 via saveReservation).
      const nights = Math.max(1, Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 86400000));
      const rateIdBig = latestReservation.rate_id ? BigInt(latestReservation.rate_id) : null;
      const rateRow = rateIdBig ? await prisma.rates.findUnique({ where: { id: rateIdBig }, select: { code_post_id: true } }) : null;
      const rateCodePost = rateRow?.code_post_id ? await prisma.code_posts.findUnique({ where: { id: rateRow.code_post_id } }) : null;
      const property = await prisma.properties.findUnique({ where: { id: folio.property_id }, select: { is_tax: true } });
      const isTax = (property as any)?.is_tax === 1;
      const userId = req.user?.id ?? null;

      for (let i = 0; i < nights; i++) {
        const rowDate = new Date(checkInDate); rowDate.setDate(rowDate.getDate() + i);
        const pricing = await priceNight({
          // @ts-ignore
          prisma,
          rateId: rateIdBig,
          roomTypeId: targetRoom.room_type_id,
          night: rowDate,
          getNight: nights,
          adult: Number(latestReservation.adult || 1),
          child: Number(latestReservation.child || 0),
          isTax,
          rateCodePost,
        } as any);
        await prisma.reservations.create({
          data: {
            property_id: folio.property_id,
            folio_id: folioId,
            rate_id: rateIdBig,
            room_type_id: targetRoom.room_type_id,
            room_id: targetRoom.id,
            eta: latestReservation.eta,
            etd: latestReservation.etd,
            adult: latestReservation.adult || 1,
            child: latestReservation.child || 0,
            add_bed: latestReservation.add_bed || 0,
            check_in_date: i === 0 ? checkInDate : rowDate,
            check_out_date: i === 0 ? checkOutDate : new Date(rowDate.getTime() + 86400000),
            date: rowDate,
            status_reservation: latestReservation.status_reservation,
            status: latestReservation.status,
            night: nights,
            amount: pricing.amount,
            amountt: pricing.amount,
            total: pricing.total,
            service_charge: pricing.service_charge,
            pb1: pricing.pb1,
            tax3: pricing.tax3,
            created_by: userId,
          },
        });
      }

      // The old shift-style handler never touched the folio header dates; keep
      // them in sync with the new window (Laravel does so via saveReservation).
      await prisma.folios.update({
        where: { id: folioId },
        data: {
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          updated_at: new Date(),
          updated_by: userId,
        },
      });

      enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
      success(res, { moved: removed.count }, `Reservation moved successfully to ${targetRoomName || targetRoom.name}`);
    } catch (err: any) { console.error('moveReservation error:', err); error(res, err?.message ?? 'Failed to move reservation', 500); }
  }

  private static bn(val: any): any {
    if (typeof val === 'bigint') return Number(val);
    if (Array.isArray(val)) return val.map((v) => reservationBn(v));
    if (val && typeof val === 'object') { const o: any = {}; for (const [k, v] of Object.entries(val)) o[k] = reservationBn(v); return o; }
    return val;
  }

  
  // GET /cms/reservation/code-item (additional item page)
  
    // ———— GET /cms/reservation/code-item (additional item page) - filter by folio's rate
  // ——————————————————————————————————————————————————————————————————————————————
    // GET /cms/reservation/code-item (additional item page)
  // ———— GET /cms/reservation/code-item (additional item page) - filter by folio's rate
  // ——————————————————————————————————————————————————————————————————————————————
  static async codeItemList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const q = req.query as any;
      const folioIdRaw = String(q.subfolio_id && q.subfolio_id !== 'null' && q.subfolio_id !== '' ? q.subfolio_id : (q.folio_id ?? ''));
      const pid = BigInt(req.user?.lastProperty ?? 0);

      const codePosts = await prisma.code_posts.findMany({
        where: { deleted_at: null, status: 1, type: 'DEFAULT', ...(req.user?.lastProperty ? { property_id: pid } : {}) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const codePostOptions = codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name }));
      const reasonTypes = await prisma.types.findMany({
        where: { deleted_at: null, status: 1, group: 'remark-additional-item', ...(req.user?.lastProperty ? { property_id: pid } : {}) },
        select: { id: true, name: true },
      });

      const table = [
        { label: 'Code', key: 'code', type: 'none', is_search: false },
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Post Code', key: 'code_post_id', type: 'none', is_search: false, options: codePostOptions },
        { label: 'Sales', key: 'sales', type: 'number', is_search: false },
        { label: 'Start Date', key: 'start_date', type: 'date', is_search: false },
        { label: 'End Date', key: 'end_date', type: 'date', is_search: false },
        { label: 'Reason', key: 'reason', type: 'select', options: reasonTypes.map((t: any) => ({ value: Number(t.id), label: t.name })), is_search: false },
        { label: 'Upsales', key: 'upsales', type: 'number', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
      ];

      const empty = (msg: string) => success(res, [], msg, 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: 1, per_page: limit, total: 0, from: 0, to: 0 },
      });

      if (!/^\d+$/.test(folioIdRaw)) { empty('No guest ID provided.'); return; }
      const folio: any = await prisma.folios.findUnique({ where: { id: BigInt(folioIdRaw) } });
      if (!folio) { empty('No guest ID provided.'); return; }

      // Laravel: CodeItem::whereHas('Folio') - i.e. only the items actually
      // attached to THIS folio through model_has_code_items. Listing the master
      // catalogue instead made a freshly added Additional Item invisible.
      const pivot = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT * FROM model_has_code_items
                   WHERE model_type = ${'App\\Models\\Folio'} AND model_id = ${folio.id}
                   ORDER BY code_item_id ASC NULLS LAST`
      );
      const itemIds = Array.from(new Set(pivot.map((p: any) => Number(p.code_item_id)))).filter((n) => n > 0);
      const pivotByItem = new Map<number, any>();
      for (const p of pivot) if (!pivotByItem.has(Number(p.code_item_id))) pivotByItem.set(Number(p.code_item_id), p);

      const master: any[] = itemIds.length
        ? await prisma.code_items.findMany({
            where: { id: { in: itemIds }, deleted_at: null },
            select: { id: true, name: true, description: true, sales: true, code_post_id: true, process_on: true },
          })
        : [];
      const masterById = new Map(master.map((m: any) => [Number(m.id), m]));
      const postIdLabel = new Map(codePosts.map((cp: any) => [Number(cp.id), cp.name]));
      const typeName = new Map(reasonTypes.map((t: any) => [Number(t.id), t.name]));

      let rows = itemIds.map((id) => {
        const m = masterById.get(id);
        const p = pivotByItem.get(id);
        const pid2 = p ? Number(p.code_post_id) : (m ? Number(m.code_post_id) : null);
        return {
          id,
          name: p && p.name ? p.name : (m?.name ?? null),
          description: p && p.description ? p.description : (m?.description ?? null),
          code: (m as any)?.code ?? null,
          code_post_id: {
            value: pid2,
            label: pid2 !== null ? (postIdLabel.get(pid2) ?? String(pid2)) : '',
          },
          process_on: p && p.process_on
            ? { value: p.process_on, label: p.process_on }
            : { value: m?.process_on ?? null, label: m?.process_on ?? null },
          sales: Number((p && p.sales !== null && p.sales !== undefined ? p.sales : m?.sales) ?? 0),
          start_date: p && p.start_date ? new Date(p.start_date) : (folio.check_in_date ?? null),
          end_date: p && p.end_date ? new Date(p.end_date) : (folio.check_out_date ?? null),
          upsales: Number(p?.upsales ?? 0),
          reason: p && p.reason
            ? { value: Number(p.reason), label: typeName.get(Number(p.reason)) ?? String(p.reason) }
            : [],
          action_table: p ? !(Number(p.is_posting) === 1) : true,
          status: Number(m?.status ?? 0),
        };
      });
      if (search) {
        const needle = String(search).toLowerCase();
        rows = rows.filter((r) => String(r.name ?? '').toLowerCase().includes(needle));
      }

      const total = rows.length;
      const start = (page - 1) * limit;
      const pageRows = rows.slice(start, start + limit);
      success(res, reservationBn(pageRows), 'Success', 200, {
        table,
        folio: reservationBn(folio),
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: {
          current_page: page, last_page: Math.max(1, Math.ceil(total / limit)), per_page: limit,
          total, from: total === 0 ? 0 : start + 1, to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) { console.error('Code item list error:', err); error(res, 'Failed to list code items', 500); }
  }

  
  // GET /cms/reservation/inclusive
  
    // ———— GET /cms/reservation/inclusive - filter by folio's rate (Laravel parity)
  // ——————————————————————————————————————————————————————————————————————————————
  static async inclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const folioIdRaw = String(req.query.folio_id ?? req.query.subfolio_id ?? '');
      const search = req.query.search as string;
      const pid = BigInt(req.user?.lastProperty ?? 0);

      let where: any = { property_id: pid, deleted_at: null };
      if (search) where.description = { contains: search, mode: 'insensitive' };

      // Get folio's rate to filter inclusives (Laravel parity)
      let rateId: bigint | null = null;
      if (folioIdRaw && /^\d+$/.test(folioIdRaw)) {
        const folio = await prisma.folios.findUnique({
          where: { id: BigInt(folioIdRaw) },
          include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1 } },
        });
        if (folio?.reservations?.[0]?.rate_id) {
          rateId = folio.reservations[0].rate_id;
        }
      }

      if (rateId) {
        where.rate_id = rateId;
      }

      const [data, total] = await Promise.all([
        prisma.rate_inclusives.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { description: 'asc' },
        }),
        prisma.rate_inclusives.count({ where }),
      ]);
      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Frequency', key: 'frequency', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
        { label: 'Cost On', key: 'cost_on', type: 'none', is_search: false },
      ];
      success(res, data, 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Inclusive list error:', err); error(res, 'Failed to list inclusives', 500); }
  }

  
  // GET /cms/reservation/masterInclusive
  
  static async masterInclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) where.description = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.rate_inclusives.findMany({ where, orderBy: { description: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.rate_inclusives.count({ where }),
      ]);
      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: true },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
      ];
      success(res, reservationBn(data), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Master inclusive list error:', err); error(res, 'Failed to list inclusives', 500); }
  }

  
  // GET /cms/reservation/master
  // Laravel parity (ReservationController@getMaster)
  
  static async getMaster(req: Request, res: Response): Promise<void> {
    try {
      // config/cms.php status_reservation, filtered per Laravel
      const allStatus = [
        { value: 'check_in', label: 'Check In', id: 0 },
        { value: 'check_out', label: 'Check Out', id: 1 },
        { value: 'cancel_reservation', label: 'Cancelled', id: 2 },
        { value: 'reservation', label: 'Reservation', id: 3 },
        { value: 'in_house', label: 'In House', id: 4 },
        { value: 'pending', label: 'Pending', id: 5 },
      ];
      const stayDates = allStatus
        .filter((s) => [1, 0].includes(s.id))
        .map((s) => ({ value: s.value, label: s.label }));

      const displayStatus = allStatus
        .filter((s) => s.id !== 4)
        .map((s) => ({ value: s.value, label: s.label }));

      const displayTypes = [
        { value: 'fit', label: 'FIT' },
        { value: 'git', label: 'GIT' },
        { value: 'vr', label: 'VR' },
      ];

      const reasons = await prisma.types.findMany({
        where: {
          group: 'cancellation-reservation',
          status: 1,
          deleted_at: null,
          property_id: req.user?.lastProperty ?? 0,
        },
        orderBy: { sort: 'asc' },
      });

      success(res, null, 'Success', 200, {
        master: {
          stay_dates: stayDates,
          display_types: displayTypes,
          display_status: displayStatus,
          reasons: reasons.map((t) => ({ value: t.name, label: t.name })),
        },
      });
    } catch (err: any) { console.error('Reservation master error:', err); error(res, 'Failed to fetch reservation master', 500); }
  }

  
  // GET /cms/reservation/subfolio/:id
  
  static async subfolioList(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!/^\d+$/.test(raw)) { success(res, { data: [] }, 'Success'); return; }
      const parentId = BigInt(raw);
      // Laravel Folio::childFolio() is SoftDeletes-scoped and unordered; mirror both.
      const subs = await prisma.folios.findMany({ where: { parent: parentId, deleted_at: null }, select: { id: true, folio_number: true, type_reservation: true, parent: true } });
      const data = subs.map(s => ({ value: Number(s.id), label: s.folio_number }));
      // Laravel getSubFolio() prepends the master folio when is_transaction=1 and it is a parent GIT.
      const isTransaction = String(req.query.is_transaction ?? '') === '1';
      const parent = await prisma.folios.findUnique({ where: { id: parentId }, select: { id: true, folio_number: true, type_reservation: true, parent: true, deleted_at: true } });
      if (isTransaction && parent && parent.deleted_at === null && parent.type_reservation?.toLowerCase() === 'git' && Number(parent.parent) === 0) {
        data.unshift({ value: Number(parent.id), label: parent.folio_number });
      }
      // Laravel getSubFolio() returns `['data' => $data, 'code' => 200, ...]`, i.e.
      // the ARRAY sits directly under the top-level `data` key. Passing `{ data }`
      // nested it one level deeper, so the three GIT Master Folio tabs read
      // `response.data` as `{data: [...]}`, `.length` came back undefined and the
      // sub-folio selector never rendered (guest / additional-item / transaction).
      success(res, data, 'Success');
    } catch (err: any) { console.error('Subfolio list error:', err); error(res, 'Failed to list subfolios', 500); }
  }

  
  // GET /cms/reservation/rate (Laravel getRate)
  
static async rateListHelper(req: Request, res: Response): Promise<void> {
    try {
      const ci = req.query.check_in_date as string;
      const co = req.query.check_out_date as string;
      const roomTypeId = req.query.room_type_id as string;
      if (!ci || !co || !roomTypeId) { badRequest(res, 'The check in date field is required.'); return; }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty;
      if (!propertyId) { badRequest(res, 'Property not found'); return; }
      const pId = BigInt(propertyId);
      const rtId = BigInt(roomTypeId);

      const where: any = { deleted_at: null, module: 'rate' };
      where.rate_rates = { some: { room_type_id: rtId, property_id: pId } };
      const ciD = new Date(ci);
      const coD = new Date(co);
      where.start_date = { lte: ciD };
      where.end_date = { gte: coD };
      const search = req.query.search as string;
      if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];
      const searchField = req.query.search_field as string;
      if (searchField && !search) {
        const searchValue = String(req.query.search_value ?? '');
        pushCondition(where, searchPredicate('rates', searchField, searchValue));
      }

      const [rates, total, codePost] = await Promise.all([
        prisma.rates.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit, include: { model_has_company_profiles: { where: { model_type: 'App\\Models\\Rate' }, select: { company_profile_id: true } } } }),
        prisma.rates.count({ where }),
        fetchCodePostOptions(),
      ]);
      const formatted = rates.map((r: any) => rateRowData(r, codePost.byId));
      const table = rateTableColumns(codePost.options, true);
      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = { view: true, add: req.user?.superUser || permFlags.add, edit: req.user?.superUser || permFlags.edit, delete: req.user?.superUser || permFlags.delete };
      success(res, formatted, 'Success', 200, { table, permission, pagination: paggingMetaLocal(total, limit, page), search_data: dataSearchLocal(req, table) as any });
    } catch (err: any) { console.error('Reservation rate list error:', err); error(res, 'Failed to fetch rates', 500); }
  }

  
  // GET /cms/reservation/rate-by-company-id (Laravel getRateByCompany)
  
  static async rateByCompany(req: Request, res: Response): Promise<void> {
    try {
      const companyId = String(req.query.company_profile_id ?? '0');
      const ci = req.query.check_in_date as string;
      const co = req.query.check_out_date as string;
      const dayUse = req.query.day_use as string;
      const typeRsv = req.query.type_rsv as string;
      if (!ci || !co) { badRequest(res, 'The check in date field is required.'); return; }
      const propertyId = req.user?.lastProperty;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const searchField = req.query.search_field as string;
      const searchValue = String(req.query.search_value ?? '');
      const ciD = new Date(ci);
      const coD = new Date(co);
      const company = companyId !== '0' ? BigInt(companyId) : null;

      const baseWhere: any = { deleted_at: null, status: 1, module: 'rate' };
      if (propertyId) baseWhere.property_id = propertyId;
      baseWhere.start_date = { lte: ciD };
      baseWhere.end_date = { gte: coD };
      if (dayUse === '1') baseWhere.is_day_use = true;
      const searchConds: any[] = [];
      if (search) searchConds.push({ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } });
      if (searchField && searchValue && searchConds.length === 0) searchConds.push({ [searchField]: { contains: searchValue, mode: 'insensitive' } });

      let rateWhere: any = { ...baseWhere };
      if (searchConds.length > 0) rateWhere.AND = searchConds;
      if (company) {
        rateWhere.OR = [
          { model_has_company_profiles: { some: { company_profile_id: company, model_type: 'App\\Models\\Rate' } } },
          { model_has_company_profiles: { none: { model_type: 'App\\Models\\Rate' } } },
        ];
      } else if (searchConds.length > 0) {
        rateWhere.OR = searchConds;
      }

      let rates = await prisma.rates.findMany({ where: rateWhere, orderBy: { module: 'desc' }, include: { model_has_company_profiles: { where: { model_type: 'App\\Models\\Rate' }, select: { company_profile_id: true } } } });
      let totalData = rates.length;
      if (rates.length === 0 && dayUse !== '1') {
        const fallbackWhere: any = { ...baseWhere, model_has_company_profiles: { none: { model_type: 'App\\Models\\Rate' } } };
        if (searchConds.length > 0) fallbackWhere.AND = searchConds;
        rates = await prisma.rates.findMany({ where: fallbackWhere, orderBy: { module: 'desc' }, include: { model_has_company_profiles: { where: { model_type: 'App\\Models\\Rate' }, select: { company_profile_id: true } } } });
        totalData = rates.length;
      }

      const codePost = await fetchCodePostOptions();
      let data = rates.map((r: any) => rateRowData(r, codePost.byId));

      if (dayUse !== '1') {
        const barWhere: any = { deleted_at: null, status: 1 };
        if (propertyId) barWhere.property_id = propertyId;
        barWhere.start_date = { lte: ciD };
        barWhere.end_date = { gte: coD };
        const bars = await prisma.rates.findMany({ where: { ...barWhere, module: 'bar' } });
        if (bars.length > 0) {
          // Laravel :2453-2479 — ONE pseudo BAR row aggregated over ALL active bars
          // (min start, max end); not just the first bar.
          const first = barRowData(bars[0], codePost.byId);
          const minStart = bars.reduce((m, b) => (b.start_date < m ? b.start_date : m), bars[0].start_date);
          const maxEnd = bars.reduce((m, b) => (b.end_date > m ? b.end_date : m), bars[0].end_date);
          const barPseudo = {
            ...first,
            start_date: minStart,
            end_date: maxEnd,
            code: 'BAR',
            name: 'BAR',
            description: 'BAR',
            rate_type: 'BAR',
            code_post_id: 'BAR',
            sort_by_company: 0,
            code_color: [{ value: 'BAR', label: 'BAR' }],
            is_color: true,
            color: 'bg-secondary',
          };
          data.push(barPseudo);
        }
      }

      data.sort((a: any, b: any) => (a.sort_by_company - b.sort_by_company) || (a.id - b.id));
      if (typeRsv) {
        const needle = typeRsv === 'is_walk_in' ? 'walk in' : typeRsv === 'is_house_use' ? 'house use' : 'complimentary';
        const matched = data.filter((d: any) => d.name && String(d.name).toLowerCase().includes(needle));
        if (matched.length > 0) {
          const seen = new Set<number>();
          data = [...matched, ...data].filter((d: any) => {
            if (seen.has(d.id)) return false;
            seen.add(d.id);
            return true;
          });
        }
      }

      totalData = totalData + 1;
      const table = rateTableColumns(codePost.options, false).map((col: any) => {
        if (col.key === 'code') return { ...col, key: 'code_color' };
        return col;
      });
      // Laravel :2558 — getPermissionDirect([]) = every flag false
      const permission = { view: false, add: false, edit: false, delete: false };
      success(res, data, 'Success', 200, { table, permission, pagination: paggingMetaLocal(totalData, limit, page), search_data: dataSearchLocal(req, table) as any });
    } catch (err: any) { console.error('Reservation rate by company error:', err); error(res, 'Failed to fetch rates', 500); }
  }

  
  // GET /cms/reservation/package-by-rate-id/:id (Laravel getPackageByRateId)
  
  static async packageByRateId(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { badRequest(res, 'The rate id field is required.'); return; }
      const rateId = BigInt(raw);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const where: any = { rate_id: rateId, deleted_at: null };
      const search = req.query.search as string;
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const searchField = req.query.search_field as string;
      if (searchField && !search) {
        const searchValue = String(req.query.search_value ?? '');
        pushCondition(where, searchPredicate('rate_day_uses', searchField, searchValue));
      }

      const [dayUses, total] = await Promise.all([
        prisma.rate_day_uses.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.rate_day_uses.count({ where }),
      ]);
      const timeOptions = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360].map((v) => ({ value: v, label: `${v / 60} Hour${v > 60 ? 's' : ''}` }));
      const table = [
        { label: 'Rate Name', key: 'name', type: 'text', is_search: true },
        { label: 'Time', key: 'time', type: 'select', options: timeOptions, is_search: true },
        { label: 'Status', key: 'status', type: 'checkbox', options: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }], is_search: true },
      ];
      const data = dayUses.map((d: any) => ({ id: Number(d.id), name: d.name, time: d.time, status: !!d.status }));
      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = { view: true, add: req.user?.superUser || permFlags.add, edit: req.user?.superUser || permFlags.edit, delete: req.user?.superUser || permFlags.delete };
      success(res, data, 'Success', 200, { table, permission, pagination: paggingMetaLocal(total, limit, page), search_data: dataSearchLocal(req, table) as any });
    } catch (err: any) { console.error('Reservation package by rate error:', err); error(res, 'Failed to fetch packages', 500); }
  }

  
  // POST /cms/reservation/charge (Laravel getCharge)
  
  static async getCharge(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      if (!propertyId) { badRequest(res, 'Property not found'); return; }
      const pId = BigInt(propertyId);
      const body = req.body || {};
      const reservationList: any[] = Array.isArray(body.reservation_list) ? body.reservation_list : [];
      if (reservationList.length === 0) { badRequest(res, 'The reservation list field is required.'); return; }
      for (const item of reservationList) {
        if (!item.check_in_date || !item.check_out_date) { badRequest(res, 'Check In Date Required'); return; }
        if (item.rate_id && !/^\d+$/.test(String(item.rate_id))) { badRequest(res, 'Rate Not Found'); return; }
      }

      let ci = String(body.check_in_date || '');
      let co = String(body.check_out_date || '');
      if (!ci || !co) {
        ci = String(reservationList.reduce((min: string, i: any) => (!min || i.check_in_date < min ? i.check_in_date : min), ''));
        co = String(reservationList.reduce((max: string, i: any) => (!max || i.check_out_date > max ? i.check_out_date : max), ''));
      }
      if (body.type_reservation === 'day-use') {
        const d = new Date(ci);
        d.setDate(d.getDate() + 1);
        co = d.toISOString().substring(0, 10);
      }
      const nights = Math.max(1, Math.ceil((new Date(co).getTime() - new Date(ci).getTime()) / (1000 * 60 * 60 * 24)));

      const property = await prisma.properties.findUnique({ where: { id: pId } });
      const codePost = await prisma.code_posts.findFirst({ where: { deleted_at: null, status: STATUS_ACTIVE } });
      if (!codePost) { badRequest(res, 'Code post not found'); return; }
      const isTax = property?.is_tax === 1;

      const rateIds: bigint[] = [];
      const rateById = new Map<number, any>();
      const itemByRate: any[] = [];
      for (const item of reservationList) {
        if (item.rate_id) {
          const rid = BigInt(item.rate_id);
          if (!rateById.has(Number(rid))) {
            rateIds.push(rid);
            const rate = await prisma.rates.findUnique({ where: { id: rid } });
            rateById.set(Number(rid), rate);
          }
          itemByRate.push(item);
        }
      }

      let promoCode = String(body.promo_code ?? '');
      const appliedPromo: any[] = [];
      const discountByRate = new Map<number, number>();
      let linkByPromo = new Map<number, number>();
      let linkedPromotions: any[] = [];
      if (promoCode) {
        if (rateIds.length > 0) {
          const links = await prisma.model_has_promotions.findMany({ where: { model_type: 'App\\Models\\Rate', model_id: { in: rateIds } }, select: { promotion_id: true, model_id: true } });
          links.forEach((l: any) => linkByPromo.set(Number(l.promotion_id), Number(l.model_id)));
          if (linkByPromo.size > 0) {
            linkedPromotions = await prisma.promotions.findMany({
              where: {
                id: { in: [...linkByPromo.keys()] },
                status: 1,
                deleted_at: null,
                promotion_code: promoCode,
                from_validity_date: { lte: new Date() },
                to_validity_date: { gte: new Date() },
                from_stay_date: { lte: new Date(ci) },
                to_stay_date: { gte: new Date(co) },
                min_night: { lte: nights },
              },
            });
          }
        }
        if (linkedPromotions.length === 0) {
          res.status(400).json({ code: 400, message: 'Promo code not found' });
          return;
        }
        for (const promo of linkedPromotions) {
          const rateIdLinked = linkByPromo.get(Number(promo.id));
          const rate = rateById.get(Number(rateIdLinked));
          const amount = Number(rate?.amount ?? 0);
          const discount = promo.promotion_type === 'percentage' ? (amount * Number(promo.discount_percentage ?? 0)) / 100 : Number(promo.discount_flat ?? 0);
          discountByRate.set(Number(rateIdLinked), (discountByRate.get(Number(rateIdLinked)) ?? 0) + discount);
          appliedPromo.push({ rate_id: Number(rateIdLinked), promo_id: Number(promo.id), promo_code: promo.promotion_code, discount });
        }
      } else if (Array.isArray(body.applied_promo) && body.applied_promo.length > 0) {
        for (const ap of body.applied_promo) {
          discountByRate.set(Number(ap.rate_id), Number(ap.discount ?? ap.amount ?? 0));
          appliedPromo.push(ap);
        }
      }

      // Rate -> its own code_post (NOT first active code_posts row) — Laravel getCharge parity.
      const rateRowList = rateIds.length
        ? await prisma.rates.findMany({
            where: { id: { in: rateIds } },
            select: { id: true, code_post_id: true },
          })
        : [];
      const rateCodePostMap = new Map<number, number | null>(rateRowList.map((r) => [Number(r.id), r.code_post_id ? Number(r.code_post_id) : null]));
      const gcCodePostIds = [...new Set(rateRowList.map((r) => r.code_post_id).filter(Boolean))] as bigint[];
      const gcCodePostRows = gcCodePostIds.length ? await prisma.code_posts.findMany({ where: { id: { in: gcCodePostIds } } }) : [];
      const gcCodePostById = new Map<number, any>(gcCodePostRows.map((c) => [Number(c.id), c]));

      // Validated promos keyed by rate (controller-level stay/validity checks above match Laravel).
      const promosByRate = new Map<number, PromoLike[]>();
      if (linkedPromotions.length > 0) {
        for (const promo of linkedPromotions) {
          const rid = Number(linkByPromo.get(Number(promo.id)));
          const list = promosByRate.get(rid) ?? [];
          list.push(promo as PromoLike);
          promosByRate.set(rid, list);
        }
      } else if (Array.isArray(body.applied_promo)) {
        for (const ap of body.applied_promo) {
          if (ap?.rate_id === undefined) continue;
          const rid = Number(ap.rate_id);
          const list = promosByRate.get(rid) ?? [];
          list.push(ap as PromoLike);
          promosByRate.set(rid, list);
        }
      }

      const rows: any[] = [];
      for (const item of itemByRate) {
        const rate = rateById.get(Number(item.rate_id));
        if (!rate) continue;
        const itemCi = new Date(String(item.check_in_date));
        let itemCo = new Date(String(item.check_out_date));
        let nightsThis = Math.ceil((itemCo.getTime() - itemCi.getTime()) / (1000 * 60 * 60 * 24));
        const isDayUse = body.type_reservation === 'day-use';
        if (isDayUse && nightsThis < 1) {
          itemCo = new Date(itemCi);
          itemCo.setDate(itemCo.getDate() + 1);
          nightsThis = 1;
        }
        const getNight = isDayUse ? 0 : Math.max(1, nightsThis);
        const roomTypeIdEff = item.room_type_id ? BigInt(item.room_type_id) : (item.room_type_id_next ? BigInt(item.room_type_id_next) : null);

        for (let i = 0; i < (isDayUse ? 1 : nightsThis); i++) {
          const nightDate = new Date(itemCi);
          nightDate.setDate(nightDate.getDate() + i);

          // Per-night promo re-check (stay window can exclude individual nights — Folio.php:2472-2482)
          const nightPromos =
            promosByRate.get(Number(item.rate_id)) ??
            (promoCode
              // @ts-ignore
              ? await findPromosForNight(prisma, BigInt(String(item.rate_id)), nightDate, getNight, promoCode)
              : []);

          const pricing = await priceNight({
            // @ts-ignore
            prisma,
            rateId: BigInt(String(item.rate_id)),
            roomTypeId: roomTypeIdEff,
            night: nightDate,
            getNight,
            adult: Number(item.adult || 1),
            child: Number(item.child || 0),
            quantity: isDayUse ? Number(item.quantity || 1) : 1,
            isTax,
            rateCodePost: gcCodePostById.get(rateCodePostMap.get(Number(item.rate_id)) ?? -1) ?? null,
            promos: nightPromos,
          });

          rows.push({
            date: nightDate,
            amountt: pricing.amount,
            pb1: pricing.pb1,
            service_charge: pricing.service_charge,
            quantity: 1,
          });
        }
      }
      const charge = await getRevenueCharge(rows);
      res.json({ code: 200, message: 'Success', data: charge });
    } catch (err: any) { console.error('Reservation get charge error:', err); error(res, 'Failed to get charge', 500); }
  }

  
  // GET /cms/reservation/available-room (Laravel getAvailableRoomType)
  
  static async availableRoomType(req: Request, res: Response): Promise<void> {
    try {
      const ci = req.query.check_in_date as string;
      const co = req.query.check_out_date as string;
      if (!ci || !co) { badRequest(res, 'The check in date field is required.'); return; }
      const days: string[] = [];
      const ciD = new Date(ci);
      const coD = new Date(co);
      for (let i = 0; i < Math.ceil((coD.getTime() - ciD.getTime()) / (1000 * 60 * 60 * 24)); i++) {
        const d = new Date(ciD);
        d.setDate(d.getDate() + i);
        days.push(d.toISOString().substring(0, 10));
      }

      const propertyId = req.user?.lastProperty;
      const [overbookings, rooms, workOrders] = await Promise.all([
        prisma.overbookings.findMany({ where: { property_id: propertyId ? BigInt(propertyId) : undefined, date: { gte: new Date(ci), lte: new Date(co) } } }),
        prisma.rooms.findMany({ where: { deleted_at: null, status: 1, property_id: propertyId ? BigInt(propertyId) : undefined }, select: { id: true, room_type_id: true, room_status: true } }),
        prisma.work_orders.findMany({ where: { deleted_at: null, status: 1, property_id: propertyId ? BigInt(propertyId) : undefined, room_id: { not: null }, date: { lte: new Date(ci) }, OR: [{ end_date: { gte: new Date(ci) } }, { end_date: null }] } }),
      ]);

      const roomTypes = await prisma.room_types.findMany({ where: { deleted_at: null, status: 1, property_id: propertyId ? BigInt(propertyId) : undefined } });
      const typeIds = roomTypes.map((t: any) => Number(t.id));
      const reservations = await prisma.reservations.findMany({
        where: { room_type_id: { in: typeIds }, date: { gte: new Date(ci), lte: new Date(co) } },
        include: { folios: { select: { status_reservation: true } } },
      });

      const overbookingByType = new Map<number, Map<string, number>>();
      for (const ob of overbookings) {
        const key = Number(ob.room_type_id);
        if (!overbookingByType.has(key)) overbookingByType.set(key, new Map());
        const m = overbookingByType.get(key)!;
        const d = fmtDateOnly(ob.date)!;
        m.set(d, (m.get(d) ?? 0) + Number(ob.overbooking));
      }

      const data: any[] = [];
      for (const rt of roomTypes) {
        const tid = Number(rt.id);
        const typeRooms = rooms.filter((r: any) => Number(r.room_type_id) === tid);
        const totalRoom = typeRooms.length;
        const blocked = typeRooms.filter((r: any) => r.room_status === ROOM_STATUSES.block.id).length;
        const roomIds = new Set(typeRooms.map((r: any) => Number(r.id)));
        const row: any = { id: tid, name: rt.name };
        for (const day of days) {
          const dayD = new Date(day);
          const outOfOrder = workOrders.filter((w: any) => roomIds.has(Number(w.room_id)) && ((w.date && w.date <= dayD && (w.end_date == null || w.end_date > dayD)))).length;
          const overbooking = overbookingByType.get(tid)?.get(day) ?? 0;
          const roomSold = reservations.filter((r: any) => {
            const fStatus = r.folios?.status_reservation;
            return fmtDateOnly(r.date) === day && Number(r.room_type_id) === tid && fStatus != null && fStatus !== STATUS_RESERVATION.pending.id && fStatus !== STATUS_RESERVATION.cancel_reservation.id;
          }).length;
          row[day.replace(/-/g, '-')] = totalRoom + overbooking - roomSold - blocked - outOfOrder;
        }
        data.push(row);
      }

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        ...days.map((day) => ({ label: day, key: day, type: 'none', is_search: false })),
      ];
const total = data.length;
      success(res, data, 'Success', 200, { table, pagination: paggingMetaLocal(total, 99999, parseInt(req.query.page as string) || 1), permission: { view: true, add: true, edit: true, delete: true } });
    } catch (err: any) { console.error('Reservation available room error:', err); error(res, 'Failed to get available room', 500); }
  }

  
  // GET /cms/reservation/room-git (Laravel getRoomGit)
  
  static async roomGit(req: Request, res: Response): Promise<void> {
    try {
      let arr: any[] = [];
      let ci = req.query.check_in_date as string;
      let co = req.query.check_out_date as string;
      let rateId: bigint | null = null;
      const hasFolio = req.query.folio_id && /^\d+$/.test(String(req.query.folio_id));
      if (hasFolio) {
        const folio = await prisma.folios.findUnique({ where: { id: BigInt(String(req.query.folio_id)) } });
        if (folio) {
          ci = fmtDateOnly(folio.check_in_date) || ci;
          co = fmtDateOnly(folio.check_out_date) || co;
          const childFolios = await prisma.folios.findMany({
            where: { parent: folio.id, status_reservation: { not: STATUS_RESERVATION.cancel_reservation.id } },
            include: { reservations: true },
          });
          for (const child of childFolios) {
            if (child.reservations.length > 0) {
              const r = child.reservations[0];
              arr.push({
                room_type_id: Number(r.room_type_id ?? 0),
                adult: Number(r.adult ?? 2),
                child: Number(r.child ?? 0),
              });
              if (!rateId && r.rate_id) rateId = r.rate_id;
            }
          }
        }
      }
      if (!ci || !co) { badRequest(res, 'The check in date field is required.'); return; }
      if (!rateId && req.query.rate_id && /^\d+$/.test(String(req.query.rate_id))) rateId = BigInt(String(req.query.rate_id));

      const table = [
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Qty Room Available', key: 'available', type: 'none', is_search: false },
        { label: 'Qty', key: 'qty', type: 'number', is_search: false },
      ];
      if (!hasFolio) {
        table.push(
          { label: 'Adult', key: 'adult', type: 'number', is_search: false },
          { label: 'Child', key: 'child', type: 'number', is_search: false },
        );
      }

      const [overbookings, availableIds] = await Promise.all([
        prisma.overbookings.findMany({ where: { property_id: req.user?.lastProperty ? BigInt(req.user.lastProperty) : undefined, date: { gte: new Date(ci), lte: new Date(co) } } }),
        req.user?.lastProperty ? onlyAvailableRoomIds(req.user.lastProperty, ci, co) : Promise.resolve(new Set<number>()),
      ]);

      const configValues: number[] = [];
      for (const [k, v] of Object.entries(req.query)) {
        if (k.startsWith('idx_') && v != null && /^\d+$/.test(String(v))) configValues.push(Number(v));
      }
      let configRoomIds: Set<number> | null = null;
      if (configValues.length > 0) {
        const links = await prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\Room', type_id: { in: configValues } }, select: { model_id: true, type_id: true } });
        const byType = new Map<number, Set<number>>();
        for (const l of links) {
          const tid = Number(l.type_id);
          if (!byType.has(tid)) byType.set(tid, new Set<number>());
          byType.get(tid)!.add(Number(l.model_id));
        }
        let accIds: number[] | null = null;
        for (const val of configValues) {
          const ids = [...(byType.get(val) ?? new Set<number>())];
          accIds = accIds === null ? ids : ids.filter((x) => accIds!.includes(x));
        }
        configRoomIds = accIds ? new Set<number>(accIds) : null;
      }

      // Laravel getRoomGit uses RoomType::onlyActive()->whereHas('raterate', rate_id = request->rate_id).
      // RoomType carries global scopes `hide_virtual` (is_physical=1) and `property` (property_id=last_property)
      // that the old query omitted, so virtual/other-property room types leaked into the GIT grid.
      const whereRT: any = { deleted_at: null, status: 1, is_physical: true };
      if (req.user?.lastProperty) whereRT.property_id = BigInt(req.user.lastProperty);
      // A null rate_id filters against SQL NULL and matches nothing — mirror that with an empty grid.
      if (!rateId) {
        success(res, [], 'Success', 200, { table, pagination: paggingMetaLocal(0, 9999, 1), permission: { view: true, add: true, edit: true, delete: true } });
        return;
      }
      whereRT.rate_rates = { some: { rate_id: rateId } };
      const roomTypes = await prisma.room_types.findMany({ where: whereRT, include: { rooms: { select: { id: true } } } });

      const overbookingMinByType = new Map<number, number>();
      for (const ob of overbookings) {
        const tid = Number(ob.room_type_id);
        const v = Number(ob.overbooking);
        overbookingMinByType.set(tid, Math.min(overbookingMinByType.get(tid) ?? Infinity, v));
      }

      const data: any[] = [];
      for (const rt of roomTypes) {
        const tid = Number(rt.id);
        let availRooms = rt.rooms.filter((r: any) => availableIds.has(Number(r.id))).length;
        if (configRoomIds !== null) {
          availRooms = rt.rooms.filter((r: any) => availableIds.has(Number(r.id)) && configRoomIds.has(Number(r.id))).length;
        }
        const min = overbookingMinByType.get(tid) ?? 0;
        const available = availRooms + (Number.isFinite(min) ? min : 0);
        const arrForType = arr.filter((a: any) => a.room_type_id === tid);
        data.push({
          id: tid,
          room_type: rt.name,
          available,
          description: rt.description,
          qty: arrForType.length,
          adult: arrForType.length > 0 ? (arrForType[0].adult ?? 2) : 2,
          child: arrForType.length > 0 ? (arrForType[0].child ?? 0) : 0,
          item: bigintToNumber(rt),
        });
      }
const filtered = data.filter((d: any) => d.available > 0);
      const totalData = filtered.length;
      success(res, filtered, 'Success', 200, { table, pagination: paggingMetaLocal(totalData, 9999, 1), permission: { view: true, add: true, edit: true, delete: true } });
    } catch (err: any) { console.error('Reservation room git error:', err); error(res, 'Failed to get room git', 500); }
  }

  
  // PUT /cms/reservation/update-room-parent-git/:id (Laravel updateRoomParentGIT)
  
  static async updateRoomParentGIT(req: Request, res: Response): Promise<void> {
    try {
      const raw =
        (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) ??
        (req.body as any)?.folio_id;
      const body = req.body || {};
      // The room-allot grid emits `reservation_list` as an index-keyed OBJECT
      // (`{0: {...}, 1: {...}}`), not an array. Rejecting that shape made the
      // request 400 and meant no p-block could ever be added or removed.
      const reservationList: any[] = Array.isArray(body.reservation_list)
        ? body.reservation_list
        : body.reservation_list && typeof body.reservation_list === 'object'
        ? Object.values(body.reservation_list).filter((v: any) => v && typeof v === 'object')
        : [];
      if (!raw || !/^\d+$/.test(String(raw))) { badRequest(res, 'The folio id field is required.'); return; }
      if (reservationList.length === 0) { badRequest(res, 'The reservation list field is required.'); return; }
      const folioId = BigInt(raw);

      const folio = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }
      const children = await prisma.folios.findMany({
        where: { parent: folioId, status_reservation: { not: STATUS_RESERVATION.cancel_reservation.id } },
        // Laravel only ever reads the first night of each child
        // (`$getChildFolio->reservation->first()`), so pulling every night of every
        // child was pure overhead on a 20-room block.
        include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1 } },
        // Laravel picks the replication template with `childFolio()->orderBy('id','desc')->first()`.
        // The findMany had no orderBy, so `children[children.length - 1]` below picked an
        // arbitrary block and the new p-block inherited the wrong rate / adult / child.
        orderBy: { id: 'asc' },
      });
      const arr: any[] = [];
      let rateId: bigint | null = null;
      for (const child of children) {
        if (child.reservations.length > 0) {
          const r = child.reservations[0];
          arr.push({ folio_id: Number(child.id), room_type_id: Number(r.room_type_id ?? 0) });
          if (!rateId && r.rate_id) rateId = r.rate_id;
        }
      }
      const ci = fmtDateOnly(folio.check_in_date) || '';
      const co = fmtDateOnly(folio.check_out_date) || '';
      if (!ci || !co) { badRequest(res, 'Check in date required'); return; }

      const [overbookings, availableIds] = await Promise.all([
        prisma.overbookings.findMany({ where: { property_id: folio.property_id ? BigInt(folio.property_id) : undefined, date: { gte: new Date(ci), lte: new Date(co) } } }),
        folio.property_id ? onlyAvailableRoomIds(folio.property_id, ci, co) : Promise.resolve(new Set<number>()),
      ]);

      // Must resolve to the SAME room-type set the room-git grid posted, otherwise a
      // row the user typed a Qty into is missing here and the delta below falls back
      // to `0 - currentQty`, silently REMOVING blocks instead of adding them.
      // roomGit (:5825) scopes by is_physical + property + rate; mirror it exactly.
      const whereRT: any = { deleted_at: null, status: 1, is_physical: true };
      if (req.user?.lastProperty) whereRT.property_id = BigInt(req.user.lastProperty);
      if (rateId) whereRT.rate_rates = { some: { rate_id: rateId } };
      const roomTypes = await prisma.room_types.findMany({ where: whereRT, include: { rooms: { select: { id: true } } } });

      const overbookingMinByType = new Map<number, number>();
      for (const ob of overbookings) {
        const tid = Number(ob.room_type_id);
        const v = Number(ob.overbooking);
        overbookingMinByType.set(tid, Math.min(overbookingMinByType.get(tid) ?? Infinity, v));
      }

      const data: any[] = [];
      for (const rt of roomTypes) {
        const tid = Number(rt.id);
        const availRooms = rt.rooms.filter((r: any) => availableIds.has(Number(r.id))).length;
        const min = overbookingMinByType.get(tid) ?? 0;
        const arrForType = arr.filter((a: any) => a.room_type_id === tid);
        data.push({
          id: tid,
          room_type: rt.name,
          available: availRooms + (Number.isFinite(min) ? min : 0),
          description: rt.description,
          qty: arrForType.length,
          folio_id: arrForType.map((a: any) => a.folio_id),
        });
      }

      const arrTemp: any[] = [];
      for (const value of data) {
        const checkQty = reservationList.find((rl: any) => String(rl.id) === String(value.id));
        const newQty = checkQty ? Number(checkQty.qty) - value.qty : 0 - value.qty;
        if (value.available < newQty) {
          res.status(400).json({ code: 400, newQty, available: value.available, message: `Room Type ${value.room_type} is not available` });
          return;
        }
        arrTemp.push({ room_type_id: value.id, qty: newQty, folio_id: value.folio_id });
      }

      const businessDate = (await import('../controllers/auth.controller')).AuthController.getBusinessDate(folio.property_id);
      // Laravel derives the suffix from `$folio->childFolio()->get()` = ALL children,
      // cancelled ones included (:3185). Deriving it from `children` (which filters
      // cancelled out) let a removed block's number get handed out again.
      const allChildNumbers = await prisma.folios.findMany({
        where: { parent: folioId },
        select: { folio_number: true },
      });
      const numberIndexRaw = allChildNumbers.length > 0
        ? Math.max(
            ...allChildNumbers.map((c: any) => {
              const last = String(c.folio_number ?? '').split('/').pop();
              const n = parseInt(last ?? '0', 10);
              return Number.isNaN(n) ? 0 : n;
            }),
          ) + 1
        : 1;
      let numberIndex = Number.isFinite(numberIndexRaw) ? numberIndexRaw : 1;

      // Pricing context for the replicated nights. A p-block created through
      // this endpoint used to be written with amount/total/pb1/tax3 all zero and
      // no priceNight call at all, so every room added to a group after creation
      // was worth nothing on the folio.
      const propertyRow = await prisma.properties.findUnique({ where: { id: BigInt(folio.property_id) }, select: { is_tax: true } });
      const isTax = (propertyRow as any)?.is_tax === 1;
      const sourceRateIds = [...new Set(children.flatMap((c: any) => (c.reservations ?? []).map((r: any) => r.rate_id)).filter((r: any) => r != null).map((r: any) => String(r)))];
      const rateRows = sourceRateIds.length
        ? await prisma.rates.findMany({
            where: { id: { in: sourceRateIds.map((r) => BigInt(r)) } },
            select: { id: true, code_post_id: true, code_post_extra_bed_id: true, name: true },
          })
        : [];
      const codePostIds = [...new Set(rateRows.flatMap((r) => [r.code_post_id, r.code_post_extra_bed_id]).filter(Boolean))] as bigint[];
      const codePostRows = codePostIds.length ? await prisma.code_posts.findMany({ where: { id: { in: codePostIds } } }) : [];
      const codePostById = new Map<number, any>(codePostRows.map((c) => [Number(c.id), c]));

      // Market Segment + Source carried down from the master folio.
      // Laravel :3160-3183 merges these onto the request and then calls
      // `$folioReplicate->syncTypes($request)` on every new p-block (:3211). Without
      // it a room added to an existing block had no segment at all.
      const masterSegments = await folioMarketSegments(folioId).catch(() => ({}) as Record<string, bigint>);

      // Laravel wraps the whole block in DB::beginTransaction() (:3097) and rolls
      // back on the "not available" branch. Node had no transaction at all, so a
      // throw halfway through left orphaned p-blios with no nights behind them.
      const bd = await businessDate;
      const nights = Math.max(1, Math.ceil((new Date(co).getTime() - new Date(ci).getTime()) / (1000 * 60 * 60 * 24)));
      const newFolioIds: bigint[] = [];

      await prisma.$transaction(
        async (tx) => {
          for (const value of arrTemp) {
            if (value.qty > 0) {
              for (let i = 0; i < value.qty; i++) {
                let sourceChild: any;
                if (!value.folio_id || value.folio_id.length === 0) {
                  // children is id-asc, so the last entry is the highest id -
                  // Laravel's `childFolio()->orderBy('id','desc')->first()`.
                  sourceChild = children[children.length - 1];
                } else {
                  sourceChild = children.find((c: any) => value.folio_id.includes(Number(c.id)));
                }
                if (!sourceChild) continue;
                // `reservations` is a RELATION, not a column. The destructure below
                // left it inside copyFields, so prisma.folios.create() got
                //   Argument `reservations`: Invalid value provided. Expected
                //   reservationsUncheckedCreateNestedManyWithoutFoliosInput
                // -> PrismaClientValidationError -> caught -> 500. Every "Add Room"
                // on a GIT master folio died here before writing a single row.
                // Laravel's replicate() strips relations for exactly this reason.
                const {
                  id: _srcId,
                  folio_number: _srcNum,
                  created_at: _ca,
                  updated_at: _ua,
                  reservations: _srcRes,
                  ...copyFields
                } = sourceChild;

                let newFolioNumber = `${folio.folio_number}/${String(numberIndex).padStart(3, '0')}`;
                let exists = await tx.folios.findFirst({ where: { folio_number: newFolioNumber } });
                while (exists) {
                  numberIndex++;
                  newFolioNumber = `${folio.folio_number}/${String(numberIndex).padStart(3, '0')}`;
                  exists = await tx.folios.findFirst({ where: { folio_number: newFolioNumber } });
                }

                const checkInDate =
                  folio.check_in_date && folio.check_in_date < new Date(bd) ? new Date(bd) : folio.check_in_date;
                let replicated: any;
                // folio_number is @unique; the findFirst loop above is check-then-insert,
                // so a concurrent Add Room can still collide. Retry on P2002 like
                // createFolioWithRetry does instead of failing the whole request.
                for (let attempt = 0; attempt < 5; attempt++) {
                  try {
                    replicated = await tx.folios.create({
                      data: {
                        ...copyFields,
                        parent: folioId,
                        folio_number: newFolioNumber,
                        type_reservation: folio.type_reservation,
                        check_in_date: checkInDate,
                        check_out_date: folio.check_out_date,
                        status_reservation: STATUS_RESERVATION.reservation.id,
                        created_at: new Date(),
                        updated_at: new Date(),
                      },
                    });
                    break;
                  } catch (e: any) {
                    if (e?.code !== 'P2002' || attempt === 4) throw e;
                    numberIndex++;
                    newFolioNumber = `${folio.folio_number}/${String(numberIndex).padStart(3, '0')}`;
                  }
                }
                if (!replicated) continue;
                numberIndex++;
                newFolioIds.push(replicated.id);

                const sourceReservation = sourceChild.reservations?.[0];
                if (!sourceReservation) continue;

                for (let n = 0; n < nights; n++) {
                  const nightDate = new Date(ci);
                  nightDate.setDate(nightDate.getDate() + n);
                  const pricing = await priceNight({
                    // @ts-ignore
                    prisma: tx,
                    rateId: sourceReservation.rate_id,
                    roomTypeId: BigInt(value.room_type_id),
                    night: nightDate,
                    getNight: nights,
                    adult: Number(sourceReservation.adult || 1),
                    child: Number(sourceReservation.child || 0),
                    quantity: 1,
                    isTax,
                    rateCodePost: sourceReservation.rate_id
                      ? codePostById.get(Number(rateRows.find((r) => Number(r.id) === Number(sourceReservation.rate_id))?.code_post_id ?? -1)) ?? null
                      : null,
                    promos: [],
                  });
                  const created = await tx.reservations.create({
                    data: await withReservationNames({
                      property_id: sourceReservation.property_id,
                      folio_id: replicated.id,
                      company_profile_id: sourceReservation.company_profile_id,
                      rate_id: sourceReservation.rate_id,
                      eta: sourceReservation.eta,
                      etd: sourceReservation.etd,
                      room_type_id: BigInt(value.room_type_id),
                      room_id: null,
                      check_in_date: new Date(ci),
                      check_out_date: new Date(co),
                      adult: sourceReservation.adult,
                      child: sourceReservation.child,
                      add_bed: sourceReservation.add_bed,
                      date: nightDate,
                      status_reservation: STATUS_RESERVATION.reservation.id,
                      status: STATUS_ACTIVE,
                      night: nights,
                      amount: pricing.amount,
                      amountt: pricing.amount,
                      total: pricing.total,
                      service_charge: pricing.service_charge,
                      pb1: pricing.pb1,
                      tax3: pricing.tax3,
                      data: JSON.stringify({
                        rate_price: pricing.rate_price,
                        service: pricing.service_charge,
                        pb1: pricing.pb1,
                        tax3: pricing.tax3,
                        total: pricing.total,
                      }),
                      created_by: req.user?.id,
                    }),
                  });
                  await syncReservationTypes(created.id, masterSegments, tx);
                }
                await syncTypesPivot('App\\Models\\Folio', replicated.id, masterSegments, tx);
                // Laravel saveReservation (:3235) rebuilds the sub-folio ledgers; without
                // them a room added to an existing block had nowhere to post charges.
                await rebuildFolioLedgers(
                  replicated.id,
                  BigInt(replicated.property_id),
                  replicated.company_profile_id ?? null,
                  replicated.guest_profile_id ?? null,
                  tx,
                );
              }
            } else if (value.qty < 0) {
              // Newest block first, each cancelled once; checked-in/out blocks skipped.
              const cancelCandidates = (value.folio_id.length > 0 ? children.filter((c: any) => value.folio_id.includes(Number(c.id))) : [])
                .filter((c: any) => c.status_reservation !== STATUS_RESERVATION.check_in.id && c.status_reservation !== STATUS_RESERVATION.check_out.id)
                .sort((a: any, b: any) => Number(b.id) - Number(a.id));
              for (let i = 0; i < Math.abs(value.qty); i++) {
                const cancelTarget = cancelCandidates[i];
                if (!cancelTarget) break;
                await tx.folios.update({
                  where: { id: cancelTarget.id },
                  data: {
                    status_reservation: STATUS_RESERVATION.cancel_reservation.id,
                    parent: 0,
                    remark: `Deleted from Parent GIT => ${folio.folio_number}`,
                  },
                });
              }
            }
          }
        },
        { timeout: 60000, maxWait: 15000 },
      );

      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'folios',
        event: 'updated',
        subjectId: folioId,
        name: 'git-block-updated',
        description: `GIT block adjusted on folio ${folio.folio_number ?? folioId}`,
        logName: 'front_desk',
        meta: {
          folio_number: folio.folio_number,
          type_reservation: folio.type_reservation,
          deltas: arrTemp.map((v: any) => ({ room_type_id: v.room_type_id, qty: v.qty })),
          requested: reservationList.map((r: any) => ({ id: r.id, qty: r.qty })),
          added_folios: newFolioIds.map((x) => Number(x)),
        },
      });

      res.json({ code: 200, message: 'Success', data: arrTemp });
    } catch (err: any) {
      console.error('Reservation update room parent git error:', err);
      error(res, err?.message || 'Failed to update room parent git', 500);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Reservation sub-resource parity ports (Laravel cms.php:951-966)
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /reservation/folio — Laravel getFolio (:4114): autocomplete folio list.
  // FE autocomplete appends ?search=word / &search=word; rows are {id,name}.
  static async folioList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const typeReservationParam = req.query['type-reservation'] as string;

      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      // Laravel explode('-', 'vr-fit') -> ['vr','fit'] whereIn type_reservation
      if (typeReservationParam) {
        const types = String(typeReservationParam).split('-').filter(Boolean);
        if (types.length > 0) where.type_reservation = { in: types };
      }
      if (search) {
        const companies = await prisma.company_profiles.findMany({
          where: { property_id: pid, name: { contains: search, mode: 'insensitive' } },
          select: { id: true },
          take: 50,
        });
        where.OR = [
          { folio_number: { contains: search, mode: 'insensitive' } },
          { guest_profiles: { OR: [{ first_name: { contains: search, mode: 'insensitive' } }, { last_name: { contains: search, mode: 'insensitive' } }] } },
          ...(companies.length > 0 ? [{ company_profile_id: { in: companies.map((c) => c.id) } }] : []),
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.folios.findMany({
          where,
          select: {
            id: true,
            folio_number: true,
            first_name: true,
            last_name: true,
            guest_profiles: { select: { first_name: true, last_name: true } },
            reservations: {
              where: { deleted_at: null },
              orderBy: { date: 'asc' },
              take: 1,
              select: { room_name: true, room_types: { select: { name: true } } },
            },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.folios.count({ where }),
      ]);

      const data = rows.map((f: any) => {
        const guestName = `${f.guest_profiles?.first_name ?? f.first_name ?? ''} ${f.guest_profiles?.last_name ?? f.last_name ?? ''}`.trim();
        const reservation = f.reservations?.[0];
        const roomType = reservation?.room_types?.name ?? '-';
        const roomName = reservation?.room_name ?? '-';
        return { id: Number(f.id), name: `${f.folio_number} - ${guestName} - ${roomType} - ${roomName}` };
      });

      const table = [{ label: 'Name', key: 'name', type: 'none', is_search: false }];
      success(res, data, 'Success', 200, {
        table,
        permission: { view: true },
        pagination: { current_page: page, last_page: Math.max(1, Math.ceil(total / limit)), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Reservation folio list error:', err); error(res, 'Failed to list folios', 500); }
  }

  // GET /reservation/ledger/:folio — Laravel getLedger (:4179) + Folio::getListLedger
  // (Folio.php:1108-1136): company profile + guest profile + other guests.
  static async ledgerList(req: Request, res: Response): Promise<void> {
    try {
      const folioIdRaw = Array.isArray(req.params.folio) ? req.params.folio[0] : req.params.folio;
      if (!folioIdRaw || !/^\d+$/.test(folioIdRaw)) { notFound(res, 'Folio not found'); return; }
      const folio: any = await prisma.folios.findFirst({
        where: { id: BigInt(folioIdRaw), deleted_at: null },
        include: { guest_profiles: { select: { first_name: true, last_name: true } } },
      });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      const list: { value: string; label: string }[] = [];
      if (folio.company_profile_id) {
        const cp = await prisma.company_profiles.findUnique({ where: { id: BigInt(folio.company_profile_id) }, select: { name: true } });
        if (cp) list.push({ value: `${folio.company_profile_id}-company`, label: cp.name ?? '' });
      }
      if (folio.guest_profile_id && folio.guest_profiles) {
        list.push({
          value: `${Number(folio.guest_profile_id)}-guest`,
          label: `${folio.guest_profiles.first_name ?? ''} ${folio.guest_profiles.last_name ?? ''}`.trim(),
        });
      }
      const others = await prisma.other_guests.findMany({ where: { folio_id: Number(folio.id) }, orderBy: { id: 'desc' } });
      const otherIds = [...new Set(others.map((o) => BigInt(o.guest_profile_id)))];
      if (otherIds.length > 0) {
        const gps = await prisma.guest_profiles.findMany({ where: { id: { in: otherIds } }, select: { id: true, first_name: true, last_name: true } });
        const gpMap = new Map(gps.map((g) => [Number(g.id), g]));
        for (const o of others) {
          const g = gpMap.get(Number(o.guest_profile_id));
          if (g) list.push({ value: `${Number(g.id)}-guest`, label: `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() });
        }
      }

      success(res, list, 'Success', 200);
    } catch (err: any) { console.error('Reservation ledger list error:', err); error(res, 'Failed to list ledger', 500); }
  }

  // Resolve folio id with Laravel subfolio_id fallback quirk (:3548):
  // subfolio_id != 'null' && != '' -> subfolio_id else folio_id.
  private static resolveTargetFolioId(body: any): bigint | null {
    const sub = body?.subfolio_id;
    const main = body?.folio_id;
    const chosen = sub !== undefined && sub !== null && String(sub) !== 'null' && String(sub) !== '' ? sub : main;
    if (chosen === undefined || chosen === null || !/^\d+$/.test(String(chosen))) return null;
    return BigInt(chosen);
  }

  // POST /reservation/code-item — Laravel storeAdditionalItem (:3539).
  // Attaches selected code_items to the folio via model_has_code_items (@@ignore -> raw SQL).
  static async additionalItemStore(req: Request, res: Response): Promise<void> {
    try {
      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'The folio id field is required.'); return; }
      const idx: any[] = Array.isArray(body.idx) ? body.idx : (body.idx !== undefined ? [body.idx] : []);
      const idxNums = idx.map((v: any) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
      if (idxNums.length === 0) { notFound(res, 'The idx field is required.'); return; }

      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      // Laravel Folio::lastReservation scope: is_posting=0, orderBy date asc
      const reservation = await prisma.reservations.findFirst({ where: { folio_id: folio.id, is_posting: 0, deleted_at: null }, orderBy: { date: 'asc' } });

      for (const value of idxNums) {
        const dup = await prisma.$queryRaw<any[]>(
          Prisma.sql`SELECT code_item_id FROM model_has_code_items WHERE code_item_id = ${BigInt(value)} AND model_type = ${'App\\Models\\Folio'} AND model_id = ${folio.id} LIMIT 1`
        );
        if (dup.length > 0) continue;

        // Laravel prefers the rate-linked pivot row's attributes, falling back to the master CodeItem.
        let source: any = null;
        if (reservation?.rate_id) {
          const rateLinked = await prisma.$queryRaw<any[]>(
            Prisma.sql`SELECT * FROM model_has_code_items WHERE model_type = ${'App\\Models\\Rate'} AND model_id = ${reservation.rate_id} AND code_item_id = ${BigInt(value)} LIMIT 1`
          );
          if (rateLinked.length > 0) source = rateLinked[0];
        }
        if (!source) {
          source = await prisma.code_items.findUnique({ where: { id: BigInt(value) } });
        }

        // Laravel: start_date = max(businessDate, folio.check_in_date) (LogAudit::getBusinessDate)
        const businessDateStr = await AuthController.getBusinessDate(folio.property_id ?? null);
        const businessDate = businessDateStr ? new Date(`${businessDateStr}T00:00:00`) : new Date();
        const checkIn = folio.check_in_date ? new Date(folio.check_in_date) : businessDate;
        const startDate = checkIn < businessDate ? businessDate : checkIn;

        const processOn = source?.process_on ?? null;
        const endDate = processOn === 'ACTUAL' ? startDate : (folio.check_out_date ? new Date(folio.check_out_date) : startDate);

        // NOTE Laravel quirk preserved: code_post_id stores CodeItem::find($value)->id
        // (the code item's own id), NOT its code_post relation (Laravel storeAdditionalItem).
        await prisma.$executeRaw`
          INSERT INTO model_has_code_items
            (model_id, model_type, code_item_id, reason, start_date, end_date, sales, process_on, code_post_id, upsales, name, description)
          VALUES
            (${folio.id}, ${'App\\Models\\Folio'}, ${BigInt(value)}, '',
             ${startDate}, ${endDate}, ${source?.sales ?? null}, ${processOn},
             ${Number(source?.id ?? value)}, '', ${source?.name ?? null}, ${source?.description ?? null})
        `;
      }
      await prisma.folios.update({ where: { id: folio.id }, data: { updated_at: new Date() } });

      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Additional item store error:', err); error(res, err?.message ?? 'Failed to store additional items', 500); }
  }

  // PUT /reservation/code-item/:codeItem — Laravel updateAdditionalItem (:3616).
  // Updates folio-attached pivot rows for that code_item (dates must stay inside folio range).
  static async additionalItemUpdate(req: Request, res: Response): Promise<void> {
    try {
      const codeItemIdRaw = Array.isArray(req.params.codeItem) ? req.params.codeItem[0] : req.params.codeItem;
      if (!codeItemIdRaw || !/^\d+$/.test(codeItemIdRaw)) { notFound(res, 'Not Found codeItem'); return; }
      const codeItemId = BigInt(codeItemIdRaw);

      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'Folio not found'); return; }
      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      const { start_date, end_date, sales, upsales, name, description, reason } = body;
      const start = start_date ? new Date(start_date) : null;
      const end = end_date ? new Date(end_date) : null;
      if (!start || !end) { badRequest(res, 'Start date and end date are required'); return; }
      if (start < new Date(folio.check_in_date) || end > new Date(folio.check_out_date)) {
        badRequest(res, 'Start date and end date must be in range folio date'); return;
      }
      if (end < start) { badRequest(res, 'End date must be greater than start date'); return; }

      await prisma.$executeRaw`
        UPDATE model_has_code_items SET
          reason = ${reason ?? ''},
          start_date = ${start},
          end_date = ${end},
          sales = ${sales ?? null},
          upsales = ${upsales !== undefined && upsales !== null ? String(upsales) : ''},
          name = ${name ?? null},
          description = ${description ?? null}
        WHERE code_item_id = ${codeItemId} AND model_type = ${'App\\Models\\Folio'} AND model_id = ${folio.id}
      `;
      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Additional item update error:', err); error(res, 'Failed to update additional item', 500); }
  }

  // DELETE /reservation/code-item/:codeItem — Laravel deleteAdditionalItem (:3663).
  static async additionalItemDestroy(req: Request, res: Response): Promise<void> {
    try {
      const codeItemIdRaw = Array.isArray(req.params.codeItem) ? req.params.codeItem[0] : req.params.codeItem;
      if (!codeItemIdRaw || !/^\d+$/.test(codeItemIdRaw)) { notFound(res, 'Not Found codeItem'); return; }

      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'Folio not found'); return; }
      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      await prisma.$executeRaw`
        DELETE FROM model_has_code_items
        WHERE code_item_id = ${BigInt(codeItemIdRaw)} AND model_type = ${'App\\Models\\Folio'} AND model_id = ${folio.id}
      `;
      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Additional item destroy error:', err); error(res, 'Failed to delete additional item', 500); }
  }

  // POST /reservation/inclusive — Laravel storeInclusives (:3797).
  // Attaches rate_inclusives to the folio via model_has_rate_inclusives pivot.
  static async inclusiveStore(req: Request, res: Response): Promise<void> {
    try {
      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'The folio id field is required.'); return; }
      const idx: any[] = Array.isArray(req.body.idx) ? req.body.idx : (req.body.idx !== undefined ? [req.body.idx] : []);
      const idxNums = idx.map((v: any) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
      if (idxNums.length === 0) { notFound(res, 'The idx field is required.'); return; }

      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      for (const value of idxNums) {
        const dup = await prisma.model_has_rate_inclusives.findFirst({
          where: { rate_inclusive_id: BigInt(value), model_type: 'App\\Models\\Folio', model_id: folio.id },
        });
        if (dup) continue;
        // NOTE: Laravel also writes code_item_id=$value into this pivot (quirk);
        // Prisma model has no such column, so only the morph keys are set.
        await prisma.model_has_rate_inclusives.create({
          data: { rate_inclusive_id: BigInt(value), model_type: 'App\\Models\\Folio', model_id: folio.id },
        });
      }
      await prisma.folios.update({ where: { id: folio.id }, data: { updated_at: new Date() } });

      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Inclusive store error:', err); error(res, err?.message ?? 'Failed to store inclusives', 500); }
  }

  // DELETE /reservation/inclusive/:rateInclusive — Laravel deleteInclusives (:3845) detach.
  static async inclusiveDestroy(req: Request, res: Response): Promise<void> {
    try {
      const rateInclusiveRaw = Array.isArray(req.params.rateInclusive) ? req.params.rateInclusive[0] : req.params.rateInclusive;
      if (!rateInclusiveRaw || !/^\d+$/.test(rateInclusiveRaw)) { notFound(res, 'Not Found rateInclusive'); return; }

      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'Folio not found'); return; }
      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      await prisma.model_has_rate_inclusives.deleteMany({
        where: { rate_inclusive_id: BigInt(rateInclusiveRaw), model_type: 'App\\Models\\Folio', model_id: folio.id },
      });
      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Inclusive destroy error:', err); error(res, 'Failed to delete inclusive', 500); }
  }
}

