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

function formatDate(d: any): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
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

function nf(v: any, dec = 0): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!isFinite(n)) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function reservationRatePrice(r: any): number {
  const d = safeParseJson(r?.data);
  const p = d?.rate_price;
  return p !== undefined && p !== null && p !== '' ? Number(p) : Number(r?.amount) || 0;
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
    where: { group: `market-segment-${segmentNumber}`, name: segment, deleted_at: null, status: 1 },
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
      where: { group: `market-segment-${i}`, deleted_at: null, status: 1 },
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
  const end = new Date(`${endDate}T23:59:59Z`);

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
      reservations: { orderBy: { id: 'desc' }, take: 1, include: { room_types: true, rates: true } },
    },
  });

  const roomIds = [...new Set(folios.map((f: any) => f.reservations?.[0]?.room_id).filter((v: any) => v !== null && v !== undefined))];
  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null && v !== undefined))];
  const parentIds = [...new Set(folios.filter((f: any) => f.type_reservation === 'git' && f.parent && Number(f.parent) !== 0).map((f: any) => f.parent as bigint))];
  const [rooms, guests, parents] = await Promise.all([
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : Promise.resolve([] as any[]),
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : Promise.resolve([] as any[]),
    parentIds.length ? prisma.folios.findMany({ where: { id: { in: parentIds } }, select: { id: true, company_profiles_folios_company_profile_idTocompany_profiles: { select: { id: true, name: true, credit_limit: true } } } }) : Promise.resolve([] as any[]),
  ]);
  const roomById = new Map(rooms.map((r: any) => [r.id, r.name]));
  const guestById = new Map(guests.map((g: any) => [g.id, g]));
  const parentById = new Map(parents.map((p: any) => [p.id, p]));

  const folioIds = folios.map((f: any) => f.id);
  const txns = folioIds.length
    ? await prisma.transactions.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null }, select: { folio_id: true, type_amount: true, total: true } })
    : [];
  const balanceByFolio = new Map<string, number>();
  for (const t of txns) {
    const key = t.folio_id.toString();
    const cur = balanceByFolio.get(key) ?? 0;
    balanceByFolio.set(key, cur + (t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0)));
  }

  const grouped: Record<string, any> = {};
  let grandTotal = 0;
  for (const folio of folios) {
    const res = folio.reservations?.[0];
    if (!res) continue;
    const isSubGit = folio.type_reservation === 'git' && folio.parent && Number(folio.parent) !== 0;
    const parent = isSubGit ? parentById.get(folio.parent as bigint) : null;
    const company: any = parent?.company_profiles_folios_company_profile_idTocompany_profiles || folio.company_profiles_folios_company_profile_idTocompany_profiles;
    const companyId = parent?.company_profiles_folios_company_profile_idTocompany_profiles?.id?.toString()
      || folio.company_profiles_folios_company_profile_idTocompany_profiles?.id?.toString()
      || 'unknown';
    const companyName = parent?.company_profiles_folios_company_profile_idTocompany_profiles?.name
      || folio.company_profiles_folios_company_profile_idTocompany_profiles?.name
      || 'Unknown';

    const balance = balanceByFolio.get(folio.id.toString()) ?? 0;
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
  const method = 'room_type_detailed_report';
  const requestId = `${startDate}-${endDate}-${String(pid)}-${method}`;
  const existing = await prisma.requests.findFirst({ where: { request_id: requestId, property_id: pid, created_at: { gte: new Date(Date.now() - 10 * 60000) } }, orderBy: { id: 'desc' } });
  if (!existing) {
    await prisma.requests.create({ data: { request_id: requestId, property_id: pid, method, start_date: startDate, end_date: endDate, status: 0, created_at: new Date() } });
  }
  return [{ status: 'success', message: 'Report is being generated. Please check back later.', request_id: requestId }];
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
  const pid = params.propertyId;
  const businessDate = formatDate(new Date());
  const startDate = (params.startDate ? params.startDate.slice(0, 10) : businessDate);
  const endDate = (params.endDate ? params.endDate.slice(0, 10) : businessDate);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  const txns = await prisma.transaction_breakdowns.findMany({
    where: {
      property_id: pid, date: { gte: start, lte: end }, is_transfer: 0,
      type: { notIn: ['payment', 'paidout', 'refund'] },
      folios: { is: { OR: [{ type_reservation: 'fit' }, { type_reservation: 'git' }, { type_reservation: 'vr', folio_number: { startsWith: 'F' } }], property_id: pid } },
    },
    select: { id: true, transaction_id: true, date: true, type: true, type_amount: true, amount: true, total: true, code: true, folio_id: true },
  });
  if (!txns.length) {
    return [{ startDate, endDate, companies: [], grandTotal: { roomNights: 0, nettRevenue: 0, grossRevenue: 0, anrSum: 0, agrSum: 0, folioCount: 0, anr: 0, agr: 0 } }];
  }
  const codeIds = [...new Set(txns.map((t: any) => t.code).filter(Boolean))];
  const cps = codeIds.length ? await prisma.code_posts.findMany({ where: { id: { in: codeIds.map((c: string) => BigInt(c)) } }, include: { code_billings: true } }) : [];
  const roomRevenueCodes = new Set(cps.filter((cp: any) => (cp.code_billings?.name || '').toLowerCase().includes('room revenue')).map((cp: any) => cp.id));
  const folioIds = [...new Set(txns.map((t: any) => t.folio_id).filter((v: any) => v !== null && v !== 0n))];
  const folios = folioIds.length ? await prisma.folios.findMany({
    where: { id: { in: folioIds } },
    select: { id: true, folio_number: true, company_profile_id: true, guest_profile_id: true, check_in_date: true, check_out_date: true, parent: true, type_reservation: true, reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, select: { id: true, date: true, room_id: true, room_type_id: true, rate_id: true } } },
  }) : [];
  const folioById = new Map(folios.map((f: any) => [f.id, f]));
  const childFolioByParent = new Map<bigint, any>();
  for (const f of folios) {
    if (f.parent && f.parent !== 0n) {
      const arr = childFolioByParent.get(f.parent) || [];
      arr.push(f);
      childFolioByParent.set(f.parent, arr);
    }
  }
  const companyIds = [...new Set(folios.map((f: any) => f.company_profile_id).filter((v: any) => v !== null && v !== 0n))];
  const guestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter((v: any) => v !== null))];
  const roomIds = [...new Set(folios.flatMap((f: any) => f.reservations?.map((r: any) => r.room_id) ?? []).filter((v: any) => v !== null))];
  const [companies, guests, rooms] = await Promise.all([
    companyIds.length ? prisma.company_profiles.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
    guestIds.length ? prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } }) : [],
    roomIds.length ? prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } }) : [],
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
      const sourceFolio = isParent ? (childFolioByParent.get(folio.id)?.[0] || folio) : folio;
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
        roomNo: room?.name ?? 'N/A',
        guestName: guest ? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim() : 'N/A',
        arrivalDate: folio.check_in_date,
        depDate: folio.check_out_date,
        roomNights: t.type === 'room_revenue' ? roomNights : `0 ( ${cps.find((cp: any) => cp.id === (t.code ? BigInt(t.code) : -1n))?.name ?? ''} ) `,
        nettRevenue: Number(nettRevenue.toFixed(2)),
        anr: Number(anr.toFixed(2)),
        grossRevenue: Number(grossRevenue.toFixed(2)),
        agr: Number(agr.toFixed(2)),
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
    grandTotal.roomNights += companyData.total.roomNights;
  }
  grandTotal.anr = grandTotal.roomNights > 0 ? grandTotal.nettRevenue / grandTotal.roomNights : 0;
  grandTotal.agr = grandTotal.roomNights > 0 ? grandTotal.grossRevenue / grandTotal.roomNights : 0;

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

