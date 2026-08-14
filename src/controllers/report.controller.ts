import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import ExcelJS from 'exceljs';
import { success, error, badRequest, notFound } from '../utils/response';

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

function formatDate(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function generateExcel(
  res: Response,
  data: any[],
  columns: { header: string; key: string; width?: number }[],
  fileName: string,
  sheetName?: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(sheetName || 'Sheet1');

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 20,
  }));

  ws.addRows(data);

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
  headerRow.eachCell((cell: any) => {
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  ws.columns.forEach((col: any) => {
    if (!col) return;
    let maxLen = (col.header || '').length;
    if (col.eachCell) {
      col.eachCell({ includeEmpty: false }, (cell: any) => {
        const val = cell.value ? String(cell.value).length : 0;
        if (val > maxLen) maxLen = val;
      });
    }
    col.width = Math.min(Math.max(maxLen + 2, 15), 60);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

function parseReportParams(req: Request) {
  return {
    date: req.query.date as string || formatDate(new Date()),
    startDate: req.query.startDate as string || req.query.start_date as string || '',
    endDate: req.query.endDate as string || req.query.end_date as string || '',
    typeOps: req.query.typeOps as string || '',
    kurs: req.query.kurs as string || '',
    staffId: req.query.staffId as string || req.query.staff_id as string || '',
  };
}

// ── Report data generators ──────────────────────────────────────────

async function getDailyStatistic(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());

  const startOfDay = new Date(`${date}T00:00:00Z`);
  const endOfDay = new Date(`${date}T23:59:59Z`);

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      is_pos_trx: false,
      status_reservation: { in: [1, 2, 3] },
    },
    include: {
      reservations: {
        where: { deleted_at: null },
        select: { id: true, night: true, room_type_name: true, amount: true },
      },
    },
  });

  const totalRooms = await prisma.rooms.count({
    where: { property_id: pid, deleted_at: null, is_physical: true },
  });

  const checkIns = folios.filter((f: any) => {
    const ci = f.check_in_date ? new Date(f.check_in_date).toISOString().slice(0, 10) : '';
    return ci === date && f.status_reservation === 2;
  });

  const checkOuts = folios.filter((f: any) => {
    const co = f.check_out_date ? new Date(f.check_out_date).toISOString().slice(0, 10) : '';
    return co === date && f.status_reservation === 3;
  });

  const inHouse = folios.filter((f: any) => f.status_reservation === 2);

  const occupancyRate = totalRooms > 0 ? Math.round((inHouse.length / totalRooms) * 100) : 0;

  return [{
    date,
    total_rooms: totalRooms,
    check_ins: checkIns.length,
    check_outs: checkOuts.length,
    in_house: inHouse.length,
    vacancy: totalRooms - inHouse.length,
    occupancy_rate: `${occupancyRate}%`,
  }];
}

async function getInHouseFolioBalance(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      status_reservation: 2,
      is_pos_trx: false,
    },
    orderBy: { folio_number: 'asc' },
    include: {
      reservations: {
        where: { deleted_at: null },
        select: { room_name: true, room_type_name: true },
      },
    },
  });

  return folios.map((f: any) => ({
    folio_number: f.folio_number,
    guest_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
    room_name: f.reservations?.[0]?.room_name || '',
    room_type: f.reservations?.[0]?.room_type_name || '',
    check_in: f.check_in_date ? formatDate(f.check_in_date) : '',
    check_out: f.check_out_date ? formatDate(f.check_out_date) : '',
    total_amount: Number(f.total_amount),
  }));
}

async function getVacantRooms(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const inHouseFolioIds = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      status_reservation: 2,
      is_pos_trx: false,
    },
    select: { id: true },
  });

  const folioIds = inHouseFolioIds.map((f: any) => f.id);

  const occupiedRoomNames = await prisma.reservations.findMany({
    where: {
      folio_id: { in: folioIds },
      deleted_at: null,
      room_name: { not: null },
    },
    select: { room_name: true },
    distinct: ['room_name'],
  });

  const occupiedNames = new Set(occupiedRoomNames.map((r: any) => r.room_name));

  const rooms = await prisma.rooms.findMany({
    where: { property_id: pid, deleted_at: null, is_physical: true },
    orderBy: { name: 'asc' },
    include: { room_types: { select: { name: true } } },
  });

  return rooms
    .filter((r: any) => !occupiedNames.has(r.name))
    .map((r: any) => ({
      room_name: r.name,
      room_type: r.room_types?.name || '',
      floor: r.address_code || '',
      status: r.room_status === 1 ? 'Clean' : 'Dirty',
    }));
}

