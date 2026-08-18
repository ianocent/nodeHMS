import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { moneyFormat, calculateCodePost } from '../utils/cmsConfig';
import { encrypt } from '../utils/encryption';
import { badRequest, error, notFound, success } from '../utils/response';
import { crudPermission, laravelPaging, postCodeBudgetTable, setupTable } from '../utils/tableMeta';
import { AuthController } from './auth.controller';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { getColorReservation, getColorMaid, getColorRoom, STATUS_RESERVATION_MAP, ROOM_STATUSES, MAID_STATUSES } from '../utils/cmsStatus';

// Laravel storage/app/public parity — files served at /storage/{path}
const STORAGE_DIR = path.join(process.cwd(), 'storage');

// Multipart fields arrive as raw strings — normalize "null"/"undefined"/"" → null (requestParser runs before multer)
function normalizeStr(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' || t === 'null' || t === 'undefined') return null;
    return t;
  }
  return v;
}

// Laravel HasTypes::syncTypes parity for area/template-floor-plan (Type<->Type via model_has_types)
async function syncAreaTypes(typeId: bigint, building: any, floor: any): Promise<void> {
  const prisma = getPrisma();
  const bfTypes = await prisma.types.findMany({
    where: { OR: [{ group: 'building' }, { group: 'floor' }] },
    select: { id: true },
  });
  if (bfTypes.length) {
    await prisma.model_has_types.deleteMany({
      where: { model_type: 'App\\Models\\Type', model_id: typeId, type_id: { in: bfTypes.map(t => t.id) } },
    });
  }
  const ids = [building, floor].filter(v => v !== undefined && v !== null && v !== '');
  for (const v of ids) {
    await prisma.model_has_types.create({
      data: { model_type: 'App\\Models\\Type', model_id: typeId, type_id: BigInt(v) },
    });
  }
}

// Laravel LogController@index table parity (Security Audit / Report Permission screens)
const LOG_TABLE = [
  { label: 'Datetime', key: 'created_at', type: 'datetime', is_search: false },
  { label: 'Staff', key: 'causer', type: 'none', is_search: false },
  { label: 'type', key: 'type', type: 'none', is_search: false },
  { label: 'Module', key: 'subject_type', type: 'select', is_search: true },
  { label: 'Activity', key: 'description', is_html: true, type: 'none', is_search: false },
];

// Laravel NightAuditController@roomChange/noShow/overStay table parity
const NIGHT_AUDIT_TABLE = [
  { label: 'Folio No', key: 'folio_number', type: 'text', is_search: false },
  { label: 'Name', key: 'formated_guest_profile', type: 'text', is_search: false },
  { label: 'Check In', key: 'check_in_date', type: 'date', is_search: false },
  { label: 'Check Out', key: 'check_out_date', type: 'date', is_search: false },
];

// Laravel Folio::formatTableOnline parity (NotificationController@index)
const NOTIFICATION_TABLE = [
  { label: 'Type', key: 'type_reservation', type: 'text', is_search: false },
  { label: 'Status', key: 'status_reservation_color_custom', type: 'label', is_html: true, is_search: false },
  { label: 'Folio No.', key: 'folio_number', type: 'text', is_html: true, is_search: true },
  { label: 'Pre Check In', key: 'date_arrival', type: 'text', is_search: true },
  { label: 'Guest Name', key: 'guest_name', type: 'text', is_search: false },
  { label: 'Group Name/Company', key: 'company', type: 'text', is_search: false },
  { label: 'Room Type', key: 'room_type', type: 'text', is_search: false },
  { label: 'Room', key: 'room', type: 'text', is_search: true },
  { label: 'Room Status', key: 'room_status_color_custom', type: 'text', is_html: true, is_search: false },
  { label: 'Clean Status', key: 'room_clean_status_color_custom', type: 'text', is_html: true, is_search: false },
  { label: 'Check In', key: 'check_in_date', type: 'date', is_search: true },
  { label: 'Check out', key: 'check_out_date', type: 'date', is_search: true },
];

// GlobalResources row parity: formatData() + no
async function formatNightAuditFolios(data: any[]): Promise<any[]> {
  const guestIds = Array.from(new Set(data.map((f) => f.guest_profile_id).filter((v) => v !== null && v !== undefined))) as bigint[];
  const guests = guestIds.length > 0
    ? await getPrisma().guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, account: true } })
    : [];
  const guestMap = new Map(guests.map((g) => [g.id, g]));
  const fmt = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '');
  return data.map((f, idx) => {
    const gp = f.guest_profile_id !== null && f.guest_profile_id !== undefined ? guestMap.get(f.guest_profile_id) : null;
    return {
      id: Number(f.id),
      folio_number: f.folio_number,
      formated_guest_profile: gp ? `${gp.account ?? ''}, ${f.first_name ?? ''} ${f.last_name ?? ''}`.trim() : '',
      check_in_date: fmt(f.check_in_date),
      check_out_date: fmt(f.check_out_date),
      no: idx + 1,
    };
  });
}

// Laravel SystemBalance::storeBalance parity — rebuilds system_balances rows for the night audit date
async function storeSystemBalance(dateObj: Date, prevObj: Date, propertyId: number): Promise<void> {
  const prisma = getPrisma();
  const nextObj = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);
  const dayRange: any = { gte: dateObj, lt: nextObj };
  const prevRange: any = { gte: prevObj, lt: dateObj };
  const propertyBig = BigInt(propertyId);

  await prisma.system_balances.deleteMany({ where: { date: dayRange, property_id: propertyBig } });

  const tbs = await prisma.transaction_breakdowns.findMany({
    where: { property_id: propertyBig, date: dayRange, is_posting: 1, deleted_at: null },
    include: { type_payments: true },
  });

  // payment (type payment/paidout/refund grouped by type_payment_id)
  const paymentTbs = tbs.filter((t) => ['payment', 'paidout', 'refund'].includes(String(t.type)));
  const paymentRows: any[] = [];
  for (const tpId of [...new Set(paymentTbs.map((t) => Number(t.type_payment_id)).filter((x) => x > 0))]) {
    const items = paymentTbs.filter((t) => Number(t.type_payment_id) === tpId);
    const debit = items.filter((t) => t.type_amount === 'MINUS').reduce((s, t) => s + Number(t.amount), 0) * -1;
    const credit = items.filter((t) => t.type_amount === 'PLUS').reduce((s, t) => s + Number(t.amount), 0);
    const tp = items[0]?.type_payments;
    const sum = debit + credit;
    paymentRows.push({
      code_id: BigInt(tpId),
      date: dateObj,
      property_id: propertyBig,
      type: 'payment',
      name: tp?.name ?? '',
      debit: sum > 0 ? 0 : sum,
      credit: sum > 0 ? sum : 0,
    });
  }
  if (paymentRows.length > 0) await prisma.system_balances.createMany({ data: paymentRows });

  // posting (all other types grouped by code = code_post id)
  const postingTbs = tbs.filter((t) => !['payment', 'paidout', 'refund'].includes(String(t.type)));
  const postingRows: any[] = [];
  for (const codeStr of [...new Set(postingTbs.map((t) => String(t.code)).filter(Boolean))]) {
    const items = postingTbs.filter((t) => String(t.code) === codeStr);
    const debit = items.filter((t) => t.type_amount === 'MINUS').reduce((s, t) => s + Number(t.amount), 0) * -1;
    const credit = items.filter((t) => t.type_amount === 'PLUS').reduce((s, t) => s + Number(t.amount), 0);
    const codePost = await prisma.code_posts.findUnique({ where: { id: BigInt(codeStr) } });
    const sum = debit + credit;
    postingRows.push({
      code_id: BigInt(codeStr),
      date: dateObj,
      property_id: propertyBig,
      type: 'posting',
      name: codePost?.name ?? '',
      debit: sum > 0 ? 0 : sum,
      credit: sum > 0 ? sum : 0,
    });
  }
  if (postingRows.length > 0) await prisma.system_balances.createMany({ data: postingRows });

  // tax (PB1 / Service Charge / Tax 3 / Surcharge aggregates)
  const taxItems = tbs.map((t) => ({
    pb1: Number(t.pb1),
    svr: Number(t.svr_chrg),
    sur: Number(t.surcharge),
    tax3: Number(t.tax3),
    typeAmount: String(t.type_amount),
  }));
  const taxRows: any[] = [];
  const taxPicks: Array<[string, (i: any) => number]> = [
    ['PB1', (i) => i.pb1],
    ['Service Charge', (i) => i.svr],
    ['Tax 3', (i) => i.tax3],
    ['Surcharge', (i) => i.sur],
  ];
  for (const [label, pick] of taxPicks) {
    const debit = taxItems.filter((i) => i.typeAmount === 'MINUS').reduce((s, i) => s + pick(i), 0) * -1;
    const credit = taxItems.filter((i) => i.typeAmount === 'PLUS').reduce((s, i) => s + pick(i), 0);
    const sum = debit + credit;
    taxRows.push({ date: dateObj, property_id: propertyBig, type: 'tax', name: label, debit: sum > 0 ? 0 : sum, credit: sum > 0 ? sum : 0 });
  }
  if (taxRows.length > 0) await prisma.system_balances.createMany({ data: taxRows });

  // deposit (reservation folios or future check-in, all dates <= audit date)
  const depositTbs = await prisma.transaction_breakdowns.findMany({
    where: {
      property_id: propertyBig,
      is_posting: 1,
      deleted_at: null,
      date: { lte: dateObj },
      folios: { is: { OR: [{ status_reservation: 3 }, { check_in_date: { gt: dateObj } }] } },
    },
  });
  const yesterdayDeposit = await prisma.system_balances.findMany({
    where: { date: prevRange, property_id: propertyBig, name: 'Advance Deposit Current Day', type: 'deposit' },
  });
  let depositAmount = 0;
  for (const t of depositTbs) depositAmount += t.type_amount === 'PLUS' ? Number(t.total) : -Number(t.total);
  depositAmount *= -1;
  const depositRows: any[] = [
    { date: dateObj, property_id: propertyBig, type: 'deposit', name: 'Advance Deposit Current Day', debit: depositAmount > 0 ? 0 : depositAmount, credit: depositAmount > 0 ? depositAmount : 0 },
    {
      date: dateObj,
      property_id: propertyBig,
      type: 'deposit',
      name: 'Advance Deposit Previous Day',
      debit: yesterdayDeposit.reduce((s, y) => s + Number(y.credit), 0) * -1,
      credit: yesterdayDeposit.reduce((s, y) => s + Number(y.debit), 0) * -1,
    },
  ];
  if (depositRows.length > 0) await prisma.system_balances.createMany({ data: depositRows });

  // ledger (current day vs previous day guest ledger)
  const yesterdayLedger = await prisma.system_balances.findMany({
    where: { date: prevRange, property_id: propertyBig, name: 'Guest Ledger Current Day', type: 'ledger' },
  });
  const yesterdayMovementTotal = yesterdayLedger.reduce((s, y) => s + Number(y.debit) + Number(y.credit), 0) * -1;
  const ledgerTbs = await prisma.transaction_breakdowns.findMany({
    where: {
      property_id: propertyBig,
      is_posting: 1,
      deleted_at: null,
      date: { lte: dateObj },
      folios: { is: { check_in_date: { lte: dateObj } } },
    },
  });
  let totalAmountValue = 0;
  for (const t of ledgerTbs) {
    const parts = Number(t.amount) + Number(t.pb1) + Number(t.svr_chrg) + Number(t.surcharge) + Number(t.tax3);
    totalAmountValue += t.type_amount === 'PLUS' ? parts : -parts;
  }
  const ledgerRows: any[] = [
    { date: dateObj, property_id: propertyBig, type: 'ledger', name: 'Guest Ledger Current Day', debit: totalAmountValue > 0 ? totalAmountValue * -1 : 0, credit: totalAmountValue > 0 ? 0 : totalAmountValue * -1 },
    { date: dateObj, property_id: propertyBig, type: 'ledger', name: 'Guest Ledger Previous Day', debit: yesterdayMovementTotal > 0 ? 0 : yesterdayMovementTotal, credit: yesterdayMovementTotal > 0 ? yesterdayMovementTotal : 0 },
  ];
  if (ledgerRows.length > 0) await prisma.system_balances.createMany({ data: ledgerRows });
}