async function getRoomTypeRevenueReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const start = params.startDate || params.date;
  const end = params.endDate || start;
  const reservations = await prisma.reservations.findMany({
    where: { property_id: pid, deleted_at: null, date: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T23:59:59Z`) } },
    include: { room_types: { select: { name: true } } },
  });
  const byType: Record<string, { revenue: number; nights: number; count: number }> = {};
  for (const r of reservations) {
    const name = r.room_types?.name || r.room_type_name || 'Unknown';
    if (!byType[name]) byType[name] = { revenue: 0, nights: 0, count: 0 };
    byType[name].revenue += Number(r.amount);
    byType[name].nights += r.night || 0;
    byType[name].count += 1;
  }
  return Object.entries(byType).map(([room_type, v]) => ({
    room_type,
    room_nights: v.nights,
    reservations: v.count,
    revenue: v.revenue,
    avg_rate: v.nights > 0 ? v.revenue / v.nights : 0,
  }));
}

async function getOwiRevenueReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const start = params.startDate || params.date;
  const end = params.endDate || start;
  const folios = await prisma.folios.findMany({
    where: { property_id: pid, deleted_at: null, check_in_date: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T23:59:59Z`) }, is_walk_in: true },
    select: { id: true, folio_number: true, first_name: true, last_name: true, check_in_date: true, total_amount: true },
  });
  return folios.map((f: any) => ({
    folio_number: f.folio_number,
    guest_name: `${f.first_name || ''} ${f.last_name || ''}`.trim(),
    check_in: f.check_in_date ? formatDate(f.check_in_date) : '',
    total_amount: Number(f.total_amount),
  }));
}

