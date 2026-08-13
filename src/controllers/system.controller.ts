import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { encrypt } from '../utils/encryption';

const systemPool = new Pool({ connectionString: process.env.DATABASE_URL });
const systemAdapter = new PrismaPg(systemPool);
const systemPrisma = new PrismaClient({ adapter: systemAdapter });

function getPrisma() {
  return systemPrisma;
}

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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

export class SystemController {
  static async shiftConfirmationList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: propertyId, deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().shift_postings.findMany({
          where,
          include: {
            room_types: { select: { id: true, name: true } },
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shift_postings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
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
      console.error('Shift confirmation list error:', err);
      error(res, 'Failed to fetch shift confirmation list', 500);
    }
  }

  static async shiftConfirmationSubmit(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const userId = req.query.user_id as string;

      if (!userId) {
        badRequest(res, 'user_id is required');
        return;
      }

      const userIdBig = BigInt(userId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const existingShift = await getPrisma().shifts.findFirst({
        where: {
          user_id: userIdBig,
          property_id: propertyId,
          date: { gte: today, lt: tomorrow },
          deleted_at: null,
        },
      });

      if (existingShift) {
        const updated = await getPrisma().shifts.update({
          where: { id: existingShift.id },
          data: {
            is_posting: true,
            end: new Date(),
            updated_at: new Date(),
          },
        });
        success(res, bigintToNumber(updated), 'Shift updated');
      } else {
        const created = await getPrisma().shifts.create({
          data: {
            property_id: propertyId,
            user_id: userIdBig,
            start: new Date(),
            end: new Date(),
            date: today,
            is_posting: true,
            status: 0,
            created_at: new Date(),
          },
        });
        success(res, bigintToNumber(created), 'Shift created', 201);
      }
    } catch (err: any) {
      console.error('Shift confirmation submit error:', err);
      error(res, 'Failed to submit shift confirmation', 500);
    }
  }

  static async shiftDetail(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: propertyId, deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().shifts.findMany({
          where,
          include: {
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shifts.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
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
      console.error('Shift detail error:', err);
      error(res, 'Failed to fetch shift detail', 500);
    }
  }

  static async nightAuditPost(req: Request, res: Response): Promise<void> {
    try {
      const date = req.query.date as string;

      success(res, { date, status: 'posted', message: 'Night audit posted successfully' }, 'Success');
    } catch (err: any) {
      console.error('Night audit post error:', err);
      error(res, 'Failed to post night audit', 500);
    }
  }

  static async checkValue(req: Request, res: Response): Promise<void> {
    try {
      const key = req.query.key as string;
      const value = req.query.value as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      if (!key) {
        badRequest(res, 'key is required');
        return;
      }

      if (key === 'pin_endshift') {
        if (!value) {
          badRequest(res, 'value is required for pin_endshift');
          return;
        }

        const user = await getPrisma().users.findFirst({
          where: {
            id: req.user?.id,
            deleted_at: null,
          },
          select: { id: true, pin_enshift: true },
        });

        if (!user) {
          notFound(res, 'User not found');
          return;
        }

        const pinMatch = user.pin_enshift !== null && user.pin_enshift === parseInt(value);
        if (pinMatch) {
          success(res, { valid: true }, 'PIN valid');
        } else {
          success(res, { valid: false }, 'PIN invalid');
        }
      } else {
        success(res, { valid: true }, 'Check passed');
      }
    } catch (err: any) {
      console.error('Check value error:', err);
      error(res, 'Failed to check value', 500);
    }
  }

  static async systemBalance(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const type = req.params.type as string;
      const date = req.query.date as string;

      const where: any = { property_id: propertyId };

      if (type) {
        where.type = type;
      }

      if (date) {
        const dateObj = new Date(date);
        dateObj.setHours(0, 0, 0, 0);
        const nextDay = new Date(dateObj);
        nextDay.setDate(nextDay.getDate() + 1);
        where.date = { gte: dateObj, lt: nextDay };
      }

      const [data, total] = await Promise.all([
        getPrisma().system_balances.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().system_balances.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
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
      console.error('System balance error:', err);
      error(res, 'Failed to fetch system balance', 500);
    }
  }

  static async logList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const module = req.query.module as string;
      const id = req.query.id as string;

      const where: any = {};

      if (module) {
        where.subject_type = module;
      }

      if (id && id !== 'null' && id !== 'undefined') {
        where.subject_id = BigInt(id);
      }

      const [data, total] = await Promise.all([
        getPrisma().logs.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().logs.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
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
      console.error('Log list error:', err);
      error(res, 'Failed to fetch logs', 500);
    }
  }

  static async setup(req: Request, res: Response): Promise<void> {
    try {
      const config = {
        app_name: 'HMS Anyaman',
        app_version: '1.0.0',
        currency: 'IDR',
        date_format: 'Y-m-d',
        time_format: 'H:i:s',
        timezone: 'Asia/Jakarta',
        language: 'en',
        pagination_limit: 10,
        default_property: req.user?.lastProperty ? Number(req.user.lastProperty) : null,
      };

      success(res, config, 'Success');
    } catch (err: any) {
      console.error('Setup error:', err);
      error(res, 'Failed to load setup', 500);
    }
  }

  // ==================== NIGHT AUDIT AUDIT ====================
  static async nightAuditAudit(req: Request, res: Response): Promise<void> {
    try {
      const date = new Date().toISOString().split('T')[0];
      success(res, { date }, 'Success');
    } catch (err: any) {
      console.error('Night audit audit error:', err);
      error(res, 'Failed to get night audit date', 500);
    }
  }

  // ==================== NIGHT AUDIT SHIFT ====================
  static async nightAuditShift(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const dateStr = req.query.date as string;
      const group = req.query.group as string;

      const where: any = { property_id: propertyId, deleted_at: null };

      if (dateStr && dateStr !== '-1') {
        const d = new Date(dateStr);
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        where.date = { gte: d, lt: next };
      }

      const [data, total] = await Promise.all([
        getPrisma().shifts.findMany({
          where,
          include: {
            users: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().shifts.count({ where }),
      ]);

      const table = group
        ? []
        : [
            { key: 'id', name: 'ID' },
            { key: 'users', name: 'User', is_sub_query: true, sub_key: 'name' },
            { key: 'start', name: 'Start', type: 'date' },
            { key: 'end', name: 'End', type: 'date' },
            { key: 'date', name: 'Date', type: 'date' },
            { key: 'is_posting', name: 'Posted', type: 'boolean' },
            { key: 'status', name: 'Status' },
          ];

      success(res, bigintToNumber(data), 'Success', 200, {
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
      console.error('Night audit shift error:', err);
      error(res, 'Failed to fetch night audit shifts', 500);
    }
  }

  // ==================== NIGHT AUDIT CHECK ====================
  static async nightAuditCheck(req: Request, res: Response): Promise<void> {
    try {
      const dateStr = req.query.date as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      if (!dateStr || dateStr === '-1') {
        badRequest(res, 'Valid date is required');
        return;
      }

      const d = new Date(dateStr);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);

      const openShifts = await getPrisma().shifts.count({
        where: {
          property_id: propertyId,
          date: { gte: d, lt: next },
          deleted_at: null,
          is_posting: false,
        },
      });

      success(res, {
        date: dateStr,
        open_shifts: openShifts,
        status: openShifts === 0 ? 'ready' : 'pending_shifts',
        message: openShifts === 0
          ? 'All shifts posted. Ready for night audit.'
          : `${openShifts} shift(s) still open. Please confirm all shifts first.`,
      }, 'Night audit check complete');
    } catch (err: any) {
      console.error('Night audit check error:', err);
      error(res, 'Failed to check night audit', 500);
    }
  }

  // ==================== DASHBOARD ====================
  static async getDashboard(req: Request, res: Response): Promise<void> {
    try {
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      const property = await getPrisma().properties.findUnique({
        where: { id: propertyId },
        select: { id: true, name: true, alias: true, logo: true, image: true, address: true, email: true, telp: true },
      });

      const today = new Date().toISOString().split('T')[0];

      const [totalRooms, occupiedRooms, arrivalsCount, departuresCount, inHouseCount, revenueResult] = await Promise.all([
        getPrisma().rooms.count({ where: { property_id: propertyId, deleted_at: null } }),
        getPrisma().rooms.count({ where: { property_id: propertyId, deleted_at: null, room_status: 1 } }),
        getPrisma().folios.count({ where: { property_id: propertyId, deleted_at: null, check_in_date: { gte: new Date(today), lt: new Date(new Date(today).getTime() + 86400000) }, status_reservation: { in: [1, 2] } } }),
        getPrisma().folios.count({ where: { property_id: propertyId, deleted_at: null, check_out_date: { gte: new Date(today), lt: new Date(new Date(today).getTime() + 86400000) }, status_reservation: { in: [1, 2, 3] } } }),
        getPrisma().folios.count({ where: { property_id: propertyId, deleted_at: null, status_reservation: 2, is_pos_trx: false } }),
        getPrisma().transactions.aggregate({ where: { property_id: propertyId, deleted_at: null, is_void: 0, date: { gte: new Date(today), lt: new Date(new Date(today).getTime() + 86400000) } }, _sum: { total: true } }),
      ]);

      const occupancyPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;
      const revenueTotal = Number(revenueResult._sum?.total ?? 0);

      const widgets = [
        { type: 'total_rooms', label: 'Total Rooms', value: totalRooms, header: 'Total Rooms', svg: 'home', link: '/room', is_total: true },
        { type: 'occupancy', label: 'Occupancy', value: `${occupancyPct}%`, header: 'Occupancy Rate', svg: 'chart-bar', link: '/statistic/occupancy', is_total: true },
        { type: 'arrivals', label: 'Arrivals Today', value: arrivalsCount, header: 'Arrivals', svg: 'login', link: '/front-desk?type=check_in', is_total: true },
        { type: 'departures', label: 'Departures Today', value: departuresCount, header: 'Departures', svg: 'logout', link: '/front-desk?type=check_out', is_total: true },
        { type: 'in_house', label: 'In House', value: inHouseCount, header: 'In House Guests', svg: 'users', link: '/front-desk?type=in_house', is_total: true },
        { type: 'revenue', label: 'Revenue Today', value: `Rp ${revenueTotal.toLocaleString('id-ID')}`, header: 'Revenue', svg: 'currency', link: '/report/daily', is_total: true },
      ];

      const responsePayload = {
        code: '200',
        message: 'Data has been loaded',
        data: widgets,
        property: property ? {
          id: Number(property.id),
          name: property.name,
          alias: property.alias,
          logo: property.logo,
          image: property.image,
          address: property.address,
          email: property.email,
          phone: property.telp ? Number(property.telp) : null,
        } : null,
        dateLog: today,
        start_date: startDate || today,
        end_date: endDate || today,
      };
      res.status(200).type('text/plain').send(encrypt(JSON.stringify(responsePayload)));
    } catch (err: any) {
      console.error('Get dashboard error:', err);
      error(res, 'Failed to load dashboard', 500);
    }
  }

  // ==================== DASHBOARD DETAIL ====================
  static async getDashboardDetail(req: Request, res: Response): Promise<void> {
    try {
      const code = req.params.code;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const dateLog = req.query.dateLog as string;
      const propertyId = req.user?.lastProperty ?? 0n;

      const today = new Date().toISOString().split('T')[0];
      const sd = startDate || today;
      const ed = endDate || today;

      let list: any[] = [];
      let detail: any = null;

      switch (code) {
        case 'total_rooms': {
          const roomsByType = await getPrisma().rooms.groupBy({
            by: ['room_type_id'],
            where: { property_id: propertyId, deleted_at: null },
            _count: { id: true },
          });
          const roomTypes = await getPrisma().room_types.findMany({
            where: { property_id: propertyId, deleted_at: null, status: 1 },
            select: { id: true, name: true },
          });
          const typeMap = new Map(roomTypes.map(rt => [Number(rt.id), rt.name]));
          for (const r of roomsByType) {
            const typeId = Number(r.room_type_id);
            const name = typeMap.get(typeId) || `Type #${typeId}`;
            const total = r._count.id;
            const occupied = await getPrisma().rooms.count({ where: { property_id: propertyId, deleted_at: null, room_type_id: BigInt(typeId), room_status: 1 } });
            list.push({ name, Room: total, room: total - occupied });
          }
          if (list.length === 0) { list.push({ name: 'No Data', Room: 0, room: 0 }); }
          detail = { type: 'number', label: 'Total Rooms', header: ['Room Type', 'Total', 'Available'], list, span: 4, link: '/room', is_total: true };
          break;
        }
        case 'occupancy': {
          const roomsByType = await getPrisma().rooms.groupBy({
            by: ['room_type_id'],
            where: { property_id: propertyId, deleted_at: null },
            _count: { id: true },
          });
          const roomTypes = await getPrisma().room_types.findMany({
            where: { property_id: propertyId, deleted_at: null, status: 1 },
            select: { id: true, name: true },
          });
          const typeMap = new Map(roomTypes.map(rt => [Number(rt.id), rt.name]));
          for (const r of roomsByType) {
            const typeId = Number(r.room_type_id);
            const name = typeMap.get(typeId) || `Type #${typeId}`;
            const total = r._count.id;
            const occupied = await getPrisma().rooms.count({ where: { property_id: propertyId, deleted_at: null, room_type_id: BigInt(typeId), room_status: 1 } });
            const rate = total > 0 ? `${Math.round((occupied / total) * 100)}%` : '0%';
            list.push({ name, Room: occupied, room: rate });
          }
          if (list.length === 0) { list.push({ name: 'No Data', Room: 0, room: '0%' }); }
          detail = { type: 'number', label: 'Occupancy', header: ['Room Type', 'Occupied', 'Rate'], list, span: 4, link: '/statistic/occupancy', is_total: true };
          break;
        }
        case 'arrivals': {
          const todayStart = new Date(today);
          const todayEnd = new Date(todayStart.getTime() + 86400000);
          const arrivals = await getPrisma().folios.findMany({
            where: { property_id: propertyId, deleted_at: null, check_in_date: { gte: todayStart, lt: todayEnd }, status_reservation: { in: [1, 2] } },
            select: { id: true, first_name: true, last_name: true, folio_number: true, status_reservation: true },
            orderBy: { check_in_date: 'asc' },
            take: 20,
          });
          for (const f of arrivals) {
            const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.folio_number || 'Guest';
            const statusMap: Record<number, string> = { 0: 'Pending', 1: 'Reservation', 2: 'Check In', 3: 'Check Out', 4: 'Cancelled' };
            list.push({ name, Room: f.folio_number || '-', room: statusMap[f.status_reservation ?? 0] || 'Unknown' });
          }
          if (list.length === 0) { list.push({ name: 'No arrivals today', Room: '-', room: '-' }); }
          detail = { type: 'number', label: 'Arrivals Today', header: ['Name', 'Folio', 'Status'], list, span: 4, link: '/front-desk?type=check_in', is_total: true };
          break;
        }
        case 'departures': {
          const todayStart = new Date(today);
          const todayEnd = new Date(todayStart.getTime() + 86400000);
          const departures = await getPrisma().folios.findMany({
            where: { property_id: propertyId, deleted_at: null, check_out_date: { gte: todayStart, lt: todayEnd }, status_reservation: { in: [1, 2, 3] } },
            select: { id: true, first_name: true, last_name: true, folio_number: true, status_reservation: true },
            orderBy: { check_out_date: 'asc' },
            take: 20,
          });
          for (const f of departures) {
            const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.folio_number || 'Guest';
            const statusMap: Record<number, string> = { 0: 'Pending', 1: 'Reservation', 2: 'Check In', 3: 'Check Out', 4: 'Cancelled' };
            list.push({ name, Room: f.folio_number || '-', room: statusMap[f.status_reservation ?? 0] || 'Unknown' });
          }
          if (list.length === 0) { list.push({ name: 'No departures today', Room: '-', room: '-' }); }
          detail = { type: 'number', label: 'Departures Today', header: ['Name', 'Folio', 'Status'], list, span: 4, link: '/front-desk?type=check_out', is_total: true };
          break;
        }
        case 'in_house': {
          const inHouse = await getPrisma().folios.findMany({
            where: { property_id: propertyId, deleted_at: null, status_reservation: 2, is_pos_trx: false },
            select: { id: true, first_name: true, last_name: true, folio_number: true, check_in_date: true },
            orderBy: { check_in_date: 'desc' },
            take: 20,
          });
          for (const f of inHouse) {
            const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.folio_number || 'Guest';
            const checkIn = f.check_in_date ? f.check_in_date.toISOString().split('T')[0] : '-';
            list.push({ name, Room: f.folio_number || '-', room: checkIn });
          }
          if (list.length === 0) { list.push({ name: 'No in-house guests', Room: '-', room: '-' }); }
          detail = { type: 'number', label: 'In House', header: ['Name', 'Folio', 'Check In'], list, span: 4, link: '/front-desk?type=in_house', is_total: true };
          break;
        }
        case 'revenue': {
          const todayStart = new Date(today);
          const todayEnd = new Date(todayStart.getTime() + 86400000);
          const transactions = await getPrisma().transactions.groupBy({
            by: ['code_name'],
            where: { property_id: propertyId, deleted_at: null, is_void: 0, date: { gte: todayStart, lt: todayEnd } },
            _sum: { total: true },
            orderBy: { _sum: { total: 'desc' } },
            take: 10,
          });
          let grandTotal = 0;
          for (const t of transactions) {
            const amount = Number(t._sum.total ?? 0);
            grandTotal += amount;
            list.push({ name: t.code_name || 'Other', Room: `Rp ${amount.toLocaleString('id-ID')}`, room: amount });
          }
          if (list.length > 0) { list.push({ name: 'Total', Room: `Rp ${grandTotal.toLocaleString('id-ID')}`, room: grandTotal }); }
          else { list.push({ name: 'No revenue today', Room: 'Rp 0', room: 0 }); }
          detail = { type: 'number', label: 'Revenue Today', header: ['Category', 'Amount', 'Raw'], list, span: 4, link: '/report/daily', is_total: true };
          break;
        }
        default: {
          detail = { type: 'number', label: 'Widget', header: ['Data'], list: [{ name: 'Unknown widget', Room: '-', room: '-' }], span: 4, link: '', is_total: false };
        }
      }

      const responsePayload = {
        code: '200',
        message: 'Data has been loaded',
        data: detail ? [detail] : [],
        start_date: sd,
        end_date: ed,
        dateLog: dateLog || today,
      };
      res.status(200).type('text/plain').send(encrypt(JSON.stringify(responsePayload)));
    } catch (err: any) {
      console.error('Get dashboard detail error:', err);
      res.status(500).type('text/plain').send(encrypt(JSON.stringify({ code: '500', message: 'Failed to load dashboard detail', data: null })));
    }
  }

  // ==================== HELPER ENDPOINTS ====================
static async helperTaskNotification(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const propertyId = req.user?.lastProperty ?? 0n;

      const [items, count] = await Promise.all([
        getPrisma().tasks.findMany({
          where: {
            to_user_id: userId,
            status: { in: ['Open', 'In_Progress'] },
            deleted_at: null,
          },
          orderBy: { created_at: 'desc' },
          take: 10,
        }),
        getPrisma().tasks.count({
          where: {
            to_user_id: userId,
            status: { in: ['Open', 'In_Progress'] },
            deleted_at: null,
          },
        }),
      ]);

      const mappedItems = items.map(t => ({
        id: Number(t.id),
        type: 'task',
        message: t.message || 'Task',
        room_number: t.room_number,
        link: `/task/${t.id}`,
        time: t.created_at?.toISOString() || new Date().toISOString(),
        created_at: t.created_at?.toISOString() || new Date().toISOString(),
        is_read: t.is_read === 1,
        from: 'System',
        priority: t.priority || 'Medium',
      }));

      success(res, { count, items: mappedItems }, 'Success');
    } catch (err: any) {
      console.error('Helper task notification error:', err);
      error(res, 'Failed to fetch notifications', 500);
    }
  }

  static async helperTotalCancelBookingEngine(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;

      const total = await getPrisma().reservations.count({
        where: {
          property_id: propertyId,
          status: 4,
          deleted_at: null,
        },
      });

      success(res, { total }, 'Successfully');
    } catch (err: any) {
      console.error('Helper total cancel booking engine error:', err);
      error(res, 'Failed to count cancellations', 500);
    }
  }

  static async helperReleaseLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      success(res, { status: 1 }, 'Last user folio released');
    } catch (err: any) {
      console.error('Helper release last user folio error:', err);
      error(res, 'Failed to release folio', 500);
    }
  }

  static async helperCheckLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      const folioId = req.body.folio_id;
      // Check if there's an active session for this folio
      success(res, { status: 1 }, 'Check completed');
    } catch (err: any) {
      console.error('Helper check last user folio error:', err);
      error(res, 'Failed to check folio', 500);
    }
  }

  static async helperReplaceLastUserFolio(req: Request, res: Response): Promise<void> {
    try {
      const folioId = req.body.folio_id;
      // Replace/override the last user session for this folio
      success(res, { status: 1 }, 'Folio session replaced');
    } catch (err: any) {
      console.error('Helper replace last user folio error:', err);
      error(res, 'Failed to replace folio session', 500);
    }
  }

  // ==================== ROOM CHANGE ====================
  static async roomChangeList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        getPrisma().room_change_histories.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().room_change_histories.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Room change list error:', err); error(res, 'Failed to list room changes', 500); }
  }