async function getNoShow(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      status_reservation: 0,
      is_pos_trx: false,
    },
    orderBy: { check_in_date: 'desc' },
    take: 100,
    include: {
      reservations: {
        where: { deleted_at: null },
        select: { room_type_name: true },
      },
    },
  });

  return folios.map((f: any) => ({
    folio_number: f.folio_number,
    guest_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
    room_type: f.reservations?.[0]?.room_type_name || '',
    check_in: f.check_in_date ? formatDate(f.check_in_date) : '',
    check_out: f.check_out_date ? formatDate(f.check_out_date) : '',
    company: f.company_name || '',
  }));
}

async function getOnResvBal(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      status_reservation: { in: [1, 2] },
      is_pos_trx: false,
      total_amount: { gt: 0 },
    },
    orderBy: { total_amount: 'desc' },
    include: {
      reservations: {
        where: { deleted_at: null },
        select: { room_name: true, room_type_name: true },
      },
    },
  });

  return folios.map((f: any) => ({
    folio_number: f.folio_number,
    guest_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
    room_name: f.reservations?.[0]?.room_name || '',
    room_type: f.reservations?.[0]?.room_type_name || '',
    check_in: f.check_in_date ? formatDate(f.check_in_date) : '',
    check_out: f.check_out_date ? formatDate(f.check_out_date) : '',
    total_amount: Number(f.total_amount),
    status: f.status_reservation === 2 ? 'In House' : 'Reservation',
  }));
}

async function getRoomDivision(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const reservations = await prisma.reservations.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      date: {
        gte: new Date(`${startDate}T00:00:00Z`),
        lte: new Date(`${endDate}T23:59:59Z`),
      },
    },
    include: {
      room_types: { select: { name: true } },
    },
  });

  const byType: Record<string, { count: number; revenue: number }> = {};
  for (const r of reservations) {
    const name = r.room_types?.name || r.room_type_name || 'Unknown';
    if (!byType[name]) byType[name] = { count: 0, revenue: 0 };
    byType[name].count += r.night || 0;
    byType[name].revenue += Number(r.amount);
  }

  return Object.entries(byType).map(([roomType, vals]) => ({
    room_type: roomType,
    room_nights: vals.count,
    revenue: vals.revenue,
  }));
}

async function getNationalityStatistic(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      is_pos_trx: false,
      nationality_id: { not: null },
    },
    select: { nationality_id: true },
  });

  const counts: Record<number, number> = {};
  for (const f of folios) {
    const nid = f.nationality_id || 0;
    counts[nid] = (counts[nid] || 0) + 1;
  }

  const nationalities = await prisma.countries.findMany({
    where: { id: { in: Object.keys(counts).map(Number) } },
    select: { id: true, name: true, nationality: true },
  });

  const natMap = new Map(nationalities.map((n: any) => [Number(n.id), n]));

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => {
      const nat = natMap.get(Number(id));
      return {
        nationality: nat?.nationality || nat?.name || `ID ${id}`,
        country: nat?.name || '',
        count,
      };
    });
}

async function getExpectedArrivalSummary(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      check_in_date: {
        gte: new Date(`${date}T00:00:00Z`),
        lte: new Date(`${date}T23:59:59Z`),
      },
      status_reservation: { in: [0, 1] },
      is_pos_trx: false,
    },
    orderBy: { check_in_date: 'asc' },
    include: {
      reservations: {
        where: { deleted_at: null },
        select: { room_type_name: true, night: true, adult: true, child: true },
      },
    },
  });

  return folios.map((f: any) => ({
    folio_number: f.folio_number,
    guest_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
    room_type: f.reservations?.[0]?.room_type_name || '',
    night: f.reservations?.[0]?.night || 0,
    adult: f.reservations?.[0]?.adult || 0,
    child: f.reservations?.[0]?.child || 0,
    company: f.company_name || '',
    status: f.status_reservation === 1 ? 'Reservation' : 'Pending',
  }));
}