async function getOccupancyRevenueReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const start = params.startDate || params.date;
  const end = params.endDate || start;
  const reservations = await prisma.reservations.findMany({
    where: { property_id: pid, deleted_at: null, date: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T23:59:59Z`) } },
    include: { room_types: { select: { name: true } } },
  });
  const totalRooms = await prisma.rooms.count({ where: { property_id: pid, deleted_at: null } });
  const days = Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
  const totalRoomNights = totalRooms * days;
  const occupiedNights = reservations.reduce((s: number, r: any) => s + (r.night || 0), 0);
  const revenue = reservations.reduce((s: number, r: any) => s + Number(r.amount), 0);
  const occupancy = totalRoomNights > 0 ? (occupiedNights / totalRoomNights) * 100 : 0;
  const arr = occupiedNights > 0 ? revenue / occupiedNights : 0;
  return [{ period: `${start} to ${end}`, total_rooms: totalRooms, total_room_nights: totalRoomNights, occupied_nights: occupiedNights, occupancy_pct: occupancy, revenue, arr }];
}

async function getFinancialReport(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const start = params.startDate || params.date;
  const end = params.endDate || start;
  const folios = await prisma.folios.findMany({
    where: { property_id: pid, deleted_at: null, check_in_date: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T23:59:59Z`) } },
    select: { id: true, total_amount: true, status_reservation: true },
  });
  const totalRevenue = folios.reduce((s: number, f: any) => s + Number(f.total_amount), 0);
  const cancelled = folios.filter((f: any) => f.status_reservation === 2).length;
  return [{
    period: `${start} to ${end}`,
    total_folios: folios.length,
    cancelled_folios: cancelled,
    net_folios: folios.length - cancelled,
    total_revenue: totalRevenue,
    avg_per_folio: folios.length > 0 ? totalRevenue / folios.length : 0,
  }];
}

