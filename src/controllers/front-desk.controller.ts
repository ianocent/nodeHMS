import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES, moneyFormat, calculateCodePost } from '../utils/cmsConfig';
import { ROOM_STATUSES, MAID_STATUSES } from '../utils/cmsStatus';
import { dataSearch, applySearchField } from '../utils/search';
import { AuthController } from './auth.controller';
import { enqueueJob } from '../config/queue';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Laravel Room::AvailableRoom parity: room blocked if availability hold, active work order, or overlapping reservation
async function isRoomAvailableFor(propertyId: bigint, roomId: bigint, start: string, end: string, excludeFolioId?: bigint): Promise<boolean> {
  const s = new Date(start + 'T00:00:00.000Z');
  const e = new Date(end + 'T23:59:59.999Z');
  const [room, avail, workOrders, reservations] = await Promise.all([
    prisma.rooms.findUnique({ where: { id: roomId }, select: { id: true, deleted_at: true, room_status: true } }),
    prisma.room_availabilities.findMany({ where: { deleted_at: null, room_id: Number(roomId), date: { gte: s, lte: e } }, select: { id: true } }),
    prisma.work_orders.findMany({ where: { deleted_at: null, status: 1, room_id: roomId, date: { gte: s }, end_date: { lte: e } }, select: { id: true } }),
    prisma.reservations.findMany({
      where: {
        date: { gte: s, lte: e },
        status_reservation: { in: [STATUS_RESERVATION.check_in.id, STATUS_RESERVATION.reservation.id] },
        ...(excludeFolioId ? { folio_id: { not: excludeFolioId } } : {}),
        OR: [{ room_id: roomId }, { room_id_next: roomId }],
      },
      select: { id: true },
    }),
  ]);
  const isOOO = room?.room_status === 4; // out_of_order
  return !!room && !room.deleted_at && !isOOO && avail.length === 0 && workOrders.length === 0 && reservations.length === 0;
}

// Tax calc helper — Laravel TransactionController@tax parity (:664-709) for non-payment types
async function calcTaxForCode(code: string | bigint | null, sumPrice: number) {
  const codePost = code ? await prisma.code_posts.findUnique({ where: { id: BigInt(code) } }) : null;
  const calc = codePost ? calculateCodePost(
    {
      tax: codePost.tax ?? false,
      tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
      local_tax: codePost.local_tax ?? false,
      local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
      service_charge: codePost.service_charge ?? false,
      service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
      service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
      tax_include_local_tax: codePost.tax_include_local_tax ?? false,
    },
    sumPrice,
    false
  ) : { amount: sumPrice, service: 0, tax3: 0, pb1: 0, total: sumPrice };
  return { amount: calc.amount, svr_chrg: calc.service, pb1: calc.pb1, tax3: calc.tax3, total: calc.total, code: codePost ? String(codePost.id) : String(code ?? '') };
}

// Laravel Folio@getBalanceWithOutPosting parity (Folio.php:761-779)
// GIT parent: children company-billed + own all; GIT sub: guest-billed only; else all txns.
export async function folioBalanceWithoutPosting(folio: { id: bigint; type_reservation: string | null; parent: number | bigint | null }): Promise<number> {
  const isGit = String(folio.type_reservation ?? '').toLowerCase() === 'git';
  const parentNum = Number(folio.parent ?? 0);
  const sumNet = (rows: { type_amount: string | null; total: any }[]) =>
    rows.reduce((s, t) => s + (t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0)), 0);

  if (isGit && parentNum === 0) {
    const children = await prisma.folios.findMany({
      where: { parent: folio.id, deleted_at: null },
      select: { transactions: { where: { model_type: 'App\\Models\\CompanyProfile' }, select: { type_amount: true, total: true } } },
    });
    let balance = 0;
    for (const c of children) balance += sumNet(c.transactions);
    const own = await prisma.transactions.findMany({ where: { folio_id: folio.id }, select: { type_amount: true, total: true } });
    balance += sumNet(own);
    return balance;
  }

  if (isGit && parentNum !== 0) {
    const own = await prisma.transactions.findMany({
      where: { folio_id: folio.id, model_type: 'App\\Models\\GuestProfile' },
      select: { type_amount: true, total: true },
    });
    return sumNet(own);
  }

  const own = await prisma.transactions.findMany({ where: { folio_id: folio.id }, select: { type_amount: true, total: true } });
  return sumNet(own);
}

// Laravel Folio@getBalance parity (Folio.php:993-1013) — display balance.
// Same as folioBalanceWithoutPosting but GIT-parent children are NotCancel-filtered (status != 2).
export async function folioBalanceDisplay(folio: { id: bigint; type_reservation: string | null; parent: number | bigint | null }): Promise<number> {
  const isGit = String(folio.type_reservation ?? '').toLowerCase() === 'git';
  const parentNum = Number(folio.parent ?? 0);
  const sumNet = (rows: { type_amount: string | null; total: any }[]) =>
    rows.reduce((s, t) => s + (t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0)), 0);

  if (isGit && parentNum === 0) {
    const children = await prisma.folios.findMany({
      where: { parent: folio.id, deleted_at: null, status_reservation: { not: 2 } },
      select: { transactions: { where: { model_type: 'App\\Models\\CompanyProfile' }, select: { type_amount: true, total: true } } },
    });
    let balance = 0;
    for (const c of children) balance += sumNet(c.transactions);
    const own = await prisma.transactions.findMany({ where: { folio_id: folio.id }, select: { type_amount: true, total: true } });
    balance += sumNet(own);
    return balance;
  }

  return folioBalanceWithoutPosting(folio);
}

// Laravel Folio@transferTransaction parity (Folio.php:781-928) — runs during check-out.
// a) Sub-GIT: company-billed txns (+breakdowns) move to parent folio.
// b) auto_transfers where target_folio_id = this: pull source folio's company-billed txns into this folio
//    via void-reversal + new-row pattern (is_transfer 1/2), breakdowns copied.
// c) auto_transfers where folio_id = this: pull target folio's company-billed txns into this folio.
// Returns true when case (c) moved anything (Laravel is_auto_transfer flag → different error message).
export async function transferTransactionsForCheckout(
  folio: { id: bigint; type_reservation: string | null; parent: number | bigint | null; folio_number: string | null; company_profile_id: bigint | null },
  businessDate: string
): Promise<boolean> {
  const isGit = String(folio.type_reservation ?? '').toLowerCase() === 'git';
  const parentNum = Number(folio.parent ?? 0);
  const bDate = new Date(businessDate + 'T00:00:00.000Z');
  let isAutoTransfer = false;

  const copyBreakdowns = async (fromTxnId: bigint, toTxnId: bigint, targetFolioId: bigint | null, reversed: boolean, isTransfer: number, remarkSuffix: string) => {
    const rows = await prisma.transaction_breakdowns.findMany({ where: { transaction_id: fromTxnId } });
    for (const b of rows) {
      await prisma.transaction_breakdowns.create({
        data: {
          property_id: b.property_id,
          transaction_id: toTxnId,
          folio_id: targetFolioId ?? b.folio_id,
          type: b.type,
          date: bDate,
          code: b.code,
          type_payment_id: b.type_payment_id,
          rate_inclusive_id: b.rate_inclusive_id,
          code_item_id: b.code_item_id,
          description: b.description,
          amount: b.amount,
          total: b.total,
          type_amount: reversed ? (b.type_amount === 'MINUS' ? 'PLUS' : 'MINUS') : b.type_amount,
          pb1: b.pb1,
          svr_chrg: b.svr_chrg,
          surcharge: b.surcharge,
          tax3: b.tax3,
          time: b.time,
          bill_to: b.bill_to,
          model_type: b.model_type,
          model_id: b.model_id,
          remark: b.remark ? `${b.remark} - ${remarkSuffix}` : remarkSuffix,
          is_posting: b.is_posting,
          is_endshift: b.is_endshift,
          is_void: b.is_void,
          is_transfer: isTransfer,
          is_consolidate: b.is_consolidate,
          is_split: b.is_split,
          is_has_inclusive: b.is_has_inclusive,
          status: b.status,
          created_at: new Date(),
        },
      });
    }
  };

  const replicateTxn = async (src: any, overrides: Record<string, any>) => {
    const d: any = {
      property_id: src.property_id,
      folio_id: src.folio_id,
      type: src.type,
      uuid: randomUUID(),
      date: bDate,
      code: src.code,
      code_name: src.code_name,
      type_payment_id: src.type_payment_id,
      code_item_id: src.code_item_id,
      description: src.description,
      amount: src.amount,
      total: src.total,
      type_amount: src.type_amount,
      pb1: src.pb1,
      svr_chrg: src.svr_chrg,
      surcharge: src.surcharge,
      tax3: src.tax3,
      time: src.time,
      bill_to: src.bill_to,
      model_type: src.model_type,
      model_id: src.model_id,
      remark: src.remark,
      reference: src.reference,
      pos: src.pos,
      receipt: src.receipt,
      card_name: src.card_name,
      last_digit_card: src.last_digit_card,
      voucher: src.voucher,
      booking: src.booking,
      is_posting: src.is_posting,
      is_endshift: src.is_endshift,
      is_void: src.is_void,
      is_transfer: src.is_transfer,
      is_consolidate: src.is_consolidate,
      is_split: src.is_split,
      is_has_inclusive: src.is_has_inclusive,
      is_end_of_day: 0,
      status: src.status,
      source: src.source,
      created_at: new Date(),
    };
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) d[k] = v;
    }
    return prisma.transactions.create({ data: d });
  };

  const FOR_TRANSFER = { is_consolidate: 0, is_void: 0, is_split: 0, NOT: { is_transfer: 1 } };

  // a) Sub-GIT → move company-billed txns to parent folio
  if (isGit && parentNum !== 0) {
    const parent = await prisma.folios.findUnique({ where: { id: BigInt(parentNum) }, select: { id: true } });
    if (parent) {
      const rows = await prisma.transactions.findMany({ where: { folio_id: folio.id, model_type: 'App\\Models\\CompanyProfile' }, select: { id: true } });
      for (const t of rows) {
        await prisma.transactions.update({ where: { id: t.id }, data: { folio_id: parent.id } });
        await prisma.transaction_breakdowns.updateMany({ where: { transaction_id: t.id }, data: { folio_id: parent.id } });
      }
    }
  }

  // b) Configs where this folio is the transfer TARGET: pull source folio's company-billed txns here
  const asTarget = await prisma.auto_transfers.findMany({ where: { target_folio_id: Number(folio.id) } });
  for (const cfg of asTarget) {
    const sourceFolio = await prisma.folios.findUnique({ where: { id: BigInt(cfg.folio_id) }, select: { id: true, folio_number: true, company_profile_id: true } });
    if (!sourceFolio) continue;
    const txns = await prisma.transactions.findMany({
      where: { folio_id: sourceFolio.id, model_type: 'App\\Models\\CompanyProfile', ...FOR_TRANSFER },
    });
    for (const t of txns) {
      const voidRow = await replicateTxn(t, {
        folio_id: sourceFolio.id,
        void_code: String(t.id),
        type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
        is_transfer: 1,
        remark: `To - ${folio.folio_number ?? ''}`,
        uuid: randomUUID(),
      });
      await copyBreakdowns(t.id, voidRow.id, null, true, 1, `To - ${folio.folio_number ?? ''}`);

      const newRow = await replicateTxn(t, {
        folio_id: folio.id,
        void_code: String(t.id),
        is_transfer: 2,
        remark: t.remark ? `${t.remark} - from - ${sourceFolio.folio_number ?? ''}` : `from - ${sourceFolio.folio_number ?? ''}`,
        uuid: randomUUID(),
      });
      await copyBreakdowns(t.id, newRow.id, folio.id, false, 2, `from - ${sourceFolio.folio_number ?? ''}`);

      // attach to target folio's company profile ledger
      if (folio.company_profile_id) {
        await prisma.transactions.update({ where: { id: newRow.id }, data: { model_type: 'App\\Models\\CompanyProfile', model_id: folio.company_profile_id } });
      }
      await prisma.transactions.update({ where: { id: t.id }, data: { is_transfer: 1, remark: `To - ${folio.folio_number ?? ''}` } });
    }
  }

  // c) Configs where this folio is the SOURCE: pull target folio's company-billed txns into this folio
  const asSource = await prisma.auto_transfers.findMany({ where: { folio_id: Number(folio.id) } });
  for (const cfg of asSource) {
    const targetFolio = await prisma.folios.findUnique({ where: { id: BigInt(cfg.target_folio_id) }, select: { id: true, folio_number: true, company_profile_id: true } });
    if (!targetFolio) continue;
    const txns = await prisma.transactions.findMany({
      where: { folio_id: targetFolio.id, model_type: 'App\\Models\\CompanyProfile', ...FOR_TRANSFER },
    });
    for (const t of txns) {
      const voidRow = await replicateTxn(t, {
        void_code: String(t.id),
        type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
        is_transfer: 1,
        remark: `To - ${folio.folio_number ?? ''}`,
        uuid: randomUUID(),
      });
      await copyBreakdowns(t.id, voidRow.id, null, true, 1, `To - ${folio.folio_number ?? ''}`);

      const newRow = await replicateTxn(t, {
        folio_id: folio.id,
        is_transfer: 1,
        uuid: randomUUID(),
      });
      await copyBreakdowns(t.id, newRow.id, folio.id, false, 1, '');

      if (folio.company_profile_id) {
        await prisma.transactions.update({ where: { id: newRow.id }, data: { model_type: 'App\\Models\\CompanyProfile', model_id: folio.company_profile_id } });
      }
      await prisma.transactions.update({ where: { id: t.id }, data: { is_transfer: 1, remark: `To - ${folio.folio_number ?? ''}` } });
      isAutoTransfer = true;
    }
  }

  return isAutoTransfer;
}


