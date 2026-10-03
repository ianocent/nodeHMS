import { prisma } from '../config/prisma';
import { activeWhere } from '../utils/querySafety';
import { Request, Response } from 'express';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { moneyFormat } from '../utils/cmsConfig';
import { error, notFound, success, validationError } from '../utils/response';


function bigintToNumber(val: any): any {
    if (val instanceof Date) {
      const u = val.getUTCFullYear();
      const iso = val.toISOString();
      if (u === 1970 && val.getUTCMonth() === 0 && val.getUTCDate() === 1) return iso.slice(11, 19);
      const s = iso.slice(0, 19).replace('T', ' ');
      return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
    }
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

const STATUS = { active: 1, inactive: 0 };
const MODULE_BAR = 'bar';

/**
 * Resolves a bar_id to a row.
 *
 * Laravel `App\Models\Bar` declares `protected $table = 'rates'` plus a
 * `module = 'bar'` global scope (Bar.php:20-28), so a "bar" is a rates row, not a
 * row in the `bars` table. The `bars` / `bar_inclusives` tables only exist because
 * of the original create_bar_table migration and are never written to: the
 * `bars` table is empty in the live database, so looking a bar up there always
 * missed and every bar inclusive POST came back 404 "Bar not found".
 */
async function findBar(barId: bigint, propertyId: bigint | null | undefined) {
  return prisma.rates.findFirst({
    where: { id: barId, module: MODULE_BAR, deleted_at: null, ...(propertyId ? { property_id: propertyId } : {}) },
    select: { id: true, property_id: true },
  });
}

/**
 * Laravel BarInclusive::formatTable() parity. `related` is only
 * ['description', 'cost'] here (the rate version also cascades frequency/cost_on,
 * which BarInclusive does not).
 *
 * The Stock column's options are CodeItem rows, so this is a factory rather than
 * a constant: a shared `options: []` literal left the BAR Inclusive dropdown
 * empty, so nothing could be picked and the store then failed validation with
 * "The stock field is required."
 */
function barInclusiveTable(codeItems: any[] = []) {
  return [
    {
      label: 'Stock',
      key: 'stock',
      type: 'select',
      // Laravel BarInclusive::formatTable() -> CodeItem::onlyActive(), each option
      // carrying description/cost so `is_related` can cascade them into the row.
      options: codeItems.map((c: any) => ({
        value: Number(c.id),
        label: c.name,
        description: c.description ?? '',
        cost: c.cost != null ? String(c.cost) : ''
      })),
      is_search: false,
      is_related: true,
      related: ['description', 'cost']
    },
    { label: 'Description', key: 'description', type: 'text', is_search: false },
    { label: 'Cost', key: 'cost', type: 'text', is_search: false },
    {
      label: 'Frequency',
      key: 'frequency',
      type: 'select',
      options: [
        { value: 'Daily', label: 'Daily' },
        { value: 'Once', label: 'Once' },
        { value: 'Twice', label: 'Twice' }
      ],
      is_search: false
    },
    {
      label: 'Cost On',
      key: 'cost_on',
      type: 'select',
      options: [
        { value: 'Actual Day', label: 'Actual Day' },
        { value: 'Next Day', label: 'Next Day' }
      ],
      is_search: false
    },
    { label: 'Status', key: 'status', type: 'badge', is_search: false },
    { label: 'Action', key: 'action', type: 'action', is_search: false }
  ];
}

export class RateAddonController {
  /**
   * GET /api/rates/:rateId/inclusives
   * List rate inclusives for a rate
   */
  static async inclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = String(req.query.rate_id ?? req.query.id ?? req.query.data ?? req.params.rateId ?? '');
      if (!/^\d+$/.test(rateIdParam)) {
        success(res, [], 'Success', 200, {
          table: [],
          permission: { view: true, add: true, edit: true, delete: true },
          master: { code_posts: [], room_types: [] },
        });
        return;
      }
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;

      const where: any = { rate_id: rateId, deleted_at: null };
      if (propertyId) where.property_id = propertyId;

      const inclusives = await prisma.rate_inclusives.findMany({
        where,
        orderBy: { sort: 'asc' }
      });

      const [codePosts, roomTypes, codeItems] = await Promise.all([
        prisma.code_posts.findMany({ where: activeWhere('code_posts', {}, propertyId ?? null), select: { id: true, name: true } }),
        prisma.room_types.findMany({ where: activeWhere('room_types', {}, propertyId ?? null), select: { id: true, name: true } }),
        prisma.code_items.findMany({ where: activeWhere('code_items', { property_id: propertyId ?? 0n }, propertyId ?? null), select: { id: true, name: true, description: true, cost: true } })
      ]);

      const data = inclusives.map(i => ({
        ...i,
        id: Number(i.id),
        property_id: Number(i.property_id),
        rate_id: Number(i.rate_id),
        cost: Number(i.cost)
      }));

      // PHP RateInclusive::formatTable() parity
      const table = [
        {
          label: 'Stock',
          key: 'stock',
          type: 'select',
          options: codeItems.map((c: any) => ({
            value: Number(c.id),
            label: c.name,
            description: c.description ?? '',
            cost: moneyFormat(Number(c.cost)),
            frequency: { value: 'Daily', label: 'Daily' },
            cost_on: { value: 'Actual Day', label: 'Actual Day' }
          })),
          is_search: false,
          is_related: true,
          related: ['description', 'cost', 'frequency', 'cost_on']
        },
        { label: 'Description', key: 'description', type: 'text', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
        {
          label: 'Frequency',
          key: 'frequency',
          type: 'select',
          options: [
            { value: 'Daily', label: 'Daily' },
            { value: 'Once', label: 'Once' },
            { value: 'Twice', label: 'Twice' }
          ],
          is_search: false
        },
        {
          label: 'Cost On',
          key: 'cost_on',
          type: 'select',
          options: [
            { value: 'Actual Day', label: 'Actual Day' },
            { value: 'Next Day', label: 'Next Day' }
          ],
          is_search: false
        },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      const permFlags = getPermissionFlags(req.user, 86);
      const permission = {
        view: 1,
        add: req.user?.superUser || permFlags.add ? 1 : 0,
        edit: req.user?.superUser || permFlags.edit ? 1 : 0,
        delete: req.user?.superUser || permFlags.delete ? 1 : 0
      };

      const master = {
        code_posts: codePosts.map((c: any) => ({ value: Number(c.id), label: c.name })),
        room_types: roomTypes.map((r: any) => ({ value: Number(r.id), label: r.name }))
      };

      success(res, bigintToNumber(data), 'Success', 200, { table, permission, master });
    } catch (err: any) {
      console.error('Rate inclusive list error:', err);
      error(res, 'Failed to fetch rate inclusives', 500);
    }
  }

  /**
   * POST /api/rates/:rateId/inclusives
   * Store rate inclusive
   */
  static async inclusiveStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const { description, stock, frequency, cost, cost_on } = req.body;

      const errors: Record<string, string[]> = {};
      if (!description) errors.description = ['The description field is required.'];
      if (!stock) errors.stock = ['The stock field is required.'];
      if (!frequency) errors.frequency = ['The frequency field is required.'];
      if (cost === undefined || cost === null) errors.cost = ['The cost field is required.'];
      if (!cost_on) errors.cost_on = ['The cost on field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const inclusive = await prisma.rate_inclusives.create({
        data: {
          property_id: BigInt(propertyId!),
          rate_id: rateId,
          description,
          // rate_inclusives.stock is a text column holding a code_items.id. The
          // Stock column arrives as a number, and Prisma refuses an Int for a
          // String field ("Expected String or Null, provided Int"), so it has to
          // be stringified before it reaches the query.
          stock: String(stock),
          frequency,
          cost,
          cost_on,
          created_by: req.user?.id ? BigInt(req.user.id) : undefined,
          status: STATUS.active
        }
      });

      success(res, bigintToNumber({ ...inclusive, id: Number(inclusive.id) }), 'Success', 200);
    } catch (err: any) {
      console.error('Rate inclusive store error:', err);
      error(res, 'Failed to create rate inclusive', 500);
    }
  }

  /**
   * PUT /api/rate-inclusives/:id
   * Update rate inclusive
   */
  static async inclusiveUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const { description, stock, frequency, cost, cost_on, sort, status } = req.body;

      const existing = await prisma.rate_inclusives.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Rate inclusive not found');
        return;
      }

      const data: any = {};
      if (description !== undefined) data.description = description;
      if (stock !== undefined) data.stock = stock === null ? null : String(stock);
      if (frequency !== undefined) data.frequency = frequency;
      if (cost !== undefined) data.cost = cost;
      if (cost_on !== undefined) data.cost_on = cost_on;
      if (sort !== undefined) data.sort = sort;
      if (status !== undefined) data.status = Array.isArray(status) ? (status[0]?.value || STATUS.active) : status;
      data.updated_by = req.user?.id ? BigInt(req.user.id) : undefined;

      const updated = await prisma.rate_inclusives.update({
        where: { id },
        data
      });

      success(res, bigintToNumber({ ...updated, id: Number(updated.id) }), 'Success');
    } catch (err: any) {
      console.error('Rate inclusive update error:', err);
      error(res, 'Failed to update rate inclusive', 500);
    }
  }

  /**
   * DELETE /api/rate-inclusives/:id
   * Soft delete rate inclusive
   */
  static async inclusiveDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.rate_inclusives.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Rate inclusive not found');
        return;
      }

      await prisma.rate_inclusives.update({
        where: { id },
        data: {
          deleted_at: new Date(),
          status: STATUS.inactive,
          deleted_by: req.user?.id ? BigInt(req.user.id) : undefined
        }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate inclusive destroy error:', err);
      error(res, 'Failed to delete rate inclusive', 500);
    }
  }

  /**
   * GET /api/bar/inclusives?bar_id=N
   * List BAR inclusives (BarRelationController@index parity).
   *
   * Bar inclusives are `rate_inclusives` rows keyed by `rate_id` = the bar's id.
   * BarInclusiveController@store writes `RateInclusive::forceCreate([... 'rate_id'
   * => $bar->id])` and BarRelationController@index reads `RateInclusive::where('rate_id',
   * $bar->id)`. The `bar_inclusives` table is a leftover of the create_bar_table
   * migration that nothing writes to.
   *
   * Table shape follows Laravel App\Models\BarInclusive::formatTable().
   */
  static async barInclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const barIdRaw = String(req.query.bar_id ?? req.query.data ?? '');
      if (!/^\d+$/.test(barIdRaw)) {
        success(res, [], 'Success', 200, {
          table: barInclusiveTable(),
          permission: { view: true, add: true, edit: true, delete: true },
          master: { code_items: [] },
        });
        return;
      }
      const barId = BigInt(barIdRaw);
      const propertyId = req.user?.lastProperty;

      const where: any = { rate_id: barId, deleted_at: null };
      if (propertyId) where.property_id = propertyId;

      const [inclusives, codeItems] = await Promise.all([
        prisma.rate_inclusives.findMany({
          where,
          orderBy: [{ sort: 'asc' }, { id: 'desc' }],
        }),
        prisma.code_items.findMany({
          where: activeWhere('code_items', { property_id: propertyId ?? 0n }, propertyId ?? null),
          select: { id: true, name: true, description: true, cost: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const stockNameById = new Map(codeItems.map((c: any) => [String(c.id), c.name]));

      // Laravel BarInclusive::formatData() returns stock/cost_on/frequency as
      // {value, label} objects; TableView renders the label for those columns.
      const data = inclusives.map((i: any) => ({
        ...i,
        id: Number(i.id),
        property_id: Number(i.property_id),
        rate_id: Number(i.rate_id),
        stock: i.stock != null ? { value: i.stock, label: stockNameById.get(String(i.stock)) ?? null } : null,
        frequency: i.frequency ? { value: i.frequency, label: i.frequency } : null,
        cost_on: i.cost_on ? { value: i.cost_on, label: i.cost_on } : null,
      }));

      const permFlags = getPermissionFlags(req.user, 87);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: barInclusiveTable(codeItems),
        permission: {
          view: 1,
          add: req.user?.superUser || permFlags.add ? 1 : 0,
          edit: req.user?.superUser || permFlags.edit ? 1 : 0,
          delete: req.user?.superUser || permFlags.delete ? 1 : 0
        },
        master: { code_items: codeItems.map((c: any) => ({ value: Number(c.id), label: c.name })) },
      });
    } catch (err: any) {
      console.error('Bar inclusive list error:', err);
      error(res, 'Failed to fetch bar inclusives', 500);
    }
  }

  /**
   * POST /api/bar/inclusives?bar_id=N
   * Store a BAR inclusive row (BarInclusiveController@store parity).
   */
  static async barInclusiveStore(req: Request, res: Response): Promise<void> {
    try {
      const barIdRaw = String(req.query.bar_id ?? req.query.data ?? req.params.barId ?? '');
      if (!/^\d+$/.test(barIdRaw)) { notFound(res, 'Bar not found'); return; }
      const barId = BigInt(barIdRaw);
      const propertyId = req.user?.lastProperty;

      const bar = await findBar(barId, propertyId);
      if (!bar) { notFound(res, 'Bar not found'); return; }

      const body = (req.body ?? {}) as any;
      const description = typeof body.description === 'object' && body.description !== null ? body.description.value : body.description;
      const stockRaw = typeof body.stock === 'object' && body.stock !== null ? body.stock.value : body.stock;
      const frequency = typeof body.frequency === 'object' && body.frequency !== null ? body.frequency.value : body.frequency;
      const costOn = typeof body.cost_on === 'object' && body.cost_on !== null ? body.cost_on.value : body.cost_on;
      const cost = typeof body.cost === 'object' && body.cost !== null ? body.cost.value : body.cost;

      const errors: Record<string, string[]> = {};
      if (!description) errors.description = ['The description field is required.'];
      if (stockRaw === undefined || stockRaw === null || stockRaw === '') errors.stock = ['The stock field is required.'];
      if (frequency === undefined || frequency === null || frequency === '') errors.frequency = ['The frequency field is required.'];
      if (cost === undefined || cost === null || cost === '') errors.cost = ['The cost field is required.'];
      if (costOn === undefined || costOn === null || costOn === '') errors.cost_on = ['The cost on field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      // `stock` is a code_items.id. rate_inclusives.stock is a text column, so it
      // has to be stored as a string; Prisma rejects an Int for it outright
      // ("Expected String or Null, provided Int" -> 500).
      const created = await prisma.rate_inclusives.create({
        data: {
          property_id: BigInt(propertyId!),
          rate_id: barId,
          description,
          frequency,
          cost: cost === undefined || cost === null ? 0 : cost,
          cost_on: costOn,
          stock: String(stockRaw),
          status: STATUS.active,
          created_at: new Date(),
          created_by: req.user?.id ? BigInt(req.user.id) : undefined,
        },
      });

      success(res, bigintToNumber({ ...created, id: Number(created.id) }), 'Success', 200);
    } catch (err: any) {
      console.error('Bar inclusive store error:', err);
      error(res, 'Failed to create bar inclusive', 500);
    }
  }

  /**
   * PUT /api/bar/inclusives/:id  (BarInclusiveController@update parity)
   */
  static async barInclusiveUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const propertyId = req.user?.lastProperty;

      const existing = await prisma.rate_inclusives.findFirst({
        where: { id, deleted_at: null, ...(propertyId ? { property_id: propertyId } : {}) },
      });
      if (!existing) { notFound(res, 'Bar inclusive not found'); return; }

      const body = (req.body ?? {}) as any;
      const unwrap = (v: any) => (typeof v === 'object' && v !== null ? v.value : v);
      const data: any = {};
      const description = unwrap(body.description);
      const frequency = unwrap(body.frequency);
      const costOn = unwrap(body.cost_on);
      const cost = unwrap(body.cost);
      const stock = unwrap(body.stock);

      if (description !== undefined) data.description = description;
      if (frequency !== undefined) data.frequency = frequency;
      if (costOn !== undefined) data.cost_on = costOn;
      if (cost !== undefined) data.cost = cost === null ? 0 : cost;
      if (stock !== undefined) data.stock = stock === null ? null : String(stock);
      if (body.sort !== undefined) data.sort = body.sort;
      if (body.status !== undefined) {
        const s = unwrap(body.status);
        data.status = Array.isArray(s) ? (s[0]?.value ?? STATUS.active) : (s ?? STATUS.active);
      }
      data.updated_at = new Date();
      data.updated_by = req.user?.id ? BigInt(req.user.id) : undefined;

      const updated = await prisma.rate_inclusives.update({ where: { id }, data });
      success(res, bigintToNumber({ ...updated, id: Number(updated.id) }), 'Success');
    } catch (err: any) {
      console.error('Bar inclusive update error:', err);
      error(res, 'Failed to update bar inclusive', 500);
    }
  }

  /**
   * DELETE /api/bar/inclusives/:id  (soft delete + setStatusAsInactive)
   */
  static async barInclusiveDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const propertyId = req.user?.lastProperty;

      const existing = await prisma.rate_inclusives.findFirst({
        where: { id, deleted_at: null, ...(propertyId ? { property_id: propertyId } : {}) },
      });
      if (!existing) { notFound(res, 'Bar inclusive not found'); return; }

      await prisma.rate_inclusives.update({
        where: { id },
        data: {
          deleted_at: new Date(),
          status: STATUS.inactive,
          deleted_by: req.user?.id ? BigInt(req.user.id) : undefined,
        },
      });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar inclusive destroy error:', err);
      error(res, 'Failed to delete bar inclusive', 500);
    }
  }

  /**
   * DELETE /api/bar/inclusives/:id/delete  (force delete)
   */
  static async barInclusiveDelete(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const propertyId = req.user?.lastProperty;

      const existing = await prisma.rate_inclusives.findFirst({
        where: { id, ...(propertyId ? { property_id: propertyId } : {}) },
      });
      if (!existing) { notFound(res, 'Bar inclusive not found'); return; }

      await prisma.rate_inclusives.delete({ where: { id } });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar inclusive delete error:', err);
      error(res, 'Failed to delete bar inclusive', 500);
    }
  }

  /**
   * DELETE /api/rate-inclusives/:id/force
   * Force delete rate inclusive
   */
  static async inclusiveDelete(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.rate_inclusives.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Rate inclusive not found');
        return;
      }

      await prisma.rate_inclusives.delete({ where: { id } });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate inclusive force delete error:', err);
      error(res, 'Failed to force delete rate inclusive', 500);
    }
  }

  /**
   * GET /api/rates/:rateId/extra-beds
   * List extra bed inclusives for a rate
   */
  static async extraBedList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = String(req.query.rate_id ?? req.query.id ?? req.query.data ?? req.params.rateId ?? '');
      if (!/^\d+$/.test(rateIdParam)) {
        success(res, [], 'Success', 200, {
          table: [],
          permission: { view: true, add: true, edit: true, delete: true },
          master: { code_posts: [], room_types: [] },
        });
        return;
      }
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;

      const where: any = { rate_id: rateId, deleted_at: null };
      if (propertyId) where.property_id = propertyId;

      const extraBeds = await prisma.rate_extra_bed_inclusives.findMany({
        where,
        orderBy: { sort: 'asc' }
      });

      const [codePosts, roomTypes, codeItems] = await Promise.all([
        prisma.code_posts.findMany({ where: activeWhere('code_posts', {}, propertyId ?? null), select: { id: true, name: true } }),
        prisma.room_types.findMany({ where: activeWhere('room_types', {}, propertyId ?? null), select: { id: true, name: true } }),
        prisma.code_items.findMany({ where: activeWhere('code_items', { property_id: propertyId ?? 0n }, propertyId ?? null), select: { id: true, name: true, description: true, cost: true } })
      ]);

      const stockNameById = new Map(codeItems.map((c: any) => [String(c.id), c.name]));

      // Laravel RateExtraBedInclusive::formatData() wraps stock / frequency / cost_on
      // as {value,label}. Spreading the raw row left `stock` as a bare id, so the grid
      // rendered the id instead of the Code Item name.
      const data = extraBeds.map(e => ({
        id: Number(e.id),
        property_id: Number(e.property_id),
        rate_id: Number(e.rate_id),
        stock: { value: e.stock, label: stockNameById.get(String(e.stock)) ?? null },
        frequency: { value: e.frequency, label: e.frequency },
        description: e.description,
        cost_on: { value: e.cost_on, label: e.cost_on },
        cost: Number(e.cost),
        created_at: e.created_at,
        status: Number(e.status ?? 0),
        sort: e.sort
      }));

      // Laravel RateExtraBedInclusive::formatTable() is the same shape as
      // RateInclusive::formatTable(): a `select` stock column backed by CodeItem with
      // is_related filling description/cost/frequency/cost_on. Every column here used to
      // be type 'none', which made the whole grid read-only - nothing could be picked
      // or added, which is why "Inclusive Extra Bed" never appeared.
      const table = [
        {
          label: 'Stock',
          key: 'stock',
          type: 'select',
          options: codeItems.map((c: any) => ({
            value: Number(c.id),
            label: c.name,
            description: c.description ?? '',
            cost: moneyFormat(Number(c.cost)),
            frequency: { value: 'Daily', label: 'Daily' },
            cost_on: { value: 'Actual Day', label: 'Actual Day' }
          })),
          is_search: false,
          is_related: true,
          related: ['description', 'cost', 'frequency', 'cost_on']
        },
        { label: 'Description', key: 'description', type: 'text', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
        {
          label: 'Frequency',
          key: 'frequency',
          type: 'select',
          options: [
            { value: 'Daily', label: 'Daily' },
            { value: 'Once', label: 'Once' },
            { value: 'Twice', label: 'Twice' }
          ],
          is_search: false
        },
        {
          label: 'Cost On',
          key: 'cost_on',
          type: 'select',
          options: [
            { value: 'Actual Day', label: 'Actual Day' },
            { value: 'Next Day', label: 'Next Day' }
          ],
          is_search: false
        },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      const permFlags = getPermissionFlags(req.user, 86);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete
      };

      const master = {
        code_posts: codePosts.map((c: any) => ({ value: Number(c.id), label: c.name })),
        room_types: roomTypes.map((r: any) => ({ value: Number(r.id), label: r.name }))
      };

      success(res, bigintToNumber(data), 'Success', 200, { table, permission, master });
    } catch (err: any) {
      console.error('Extra bed list error:', err);
      error(res, 'Failed to fetch extra bed inclusives', 500);
    }
  }

  /**
   * POST /api/rates/:rateId/extra-beds
   * Store extra bed inclusive
   */
  static async extraBedStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const { description, stock, frequency, cost, cost_on } = req.body;

      const errors: Record<string, string[]> = {};
      if (!description) errors.description = ['The description field is required.'];
      if (!stock) errors.stock = ['The stock field is required.'];
      if (!frequency) errors.frequency = ['The frequency field is required.'];
      if (cost === undefined || cost === null) errors.cost = ['The cost field is required.'];
      if (!cost_on) errors.cost_on = ['The cost on field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const extraBed = await prisma.rate_extra_bed_inclusives.create({
        data: {
          property_id: BigInt(propertyId!),
          rate_id: rateId,
          description,
          stock: String(stock),
          frequency,
          cost,
          cost_on,
          created_by: req.user?.id ? BigInt(req.user.id) : undefined,
          status: STATUS.active
        }
      });

      success(res, bigintToNumber({ ...extraBed, id: Number(extraBed.id) }), 'Success', 200);
    } catch (err: any) {
      console.error('Extra bed store error:', err);
      error(res, 'Failed to create extra bed inclusive', 500);
    }
  }

  /**
   * PUT /api/rate-extra-beds/:id
   * Update extra bed inclusive
   */
  static async extraBedUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const { description, stock, frequency, cost, cost_on, sort, status } = req.body;

      const existing = await prisma.rate_extra_bed_inclusives.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Extra bed inclusive not found');
        return;
      }

      const data: any = {};
      if (description !== undefined) data.description = description;
      if (stock !== undefined) data.stock = stock === null ? null : String(stock);
      if (frequency !== undefined) data.frequency = frequency;
      if (cost !== undefined) data.cost = cost;
      if (cost_on !== undefined) data.cost_on = cost_on;
      if (sort !== undefined) data.sort = sort;
      if (status !== undefined) data.status = Array.isArray(status) ? (status[0]?.value || STATUS.active) : status;
      data.updated_by = req.user?.id ? BigInt(req.user.id) : undefined;

      const updated = await prisma.rate_extra_bed_inclusives.update({
        where: { id },
        data
      });

      success(res, bigintToNumber({ ...updated, id: Number(updated.id) }), 'Success');
    } catch (err: any) {
      console.error('Extra bed update error:', err);
      error(res, 'Failed to update extra bed inclusive', 500);
    }
  }

  /**
   * DELETE /api/rate-extra-beds/:id
   * Soft delete extra bed inclusive
   */
  static async extraBedDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.rate_extra_bed_inclusives.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Extra bed inclusive not found');
        return;
      }

      await prisma.rate_extra_bed_inclusives.update({
        where: { id },
        data: {
          deleted_at: new Date(),
          status: STATUS.inactive,
          deleted_by: req.user?.id ? BigInt(req.user.id) : undefined
        }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Extra bed destroy error:', err);
      error(res, 'Failed to delete extra bed inclusive', 500);
    }
  }

  /**
   * DELETE /api/rate-extra-beds/:id/force
   * Force delete extra bed inclusive
   */
  static async extraBedDelete(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const existing = await prisma.rate_extra_bed_inclusives.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Extra bed inclusive not found');
        return;
      }

      await prisma.rate_extra_bed_inclusives.delete({ where: { id } });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Extra bed force delete error:', err);
      error(res, 'Failed to force delete extra bed inclusive', 500);
    }
  }

  /**
   * GET /api/bar-rates/:barId/relations
   * List rate inclusives linked to a bar rate via model_has_rate_inclusives
   */
  static async barRelationIndex(req: Request, res: Response): Promise<void> {
    try {
      const barIdParam = Array.isArray(req.params.barId) ? req.params.barId[0] : req.params.barId;
      const barId = BigInt(barIdParam);
      const propertyId = req.user?.lastProperty;

      const barRate = await prisma.rates.findUnique({ where: { id: barId } });
      if (!barRate || barRate.deleted_at) {
        notFound(res, 'Bar rate not found');
        return;
      }

      const relations = await prisma.model_has_rate_inclusives.findMany({
        where: {
          model_type: 'App\\Models\\Rate',
          model_id: barId
        },
        include: {
          rate_inclusives: true
        }
      });

      const [codePosts, roomTypes] = await Promise.all([
        prisma.code_posts.findMany({ where: activeWhere('code_posts', {}, propertyId ?? null), select: { id: true, name: true } }),
        prisma.room_types.findMany({ where: activeWhere('room_types', {}, propertyId ?? null), select: { id: true, name: true } })
      ]);

      const data = relations.map(r => ({
        ...r.rate_inclusives,
        id: Number(r.rate_inclusives.id),
        property_id: Number(r.rate_inclusives.property_id),
        rate_id: Number(r.rate_inclusives.rate_id),
        cost: Number(r.rate_inclusives.cost)
      }));

      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Frequency', key: 'frequency', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'none', is_search: false },
        { label: 'Cost On', key: 'cost_on', type: 'none', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      const barInfo = {
        id: Number(barRate.id),
        name: barRate.name,
        code: barRate.code
      };

      const permFlags = getPermissionFlags(req.user, 87);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete
      };

      const master = {
        bar_rate: barInfo,
        code_posts: codePosts.map((c: any) => ({ value: Number(c.id), label: c.name })),
        room_types: roomTypes.map((r: any) => ({ value: Number(r.id), label: r.name }))
      };

      success(res, bigintToNumber(data), 'Success', 200, { table, permission, master });
    } catch (err: any) {
      console.error('Bar relation index error:', err);
      error(res, 'Failed to fetch bar relations', 500);
    }
  }

  /**
   * GET /api/bar-rates/:barId/links
   * List linked rates for a bar rate â€” parity with Laravel BarRelationController::link
   * (bar is model_has_rates.rate_id, linked rates are model_id)
   */
  static async barRelationLink(req: Request, res: Response): Promise<void> {
    try {
      const barIdParam = Array.isArray(req.params.barId) ? req.params.barId[0] : req.params.barId;
      const barId = BigInt(barIdParam);
      const propertyId = req.user?.lastProperty;

      const barRate = await prisma.rates.findUnique({ where: { id: barId } });
      if (!barRate || barRate.deleted_at) {
        notFound(res, 'Bar rate not found');
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const links = await prisma.model_has_rates.findMany({
        where: {
          model_type: 'App\\Models\\Rate',
          rate_id: barId,
          status: 1,
        },
      });
      const linkedIds = links.map(l => l.model_id);

      const where: any = { id: { in: linkedIds }, deleted_at: null };
      if (propertyId) where.property_id = propertyId;
      const [rates, total] = await Promise.all([
        prisma.rates.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { name: 'asc' },
          include: { code_posts: { select: { id: true, name: true } } },
        }),
        prisma.rates.count({ where }),
      ]);

      const formatted = rates.map((r: any) => {
        const safe = bigintToNumber(r);
        return {
          ...safe,
          code_post: r.code_posts ? { id: Number(r.code_posts.id), name: r.code_posts.name } : null,
          code_posts: undefined,
        };
      });

      const codePosts = await prisma.code_posts.findMany({
        where: { type: 'DEFAULT', deleted_at: null },
        select: { id: true, name: true },
      });
      const codePostOptions = codePosts.map((c: any) => ({ value: Number(c.id), label: c.name }));

      const table = [
        { label: 'Code', key: 'code', type: 'none', is_search: true },
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Start Date', key: 'start_date', type: 'none', is_search: false },
        { label: 'End Date', key: 'end_date', type: 'none', is_search: false },
        { label: 'Code Post', key: 'code_post_id', type: 'select', is_search: false, options: codePostOptions },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      const permFlags = getPermissionFlags(req.user, 87);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      const master = {
        bar_rate: { id: Number(barRate.id), name: barRate.name, code: barRate.code },
        code_posts: codePostOptions,
      };

      success(res, formatted, 'Success', 200, {
        table,
        permission,
        master,
        search_data: [],
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Bar relation link error:', err);
      error(res, 'Failed to fetch bar links', 500);
    }
  }
}

