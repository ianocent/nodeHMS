import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MENU_ID = 83;

const STATUSES = [
  { value: 1, label: 'Active' },
  { value: 0, label: 'Inactive' },
];

function formatContractRate(r: any): any {
  return bigintToNumber({
    ...r,
    id: Number(r.id),
    company_profile_id: Number(r.company_profile_id),
    property_id: Number(r.property_id),
    rate_code: r.rate_code ? Number(r.rate_code) : null,
    rate: r.rate ? {
      ...r.rate,
      id: Number(r.rate.id),
      code_post_id: Number(r.rate.code_post_id),
      property_id: Number(r.rate.property_id),
      minimum_rate: Number(r.rate.minimum_rate),
      code_post: r.rate.code_post ? {
        ...r.rate.code_post,
        id: Number(r.rate.code_post.id),
        code_billing_id: r.rate.code_post.code_billing_id ? Number(r.rate.code_post.code_billing_id) : null,
        code_billing: r.rate.code_post.code_billing ? {
          ...r.rate.code_post.code_billing,
          id: Number(r.rate.code_post.code_billing.id),
        } : null,
      } : null,
    } : null,
  });
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

export class CompanyContractRateController {
  /**
   * GET /api/company-contract-rates
   * Paginated list filtered by company_id, search by name/description
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string || 'id';
      const order = req.query.order === 'desc' ? 'desc' : 'asc';
      const companyId = req.query.company_id as string;
      const propertyId = req.user?.lastProperty;

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null };

      if (propertyId) {
        where.property_id = BigInt(propertyId);
      }

      if (companyId) {
        where.company_profile_id = BigInt(companyId);
      }

      if (search) {
        // Search by description (local) or rate name (via rate_code)
        const matchingRateIds = await prisma.rates.findMany({
          where: {
            deleted_at: null,
            name: { contains: search, mode: 'insensitive' },
          },
          select: { id: true },
        });
        const rateIds = matchingRateIds.map((r) => Number(r.id));
        where.OR = [
          { description: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
          ...(rateIds.length > 0 ? [{ rate_code: { in: rateIds } }] : []),
        ];
      }

      const [items, total] = await Promise.all([
        prisma.company_contract_rate.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.company_contract_rate.count({ where }),
      ]);

      // Fetch related rates + company profiles
      const rateCodeIds = items
        .map((i) => i.rate_code)
        .filter((rc): rc is number => rc !== null);
      const companyIds = items.map((i) => i.company_profile_id);

      const [rates, companies] = await Promise.all([
        rateCodeIds.length > 0
          ? prisma.rates.findMany({
              where: { id: { in: rateCodeIds.map((id) => BigInt(id)) } },
              include: {
                code_posts: {
                  include: {
                    code_billings: { select: { id: true, name: true } },
                  },
                },
              },
            })
          : Promise.resolve([]),
        companyIds.length > 0
          ? prisma.company_profiles.findMany({
              where: { id: { in: companyIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);

      const rateMap = new Map(rates.map((r) => [Number(r.id), r]));
      const companyMap = new Map(companies.map((c) => [Number(c.id), c]));

      const formatted = items.map((item) => {
        const rateRec = item.rate_code ? rateMap.get(item.rate_code) : undefined;
        return {
          ...item,
          id: Number(item.id),
          company_profile_id: Number(item.company_profile_id),
          property_id: Number(item.property_id),
          rate_code: item.rate_code ?? null,
          rate: rateRec ? bigintToNumber(rateRec) : null,
          company: companyMap.get(Number(item.company_profile_id)) ? bigintToNumber(companyMap.get(Number(item.company_profile_id))) : null,
        };
      });

      // Search data: available rates with code_post + code_billing
      const searchRates = await prisma.rates.findMany({
        where: { deleted_at: null, status: 1, property_id: propertyId ? BigInt(propertyId) : undefined },
        select: { id: true, name: true, code: true, code_post_id: true },
        orderBy: { name: 'asc' },
      });
      const searchCodePostIds = searchRates
        .map((r) => r.code_post_id)
        .filter((id): id is bigint => id !== null);
      const searchCodePosts = await prisma.code_posts.findMany({
        where: { id: { in: searchCodePostIds } },
        select: { id: true, name: true, code_billing_id: true },
      });
      const searchCodeBillingIds = searchCodePosts
        .map((cp) => cp.code_billing_id)
        .filter((id): id is bigint => id !== null);
      const searchCodeBillings = await prisma.code_billings.findMany({
        where: { id: { in: searchCodeBillingIds } },
        select: { id: true, name: true },
      });

      const cpMap = new Map(searchCodePosts.map((cp) => [Number(cp.id), cp]));
      const cbMap = new Map(searchCodeBillings.map((cb) => [Number(cb.id), cb]));

      const searchData = searchRates.map((r) => {
        const cp = cpMap.get(Number(r.code_post_id));
        return {
          id: Number(r.id),
          name: r.name,
          code: r.code,
          code_post: cp
            ? {
                id: Number(cp.id),
                name: cp.name,
                code_billing: cp.code_billing_id
                  ? bigintToNumber(cbMap.get(Number(cp.code_billing_id)) || null)
                  : null,
              }
            : null,
        };
      });

      const table = [
        { label: 'Rate Code', key: 'rate_code', type: 'none', is_search: false },
        { label: 'Rate Name', key: 'rate', type: 'none', is_search: true },
        { label: 'Description', key: 'description', type: 'none', is_search: true },
        { label: 'Company', key: 'company', type: 'none', is_search: false },
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
        search_data: searchData,
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
      console.error('Company contract rate list error:', err);
      error(res, 'Failed to fetch company contract rates', 500);
    }
  }

  /**
   * GET /api/company-contract-rates/create
   * Master data for creation form
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const master = {
        statuses: STATUSES,
      };

      success(res, master, 'Success');
    } catch (err: any) {
      console.error('Company contract rate create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /api/company-contract-rates
   * Store new company contract rate
   */
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const { contract_rate, description, notes, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!contract_rate) errors.contract_rate = ['The contract rate (rate) field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const rateId = typeof contract_rate === 'object' ? contract_rate.value : contract_rate;

      // Verify rate exists
      const rateExists = await prisma.rates.findUnique({
        where: { id: BigInt(rateId) },
        select: { id: true },
      });
      if (!rateExists) {
        badRequest(res, 'Selected rate not found');
        return;
      }

      const created = await prisma.company_contract_rate.create({
        data: {
          rate_code: Number(rateId),
          description: description || null,
          notes: notes || null,
          status: status !== undefined ? status : 1,
          company_profile_id: BigInt(req.body.company_profile_id || 0),
          property_id: propertyId ? BigInt(propertyId) : BigInt(0),
          created_by: userId,
        },
      });

      // Fetch related rate for response
      let rateRecord = null;
      if (created.rate_code) {
        rateRecord = await prisma.rates.findUnique({
          where: { id: BigInt(created.rate_code) },
          include: {
            code_posts: {
              include: {
                code_billings: { select: { id: true, name: true } },
              },
            },
          },
        });
      }

      success(res, formatContractRate({ ...created, rate: rateRecord }), 'Success', 200);
    } catch (err: any) {
      console.error('Company contract rate store error:', err);
      error(res, 'Failed to create company contract rate', 500);
    }
  }

  /**
   * GET /api/company-contract-rates/:id
   * Show single record
   */
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const record = await prisma.company_contract_rate.findUnique({ where: { id } });

      if (!record || record.deleted_at) {
        notFound(res, 'Company contract rate not found');
        return;
      }

      let rateRecord = null;
      if (record.rate_code) {
        rateRecord = await prisma.rates.findUnique({
          where: { id: BigInt(record.rate_code) },
          include: {
            code_posts: {
              include: {
                code_billings: { select: { id: true, name: true } },
              },
            },
          },
        });
      }

      let companyRecord = null;
      if (record.company_profile_id) {
        companyRecord = await prisma.company_profiles.findUnique({
          where: { id: record.company_profile_id },
          select: { id: true, name: true },
        });
      }

      const result = formatContractRate({ ...record, rate: rateRecord });
      result.company = companyRecord ? { id: Number(companyRecord.id), name: companyRecord.name } : null;

      success(res, result, 'Success');
    } catch (err: any) {
      console.error('Company contract rate show error:', err);
      error(res, 'Failed to fetch company contract rate', 500);
    }
  }

  /**
   * GET /api/company-contract-rates/:id/edit
   * Show record for editing with master data
   */
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const [record, companies, allRates] = await Promise.all([
        prisma.company_contract_rate.findUnique({ where: { id } }),
        prisma.company_profiles.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.rates.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      if (!record || record.deleted_at) {
        notFound(res, 'Company contract rate not found');
        return;
      }

      let rateRecord = null;
      if (record.rate_code) {
        rateRecord = await prisma.rates.findUnique({
          where: { id: BigInt(record.rate_code) },
          include: {
            code_posts: {
              include: {
                code_billings: { select: { id: true, name: true } },
              },
            },
          },
        });
      }

      const master = {
        statuses: STATUSES,
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        rates: allRates.map((r: any) => ({ value: Number(r.id), label: `${r.name} (${r.code})` })),
      };

      const result = formatContractRate({ ...record, rate: rateRecord });
      result.master = master;

      success(res, result, 'Success');
    } catch (err: any) {
      console.error('Company contract rate edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /api/company-contract-rates/:id
   * Update record
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.company_contract_rate.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Company contract rate not found');
        return;
      }

      const { contract_rate, description, notes, status, company_profile_id } = req.body;

      const errors: Record<string, string[]> = {};
      if (!contract_rate) errors.contract_rate = ['The contract rate (rate) field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const rateId = typeof contract_rate === 'object' ? contract_rate.value : contract_rate;

      // Verify rate exists
      const rateExists = await prisma.rates.findUnique({
        where: { id: BigInt(rateId) },
        select: { id: true },
      });
      if (!rateExists) {
        badRequest(res, 'Selected rate not found');
        return;
      }

      await prisma.company_contract_rate.update({
        where: { id },
        data: {
          rate_code: Number(rateId),
          description: description !== undefined ? description : existing.description,
          notes: notes !== undefined ? notes : existing.notes,
          status: status !== undefined ? status : existing.status,
          company_profile_id: company_profile_id ? BigInt(company_profile_id) : existing.company_profile_id,
          updated_by: userId,
          updated_at: new Date(),
        },
      });

      const updated = await prisma.company_contract_rate.findUnique({ where: { id } });

      let rateRecord = null;
      if (updated?.rate_code) {
        rateRecord = await prisma.rates.findUnique({
          where: { id: BigInt(updated.rate_code) },
          include: {
            code_posts: {
              include: {
                code_billings: { select: { id: true, name: true } },
              },
            },
          },
        });
      }

      success(res, formatContractRate({ ...updated, rate: rateRecord }), 'Success');
    } catch (err: any) {
      console.error('Company contract rate update error:', err);
      error(res, 'Failed to update company contract rate', 500);
    }
  }

  /**
   * DELETE /api/company-contract-rates/:id
   * Soft delete
   */
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const record = await prisma.company_contract_rate.findUnique({ where: { id } });
      if (!record) {
        notFound(res, 'Company contract rate not found');
        return;
      }

      await prisma.company_contract_rate.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Company contract rate destroy error:', err);
      error(res, 'Failed to delete company contract rate', 500);
    }
  }

  /**
   * POST /api/company-contract-rates/:id/restore
   * Restore soft-deleted record
   */
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const record = await prisma.company_contract_rate.findUnique({ where: { id } });
      if (!record) {
        notFound(res, 'Company contract rate not found');
        return;
      }

      await prisma.company_contract_rate.update({
        where: { id },
        data: { deleted_at: null, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Company contract rate restore error:', err);
      error(res, 'Failed to restore company contract rate', 500);
    }
  }
}

