import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES, moneyFormat, calculateCodePost } from '../utils/cmsConfig';
import { ROOM_STATUSES, MAID_STATUSES } from '../utils/cmsStatus';
import { dataSearch, applySearchField } from '../utils/search';
import { AuthController } from './auth.controller';

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

        // Get balance from transactions
        const transactions = await prisma.transactions.findMany({
          where: { folio_id: f.id, deleted_at: null },
        });
        const balance = transactions.reduce((sum: number, t: any) => {
          return sum + Number(t.total || 0);
        }, 0);

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
          room_next: lastReservation?.room_id_next ? Number(lastReservation.room_id_next) : '',
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
        include: { reservations: { where: { deleted_at: null }, select: { room_id: true, room_id_next: true } } }
      });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      // Update folio and reservations status
      await prisma.folios.update({
        where: { id },
        data: {
          status_reservation: STATUS_RESERVATION.check_in.id,
          updated_at: new Date(),
        },
      });

      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.check_in.id },
      });

      // Check room availability before check-in (parity with Laravel)
      const propertyId = req.user?.lastProperty ?? 0n;
      const checkInDate = folio.check_in_date ? folio.check_in_date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const checkOutDate = folio.check_out_date ? folio.check_out_date.toISOString().slice(0, 10) : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      
      // Update room status: occupied (1), maid_status: clean (0)
      // Use room_id_next if exists (room change), otherwise room_id
      const roomIds: bigint[] = [];
      for (const resv of folio.reservations) {
        const targetRoomId = resv.room_id_next ?? resv.room_id;
        if (targetRoomId != null) {
          const available = await isRoomAvailableFor(propertyId, targetRoomId, checkInDate, checkOutDate, id);
          if (!available) {
            badRequest(res, `Room ${targetRoomId} not available for check-in`);
            return;
          }
          roomIds.push(targetRoomId);
        }
      }
      if (roomIds.length > 0) {
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
        include: { reservations: { where: { deleted_at: null }, select: { room_id: true, room_id_next: true } } }
      });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      await prisma.folios.update({
        where: { id },
        data: {
          status_reservation: STATUS_RESERVATION.check_out.id,
          updated_at: new Date(),
        },
      });

      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.check_out.id },
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

      success(res, { folio_id: Number(id), status_reservation: STATUS_RESERVATION.check_out.id }, 'Check-out success');
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

      // Get all reservations for these folios to find room IDs
      const folios = await prisma.folios.findMany({
        where: { id: { in: ids } },
        include: { reservations: { where: { deleted_at: null }, select: { room_id: true, room_id_next: true } } }
      });

      await prisma.folios.updateMany({
        where: { id: { in: ids } },
        data: {
          status_reservation: STATUS_RESERVATION.check_out.id,
          updated_at: new Date(),
        },
      });

      await prisma.reservations.updateMany({
        where: { folio_id: { in: ids }, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.check_out.id },
      });

      // Update room status for all rooms: vacant (0), maid_status: dirty (1)
      const roomIds: bigint[] = [];
      for (const folio of folios) {
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

      success(res, { updated: ids.length }, 'Batch check-out success');
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

  static async transactionStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { folio_id, type, date, code, code_name, type_payment_id, amount, total, description, remark, status } = req.body;
      if (!folio_id) { badRequest(res, 'folio_id is required'); return; }

      const data = await prisma.transactions.create({
        data: { property_id: pid, folio_id: BigInt(folio_id), type: type || 'debit', date: date ? new Date(date) : new Date(), code, code_name, type_payment_id: type_payment_id ? BigInt(type_payment_id) : null, amount: amount || 0, total: total || 0, description, remark, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Transaction created', 201);
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
    try {
      const id = idParamBig(req.params.id);
      const { void_code, reason } = req.body;
      await prisma.transactions.update({ where: { id }, data: { is_void: 1, void_code, remark: reason, updated_at: new Date(), updated_by: req.user?.id } });
      success(res, null, 'Transaction voided');
    } catch (err: any) { error(res, 'Failed to void transaction', 500); }
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
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      const existing = await prisma.shifts.findFirst({ where: { user_id: userId, property_id: pid, date: { gte: today, lt: tomorrow }, deleted_at: null } });
      if (existing) { badRequest(res, 'Shift already started for today'); return; }

      const data = await prisma.shifts.create({
        data: { property_id: pid, user_id: userId, start: new Date(), date: today, status: 0, created_at: new Date(), created_by: userId },
      });
      success(res, bigintToNumber(data), 'Shift started', 201);
    } catch (err: any) { console.error('Shift start error:', err); error(res, 'Failed to start shift', 500); }
  }

  static async shiftEnd(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      const shift = await prisma.shifts.findFirst({ where: { user_id: userId, property_id: pid, date: { gte: today, lt: tomorrow }, deleted_at: null } });
      if (!shift) { badRequest(res, 'No active shift found'); return; }

      await prisma.shifts.update({ where: { id: shift.id }, data: { end: new Date(), is_posting: true, updated_at: new Date(), updated_by: userId } });
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
          reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' } },
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

      const transactions = await prisma.transactions.findMany({
        where: { folio_id: folio.id, deleted_at: null },
      });
      const balance = transactions.reduce((sum: number, t: any) => sum + Number(t.total || 0), 0);

const data = {
        id: Number(folio.id),
        folio_number: folio.folio_number,
        guest_name: guestName || '-',
        room: lastReservation?.room_name || '',
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

