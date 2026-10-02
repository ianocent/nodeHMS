import { Request } from 'express';
import { buildSearchWhere, isIgnoredSearchToken, pushCondition } from './querySafety';

/**
 * Laravel data_search() parity — builds search_data meta from
 * search_field/search_value (+ remaining query params) against a table config.
 */
export function dataSearch(req: Request, table: any[]): Record<string, any> {
  const meta: Record<string, any> = {};
  const fields = String(req.query.search_field || '').split(';');
  const values = String(req.query.search_value || '').split(';');
  fields.forEach((rawField: string, i: number) => {
    const field = String(rawField).trim();
    if (isIgnoredSearchToken(field)) return;
    const col = table.find((c: any) => c.key === field);
    const raw = values[i] ?? '';
    // -1 / undefined mean "All" in the Laravel select widgets: no filter, no chip.
    if (isIgnoredSearchToken(raw)) return;
    meta[field] =
      col && ['select', 'checkbox', 'select_multiple'].includes(col.type)
        ? { label: col.options?.find((o: any) => String(o.value) === String(raw))?.label ?? null, value: raw }
        : String(raw);
  });
  for (const [k, v] of Object.entries(req.query)) {
    if (['search_field', 'search_value', 'page', 'limit', 'search', 'sort', 'order', 'group', 'trash'].includes(k)) continue;
    if (isIgnoredSearchToken(v)) continue;
    meta[k] = String(v);
  }
  return meta;
}

/**
 * Laravel Model::scopeSearchField parity — applies search_field/search_value
 * to the Prisma where clause. Select/checkbox fields match exactly, others
 * use case-insensitive contains.
 *
 * Pass the Prisma model name so unknown/virtual columns are dropped and values
 * are coerced to the column type. Without it the helper degrades to a
 * type-agnostic contains, which is only safe on String columns.
 */
export function applySearchField(where: any, req: Request, table: any[], model?: string): void {
  const fields = String(req.query.search_field || '').split(';');
  const values = String(req.query.search_value || '').split(';');
  const pairs: Array<{ field: string; value: unknown }> = [];
  fields.forEach((rawField: string, i: number) => {
    const field = String(rawField).trim();
    if (isIgnoredSearchToken(field)) return;
    pairs.push({ field, value: values[i] });
  });
  if (!pairs.length) return;

  const exact = pairs
    .map(({ field }) => table.find((c: any) => c.key === field))
    .filter((col: any) => col && ['select', 'checkbox', 'select_multiple'].includes(col.type))
    .map((col: any) => col.key as string);

  if (model) {
    const built = buildSearchWhere(req, { model, exact });
    for (const condition of built.AND ?? []) pushCondition(where, condition);
    return;
  }

  pairs.forEach(({ field, value }: { field: string; value: unknown }) => {
    if (isIgnoredSearchToken(value)) return;
    if (exact.includes(field)) {
      where[field] = String(value);
    } else {
      where[field] = { contains: String(value), mode: 'insensitive' };
    }
  });
}