import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { dataSearch, applySearchField } from '../utils/search';
import { moneyFormat, calculateCodePost } from '../utils/cmsConfig';
import { ROOM_STATUSES, STATUS_RESERVATION_MAP } from '../utils/cmsStatus';
import { findPromosForNight, priceNight, PromoLike, applyPromoDiscounts } from '../utils/reservationPricing';
import { AuthController } from './auth.controller';
import { enqueueJob } from '../config/queue';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Status reservation constants (matching Laravel config/cms.php)
const STATUS_RESERVATION = {
  check_in: { id: 0, code: 'check_in', name: 'Check In' },
  check_out: { id: 1, code: 'check_out', name: 'Check Out' },
  cancel_reservation: { id: 2, code: 'cancel_reservation', name: 'Cancelled' },
  reservation: { id: 3, code: 'reservation', name: 'Reservation' },
  in_house: { id: 4, code: 'in_house', name: 'In House' },
  pending: { id: 5, code: 'pending', name: 'Pending' },
};

// Type reservation constants (matching Laravel config/cms.php type_reservation)
const TYPE_RESERVATION = {
  fit: { code: 'fit', name: 'FIT' },
  git: { code: 'git', name: 'GIT' },
  vr: { code: 'vr', name: 'VR' },
  'day-use': { code: 'day-use', name: 'Day Use' },
};

// Matches Laravel getColorReservation() + Folio formatData status_reservation_color
const COLOR_RESERVATION: Record<number, string> = {
  0: 'bg-green',
  1: 'bg-purple',
  2: 'bg-red',
  3: 'bg-cyan',
  4: 'bg-blue',
  5: 'bg-yellow',
};

function statusReservationLabel(status: number): string {
  const found = Object.values(STATUS_RESERVATION).find((s: any) => s.id === status);
  return (found ? found.name : String(status)).replace(/ /g, '-');
}

const STATUS_ACTIVE = 1;
const MENU_ID = 60; // Reservation menu ID

// Reservation action icons (matching Laravel config/cms.php action_reservation.action)
const ACTION_RESERVATION: { key: string; name: string; icon: string; line?: boolean }[] = [
  { key: 'fit', name: 'New FIT', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'git', name: 'New GIT', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'vr', name: 'New VR', icon: '/theme/cms/images/reservation/icon/New_Reservation.svg' },
  { key: 'edit', name: 'Edit', icon: '/theme/cms/images/reservation/icon/Edit_Reservation.svg', line: true },
  { key: 'assign_room', name: 'Assign Room', icon: '/theme/cms/images/reservation/icon/Asign_room.svg' },
  { key: 'un_assign_room', name: 'Un Assign Room', icon: '/theme/cms/images/reservation/icon/Asign_room.svg' },
  { key: 'confirm_change_room', name: 'Confirm Change Room', icon: '/theme/cms/images/reservation/icon/Confirm_Reservation.svg' },
  { key: 'cancel_change_room', name: 'Cancel Change Room', icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg', line: true },
  { key: 'check_in', name: 'Check In', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'un_check_in', name: 'Un Check In', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'cancel_reservation', name: 'Cancel Reservation', icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg' },
  { key: 'un_cancel_reservation', name: 'Un Cancel Reservation', icon: '/theme/cms/images/reservation/icon/Cancel_Reservation.svg' },
  { key: 'check_out', name: 'Check Out', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'un_check_out', name: 'Re-Check In', icon: '/theme/cms/images/reservation/icon/Checkout.svg', line: true },
  { key: 'copy_reservation', name: 'Copy Reservation', icon: '/theme/cms/images/reservation/icon/Add_Message.svg', line: true },
  { key: 'move_reservation', name: 'Move Reservation', icon: '/theme/cms/images/reservation/icon/Checkin.svg', line: true },
  { key: 'confirm_reservation', name: 'Confirm Reservation', icon: '/theme/cms/images/reservation/icon/Add_Message.svg', line: true },
  { key: 'add_message', name: 'Add Message', icon: '/theme/cms/images/reservation/icon/Add_Message.svg' },
  { key: 'view_message', name: 'View Message', icon: '/theme/cms/images/reservation/icon/View_Message.svg' },
  { key: 'add_remark', name: 'Add Remark', icon: '/theme/cms/images/reservation/icon/Add_Message.svg' },
  { key: 'view_remark', name: 'View Remark', icon: '/theme/cms/images/reservation/icon/View_Message.svg' },
  { key: 'new_key', name: 'New Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'duplicate_key', name: 'Duplicate Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'erase_key', name: 'Erase Key', icon: '/theme/cms/images/reservation/icon/Checkin.svg' },
  { key: 'check_out_view', name: 'Check Out View', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'confirmation_letter', name: 'Send Email Confirmation Letter', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'guest_invoice_all_billing', name: 'Send Email Guest Invoice All Billing', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
  { key: 'guest_invoice_ledger', name: 'Send Email Guest Invoice Ledger', icon: '/theme/cms/images/reservation/icon/Checkout.svg' },
];

// Rule map per status code (matching Laravel config/cms.php action_reservation.rule)
const ACTION_RULE: Record<string, string[]> = {
  reservation: ['fit', 'git', 'vr', 'edit', 'move_reservation', 'assign_room', 'un_assign_room', 'confirm_change_room', 'cancel_change_room', 'check_in', 'check_out_view', 'cancel_reservation', 'copy_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark', 'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger'],
  check_in: ['fit', 'git', 'vr', 'edit', 'confirm_change_room', 'cancel_change_room', 'check_in', 'un_check_in', 'check_out', 'check_out_view', 'copy_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark', 'new_key', 'duplicate_key', 'erase_key', 'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger'],
  check_out: ['fit', 'git', 'vr', 'edit', 'un_check_out', 'check_out_view', 'copy_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark', 'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger'],
  cancel_reservation: ['fit', 'git', 'vr', 'edit', 'copy_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark'],
  default: ['fit', 'git', 'vr', 'edit', 'move_reservation', 'assign_room', 'un_assign_room', 'confirm_change_room', 'cancel_change_room', 'check_in', 'un_check_in', 'cancel_reservation', 'check_out_view', 'copy_reservation', 'confirm_reservation', 'add_message', 'view_message', 'add_remark', 'view_remark', 'confirmation_letter', 'guest_invoice_all_billing', 'guest_invoice_ledger'],
};

function fmtLocalDate(d: any): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d).substring(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function reservationBn(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(reservationBn);
  if (val && typeof val === 'object') { const o: any = {}; for (const [k, v] of Object.entries(val)) o[k] = reservationBn(v); return o; }
  return val;
}

// â”€â”€ Helper-endpoint parity helpers (Laravel ReservationController) â”€â”€
function fmtDateOnly(d: any): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().substring(0, 10);
  return String(d).substring(0, 10);
}

function dataSearchLocal(req: Request, table: any[]): Record<string, any> {
  const meta: Record<string, any> = {};
  const fields = String(req.query.search_field || '').split(';').filter((f: string) => f.trim() !== '');
  const values = String(req.query.search_value || '').split(';').filter((v: string) => v.trim() !== '');
  fields.forEach((field: string, i: number) => {
    const col = table.find((c: any) => c.key === field);
    const raw = values[i] ?? '';
    meta[field] =
      col && ['select', 'checkbox', 'select_multiple'].includes(col.type)
        ? { label: col.options?.find((o: any) => String(o.value) === String(raw))?.label ?? null, value: raw }
        : String(raw);
  });
  for (const [k, v] of Object.entries(req.query)) {
    if (['search_field', 'search_value', 'page', 'limit', 'search', 'sort', 'group'].includes(k)) continue;
    meta[k] = String(v);
  }
  return meta;
}

function paggingMetaLocal(total: number, limit: number, page: number) {
  const lastPage = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  return {
    current_page: page,
    last_page: lastPage,
    per_page: limit,
    total,
    from,
    to: Math.min(total, page * limit),
  };
}

// eta/etd arrive as "HH:MM" strings (FE) or Date-parseable values; the column is
// DateTime — combine a bare time with the night date so it stays on that day.
function parseTimeLike(value: any, base: Date): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = String(value).trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const d = new Date(base);
    d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0);
    return d;
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function dayKeyF(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

function rateTableColumns(codePostOptions: any[], withStatus: boolean): any[] {
  const cols: any[] = [];
  if (withStatus) {
    cols.push({ label: 'Status', key: 'status', type: 'checkbox', options: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }], is_search: true });
  }
  cols.push(
    { label: 'Rate Code', key: 'code', type: 'text', is_link: true, uri: '/rate-management/rate', is_search: true },
    { label: 'Name', key: 'name', type: 'text', is_search: true },
    { label: 'Description', key: 'description', type: 'text', is_search: true },
    { label: 'Start Date', key: 'start_date', type: 'date', is_search: true },
    { label: 'End Date', key: 'end_date', type: 'date', is_search: true },
    { label: 'Post Code', key: 'code_post_id', type: 'select', options: codePostOptions, is_search: true },
    { label: 'Post Code Extra Bed', key: 'code_post_extra_bed_id', type: 'select', options: codePostOptions, is_search: true },
  );
  return cols;
}

function rateRowData(r: any, codePostById: Map<any, any>): any {
  return {
    id: Number(r.id),
    name: r.module == 'rate' ? r.name : 'BAR',
    description: r.description,
    rate_type: r.rate_type,
    online: r.online === 1,
    staah: r.staah === true,
    staah_ori: r.staah === true,
    print_rate: r.print_rate === 1,
    is_day_use: r.is_day_use === true,
    min_advance_booking: r.min_advance_booking,
    max_advance_booking: r.max_advance_booking,
    code: r.code,
    contract_rate: { value: Number(r.id), label: r.code },
    code_color: [{ value: r.code, label: r.code }],
    is_color: true,
    sort_by_company: r.module == 'rate' ? 2 : 3,
    color: r.module == 'rate' ? 'bg-primary' : 'bg-secondary',
    start_date: fmtDateOnly(r.start_date),
    end_date: fmtDateOnly(r.end_date),
    term_condition: r.term_condition,
    cancellation_policy: r.cancellation_policy,
    notes: r.notes,
    code_post_id: { value: r.code_post_id ? Number(r.code_post_id) : null, label: codePostById.get(r.code_post_id) || '' },
    code_post_extra_bed_id: { value: r.code_post_extra_bed_id ? Number(r.code_post_extra_bed_id) : null, label: codePostById.get(r.code_post_extra_bed_id) || '' },
    sort: r.sort,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function barRowData(b: any, codePostById: Map<any, any>): any {
  return {
    id: Number(b.id),
    name: 'BAR',
    description: 'BAR',
    rate_type: 'BAR',
    code: 'BAR',
    contract_rate: { value: Number(b.id), label: 'BAR' },
    code_color: [{ value: 'BAR', label: 'BAR' }],
    is_color: true,
    sort_by_company: 3,
    color: 'bg-secondary',
    start_date: fmtDateOnly(b.start_date),
    end_date: fmtDateOnly(b.end_date),
    code_post_id: { value: Number(b.code_post_id), label: codePostById.get(b.code_post_id) || '' },
    code_post_extra_bed_id: { value: null, label: '' },
    sort: b.sort,
    status: b.status,
  };
}

// Laravel RoomType::onlyAvailable parity â€” returns available room ids for [dateStart, dateEnd)
async function onlyAvailableRoomIds(propertyId: bigint | number, dateStart: string, dateEnd: string): Promise<Set<number>> {
  const pId = BigInt(Number(propertyId));
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  const [rooms, availability, workOrders, reservations] = await Promise.all([
    prisma.rooms.findMany({
      where: { deleted_at: null, status: 1, property_id: pId, room_status: { not: ROOM_STATUSES.out_of_order.id } },
      select: { id: true },
    }),
    prisma.room_availabilities.findMany({
      where: { deleted_at: null, property_id: Number(propertyId), date: { gte: start, lt: end } },
      select: { room_id: true },
    }),
    prisma.work_orders.findMany({
      where: { deleted_at: null, status: 1, room_id: { not: null }, date: { gte: start }, end_date: { lt: end } },
      select: { room_id: true },
    }),
    prisma.reservations.findMany({
      where: { date: { gte: start, lte: end }, status_reservation: { in: [STATUS_RESERVATION.check_in.id, STATUS_RESERVATION.reservation.id] } },
      select: { room_id: true, room_id_next: true, room_status_name: true },
    }),
  ]);
  const blocked = new Set<number>();
  for (const a of availability) blocked.add(Number(a.room_id));
  for (const w of workOrders) blocked.add(Number(w.room_id));
  for (const r of reservations) {
    if (r.room_status_name !== ROOM_STATUSES.due_out.name) {
      if (r.room_id != null) blocked.add(Number(r.room_id));
      if (r.room_id_next != null) blocked.add(Number(r.room_id_next));
    }
  }
  const available = new Set<number>();
  for (const room of rooms) if (!blocked.has(Number(room.id))) available.add(Number(room.id));
  return available;
}

// Laravel Folio::getRevenueCharge parity
async function getRevenueCharge(rows: any[]): Promise<any> {
  const byDate = new Map<string, number>();
  const chargeRoom = new Map<string, number>();
  const chargePb1 = new Map<string, number>();
  const chargeService = new Map<string, number>();
  const chargeTotal = new Map<string, number>();
  for (const row of rows) {
    const d = fmtDateOnly(row.date);
    if (!d) continue;
    const qty = Number(row.quantity ?? 1);
    const amount = Number(row.amountt ?? 0) * qty;
    const pb1 = Number(row.pb1 ?? 0) * qty;
    const service = Number(row.service_charge ?? 0) * qty;
    byDate.set(d, (byDate.get(d) ?? 0) + amount);
    chargeRoom.set(d, (chargeRoom.get(d) ?? 0) + amount + pb1);
    chargePb1.set(d, (chargePb1.get(d) ?? 0) + pb1);
    chargeService.set(d, (chargeService.get(d) ?? 0) + service);
    chargeTotal.set(d, (chargeTotal.get(d) ?? 0) + amount + pb1 + service);
  }
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return {
    date: [...byDate.entries()].map(([date, charge]) => ({ date, charge: moneyFormat(charge) })),
    charge: [
      { label: 'Room Charge', value: moneyFormat(sum(chargeRoom)) },
      { label: 'PB1', value: moneyFormat(sum(chargePb1)) },
      { label: 'Service Charge', value: moneyFormat(sum(chargeService)) },
      { label: 'Total Room Charge', value: moneyFormat(sum(chargeTotal)) },
    ],
  };
}

// Laravel Folio ledger rebuild parity (Folio.php:2690-2734).
// Rebuild folio ledgers from CodeBilling x CompanyProfileBillingSetup.
export async function rebuildFolioLedgers(folioId: bigint, propertyId: bigint, companyProfileId: bigint | null, guestProfileId: bigint | null): Promise<void> {
  const codeBillings = await prisma.code_billings.findMany({
    where: { deleted_at: null, status: STATUS_ACTIVE },
  });
  const setups = companyProfileId
    ? await prisma.company_profile_billing_setups.findMany({
        where: { deleted_at: null, company_profile_id: companyProfileId },
      })
    : [];
  const setupByBilling = new Map<number, any>(setups.map((s) => [Number(s.code_billing_id), s]));

  await prisma.ledgers.deleteMany({ where: { folio_id: Number(folioId) } });

  let sort = 0;
  for (const cb of codeBillings) {
    const setup = setupByBilling.get(Number(cb.id));
    let profileableType: string;
    let profileableId: number | null = null;
    if (setup) {
      if (String(setup.billing) === '1') {
        profileableType = 'App\\Models\\CompanyProfile';
        profileableId = companyProfileId ? Number(companyProfileId) : null;
      } else {
        profileableType = 'App\\Models\\GuestProfile';
        profileableId = guestProfileId ? Number(guestProfileId) : null;
      }
    } else if (companyProfileId) {
      profileableType = 'App\\Models\\CompanyProfile';
      profileableId = Number(companyProfileId);
    } else {
      profileableType = 'App\\Models\\GuestProfile';
      profileableId = guestProfileId ? Number(guestProfileId) : null;
    }
    await prisma.ledgers.create({
      data: {
        property_id: Number(propertyId),
        folio_id: Number(folioId),
        code_billing_id: cb.id,
        status: 1,
        sort: sort++,
        ...(profileableId ? { profileable_type: profileableType, profileable_id: profileableId } : {}),
      },
    });
  }
}

async function fetchCodePostOptions(): Promise<{ options: any[]; byId: Map<any, any> }> {
  const allCodePosts = await prisma.code_posts.findMany({
    where: { deleted_at: null, status: STATUS_ACTIVE, type: 'DEFAULT' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return {
    options: allCodePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
    byId: new Map(allCodePosts.map((cp: any) => [cp.id, cp.name])),
  };
}

const safeParseFolioData = (raw: any): any => {
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { return {}; }
};

// Folio::saveReservation with is_update=1 — delete unposted rows then re-price
// and recreate per-night rows for the given list items (store-loop parity).
async function saveReservationRows(folio: any, items: any[], userId: bigint | undefined): Promise<void> {
  const propertyId = folio.property_id;
  const property = await prisma.properties.findUnique({ where: { id: propertyId }, select: { is_tax: true } });
  const isTax = property?.is_tax === 1;

  await prisma.reservations.deleteMany({ where: { folio_id: folio.id, is_posting: 0, deleted_at: null } });

  const rateIds = [...new Set(items.map((i) => String(i.rate_id)).filter((r) => r && r !== '0'))].map((s) => BigInt(s));
  const rateRows = rateIds.length ? await prisma.rates.findMany({ where: { id: { in: rateIds } }, select: { id: true, code_post_id: true } }) : [];
  const codePostById = new Map<number, any>();
  const cpIds = [...new Set(rateRows.map((r) => Number(r.code_post_id)).filter(Boolean))];
  if (cpIds.length) {
    const cps = await prisma.code_posts.findMany({ where: { id: { in: cpIds as any } } });
    cps.forEach((c: any) => codePostById.set(Number(c.id), c));
  }

  for (const item of items) {
    const itemCheckIn = new Date(item.check_in_date);
    let itemCheckOut = new Date(item.check_out_date);
    let nights = Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / 86400000);
    if (nights < 1) nights = 1;
    const rateIdBig = item.rate_id && String(item.rate_id) !== '0' ? BigInt(item.rate_id) : null;
    const roomTypeIdEff = item.room_type_id ? BigInt(item.room_type_id) : null;

    for (let i = 0; i < nights; i++) {
      const nightDate = new Date(itemCheckIn);
      nightDate.setDate(nightDate.getDate() + i);

      const pricing = await priceNight({
        prisma,
        rateId: rateIdBig,
        roomTypeId: roomTypeIdEff,
        night: nightDate,
        getNight: nights,
        adult: Number(item.adult || 1),
        child: Number(item.child || 0),
        quantity: 1,
        isTax,
        rateCodePost: rateIdBig ? codePostById.get(Number(rateRows.find((r) => Number(r.id) === Number(rateIdBig))?.code_post_id ?? -1)) ?? null : null,
        promos: [],
      });

      await prisma.reservations.create({
        data: {
          property_id: propertyId,
          folio_id: folio.id,
          rate_id: rateIdBig,
          room_type_id: item.room_type_id ? BigInt(item.room_type_id) : null,
          room_id: item.room_id ? BigInt(item.room_id) : null,
          adult: item.adult || 1,
          child: item.child || 0,
          add_bed: item.add_bed || 0,
          check_in_date: new Date(item.check_in_date),
          check_out_date: itemCheckOut,
          date: nightDate,
          status_reservation: folio.status_reservation ?? 3,
          status: STATUS_ACTIVE,
          night: nights,
          amount: pricing.amount,
          amountt: pricing.amount,
          total: pricing.total,
          service_charge: pricing.service_charge,
          pb1: pricing.pb1,
          tax3: pricing.tax3,
          eta: item.eta ?? null,
          etd: item.etd ?? null,
          data: JSON.stringify({ rate_price: pricing.rate_price, service: pricing.service_charge, pb1: pricing.pb1, tax3: pricing.tax3, total: pricing.total }),
          created_by: userId ?? null,
        },
      });
    }
  }

  await rebuildFolioLedgers(folio.id, propertyId, folio.company_profile_id ?? null, folio.guest_profile_id ?? null);
}

// Laravel ReservationItemController@updateSubFolio (:1010-1091)
async function updateSubFolioImpl(req: Request, res: Response, id: bigint): Promise<void> {
  const body = req.body || {};
  const folio = await prisma.folios.findUnique({
    where: { id },
    include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1 } },
  });
  if (!folio || folio.deleted_at) { notFound(res, 'Folio not found'); return; }

  // Room availability over the requested stay window
  const roomId = body.room_id ? BigInt(body.room_id) : null;
  if (roomId != null) {
    const s = new Date(body.check_in_date + 'T00:00:00.000Z');
    const e = new Date(body.check_out_date + 'T00:00:00.000Z');
    const [holds, wos, overlaps] = await Promise.all([
      prisma.room_availabilities.count({ where: { deleted_at: null, room_id: Number(roomId), date: { gte: s, lt: e } } }),
      prisma.work_orders.count({ where: { deleted_at: null, status: 1, room_id: roomId, date: { lte: s }, OR: [{ end_date: null }, { end_date: { gt: e } }] } }),
      prisma.reservations.count({
        where: { date: { gte: s, lt: e }, folio_id: { not: folio.id }, deleted_at: null, folios: { is: { status_reservation: { in: [0, 3] } } }, OR: [{ room_id: roomId }, { room_id_next: roomId }] },
      }),
    ]);
    if (holds > 0 || wos > 0 || overlaps > 0) { badRequest(res, 'Room Already Used'); return; }
  }

  const folioUpdate: any = { updated_at: new Date() };
  if (body.guest_profile_id !== undefined) folioUpdate.guest_profile_id = body.guest_profile_id ? BigInt(body.guest_profile_id) : null;

  if (folio.status_reservation !== STATUS_RESERVATION.reservation.id) {
    badRequest(res, 'Folio status is not reservation');
    return;
  }

  // Stay must be inside the parent folio's window (= Laravel :1042-1048)
  if (Number(folio.parent ?? 0) !== 0) {
    const parentFolio = await prisma.folios.findUnique({ where: { id: BigInt(Number(folio.parent)) } });
    if (parentFolio && parentFolio.check_in_date != null && parentFolio.check_out_date != null
      && (new Date(body.check_in_date) < new Date(parentFolio.check_in_date) || new Date(body.check_out_date) > new Date(parentFolio.check_out_date))) {
      badRequest(res, 'Check In Date or Check Out Date Not Valid');
      return;
    }
  }

  folioUpdate.check_in_date = new Date(body.check_in_date);
  folioUpdate.check_out_date = new Date(body.check_out_date);
  await prisma.folios.update({ where: { id: folio.id }, data: folioUpdate });
  if (body.guest_profile_id !== undefined) {
    // guest_profile_id handled above via folioUpdate
  }

  const firstResv = folio.reservations[0];
  const arr = [{
    eta: firstResv?.eta ?? null,
    etd: firstResv?.etd ?? null,
    room_type_id: body.room_type_id,
    room_id: body.room_id ?? null,
    check_in_date: body.check_in_date,
    check_out_date: body.check_out_date,
    adult: firstResv?.adult ?? 1,
    child: firstResv?.child ?? 0,
    add_bed: 0,
    rate_id: body.rate_id ?? String(firstResv?.rate_id ?? ''),
  }];
  const refreshed = await prisma.folios.findUnique({ where: { id: folio.id } });
  await saveReservationRows(refreshed!, arr, req.user?.id);
  success(res, bigintToNumber(refreshed), 'Success', 200);
}

// Laravel ReservationItemController@updateParentFolio (:1093-1149)
async function updateParentFolioImpl(req: Request, res: Response, id: bigint): Promise<void> {
  const body = req.body || {};
  const required = ['room_type_id', 'room_id', 'rate_id', 'rate', 'remark_room'];
  for (const f of required) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      badRequest(res, `The ${f.replace(/_/g, ' ')} field is required.`);
      return;
    }
  }

  const folio = await prisma.folios.findUnique({ where: { id } });
  if (!folio || folio.deleted_at) { notFound(res, 'Not Found'); return; }

  await prisma.folios.update({
    where: { id },
    data: { check_in_date: new Date(body.check_in_date), check_out_date: new Date(body.check_out_date), updated_at: new Date() },
  });

  const children = await prisma.folios.findMany({ where: { parent: id, deleted_at: null } });
  for (const child of children) {
    const firstResv = await prisma.reservations.findFirst({ where: { folio_id: child.id, deleted_at: null }, orderBy: { date: 'asc' } });
    await prisma.folios.update({
      where: { id: child.id },
      data: { check_in_date: new Date(body.check_in_date), check_out_date: new Date(body.check_out_date), updated_at: new Date() },
    });
    const arr = [{
      rate_id: body.rate_id,
      eta: firstResv?.eta ?? null,
      etd: firstResv?.etd ?? null,
      room_type_id: body.room_type_id,
      room_id: body.room_id,
      check_in_date: body.check_in_date,
      check_out_date: body.check_out_date,
      adult: firstResv?.adult ?? 1,
      child: firstResv?.child ?? 0,
      add_bed: 0,
    }];
    const refreshedChild = await prisma.folios.findUnique({ where: { id: child.id } });
    await saveReservationRows(refreshedChild!, arr, req.user?.id);
  }
  success(res, bigintToNumber(folio), 'Success', 200);
}

