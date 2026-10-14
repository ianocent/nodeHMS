import { Response } from 'express';
import { encrypt } from './encryption';
import { normalizeJson } from './json';

export interface ApiMeta {
  permission?: Record<string, boolean | number>;
  pagination?: Record<string, number>;
  pagging?: Record<string, number>;
  table?: any[];
  master?: any;
  search_data?: any[];
  typeTable?: any;
  uriTable?: any;
  label?: any;
  isDrag?: any;
  uriSaveDrag?: any;
  breadcrumbs?: any[];
  datas?: any[];
  isNotAdmin?: boolean;
  folio?: any;
  market_property?: any;
  building?: any;
  ledger?: any;
  meta?: any;
  total_transaction?: any;
  ledger_id?: any;
  connect_room_type?: any;
  reservation?: any;
  /**
   * Shift-confirmation payload keys Laravel emits at the TOP level of the response
   * (`status`, `details`, `debug`, `count`, `is_self`, `name`, `image`). The end-shift
   * page gates on `response.status !== "error"` and `response.is_self`, so nesting them
   * under `data` made an unbalanced submit look like a success.
   */
  status?: string;
  details?: string[];
  debug?: any;
  count?: number;
  is_self?: boolean;
  name?: string;
  image?: string;
  /**
   * Field-schema envelope used by the module create/edit screens. Laravel puts
   * `form` at the TOP level of the response (and often sends no `data` key at
   * all), and the frontend gates on `response.form` — so it must be emitted
   * here, not nested under `data`.
   */
  form?: any;
}

function sendEncrypted(res: Response, statusCode: number, payload: Record<string, any>): Response {
  // Central normalization: Dates -> `Y-m-d H:i:s`, bigint -> number.
  // Keeps every endpoint on Laravel's date format instead of ISO-8601.
  const body = JSON.stringify(normalizeJson(payload));
  const encrypted = encrypt(body);
  return res.status(statusCode).type('text/plain').send(encrypted);
}

// Normalize any pagination meta shape (laravelPaging or current_page-style)
// into Laravel's full `pagging` contract + a `pagination` alias.
// Frontends read BOTH keys: table-edit/pages read `.pagging`, table-drag/table-editM read `.pagination`.
export function buildPagging(p: any): Record<string, number> {
  const total = Number(p?.total ?? p?.total_data ?? 0);
  const limit = Number(p?.per_page ?? p?.limit_data ?? 25);
  const page = Number(p?.current_page ?? p?.start_paging ?? 1);
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, limit)));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(total, page * limit);
  return {
    limit_data: limit,
    total_data: total,
    start_paging: page,
    end_paging: totalPages,
    prev_jump: page > 1 ? 1 : 0,
    prev: page > 1 ? page - 1 : 0,
    next: page < totalPages ? page + 1 : 0,
    next_jump: page < totalPages ? totalPages : 0,
    current_page: page,
    last_page: totalPages,
    per_page: limit,
    total,
    from,
    to,
  };
}

export function success(
  res: Response,
  data: any = null,
  message = 'Success',
  code = 200,
  meta?: ApiMeta
): Response {
  // List rows: `status` raw int 0/1 -> boolean so TableView renders ✓/✗ icons.
  // (checkbox column; see table-edit/index.tsx render boolean -> checklist/cross)
  // Laravel casts every `checkbox` column to bool inside the model's formatData()
  // (Yields::formatData() -> 'is_general' => (bool) $this->is_general). Only
  // `status` used to be normalized here, so every other 0/1 flag leaked into the
  // grid and rendered as a number instead of a tick/cross. Normalize whatever the
  // table declares as a checkbox; cells shaped {value,label} pass through.
  const flagCols = (meta?.table ?? []).filter((c: any) => c?.type === 'checkbox').map((c: any) => c.key);
  if (Array.isArray(data) && flagCols.length) {
    data = data.map((row: any) => {
      if (!row || typeof row !== 'object') return row;
      let touched = false;
      const next: any = { ...row };
      for (const key of flagCols) {
        const v = row[key];
        if (v === true || v === false || v === 0 || v === 1 || v === '0' || v === '1') {
          next[key] = v === true || v === 1 || v === '1';
          touched = true;
        }
      }
      return touched ? next : row;
    });
  }
  const pagging = meta?.pagination ? buildPagging(meta.pagination) : undefined;
  return sendEncrypted(res, code, {
    code,
    message,
    data,
    ...(meta?.permission ? { permission: meta.permission } : {}),
    ...(pagging ? { pagging } : {}),
    ...(pagging ? { pagination: pagging } : {}),
    ...(meta?.table ? { table: meta.table } : {}),
    ...(meta?.master ? { master: meta.master } : {}),
    ...(meta?.search_data ? { search_data: meta.search_data } : {}),
    ...(meta?.typeTable !== undefined ? { typeTable: meta.typeTable } : {}),
    ...(meta?.uriTable !== undefined ? { uriTable: meta.uriTable } : {}),
    ...(meta?.label !== undefined ? { label: meta.label } : {}),
    ...(meta?.isDrag !== undefined ? { isDrag: meta.isDrag } : {}),
    ...(meta?.uriSaveDrag !== undefined ? { uriSaveDrag: meta.uriSaveDrag } : {}),
    ...(meta?.breadcrumbs ? { breadcrumbs: meta.breadcrumbs } : {}),
    ...(meta?.datas ? { datas: meta.datas } : {}),
    ...(meta?.isNotAdmin !== undefined ? { isNotAdmin: meta.isNotAdmin } : {}),
    ...(meta?.folio ? { folio: meta.folio } : {}),
    ...(meta?.market_property ? { market_property: meta.market_property } : {}),
    ...(meta?.building !== undefined ? { building: meta.building } : {}),
    ...(meta?.ledger !== undefined ? { ledger: meta.ledger } : {}),
    ...(meta?.meta !== undefined ? { meta: meta.meta } : {}),
    ...(meta?.total_transaction !== undefined ? { total_transaction: meta.total_transaction } : {}),
    ...(meta?.ledger_id !== undefined ? { ledger_id: meta.ledger_id } : {}),
    ...(meta?.connect_room_type !== undefined ? { connect_room_type: meta.connect_room_type } : {}),
    ...(meta?.reservation !== undefined ? { reservation: meta.reservation } : {}),
    ...(meta?.status !== undefined ? { status: meta.status } : {}),
    ...(meta?.details !== undefined ? { details: meta.details } : {}),
    ...(meta?.debug !== undefined ? { debug: meta.debug } : {}),
    ...(meta?.count !== undefined ? { count: meta.count } : {}),
    ...(meta?.is_self !== undefined ? { is_self: meta.is_self } : {}),
    ...(meta?.name !== undefined ? { name: meta.name } : {}),
    ...(meta?.image !== undefined ? { image: meta.image } : {}),
...(meta?.form !== undefined ? { form: meta.form } : {}),
  });
}

export function error(
  res: Response,
  message: string,
  code = 500,
  errors: any = null
): Response {
  return sendEncrypted(res, code, {
    code,
    message,
    data: null,
    ...(errors ? { errors } : {}),
  });
}

export function unauthorized(res: Response, message = 'Unauthorized'): Response {
  return error(res, message, 401);
}

export function forbidden(res: Response, message = 'Access denied'): Response {
  return error(res, message, 403);
}

export function notFound(res: Response, message = 'Not found'): Response {
  return error(res, message, 404);
}

export function badRequest(res: Response, message = 'Bad request', errors?: any): Response {
  return error(res, message, 400, errors);
}

export function validationError(res: Response, errors: any): Response {
  return error(res, 'Validation failed', 422, errors);
}
