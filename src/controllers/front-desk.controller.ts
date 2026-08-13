import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATUS_RESERVATION = {
  reservation: { id: 1, code: 'reservation', name: 'Reservation' },
  check_in: { id: 2, code: 'check_in', name: 'Check In' },
  check_out: { id: 3, code: 'check_out', name: 'Check Out' },
  cancel_reservation: { id: 4, code: 'cancel_reservation', name: 'Cancel Reservation' },
  pending: { id: 0, code: 'pending', name: 'Pending' },
};

const TYPE_RESERVATION = {
  fit: { code: 'fit', name: 'FIT' },
  git: { code: 'git', name: 'GIT' },
  vr: { code: 'vr', name: 'VR' },
};

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
      const propertyId = req.user?.lastProperty;

      const where: any = {
        deleted_at: null,
        is_pos_trx: false,
      };

      if (propertyId) where.property_id = propertyId;

      // Type-based filtering
      if (type === 'check_in') {
        where.status_reservation = {
          in: [STATUS_RESERVATION.check_in.id, STATUS_RESERVATION.reservation.id],
        };
        where.check_in_date = { gte: new Date() };
      } else if (type === 'check_out' && group === 'check-out') {
        where.status_reservation = {
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
          status_reservation_color: [{
            label: 'Reservation',
            color: 'bg-primary',
            is_color: true,
          }],
          room_clean_status_color: [],
          room_status_color: [],
          folio_number: f.folio_number,
          guest_name: guestName || '-',
          guest_status: { label: 'Regular', color: 'bg-green' },
          guest_status_color: [{ label: 'Regular', color: 'bg-green', is_color: true }],
          date_arrival: f.check_in_date,
          stay: 0,
          room: roomName,
          room_next: lastReservation?.room_id_next || '',
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
        pagging: {
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

      const folio = await prisma.folios.findUnique({ where: { id } });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

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

      const folio = await prisma.folios.findUnique({ where: { id } });
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

      success(res, { updated: ids.length }, 'Batch check-out success');
    } catch (err: any) {
      console.error('FrontDesk batchCheckOut error:', err);
      error(res, 'Failed to batch check out', 500);
    }
  }

  // ==================== TRANSACTION ====================
  static async transactionList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const folioId = req.query.folio_id as string;
      const type = req.query.type as string;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: pid, deleted_at: null };
      if (folioId) where.folio_id = BigInt(folioId);
      if (type) where.type = type;

      const [data, total] = await Promise.all([
        prisma.transactions.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: { type_payments: { select: { name: true } }, folios: { select: { folio_number: true } } } }),
        prisma.transactions.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      const limit = parseInt(req.query.limit as string) || 50;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: pid, is_posting: 1, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.transactions.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.transactions.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
        const data = await prisma.transactions.create({
          data: { property_id: pid, folio_id: BigInt(t.folio_id), type: 'debit', date: new Date(), code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id ? BigInt(t.type_payment_id) : null, amount: t.amount || 0, total: t.total || 0, description: t.description, is_posting: 1, created_at: new Date(), created_by: req.user?.id },
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
        pagging: { current_page: page, last_page: Math.ceil((totalPayments + totalEvents) / 2 / limit), per_page: limit, total: totalPayments + totalEvents, from: (page - 1) * limit + 1, to: Math.min(page * limit, totalPayments + totalEvents) },
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
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      };

      success(res, data, 'Success');
    } catch (err: any) {
      console.error('FrontDesk show error:', err);
      error(res, 'Failed to fetch folio detail', 500);
    }
  }
}
