import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bn(v: any): any {
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(bn);
  if (v && typeof v === 'object') { const o: any = {}; for (const [k, val] of Object.entries(v)) o[k] = bn(val); return o; }
  return v;
}
function idP(v: any): bigint { return BigInt(Array.isArray(v) ? v[0] : v); }

export class CompanyController {

  // ── Company Profile ──
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null };
      if (s) where.OR = [{ name: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }];
      const [data, total] = await Promise.all([
        prisma.company_profiles.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }),
        prisma.company_profiles.count({ where }),
      ]);
      success(res, bn(data), 'Success', 200, { pagging: { current_page: page, last_page: Math.ceil(total / lim), per_page: lim, total, from: (page - 1) * lim + 1, to: Math.min(page * lim, total) } });
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async autocomplete(req: Request, res: Response): Promise<void> {
    try {
      const s = req.query.search as string;
      const where: any = { deleted_at: null };
      if (s) where.name = { contains: s, mode: 'insensitive' };
      const data = await prisma.company_profiles.findMany({ where, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 20 });
      success(res, bn(data), 'Success');
    } catch (err: any) { error(res, 'Failed', 500); }
  }

  static async show(req: Request, res: Response): Promise<void> {
    try { const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id; if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; } const id = BigInt(raw); const d = await prisma.company_profiles.findUnique({ where: { id } }); if (!d) { notFound(res); return; } success(res, bn(d), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  static async createForm(req: Request, res: Response): Promise<void> {
    try {
      if (req.params.id !== undefined) {
        const id = idP(req.params.id);
        const d = await prisma.company_profiles.findUnique({ where: { id } });
        if (!d) { notFound(res); return; }
        success(res, bn(d), 'Success');
        return;
      }
      const [countries, types] = await Promise.all([
        prisma.countries.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.code_posts.findMany({ where: { type: 'COMPANY', deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);
      success(res, { status: 1 }, 'Success', 200, {
        master: {
          countries: countries.map(c => ({ value: Number(c.id), label: c.name })),
          type_companies: types.map(t => ({ value: Number(t.id), label: t.name })),
        },
      });
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async store(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { name, type_company, email, telp, mobile_phone, billing_address, billing_city, billing_country, credit_limit, status } = req.body;
      if (!name) { badRequest(res, 'name required'); return; }
      const d = await prisma.company_profiles.create({
        data: { property_id: pid, name, type_company: type_company || 'Corporate', email, telp, mobile_phone, billing_address, billing_city, billing_country, credit_limit: credit_limit ?? 0, status: status ?? 1, code_billing_id: '', created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bn(d), 'Created');
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const id = idP(req.params.id); const existing = await prisma.company_profiles.findUnique({ where: { id } });
      if (!existing) { notFound(res); return; }
      const { name, type_company, email, telp, mobile_phone, billing_address, billing_city, billing_country, credit_limit, status } = req.body;
      const data: any = { updated_at: new Date() };
      if (name !== undefined) data.name = name; if (type_company !== undefined) data.type_company = type_company;
      if (email !== undefined) data.email = email; if (telp !== undefined) data.telp = telp;
      if (mobile_phone !== undefined) data.mobile_phone = mobile_phone; if (billing_address !== undefined) data.billing_address = billing_address;
      if (billing_city !== undefined) data.billing_city = billing_city; if (billing_country !== undefined) data.billing_country = billing_country;
      if (credit_limit !== undefined) data.credit_limit = credit_limit; if (status !== undefined) data.status = status;
      await prisma.company_profiles.update({ where: { id }, data });
      success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }

  static async destroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profiles.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ── Contact Person ──
  static async contactList(req: Request, res: Response): Promise<void> {
    try { const data = await prisma.company_profile_contact_persons.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' } }); success(res, bn(data), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async contactStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id, name, position, email, tel, mobile_phone, is_default } = req.body;
      const d = await prisma.company_profile_contact_persons.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), name, position, email, tel, mobile_phone, is_default: is_default ?? false, created_at: new Date(), updated_at: new Date() } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async contactUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); const { name, position, email, tel, mobile_phone, is_default } = req.body; const data: any = { updated_at: new Date() };
      if (name !== undefined) data.name = name; if (position !== undefined) data.position = position; if (email !== undefined) data.email = email;
      if (tel !== undefined) data.tel = tel; if (mobile_phone !== undefined) data.mobile_phone = mobile_phone; if (is_default !== undefined) data.is_default = is_default;
      await prisma.company_profile_contact_persons.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async contactDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_contact_persons.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ── Department ──
  static async deptList(req: Request, res: Response): Promise<void> {
    try { const data = await prisma.company_profile_departments.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' } }); success(res, bn(data), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async deptStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id, department, country_id, city_id, address, postal_code } = req.body;
      const d = await prisma.company_profile_departments.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), department, country_id: country_id ? BigInt(country_id) : null, city_id: city_id ? BigInt(city_id) : null, address, postal_code, created_at: new Date(), updated_at: new Date() } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async deptUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); const { department, country_id, city_id, address, postal_code } = req.body; const data: any = { updated_at: new Date() };
      if (department !== undefined) data.department = department; if (country_id !== undefined) data.country_id = BigInt(country_id); if (city_id !== undefined) data.city_id = BigInt(city_id);
      if (address !== undefined) data.address = address; if (postal_code !== undefined) data.postal_code = postal_code;
      await prisma.company_profile_departments.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async deptDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_departments.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ── Activity ──
  static async activityList(req: Request, res: Response): Promise<void> {
    try { const data = await prisma.company_profile_activities.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' } }); success(res, bn(data), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async activityStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id, date, subject, objective, notes } = req.body;
      const d = await prisma.company_profile_activities.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), date: new Date(date || Date.now()), subject, objective, notes, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async activityUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); const { date, subject, objective, notes } = req.body; const data: any = { updated_at: new Date() };
      if (date !== undefined) data.date = new Date(date); if (subject !== undefined) data.subject = subject; if (objective !== undefined) data.objective = objective;
      if (notes !== undefined) data.notes = notes; await prisma.company_profile_activities.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async activityDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_activities.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ── Document ──
  static async documentList(req: Request, res: Response): Promise<void> {
    try { const data = await prisma.company_profile_documents.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' } }); success(res, bn(data), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async documentStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id, file, description } = req.body;
      const d = await prisma.company_profile_documents.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), file, description, created_at: new Date(), updated_at: new Date() } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async documentUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); const { file, description } = req.body; const data: any = { updated_at: new Date() };
      if (file !== undefined) data.file = file; if (description !== undefined) data.description = description;
      await prisma.company_profile_documents.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async documentDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_documents.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ── Guest ──
  static async guestList(req: Request, res: Response): Promise<void> {
    try { const data = await prisma.company_guests.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' } }); success(res, bn(data), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async guestStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { company_profile_id, first_name, last_name, email, mobile_phone } = req.body;
      if (!company_profile_id) { badRequest(res, 'company_profile_id required'); return; }
      const d = await prisma.company_guests.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), first_name, last_name, email, mobile_phone, created_at: new Date(), updated_at: new Date() } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async guestDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_guests.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ── Folio ──
  static async folioList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const companyId = req.query.company_id as string;
      const where: any = { property_id: pid, deleted_at: null };
      if (companyId) where.company_profile_id = BigInt(companyId);
      const data = await prisma.folios.findMany({ where, orderBy: { id: 'desc' }, take: 50 });
      success(res, bn(data), 'Success');
    } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ── Statistic ──
  static async statisticIndex(req: Request, res: Response): Promise<void> {
    try {
      const data = await prisma.company_profile_statistics.findMany({ orderBy: { id: 'desc' }, take: 10 });
      success(res, bn(data), 'Success');
    } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ── AR Transaction ──
  static async arTransactionList(req: Request, res: Response): Promise<void> {
    try { const data = await prisma.company_profile_ar_transactions.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' } }); success(res, bn(data), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async arTransactionStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id, transaction_code, document, date, description, amount } = req.body;
      const d = await prisma.company_profile_ar_transactions.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), transaction_code, document, date: new Date(date || Date.now()), description: description || '', amount: amount ?? 0, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async arTransactionDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_ar_transactions.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // ════════ Company Profile Billing Setup ════════
  static async billingSetupList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const where: any = { deleted_at: null };
      if (s) where.OR = [{ billing: { contains: s, mode: 'insensitive' } }, { company_profiles: { is: { name: { contains: s, mode: 'insensitive' } } } }];
      const [data, total] = await Promise.all([
        prisma.company_profile_billing_setups.findMany({ where, include: { company_profiles: { select: { id: true, name: true } }, code_billings: { select: { id: true, name: true } } }, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }),
        prisma.company_profile_billing_setups.count({ where }),
      ]);
      success(res, bn(data), 'Success', 200, { pagging: { current_page: page, last_page: Math.ceil(total / lim), per_page: lim, total, from: (page - 1) * lim + 1, to: Math.min(page * lim, total) } });
    } catch (err: any) { console.error('Billing setup list error:', err); error(res, 'Failed', 500); }
  }
  static async billingSetupStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { company_profile_id, code_billing_id, billing } = req.body;
      const d = await prisma.company_profile_billing_setups.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), code_billing_id: BigInt(code_billing_id), billing, status: 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id } });
      success(res, bn(d), 'Created');
    } catch (err: any) { console.error('Billing setup store error:', err); error(res, 'Failed', 500); }
  }
  static async billingSetupDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_billing_setups.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }
}
