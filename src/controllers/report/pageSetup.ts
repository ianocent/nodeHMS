// Per-report PDF page setup, ported from the Laravel controllers' `setPaper()` /
// `setOptions()` calls. The generic renderer used to force A4 landscape with 45mm/35mm
// margins on every report, which clipped wide tables and wasted a portrait page on
// narrow ones.
//
// Keys are report paths WITHOUT the leading `report/` and without the `/view` suffix —
// i.e. the value `handleReport` computes before appending `/view`.
export interface PdfPageSetup {
    orientation: 'portrait' | 'landscape';
    margin: { top: number; bottom: number; left: number; right: number };
    /** Uses `pdf/batch/account/partials/footer.blade.php` ("Account/Transaction Report"). */
    accountFooter: boolean;
}

const DEFAULT_SETUP: PdfPageSetup = {
    orientation: 'landscape',
    margin: { top: 20, bottom: 20, left: 10, right: 10 },
    accountFooter: false,
};

// Every entry below was read off the base reference controllers. Grouped as in
// `app/Http/Controllers/Cms/Report/Batch/<Group>/`.
export const REPORT_PDF_SETUP: Record<string, PdfPageSetup> = {
    // ── Account (19 controllers) ──
    'account/tax-breakdown-summary': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/tax-breakdown-detail-report': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/transaction-report-detail': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/cash-detailed': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/cash-summary': { orientation: 'portrait', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/comission-for-booking-company': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/comission-for-booking': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/daily-flash-report': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/daily-revenue-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },
    'account/daily-sales-report': { orientation: 'portrait', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },
    'account/guest-ledger-report': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/in-house-folio-bal-history': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/on-resv-bal': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'account/owi-revenue-report': { orientation: 'portrait', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/room-type-revenue-report': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/transaction-report-by-staff': { orientation: 'portrait', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'account/transaction-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },
    'account/tax-breakdown-detail': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },

    // ── After Night Audit (12 controllers) ──
    'batch/after-night-audit/daily-room-forecast': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/daily-statistic': { orientation: 'portrait', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/inclusive-items': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/in-house-foliobal': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/nationality-statistic': { orientation: 'portrait', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/no-show': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/on-resbal': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/room-division': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/roomtype-utilization': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/tax-breakdown': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/tax-breakdown-summary': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/after-night-audit/vacant-rooms': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },

    // ── Before Night Audit (8 controllers) ──
    'batch/before-night-audit/before-in-house-foliobal': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/before-night-audit/breakfast-report': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/before-night-audit/expected-arrival-summary': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/before-night-audit/expected-departure-summary': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/before-night-audit/rate-code-analysis': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/before-night-audit/room-revenue-breakdown': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/before-night-audit/transaction-rpt': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/before-night-audit/vacant-and-dirty-rooms': { orientation: 'portrait', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },

    // ── Front Office (12 controllers) ──
    'batch/frontoffice/guest-listing-report': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/frontoffice/in-house-guest-detail': { orientation: 'landscape', margin: { top: 30, bottom: 30, left: 10, right: 10 }, accountFooter: true },
    'batch/frontoffice/cancellation-listing': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/frontoffice/free-of-charge-detail-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/frontoffice/in-house-guest-listing': { orientation: 'landscape', margin: { top: 20, bottom: 5, left: 15, right: 15 }, accountFooter: false },
    'batch/frontoffice/reservations-by-staff': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/frontoffice/room-type-detailed-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },
    'batch/frontoffice/room-type-monthly-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/frontoffice/same-day-check-out-check-in-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/frontoffice/transaction-by-staff-report': { orientation: 'portrait', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/frontoffice/transfer-transaction': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/frontoffice/birthday-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },

    // ── Housekeeping (4 controllers) ──
    'batch/housekeeping/block-rooms-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/housekeeping/room-change-history': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/housekeeping/room-status-report': { orientation: 'portrait', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },
    'batch/housekeeping/room-utilization-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },

    // ── Sales Marketing (6 controllers) ──
    'batch/sales-marketing/all-companies-room-revenue': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/sales-marketing/all-companies-room-revenue-breakdown-report': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 10, right: 10 }, accountFooter: false },
    'batch/sales-marketing/market-segmentation-report': { orientation: 'portrait', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/sales-marketing/nationality-statistics-detailed': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/sales-marketing/room-occupancy-chart': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
    'batch/sales-marketing/staff-sales-summary': { orientation: 'landscape', margin: { top: 20, bottom: 20, left: 15, right: 15 }, accountFooter: false },
};

function normalizeReportKey(reportKey: string): string {
    return reportKey.replace(/^report\//, '').replace(/\/view$/, '');
}

export function getReportPdfSetup(reportKey: string): PdfPageSetup {
    const normalized = normalizeReportKey(reportKey);
    return REPORT_PDF_SETUP[normalized] ?? DEFAULT_SETUP;
}
