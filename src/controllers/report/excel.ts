import { Response } from 'express';
import ExcelJS from 'exceljs';
import { success, error, badRequest, notFound } from '../../utils/response';
import {
  prisma, bigintToNumber, isNumeric, formatDate, formatDateDMY, formatDateDMYShort, formatDateMYShort,
  formatLongDate, diffDays, formatDMYDash, formatMonthDayYear, toJPY, revenueBetween, formatDateTimeLocal,
  nf, reservationRatePrice, startOfDay, endOfDay, safeStringify, ROOM_STATUS_NAME,
  MAID_STATUS_NAME, STATUS_RESERVATION_CHECK_IN, STATUS_RESERVATION_RESERVATION, STATUS_RESERVATION_CANCEL, STATUS_RESERVATION_PENDING,
  addDays, fmtDMY, fmtDMYHMS, safeParseJson, calcDailyRevPeriod, calcRoomRevenueNett, calcRoomRevenueTransactions,
  LONG_MONTHS, SHORT_MONTHS, STATUSES, REPORT_PERMISSION_TABLE, columnLetterFromIndex,
} from './helpers';

export async function generateExcel(
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
export async function generateDailyFlashExcel(res: Response, row: any): Promise<void> {
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


export async function generateDailyRevenueExcel(res: Response, data: any): Promise<void> {
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


export async function generateTaxBreakdownDetailExcel(res: Response, data: any, filename = 'tax-breakdown-detail'): Promise<void> {
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
export async function generateTaxBreakdownSummaryExcel(res: Response, data: any): Promise<void> {
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


export async function generateTaxBreakdownDetailJobExcel(res: Response, data: any): Promise<void> {
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


export async function generateTransactionRptExcel(res: Response, data: any): Promise<void> {
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


export async function generateTaxBreakdownAfterNAExcel(res: Response, data: any): Promise<void> {
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


export async function generateTaxBreakdownSummaryAfterNAExcel(res: Response, data: any): Promise<void> {
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


export async function generateTransferTransactionExcel(res: Response, data: any): Promise<void> {
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


export async function generateInHouseGuestDetailExcel(res: Response, data: any): Promise<void> {
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


export async function generateRoomUtilizationExcel(res: Response, data: any): Promise<void> {
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


export async function generateWeeklyBookingExcel(res: any, data: any): Promise<void> {
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


export async function generateCalendarOperationExcel(res: any, data: any): Promise<void> {
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


export async function generateDailyCheckinExcel(res: any, data: any): Promise<void> {
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


export async function generateCompanyProfileExcel(res: any, data: any): Promise<void> {
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


export async function generateGuestListingExcel(res: any, data: any): Promise<void> {
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


export async function generateCashDetailedExcel(res: Response, data: any, filename: string): Promise<void> {
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

export async function getCashSummary(params: any): Promise<any> {
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

export async function generateCashSummaryExcel(res: Response, data: any): Promise<void> {
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


export async function generateTransactionReportByStaffExcel(res: Response, data: any): Promise<void> {
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


export function renderRoomDivisionHtml(reportData: any[], dateDMY: string, startDate: string, endDate: string): string {
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

export async function renderPdf(
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

export async function renderRoomDivisionPdf(res: Response, reportData: any[], params: any): Promise<void> {
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

export function renderGenericReportHtml(data: any[], title: string, dateStr: string): string {
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

export async function renderGenericReportPdf(res: Response, data: any[], title: string, dateStr: string, fileName: string, landscape = false): Promise<void> {
  const now = new Date();
  const nowStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const header = `<div style="font-family:Arial,sans-serif;font-size:10px;width:100%;text-align:center;padding:0 10mm;"><div style="font-size:14px;font-weight:bold;">${title}</div><div style="font-size:12px;">Date: ${dateStr}</div></div>`;
  const footer = `<div style="font-family:Arial,sans-serif;font-size:9px;width:100%;padding:0 10mm;"><strong>Account/Transaction Report</strong><br><strong>Printed On:</strong> ${nowStr}</div>`;
  const pdf = await renderPdf(renderGenericReportHtml(data, title, dateStr), { header, footer, landscape });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
  res.send(pdf);
}


export async function generateRoomTypeRevenueExcel(res: Response, data: any): Promise<void> {
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


export async function generateDailySalesExcel(res: Response, data: any): Promise<void> {
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
export async function generateOwiRevenueExcel(res: Response, data: any): Promise<void> {
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
export async function generateInHouseFolioBalHistoryExcel(res: Response, data: any): Promise<void> {
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
export async function generateCommissionForBookingExcel(res: Response, data: any): Promise<void> {
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
export async function generateInHouseFolioBalanceExcel(res: Response, data: any): Promise<void> {
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
export async function generateVacantRoomsExcel(res: Response, data: any): Promise<void> {
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
export async function generateNoShowExcel(res: Response, data: any): Promise<void> {
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
export async function generateNationalityStatisticExcel(res: Response, data: any): Promise<void> {
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
export async function generateExpectedArrivalSummaryExcel(res: Response, data: any): Promise<void> {
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
export async function generateExpectedDepartureSummaryExcel(res: Response, data: any): Promise<void> {
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
export async function generateFrontOfficeDailySalesExcel(res: Response, data: any): Promise<void> {
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
export async function generateFrontOfficeDailyRevenueExcel(res: Response, data: any): Promise<void> {
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
export async function generateCancellationListingExcel(res: Response, data: any): Promise<void> {
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
export async function generateBirthdayReportExcel(res: Response, data: any): Promise<void> {
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
export async function generateFreeOfChargeDetailExcel(res: Response, data: any): Promise<void> {
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
export async function generateReservationsByStaffExcel(res: Response, data: any): Promise<void> {
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
export async function generateRoomTypeDetailedExcel(res: Response, data: any): Promise<void> {
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
export async function generateInHouseGuestListingExcel(res: Response, data: any): Promise<void> {
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
export async function generateRoomTypeMonthlyExcel(res: Response, data: any): Promise<void> {
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
export async function generateSameDayCheckOutCheckInExcel(res: Response, data: any): Promise<void> {
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
export async function generateTransactionByStaffFOExcel(res: Response, data: any): Promise<void> {
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
export async function generateRoomStatusReportExcel(res: Response, data: any): Promise<void> {
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
export async function generateBlockRoomsReportExcel(res: Response, data: any): Promise<void> {
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
export async function generateRoomChangeHistoryExcel(res: Response, data: any): Promise<void> {
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
export async function generateRateCodeAnalysisExcel(res: Response, data: any): Promise<void> {
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
export async function generateVacantAndDirtyRoomsExcel(res: Response, data: any): Promise<void> {
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
export async function generateBreakfastReportExcel(res: Response, data: any): Promise<void> {
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
export async function generateRoomRevenueBreakdownExcel(res: Response, data: any): Promise<void> {
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
export async function generateAllCompaniesRoomRevenueExcel(res: Response, data: any): Promise<void> {
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
export async function generateAllCompaniesRoomRevenueBreakdownExcel(res: Response, data: any): Promise<void> {
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
export async function generateMarketSegmentationExcel(res: Response, data: any): Promise<void> {
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
export async function generateNationalityStatisticsDetailedExcel(res: Response, data: any): Promise<void> {
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
export async function generateStaffSalesSummaryExcel(res: Response, data: any): Promise<void> {
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
export async function generateRoomOccupancyChartExcel(res: Response, data: any): Promise<void> {
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
export async function generateOccupancyRevenueReportExcel(res: Response, data: any): Promise<void> {
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
export async function generateFinancialReportExcel(res: Response, data: any): Promise<void> {
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
export async function generateTransactionReportExcel(res: Response, data: any): Promise<void> {
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
export async function generateGuestLedgerExcel(res: Response, data: any): Promise<void> {
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
export async function generateDailyStatisticExcel(res: Response, data: any): Promise<void> {
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
export async function generateOnResvBalExcel(res: Response, data: any): Promise<void> {
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
export async function generateRoomTypeUtilizationExcel(res: Response, data: any): Promise<void> {
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
export async function generateInclusiveItemsExcel(res: Response, data: any): Promise<void> {
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
export async function generateDailyRoomForecastExcel(res: Response, data: any): Promise<void> {
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