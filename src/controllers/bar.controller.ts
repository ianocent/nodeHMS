import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MENU_ID_BAR = 87;
const MODULE_BAR = 'bar';

const STATUSES = [
  { value: 1, label: 'Active' },
  { value: 0, label: 'Inactive' },
];

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

function formatDate(d: Date | string | null): string | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().substring(0, 10);
}

function pickValue(v: any): any {
  if (v && typeof v === 'object' && 'value' in v) return v.value;
  return v;
}

async function getBusinessDate(propertyId: bigint | null | undefined): Promise<string> {
  if (!propertyId) return new Date().toISOString().substring(0, 10);
  const last = await prisma.log_audits.findFirst({
    where: { property_id: Number(propertyId) },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  if (last?.date) {
    const d = new Date(last.date);
    d.setDate(d.getDate() + 1);
    return d.toISOString().substring(0, 10);
  }
  return new Date().toISOString().substring(0, 10);
}

export class BarController {
  /**
   * GET /bar — list bars (rates where module='bar')
   * Mirrors Laravel BarController@index
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string || 'id';
      const order = sort.startsWith('-') ? 'desc' : 'asc';
      const sortKey = sort.replace(/^-/, '');

      const where: any = {
        module: MODULE_BAR,
        deleted_at: null,
        property_id: propertyId!,
      };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (req.query.start_date && req.query.end_date) {
        where.created_at = {
          gte: new Date(req.query.start_date as string),
          lte: new Date(req.query.end_date as string),
        };
      }

      const orderBy: any = sortKey === 'id' ? [{ end_date: 'desc' }, { id: 'asc' }] : { [sortKey]: order };
      const [bars, total] = await Promise.all([
        prisma.rates.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            code_posts: { select: { id: true, name: true } },
          },
        }),
        prisma.rates.count({ where }),
      ]);

      const codePostIds = bars.map((b) => b.code_post_id).concat(bars.map((b) => b.code_post_extra_bed_id).filter((x): x is bigint => x !== null));
      const extraBeds = codePostIds.length > 0
        ? await prisma.code_posts.findMany({
            where: { id: { in: codePostIds as bigint[] } },
            select: { id: true, name: true },
          })
        : [];
      const extraMap = new Map(extraBeds.map((c: any) => [Number(c.id), c.name]));

      const businessDate = await getBusinessDate(propertyId!);

      const codePosts = await prisma.code_posts.findMany({
        where: { deleted_at: null, status: 1, type: 'DEFAULT' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const codePostOptions = codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name }));

      const formatted = bars.map((b: any) => ({
        id: Number(b.id),
        name: b.name,
        code: b.code,
        description: b.description,
        start_date: formatDate(b.start_date),
        end_date: formatDate(b.end_date),
        code_post_id: {
          value: Number(b.code_post_id),
          label: b.code_posts?.name || '',
        },
        print_rate: !!b.print_rate,
        code_post_extra_bed_id: b.code_post_extra_bed_id
          ? { value: Number(b.code_post_extra_bed_id), label: extraMap.get(Number(b.code_post_extra_bed_id)) || '' }
          : null,
        minimum_rate: Number(b.minimum_rate),
        sort: b.sort,
        created_at: b.created_at,
        created_by: b.created_by ? Number(b.created_by) : null,
        status: b.status,
        is_view: true,
        is_edit: true,
        is_need_approval: false,
        relation: {
          code_post: b.code_posts
            ? { id: Number(b.code_posts.id), name: b.code_posts.name }
            : null,
        },
      }));

      const table = [
        { label: 'Status', key: 'status', type: 'checkbox', options: STATUSES, is_search: true },
        { label: 'Bar Code', key: 'code', type: 'text', is_link: true, is_search: true },
        { label: 'Description', key: 'description', type: 'text', is_search: true },
        { label: 'Minimum Rate', key: 'minimum_rate', type: 'number', is_search: true },
        {
          label: 'Start Date',
          key: 'start_date',
          type: 'date',
          is_search: true,
          value: businessDate,
          min: businessDate,
        },
        { label: 'End Date', key: 'end_date', type: 'date', is_search: true },
        { label: 'Post Code', key: 'code_post_id', type: 'select', options: codePostOptions, is_search: true },
        { label: 'Post Code Extra Bed', key: 'code_post_extra_bed_id', type: 'select', options: codePostOptions, is_search: true },
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID_BAR);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, bigintToNumber(formatted), 'Success', 200, {
        table,
        permission,
        search_data: [],
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
      console.error('Bar list error:', err);
      error(res, 'Failed to fetch bars', 500);
    }
  }

  /**
   * GET /bar/create — bar create form master
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const [codePosts, businessDate] = await Promise.all([
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        getBusinessDate(propertyId!),
      ]);

      success(res, null, 'Success', 200, {
        master: {
          statuses: STATUSES,
          code_posts: codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
          business_date: businessDate,
        },
      });
    } catch (err: any) {
      console.error('Bar create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /bar — create bar
   */
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const { code_post_id, code, description, start_date, end_date, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!code_post_id) errors.code_post_id = ['The code post id field is required.'];
      if (!code) errors.code = ['The code field is required.'];
      if (!start_date) errors.start_date = ['The start date field is required.'];
      if (!end_date) errors.end_date = ['The end date field is required.'];
      if (status === undefined || status === null) errors.status = ['The status field is required.'];
      if (Object.keys(errors).length > 0) {
        badRequest(res, Object.values(errors)[0][0]);
        return;
      }
      if (new Date(start_date) >= new Date(end_date)) {
        badRequest(res, 'The start date must be a date before end date.');
        return;
      }

      const overlap = await prisma.rates.findFirst({
        where: {
          module: MODULE_BAR,
          property_id: propertyId!,
          deleted_at: null,
          status: 1,
          AND: [
            { start_date: { lte: new Date(start_date) }, end_date: { gte: new Date(start_date) } },
          ],
        },
      });
      const overlap2 = await prisma.rates.findFirst({
        where: {
          module: MODULE_BAR,
          property_id: propertyId!,
          deleted_at: null,
          status: 1,
          AND: [
            { start_date: { lte: new Date(end_date) }, end_date: { gte: new Date(end_date) } },
          ],
        },
      });
      if (overlap || overlap2) {
        badRequest(res, 'Date range is overlap with another bar');
        return;
      }

      const duplicate = await prisma.rates.findFirst({
        where: { code: String(code), property_id: propertyId! },
      });
      if (duplicate) {
        badRequest(res, 'Code already exist');
        return;
      }

      const data: any = {
        property_id: propertyId!,
        module: MODULE_BAR,
        code_post_id: BigInt(pickValue(code_post_id)),
        code: String(code),
        description: description || null,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        status: status === true || status === 'true' || status === 1 ? 1 : 0,
        online: 0,
        staah: false,
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      };
      if (req.body.code_post_extra_bed_id !== undefined && req.body.code_post_extra_bed_id !== null) {
        data.code_post_extra_bed_id = BigInt(pickValue(req.body.code_post_extra_bed_id));
      }
      if (req.body.minimum_rate !== undefined) data.minimum_rate = Number(req.body.minimum_rate) || 0;
      if (req.body.print_rate !== undefined) data.print_rate = req.body.print_rate ? 1 : 0;
      if (req.body.sort !== undefined) data.sort = Number(req.body.sort) || 0;
      if (req.body.name !== undefined) data.name = req.body.name;

      const bar = await prisma.rates.create({ data });

      success(res, bigintToNumber({ id: Number(bar.id) }), 'Success', 200);
    } catch (err: any) {
      console.error('Bar store error:', err);
      error(res, 'Failed to create bar', 500);
    }
  }

  /**
   * GET /bar/:id — show bar
   */
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const bar = await prisma.rates.findUnique({
        where: { id },
        include: { code_posts: { select: { id: true, name: true } } },
      });
      if (!bar || bar.module !== MODULE_BAR || bar.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      const extraBed = bar.code_post_extra_bed_id
        ? await prisma.code_posts.findUnique({
            where: { id: bar.code_post_extra_bed_id },
            select: { id: true, name: true },
          })
        : null;

      success(res, {
        id: Number(bar.id),
        name: bar.name,
        code: bar.code,
        description: bar.description,
        start_date: formatDate(bar.start_date),
        end_date: formatDate(bar.end_date),
        code_post_id: { value: Number(bar.code_post_id), label: bar.code_posts?.name || '' },
        print_rate: !!bar.print_rate,
        code_post_extra_bed_id: extraBed ? { value: Number(extraBed.id), label: extraBed.name } : null,
        minimum_rate: Number(bar.minimum_rate),
        sort: bar.sort,
        created_at: bar.created_at,
        created_by: bar.created_by ? Number(bar.created_by) : null,
        status: bar.status,
      }, 'Success');
    } catch (err: any) {
      console.error('Bar show error:', err);
      error(res, 'Failed to fetch bar', 500);
    }
  }

  /**
   * GET /bar/:id/update — edit form (data + master)
   */
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const propertyId = req.user?.lastProperty;
      const bar = await prisma.rates.findUnique({
        where: { id },
        include: { code_posts: { select: { id: true, name: true } } },
      });
      if (!bar || bar.module !== MODULE_BAR || bar.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      const [codePosts, businessDate] = await Promise.all([
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        getBusinessDate(propertyId!),
      ]);
      const extraBed = bar.code_post_extra_bed_id
        ? await prisma.code_posts.findUnique({
            where: { id: bar.code_post_extra_bed_id },
            select: { id: true, name: true },
          })
        : null;

      success(res, {
        id: Number(bar.id),
        name: bar.name,
        code: bar.code,
        description: bar.description,
        start_date: formatDate(bar.start_date),
        end_date: formatDate(bar.end_date),
        code_post_id: { value: Number(bar.code_post_id), label: bar.code_posts?.name || '' },
        print_rate: !!bar.print_rate,
        code_post_extra_bed_id: extraBed ? { value: Number(extraBed.id), label: extraBed.name } : null,
        minimum_rate: Number(bar.minimum_rate),
        sort: bar.sort,
        created_at: bar.created_at,
        created_by: bar.created_by ? Number(bar.created_by) : null,
        status: bar.status,
      }, 'Success', 200, {
        master: {
          statuses: STATUSES,
          code_posts: codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
          business_date: businessDate,
        },
      });
    } catch (err: any) {
      console.error('Bar edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /bar/:id — update bar
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const userId = req.user?.id;
      const existing = await prisma.rates.findUnique({ where: { id } });
      if (!existing || existing.module !== MODULE_BAR || existing.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      const data: any = { updated_at: new Date(), updated_by: userId };

      const hasField = (k: string) => req.body[k] !== undefined && req.body[k] !== null;
      if (hasField('code_post_id')) data.code_post_id = BigInt(pickValue(req.body.code_post_id));
      if (hasField('code_post_extra_bed_id')) data.code_post_extra_bed_id = BigInt(pickValue(req.body.code_post_extra_bed_id));
      if (hasField('code')) data.code = String(req.body.code);
      if (hasField('description')) data.description = req.body.description;
      if (hasField('print_rate')) data.print_rate = req.body.print_rate ? 1 : 0;
      if (hasField('sort')) data.sort = Number(req.body.sort) || 0;
      if (hasField('name')) data.name = req.body.name;
      if (hasField('status')) data.status = req.body.status === true || req.body.status === 'true' || req.body.status === 1 ? 1 : 0;
      if (hasField('start_date')) data.start_date = new Date(req.body.start_date);
      if (hasField('end_date')) data.end_date = new Date(req.body.end_date);
      if (hasField('minimum_rate')) data.minimum_rate = Number(req.body.minimum_rate) || 0;

      const startDate = data.start_date || existing.start_date;
      const endDate = data.end_date || existing.end_date;
      if (new Date(startDate) >= new Date(endDate)) {
        badRequest(res, 'The start date must be a date before end date.');
        return;
      }

      const overlap = await prisma.rates.findFirst({
        where: {
          module: MODULE_BAR,
          property_id: existing.property_id,
          deleted_at: null,
          status: 1,
          id: { not: id },
          AND: [
            {
              OR: [
                { start_date: { lte: startDate }, end_date: { gte: startDate } },
                { start_date: { lte: endDate }, end_date: { gte: endDate } },
              ],
            },
          ],
        },
      });
      if (overlap) {
        badRequest(res, 'Date range is overlap with another bar');
        return;
      }

      await prisma.rates.update({ where: { id }, data });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar update error:', err);
      error(res, 'Failed to update bar', 500);
    }
  }

  /**
   * DELETE /bar/:id — soft delete
   */
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const existing = await prisma.rates.findUnique({ where: { id } });
      if (!existing || existing.module !== MODULE_BAR) {
        notFound(res, 'Not Found');
        return;
      }
      await prisma.rates.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: req.user?.id, status: 0, updated_at: new Date() },
      });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar destroy error:', err);
      error(res, 'Failed to delete bar', 500);
    }
  }

  /**
   * DELETE /bar/:id/delete — force delete
   */
  static async forceDelete(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const existing = await prisma.rates.findUnique({ where: { id } });
      if (!existing || existing.module !== MODULE_BAR) {
        notFound(res, 'Not Found');
        return;
      }
      await prisma.rates.delete({ where: { id } });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar force delete error:', err);
      error(res, 'Failed to delete bar', 500);
    }
  }

  /**
   * POST /bar/:id/restore
   */
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const existing = await prisma.rates.findUnique({ where: { id } });
      if (!existing || existing.module !== MODULE_BAR) {
        notFound(res, 'Not Found');
        return;
      }
      await prisma.rates.update({
        where: { id },
        data: { deleted_at: null, status: 0, updated_at: new Date() },
      });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar restore error:', err);
      error(res, 'Failed to restore bar', 500);
    }
  }

  /**
   * GET /bar/minimum-rate — room types with min rate
   */
  static async getRoomType(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 9999;

      const where: any = { deleted_at: null, status: 1 };
      if (propertyId) where.property_id = propertyId;

      const roomTypes = await prisma.room_types.findMany({
        where,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, min_rate: true },
      });
      const total = roomTypes.length;

      const data = roomTypes.map((rt: any) => ({
        id: Number(rt.id),
        name: rt.name,
        min_rate: Number(rt.min_rate),
      }));

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        { label: 'Min Rate', key: 'min_rate', type: 'number', is_search: false },
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID_BAR);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, data, 'Success', 200, {
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
      console.error('Bar minimum rate error:', err);
      error(res, 'Failed to fetch room types', 500);
    }
  }

  /**
   * PUT /bar/minimum-rate/:id — update room type min rate
   */
  static async updateRoomType(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const { min_rate } = req.body;
      if (min_rate === undefined || min_rate === null || min_rate === '') {
        badRequest(res, 'The min rate field is required.');
        return;
      }
      const roomType = await prisma.room_types.findUnique({ where: { id } });
      if (!roomType || roomType.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }
      await prisma.room_types.update({
        where: { id },
        data: { min_rate: Number(min_rate) || 0, updated_at: new Date(), updated_by: req.user?.id },
      });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar minimum rate update error:', err);
      error(res, 'Failed to update room type', 500);
    }
  }
}
