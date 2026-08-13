import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import crypto from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MENU_ID = 88;
const STATUSES = [
  { value: 1, label: 'Active' },
  { value: 0, label: 'Inactive' }
];

function generatePromotionCode(): string {
  return Array.from({ length: 8 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]
  ).join('');
}

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

export class PromotionController {
  /**
   * GET /api/promotions
   * List promotions with pagination, search, sort
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string || 'id';
      const order = req.query.order === 'desc' ? 'desc' : 'asc';
      const rateId = req.query.rate_id as string;
      const propertyId = req.user?.lastProperty;

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null };

      if (search) {
        where.OR = [
          { promotion_type: { contains: search, mode: 'insensitive' } },
          { promotion_code: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ];
      }

      if (propertyId) {
        where.property_id = propertyId;
      }

      // If rate_id provided, filter onlyActive promotions linked to that rate
      if (rateId) {
        const linkedPromotionIds = await prisma.model_has_promotions.findMany({
          where: {
            model_id: BigInt(rateId),
            model_type: 'App\\Models\\Rate'
          },
          select: { promotion_id: true }
        });
        const ids = linkedPromotionIds.map(lp => lp.promotion_id);
        where.id = { in: ids };
        where.status = 1; // onlyActive
      }

      const [promotions, total] = await Promise.all([
        prisma.promotions.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.promotions.count({ where })
      ]);

      const table = [
        { label: 'Code', key: 'promotion_code', type: 'none', is_search: true },
        { label: 'Type', key: 'promotion_type', type: 'none', is_search: true },
        { label: 'Description', key: 'description', type: 'none', is_search: true },
        { label: 'Discount', key: 'discount_percentage', type: 'none', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false }
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete
      };

      const searchData = [
        { field: 'promotion_code', label: 'Code' },
        { field: 'promotion_type', label: 'Type' },
        { field: 'description', label: 'Description' }
      ];

      success(res, promotions.map(p => bigintToNumber(p)), 'Success', 200, {
        table,
        permission,
        search_data: searchData,
        pagging: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total)
        }
      });
    } catch (err: any) {
      console.error('Promotion list error:', err);
      error(res, 'Failed to fetch promotions', 500);
    }
  }

  /**
   * GET /api/promotions/create
   * Get master data for promotion creation form
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const master = {
        statuses: STATUSES,
        promotion_code: generatePromotionCode()
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('Promotion create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /api/promotions
   * Create new promotion
   */
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;
      const promotion_type = body.promotion_type || body.promotionType;
      const promotion_code = body.promotion_code || body.promotionCode;
      const description = body.description;
      const from_stay_date = body.from_stay_date || body.fromStayDate;
      const to_stay_date = body.to_stay_date || body.toStayDate;
      const from_validity_date = body.from_validity_date || body.fromValidityDate;
      const to_validity_date = body.to_validity_date || body.toValidityDate;
      const no_of_night_discount = body.no_of_night_discount ?? body.noOfNightDiscount;
      const discount_percentage = body.discount_percentage ?? body.discountPercentage;
      const discount_flat = body.discount_flat ?? body.discountFlat;
      const min_night = body.min_night ?? body.minNight;
      const apply_to_every_min_night = body.apply_to_every_min_night ?? body.applyToEveryMinNight;
      const sort = body.sort;
      const status = body.status;
      const rules = body.rules ? (typeof body.rules === 'object' ? JSON.stringify(body.rules) : body.rules) : '0';

