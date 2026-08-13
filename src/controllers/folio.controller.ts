import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATUS_RESERVATION: Record<string, { id: number; code: string; name: string }> = {
  reservation: { id: 1, code: 'reservation', name: 'Reservation' },
  check_in: { id: 2, code: 'check_in', name: 'Check In' },
  check_out: { id: 3, code: 'check_out', name: 'Check Out' },
  cancel_reservation: { id: 4, code: 'cancel_reservation', name: 'Cancel Reservation' },
  pending: { id: 0, code: 'pending', name: 'Pending' },
};

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

function formatFolioBrief(f: any) {
  return {
    id: Number(f.id),
    folio_number: f.folio_number,
    parent: Number(f.parent),
    type_reservation: f.type_reservation,
    first_name: f.first_name,
    last_name: f.last_name,
    company_name: f.company_name,
    status_reservation: f.status_reservation,
    check_in_date: f.check_in_date,
    check_out_date: f.check_out_date,
    total_amount: Number(f.total_amount),
    is_day_use: f.is_day_use,
    is_walk_in: f.is_walk_in,
    is_house_use: f.is_house_use,
    complimentary: f.complimentary,
    is_virtual: f.is_virtual,
    guest_profile_id: f.guest_profile_id ? Number(f.guest_profile_id) : null,
    company_profile_id: f.company_profile_id ? Number(f.company_profile_id) : null,
  };
}

export class FolioController {
  static async search(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const q = (req.query.q as string || '').trim();
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!q || q.length < 2) {
        success(res, [], 'Success', 200, { page, total: 0 } as any);
        return;
      }

      const where: any = {
        deleted_at: null,
        is_pos_trx: false,
        property_id: pid,
        OR: [
          { folio_number: { contains: q, mode: 'insensitive' } },
          { first_name: { contains: q, mode: 'insensitive' } },
          { last_name: { contains: q, mode: 'insensitive' } },
          { company_name: { contains: q, mode: 'insensitive' } },
        ],
      };

