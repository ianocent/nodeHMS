import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { TABLES, laravelPaging, listPermission } from '../utils/tableMeta';
import { moneyFormat, calculateCodePost } from '../utils/cmsConfig';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function num(v: any, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function bool(v: any, fallback = false): boolean {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function parsePagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 10;
  const search = query.search as string;
  const sort = query.sort as string || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  return { page, limit, search, sort, order };
}

export class MasterDataController {
  /**
   * GET /api/:model/create | /api/:model/:id/update (form alias)
   * req.params.model maps to a prisma model name; returns form shell or record
   */
  static async masterForm(req: Request, res: Response): Promise<void> {
    try {
      const modelName = String(req.params.model || '');
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const model: any = (prisma as any)[modelName];
      if (!model) { notFound(res, 'Model not found'); return; }

      const master: Record<string, any> = {};
      try {
        const [codePosts, codeBillings, codeGls] = await Promise.all([
          prisma.code_posts.findMany({ where: { deleted_at: null }, select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
          prisma.code_billings.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
          prisma.code_gls.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        ]);
        master.code_posts = codePosts.map(c => ({ value: Number(c.id), label: `${c.name}${c.type ? ` (${c.type})` : ''}` }));
        master.code_billings = codeBillings.map(c => ({ value: Number(c.id), label: c.name }));
        master.code_gls = codeGls.map(c => ({ value: Number(c.id), label: c.name }));
      } catch { /* master optional */ }

      if (idRaw && /^\d+$/.test(idRaw)) {
        const record = await model.findUnique({ where: { id: BigInt(idRaw) } });
        if (!record || record.deleted_at) { notFound(res, 'Not found'); return; }
        success(res, bigintToNumber(record), 'Success', 200, { master });
        return;
      }
      success(res, { status: 1 }, 'Success', 200, { master });
    } catch (err: any) {
      error(res, 'Failed to load form', 500);
    }
  }

  static async codePostList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.code_posts.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.code_posts.count({ where }),
      ]);

      const rows = bigintToNumber(data).map((r: any, i: number) => ({ ...r, no: (page - 1) * limit + i + 1 }));
      success(res, rows, 'Success', 200, {
        table: TABLES.codePost,
        pagging: laravelPaging(total, limit, page),
        permission: listPermission(req, { add: true, edit: true, delete: true }),
      } as any);
    } catch (err: any) {
      console.error('CodePost list error:', err);
      error(res, 'Failed to list code posts', 500);
    }
  }

  static async codePostCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { name, type, code_billing_id, code_gl_id, pay_commission, is_pos, local_tax, local_tax_percentage, service_charge, service_charge_percentage, service_charge_include_local_tax, tax, tax_percentage, tax_include_local_tax, sort, status } = req.body;

      if (!name) { badRequest(res, 'name is required'); return; }

      const result = await prisma.code_posts.create({
        data: {
          property_id: pid,
          name,
          type: type || 'DEFAULT',
          code_billing_id: code_billing_id ? BigInt(code_billing_id) : null,
          code_gl_id: code_gl_id ? BigInt(code_gl_id) : null,
          pay_commission: num(pay_commission),
          is_pos: num(is_pos),
          local_tax: num(local_tax),
          local_tax_percentage: num(local_tax_percentage),
          service_charge: num(service_charge),
          service_charge_percentage: num(service_charge_percentage),
          service_charge_include_local_tax: num(service_charge_include_local_tax),
          tax: num(tax),
          tax_percentage: num(tax_percentage),
          tax_include_local_tax: num(tax_include_local_tax),
          sort: num(sort),
          status: num(status),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Code post created');
    } catch (err: any) {
      console.error('CodePost create error:', err);
      error(res, 'Failed to create code post', 500);
    }
  }

  static async codePostShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.code_posts.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Code post not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load code post', 500);
    }
  }

  static async codePostEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.code_posts.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Code post not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load code post', 500);
    }
  }

  static async codePostUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { name, type, code_billing_id, code_gl_id, pay_commission, is_pos, local_tax, local_tax_percentage, service_charge, service_charge_percentage, service_charge_include_local_tax, tax, tax_percentage, tax_include_local_tax, sort, status } = req.body;

      const existing = await prisma.code_posts.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Code post not found'); return; }

      const data: any = { updated_at: new Date() };
      if (name !== undefined) data.name = name;
      if (type !== undefined) data.type = type;
      if (code_billing_id !== undefined) data.code_billing_id = BigInt(code_billing_id);
      if (code_gl_id !== undefined) data.code_gl_id = BigInt(code_gl_id);
      if (pay_commission !== undefined) data.pay_commission = num(pay_commission);
      if (is_pos !== undefined) data.is_pos = num(is_pos);
      if (local_tax !== undefined) data.local_tax = num(local_tax);
      if (local_tax_percentage !== undefined) data.local_tax_percentage = num(local_tax_percentage);
      if (service_charge !== undefined) data.service_charge = num(service_charge);
      if (service_charge_percentage !== undefined) data.service_charge_percentage = num(service_charge_percentage);
      if (service_charge_include_local_tax !== undefined) data.service_charge_include_local_tax = num(service_charge_include_local_tax);
      if (tax !== undefined) data.tax = num(tax);
      if (tax_percentage !== undefined) data.tax_percentage = num(tax_percentage);
      if (tax_include_local_tax !== undefined) data.tax_include_local_tax = num(tax_include_local_tax);
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = num(status);

      const result = await prisma.code_posts.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Code post updated');
    } catch (err: any) {
      error(res, 'Failed to update code post', 500);
    }
  }

  static async codePostDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.code_posts.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Code post not found'); return; }
      await prisma.code_posts.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Code post deleted');
    } catch (err: any) {
      error(res, 'Failed to delete code post', 500);
    }
  }

  // Replicates Laravel CodePostController@getCharge (surcharge + tax calculation + ledger).
  static async getCharge(req: Request, res: Response): Promise<void> {
    try {
      const codePostId = String(req.query.code_post_id ?? '');
      const amountRaw = String(req.query.amount ?? '');
      const type = String(req.query.type ?? '');
      const folioId = String(req.query.folio_id ?? '');
      if (!/^\d+$/.test(codePostId) || !amountRaw || !type || !/^\d+$/.test(folioId)) {
        badRequest(res, 'code_post_id, amount, type and folio_id are required');
        return;
      }
      const sumPrice = parseFloat(amountRaw);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const isPaymentType = type === 'payment' || type === 'paidout' || type === 'refund';

      let surcharge = 0;
      let codePost: any = null;
      let typePayment: any = null;
      if (isPaymentType) {
        typePayment = await prisma.type_payments.findUnique({
          where: { id: BigInt(codePostId) },
          include: { code_posts: true },
        });
        if (!typePayment) { badRequest(res, 'Type payment not found'); return; }
        if (typePayment.surcharge_type === 1) {
          surcharge += Number(typePayment.surcharge ?? 0);
        } else {
          surcharge += sumPrice * (Number(typePayment.surcharge ?? 0) / 100);
        }
        codePost = typePayment.code_posts;
      } else {
        codePost = await prisma.code_posts.findUnique({ where: { id: BigInt(codePostId) } });
      }

      let calc = { amount: sumPrice, service: 0, tax3: 0, pb1: 0, total: sumPrice };
      if (codePost) {
        const property = codePost.property_id ? await prisma.properties.findUnique({ where: { id: codePost.property_id } }) : null;
        calc = calculateCodePost(codePost, sumPrice, !!(property?.is_tax));
      }

      const data: any = {};
      if (calc.pb1 > 0) data.pb1 = moneyFormat(calc.pb1);
      if (calc.service > 0) data.svr_chrg = moneyFormat(calc.service);
      if (calc.tax3 > 0) data.tax3 = moneyFormat(calc.tax3);
      if (surcharge > 0) data.surcharge = moneyFormat(surcharge);
      if (isPaymentType) {
        data.amount = moneyFormat(sumPrice - surcharge);
      } else {
        data.amount = moneyFormat((calc.amount ?? 0) - surcharge);
      }
      data.total = moneyFormat(calc.total);

      const folio = await prisma.folios.findUnique({
        where: { id: BigInt(folioId) },
        include: { company_profiles_folios_company_profile_idTocompany_profiles: { select: { id: true, name: true } } },
      });
      if (!folio) { badRequest(res, 'Folio not found'); return; }

      let getLedger: { value: string; label: string } = {
        value: `${folio.company_profile_id}-company`,
        label: folio.company_profiles_folios_company_profile_idTocompany_profiles?.name || '',
      };
      const codeBillingId = codePost?.code_billing_id;
      if (codeBillingId) {
        const ledger = await prisma.billing_tos.findFirst({
          where: { folio_id: BigInt(folioId), billing_code: BigInt(codeBillingId), deleted_at: null },
        });
        if (ledger) {
          if (ledger.model_type === 'company') {
            const prof = await prisma.company_profiles.findUnique({ where: { id: ledger.model_id } });
            getLedger = { value: `${Number(ledger.model_id)}-company`, label: prof?.name || '' };
          } else {
            const prof = await prisma.guest_profiles.findUnique({ where: { id: ledger.model_id } });
            getLedger = { value: `${Number(ledger.model_id)}-guest`, label: prof ? `${prof.first_name || ''} ${prof.last_name || ''}`.trim() : '' };
          }
        }
      }

      success(res, data, 'Success', 200, { ledger: getLedger });
    } catch (err: any) {
      console.error('Code post getCharge error:', err);
      error(res, 'Failed to calculate charge', 500);
    }
  }

  // Replicates Laravel CodePostController@getCodeItems.
  static async getCodeItems(req: Request, res: Response): Promise<void> {
    try {
      const codePostId = String(req.query.code_post_id ?? '');
      const search = String(req.query.search ?? '');
      const where: any = { deleted_at: null, status: 1 };
      if (/^\d+$/.test(codePostId)) where.code_post_id = BigInt(codePostId);
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const items = await prisma.code_items.findMany({ where, orderBy: { name: 'asc' } });
      success(res, items.map((it: any) => ({ value: Number(it.id), label: it.name, amount: moneyFormat(it.sales) })), 'Success');
    } catch (err: any) {
      console.error('Code post getCodeItems error:', err);
      error(res, 'Failed to load code items', 500);
    }
  }

  static async codeItemList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.code_items.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { code_posts: { select: { id: true, name: true } } },
        }),
        prisma.code_items.count({ where }),
      ]);

      const rows = bigintToNumber(data).map((r: any, i: number) => ({ ...r, no: (page - 1) * limit + i + 1 }));
      success(res, rows, 'Success', 200, {
        table: TABLES.codeItem,
        pagging: laravelPaging(total, limit, page),
        permission: listPermission(req, { add: true, edit: true, delete: true }),
      } as any);
    } catch (err: any) {
      console.error('CodeItem list error:', err);
      error(res, 'Failed to list code items', 500);
    }
  }

  static async codeItemCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { code_post_id, name, is_online, is_event, description, sales, cost, sort, status } = req.body;

      if (!code_post_id) { badRequest(res, 'code_post_id is required'); return; }
      if (!name) { badRequest(res, 'name is required'); return; }

      const result = await prisma.code_items.create({
        data: {
          property_id: pid,
          code_post_id: BigInt(code_post_id),
          name,
          is_online: bool(is_online),
          is_event: bool(is_event),
          description: description || null,
          sales: num(sales),
          cost: num(cost),
          sort: num(sort),
          status: num(status),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Code item created');
    } catch (err: any) {
      console.error('CodeItem create error:', err);
      error(res, 'Failed to create code item', 500);
    }
  }

  static async codeItemShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.code_items.findUnique({
        where: { id },
        include: { code_posts: { select: { id: true, name: true } } },
      });
      if (!result) { notFound(res, 'Code item not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load code item', 500);
    }
  }

  static async codeItemEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.code_items.findUnique({
        where: { id },
        include: { code_posts: { select: { id: true, name: true } } },
      });
      if (!result) { notFound(res, 'Code item not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load code item', 500);
    }
  }

  static async codeItemUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { code_post_id, name, is_online, is_event, description, sales, cost, sort, status } = req.body;

      const existing = await prisma.code_items.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Code item not found'); return; }

      const data: any = { updated_at: new Date() };
      if (code_post_id !== undefined) data.code_post_id = BigInt(code_post_id);
      if (name !== undefined) data.name = name;
      if (is_online !== undefined) data.is_online = bool(is_online);
      if (is_event !== undefined) data.is_event = bool(is_event);
      if (description !== undefined) data.description = description;
      if (sales !== undefined) data.sales = num(sales);
      if (cost !== undefined) data.cost = num(cost);
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = num(status);

      const result = await prisma.code_items.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Code item updated');
    } catch (err: any) {
      error(res, 'Failed to update code item', 500);
    }
  }

  static async codeItemDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.code_items.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Code item not found'); return; }
      await prisma.code_items.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Code item deleted');
    } catch (err: any) {
      error(res, 'Failed to delete code item', 500);
    }
  }

  static async codeBillingList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.code_billings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.code_billings.count({ where }),
      ]);

      const rows = bigintToNumber(data).map((r: any, i: number) => ({ ...r, no: (page - 1) * limit + i + 1 }));
      success(res, rows, 'Success', 200, {
        table: TABLES.codeBilling,
        pagging: laravelPaging(total, limit, page),
        permission: listPermission(req, { add: true, edit: true, delete: true }),
      } as any);
    } catch (err: any) {
      console.error('CodeBilling list error:', err);
      error(res, 'Failed to list code billings', 500);
    }
  }

  static async codeBillingCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { name, description, isPOS, sort, status } = req.body;

      if (!name) { badRequest(res, 'name is required'); return; }

      const result = await prisma.code_billings.create({
        data: {
          property_id: pid,
          name,
          description: description || null,
          isPOS: num(isPOS),
          sort: num(sort),
          status: num(status),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Code billing created');
    } catch (err: any) {
      console.error('CodeBilling create error:', err);
      error(res, 'Failed to create code billing', 500);
    }
  }

  static async codeBillingShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.code_billings.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Code billing not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load code billing', 500);
    }
  }

  static async codeBillingEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.code_billings.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Code billing not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load code billing', 500);
    }
  }

  static async codeBillingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { name, description, isPOS, sort, status } = req.body;

      const existing = await prisma.code_billings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Code billing not found'); return; }

      const data: any = { updated_at: new Date() };
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (isPOS !== undefined) data.isPOS = num(isPOS);
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = num(status);

      const result = await prisma.code_billings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Code billing updated');
    } catch (err: any) {
      error(res, 'Failed to update code billing', 500);
    }
  }

  static async codeBillingDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.code_billings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Code billing not found'); return; }
      await prisma.code_billings.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Code billing deleted');
    } catch (err: any) {
      error(res, 'Failed to delete code billing', 500);
    }
  }

  static async codeGlList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.code_gls.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.code_gls.count({ where }),
      ]);

      const rows = bigintToNumber(data).map((r: any, i: number) => ({ ...r, no: (page - 1) * limit + i + 1 }));
      success(res, rows, 'Success', 200, {
        table: TABLES.codeGl,
        pagging: laravelPaging(total, limit, page),
        permission: listPermission(req, { add: true, edit: true, delete: true }),
      } as any);
    } catch (err: any) {
      console.error('CodeGl list error:', err);
      error(res, 'Failed to list code GLs', 500);
    }
  }

  static async codeGlGetGl(req: Request, res: Response): Promise<void> {
    try {
      // Laravel CodeGLSController@getGL parity: search name/description -> {id, name: description(name)}
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const where: any = { deleted_at: null };
      if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];
      const data = await prisma.code_gls.findMany({
        where,
        select: { id: true, description: true, name: true },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      });
      const mapped = data.map((c: any) => ({ id: Number(c.id), name: `${c.description ?? ''}(${c.name ?? ''})` }));
      success(res, mapped, 'Success', 200, {
        pagging: { current_page: page, last_page: 1, per_page: limit, total: mapped.length, from: mapped.length ? 1 : 0, to: mapped.length },
      });
    } catch (err: any) {
      console.error('CodeGl get-gl error:', err);
      error(res, 'Failed to load code GL', 500);
    }
  }

  static async codeGlCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { name, alias, description, account_uid, groupcode, mastercode, controlname, leveltype, balancetype, sort, status } = req.body;

      if (!name) { badRequest(res, 'name is required'); return; }

      const result = await prisma.code_gls.create({
        data: {
          property_id: pid,
          name,
          alias: alias || null,
          description: description || null,
          account_uid: account_uid || null,
          groupcode: groupcode || null,
          mastercode: mastercode || null,
          controlname: controlname || null,
          leveltype: leveltype || null,
          balancetype: balancetype || null,
          sort: num(sort),
          status: num(status),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Code GL created');
    } catch (err: any) {
      console.error('CodeGl create error:', err);
      error(res, 'Failed to create code GL', 500);
    }
  }

  static async codeGlShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.code_gls.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Code GL not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load code GL', 500);
    }
  }

  static async codeGlEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.code_gls.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Code GL not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load code GL', 500);
    }
  }

  static async codeGlUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { name, alias, description, account_uid, groupcode, mastercode, controlname, leveltype, balancetype, sort, status } = req.body;

      const existing = await prisma.code_gls.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Code GL not found'); return; }

      const data: any = { updated_at: new Date() };
      if (name !== undefined) data.name = name;
      if (alias !== undefined) data.alias = alias;
      if (description !== undefined) data.description = description;
      if (account_uid !== undefined) data.account_uid = account_uid;
      if (groupcode !== undefined) data.groupcode = groupcode;
      if (mastercode !== undefined) data.mastercode = mastercode;
      if (controlname !== undefined) data.controlname = controlname;
      if (leveltype !== undefined) data.leveltype = leveltype;
      if (balancetype !== undefined) data.balancetype = balancetype;
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = num(status);

      const result = await prisma.code_gls.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Code GL updated');
    } catch (err: any) {
      error(res, 'Failed to update code GL', 500);
    }
  }

  static async codeGlDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.code_gls.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Code GL not found'); return; }
      await prisma.code_gls.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Code GL deleted');
    } catch (err: any) {
      error(res, 'Failed to delete code GL', 500);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TYPE PAYMENT (type_payments)
  // ═══════════════════════════════════════════════════════════════
  private static async crudList(model: any, req: Request, res: Response, table?: any[]): Promise<void> {
    const pid = BigInt(req.user?.lastProperty ?? 0);
    const { page, limit, search } = parsePagination(req.query);
    const where: any = { property_id: pid, deleted_at: null };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      model.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
      model.count({ where }),
    ]);
    const rows = bigintToNumber(data).map((r: any, i: number) => ({ ...r, no: (page - 1) * limit + i + 1 }));
    success(res, rows, 'Success', 200, {
      table: table || [],
      pagging: laravelPaging(total, limit, page),
      permission: listPermission(req, { add: true, edit: true, delete: true }),
    } as any);
  }
  static async typePaymentList(req: Request, res: Response): Promise<void> { return MasterDataController.crudList(prisma.type_payments, req, res, TABLES.typePayment); }
  static async typePaymentShow(req: Request, res: Response): Promise<void> {
    try { const id = idParam(req.params.id); const d = await prisma.type_payments.findUnique({ where: { id } }); if (!d) { notFound(res); return; } success(res, bigintToNumber(d), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async typePaymentStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0); const { code_post_id, code_billing_id, name, pos, front_office, surcharge_type, surcharge, status } = req.body;
      if (!name) { badRequest(res, 'name required'); return; }
      const d = await prisma.type_payments.create({ data: { property_id: pid, code_post_id: BigInt(code_post_id), code_billing_id: code_billing_id ? BigInt(code_billing_id) : null, name, pos: num(pos), front_office: num(front_office), surcharge_type: num(surcharge_type), surcharge: num(surcharge), status: num(status, 1), created_at: new Date(), updated_at: new Date() } });
      success(res, bigintToNumber(d), 'Created');
    } catch (err: any) { error(res, 'Failed to create', 500); }
  }
  static async typePaymentUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id); const existing = await prisma.type_payments.findUnique({ where: { id } });
      if (!existing) { notFound(res); return; }
      const { code_post_id, code_billing_id, name, pos, front_office, surcharge_type, surcharge, status } = req.body;
      const data: any = { updated_at: new Date() };
      if (code_post_id !== undefined) data.code_post_id = BigInt(code_post_id); if (code_billing_id !== undefined) data.code_billing_id = code_billing_id ? BigInt(code_billing_id) : null;
      if (name !== undefined) data.name = name; if (pos !== undefined) data.pos = num(pos); if (front_office !== undefined) data.front_office = num(front_office);
      if (surcharge_type !== undefined) data.surcharge_type = num(surcharge_type); if (surcharge !== undefined) data.surcharge = num(surcharge); if (status !== undefined) data.status = num(status);
      await prisma.type_payments.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed to update', 500); }
  }
  static async typePaymentDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idParam(req.params.id); await prisma.type_payments.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  COUNTRY
  // ═══════════════════════════════════════════════════════════════
  static async countryList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = {};
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.countries.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.countries.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async countryShow(req: Request, res: Response): Promise<void> { try { const id = idParam(req.params.id); const d = await prisma.countries.findUnique({ where: { id } }); if (!d) { notFound(res); return; } success(res, bigintToNumber(d), 'Success'); } catch (err: any) { error(res, 'Failed', 500); } }
  static async countryStore(req: Request, res: Response): Promise<void> {
    try { const { name, iso3, iso2, phonecode, capital, currency, currency_symbol, nationality, region, status } = req.body; if (!name) { badRequest(res, 'name required'); return; } const d = await prisma.countries.create({ data: { name, iso3, iso2, phonecode, capital, currency, currency_symbol, nationality, region, status: status === true || status === 1 ? true : false, created_at: new Date(), updated_at: new Date() } }); success(res, bigintToNumber(d), 'Created'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async countryUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idParam(req.params.id); const { name, iso3, iso2, phonecode, capital, currency, currency_symbol, nationality, region, status } = req.body; const data: any = { updated_at: new Date() }; if (name !== undefined) data.name = name; if (iso3 !== undefined) data.iso3 = iso3; if (iso2 !== undefined) data.iso2 = iso2; if (phonecode !== undefined) data.phonecode = phonecode; if (capital !== undefined) data.capital = capital; if (currency !== undefined) data.currency = currency; if (currency_symbol !== undefined) data.currency_symbol = currency_symbol; if (nationality !== undefined) data.nationality = nationality; if (region !== undefined) data.region = region; if (status !== undefined) data.status = status === true || status === 1 ? true : false; await prisma.countries.update({ where: { id }, data }); success(res, null, 'Updated'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async countryDestroy(req: Request, res: Response): Promise<void> { try { const id = idParam(req.params.id); await prisma.countries.update({ where: { id }, data: { status: false } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); } }

  // ═══════════════════════════════════════════════════════════════
  //  CITY
  // ═══════════════════════════════════════════════════════════════
  static async cityList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = {};
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.cities.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit, include: { countries: { select: { id: true, name: true } } } }),
        prisma.cities.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, { pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) } });
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async cityShow(req: Request, res: Response): Promise<void> { try { const id = idParam(req.params.id); const d = await prisma.cities.findUnique({ where: { id }, include: { countries: { select: { id: true, name: true } } } }); if (!d) { notFound(res); return; } success(res, bigintToNumber(d), 'Success'); } catch (err: any) { error(res, 'Failed', 500); } }
  static async cityStore(req: Request, res: Response): Promise<void> {
    try { const { name, country_id, state_id, country_code, state_code, latitude, longitude, status } = req.body; if (!name) { badRequest(res, 'name required'); return; } const d = await prisma.cities.create({ data: { name, country_id: BigInt(country_id), state_id: state_id ? BigInt(state_id) : null, country_code, state_code, latitude: num(latitude), longitude: num(longitude), status: status ?? true, created_at: new Date(), updated_at: new Date() } }); success(res, bigintToNumber(d), 'Created'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async cityUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idParam(req.params.id); const { name, country_id, state_id, country_code, state_code, latitude, longitude, status } = req.body; const data: any = { updated_at: new Date() }; if (name !== undefined) data.name = name; if (country_id !== undefined) data.country_id = BigInt(country_id); if (state_id !== undefined) data.state_id = state_id ? BigInt(state_id) : null; if (latitude !== undefined) data.latitude = latitude; if (longitude !== undefined) data.longitude = longitude; if (status !== undefined) data.status = status === true || status === 1 ? true : false; await prisma.cities.update({ where: { id }, data }); success(res, null, 'Updated'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async cityDestroy(req: Request, res: Response): Promise<void> { try { const id = idParam(req.params.id); await prisma.cities.update({ where: { id }, data: { flag: false } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); } }

  // ═══════════════════════════════════════════════════════════════
  //  HOLIDAY
  // ═══════════════════════════════════════════════════════════════
  static async holidayList(req: Request, res: Response): Promise<void> { return MasterDataController.crudList(prisma.holidays, req, res); }
  static async holidayShow(req: Request, res: Response): Promise<void> { try { const id = idParam(req.params.id); const d = await prisma.holidays.findUnique({ where: { id } }); if (!d) { notFound(res); return; } success(res, bigintToNumber(d), 'Success'); } catch (err: any) { error(res, 'Failed', 500); } }
  static async holidayStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { name, start_date, end_date, sort, status } = req.body; if (!name) { badRequest(res, 'name required'); return; } const d = await prisma.holidays.create({ data: { property_id: pid, name, start_date: new Date(start_date), end_date: new Date(end_date), sort: num(sort), status: num(status, 1), created_at: new Date(), updated_at: new Date() } }); success(res, bigintToNumber(d), 'Created'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async holidayUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idParam(req.params.id); const { name, start_date, end_date, sort, status } = req.body; const data: any = { updated_at: new Date() }; if (name !== undefined) data.name = name; if (start_date !== undefined) data.start_date = new Date(start_date); if (end_date !== undefined) data.end_date = new Date(end_date); if (sort !== undefined) data.sort = num(sort); if (status !== undefined) data.status = num(status); await prisma.holidays.update({ where: { id }, data }); success(res, null, 'Updated'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async holidayDestroy(req: Request, res: Response): Promise<void> { try { const id = idParam(req.params.id); await prisma.holidays.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); } }
}
