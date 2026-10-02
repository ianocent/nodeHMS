import { prisma } from '../config/prisma';
﻿import { Request, Response } from 'express';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { getStatusLabel } from '../utils/cmsConfig';
import { badRequest, error, notFound, success, validationError } from '../utils/response';
import { applySearchField, dataSearch } from '../utils/search';
import { activeWhere, applyStatusScope, safeOrderBy } from '../utils/querySafety';


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

// Laravel defines CurrentgeneratePromotionCode() INSIDE create(): it loops until it
// draws a code that no promotion is already using. Without the retry the Add form can
// hand out a code that store() then rejects as "already taken".
async function currentGeneratePromotionCode(attempt = 0): Promise<string> {
  const code = generatePromotionCode();
  if (attempt > 20) return code;
  const existing = await prisma.promotions.findFirst({
    where: { promotion_code: code },
    select: { id: true },
  });
  return existing ? currentGeneratePromotionCode(attempt + 1) : code;
}

function bigintToNumber(val: any): any {
    if (val instanceof Date) {
      const u = val.getUTCFullYear();
      const iso = val.toISOString();
      if (u === 1970 && val.getUTCMonth() === 0 && val.getUTCDate() === 1) return iso.slice(11, 19);
      const s = iso.slice(0, 19).replace('T', ' ');
      return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
    }
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

function toInt(v: any, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : Math.trunc(n);
}

function toBool(v: any, fallback = false): boolean {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === 0 || v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return fallback;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
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
      applyStatusScope(where, req, 'promotions');

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

      // Laravel Promotion::formatTable() parity (10 kolom)
      const table = [
        { label: 'No', key: 'no', type: 'none', is_search: false },
        { label: 'Status', key: 'status_table', type: 'checkbox', is_search: true },
        { label: 'Promotion Type', key: 'promotion_type', type: 'text', is_search: true },
        { label: 'Promotion Code', key: 'promotion_code', type: 'text', is_search: true },
        { label: 'Start Date', key: 'from_stay_date', type: 'date', is_search: true },
        { label: 'End Date', key: 'to_stay_date', type: 'date', is_search: true },
        { label: 'Discount Percentage', key: 'discount_percentage', type: 'text', is_search: true },
        { label: 'Discount Flat', key: 'discount_flat', type: 'text', is_search: true },
        { label: 'Minimum Night', key: 'min_night', type: 'text', is_search: true },
        { label: 'Description', key: 'description', type: 'text', is_search: true },
      ];

      applySearchField(where, req, table, 'promotions');

      const [promotions, total] = await Promise.all([
        prisma.promotions.findMany({
          where,
          orderBy: safeOrderBy('promotions', sort, { id: order }),
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.promotions.count({ where })
      ]);

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete
      };

      // Laravel Promotion::formatData() parity rows
      const rows = promotions.map((p: any, idx: number) => ({
        id: Number(p.id),
        promotion_type: p.promotion_type,
        promotion_code: p.promotion_code,
        description: p.description,
        from_stay_date: p.from_stay_date ? new Date(p.from_stay_date).toISOString().slice(0, 10) : null,
        to_stay_date: p.to_stay_date ? new Date(p.to_stay_date).toISOString().slice(0, 10) : null,
        from_validity_date: p.from_validity_date ? new Date(p.from_validity_date).toISOString().slice(0, 10) : null,
        to_validity_date: p.to_validity_date ? new Date(p.to_validity_date).toISOString().slice(0, 10) : null,
        discount_percentage: Number(p.discount_percentage) || 0,
        discount_flat: Number(p.discount_flat) || 0,
        no_of_night_discount: Number(p.no_of_night_discount) || 0,
        min_night: Number(p.min_night) || 0,
        rules: p.rules,
        apply_to_every_min_night: { value: !!p.apply_to_every_min_night, label: p.apply_to_every_min_night ? 'Yes' : 'No' },
        created_at: p.created_at,
        created_by: p.created_by ? Number(p.created_by) : null,
        status: { value: p.status, label: getStatusLabel(p.status).label },
        status_table: !!p.status,
        sort: p.sort,
        is_view: permFlags.view,
        is_edit: permFlags.edit,
        is_need_approval: false,
        relation: {},
        no: (page - 1) * limit + idx + 1,
      }));

      success(res, bigintToNumber(rows), 'Success', 200, {
        table,
        permission,
        search_data: dataSearch(req, table) as any,
        pagination: {
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

  //  RateRelationController::promotion parity (/rate/promotion) 
  static async ratePromotionList(req: Request, res: Response): Promise<void> {
    try {
      const rateId = String(req.query.rate_id ?? '');
      if (!/^\d+$/.test(rateId)) { notFound(res, 'Rate is not found'); return; }
      const rate = await prisma.rates.findUnique({ where: { id: BigInt(rateId) } });
      if (!rate) { notFound(res, 'Rate is not found'); return; }
      return PromotionController.list(req, res);
    } catch (err: any) {
      console.error('Rate promotion list error:', err);
      error(res, 'Failed to fetch rate promotions', 500);
    }
  }

  static async ratePromotionStore(req: Request, res: Response): Promise<void> {
    try {
      const rateId = req.body.rate_id;
      if (!/^\d+$/.test(String(rateId ?? ''))) { notFound(res, 'Rate is not found'); return; }
      const rate = await prisma.rates.findUnique({ where: { id: BigInt(rateId) } });
      if (!rate) { notFound(res, 'Rate is not found'); return; }

      const idx = req.body.idx;
      if (idx !== undefined && idx !== null && !(Array.isArray(idx) && idx.length === 0)) {
        const ids = (Array.isArray(idx) ? idx : [idx]).map((i: any) => BigInt(String(i)));
        const modelType = 'App\\Models\\Rate';
        await prisma.$transaction([
          prisma.model_has_promotions.deleteMany({ where: { model_id: BigInt(rateId), model_type: modelType } }),
          ...ids.map((promotionId: bigint) =>
            prisma.model_has_promotions.create({ data: { promotion_id: promotionId, model_id: BigInt(rateId), model_type: modelType } })
          ),
        ]);
      }

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate promotion store error:', err);
      error(res, 'Failed to store rate promotions', 500);
    }
  }

  static async ratePromotionDelete(req: Request, res: Response): Promise<void> {
    try {
      const rateId = String(req.query.rate_id ?? '');
      if (!/^\d+$/.test(rateId)) { notFound(res, 'Rate is not found'); return; }
      const rate = await prisma.rates.findUnique({ where: { id: BigInt(rateId) } });
      if (!rate) { notFound(res, 'Rate is not found'); return; }

      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (/^\d+$/.test(String(raw))) {
        await prisma.model_has_promotions.deleteMany({
          where: { promotion_id: BigInt(raw), model_id: BigInt(rateId), model_type: 'App\\Models\\Rate' },
        });
      }

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate promotion delete error:', err);
      error(res, 'Failed to delete rate promotion', 500);
    }
  }

  /**
   * GET /api/promotions/create
   * Get master data for promotion creation form
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      // Laravel PromotionController::create returns `master` as a SIBLING of data:
      //   additional(['master' => ['statuses' => $status, 'code' => CurrentgeneratePromotionCode()]])
      // The port returned that object as `data` and called the key `promotion_code`, so the
      // Promotion Code input stayed empty on the Add form (it reads `master.code`).
      const code = await currentGeneratePromotionCode();
      const master = { statuses: STATUSES, code };

      success(res, [], 'Success', 200, { master });
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
          from_stay_date: toDate(from_stay_date),
          to_stay_date: toDate(to_stay_date),
          from_validity_date: toDate(from_validity_date),
          to_validity_date: toDate(to_validity_date),
          no_of_night_discount: toInt(no_of_night_discount),
          discount_percentage: toInt(discount_percentage),
          discount_flat: toInt(discount_flat),
          min_night: toInt(min_night),
          apply_to_every_min_night: toBool(apply_to_every_min_night),
          rules,
          sort: toInt(sort),
          status: toInt(status, 1),
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

      // Laravel passes master through `additional()`, i.e. a sibling of `data`. The port
      // spread it INTO data, so the form's `datauser.master.*` option reads came back
      // undefined on every edit.
      success(res, bigintToNumber(promotion), 'Success', 200, { master });
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
          from_stay_date: toDate(from_stay_date),
          to_stay_date: toDate(to_stay_date),
          from_validity_date: toDate(from_validity_date),
          to_validity_date: toDate(to_validity_date),
          no_of_night_discount: toInt(no_of_night_discount),
          discount_percentage: toInt(discount_percentage),
          discount_flat: toInt(discount_flat),
          min_night: toInt(min_night),
          apply_to_every_min_night: toBool(apply_to_every_min_night),
          rules,
          sort: toInt(sort),
          status: toInt(status, promotion.status ?? 1),
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