const STATUS_RESERVATION = {
  check_in: { id: 0, code: 'check_in', name: 'Check In' },
  check_out: { id: 1, code: 'check_out', name: 'Check Out' },
  cancel_reservation: { id: 2, code: 'cancel_reservation', name: 'Cancelled' },
  reservation: { id: 3, code: 'reservation', name: 'Reservation' },
  in_house: { id: 4, code: 'in_house', name: 'In House' },
  pending: { id: 5, code: 'pending', name: 'Pending' },
};

const TYPE_RESERVATION = {
  fit: { code: 'fit', name: 'FIT' },
  git: { code: 'git', name: 'GIT' },
  vr: { code: 'vr', name: 'VR' },
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

function statusReservationColor(folio: any): { label: string; color: string; is_color: boolean }[] {
  if (folio.status_reservation === STATUS_RESERVATION.reservation.id && folio.is_request_cancel) {
    return [{ label: 'Request-Cancel', color: 'bg-yellow', is_color: true }];
  }
  return [{
    label: statusReservationLabel(folio.status_reservation),
    color: COLOR_RESERVATION[folio.status_reservation] || 'bg-success',
    is_color: true,
  }];
}

const MENU_ID = 63;

const TABLE_COLUMNS = [
  { key: 'res_date', label: 'Res Date', type: 'date' },
  { key: 'type_reservation', label: 'Type' },
  { key: 'message_bool', label: 'MSG', type: 'boolean' },
  { key: 'ign', label: 'IGN', type: 'boolean' },
  { key: 'is_do_not_disturb', label: 'DND', type: 'boolean' },
  { key: 'remark_bool', label: 'Remark', type: 'boolean' },
  { key: 'status_reservation_color', label: 'Status', is_html: true },
  { key: 'folio_number', label: 'Folio', is_link: true, uri: '/reservation/fit/reservation' },
  { key: 'guest_name', label: 'Guest Name' },
  { key: 'guest_status_color', label: 'Guest', is_html: true },
  { key: 'stay', label: 'Stay' },
  { key: 'room', label: 'Room' },
  { key: 'room_next', label: 'Room Next' },
  { key: 'company', label: 'Company' },
  { key: 'room_type', label: 'Room Type' },
  { key: 'room_status_color', label: 'Room Status', is_html: true },
  { key: 'room_clean_status_color', label: 'Clean Status', is_html: true },
  { key: 'check_in_date', label: 'Check In', type: 'date' },
  { key: 'check_out_date', label: 'Check Out', type: 'date' },
  { key: 'balance', label: 'Balance' },
  { key: 'sharer', label: 'Sharer' },
  { key: 'aa', label: 'A' },
  { key: 'cc', label: 'C' },
];

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

function idParamBig(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function parsePaginationFn(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 10;
  const search = query.search as string;
  const sort = query.sort as string || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  return { page, limit, search, sort, order };
}

export class FrontDeskController {
  // GET /api/front-desk
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search_field = req.query.search_field as string;
      const search_value = req.query.search_value as string;
      const type = (req.query.type as string) || 'check_in';
      const group = req.query.group as string;
      const displayStatus = req.query.display_status as string;
      const stayDates = req.query.stay_dates as string;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const propertyId = req.user?.lastProperty;

      const where: any = {
        deleted_at: null,
        is_pos_trx: false,
      };

      if (propertyId) where.property_id = propertyId;

      // display_status filter (parity Laravel FrontDeskController@index L37-73):
      // comma-separated status_reservation codes; absent => exclude cancelled only
      const hasDisplayStatus = !!(displayStatus && displayStatus.trim() !== '');
      if (hasDisplayStatus) {
        const codes = displayStatus.split(',').map((c: string) => c.trim()).filter(Boolean);
        const ids = codes
          .map((code: string) => {
            const found = Object.values(STATUS_RESERVATION).find((s: any) => s.code === code);
            return found ? found.id : null;
          })
          .filter((v: any) => v !== null);
        if (ids.length > 0) {
          where.status_reservation = { in: ids };
        }
      }

      // stay date range (parity L55-60): only when start_date && end_date && stay_dates
      if (stayDates && startDate && endDate) {
        const sd = new Date(startDate);
        const ed = new Date(endDate);
        ed.setHours(23, 59, 59, 999);
        if (stayDates === 'check_in') {
          where.check_in_date = { gte: sd, lte: ed };
        } else if (stayDates === 'check_out') {
          where.check_out_date = { gte: sd, lte: ed };
        } else if (stayDates === 'between') {
          where.OR = [
            { check_in_date: { gte: sd, lte: ed } },
            { check_out_date: { gte: sd, lte: ed } },
            { check_in_date: { lte: sd }, check_out_date: { gte: ed } },
          ];
        } else {
          where.check_out_date = { gte: sd, lte: ed };
        }
      }

      // Type-based filtering (skip default check_in status+date filter when user
      // explicitly picked display_status so the filter actually filters)
      if (type === 'check_in') {
        where.status_reservation = where.status_reservation ?? {
          in: [STATUS_RESERVATION.check_in.id, STATUS_RESERVATION.reservation.id],
        };
        if (!hasDisplayStatus) {
          where.check_in_date = { gte: new Date() };
        }
      } else if (type === 'check_out' && group === 'check-out') {
        where.status_reservation = where.status_reservation ?? {
          in: [STATUS_RESERVATION.check_out.id, STATUS_RESERVATION.check_in.id],
        };
        where.check_out_date = { gte: new Date() };
      } else if (type === 'folio') {
        where.type_reservation = { in: [TYPE_RESERVATION.fit.code, TYPE_RESERVATION.git.code, TYPE_RESERVATION.vr.code] };
      } else if (type === 'vr') {
        where.type_reservation = TYPE_RESERVATION.vr.code;
      }

      if (group === 'batch-check-out') {
        where.status_reservation = STATUS_RESERVATION.check_in.id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        where.check_out_date = { gte: today };
      }

      where.status_reservation = where.status_reservation ?? { notIn: [STATUS_RESERVATION.cancel_reservation.id] };

      // Search
      if (search_field && search_value) {
        where[search_field] = { contains: search_value, mode: 'insensitive' };
      }

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
              orderBy: { date: 'asc' },
              include: { 
                room_types: { select: { name: true } },
                rooms: { select: { name: true } },
              },
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
        const roomName = lastReservation?.rooms?.name || lastReservation?.room_name || '';
        const roomTypeName = lastReservation?.room_types?.name || lastReservation?.room_type_name || '';

        // Laravel Folio@getBalance parity: MINUS subtracts, GIT parent/sub variants
        const balance = await folioBalanceDisplay(f);

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
          room_clean_status_color: [],
          room_status_color: [],
          folio_number: f.folio_number,
          guest_name: guestName || '-',
          guest_status: { label: 'Regular', color: 'bg-green' },
          guest_status_color: [{ label: 'Regular', color: 'bg-green', is_color: true }],
          date_arrival: f.check_in_date,
          stay: 0,
room: roomName,
           room_next: lastReservation?.room_id_next ? (lastReservation.rooms?.name || '') : '',
          company: f.company_name || '',
          room_type: roomTypeName,
          check_in_date: f.check_in_date,
          check_out_date: f.check_out_date,
          balance: balance.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
          sharer: '',
          is_popup_other_guest: false,
          aa: lastReservation?.adult || 0,
          cc: lastReservation?.child || 0,
          actions: [],
        };
      }));

      // Table columns (filtered for batch-check-out)
      let table = [...TABLE_COLUMNS];
      if (group === 'batch-check-out') {
        const excludeKeys = ['message_bool', 'ign', 'remark_bool', 'is_do_not_disturb', 'stay', 'room_status_color', 'room_clean_status_color', 'sharer', 'aa', 'cc'];
        table = table.filter(c => !excludeKeys.includes(c.key));
      } else {
        table = table.filter(c => c.key !== 'res_date');
      }

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
      };

      success(res, formatted, 'Success', 200, {
        permission,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
        table,
      });
    } catch (err: any) {
      console.error('FrontDesk list error:', err);
      error(res, 'Failed to fetch front-desk data', 500);
    }
  }

