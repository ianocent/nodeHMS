import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';

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
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const type = req.params.type as string;
      const date = req.query.date as string;

      const where: any = { property_id: propertyId };

      if (type) {
        where.type = type;
      }

      if (date) {
        const dateObj = new Date(date);
        dateObj.setHours(0, 0, 0, 0);
        const nextDay = new Date(dateObj);
        nextDay.setDate(nextDay.getDate() + 1);
        where.date = { gte: dateObj, lt: nextDay };
      }

      const [data, total] = await Promise.all([
        getPrisma().system_balances.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().system_balances.count({ where }),
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
      console.error('System balance error:', err);
      error(res, 'Failed to fetch system balance', 500);
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

      const rows = ordered.map((d, i) => ({
        no: (page - 1) * limit + i + 1,
        id: Number(d.id),
        name: d.name,
        description: d.description,
        image: d.image,
        text: d.text,
        group: d.group,
        sort: d.sort,
        status: d.status,
      }));

      const perms = crudPermission(req.user, 1125n);
      success(res, rows, 'Success', 200, {
        table: setupTable(group),
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
      success(res, data.map(d => ({ id: Number(d.id), name: d.name })), 'Success');
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
            { value: 2, label: 'Inactive' },
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
      const { group, name, description, status, sort, text, image } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const dup = await getPrisma().types.findFirst({ where: { name, group: group || '', property_id: propertyId } });
      if (dup) { badRequest(res, 'Name already exist'); return; }

      const d = await getPrisma().types.create({
        data: {
          property_id: propertyId,
          group: group || '',
          name,
          description: description || null,
          text: text || null,
          image: image || null,
          sort: num(sort),
          status: status === true || status === 'true' ? 1 : (status ?? 1),
          created_at: new Date(),
          updated_at: new Date(),
          created_by: req.user?.id || null,
        },
      });
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

      const { group, name, description, status, sort, text, image } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id || null };
      if (name !== undefined) data.name = name;
      if (group !== undefined) data.group = group;
      if (description !== undefined) data.description = description;
      if (text !== undefined) data.text = text;
      if (image !== undefined) data.image = image;
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = status === true || status === 'true' || status === 1 ? 1 : num(status, 0);

      await getPrisma().types.update({ where: { id }, data });
      success(res, null, 'Updated');
    } catch (err: any) {
      console.error('Setup update error:', err);
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
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      const property = await getPrisma().properties.findUnique({
        where: { id: propertyId },
        select: { id: true, name: true, alias: true, logo: true, image: true, address: true, email: true, telp: true },
      });

      const today = new Date().toISOString().split('T')[0];

      const [totalRooms, occupiedRooms, arrivalsCount, departuresCount, inHouseCount, revenueResult] = await Promise.all([
        getPrisma().rooms.count({ where: { property_id: propertyId, deleted_at: null } }),
        getPrisma().rooms.count({ where: { property_id: propertyId, deleted_at: null, room_status: 1 } }),
        getPrisma().folios.count({ where: { property_id: propertyId, deleted_at: null, check_in_date: { gte: new Date(today), lt: new Date(new Date(today).getTime() + 86400000) }, status_reservation: { in: [1, 2] } } }),
        getPrisma().folios.count({ where: { property_id: propertyId, deleted_at: null, check_out_date: { gte: new Date(today), lt: new Date(new Date(today).getTime() + 86400000) }, status_reservation: { in: [1, 2, 3] } } }),
        getPrisma().folios.count({ where: { property_id: propertyId, deleted_at: null, status_reservation: 2, is_pos_trx: false } }),
        getPrisma().transactions.aggregate({ where: { property_id: propertyId, deleted_at: null, is_void: 0, date: { gte: new Date(today), lt: new Date(new Date(today).getTime() + 86400000) } }, _sum: { total: true } }),
      ]);

      const occupancyPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;
      const revenueTotal = Number(revenueResult._sum?.total ?? 0);

      const widgets = [
        { type: 'total_rooms', label: 'Total Rooms', value: totalRooms, header: 'Total Rooms', svg: 'home', link: '/room', is_total: true },
        { type: 'occupancy', label: 'Occupancy', value: `${occupancyPct}%`, header: 'Occupancy Rate', svg: 'chart-bar', link: '/statistic/occupancy', is_total: true },
        { type: 'arrivals', label: 'Arrivals Today', value: arrivalsCount, header: 'Arrivals', svg: 'login', link: '/front-desk?type=check_in', is_total: true },
        { type: 'departures', label: 'Departures Today', value: departuresCount, header: 'Departures', svg: 'logout', link: '/front-desk?type=check_out', is_total: true },
        { type: 'in_house', label: 'In House', value: inHouseCount, header: 'In House Guests', svg: 'users', link: '/front-desk?type=in_house', is_total: true },
        { type: 'revenue', label: 'Revenue Today', value: `Rp ${revenueTotal.toLocaleString('id-ID')}`, header: 'Revenue', svg: 'currency', link: '/report/daily', is_total: true },
      ];

      const responsePayload = {
        code: '200',
        message: 'Data has been loaded',
        data: widgets,
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
        dateLog: today,
        start_date: startDate || today,
        end_date: endDate || today,
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

      switch (code) {
        case 'total_rooms': {
          const roomsByType = await getPrisma().rooms.groupBy({
            by: ['room_type_id'],
            where: { property_id: propertyId, deleted_at: null },
            _count: { id: true },
          });
          const roomTypes = await getPrisma().room_types.findMany({
            where: { property_id: propertyId, deleted_at: null, status: 1 },
            select: { id: true, name: true },
          });
          const typeMap = new Map(roomTypes.map(rt => [Number(rt.id), rt.name]));
          for (const r of roomsByType) {
            const typeId = Number(r.room_type_id);
            const name = typeMap.get(typeId) || `Type #${typeId}`;
            const total = r._count.id;
            const occupied = await getPrisma().rooms.count({ where: { property_id: propertyId, deleted_at: null, room_type_id: BigInt(typeId), room_status: 1 } });
            list.push({ name, Room: total, room: total - occupied });
          }
          if (list.length === 0) { list.push({ name: 'No Data', Room: 0, room: 0 }); }
          detail = { type: 'number', label: 'Total Rooms', header: ['Room Type', 'Total', 'Available'], list, span: 4, link: '/room', is_total: true };
          break;
        }
        case 'occupancy': {
          const roomsByType = await getPrisma().rooms.groupBy({
            by: ['room_type_id'],
            where: { property_id: propertyId, deleted_at: null },
            _count: { id: true },
          });
          const roomTypes = await getPrisma().room_types.findMany({
            where: { property_id: propertyId, deleted_at: null, status: 1 },
            select: { id: true, name: true },
          });
          const typeMap = new Map(roomTypes.map(rt => [Number(rt.id), rt.name]));
          for (const r of roomsByType) {
            const typeId = Number(r.room_type_id);
            const name = typeMap.get(typeId) || `Type #${typeId}`;
            const total = r._count.id;
            const occupied = await getPrisma().rooms.count({ where: { property_id: propertyId, deleted_at: null, room_type_id: BigInt(typeId), room_status: 1 } });
            const rate = total > 0 ? `${Math.round((occupied / total) * 100)}%` : '0%';
            list.push({ name, Room: occupied, room: rate });
          }
          if (list.length === 0) { list.push({ name: 'No Data', Room: 0, room: '0%' }); }
          detail = { type: 'number', label: 'Occupancy', header: ['Room Type', 'Occupied', 'Rate'], list, span: 4, link: '/statistic/occupancy', is_total: true };
          break;
        }
        case 'arrivals': {
          const todayStart = new Date(today);
          const todayEnd = new Date(todayStart.getTime() + 86400000);
          const arrivals = await getPrisma().folios.findMany({
            where: { property_id: propertyId, deleted_at: null, check_in_date: { gte: todayStart, lt: todayEnd }, status_reservation: { in: [1, 2] } },
            select: { id: true, first_name: true, last_name: true, folio_number: true, status_reservation: true },
            orderBy: { check_in_date: 'asc' },
            take: 20,
          });
          for (const f of arrivals) {
            const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.folio_number || 'Guest';
            const statusMap: Record<number, string> = { 0: 'Pending', 1: 'Reservation', 2: 'Check In', 3: 'Check Out', 4: 'Cancelled' };
            list.push({ name, Room: f.folio_number || '-', room: statusMap[f.status_reservation ?? 0] || 'Unknown' });
          }
          if (list.length === 0) { list.push({ name: 'No arrivals today', Room: '-', room: '-' }); }
          detail = { type: 'number', label: 'Arrivals Today', header: ['Name', 'Folio', 'Status'], list, span: 4, link: '/front-desk?type=check_in', is_total: true };
          break;
        }
        case 'departures': {
          const todayStart = new Date(today);
          const todayEnd = new Date(todayStart.getTime() + 86400000);
          const departures = await getPrisma().folios.findMany({
            where: { property_id: propertyId, deleted_at: null, check_out_date: { gte: todayStart, lt: todayEnd }, status_reservation: { in: [1, 2, 3] } },
            select: { id: true, first_name: true, last_name: true, folio_number: true, status_reservation: true },
            orderBy: { check_out_date: 'asc' },
            take: 20,
          });
          for (const f of departures) {
            const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.folio_number || 'Guest';
            const statusMap: Record<number, string> = { 0: 'Pending', 1: 'Reservation', 2: 'Check In', 3: 'Check Out', 4: 'Cancelled' };
            list.push({ name, Room: f.folio_number || '-', room: statusMap[f.status_reservation ?? 0] || 'Unknown' });
          }
          if (list.length === 0) { list.push({ name: 'No departures today', Room: '-', room: '-' }); }
          detail = { type: 'number', label: 'Departures Today', header: ['Name', 'Folio', 'Status'], list, span: 4, link: '/front-desk?type=check_out', is_total: true };
          break;
        }
        case 'in_house': {
          const inHouse = await getPrisma().folios.findMany({
            where: { property_id: propertyId, deleted_at: null, status_reservation: 2, is_pos_trx: false },
            select: { id: true, first_name: true, last_name: true, folio_number: true, check_in_date: true },
            orderBy: { check_in_date: 'desc' },
            take: 20,
          });
          for (const f of inHouse) {
            const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.folio_number || 'Guest';
            const checkIn = f.check_in_date ? f.check_in_date.toISOString().split('T')[0] : '-';
            list.push({ name, Room: f.folio_number || '-', room: checkIn });
          }
          if (list.length === 0) { list.push({ name: 'No in-house guests', Room: '-', room: '-' }); }
          detail = { type: 'number', label: 'In House', header: ['Name', 'Folio', 'Check In'], list, span: 4, link: '/front-desk?type=in_house', is_total: true };
          break;
        }
        case 'revenue': {
          const todayStart = new Date(today);
          const todayEnd = new Date(todayStart.getTime() + 86400000);
          const transactions = await getPrisma().transactions.groupBy({
            by: ['code_name'],
            where: { property_id: propertyId, deleted_at: null, is_void: 0, date: { gte: todayStart, lt: todayEnd } },
            _sum: { total: true },
            orderBy: { _sum: { total: 'desc' } },
            take: 10,
          });
          let grandTotal = 0;
          for (const t of transactions) {
            const amount = Number(t._sum.total ?? 0);
            grandTotal += amount;
            list.push({ name: t.code_name || 'Other', Room: `Rp ${amount.toLocaleString('id-ID')}`, room: amount });
          }
          if (list.length > 0) { list.push({ name: 'Total', Room: `Rp ${grandTotal.toLocaleString('id-ID')}`, room: grandTotal }); }
          else { list.push({ name: 'No revenue today', Room: 'Rp 0', room: 0 }); }
          detail = { type: 'number', label: 'Revenue Today', header: ['Category', 'Amount', 'Raw'], list, span: 4, link: '/report/daily', is_total: true };
          break;
        }
        default: {
          detail = { type: 'number', label: 'Widget', header: ['Data'], list: [{ name: 'Unknown widget', Room: '-', room: '-' }], span: 4, link: '', is_total: false };
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
