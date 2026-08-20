import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../../utils/response';
import { STATUSES } from '../../utils/cmsConfig';
export { STATUSES };

export const STATUS_RESERVATION_CANCEL = 2; // config cms.status_reservation.cancel_reservation.id

// Laravel ReportPermission::formatTable parity
export const REPORT_PERMISSION_TABLE = [
  { label: 'No', key: 'no', type: 'none', is_search: false },
  { label: 'Status', key: 'status', type: 'checkbox', options: STATUSES, is_search: false },
  { label: 'Name', key: 'master_report', type: 'select_multiple', is_search: false },
  { label: 'Role', key: 'role_id', type: 'select', is_search: false },
  { label: 'Action', key: 'action', type: 'action', is_search: false },
];

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

export function bigintToNumber(val: any): any {
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

export function isNumeric(v: any): boolean {
  return v !== '' && v !== null && !isNaN(Number(v));
}

export function formatDate(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function formatDateDMY(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

export function formatDateDMYShort(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(2)}`;
}

export function formatDateMYShort(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}-${String(dt.getFullYear()).slice(2)}`;
}

export const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatLongDate(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getDate()} ${LONG_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

export function diffDays(a: any, b: any): number {
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDMYDash(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}-${SHORT_MONTHS[dt.getMonth()]}-${dt.getFullYear()}`;
}

export function formatMonthDayYear(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${LONG_MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

export async function revenueBetween(pid: any, s: Date, e: Date, type?: string): Promise<number> {
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

export function toJPY(amount: number, kurs?: any): number {
  const k = Number(kurs ?? process.env.DEFAULT_KURS_JPY ?? 0) || 0;
  if (!k) return 0;
  const val = Number(amount ?? 0) / k;
  // round to 2 decimals
  return Math.round(val * 100) / 100;
}

export function columnLetterFromIndex(index: number): string {
  let letter = '';
  let current = index;

  while (current > 0) {
    const rem = (current - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    current = Math.floor((current - 1) / 26);
  }

  return letter;
}


export async function calcDailyRevPeriod(
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

export async function calcRoomRevenueNett(pid: bigint, s: string, e: string): Promise<number> {
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

export async function calcRoomRevenueTransactions(pid: bigint, s: string, e: string): Promise<number> {
  const agg = await prisma.transactions.aggregate({
    where: { property_id: pid, date: { gte: new Date(`${s}T00:00:00Z`), lte: new Date(`${e}T00:00:00Z`), }, type: 'room_revenue' },
    _sum: { amount: true },
  });
  return Number(agg._sum?.amount || 0);
}


export function formatDateTimeLocal(d: any): string {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear()).slice(2)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
}


export function parseReportParams(req: Request) {
  return {
    date: req.query.date as string || formatDate(new Date()),
    startDate: req.query.startDate as string || req.query.start_date as string || '',
    endDate: req.query.endDate as string || req.query.end_date as string || '',
    typeOps: req.query.typeOps as string || '',
    kurs: req.query.kurs as string || '',
    staffId: req.query.staffId as string || req.query.staff_id as string || '',
  };
}

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Report data generators ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼


export function nf(v: any, dec = 0): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!isFinite(n)) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function reservationRatePrice(r: any): number {
  const d = safeParseJson(r?.data);
  const p = d?.rate_price;
  return p !== undefined && p !== null && p !== '' ? Number(p) : 0;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}


export function safeStringify(v: any): string {
  return JSON.stringify(v, (_k: string, val: any) => (typeof val === 'bigint' ? val.toString() : val));
}

export const ROOM_STATUS_NAME: Record<number, string> = { 0: 'Vacant', 1: 'Occupied', 2: 'Out of Order', 3: 'Reserved' };
export const MAID_STATUS_NAME: Record<number, string> = { 0: 'Clean', 1: 'Dirty', 2: 'Maid in Room', 3: 'Inspection Required' };
export const STATUS_RESERVATION_CHECK_IN = 0;
export const STATUS_RESERVATION_RESERVATION = 3;
export const STATUS_RESERVATION_PENDING = 5;

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

export function fmtDMY(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

export function fmtDMYHMS(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${fmtDMY(dt)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
}


export function safeParseJson(v: any): any {
  if (v && typeof v === 'object') return v;
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