async function getExpectedDepartureSummary(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      check_out_date: {
        gte: new Date(`${date}T00:00:00Z`),
        lte: new Date(`${date}T23:59:59Z`),
      },
      status_reservation: { in: [1, 2] },
      is_pos_trx: false,
    },
    orderBy: { check_out_date: 'asc' },
    include: {
      reservations: {
        where: { deleted_at: null },
        select: { room_name: true, room_type_name: true },
      },
    },
  });

  return folios.map((f: any) => ({
    folio_number: f.folio_number,
    guest_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
    room_name: f.reservations?.[0]?.room_name || '',
    room_type: f.reservations?.[0]?.room_type_name || '',
    check_out: f.check_out_date ? formatDate(f.check_out_date) : '',
    company: f.company_name || '',
    total_amount: Number(f.total_amount),
  }));
}

async function getTransactionReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const transactions = await prisma.transactions.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      date: {
        gte: new Date(`${startDate}T00:00:00Z`),
        lte: new Date(`${endDate}T23:59:59Z`),
      },
    },
    orderBy: { date: 'desc' },
    include: {
      folios: { select: { folio_number: true } },
      type_payments: { select: { name: true } },
    },
  });

  return transactions.map((t: any) => ({
    date: t.date ? formatDate(t.date) : '',
    folio_number: t.folios?.folio_number || '',
    code: t.code || '',
    code_name: t.code_name || '',
    description: t.description || '',
    amount: Number(t.amount),
    total: Number(t.total),
    type_amount: t.type_amount || '',
    type_payment: t.type_payments?.name || '',
  }));
}

async function getCashDetailed(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const transactions = await prisma.transactions.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      type: 'cash',
      date: {
        gte: new Date(`${startDate}T00:00:00Z`),
        lte: new Date(`${endDate}T23:59:59Z`),
      },
    },
    orderBy: { date: 'desc' },
    include: {
      folios: { select: { folio_number: true, first_name: true, last_name: true } },
      type_payments: { select: { name: true } },
    },
  });

  return transactions.map((t: any) => ({
    date: t.date ? formatDate(t.date) : '',
    folio_number: t.folios?.folio_number || '',
    guest: `${t.folios?.first_name || ''} ${t.folios?.last_name || ''}`.trim(),
    code: t.code || '',
    description: t.description || '',
    amount: Number(t.amount),
    total: Number(t.total),
    payment_type: t.type_payments?.name || '',
    receipt: t.receipt || '',
  }));
}

async function getCashSummary(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const transactions = await prisma.transactions.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      type: 'cash',
      date: {
        gte: new Date(`${startDate}T00:00:00Z`),
        lte: new Date(`${endDate}T23:59:59Z`),
      },
    },
    include: {
      type_payments: { select: { name: true } },
    },
  });

  const byPayment: Record<string, { count: number; total: number }> = {};
  for (const t of transactions) {
    const name = t.type_payments?.name || 'Other';
    if (!byPayment[name]) byPayment[name] = { count: 0, total: 0 };
    byPayment[name].count += 1;
    byPayment[name].total += Number(t.total);
  }

  return Object.entries(byPayment).map(([paymentType, vals]) => ({
    payment_type: paymentType,
    transaction_count: vals.count,
    total_amount: vals.total,
  }));
}

