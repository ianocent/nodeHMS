import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import ExcelJS from 'exceljs';
import { success, error, badRequest, notFound } from '../utils/response';
import { STATUSES } from '../utils/cmsConfig';

const STATUS_RESERVATION_CANCEL = 2; // config cms.status_reservation.cancel_reservation.id

// Laravel ReportPermission::formatTable parity
const REPORT_PERMISSION_TABLE = [
  { label: 'No', key: 'no', type: 'none', is_search: false },
  { label: 'Status', key: 'status', type: 'checkbox', options: STATUSES, is_search: false },
  { label: 'Name', key: 'master_report', type: 'select_multiple', is_search: false },
  { label: 'Role', key: 'role_id', type: 'select', is_search: false },
  { label: 'Action', key: 'action', type: 'action', is_search: false },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

function isNumeric(v: any): boolean {
  return v !== '' && v !== null && !isNaN(Number(v));
}

function formatDate(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatDateDMY(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

function formatDateDMYShort(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(2)}`;
}

function formatDateMYShort(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}-${String(dt.getFullYear()).slice(2)}`;
}

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatLongDate(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getDate()} ${LONG_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

function diffDays(a: any, b: any): number {
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDMYDash(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}-${SHORT_MONTHS[dt.getMonth()]}-${dt.getFullYear()}`;
}

function formatMonthDayYear(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${LONG_MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

async function revenueBetween(pid: any, s: Date, e: Date, type?: string): Promise<number> {
  // Generic revenue aggregator for reports. Matches previous behaviour: sum of `amount` in `transactions`.
  const where: any = { property_id: pid, date: { gte: s, lte: e }, deleted_at: null };
  if (type) {
    // attempt to match common post/transaction naming by case-insensitive contains
    where.post_name = { contains: type, mode: 'insensitive' };
  }
  try {
    const res = await prisma.transactions.aggregate({ where, _sum: { amount: true } });
    return Number(res._sum?.amount ?? 0);
  } catch (err) {
    console.warn('revenueBetween aggregator error', err);
    return 0;
  }
}

function toJPY(amount: number, kurs?: any): number {
  const k = Number(kurs ?? process.env.DEFAULT_KURS_JPY ?? 0) || 0;
  if (!k) return 0;
  const val = Number(amount ?? 0) / k;
  // round to 2 decimals
  return Math.round(val * 100) / 100;
}

function columnLetterFromIndex(index: number): string {
  let letter = '';
  let current = index;

  while (current > 0) {
    const rem = (current - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    current = Math.floor((current - 1) / 26);
  }

  return letter;
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

  const sanitized = data.map(bigintToNumber);
  ws.addRows(sanitized);

  if (data.length > 0) {
    const summaryRow = ws.addRow({});
    const dataCount = data.length;

    columns.forEach((column, index) => {
      const key = column.key;
      const numericValues = sanitized
        .map((row) => Number(row?.[key]))
        .filter((value) => Number.isFinite(value));

      if (numericValues.length === 0) {
        return;
      }

      const letter = columnLetterFromIndex(index + 1);
      const cell = summaryRow.getCell(index + 1);
      cell.value = {
        formula: `SUM(${letter}1:${letter}${dataCount})`,
        result: numericValues.reduce((sum, value) => sum + value, 0),
      };
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9F2FF' } };

      if (index === 0) {
        cell.value = 'TOTAL';
      }
    });
  }

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

// Laravel parity: DailyFlashReportController -> daily-flash-report.blade.php
// Layout: title + meta row, 7 columns (STATISTIC x Today/MTD/MTDLastMonth/MTDBudget/MTDVariance/YTD),
// sections ROOMS STATISTICS (incl. per room-type rows), AVERAGE RATE, OCCUPANCY.
async function generateDailyFlashExcel(res: Response, row: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Daily Flash Report');
  const HEADERS = ['STATISTIC', 'Today Actual', 'MTD Actual', 'MTD Last Month', 'MTD Budget', 'MTD Variance', 'YTD Actual'];
  const PERIODS = ['todayActual', 'mtdActual', 'mtdLastMonth', 'mtdBudget', 'mtdVariance', 'ytdActual'];
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

  const fmtCount = (p: string, k: string) => Number(row?.[p]?.[k] ?? 0);
  const fmtRate = (p: string, k: string) => Number(row?.[p]?.[k] ?? 0).toFixed(2);
  const fmtPct = (p: string, k: string) => `${Number(row?.[p]?.[k] ?? 0).toFixed(2)}%`;

  ws.columns = HEADERS.map((h) => ({ header: h, key: h, width: 26 }));

  ws.mergeCells(1, 1, 1, 7);
  const title = ws.getCell(1, 1);
  title.value = String(row.reportTitle || 'Daily Flash Report').toUpperCase();
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };

  ws.mergeCells(2, 1, 2, 7);
  const meta = ws.getCell(2, 1);
  meta.value = `Report Date: ${row.reportDate || ''}   Period: ${row.startDate || ''} - ${row.endDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };

  const headerRow = ws.getRow(3);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
  headerRow.eachCell((c: any) => { c.border = border; });

  const section = (label: string) => {
    const r = ws.addRow([label]);
    ws.mergeCells(r.getCell(1).address, r.getCell(7).address);
    r.font = { bold: true };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    r.eachCell((c: any) => { c.border = border; });
    return r;
  };
  const statRow = (label: string, key: string, fmt: (p: string, k: string) => any) => {
    const r = ws.addRow([label, ...PERIODS.map((p) => fmt(p, key))]);
    r.eachCell((c: any) => { c.border = border; });
    return r;
  };

  section('ROOMS STATISTICS');
  statRow('TOTAL AVAILABLE ROOM', 'totalAvailableRoom', fmtCount);
  statRow('TOTAL BLOCK / OOO ROOM', 'totalBlockedRoom', fmtCount);
  statRow('TOTAL OCCUPIED ROOM', 'totalOccupiedRoom', fmtCount);
  statRow('TOTAL ROOM SOLD (Excl. HSE & COM)', 'totalRoomSold', fmtCount);

  const roomTypes = row.roomTypes || [];
  const roomTypeSales = row.roomTypeSales || {};
  for (const rt of roomTypes) {
    const s = roomTypeSales[String(rt.id)] || {};
    const r = ws.addRow(['- ' + rt.name, ...PERIODS.map((p) => Number(s[p] ?? 0))]);
    r.eachCell((c: any) => { c.border = border; });
  }

  statRow('TOTAL HOUSE USE (HSE)', 'totalHouseUse', fmtCount);
  statRow('TOTAL COMPLIMENTARY (COM)', 'totalComplimentary', fmtCount);
  statRow('TOTAL SALEABLE ROOM', 'totalSaleableRoom', fmtCount);
  statRow('TOTAL VACANT ROOM', 'totalVacantRoom', fmtCount);
  statRow('TOTAL WALK IN', 'totalWalkIn', fmtCount);
  statRow('TOTAL DAYUSE', 'totalDayUse', fmtCount);
  statRow('TOTAL INHOUSE GUESTS (Excl. HSE)', 'totalInHouseGuests', fmtCount);
  section('AVERAGE RATE');
  statRow('AVERAGE ROOM RATE (ARR)', 'averageRoomRate', fmtRate);
  statRow('AVERAGE ROOM RATE (INC BF)', 'averageRoomRateIncBF', fmtRate);
  statRow('REVENUE PER AVAIL. ROOM (REVPAR)', 'revenuePerAvailableRoom', fmtRate);
  section('OCCUPANCY');
  statRow('% ROOM SALEABLE OCCUPANCY', 'roomSaleableOccupancy', fmtPct);
  statRow('% ROOM AVAILABLE OCCUPANCY', 'roomAvailableOccupancy', fmtPct);
  statRow('% OCCUPIED ROOM OCCUPANCY', 'occupiedRoomOccupancy', fmtPct);
  statRow('% DOUBLE OCCUPANCY', 'doubleOccupancy', fmtPct);

  ws.eachRow({ includeEmpty: false }, (r: any, rn: number) => {
    if (rn < 3) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.border = border;
      c.alignment = { horizontal: cn === 1 ? 'left' : 'right' };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-flash-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Account Daily Revenue Report ──
// Laravel parity: DailyRevenueReportService + daily-revenue-report.blade.php
// Sections: STATISTICS (10 cols today/mtd/ytd x actual/budget/variance), ROOM ACTIVITIES,
// ROOM REVENUE (per billing/post), PAYMENT, LEDGER CONTROL BALANCE.

async function calcDailyRevPeriod(
  pid: bigint,
  s: string,
  e: string,
  roomTypes: any[],
  complimentRateIds: bigint[],
  houseUseRateIds: bigint[],
  yearBudgets: any[],
  ongoingDay: number,
  ongoingMonth: number,
  totalDaysInMonth: number
): Promise<any> {
  const start = new Date(`${s}T00:00:00Z`);
  const end = new Date(`${e}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));

  const [activeRooms, vacantRooms, workOrders, resvs] = await Promise.all([
    prisma.rooms.count({ where: { property_id: pid, status: 1, deleted_at: null } }),
    prisma.rooms.count({ where: { property_id: pid, room_status: 0, deleted_at: null } }),
    prisma.work_orders.findMany({
      where: {
        property_id: pid,
        room_id: { not: null },
        deleted_at: null,
        date: { lte: end },
        OR: [{ end_date: null }, { end_date: { gte: start } }],
      },
      select: { id: true, room_id: true, date: true, end_date: true },
    }),
    prisma.reservations.findMany({
      where: {
        property_id: pid,
        deleted_at: null,
        date: { gte: start, lte: end },
        folios: {
          is: {
            status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] },
            type_reservation: { in: ['fit', 'git', 'vr'] },
          },
        },
      },
      select: {
        id: true, date: true, room_type_id: true, adult: true, child: true, rate_id: true,
        folios: { select: { id: true, is_house_use: true, complimentary: true, check_in_date: true, check_out_date: true, folio_number: true } },
      },
    }),
  ]);

  // blocked = distinct rooms per day where work_order active that day
  let totalBlocked = 0;
  const dayMap = new Map<string, number>();
  for (let d = 0; d < days; d++) {
    const dd = new Date(start.getTime() + d * 86400000);
    const key = dd.toISOString().slice(0, 10);
    const rooms = new Set<bigint>();
    for (const wo of workOrders) {
      const woDate = wo.date ? wo.date.toISOString().slice(0, 10) : '';
      const woEnd = wo.end_date ? wo.end_date.toISOString().slice(0, 10) : '';
      if (woDate <= key && (woEnd === '' || woEnd >= key) && wo.room_id) rooms.add(wo.room_id);
    }
    dayMap.set(key, rooms.size);
    totalBlocked += rooms.size;
  }

  const isFitGit = (f: any) => f && ['fit', 'git'].includes(f.type_reservation) ||
    (f && f.type_reservation === 'vr' && String(f.folio_number || '').startsWith('F'));

  let totalSold = 0;
  let totalComplimentary = 0;
  let totalHouseUse = 0;
  let totalDayUse = 0;
  let dayUseNights = 0;
  const dayUseFolioIds = new Set<bigint>();
  let totalInHouseGuests = 0;
  const roomTypeSales: Record<string, number> = {};
  roomTypes.forEach((t: any) => { roomTypeSales[t.name] = 0; });

  for (const r of resvs) {
    const f = r.folios as any;
    if (!f || !isFitGit(f)) continue;
    const cin = f.check_in_date ? f.check_in_date.toISOString().slice(0, 10) : '';
    const cout = f.check_out_date ? f.check_out_date.toISOString().slice(0, 10) : '';
    const isDayUse = cin !== '' && cin === cout;
    // Laravel houseUse: folio is_house_use OR rate type %house use%; comp: folio complimentary OR rate type %compliment%; independent counts
    if (f.is_house_use || (r.rate_id && houseUseRateIds.includes(r.rate_id))) totalHouseUse++;
    if (f.complimentary || (r.rate_id && complimentRateIds.includes(r.rate_id))) totalComplimentary++;
    if (f.is_house_use || (r.rate_id && houseUseRateIds.includes(r.rate_id))) continue;
    // Laravel in-house guests excludes house use only; includes complimentary + day use
    totalInHouseGuests += (r.adult || 0) + (r.child || 0);
    if (f.complimentary || (r.rate_id && complimentRateIds.includes(r.rate_id))) continue;
    if (isDayUse) { totalDayUse++; dayUseNights++; dayUseFolioIds.add(f.id); }
    else { totalSold++; const rt = roomTypes.find((t: any) => t.id === r.room_type_id); if (rt) roomTypeSales[rt.name] = (roomTypeSales[rt.name] || 0) + 1; }
  }

  // Laravel avg LOS: status in [check_in, check_out], house use 0, comp 0, day use, not rate compliment
  const losResvs = resvs.filter((r: any) => {
    const f = r.folios as any;
    if (!f || !isFitGit(f)) return false;
    if (![STATUS_RESERVATION_CHECK_IN, 1].includes(f.status_reservation)) return false;
    if (f.is_house_use || f.complimentary || (r.rate_id && (complimentRateIds.includes(r.rate_id) || houseUseRateIds.includes(r.rate_id)))) return false;
    const cin = f.check_in_date ? f.check_in_date.toISOString().slice(0, 10) : '';
    const cout = f.check_out_date ? f.check_out_date.toISOString().slice(0, 10) : '';
    return cin !== '' && cin === cout;
  });
  const losFolioIds = new Set(losResvs.map((r: any) => Number(r.folios.id)));

  const budgetOf = (type: string) => {
    const sm = Number(s.slice(5, 7));
    const em = Number(e.slice(5, 7));
    const posts = yearBudgets.filter((b: any) => b.type === type && b.month >= sm && b.month <= em);
    const monthly = posts.reduce((sum: number, b: any) => sum + Number(b.budget), 0);
    if (s === e) return monthly / totalDaysInMonth;
    if (sm === em) return (monthly / totalDaysInMonth) * days;
    let tot = 0;
    for (const b of posts) {
      if (b.month === em) tot += (Number(b.budget) / totalDaysInMonth) * ongoingDay;
      else tot += Number(b.budget);
    }
    return tot;
  };

  const totalAvailable = activeRooms * days;
  const totalAvailableBudget = budgetOf('total room available');
  const totalBlockedBudget = budgetOf('ooo rooms');
  const totalSoldBudget = budgetOf('total room sold');
  const totalSaleable = totalAvailable - totalBlocked;
  const totalSaleableBudget = totalAvailableBudget - totalBlockedBudget;
  const totalComplimentaryBudget = budgetOf('comp rooms');
  const totalHouseUseBudget = budgetOf('hse rooms');
  const totalDayUseBudget = budgetOf('total day use');
  const totalInHouseGuestsBudget = budgetOf('total no. of inhouse guest');

  const soldForOcc = totalSold + totalDayUse;
  const roomSaleableOcc = totalSaleable > 0 ? ((totalSold + totalDayUse) / totalSaleable) * 100 : 0;
  const roomSaleableOccWithCom = totalSaleable > 0 ? ((totalSold + totalComplimentary + totalHouseUse) / totalSaleable) * 100 : 0;
  const roomSaleableOccWithComDayUse = totalSaleable > 0 ? ((totalSold + totalComplimentary + totalDayUse + totalHouseUse) / totalSaleable) * 100 : 0;
  const roomAvailOcc = totalAvailable > 0 ? ((totalSold + totalDayUse) / totalAvailable) * 100 : 0;
  const roomAvailOccWithCom = totalAvailable > 0 ? ((totalSold + totalComplimentary + totalHouseUse) / totalAvailable) * 100 : 0;
  const roomAvailOccWithComDayUse = totalAvailable > 0 ? ((totalSold + totalComplimentary + totalDayUse + totalHouseUse) / totalAvailable) * 100 : 0;
  const doubleOcc = (totalSold + totalComplimentary + totalHouseUse) > 0 ? (totalInHouseGuests / (totalSold + totalComplimentary + totalHouseUse + totalDayUse)) / (totalSold + totalComplimentary + totalHouseUse) : 0;

  const avgRoomRate = soldForOcc > 0 ? await calcRoomRevenueNett(pid, s, e) / soldForOcc : 0;
  const revPAR = totalAvailable > 0 ? await calcRoomRevenueTransactions(pid, s, e) / totalAvailable : 0;

  return {
    totalAvailableRoom: totalAvailable,
    totalAvailableRoomBudget: totalAvailableBudget,
    totalBlockedRoom: totalBlocked,
    totalBlockedRoomBudget: totalBlockedBudget,
    totalRoomSold: totalSold,
    totalRoomSoldBudget: totalSoldBudget,
    roomTypeSales,
    totalComplimentary,
    totalComplimentaryBudget,
    totalHouseUse,
    totalHouseUseBudget,
    totalSaleableRoom: totalSaleable,
    totalSaleableRoomBudget: totalSaleableBudget,
    totalVacantRoom: vacantRooms,
    totalDayUse,
    totalDayUseBudget,
    totalInHouseGuests,
    totalInHouseGuestsBudget,
    averageRoomRate: Math.round(avgRoomRate * 100) / 100,
    roomSaleableOccupancy: Math.round(roomSaleableOcc * 100) / 100,
    roomSaleableOccupancyWithCOM: Math.round(roomSaleableOccWithCom * 100) / 100,
    roomSaleableOccupancyWithCOMDayUse: Math.round(roomSaleableOccWithComDayUse * 100) / 100,
    revenuePerAvailableRoom: Math.round(revPAR * 100) / 100,
    roomAvailableOccupancy: Math.round(roomAvailOcc * 100) / 100,
    roomAvailableOccupancyWithCOM: Math.round(roomAvailOccWithCom * 100) / 100,
    roomAvailableOccupancyWithCOMDayUse: Math.round(roomAvailOccWithComDayUse * 100) / 100,
    doubleOccupancy: Math.round(doubleOcc * 100) / 100,
    averageLengthOfStay: losFolioIds.size > 0 ? Math.round((losResvs.length / losFolioIds.size) * 100) / 100 : 0,
  };
}

async function calcRoomRevenueNett(pid: bigint, s: string, e: string): Promise<number> {
  // Laravel summaryTransactionTotal(): signed TOTAL (PLUS ? total : -total)
  const rows: any = await prisma.$queryRaw`
    SELECT COALESCE(SUM(CASE WHEN tb.type_amount = 'PLUS' THEN tb.total ELSE tb.total * -1 END), 0)::float8 AS total
    FROM transaction_breakdowns tb
    JOIN code_posts p ON tb.code = p.id::text
    JOIN code_billings cb ON cb.id = p.code_billing_id
    WHERE tb.property_id = ${pid}
      AND tb.date BETWEEN ${new Date(`${s}T00:00:00Z`)} AND ${new Date(`${e}T00:00:00Z`)}
      AND tb.type NOT IN ('payment', 'paidout', 'refund')
      AND LOWER(cb.name) LIKE '%room revenue%'`;
  return Number(rows[0]?.total || 0);
}

async function calcRoomRevenueTransactions(pid: bigint, s: string, e: string): Promise<number> {
  const agg = await prisma.transactions.aggregate({
    where: { property_id: pid, date: { gte: new Date(`${s}T00:00:00Z`), lte: new Date(`${e}T00:00:00Z`), }, type: 'room_revenue' },
    _sum: { amount: true },
  });
  return Number(agg._sum?.amount || 0);
}

async function getAccountDailyRevenueReport(params: any): Promise<any> {
  const pid = params.propertyId;
  const date = params.date || params.startDate || formatDate(new Date());
  const startOfMonth = `${date.slice(0, 8)}01`;
  const startOfYear = `${date.slice(0, 4)}-01-01`;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const totalDaysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ongoingDay = new Date().getDate();
  const ongoingMonth = new Date().getMonth() + 1;

  const roomTypes = (await prisma.room_types.findMany({
    where: { property_id: pid, deleted_at: null },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  })).filter((t: any) => !String(t.name || '').toUpperCase().includes('VIRTUAL'));

  const [budgets, codePostRoomRevenue, codeBillingRoomRevenue, codePostPayment, codeBillingPayment, rateRows] = await Promise.all([
    // Laravel index(): PostCodeBudget year only, withoutGlobalScope('property') (all properties)
    prisma.post_code_budgets.findMany({ where: { year: y } }),
    prisma.code_posts.findMany({ where: { property_id: pid, type: 'DEFAULT', deleted_at: null }, orderBy: { name: 'asc' } }),
    prisma.code_billings.findMany({ where: { property_id: pid, deleted_at: null }, orderBy: { name: 'asc' } }),
    prisma.code_posts.findMany({ where: { property_id: pid, type: { not: 'STATISTIC' }, deleted_at: null } }),
    prisma.code_billings.findMany({ where: { property_id: pid, deleted_at: null } }),
    prisma.rates.findMany({ where: { property_id: pid, deleted_at: null }, select: { id: true } }),
  ]);
  // Laravel excl rates = rate whose TYPE (model_has_types group company-type) name like compliment/house use
  const rateIdArr = rateRows.map((r: any) => r.id);
  const rateMht = rateIdArr.length ? await prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\Rate', model_id: { in: rateIdArr } }, select: { type_id: true, model_id: true } }) : [];
  const mhtTypeIds = [...new Set(rateMht.map((m: any) => Number(m.type_id)))];
  const rateTypes = mhtTypeIds.length ? await prisma.types.findMany({ where: { id: { in: mhtTypeIds }, group: 'company-type' }, select: { id: true, name: true } }) : [];
  const rateTypeName = new Map(rateTypes.map((t: any) => [Number(t.id), String(t.name || '').toLowerCase()]));
  // Laravel complimentary calc: rate type %compliment% only; house use calc: rate type %house use% only
  const complimentRateIds = [...new Set(rateMht.filter((m: any) => (rateTypeName.get(Number(m.type_id)) || '').includes('compliment')).map((m: any) => m.model_id))];
  const houseUseRateIds = [...new Set(rateMht.filter((m: any) => (rateTypeName.get(Number(m.type_id)) || '').includes('house use')).map((m: any) => m.model_id))];

  const billingName = (b: any) => String(b.name || '').toLowerCase();
  const revBillings = codeBillingRoomRevenue.filter((b: any) => !billingName(b).includes('payment') && !billingName(b).includes('statistic'));
  const revBillIds = new Set(revBillings.map((b: any) => b.id));
  const revPosts = codePostRoomRevenue.filter((p: any) => p.code_billing_id && revBillIds.has(p.code_billing_id));
  const payBillings = codeBillingPayment.filter((b: any) => billingName(b).includes('payment'));
  const payBillIds = new Set(payBillings.map((b: any) => b.id));
  const payPosts = codePostPayment.filter((p: any) => p.code_billing_id && payBillIds.has(p.code_billing_id));

  const budgetPosts = new Map<bigint, { type: string }>();
  const budgetPostIds = [...new Set(budgets.map((b: any) => b.code_post_id).filter(Boolean))];
  const allPosts = budgetPostIds.length ? await prisma.code_posts.findMany({ where: { id: { in: budgetPostIds } }, select: { id: true, name: true } }) : [];
  const postNameById = new Map(allPosts.map((p: any) => [p.id, String(p.name || '').toLowerCase()]));
  budgets.forEach((b: any) => {
    const nm = postNameById.get(b.code_post_id) || '';
    for (const t of ['total room available', 'ooo rooms', 'total room sold', 'comp rooms', 'hse rooms', 'total day use', 'total no. of inhouse guest', 'no show', 'reservation made', 'cancelation reservation']) {
      if (nm.includes(t)) { (b as any).type = t; break; }
    }
  });

  const periodData = (s: string, e: string) => calcDailyRevPeriod(pid, s, e, roomTypes, complimentRateIds, houseUseRateIds, budgets, ongoingDay, ongoingMonth, totalDaysInMonth);
  const [todayData, mtdData, ytdData] = await Promise.all([periodData(date, date), periodData(startOfMonth, date), periodData(startOfYear, date)]);

  // room revenue / payment transactions
  const fetchTb = (s: string, e: string, isPayment: boolean) => prisma.transaction_breakdowns.findMany({
    where: {
      property_id: pid,
      date: { gte: new Date(`${s}T00:00:00Z`), lte: new Date(`${e}T00:00:00Z`) },
      type: isPayment ? { in: ['payment', 'paidout', 'refund'] } : { notIn: ['payment', 'paidout', 'refund'] },
    },
    select: { code: true, amount: true, pb1: true, svr_chrg: true, surcharge: true, total: true, type_amount: true },
  });
  const [todayRoomRevenue, mtdRoomRevenue, ytdRoomRevenue, todayPayment, mtdPayment, ytdPayment] = await Promise.all([
    fetchTb(date, date, false), fetchTb(startOfMonth, date, false), fetchTb(startOfYear, date, false),
    fetchTb(date, date, true), fetchTb(startOfMonth, date, true), fetchTb(startOfYear, date, true),
  ]);

  const roomActivities = await calcRoomActivities(pid, date, startOfMonth, startOfYear, budgets, totalDaysInMonth, ongoingDay, ongoingMonth);

  const sysBal = async (s: string, e: string, name: string) => {
    const rows = await prisma.system_balances.findMany({
      where: { property_id: pid, date: { gte: new Date(`${s}T00:00:00Z`), lte: new Date(`${e}T00:00:00Z`), }, name },
      select: { debit: true, credit: true },
    });
    return rows.reduce((sum: number, r: any) => sum + Number(r.debit || 0) + Number(r.credit || 0), 0);
  };
  const ledger = async (s: string, e: string) => {
    const [gCur, gPrev, adCur, adPrev] = await Promise.all([
      sysBal(s, e, 'Guest Ledger Current Day'),
      sysBal(s, e, 'Guest Ledger Previous Day'),
      sysBal(s, e, 'Advance Deposit Current Day'),
      sysBal(s, e, 'Advance Deposit Previous Day'),
    ]);
    return { GUESTLEDGERCURRENT: gCur, GUESTLEDGERPREVIOUS: gPrev, ADVANCEDDEPOSITCURRENTDAY: adCur, ADVANCEDDEPOSITPREVIOUSDAY: adPrev, TOTALLEDGERDEPOSIT: gCur + gPrev + adCur + adPrev };
  };
  const [ledgerToday, ledgerMtd, ledgerYtd] = await Promise.all([ledger(date, date), ledger(startOfMonth, date), ledger(startOfYear, date)]);

  const sumSigned = (rows: any[], code: string) => rows
    .filter((t: any) => String(t.code) === code)
    .reduce((sum: number, t: any) => sum + (String(t.type_amount || 'PLUS').toUpperCase() === 'MINUS' ? -Number(t.amount || 0) : Number(t.amount || 0)), 0);

  return {
    reportTitle: 'Daily Revenue Report',
    reportDate: date,
    startDate: date,
    endDate: date,
    totalDaysInMonth,
    roomTypes,
    todayData,
    mtdData,
    ytdData,
    roomActivities,
    roomRevenue: { codeBillingRoomRevenue: revBillings, codePostRoomRevenue: revPosts, today: todayRoomRevenue, mtd: mtdRoomRevenue, ytd: ytdRoomRevenue },
    payment: { codeBillingPayment: payBillings, codePostPayment: payPosts, today: todayPayment, mtd: mtdPayment, ytd: ytdPayment },
    mtdBudget: budgets.filter((b: any) => b.month === m),
    ledgerToday,
    ledgerMtd,
    ledgerYtd,
  };
}

async function calcRoomActivities(pid: bigint, date: string, startOfMonth: string, startOfYear: string, budgets: any[], totalDaysInMonth: number, ongoingDay: number, ongoingMonth: number): Promise<any> {
  const tomorrow = addDays(date, 1);
  // Laravel noShow/cancellation query RESERVATION.date (not folio res_date); git requires parent != 0
  const cancelResvs = await prisma.reservations.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      folios: { is: { status_reservation: STATUS_RESERVATION_CANCEL, deleted_at: null } },
    },
    select: { date: true, folios: { select: { data: true, type_reservation: true, folio_number: true, parent: true } } },
  });
  const reasonOf = (f: any) => {
    try { const d = JSON.parse(f.data || '{}'); return String(d.reason_cancel_reservation || '').toUpperCase(); } catch { return ''; }
  };
  const isFitGitCancel = (f: any) => ['fit', 'git'].includes(f.type_reservation) || (f.type_reservation === 'vr' && String(f.folio_number || '').startsWith('F'));
  const gitNotParent = (f: any) => f.type_reservation === 'git' && Number(f.parent || 0) !== 0;
  const dayOf = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const cancelFilter = (f: any) => isFitGitCancel(f) && !(gitNotParent(f));
  const noShow = (s: string, e?: string) => cancelResvs.filter((r: any) => {
    const f = r.folios as any;
    if (!f || !cancelFilter(f)) return false;
    const dd = dayOf(r.date);
    const inRange = !e ? dd === s : dd >= s && dd <= e;
    return inRange && reasonOf(f) === 'NO SHOW';
  }).length;
  const cancelNotShow = (s: string, e?: string) => cancelResvs.filter((r: any) => {
    const f = r.folios as any;
    if (!f || !cancelFilter(f)) return false;
    const dd = dayOf(r.date);
    const inRange = !e ? dd === s : dd >= s && dd <= e;
    return inRange && reasonOf(f) !== 'NO SHOW';
  }).length;

  // Laravel type filter: fit | git | (vr AND folio_number LIKE F%)
  const typeFilter = {
    OR: [
      { type_reservation: { in: ['fit', 'git'] } },
      { type_reservation: 'vr', folio_number: { startsWith: 'F' } },
    ],
  };
  // Laravel whereBetween('date',[s,e]) on DATETIME strings = end-day 00:00 exclusive; single date = equality
  const rangeOrEq = (s: string, e: string, key: string) => (s === e
    ? { [key]: new Date(`${s}T00:00:00Z`) }
    : { [key]: { gte: new Date(`${s}T00:00:00Z`), lte: new Date(`${e}T00:00:00Z`) } });
  const countFolios = async (where: any) => prisma.folios.count({ where: { property_id: pid, deleted_at: null, ...where } });
  // Laravel reservationMade: type filter only, NO status filter
  const resMade = (s: string, e: string) => countFolios({ ...rangeOrEq(s, e, 'res_date'), ...typeFilter });
  const statusLive = { status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] } };
  const arrivals = (s: string, e: string) => countFolios({ ...rangeOrEq(s, e, 'check_in_date'), ...statusLive, ...typeFilter });
  const departures = (s: string, e: string) => countFolios({ ...rangeOrEq(s, e, 'check_out_date'), ...statusLive, ...typeFilter });

  const budgetOf = (type: string, s: string, e: string) => {
    const sm = Number(s.slice(5, 7));
    const em = Number(e.slice(5, 7));
    const posts = budgets.filter((b: any) => b.type === type && b.month >= sm && b.month <= em);
    const monthly = posts.reduce((sum: number, b: any) => sum + Number(b.budget), 0);
    if (s === e) return monthly / totalDaysInMonth;
    if (sm === em) return (monthly / totalDaysInMonth) * ongoingDay;
    let tot = 0;
    for (const b of posts) {
      if (b.month === em) tot += (Number(b.budget) / totalDaysInMonth) * ongoingDay;
      else tot += Number(b.budget);
    }
    return tot;
  };

  const period = (s: string, e: string) => ({
    noShow: noShow(s, e),
    noShowBudget: budgetOf('no show', s, e),
    reservationMade: resMade(s, e),
    reservationMadeBudget: budgetOf('reservation made', s, e),
    cancellationReservation: cancelNotShow(s, e),
    cancellationReservationBudget: budgetOf('cancelation reservation', s, e),
  });

  const [today, mtd, ytd, arrivalsToday, departuresToday, arrivalsTomorrow, departuresTomorrow] = await Promise.all([
    period(date, date),
    period(startOfMonth, date),
    period(startOfYear, date),
    arrivals(date, date),
    departures(date, date),
    arrivals(tomorrow, tomorrow),
    departures(tomorrow, tomorrow),
  ]);

  return {
    today: {
      ...today,
      roomArrivalsToday: arrivalsToday,
      roomDepartureToday: departuresToday,
      roomArrivalsTomorrow: arrivalsTomorrow,
      roomDepartureTomorrow: departuresTomorrow,
    },
    mtd,
    ytd,
  };
}

// ── Excel builder: daily-revenue-report ──
async function generateDailyRevenueExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Daily Revenue Report');
  const HEADERS = ['Description', 'Today Actual', 'Today Budget', 'Today Variance', 'MTD Actual', 'MTD Budget', 'MTD Variance', 'YTD Actual', 'YTD Budget', 'YTD Variance'];
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  ws.mergeCells(1, 1, 1, 10);
  const title = ws.getCell(1, 1);
  title.value = String(data.reportTitle || 'Daily Revenue Report').toUpperCase();
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 10);
  const meta = ws.getCell(2, 1);
  meta.value = `For Business Date: ${data.reportDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };
  const headerRow = ws.getRow(3);
  headerRow.values = HEADERS;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
  for (let i = 1; i <= 10; i++) ws.getColumn(i).width = 26;

  const section = (label: string) => {
    const r = ws.addRow([label]);
    ws.mergeCells(r.getCell(1).address, r.getCell(10).address);
    r.font = { bold: true };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    return r;
  };
  const row10 = (vals: any[], bold = false) => {
    const r = ws.addRow(vals);
    if (bold) r.font = { bold: true };
    return r;
  };
  const nf2 = (v: any) => Number(v || 0).toFixed(2);
  const sumSigned = (rows: any[], code: string, field: string) => rows
    .filter((t: any) => String(t.code) === code)
    .reduce((sum: number, t: any) => sum + (String(t.type_amount || 'PLUS').toUpperCase() === 'MINUS' ? -Number(t[field] || 0) : Number(t[field] || 0)), 0);
  const periodTotals = (arr: any[], key: string) => arr.reduce((s: number, a: any) => s + (a[key] || 0), 0);

  section('STATISTICS');
  const stat = (label: string, key: string) => {
    const [d, m, y] = [data.todayData[key] || 0, data.mtdData[key] || 0, data.ytdData[key] || 0];
    const [db, mb, yb] = [data.todayData[key + 'Budget'] || 0, data.mtdData[key + 'Budget'] || 0, data.ytdData[key + 'Budget'] || 0];
    row10([label, d, db, d - db, m, mb, m - mb, y, yb, y - yb]);
  };
  const statZero = (label: string, key: string, fmt: (v: any) => any = (v) => v) => {
    const [d, m, y] = [data.todayData[key] || 0, data.mtdData[key] || 0, data.ytdData[key] || 0];
    row10([label, fmt(d), 0, fmt(d), fmt(m), 0, fmt(m), fmt(y), 0, fmt(y)]);
  };
  stat('TOTAL ROOM AVAILABLE', 'totalAvailableRoom');
  stat('TOTAL ROOM OUT OF ORDER', 'totalBlockedRoom');
  stat('TOTAL ROOM SOLD (Excl. HSE & COMP)', 'totalRoomSold');
  for (const rt of data.roomTypes || []) {
    const key = rt.name;
    const [d, m, y] = [data.todayData.roomTypeSales[key] || 0, data.mtdData.roomTypeSales[key] || 0, data.ytdData.roomTypeSales[key] || 0];
    row10([`- ${key}`, d, 0, d, m, 0, m, y, 0, y]);
  }
  stat('TOTAL ROOM COMPLIMENTARY (COM)', 'totalComplimentary');
  stat('TOTAL ROOM HOUSE USE (HSE)', 'totalHouseUse');
  stat('TOTAL SALEABLE ROOM', 'totalSaleableRoom');
  statZero('TOTAL VACANT ROOM', 'totalVacantRoom');
  stat('TOTAL DAY USE', 'totalDayUse');
  stat('TOTAL IN-HOUSE GUESTS (Excl. HSE)', 'totalInHouseGuests');
  statZero('AVERAGE ROOM RATE (ARR)', 'averageRoomRate', nf2);
  statZero('% ROOM SALEABLE OCCUPANCY', 'roomSaleableOccupancy', nf2);
  statZero('% ROOM SALEABLE OCCUPANCY (Incl. COM)', 'roomSaleableOccupancyWithCOM', nf2);
  statZero('% ROOM SALEABLE OCC. (Incl. COM&Day Use)', 'roomSaleableOccupancyWithCOMDayUse', nf2);
  statZero('REVENUE PER AVAIL. ROOM (REVPAR)', 'revenuePerAvailableRoom', nf2);
  statZero('% ROOM AVAILABLE OCCUPANCY', 'roomAvailableOccupancy', nf2);
  statZero('% ROOM AVAILABLE OCCUPANCY (Incl. COM)', 'roomAvailableOccupancyWithCOM', nf2);
  statZero('% ROOM AVAILABLE OCC. (Incl. COM&Day Use)', 'roomAvailableOccupancyWithCOMDayUse', nf2);
  statZero('% DOUBLE OCCUPANCY (Incl. COM)', 'doubleOccupancy', nf2);
  statZero('AVERAGE LENGTH OF STAY (ALOS)', 'averageLengthOfStay', nf2);

  section('ROOM ACTIVITIES');
  const act = (label: string, key: string) => {
    const t = data.roomActivities?.today || {};
    const m = data.roomActivities?.mtd || {};
    const y = data.roomActivities?.ytd || {};
    row10([label, t[key], t[key + 'Budget'], (t[key] || 0) - (t[key + 'Budget'] || 0), m[key], m[key + 'Budget'], (m[key] || 0) - (m[key + 'Budget'] || 0), y[key], y[key + 'Budget'], (y[key] || 0) - (y[key + 'Budget'] || 0)]);
  };
  act('NO SHOW', 'noShow');
  act('RESERVATION MADE', 'reservationMade');
  act('CANCELATION RESERVATION', 'cancellationReservation');
  const dashRow = (label: string, key: string) => {
    const t = data.roomActivities?.today || {};
    row10([label, t[key], 0, t[key], '-', '-', '-', '-', '-', '-']);
  };
  dashRow('ROOM ARRIVALS TODAY', 'roomArrivalsToday');
  dashRow('ROOM DEPARTURE TODAY', 'roomDepartureToday');
  dashRow('ROOM ARRIVALS TOMORROW', 'roomArrivalsTomorrow');
  dashRow('ROOM DEPARTURE TOMORROW', 'roomDepartureTomorrow');

  const revSection = (label: string, codeBillings: any[], codePosts: any[], today: any[], mtd: any[], ytd: any[], budgetRows: any[], isPayment: boolean) => {
    section(label);
    const totals: any = { revenue: [], budget: [], variance: [], tax: [], svc: [], surcharge: [] };
    const sorted = isPayment ? codeBillings : [...codeBillings].sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));
    for (const billing of sorted) {
      const bPosts = codePosts.filter((p: any) => p.code_billing_id === billing.id);
      section(String(billing.name || '').toUpperCase());
      let acc = {
        revenue: { today: 0, mtd: 0, ytd: 0 }, budget: { today: 0, mtd: 0, ytd: 0 }, variance: { today: 0, mtd: 0, ytd: 0 },
        tax: { today: 0, mtd: 0, ytd: 0 }, svc: { today: 0, mtd: 0, ytd: 0 }, surcharge: { today: 0, mtd: 0, ytd: 0 },
      };
      for (const post of bPosts) {
        const t = sumSigned(today, String(post.id), 'amount');
        const m = sumSigned(mtd, String(post.id), 'amount');
        const y = sumSigned(ytd, String(post.id), 'amount');
        const taxT = isPayment ? 0 : sumSigned(today, String(post.id), 'pb1');
        const taxM = isPayment ? 0 : sumSigned(mtd, String(post.id), 'pb1');
        const taxY = isPayment ? 0 : sumSigned(ytd, String(post.id), 'pb1');
        const svcT = isPayment ? 0 : sumSigned(today, String(post.id), 'svr_chrg');
        const svcM = isPayment ? 0 : sumSigned(mtd, String(post.id), 'svr_chrg');
        const svcY = isPayment ? 0 : sumSigned(ytd, String(post.id), 'svr_chrg');
        const surT = isPayment ? sumSigned(today, String(post.id), 'surcharge') : 0;
        const surM = isPayment ? sumSigned(mtd, String(post.id), 'surcharge') : 0;
        const surY = isPayment ? sumSigned(ytd, String(post.id), 'surcharge') : 0;
        const monthlyBudget = budgetRows.filter((b: any) => b.code_post_id === post.id).reduce((s: number, b: any) => s + Number(b.budget || 0), 0);
        const todayBudget = monthlyBudget / (data.totalDaysInMonth > 0 ? data.totalDaysInMonth : 1);
        const mtdBudget = todayBudget * new Date().getDate();
        const ytdBudget = todayBudget * new Date().getDate() + monthlyBudget * (new Date().getMonth());
        row10([String(post.name || '').toUpperCase(), nf2(t), nf2(todayBudget), nf2(t - todayBudget), nf2(m), nf2(mtdBudget), nf2(m - mtdBudget), nf2(y), nf2(ytdBudget), nf2(y - ytdBudget)]);
        acc.revenue.today += t; acc.revenue.mtd += m; acc.revenue.ytd += y;
        acc.budget.today += todayBudget; acc.budget.mtd += mtdBudget; acc.budget.ytd += ytdBudget;
        acc.variance.today += t - todayBudget; acc.variance.mtd += m - mtdBudget; acc.variance.ytd += y - ytdBudget;
        acc.tax.today += taxT; acc.tax.mtd += taxM; acc.tax.ytd += taxY;
        acc.svc.today += svcT; acc.svc.mtd += svcM; acc.svc.ytd += svcY;
        acc.surcharge.today += surT; acc.surcharge.mtd += surM; acc.surcharge.ytd += surY;
      }
      row10([`Total ${String(billing.name || '').toUpperCase()}`, nf2(acc.revenue.today), nf2(acc.budget.today), nf2(acc.variance.today), nf2(acc.revenue.mtd), nf2(acc.budget.mtd), nf2(acc.variance.mtd), nf2(acc.revenue.ytd), nf2(acc.budget.ytd), nf2(acc.variance.ytd)], true);
      totals.revenue.push(acc.revenue);
      totals.budget.push(acc.budget);
      totals.variance.push(acc.variance);
      totals.tax.push(acc.tax);
      totals.svc.push(acc.svc);
      totals.surcharge.push(acc.surcharge);
    }
    const lbl = isPayment ? 'Hotel Payment' : 'Hotel Revenue';
    section(lbl);
    const netLbl = isPayment ? 'Hotel Net Payment' : 'Total Net Revenue';
    row10([netLbl, nf2(periodTotals(totals.revenue, 'today')), nf2(periodTotals(totals.budget, 'today')), nf2(periodTotals(totals.variance, 'today')), nf2(periodTotals(totals.revenue, 'mtd')), nf2(periodTotals(totals.budget, 'mtd')), nf2(periodTotals(totals.variance, 'mtd')), nf2(periodTotals(totals.revenue, 'ytd')), nf2(periodTotals(totals.budget, 'ytd')), nf2(periodTotals(totals.variance, 'ytd'))], true);
    if (!isPayment) {
      const taxRow = (k: 'today' | 'mtd' | 'ytd') => {
        const tax = periodTotals(totals.tax, k);
        const tb = tax * 0.11;
        return [nf2(tax), nf2(tb), nf2(tax - tb)];
      };
      row10(['Government Tax', ...taxRow('today'), ...taxRow('mtd'), ...taxRow('ytd')], true);
      const svcRow = (k: 'today' | 'mtd' | 'ytd') => {
        const svc = periodTotals(totals.svc, k);
        const sb = svc * 0.10;
        return [nf2(svc), nf2(sb), nf2(svc - sb)];
      };
      row10(['Service Charge', ...svcRow('today'), ...svcRow('mtd'), ...svcRow('ytd')], true);
      const grossRow = (k: 'today' | 'mtd' | 'ytd') => [
        nf2(periodTotals(totals.revenue, k) + periodTotals(totals.tax, k) + periodTotals(totals.svc, k)),
        nf2(periodTotals(totals.budget, k) + periodTotals(totals.tax, k) * 0.11 + periodTotals(totals.svc, k) * 0.10),
        nf2(periodTotals(totals.variance, k) + periodTotals(totals.tax, k) - periodTotals(totals.tax, k) * 0.11 + periodTotals(totals.svc, k) - periodTotals(totals.svc, k) * 0.10),
      ];
      row10(['Total Gross Revenue', ...grossRow('today'), ...grossRow('mtd'), ...grossRow('ytd')], true);
    } else {
      const surRow = (k: 'today' | 'mtd' | 'ytd') => {
        const sur = periodTotals(totals.surcharge, k);
        const sb = sur * 0.11;
        return [nf2(sur), nf2(sb), nf2(sur - sb)];
      };
      row10(['Surcharge', ...surRow('today'), ...surRow('mtd'), ...surRow('ytd')], true);
      const grossRow = (k: 'today' | 'mtd' | 'ytd') => [
        nf2(periodTotals(totals.revenue, k) + periodTotals(totals.surcharge, k)),
        nf2(periodTotals(totals.budget, k) + periodTotals(totals.surcharge, k) * 0.11),
        nf2(periodTotals(totals.variance, k) + periodTotals(totals.surcharge, k) - periodTotals(totals.surcharge, k) * 0.11),
      ];
      row10(['Total Gross Payment', ...grossRow('today'), ...grossRow('mtd'), ...grossRow('ytd')], true);
    }
  };

  revSection('ROOM REVENUE', data.roomRevenue?.codeBillingRoomRevenue || [], data.roomRevenue?.codePostRoomRevenue || [], data.roomRevenue?.today || [], data.roomRevenue?.mtd || [], data.roomRevenue?.ytd || [], data.mtdBudget || [], false);
  revSection('PAYMENT', data.payment?.codeBillingPayment || [], data.payment?.codePostPayment || [], data.payment?.today || [], data.payment?.mtd || [], data.payment?.ytd || [], data.mtdBudget || [], true);

  const ledgerRow = (label: string, key: string) => {
    const t = data.ledgerToday || {}, m = data.ledgerMtd || {}, y = data.ledgerYtd || {};
    row10([label, nf2(t[key]), 0, nf2(t[key]), nf2(m[key]), 0, nf2(m[key]), nf2(y[key]), 0, nf2(y[key])], true);
  };
  ledgerRow('GUEST LEDGER CURRENT DAY', 'GUESTLEDGERCURRENT');
  ledgerRow('GUEST LEDGER PREVIOUS DAY', 'GUESTLEDGERPREVIOUS');
  ledgerRow('ADVANCED DEPOSIT CURRENT DAY', 'ADVANCEDDEPOSITCURRENTDAY');
  ledgerRow('ADVANCED DEPOSIT PREVIOUS DAY', 'ADVANCEDDEPOSITPREVIOUSDAY');
  ledgerRow('TOTAL LEDGER & DEPOSIT', 'TOTALLEDGERDEPOSIT');
  const ctrlSigned = (periodRows: any[], posts: any[]) => {
    const ids = new Set(posts.map((p: any) => String(p.id)));
    return (periodRows || []).filter((t: any) => ids.has(String(t.code)))
      .reduce((s: number, t: any) => s + (String(t.type_amount || 'PLUS').toUpperCase() === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0)), 0);
  };
  const ctrl = (k: 'today' | 'mtd' | 'ytd') => {
    const rr = k === 'today' ? data.roomRevenue?.today : k === 'mtd' ? data.roomRevenue?.mtd : data.roomRevenue?.ytd;
    const pm = k === 'today' ? data.payment?.today : k === 'mtd' ? data.payment?.mtd : data.payment?.ytd;
    const lk = data[`ledger${k === 'today' ? 'Today' : k === 'mtd' ? 'Mtd' : 'Ytd'}`] || {};
    return nf2(ctrlSigned(rr, data.roomRevenue?.codePostRoomRevenue || []) + ctrlSigned(pm, data.payment?.codePostPayment || []) + Number(lk.TOTALLEDGERDEPOSIT || 0));
  };
  row10(['CONTROL BALANCE', ctrl('today'), 0, ctrl('today'), ctrl('mtd'), 0, ctrl('mtd'), ctrl('ytd'), 0, ctrl('ytd')], true);

  ws.eachRow({ includeEmpty: false }, (r: any, rn: number) => {
    if (rn < 3) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.border = border;
      c.alignment = { horizontal: cn === 1 ? 'left' : 'right' };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-revenue-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Tax Breakdown Detail Report ──
// Laravel parity: TaxBreakdownDetailReportController raw SQL + tax-breakdown-detail-report.blade.php

async function getTaxBreakdownDetail(params: any): Promise<any> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const rows: any = await prisma.$queryRaw`
    WITH last_room AS (
      SELECT folio_id, room_name
      FROM (
        SELECT folio_id, room_name, ROW_NUMBER() OVER (PARTITION BY folio_id ORDER BY id DESC) AS rn
        FROM reservations
      ) x
      WHERE rn = 1
    )
    SELECT
      CASE WHEN p.type = 'DEFAULT' THEN p.name WHEN p.type = 'IS_PAYMENT' OR p.type IS NULL THEN tp.name END AS "Postcode",
      tb.date,
      f.folio_number,
      lr.room_name AS room_no,
      CONCAT(f.first_name, ' ', f.last_name) AS "Guest_Name",
      f.company_name,
      CONCAT(COALESCE(tb.type, ''), ' - ', TRIM(CONCAT_WS(' ', NULLIF(tb.remark, ''), NULLIF(tb.last_digit_card::text, ''), NULLIF(tb.card_name, ''), NULLIF(tb.voucher, ''), NULLIF(tb.receipt, '')))) AS description,
      tb.created_at AS "Posting_date",
      CASE WHEN tb.type = 'Room_Revenue' THEN 'SYSTEM' WHEN tb.receipt IS NOT NULL THEN 'POS SYSTEM' ELSE u.name END AS "STAFF",
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.amount AS DECIMAL(18,2)) ELSE CAST(tb.amount AS DECIMAL(18,2)) END AS "Charge",
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.pb1 AS DECIMAL(18,2)) ELSE CAST(tb.pb1 AS DECIMAL(18,2)) END AS "Govt_tax",
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.svr_chrg AS DECIMAL(18,2)) ELSE CAST(tb.svr_chrg AS DECIMAL(18,2)) END AS svr_chrg,
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.surcharge AS DECIMAL(18,2)) ELSE CAST(tb.surcharge AS DECIMAL(18,2)) END AS surcharge,
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.total AS DECIMAL(18,2)) ELSE CAST(tb.total AS DECIMAL(18,2)) END AS total
    FROM transaction_breakdowns tb
    JOIN folios f ON tb.folio_id = f.id
    JOIN code_posts p ON tb.code = p.id::text
    LEFT JOIN users u ON tb.created_by = u.id
    LEFT JOIN type_payments tp ON tp.id = tb.type_payment_id
    LEFT JOIN last_room lr ON lr.folio_id = f.id
    WHERE f.property_id = ${pid}
      AND tb.date BETWEEN ${new Date(`${startDate}T00:00:00Z`)} AND ${new Date(`${endDate}T00:00:00Z`)}
      AND p.type IN ('DEFAULT', 'IS_PAYMENT')
    ORDER BY p.type, p.id, tb.created_at`;

  const reportData: Record<string, any> = {};
  let grandTotalCharge = 0, grandTotalGovtTax = 0, grandTotalSvcCharge = 0, grandTotalSurcharge = 0, grandTotal = 0, totalTransactions = 0;
  for (const r of rows) {
    const code = r.Postcode || 'UNKNOWN';
    if (!reportData[code]) reportData[code] = { transactions: [], count: 0, totalCharge: 0, totalGovtTax: 0, totalSvcCharge: 0, totalSurcharge: 0, totalAmount: 0 };
    const g = reportData[code];
    g.transactions.push({
      date: r.date ? formatDate(r.date) : '',
      folio_number: r.folio_number || '',
      room_no: r.room_no || '',
      Guest_Name: r.Guest_Name || '',
      company_name: r.company_name || '',
      description: r.description || '',
      STAFF: r.STAFF || '',
      Posting_date: r.Posting_date ? formatDateTimeLocal(r.Posting_date) : '',
      Charge: Number(r.Charge || 0),
      Govt_tax: Number(r.Govt_tax || 0),
      svr_chrg: Number(r.svr_chrg || 0),
      surcharge: Number(r.surcharge || 0),
      total: Number(r.total || 0),
    });
    g.count++;
    g.totalCharge += Number(r.Charge || 0);
    g.totalGovtTax += Number(r.Govt_tax || 0);
    g.totalSvcCharge += Number(r.svr_chrg || 0);
    g.totalSurcharge += Number(r.surcharge || 0);
    g.totalAmount += Number(r.total || 0);
    grandTotalCharge += Number(r.Charge || 0);
    grandTotalGovtTax += Number(r.Govt_tax || 0);
    grandTotalSvcCharge += Number(r.svr_chrg || 0);
    grandTotalSurcharge += Number(r.surcharge || 0);
    grandTotal += Number(r.total || 0);
    totalTransactions++;
  }

  return {
    reportTitle: 'Tax Breakdown Detail Report',
    startDate,
    endDate,
    reportData,
    grandTotalCharge,
    grandTotalGovtTax,
    grandTotalSvcCharge,
    grandTotalSurcharge,
    grandTotal,
    totalTransactions,
  };
}

function formatDateTimeLocal(d: any): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(2)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
}

async function generateTaxBreakdownDetailExcel(res: Response, data: any, filename = 'tax-breakdown-detail'): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Tax Breakdown Detail');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Date', 'Folio', 'Room', 'Guest', 'Company', 'Description', 'Staff', 'Post Date/Time', 'Charge', 'Govt Tax', 'Svc Charge', 'Surcharge', 'Total'];
  const nf = (v: any) => Number(v || 0).toFixed(2);

  ws.mergeCells(1, 1, 1, 13);
  const title = ws.getCell(1, 1);
  title.value = String(data.reportTitle || 'Tax Breakdown Detail Report').toUpperCase();
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 13);
  const meta = ws.getCell(2, 1);
  meta.value = `Period: ${data.startDate || ''} - ${data.endDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };

  let rn = 3;
  for (const [code, group] of Object.entries<any>(data.reportData || {})) {
    ws.getRow(rn).values = [code];
    ws.mergeCells(rn, 1, rn, 13);
    ws.getRow(rn).font = { bold: true, size: 12 };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = HEADERS;
    ws.getRow(rn).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    for (const t of group.transactions || []) {
      ws.getRow(rn).values = [t.date, t.folio_number, t.room_no, t.Guest_Name, t.company_name, t.description, t.STAFF, t.Posting_date, nf(t.Charge), nf(t.Govt_tax), nf(t.svr_chrg), nf(t.surcharge), nf(t.total)];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = [`Number Of Transactions: ${group.count}`, '', '', '', '', '', '', '', nf(group.totalCharge), nf(group.totalGovtTax), nf(group.totalSvcCharge), nf(group.totalSurcharge), nf(group.totalAmount)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = [`Grand Total (Number Of Transactions: ${data.totalTransactions || 0})`, '', '', '', '', '', '', nf(data.grandTotalCharge || 0), nf(data.grandTotalGovtTax || 0), nf(data.grandTotalSvcCharge || 0), nf(data.grandTotalSurcharge || 0), nf(data.grandTotal || 0)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 3) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn >= 9 ? 'right' : 'left', wrapText: true };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Tax Breakdown Summary Excel ──
async function generateTaxBreakdownSummaryExcel(res: Response, data: any): Promise<void> {
  const payload = Array.isArray(data) ? data[0] : data;
  const rows = payload.reportData;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Tax Breakdown Summary');

  // Header row 1: Billing Name
  const headerRow1 = ws.addRow(['Billing Name']);
  headerRow1.eachCell((c: any) => {
    c.font = { bold: true };
    c.fill = { fgColor: { argb: 'FFE0E0E0' } };
  });

  // Header row 2: Post Code details
  const headerRow2 = ws.addRow(['Post Code', 'Amount', 'PB1', 'SVC', 'Surcharge', 'Total']);
  headerRow2.eachCell((c: any) => {
    c.font = { bold: true };
    c.fill = { fgColor: { argb: 'FFE0E0E0' } };
  });

  // Data rows
  rows.forEach((row: any) => {
    const postCodeRows = row.postCodes.map((pc: any) => [
      pc.name,
      nf(pc.amount),
      nf(pc.pb1),
      nf(pc.svc),
      nf(pc.surcharge),
      nf(pc.total),
    ]);
    postCodeRows.forEach((pr: any[]) => ws.addRow(pr));
    // Group total row
    ws.addRow(['', nf(row.totals.amount), nf(row.totals.pb1), nf(row.totals.svc), nf(row.totals.surcharge), nf(row.totals.total)]);
  });

  // Grand total row
  ws.addRow(['Grand Total', nf(payload.grandTotals.amount), nf(payload.grandTotals.pb1), nf(payload.grandTotals.svc), nf(payload.grandTotals.surcharge), nf(payload.grandTotals.total)]);

  // Payment summary section
  const paymentSectionHdr = ws.addRow(['Payment Summary', 'Total']);
  paymentSectionHdr.eachCell((c: any) => {
    c.font = { bold: true };
    c.fill = { fgColor: { argb: 'FFE0E0E0' } };
  });
  const paymentTotalRow = ws.addRow(['Total Payments', nf(payload.totalPayment)]);
  paymentTotalRow.eachCell((c: any) => {
    c.font = { bold: true };
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="tax-breakdown-summary.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Tax Breakdown Detail (job version) ──
// Laravel parity: Services/Report::tax_breakdown_detail + tax-breakdown-detail.blade.php
// Grouped by codePost name; description builder = blade logic (creator/pos relations absent on model -> 'SYSTEM' staff, no POS suffix)

async function getTaxBreakdownDetailJob(params: any): Promise<any> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;
  const isPos = !!params.is_pos;

  const rows: any = await prisma.$queryRaw`
    SELECT
      tb.date, tb.type, tb.type_amount, tb.amount, tb.pb1, tb.svr_chrg, tb.surcharge, tb.total,
      tb.remark, tb.is_transfer, tb.created_at,
      f.folio_number,
      COALESCE(p.name, 'Unknown') AS code_name,
      CONCAT(gp.first_name, ' ', COALESCE(gp.last_name, '')) AS guest_name,
      cp.name AS company_name,
      lr.room_name
    FROM transaction_breakdowns tb
    JOIN folios f ON tb.folio_id = f.id AND f.deleted_at IS NULL
    LEFT JOIN code_posts p ON tb.code = p.id::text AND p.deleted_at IS NULL
    LEFT JOIN guest_profiles gp ON f.guest_profile_id = gp.id AND gp.deleted_at IS NULL
    LEFT JOIN company_profiles cp ON f.company_profile_id = cp.id AND cp.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT rm.name AS room_name
      FROM reservations r
      JOIN rooms rm ON r.room_id = rm.id AND rm.deleted_at IS NULL
      WHERE r.folio_id = f.id AND r.deleted_at IS NULL
      ORDER BY r.id
      LIMIT 1
    ) lr ON TRUE
    WHERE tb.date BETWEEN ${new Date(`${startDate}T00:00:00Z`)} AND ${new Date(`${endDate}T00:00:00Z`)}
      AND tb.property_id = ${pid}
    ORDER BY tb.code`;

  const reportData: Record<string, any> = {};
  let grandTotalCharge = 0, grandTotalGovtTax = 0, grandTotalSvcCharge = 0, grandTotalSurcharge = 0, grandTotal = 0, totalTransactions = 0;

  const titleCase = (s: string): string =>
    s.toLowerCase().replace(/_/g, ' ').replace(/(^|\s)\S/g, (m) => m.toUpperCase());

  for (const r of rows) {
    const sign = r.type_amount === 'PLUS' ? 1 : -1;
    const code = r.code_name || 'Unknown';
    if (!reportData[code]) reportData[code] = { transactions: [], count: 0, totalCharge: 0, totalGovtTax: 0, totalSvcCharge: 0, totalSurcharge: 0, totalAmount: 0 };
    const g = reportData[code];

    const t = r.type || '';
    const folioNumber = r.folio_number || '';
    let description = '';
    if (Number(r.is_transfer) === 1 || Number(r.is_transfer) === 2) {
      description = titleCase(t) + ' ' + (r.remark ?? '');
    } else {
      description = titleCase(t) + (isPos ? '' : ' - ' + folioNumber) + (r.remark ? ' (' + r.remark + ')' : '');
    }

    g.transactions.push({
      date: r.date ? formatDateDMYShort(r.date) : '',
      folio_number: folioNumber,
      room_name: r.room_name || '',
      guest_name: (r.guest_name || '').trim(),
      company_name: r.company_name || '',
      description,
      staff: 'SYSTEM',
      created_at: r.created_at ? formatDateTimeLocal(r.created_at) : '',
      charge: (r.amount ?? 0) * sign,
      govt_tax: (r.pb1 ?? 0) * sign,
      svc_charge: (r.svr_chrg ?? 0) * sign,
      surcharge: (r.surcharge ?? 0) * sign,
      total: (r.total ?? 0) * sign,
    });
    g.count++;
    g.totalCharge += (r.amount ?? 0) * sign;
    g.totalGovtTax += (r.pb1 ?? 0) * sign;
    g.totalSvcCharge += (r.svr_chrg ?? 0) * sign;
    g.totalSurcharge += (r.surcharge ?? 0) * sign;
    g.totalAmount += (r.total ?? 0) * sign;
    grandTotalCharge += (r.amount ?? 0) * sign;
    grandTotalGovtTax += (r.pb1 ?? 0) * sign;
    grandTotalSvcCharge += (r.svr_chrg ?? 0) * sign;
    grandTotalSurcharge += (r.surcharge ?? 0) * sign;
    grandTotal += (r.total ?? 0) * sign;
    totalTransactions++;
  }

  for (const g of Object.values(reportData)) {
    g.transactions.sort((a: any, b: any) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  return [{
    reportTitle: 'Tax Breakdown Detail',
    startDate,
    endDate,
    reportData,
    totalTransactions,
    grandTotalCharge,
    grandTotalGovtTax,
    grandTotalSvcCharge,
    grandTotalSurcharge,
    grandTotal,
  }];
}

async function generateTaxBreakdownDetailJobExcel(res: Response, data: any): Promise<void> {
  const payload = Array.isArray(data) ? data[0] : data;
  const reportData = payload.reportData;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Tax Breakdown Detail');

  ws.columns = [
    { width: 10 }, { width: 14 }, { width: 12 }, { width: 22 }, { width: 22 },
    { width: 40 }, { width: 12 }, { width: 18 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 12 },
  ];

  for (const code of Object.keys(reportData)) {
    const group = reportData[code];
    const titleRow = ws.addRow([code]);
    titleRow.eachCell((c: any) => { c.font = { bold: true, size: 12 }; });

    const hdr = ws.addRow(['Date', 'Folio', 'Room', 'Guest', 'Company', 'Description', 'Staff', 'Post Date/Time', 'Charge', 'Govt Tax', 'Svc Charge', 'Surcharge', 'Total']);
    hdr.eachCell((c: any) => {
      c.font = { bold: true };
      c.fill = { fgColor: { argb: 'FFE0E0E0' } };
    });

    for (const tx of group.transactions) {
      ws.addRow([
        tx.date, tx.folio_number, tx.room_name, tx.guest_name, tx.company_name,
        tx.description, tx.staff, tx.created_at,
        nf(tx.charge, 2), nf(tx.govt_tax, 2), nf(tx.svc_charge, 2), nf(tx.surcharge, 2), nf(tx.total, 2),
      ]);
    }

    const sub = ws.addRow([
      `Number Of Transactions: ${group.count}`, '', '', '', '', '', '', '',
      nf(group.totalCharge, 2), nf(group.totalGovtTax, 2), nf(group.totalSvcCharge, 2), nf(group.totalSurcharge, 2), nf(group.totalAmount, 2),
    ]);
    sub.eachCell((c: any) => { c.font = { bold: true }; });
  }

  const grand = ws.addRow([
    `Grand Total (Number Of Transactions: ${payload.totalTransactions})`, '', '', '', '', '', '', '',
    nf(payload.grandTotalCharge, 2), nf(payload.grandTotalGovtTax, 2), nf(payload.grandTotalSvcCharge, 2), nf(payload.grandTotalSurcharge, 2), nf(payload.grandTotal, 2),
  ]);
  grand.eachCell((c: any) => { c.font = { bold: true }; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="tax-breakdown-detail.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Account Transaction Report Detail ──
// Laravel parity: AccountTransactionReportDetailController raw SQL + account-transaction-report-detail.blade.php
// Same data as tax-breakdown-detail but STAFF defaults to 'System'.

async function getAccountTransactionReportDetail(params: any): Promise<any> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;
  const staffName = params.staffId || 'System';

  const rows: any = await prisma.$queryRaw`
    WITH last_room AS (
      SELECT folio_id, room_name
      FROM (
        SELECT folio_id, room_name, ROW_NUMBER() OVER (PARTITION BY folio_id ORDER BY id DESC) AS rn
        FROM reservations
      ) x
      WHERE rn = 1
    )
    SELECT
      CASE WHEN p.type = 'DEFAULT' THEN p.name WHEN p.type = 'IS_PAYMENT' OR p.type IS NULL THEN tp.name END AS "Postcode",
      tb.date,
      f.folio_number,
      lr.room_name AS room_no,
      CONCAT(f.first_name, ' ', f.last_name) AS "Guest_Name",
      f.company_name,
      COALESCE(tb.description, CONCAT(INITCAP(REPLACE(COALESCE(tb.type, ''), '_', ' ')), ' - ', COALESCE(f.folio_number, ''), ' ', TRIM(CONCAT_WS(' ', NULLIF(tb.remark, ''), NULLIF(tb.last_digit_card::text, ''), NULLIF(tb.card_name, ''), NULLIF(tb.voucher, ''), NULLIF(tb.receipt, ''))))) AS description,
      tb.created_at AS "Posting_date",
      CASE WHEN tb.type = 'Room_Revenue' THEN ${staffName} WHEN tb.receipt IS NOT NULL THEN 'POS SYSTEM' ELSE u.name END AS "STAFF",
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.amount AS DECIMAL(18,2)) ELSE CAST(tb.amount AS DECIMAL(18,2)) END AS "Charge",
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.pb1 AS DECIMAL(18,2)) ELSE CAST(tb.pb1 AS DECIMAL(18,2)) END AS "Govt_tax",
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.svr_chrg AS DECIMAL(18,2)) ELSE CAST(tb.svr_chrg AS DECIMAL(18,2)) END AS svr_chrg,
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.surcharge AS DECIMAL(18,2)) ELSE CAST(tb.surcharge AS DECIMAL(18,2)) END AS surcharge,
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.total AS DECIMAL(18,2)) ELSE CAST(tb.total AS DECIMAL(18,2)) END AS total
    FROM transaction_breakdowns tb
    JOIN folios f ON tb.folio_id = f.id
    JOIN code_posts p ON tb.code = p.id::text
    LEFT JOIN users u ON tb.created_by = u.id
    LEFT JOIN type_payments tp ON tp.id = tb.type_payment_id
    LEFT JOIN last_room lr ON lr.folio_id = f.id
    WHERE f.property_id = ${pid}
      AND tb.date BETWEEN ${new Date(`${startDate}T00:00:00Z`)} AND ${new Date(`${endDate}T00:00:00Z`)}
      AND p.type IN ('DEFAULT', 'IS_PAYMENT')
    ORDER BY p.type, p.id, tb.created_at`;

  const reportData: Record<string, any> = {};
  let grandTotalCharge = 0, grandTotalGovtTax = 0, grandTotalSvcCharge = 0, grandTotalSurcharge = 0, grandTotal = 0, totalTransactions = 0;
  for (const r of rows) {
    const code = r.Postcode || 'UNKNOWN';
    if (!reportData[code]) reportData[code] = { transactions: [], count: 0, totalCharge: 0, totalGovtTax: 0, totalSvcCharge: 0, totalSurcharge: 0, totalAmount: 0 };
    const g = reportData[code];
    g.transactions.push({
      date: r.date ? formatDate(r.date) : '',
      folio_number: r.folio_number || '',
      room_no: r.room_no || '',
      Guest_Name: r.Guest_Name || '',
      company_name: r.company_name || '',
      description: r.description || '',
      STAFF: r.STAFF || '',
      Posting_date: r.Posting_date ? formatDateTimeLocal(r.Posting_date) : '',
      Charge: Number(r.Charge || 0),
      Govt_tax: Number(r.Govt_tax || 0),
      svr_chrg: Number(r.svr_chrg || 0),
      surcharge: Number(r.surcharge || 0),
      total: Number(r.total || 0),
    });
    g.count++;
    g.totalCharge += Number(r.Charge || 0);
    g.totalGovtTax += Number(r.Govt_tax || 0);
    g.totalSvcCharge += Number(r.svr_chrg || 0);
    g.totalSurcharge += Number(r.surcharge || 0);
    g.totalAmount += Number(r.total || 0);
    grandTotalCharge += Number(r.Charge || 0);
    grandTotalGovtTax += Number(r.Govt_tax || 0);
    grandTotalSvcCharge += Number(r.svr_chrg || 0);
    grandTotalSurcharge += Number(r.surcharge || 0);
    grandTotal += Number(r.total || 0);
    totalTransactions++;
  }

  return {
    reportTitle: 'Account Transaction Report',
    startDate,
    endDate,
    reportData,
    grandTotalCharge,
    grandTotalGovtTax,
    grandTotalSvcCharge,
    grandTotalSurcharge,
    grandTotal,
    totalTransactions,
  };
}

// ── Transaction Report (Before Night Audit) ──
// Laravel parity: TransactionRptController + transaction-rpt.blade.php
// Single date, grouped by post code name; guest bug-for-bug = first_name duplicated.

async function getTransactionRpt(params: any): Promise<any> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59Z`);

  const transactions = await prisma.transactions.findMany({
    where: { property_id: pid, date: { gte: start, lte: end }, deleted_at: null },
    select: { id: true, folio_id: true, code_name: true, description: true, amount: true, tax3: true, total: true, created_at: true, created_by: true },
    orderBy: { id: 'asc' },
  });

  const folioIds = transactions.map((t: any) => t.folio_id);
  const [folios, reservations, gps, users] = await Promise.all([
    prisma.folios.findMany({ where: { id: { in: folioIds } }, select: { id: true, folio_number: true, guest_profile_id: true } }),
    prisma.reservations.findMany({ where: { folio_id: { in: folioIds } }, select: { id: true, folio_id: true, room_name: true }, orderBy: { id: 'asc' } }),
    prisma.guest_profiles.findMany({ where: { id: { in: folioIds } }, select: { id: true, first_name: true, last_name: true } }),
    prisma.users.findMany({ where: { id: { in: transactions.map((t: any) => t.created_by).filter(Boolean) } }, select: { id: true, name: true } }),
  ]);

  const folioMap = new Map(folios.map((f: any) => [f.id, f]));
  const gpMap = new Map(gps.map((g: any) => [g.id, g]));
  const userMap = new Map(users.map((u: any) => [u.id, u.name]));
  const firstRoom = new Map<string, string>();
  for (const r of reservations) {
    if (!firstRoom.has(r.folio_id.toString())) firstRoom.set(r.folio_id.toString(), r.room_name || '');
  }

  const mapped = transactions.map((t: any) => {
    const f = folioMap.get(t.folio_id);
    const gp = f ? gpMap.get(f.guest_profile_id) : null;
    return {
      category: t.code_name || '',
      folio: f?.folio_number || '',
      guest: gp ? `${gp.first_name || ''} ${gp.first_name || ''}` : '',
      room: firstRoom.get(t.folio_id.toString()) || '',
      description: t.description || '',
      staff: userMap.get(t.created_by) || '',
      post_date_time: t.created_at ? formatDateDMY(t.created_at) : '',
      excl_tax: Number(t.amount || 0),
      gst: Number(t.tax3 || 0),
      total: Number(t.total || 0),
    };
  }).sort((a: any, b: any) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const categories: Record<string, any> = {};
  const totals = { excl_tax: 0, gst: 0, total: 0 };
  for (const row of mapped) {
    if (!categories[row.category]) categories[row.category] = { transactions: [], subtotal: { excl_tax: 0, gst: 0, total: 0 } };
    categories[row.category].transactions.push(row);
    categories[row.category].subtotal.excl_tax += row.excl_tax;
    categories[row.category].subtotal.gst += row.gst;
    categories[row.category].subtotal.total += row.total;
    totals.excl_tax += row.excl_tax;
    totals.gst += row.gst;
    totals.total += row.total;
  }

  return { reportTitle: 'Transaction Report', startDate: date, endDate: date, categories, totals };
}

async function generateTransactionRptExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Transaction Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio', 'Guest/Group', 'Room/Staff', 'Description', 'Post Date/Time', 'Excl Tax', 'GST', 'Total'];
  const nf = (v: any) => Number(v || 0).toFixed(2);

  ws.mergeCells(1, 1, 1, 8);
  const title = ws.getCell(1, 1);
  title.value = 'TRANSACTION REPORT';
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 8);
  const meta = ws.getCell(2, 1);
  meta.value = `Date: ${data.startDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };

  let rn = 3;
  for (const [categoryName, categoryData] of Object.entries<any>(data.categories || {})) {
    ws.getRow(rn).values = [categoryName];
    ws.mergeCells(rn, 1, rn, 8);
    ws.getRow(rn).font = { bold: true, size: 12 };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = HEADERS;
    ws.getRow(rn).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    for (const t of categoryData.transactions || []) {
      ws.getRow(rn).values = [t.folio, t.guest, t.room, t.description, t.post_date_time, nf(t.excl_tax), nf(t.gst), nf(t.total)];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = [`Subtotal for ${categoryName}`, '', '', '', '', nf(categoryData.subtotal.excl_tax), nf(categoryData.subtotal.gst), nf(categoryData.subtotal.total)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['Grand Total:', '', '', '', '', nf(data.totals.excl_tax), nf(data.totals.gst), nf(data.totals.total)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 3) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn >= 6 ? 'right' : 'left', wrapText: true };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="transaction-rpt.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Tax Breakdown (After Night Audit) ──
// Laravel parity: TaxBreakdownController + tax-breakdown.blade.php
// From transactions table, grouped by payment type.

async function getTaxBreakdownAfterNA(params: any): Promise<any> {
  const pid = params.propertyId;
  const date = params.date || params.startDate || formatDate(new Date());
  const start = new Date(`${date}T00:00:00Z`);

  const transactions = await prisma.transactions.findMany({
    // Laravel: Transaction::where('date', $date) equality (business date midnight)
    where: { property_id: pid, date: start, deleted_at: null },
    select: { id: true, folio_id: true, code_name: true, code_item_name: true, description: true, type_payment_name: true, amount: true, pb1: true, svr_chrg: true, total: true, created_at: true, created_by: true },
    orderBy: { id: 'asc' },
  });

  const folioIds = transactions.map((t: any) => t.folio_id);
  const folios = await prisma.folios.findMany({ where: { id: { in: folioIds }, deleted_at: null }, select: { id: true, folio_number: true, guest_profile_id: true, company_profile_id: true, booking_agent_id: true } });
  const gpIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter(Boolean))];
  const companyIds = [...new Set(folios.flatMap((f: any) => [f.company_profile_id, f.booking_agent_id]).filter(Boolean))];
  const [gps, companies] = await Promise.all([
    prisma.guest_profiles.findMany({ where: { id: { in: gpIds }, deleted_at: null }, select: { id: true, first_name: true, last_name: true } }),
    prisma.company_profiles.findMany({ where: { id: { in: companyIds }, deleted_at: null }, select: { id: true, name: true } }),
  ]);
  const reservations = await prisma.reservations.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null }, select: { id: true, folio_id: true, room_name: true }, orderBy: { id: 'asc' } });
  const users = await prisma.users.findMany({ where: { id: { in: transactions.map((t: any) => t.created_by).filter(Boolean) } }, select: { id: true, name: true } });

  const folioMap = new Map(folios.map((f: any) => [f.id, f]));
  const gpMap = new Map(gps.map((g: any) => [g.id, g]));
  const companyMap = new Map(companies.map((c: any) => [c.id, c]));
  const userMap = new Map(users.map((u: any) => [u.id, u.name]));
  const lastRoom = new Map<string, string>();
  for (const r of reservations) {
    lastRoom.set(r.folio_id.toString(), r.room_name || '');
  }

  const groupedTransactions: Record<string, any> = {};
  const totals = { charge: 0, govt_tax: 0, svc_charge: 0, total: 0 };
  let totalTransactions = 0;

  for (const t of transactions) {
    const f = folioMap.get(t.folio_id);
    const gp = f ? gpMap.get(f.guest_profile_id) : null;
    const company = f ? companyMap.get(f.company_profile_id) : null;
    const paymentType = t.type_payment_name || 'N/A';
    if (!groupedTransactions[paymentType]) groupedTransactions[paymentType] = { transactions: [], count: 0, charge: 0, govt_tax: 0, svc_charge: 0, total: 0 };
    const g = groupedTransactions[paymentType];
    const row = {
      payment_type: paymentType,
      folio: f?.folio_number || 'N/A',
      room: lastRoom.get(t.folio_id.toString()) || 'N/A',
      guest: gp ? `${gp.first_name || ''} ${gp.last_name || ''}` : (company ? company.name : 'N/A'),
      booking_agent: f?.booking_agent_id ? (companyMap.get(f.booking_agent_id)?.name || 'N/A') : 'N/A',
      description: t.description || (t.code_name ? t.code_name + (t.code_item_name ? ' - ' + t.code_item_name : '') : 'N/A'),
      post_date_time: t.created_at ? formatDateTimeLocal(t.created_at) : '',
      staff: userMap.get(t.created_by) || 'SYSTEM',
      charge: Number(t.amount || 0),
      govt_tax: Number(t.pb1 || 0),
      svc_charge: Number(t.svr_chrg || 0),
      total: Number(t.total || 0),
    };
    g.transactions.push(row);
    g.count++;
    g.charge += row.charge;
    g.govt_tax += row.govt_tax;
    g.svc_charge += row.svc_charge;
    g.total += row.total;
    totals.charge += row.charge;
    totals.govt_tax += row.govt_tax;
    totals.svc_charge += row.svc_charge;
    totals.total += row.total;
    totalTransactions++;
  }

  return { reportTitle: 'Tax Breakdown', startDate: date, endDate: date, groupedTransactions, totals, totalTransactions };
}

async function generateTaxBreakdownAfterNAExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Tax Breakdown');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio', 'Room', 'Guest', 'Booking Agent', 'Description', 'Staff', 'Post Date/Time', 'Charge', 'Govt Tax', 'Svc Charge', 'Total'];
  const nf = (v: any) => Number(v || 0).toFixed(2);

  ws.mergeCells(1, 1, 1, 11);
  const title = ws.getCell(1, 1);
  title.value = 'TAX BREAKDOWN';
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 11);
  const meta = ws.getCell(2, 1);
  meta.value = `Period: ${data.startDate || ''} - ${data.endDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };

  let rn = 3;
  for (const [paymentType, group] of Object.entries<any>(data.groupedTransactions || {})) {
    ws.getRow(rn).values = [paymentType];
    ws.mergeCells(rn, 1, rn, 11);
    ws.getRow(rn).font = { bold: true, size: 12 };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = HEADERS;
    ws.getRow(rn).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    for (const t of group.transactions || []) {
      ws.getRow(rn).values = [t.folio, t.room, t.guest, t.booking_agent, t.description, t.staff, t.post_date_time, nf(t.charge), nf(t.govt_tax), nf(t.svc_charge), nf(t.total)];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = [`Number of Transactions: ${group.count}`, '', '', '', '', '', '', nf(group.charge), nf(group.govt_tax), nf(group.svc_charge), nf(group.total)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = [`Total Transactions: ${data.totalTransactions || 0}`, '', '', '', '', '', '', nf(data.totals.charge), nf(data.totals.govt_tax), nf(data.totals.svc_charge), nf(data.totals.total)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 3) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn >= 8 ? 'right' : 'left', wrapText: true };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="tax-breakdown.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Tax Breakdown Summary (After Night Audit) ──
// Laravel parity: TaxBreakdownSummaryController + tax-breakdown-summary.blade.php
// Payments (MINUS) + Postings (PLUS) grouped by code + Resort Business Done.

async function getTaxBreakdownSummaryAfterNA(params: any): Promise<any> {
  const pid = params.propertyId;
  const date = params.date || params.startDate || formatDate(new Date());
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59Z`);

  const transactions = await prisma.transactions.findMany({
    where: { property_id: pid, date: { gte: start, lte: end }, deleted_at: null },
    select: { id: true, code: true, code_name: true, type_payment_name: true, type_amount: true, amount: true, tax3: true, svr_chrg: true, total: true },
    orderBy: { id: 'asc' },
  });

  const buildGroups = (rows: any[], wantMinus: boolean) => {
    const groups = new Map<string, { description: string; charge: number; govtTax: number; svcCharge: number; total: number }>();
    for (const t of rows) {
      const isMinus = (t.type_amount || '').toUpperCase() === 'MINUS';
      if (wantMinus !== isMinus) continue;
      const key = String(t.code || '');
      if (!groups.has(key)) {
        groups.set(key, {
          description: wantMinus ? (t.type_payment_name || 'Unknown') : (t.code_name || 'Unknown'),
          charge: 0, govtTax: 0, svcCharge: 0, total: 0,
        });
      }
      const g = groups.get(key)!;
      const abs = wantMinus ? -1 : 1;
      g.charge += Number(t.amount || 0) * abs;
      g.govtTax += Number(t.tax3 || 0) * abs;
      g.svcCharge += Number(t.svr_chrg || 0) * abs;
      g.total += Number(t.total || 0) * abs;
    }
    return Array.from(groups.values());
  };

  const payments = buildGroups(transactions, true);
  const postings = buildGroups(transactions, false);

  const sum = (arr: any[], key: string) => arr.reduce((acc, x) => acc + (x[key] || 0), 0);
  const totalPayment = { charge: sum(payments, 'charge'), govtTax: sum(payments, 'govtTax'), svcCharge: sum(payments, 'svcCharge'), total: sum(payments, 'total') };
  const totalPostings = { charge: sum(postings, 'charge'), govtTax: sum(postings, 'govtTax'), svcCharge: sum(postings, 'svcCharge'), total: sum(postings, 'total') };
  const resortBusinessDone = totalPostings.total - totalPayment.total;

  return {
    reportTitle: 'Tax Breakdown Summary',
    businessDate: formatDateDMY(date),
    payments,
    postings,
    totalPayment,
    totalPostings,
    resortBusinessDone,
    startDate: date,
    endDate: date,
  };
}

async function generateTaxBreakdownSummaryAfterNAExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Tax Breakdown Summary');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Posting Description', 'Charge', 'Govt Tax', 'Svc Charge', 'Total'];
  const nf = (v: any) => Number(v || 0).toFixed(2);

  ws.mergeCells(1, 1, 1, 5);
  const title = ws.getCell(1, 1);
  title.value = 'TAX BREAKDOWN SUMMARY';
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 5);
  const meta = ws.getCell(2, 1);
  meta.value = `Business Date: ${data.businessDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };

  let rn = 4;
  ws.getRow(rn).values = HEADERS;
  ws.getRow(rn).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn++;
  for (const p of data.payments || []) {
    ws.getRow(rn).values = [p.description, nf(p.charge), nf(p.govtTax), nf(p.svcCharge), nf(p.total)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['Total Payment:', nf(data.totalPayment.charge), nf(data.totalPayment.govtTax), nf(data.totalPayment.svcCharge), nf(data.totalPayment.total)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn++;
  for (const p of data.postings || []) {
    ws.getRow(rn).values = [p.description, nf(p.charge), nf(p.govtTax), nf(p.svcCharge), nf(p.total)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['Total Postings:', nf(data.totalPostings.charge), nf(data.totalPostings.govtTax), nf(data.totalPostings.svcCharge), nf(data.totalPostings.total)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn++;
  ws.getRow(rn).values = ['Resort Business Done :', `(${nf(Math.abs(data.resortBusinessDone || 0))})`];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 4) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn === 1 ? 'left' : 'right' };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="tax-breakdown-summary-after-na.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Transfer Transaction ──
// Laravel parity: TransferTransactionController + transfer-transaction.blade.php

async function getTransferTransaction(params: any): Promise<any> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  const transactions = await prisma.transactions.findMany({
    where: { property_id: pid, date: { gte: start, lte: end }, is_transfer: 1, type_amount: 'MINUS', deleted_at: null },
    select: { id: true, folio_id: true, remark: true, code_name: true, total: true, date: true, created_by: true },
    orderBy: { id: 'asc' },
  });

  const folioIds = transactions.map((t: any) => t.folio_id);
  const cleanedNumbers = Array.from(new Set(transactions.map((t: any) => (t.remark || '').replace('To - ', '')))).filter(Boolean) as string[];

  const [folios, toFolios, users] = await Promise.all([
    prisma.folios.findMany({ where: { id: { in: folioIds }, deleted_at: null }, select: { id: true, folio_number: true } }),
    prisma.folios.findMany({ where: { folio_number: { in: cleanedNumbers }, deleted_at: null }, select: { id: true, folio_number: true } }),
    prisma.users.findMany({ where: { id: { in: transactions.map((t: any) => t.created_by).filter(Boolean) } }, select: { id: true, name: true } }),
  ]);

  const allFolioIds = Array.from(new Set([...folioIds, ...toFolios.map((f: any) => f.id)]));
  const reservations = await prisma.reservations.findMany({
    where: { folio_id: { in: allFolioIds }, deleted_at: null },
    select: { id: true, folio_id: true, room_name: true, is_posting: true, date: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

  const folioMap = new Map(folios.map((f: any) => [f.id, f]));
  // Laravel first() per folio_number = lowest id, deleted_at null
  const toFolioMap = new Map();
  for (const f of [...toFolios].sort((a: any, b: any) => Number(a.id) - Number(b.id))) {
    if (!toFolioMap.has(f.folio_number)) toFolioMap.set(f.folio_number, f);
  }
  const userMap = new Map(users.map((u: any) => [u.id, u.name]));

  const lastReservation = (folioId: any): any => {
    if (folioId == null) return null;
    const list = reservations.filter((r: any) => r.folio_id === folioId);
    // Laravel: is_posting=0 orderBy date asc first(); fallback newest date
    for (const r of list) {
      if (r.is_posting === 0) return r;
    }
    return list[list.length - 1] || null;
  };
  // Laravel folio->reservation first() = lowest id, no is_posting filter
  const firstReservation = (folioId: any): any => {
    if (folioId == null) return null;
    return reservations.filter((r: any) => r.folio_id === folioId)
      .sort((a: any, b: any) => Number(a.id) - Number(b.id))[0] || null;
  };

  const reportData = transactions.map((t: any) => {
    const f = folioMap.get(t.folio_id);
    const fromRes = lastReservation(f?.id);
    const cleaned = (t.remark || '').replace('To - ', '');
    const isTransferFolio = /^[A-Za-z]{1}[0-9]+$/.test(cleaned) && /^[FGV]/.test(cleaned);
    const toFolio = isTransferFolio ? (toFolioMap.get(cleaned) || { folio_number: cleaned }) : f;
    const toRoom = isTransferFolio
      ? (firstReservation(toFolio?.id)?.room_name || 'N/A')
      : (fromRes?.room_name || 'N/A');
    return {
      date: t.date ? formatDateDMY(t.date) : '',
      fromFolio: f?.folio_number,
      fromRoomNumber: fromRes?.room_name || 'N/A',
      toFolio: toFolio?.folio_number,
      toRoomNumber: toRoom,
      postcode: t.code_name || 'N/A',
      amount: Number(t.total || 0),
      staff: userMap.get(t.created_by) || '',
    };
  });

  return { reportTitle: 'Transfer Transaction', startDate: formatDateDMY(startDate), endDate: formatDateDMY(endDate), reportData };
}

async function generateTransferTransactionExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Transfer Transaction');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Date', 'From Folio', 'From Room Number', 'To Folio', 'To Room Number', 'Post Code', 'Amount', 'Staff'];
  const nf = (v: any) => Number(v || 0).toFixed(2);

  ws.mergeCells(1, 1, 1, 8);
  const title = ws.getCell(1, 1);
  title.value = 'TRANSFER TRANSACTION';
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 8);
  const meta = ws.getCell(2, 1);
  meta.value = `Date From ${data.startDate || ''} To ${data.endDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };

  ws.getRow(4).values = HEADERS;
  ws.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
  ws.getRow(4).eachCell((c: any) => { c.border = border; });

  let rn = 5;
  for (const t of data.reportData || []) {
    ws.getRow(rn).values = [t.date, t.fromFolio, t.fromRoomNumber, t.toFolio, t.toRoomNumber, t.postcode, nf(t.amount), t.staff];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 4) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn === 7 ? 'right' : 'left', wrapText: true };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="transfer-transaction.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── In House Guest Detail ──
// Laravel parity: InHouseGuestDetailController raw SQL + in-house-guest-detail.blade.php

async function getInHouseGuestDetail(params: any): Promise<any> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const rows: any = await prisma.$queryRaw`
    SELECT
      r.name AS room_name,
      f.check_in_date,
      f.check_out_date,
      CONCAT(g.first_name, ' ', g.last_name) AS full_name,
      g.card_type,
      g.card_number,
      g.email,
      g.telp AS phone,
      g.gender,
      g.birth_of_date,
      g.address,
      c.nationality,
      ci.name AS city_name
    FROM folios f
    JOIN reservations res ON f.id = res.folio_id
    JOIN rooms r ON res.room_id = r.id
    JOIN guest_profiles g ON f.guest_profile_id = g.id
    LEFT JOIN countries c ON g.nationality_id = c.id
    LEFT JOIN cities ci ON g.city_id = ci.id
    WHERE f.property_id = ${pid}
      AND f.type_reservation <> 'vr'
      AND res.date BETWEEN ${new Date(`${startDate}T00:00:00Z`)} AND ${new Date(`${endDate}T00:00:00Z`)}
      AND r.name IS NOT NULL
    ORDER BY r.name`;

  return { reportTitle: 'In House Guest Detail Report', guests: bigintToNumber(rows), startDate, endDate };
}

async function generateInHouseGuestDetailExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('In House Guest Detail');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['No', 'Room No', 'Guest Name', 'Arrival', 'Departure', 'ID Type', 'ID Number', 'Phone', 'Email', 'Gender', 'Birth Date', 'Nationality', 'City', 'Address'];

  ws.mergeCells(1, 1, 1, 14);
  const title = ws.getCell(1, 1);
  title.value = 'IN HOUSE GUEST DETAIL REPORT';
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 14);
  const meta = ws.getCell(2, 1);
  meta.value = `Period: ${data.startDate || ''} - ${data.endDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };

  ws.getRow(4).values = HEADERS;
  ws.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
  ws.getRow(4).eachCell((c: any) => { c.border = border; });

  let rn = 5;
  const guests = data.guests || [];
  if (guests.length === 0) {
    ws.mergeCells(rn, 1, rn, 14);
    ws.getRow(rn).values = ['No guests found in selected period.'];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  } else {
    for (const [index, g] of guests.entries()) {
      const gender = g.gender === 'M' ? 'Male' : (g.gender === 'F' ? 'Female' : '-');
      ws.getRow(rn).values = [
        index + 1,
        g.room_name,
        g.full_name,
        g.check_in_date ? formatDateDMY(g.check_in_date) : '-',
        g.check_out_date ? formatDateDMY(g.check_out_date) : '-',
        g.card_type || '-',
        g.card_number || '-',
        g.phone || '-',
        g.email || '-',
        gender,
        g.birth_of_date ? formatDateDMY(g.birth_of_date) : '-',
        g.nationality || '-',
        g.city_name || '-',
        g.address || '-',
      ];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
  }

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 4) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn === 1 || (cn >= 4 && cn <= 6) || cn === 10 || cn === 11 ? 'center' : 'left', wrapText: true };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="in-house-guest-detail-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Room Utilization Report ──
// Laravel parity: ReportService::room_utilization_report + room-utilization-report.blade.php

async function getRoomUtilizationReport(params: any): Promise<any> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const [roomTypes, rooms, folios] = await Promise.all([
    // Laravel withOutGlobalScopes: room_types NO deleted_at filter
    prisma.room_types.findMany({ where: { property_id: pid, status: 1 }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.rooms.findMany({ where: { property_id: pid, deleted_at: null, status: 1 }, select: { id: true, name: true, room_type_id: true }, orderBy: { id: 'asc' } }),
    // Laravel withOutGlobalScopes: folios NO deleted_at filter; DATE(check_in_date) BETWEEN
    prisma.folios.findMany({ where: { property_id: pid, check_in_date: { gte: start, lte: end } }, select: { id: true, folio_number: true, first_name: true, last_name: true, check_in_date: true, check_out_date: true } }),
  ]);

  const folioIds = folios.map((f: any) => f.id);
  const roomIds = rooms.map((r: any) => r.id);
  const reservations = folioIds.length && roomIds.length
    ? await prisma.reservations.findMany({ where: { folio_id: { in: folioIds }, room_id: { in: roomIds } }, select: { folio_id: true, room_id: true } })
    : [];

  const folioResCount = new Map<string, number>();
  for (const r of reservations) {
    const key = `${r.folio_id}:${r.room_id}`;
    folioResCount.set(key, (folioResCount.get(key) || 0) + 1);
  }

  const roomsByType = new Map<string, any[]>();
  for (const room of rooms) {
    const key = room.room_type_id.toString();
    if (!roomsByType.has(key)) roomsByType.set(key, []);
    roomsByType.get(key)!.push(room);
  }

  const reportData = roomTypes.map((rt: any) => ({
    name: rt.name,
    room: (roomsByType.get(rt.id.toString()) || []).map((room: any) => {
      const roomFolios = folios.filter((f: any) => (folioResCount.get(`${f.id}:${room.id}`) || 0) > 0);
      return {
        name: room.name,
        folios: roomFolios.map((f: any) => ({
          folio_number: f.folio_number,
          check_in_date: f.check_in_date ? formatDate(f.check_in_date) : '',
          check_out_date: f.check_out_date ? formatDate(f.check_out_date) : '',
          guest_name: (f.first_name || '') !== '' || (f.last_name || '') !== ''
            ? `${f.first_name || ''} ${f.last_name || ''}`.trim()
            : '',
          noNight: folioResCount.get(`${f.id}:${room.id}`) || 0,
        })),
      };
    }).filter((room: any) => room.folios.length > 0),
  }));

  return { reportTitle: 'Room Utilization Report', rooms: reportData, startDate, endDate };
}

async function generateRoomUtilizationExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Utilization Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['FOLIO', 'CHECK - IN', 'CHECK-OUT', 'GUEST NAME', 'No. Night'];

  ws.mergeCells(1, 1, 1, 5);
  const title = ws.getCell(1, 1);
  title.value = `ROOM UTILIZATION REPORT FROM ${data.startDate || ''} TO ${data.endDate || ''}`;
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };

  let rn = 3;
  ws.getRow(rn).values = HEADERS;
  ws.getRow(rn).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn++;

  for (const roomType of data.rooms || []) {
    ws.getRow(rn).values = [roomType.name];
    ws.mergeCells(rn, 1, rn, 5);
    ws.getRow(rn).font = { bold: true, size: 12 };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    if (roomType.room.length > 0) {
      for (const room of roomType.room) {
        ws.getRow(rn).values = [`ROOM : ${room.name}`];
        ws.mergeCells(rn, 1, rn, 2);
        ws.getRow(rn).eachCell((c: any) => { c.border = border; });
        ws.getCell(rn, 3).value = `Total : ${room.folios.reduce((acc: number, f: any) => acc + (f.noNight || 0), 0)} Nite`;
        ws.mergeCells(rn, 3, rn, 5);
        ws.getRow(rn).font = { bold: true };
        ws.getRow(rn).eachCell((c: any) => { c.border = border; });
        rn++;
        for (const f of room.folios) {
          ws.getRow(rn).values = [f.folio_number, f.check_in_date, f.check_out_date, f.guest_name, f.noNight];
          ws.getRow(rn).eachCell((c: any) => { c.border = border; });
          rn++;
        }
      }
    } else {
      ws.mergeCells(rn, 1, rn, 5);
      ws.getRow(rn).values = ['No data'];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
  }

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 3) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn === 5 ? 'right' : 'left' };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="room-utilization-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── T3b: Laravel-only reporting keys (Weekly Booking / Calendar Operation / Daily Check-in / Company Profile / Guest Listing) ──

async function getWeeklyBooking(params: any): Promise<any> {
  const pid = params.propertyId;
  const tryDate = (v: any): Date | null => {
    if (!v) return null;
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  };
  const weekStart = (d: Date): Date => {
    const offset = (d.getUTCDay() + 6) % 7; // Carbon startOfWeek = Monday
    const s = new Date(d);
    s.setUTCDate(s.getUTCDate() - offset);
    return s;
  };
  // start/end bounds computed independently (Laravel: isDate invalid -> businessDate week; valid -> startOfWeek/endOfWeek of that value)
  const startDate = weekStart(tryDate(params.startDate || params.date) ?? new Date());
  const endBase = weekStart(tryDate(params.endDate || params.date) ?? new Date());
  const endDate = new Date(endBase);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);

  const reservations = await prisma.reservations.findMany({
    where: {
      property_id: pid,
      date: { gte: new Date(`${startDateStr}T00:00:00Z`), lte: new Date(`${endDateStr}T23:59:59Z`) },
      deleted_at: null,
    },
    select: { id: true, folio_id: true, adult: true, child: true, promo_code: true },
    orderBy: { id: 'asc' },
  });

  const folioIds = [...new Set(reservations.map((r: any) => Number(r.folio_id)))];
  const folios = folioIds.length
    ? await prisma.folios.findMany({
        where: { id: { in: folioIds } },
        select: { id: true, company_profile_id: true, check_in_date: true, check_out_date: true },
      })
    : [];
  const companyIds = [...new Set(folios.map((f: any) => Number(f.company_profile_id)).filter(Boolean))];
  const companies = companyIds.length
    ? await prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
    : [];
  const types = await prisma.types.findMany({
    where: { property_id: pid, deleted_at: null },
    select: { id: true, group: true, name: true },
  });
  const typeById = new Map(types.map((t: any) => [Number(t.id), t]));
  const folioMht = folioIds.length
    ? await prisma.model_has_types.findMany({
        where: { model_type: 'App\\Models\\Folio', model_id: { in: folioIds } },
        select: { type_id: true, model_id: true },
      })
    : [];
  const companyMht = companyIds.length
    ? await prisma.model_has_types.findMany({
        where: { model_type: 'App\\Models\\CompanyProfile', model_id: { in: companyIds } },
        select: { type_id: true, model_id: true },
      })
    : [];
  const companyTypeNames = new Map<number, string[]>();
  for (const m of companyMht) {
    const t = typeById.get(Number(m.type_id));
    if (!t) continue;
    const list = companyTypeNames.get(Number(m.model_id)) || [];
    list.push(t.name);
    companyTypeNames.set(Number(m.model_id), list);
  }
  const companyNameById = new Map(companies.map((c: any) => [Number(c.id), c.name]));
  const promoCodes = [...new Set(reservations.map((r: any) => r.promo_code).filter(Boolean))];
  const promotions = promoCodes.length
    ? await prisma.promotions.findMany({
        where: { property_id: pid, promotion_code: { in: promoCodes } },
        select: { promotion_code: true, description: true },
      })
    : [];
  const promoDesc = new Map(promotions.map((p: any) => [p.promotion_code, p.description]));

  const sourceData = new Map<string, any>();
  const companyData = new Map<string, any>();
  const otaData = new Map<string, any>();
  const directBookingData: any = { LINE: { reservations: 0, persons: 0, nights: 0 }, WHATSAPP: { reservations: 0, persons: 0, nights: 0 }, TELEPHONE: { reservations: 0, persons: 0, nights: 0 }, INSTAGRAM: { reservations: 0, persons: 0, nights: 0 } };
  const othersPromoData = new Map<string, any>();
  let totalReservations = 0;
  let totalPerson = 0;
  let totalNights = 0;

  for (const res of reservations) {
    const folio = folios.find((f: any) => Number(f.id) === Number(res.folio_id));
    let srcName = 'Other';
    for (const m of folioMht) {
      if (Number(m.model_id) !== Number(res.folio_id)) continue;
      const t = typeById.get(Number(m.type_id));
      if (t && t.group === 'source') { srcName = t.name; break; }
    }
    const persons = (Number(res.adult) || 0) + (Number(res.child) || 0);
    const nights = folio ? diffDays(folio.check_in_date, folio.check_out_date) : 0;
    totalReservations += 1;
    totalPerson += persons;
    totalNights += nights;

    if (!sourceData.has(srcName)) sourceData.set(srcName, { reservations: 0, persons: 0, nights: 0 });
    const sd = sourceData.get(srcName)!;
    sd.reservations += 1; sd.persons += persons; sd.nights += nights;

    const companyName = folio?.company_profile_id ? (companyNameById.get(Number(folio.company_profile_id)) ?? '') : '';
    const cTypes = folio?.company_profile_id ? (companyTypeNames.get(Number(folio.company_profile_id)) || []) : [];
    const isOta = cTypes.some((n: string) => n.toUpperCase().includes('OTA'));
    if (companyName && !isOta) {
      if (!companyData.has(companyName)) companyData.set(companyName, { reservations: 0, persons: 0, nights: 0 });
      const cd = companyData.get(companyName)!;
      cd.reservations += 1; cd.persons += persons; cd.nights += nights;
    } else if (companyName && isOta) {
      if (!otaData.has(companyName)) otaData.set(companyName, { reservations: 0, persons: 0, nights: 0 });
      const od = otaData.get(companyName)!;
      od.reservations += 1; od.persons += persons; od.nights += nights;
    }

    const directKeys = ['LINE', 'WHATSAPP', 'TELEPHONE', 'INSTAGRAM'];
    if (directKeys.includes(srcName)) {
      const dk = directBookingData[srcName];
      dk.reservations += 1; dk.persons += persons; dk.nights += nights;
      if (res.promo_code) {
        // Laravel: keyed by promo CODE (name = description ?? code) — same desc different codes stay separate rows
        const promoKey = String(res.promo_code);
        const promoName = promoDesc.get(promoKey) ?? promoKey;
        if (!othersPromoData.has(promoKey)) othersPromoData.set(promoKey, { name: promoName, sources: { LINE: { reservations: 0, persons: 0, nights: 0 }, WHATSAPP: { reservations: 0, persons: 0, nights: 0 }, TELEPHONE: { reservations: 0, persons: 0, nights: 0 }, INSTAGRAM: { reservations: 0, persons: 0, nights: 0 } } });
        const p = othersPromoData.get(promoKey)!;
        const ps = p.sources[srcName];
        ps.reservations += 1; ps.persons += persons; ps.nights += nights;
      }
    }
  }

  const totalAll = [...sourceData.values()].reduce((s: number, v: any) => s + v.reservations, 0);
  const pct = (x: number) => (totalAll > 0 ? (x / totalAll) * 100 : 0);

  return {
    startDate: formatLongDate(startDate),
    endDate: formatLongDate(endDate),
    sourceData: [...sourceData.entries()].map(([name, v]) => ({ name, ...v, percentage: pct(v.reservations) })),
    companyData: [...companyData.entries()].map(([name, v]) => ({ name, ...v, percentage: pct(v.reservations) })),
    otaData: [...otaData.entries()].map(([name, v]) => ({ name, ...v, percentage: pct(v.reservations) })),
    directBookingData: Object.entries(directBookingData).map(([name, v]: any) => ({ name, ...v, percentage: pct(v.reservations) })),
    othersPromoData: [...othersPromoData.values()].map((p: any) => ({
      ...p,
      sources: Object.entries(p.sources).map(([name, v]: any) => ({ name, ...v, percentage: pct(v.reservations) })),
    })),
    totalReservations,
    totalPerson,
    totalNights,
  };
}

async function generateWeeklyBookingExcel(res: any, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('WeeklyBooking');
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  ws.mergeCells('A1:H1');
  const t1 = ws.getCell('A1');
  t1.value = `Weekly Booking Report ${data.startDate} - ${data.endDate}`;
  t1.font = { bold: true, size: 14 };

  const totalAll = data.totalReservations;
  const pct = (x: number) => `${Number((x / Math.max(totalAll, 1) * 100).toFixed(2))}%`;
  const rows: any[] = [
    { title: 'Reservation Source Summary', nameCol: 'Source', data: data.sourceData },
    { title: 'Company Reservations', nameCol: 'Company Name', data: data.companyData },
    { title: 'OTA Reservations', nameCol: 'OTA Name', data: data.otaData },
    { title: 'Direct Booking', nameCol: 'Direct Booking', data: data.directBookingData, totalLabel: 'TOTAL DIRECT BOOKING' },
  ];
  let r = 3;
  for (const section of rows) {
    ws.mergeCells(`A${r}:F${r}`);
    const c = ws.getCell(`A${r}`);
    c.value = section.title;
    c.font = { bold: true };
    c.alignment = { horizontal: 'center' };
    r++;
    const hr = r;
    ['No', section.nameCol, 'Number of Reservations', 'Total Person', 'Total Night', 'Percentage'].forEach((h, i) => {
      ws.getCell(hr, 1 + i).value = h;
      ws.getCell(hr, 1 + i).font = { bold: true };
      ws.getCell(hr, 1 + i).alignment = { horizontal: 'center' };
    });
    r++;
    section.data.forEach((item: any, i: number) => {
      ws.getCell(r, 1).value = i + 1;
      ws.getCell(r, 2).value = item.name;
      ws.getCell(r, 3).value = `${item.reservations} 件`;
      ws.getCell(r, 4).value = `${item.persons} 人`;
      ws.getCell(r, 5).value = `${item.nights} 泊`;
      ws.getCell(r, 6).value = pct(item.reservations);
      r++;
    });
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = section.totalLabel || 'Total';
    ws.getCell(`A${r}`).font = { bold: true };
    const tsum = section.data.reduce((s: number, x: any) => s + x.reservations, 0);
    const psum = section.data.reduce((s: number, x: any) => s + x.persons, 0);
    const nsum = section.data.reduce((s: number, x: any) => s + x.nights, 0);
    ws.getCell(r, 3).value = `${tsum} 件`;
    ws.getCell(r, 4).value = `${psum} 人`;
    ws.getCell(r, 5).value = `${nsum} 泊`;
    ws.getCell(r, 6).value = pct(tsum);
    ws.getCell(r, 6).font = { bold: true };
    r += 2;
  }

  // Others (Promo)
  ws.mergeCells(`A${r}:F${r}`);
  const oc = ws.getCell(`A${r}`);
  oc.value = 'Others (Promo)';
  oc.font = { bold: true };
  oc.alignment = { horizontal: 'center' };
  r++;
  const hr2 = r;
  ['No', 'Others (Promo)', 'Number of Reservations', 'Total Person', 'Total Night', 'Percentage'].forEach((h, i) => {
    ws.getCell(hr2, 1 + i).value = h;
    ws.getCell(hr2, 1 + i).font = { bold: true };
    ws.getCell(hr2, 1 + i).alignment = { horizontal: 'center' };
  });
  r++;
  if (data.othersPromoData.length > 0) {
    let promoCounter = 1;
    for (const promo of data.othersPromoData) {
      const spanRows = promo.sources.length + 2;
      ws.mergeCells(`A${r}:A${r + spanRows - 1}`);
      ws.getCell(`A${r}`).value = promoCounter;
      ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
      ws.mergeCells(`B${r}:F${r}`);
      ws.getCell(`B${r}`).value = promo.name;
      r++;
      for (const src of promo.sources) {
        ws.getCell(r, 2).value = src.name;
        ws.getCell(r, 3).value = src.reservations;
        ws.getCell(r, 4).value = src.persons;
        ws.getCell(r, 5).value = src.nights;
        ws.getCell(r, 6).value = pct(src.reservations);
        r++;
      }
      ws.getCell(r, 2).value = 'TOTAL';
      ws.getCell(r, 2).font = { bold: true };
      ws.getCell(r, 3).value = promo.sources.reduce((s: number, x: any) => s + x.reservations, 0);
      ws.getCell(r, 4).value = promo.sources.reduce((s: number, x: any) => s + x.persons, 0);
      ws.getCell(r, 5).value = promo.sources.reduce((s: number, x: any) => s + x.nights, 0);
      ws.getCell(r, 6).value = pct(promo.sources.reduce((s: number, x: any) => s + x.reservations, 0));
      r++;
      promoCounter++;
    }
  } else {
    ws.getCell(r, 1).value = 1;
    ws.mergeCells(`B${r}:F${r}`);
    ws.getCell(`B${r}`).value = 'No promo data available';
    r++;
  }
  ws.mergeCells(`A${r}:B${r}`);
  ws.getCell(`A${r}`).value = 'TOTAL OTHERS';
  ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(r, 3).value = `${data.othersPromoData.reduce((s: number, p: any) => s + p.sources.reduce((a: number, x: any) => a + x.reservations, 0), 0)}件`;
  ws.getCell(r, 4).value = `${data.othersPromoData.reduce((s: number, p: any) => s + p.sources.reduce((a: number, x: any) => a + x.persons, 0), 0)}人`;
  ws.getCell(r, 5).value = `${data.othersPromoData.reduce((s: number, p: any) => s + p.sources.reduce((a: number, x: any) => a + x.nights, 0), 0)}泊`;
  ws.getCell(r, 6).value = pct(data.othersPromoData.reduce((s: number, p: any) => s + p.sources.reduce((a: number, x: any) => a + x.reservations, 0), 0));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="weekly-booking.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function getCalendarOperation(params: any): Promise<any> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const totalRooms = await prisma.rooms.count({ where: { property_id: pid, deleted_at: null, status: 1 } });

  const reservations = await prisma.reservations.findMany({
    where: {
      property_id: pid,
      date: { gte: new Date(`${startDate}T00:00:00Z`), lte: new Date(`${endDate}T23:59:59Z`) },
      deleted_at: null,
    },
    select: { id: true, folio_id: true, date: true, rate_id: true },
    orderBy: { id: 'asc' },
  });
  const folioIds = [...new Set(reservations.map((x: any) => Number(x.folio_id)))];
  const folios = folioIds.length
    ? await prisma.folios.findMany({
        where: { id: { in: folioIds } },
        select: { id: true, status_reservation: true, is_house_use: true, complimentary: true, type_reservation: true, folio_number: true, company_profile_id: true },
      })
    : [];
  const folioById = new Map(folios.map((f: any) => [Number(f.id), f]));

  const rateIds = [...new Set(reservations.map((x: any) => Number(x.rate_id)).filter(Boolean))];
  let complimentRateIds = new Set<number>();
  let houseRateIds = new Set<number>();
  if (rateIds.length) {
    const rateMht = await prisma.model_has_types.findMany({
      where: { model_type: 'App\\Models\\Rate', model_id: { in: rateIds } },
      select: { type_id: true, model_id: true },
    });
    const typeIds = [...new Set(rateMht.map((m: any) => Number(m.type_id)))];
    const rateTypes = typeIds.length
      ? await prisma.types.findMany({ where: { id: { in: typeIds } }, select: { id: true, group: true, name: true } })
      : [];
    const rtypeById = new Map(rateTypes.map((t: any) => [Number(t.id), t]));
    complimentRateIds = new Set(rateMht.filter((m: any) => rtypeById.get(Number(m.type_id))?.group === 'company-type' && rtypeById.get(Number(m.type_id))?.name.toLowerCase().includes('compliment')).map((m: any) => Number(m.model_id)));
    houseRateIds = new Set(rateMht.filter((m: any) => rtypeById.get(Number(m.type_id))?.group === 'company-type' && rtypeById.get(Number(m.type_id))?.name.toLowerCase().includes('house use')).map((m: any) => Number(m.model_id)));
  }

  const companyIds = [...new Set(folios.map((f: any) => Number(f.company_profile_id)).filter(Boolean))];
  const companyTypeNames = new Map<number, string[]>();
  if (companyIds.length) {
    const companyMht = await prisma.model_has_types.findMany({
      where: { model_type: 'App\\Models\\CompanyProfile', model_id: { in: companyIds } },
      select: { type_id: true, model_id: true },
    });
    const ctypeIds = [...new Set(companyMht.map((m: any) => Number(m.type_id)))];
    const ctypes = ctypeIds.length ? await prisma.types.findMany({ where: { id: { in: ctypeIds } }, select: { id: true, name: true } }) : [];
    const ctypeById = new Map(ctypes.map((t: any) => [Number(t.id), t]));
    for (const m of companyMht) {
      const t = ctypeById.get(Number(m.type_id));
      if (!t) continue;
      const list = companyTypeNames.get(Number(m.model_id)) || [];
      list.push(t.name);
      companyTypeNames.set(Number(m.model_id), list);
    }
  }

  const eligible = (folioId: number, rateId: any): any => {
    const f = folioById.get(folioId);
    if (!f) return null;
    if ([5, 2].includes(f.status_reservation)) return null;
    if (f.is_house_use || f.complimentary) return null;
    const t = f.type_reservation;
    if (!(t === 'fit' || t === 'git' || (t === 'vr' && (f.folio_number || '').startsWith('F')))) return null;
    if (complimentRateIds.has(Number(rateId)) || houseRateIds.has(Number(rateId))) return null;
    return f;
  };

  const resByDay = new Map<string, any[]>();
  for (const rsv of reservations) {
    const day = formatDate(rsv.date);
    if (!resByDay.has(day)) resByDay.set(day, []);
    resByDay.get(day)!.push(rsv);
  }

  const monthlyData: any[] = [];
  let runningTotal = 0;
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const lastDay = new Date(`${endDate}T23:59:59Z`);
  while (cursor <= lastDay) {
    // Laravel chunk: startDate + n months; chunkEnd = endDate only when same month, else chunkStart itself (1 day)
    const sameMonth = cursor.getUTCFullYear() === lastDay.getUTCFullYear() && cursor.getUTCMonth() === lastDay.getUTCMonth();
    const chunkEnd = sameMonth ? new Date(lastDay) : new Date(cursor);
    const daysInMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();

    const dailyData: any[] = [];
    let dayCursor = new Date(cursor);
    while (dayCursor <= chunkEnd) {
      const day = formatDate(dayCursor);
      const dayRes = (resByDay.get(day) || []).map((rsv: any) => eligible(Number(rsv.folio_id), rsv.rate_id)).filter(Boolean);
      const dailyTotal = dayRes.length;
      runningTotal += dailyTotal;
      const travelAgent = dayRes.filter((f: any) => (companyTypeNames.get(Number(f.company_profile_id)) || []).includes('TRAVEL AGENT')).length;
      const ota = dayRes.filter((f: any) => (companyTypeNames.get(Number(f.company_profile_id)) || []).some((n: string) => n.toUpperCase().includes('OTA'))).length;
      const directBooking = dayRes.filter((f: any) => {
        const names = (companyTypeNames.get(Number(f.company_profile_id)) || []).map((n: string) => n.toUpperCase());
        return !names.includes('TRAVEL AGENT') && !names.includes('OTA');
      }).length;
      const tentative = dayRes.filter((f: any) => f.status_reservation === 5).length;
      const confirmed = dailyTotal - tentative;
      const occupancyRate = Math.round((dailyTotal / Math.max(totalRooms, 1)) * 1000) / 10;
      dailyData.push({
        date: day,
        day_name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayCursor.getUTCDay()],
        daily_total: dailyTotal,
        running_total: runningTotal,
        occupancy_rate: occupancyRate,
        travel_agent: travelAgent,
        ota,
        direct_booking: directBooking,
        tentative,
        confirmed,
      });
      dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    }
    monthlyData.push({
      start_date: formatDate(cursor),
      end_date: formatDate(chunkEnd),
      daily_data: dailyData,
      monthly_total: runningTotal,
      monthly_target: totalRooms * daysInMonth,
      monthly_occupancy_rate: Math.round((runningTotal / Math.max(totalRooms * daysInMonth, 1)) * 1000) / 10,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return { startDate, endDate, totalRooms, monthlyData };
}

async function generateCalendarOperationExcel(res: any, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('CalendarOperation');
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  let r = 1;
  ws.mergeCells(`A${r}:J${r}`);
  ws.getCell(`A${r}`).value = `Calendar Operation Report ${formatLongDate(data.startDate)} - ${formatLongDate(data.endDate)}`;
  ws.getCell(`A${r}`).font = { bold: true, size: 14 };
  r++;
  ws.mergeCells(`A${r}:B${r}`);
  ws.getCell(`A${r}`).value = 'Date';
  ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(`A${r}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`C${r}:F${r}`);
  ws.getCell(`C${r}`).value = 'Forecast Reservation';
  ws.getCell(`C${r}`).font = { bold: true };
  ws.getCell(`C${r}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`G${r}:I${r}`);
  ws.getCell(`G${r}`).value = 'Booking Source';
  ws.getCell(`G${r}`).font = { bold: true };
  ws.getCell(`G${r}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`J${r}:K${r}`);
  ws.getCell(`J${r}`).value = 'Inbound';
  ws.getCell(`J${r}`).font = { bold: true };
  ws.getCell(`J${r}`).alignment = { horizontal: 'center' };
  r++;
  ws.getCell(r, 1).value = 'Daily';
  ws.getCell(r, 2).value = 'Total';
  ws.getCell(r, 3).value = 'Occ';
  ws.getCell(r, 4).value = 'Total';
  ws.getCell(r, 5).value = 'Offline TA';
  ws.getCell(r, 6).value = 'Online TA';
  ws.getCell(r, 7).value = 'Direct Booking';
  ws.getCell(r, 8).value = 'Tentative';
  ws.getCell(r, 9).value = 'Confirmed';
  ws.getCell(r, 1).font = { bold: true }; ws.getCell(r, 2).font = { bold: true }; ws.getCell(r, 3).font = { bold: true }; ws.getCell(r, 4).font = { bold: true }; ws.getCell(r, 5).font = { bold: true }; ws.getCell(r, 6).font = { bold: true }; ws.getCell(r, 7).font = { bold: true }; ws.getCell(r, 8).font = { bold: true }; ws.getCell(r, 9).font = { bold: true };
  r++;

  for (const month of data.monthlyData) {
    ws.mergeCells(`A${r}:J${r}`);
    ws.getCell(`A${r}`).value = `Calender Operation, Allocation and Price from ${month.start_date} to ${month.end_date}`;
    ws.getCell(`A${r}`).font = { bold: true };
    r++;
    for (const day of month.daily_data) {
      const md = new Date(`${day.date}T00:00:00Z`);
      ws.getCell(r, 1).value = `${day.day_name}, ${String(md.getUTCMonth() + 1).padStart(2, '0')}/${String(md.getUTCDate()).padStart(2, '0')}`;
      ws.getCell(r, 2).value = day.daily_total;
      ws.getCell(r, 3).value = day.running_total;
      ws.getCell(r, 4).value = `${day.occupancy_rate}%`;
      ws.getCell(r, 5).value = day.daily_total;
      ws.getCell(r, 6).value = day.travel_agent;
      ws.getCell(r, 7).value = day.ota;
      ws.getCell(r, 8).value = day.direct_booking;
      ws.getCell(r, 9).value = day.tentative > 0 ? day.tentative : '';
      ws.getCell(r, 10).value = day.tentative > 0 ? '' : '✓';
      r++;
    }
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = 'Monthly Room Total';
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(r, 3).value = month.monthly_total.toFixed(2);
    ws.mergeCells(`D${r}:E${r}`);
    ws.getCell(`D${r}`).value = 'Monthly Total Capacity';
    ws.getCell(`D${r}`).font = { bold: true };
    ws.getCell(r, 6).value = `${month.monthly_occupancy_rate}%`;
    r++;
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = 'Monthly Room Target';
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(r, 3).value = month.monthly_target.toFixed(2);
    ws.mergeCells(`D${r}:E${r}`);
    ws.getCell(`D${r}`).value = 'Monthly Target Operation';
    ws.getCell(`D${r}`).font = { bold: true };
    ws.getCell(r, 6).value = '70%';
    r += 2;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="calendar-operation.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function getDailyCheckin(params: any): Promise<any> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59Z`);

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      res_date: { gte: start, lte: end },
      type_reservation: { not: 'vr' },
      status_reservation: { notIn: [5, 2] },
    },
    select: { id: true, folio_number: true, company_profile_id: true, guest_profile_id: true, company_name: true, check_in_date: true, check_out_date: true, created_by: true, type_reservation: true, status_reservation: true, res_date: true },
    orderBy: { company_name: 'asc' },
  });
  const folioIds = folios.map((f: any) => Number(f.id));
  const companyIds = [...new Set(folios.map((f: any) => Number(f.company_profile_id)).filter(Boolean))];
  const guestIds = [...new Set(folios.map((f: any) => Number(f.guest_profile_id)).filter(Boolean))];
  const [companies, guests, users, reservations] = await Promise.all([
    companyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : [],
    prisma.users.findMany({ select: { id: true, name: true } }),
    folioIds.length
      ? prisma.reservations.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null }, select: { folio_id: true, adult: true, child: true, is_posting: true, date: true } })
      : [],
  ]);
  const companyById = new Map(companies.map((c: any) => [Number(c.id), c.name]));
  const guestById = new Map(guests.map((g: any) => [Number(g.id), g]));
  const userById = new Map(users.map((u: any) => [Number(u.id), u.name]));

  const types = await prisma.types.findMany({ where: { property_id: pid, deleted_at: null }, select: { id: true, group: true, name: true } });
  const typeById = new Map(types.map((t: any) => [Number(t.id), t]));
  const folioMht = folioIds.length
    ? await prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\Folio', model_id: { in: folioIds } }, select: { type_id: true, model_id: true } })
    : [];

  const sourceOf = (folioId: number): string => {
    for (const m of folioMht) {
      if (Number(m.model_id) !== folioId) continue;
      const t = typeById.get(Number(m.type_id));
      if (t && t.group === 'source') return t.name;
    }
    return '';
  };

  const lastRes = (folioId: number): any => {
    // scopeLastReservation: is_posting = 0, orderBy date asc, first
    const list = reservations.filter((x: any) => Number(x.folio_id) === folioId && !x.is_posting).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return list[0] || null;
  };

  const reportData: any[] = [];
  let stt = 0;
  for (const f of folios) {
    const rsv = lastRes(Number(f.id));
    if (!rsv) continue; // Laravel: row only when lastReservation exists
    stt++;
    const gp = f.guest_profile_id ? guestById.get(Number(f.guest_profile_id)) : undefined;
    reportData.push({
      stt,
      web: '',
      name: f.company_profile_id ? (companyById.get(Number(f.company_profile_id)) ?? '') : '',
      booking_no: f.folio_number,
      guest_name: `${gp?.first_name ?? ''} ${gp?.last_name ?? ''}`,
      check_in_date: formatDateMYShort(f.check_in_date),
      pax: (Number(rsv.adult) || 0) + (Number(rsv.child) || 0),
      total_nights: diffDays(f.check_in_date, f.check_out_date),
      source: sourceOf(Number(f.id)),
      reception: f.created_by ? (userById.get(Number(f.created_by)) ?? '') : '',
    });
  }

  const now = new Date();
  const baseFilter = { property_id: pid, type_reservation: { not: 'vr' }, status_reservation: { notIn: [5, 2] } } as any;
  const monthFolios = await prisma.folios.findMany({ where: { ...baseFilter, res_date: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } }, select: { id: true, res_date: true, check_in_date: true, check_out_date: true } });
  const monthRes = monthFolios.length
    ? await prisma.reservations.findMany({ where: { folio_id: { in: monthFolios.map((f: any) => Number(f.id)) }, deleted_at: null }, select: { folio_id: true, adult: true, child: true, is_posting: true, date: true } })
    : [];
  const monthLastRes = new Map<number, any>();
  for (const rsv of monthRes) {
    if (rsv.is_posting) continue;
    const cur = monthLastRes.get(Number(rsv.folio_id));
    if (!cur || new Date(rsv.date).getTime() < new Date(cur.date).getTime()) monthLastRes.set(Number(rsv.folio_id), rsv);
  }
  const monthlyStats = { thisMonth: { count: 0, guests: 0, nights: 0 }, nextMonth: { count: 0, guests: 0, nights: 0 }, twoMonths: { count: 0, guests: 0, nights: 0 }, threeMonths: { count: 0, guests: 0, nights: 0 }, continue: { count: 0, guests: 0, nights: 0 } };
  const monthOf = (dt: Date) => dt.getUTCFullYear() * 12 + dt.getUTCMonth();
  const nowM = monthOf(now);
  const threeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, 0));
  for (const f of monthFolios) {
    if (!f.res_date) continue;
    const m = monthOf(new Date(f.res_date));
    const rsv = monthLastRes.get(Number(f.id));
    let bucket: keyof typeof monthlyStats;
    if (m === nowM) bucket = 'thisMonth';
    else if (m === nowM + 1) bucket = 'nextMonth';
    else if (m === nowM + 2) bucket = 'twoMonths';
    else if (m === nowM + 3) bucket = 'threeMonths';
    else if (new Date(f.res_date) > threeEnd) bucket = 'continue';
    else continue;
    monthlyStats[bucket].count += 1;
    // Laravel: guests/nights only when lastReservation exists (count uses folios->count())
    if (rsv) {
      monthlyStats[bucket].guests += (Number(rsv.adult) || 0) + (Number(rsv.child) || 0);
      monthlyStats[bucket].nights += diffDays(f.check_in_date, f.check_out_date);
    }
  }

  const dayFolios = folios;
  const groupFolios = dayFolios.filter((f: any) => f.type_reservation === 'git');
  const groupStats = { more_than_5: { count: 0, guests: 0, nights: 0 }, less_than_5: { count: 0, guests: 0, nights: 0 }, subtotal: { count: 0, guests: 0, nights: 0 } };
  for (const f of groupFolios) {
    const rsv = lastRes(Number(f.id));
    const guests = (Number(rsv?.adult) || 0) + (Number(rsv?.child) || 0);
    const nights = diffDays(f.check_in_date, f.check_out_date);
    const key = nights > 5 ? 'more_than_5' : 'less_than_5';
    groupStats[key].count += 1;
    groupStats[key].guests += guests;
    groupStats[key].nights += nights;
    groupStats.subtotal.count += 1;
    groupStats.subtotal.guests += guests;
    groupStats.subtotal.nights += nights;
  }

  const otaCompanyIds = new Set<number>();
  const companyTypeNames = new Map<number, string[]>();
  if (companyIds.length) {
    const companyMht = await prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\CompanyProfile', model_id: { in: companyIds } }, select: { type_id: true, model_id: true } });
    const ctypeIds = [...new Set(companyMht.map((m: any) => Number(m.type_id)))];
    const ctypes = ctypeIds.length ? await prisma.types.findMany({ where: { id: { in: ctypeIds } }, select: { id: true, name: true } }) : [];
    const ctypeById = new Map(ctypes.map((t: any) => [Number(t.id), t]));
    for (const m of companyMht) {
      const t = ctypeById.get(Number(m.type_id));
      if (!t) continue;
      const list = companyTypeNames.get(Number(m.model_id)) || [];
      list.push(t.name);
      companyTypeNames.set(Number(m.model_id), list);
      if (t.name.toUpperCase().includes('OTA')) otaCompanyIds.add(Number(m.model_id));
    }
  }

  // Laravel: OTA companies = ALL property companies with company-type type LIKE %OTA% (init 0 rows even without folios today)
  const allCompanies = await prisma.company_profiles.findMany({ where: { property_id: pid, deleted_at: null }, select: { id: true, name: true } });
  const allCompanyIds = allCompanies.map((c: any) => Number(c.id));
  const allCompanyMht = allCompanyIds.length
    ? await prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\CompanyProfile', model_id: { in: allCompanyIds } }, select: { type_id: true, model_id: true } })
    : [];
  const allTypeIds = [...new Set(allCompanyMht.map((m: any) => Number(m.type_id)))];
  const allTypes = allTypeIds.length ? await prisma.types.findMany({ where: { id: { in: allTypeIds }, group: 'company-type' }, select: { id: true, name: true } }) : [];
  const allTypeById = new Map(allTypes.map((t: any) => [Number(t.id), t.name]));
  const otaCompanies: any = {};
  for (const c of allCompanies) {
    const isOta = allCompanyMht.some((m: any) => Number(m.model_id) === Number(c.id) && (allTypeById.get(Number(m.type_id)) || '').toUpperCase().includes('OTA'));
    if (isOta && c.name) otaCompanies[c.name] = { count: 0, guests: 0, nights: 0 };
  }

  const companyStats: any = { ota: otaCompanies, walk_in: { count: 0, guests: 0, nights: 0 }, website: { count: 0, guests: 0, nights: 0 }, others: { count: 0, guests: 0, nights: 0 }, subtotal: { count: 0, guests: 0, nights: 0 } };
  const walkInIds = new Set<number>();
  const websiteIds = new Set<number>();
  for (const [cid, cname] of companyById) {
    if (!cname) continue;
    if (cname.toLowerCase().includes('walk in')) walkInIds.add(cid);
    if (cname.toLowerCase().includes('website')) websiteIds.add(cid);
  }
  for (const f of dayFolios) {
    const cid = Number(f.company_profile_id);
    const cname = companyById.get(cid);
    if (!cname) continue;
    const rsv = lastRes(Number(f.id));
    const guests = (Number(rsv?.adult) || 0) + (Number(rsv?.child) || 0);
    const nights = diffDays(f.check_in_date, f.check_out_date);
    let bucket: any = null;
    if (otaCompanyIds.has(cid)) bucket = companyStats.ota[cname];
    else if (walkInIds.has(cid)) bucket = companyStats.walk_in;
    else if (websiteIds.has(cid)) bucket = companyStats.website;
    else bucket = companyStats.others;
    if (bucket) {
      bucket.count += 1; bucket.guests += guests; bucket.nights += nights;
      companyStats.subtotal.count += 1; companyStats.subtotal.guests += guests; companyStats.subtotal.nights += nights;
    }
  }

  const property = await prisma.properties.findUnique({ where: { id: pid }, select: { name: true } });

  return {
    reportDate: formatMonthDayYear(date),
    hotelName: property?.name ?? '',
    reportData,
    monthlyStats,
    groupStats,
    companyStats,
    date,
  };
}

async function generateDailyCheckinExcel(res: any, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('DailyCheckin');
  ws.views = [{ state: 'frozen', ySplit: 3 }];

  ws.mergeCells('A1:J1');
  ws.getCell('A1').value = `List Today Reservation for ${data.reportDate}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A2:J2');
  ws.getCell('A2').value = data.hotelName;

  const headers = ['Web', 'Name', 'STT', 'Booking No.', 'Guest Name.', 'Check-in Date', 'Pax', 'Total Night.', 'Booking Source.', 'Reception'];
  headers.forEach((h, i) => {
    ws.getCell(3, 1 + i).value = h;
    ws.getCell(3, 1 + i).font = { bold: true };
    ws.getCell(3, 1 + i).alignment = { horizontal: 'center' };
  });
  let r = 4;
  for (const row of data.reportData) {
    ws.getCell(r, 1).value = row.web;
    ws.getCell(r, 2).value = row.name;
    ws.getCell(r, 3).value = row.stt;
    ws.getCell(r, 4).value = row.booking_no;
    ws.getCell(r, 5).value = `${row.guest_name} 様`;
    ws.getCell(r, 6).value = row.check_in_date;
    ws.getCell(r, 7).value = row.pax;
    ws.getCell(r, 8).value = row.total_nights;
    ws.getCell(r, 9).value = row.source;
    ws.getCell(r, 10).value = row.reception;
    r++;
  }

  r += 2;
  ws.mergeCells(`A${r}:J${r}`);
  ws.getCell(`A${r}`).value = 'Monthly Statistics';
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  ['This Month', 'Monthly', '件', '人', '泊'].forEach((h, i) => {
    ws.getCell(r, 1 + i).value = h;
    ws.getCell(r, 1 + i).font = { bold: true };
  });
  r++;
  const monthlyRows = [
    ['Next Month', 'Monthly', 0, 0, 0],
    ['2 Month Later', 'Monthly', 0, 0, 0],
    ['3 Month Later', 'Monthly', 0, 0, 0],
    ['Continue', 'Monthly', 0, 0, 0],
    ['Total Amount', 0, 0, 0],
  ];
  for (const row of monthlyRows) {
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = row[0];
    ws.getCell(r, 3).value = row[1];
    ws.getCell(r, 4).value = row[2];
    ws.getCell(r, 5).value = row[3];
    r++;
  }

  r += 2;
  ws.mergeCells(`A${r}:J${r}`);
  ws.getCell(`A${r}`).value = 'Group & Company';
  ws.getCell(`A${r}`).font = { bold: true };
  r++;
  ws.mergeCells(`A${r}:B${r}`);
  ws.getCell(`A${r}`).value = '';
  ws.mergeCells(`C${r}:E${r}`);
  ws.getCell(`C${r}`).value = 'Daily';
  ws.getCell(`C${r}`).font = { bold: true };
  ws.getCell(`C${r}`).alignment = { horizontal: 'center' };
  ws.mergeCells(`F${r}:J${r}`);
  ws.getCell(`F${r}`).value = 'Month-to-Date';
  ws.getCell(`F${r}`).font = { bold: true };
  ws.getCell(`F${r}`).alignment = { horizontal: 'center' };
  r++;

  const g = data.groupStats;
  const c = data.companyStats;
  const denom = g.subtotal.nights + c.subtotal.nights;
  const pctOf = (x: number) => (denom > 0 ? Number((x / denom * 100).toFixed(2)) : 'NAN');
  const rowDefs: any[] = [
    ['Group (Booked more than 5 nights)', g.more_than_5, 'count'],
    ['Group (Booked less than 5 nights)', g.less_than_5, 'nights'],
    ['Subtotal', g.subtotal, 'nights'],
    ['Website', c.website, 'nights'],
    ['Walk-In', c.walk_in, 'nights'],
  ];
  for (const [label, item, useCount] of rowDefs) {
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = label;
    ws.getCell(r, 3).value = `${item.count} 件`;
    ws.getCell(r, 4).value = `${item.guests} 人`;
    ws.getCell(r, 5).value = `${item.nights} 泊`;
    ws.getCell(r, 6).value = pctOf(useCount === 'count' ? item.count : item.nights);
    ws.getCell(r, 7).value = '件';
    ws.getCell(r, 8).value = '件';
    ws.getCell(r, 9).value = '泊';
    ws.getCell(r, 10).value = '';
    r++;
  }
  for (const [cname, item] of Object.entries(c.ota) as [string, any][]) {
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = cname;
    ws.getCell(r, 3).value = `${item.count} 件`;
    ws.getCell(r, 4).value = `${item.guests} 人`;
    ws.getCell(r, 5).value = `${item.nights} 泊`;
    ws.getCell(r, 6).value = pctOf(item.nights);
    ws.getCell(r, 7).value = '件';
    ws.getCell(r, 8).value = '件';
    ws.getCell(r, 9).value = '泊';
    ws.getCell(r, 10).value = '';
    r++;
  }
  ws.mergeCells(`A${r}:B${r}`);
  ws.getCell(`A${r}`).value = 'Others';
  ws.getCell(r, 3).value = `${c.others.count} 件`;
  ws.getCell(r, 4).value = `${c.others.guests} 人`;
  ws.getCell(r, 5).value = `${c.others.nights} 泊`;
  ws.getCell(r, 6).value = pctOf(c.others.nights);
  ws.getCell(r, 7).value = '件';
  ws.getCell(r, 8).value = '人';
  ws.getCell(r, 9).value = '泊';
  ws.getCell(r, 10).value = '';
  r++;
  ws.mergeCells(`A${r}:B${r}`);
  ws.getCell(`A${r}`).value = 'Subtotal';
  ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(r, 3).value = `${c.subtotal.count} 件`;
  ws.getCell(r, 4).value = `${c.subtotal.guests} 人`;
  ws.getCell(r, 5).value = `${c.subtotal.nights} 泊`;
  ws.getCell(r, 6).value = pctOf(c.subtotal.nights);
  ws.getCell(r, 7).value = '件';
  ws.getCell(r, 8).value = '人';
  ws.getCell(r, 9).value = '泊';
  ws.getCell(r, 10).value = '';
  r++;
  ws.mergeCells(`A${r}:B${r}`);
  ws.getCell(`A${r}`).value = 'Grand total';
  ws.getCell(`A${r}`).font = { bold: true };
  ws.getCell(r, 3).value = `${g.subtotal.count + c.subtotal.count} 件`;
  ws.getCell(r, 4).value = `${g.subtotal.guests + c.subtotal.guests} 人`;
  ws.getCell(r, 5).value = `${g.subtotal.nights + c.subtotal.nights} 泊`;
  ws.getCell(r, 6).value = Number(100.0.toFixed(2));
  ws.getCell(r, 7).value = '件';
  ws.getCell(r, 8).value = '人';
  ws.getCell(r, 9).value = '泊';
  ws.getCell(r, 10).value = '';

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-checkin-list.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function getCompanyProfile(params: any): Promise<any> {
  const pid = params.propertyId;
  const search = (params.search || '').toString().trim();
  const sortParam = (params.sort || '').toString().trim();
  const sortCols = ['account', 'type_company', 'short_code', 'name', 'status_company', 'billing_country', 'telp', 'mobile_phone', 'email', 'billing_city', 'term', 'credit_limit', 'status'];
  let orderBy: any = { account: 'asc' };
  if (sortParam) {
    const desc = sortParam.startsWith('-');
    const col = desc ? sortParam.slice(1) : sortParam;
    if (sortCols.includes(col)) orderBy = { [col]: desc ? 'desc' : 'asc' };
  }
  const where: any = { property_id: pid, deleted_at: null, status: 1 };
  if (search) {
    where.OR = ['account', 'type_company', 'short_code', 'name', 'status_company', 'billing_country', 'telp', 'mobile_phone'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' as any } }));
  }
  const list = await prisma.company_profiles.findMany({ where, select: { account: true, name: true, type_company: true, short_code: true, telp: true, mobile_phone: true, email: true, billing_city: true, billing_country: true, term: true, credit_limit: true, status: true, status_company: true }, orderBy });
  const reportData = list.map((row: any) => ({
    account: row.account ?? '-',
    name: row.name ?? '-',
    type_company: row.type_company ?? '-',
    short_code: row.short_code ?? '-',
    telp: row.telp !== undefined && row.telp !== null ? row.telp : (row.mobile_phone ?? '-'),
    email: row.email ?? '-',
    billing_city: row.billing_city ?? '-',
    billing_country: row.billing_country ?? '-',
    term: row.term ?? '-',
    credit_limit: Number(row.credit_limit || 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
    status: row.status === 1 ? 'Active' : 'Inactive',
    status_company: row.status_company ?? '-',
  }));
  const printedAt = (() => {
    const n = new Date();
    return `${String(n.getDate()).padStart(2, '0')}/${String(n.getMonth() + 1).padStart(2, '0')}/${n.getFullYear()} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  })();
  return { reportData, total: reportData.length, printedAt };
}

async function generateCompanyProfileExcel(res: any, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('CompanyProfile');
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  ws.mergeCells('A1:L1');
  ws.getCell('A1').value = 'Company Profile Report';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A2:L2');
  ws.getCell('A2').value = `Total: ${data.total} companies`;
  ws.getCell('A2').font = { bold: true };

  const headers = ['No', 'Account', 'Name', 'Type', 'Short Code', 'Phone', 'Email', 'City', 'Country', 'Term', 'Credit Limit', 'Status'];
  headers.forEach((h, i) => {
    ws.getCell(3, 1 + i).value = h;
    ws.getCell(3, 1 + i).font = { bold: true };
    ws.getCell(3, 1 + i).alignment = { horizontal: 'center' };
  });
  data.reportData.forEach((row: any, i: number) => {
    const r = 4 + i;
    ws.getCell(r, 1).value = i + 1;
    ws.getCell(r, 2).value = row.account;
    ws.getCell(r, 3).value = row.name;
    ws.getCell(r, 4).value = row.type_company;
    ws.getCell(r, 5).value = row.short_code;
    ws.getCell(r, 6).value = row.telp;
    ws.getCell(r, 7).value = row.email;
    ws.getCell(r, 8).value = row.billing_city;
    ws.getCell(r, 9).value = row.billing_country;
    ws.getCell(r, 10).value = row.term;
    ws.getCell(r, 11).value = row.credit_limit;
    ws.getCell(r, 12).value = row.status;
  });
  const footer = data.reportData.length + 5;
  ws.mergeCells(`A${footer}:L${footer}`);
  ws.getCell(`A${footer}`).value = `Printed On: ${data.printedAt}`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="company-profile.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function getGuestListingReport(params: any): Promise<any> {
  const pid = params.propertyId;
  const columnsParam = (params.columns || '').toString();
  const selectedColumns = columnsParam.split(',').map((s: string) => s.trim()).filter(Boolean);
  const allowedColumns: Record<string, string> = {
    account: 'gp.account AS account',
    name_combine: `CONCAT(CASE WHEN gp.gender = 'Male' THEN 'MR ' WHEN gp.gender = 'Female' THEN 'MRS ' ELSE '' END, COALESCE(gp.first_name, ''), ' ', COALESCE(gp.last_name, '')) AS name_combine`,
    nationality: 'na.name AS nationality',
    country: 'co.name AS country',
    city: 'c.name AS city',
    gender: 'gp.gender',
    birth_of_date: 'gp.birth_of_date',
    age: `CASE WHEN gp.birth_of_date IS NULL OR gp.birth_of_date = '0000-00-00' THEN NULL ELSE TIMESTAMPDIFF(YEAR, gp.birth_of_date, CURDATE()) END AS age`,
    stay: 'COALESCE(fn.totalStay, 0) AS stay',
    last_checkout_date: 'fn.last_checkout_date AS last_checkout_date',
    address: 'gp.address',
    telp: `COALESCE(NULLIF(gp.telp, ''), gp.mobile_phone) AS telp`,
    email: 'gp.email',
  };
  let selectFields = selectedColumns.map((c: string) => allowedColumns[c]).filter(Boolean);
  if (!selectFields.length) selectFields = ['gp.account AS account', allowedColumns.name_combine];
  const select = selectFields.join(',\n  ');

  const checkOutStatus = 1; // config status_reservation.check_out.id
  const gitTypeCode = 'git'; // config type_reservation.git.code

  const where: string[] = ['gp.property_id = ?'];
  const bindings: any[] = [pid];

  // GENDER (Laravel: filled && !== 'all')
  if (params.gender && params.gender !== 'all') { where.push('gp.gender = ?'); bindings.push(params.gender); }
  // MIN/MAX AGE (is_numeric guard)
  if (params.min_age !== undefined && params.min_age !== '' && isNumeric(params.min_age)) { where.push('TIMESTAMPDIFF(YEAR, gp.birth_of_date, CURDATE()) >= ?'); bindings.push(Number(params.min_age)); }
  if (params.max_age !== undefined && params.max_age !== '' && isNumeric(params.max_age)) { where.push('TIMESTAMPDIFF(YEAR, gp.birth_of_date, CURDATE()) <= ?'); bindings.push(Number(params.max_age)); }
  const dobType = params.dob_filter_type;
  if (dobType === 'month' && params.dob_month) { where.push('MONTH(gp.birth_of_date) = ?'); bindings.push(Number(params.dob_month)); }
  else if (dobType === 'year' && params.dob_year) { where.push('YEAR(gp.birth_of_date) = ?'); bindings.push(Number(params.dob_year)); }
  else if (dobType === 'month_year') {
    // Laravel: each sub-filter applied independently when filled
    if (params.dob_month) { where.push('MONTH(gp.birth_of_date) = ?'); bindings.push(Number(params.dob_month)); }
    if (params.dob_year) { where.push('YEAR(gp.birth_of_date) = ?'); bindings.push(Number(params.dob_year)); }
  }
  if (dobType === 'month_range' && params.dob_from_month && params.dob_to_month) {
    const from = Number(params.dob_from_month);
    const to = Number(params.dob_to_month);
    if (from <= to) { where.push('MONTH(gp.birth_of_date) BETWEEN ? AND ?'); bindings.push(from, to); }
    else { where.push('(MONTH(gp.birth_of_date) >= ? OR MONTH(gp.birth_of_date) <= ?)'); bindings.push(from, to); }
  }
  if (params.nationality_id) { where.push('gp.nationality_id = ?'); bindings.push(Number(params.nationality_id)); }
  if (params.country_id) { where.push('gp.country_id = ?'); bindings.push(Number(params.country_id)); }
  if (params.city_id) { where.push('gp.city_id = ?'); bindings.push(Number(params.city_id)); }
  // LAST CHECKOUT (Laravel: plain folio EXISTS on check_out_date)
  if (params.last_checkout_date) {
    where.push('EXISTS (SELECT 1 FROM folios f WHERE f.guest_profile_id = gp.id AND DATE(f.check_out_date) = ?)');
    bindings.push(params.last_checkout_date);
  }
  // STAY FILTER (Laravel: grouped HAVING COUNT(*) op ?)
  if (params.stay_value !== undefined && params.stay_value !== '' && isNumeric(params.stay_value)) {
    const op = ['>', '<', '>=', '<=', '=', '!='].includes(params.stay_operator) ? params.stay_operator : '>=';
    where.push(`EXISTS (SELECT 1 FROM folios f2 WHERE f2.guest_profile_id = gp.id AND f2.status_reservation = ? AND (f2.folio_number LIKE 'F%' OR (f2.type_reservation = ? AND f2.parent != 0)) GROUP BY f2.guest_profile_id HAVING COUNT(*) ${op} ?)`);
    bindings.push(checkOutStatus, gitTypeCode, Number(params.stay_value));
  }

  const whereSql = ' AND ' + where.join(' AND ');
  const cteBindings = [checkOutStatus, gitTypeCode, pid];

  const sql = `WITH folio_night AS (
  SELECT f.guest_profile_id,
    SUM(CASE WHEN r.check_in_date IS NOT NULL AND r.check_out_date IS NOT NULL THEN DATEDIFF(r.check_out_date, r.check_in_date) ELSE 0 END) AS totalNight,
    COUNT(DISTINCT CASE WHEN f.status_reservation = ? AND (f.folio_number LIKE 'F%' OR (f.type_reservation = ? AND f.parent != 0)) THEN f.id ELSE NULL END) AS totalStay,
    MAX(COALESCE(r.check_out_date, f.check_out_date)) AS last_checkout_date
  FROM folios f
  LEFT JOIN reservations r ON r.folio_id = f.id
  WHERE f.property_id = ?
  GROUP BY f.guest_profile_id
)
SELECT
  ${select}
FROM guest_profiles gp
LEFT JOIN folio_night fn ON fn.guest_profile_id = gp.id
LEFT JOIN countries na ON gp.nationality_id = na.id
LEFT JOIN countries co ON gp.country_id = co.id
LEFT JOIN cities c ON gp.city_id = c.id
WHERE 1=1 ${whereSql}
ORDER BY COALESCE(fn.totalStay, 0) DESC, gp.account`;

  // Prisma 7 driver adapter (PrismaPg) strips `?` placeholders in $queryRawUnsafe.
  // Convert to sequential $1..$n before calling.
  let n = 0;
  const numberedSql = sql.replace(/\?/g, () => `$${++n}`);
  const rows = await prisma.$queryRawUnsafe(numberedSql, ...cteBindings, ...bindings);
  const safeRows = Array.isArray(rows) ? rows.map((x: any) => bigintToNumber(x)) : [];

  return {
    reportTitle: 'Guest Listing Report',
    reportData: safeRows,
    selectedColumns: selectedColumns.length ? selectedColumns : ['account', 'name_combine'],
    date: params.date || formatDate(new Date()),
  };
}

async function generateGuestListingExcel(res: any, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('GuestListing');
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = data.reportTitle;
  ws.getCell('A1').font = { bold: true, size: 14 };

  const labelMap: Record<string, string> = {
    account: 'Account', status_profile: 'Status Profile', name_combine: 'Guest Name', gender: 'Gender', age: 'Age',
    birth_of_date: 'DOB', stay: 'Stay', last_checkout_date: 'Last C/O', telp: 'Telephone', email: 'Email',
    address: 'Address', city: 'City', nationality: 'Nationality', country: 'Country',
  };
  const cols = data.selectedColumns;
  const headerCols = ['account', 'status_profile', 'name_combine', 'gender', 'age', 'birth_of_date', 'stay', 'last_checkout_date', 'telp', 'email', 'address', 'city', 'nationality', 'country'].filter((c) => cols.includes(c));
  headerCols.forEach((c, i) => {
    ws.getCell(2, 2 + i).value = labelMap[c] || c;
    ws.getCell(2, 2 + i).font = { bold: true };
    ws.getCell(2, 2 + i).alignment = { horizontal: 'center' };
  });
  ws.getCell(2, 1).value = 'No';
  ws.getCell(2, 1).font = { bold: true };

  const up = (v: any) => (v === undefined || v === null ? '-' : String(v).trim().toUpperCase() || '-');
  const fmt = (v: any) => (v === undefined || v === null || v === '' ? '-' : formatDMYDash(v));
  if (data.reportData.length === 0) {
    ws.mergeCells(3, 1, 3, headerCols.length + 1);
    ws.getCell(3, 1).value = 'Tidak ada data tamu yang sesuai filter';
    ws.getCell(3, 1).alignment = { horizontal: 'center' };
  }
  data.reportData.forEach((row: any, i: number) => {
    const r = 3 + i;
    ws.getCell(r, 1).value = i + 1;
    headerCols.forEach((c, j) => {
      let v: any = '-';
      if (c === 'account') v = row.account ?? '-';
      else if (c === 'status_profile') v = row.status_profile ?? '-';
      else if (c === 'name_combine') v = String(row.name_combine ?? '').trim().toUpperCase();
      else if (c === 'gender') v = row.gender ?? '-';
      else if (c === 'age') v = row.age ?? '-';
      else if (c === 'birth_of_date') v = fmt(row.birth_of_date);
      else if (c === 'stay') v = row.stay ?? '0';
      else if (c === 'last_checkout_date') v = fmt(row.last_checkout_date);
      else if (c === 'telp') v = row.telp ?? '-';
      else if (c === 'email') v = up(row.email);
      else if (c === 'address') v = up(row.address);
      else if (c === 'city') v = up(row.city);
      else if (c === 'nationality') v = up(row.nationality);
      else if (c === 'country') v = up(row.country);
      ws.getCell(r, 2 + j).value = v;
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="guest-listing-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Cash / Payment Detailed Report ──
// Laravel parity: CashDetailedController (index = cash-only, payment = all payment types)
// + cash-detailed.blade.php ("Payment Detailed Report", 9 columns, grouped by payment type).

async function getCashDetailed(params: any, cashOnly = true): Promise<any> {
  const pid = params.propertyId;
  const date = params.date || params.startDate || formatDate(new Date());
  const startDate = date;
  const endDate = date;

  const typeIds = cashOnly
    ? (await prisma.type_payments.findMany({
        where: { property_id: pid, deleted_at: null, name: { contains: 'cash', mode: 'insensitive' } },
        select: { id: true },
      })).map((t: any) => t.id)
    : undefined;

  // Laravel CashDetailedController reads `transactions` (Transaction model); every transaction
  // is mirrored into `transaction_breakdowns` (Transaction::created hook), which is the populated
  // table in this DB. Use tb as source for parity.
  const transactions = await prisma.transaction_breakdowns.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      date: { gte: new Date(`${date}T00:00:00Z`), lte: new Date(`${date}T23:59:59Z`) },
      ...(typeIds ? { type_payment_id: { in: typeIds } } : { type: { in: ['payment', 'paidout', 'refund'] } }),
    },
    orderBy: { id: 'asc' },
    include: {
      folios: {
        select: {
          folio_number: true, guest_profile_id: true, company_name: true,
        },
      },
      type_payments: { select: { name: true } },
    },
  });

  const folioIds = [...new Set(transactions.map((t: any) => Number(t.folio_id)).filter(Boolean))];
  const guestIds = [...new Set(transactions.map((t: any) => Number((t.folios as any)?.guest_profile_id)).filter(Boolean))];
  const [folioReservations, guestProfiles] = await Promise.all([
    folioIds.length
      ? prisma.reservations.findMany({
          where: { folio_id: { in: folioIds }, deleted_at: null, is_posting: 0 },
          select: { folio_id: true, date: true, room_type_name: true, room_name: true },
        })
      : [],
    guestIds.length
      ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } })
      : [],
  ]);
  // Laravel lastReservation() = OLDEST non-posting reservation (orderBy date asc, first)
  const lastResByFolio = new Map<number, any>();
  for (const r of folioReservations) {
    const cur = lastResByFolio.get(Number(r.folio_id));
    if (!cur || new Date(r.date).getTime() < new Date(cur.date).getTime()) lastResByFolio.set(Number(r.folio_id), r);
  }
  const guestById = new Map(guestProfiles.map((g: any) => [Number(g.id), g]));

  const creatorIds: any[] = [...new Set(transactions.map((t: any) => t.created_by).filter(Boolean))];
  const users = creatorIds.length
    ? await prisma.users.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
    : [];
  const userMap = new Map(users.map((u: any) => [u.id, u.name]));

  const groups: Record<string, any> = {};
  for (const t of transactions) {
    const pname = String(t.type_payments?.name || 'Unknown').toUpperCase();
    if (!groups[pname]) groups[pname] = { type: pname, transaksi: [], totalAmount: 0, totalSurcharge: 0, total: 0 };
    const g = groups[pname];
    const folio = (t.folios as any) || {};
    const sign = cashOnly ? 1 : (t.type_amount === 'MINUS' ? 1 : -1);
    const gp = folio.guest_profile_id ? guestById.get(Number(folio.guest_profile_id)) : undefined;
    const guest = gp ? `${gp.first_name || ''} ${gp.last_name || ''}` : '';
    const lastRes = lastResByFolio.get(Number(t.folio_id));
    const parts = [guest, folio.company_name || '', lastRes?.room_type_name || '', lastRes?.room_name || '', t.description || ''].filter(Boolean);
    const charge = Number(t.amount || 0) * sign;
    const surcharge = Number(t.surcharge || 0) * sign;
    const total = Number(t.total || 0) * sign;
    g.transaksi.push({
      date: t.date ? formatDateDMY(t.date) : '',
      folio_number: folio.folio_number || '-',
      description: parts.join(' - '),
      staff: userMap.get(t.created_by as any) || 'Unknown',
      card_name: t.card_name || '-',
      last_digit_card: t.last_digit_card ?? '-',
      charge,
      surcharge,
      total,
    });
    // Laravel index: group total = sum of raw AMOUNTS; payment: sum of signed totals
    g.totalAmount += charge;
    g.totalSurcharge += surcharge;
    g.total += cashOnly ? Number(t.amount || 0) : total;
  }
  const transactionsArr = Object.values(groups);
  const grandTotal = transactionsArr.reduce((s: number, g: any) => s + g.total, 0);

  return {
    reportTitle: 'Payment Detailed Report',
    businessDate: date,
    startDate,
    endDate,
    transactions: transactionsArr,
    grandTotal,
  };
}

async function generateCashDetailedExcel(res: Response, data: any, filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Payment Detailed');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio No', 'Description', 'Staff', 'Posting Date', 'Card Name', 'Last 4 digits', 'Amount', 'Surcharge', 'Total'];
  const nf = (v: any) => Number(v || 0).toFixed(2);

  ws.mergeCells(1, 1, 1, 9);
  const title = ws.getCell(1, 1);
  title.value = String(data.reportTitle || 'Payment Detailed Report').toUpperCase();
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 9);
  const meta = ws.getCell(2, 1);
  meta.value = `Business Date: ${data.businessDate || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };
  for (let i = 1; i <= 9; i++) ws.getColumn(i).width = i === 2 ? 60 : 16;

  let rn = 3;
  for (const g of data.transactions || []) {
    ws.getRow(rn).values = [g.type];
    ws.mergeCells(rn, 1, rn, 9);
    ws.getRow(rn).font = { bold: true, size: 11 };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = HEADERS;
    ws.getRow(rn).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    for (const t of g.transaksi || []) {
      ws.getRow(rn).values = [t.folio_number, t.description, t.staff, t.date, t.card_name, String(t.last_digit_card), nf(t.charge), nf(t.surcharge), nf(t.total)];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = [`Total for ${g.type}`, '', '', '', '', '', nf(g.totalAmount), nf(g.totalSurcharge), nf(g.total)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['Grand Total', '', '', '', '', '', '', '', nf(data.grandTotal || 0)];
  ws.getRow(rn).font = { bold: true, size: 11 };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 3) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn >= 7 ? 'right' : 'left', wrapText: true };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Cash Summary ──
// Laravel parity: CashSummaryController + cash-summary.blade.php ("Payment Type Summary Report")

async function getCashSummary(params: any): Promise<any> {
  const pid = params.propertyId;
  const date = params.date || params.startDate || formatDate(new Date());

  const rows = await prisma.transactions.groupBy({
    where: {
      property_id: pid,
      deleted_at: null,
      date: { gte: new Date(`${date}T00:00:00Z`), lte: new Date(`${date}T23:59:59Z`) },
    },
    by: ['type_payment_id'],
    _sum: { total: true },
  });
  const ids: bigint[] = rows.map((r: any) => r.type_payment_id).filter(Boolean);
  const tps = ids.length
    ? await prisma.type_payments.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(tps.map((t: any) => [t.id, t.name]));

  const cashSummaryData = rows.map((r: any) => {
    const name = nameById.get(r.type_payment_id) || 'Unknown Payment Type';
    return {
      group: String(name).toUpperCase(),
      transactions: [{ description: name, charge: Number(r._sum?.total ?? 0) }],
      totalGroup: Number(r._sum?.total ?? 0),
    };
  });
  const grandTotal = cashSummaryData.reduce((s: number, g: any) => s + g.totalGroup, 0);

  return {
    reportTitle: 'Payment Type Summary Report',
    startDate: date,
    endDate: date,
    business_date: date,
    cashSummaryData,
    grandTotal,
  };
}

async function generateCashSummaryExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Cash Summary');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const nf = (v: any) => Number(v || 0).toFixed(2);

  ws.mergeCells(1, 1, 1, 3);
  const title = ws.getCell(1, 1);
  title.value = String(data.reportTitle || 'Payment Type Summary Report').toUpperCase();
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 3);
  const meta = ws.getCell(2, 1);
  meta.value = `For Business Date: ${data.business_date || ''}`;
  meta.font = { size: 10 };
  meta.alignment = { horizontal: 'center' };
  for (let i = 1; i <= 3; i++) ws.getColumn(i).width = i === 1 ? 45 : 18;

  ws.getRow(3).values = ['Description', 'Charge', 'Total'];
  ws.getRow(3).font = { bold: true };
  ws.getRow(3).eachCell((c: any) => { c.border = border; });

  let rn = 4;
  for (const g of data.cashSummaryData || []) {
    ws.getRow(rn).values = [g.group];
    ws.mergeCells(rn, 1, rn, 3);
    ws.getRow(rn).font = { bold: true, size: 11 };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    for (const t of g.transactions || []) {
      ws.getRow(rn).values = [t.description, nf(t.charge), ''];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', `Total Charge For ${g.group}:`, nf(g.totalGroup)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cash-summary.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Transaction Report By Staff ──
// Laravel parity: TransactionReportByStaffController + transaction-report-by-staff.blade.php

async function generateTransactionReportByStaffExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Transaction Report By Staff');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio', 'Room', 'Guest', 'Card Name', 'Last Digit Card', 'Post Date/Time', 'Description', 'Total'];
  const nf = (v: any) => Number(v || 0).toFixed(2);
  const reportData = data.reportData || [];

  ws.mergeCells(1, 1, 1, 8);
  const title = ws.getCell(1, 1);
  title.value = 'TRANSACTION REPORT BY STAFF';
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, 8);
  const meta = ws.getCell(2, 1);
  meta.value = `NAME STAFF: ${data.staffName || ''}`;
  meta.font = { bold: true, size: 11 };
  meta.alignment = { horizontal: 'center' };
  for (let i = 1; i <= 8; i++) ws.getColumn(i).width = i === 7 ? 40 : 16;

  let rn = 3;
  for (const billing of reportData) {
    ws.getRow(rn).values = [String(billing.name || '').toUpperCase()];
    ws.mergeCells(rn, 1, rn, 8);
    ws.getRow(rn).font = { bold: true, size: 12 };
    ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    for (const post of billing.transactions || []) {
      ws.getRow(rn).values = [String(post.name || '').toUpperCase()];
      ws.mergeCells(rn, 1, rn, 8);
      ws.getRow(rn).font = { bold: true };
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
      if (post.shift) {
        ws.getRow(rn).values = [`No Shift: ${post.shift}`, '', '', '', '', '', '', ''];
        ws.mergeCells(rn, 1, rn, 8);
        ws.getRow(rn).font = { bold: true };
        rn++;
      }
      ws.getRow(rn).values = HEADERS;
      ws.getRow(rn).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF323A50' } };
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
      for (const t of post.items || []) {
        ws.getRow(rn).values = [t.folio, t.room, t.guest, t.card_name, t.last_digit_card, t.post_date, t.description, nf(t.total)];
        ws.getRow(rn).eachCell((c: any) => { c.border = border; });
        rn++;
      }
      ws.getRow(rn).values = ['', '', '', '', '', '', `${String(post.name || '').toUpperCase()}:`, nf(post.total)];
      ws.getRow(rn).font = { bold: true };
      ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', '', '', '', '', '', `Total ${String(billing.name || '').toUpperCase()}:`, nf(billing.total)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }

  ws.eachRow({ includeEmpty: false }, (r: any, rn2: number) => {
    if (rn2 < 3) return;
    r.eachCell({ includeEmpty: false }, (c: any, cn: number) => {
      c.alignment = { horizontal: cn === 8 ? 'right' : 'left', wrapText: true };
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="transaction-report-by-staff.xlsx"`);
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

// â”€â”€ Report data generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const pid = Number(params.propertyId);
  const businessDate = await getBusinessDate(BigInt(pid));
  const rawDate = params.date || businessDate;
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : businessDate;
  const dayStart = new Date(`${dateStr}T00:00:00Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      status_reservation: STATUS_RESERVATION_CHECK_IN,
      is_virtual: false,
      check_in_date: { lte: dayEnd },
      check_out_date: { gte: dayStart },
      reservations: { some: { deleted_at: null, room_id: { not: null } } },
    },
    select: { id: true, folio_number: true, parent: true, type_reservation: true, check_in_date: true, check_out_date: true, guest_profile_id: true, company_profile_id: true },
  });

  const fmtDMY4 = (d: any) => (d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : '');
  if (!folios.length) {
    return [{ reportTitle: 'In House Folio Balances', reportDate: fmtDMY4(new Date(`${dateStr}T00:00:00Z`)), reportData: [], grandTotal: 0, startDate: dateStr, endDate: dateStr }];
  }
  const folioIds = folios.map((f: any) => Number(f.id));
  const guestIds = [...new Set(folios.map((f: any) => (f.guest_profile_id === null || f.guest_profile_id === undefined ? null : Number(f.guest_profile_id))).filter((v: any): v is number => v !== null))];

  const gitParentIds = [...new Set(folios.filter((f: any) => (f.type_reservation ?? '').toLowerCase() === 'git' && Number(f.parent) !== 0).map((f: any) => Number(f.parent)))];
  const parentFolios = gitParentIds.length ? await prisma.folios.findMany({ where: { id: { in: gitParentIds } }, select: { id: true, company_profile_id: true } }) : [];
  const parentById = new Map(parentFolios.map((p: any) => [Number(p.id), p]));

  const companyIds = [...new Set([
    ...folios.map((f: any) => (f.company_profile_id === null || f.company_profile_id === undefined ? null : Number(f.company_profile_id))),
    ...[...parentById.values()].map((p: any) => (p.company_profile_id === null || p.company_profile_id === undefined ? null : Number(p.company_profile_id))),
  ].filter((v: any): v is number => v !== null))];
  const companies = companyIds.length ? await prisma.company_profiles.findMany({ where: { id: { in: companyIds }, deleted_at: null, property_id: pid }, select: { id: true, name: true, credit_limit: true } }) : [];
  const companyById = new Map(companies.map((c: any) => [Number(c.id), c]));

  const parentGitIds = [...folios.filter((f: any) => (f.type_reservation ?? '').toLowerCase() === 'git' && Number(f.parent) === 0).map((f: any) => Number(f.id))];
  const childFolios = parentGitIds.length ? await prisma.folios.findMany({ where: { parent: { in: parentGitIds }, property_id: pid, deleted_at: null, status_reservation: { not: STATUS_RESERVATION_CANCEL } }, select: { id: true, parent: true } }) : [];
  const childFolioIds = childFolios.map((c: any) => Number(c.id));
  const txs = await prisma.transactions.findMany({ where: { folio_id: { in: [...folioIds, ...childFolioIds] }, deleted_at: null }, select: { folio_id: true, model_type: true, type_amount: true, total: true } });

  const resvs = await prisma.reservations.findMany({ where: { folio_id: { in: folioIds }, is_posting: 0, deleted_at: null }, select: { id: true, folio_id: true, room_id: true, room_type_id: true, rate_id: true, date: true } });
  const lastResMap = new Map<number, any>();
  for (const fId of folioIds) {
    const list = resvs.filter((r: any) => Number(r.folio_id) === fId).sort((a: any, b: any) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (list.length) lastResMap.set(fId, list[0]);
  }
  const roomIds = [...new Set([...lastResMap.values()].map((r: any) => (r.room_id === null || r.room_id === undefined ? null : Number(r.room_id))).filter((v: any): v is number => v !== null))];
  const roomTypeIds = [...new Set([...lastResMap.values()].map((r: any) => (r.room_type_id === null || r.room_type_id === undefined ? null : Number(r.room_type_id))).filter((v: any): v is number => v !== null))];
  const rateIds = [...new Set([...lastResMap.values()].map((r: any) => (r.rate_id === null || r.rate_id === undefined ? null : Number(r.rate_id))).filter((v: any): v is number => v !== null))];
  const [rooms, roomTypes, rates, guests] = await Promise.all([
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds }, deleted_at: null, property_id: pid }, select: { id: true, name: true } }) : [],
    roomTypeIds.length ? prisma.room_types.findMany({ where: { id: { in: roomTypeIds }, deleted_at: null }, select: { id: true, name: true } }) : [],
    rateIds.length ? prisma.rates.findMany({ where: { id: { in: rateIds }, deleted_at: null, property_id: pid }, select: { id: true, name: true } }) : [],
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds }, deleted_at: null, property_id: pid }, select: { id: true, first_name: true, last_name: true } }) : [],
  ]);
  const roomById = new Map(rooms.map((r: any) => [Number(r.id), r]));
  const roomTypeById = new Map(roomTypes.map((r: any) => [Number(r.id), r]));
  const rateById = new Map(rates.map((r: any) => [Number(r.id), r]));
  const guestById = new Map(guests.map((g: any) => [Number(g.id), g]));

  const txByFolio = new Map<number, any[]>();
  for (const t of txs) {
    const k = Number(t.folio_id);
    if (!txByFolio.has(k)) txByFolio.set(k, []);
    txByFolio.get(k)!.push(t);
  }
  const sumTx = (rows: any[] | undefined, modelType?: string) => {
    let list = rows || [];
    if (modelType) list = list.filter((t: any) => t.model_type === modelType);
    return list.reduce((s: number, t: any) => s + (t.type_amount === 'PLUS' ? Number(t.total) : -Number(t.total)), 0);
  };
  const balanceOf = (f: any): number => {
    const own = txByFolio.get(Number(f.id));
    const type = (f.type_reservation ?? '').toLowerCase();
    if (type === 'git' && Number(f.parent) === 0) {
      let b = 0;
      for (const k of childFolios.filter((c: any) => Number(c.parent) === Number(f.id))) b += sumTx(txByFolio.get(Number(k.id)), 'App\\Models\\CompanyProfile');
      return b + sumTx(own);
    }
    if (type === 'git' && Number(f.parent) !== 0) return sumTx(own, 'App\\Models\\GuestProfile');
    return sumTx(own);
  };

  const grouped = new Map<string, any[]>();
  for (const f of folios) {
    let key: any;
    if ((f.type_reservation ?? '').toLowerCase() === 'git' && Number(f.parent) !== 0) {
      const p = parentById.get(Number(f.parent));
      key = p ? p.company_profile_id : f.company_profile_id;
    } else {
      key = f.company_profile_id;
    }
    const k = key === null || key === undefined ? 'null' : String(Number(key));
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(f);
  }

  const reportData: any[] = [];
  let grandTotal = 0;
  for (const groupFolios of grouped.values()) {
    const firstFolio = groupFolios[0];
    let companyName = '';
    if ((firstFolio.type_reservation ?? '').toLowerCase() === 'git' && Number(firstFolio.parent) !== 0) {
      const p = parentById.get(Number(firstFolio.parent));
      companyName = p ? (companyById.get(Number(p.company_profile_id))?.name ?? '') : '';
    } else {
      companyName = companyById.get(Number(firstFolio.company_profile_id))?.name ?? 'Unknown';
    }

    let companyTotal = 0;
    const folioData: any[] = [];
    let lastFolio: any = null;
    for (const folio of groupFolios) {
      const lr = lastResMap.get(Number(folio.id));
      const lrRoom = lr ? (lr.room_id === null || lr.room_id === undefined ? undefined : roomById.get(Number(lr.room_id))) : undefined;
      if (!lr || !lrRoom) continue;
      lastFolio = folio;
      const balance = balanceOf(folio);
      companyTotal += balance;
      grandTotal += balance;
      const guest = guestById.get(Number(folio.guest_profile_id));
      folioData.push({
        folio: folio.folio_number,
        room_type: lr.room_type_id !== null && lr.room_type_id !== undefined ? (roomTypeById.get(Number(lr.room_type_id))?.name ?? '') : '',
        room: lrRoom.name ?? '',
        guest: `${guest?.first_name ?? ''} ${guest?.last_name ?? ''}`,
        group_name: companyName,
        arrival: fmtDMY4(folio.check_in_date ? new Date(folio.check_in_date) : null),
        departure: fmtDMY4(folio.check_out_date ? new Date(folio.check_out_date) : null),
        rate_code: lr.rate_id !== null && lr.rate_id !== undefined ? (rateById.get(Number(lr.rate_id))?.name ?? '') : '',
        balance,
      });
    }
    if (folioData.length) {
      reportData.push({
        company_name: companyName,
        folios: folioData,
        total_balance: companyTotal,
        credit_limit: lastFolio ? (companyById.get(Number(lastFolio.company_profile_id))?.credit_limit ?? 0) : 0,
      });
    }
  }

  return [{
    reportTitle: 'In House Folio Balances',
    reportDate: fmtDMY4(new Date(`${dateStr}T00:00:00Z`)),
    reportData,
    grandTotal,
    startDate: dateStr,
    endDate: dateStr,
  }];
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
  const pid = Number(params.propertyId);
  const businessDate = await getBusinessDate(BigInt(pid));
  const rawDate = params.date || businessDate;
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : businessDate;
  const dLte = new Date(`${dateStr}T23:59:59.999Z`);

  const folios = await prisma.folios.findMany({
    where: { property_id: pid, deleted_at: null, status_reservation: STATUS_RESERVATION_RESERVATION },
    select: { id: true, folio_number: true, check_in_date: true, check_out_date: true, guest_profile_id: true, company_profile_id: true },
  });
  if (!folios.length) {
    return [{ reservations: [], totalDepositBalance: 0, business_date: dateStr, reportTitle: 'Reservations With Deposit Balances' }];
  }
  const folioIds = folios.map((f: any) => Number(f.id));
  const guestIds = folios.map((f: any) => (f.guest_profile_id === null || f.guest_profile_id === undefined ? null : Number(f.guest_profile_id))).filter((v: any): v is number => v !== null);
  const companyIds = folios.map((f: any) => (f.company_profile_id === null || f.company_profile_id === undefined ? null : Number(f.company_profile_id))).filter((v: any): v is number => v !== null);

  const [resvs, tbs, guests, companies] = await Promise.all([
    prisma.reservations.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null }, select: { id: true, folio_id: true, room_id: true, room_type_id: true, rate_id: true, is_posting: true, date: true } }),
    prisma.transaction_breakdowns.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null, created_at: { lte: dLte } }, select: { folio_id: true, date: true, type_amount: true, total: true } }),
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : [],
    companyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
  ]);

  // scopeLastReservation: is_posting=0 orderBy date asc first
  const lastResMap = new Map<number, any>();
  for (const fId of folioIds) {
    const list = resvs
      .filter((r: any) => Number(r.folio_id) === fId && r.is_posting === 0)
      .sort((a: any, b: any) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (list.length) lastResMap.set(fId, list[0]);
  }
  const roomIds = [...new Set([...lastResMap.values()].map((r: any) => (r.room_id === null || r.room_id === undefined ? null : Number(r.room_id))).filter((v: any): v is number => v !== null))];
  const roomTypeIds = [...new Set([...lastResMap.values()].map((r: any) => (r.room_type_id === null || r.room_type_id === undefined ? null : Number(r.room_type_id))).filter((v: any): v is number => v !== null))];
  const rateIds = [...new Set([...lastResMap.values()].map((r: any) => (r.rate_id === null || r.rate_id === undefined ? null : Number(r.rate_id))).filter((v: any): v is number => v !== null))];
  const [rooms, roomTypes, rates] = await Promise.all([
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds }, deleted_at: null }, select: { id: true, name: true } }) : [],
    roomTypeIds.length ? prisma.room_types.findMany({ where: { id: { in: roomTypeIds }, deleted_at: null }, select: { id: true, name: true } }) : [],
    rateIds.length ? prisma.rates.findMany({ where: { id: { in: rateIds }, deleted_at: null }, select: { id: true, code: true } }) : [],
  ]);
  const roomById = new Map(rooms.map((r: any) => [Number(r.id), r]));
  const roomTypeById = new Map(roomTypes.map((r: any) => [Number(r.id), r]));
  const rateById = new Map(rates.map((r: any) => [Number(r.id), r]));
  const guestById = new Map(guests.map((g: any) => [Number(g.id), g]));
  const companyById = new Map(companies.map((c: any) => [Number(c.id), c]));

  const fmtDMY = (d: any) => (d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}` : '');

  const reservations = folios.map((f: any) => {
    const fId = Number(f.id);
    const lr = lastResMap.get(fId);
    const todayTx = tbs.filter((t: any) => Number(t.folio_id) === fId && formatDate(t.date) === dateStr);
    const payment = todayTx.filter((t: any) => t.type_amount === 'MINUS').reduce((s: number, t: any) => s + Number(t.total), 0);
    const balance = Math.round(tbs.filter((t: any) => Number(t.folio_id) === fId && t.type_amount === 'PLUS').reduce((s: number, t: any) => s + Number(t.total), 0) * 100) / 100;
    const guest = f.guest_profile_id !== null && f.guest_profile_id !== undefined ? guestById.get(Number(f.guest_profile_id)) : undefined;
    const company = f.company_profile_id !== null && f.company_profile_id !== undefined ? companyById.get(Number(f.company_profile_id)) : undefined;
    return {
      folio: f.folio_number ?? '',
      roomType: lr && lr.room_type_id !== null && lr.room_type_id !== undefined ? (roomTypeById.get(Number(lr.room_type_id))?.name ?? '') : '',
      room: lr && lr.room_id !== null && lr.room_id !== undefined ? (roomById.get(Number(lr.room_id))?.name ?? '') : '',
      guest: `${guest?.first_name ?? ''} ${guest?.last_name ?? ''}`,
      groupName: company?.name ?? 'N/A',
      arrival: f.check_in_date ? fmtDMY(new Date(f.check_in_date)) : '',
      departure: f.check_out_date ? fmtDMY(new Date(f.check_out_date)) : '',
      rateCode: lr && lr.rate_id !== null && lr.rate_id !== undefined ? (rateById.get(Number(lr.rate_id))?.code ?? 'N/A') : 'N/A',
      payment,
      balance,
    };
  });

  const totalDepositBalance = Math.round(tbs.filter((t: any) => t.type_amount === 'PLUS').reduce((s: number, t: any) => s + Number(t.total), 0) * 100) / 100;

  return [{
    reservations,
    totalDepositBalance,
    business_date: dateStr,
    reportTitle: 'Reservations With Deposit Balances',
  }];
}

function nf(v: any, dec = 0): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!isFinite(n)) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function reservationRatePrice(r: any): number {
  const d = safeParseJson(r?.data);
  const p = d?.rate_price;
  return p !== undefined && p !== null && p !== '' ? Number(p) : 0;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

async function getBusinessDate(pid: bigint): Promise<string> {
  const last = await prisma.log_audits.findFirst({
    where: { property_id: Number(pid), deleted_at: null },
    orderBy: { date: 'desc' },
  });
  if (last?.date) {
    const d = new Date(last.date);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return formatDate(new Date());
}

async function getSegmentData(pid: bigint, segment: string, start: Date, end: Date, segmentNumber: number): Promise<number[]> {
  const typeIds = (await prisma.types.findMany({
    where: { group: `market-segment-${segmentNumber}`, name: segment, deleted_at: null, property_id: Number(pid) },
    select: { id: true },
  })).map((t: any) => t.id);
  if (!typeIds.length) return [0, 0, 0, 0];

  const mht = await prisma.model_has_types.findMany({
    where: { model_type: 'App\\Models\\Folio', type_id: { in: typeIds } },
    select: { model_id: true },
  });
  const folioIds = [...new Set(mht.map((m: any) => m.model_id))];
  if (!folioIds.length) return [0, 0, 0, 0];

  const folios = await prisma.folios.findMany({
    where: {
      id: { in: folioIds },
      check_in_date: { gte: start, lte: end },
      status_reservation: { not: STATUS_RESERVATION_CANCEL },
      deleted_at: null,
    },
    select: { id: true },
  });
  if (!folios.length) return [0, 0, 0, 0];

  const reservations = await prisma.reservations.findMany({
    where: { folio_id: { in: folios.map((f: any) => f.id) }, is_posting: 0, deleted_at: null },
  });

  const roomCount = reservations.length;
  const revenue = reservations.reduce((s: number, r: any) => s + reservationRatePrice(r), 0);
  const totalRooms = await prisma.rooms.count({ where: { property_id: pid, deleted_at: null } });
  const percentage = totalRooms > 0 ? (roomCount / totalRooms) * 100 : 0;
  const average = roomCount > 0 ? revenue / roomCount : 0;

  return [roomCount, percentage, revenue, average];
}

async function getRoomDivisionTotalData(pid: bigint, date: Date, totalRooms: number): Promise<any[]> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const notCancel = { not: STATUS_RESERVATION_CANCEL };

  const occupiedRows = await prisma.reservations.findMany({
    where: {
      property_id: pid,
      date: { gte: dayStart, lte: dayEnd },
      deleted_at: null,
      folios: { status_reservation: notCancel },
    },
  });
  const occupiedRooms = occupiedRows.length;
  const revenue = occupiedRows.reduce((s: number, r: any) => s + reservationRatePrice(r), 0);

  const blockedRooms = await prisma.rooms.count({ where: { property_id: pid, room_status: 3, deleted_at: null } });
  const vacantRooms = totalRooms - occupiedRooms - blockedRooms;

  const dayUseRooms = await prisma.reservations.count({
    where: {
      property_id: pid,
      check_in_date: { gte: dayStart, lte: dayEnd },
      check_out_date: { gte: dayStart, lte: dayEnd },
      deleted_at: null,
      folios: { status_reservation: notCancel },
    },
  });

  const complimentaryRooms = await prisma.folios.count({
    where: {
      property_id: pid,
      complimentary: true,
      check_in_date: { gte: dayStart, lte: dayEnd },
      status_reservation: notCancel,
      deleted_at: null,
    },
  });

  const occupancyPercentage = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;
  const averageRate = occupiedRooms > 0 ? revenue / occupiedRooms : 0;
  const pct = (n: number) => (totalRooms > 0 ? (n / totalRooms) * 100 : 0);

  return [
    { name: 'Occupancy (inclu COMP)', today: [occupiedRooms, occupancyPercentage, revenue, averageRate], mtd: [0, 0, 0, 0], ytd: [0, 0, 0, 0] },
    { name: 'Block', today: [blockedRooms, pct(blockedRooms), null, null], mtd: [0, 0, null, null], ytd: [0, 0, null, null] },
    { name: 'Vacant', today: [vacantRooms, pct(vacantRooms), null, null], mtd: [0, 0, null, null], ytd: [0, 0, null, null] },
    { name: 'Total Rooms', today: [totalRooms, 100, null, null], mtd: [0, 0, null, null], ytd: [0, 0, null, null] },
    { name: 'Day Use', today: [dayUseRooms, pct(dayUseRooms), null, null], mtd: [0, 0, null, null], ytd: [0, 0, null, null] },
    { name: 'Complimentary', today: [complimentaryRooms, pct(complimentaryRooms), null, null], mtd: [0, 0, null, null], ytd: [0, 0, null, null] },
  ];
}

async function getRoomDivision(params: any): Promise<any[]> {
  const pid = params.propertyId;

  const rawDate = params.date || (params.startDate || formatDate(new Date()));
  const parsed = new Date(`${rawDate}T00:00:00`);
  if (isNaN(parsed.getTime())) {
    const bd = await getBusinessDate(pid);
    params.date = bd;
  } else {
    params.date = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  const date = new Date(`${params.date}T00:00:00`);
  const totalRooms = await prisma.rooms.count({ where: { property_id: pid, deleted_at: null } });

  const reportData: any[] = [];

  for (let i = 1; i <= 4; i++) {
    const segmentNames = (await prisma.types.findMany({
      where: { group: `market-segment-${i}`, deleted_at: null, property_id: Number(pid) },
      select: { name: true },
    })).map((t: any) => t.name);

    reportData.push({
      name: `Market Segment ${i}`,
      isHeader: true,
      today: [null, null, null, null],
      mtd: [null, null, null, null],
      ytd: [null, null, null, null],
    });

    const todayTotal = [0, 0, 0, 0];
    const mtdTotal = [0, 0, 0, 0];
    const ytdTotal = [0, 0, 0, 0];

    for (const segment of segmentNames) {
      const todayData = await getSegmentData(pid, segment, date, date, i);
      const mtdData = await getSegmentData(pid, segment, startOfDay(new Date(date.getFullYear(), date.getMonth(), 1)), date, i);
      const ytdData = await getSegmentData(pid, segment, startOfDay(new Date(date.getFullYear(), 0, 1)), date, i);

      for (let j = 0; j < 4; j++) {
        todayTotal[j] += todayData[j] ?? 0;
        mtdTotal[j] += mtdData[j] ?? 0;
        ytdTotal[j] += ytdData[j] ?? 0;
      }

      reportData.push({ name: segment, isHeader: false, today: todayData, mtd: mtdData, ytd: ytdData });
    }

    reportData.push({
      name: `Total Market Segment ${i}`,
      isHeader: false,
      today: [
        todayTotal[0],
        totalRooms > 0 ? (todayTotal[0] / totalRooms) * 100 : 0,
        todayTotal[2],
        todayTotal[0] > 0 ? todayTotal[2] / todayTotal[0] : 0,
      ],
      mtd: [
        mtdTotal[0],
        totalRooms > 0 ? (mtdTotal[0] / totalRooms) * 100 : 0,
        mtdTotal[2],
        mtdTotal[0] > 0 ? mtdTotal[2] / mtdTotal[0] : 0,
      ],
      ytd: [
        ytdTotal[0],
        totalRooms > 0 ? (ytdTotal[0] / totalRooms) * 100 : 0,
        ytdTotal[2],
        ytdTotal[0] > 0 ? ytdTotal[2] / ytdTotal[0] : 0,
      ],
    });

    reportData.push({
      name: 'spacer', isHeader: false,
      today: [null, null, null, null],
      mtd: [null, null, null, null],
      ytd: [null, null, null, null],
    });
  }

  reportData.push(...(await getRoomDivisionTotalData(pid, date, totalRooms)));

  return reportData;
}

function renderRoomDivisionHtml(reportData: any[], dateDMY: string, startDate: string, endDate: string): string {
  const rows = reportData.map((row: any) => {
    if (row.name === 'spacer') {
      return `<tr class="spacer"><td colspan="13"></td></tr>`;
    }
    if (row.isHeader) {
      return `<tr class="segment-header"><td colspan="13" class="segment-name">${row.name}</td></tr>`;
    }
    if (row.name.startsWith('Total Market Segment')) {
      return `<tr class="segment-total"><td class="segment-name">${row.name}</td>${['today', 'mtd', 'ytd'].map((p) => {
        const c = row[p];
        return `<td>${c[0] !== null && c[0] !== undefined ? nf(c[0]) : ''}</td><td>${c[1] !== null && c[1] !== undefined ? nf(c[1], 2) : ''}</td><td>${c[2] !== null && c[2] !== undefined ? nf(c[2], 2) : ''}</td><td>${c[3] !== null && c[3] !== undefined ? nf(c[3], 2) : ''}</td>`;
      }).join('')}</tr>`;
    }
    const bold = ['Occupancy (inclu COMP)', 'Total Rooms'].includes(row.name);
    return `<tr${bold ? ' class="bold"' : ''}><td class="segment-name">${row.name}</td>${['today', 'mtd', 'ytd'].map((p) => {
      const c = row[p];
      return `<td>${c[0] !== null && c[0] !== undefined ? nf(c[0]) : ''}</td><td>${c[1] !== null && c[1] !== undefined ? nf(c[1], 2) : ''}</td><td>${c[2] !== null && c[2] !== undefined ? nf(c[2], 2) : ''}</td><td>${c[3] !== null && c[3] !== undefined ? nf(c[3], 2) : ''}</td>`;
    }).join('')}</tr>`;
  }).join('\n');

  const dateLabel = startDate === endDate ? `For Business Date: ${startDate}` : `For Business Date From ${startDate} To ${endDate}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Room Division Report</title>
<style>
body { font-family: Arial, sans-serif; font-size: 10px; line-height: 1.2; padding: 20px; }
h1, h2 { color: #333; text-align: center; margin-bottom: 10px; }
table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
th, td { border: 1px solid #ddd; padding: 4px; text-align: right; }
th { background-color: #f2f2f2; font-weight: normal; }
tr { page-break-inside: avoid; }
.segment-name { text-align: left; }
.bold { font-weight: bold; }
.spacer { height: 10px; }
.spacer td { border: none; }
.main-title { text-align: center; }
.segment-header { background-color: #e6e6e6; font-weight: bold; }
.segment-total { background-color: #f9f9f9; font-weight: bold; font-style: italic; }
main { text-transform: uppercase; }
</style>
</head>
<body>
<main>
<table>
<thead>
<tr>
<th rowspan="2" class="main-title">Market Segment</th>
<th colspan="4" class="main-title">Today</th>
<th colspan="4" class="main-title">Month To Date</th>
<th colspan="4" class="main-title">Year To Date</th>
</tr>
<tr>
<th>Room</th><th>Occupancy %</th><th>Revenue</th><th>ARR</th>
<th>Room</th><th>Occupancy %</th><th>Revenue</th><th>ARR</th>
<th>Room</th><th>%</th><th>Revenue</th><th>ARR</th>
</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</main>
</body>
</html>`;
}

async function renderPdf(
  html: string,
  opts: { header?: string; footer?: string; landscape?: boolean } = {}
): Promise<Buffer> {
  let puppeteer: any;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    throw new Error('puppeteer-core tidak terpasang. Jalankan: npm install puppeteer-core');
  }

  const fs = require('fs');
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const executablePath = candidates.find((p): p is string => !!p && fs.existsSync(p));
  if (!executablePath) {
    throw new Error('Chrome/Edge tidak ditemukan untuk render PDF');
  }

  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      landscape: opts.landscape !== false,
      displayHeaderFooter: true,
      margin: { top: '45mm', bottom: '35mm', left: '10mm', right: '10mm' },
      headerTemplate: opts.header || '<div></div>',
      footerTemplate: opts.footer || '<div></div>',
    });
  } finally {
    await browser.close();
  }
}

async function renderRoomDivisionPdf(res: Response, reportData: any[], params: any): Promise<void> {
  const [y, m, d] = params.date.split('-').map(Number);
  const dateDMY = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  const startDate = params.date;
  const endDate = params.date;
  const now = new Date();
  const nowStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const header = `<div style="font-family: Arial, sans-serif; font-size: 10px; width: 100%; text-align: center; padding: 0 10mm;"><div style="font-size: 14px; font-weight: bold;">Room Division Report</div><div style="font-size: 12px;">For Business Date: ${startDate}</div></div>`;
  const footer = `<div style="font-family: Arial, sans-serif; font-size: 9px; width: 100%; padding: 0 10mm;"><strong>Account/Transaction Report</strong><br><strong>Printed On:</strong> ${nowStr}</div>`;

  const pdf = await renderPdf(renderRoomDivisionHtml(reportData, dateDMY, startDate, endDate), { header, footer, landscape: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="room-division${startDate}.pdf"`);
  res.send(pdf);
}

function renderGenericReportHtml(data: any[], title: string, dateStr: string): string {
  if (!data.length) {
    return `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;padding:20px;text-align:center;}</style></head><body><h2>${title}</h2><p>Tidak ada data</p></body></html>`;
  }
  const cols = Object.keys(data[0]);
  const headerRow = cols.map(c => `<th>${c.replace(/_/g, ' ').replace(/\b\w/g, (x: string) => x.toUpperCase())}</th>`).join('');
  const rows = data.map(row => `<tr>${cols.map(c => `<td>${row[c] !== null && row[c] !== undefined ? row[c] : ''}</td>`).join('')}</tr>`).join('\n');
  const now = new Date();
  const nowStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;font-size:9px;padding:20px;}h2{text-align:center;margin-bottom:5px;}p{text-align:center;margin:0;font-size:10px;}table{border-collapse:collapse;width:100%;margin-top:15px;}th,td{border:1px solid #ddd;padding:3px;text-align:left;}th{background:#f2f2f2;font-weight:bold;}tr:nth-child(even){background:#fafafa;}</style></head>
<body><h2>${title}</h2><p>Date: ${dateStr}</p><table><thead><tr>${headerRow}</tr></thead><tbody>${rows}</tbody></table><p style="margin-top:20px;text-align:right;font-size:8px;">Printed: ${nowStr}</p></body></html>`;
}

async function renderGenericReportPdf(res: Response, data: any[], title: string, dateStr: string, fileName: string, landscape = false): Promise<void> {
  const now = new Date();
  const nowStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const header = `<div style="font-family:Arial,sans-serif;font-size:10px;width:100%;text-align:center;padding:0 10mm;"><div style="font-size:14px;font-weight:bold;">${title}</div><div style="font-size:12px;">Date: ${dateStr}</div></div>`;
  const footer = `<div style="font-family:Arial,sans-serif;font-size:9px;width:100%;padding:0 10mm;"><strong>Account/Transaction Report</strong><br><strong>Printed On:</strong> ${nowStr}</div>`;
  const pdf = await renderPdf(renderGenericReportHtml(data, title, dateStr), { header, footer, landscape });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
  res.send(pdf);
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

async function getDailySalesReport(params: any): Promise<any[]> {
  const pid = Number(params.propertyId);
  const businessDate = await getBusinessDate(BigInt(pid));
  const rawDate = params.date || params.startDate || businessDate;
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : businessDate;
  const isBusinessDate = dateStr === businessDate;
  const currency = params.currency || 'IDR';
  const kurs = Number(String(params.kurs ?? '100').replace(',', '.')) || 100;
  const jpy = (x: number) => x / kurs;
  const jpyR = (x: number) => Math.round((x / kurs) * 100) / 100;

  const d = new Date(`${dateStr}T00:00:00Z`);
  const lyD = new Date(d);
  lyD.setUTCFullYear(lyD.getUTCFullYear() - 1);
  const lyStr = formatDate(lyD);
  const somStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const lysomD = new Date(`${somStr}T00:00:00Z`);
  lysomD.setUTCFullYear(lysomD.getUTCFullYear() - 1);
  const lysomStr = formatDate(lysomD);
  const tmrStr = formatDate(new Date(d.getTime() + 86400000));
  const lyTmrD = new Date(`${tmrStr}T00:00:00Z`);
  lyTmrD.setUTCFullYear(lyTmrD.getUTCFullYear() - 1);
  const lyTmrStr = formatDate(lyTmrD);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const dayOfMonth = d.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const dayEq = (s: string) => new Date(`${s}T00:00:00Z`);

  const resvSQL = (dateEq: string): Promise<any[]> => prisma.$queryRaw`
    SELECT r.id, r.adult, r.child, r.rate_id, r.check_in_date, r.check_out_date,
      f.status_reservation, f.is_house_use, f.complimentary, f.type_reservation, f.folio_number
    FROM reservations r
    JOIN folios f ON r.folio_id = f.id AND f.deleted_at IS NULL
    WHERE r.deleted_at IS NULL AND r.property_id = ${pid} AND r.date = ${dayEq(dateEq)}`;
  const resvRangeSQL = (startStr: string, endStr: string): Promise<any[]> => prisma.$queryRaw`
    SELECT r.id, r.adult, r.child, r.rate_id, r.check_in_date, r.check_out_date,
      f.status_reservation, f.is_house_use, f.complimentary, f.type_reservation, f.folio_number
    FROM reservations r
    JOIN folios f ON r.folio_id = f.id AND f.deleted_at IS NULL
    WHERE r.deleted_at IS NULL AND r.property_id = ${pid}
      AND r.date >= ${dayEq(startStr)} AND r.date <= ${dayEq(endStr)}`;

  const tbSQL = (dateEq: string): Promise<any[]> => prisma.$queryRaw`
    SELECT tb.code, tb.type, tb.type_amount, tb.amount, tb.total
    FROM transaction_breakdowns tb
    WHERE tb.deleted_at IS NULL AND tb.property_id = ${pid}
      AND tb.type NOT IN ('payment', 'paidout', 'refund') AND tb.date = ${dayEq(dateEq)}`;
  const tbRangeSQL = (startStr: string, endStr: string, exclusiveEnd: boolean): Promise<any[]> =>
    exclusiveEnd
      ? prisma.$queryRaw`
        SELECT tb.code, tb.type, tb.type_amount, tb.amount, tb.total
        FROM transaction_breakdowns tb
        WHERE tb.deleted_at IS NULL AND tb.property_id = ${pid}
          AND tb.type NOT IN ('payment', 'paidout', 'refund')
          AND tb.date >= ${dayEq(startStr)}
          AND tb.date < ${new Date(dayEq(endStr).getTime() + 86400000)}`
      : prisma.$queryRaw`
        SELECT tb.code, tb.type, tb.type_amount, tb.amount, tb.total
        FROM transaction_breakdowns tb
        WHERE tb.deleted_at IS NULL AND tb.property_id = ${pid}
          AND tb.type NOT IN ('payment', 'paidout', 'refund')
          AND tb.date >= ${dayEq(startStr)}
          AND tb.date <= ${dayEq(endStr)}`;

  const [resvsDate, resvsLy, resvsMtd, resvsLyMtd, resvsTmr, resvsLyTmr, tbDate, tbLy, tbMtd, tbLyMtd, totalRooms] = await Promise.all([
    resvSQL(dateStr),
    resvSQL(lyStr),
    resvRangeSQL(somStr, dateStr),
    resvRangeSQL(lysomStr, lyStr),
    resvSQL(tmrStr),
    resvSQL(lyTmrStr),
    tbSQL(dateStr),
    tbSQL(lyStr),
    tbRangeSQL(somStr, dateStr, false),
    tbRangeSQL(lysomStr, lyStr, false),
    prisma.rooms.count({ where: { property_id: pid, status: 1, deleted_at: null } }),
  ]);

  // Rate types (compliment/house-use exclusion) + breakfast inclusives
  const rateIds = [...new Set([...resvsDate, ...resvsLy, ...resvsMtd, ...resvsLyMtd, ...resvsTmr, ...resvsLyTmr]
    .map((r: any) => (r.rate_id === null || r.rate_id === undefined ? null : Number(r.rate_id)))
    .filter((v: any): v is number => v !== null))];
  const [mht, bfRows, cps] = await Promise.all([
    rateIds.length ? prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\Rate', model_id: { in: rateIds } }, select: { model_id: true, type_id: true } }) : [],
    rateIds.length ? prisma.$queryRaw<any[]>`
      SELECT ri.rate_id, cp.name
      FROM rate_inclusives ri
      JOIN code_items ci ON ri.stock = ci.id AND ci.deleted_at IS NULL
      JOIN code_posts cp ON ci.code_post_id = cp.id AND cp.deleted_at IS NULL AND cp.property_id = ${pid}
      WHERE ri.deleted_at IS NULL AND ri.property_id = ${pid} AND ri.rate_id IN (${rateIds})` : [],
    prisma.code_posts.findMany({ where: { property_id: pid, deleted_at: null }, select: { id: true, name: true, type: true, code_billing_id: true } }),
  ]);
  const typeIds = [...new Set(mht.map((m: any) => Number(m.type_id)))];
  const tps = typeIds.length ? await prisma.types.findMany({ where: { id: { in: typeIds }, property_id: pid, deleted_at: null }, select: { id: true, group: true, name: true } }) : [];
  const rateTypeMap = new Map<number, any[]>();
  for (const m of mht) {
    const rid = Number(m.model_id);
    const ty = tps.find((t: any) => Number(t.id) === Number(m.type_id));
    if (!ty) continue;
    if (!rateTypeMap.has(rid)) rateTypeMap.set(rid, []);
    rateTypeMap.get(rid)!.push(ty);
  }
  const bfMap = new Map<number, string[]>();
  for (const b of bfRows) {
    const rid = Number(b.rate_id);
    if (!bfMap.has(rid)) bfMap.set(rid, []);
    bfMap.get(rid)!.push(String(b.name).toLowerCase());
  }

  // Code posts + billings for revenue grouping
  const cpMap = new Map<string, any>();
  for (const c of cps) cpMap.set(String(c.id), c);
  const billingIds = [...new Set(cps.map((c: any) => (c.code_billing_id === null || c.code_billing_id === undefined ? null : Number(c.code_billing_id))).filter((v: any): v is number => v !== null))];
  const bls = billingIds.length ? await prisma.code_billings.findMany({ where: { id: { in: billingIds }, property_id: pid, deleted_at: null }, select: { id: true, name: true } }) : [];
  const blMap = new Map<number, any>();
  for (const b of bls) blMap.set(Number(b.id), b);

  // Budgets (variable/fixed)
  const budgetPosts = await prisma.code_posts.findMany({
    where: {
      property_id: pid, deleted_at: null,
      OR: [{ name: { contains: 'variable', mode: 'insensitive' } }, { name: { contains: 'fixed', mode: 'insensitive' } }],
    },
    select: { id: true, name: true },
  });
  const vbIds = budgetPosts.filter((p: any) => p.name.toLowerCase().includes('variable')).map((p: any) => Number(p.id));
  const fbIds = budgetPosts.filter((p: any) => p.name.toLowerCase().includes('fixed')).map((p: any) => Number(p.id));
  const [vbAgg, fbAgg] = await Promise.all([
    vbIds.length ? prisma.post_code_budgets.aggregate({ where: { year, month, code_post_id: { in: vbIds } }, _sum: { budget: true } }) : { _sum: { budget: null } },
    fbIds.length ? prisma.post_code_budgets.aggregate({ where: { year, month, code_post_id: { in: fbIds } }, _sum: { budget: true } }) : { _sum: { budget: null } },
  ]);
  const variableTotal = Number((vbAgg as any)._sum?.budget || 0);
  const fixedTotal = Number((fbAgg as any)._sum?.budget || 0);

  // ── filters ──
  const isSalesFolio = (r: any): boolean => {
    const st = Number(r.status_reservation);
    if (st === 2 || st === 5) return false;
    if (Number(r.is_house_use) !== 0 || Number(r.complimentary) !== 0) return false;
    const cin = r.check_in_date ? formatDate(r.check_in_date) : '';
    const cout = r.check_out_date ? formatDate(r.check_out_date) : '';
    if (!cin || !cout || cin === cout) return false;
    const tr = String(r.type_reservation || '');
    if (tr !== 'fit' && tr !== 'git') {
      if (!(tr === 'vr' && String(r.folio_number || '').startsWith('F'))) return false;
    }
    const rid = r.rate_id === null || r.rate_id === undefined ? null : Number(r.rate_id);
    const types = rid !== null ? rateTypeMap.get(rid) || [] : [];
    if (types.some((t: any) => t.group === 'company-type' && (/compliment/i.test(t.name) || /house use/i.test(t.name)))) return false;
    return true;
  };
  const isPaxFolio = (r: any): boolean => {
    const st = Number(r.status_reservation);
    if (st === 2 || st === 5) return false;
    const tr = String(r.type_reservation || '');
    return tr === 'git' || tr === 'fit';
  };
  const isForecastFolio = (r: any): boolean => {
    const st = Number(r.status_reservation);
    if (st === 2 || st === 5) return false;
    const tr = String(r.type_reservation || '');
    if (tr !== 'git' && tr !== 'fit') return false;
    if (Number(r.is_house_use) !== 0 || Number(r.complimentary) !== 0) return false;
    return true;
  };
  const hasBreakfast = (r: any): boolean => {
    const rid = r.rate_id === null || r.rate_id === undefined ? null : Number(r.rate_id);
    if (rid === null) return false;
    const names = bfMap.get(rid) || [];
    return names.some((n: string) => n.includes('breakfast additional') || n.includes('breakfast room'));
  };
  const sumPax = (rows: any[]): number => rows.reduce((s, r) => s + Number(r.adult || 0) + Number(r.child || 0), 0);

  // ── legacy 2024 tables ──
  const legacyRoomSold = async (startStr: string, endStr?: string): Promise<number> => {
    if (endStr) {
      const agg = await prisma.report_pax_room_solds.aggregate({ where: { date: { gte: dayEq(startStr), lte: dayEq(endStr) } }, _sum: { last_year_room_sold: true } });
      return Number((agg as any)._sum?.last_year_room_sold || 0);
    }
    const row = await prisma.report_pax_room_solds.findFirst({ where: { date: dayEq(startStr) } });
    return row ? Number(row.last_year_room_sold || 0) : 0;
  };
  const legacyRevenue = async (type: string, startStr: string, endStr?: string): Promise<number> => {
    const where: any = endStr ? { date: { gte: dayEq(startStr), lte: dayEq(endStr) } } : { date: dayEq(startStr) };
    if (type === 'breakfast') {
      const a = await prisma.report_revenue_breakfast.aggregate({ where, _sum: { last_year: true } });
      return Number((a as any)._sum?.last_year || 0);
    }
    if (type === 'dine in') {
      const a = await prisma.report_revenue_dine_in.aggregate({ where, _sum: { last_year: true } });
      return Number((a as any)._sum?.last_year || 0);
    }
    if (type === 'room service') {
      const a = await prisma.report_revenue_room_services.aggregate({ where, _sum: { last_year: true } });
      return Number((a as any)._sum?.last_year || 0);
    }
    if (type === 'minimart') {
      const a = await prisma.report_revenue_minimarts.aggregate({ where, _sum: { last_year: true } });
      return Number((a as any)._sum?.last_year || 0);
    }
    if (type === 'fb') {
      const a = await prisma.report_revenue_fb_other.aggregate({ where, _sum: { last_year: true } });
      return Number((a as any)._sum?.last_year || 0);
    }
    if (type === 'room revenue' || type === 'banquet' || type === 'other') {
      const code = type === 'room revenue' ? 'ROOM REVENUE' : type === 'banquet' ? 'BANQUET REVENUE' : 'OTHER REVENUE';
      const a = await prisma.report_revenue_room_banquet_others.aggregate({ where: { ...where, code }, _sum: { last_year: true } });
      return Number((a as any)._sum?.last_year || 0);
    }
    return 0;
  };

  // ── revenue helpers ──
  const revenueByType = (tbs: any[], type: string): number => {
    let sum = 0;
    for (const t of tbs) {
      const cp = cpMap.get(String(t.code));
      if (!cp) continue;
      if (type === 'banquet' || type === 'other' || type === 'room revenue') {
        const bl = cp.code_billing_id === null || cp.code_billing_id === undefined ? undefined : blMap.get(Number(cp.code_billing_id));
        if (!bl) continue;
        if (type === 'other') {
          const n = bl.name.toLowerCase();
          if (!n.includes('expenses') && !n.includes('other')) continue;
        } else {
          if (!bl.name.toLowerCase().includes(type)) continue;
        }
      } else if (['breakfast', 'dine in', 'room service', 'minimart'].includes(type)) {
        if (cp.type !== 'DEFAULT') continue;
        if (!cp.name.toLowerCase().startsWith(type)) continue;
      } else {
        if (cp.type !== 'DEFAULT') continue;
        const n = cp.name.toLowerCase();
        if (n.startsWith('breakfast') || n.startsWith('dine in') || n.startsWith('room service') || n.startsWith('minimart')) continue;
        const bl = cp.code_billing_id === null || cp.code_billing_id === undefined ? undefined : blMap.get(Number(cp.code_billing_id));
        if (!bl || !bl.name.toLowerCase().includes('restaurant revenue')) continue;
      }
      sum += t.type_amount === 'PLUS' ? Number(t.amount) : -Number(t.amount);
    }
    return sum;
  };
  const balanceRevenue = (tbs: any[]): number => {
    const groups = new Map<string, { debit: number; credit: number }>();
    for (const t of tbs) {
      const cp = cpMap.get(String(t.code));
      if (!cp) continue;
      const bl = cp.code_billing_id === null || cp.code_billing_id === undefined ? undefined : blMap.get(Number(cp.code_billing_id));
      if (!bl || bl.name.toLowerCase().includes('payment')) continue;
      let g = groups.get(String(t.code));
      if (!g) { g = { debit: 0, credit: 0 }; groups.set(String(t.code), g); }
      if (t.type_amount === 'MINUS') g.debit += Number(t.total);
      else g.credit += Number(t.total);
    }
    let total = 0;
    for (const g of groups.values()) total += g.debit * -1 + g.credit;
    return total;
  };
  const revData = (cur: number, last: number) => ({
    idr: cur,
    jpy: jpy(cur),
    last_year: last,
    ytd: last > 0 ? (cur / last) * 100 : 0,
    variance: cur - last,
  });

  // ── daily stats ──
  const salesDate = resvsDate.filter(isSalesFolio);
  const salesLy = resvsLy.filter(isSalesFolio);
  const salesMtd = resvsMtd.filter(isSalesFolio);
  const salesLyMtd = resvsLyMtd.filter(isSalesFolio);
  const salesTmr = resvsTmr.filter(isForecastFolio);
  const salesLyTmr = resvsLyTmr.filter(isSalesFolio);

  const roomSold = salesDate.length;
  const lastYearRoomSold = lyD.getUTCFullYear() === 2024 ? await legacyRoomSold(lyStr) : salesLy.length;
  const occupancy = totalRooms > 0 ? (roomSold / totalRooms) * 100 : 0;
  const lastYearOccupancy = totalRooms > 0 ? (lastYearRoomSold / totalRooms) * 100 : 0;
  const breakfastRows = salesDate.filter(hasBreakfast);
  const dailyStats = {
    total_rooms: totalRooms,
    room_sold: roomSold,
    total_pax: sumPax(salesDate),
    breakfast_rooms: breakfastRows.length,
    breakfast_pax: sumPax(breakfastRows),
    last_year_room_sold: lastYearRoomSold,
    occupancy: Math.round(occupancy * 100) / 100,
    last_year_occupancy: Math.round(lastYearOccupancy * 100) / 100,
    variance: Math.round((occupancy - lastYearOccupancy) * 100) / 100,
  };

  const mtdRoomSold = salesMtd.length;
  const lastYearMtdRoomSold = lyD.getUTCFullYear() === 2024 ? await legacyRoomSold(lysomStr, lyStr) : salesLyMtd.length;
  const totalRoomsMTD = totalRooms * dayOfMonth;
  const mtdOccupancy = totalRoomsMTD > 0 ? (mtdRoomSold / totalRoomsMTD) * 100 : 0;
  const lastYearMtdOccupancy = totalRoomsMTD > 0 ? (lastYearMtdRoomSold / totalRoomsMTD) * 100 : 0;
  const breakfastMtdRows = salesMtd.filter(hasBreakfast);
  const mtdStats = {
    total_rooms: totalRoomsMTD,
    room_sold: mtdRoomSold,
    total_pax: sumPax(salesMtd),
    breakfast_rooms: breakfastMtdRows.length,
    breakfast_pax: sumPax(breakfastMtdRows),
    last_year_room_sold: lastYearMtdRoomSold,
    occupancy: Math.round(mtdOccupancy * 100) / 100,
    last_year_occupancy: Math.round(lastYearMtdOccupancy * 100) / 100,
    variance: Math.round((mtdOccupancy - lastYearMtdOccupancy) * 100) / 100,
  };

  const forecastRoomSold = salesTmr.length;
  const lastYearForecastRoomSold = lyTmrD.getUTCFullYear() === 2024 ? await legacyRoomSold(lyTmrStr) : salesLyTmr.length;
  const forecastOccupancy = totalRooms > 0 ? (forecastRoomSold / totalRooms) * 100 : 0;
  const lastYearForecastOccupancy = totalRooms > 0 ? (lastYearForecastRoomSold / totalRooms) * 100 : 0;
  const breakfastForecastRows = salesTmr.filter(hasBreakfast);
  const forecastStats = {
    total_rooms: totalRooms,
    room_sold: forecastRoomSold,
    total_pax: sumPax(salesTmr),
    breakfast_rooms: breakfastForecastRows.length,
    breakfast_pax: sumPax(breakfastForecastRows),
    last_year_room_sold: lastYearForecastRoomSold,
    occupancy: Math.round(forecastOccupancy * 100) / 100,
    last_year_occupancy: Math.round(lastYearForecastOccupancy * 100) / 100,
    variance: Math.round((forecastOccupancy - lastYearForecastOccupancy) * 100) / 100,
  };

  // ── balances ──
  const balanceObj = (totalRev: number, vCost: number, fCost: number) => {
    const difference = totalRev - vCost - fCost;
    return {
      total_revenue_idr: totalRev,
      total_revenue_jpy: jpyR(totalRev),
      variable_cost_idr: vCost,
      variable_cost_jpy: jpyR(vCost),
      fixed_cost_idr: fCost,
      fixed_cost_jpy: jpyR(fCost),
      difference_idr: difference,
      difference_jpy: jpyR(difference),
      win_lose: difference > 0 ? 'O' : difference === 0 ? '△' : 'X',
    };
  };
  const actualBalance = balanceObj(balanceRevenue(tbDate), variableTotal / daysInMonth, fixedTotal / daysInMonth);
  const mtdBalance = balanceObj(balanceRevenue(tbMtd), variableTotal, fixedTotal);

  // ── room sales ──
  const revCur = (type: string): Promise<number> => (year === 2024 ? legacyRevenue(type, dateStr) : Promise.resolve(revenueByType(tbDate, type)));
  const revLy = (type: string): Promise<number> => (lyD.getUTCFullYear() === 2024 ? legacyRevenue(type, lyStr) : Promise.resolve(revenueByType(tbLy, type)));
  const revCurMtd = (type: string): Promise<number> => (year === 2024 ? legacyRevenue(type, somStr, dateStr) : Promise.resolve(revenueByType(tbMtd, type)));
  const revLyMtd = (type: string): Promise<number> => (lyD.getUTCFullYear() === 2024 ? legacyRevenue(type, lysomStr, lyStr) : Promise.resolve(revenueByType(tbLyMtd, type)));

  const dailyRevenue = await revCur('room revenue');
  const lastYearDailyRevenue = await revLy('room revenue');
  const paxDaily = sumPax(resvsDate.filter(isPaxFolio));
  const paxLy = sumPax(resvsLy.filter(isPaxFolio));
  const arr = roomSold > 0 ? dailyRevenue / roomSold : 0;
  const lastYearARR = lastYearRoomSold > 0 ? lastYearDailyRevenue / lastYearRoomSold : 0;
  const avgRatePerPax = paxDaily > 0 ? dailyRevenue / paxDaily : 0;
  const lastYearAvgRatePerPax = paxDaily > 0 ? lastYearDailyRevenue / paxDaily : 0;
  const revpar = totalRooms > 0 ? dailyRevenue / totalRooms : 0;
  const lastYearRevpar = totalRooms > 0 ? lastYearDailyRevenue / totalRooms : 0;

  const mtdRevenue = await revCurMtd('room revenue');
  const lastYearMtdRevenue = await revLyMtd('room revenue');
  const paxMtd = sumPax(resvsMtd.filter(isPaxFolio));
  const paxLyMtd = sumPax(resvsLyMtd.filter(isPaxFolio));
  const mtdArr = mtdRoomSold > 0 ? mtdRevenue / mtdRoomSold : 0;
  const lastYearMtdARR = lastYearMtdRoomSold > 0 ? lastYearMtdRevenue / lastYearMtdRoomSold : 0;
  const mtdAvgRatePerPax = paxMtd > 0 ? mtdRevenue / paxMtd : 0;
  const lastYearMtdAvgRatePerPax = paxMtd > 0 ? lastYearMtdRevenue / paxMtd : 0;
  const mtdRevpar = totalRoomsMTD > 0 ? mtdRevenue / totalRoomsMTD : 0;
  const lastYearMtdRevpar = totalRoomsMTD > 0 ? lastYearMtdRevenue / totalRoomsMTD : 0;

  const roomSales = {
    daily: {
      room_revenue_idr: dailyRevenue,
      room_revenue_jpy: jpy(dailyRevenue),
      last_year_room_revenue: lastYearDailyRevenue,
      ytd_room_revenue: dailyRevenue > 0 && lastYearDailyRevenue > 0 ? (dailyRevenue / lastYearDailyRevenue) * 100 : 0,
      room_revenue_variance: dailyRevenue - lastYearDailyRevenue,
      arr_idr: arr,
      arr_jpy: jpy(arr),
      last_year_arr: lastYearARR,
      ytd_arr: arr > 0 && lastYearARR > 0 ? (arr / lastYearARR) * 100 : 0,
      arr_variance: arr - lastYearARR,
      avg_rate_pax_idr: avgRatePerPax,
      avg_rate_pax_jpy: jpy(avgRatePerPax),
      last_year_avg_rate_pax: paxDaily > 0 ? lastYearDailyRevenue / paxDaily : 0,
      ytd_avg_rate_pax: avgRatePerPax > 0 && lastYearAvgRatePerPax > 0 ? (avgRatePerPax / lastYearAvgRatePerPax) * 100 : 0,
      avg_rate_pax_variance: avgRatePerPax - lastYearAvgRatePerPax,
      revpar_idr: revpar,
      revpar_jpy: jpy(revpar),
      last_year_revpar: lastYearRevpar,
      ytd_revpar: revpar > 0 && lastYearRevpar > 0 ? (revpar / lastYearRevpar) * 100 : 0,
      revpar_variance: revpar - lastYearRevpar,
    },
    mtd: {
      room_revenue_idr: mtdRevenue,
      room_revenue_jpy: jpy(mtdRevenue),
      last_year_room_revenue: lastYearMtdRevenue,
      ytd_room_revenue: mtdRevenue > 0 && lastYearMtdRevenue > 0 ? (mtdRevenue / lastYearMtdRevenue) * 100 : 0,
      room_revenue_variance: mtdRevenue - lastYearMtdRevenue,
      arr_idr: mtdArr,
      arr_jpy: jpy(mtdArr),
      last_year_arr: lastYearMtdARR,
      ytd_arr: mtdArr > 0 && lastYearMtdARR > 0 ? (mtdArr / lastYearMtdARR) * 100 : 0,
      arr_variance: mtdArr - lastYearMtdARR,
      avg_rate_pax_idr: mtdAvgRatePerPax,
      avg_rate_pax_jpy: jpy(mtdAvgRatePerPax),
      last_year_avg_rate_pax: paxMtd > 0 ? lastYearMtdRevenue / paxMtd : 0,
      ytd_avg_rate_pax: mtdAvgRatePerPax > 0 && lastYearMtdAvgRatePerPax > 0 ? (mtdAvgRatePerPax / lastYearMtdAvgRatePerPax) * 100 : 0,
      avg_rate_pax_variance: mtdAvgRatePerPax - lastYearMtdAvgRatePerPax,
      revpar_idr: mtdRevpar,
      revpar_jpy: jpy(mtdRevpar),
      last_year_revpar: lastYearMtdRevpar,
      ytd_revpar: mtdRevpar > 0 && lastYearMtdRevpar > 0 ? (mtdRevpar / lastYearMtdRevpar) * 100 : 0,
      revpar_variance: mtdRevpar - lastYearMtdRevpar,
    },
  };

  // ── revenue breakdown ──
  const revTypes = ['room revenue', 'breakfast', 'dine in', 'room service', 'minimart', 'fb', 'banquet', 'other'];
  const revEntries: Record<string, any> = {};
  const mtdRevEntries: Record<string, any> = {};
  const dailyRevSums = { idr: 0, jpy: 0, last_year: 0, variance: 0 };
  const mtdRevSums = { idr: 0, jpy: 0, last_year: 0, variance: 0 };
  for (const t of revTypes) {
    const [cur, last] = await Promise.all([revCur(t), revLy(t)]);
    const [curM, lastM] = await Promise.all([revCurMtd(t), revLyMtd(t)]);
    const entry = revData(cur, last);
    const entryM = revData(curM, lastM);
    revEntries[t] = entry;
    mtdRevEntries[t] = entryM;
    dailyRevSums.idr += entry.idr;
    dailyRevSums.jpy += entry.jpy;
    dailyRevSums.last_year += entry.last_year;
    dailyRevSums.variance += entry.variance;
    mtdRevSums.idr += entryM.idr;
    mtdRevSums.jpy += entryM.jpy;
    mtdRevSums.last_year += entryM.last_year;
    mtdRevSums.variance += entryM.variance;
  }
  const dailyRevenueData: Record<string, any> = {};
  const mtdRevenueData: Record<string, any> = {};
  for (const t of revTypes) {
    dailyRevenueData[`${t.replace(/ /g, '_')}_revenue`] = revEntries[t];
    mtdRevenueData[`${t.replace(/ /g, '_')}_revenue`] = mtdRevEntries[t];
  }
  dailyRevenueData.total_nett_revenue = {
    idr: dailyRevSums.idr,
    jpy: dailyRevSums.jpy,
    last_year: dailyRevSums.last_year,
    ytd: dailyRevSums.last_year > 0 ? (dailyRevSums.idr / dailyRevSums.last_year) * 100 : 0,
    variance: dailyRevSums.variance,
  };
  mtdRevenueData.total_nett_revenue = {
    idr: mtdRevSums.idr,
    jpy: mtdRevSums.jpy,
    last_year: mtdRevSums.last_year,
    ytd: mtdRevSums.last_year > 0 ? (mtdRevSums.idr / mtdRevSums.last_year) * 100 : 0,
    variance: mtdRevSums.variance,
  };

  return [{
    date: dateStr,
    currency,
    exchangeRate: kurs,
    generalManager: 'KURNIAWAN',
    createdBy: 'FO MANAGER',
    actualBalance,
    mtdBalance,
    dailyStats,
    mtdStats,
    forecastStats,
    roomSales,
    dailyRevenue: dailyRevenueData,
    mtdRevenue: mtdRevenueData,
  }];
}

const getAccountDailySalesReport = getDailySalesReport;

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

const ROOM_STATUS_NAME: Record<number, string> = { 0: 'Vacant', 1: 'Occupied', 2: 'Out of Order', 3: 'Reserved' };
const MAID_STATUS_NAME: Record<number, string> = { 0: 'Clean', 1: 'Dirty', 2: 'Maid in Room', 3: 'Inspection Required' };
const STATUS_RESERVATION_CHECK_IN = 0;
const STATUS_RESERVATION_RESERVATION = 3;
const STATUS_RESERVATION_PENDING = 5;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

function fmtDMY(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

function fmtDMYHMS(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${fmtDMY(dt)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
}

async function getRoomStatusReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const rooms = await prisma.rooms.findMany({
    where: { property_id: pid, deleted_at: null },
    select: { id: true, name: true, room_status: true, maid_status: true, room_type_id: true },
  });
  const roomTypeIds = [...new Set(rooms.map((r: any) => r.room_type_id).filter((v: any) => v !== null && v !== undefined))];
  const [types, roomTypeNames] = await Promise.all([
    roomTypeIds.length
      ? prisma.types.findMany({ where: { id: { in: roomTypeIds } }, select: { id: true, name: true, group: true } })
      : Promise.resolve([] as any[]),
    roomTypeIds.length
      ? prisma.room_types.findMany({ where: { id: { in: roomTypeIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as any[]),
  ]);
  const typeById = new Map(types.map((t: any) => [t.id, t]));
  const rtNameById = new Map(roomTypeNames.map((t: any) => [t.id, t.name]));

  let totalRooms = 0;
  let totalOccupied = 0;
  let totalCleanRooms = 0;
  let totalDirtyRooms = 0;

  const reportData = rooms.map((room: any) => {
    const building = typeById.get(room.room_type_id)?.group === 'building' ? typeById.get(room.room_type_id) : null;
    const floor = typeById.get(room.room_type_id)?.group === 'floor' ? typeById.get(room.room_type_id) : null;
    totalRooms++;
    if (room.room_status === 1) totalOccupied++;
    if (room.maid_status === 0) totalCleanRooms++;
    else totalDirtyRooms++;
    return {
      building: building?.name || '',
      building_sort: building ? Number(building.id) : 0,
      floor: floor?.name || '',
      floor_sort: floor ? Number(floor.id) : 0,
      room: room.name,
      room_sort: parseInt(room.name.replace(/[^0-9]/g, ''), 10) || 0,
      roomType: rtNameById.get(room.room_type_id) || '',
      roomStatus: ROOM_STATUS_NAME[room.room_status] ?? 'Unknown',
      maidStatus: MAID_STATUS_NAME[room.maid_status] ?? 'Unknown',
    };
  });

  reportData.sort((a: any, b: any) =>
    a.building_sort - b.building_sort || a.floor_sort - b.floor_sort || a.room_sort - b.room_sort);

  const percentCleanRooms = totalRooms > 0 ? Number(((totalCleanRooms / totalRooms) * 100).toFixed(2)) : 0;

  return [{
    reportDate: params.date || formatDate(new Date()),
    totalRooms,
    totalOccupied,
    totalCleanRooms,
    totalDirtyRooms,
    percentCleanRooms,
    rooms: reportData,
  }];
}

async function getBlockRoomsReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = addDays(params.endDate || startDate, 30);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const [workOrders, availabilities] = await Promise.all([
    prisma.work_orders.findMany({
      where: { property_id: pid, date: { gte: start, lte: end }, room_id: { not: null }, deleted_at: null },
      select: {
        id: true, date: true, start_time: true, room_id: true,
        rooms: { select: { name: true, room_types: { select: { name: true } } } },
        users_work_orders_reported_byTousers: { select: { name: true } },
      },
    }),
    prisma.room_availabilities.findMany({
      where: { property_id: pid, date: { gte: start, lte: end }, deleted_at: null },
      select: { id: true, date: true, room_id: true, created_by: true },
    }),
  ]);

  const roomIds = [...new Set(availabilities.map((a: any) => a.room_id).filter((v: any) => v !== null && v !== undefined))];
  const creatorIds = [...new Set(availabilities.map((a: any) => a.created_by).filter((v: any) => v !== null && v !== undefined))];
  const [availRooms, creators] = await Promise.all([
    roomIds.length
      ? prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true, room_types: { select: { name: true } } } })
      : Promise.resolve([] as any[]),
    creatorIds.length
      ? prisma.users.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as any[]),
  ]);
  const roomById = new Map(availRooms.map((r: any) => [r.id, r]));
  const userById = new Map(creators.map((u: any) => [u.id, u]));

  const reportData: Record<string, any[]> = {};
  for (const wo of workOrders) {
    const date = fmtDMY(wo.date);
    if (!reportData[date]) reportData[date] = [];
    reportData[date].push({
      room: wo.rooms?.name || '',
      type: wo.rooms?.room_types?.name || '',
      reason: 'AC DOESN\'T COLD',
      user: wo.users_work_orders_reported_byTousers?.name || '',
      blockTime: `${date} ${wo.start_time || '00:00:00'}`,
    });
  }
  for (const av of availabilities) {
    const date = fmtDMY(av.date);
    if (!reportData[date]) reportData[date] = [];
    const r = roomById.get(av.room_id);
    reportData[date].push({
      room: r?.name || '',
      type: r?.room_types?.name || '',
      reason: 'AC RUSAK',
      user: userById.get(av.created_by)?.name || '',
      blockTime: fmtDMYHMS(av.date),
    });
  }
  for (const date of Object.keys(reportData)) {
    reportData[date].sort((a: any, b: any) => a.room.localeCompare(b.room));
  }

  return [{
    startDate,
    endDate,
    reportData,
  }];
}

async function getRoomChangeHistory(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const changes = await prisma.room_change_histories.findMany({
    where: { property_id: pid, datetime: { gte: start, lte: end } },
    select: { id: true, folio_number: true, check_in_date: true, check_out_date: true, from_room_id: true, to_room_id: true, user_id: true, datetime: true, reason: true },
    orderBy: { datetime: 'asc' },
  });

  const roomIds = [...new Set([...changes.map((c: any) => c.from_room_id), ...changes.map((c: any) => c.to_room_id)])];
  const userIds = [...new Set(changes.map((c: any) => c.user_id).filter((v: any) => v !== null && v !== undefined))];
  const [rooms, users] = await Promise.all([
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
    userIds.length ? prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
  ]);
  const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));
  const userById = new Map(users.map((u: any) => [u.id, u.name]));

  const roomChanges = changes.map((c: any) => ({
    folio_number: c.folio_number,
    check_in_date: formatDate(c.check_in_date),
    check_out_date: formatDate(c.check_out_date),
    from_room_name: roomById.get(c.from_room_id) || '',
    to_room_name: roomById.get(c.to_room_id) || '',
    changed_by: userById.get(c.user_id) || '',
    changed_date: fmtDMYHMS(c.datetime),
    reason: c.reason || '',
  }));

  return [{
    startDate: fmtDMYHMS(start),
    endDate: fmtDMYHMS(end),
    roomChanges,
  }];
}

async function getCancellationListing(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || addDays(startDate, 30);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const folios = await prisma.folios.findMany({
    where: { property_id: pid, status_reservation: STATUS_RESERVATION_CANCEL, updated_at: { gte: start, lte: end }, deleted_at: null },
    include: {
      company_profiles_folios_company_profile_idTocompany_profiles: true,
      reservations: { include: { room_types: true, rates: true } },
    },
  });

  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null && v !== undefined))];
  const updaterIds = [...new Set(folios.map((f: any) => f.updated_by).filter((v: any) => v !== null && v !== undefined))];
  const [guests, updaters] = await Promise.all([
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : Promise.resolve([] as any[]),
    updaterIds.length ? prisma.users.findMany({ where: { id: { in: updaterIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
  ]);
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const updaterById = new Map(updaters.map((u: any) => [u.id, u.name]));

  const reportData = folios.map((folio: any) => {
    const guest = guestById.get(folio.guest_profile_id);
    const reservation = folio.reservations?.[0];
    const data = (typeof folio.data === 'string' ? safeParseJson(folio.data) : folio.data) || {};
    return {
      resType: folio.type_reservation || '',
      folio: folio.folio_number || '',
      guest: guest?.first_name || guest?.last_name ? `${guest?.first_name || ''} ${guest?.last_name || ''}`.trim() : 'N/A',
      company: folio.company_profiles_folios_company_profile_idTocompany_profiles?.name || 'N/A',
      roomType: reservation?.room_types?.name || 'N/A',
      rateCode: reservation?.rates?.code || 'N/A',
      adult: reservation?.adult ?? 'N/A',
      child: reservation?.child ?? 'N/A',
      checkInDate: formatDate(folio.check_in_date),
      checkOutDate: formatDate(folio.check_out_date),
      rate: Number(data.rate_price ?? 0),
      cancellationStaff: updaterById.get(folio.updated_by) || 'N/A',
      cancellationDate: fmtDMYHMS(folio.updated_at),
      cancellationReason: data.remark_cancel_reservation || 'N/A',
    };
  });

  return [{ startDate, endDate, reportData }];
}

function safeParseJson(v: any): any {
  if (v && typeof v === 'object') return v;
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

async function getBirthdayReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const d = new Date(`${date}T00:00:00Z`);
  const startMd = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const endMd = startMd;

  const folios = await prisma.folios.findMany({
    where: { property_id: pid, status_reservation: { in: [STATUS_RESERVATION_CHECK_IN, STATUS_RESERVATION_RESERVATION] }, guest_profile_id: { not: null }, deleted_at: null },
    select: { id: true, folio_number: true, guest_profile_id: true },
  });
  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id))];
  const guests = guestIds.length
    ? await prisma.guest_profiles.findMany({
        where: { id: { in: guestIds } },
        select: { id: true, first_name: true, last_name: true, birth_of_date: true },
      })
    : [];
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const birthIds = guests.filter((g: any) => {
    if (!g.birth_of_date) return false;
    const md = `${String(new Date(g.birth_of_date).getUTCMonth() + 1).padStart(2, '0')}-${String(new Date(g.birth_of_date).getUTCDate()).padStart(2, '0')}`;
    return md >= startMd && md <= endMd;
  }).map((g: any) => g.id);
  const birthSet = new Set(birthIds);

  const reportData = folios
    .filter((f: any) => birthSet.has(f.guest_profile_id))
    .map((f: any) => {
      const guest = guestById.get(f.guest_profile_id);
      return {
        guestName: `${guest?.first_name || ''} ${guest?.last_name || ''}`.trim(),
        dateOfBirth: guest?.birth_of_date
          ? new Date(guest.birth_of_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' })
          : '',
        folioNo: f.folio_number || '',
        roomUnit: 'N/A',
      };
    })
    .sort((a: any, b: any) => a.dateOfBirth.localeCompare(b.dateOfBirth));

  return [{ code: 200, name: 'birthday-report', startDate: startMd, endDate: endMd, reportData }];
}

async function getRoomTypeUtilization(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);
  const monthStart = new Date(`${date.slice(0, 8)}01T00:00:00Z`);
  const yearStart = new Date(`${date.slice(0, 4)}-01-01T00:00:00Z`);

  const roomTypes = await prisma.room_types.findMany({
    where: { property_id: pid, name: { not: { contains: 'VIRTUAL' } }, deleted_at: null },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  const typeIds = roomTypes.map((t: any) => t.id);

  const roomCounts = await prisma.rooms.groupBy({
    by: ['room_type_id'],
    where: { property_id: pid, deleted_at: null, room_type_id: { in: typeIds } },
    _count: { id: true },
  });
  const totalRoomsByType = new Map(roomCounts.map((r: any) => [r.room_type_id, r._count.id]));

const getPeriodStats = async (start: Date, end: Date, isToday: boolean) => {
const reservations = await prisma.reservations.findMany({
      where: {
        property_id: pid,
        room_type_id: { in: typeIds },
        date: { gte: start, lte: end },
        is_posting: 0,
        folios: { is: { status_reservation: { not: STATUS_RESERVATION_CANCEL } } },
      },
      select: { room_type_id: true, data: true },
    });
    const byType: Record<string, { room: number; revenue: number }> = {};
    for (const r of reservations) {
      const key = r.room_type_id ? r.room_type_id.toString() : 'null';
      if (!byType[key]) byType[key] = { room: 0, revenue: 0 };
      byType[key].room++;
      byType[key].revenue += Number(safeParseJson(r.data)?.rate_price ?? 0);
    }
    const days = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
    let totalRoomsAll = 0;
    let totalRoomCount = 0;
    let totalRevenue = 0;
    const statistics = roomTypes.map((t: any) => {
      const s = byType[t.id.toString()] || { room: 0, revenue: 0 };
      const totalRooms = totalRoomsByType.get(t.id) || 0;
      totalRoomsAll += totalRooms;
      totalRoomCount += s.room;
      totalRevenue += s.revenue;
      const percentage = isToday
        ? (totalRooms > 0 ? (s.room / totalRooms) * 100 : 0)
        : (totalRooms * days > 0 ? (s.room / (totalRooms * days)) * 100 : 0);
      return {
        roomType: t.name,
        room: s.room,
        percentage: Number(percentage.toFixed(2)),
        revenue: s.revenue,
        average: s.room > 0 ? s.revenue / s.room : 0,
        totalRooms,
      };
    });
    if (statistics.length) {
      statistics.push({
        roomType: 'TOTAL',
        room: totalRoomCount,
        percentage: Number(((totalRoomsAll > 0 ? (totalRoomCount / totalRoomsAll) * 100 : 0)).toFixed(2)),
        revenue: totalRevenue,
        average: totalRoomCount > 0 ? totalRevenue / totalRoomCount : 0,
        totalRooms: totalRoomsAll,
      });
    }
    return statistics;
  };

  const getSpecialCounts = async (kind: 'complimentary' | 'dayUse' | 'houseUse') => {
    const baseWhere: any = {
      property_id: pid,
      status_reservation: { not: STATUS_RESERVATION_CANCEL },
      deleted_at: null,
    };
    if (kind === 'complimentary') {
      baseWhere.complimentary = true;
      baseWhere.check_in_date = { lte: dayEnd };
      baseWhere.check_out_date = { gt: dayStart };
    } else if (kind === 'houseUse') {
      baseWhere.is_house_use = true;
      baseWhere.check_in_date = { lte: dayEnd };
      baseWhere.check_out_date = { gt: dayStart };
    } else {
      baseWhere.check_in_date = { gte: dayStart, lte: dayEnd };
      baseWhere.check_out_date = { gte: dayStart, lte: dayEnd };
    }
    const folios = await prisma.folios.findMany({
      where: baseWhere,
      select: { id: true, reservations: { where: { date: { gte: dayStart, lte: dayEnd }, room_type_id: { in: typeIds } }, select: { room_type_id: true } } },
    });
    const counts: Record<string, number> = {};
    for (const f of folios) {
      for (const r of f.reservations) {
        const key = r.room_type_id ? r.room_type_id.toString() : 'null';
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return roomTypes
      .map((t: any) => ({ roomType: t.name, count: counts[t.id.toString()] || 0 }))
      .filter((s: any) => s.count > 0);
  };

  const occupiedRooms = await prisma.reservations.count({
    where: {
      property_id: pid,
      room_type_id: { in: typeIds },
      date: { gte: dayStart, lte: dayEnd },
      folios: { is: { status_reservation: { not: STATUS_RESERVATION_CANCEL } } },
    },
  });
  const totalRooms = [...totalRoomsByType.values()].reduce((a, b) => a + b, 0);

  return [{
    date: fmtDMY(dayStart),
    today: await getPeriodStats(dayStart, dayEnd, true),
    monthToDate: await getPeriodStats(monthStart, dayEnd, false),
    yearToDate: await getPeriodStats(yearStart, dayEnd, false),
    complimentary: await getSpecialCounts('complimentary'),
    dayUse: await getSpecialCounts('dayUse'),
    houseUse: await getSpecialCounts('houseUse'),
    totals: { totalRooms, occupiedRooms },
    reportTitle: 'Room Type Utilization',
    startDate: date,
    endDate: date,
  }];
}

async function getInclusiveItems(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      status_reservation: STATUS_RESERVATION_CHECK_IN,
      check_in_date: { lte: dayEnd },
      check_out_date: { gt: dayStart },
      deleted_at: null,
    },
    include: {
      company_profiles_folios_company_profile_idTocompany_profiles: true,
      reservations: { orderBy: { id: 'desc' }, take: 1 },
    },
  });

  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null && v !== undefined))];
  const guests = guestIds.length
    ? await prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } })
    : [];
  const guestById = new Map(guests.map((g: any) => [g.id, g]));

  const rateIds = [...new Set(folios.map((f: any) => f.reservations?.[0]?.rate_id).filter((v: any) => v !== null && v !== undefined))];
  const [rates, rateInclusives] = await Promise.all([
    rateIds.length ? prisma.rates.findMany({ where: { id: { in: rateIds } }, select: { id: true, name: true, code: true } }) : Promise.resolve([] as any[]),
    rateIds.length
      ? prisma.rate_inclusives.findMany({ where: { rate_id: { in: rateIds }, status: 1, deleted_at: null }, select: { id: true, rate_id: true, description: true, frequency: true } })
      : Promise.resolve([] as any[]),
  ]);
  const rateById = new Map(rates.map((r: any) => [r.id, r]));

  const roomIds = [...new Set(folios.map((f: any) => f.reservations?.[0]?.room_id).filter((v: any) => v !== null && v !== undefined))];
  const rooms = roomIds.length ? await prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [];
  const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));

  const reportData: any[] = [];
  for (const folio of folios) {
    const res = folio.reservations?.[0];
    if (!res) continue;
    const rate = rateById.get(res.rate_id);
    const items = rateInclusives.filter((i: any) => i.rate_id === res.rate_id);
    for (const item of items) {
      reportData.push({
        room: roomById.get(res.room_id) || 'N/A',
        folio: folio.folio_number || '',
        name: `${guestById.get(folio.guest_profile_id)?.first_name || ''} ${guestById.get(folio.guest_profile_id)?.last_name || ''}`.trim(),
        company: folio.company_profiles_folios_company_profile_idTocompany_profiles?.name || 'N/A',
        rateCode: rate?.name || 'N/A',
        frequency: item.frequency ?? 'N/A',
        calculator: 'N/A',
        description: item.description ?? 'N/A',
        adult: res.adult ?? 0,
        child: res.child ?? 0,
        arrival_date: fmtDMY(folio.check_in_date).replace(/\/(\d{4})/, '/$1').slice(0, 8) + fmtDMY(folio.check_in_date).slice(8, 10),
        dep_date: fmtDMY(folio.check_out_date).slice(0, 8) + fmtDMY(folio.check_out_date).slice(8, 10),
        status: 1,
      });
    }
  }
  reportData.sort((a: any, b: any) =>
    (a.rateCode || '').localeCompare(b.rateCode || '') ||
    (a.frequency || '').localeCompare(b.frequency || '') ||
    (a.calculator || '').localeCompare(b.calculator || ''));

  return [{
    reportTitle: 'Inclusive Items Report',
    reportDate: fmtDMY(dayStart),
    reportData,
    startDate: date,
    endDate: date,
  }];
}

async function getRateCodeAnalysis(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);

  const reservations = await prisma.reservations.findMany({
    where: { property_id: pid, date: { gte: dayStart, lte: dayEnd }, deleted_at: null },
    include: {
      folios: { include: { company_profiles_folios_company_profile_idTocompany_profiles: true } },
      rates: true,
      room_types: true,
    },
  });

  const roomIds = [...new Set(reservations.map((r: any) => r.room_id).filter((v: any) => v !== null && v !== undefined))];
  const rooms = roomIds.length ? await prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [];
  const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));

  const guestIds = [...new Set(reservations.map((r: any) => r.folios?.guest_profile_id).filter((v: any) => v !== null && v !== undefined))];
  const guests = guestIds.length
    ? await prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } })
    : [];
  const guestById = new Map(guests.map((g: any) => [g.id, g]));

  const grouped: Record<string, any> = {};
  for (const res of reservations) {
    const rateId = res.rate_id ? res.rate_id.toString() : 'null';
    if (!grouped[rateId]) {
      grouped[rateId] = {
        rate_code: res.rates?.code || 'Unknown',
        description: res.rates?.name || 'Unknown Rate',
        folios: [],
        totals: { rooms: 0, nett_rate: 0, ad: 0, ch: 0 },
      };
    }
    const guest = guestById.get(res.folios?.guest_profile_id);
    const netRate = Number(safeParseJson(res.data)?.rate_price ?? 0);
    const folioData = {
      rm: roomById.get(res.room_id) || '',
      rm_type: res.room_types?.name || '',
      folio: res.folios?.folio_number || '',
      guest: guest ? `${guest.first_name || ''} ${guest.last_name || ''}`.trim() : '',
      company_group_name: res.folios?.company_profiles_folios_company_profile_idTocompany_profiles?.name || 'INDIVIDUAL RESERVATION',
      old_rate_code: safeParseJson(res.data)?.old_rate_code ?? '',
      old_rate: safeParseJson(res.data)?.old_rate ?? '',
      override_reason: '',
      nett_rate: netRate,
      ad: res.adult ?? 0,
      ch: res.child ?? 0,
    };
    grouped[rateId].folios.push(folioData);
    grouped[rateId].totals.rooms++;
    grouped[rateId].totals.nett_rate += folioData.nett_rate;
    grouped[rateId].totals.ad += folioData.ad;
    grouped[rateId].totals.ch += folioData.ch;
  }

  const data = Object.values(grouped);
  const reportTotals = data.reduce((acc: any, g: any) => {
    acc.rooms += g.totals.rooms;
    acc.nett_rate += g.totals.nett_rate;
    acc.ad += g.totals.ad;
    acc.ch += g.totals.ch;
    return acc;
  }, { rooms: 0, nett_rate: 0, ad: 0, ch: 0 });
  const averageRoomRate = reportTotals.rooms > 0 ? reportTotals.nett_rate / reportTotals.rooms : 0;

  return [{
    reportTitle: 'Rate Code Analysis',
    businessDate: date,
    data,
    reportTotals,
    averageRoomRate,
    startDate: date,
    endDate: date,
  }];
}

async function getVacantAndDirtyRooms(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const dayEnd = new Date(`${date}T23:59:59Z`);

  const rooms = await prisma.rooms.findMany({
    where: { property_id: pid, room_status: 0, maid_status: 1, deleted_at: null },
    select: { id: true, name: true, room_type_id: true, room_status: true, maid_status: true },
  });
  const roomTypeIds = [...new Set(rooms.map((r: any) => r.room_type_id).filter((v: any) => v !== null && v !== undefined))];
  const [types, roomTypeNames] = await Promise.all([
    roomTypeIds.length ? prisma.types.findMany({ where: { id: { in: roomTypeIds } }, select: { id: true, name: true, group: true } }) : Promise.resolve([] as any[]),
    roomTypeIds.length ? prisma.room_types.findMany({ where: { id: { in: roomTypeIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
  ]);
  const typeById = new Map(types.map((t: any) => [t.id, t]));
  const rtNameById = new Map(roomTypeNames.map((t: any) => [t.id, t.name]));

  const roomIds = rooms.map((r: any) => r.id);
  const roomFolios = roomIds.length
    ? await prisma.folios.findMany({
        where: { status_reservation: 1, property_id: pid, deleted_at: null, reservations: { some: { room_id: { in: roomIds } } } },
        select: { check_out_date: true, reservations: { select: { room_id: true } } },
        orderBy: { check_out_date: 'desc' },
      })
    : [];
  const lastCheckoutById: Map<string, string> = new Map();
  for (const f of roomFolios) {
    for (const r of f.reservations) {
      if (r.room_id && !lastCheckoutById.has(r.room_id.toString())) {
        lastCheckoutById.set(r.room_id.toString(), fmtDMYHMS(f.check_out_date));
      }
    }
  }

  const roomData = rooms.map((room: any) => {
    const building = typeById.get(room.room_type_id)?.group === 'building' ? typeById.get(room.room_type_id) : null;
    const floor = typeById.get(room.room_type_id)?.group === 'floor' ? typeById.get(room.room_type_id) : null;
    return {
      building: building?.name || '',
      building_value: building ? Number(building.id) : '',
      floor: floor?.name || '',
      floor_value: floor ? Number(floor.id) : '',
      room: room.name,
      room_type: rtNameById.get(room.room_type_id) || '',
      room_status: ROOM_STATUS_NAME[room.room_status] ?? 'Unknown',
      maid_status: MAID_STATUS_NAME[room.maid_status] ?? 'Unknown',
      checkout_date_time: lastCheckoutById.get(room.id.toString()) || '',
    };
  });
  roomData.sort((a: any, b: any) =>
    Number(a.building_value || 0) - Number(b.building_value || 0) ||
    Number(a.floor_value || 0) - Number(b.floor_value || 0) ||
    a.room.localeCompare(b.room));

  return [{
    reportTitle: 'Vacant and Dirty Rooms',
    report_date: `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`,
    rooms: roomData,
    total_vacant_rooms: rooms.length,
    total_dirty_rooms: rooms.length,
    startDate: date,
    endDate: date,
  }];
}

async function getDailyRoomForecast(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;

  const rows: any[] = await prisma.$queryRaw`
    WITH RECURSIVE dates AS (
      SELECT DATE(${startDate})::timestamp AS report_date
      UNION ALL
      SELECT report_date + INTERVAL '1 day'
      FROM dates
      WHERE report_date < DATE(${endDate})::timestamp
    ),
    room_count AS (
      SELECT COUNT(id) AS available_rooms
      FROM rooms
      WHERE status = 1
      AND property_id = ${pid}
      AND is_physical = true
    ),
    breakfast_rate AS (
      SELECT
        ri.rate_id,
        ci.calculator,
        SUM(
          ri.cost / (
            CASE
              WHEN cp.service_charge = 0 THEN cp.local_tax_percentage
              WHEN cp.service_charge = 1 AND cp.service_charge_include_local_tax = 0
                THEN cp.local_tax_percentage + cp.service_charge_percentage
              WHEN cp.service_charge = 1 AND cp.service_charge_include_local_tax = 1
                THEN cp.local_tax_percentage + cp.service_charge_percentage + (cp.service_charge_percentage * 0.1)
              ELSE 0
            END + 100
          ) * 100
        ) AS cost
      FROM rate_inclusives ri
      JOIN code_items ci ON ri.stock::bigint = ci.id
      JOIN code_posts cp ON ci.code_post_id = cp.id
      WHERE ci.name ILIKE 'breakfast%'
      GROUP BY ri.rate_id, ci.calculator
    ),
    reservation_base AS (
      SELECT DISTINCT
        r.id AS reservation_id,
        DATE(r.date) AS report_date,
        r.folio_id,
        r.rate_id,
        r.adult,
        r.child,
        r.amount
      FROM reservations r
      WHERE r.property_id = ${pid}
      AND r.rate_id IS NOT NULL
      AND r.date >= DATE(${startDate})::timestamp
      AND r.date < DATE(${endDate})::timestamp + INTERVAL '1 day'
    ),
    reservation_calc AS (
      SELECT
        rb.report_date,
        rb.reservation_id,
        rb.folio_id,
        (rb.adult + rb.child) AS pax,
        CASE
          WHEN br.calculator = 'Adult' THEN rb.adult * COALESCE(br.cost, 0)
          WHEN br.calculator = 'child' THEN rb.child * COALESCE(br.cost, 0)
          WHEN br.calculator = 'room'  THEN COALESCE(br.cost, 0)
          ELSE 0
        END AS breakfast_rev,
        rb.amount AS total_rev,
        rb.amount - CASE
          WHEN br.calculator = 'Adult' THEN rb.adult * COALESCE(br.cost, 0)
          WHEN br.calculator = 'child' THEN rb.child * COALESCE(br.cost, 0)
          WHEN br.calculator = 'room'  THEN COALESCE(br.cost, 0)
          ELSE 0
        END AS room_rev
      FROM reservation_base rb
      LEFT JOIN breakfast_rate br ON rb.rate_id = br.rate_id
    ),
    reservation_daily AS (
      SELECT
        report_date,
        COUNT(DISTINCT reservation_id) AS room_sold,
        SUM(pax) AS pax,
        SUM(breakfast_rev) AS breakfast_rev,
        SUM(total_rev) AS total_rev,
        SUM(room_rev) AS room_rev
      FROM reservation_calc
      GROUP BY report_date
    ),
    folio_base AS (
      SELECT f.id, f.type_reservation, f.parent, f.status_reservation, f.check_in_date, f.check_out_date
      FROM folios f
      WHERE f.property_id = ${pid}
      AND f.status_reservation <> 2
      AND f.check_in_date < DATE(${endDate})::timestamp + INTERVAL '1 day'
      AND f.check_out_date > DATE(${startDate})::timestamp
    ),
    folio_stats AS (
      SELECT
        d.report_date,
        COUNT(CASE WHEN fb.type_reservation = 'fit'
              AND fb.check_in_date >= d.report_date
              AND fb.check_in_date < d.report_date + INTERVAL '1 day' THEN 1 END) AS arrival_fit,
        COUNT(CASE WHEN fb.type_reservation = 'fit'
              AND fb.check_out_date >= d.report_date
              AND fb.check_out_date < d.report_date + INTERVAL '1 day' THEN 1 END) AS departure_fit,
        COUNT(CASE WHEN fb.type_reservation = 'fit'
              AND fb.check_in_date < d.report_date
              AND fb.check_out_date > d.report_date
              AND fb.check_in_date < fb.check_out_date THEN 1 END) AS stay_fit,
        COUNT(CASE WHEN fb.type_reservation = 'git' AND fb.parent IS NOT NULL
              AND fb.check_in_date >= d.report_date
              AND fb.check_in_date < d.report_date + INTERVAL '1 day' THEN 1 END) AS arrival_git,
        COUNT(CASE WHEN fb.type_reservation = 'git' AND fb.parent IS NOT NULL
              AND fb.check_out_date >= d.report_date
              AND fb.check_out_date < d.report_date + INTERVAL '1 day' THEN 1 END) AS departure_git,
        COUNT(CASE WHEN fb.type_reservation = 'git' AND fb.parent IS NOT NULL
              AND fb.check_in_date < d.report_date
              AND fb.check_out_date > d.report_date
              AND fb.check_in_date < fb.check_out_date THEN 1 END) AS stay_git
      FROM dates d
      LEFT JOIN folio_base fb
        ON fb.check_in_date < d.report_date + INTERVAL '1 day'
        AND fb.check_out_date > d.report_date
      GROUP BY d.report_date
    ),
    rms_held AS (
      SELECT
        d.report_date,
        COUNT(DISTINCT fb.id) AS rms_held
      FROM dates d
      LEFT JOIN folio_base fb
        ON fb.status_reservation = 0
        AND fb.check_in_date <= d.report_date
        AND fb.check_out_date > d.report_date
      GROUP BY d.report_date
    ),
    work_order_stats AS (
      SELECT
        d.report_date,
        COUNT(wo.id) AS total_work_orders
      FROM dates d
      LEFT JOIN work_orders wo
        ON wo.property_id = ${pid}
        AND wo.room_id IS NOT NULL
        AND wo.deleted_by IS NULL
        AND wo.date <= d.report_date
        AND (wo.end_date >= d.report_date OR wo.end_date IS NULL)
      GROUP BY d.report_date
    )
    SELECT
      d.report_date AS "date",
      COALESCE(rd.pax, 0) AS "non-grp pax",
      COALESCE(fs.arrival_fit, 0) AS "non-grp arriv",
      COALESCE(fs.departure_fit, 0) AS "non-grp dept",
      COALESCE(fs.stay_fit, 0) AS "non-grp sty",
      COALESCE(fs.arrival_git, 0) AS "grp arriv",
      COALESCE(fs.departure_git, 0) AS "grp dept",
      COALESCE(fs.stay_git, 0) AS "grp sty",
      COALESCE(rh.rms_held, 0) + COALESCE(wos.total_work_orders, 0) AS "rms held",
      CASE
        WHEN (rcount.available_rooms - COALESCE(rh.rms_held, 0)) <= 0 THEN 0
        ELSE ROUND(
          COALESCE(rd.room_sold, 0)
          / (rcount.available_rooms - COALESCE(rh.rms_held, 0)) * 100, 2
        )
      END AS "occ%",
      COALESCE(rd.room_rev, 0) AS "room rev",
      COALESCE(rd.breakfast_rev, 0) AS "breakfast rev",
      COALESCE(rd.total_rev, 0) AS "total rev",
      CASE WHEN COALESCE(rd.room_sold, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(rd.room_rev, 0) / rd.room_sold, 2) END AS "arr room",
      CASE WHEN COALESCE(rd.room_sold, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(rd.total_rev, 0) / rd.room_sold, 2) END AS "arr",
      CASE WHEN COALESCE(rd.pax, 0) = 0 THEN 0
        ELSE ROUND(COALESCE(rd.breakfast_rev, 0) / rd.pax, 2) END AS "arr bf"
    FROM dates d
    LEFT JOIN reservation_daily rd ON rd.report_date = d.report_date
    LEFT JOIN folio_stats fs ON fs.report_date = d.report_date
    LEFT JOIN rms_held rh ON rh.report_date = d.report_date
    LEFT JOIN work_order_stats wos ON wos.report_date = d.report_date
    CROSS JOIN room_count rcount
    ORDER BY d.report_date`;

  const reportData = rows.map((row: any) => ({
    date: `${formatDate(row.date).split('-').reverse().join('.')} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(row.date).getUTCDay()]}`,
    nonGrp: { pax: Number(row['non-grp pax']), arr: Number(row['non-grp arriv']), dep: Number(row['non-grp dept']), sty: Number(row['non-grp sty']) },
    grp: { arr: Number(row['grp arriv']), dep: Number(row['grp dept']), sty: Number(row['grp sty']) },
    rmsHeld: Number(row['rms held']),
    occPercentage: Number(Number(row['occ%']).toFixed(2)),
    roomRev: Number(Number(row['room rev']).toFixed(2)),
    breakfastRev: Number(Number(row['breakfast rev']).toFixed(2)),
    totalRev: Number(Number(row['total rev']).toFixed(2)),
    arrRoom: Number(Number(row['arr room']).toFixed(2)),
    arrBf: Number(Number(row['arr bf']).toFixed(2)),
    arr: Number(Number(row['arr']).toFixed(2)),
  }));

  return [{
    reportTitle: 'Daily Room Forecast',
    startDate,
    endDate,
    reportData,
  }];
}

const STATUS_RESERVATION_NAMES: Record<number, string> = {
  0: 'Check In',
  1: 'Check Out',
  2: 'Cancel Reservation',
  3: 'Reservation',
  4: 'In House',
  5: 'Pending',
};

async function getBreakfastReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);

  const isBreakfastLike = (name: string) => (name || '').toLowerCase().includes('breakfast');

  const breakfastCodeItemIds = await prisma.code_items.findMany({
    where: { property_id: pid, name: { contains: 'breakfast', mode: 'insensitive' } },
    select: { id: true },
  });
  const breakfastItemIds = breakfastCodeItemIds.map((c: any) => c.id);

  const [reservations, inclusiveReservations] = await Promise.all([
    prisma.reservations.findMany({
      where: {
        property_id: pid,
        date: { gte: dayStart, lte: dayEnd },
        folios: { is: { status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] }, type_reservation: { in: ['git', 'fit'] } } },
      },
      include: {
        folios: { include: { company_profiles_folios_company_profile_idTocompany_profiles: true } },
        rates: { include: { rate_inclusives: { where: { status: 1, deleted_at: null } } } },
      },
    }),
    prisma.reservations.findMany({
      where: {
        property_id: pid,
        date: { gte: dayStart, lte: dayEnd },
        rates: { is: { rate_inclusives: { some: { status: 1, deleted_at: null } } } },
        folios: { is: { status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] }, type_reservation: { in: ['git', 'fit'] } } },
      },
      include: {
        folios: { include: { company_profiles_folios_company_profile_idTocompany_profiles: true } },
        rates: { include: { rate_inclusives: { where: { status: 1, deleted_at: null } } } },
      },
    }),
  ]);

  const roomIds = [...new Set([...reservations, ...inclusiveReservations].map((r: any) => r.room_id).filter((v: any) => v !== null && v !== undefined))];
  const rooms = roomIds.length ? await prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [];
  const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));

  const itemIds = breakfastItemIds.length ? breakfastItemIds : [0n];
  const codeItems = await prisma.code_items.findMany({
    where: { id: { in: itemIds } },
    include: { code_posts: true },
  });
  const codeItemById = new Map(codeItems.map((c: any) => [c.id, c]));

  const folioIds = [...new Set(reservations.map((r: any) => r.folio_id))];
  const mhci = folioIds.length
    ? await prisma.$queryRaw<{ model_id: bigint; code_item_id: bigint; sales: string | null; upsales: string | null }[]>`
        SELECT model_id, code_item_id, sales, upsales
        FROM model_has_code_items
        WHERE model_type = 'App\Models\Folio'
          AND model_id = ANY(${folioIds})
          AND code_item_id = ANY(${itemIds})`
    : [];
  const mhciKey = new Set(mhci.map((m: any) => `${m.model_id}:${m.code_item_id}`));

  const calcSales = (m: any, ci: any) => {
    if (!m) return Number(ci.sales ?? 0);
    const upsales = Number(m.upsales ?? 0);
    return upsales > 0 ? upsales : Number(m.sales ?? 0);
  };

  let additionalAdults = 0;
  let additionalChildren = 0;
  let additionalRooms = 0;
  let additionalnumberOfFolio = 0;
  let additionaltotalSales = 0;
  const additionalBreakfast: any[] = [];

  for (const res of reservations) {
    const folio: any = res.folios;
    if (!folio) continue;
    let isCounterRoom = false;
    for (const m of mhci.filter((mm: any) => mm.model_id === res.folio_id)) {
      const ci = codeItemById.get(m.code_item_id);
      if (!ci || !isBreakfastLike(ci.code_posts?.name)) continue;
      if (ci.calculator === 'Room') additionalRooms++;
      isCounterRoom = true;
      additionalBreakfast.push({
        Room: roomById.get(res.room_id) || '',
        Folio: folio.folio_number || '',
        Name: folio.first_name || folio.last_name ? `${folio.first_name || ''} ${folio.last_name || ''}`.trim() : (folio.account || ''),
        Company: folio.company_name !== '' ? (folio.company_profiles_folios_company_profile_idTocompany_profiles?.name || '') : '',
        Description: ci.name || '',
        Adult: res.adult ?? 0,
        Child: res.child ?? 0,
        'Arrival Date': fmtDMY(folio.check_in_date).slice(0, 8),
        'Dep.Date': fmtDMY(folio.check_out_date).slice(0, 8),
        Status: STATUS_RESERVATION_NAMES[folio.status_reservation] ?? 'Unknown',
        Frequency: ci.frequency || 'Daily',
        sales: calcSales(m, ci),
      });
      additionaltotalSales += calcSales(m, ci);
    }
    additionalAdults += res.adult ?? 0;
    additionalChildren += res.child ?? 0;
    if (isCounterRoom) additionalnumberOfFolio++;
  }

  let inclusiveAdults = 0;
  let inclusiveChildren = 0;
  let inclusiveRooms = 0;
  let inclusivenumberOfFolio = 0;
  let inclusivetotalSales = 0;
  const inclusiveBreakfast: any[] = [];

  const inclusiveStockIds = [...new Set(inclusiveReservations.flatMap((r: any) => r.rates?.rate_inclusives ?? []).map((ri: any) => ri.stock).filter(Boolean))];
  const stockItems = inclusiveStockIds.length
    ? await prisma.code_items.findMany({ where: { id: { in: inclusiveStockIds.map((s: string) => BigInt(s)) } }, include: { code_posts: true } })
    : [];
  const stockItemById = new Map(stockItems.map((c: any) => [c.id, c]));

  const calcInclusiveCost = (ri: any, res: any) => {
    const ci = stockItemById.get(ri.stock ? BigInt(ri.stock) : -1n);
    if (!ci) return 0;
    const cost = Number(ri.cost ?? 0);
    const calc = (ci.calculator || '').toLowerCase();
    if (calc === 'adult') return cost * (res.adult ?? 0);
    if (calc === 'child') return cost * (res.child ?? 0);
    return cost;
  };

  for (const res of inclusiveReservations) {
    const folio: any = res.folios;
    if (!folio || !res.rates?.rate_inclusives?.length) continue;
    let isCounterRoom = false;
    for (const ri of res.rates.rate_inclusives) {
      const ci = stockItemById.get(ri.stock ? BigInt(ri.stock) : -1n);
      if (!ci || !isBreakfastLike(ci.code_posts?.name)) continue;
      if ((ci.calculator || '').toLowerCase() === 'room') inclusiveRooms++;
      isCounterRoom = true;
      const sales = calcInclusiveCost(ri, res);
      inclusiveBreakfast.push({
        Room: roomById.get(res.room_id) || '',
        Folio: folio.folio_number || '',
        Name: folio.first_name || folio.last_name ? `${folio.first_name || ''} ${folio.last_name || ''}`.trim() : (folio.account || ''),
        Company: folio.company_name !== '' ? (folio.company_profiles_folios_company_profile_idTocompany_profiles?.name || '') : '',
        Description: `${ci.name || ''} ( ${ri.description || ''} )`,
        Adult: res.adult ?? 0,
        Child: res.child ?? 0,
        'Arrival Date': fmtDMY(folio.check_in_date).slice(0, 8),
        'Dep.Date': fmtDMY(folio.check_out_date).slice(0, 8),
        Status: STATUS_RESERVATION_NAMES[folio.status_reservation] ?? 'Unknown',
        Frequency: ri.frequency || 'Daily',
        sales,
      });
      inclusivetotalSales += sales;
    }
    inclusiveAdults += res.adult ?? 0;
    inclusiveChildren += res.child ?? 0;
    if (isCounterRoom) inclusivenumberOfFolio++;
  }

  return [{
    businessDate: `${date.split('-').reverse().join('-')}(${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(dayStart).getUTCDay()]})`,
    additionalBreakfast,
    additionalAdults,
    additionalChildren,
    additionalRooms,
    additionaltotalSales,
    additionalnumberOfFolio,
    inclusiveBreakfast,
    inclusiveAdults,
    inclusiveChildren,
    inclusiveRooms,
    inclusivetotalSales,
    inclusivenumberOfFolio,
    reportTitle: 'Breakfast Report',
    startDate: date,
    endDate: date,
  }];
}

async function getRoomRevenueBreakdown(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      type_reservation: { not: 'vr' },
      status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] },
      deleted_at: null,
      reservations: { some: { date: { gte: dayStart, lte: dayEnd } } },
    },
    include: {
      company_profiles_folios_company_profile_idTocompany_profiles: true,
      reservations: { where: { date: { gte: dayStart, lte: dayEnd } }, include: { rates: { include: { rate_inclusives: { where: { status: 1, deleted_at: null } } } } } },
    },
  });

  const roomIds = [...new Set(folios.flatMap((f: any) => f.reservations.map((r: any) => r.room_id)).filter((v: any) => v !== null && v !== undefined))];
  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null && v !== undefined))];
  const folioTypeIds = [...new Set(folios.map((f: any) => f.id))];
  const [rooms, guests, mht, stockItems] = await Promise.all([
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : Promise.resolve([] as any[]),
    folioTypeIds.length ? prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\Folio', model_id: { in: folioTypeIds } } }) : Promise.resolve([] as any[]),
    prisma.code_items.findMany({ include: { code_posts: true } }),
  ]);
  const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const stockItemById = new Map(stockItems.map((c: any) => [c.id, c]));
  const typeIds = [...new Set(mht.map((m: any) => m.type_id))];
  const types = typeIds.length ? await prisma.types.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true, group: true } }) : [];
  const typeById = new Map(types.map((t: any) => [t.id, t]));

  const breakdownCost = (ri: any, res: any) => {
    const ci = ri.stock ? stockItemById.get(BigInt(ri.stock)) : null;
    if (!ci) return 0;
    const cost = Number(ri.cost ?? 0);
    const calc = (ci.calculator || '').toLowerCase();
    if (calc === 'room') return cost;
    if (calc === 'adult') return cost * (res.adult ?? 0);
    if (calc === 'child') return cost * (res.child ?? 0);
    return cost;
  };

  let totalRate = 0;
  const reportData: any[] = [];
  for (const folio of folios) {
    const res = folio.reservations?.[0];
    if (!res) continue;
    const inclusives = res.rates?.rate_inclusives ?? [];
    const calcGroup = (needle: string) => inclusives
      .filter((ri: any) => {
        const ci = ri.stock ? stockItemById.get(BigInt(ri.stock)) : null;
        const name = (ci?.code_posts?.name || '').toLowerCase();
        return needle === '' ? !['breakfast', 'lunch', 'dinner'].some((k) => name.includes(k)) : name.includes(needle);
      })
      .reduce((sum: number, ri: any) => sum + breakdownCost(ri, res), 0);

    const breakfast = calcGroup('breakfast');
    const lunch = calcGroup('lunch');
    const dinner = calcGroup('dinner');
    const other = calcGroup('');
    const addBed = Number(res.total_extra_bed ?? 0);
    const rate = Number(res.total ?? 0);
    totalRate += rate;

    const typesForFolio = mht.filter((m: any) => m.model_id === folio.id).map((m: any) => typeById.get(m.type_id)).filter(Boolean);
    const segmentation = typesForFolio.find((t: any) => t.group === 'market-segment-1');
    const source = typesForFolio.find((t: any) => t.group === 'source');
    const guest = guestById.get(folio.guest_profile_id);

    reportData.push({
      folio: folio.folio_number || '',
      unit: roomById.get(res.room_id) || 'N/A',
      rateCode: res.rates?.code || 'N/A',
      rate,
      room: rate - (breakfast + lunch + dinner + other),
      addBed,
      breakfast,
      lunch,
      dinner,
      other,
      arrival: fmtDMY(folio.check_in_date),
      departure: fmtDMY(folio.check_out_date),
      guestName: `${guest?.first_name || ''} ${guest?.last_name || ''}`.trim(),
      company: folio.company_profiles_folios_company_profile_idTocompany_profiles?.name || 'N/A',
      segmentation: segmentation?.name || 'N/A',
      source: source?.name || 'N/A',
    });
  }
  reportData.sort((a: any, b: any) => (a.unit || '').localeCompare(b.unit || ''));

  return [{
    reportTitle: 'Room Revenue Breakdown',
    reportDate: `${date.slice(8, 10)}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(date.slice(5, 7)) - 1]}-${date.slice(0, 4)}`,
    breakdowns: reportData,
    totalRate,
    currentPage: 1,
    totalPages: 1,
    startDate: date,
    endDate: date,
  }];
}

async function getCommissionForBooking(params: any, byCompany: boolean): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || (byCompany ? addDays(startDate, 30) : startDate);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      booking_agent_id: { not: null },
      check_in_date: { gte: start, lte: end },
      deleted_at: null,
    },
    include: {
      company_profiles_folios_booking_agent_idTocompany_profiles: true,
      company_profiles_folios_company_profile_idTocompany_profiles: true,
      reservations: { select: { data: true } },
    },
  });

  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null && v !== undefined))];
  const guests = guestIds.length
    ? await prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } })
    : [];
  const guestById = new Map(guests.map((g: any) => [g.id, g]));

  const grouped: Record<string, any> = {};
  for (const folio of folios) {
    const agent: any = folio.company_profiles_folios_booking_agent_idTocompany_profiles;
    const company: any = folio.company_profiles_folios_company_profile_idTocompany_profiles;
    const agentId = folio.booking_agent_id?.toString() ?? 'null';
    const key = byCompany ? `${agentId}-${folio.company_profile_id?.toString() ?? 'null'}` : agentId;

    if (!grouped[key]) {
      grouped[key] = {
        agentInfo: {
          name: agent?.name || 'N/A',
          commissionRate: Number(agent?.commission_rate ?? 0),
          accountNo: agent?.account || 'N/A',
          businessReg: agent?.IATA || 'N/A',
          address: agent?.billing_address || 'N/A',
          city: '',
          country: '',
          postalCode: agent?.billing_postal_code || '',
        },
        companyInfo: byCompany ? {
          name: company?.name || 'N/A',
          accountNo: company?.account || 'N/A',
          address: company?.billing_address || 'N/A',
          city: '',
          country: '',
          postalCode: company?.billing_postal_code || '',
        } : undefined,
        folios: [],
        totalCharges: 0,
        totalCommission: 0,
      };
    }
    if (byCompany) {
      grouped[key].companyInfo = {
        name: company?.name || 'N/A',
        accountNo: company?.account || 'N/A',
        address: company?.billing_address || 'N/A',
        city: '',
        country: '',
        postalCode: company?.billing_postal_code || '',
      };
    }

    const charges = folio.reservations.reduce((sum: number, r: any) => sum + Number(safeParseJson(r.data)?.rate_price ?? 0), 0);
    const commissionPercentage = Number(agent?.commission_rate ?? 0);
    const payableCommission = charges * (commissionPercentage / 100);
    const guest = guestById.get(folio.guest_profile_id);

    grouped[key].folios.push({
      folioNo: folio.folio_number || '',
      checkInDate: fmtDMY(folio.check_in_date),
      checkOutDate: fmtDMY(folio.check_out_date),
      guestName: guest ? `${guest.first_name || ''} ${guest.last_name || ''}`.trim() : 'N/A',
      charges,
      payableCommission,
    });
    grouped[key].totalCharges += charges;
    grouped[key].totalCommission += payableCommission;
  }

  return [{
    reportTitle: byCompany
      ? 'Commission For Booking Agent By Company Report'
      : 'Commission For Booking Agent Report',
    reportStartDate: fmtDMY(start),
    reportEndDate: fmtDMY(end),
    groupedData: grouped,
    currentPage: 1,
    totalPages: 1,
    startDate,
    endDate,
  }];
}

async function getTaxBreakdownSummary(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  const rows = await prisma.transaction_breakdowns.groupBy({
    by: ['code'],
    where: { property_id: pid, date: { gte: start, lte: end } },
    _sum: { amount: true, pb1: true, svr_chrg: true, surcharge: true, total: true },
  });
  const sign = (typeAmount: string | null, val: any) =>
    typeAmount === 'PLUS' ? Number(val ?? 0) : -Number(val ?? 0);

  const codeIds = [...new Set(rows.map((r: any) => r.code).filter(Boolean))];
  const codePosts = codeIds.length
    ? await prisma.code_posts.findMany({ where: { id: { in: codeIds.map((c: string) => BigInt(c)) } }, include: { code_billings: true } })
    : [];
  const codePostById = new Map(codePosts.map((c: any) => [c.id, c]));

  const rawTransactions = await prisma.transaction_breakdowns.findMany({
    where: { property_id: pid, date: { gte: start, lte: end } },
    select: { code: true, type_amount: true, amount: true, pb1: true, svr_chrg: true, surcharge: true, total: true },
  });
  const byCode: Record<string, any> = {};
  for (const t of rawTransactions) {
    const key = t.code ?? 'null';
    if (!byCode[key]) byCode[key] = { amount: 0, pb1: 0, svc: 0, surcharge: 0, total: 0 };
    byCode[key].amount += sign(t.type_amount, t.amount);
    byCode[key].pb1 += sign(t.type_amount, t.pb1);
    byCode[key].svc += sign(t.type_amount, t.svr_chrg);
    byCode[key].surcharge += sign(t.type_amount, t.surcharge);
    byCode[key].total += sign(t.type_amount, t.total);
  }

  const grouped: Record<string, any> = {};
  for (const [key, val] of Object.entries(byCode)) {
    const cp = codePostById.get(key === 'null' ? -1n : BigInt(key));
    const billingName = cp?.code_billings?.name ?? 'Other Revenue';
    if (!grouped[billingName]) {
      grouped[billingName] = {
        name: billingName,
        postCodes: [],
        totals: { amount: 0, pb1: 0, svc: 0, surcharge: 0, total: 0 },
      };
    }
    const postCodeData = {
      name: cp?.name || 'Unknown',
      amount: val.amount,
      pb1: val.pb1,
      svc: val.svc,
      surcharge: val.surcharge,
      total: val.total,
    };
    grouped[billingName].postCodes.push(postCodeData);
    grouped[billingName].totals.amount += val.amount;
    grouped[billingName].totals.pb1 += val.pb1;
    grouped[billingName].totals.svc += val.svc;
    grouped[billingName].totals.surcharge += val.surcharge;
    grouped[billingName].totals.total += val.total;
  }

  const grandTotals = { amount: 0, pb1: 0, svc: 0, surcharge: 0, total: 0 };
  const reportData = Object.values(grouped).map((b: any) => {
    grandTotals.amount += b.totals.amount;
    grandTotals.pb1 += b.totals.pb1;
    grandTotals.svc += b.totals.svc;
    grandTotals.surcharge += b.totals.surcharge;
    grandTotals.total += b.totals.total;
    return b;
  });

  const paymentRows = await prisma.transaction_breakdowns.groupBy({
    by: ['type_payment_id'],
    where: { property_id: pid, date: { gte: start, lte: end }, type_amount: 'MINUS' },
    _sum: { total: true },
  });
  const paymentIds = [...new Set(paymentRows.map((p: any) => p.type_payment_id).filter(Boolean))];
  const typePayments = paymentIds.length
    ? await prisma.type_payments.findMany({ where: { id: { in: paymentIds } }, select: { id: true, name: true } })
    : [];
  const tpById = new Map(typePayments.map((t: any) => [t.id, t.name]));
  const paymentData = paymentRows.map((p: any) => ({
    payment_type: tpById.get(p.type_payment_id) || 'Unknown',
    total: Math.abs(Number(p._sum.total ?? 0)),
  }));
  const totalPayment = paymentData.reduce((s: number, p: any) => s + p.total, 0);

  return [{
    reportTitle: 'Tax Breakdown Summary',
    reportData,
    grandTotals,
    paymentData,
    startDate,
    endDate,
    totalPayment,
  }];
}

async function getInHouseFolioBalHistory(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const dayEnd = new Date(`${date}T23:59:59Z`);

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      status_reservation: STATUS_RESERVATION_CHECK_IN,
      is_virtual: false,
      deleted_at: null,
      check_in_date: { lte: dayEnd },
      check_out_date: { gte: new Date(`${date}T00:00:00Z`) },
      reservations: { some: { room_id: { not: null } } },
    },
    include: {
      company_profiles_folios_company_profile_idTocompany_profiles: true,
      // Laravel lastReservation(): oldest non-posting (date asc)
      reservations: { orderBy: [{ date: 'asc' }, { id: 'asc' }], include: { room_types: true, rates: true } },
    },
  });

  const roomIds = [...new Set(folios.map((f: any) => f.reservations?.find((r: any) => r.is_posting === 0)?.room_id).filter((v: any) => v !== null && v !== undefined))];
  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null && v !== undefined))];
  const parentIds = [...new Set(folios.filter((f: any) => f.type_reservation === 'git' && f.parent && Number(f.parent) !== 0).map((f: any) => f.parent as bigint))];
  const [rooms, guests, parents] = await Promise.all([
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds }, deleted_at: null }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : Promise.resolve([] as any[]),
    parentIds.length ? prisma.folios.findMany({ where: { id: { in: parentIds } }, select: { id: true, company_profiles_folios_company_profile_idTocompany_profiles: { select: { id: true, name: true, credit_limit: true } } } }) : Promise.resolve([] as any[]),
  ]);
  const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const parentById = new Map(parents.map((p: any) => [p.id, p]));

  const folioIds = folios.map((f: any) => f.id);
  const txns = folioIds.length
    ? await prisma.transactions.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null }, select: { folio_id: true, model_type: true, type_amount: true, total: true } })
    : [];
  // Laravel getBalance: parent GIT adds child folio (status != cancel) CompanyProfile transactions
  const childFolios = folioIds.length
    ? await prisma.folios.findMany({ where: { parent: { in: folioIds }, status_reservation: { not: STATUS_RESERVATION_CANCEL } }, select: { id: true, parent: true } })
    : [];
  const childTxns = childFolios.length
    ? await prisma.transactions.findMany({ where: { folio_id: { in: childFolios.map((c: any) => c.id) }, model_type: 'App\\Models\\CompanyProfile', deleted_at: null }, select: { folio_id: true, type_amount: true, total: true } })
    : [];
  const childByParent = new Map<string, bigint[]>();
  for (const c of childFolios) {
    const key = String(c.parent);
    if (!childByParent.has(key)) childByParent.set(key, []);
    childByParent.get(key)!.push(c.id);
  }
  const sumSignedTx = (list: any[]) => list.reduce((s: number, t: any) => s + (t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0)), 0);
  const balanceOf = (folio: any, ownTxns: any[]) => {
    const isParentGit = String(folio.type_reservation).toLowerCase() === 'git' && Number(folio.parent || 0) === 0;
    const isSubGit = String(folio.type_reservation).toLowerCase() === 'git' && Number(folio.parent || 0) !== 0;
    if (isParentGit) {
      const childIds = childByParent.get(folio.id.toString()) || [];
      const childSum = sumSignedTx(childTxns.filter((t: any) => childIds.includes(t.folio_id)));
      return sumSignedTx(ownTxns) + childSum;
    }
    if (isSubGit) return sumSignedTx(ownTxns.filter((t: any) => t.model_type === 'App\\Models\\GuestProfile'));
    return sumSignedTx(ownTxns);
  };

  const grouped: Record<string, any> = {};
  let grandTotal = 0;
  for (const folio of folios) {
    // Laravel lastReservation(): oldest non-posting reservation
    const res = (folio.reservations || []).find((r: any) => r.is_posting === 0);
    if (!res || !roomById.get(res.room_id)) continue;
    const isSubGit = folio.type_reservation === 'git' && folio.parent && Number(folio.parent) !== 0;
    const parent = isSubGit ? parentById.get(folio.parent as bigint) : null;
    const company: any = parent?.company_profiles_folios_company_profile_idTocompany_profiles || folio.company_profiles_folios_company_profile_idTocompany_profiles;
    const companyId = parent?.company_profiles_folios_company_profile_idTocompany_profiles?.id?.toString()
      || folio.company_profiles_folios_company_profile_idTocompany_profiles?.id?.toString()
      || 'unknown';
    const companyName = parent?.company_profiles_folios_company_profile_idTocompany_profiles?.name
      || folio.company_profiles_folios_company_profile_idTocompany_profiles?.name
      || 'Unknown';

    const balance = balanceOf(folio, txns.filter((t: any) => t.folio_id === folio.id));
    grandTotal += balance;
    if (!grouped[companyId]) {
      grouped[companyId] = { company_name: companyName, folios: [], total_balance: 0, credit_limit: Number(company?.credit_limit ?? 0) };
    }
    grouped[companyId].total_balance += balance;
    grouped[companyId].folios.push({
      folio: folio.folio_number || '',
      room_type: res.room_types?.name || '',
      room: roomById.get(res.room_id) || '',
      guest: guestById.get(folio.guest_profile_id) ? `${guestById.get(folio.guest_profile_id)?.first_name || ''} ${guestById.get(folio.guest_profile_id)?.last_name || ''}`.trim() : '',
      group_name: companyName,
      arrival: fmtDMY(folio.check_in_date),
      departure: fmtDMY(folio.check_out_date),
      rate_code: res.rates?.name || '',
      balance,
    });
  }

  const reportData = Object.values(grouped).filter((g: any) => g.folios.length);
  return [{
    reportTitle: 'In House Folio Balances',
    reportDate: new Date(dayEnd).toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' }),
    reportData,
    grandTotal,
    startDate: date,
    endDate: date,
  }];
}

async function getTransactionReportByStaff(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const staffId = params.staffId || 'all';
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);

  const billingCodes = await prisma.code_billings.findMany({
    where: { property_id: pid, status: 1, deleted_at: null },
    include: { code_posts: { where: { deleted_at: null } } },
    orderBy: { id: 'asc' },
  });

  const reportData: any[] = [];
  for (const billingCode of billingCodes) {
    const billingData: any = { name: billingCode.name, transactions: [], total: 0 };
    for (const postCode of billingCode.code_posts) {
      const where: any = {
        property_id: pid,
        code: postCode.id.toString(),
        date: { gte: dayStart, lte: dayEnd },
        deleted_at: null,
      };
      if (staffId === 'system') {
        where.type = { in: ['room_revenue', 'additional_item'] };
      } else if (staffId !== 'all') {
        where.created_by = BigInt(staffId);
      }
      const transactions = await prisma.transactions.findMany({
        where,
        include: { folios: { include: { reservations: { orderBy: { date: 'desc' }, take: 1 } } } },
      });
      if (!transactions.length) continue;

      const codeItemIds = [...new Set(transactions.map((t: any) => t.code_item_id).filter((v: any) => v !== null && v !== undefined))];
      const codeItems = codeItemIds.length ? await prisma.code_items.findMany({ where: { id: { in: codeItemIds } }, select: { id: true, name: true } }) : [];
      const codeItemById = new Map(codeItems.map((c: any) => [c.id, c.name]));

      const shiftInfo = /^\d+$/.test(staffId)
        ? (async () => {
            const latestShift = await prisma.shifts.findFirst({ where: { user_id: BigInt(staffId), property_id: pid }, orderBy: { id: 'desc' } });
            return latestShift ? `${String(Number(latestShift.id)).padStart(8, '0')} (${latestShift.start ? formatDate(latestShift.start).slice(0, 5) : ''})`.replace('(', ' (') : '00000000 (-)';
          })()
        : `${staffId.toUpperCase()} (-)`;

      const guestIds = [...new Set(transactions.map((t: any) => t.folios?.guest_profile_id).filter((v: any) => v !== null && v !== undefined))];
      const guests = guestIds.length ? await prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : [];
      const guestById = new Map(guests.map((g: any) => [g.id, g]));
      const roomIds = [...new Set(transactions.map((t: any) => t.folios?.reservations?.[0]?.room_id).filter((v: any) => v !== null && v !== undefined))];
      const rooms = roomIds.length ? await prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [];
      const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));

      const postCodeData: any = { name: postCode.name, shift: await shiftInfo, items: [], total: 0 };
      for (const t of transactions) {
        const folio: any = t.folios;
        const guest = guestById.get(folio?.guest_profile_id);
        const roomName = roomById.get(folio?.reservations?.[0]?.room_id) || '';
        const itemCodeName = codeItemById.get(t.code_item_id) || '';
        const folioNumber = folio?.folio_number || 'N/A';
        let description = '';
        if (String(t.type).toUpperCase() === 'ROOM_REVENUE') {
          description = `Room Charge - ${folioNumber}`;
        } else if (t.type === 'extra_bed') {
          description = `Extra Bed - ${folioNumber}`;
        } else if (['manual_posting', 'additional_item', 'room_inclusive', 'extra_bed_inclusive'].includes(t.type as string)) {
          description = `${folioNumber}${itemCodeName ? ` - ${itemCodeName}` : ''} - ${t.remark ?? ''}`;
        } else if (t.is_transfer === 1 || t.is_transfer === 2) {
          description = `${(t.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} ${t.remark ?? ''}`;
        } else {
          description = `${(t.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} - ${folioNumber}`;
        }
        postCodeData.items.push({
          folio: folioNumber,
          room: roomName,
          guest: guest ? `${guest.first_name || ''} ${guest.last_name || ''}`.trim() : '',
          post_date: t.created_at ? `${fmtDMY(t.created_at).slice(0, 2)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(t.created_at).getUTCMonth()]} ${new Date(t.created_at).getUTCFullYear()} ${String(new Date(t.created_at).getUTCHours()).padStart(2, '0')}:${String(new Date(t.created_at).getUTCMinutes()).padStart(2, '0')}:${String(new Date(t.created_at).getUTCSeconds()).padStart(2, '0')}` : '',
          description,
          card_name: t.card_name || '',
          last_digit_card: String(t.last_digit_card || 0).padStart(4, '0'),
          total: t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0),
        });
        postCodeData.total += t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0);
      }
      if (postCodeData.items.length) {
        billingData.transactions.push(postCodeData);
        billingData.total += postCodeData.total;
      }
    }
    if (billingData.transactions.length) {
      reportData.push(billingData);
    }
  }

  const staffName = /^\d+$/.test(staffId)
    ? (await prisma.users.findUnique({ where: { id: BigInt(staffId) }, select: { name: true } }))?.name
    : (staffId === 'system' ? 'SYSTEM' : 'ALL STAFF');

  return [{
    reportData,
    date: `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(dayStart).getUTCDay()]}, ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(dayStart).getUTCMonth()]} ${String(new Date(dayStart).getUTCDate()).padStart(2, '0')}, ${date.slice(0, 4)}`,
    staffName,
    printDate: fmtDMYHMS(new Date()),
  }];
}

async function getAsyncJobReport(name: string, params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const date = startDate;
  const kurs = params.kurs || params.exchangeRate || '';
  try {
    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(`${date}T23:59:59Z`);
    const d = new Date(`${date}T00:00:00Z`);
    const monthStart = new Date(`${date.slice(0, 8)}01T00:00:00Z`);
    const yearStart = new Date(`${date.slice(0, 4)}-01-01T00:00:00Z`);
    const lastMonthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const lastMonthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()));

    const roomTypes = (await prisma.room_types.findMany({
      where: { property_id: pid, deleted_at: null },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    })).filter((t: any) => !t.name.toUpperCase().includes('VIRTUAL'));
    const typeIds = roomTypes.map((t: any) => t.id);

    const countResv = (s: Date, e: Date, typeId?: bigint) => prisma.reservations.count({
      where: { property_id: pid, date: { gte: s, lte: e }, deleted_at: null, ...(typeId ? { room_type_id: typeId } : {}) },
    });
    const [totalRooms, blockedRooms, todaySold, mtdSold, lastMonthSold, ytdSold, houseUse, complimentary, walkIn, dayUse, inHouseGuests, todayOccupied, mtdOccupied, lastMonthOccupied, ytdOccupied, todayRevenue, mtdRevenue, lastMonthRevenue, ytdRevenue] = await Promise.all([
      prisma.rooms.count({ where: { property_id: pid, status: 1, deleted_at: null } }),
      prisma.rooms.count({ where: { property_id: pid, room_status: 2, deleted_at: null } }),
      countResv(dayStart, dayEnd),
      countResv(monthStart, dayEnd),
      countResv(lastMonthStart, lastMonthEnd),
      countResv(yearStart, dayEnd),
      prisma.folios.count({ where: { property_id: pid, is_house_use: true, check_in_date: { gte: dayStart, lte: dayEnd } } }),
      prisma.folios.count({ where: { property_id: pid, complimentary: true, check_in_date: { gte: dayStart, lte: dayEnd } } }),
      prisma.folios.count({ where: { property_id: pid, is_walk_in: true, check_in_date: { gte: dayStart, lte: dayEnd } } }),
      countResv(dayStart, dayEnd).then(() => prisma.reservations.count({ where: { property_id: pid, date: { gte: dayStart, lte: dayEnd }, deleted_at: null, folios: { is: { check_in_date: { gte: dayStart, lte: dayEnd }, check_out_date: { gte: dayStart, lte: dayEnd } } } } })),
      prisma.reservations.aggregate({ where: { property_id: pid, date: { gte: dayStart, lte: dayEnd }, deleted_at: null, folios: { is: { status_reservation: STATUS_RESERVATION_CHECK_IN } } }, _sum: { adult: true, child: true } }),
      countResv(dayStart, dayEnd),
      countResv(monthStart, dayEnd),
      countResv(lastMonthStart, lastMonthEnd),
      countResv(yearStart, dayEnd),
      prisma.transactions.aggregate({ where: { property_id: pid, date: { gte: dayStart, lte: dayEnd }, deleted_at: null }, _sum: { amount: true } }),
      prisma.transactions.aggregate({ where: { property_id: pid, date: { gte: monthStart, lte: dayEnd }, deleted_at: null }, _sum: { amount: true } }),
      prisma.transactions.aggregate({ where: { property_id: pid, date: { gte: lastMonthStart, lte: lastMonthEnd }, deleted_at: null }, _sum: { amount: true } }),
      prisma.transactions.aggregate({ where: { property_id: pid, date: { gte: yearStart, lte: dayEnd }, deleted_at: null }, _sum: { amount: true } }),
    ]);

    const roomTypeBreakdown = typeIds.length > 0 ? await Promise.all(typeIds.map(async (typeId: bigint) => {
      const sold = await countResv(dayStart, dayEnd, typeId);
      const roomType = roomTypes.find((t: any) => t.id === typeId);
      return {
        room_type: roomType?.name || 'Unknown',
        sold,
        occupancy: sold,
      };
    })) : [];

    return [{
      date,
      total_rooms: totalRooms,
      blocked_rooms: blockedRooms,
      sold_today: todaySold,
      sold_mtd: mtdSold,
      sold_last_month: lastMonthSold,
      sold_ytd: ytdSold,
      house_use: houseUse,
      complimentary: complimentary,
      walk_in: walkIn,
      day_use: dayUse,
      in_house_guests: inHouseGuests._sum?.adult ?? 0 + (inHouseGuests._sum?.child ?? 0),
      today_occupied: todayOccupied,
      occupancy_today: todayOccupied,
      mtd_occupied: mtdOccupied,
      last_month_occupied: lastMonthOccupied,
      ytd_occupied: ytdOccupied,
      revenue_today: Number(todayRevenue._sum?.amount || 0),
      revenue_mtd: Number(mtdRevenue._sum?.amount || 0),
      revenue_last_month: Number(lastMonthRevenue._sum?.amount || 0),
      revenue_ytd: Number(ytdRevenue._sum?.amount || 0),
      room_type_breakdown: JSON.stringify(roomTypeBreakdown),
    }];
  } catch (error) {
    console.warn('Daily statistic report fallback triggered:', error);
    return [{
      date,
      total_rooms: 0,
      blocked_rooms: 0,
      sold_today: 0,
      sold_mtd: 0,
      sold_last_month: 0,
      sold_ytd: 0,
      house_use: 0,
      complimentary: 0,
      walk_in: 0,
      day_use: 0,
      in_house_guests: 0,
      today_occupied: 0,
      occupancy_today: 0,
      mtd_occupied: 0,
      last_month_occupied: 0,
      ytd_occupied: 0,
      revenue_today: 0,
      revenue_mtd: 0,
      revenue_last_month: 0,
      revenue_ytd: 0,
      room_type_breakdown: '[]',
    }];
  }
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);
  const d = new Date(`${date}T00:00:00Z`);
  const monthStart = new Date(`${date.slice(0, 8)}01T00:00:00Z`);
  const yearStart = new Date(`${date.slice(0, 4)}-01-01T00:00:00Z`);
  const lastYearStart = new Date(`${Number(date.slice(0, 4)) - 1}-${date.slice(5)}T00:00:00Z`);
  const lastYearEnd = new Date(`${Number(date.slice(0, 4)) - 1}-${date.slice(5)}T23:59:59Z`);
  const lastYearMonthStart = new Date(`${Number(date.slice(0, 4)) - 1}-${date.slice(5, 7)}-01T00:00:00Z`);
  const lastYearMonthEnd = new Date(`${Number(date.slice(0, 4)) - 1}-${date.slice(5)}T23:59:59Z`);

  const totalRooms = await prisma.rooms.count({ where: { property_id: pid, status: 1, deleted_at: null } });
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

  const resvWhere = (s: Date, e: Date) => ({
    property_id: pid,
    date: { gte: s, lte: e },
    deleted_at: null,
    folios: {
      is: {
        status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] },
        type_reservation: { in: ['fit', 'git'] },
        is_house_use: false,
        complimentary: false,
      },
    },
  });

  const [todayResvs, mtdResvs, forecastResvs, lastYearSold, lastYearMonthSold] = await Promise.all([
    prisma.reservations.findMany({ where: resvWhere(dayStart, dayEnd), select: { id: true, adult: true, child: true, rates: { include: { rate_inclusives: { where: { status: 1 } } } } } }),
    prisma.reservations.findMany({ where: resvWhere(monthStart, dayEnd), select: { id: true, adult: true, child: true, rates: { include: { rate_inclusives: { where: { status: 1 } } } } } }),
    prisma.reservations.findMany({ where: resvWhere(new Date(`${date}T00:00:00Z`).getTime() + 86400000 >= 0 ? new Date(`${date.slice(0, 4)}-${date.slice(5, 7)}-${String(Number(date.slice(8, 10)) + 1).padStart(2, '0')}T00:00:00Z`) : new Date(), new Date(`${date.slice(0, 4)}-${date.slice(5, 7)}-${String(Number(date.slice(8, 10)) + 1).padStart(2, '0')}T23:59:59Z`)), select: { id: true, adult: true, child: true } }),
    prisma.reservations.count({ where: { property_id: pid, date: { gte: lastYearStart, lte: lastYearEnd }, deleted_at: null, folios: { is: { status_reservation: { notIn: [2, 5] } } } } }),
    prisma.reservations.count({ where: { property_id: pid, date: { gte: lastYearMonthStart, lte: lastYearMonthEnd }, deleted_at: null, folios: { is: { status_reservation: { notIn: [2, 5] } } } } }),
  ]);

  const stockIds = [...new Set(todayResvs.flatMap((r: any) => r.rates?.rate_inclusives ?? []).map((ri: any) => ri.stock).filter(Boolean))];
  const stockItems = stockIds.length ? await prisma.code_items.findMany({ where: { id: { in: stockIds.map((s: string) => BigInt(s)) } }, include: { code_posts: true } }) : [];
  const hasBreakfast = (res: any) => (res.rates?.rate_inclusives ?? []).some((ri: any) => {
    const ci = stockItems.find((c: any) => c.id === (ri.stock ? BigInt(ri.stock) : -1n));
    const name = (ci?.code_posts?.name || '').toLowerCase();
    return name.includes('breakfast additional') || name.includes('breakfast room');
  });

  const todayRoomSold = todayResvs.length;
  const mtdRoomSold = mtdResvs.length;
  const todayPax = todayResvs.reduce((s: number, r: any) => s + (r.adult ?? 0) + (r.child ?? 0), 0);
  const mtdPax = mtdResvs.reduce((s: number, r: any) => s + (r.adult ?? 0) + (r.child ?? 0), 0);
  const forecastRoomSold = forecastResvs.length;
  const forecastPax = forecastResvs.reduce((s: number, r: any) => s + (r.adult ?? 0) + (r.child ?? 0), 0);
  const totalRoomsMTD = totalRooms * daysInMonth;

  const todayRevenue = await revenueBetween(pid, dayStart, dayEnd, 'room revenue');
  const lastYearDailyRevenue = await revenueBetween(pid, lastYearStart, lastYearEnd, 'room revenue');
  const mtdRevenue = await revenueBetween(pid, monthStart, dayEnd, 'room revenue');
  const lastYearMTDRevenue = await revenueBetween(pid, lastYearMonthStart, lastYearMonthEnd, 'room revenue');
  const tomorrow = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000);
  const tmrStart = new Date(`${formatDate(tomorrow)}T00:00:00Z`);
  const tmrEnd = new Date(`${formatDate(tomorrow)}T23:59:59Z`);

  const occupancy = totalRooms > 0 ? (todayRoomSold / totalRooms) * 100 : 0;
  const lastYearOccupancy = totalRooms > 0 ? (lastYearSold / totalRooms) * 100 : 0;
  const mtdOccupancy = totalRoomsMTD > 0 ? (mtdRoomSold / totalRoomsMTD) * 100 : 0;
  const lastYearMtdOccupancy = totalRoomsMTD > 0 ? (lastYearMonthSold / totalRoomsMTD) * 100 : 0;

  const dailyStats = {
    total_rooms: totalRooms,
    room_sold: todayRoomSold,
    total_pax: todayPax,
    breakfast_rooms: todayResvs.filter(hasBreakfast).length,
    breakfast_pax: todayResvs.filter(hasBreakfast).reduce((s: number, r: any) => s + (r.adult ?? 0) + (r.child ?? 0), 0),
    last_year_room_sold: lastYearSold,
    occupancy: Number(occupancy.toFixed(2)),
    last_year_occupancy: Number(lastYearOccupancy.toFixed(2)),
    variance: Number((occupancy - lastYearOccupancy).toFixed(2)),
  };

  const forecastResvsWithRate = await prisma.reservations.findMany({ where: resvWhere(tmrStart, tmrEnd), select: { id: true, adult: true, child: true, rates: { include: { rate_inclusives: { where: { status: 1 } } } } } });
  const forecastStockIds = [...new Set(forecastResvsWithRate.flatMap((r: any) => r.rates?.rate_inclusives ?? []).map((ri: any) => ri.stock).filter(Boolean))];
  const forecastStockItems = forecastStockIds.length ? await prisma.code_items.findMany({ where: { id: { in: forecastStockIds.map((s: string) => BigInt(s)) } }, include: { code_posts: true } }) : [];
  const forecastHasBreakfast = (res: any) => (res.rates?.rate_inclusives ?? []).some((ri: any) => {
    const ci = forecastStockItems.find((c: any) => c.id === (ri.stock ? BigInt(ri.stock) : -1n));
    const name = (ci?.code_posts?.name || '').toLowerCase();
    return name.includes('breakfast additional') || name.includes('breakfast room');
  });
  const fOccupancy = totalRooms > 0 ? (forecastRoomSold / totalRooms) * 100 : 0;
  const forecastStats = {
    total_rooms: totalRooms,
    room_sold: forecastRoomSold,
    total_pax: forecastPax,
    breakfast_rooms: forecastResvsWithRate.filter(forecastHasBreakfast).length,
    breakfast_pax: forecastResvsWithRate.filter(forecastHasBreakfast).reduce((s: number, r: any) => s + (r.adult ?? 0) + (r.child ?? 0), 0),
    last_year_room_sold: 0,
    occupancy: Number(fOccupancy.toFixed(2)),
    last_year_occupancy: 0,
    variance: 0,
  };

  const getBudgetCost = async (needle: string, month: number, year: number) => {
    const cps = await prisma.code_posts.findMany({ where: { name: { contains: needle, mode: 'insensitive' }, property_id: pid }, select: { id: true } });
    if (!cps.length) return 0;
    const budgets = await prisma.post_code_budgets.findMany({ where: { code_post_id: { in: cps.map((c: any) => c.id) }, month, year }, select: { budget: true } });
    return budgets.reduce((s: number, b: any) => s + Number(b.budget ?? 0), 0);
  };

  const getBalance = async (s: Date, e: Date) => {
    const txns = await prisma.transaction_breakdowns.findMany({
      where: { property_id: pid, date: { gte: s, lte: e }, type: { notIn: ['payment', 'paidout', 'refund'] } },
      select: { code: true, type_amount: true, total: true },
    });
    const codeIds = [...new Set(txns.map((t: any) => t.code).filter(Boolean))];
    const cps = codeIds.length ? await prisma.code_posts.findMany({ where: { id: { in: codeIds.map((c: string) => BigInt(c)) } }, include: { code_billings: true } }) : [];
    const cpById = new Map(cps.map((c: any) => [c.id, c]));
    const total = txns.reduce((sum: number, t: any) => {
      const cp: any = cpById.get(t.code ? BigInt(t.code) : -1n);
      if (!cp) return sum;
      if ((cp.code_billings?.name || '').toLowerCase().includes('payment')) return sum;
      return sum + (t.type_amount === 'PLUS' ? Number(t.total ?? 0) : -Number(t.total ?? 0));
    }, 0);
    return total;
  };

  const variableCost = await getBudgetCost('variable', d.getUTCMonth() + 1, d.getUTCFullYear());
  const fixedCost = await getBudgetCost('fixed', d.getUTCMonth() + 1, d.getUTCFullYear());
  const monthDays = daysInMonth;

  const actualRevenue = await getBalance(dayStart, dayEnd);
  const mtdActualRevenue = await getBalance(monthStart, dayEnd);
  const diffActual = actualRevenue - variableCost / monthDays - fixedCost / monthDays;
  const diffMtd = mtdActualRevenue - variableCost - fixedCost;
  const winLose = (v: number) => (v > 0 ? 'O' : v === 0 ? 'â–³' : 'X');

  const arr = todayRoomSold > 0 ? todayRevenue / todayRoomSold : 0;
  const lastYearARR = lastYearSold > 0 ? lastYearDailyRevenue / lastYearSold : 0;
  const avgRatePerPax = todayPax > 0 ? todayRevenue / todayPax : 0;
  const lastYearAvgRatePerPax = todayPax > 0 ? lastYearDailyRevenue / todayPax : 0;
  const revpar = totalRooms > 0 ? todayRevenue / totalRooms : 0;
  const lastYearRevpar = totalRooms > 0 ? lastYearDailyRevenue / totalRooms : 0;

  const dailySales = {
    daily: {
      room_revenue_idr: todayRevenue,
      room_revenue_jpy: toJPY(todayRevenue),
      last_year_room_revenue: lastYearDailyRevenue,
      ytd_room_revenue: todayRevenue > 0 && lastYearDailyRevenue > 0 ? (todayRevenue / lastYearDailyRevenue * 100) : 0,
      room_revenue_variance: todayRevenue - lastYearDailyRevenue,
      arr_idr: arr,
      arr_jpy: toJPY(arr),
      last_year_arr: lastYearARR,
      ytd_arr: arr > 0 && lastYearARR > 0 ? (arr / lastYearARR * 100) : 0,
      arr_variance: arr - lastYearARR,
      avg_rate_pax_idr: avgRatePerPax,
      avg_rate_pax_jpy: toJPY(avgRatePerPax),
      last_year_avg_rate_pax: todayPax > 0 ? lastYearDailyRevenue / todayPax : 0,
      ytd_avg_rate_pax: avgRatePerPax > 0 && lastYearAvgRatePerPax > 0 ? (avgRatePerPax / lastYearAvgRatePerPax * 100) : 0,
      avg_rate_pax_variance: avgRatePerPax - lastYearAvgRatePerPax,
      revpar_idr: revpar,
      revpar_jpy: toJPY(revpar),
      last_year_revpar: lastYearRevpar,
      ytd_revpar: revpar > 0 && lastYearRevpar > 0 ? (revpar / lastYearRevpar * 100) : 0,
      revpar_variance: revpar - lastYearRevpar,
    },
    mtd: {
      room_revenue_idr: mtdRevenue,
      room_revenue_jpy: toJPY(mtdRevenue),
      last_year_room_revenue: lastYearMTDRevenue,
      ytd_room_revenue: mtdRevenue > 0 && lastYearMTDRevenue > 0 ? (mtdRevenue / lastYearMTDRevenue * 100) : 0,
      room_revenue_variance: mtdRevenue - lastYearMTDRevenue,
      arr_idr: mtdRoomSold > 0 ? mtdRevenue / mtdRoomSold : 0,
      arr_jpy: toJPY(mtdRoomSold > 0 ? mtdRevenue / mtdRoomSold : 0),
      last_year_arr: lastYearMonthSold > 0 ? lastYearMTDRevenue / lastYearMonthSold : 0,
      ytd_arr: 0,
      arr_variance: 0,
      avg_rate_pax_idr: mtdPax > 0 ? mtdRevenue / mtdPax : 0,
      avg_rate_pax_jpy: toJPY(mtdPax > 0 ? mtdRevenue / mtdPax : 0),
      last_year_avg_rate_pax: mtdPax > 0 ? lastYearMTDRevenue / mtdPax : 0,
      ytd_avg_rate_pax: 0,
      avg_rate_pax_variance: 0,
      revpar_idr: totalRoomsMTD > 0 ? mtdRevenue / totalRoomsMTD : 0,
      revpar_jpy: toJPY(totalRoomsMTD > 0 ? mtdRevenue / totalRoomsMTD : 0),
      last_year_revpar: totalRoomsMTD > 0 ? lastYearMTDRevenue / totalRoomsMTD : 0,
      ytd_revpar: 0,
      revpar_variance: 0,
    },
  };

  const revType = async (type: string, s: Date, e: Date, ls: Date, le: Date) => {
    const cur = await revenueBetween(pid, s, e, type);
    const last = await revenueBetween(pid, ls, le, type);
    return {
      idr: cur,
      jpy: toJPY(cur),
      last_year: last,
      ytd: last > 0 ? (cur / last) * 100 : 0,
      variance: cur - last,
    };
  };
  const dailyRevenue: any = {
    room_revenue: await revType('room revenue', dayStart, dayEnd, lastYearStart, lastYearEnd),
    breakfast_revenue: await revType('breakfast', dayStart, dayEnd, lastYearStart, lastYearEnd),
    dine_in_revenue: await revType('dine in', dayStart, dayEnd, lastYearStart, lastYearEnd),
    room_service_revenue: await revType('room service', dayStart, dayEnd, lastYearStart, lastYearEnd),
    minimart_revenue: await revType('minimart', dayStart, dayEnd, lastYearStart, lastYearEnd),
    fb_other_revenue: await revType('fb', dayStart, dayEnd, lastYearStart, lastYearEnd),
    banquet_revenue: await revType('banquet', dayStart, dayEnd, lastYearStart, lastYearEnd),
    others_revenue: await revType('other', dayStart, dayEnd, lastYearStart, lastYearEnd),
  };
  const dailyTotal = Object.values<any>(dailyRevenue).reduce((acc: any, v: any) => ({
    idr: acc.idr + v.idr, jpy: acc.jpy + v.jpy, last_year: acc.last_year + v.last_year, ytd: acc.ytd + v.ytd, variance: acc.variance + v.variance,
  }), { idr: 0, jpy: 0, last_year: 0, ytd: 0, variance: 0 });
  dailyRevenue.total_nett_revenue = { ...dailyTotal, ytd: dailyTotal.last_year > 0 ? (dailyTotal.idr / dailyTotal.last_year) * 100 : 0 };

  const mtdRevenueObj: any = {
    room_revenue: await revType('room revenue', monthStart, dayEnd, lastYearMonthStart, lastYearMonthEnd),
    breakfast_revenue: await revType('breakfast', monthStart, dayEnd, lastYearMonthStart, lastYearMonthEnd),
    dine_in_revenue: await revType('dine in', monthStart, dayEnd, lastYearMonthStart, lastYearMonthEnd),
    room_service_revenue: await revType('room service', monthStart, dayEnd, lastYearMonthStart, lastYearMonthEnd),
    minimart_revenue: await revType('minimart', monthStart, dayEnd, lastYearMonthStart, lastYearMonthEnd),
    fb_other_revenue: await revType('fb', monthStart, dayEnd, lastYearMonthStart, lastYearMonthEnd),
    banquet_revenue: await revType('banquet', monthStart, dayEnd, lastYearMonthStart, lastYearMonthEnd),
    others_revenue: await revType('other', monthStart, dayEnd, lastYearMonthStart, lastYearMonthEnd),
  };
  const mtdTotal = Object.values<any>(mtdRevenueObj).reduce((acc: any, v: any) => ({
    idr: acc.idr + v.idr, jpy: acc.jpy + v.jpy, last_year: acc.last_year + v.last_year, ytd: acc.ytd + v.ytd, variance: acc.variance + v.variance,
  }), { idr: 0, jpy: 0, last_year: 0, ytd: 0, variance: 0 });
  mtdRevenueObj.total_nett_revenue = { ...mtdTotal, ytd: mtdTotal.last_year > 0 ? (mtdTotal.idr / mtdTotal.last_year) * 100 : 0 };

  const mtdStats = {
    total_rooms: totalRoomsMTD,
    room_sold: mtdRoomSold,
    total_pax: mtdPax,
    breakfast_rooms: mtdResvs.filter(hasBreakfast).length,
    breakfast_pax: mtdResvs.filter(hasBreakfast).reduce((s: number, r: any) => s + (r.adult ?? 0) + (r.child ?? 0), 0),
    last_year_room_sold: lastYearMonthSold,
    occupancy: Number(mtdOccupancy.toFixed(2)),
    last_year_occupancy: Number(lastYearMtdOccupancy.toFixed(2)),
    variance: Number((mtdOccupancy - lastYearMtdOccupancy).toFixed(2)),
  };

  return [{
    date,
    currency: params.currency || 'IDR',
    exchangeRate: kurs,
    generalManager: 'KURNIAWAN',
    createdBy: 'FO MANAGER',
    actualBalance: {
      total_revenue_idr: actualRevenue,
      total_revenue_jpy: toJPY(actualRevenue),
      variable_cost_idr: variableCost / monthDays,
      variable_cost_jpy: toJPY(variableCost / monthDays),
      fixed_cost_idr: fixedCost / monthDays,
      fixed_cost_jpy: toJPY(fixedCost / monthDays),
      difference_idr: diffActual,
      difference_jpy: toJPY(diffActual),
      win_lose: winLose(diffActual),
    },
    mtdBalance: {
      total_revenue_idr: mtdActualRevenue,
      total_revenue_jpy: toJPY(mtdActualRevenue),
      variable_cost_idr: variableCost,
      variable_cost_jpy: toJPY(variableCost),
      fixed_cost_idr: fixedCost,
      fixed_cost_jpy: toJPY(fixedCost),
      difference_idr: diffMtd,
      difference_jpy: toJPY(diffMtd),
      win_lose: winLose(diffMtd),
    },
    dailyStats,
    mtdStats,
    forecastStats,
    roomSales: dailySales,
    dailyRevenue,
    mtdRevenue: mtdRevenueObj,
  }];
}

async function getDailyStatisticReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const date = params.date || formatDate(new Date());
  const kurs = params.kurs || params.exchangeRate || '';
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(`${date}T23:59:59Z`);
  const d = new Date(`${date}T00:00:00Z`);
  const monthStart = new Date(`${date.slice(0, 8)}01T00:00:00Z`);
  const yearStart = new Date(`${date.slice(0, 4)}-01-01T00:00:00Z`);
  const lastMonthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()));

  const roomTypes = (await prisma.room_types.findMany({
    where: { property_id: pid, deleted_at: null },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  })).filter((t: any) => !t.name.toUpperCase().includes('VIRTUAL'));
  const typeIds = roomTypes.map((t: any) => t.id);

  const countResv = (s: Date, e: Date, typeId?: bigint) => prisma.reservations.count({
    where: { property_id: pid, date: { gte: s, lte: e }, deleted_at: null, ...(typeId ? { room_type_id: typeId } : {}) },
  });
  const [totalRooms, blockedRooms, todaySold, mtdSold, lastMonthSold, ytdSold, houseUse, complimentary, walkIn, dayUse, inHouseGuests, todayOccupied, mtdOccupied, lastMonthOccupied, ytdOccupied, todayRevenue, mtdRevenue, lastMonthRevenue, ytdRevenue] = await Promise.all([
    prisma.rooms.count({ where: { property_id: pid, status: 1, deleted_at: null } }),
    prisma.rooms.count({ where: { property_id: pid, room_status: 2, deleted_at: null } }),
    countResv(dayStart, dayEnd),
    countResv(monthStart, dayEnd),
    countResv(lastMonthStart, lastMonthEnd),
    countResv(yearStart, dayEnd),
    prisma.folios.count({ where: { property_id: pid, is_house_use: true, check_in_date: { gte: dayStart, lte: dayEnd } } }),
    prisma.folios.count({ where: { property_id: pid, complimentary: true, check_in_date: { gte: dayStart, lte: dayEnd } } }),
    prisma.folios.count({ where: { property_id: pid, is_walk_in: true, check_in_date: { gte: dayStart, lte: dayEnd } } }),
    countResv(dayStart, dayEnd).then(() => prisma.reservations.count({ where: { property_id: pid, date: { gte: dayStart, lte: dayEnd }, deleted_at: null, folios: { is: { check_in_date: { gte: dayStart, lte: dayEnd }, check_out_date: { gte: dayStart, lte: dayEnd } } } } })),
    prisma.reservations.aggregate({ where: { property_id: pid, date: { gte: dayStart, lte: dayEnd }, deleted_at: null, folios: { is: { status_reservation: STATUS_RESERVATION_CHECK_IN } } }, _sum: { adult: true, child: true } }),
    countResv(dayStart, dayEnd),
    countResv(monthStart, dayEnd),
    countResv(lastMonthStart, lastMonthEnd),
    countResv(yearStart, dayEnd),
    prisma.transactions.aggregate({ where: { property_id: pid, date: { gte: dayStart, lte: dayEnd }, deleted_at: null }, _sum: { amount: true } }),
    prisma.transactions.aggregate({ where: { property_id: pid, date: { gte: monthStart, lte: dayEnd }, deleted_at: null }, _sum: { amount: true } }),
    prisma.transactions.aggregate({ where: { property_id: pid, date: { gte: lastMonthStart, lte: lastMonthEnd }, deleted_at: null }, _sum: { amount: true } }),
    prisma.transactions.aggregate({ where: { property_id: pid, date: { gte: yearStart, lte: dayEnd }, deleted_at: null }, _sum: { amount: true } }),
  ]);

  const getPeriod = (sold: number, occupied: number, rev: any, blocked: number) => {
    const available = totalRooms;
    const saleable = available - blocked;
    const vacant = saleable - occupied;
    const revenue = Number(rev._sum?.amount ?? 0);
    return {
      totalAvailableRoom: available,
      totalBlockedRoom: blocked,
      totalOccupiedRoom: occupied,
      totalRoomSold: sold,
      totalHouseUse: 0,
      totalComplimentary: 0,
      totalSaleableRoom: saleable,
      totalVacantRoom: vacant,
      totalWalkIn: 0,
      totalDayUse: 0,
      totalInHouseGuests: 0,
      averageRoomRate: sold > 0 ? revenue / sold : 0,
      averageRoomRateIncBF: sold > 0 ? revenue / sold : 0,
      revenuePerAvailableRoom: available > 0 ? revenue / available : 0,
      roomSaleableOccupancy: saleable > 0 ? (sold / saleable) * 100 : 0,
      roomAvailableOccupancy: available > 0 ? (sold / available) * 100 : 0,
      occupiedRoomOccupancy: available > 0 ? (occupied / available) * 100 : 0,
      doubleOccupancy: occupied > 0 ? ((inHouseGuests._sum?.adult ?? 0) + (inHouseGuests._sum?.child ?? 0)) / occupied * 100 : 0,
    };
  };

  const roomTypeSales: Record<string, any> = {};
  for (const rt of roomTypes) {
    roomTypeSales[rt.id.toString()] = {
      todayActual: await countResv(dayStart, dayEnd, rt.id),
      mtdActual: await countResv(monthStart, dayEnd, rt.id),
      mtdLastMonth: await countResv(lastMonthStart, lastMonthEnd, rt.id),
      ytdActual: await countResv(yearStart, dayEnd, rt.id),
      mtdBudget: 0,
      mtdVariance: (await countResv(monthStart, dayEnd, rt.id)) - 0,
    };
  }

  return [{
    reportDate: date,
    todayActual: getPeriod(todaySold, todayOccupied, todayRevenue, blockedRooms),
    mtdActual: getPeriod(mtdSold, mtdOccupied, mtdRevenue, blockedRooms),
    mtdLastMonth: getPeriod(lastMonthSold, lastMonthOccupied, lastMonthRevenue, blockedRooms),
    mtdBudget: {},
    ytdActual: getPeriod(ytdSold, ytdOccupied, ytdRevenue, blockedRooms),
    roomTypes,
    roomTypeSales,
    reportTitle: 'Daily Flash Report',
    mtdVariance: {},
    startDate: date,
    endDate: date,
  }];
}

async function getFreeOfChargeDetailReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const startDate = params.startDate ? new Date(`${params.startDate.slice(0, 10)}T00:00:00Z`) : new Date(`${businessDate}T00:00:00Z`);
  const endDate = new Date(startDate.getTime() + 30 * 86400000);

  const folios = await prisma.folios.findMany({
    where: {
      property_id: pid,
      type_reservation: { in: ['git', 'fit'] },
      OR: [{ is_house_use: true }, { complimentary: true }],
      check_in_date: { gte: startDate, lte: endDate },
      deleted_at: null,
    },
    select: {
      id: true, folio_number: true, is_house_use: true, complimentary: true, type_reservation: true,
      guest_profile_id: true, check_in_date: true, check_out_date: true,
      company_profile_id: true,
      reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1, select: { id: true, room_id: true, room_type_id: true, rate_id: true, data: true, adult: true, child: true } },
    },
  });
  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null))];
  const companyIds = [...new Set(folios.map((f: any) => f.company_profile_id).filter((v: any) => v !== null && v !== 0n))];
  const roomIds = [...new Set(folios.flatMap((f: any) => f.reservations?.[0]?.room_id).filter((v: any) => v !== null))];
  const [guests, companies, rooms] = await Promise.all([
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : [],
    companyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [],
  ]);
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const companyById = new Map(companies.map((c: any) => [c.id, c]));
  const roomById = new Map(rooms.map((r: any) => [r.id, r]));
  const typeIds = [...new Set(folios.map((f: any) => f.reservations?.[0]?.room_type_id).filter((v: any) => v !== null))];
  const types = typeIds.length ? await prisma.room_types.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } }) : [];
  const typeById = new Map(types.map((t: any) => [t.id, t]));

  const rows = folios.map((f: any) => {
    const res = f.reservations?.[0];
    let rate = 0;
    if (res?.data) { try { const d = JSON.parse(res.data); rate = Number(d.amount ?? 0) || 0; } catch { /* ignore */ } }
    const guest: any = f.guest_profile_id ? guestById.get(f.guest_profile_id) : null;
    const company: any = f.company_profile_id ? companyById.get(f.company_profile_id) : null;
    const room: any = res?.room_id ? roomById.get(res.room_id) : null;
    const roomType: any = res?.room_type_id ? typeById.get(res.room_type_id) : null;
    const fmt = (d: Date | null) => d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}` : '';
    return {
      resType: f.type_reservation.toUpperCase(),
      folio: f.folio_number,
      guest: guest ? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim() : '',
      company: company?.name ?? '',
      room: room?.name ?? '',
      roomType: roomType?.name ?? 'Unknown',
      rateCode: res?.rate_id ? '' : '',
      rate,
      oldRate: 0,
      adult: res?.adult ?? 0,
      child: res?.child ?? 0,
      checkInDate: fmt(f.check_in_date),
      checkOutDate: fmt(f.check_out_date),
      _group: f.is_house_use ? 'HSE' : 'COMP',
      _roomType: roomType?.name ?? 'Unknown',
      _roomName: room?.name ?? '',
    };
  });
  rows.sort((a: any, b: any) => Number(a._roomName.replace(/[^0-9]/g, '')) - Number(b._roomName.replace(/[^0-9]/g, '')));

  const reportData: Record<string, Record<string, any[]>> = {};
  for (const r of rows) {
    reportData[r._group] = reportData[r._group] || {};
    reportData[r._group][r._roomType] = reportData[r._group][r._roomType] || [];
    reportData[r._group][r._roomType].push(r);
  }

  return [{
    startDate: `${String(startDate.getUTCDate()).padStart(2, '0')}/${String(startDate.getUTCMonth() + 1).padStart(2, '0')}/${startDate.getUTCFullYear()}`,
    endDate: `${String(endDate.getUTCDate()).padStart(2, '0')}/${String(endDate.getUTCMonth() + 1).padStart(2, '0')}/${endDate.getUTCFullYear()}`,
    reportData,
    summary: {
      totalCRTRoom: rows.filter((r: any) => r._roomType === 'CRT').length,
      totalCRDRoom: rows.filter((r: any) => r._roomType === 'CRD').length,
      totalBRDRoom: rows.filter((r: any) => r._roomType === 'BRD').length,
      noOfFolios: rows.length,
      totalCOMPRoom: folios.filter((f: any) => f.complimentary).length,
      totalHSERoom: folios.filter((f: any) => f.is_house_use).length,
      totalInvestorRoom: 0,
    },
  }];
}

async function getReservationsByStaffReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const start = params.startDate ? new Date(`${params.startDate.slice(0, 10)}T00:00:00Z`) : new Date(`${businessDate}T00:00:00Z`);
  const end = params.endDate ? new Date(`${params.endDate.slice(0, 10)}T23:59:59Z`) : new Date(`${businessDate}T23:59:59Z`);
  const staffId = params.staffId ? BigInt(params.staffId) : null;

  const baseWhere: any = { property_id: pid, type_reservation: { not: 'vr' }, created_at: { gte: start, lte: end }, deleted_at: null };
  if (staffId) baseWhere.created_by = staffId;

  const [folios, cancelled] = await Promise.all([
    prisma.folios.findMany({ where: baseWhere, select: { id: true, folio_number: true, type_reservation: true, status_reservation: true, created_by: true, created_at: true, check_in_date: true, check_out_date: true, guest_profile_id: true, company_profile_id: true, reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1, select: { id: true, room_id: true, room_type_id: true, rate_id: true, data: true, adult: true, child: true } } } }),
    prisma.folios.findMany({ where: { ...baseWhere, status_reservation: STATUS_RESERVATION_CANCEL }, select: { id: true, folio_number: true, type_reservation: true, updated_at: true, created_by: true, check_in_date: true, check_out_date: true, guest_profile_id: true, company_profile_id: true, reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1, select: { id: true, room_id: true, room_type_id: true, rate_id: true, data: true, adult: true, child: true } } } }),
  ]);
  const allFolios = [...folios, ...cancelled];
  const staffIds = [...new Set(allFolios.map((f: any) => f.created_by).filter((v: any) => v !== null))];
  const guestIds = [...new Set(allFolios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null))];
  const companyIds = [...new Set(allFolios.map((f: any) => f.company_profile_id).filter((v: any) => v !== null && v !== 0n))];
  const roomIds = [...new Set(allFolios.flatMap((f: any) => f.reservations?.[0]?.room_id).filter((v: any) => v !== null))];
  const [staff, guests, companies, rooms] = await Promise.all([
    staffIds.length ? prisma.users.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [],
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : [],
    companyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [],
  ]);
  const staffById = new Map(staff.map((s: any) => [s.id, s]));
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const companyById = new Map(companies.map((c: any) => [c.id, c]));
  const roomById = new Map(rooms.map((r: any) => [r.id, r]));
  const typeIds = [...new Set(allFolios.flatMap((f: any) => f.reservations?.[0]?.room_type_id).filter((v: any) => v !== null))];
  const types = typeIds.length ? await prisma.room_types.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } }) : [];
  const typeById = new Map(types.map((t: any) => [t.id, t]));

  const mapRow = (f: any, withCancelDate: boolean) => {
    const res = f.reservations?.[0];
    let firstNightRate = 0;
    if (res?.data) { try { const d = JSON.parse(res.data); firstNightRate = Number(d.rate_price ?? 0) || 0; } catch { /* ignore */ } }
    const guest: any = f.guest_profile_id ? guestById.get(f.guest_profile_id) : null;
    const company: any = f.company_profile_id ? companyById.get(f.company_profile_id) : null;
    const room: any = res?.room_id ? roomById.get(res.room_id) : null;
    const roomType: any = res?.room_type_id ? typeById.get(res.room_type_id) : null;
    const stay = f.check_in_date && f.check_out_date
      ? Math.max(0, Math.round((f.check_out_date.getTime() - f.check_in_date.getTime()) / 86400000))
      : 0;
    const fmt = (d: Date | null) => d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : 'N/A';
    const row: any = {
      resType: f.type_reservation.toUpperCase(),
      folio: f.folio_number,
      guest: guest ? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim() : 'N/A',
      company: company?.name ?? 'N/A',
      stay,
      room: room?.name ?? 'N/A',
      roomType: roomType?.name ?? 'N/A',
      adult: res?.adult ?? 'N/A',
      child: res?.child ?? 'N/A',
      checkInDate: fmt(f.check_in_date),
      checkOutDate: fmt(f.check_out_date),
      rateCode: '',
      firstNightRate,
    };
    if (withCancelDate) {
      row.cancellationDate = fmt(f.updated_at);
      delete row.resStatus;
    } else {
      row.resStatus = f.status_reservation;
      row.resDate = fmt(f.created_at);
    }
    return row;
  };

  const reportData: Record<string, any> = {};
  for (const f of folios) {
    const key = f.created_by ? String(f.created_by) : '0';
    reportData[key] = reportData[key] || { staffName: f.created_by ? staffById.get(f.created_by)?.name ?? 'Unknown' : 'Unknown', folios: [], cancelledFolios: [] };
    reportData[key].folios.push(mapRow(f, false));
  }
  for (const f of cancelled) {
    const key = f.created_by ? String(f.created_by) : '0';
    reportData[key] = reportData[key] || { staffName: f.created_by ? staffById.get(f.created_by)?.name ?? 'Unknown' : 'Unknown', folios: [], cancelledFolios: [] };
    reportData[key].cancelledFolios.push(mapRow(f, true));
  }

  return [{
    startDate: `${String(start.getUTCDate()).padStart(2, '0')}/${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`,
    endDate: `${String(end.getUTCDate()).padStart(2, '0')}/${String(end.getUTCMonth() + 1).padStart(2, '0')}/${end.getUTCFullYear()}`,
    reportData,
  }];
}

async function getRoomTypeDetailedReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const startDate = params.startDate || params.date || formatDate(new Date());
  const endDate = params.endDate || startDate;
  const s = new Date(`${startDate}T00:00:00Z`);
  const e = new Date(`${endDate}T23:59:59Z`);

  // code_posts linked to code_billings named 'room revenue' (breakdown.code = code_posts.id)
  const billingIds = (await prisma.code_billings.findMany({
    where: { property_id: pid, name: { contains: 'room revenue', mode: 'insensitive' }, deleted_at: null },
    select: { id: true },
  })).map((b: any) => b.id);
  const postIds = billingIds.length ? (await prisma.code_posts.findMany({
    where: { code_billing_id: { in: billingIds }, deleted_at: null },
    select: { id: true },
  })).map((p: any) => p.id) : [];

  const roomTypes = (await prisma.room_types.findMany({
    where: { property_id: pid, deleted_at: null },
    include: { rooms: { where: { deleted_at: null }, select: { room_status: true } } },
  })).filter((t: any) => !t.name.toUpperCase().includes('VIRTUAL'));

  const reservations = await prisma.reservations.findMany({
    where: {
      property_id: pid,
      date: { gte: s, lte: e },
      deleted_at: null,
      folios: {
        is: {
          status_reservation: { notIn: [2, 5] },
          is_house_use: false,
          complimentary: false,
          type_reservation: { in: ['fit', 'git', 'vr'] },
        },
      },
    },
    select: {
      id: true, date: true, folio_id: true, room_type_id: true,
      folios: {
        select: {
          check_in_date: true, check_out_date: true, type_reservation: true,
          folio_number: true, parent: true,
        },
      },
    },
  });
  const fitFoliosByType: Record<string, any[]> = {};
  const gitFoliosByType: Record<string, any[]> = {};
  const allFitFolioIds: bigint[] = [];
  const allGitFolioIds: bigint[] = [];
  const dstr = (d: any) => d ? d.toISOString().slice(0, 10) : '';
  for (const r of reservations) {
    const f = (r as any).folios;
    if (!f) continue;
    const isFit = f.type_reservation === 'fit' || (f.type_reservation === 'vr' && f.folio_number && f.folio_number.startsWith('F'));
    const isGit = f.type_reservation === 'git' && f.parent !== 0;
    if (isFit) { (fitFoliosByType[String(r.room_type_id)] = fitFoliosByType[String(r.room_type_id)] || []).push(r); allFitFolioIds.push(r.folio_id); }
    if (isGit) { (gitFoliosByType[String(r.room_type_id)] = gitFoliosByType[String(r.room_type_id)] || []).push(r); allGitFolioIds.push(r.folio_id); }
  }

  const breakdowns = await prisma.transaction_breakdowns.findMany({
    where: {
      property_id: pid,
      date: { gte: s, lte: e },
      type: { notIn: ['payment', 'paidout', 'refund'] },
      folio_id: { in: [...new Set([...allFitFolioIds, ...allGitFolioIds])] },
      ...(postIds.length ? { code: { in: postIds } } : {}),
    },
    select: { folio_id: true, date: true, amount: true, type_amount: true },
  });
  const fitRevSet = new Set(allFitFolioIds.map(String));
  const gitRevSet = new Set(allGitFolioIds.map(String));
  const revByDay = (dateStr: string, kind: 'fit' | 'git'): number => {
    let sum = 0;
    for (const b of breakdowns) {
      if (dstr(b.date) !== dateStr) continue;
      const fid = String(b.folio_id);
      if (kind === 'fit' && !fitRevSet.has(fid)) continue;
      if (kind === 'git' && !gitRevSet.has(fid)) continue;
      sum += b.type_amount === 'PLUS' ? Number(b.amount) : -Number(b.amount);
    }
    return sum;
  };

  const emptyTotals = () => ({
    total_room: 0, block: 0, non_grp_arr: 0, non_grp_dep: 0, non_grp_sty: 0, non_grp_revenue: 0,
    grp_arr: 0, grp_dep: 0, grp_sty: 0, grp_revenue: 0, occupied_rooms: 0,
    total_arr: 0, total_dep: 0, total_sty: 0, total_revenue: 0, occupancy: 0, ave_nett_revenue: 0,
  });
  const grandTotal = emptyTotals();
  const reportData: any[] = [];
  const cursor = new Date(s);
  while (cursor <= e) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const dateData: any = { date: dateStr, room_types: [], totals: emptyTotals() };
    for (const rt of roomTypes) {
      const totalRooms = rt.rooms.length;
      const blockedRooms = rt.rooms.filter((r: any) => r.room_status === 4 || r.room_status === 3).length;
      const fit = fitFoliosByType[String(rt.id)] || [];
      const git = gitFoliosByType[String(rt.id)] || [];
      const onDate = (r: any) => dstr(r.date) === dateStr;
      const inOnDate = (r: any) => dstr(r.folios.check_in_date) === dateStr;
      const outOnDate = (r: any) => dstr(r.folios.check_out_date) === dateStr;
      const non_grp_arr = fit.filter((r) => onDate(r) && inOnDate(r)).length;
      const non_grp_dep = fit.filter((r) => onDate(r) && outOnDate(r)).length;
      const non_grp_sty = fit.filter((r) => onDate(r) && !inOnDate(r) && !outOnDate(r)).length;
      const grp_arr = git.filter((r) => onDate(r) && inOnDate(r)).length;
      const grp_dep = git.filter((r) => onDate(r) && outOnDate(r)).length;
      const grp_sty = git.filter((r) => onDate(r) && !inOnDate(r) && !outOnDate(r)).length;
      const non_grp_revenue = revByDay(dateStr, 'fit');
      const grp_revenue = revByDay(dateStr, 'git');
      const occupiedRooms = non_grp_arr + non_grp_sty + grp_arr + grp_sty;
      const total_revenue = non_grp_revenue + grp_revenue;
      const rtData: any = {
        room_type: rt.name, total_room: totalRooms, block: blockedRooms,
        non_grp_arr, non_grp_dep, non_grp_sty, non_grp_revenue,
        grp_arr, grp_dep, grp_sty, grp_revenue,
        occupied_rooms: occupiedRooms,
        total_arr: non_grp_arr + grp_arr, total_dep: non_grp_dep + grp_dep, total_sty: non_grp_sty + grp_sty,
        total_revenue,
        occupancy: totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0,
        ave_nett_revenue: occupiedRooms > 0 ? total_revenue / occupiedRooms : 0,
      };
      dateData.room_types.push(rtData);
      for (const key of Object.keys(emptyTotals())) (dateData.totals as any)[key] += rtData[key];
    }
    reportData.push(dateData);
    for (const key of Object.keys(emptyTotals())) (grandTotal as any)[key] += (dateData.totals as any)[key];
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return [{
    startDate: `${String(s.getUTCDate()).padStart(2, '0')}/${String(s.getUTCMonth() + 1).padStart(2, '0')}/${s.getUTCFullYear()}`,
    endDate: `${String(e.getUTCDate()).padStart(2, '0')}/${String(e.getUTCMonth() + 1).padStart(2, '0')}/${e.getUTCFullYear()}`,
    reportData,
    grandTotal,
  }];
}

async function getInHouseGuestListing(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const start = params.startDate ? new Date(`${params.startDate.slice(0, 10)}T00:00:00Z`) : new Date(`${businessDate}T00:00:00Z`);
  const end = params.endDate ? new Date(`${params.endDate.slice(0, 10)}T23:59:59Z`) : new Date(`${businessDate}T23:59:59Z`);

  const statusFilter = [STATUS_RESERVATION_CHECK_IN, 1, 4];
  const reservations = await prisma.reservations.findMany({
    where: { property_id: pid, date: { gte: start, lte: end }, deleted_at: null, folios: { is: { status_reservation: { in: statusFilter }, first_name: { not: 'POS' } } } },
    select: { id: true, room_name: true, adult: true, child: true, room_type_id: true, folio_id: true },
    orderBy: { room_name: 'asc' },
  });
  const folioIds = [...new Set(reservations.map((r: any) => r.folio_id))];
  const folios = folioIds.length ? await prisma.folios.findMany({ where: { id: { in: folioIds } }, select: { id: true, complimentary: true, is_house_use: true } }) : [];
  const folioById = new Map(folios.map((f: any) => [f.id, f]));
  const typeIds = [...new Set(reservations.map((r: any) => r.room_type_id).filter((v: any) => v !== null))];
  const types = typeIds.length ? await prisma.room_types.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } }) : [];
  const typeById = new Map(types.map((t: any) => [t.id, t]));

  const roomTypeSummary: Record<string, number> = {};
  for (const r of reservations) {
    const name = r.room_type_id && typeById.get(r.room_type_id) ? typeById.get(r.room_type_id).name : 'Unknown';
    roomTypeSummary[name] = (roomTypeSummary[name] || 0) + 1;
  }
  const summary: any = {
    total_crt_room: 0, total_crd_room: 0, total_brd_room: 0,
    total_comp_room: 0, total_hse_room: 0, total_investor_room: 0,
    no_of_folios: reservations.length,
    total_adults: 0, total_child: 0,
  };
  for (const r of reservations) {
    const folio: any = folioById.get(r.folio_id);
    summary.total_adults += r.adult ?? 0;
    summary.total_child += r.child ?? 0;
    if (folio?.complimentary) summary.total_comp_room++;
    if (folio?.is_house_use) summary.total_hse_room++;
    const name = (r.room_type_id && typeById.get(r.room_type_id)?.name || '').toUpperCase();
    if (name === 'CRT') summary.total_crt_room++;
    else if (name === 'CRD') summary.total_crd_room++;
    else if (name === 'BRD') summary.total_brd_room++;
  }
  const staffId = params.staffId || 'all';
  let staffName = 'ALL STAFF';
  if (staffId !== 'all' && staffId !== 'system') {
    const staff = await prisma.users.findUnique({ where: { id: BigInt(staffId) }, select: { name: true } });
    staffName = staff?.name ?? 'Unknown';
  } else if (staffId === 'system') {
    staffName = 'SYSTEM';
  }

  return [{
    startDate: `${String(start.getUTCDate()).padStart(2, '0')}/${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`,
    endDate: `${String(end.getUTCDate()).padStart(2, '0')}/${String(end.getUTCMonth() + 1).padStart(2, '0')}/${end.getUTCFullYear()}`,
    folios: reservations,
    summary,
    staffName,
    roomTypeSummary: Object.entries(roomTypeSummary).map(([room_type_name, total]) => ({ room_type_name, total })),
  }];
}

async function getRoomTypeMonthlyReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const startDate = params.startDate ? params.startDate.slice(0, 10) : businessDate;
  const endDate = params.endDate ? params.endDate.slice(0, 10) : businessDate;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const virtualTypeIds = (await prisma.model_has_types.findMany({
    where: { model_type: 'App\\Models\\RoomType', types: { is: { group: 'room-type-grouping', name: { contains: 'Virtual', mode: 'insensitive' } } } },
    select: { model_id: true },
  })).map((m: any) => m.model_id);
  const roomTypes = (await prisma.room_types.findMany({
    where: { property_id: pid, deleted_at: null },
    select: { id: true, name: true },
  })).filter((t: any) => !t.name.toUpperCase().includes('VIRTUAL') && !virtualTypeIds.includes(t.id));

  const [rooms, reservations] = await Promise.all([
    prisma.rooms.findMany({ where: { property_id: pid, deleted_at: null, is_physical: true, status: 1 }, select: { id: true, room_type_id: true, room_status: true } }),
    prisma.reservations.findMany({
      where: { property_id: pid, date: { gte: start, lte: end }, deleted_at: null, folios: { is: { status_reservation: { not: STATUS_RESERVATION_CANCEL }, property_id: pid } } },
      select: { id: true, folio_id: true, room_type_id: true, adult: true, child: true, total: true, folios: { select: { id: true, type_reservation: true, check_in_date: true, check_out_date: true, status_reservation: true, is_house_use: true, complimentary: true } } },
    }),
  ]);

  const roomCounts: Record<string, any> = {};
  for (const r of rooms) {
    const key = r.room_type_id ? String(r.room_type_id) : '0';
    roomCounts[key] = roomCounts[key] || { totalRoom: 0, block: 0 };
    roomCounts[key].totalRoom++;
    if (r.room_status === 3 || r.room_status === 4) roomCounts[key].block++;
  }

  const reportData: Record<string, any> = {};
  const grandTotal: any = { totalRoom: 0, block: 0, nonGrp: { arr: 0, dep: 0, sty: 0, revenue: 0 }, grp: { arr: 0, dep: 0, sty: 0, revenue: 0 }, total: { arr: 0, dep: 0, sty: 0, revenue: 0 }, occupiedRooms: 0, aveNettRevenue: 0, occupancy: 0 };

  for (const rt of roomTypes) {
    const rtResvs = reservations.filter((r: any) => r.room_type_id === rt.id);
    const fitFolios = new Set<bigint>(), gitFolios = new Set<bigint>(), occFolios = new Set<bigint>();
    let nonGrpSty = 0, grpSty = 0, nonGrpRev = 0, grpRev = 0;
    const sameDay = (d: Date | null, target: string) => d ? formatDate(d) === target : false;
    for (const r of rtResvs) {
      const f = r.folios;
      if (!f) continue;
      const isFit = f.type_reservation === 'fit';
      if (isFit) {
        if (sameDay(f.check_in_date, startDate)) fitFolios.add(f.id);
        nonGrpSty += (r.adult ?? 0) + (r.child ?? 0);
        nonGrpRev += Number(r.total ?? 0);
      } else if (f.type_reservation === 'git') {
        if (sameDay(f.check_in_date, startDate)) gitFolios.add(f.id);
        grpSty += (r.adult ?? 0) + (r.child ?? 0);
        grpRev += Number(r.total ?? 0);
      }
      if (f.status_reservation === STATUS_RESERVATION_CHECK_IN || f.is_house_use || f.complimentary) occFolios.add(f.id);
    }
    const nonGrpArr = fitFolios.size, grpArr = gitFolios.size;
    const rc = roomCounts[String(rt.id)] || { totalRoom: 0, block: 0 };
    const totalRevenue = nonGrpRev + grpRev;
    const occupiedRooms = occFolios.size;
    const aveNettRevenue = occupiedRooms > 0 ? totalRevenue / occupiedRooms : 0;
    const occupancy = rc.totalRoom > 0 ? (occupiedRooms / rc.totalRoom) * 100 : 0;
    const roomTypeData = {
      totalRoom: rc.totalRoom,
      block: rc.block,
      nonGrp: { arr: nonGrpArr, dep: 0, sty: nonGrpSty, revenue: Number(nonGrpRev.toFixed(2)) },
      grp: { arr: grpArr, dep: 0, sty: grpSty, revenue: Number(grpRev.toFixed(2)) },
      total: { arr: nonGrpArr + grpArr, dep: 0, sty: nonGrpSty + grpSty, revenue: Number(totalRevenue.toFixed(2)) },
      occupiedRooms,
      aveNettRevenue: Number(aveNettRevenue.toFixed(2)),
      occupancy: Number(occupancy.toFixed(2)),
    };
    reportData[rt.name] = roomTypeData;
    grandTotal.totalRoom += roomTypeData.totalRoom;
    grandTotal.block += roomTypeData.block;
    for (const k of ['arr', 'dep', 'sty', 'revenue']) {
      (grandTotal.nonGrp as any)[k] += (roomTypeData.nonGrp as any)[k];
      (grandTotal.grp as any)[k] += (roomTypeData.grp as any)[k];
      (grandTotal.total as any)[k] += (roomTypeData.total as any)[k];
    }
    grandTotal.occupiedRooms += occupiedRooms;
  }
  grandTotal.aveNettRevenue = grandTotal.occupiedRooms > 0 ? grandTotal.total.revenue / grandTotal.occupiedRooms : 0;
  grandTotal.occupancy = grandTotal.totalRoom > 0 ? (grandTotal.occupiedRooms / grandTotal.totalRoom) * 100 : 0;

  return [{
    startDate: `${String(start.getUTCDate()).padStart(2, '0')}/${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`,
    endDate: `${String(end.getUTCDate()).padStart(2, '0')}/${String(end.getUTCMonth() + 1).padStart(2, '0')}/${end.getUTCFullYear()}`,
    reportData,
    grandTotal,
  }];
}

async function getSameDayCheckOutCheckInReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const startDate = params.startDate ? params.startDate.slice(0, 10) : businessDate;
  const endDate = params.endDate ? new Date(`${params.endDate.slice(0, 10)}T00:00:00Z`).getTime() + 30 * 86400000 : new Date(`${businessDate}T00:00:00Z`).getTime() + 30 * 86400000;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(endDate);

  const folios = await prisma.folios.findMany({
    where: { property_id: pid, deleted_at: null, check_in_date: { gte: start, lte: end }, guest_profile_id: { not: null } },
    select: { id: true, folio_number: true, check_in_date: true, guest_profile_id: true, company_profile_id: true, reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1, select: { id: true, rate_id: true, data: true } } },
  });
  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null))];
  const companyIds = [...new Set(folios.map((f: any) => f.company_profile_id).filter((v: any) => v !== null && v !== 0n))];
  const rateIds = [...new Set(folios.flatMap((f: any) => f.reservations?.[0]?.rate_id).filter((v: any) => v !== null))];
  const [guests, companies, rates] = await Promise.all([
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : [],
    companyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
    rateIds.length ? prisma.rates.findMany({ where: { id: { in: rateIds } }, select: { id: true, code: true } }) : [],
  ]);
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const companyById = new Map(companies.map((c: any) => [c.id, c]));
  const rateById = new Map(rates.map((r: any) => [r.id, r]));

  const allGuestIds = guestIds;
  const allFoliosByGuest = await prisma.folios.findMany({ where: { property_id: pid, deleted_at: null, guest_profile_id: { in: allGuestIds } }, select: { id: true, folio_number: true, guest_profile_id: true, check_in_date: true, check_out_date: true, company_profile_id: true, reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1, select: { rate_id: true, data: true } } } });

  const fmtDate = (d: Date | null) => d ? formatDate(d) : null;
  const reportData = [];
  for (const f of folios) {
    const prev = allFoliosByGuest.find((p: any) => p.guest_profile_id === f.guest_profile_id && fmtDate(p.check_out_date) === fmtDate(f.check_in_date));
    const rateOf = (res: any) => {
      let code = 'N/A', roomRate = 0;
      if (res?.rate_id) code = rateById.get(res.rate_id)?.code ?? 'N/A';
      if (res?.data) { try { const d = JSON.parse(res.data); roomRate = Number(d.rate_price ?? 0) || 0; } catch { /* ignore */ } }
      return { code, roomRate };
    };
    const prevRate = prev ? rateOf(prev.reservations?.[0]) : { code: 'N/A', roomRate: 0 };
    const toRate = rateOf(f.reservations?.[0]);
    const guest: any = guestById.get(f.guest_profile_id);
    reportData.push({
      guestName: guest ? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim() : 'N/A',
      fromCompany: prev?.company_profile_id ? companyById.get(prev.company_profile_id)?.name ?? 'N/A' : 'N/A',
      fromFolioNo: prev?.folio_number ?? 'N/A',
      fromRateCode: prevRate.code,
      fromRoomRate: prevRate.roomRate,
      toCompany: f.company_profile_id ? companyById.get(f.company_profile_id)?.name ?? 'N/A' : 'N/A',
      toFolioNo: f.folio_number ?? 'N/A',
      toRateCode: toRate.code,
      toRoomRate: toRate.roomRate,
      checkOutDate: f.check_in_date,
    });
  }

  return [{
    startDate: `${String(start.getUTCDate()).padStart(2, '0')}/${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`,
    endDate: `${String(end.getUTCDate()).padStart(2, '0')}/${String(end.getUTCMonth() + 1).padStart(2, '0')}/${end.getUTCFullYear()}`,
    reportData,
  }];
}

async function getTransactionByStaffReportFO(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const date = params.date || businessDate;
  const staffId = params.staffId || params.staff_id;
  if (!staffId) return [{ date, staffName: 'Unknown', reportData: [] }];

  const staff = await prisma.users.findUnique({ where: { id: BigInt(staffId) }, select: { name: true } });
  const start = new Date(`${date}T00:00:00Z`);
  const end = new Date(`${date}T23:59:59Z`);

  const transactions = await prisma.transactions.findMany({
    where: { property_id: pid, created_by: BigInt(staffId), created_at: { gte: start, lte: end }, deleted_at: null },
    select: {
      id: true, type: true, type_amount: true, total: true, remark: true, created_at: true,
      folio_id: true, model_type: true, model_id: true, card_name: true, last_digit_card: true,
      code_item_id: true, code_item_name: true,
    },
    orderBy: { created_at: 'asc' },
  });
  const folioIds = [...new Set(transactions.map((t: any) => t.folio_id).filter((v: any) => v !== null && v !== 0n))];
  const modelGuestIds = [...new Set(transactions.filter((t: any) => t.model_type === 'App\\Models\\GuestProfile').map((t: any) => t.model_id).filter((v: any) => v !== null))];
  const modelCompanyIds = [...new Set(transactions.filter((t: any) => t.model_type === 'App\\Models\\CompanyProfile').map((t: any) => t.model_id).filter((v: any) => v !== null))];
  const [folios, guests, companies, codeItems] = await Promise.all([
    folioIds.length ? prisma.folios.findMany({ where: { id: { in: folioIds } }, select: { id: true, folio_number: true, reservations: { where: { deleted_at: null }, orderBy: { date: 'desc' }, take: 1, select: { room_id: true } } } }) : [],
    modelGuestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: modelGuestIds } }, select: { id: true, first_name: true, last_name: true } }) : [],
    modelCompanyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: modelCompanyIds } }, select: { id: true, name: true } }) : [],
    transactions.length ? prisma.code_items.findMany({ where: { id: { in: [...new Set(transactions.map((t: any) => t.code_item_id).filter((v: any) => v !== null))] } }, select: { id: true, name: true } }) : [],
  ]);
  const folioById = new Map(folios.map((f: any) => [f.id, f]));
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const companyById = new Map(companies.map((c: any) => [c.id, c]));
  const codeItemById = new Map(codeItems.map((c: any) => [c.id, c]));
  const roomIds = [...new Set(folios.flatMap((f: any) => f.reservations?.[0]?.room_id).filter((v: any) => v !== null))];
  const rooms = roomIds.length ? await prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [];
  const roomById = new Map(rooms.map((r: any) => [r.id, r]));

  const grouped: Record<string, any> = {};
  for (const t of transactions) {
    const folio: any = t.folio_id ? folioById.get(t.folio_id) : null;
    const lastReservation = folio?.reservations?.[0];
    const room = lastReservation?.room_id ? roomById.get(lastReservation.room_id)?.name ?? 'N/A' : 'N/A';
    const model = t.model_type === 'App\\Models\\GuestProfile'
      ? (() => { const g: any = t.model_id ? guestById.get(t.model_id) : null; return g ? `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() : ''; })()
      : (t.model_type === 'App\\Models\\CompanyProfile' ? (t.model_id ? companyById.get(t.model_id)?.name ?? '' : '') : '');
    let description: string;
    const upperType = (t.type || '').toUpperCase();
    if (upperType === 'ROOM_REVENUE') {
      description = `Room Charge - ${folio?.folio_number ?? ''}`;
    } else if (t.type === 'extra_bed') {
      description = `Extra Bed - ${folio?.folio_number ?? ''}`;
    } else if (t.type && ['manual_posting', 'additional_item', 'room_inclusive', 'extra_bed_inclusive'].includes(t.type)) {
      description = `${folio?.folio_number ?? ''} - ${t.code_item_name ?? (t.code_item_id ? codeItemById.get(t.code_item_id)?.name ?? '' : '')}${t.remark ? ` - (${t.remark})` : ''}`;
    } else if (t.type === 'transfer' || t.type === 'transfer_out' || t.type === 'transfer_in') {
      description = `${(t.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} ${t.remark ?? ''}`;
    } else {
      description = `${(t.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} - ${folio?.folio_number ?? ''}${t.remark ? ` (${t.remark})` : ''}`;
    }
    const signed = t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0);
    const fmt = (d: Date | null) => d ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ', ' + String(d.getUTCDate()).padStart(2, '0') + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ':' + String(d.getUTCSeconds()).padStart(2, '0') : '';
    const row = {
      folio: folio?.folio_number ?? 'N/A',
      room,
      guest: model || 'N/A',
      postDateTime: fmt(t.created_at),
      description,
      card_name: t.card_name ?? '',
      last_digit_card: t.last_digit_card ? String(t.last_digit_card) : '',
      total: Number(signed.toFixed(2)),
    };
    const type = t.type || 'unknown';
    grouped[type] = grouped[type] || { type, transactions: [], total: 0 };
    grouped[type].transactions.push(row);
    grouped[type].total += signed;
  }

  return [{
    date: `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][start.getUTCDay()]}, ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][start.getUTCMonth()]} ${String(start.getUTCDate()).padStart(2, '0')}, ${start.getUTCFullYear()}`,
    staffName: staff?.name ?? 'Unknown',
    reportData: Object.values(grouped),
  }];
}

async function getAllCompaniesRoomRevenue(params: any): Promise<any[]> {
  const pid = Number(params.propertyId);
  const businessDate = await getBusinessDate(BigInt(pid));
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(params.startDate || '') ? params.startDate.slice(0, 10) : businessDate;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(params.endDate || '') ? params.endDate.slice(0, 10) : businessDate;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  const txns = await prisma.transaction_breakdowns.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      date: { gte: start, lte: end },
      is_transfer: 0,
      type: { notIn: ['payment', 'paidout', 'refund'] },
      folios: {
        is: {
          property_id: pid,
          deleted_at: null,
          OR: [
            { type_reservation: 'fit' },
            { type_reservation: 'git' },
            { type_reservation: 'vr', folio_number: { startsWith: 'F' } },
          ],
        },
      },
    },
    select: { id: true, transaction_id: true, date: true, type: true, type_amount: true, amount: true, total: true, code: true, folio_id: true },
  });
  if (!txns.length) {
    return [{ startDate, endDate, companies: [], grandTotal: { roomNights: 0, nettRevenue: 0, grossRevenue: 0, anrSum: 0, agrSum: 0, folioCount: 0, anr: 0, agr: 0 } }];
  }
  const codeIds = [...new Set(txns.map((t: any) => t.code).filter((v: any): v is string => v !== null && v !== undefined && v !== ''))];
  const cps = codeIds.length ? await prisma.code_posts.findMany({ where: { id: { in: codeIds.map((c: string) => BigInt(c)) }, deleted_at: null }, select: { id: true, name: true, code_billings: { select: { name: true } } } }) : [];
  const cpById = new Map(cps.map((cp: any) => [cp.id, cp]));
  const roomRevenueCodes = new Set(cps.filter((cp: any) => (cp.code_billings?.name || '').toLowerCase().includes('room revenue')).map((cp: any) => cp.id));
  const folioIds = [...new Set(txns.map((t: any) => t.folio_id).filter((v: any) => v !== null && v !== 0n))];
  const folios = folioIds.length ? await prisma.folios.findMany({
    where: { id: { in: folioIds }, deleted_at: null },
    select: { id: true, folio_number: true, company_profile_id: true, guest_profile_id: true, check_in_date: true, check_out_date: true, parent: true, type_reservation: true, reservations: { where: { deleted_at: null, property_id: pid }, orderBy: { date: 'asc' }, select: { id: true, date: true, room_id: true, room_type_id: true, rate_id: true } } },
  }) : [];
  const folioById = new Map(folios.map((f: any) => [f.id, f]));

  const parentGitIds = [...new Set(folios.filter((f: any) => f.type_reservation === 'git' && f.parent === 0n).map((f: any) => f.id))];
  const childFolios = parentGitIds.length ? await prisma.folios.findMany({ where: { parent: { in: parentGitIds }, property_id: pid, deleted_at: null }, select: { id: true, parent: true, reservations: { where: { deleted_at: null, property_id: pid }, orderBy: { date: 'asc' }, select: { id: true, date: true, room_id: true, room_type_id: true, rate_id: true } } }, orderBy: { id: 'asc' } }) : [];
  const childFolioByParent = new Map<bigint, any>();
  for (const f of childFolios) {
    if (!childFolioByParent.has(f.parent)) childFolioByParent.set(f.parent, f);
  }

  const companyIds = [...new Set(folios.map((f: any) => f.company_profile_id).filter((v: any) => v !== null && v !== 0n))];
  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null))];
  const roomIds = [...new Set(folios.flatMap((f: any) => f.reservations?.map((r: any) => r.room_id) ?? []).filter((v: any) => v !== null))];
  const [companies, guests, rooms] = await Promise.all([
    companyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: companyIds }, deleted_at: null }, select: { id: true, name: true } }) : [],
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds }, deleted_at: null }, select: { id: true, first_name: true, last_name: true } }) : [],
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds }, deleted_at: null }, select: { id: true, name: true } }) : [],
  ]);
  const companyById = new Map(companies.map((c: any) => [c.id, c]));
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const roomById = new Map(rooms.map((r: any) => [r.id, r]));

  const byCompany = new Map<bigint, any[]>();
  for (const t of txns) {
    if (!roomRevenueCodes.has(t.code ? BigInt(t.code) : -1n)) continue;
    const folio: any = t.folio_id ? folioById.get(t.folio_id) : null;
    if (!folio) continue;
    const key = folio.company_profile_id || 0n;
    const arr = byCompany.get(key) || [];
    arr.push({ t, folio });
    byCompany.set(key, arr);
  }

  const reportData = [];
  const grandTotal: any = { roomNights: 0, nettRevenue: 0, grossRevenue: 0, anrSum: 0, agrSum: 0, folioCount: 0, anr: 0, agr: 0 };
  for (const [companyId, rows] of byCompany) {
    const firstFolio: any = rows[0].folio;
    const companyName = companyId !== 0n && companyById.get(companyId) ? companyById.get(companyId).name : 'Unknown Company';
    const companyData: any = { name: companyName, folios: {}, total: { roomNights: 0, nettRevenue: 0, grossRevenue: 0, anrSum: 0, agrSum: 0, folioCount: 0 } };
    const roomRevenueIndex: Record<string, number> = {};
    for (const { t, folio } of rows) {
      const isParent = folio.type_reservation === 'git' && folio.parent === 0n;
      const sourceFolio = isParent ? (childFolioByParent.get(folio.id) || folio) : folio;
      const dateStr = formatDate(t.date);
      const dateResvs = sourceFolio.reservations?.filter((r: any) => formatDate(r.date) === dateStr) ?? [];
      const roomNights = dateResvs.length;
      const grossRevenue = t.type_amount === 'PLUS' ? Number(t.total ?? 0) : -Number(t.total ?? 0);
      const nettRevenue = t.type_amount === 'PLUS' ? Number(t.amount ?? 0) : -Number(t.amount ?? 0);
      const anr = roomNights > 0 ? nettRevenue / roomNights : 0;
      const agr = roomNights > 0 ? grossRevenue / roomNights : 0;
      const guest: any = folio.guest_profile_id ? guestById.get(folio.guest_profile_id) : null;
      const firstResv = dateResvs[0] || sourceFolio.reservations?.[0];
      const room: any = firstResv?.room_id ? roomById.get(firstResv.room_id) : null;
      companyData.folios[t.transaction_id ? String(t.transaction_id) : String(t.id)] = {
        folioNo: folio.folio_number ?? 'N/A',
        roomNo: room?.name ?? (sourceFolio.reservations?.[0]?.room_id ? (roomById.get(sourceFolio.reservations[0].room_id)?.name ?? 'N/A') : 'N/A'),
        guestName: `${guest?.first_name ?? ''} ${guest?.last_name ?? ''}`,
        arrivalDate: folio.check_in_date,
        depDate: folio.check_out_date,
        roomNights: t.type === 'room_revenue' ? roomNights : `0 ( ${cpById.get(t.code ? BigInt(t.code) : -1n)?.name ?? ''} ) `,
        nettRevenue,
        anr,
        grossRevenue,
        agr,
      };
      if (t.type === 'room_revenue') {
        companyData.total.roomNights += roomNights;
        roomRevenueIndex[folio.folio_number || ''] = 1 + (roomRevenueIndex[folio.folio_number || ''] ?? 0);
      }
      companyData.total.nettRevenue += nettRevenue;
      companyData.total.grossRevenue += grossRevenue;
      companyData.total.anrSum += anr;
      companyData.total.agrSum += agr;
      companyData.total.folioCount++;
    }
    companyData.total.anr = companyData.total.folioCount > 0 ? companyData.total.anrSum / companyData.total.folioCount : 0;
    companyData.total.agr = companyData.total.folioCount > 0 ? companyData.total.agrSum / companyData.total.folioCount : 0;
    reportData.push(companyData);
    grandTotal.nettRevenue += companyData.total.nettRevenue;
    grandTotal.grossRevenue += companyData.total.grossRevenue;
    grandTotal.anrSum += companyData.total.anrSum;
    grandTotal.agrSum += companyData.total.agrSum;
    grandTotal.folioCount += companyData.total.folioCount;
  }

  // getRoomReservation: reservations in range excluding cancelled/pending/house-use/complimentary/VR-non-F + rate company-type compliment/house-use
  const excludedTypeIds = (await prisma.types.findMany({
    where: { group: 'company-type', deleted_at: null, property_id: pid, OR: [{ name: { contains: 'compliment', mode: 'insensitive' } }, { name: { contains: 'house use', mode: 'insensitive' } }] },
    select: { id: true },
  })).map((t: any) => t.id);
  const excludedRateIds = excludedTypeIds.length ? (await prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\Rate', type_id: { in: excludedTypeIds } }, select: { model_id: true } })).map((m: any) => m.model_id) : [];
  const reservationsCount = await prisma.reservations.count({
    where: {
      property_id: pid,
      deleted_at: null,
      date: { gte: start, lte: end },
      OR: [{ rate_id: null }, { rate_id: { notIn: excludedRateIds } }],
      folios: {
        is: {
          property_id: pid,
          deleted_at: null,
          status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] },
          is_house_use: false,
          complimentary: false,
          OR: [
            { type_reservation: 'fit' },
            { type_reservation: 'git' },
            { type_reservation: 'vr', folio_number: { startsWith: 'F' } },
          ],
        },
      },
    },
  });
  grandTotal.roomNights = reservationsCount;
  grandTotal.anr = reservationsCount > 0 ? grandTotal.nettRevenue / reservationsCount : 0;
  grandTotal.agr = reservationsCount > 0 ? grandTotal.grossRevenue / reservationsCount : 0;

  return [{ startDate, endDate, companies: reportData, grandTotal }];
}

async function getMarketSegmentationReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const startDate = (params.startDate ? params.startDate.slice(0, 10) : businessDate);
  const endDate = (params.endDate ? params.endDate.slice(0, 10) : businessDate);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const reportData: Record<string, Record<string, any>> = {};
  for (let seg = 1; seg <= 4; seg++) {
    const group = `market-segment-${seg}`;
    const segments = await prisma.types.findMany({ where: { group, deleted_at: null }, select: { id: true, name: true } });
    for (const segment of segments) {
      const matchedFolioIds = (await prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\Folio', type_id: segment.id }, select: { model_id: true } })).map((m: any) => m.model_id);
      if (!matchedFolioIds.length) continue;
      const folios = await prisma.folios.findMany({
        where: { property_id: pid, check_in_date: { gte: start, lte: end }, deleted_at: null, id: { in: matchedFolioIds } },
        select: { id: true, check_in_date: true, check_out_date: true, company_profile_id: true },
      });
      if (!folios.length) continue;
      const companyIds = [...new Set(folios.map((f: any) => f.company_profile_id).filter((v: any) => v !== null && v !== 0n))];
      const companies = companyIds.length ? await prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, billing_country: true } }) : [];
      const companyById = new Map(companies.map((c: any) => [c.id, c]));
      const folioIds = folios.map((f: any) => f.id);
      const txns = await prisma.transactions.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null }, select: { folio_id: true, amount: true, total: true } });
      const txnByFolio = new Map<bigint, { net: number; gross: number }>();
      for (const t of txns) {
        const cur = txnByFolio.get(t.folio_id) || { net: 0, gross: 0 };
        cur.net += Number(t.amount ?? 0);
        cur.gross += Number(t.total ?? 0);
        txnByFolio.set(t.folio_id, cur);
      }
      for (const f of folios) {
        const company: any = f.company_profile_id && companyById.get(f.company_profile_id) ? companyById.get(f.company_profile_id) : null;
        const companyName = company?.name ?? 'N/A';
        const nationality = company?.billing_country ?? 'N/A';
        const nights = f.check_in_date && f.check_out_date ? Math.max(0, Math.round((f.check_out_date.getTime() - f.check_in_date.getTime()) / 86400000)) : 0;
        const { net, gross } = txnByFolio.get(f.id) || { net: 0, gross: 0 };
        reportData[segment.name] = reportData[segment.name] || {};
        reportData[segment.name][companyName] = reportData[segment.name][companyName] || { nationality, nights: 0, nettRevenue: 0, grossRevenue: 0 };
        reportData[segment.name][companyName].nights += nights;
        reportData[segment.name][companyName].nettRevenue += net;
        reportData[segment.name][companyName].grossRevenue += gross;
      }
    }
  }
  for (const segmentName of Object.keys(reportData)) {
    for (const companyName of Object.keys(reportData[segmentName])) {
      const c = reportData[segmentName][companyName];
      c.ANR = c.nights > 0 ? c.nettRevenue / c.nights : 0;
      c.AGR = c.nights > 0 ? c.grossRevenue / c.nights : 0;
    }
  }
  return [{ startDate, endDate, data: reportData }];
}

async function getNationalityStatisticsDetailed(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const startDate = (params.startDate ? params.startDate.slice(0, 10) : businessDate);
  const endDate = (params.endDate ? params.endDate.slice(0, 10) : businessDate);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const reservations = await prisma.reservations.findMany({
    where: { property_id: pid, date: { gte: start, lte: end }, deleted_at: null, folios: { is: { complimentary: false, is_house_use: false, status_reservation: { in: [STATUS_RESERVATION_CHECK_IN, 1] }, OR: [{ type_reservation: 'fit' }, { type_reservation: 'git' }, { type_reservation: 'vr', folio_number: { startsWith: 'F' } }] } } },
    select: { id: true, folio_id: true, date: true, adult: true, child: true, amount: true, rate_id: true, room_id: true, folios: { select: { id: true, folio_number: true, check_in_date: true, check_out_date: true, nationality_id: true, guest_profile_id: true, reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, select: { id: true, date: true, adult: true, child: true, room_id: true } } } } },
  });
  const rateIds = [...new Set(reservations.map((r: any) => r.rate_id).filter((v: any) => v !== null))];
  const rates = rateIds.length ? await prisma.rates.findMany({ where: { id: { in: rateIds } }, select: { id: true, rate_inclusives: { where: { status: 1 }, select: { id: true, cost: true, stock: true } } } }) : [];
  const stockIds = [...new Set(rates.flatMap((r: any) => r.rate_inclusives.map((ri: any) => ri.stock)).filter((v: any) => v !== null))];
  const codeItems = stockIds.length ? await prisma.code_items.findMany({ where: { id: { in: stockIds.map((s: string) => BigInt(s)) } }, select: { id: true, calculator: true } }) : [];
  const calculatorById = new Map(codeItems.map((c: any) => [c.id, c.calculator]));
  const inclusiveCostByRate = new Map<bigint, (adult: number, child: number) => number>();
  for (const rate of rates) {
    const rows = rate.rate_inclusives.map((ri: any) => ({
      cost: Number(ri.cost ?? 0),
      calculator: ri.stock ? calculatorById.get(BigInt(ri.stock)) : undefined,
    }));
    inclusiveCostByRate.set(rate.id, (adult: number, child: number) => rows.reduce((s: number, ri: any) => {
      if (ri.calculator === 'Adult') return s + ri.cost * adult;
      if (ri.calculator === 'Child') return s + ri.cost * child;
      return s + ri.cost;
    }, 0));
  }
  const guestIds = [...new Set(reservations.map((r: any) => r.folios?.guest_profile_id).filter((v: any) => v !== null))];
  const guests = guestIds.length ? await prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true, nationality_id: true } }) : [];
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const allNatIds = [...new Set([...reservations.map((r: any) => r.folios?.nationality_id), ...guests.map((g: any) => g.nationality_id)].filter((v: any) => v !== null))];
  const countries = allNatIds.length ? await prisma.countries.findMany({ where: { id: { in: allNatIds } }, select: { id: true, name: true } }) : [];
  const countryById = new Map(countries.map((c: any) => [c.id, c.name]));
  const roomIds = [...new Set(reservations.flatMap((r: any) => r.folios?.reservations?.map((res: any) => res.room_id) ?? []).filter((v: any) => v !== null))];
  const rooms = roomIds.length ? await prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [];
  const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));

  const byFolio = new Map<bigint, any[]>();
  for (const r of reservations) {
    const arr = byFolio.get(r.folio_id) || [];
    arr.push(r);
    byFolio.set(r.folio_id, arr);
  }

  const groups = new Map<string, any>();
  for (const [folioId, revs] of byFolio) {
    const first = revs[0];
    const folio = first.folios;
    if (!folio) continue;
    const nationalityId = folio.nationality_id ?? (folio.guest_profile_id ? guestById.get(folio.guest_profile_id)?.nationality_id ?? null : null);
    const nationalityName = nationalityId !== null && countryById.get(nationalityId) ? countryById.get(nationalityId) : 'UNASSIGN NATIONALITY';
    const nights = folio.reservations?.filter((res: any) => formatDate(res.date) >= startDate && formatDate(res.date) <= endDate).length ?? 0;
    let amount = 0;
    for (const res of revs) {
      const costFn = res.rate_id ? inclusiveCostByRate.get(res.rate_id) : undefined;
      const inclusiveCost = costFn ? costFn(res.adult ?? 0, res.child ?? 0) : 0;
      amount += Number(res.amount ?? 0) - inclusiveCost;
    }
    const ad = folio.reservations?.reduce((s: number, res: any) => s + (res.adult ?? 0), 0) / (folio.reservations?.length || 1);
    const ch = folio.reservations?.reduce((s: number, res: any) => s + (res.child ?? 0), 0) / (folio.reservations?.length || 1);
    const pax = ad + ch;
    const guest: any = folio.guest_profile_id ? guestById.get(folio.guest_profile_id) : null;
    const roomNames = [...new Set(folio.reservations?.map((res: any) => res.room_id ? roomById.get(res.room_id) : null).filter((v: any) => v !== null))];
    const key = nationalityId !== null ? String(nationalityId) : 'UNASSIGN';
    groups.set(key, groups.get(key) || { nationality: nationalityName, nights: 0, totalPax: 0, nettRoomRevenue: 0, guests: [] });
    const g = groups.get(key);
    g.nights += nights;
    g.nettRoomRevenue += amount;
    g.totalPax += pax;
    g.guests.push({
      docno: folio.folio_number,
      guestName: guest ? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim() : 'Unknown Guest',
      description: `Room charge #${roomNames.join('#')}`,
      noOfNights: nights,
      checkInDate: folio.check_in_date,
      checkOutDate: folio.check_out_date,
      pax: Math.round(pax),
      adult: Math.round(ad),
      child: Math.round(ch),
      revenue: amount,
    });
  }
  const reportData = [];
  for (const g of groups.values()) {
    g.arr = g.nights > 0 ? g.nettRoomRevenue / g.nights : 0;
    reportData.push(g);
  }
  return [{ startDate, endDate, reportData }];
}

async function getStaffSalesSummary(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const startDate = (params.startDate ? params.startDate.slice(0, 10) : businessDate);
  const endDate = (params.endDate ? params.endDate.slice(0, 10) : businessDate);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);
  const inRange = (d: Date | null) => d && d >= start && d <= end;

  const reservations = await prisma.reservations.findMany({
    where: { property_id: pid, date: { gte: start, lte: end }, deleted_at: null, folios: { is: { status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] }, OR: [{ type_reservation: 'fit' }, { type_reservation: 'git' }, { type_reservation: 'vr', folio_number: { startsWith: 'F' } }] } } },
    select: { id: true, folio_id: true, date: true, amount: true, total: true, folios: { select: { id: true, folio_number: true, company_profile_id: true, reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, select: { id: true, date: true, amount: true, total: true } } } } },
  });
  const companyIds = [...new Set(reservations.map((r: any) => r.folios?.company_profile_id).filter((v: any) => v !== null && v !== 0n))];
  const companies = companyIds.length ? await prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, staff_in_charge: true } }) : [];
  const companyById = new Map(companies.map((c: any) => [c.id, c]));
  const staffIds = [...new Set(companies.map((c: any) => c.staff_in_charge).filter((v: any) => v !== null && v !== '' && /^\d+$/.test(v)) )];
  const staff = staffIds.length ? await prisma.users.findMany({ where: { id: { in: staffIds.map((s: string) => BigInt(s)) } }, select: { id: true, name: true } }) : [];
  const staffById = new Map(staff.map((s: any) => [s.id, s.name]));

  const byStaff = new Map<string, any[]>();
  for (const r of reservations) {
    const company: any = r.folios?.company_profile_id ? companyById.get(r.folios.company_profile_id) : null;
    const staffId = company?.staff_in_charge && /^\d+$/.test(company.staff_in_charge) ? company.staff_in_charge : 'none';
    const arr = byStaff.get(staffId) || [];
    arr.push(r);
    byStaff.set(staffId, arr);
  }

  const reportData = [];
  const grandTotal: any = { nights: 0, nettRevenue: 0, grossRevenue: 0, anr: 0, agr: 0 };
  for (const [staffId, staffResvs] of byStaff) {
    const staffName = staffId !== 'none' && staffById.get(BigInt(staffId)) ? staffById.get(BigInt(staffId)) : 'Unknown Staff';
    const staffData: any = { name: staffName, companies: [], total: { nights: 0, nettRevenue: 0, grossRevenue: 0, anr: 0, agr: 0 } };
    const byCompany = new Map<bigint, any[]>();
    for (const r of staffResvs) {
      const key = r.folios?.company_profile_id || 0n;
      const arr = byCompany.get(key) || [];
      arr.push(r);
      byCompany.set(key, arr);
    }
    for (const [companyId, compResvs] of byCompany) {
      const company: any = companyId !== 0n && companyById.get(companyId) ? companyById.get(companyId) : null;
      const companyName = company?.name ?? 'Unknown Company';
      const folio = compResvs[0].folios;
      const folioResvs = folio?.reservations ?? [];
      const actualResvs = folioResvs.filter((res: any) => inRange(res.date));
      const nightsActual = actualResvs.length;
      const nightsProjection = folioResvs.length;
      const nettRevenue = compResvs.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
      const grossRevenue = compResvs.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0);
      const sumAmountAll = folioResvs.reduce((s: number, res: any) => s + Number(res.amount ?? 0), 0);
      const sumTotalAll = folioResvs.reduce((s: number, res: any) => s + Number(res.total ?? 0), 0);
      const listFolio: any[] = [];
      const byFolio = new Map<bigint, any[]>();
      for (const r of compResvs) {
        const arr = byFolio.get(r.folio_id) || [];
        arr.push(r);
        byFolio.set(r.folio_id, arr);
      }
      for (const [folioId, items] of byFolio) {
        listFolio.push({
          folio_number: folio?.folio_number,
          amount: Number(items.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0).toFixed(2)),
          total: Number(items.reduce((s: number, r: any) => s + Number(r.total ?? 0), 0).toFixed(2)),
          nights: items.length,
        });
      }
      const companyData = {
        name: companyName,
        total_projection: nightsProjection,
        total_actual: nightsActual,
        total_projection_rev: Number(sumTotalAll.toFixed(2)),
        total_actual_nett: Number(sumAmountAll.toFixed(2)),
        total_projection_nett: Number(sumAmountAll.toFixed(2)),
        total_actual_anr: nightsActual > 0 ? Number((sumAmountAll / nightsActual).toFixed(2)) : 0,
        total_projection_anr: nightsProjection > 0 ? Number((sumAmountAll / nightsProjection).toFixed(2)) : 0,
        total_actual_gross: nightsActual > 0 ? Number((sumTotalAll / nightsActual).toFixed(2)) : 0,
        total_projection_gross: nightsProjection > 0 ? Number((sumTotalAll / nightsProjection).toFixed(2)) : 0,
        total_actual_agr: nightsActual > 0 ? Number((sumTotalAll / nightsActual).toFixed(2)) : 0,
        nettRevenue: Number(nettRevenue.toFixed(2)),
        grossRevenue: Number(grossRevenue.toFixed(2)),
        anr: nightsActual > 0 ? Number((nettRevenue / nightsActual).toFixed(2)) : 0,
        agr: nightsActual > 0 ? Number((grossRevenue / nightsActual).toFixed(2)) : 0,
        projectRevenue: Number(sumAmountAll.toFixed(2)),
        listFolio,
      };
      staffData.companies.push(companyData);
      staffData.total.nights += nightsActual;
      staffData.total.nettRevenue += nettRevenue;
      staffData.total.grossRevenue += grossRevenue;
    }
    staffData.total.anr = staffData.total.nights > 0 ? staffData.total.nettRevenue / staffData.total.nights : 0;
    staffData.total.agr = staffData.total.nights > 0 ? staffData.total.grossRevenue / staffData.total.nights : 0;
    reportData.push(staffData);
    grandTotal.nights += staffData.total.nights;
    grandTotal.nettRevenue += staffData.total.nettRevenue;
    grandTotal.grossRevenue += staffData.total.grossRevenue;
  }
  grandTotal.anr = grandTotal.nights > 0 ? grandTotal.nettRevenue / grandTotal.nights : 0;
  grandTotal.agr = grandTotal.nights > 0 ? grandTotal.grossRevenue / grandTotal.nights : 0;

  return [{ startDate, endDate, reportData: { staffData: reportData, grandTotal } }];
}

async function getRoomOccupancyChart(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const startDate = (params.startDate ? params.startDate.slice(0, 10) : businessDate);
  const endDate = (params.endDate ? params.endDate.slice(0, 10) : businessDate);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const [totalRooms, outOfOrder, reservations] = await Promise.all([
    prisma.rooms.count({ where: { property_id: pid, deleted_at: null, status: 1 } }),
    prisma.rooms.count({ where: { property_id: pid, deleted_at: null, status: 1, room_status: 4 } }),
    prisma.reservations.findMany({
      where: { property_id: pid, date: { gte: start, lte: end }, deleted_at: null, folios: { is: { status_reservation: { not: STATUS_RESERVATION_CANCEL }, type_reservation: { in: ['fit', 'git'] }, property_id: pid } } },
      select: { id: true, folio_id: true, date: true, total: true, adult: true, child: true, folios: { select: { id: true, type_reservation: true, check_in_date: true, check_out_date: true } } },
    }),
  ]);

  const daily: Record<string, any> = {};
  const cursor = new Date(start);
  while (cursor <= end) {
    daily[formatDate(cursor)] = { non_grp_arr: 0, non_grp_dep: 0, non_grp_sty: 0, non_grp_revenue: 0, grp_arr: 0, grp_dep: 0, grp_sty: 0, grp_revenue: 0, total_guests: 0, occupied_rooms: 0 };
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const fitFolioArr = new Set<bigint>(), fitFolioDep = new Set<bigint>(), grpFolioArr = new Set<bigint>(), grpFolioDep = new Set<bigint>();
  for (const r of reservations) {
    const f = r.folios;
    if (!f) continue;
    const key = formatDate(r.date);
    if (!daily[key]) continue;
    const isFit = f.type_reservation === 'fit';
    const arrSet = isFit ? fitFolioArr : grpFolioArr;
    const depSet = isFit ? fitFolioDep : grpFolioDep;
    const d = daily[key];
    if (f.check_in_date && formatDate(f.check_in_date) === key && !arrSet.has(f.id)) { arrSet.add(f.id); isFit ? d.non_grp_arr++ : d.grp_arr++; }
    if (f.check_out_date && formatDate(f.check_out_date) === key && !depSet.has(f.id)) { depSet.add(f.id); isFit ? d.non_grp_dep++ : d.grp_dep++; }
    if (isFit) { d.non_grp_sty++; d.non_grp_revenue += Number(r.total ?? 0); }
    else { d.grp_sty++; d.grp_revenue += Number(r.total ?? 0); }
    d.total_guests += (r.adult ?? 0) + (r.child ?? 0);
    d.occupied_rooms++;
  }

  const data: Record<string, any> = {};
  for (const [date, d] of Object.entries(daily)) {
    const totalRevenue = d.non_grp_revenue + d.grp_revenue;
    const occupiedRooms = d.occupied_rooms;
    data[date] = {
      block_room: outOfOrder,
      total_guests: d.total_guests,
      non_grp: { arr: d.non_grp_arr, dep: d.non_grp_dep, sty: d.non_grp_sty, revenue: Number(d.non_grp_revenue.toFixed(2)) },
      grp: { arr: d.grp_arr, dep: d.grp_dep, sty: d.grp_sty, revenue: Number(d.grp_revenue.toFixed(2)) },
      total: { arr: d.non_grp_arr + d.grp_arr, dep: d.non_grp_dep + d.grp_dep, sty: d.non_grp_sty + d.grp_sty, revenue: Number(totalRevenue.toFixed(2)) },
      occupied_rooms: occupiedRooms,
      ave_nett_revenue: occupiedRooms > 0 ? Number((totalRevenue / occupiedRooms).toFixed(2)) : 0,
      occupancy: totalRooms > 0 ? Number(((occupiedRooms / totalRooms) * 100).toFixed(2)) : 0,
      daily_sell_code: '',
    };
  }

  const grandTotal: any = { block_room: outOfOrder, total_guests: 0, non_grp: { arr: 0, dep: 0, sty: 0, revenue: 0 }, grp: { arr: 0, dep: 0, sty: 0, revenue: 0 }, total: { arr: 0, dep: 0, sty: 0, revenue: 0 }, occupied_rooms: 0 };
  for (const day of Object.values<any>(data)) {
    grandTotal.total_guests += day.total_guests;
    for (const g of ['non_grp', 'grp', 'total']) {
      for (const k of ['arr', 'dep', 'sty', 'revenue']) {
        (grandTotal[g] as any)[k] += day[g][k];
      }
    }
    grandTotal.occupied_rooms += day.occupied_rooms;
  }
  grandTotal.block_room = Object.keys(data).length ? Object.values<any>(data)[0].block_room : 0;
  const days = Math.max(Object.keys(data).length, 1);
  grandTotal.ave_nett_revenue = grandTotal.occupied_rooms > 0 ? grandTotal.total.revenue / grandTotal.occupied_rooms : 0;
  grandTotal.occupancy = (totalRooms * days) > 0 ? (grandTotal.occupied_rooms / (totalRooms * days)) * 100 : 0;

  const dailyOccupancy: any[] = [];
  const dailyARR: any[] = [];
  for (const [date, day] of Object.entries<any>(data)) {
    dailyOccupancy.push({ date, occupancy: day.occupancy });
    dailyARR.push({ date, arr: day.ave_nett_revenue });
  }
  const keys = Object.keys(data);
  const weekly: any[] = [];
  let weekStart: Date | null = null;
  let weekData: number[] = [];
  for (const date of keys) {
    const cur = new Date(`${date}T00:00:00Z`);
    if (!weekStart) {
      weekStart = new Date(cur); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
      weekData = [];
    }
    const wsEnd = new Date(weekStart); wsEnd.setUTCDate(wsEnd.getUTCDate() + 6);
    if (cur >= weekStart && cur <= wsEnd) {
      weekData.push(data[date].occupancy);
    } else {
      if (weekData.length) weekly.push({ week: `${String(weekStart.getUTCDate()).padStart(2, '0')}/${String(weekStart.getUTCMonth() + 1).padStart(2, '0')}/${weekStart.getUTCFullYear()}`, occupancy: weekData.reduce((s: number, v: number) => s + v, 0) / weekData.length });
      weekStart = new Date(cur); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
      weekData = [data[date].occupancy];
    }
  }
  if (weekData.length) weekly.push({ week: `${String(weekStart!.getUTCDate()).padStart(2, '0')}/${String(weekStart!.getUTCMonth() + 1).padStart(2, '0')}/${weekStart!.getUTCFullYear()}`, occupancy: weekData.reduce((s: number, v: number) => s + v, 0) / weekData.length });
  const monthlyMap: Record<string, number[]> = {};
  for (const date of keys) {
    const month = `${date.slice(5, 7)}/${date.slice(0, 4)}`;
    monthlyMap[month] = monthlyMap[month] || [];
    monthlyMap[month].push(data[date].occupancy);
  }
  const monthly = Object.entries(monthlyMap).map(([month, values]) => ({ month, occupancy: values.reduce((s: number, v: number) => s + v, 0) / values.length }));

  return [{
    startDate: `${String(start.getUTCDate()).padStart(2, '0')}/${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`,
    endDate: `${String(end.getUTCDate()).padStart(2, '0')}/${String(end.getUTCMonth() + 1).padStart(2, '0')}/${end.getUTCFullYear()}`,
    data,
    chartData: { dailyOccupancy, dailyARR, weeklyOccupancy: weekly, monthlyOccupancy: monthly },
    grandTotal,
  }];
}

async function getRoomTypeRevenueReport(params: any): Promise<any> {
  const pid = params.propertyId;
  const start = params.startDate || params.date || formatDate(new Date());
  const end = params.endDate || start;

  const rows: any = await prisma.$queryRaw`
    WITH dates AS (
      SELECT generate_series(${start}::date, ${end}::date, '1 day')::date AS report_date
    ),
    room_stats AS (
      SELECT
        r.date::date AS report_date,
        SUM(CASE WHEN (f.folio_number NOT LIKE 'D%' OR f.check_in_date <> f.check_out_date)
            AND EXISTS (SELECT 1 FROM model_has_types nht JOIN types t ON nht.type_id = t.id WHERE nht.model_id = rt.id AND t.name ILIKE '%SUITE%')
            THEN 1 ELSE 0 END)::float8 AS total_suite,
        SUM(CASE WHEN (f.folio_number NOT LIKE 'D%' OR f.check_in_date <> f.check_out_date)
            AND EXISTS (SELECT 1 FROM model_has_types nht JOIN types t ON nht.type_id = t.id WHERE nht.model_id = rt.id AND t.name ILIKE '%DELUXE%')
            THEN 1 ELSE 0 END)::float8 AS total_deluxe,
        SUM(CASE WHEN f.folio_number LIKE 'D%' OR f.check_in_date = f.check_out_date THEN 1 ELSE 0 END)::float8 AS short_time,
        SUM(CASE WHEN (f.folio_number NOT LIKE 'D%' OR f.check_in_date <> f.check_out_date) AND EXISTS (SELECT 1 FROM model_has_types nht JOIN types t ON nht.type_id = t.id WHERE nht.model_id = rt.id AND (t.name ILIKE '%SUITE%' OR t.name ILIKE '%DELUXE%'))
            OR (f.folio_number LIKE 'D%' OR f.check_in_date = f.check_out_date) THEN 1 ELSE 0 END)::float8 AS total_room
      FROM reservations r
      JOIN folios f ON r.folio_id = f.id
      JOIN room_types rt ON r.room_type_id = rt.id
      WHERE f.property_id = ${pid}
        AND r.date >= ${start}::date AND r.date < (${end}::date + INTERVAL '1 day')
        AND f.status_reservation NOT IN (2, 5)
      GROUP BY r.date::date
    ),
    revenue AS (
      SELECT
        tb.date::date AS report_date,
        ROUND(SUM(CASE WHEN b.name ILIKE '%ROOM REVENUE%' THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.amount ELSE tb.amount END ELSE 0 END)::numeric, 4)::float8 AS total_income_hotel,
        ROUND(SUM(CASE WHEN b.name ILIKE '%RESTAURANT REVENUE%' THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.amount ELSE tb.amount END ELSE 0 END)::numeric, 4)::float8 AS total_income_fnb,
        COUNT(DISTINCT CASE WHEN b.name ILIKE '%RESTAURANT REVENUE%' THEN tb.id END)::float8 AS total_transaction_fnb,
        ROUND(SUM(CASE WHEN b.name ILIKE '%OTHERS REVENUE%' THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.amount ELSE tb.amount END ELSE 0 END)::numeric, 4)::float8 AS others_misc,
        ROUND(SUM(CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.amount ELSE tb.amount END)::numeric, 4)::float8 AS sub_total_revenue,
        ROUND(SUM(CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.pb1 ELSE tb.pb1 END)::numeric, 4)::float8 AS total_pb1,
        ROUND(SUM(CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.svr_chrg ELSE tb.svr_chrg END)::numeric, 4)::float8 AS total_service_charge,
        ROUND(SUM(CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END)::numeric, 4)::float8 AS total_revenue
      FROM transaction_breakdowns tb
      JOIN folios f ON tb.folio_id = f.id
      JOIN code_posts p ON tb.code = p.id::text
      JOIN code_billings b ON p.code_billing_id = b.id
      WHERE f.property_id = ${pid}
        AND tb.date >= ${start}::date AND tb.date < (${end}::date + INTERVAL '1 day')
        AND p.type = 'DEFAULT'
      GROUP BY tb.date::date
    ),
    payments AS (
      SELECT
        tb.date::date AS report_date,
        ROUND(-SUM(CASE WHEN p.name ILIKE '%cash%' THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END ELSE 0 END)::numeric, 4)::float8 AS cash,
        ROUND(-SUM(CASE WHEN p.name ILIKE 'db%' THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END ELSE 0 END)::numeric, 4)::float8 AS debit,
        ROUND(-SUM(CASE WHEN p.name ILIKE 'cc%' THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END ELSE 0 END)::numeric, 4)::float8 AS credit,
        ROUND(-SUM(CASE WHEN p.name ILIKE '%qris%' THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END ELSE 0 END)::numeric, 4)::float8 AS qris,
        ROUND(-SUM(CASE WHEN p.name ILIKE '%bank transfer%' THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END ELSE 0 END)::numeric, 4)::float8 AS transfer,
        ROUND(-SUM(CASE WHEN p.name ILIKE '%cityledger%' AND f.company_profile_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM model_has_types mht JOIN types t ON t.id = mht.type_id WHERE mht.model_id = f.company_profile_id AND mht.model_type = 'App\\Models\\CompanyProfile' AND t.group = 'company-type' AND t.name = 'CL')
            THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END ELSE 0 END)::numeric, 4)::float8 AS cl,
        ROUND(-SUM(CASE WHEN p.name ILIKE '%cityledger%' AND f.company_profile_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM model_has_types mht JOIN types t ON t.id = mht.type_id WHERE mht.model_id = f.company_profile_id AND mht.model_type = 'App\\Models\\CompanyProfile' AND t.group = 'company-type' AND t.name = 'OTA')
            THEN CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END ELSE 0 END)::numeric, 4)::float8 AS ota,
        ROUND(-SUM(CASE WHEN LOWER(tb.type_amount) = 'minus' THEN -tb.total ELSE tb.total END)::numeric, 4)::float8 AS total_payment
      FROM transaction_breakdowns tb
      JOIN folios f ON tb.folio_id = f.id
      JOIN code_posts p ON tb.code = p.id::text
      WHERE f.property_id = ${pid}
        AND tb.date >= ${start}::date AND tb.date < (${end}::date + INTERVAL '1 day')
        AND p.type = 'IS_PAYMENT'
      GROUP BY tb.date::date
    )
    SELECT
      d.report_date::date AS "date",
      COALESCE(rs.total_suite, 0) AS "Total Suite",
      COALESCE(rs.total_deluxe, 0) AS "Total Deluxe",
      COALESCE(rs.short_time, 0) AS "Short Time",
      COALESCE(rs.total_room, 0) AS "Total Room",
      COALESCE(r.total_income_hotel, 0) AS "TOTAL INCOME HOTEL",
      COALESCE(r.total_transaction_fnb, 0) AS "TOTAL FNB",
      COALESCE(r.total_income_fnb, 0) AS "TOTAL INCOME FNB",
      COALESCE(r.others_misc, 0) AS "OTHERS MISCELLANEOUS",
      COALESCE(r.sub_total_revenue, 0) AS "SUB TOTAL REVENUE",
      COALESCE(r.total_pb1, 0) AS "TOTAL PB1",
      COALESCE(r.total_service_charge, 0) AS "TOTAL SERVICE CHARGE",
      COALESCE(r.total_revenue, 0) AS "TOTAL REVENUE",
      COALESCE(p.cash, 0) AS cash,
      COALESCE(p.debit, 0) AS debit,
      COALESCE(p.credit, 0) AS credit,
      COALESCE(p.qris, 0) AS qris,
      COALESCE(p.cl, 0) AS cl,
      COALESCE(p.ota, 0) AS ota,
      COALESCE(p.transfer, 0) AS transfer,
      COALESCE(p.total_payment, 0) AS total_payment,
      COALESCE(r.total_revenue, 0) - COALESCE(p.total_payment, 0) AS "Balance"
    FROM dates d
    LEFT JOIN room_stats rs ON d.report_date = rs.report_date
    LEFT JOIN revenue r ON d.report_date = r.report_date
    LEFT JOIN payments p ON d.report_date = p.report_date
    ORDER BY d.report_date`;

  const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const rowsOut = rows.map((r: any, i: number) => {
    const dt = new Date(r.date);
    const tanggal = `${DAYS_ID[dt.getUTCDay()]}, ${String(dt.getUTCDate()).padStart(2, '0')} ${MONTHS_ID[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
    return { no: i + 1, tanggal, ...r, date: tanggal };
  });

  const sumK = (k: string) => rows.reduce((s: number, r: any) => s + Number(r[k] || 0), 0);
  const grandTotals = {
    total_suite: sumK('Total Suite'),
    total_deluxe: sumK('Total Deluxe'),
    short_time: sumK('Short Time'),
    total_room: sumK('Total Room'),
    total_income_hotel: sumK('TOTAL INCOME HOTEL'),
    total_fnb: sumK('TOTAL FNB'),
    total_income_fnb: sumK('TOTAL INCOME FNB'),
    others_misc: sumK('OTHERS MISCELLANEOUS'),
    sub_total_revenue: sumK('SUB TOTAL REVENUE'),
    total_pb1: sumK('TOTAL PB1'),
    total_service_charge: sumK('TOTAL SERVICE CHARGE'),
    total_revenue: sumK('TOTAL REVENUE'),
    cash: sumK('cash'),
    debit: sumK('debit'),
    credit: sumK('credit'),
    qris: sumK('qris'),
    cl: sumK('cl'),
    ota: sumK('ota'),
    transfer: sumK('transfer'),
    total_payment: sumK('total_payment'),
    balance: sumK('Balance'),
  };

  return {
    reportTitle: 'Room Type Revenue Report',
    startDate: start,
    endDate: end,
    rows: rowsOut,
    grandTotals,
  };
}

async function generateRoomTypeRevenueExcel(res: Response, data: any): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Type Revenue');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const nf = (v: any) => 'Rp ' + Number(v || 0).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const nfn = (v: any) => Number(v || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  const C = 23;

  ws.mergeCells(1, 1, 1, C);
  const title = ws.getCell(1, 1);
  title.value = String(data.reportTitle || 'Room Type Revenue Report').toUpperCase();
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  for (let i = 1; i <= C; i++) ws.getColumn(i).width = i === 2 ? 26 : 12;

  const r1 = ws.getRow(3);
  r1.values = ['No', 'Date', 'Room Only', '', '', 'Short Time', 'Total Room', 'Total Income Hotel', 'Total FnB', 'Total Income FnB', 'Others/Miscellaneous', 'PB1', 'Service Charge', 'Total Revenue', 'Cash', 'Debit', 'Credit', 'QRIS', 'CL', 'OTA', 'Transfer', 'Total Payment', 'Balance'];
  ws.mergeCells(3, 3, 3, 5);
  ws.mergeCells(3, 8, 3, 8);
  r1.font = { bold: true };
  r1.alignment = { horizontal: 'center' };
  r1.eachCell((c: any) => { c.border = border; });
  const r2 = ws.getRow(4);
  r2.values = ['', '', 'Suite', 'Deluxe', 'Total', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  r2.font = { bold: true };
  r2.alignment = { horizontal: 'center' };
  r2.eachCell((c: any) => { c.border = border; });

  let rn = 5;
  for (const r of data.rows || []) {
    ws.getRow(rn).values = [r.no, r.tanggal, nfn(r['Total Suite']), nfn(r['Total Deluxe']), nfn(Number(r['Total Suite']) + Number(r['Total Deluxe'])), nfn(r['Short Time']), nfn(r['Total Room']), nf(r['TOTAL INCOME HOTEL']), nfn(r['TOTAL FNB']), nf(r['TOTAL INCOME FNB']), nf(r['OTHERS MISCELLANEOUS']), nf(r['TOTAL PB1']), nf(r['TOTAL SERVICE CHARGE']), nf(r['TOTAL REVENUE']), r.cash ? nf(r.cash) : '', r.debit ? nf(r.debit) : '', r.credit ? nf(r.credit) : '', r.qris ? nf(r.qris) : '', r.cl ? nf(r.cl) : '', r.ota ? nf(r.ota) : '', r.transfer ? nf(r.transfer) : '', r.total_payment ? nf(r.total_payment) : '', Number(r.Balance || 0) !== 0 ? nf(r.Balance) : ''];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  const g = data.grandTotals || {};
  ws.getRow(rn).values = ['', 'TOTAL', nfn(g.total_suite), nfn(g.total_deluxe), nfn(Number(g.total_suite) + Number(g.total_deluxe)), nfn(g.short_time), nfn(g.total_room), nf(g.total_income_hotel), nfn(g.total_fnb), nf(g.total_income_fnb), nf(g.others_misc), nf(g.total_pb1), nf(g.total_service_charge), nf(g.total_revenue), g.cash ? nf(g.cash) : '', g.debit ? nf(g.debit) : '', g.credit ? nf(g.credit) : '', g.qris ? nf(g.qris) : '', g.cl ? nf(g.cl) : '', g.ota ? nf(g.ota) : '', g.transfer ? nf(g.transfer) : '', g.total_payment ? nf(g.total_payment) : '', nf(g.balance)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn += 2;
  ws.getRow(rn).values = ['TOTAL INCOME', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  ws.getRow(rn).font = { bold: true };
  rn++;
  ws.getRow(rn).values = ['Hotel', nf(g.total_income_hotel)];
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn++;
  ws.getRow(rn).values = ['FnB', g.total_income_fnb ? nf(g.total_income_fnb) : ''];
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn++;
  ws.getRow(rn).values = ['Others', g.others_misc ? nf(g.others_misc) : ''];
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="room-type-revenue-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function getOwiRevenueReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const start = params.startDate || params.date;
  const end = params.endDate || start;
  // Laravel OwiRevenueReportController: plain SQL on transaction_breakdowns,
  // date BETWEEN strings (end-day 00:00 exclusive), GROUP BY date ORDER BY date
  const rows: any = await prisma.$queryRaw`
    SELECT date,
           COALESCE(SUM(amount), 0)::float8 AS amount,
           COALESCE(SUM(pb1), 0)::float8 AS pb1,
           COALESCE(SUM(svr_chrg), 0)::float8 AS svr_chrg,
           COALESCE(SUM(total), 0)::float8 AS total
    FROM transaction_breakdowns
    WHERE date >= ${new Date(`${start}T00:00:00Z`)}
      AND date < ${new Date(`${end}T00:00:00Z`)} + INTERVAL '1 day'
      AND property_id = ${pid}
    GROUP BY date
    ORDER BY date ASC`;
  const list = (rows || []).map((r: any) => ({
    date: r.date ? new Date(r.date).toISOString().slice(0, 10) : '',
    amount: Number(r.amount || 0),
    pb1: Number(r.pb1 || 0),
    svr_chrg: Number(r.svr_chrg || 0),
    total: Number(r.total || 0),
  }));
  const grandTotals = list.reduce((acc: any, r: any) => ({
    amount: acc.amount + r.amount,
    pb1: acc.pb1 + r.pb1,
    svr_chrg: acc.svr_chrg + r.svr_chrg,
    total: acc.total + r.total,
  }), { amount: 0, pb1: 0, svr_chrg: 0, total: 0 });
  return [{ reportTitle: 'OWI Revenue Report', startDate: start, endDate: end, rows: list, grandTotals }];
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function getOccupancyRevenueMonthlyData(pid: number, mStart: Date, mEnd: Date, managementFeePercentage: number, totalRooms: number): Promise<any> {
  const resvs = await prisma.reservations.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      date: { gte: mStart, lte: mEnd },
      folios: {
        type_reservation: { not: 'vr' },
        status_reservation: { notIn: [STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING] },
      },
    },
    select: { id: true, date: true, data: true, folio_id: true },
  });
  const folioIds = [...new Set(resvs.map((r: any) => Number(r.folio_id)))];
  const folios = folioIds.length ? await prisma.folios.findMany({ where: { id: { in: folioIds } }, select: { id: true, guest_profile_id: true, company_profile_id: true } }) : [];
  const folioById = new Map(folios.map((f: any) => [Number(f.id), f]));
  const guestIds = [...new Set(folios.map((f: any) => (f.guest_profile_id === null || f.guest_profile_id === undefined ? null : Number(f.guest_profile_id))).filter((v: any): v is number => v !== null))];
  const companyIds = [...new Set(folios.map((f: any) => (f.company_profile_id === null || f.company_profile_id === undefined ? null : Number(f.company_profile_id))).filter((v: any): v is number => v !== null))];
  const [guests, companies] = await Promise.all([
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, mobile_phone: true } }) : [],
    companyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
  ]);
  const guestById = new Map(guests.map((g: any) => [Number(g.id), g]));
  const companyById = new Map(companies.map((c: any) => [Number(c.id), c]));

  const resByDay = new Map<string, any[]>();
  for (const r of resvs) {
    const k = formatDate(r.date);
    if (!resByDay.has(k)) resByDay.set(k, []);
    resByDay.get(k)!.push(r);
  }

  const dailyData: any[] = [];
  let totalRevenue = 0;
  let occupiedRoomCount = 0;
  for (let d = new Date(mStart); d <= mEnd; d = new Date(d.getTime() + 86400000)) {
    const dateStr = formatDate(d);
    const dayResvs = resByDay.get(dateStr) || [];
    const dayRevenue = dayResvs.reduce((s: number, r: any) => s + (safeParseJson(r.data)?.total ?? 0), 0);
    occupiedRoomCount += dayResvs.length;
    totalRevenue += dayRevenue;
    const bookings = dayResvs.map((r: any) => {
      const folio = folioById.get(Number(r.folio_id));
      const guest = folio ? (folio.guest_profile_id !== null && folio.guest_profile_id !== undefined ? guestById.get(Number(folio.guest_profile_id)) : undefined) : undefined;
      const company = folio ? (folio.company_profile_id !== null && folio.company_profile_id !== undefined ? companyById.get(Number(folio.company_profile_id)) : undefined) : undefined;
      return {
        guest_name: guest?.first_name ?? null,
        company: company?.name ?? null,
        phone: guest?.mobile_phone ?? null,
        amount: safeParseJson(r.data)?.total ?? 0,
      };
    });
    const parsed = new Date(`${dateStr}T00:00:00Z`);
    dailyData.push({
      date: `${DAY_SHORT[parsed.getUTCDay()]},${String(parsed.getUTCDate()).padStart(2, '0')} ${SHORT_MONTHS[parsed.getUTCMonth()]}`,
      bookings,
      revenue: dayRevenue,
    });
  }

  const totalDays = Math.round((mEnd.getTime() - mStart.getTime()) / 86400000) + 1;
  const occupancyRate = totalRooms * totalDays > 0 ? (occupiedRoomCount / (totalRooms * totalDays)) * 100 : 0;
  const managementFee = totalRevenue * (managementFeePercentage / 100);
  const averageRoomRate = occupiedRoomCount > 0 ? totalRevenue / occupiedRoomCount : 0;

  return {
    daily_data: dailyData,
    occupancy_rate: Math.round(occupancyRate * 100) / 100,
    total_revenue: totalRevenue,
    management_fee: managementFee,
    average_room_rate: averageRoomRate,
  };
}

async function getOccupancyRevenueReport(params: any): Promise<any[]> {
  const pid = Number(params.propertyId);
  const now = new Date();
  const startStr = params.startDate || params.date || formatDate(now);
  const endStr = params.endDate || startStr;
  const mgmt = params.management_fee !== undefined && params.management_fee !== null && params.management_fee !== '' ? Number(params.management_fee) : 20;
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T23:59:59.999Z`);
  const totalRooms = await prisma.rooms.count({ where: { property_id: pid, deleted_at: null, status: 1 } });

  const monthlyData: any = {};
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur <= lastMonth) {
    let mStart = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
    let mEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    if (cur.getUTCFullYear() === start.getUTCFullYear() && cur.getUTCMonth() === start.getUTCMonth()) {
      mStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    }
    if (cur.getUTCFullYear() === end.getUTCFullYear() && cur.getUTCMonth() === end.getUTCMonth()) {
      mEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    }
    monthlyData[LONG_MONTHS[cur.getUTCMonth()]] = await getOccupancyRevenueMonthlyData(pid, mStart, mEnd, mgmt, totalRooms);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  return [{ monthlyData, startDate: startStr, endDate: endStr, managementFeePercentage: mgmt, year: start.getUTCFullYear() }];
}

async function getFinancialMonthlyData(pid: number, mStart: Date, mEnd: Date, totalRooms: number): Promise<any> {
  const resvs = await prisma.reservations.findMany({
    where: {
      property_id: pid,
      deleted_at: null,
      date: { gte: mStart, lte: mEnd },
      folios: {
        type_reservation: { not: 'vr' },
        status_reservation: { notIn: [STATUS_RESERVATION_PENDING, STATUS_RESERVATION_CANCEL] },
      },
    },
    select: { data: true },
  });
  const totalDays = Math.round((mEnd.getTime() - mStart.getTime()) / 86400000) + 1;
  const occupiedRoomDays = resvs.length;
  const occupancyRate = totalRooms * totalDays > 0 ? (occupiedRoomDays / (totalRooms * totalDays)) * 100 : 0;
  const netRevenue = resvs.reduce((s: number, r: any) => s + (safeParseJson(r.data)?.total ?? 0), 0);
  const averageRoomRate = occupiedRoomDays > 0 ? netRevenue / occupiedRoomDays : 0;

  const tbWhere = {
    property_id: pid,
    deleted_at: null,
    is_posting: 1,
    date: { gte: mStart, lte: mEnd },
  };
  const [advancePayments, realizedRevenue, otherRevenue] = await Promise.all([
    prisma.transaction_breakdowns.aggregate({
      where: {
        property_id: pid,
        deleted_at: null,
        is_posting: 1,
        date: { lte: mStart },
        folios: {
          OR: [
            { status_reservation: STATUS_RESERVATION_RESERVATION },
            { check_in_date: { gt: mStart } },
          ],
        },
      },
      _sum: { total: true },
    }),
    prisma.transaction_breakdowns.aggregate({
      where: { ...tbWhere, type: 'room_revenue' },
      _sum: { total: true },
    }),
    prisma.transaction_breakdowns.aggregate({
      where: { ...tbWhere, type: { not: 'room_revenue' } },
      _sum: { total: true },
    }),
  ]);

  return {
    occupancy_rate: Math.round(occupancyRate * 100) / 100,
    average_room_rate: Math.round(averageRoomRate * 100) / 100,
    net_revenue: netRevenue,
    advance_payment: Number(advancePayments._sum.total || 0),
    unrealized_revenue: 0,
    realized_revenue: Number(realizedRevenue._sum.total || 0),
    other_revenue: Number(otherRevenue._sum.total || 0),
    cash_income: netRevenue,
  };
}

async function getFinancialReport(params: any): Promise<any[]> {
  const pid = Number(params.propertyId);
  const now = new Date();
  const startStr = params.startDate || params.date || `${now.getUTCFullYear()}-01-01`;
  const endStr = params.endDate || startStr;
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T23:59:59.999Z`);
  const totalRooms = await prisma.rooms.count({ where: { property_id: pid, deleted_at: null, status: 1 } });

  const monthlyData: any = {};
  let previousRevenue = 0;
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    const mStart = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
    const mEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const monthData = await getFinancialMonthlyData(pid, mStart, mEnd, totalRooms);
    if (previousRevenue > 0) {
      monthData.growth = Math.round(((monthData.net_revenue - previousRevenue) / previousRevenue) * 100 * 10) / 10;
    } else {
      monthData.growth = 0;
    }
    previousRevenue = monthData.net_revenue;
    monthlyData[LONG_MONTHS[cur.getUTCMonth()]] = monthData;
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  return [{ monthlyData, year: start.getUTCFullYear() }];
}

async function getAllCompaniesRoomRevenueBreakdown(params: any): Promise<any[]> {
  const pid = Number(params.propertyId);
  const businessDate = await getBusinessDate(BigInt(pid));
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(params.startDate || '') ? params.startDate.slice(0, 10) : businessDate;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(params.endDate || '') ? params.endDate.slice(0, 10) : businessDate;

  const results: any[] = await prisma.$queryRaw`
    SELECT
      f.folio_number,
      f.company_name,
      CONCAT(f.first_name, ' ', f.last_name) AS guest_name,
      f.check_in_date,
      f.check_out_date,
      (SELECT r.room_name FROM reservations r WHERE r.folio_id = f.id ORDER BY r.id DESC LIMIT 1) AS room_no,
      case when t.is_void = 1 OR t.is_transfer = 1 then 0 else
      CASE WHEN DATEDIFF(f.check_out_date, f.check_in_date) > 0 THEN 1 ELSE 0 END END AS guest_stay,
      CASE
        WHEN t.is_void = 1 THEN 'Void Transaction'
        WHEN t.is_transfer = 1 THEN 'Transfer Transaction'
        ELSE 'Posting Transaction'
      END AS transaction_type,
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.amount AS DECIMAL(18,2)) ELSE CAST(tb.amount AS DECIMAL(18,2)) END AS amount,
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.amount AS DECIMAL(18,2)) ELSE CAST(tb.amount AS DECIMAL(18,2)) END AS anr,
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.total AS DECIMAL(18,2)) ELSE CAST(tb.total AS DECIMAL(18,2)) END AS total,
      CASE WHEN tb.type_amount = 'Minus' THEN -CAST(tb.total AS DECIMAL(18,2)) ELSE CAST(tb.total AS DECIMAL(18,2)) END AS agr,
      t.is_void
    FROM transaction_breakdowns tb
    JOIN transactions t ON tb.transaction_id = t.id
    JOIN folios f ON tb.folio_id = f.id
    JOIN code_posts p ON tb.code = p.id
    JOIN code_billings b ON p.code_billing_id = b.id
    WHERE f.property_id = ${pid}
    AND tb.date BETWEEN ${startDate} AND ${endDate}
    AND b.name LIKE 'ROOM%'
    ORDER BY f.company_name, f.folio_number,
    CASE WHEN t.is_void = 1 THEN 3 WHEN t.is_transfer = 1 THEN 2 ELSE 1 END, tb.date
  `;

  const companies: any = {};
  const grandTotal: any = { roomNights: 0, nettRevenue: 0, grossRevenue: 0 };
  const voidSummary: any = { roomNights: 0, nettRevenue: 0, grossRevenue: 0 };
  const transferSummary: any = { roomNights: 0, nettRevenue: 0, grossRevenue: 0 };

  for (const row of results) {
    const compName = row.company_name ?? 'INDIVIDUAL / OTHER';
    if (!companies[compName]) {
      companies[compName] = { name: compName, folios: [], total: { roomNights: 0, nettRevenue: 0, grossRevenue: 0 } };
    }
    companies[compName].folios.push(row);
    const roomNights = row.guest_stay ?? 0;
    companies[compName].total.roomNights += roomNights;
    companies[compName].total.nettRevenue += Number(row.amount ?? 0);
    companies[compName].total.grossRevenue += Number(row.total ?? 0);
    grandTotal.roomNights += roomNights;
    grandTotal.nettRevenue += Number(row.amount ?? 0);
    grandTotal.grossRevenue += Number(row.total ?? 0);
    if (row.is_void !== null && row.is_void !== undefined && Number(row.is_void) === 1) {
      voidSummary.roomNights += 0;
      voidSummary.nettRevenue += Number(row.amount ?? 0);
      voidSummary.grossRevenue += Number(row.total ?? 0);
    }
    if (row.is_transfer !== null && row.is_transfer !== undefined && Number(row.is_transfer) === 1) {
      transferSummary.roomNights += 0;
      transferSummary.nettRevenue += Number(row.amount ?? 0);
      transferSummary.grossRevenue += Number(row.total ?? 0);
    }
  }

  grandTotal.anr = grandTotal.roomNights > 0 ? grandTotal.nettRevenue / grandTotal.roomNights : 0;
  grandTotal.agr = grandTotal.roomNights > 0 ? grandTotal.grossRevenue / grandTotal.roomNights : 0;
  voidSummary.anr = voidSummary.roomNights > 0 ? voidSummary.nettRevenue / voidSummary.roomNights : 0;
  voidSummary.agr = voidSummary.roomNights > 0 ? voidSummary.grossRevenue / voidSummary.roomNights : 0;
  transferSummary.anr = transferSummary.roomNights > 0 ? transferSummary.nettRevenue / transferSummary.roomNights : 0;
  transferSummary.agr = transferSummary.roomNights > 0 ? transferSummary.grossRevenue / transferSummary.roomNights : 0;

  return [{ startDate, endDate, companies, grandTotal, voidSummary, transferSummary }];
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
  'account/cash-detailed': (p: any) => getCashDetailed(p, true),
  'account/payment-detailed': (p: any) => getCashDetailed(p, false),
  'account/cash-summary': getCashSummary,
  'batch/frontoffice/daily-sales-report': getDailySalesReport,
  'batch/frontoffice/daily-revenue-report': getDailyRevenueReport,
  'account/guest-ledger-report': getGuestLedgerReport,
  'account/on-resv-bal': getOnResvBal,
  'account/on-resbal': getOnResvBal,
  'account/on-resbal/view': getOnResvBal,
  'batch/after-night-audit/in-house-foliobal': getInHouseFolioBalance,
  'batch/after-night-audit/on-resbal': getOnResvBal,
  'batch/after-night-audit/on-resbal/view': getOnResvBal,
  'batch/before-night-audit/before-in-house-foliobal': getInHouseFolioBalance,
  'batch/housekeeping/room-status-report': getRoomStatusReport,
  'batch/housekeeping/block-rooms-report': getBlockRoomsReport,
  'batch/housekeeping/room-change-history': getRoomChangeHistory,
  'batch/frontoffice/cancellation-listing': getCancellationListing,
  'batch/frontoffice/birthday-report': getBirthdayReport,
  'batch/after-night-audit/roomtype-utilization': getRoomTypeUtilization,
  'batch/after-night-audit/inclusive-items': getInclusiveItems,
  'batch/before-night-audit/rate-code-analysis': getRateCodeAnalysis,
  'batch/before-night-audit/vacant-and-dirty-rooms': getVacantAndDirtyRooms,
  'batch/after-night-audit/daily-room-forecast': getDailyRoomForecast,
  'batch/before-night-audit/breakfast-report': getBreakfastReport,
  'batch/before-night-audit/room-revenue-breakdown': getRoomRevenueBreakdown,
  'account/comission-for-booking': (p: any) => getCommissionForBooking(p, false),
  'account/comission-for-booking-company': (p: any) => getCommissionForBooking(p, true),
  'account/tax-breakdown-summary': getTaxBreakdownSummary,
  'account/in-house-folio-bal-history': getInHouseFolioBalHistory,
  'account/transaction-report-by-staff': getTransactionReportByStaff,
  'account/daily-revenue-report': getAccountDailyRevenueReport,
  'account/tax-breakdown-detail': getTaxBreakdownDetailJob,
  'account/daily-sales-report': getAccountDailySalesReport,
  'account/daily-statistic-report': getDailyStatisticReport,
  'account/room-type-revenue-report': getRoomTypeRevenueReport,
  'account/owi-revenue-report': getOwiRevenueReport,
  'occupancy-revenue-report': getOccupancyRevenueReport,
  'financial-report': getFinancialReport,
  'batch/sales-marketing/all-companies-room-revenue-breakdown-report': getAllCompaniesRoomRevenueBreakdown,
  'batch/frontoffice/free-of-charge-detail-report': getFreeOfChargeDetailReport,
  'batch/frontoffice/reservations-by-staff': getReservationsByStaffReport,
  'batch/frontoffice/room-type-detailed-report': getRoomTypeDetailedReport,
  'batch/frontoffice/in-house-guest-listing': getInHouseGuestListing,
  'batch/frontoffice/room-type-monthly-report': getRoomTypeMonthlyReport,
  'batch/frontoffice/same-day-check-out-check-in-report': getSameDayCheckOutCheckInReport,
  'batch/frontoffice/transaction-by-staff-report': getTransactionByStaffReportFO,
  'batch/sales-marketing/all-companies-room-revenue': getAllCompaniesRoomRevenue,
  'batch/sales-marketing/market-segmentation-report': getMarketSegmentationReport,
  'batch/sales-marketing/nationality-statistics-detailed': getNationalityStatisticsDetailed,
  'batch/sales-marketing/staff-sales-summary': getStaffSalesSummary,
  'batch/sales-marketing/room-occupancy-chart': getRoomOccupancyChart,
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
  'account/cash-detailed/view': (p: any) => getCashDetailed(p, true),
  'account/payment-detailed/view': (p: any) => getCashDetailed(p, false),
  'account/cash-summary/view': getCashSummary,
  'batch/frontoffice/daily-sales-report/view': getDailySalesReport,
  'batch/frontoffice/daily-revenue-report/view': getDailyRevenueReport,
  'account/guest-ledger-report/view': getGuestLedgerReport,
  'account/on-resv-bal/view': getOnResvBal,
  'batch/after-night-audit/in-house-foliobal/view': getInHouseFolioBalance,
  'batch/before-night-audit/before-in-house-foliobal/view': getInHouseFolioBalance,
  'batch/housekeeping/room-status-report/view': getRoomStatusReport,
  'batch/housekeeping/block-rooms-report/view': getBlockRoomsReport,
  'batch/housekeeping/room-change-history/view': getRoomChangeHistory,
  'batch/frontoffice/cancellation-listing/view': getCancellationListing,
  'batch/frontoffice/birthday-report/view': getBirthdayReport,
  'batch/after-night-audit/roomtype-utilization/view': getRoomTypeUtilization,
  'batch/after-night-audit/inclusive-items/view': getInclusiveItems,
  'batch/before-night-audit/rate-code-analysis/view': getRateCodeAnalysis,
  'batch/before-night-audit/vacant-and-dirty-rooms/view': getVacantAndDirtyRooms,
  'batch/after-night-audit/daily-room-forecast/view': getDailyRoomForecast,
  'batch/before-night-audit/breakfast-report/view': getBreakfastReport,
  'batch/before-night-audit/room-revenue-breakdown/view': getRoomRevenueBreakdown,
  'account/comission-for-booking/view': (p: any) => getCommissionForBooking(p, false),
  'account/comission-for-booking-company/view': (p: any) => getCommissionForBooking(p, true),
  'account/tax-breakdown-summary/view': getTaxBreakdownSummary,
  'account/in-house-folio-bal-history/view': getInHouseFolioBalHistory,
  'account/transaction-report-by-staff/view': getTransactionReportByStaff,
  'account/daily-revenue-report/view': getAccountDailyRevenueReport,
  'account/tax-breakdown-detail/view': getTaxBreakdownDetailJob,
  'account/daily-sales-report/view': getAccountDailySalesReport,
  'account/daily-statistic-report/view': getDailyStatisticReport,
  'batch/frontoffice/free-of-charge-detail-report/view': getFreeOfChargeDetailReport,
  'batch/frontoffice/reservations-by-staff/view': getReservationsByStaffReport,
  'batch/frontoffice/room-type-detailed-report/view': getRoomTypeDetailedReport,
  'batch/frontoffice/in-house-guest-listing/view': getInHouseGuestListing,
  'batch/frontoffice/room-type-monthly-report/view': getRoomTypeMonthlyReport,
  'batch/frontoffice/same-day-check-out-check-in-report/view': getSameDayCheckOutCheckInReport,
  'batch/frontoffice/transaction-by-staff-report/view': getTransactionByStaffReportFO,
  'batch/sales-marketing/all-companies-room-revenue/view': getAllCompaniesRoomRevenue,
  'batch/sales-marketing/market-segmentation-report/view': getMarketSegmentationReport,
  'batch/sales-marketing/nationality-statistics-detailed/view': getNationalityStatisticsDetailed,
  'batch/sales-marketing/staff-sales-summary/view': getStaffSalesSummary,
  'batch/sales-marketing/room-occupancy-chart/view': getRoomOccupancyChart,
  'batch/after-night-audit/tax-breakdown': getTaxBreakdownAfterNA,
  'batch/after-night-audit/tax-breakdown-summary': getTaxBreakdownSummaryAfterNA,
  'batch/before-night-audit/transaction-rpt': getTransactionRpt,
  'batch/frontoffice/transfer-transaction': getTransferTransaction,
  'batch/frontoffice/in-house-guest-detail': getInHouseGuestDetail,
  'batch/housekeeping/room-utilization-report': getRoomUtilizationReport,
  'account/tax-breakdown-detail-report': getTaxBreakdownDetail,
  'account/transaction-report-detail': getAccountTransactionReportDetail,
  'batch/after-night-audit/tax-breakdown/view': getTaxBreakdownAfterNA,
  'batch/after-night-audit/tax-breakdown-summary/view': getTaxBreakdownSummaryAfterNA,
  'batch/before-night-audit/transaction-rpt/view': getTransactionRpt,
  'batch/frontoffice/transfer-transaction/view': getTransferTransaction,
  'batch/frontoffice/in-house-guest-detail/view': getInHouseGuestDetail,
  'batch/housekeeping/room-utilization-report/view': getRoomUtilizationReport,
  'account/tax-breakdown-detail-report/view': getTaxBreakdownDetail,
  'account/transaction-report-detail/view': getAccountTransactionReportDetail,
  'report/weekly-booking': getWeeklyBooking,
  'report/calendar-operation': getCalendarOperation,
  'report/daily-checkin': getDailyCheckin,
  'report/company-profile': getCompanyProfile,
  'batch/frontoffice/guest-listing-report': getGuestListingReport,
  'report/weekly-booking/view': getWeeklyBooking,
  'report/calendar-operation/view': getCalendarOperation,
  'report/daily-checkin/view': getDailyCheckin,
  'report/company-profile/view': getCompanyProfile,
  'batch/frontoffice/guest-listing-report/view': getGuestListingReport,
};

// â”€â”€ Controller â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          role_id: user && user.role_id != null ? BigInt(user.role_id) : 0n,
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
        table: REPORT_PERMISSION_TABLE,
        permission: { view: true, add: true, edit: true, delete: true },
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
      console.error('Report permissionList error:', err);
      error(res, 'Failed to fetch report permissions list', 500);
    }
  }

  static async handleReport(req: Request, res: Response): Promise<void> {
    try {
      const rawPathParam = (req.params && (req.params[0] !== undefined ? req.params[0] : req.params.path)) as any;
      const path = typeof rawPathParam === 'string' ? rawPathParam : Array.isArray(rawPathParam) ? rawPathParam.join('/') : (rawPathParam || '');
      const pid = req.user?.lastProperty ?? 0n;
      const params = { ...parseReportParams(req), ...(req.query as any), propertyId: pid, folioId: req.query.folio_id as string || '' };

      const segments = path.split('/').filter(Boolean);
      const typeOps = req.query.typeOps as string || '';

      const reportKey = typeOps === 'view' ? `${path}/view` : path;

      if (reportHandlers[reportKey]) {
        const data = await reportHandlers[reportKey](params);

        if (typeOps === 'view') {
          if (reportKey === 'account/transaction-report/view') {
            await generateTransactionReportExcel(res, data);
            return;
          }
          if (reportKey === 'account/guest-ledger-report/view') {
            await generateGuestLedgerExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/daily-statistic/view') {
            await generateDailyStatisticExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/on-resv-bal/view' || reportKey === 'batch/after-night-audit/on-resbal/view' || reportKey === 'account/on-resv-bal/view' || reportKey === 'account/on-resbal/view') {
            await generateOnResvBalExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/roomtype-utilization/view') {
            await generateRoomTypeUtilizationExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/inclusive-items/view') {
            await generateInclusiveItemsExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/daily-room-forecast/view') {
            await generateDailyRoomForecastExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/room-division' || reportKey === 'batch/after-night-audit/room-division/view') {
            const fileName = 'room-division-report';
            await generateExcel(res, Array.isArray(data) ? data : [data], Object.keys((Array.isArray(data) ? data[0] : data) || {}).map((k) => ({
              header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              key: k,
            })), fileName);
            return;
          }
          if (reportKey === 'account/room-type-revenue-report/view') {
            await generateRoomTypeRevenueExcel(res, data);
            return;
          }
          if (reportKey === 'account/cash-summary/view') {
            await generateCashSummaryExcel(res, data);
            return;
          }
          if (reportKey === 'account/transaction-report-by-staff/view') {
            await generateTransactionReportByStaffExcel(res, Array.isArray(data) ? data[0] : data);
            return;
          }
          if (reportKey === 'account/cash-detailed/view' || reportKey === 'account/payment-detailed/view') {
            await generateCashDetailedExcel(res, data, reportKey.replace('/view', '').replace('account/', ''));
            return;
          }
          if (reportKey === 'account/daily-revenue-report/view') {
            await generateDailyRevenueExcel(res, data);
            return;
          }
          if (reportKey === 'account/daily-sales-report/view') {
            await generateDailySalesExcel(res, data);
            return;
          }
          if (reportKey === 'account/tax-breakdown-detail/view') {
            await generateTaxBreakdownDetailJobExcel(res, data);
            return;
          }
          if (reportKey === 'account/tax-breakdown-summary/view') {
            await generateTaxBreakdownSummaryExcel(res, data);
            return;
          }
          if (reportKey === 'account/tax-breakdown-detail-report/view') {
            await generateTaxBreakdownDetailExcel(res, data, 'tax-breakdown-detail-report');
            return;
          }
          if (reportKey === 'account/transaction-report-detail/view') {
            await generateTaxBreakdownDetailExcel(res, data, 'account-transaction-report-detail');
            return;
          }
          if (reportKey === 'batch/before-night-audit/transaction-rpt/view') {
            await generateTransactionRptExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/tax-breakdown/view') {
            await generateTaxBreakdownAfterNAExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/tax-breakdown-summary/view') {
            await generateTaxBreakdownSummaryAfterNAExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/transfer-transaction/view') {
            await generateTransferTransactionExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/in-house-guest-detail/view') {
            await generateInHouseGuestDetailExcel(res, data);
            return;
          }
          if (reportKey === 'batch/housekeeping/room-utilization-report/view') {
            await generateRoomUtilizationExcel(res, data);
            return;
          }
          if (reportKey === 'report/weekly-booking/view') {
            await generateWeeklyBookingExcel(res, data);
            return;
          }
          if (reportKey === 'report/calendar-operation/view') {
            await generateCalendarOperationExcel(res, data);
            return;
          }
          if (reportKey === 'report/daily-checkin/view') {
            await generateDailyCheckinExcel(res, data);
            return;
          }
          if (reportKey === 'report/company-profile/view') {
            await generateCompanyProfileExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/guest-listing-report/view') {
            await generateGuestListingExcel(res, data);
            return;
          }
          if (reportKey === 'account/owi-revenue-report/view') {
            await generateOwiRevenueExcel(res, data);
            return;
          }
          if (reportKey === 'account/in-house-folio-bal-history/view') {
            await generateInHouseFolioBalHistoryExcel(res, data);
            return;
          }
          if (reportKey === 'account/comission-for-booking/view' || reportKey === 'account/comission-for-booking-company/view') {
            await generateCommissionForBookingExcel(res, data);
            return;
          }
          if (reportKey.startsWith('account/')) {
            if (reportKey === 'account/daily-statistic-report/view') {
              const row = Array.isArray(data) ? data[0] : data;
              await generateDailyFlashExcel(res, row || {});
              return;
            }
            const baseKey = reportKey.replace('/view', '');
            const fileName = baseKey.replace('/', '-');
            await generateExcel(res, Array.isArray(data) ? data : [data], Object.keys((Array.isArray(data) ? data[0] : data) || {}).map((k) => ({
              header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              key: k,
            })), fileName);
            return;
          }
          if (reportKey === 'batch/after-night-audit/in-house-folio-balance/view') {
            await generateInHouseFolioBalanceExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/vacant-rooms/view') {
            await generateVacantRoomsExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/no-show/view') {
            await generateNoShowExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/nationality-statistic/view') {
            await generateNationalityStatisticExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/expected-arrival-summary/view') {
            await generateExpectedArrivalSummaryExcel(res, data);
            return;
          }
          if (reportKey === 'batch/after-night-audit/expected-departure-summary/view') {
            await generateExpectedDepartureSummaryExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/daily-sales-report/view') {
            await generateFrontOfficeDailySalesExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/daily-revenue-report/view') {
            await generateFrontOfficeDailyRevenueExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/cancellation-listing/view') {
            await generateCancellationListingExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/birthday-report/view') {
            await generateBirthdayReportExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/free-of-charge-detail-report/view') {
            await generateFreeOfChargeDetailExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/reservations-by-staff/view') {
            await generateReservationsByStaffExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/room-type-detailed-report/view') {
            await generateRoomTypeDetailedExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/in-house-guest-listing/view') {
            await generateInHouseGuestListingExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/room-type-monthly-report/view') {
            await generateRoomTypeMonthlyExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/same-day-check-out-check-in-report/view') {
            await generateSameDayCheckOutCheckInExcel(res, data);
            return;
          }
          if (reportKey === 'batch/frontoffice/transaction-by-staff-report/view') {
            await generateTransactionByStaffFOExcel(res, data);
            return;
          }
          if (reportKey === 'batch/housekeeping/room-status-report/view') {
            await generateRoomStatusReportExcel(res, data);
            return;
          }
          if (reportKey === 'batch/housekeeping/block-rooms-report/view') {
            await generateBlockRoomsReportExcel(res, data);
            return;
          }
          if (reportKey === 'batch/housekeeping/room-change-history/view') {
            await generateRoomChangeHistoryExcel(res, data);
            return;
          }
          if (reportKey === 'batch/before-night-audit/before-in-house-foliobal/view') {
            await generateInHouseFolioBalanceExcel(res, data);
            return;
          }
          if (reportKey === 'batch/before-night-audit/rate-code-analysis/view') {
            await generateRateCodeAnalysisExcel(res, data);
            return;
          }
          if (reportKey === 'batch/before-night-audit/vacant-and-dirty-rooms/view') {
            await generateVacantAndDirtyRoomsExcel(res, data);
            return;
          }
          if (reportKey === 'batch/before-night-audit/breakfast-report/view') {
            await generateBreakfastReportExcel(res, data);
            return;
          }
          if (reportKey === 'batch/before-night-audit/room-revenue-breakdown/view') {
            await generateRoomRevenueBreakdownExcel(res, data);
            return;
          }
          if (reportKey === 'batch/sales-marketing/all-companies-room-revenue/view') {
            await generateAllCompaniesRoomRevenueExcel(res, data);
            return;
          }
          if (reportKey === 'batch/sales-marketing/all-companies-room-revenue-breakdown-report/view') {
            await generateAllCompaniesRoomRevenueBreakdownExcel(res, data);
            return;
          }
          if (reportKey === 'batch/sales-marketing/market-segmentation-report/view') {
            await generateMarketSegmentationExcel(res, data);
            return;
          }
          if (reportKey === 'batch/sales-marketing/nationality-statistics-detailed/view') {
            await generateNationalityStatisticsDetailedExcel(res, data);
            return;
          }
          if (reportKey === 'batch/sales-marketing/staff-sales-summary/view') {
            await generateStaffSalesSummaryExcel(res, data);
            return;
          }
          if (reportKey === 'batch/sales-marketing/room-occupancy-chart/view') {
            await generateRoomOccupancyChartExcel(res, data);
            return;
          }
          if (reportKey.startsWith('batch/')) {
            const baseKey = reportKey.replace('/view', '');
            const fileName = baseKey.replace('/', '-');
            await generateExcel(res, Array.isArray(data) ? data : [data], Object.keys((Array.isArray(data) ? data[0] : data) || {}).map((k) => ({
              header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              key: k,
            })), fileName);
            return;
          }
          if (reportKey === 'occupancy-revenue-report/view') {
            await generateOccupancyRevenueReportExcel(res, data);
            return;
          }
          if (reportKey === 'financial-report/view') {
            await generateFinancialReportExcel(res, data);
            return;
          }
          if (['occupancy-revenue-report', 'financial-report'].includes(reportKey.replace('/view', ''))) {
            const baseKey = reportKey.replace('/view', '');
            const fileName = baseKey.replace('/', '-');
            await generateExcel(res, Array.isArray(data) ? data : [data], Object.keys((Array.isArray(data) ? data[0] : data) || {}).map((k) => ({
              header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              key: k,
            })), fileName);
            return;
          }
          const fileName = segments.join('-') || 'report';
          await generateExcel(res, Array.isArray(data) ? data : [data], Object.keys((Array.isArray(data) ? data[0] : data) || {}).map((k) => ({
            header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            key: k,
          })), fileName);
        } else {
          success(res, data, 'Success', 200, {
            pagination: {
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
          pagination: {
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
        const fileName = `folio-${folio.folio_number}-${documentType}`;
        await generateExcel(res, rows, Object.keys(rows[0] || {}).map((k) => ({
          header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          key: k,
        })), fileName);
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
        const fileName = `event-${id}-${reportType}`;
        await generateExcel(res, rows, Object.keys(rows[0] || {}).map((k) => ({
          header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          key: k,
        })), fileName);
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
        await generateExcel(res, rows, Object.keys(rows[0] || {}).map((k) => ({
          header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          key: k,
        })), 'company-profiles');
      } else {
        success(res, rows, 'Success', 200, {
          pagination: {
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

        await generateExcel(res, rows, Object.keys(rows[0] || {}).map((k) => ({
          header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          key: k,
        })), 'guest-listing-report');
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
          pagination: {
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


async function generateDailySalesExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Daily Sales');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const bold = { bold: true } as any;
  const nf2 = (v: any) => nf(v, 2);
  const pct1 = (v: any) => `${nf(v, 1)} %`;
  for (let i = 1; i <= 10; i++) ws.getColumn(i).width = i <= 2 ? 20 : 16;

  const title = ws.getCell(1, 1);
  title.value = `SALES SUMMARY AS AT ${row.date || ''}`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  ws.getCell(2, 1).value = `GENERAL MANAGER: ${row.generalManager || 'KURNIAWAN'}   |   CREATED BY: ${row.createdBy || 'FO MANAGER'}   |   CURRENCY: ${row.currency || 'IDR'}   |   1 YEN = ${row.exchangeRate ?? 100}`;

  // ── Table 1: stats ──
  const statRows: any[] = [
    { label: 'DAILY', data: row.dailyStats || {} },
    { label: 'MONTH TO DATE', data: row.mtdStats || {} },
    { label: 'FORECAST RESERVATION', data: row.forecastStats || {} },
  ];
  let rn = 4;
  const hdr1 = ws.getRow(rn);
  hdr1.values = ['', 'Total Rooms', 'Room Sold', 'Total Pax', 'Breakfast Rooms', 'Breakfast Pax', 'Last Year Room Sold', 'Occupancy', 'Last Year', 'Variance'];
  hdr1.font = bold;
  hdr1.alignment = { horizontal: 'center' };
  hdr1.eachCell((c: any) => { c.border = border; });
  rn++;
  for (const s of statRows) {
    const r = ws.getRow(rn);
    r.values = [s.label, nf(s.data.total_rooms), nf(s.data.room_sold), nf(s.data.total_pax), nf(s.data.breakfast_rooms), nf(s.data.breakfast_pax), nf(s.data.last_year_room_sold), `${nf(s.data.occupancy)}%`, `${nf(s.data.last_year_occupancy)}%`, nf(s.data.variance)];
    r.eachCell((c: any) => { c.border = border; });
    rn++;
  }

  // ── Table 2: balances ──
  rn++;
  const hdr2 = ws.getRow(rn);
  hdr2.values = ['', 'Total Revenue', 'Variable Cost', 'Fixed Cost', 'Difference', 'Win / Lose'];
  hdr2.font = bold;
  hdr2.alignment = { horizontal: 'center' };
  hdr2.eachCell((c: any) => { c.border = border; });
  rn++;
  for (const b of [row.actualBalance || {}, row.mtdBalance || {}]) {
    const r = ws.getRow(rn);
    r.values = [
      'BALANCE',
      `IDR ${nf2(b.total_revenue_idr)}\n¥ ${nf2(b.total_revenue_jpy)}`,
      `IDR ${nf2(b.variable_cost_idr)}\n¥ ${nf2(b.variable_cost_jpy)}`,
      `IDR ${nf2(b.fixed_cost_idr)}\n¥ ${nf2(b.fixed_cost_jpy)}`,
      `IDR ${nf2(b.difference_idr)}\n¥ ${nf2(b.difference_jpy)}`,
      b.win_lose || 'O',
    ];
    r.eachCell((c: any) => { c.border = border; });
    rn++;
  }

  // ── Table 3: room sales ──
  rn++;
  const hdr3 = ws.getRow(rn);
  hdr3.values = ['', 'Total Room Rev w/o Bfast', 'ARR', 'Average Rate / Pax', 'REVPAR', 'Last Year Room Rev', 'Last Year ARR', 'Last Year Avg Rate / Pax', 'Last Year Revpar'];
  hdr3.font = bold;
  hdr3.alignment = { horizontal: 'center' };
  hdr3.eachCell((c: any) => { c.border = border; });
  rn++;
  for (const [label, rs] of [['DAILY', row.roomSales?.daily || {}], ['MONTH TO DATE', row.roomSales?.mtd || {}]]) {
    ws.getRow(rn).values = [label, `IDR ${nf2(rs.room_revenue_idr)}\n¥ ${nf2(rs.room_revenue_jpy)}`, `IDR ${nf2(rs.arr_idr)}\n¥ ${nf2(rs.arr_jpy)}`, `IDR ${nf2(rs.avg_rate_pax_idr)}\n¥ ${nf2(rs.avg_rate_pax_jpy)}`, `IDR ${nf2(rs.revpar_idr)}\n¥ ${nf2(rs.revpar_jpy)}`, `IDR ${nf2(rs.last_year_room_revenue)}`, `IDR ${nf2(rs.last_year_arr)}`, `IDR ${nf2(rs.last_year_avg_rate_pax)}`, `IDR ${nf2(rs.last_year_revpar)}`];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = ['', `YTD ${pct1(rs.ytd_room_revenue)}`, `YTD ${pct1(rs.ytd_arr)}`, `YTD ${pct1(rs.ytd_avg_rate_pax)}`, `YTD ${pct1(rs.ytd_revpar)}`, `VARIANCE IDR ${nf2(rs.room_revenue_variance)}`, `VARIANCE IDR ${nf2(rs.arr_variance)}`, `VARIANCE IDR ${nf2(rs.avg_rate_pax_variance)}`, `VARIANCE IDR ${nf2(rs.revpar_variance)}`];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }

  // ── Table 4: revenue breakdown ──
  rn++;
  const hdr4 = ws.getRow(rn);
  hdr4.values = ['', 'Current IDR', 'Current JPY', 'Last Year', 'Year To Date', 'Variance'];
  hdr4.font = bold;
  hdr4.alignment = { horizontal: 'center' };
  hdr4.eachCell((c: any) => { c.border = border; });
  rn++;
  const revLabels: [string, string][] = [
    ['room_revenue', 'Total Room Rev w/o Bfast'],
    ['breakfast_revenue', 'Total Breakfast'],
    ['dine_in_revenue', 'Dine-In Revenue'],
    ['room_service_revenue', 'Room Service Revenue'],
    ['minimart_revenue', 'FO Minimart Revenue'],
    ['fb_other_revenue', 'Total FB Other'],
    ['banquet_revenue', 'Total Banquet'],
    ['others_revenue', 'Total Others Revenue'],
    ['total_nett_revenue', 'Total Nett Revenue'],
  ];
  for (const [label, block] of [['DAILY', row.dailyRevenue || {}], ['MONTH TO DATE', row.mtdRevenue || {}]]) {
    ws.getRow(rn).values = [label];
    ws.getRow(rn).font = bold;
    rn++;
    for (const [key, l] of revLabels) {
      const e = block[key] || {};
      const r = ws.getRow(rn);
      r.values = [l, nf2(e.idr), nf2(e.jpy), nf2(e.last_year), pct1(e.ytd), nf2(e.variance)];
      r.eachCell((c: any) => { c.border = border; });
      rn++;
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-sales-report-${row.date || ''}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── OWI Revenue Report Excel ──
async function generateOwiRevenueExcel(res: Response, data: any): Promise<void> {
  const payload = Array.isArray(data) ? data[0] : data;
  const rows = payload?.rows || [];
  const gt = payload?.grandTotals || { amount: 0, pb1: 0, svr_chrg: 0, total: 0 };
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('OWI Revenue');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const nf = (v: any) => Number(v || 0).toFixed(2);

  const title = ws.getCell(1, 1);
  title.value = 'OWI REVENUE REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  for (let i = 1; i <= 5; i++) ws.getColumn(i).width = i === 1 ? 14 : 18;

  const hdr = ws.getRow(3);
  hdr.values = ['TANGGAL', 'NET REVENUE', 'SERVICE CHARGE', 'TAX PB1', 'TOTAL REVENUE'];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });

  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = [r.date ? r.date.slice(8, 10) + '/' + r.date.slice(5, 7) + '/' + r.date.slice(2, 4) : '', nf(r.amount), nf(r.svr_chrg), nf(r.pb1), nf(r.total)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['Grand Total', nf(gt.amount), nf(gt.svr_chrg), nf(gt.pb1), nf(gt.total)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="owi-revenue-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── In House Folio Bal History Excel ──
async function generateInHouseFolioBalHistoryExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('In House Folio Balances');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio', 'Room Type', 'Room', 'Guest', 'Group', 'Arrival', 'Departure', 'Rate Code', 'Balance'];

  const title = ws.getCell(1, 1);
  title.value = String(row.reportTitle || 'IN HOUSE FOLIO BALANCES').toUpperCase();
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  const dateRow = ws.getRow(2);
  dateRow.getCell(1).value = `For Business Date: ${row.reportDate || row.startDate || ''}`;
  dateRow.getCell(1).font = { bold: true };
  for (let i = 1; i <= HEADERS.length; i++) ws.getColumn(i).width = i === 4 ? 28 : 15;

  const hdr = ws.getRow(4);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });

  let rn = 5;
  for (const g of row.reportData || []) {
    ws.getRow(rn).values = [g.company_name, '', '', '', '', '', '', '', ''];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    for (const f of g.folios || []) {
      ws.getRow(rn).values = ['', f.folio, f.room_type, f.room, f.guest, f.group_name, f.arrival, f.departure, f.rate_code, nf(f.balance)];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'Total Balance', '', '', '', '', '', '', nf(g.total_balance)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    if (g.credit_limit) {
      rn++;
      ws.getRow(rn).values = ['', 'Credit Limit', '', '', '', '', '', '', nf(g.credit_limit)];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    }
    rn++;
  }
  ws.getRow(rn).values = ['', 'GRAND TOTAL', '', '', '', '', '', '', nf(row.grandTotal || 0)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="in-house-folio-bal-history.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Commission For Booking Excel (agent / agent+company) ──
async function generateCommissionForBookingExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Commission For Booking');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio No', 'Check In', 'Check Out', 'Guest Name', 'Charges', 'Payable Commission'];

  const title = ws.getCell(1, 1);
  title.value = String(row.reportTitle || 'COMMISSION FOR BOOKING AGENT REPORT').toUpperCase();
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  const periodRow = ws.getRow(2);
  periodRow.getCell(1).value = `Period: ${row.reportStartDate || ''} - ${row.reportEndDate || ''}`;
  periodRow.getCell(1).font = { bold: true };
  for (let i = 1; i <= HEADERS.length; i++) ws.getColumn(i).width = i === 4 ? 28 : 15;

  let rn = 4;
  const groups = Object.values(row.groupedData || {});
  for (const g of groups as any[]) {
    ws.getRow(rn).values = [`Agent: ${g.agentInfo?.name || 'N/A'}`];
    ws.getRow(rn).font = { bold: true };
    rn++;
    ws.getRow(rn).values = [`Commission Rate: ${g.agentInfo?.commissionRate ?? 0}%`, `Account No: ${g.agentInfo?.accountNo || 'N/A'}`, `Business Reg: ${g.agentInfo?.businessReg || 'N/A'}`, `Address: ${g.agentInfo?.address || 'N/A'}`];
    rn++;
    if (g.companyInfo) {
      ws.getRow(rn).values = [`Company: ${g.companyInfo?.name || 'N/A'}`, `Account No: ${g.companyInfo?.accountNo || 'N/A'}`, `Address: ${g.companyInfo?.address || 'N/A'}`];
      rn++;
    }
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const f of g.folios || []) {
      ws.getRow(rn).values = ['', f.folioNo, f.checkInDate, f.checkOutDate, f.guestName, nf(f.charges), nf(f.payableCommission)];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'TOTAL', '', '', nf(g.totalCharges || 0), nf(g.totalCommission || 0)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn += 2;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="comission-for-booking.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── In House Folio Balance Excel ──
async function generateInHouseFolioBalanceExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const groups = row.reportData || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('In House Folio Balance');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio', 'Room Type', 'Room', 'Guest', 'Group Name', 'Arrival', 'Departure', 'Rate Code', 'Balance'];
  const widths = [14, 14, 14, 24, 22, 12, 12, 14, 14];
  const title = ws.getCell(1, 1);
  title.value = `IN HOUSE FOLIO BALANCES AS AT ${row.startDate || ''}`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  for (const g of groups) {
    ws.getRow(rn).values = [g.company_name ?? ''];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = HEADERS;
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const f of g.folios || []) {
      ws.getRow(rn).values = [f.folio, f.room_type, f.room, f.guest, f.group_name, f.arrival, f.departure, f.rate_code, nf(Number(f.balance || 0), 2)];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', '', '', '', '', '', '', `Total Balance for ${g.company_name ?? ''}`, nf(Number(g.total_balance || 0), 2)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    rn++;
  }
  ws.getRow(rn).values = ['In House Folio Balances As Of Business Date', '', '', '', '', '', '', '', nf(Number(row.grandTotal || 0), 2)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="in-house-folio-balance.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Vacant Rooms Excel ──
async function generateVacantRoomsExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Vacant Rooms');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room', 'Room Type', 'Floor', 'Status'];
  const widths = [16, 16, 12, 12];
  const title = ws.getCell(1, 1);
  title.value = 'VACANT ROOMS';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = ['', r.room_name, r.room_type, r.floor, r.status];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="vacant-rooms.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── No Show Excel ──
async function generateNoShowExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('No Show');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio Number', 'Guest Name', 'Room Type', 'Check In', 'Check Out', 'Company'];
  const widths = [16, 28, 14, 12, 12, 24];
  const title = ws.getCell(1, 1);
  title.value = 'NO SHOW';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = ['', r.folio_number, r.guest_name, r.room_type, r.check_in, r.check_out, r.company];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="no-show.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Nationality Statistic Excel ──
async function generateNationalityStatisticExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Nationality Statistic');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Nationality', 'Country', 'Count'];
  const widths = [30, 30, 12];
  const title = ws.getCell(1, 1);
  title.value = 'NATIONALITY STATISTIC';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let total = 0;
  for (const r of rows) {
    total += Number(r.count || 0);
    ws.getRow(rn).values = ['', r.nationality, r.country, Number(r.count || 0)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', '', total];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="nationality-statistic.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Expected Arrival Summary Excel ──
async function generateExpectedArrivalSummaryExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Expected Arrival Summary');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio Number', 'Guest Name', 'Room Type', 'Night', 'Adult', 'Child', 'Company', 'Status'];
  const widths = [16, 28, 14, 8, 8, 8, 24, 14];
  const title = ws.getCell(1, 1);
  title.value = 'EXPECTED ARRIVAL SUMMARY';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let tNight = 0, tAdult = 0, tChild = 0;
  for (const r of rows) {
    tNight += Number(r.night || 0);
    tAdult += Number(r.adult || 0);
    tChild += Number(r.child || 0);
    ws.getRow(rn).values = ['', r.folio_number, r.guest_name, r.room_type, Number(r.night || 0), Number(r.adult || 0), Number(r.child || 0), r.company, r.status];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', '', '', tNight, tAdult, tChild, '', ''];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="expected-arrival-summary.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Expected Departure Summary Excel ──
async function generateExpectedDepartureSummaryExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Expected Departure Summary');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio Number', 'Guest Name', 'Room', 'Room Type', 'Check Out', 'Company', 'Total Amount'];
  const widths = [16, 28, 14, 14, 12, 24, 16];
  const title = ws.getCell(1, 1);
  title.value = 'EXPECTED DEPARTURE SUMMARY';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let total = 0;
  for (const r of rows) {
    total += Number(r.total_amount || 0);
    ws.getRow(rn).values = ['', r.folio_number, r.guest_name, r.room_name, r.room_type, r.check_out, r.company, nf(Number(r.total_amount || 0))];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', '', '', '', '', nf(total)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="expected-departure-summary.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Front Office Daily Sales Excel ──
async function generateFrontOfficeDailySalesExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Daily Sales');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Date', 'Transaction Count', 'Total Sales', 'Cash', 'Non Cash'];
  const widths = [14, 18, 18, 16, 16];
  const title = ws.getCell(1, 1);
  title.value = 'DAILY SALES REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let tCount = 0, tTotal = 0, tCash = 0, tNonCash = 0;
  for (const r of rows) {
    tCount += Number(r.transaction_count || 0);
    tTotal += Number(r.total_sales || 0);
    tCash += Number(r.cash || 0);
    tNonCash += Number(r.non_cash || 0);
    ws.getRow(rn).values = ['', r.date, Number(r.transaction_count || 0), nf(Number(r.total_sales || 0)), nf(Number(r.cash || 0)), nf(Number(r.non_cash || 0))];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', tCount, nf(tTotal), nf(tCash), nf(tNonCash)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-sales-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Front Office Daily Revenue Excel ──
async function generateFrontOfficeDailyRevenueExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Daily Revenue');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Date', 'Invoice Count', 'Total Revenue', 'PB1', 'Service Charge'];
  const widths = [14, 16, 18, 16, 16];
  const title = ws.getCell(1, 1);
  title.value = 'DAILY REVENUE REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let tCount = 0, tRev = 0, tPb1 = 0, tSvc = 0;
  for (const r of rows) {
    tCount += Number(r.invoice_count || 0);
    tRev += Number(r.total_revenue || 0);
    tPb1 += Number(r.pb1 || 0);
    tSvc += Number(r.service_charge || 0);
    ws.getRow(rn).values = ['', r.date, Number(r.invoice_count || 0), nf(Number(r.total_revenue || 0)), nf(Number(r.pb1 || 0)), nf(Number(r.service_charge || 0))];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', tCount, nf(tRev), nf(tPb1), nf(tSvc)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-revenue-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Cancellation Listing Excel ──
async function generateCancellationListingExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const rows = row.reportData || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Cancellation Listing');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Res Type', 'Folio', 'Guest', 'Company', 'Room Type', 'Rate Code', 'Adult', 'Child', 'Check In', 'Check Out', 'Rate', 'Cancellation Staff', 'Cancellation Date', 'Reason'];
  const widths = [10, 14, 22, 20, 14, 12, 8, 8, 12, 12, 14, 16, 18, 24];
  const title = ws.getCell(1, 1);
  title.value = 'CANCELLATION LISTING';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let tRate = 0;
  for (const r of rows) {
    tRate += Number(r.rate || 0);
    ws.getRow(rn).values = ['', r.resType, r.folio, r.guest, r.company, r.roomType, r.rateCode, r.adult, r.child, r.checkInDate, r.checkOutDate, nf(Number(r.rate || 0)), r.cancellationStaff, r.cancellationDate, r.cancellationReason];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', '', '', '', '', '', '', '', '', '', nf(tRate), '', '', ''];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cancellation-listing.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Birthday Report Excel ──
async function generateBirthdayReportExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const rows = row.reportData || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Birthday Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Guest Name', 'Date Of Birth', 'Folio No', 'Room Unit'];
  const widths = [28, 20, 16, 16];
  const title = ws.getCell(1, 1);
  title.value = 'BIRTHDAY REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = ['', r.guestName, r.dateOfBirth, r.folioNo, r.roomUnit];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="birthday-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Free Of Charge Detail Excel ──
async function generateFreeOfChargeDetailExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Free Of Charge Detail');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Res Type', 'Folio', 'Guest', 'Company', 'Room', 'Room Type', 'Rate', 'Adult', 'Child', 'Check In', 'Check Out'];
  const widths = [10, 14, 22, 20, 14, 14, 14, 8, 8, 12, 12];
  const title = ws.getCell(1, 1);
  title.value = 'FREE OF CHARGE DETAIL REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  const dump = (g: any[]) => {
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const r of g) {
      ws.getRow(rn).values = ['', r.resType, r.folio, r.guest, r.company, r.room, r.roomType, nf(Number(r.rate || 0)), r.adult, r.child, r.checkInDate, r.checkOutDate];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
  };
  for (const groupName of Object.keys(row.reportData || {})) {
    ws.getRow(rn).values = [groupName];
    ws.getRow(rn).font = { bold: true };
    rn++;
    const byType = row.reportData[groupName] || {};
    for (const typeName of Object.keys(byType)) {
      ws.getRow(rn).values = [`${typeName} (${(byType[typeName] || []).length})`];
      ws.getRow(rn).font = { bold: true };
      rn++;
      dump(byType[typeName] || []);
    }
  }
  const s = row.summary || {};
  ws.getRow(rn).values = ['SUMMARY'];
  ws.getRow(rn).font = { bold: true };
  rn++;
  ws.getRow(rn).values = ['No Of Folios', s.noOfFolios ?? 0];
  rn++;
  ws.getRow(rn).values = ['Total COMP Room', s.totalCOMPRoom ?? 0];
  rn++;
  ws.getRow(rn).values = ['Total HSE Room', s.totalHSERoom ?? 0];
  rn++;
  ws.getRow(rn).values = ['Total CRT Room', s.totalCRTRoom ?? 0];
  rn++;
  ws.getRow(rn).values = ['Total CRD Room', s.totalCRDRoom ?? 0];
  rn++;
  ws.getRow(rn).values = ['Total BRD Room', s.totalBRDRoom ?? 0];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="free-of-charge-detail-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Reservations By Staff Excel ──
async function generateReservationsByStaffExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Reservations By Staff');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Res Type', 'Folio', 'Guest', 'Company', 'Stay', 'Room', 'Room Type', 'Adult', 'Child', 'Check In', 'Check Out', 'Rate Code', 'First Night Rate', 'Res Status', 'Res Date'];
  const widths = [10, 14, 22, 20, 8, 14, 14, 8, 8, 12, 12, 12, 14, 10, 12];
  const title = ws.getCell(1, 1);
  title.value = 'RESERVATIONS BY STAFF';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  for (const g of (Object.values(row.reportData || {}) as any[])) {
    ws.getRow(rn).values = [g.staffName || 'Unknown Staff'];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    let tRate = 0;
    for (const r of g.folios || []) {
      tRate += Number(r.firstNightRate || 0);
      ws.getRow(rn).values = ['', r.resType, r.folio, r.guest, r.company, r.stay, r.room, r.roomType, r.adult, r.child, r.checkInDate, r.checkOutDate, r.rateCode, nf(Number(r.firstNightRate || 0)), r.resStatus, r.resDate];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'TOTAL RESERVATIONS', '', '', '', '', '', '', '', '', '', '', '', nf(tRate), '', ''];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    if ((g.cancelledFolios || []).length) {
      ws.getRow(rn).values = [`CANCELLED (${g.cancelledFolios.length})`];
      ws.getRow(rn).font = { bold: true };
      rn++;
      for (const r of g.cancelledFolios) {
        ws.getRow(rn).values = ['', r.resType, r.folio, r.guest, r.company, r.stay, r.room, r.roomType, r.adult, r.child, r.checkInDate, r.checkOutDate, r.rateCode, nf(Number(r.firstNightRate || 0)), '', r.cancellationDate];
        ws.getRow(rn).eachCell((c: any) => { c.border = border; });
        rn++;
      }
      rn++;
    }
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="reservations-by-staff.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Room Type Detailed Excel ──
async function generateRoomTypeDetailedExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Type Detailed');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room Type', 'Total Room', 'Block', 'NG Arr', 'NG Dep', 'NG Sty', 'NG Rev', 'G Arr', 'G Dep', 'G Sty', 'G Rev', 'T Arr', 'T Dep', 'T Sty', 'T Rev', 'Occ Rooms', 'Occupancy %', 'Ave Nett Rev'];
  const widths = [16, 10, 8, 8, 8, 8, 14, 8, 8, 8, 14, 8, 8, 8, 14, 10, 10, 14];
  const title = ws.getCell(1, 1);
  title.value = 'ROOM TYPE DETAILED REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  for (const day of row.reportData || []) {
    ws.getRow(rn).values = [day.date];
    ws.getRow(rn).font = { bold: true };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const rt of day.room_types || []) {
      ws.getRow(rn).values = ['', rt.room_type, rt.total_room, rt.block, rt.non_grp_arr, rt.non_grp_dep, rt.non_grp_sty, nf(Number(rt.non_grp_revenue || 0)), rt.grp_arr, rt.grp_dep, rt.grp_sty, nf(Number(rt.grp_revenue || 0)), rt.total_arr, rt.total_dep, rt.total_sty, nf(Number(rt.total_revenue || 0)), rt.occupied_rooms, Number(rt.occupancy || 0).toFixed(2), nf(Number(rt.ave_nett_revenue || 0))];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    const t = day.totals || {};
    ws.getRow(rn).values = ['', 'TOTAL', t.total_room, t.block, t.non_grp_arr, t.non_grp_dep, t.non_grp_sty, nf(Number(t.non_grp_revenue || 0)), t.grp_arr, t.grp_dep, t.grp_sty, nf(Number(t.grp_revenue || 0)), t.total_arr, t.total_dep, t.total_sty, nf(Number(t.total_revenue || 0)), t.occupied_rooms, Number(t.occupancy || 0).toFixed(2), nf(Number(t.ave_nett_revenue || 0))];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn += 2;
  }
  const g = row.grandTotal || {};
  ws.getRow(rn).values = ['GRAND TOTAL', g.total_room, g.block, g.non_grp_arr, g.non_grp_dep, g.non_grp_sty, nf(Number(g.non_grp_revenue || 0)), g.grp_arr, g.grp_dep, g.grp_sty, nf(Number(g.grp_revenue || 0)), g.total_arr, g.total_dep, g.total_sty, nf(Number(g.total_revenue || 0)), g.occupied_rooms, Number(g.occupancy || 0).toFixed(2), nf(Number(g.ave_nett_revenue || 0))];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="room-type-detailed-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── In House Guest Listing Excel ──
async function generateInHouseGuestListingExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('In House Guest Listing');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room', 'Adult', 'Child'];
  const widths = [16, 10, 10];
  const title = ws.getCell(1, 1);
  title.value = 'IN HOUSE GUEST LISTING';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let tAdult = 0, tChild = 0;
  for (const r of row.folios || []) {
    tAdult += Number(r.adult || 0);
    tChild += Number(r.child || 0);
    ws.getRow(rn).values = ['', r.room_name, Number(r.adult || 0), Number(r.child || 0)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', tAdult, tChild];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn += 2;
  const s = row.summary || {};
  ws.getRow(rn).values = ['SUMMARY'];
  ws.getRow(rn).font = { bold: true };
  rn++;
  for (const k of [['No Of Folios', s.no_of_folios], ['Total Adults', s.total_adults], ['Total Child', s.total_child], ['Total COMP Room', s.total_comp_room], ['Total HSE Room', s.total_hse_room], ['Total CRT Room', s.total_crt_room], ['Total CRD Room', s.total_crd_room], ['Total BRD Room', s.total_brd_room]]) {
    ws.getRow(rn).values = k;
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="in-house-guest-listing.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Room Type Monthly Excel ──
async function generateRoomTypeMonthlyExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Type Monthly');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room Type', 'Total Room', 'Block', 'NG Arr', 'NG Dep', 'NG Sty', 'NG Rev', 'G Arr', 'G Dep', 'G Sty', 'G Rev', 'T Arr', 'T Dep', 'T Sty', 'T Rev', 'Occ Rooms', 'Ave Nett Rev', 'Occupancy %'];
  const widths = [16, 10, 8, 8, 8, 8, 14, 8, 8, 8, 14, 8, 8, 8, 14, 10, 14, 12];
  const title = ws.getCell(1, 1);
  title.value = 'ROOM TYPE MONTHLY REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  const cell = (rt: any, side: string, k: string) => (rt[side] || {})[k] ?? 0;
  for (const [name, rt] of (Object.entries(row.reportData || {}) as any[])) {
    ws.getRow(rn).values = ['', name, rt.totalRoom, rt.block, cell(rt, 'nonGrp', 'arr'), cell(rt, 'nonGrp', 'dep'), cell(rt, 'nonGrp', 'sty'), nf(Number(cell(rt, 'nonGrp', 'revenue') || 0)), cell(rt, 'grp', 'arr'), cell(rt, 'grp', 'dep'), cell(rt, 'grp', 'sty'), nf(Number(cell(rt, 'grp', 'revenue') || 0)), cell(rt, 'total', 'arr'), cell(rt, 'total', 'dep'), cell(rt, 'total', 'sty'), nf(Number(cell(rt, 'total', 'revenue') || 0)), rt.occupiedRooms, nf(Number(rt.aveNettRevenue || 0)), Number(rt.occupancy || 0).toFixed(2)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  const g = row.grandTotal || {};
  ws.getRow(rn).values = ['', 'TOTAL', g.totalRoom, g.block, cell(g, 'nonGrp', 'arr'), cell(g, 'nonGrp', 'dep'), cell(g, 'nonGrp', 'sty'), nf(Number(cell(g, 'nonGrp', 'revenue') || 0)), cell(g, 'grp', 'arr'), cell(g, 'grp', 'dep'), cell(g, 'grp', 'sty'), nf(Number(cell(g, 'grp', 'revenue') || 0)), cell(g, 'total', 'arr'), cell(g, 'total', 'dep'), cell(g, 'total', 'sty'), nf(Number(cell(g, 'total', 'revenue') || 0)), g.occupiedRooms, nf(Number(g.aveNettRevenue || 0)), Number(g.occupancy || 0).toFixed(2)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="room-type-monthly-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Same Day Check Out / Check In Excel ──
async function generateSameDayCheckOutCheckInExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const rows = row.reportData || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Same Day Check Out / Check In');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Guest Name', 'From Company', 'From Folio No', 'From Rate Code', 'From Room Rate', 'To Company', 'To Folio No', 'To Rate Code', 'To Room Rate', 'Check Out Date'];
  const widths = [22, 18, 14, 12, 14, 18, 14, 12, 14, 14];
  const title = ws.getCell(1, 1);
  title.value = 'SAME DAY CHECK OUT / CHECK IN REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = ['', r.guestName, r.fromCompany, r.fromFolioNo, r.fromRateCode, nf(Number(r.fromRoomRate || 0)), r.toCompany, r.toFolioNo, r.toRateCode, nf(Number(r.toRoomRate || 0)), r.checkOutDate ? formatDate(r.checkOutDate) : ''];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="same-day-check-out-check-in-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Transaction By Staff (FO) Excel ──
async function generateTransactionByStaffFOExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Transaction By Staff');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio', 'Room', 'Guest', 'Post Date/Time', 'Description', 'Card Name', 'Last Digit', 'Total'];
  const widths = [14, 14, 22, 20, 34, 14, 10, 14];
  const title = ws.getCell(1, 1);
  title.value = 'TRANSACTION BY STAFF REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  const staffRow = ws.getRow(2);
  staffRow.getCell(1).value = `Staff: ${row.staffName || ''}  |  Date: ${row.date || ''}`;
  staffRow.getCell(1).font = { bold: true };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 4;
  let grandTotal = 0;
  for (const g of row.reportData || []) {
    ws.getRow(rn).values = [g.type];
    ws.getRow(rn).font = { bold: true };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const t of g.transactions || []) {
      ws.getRow(rn).values = ['', t.folio, t.room, t.guest, t.postDateTime, t.description, t.card_name, t.last_digit_card, nf(Number(t.total || 0))];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'TOTAL', '', '', '', '', '', nf(Number(g.total || 0))];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    grandTotal += Number(g.total || 0);
    rn += 2;
  }
  ws.getRow(rn).values = ['GRAND TOTAL', '', '', '', '', '', '', nf(grandTotal)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="transaction-by-staff-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Room Status Report Excel ──
async function generateRoomStatusReportExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const rows = row.rooms || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Status Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Building', 'Floor', 'Room', 'Room Type', 'Room Status', 'Maid Status'];
  const widths = [18, 12, 14, 16, 14, 14];
  const title = ws.getCell(1, 1);
  title.value = `ROOM STATUS REPORT (${row.reportDate || ''})`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = ['', r.building, r.floor, r.room, r.roomType, r.roomStatus, r.maidStatus];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  rn++;
  ws.getRow(rn).values = ['Total Rooms', row.totalRooms ?? 0];
  rn++;
  ws.getRow(rn).values = ['Total Occupied', row.totalOccupied ?? 0];
  rn++;
  ws.getRow(rn).values = ['Total Clean Rooms', row.totalCleanRooms ?? 0];
  rn++;
  ws.getRow(rn).values = ['Total Dirty Rooms', row.totalDirtyRooms ?? 0];
  rn++;
  ws.getRow(rn).values = ['Percent Clean Rooms', row.percentCleanRooms ?? 0];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="room-status-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Block Rooms Report Excel ──
async function generateBlockRoomsReportExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Block Rooms Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room', 'Type', 'Reason', 'User', 'Block Time'];
  const widths = [16, 16, 20, 20, 22];
  const title = ws.getCell(1, 1);
  title.value = 'BLOCK ROOMS REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  for (const [date, items] of (Object.entries(row.reportData || {}) as any[])) {
    ws.getRow(rn).values = [date];
    ws.getRow(rn).font = { bold: true };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const r of items) {
      ws.getRow(rn).values = ['', r.room, r.type, r.reason, r.user, r.blockTime];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="block-rooms-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Room Change History Excel ──
async function generateRoomChangeHistoryExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const rows = row.roomChanges || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Change History');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio Number', 'Check In', 'Check Out', 'From Room', 'To Room', 'Changed By', 'Changed Date', 'Reason'];
  const widths = [16, 12, 12, 14, 14, 18, 20, 24];
  const title = ws.getCell(1, 1);
  title.value = 'ROOM CHANGE HISTORY';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = ['', r.folio_number, r.check_in_date, r.check_out_date, r.from_room_name, r.to_room_name, r.changed_by, r.changed_date, r.reason];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="room-change-history.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Rate Code Analysis Excel ──
async function generateRateCodeAnalysisExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Rate Code Analysis');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room', 'Room Type', 'Folio', 'Guest', 'Company', 'Old Rate Code', 'Old Rate', 'Override Reason', 'Nett Rate', 'AD', 'CH'];
  const widths = [12, 14, 14, 22, 22, 14, 12, 16, 14, 8, 8];
  const title = ws.getCell(1, 1);
  title.value = `RATE CODE ANALYSIS (${row.businessDate || ''})`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  let gRooms = 0, gNet = 0, gAd = 0, gCh = 0;
  for (const g of (row.data || [])) {
    ws.getRow(rn).values = [`${g.rate_code} - ${g.description}`];
    ws.getRow(rn).font = { bold: true };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const f of g.folios || []) {
      ws.getRow(rn).values = ['', f.rm, f.rm_type, f.folio, f.guest, f.company_group_name, f.old_rate_code, f.old_rate, f.override_reason, nf(Number(f.nett_rate || 0)), f.ad, f.ch];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'TOTAL', '', '', '', '', '', '', nf(Number(g.totals?.nett_rate || 0)), g.totals?.rooms, g.totals?.ad, g.totals?.ch];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    gRooms += Number(g.totals?.rooms || 0);
    gNet += Number(g.totals?.nett_rate || 0);
    gAd += Number(g.totals?.ad || 0);
    gCh += Number(g.totals?.ch || 0);
    rn += 2;
  }
  ws.getRow(rn).values = ['REPORT TOTAL', '', '', '', '', '', '', '', nf(gNet), gRooms, gAd, gCh];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  rn++;
  ws.getRow(rn).values = ['AVERAGE ROOM RATE', '', '', '', '', '', '', '', nf(Number(row.averageRoomRate || 0))];
  ws.getRow(rn).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="rate-code-analysis.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Vacant And Dirty Rooms Excel ──
async function generateVacantAndDirtyRoomsExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const rows = row.rooms || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Vacant And Dirty Rooms');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Building', 'Floor', 'Room', 'Room Type', 'Room Status', 'Maid Status', 'Checkout Date/Time'];
  const widths = [18, 12, 14, 16, 14, 14, 22];
  const title = ws.getCell(1, 1);
  title.value = `VACANT AND DIRTY ROOMS (${row.report_date || ''})`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = ['', r.building, r.floor, r.room, r.room_type, r.room_status, r.maid_status, r.checkout_date_time];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL VACANT DIRTY ROOMS', '', '', '', '', rows.length];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="vacant-and-dirty-rooms.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Breakfast Report Excel ──
async function generateBreakfastReportExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Breakfast Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room', 'Folio', 'Name', 'Company', 'Description', 'Adult', 'Child', 'Arrival Date', 'Dep.Date', 'Status', 'Frequency', 'Sales'];
  const widths = [12, 14, 22, 22, 26, 8, 8, 12, 12, 12, 12, 14];
  const title = ws.getCell(1, 1);
  title.value = `BREAKFAST REPORT (${row.businessDate || ''})`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  const section = (label: string, items: any[], totals: any) => {
    ws.getRow(rn).values = [label];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const b of items) {
      ws.getRow(rn).values = ['', b.Room, b.Folio, b.Name, b.Company, b.Description, b.Adult, b.Child, b['Arrival Date'], b['Dep.Date'], b.Status, b.Frequency, nf(Number(b.sales || 0))];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'TOTAL', '', '', '', '', totals.adults, totals.children, '', '', totals.rooms, totals.numberOfFolio, nf(totals.totalSales)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn += 2;
  };
  section('ADDITIONAL BREAKFAST', row.additionalBreakfast || [], {
    adults: row.additionalAdults ?? 0, children: row.additionalChildren ?? 0, rooms: row.additionalRooms ?? 0, numberOfFolio: row.additionalnumberOfFolio ?? 0, totalSales: row.additionaltotalSales ?? 0,
  });
  section('INCLUSIVE BREAKFAST', row.inclusiveBreakfast || [], {
    adults: row.inclusiveAdults ?? 0, children: row.inclusiveChildren ?? 0, rooms: row.inclusiveRooms ?? 0, numberOfFolio: row.inclusivenumberOfFolio ?? 0, totalSales: row.inclusivetotalSales ?? 0,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="breakfast-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Room Revenue Breakdown Excel ──
async function generateRoomRevenueBreakdownExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const rows = row.breakdowns || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Revenue Breakdown');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio', 'Unit', 'Rate Code', 'Rate', 'Room', 'Add Bed', 'Breakfast', 'Lunch', 'Dinner', 'Other', 'Arrival', 'Departure', 'Guest Name', 'Company', 'Segmentation', 'Source'];
  const widths = [14, 12, 12, 12, 12, 10, 12, 10, 10, 10, 12, 12, 22, 22, 16, 14];
  const title = ws.getCell(1, 1);
  title.value = `ROOM REVENUE BREAKDOWN (${row.reportDate || ''})`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = ['', r.folio, r.unit, r.rateCode, nf(Number(r.rate || 0)), nf(Number(r.room || 0)), nf(Number(r.addBed || 0)), nf(Number(r.breakfast || 0)), nf(Number(r.lunch || 0)), nf(Number(r.dinner || 0)), nf(Number(r.other || 0)), r.arrival, r.departure, r.guestName, r.company, r.segmentation, r.source];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL RATE', '', '', nf(Number(row.totalRate || 0))];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="room-revenue-breakdown.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── All Companies Room Revenue Excel ──
async function generateAllCompaniesRoomRevenueExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('All Companies Room Revenue');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio No', 'Room No', 'Guest Name', 'Arrival Date', 'Dep Date', 'Room Nights', 'Nett Revenue', 'ANR', 'Gross Revenue', 'AGR'];
  const widths = [14, 12, 22, 12, 12, 12, 14, 12, 14, 12];
  const title = ws.getCell(1, 1);
  title.value = 'ALL COMPANIES ROOM REVENUE';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  for (const c of row.companies || []) {
    ws.getRow(rn).values = [c.name];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c2: any) => { c2.border = border; });
    rn++;
    for (const f of (Object.values(c.folios || {}) as any[])) {
      const d = (v: any) => v ? formatDate(v) : '';
      ws.getRow(rn).values = ['', f.folioNo, f.roomNo, f.guestName, d(f.arrivalDate), d(f.depDate), f.roomNights, nf(Number(f.nettRevenue || 0)), nf(Number(f.anr || 0)), nf(Number(f.grossRevenue || 0)), nf(Number(f.agr || 0))];
      ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'TOTAL', '', '', '', c.total?.roomNights, nf(Number(c.total?.nettRevenue || 0)), nf(Number(c.total?.anr || 0)), nf(Number(c.total?.grossRevenue || 0)), nf(Number(c.total?.agr || 0))];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
    rn += 2;
  }
  const g = row.grandTotal || {};
  ws.getRow(rn).values = ['GRAND TOTAL', '', '', '', '', g.roomNights, nf(Number(g.nettRevenue || 0)), nf(Number(g.anr || 0)), nf(Number(g.grossRevenue || 0)), nf(Number(g.agr || 0))];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="all-companies-room-revenue.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── All Companies Room Revenue Breakdown Excel ──
async function generateAllCompaniesRoomRevenueBreakdownExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('All Companies Room Revenue Breakdown');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio No.', 'Room No.', 'Guest Name', 'Arrival Date', 'Dep. Date', 'Room Nights', 'Nett Revenue', 'ANR', 'Gross Revenue', 'AGR'];
  const widths = [14, 12, 22, 12, 12, 12, 14, 12, 14, 12];
  const title = ws.getCell(1, 1);
  title.value = `ALL COMPANIES ROOM REVENUE DETAILED REPORT (${row.startDate || ''} TO ${row.endDate || ''})`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const dmy2 = (d: any) => {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCFullYear()).slice(2)}`;
  };
  let rn = 3;
  for (const c of Object.values(row.companies || {})) {
    const comp: any = c;
    ws.getRow(rn).values = [comp.name ?? ''];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c2: any) => { c2.border = border; });
    rn++;
    const sections: [string, (f: any) => boolean][] = [
      ['POSTING TRANSACTION', (f: any) => f.transaction_type === 'Posting Transaction'],
      ['TRANSFER TRANSACTION', (f: any) => f.transaction_type === 'Transfer Transaction'],
      ['VOID TRANSACTION', (f: any) => f.transaction_type === 'Void Transaction'],
    ];
    for (const [label, pred] of sections) {
      const list = (comp.folios || []).filter(pred);
      if (!list.length) continue;
      ws.getRow(rn).values = [label];
      ws.getRow(rn).font = { bold: true };
      ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
      rn++;
      for (const f of list) {
        const isPosting = f.transaction_type === 'Posting Transaction';
        ws.getRow(rn).values = ['', f.folio_number, f.room_no, f.guest_name, dmy2(f.check_in_date), dmy2(f.check_out_date), isPosting ? Math.max(Number(f.guest_stay ?? 0) || 0, 1) : 0, nf(Number(f.amount ?? 0), 2), nf(Number(f.anr ?? 0), 2), nf(Number(f.total ?? 0), 2), nf(Number(f.agr ?? 0), 2)];
        ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
        rn++;
      }
    }
    const total = comp.total || {};
    ws.getRow(rn).values = ['', `${comp.name ?? ''} TOTAL`, '', '', '', total.roomNights ?? 0, nf(Number(total.nettRevenue || 0), 2), nf((total.roomNights ?? 0) > 0 ? Number(total.nettRevenue || 0) / total.roomNights : 0, 2), nf(Number(total.grossRevenue || 0), 2), nf((total.roomNights ?? 0) > 0 ? Number(total.grossRevenue || 0) / total.roomNights : 0, 2)];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
    rn += 2;
  }
  const g = row.grandTotal || {};
  ws.getRow(rn).values = ['', 'GRAND TOTAL', '', '', '', g.roomNights ?? 0, nf(Number(g.nettRevenue || 0), 2), nf(Number(g.anr || 0), 2), nf(Number(g.grossRevenue || 0), 2), nf(Number(g.agr || 0), 2)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="all-companies-room-revenue-breakdown-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Market Segmentation Excel ──
async function generateMarketSegmentationExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Market Segmentation');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Company', 'Nationality', 'Nights', 'Nett Revenue', 'Gross Revenue', 'ANR', 'AGR'];
  const widths = [30, 18, 10, 16, 16, 14, 14];
  const title = ws.getCell(1, 1);
  title.value = 'MARKET SEGMENTATION REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  for (const [segName, companies] of Object.entries(row.data || {} as any)) {
    ws.getRow(rn).values = [segName];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    let tNights = 0, tNet = 0, tGross = 0;
    for (const [compName, c] of (Object.entries(companies as any) as any[])) {
      tNights += Number(c.nights || 0);
      tNet += Number(c.nettRevenue || 0);
      tGross += Number(c.grossRevenue || 0);
      ws.getRow(rn).values = ['', compName, c.nationality, Number(c.nights || 0), nf(Number(c.nettRevenue || 0)), nf(Number(c.grossRevenue || 0)), nf(Number(c.ANR || 0)), nf(Number(c.AGR || 0))];
      ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'TOTAL', '', tNights, nf(tNet), nf(tGross), '', ''];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
    rn += 2;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="market-segmentation-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Nationality Statistics Detailed Excel ──
async function generateNationalityStatisticsDetailedExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Nationality Statistics Detailed');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Doc No', 'Guest Name', 'Description', 'Nights', 'Check In', 'Check Out', 'Pax', 'Adult', 'Child', 'Revenue'];
  const widths = [16, 22, 26, 10, 12, 12, 8, 8, 8, 16];
  const title = ws.getCell(1, 1);
  title.value = 'NATIONALITY STATISTICS DETAILED';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  let gNights = 0, gPax = 0, gRev = 0;
  for (const g of row.reportData || []) {
    ws.getRow(rn).values = [g.nationality];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const guest of g.guests || []) {
      ws.getRow(rn).values = ['', guest.docno, guest.guestName, guest.description, guest.noOfNights, guest.checkInDate ? formatDate(guest.checkInDate) : '', guest.checkOutDate ? formatDate(guest.checkOutDate) : '', guest.pax, guest.adult, guest.child, nf(Number(guest.revenue || 0))];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    ws.getRow(rn).values = ['', 'TOTAL', '', '', g.nights, '', '', g.totalPax, '', '', nf(Number(g.nettRoomRevenue || 0))];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    gNights += Number(g.nights || 0);
    gPax += Number(g.totalPax || 0);
    gRev += Number(g.nettRoomRevenue || 0);
    rn += 2;
  }
  ws.getRow(rn).values = ['GRAND TOTAL', '', '', '', gNights, '', '', gPax, '', '', nf(gRev)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="nationality-statistics-detailed.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Staff Sales Summary Excel ──
async function generateStaffSalesSummaryExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Staff Sales Summary');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio Number', 'Nights', 'Nett Amount', 'Gross Amount'];
  const widths = [16, 10, 16, 16];
  const title = ws.getCell(1, 1);
  title.value = 'STAFF SALES SUMMARY';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  for (const s of row.reportData?.staffData || []) {
    ws.getRow(rn).values = [s.name];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    for (const c of s.companies || []) {
      ws.getRow(rn).values = [`  ${c.name} (Projection: ${c.total_projection ?? 0} / Actual: ${c.total_actual ?? 0})`];
      ws.getRow(rn).font = { bold: true };
      rn++;
      const hdr = ws.getRow(rn);
      hdr.values = ['', ...HEADERS];
      hdr.font = { bold: true };
      hdr.alignment = { horizontal: 'center' };
      hdr.eachCell((c2: any) => { c2.border = border; });
      rn++;
      for (const f of c.listFolio || []) {
        ws.getRow(rn).values = ['', f.folio_number, f.nights, nf(Number(f.amount || 0)), nf(Number(f.total || 0))];
        ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
        rn++;
      }
      ws.getRow(rn).values = ['', 'COMPANY TOTAL', c.total_actual ?? 0, nf(Number(c.nettRevenue || 0)), nf(Number(c.grossRevenue || 0))];
      ws.getRow(rn).font = { bold: true };
      ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
      rn++;
      ws.getRow(rn).values = ['', `ANR: ${nf(Number(c.anr || 0))}  AGR: ${nf(Number(c.agr || 0))}`];
      rn++;
    }
    ws.getRow(rn).values = ['STAFF TOTAL', '', s.total?.nights ?? 0, nf(Number(s.total?.nettRevenue || 0)), nf(Number(s.total?.grossRevenue || 0))];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
    rn += 2;
  }
  const g = row.reportData?.grandTotal || {};
  ws.getRow(rn).values = ['GRAND TOTAL', '', g.nights ?? 0, nf(Number(g.nettRevenue || 0)), nf(Number(g.grossRevenue || 0))];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c2: any) => { c2.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="staff-sales-summary.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Room Occupancy Chart Excel ──
async function generateRoomOccupancyChartExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Occupancy Chart');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Date', 'NG Arr', 'NG Dep', 'NG Sty', 'NG Rev', 'G Arr', 'G Dep', 'G Sty', 'G Rev', 'T Arr', 'T Dep', 'T Sty', 'T Rev', 'Guests', 'Occ Rooms', 'Ave Nett Rev', 'Occupancy %'];
  const widths = [12, 8, 8, 8, 14, 8, 8, 8, 14, 8, 8, 8, 14, 10, 10, 14, 12];
  const title = ws.getCell(1, 1);
  title.value = 'ROOM OCCUPANCY CHART';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  const cell = (d: any, side: string, k: string) => (d[side] || {})[k] ?? 0;
  for (const [date, d] of (Object.entries(row.data || {}) as any[])) {
    ws.getRow(rn).values = ['', date, cell(d, 'non_grp', 'arr'), cell(d, 'non_grp', 'dep'), cell(d, 'non_grp', 'sty'), nf(Number(cell(d, 'non_grp', 'revenue') || 0)), cell(d, 'grp', 'arr'), cell(d, 'grp', 'dep'), cell(d, 'grp', 'sty'), nf(Number(cell(d, 'grp', 'revenue') || 0)), cell(d, 'total', 'arr'), cell(d, 'total', 'dep'), cell(d, 'total', 'sty'), nf(Number(cell(d, 'total', 'revenue') || 0)), d.total_guests, d.occupied_rooms, nf(Number(d.ave_nett_revenue || 0)), Number(d.occupancy || 0).toFixed(2)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  const g = row.grandTotal || {};
  ws.getRow(rn).values = ['', 'TOTAL', cell(g, 'non_grp', 'arr'), cell(g, 'non_grp', 'dep'), cell(g, 'non_grp', 'sty'), nf(Number(cell(g, 'non_grp', 'revenue') || 0)), cell(g, 'grp', 'arr'), cell(g, 'grp', 'dep'), cell(g, 'grp', 'sty'), nf(Number(cell(g, 'grp', 'revenue') || 0)), cell(g, 'total', 'arr'), cell(g, 'total', 'dep'), cell(g, 'total', 'sty'), nf(Number(cell(g, 'total', 'revenue') || 0)), g.total_guests, g.occupied_rooms, nf(Number(g.ave_nett_revenue || 0)), Number(g.occupancy || 0).toFixed(2)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="room-occupancy-chart.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Occupancy Revenue Report Excel ──
async function generateOccupancyRevenueReportExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Occupancy Revenue Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const title = ws.getCell(1, 1);
  title.value = `OCCUPANCY & REVENUE REPORT ${row.year || ''}`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 60;
  ws.getColumn(3).width = 16;
  let rn = 3;
  for (const [month, m] of Object.entries(row.monthlyData || {})) {
    ws.getRow(rn).values = [String(month).toUpperCase()];
    ws.getRow(rn).font = { bold: true, size: 12 };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = ['Date', 'Booking', 'Revenue'];
    ws.getRow(rn).font = { bold: true };
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    for (const d of (m as any).daily_data || []) {
      const bookingText = (d.bookings || []).map((b: any) => {
        const name = `${b.guest_name ?? ''} ${b.company ?? ''}`.trim();
        return b.phone ? `${name}/${b.phone}` : name;
      }).join('\n');
      ws.getRow(rn).values = [d.date, bookingText, d.revenue > 0 ? nf(Number(d.revenue || 0)) : ''];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      ws.getRow(rn).getCell(3).alignment = { horizontal: 'right' };
      rn++;
    }
    ws.getRow(rn).values = ['OCCUPANCY', '', `${nf(Number((m as any).occupancy_rate || 0), 2)}%`];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = ['REVENUE', '', nf(Number((m as any).total_revenue || 0), 2)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = ['MANAGEMENT FEE', '', nf(Number((m as any).management_fee || 0), 2)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    ws.getRow(rn).values = ['AVERAGE ROOM RATE', '', nf(Number((m as any).average_room_rate || 0), 2)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="occupancy-revenue-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Financial Report Excel ──
async function generateFinancialReportExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Financial Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const title = ws.getCell(1, 1);
  title.value = `FINANCIAL REPORT ${row.year || ''}`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  const months = Object.keys(row.monthlyData || {});
  ws.getColumn(1).width = 42;
  months.forEach((m, i) => { ws.getColumn(i + 2).width = 18; });
  const hdr = ws.getRow(3);
  hdr.values = ['METRICS', ...months.map((m) => m.toUpperCase())];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  const metrics: [string, (m: any) => string][] = [
    ['OCCUPANCY RATE', (m) => `${nf(Number(m.occupancy_rate || 0), 2)}%`],
    ['AVERAGE ROOM RATE', (m) => nf(Number(m.average_room_rate || 0), 2)],
    ['NET REVENUE', (m) => nf(Number(m.net_revenue || 0), 2)],
    ['Growth/Decline (%)', (m) => `${m.growth ?? 0}%`],
    ['Advance Payment (Deposit, Guest pays now for a future stay)', (m) => nf(Number(m.advance_payment || 0), 2)],
    ['Unrealized Revenue (Guest has already stayed, but the funds have not yet been released by the OTA)', (m) => nf(Number(m.unrealized_revenue || 0), 2)],
    ['Realized Revenue (Funds received from guests who stayed in the past)', (m) => nf(Number(m.realized_revenue || 0), 2)],
    ['Others (Damages / Extra Charges, etc.)', (m) => nf(Number(m.other_revenue || 0), 2)],
    ['Cash Income', (m) => nf(Number(m.cash_income || 0), 2)],
  ];
  let rn = 4;
  for (const [label, fmt] of metrics) {
    ws.getRow(rn).values = [label, ...months.map((m) => fmt((row.monthlyData || {})[m]))];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    ws.getRow(rn).getCell(1).font = { bold: true };
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="financial-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Transaction Report Excel ──
async function generateTransactionReportExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Transaction Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Date', 'Folio No', 'Code', 'Code Name', 'Description', 'Amount', 'Total', 'Type Amount', 'Type Payment'];
  const widths = [12, 14, 10, 16, 40, 14, 14, 12, 14];
  const title = ws.getCell(1, 1);
  title.value = 'TRANSACTION REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let tAmount = 0, tTotal = 0;
  for (const r of rows) {
    tAmount += Number(r.amount || 0);
    tTotal += Number(r.total || 0);
    ws.getRow(rn).values = ['', r.date, r.folio_number, r.code, r.code_name, r.description, nf(Number(r.amount || 0)), nf(Number(r.total || 0)), r.type_amount, r.type_payment];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', '', '', '', '', nf(tAmount), nf(tTotal), '', ''];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="transaction-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Guest Ledger Report Excel ──
async function generateGuestLedgerExcel(res: Response, data: any): Promise<void> {
  const rows = Array.isArray(data) ? data : [data];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Guest Ledger Report');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Date', 'Folio No', 'Guest', 'Code', 'Code Name', 'Description', 'Debit', 'Credit', 'Balance'];
  const widths = [12, 14, 22, 10, 16, 40, 14, 14, 14];
  const title = ws.getCell(1, 1);
  title.value = 'GUEST LEDGER REPORT';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  let tDebit = 0, tCredit = 0;
  for (const r of rows) {
    tDebit += Number(r.debit || 0);
    tCredit += Number(r.credit || 0);
    ws.getRow(rn).values = ['', r.date, r.folio_number, r.guest, r.code, r.code_name, r.description, nf(Number(r.debit || 0)), nf(Number(r.credit || 0)), nf(Number(r.balance || 0))];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', 'TOTAL', '', '', '', '', '', nf(tDebit), nf(tCredit), ''];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="guest-ledger-report.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Daily Statistic Excel ──
async function generateDailyStatisticExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Daily Statistic');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const title = ws.getCell(1, 1);
  title.value = 'DAILY STATISTIC';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 18;
  const rows: [string, any][] = [
    ['Date', row.date],
    ['Total Rooms', row.total_rooms],
    ['Check Ins', row.check_ins],
    ['Check Outs', row.check_outs],
    ['In House', row.in_house],
    ['Vacancy', row.vacancy],
    ['Occupancy Rate', row.occupancy_rate],
  ];
  let rn = 3;
  for (const [k, v] of rows) {
    ws.getRow(rn).values = [k, v];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    ws.getRow(rn).getCell(1).font = { bold: true };
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-statistic.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── On Reservation Balance Excel ──
async function generateOnResvBalExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const rows = row.reservations || [];
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('On Reservation Balance');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Folio', 'Room Type', 'Room', 'Guest', 'Group Name', 'Arrival', 'Departure', 'Rate Code', 'Payment', 'Balance'];
  const widths = [14, 14, 14, 24, 22, 12, 12, 12, 14, 14];
  const title = ws.getCell(1, 1);
  title.value = `RESERVATIONS WITH DEPOSIT BALANCES AS AT ${row.business_date || ''}`;
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = HEADERS;
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of rows) {
    ws.getRow(rn).values = [r.folio, r.roomType, r.room, r.guest, r.groupName, r.arrival, r.departure, r.rateCode, nf(Number(r.payment || 0)), nf(Number(r.balance || 0), 2)];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  ws.getRow(rn).values = ['', '', '', '', '', '', '', '', 'Total Deposit Balance', nf(Number(row.totalDepositBalance || 0), 2)];
  ws.getRow(rn).font = { bold: true };
  ws.getRow(rn).eachCell((c: any) => { c.border = border; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="on-resv-bal.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Room Type Utilization Excel ──
async function generateRoomTypeUtilizationExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Room Type Utilization');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room Type', 'Rooms', 'Percentage %', 'Revenue', 'Average'];
  const widths = [24, 12, 14, 16, 14];
  const title = ws.getCell(1, 1);
  title.value = 'ROOM TYPE UTILIZATION';
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  let rn = 3;
  for (const [label, stats] of ([['TODAY', row.today], ['MONTH TO DATE', row.monthToDate], ['YEAR TO DATE', row.yearToDate]] as any[])) {
    ws.getRow(rn).values = [label];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', ...HEADERS];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const s of stats || []) {
      ws.getRow(rn).values = ['', s.roomType, s.room, s.percentage, nf(Number(s.revenue || 0)), nf(Number(s.average || 0))];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    rn++;
  }
  for (const [label, list] of ([['COMPLIMENTARY', row.complimentary], ['DAY USE', row.dayUse], ['HOUSE USE', row.houseUse]] as any[])) {
    ws.getRow(rn).values = [label];
    ws.getRow(rn).font = { bold: true, size: 12 };
    rn++;
    const hdr = ws.getRow(rn);
    hdr.values = ['', 'Room Type', 'Count'];
    hdr.font = { bold: true };
    hdr.alignment = { horizontal: 'center' };
    hdr.eachCell((c: any) => { c.border = border; });
    rn++;
    for (const s of list || []) {
      ws.getRow(rn).values = ['', s.roomType, s.count];
      ws.getRow(rn).eachCell((c: any) => { c.border = border; });
      rn++;
    }
    rn++;
  }
  const t = row.totals || {};
  ws.getRow(rn).values = [`Total Rooms: ${t.totalRooms}   Occupied Rooms: ${t.occupiedRooms}`];
  ws.getRow(rn).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="roomtype-utilization.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Inclusive Items Excel ──
async function generateInclusiveItemsExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Inclusive Items');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Room', 'Folio', 'Guest Name', 'Company', 'Rate Code', 'Frequency', 'Calculator', 'Description', 'Adult', 'Child', 'Arrival', 'Departure'];
  const widths = [12, 14, 22, 20, 14, 12, 12, 30, 8, 8, 12, 12];
  const title = ws.getCell(1, 1);
  title.value = String(row.reportTitle || 'Inclusive Items Report').toUpperCase();
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const r of row.reportData || []) {
    ws.getRow(rn).values = ['', r.room, r.folio, r.name, r.company, r.rateCode, r.frequency, r.calculator, r.description, r.adult, r.child, r.arrival_date, r.dep_date];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="inclusive-items.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// ── Daily Room Forecast Excel ──
async function generateDailyRoomForecastExcel(res: Response, data: any): Promise<void> {
  const row = Array.isArray(data) ? data[0] : data;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Daily Room Forecast');
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  const HEADERS = ['Date', 'NG Pax', 'NG Arr', 'NG Dep', 'NG Sty', 'G Arr', 'G Dep', 'G Sty', 'Rms Held', 'Occ %', 'Room Rev', 'Bfast Rev', 'Total Rev', 'ARR Room', 'ARR', 'ARR Bfast'];
  const widths = [16, 8, 8, 8, 8, 8, 8, 8, 10, 8, 14, 14, 14, 12, 12, 12];
  const title = ws.getCell(1, 1);
  title.value = String(row.reportTitle || 'DAILY ROOM FORECAST').toUpperCase();
  title.font = { bold: true, size: 13 };
  title.alignment = { horizontal: 'center' };
  HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = widths[i]; });
  const hdr = ws.getRow(3);
  hdr.values = ['', ...HEADERS];
  hdr.font = { bold: true };
  hdr.alignment = { horizontal: 'center' };
  hdr.eachCell((c: any) => { c.border = border; });
  let rn = 4;
  for (const d of row.reportData || []) {
    ws.getRow(rn).values = ['', d.date, d.nonGrp?.pax ?? 0, d.nonGrp?.arr ?? 0, d.nonGrp?.dep ?? 0, d.nonGrp?.sty ?? 0, d.grp?.arr ?? 0, d.grp?.dep ?? 0, d.grp?.sty ?? 0, d.rmsHeld, d.occPercentage, nf(Number(d.roomRev || 0)), nf(Number(d.breakfastRev || 0)), nf(Number(d.totalRev || 0)), nf(Number(d.arrRoom || 0)), nf(Number(d.arr || 0)), nf(Number(d.arrBf || 0))];
    ws.getRow(rn).eachCell((c: any) => { c.border = border; });
    rn++;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="daily-room-forecast.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}
