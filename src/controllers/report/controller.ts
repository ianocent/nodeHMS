import { Request, Response } from 'express';
import { success, error, badRequest, notFound } from '../../utils/response';
import { prisma, parseReportParams, REPORT_PERMISSION_TABLE, bigintToNumber, formatDate } from './helpers';
import { STATUSES } from '../../utils/cmsConfig';
import { reportHandlers, getGenericReport } from './handlers';
import {
  generateAllCompaniesRoomRevenueBreakdownExcel,
  generateAllCompaniesRoomRevenueExcel,
  generateBirthdayReportExcel,
  generateBlockRoomsReportExcel,
  generateBreakfastReportExcel,
  generateCalendarOperationExcel,
  generateCancellationListingExcel,
  generateCashDetailedExcel,
  generateCashSummaryExcel,
  generateCommissionForBookingExcel,
  generateCompanyProfileExcel,
  generateDailyCheckinExcel,
  generateDailyFlashExcel,
  generateDailyRevenueExcel,
  generateDailyRoomForecastExcel,
  generateDailySalesExcel,
  generateDailyStatisticExcel,
  generateExcel,
  generateExpectedArrivalSummaryExcel,
  generateExpectedDepartureSummaryExcel,
  generateFinancialReportExcel,
  generateFreeOfChargeDetailExcel,
  generateFrontOfficeDailyRevenueExcel,
  generateFrontOfficeDailySalesExcel,
  generateGuestLedgerExcel,
  generateGuestListingExcel,
  generateInclusiveItemsExcel,
  generateInHouseFolioBalanceExcel,
  generateInHouseFolioBalHistoryExcel,
  generateInHouseGuestDetailExcel,
  generateInHouseGuestListingExcel,
  generateMarketSegmentationExcel,
  generateNationalityStatisticExcel,
  generateNationalityStatisticsDetailedExcel,
  generateNoShowExcel,
  generateOccupancyRevenueReportExcel,
  generateOnResvBalExcel,
  generateOwiRevenueExcel,
  generateRateCodeAnalysisExcel,
  generateReservationsByStaffExcel,
  generateRoomChangeHistoryExcel,
  generateRoomOccupancyChartExcel,
  generateRoomRevenueBreakdownExcel,
  generateRoomStatusReportExcel,
  generateRoomTypeDetailedExcel,
  generateRoomTypeMonthlyExcel,
  generateRoomTypeRevenueExcel,
  generateRoomTypeUtilizationExcel,
  generateRoomUtilizationExcel,
  generateSameDayCheckOutCheckInExcel,
  generateStaffSalesSummaryExcel,
  generateTaxBreakdownAfterNAExcel,
  generateTaxBreakdownDetailExcel,
  generateTaxBreakdownDetailJobExcel,
  generateTaxBreakdownSummaryAfterNAExcel,
  generateTaxBreakdownSummaryExcel,
  generateTransactionByStaffFOExcel,
  generateTransactionReportByStaffExcel,
  generateTransactionReportExcel,
  generateTransactionRptExcel,
  generateTransferTransactionExcel,
  generateVacantAndDirtyRoomsExcel,
  generateVacantRoomsExcel,
  generateWeeklyBookingExcel,
  renderRoomDivisionHtml,
  renderPdf,
  renderRoomDivisionPdf,
  renderGenericReportHtml,
  renderGenericReportPdf,
} from './excel';

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