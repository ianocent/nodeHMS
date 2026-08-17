import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { STATUS_OPTIONS, laravelPaging, crudPermission } from '../utils/tableMeta';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function getPrisma() {
  return prisma;
}

// Laravel config('cms.time_day_use') parity â€” id in minutes
const TIME_DAY_USE = [
  { value: 30, label: '0.5 Hour' },
  { value: 60, label: '1 Hour' },
  { value: 90, label: '1 Hour 30 Minutes' },
  { value: 120, label: '2 Hours' },
  { value: 150, label: '2 Hours 30 Minutes' },
  { value: 180, label: '3 Hours' },
  { value: 210, label: '3 Hours 30 Minutes' },
  { value: 240, label: '4 Hours' },
  { value: 270, label: '4 Hours 30 Minutes' },
  { value: 300, label: '5 Hours' },
  { value: 330, label: '5 Hours 30 Minutes' },
  { value: 360, label: '6 Hours' },
];

// Laravel DayUseRate::formatTable() parity
const DAY_USE_RATE_TABLE = [
  { label: 'Rate Name', key: 'name', type: 'text', is_search: true },
  { label: 'Time', key: 'time', type: 'select', options: TIME_DAY_USE, is_search: true },
  { label: 'Status', key: 'status', type: 'checkbox', options: STATUS_OPTIONS, is_search: true },
];

// Laravel ReportPermission::formatTable() parity â€” role_id/master_report options injected per-request
const REPORT_PERMISSION_TABLE = [
  { label: 'No', key: 'no', type: 'none', is_search: false },
  { label: 'Status', key: 'status', type: 'checkbox', options: STATUS_OPTIONS, is_search: false },
  { label: 'Name', key: 'master_report', type: 'select_multiple', is_search: false },
  { label: 'Role', key: 'role_id', type: 'select', is_search: false },
];

// Laravel data_search() parity â€” search_field/search_value + remaining query params
function dataSearch(req: Request, table: any[]): Record<string, any> {
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

// Laravel DayUseRate::formatData() parity â€” status cast boolean (DayUseRate model casts status)
function formatDayUseRate(row: any, index: number, page: number, limit: number) {
  const status = !!row.status;
  return {
    no: (page - 1) * limit + index + 1,
    id: Number(row.id),
    name: row.name,
    time: {
      value: row.time,
      label: TIME_DAY_USE.find((t) => t.value === row.time)?.label ?? null,
    },
    status,
  };
}

// Laravel ReportPermission::formatData() parity â€” master_report links + role object + int status
function formatReportPermission(row: any, links: any[], roleMap: Map<string, string>) {
  return {
    id: Number(row.id),
    master_report: links
      .filter((l: any) => l.group === 'master-report')
      .map((l: any) => ({ value: l.value, label: l.label })),
    role_id: row.role_id !== null && roleMap.has(String(row.role_id))
      ? { value: Number(row.role_id), label: roleMap.get(String(row.role_id)) }
      : [],
    status: row.status,
  };
}

// ==================== DAY USE RATE (DayUseRateController parity) ====================
export class DayUseRateController {
  // DayUseRateController@index â€” rate_id filter, search name, permission menu 86
  static async index(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(String(req.query.page || '1'), 10);
      const limit = parseInt(String(req.query.limit || '10'), 10);
      const search = String(req.query.search || '');
      const rateId = req.query.rate_id ? BigInt(String(req.query.rate_id)) : null;

      const where: any = { deleted_at: null };
      if (rateId !== null) where.rate_id = rateId;
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        getPrisma().rate_day_uses.findMany({
          where,
          orderBy: [{ sort: 'asc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().rate_day_uses.count({ where }),
      ]);

      const rows = data.map((d: any, i: number) => formatDayUseRate(d, i, page, limit));
      const perms = crudPermission(req.user, 86n);
      success(res, rows, 'Success', 200, {
        table: DAY_USE_RATE_TABLE,
        pagination: laravelPaging(total, limit, page),
        permission: { view: true, add: perms.add, edit: perms.edit, delete: perms.delete },
        search_data: dataSearch(req, DAY_USE_RATE_TABLE) as any,
      });
    } catch (err: any) {
      console.error('Day use rate list error:', err);
      error(res, 'Failed to load day use rates', 500);
    }
  }

  // DayUseRateController@store â€” name+time required; property_id from user
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const body = (req as any).body ?? {};
      const payload = body.data ? (body.data as any) : body;
      const name = payload.name;
      const time = payload.time;
      if (!name || time === undefined || time === null || time === '') {
        badRequest(res, 'Validation failed');
        return;
      }
      const timeValue = typeof time === 'object' && time !== null ? (time as any).value ?? (time as any).label : time;
      const rawStatus = payload.status;
      const statusVal = rawStatus === undefined || rawStatus === null ? true : rawStatus;
      const status = typeof statusVal === 'object' ? (statusVal as any).value : statusVal;

      const created: any = await getPrisma().rate_day_uses.create({
        data: {
          property_id: req.user?.lastProperty ?? 0n,
          rate_id: payload.rate_id ? BigInt(String(payload.rate_id)) : null,
          name,
          time: Number(timeValue) || 0,
          status: status ? 1 : 0,
        },
      });
      success(res, formatDayUseRate(created, 0, 1, 10), 'Day Use Rate created successfully');
    } catch (err: any) {
      console.error('Day use rate store error:', err);
      error(res, 'Failed to create day use rate', 500);
    }
  }

  // DayUseRateController@update
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const body = (req as any).body ?? {};
      const payload = body.data ? (body.data as any) : body;
      const name = payload.name;
      const time = payload.time;
      if (!name || time === undefined || time === null || time === '') {
        badRequest(res, 'Validation failed');
        return;
      }
      const timeValue = typeof time === 'object' && time !== null ? (time as any).value ?? (time as any).label : time;
      const rawStatus = payload.status;
      const statusVal = rawStatus === undefined || rawStatus === null ? true : rawStatus;
      const status = typeof statusVal === 'object' ? (statusVal as any).value : statusVal;

      const existing = await getPrisma().rate_day_uses.findUnique({ where: { id } });
      if (!existing) {
        notFound(res);
        return;
      }
      await getPrisma().rate_day_uses.update({
        where: { id },
        data: { name, time: Number(timeValue) || 0, status: status ? 1 : 0 },
      });
      success(res, [], 'Day Use Rate updated successfully');
    } catch (err: any) {
      console.error('Day use rate update error:', err);
      error(res, 'Failed to update day use rate', 500);
    }
  }

  // DayUseRateController@destroy
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      await getPrisma().rate_day_uses.update({
        where: { id },
        data: { deleted_at: new Date() },
      });
      success(res, [], 'Day Use Rate deleted successfully');
    } catch (err: any) {
      console.error('Day use rate delete error:', err);
      error(res, 'Failed to delete day use rate', 500);
    }
  }
}

