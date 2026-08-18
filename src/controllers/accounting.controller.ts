import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { dataSearch, applySearchField } from '../utils/search';
import { getStatusLabel } from '../utils/cmsConfig';

const ACCOUNTING_STATUSES = [
  { value: 1, label: 'Processed' },
  { value: 2, label: 'Pending' },
  { value: 3, label: 'Cancelled' },
];

function getAccountingStatusLabel(statusId: number | null | undefined): { value: number; label: string } {
  const s = ACCOUNTING_STATUSES.find((x) => x.value === statusId);
  return { value: statusId ?? 0, label: s?.label ?? 'Unknown' };
}

const ACCOUNTING_TABLE = [
  { label: 'Date', key: 'date', type: 'date', is_search: true },
  { label: 'Doc', key: 'number_note', type: 'none', is_search: false },
  { label: 'Company', key: 'company_profile_id', type: 'autocomplete', url_autocomplete: '/cms/profile/company-v2', is_search: false },
  { label: 'Amount', key: 'amount', type: 'number', is_search: false },
  { label: 'Outstanding', key: 'outstanding', type: 'none', is_search: false },
  { label: 'Source', key: 'source', type: 'text', is_search: false },
  { label: 'Description', key: 'description_accounting', type: 'none', is_search: false },
  {
    label: 'Processed', key: 'status_accounting', type: 'none', is_search: false,
    options: [
      { value: 1, label: 'Processed' },
      { value: 2, label: 'Pending' },
      { value: 3, label: 'Cancelled' },
    ],
  },
  { label: 'Action', key: 'action', type: 'action', is_search: false },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TYPE_MAP: Record<string, string> = {
  'invoice': 'invoice',
  'credit-note': 'credit_note',
  'debit-note': 'debit_note',
  'payment': 'payment',
  'refund': 'refund',
  'adjustment': 'adjustment',
};

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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function resolveType(req: Request): string | null {
  const raw = req.params.type as string;
  if (!raw) return null;
  return TYPE_MAP[raw] || null;
}

export class AccountingController {
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/accounting/{type}
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const mappedType = resolveType(req);
      if (!mappedType) {
        badRequest(res, 'Invalid accounting type');
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = {
        property_id: pid,
        type_accounting: mappedType,
        deleted_at: trash ? { not: null } : null,
      };

      applySearchField(where, req, ACCOUNTING_TABLE);

const [records, total] = await Promise.all([
        prisma.accountings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            type_payments: { select: { id: true, name: true } },
            folios: { select: { id: true, folio_number: true } },
          },
        }),
        prisma.accountings.count({ where }),
      ]);

      const formatted = records.map((r: any) => ({
        ...bigintToNumber(r),
        status_accounting: getAccountingStatusLabel(r.status_accounting),
      }));

