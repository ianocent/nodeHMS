import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { AuthController } from './auth.controller';
import { moneyFormat } from '../utils/cmsConfig';

// Laravel storage/app/public parity — files served at /storage/{path}
const STORAGE_DIR = path.join(process.cwd(), 'storage');

// Multipart fields arrive as raw strings — normalize "null"/"undefined"/"" → null (requestParser runs before multer)
function normalizeStr(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' || t === 'null' || t === 'undefined') return null;
    return t;
  }
  return v;
}

// Laravel HasTypes::syncTypes parity for area/template-floor-plan (Type<->Type via model_has_types)
async function syncAreaTypes(typeId: bigint, building: any, floor: any): Promise<void> {
  const prisma = getPrisma();
  const bfTypes = await prisma.types.findMany({
    where: { OR: [{ group: 'building' }, { group: 'floor' }] },
    select: { id: true },
  });
  if (bfTypes.length) {
    await prisma.model_has_types.deleteMany({
      where: { model_type: 'App\\Models\\Type', model_id: typeId, type_id: { in: bfTypes.map(t => t.id) } },
    });
  }
  const ids = [building, floor].filter(v => v !== undefined && v !== null && v !== '');
  for (const v of ids) {
    await prisma.model_has_types.create({
      data: { model_type: 'App\\Models\\Type', model_id: typeId, type_id: BigInt(v) },
    });
  }
}

// Laravel LogController@index table parity (Security Audit / Report Permission screens)
const LOG_TABLE = [
  { label: 'Datetime', key: 'created_at', type: 'datetime', is_search: false },
  { label: 'Staff', key: 'causer', type: 'none', is_search: false },
  { label: 'type', key: 'type', type: 'none', is_search: false },
  { label: 'Module', key: 'subject_type', type: 'select', is_search: true },
  { label: 'Activity', key: 'description', is_html: true, type: 'none', is_search: false },
  { label: 'Action', key: 'action', type: 'action', is_search: false },
];

// Helper: coerce sort/status to number (matches Laravel int casting)
function num(v: any, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}
import { encrypt } from '../utils/encryption';
import { setupTable, postCodeBudgetTable, laravelPaging, crudPermission } from '../utils/tableMeta';

const systemPool = new Pool({ connectionString: process.env.DATABASE_URL });
const systemAdapter = new PrismaPg(systemPool);
const systemPrisma = new PrismaClient({ adapter: systemAdapter });

function getPrisma() {
  return systemPrisma;
}

