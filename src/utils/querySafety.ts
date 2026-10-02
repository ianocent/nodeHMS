import { Prisma } from '@prisma/client';

/**
 * Schema-aware query helpers.
 *
 * Laravel parity rationale:
 *  - AppServiceProvider::macro('sort') strips a leading '-' and only orders by a
 *    column that really exists on the model; anything else is silently dropped.
 *  - macro('search_field') skips '', '-1' and 'undefined' before building the
 *    where clause.
 *  - SoftDeletes always adds `deleted_at IS NULL`.
 *
 * Prisma throws on unknown columns / wrong scalar types, so the same guards are
 * implemented here on top of the generated DMMF instead of hand-written lists.
 */

interface ScalarField {
  name: string;
  type: string;
}

const scalarCache = new Map<string, Map<string, ScalarField>>();

function scalarsOf(model: string): Map<string, ScalarField> {
  const cached = scalarCache.get(model);
  if (cached) return cached;
  const found = new Map<string, ScalarField>();
  const datamodel = Prisma.dmmf?.datamodel?.models ?? [];
  const definition = datamodel.find((m) => m.name === model);
  if (definition) {
    for (const field of definition.fields) {
      if (field.kind !== 'scalar') continue;
      found.set(field.name, { name: field.name, type: field.type });
    }
  }
  scalarCache.set(model, found);
  return found;
}

export function modelExists(model: string): boolean {
  return (Prisma.dmmf?.datamodel?.models ?? []).some((m) => m.name === model);
}

export function hasField(model: string, field: string): boolean {
  return scalarsOf(model).has(field);
}

export function fieldType(model: string, field: string): string | undefined {
  return scalarsOf(model).get(field)?.type;
}

const IGNORED_TOKENS = new Set(['', '-1', 'undefined', 'null', 'nan', 'false']);

/** Laravel macro('search_field') skip-list. */
export function isIgnoredSearchToken(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const raw = String(value).trim();
  return IGNORED_TOKENS.has(raw);
}