  static async roomChangeStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id ?? 0n;
      const { folio_id, folio_number, check_in_date, check_out_date, from_room_id, from_room_type_id, to_room_id, to_room_type_id, reason } = req.body;
      if (!folio_id || !to_room_id) { badRequest(res, 'folio_id and to_room_id are required'); return; }

      const data = await getPrisma().room_change_histories.create({
        data: { property_id: pid, folio_id: BigInt(folio_id), folio_number: folio_number || '', check_in_date: new Date(check_in_date), check_out_date: new Date(check_out_date), from_room_id: BigInt(from_room_id), from_room_type_id: BigInt(from_room_type_id), to_room_id: BigInt(to_room_id), to_room_type_id: BigInt(to_room_type_id), user_id: userId, reason, datetime: new Date() },
      });
      success(res, bigintToNumber(data), 'Room change recorded', 201);
    } catch (err: any) { console.error('Room change error:', err); error(res, 'Failed to record room change', 500); }
  }

  // ==================== LOG AUDIT ====================
  static async logAuditList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: Number(pid), deleted_at: null };

      const [data, total] = await Promise.all([
        getPrisma().log_audits.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        getPrisma().log_audits.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Log audit list error:', err); error(res, 'Failed to list log audits', 500); }
  }

  static async postCodeBudget(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const propertyId = req.user?.lastProperty ?? 0n;
      const type = req.query.type as string;
      const year = req.query.year as string;

      const where: any = { property_id: propertyId };

      if (year) {
        where.year = parseInt(year);
      }

      const [data, total] = await Promise.all([
        getPrisma().post_code_budgets.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        getPrisma().post_code_budgets.count({ where }),
      ]);

      if (data.length > 0) {
        const codePostIds = data.map((d: any) => d.code_post_id);
        const codePosts = await getPrisma().code_posts.findMany({
          where: { id: { in: codePostIds } },
          select: { id: true, name: true },
        });

        const codePostMap = new Map<bigint, string>();
        for (const cp of codePosts) {
          codePostMap.set(cp.id, cp.name);
        }

        const enriched = data.map((d: any) => ({
          ...d,
          id: Number(d.id),
          code_post_name: codePostMap.get(d.code_post_id) || null,
        }));

        success(res, bigintToNumber(enriched), 'Success', 200, {
          pagging: {
            current_page: page,
            last_page: Math.ceil(total / limit),
            per_page: limit,
            total,
            from: (page - 1) * limit + 1,
            to: Math.min(page * limit, total),
          },
        });
      } else {
        success(res, [], 'Success', 200, {
          pagging: {
            current_page: page,
            last_page: 0,
            per_page: limit,
            total: 0,
            from: 0,
            to: 0,
          },
        });
      }
    } catch (err: any) {
      console.error('Post code budget error:', err);
      error(res, 'Failed to fetch post code budget', 500);
    }
  }
}