success(res, formatted, 'Success', 200, {
        table: ACCOUNTING_TABLE,
        permission: { view: true, add: true, edit: true, delete: true },
        search_data: dataSearch(req, ACCOUNTING_TABLE) as any,
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
      console.error('Accounting list error:', err);
      error(res, 'Failed to fetch accounting list', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/accounting/get/{type}
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async autocomplete(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const mappedType = resolveType(req);
      if (!mappedType) {
        badRequest(res, 'Invalid accounting type');
        return;
      }

      const records = await prisma.accountings.findMany({
        where: {
          property_id: pid,
          type_accounting: mappedType,
          deleted_at: null,
        },
        orderBy: { id: 'desc' },
        select: {
          id: true,
          number_note: true,
        },
      });

      const formatted = records.map((r: any) => bigintToNumber(r));
      success(res, formatted, 'Success');
    } catch (err: any) {
      console.error('Accounting autocomplete error:', err);
      error(res, 'Failed to fetch accounting autocomplete', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /cms/accounting/{type}/update-status
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async updateStatus(req: Request, res: Response): Promise<void> {
    try {
      const idVal = (req.query.id as string) || req.body.id;
      if (!idVal) {
        badRequest(res, 'id is required');
        return;
      }
      const id = BigInt(idVal);

      const { status, status_accounting } = req.body;

      const existing = await prisma.accountings.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Accounting record not found');
        return;
      }

      const data: any = { updated_at: new Date() };
      if (status !== undefined) data.status = Number(status);
      if (status_accounting !== undefined) data.status_accounting = Number(status_accounting);

      await prisma.accountings.update({ where: { id }, data });

      success(res, null, 'Status updated successfully');
    } catch (err: any) {
      console.error('Accounting updateStatus error:', err);
      error(res, 'Failed to update status', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/accounting/{type}/create
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async createForm(req: Request, res: Response): Promise<void> {
    try {
      const [folios, typePayments] = await Promise.all([
        prisma.folios.findMany({ where: { deleted_at: null, status: 1 }, select: { id: true, folio_number: true }, orderBy: { id: 'desc' }, take: 50 }),
        prisma.type_payments.findMany({ where: { deleted_at: null, status: 1 }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);
      success(res, { status: 1, type_accounting: String(req.params.type), date: new Date() }, 'Success', 200, {
        master: {
          folios: bigintToNumber(folios),
          type_payments: bigintToNumber(typePayments),
        },
      });
    } catch (err: any) {
      console.error('Accounting create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/accounting/{type}/{id}
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Accounting record not found'); return; }
      const id = BigInt(idRaw);

      const record = await prisma.accountings.findUnique({
        where: { id },
        include: {
          type_payments: { select: { id: true, name: true } },
          folios: { select: { id: true, folio_number: true } },
          properties: { select: { id: true, name: true } },
        },
      });

      if (!record || record.deleted_at) {
        notFound(res, 'Accounting record not found');
        return;
      }

      success(res, bigintToNumber(record), 'Success');
    } catch (err: any) {
      console.error('Accounting show error:', err);
      error(res, 'Failed to fetch accounting record', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/accounting/{type}/{id}/update
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Accounting record not found'); return; }
      const id = BigInt(idRaw);

      const record = await prisma.accountings.findUnique({
        where: { id },
        include: {
          type_payments: { select: { id: true, name: true } },
          folios: { select: { id: true, folio_number: true } },
          properties: { select: { id: true, name: true } },
        },
      });

      if (!record || record.deleted_at) {
        notFound(res, 'Accounting record not found');
        return;
      }

      success(res, bigintToNumber(record), 'Success', 200, {
        master: {
          status_accounting: [
            { value: 1, label: 'Processed' },
            { value: 2, label: 'Pending' },
            { value: 3, label: 'Cancelled' },
          ],
        },
      });
    } catch (err: any) {
      console.error('Accounting edit error:', err);
      error(res, 'Failed to fetch accounting record', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /cms/accounting/{type}/{id}
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Accounting record not found'); return; }
      const id = BigInt(idRaw);

      const record = await prisma.accountings.findUnique({ where: { id } });
      if (!record || record.deleted_at) {
        notFound(res, 'Accounting record not found');
        return;
      }

      if (record.status_accounting === 1 || record.status_accounting === 3) {
        badRequest(res, 'Data has been Processed or canceled');
        return;
      }

      const { date, company_profile_id, description, amount, source, type_payment_id, group } = req.body;

      if (!date || !company_profile_id || amount === undefined) {
        badRequest(res, 'date, company_profile_id, and amount are required');
        return;
      }

      const mappedType = group ? (TYPE_MAP[group] || null) : record.type_accounting;
      let finalAmount = Number(amount);
      if (group === 'credit-note' && finalAmount > 0) finalAmount *= -1;
      if (group === 'payment' && finalAmount > 0) finalAmount *= -1;
      if (group === 'debit-note' && finalAmount < 0) finalAmount *= -1;
      if (group === 'refund' && finalAmount < 0) finalAmount *= -1;

      const companyId = typeof company_profile_id === 'object' && company_profile_id !== null
        ? company_profile_id.value
        : company_profile_id;

      const updated = await prisma.accountings.update({
        where: { id },
        data: {
          type_accounting: mappedType ?? undefined,
          doc_date: new Date(date),
          amount: finalAmount,
          source: source ?? undefined,
          type_payment_id: type_payment_id !== undefined ? BigInt(type_payment_id) : undefined,
          description: description ?? undefined,
          company_profile_id: companyId !== undefined ? BigInt(companyId) : undefined,
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Accounting update error:', err);
      error(res, 'Failed to update accounting record', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /cms/accounting/{type}
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id;
      const mappedType = resolveType(req);
      if (!mappedType) {
        badRequest(res, 'Invalid accounting type');
        return;
      }

      const {
        number_note, type, date, doc_date, code, type_payment_id,
        transaction_id, code_item_id, company_profile_id,
        description, amount, total, pb1, svr_chrg, surcharge, tax3,
        closing, overwrite_reason, time, bill_to, model_type, model_id,
        void_code, reference, source, pos, receipt, card_name,
        last_digit_card, remark, voucher, booking, folio_id,
        is_posting, is_endshift, is_void, is_transfer, is_consolidate,
        is_split, is_has_inclusive, status, status_accounting,
      } = req.body;

      const data: any = {
        property_id: pid,
        type_accounting: mappedType,
        created_at: new Date(),
        updated_at: new Date(),
      };

      if (userId) data.created_by = userId;
      if (number_note !== undefined) data.number_note = number_note;
      if (type !== undefined) data.type = type;
      if (date !== undefined) data.date = new Date(date);
      if (doc_date !== undefined) data.doc_date = new Date(doc_date);
      if (code !== undefined) data.code = code;
      if (type_payment_id !== undefined) data.type_payment_id = BigInt(type_payment_id);
      if (transaction_id !== undefined) data.transaction_id = BigInt(transaction_id);
      if (code_item_id !== undefined) data.code_item_id = BigInt(code_item_id);
      if (company_profile_id !== undefined) data.company_profile_id = BigInt(company_profile_id);
      if (description !== undefined) data.description = description;
      if (amount !== undefined) data.amount = amount;
      if (total !== undefined) data.total = total;
      if (pb1 !== undefined) data.pb1 = pb1;
      if (svr_chrg !== undefined) data.svr_chrg = svr_chrg;
      if (surcharge !== undefined) data.surcharge = surcharge;
      if (tax3 !== undefined) data.tax3 = tax3;
      if (closing !== undefined) data.closing = closing;
      if (overwrite_reason !== undefined) data.overwrite_reason = overwrite_reason;
      if (time !== undefined) data.time = new Date(time);
      if (bill_to !== undefined) data.bill_to = bill_to;
      if (model_type !== undefined) data.model_type = model_type;
      if (model_id !== undefined) data.model_id = BigInt(model_id);
      if (void_code !== undefined) data.void_code = void_code;
      if (reference !== undefined) data.reference = reference;
      if (source !== undefined) data.source = source;
      if (pos !== undefined) data.pos = pos;
      if (receipt !== undefined) data.receipt = receipt;
      if (card_name !== undefined) data.card_name = card_name;
      if (last_digit_card !== undefined) data.last_digit_card = last_digit_card;
      if (remark !== undefined) data.remark = remark;
      if (voucher !== undefined) data.voucher = voucher;
      if (booking !== undefined) data.booking = booking;
      if (folio_id !== undefined) data.folio_id = BigInt(folio_id);
      if (is_posting !== undefined) data.is_posting = Number(is_posting);
      if (is_endshift !== undefined) data.is_endshift = Number(is_endshift);
      if (is_void !== undefined) data.is_void = Number(is_void);
      if (is_transfer !== undefined) data.is_transfer = Number(is_transfer);
      if (is_consolidate !== undefined) data.is_consolidate = Number(is_consolidate);
      if (is_split !== undefined) data.is_split = Number(is_split);
      if (is_has_inclusive !== undefined) data.is_has_inclusive = Number(is_has_inclusive);
      if (status !== undefined) data.status = Number(status);
      if (status_accounting !== undefined) data.status_accounting = Number(status_accounting);

      if (!data.date) data.date = new Date();
      if (!data.doc_date) data.doc_date = new Date();

      const record = await prisma.accountings.create({ data });

      const created = await prisma.accountings.findUnique({
        where: { id: record.id },
        include: {
          type_payments: { select: { id: true, name: true } },
          folios: { select: { id: true, folio_number: true } },
        },
      });

      success(res, bigintToNumber(created), 'Accounting record created successfully', 201);
    } catch (err: any) {
      console.error('Accounting store error:', err);
      error(res, 'Failed to create accounting record', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/allocation-accounting
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async allocationList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null };

      const [records, total] = await Promise.all([
        prisma.allocation_accountings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.allocation_accountings.count({ where }),
      ]);

      const formatted = records.map((r: any) => ({
        ...r,
        id: Number(r.id),
        property_id: Number(r.property_id),
        accounting_id: Number(r.accounting_id),
        allocated: Number(r.allocated),
        amount: Number(r.amount),
      }));

      success(res, formatted, 'Success', 200, {
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
      console.error('Allocation list error:', err);
      error(res, 'Failed to fetch allocations', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /cms/allocation-accounting/store
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async allocationStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id;
      const { accounting_id, allocated, amount, date, unique } = req.body;

      if (!accounting_id) {
        badRequest(res, 'accounting_id is required');
        return;
      }

      const data: any = {
        property_id: pid,
        accounting_id: BigInt(accounting_id),
        allocated: allocated ?? 0,
        amount: amount ?? 0,
        date: date ? new Date(date) : new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      if (unique !== undefined) data.unique = unique;
      if (userId) data.created_by = userId;

      const record = await prisma.allocation_accountings.create({ data });

      success(res, bigintToNumber(record), 'Allocation created successfully', 201);
    } catch (err: any) {
      console.error('Allocation store error:', err);
      error(res, 'Failed to create allocation', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/allocation-accounting/get-doc
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async allocationGetDoc(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const typeFilter = req.query.type_accounting as string | undefined;

      const where: any = {
        property_id: pid,
        deleted_at: null,
      };

      if (typeFilter) where.type_accounting = typeFilter;

      const records = await prisma.accountings.findMany({
        where,
        orderBy: { id: 'desc' },
        select: {
          id: true,
          number_note: true,
          total: true,
        },
      });

      const formatted = records.map((r: any) => ({
        id: Number(r.id),
        number_note: r.number_note,
        total: Number(r.total),
      }));

      success(res, formatted, 'Success');
    } catch (err: any) {
      console.error('Allocation get-doc error:', err);
      error(res, 'Failed to fetch documents', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/allocation-history
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async allocationHistory(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null };

      const [records, total] = await Promise.all([
        prisma.allocation_accountings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.allocation_accountings.count({ where }),
      ]);

      const formatted = records.map((r: any) => ({
        ...r,
        id: Number(r.id),
        property_id: Number(r.property_id),
        accounting_id: Number(r.accounting_id),
        allocated: Number(r.allocated),
        amount: Number(r.amount),
      }));

      success(res, formatted, 'Success', 200, {
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
      console.error('Allocation history error:', err);
      error(res, 'Failed to fetch allocation history', 500);
    }
  }
}