      const [folios, total] = await Promise.all([
        prisma.folios.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            reservations: {
              where: { deleted_at: null },
              include: { room_types: { select: { name: true } } },
            },
          },
        }),
        prisma.folios.count({ where }),
      ]);

      const formatted = folios.map((f: any) => ({
        ...formatFolioBrief(f),
        room_name: f.reservations?.[0]?.room_name || null,
        room_type_name: f.reservations?.[0]?.room_types?.name || null,
      }));

      success(res, formatted, 'Success', 200, { page, total } as any);
    } catch (err: any) {
      console.error('Folio search error:', err);
      error(res, 'Failed to search folios', 500);
    }
  }

  static async quickSearch(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const q = (req.query.q as string || '').trim();

      if (!q || q.length < 1) {
        success(res, [], 'Success');
        return;
      }

      const folios = await prisma.folios.findMany({
        where: {
          deleted_at: null,
          is_pos_trx: false,
          property_id: pid,
          OR: [
            { folio_number: { contains: q, mode: 'insensitive' } },
            { first_name: { contains: q, mode: 'insensitive' } },
            { last_name: { contains: q, mode: 'insensitive' } },
            { company_name: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: { id: 'desc' },
        take: 10,
        select: {
          id: true,
          folio_number: true,
          first_name: true,
          last_name: true,
          company_name: true,
          type_reservation: true,
          status_reservation: true,
          check_in_date: true,
          check_out_date: true,
        },
      });

      const formatted = folios.map((f: any) => ({
        id: Number(f.id),
        folio_number: f.folio_number,
        label: f.folio_number
          ? `${f.folio_number} - ${f.first_name || ''} ${f.last_name || ''}${f.company_name ? ` (${f.company_name})` : ''}`
          : `${f.first_name || ''} ${f.last_name || ''}${f.company_name ? ` (${f.company_name})` : ''}`,
        first_name: f.first_name,
        last_name: f.last_name,
        company_name: f.company_name,
      }));

      success(res, formatted, 'Success');
    } catch (err: any) {
      console.error('Folio quick search error:', err);
      error(res, 'Failed to search folios', 500);
    }
  }

  static async subfolios(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;

      const parent = await prisma.folios.findUnique({
        where: { id },
        select: { id: true, folio_number: true },
      });
      if (!parent) {
        notFound(res, 'Folio not found');
        return;
      }

      const children = await prisma.folios.findMany({
        where: {
          parent: id,
          deleted_at: null,
          property_id: pid,
        },
        orderBy: { id: 'asc' },
        include: {
          reservations: {
            where: { deleted_at: null },
            include: {
              room_types: { select: { name: true } },
            },
          },
        },
      });

      const formatted = children.map((c: any) => ({
        ...formatFolioBrief(c),
        room_name: c.reservations?.[0]?.room_name || null,
        room_type_name: c.reservations?.[0]?.room_types?.name || null,
        room_number: c.reservations?.[0]?.rooms?.name || null,
      }));

      success(res, formatted, 'Success', 200, { parent_id: Number(id), parent_folio: parent.folio_number } as any);
    } catch (err: any) {
      console.error('Folio subfolios error:', err);
      error(res, 'Failed to load sub-folios', 500);
    }
  }

  static async ledger(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);

      const folio: any = await prisma.folios.findUnique({
        where: { id },
        include: {
          billing_tos: {
            where: { deleted_at: null },
            include: {
              code_billings: { select: { id: true, name: true } },
            },
          },
          transactions: {
            where: { deleted_at: null },
            orderBy: { date: 'desc' },
            take: 50,
          },
        },
      });

      if (!folio) {
        notFound(res, 'Folio not found');
        return;
      }

      const ledger = {
        folio_id: Number(id),
        folio_number: folio.folio_number,
        guest_name: `${folio.first_name || ''} ${folio.last_name || ''}`.trim(),
        billing_tos: (folio.billing_tos || []).map((bt: any) => ({
          id: Number(bt.id),
          billing_code: Number(bt.billing_code),
          code_name: bt.code_billings?.name || null,
          model_type: bt.model_type,
          model_id: bt.model_id ? Number(bt.model_id) : null,
        })),
        recent_transactions: (folio.transactions || []).map((t: any) => ({
          id: Number(t.id),
          date: t.date,
          code: t.code,
          code_name: t.code_name,
          description: t.description,
          amount: Number(t.amount),
          total: Number(t.total),
          type_amount: t.type_amount,
          bill_to: t.bill_to,
        })),
      };

      success(res, ledger, 'Success');
    } catch (err: any) {
      console.error('Folio ledger error:', err);
      error(res, 'Failed to load ledger', 500);
    }
  }

  static async master(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const [roomTypes, companies, types, codeBillings] = await Promise.all([
        prisma.room_types.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.company_profiles.findMany({
          where: { deleted_at: null, status_company: '1' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: {
            deleted_at: null,
            status: 1,
            group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source', 'guest-status', 'cancellation-reservation'] },
          },
          select: { id: true, name: true, group: true },
        }),
        prisma.code_billings.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const groupBy = (arr: any[], key: string) =>
        arr.reduce((acc: any, item: any) => {
          (acc[item[key]] = acc[item[key]] || []).push(item);
          return acc;
        }, {});

      const grouped = groupBy(types, 'group');

      const result = {
        status_reservations: [
          { value: 'reservation', label: 'Reservation' },
          { value: 'pending', label: 'Pending' },
          { value: 'check_in', label: 'Check In' },
          { value: 'check_out', label: 'Check Out' },
          { value: 'cancel_reservation', label: 'Cancel Reservation' },
        ],
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        companies: companies.map((c: any) => ({ value: Number(c.id), label: c.name })),
        code_billings: codeBillings.map((cb: any) => ({ value: Number(cb.id), label: cb.name })),
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
      };

      success(res, [], 'Success', 200, { master: result } as any);
    } catch (err: any) {
      console.error('Folio master error:', err);
      error(res, 'Failed to load master data', 500);
    }
  }

  static async updateStatus(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const userId = req.user?.id;
      const { status_reservation, check_in_date, check_out_date, reason } = req.body;

      const folio: any = await prisma.folios.findUnique({ where: { id } });
      if (!folio) {
        notFound(res, 'Folio not found');
        return;
      }

      const updateData: any = { updated_at: new Date() };

      if (status_reservation) {
        const found = Object.values(STATUS_RESERVATION).find((s) => s.code === status_reservation);
        if (!found) {
          badRequest(res, `Invalid status: ${status_reservation}`);
          return;
        }
        updateData.status_reservation = found.id;
      }

      if (check_in_date) updateData.check_in_date = new Date(check_in_date);
      if (check_out_date) updateData.check_out_date = new Date(check_out_date);

      if (status_reservation === 'cancel_reservation') {
        updateData.data = JSON.stringify({
          ...(folio.data ? JSON.parse(folio.data as string) : {}),
          cancel_reason: reason || null,
          cancelled_at: new Date().toISOString(),
          cancelled_by: Number(userId),
        });
      }

      if (status_reservation === 'check_in' && !check_in_date) {
        updateData.check_in_date = new Date();
      }

      if (status_reservation === 'check_out' && !check_out_date) {
        updateData.check_out_date = new Date();
      }

      await prisma.folios.update({ where: { id }, data: updateData });

      const updated: any = await prisma.folios.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Status updated successfully');
    } catch (err: any) {
      console.error('Folio updateStatus error:', err);
      error(res, 'Failed to update status', 500);
    }
  }

  static async updateData(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { remark, remark_ins, check_in_instruction, check_out_instruction, posting_instruction } = req.body;

      const folio: any = await prisma.folios.findUnique({ where: { id } });
      if (!folio) {
        notFound(res, 'Folio not found');
        return;
      }

      const updateData: any = { updated_at: new Date() };
      if (remark !== undefined) updateData.remark = remark;
      if (remark_ins !== undefined) updateData.remark_ins = remark_ins;
      if (check_in_instruction !== undefined) updateData.check_in_instruction = check_in_instruction;
      if (check_out_instruction !== undefined) updateData.check_out_instruction = check_out_instruction;
      if (posting_instruction !== undefined) updateData.posting_instruction = posting_instruction;

      await prisma.folios.update({ where: { id }, data: updateData });

      const updated: any = await prisma.folios.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Folio data updated successfully');
    } catch (err: any) {
      console.error('Folio updateData error:', err);
      error(res, 'Failed to update folio data', 500);
    }
  }

  static async guestFolios(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;

      const folios = await prisma.folios.findMany({
        where: {
          guest_profile_id: guestId,
          property_id: pid,
          deleted_at: null,
          is_pos_trx: false,
        },
        orderBy: { check_in_date: 'desc' },
        include: {
          reservations: {
            where: { deleted_at: null },
            include: { room_types: { select: { name: true } } },
          },
        },
      });

      const formatted = folios.map((f: any) => ({
        ...formatFolioBrief(f),
        room_name: f.reservations?.[0]?.room_name || null,
        room_type_name: f.reservations?.[0]?.room_types?.name || null,
      }));

      success(res, formatted, 'Success');
    } catch (err: any) {
      console.error('Guest folios error:', err);
      error(res, 'Failed to load guest folios', 500);
    }
  }

  static async createGuestFolio(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;

      const guest: any = await prisma.guest_profiles.findUnique({ where: { id: guestId } });
      if (!guest) {
        notFound(res, 'Guest not found');
        return;
      }

      const { type_reservation = 'fit', check_in_date, check_out_date } = req.body;

      const folio = await prisma.folios.create({
        data: {
          property_id: pid,
          type_reservation,
          guest_profile_id: guestId,
          company_profile_id: 0n,
          is_compliment_tour_leader: false,
          first_name: guest.first_name,
          last_name: guest.last_name,
          telp: guest.telp,
          email: guest.email,
          gender: guest.gender,
          mobile_phone: guest.mobile_phone,
          address: guest.address,
          nationality_id: guest.nationality_id,
          status_reservation: STATUS_RESERVATION.reservation.id,
          check_in_date: check_in_date ? new Date(check_in_date) : null,
          check_out_date: check_out_date ? new Date(check_out_date) : null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(folio), 'Guest folio created successfully');
    } catch (err: any) {
      console.error('Create guest folio error:', err);
      error(res, 'Failed to create guest folio', 500);
    }
  }

  static async deleteGuestFolio(req: Request, res: Response): Promise<void> {
    try {
      const folioId = idParam(req.params.folioId);

      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) {
        notFound(res, 'Folio not found');
        return;
      }

      await prisma.folios.update({
        where: { id: folioId },
        data: { deleted_at: new Date() },
      });

      success(res, null, 'Guest folio deleted successfully');
    } catch (err: any) {
      console.error('Delete guest folio error:', err);
      error(res, 'Failed to delete guest folio', 500);
    }
  }

  static async companyFolios(req: Request, res: Response): Promise<void> {
    try {
      const companyId = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;

      const folios = await prisma.folios.findMany({
        where: {
          company_profile_id: companyId,
          property_id: pid,
          deleted_at: null,
          is_pos_trx: false,
        },
        orderBy: { check_in_date: 'desc' },
        include: {
          reservations: {
            where: { deleted_at: null },
            include: { room_types: { select: { name: true } } },
          },
        },
      });

      const formatted = folios.map((f: any) => ({
        ...formatFolioBrief(f),
        room_name: f.reservations?.[0]?.room_name || null,
        room_type_name: f.reservations?.[0]?.room_types?.name || null,
      }));

      success(res, formatted, 'Success');
    } catch (err: any) {
      console.error('Company folios error:', err);
      error(res, 'Failed to load company folios', 500);
    }
  }

  static async createCompanyFolio(req: Request, res: Response): Promise<void> {
    try {
      const companyId = idParam(req.params.id);
      const pid = req.user?.lastProperty ?? 0n;

      const company: any = await prisma.company_profiles.findUnique({ where: { id: companyId } });
      if (!company) {
        notFound(res, 'Company not found');
        return;
      }

      const { type_reservation = 'fit', check_in_date, check_out_date } = req.body;

      const folio = await prisma.folios.create({
        data: {
          property_id: pid,
          type_reservation,
          company_profile_id: companyId,
          is_compliment_tour_leader: false,
          company_name: company.name,
          status_reservation: STATUS_RESERVATION.reservation.id,
          check_in_date: check_in_date ? new Date(check_in_date) : null,
          check_out_date: check_out_date ? new Date(check_out_date) : null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(folio), 'Company folio created successfully');
    } catch (err: any) {
      console.error('Create company folio error:', err);
      error(res, 'Failed to create company folio', 500);
    }
  }

  static async deleteCompanyFolio(req: Request, res: Response): Promise<void> {
    try {
      const folioId = idParam(req.params.folioId);

      const folio: any = await prisma.folios.findUnique({ where: { id: folioId } });
      if (!folio) {
        notFound(res, 'Folio not found');
        return;
      }

      await prisma.folios.update({
        where: { id: folioId },
        data: { deleted_at: new Date() },
      });

      success(res, null, 'Company folio deleted successfully');
    } catch (err: any) {
      console.error('Delete company folio error:', err);
      error(res, 'Failed to delete company folio', 500);
    }
  }
}
