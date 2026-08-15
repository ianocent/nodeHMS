import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import ExcelJS from 'exceljs';
import { success, error, badRequest, notFound } from '../utils/response';
import { STATUSES } from '../utils/cmsConfig';

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

const ROOM_STATUS_NAME: Record<number, string> = { 0: 'Vacant', 1: 'Occupied', 2: 'Out of Order', 3: 'Reserved' };
const MAID_STATUS_NAME: Record<number, string> = { 0: 'Clean', 1: 'Dirty', 2: 'Maid in Room', 3: 'Inspection Required' };
const STATUS_RESERVATION_CANCEL = 2;
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
  'account/on-resv-bal': getOnResvBal,
  'batch/after-night-audit/in-house-foliobal': getInHouseFolioBalance,
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