function bigintToNumber(val: any): any {
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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

const SYSTEM_BALANCE_TABLE = [
  { label: '', key: 'name', type: 'none', is_html: true, is_search: false },
  { label: 'Debit', key: 'debit', type: 'none', is_html: true, is_search: false },
  { label: 'Credit', key: 'credit', type: 'none', is_html: true, is_search: false },
];

function toNumber(value: any, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

export function formatSystemBalanceData(rows: any[], type: string) {
  const mapped = rows.map((item: any) => ({
    id: type === 'payment' ? Number(item.code_id ?? item.id ?? 0) : 0,
    name: item.name ?? '',
    debit: toNumber(item.debit),
    credit: toNumber(item.credit),
  }));

  const debitTotal = mapped.reduce((sum, row) => sum + row.debit, 0);
  const creditTotal = mapped.reduce((sum, row) => sum + row.credit, 0);

  const total = {
    id: 0,
    name: '<b>Total</b>',
    is_total: true,
    debit: '<b>' + moneyFormat(debitTotal < 0 ? debitTotal * -1 : debitTotal) + '</b>',
    credit: '<b>' + moneyFormat(creditTotal < 0 ? creditTotal * -1 : creditTotal) + '</b>',
  };

  return {
    data: [...mapped, total],
    table: SYSTEM_BALANCE_TABLE,
    pagging: {
      current_page: 1,
      last_page: 1,
      per_page: 99999,
      total: mapped.length + 1,
      from: 1,
      to: mapped.length + 1,
    },
    permission: { view: true, add: false, edit: false, delete: false },
  };
}

export class SystemController {
  static async shiftConfirmationList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: propertyId, deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().shift_postings.findMany({
          where,
          include: {
            room_types: { select: { id: true, name: true } },
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shift_postings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Shift confirmation list error:', err);
      error(res, 'Failed to fetch shift confirmation list', 500);
    }
  }

  static async shiftConfirmationSubmit(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const userId = req.query.user_id as string;

      if (!userId) {
        badRequest(res, 'user_id is required');
        return;
      }

      const userIdBig = BigInt(userId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const existingShift = await getPrisma().shifts.findFirst({
        where: {
          user_id: userIdBig,
          property_id: propertyId,
          date: { gte: today, lt: tomorrow },
          deleted_at: null,
        },
      });

      if (existingShift) {
        const updated = await getPrisma().shifts.update({
          where: { id: existingShift.id },
          data: {
            is_posting: true,
            end: new Date(),
            updated_at: new Date(),
          },
        });
        success(res, bigintToNumber(updated), 'Shift updated');
      } else {
        const created = await getPrisma().shifts.create({
          data: {
            property_id: propertyId,
            user_id: userIdBig,
            start: new Date(),
            end: new Date(),
            date: today,
            is_posting: true,
            status: 0,
            created_at: new Date(),
          },
        });
        success(res, bigintToNumber(created), 'Shift created', 201);
      }
    } catch (err: any) {
      console.error('Shift confirmation submit error:', err);
      error(res, 'Failed to submit shift confirmation', 500);
    }
  }

  static async shiftDetail(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: propertyId, deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().shifts.findMany({
          where,
          include: {
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shifts.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Shift detail error:', err);
      error(res, 'Failed to fetch shift detail', 500);
    }
  }

  static async nightAuditPost(req: Request, res: Response): Promise<void> {
    try {
      const date = req.query.date as string;

      success(res, { date, status: 'posted', message: 'Night audit posted successfully' }, 'Success');
    } catch (err: any) {
      console.error('Night audit post error:', err);
      error(res, 'Failed to post night audit', 500);
    }
  }

  static async checkValue(req: Request, res: Response): Promise<void> {
    try {
      const key = req.query.key as string;
      const value = req.query.value as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      if (!key) {
        badRequest(res, 'key is required');
        return;
      }

      if (key === 'pin_endshift') {
        if (!value) {
          badRequest(res, 'value is required for pin_endshift');
          return;
        }

        const user = await getPrisma().users.findFirst({
          where: {
            id: req.user?.id,
            deleted_at: null,
          },
          select: { id: true, pin_enshift: true },
        });

        if (!user) {
          notFound(res, 'User not found');
          return;
        }

        const pinMatch = user.pin_enshift !== null && user.pin_enshift === parseInt(value);
        if (pinMatch) {
          success(res, { valid: true }, 'PIN valid');
        } else {
          success(res, { valid: false }, 'PIN invalid');
        }
      } else {
        success(res, { valid: true }, 'Check passed');
      }
    } catch (err: any) {
      console.error('Check value error:', err);
      error(res, 'Failed to check value', 500);
    }
  }

  static async systemBalance(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const rawType = Array.isArray(req.params.type) ? req.params.type[0] : (req.params.type ?? '');
      const type = rawType.toLowerCase();
      const date = req.query.date as string;

      if (!['payment', 'posting', 'tax', 'deposit', 'ledger'].includes(type)) {
        badRequest(res, 'Invalid system balance type');
        return;
      }

      const where: any = { property_id: propertyId, type };
      if (date) {
        const dateObj = new Date(date);
        if (Number.isNaN(dateObj.getTime())) {
          badRequest(res, 'date must be a valid date');
          return;
        }
        const start = new Date(dateObj);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        where.date = { gte: start, lt: end };
      }

      const rows = await getPrisma().system_balances.findMany({
        where,
        orderBy: { id: 'asc' },
      });

      const payload = formatSystemBalanceData(
        rows.map((row: any) => ({
          id: Number(row.code_id ?? 0),
          name: row.name ?? '',
          debit: row.debit ?? 0,
          credit: row.credit ?? 0,
        })),
        type
      );

      success(res, payload.data, 'Success', 200, {
        table: payload.table,
        pagging: payload.pagging,
        permission: payload.permission,
      });
    } catch (err: any) {
      console.error('System balance error:', err);
      error(res, 'Failed to fetch system balance', 500);
    }
  }

  static async getListByIdPost(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const rawType = Array.isArray(req.params.type) ? req.params.type[0] : (req.params.type ?? req.query.type ?? '');
      const type = String(rawType).toLowerCase();
      const id = (req.params.id ?? req.query.id as string ?? '').toString();
      const date = req.query.date as string;

      if (!id) {
        badRequest(res, 'id is required');
        return;
      }

      if (!date) {
        badRequest(res, 'date is required');
        return;
      }

      const dateObj = new Date(date);
      if (Number.isNaN(dateObj.getTime())) {
        badRequest(res, 'date must be a valid date');
        return;
      }

      const start = new Date(dateObj);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const where: any = {
        property_id: propertyId,
        date: { gte: start, lt: end },
      };

      if (type === 'payment') {
        where.type_payment_id = BigInt(id);
      } else {
        where.code = String(id);
      }

      const rows = await getPrisma().transaction_breakdowns.findMany({
        where,
        orderBy: { created_at: 'desc' },
      });

      const mapped = rows.map((row: any) => ({
        id: Number(row.id ?? 0),
        name: `${row.folios?.folio_number ?? ''} ( ${String(row.type ?? '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())} )${row.is_transfer === 1 || row.is_transfer === 2 ? ` (${row.remark ?? ''})` : ''}`.trim(),
        debit: row.type_amount === 'MINUS' ? toNumber(row.amount) : 0,
        credit: row.type_amount === 'PLUS' ? toNumber(row.amount) : 0,
      }));

      const payload = formatSystemBalanceData(mapped, type || 'payment');
      success(res, payload.data, 'Success', 200, {
        table: payload.table,
        pagging: payload.pagging,
        permission: payload.permission,
      });
    } catch (err: any) {
      console.error('System balance detail error:', err);
      error(res, 'Failed to fetch system balance detail', 500);
    }
  }

  static async logList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const module = req.query.module as string;
      const id = req.query.id as string;

      const where: any = {};

      if (module) {
        where.subject_type = module;
      }

      if (id && id !== 'null' && id !== 'undefined') {
        where.subject_id = BigInt(id);
      }

      const [data, total] = await Promise.all([
        getPrisma().logs.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().logs.count({ where }),
      ]);

      const formatted = bigintToNumber(data).map((row: any) => ({
        ...row,
        causer: row.name || row.causer || null,
        type: row.event || row.log_name || null,
      }));

      success(res, formatted, 'Success', 200, {
        table: LOG_TABLE,
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Log list error:', err);
      error(res, 'Failed to fetch logs', 500);
    }
  }

  // ==================== SETUP (TypeController@index parity) ====================
  static async setup(req: Request, res: Response): Promise<void> {
    try {
      const group = (req.query.group as string) || '';
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || '';
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: propertyId, deleted_at: null };
      if (group) where.group = group;
      if (search) where.name = { contains: search, mode: 'insensitive' };

      let orderBy: any = { id: 'desc' };
      if (group === 'guest-title') orderBy = { name: 'asc' };
      if (group === 'room-type-grouping') orderBy = { sort: 'asc' };

      const [data, total] = await Promise.all([
        getPrisma().types.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
        getPrisma().types.count({ where }),
      ]);

      const normal = data.filter(d => /normal/i.test(d.name));
      const rest = data.filter(d => !/normal/i.test(d.name));
      const ordered = [...normal, ...rest];

      // Laravel TypeController@index parity — area/template-floor-plan expose Building+Floor
      let bfOptions: { building: any[]; floor: any[] } = { building: [], floor: [] };
      let mhtMap = new Map<string, bigint[]>();
      if (group === 'area' || group === 'template-floor-plan') {
        // Laravel: options NOT property-scoped
        const bfTypes = await getPrisma().types.findMany({
          where: { deleted_at: null },
          orderBy: { sort: 'asc' },
        });
        bfOptions = {
          building: bfTypes.filter(t => t.group === 'building').map(t => ({ value: Number(t.id), label: t.name })),
          floor: bfTypes.filter(t => t.group === 'floor').map(t => ({ value: Number(t.id), label: t.name })),
        };
        const links = await getPrisma().model_has_types.findMany({
          where: { model_type: 'App\\Models\\Type', model_id: { in: ordered.map(d => d.id) } },
          select: { model_id: true, type_id: true },
        });
        for (const l of links) {
          const key = String(l.model_id);
          if (!mhtMap.has(key)) mhtMap.set(key, []);
          mhtMap.get(key)!.push(l.type_id);
        }
      }

      // Laravel TypeController@index parity — master-report: Group Report + Action options + row links
      let mrOptions: { group_report: any[]; action_report: any[] } = { group_report: [], action_report: [] };
      let mrMap = new Map<string, any[]>();
      if (group === 'master-report') {
        const mrTypes = await getPrisma().types.findMany({ where: { deleted_at: null } });
        mrOptions = {
          group_report: mrTypes.filter(t => t.group === 'group-report').map(t => ({ value: Number(t.id), label: t.name })),
          action_report: mrTypes.filter(t => t.group === 'action-report').map(t => ({ value: Number(t.id), label: t.name })),
        };
        const links = await getPrisma().model_has_types.findMany({
          where: { model_type: 'App\\Models\\Type', model_id: { in: ordered.map(d => d.id) } },
          select: { model_id: true, type_id: true },
        });
        const byId = new Map(mrTypes.map(t => [Number(t.id), t]));
        for (const l of links) {
          const key = String(l.model_id);
          const t = byId.get(Number(l.type_id));
          if (!t) continue;
          if (!mrMap.has(key)) mrMap.set(key, []);
          mrMap.get(key)!.push({ value: Number(t.id), label: t.name, group: t.group });
        }
      }

      const rows = ordered.map((d, i) => {
        const row: any = {
          no: (page - 1) * limit + i + 1,
          id: Number(d.id),
          name: d.name,
          description: d.description,
          image: d.image,
          text: d.text,
          group: d.group,
          sort: d.sort,
          status: d.status,
        };
        if (group === 'area' || group === 'template-floor-plan') {
          const linked = mhtMap.get(String(d.id)) || [];
          row.building = bfOptions.building.find(o => linked.includes(BigInt(o.value))) || {};
          row.floor = bfOptions.floor.find(o => linked.includes(BigInt(o.value))) || {};
        }
        if (group === 'master-report') {
          const linked = mrMap.get(String(d.id)) || [];
          row.group_report = linked.filter(l => l.group === 'group-report').map(l => ({ value: l.value, label: l.label }));
          row.action_report = linked.filter(l => l.group === 'action-report').map(l => ({ value: l.value, label: l.label }));
        }
        return row;
      });

      const table = setupTable(group);
      if (group === 'area' || group === 'template-floor-plan') {
        for (const col of table) {
          if (col.key === 'building') col.options = bfOptions.building;
          if (col.key === 'floor') col.options = bfOptions.floor;
        }
      }
      if (group === 'master-report') {
        for (const col of table) {
          if (col.key === 'group_report') col.options = mrOptions.group_report;
          if (col.key === 'action_report') col.options = mrOptions.action_report;
        }
      }

      const perms = crudPermission(req.user, 1125n);
      success(res, rows, 'Success', 200, {
        table,
        pagging: laravelPaging(total, limit, page),
        permission: { view: true, add: perms.add, edit: perms.edit, delete: perms.delete },
      });
    } catch (err: any) {
      console.error('Setup error:', err);
      error(res, 'Failed to load setup', 500);
    }
  }

  // ==================== SETUP GET TYPE (TypeController@getType parity) ====================
  static async setupGetType(req: Request, res: Response): Promise<void> {
    try {
      const group = (req.query.group as string) || '';
      const propertyId = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: propertyId, deleted_at: null, status: 1 };
      if (group) where.group = group;
      const data = await getPrisma().types.findMany({ where, orderBy: { sort: 'asc' } });
      // Laravel TypeController@getType parity — { value, label }
      success(res, data.map(d => ({ value: Number(d.id), label: d.name })), 'Success');
    } catch (err: any) {
      console.error('Setup get-type error:', err);
      error(res, 'Failed to load types', 500);
    }
  }

  // ==================== SETUP CREATE FORM ====================
  static async setupCreate(req: Request, res: Response): Promise<void> {
    try {
      success(res, { status: 1 }, 'Success', 200, {
        master: {
          statuses: [
            { value: 1, label: 'Active' },
            { value: 0, label: 'Inactive' },
          ],
        },
      });
    } catch (err: any) {
      error(res, 'Failed to load setup form', 500);
    }
  }

  // ==================== SETUP SHOW ====================
  static async setupShow(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      const d = await getPrisma().types.findUnique({ where: { id } });
      if (!d || d.deleted_at) { notFound(res); return; }
      success(res, { ...bigintToNumber(d), no: d.sort }, 'Success');
    } catch (err: any) {
      console.error('Setup show error:', err);
      error(res, 'Failed to load setup', 500);
    }
  }

  // ==================== SETUP STORE ====================
  static async setupStore(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      // Support group from both body and query (frontend sends as query param)
      const body = req.body || {};
      const query = req.query || {};
      const group = body.group || query.group || '';
      const { name, description, status, sort, text, image, building, floor } = body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const dup = await getPrisma().types.findFirst({ where: { name, group: group || '', property_id: propertyId } });
      if (dup) { badRequest(res, 'Name already exist'); return; }

      const d = await getPrisma().types.create({
        data: {
          property_id: propertyId,
          group: group || '',
          name,
          description: normalizeStr(description),
          text: normalizeStr(text),
          image: normalizeStr(image),
          sort: num(sort),
          status: status === true || status === 'true' ? 1 : (status ?? 1),
          created_at: new Date(),
          updated_at: new Date(),
          created_by: req.user?.id || null,
        },
      });

      // Area/template-floor-plan: sync Building+Floor Type self-relations (Laravel syncTypes parity)
      if (group === 'area' || group === 'template-floor-plan') {
        await syncAreaTypes(d.id, building, floor);
      }

      success(res, bigintToNumber(d), 'Created');
    } catch (err: any) {
      console.error('Setup store error:', err);
      error(res, 'Failed to create setup', 500);
    }
  }

  // ==================== SETUP UPDATE ====================
  static async setupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      const existing = await getPrisma().types.findUnique({ where: { id } });
      if (!existing) { notFound(res); return; }

      const body = req.body || {};
      const query = req.query || {};
      const group = body.group || query.group || existing.group;
      const { name, description, status, sort, text, image, building, floor } = body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id || null };
      if (name !== undefined) data.name = normalizeStr(name);
      if (group !== undefined) data.group = group;
      if (description !== undefined) data.description = normalizeStr(description);
      if (text !== undefined) data.text = normalizeStr(text);
      if (image !== undefined) data.image = normalizeStr(image);
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = status === true || status === 'true' || status === 1 ? 1 : num(status, 0);

      await getPrisma().types.update({ where: { id }, data });

      // Area/template-floor-plan: sync Building+Floor Type self-relations (Laravel syncTypes parity)
      if (group === 'area' || group === 'template-floor-plan') {
        await syncAreaTypes(id, building, floor);
      }

      success(res, null, 'Updated');
    } catch (err: any) {
      console.error('Setup update error:', err);
      error(res, 'Failed to update setup', 500);
    }
  }

  // ==================== SETUP UPDATE WITH FILE (TypeController@updateWithFile parity) ====================
  // Frontend (TableViewDocument config=true, room-configuration) sends multipart FormData
  static async setupUpdateWithFile(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      const existing = await getPrisma().types.findUnique({ where: { id } });
      if (!existing) { notFound(res); return; }

      const body = req.body || {};
      const group = body.group || req.query.group || existing.group;
      const { name, description, status, sort, text } = body;
      const file: any = (req as any).file;

      const data: any = { updated_at: new Date(), updated_by: req.user?.id || null };
      if (name !== undefined) data.name = normalizeStr(name);
      if (group !== undefined) data.group = group;
      if (description !== undefined) data.description = normalizeStr(description);
      if (text !== undefined) data.text = normalizeStr(text);
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = status === true || status === 'true' || status === 1 ? 1 : num(status, 0);

      if (file && file.buffer) {
        if (existing.image) {
          try { fs.unlinkSync(path.join(STORAGE_DIR, existing.image)); } catch { /* ignore */ }
        }
        const ext = path.extname(file.originalname || '') || '.jpg';
        const filename = `types/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
        fs.mkdirSync(path.join(STORAGE_DIR, 'types'), { recursive: true });
        fs.writeFileSync(path.join(STORAGE_DIR, filename), file.buffer);
        data.image = filename;
      }

      await getPrisma().types.update({ where: { id }, data });
      success(res, null, 'Updated');
    } catch (err: any) {
      console.error('Setup update-file error:', err);
      error(res, 'Failed to update setup', 500);
    }
  }

  // ==================== SETUP DESTROY ====================
  static async setupDestroy(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      await getPrisma().types.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id || null } });
      success(res, null, 'Deleted');
    } catch (err: any) {
      error(res, 'Failed to delete setup', 500);
    }
  }

  // ==================== NIGHT AUDIT AUDIT ====================
  static async nightAuditAudit(req: Request, res: Response): Promise<void> {
    try {
      const date = new Date().toISOString().split('T')[0];
      success(res, { date }, 'Success');
    } catch (err: any) {
      console.error('Night audit audit error:', err);
      error(res, 'Failed to get night audit date', 500);
    }
  }

  // ==================== NIGHT AUDIT SHIFT ====================
  static async nightAuditShift(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateStr = req.query.date as string;
      const group = req.query.group as string;

      const where: any = { property_id: propertyId, deleted_at: null };

      if (dateStr && dateStr !== '-1') {
        const d = new Date(dateStr);
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        where.date = { gte: d, lt: next };
      }

      const [data, total] = await Promise.all([
        getPrisma().shifts.findMany({
          where,
          include: {
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shifts.count({ where }),
      ]);

      const table = group
        ? []
        : [
            { key: 'id', name: 'ID' },
            { key: 'users', name: 'User', is_sub_query: true, sub_key: 'name' },
            { key: 'start', name: 'Start', type: 'date' },
            { key: 'end', name: 'End', type: 'date' },
            { key: 'date', name: 'Date', type: 'date' },
            { key: 'is_posting', name: 'Posted', type: 'boolean' },
            { key: 'status', name: 'Status' },
          ];

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
        table,
      });
    } catch (err: any) {
      console.error('Night audit shift error:', err);
      error(res, 'Failed to fetch night audit shifts', 500);
    }
  }

  // ==================== NIGHT AUDIT ROOM CHANGE ====================
  static async nightAuditRoomChange(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = {
        property_id: propertyId,
        is_posting: false,
        reservations: {
          some: {
            OR: [{ room_type_id_next: { not: null } }, { room_id_next: { not: null } }],
          },
        },
      };

      const [data, total] = await Promise.all([
        getPrisma().folios.findMany({
          where,
          orderBy: { created_at: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().folios.count({ where }),
      ]);

      const table = [
        { label: 'Folio No', key: 'folio_number', type: 'text', is_search: false },
        { label: 'Name', key: 'formated_guest_profile', type: 'text', is_search: false },
        { label: 'Check In', key: 'check_in_date', type: 'date', is_search: false },
        { label: 'Check Out', key: 'check_out_date', type: 'date', is_search: false },
      ];

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Night audit room change error:', err);
      error(res, 'Failed to load room change', 500);
    }
  }

  // ==================== NIGHT AUDIT NO SHOW ====================
  static async nightAuditNoShow(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateStr = req.query.date as string;

      if (!dateStr) { badRequest(res, 'date is required'); return; }

      const where: any = {
        property_id: propertyId,
        status_reservation: { in: [1, 0] },
        check_in_date: { lte: new Date(dateStr) },
        is_posting: false,
      };

      const [data, total] = await Promise.all([
        getPrisma().folios.findMany({ where, orderBy: { created_at: 'asc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().folios.count({ where }),
      ]);

      const table = [
        { label: 'Folio No', key: 'folio_number', type: 'text', is_search: false },
        { label: 'Name', key: 'formated_guest_profile', type: 'text', is_search: false },
        { label: 'Check In', key: 'check_in_date', type: 'date', is_search: false },
        { label: 'Check Out', key: 'check_out_date', type: 'date', is_search: false },
      ];

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Night audit no show error:', err);
      error(res, 'Failed to load no show', 500);
    }
  }

  // ==================== NIGHT AUDIT OVER STAY ====================
  static async nightAuditOverStay(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateStr = req.query.date as string;

      if (!dateStr) { badRequest(res, 'date is required'); return; }

      const where: any = {
        property_id: propertyId,
        status_reservation: 2,
        check_out_date: { lte: new Date(dateStr) },
        is_posting: false,
      };

      const [data, total] = await Promise.all([
        getPrisma().folios.findMany({ where, orderBy: { created_at: 'asc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().folios.count({ where }),
      ]);

      const table = [
        { label: 'Folio No', key: 'folio_number', type: 'text', is_search: false },
        { label: 'Name', key: 'formated_guest_profile', type: 'text', is_search: false },
        { label: 'Check In', key: 'check_in_date', type: 'date', is_search: false },
        { label: 'Check Out', key: 'check_out_date', type: 'date', is_search: false },
      ];

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Night audit over stay error:', err);
      error(res, 'Failed to load over stay', 500);
    }
  }

  // ==================== NIGHT AUDIT CHECK ====================
  static async nightAuditCheck(req: Request, res: Response): Promise<void> {
    try {
      const dateStr = req.query.date as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      if (!dateStr || dateStr === '-1') {
        badRequest(res, 'Valid date is required');
        return;
      }

      const d = new Date(dateStr);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);

      const openShifts = await getPrisma().shifts.count({
        where: {
          property_id: propertyId,
          date: { gte: d, lt: next },
          deleted_at: null,
          is_posting: false,
        },
      });

      success(res, {
        date: dateStr,
        open_shifts: openShifts,
        status: openShifts === 0 ? 'ready' : 'pending_shifts',
        message: openShifts === 0
          ? 'All shifts posted. Ready for night audit.'
          : `${openShifts} shift(s) still open. Please confirm all shifts first.`,
      }, 'Night audit check complete');
    } catch (err: any) {
      console.error('Night audit check error:', err);
      error(res, 'Failed to check night audit', 500);
    }
  }

  // ==================== DASHBOARD ====================
  static async getDashboard(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const roleIds: bigint[] = (req.user as any)?.roleIds ?? [];

      // Laravel DashboardController@index: role = user's first role (developer/anyaman bypass global property scope — node has no such scope)
      const role = await getPrisma().roles.findFirst({
        where: roleIds.length ? { id: roleIds[0] } : undefined,
        select: { list_dashboard: true },
      });

      if (!role?.list_dashboard) {
        const payload = { data: [], code: 200, message: 'Role not found' };
        res.status(400).type('text/plain').send(encrypt(JSON.stringify(payload)));
        return;
      }

      const listDashboard = Array.isArray(role.list_dashboard)
        ? role.list_dashboard
        : typeof role.list_dashboard === 'string'
          ? role.list_dashboard.split(',').filter(Boolean)
          : [];

      const businessDate = await AuthController.getBusinessDate(propertyId);
      const sd = (req.query.start_date as string) || businessDate;
      const ed = (req.query.end_date as string) || new Date(new Date(businessDate + 'T00:00:00Z').getTime() + 7 * 86400000).toISOString().substring(0, 10);
      const dateLog = (req.query.dateLog as string) || businessDate;

      const property = await getPrisma().properties.findUnique({
        where: { id: propertyId },
        select: { id: true, name: true, alias: true, logo: true, image: true, address: true, email: true, telp: true },
      });

      const responsePayload = {
        data: listDashboard,
        property: property ? {
          id: Number(property.id),
          name: property.name,
          alias: property.alias,
          logo: property.logo,
          image: property.image,
          address: property.address,
          email: property.email,
          phone: property.telp ? Number(property.telp) : null,
        } : null,
        dateLog,
        start_date: sd,
        end_date: ed,
        code: 200,
        message: 'Data has been loaded',
      };
      res.status(200).type('text/plain').send(encrypt(JSON.stringify(responsePayload)));
    } catch (err: any) {
      console.error('Get dashboard error:', err);
      error(res, 'Failed to load dashboard', 500);
    }
  }

  // ==================== DASHBOARD DETAIL ====================
  static async getDashboardDetail(req: Request, res: Response): Promise<void> {
    try {
      const code = req.params.code;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const dateLog = req.query.dateLog as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      const today = new Date().toISOString().split('T')[0];
      const sd = startDate || today;
      const ed = endDate || today;

      let list: any[] = [];
      let detail: any = null;
      const prisma = getPrisma();
      const dateRangeOf = (d: string) => {
        const s = new Date(d + 'T00:00:00Z');
        return { s, e: new Date(s.getTime() + 86400000) };
      };
      const fmtDMY = (d: string) => {
        const [y, m, dd] = d.split('-');
        return `${dd}/${m}/${y}`;
      };
      const ROOM_STATUSES = ['Vacant', 'Occupied', 'Due Out', 'Blocked', 'Out of Order'];
      const MAID_STATUSES = ['Clean', 'Dirty', 'Maid in Room', 'Inspection Required'];
      const STATUS = { check_in: 0, check_out: 1, cancel: 2, reservation: 3, in_house: 4, pending: 5 };

      // ==== Room.getListAndMaidStatusRoom parity (total_room / chart_room) ====
      const computeRoomData = async () => {
        const rooms = await prisma.rooms.findMany({
          where: { property_id: propertyId, deleted_at: null, is_physical: true },
          select: { room_status: true, maid_status: true },
        });
        const roomRows = [
          { name: 'Total Rooms', data: rooms.length },
          { name: 'OOO', data: rooms.filter(r => r.room_status === 4).length },
          { name: 'Blocked Rooms', data: 0 },
          { name: 'Saleable Room', data: rooms.filter(r => [0, 1, 2].includes(r.room_status)).length },
        ];
        const maidAll = MAID_STATUSES.map((alias, i) => ({ name: alias, data: rooms.filter(r => r.maid_status === i).length }));
        return { roomRows, maidAll };
      };

      // ==== Reservation.getTransactionRevenueOnly + getRoomSoldPerDate parity (forecast charts) ====
      const computeRevenueForecast = async () => {
        const s = new Date(sd + 'T00:00:00Z');
        const e = new Date(new Date(ed + 'T00:00:00Z').getTime() + 86400000);
        const reservations = await prisma.reservations.findMany({
          where: { property_id: propertyId, date: { gte: s, lt: e }, folios: { status_reservation: { not: STATUS.cancel } } },
          select: { date: true, total: true, room_id: true, folios: { select: { status_reservation: true } } },
        });
        const totalRooms = await prisma.rooms.count({ where: { property_id: propertyId, deleted_at: null, is_physical: true } });
        const TotalroomAvailable = totalRooms > 0 ? totalRooms : 1;

        const byDate = new Map<string, { rev: number; sold: number }>();
        for (const r of reservations) {
          const key = r.date.toISOString().substring(0, 10);
          const cur = byDate.get(key) || { rev: 0, sold: 0 };
          cur.rev += Number(r.total ?? 0);
          if (r.room_id != null && (r.folios?.status_reservation === STATUS.check_in || r.folios?.status_reservation === STATUS.reservation)) cur.sold += 1;
          byDate.set(key, cur);
        }

        const totalSeries: any[] = [];
        const revenueSeries: any[] = [];
        const roomAvailableSeries: any[] = [];
        const occupancySeries: any[] = [];
        const statusSeries: any[][] = ROOM_STATUSES.map(() => []);
        const formatDate: string[] = [];
        let grandRev = 0;
        let grandSold = 0;

        for (let d = new Date(s); d < e; d.setUTCDate(d.getUTCDate() + 1)) {
          const key = d.toISOString().substring(0, 10);
          const v = byDate.get(key) || { rev: 0, sold: 0 };
          const dateLabel = fmtDMY(key);
          formatDate.push(dateLabel);
          totalSeries.push({ name: dateLabel, data: v.rev, room_sold: v.sold });
          revenueSeries.push({ name: dateLabel, data: moneyFormat(v.rev) });
          roomAvailableSeries.push({ name: dateLabel, data: TotalroomAvailable });
          const roomSold = v.sold > 0 ? v.sold : 1;
          occupancySeries.push({ name: dateLabel, data: moneyFormat((roomSold / TotalroomAvailable) * 100) });
          ROOM_STATUSES.forEach((_, idx) => {
            const count = idx === 1 ? v.sold : idx === 0 ? Math.max(0, TotalroomAvailable - v.sold) : 0;
            statusSeries[idx].push({ name: dateLabel, data: count });
          });
          grandRev += v.rev;
          grandSold += v.sold;
        }
        totalSeries.push({ name: 'Total', data: grandRev, room_sold: grandSold });

        const chartAnalysis = [
          { name: 'Room Available', data: roomAvailableSeries },
          { name: 'Occupancy', data: occupancySeries },
          ...ROOM_STATUSES.map((name, idx) => ({ name, data: statusSeries[idx] })),
        ];

        return {
          total: totalSeries,
          revenue: { data: revenueSeries },
          chart: { data: chartAnalysis, date: formatDate },
        };
      };

      // ==== Folio.getDeparture / getArrival parity ====
      const getArrival = async () => {
        const { s, e } = dateRangeOf(dateLog || sd);
        const folios = await prisma.folios.findMany({
          where: { property_id: propertyId, deleted_at: null, check_in_date: { gte: s, lt: e }, status_reservation: { in: [STATUS.check_in, STATUS.reservation] } },
          select: { id: true, parent: true, type_reservation: true, status_reservation: true, company_profile_id: true, company_profiles_folios_company_profile_idTocompany_profiles: { select: { name: true } } },
        });
        const fit = (f: any) => (f.type_reservation || '').toLowerCase() === 'fit';
        const git = (f: any) => (f.type_reservation || '').toLowerCase() === 'git' && Number(f.parent) !== 0;
        const gitAll = (f: any) => (f.type_reservation || '').toLowerCase() === 'git';
        const exp = (f: any) => fit(f) || git(f);
        const act = (f: any) => f.status_reservation === STATUS.check_in && (fit(f) || git(f));
        const fitExpected = folios.filter(fit).length;
        const fitActual = folios.filter(f => f.status_reservation === STATUS.check_in && fit(f)).length;
        const gitExpected = folios.filter(git).length;
        const gitActual = folios.filter(f => f.status_reservation === STATUS.check_in && git(f)).length;
        const groups = new Map<number, any[]>();
        for (const f of folios.filter(gitAll)) {
          const k = Number(f.company_profile_id);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(f);
        }
        return {
          all: { expected: folios.filter(exp).length, actual: folios.filter(act).length, due_to_arrival: folios.filter(exp).length - folios.filter(act).length },
          fit: { expected: fitExpected, actual: fitActual, due_to_arrival: fitExpected - fitActual },
          git: { total_git: groups.size, expected: gitExpected, actual: gitActual, due_to_arrival: gitExpected - gitActual, groups },
        };
      };
      const getDeparture = async () => {
        const { s, e } = dateRangeOf(dateLog || sd);
        const folios = await prisma.folios.findMany({
          where: { property_id: propertyId, deleted_at: null, check_out_date: { gte: s, lt: e }, status_reservation: { in: [STATUS.check_in, STATUS.check_out] } },
          select: { id: true, parent: true, type_reservation: true, status_reservation: true, company_profile_id: true, company_profiles_folios_company_profile_idTocompany_profiles: { select: { name: true } } },
        });
        const fit = (f: any) => (f.type_reservation || '').toLowerCase() === 'fit';
        const git = (f: any) => (f.type_reservation || '').toLowerCase() === 'git' && Number(f.parent) !== 0;
        const exp = (f: any) => fit(f) || git(f);
        const act = (f: any) => f.status_reservation === STATUS.check_out && (fit(f) || git(f));
        const fitExpected = folios.filter(fit).length;
        const fitActual = folios.filter(f => f.status_reservation === STATUS.check_out && fit(f)).length;
        const gitExpected = folios.filter(git).length;
        const gitActual = folios.filter(f => f.status_reservation === STATUS.check_out && git(f)).length;
        const groups = new Map<number, any[]>();
        for (const f of folios.filter(git)) {
          const k = Number(f.company_profile_id);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(f);
        }
        return {
          all: { expected: folios.filter(exp).length, actual: folios.filter(act).length, due_to_departure: folios.filter(exp).length - folios.filter(act).length },
          fit: { expected: fitExpected, actual: fitActual, due_to_departure: fitExpected - fitActual },
          git: { total_git: groups.size, expected: gitExpected, actual: gitActual, due_to_departure: gitExpected - gitActual, groups },
        };
      };

      // ==== Transaction.getRevenueDTD/MTD/YTD parity (today_revenue) ====
      const revenueRange = async (from: Date, to: Date) => {
        const defaultItems = await prisma.code_items.findMany({ where: { code_posts: { type: 'DEFAULT' } }, select: { id: true } });
        const rows = await prisma.transactions.findMany({
          where: {
            property_id: propertyId, deleted_at: null, is_void: 0, date: { gte: from, lte: to },
            folios: { status_reservation: { not: STATUS.cancel } },
            code_item_id: { in: defaultItems.map(i => i.id) },
          },
          select: { amount: true, type_amount: true },
        });
        return rows.reduce((sum, t) => sum + (t.type_amount === 'MINUS' ? -1 : 1) * Number(t.amount), 0);
      };

      // ==== Reservation.getHouseUseComplimentary parity (house_use_complimentary) ====
      const getHouseUseComplimentary = async () => {
        const s = new Date(sd + 'T00:00:00Z');
        const e = new Date(new Date(ed + 'T00:00:00Z').getTime() + 86400000);
        const folios = await prisma.folios.findMany({
          where: {
            property_id: propertyId, deleted_at: null, status_reservation: { not: STATUS.cancel },
            AND: [
              { OR: [{ check_in_date: { gte: s, lte: e } }, { check_out_date: { gte: s, lte: e } }] },
              { OR: [{ is_house_use: true }, { complimentary: true }] },
            ],
          },
          select: { id: true, is_house_use: true, complimentary: true, type_reservation: true, first_name: true, last_name: true, reservations: { orderBy: { date: 'desc' }, take: 1, select: { room_name: true, rate_name: true } } },
        });
        const notGit = (f: any) => (f.type_reservation || '').toLowerCase() !== 'git';
        const rows: any[] = [];
        const houseuse = folios.filter(f => f.is_house_use && notGit(f));
        rows.push({ name: 'House Use', data: `${houseuse.length} Room(s)` });
        houseuse.forEach((f, i) => {
          const r = f.reservations?.[0];
          rows.push({ name: '', data: `${i + 1}. ${f.first_name || ''} ${f.last_name || ''}`.trim() + ` - ${r?.room_name || '-'} - ${r?.rate_name || '-'}` });
        });
        const comp = folios.filter(f => f.complimentary && notGit(f));
        rows.push({ name: 'Complimentary', data: `${comp.length} Room(s)` });
        comp.forEach((f, i) => {
          const r = f.reservations?.[0];
          rows.push({ name: '', data: `${i + 1}. ${f.first_name || ''} ${f.last_name || ''}`.trim() + ` - ${r?.room_name || '-'} - ${r?.rate_name || '-'}` });
        });
        return rows;
      };

      const normalizeDashboardCode = (rawCode?: string | string[]) => {
        const codeKey = String(Array.isArray(rawCode) ? (rawCode[0] ?? '') : (rawCode ?? '')).trim();
        const aliases: Record<string, string> = {
          total_rooms: 'total_room',
          occupancy: 'chart_room',
          arrivals: 'arrival_git',
          departures: 'departure',
          in_house: 'total_arrival_git_fit',
          revenue: 'today_revenue',
          notification: 'notifications',
          notifications_list: 'notifications',
          guest_request: 'guest_requests',
          guest_requests_list: 'guest_requests',
        };
        return aliases[codeKey] || codeKey;
      };

      const resolvedCode = normalizeDashboardCode(code);

      switch (resolvedCode) {
        case 'total_room': {
          const { roomRows, maidAll } = await computeRoomData();
          list = [...maidAll, ...roomRows];
          detail = { type: 'number', span: '3', label: 'Total Room', header: ['Room', 'Amount'], list, link: '/room-statistic?parent=54&module=statistic', is_total: true };
          break;
        }
        case 'chart_room': {
          const { roomRows, maidAll } = await computeRoomData();
          detail = { type: 'chart-bar', span: '3', label: 'Chart Room', list: [...maidAll, ...roomRows].filter((r: any) => r.name !== 'Total'), link: '/room-statistic?parent=54&module=statistic' };
          break;
        }
        case 'daily_room_revenue_forecast': {
          const fc = await computeRevenueForecast();
          detail = { type: 'number', span: '3', label: 'Daily Room Revenue Forecast', header: ['Date', 'Revenue', 'Room Sold'], list: fc.total, link: '', is_total: true };
          break;
        }
        case 'chart_analysis_history_forecast': {
          const fc = await computeRevenueForecast();
          detail = { type: 'chart', span: '12', label: 'Chart Analysis History & Forecast', list: fc.chart, is_active: true };
          break;
        }
        case 'forecast':
        case 'total_room_revenue': {
          const fc = await computeRevenueForecast();
          detail = { type: 'chart', span: '12', label: resolvedCode === 'forecast' ? 'Forecast' : 'Total Room Revenue', list: fc.revenue, is_active: true };
          break;
        }
        case 'today_revenue': {
          const dLog = dateLog || sd;
          const dtd = await revenueRange(new Date(dLog + 'T00:00:00Z'), new Date(new Date(dLog + 'T00:00:00Z').getTime() + 86400000));
          const mtdStart = new Date(dLog.substring(0, 8) + '01T00:00:00Z');
          const mtd = await revenueRange(mtdStart, new Date(dLog + 'T00:00:00Z'));
          const ytd = await revenueRange(new Date(dLog.substring(0, 4) + '-01-01T00:00:00Z'), new Date(dLog + 'T00:00:00Z'));
          detail = { type: 'number-only', span: '3', label: ['Manual Posting Revenue', 'MTD Revenue', 'YTD Revenue'], data: [moneyFormat(dtd), moneyFormat(mtd), moneyFormat(ytd)], url: ['/cms/dashboard/today-revenue', '/cms/dashboard/mtd-revenue', '/cms/dashboard/ytd-revenue'], ispopup: true, svg: 'money' };
          break;
        }
        case 'departure': {
          const d = await getDeparture();
          const dep: any[] = [
            { name: 'Expected', data: d.all.expected },
            { name: 'Actual', data: d.all.actual },
            { name: 'Due to Depart', data: d.all.due_to_departure },
            { name: 'Group Departure Today', data: `${d.git.groups.size} Group(s)` },
          ];
          d.git.groups.forEach((g: any[]) => {
            dep.push({ name: '', data: `${g[0]?.company_profiles_folios_company_profile_idTocompany_profiles?.name || '-'} (${g.length} Room(s))` });
          });
          detail = { type: 'number', span: '3', label: 'Departure', header: ['Name', 'Amount'], list: dep, link: '', is_total: false };
          break;
        }
        case 'arrival_git': {
          const a = await getArrival();
          const arr: any[] = [
            { name: 'Total Room group', data: a.git.total_git },
            { name: 'Expected', data: a.git.expected },
            { name: 'Actual', data: a.git.actual },
            { name: 'Due to Arrival', data: a.git.due_to_arrival },
            { name: 'Group Arrival Today', data: `${a.git.groups.size} Group(s)` },
          ];
          a.git.groups.forEach((g: any[]) => {
            arr.push({ name: '', data: `${g[0]?.company_profiles_folios_company_profile_idTocompany_profiles?.name || '-'} (${g.length} Room(s))` });
          });
          detail = { type: 'number', span: '3', label: 'Arrival GIT', header: ['Name', 'Amount'], list: arr, link: '', is_total: false };
          break;
        }
        case 'arrival_fit': {
          const a = await getArrival();
          const arr: any[] = [
            { name: 'Expected', data: a.fit.expected },
            { name: 'Actual', data: a.fit.actual },
            { name: 'Due to Arrival', data: a.fit.due_to_arrival },
          ];
          detail = { type: 'number', span: '3', label: 'Arrival FIT', header: ['Name', 'Amount'], list: arr, link: '', is_total: false };
          break;
        }
        case 'total_arrival_git_fit': {
          const a = await getArrival();
          const arr: any[] = [
            { name: 'Expected', data: a.fit.expected + a.git.expected },
            { name: 'Actual', data: a.fit.actual + a.git.actual },
            { name: 'Due to Arrival', data: a.fit.due_to_arrival + a.git.due_to_arrival },
          ];
          detail = { type: 'number', span: '3', label: 'Total Arrival GIT & FIT', header: ['Name', 'Amount'], list: arr, link: '', is_total: false };
          break;
        }
        case 'house_use_complimentary': {
          list = await getHouseUseComplimentary();
          detail = { type: 'number', span: '3', label: 'HOUSE USE & COMPLIMENTARY', header: ['TITLE', '#'], list, link: '', is_total: false };
          break;
        }
        case 'hotel_competitor': {
          detail = { type: 'table', label: 'Hotel Competitor', url: '/cms/hotel-competitor-dashboard' };
          break;
        }
        case 'maps': {
          detail = { type: 'maps', span: '12', label: 'Hotel Competitor Surounding' };
          break;
        }
        case 'notifications': {
          const taskList = await prisma.tasks.findMany({
            where: {
              to_user_id: req.user?.id ?? 0n,
              deleted_at: null,
              status: { in: ['Open', 'In_Progress'] },
            },
            orderBy: { created_at: 'desc' },
            take: 10,
            select: { id: true, message: true, room_number: true, priority: true, created_at: true },
          });
          const items = taskList.map((t: any) => ({
            id: Number(t.id),
            title: t.message || 'Task',
            message: t.message || 'Task',
            room_number: t.room_number,
            priority: t.priority || 'Medium',
            created_at: t.created_at?.toISOString?.() || new Date().toISOString(),
          }));
          detail = { type: 'notification-list', label: 'Notifications', span: 4, count: items.length, items, url: '/cms/task' };
          break;
        }
        case 'guest_requests': {
          detail = { type: 'guest-request-list', label: 'Guest Requests', span: 4, count: 0, items: [], url: '/cms/guest-request' };
          break;
        }
        case 'market_segment_1':
        case 'market_segment_2':
        case 'market_segment_3':
        case 'market_segment_4':
        case 'mtd_actual_vs_budget':
        case 'room_sold_per_segment':
        case 'forecast_per_room_sold':
        case 'room_sold_rbv_vs_ro': {
          detail = {
            type: 'number',
            span: '3',
            label: resolvedCode.replace(/_/g, ' ').replace(/\b\w/g, (x: string) => x.toUpperCase()),
            header: ['Name', 'Amount'],
            list: [{ name: 'No Data', data: 0 }],
            link: '',
            is_total: false,
          };
          break;
        }
        default: {
          detail = null;
        }
      }

      const responsePayload = {
        code: '200',
        message: 'Data has been loaded',
        data: detail ? [detail] : [],
        start_date: sd,
        end_date: ed,
        dateLog: dateLog || today,
      };
      res.status(200).type('text/plain').send(encrypt(JSON.stringify(responsePayload)));
    } catch (err: any) {
      console.error('Get dashboard detail error:', err);
      res.status(500).type('text/plain').send(encrypt(JSON.stringify({ code: '500', message: 'Failed to load dashboard detail', data: null })));
    }
  }

  // ==================== HELPER ENDPOINTS ====================
static async helperTaskNotification(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const propertyId = req.user?.lastProperty ?? 0n;

      const [items, count] = await Promise.all([
        getPrisma().tasks.findMany({
          where: {
            to_user_id: userId,
            status: { in: ['Open', 'In_Progress'] },
            deleted_at: null,
          },
          orderBy: { created_at: 'desc' },
          take: 10,
        }),
        getPrisma().tasks.count({
          where: {
            to_user_id: userId,
            status: { in: ['Open', 'In_Progress'] },
            deleted_at: null,
          },
        }),
      ]);

      const mappedItems = items.map(t => ({
        id: Number(t.id),
        type: 'task',
        message: t.message || 'Task',
        room_number: t.room_number,
        link: `/task/${t.id}`,
        time: t.created_at?.toISOString() || new Date().toISOString(),
        created_at: t.created_at?.toISOString() || new Date().toISOString(),
        is_read: t.is_read === 1,
        from: 'System',
        priority: t.priority || 'Medium',
      }));

      success(res, { count, items: mappedItems }, 'Success');
    } catch (err: any) {
      console.error('Helper task notification error:', err);
      error(res, 'Failed to fetch notifications', 500);
    }
  }

  static async helperTotalCancelBookingEngine(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (HelperController@totalCancelBO): folios with is_notification 0 + booking_engine_uuid not null
      const propertyId = req.user?.lastProperty ?? 0n;

      const total = await getPrisma().folios.count({
        where: {
          property_id: propertyId,
          is_notification: false,
          booking_engine_uuid: { not: null },
        },
      });

      success(res, { total }, 'Successfully');
    } catch (err: any) {
      console.error('Helper total cancel booking engine error:', err);
      error(res, 'Failed to count cancellations', 500);
    }
  }

  static async helperReleaseLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (HelperController@releaseLastUserFolio): delete ALL rows for current user
      await getPrisma().last_user_folios.deleteMany({ where: { user_id: req.user?.id ?? 0n } });
      success(res, { status: 1 }, 'Last user folio released');
    } catch (err: any) {
      console.error('Helper release last user folio error:', err);
      error(res, 'Failed to release folio', 500);
    }
  }

  static async helperCheckLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (HelperController@checkLastUserFolio)
      const folioId = req.body.folio_id;
      if (!folioId) { badRequest(res, 'folio_id is required'); return; }

      const lastUserFolio = await getPrisma().last_user_folios.findFirst({
        where: { folio_id: BigInt(folioId) },
      });

      if (lastUserFolio) {
        success(res, { status: 1 }, 'Someone is editing this folio');
      } else {
        success(res, { status: 0 }, 'Successfully');
      }
    } catch (err: any) {
      console.error('Helper check last user folio error:', err);
      error(res, 'Failed to check folio', 500);
    }
  }

  static async helperReplaceLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (HelperController@replaceLastUserFolio): drop user's rows, then insert
      const folioId = req.body.folio_id;
      if (!folioId) { badRequest(res, 'folio_id is required'); return; }

      const userId = req.user?.id ?? 0n;
      const propertyId = req.user?.lastProperty ?? 0n;

      await getPrisma().last_user_folios.deleteMany({ where: { user_id: userId } });
      await getPrisma().last_user_folios.create({
        data: { user_id: userId, folio_id: BigInt(folioId), property_id: propertyId, datetime: new Date() },
      });

      success(res, { status: 1 }, 'Successfully');
    } catch (err: any) {
      console.error('Helper replace last user folio error:', err);
      error(res, 'Failed to replace folio session', 500);
    }
  }

  // ==================== ROOM CHANGE ====================
  static async roomChangeList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        getPrisma().room_change_histories.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().room_change_histories.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Room change list error:', err); error(res, 'Failed to list room changes', 500); }
  }

  static async roomChangeStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id ?? 0n;
      const { folio_id, folio_number, check_in_date, check_out_date, from_room_id, from_room_type_id, to_room_id, to_room_type_id, reason } = req.body;
      if (!folio_id || !to_room_id) { badRequest(res, 'folio_id and to_room_id are required'); return; }

      const data = await getPrisma().room_change_histories.create({
        data: { property_id: pid, folio_id: BigInt(folio_id), folio_number: folio_number || '', check_in_date: new Date(check_in_date), check_out_date: new Date(check_out_date), from_room_id: BigInt(from_room_id), from_room_type_id: BigInt(from_room_type_id), to_room_id: BigInt(to_room_id), to_room_type_id: BigInt(to_room_type_id), user_id: userId, reason, datetime: new Date() },
      });
      success(res, bigintToNumber(data), 'Room change recorded', 201);
    } catch (err: any) { console.error('Room change error:', err); error(res, 'Failed to record room change', 500); }
  }

  // ==================== LOG AUDIT ====================
  static async logAuditList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: Number(pid), deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().log_audits.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().log_audits.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Log audit list error:', err); error(res, 'Failed to list log audits', 500); }
  }

  static async postCodeBudget(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 9999;
      const propertyId = req.user?.lastProperty ?? 0n;
      const type = (req.query.type as string) || 'static';
      const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));

      const [budgets, codePosts] = await Promise.all([
        getPrisma().post_code_budgets.findMany({
          where: { property_id: propertyId, year },
          select: { code_post_id: true, month: true, budget: true },
        }),
        getPrisma().code_posts.findMany({
          where: {
            property_id: propertyId,
            deleted_at: null,
            ...(type === 'static' ? { type: 'STATISTIC' } : type === 'budget' ? { type: 'DEFAULT' } : {}),
          },
          orderBy: { id: 'asc' },
        }),
      ]);

      const budgetMap = new Map<string, number>();
      for (const b of budgets) budgetMap.set(`${b.code_post_id}:${b.month}`, Number(b.budget) || 0);

      const money = (v: number) => Number(v || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const data = codePosts.map(cp => {
        const row: any = { id: Number(cp.id), name: cp.name };
        for (let i = 1; i <= 12; i++) {
          row['month_' + i] = money(budgetMap.get(`${cp.id}:${i}`) ?? 0);
        }
        return row;
      });
      const totalData = data.length;

      const perms = crudPermission(req.user, 1117n);
      success(res, data, 'Success', 200, {
        table: postCodeBudgetTable(year),
        pagging: laravelPaging(totalData, limit, page),
        permission: { view: true, add: perms.add, edit: perms.edit, delete: perms.delete },
      });
    } catch (err: any) {
      console.error('Post code budget error:', err);
      error(res, 'Failed to fetch post code budget', 500);
    }
  }
}
