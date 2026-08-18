import { Request } from 'express';

/**
 * Laravel data_search() parity — builds search_data meta from
 * search_field/search_value (+ remaining query params) against a table config.
 */
export function dataSearch(req: Request, table: any[]): Record<string, any> {
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

/**
 * Laravel Model::scopeSearchField parity — applies search_field/search_value
 * to the Prisma where clause. Select/checkbox fields match exactly, others
 * use case-insensitive contains.
 */
export function applySearchField(where: any, req: Request, table: any[]): void {
  const fields = String(req.query.search_field || '').split(';').filter((f: string) => f.trim() !== '');
  const values = String(req.query.search_value || '').split(';').filter((v: string) => v.trim() !== '');
  fields.forEach((field: string, i: number) => {
    const raw = values[i];
    if (!raw) return;
    const col = table.find((c: any) => c.key === field);
    if (col && ['select', 'checkbox', 'select_multiple'].includes(col.type)) {
      where[field] = String(raw);
    } else {
      where[field] = { contains: raw, mode: 'insensitive' };
    }
  });
}