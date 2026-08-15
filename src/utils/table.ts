export interface TableColumn {
  label: string;
  key: string;
  type: string;
  is_search?: boolean;
  is_html?: boolean;
  options?: any[];
  url_autocomplete?: string;
  [key: string]: any;
}

const LABEL_CAP = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

// Build a default table config from a record's keys (same shape as Laravel formatTable).
// id/*_id/*_by -> none; name/code/description -> text + searchable; status -> checkbox;
// everything else -> string.
export function buildDefaultTable(records: any[]): TableColumn[] {
  const first = records[0] || {};
  const table: TableColumn[] = Object.keys(first).map((key) => ({
    label: LABEL_CAP(key),
    key,
    type:
      key === 'id' || key.endsWith('_id') || key.endsWith('_by')
        ? 'none'
        : key === 'status'
        ? 'checkbox'
        : key === 'name' || key === 'code' || key === 'description'
        ? 'text'
        : 'string',
    is_search: key === 'name' || key === 'code' || key === 'description',
  }));
  table.push({ label: 'Action', key: 'action', type: 'action', is_search: false });
  return table;
}

export const TIME_FIELDS = ['time_start', 'time_end', 'overtime_start', 'overtime_end'];

// Format DateTime -> "HH:MM" (stored as 1970-01-01T{HH:MM}Z for time-only values).
export function formatTimeFields(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const out: any = { ...row };
  for (const key of TIME_FIELDS) {
    const v = row[key];
    if (v instanceof Date && !isNaN(v.getTime())) {
      out[key] = v.toISOString().slice(11, 16);
    }
  }
  return out;
}

export function formatTimeRows(data: any): any {
  if (Array.isArray(data)) return data.map(formatTimeFields);
  return formatTimeFields(data);
}

const TIME_ONLY_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

// Convert time-only strings ("HH:MM" / "HH:MM:SS") to ISO-8601 dates (1970-01-01 base, UTC)
// so Prisma accepts them for DateTime columns. Non-matching values pass through untouched.
export function sanitizeTimeValues(body: any): any {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: any = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string' && /time/i.test(k) && TIME_ONLY_RE.test(v)) {
      const [h, m, s] = v.split(':');
      out[k] = new Date(Date.UTC(1970, 0, 1, Number(h), Number(m), s ? Number(s) : 0));
    } else {
      out[k] = v;
    }
  }
  return out;
}
