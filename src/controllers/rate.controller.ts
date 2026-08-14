import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATUS_ACTIVE = 1;
const MENU_ID = 86;
const MENU_ID_BAR = 87;

const STATUSES = [
  { value: 1, label: 'Active' },
  { value: 0, label: 'Inactive' },
];

const GRID_FIELDS = ['one_adult', 'two_adult', 'extra_adult', 'extra_child', 'min_night', 'max_night'];

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const RESTRICTION_FIELDS = ['stop_arrival', 'stop_departure', 'stop_sell', 'min_los'];

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
    return out;
  }
  return val;
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().substring(0, 10);
}

function getDatesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getDayIndex(date: Date): number {
  return date.getDay(); // 0=Sun, 1=Mon, ...
}

function getDayName(date: Date): string {
  return DAY_NAMES[date.getDay()];
}

export class RateController {
  // ─────────────────────────────────────────────
  // GET /api/rates
  // ─────────────────────────────────────────────
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string || 'id';
      const order = req.query.order === 'desc' ? 'desc' : 'asc';
      const propertyId = req.user?.lastProperty;

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null, module: 'rate' };

      if (propertyId) where.property_id = propertyId;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [rates, total] = await Promise.all([
        prisma.rates.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            code_posts: { select: { id: true, name: true } },
          },
        }),
        prisma.rates.count({ where }),
      ]);

      const formatted = rates.map((r: any) => ({
        ...r,
        id: Number(r.id),
        property_id: Number(r.property_id),
        code_post_id: Number(r.code_post_id),
        minimum_rate: Number(r.minimum_rate),
        start_date: r.start_date ? formatDate(r.start_date) : null,
        end_date: r.end_date ? formatDate(r.end_date) : null,
        code_post: r.code_posts ? { id: Number(r.code_posts.id), name: r.code_posts.name } : null,
        code_posts: undefined,
      }));

      const table = [
        { label: 'Code', key: 'code', type: 'none', is_search: true },
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Start Date', key: 'start_date', type: 'none', is_search: false },
        { label: 'End Date', key: 'end_date', type: 'none', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, bigintToNumber(formatted), 'Success', 200, {
        table,
        permission,
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
      console.error('Rate list error:', err);
      error(res, 'Failed to fetch rates', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/rates/create
  // ─────────────────────────────────────────────
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const [roomTypes, codePosts, companyTypes, cancelations] = await Promise.all([
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'company-type' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'cancellation-reservation' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const master = {
        statuses: STATUSES,
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        code_posts: codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
        comm_codes: [],
        company_types: companyTypes.map((t: any) => ({ value: Number(t.id), label: t.name })),
        cancelations: cancelations.map((t: any) => ({ value: Number(t.id), label: t.name })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: GRID_FIELDS.map((f) => ({ value: f, label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('Rate create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/rates
  // ─────────────────────────────────────────────
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const { name, code, start_date, end_date, code_post_id, description, rate_type, term_condition, cancellation_policy, notes, online, staah, min_advance_booking, max_advance_booking, minimum_rate, grouping, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];
      if (!code) errors.code = ['The code field is required.'];
      if (!code_post_id) errors.code_post_id = ['The code post id field is required.'];
      if (!start_date) errors.start_date = ['The start date field is required.'];
      if (!end_date) errors.end_date = ['The end date field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const rate = await prisma.rates.create({
        data: {
          property_id: propertyId!,
          code_post_id: BigInt(code_post_id),
          name,
          code,
          start_date: new Date(start_date),
          end_date: new Date(end_date),
          description: description || null,
          rate_type: rate_type || null,
          term_condition: term_condition || null,
          cancellation_policy: cancellation_policy || null,
          notes: notes || null,
          online: online ? 1 : 0,
          staah: staah === true || staah === 'true' || staah === 1,
          sync_online: 0,
          sync_staah: staah === true || staah === 'true' || staah === 1,
          min_advance_booking: min_advance_booking || 0,
          max_advance_booking: max_advance_booking || 0,
          minimum_rate: minimum_rate || 0,
          grouping: grouping || null,
          status: status !== undefined ? status : STATUS_ACTIVE,
          created_by: userId,
        },
      });

      const created = await prisma.rates.findUnique({
        where: { id: rate.id },
        include: { code_posts: { select: { id: true, name: true } } },
      });

      success(res, bigintToNumber(created), 'Success', 200);
    } catch (err: any) {
      console.error('Rate store error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Rate code already exists');
      } else {
        error(res, 'Failed to create rate', 500);
      }
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/rates/:id
  // ─────────────────────────────────────────────
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || !/^\d+$/.test(String(idParam))) { notFound(res, 'Rate not found'); return; }
      const id = BigInt(idParam);

      const rate = await prisma.rates.findUnique({
        where: { id },
        include: {
          code_posts: { select: { id: true, name: true } },
          rate_rates: {
            where: { deleted_at: null },
            select: { room_type_id: true },
            distinct: ['room_type_id'],
          },
        },
      });

      if (!rate || rate.deleted_at) {
        notFound(res, 'Rate not found');
        return;
      }

      const roomTypeIds = rate.rate_rates.map((rr) => rr.room_type_id);
      const roomTypes = roomTypeIds.length > 0
        ? await prisma.room_types.findMany({
            where: { id: { in: roomTypeIds }, deleted_at: null },
            select: { id: true, name: true },
          })
        : [];

      const result = {
        ...rate,
        id: Number(rate.id),
        property_id: Number(rate.property_id),
        code_post_id: Number(rate.code_post_id),
        minimum_rate: Number(rate.minimum_rate),
        start_date: rate.start_date ? formatDate(rate.start_date) : null,
        end_date: rate.end_date ? formatDate(rate.end_date) : null,
        code_post: rate.code_posts ? { id: Number(rate.code_posts.id), name: rate.code_posts.name } : null,
        code_posts: undefined,
        rate_rates: undefined,
        room_types: roomTypes.map((rt: any) => ({ id: Number(rt.id), name: rt.name })),
      };

      success(res, result, 'Success');
    } catch (err: any) {
      console.error('Rate show error:', err);
      error(res, 'Failed to fetch rate', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/rates/:id/edit
  // ─────────────────────────────────────────────
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const [rate, roomTypes, codePosts, companyTypes, cancelations] = await Promise.all([
        prisma.rates.findUnique({
          where: { id },
          include: { code_posts: { select: { id: true, name: true } } },
        }),
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'company-type' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'cancellation-reservation' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      if (!rate || rate.deleted_at) {
        notFound(res, 'Rate not found');
        return;
      }

      const master = {
        statuses: STATUSES,
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        code_posts: codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
        comm_codes: [],
        company_types: companyTypes.map((t: any) => ({ value: Number(t.id), label: t.name })),
        cancelations: cancelations.map((t: any) => ({ value: Number(t.id), label: t.name })),
      };

      const result = {
        ...rate,
        id: Number(rate.id),
        property_id: Number(rate.property_id),
        code_post_id: Number(rate.code_post_id),
        code_post_extra_bed_id: rate.code_post_extra_bed_id ? Number(rate.code_post_extra_bed_id) : null,
        minimum_rate: Number(rate.minimum_rate),
        start_date: rate.start_date ? formatDate(rate.start_date) : null,
        end_date: rate.end_date ? formatDate(rate.end_date) : null,
        created_by: rate.created_by ? Number(rate.created_by) : null,
        updated_by: rate.updated_by ? Number(rate.updated_by) : null,
        deleted_by: rate.deleted_by ? Number(rate.deleted_by) : null,
        code_post: rate.code_posts ? { id: Number(rate.code_posts.id), name: rate.code_posts.name } : null,
        code_posts: undefined,
        master,
      };

      success(res, result, 'Success');
    } catch (err: any) {
      console.error('Rate edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  // ─────────────────────────────────────────────
  // PUT /api/rates/:id
  // ─────────────────────────────────────────────
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rates.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Rate not found');
        return;
      }

      const { name, code, start_date, end_date, code_post_id, description, rate_type, term_condition, cancellation_policy, notes, online, staah, min_advance_booking, max_advance_booking, minimum_rate, grouping, status } = req.body;

      const data: any = {
        description: description || null,
        rate_type: rate_type || null,
        term_condition: term_condition || null,
        cancellation_policy: cancellation_policy || null,
        notes: notes || null,
        online: online ? 1 : 0,
        staah: staah === true || staah === 'true' || staah === 1,
        sync_staah: staah === true || staah === 'true' || staah === 1,
        min_advance_booking: min_advance_booking || 0,
        max_advance_booking: max_advance_booking || 0,
        minimum_rate: minimum_rate !== undefined && minimum_rate !== null && minimum_rate !== '' ? Number(minimum_rate) : existing.minimum_rate,
        grouping: grouping || null,
        status: status !== undefined ? status : existing.status,
        updated_by: userId,
        updated_at: new Date(),
      };
      if (name !== undefined && name !== null && name !== '') data.name = name;
      if (code !== undefined && code !== null && code !== '') data.code = code;
      if (code_post_id !== undefined && code_post_id !== null && code_post_id !== '') data.code_post_id = BigInt(code_post_id);
      if (start_date !== undefined && start_date !== null && start_date !== '') data.start_date = new Date(start_date);
      if (end_date !== undefined && end_date !== null && end_date !== '') data.end_date = new Date(end_date);

      await prisma.rates.update({ where: { id }, data });

      const updated = await prisma.rates.findUnique({
        where: { id },
        include: { code_posts: { select: { id: true, name: true } } },
      });

      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Rate update error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Rate code already exists');
      } else {
        error(res, 'Failed to update rate', 500);
      }
    }
  }

  // ─────────────────────────────────────────────
  // DELETE /api/rates/:id
  // ─────────────────────────────────────────────
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const rate = await prisma.rates.findUnique({ where: { id } });
      if (!rate) {
        notFound(res, 'Rate not found');
        return;
      }

      await prisma.rates.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate destroy error:', err);
      error(res, 'Failed to delete rate', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/rates/:id/restore
  // ─────────────────────────────────────────────
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const rate = await prisma.rates.findUnique({ where: { id } });
      if (!rate) {
        notFound(res, 'Rate not found');
        return;
      }

      await prisma.rates.update({
        where: { id },
        data: { deleted_at: null, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate restore error:', err);
      error(res, 'Failed to restore rate', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/rates/:rateId/grid
  // ─────────────────────────────────────────────
  static async rateGrid(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;

      const startDateStr = req.query.start_date as string;
      const endDateStr = req.query.end_date as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      // Filter params: days_0..days_6, room_type_X, fields_X
      const dayFilter: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (req.query[`days_${i}`] === '1' || req.query[`days_${i}`] === 'true') {
          dayFilter.push(i);
        }
      }

      const roomTypeFilter: bigint[] = [];
      for (const key of Object.keys(req.query)) {
        if (key.startsWith('room_type_')) {
          const val = req.query[key];
          if (val === '1' || val === 'true') {
            const rtId = BigInt(key.replace('room_type_', ''));
            roomTypeFilter.push(rtId);
          }
        }
      }

      const fieldFilter: string[] = [];
      for (const key of Object.keys(req.query)) {
        if (key.startsWith('fields_')) {
          const val = req.query[key];
          if (val === '1' || val === 'true') {
            fieldFilter.push(key.replace('fields_', ''));
          }
        }
      }

      // Determine date range
      if (!startDateStr || !endDateStr) {
        success(res, [], 'Success', 200, { table: [], master: {}, pagging: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } });
        return;
      }

      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      const allDates = getDatesInRange(startDate, endDate);

      // Filter dates by day of week
      let filteredDates = allDates;
      if (dayFilter.length > 0) {
        filteredDates = allDates.filter((d) => dayFilter.includes(d.getDay()));
      }

      // Get all room types for this property
      const allRoomTypes = await prisma.room_types.findMany({
        where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
        orderBy: { name: 'asc' },
      });

      let targetRoomTypes = allRoomTypes;
      if (roomTypeFilter.length > 0) {
        targetRoomTypes = allRoomTypes.filter((rt) => roomTypeFilter.includes(rt.id));
      }

      const selectedFields = fieldFilter.length > 0 ? fieldFilter : GRID_FIELDS;

      // Pagination on dates
      const totalDates = filteredDates.length;
      const paginatedDates = filteredDates.slice((page - 1) * limit, page * limit);

      // Query rate_rates for these dates + room types
      const roomTypeIds = targetRoomTypes.map((rt) => rt.id);
      const dateStrs = paginatedDates.map((d) => new Date(formatDate(d)));

      const whereRateRates: any = {
        rate_id: rateId,
        property_id: propertyId,
        deleted_at: null,
        date: { in: dateStrs },
      };
      if (roomTypeIds.length > 0) {
        whereRateRates.room_type_id = { in: roomTypeIds };
      }

      const rateRates = await prisma.rate_rates.findMany({
        where: whereRateRates,
        orderBy: [{ date: 'asc' }, { room_type_id: 'asc' }],
      });

      // Build data rows: one per date, columns = roomType_field combinations
      const rows = paginatedDates.map((date) => {
        const dateStr = formatDate(date);
        const row: any = {
          date: dateStr,
          day_name: getDayName(date),
        };

        for (const rt of targetRoomTypes) {
          for (const field of selectedFields) {
            const colKey = `${Number(rt.id)}_${field}`;
            const match = rateRates.find(
              (rr) => formatDate(rr.date) === dateStr && rr.room_type_id === rt.id
            );
            row[colKey] = match ? Number((match as any)[field] ?? 0) : null;
          }
        }

        return row;
      });

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      const master = {
        room_types: targetRoomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name, min_rate: Number(rt.min_rate) })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: GRID_FIELDS.map((f) => ({ value: f, label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
      };

      success(res, rows, 'Success', 200, {
        permission,
        master,
        pagging: {
          current_page: page,
          last_page: Math.ceil(totalDates / limit),
          per_page: limit,
          total: totalDates,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, totalDates),
        },
      });
    } catch (err: any) {
      console.error('Rate grid error:', err);
      error(res, 'Failed to fetch rate grid', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/rates/:rateId/grid
  // ─────────────────────────────────────────────
  static async rateGridStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { start_date, end_date, text_fields = [] } = req.body;

      if (!start_date || !end_date) {
        badRequest(res, 'start_date and end_date are required');
        return;
      }

      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      const allDates = getDatesInRange(startDate, endDate);

      // Parse day/roomType/field filters from request
      const dayFilter: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (req.body[`days_${i}`] === 1 || req.body[`days_${i}`] === '1' || req.body[`days_${i}`] === true) {
          dayFilter.push(i);
        }
      }

      const roomTypeFilter: bigint[] = [];
      for (const key of Object.keys(req.body)) {
        if (key.startsWith('room_type_')) {
          const val = req.body[key];
          if (val === 1 || val === '1' || val === true) {
            const rtId = BigInt(key.replace('room_type_', ''));
            roomTypeFilter.push(rtId);
          }
        }
      }

      // Filter dates by day
      let targetDates = allDates;
      if (dayFilter.length > 0) {
        targetDates = allDates.filter((d) => dayFilter.includes(d.getDay()));
      }

      // Determine target room types
      let targetRoomTypes = roomTypeFilter;
      if (targetRoomTypes.length === 0) {
        const allRT = await prisma.room_types.findMany({
          where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, min_rate: true },
        });
        targetRoomTypes = allRT.map((rt) => rt.id);
      }

      // Get min_rate for validation
      const roomTypeMinRates = await prisma.room_types.findMany({
        where: { id: { in: targetRoomTypes }, deleted_at: null },
        select: { id: true, min_rate: true },
      });
      const minRateMap = new Map(roomTypeMinRates.map((rt) => [rt.id, Number(rt.min_rate)]));

      // Process text_fields: array of { room_type_id, one_adult, two_adult, etc. }
      for (const date of targetDates) {
        for (const rtId of targetRoomTypes) {
          // Find matching text_field entry for this room_type, or use defaults
          let fieldData: any = {};
          if (text_fields && text_fields.length > 0) {
            const match = text_fields.find((tf: any) => {
              const tfRtId = typeof tf.room_type_id === 'bigint' ? tf.room_type_id : BigInt(tf.room_type_id);
              return tfRtId === rtId;
            });
            if (match) {
              fieldData = match;
            }
          }

          // If no text_fields match, apply common values from body
          for (const field of GRID_FIELDS) {
            if (fieldData[field] === undefined && req.body[field] !== undefined) {
              fieldData[field] = req.body[field];
            }
          }

          // Validate min_rate
          const minRate = minRateMap.get(rtId) || 0;
          const oneAdult = parseFloat(fieldData.one_adult ?? 0);
          if (oneAdult < minRate) {
            // Continue with the value, but we could warn
          }

          await prisma.rate_rates.upsert({
            where: {
              rate_rates_rate_id_room_type_id_date_key: {
                rate_id: rateId,
                room_type_id: rtId,
                date: date,
              },
            } as any,
            create: {
              property_id: propertyId!,
              rate_id: rateId,
              room_type_id: rtId,
              date: date,
              one_adult: fieldData.one_adult ?? 0,
              two_adult: fieldData.two_adult ?? 0,
              extra_adult: fieldData.extra_adult ?? 0,
              extra_child: fieldData.extra_child ?? 0,
              min_night: fieldData.min_night ?? 0,
              max_night: fieldData.max_night ?? 0,
              status: STATUS_ACTIVE,
              created_by: userId,
            },
            update: {
              one_adult: fieldData.one_adult ?? 0,
              two_adult: fieldData.two_adult ?? 0,
              extra_adult: fieldData.extra_adult ?? 0,
              extra_child: fieldData.extra_child ?? 0,
              min_night: fieldData.min_night ?? 0,
              max_night: fieldData.max_night ?? 0,
              status: STATUS_ACTIVE,
              updated_by: userId,
              updated_at: new Date(),
            },
          });
        }
      }

      success(res, { updated: targetDates.length * targetRoomTypes.length }, 'Success');
    } catch (err: any) {
      console.error('Rate grid store error:', err);
      error(res, 'Failed to save rate grid', 500);
    }
  }

  // ─────────────────────────────────────────────
  // PUT /api/rates/:rateId/grid
  // ─────────────────────────────────────────────
  static async rateGridUpdate(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { date, room_type_id, ...fields } = req.body;

      if (!date || !room_type_id) {
        badRequest(res, 'date and room_type_id are required');
        return;
      }

      const targetDate = new Date(date);
      const targetRoomTypeId = BigInt(room_type_id);

      // Build update data from allowed fields
      const updateData: any = {
        property_id: propertyId!,
        rate_id: rateId,
        room_type_id: targetRoomTypeId,
        date: targetDate,
        updated_by: userId,
        updated_at: new Date(),
        status: STATUS_ACTIVE,
      };

      for (const field of GRID_FIELDS) {
        if (fields[field] !== undefined) {
          updateData[field] = fields[field];
        }
      }
      for (const field of RESTRICTION_FIELDS) {
        if (fields[field] !== undefined) {
          updateData[field] = fields[field];
        }
      }

      await prisma.rate_rates.upsert({
        where: {
          rate_rates_rate_id_room_type_id_date_key: {
            rate_id: rateId,
            room_type_id: targetRoomTypeId,
            date: targetDate,
          },
        } as any,
        create: {
          ...updateData,
          created_by: userId,
        },
        update: updateData,
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate grid update error:', err);
      error(res, 'Failed to update rate grid', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/rates/:rateId/restrictions
  // ─────────────────────────────────────────────
  static async rateGridRestriction(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const startDateStr = req.query.start_date as string;
      const endDateStr = req.query.end_date as string;

      const where: any = {
        rate_id: rateId,
        property_id: propertyId,
        deleted_at: null,
      };

      if (startDateStr && endDateStr) {
        where.date = { gte: new Date(startDateStr), lte: new Date(endDateStr) };
      }

      // Apply day filters
      const dayFilter: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (req.query[`days_${i}`] === '1' || req.query[`days_${i}`] === 'true') {
          dayFilter.push(i);
        }
      }

      // Apply room_type filters
      const roomTypeFilter: bigint[] = [];
      for (const key of Object.keys(req.query)) {
        if (key.startsWith('room_type_')) {
          if (req.query[key] === '1' || req.query[key] === 'true') {
            roomTypeFilter.push(BigInt(key.replace('room_type_', '')));
          }
        }
      }
      if (roomTypeFilter.length > 0) {
        where.room_type_id = { in: roomTypeFilter };
      }

      // We need to post-filter by day since SQL doesn't have day-of-week filter easily
      let rateRates = await prisma.rate_rates.findMany({
        where,
        orderBy: [{ date: 'asc' }, { room_type_id: 'asc' }],
        include: {
          room_types: { select: { name: true } },
        },
      });

      if (dayFilter.length > 0) {
        rateRates = rateRates.filter((rr) => dayFilter.includes(rr.date.getDay()));
      }

      const total = rateRates.length;
      const paginated = rateRates.slice((page - 1) * limit, page * limit);

      const formatted = paginated.map((rr: any) => ({
        id: Number(rr.id),
        date: formatDate(rr.date),
        day_name: getDayName(rr.date),
        room_type_id: Number(rr.room_type_id),
        room_type_name: rr.room_types?.name || '',
        stop_arrival: rr.stop_arrival,
        stop_departure: rr.stop_departure,
        stop_sell: rr.stop_sell,
        min_los: rr.min_los,
      }));

      const roomTypes = await prisma.room_types.findMany({
        where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
        select: { id: true, name: true },
      });

      const master = {
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: RESTRICTION_FIELDS.map((f) => ({ value: f, label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
      };

      success(res, bigintToNumber(formatted), 'Success', 200, {
        master,
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
      console.error('Rate grid restriction error:', err);
      error(res, 'Failed to fetch restrictions', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/rates/:rateId/restrictions
  // ─────────────────────────────────────────────
  static async rateGridRestrictionStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { start_date, end_date, room_type_ids = [], ...restrictions } = req.body;

      if (!start_date || !end_date) {
        badRequest(res, 'start_date and end_date are required');
        return;
      }

      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      const allDates = getDatesInRange(startDate, endDate);

      // Day filter
      const dayFilter: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (req.body[`days_${i}`] === 1 || req.body[`days_${i}`] === '1' || req.body[`days_${i}`] === true) {
          dayFilter.push(i);
        }
      }
      let targetDates = allDates;
      if (dayFilter.length > 0) {
        targetDates = allDates.filter((d) => dayFilter.includes(d.getDay()));
      }

      let targetRoomTypeIds: bigint[];
      if (room_type_ids.length > 0) {
        targetRoomTypeIds = room_type_ids.map((id: any) => BigInt(id));
      } else {
        const allRT = await prisma.room_types.findMany({
          where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true },
        });
        targetRoomTypeIds = allRT.map((rt) => rt.id);
      }

      for (const date of targetDates) {
        for (const rtId of targetRoomTypeIds) {
          const updateData: any = {
            property_id: propertyId!,
            rate_id: rateId,
            room_type_id: rtId,
            date,
            updated_by: userId,
            updated_at: new Date(),
            status: STATUS_ACTIVE,
          };

          for (const field of RESTRICTION_FIELDS) {
            if (restrictions[field] !== undefined) {
              updateData[field] = restrictions[field];
            }
          }

          await prisma.rate_rates.upsert({
            where: {
              rate_rates_rate_id_room_type_id_date_key: {
                rate_id: rateId,
                room_type_id: rtId,
                date,
              },
            } as any,
            create: {
              ...updateData,
              created_by: userId,
            },
            update: updateData,
          });
        }
      }

      success(res, { updated: targetDates.length * targetRoomTypeIds.length }, 'Success');
    } catch (err: any) {
      console.error('Rate grid restriction store error:', err);
      error(res, 'Failed to save restrictions', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/bar-rates
  // ─────────────────────────────────────────────
  static emptyGrid(res: Response): void {
    success(res, [], 'Success', 200, { table: [], master: {}, pagging: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } });
  }

  static async barRateIndex(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const rateIdParam = req.query.rate_id as string;
      const startDateStr = req.query.start_date as string;
      const endDateStr = req.query.end_date as string;

      if (!rateIdParam || !/^\d+$/.test(rateIdParam)) {
        this.emptyGrid(res);
        return;
      }

      const rateId = BigInt(rateIdParam);

      const bar = await prisma.bars.findUnique({
        where: { id: rateId },
        select: { id: true, name: true },
      });

      if (!bar) {
        notFound(res, 'Bar is not found');
        return;
      }

      // Delegate to rateGrid logic
      const gridReq = {
        ...req,
        params: { rateId: rateIdParam },
        query: {
          ...req.query,
          start_date: startDateStr,
          end_date: endDateStr,
        },
        user: req.user,
      } as any;

      // We'll reuse the same grid logic but swap the context
      // For simplicity, return bar rate info + grid data
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!startDateStr || !endDateStr) {
        success(res, [], 'Success', 200, { table: [], master: {}, pagging: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } });
        return;
      }

      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      const allDates = getDatesInRange(startDate, endDate);
      const totalDates = allDates.length;
      const paginatedDates = allDates.slice((page - 1) * limit, page * limit);

      // Get room types for bar rates
      const allRoomTypes = await prisma.room_types.findMany({
        where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
        orderBy: { name: 'asc' },
      });

      const roomTypeIds = allRoomTypes.map((rt) => rt.id);
      const dateStrs = paginatedDates.map((d) => new Date(formatDate(d)));

      const rateRates = await prisma.rate_rates.findMany({
        where: {
          rate_id: rateId,
          property_id: propertyId!,
          deleted_at: null,
          date: { in: dateStrs },
          room_type_id: { in: roomTypeIds },
        },
        orderBy: [{ date: 'asc' }, { room_type_id: 'asc' }],
      });

      const rows = paginatedDates.map((date) => {
        const dateStr = formatDate(date);
        const row: any = {
          date: dateStr,
          day_name: getDayName(date),
        };

        for (const rt of allRoomTypes) {
          for (const field of GRID_FIELDS) {
            const colKey = `${Number(rt.id)}_${field}`;
            const match = rateRates.find(
              (rr) => formatDate(rr.date) === dateStr && rr.room_type_id === rt.id
            );
            row[colKey] = match ? Number((match as any)[field] ?? 0) : null;
          }
        }

        return row;
      });

      const permFlags = getPermissionFlags(req.user, MENU_ID_BAR);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      const master = {
        room_types: allRoomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name, min_rate: Number(rt.min_rate) })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: GRID_FIELDS.map((f) => ({ value: f, label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
        bar_info: {
          id: Number(bar.id),
          name: bar.name,
        },
      };

      success(res, rows, 'Success', 200, {
        permission,
        master,
        pagging: {
          current_page: page,
          last_page: Math.ceil(totalDates / limit),
          per_page: limit,
          total: totalDates,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, totalDates),
        },
      });
    } catch (err: any) {
      console.error('Bar rate index error:', err);
      error(res, 'Failed to fetch bar rates', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/bar-rates/create
  // ─────────────────────────────────────────────
  static async barRateCreate(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const [roomTypes, codePosts, rates] = await Promise.all([
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.rates.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, module: 'rate' },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const master = {
        statuses: STATUSES,
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        code_posts: codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
        rates: rates.map((r: any) => ({ value: Number(r.id), label: `${r.code} - ${r.name}` })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: GRID_FIELDS.map((f) => ({ value: f, label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('Bar rate create error:', err);
      error(res, 'Failed to load bar rate form data', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/bar-rates
  // ─────────────────────────────────────────────
  static async barRateStore(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { rate_id, start_date, end_date, text_fields = [] } = req.body;

      if (!rate_id || !start_date || !end_date) {
        badRequest(res, 'rate_id, start_date, and end_date are required');
        return;
      }

      const rateId = BigInt(rate_id);
      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      const allDates = getDatesInRange(startDate, endDate);

      // Get all active room types
      const allRoomTypes = await prisma.room_types.findMany({
        where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
        select: { id: true },
      });
      const allRoomTypeIds = allRoomTypes.map((rt) => rt.id);

      for (const date of allDates) {
        for (const rtId of allRoomTypeIds) {
          const fieldData: any = {};
          const match = text_fields.find((tf: any) => {
            const tfRtId = typeof tf.room_type_id === 'bigint' ? tf.room_type_id : BigInt(tf.room_type_id);
            return tfRtId === rtId;
          });
          if (match) {
            Object.assign(fieldData, match);
          }
          // Apply fallback from body
          for (const field of GRID_FIELDS) {
            if (fieldData[field] === undefined && req.body[field] !== undefined) {
              fieldData[field] = req.body[field];
            }
          }

          await prisma.rate_rates.upsert({
            where: {
              rate_rates_rate_id_room_type_id_date_key: {
                rate_id: rateId,
                room_type_id: rtId,
                date,
              },
            } as any,
            create: {
              property_id: propertyId!,
              rate_id: rateId,
              room_type_id: rtId,
              date,
              one_adult: fieldData.one_adult ?? 0,
              two_adult: fieldData.two_adult ?? 0,
              extra_adult: fieldData.extra_adult ?? 0,
              extra_child: fieldData.extra_child ?? 0,
              min_night: fieldData.min_night ?? 0,
              max_night: fieldData.max_night ?? 0,
              status: STATUS_ACTIVE,
              created_by: userId,
            },
            update: {
              one_adult: fieldData.one_adult ?? 0,
              two_adult: fieldData.two_adult ?? 0,
              extra_adult: fieldData.extra_adult ?? 0,
              extra_child: fieldData.extra_child ?? 0,
              min_night: fieldData.min_night ?? 0,
              max_night: fieldData.max_night ?? 0,
              status: STATUS_ACTIVE,
              updated_by: userId,
              updated_at: new Date(),
            },
          });
        }
      }

      success(res, { updated: allDates.length * allRoomTypeIds.length }, 'Success');
    } catch (err: any) {
      console.error('Bar rate store error:', err);
      error(res, 'Failed to save bar rates', 500);
    }
  }

  // ─────────────────────────────────────────────
  // PUT /api/bar-rates
  // ─────────────────────────────────────────────
  static async barRateUpdate(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { rate_id, date, room_type_id, ...fields } = req.body;

      if (!rate_id || !date || !room_type_id) {
        badRequest(res, 'rate_id, date, and room_type_id are required');
        return;
      }

      const rateId = BigInt(rate_id);
      const targetDate = new Date(date);
      const targetRoomTypeId = BigInt(room_type_id);

      const updateData: any = {
        property_id: propertyId!,
        rate_id: rateId,
        room_type_id: targetRoomTypeId,
        date: targetDate,
        updated_by: userId,
        updated_at: new Date(),
        status: STATUS_ACTIVE,
      };

      for (const field of GRID_FIELDS) {
        if (fields[field] !== undefined) {
          updateData[field] = fields[field];
        }
      }

      await prisma.rate_rates.upsert({
        where: {
          rate_rates_rate_id_room_type_id_date_key: {
            rate_id: rateId,
            room_type_id: targetRoomTypeId,
            date: targetDate,
          },
        } as any,
        create: {
          ...updateData,
          created_by: userId,
        },
        update: updateData,
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar rate update error:', err);
      error(res, 'Failed to update bar rate', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/rates/:rateId/day-uses
  // ─────────────────────────────────────────────
  static async dayUseList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = rateIdParam ? BigInt(rateIdParam) : undefined;
      const propertyId = req.user?.lastProperty;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const where: any = { deleted_at: null, property_id: propertyId };
      if (rateId) where.rate_id = rateId;
      if (search) {
        where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
      }

      const [items, total] = await Promise.all([
        prisma.rate_day_uses.findMany({
          where,
          orderBy: { sort: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.rate_day_uses.count({ where }),
      ]);

      const formatted = items.map((item: any) => ({
        ...item,
        id: Number(item.id),
        property_id: Number(item.property_id),
        rate_id: item.rate_id ? Number(item.rate_id) : null,
      }));

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Time', key: 'time', type: 'none', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, bigintToNumber(formatted), 'Success', 200, {
        table,
        permission,
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
      console.error('Day use list error:', err);
      error(res, 'Failed to fetch day uses', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/rates/:rateId/day-uses
  // ─────────────────────────────────────────────
  static async dayUseStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = rateIdParam ? BigInt(rateIdParam) : null;
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { name, time, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const item = await prisma.rate_day_uses.create({
        data: {
          property_id: propertyId!,
          rate_id: rateId,
          name,
          time: time || 0,
          status: status !== undefined ? status : STATUS_ACTIVE,
          created_by: userId,
        },
      });

      success(res, bigintToNumber(item), 'Success', 201);
    } catch (err: any) {
      console.error('Day use store error:', err);
      error(res, 'Failed to create day use', 500);
    }
  }

  // ─────────────────────────────────────────────
  // PUT /api/day-uses/:id
  // ─────────────────────────────────────────────
  static async dayUseUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rate_day_uses.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Day use not found');
        return;
      }

      const { name, time, status } = req.body;

      const data: any = { updated_at: new Date(), updated_by: userId };
      if (name !== undefined) data.name = name;
      if (time !== undefined) data.time = time;
      if (status !== undefined) data.status = status;

      await prisma.rate_day_uses.update({ where: { id }, data });

      const updated = await prisma.rate_day_uses.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Day use update error:', err);
      error(res, 'Failed to update day use', 500);
    }
  }

  // ─────────────────────────────────────────────
  // DELETE /api/day-uses/:id
  // ─────────────────────────────────────────────
  static async dayUseDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rate_day_uses.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Day use not found');
        return;
      }

      await prisma.rate_day_uses.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Day use destroy error:', err);
      error(res, 'Failed to delete day use', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/rates/:rateId/configs
  // ─────────────────────────────────────────────
  static async configList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const where: any = { deleted_at: null, property_id: propertyId!, rate_id: rateId };
      if (search) {
        where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
      }

      const [items, total] = await Promise.all([
        prisma.rate_configs.findMany({
          where,
          orderBy: { sort: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.rate_configs.count({ where }),
      ]);

      const formatted = items.map((item: any) => ({
        ...item,
        rate_id: Number(item.rate_id),
        property_id: Number(item.property_id),
      }));

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, bigintToNumber(formatted), 'Success', 200, {
        table,
        permission,
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
      console.error('Rate config list error:', err);
      error(res, 'Failed to fetch rate configs', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/rates/:rateId/configs
  // ─────────────────────────────────────────────
  static async configStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { name, description, image, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const item = await prisma.rate_configs.create({
        data: {
          property_id: propertyId!,
          rate_id: rateId,
          name,
          description: description || null,
          image: image || null,
          status: status !== undefined ? status : STATUS_ACTIVE,
          created_by: userId,
        },
      });

      success(res, bigintToNumber(item), 'Success', 201);
    } catch (err: any) {
      console.error('Rate config store error:', err);
      error(res, 'Failed to create rate config', 500);
    }
  }

  // ─────────────────────────────────────────────
  // PUT /api/rate-configs/:id
  // ─────────────────────────────────────────────
  static async configUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rate_configs.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Rate config not found');
        return;
      }

      const { name, description, image, status } = req.body;

      const data: any = { updated_at: new Date(), updated_by: userId };
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (image !== undefined) data.image = image;
      if (status !== undefined) data.status = status;

      await prisma.rate_configs.update({ where: { id }, data });

      const updated = await prisma.rate_configs.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Rate config update error:', err);
      error(res, 'Failed to update rate config', 500);
    }
  }

  // ─────────────────────────────────────────────
  // DELETE /api/rate-configs/:id
  // ─────────────────────────────────────────────
  static async configDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rate_configs.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Rate config not found');
        return;
      }

      await prisma.rate_configs.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate config destroy error:', err);
      error(res, 'Failed to delete rate config', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // Rate Link Listing (RateRelationController parity)
  // ═══════════════════════════════════════════════

  private static getValueRate(value: number, amount: number | null | undefined, type: string | null | undefined): number {
    const v = Number(value || 0);
    const a = Number(amount || 0);
    if (type === 'percentage') return Math.round((v + (v * a) / 100) * 100) / 100;
    return Math.round((v + a) * 100) / 100;
  }

  private static async getRateLinkRows(rateId: bigint, statusFilter?: string): Promise<any[]> {
    const [links, rll] = await Promise.all([
      prisma.model_has_rates.findMany({ where: { model_id: rateId, model_type: 'App\\Models\\Rate' } }),
      prisma.rate_link_listings.findMany({ where: { rate_id: rateId, ...(statusFilter ? { status: statusFilter } : {}) } }),
    ]);
    const linkedRateIds = links.map(l => l.rate_id);
    const rateRates = linkedRateIds.length > 0
      ? await prisma.rate_rates.findMany({
          where: { rate_id: { in: linkedRateIds }, deleted_at: null },
          include: { room_types: { select: { id: true, name: true } } },
        })
      : [];

    const byRoomType = new Map<bigint, any>();
    for (const rr of rateRates) {
      if (!byRoomType.has(rr.room_type_id)) byRoomType.set(rr.room_type_id, rr);
    }

    return [...byRoomType.entries()].map(([rtId, rr]: any) => {
      const link = rll.find(l => l.room_type_id === rtId);
      return {
        id: Number(rtId),
        room_type: rr.room_types?.name || null,
        amount: link?.amount ?? 0,
        type: link?.type
          ? { value: link.type, label: link.type === 'percentage' ? 'Percentage' : 'Amount' }
          : { value: 'percentage', label: 'Percentage' },
        offsetAdult1: link?.offsetAdult1 ?? 0,
        offsetAdult2: link?.offsetAdult2 ?? 0,
        offsetExtraAdult: link?.offsetExtraAdult ?? 0,
        offsetExtraChild: link?.offsetExtraChild ?? 0,
      };
    });
  }

  static async rateLinkListing(req: Request, res: Response): Promise<void> {
    try {
      const rateIdRaw = String(req.query.rate_id ?? req.query.id ?? '');
      if (!/^\d+$/.test(rateIdRaw)) { success(res, [], 'Success', 200, { table: [], permission: { view: true, add: true, edit: true, delete: true }, pagging: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } }); return; }
      const rateId = BigInt(rateIdRaw);
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }
      const rows = await this.getRateLinkRows(rateId);
      const table = [
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Amount', key: 'amount', type: 'number', is_search: false },
        { label: 'Type', key: 'type', type: 'select', is_search: false, options: [
          { value: 'percentage', label: 'Percentage' },
          { value: 'flat', label: 'Amount' },
        ] },
        { label: 'Extra Adult', key: 'offsetExtraAdult', type: 'number', is_search: false },
        { label: 'Extra Child', key: 'offsetExtraChild', type: 'number', is_search: false },
        { label: 'Applied to', key: 'applied_to', type: 'select_multiple', is_search: false,
          options: rows.map(r => ({ value: r.id, label: r.room_type })) },
      ];
      const permission = { view: true, add: true, edit: true, delete: true };
      success(res, rows, 'Success', 200, {
        table, permission,
        pagging: {
          current_page: 1, last_page: 1, per_page: rows.length || 1, total: rows.length, from: 1, to: rows.length,
        },
      });
    } catch (err: any) {
      console.error('Rate link listing error:', err);
      error(res, 'Failed to load rate link listing', 500);
    }
  }

  static async rateLinkApplyList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdRaw = String(req.query.rate_id ?? req.query.id ?? '');
      if (!/^\d+$/.test(rateIdRaw)) { success(res, [], 'Success', 200, { table: [], permission: { view: true, add: true, edit: true, delete: true }, pagging: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } }); return; }
      const rateId = BigInt(rateIdRaw);
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }
      const rows = await this.getRateLinkRows(rateId, '1');
      const table = [
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Amount', key: 'amount', type: 'number', is_search: false },
        { label: 'Extra Adult', key: 'offsetExtraAdult', type: 'number', is_search: false },
        { label: 'Extra Child', key: 'offsetExtraChild', type: 'number', is_search: false },
      ];
      success(res, rows, 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: {
          current_page: 1, last_page: 1, per_page: rows.length || 1, total: rows.length, from: 1, to: rows.length,
        },
      });
    } catch (err: any) {
      console.error('Rate link apply list error:', err);
      error(res, 'Failed to load rate link applied', 500);
    }
  }

  static async rateLinkUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const { rate_id, amount, type, offsetAdult1, offsetAdult2, offsetExtraAdult, offsetExtraChild, applied_to_ori } = req.body;
      if (!rate_id || !/^\d+$/.test(String(rate_id)) || !/^\d+$/.test(id)) { badRequest(res, 'rate_id and id are required'); return; }
      const rateId = BigInt(rate_id);
      const roomTypeIds: bigint[] = [BigInt(id)];
      if (Array.isArray(applied_to_ori)) {
        for (const at of applied_to_ori) {
          const v = at?.value ?? at;
          if (v && /^\d+$/.test(String(v))) roomTypeIds.push(BigInt(v));
        }
      }
      const userId = req.user?.id;
      for (const rtId of roomTypeIds) {
        const existing = await prisma.rate_link_listings.findFirst({
          where: { rate_id: rateId, room_type_id: rtId, status: '0' },
        });
        const data = {
          property_id: req.user?.lastProperty ?? null,
          amount: amount !== undefined ? Number(amount) : existing?.amount,
          type: type !== undefined ? type : existing?.type,
          offsetAdult1: offsetAdult1 !== undefined ? Number(offsetAdult1) : existing?.offsetAdult1,
          offsetAdult2: offsetAdult2 !== undefined ? Number(offsetAdult2) : existing?.offsetAdult2,
          offsetExtraAdult: offsetExtraAdult !== undefined ? Number(offsetExtraAdult) : existing?.offsetExtraAdult,
          offsetExtraChild: offsetExtraChild !== undefined ? Number(offsetExtraChild) : existing?.offsetExtraChild,
          status: '0',
          updated_at: new Date(),
          updated_by: userId,
        };
        if (existing) {
          await prisma.rate_link_listings.update({ where: { id: existing.id }, data });
        } else {
          await prisma.rate_link_listings.create({
            data: { rate_id: rateId, room_type_id: rtId, ...data, created_at: new Date(), created_by: userId },
          });
        }
      }
      success(res, { updated_room_types: roomTypeIds.map((r) => Number(r)) }, 'Success');
    } catch (err: any) {
      console.error('Rate link update error:', err);
      error(res, 'Failed to update rate link', 500);
    }
  }

  static async rateLinkStore(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.query.rate_id ?? req.body.rate_id ?? ''));
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }

      let idx: any[] = req.body.idx || [];
      if (!Array.isArray(idx)) idx = [idx];
      if (idx.includes(0)) {
        const bars = await prisma.rates.findMany({ where: { module: 'bar', deleted_at: null } });
        idx = bars.map(b => b.id);
      }
      const selectedIds = idx.filter((i: any) => /^\d+$/.test(String(i))).map((i: any) => BigInt(i));

      await prisma.model_has_rates.deleteMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate', status: 1 },
      });
      if (selectedIds.length > 0) {
        await prisma.model_has_rates.createMany({
          data: selectedIds.map(rid => ({
            rate_id: rid,
            model_type: 'App\\Models\\Rate',
            model_id: rateId,
            status: 1,
            temp_status: 1,
          })),
          skipDuplicates: true,
        });
      }
      await prisma.model_has_rates.updateMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
        data: { status: 0 },
      });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate link store error:', err);
      error(res, 'Failed to save rate links', 500);
    }
  }

  static async rateLinkApply(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.query.rate_id ?? ''));
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }

      await prisma.model_has_rates.deleteMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate', status: 1 },
      });
      await prisma.model_has_rates.updateMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
        data: { status: 1 },
      });
      const links = await prisma.model_has_rates.findMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
      });
      const linkedRateIds = links.map(l => l.rate_id);

      await prisma.rate_link_listings.deleteMany({ where: { rate_id: rateId, status: '1' } });
      await prisma.rate_link_listings.updateMany({ where: { rate_id: rateId }, data: { status: '1' } });
      const rll = await prisma.rate_link_listings.findMany({ where: { rate_id: rateId } });
      const roomTypeIds = rll.map(l => l.room_type_id).filter((x): x is bigint => x !== null);

      const existingRateRates = linkedRateIds.length > 0 && roomTypeIds.length > 0
        ? await prisma.rate_rates.findMany({
            where: { rate_id: { in: linkedRateIds }, room_type_id: { in: roomTypeIds }, deleted_at: null },
          })
        : [];

      if (roomTypeIds.length > 0) {
        await prisma.rate_rates.deleteMany({ where: { rate_id: rateId, room_type_id: { in: roomTypeIds } } });
      }

      const rows: any[] = [];
      const grouped = new Map<string, any[]>();
      for (const rr of existingRateRates) {
        const key = `${formatDate(rr.date)}|${rr.room_type_id}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(rr);
      }
      for (const [key, items] of grouped) {
        const [dateStr, rtIdStr] = key.split('|');
        const roomTypeId = BigInt(rtIdStr);
        const link = rll.find(l => l.room_type_id === roomTypeId);
        const sum = (f: string) => items.reduce((acc, it) => acc + Number(it[f] || 0), 0);
        const min = (f: string) => Math.min(...items.map(it => Number(it[f] || 0)));
        rows.push({
          rate_id: rateId,
          property_id: items[0].property_id,
          room_type_id: roomTypeId,
          date: new Date(dateStr),
          one_adult: this.getValueRate(sum('one_adult'), link?.amount, link?.type),
          two_adult: this.getValueRate(sum('two_adult'), link?.amount, link?.type),
          extra_adult: this.getValueRate(sum('extra_adult'), link?.offsetExtraAdult, link?.type),
          extra_child: this.getValueRate(sum('extra_child'), link?.offsetExtraChild, link?.type),
          min_night: sum('min_night'),
          max_night: sum('max_night'),
          stop_arrival: min('stop_arrival'),
          stop_departure: min('stop_departure'),
          stop_sell: min('stop_sell'),
          min_los: min('min_los'),
          status: 1,
          created_at: new Date(),
          updated_at: new Date(),
          created_by: req.user?.id,
        });
      }
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 500) {
          await prisma.rate_rates.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
        }
      }
      success(res, { applied: rows.length }, 'Success');
    } catch (err: any) {
      console.error('Rate link apply error:', err);
      error(res, 'Failed to apply rate links', 500);
    }
  }

  static async rateCompany(req: Request, res: Response): Promise<void> {
    try {
      const rateIdRaw = String(req.query.rate_id ?? req.query.id ?? '');
      if (!/^\d+$/.test(rateIdRaw)) { success(res, [], 'Success', 200, { table: [], permission: { view: true, add: true, edit: true, delete: true }, pagging: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } }); return; }
      const rateId = BigInt(rateIdRaw);
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const links = await prisma.model_has_rates.findMany({
        where: { rate_id: rateId, model_type: 'App\\Models\\CompanyProfile' },
      });
      const companyIds = links.map(l => l.model_id);
      const where: any = { id: { in: companyIds }, deleted_at: null };
      if (search) where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
      const [companies, total] = await Promise.all([
        prisma.company_profiles.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { id: 'asc' } }),
        prisma.company_profiles.count({ where }),
      ]);
      const table = [
        { label: 'Company', key: 'name', type: 'none', is_search: true },
        { label: 'Email', key: 'email', type: 'none', is_search: true },
        { label: 'Phone', key: 'mobile_phone', type: 'none', is_search: false },
        { label: 'Status', key: 'status_company', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];
      success(res, bigintToNumber(companies), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: {
          current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total,
          from: (page - 1) * limit + 1, to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Rate company list error:', err);
      error(res, 'Failed to load company applicable', 500);
    }
  }

  static async rateCompanyStore(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.body.rate_id ?? req.query.rate_id ?? ''));
      let idx: any[] = req.body.idx || [];
      if (!Array.isArray(idx)) idx = [idx];
      const selectedIds = idx.filter((i: any) => /^\d+$/.test(String(i))).map((i: any) => BigInt(i));
      await prisma.model_has_rates.deleteMany({
        where: { rate_id: rateId, model_type: 'App\\Models\\CompanyProfile' },
      });
      if (selectedIds.length > 0) {
        await prisma.model_has_rates.createMany({
          data: selectedIds.map(cid => ({
            rate_id: rateId,
            model_type: 'App\\Models\\CompanyProfile',
            model_id: cid,
            status: 1,
            temp_status: 1,
          })),
          skipDuplicates: true,
        });
      }
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate company store error:', err);
      error(res, 'Failed to save company applicable', 500);
    }
  }

  static async rateCompanyDelete(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.query.rate_id ?? req.body.rate_id ?? ''));
      const id = String(req.params.id);
      if (!/^\d+$/.test(id)) { notFound(res, 'Not found'); return; }
      await prisma.model_has_rates.deleteMany({
        where: { rate_id: rateId, model_type: 'App\\Models\\CompanyProfile', model_id: BigInt(id) },
      });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate company delete error:', err);
      error(res, 'Failed to delete company applicable', 500);
    }
  }
}
