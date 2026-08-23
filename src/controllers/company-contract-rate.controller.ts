import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MENU_ID = 83;
const RATE_MODEL_TYPE = 'App\\Models\\Rate';

// Laravel CompanyContractRateController parity — the "contract rate" list is
// Rate↔CompanyProfile links via the model_has_company_profiles morph pivot
// (Rate::companyProfile()->sync/detach), NOT a separate table.

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

async function rateRowFor(rateId: bigint): Promise<any> {
  return prisma.rates.findUnique({
    where: { id: rateId },
    include: {
      code_posts: { include: { code_billings: { select: { id: true, name: true } } } },
      code_gls: false as any,
    } as any,
  });
}

export class CompanyContractRateController {
  // GET ?company_id= — rates linked to the company via the pivot (:23-67)
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const companyId = req.query.company_id as string;
      if (!companyId) { badRequest(res, 'company_id is required'); return; }
      const search = req.query.search as string;

      const linkWhere: any = { company_profile_id: BigInt(companyId), model_type: RATE_MODEL_TYPE };
      if (search) {
        linkWhere.rates = {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        };
      }

      const [links, total] = await Promise.all([
        prisma.model_has_company_profiles.findMany({
          where: linkWhere,
          include: { rates: { include: { code_posts: { include: { code_billings: { select: { id: true, name: true } } } } } } },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.model_has_company_profiles.count({ where: linkWhere }),
      ]);

      const data = links.map((l: any) => ({
        id: Number(l.model_id),
        company_profile_id: Number(l.company_profile_id),
        rate: l.rates ? bigintToNumber(l.rates) : null,
      }));

      const table = [
        { label: 'Rate Code', key: 'rate', type: 'none' },
        { label: 'Description', key: 'rate.description', type: 'none' },
        { label: 'Action', key: 'action', type: 'action' },
      ];
      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: permFlags.view ?? true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, data, 'Success', 200, {
        table,
        permission,
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

  static async create(_req: Request, res: Response): Promise<void> {
    success(res, { statuses: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }] }, 'Success');
  }

  // POST {contract_rate} + ?company_id — attach rate→company via pivot sync (:87-139)
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const rawRate = body.contract_rate;
      if (!rawRate) { badRequest(res, 'The contract rate field is required.'); return; }
      const rateId = BigInt(typeof rawRate === 'object' ? rawRate.value : rawRate);
      const companyIdRaw = String(body.company_id ?? req.query.company_id ?? '');
      if (!companyIdRaw || !/^\d+$/.test(companyIdRaw)) { badRequest(res, 'The company id field is required.'); return; }
      const companyId = BigInt(companyIdRaw);

      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate) { badRequest(res, 'Rate not found.'); return; }
      const company = await prisma.company_profiles.findUnique({ where: { id: companyId } });
      if (!company) { badRequest(res, 'Company not found.'); return; }

      const dup = await prisma.model_has_company_profiles.findFirst({
        where: { model_type: RATE_MODEL_TYPE, model_id: rateId, company_profile_id: companyId },
      });
      if (dup) { badRequest(res, 'Rate already exists.'); return; }

      await prisma.model_has_company_profiles.create({
        data: { model_type: RATE_MODEL_TYPE, model_id: rateId, company_profile_id: companyId },
      });

      success(res, bigintToNumber(await rateRowFor(rateId)), 'Rate created successfully.', 200);
    } catch (err: any) {
      console.error('Company contract rate store error:', err);
      error(res, 'Failed to create company contract rate', 500);
    }
  }

  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.model_has_company_profiles.findFirst({
        where: { model_type: RATE_MODEL_TYPE, model_id: BigInt(idParam) },
        include: { rates: true },
      });
      if (!row) { notFound(res, 'Not Found'); return; }
      success(res, bigintToNumber(row), 'Success');
    } catch (err: any) {
      console.error('Company contract rate show error:', err);
      error(res, 'Failed to fetch company contract rate', 500);
    }
  }

  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const rate = await prisma.rates.findUnique({ where: { id: BigInt(idParam) }, include: { code_posts: true } });
      if (!rate) { notFound(res, 'Not Found'); return; }
      success(res, { ...bigintToNumber(rate), master: { statuses: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }] } }, 'Success');
    } catch (err: any) {
      console.error('Company contract rate edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  // PUT /:id + ?company_id + {contract_rate} — attach new rate, detach old (:167-246)
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const oldRateId = BigInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const body = req.body || {};
      const rawRate = body.contract_rate;
      if (!rawRate) { badRequest(res, 'The contract rate field is required.'); return; }
      const newRateId = BigInt(typeof rawRate === 'object' ? rawRate.value : rawRate);
      const companyIdRaw = String(body.company_id ?? req.query.company_id ?? '');
      if (!companyIdRaw || !/^\d+$/.test(companyIdRaw)) { badRequest(res, 'The company id field is required.'); return; }
      const companyId = BigInt(companyIdRaw);

      const dup = await prisma.model_has_company_profiles.findFirst({
        where: { model_type: RATE_MODEL_TYPE, model_id: newRateId, company_profile_id: companyId },
      });
      if (dup && Number(dup.model_id) !== Number(oldRateId)) { badRequest(res, 'Rate already exists.'); return; }

      const rate = await prisma.rates.findUnique({ where: { id: newRateId } });
      if (!rate) { badRequest(res, 'Rate not found.'); return; }
      const company = await prisma.company_profiles.findUnique({ where: { id: companyId } });
      if (!company) { badRequest(res, 'Company not found.'); return; }

      await prisma.model_has_company_profiles.upsert({
        where: { company_profile_id_model_id_model_type: { company_profile_id: companyId, model_id: newRateId, model_type: RATE_MODEL_TYPE } },
        create: { model_type: RATE_MODEL_TYPE, model_id: newRateId, company_profile_id: companyId },
        update: {},
      });

      // detach old rate link
      await prisma.model_has_company_profiles.deleteMany({
        where: { model_type: RATE_MODEL_TYPE, model_id: oldRateId, company_profile_id: companyId },
      });

      success(res, bigintToNumber(await rateRowFor(newRateId)), 'Rate updated successfully.', 200);
    } catch (err: any) {
      console.error('Company contract rate update error:', err);
      error(res, 'Failed to update company contract rate', 500);
    }
  }

  // DELETE /:id + ?company_id — detach (= Laravel destroy :248-273)
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const companyIdRaw = String(req.body?.company_id ?? req.query.company_id ?? '');
      if (!companyIdRaw || !/^\d+$/.test(companyIdRaw)) { badRequest(res, 'The company id field is required.'); return; }
      const company = await prisma.company_profiles.findUnique({ where: { id: BigInt(companyIdRaw) } });
      if (!company) { badRequest(res, 'Company not found.'); return; }
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate) { badRequest(res, 'Rate not found.'); return; }

      await prisma.model_has_company_profiles.deleteMany({
        where: { model_type: RATE_MODEL_TYPE, model_id: rateId, company_profile_id: BigInt(companyIdRaw) },
      });
      success(res, null, 'Rate deleted successfully.', 200);
    } catch (err: any) {
      console.error('Company contract rate destroy error:', err);
      error(res, 'Failed to delete company contract rate', 500);
    }
  }

  static async restore(_req: Request, res: Response): Promise<void> {
    // Laravel restore reads the legacy company_contract_rates table — dead path kept as no-op.
    success(res, null, 'Success');
  }
}
