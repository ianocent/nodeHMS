import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { success, error, badRequest, notFound } from '../utils/response';


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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

export class PosController {
  /**
   * POS Transaction list — matches PHP TransactionController@posTransaction (:174-331)
   * Filters: (source='pos' OR folio.is_pos_trx=1) AND is_pos_deposit=0
   */
  static async listTransactions(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || '';
      const searchField = req.query.search_field as string;
      const searchValue = req.query.search_value as string;

      // PHP: where('source','pos')->orWhereHas('folio', fn => is_pos_trx=1), AND is_pos_deposit=0
      const baseWhere: any = {
        property_id: pid,
        deleted_at: null,
        is_pos_deposit: 0,
        OR: [
          { source: 'pos' },
          { folios: { is: { is_pos_trx: true } } },
        ],
      };

      // Search on description + receipt (PHP search scope)
      if (search) {
        baseWhere.AND = [
          {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              { receipt: { contains: search, mode: 'insensitive' } },
            ],
          },
        ];
      }

      // search_field / search_value support
      if (searchField && searchValue) {
        if (!baseWhere.AND) baseWhere.AND = [];
        baseWhere.AND.push({ [searchField]: { contains: searchValue, mode: 'insensitive' } });
      }

      const [rawData, total] = await Promise.all([
        prisma.transactions.findMany({
          where: baseWhere,
          include: {
            folios: { select: { id: true, folio_number: true, is_pos_trx: true } },
            type_payments: { select: { id: true, name: true } },
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.transactions.count({ where: baseWhere }),
      ]);

      // Calculate total amount (PHP line 218-233: SUM with PLUS/MINUS logic)
      const totalAmountResult = await prisma.$queryRaw<any[]>`
        SELECT COALESCE(SUM(
          CASE
            WHEN type_amount = 'PLUS' THEN (amount + pb1 + svr_chrg + surcharge + tax3)
            WHEN type_amount = 'MINUS' THEN (amount + pb1 + svr_chrg + surcharge + tax3) * -1
            ELSE 0
          END
        ), 0) AS total_amount
        FROM transactions
        WHERE property_id = ${pid}
          AND is_pos_deposit = 0
          AND deleted_at IS NULL
          AND (source = 'pos' OR folio_id IN (SELECT id FROM folios WHERE is_pos_trx = true AND property_id = ${pid}))
      `;
      const totalAmountValue = totalAmountResult?.[0]?.total_amount ?? 0;

      // Get business date
      let bussinesDate = '';
      try {
        const logAudit = await prisma.log_audits.findFirst({
          where: { property_id: Number(pid) },
          orderBy: { id: 'desc' },
          select: { date: true },
        });
        if (logAudit?.date) {
          const d = logAudit.date instanceof Date ? logAudit.date : new Date(logAudit.date as any);
          bussinesDate = d.toISOString().slice(0, 10);
        }
      } catch { /* ignore */ }

      // Format data — PHP Transaction::formatData() (:634-708)
      const data = rawData.map((trx: any) => {
        const amount = Number(trx.amount ?? 0);
        const pb1 = Number(trx.pb1 ?? 0);
        const svrChrg = Number(trx.svr_chrg ?? 0);
        const surcharge = Number(trx.surcharge ?? 0);
        const tax3 = Number(trx.tax3 ?? 0);
        const totalVal = trx.type_amount === 'MINUS'
          ? (amount + pb1 + svrChrg + surcharge + tax3) * -1
          : (amount + pb1 + svrChrg + surcharge + tax3);

        return {
          id: Number(trx.id),
          date: trx.date,
          folio_id: trx.folio_id ? Number(trx.folio_id) : '',
          folio_number: trx.folios?.folio_number ?? '',
          type: trx.type ?? '',
          code: trx.code ?? '',
          card_name: trx.card_name ?? '',
          last_digit_card: trx.last_digit_card ?? '',
          voucher: trx.voucher ?? '',
          description: trx.description ?? '',
          total: totalVal,
          rate: amount,
          pb1,
          svr_chrg: svrChrg,
          surcharge,
          tax3,
          remark: trx.remark ?? trx.overwrite_reason ?? '',
          staff: trx.created_by ? 'POS' : 'SYSTEM',
          time: trx.created_at,
          bill_to: `(${trx.receipt ?? ''})`,
          reference: trx.reference ?? '',
          pos: trx.pos ?? '',
          receipt: `(${trx.receipt ?? ''})`,
          balance: '*****',
          closingFormat: '',
          created_at: trx.created_at,
          created_by: trx.created_by ? Number(trx.created_by) : '',
          is_void: !!trx.is_void,
          is_transfer: !!trx.is_transfer,
          is_consolidate: !!trx.is_consolidate,
          is_split: !!trx.is_split,
          status: trx.status ?? 0,
          is_view: true,
          is_edit: false,
          is_need_approval: false,
        };
      });

      // Prepend balance summary rows (PHP line 237-306)
      const summaryRows = [
        {
          id: 0, date: bussinesDate, folio_id: '', folio_number: '', type: '',
          code: 'BALANCE', card_name: '', last_digit_card: '', voucher: '',
          description: '', total: Number(totalAmountValue), rate: '',
          pb1: '', svr_chrg: '', surcharge: '', tax3: '', remark: '',
          staff: '', time: '', bill_to: '', reference: '', pos: '',
          receipt: '', balance: '', closingFormat: '', created_at: '',
          created_by: '', is_void: '', is_transfer: '', is_consolidate: '',
          is_split: '', status: '', is_view: '', is_edit: '', is_need_approval: '',
        },
        {
          id: 0, date: '', folio_id: '', folio_number: '', type: '',
          code: '', card_name: '', last_digit_card: '', voucher: '',
          description: '', total: '', rate: '',
          pb1: '', svr_chrg: '', surcharge: '', tax3: '', remark: '',
          staff: '', time: '', bill_to: '', reference: '', pos: '',
          receipt: '', balance: '', closingFormat: '', created_at: '',
          created_by: '', is_void: '', is_transfer: '', is_consolidate: '',
          is_split: '', status: '', is_view: '', is_edit: '', is_need_approval: '',
        },
      ];

      const finalData = [...summaryRows, ...bigintToNumber(data)];

      // Table definition — PHP Transaction::formatTable() (:711-820) with POS overrides (:308-320)
      const table = [
        { label: 'Date', key: 'date', type: 'text', is_search: false },
        { label: 'Code', key: 'code', type: 'text', is_search: false },
        { label: 'Card Name', key: 'card_name', type: 'text', is_search: false },
        { label: 'Card Number', key: 'last_digit_card', type: 'text', is_search: false },
        { label: 'Voucher', key: 'voucher', type: 'text', is_search: false },
        { label: 'Description', key: 'description', type: 'text', is_search: false },
        { label: 'Total', key: 'total', type: 'number', is_search: false },
        { label: 'Rate', key: 'rate', type: 'number', is_search: false },
        { label: 'PB1', key: 'pb1', type: 'number', is_search: false },
        { label: 'Svr Chrg', key: 'svr_chrg', type: 'number', is_search: false },
        { label: 'Surcharge', key: 'surcharge', type: 'number', is_search: false },
        { label: 'Overwrite Reason', key: 'remark', type: 'text', is_search: false },
        { label: 'Staff', key: 'staff', type: 'text', is_search: false },
        { label: 'Overwrite Time', key: 'time', type: 'text', is_search: false },
        // PHP overrides bill_to -> receipt for POS (:313-317)
        { label: 'Bill No.', key: 'receipt', type: 'text', is_search: true },
        { label: 'Reference', key: 'reference', type: 'text', is_search: false },
      ];

      success(res, finalData, 'Success', 200, {
        table,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total },
        permission: { view: 1, edit: 0, delete: 0 },
      } as any);
    } catch (err: any) {
      console.error('POS transaction list error:', err);
      error(res, 'Failed to fetch POS transactions', 500);
    }
  }

  static async listMatrixSales(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = {
        property_id: pid,
        deleted_at: null,
      };

      const [data, total] = await Promise.all([
        prisma.pos_matrix_sales.findMany({
          where,
          include: {
            code_posts: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.pos_matrix_sales.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      console.error('POS matrix sales list error:', err);
      error(res, 'Failed to fetch POS matrix sales', 500);
    }
  }
}