// Helper: coerce sort/status to number (matches Laravel int casting)
function num(v: any, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

const systemPool = new Pool({ connectionString: process.env.DATABASE_URL });
const systemAdapter = new PrismaPg(systemPool);
const systemPrisma = new PrismaClient({ adapter: systemAdapter });

function getPrisma() {
  return systemPrisma;
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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

const SYSTEM_BALANCE_TABLE = [
  { label: '', key: 'name', type: 'none', is_html: true, is_search: false },
  { label: 'Debit', key: 'debit', type: 'none', is_html: true, is_search: false },
  { label: 'Credit', key: 'credit', type: 'none', is_html: true, is_search: false },
];

// Laravel HotelCompetitor@formatTable parity (dashboard widget table)
const COMPETITOR_TABLE = [
  { label: 'Name', key: 'master_hotel_competitor_id', type: 'none', options: [], rowspan: 2, is_search: false },
  { label: 'Room Available', key: 'room_available', type: 'number', rowspan: 2, is_search: false },
  { label: 'Room Sold', key: 'room_sold', type: 'number', rowspan: 2, is_search: false },
  { label: 'ROOM OCC(%)', key: 'room_occupancy', type: 'none', rowspan: 2, is_search: false },
  { label: 'ARR', key: 'arr', type: 'number', rowspan: 2, is_search: false },
  { label: 'Room Revenue', key: 'room_revenue', type: 'none', rowspan: 2, is_search: false },
  { label: 'Total Revenue', key: 'total_revenue', type: 'number', rowspan: 2, is_search: false },
  { label: 'RevPAR', key: 'revpar', type: 'none', rowspan: 2, is_search: false },
  { label: 'TRevPAR', key: 'trevpar', type: 'none', rowspan: 2, is_search: false },
  { label: 'SALES CO', key: 'sales_cost', type: 'none', rowspan: 2, is_search: false },
  { label: 'INDEX', type: 'none', colspan: 3, row: 1, is_search: false },
  { label: 'MPI', key: 'mpi', type: 'none', is_search: false, row: 2 },
  { label: 'ARI', key: 'ari', type: 'none', is_search: false, row: 2 },
  { label: 'RGI', key: 'rgi', type: 'none', is_search: false, row: 2 },
];

function toNumber(value: any, fallback = 0): number {
  const num = Number(value ?? fallback);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeSystemBalanceType(rawType?: string): string {
  const normalized = String(rawType ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, '');

  const aliases: Record<string, string> = {
    advance: 'deposit',
    advancedepositmovement: 'deposit',
    guest: 'ledger',
    guestledgermovement: 'ledger',
    payment: 'payment',
    posting: 'posting',
    tax: 'tax',
    deposit: 'deposit',
    ledger: 'ledger',
  };

  return aliases[normalized] ?? normalized;
}

export function formatSystemBalanceData(rows: any[], type: string) {
  const mapped = rows.map((item: any) => ({
    id: type === 'payment' ? Number(item.code_id ?? item.id ?? 0) : 0,
    name: item.name ?? '',
    debit: toNumber(item.debit),
    credit: toNumber(item.credit),
  }));

  const debitTotal = mapped.reduce((sum, row) => sum + row.debit, 0);
  const creditTotal = mapped.reduce((sum, row) => sum + row.credit, 0);

  const total = {
    id: 0,
    name: '<b>Total</b>',
    is_total: true,
    debit: '<b>' + moneyFormat(debitTotal < 0 ? debitTotal * -1 : debitTotal) + '</b>',
    credit: '<b>' + moneyFormat(creditTotal < 0 ? creditTotal * -1 : creditTotal) + '</b>',
  };

  return {
    data: [...mapped, total],
    table: SYSTEM_BALANCE_TABLE,
    pagination: {
      current_page: 1,
      last_page: 1,
      per_page: 99999,
      total: mapped.length + 1,
      from: 1,
      to: mapped.length + 1,
    },
    permission: { view: true, add: false, edit: false, delete: false },
  };
}

export class SystemController {
  static async shiftConfirmationList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: propertyId, deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().shift_postings.findMany({
          where,
          include: {
            room_types: { select: { id: true, name: true } },
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shift_postings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
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
      console.error('Shift confirmation list error:', err);
      error(res, 'Failed to fetch shift confirmation list', 500);
    }
  }

  static async shiftConfirmationSubmit(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const userId = req.query.user_id as string;

      if (!userId) {
        badRequest(res, 'user_id is required');
        return;
      }

      const userIdBig = BigInt(userId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const existingShift = await getPrisma().shifts.findFirst({
        where: {
          user_id: userIdBig,
          property_id: propertyId,
          date: { gte: today, lt: tomorrow },
          deleted_at: null,
        },
      });

      if (existingShift) {
        const updated = await getPrisma().shifts.update({
          where: { id: existingShift.id },
          data: {
            is_posting: true,
            end: new Date(),
            updated_at: new Date(),
          },
        });
        success(res, bigintToNumber(updated), 'Shift updated');
      } else {
        const created = await getPrisma().shifts.create({
          data: {
            property_id: propertyId,
            user_id: userIdBig,
            start: new Date(),
            end: new Date(),
            date: today,
            is_posting: true,
            status: 0,
            created_at: new Date(),
          },
        });
        success(res, bigintToNumber(created), 'Shift created', 201);
      }
    } catch (err: any) {
      console.error('Shift confirmation submit error:', err);
      error(res, 'Failed to submit shift confirmation', 500);
    }
  }

  static async shiftDetail(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: propertyId, deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().shifts.findMany({
          where,
          include: {
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shifts.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
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
      console.error('Shift detail error:', err);
      error(res, 'Failed to fetch shift detail', 500);
    }
  }

  static async nightAuditPost(req: Request, res: Response): Promise<void> {
    try {
      const dateStr = (req.body?.date as string) ?? (req.query.date as string);
      if (!dateStr) { badRequest(res, 'date is required'); return; }
      const dateObj = new Date(`${dateStr}T00:00:00`);
      if (Number.isNaN(dateObj.getTime())) { badRequest(res, 'date must be a valid date'); return; }

      const propertyId = Number(req.user?.lastProperty ?? 0);
      const nextObj = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);
      const prevObj = new Date(dateObj.getTime() - 24 * 60 * 60 * 1000);
      const nextRange = { gte: nextObj, lt: new Date(nextObj.getTime() + 24 * 60 * 60 * 1000) };
      const dayRange: any = { gte: dateObj, lt: nextObj };

      // 1. Open shifts must be closed first (Laravel: Shift where is_posting 0, end null, date=date)
      const openShifts = await getPrisma().shifts.findMany({
        where: { property_id: BigInt(propertyId), date: dayRange, is_posting: false, end: null, deleted_at: null },
        orderBy: { created_at: 'asc' },
      });
      if (openShifts.length > 0) { badRequest(res, 'Please close all shift first'); return; }

      // 2. Unbalanced transactions guard (Laravel groups by code, sums PLUS/MINUS total)
      const unposting = await getPrisma().transactions.findMany({
        where: { property_id: BigInt(propertyId), date: dayRange, is_end_of_day: 0, deleted_at: null },
      });
      if (unposting.length > 0) {
        const byCode = new Map<string, { sum: number; label: string }>();
        for (const t of unposting) {
          const key = String(t.code ?? '');
          const isPlus = ['PLUS', '+'].includes(String(t.type_amount ?? '').toUpperCase());
          const label = String(t.code_name ?? t.type ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
          const g = byCode.get(key) ?? { sum: 0, label };
          g.sum += isPlus ? Number(t.total) : -Number(t.total);
          byCode.set(key, g);
        }
        const debug = [...byCode.entries()].map(([id, g]) => ({ id, sum: Math.round(g.sum * 100) / 100, label: g.label }));
        const unbalanced = debug.filter((d) => Math.abs(d.sum) > 0.001);
        if (unbalanced.length > 0) {
          res.json({ code: 200, status: 'error', details: [...new Set(unbalanced.map((d) => d.label))], debug, count: unbalanced.length });
          return;
        }
        await getPrisma().transactions.updateMany({
          where: { property_id: BigInt(propertyId), date: dayRange, is_end_of_day: 0 },
          data: { is_end_of_day: 1 },
        });
      }

      // 3. Pending room change / no show / over stay guards
      const roomChange = await getPrisma().folios.findMany({
        where: {
          property_id: BigInt(propertyId),
          is_posting: false,
          deleted_at: null,
          reservations: { some: { OR: [{ room_type_id_next: { not: null } }, { room_id_next: { not: null } }] } },
        },
        orderBy: { created_at: 'asc' },
      });
      if (roomChange.length > 0) { badRequest(res, 'Please confirm all room change first'); return; }

      const noShow = await getPrisma().folios.findMany({
        where: {
          property_id: BigInt(propertyId),
          status_reservation: { in: [3, 5] },
          check_in_date: { lte: dateObj },
          is_posting: false,
          deleted_at: null,
        },
        orderBy: { created_at: 'asc' },
      });
      if (noShow.length > 0) { badRequest(res, 'Please confirm all no show first'); return; }

      const overStay = await getPrisma().folios.findMany({
        where: {
          property_id: BigInt(propertyId),
          status_reservation: 0,
          check_out_date: { lte: dateObj },
          is_posting: false,
          deleted_at: null,
        },
        orderBy: { created_at: 'asc' },
      });
      if (overStay.length > 0) { badRequest(res, 'Please confirm all over stay first'); return; }

      // Mark posting (Laravel order: shift, roomChange, noShow, overStay)
      if (openShifts.length > 0) {
        await getPrisma().shifts.updateMany({ where: { id: { in: openShifts.map((s) => s.id) } }, data: { is_posting: true } });
      }
      if (roomChange.length > 0) {
        await getPrisma().folios.updateMany({ where: { id: { in: roomChange.map((f) => f.id) } }, data: { is_posting: true } });
      }
      if (noShow.length > 0) {
        await getPrisma().folios.updateMany({ where: { id: { in: noShow.map((f) => f.id) } }, data: { is_posting: true } });
      }
      if (overStay.length > 0) {
        await getPrisma().folios.updateMany({ where: { id: { in: overStay.map((f) => f.id) } }, data: { is_posting: true } });
      }

      // 4. Room revenue + extra bed per check-in reservation (Laravel getAllReservation)
      const postTrx = async (folio: any, codePostId: number | null, amount: number, type: string) => {
        if (!codePostId) return;
        const codePost = await getPrisma().code_posts.findUnique({ where: { id: BigInt(codePostId) } });
        if (!codePost) return;
        const calc = calculateCodePost(codePost as any, amount, false);
        const ledger = codePost.code_billing_id
          ? await getPrisma().ledgers.findFirst({
              where: { folio_id: Number(folio.id), code_billing_id: codePost.code_billing_id, deleted_at: null },
            })
          : null;
        let profile: any = null;
        let modelType = 'App\Models\CompanyProfile';
        if (ledger?.profileable_type === 'App\Models\GuestProfile') {
          profile = await getPrisma().guest_profiles.findUnique({ where: { id: BigInt(Number(ledger.profileable_id)) } });
          modelType = 'App\Models\GuestProfile';
        } else if (ledger?.profileable_type === 'App\Models\CompanyProfile') {
          profile = await getPrisma().company_profiles.findUnique({ where: { id: BigInt(Number(ledger.profileable_id)) } });
        } else {
          profile = await getPrisma().company_profiles.findUnique({ where: { id: BigInt(Number(folio.company_profile_id)) } });
        }
        const data: any = {
          type,
          folio_id: folio.id,
          date: dateObj,
          code: String(codePost.id),
          amount: calc.amount,
          total: calc.total,
          pb1: calc.pb1,
          svr_chrg: calc.service,
          tax3: calc.tax3,
          type_amount: 'PLUS',
          is_posting: 1,
          is_end_of_day: 1,
          is_endshift: 1,
          status: 1,
          property_id: BigInt(propertyId),
        };
        if (profile) {
          data.model_type = modelType;
          data.model_id = profile.id;
        }
        await getPrisma().transactions.create({ data });
      };

      const reservations = await getPrisma().reservations.findMany({
        where: {
          property_id: BigInt(propertyId),
          date: dayRange,
          is_posting: 0,
          deleted_at: null,
          folios: { is: { status_reservation: 0, is_virtual: false } },
        },
        include: { folios: true, rates: true },
      });

      for (const value of reservations) {
        const folio = value.folios;
        if (value.room_id) {
          const room = await getPrisma().rooms.findUnique({ where: { id: value.room_id } });
          if (room) {
            const upd: any = { maid_status: 1 };
            if (folio.check_out_date && new Date(folio.check_out_date.getTime()).getTime() === nextObj.getTime()) {
              upd.room_status = 2;
            }
            await getPrisma().rooms.update({ where: { id: room.id }, data: upd });
          }
        }
        const nextRes = await getPrisma().reservations.findFirst({
          where: { folio_id: folio.id, date: nextRange },
        });
        if (nextRes && nextRes.room_id !== value.room_id) {
          await getPrisma().reservations.update({
            where: { id: nextRes.id },
            data: {
              room_id_next: nextRes.room_id,
              room_id: nextRes.room_id,
              room_type_id_next: nextRes.room_type_id,
              room_type_id: nextRes.room_type_id,
            },
          });
        }
        if (value.rates?.code_post_id) {
          await postTrx(folio, Number(value.rates.code_post_id), Number(value.total ?? 0), 'room_revenue');
        }
        if (Number(value.total_extra_bed ?? 0) > 0 && value.rates?.code_post_extra_bed_id) {
          await postTrx(folio, Number(value.rates.code_post_extra_bed_id), Number(value.total_extra_bed), 'extra_bed');
        }
        await getPrisma().reservations.updateMany({ where: { id: value.id }, data: { is_posting: 1 } });
      }

      // 5. Additional item per folio inclusive (Laravel model_has_code_items loop — Prisma @@ignore, raw SQL)
      const mhciRows: any[] = await getPrisma().$queryRaw`
        SELECT model_id FROM model_has_code_items WHERE model_type = 'App\Models\Folio'
      `;
      const mhciFolioIds = mhciRows.map((m: any) => BigInt(String(m.model_id)));
      const inclusiveFolios = await getPrisma().folios.findMany({
        where: { property_id: BigInt(propertyId), status_reservation: 0, deleted_at: null, id: { in: mhciFolioIds } },
        orderBy: { created_at: 'asc' },
      });
      for (const folio of inclusiveFolios) {
        const items: any[] = await getPrisma().$queryRaw`
          SELECT * FROM model_has_code_items
          WHERE model_id = ${folio.id} AND model_type = 'App\Models\Folio'
            AND start_date <= ${dateObj} AND end_date >= ${dateObj}
        `;
        if (items.length === 0) continue;
        for (const item of items) {
          const codeItemId = Number(item.code_item_id);
          if (!codeItemId) continue;
          const codeItem = await getPrisma().code_items.findUnique({ where: { id: BigInt(codeItemId) } });
          if (!codeItem?.code_post_id) continue;
          const upsales = Number(item.upsales ?? 0);
          const sales = Number(item.sales ?? 0);
          await postTrx(folio, Number(codeItem.code_post_id), upsales > 0 ? upsales : sales, 'additional_item');
        }
        await getPrisma().$executeRaw`
          UPDATE model_has_code_items SET is_posting = 1
          WHERE model_id = ${folio.id} AND model_type = 'App\Models\Folio'
            AND start_date <= ${dateObj} AND end_date >= ${dateObj}
        `;
      }

      // 6. Room status transitions (vacant→block, block→vacant+dirty, vacant→out of order)
      const availTomorrow = (await getPrisma().room_availabilities.findMany({
        where: { property_id: propertyId, date: nextRange },
      })).map((a) => a.room_id);
      const workOrderRooms = (await getPrisma().work_orders.findMany({
        where: { property_id: BigInt(propertyId), date: nextRange, end_date: null },
      })).map((w) => Number(w.room_id)).filter((x) => x > 0);

      const roomsVacant = await getPrisma().rooms.findMany({ where: { property_id: BigInt(propertyId), room_status: 0, id: { in: availTomorrow } } });
      if (roomsVacant.length > 0) {
        await getPrisma().rooms.updateMany({ where: { id: { in: roomsVacant.map((r) => r.id) } }, data: { room_status: 3 } });
      }

      const roomsBlock = await getPrisma().rooms.findMany({
        where: { property_id: BigInt(propertyId), room_status: 3, NOT: { id: { in: availTomorrow } } },
      });
      if (roomsBlock.length > 0) {
        await getPrisma().rooms.updateMany({ where: { id: { in: roomsBlock.map((r) => r.id) } }, data: { room_status: 0, maid_status: 1 } });
      }

      const roomsOOO = await getPrisma().rooms.findMany({ where: { property_id: BigInt(propertyId), room_status: 0, id: { in: workOrderRooms } } });
      if (roomsOOO.length > 0) {
        await getPrisma().rooms.updateMany({ where: { id: { in: roomsOOO.map((r) => r.id) } }, data: { room_status: 4 } });
      }

      // 7. SystemBalance store (Laravel SystemBalance::storeBalance)
      await storeSystemBalance(dateObj, prevObj, propertyId);

      // 8. LogAudit upsert per property (HasProperties scope parity)
      const existing = await getPrisma().log_audits.findFirst({ where: { date: dateObj, property_id: propertyId } });
      if (existing) {
        await getPrisma().log_audits.update({ where: { id: existing.id }, data: { status: BigInt(1) } });
      } else {
        await getPrisma().log_audits.create({ data: { date: dateObj, property_id: propertyId, status: BigInt(1) } });
      }

      success(res, { bussinesDate: dateStr, name: req.user?.name ?? '', image: '' }, 'Success');
    } catch (err: any) {
      console.error('Night audit post error:', err);
      error(res, 'Failed to post night audit', 500);
    }
  }

  static async checkValue(req: Request, res: Response): Promise<void> {
    try {
      const key = req.query.key as string;
      const value = req.query.value as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      if (!key) {
        badRequest(res, 'key is required');
        return;
      }

      if (key === 'pin_endshift') {
        if (!value) {
          badRequest(res, 'value is required for pin_endshift');
          return;
        }

        const user = await getPrisma().users.findFirst({
          where: {
            id: req.user?.id,
            deleted_at: null,
          },
          select: { id: true, pin_enshift: true },
        });

        if (!user) {
          notFound(res, 'User not found');
          return;
        }

        const pinMatch = user.pin_enshift !== null && user.pin_enshift === parseInt(value);
        if (pinMatch) {
          success(res, { valid: true }, 'PIN valid');
        } else {
          success(res, { valid: false }, 'PIN invalid');
        }
      } else {
        success(res, { valid: true }, 'Check passed');
      }
    } catch (err: any) {
      console.error('Check value error:', err);
      error(res, 'Failed to check value', 500);
    }
  }

  static async systemBalance(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const rawType = Array.isArray(req.params.type) ? req.params.type[0] : (req.params.type ?? '');
      const mappedType = normalizeSystemBalanceType(rawType);
      const date = req.query.date as string;

      if (!['payment', 'posting', 'tax', 'deposit', 'ledger'].includes(mappedType)) {
        badRequest(res, 'Invalid system balance type');
        return;
      }

      const where: any = { property_id: propertyId };
      if (date) {
        const dateObj = new Date(date);
        if (Number.isNaN(dateObj.getTime())) {
          badRequest(res, 'date must be a valid date');
          return;
        }
        const start = new Date(dateObj);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        where.date = { gte: start, lt: end };
      }

      // Cumulative logic (Laravel SystemBalanceController parity):
      // posting = sum(posting) + sum(payment)
      // tax = sum(tax) + sum(posting + payment)
      // deposit = sum(deposit) + sum(payment + posting + tax)
      // ledger = sum(ledger) + sum(payment + posting + tax + deposit)
      const cumulativeTypes: Record<string, string[]> = {
        payment: ['payment'],
        posting: ['posting', 'payment'],
        tax: ['tax', 'posting', 'payment'],
        deposit: ['deposit', 'tax', 'posting', 'payment'],
        ledger: ['ledger', 'deposit', 'tax', 'posting', 'payment'],
      };

      const typesToQuery = cumulativeTypes[mappedType] ?? [mappedType];
      where.type = { in: typesToQuery };

      const rows = await getPrisma().system_balances.findMany({
        where,
        orderBy: { id: 'asc' },
      });

const payload = formatSystemBalanceData(
        rows.map((row: any) => ({
          id: Number(row.code_id ?? 0),
          name: row.name ?? '',
          debit: row.debit ?? 0,
          credit: row.credit ?? 0,
        })),
        mappedType
      );

      success(res, payload.data, 'Success', 200, {
        table: payload.table,
        pagination: payload.pagination,
        permission: payload.permission,
      });
    } catch (err: any) {
      console.error('System balance error:', err);
      error(res, 'Failed to fetch system balance', 500);
    }
  }

  static async getListByIdPost(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const rawType = Array.isArray(req.params.type) ? req.params.type[0] : (req.params.type ?? req.query.type ?? '');
      const mappedType = normalizeSystemBalanceType(rawType);
      const id = (req.params.id ?? req.query.id as string ?? '').toString();
      const date = req.query.date as string;

      if (!id) {
        badRequest(res, 'id is required');
        return;
      }

      if (!date) {
        badRequest(res, 'date is required');
        return;
      }

      const dateObj = new Date(date);
      if (Number.isNaN(dateObj.getTime())) {
        badRequest(res, 'date must be a valid date');
        return;
      }

      const start = new Date(dateObj);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const where: any = {
        property_id: propertyId,
        date: { gte: start, lt: end },
      };

      if (mappedType === 'payment') {
        where.type_payment_id = BigInt(id);
      } else {
        where.code = String(id);
      }

      const rows = await getPrisma().transaction_breakdowns.findMany({
        where,
        orderBy: { created_at: 'desc' },
      });

      const mapped = rows.map((row: any) => ({
        id: Number(row.id ?? 0),
        name: `${row.folios?.folio_number ?? ''} ( ${String(row.type ?? '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())} )${row.is_transfer === 1 || row.is_transfer === 2 ? ` (${row.remark ?? ''})` : ''}`.trim(),
        debit: row.type_amount === 'MINUS' ? toNumber(row.amount) : 0,
        credit: row.type_amount === 'PLUS' ? toNumber(row.amount) : 0,
      }));

      const payload = formatSystemBalanceData(mapped, mappedType || 'payment');
      success(res, payload.data, 'Success', 200, {
        table: payload.table,
        pagination: payload.pagination,
        permission: payload.permission,
      });
    } catch (err: any) {
      console.error('System balance detail error:', err);
      error(res, 'Failed to fetch system balance detail', 500);
    }
  }

  static async logList(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limitRaw = parseInt(req.query.limit as string) || 10;
      const limit = limitRaw > 0 ? Math.min(limitRaw, 50) : 10;
      const search = (req.query.search as string) || '';
      const searchField = (req.query.search_field as string) || '';
      const searchValue = (req.query.search_value as string) || '';
      const module = req.query.module as string;
      const idRaw = (req.query.id as string) || (req.query.data as string);
      const dateStr = req.query.date as string;
      const sort = (req.query.sort as string) || '';
      const propertyId = req.user?.lastProperty ? Number(req.user.lastProperty) : null;

      // Laravel: subject_type search_field → module headline; else module param
      let subjectType: string | undefined;
      let searchValueModule = '';
      if (searchField && searchField.includes('subject_type') && searchValue) {
        searchValueModule = searchValue.replace(/;/g, '').split('\\').pop() ?? '';
      }
      const moduleName = module || searchValueModule;
      if (moduleName) {
        const headline = String(moduleName).split('\\').pop() ?? '';
        const pascal = headline.replace(/([A-Z])/g, (m, p) => (headline.indexOf(m) === 0 ? m : ' ' + m)).split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
        subjectType = 'App\\Models\\' + (pascal || headline);
      }

      const where: any = {};
      if (subjectType) where.subject_type = subjectType;
      if (idRaw && idRaw !== 'null' && idRaw !== 'undefined') where.subject_id = BigInt(idRaw);
      if (dateStr) {
        where.created_at = { gte: new Date(dateStr + 'T00:00:00.000Z'), lte: new Date(dateStr + 'T23:59:59.999Z') };
      }
      if (search) {
        const nameUsers = await getPrisma().users.findMany({ where: { name: { contains: search, mode: 'insensitive' } }, select: { id: true } });
        const nameIds = nameUsers.map((u) => u.id);
        where.OR = [
          { subject_type: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { properties: { contains: search, mode: 'insensitive' } },
          ...(nameIds.length ? [{ causer_id: { in: nameIds } }] : []),
        ];
      }
      if (searchField && searchValue && searchField !== 'subject_type') {
        where[searchField] = { contains: searchValue, mode: 'insensitive' };
      }

      let orderBy: any = { created_at: 'desc' };
      if (sort === 'id') orderBy = { id: 'asc' };
      else if (sort === '-id') orderBy = { id: 'desc' };
      else if (sort === 'created_at') orderBy = { created_at: 'asc' };
      else if (sort === '-created_at') orderBy = { created_at: 'desc' };

      const [data, total] = await Promise.all([
        getPrisma().logs.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
        getPrisma().logs.count({ where }),
      ]);

      // causer names (Laravel ->with('causer'))
      const causerIds = Array.from(new Set(data.map((l) => l.causer_id).filter((v) => v !== null && v !== undefined))) as bigint[];
      const causers = causerIds.length > 0
        ? await getPrisma().users.findMany({ where: { id: { in: causerIds } }, select: { id: true, name: true } })
        : [];
      const causerMap = new Map(causers.map((u) => [u.id, u.name ?? 'System']));

      // company names from properties (Laravel extractCompanyIds)
      const companyIds = new Set<number>();
      const parseProps = (raw: string | null): { attributes?: any; old?: any } => {
        try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
      };
      for (const log of data) {
        const props = parseProps(log.properties);
        for (const src of [props.attributes ?? {}, props.old ?? {}]) {
          if (src && typeof src === 'object') {
            if (src.company_id && Number.isFinite(Number(src.company_id))) companyIds.add(Number(src.company_id));
            if (src.data && typeof src.data === 'object' && src.data.company_id && Number.isFinite(Number(src.data.company_id))) companyIds.add(Number(src.data.company_id));
          }
        }
      }
      const companies = companyIds.size > 0
        ? await getPrisma().company_profiles.findMany({ where: { id: { in: [...companyIds] as any } }, select: { id: true, name: true } })
        : [];
      const companyMap = new Map(companies.map((c) => [Number(c.id), c.name ?? '']));

      const EXCLUDE = ['id', 'updated_by', 'updated_at', 'created_by', 'created_at', 'deleted_by', 'deleted_at', 'property_id'];
      const isKosong = (v: any): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && v.trim() === '') || String(v) === '→';

      const hasRealChanges = (log: any): boolean => {
        const props = parseProps(log.properties);
        const attrs = props.attributes ?? {};
        const old = props.old ?? {};
        for (const key of Object.keys(attrs)) {
          if (EXCLUDE.includes(key)) continue;
          if (key === 'data') {
            const oldData = old.data ?? {};
            const newData = attrs[key] ?? {};
            if (newData && typeof newData === 'object') {
              for (const subKey of Object.keys(newData)) {
                if (JSON.stringify(newData[subKey]) !== JSON.stringify(oldData[subKey])) return true;
              }
            }
            continue;
          }
          const oldValue = old[key] ?? null;
          if (isKosong(attrs[key]) && isKosong(oldValue)) continue;
          if (attrs[key] != oldValue) return true;
        }
        return false;
      };

      const pick = (sources: any[], keys: string[]): string => {
        for (const src of sources) {
          for (const key of keys) {
            let val: any = src;
            for (const seg of key.split('.')) {
              if (val && typeof val === 'object' && seg in val) val = val[seg];
              else { val = undefined; break; }
            }
            if (typeof val === 'string' || typeof val === 'number') {
              const s = String(val).trim();
              if (s !== '') return s;
            }
          }
        }
        return '';
      };

      const headline = (t: string | null | undefined): string => {
        const base = String(t ?? '').split('\\').pop() ?? '';
        return base.replace(/([A-Z])/g, ' $1').replace(/^ /, '').replace(/ /g, ' ');
      };

      // Laravel property filter (whereJsonContains properties->attributes/old->property_id) — apply post-fetch (page-scoped)
      const filtered = propertyId
        ? data.filter((log) => {
            const props = parseProps(log.properties);
            const attrs = props.attributes ?? {};
            const old = props.old ?? {};
            return Number(attrs?.property_id) === propertyId || Number(old?.property_id) === propertyId;
          })
        : data;
      const pageData = filtered;

      const rows = pageData
        .filter((log) => hasRealChanges(log))
        .map((log) => {
          const props = parseProps(log.properties);
          const attrs = props.attributes ?? {};
          const old = props.old ?? {};
          const type = String(log.subject_type ?? '').split('\\').pop()?.toLowerCase() ?? '';

          let displayName = `${pick([attrs, old, attrs.data ?? {}], ['guest.first_name', 'profile.first_name', 'customer.first_name', 'first_name'])} ${pick([attrs, old, attrs.data ?? {}], ['guest.last_name', 'profile.last_name', 'customer.last_name', 'last_name'])}`.trim();
          if (displayName === '') {
            displayName = pick([attrs, old, attrs.data ?? {}], ['guest_name', 'profile_name', 'customer_name', 'primary_guest_name', 'full_name', 'display_name', 'name', 'title']);
          }

          let extraInfo = '';
          if (type === 'transaction') {
            const tx = pick([attrs, old], ['trx_number', 'code', 'reference_no', 'number', 'no']);
            if (tx !== '') displayName = tx;
            const guestFull = `${pick([attrs, old], ['guest.first_name'])} ${pick([attrs, old], ['guest.last_name'])}`.trim();
            if (guestFull !== '') extraInfo = guestFull.toUpperCase();
          }

          let companyName = pick([attrs, old, attrs.data ?? {}], ['company_name']);
          if (companyName === '') {
            const cid = pick([attrs, old, attrs.data ?? {}], ['company_id']);
            if (cid !== '' && companyMap.has(Number(cid))) companyName = companyMap.get(Number(cid))!;
          }

          const rightTag = companyName !== '' ? companyName : pick([attrs, old, attrs.data ?? {}], ['profile_type', 'guest_type', 'type', 'source', 'category', 'segment', 'market']).toUpperCase();

          let title = `${String(log.event ?? '').replace(/\b\w/g, (c) => c.toUpperCase())}. ${headline(log.subject_type)}`;
          if (displayName !== '') title += ` ${displayName.toUpperCase()}`;
          if (extraInfo !== '') title += ` (${extraInfo})`;
          if (rightTag !== '') title += ` <span class="text-gray-500 font-normal">• ${rightTag.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</span>`;

          const html = `<div class="flex flex-col-reverse"><div class="grid grid-cols-2 gap-4 p-4 border-b border-gray-200"><div><div class="font-bold">${title}</div></div></div></div>`;

          return {
            id: Number(log.id),
            log_name: log.log_name ?? null,
            batch_uuid: log.batch_uuid ?? null,
            event: log.event ?? null,
            subject_type: { value: log.subject_type, label: headline(log.subject_type) },
            description: html,
            created_at: log.created_at ? new Date(log.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
            causer: log.causer_id !== null && log.causer_id !== undefined ? causerMap.get(log.causer_id) ?? 'System' : 'System',
            type: headline(log.subject_type),
            is_view: false,
            is_edit: false,
            is_need_approval: false,
          };
        });

      const permission = { view: true, add: false, edit: false, delete: false, active: false, approve: false, reject: false };
      success(res, rows, 'Success', 200, {
        table: LOG_TABLE,
        permission,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Log list error:', err);
      error(res, 'Failed to fetch logs', 500);
    }
  }

  // ==================== NOTIFICATION (booking engine, menu 1152) ====================
  // Replicates Laravel NotificationController@index
  static async notificationList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || '';
      const searchField = req.query.search_field as string;
      const searchValue = req.query.search_value as string;

      const where: any = { booking_engine_uuid: { not: null } };
      if (search) {
        where.OR = [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (searchField && searchValue) {
        where[searchField] = { contains: searchValue, mode: 'insensitive' };
      }

      const [data, total] = await Promise.all([
        getPrisma().folios.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            reservations: { include: { room_types: true }, orderBy: { date: 'desc' } },
            company_profiles_folios_company_profile_idTocompany_profiles: { select: { id: true, name: true } },
          },
        }),
        getPrisma().folios.count({ where }),
      ]);

      const guestIds = Array.from(new Set(data.map((f) => f.guest_profile_id).filter((v) => v !== null && v !== undefined))) as bigint[];
      const guests = guestIds.length > 0
        ? await getPrisma().guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, account: true, first_name: true, last_name: true } })
        : [];
      const guestMap = new Map(guests.map((g) => [g.id, g]));

      // balances per folio (Laravel getBalance: ledger sum by type_amount)
      const folioIds = data.map((f) => f.id);
      const trxRows = folioIds.length > 0
        ? await getPrisma().transactions.findMany({ where: { folio_id: { in: folioIds } }, select: { folio_id: true, type_amount: true, total: true } })
        : [];
      const balanceMap = new Map<bigint, number>();
      for (const t of trxRows) {
        if (t.folio_id === null || t.folio_id === undefined) continue;
        const upper = String(t.type_amount ?? '').toUpperCase();
        const sign = upper === 'MINUS' || String(t.type_amount) === '-' ? -1 : 1;
        balanceMap.set(t.folio_id, (balanceMap.get(t.folio_id) ?? 0) + sign * Number(t.total ?? 0));
      }

      const fmtD = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '');
      const statusIdByName = (map: Record<string, { id: number; name: string }>, name: string | null | undefined): number => {
        if (!name) return 0;
        return Object.values(map).find((s) => s.name === name)?.id ?? 0;
      };
      const rows = data.map((folio) => {
        const lastRes = folio.reservations?.[0] ?? null;
        const lastRoomId = lastRes?.room_id ?? null;
        const lastRoomName = lastRes?.room_name ?? '';
        const roomStatusId = statusIdByName(ROOM_STATUSES, lastRes?.room_status_name);
        const maidStatusId = statusIdByName(MAID_STATUSES, lastRes?.maid_status_name);
        const hasRoom = !!lastRoomId && (!!lastRoomName || roomStatusId > 0 || maidStatusId > 0);
        const gp = folio.guest_profile_id !== null && folio.guest_profile_id !== undefined ? guestMap.get(folio.guest_profile_id) : null;
        const isRequestCancel = folio.status_reservation === 3 && !!folio.is_request_cancel;
        const statusLabel = isRequestCancel ? 'Request Cancel' : (STATUS_RESERVATION_MAP[folio.status_reservation ?? 3] ?? 'Reservation');
        const statusColor = isRequestCancel ? 'bg-yellow' : getColorReservation(folio.status_reservation ?? 3);
        const roomStatusLabel = lastRes?.room_status_name ?? '';
        const cleanStatusLabel = lastRes?.maid_status_name ?? '';
        const guestName = gp
          ? ((gp.first_name ?? '') !== '' || (gp.last_name ?? '') !== '' ? `${gp.first_name ?? ''} ${gp.last_name ?? ''}`.trim() : gp.account ?? '')
          : `${folio.first_name ?? ''} ${folio.last_name ?? ''}`.trim();
        const company = (folio.company_name ?? '') !== '' ? folio.company_name : folio.company_profiles_folios_company_profile_idTocompany_profiles?.name ?? '';
        return {
          id: Number(folio.id),
          value: Number(folio.id),
          name: folio.folio_number,
          res_date: folio.res_date ? fmtD(folio.res_date) : '',
          type_reservation: String(folio.type_reservation ?? '').toUpperCase(),
          message_bool: false,
          ign: !!folio.is_incognito,
          remark_bool: !!folio.remark,
          is_do_not_disturb: !!folio.is_do_not_disturb,
          status_reservation_color: [{ label: String(statusLabel).replace(/\s+/g, '-'), color: statusColor, is_color: true }],
          room_clean_status_color: hasRoom ? [{ label: cleanStatusLabel.replace(/\s+/g, '-'), color: getColorMaid(maidStatusId), is_color: true }] : [],
          room_status_color: hasRoom ? [{ label: roomStatusLabel.replace(/\s+/g, '-'), color: getColorRoom(roomStatusId), is_color: true }] : [],
          folio_number: `<a href="/reservation/fit/reservation?parent=63&data=${Number(folio.id)}&group=folio" class="btn btn-primary" style="text-decoration: underline;">${folio.folio_number}</a>`,
          guest_name: guestName,
          guest_status: { value: folio.status_profile, label: folio.status_profile ? String(folio.status_profile) : 'Regular' },
          guest_status_color: [{ label: String(folio.status_profile ?? 'Regular').replace(/\s+/g, '-'), color: ['VIP', 'VVIP', 'VVVIP'].includes(String(folio.status_profile ?? '').toUpperCase()) ? 'bg-yellow' : 'bg-green', is_color: true }],
          date_arrival: folio.date_arrival ? fmtD(folio.date_arrival) : '',
          stay: null,
          room: lastRoomName,
          room_next: null,
          company,
          room_type: lastRes?.room_type_name ?? lastRes?.room_types?.name ?? '',
          check_in_date: fmtD(folio.check_in_date),
          check_out_date: fmtD(folio.check_out_date),
          balance: moneyFormat(balanceMap.get(folio.id) ?? 0),
          sharer: '',
          is_popup_other_guest: false,
          aa: lastRes?.adult ?? null,
          cc: lastRes?.child ?? null,
          actions: [],
          status_reservation_color_custom: `<div class=" "><div class="${statusColor} px-1 py-1 text-white rounded-md mt-1 text-center">${statusLabel}</div> </div>`,
          room_clean_status_color_custom: hasRoom ? `<div class=" "> <div class="${getColorMaid(maidStatusId)} px-1 py-1 text-white rounded-md mt-1 text-center">${cleanStatusLabel}</div> </div>` : '',
          room_status_color_custom: hasRoom ? `<div class=" "> <div class="${getColorRoom(roomStatusId)} px-1 py-1 text-white rounded-md mt-1 text-center">${roomStatusLabel}</div> </div>` : '',
        };
      });

      // Laravel: mark cancelled booking-engine folios as notified
      await getPrisma().folios.updateMany({
        where: { is_notification: false, booking_engine_uuid: { not: null }, status_reservation: 2 },
        data: { is_notification: true },
      });

      success(res, rows, 'Success', 200, {
        table: NOTIFICATION_TABLE,
        permission: getPermissionFlags(req.user, 1152),
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Notification list error:', err);
      error(res, 'Failed to fetch notifications', 500);
    }
  }

  // ==================== SETUP (TypeController@index parity) ====================
  static async setup(req: Request, res: Response): Promise<void> {
    try {
      const group = (req.query.group as string) || '';
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = (req.query.search as string) || '';
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: propertyId, deleted_at: null };
      if (group) where.group = group;
      if (search) where.name = { contains: search, mode: 'insensitive' };

      let orderBy: any = { id: 'desc' };
      if (group === 'guest-title') orderBy = { name: 'asc' };
      if (group === 'room-type-grouping') orderBy = { sort: 'asc' };

      const [data, total] = await Promise.all([
        getPrisma().types.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
        getPrisma().types.count({ where }),
      ]);

      const normal = data.filter(d => /normal/i.test(d.name));
      const rest = data.filter(d => !/normal/i.test(d.name));
      const ordered = [...normal, ...rest];

      // Laravel TypeController@index parity — area/template-floor-plan expose Building+Floor
      let bfOptions: { building: any[]; floor: any[] } = { building: [], floor: [] };
      let mhtMap = new Map<string, bigint[]>();
      if (group === 'area' || group === 'template-floor-plan') {
        // Laravel: options NOT property-scoped
        const bfTypes = await getPrisma().types.findMany({
          where: { deleted_at: null },
          orderBy: { sort: 'asc' },
        });
        bfOptions = {
          building: bfTypes.filter(t => t.group === 'building').map(t => ({ value: Number(t.id), label: t.name })),
          floor: bfTypes.filter(t => t.group === 'floor').map(t => ({ value: Number(t.id), label: t.name })),
        };
        const links = await getPrisma().model_has_types.findMany({
          where: { model_type: 'App\\Models\\Type', model_id: { in: ordered.map(d => d.id) } },
          select: { model_id: true, type_id: true },
        });
        for (const l of links) {
          const key = String(l.model_id);
          if (!mhtMap.has(key)) mhtMap.set(key, []);
          mhtMap.get(key)!.push(l.type_id);
        }
      }

      // Laravel TypeController@index parity — master-report: Group Report + Action options + row links
      let mrOptions: { group_report: any[]; action_report: any[] } = { group_report: [], action_report: [] };
      let mrMap = new Map<string, any[]>();
      if (group === 'master-report') {
        const mrTypes = await getPrisma().types.findMany({ where: { deleted_at: null } });
        mrOptions = {
          group_report: mrTypes.filter(t => t.group === 'group-report').map(t => ({ value: Number(t.id), label: t.name })),
          action_report: mrTypes.filter(t => t.group === 'action-report').map(t => ({ value: Number(t.id), label: t.name })),
        };
        const links = await getPrisma().model_has_types.findMany({
          where: { model_type: 'App\\Models\\Type', model_id: { in: ordered.map(d => d.id) } },
          select: { model_id: true, type_id: true },
        });
        const byId = new Map(mrTypes.map(t => [Number(t.id), t]));
        for (const l of links) {
          const key = String(l.model_id);
          const t = byId.get(Number(l.type_id));
          if (!t) continue;
          if (!mrMap.has(key)) mrMap.set(key, []);
          mrMap.get(key)!.push({ value: Number(t.id), label: t.name, group: t.group });
        }
      }

      const rows = ordered.map((d, i) => {
        const row: any = {
          no: (page - 1) * limit + i + 1,
          id: Number(d.id),
          name: d.name,
          description: d.description,
          image: d.image,
          text: d.text,
          group: d.group,
          sort: d.sort,
          status: d.status,
        };
        if (group === 'area' || group === 'template-floor-plan') {
          const linked = mhtMap.get(String(d.id)) || [];
          row.building = bfOptions.building.find(o => linked.includes(BigInt(o.value))) || {};
          row.floor = bfOptions.floor.find(o => linked.includes(BigInt(o.value))) || {};
        }
        if (group === 'master-report') {
          const linked = mrMap.get(String(d.id)) || [];
          row.group_report = linked.filter(l => l.group === 'group-report').map(l => ({ value: l.value, label: l.label }));
          row.action_report = linked.filter(l => l.group === 'action-report').map(l => ({ value: l.value, label: l.label }));
        }
        return row;
      });

      const table = setupTable(group);
      if (group === 'area' || group === 'template-floor-plan') {
        for (const col of table) {
          if (col.key === 'building') col.options = bfOptions.building;
          if (col.key === 'floor') col.options = bfOptions.floor;
        }
      }
      if (group === 'master-report') {
        for (const col of table) {
          if (col.key === 'group_report') col.options = mrOptions.group_report;
          if (col.key === 'action_report') col.options = mrOptions.action_report;
        }
      }

      const perms = crudPermission(req.user, 1125n);
      success(res, rows, 'Success', 200, {
        table,
        pagination: laravelPaging(total, limit, page),
        permission: { view: true, add: perms.add, edit: perms.edit, delete: perms.delete },
      });
    } catch (err: any) {
      console.error('Setup error:', err);
      error(res, 'Failed to load setup', 500);
    }
  }

  // ==================== SETUP GET TYPE (TypeController@getType parity) ====================
  static async setupGetType(req: Request, res: Response): Promise<void> {
    try {
      const group = (req.query.group as string) || '';
      const propertyId = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: propertyId, deleted_at: null, status: 1 };
      if (group) where.group = group;
      const data = await getPrisma().types.findMany({ where, orderBy: { sort: 'asc' } });
      // Laravel TypeController@getType parity — { value, label }
      success(res, data.map(d => ({ value: Number(d.id), label: d.name })), 'Success');
    } catch (err: any) {
      console.error('Setup get-type error:', err);
      error(res, 'Failed to load types', 500);
    }
  }

  // ==================== SETUP CREATE FORM ====================
  static async setupCreate(req: Request, res: Response): Promise<void> {
    try {
      success(res, { status: 1 }, 'Success', 200, {
        master: {
          statuses: [
            { value: 1, label: 'Active' },
            { value: 0, label: 'Inactive' },
          ],
        },
      });
    } catch (err: any) {
      error(res, 'Failed to load setup form', 500);
    }
  }

  // ==================== SETUP SHOW ====================
  static async setupShow(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      const d = await getPrisma().types.findUnique({ where: { id } });
      if (!d || d.deleted_at) { notFound(res); return; }
      success(res, { ...bigintToNumber(d), no: d.sort }, 'Success');
    } catch (err: any) {
      console.error('Setup show error:', err);
      error(res, 'Failed to load setup', 500);
    }
  }

  // ==================== SETUP STORE ====================
  static async setupStore(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      // Support group from both body and query (frontend sends as query param)
      const body = req.body || {};
      const query = req.query || {};
      const group = body.group || query.group || '';
      const { name, description, status, sort, text, image, building, floor } = body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const dup = await getPrisma().types.findFirst({ where: { name, group: group || '', property_id: propertyId } });
      if (dup) { badRequest(res, 'Name already exist'); return; }

      const d = await getPrisma().types.create({
        data: {
          property_id: propertyId,
          group: group || '',
          name,
          description: normalizeStr(description),
          text: normalizeStr(text),
          image: normalizeStr(image),
          sort: num(sort),
          status: status === true || status === 'true' ? 1 : (status ?? 1),
          created_at: new Date(),
          updated_at: new Date(),
          created_by: req.user?.id || null,
        },
      });

      // Area/template-floor-plan: sync Building+Floor Type self-relations (Laravel syncTypes parity)
      if (group === 'area' || group === 'template-floor-plan') {
        await syncAreaTypes(d.id, building, floor);
      }

      success(res, bigintToNumber(d), 'Created');
    } catch (err: any) {
      console.error('Setup store error:', err);
      error(res, 'Failed to create setup', 500);
    }
  }

  // ==================== SETUP UPDATE ====================
  static async setupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      const existing = await getPrisma().types.findUnique({ where: { id } });
      if (!existing) { notFound(res); return; }

      const body = req.body || {};
      const query = req.query || {};
      const group = body.group || query.group || existing.group;
      const { name, description, status, sort, text, image, building, floor } = body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id || null };
      if (name !== undefined) data.name = normalizeStr(name);
      if (group !== undefined) data.group = group;
      if (description !== undefined) data.description = normalizeStr(description);
      if (text !== undefined) data.text = normalizeStr(text);
      if (image !== undefined) data.image = normalizeStr(image);
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = status === true || status === 'true' || status === 1 ? 1 : num(status, 0);

      await getPrisma().types.update({ where: { id }, data });

      // Area/template-floor-plan: sync Building+Floor Type self-relations (Laravel syncTypes parity)
      if (group === 'area' || group === 'template-floor-plan') {
        await syncAreaTypes(id, building, floor);
      }

      success(res, null, 'Updated');
    } catch (err: any) {
      console.error('Setup update error:', err);
      error(res, 'Failed to update setup', 500);
    }
  }

  // ==================== SETUP UPDATE WITH FILE (TypeController@updateWithFile parity) ====================
  // Frontend (TableViewDocument config=true, room-configuration) sends multipart FormData
  static async setupUpdateWithFile(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      const existing = await getPrisma().types.findUnique({ where: { id } });
      if (!existing) { notFound(res); return; }

      const body = req.body || {};
      const group = body.group || req.query.group || existing.group;
      const { name, description, status, sort, text } = body;
      const file: any = (req as any).file;

      const data: any = { updated_at: new Date(), updated_by: req.user?.id || null };
      if (name !== undefined) data.name = normalizeStr(name);
      if (group !== undefined) data.group = group;
      if (description !== undefined) data.description = normalizeStr(description);
      if (text !== undefined) data.text = normalizeStr(text);
      if (sort !== undefined) data.sort = num(sort);
      if (status !== undefined) data.status = status === true || status === 'true' || status === 1 ? 1 : num(status, 0);

      if (file && file.buffer) {
        if (existing.image) {
          try { fs.unlinkSync(path.join(STORAGE_DIR, existing.image)); } catch { /* ignore */ }
        }
        const ext = path.extname(file.originalname || '') || '.jpg';
        const filename = `types/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
        fs.mkdirSync(path.join(STORAGE_DIR, 'types'), { recursive: true });
        fs.writeFileSync(path.join(STORAGE_DIR, filename), file.buffer);
        data.image = filename;
      }

      await getPrisma().types.update({ where: { id }, data });
      success(res, null, 'Updated');
    } catch (err: any) {
      console.error('Setup update-file error:', err);
      error(res, 'Failed to update setup', 500);
    }
  }

  // ==================== SETUP DESTROY ====================
  static async setupDestroy(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      await getPrisma().types.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id || null } });
      success(res, null, 'Deleted');
    } catch (err: any) {
      error(res, 'Failed to delete setup', 500);
    }
  }

  // ==================== NIGHT AUDIT AUDIT ====================
  static async nightAuditAudit(req: Request, res: Response): Promise<void> {
    try {
      const date = new Date().toISOString().split('T')[0];
      success(res, { date }, 'Success');
    } catch (err: any) {
      console.error('Night audit audit error:', err);
      error(res, 'Failed to get night audit date', 500);
    }
  }

  // ==================== NIGHT AUDIT SHIFT ====================
  static async nightAuditShift(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateStr = req.query.date as string;
      const group = req.query.group as string;

      const where: any = { property_id: propertyId, deleted_at: null };

      if (dateStr && dateStr !== '-1') {
        const d = new Date(dateStr);
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        where.date = { gte: d, lt: next };
      }

      const [data, total] = await Promise.all([
        getPrisma().shifts.findMany({
          where,
          include: {
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shifts.count({ where }),
      ]);

      const table = group
        ? []
        : [
            { key: 'id', name: 'ID' },
            { key: 'users', name: 'User', is_sub_query: true, sub_key: 'name' },
            { key: 'start', name: 'Start', type: 'date' },
            { key: 'end', name: 'End', type: 'date' },
            { key: 'date', name: 'Date', type: 'date' },
            { key: 'is_posting', name: 'Posted', type: 'boolean' },
            { key: 'status', name: 'Status' },
          ];

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
        table,
      });
    } catch (err: any) {
      console.error('Night audit shift error:', err);
      error(res, 'Failed to fetch night audit shifts', 500);
    }
  }

  // ==================== NIGHT AUDIT ROOM CHANGE ====================
  static async nightAuditRoomChange(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = {
        property_id: propertyId,
        is_posting: false,
        reservations: {
          some: {
            OR: [{ room_type_id_next: { not: null } }, { room_id_next: { not: null } }],
          },
        },
      };

      const [data, total] = await Promise.all([
        getPrisma().folios.findMany({
          where,
          orderBy: { created_at: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().folios.count({ where }),
      ]);

      const table = NIGHT_AUDIT_TABLE;
      const rows = await formatNightAuditFolios(data);

      success(res, rows, 'Success', 200, {
        table,
        permission: [] as any,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Night audit room change error:', err);
      error(res, 'Failed to load room change', 500);
    }
  }

  // ==================== NIGHT AUDIT NO SHOW ====================
  static async nightAuditNoShow(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateStr = req.query.date as string;

      if (!dateStr) { badRequest(res, 'date is required'); return; }

      const where: any = {
        property_id: propertyId,
        status_reservation: { in: [3, 5] },
        check_in_date: { lte: new Date(dateStr) },
        is_posting: false,
      };

      const [data, total] = await Promise.all([
        getPrisma().folios.findMany({ where, orderBy: { created_at: 'asc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().folios.count({ where }),
      ]);

      const table = NIGHT_AUDIT_TABLE;
      const rows = await formatNightAuditFolios(data);

      success(res, rows, 'Success', 200, {
        table,
        permission: [] as any,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Night audit no show error:', err);
      error(res, 'Failed to load no show', 500);
    }
  }

  // ==================== NIGHT AUDIT OVER STAY ====================
  static async nightAuditOverStay(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateStr = req.query.date as string;

      if (!dateStr) { badRequest(res, 'date is required'); return; }

      const where: any = {
        property_id: propertyId,
        status_reservation: 0,
        check_out_date: { lte: new Date(dateStr) },
        is_posting: false,
      };

      const [data, total] = await Promise.all([
        getPrisma().folios.findMany({ where, orderBy: { created_at: 'asc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().folios.count({ where }),
      ]);

      const table = NIGHT_AUDIT_TABLE;
      const rows = await formatNightAuditFolios(data);

      success(res, rows, 'Success', 200, {
        table,
        permission: [] as any,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Night audit over stay error:', err);
      error(res, 'Failed to load over stay', 500);
    }
  }

  // ==================== NIGHT AUDIT CHECK ====================
  static async nightAuditCheck(req: Request, res: Response): Promise<void> {
    try {
      const dateStr = (req.body?.date as string) ?? (req.query.date as string);
      const propertyId = req.user?.lastProperty ?? 0n;

      if (!dateStr || dateStr === '-1') {
        badRequest(res, 'date is required');
        return;
      }

      const d = new Date(`${dateStr}T00:00:00`);
      if (Number.isNaN(d.getTime())) { badRequest(res, 'date must be a valid date'); return; }
      const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      const dayRange: any = { gte: d, lt: next };

      // Laravel checkNightAudit: shift → transaction → room change → no show → over stay
      const shift = await getPrisma().shifts.findMany({
        where: { property_id: propertyId, date: dayRange, is_posting: false, end: null, deleted_at: null },
        orderBy: { created_at: 'asc' },
      });
      if (shift.length > 0) { badRequest(res, 'Please close all shift first'); return; }

      const transactions = await getPrisma().transactions.findMany({
        where: { property_id: propertyId, date: dayRange, is_posting: 0, deleted_at: null },
      });
      if (transactions.length > 0) {
        res.json({ code: 400, transaction: bigintToNumber(transactions), message: 'Please confirm all transaction first' });
        return;
      }

      const roomChange = await getPrisma().folios.findMany({
        where: {
          property_id: propertyId,
          is_posting: false,
          deleted_at: null,
          reservations: { some: { OR: [{ room_type_id_next: { not: null } }, { room_id_next: { not: null } }] } },
        },
        orderBy: { created_at: 'asc' },
      });
      if (roomChange.length > 0) { badRequest(res, 'Please confirm all room change first'); return; }

      const noShow = await getPrisma().folios.findMany({
        where: { property_id: propertyId, status_reservation: { in: [3, 5] }, check_in_date: { lte: d }, is_posting: false, deleted_at: null },
        orderBy: { created_at: 'asc' },
      });
      if (noShow.length > 0) { badRequest(res, 'Please confirm all no show first'); return; }

      const overStay = await getPrisma().folios.findMany({
        where: { property_id: propertyId, status_reservation: 0, check_out_date: { lte: d }, is_posting: false, deleted_at: null },
        orderBy: { created_at: 'asc' },
      });
      if (overStay.length > 0) { badRequest(res, 'Please confirm all over stay first'); return; }

      success(res, { date: dateStr }, 'Success');
    } catch (err: any) {
      console.error('Night audit check error:', err);
      error(res, 'Failed to check night audit', 500);
    }
  }

  // ==================== DASHBOARD ====================
  static async getDashboard(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const roleIds: bigint[] = (req.user as any)?.roleIds ?? [];

      // Laravel DashboardController@index: role = user's first role (developer/anyaman bypass global property scope — node has no such scope)
      const role = await getPrisma().roles.findFirst({
        where: roleIds.length ? { id: roleIds[0] } : undefined,
        select: { list_dashboard: true },
      });

      if (!role?.list_dashboard) {
        const payload = { data: [], code: 200, message: 'Role not found' };
        res.status(400).type('text/plain').send(encrypt(JSON.stringify(payload)));
        return;
      }

      const listDashboard = Array.isArray(role.list_dashboard)
        ? role.list_dashboard
        : typeof role.list_dashboard === 'string'
          ? role.list_dashboard.split(',').filter(Boolean)
          : [];

      const businessDate = await AuthController.getBusinessDate(propertyId);
      const sd = (req.query.start_date as string) || businessDate;
      const ed = (req.query.end_date as string) || new Date(new Date(businessDate + 'T00:00:00Z').getTime() + 7 * 86400000).toISOString().substring(0, 10);
      const dateLog = (req.query.dateLog as string) || businessDate;

      const property = await getPrisma().properties.findUnique({
        where: { id: propertyId },
        select: { id: true, name: true, alias: true, logo: true, image: true, address: true, email: true, telp: true },
      });

      const responsePayload = {
        data: listDashboard,
        property: property ? {
          id: Number(property.id),
          name: property.name,
          alias: property.alias,
          logo: property.logo,
          image: property.image,
          address: property.address,
          email: property.email,
          phone: property.telp ? Number(property.telp) : null,
        } : null,
        dateLog,
        start_date: sd,
        end_date: ed,
        code: 200,
        message: 'Data has been loaded',
      };
      res.status(200).type('text/plain').send(encrypt(JSON.stringify(responsePayload)));
    } catch (err: any) {
      console.error('Get dashboard error:', err);
      error(res, 'Failed to load dashboard', 500);
    }
  }

  // ==================== DASHBOARD DETAIL ====================
  static async getDashboardDetail(req: Request, res: Response): Promise<void> {
    try {
      const code = req.params.code;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const dateLog = req.query.dateLog as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      const today = new Date().toISOString().split('T')[0];
      const sd = startDate || today;
      const ed = endDate || today;

      let list: any[] = [];
      let detail: any = null;
      const prisma = getPrisma();
      const dateRangeOf = (d: string) => {
        const s = new Date(d + 'T00:00:00Z');
        return { s, e: new Date(s.getTime() + 86400000) };
      };
      const fmtDMY = (d: string) => {
        const [y, m, dd] = d.split('-');
        return `${dd}/${m}/${y}`;
      };
      const ROOM_STATUSES = ['Vacant', 'Occupied', 'Due Out', 'Blocked', 'Out of Order'];
      const MAID_STATUSES = ['Clean', 'Dirty', 'Maid in Room', 'Inspection Required'];
      const STATUS = { check_in: 0, check_out: 1, cancel: 2, reservation: 3, in_house: 4, pending: 5 };

      const property = await prisma.properties.findUnique({
        where: { id: propertyId },
        select: { market_segment_1: true, market_segment_2: true, market_segment_3: true, market_segment_4: true },
      });

      // ==== Folio market segment donut parity (DashboardController@marketSegment) ====
      const computeMarketSegment = async (group: string, enabled: boolean) => {
        if (!enabled) return null;
        const s = new Date(sd + 'T00:00:00Z');
        const e = new Date(new Date(ed + 'T00:00:00Z').getTime() + 86400000);
        const typeRows = await prisma.types.findMany({
          where: { property_id: propertyId, group, status: 1, deleted_at: null },
          select: { id: true, name: true },
        });
        const typeIds = typeRows.map(t => t.id);
        const folios = await prisma.folios.findMany({
          where: { property_id: propertyId, deleted_at: null, status_reservation: { not: STATUS.cancel }, reservations: { some: { date: { gte: s, lt: e } } } },
          select: { id: true },
        });
        const folioIdSet = new Set(folios.map(f => Number(f.id)));
        const mht = typeIds.length ? await prisma.model_has_types.findMany({
          where: { model_type: 'App\\Models\\Folio', type_id: { in: typeIds } },
          select: { model_id: true, type_id: true },
        }) : [];
        const folioTypeMap = new Map<number, Set<number>>();
        for (const row of mht) {
          const fid = Number(row.model_id);
          if (!folioIdSet.has(fid)) continue;
          if (!folioTypeMap.has(fid)) folioTypeMap.set(fid, new Set());
          folioTypeMap.get(fid)!.add(Number(row.type_id));
        }
        const reservations = folios.length ? await prisma.reservations.findMany({
          where: { folio_id: { in: folios.map(f => f.id) }, date: { gte: s, lt: e } },
          select: { folio_id: true, amount: true },
        }) : [];
        const sumByFolio = new Map<number, number>();
        for (const r of reservations) {
          const fid = Number(r.folio_id);
          sumByFolio.set(fid, (sumByFolio.get(fid) ?? 0) + Number(r.amount));
        }
        let sumTotal = 0;
        for (const [fid, typeSet] of folioTypeMap) {
          if (typeSet.size > 0) sumTotal += sumByFolio.get(fid) ?? 0;
        }
        const listRaw: any[] = [];
        typeRows.forEach(t => {
          let sum = 0;
          for (const [fid, typeSet] of folioTypeMap) {
            if (typeSet.has(Number(t.id))) sum += sumByFolio.get(fid) ?? 0;
          }
          if (sum !== 0) listRaw.push({ name: t.name.toUpperCase(), data: sum, color: '#FF6384' });
        });
        listRaw.sort((a, b) => b.data - a.data);
        const list = listRaw.map((item, key) => ({
          ...item,
          key,
          color: key === 0 ? '#10b981' : key === listRaw.length - 1 ? '#FF0000' : '#36A2EB',
        }));
        return { type: 'donut', span: '3', label: 'Market Segment ' + group.slice(-1), list, total: moneyFormat(sumTotal), is_active: false };
      };

      // ==== Room.getListAndMaidStatusRoom parity (total_room / chart_room) ====
      const computeRoomData = async () => {
        const rooms = await prisma.rooms.findMany({
          where: { property_id: propertyId, deleted_at: null, is_physical: true },
          select: { room_status: true, maid_status: true },
        });
        const roomRows = [
          { name: 'Total Rooms', data: rooms.length },
          { name: 'OOO', data: rooms.filter(r => r.room_status === 4).length },
          { name: 'Blocked Rooms', data: 0 },
          { name: 'Saleable Room', data: rooms.filter(r => [0, 1, 2].includes(r.room_status)).length },
        ];
        const maidAll = MAID_STATUSES.map((alias, i) => ({ name: alias, data: rooms.filter(r => r.maid_status === i).length }));
        return { roomRows, maidAll };
      };

      // ==== Reservation.getTransactionRevenueOnly + getRoomSoldPerDate parity (forecast charts) ====
      const computeRevenueForecast = async () => {
        const s = new Date(sd + 'T00:00:00Z');
        const e = new Date(new Date(ed + 'T00:00:00Z').getTime() + 86400000);
        const reservations = await prisma.reservations.findMany({
          where: { property_id: propertyId, date: { gte: s, lt: e }, folios: { status_reservation: { not: STATUS.cancel } } },
          select: { date: true, total: true, room_id: true, folios: { select: { status_reservation: true } } },
        });
        const totalRooms = await prisma.rooms.count({ where: { property_id: propertyId, deleted_at: null, is_physical: true } });
        const TotalroomAvailable = totalRooms > 0 ? totalRooms : 1;

        const byDate = new Map<string, { rev: number; sold: number }>();
        for (const r of reservations) {
          const key = r.date.toISOString().substring(0, 10);
          const cur = byDate.get(key) || { rev: 0, sold: 0 };
          cur.rev += Number(r.total ?? 0);
          if (r.room_id != null && (r.folios?.status_reservation === STATUS.check_in || r.folios?.status_reservation === STATUS.reservation)) cur.sold += 1;
          byDate.set(key, cur);
        }

        const totalSeries: any[] = [];
        const revenueSeries: any[] = [];
        const roomAvailableSeries: any[] = [];
        const occupancySeries: any[] = [];
        const statusSeries: any[][] = ROOM_STATUSES.map(() => []);
        const formatDate: string[] = [];
        let grandRev = 0;
        let grandSold = 0;

        for (let d = new Date(s); d < e; d.setUTCDate(d.getUTCDate() + 1)) {
          const key = d.toISOString().substring(0, 10);
          const v = byDate.get(key) || { rev: 0, sold: 0 };
          const dateLabel = fmtDMY(key);
          formatDate.push(dateLabel);
          totalSeries.push({ name: dateLabel, data: moneyFormat(v.rev), room_sold: v.sold });
          revenueSeries.push({ name: dateLabel, data: moneyFormat(v.rev) });
          roomAvailableSeries.push({ name: dateLabel, data: TotalroomAvailable });
          const roomSold = v.sold > 0 ? v.sold : 1;
          occupancySeries.push({ name: dateLabel, data: moneyFormat((roomSold / TotalroomAvailable) * 100) });
          ROOM_STATUSES.forEach((_, idx) => {
            const count = idx === 1 ? v.sold : idx === 0 ? Math.max(0, TotalroomAvailable - v.sold) : 0;
            statusSeries[idx].push({ name: dateLabel, data: count });
          });
          grandRev += v.rev;
          grandSold += v.sold;
        }
        totalSeries.push({ name: 'Total', data: moneyFormat(grandRev), room_sold: grandSold });

        const chartAnalysis = [
          { name: 'Room Available', data: roomAvailableSeries },
          { name: 'Occupancy', data: occupancySeries },
          ...ROOM_STATUSES.map((name, idx) => ({ name, data: statusSeries[idx] })),
        ];

        return {
          total: totalSeries,
          revenue: { data: revenueSeries },
          chart: { data: chartAnalysis, date: formatDate },
        };
      };

      // ==== Folio.getDeparture / getArrival parity ====
      const getArrival = async () => {
        const { s, e } = dateRangeOf(dateLog || sd);
        const folios = await prisma.folios.findMany({
          where: { property_id: propertyId, deleted_at: null, check_in_date: { gte: s, lt: e }, status_reservation: { in: [STATUS.check_in, STATUS.reservation] } },
          select: { id: true, parent: true, type_reservation: true, status_reservation: true, company_profile_id: true, company_profiles_folios_company_profile_idTocompany_profiles: { select: { name: true } } },
        });
        const fit = (f: any) => (f.type_reservation || '').toLowerCase() === 'fit';
        const git = (f: any) => (f.type_reservation || '').toLowerCase() === 'git' && Number(f.parent) !== 0;
        const gitAll = (f: any) => (f.type_reservation || '').toLowerCase() === 'git';
        const exp = (f: any) => fit(f) || git(f);
        const act = (f: any) => f.status_reservation === STATUS.check_in && (fit(f) || git(f));
        const fitExpected = folios.filter(fit).length;
        const fitActual = folios.filter(f => f.status_reservation === STATUS.check_in && fit(f)).length;
        const gitExpected = folios.filter(git).length;
        const gitActual = folios.filter(f => f.status_reservation === STATUS.check_in && git(f)).length;
        const groups = new Map<number, any[]>();
        for (const f of folios.filter(gitAll)) {
          const k = Number(f.company_profile_id);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(f);
        }
        return {
          all: { expected: folios.filter(exp).length, actual: folios.filter(act).length, due_to_arrival: folios.filter(exp).length - folios.filter(act).length },
          fit: { expected: fitExpected, actual: fitActual, due_to_arrival: fitExpected - fitActual },
          git: { total_git: groups.size, expected: gitExpected, actual: gitActual, due_to_arrival: gitExpected - gitActual, groups },
        };
      };
      const getDeparture = async () => {
        const { s, e } = dateRangeOf(dateLog || sd);
        const folios = await prisma.folios.findMany({
          where: { property_id: propertyId, deleted_at: null, check_out_date: { gte: s, lt: e }, status_reservation: { in: [STATUS.check_in, STATUS.check_out] } },
          select: { id: true, parent: true, type_reservation: true, status_reservation: true, company_profile_id: true, company_profiles_folios_company_profile_idTocompany_profiles: { select: { name: true } } },
        });
        const fit = (f: any) => (f.type_reservation || '').toLowerCase() === 'fit';
        const git = (f: any) => (f.type_reservation || '').toLowerCase() === 'git' && Number(f.parent) !== 0;
        const exp = (f: any) => fit(f) || git(f);
        const act = (f: any) => f.status_reservation === STATUS.check_out && (fit(f) || git(f));
        const fitExpected = folios.filter(fit).length;
        const fitActual = folios.filter(f => f.status_reservation === STATUS.check_out && fit(f)).length;
        const gitExpected = folios.filter(git).length;
        const gitActual = folios.filter(f => f.status_reservation === STATUS.check_out && git(f)).length;
        const groups = new Map<number, any[]>();
        for (const f of folios.filter(git)) {
          const k = Number(f.company_profile_id);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(f);
        }
        return {
          all: { expected: folios.filter(exp).length, actual: folios.filter(act).length, due_to_departure: folios.filter(exp).length - folios.filter(act).length },
          fit: { expected: fitExpected, actual: fitActual, due_to_departure: fitExpected - fitActual },
          git: { total_git: groups.size, expected: gitExpected, actual: gitActual, due_to_departure: gitExpected - gitActual, groups },
        };
      };

      // ==== Transaction.getRevenueDTD/MTD/YTD parity (today_revenue) ====
      const revenueRange = async (from: Date, to: Date) => {
        const defaultItems = await prisma.code_items.findMany({ where: { code_posts: { type: 'DEFAULT' } }, select: { id: true } });
        const rows = await prisma.transactions.findMany({
          where: {
            property_id: propertyId, deleted_at: null, is_void: 0, date: { gte: from, lte: to },
            folios: { status_reservation: { not: STATUS.cancel } },
            code_item_id: { in: defaultItems.map(i => i.id) },
          },
          select: { amount: true, type_amount: true },
        });
        return rows.reduce((sum, t) => sum + (t.type_amount === 'MINUS' ? -1 : 1) * Number(t.amount), 0);
      };

      // ==== Reservation.getHouseUseComplimentary parity (house_use_complimentary) ====
      const getHouseUseComplimentary = async () => {
        const s = new Date(sd + 'T00:00:00Z');
        const e = new Date(new Date(ed + 'T00:00:00Z').getTime() + 86400000);
        const folios = await prisma.folios.findMany({
          where: {
            property_id: propertyId, deleted_at: null, status_reservation: { not: STATUS.cancel },
            AND: [
              { OR: [{ check_in_date: { gte: s, lte: e } }, { check_out_date: { gte: s, lte: e } }] },
              { OR: [{ is_house_use: true }, { complimentary: true }] },
            ],
          },
          select: { id: true, is_house_use: true, complimentary: true, type_reservation: true, first_name: true, last_name: true, reservations: { orderBy: { date: 'desc' }, take: 1, select: { room_name: true, rate_name: true } } },
        });
        const notGit = (f: any) => (f.type_reservation || '').toLowerCase() !== 'git';
        const rows: any[] = [];
        const houseuse = folios.filter(f => f.is_house_use && notGit(f));
        rows.push({ name: 'House Use', data: `${houseuse.length} Room(s)` });
        houseuse.forEach((f, i) => {
          const r = f.reservations?.[0];
          rows.push({ name: '', data: `${i + 1}. ${f.first_name || ''} ${f.last_name || ''}`.trim() + ` - ${r?.room_name || '-'} - ${r?.rate_name || '-'}` });
        });
        const comp = folios.filter(f => f.complimentary && notGit(f));
        rows.push({ name: 'Complimentary', data: `${comp.length} Room(s)` });
        comp.forEach((f, i) => {
          const r = f.reservations?.[0];
          rows.push({ name: '', data: `${i + 1}. ${f.first_name || ''} ${f.last_name || ''}`.trim() + ` - ${r?.room_name || '-'} - ${r?.rate_name || '-'}` });
        });
        return rows;
      };

      const normalizeDashboardCode = (rawCode?: string | string[]) => {
        const codeKey = String(Array.isArray(rawCode) ? (rawCode[0] ?? '') : (rawCode ?? '')).trim();
        const aliases: Record<string, string> = {
          total_rooms: 'total_room',
          occupancy: 'chart_room',
          arrivals: 'arrival_git',
          departures: 'departure',
          in_house: 'total_arrival_git_fit',
          revenue: 'today_revenue',
          notification: 'notifications',
          notifications_list: 'notifications',
          guest_request: 'guest_requests',
          guest_requests_list: 'guest_requests',
        };
        return aliases[codeKey] || codeKey;
      };

      const resolvedCode = normalizeDashboardCode(code);

      switch (resolvedCode) {
        case 'total_room': {
          const { roomRows, maidAll } = await computeRoomData();
          list = [...maidAll, ...roomRows];
          detail = { type: 'number', span: '3', label: 'Total Room', header: ['Room', 'Amount'], list, link: '/room-statistic?parent=54&module=statistic', is_total: true };
          break;
        }
        case 'chart_room': {
          const { roomRows, maidAll } = await computeRoomData();
          detail = { type: 'chart-bar', span: '3', label: 'Chart Room', list: [...maidAll, ...roomRows].filter((r: any) => r.name !== 'Total'), link: '/room-statistic?parent=54&module=statistic' };
          break;
        }
        case 'daily_room_revenue_forecast': {
          const fc = await computeRevenueForecast();
          detail = { type: 'number', span: '3', label: 'Daily Room Revenue Forecast', header: ['Date', 'Revenue', 'Room Sold'], list: fc.total, link: '', is_total: true };
          break;
        }
        case 'chart_analysis_history_forecast': {
          const fc = await computeRevenueForecast();
          detail = { type: 'chart', span: '12', label: 'Chart Analysis History & Forecast', list: fc.chart, is_active: true };
          break;
        }
        case 'forecast':
        case 'total_room_revenue': {
          const fc = await computeRevenueForecast();
          detail = { type: 'chart', span: '12', label: resolvedCode === 'forecast' ? 'Forecast' : 'Total Room Revenue', list: fc.revenue, is_active: true };
          break;
        }
        case 'today_revenue': {
          const dLog = dateLog || sd;
          const dtd = await revenueRange(new Date(dLog + 'T00:00:00Z'), new Date(new Date(dLog + 'T00:00:00Z').getTime() + 86400000));
          const mtdStart = new Date(dLog.substring(0, 8) + '01T00:00:00Z');
          const mtd = await revenueRange(mtdStart, new Date(dLog + 'T00:00:00Z'));
          const ytd = await revenueRange(new Date(dLog.substring(0, 4) + '-01-01T00:00:00Z'), new Date(dLog + 'T00:00:00Z'));
          detail = { type: 'number-only', span: '3', label: ['Manual Posting Revenue', 'MTD Revenue', 'YTD Revenue'], data: [moneyFormat(dtd), moneyFormat(mtd), moneyFormat(ytd)], url: ['/cms/dashboard/today-revenue', '/cms/dashboard/mtd-revenue', '/cms/dashboard/ytd-revenue'], ispopup: true, svg: 'money' };
          break;
        }
        case 'departure': {
          const d = await getDeparture();
          const dep: any[] = [
            { name: 'Expected', data: d.all.expected },
            { name: 'Actual', data: d.all.actual },
            { name: 'Due to Depart', data: d.all.due_to_departure },
            { name: 'Group Departure Today', data: `${d.git.groups.size} Group(s)` },
          ];
          d.git.groups.forEach((g: any[]) => {
            dep.push({ name: '', data: `${g[0]?.company_profiles_folios_company_profile_idTocompany_profiles?.name || '-'} (${g.length} Room(s))` });
          });
          detail = { type: 'number', span: '3', label: 'Departure', header: ['Name', 'Amount'], list: dep, link: '', is_total: false };
          break;
        }
        case 'arrival_git': {
          const a = await getArrival();
          const arr: any[] = [
            { name: 'Total Room group', data: a.git.total_git },
            { name: 'Expected', data: a.git.expected },
            { name: 'Actual', data: a.git.actual },
            { name: 'Due to Arrival', data: a.git.due_to_arrival },
            { name: 'Group Arrival Today', data: `${a.git.groups.size} Group(s)` },
          ];
          a.git.groups.forEach((g: any[]) => {
            arr.push({ name: '', data: `${g[0]?.company_profiles_folios_company_profile_idTocompany_profiles?.name || '-'} (${g.length} Room(s))` });
          });
          detail = { type: 'number', span: '3', label: 'Arrival GIT', header: ['Name', 'Amount'], list: arr, link: '', is_total: false };
          break;
        }
        case 'arrival_fit': {
          const a = await getArrival();
          const arr: any[] = [
            { name: 'Expected', data: a.fit.expected },
            { name: 'Actual', data: a.fit.actual },
            { name: 'Due to Arrival', data: a.fit.due_to_arrival },
          ];
          detail = { type: 'number', span: '3', label: 'Arrival FIT', header: ['Name', 'Amount'], list: arr, link: '', is_total: false };
          break;
        }
        case 'total_arrival_git_fit': {
          const a = await getArrival();
          const arr: any[] = [
            { name: 'Expected', data: a.fit.expected + a.git.expected },
            { name: 'Actual', data: a.fit.actual + a.git.actual },
            { name: 'Due to Arrival', data: a.fit.due_to_arrival + a.git.due_to_arrival },
          ];
          detail = { type: 'number', span: '3', label: 'Total Arrival GIT & FIT', header: ['Name', 'Amount'], list: arr, link: '', is_total: false };
          break;
        }
        case 'house_use_complimentary': {
          list = await getHouseUseComplimentary();
          detail = { type: 'number', span: '3', label: 'HOUSE USE & COMPLIMENTARY', header: ['TITLE', '#'], list, link: '', is_total: false };
          break;
        }
        case 'hotel_competitor': {
          detail = { type: 'table', label: 'Hotel Competitor', url: '/cms/hotel-competitor-dashboard' };
          break;
        }
        case 'maps': {
          detail = { type: 'maps', span: '12', label: 'Hotel Competitor Surounding' };
          break;
        }
        case 'notifications': {
          const taskList = await prisma.tasks.findMany({
            where: {
              to_user_id: req.user?.id ?? 0n,
              deleted_at: null,
              status: { in: ['Open', 'In_Progress'] },
            },
            orderBy: { created_at: 'desc' },
            take: 10,
            select: { id: true, message: true, room_number: true, priority: true, created_at: true },
          });
          const items = taskList.map((t: any) => ({
            id: Number(t.id),
            title: t.message || 'Task',
            message: t.message || 'Task',
            room_number: t.room_number,
            priority: t.priority || 'Medium',
            created_at: t.created_at?.toISOString?.() || new Date().toISOString(),
          }));
          detail = { type: 'notification-list', label: 'Notifications', span: 4, count: items.length, items, url: '/cms/task' };
          break;
        }
        case 'guest_requests': {
          detail = { type: 'guest-request-list', label: 'Guest Requests', span: 4, count: 0, items: [], url: '/cms/guest-request' };
          break;
        }
        case 'market_segment_1':
        case 'market_segment_2':
        case 'market_segment_3':
        case 'market_segment_4': {
          const idx = Number(resolvedCode.slice(-1)) as 1 | 2 | 3 | 4;
          detail = await computeMarketSegment(`market-segment-${idx}`, !!((property as any)?.[`market_segment_${idx}`]));
          break;
        }
        case 'mtd_actual_vs_budget':
        case 'room_sold_per_segment':
        case 'forecast_per_room_sold':
        case 'room_sold_rbv_vs_ro': {
          detail = {
            type: 'number',
            span: '3',
            label: resolvedCode.replace(/_/g, ' ').replace(/\b\w/g, (x: string) => x.toUpperCase()),
            header: ['Name', 'Amount'],
            list: [{ name: 'No Data', data: 0 }],
            link: '',
            is_total: false,
          };
          break;
        }
        default: {
          detail = null;
        }
      }

      const responsePayload = {
        code: '200',
        message: 'Data has been loaded',
        data: detail ? [detail] : [],
        start_date: sd,
        end_date: ed,
        dateLog: dateLog || today,
      };
      res.status(200).type('text/plain').send(encrypt(JSON.stringify(responsePayload)));
    } catch (err: any) {
      console.error('Get dashboard detail error:', err);
      res.status(500).type('text/plain').send(encrypt(JSON.stringify({ code: '500', message: 'Failed to load dashboard detail', data: null })));
    }
  }

  // ==================== DASHBOARD REVENUE LISTS ====================
  // Laravel Transaction@getListRevenueDTD/MTD/YTD + DashboardController@todayRevenue/mtdRevenue/ytdRevenue parity
  private static async dashboardRevenueList(propertyId: bigint, mode: 'DTD' | 'MTD' | 'YTD', dateLog: string) {
    const prisma = getPrisma();
    const [y, m] = [Number(dateLog.substring(0, 4)), Number(dateLog.substring(5, 7))];
    const s = mode === 'DTD' ? new Date(dateLog + 'T00:00:00Z') : mode === 'MTD' ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(y, 0, 1));
    const e = mode === 'DTD' ? new Date(s.getTime() + 86400000) : mode === 'MTD' ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y + 1, 0, 1));

    const defaultPosts = await prisma.code_posts.findMany({
      where: { property_id: propertyId, type: 'DEFAULT', deleted_at: null },
      select: { id: true, name: true },
    });
    const postIds = defaultPosts.map(p => String(p.id));
    const txns = await prisma.transactions.findMany({
      where: {
        property_id: propertyId, deleted_at: null, date: { gte: s, lt: e },
        code: { in: postIds },
        folios: { status_reservation: { not: 2 }, deleted_at: null },
      },
      select: { code: true, amount: true, type_amount: true },
    });
    const nameMap = new Map(defaultPosts.map(p => [String(p.id), p.name]));
    const groups = new Map<string, { debit: number; credit: number }>();
    for (const t of txns) {
      const code = t.code ?? '';
      const g = groups.get(code) ?? { debit: 0, credit: 0 };
      const amt = Number(t.amount);
      if (t.type_amount === 'MINUS') g.debit += -amt; else g.credit += amt;
      groups.set(code, g);
    }
    const mapped = [...groups.entries()].map(([code, g]) => {
      const net = g.debit + g.credit;
      return { name: nameMap.get(code) ?? '', debit: net > 0 ? 0 : net, credit: net > 0 ? net : 0 };
    });
    return formatSystemBalanceData(mapped, 'posting');
  }

  static async todayRevenue(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateLog = (req.query.dateLog as string) || await AuthController.getBusinessDate(propertyId);
      const r = await SystemController.dashboardRevenueList(propertyId, 'DTD', dateLog);
      success(res, r.data, 'Success', 200, { table: r.table, pagination: r.pagination, permission: r.permission });
    } catch (err: any) {
      console.error('Today revenue error:', err);
      error(res, 'Failed to load revenue', 500);
    }
  }

  static async mtdRevenue(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateLog = (req.query.dateLog as string) || await AuthController.getBusinessDate(propertyId);
      const r = await SystemController.dashboardRevenueList(propertyId, 'MTD', dateLog);
      success(res, r.data, 'Success', 200, { table: r.table, pagination: r.pagination, permission: r.permission });
    } catch (err: any) {
      console.error('MTD revenue error:', err);
      error(res, 'Failed to load revenue', 500);
    }
  }

  static async ytdRevenue(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateLog = (req.query.dateLog as string) || await AuthController.getBusinessDate(propertyId);
      const r = await SystemController.dashboardRevenueList(propertyId, 'YTD', dateLog);
      success(res, r.data, 'Success', 200, { table: r.table, pagination: r.pagination, permission: r.permission });
    } catch (err: any) {
      console.error('YTD revenue error:', err);
      error(res, 'Failed to load revenue', 500);
    }
  }

  // ==================== HOTEL COMPETITOR DASHBOARD ====================
  // Laravel HotelCompetitorDashboardController@index parity
  static async hotelCompetitorDashboard(req: Request, res: Response): Promise<void> {
    try {
      const prisma = getPrisma();
      const propertyId = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 9999;
      const businessDate = await AuthController.getBusinessDate(propertyId);
      const date = (req.query.date as string) || businessDate;
      const s = new Date(date + 'T00:00:00Z');
      const e = new Date(s.getTime() + 86400000);
      const STATUS_CANCEL = 2;
      const STATUS_PENDING = 5;

      const [db, master, property] = await Promise.all([
        prisma.hotel_competitors.findMany({
          where: { property_id: propertyId, deleted_at: null, date: { gte: s, lt: e } },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
          include: { master_hotel_competitors: { select: { name: true } } },
        }),
        prisma.master_hotel_competitors.findMany({
          where: { property_id: propertyId, status: 1, deleted_at: null },
          orderBy: { id: 'asc' },
        }),
        prisma.properties.findUnique({ where: { id: propertyId }, select: { name: true } }),
      ]);

      const [reservationAmount, reservationTotal] = await Promise.all([
        prisma.reservations.aggregate({
          where: { property_id: propertyId, date: { gte: s, lt: e }, folios: { status_reservation: { not: STATUS_CANCEL }, deleted_at: null } },
          _sum: { amount: true },
        }),
        prisma.reservations.aggregate({
          where: { property_id: propertyId, date: { gte: s, lt: e }, folios: { status_reservation: { not: STATUS_CANCEL }, deleted_at: null } },
          _sum: { total: true },
        }),
      ]);
      const reservation = Number(reservationAmount._sum.amount ?? 0);
      const total = Number(reservationTotal._sum.total ?? 0);

      // manual_posting transactions whose code post is billed as room_revenue
      const billings = await prisma.code_billings.findMany({
        where: { name: { contains: 'room_revenue', mode: 'insensitive' }, deleted_at: null },
        select: { id: true },
      });
      const manualPostIds = (await prisma.code_posts.findMany({
        where: { code_billing_id: { in: billings.map(b => b.id) }, deleted_at: null },
        select: { id: true },
      })).map(p => String(p.id));
      const manualTxns = await prisma.transactions.findMany({
        where: { property_id: propertyId, deleted_at: null, type: 'manual_posting', date: { gte: s, lt: e }, code: { in: manualPostIds } },
        select: { amount: true, type_amount: true },
      });
      let manualPost = 0;
      for (const t of manualTxns) manualPost += t.type_amount === 'MINUS' ? -Number(t.amount) : Number(t.amount);

      const roomAvailable = await prisma.rooms.count({
        where: { property_id: propertyId, deleted_at: null, status: 1 },
      });

      // room sold: FIT/GIT non house-use/complimentary, rate not tagged company-type compliment/house use
      const folios = await prisma.folios.findMany({
        where: {
          property_id: propertyId, deleted_at: null,
          status_reservation: { notIn: [STATUS_CANCEL, STATUS_PENDING] },
          type_reservation: { in: ['git', 'fit'] },
          is_house_use: false, complimentary: false,
        },
        select: { id: true },
      });
      const folioIds = folios.map(f => f.id);
      const resRows = folioIds.length ? await prisma.reservations.findMany({
        where: { property_id: propertyId, date: { gte: s, lt: e }, folio_id: { in: folioIds } },
        select: { rate_id: true },
      }) : [];
      let badRateIds = new Set<number>();
      if (resRows.length) {
        const rateIds = [...new Set(resRows.map(r => r.rate_id != null ? Number(r.rate_id) : -1).filter(x => x > 0))];
        const mht = rateIds.length ? await prisma.model_has_types.findMany({
          where: { model_type: 'App\\Models\\Rate', model_id: { in: rateIds } },
          select: { model_id: true, type_id: true },
        }) : [];
        const typeIds = [...new Set(mht.map(m => Number(m.type_id)))];
        const badTypes = typeIds.length ? await prisma.types.findMany({
          where: {
            id: { in: typeIds }, group: 'company-type', deleted_at: null,
            OR: [
              { name: { contains: 'compliment', mode: 'insensitive' } },
              { name: { contains: 'house use', mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        }) : [];
        const badTypeIds = new Set(badTypes.map(t => Number(t.id)));
        badRateIds = new Set(mht.filter(m => badTypeIds.has(Number(m.type_id))).map(m => Number(m.model_id)));
      }
      const roomSold = resRows.filter(r => r.rate_id == null || !badRateIds.has(Number(r.rate_id))).length;

      const data: any[] = [];
      data.push({
        action_table: false,
        master_hotel_competitor_id: { value: 0, label: property?.name ?? null },
        id: 0,
        name: property?.name ?? null,
        date,
        master_hotel_competitor: { value: 0, label: property?.name ?? null },
        room_available: roomAvailable,
        room_sold: roomSold,
        room_occupancy: roomSold / (roomAvailable < 1 ? 1 : roomAvailable),
        arr: reservation / (roomSold < 1 ? 1 : roomSold),
        room_revenue: reservation,
        total_revenue: total,
        revpar: (reservation + manualPost) / (roomAvailable < 1 ? 1 : roomAvailable),
        trevpar: (total + manualPost) / (roomAvailable < 1 ? 1 : roomAvailable),
        sales_cost: total / (reservation < 1 ? 1 : reservation),
      });
      const dbMap = new Map(db.map(d => [Number(d.master_hotel_competitor_id), d]));
      // hotel_competitors.name is a MySQL-only column (not in Postgres/Prisma) ->
      // name falls back to master_hotel_competitors.name via the include above
      for (const value of master) {
        const hc = dbMap.get(Number(value.id));
        if (hc) {
          const sold = Number(hc.room_sold);
          const avail = Number(hc.room_available);
          const arrVal = Number(hc.arr);
          const roomRev = sold * arrVal;
          const totRev = Number(hc.total_revenue);
          data.push({
            master_hotel_competitor_id: { value: Number(hc.master_hotel_competitor_id), label: hc.master_hotel_competitors?.name ?? '' },
            id: Number(value.id),
            name: hc.master_hotel_competitors?.name ?? '',
            date: hc.date instanceof Date ? hc.date.toISOString().substring(0, 10) : String(hc.date),
            master_hotel_competitor: { value: Number(value.id), label: value.name },
            room_available: Number(hc.room_available),
            room_sold: sold,
            room_occupancy: sold / (avail < 1 ? 1 : avail),
            arr: arrVal,
            room_revenue: roomRev,
            total_revenue: totRev,
            revpar: roomRev / (avail < 1 ? 1 : avail),
            trevpar: totRev / (avail < 1 ? 1 : avail),
            sales_cost: totRev / (roomRev < 1 ? 1 : roomRev),
          });
        } else {
          data.push({
            master_hotel_competitor_id: { value: Number(value.id), label: value.name },
            id: Number(value.id),
            name: value.name,
            date,
            master_hotel_competitor: { value: Number(value.id), label: value.name },
            room_available: 0, room_sold: 0, room_occupancy: 0, arr: 0, room_revenue: 0, total_revenue: 0, revpar: 0, trevpar: 0, sales_cost: 0,
          });
        }
      }

      const sum = (k: string) => data.reduce((a: number, r: any) => a + Number(r[k] ?? 0), 0);
      const sumAvail = sum('room_available');
      const sumSold = sum('room_sold');
      const sumRoomRev = sum('room_revenue');
      const sumTotRev = sum('total_revenue');
      data.push({
        id: 0,
        master_hotel_competitor_id: { value: 0, label: 'Total' },
        name: 'Total',
        room_available: sumAvail,
        room_sold: sumSold,
        room_occupancy: sumSold / (sumAvail < 1 ? 1 : sumAvail),
        arr: sumTotRev / (sumSold < 1 ? 1 : sumSold),
        room_revenue: sumRoomRev,
        total_revenue: sumTotRev,
        revpar: sumRoomRev / (sumAvail < 1 ? 1 : sumAvail),
        trevpar: sumTotRev / (sumAvail < 1 ? 1 : sumAvail),
        sales_cost: sumTotRev / (sumRoomRev < 1 ? 1 : sumRoomRev),
      });
      const roomOccupancy = sumSold / (sumAvail < 1 ? 1 : sumAvail);
      const arrAvg = sumTotRev / (sumSold < 1 ? 1 : sumSold);
      for (const row of data) {
        const mpi = Number(row.room_occupancy) / (roomOccupancy <= 0 ? 1 : roomOccupancy);
        const ari = Number(row.arr) / (arrAvg <= 0 ? 1 : arrAvg);
        row.room_occupancy = moneyFormat(row.room_occupancy);
        row.arr = moneyFormat(row.arr);
        row.room_revenue = moneyFormat(row.room_revenue);
        row.total_revenue = moneyFormat(row.total_revenue);
        row.revpar = moneyFormat(row.revpar);
        row.trevpar = moneyFormat(row.trevpar);
        row.sales_cost = moneyFormat(row.sales_cost);
        row.mpi = moneyFormat(mpi);
        row.ari = moneyFormat(ari);
        row.rgi = moneyFormat(mpi * ari);
      }

      success(res, data, 'Success', 200, {
        table: COMPETITOR_TABLE,
        pagination: laravelPaging(data.length, limit, page),
        permission: { view: true, add: false, edit: false, delete: false },
      });
    } catch (err: any) {
      console.error('Hotel competitor dashboard error:', err);
      error(res, 'Failed to load hotel competitor dashboard', 500);
    }
  }

  // ==================== HELPER ENDPOINTS ====================
static async helperTaskNotification(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const propertyId = req.user?.lastProperty ?? 0n;

      const [items, count] = await Promise.all([
        getPrisma().tasks.findMany({
          where: {
            to_user_id: userId,
            status: { in: ['Open', 'In_Progress'] },
            deleted_at: null,
          },
          orderBy: { created_at: 'desc' },
          take: 10,
        }),
        getPrisma().tasks.count({
          where: {
            to_user_id: userId,
            status: { in: ['Open', 'In_Progress'] },
            deleted_at: null,
          },
        }),
      ]);

      const mappedItems = items.map(t => ({
        id: Number(t.id),
        type: 'task',
        message: t.message || 'Task',
        room_number: t.room_number,
        link: `/task/${t.id}`,
        time: t.created_at?.toISOString() || new Date().toISOString(),
        created_at: t.created_at?.toISOString() || new Date().toISOString(),
        is_read: t.is_read === 1,
        from: 'System',
        priority: t.priority || 'Medium',
      }));

      success(res, { count, items: mappedItems }, 'Success');
    } catch (err: any) {
      console.error('Helper task notification error:', err);
      error(res, 'Failed to fetch notifications', 500);
    }
  }

  static async helperTotalCancelBookingEngine(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (HelperController@totalCancelBO): folios with is_notification 0 + booking_engine_uuid not null
      const propertyId = req.user?.lastProperty ?? 0n;

      const total = await getPrisma().folios.count({
        where: {
          property_id: propertyId,
          is_notification: false,
          booking_engine_uuid: { not: null },
        },
      });

      success(res, { total }, 'Successfully');
    } catch (err: any) {
      console.error('Helper total cancel booking engine error:', err);
      error(res, 'Failed to count cancellations', 500);
    }
  }

  static async helperReleaseLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (HelperController@releaseLastUserFolio): delete ALL rows for current user
      await getPrisma().last_user_folios.deleteMany({ where: { user_id: req.user?.id ?? 0n } });
      success(res, { status: 1 }, 'Last user folio released');
    } catch (err: any) {
      console.error('Helper release last user folio error:', err);
      error(res, 'Failed to release folio', 500);
    }
  }

  static async helperCheckLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (HelperController@checkLastUserFolio)
      const folioId = req.body.folio_id;
      if (!folioId) { badRequest(res, 'folio_id is required'); return; }

      const lastUserFolio = await getPrisma().last_user_folios.findFirst({
        where: { folio_id: BigInt(folioId) },
      });

      if (lastUserFolio) {
        success(res, { status: 1 }, 'Someone is editing this folio');
      } else {
        success(res, { status: 0 }, 'Successfully');
      }
    } catch (err: any) {
      console.error('Helper check last user folio error:', err);
      error(res, 'Failed to check folio', 500);
    }
  }

  static async helperReplaceLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (HelperController@replaceLastUserFolio): drop user's rows, then insert
      const folioId = req.body.folio_id;
      if (!folioId) { badRequest(res, 'folio_id is required'); return; }

      const userId = req.user?.id ?? 0n;
      const propertyId = req.user?.lastProperty ?? 0n;

      await getPrisma().last_user_folios.deleteMany({ where: { user_id: userId } });
      await getPrisma().last_user_folios.create({
        data: { user_id: userId, folio_id: BigInt(folioId), property_id: propertyId, datetime: new Date() },
      });

      success(res, { status: 1 }, 'Successfully');
    } catch (err: any) {
      console.error('Helper replace last user folio error:', err);
      error(res, 'Failed to replace folio session', 500);
    }
  }

  // ==================== ROOM CHANGE ====================
  static async roomChangeList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        getPrisma().room_change_histories.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().room_change_histories.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Room change list error:', err); error(res, 'Failed to list room changes', 500); }
  }

  static async roomChangeStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id ?? 0n;
      const { folio_id, folio_number, check_in_date, check_out_date, from_room_id, from_room_type_id, to_room_id, to_room_type_id, reason } = req.body;
      if (!folio_id || !to_room_id) { badRequest(res, 'folio_id and to_room_id are required'); return; }

      const data = await getPrisma().room_change_histories.create({
        data: { property_id: pid, folio_id: BigInt(folio_id), folio_number: folio_number || '', check_in_date: new Date(check_in_date), check_out_date: new Date(check_out_date), from_room_id: BigInt(from_room_id), from_room_type_id: BigInt(from_room_type_id), to_room_id: BigInt(to_room_id), to_room_type_id: BigInt(to_room_type_id), user_id: userId, reason, datetime: new Date() },
      });
      success(res, bigintToNumber(data), 'Room change recorded', 201);
    } catch (err: any) { console.error('Room change error:', err); error(res, 'Failed to record room change', 500); }
  }

  // ==================== LOG AUDIT ====================
  static async logAuditList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: Number(pid), deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().log_audits.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().log_audits.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Log audit list error:', err); error(res, 'Failed to list log audits', 500); }
  }

  static async postCodeBudget(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 9999;
      const propertyId = req.user?.lastProperty ?? 0n;
      const type = (req.query.type as string) || 'static';
      const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));

      const [budgets, codePosts] = await Promise.all([
        getPrisma().post_code_budgets.findMany({
          where: { property_id: propertyId, year },
          select: { code_post_id: true, month: true, budget: true },
        }),
        getPrisma().code_posts.findMany({
          where: {
            property_id: propertyId,
            deleted_at: null,
            ...(type === 'static' ? { type: 'STATISTIC' } : type === 'budget' ? { type: 'DEFAULT' } : {}),
          },
          orderBy: { id: 'asc' },
        }),
      ]);

      const budgetMap = new Map<string, number>();
      for (const b of budgets) budgetMap.set(`${b.code_post_id}:${b.month}`, Number(b.budget) || 0);

      const money = (v: number) => Number(v || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const data = codePosts.map(cp => {
        const row: any = { id: Number(cp.id), name: cp.name };
        for (let i = 1; i <= 12; i++) {
          row['month_' + i] = money(budgetMap.get(`${cp.id}:${i}`) ?? 0);
        }
        return row;
      });
      const totalData = data.length;

      const perms = crudPermission(req.user, 1117n);
      success(res, data, 'Success', 200, {
        table: postCodeBudgetTable(year),
        pagination: laravelPaging(totalData, limit, page),
        permission: { view: true, add: perms.add, edit: perms.edit, delete: perms.delete },
      });
    } catch (err: any) {
      console.error('Post code budget error:', err);
      error(res, 'Failed to fetch post code budget', 500);
    }
  }
}