export class ReservationController {
  // Replicates Laravel ReservationController@moveLedger (PUT /reservation/ledger/move/:id).
  static async moveLedger(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Transaction not found'); return; }
      const id = BigInt(idRaw);
      const ledgerTo = String(req.body?.ledger_to ?? '');
      if (!ledgerTo) { notFound(res, 'The ledger to field is required.'); return; }

      const transaction = await prisma.transactions.findUnique({ where: { id } });
      if (!transaction) { notFound(res, 'Transaction not found'); return; }

      await prisma.transactions.update({ where: { id }, data: { bill_to: ledgerTo, updated_at: new Date(), updated_by: req.user?.id } });

      // Laravel :4211-4225 — re-point profileable to the ledger target
      // (ledger_to = '<profileId>-company' | '<profileId>-guest').
      const parts = String(ledgerTo).split('-');
      const last = parts[parts.length - 1];
      const profileId = parts[0] && /^\d+$/.test(parts[0]) ? BigInt(parts[0]) : null;
      if (profileId != null && (last === 'company' || last === 'guest')) {
        const modelType = last === 'company' ? 'App\\Models\\CompanyProfile' : 'App\\Models\\GuestProfile';
        await prisma.transactions.update({
          where: { id },
          data: { model_type: modelType, model_id: profileId, updated_at: new Date() },
        });
      }

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Move ledger error:', err);
      error(res, 'Failed to move ledger', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search_field = req.query.search_field as string;
      const search_value = req.query.search_value as string;
      const propertyId = req.user?.lastProperty;
      const is_day_use = req.query.dayuse === '1';
      const parentId = req.query.parent_id ? BigInt(req.query.parent_id as string) : null;

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = {
        deleted_at: trash ? { not: null } : null,
        is_pos_trx: false,
        status_reservation: { in: [STATUS_RESERVATION.reservation.id, STATUS_RESERVATION.pending.id] },
      };

if (propertyId) where.property_id = propertyId;
      if (is_day_use) where.is_day_use = true;
      if (parentId !== null) where.parent = parentId;

      // Filter by type_reservation (fit, git, vr, day-use) - Laravel getDisplayTypes parity
      const displayTypes: string[] = [];
      if (req.query.fit === '1') displayTypes.push(TYPE_RESERVATION.fit.code);
      if (req.query.git === '1') displayTypes.push(TYPE_RESERVATION.git.code);
      if (req.query.vr === '1') displayTypes.push(TYPE_RESERVATION.vr.code);
      if (req.query.dayuse === '1') displayTypes.push(TYPE_RESERVATION['day-use'].code);
      if (displayTypes.length > 0) {
        where.type_reservation = { in: displayTypes };
      }

const table = [
        { label: 'Res Date', key: 'res_date', type: 'date' },
        { label: 'Type', key: 'type_reservation' },
        { label: 'MSG', key: 'message_bool', type: 'boolean' },
        { label: 'IGN', key: 'ign', type: 'boolean' },
        { label: 'DND', key: 'is_do_not_disturb', type: 'boolean' },
        { label: 'Remark', key: 'remark_bool', type: 'boolean' },
        { label: 'Status', key: 'status_reservation_color', is_html: true },
        { label: 'Folio', key: 'folio_number', is_link: true, uri: '/reservation/fit/reservation' },
        { label: 'Guest Name', key: 'guest_name' },
        { label: 'Guest', key: 'guest_status_color', is_html: true },
        { label: 'Stay', key: 'stay' },
        { label: 'Room', key: 'room' },
        { label: 'Room Next', key: 'room_next' },
        { label: 'Company', key: 'company' },
        { label: 'Room Type', key: 'room_type' },
        { label: 'Room Status', key: 'room_status_color', is_html: true },
        { label: 'Clean Status', key: 'room_clean_status_color', is_html: true },
        { label: 'Check In', key: 'check_in_date', type: 'date' },
        { label: 'Check Out', key: 'check_out_date', type: 'date' },
        { label: 'Balance', key: 'balance' },
        { label: 'Sharer', key: 'sharer' },
        { label: 'A', key: 'aa' },
        { label: 'C', key: 'cc' },
      ];

      applySearchField(where, req, table);

      const [folios, total] = await Promise.all([
        prisma.folios.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            properties: { select: { name: true } },
            reservations: {
              where: { deleted_at: null },
              include: { room_types: { select: { name: true } } },
            },
          },
        }),
        prisma.folios.count({ where }),
      ]);

const formatted = await Promise.all(folios.map(async (f: any) => {
        let guestName = `${f.first_name || ''} ${f.last_name || ''}`.trim();
        if (!guestName && f.guest_profile_id) {
          const gp = await prisma.guest_profiles.findUnique({ where: { id: f.guest_profile_id } });
          if (gp) guestName = `${gp.first_name || ''} ${gp.last_name || ''}`.trim();
        }

        const lastReservation = f.reservations?.[f.reservations.length - 1];
        const roomName = lastReservation?.room_name || '';
        const roomTypeName = lastReservation?.room_type_name || '';
        const roomNext = lastReservation?.room_id_next ? (lastReservation.rooms?.name || '') : '';

        // Get balance from transactions
        const transactions = await prisma.transactions.findMany({
          where: { folio_id: f.id, deleted_at: null },
        });
        const balance = transactions.reduce((sum: number, t: any) => sum + Number(t.total || 0), 0);

        // Stay calculation
        const checkIn = f.check_in_date ? new Date(f.check_in_date) : null;
        const checkOut = f.check_out_date ? new Date(f.check_out_date) : null;
        const stay = checkIn && checkOut ? Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)) : 0;

        // Adult/Child from last reservation
        const aa = lastReservation?.adult || 0;
        const cc = lastReservation?.child || 0;

        // Status reservation color (matching front-desk)
        const statusReservationColor = (folio: any): { label: string; color: string; is_color: boolean }[] => {
          if (folio.status_reservation === STATUS_RESERVATION.reservation.id && folio.is_request_cancel) {
            return [{ label: 'Request-Cancel', color: 'bg-yellow', is_color: true }];
          }
          return [{
            label: statusReservationLabel(folio.status_reservation),
            color: COLOR_RESERVATION[folio.status_reservation] || 'bg-success',
            is_color: true,
          }];
        };

        const roomStatusColor: { label: string; color: string; is_color: boolean }[] = []; // Would need room relation
        const roomCleanStatusColor: { label: string; color: string; is_color: boolean }[] = []; // Would need room relation

        return {
          id: Number(f.id),
          value: Number(f.id),
          name: f.folio_number,
          res_date: f.res_date,
          type_reservation: f.type_reservation?.toUpperCase(),
          message_bool: false,
          ign: false,
          remark_bool: !!(f.remark || f.posting_instruction || f.check_out_instruction || f.check_in_instruction),
          is_do_not_disturb: !!f.is_do_not_disturb,
          status_reservation_color: statusReservationColor(f),
          room_clean_status_color: roomCleanStatusColor,
          room_status_color: roomStatusColor,
          folio_number: f.folio_number,
          guest_name: guestName || '-',
          guest_status: { label: 'Regular', color: 'bg-green' },
          guest_status_color: [{ label: 'Regular', color: 'bg-green', is_color: true }],
          date_arrival: f.check_in_date,
          stay,
          room: roomName,
          room_next: roomNext,
          company: f.company_name || '',
          room_type: roomTypeName,
          check_in_date: f.check_in_date,
          check_out_date: f.check_out_date,
          balance: balance.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
          sharer: '',
          is_popup_other_guest: false,
          aa,
          cc,
          actions: [],
        };
      }));

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