function toBoolean(value: unknown): boolean | undefined {
  const raw = String(value).trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(raw)) return true;
  if (['false', '0', 'off', 'no'].includes(raw)) return false;
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  const raw = String(value).trim();
  if (raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toDate(value: unknown): Date | undefined {
  const parsed = new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Coerces a raw query-string value into the scalar type the column expects.
 * Returns undefined when the value cannot be represented, so callers can drop
 * the predicate instead of handing Prisma a value it will reject.
 */
export function coerceValue(type: string, value: unknown): unknown {
  const isList = type.endsWith('[]');
  const base = isList ? type.slice(0, -2) : type;
  if (isList) {
    const list = String(value).split(',').map((part) => coerceValue(base, part.trim()));
    const filtered = list.filter((item) => item !== undefined);
    return filtered.length ? filtered : undefined;
  }
  switch (base) {
    case 'Int':
    case 'Float':
    case 'Decimal':
      return toNumber(value);
    case 'BigInt':
      return toNumber(value);
    case 'Boolean':
      return toBoolean(value);
    case 'DateTime':
      return toDate(value);
    default:
      return String(value);
  }
}

const EXACT_SCALARS = new Set(['Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json']);

/** Builds one search predicate for a single column, or undefined to skip it. */
export function searchPredicate(
  model: string,
  field: string,
  value: unknown,
  mode: 'exact' | 'contains' = 'contains'
): Record<string, any> | undefined {
  if (!field || isIgnoredSearchToken(value)) return undefined;
  const type = fieldType(model, field);
  if (!type) return undefined;
  if (type.endsWith('[]')) {
    const coerced = coerceValue(type, value);
    if (!Array.isArray(coerced) || coerced.length === 0) return undefined;
    return { [field]: { has: coerced[0] } };
  }
  const coercedValue = coerceValue(type, value);
  if (coercedValue === undefined) return undefined;
  if (mode === 'exact' || EXACT_SCALARS.has(type)) return { [field]: { equals: coercedValue } };
  return { [field]: { contains: String(value), mode: 'insensitive' } };
}

export function pushCondition(where: Record<string, any>, condition: Record<string, any> | undefined): void {
  if (!condition) return;
  const existing: any[] = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  existing.push(condition);
  where.AND = existing;
}

export interface SearchFieldOptions {
  model: string;
  /** Column names that must not become a `contains` predicate (primary keys, FKs of other tables, virtual/computed columns). */
  skip?: string[];
  /** Forces exact match for these columns even when Prisma would accept contains. */
  exact?: string[];
}

function parseSearchPairs(req: { query: Record<string, any> }): Array<{ field: string; value: unknown }> {
  const rawFields = String(req.query.search_field ?? '').split(';');
  const rawValues = String(req.query.search_value ?? '').split(';');
  const pairs: Array<{ field: string; value: unknown }> = [];
  rawFields.forEach((rawField, index) => {
    const field = String(rawField).trim();
    if (!field || isIgnoredSearchToken(field)) return;
    pairs.push({ field, value: rawValues[index] });
  });
  return pairs;
}

/**
 * Laravel Model::scopeSearchField parity, hardened for Prisma.
 * Unknown/virtual columns are dropped, values are coerced to the column type,
 * and every predicate is ANDed so `contains` never widens an existing filter.
 */
export function buildSearchWhere(
  req: { query: Record<string, any> },
  options: SearchFieldOptions
): Record<string, any> {
  const conditions: Array<Record<string, any>> = [];
  const skip = new Set(options.skip ?? []);
  for (const { field, value } of parseSearchPairs(req)) {
    if (skip.has(field)) continue;
    const mode = options.exact?.includes(field) ? 'exact' : 'contains';
    const predicate = searchPredicate(options.model, field, value, mode);
    if (predicate) conditions.push(predicate);
  }
  return conditions.length ? { AND: conditions } : {};
}

export type SafeOrderBy = Record<string, Prisma.SortOrder>;

/**
 * Laravel macro('sort') parity. Accepts `-column`, validates the column against
 * the schema and never throws for unknown keys.
 */
export function safeOrderBy(
  model: string,
  sort: unknown,
  fallback?: SafeOrderBy
): SafeOrderBy {
  const result: SafeOrderBy = {};
  const raw = Array.isArray(sort) ? sort[0] : sort;
  const token = String(raw ?? '').trim();
  if (token && !isIgnoredSearchToken(token)) {
    const descending = token.startsWith('-');
    const column = descending ? token.slice(1).trim() : token;
    if (column && hasField(model, column)) result[column] = descending ? 'desc' : 'asc';
  }
  return Object.keys(result).length ? result : fallback ?? {};
}

/**
 * Laravel SoftDeletes + scopeHasProperties parity for read queries that must
 * never surface soft-deleted rows, rows from another property, or inactive
 * master data.
 */
export function activeWhere(model: string, where: Record<string, any> = {}, propertyId?: bigint | null): Record<string, any> {
  const result: Record<string, any> = { ...where };
  if (hasField(model, 'deleted_at') && result.deleted_at === undefined) result.deleted_at = null;
  if (propertyId != null && hasField(model, 'property_id') && result.property_id === undefined) {
    result.property_id = propertyId;
  }
  if (hasField(model, 'status') && result.status === undefined) result.status = activeStatusValue(model);
  return result;
}

/**
 * App\Traits\HasStatus whitelist (hms-backend/app/Traits/HasStatus.php:20-42).
 * Only these tables get the implicit `status = 1` filter.
 */
export const HAS_STATUS_TABLES = new Set([
  'users',
  'properties',
  'companies',
  'rates',
  'bars',
  'promotions',
  'allotments',
  'baggages',
  'car_parks',
  'guest_profiles',
  'company_profiles',
  'code_billings',
  'code_gls',
  'code_items',
  'code_posts',
  'type_payments',
  'room_types',
  'rooms',
  'countries',
  'cities',
  'types',
]);

/** `status` is Boolean on countries/cities and Int everywhere else. */
function activeStatusValue(model: string): unknown {
  return fieldType(model, 'status') === 'Boolean' ? true : 1;
}

/**
 * Laravel HasStatus::bootHasStatus parity. The scope only fires on a GET that
 * carries `group` (the frontend table always sends it) and is skipped when the
 * caller is explicitly filtering on `status`.
 */
export function applyStatusScope(
  where: Record<string, any>,
  req: { method?: string; query: Record<string, any> },
  model: string
): void {
  if (!HAS_STATUS_TABLES.has(model)) return;
  if (where.status !== undefined) return;
  const group = req.query?.group;
  if (group === undefined || group === null || String(group) === '') return;
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return;
  const searchFields = String(req.query?.search_field ?? '').split(';').map((f) => f.trim());
  if (searchFields.includes('status')) return;
  if (!hasField(model, 'status')) return;
  where.status = activeStatusValue(model);
}

export function currentPropertyId(req: { user?: { lastProperty?: bigint | null } }): bigint | null {
  return req.user?.lastProperty ?? null;
}