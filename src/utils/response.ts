import { Response } from 'express';
import { encrypt } from './encryption';

export interface ApiMeta {
  permission?: Record<string, boolean>;
  pagging?: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number;
    to: number;
  };
  table?: any[];
  master?: any;
  search_data?: any[];
  typeTable?: any;
  uriTable?: any;
  label?: any;
  isDrag?: any;
  uriSaveDrag?: any;
  breadcrumbs?: any[];
}

function sendEncrypted(res: Response, statusCode: number, payload: Record<string, any>): Response {
  const body = JSON.stringify(payload);
  const encrypted = encrypt(body);
  return res.status(statusCode).type('text/plain').send(encrypted);
}

export function success(
  res: Response,
  data: any = null,
  message = 'Success',
  code = 200,
  meta?: ApiMeta
): Response {
  return sendEncrypted(res, code, {
    code: String(code),
    message,
    data,
    ...(meta?.permission ? { permission: meta.permission } : {}),
    ...(meta?.pagging ? { pagging: meta.pagging } : {}),
    ...(meta?.table ? { table: meta.table } : {}),
    ...(meta?.master ? { master: meta.master } : {}),
    ...(meta?.search_data ? { search_data: meta.search_data } : {}),
    ...(meta?.typeTable !== undefined ? { typeTable: meta.typeTable } : {}),
    ...(meta?.uriTable !== undefined ? { uriTable: meta.uriTable } : {}),
    ...(meta?.label !== undefined ? { label: meta.label } : {}),
    ...(meta?.isDrag !== undefined ? { isDrag: meta.isDrag } : {}),
    ...(meta?.uriSaveDrag !== undefined ? { uriSaveDrag: meta.uriSaveDrag } : {}),
    ...(meta?.breadcrumbs ? { breadcrumbs: meta.breadcrumbs } : {}),
  });
}

export function error(
  res: Response,
  message: string,
  code = 500,
  errors: any = null
): Response {
  return sendEncrypted(res, code, {
    code: String(code),
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
