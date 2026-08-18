// CMS config lists replicating config/cms.php + helper moneyFormat + CodePost.calculate parity.

export interface OptionItem {
  value: number | string | boolean;
  label: string;
}

export const STATUSES: OptionItem[] = [
  { value: 1, label: 'Active' },
  { value: 0, label: 'Inactive' },
];

/**
 * Laravel HasStatus::getStatus() parity — returns {value, label} for a status id.
 * Uses STATUSES config (active/inactive) as default.
 */
export function getStatusLabel(statusId: number | null | undefined): { value: number; label: string } {
  const s = STATUSES.find((x) => x.value === statusId);
  return { value: statusId ?? 0, label: s?.label ?? 'Unknown' };
}

export const REGIONS: OptionItem[] = [
  { value: 'Asia', label: 'Asia' },
  { value: 'Europe', label: 'Europe' },
  { value: 'Africa', label: 'Africa' },
  { value: 'America', label: 'America' },
  { value: 'Oceania', label: 'Oceania' },
  { value: 'Polar', label: 'Polar' },
];

export const SUBSCRIBE_TYPES: OptionItem[] = [
  { value: 0, label: 'Monthly' },
  { value: 1, label: 'Yearly' },
];

export const BILLINGS: OptionItem[] = [
  { value: 0, label: 'By Company' },
  { value: 1, label: 'By Department' },
];

export const TERMS: OptionItem[] = [
  { value: 'Cash', label: 'Cash' },
  { value: '7 Days', label: '7 Days' },
  { value: '14 Days', label: '14 Days' },
  { value: '30 Days', label: '30 Days' },
  { value: '45 Days', label: '45 Days' },
  { value: '60 Days', label: '60 Days' },
  { value: '90 Days', label: '90 Days' },
];

export const ITEM_LOST_FOUND_STATUS: OptionItem[] = [
  { value: 'Enquiry', label: 'Enquiry' },
  { value: 'Unclaimed', label: 'Unclaimed' },
  { value: 'Claimed', label: 'Claimed' },
  { value: 'Remaining lost', label: 'Remaining lost' },
];

export const STATUS_LOST: OptionItem[] = [
  { value: 'Lost', label: 'Lost' },
  { value: 'Found', label: 'Found' },
];

export const IS_TAXS: OptionItem[] = [
  { value: true, label: 'Inclusive Tax' },
  { value: false, label: 'Exclusive Tax' },
];

export const IS_TAX_EXCLUDE_RESTAURANTS: OptionItem[] = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
];

export const DASHBOARDS: OptionItem[] = [
  { value: 'total_room', label: 'Total Room' },
  { value: 'chart_room', label: 'Chart Room' },
  { value: 'daily_room_revenue_forecast', label: 'Daily Room Revenue Forecast' },
  { value: 'today_revenue', label: 'Today Revenue' },
  { value: 'departure', label: 'Departure' },
  { value: 'arrival_git', label: 'Arrival GIT' },
  { value: 'arrival_fit', label: 'Arrival FIT' },
  { value: 'total_arrival_git_fit', label: 'Total Arrival GIT & FIT' },
  { value: 'forecast', label: 'Forecast' },
  { value: 'chart_analysis_history_forecast', label: 'Chart Analysis History & Forecast' },
  { value: 'total_room_revenue', label: 'Total Room Revenue' },
  { value: 'maps', label: 'Maps' },
  { value: 'market_segment_1', label: 'Market Segment 1' },
  { value: 'market_segment_2', label: 'Market Segment 2' },
  { value: 'market_segment_3', label: 'Market Segment 3' },
  { value: 'market_segment_4', label: 'Market Segment 4' },
  { value: 'hotel_competitor', label: 'Hotel Competitor' },
  { value: 'house_use_complimentary', label: 'House Use & Complimentary' },
  { value: 'mtd_actual_vs_budget', label: 'MTD Actual vs Budget' },
  { value: 'room_sold_per_segment', label: 'Room Sold per Segment' },
  { value: 'forecast_per_room_sold', label: 'Forecast per Room Sold' },
  { value: 'room_sold_rbv_vs_ro', label: 'Room Sold RBV vs RO' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'guest_requests', label: 'Guest Requests' },
];

export function moneyFormat(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return '0,00';
  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return grouped + ',' + decPart;
}

export interface CodePostCalcResult {
  amount: number;
  service: number;
  tax3: number;
  pb1: number;
  total: number;
}

// Replicates Laravel CodePost::calculate (inclusive/exclusive) without promo support.
export function calculateCodePost(
  codePost: {
    tax: number | boolean | null;
    tax_percentage: number | string | null;
    local_tax: number | boolean | null;
    local_tax_percentage: number | string | null;
    service_charge: number | boolean | null;
    service_charge_percentage: number | string | null;
    service_charge_include_local_tax: number | boolean | null;
    tax_include_local_tax: number | boolean | null;
  },
  amount: number,
  isTax: boolean
): CodePostCalcResult {
  const taxPercentage = codePost.tax ? Number(codePost.tax_percentage ?? 0) : 0;
  const localTaxPercentage = codePost.local_tax ? Number(codePost.local_tax_percentage ?? 0) : 0;
  const serviceChargePercentage = codePost.service_charge ? Number(codePost.service_charge_percentage ?? 0) : 0;
  const serviceChargeIncludeLocalTax = codePost.service_charge_include_local_tax
    ? (serviceChargePercentage / 100) * (localTaxPercentage / 100)
    : 0;
  const taxIncludeLocalTax = codePost.tax_include_local_tax
    ? (taxPercentage / 100) * (localTaxPercentage / 100)
    : 0;

  if (isTax) {
    const newAmount =
      amount /
      (1 +
        localTaxPercentage / 100 +
        serviceChargePercentage / 100 +
        serviceChargeIncludeLocalTax +
        taxPercentage / 100 +
        taxIncludeLocalTax);
    let pb1 = newAmount * (localTaxPercentage / 100);
    const service = newAmount * (serviceChargePercentage / 100);
    const tax3 = newAmount * (taxPercentage / 100);
    if (codePost.service_charge_include_local_tax) pb1 += newAmount * serviceChargeIncludeLocalTax;
    if (codePost.tax_include_local_tax) pb1 += newAmount * taxIncludeLocalTax;
    return { amount: newAmount, service, tax3, pb1, total: amount };
  }

  let service = 0;
  let tax3 = 0;
  let pb1 = 0;
  if (codePost.service_charge) service += amount * (serviceChargePercentage / 100);
  if (codePost.tax) tax3 += amount * (taxPercentage / 100);
  if (codePost.local_tax) {
    pb1 += amount * (localTaxPercentage / 100);
    if (codePost.service_charge_include_local_tax) pb1 += service * (localTaxPercentage / 100);
    if (codePost.tax_include_local_tax) pb1 += tax3 * (localTaxPercentage / 100);
  }
  return { amount, service, tax3, pb1, total: amount + service + tax3 + pb1 };
}