// ==================== REPORT PERMISSION (ReportPermissionController parity) ====================
export class ReportPermissionController {
  // ReportPermissionController@index â€” roles + master-report options injected; permission menu 1126
  static async index(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(String(req.query.page || '1'), 10);
      const limit = parseInt(String(req.query.limit || '10'), 10);
      const search = String(req.query.search || '');
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = {};
      const roles = await getPrisma().roles.findMany({
        where: { deleted_at: null, property_id: propertyId },
        select: { id: true, name: true },
      });
      const roleMap = new Map<string, string>(roles.map((r: any) => [String(r.id), r.name]));

      if (search) {
        const matchedRoleIds = roles.filter((r: any) => r.name.toLowerCase().includes(search.toLowerCase())).map((r: any) => r.id);
        where.OR = [{ role_id: { in: matchedRoleIds } }, { status: isNaN(Number(search)) ? undefined : Number(search) }];
      }

      const [data, total] = await Promise.all([
        getPrisma().report_permissions.findMany({
          where,
          orderBy: { id: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().report_permissions.count({ where }),
      ]);

      const rpIds = data.map((d: any) => d.id);
      const links = rpIds.length
        ? await getPrisma().model_has_types.findMany({
            where: { model_type: 'App\\Models\\ReportPermission', model_id: { in: rpIds } },
          })
        : [];
      const typeIds = links.map((l: any) => l.type_id);
      const typeMap = typeIds.length
        ? new Map(
            (await getPrisma().types.findMany({ where: { id: { in: typeIds } } })).map((t: any) => [Number(t.id), t])
          )
        : new Map();
      const linkGroups = links.map((l: any) => {
        const t = typeMap.get(Number(l.type_id));
        return { ...l, group: t?.group ?? '', label: t?.name ?? String(l.type_id), value: Number(l.type_id) };
      });
      const byModel = new Map<string, any[]>();
      for (const l of linkGroups) {
        const key = String(l.model_id);
        if (!byModel.has(key)) byModel.set(key, []);
        byModel.get(key)!.push(l);
      }

      const rows = data.map((d: any, i: number) => ({
        no: (page - 1) * limit + i + 1,
        ...formatReportPermission(d, byModel.get(String(d.id)) || [], roleMap),
      }));

      const masterReport = await getPrisma().types.findMany({
        where: { deleted_at: null, group: 'master-report' },
        select: { id: true, name: true },
      });
      const table = REPORT_PERMISSION_TABLE.map((col: any) => {
        if (col.key === 'role_id') return { ...col, options: roles.map((r: any) => ({ value: Number(r.id), label: r.name })) };
        if (col.key === 'master_report')
          return { ...col, options: masterReport.map((t: any) => ({ value: Number(t.id), label: t.name })) };
        return col;
      });

      const perms = crudPermission(req.user, 1126n);
      success(res, rows, 'Success', 200, {
        table,
        pagination: laravelPaging(total, limit, page),
        permission: { view: true, add: perms.add, edit: perms.edit, delete: false },
        search_data: dataSearch(req, table) as any,
      });
    } catch (err: any) {
      console.error('Report permission list error:', err);
      error(res, 'Failed to load report permissions', 500);
    }
  }

  // ReportPermissionController@create â€” master statuses
  static async create(req: Request, res: Response): Promise<void> {
    success(res, [], 'Success', 200, {
      master: { statuses: STATUS_OPTIONS },
    });
  }

  // ReportPermissionController@store â€” role_id required; sync master_report links
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const body = (req as any).body ?? {};
      const payload = body.data ? (body.data as any) : body;
      const roleId = coerceInt(payload.role_id);
      if (!roleId) {
        badRequest(res, 'The role id field is required.');
        return;
      }
      const status = coerceBool(payload.status);
      const created: any = await getPrisma().report_permissions.create({
        data: {
          role_id: roleId,
          property_id: req.user?.lastProperty ?? 0n,
          status: status ? 1 : 0,
        },
      });
      await syncReportLinks(created.id, payload.master_report ?? payload.master_report_ori);
      success(res, [], 'Success');
    } catch (err: any) {
      console.error('Report permission store error:', err);
      error(res, 'Failed to create report permission', 500);
    }
  }