async function getDailySalesReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const transactions = await prisma.transactions.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      date: {
        gte: new Date(`${startDate}T00:00:00Z`),
        lte: new Date(`${endDate}T23:59:59Z`),
      },
    },
    include: {
      type_payments: { select: { name: true } },
    },
  });

  const byDate: Record<string, { count: number; total: number; cash: number; nonCash: number }> = {};
  for (const t of transactions) {
    const d = t.date ? formatDate(t.date) : 'Unknown';
    if (!byDate[d]) byDate[d] = { count: 0, total: 0, cash: 0, nonCash: 0 };
    byDate[d].count += 1;
    byDate[d].total += Number(t.total);
    if (t.type === 'cash') {
      byDate[d].cash += Number(t.total);
    } else {
      byDate[d].nonCash += Number(t.total);
    }
  }

  return Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, vals]) => ({
      date: d,
      transaction_count: vals.count,
      total_sales: vals.total,
      cash: vals.cash,
      non_cash: vals.nonCash,
    }));
}

async function getDailyRevenueReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const accountings = await prisma.accountings.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      type_accounting: 'invoice',
      date: {
        gte: new Date(`${startDate}T00:00:00Z`),
        lte: new Date(`${endDate}T23:59:59Z`),
      },
    },
  });

  const byDate: Record<string, { invoice_count: number; total_revenue: number; pb1: number; service_charge: number }> = {};
  for (const a of accountings) {
    const d = a.date ? formatDate(a.date) : 'Unknown';
    if (!byDate[d]) byDate[d] = { invoice_count: 0, total_revenue: 0, pb1: 0, service_charge: 0 };
    byDate[d].invoice_count += 1;
    byDate[d].total_revenue += Number(a.total);
    byDate[d].pb1 += Number(a.pb1);
    byDate[d].service_charge += Number(a.svr_chrg);
  }

  return Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, vals]) => ({
      date: d,
      invoice_count: vals.invoice_count,
      total_revenue: vals.total_revenue,
      pb1: vals.pb1,
      service_charge: vals.service_charge,
    }));
}

async function getGuestLedgerReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const folioId = params.folioId;

  const where: any = {
    property_id: pid,
    deleted_at: null,
  };

  if (folioId) {
    where.folio_id = BigInt(folioId);
  }

  const transactions = await prisma.transactions.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 200,
    include: {
      folios: { select: { folio_number: true, first_name: true, last_name: true } },
    },
  });

  return transactions.map((t: any) => ({
    date: t.date ? formatDate(t.date) : '',
    folio_number: t.folios?.folio_number || '',
    guest: `${t.folios?.first_name || ''} ${t.folios?.last_name || ''}`.trim(),
    code: t.code || '',
    code_name: t.code_name || '',
    description: t.description || '',
    debit: t.type_amount === 'PLUS' ? Number(t.total) : 0,
    credit: t.type_amount === 'MINUS' ? Number(t.total) : 0,
    balance: Number(t.total),
  }));
}

function safeStringify(v: any): string {
  return JSON.stringify(v, (_k: string, val: any) => (typeof val === 'bigint' ? val.toString() : val));
}

function getGenericReport(name: string, params: any): any[] {
  return [{
    report: name,
    message: 'Report data not yet implemented',
    params: safeStringify(params),
  }];
}

const reportHandlers: Record<string, (params: any) => Promise<any[]>> = {
  'batch/after-night-audit/daily-statistic': getDailyStatistic,
  'batch/after-night-audit/in-house-folio-balance': getInHouseFolioBalance,
  'batch/after-night-audit/vacant-rooms': getVacantRooms,
  'batch/after-night-audit/no-show': getNoShow,
  'batch/after-night-audit/on-resv-bal': getOnResvBal,
  'batch/after-night-audit/room-division': getRoomDivision,
  'batch/after-night-audit/nationality-statistic': getNationalityStatistic,
  'batch/after-night-audit/expected-arrival-summary': getExpectedArrivalSummary,
  'batch/after-night-audit/expected-departure-summary': getExpectedDepartureSummary,
  'account/transaction-report': getTransactionReport,
  'account/cash-detailed': getCashDetailed,
  'account/cash-summary': getCashSummary,
  'batch/frontoffice/daily-sales-report': getDailySalesReport,
  'batch/frontoffice/daily-revenue-report': getDailyRevenueReport,
  'account/guest-ledger-report': getGuestLedgerReport,
  'batch/after-night-audit/daily-statistic/view': getDailyStatistic,
  'batch/after-night-audit/in-house-folio-balance/view': getInHouseFolioBalance,
  'batch/after-night-audit/vacant-rooms/view': getVacantRooms,
  'batch/after-night-audit/no-show/view': getNoShow,
  'batch/after-night-audit/on-resv-bal/view': getOnResvBal,
  'batch/after-night-audit/room-division/view': getRoomDivision,
  'batch/after-night-audit/nationality-statistic/view': getNationalityStatistic,
  'batch/after-night-audit/expected-arrival-summary/view': getExpectedArrivalSummary,
  'batch/after-night-audit/expected-departure-summary/view': getExpectedDepartureSummary,
  'account/transaction-report/view': getTransactionReport,
  'account/cash-detailed/view': getCashDetailed,
  'account/cash-summary/view': getCashSummary,
  'batch/frontoffice/daily-sales-report/view': getDailySalesReport,
  'batch/frontoffice/daily-revenue-report/view': getDailyRevenueReport,
  'account/guest-ledger-report/view': getGuestLedgerReport,
};