// POST /api/front-desk/{id}/check-in
  static async checkIn(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          reservations: { where: { deleted_at: null }, select: { id: true, room_id: true, room_id_next: true, date: true, is_24_hour: true } },
        },
      });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // Laravel parity (Folio.php:1233): virtual reservation cannot be updated
      if (String(folio.type_reservation ?? '').toLowerCase() === 'vr') {
        badRequest(res, 'Virtual reservation cannot be updated');
        return;
      }

      // Laravel parity (Folio.php:1272): GIT master folio cannot check in directly
      const isGit = String(folio.type_reservation ?? '').toLowerCase() === 'git';
      if (isGit && Number(folio.parent ?? 0) === 0) {
        badRequest(res, 'Action not allowed');
        return;
      }

      // Laravel parity (Folio.php:1245-1269): mandatory guest profile fields per property config
      const pid = req.user?.lastProperty ?? 0n;
      if (folio.guest_profile_id) {
        const guest = await prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } });
        let mandatory: string[] = [];
        try {
          const propRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT mandatory_check_in FROM properties WHERE id = $1`,
            pid
          );
          const raw = propRows[0]?.mandatory_check_in;
          if (Array.isArray(raw)) mandatory = raw;
          else if (typeof raw === 'string' && raw.trim()) mandatory = JSON.parse(raw);
        } catch { /* column may not exist yet — treat as no mandatory fields */ }
        if (guest && mandatory.length > 0) {
          const missing = mandatory.filter((f: string) => {
            const v = (guest as any)[f];
            return v === null || v === undefined || v === '' || String(v).trim().toLowerCase() === 'null';
          });
          if (missing.length > 0) {
            badRequest(res, 'Guest Profile is not complete. Missing: ' + missing.join(', '));
            return;
          }
        }
      }

      // Laravel parity (Folio.php:1293-1299): check_in_date must equal business date
      const businessDate = await AuthController.getBusinessDate(pid);
      const folioCheckIn = folio.check_in_date ? new Date(folio.check_in_date.getTime() - folio.check_in_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null;
      if (!folio.is_virtual && folioCheckIn !== businessDate) {
        badRequest(res, 'Check in date is not valid');
        return;
      }

      // Resolve rooms BEFORE mutation (Laravel checks first, mutates last)
      const roomIds: bigint[] = [];
      for (const resv of folio.reservations) {
        const targetRoomId = resv.room_id_next ?? resv.room_id;
        if (targetRoomId != null) roomIds.push(targetRoomId);
      }

      if (!folio.is_virtual && roomIds.length > 0) {
        // Laravel parity (Folio.php:1285-1291): room maid_status must be Clean
        const rooms = await prisma.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, maid_status: true, name: true } });
        const notClean = rooms.filter(r => r.maid_status !== MAID_STATUSES.clean.id);
        if (notClean.length > 0) {
          badRequest(res, 'Room is not clean');
          return;
        }

        const checkInDate = folio.check_in_date ? folio.check_in_date.toISOString().slice(0, 10) : businessDate;
        const checkOutDate = folio.check_out_date ? folio.check_out_date.toISOString().slice(0, 10) : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        for (const roomId of roomIds) {
          const available = await isRoomAvailableFor(pid, roomId, checkInDate, checkOutDate, id);
          if (!available) {
            badRequest(res, `Room ${roomId} not available for check-in`);
            return;
          }
        }
      }

      // ── All guards passed — mutate now ──

      await prisma.folios.update({
        where: { id },
        data: {
          status_reservation: STATUS_RESERVATION.check_in.id,
          updated_at: new Date(),
        },
      });

      // Laravel parity (Folio.php:1347-1354): set ATA now; 24h folios get ETD = now
      const ata = new Date();
      for (const resv of folio.reservations) {
        const data: any = { ata };
        if (resv.is_24_hour === 1) data.etd = ata;
        await prisma.reservations.update({ where: { id: resv.id }, data });
      }
      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.check_in.id },
      });

      // Update room status: occupied (1), maid_status: clean (0)
      // Use room_id_next if exists (room change), otherwise room_id
      if (!folio.is_virtual && roomIds.length > 0) {
        const now = new Date();
        await prisma.rooms.updateMany({
          where: { id: { in: roomIds } },
          data: {
            room_status: ROOM_STATUSES.occupied.id,
            maid_status: MAID_STATUSES.clean.id,
            last_check_in_date: now,
            last_check_in_time: now,
            updated_at: now,
          },
        });
      }

      // Laravel dispatches SyncStaahRoomAvailability after every folio mutation
      // (Folio.php:1201/2100/2743) — push availability to channels event-driven.
      enqueueJob('sync-staah-room-availability', {
        propertyId: Number(folio.property_id),
        dateFrom: folio.check_in_date ? formatDate(new Date(folio.check_in_date)) : undefined,
        dateTo: folio.check_out_date ? formatDate(new Date(folio.check_out_date)) : undefined,
      });
      success(res, { folio_id: Number(id), status_reservation: STATUS_RESERVATION.check_in.id }, 'Check-in success');
    } catch (err: any) {
      console.error('FrontDesk checkIn error:', err);
      error(res, 'Failed to check in', 500);
    }
  }

// POST /api/front-desk/{id}/check-out
  static async checkOut(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const folio = await prisma.folios.findUnique({
        where: { id },
        include: { reservations: { where: { deleted_at: null }, select: { room_id: true, room_id_next: true, date: true, is_posting: true } } }
      });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // Laravel parity (Folio.php:1233): virtual reservation cannot be updated
      if (String(folio.type_reservation ?? '').toLowerCase() === 'vr') {
        badRequest(res, 'Virtual reservation cannot be updated');
        return;
      }

      // Laravel parity (Folio.php:1741): must be checked-in
      if (folio.status_reservation !== STATUS_RESERVATION.check_in.id) {
        badRequest(res, 'Status reservation is not check in');
        return;
      }

      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid);

      // Laravel parity (Folio.php:1748): auto-transfer charges per billing/auto-transfer setup
      const isAutoTransfer = await transferTransactionsForCheckout(folio as any, businessDate);

      // Laravel parity (Folio.php:1750): balance must be ~0 before checkout
      const balance = await folioBalanceWithoutPosting(folio as any);
      if (![0, 1, -1].includes(Math.ceil(balance))) {
        badRequest(res, isAutoTransfer
          ? 'The auto transfer process is successful, please make payment on the remaining balance'
          : 'Payment required');
        return;
      }

      // Laravel parity (Folio.php:1760-1768): delete future unposted reservations
      const bDate = new Date(businessDate + 'T00:00:00.000Z');
      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null, date: { gt: bDate }, is_posting: 0 },
        data: { deleted_at: new Date(), deleted_by: req.user?.id },
      });

      await prisma.folios.update({
        where: { id },
        data: {
          status_reservation: STATUS_RESERVATION.check_out.id,
          check_out_date: bDate,
          updated_at: new Date(),
        },
      });

      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.check_out.id, atd: new Date() },
      });

      // Update room status: vacant (0), maid_status: dirty (1)
      const roomIds: bigint[] = [];
      for (const resv of folio.reservations) {
        if (resv.room_id_next != null) roomIds.push(resv.room_id_next);
        else if (resv.room_id != null) roomIds.push(resv.room_id);
      }
      if (roomIds.length > 0) {
        const now = new Date();
        await prisma.rooms.updateMany({
          where: { id: { in: roomIds } },
          data: {
            room_status: ROOM_STATUSES.vacant.id,
            maid_status: MAID_STATUSES.dirty.id,
            last_check_out_date: now,
            last_check_out_time: now,
            updated_at: now,
          },
        });
      }

      enqueueJob('sync-staah-room-availability', {
        propertyId: Number(folio.property_id),
        dateFrom: folio.check_in_date ? formatDate(new Date(folio.check_in_date)) : undefined,
        dateTo: folio.check_out_date ? formatDate(new Date(folio.check_out_date)) : undefined,
      });
      success(res, { folio_id: Number(id), status_reservation: STATUS_RESERVATION.check_out.id, balance }, 'Check-out success');
    } catch (err: any) {
      console.error('FrontDesk checkOut error:', err);
      error(res, 'Failed to check out', 500);
    }
  }

// POST /api/front-desk/batch-check-out
  static async batchCheckOut(req: Request, res: Response): Promise<void> {
    try {
      const { idx } = req.body;

      if (!idx || !Array.isArray(idx) || idx.length === 0) {
        badRequest(res, 'idx array is required');
        return;
      }

      const ids = idx.map((id: any) => BigInt(id));

      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid);
      const bDate = new Date(businessDate + 'T00:00:00.000Z');

      const folios = await prisma.folios.findMany({
        where: { id: { in: ids } },
        include: { reservations: { where: { deleted_at: null }, select: { room_id: true, room_id_next: true, date: true, is_posting: true } } }
      });

      // Laravel parity: per-folio guards + auto-transfer + balance check
      const failed: { folio_id: number; message: string }[] = [];
      const passed: bigint[] = [];
      for (const folio of folios) {
        if (String(folio.type_reservation ?? '').toLowerCase() === 'vr') {
          failed.push({ folio_id: Number(folio.id), message: 'Virtual reservation cannot be updated' });
          continue;
        }
        if (folio.status_reservation !== STATUS_RESERVATION.check_in.id) {
          failed.push({ folio_id: Number(folio.id), message: 'Status reservation is not check in' });
          continue;
        }
        try {
          await transferTransactionsForCheckout(folio as any, businessDate);
        } catch (e: any) {
          failed.push({ folio_id: Number(folio.id), message: e?.message ?? 'Auto transfer failed' });
          continue;
        }
        const balance = await folioBalanceWithoutPosting(folio as any);
        if (![0, 1, -1].includes(Math.ceil(balance))) {
          failed.push({ folio_id: Number(folio.id), message: 'Payment required' });
          continue;
        }
        passed.push(folio.id);
      }

      if (passed.length > 0) {
        await prisma.reservations.updateMany({
          where: { folio_id: { in: passed }, deleted_at: null, date: { gt: bDate }, is_posting: 0 },
          data: { deleted_at: new Date(), deleted_by: req.user?.id },
        });

        await prisma.folios.updateMany({
          where: { id: { in: passed } },
          data: {
            status_reservation: STATUS_RESERVATION.check_out.id,
            check_out_date: bDate,
            updated_at: new Date(),
          },
        });

        await prisma.reservations.updateMany({
          where: { folio_id: { in: passed }, deleted_at: null },
          data: { status_reservation: STATUS_RESERVATION.check_out.id, atd: new Date() },
        });

        // GIT master auto-checkout (Laravel FrontDeskController :187-195):
        // when ALL non-cancel children of a GIT parent are checked out,
        // auto-checkout the parent too.
        const gitParents = new Set<bigint>();
        for (const folioId of passed) {
          const f = folios.find((x) => x.id === folioId);
          if (!f || !f.parent) continue;
          const parentFolio = await prisma.folios.findUnique({ where: { id: f.parent }, select: { type_reservation: true, status_reservation: true } });
          if (parentFolio && String(parentFolio.type_reservation ?? '').toLowerCase() === 'git' && parentFolio.status_reservation === STATUS_RESERVATION.check_in.id) {
            gitParents.add(f.parent);
          }
        }
        for (const parentId of gitParents) {
          const openChildren = await prisma.folios.count({
            where: {
              parent: parentId,
              status_reservation: STATUS_RESERVATION.check_in.id,
              deleted_at: null,
            },
          });
          if (openChildren === 0) {
            await prisma.folios.update({
              where: { id: parentId },
              data: { status_reservation: STATUS_RESERVATION.check_out.id, check_out_date: bDate, updated_at: new Date() },
            });
            await prisma.reservations.updateMany({
              where: { folio_id: parentId, deleted_at: null },
              data: { status_reservation: STATUS_RESERVATION.check_out.id, atd: new Date() },
            });
          }
        }

        // Update room status for all rooms: vacant (0), maid_status: dirty (1)
        const roomIds: bigint[] = [];
        for (const folio of folios) {
          if (!passed.includes(folio.id)) continue;
          for (const resv of folio.reservations) {
            if (resv.room_id_next != null) roomIds.push(resv.room_id_next);
            else if (resv.room_id != null) roomIds.push(resv.room_id);
          }
        }
        if (roomIds.length > 0) {
          const now = new Date();
          await prisma.rooms.updateMany({
            where: { id: { in: roomIds } },
            data: {
              room_status: ROOM_STATUSES.vacant.id,
              maid_status: MAID_STATUSES.dirty.id,
              last_check_out_date: now,
              last_check_out_time: now,
              updated_at: now,
            },
          });
        }
      }

      enqueueJob('sync-staah-room-availability', { propertyId: Number(req.user?.lastProperty ?? 0) });
      success(res, { updated: passed.length, failed }, 'Batch check-out success');
    } catch (err: any) {
      console.error('FrontDesk batchCheckOut error:', err);
      error(res, 'Failed to batch check out', 500);
    }
  }

  // ==================== TRANSACTION ====================
  // Parity Laravel TransactionController@getData â€” GET /transaction?folio_id=&filter=
  static async transactionList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = 99999;
      const folioId = req.query.folio_id as string;
      const filter = req.query.filter as string;
      const ledger = req.query.ledger_id as string;
      const pid = req.user?.lastProperty ?? 0n;

      const table = [
        { label: 'Date', key: 'date', type: 'date', is_search: false },
        { label: 'Code', key: 'code', type: 'text', is_search: false },
        { label: 'Card Name', key: 'card_name', type: 'text', is_search: false },
        { label: 'Card Number', key: 'last_digit_card', type: 'text', is_search: false },
        { label: 'Voucher', key: 'voucher', type: 'text', is_search: false },
        { label: 'Description', key: 'description', type: 'text', is_search: false },
        { label: 'Total', key: 'total', type: 'number', is_search: false },
        { label: 'Rate', key: 'rate', type: 'number', is_search: false },
        { label: 'PB1', key: 'pb1', type: 'number', is_search: false },
        { label: 'Svr Chrg', key: 'svr_chrg', type: 'number', is_search: false },
        { label: 'Surcharge', key: 'surcharge', type: 'number', is_search: false },
        { label: 'Overwrite Reason', key: 'remark', type: 'text', is_search: false },
        { label: 'Staff', key: 'staff', type: 'text', is_search: false },
        { label: 'Overwrite Time', key: 'time', type: 'date', is_search: false },
        { label: 'Bill To', key: 'bill_to', type: 'text', is_search: false },
        { label: 'Reference', key: 'reference', type: 'text', is_search: false },
        { label: 'Receipt', key: 'receipt', type: 'text', is_search: false },
        { label: 'Balance', key: 'balance', type: 'text', is_search: false },
        { label: 'Status', key: 'status', type: 'text', is_search: false },
      ];
      const pagination = { current_page: page, last_page: 1, per_page: limit, total: 0, from: 0, to: 0 };
      const permission = {
        view: true,
        add: req.user?.superUser || true,
        edit: req.user?.superUser || true,
      };

      if (!folioId || !/^\d+$/.test(folioId)) {
        success(res, [], 'Folio Not Found', 200, {
          table, pagination, permission,
          search_data: [],
          total_transaction: moneyFormat(0),
          folio: null,
          ledger_id: ledger ?? null,
        });
        return;
      }

      const id = BigInt(folioId);
      const [folio, txns] = await Promise.all([
        prisma.folios.findUnique({ where: { id }, include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' } } } }),
        prisma.transactions.findMany({ where: { folio_id: id, deleted_at: null }, orderBy: { created_at: 'desc' }, include: { type_payments: { select: { name: true } } } }),
      ]);

      if (!folio) {
        success(res, [], 'Folio Not Found', 200, {
          table, pagination, permission,
          search_data: [],
          total_transaction: moneyFormat(0),
          folio: null,
          ledger_id: ledger ?? null,
        });
        return;
      }

      let filtered = txns;
      if (filter === 'void') filtered = filtered.filter((t: any) => t.is_void);
      if (filter === 'refund') filtered = filtered.filter((t: any) => t.type === 'refund' || t.type === 'additional_refund');
      if (filter === 'split') filtered = filtered.filter((t: any) => t.is_split);
      if (filter === 'consolidate') filtered = filtered.filter((t: any) => t.is_consolidate);
      if (filter === 'transfer') filtered = filtered.filter((t: any) => t.is_transfer);

      const userIds = new Set<bigint>();
      filtered.forEach((t: any) => { if (t.created_by) userIds.add(BigInt(t.created_by)); if (t.updated_by) userIds.add(BigInt(t.updated_by)); });
      const users = userIds.size ? await prisma.users.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [];
      const userMap = new Map(users.map((u: any) => [String(u.id), u.name]));

      const modelIds = filtered.filter((t: any) => t.model_id).map((t: any) => t.model_id);
      const [companies, guests] = await Promise.all([
        prisma.company_profiles.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true } }).catch(() => []),
        prisma.guest_profiles.findMany({ where: { id: { in: modelIds } }, select: { id: true, first_name: true, last_name: true } }).catch(() => []),
      ]);
      const modelMap = new Map<string, string>();
      companies.forEach((c: any) => modelMap.set(String(c.id), c.name));
      guests.forEach((g: any) => modelMap.set(String(g.id), `${g.first_name || ''} ${g.last_name || ''}`.trim()));

      const formatRow = (t: any): any => {
        const isMinus = t.type_amount === 'MINUS';
        const minus = (v: any) => (isMinus ? -Number(v || 0) : Number(v || 0));
        const systemTypes = ['room_revenue', 'extra_bed', 'room_inclusive', 'extra_bed_inclusive'];
        let staff = 'POS';
        if (t.is_void || t.is_transfer || t.is_split || t.is_consolidate) {
          staff = (t.updated_by && userMap.get(String(t.updated_by))) || (t.created_by && userMap.get(String(t.created_by))) || 'SYSTEM';
        } else if (systemTypes.includes(t.type)) {
          staff = 'SYSTEM';
        } else {
          staff = (t.created_by && userMap.get(String(t.created_by))) || 'POS';
        }
        const code = t.code_name ?? t.type_payment_name ?? null;
        return {
          id: Number(t.id),
          date: t.date ? new Date(t.date).toLocaleDateString('en-GB').replace(/\//g, '/') : '',
          folio_id: Number(t.folio_id),
          folio_number: folio.folio_number,
          type: t.type,
          code,
          description: t.description,
          card_name: t.card_name,
          last_digit_card: t.last_digit_card,
          voucher: t.voucher,
          total: minus(t.total),
          rate: minus(t.amount),
          pb1: minus(t.pb1),
          svr_chrg: minus(t.svr_chrg),
          surcharge: minus(t.surcharge),
          tax3: minus(t.tax3),
          remark: t.is_void || t.is_split || t.is_transfer ? (t.remark || '') : '',
          staff,
          time: t.created_at ? new Date(t.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
          bill_to: (t.model_id && modelMap.get(String(t.model_id))) || '',
          reference: t.reference,
          pos: t.pos,
          receipt: t.receipt,
          balance: '*****',
          closingFormat: '',
          created_at: t.created_at,
          created_by: Number(t.created_by ?? 0),
          is_void: !!t.is_void,
          is_transfer: !!t.is_transfer,
          is_consolidate: !!t.is_consolidate,
          is_split: !!t.is_split,
          status: t.status,
          is_view: true,
          is_edit: true,
          is_need_approval: false,
        };
      };

      const rows = filtered.map(formatRow);
      const totalTransaction = filtered.reduce((sum: number, t: any) => sum + (t.type_amount === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0)), 0);

      const lastReservation = folio.reservations?.[folio.reservations.length - 1] || null;
      success(res, rows, 'Success', 200, {
        folio: {
          id: Number(folio.id),
          folio_number: folio.folio_number,
          guest_name: `${folio.first_name || ''} ${folio.last_name || ''}`.trim() || null,
          is_cancel: folio.status_reservation === 2,
          is_parent_git: folio.type_reservation === 'git' && Number(folio.parent) === 0,
          is_sub_git: folio.type_reservation === 'git' && Number(folio.parent) !== 0,
          is_vr: folio.type_reservation === 'vr',
          status_reservation: folio.status_reservation,
          special_instruction: {
            remark: folio.remark || '',
            is_gh: !!folio.is_gh,
            check_in_instruction: folio.check_in_instruction || '',
            check_out_instruction: folio.check_out_instruction || '',
            posting_instruction: folio.posting_instruction || '',
            remark_ins: folio.remark || '',
          },
          check_in_date: folio.check_in_date,
          check_out_date: folio.check_out_date,
          room: lastReservation?.room_name || '',
          room_type: lastReservation?.room_type_name || '',
        },
        ledger_id: ledger ?? null,
        table,
        pagination: { current_page: page, last_page: 1, per_page: limit, total: rows.length, from: rows.length ? 1 : 0, to: rows.length },
        permission,
        search_data: [],
        total_transaction: moneyFormat(totalTransaction),
      });
    } catch (err: any) { console.error('Transaction list error:', err); error(res, 'Failed to list transactions', 500); }
  }

  // POST /transaction — Laravel TransactionController@store parity (:422-662)
  // Shift-open guard, amount>0, tax() via type_payment/code_post, payment→MINUS + guaranted,
  // card/voucher required per type_payment config, event deposit row, ledger attach via bill_to.
  static async transactionStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = req.body || {};
      const { folio_id, type, date, code, description, remark } = body;
      if (!type) { badRequest(res, 'The type field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }
      if (!code) { badRequest(res, 'The code field is required.'); return; }

      const folio = await prisma.folios.findUnique({ where: { id: BigInt(folio_id) }, select: { id: true, company_profile_id: true, guest_profile_id: true } });
      if (!folio) { badRequest(res, 'The selected folio id is invalid.'); return; }

      // Laravel :459-478 — open shift guard (super-user bypass; role-menu check approximated)
      if (!req.user?.superUser) {
        const businessDate = await AuthController.getBusinessDate(pid);
        const bStart = new Date(businessDate + 'T00:00:00.000Z');
        const bEnd = new Date(bStart.getTime() + 86400000);
        const openShift = await prisma.shifts.findFirst({
          where: { property_id: pid, user_id: req.user?.id ?? 0n, date: { gte: bStart, lt: bEnd }, end: null, deleted_at: null },
          select: { id: true },
        });
        if (!openShift) { badRequest(res, 'Shift is not open'); return; }
      }

      const sumPrice = Number(body.amount ?? 0);
      if (!(sumPrice > 0)) { badRequest(res, 'Amount must be greater than 0'); return; }

      const isPaymentLike = ['payment', 'paidout', 'refund'].includes(String(type));
      let surcharge = 0;
      let idPayment: bigint | null = null;
      let idCode = String(code);
      let calc: any;

      if (isPaymentLike) {
        // Laravel tax(): request.code is the type_payment id here
        const tp = await prisma.type_payments.findUnique({ where: { id: BigInt(code) }, include: { code_posts: { select: { id: true } } } });
        if (!tp) { badRequest(res, 'Type payment not found'); return; }
        idPayment = tp.id;
        surcharge = Number(tp.surcharge_type ?? 0) === 1 ? Number(tp.surcharge ?? 0) : sumPrice * (Number(tp.surcharge ?? 0) / 100);
        idCode = String(tp.code_post_id);
        if (tp.card_no && !body.last_digit_card) { badRequest(res, 'The card number field is required.'); return; }
        if (tp.card_name && !body.card_name) { badRequest(res, 'The card name field is required.'); return; }
        if (tp.voucher && !body.voucher) { badRequest(res, 'The voucher field is required.'); return; }

        // Laravel :553-575 — company AR stop-credit check
        if (body.bill_to && String(body.bill_to).endsWith('-company')) {
          const cpId = String(body.bill_to).split('-')[0];
          const [cp, payment] = await Promise.all([
            prisma.company_profiles.findUnique({ where: { id: BigInt(cpId) }, select: { is_stop_credit: true } }),
            Promise.resolve(tp),
          ]);
          if (cp && payment.is_company_ar === true && !cp.is_stop_credit) {
            // Laravel sets $hasCredit=true but never uses it — no-op parity
          }
        }
      }

      // tax calc via code post
      const codePost = await prisma.code_posts.findUnique({ where: { id: BigInt(idCode) } });
      calc = codePost ? calculateCodePost(
        {
          tax: codePost.tax ?? false,
          tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
          local_tax: codePost.local_tax ?? false,
          local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
          service_charge: codePost.service_charge ?? false,
          service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
          service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
          tax_include_local_tax: codePost.tax_include_local_tax ?? false,
        },
        sumPrice,
        false
      ) : { amount: sumPrice, service: 0, tax3: 0, pb1: 0, total: sumPrice };

      const finalAmount = isPaymentLike ? sumPrice - surcharge : calc.amount;

      // Laravel :502-515 — payment → MINUS + guaranted flag
      const typeAmount = String(type) === 'payment' ? 'MINUS' : (body.type_amount ?? 'PLUS');
      if (String(type) === 'payment' && body.guaranted) {
        await prisma.folios.update({ where: { id: folio.id }, data: { guaranted: true } });
      }

      // business date (Laravel uses getBusinessDate for the posting date)
      const postingDateStr = await AuthController.getBusinessDate(pid);
      const postingDate = date ? new Date(date) : new Date(postingDateStr + 'T00:00:00.000Z');

      // ledger attach via bill_to ('{id}-company' / '{id}-guest'), fallback folio company
      let modelType: string | null = null;
      let modelId: bigint | null = null;
      if (body.bill_to && String(body.bill_to).includes('-')) {
        const [bid, bkind] = String(body.bill_to).split('-');
        if (bkind === 'company') { modelType = 'App\\Models\\CompanyProfile'; modelId = BigInt(bid); }
        else if (bkind === 'guest') { modelType = 'App\\Models\\GuestProfile'; modelId = BigInt(bid); }
      }
      if (!modelType) {
        modelType = 'App\\Models\\CompanyProfile';
        modelId = folio.company_profile_id;
      }

      const created = await prisma.transactions.create({
        data: {
          property_id: pid,
          folio_id: folio.id,
          type,
          uuid: randomUUID(),
          date: postingDate,
          code: idCode,
          code_name: body.code_name ?? codePost?.name ?? null,
          type_payment_id: idPayment,
          code_item_id: body.code_item_id ? BigInt(body.code_item_id) : null,
          description: description ?? null,
          overwrite_reason: body.overwrite_reason ?? null,
          time: body.time ?? null,
          bill_to: body.bill_to ?? null,
          reference: body.reference ?? null,
          pos: body.pos ?? null,
          receipt: body.receipt ?? null,
          last_digit_card: body.last_digit_card ? parseInt(body.last_digit_card) : null,
          card_name: body.card_name ?? null,
          voucher: body.voucher ?? null,
          booking: body.booking ?? null,
          amount: finalAmount,
          total: calc.total,
          svr_chrg: calc.service,
          pb1: calc.pb1,
          tax3: calc.tax3,
          surcharge,
          type_amount: typeAmount,
          status: 1,
          source: body.is_pos_deposit ? 'pos' : 'hms',
          is_event_deposit: body.is_event_deposit ? 0 : 1,
          created_at: new Date(),
          created_by: req.user?.id ?? null,
        },
      });

      // Laravel :604-620 — event deposit side effect
      if (body.is_event_deposit) {
        await prisma.deposit_events.create({
          data: {
            property_id: pid,
            folio_id: folio.id,
            date: postingDate,
            type_payment_id: idPayment ?? BigInt(code),
            amount: Math.round(Number(body.raw_total ?? calc.total ?? sumPrice)),
            status: 1,
            created_by: req.user?.id ?? null,
          },
        }).catch(() => {});
      }

      success(res, { id: Number(created.id) }, 'Success');
    } catch (err: any) { console.error('Transaction store error:', err); error(res, 'Failed to create transaction', 500); }
  }

  static async transactionShow(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Transaction not found'); return; }
      const id = BigInt(raw);
      const data = await prisma.transactions.findUnique({ where: { id }, include: { type_payments: true, folios: { select: { folio_number: true } } } });
      if (!data) { notFound(res, 'Transaction not found'); return; }
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load transaction', 500); }
  }

  // Replicates Laravel TransactionController@create (GET /transaction/create?folio_id=&type_button=)
  static async transactionCreate(req: Request, res: Response): Promise<void> {
    try {
      const folioId = String(req.query.folio_id ?? '');
      if (!folioId || !/^\d+$/.test(folioId)) { badRequest(res, 'The folio id field is required.'); return; }
      const id = BigInt(folioId);
      const folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          company_profiles_folios_company_profile_idTocompany_profiles: { select: { id: true, name: true } },
        },
      });
      if (!folio) { badRequest(res, 'The selected folio id is invalid.'); return; }
      const guest = folio.guest_profile_id ? await prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } }).catch(() => null) : null;

      const pid = BigInt(req.user?.lastProperty ?? 0);
      const [typePayments, postCodeManual, transferFolios] = await Promise.all([
        prisma.type_payments.findMany({
          where: { deleted_at: null, status: 1, ...(req.user?.lastProperty ? { property_id: pid } : {}), code_posts: { type: 'IS_PAYMENT' } },
          include: { code_posts: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
        }),
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: 1, type: 'DEFAULT', ...(req.user?.lastProperty ? { property_id: pid } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        String(req.query.type_button ?? '') === 'transfer'
          ? prisma.folios.findMany({
              where: { deleted_at: null, id: { not: id }, status_reservation: 0 },
              select: { id: true, folio_number: true },
              orderBy: { id: 'desc' },
            })
          : Promise.resolve([]),
      ]);

      const ledgers: { value: string; label: string }[] = [];
      const company = folio.company_profiles_folios_company_profile_idTocompany_profiles;
      if (company?.name) ledgers.push({ value: `${Number(company.id)}-company`, label: company.name });
      if (guest?.id) ledgers.push({ value: `${Number(guest.id)}-guest`, label: `${guest.first_name || ''} ${guest.last_name || ''}`.trim() });

      const txns = await prisma.transactions.findMany({ where: { folio_id: id }, select: { total: true, type_amount: true } });
      let total = txns.reduce((sum: number, t: any) => sum + (t.type_amount === 'MINUS' ? -Number(t.total) : Number(t.total)), 0);
      if (total === 0 && folio.cash_on_arrival) {
        const resv = await prisma.reservations.findMany({ where: { folio_id: id }, select: { total: true } });
        total = resv.reduce((sum: number, r: any) => sum + Number(r.total ?? 0), 0);
      }

      success(res, bigintToNumber(folio), 'Success', 200, {
        master: {
          statuses: STATUSES,
          ledgers,
          code_posts: typePayments.map((tp: any) => ({ value: Number(tp.id), label: `${tp.code_posts?.name || ''} - ${tp.name}` })),
          postCodeManual: postCodeManual.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
          folios: transferFolios.map((f: any) => ({ value: Number(f.id), label: f.folio_number })),
          paid_out: total < 0 ? moneyFormat(-total) : 0,
          payment: total > 0 ? moneyFormat(total) : 0,
          bussiness_date: await AuthController.getBusinessDate(req.user?.lastProperty ?? null),
        },
      });
    } catch (err: any) { console.error('Transaction create error:', err); error(res, 'Failed to load transaction form', 500); }
  }

  // Replicates Laravel TransactionController@folio (GET /transaction/folio?folio_id=)
  static async transactionFolio(req: Request, res: Response): Promise<void> {
    try {
      const folioId = String(req.query.folio_id ?? '');
      if (!folioId || !/^\d+$/.test(folioId)) { badRequest(res, 'The folio id field is required.'); return; }
      const id = BigInt(folioId);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const folios = await prisma.folios.findMany({
        where: { deleted_at: null, id: { not: id }, status_reservation: 0, ...(req.user?.lastProperty ? { property_id: pid } : {}) },
        include: {
          company_profiles_folios_company_profile_idTocompany_profiles: { select: { name: true } },
        },
        orderBy: { id: 'desc' },
      });
      const guestIds = folios.map((f: any) => f.guest_profile_id).filter(Boolean);
      const guests = guestIds.length
        ? await prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } })
        : [];
      const guestMap = new Map(guests.map((g: any) => [Number(g.id), g]));
      success(res, folios.map((f: any) => ({
        value: Number(f.id),
        label: `${f.folio_number || ''} - ${f.company_profiles_folios_company_profile_idTocompany_profiles?.name || ''} - ${(guestMap.get(Number(f.guest_profile_id))?.first_name || '') + ' ' + (guestMap.get(Number(f.guest_profile_id))?.last_name || '')}`.trim(),
      })), 'Success');
    } catch (err: any) { console.error('Transaction folio error:', err); error(res, 'Failed to load folios', 500); }
  }

  // PUT /front-desk/data/:id - save folio remark/message fields (Laravel frontend flow)
  static async updateData(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const whitelist = ['remark', 'remark_ins', 'check_in_instruction', 'check_out_instruction', 'posting_instruction', 'image'];
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      for (const key of whitelist) {
        if (req.body && req.body[key] !== undefined) data[key] = req.body[key];
      }
      if (Object.keys(data).length <= 2) { badRequest(res, 'No fields to update'); return; }
      const folio = await prisma.folios.update({ where: { id }, data });
      success(res, bigintToNumber(folio), 'Success');
    } catch (err: any) { console.error('Front desk update data error:', err); error(res, 'Failed to update', 500); }
  }

  static async transactionVoid(req: Request, res: Response): Promise<void> {
    // Laravel parity: single-id void goes through the SAME reversal logic as bulk.
    // (was: bare is_void=1 without reversal row — breaks double-entry)
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    req.body = { idx: [id], remark: req.body?.reason ?? req.body?.remark ?? '' };
    return FrontDeskController.transactionVoidBulk(req, res);
  }

  // POST /transaction/void?folio_id= — Laravel TransactionController@void parity (:711-745)
  // Bulk idx → mark is_void + replicate REVERSAL row (type_amount flipped, void_code=orig id,
  // request remark, is_end_of_day=0) so ledger stays balanced.
  static async transactionVoidBulk(req: Request, res: Response): Promise<void> {
    try {
      const { idx, remark } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }
      if (!remark || typeof remark !== 'string') { badRequest(res, 'The remark field is required.'); return; }

      const ids = idx.map((v: any) => BigInt(v));
      const txns = await prisma.transactions.findMany({ where: { id: { in: ids } } });

      for (const t of txns) {
        await prisma.transactions.update({
          where: { id: t.id },
          data: { is_void: 1, updated_at: new Date(), updated_by: req.user?.id ?? null },
        });

        // Reversal entry (Laravel replicate with flipped type_amount)
        await prisma.transactions.create({
          data: {
            property_id: t.property_id,
            folio_id: t.folio_id,
            type: t.type,
            uuid: randomUUID(),
            date: t.date,
            code: t.code,
            code_name: t.code_name,
            type_payment_id: t.type_payment_id,
            code_item_id: t.code_item_id,
            description: t.description,
            amount: t.amount,
            total: t.total,
            type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
            pb1: t.pb1,
            svr_chrg: t.svr_chrg,
            surcharge: t.surcharge,
            tax3: t.tax3,
            time: t.time,
            bill_to: t.bill_to,
            model_type: t.model_type,
            model_id: t.model_id,
            remark,
            reference: t.reference,
            pos: t.pos,
            receipt: t.receipt,
            card_name: t.card_name,
            last_digit_card: t.last_digit_card,
            voucher: t.voucher,
            booking: t.booking,
            is_posting: t.is_posting,
            is_endshift: t.is_endshift,
            is_void: 1,
            is_transfer: t.is_transfer,
            is_consolidate: t.is_consolidate,
            is_split: t.is_split,
            is_has_inclusive: t.is_has_inclusive,
            is_end_of_day: 0,
            void_code: String(t.id),
            status: t.status,
            source: t.source,
            created_at: new Date(),
            created_by: req.user?.id ?? null,
          },
        });
      }

      success(res, null, 'Success');
    } catch (err: any) { console.error('Transaction void bulk error:', err); error(res, 'Failed to void transactions', 500); }
  }

  // POST /transaction/transfer?folio_id= — Laravel TransactionController@transfer parity (:752-888)
  // body: { idx: number[], folio_id } — move charges to another folio via void/new replicate pair.
  static async transactionTransfer(req: Request, res: Response): Promise<void> {
    try {
      const { idx, folio_id } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }

      const targetFolio = await prisma.folios.findUnique({ where: { id: BigInt(folio_id) }, select: { id: true, folio_number: true, company_profile_id: true } });
      if (!targetFolio) { badRequest(res, 'The selected folio id is invalid.'); return; }

      const txns = await prisma.transactions.findMany({ where: { id: { in: idx.map((v: any) => BigInt(v)) } }, include: { folios: { select: { folio_number: true } } } });
      if (txns.length > 0 && String(txns[0].folio_id) === String(targetFolio.id)) {
        badRequest(res, 'Folio is required');
        return;
      }
      if (!targetFolio.company_profile_id) { badRequest(res, 'Company Profile Not Found'); return; }

      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid);
      const bDate = new Date(businessDate + 'T00:00:00.000Z');

      const copyBreakdowns = async (fromTxnId: bigint, toTxnId: bigint, targetFid: bigint | null, reversed: boolean, isTransfer: number, remarkSuffix: string) => {
        const rows = await prisma.transaction_breakdowns.findMany({ where: { transaction_id: fromTxnId } });
        for (const b of rows) {
          await prisma.transaction_breakdowns.create({
            data: {
              property_id: b.property_id,
              transaction_id: toTxnId,
              folio_id: targetFid ?? b.folio_id,
              type: b.type,
              date: bDate,
              code: b.code,
              type_payment_id: b.type_payment_id,
              code_item_id: b.code_item_id,
              description: b.description,
              amount: b.amount,
              total: b.total,
              type_amount: reversed ? (b.type_amount === 'MINUS' ? 'PLUS' : 'MINUS') : b.type_amount,
              pb1: b.pb1, svr_chrg: b.svr_chrg, surcharge: b.surcharge, tax3: b.tax3,
              time: b.time, bill_to: b.bill_to, model_type: b.model_type, model_id: b.model_id,
              remark: b.remark ? `${b.remark} - ${remarkSuffix}` : remarkSuffix,
              is_transfer: isTransfer,
              is_consolidate: b.is_consolidate, is_split: b.is_split, is_has_inclusive: b.is_has_inclusive,
              status: b.status,
              created_at: new Date(),
            },
          });
        }
      };

      for (const t of txns) {
        const isRoomRevenue = t.type === 'room_revenue';
        const newDate = isRoomRevenue ? bDate : t.date;

        // reversal row on source folio
        const voidRow = await prisma.transactions.create({
          data: {
            property_id: t.property_id, folio_id: t.folio_id, type: t.type, uuid: randomUUID(),
            date: newDate, code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id,
            code_item_id: t.code_item_id, description: t.description, amount: t.amount, total: t.total,
            type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
            pb1: t.pb1, svr_chrg: t.svr_chrg, surcharge: t.surcharge, tax3: t.tax3,
            time: t.time, bill_to: t.bill_to, model_type: t.model_type, model_id: t.model_id,
            remark: `To - ${targetFolio.folio_number ?? ''}`,
            is_transfer: 1, is_end_of_day: 0, void_code: String(t.id),
            status: t.status, source: t.source, created_at: new Date(), created_by: req.user?.id ?? null,
          },
        });
        await copyBreakdowns(t.id, voidRow.id, null, true, 1, `To - ${targetFolio.folio_number ?? ''}`);

        // new row on target folio
        const newRow = await prisma.transactions.create({
          data: {
            property_id: t.property_id, folio_id: targetFolio.id, type: t.type, uuid: randomUUID(),
            date: newDate, code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id,
            code_item_id: t.code_item_id, description: t.description, amount: t.amount, total: t.total,
            type_amount: t.type_amount,
            pb1: t.pb1, svr_chrg: t.svr_chrg, surcharge: t.surcharge, tax3: t.tax3,
            time: t.time, bill_to: t.bill_to,
            model_type: 'App\\Models\\CompanyProfile', model_id: targetFolio.company_profile_id,
            remark: t.remark ? `${t.remark} - from - ${t.folios?.folio_number ?? ''}` : `from - ${t.folios?.folio_number ?? ''}`,
            is_transfer: 2, is_end_of_day: 0, void_code: String(t.id),
            status: t.status, source: t.source, created_at: new Date(), created_by: req.user?.id ?? null,
          },
        });
        await copyBreakdowns(t.id, newRow.id, targetFolio.id, false, 2, `from - ${t.folios?.folio_number ?? ''}`);

        await prisma.transactions.update({ where: { id: t.id }, data: { is_transfer: 1, remark: `To - ${targetFolio.folio_number ?? ''}` } });
      }

      success(res, null, 'Success');
    } catch (err: any) { console.error('Transaction transfer error:', err); error(res, 'Failed to transfer transactions', 500); }
  }

  // POST /transaction/refund — Laravel TransactionController@refund parity (:895-927)
  // body: { idx: number[], remark? } — void + replicate with type='refund' and reversed type_amount.
  static async transactionRefund(req: Request, res: Response): Promise<void> {
    try {
      const { idx, remark } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }

      const txns = await prisma.transactions.findMany({ where: { id: { in: idx.map((v: any) => BigInt(v)) } } });
      for (const t of txns) {
        await prisma.transactions.update({ where: { id: t.id }, data: { is_void: 1, updated_at: new Date(), updated_by: req.user?.id ?? null } });
        await prisma.transactions.create({
          data: {
            property_id: t.property_id, folio_id: t.folio_id, type: 'refund', uuid: randomUUID(),
            date: t.date, code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id,
            code_item_id: t.code_item_id, description: t.description, amount: t.amount, total: t.total,
            type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
            pb1: t.pb1, svr_chrg: t.svr_chrg, surcharge: t.surcharge, tax3: t.tax3,
            time: t.time, bill_to: t.bill_to, model_type: t.model_type, model_id: t.model_id,
            remark: remark ?? t.remark, void_code: String(t.id), is_void: 1,
            is_transfer: t.is_transfer, is_consolidate: t.is_consolidate, is_split: t.is_split,
            is_has_inclusive: t.is_has_inclusive, is_end_of_day: t.is_end_of_day,
            status: t.status, source: t.source, created_at: new Date(), created_by: req.user?.id ?? null,
          },
        });
      }
      success(res, null, 'Success');
    } catch (err: any) { console.error('Transaction refund error:', err); error(res, 'Failed to refund transactions', 500); }
  }

  // POST /transaction/consolidate — Laravel TransactionController@consolidate parity (:966-1032)
  // body: { idx: number[], folio_id, code, remark? } — merge charges into one 'consolidate' transaction.
  static async transactionConsolidate(req: Request, res: Response): Promise<void> {
    try {
      const { idx, folio_id, code, remark } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }
      if (!code) { badRequest(res, 'The code field is required.'); return; }

      const folio = await prisma.folios.findUnique({ where: { id: BigInt(folio_id) }, select: { id: true } });
      if (!folio) { badRequest(res, 'The selected folio id is invalid.'); return; }

      const txns = await prisma.transactions.findMany({ where: { id: { in: idx.map((v: any) => BigInt(v)) } } });
      let total = 0;
      for (const t of txns) total += t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0);
      const amountAbs = total > 0 ? total : total * -1;

      const calc = await calcTaxForCode(code, amountAbs);

      const newTxn = await prisma.transactions.create({
        data: {
          property_id: req.user?.lastProperty ?? 0n,
          folio_id: folio.id,
          date: new Date(),
          code: calc.code,
          type: 'consolidate',
          total: calc.total,
          svr_chrg: calc.svr_chrg,
          pb1: calc.pb1,
          surcharge: 0,
          tax3: calc.tax3,
          amount: calc.amount,
          type_amount: total > 0 ? 'PLUS' : 'MINUS',
          status: 1,
          is_consolidate: 1,
          created_at: new Date(),
          created_by: req.user?.id ?? null,
        },
      });

      for (const t of txns) {
        await prisma.transactions.update({ where: { id: t.id }, data: { is_consolidate: 1, remark: remark ?? t.remark, updated_at: new Date() } });
        await prisma.transactions.create({
          data: {
            property_id: t.property_id, folio_id: t.folio_id, type: t.type, uuid: randomUUID(),
            date: t.date, code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id,
            code_item_id: t.code_item_id, description: t.description, amount: t.amount, total: t.total,
            type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
            pb1: t.pb1, svr_chrg: t.svr_chrg, surcharge: t.surcharge, tax3: t.tax3,
            time: t.time, bill_to: t.bill_to, model_type: t.model_type, model_id: t.model_id,
            remark: remark ?? t.remark, void_code: String(t.id), is_void: 1, is_consolidate: 1,
            is_transfer: t.is_transfer, is_split: t.is_split, is_has_inclusive: t.is_has_inclusive,
            is_end_of_day: t.is_end_of_day, status: t.status, source: t.source,
            created_at: new Date(), created_by: req.user?.id ?? null,
          },
        });
      }

      success(res, { id: Number(newTxn.id) }, 'Success');
    } catch (err: any) { console.error('Transaction consolidate error:', err); error(res, 'Failed to consolidate transactions', 500); }
  }

  // POST /transaction/split — Laravel TransactionController@split parity (:1035-1140)
  // body: { idx: number[], folio_id, amount, code, remark? } — split last selected transaction into two.
  static async transactionSplit(req: Request, res: Response): Promise<void> {
    try {
      const { idx, folio_id, amount, code, remark } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }
      if (amount === undefined || amount === null || Number(amount) < 0) { badRequest(res, 'The amount must be at least 0'); return; }
      if (!code) { badRequest(res, 'The code field is required.'); return; }

      const trxId = BigInt(idx[idx.length - 1]);
      const orig = await prisma.transactions.findFirst({ where: { id: trxId, folio_id: BigInt(folio_id) } });
      if (!orig) { badRequest(res, 'Transaction Not Found'); return; }

      await prisma.transactions.update({ where: { id: orig.id }, data: { is_split: 1, updated_at: new Date() } });

      if (Number(amount) > Number(orig.total ?? 0)) {
        badRequest(res, 'Total Input is more than transaction total');
        return;
      }

      const amountOrigin = Number(amount);

      // first: new txn for the split-off amount with the requested code post
      const calc1 = await calcTaxForCode(code, amountOrigin);
      await prisma.transactions.create({
        data: {
          property_id: orig.property_id, folio_id: orig.folio_id, type: orig.type, uuid: randomUUID(),
          date: orig.date, code: calc1.code, code_name: orig.code_name, type_payment_id: orig.type_payment_id,
          description: orig.description,
          amount: calc1.amount, total: calc1.total, pb1: calc1.pb1, svr_chrg: calc1.svr_chrg,
          surcharge: 0, tax3: calc1.tax3,
          time: orig.time, bill_to: orig.bill_to, model_type: orig.model_type, model_id: orig.model_id,
          remark: remark ?? orig.remark,
          type_amount: orig.type_amount,
          is_split: 0, is_posting: orig.is_posting, is_endshift: orig.is_endshift,
          status: orig.status, source: orig.source, created_at: new Date(), created_by: req.user?.id ?? null,
        },
      });

      // second: remainder on the original code post
      const remainder = Number(orig.total ?? 0) - amountOrigin;
      const calc2 = await calcTaxForCode(orig.code, remainder);
      await prisma.transactions.create({
        data: {
          property_id: orig.property_id, folio_id: orig.folio_id, type: orig.type, uuid: randomUUID(),
          date: orig.date, code: String(orig.code ?? calc2.code), code_name: orig.code_name, type_payment_id: orig.type_payment_id,
          code_item_id: orig.code_item_id,
          description: orig.description,
          amount: remainder, total: remainder, pb1: orig.pb1, svr_chrg: orig.svr_chrg,
          surcharge: orig.surcharge, tax3: orig.tax3,
          time: orig.time, bill_to: orig.bill_to, model_type: orig.model_type, model_id: orig.model_id,
          remark: remark ?? orig.remark,
          type_amount: orig.type_amount,
          is_split: 0, is_posting: orig.is_posting, is_endshift: orig.is_endshift,
          status: orig.status, source: orig.source, created_at: new Date(), created_by: req.user?.id ?? null,
        },
      });

      // third: reversal of the original
      await prisma.transactions.create({
        data: {
          property_id: orig.property_id, folio_id: orig.folio_id, type: orig.type, uuid: randomUUID(),
          date: orig.date, code: orig.code, code_name: orig.code_name, type_payment_id: orig.type_payment_id,
          code_item_id: orig.code_item_id, description: orig.description, amount: orig.amount, total: orig.total,
          type_amount: orig.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
          pb1: orig.pb1, svr_chrg: orig.svr_chrg, surcharge: orig.surcharge, tax3: orig.tax3,
          time: orig.time, bill_to: orig.bill_to, model_type: orig.model_type, model_id: orig.model_id,
          remark: orig.remark, void_code: String(orig.id), is_void: 1,
          is_transfer: orig.is_transfer, is_consolidate: orig.is_consolidate, is_split: orig.is_split,
          is_has_inclusive: orig.is_has_inclusive, is_end_of_day: orig.is_end_of_day,
          status: orig.status, source: orig.source, created_at: new Date(), created_by: req.user?.id ?? null,
        },
      });

      success(res, { id: Number(orig.id) }, 'Success');
    } catch (err: any) { console.error('Transaction split error:', err); error(res, 'Failed to split transaction', 500); }
  }

  // ==================== BATCH POSTING ====================
static async batchPostingList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: pid, deleted_at: null };
      if (req.query.search) {
        where.description = { contains: String(req.query.search), mode: 'insensitive' };
      }

      // parity TransactionTemp::formatTable (options: folios check-in, code items active)
      const [folioOptions, codeItemOptions] = await Promise.all([
        prisma.folios.findMany({
          where: { status_reservation: STATUS_RESERVATION.check_in.id, deleted_at: null },
          select: { id: true, folio_number: true },
          orderBy: { id: 'desc' },
          take: 100,
        }),
        prisma.code_items.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true, sales: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const table = [
        {
          label: 'Folio', key: 'folio_id', type: 'select',
          options: folioOptions.map((f: any) => ({ value: Number(f.id), label: f.folio_number })),
          is_search: false,
        },
        { label: 'Date', key: 'date', type: 'none', is_search: false },
        {
          label: 'Item Code', key: 'code_item_id', type: 'select',
          options: codeItemOptions.map((c: any) => ({ value: Number(c.id), label: c.name, amount: moneyFormat(c.sales) })),
          related: ['amount'], is_related: true, is_search: false,
        },
        { label: 'Remark', key: 'description', type: 'text', is_search: true },
        { label: 'Total Amount', key: 'amount', type: 'number', is_search: false },
        { label: 'Staff', key: 'staff', type: 'none', is_search: false },
        { label: 'Overwrite Time', key: 'time', type: 'none', is_search: false },
      ];

      applySearchField(where, req, table);

      const [data, total] = await Promise.all([
        prisma.transaction_temps.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { folios: { select: { folio_number: true } } },
        }),
        prisma.transaction_temps.count({ where }),
      ]);

      const userIds = [...new Set(data.map((d) => d.created_by).filter((x): x is bigint => x !== null))];
      const users = userIds.length > 0
        ? await prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [];
      const userMap = new Map(users.map((u) => [Number(u.id), u.name]));

      const formatted = bigintToNumber(data).map((r: any) => ({
        ...r,
        folio_id: { value: r.folio_id, label: r.folios?.folio_number ?? '' },
        code: { value: r.code_item_id, label: r.code_item_name ?? '' },
        code_item_id: { value: r.code_item_id, label: r.code_item_name ?? '' },
        description: (r.description || '').toUpperCase(),
        total: r.type_amount === 'MINUS' ? -Math.abs(r.total) : r.total,
        amount: r.total,
        staff: r.created_by ? userMap.get(Number(r.created_by)) || '' : '',
        time: r.created_at ? new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
        folios: undefined,
      }));

      success(res, formatted, 'Success', 200, {
        table,
        search_data: dataSearch(req, table) as any,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Batch posting list error:', err); error(res, 'Failed to list batch postings', 500); }
  }

  // Laravel BatchPostingController@batchPosting parity (:385-428):
  // promote all current user's temps into transactions, then forceDelete temps — atomically.
  static async batchPostingCommit(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const temps = await prisma.transaction_temps.findMany({ where: { created_by: userId, deleted_at: null } });
      if (temps.length === 0) { notFound(res, 'Data not found'); return; }

      await prisma.$transaction(async (tx: any) => {
        for (const t of temps) {
          await tx.transactions.create({
            data: {
              property_id: t.property_id,
              folio_id: t.folio_id,
              type: t.type,
              type_amount: t.type_amount ?? 'PLUS',
              date: t.date,
              code: String(t.code ?? ''),
              code_item_id: t.code_item_id ?? undefined,
              description: t.description,
              overwrite_reason: t.overwrite_reason,
              time: t.time ? new Date(`1970-01-01T${String(t.time).substring(0, 8)}Z`) : undefined,
              bill_to: t.bill_to != null ? String(t.bill_to) : undefined,
              amount: t.amount ?? 0,
              pb1: t.pb1 ?? 0,
              svr_chrg: t.svr_chrg ?? 0,
              tax3: t.tax3 ?? 0,
              total: t.total ?? 0,
              surcharge: t.surcharge ?? 0,
              reference: t.reference,
              pos: t.pos,
              receipt: t.receipt,
              last_digit_card: t.last_digit_card ? Number(t.last_digit_card) : undefined,
              card_name: t.card_name,
              remark: t.remark,
              voucher: t.voucher,
              booking: t.booking,
              status: t.status ?? 1,
              created_at: new Date(),
              created_by: userId ?? null,
            },
          });
        }
        await tx.transaction_temps.deleteMany({ where: { created_by: userId, deleted_at: null } });
      });

      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Batch posting commit error:', err);
      error(res, err?.message ?? 'Failed to commit batch postings', 500);
    }
  }


static async batchPostingStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { transactions: txns } = req.body;
      if (!txns || !Array.isArray(txns) || txns.length === 0) { badRequest(res, 'transactions array is required'); return; }

      const created = [];
      for (const t of txns) {
        // parity Laravel: validate code_item_id, get code_post, calculate charges
        const codeItemId = BigInt(t.code_item_id ?? t.code);
        const codeItem = await prisma.code_items.findUnique({ where: { id: codeItemId }, include: { code_posts: true } });
        if (!codeItem) { badRequest(res, 'Code Item not found'); return; }

        const codePost = codeItem.code_posts;
        const sumPrice = Number(t.amount ?? t.total ?? 0);
        const calc = codePost ? calculateCodePost(
          {
            tax: codePost.tax ?? false,
            tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
            local_tax: codePost.local_tax ?? false,
            local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
            service_charge: codePost.service_charge ?? false,
            service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
            service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
            tax_include_local_tax: codePost.tax_include_local_tax ?? false,
          },
          sumPrice,
          false
        ) : { amount: sumPrice, service: 0, tax3: 0, pb1: 0, total: sumPrice };

        const businessDate = await AuthController.getBusinessDate(pid);

        const data = await prisma.transaction_temps.create({
          data: {
            property_id: pid,
            folio_id: BigInt(t.folio_id),
            type: 'manual_posting',
            type_amount: 'PLUS',
            date: new Date(businessDate),
            code: codePost ? BigInt(codePost.id) : BigInt(t.code),
            code_item_id: codeItemId,
            description: t.description,
            overwrite_reason: t.overwrite_reason,
            time: t.time,
            bill_to: t.bill_to ? Number(t.bill_to) : null,
            reference: t.reference,
            pos: t.pos,
            receipt: t.receipt,
            last_digit_card: t.last_digit_card,
            card_name: t.card_name,
            remark: t.remark,
            voucher: t.voucher,
            booking: t.booking,
            amount: calc.amount,
            svr_chrg: calc.service,
            tax3: calc.tax3,
            pb1: calc.pb1,
            total: calc.total,
            rate: sumPrice,
            surcharge: 0,
            gst: 0,
            status: 1,
            created_at: new Date(),
            created_by: req.user?.id ?? null,
          },
        });
        created.push(data);
      }
      success(res, bigintToNumber(created), 'Batch posting created', 201);
    } catch (err: any) { console.error('Batch posting error:', err); error(res, 'Failed to create batch posting', 500); }
  }

  // ==================== DEPOSIT ====================
  static async depositList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePaginationFn(req.query);

      const paymentsWhere: any = { deleted_at: null };
      const eventsWhere: any = {};

      const [payments, events, totalPayments, totalEvents] = await Promise.all([
        prisma.deposit_payments.findMany({ where: paymentsWhere, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.deposit_events.findMany({ where: eventsWhere, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.deposit_payments.count({ where: paymentsWhere }),
        prisma.deposit_events.count({ where: eventsWhere }),
      ]);

      success(res, { payments: bigintToNumber(payments), events: bigintToNumber(events) }, 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil((totalPayments + totalEvents) / 2 / limit), per_page: limit, total: totalPayments + totalEvents, from: (page - 1) * limit + 1, to: Math.min(page * limit, totalPayments + totalEvents) },
      });
    } catch (err: any) { console.error('Deposit list error:', err); error(res, 'Failed to list deposits', 500); }
  }

  // ==================== SHIFT ====================
  static async shiftList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePaginationFn(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.shifts.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: { users: { select: { name: true } } } }),
        prisma.shifts.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Shift list error:', err); error(res, 'Failed to list shifts', 500); }
  }

  static async shiftStart(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id ?? 0n;
      // Laravel keys shifts to the BUSINESS date, not local today (:1903 parity fix).
      const bussinesDate = await AuthController.getBusinessDate(pid);
      const day = new Date(`${bussinesDate}T00:00:00`);
      const next = new Date(day.getTime() + 86400000);

      const existing = await prisma.shifts.findFirst({ where: { user_id: userId, property_id: pid, date: { gte: day, lt: next }, deleted_at: null } });
      if (existing) { badRequest(res, 'Shift already started for today'); return; }

      const data = await prisma.shifts.create({
        data: { property_id: pid, user_id: userId, start: new Date(), date: day, status: 0, created_at: new Date(), created_by: userId },
      });
      success(res, bigintToNumber(data), 'Shift started', 201);
    } catch (err: any) { console.error('Shift start error:', err); error(res, 'Failed to start shift', 500); }
  }

  static async shiftEnd(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id;
      const bussinesDate = await AuthController.getBusinessDate(pid);
      const day = new Date(`${bussinesDate}T00:00:00`);
      const next = new Date(day.getTime() + 86400000);

      const shift = await prisma.shifts.findFirst({ where: { user_id: userId, property_id: pid, date: { gte: day, lt: next }, deleted_at: null } });
      if (!shift) { badRequest(res, 'No active shift found'); return; }

      // Laravel sets ONLY `end` here (:452-456) — writing is_posting=true would
      // weaken the night-audit close guard.
      await prisma.shifts.update({ where: { id: shift.id }, data: { end: new Date(), updated_at: new Date(), updated_by: userId } });
      success(res, null, 'Shift ended');
    } catch (err: any) { console.error('Shift end error:', err); error(res, 'Failed to end shift', 500); }
  }

  // ==================== SHIFT ROSTER ====================
  static async shiftRosterList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const data = await prisma.shift_roster.findMany({ where: { property_id: pid, deleted_at: null }, orderBy: { id: 'desc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { console.error('Shift roster list error:', err); error(res, 'Failed to list shift rosters', 500); }
  }

  // ==================== DOOR LOCK ====================
  static async doorLockList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePaginationFn(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        prisma.doorlock_configs.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.doorlock_configs.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Door lock list error:', err); error(res, 'Failed to list door locks', 500); }
  }

  // GET /api/front-desk/:id
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (idParam === undefined || !/^\d+$/.test(String(idParam))) {
        notFound(res, 'Not Found');
        return;
      }
      const id = BigInt(idParam);

const folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          reservations: { 
            where: { deleted_at: null }, 
            orderBy: { date: 'asc' },
            include: { rooms: { select: { name: true } } }
          },
          properties: { select: { name: true } },
        },
      });

      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      let guestName = `${folio.first_name || ''} ${folio.last_name || ''}`.trim();
      if (!guestName && folio.guest_profile_id) {
        const gp = await prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } });
        if (gp) guestName = `${gp.first_name || ''} ${gp.last_name || ''}`.trim();
      }

      const lastReservation = folio.reservations?.[folio.reservations.length - 1];

      // Laravel Folio@getBalance parity: MINUS subtracts, GIT variants
      const balance = await folioBalanceDisplay(folio);

const data = {
        id: Number(folio.id),
        folio_number: folio.folio_number,
        guest_name: guestName || '-',
        room: lastReservation?.rooms?.name || lastReservation?.room_name || '',
        room_type: lastReservation?.room_type_name || '',
        check_in_date: folio.check_in_date,
        check_out_date: folio.check_out_date,
        company: folio.company_name || '',
        balance: balance.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
        status_reservation: folio.status_reservation,
        type_reservation: folio.type_reservation,
        status_reservation_color: statusReservationColor(folio),
      };

      success(res, data, 'Success');
    } catch (err: any) {
      console.error('FrontDesk show error:', err);
      error(res, 'Failed to fetch folio detail', 500);
    }
  }
}