success(res, formatted, 'Success', 200, {
        table,
        permission,
        search_data: dataSearch(req, table) as any,
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
      console.error('Reservation list error:', err);
      error(res, 'Failed to fetch reservations', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation-item (ReservationItemController parity - room grid per folio)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async reservationItemIndex(req: Request, res: Response): Promise<void> {
    const tableRom = [
      { label: 'Doc Date', key: 'date', type: 'none', is_search: true },
      { label: 'Company', key: 'company_id', type: 'select', is_search: true },
      { label: 'Type', key: 'room_type_id', type: 'select', is_search: true },
      { label: 'Room', key: 'room_id', type: 'select', is_search: true },
      { label: 'Total', key: 'total', type: 'text', is_search: true },
      { label: 'Reason', key: 'remark_room', type: 'select', is_search: true },
      { label: 'Market Segment 1', key: 'market_segment_1', type: 'select', is_search: true },
      { label: 'Market Segment 2', key: 'market_segment_2', type: 'select', is_search: true },
      { label: 'Market Segment 3', key: 'market_segment_3', type: 'select', is_search: true },
      { label: 'Market Segment 4', key: 'market_segment_4', type: 'select', is_search: true },
      { label: 'Source', key: 'source', type: 'select', is_search: true },
      { label: 'Staf', key: 'updated_by', type: 'text', is_search: true },
    ];

    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 9999;
      const folioIdParam = req.query.folio_id as string;
      const permission = {
        view: true,
        add: true,
        edit: true,
        delete: true,
      };
      const pagination = (total: number) => ({
        current_page: page,
        last_page: Math.ceil(total / limit),
        per_page: limit,
        total,
        from: total === 0 ? 0 : (page - 1) * limit + 1,
        to: Math.min(page * limit, total),
      });
      const empty = (msg: string) =>
        success(res, [], 'No guest ID provided.', 200, {
          table: tableRom,
          pagination: pagination(0),
          permission,
          search_data: [],
        });

      if (!folioIdParam) {
        empty('folio_id required');
        return;
      }

      const folio = await prisma.folios.findUnique({ where: { id: BigInt(folioIdParam) } });
      if (!folio || folio.deleted_at) {
        empty('folio not found');
        return;
      }

      const [rows, types, property, reasonTypes] = await Promise.all([
        prisma.reservations.findMany({
          where: { folio_id: folio.id, deleted_at: null },
          orderBy: { date: 'asc' },
          include: { rates: { select: { code: true } } },
        }),
        prisma.types.findMany({
          where: {
            deleted_at: null,
            status: STATUS_ACTIVE,
            group: { in: ['remark-room', 'market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source'] },
          },
          select: { id: true, name: true, group: true },
        }),
        prisma.properties.findUnique({
          where: { id: req.user?.lastProperty as bigint },
          select: { id: true, name: true, market_segment_1: true, market_segment_2: true, market_segment_3: true, market_segment_4: true },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'cancellation-reservation' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const rowIds = rows.map((r) => r.id);
      const mht = await prisma.model_has_types.findMany({
        where: { model_type: 'App\\Models\\Reservation', model_id: { in: rowIds } },
        include: { types: true },
      });
      const typeByRow: Record<string, any[]> = {};
      for (const m of mht) {
        (typeByRow[String(m.model_id)] = typeByRow[String(m.model_id)] || []).push(m.types);
      }
      const typeGroup = (rowId: bigint, group: string) => {
        const list = typeByRow[String(rowId)] || [];
        const found = list.find((t) => t.group === group);
        return found ? { value: Number(found.id), label: found.name } : [];
      };

      const statusReservationMap: Record<number, string> = {
        0: 'Check In',
        1: 'Check Out',
        2: 'Cancelled',
        3: 'Reservation',
        4: 'In House',
        5: 'Pending',
      };

      const data = rows.map((r: any) => ({
        id: Number(r.id),
        rate_id: r.rate_id ? Number(r.rate_id) : null,
        rate: {
          value: r.rate_id ? Number(r.rate_id) : null,
          label: r.rate_name || r.rates?.code || '',
        },
        action_table: r.is_posting ? false : true,
        date: r.date,
        remark_room: typeGroup(r.id, 'remark-room'),
        market_segment_1: typeGroup(r.id, 'market-segment-1'),
        market_segment_2: typeGroup(r.id, 'market-segment-2'),
        market_segment_3: typeGroup(r.id, 'market-segment-3'),
        market_segment_4: typeGroup(r.id, 'market-segment-4'),
        source: typeGroup(r.id, 'source'),
        company_id: r.company_profile_name || null,
        company_idx: r.company_profile_id ? Number(r.company_profile_id) : null,
        rate_price: Number(r.amount || 0),
        total_extra_bed: Number(r.total_extra_bed || 0),
        total: Number(r.total || 0),
        check_in_date: r.check_in_date,
        check_out_date: r.check_out_date,
        room_type_id: {
          value: r.room_type_id ? Number(r.room_type_id) : null,
          label: r.room_type_name || '',
        },
        room_type: r.room_type_name || '',
        room_id: {
          value: r.room_id ? Number(r.room_id) : null,
          label: r.room_name || '',
        },
        room: r.room_name || '',
        stay: '0',
        night: r.night,
        status_reservation: {
          value: r.status_reservation ?? 0,
          label: statusReservationMap[r.status_reservation ?? 0] || 'Pending',
        },
        adult: r.adult,
        child: r.child,
        created_at: r.created_at,
        updated_at: r.updated_at,
        deleted_at: r.deleted_at,
        created_by: r.created_by ? Number(r.created_by) : null,
        deleted_by: r.deleted_by ? Number(r.deleted_by) : null,
        status: r.status,
      }));

      const marketProperty = property
        ? {
            id: Number(property.id),
            name: property.name,
            is_market_segment_1: property.market_segment_1 === true,
            is_market_segment_2: property.market_segment_2 === true,
            is_market_segment_3: property.market_segment_3 === true,
            is_market_segment_4: property.market_segment_4 === true,
          }
        : {};

      success(res, data, 'Success', 200, {
        table: tableRom,
        pagination: pagination(data.length),
        permission,
        folio: reservationBn(folio),
        market_property: marketProperty,
        master: {
          reasons: reasonTypes.map((t) => ({ value: t.name, label: t.name })),
        },
        search_data: [],
      });
    } catch (err: any) {
      console.error('Reservation item index error:', err);
      error(res, 'Failed to fetch reservation items', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /cms/reservation-item/:id (ReservationItemController update parity - basic)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async reservationItemUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.reservations.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // ── Laravel :276-297 — action routing matrix ──
      if ((req.body || {}).type_reservation !== undefined) {
        const typeUpper = String(req.body.type_reservation ?? '').toUpperCase();
        const roomActions = ['assign_room', 'un_check_out', 'un_check_in', 'check_out', 'check_in'];
        if (roomActions.concat('move_reservation').includes(req.body.status_reservation) && typeUpper === 'VR') {
          return await this.updateVR(req, res);
        }
        if (roomActions.includes(req.body.status_reservation) && typeUpper !== 'GIT') {
          return await this.assignRoom(req, res);
        }
        if (req.body.status_reservation === 'move_reservation' && typeUpper !== 'GIT') {
          return await this.moveReservationItems(req, res);
        }
        if (roomActions.includes(req.body.status_reservation) && typeUpper === 'GIT' && Number(req.body.is_list_parent_git ?? 1) === 0) {
          return await this.assignRoom(req, res);
        }
        if (roomActions.concat('move_reservation').includes(req.body.status_reservation) && typeUpper === 'GIT' && Number(req.body.is_list_parent_git ?? 0) === 1) {
          return await updateSubFolioImpl(req, res, id);
        }
      }

      const { rate_id, room_type_id, room_id, remark_room, total, market_segment_1, market_segment_2, market_segment_3, market_segment_4, apply_mode } = req.body;

      // Laravel :299-308 — rate_id required on the generic path
      if (rate_id === undefined || rate_id === null || rate_id === '') {
        badRequest(res, 'The rate id field is required.');
        return;
      }

      // Laravel :310-312 — parent folio edit delegates to updateParentFolio
      if (req.body.is_parentfolio) {
        return await updateParentFolioImpl(req, res, id);
      }

      // Laravel :314-324
      if (remark_room === undefined || remark_room === null || remark_room === '') {
        badRequest(res, 'The remark room field is required.');
        return;
      }
      if (total === undefined || total === null || total === '') {
        badRequest(res, 'The total field is required.');
        return;
      }

      const reservation = existing;
      const folioRow = await prisma.folios.findUnique({ where: { id: reservation.folio_id } });
      if (!folioRow) { notFound(res, 'Not Found'); return; }

      const dayStart = new Date(new Date(reservation.date).toISOString().slice(0, 10) + 'T00:00:00.000Z');
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      // Laravel :333-344 — target room availability for this night
      const checkRoomId = room_id != null && room_id !== '' ? BigInt(room_id) : null;
      if (checkRoomId != null) {
        const [availHolds, woCount, overlapping] = await Promise.all([
          prisma.room_availabilities.count({ where: { deleted_at: null, room_id: Number(checkRoomId), date: { gte: dayStart, lt: dayEnd } } }),
          prisma.work_orders.count({ where: { deleted_at: null, status: 1, room_id: checkRoomId, date: { lte: dayStart }, OR: [{ end_date: null }, { end_date: { gt: dayEnd } }] } }),
          prisma.reservations.count({
            where: {
              date: { gte: dayStart, lt: dayEnd },
              folio_id: { not: folioRow.id },
              deleted_at: null,
              folios: { is: { status_reservation: { in: [0, 3] } } },
              OR: [{ room_id: checkRoomId }, { room_id_next: checkRoomId }],
            },
          }),
        ]);
        const roomRow = await prisma.rooms.findUnique({ where: { id: checkRoomId }, select: { room_status: true } });
        const blockedOrOoo = roomRow ? [3, 4].includes(roomRow.room_status) : true;
        if (availHolds > 0 || woCount > 0 || overlapping > 0 || blockedOrOoo) {
          badRequest(res, 'Room Already Used');
          return;
        }
      }

      // Laravel :345-362 — room-type availability when type changes
      const newRoomTypeId = room_type_id !== undefined && room_type_id !== null && room_type_id !== '' ? BigInt(room_type_id) : null;
      if (newRoomTypeId != null && Number(reservation.room_type_id) !== Number(newRoomTypeId)) {
        const roomsOfType = await prisma.rooms.findMany({ where: { room_type_id: newRoomTypeId, deleted_at: null, status: 1 } });
        const roomIdsOfType = roomsOfType.map((r) => r.id);
        const [heldRooms, woRooms] = await Promise.all([
          prisma.room_availabilities.findMany({ where: { deleted_at: null, room_id: { in: roomIdsOfType.map(Number) }, date: { gte: dayStart, lt: dayEnd } }, select: { room_id: true } }),
          prisma.work_orders.findMany({ where: { deleted_at: null, status: 1, room_id: { in: roomIdsOfType }, date: { lte: dayStart }, OR: [{ end_date: null }, { end_date: { gt: dayEnd } }] }, select: { room_id: true } }),
        ]);
        const excludedStatuses = new Set<number>([...heldRooms.map((h) => Number(h.room_id)), ...woRooms.map((w) => Number(w.room_id))]);
        const freeRooms = roomsOfType.filter((r) => ![3, 4].includes(r.room_status) && !excludedStatuses.has(Number(r.id)));
        const soldRows = await prisma.reservations.findMany({
          where: {
            date: { gte: dayStart, lt: dayEnd },
            folio_id: { not: folioRow.id },
            deleted_at: null,
            folios: { is: { status_reservation: { in: [0, 3] } } },
            OR: [{ room_type_id: newRoomTypeId }, { room_type_id_next: newRoomTypeId }],
          },
          select: { room_id: true },
        });
        const soldRoomIds = new Set(soldRows.filter((s) => s.room_id != null && Number(s.room_id) > 0).map((s) => String(s.room_id)));
        const availableCount = freeRooms.filter((r) => !soldRoomIds.has(String(r.id))).length;
        if (availableCount <= 0) {
          badRequest(res, 'Room Type Already Used');
          return;
        }
      }

      // Laravel :364-371 — Sub-GIT cannot change rate code
      const folioTypeLower = String(folioRow.type_reservation ?? '').toLowerCase();
      const isSubGit = folioTypeLower === 'git' && Number(folioRow.parent ?? 0) !== 0;
      if (isSubGit && Number(reservation.rate_id) !== Number(rate_id)) {
        badRequest(res, 'Cannot change rate Code');
        return;
      }

      // ── Pricing recalc builder (Laravel :388-492) ──
      const buildItemUpdateData = async (): Promise<any> => {
        const d: any = {
          updated_by: userId,
          updated_at: new Date(),
          room_type_id: newRoomTypeId ?? reservation.room_type_id,
          company_profile_id: req.body.company_profile_id !== undefined ? (req.body.company_profile_id ? BigInt(req.body.company_profile_id) : null) : reservation.company_profile_id,
          room_id: checkRoomId ?? null,
          rate_id: BigInt(rate_id),
        };
        const recalcAmounts = req.body.is_calculate === true || req.body.is_calculate === undefined;
        if (!recalcAmounts) return d;

        const rate = await prisma.rates.findUnique({ where: { id: BigInt(rate_id) } });
        const codePost = rate?.code_post_id ? await prisma.code_posts.findUnique({ where: { id: BigInt(rate.code_post_id) } }) : null;
        const codePostExtraBed = rate?.code_post_extra_bed_id ? await prisma.code_posts.findUnique({ where: { id: BigInt(rate.code_post_extra_bed_id) } }) : null;

        if (codePost) {
          const flags = {
            tax: codePost.tax ?? false,
            tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
            local_tax: codePost.local_tax ?? false,
            local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
            service_charge: codePost.service_charge ?? false,
            service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
            service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
            tax_include_local_tax: codePost.tax_include_local_tax ?? false,
          };
          const nights = await prisma.reservations.count({ where: { folio_id: folioRow.id, deleted_at: null } });
          const promos: PromoLike[] = folioRow.promo_code
            ? await findPromosForNight(prisma, BigInt(rate_id), dayStart, nights, String(folioRow.promo_code))
            : [];
          const amountNet = applyPromoDiscounts(Number(total), promos);
          const calc = calculateCodePost(flags as any, amountNet, false);
          Object.assign(d, { amount: calc.amount, service_charge: calc.service, pb1: calc.pb1, tax3: calc.tax3, total: calc.total });

          if (codePostExtraBed) {
            const calcExtra = calculateCodePost(flags as any, Number(req.body.total_extra_bed ?? 0), false);
            Object.assign(d, {
              amount_extra_bed: calcExtra.amount,
              service_charge_extra_bed: calcExtra.service,
              pb1_extra_bed: calcExtra.pb1,
              tax3_extra_bed: calcExtra.tax3,
              total_extra_bed: calcExtra.total,
            });
          }
        }
        return d;
      };

      // Room-status transitions when folio checked-in (= Laravel :429-444)
      if (folioRow.status_reservation === 0 && reservation.room_id) {
        const roomCurrent = await prisma.rooms.findUnique({ where: { id: reservation.room_id } });
        if (roomCurrent && roomCurrent.room_status === 1) {
          await prisma.rooms.update({ where: { id: roomCurrent.id }, data: { room_status: 0, maid_status: 1, updated_at: new Date() } });
          if (checkRoomId != null) {
            await prisma.rooms.updateMany({ where: { id: checkRoomId }, data: { room_status: 1, maid_status: 0, updated_at: new Date() } });
          }
        }
      }

      const updateData = await buildItemUpdateData();
      await prisma.reservations.update({ where: { id }, data: updateData });

      const typeMap: Record<string, any> = {
        remark_room: remark_room,
        market_segment_1: market_segment_1,
        market_segment_2: market_segment_2,
        market_segment_3: market_segment_3,
        market_segment_4: market_segment_4,
      };
      for (const [group, typeId] of Object.entries(typeMap)) {
        if (typeId === undefined || typeId === null || typeId === '') continue;
        const existingType = await prisma.model_has_types.findFirst({
          where: { model_type: 'App\\Models\\Reservation', model_id: id, types: { group } },
        });
        const typeIdBig = BigInt(typeId);
        if (existingType) {
          if (existingType.type_id !== typeIdBig) {
            await prisma.model_has_types.updateMany({
              where: { type_id: existingType.type_id, model_type: 'App\\Models\\Reservation', model_id: id },
              data: { type_id: typeIdBig },
            });
          }
        } else {
          await prisma.model_has_types.create({
            data: { type_id: typeIdBig, model_type: 'App\\Models\\Reservation', model_id: id },
          });
        }
      }

      // ── Cascade to sibling nights (Laravel :514-667) with stopper semantics ──
      const oldRoomSig = `${Number(reservation.room_type_id)}-${Number(reservation.room_id)}`;
      const mode = apply_mode ?? 'following';
      let siblings: any[] = [];
      if (mode !== 'single') {
        siblings = await prisma.reservations.findMany({
          where: {
            folio_id: folioRow.id,
            deleted_at: null,
            is_posting: 0,
            id: { not: id },
            ...(mode === 'all' ? {} : { date: { gt: reservation.date } }),
          },
          orderBy: { date: 'asc' },
        });
      }
      const stopper: number[] = [];
      for (const sib of siblings) {
        const sig = `${Number(sib.room_type_id)}-${Number(sib.room_id)}`;
        if (sig !== oldRoomSig) stopper.push(1);
        if (stopper.length > 0) continue;

        const sibStart = new Date(new Date(sib.date).toISOString().slice(0, 10) + 'T00:00:00.000Z');
        const sibEnd = new Date(sibStart.getTime() + 86400000);
        if (checkRoomId != null) {
          const [holds, wos, overlaps] = await Promise.all([
            prisma.room_availabilities.count({ where: { deleted_at: null, room_id: Number(checkRoomId), date: { gte: sibStart, lt: sibEnd } } }),
            prisma.work_orders.count({ where: { deleted_at: null, status: 1, room_id: checkRoomId, date: { lte: sibStart }, OR: [{ end_date: null }, { end_date: { gt: sibEnd } }] } }),
            prisma.reservations.count({
              where: {
                date: { gte: sibStart, lt: sibEnd },
                folio_id: { not: folioRow.id },
                deleted_at: null,
                folios: { is: { status_reservation: { in: [0, 3] } } },
                OR: [{ room_id: checkRoomId }, { room_id_next: checkRoomId }],
              },
            }),
          ]);
          if (holds > 0 || wos > 0 || overlaps > 0) {
            badRequest(res, 'Room Already Used');
            return;
          }
        }

        const sibUpdate = await buildItemUpdateData();
        await prisma.reservations.update({ where: { id: sib.id }, data: sibUpdate });
      }

      // Availability push per unposted room type (= Laravel :674-687)
      const unpostedTypes = await prisma.reservations.findMany({
        where: { folio_id: folioRow.id, is_posting: 0, deleted_at: null },
        select: { room_type_id: true },
        distinct: ['room_type_id'],
      });
      for (const rt of unpostedTypes) {
        if (rt.room_type_id == null) continue;
        enqueueJob('sync-staah-room-availability', {
          propertyId: Number(folioRow.property_id),
          dateFrom: folioRow.check_in_date ? new Date(folioRow.check_in_date).toISOString().slice(0, 10) : undefined,
          dateTo: folioRow.check_out_date ? new Date(folioRow.check_out_date).toISOString().slice(0, 10) : undefined,
          roomTypeId: Number(rt.room_type_id),
        });
      }

      const updated = await prisma.reservations.findUnique({ where: { id } });
      success(res, reservationBn(updated), 'Success');
    } catch (err: any) {
      console.error('Reservation item update error:', err);
      error(res, err?.message || 'Failed to update reservation item', 400);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations/create
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      if (!propertyId) {
        error(res, 'No property selected', 400);
        return;
      }

      // Run queries individually — one failure shouldn't kill everything
      let roomTypes: any[] = [];
      let companies: any[] = [];
      let types: any[] = [];
      let walkInCompany: any = null;
      let houseUseCompany: any = null;
      let property: any = null;
      let logAudit: any = null;

      const results = await Promise.allSettled([
        // 0: room_types (property-scoped)
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, property_id: propertyId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        // 1: companies (all properties — PHP doesn't scope this)
        prisma.company_profiles.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true, type_company: true, sync_mkt_segment_1: true, sync_mkt_segment_2: true, sync_mkt_segment_3: true, sync_mkt_segment_4: true, source: true },
          orderBy: { name: 'asc' },
        }),
        // 2: types for market segments, source, guest-status, cancellation
        prisma.types.findMany({
          where: {
            deleted_at: null,
            status: STATUS_ACTIVE,
            group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source', 'guest-status', 'cancellation-reservation'] },
          },
          select: { id: true, name: true, group: true },
        }),
        // 3: walk-in company
        prisma.company_profiles.findFirst({
          where: { deleted_at: null, status: STATUS_ACTIVE, type_company: 'Walk In' },
          select: { id: true, name: true, sync_mkt_segment_1: true, sync_mkt_segment_2: true, sync_mkt_segment_3: true, sync_mkt_segment_4: true, source: true },
        }),
        // 4: house-use company
        prisma.company_profiles.findFirst({
          where: { deleted_at: null, status: STATUS_ACTIVE, type_company: 'House Use' },
          select: { id: true, name: true, sync_mkt_segment_1: true, sync_mkt_segment_2: true, sync_mkt_segment_3: true, sync_mkt_segment_4: true, source: true },
        }),
        // 5: property config
        prisma.properties.findUnique({
          where: { id: propertyId },
          select: { market_segment_1: true, market_segment_2: true, market_segment_3: true, market_segment_4: true, source: true, name: true, image: true, logo: true },
        }),
        // 6: business date from log_audits
        prisma.log_audits.findFirst({
          where: { deleted_at: null, property_id: Number(propertyId) },
          orderBy: { date: 'desc' },
          select: { date: true },
        }),
      ]);

      // Unpack settled results — log failures but continue with defaults
      const labels = ['room_types', 'companies', 'types', 'walkIn', 'houseUse', 'property', 'logAudit'];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`Reservation create - ${labels[i]} query failed:`, r.reason?.message || r.reason);
        }
      });

      if (results[0].status === 'fulfilled') roomTypes = results[0].value;
      if (results[1].status === 'fulfilled') companies = results[1].value;
      if (results[2].status === 'fulfilled') types = results[2].value;
      if (results[3].status === 'fulfilled') walkInCompany = results[3].value;
      if (results[4].status === 'fulfilled') houseUseCompany = results[4].value;
      if (results[5].status === 'fulfilled') property = results[5].value;
      if (results[6].status === 'fulfilled') logAudit = results[6].value;

      const groupBy = (arr: any[], key: string) =>
        arr.reduce((acc, item) => {
          (acc[item[key]] = acc[item[key]] || []).push(item);
          return acc;
        }, {} as any);

      const grouped = groupBy(types, 'group');

      const statusGuests = (grouped['guest-status'] || []).map((t: any) => ({ value: Number(t.id), label: t.name }));
      const normalGuest = statusGuests.filter((s: any) => /normal/i.test(s.label));
      const otherGuest = statusGuests.filter((s: any) => !/normal/i.test(s.label));
      const sortedStatusGuests = [...normalGuest, ...otherGuest];

      // Business date from log_audits
      let businessDate: string;
      if (logAudit?.date) {
        const d = new Date(logAudit.date);
        businessDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().substring(0, 10);
      } else {
        // Fallback: today + 7h (WIB)
        const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
        businessDate = now.toISOString().substring(0, 10);
      }

      // Room data if room_id query param (PHP: ReservationController@create :239-263)
      let dataRoom: any = null;
      const roomId = req.query.room_id as string;
      if (roomId && roomId !== 'null' && roomId !== 'undefined' && /^\d+$/.test(roomId)) {
        try {
          const room = await prisma.rooms.findUnique({ where: { id: BigInt(roomId) } });
          if (room) {
            const roomType = room.room_type_id ? await prisma.room_types.findUnique({ where: { id: room.room_type_id } }) : null;
            const rateWalkIn = await prisma.rates.findFirst({
              where: { deleted_at: null, status: STATUS_ACTIVE, name: { contains: 'Walk In', mode: 'insensitive' } },
              orderBy: { module: 'desc' },
            });
            dataRoom = {
              room: { id: Number(room.id), name: room.name },
              room_type: { id: Number(room.room_type_id), name: roomType?.name ?? '' },
              rate: rateWalkIn ? { id: Number(rateWalkIn.id), name: rateWalkIn.name } : null,
            };
          }
        } catch (roomErr: any) {
          console.error('Reservation create - room lookup failed:', roomErr.message);
        }
      }

      const master: any = {
        statuses: [
          { value: STATUS_ACTIVE, label: 'Active' },
          { value: 0, label: 'Inactive' },
        ],
        status_reservations: [
          { value: STATUS_RESERVATION.reservation.code, label: STATUS_RESERVATION.reservation.name },
          { value: STATUS_RESERVATION.pending.code, label: STATUS_RESERVATION.pending.name },
          { value: STATUS_RESERVATION.check_in.code, label: STATUS_RESERVATION.check_in.name },
          { value: STATUS_RESERVATION.check_out.code, label: STATUS_RESERVATION.check_out.name },
          { value: STATUS_RESERVATION.cancel_reservation.code, label: STATUS_RESERVATION.cancel_reservation.name },
        ],
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        market_segment_1: (grouped['market-segment-1'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_2: (grouped['market-segment-2'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_3: (grouped['market-segment-3'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_4: (grouped['market-segment-4'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        source: (grouped['source'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        status_guests: sortedStatusGuests,
        reason_cancels: (grouped['cancellation-reservation'] || []).map((t: any) => ({ value: t.name, label: t.name })),
        typemulti: [
          { label: 'Normal', value: 'normal' },
          { label: 'Walk In', value: 'is_walk_in' },
          { label: 'House Use', value: 'is_house_use' },
          { label: 'Complimentary', value: 'complimentary' },
        ],
        legend: [
          { label: 'BAR', color: 'bg-secondary text-white rounded-md font-semibold' },
          { label: 'COMPANY APPLICABLE', color: 'bg-success text-white rounded-md font-semibold' },
          { label: 'APPLICABLE FOR ALL', color: 'bg-primary text-white rounded-md font-semibold' },
        ],
        business_date: businessDate,
        is_walk_in: walkInCompany ? { id: Number(walkInCompany.id), name: walkInCompany.name, market_segment_1: walkInCompany.sync_mkt_segment_1, market_segment_2: walkInCompany.sync_mkt_segment_2, market_segment_3: walkInCompany.sync_mkt_segment_3, market_segment_4: walkInCompany.sync_mkt_segment_4, source: walkInCompany.source } : null,
        is_house_use: houseUseCompany ? { id: Number(houseUseCompany.id), name: houseUseCompany.name, market_segment_1: houseUseCompany.sync_mkt_segment_1, market_segment_2: houseUseCompany.sync_mkt_segment_2, market_segment_3: houseUseCompany.sync_mkt_segment_3, market_segment_4: houseUseCompany.sync_mkt_segment_4, source: houseUseCompany.source } : null,
        markets: property ? {
          is_market_segment_1: property.market_segment_1,
          is_market_segment_2: property.market_segment_2,
          is_market_segment_3: property.market_segment_3,
          is_market_segment_4: property.market_segment_4,
          is_source: property.source,
        } : null,
      };

      if (dataRoom) {
        master.data_room = dataRoom;
      }

      success(res, [], 'Success', 200, { master });
    } catch (err: any) {
      console.error('Reservation create form error:', err?.message || err);
      error(res, 'Failed to load form data: ' + (err?.message || 'unknown'), 500);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // POST /api/reservations
  // ─────────────────────────────────────────────────────────────â”€
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      // PHP: ReservationController@store :315-324 — merge checkbokmulti/typemulti into body
      const body = req.body;
      if (Array.isArray(body.checkbokmulti) && body.checkbokmulti.length > 0) {
        for (const key of body.checkbokmulti) {
          body[key] = true;
        }
      }
      if (body.typemulti && typeof body.typemulti === 'object' && body.typemulti.value) {
        body[body.typemulti.value] = true;
      }

      const {
        type_reservation = 'fit',
        guest_profile_id,
        company_profile_id,
        first_name,
        last_name,
        email,
        telp,
        remark,
        remark_ins,
        booking_agent_id,
        contact_person_id,
        is_pending,
        cash_on_arrival,
        guaranted,
        is_walk_in,
        is_house_use,
        complimentary,
        is_compliment_tour_leader,
        check_in_date,
        check_out_date,
        reservation_list = [],
        room_reservation_list = [],
        promo_code,
        dept_branch,
      } = body;

      // Validation
      const errors: Record<string, string[]> = {};
      if (!guest_profile_id) errors.guest_profile_id = ['The guest profile id field is required.'];
      if (!company_profile_id) errors.company_profile_id = ['The company profile id field is required.'];
      if (!check_in_date) errors.check_in_date = ['Check in date is required'];
      if (!check_out_date) errors.check_out_date = ['Check out date is required'];

      if (type_reservation === 'fit' && reservation_list.length === 0) {
        errors.reservation_list = ['Reservation list is required'];
      }
      if (type_reservation === 'git' && room_reservation_list.length === 0) {
        errors.room_reservation_list = ['Room reservation list is required'];
      }

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      // Resolve company_profile_id for walk-in / house-use
      let resolvedCompanyId = company_profile_id ? BigInt(company_profile_id) : null;
      if (!resolvedCompanyId && is_walk_in) {
        const walkInCompany = await prisma.company_profiles.findFirst({
          where: { deleted_at: null, status: STATUS_ACTIVE, type_company: 'Walk In' },
        });
        if (!walkInCompany) {
          badRequest(res, 'Company Walk In not found');
          return;
        }
        resolvedCompanyId = walkInCompany.id;
      }
      if (!resolvedCompanyId && is_house_use) {
        const houseUseCompany = await prisma.company_profiles.findFirst({
          where: { deleted_at: null, status: STATUS_ACTIVE, type_company: 'House Use' },
        });
        if (!houseUseCompany) {
          badRequest(res, 'Company House Use not found');
          return;
        }
        resolvedCompanyId = houseUseCompany.id;
      }

      // Get guest profile data
      const guestProfile = await prisma.guest_profiles.findUnique({
        where: { id: BigInt(guest_profile_id) },
      });

      // Get company name
      const companyProfile = resolvedCompanyId
        ? await prisma.company_profiles.findUnique({ where: { id: resolvedCompanyId } })
        : null;

      // Pricing inputs (Laravel Folio::saveReservation engine)
      const property = await prisma.properties.findUnique({ where: { id: propertyId! }, select: { is_tax: true } });
      const isTax = (property as any)?.is_tax === 1;
      const uniqueRateIds = [...new Set(reservation_list.map((i: any) => String(i.rate_id)).filter((r: string) => r && r !== '0'))] as string[];
      const rateRows = uniqueRateIds.length
        ? await prisma.rates.findMany({
            where: { id: { in: uniqueRateIds.map((r) => BigInt(r)) } },
            select: { id: true, code_post_id: true, code_post_extra_bed_id: true, name: true },
          })
        : [];
      const rateByIdPricing = new Map<number, any>(rateRows.map((r) => [Number(r.id), r]));
      const codePostIds = [...new Set(rateRows.flatMap((r) => [r.code_post_id, r.code_post_extra_bed_id]).filter(Boolean))] as bigint[];
      const codePostRows = codePostIds.length
        ? await prisma.code_posts.findMany({ where: { id: { in: codePostIds } } })
        : [];
      const codePostById = new Map<number, any>(codePostRows.map((c) => [Number(c.id), c]));
      // Laravel trusts FE applied_promo objects verbatim (Folio.php:2469-2471).
      const bodyAppliedPromos: PromoLike[] = Array.isArray(req.body.applied_promo) ? req.body.applied_promo : [];

      async function promosForNight(rateIdStr: string | null | undefined, night: Date, getNight: number): Promise<PromoLike[]> {
        if (bodyAppliedPromos.length > 0) return bodyAppliedPromos;
        if (!promo_code || !rateIdStr || rateIdStr === '0') return [];
        const rateIdBig = BigInt(rateIdStr);
        return findPromosForNight(prisma, rateIdBig, night, getNight, promo_code);
      }

      // Determine reservation status
      let statusReservation = is_pending
        ? STATUS_RESERVATION.pending.id
        : STATUS_RESERVATION.reservation.id;

      // Calculate actual check-in/check-out from reservation_list
      let actualCheckIn = check_in_date;
      let actualCheckOut = check_out_date;

      if (type_reservation === 'day-use') {
        actualCheckOut = actualCheckIn; // Day-use: same date
      }

      // Generate folio number
      const lastFolio = await prisma.folios.findFirst({
        where: { property_id: propertyId!, deleted_at: null },
        orderBy: { id: 'desc' },
        select: { folio_number: true },
      });

      let nextFolioNum = 1;
      if (lastFolio?.folio_number) {
        const match = lastFolio.folio_number.match(/(\d+)$/);
        if (match) nextFolioNum = parseInt(match[1]) + 1;
      }
      const folioNumber = String(nextFolioNum).padStart(7, '0');

      // Create folio
      const folio = await prisma.folios.create({
        data: {
          folio_number: folioNumber,
          parent: 0,
          property_id: propertyId!,
          type_reservation: type_reservation === 'day-use' ? 'fit' : type_reservation,
          guest_profile_id: guest_profile_id ? BigInt(guest_profile_id) : null,
          company_profile_id: resolvedCompanyId!,
          company_name: companyProfile?.name || null,
          first_name: guestProfile?.first_name || first_name || null,
          last_name: guestProfile?.last_name || last_name || null,
          title: null,
          telp: guestProfile?.telp || telp || null,
          email: guestProfile?.email || email || null,
          remark: remark || null,
          remark_ins: remark_ins || null,
          dept_branch: dept_branch || null,
          booking_agent_id: booking_agent_id ? BigInt(booking_agent_id) : null,
          contact_person_id: contact_person_id ? BigInt(contact_person_id) : null,
          is_pending: is_pending || false,
          cash_on_arrival: cash_on_arrival || false,
          guaranted: guaranted || false,
          is_walk_in: is_walk_in || false,
          is_house_use: is_house_use || false,
          complimentary: complimentary || false,
          is_compliment_tour_leader: is_compliment_tour_leader || false,
          is_day_use: type_reservation === 'day-use',
          is_virtual: type_reservation === 'vr',
          promo_code: promo_code || null,
          check_in_date: new Date(actualCheckIn),
          check_out_date: new Date(actualCheckOut),
          res_date: new Date(),
          res_time: new Date().toISOString().substring(11, 16),
          status: STATUS_ACTIVE,
          status_reservation: statusReservation,
          gender: guestProfile?.gender || null,
          birth_of_date: guestProfile?.birth_of_date || null,
          mobile_phone: guestProfile?.mobile_phone || null,
          nationality_id: guestProfile?.nationality_id || null,
          address: guestProfile?.address || null,
          city_id: guestProfile?.city_id || null,
          country_id: guestProfile?.country_id || null,
          postal_code: guestProfile?.postal_code || null,
          image: guestProfile?.image || null,
          card_type: guestProfile?.card_type || null,
          card_number: guestProfile?.card_number || null,
          card_expiry: guestProfile?.card_expiry || null,
          created_by: userId,
        },
      });

      // Create reservation items (per-night entries, priced via Folio::saveReservation parity)
      if (type_reservation !== 'git' && reservation_list.length > 0) {
        for (const item of reservation_list) {
          const itemCheckIn = new Date(item.check_in_date);
          let itemCheckOut = new Date(item.check_out_date);
          let nights = Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / (1000 * 60 * 60 * 24));

          // Day-use: Laravel Folio.php:494-501 forces +1 day on items so the night exists.
          if (type_reservation === 'day-use' && nights < 1) {
            itemCheckOut = new Date(itemCheckIn);
            itemCheckOut.setDate(itemCheckOut.getDate() + 1);
            nights = 1;
          }

          // Day-use: single priced night multiplied by quantity (Folio.php:2446-2448).
          const getNight = type_reservation === 'day-use' ? 0 : nights;
          const loopCount = type_reservation === 'day-use' ? 1 : nights;
          const rateIdBig = item.rate_id && String(item.rate_id) !== '0' ? BigInt(item.rate_id) : null;
          const roomTypeIdEff = item.room_type_id ? BigInt(item.room_type_id) : (item.room_type_id_next ? BigInt(item.room_type_id_next) : null);

          for (let i = 0; i < loopCount; i++) {
            const nightDate = new Date(itemCheckIn);
            nightDate.setDate(nightDate.getDate() + i);

            const pricing = await priceNight({
              prisma,
              rateId: rateIdBig,
              roomTypeId: roomTypeIdEff,
              night: nightDate,
              getNight,
              adult: Number(item.adult || 1),
              child: Number(item.child || 0),
              quantity: type_reservation === 'day-use' ? Number(item.quantity || 1) : 1,
              isTax,
              rateCodePost: rateIdBig ? codePostById.get(Number(rateRows.find((r) => Number(r.id) === Number(rateIdBig))?.code_post_id ?? -1)) ?? null : null,
              promos: await promosForNight(item.rate_id ? String(item.rate_id) : null, nightDate, getNight),
            });

            // Extra-bed pricing (Folio.php:2454-2462 + 2490-2497):
            // RateExtraBedInclusive cost × add_bed, tax via rate.code_post_extra_bed.
            let ebAmount = 0, ebService = 0, ebPb1 = 0, ebTax3 = 0, ebTotal = 0;
            const addBedCount = Number(item.add_bed || 0);
            if (addBedCount > 0 && rateIdBig) {
              const extraBeds = await prisma.rate_extra_bed_inclusives.findMany({
                where: { rate_id: rateIdBig, deleted_at: null },
              });
              const ebBase = extraBeds.reduce((s, it) => s + Number(it.cost ?? 0) * addBedCount, 0);
              const ebPostId = rateRows.find((r) => Number(r.id) === Number(rateIdBig))?.code_post_extra_bed_id;
              const cpEb = ebPostId ? codePostById.get(Number(ebPostId)) : null;
              if (cpEb) {
                const calcEb = calculateCodePost(cpEb as any, ebBase, isTax);
                ebAmount = calcEb.amount; ebService = calcEb.service;
                ebPb1 = calcEb.pb1; ebTax3 = calcEb.tax3; ebTotal = calcEb.total;
              } else {
                ebAmount = ebBase; ebTotal = ebBase;
              }
            }

            await prisma.reservations.create({
              data: {
                property_id: propertyId!,
                folio_id: folio.id,
                rate_id: rateIdBig,
                room_type_id: item.room_type_id ? BigInt(item.room_type_id) : null,
                room_id: item.room_id ? BigInt(item.room_id) : null,
                adult: item.adult || 1,
                child: item.child || 0,
                add_bed: item.add_bed || 0,
                // Per-item fields persisted by Laravel saveReservation (:2610-2633)
                eta: parseTimeLike(item.eta, nightDate),
                etd: parseTimeLike(item.etd, nightDate),
                is_24_hour: item.is_24_hour === true || Number(item.is_24_hour) === 1 ? 1 : 0,
                package_id: item.package_id ? BigInt(item.package_id) : null,
                quantity: Number(item.quantity ?? 1),
                quantity_extra_day_use: Number(item.quantity_extra_day_use ?? 0),
                is_extra_day_use: item.is_extra_day_use === true || Number(item.is_extra_day_use) === 1 ? 1 : 0,
                check_in_date: new Date(item.check_in_date),
                check_out_date: itemCheckOut,
                date: nightDate,
                status_reservation: statusReservation,
                status: STATUS_ACTIVE,
                night: nights,
                amount: pricing.amount,
                amountt: pricing.amount,
                total: pricing.total,
                service_charge: pricing.service_charge,
                pb1: pricing.pb1,
                tax3: pricing.tax3,
                amount_extra_bed: ebAmount,
                service_charge_extra_bed: ebService,
                pb1_extra_bed: ebPb1,
                tax3_extra_bed: ebTax3,
                total_extra_bed: ebTotal,
                data: JSON.stringify({
                  rate_price: pricing.rate_price,
                  service: pricing.service_charge,
                  pb1: pricing.pb1,
                  tax3: pricing.tax3,
                  total: pricing.total,
                }),
                created_by: userId,
              },
            });
          }
        }
      }

      // Ledger rebuild (Laravel Folio.php:2690-2734)
      await rebuildFolioLedgers(folio.id, propertyId!, resolvedCompanyId, guest_profile_id ? BigInt(guest_profile_id) : null);

      // GIT: create sub-folios per room type
      if (type_reservation === 'git' && room_reservation_list.length > 0) {
        let subIndex = 1;
        for (const roomItem of room_reservation_list) {
          const qty = roomItem.qty || 1;
          for (let i = 0; i < qty; i++) {
            const subFolioNumber = `${folioNumber}/${String(subIndex).padStart(3, '0')}`;

            const subFolio = await prisma.folios.create({
              data: {
                folio_number: subFolioNumber,
                parent: folio.id,
                property_id: propertyId!,
                type_reservation: 'git',
                guest_profile_id: guest_profile_id ? BigInt(guest_profile_id) : null,
                company_profile_id: resolvedCompanyId!,
                company_name: companyProfile?.name || null,
                first_name: guestProfile?.first_name || first_name || null,
                last_name: guestProfile?.last_name || last_name || null,
                remark: remark || null,
                is_pending: is_pending || false,
                is_compliment_tour_leader: false,
                check_in_date: new Date(actualCheckIn),
                check_out_date: new Date(actualCheckOut),
                res_date: new Date(),
                res_time: new Date().toISOString().substring(11, 16),
                status: STATUS_ACTIVE,
                status_reservation: statusReservation,
                created_by: userId,
              },
            });

            const gitRateId = roomItem.rate_id && String(roomItem.rate_id) !== '0' ? BigInt(roomItem.rate_id) : null;
            const gitRoomTypeId = BigInt(roomItem.id);
            const gitCheckIn = new Date(actualCheckIn);
            const gitCheckOut = new Date(actualCheckOut);
            let gitNights = Math.ceil((gitCheckOut.getTime() - gitCheckIn.getTime()) / (1000 * 60 * 60 * 24));
            if (gitNights < 1) gitNights = 1;

            for (let n = 0; n < gitNights; n++) {
              const nightDate = new Date(gitCheckIn);
              nightDate.setDate(nightDate.getDate() + n);

              const pricing = await priceNight({
                prisma,
                rateId: gitRateId,
                roomTypeId: gitRoomTypeId,
                night: nightDate,
                getNight: gitNights,
                adult: Number(roomItem.adult || 1),
                child: Number(roomItem.child || 0),
                quantity: 1,
                isTax,
                rateCodePost: gitRateId ? codePostById.get(Number(rateRows.find((r) => Number(r.id) === Number(gitRateId))?.code_post_id ?? -1)) ?? null : null,
                promos: await promosForNight(roomItem.rate_id ? String(roomItem.rate_id) : null, nightDate, gitNights),
              });

              await prisma.reservations.create({
                data: {
                  property_id: propertyId!,
                  folio_id: subFolio.id,
                  rate_id: gitRateId,
                  room_type_id: gitRoomTypeId,
                  adult: roomItem.adult || 1,
                  child: roomItem.child || 0,
                  check_in_date: new Date(actualCheckIn),
                  check_out_date: new Date(actualCheckOut),
                  date: nightDate,
                  status_reservation: statusReservation,
                  status: STATUS_ACTIVE,
                  night: gitNights,
                  amount: pricing.amount,
                  amountt: pricing.amount,
                  total: pricing.total,
                  service_charge: pricing.service_charge,
                  pb1: pricing.pb1,
                  tax3: pricing.tax3,
                  data: JSON.stringify({
                    rate_price: pricing.rate_price,
                    service: pricing.service_charge,
                    pb1: pricing.pb1,
                    tax3: pricing.tax3,
                    total: pricing.total,
                  }),
                  created_by: userId,
                },
              });
            }

            subIndex++;
          }
        }
      }

      const message = is_pending
        ? 'Room is not available, reservation is Created as Pending'
        : 'Success';

      const result = bigintToNumber(folio);
      // Laravel Folio::saveReservation dispatches SyncStaahRoomAvailability (:2743)
      enqueueJob('sync-staah-room-availability', {
        propertyId: Number((folio as any).property_id ?? 0),
        dateFrom: (folio as any).check_in_date ? formatDate(new Date((folio as any).check_in_date)) : undefined,
        dateTo: (folio as any).check_out_date ? formatDate(new Date((folio as any).check_out_date)) : undefined,
      });
      success(res, result, message, 200);
    } catch (err: any) {
      console.error('Reservation store error:', err?.message, err?.stack?.substring(0, 500));
      error(res, `Failed to create reservation: ${err?.message || 'unknown'}`, 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || idParam === 'null' || idParam === 'undefined' || !/^\d+$/.test(idParam)) {
        notFound(res, 'Reservation not found');
        return;
      }
      const id = BigInt(idParam);

      const folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' } },
          properties: { select: { name: true } },
        },
      });

      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      success(res, bigintToNumber(folio), 'Success', 200, { permission: { view: true }, search_data: { statuses: ['reservation', 'pending', 'check_in', 'check_out', 'cancel_reservation'] } } as any);
    } catch (err: any) {
      console.error('Reservation show error:', err);
      error(res, 'Failed to fetch reservation', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations/:id/edit
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Replicates Laravel Folio::formatData (+ ReservationController@edit master) â€” GET /reservation/:id/update
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = new Date();
      const bdate = await AuthController.getBusinessDate(pid === 0n ? null : pid);

// Try find folio by id; if not found, fall back to reservations.id -> folio_id
      let folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          company_profiles_folios_company_profile_idTocompany_profiles: true,
          company_profiles_folios_booking_agent_idTocompany_profiles: true,
          reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, include: { room_types: true, rates: true } },
        },
      });

      if (!folio || folio.deleted_at) {
        // Fallback: id may be a reservation id; lookup its folio_id
        const resv = await prisma.reservations.findUnique({ where: { id, deleted_at: null }, select: { folio_id: true } });
        if (resv?.folio_id) {
          folio = await prisma.folios.findUnique({
            where: { id: resv.folio_id },
            include: {
              company_profiles_folios_company_profile_idTocompany_profiles: true,
              company_profiles_folios_booking_agent_idTocompany_profiles: true,
              reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, include: { room_types: true, rates: true } },
            },
          });
        }
      }

      if (!folio || folio.deleted_at) { notFound(res, 'Not Found'); return; }

      const [guestProfile, countryOf, countryNationality, cityOf, contactPerson] = await Promise.all([
        folio.guest_profile_id ? prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } }) : null,
        folio.country_id ? prisma.countries.findUnique({ where: { id: BigInt(folio.country_id) } }).catch(() => null) : null,
        folio.nationality_id ? prisma.countries.findUnique({ where: { id: BigInt(folio.nationality_id) } }).catch(() => null) : null,
        folio.city_id ? prisma.cities.findUnique({ where: { id: BigInt(folio.city_id) } }).catch(() => null) : null,
        folio.contact_person_id ? prisma.company_profile_contact_persons.findUnique({ where: { id: folio.contact_person_id } }).catch(() => null) : null,
      ]);

      const isParentGit = folio.type_reservation?.toLowerCase() === 'git' && Number(folio.parent) === 0;
      const isSubGit = folio.type_reservation?.toLowerCase() === 'git' && Number(folio.parent) !== 0;
      const isVr = folio.type_reservation === 'vr';
      const isCancel = folio.status_reservation === 2;
      const isCheckout = folio.status_reservation === 1;
      const isCheckin = folio.status_reservation === 0;

      // GIT parent: reservations come from first child folio (Laravel childFolio()->first())
      let reservations = folio.reservations;
      let childFolio: any = null;
      if (isParentGit) {
        childFolio = await prisma.folios.findFirst({
          where: { parent: id, deleted_at: null },
          orderBy: { id: 'asc' },
          include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, include: { room_types: true, rates: true } } },
        });
        if (childFolio) reservations = childFolio.reservations;
      }
      // Laravel Folio::formatAction check_in: parent GIT needs >=1 child folio with status reservation (3)
      const childReservationCount = isParentGit
        ? await prisma.folios.count({ where: { parent: id, deleted_at: null, status_reservation: 3 } })
        : 0;
      const reservationsMeta = isParentGit && childFolio ? childFolio : folio;

      const [typeLinks, roomRows] = await Promise.all([
        prisma.model_has_types.findMany({ where: { model_type: { contains: 'Folio' }, model_id: id }, include: { types: true } }),
        prisma.rooms.findMany({
          where: {
            OR: [
              { id: { in: reservations.filter((r: any) => r.room_id).map((r: any) => r.room_id) } },
              { id: { in: reservations.filter((r: any) => r.room_id_next).map((r: any) => r.room_id_next) } },
            ],
          },
        }),
      ]);
      const roomMap = new Map(roomRows.map((r: any) => [Number(r.id), r]));

      const folioTypes = (group: string): any => {
        const t = typeLinks.find((l: any) => l.types?.group === group);
        return t?.types ? { value: Number(t.types.id), label: t.types.name } : [];
      };

      const [companies, roomTypes, types, property, contacts] = await Promise.all([
        prisma.company_profiles.findMany({ where: { deleted_at: null, status: STATUS_ACTIVE, property_id: pid }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.room_types.findMany({ where: { deleted_at: null, status: STATUS_ACTIVE, property_id: pid }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source', 'guest-status'] } },
          select: { id: true, name: true, group: true },
        }),
        prisma.properties.findUnique({ where: { id: pid }, include: { cities: true } }),
        prisma.company_profile_contact_persons.findMany({ where: { deleted_at: null, property_id: pid }, select: { id: true, name: true } }),
      ]);

      const uidCols = [
        'pb1_account_uid',
        'service_charge_account_uid',
        'tax_account_uid',
        'surcharge_account_uid',
        'advance_deposit_current_day_account_uid',
        'advance_deposit_previous_day_account_uid',
        'guest_ledger_current_day_account_uid',
        'guest_ledger_previous_day_account_uid',
        'day_use_item_code',
      ];
      const uidIds = uidCols.map((c: string) => (property as any)?.[c]).filter((v: any) => v != null).map((v: any) => BigInt(v));
      const codePosts = uidIds.length ? await prisma.code_posts.findMany({ where: { id: { in: uidIds } }, select: { id: true, name: true } }) : [];
      const cpMap = new Map(codePosts.map((c: any) => [Number(c.id), c]));
      const cpLabel = (v: any): { value: number | null; label: string } => {
        if (v == null) return { value: null, label: '' };
        const cp = cpMap.get(Number(v));
        return { value: Number(v), label: cp ? `${cp.description} (${cp.name})` : '' };
      };

      const contactMap = new Map(contacts.map((c: any) => [Number(c.id), c.name]));
      const roomCount = await prisma.rooms.count({ where: { property_id: pid, deleted_at: null } });

      const groupBy = (arr: any[], key: string) =>
        arr.reduce((acc, item) => { (acc[item[key]] = acc[item[key]] || []).push(item); return acc; }, {} as any);
      const grouped = groupBy(types, 'group');
      const toOpt = (arr: any[]) => arr.map((t: any) => ({ value: Number(t.id), label: t.name }));
      const statusGuestArr = toOpt(grouped['guest-status'] || []);
      const statusGuestSorted = [
        ...statusGuestArr.filter((i: any) => i.label.toLowerCase().includes('normal')),
        ...statusGuestArr.filter((i: any) => !i.label.toLowerCase().includes('normal')),
      ];
      const normalFallback = statusGuestArr.find((i: any) => i.label.toLowerCase().includes('normal')) || { value: 1, label: 'Normal' };

      // ---- master ----
      const master = {
        statuses: [
          { value: 1, label: 'Active' },
          { value: 0, label: 'Inactive' },
        ],
        nrics: [
          { value: 0, label: 'KTP' }, { value: 1, label: 'Paspor' }, { value: 2, label: 'SIM' }, { value: 3, label: 'KITAS' },
        ],
        genders: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }],
        regions: ['Asia', 'Europe', 'Africa', 'America', 'Oceania', 'Polar'].map((r) => ({ value: r, label: r })),
        market_segment_1: toOpt(grouped['market-segment-1'] || []),
        market_segment_2: toOpt(grouped['market-segment-2'] || []),
        market_segment_3: toOpt(grouped['market-segment-3'] || []),
        market_segment_4: toOpt(grouped['market-segment-4'] || []),
        source: toOpt(grouped['source'] || []),
        status_reservations: Object.entries(STATUS_RESERVATION).map(([k, v]: any) => ({ value: v.id, label: v.name })),
        status_guests: statusGuestSorted,
        typemulti: [
          { label: 'Normal', value: 'normal' },
          { label: 'Walk In', value: 'is_walk_in' },
          { label: 'House Use', value: 'is_house_use' },
          { label: 'Complimentary', value: 'complimentary' },
        ],
        cardtypes: ['KTP', 'Paspor', 'SIM', 'KITAS'].map((c) => ({ value: c, label: c })),
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        legend: [
          { label: 'BAR', color: 'bg-secondary text-white rounded-md font-semibold' },
          { label: 'COMPANY APPLICABLE', color: 'bg-success text-white rounded-md font-semibold' },
          { label: 'APPLICABLE FOR ALL', color: 'bg-primary text-white rounded-md font-semibold' },
        ],
        markets: {
          id: Number(property?.id ?? 0),
          city: property?.cities?.name ?? null,
          name: property?.name ?? '',
          email: property?.email ?? null,
          telp: property?.telp ? String(property.telp) : null,
          is_tax: { value: !!property?.is_tax, label: property?.is_tax ? 'Yes' : 'No' },
          is_tax_exclude_restaurant: { value: !!property?.is_tax_exclude_restaurant, label: property?.is_tax_exclude_restaurant ? 'Yes' : 'No' },
          is_tax_exclude_room: { value: !!property?.is_tax_exclude_room, label: property?.is_tax_exclude_room ? 'Yes' : 'No' },
          pb1_account_uid: cpLabel(property?.pb1_account_uid),
          service_charge_account_uid: cpLabel(property?.service_charge_account_uid),
          tax_account_uid: cpLabel(property?.tax_account_uid),
          surcharge_account_uid: cpLabel(property?.surcharge_account_uid),
          advance_deposit_current_day_account_uid: cpLabel(property?.advance_deposit_current_day_account_uid),
          advance_deposit_previous_day_account_uid: cpLabel(property?.advance_deposit_previous_day_account_uid),
          guest_ledger_current_day_account_uid: cpLabel(property?.guest_ledger_current_day_account_uid),
          guest_ledger_previous_day_account_uid: cpLabel(property?.guest_ledger_previous_day_account_uid),
          day_use_item_code: cpLabel(property?.day_use_item_code),
          room_count: roomCount,
          is_market_segment_1: !!property?.market_segment_1,
          is_market_segment_2: !!property?.market_segment_2,
          is_market_segment_3: !!property?.market_segment_3,
          is_market_segment_4: !!property?.market_segment_4,
          is_source: !!property?.source,
          mandatory_check_in: [],
        },
      };

      // ---- reservation items (Laravel reservationListFormat grouped by rate-adult-child-add_bed-room_type-room) ----
      const roomStatusLabel = (code: any, name: string | null): string => {
        if (name) return name;
        const m = Object.values(ROOM_STATUSES).find((s: any) => s.id === Number(code));
        return m?.name ?? String(code ?? '');
      };

      const isDayUse = !!folio.is_day_use;
      const lastReservation = reservations[reservations.length - 1] || null;
      const lastRoom = lastReservation?.room_id ? roomMap.get(Number(lastReservation.room_id)) : null;

      const base64Key = (r: any) => `${r.rate_id}-${r.adult}-${r.child}-${r.add_bed}-${r.room_type_id}-${r.room_id}`;
      const groupsMap = new Map<string, any[]>();
      reservations.forEach((r: any) => {
        const k = base64Key(r);
        if (!groupsMap.has(k)) groupsMap.set(k, []);
        groupsMap.get(k)!.push(r);
      });

      const reservationItems: any[] = [];
      groupsMap.forEach((rows: any[]) => {
        const first = rows[0];
        const checkInDate = reservationsMeta.check_in_date ? new Date(reservationsMeta.check_in_date).toISOString().slice(0, 10) : (first.date ? new Date(first.date).toISOString().slice(0, 10) : '');
        let checkOutDate: string;
        if (isParentGit || reservationsMeta.check_out_date) {
          checkOutDate = new Date(reservationsMeta.check_out_date).toISOString().slice(0, 10);
        } else if (groupsMap.size > 1) {
          const lastRow = rows[rows.length - 1];
          const d = lastRow.date ? new Date(lastRow.date) : new Date();
          d.setDate(d.getDate() + 1);
          checkOutDate = d.toISOString().slice(0, 10);
        } else {
          checkOutDate = folio.check_out_date ? new Date(folio.check_out_date).toISOString().slice(0, 10) : (first.date ? new Date(first.date).toISOString().slice(0, 10) : '');
        }

        let isPosting = first.is_posting;
        if (isCheckin && businessDate.toISOString().slice(0, 10) <= checkOutDate && businessDate.toISOString().slice(0, 10) > checkInDate) isPosting = -1;
        if (isVr) isPosting = -1;
        if (folio.is_day_use && isCheckin) isPosting = 0;

        const night = isDayUse ? 0 : Math.max(0, Math.round((new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / 86400000));

        const rateLabel = first.rate_name ?? first.rates?.code ?? '';
        reservationItems.push({
          id: Number(first.id),
          eta: first.eta ? new Date(first.eta).toISOString().slice(0, 16) : null,
          etd: first.etd ? new Date(first.etd).toISOString().slice(0, 16) : null,
          ata: first.ata ? new Date(first.ata).toISOString().slice(0, 16) : null,
          atd: first.atd ? new Date(first.atd).toISOString().slice(0, 16) : null,
          adult: first.adult,
          child: first.child,
          add_bed: first.add_bed,
          reason: first.remark,
          check_in_date: checkInDate,
          check_out_date: checkOutDate,
          room_type_id: first.room_type_id ? { value: Number(first.room_type_id), label: first.room_type_name ?? first.room_types?.name ?? '' } : [],
          room_id: first.room_id ? { value: Number(first.room_id), label: first.room_name ?? roomMap.get(Number(first.room_id))?.name ?? '' } : [],
          room_type_id_origin: first.room_type_id ? { value: Number(first.room_type_id), label: first.room_types?.name ?? '' } : [],
          room_id_origin: { value: first.room_id ? Number(first.room_id) : 0, label: first.room_id ? (roomMap.get(Number(first.room_id))?.name ?? '') : '' },
          room_type_id_next: first.room_type_id_next ? { value: Number(first.room_type_id_next), label: '' } : [],
          room_id_next: first.room_id_next ? { value: Number(first.room_id_next), label: roomMap.get(Number(first.room_id_next))?.name ?? '' } : [],
          change_room: first.room_id_next != null,
          night,
          is_room_change: !!first.room_type_id_next,
          rate_id: first.rate_id ? { value: Number(first.rate_id), label: rateLabel } : [],
          is_posting: isPosting,
          date: first.date ? new Date(first.date).toISOString().slice(0, 10) : null,
          package_id: first.package_id ? { value: Number(first.package_id), time: null, label: '' } : [],
          quantity: first.quantity,
          quantity_extra_day_use: first.quantity_extra_day_use,
          is_extra_day_use: !!first.is_extra_day_use,
          is_24_hour: !!first.is_24_hour,
        });
      });

      // ---- revenue (Laravel getRevenue) ----
      let revenueReservations = reservations;
      if (isParentGit && childFolio) revenueReservations = childFolio.reservations;
      const revenueDate: any[] = [];
      let roomCharge = 0, pb1 = 0, service = 0, tax3 = 0;
      revenueReservations.forEach((r: any) => {
        const charge = Number(r.amount ?? 0);
        revenueDate.push({ date: r.date ? new Date(r.date).toLocaleDateString('en-GB') : '', charge: moneyFormat(charge) });
        roomCharge += charge;
        pb1 += Number(r.pb1 ?? 0);
        service += Number(r.service_charge ?? 0);
        tax3 += Number(r.tax3 ?? 0);
      });
      const revenue = {
        date: revenueDate,
        charge: [
          { label: 'Room Charge', value: moneyFormat(roomCharge) },
          { label: 'PB1', value: moneyFormat(pb1) },
          { label: 'Service Charge', value: moneyFormat(service) },
          { label: 'Total Room Charge', value: moneyFormat(roomCharge + pb1 + tax3 + service) },
        ],
      };

      // ---- balance (Laravel getBalance) ----
      const balanceWhere = { where: { deleted_at: null } as any };
      const balanceTargets = isParentGit
        ? [{ id, parent: true }, ...(await prisma.folios.findMany({ where: { parent: id, deleted_at: null }, select: { id: true } })).map((f: any) => ({ id: f.id, parent: false }))]
        : [{ id, parent: isSubGit }];
      const txns = await prisma.transactions.findMany({ where: { folio_id: { in: balanceTargets.map((t: any) => t.id) }, deleted_at: null }, select: { folio_id: true, model_type: true, type_amount: true, total: true } });
      let balance = 0;
      txns.forEach((t: any) => {
        const target = balanceTargets.find((x: any) => x.id === t.folio_id);
        if (!target) return;
        if (target.parent) {
          if (t.model_type?.includes('CompanyProfile')) {
            balance += t.type_amount === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0);
          }
        } else if (isSubGit) {
          if (t.model_type?.includes('GuestProfile')) {
            balance += t.type_amount === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0);
          }
        } else {
          balance += t.type_amount === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0);
        }
      });

      const guestName = (f: string | null, l: string | null, account?: string | null): string =>
        (f ?? '') !== '' || (l ?? '') !== '' ? `${f ?? ''} ${l ?? ''}`.trim() : (account ?? '');

      const statusReservationValue = folio.status_reservation === 3 && folio.is_request_cancel
        ? { value: folio.status_reservation, label: 'Request Cancel' }
        : { value: folio.status_reservation ?? 3, label: STATUS_RESERVATION_MAP[folio.status_reservation ?? 3] ?? 'Reservation' };

      // ---- actions (Laravel Folio::formatAction parity) ----
      const appUrl = process.env.APP_URL ?? 'http://localhost:8000';
      const actions = (() => {
        const mapAction = (list: typeof ACTION_RESERVATION) =>
          list.map((a) => ({ label: a.name, key: a.key, icon: appUrl + a.icon, line: a.line ?? false }));

        if (String(req.query.night_audit) === '1') {
          const nightKeys: Record<string, string[]> = {
            'room-change': ['confirm_change_room', 'edit', 'cancel_change_room'],
            'no-show': ['cancel_reservation', 'edit'],
            'over-stay': ['check_out', 'edit'],
          };
          const keys = nightKeys[String(req.query.audit_type ?? '')] ?? [];
          return mapAction(ACTION_RESERVATION.filter((a) => keys.includes(a.key)));
        }

        const statusCodeMap: Record<number, string> = { 0: 'check_in', 1: 'check_out', 2: 'cancel_reservation', 3: 'reservation', 4: 'in_house', 5: 'pending' };
        const statusCode = statusCodeMap[folio.status_reservation ?? 3] ?? 'default';
        const ruleKeys = ACTION_RULE[statusCode] ?? ACTION_RULE.default;
        const isFit = String(folio.type_reservation ?? '') === 'fit';
        const isGit = String(folio.type_reservation ?? '') === 'git';
        const isParentGit = isGit && Number(folio.parent) === 0;
        const isPending = folio.is_pending === true || folio.status_reservation === 5;
        const ownRes: any[] = folio.reservations ?? [];

        return mapAction(ACTION_RESERVATION.filter((a) => {
          if ((a.key === 'confirm_change_room' || a.key === 'cancel_change_room') && !ownRes.some((r: any) => r.room_id_next != null)) return false;
          if ((a.key === 'confirm_reservation' || a.key === 'cancel_reservation') && folio.status_reservation === 2) return false;
          if (a.key === 'un_check_in' && fmtLocalDate(folio.check_in_date) !== bdate) return false;
          if ((req.query.group === 'fit' || req.query.group === 'git') && ['check_in', 'check_out', 'un_check_in', 'un_check_out'].includes(a.key)) return false;
          if (isParentGit && a.key === 'assign_room') return false;
          if (a.key === 'move_reservation' && isGit) return false;
          if (a.key === 'copy_reservation' && !isFit) return false;
          if (a.key === 'check_in' && folio.status_reservation === 0) {
            if (!isParentGit) return false;
            if (childReservationCount === 0) return false;
          }
          if (isPending) return ['edit', 'cancel_reservation', 'confirm_reservation', 'copy_reservation', 'add_message', 'view_message'].includes(a.key);
          if (a.key === 'vr' || a.key === 'git' || a.key === 'fit') return a.key.toLowerCase() === String(folio.type_reservation ?? '').toLowerCase();
          return ruleKeys.includes(a.key);
        }));
      })();

      const data = {
        id: Number(folio.id),
        is_parent: Number(folio.parent) > 0 ? false : true,
        is_parent_git: isParentGit,
        is_sub_git: isSubGit,
        is_vr: isVr,
        is_cancel: isCancel || isCheckout || folio.is_pending,
        is_checkin: isCheckin,
        is_early_checkout: folio.check_out_date ? businessDate.toISOString().slice(0, 10) < new Date(folio.check_out_date).toISOString().slice(0, 10) : false,
        is_has_auto_transfer: false,
        is_has_folio_auto_transfer: false,
        company_profile_id: folio.company_profile_id ? Number(folio.company_profile_id) : null,
        date_arrival: folio.date_arrival ? new Date(folio.date_arrival).toLocaleDateString('en-GB').replace(/\//g, '-') : null,
        reservation: {
          folio: folio.folio_number,
          status_reservation: statusReservationValue,
          company_id: { value: folio.company_profile_id ? Number(folio.company_profile_id) : null, label: folio.company_profiles_folios_company_profile_idTocompany_profiles?.name ?? null },
          room_status: lastRoom ? { value: Number(lastRoom.room_status), label: roomStatusLabel(lastRoom.room_status, lastReservation?.room_status_name) } : [],
          cash_on_arrival: !!folio.cash_on_arrival,
          guaranted: !!folio.guaranted,
          print_status: !!folio.print_status,
          use_allotment: !!folio.use_allotment,
          is_do_not_disturb: !!folio.is_do_not_disturb,
          is_incognito: !!folio.is_incognito,
          is_long_stay: !!folio.is_long_stay,
          is_compliment_tour_leader: !!folio.is_compliment_tour_leader,
          is_pending: !!folio.is_pending,
          res_date: folio.res_date ? new Date(folio.res_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '',
          res_time: folio.res_time ? new Date(folio.res_time).toISOString().slice(11, 16) : '00:00',
          cut_off_date: folio.check_in_date ? new Date(new Date(folio.check_in_date).getTime() - 86400000).toLocaleDateString('en-GB').replace(/\//g, '-') : '',
          booking_agent_id: folio.booking_agent_id ? { value: Number(folio.booking_agent_id), label: folio.booking_agent_id ? '' : null } : [],
          contact_person_id: folio.contact_person_id ? { value: Number(folio.contact_person_id), label: contactMap.get(Number(folio.contact_person_id)) ?? '' } : [],
          limit_1: folio.limit_1,
          limit_2: folio.limit_2,
          flight_or_car: folio.flight_or_car,
          loyalty_card: folio.loyalty_card,
          loyalty_card_number: folio.loyalty_card_number,
          booking_no: folio.booking_no,
          market_segment_1: folioTypes('market-segment-1'),
          market_segment_2: folioTypes('market-segment-2'),
          market_segment_3: folioTypes('market-segment-3'),
          market_segment_4: folioTypes('market-segment-4'),
          source: folioTypes('source'),
          remark: folio.remark,
          promo_code: folio.promo_code,
        },
        guest: {
          guest_name: guestName(guestProfile?.first_name ?? null, guestProfile?.last_name ?? null, guestProfile?.account),
          guest_profile_id: folio.guest_profile_id ? Number(folio.guest_profile_id) : null,
          card_type: { value: folio.card_type, label: folio.card_type },
          card_number: guestProfile?.card_number ?? null,
          card_expiry: folio.card_expiry,
          email: guestProfile?.email ?? null,
          status_profile: folioTypes('guest-status') || normalFallback,
          gender: folio.gender ? { value: folio.gender, label: folio.gender } : [],
          birth_of_date: guestProfile?.birth_of_date ? new Date(guestProfile.birth_of_date).toISOString().slice(0, 10) : null,
          telp: guestProfile?.telp,
          mobile_phone: guestProfile?.mobile_phone,
          nationality_id: { value: folio.nationality_id ?? null, label: countryNationality?.name ?? null },
          is_subscribe: !!folio.is_subscribe,
          is_do_not_contact: !!folio.is_subscribe,
          guest_stay: null,
          address: folio.address,
          city_id: { value: folio.city_id ?? null, label: cityOf?.name ?? null },
          country_id: { value: folio.country_id ?? null, label: countryOf?.name ?? null },
          postal_code: folio.postal_code,
          guest_status: folioTypes('guest-status') || normalFallback,
          image: folio.image,
        },
        special_instruction: {
          remark: String(folio.remark ?? ''),
          is_gh: !!folio.is_gh,
          check_in_instruction: String(folio.check_in_instruction ?? ''),
          check_out_instruction: String(folio.check_out_instruction ?? ''),
          posting_instruction: String(folio.posting_instruction ?? ''),
          remark_ins: folio.remark ?? null,
        },
        reservation_items: reservationItems,
        reservation_confirm: reservationItems.filter((r: any) => r.change_room),
        is_change_room: reservations.some((r: any) => r.room_id_next != null),
        balance: moneyFormat(balance),
        revenue,
        room_status: lastRoom ? roomStatusLabel(lastRoom.room_status, lastReservation?.room_status_name) : '',
        total_night: folio.check_in_date && folio.check_out_date ? Math.round((new Date(folio.check_out_date).getTime() - new Date(folio.check_in_date).getTime()) / 86400000) : 0,
        is_do_not_move: true,
        type_reservation: String(folio.type_reservation ?? '').toUpperCase(),
        guest_profile_id: folio.guest_profile_id ? Number(folio.guest_profile_id) : null,
        check_in_date: folio.check_in_date,
        check_out_date: folio.check_out_date,
        guest_name: guestName(folio.first_name, folio.last_name, guestProfile?.account),
        company: (folio.company_name ?? '') !== '' ? folio.company_name : folio.company_profiles_folios_company_profile_idTocompany_profiles?.name ?? null,
        actions,
        guest_status: folioTypes('guest-status') || normalFallback,
        guest_status_color: [
          {
            label: String((folioTypes('guest-status') || normalFallback).label ?? 'Normal').replace(/\s+/g, '-'),
            color: ['VIP', 'VVIP', 'VVVIP'].includes(String((folioTypes('guest-status') || normalFallback).label ?? '').toUpperCase()) ? 'bg-yellow' : 'bg-green',
            is_color: true,
          },
        ],
        stay: null,
        room: lastRoom?.name ?? null,
        room_type: lastReservation?.room_type_name ?? lastReservation?.room_types?.name ?? null,
        status_reservation: statusReservationValue.label,
        status_reservation_color: [{ label: String(statusReservationValue.label).replace(/\s+/g, '-'), color: '', is_color: true }],
        room_clean_status_color: lastRoom ? [{ label: String(lastReservation?.maid_status_name ?? '').replace(/\s+/g, '-'), color: '', is_color: true }] : [],
        room_status_color: lastRoom ? [{ label: String(roomStatusLabel(lastRoom.room_status, lastReservation?.room_status_name)).replace(/\s+/g, '-'), color: '', is_color: true }] : [],
        room_clean_status: lastReservation?.maid_status_name ?? '',
        remark_folio: folio.remark,
        remark: folio.remark,
        remark_bool: !!(folio.remark !== '' || folio.posting_instruction !== '' || folio.check_out_instruction !== '' || folio.check_in_instruction !== ''),
        ign: !!folio.is_incognito,
        message_bool: false,
        folio_number: folio.folio_number,
        formated_guest_profile: guestProfile ? `${guestProfile.account}, ${folio.first_name ?? ''} ${folio.last_name ?? ''}` : null,
        created_at: folio.created_at,
        updated_at: folio.updated_at,
        deleted_at: folio.deleted_at,
        created_by: folio.created_by ? Number(folio.created_by) : null,
        updated_by: folio.updated_by ? Number(folio.updated_by) : null,
        comm_code: folioTypes('comm-code'),
        status: { value: 1, label: 'Active' },
        sharer: '',
        aa: reservations[0]?.adult,
        cc: reservations[0]?.child,
        mandatory_check_in: { fields: [], missing_fields: [], is_complete: true },
      };

      success(res, data, 'Success', 200, { master });
    } catch (err: any) {
      console.error('Reservation edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /api/reservations/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.folios.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      const {
        guest_profile_id,
        company_profile_id,
        first_name,
        last_name,
        email,
        telp,
        remark,
        remark_ins,
        booking_agent_id,
        contact_person_id,
        check_in_date,
        check_out_date,
        reservation_list,
        is_pending,
        status_reservation,
        dept_branch,
      } = req.body;

      // Resolve company name
      let companyName = existing.company_name;
      if (company_profile_id && company_profile_id !== Number(existing.company_profile_id)) {
        const cp = await prisma.company_profiles.findUnique({ where: { id: BigInt(company_profile_id) } });
        companyName = cp?.name || companyName;
      }

      // Calculate new check-in/check-out from reservation_list
      let actualCheckIn = check_in_date || existing.check_in_date;
      let actualCheckOut = check_out_date || existing.check_out_date;
      if (reservation_list && reservation_list.length > 0) {
        const checkIns = reservation_list.map((r: any) => new Date(r.check_in_date).getTime());
        const checkOuts = reservation_list.map((r: any) => new Date(r.check_out_date).getTime());
        actualCheckIn = new Date(Math.min(...checkIns));
        actualCheckOut = new Date(Math.max(...checkOuts));
      }

      // Update folio
      const updateData: any = {
        updated_at: new Date(),
        updated_by: userId,
      };
      if (guest_profile_id != null) updateData.guest_profile_id = BigInt(guest_profile_id);
      if (company_profile_id != null) updateData.company_profile_id = BigInt(company_profile_id);
      if (first_name !== undefined) updateData.first_name = first_name;
      if (last_name !== undefined) updateData.last_name = last_name;
      if (email !== undefined) updateData.email = email;
      if (telp !== undefined) updateData.telp = telp;
      if (remark !== undefined) updateData.remark = remark;
      if (remark_ins !== undefined) updateData.remark_ins = remark_ins;
      if (booking_agent_id !== undefined) updateData.booking_agent_id = booking_agent_id ? BigInt(booking_agent_id) : null;
      if (contact_person_id !== undefined) updateData.contact_person_id = contact_person_id ? BigInt(contact_person_id) : null;
      if (companyName !== undefined) updateData.company_name = companyName;
      if (actualCheckIn) updateData.check_in_date = new Date(actualCheckIn);
      if (actualCheckOut) updateData.check_out_date = new Date(actualCheckOut);
      if (is_pending !== undefined) {
        updateData.is_pending = !!is_pending;
        if (is_pending) {
          updateData.status_reservation = STATUS_RESERVATION.pending.id;
        } else if (updateData.status_reservation === undefined) {
          updateData.status_reservation = STATUS_RESERVATION.reservation.id;
        }
      }
      if (status_reservation !== undefined) {
        // Frontend mengirim label ("Check In"), code ("check_in"), atau id (0). Normalisasi ke id.
        let sr: any = status_reservation;
        if (typeof sr === 'object' && sr !== null) sr = sr.value ?? sr.id;
        if (typeof sr === 'string' && !/^\d+$/.test(sr)) {
          const lower = sr.toLowerCase();
          const found = Object.values(STATUS_RESERVATION).find((s: any) =>
            s.code.toLowerCase() === lower || s.name.toLowerCase() === lower || lower.includes(s.name.toLowerCase())
          );
          sr = found ? found.id : (lower === 'request cancel' ? STATUS_RESERVATION.reservation.id : undefined);
        }
        if (sr !== undefined) updateData.status_reservation = Number(sr);
      }
      if (dept_branch !== undefined) updateData.dept_branch = dept_branch;

      await prisma.folios.update({ where: { id }, data: updateData });

      // Update reservation items if provided
      if (reservation_list && reservation_list.length > 0 && existing.type_reservation !== 'git') {
        // Laravel Folio.php:2524-2530 / 2639-2642 / 2656-2664 — nights already
        // posted by the night audit are NEVER deleted or overwritten; only
        // unposted nights outside the new range are removed.
        const property = await prisma.properties.findUnique({ where: { id: existing.property_id }, select: { is_tax: true } });
        const isTaxUpd = (property as any)?.is_tax === 1;
        const updRateIds = [...new Set(reservation_list.map((i: any) => String(i.rate_id)).filter((r: string) => r && r !== '0'))] as string[];
        const updRateRows = updRateIds.length
          ? await prisma.rates.findMany({
              where: { id: { in: updRateIds.map((r) => BigInt(r)) } },
              select: { id: true, code_post_id: true, name: true },
            })
          : [];
        const updCpIds = [...new Set(updRateRows.map((r) => r.code_post_id).filter(Boolean))] as bigint[];
        const updCpRows = updCpIds.length ? await prisma.code_posts.findMany({ where: { id: { in: updCpIds } } }) : [];
        const updCpById = new Map<number, any>(updCpRows.map((c) => [Number(c.id), c]));

        const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10);
        const oldRows = await prisma.reservations.findMany({ where: { folio_id: id, deleted_at: null } });

        for (const item of reservation_list) {
          const itemCheckIn = new Date(item.check_in_date);
          let itemCheckOut = new Date(item.check_out_date);
          let nights = Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / (1000 * 60 * 60 * 24));
          const itemIsDayUse = String(existing.type_reservation ?? '').toLowerCase() === 'day-use';
          if (nights < 1 || itemIsDayUse) {
            itemCheckOut = new Date(itemCheckIn);
            itemCheckOut.setDate(itemCheckOut.getDate() + 1);
            nights = Math.max(nights, 1);
          }
          const getNightUpd = itemIsDayUse ? 0 : nights;
          const rateIdUpd = item.rate_id && String(item.rate_id) !== '0' ? BigInt(item.rate_id) : null;
          const cpRow = rateIdUpd ? updCpById.get(Number(updRateRows.find((r) => Number(r.id) === Number(rateIdUpd))?.code_post_id ?? -1)) ?? null : null;

          for (let i = 0; i < nights; i++) {
            const nightDate = new Date(itemCheckIn);
            nightDate.setDate(nightDate.getDate() + i);
            const key = dayKey(nightDate);

            const postedRow = oldRows.find((r) => r.is_posting === 1 && r.date && dayKey(r.date) === key && !r.deleted_at);
            if (postedRow) continue; // never touch audited nights

            const pricing = await priceNight({
              prisma,
              rateId: rateIdUpd,
              roomTypeId: item.room_type_id ? BigInt(item.room_type_id) : (item.room_type_id_next ? BigInt(item.room_type_id_next) : null),
              night: nightDate,
              getNight: getNightUpd,
              adult: Number(item.adult || 1),
              child: Number(item.child || 0),
              quantity: itemIsDayUse ? Number(item.quantity || 1) : 1,
              isTax: isTaxUpd,
              rateCodePost: cpRow,
              promos: [],
            });

            const rowData: any = {
              rate_id: rateIdUpd,
              rate_name: rateIdUpd ? updRateRows.find((r) => Number(r.id) === Number(rateIdUpd))?.name ?? null : null,
              room_type_id: item.room_type_id ? BigInt(item.room_type_id) : null,
              room_id: item.room_id ? BigInt(item.room_id) : null,
              room_type_id_next: item.room_type_id_next ? BigInt(item.room_type_id_next) : null,
              room_id_next: item.room_id_next ? BigInt(item.room_id_next) : null,
              adult: item.adult || 1,
              child: item.child || 0,
              add_bed: item.add_bed || 0,
              check_in_date: itemCheckIn,
              check_out_date: itemCheckOut,
              date: nightDate,
              status_reservation: updateData.status_reservation || existing.status_reservation,
              status: STATUS_ACTIVE,
              night: nights,
              amount: pricing.amount,
              amountt: pricing.amount,
              total: pricing.total,
              service_charge: pricing.service_charge,
              pb1: pricing.pb1,
              tax3: pricing.tax3,
              eta: parseTimeLike(item.eta, nightDate),
              etd: parseTimeLike(item.etd, nightDate),
              is_24_hour: item.is_24_hour === true || Number(item.is_24_hour) === 1 ? 1 : 0,
              package_id: item.package_id ? BigInt(item.package_id) : null,
              quantity: Number(item.quantity ?? 1),
              quantity_extra_day_use: Number(item.quantity_extra_day_use ?? 0),
              is_extra_day_use: item.is_extra_day_use === true || Number(item.is_extra_day_use) === 1 ? 1 : 0,
              data: JSON.stringify({
                rate_price: pricing.rate_price,
                service: pricing.service_charge,
                pb1: pricing.pb1,
                tax3: pricing.tax3,
                total: pricing.total,
              }),
              updated_by: userId,
              updated_at: new Date(),
            };

            const existingRow = oldRows.find((r) => (!r.is_posting || r.is_posting === 0) && r.date && dayKey(r.date) === key && !r.deleted_at);
            if (existingRow) {
              await prisma.reservations.update({ where: { id: existingRow.id }, data: rowData });
            } else {
              await prisma.reservations.create({
                data: { ...rowData, property_id: existing.property_id, folio_id: id, created_by: userId } as any,
              });
            }
          }
        }

        // Remove unposted rows that fell outside the new stay window
        const newNightKeys = new Set<string>();
        for (const item of reservation_list) {
          const ciI = new Date(item.check_in_date);
          const coI = new Date(item.check_out_date);
          const n = Math.max(1, Math.ceil((coI.getTime() - ciI.getTime()) / 86400000));
          for (let i = 0; i < n; i++) {
            const d = new Date(ciI);
            d.setDate(d.getDate() + i);
            newNightKeys.add(dayKey(d));
          }
        }
        for (const row of oldRows) {
          if (row.deleted_at || (row.is_posting ?? 0) === 1) continue;
          if (row.date && !newNightKeys.has(dayKey(row.date))) {
            await prisma.reservations.update({
              where: { id: row.id },
              data: { deleted_at: new Date(), deleted_by: userId },
            });
          }
        }
      }

      // Room-status fixup on checked-in folios after dates changed
      // (Laravel Folio.php:2671-2688): due_out → occupied when extended past
      // business date; occupied → due_out when checkout lands on business date.
      if ((updateData.status_reservation ?? existing.status_reservation) === STATUS_RESERVATION.check_in.id) {
        const lastResv = await prisma.reservations.findFirst({
          where: { folio_id: id, deleted_at: null },
          orderBy: { date: 'desc' },
        });
        if (lastResv?.room_id) {
          const room = await prisma.rooms.findUnique({ where: { id: lastResv.room_id } });
          const bDateStr = await AuthController.getBusinessDate(existing.property_id ?? null);
          const coStr = existing.check_out_date ? dayKeyF(existing.check_out_date) : null;
          if (room && bDateStr && coStr) {
            if (room.room_status === ROOM_STATUSES.due_out.id && coStr > bDateStr) {
              await prisma.rooms.update({ where: { id: room.id }, data: { room_status: ROOM_STATUSES.occupied.id, updated_at: new Date() } });
            } else if (room.room_status === ROOM_STATUSES.occupied.id && coStr === bDateStr) {
              await prisma.rooms.update({ where: { id: room.id }, data: { room_status: ROOM_STATUSES.due_out.id, updated_at: new Date() } });
            }
          }
        }
      }

      const updated = await prisma.folios.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success', 200, { permission: { view: true }, search_data: { statuses: ['reservation', 'pending', 'check_in', 'check_out', 'cancel_reservation'] } } as any);
    } catch (err: any) {
      console.error('Reservation update error:', err);
      error(res, 'Failed to update reservation', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // DELETE /api/reservations/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const folio = await prisma.folios.findUnique({ where: { id } });
      if (!folio) {
        notFound(res, 'Not Found');
        return;
      }

      await prisma.folios.update({
        where: { id },
        data: { deleted_at: new Date(), status: 0 },
      });

      // Also soft-delete child folios (GIT)
      await prisma.folios.updateMany({
        where: { parent: id, deleted_at: null },
        data: { deleted_at: new Date(), status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Reservation destroy error:', err);
      error(res, 'Failed to delete reservation', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/reservations/:id/restore
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const folio = await prisma.folios.findUnique({ where: { id } });
      if (!folio) {
        notFound(res, 'Not Found');
        return;
      }

      await prisma.folios.update({
        where: { id },
        data: { deleted_at: null, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Reservation restore error:', err);
      error(res, 'Failed to restore reservation', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations/calendar
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async calendar(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const start = req.query.start as string;
      const end = req.query.end as string;

      const where: any = {
        deleted_at: null,
        property_id: propertyId!,
        status_reservation: { notIn: [STATUS_RESERVATION.cancel_reservation.id] },
      };

      if (start && end) {
        where.check_in_date = { lte: new Date(end) };
        where.check_out_date = { gte: new Date(start) };
      }

      const folios = await prisma.folios.findMany({
        where,
        include: {
          reservations: {
            where: { deleted_at: null },
            select: { room_name: true, room_type_name: true, rate_name: true, date: true },
          },
        },
        orderBy: { check_in_date: 'asc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation calendar error:', err);
      error(res, 'Failed to fetch calendar', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations/arrivals
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async arrivals(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          property_id: propertyId!,
          is_pos_trx: false,
          status_reservation: STATUS_RESERVATION.reservation.id,
          check_in_date: { gte: today },
        },
        include: {
          reservations: { where: { deleted_at: null }, select: { room_name: true, room_type_name: true, rate_name: true } },
        },
        orderBy: { check_in_date: 'asc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation arrivals error:', err);
      error(res, 'Failed to fetch arrivals', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations/departures
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async departures(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          property_id: propertyId!,
          is_pos_trx: false,
          status_reservation: STATUS_RESERVATION.check_in.id,
          check_out_date: { gte: today },
        },
        include: {
          reservations: { where: { deleted_at: null }, select: { room_name: true, room_type_name: true, rate_name: true } },
        },
        orderBy: { check_out_date: 'asc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation departures error:', err);
      error(res, 'Failed to fetch departures', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations/in-house
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async inHouse(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          property_id: propertyId!,
          is_pos_trx: false,
          status_reservation: STATUS_RESERVATION.check_in.id,
        },
        include: {
          reservations: { where: { deleted_at: null }, select: { room_name: true, room_type_name: true, rate_name: true } },
        },
        orderBy: { check_in_date: 'desc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation in-house error:', err);
      error(res, 'Failed to fetch in-house reservations', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/reservations/pending
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async pending(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          property_id: propertyId!,
          is_pos_trx: false,
          status_reservation: STATUS_RESERVATION.pending.id,
        },
        include: {
          reservations: { where: { deleted_at: null }, select: { room_name: true, room_type_name: true, rate_name: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      success(res, bigintToNumber(folios), 'Success');
    } catch (err: any) {
      console.error('Reservation pending error:', err);
      error(res, 'Failed to fetch pending reservations', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/reservations/on-check
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async onCheck(req: Request, res: Response): Promise<void> {
    try {
      const { room_reservation_list, check_in_date, check_out_date, rate_id } = req.body;

      if (!room_reservation_list || !check_in_date || !check_out_date) {
        badRequest(res, 'room_reservation_list, check_in_date, and check_out_date are required');
        return;
      }

      let allAvailable = true;
      const roomIds: Record<number, number[]> = {};

      for (const item of room_reservation_list) {
        const roomTypeId = BigInt(item.id);

        // Find available rooms of this type for the date range
        const reservedRoomIds = await prisma.reservations.findMany({
          where: {
            room_type_id: roomTypeId,
            date: { gte: new Date(check_in_date), lt: new Date(check_out_date) },
            deleted_at: null,
            folios: {
              deleted_at: null,
              status_reservation: { in: [STATUS_RESERVATION.reservation.id, STATUS_RESERVATION.check_in.id] },
            },
          },
          select: { room_id: true },
          distinct: ['room_id'],
        });

        const reservedIds = reservedRoomIds
          .filter((r) => r.room_id !== null)
          .map((r) => Number(r.room_id));

        const allRooms = await prisma.rooms.findMany({
          where: {
            room_type_id: roomTypeId,
            deleted_at: null,
            status: STATUS_ACTIVE,
            is_physical: true,
          },
          select: { id: true },
        });

        const availableRoomIds = allRooms
          .filter((r) => !reservedIds.includes(Number(r.id)))
          .map((r) => Number(r.id));

        roomIds[Number(item.id)] = availableRoomIds;

        if (availableRoomIds.length < (item.qty || 1)) {
          allAvailable = false;
        }
      }

      success(res, { check: allAvailable, roomIds }, 'Success');
    } catch (err: any) {
      console.error('Reservation onCheck error:', err);
      error(res, 'Failed to check availability', 500);
    }
  }

  // PUT /reservation/data/{folio} — Laravel ReservationController@storeData (:2225-2272)
  static async storeData(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const folio = await prisma.folios.findUnique({ where: { id: BigInt(idParam) } });
      if (!folio || folio.deleted_at) { notFound(res, 'Not Found'); return; }
      const body = req.body || {};
      const type = String(body.type ?? '');
      if (!type) { badRequest(res, 'The type field is required.'); return; }

      const isParentGit = String(folio.type_reservation ?? '').toLowerCase() === 'git' && Number(folio.parent ?? 0) === 0;
      if (isParentGit && type === 'assign_room') {
        badRequest(res, 'Parent GIT cannot be Assign Room');
        return;
      }

      if (type === 'remark') {
        await prisma.folios.update({ where: { id: folio.id }, data: { remark: body.remark ?? null, updated_at: new Date() } });
      } else if (type === 'message') {
        // folios.message column doesn't exist — persist into data JSON like remark flows
        const dataJson = folio.data ? safeParseFolioData(folio.data) : {};
        await prisma.folios.update({ where: { id: folio.id }, data: { data: JSON.stringify({ ...dataJson, message: body.message ?? null }), updated_at: new Date() } });
      } else if (type === 'assign_room') {
        await prisma.reservations.updateMany({
          where: { folio_id: folio.id, deleted_at: null },
          data: { room_id_next: body.room_id_next ? BigInt(body.room_id_next) : null },
        });
      }
      await prisma.folios.update({ where: { id: folio.id }, data: { updated_at: new Date() } });
      const refreshed = await prisma.folios.findUnique({ where: { id: folio.id } });
      success(res, bigintToNumber(refreshed), 'Success', 200);
    } catch (err: any) { console.error('storeData error:', err); error(res, 'Failed to store folio data', 500); }
  }

  // PUT /reservation/changeRoom/{folio} — Laravel ReservationController@ChangeRoom (:1954-2162)
  static async changeRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const folioId = BigInt(idParam);
      const list: any[] = Array.isArray(req.body?.reservation_list) ? req.body.reservation_list : [];
      if (list.length === 0) { badRequest(res, 'The reservation list field is required.'); return; }

      for (const item of list) {
        if (!item.check_in_date || !item.check_out_date) { badRequest(res, 'The check in date field is required.'); return; }
      }

      const folioResvs = await prisma.reservations.findMany({
        where: { folio_id: folioId, deleted_at: null },
        include: { rates: true },
      });

      let sumPriceAll = 0; let gstAll = 0; let serviceAll = 0;
      const pricePerRateAll: any[] = [];

      for (const value of list) {
        const matched = folioResvs.filter((r) => r.check_in_date != null && r.check_in_date >= new Date(value.check_in_date) && r.check_in_date <= new Date(value.check_out_date));
        const first = matched[0];
        if (!first) continue;
        const getNight = Math.max(1, Math.ceil((new Date(value.check_out_date).getTime() - new Date(value.check_in_date).getTime()) / 86400000));
        const adult = Number(first.adult || 1);
        const child = Number(first.child || 0);

        let sumPriceR = 0; let gstR = 0; let serviceR = 0;
        const pricePerRateR: any[] = [];
        for (let i = 0; i < getNight; i++) {
          const night = new Date(new Date(value.check_in_date).getTime() + i * 86400000);
          const rr = await prisma.rate_rates.findFirst({
            where: { rate_id: first.rate_id ?? undefined, room_type_id: value.room_type_id ? BigInt(value.room_type_id) : undefined, date: night },
          });
          if (!rr) continue;
          let perRate = 0;
          // Laravel quirk (:2009-2029): uses one_adult/two_adult/extra_adult + `$rate->child`
          if (adult === 1) perRate += Number(rr.one_adult ?? 0);
          if (adult > 1) perRate += Number(rr.two_adult ?? 0);
          if (adult > 2) perRate += (adult - 2) * Number(rr.extra_adult ?? 0);
          if (child > 0) perRate += child * Number((rr as any).child ?? (rr as any).extra_child ?? 0);
          sumPriceR += perRate;
          pricePerRateR.push({ date: rr.date, charge: perRate });
        }

        const rate = first.rate_id ? await prisma.rates.findUnique({ where: { id: first.rate_id } }) : null;
        const codePost = rate?.code_post_id ? await prisma.code_posts.findUnique({ where: { id: BigInt(rate.code_post_id) } }) : null;
        if (codePost) {
          if (codePost.local_tax) gstR += sumPriceR * (Number(codePost.local_tax_percentage ?? 0) / 100);
          if (codePost.service_charge) serviceR += sumPriceR * (Number(codePost.service_charge_percentage ?? 0) / 100);
        }

        const fmt = (n: number) => n.toFixed(2);
        const chargeReservation: any[] = [
          { label: 'Room Charge', value: fmt(sumPriceR) },
          { label: `GST${codePost?.local_tax_percentage ?? ''}%`, value: fmt(gstR) },
          { label: `Service Charge${codePost?.service_charge_percentage ?? ''}%`, value: fmt(serviceR) },
        ];
        const totalReservation = sumPriceR + gstR + serviceR;
        chargeReservation.push({ label: 'Total Room Charge', value: fmt(totalReservation) });

        for (const values of matched) {
          await prisma.reservations.update({
            where: { id: values.id },
            data: {
              room_type_id: value.room_type_id ? BigInt(value.room_type_id) : values.room_type_id,
              room_id: value.room_id ? BigInt(value.room_id) : values.room_id,
              room_type_id_next: value.room_type_id_next ? BigInt(value.room_type_id_next) : null,
              room_id_next: value.room_id_next ? BigInt(value.room_id_next) : null,
              data: JSON.stringify({ date: pricePerRateR, charge: chargeReservation }),
              updated_at: new Date(),
            },
          });
        }

        sumPriceAll += sumPriceR; gstAll += gstR; serviceAll += serviceR;
        pricePerRateAll.push(...pricePerRateR);
      }

      const fmt2 = (n: number) => n.toFixed(2);
      const lastCodePostPct = { lt: '', sc: '' };
      const charge: any[] = [
        { label: 'Room Charge', value: fmt2(sumPriceAll) },
        { label: `GST${lastCodePostPct.lt}%`, value: fmt2(gstAll) },
        { label: `Service Charge${lastCodePostPct.sc}%`, value: fmt2(serviceAll) },
      ];
      const total = sumPriceAll + gstAll + serviceAll;
      charge.push({ label: 'Total Room Charge', value: fmt2(total) });

      const folioRow = await prisma.folios.findUnique({ where: { id: folioId } });
      const folioData = folioRow?.data ? safeParseFolioData(folioRow.data) : {};
      await prisma.folios.update({
        where: { id: folioId },
        data: { data: JSON.stringify({ ...folioData, date: pricePerRateAll, charge }), updated_at: new Date() },
      });

      const refreshed = await prisma.folios.findUnique({ where: { id: folioId } });
      success(res, bigintToNumber(refreshed), 'Success', 200);
    } catch (err: any) { console.error('ChangeRoom error:', err); error(res, err?.message || 'Failed to change room', 500); }
  }

  // PATCH /reservation-item/:id/restore — ReservationItemController@restore (:1195-1210)
  static async reservationItemRestore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.reservations.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.reservations.update({ where: { id: row.id }, data: { deleted_at: null, status: 0, updated_at: new Date() } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('reservation item restore error:', err); error(res, 'Failed to restore reservation item', 500); }
  }

  // DELETE /reservation-item/:id/delete — force delete (:1174-1188)
  static async reservationItemDeleteForce(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.reservations.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.reservations.delete({ where: { id: row.id } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('reservation item force-delete error:', err); error(res, 'Failed to delete reservation item', 500); }
  }

  // DELETE /reservation-item/:id — soft delete + inactive (:1156-1172)
  static async reservationItemDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.reservations.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.reservations.update({ where: { id: row.id }, data: { deleted_at: new Date(), status: 0, updated_at: new Date() } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('reservation item destroy error:', err); error(res, 'Failed to delete reservation item', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/reservations/:id/unassign-room
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async unassignRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const folio = await prisma.folios.findUnique({ where: { id } });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // Set room_id to null on all reservations for this folio
      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { room_id: null, updated_at: new Date(), updated_by: userId },
      });

      const updatedFolio = await prisma.folios.findUnique({
        where: { id },
        include: { reservations: { where: { deleted_at: null } } },
      });

      success(res, bigintToNumber(updatedFolio), 'Success');
    } catch (err: any) {
      console.error('Reservation unassign room error:', err);
      error(res, 'Failed to unassign room', 400);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/reservations/:id/replicate
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async replicate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;
      const propertyId = req.user?.lastProperty;

      const existing = await prisma.folios.findUnique({
        where: { id },
        include: { reservations: { where: { deleted_at: null } } },
      });

      if (!existing || existing.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // Generate new folio number
      const lastFolio = await prisma.folios.findFirst({
        where: { property_id: propertyId!, deleted_at: null },
        orderBy: { id: 'desc' },
        select: { folio_number: true },
      });

      let nextFolioNum = 1;
      if (lastFolio?.folio_number) {
        const match = lastFolio.folio_number.match(/(\d+)$/);
        if (match) nextFolioNum = parseInt(match[1]) + 1;
      }
      const newFolioNumber = String(nextFolioNum).padStart(7, '0');

      // Create new folio from existing
      const newFolio = await prisma.folios.create({
        data: {
          folio_number: newFolioNumber,
          parent: BigInt(0),
          property_id: existing.property_id,
          type_reservation: existing.type_reservation,
          guest_profile_id: existing.guest_profile_id,
          company_profile_id: existing.company_profile_id,
          company_name: existing.company_name,
          first_name: existing.first_name,
          last_name: existing.last_name,
          title: existing.title,
          telp: existing.telp,
          email: existing.email,
          remark: existing.remark,
          remark_ins: existing.remark_ins,
          booking_agent_id: existing.booking_agent_id,
          contact_person_id: existing.contact_person_id,
          check_in_date: existing.check_in_date,
          check_out_date: existing.check_out_date,
          res_date: new Date(),
          res_time: new Date().toISOString().substring(11, 16),
          status: STATUS_ACTIVE,
          status_reservation: STATUS_RESERVATION.reservation.id,
          is_compliment_tour_leader: false,
          gender: existing.gender,
          nationality_id: existing.nationality_id,
          created_by: userId,
        },
      });

      // Replicate reservation items
      for (const resv of existing.reservations) {
        await prisma.reservations.create({
          data: {
            property_id: resv.property_id,
            folio_id: newFolio.id,
            rate_id: resv.rate_id,
            room_type_id: resv.room_type_id,
            room_type_name: resv.room_type_name,
            adult: resv.adult,
            child: resv.child,
            add_bed: resv.add_bed,
            check_in_date: resv.check_in_date,
            check_out_date: resv.check_out_date,
            date: resv.date,
            eta: resv.eta,
            etd: resv.etd,
            status_reservation: STATUS_RESERVATION.reservation.id,
            status: STATUS_ACTIVE,
            night: resv.night,
            amount: resv.amount,
            amountt: resv.amountt,
            total: resv.total,
            service_charge: resv.service_charge,
            pb1: resv.pb1,
            tax3: resv.tax3,
            created_by: userId,
          },
        });
      }

      success(res, bigintToNumber(newFolio), 'Success');
    } catch (err: any) {
      console.error('Reservation replicate error:', err);
      error(res, 'Failed to replicate reservation', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/reservations/update-bulk
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async updateBulk(req: Request, res: Response): Promise<void> {
    try {
      const { status_reservation, folio_ids, remark, reason } = req.body;

      if (!status_reservation || !folio_ids?.length) {
        badRequest(res, 'status_reservation and folio_ids are required');
        return;
      }

      // Resolve status code
      let statusId: number;
      switch (status_reservation) {
        case 'check_in': statusId = STATUS_RESERVATION.check_in.id; break;
        case 'check_out': statusId = STATUS_RESERVATION.check_out.id; break;
        case 'cancel_reservation': statusId = STATUS_RESERVATION.cancel_reservation.id; break;
        case 'reservation': statusId = STATUS_RESERVATION.reservation.id; break;
        case 'pending': statusId = STATUS_RESERVATION.pending.id; break;
        default:
          badRequest(res, 'Invalid status_reservation');
          return;
      }

      const ids = folio_ids.map((id: any) => BigInt(id));

      await prisma.folios.updateMany({
        where: { id: { in: ids } },
        data: { status_reservation: statusId, updated_at: new Date(), remark: remark || undefined },
      });

      await prisma.reservations.updateMany({
        where: { folio_id: { in: ids }, deleted_at: null },
        data: { status_reservation: statusId },
      });

      success(res, { updated: ids.length, status_reservation: statusId }, 'Success');
    } catch (err: any) {
      console.error('Reservation updateBulk error:', err);
      error(res, 'Failed to bulk update reservations', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/reservations/:id/assign-room
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async assignRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;
      const { room_id, room_type_id } = req.body;

      const folio = await prisma.folios.findUnique({ where: { id } });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // Update reservations with room assignment
      const updateData: any = {
        updated_at: new Date(),
        updated_by: userId,
      };
      if (room_id) updateData.room_id = BigInt(room_id);
      if (room_type_id) updateData.room_type_id = BigInt(room_type_id);

      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: updateData,
      });

      const updatedFolio = await prisma.folios.findUnique({
        where: { id },
        include: { reservations: { where: { deleted_at: null } } },
      });

      // Room assignment changes availability — Laravel ReservationItemController
      // dispatches SyncStaahRoomAvailability after assign/move (:681, :857).
      enqueueJob('sync-staah-room-availability', {
        propertyId: Number((updatedFolio as any)?.property_id ?? 0),
        dateFrom: (updatedFolio as any)?.check_in_date ? formatDate(new Date((updatedFolio as any).check_in_date)) : undefined,
        dateTo: (updatedFolio as any)?.check_out_date ? formatDate(new Date((updatedFolio as any).check_out_date)) : undefined,
      });
      success(res, bigintToNumber(updatedFolio), 'Success');
    } catch (err: any) {
      console.error('Reservation assign room error:', err);
      error(res, 'Failed to assign room', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Reservation Items (sub-resource)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // GET /api/reservations/:folioId/items
  static async listItems(req: Request, res: Response): Promise<void> {
    try {
      const folioIdParam = Array.isArray(req.params.folioId) ? req.params.folioId[0] : req.params.folioId;
      const folioId = BigInt(folioIdParam);

      const items = await prisma.reservation_items.findMany({
        where: { reservation_id: folioId, deleted_at: null },
        orderBy: { date: 'asc' },
      });

      success(res, bigintToNumber(items), 'Success');
    } catch (err: any) {
      console.error('Reservation items list error:', err);
      error(res, 'Failed to fetch reservation items', 500);
    }
  }

  // POST /api/reservations/:folioId/items
  static async addItem(req: Request, res: Response): Promise<void> {
    try {
      const folioIdParam = Array.isArray(req.params.folioId) ? req.params.folioId[0] : req.params.folioId;
      const folioId = BigInt(folioIdParam);
      const userId = req.user?.id;
      const propertyId = req.user?.lastProperty;
      const { type, date, code_post_id, code_item_id, description, amount, total, type_amount } = req.body;

      const item = await prisma.reservation_items.create({
        data: {
          property_id: propertyId!,
          reservation_id: folioId,
          type: type || null,
          date: new Date(date),
          code_post_id: code_post_id ? BigInt(code_post_id) : null,
          code_item_id: code_item_id ? BigInt(code_item_id) : null,
          description: description || null,
          amount: amount || 0,
          total: total || 0,
          type_amount: type_amount || 'PLUS',
          status: STATUS_ACTIVE,
          created_by: userId,
        },
      });

      success(res, bigintToNumber(item), 'Success', 201);
    } catch (err: any) {
      console.error('Reservation item add error:', err);
      error(res, 'Failed to add reservation item', 500);
    }
  }

  // PUT /api/reservations/:folioId/items/:itemId
  static async updateItem(req: Request, res: Response): Promise<void> {
    try {
      const itemIdParam = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
      const itemId = BigInt(itemIdParam);
      const userId = req.user?.id;
      const { type, date, code_post_id, code_item_id, description, amount, total, type_amount } = req.body;

      const existing = await prisma.reservation_items.findUnique({ where: { id: itemId } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Item not found');
        return;
      }

      const updateData: any = { updated_at: new Date(), updated_by: userId };
      if (type !== undefined) updateData.type = type;
      if (date !== undefined) updateData.date = new Date(date);
      if (code_post_id !== undefined) updateData.code_post_id = code_post_id ? BigInt(code_post_id) : null;
      if (code_item_id !== undefined) updateData.code_item_id = code_item_id ? BigInt(code_item_id) : null;
      if (description !== undefined) updateData.description = description;
      if (amount !== undefined) updateData.amount = amount;
      if (total !== undefined) updateData.total = total;
      if (type_amount !== undefined) updateData.type_amount = type_amount;

      await prisma.reservation_items.update({ where: { id: itemId }, data: updateData });

      const updated = await prisma.reservation_items.findUnique({ where: { id: itemId } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Reservation item update error:', err);
      error(res, 'Failed to update reservation item', 500);
    }
  }

  // DELETE /api/reservations/:folioId/items/:itemId
  static async deleteItem(req: Request, res: Response): Promise<void> {
    try {
      const itemIdParam = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
      const itemId = BigInt(itemIdParam);
      const userId = req.user?.id;

      const existing = await prisma.reservation_items.findUnique({ where: { id: itemId } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Item not found');
        return;
      }

      await prisma.reservation_items.update({
        where: { id: itemId },
        data: { deleted_at: new Date() },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Reservation item delete error:', err);
      error(res, 'Failed to delete reservation item', 500);
    }
  }

  // ── Laravel ReservationItemController::updateVR (:705-782) ──
  // Update VR folio dates/guest + repricing via saveReservation engine.
  static async updateVR(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const { check_in_date, check_out_date, guest_profile_id } = req.body;
      if (!check_in_date || !check_out_date || !guest_profile_id) {
        badRequest(res, 'check_in_date, check_out_date and guest_profile_id are required');
        return;
      }

      const folio: any = await prisma.folios.findUnique({ where: { id } });
      if (!folio || folio.deleted_at) { notFound(res, 'Folio not found'); return; }

      const bussinesDate = await AuthController.getBusinessDate(folio.property_id ?? null);
      await prisma.folios.update({
        where: { id },
        data: {
          check_in_date: new Date(check_in_date),
          check_out_date: new Date(check_out_date),
          guest_profile_id: BigInt(guest_profile_id),
          updated_at: new Date(),
          updated_by: req.user?.id,
        },
      });

      // Reprice all reservation nights using the pricing engine.
      const resvs = await prisma.reservations.findMany({ where: { folio_id: id, deleted_at: null }, orderBy: { date: 'asc' } });
      if (resvs.length > 0) {
        const firstResv = resvs[0];
        const getNight = Math.max(1, Math.ceil((new Date(check_out_date).getTime() - new Date(check_in_date).getTime()) / 86400000));
        let cpRow: any = null;
        if (firstResv.rate_id) {
          const rate: any = await prisma.rates.findUnique({ where: { id: firstResv.rate_id }, select: { code_post_id: true } });
          if (rate?.code_post_id) cpRow = await prisma.code_posts.findUnique({ where: { id: BigInt(rate.code_post_id) } });
        }
        const property: any = await prisma.properties.findUnique({ where: { id: folio.property_id }, select: { is_tax: true } });

        // Delete old rows
        await prisma.reservations.deleteMany({ where: { folio_id: id, deleted_at: null } });

        for (let i = 0; i < getNight; i++) {
          const nightDate = new Date(`${bussinesDate || check_in_date}T00:00:00`);
          nightDate.setDate(nightDate.getDate() + i);
          const pricing = await priceNight({
            prisma,
            rateId: firstResv.rate_id,
            roomTypeId: firstResv.room_type_id,
            night: nightDate,
            getNight,
            adult: Number(firstResv.adult ?? 1),
            child: Number(firstResv.child ?? 0),
            quantity: 1,
            isTax: property?.is_tax === 1,
            rateCodePost: cpRow,
            promos: [],
          });
          await prisma.reservations.create({
            data: {
              property_id: folio.property_id,
              folio_id: id,
              rate_id: firstResv.rate_id,
              room_type_id: firstResv.room_type_id,
              room_id: firstResv.room_id,
              adult: Number(firstResv.adult ?? 1),
              child: Number(firstResv.child ?? 0),
              add_bed: firstResv.add_bed ?? 0,
              check_in_date: new Date(check_in_date),
              check_out_date: new Date(check_out_date),
              date: nightDate,
              night: getNight,
              amount: pricing.amount,
              total: pricing.total,
              service_charge: pricing.service_charge,
              pb1: pricing.pb1,
              tax3: pricing.tax3,
              status_reservation: STATUS_RESERVATION.reservation.id,
              status: 1,
              created_by: req.user?.id,
            },
          });
        }
      }

      enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
      success(res, bigintToNumber(folio), 'Success');
    } catch (err: any) { console.error('updateVR error:', err); error(res, 'Failed to update VR', 500); }
  }

  // ── Laravel ReservationItemController::moveReservation (:880-1009) ──
  // Shift reservation item dates by a delta (from_date → to_date).
  static async moveReservationItems(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const { from_date, to_date } = req.body;
      if (!from_date || !to_date) { badRequest(res, 'from_date and to_date are required'); return; }

      const fromDate = new Date(`${from_date}T00:00:00Z`);
      const toDate = new Date(`${to_date}T00:00:00Z`);
      const shiftDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
      if (shiftDays === 0) { success(res, null, 'No shift needed'); return; }

      const reservation = await prisma.reservations.findUnique({ where: { id }, include: { folios: true } });
      if (!reservation) { notFound(res, 'Reservation not found'); return; }

      const folio = reservation.folios as any;
      if (String(folio?.type_reservation ?? '').toLowerCase() === 'git' && Number(folio?.parent) === 0) {
        badRequest(res, 'Action not allowed'); return;
      }

      // Move ALL non-posted items for this folio+room_type from the from-date onward
      const itemsToMove = await prisma.reservations.findMany({
        where: {
          folio_id: BigInt(folio.id),
          room_type_id: reservation.room_type_id,
          is_posting: 0,
          deleted_at: null,
          date: { gte: fromDate },
        },
      });
      for (const item of itemsToMove) {
        await prisma.reservations.update({
          where: { id: item.id },
          data: {
            date: new Date(item.date!.getTime() + shiftDays * 86400000),
            check_in_date: item.check_in_date ? new Date(item.check_in_date.getTime() + shiftDays * 86400000) : null,
            check_out_date: item.check_out_date ? new Date(item.check_out_date.getTime() + shiftDays * 86400000) : null,
            updated_at: new Date(),
            updated_by: req.user?.id,
          },
        });
      }
      // Also shift folio dates
      if (folio.check_in_date) await prisma.folios.update({ where: { id: BigInt(folio.id) }, data: { check_in_date: new Date(new Date(folio.check_in_date).getTime() + shiftDays * 86400000), check_out_date: folio.check_out_date ? new Date(new Date(folio.check_out_date).getTime() + shiftDays * 86400000) : null, updated_at: new Date() } });

      enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
      success(res, { moved: itemsToMove.length }, 'Success');
    } catch (err: any) { console.error('moveReservation error:', err); error(res, 'Failed to move reservation', 500); }
  }

  private static bn(val: any): any {
    if (typeof val === 'bigint') return Number(val);
    if (Array.isArray(val)) return val.map((v) => reservationBn(v));
    if (val && typeof val === 'object') { const o: any = {}; for (const [k, v] of Object.entries(val)) o[k] = reservationBn(v); return o; }
    return val;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/code-item (additional item page)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ———— GET /cms/reservation/code-item (additional item page) - filter by folio's rate
  // ——————————————————————————————————————————————————————————————————————————————
    // GET /cms/reservation/code-item (additional item page)
  // ———— GET /cms/reservation/code-item (additional item page) - filter by folio's rate
  // ——————————————————————————————————————————————————————————————————————————————
  static async codeItemList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const folioIdRaw = String(req.query.folio_id ?? '');

      let where: any = { deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      // Get folio's rate to filter code items (Laravel parity via model_has_code_items)
      let rateId: bigint | null = null;
      if (folioIdRaw && /^\d+$/.test(folioIdRaw)) {
        const folio = await prisma.folios.findUnique({
          where: { id: BigInt(folioIdRaw) },
          include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1 } },
        });
        if (folio?.reservations?.[0]?.rate_id) {
          rateId = folio.reservations[0].rate_id;
        }
      }

// Filter code_items by rate via model_has_code_items (Laravel parity)
      if (rateId) {
        const codeItemIds = await prisma.$queryRaw<{ code_item_id: bigint }[]>(
          Prisma.sql`SELECT DISTINCT code_item_id FROM model_has_code_items WHERE model_type = ${'App\\Models\\Rate'} AND model_id = ${rateId} AND code_item_id IS NOT NULL`
        );
        const ids = codeItemIds.map((r) => r.code_item_id);
        if (ids.length > 0) {
          where.id = { in: ids };
        } else {
          where.id = -1;
        }
      }

      const [data, total] = await Promise.all([
        prisma.code_items.findMany({
          where,
          include: { code_posts: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.code_items.count({ where }),
      ]);
      const table = [
        { label: 'Code', key: 'code', type: 'none', is_search: false },
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Sales', key: 'sales', type: 'number', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
      ];
      success(res, reservationBn(data), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Code item list error:', err); error(res, 'Failed to list code items', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/inclusive
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ———— GET /cms/reservation/inclusive - filter by folio's rate (Laravel parity)
  // ——————————————————————————————————————————————————————————————————————————————
  static async inclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const folioIdRaw = String(req.query.folio_id ?? req.query.subfolio_id ?? '');
      const search = req.query.search as string;

      let where: any = { deleted_at: null };
      if (search) where.description = { contains: search, mode: 'insensitive' };

      // Get folio's rate to filter inclusives (Laravel parity)
      let rateId: bigint | null = null;
      if (folioIdRaw && /^\d+$/.test(folioIdRaw)) {
        const folio = await prisma.folios.findUnique({
          where: { id: BigInt(folioIdRaw) },
          include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' }, take: 1 } },
        });
        if (folio?.reservations?.[0]?.rate_id) {
          rateId = folio.reservations[0].rate_id;
        }
      }

      if (rateId) {
        where.rate_id = rateId;
      }

      const [data, total] = await Promise.all([
        prisma.rate_inclusives.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { description: 'asc' },
        }),
        prisma.rate_inclusives.count({ where }),
      ]);
      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Frequency', key: 'frequency', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
        { label: 'Cost On', key: 'cost_on', type: 'none', is_search: false },
      ];
      success(res, data, 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Inclusive list error:', err); error(res, 'Failed to list inclusives', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/masterInclusive
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async masterInclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const where: any = { deleted_at: null };
      if (search) where.description = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.rate_inclusives.findMany({ where, orderBy: { description: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.rate_inclusives.count({ where }),
      ]);
      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: true },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
      ];
      success(res, reservationBn(data), 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Master inclusive list error:', err); error(res, 'Failed to list inclusives', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/master
  // Laravel parity (ReservationController@getMaster)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async getMaster(req: Request, res: Response): Promise<void> {
    try {
      // config/cms.php status_reservation, filtered per Laravel
      const allStatus = [
        { value: 'check_in', label: 'Check In', id: 0 },
        { value: 'check_out', label: 'Check Out', id: 1 },
        { value: 'cancel_reservation', label: 'Cancelled', id: 2 },
        { value: 'reservation', label: 'Reservation', id: 3 },
        { value: 'in_house', label: 'In House', id: 4 },
        { value: 'pending', label: 'Pending', id: 5 },
      ];
      const stayDates = allStatus
        .filter((s) => [1, 0].includes(s.id))
        .map((s) => ({ value: s.value, label: s.label }));

      const displayStatus = allStatus
        .filter((s) => s.id !== 4)
        .map((s) => ({ value: s.value, label: s.label }));

      const displayTypes = [
        { value: 'fit', label: 'FIT' },
        { value: 'git', label: 'GIT' },
        { value: 'vr', label: 'VR' },
      ];

      const reasons = await prisma.types.findMany({
        where: { group: 'cancellation-reservation', status: 1, deleted_at: null },
        orderBy: { sort: 'asc' },
      });

      success(res, null, 'Success', 200, {
        master: {
          stay_dates: stayDates,
          display_types: displayTypes,
          display_status: displayStatus,
          reasons: reasons.map((t) => ({ value: t.name, label: t.name })),
        },
      });
    } catch (err: any) { console.error('Reservation master error:', err); error(res, 'Failed to fetch reservation master', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/subfolio/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async subfolioList(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!/^\d+$/.test(raw)) { success(res, { data: [] }, 'Success'); return; }
      const parentId = BigInt(raw);
      const subs = await prisma.folios.findMany({ where: { parent: parentId }, select: { id: true, folio_number: true }, orderBy: { id: 'asc' } });
      success(res, { data: subs.map(s => ({ value: Number(s.id), label: s.folio_number })) }, 'Success');
    } catch (err: any) { console.error('Subfolio list error:', err); error(res, 'Failed to list subfolios', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/rate (Laravel getRate)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
static async rateListHelper(req: Request, res: Response): Promise<void> {
    try {
      const ci = req.query.check_in_date as string;
      const co = req.query.check_out_date as string;
      const roomTypeId = req.query.room_type_id as string;
      if (!ci || !co || !roomTypeId) { badRequest(res, 'The check in date field is required.'); return; }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty;
      if (!propertyId) { badRequest(res, 'Property not found'); return; }
      const pId = BigInt(propertyId);
      const rtId = BigInt(roomTypeId);

      const where: any = { deleted_at: null, module: 'rate' };
      where.rate_rates = { some: { room_type_id: rtId, property_id: pId } };
      const ciD = new Date(ci);
      const coD = new Date(co);
      where.start_date = { lte: ciD };
      where.end_date = { gte: coD };
      const search = req.query.search as string;
      if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];
      const searchField = req.query.search_field as string;
      if (searchField && !search) {
        const searchValue = String(req.query.search_value ?? '');
        if (searchValue) where[searchField] = { contains: searchValue, mode: 'insensitive' };
      }

      const [rates, total, codePost] = await Promise.all([
        prisma.rates.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.rates.count({ where }),
        fetchCodePostOptions(),
      ]);
      const formatted = rates.map((r: any) => rateRowData(r, codePost.byId));
      const table = rateTableColumns(codePost.options, true);
      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = { view: true, add: req.user?.superUser || permFlags.add, edit: req.user?.superUser || permFlags.edit, delete: req.user?.superUser || permFlags.delete };
      success(res, formatted, 'Success', 200, { table, permission, pagination: paggingMetaLocal(total, limit, page), search_data: dataSearchLocal(req, table) as any });
    } catch (err: any) { console.error('Reservation rate list error:', err); error(res, 'Failed to fetch rates', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/rate-by-company-id (Laravel getRateByCompany)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async rateByCompany(req: Request, res: Response): Promise<void> {
    try {
      const companyId = String(req.query.company_profile_id ?? '0');
      const ci = req.query.check_in_date as string;
      const co = req.query.check_out_date as string;
      const dayUse = req.query.day_use as string;
      const typeRsv = req.query.type_rsv as string;
      if (!ci || !co) { badRequest(res, 'The check in date field is required.'); return; }
      const propertyId = req.user?.lastProperty;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const searchField = req.query.search_field as string;
      const searchValue = String(req.query.search_value ?? '');
      const ciD = new Date(ci);
      const coD = new Date(co);
      const company = companyId !== '0' ? BigInt(companyId) : null;

      const baseWhere: any = { deleted_at: null, status: 1, module: 'rate' };
      if (propertyId) baseWhere.property_id = propertyId;
      baseWhere.start_date = { lte: ciD };
      baseWhere.end_date = { gte: coD };
      if (dayUse === '1') baseWhere.is_day_use = true;
      const searchConds: any[] = [];
      if (search) searchConds.push({ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } });
      if (searchField && searchValue && searchConds.length === 0) searchConds.push({ [searchField]: { contains: searchValue, mode: 'insensitive' } });

      let rateWhere: any = { ...baseWhere };
      if (searchConds.length > 0) rateWhere.AND = searchConds;
      if (company) {
        rateWhere.OR = [
          { model_has_company_profiles: { some: { company_profile_id: company, model_type: 'App\\Models\\Rate' } } },
          { model_has_company_profiles: { none: { model_type: 'App\\Models\\Rate' } } },
        ];
      } else if (searchConds.length > 0) {
        rateWhere.OR = searchConds;
      }

      let rates = await prisma.rates.findMany({ where: rateWhere, orderBy: { module: 'desc' } });
      let totalData = rates.length;
      if (rates.length === 0 && dayUse !== '1') {
        const fallbackWhere: any = { ...baseWhere, model_has_company_profiles: { none: { model_type: 'App\\Models\\Rate' } } };
        if (searchConds.length > 0) fallbackWhere.AND = searchConds;
        rates = await prisma.rates.findMany({ where: fallbackWhere, orderBy: { module: 'desc' } });
        totalData = rates.length;
      }

      const codePost = await fetchCodePostOptions();
      let data = rates.map((r: any) => rateRowData(r, codePost.byId));

      if (dayUse !== '1') {
        const barWhere: any = { deleted_at: null, status: 1 };
        if (propertyId) barWhere.property_id = propertyId;
        barWhere.start_date = { lte: ciD };
        barWhere.end_date = { gte: coD };
        const bars = await prisma.bars.findMany({ where: barWhere });
        if (bars.length > 0) {
          // Laravel :2453-2479 — ONE pseudo BAR row aggregated over ALL active bars
          // (min start, max end); not just the first bar.
          const first = barRowData(bars[0], codePost.byId);
          const minStart = bars.reduce((m, b) => (b.start_date < m ? b.start_date : m), bars[0].start_date);
          const maxEnd = bars.reduce((m, b) => (b.end_date > m ? b.end_date : m), bars[0].end_date);
          const barPseudo = {
            ...first,
            start_date: minStart,
            end_date: maxEnd,
            code: 'BAR',
            name: 'BAR',
            description: 'BAR',
            rate_type: 'BAR',
            code_post_id: 'BAR',
            sort_by_company: 3,
            code_color: [{ value: 'BAR', label: 'BAR' }],
            is_color: true,
            color: 'bg-secondary',
          };
          data.push(barPseudo);
        }
      }

      data.sort((a: any, b: any) => (a.sort_by_company - b.sort_by_company) || (a.id - b.id));
      if (typeRsv) {
        const needle = typeRsv === 'is_walk_in' ? 'walk in' : typeRsv === 'is_house_use' ? 'house use' : 'complimentary';
        const matched = data.filter((d: any) => d.name && String(d.name).toLowerCase().includes(needle));
        if (matched.length > 0) {
          const seen = new Set<number>();
          data = [...matched, ...data].filter((d: any) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
        }
      }

      totalData = totalData + 1;
      const table = rateTableColumns(codePost.options, false).map((col: any) => {
        if (col.key === 'code') return { ...col, key: 'code_color' };
        return col;
      });
      // Laravel :2558 — getPermissionDirect([]) = every flag false
      const permission = { view: false, add: false, edit: false, delete: false };
      success(res, data, 'Success', 200, { table, permission, pagination: paggingMetaLocal(totalData, limit, page), search_data: dataSearchLocal(req, table) as any });
    } catch (err: any) { console.error('Reservation rate by company error:', err); error(res, 'Failed to fetch rates', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/package-by-rate-id/:id (Laravel getPackageByRateId)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async packageByRateId(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { badRequest(res, 'The rate id field is required.'); return; }
      const rateId = BigInt(raw);
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const where: any = { rate_id: rateId, deleted_at: null };
      const search = req.query.search as string;
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const searchField = req.query.search_field as string;
      if (searchField && !search) {
        const searchValue = String(req.query.search_value ?? '');
        if (searchValue) where[searchField] = { contains: searchValue, mode: 'insensitive' };
      }

      const [dayUses, total] = await Promise.all([
        prisma.rate_day_uses.findMany({ where, orderBy: { sort: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.rate_day_uses.count({ where }),
      ]);
      const timeOptions = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360].map((v) => ({ value: v, label: `${v / 60} Hour${v > 60 ? 's' : ''}` }));
      const table = [
        { label: 'Rate Name', key: 'name', type: 'text', is_search: true },
        { label: 'Time', key: 'time', type: 'select', options: timeOptions, is_search: true },
        { label: 'Status', key: 'status', type: 'checkbox', options: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }], is_search: true },
      ];
      const data = dayUses.map((d: any) => ({ id: Number(d.id), name: d.name, time: d.time, status: !!d.status }));
      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = { view: true, add: req.user?.superUser || permFlags.add, edit: req.user?.superUser || permFlags.edit, delete: req.user?.superUser || permFlags.delete };
      success(res, data, 'Success', 200, { table, permission, pagination: paggingMetaLocal(total, limit, page), search_data: dataSearchLocal(req, table) as any });
    } catch (err: any) { console.error('Reservation package by rate error:', err); error(res, 'Failed to fetch packages', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /cms/reservation/charge (Laravel getCharge)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async getCharge(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      if (!propertyId) { badRequest(res, 'Property not found'); return; }
      const pId = BigInt(propertyId);
      const body = req.body || {};
      const reservationList: any[] = Array.isArray(body.reservation_list) ? body.reservation_list : [];
      if (reservationList.length === 0) { badRequest(res, 'The reservation list field is required.'); return; }
      for (const item of reservationList) {
        if (!item.check_in_date || !item.check_out_date) { badRequest(res, 'Check In Date Required'); return; }
        if (item.rate_id && !/^\d+$/.test(String(item.rate_id))) { badRequest(res, 'Rate Not Found'); return; }
      }

      let ci = String(body.check_in_date || '');
      let co = String(body.check_out_date || '');
      if (!ci || !co) {
        ci = String(reservationList.reduce((min: string, i: any) => (!min || i.check_in_date < min ? i.check_in_date : min), ''));
        co = String(reservationList.reduce((max: string, i: any) => (!max || i.check_out_date > max ? i.check_out_date : max), ''));
      }
      if (body.type_reservation === 'day-use') {
        const d = new Date(ci);
        d.setDate(d.getDate() + 1);
        co = d.toISOString().substring(0, 10);
      }
      const nights = Math.max(1, Math.ceil((new Date(co).getTime() - new Date(ci).getTime()) / (1000 * 60 * 60 * 24)));

      const property = await prisma.properties.findUnique({ where: { id: pId } });
      const codePost = await prisma.code_posts.findFirst({ where: { deleted_at: null, status: STATUS_ACTIVE } });
      if (!codePost) { badRequest(res, 'Code post not found'); return; }
      const isTax = property?.is_tax === 1;

      const rateIds: bigint[] = [];
      const rateById = new Map<number, any>();
      const itemByRate: any[] = [];
      for (const item of reservationList) {
        if (item.rate_id) {
          const rid = BigInt(item.rate_id);
          if (!rateById.has(Number(rid))) {
            rateIds.push(rid);
            const rate = await prisma.rates.findUnique({ where: { id: rid } });
            rateById.set(Number(rid), rate);
          }
          itemByRate.push(item);
        }
      }

      let promoCode = String(body.promo_code ?? '');
      const appliedPromo: any[] = [];
      const discountByRate = new Map<number, number>();
      let linkByPromo = new Map<number, number>();
      let linkedPromotions: any[] = [];
      if (promoCode) {
        if (rateIds.length > 0) {
          const links = await prisma.model_has_promotions.findMany({ where: { model_type: 'App\\Models\\Rate', model_id: { in: rateIds } }, select: { promotion_id: true, model_id: true } });
          links.forEach((l: any) => linkByPromo.set(Number(l.promotion_id), Number(l.model_id)));
          if (linkByPromo.size > 0) {
            linkedPromotions = await prisma.promotions.findMany({
              where: {
                id: { in: [...linkByPromo.keys()] },
                status: 1,
                deleted_at: null,
                promotion_code: promoCode,
                from_validity_date: { lte: new Date() },
                to_validity_date: { gte: new Date() },
                from_stay_date: { lte: new Date(ci) },
                to_stay_date: { gte: new Date(co) },
                min_night: { lte: nights },
              },
            });
          }
        }
        if (linkedPromotions.length === 0) {
          res.status(400).json({ code: 400, message: 'Promo code not found' });
          return;
        }
        for (const promo of linkedPromotions) {
          const rateIdLinked = linkByPromo.get(Number(promo.id));
          const rate = rateById.get(Number(rateIdLinked));
          const amount = Number(rate?.amount ?? 0);
          const discount = promo.promotion_type === 'percentage' ? (amount * Number(promo.discount_percentage ?? 0)) / 100 : Number(promo.discount_flat ?? 0);
          discountByRate.set(Number(rateIdLinked), (discountByRate.get(Number(rateIdLinked)) ?? 0) + discount);
          appliedPromo.push({ rate_id: Number(rateIdLinked), promo_id: Number(promo.id), promo_code: promo.promotion_code, discount });
        }
      } else if (Array.isArray(body.applied_promo) && body.applied_promo.length > 0) {
        for (const ap of body.applied_promo) {
          discountByRate.set(Number(ap.rate_id), Number(ap.discount ?? ap.amount ?? 0));
          appliedPromo.push(ap);
        }
      }

      // Rate -> its own code_post (NOT first active code_posts row) — Laravel getCharge parity.
      const rateRowList = rateIds.length
        ? await prisma.rates.findMany({
            where: { id: { in: rateIds } },
            select: { id: true, code_post_id: true },
          })
        : [];
      const rateCodePostMap = new Map<number, number | null>(rateRowList.map((r) => [Number(r.id), r.code_post_id ? Number(r.code_post_id) : null]));
      const gcCodePostIds = [...new Set(rateRowList.map((r) => r.code_post_id).filter(Boolean))] as bigint[];
      const gcCodePostRows = gcCodePostIds.length ? await prisma.code_posts.findMany({ where: { id: { in: gcCodePostIds } } }) : [];
      const gcCodePostById = new Map<number, any>(gcCodePostRows.map((c) => [Number(c.id), c]));

      // Validated promos keyed by rate (controller-level stay/validity checks above match Laravel).
      const promosByRate = new Map<number, PromoLike[]>();
      if (linkedPromotions.length > 0) {
        for (const promo of linkedPromotions) {
          const rid = Number(linkByPromo.get(Number(promo.id)));
          const list = promosByRate.get(rid) ?? [];
          list.push(promo as PromoLike);
          promosByRate.set(rid, list);
        }
      } else if (Array.isArray(body.applied_promo)) {
        for (const ap of body.applied_promo) {
          if (ap?.rate_id === undefined) continue;
          const rid = Number(ap.rate_id);
          const list = promosByRate.get(rid) ?? [];
          list.push(ap as PromoLike);
          promosByRate.set(rid, list);
        }
      }

      const rows: any[] = [];
      for (const item of itemByRate) {
        const rate = rateById.get(Number(item.rate_id));
        if (!rate) continue;
        const itemCi = new Date(String(item.check_in_date));
        let itemCo = new Date(String(item.check_out_date));
        let nightsThis = Math.ceil((itemCo.getTime() - itemCi.getTime()) / (1000 * 60 * 60 * 24));
        const isDayUse = body.type_reservation === 'day-use';
        if (isDayUse && nightsThis < 1) {
          itemCo = new Date(itemCi);
          itemCo.setDate(itemCo.getDate() + 1);
          nightsThis = 1;
        }
        const getNight = isDayUse ? 0 : Math.max(1, nightsThis);
        const roomTypeIdEff = item.room_type_id ? BigInt(item.room_type_id) : (item.room_type_id_next ? BigInt(item.room_type_id_next) : null);

        for (let i = 0; i < (isDayUse ? 1 : nightsThis); i++) {
          const nightDate = new Date(itemCi);
          nightDate.setDate(nightDate.getDate() + i);

          // Per-night promo re-check (stay window can exclude individual nights — Folio.php:2472-2482)
          const nightPromos =
            promosByRate.get(Number(item.rate_id)) ??
            (promoCode
              ? await findPromosForNight(prisma, BigInt(String(item.rate_id)), nightDate, getNight, promoCode)
              : []);

          const pricing = await priceNight({
            prisma,
            rateId: BigInt(String(item.rate_id)),
            roomTypeId: roomTypeIdEff,
            night: nightDate,
            getNight,
            adult: Number(item.adult || 1),
            child: Number(item.child || 0),
            quantity: isDayUse ? Number(item.quantity || 1) : 1,
            isTax,
            rateCodePost: gcCodePostById.get(rateCodePostMap.get(Number(item.rate_id)) ?? -1) ?? null,
            promos: nightPromos,
          });

          rows.push({
            date: nightDate,
            amountt: pricing.amount,
            pb1: pricing.pb1,
            service_charge: pricing.service_charge,
            quantity: 1,
          });
        }
      }
      const charge = await getRevenueCharge(rows);
      res.json({ code: 200, message: 'Success', data: charge });
    } catch (err: any) { console.error('Reservation get charge error:', err); error(res, 'Failed to get charge', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/available-room (Laravel getAvailableRoomType)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async availableRoomType(req: Request, res: Response): Promise<void> {
    try {
      const ci = req.query.check_in_date as string;
      const co = req.query.check_out_date as string;
      if (!ci || !co) { badRequest(res, 'The check in date field is required.'); return; }
      const days: string[] = [];
      const ciD = new Date(ci);
      const coD = new Date(co);
      for (let i = 0; i < Math.ceil((coD.getTime() - ciD.getTime()) / (1000 * 60 * 60 * 24)); i++) {
        const d = new Date(ciD);
        d.setDate(d.getDate() + i);
        days.push(d.toISOString().substring(0, 10));
      }

      const propertyId = req.user?.lastProperty;
      const [overbookings, rooms, workOrders] = await Promise.all([
        prisma.overbookings.findMany({ where: { date: { gte: new Date(ci), lte: new Date(co) } } }),
        prisma.rooms.findMany({ where: { deleted_at: null, status: 1, property_id: propertyId ? BigInt(propertyId) : undefined }, select: { id: true, room_type_id: true, room_status: true } }),
        prisma.work_orders.findMany({ where: { deleted_at: null, status: 1, room_id: { not: null }, date: { lte: new Date(ci) }, OR: [{ end_date: { gte: new Date(ci) } }, { end_date: null }] } }),
      ]);

      const roomTypes = await prisma.room_types.findMany({ where: { deleted_at: null, status: 1, property_id: propertyId ? BigInt(propertyId) : undefined } });
      const typeIds = roomTypes.map((t: any) => Number(t.id));
      const reservations = await prisma.reservations.findMany({
        where: { room_type_id: { in: typeIds }, date: { gte: new Date(ci), lte: new Date(co) } },
        include: { folios: { select: { status_reservation: true } } },
      });

      const overbookingByType = new Map<number, Map<string, number>>();
      for (const ob of overbookings) {
        const key = Number(ob.room_type_id);
        if (!overbookingByType.has(key)) overbookingByType.set(key, new Map());
        const m = overbookingByType.get(key)!;
        const d = fmtDateOnly(ob.date)!;
        m.set(d, (m.get(d) ?? 0) + Number(ob.overbooking));
      }

      const data: any[] = [];
      for (const rt of roomTypes) {
        const tid = Number(rt.id);
        const typeRooms = rooms.filter((r: any) => Number(r.room_type_id) === tid);
        const totalRoom = typeRooms.length;
        const blocked = typeRooms.filter((r: any) => r.room_status === ROOM_STATUSES.block.id).length;
        const roomIds = new Set(typeRooms.map((r: any) => Number(r.id)));
        const row: any = { id: tid, name: rt.name };
        for (const day of days) {
          const dayD = new Date(day);
          const outOfOrder = workOrders.filter((w: any) => roomIds.has(Number(w.room_id)) && ((w.date && w.date <= dayD && (w.end_date == null || w.end_date > dayD)))).length;
          const overbooking = overbookingByType.get(tid)?.get(day) ?? 0;
          const roomSold = reservations.filter((r: any) => {
            const fStatus = r.folios?.status_reservation;
            return fmtDateOnly(r.date) === day && Number(r.room_type_id) === tid && fStatus != null && fStatus !== STATUS_RESERVATION.pending.id && fStatus !== STATUS_RESERVATION.cancel_reservation.id;
          }).length;
          row[day.replace(/-/g, '-')] = totalRoom + overbooking - roomSold - blocked - outOfOrder;
        }
        data.push(row);
      }

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        ...days.map((day) => ({ label: day, key: day, type: 'none', is_search: false })),
      ];
const total = data.length;
      success(res, data, 'Success', 200, { table, pagination: paggingMetaLocal(total, 99999, parseInt(req.query.page as string) || 1), permission: { view: true, add: true, edit: true, delete: true } });
    } catch (err: any) { console.error('Reservation available room error:', err); error(res, 'Failed to get available room', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /cms/reservation/room-git (Laravel getRoomGit)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async roomGit(req: Request, res: Response): Promise<void> {
    try {
      let arr: any[] = [];
      let ci = req.query.check_in_date as string;
      let co = req.query.check_out_date as string;
      let rateId: bigint | null = null;
      const hasFolio = req.query.folio_id && /^\d+$/.test(String(req.query.folio_id));
      if (hasFolio) {
        const folio = await prisma.folios.findUnique({ where: { id: BigInt(String(req.query.folio_id)) } });
        if (folio) {
          ci = fmtDateOnly(folio.check_in_date) || ci;
          co = fmtDateOnly(folio.check_out_date) || co;
          const childFolios = await prisma.folios.findMany({
            where: { parent: folio.id, status_reservation: { not: STATUS_RESERVATION.cancel_reservation.id } },
            include: { reservations: true },
          });
          for (const child of childFolios) {
            if (child.reservations.length > 0) {
              const r = child.reservations[0];
              arr.push({
                room_type_id: Number(r.room_type_id ?? 0),
                adult: Number(r.adult ?? 2),
                child: Number(r.child ?? 0),
              });
              if (!rateId && r.rate_id) rateId = r.rate_id;
            }
          }
        }
      }
      if (!ci || !co) { badRequest(res, 'The check in date field is required.'); return; }
      if (!rateId && req.query.rate_id && /^\d+$/.test(String(req.query.rate_id))) rateId = BigInt(String(req.query.rate_id));

      const table = [
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Qty Room Available', key: 'available', type: 'none', is_search: false },
        { label: 'Qty', key: 'qty', type: 'number', is_search: false },
      ];
      if (!hasFolio) {
        table.push(
          { label: 'Adult', key: 'adult', type: 'number', is_search: false },
          { label: 'Child', key: 'child', type: 'number', is_search: false },
        );
      }

      const [overbookings, availableIds] = await Promise.all([
        prisma.overbookings.findMany({ where: { date: { gte: new Date(ci), lte: new Date(co) } } }),
        req.user?.lastProperty ? onlyAvailableRoomIds(req.user.lastProperty, ci, co) : Promise.resolve(new Set<number>()),
      ]);

      const configValues: number[] = [];
      for (const [k, v] of Object.entries(req.query)) {
        if (k.startsWith('idx_') && v != null && /^\d+$/.test(String(v))) configValues.push(Number(v));
      }
      let configRoomIds: Set<number> | null = null;
      if (configValues.length > 0) {
        const links = await prisma.model_has_types.findMany({ where: { model_type: 'App\\Models\\Room', type_id: { in: configValues } }, select: { model_id: true, type_id: true } });
        const byType = new Map<number, Set<number>>();
        for (const l of links) {
          const tid = Number(l.type_id);
          if (!byType.has(tid)) byType.set(tid, new Set<number>());
          byType.get(tid)!.add(Number(l.model_id));
        }
        let accIds: number[] | null = null;
        for (const val of configValues) {
          const ids = [...(byType.get(val) ?? new Set<number>())];
          accIds = accIds === null ? ids : ids.filter((x) => accIds!.includes(x));
        }
        configRoomIds = accIds ? new Set<number>(accIds) : null;
      }

      const whereRT: any = { deleted_at: null, status: 1 };
      if (rateId) whereRT.rate_rates = { some: { rate_id: rateId } };
      const roomTypes = await prisma.room_types.findMany({ where: whereRT, include: { rooms: { select: { id: true } } } });

      const overbookingMinByType = new Map<number, number>();
      for (const ob of overbookings) {
        const tid = Number(ob.room_type_id);
        const v = Number(ob.overbooking);
        overbookingMinByType.set(tid, Math.min(overbookingMinByType.get(tid) ?? Infinity, v));
      }

      const data: any[] = [];
      for (const rt of roomTypes) {
        const tid = Number(rt.id);
        let availRooms = rt.rooms.filter((r: any) => availableIds.has(Number(r.id))).length;
        if (configRoomIds !== null) {
          availRooms = rt.rooms.filter((r: any) => availableIds.has(Number(r.id)) && configRoomIds.has(Number(r.id))).length;
        }
        const min = overbookingMinByType.get(tid) ?? 0;
        const available = availRooms + (Number.isFinite(min) ? min : 0);
        const arrForType = arr.filter((a: any) => a.room_type_id === tid);
        data.push({
          id: tid,
          room_type: rt.name,
          available,
          description: rt.description,
          qty: arrForType.length,
          adult: arrForType.length > 0 ? (arrForType[0].adult ?? 2) : 2,
          child: arrForType.length > 0 ? (arrForType[0].child ?? 0) : 0,
          item: bigintToNumber(rt),
        });
      }
const filtered = data.filter((d: any) => d.available > 0);
      const totalData = filtered.length;
      success(res, filtered, 'Success', 200, { table, pagination: paggingMetaLocal(totalData, 9999, 1), permission: { view: true, add: true, edit: true, delete: true } });
    } catch (err: any) { console.error('Reservation room git error:', err); error(res, 'Failed to get room git', 500); }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /cms/reservation/update-room-parent-git/:id (Laravel updateRoomParentGIT)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async updateRoomParentGIT(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const body = req.body || {};
      const reservationList: any[] = Array.isArray(body.reservation_list) ? body.reservation_list : [];
      if (!raw || !/^\d+$/.test(raw)) { badRequest(res, 'The folio id field is required.'); return; }
      if (reservationList.length === 0) { badRequest(res, 'The reservation list field is required.'); return; }
      const folioId = BigInt(raw);

      const folio = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }
      const children = await prisma.folios.findMany({
        where: { parent: folioId, status_reservation: { not: STATUS_RESERVATION.cancel_reservation.id } },
        include: { reservations: true },
      });
      const arr: any[] = [];
      let rateId: bigint | null = null;
      for (const child of children) {
        if (child.reservations.length > 0) {
          const r = child.reservations[0];
          arr.push({ folio_id: Number(child.id), room_type_id: Number(r.room_type_id ?? 0) });
          if (!rateId && r.rate_id) rateId = r.rate_id;
        }
      }
      const ci = fmtDateOnly(folio.check_in_date) || '';
      const co = fmtDateOnly(folio.check_out_date) || '';
      if (!ci || !co) { badRequest(res, 'Check in date required'); return; }

      const [overbookings, availableIds] = await Promise.all([
        prisma.overbookings.findMany({ where: { date: { gte: new Date(ci), lte: new Date(co) } } }),
        folio.property_id ? onlyAvailableRoomIds(folio.property_id, ci, co) : Promise.resolve(new Set<number>()),
      ]);

      const whereRT: any = { deleted_at: null, status: 1 };
      if (rateId) whereRT.rate_rates = { some: { rate_id: rateId } };
      const roomTypes = await prisma.room_types.findMany({ where: whereRT, include: { rooms: { select: { id: true } } } });

      const overbookingMinByType = new Map<number, number>();
      for (const ob of overbookings) {
        const tid = Number(ob.room_type_id);
        const v = Number(ob.overbooking);
        overbookingMinByType.set(tid, Math.min(overbookingMinByType.get(tid) ?? Infinity, v));
      }

      const data: any[] = [];
      for (const rt of roomTypes) {
        const tid = Number(rt.id);
        const availRooms = rt.rooms.filter((r: any) => availableIds.has(Number(r.id))).length;
        const min = overbookingMinByType.get(tid) ?? 0;
        const arrForType = arr.filter((a: any) => a.room_type_id === tid);
        data.push({
          id: tid,
          room_type: rt.name,
          available: availRooms + (Number.isFinite(min) ? min : 0),
          description: rt.description,
          qty: arrForType.length,
          folio_id: arrForType.map((a: any) => a.folio_id),
        });
      }

      const arrTemp: any[] = [];
      for (const value of data) {
        const checkQty = reservationList.find((rl: any) => String(rl.id) === String(value.id));
        const newQty = checkQty ? Number(checkQty.qty) - value.qty : 0 - value.qty;
        if (value.available < newQty) {
          res.status(400).json({ code: 400, newQty, available: value.available, message: `Room Type ${value.room_type} is not available` });
          return;
        }
        arrTemp.push({ room_type_id: value.id, qty: newQty, folio_id: value.folio_id });
      }

      const businessDate = (await import('../controllers/auth.controller')).AuthController.getBusinessDate(folio.property_id);
      const numberIndexRaw = children.length > 0 ? Math.max(...children.map((c: any) => {
        const last = String(c.folio_number ?? '').split('/').pop();
        const n = parseInt(last ?? '0', 10);
        return Number.isNaN(n) ? 0 : n;
      })) + 1 : 1;
      let numberIndex = Number.isFinite(numberIndexRaw) ? numberIndexRaw : 1;

      for (const value of arrTemp) {
        if (value.qty > 0) {
          for (let i = 0; i < value.qty; i++) {
            let sourceChild: any;
            if (!value.folio_id || value.folio_id.length === 0) {
              sourceChild = children[children.length - 1];
            } else {
              sourceChild = children.find((c: any) => value.folio_id.includes(Number(c.id)));
            }
            if (!sourceChild) continue;
            const { id: _srcId, folio_number: _srcNum, created_at: _ca, updated_at: _ua, ...copyFields } = sourceChild;
            let newFolioNumber = `${folio.folio_number}/${String(numberIndex).padStart(3, '0')}`;
            let exists = await prisma.folios.findFirst({ where: { folio_number: newFolioNumber } });
            while (exists) {
              numberIndex++;
              newFolioNumber = `${folio.folio_number}/${String(numberIndex).padStart(3, '0')}`;
              exists = await prisma.folios.findFirst({ where: { folio_number: newFolioNumber } });
            }
            const bd = await businessDate;
            const replicated = await prisma.folios.create({
              data: {
                ...copyFields,
                parent: folioId,
                folio_number: newFolioNumber,
                type_reservation: folio.type_reservation,
                check_in_date: folio.check_in_date && folio.check_in_date < new Date(bd) ? new Date(bd) : folio.check_in_date,
                check_out_date: folio.check_out_date,
                status_reservation: STATUS_RESERVATION.reservation.id,
                created_at: new Date(),
                updated_at: new Date(),
              },
            });
            numberIndex++;
            const sourceReservation = sourceChild.reservations?.[0];
            if (sourceReservation) {
              const nights = Math.max(1, Math.ceil((new Date(co).getTime() - new Date(ci).getTime()) / (1000 * 60 * 60 * 24)));
              for (let n = 0; n < nights; n++) {
                const nightDate = new Date(ci);
                nightDate.setDate(nightDate.getDate() + n);
                await prisma.reservations.create({
                  data: {
                    property_id: sourceReservation.property_id,
                    folio_id: replicated.id,
                    rate_id: sourceReservation.rate_id,
                    eta: sourceReservation.eta,
                    etd: sourceReservation.etd,
                    room_type_id: BigInt(value.room_type_id),
                    room_id: null,
                    check_in_date: new Date(ci),
                    check_out_date: new Date(co),
                    adult: sourceReservation.adult,
                    child: sourceReservation.child,
                    add_bed: sourceReservation.add_bed,
                    date: nightDate,
                    status_reservation: STATUS_RESERVATION.reservation.id,
                    status: STATUS_ACTIVE,
                    night: nights,
                    amount: 0,
                    amountt: 0,
                    total: 0,
                    service_charge: 0,
                    pb1: 0,
                    tax3: 0,
                    created_by: req.user?.id,
                  },
                });
              }
            }
          }
        } else if (value.qty < 0) {
          for (let i = 0; i < Math.abs(value.qty); i++) {
            const cancelTargets = value.folio_id.length > 0 ? children.filter((c: any) => value.folio_id.includes(Number(c.id))) : [];
            const cancelTarget = cancelTargets[cancelTargets.length - 1];
            if (!cancelTarget) continue;
            if (cancelTarget.status_reservation === STATUS_RESERVATION.check_in.id || cancelTarget.status_reservation === STATUS_RESERVATION.check_out.id) continue;
            await prisma.folios.update({
              where: { id: cancelTarget.id },
              data: {
                status_reservation: STATUS_RESERVATION.cancel_reservation.id,
                parent: 0,
                remark: `Deleted from Parent GIT => ${folio.folio_number}`,
              },
            });
          }
        }
      }

      res.json({ code: 200, message: 'Success', data: arrTemp });
    } catch (err: any) { console.error('Reservation update room parent git error:', err); error(res, 'Failed to update room parent git', 500); }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Reservation sub-resource parity ports (Laravel cms.php:951-966)
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /reservation/folio — Laravel getFolio (:4114): autocomplete folio list.
  // FE autocomplete appends ?search=word / &search=word; rows are {id,name}.
  static async folioList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const typeReservationParam = req.query['type-reservation'] as string;

      const where: any = { deleted_at: null };
      // Laravel explode('-', 'vr-fit') -> ['vr','fit'] whereIn type_reservation
      if (typeReservationParam) {
        const types = String(typeReservationParam).split('-').filter(Boolean);
        if (types.length > 0) where.type_reservation = { in: types };
      }
      if (search) {
        const companies = await prisma.company_profiles.findMany({
          where: { name: { contains: search, mode: 'insensitive' } },
          select: { id: true },
          take: 50,
        });
        where.OR = [
          { folio_number: { contains: search, mode: 'insensitive' } },
          { guest_profiles: { OR: [{ first_name: { contains: search, mode: 'insensitive' } }, { last_name: { contains: search, mode: 'insensitive' } }] } },
          ...(companies.length > 0 ? [{ company_profile_id: { in: companies.map((c) => c.id) } }] : []),
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.folios.findMany({
          where,
          select: {
            id: true,
            folio_number: true,
            first_name: true,
            last_name: true,
            guest_profiles: { select: { first_name: true, last_name: true } },
            reservations: {
              where: { deleted_at: null },
              orderBy: { date: 'asc' },
              take: 1,
              select: { room_name: true, room_types: { select: { name: true } } },
            },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.folios.count({ where }),
      ]);

      const data = rows.map((f: any) => {
        const guestName = `${f.guest_profiles?.first_name ?? f.first_name ?? ''} ${f.guest_profiles?.last_name ?? f.last_name ?? ''}`.trim();
        const reservation = f.reservations?.[0];
        const roomType = reservation?.room_types?.name ?? '-';
        const roomName = reservation?.room_name ?? '-';
        return { id: Number(f.id), name: `${f.folio_number} - ${guestName} - ${roomType} - ${roomName}` };
      });

      const table = [{ label: 'Name', key: 'name', type: 'none', is_search: false }];
      success(res, data, 'Success', 200, {
        table,
        permission: { view: true },
        pagination: { current_page: page, last_page: Math.max(1, Math.ceil(total / limit)), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Reservation folio list error:', err); error(res, 'Failed to list folios', 500); }
  }

  // GET /reservation/ledger/:folio — Laravel getLedger (:4179) + Folio::getListLedger
  // (Folio.php:1108-1136): company profile + guest profile + other guests.
  static async ledgerList(req: Request, res: Response): Promise<void> {
    try {
      const folioIdRaw = Array.isArray(req.params.folio) ? req.params.folio[0] : req.params.folio;
      if (!folioIdRaw || !/^\d+$/.test(folioIdRaw)) { notFound(res, 'Folio not found'); return; }
      const folio: any = await prisma.folios.findFirst({
        where: { id: BigInt(folioIdRaw), deleted_at: null },
        include: { guest_profiles: { select: { first_name: true, last_name: true } } },
      });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      const list: { value: string; label: string }[] = [];
      if (folio.company_profile_id) {
        const cp = await prisma.company_profiles.findUnique({ where: { id: BigInt(folio.company_profile_id) }, select: { name: true } });
        if (cp) list.push({ value: `${folio.company_profile_id}-company`, label: cp.name ?? '' });
      }
      if (folio.guest_profile_id && folio.guest_profiles) {
        list.push({
          value: `${Number(folio.guest_profile_id)}-guest`,
          label: `${folio.guest_profiles.first_name ?? ''} ${folio.guest_profiles.last_name ?? ''}`.trim(),
        });
      }
      const others = await prisma.other_guests.findMany({ where: { folio_id: Number(folio.id) }, orderBy: { id: 'desc' } });
      const otherIds = [...new Set(others.map((o) => BigInt(o.guest_profile_id)))];
      if (otherIds.length > 0) {
        const gps = await prisma.guest_profiles.findMany({ where: { id: { in: otherIds } }, select: { id: true, first_name: true, last_name: true } });
        const gpMap = new Map(gps.map((g) => [Number(g.id), g]));
        for (const o of others) {
          const g = gpMap.get(Number(o.guest_profile_id));
          if (g) list.push({ value: `${Number(g.id)}-guest`, label: `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() });
        }
      }

      success(res, list, 'Success', 200);
    } catch (err: any) { console.error('Reservation ledger list error:', err); error(res, 'Failed to list ledger', 500); }
  }

  // Resolve folio id with Laravel subfolio_id fallback quirk (:3548):
  // subfolio_id != 'null' && != '' -> subfolio_id else folio_id.
  private static resolveTargetFolioId(body: any): bigint | null {
    const sub = body?.subfolio_id;
    const main = body?.folio_id;
    const chosen = sub !== undefined && sub !== null && String(sub) !== 'null' && String(sub) !== '' ? sub : main;
    if (chosen === undefined || chosen === null || !/^\d+$/.test(String(chosen))) return null;
    return BigInt(chosen);
  }

  // POST /reservation/code-item — Laravel storeAdditionalItem (:3539).
  // Attaches selected code_items to the folio via model_has_code_items (@@ignore -> raw SQL).
  static async additionalItemStore(req: Request, res: Response): Promise<void> {
    try {
      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'The folio id field is required.'); return; }
      const idx: any[] = Array.isArray(body.idx) ? body.idx : (body.idx !== undefined ? [body.idx] : []);
      const idxNums = idx.map((v: any) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
      if (idxNums.length === 0) { notFound(res, 'The idx field is required.'); return; }

      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      // Laravel Folio::lastReservation scope: is_posting=0, orderBy date asc
      const reservation = await prisma.reservations.findFirst({ where: { folio_id: folio.id, is_posting: 0, deleted_at: null }, orderBy: { date: 'asc' } });

      for (const value of idxNums) {
        const dup = await prisma.$queryRaw<any[]>(
          Prisma.sql`SELECT code_item_id FROM model_has_code_items WHERE code_item_id = ${BigInt(value)} AND model_type = ${'App\\Models\\Folio'} AND model_id = ${folio.id} LIMIT 1`
        );
        if (dup.length > 0) continue;

        // Laravel prefers the rate-linked pivot row's attributes, falling back to the master CodeItem.
        let source: any = null;
        if (reservation?.rate_id) {
          const rateLinked = await prisma.$queryRaw<any[]>(
            Prisma.sql`SELECT * FROM model_has_code_items WHERE model_type = ${'App\\Models\\Rate'} AND model_id = ${reservation.rate_id} AND code_item_id = ${BigInt(value)} LIMIT 1`
          );
          if (rateLinked.length > 0) source = rateLinked[0];
        }
        if (!source) {
          source = await prisma.code_items.findUnique({ where: { id: BigInt(value) } });
        }

        // Laravel: start_date = max(businessDate, folio.check_in_date) (LogAudit::getBusinessDate)
        const businessDateStr = await AuthController.getBusinessDate(folio.property_id ?? null);
        const businessDate = businessDateStr ? new Date(`${businessDateStr}T00:00:00`) : new Date();
        const checkIn = folio.check_in_date ? new Date(folio.check_in_date) : businessDate;
        const startDate = checkIn < businessDate ? businessDate : checkIn;

        const processOn = source?.process_on ?? null;
        const endDate = processOn === 'ACTUAL' ? startDate : (folio.check_out_date ? new Date(folio.check_out_date) : startDate);

        // NOTE Laravel quirk preserved: code_post_id stores CodeItem::find($value)->id
        // (the code item's own id), NOT its code_post relation (Laravel storeAdditionalItem).
        await prisma.$executeRaw`
          INSERT INTO model_has_code_items
            (model_id, model_type, code_item_id, reason, start_date, end_date, sales, process_on, code_post_id, upsales, name, description)
          VALUES
            (${folio.id}, ${'App\\Models\\Folio'}, ${BigInt(value)}, '',
             ${startDate}, ${endDate}, ${source?.sales ?? null}, ${processOn},
             ${Number(source?.id ?? value)}, '', ${source?.name ?? null}, ${source?.description ?? null})
        `;
      }
      await prisma.folios.update({ where: { id: folio.id }, data: { updated_at: new Date() } });

      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Additional item store error:', err); error(res, err?.message ?? 'Failed to store additional items', 500); }
  }

  // PUT /reservation/code-item/:codeItem — Laravel updateAdditionalItem (:3616).
  // Updates folio-attached pivot rows for that code_item (dates must stay inside folio range).
  static async additionalItemUpdate(req: Request, res: Response): Promise<void> {
    try {
      const codeItemIdRaw = Array.isArray(req.params.codeItem) ? req.params.codeItem[0] : req.params.codeItem;
      if (!codeItemIdRaw || !/^\d+$/.test(codeItemIdRaw)) { notFound(res, 'Not Found codeItem'); return; }
      const codeItemId = BigInt(codeItemIdRaw);

      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'Folio not found'); return; }
      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      const { start_date, end_date, sales, upsales, name, description, reason } = body;
      const start = start_date ? new Date(start_date) : null;
      const end = end_date ? new Date(end_date) : null;
      if (!start || !end) { badRequest(res, 'Start date and end date are required'); return; }
      if (start < new Date(folio.check_in_date) || end > new Date(folio.check_out_date)) {
        badRequest(res, 'Start date and end date must be in range folio date'); return;
      }
      if (end < start) { badRequest(res, 'End date must be greater than start date'); return; }

      await prisma.$executeRaw`
        UPDATE model_has_code_items SET
          reason = ${reason ?? ''},
          start_date = ${start},
          end_date = ${end},
          sales = ${sales ?? null},
          upsales = ${upsales !== undefined && upsales !== null ? String(upsales) : ''},
          name = ${name ?? null},
          description = ${description ?? null}
        WHERE code_item_id = ${codeItemId} AND model_type = ${'App\\Models\\Folio'} AND model_id = ${folio.id}
      `;
      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Additional item update error:', err); error(res, 'Failed to update additional item', 500); }
  }

  // DELETE /reservation/code-item/:codeItem — Laravel deleteAdditionalItem (:3663).
  static async additionalItemDestroy(req: Request, res: Response): Promise<void> {
    try {
      const codeItemIdRaw = Array.isArray(req.params.codeItem) ? req.params.codeItem[0] : req.params.codeItem;
      if (!codeItemIdRaw || !/^\d+$/.test(codeItemIdRaw)) { notFound(res, 'Not Found codeItem'); return; }

      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'Folio not found'); return; }
      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      await prisma.$executeRaw`
        DELETE FROM model_has_code_items
        WHERE code_item_id = ${BigInt(codeItemIdRaw)} AND model_type = ${'App\\Models\\Folio'} AND model_id = ${folio.id}
      `;
      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Additional item destroy error:', err); error(res, 'Failed to delete additional item', 500); }
  }

  // POST /reservation/inclusive — Laravel storeInclusives (:3797).
  // Attaches rate_inclusives to the folio via model_has_rate_inclusives pivot.
  static async inclusiveStore(req: Request, res: Response): Promise<void> {
    try {
      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'The folio id field is required.'); return; }
      const idx: any[] = Array.isArray(req.body.idx) ? req.body.idx : (req.body.idx !== undefined ? [req.body.idx] : []);
      const idxNums = idx.map((v: any) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
      if (idxNums.length === 0) { notFound(res, 'The idx field is required.'); return; }

      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      for (const value of idxNums) {
        const dup = await prisma.model_has_rate_inclusives.findFirst({
          where: { rate_inclusive_id: BigInt(value), model_type: 'App\\Models\\Folio', model_id: folio.id },
        });
        if (dup) continue;
        // NOTE: Laravel also writes code_item_id=$value into this pivot (quirk);
        // Prisma model has no such column, so only the morph keys are set.
        await prisma.model_has_rate_inclusives.create({
          data: { rate_inclusive_id: BigInt(value), model_type: 'App\\Models\\Folio', model_id: folio.id },
        });
      }
      await prisma.folios.update({ where: { id: folio.id }, data: { updated_at: new Date() } });

      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Inclusive store error:', err); error(res, err?.message ?? 'Failed to store inclusives', 500); }
  }

  // DELETE /reservation/inclusive/:rateInclusive — Laravel deleteInclusives (:3845) detach.
  static async inclusiveDestroy(req: Request, res: Response): Promise<void> {
    try {
      const rateInclusiveRaw = Array.isArray(req.params.rateInclusive) ? req.params.rateInclusive[0] : req.params.rateInclusive;
      if (!rateInclusiveRaw || !/^\d+$/.test(rateInclusiveRaw)) { notFound(res, 'Not Found rateInclusive'); return; }

      const body: any = { ...(req.query as any), ...(req.body ?? {}) };
      const folioId = ReservationController.resolveTargetFolioId(body);
      if (!folioId) { notFound(res, 'Folio not found'); return; }
      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      await prisma.model_has_rate_inclusives.deleteMany({
        where: { rate_inclusive_id: BigInt(rateInclusiveRaw), model_type: 'App\\Models\\Folio', model_id: folio.id },
      });
      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('Inclusive destroy error:', err); error(res, 'Failed to delete inclusive', 500); }
  }
}