// ── Controller ──────────────────────────────────────────────────────

export class ReportController {

  static async batchList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.batch_report.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.batch_report.count({ where }),
      ]);

      const formatted = data.map((r: any) => bigintToNumber(r));

      success(res, formatted, 'Success', 200, {
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
      console.error('Report batchList error:', err);
      error(res, 'Failed to fetch batch reports', 500);
    }
  }

  static async batchSave(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id;

      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }

      const record = await prisma.batch_report.create({
        data: {
          property_id: pid,
          batch_name: body.batch_name || '',
          batch_list: body.batch_list ? JSON.stringify(body.batch_list) : '[]',
          created_at: new Date(),
          updated_at: new Date(),
          created_by: userId ? BigInt(userId) : undefined,
          status: 1,
        },
      });

      success(res, bigintToNumber(record), 'Batch report saved successfully', 201);
    } catch (err: any) {
      console.error('Report batchSave error:', err);
      error(res, 'Failed to save batch report', 500);
    }
  }

  static async reportPermission(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const user: any = userId ? await prisma.users.findUnique({ where: { id: BigInt(userId) } }) : null;

      const permissions = await prisma.report_permissions.findMany({
        where: {
          role_id: user ? BigInt(user.role_id) : 0n,
          status: 1,
        },
      });

      const data = permissions.map((p: any) => bigintToNumber(p));

      success(res, data, 'Success');
    } catch (err: any) {
      console.error('Report permission error:', err);
      error(res, 'Failed to fetch report permissions', 500);
    }
  }

  static async reportPermissionList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = {};

      const [data, total] = await Promise.all([
        prisma.report_permissions.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.report_permissions.count({ where }),
      ]);

      const formatted = data.map((r: any) => bigintToNumber(r));

      success(res, formatted, 'Success', 200, {
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
      console.error('Report permissionList error:', err);
      error(res, 'Failed to fetch report permissions list', 500);
    }
  }

  static async handleReport(req: Request, res: Response): Promise<void> {
    try {
      const path = req.params[0] as string || '';
      const pid = req.user?.lastProperty ?? 0n;
      const params = { ...parseReportParams(req), propertyId: pid, folioId: req.query.folio_id as string || '' };

      const segments = path.split('/').filter(Boolean);
      const typeOps = req.query.typeOps as string || '';

      const reportKey = typeOps === 'view' ? `${path}/view` : path;

      if (reportHandlers[reportKey]) {
        const data = await reportHandlers[reportKey](params);

        if (typeOps === 'view') {
          const fileName = segments.join('-') || 'report';
          await generateExcel(res, data, Object.keys(data[0] || {}).map((k) => ({
            header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            key: k,
          })), fileName);
        } else {
          success(res, data, 'Success', 200, {
            pagging: {
              current_page: 1,
              last_page: 1,
              per_page: data.length,
              total: data.length,
              from: 0,
              to: data.length,
            },
          });
        }
      } else {
        const data = getGenericReport(path, params);
        success(res, data, 'Success', 200, {
          pagging: {
            current_page: 1,
            last_page: 1,
            per_page: data.length,
            total: data.length,
            from: 0,
            to: data.length,
          },
        });
      }
    } catch (err: any) {
      console.error('Report handleReport error:', err);
      error(res, 'Failed to process report', 500);
    }
  }

  static async folioDocument(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const documentType = req.params.documentType;
      const typeOps = req.query.typeOps as string || '';

      if (!id || !documentType) {
        badRequest(res, 'Folio ID and document type are required');
        return;
      }

      const folio: any = await prisma.folios.findUnique({
        where: { id: BigInt(id) },
        include: {
          reservations: {
            where: { deleted_at: null },
            include: { room_types: { select: { name: true } } },
          },
          transactions: {
            where: { deleted_at: null },
            orderBy: { date: 'desc' },
            take: 100,
          },
        },
      });

      if (!folio) {
        notFound(res, 'Folio not found');
        return;
      }

      const rows = [{
        document_type: documentType,
        folio_number: folio.folio_number,
        guest_name: `${folio.first_name || folio.guest_profiles?.first_name || ''} ${folio.last_name || folio.guest_profiles?.last_name || ''}`.trim(),
        check_in: folio.check_in_date ? formatDate(folio.check_in_date) : '',
        check_out: folio.check_out_date ? formatDate(folio.check_out_date) : '',
        total_amount: Number(folio.total_amount),
        transaction_count: folio.transactions?.length || 0,
        room_type: folio.reservations?.[0]?.room_types?.name || folio.reservations?.[0]?.room_type_name || '',
        room_name: folio.reservations?.[0]?.room_name || '',
      }];

      if (typeOps === 'view') {
        const columns = Object.keys(rows[0]).map((k) => ({
          header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          key: k,
        }));
        await generateExcel(res, rows, columns, `folio-${folio.folio_number}-${documentType}`);
      } else {
        success(res, bigintToNumber(folio), 'Success');
      }
    } catch (err: any) {
      console.error('Report folioDocument error:', err);
      error(res, 'Failed to load folio document', 500);
    }
  }

  static async eventReport(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const reportType = req.params.reportType;
      const typeOps = req.query.typeOps as string || '';

      if (!id || !reportType) {
        badRequest(res, 'Event ID and report type are required');
        return;
      }

      const event: any = await prisma.event_events.findUnique({
        where: { id: parseInt(id) },
        include: {
          event_packages: true,
          event_venues: true,
          event_layouts: true,
          event_instructions: true,
          event_deposit_plans: true,
        },
      });

      if (!event) {
        notFound(res, 'Event not found');
        return;
      }

      const rows = [{
        report_type: reportType,
        event_name: event.name || '',
        event_date: event.date ? formatDate(event.date) : '',
        venue: event.venue_name || '',
        total_guest: event.total_guest || 0,
        status: event.status || 0,
      }];

      if (typeOps === 'view') {
        const columns = Object.keys(rows[0]).map((k) => ({
          header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          key: k,
        }));
        await generateExcel(res, rows, columns, `event-${id}-${reportType}`);
      } else {
        success(res, bigintToNumber(event), 'Success');
      }
    } catch (err: any) {
      console.error('Report eventReport error:', err);
      error(res, 'Failed to load event report', 500);
    }
  }

  static async companyProfileReport(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const typeOps = req.query.typeOps as string || '';

      const companies = await prisma.company_profiles.findMany({
        where: { property_id: pid, deleted_at: null },
        orderBy: { name: 'asc' },
        take: 200,
      });

      const rows = companies.map((c: any) => ({
        name: c.name || '',
        type: c.type_company || '',
        account: c.account || '',
        email: c.email || '',
        phone: c.telp || c.mobile_phone || '',
        city: c.billing_city || '',
        country: c.billing_country || '',
        credit_limit: Number(c.credit_limit),
        remaining: Number(c.remaining),
        status: c.status_company || '',
      }));

      if (typeOps === 'view') {
        const columns = [
          { header: 'Company Name', key: 'name', width: 30 },
          { header: 'Type', key: 'type', width: 15 },
          { header: 'Account', key: 'account', width: 15 },
          { header: 'Email', key: 'email', width: 25 },
          { header: 'Phone', key: 'phone', width: 20 },
          { header: 'City', key: 'city', width: 20 },
          { header: 'Country', key: 'country', width: 20 },
          { header: 'Credit Limit', key: 'credit_limit', width: 15 },
          { header: 'Remaining', key: 'remaining', width: 15 },
          { header: 'Status', key: 'status', width: 15 },
        ];
        await generateExcel(res, rows, columns, 'company-profiles');
      } else {
        success(res, rows, 'Success', 200, {
          pagging: {
            current_page: 1,
            last_page: 1,
            per_page: rows.length,
            total: rows.length,
            from: 0,
            to: rows.length,
          },
        });
      }
    } catch (err: any) {
      console.error('Report companyProfileReport error:', err);
      error(res, 'Failed to load company profile report', 500);
    }
  }

  static async guestListingReport(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const typeOps = req.query.typeOps as string || '';
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null, is_pos_trx: false };
      const statusFilter = req.query.status_reservation as string;
      if (statusFilter) {
        const statusMap: Record<string, number> = { reservation: 1, check_in: 2, check_out: 3, cancel: 4, pending: 0 };
        where.status_reservation = statusMap[statusFilter] ?? undefined;
      }

      if (req.query.start_date || req.query.startDate) {
        const sd = req.query.startDate || req.query.start_date;
        where.check_in_date = { ...where.check_in_date, gte: new Date(`${sd}T00:00:00Z`) };
      }
      if (req.query.end_date || req.query.endDate) {
        const ed = req.query.endDate || req.query.end_date;
        where.check_in_date = { ...where.check_in_date, lte: new Date(`${ed}T23:59:59Z`) };
      }

      if (typeOps === 'view') {
        const allData = await prisma.folios.findMany({
          where,
          orderBy: { check_in_date: 'desc' },
          take: 5000,
          include: {
            reservations: {
              where: { deleted_at: null },
              select: { room_name: true, room_type_name: true, night: true, adult: true, child: true },
            },
          },
        });

        const rows = allData.map((f: any) => ({
          folio_number: f.folio_number,
          guest_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
          check_in: f.check_in_date ? formatDate(f.check_in_date) : '',
          check_out: f.check_out_date ? formatDate(f.check_out_date) : '',
          room_type: f.reservations?.[0]?.room_type_name || '',
          room_name: f.reservations?.[0]?.room_name || '',
          night: f.reservations?.[0]?.night || 0,
          adult: f.reservations?.[0]?.adult || 0,
          child: f.reservations?.[0]?.child || 0,
          company: f.company_name || '',
          total_amount: Number(f.total_amount),
        }));

        const columns = [
          { header: 'Folio Number', key: 'folio_number', width: 18 },
          { header: 'Guest Name', key: 'guest_name', width: 25 },
          { header: 'Check In', key: 'check_in', width: 14 },
          { header: 'Check Out', key: 'check_out', width: 14 },
          { header: 'Room Type', key: 'room_type', width: 18 },
          { header: 'Room', key: 'room_name', width: 12 },
          { header: 'Night', key: 'night', width: 8 },
          { header: 'Adult', key: 'adult', width: 8 },
          { header: 'Child', key: 'child', width: 8 },
          { header: 'Company', key: 'company', width: 20 },
          { header: 'Total Amount', key: 'total_amount', width: 15 },
        ];
        await generateExcel(res, rows, columns, 'guest-listing-report');
      } else {
        const [data, total] = await Promise.all([
          prisma.folios.findMany({
            where,
            orderBy: { check_in_date: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            include: {
              reservations: {
                where: { deleted_at: null },
                select: { room_name: true, room_type_name: true, night: true, adult: true, child: true },
              },
            },
          }),
          prisma.folios.count({ where }),
        ]);

        const rows = data.map((f: any) => ({
          id: Number(f.id),
          folio_number: f.folio_number,
          guest_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
          check_in: f.check_in_date ? formatDate(f.check_in_date) : '',
          check_out: f.check_out_date ? formatDate(f.check_out_date) : '',
          room_type: f.reservations?.[0]?.room_type_name || '',
          room_name: f.reservations?.[0]?.room_name || '',
          night: f.reservations?.[0]?.night || 0,
          adult: f.reservations?.[0]?.adult || 0,
          child: f.reservations?.[0]?.child || 0,
          company: f.company_name || '',
          total_amount: Number(f.total_amount),
        }));

        success(res, rows, 'Success', 200, {
          pagging: {
            current_page: page,
            last_page: Math.ceil(total / limit),
            per_page: limit,
            total,
            from: (page - 1) * limit + 1,
            to: Math.min(page * limit, total),
          },
        });
      }
    } catch (err: any) {
      console.error('Report guestListingReport error:', err);
      error(res, 'Failed to load guest listing report', 500);
    }
  }

  static async guestListingReportCms(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null, is_pos_trx: false };

      const [data, total] = await Promise.all([
        prisma.folios.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            reservations: {
              where: { deleted_at: null },
              select: { room_name: true, room_type_name: true, night: true, adult: true, child: true },
            },
          },
        }),
        prisma.folios.count({ where }),
      ]);

      const rows = data.map((f: any) => ({
        id: Number(f.id),
        folio_number: f.folio_number,
        guest_name: `${f.guest_profiles?.first_name || f.first_name || ''} ${f.guest_profiles?.last_name || f.last_name || ''}`.trim(),
        check_in: f.check_in_date ? formatDate(f.check_in_date) : '',
        check_out: f.check_out_date ? formatDate(f.check_out_date) : '',
        room_type: f.reservations?.[0]?.room_type_name || '',
        room_name: f.reservations?.[0]?.room_name || '',
        night: f.reservations?.[0]?.night || 0,
        adult: f.reservations?.[0]?.adult || 0,
        child: f.reservations?.[0]?.child || 0,
        total_amount: Number(f.total_amount),
      }));

      success(res, rows, 'Success', 200, {
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
      console.error('Report guestListingReportCms error:', err);
      error(res, 'Failed to load guest listing', 500);
    }
  }

  static async nightAudit(req: Request, res: Response): Promise<void> {
    try {
      const today = formatDate(new Date());
      success(res, { business_date: today }, 'Success');
    } catch (err: any) {
      console.error('Report nightAudit error:', err);
      error(res, 'Failed to get business date', 500);
    }
  }

  static async staffList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const users = await prisma.users.findMany({
        where: { property_id: pid, deleted_at: null, status: 1 },
        select: { id: true, name: true, username: true, email: true },
        orderBy: { name: 'asc' },
      });

      success(res, users.map((u: any) => bigintToNumber(u)), 'Success');
    } catch (err: any) {
      console.error('Report staffList error:', err);
      error(res, 'Failed to fetch staff list', 500);
    }
  }

  static async masterCountries(req: Request, res: Response): Promise<void> {
    try {
      const countries = await prisma.countries.findMany({
        where: { status: true },
        select: { id: true, name: true, iso2: true, iso3: true, nationality: true },
        orderBy: { name: 'asc' },
      });

      success(res, countries.map((c: any) => bigintToNumber(c)), 'Success');
    } catch (err: any) {
      console.error('Report masterCountries error:', err);
      error(res, 'Failed to fetch countries', 500);
    }
  }

  static async cityByCountry(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity (CountryController@getCityByCountry): param name is `country`
      const countryId = (req.query.country as string) || (req.query.country_id as string);
      if (!countryId || countryId === 'undefined' || countryId === 'null' || countryId === '') {
        // Frontend may send literal "undefined" -> return empty list, not 500 (matches Laravel empty result)
        success(res, [], 'Success');
        return;
      }

      const cities = await prisma.cities.findMany({
        where: { country_id: BigInt(countryId) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      success(res, cities.map((c: any) => ({ value: Number(c.id), label: c.name })), 'Success');
    } catch (err: any) {
      console.error('Report cityByCountry error:', err);
      error(res, 'Failed to fetch cities', 500);
    }
  }
}
