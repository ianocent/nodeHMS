import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bigintToNumber(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

const STATUS = { active: 1, inactive: 0 };

export class RateAddonController {
  /**
   * GET /api/rates/:rateId/inclusives
   * List rate inclusives for a rate
   */
  static async inclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;

      const where: any = { rate_id: rateId, deleted_at: null };
      if (propertyId) where.property_id = propertyId;

      const inclusives = await prisma.rate_inclusives.findMany({
        where,
        orderBy: { sort: 'asc' }
      });

      const [codePosts, roomTypes] = await Promise.all([
        prisma.code_posts.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.room_types.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } })
      ]);

      const data = inclusives.map(i => ({
        ...i,
        id: Number(i.id),
        property_id: Number(i.property_id),
        rate_id: Number(i.rate_id),
        cost: Number(i.cost)
      }));

      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Frequency', key: 'frequency', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'none', is_search: false },
        { label: 'Cost On', key: 'cost_on', type: 'none', is_search: false },
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
          stock,
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
      if (stock !== undefined) data.stock = stock;
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
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;

      const where: any = { rate_id: rateId, deleted_at: null };
      if (propertyId) where.property_id = propertyId;

      const extraBeds = await prisma.rate_extra_bed_inclusives.findMany({
        where,
        orderBy: { sort: 'asc' }
      });

      const [codePosts, roomTypes] = await Promise.all([
        prisma.code_posts.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.room_types.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } })
      ]);

      const data = extraBeds.map(e => ({
        ...e,
        id: Number(e.id),
        property_id: Number(e.property_id),
        rate_id: Number(e.rate_id),
        cost: Number(e.cost)
      }));

      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Frequency', key: 'frequency', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'none', is_search: false },
        { label: 'Cost On', key: 'cost_on', type: 'none', is_search: false },
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
          stock,
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
      if (stock !== undefined) data.stock = stock;
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
        prisma.code_posts.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.room_types.findMany({ where: { status: 1, deleted_at: null }, select: { id: true, name: true } })
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
   * List linked rates for a bar rate — parity with Laravel BarRelationController::link
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

      const formatted = rates.map((r: any) => ({
        ...r,
        id: Number(r.id),
        property_id: Number(r.property_id),
        code_post_id: r.code_post_id !== null && r.code_post_id !== undefined ? Number(r.code_post_id) : null,
        minimum_rate: r.minimum_rate !== null && r.minimum_rate !== undefined ? Number(r.minimum_rate) : null,
        code_post: r.code_posts ? { id: Number(r.code_posts.id), name: r.code_posts.name } : null,
        code_posts: undefined,
      }));

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
      console.error('Bar relation link error:', err);
      error(res, 'Failed to fetch bar links', 500);
    }
  }
}