  // ReportPermissionController@show
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const row = await getPrisma().report_permissions.findUnique({ where: { id } });
      if (!row) {
        notFound(res);
        return;
      }
      const links = await loadLinks(row.id);
      const role = row.role_id
        ? await getPrisma().roles.findUnique({ where: { id: row.role_id } })
        : null;
      const roleMap = new Map<string, string>();
      if (role) roleMap.set(String(row.role_id), role.name);
      success(res, formatReportPermission(row, links, roleMap), 'Success');
    } catch (err: any) {
      console.error('Report permission show error:', err);
      error(res, 'Failed to load report permission', 500);
    }
  }

  // ReportPermissionController@edit â€” data + master statuses
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const row = await getPrisma().report_permissions.findUnique({ where: { id } });
      if (!row) {
        notFound(res);
        return;
      }
      const links = await loadLinks(row.id);
      const role = row.role_id ? await getPrisma().roles.findUnique({ where: { id: row.role_id } }) : null;
      const roleMap = new Map<string, string>();
      if (role) roleMap.set(String(row.role_id), role.name);
      success(res, formatReportPermission(row, links, roleMap), 'Success', 200, {
        master: { statuses: STATUS_OPTIONS },
      });
    } catch (err: any) {
      console.error('Report permission edit error:', err);
      error(res, 'Failed to load report permission', 500);
    }
  }

  // ReportPermissionController@update â€” role_id required; sync master_report links
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const row = await getPrisma().report_permissions.findUnique({ where: { id } });
      if (!row) {
        notFound(res);
        return;
      }
      const body = (req as any).body ?? {};
      const payload = body.data ? (body.data as any) : body;
      const roleId = coerceInt(payload.role_id);
      if (!roleId) {
        badRequest(res, 'The role id field is required.');
        return;
      }
      const status = coerceBool(payload.status);
      await getPrisma().report_permissions.update({
        where: { id },
        data: { role_id: roleId, status: status ? 1 : 0 },
      });
      await syncReportLinks(id, payload.master_report ?? payload.master_report_ori);
      success(res, [], 'Success');
    } catch (err: any) {
      console.error('Report permission update error:', err);
      error(res, 'Failed to update report permission', 500);
    }
  }

  // ReportPermissionController@destroy â€” model has no SoftDeletes â†’ hard delete
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      await getPrisma().report_permissions.delete({ where: { id } });
      success(res, [], 'Success');
    } catch (err: any) {
      console.error('Report permission delete error:', err);
      error(res, 'Failed to delete report permission', 500);
    }
  }

  // ReportPermissionController@getPermission â€” user role â†’ master-report perms (batch report builder)
  static async getPermission(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        success(res, [], 'Success');
        return;
      }
      const userRole = await getPrisma().model_has_roles.findFirst({
        where: { model_type: 'App\\Models\\User', model_id: userId },
      });
      if (!userRole) {
        success(res, [], 'Success');
        return;
      }
      // Laravel: withOutGlobalScope('property') â€” no property filter
      const rp = await getPrisma().report_permissions.findFirst({
        where: { role_id: userRole.role_id },
      });
      if (!rp) {
        success(res, [], 'Success');
        return;
      }
      const rpLinks = await loadLinks(rp.id);
      const masterItems = rpLinks.filter((l: any) => l.group === 'master-report');
      if (!masterItems.length) {
        success(res, [], 'Success');
        return;
      }
      // Nested links per master-report type (group-report + action-report) via model_has_types (Typeâ†”Type)
      const nested = await getPrisma().model_has_types.findMany({
        where: { model_type: 'App\\Models\\Type', model_id: { in: masterItems.map((m: any) => BigInt(m.value)) } },
      });
      const nestedIds = nested.map((n: any) => n.type_id);
      const nestedTypes = nestedIds.length
        ? await getPrisma().types.findMany({ where: { id: { in: nestedIds } } })
        : [];
      const nestedMap = new Map(nestedTypes.map((t: any) => [Number(t.id), t]));

      const permission = masterItems.map((item: any) => {
        const childLinks = nested
          .filter((n: any) => String(n.model_id) === String(item.value))
          .map((n: any) => ({ ...n, type: nestedMap.get(Number(n.type_id)) }));
        const groupReport = childLinks.find((c: any) => c.type?.group === 'group-report');
        const actionReports = childLinks.filter((c: any) => c.type?.group === 'action-report');
        return {
          id: item.value,
          batch_name: String(item.label).replace(/-/g, ' '),
          url: item.description ?? null,
          group: groupReport?.type?.name ? String(groupReport.type.name).toLowerCase().replace(/ /g, '-') : null,
          filter: actionReports.map((c: any) => ({ value: Number(c.type.id), label: c.type.name })),
        };
      });

      success(res, permission, 'Success');
    } catch (err: any) {
      console.error('Report permission getPermission error:', err);
      error(res, 'Failed to load report permissions', 500);
    }
  }
}