async function getAllCompaniesRoomRevenueBreakdown(params: any): Promise<any[]> {
  const pid = params.propertyId;
  const start = params.startDate || params.date;
  const end = params.endDate || start;
  const folios = await prisma.folios.findMany({
    where: { property_id: pid, deleted_at: null, check_in_date: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T23:59:59Z`) }, company_profile_id: { gt: 0 } },
    select: { id: true, company_name: true, total_amount: true },
  });
  const folioIds = folios.map((f: any) => f.id);
  const reservations = await prisma.reservations.findMany({
    where: { folio_id: { in: folioIds }, deleted_at: null },
    select: { folio_id: true, night: true, amount: true },
  });
  const resByFolio: Record<string, { nights: number; revenue: number }> = {};
  for (const r of reservations) {
    const key = String(r.folio_id);
    if (!resByFolio[key]) resByFolio[key] = { nights: 0, revenue: 0 };
    resByFolio[key].nights += r.night || 0;
    resByFolio[key].revenue += Number(r.amount);
  }
  const byCompany: Record<string, { nights: number; revenue: number; folios: number }> = {};
  for (const f of folios) {
    const name = f.company_name || 'Unknown';
    if (!byCompany[name]) byCompany[name] = { nights: 0, revenue: 0, folios: 0 };
    byCompany[name].folios += 1;
    byCompany[name].revenue += Number(f.total_amount);
    const res = resByFolio[String(f.id)];
    if (res) {
      byCompany[name].nights += res.nights;
      byCompany[name].revenue += res.revenue;
    }
  }
  return Object.entries(byCompany).map(([company, v]) => ({
    company,
    folios: v.folios,
    room_nights: v.nights,
    revenue: v.revenue,
  }));
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
  'account/comission-for-booking': (p: any) => getCommissionForBooking(p, false),
  'account/comission-for-booking-company': (p: any) => getCommissionForBooking(p, true),
  'account/tax-breakdown-summary': getTaxBreakdownSummary,
  'account/in-house-folio-bal-history': getInHouseFolioBalHistory,
  'account/transaction-report-by-staff': getTransactionReportByStaff,
  'account/daily-revenue-report': (p: any) => getAsyncJobReport('daily_revenue_report', p),
  'account/tax-breakdown-detail': (p: any) => getAsyncJobReport('tax_breakdown_detail', p),
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
  'account/comission-for-booking/view': (p: any) => getCommissionForBooking(p, false),
  'account/comission-for-booking-company/view': (p: any) => getCommissionForBooking(p, true),
  'account/tax-breakdown-summary/view': getTaxBreakdownSummary,
  'account/in-house-folio-bal-history/view': getInHouseFolioBalHistory,
  'account/transaction-report-by-staff/view': getTransactionReportByStaff,
  'account/daily-revenue-report/view': (p: any) => getAsyncJobReport('daily_revenue_report', p),
  'account/tax-breakdown-detail/view': (p: any) => getAsyncJobReport('tax_breakdown_detail', p),
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
      const params = { ...parseReportParams(req), propertyId: pid, folioId: req.query.folio_id as string || '' };

      const segments = path.split('/').filter(Boolean);
      const typeOps = req.query.typeOps as string || '';

      const reportKey = typeOps === 'view' ? `${path}/view` : path;

      if (reportHandlers[reportKey]) {
        const data = await reportHandlers[reportKey](params);

        if (typeOps === 'view') {
          if (reportKey === 'batch/after-night-audit/room-division' || reportKey === 'batch/after-night-audit/room-division/view') {
            const fileName = 'room-division-report';
            await generateExcel(res, Array.isArray(data) ? data : [data], Object.keys((Array.isArray(data) ? data[0] : data) || {}).map((k) => ({
              header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              key: k,
            })), fileName);
            return;
          }
          if (reportKey.startsWith('account/')) {
            const baseKey = reportKey.replace('/view', '');
            const fileName = baseKey.replace('/', '-');
            await generateExcel(res, Array.isArray(data) ? data : [data], Object.keys((Array.isArray(data) ? data[0] : data) || {}).map((k) => ({
              header: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              key: k,
            })), fileName);
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

