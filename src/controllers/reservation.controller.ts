import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Status reservation constants (matching Laravel config/cms.php)
const STATUS_RESERVATION = {
  reservation: { id: 1, code: 'reservation', name: 'Reservation' },
  check_in: { id: 2, code: 'check_in', name: 'Check In' },
  check_out: { id: 3, code: 'check_out', name: 'Check Out' },
  cancel_reservation: { id: 4, code: 'cancel_reservation', name: 'Cancel Reservation' },
  pending: { id: 0, code: 'pending', name: 'Pending' },
};

const STATUS_ACTIVE = 1;
const MENU_ID = 80; // Reservation menu ID

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

function reservationBn(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(reservationBn);
  if (val && typeof val === 'object') { const o: any = {}; for (const [k, v] of Object.entries(val)) o[k] = reservationBn(v); return o; }
  return val;
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

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Move ledger error:', err);
      error(res, 'Failed to move ledger', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/reservations
  // ─────────────────────────────────────────────
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
              include: { room_types: { select: { name: true } } },
            },
          },
        }),
        prisma.folios.count({ where }),
      ]);

      const formatted = folios.map((f: any) => ({
        id: Number(f.id),
        folio_number: f.folio_number,
        parent: Number(f.parent),
        type_reservation: f.type_reservation,
        first_name: f.first_name,
        last_name: f.last_name,
        company_name: f.company_name,
        check_in_date: f.check_in_date,
        check_out_date: f.check_out_date,
        status_reservation: f.status_reservation,
        is_day_use: f.is_day_use,
        is_walk_in: f.is_walk_in,
        is_house_use: f.is_house_use,
        complimentary: f.complimentary,
        is_virtual: f.is_virtual,
        total_amount: Number(f.total_amount),
        guest_profile_id: f.guest_profile_id ? Number(f.guest_profile_id) : null,
        company_profile_id: Number(f.company_profile_id),
        property_name: f.properties?.name,
        reservations: f.reservations?.map((r: any) => ({
          id: Number(r.id),
          room_type_name: r.room_type_name,
          room_name: r.room_name,
          rate_name: r.rate_name,
          adult: r.adult,
          child: r.child,
          date: r.date,
        })),
      }));

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
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
      });
    } catch (err: any) {
      console.error('Reservation list error:', err);
      error(res, 'Failed to fetch reservations', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /cms/reservation-item (ReservationItemController parity - room grid per folio)
  // ─────────────────────────────────────────────
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
      const pagging = (total: number) => ({
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
          pagging: pagging(0),
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
        pagging: pagging(data.length),
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

  // ─────────────────────────────────────────────
  // PUT /cms/reservation-item/:id (ReservationItemController update parity - basic)
  // ─────────────────────────────────────────────
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

      const { rate_id, room_type_id, room_id, remark_room, total, market_segment_1, market_segment_2, market_segment_3, market_segment_4, apply_mode } = req.body;

      const data: any = {
        updated_by: userId,
        updated_at: new Date(),
      };
      if (rate_id !== undefined && rate_id !== null && rate_id !== '') data.rate_id = BigInt(rate_id);
      if (room_type_id !== undefined && room_type_id !== null && room_type_id !== '') data.room_type_id = BigInt(room_type_id);
      if (room_id !== undefined && room_id !== null && room_id !== '') data.room_id = BigInt(room_id);
      if (total !== undefined && total !== null && total !== '') data.total = Number(total);

      await prisma.reservations.update({ where: { id }, data });

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

      if (apply_mode === 'following' || apply_mode === 'all') {
        await prisma.reservations.updateMany({
          where: { folio_id: existing.folio_id, deleted_at: null, date: { gt: existing.date } },
          data: {
            rate_id: data.rate_id ?? existing.rate_id,
            room_type_id: data.room_type_id ?? existing.room_type_id,
            room_id: data.room_id ?? existing.room_id,
            updated_by: userId,
            updated_at: new Date(),
          },
        });
      }

      const updated = await prisma.reservations.findUnique({ where: { id } });
      success(res, reservationBn(updated), 'Success');
    } catch (err: any) {
      console.error('Reservation item update error:', err);
      error(res, 'Failed to update reservation item', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/reservations/create
  // ─────────────────────────────────────────────
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const [statuses, roomTypes, companies, types] = await Promise.all([
        prisma.folios.findMany({
          where: { deleted_at: null, property_id: propertyId! },
          select: { status_reservation: true },
          distinct: ['status_reservation'],
        }),
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.company_profiles.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: {
            deleted_at: null,
            status: STATUS_ACTIVE,
            group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source', 'guest-status', 'cancellation-reservation'] },
          },
          select: { id: true, name: true, group: true },
        }),
      ]);

      const groupBy = (arr: any[], key: string) =>
        arr.reduce((acc, item) => {
          (acc[item[key]] = acc[item[key]] || []).push(item);
          return acc;
        }, {} as any);

      const grouped = groupBy(types, 'group');

      const master = {
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
        status_guests: (grouped['guest-status'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        reason_cancels: (grouped['cancellation-reservation'] || []).map((t: any) => ({ value: t.name, label: t.name })),
        typemulti: [
          { label: 'FIT', value: 'fit' },
          { label: 'GIT', value: 'git' },
          { label: 'VR', value: 'vr' },
          { label: 'Day Use', value: 'day-use' },
        ],
        legend: [
          { label: 'BAR', color: 'bg-secondary text-white rounded-md font-semibold' },
          { label: 'COMPANY APPLICABLE', color: 'bg-success text-white rounded-md font-semibold' },
          { label: 'APPLICABLE FOR ALL', color: 'bg-primary text-white rounded-md font-semibold' },
        ],
      };

      success(res, [], 'Success', 200, { master });
    } catch (err: any) {
      console.error('Reservation create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/reservations
  // ─────────────────────────────────────────────
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
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
      } = req.body;

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

      // Create reservation items (per-night entries)
      if (type_reservation !== 'git' && reservation_list.length > 0) {
        for (const item of reservation_list) {
          const itemCheckIn = new Date(item.check_in_date);
          const itemCheckOut = new Date(item.check_out_date);
          const nights = Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / (1000 * 60 * 60 * 24));

          for (let i = 0; i < nights; i++) {
            const nightDate = new Date(itemCheckIn);
            nightDate.setDate(nightDate.getDate() + i);

            await prisma.reservations.create({
              data: {
                property_id: propertyId!,
                folio_id: folio.id,
                rate_id: item.rate_id ? BigInt(item.rate_id) : null,
                room_type_id: item.room_type_id ? BigInt(item.room_type_id) : null,
                room_id: item.room_id ? BigInt(item.room_id) : null,
                adult: item.adult || 1,
                child: item.child || 0,
                add_bed: item.add_bed || 0,
                check_in_date: new Date(item.check_in_date),
                check_out_date: new Date(item.check_out_date),
                date: nightDate,
                status_reservation: statusReservation,
                status: STATUS_ACTIVE,
                night: nights,
                amount: 0,
                amountt: 0,
                total: 0,
                service_charge: 0,
                pb1: 0,
                tax3: 0,
                created_by: userId,
              },
            });
          }
        }
      }

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

            await prisma.reservations.create({
              data: {
                property_id: propertyId!,
                folio_id: subFolio.id,
                room_type_id: BigInt(roomItem.id),
                adult: roomItem.adult || 1,
                child: roomItem.child || 0,
                check_in_date: new Date(actualCheckIn),
                check_out_date: new Date(actualCheckOut),
                date: new Date(actualCheckIn),
                status_reservation: statusReservation,
                status: STATUS_ACTIVE,
                night: Math.ceil((new Date(actualCheckOut).getTime() - new Date(actualCheckIn).getTime()) / (1000 * 60 * 60 * 24)),
                amount: 0,
                amountt: 0,
                total: 0,
                service_charge: 0,
                pb1: 0,
                tax3: 0,
                created_by: userId,
              },
            });

            subIndex++;
          }
        }
      }

      const message = is_pending
        ? 'Room is not available, reservation is Created as Pending'
        : 'Success';

      const result = bigintToNumber(folio);
      success(res, result, message, 200);
    } catch (err: any) {
      console.error('Reservation store error:', err);
      error(res, 'Failed to create reservation', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/reservations/:id
  // ─────────────────────────────────────────────
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

      success(res, bigintToNumber(folio), 'Success');
    } catch (err: any) {
      console.error('Reservation show error:', err);
      error(res, 'Failed to fetch reservation', 500);
    }
  }

  // ─────────────────────────────────────────────
  // GET /api/reservations/:id/edit
  // ─────────────────────────────────────────────
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const [folio, companies, roomTypes, types] = await Promise.all([
        prisma.folios.findUnique({
          where: { id },
          include: {
            reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' } },
          },
        }),
        prisma.company_profiles.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: {
            deleted_at: null,
            status: STATUS_ACTIVE,
            group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source', 'guest-status'] },
          },
          select: { id: true, name: true, group: true },
        }),
      ]);

      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      const groupBy = (arr: any[], key: string) =>
        arr.reduce((acc, item) => {
          (acc[item[key]] = acc[item[key]] || []).push(item);
          return acc;
        }, {} as any);

      const grouped = groupBy(types, 'group');

      const master = {
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        market_segment_1: (grouped['market-segment-1'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_2: (grouped['market-segment-2'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_3: (grouped['market-segment-3'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        market_segment_4: (grouped['market-segment-4'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        source: (grouped['source'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
        status_guests: (grouped['guest-status'] || []).map((t: any) => ({ value: Number(t.id), label: t.name })),
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
        typemulti: [
          { label: 'FIT', value: 'fit' },
          { label: 'GIT', value: 'git' },
          { label: 'VR', value: 'vr' },
          { label: 'Day Use', value: 'day-use' },
        ],
      };

      success(res, bigintToNumber({ ...folio, master }), 'Success');
    } catch (err: any) {
      console.error('Reservation edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  // ─────────────────────────────────────────────
  // PUT /api/reservations/:id
  // ─────────────────────────────────────────────
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
        updateData.is_pending = is_pending;
        if (is_pending) {
          updateData.status_reservation = STATUS_RESERVATION.pending.id;
        } else if (updateData.status_reservation === undefined) {
          updateData.status_reservation = STATUS_RESERVATION.reservation.id;
        }
      }
      if (status_reservation !== undefined) updateData.status_reservation = status_reservation;
      if (dept_branch !== undefined) updateData.dept_branch = dept_branch;

      await prisma.folios.update({ where: { id }, data: updateData });

      // Update reservation items if provided
      if (reservation_list && reservation_list.length > 0 && existing.type_reservation !== 'git') {
        // Delete old reservations
        await prisma.reservations.updateMany({
          where: { folio_id: id, deleted_at: null },
          data: { deleted_at: new Date() },
        });

        // Create new reservations
        for (const item of reservation_list) {
          const itemCheckIn = new Date(item.check_in_date);
          const itemCheckOut = new Date(item.check_out_date);
          const nights = Math.ceil((itemCheckOut.getTime() - itemCheckIn.getTime()) / (1000 * 60 * 60 * 24));

          for (let i = 0; i < nights; i++) {
            const nightDate = new Date(itemCheckIn);
            nightDate.setDate(nightDate.getDate() + i);

            await prisma.reservations.create({
              data: {
                property_id: existing.property_id,
                folio_id: id,
                rate_id: item.rate_id ? BigInt(item.rate_id) : null,
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
                amount: 0,
                amountt: 0,
                total: 0,
                service_charge: 0,
                pb1: 0,
                tax3: 0,
                created_by: userId,
              },
            });
          }
        }
      }

      const updated = await prisma.folios.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Reservation update error:', err);
      error(res, 'Failed to update reservation', 500);
    }
  }

  // ─────────────────────────────────────────────
  // DELETE /api/reservations/:id
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // POST /api/reservations/:id/restore
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // GET /api/reservations/calendar
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // GET /api/reservations/arrivals
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // GET /api/reservations/departures
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // GET /api/reservations/in-house
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // GET /api/reservations/pending
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // POST /api/reservations/on-check
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // POST /api/reservations/:id/check-in
  // ─────────────────────────────────────────────
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

      // Update all reservation items
      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.check_in.id },
      });

      success(res, { folio_id: Number(id), status_reservation: STATUS_RESERVATION.check_in.id }, 'Success');
    } catch (err: any) {
      console.error('Reservation check-in error:', err);
      error(res, 'Failed to check in', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/reservations/:id/check-out
  // ─────────────────────────────────────────────
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

      success(res, { folio_id: Number(id), status_reservation: STATUS_RESERVATION.check_out.id }, 'Success');
    } catch (err: any) {
      console.error('Reservation check-out error:', err);
      error(res, 'Failed to check out', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/reservations/:id/cancel
  // ─────────────────────────────────────────────
  static async cancel(req: Request, res: Response): Promise<void> {
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
          status_reservation: STATUS_RESERVATION.cancel_reservation.id,
          updated_at: new Date(),
        },
      });

      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.cancel_reservation.id },
      });

      success(res, { folio_id: Number(id), status_reservation: STATUS_RESERVATION.cancel_reservation.id }, 'Success');
    } catch (err: any) {
      console.error('Reservation cancel error:', err);
      error(res, 'Failed to cancel reservation', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/reservations/:id/confirm
  // ─────────────────────────────────────────────
  static async confirm(req: Request, res: Response): Promise<void> {
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
          status_reservation: STATUS_RESERVATION.reservation.id,
          is_pending: false,
          updated_at: new Date(),
        },
      });

      await prisma.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.reservation.id },
      });

      success(res, { folio_id: Number(id), status_reservation: STATUS_RESERVATION.reservation.id }, 'Success');
    } catch (err: any) {
      console.error('Reservation confirm error:', err);
      error(res, 'Failed to confirm reservation', 500);
    }
  }

  // ─────────────────────────────────────────────
  // POST /api/reservations/:id/unassign-room
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // POST /api/reservations/:id/replicate
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // POST /api/reservations/update-bulk
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // POST /api/reservations/:id/assign-room
  // ─────────────────────────────────────────────
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

      success(res, bigintToNumber(updatedFolio), 'Success');
    } catch (err: any) {
      console.error('Reservation assign room error:', err);
      error(res, 'Failed to assign room', 500);
    }
  }

  // ─────────────────────────────────────────────
  // Reservation Items (sub-resource)
  // ─────────────────────────────────────────────

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

  private static bn(val: any): any {
    if (typeof val === 'bigint') return Number(val);
    if (Array.isArray(val)) return val.map((v) => reservationBn(v));
    if (val && typeof val === 'object') { const o: any = {}; for (const [k, v] of Object.entries(val)) o[k] = reservationBn(v); return o; }
    return val;
  }

  // ─────────────────────────────────────────────
  // GET /cms/reservation/code-item (additional item page)
  // ─────────────────────────────────────────────
  static async codeItemList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const where: any = { deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };
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
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Code item list error:', err); error(res, 'Failed to list code items', 500); }
  }

  // ─────────────────────────────────────────────
  // GET /cms/reservation/inclusive
  // ─────────────────────────────────────────────
  static async inclusiveList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const modelIdRaw = String(req.query.subfolio_id ?? req.query.code_item_id ?? '');
      const where: any = { model_type: 'App\\Models\\CodeItem' };
      if (/^\d+$/.test(modelIdRaw)) where.model_id = BigInt(modelIdRaw);
      const [data, total] = await Promise.all([
        prisma.model_has_rate_inclusives.findMany({
          where,
          include: { rate_inclusives: true },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.model_has_rate_inclusives.count({ where }),
      ]);
      const rows = data.map(d => ({ ...reservationBn(d), ...reservationBn(d.rate_inclusives) }));
      const table = [
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Stock', key: 'stock', type: 'none', is_search: false },
        { label: 'Frequency', key: 'frequency', type: 'none', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
        { label: 'Cost On', key: 'cost_on', type: 'none', is_search: false },
      ];
      success(res, rows, 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Inclusive list error:', err); error(res, 'Failed to list inclusives', 500); }
  }

  // ─────────────────────────────────────────────
  // GET /cms/reservation/masterInclusive
  // ─────────────────────────────────────────────
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
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Master inclusive list error:', err); error(res, 'Failed to list inclusives', 500); }
  }

  // ─────────────────────────────────────────────
  // GET /cms/reservation/master
  // Laravel parity (ReservationController@getMaster)
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // GET /cms/reservation/subfolio/:id
  // ─────────────────────────────────────────────
  static async subfolioList(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!/^\d+$/.test(raw)) { success(res, { data: [] }, 'Success'); return; }
      const parentId = BigInt(raw);
      const subs = await prisma.folios.findMany({ where: { parent: parentId }, select: { id: true, folio_number: true }, orderBy: { id: 'asc' } });
      success(res, { data: subs.map(s => ({ value: Number(s.id), label: s.folio_number })) }, 'Success');
    } catch (err: any) { console.error('Subfolio list error:', err); error(res, 'Failed to list subfolios', 500); }
  }
}