// helpers
function coerceInt(val: any): bigint | null {
  if (val === undefined || val === null) return null;
  const v = typeof val === 'object' ? (val as any).value ?? (val as any).label ?? val : val;
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return isNaN(n) ? null : BigInt(n);
}

function coerceBool(val: any): boolean {
  if (val === undefined || val === null) return false;
  const v = typeof val === 'object' ? (val as any).value : val;
  return v === true || v === 1 || v === '1' || v === 'true';
}

// model_has_types links for report_permissions row â€” Type rows joined
async function loadLinks(modelId: bigint): Promise<any[]> {
  const links = await getPrisma().model_has_types.findMany({
    where: { model_type: 'App\\Models\\ReportPermission', model_id: modelId },
  });
  const ids = links.map((l: any) => l.type_id);
  const types = ids.length ? await getPrisma().types.findMany({ where: { id: { in: ids } } }) : [];
  const typeMap = new Map(types.map((t: any) => [Number(t.id), t]));
  return links.map((l: any) => {
    const t = typeMap.get(Number(l.type_id));
    return { value: Number(l.type_id), label: t?.name ?? String(l.type_id), group: t?.group ?? '', description: t?.description ?? null };
  });
}

// Laravel ReportPermissionController store/update â€” Type::whereIn(values)->sync()
async function syncReportLinks(modelId: bigint, masterReport: any): Promise<void> {
  const raw = Array.isArray(masterReport) ? masterReport : [];
  const values = raw
    .map((v: any) => {
      const id = coerceInt(v);
      return id ? Number(id) : null;
    })
    .filter((v: any): v is number => v !== null);
  const valid = values.length
    ? (await getPrisma().types.findMany({ where: { id: { in: values } } })).map((t: any) => t.id)
    : [];
  await getPrisma().model_has_types.deleteMany({
    where: { model_type: 'App\\Models\\ReportPermission', model_id: modelId },
  });
  if (valid.length) {
    await getPrisma().model_has_types.createMany({
      data: valid.map((typeId: bigint) => ({
        model_type: 'App\\Models\\ReportPermission',
        model_id: modelId,
        type_id: typeId,
      })),
    });
  }
}