      const errors: Record<string, string[]> = {};
      if (!promotion_type) errors.promotion_type = ['The promotion type field is required.'];
      if (!promotion_code) errors.promotion_code = ['The promotion code field is required.'];
      if (!description) errors.description = ['The description field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      // Check unique promotion_code
      const existing = await prisma.promotions.findFirst({
        where: { promotion_code, deleted_at: null }
      });
      if (existing) {
        validationError(res, { promotion_code: ['The promotion code has already been taken.'] });
        return;
      }

      const promotion = await prisma.promotions.create({
        data: {
          property_id: req.user?.lastProperty ? BigInt(req.user.lastProperty) : null,
          promotion_type,
          promotion_code,
          description,
          from_stay_date: from_stay_date ? new Date(from_stay_date) : null,
          to_stay_date: to_stay_date ? new Date(to_stay_date) : null,
          from_validity_date: from_validity_date ? new Date(from_validity_date) : null,
          to_validity_date: to_validity_date ? new Date(to_validity_date) : null,
          no_of_night_discount: no_of_night_discount || 0,
          discount_percentage: discount_percentage || 0,
          discount_flat: discount_flat || 0,
          min_night: min_night || 0,
          apply_to_every_min_night: apply_to_every_min_night || false,
          rules,
          sort: sort || 0,
          status: status ?? 1,
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      const created = await prisma.promotions.findUnique({ where: { id: promotion.id } });
      success(res, bigintToNumber(created), 'Success', 200);
    } catch (err: any) {
      console.error('Promotion store error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Promotion code already exists');
      } else {
        error(res, 'Failed to create promotion', 500);
      }
    }
  }

  /**
   * GET /api/promotions/:id
   * Show single promotion
   */
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const promotion = await prisma.promotions.findUnique({ where: { id } });

      if (!promotion || promotion.deleted_at) {
        notFound(res, 'Promotion not found');
        return;
      }

      success(res, bigintToNumber(promotion), 'Success');
    } catch (err: any) {
      console.error('Promotion show error:', err);
      error(res, 'Failed to fetch promotion', 500);
    }
  }

  /**
   * GET /api/promotions/:id/edit
   * Get promotion with master data for edit form
   */
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const promotion = await prisma.promotions.findUnique({ where: { id } });

      if (!promotion || promotion.deleted_at) {
        notFound(res, 'Promotion not found');
        return;
      }

      const master = {
        statuses: STATUSES
      };

      success(res, { ...bigintToNumber(promotion), master }, 'Success');
    } catch (err: any) {
      console.error('Promotion edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /api/promotions/:id
   * Update promotion
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const body = req.body;
      const promotion_type = body.promotion_type || body.promotionType;
      const promotion_code = body.promotion_code || body.promotionCode;
      const description = body.description;
      const from_stay_date = body.from_stay_date || body.fromStayDate;
      const to_stay_date = body.to_stay_date || body.toStayDate;
      const from_validity_date = body.from_validity_date || body.fromValidityDate;
      const to_validity_date = body.to_validity_date || body.toValidityDate;
      const no_of_night_discount = body.no_of_night_discount ?? body.noOfNightDiscount;
      const discount_percentage = body.discount_percentage ?? body.discountPercentage;
      const discount_flat = body.discount_flat ?? body.discountFlat;
      const min_night = body.min_night ?? body.minNight;
      const apply_to_every_min_night = body.apply_to_every_min_night ?? body.applyToEveryMinNight;
      const rules = body.rules ? (typeof body.rules === 'object' ? JSON.stringify(body.rules) : body.rules) : '0';
      const sort = body.sort;
      const status = body.status;

      const promotion = await prisma.promotions.findUnique({ where: { id } });
      if (!promotion || promotion.deleted_at) {
        notFound(res, 'Promotion not found');
        return;
      }

      const errors: Record<string, string[]> = {};
      if (!promotion_type) errors.promotion_type = ['The promotion type field is required.'];
      if (!promotion_code) errors.promotion_code = ['The promotion code field is required.'];
      if (!description) errors.description = ['The description field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      // Check unique promotion_code excluding self
      const existing = await prisma.promotions.findFirst({
        where: { promotion_code, id: { not: id }, deleted_at: null }
      });
      if (existing) {
        validationError(res, { promotion_code: ['The promotion code has already been taken.'] });
        return;
      }

      await prisma.promotions.update({
        where: { id },
        data: {
          promotion_type,
          promotion_code,
          description,
          from_stay_date: from_stay_date ? new Date(from_stay_date) : null,
          to_stay_date: to_stay_date ? new Date(to_stay_date) : null,
          from_validity_date: from_validity_date ? new Date(from_validity_date) : null,
          to_validity_date: to_validity_date ? new Date(to_validity_date) : null,
          no_of_night_discount: no_of_night_discount || 0,
          discount_percentage: discount_percentage || 0,
          discount_flat: discount_flat || 0,
          min_night: min_night || 0,
          apply_to_every_min_night: apply_to_every_min_night || false,
          rules,
          sort: sort || 0,
          status: status ?? promotion.status,
          updated_at: new Date()
        }
      });

      const updated = await prisma.promotions.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Promotion update error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Promotion code already exists');
      } else {
        error(res, 'Failed to update promotion', 500);
      }
    }
  }

  /**
   * DELETE /api/promotions/:id
   * Soft delete promotion
   */
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const promotion = await prisma.promotions.findUnique({ where: { id } });

      if (!promotion) {
        notFound(res, 'Promotion not found');
        return;
      }

      await prisma.promotions.update({
        where: { id },
        data: { deleted_at: new Date(), status: 0 }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Promotion destroy error:', err);
      error(res, 'Failed to delete promotion', 500);
    }
  }

  /**
   * DELETE /api/promotions/:id/force
   * Force delete promotion
   */
  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const promotion = await prisma.promotions.findUnique({ where: { id } });

      if (!promotion) {
        notFound(res, 'Promotion not found');
        return;
      }

      // Delete related pivot records first
      await prisma.model_has_promotions.deleteMany({
        where: { promotion_id: id }
      });

      await prisma.promotions.delete({ where: { id } });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Promotion force delete error:', err);
      error(res, 'Failed to force delete promotion', 500);
    }
  }

  /**
   * POST /api/promotions/:id/restore
   * Restore soft-deleted promotion
   */
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const promotion = await prisma.promotions.findUnique({ where: { id } });

      if (!promotion) {
        notFound(res, 'Promotion not found');
        return;
      }

      await prisma.promotions.update({
        where: { id },
        data: { deleted_at: null, status: 0 }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Promotion restore error:', err);
      error(res, 'Failed to restore promotion', 500);
    }
  }
}
