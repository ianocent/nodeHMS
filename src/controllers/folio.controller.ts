import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { folioBalanceWithoutPosting, transferTransactionsForCheckout } from './front-desk.controller';
import { AuthController } from './auth.controller';
import { enqueueJob } from '../config/queue';
import { priceNight } from '../utils/reservationPricing';
import { availableRoom } from '../utils/roomAvailability';

// Wrapper for drag/copy rebuild — priced per-night row creation against an arbitrary tx client.
function priceNightPublic(tx: any, opts: {
  rateId: bigint | null;
  roomTypeId: bigint;
  night: Date;
  getNight: number;
  adult: number;
  child: number;
  isTax: boolean;
  rateCodePost: any;
}) {
  return priceNight({
    prisma: tx as any,
    ...opts,
    quantity: 1,
    promos: [],
  } as any);
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATUS_RESERVATION: Record<string, { id: number; code: string; name: string }> = {
  check_in: { id: 0, code: 'check_in', name: 'Check In' },
  check_out: { id: 1, code: 'check_out', name: 'Check Out' },
  cancel_reservation: { id: 2, code: 'cancel_reservation', name: 'Cancelled' },
  reservation: { id: 3, code: 'reservation', name: 'Reservation' },
  in_house: { id: 4, code: 'in_house', name: 'In House' },
  pending: { id: 5, code: 'pending', name: 'Pending' },
};

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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

// Laravel Room::AvailableRoom parity (simplified): room blocked if it has availability hold, active work order, or overlapping reservation in [start, end)
async function isRoomAvailableFor(propertyId: bigint, roomId: bigint, start: string, end: string, excludeFolioId?: bigint): Promise<boolean> {
  const s = new Date(start + 'T00:00:00.000Z');
  const e = new Date(end + 'T23:59:59.999Z');
  const [room, avail, workOrders, reservations] = await Promise.all([
    prisma.rooms.findUnique({ where: { id: roomId }, select: { id: true, deleted_at: true } }),
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
  return !!room && !room.deleted_at && avail.length === 0 && workOrders.length === 0 && reservations.length === 0;
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
          { label: 'Normal', value: 'normal' },
          { label: 'Walk In', value: 'is_walk_in' },
          { label: 'House Use', value: 'is_house_use' },
          { label: 'Complimentary', value: 'complimentary' },
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
      const id = idParam(req.params.folio);
      const userId = req.user?.id;
      const { status_reservation, check_in_date, check_out_date, reason, to_virtual } = req.body;

      const folio: any = await prisma.folios.findUnique({ where: { id } });
      if (!folio) {
        notFound(res, 'Folio not found');
        return;
      }

      const updateData: any = { updated_at: new Date() };

      // Laravel Folio.php parity: confirm/cancel change room (room swap actions)
      if (status_reservation === 'confirm_change_room' || status_reservation === 'cancel_change_room') {
        if (String(folio.type_reservation || '').toLowerCase() === 'git' && Number(folio.parent) === 0) {
          badRequest(res, 'Action not allowed');
          return;
        }
        const resvs = await prisma.reservations.findMany({ where: { folio_id: id, deleted_at: null } });
        const propertyId = req.user?.lastProperty ?? 0n;
        const businessDate = new Date().toISOString().slice(0, 10);
        const isCheckedIn = folio.status_reservation === STATUS_RESERVATION.check_in.id;

        if (status_reservation === 'confirm_change_room') {
          for (const resv of resvs) {
            if (resv.room_id_next == null && resv.room_type_id_next == null) continue;
            if (resv.room_id_next != null) {
              const room = await prisma.rooms.findUnique({ where: { id: resv.room_id_next } });
              if (!room) {
                badRequest(res, 'Room Not Found');
                return;
              }
              const start = resv.date ? resv.date.toISOString().slice(0, 10) : businessDate;
              const end = new Date(new Date(start + 'T00:00:00.000Z').getTime() + 86400000).toISOString().slice(0, 10);
              const available = await isRoomAvailableFor(propertyId, resv.room_id_next, start, end, id);
              if (!available) {
                badRequest(res, 'Room Not Available');
                return;
              }
            }
            if (resv.room_id_next != null) {
              if (resv.room_id != null && isCheckedIn) {
                await prisma.rooms.update({
                  where: { id: resv.room_id },
                  data: { room_status: 0, maid_status: 1, updated_at: new Date() },
                });
              }
              const dateStr = resv.date ? resv.date.toISOString().slice(0, 10) : '';
              if (dateStr === businessDate && isCheckedIn) {
                await prisma.rooms.update({
                  where: { id: resv.room_id_next },
                  data: { room_status: 1, maid_status: 0, updated_at: new Date() },
                });
              }
            }
            const fromRoomId = resv.room_id;
            const fromRoomTypeId = resv.room_type_id;
            const toRoomId = resv.room_id_next;
            const toRoomTypeId = resv.room_type_id_next;
            await prisma.reservations.update({
              where: { id: resv.id },
              data: {
                room_id: resv.room_id_next ?? resv.room_id,
                room_id_next: null,
                room_type_id: resv.room_type_id_next ?? resv.room_type_id,
                room_type_id_next: null,
                updated_at: new Date(),
              },
            });
            if (fromRoomId != null && toRoomId != null) {
              await prisma.room_change_histories.create({
                data: {
                  property_id: propertyId,
                  folio_id: id,
                  folio_number: folio.folio_number ?? '',
                  check_in_date: folio.check_in_date ?? new Date(),
                  check_out_date: folio.check_out_date ?? new Date(),
                  from_room_id: fromRoomId,
                  from_room_type_id: fromRoomTypeId ?? 0n,
                  to_room_id: toRoomId,
                  to_room_type_id: toRoomTypeId ?? 0n,
                  user_id: userId ?? 0n,
                  datetime: new Date(),
                  reason: reason ?? null,
                },
              });
            }
          }
          updateData.data = JSON.stringify({
            ...(folio.data ? JSON.parse(folio.data as string) : {}),
            remark_confirm_change_room: reason ?? null,
          });
        } else {
          for (const resv of resvs) {
            if (resv.room_id_next == null && resv.room_type_id_next == null) continue;
            await prisma.reservations.update({
              where: { id: resv.id },
              data: { room_id_next: null, room_type_id_next: null, updated_at: new Date() },
            });
          }
          updateData.data = JSON.stringify({
            ...(folio.data ? JSON.parse(folio.data as string) : {}),
            remark_cancel_change_room: reason ?? null,
          });
        }

        await prisma.folios.update({ where: { id }, data: updateData });
        const updated: any = await prisma.folios.findUnique({ where: { id } });
        success(res, bigintToNumber(updated), 'Status updated successfully');
        return;
      }

      // ── Laravel setUpdateStatus action: confirm_reservation (:2003-2029) ──
      if (status_reservation === 'confirm_reservation') {
        const remarkKey = { remark_confirm_reservation: reason ?? null };
        const isGitParent = String(folio.type_reservation || '').toLowerCase() === 'git' && Number(folio.parent) === 0;
        updateData.status_reservation = STATUS_RESERVATION.reservation.id;
        updateData.is_pending = false;        updateData.data = JSON.stringify({ ...(folio.data ? JSON.parse(folio.data as string) : {}), ...remarkKey });
        if (isGitParent) {
          const children = await prisma.folios.findMany({
            where: { parent: id, status_reservation: { not: STATUS_RESERVATION.cancel_reservation.id } },
          });
          for (const child of children) {
            await prisma.folios.update({
              where: { id: child.id },
              data: {
                status_reservation: STATUS_RESERVATION.reservation.id,
                is_pending: false,
                data: JSON.stringify({ ...(child.data ? JSON.parse(child.data as string) : {}), ...remarkKey }),
                updated_at: new Date(),
              },
            });
          }
        }
        await prisma.folios.update({ where: { id }, data: updateData });
        const updated: any = await prisma.folios.findUnique({ where: { id } });
        enqueueJob('sync-staah-room-availability', { propertyId: Number(updated?.property_id ?? 0) });
        success(res, bigintToNumber(updated), 'Reservation confirmed');
        return;
      }

      // ── Laravel setUpdateStatus action: copy_reservation (:1942-2001) ──
      if (status_reservation === 'copy_reservation') {
        const isGitParent = String(folio.type_reservation || '').toLowerCase() === 'git' && Number(folio.parent) === 0;
        if (isGitParent) { badRequest(res, 'Action not allowed'); return; }

        const bussinesDate = await AuthController.getBusinessDate(req.user?.lastProperty ?? null);
        const srcResvs = await prisma.reservations.findMany({
          where: { folio_id: id, deleted_at: null },
          orderBy: { date: 'asc' },
          include: { room_types: { select: { name: true } }, rates: { select: { id: true, name: true, code_post_id: true } } },
        });
        const firstResv = srcResvs[0];
        const getNight = firstResv
          ? Math.max(1, Math.ceil((new Date(String(firstResv.check_out_date ?? Date.now())).getTime() - new Date(String(firstResv.check_in_date ?? Date.now())).getTime()) / 86400000))
          : 1;
        const newCheckIn = `${bussinesDate}T00:00:00`;
        const newCheckOutDate: Date = new Date(new Date(newCheckIn).getTime() + getNight * 86400000);

        // Generate new folio number (Laravel generateCodeReservation)
        const lastFolio = await prisma.folios.findFirst({
          where: { property_id: folio.property_id, type_reservation: folio.type_reservation },
          orderBy: { id: 'desc' },
          select: { folio_number: true },
        });
        let seq = 1;
        if (lastFolio?.folio_number) {
          const parts = String(lastFolio.folio_number).split('/');
          const lastSeg = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(lastSeq(lastFolio.folio_number))) seq = lastSeq(lastFolio.folio_number) + 1;
        }
        function lastSeq(fn: string): number {
          const p = fn.split('/');
          return parseInt(p[p.length - 1], 10) || 0;
        }
        const prefix = String(folio.folio_number ?? '').split('/')[0] || 'RES';
        const newFolioNumber = `${prefix}/${String(seq).padStart(3, '0')}`;

        const newCheckInDate = new Date(newCheckIn);
        const folioReplicate = await prisma.folios.create({
          data: {
            property_id: folio.property_id,
            type_reservation: folio.type_reservation,
            guest_profile_id: folio.guest_profile_id,
            company_profile_id: folio.company_profile_id,
            company_name: folio.company_name ?? null,
            first_name: folio.first_name,
            last_name: folio.last_name,
            email: folio.email,
            telp: folio.telp,
            address: folio.address ?? null,
            nationality_id: folio.nationality_id ?? null,
            check_in_date: new Date(newCheckIn),
            check_out_date: newCheckOutDate,
            booking_no: folio.booking_no ?? null,
            remark: folio.remark ?? null,
            folio_number: newFolioNumber,
            is_pending: false,
            status_reservation: STATUS_RESERVATION.reservation.id,
            parent: 0n,
            is_compliment_tour_leader: false,
            status: 1,
            created_at: new Date(),
            updated_at: new Date(),
            created_by: userId,
          },
        });

        // Copy inclusive items (Laravel :1968-1985)
        const srcCodeItems: any[] = await prisma.$queryRaw`
          SELECT * FROM model_has_code_items
          WHERE model_id = ${id} AND model_type = ${'App\\Models\\Folio'}`;
        for (const ci of srcCodeItems) {
          await prisma.$executeRaw`
            INSERT INTO model_has_code_items (model_id, model_type, code_item_id, reason, start_date, end_date, sales, process_on, code_post_id, name, description)
            VALUES (${folioReplicate.id}, ${'App\\Models\\Folio'}, ${ci.code_item_id}, ${ci.reason ?? ''},
                    ${newCheckInDate}, ${newCheckOutDate},
                    ${ci.sales ?? null}, ${ci.process_on ?? null}, ${ci.code_post_id ? Number(ci.code_post_id) : null},
                    ${ci.name ?? null}, ${ci.description ?? null})`;
        }

        // Priced per-night rows via saveReservation engine (rate_rates + occupancy + markup).
        if (firstResv) {
          const property: any = await prisma.properties.findUnique({ where: { id: folio.property_id }, select: { is_tax: true } });
          const isTax = property?.is_tax === 1;
          let cpRow: any = null;
          if (firstResv.rate_id) {
            const rate: any = await prisma.rates.findUnique({ where: { id: BigInt(firstResv.rate_id) }, select: { code_post_id: true } });
            if (rate?.code_post_id) cpRow = await prisma.code_posts.findUnique({ where: { id: BigInt(rate.code_post_id) } });
          }
          const rtId = BigInt(firstResv.room_type_id ?? 0);
          for (let i = 0; i < getNight; i++) {
            const nightDate = new Date(newCheckInDate.getTime() + i * 86400000);
            const pricing = await priceNightPublic(prisma, {
              rateId: firstResv.rate_id ? BigInt(firstResv.rate_id) : null,
              roomTypeId: rtId,
              night: nightDate,
              getNight,
              adult: Number(firstResv.adult ?? 1),
              child: Number(firstResv.child ?? 0),
              isTax,
              rateCodePost: cpRow,
            });
            await prisma.reservations.create({
              data: {
                property_id: folio.property_id,
                folio_id: folioReplicate.id,
                rate_id: firstResv.rate_id ? BigInt(firstResv.rate_id) : null,
                room_type_id: rtId,
                room_id: null,
                adult: firstResv.adult ?? 1,
                child: firstResv.child ?? 0,
                add_bed: firstResv.add_bed ?? 0,
                check_in_date: new Date(newCheckIn),
                check_out_date: newCheckOutDate,
                date: nightDate,
                night: getNight,
                amount: pricing.amount,
                total: pricing.total,
                service_charge: pricing.service_charge,
                pb1: pricing.pb1,
                tax3: pricing.tax3,
                status_reservation: STATUS_RESERVATION.reservation.id,
                status: 1,
                created_by: userId,
              },
            });
          }
        }

        enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
        success(res, { folio_id: Number(folioReplicate.id), folio_number: folioReplicate.folio_number }, 'Reservation copied');
        return;
      }

      // ── Laravel setUpdateStatus action: move_reservation → performMoveReservation (:1137-1201) ──
      if (status_reservation === 'move_reservation') {
        const isGitParent = String(folio.type_reservation || '').toLowerCase() === 'git' && Number(folio.parent) === 0;
        if (isGitParent) { badRequest(res, 'Action not allowed'); return; }
        const toDateStr = req.body.to_date ?? req.body.date;
        const fromDateStr = req.body.from_date;
        if (!toDateStr) { badRequest(res, 'To Date is required'); return; }

        const fromStart = new Date(`${(fromDateStr ?? folio.check_in_date?.toISOString().slice(0, 10) ?? '')}T00:00:00`);
        const fromEnd = new Date(fromStart.getTime() + 86400000);
        const toStart = new Date(`${toDateStr}T00:00:00`);
        const shiftDays = Math.round((toStart.getTime() - fromStart.getTime()) / 86400000);

        const resvsToMove = await prisma.reservations.findMany({
          where: { folio_id: id, deleted_at: null, date: { gte: fromStart, lt: fromEnd } },
        });
        for (const r of resvsToMove) {
          const newDate = new Date(r.date!.getTime() + shiftDays * 86400000);
          await prisma.reservations.update({
            where: { id: r.id },
            data: { date: newDate, updated_at: new Date(), updated_by: userId },
          });
        }
        // Shift folio check-in/out by same delta
        if (folio.check_in_date) updateData.check_in_date = new Date(folio.check_in_date.getTime() + shiftDays * 86400000);
        if (folio.check_out_date) updateData.check_out_date = new Date(folio.check_out_date.getTime() + shiftDays * 86400000);

        enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
        // fall through to generic save below
      }

      // Map action keys to actual status codes (Laravel parity)
      let targetStatus: number | null = null;
      let targetStatusCode: string | null = null;

      if (status_reservation) {
        // Handle special action keys that map to status codes
        if (status_reservation === 'un_check_in') {
          targetStatusCode = 'reservation';
        } else if (status_reservation === 'un_check_out') {
          targetStatusCode = 'check_in';
        } else if (status_reservation === 'un_cancel_reservation') {
          // handled in dedicated branch below — skip generic mapping
          targetStatusCode = null;
        } else {
          targetStatusCode = status_reservation;
        }

        if (targetStatusCode !== null) {
          const found = Object.values(STATUS_RESERVATION).find((s) => s.code === targetStatusCode);
          if (!found) {
            badRequest(res, `Invalid status: ${status_reservation}`);
            return;
          }
          updateData.status_reservation = found.id;
        }
      }

      if (check_in_date) updateData.check_in_date = new Date(check_in_date);
      if (check_out_date) updateData.check_out_date = new Date(check_out_date);

      // Laravel parity: handle special actions
      if (status_reservation === 'cancel_reservation') {
        // Laravel parity (Folio.php:1515-1586)
        if (!reason) { badRequest(res, 'The remark field is required.'); return; }
        if (![STATUS_RESERVATION.reservation.id, STATUS_RESERVATION.pending.id].includes(folio.status_reservation)) {
          badRequest(res, 'Failed to cancel reservation, only reservation and pending status can be canceled');
          return;
        }
        const balance = await folioBalanceWithoutPosting(folio);
        if (![0, 1, -1].includes(Math.ceil(balance))) {
          badRequest(res, 'Payment required');
          return;
        }
        // Laravel restricts transferTransaction auto-pull to check_out only
        // (:792) — cancel does NOT trigger auto-transfer pulls.
        // (removed transferTransactionsForCheckout call that was here)

        // reset room change pointers
        await prisma.reservations.updateMany({
          where: { folio_id: id, deleted_at: null },
          data: { room_id_next: null, room_type_id_next: null },
        });

        updateData.status_reservation = STATUS_RESERVATION.cancel_reservation.id;
        updateData.data = JSON.stringify({
          ...(folio.data ? JSON.parse(folio.data as string) : {}),
          remark_cancel_reservation: reason || null,
          reason_cancel_reservation: (reason && typeof reason === 'object' ? reason.value : reason) || null,
        });

        // GIT parent → cascade cancel to child folios
        const isGitParent = String(folio.type_reservation || '').toLowerCase() === 'git' && Number(folio.parent) === 0;
        if (isGitParent) {
          await prisma.folios.updateMany({
            where: { parent: id },
            data: { status_reservation: STATUS_RESERVATION.cancel_reservation.id },
          });
        }
      }

      if (status_reservation === 'un_cancel_reservation') {
        // Laravel parity (Folio.php:1588-1614)
        if (folio.status_reservation !== STATUS_RESERVATION.cancel_reservation.id) {
          badRequest(res, 'Status reservation is not cancel_reservation');
          return;
        }
        updateData.status_reservation = STATUS_RESERVATION.reservation.id;
        updateData.data = JSON.stringify({
          ...(folio.data ? JSON.parse(folio.data as string) : {}),
          remark_un_cancel_reservation: reason || null,
        });
        const isGitParent = String(folio.type_reservation || '').toLowerCase() === 'git' && Number(folio.parent) === 0;
        if (isGitParent) {
          await prisma.folios.updateMany({
            where: { parent: id, status_reservation: STATUS_RESERVATION.cancel_reservation.id },
            data: { status_reservation: STATUS_RESERVATION.reservation.id },
          });
        }
      }

      if (status_reservation === 'un_check_in') {
        // Laravel parity (Folio.php:1422-1513)
        if (!reason) { badRequest(res, 'The remark field is required.'); return; }
        // Validate: can only un_check_in if check_in_date == business date
        const businessDate = await AuthController.getBusinessDate(req.user?.lastProperty ?? null);
        const folioCheckIn = folio.check_in_date ? new Date(folio.check_in_date.getTime() - folio.check_in_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '';
        if (folioCheckIn !== businessDate) {
          badRequest(res, 'Unable to un check-in');
          return;
        }

        updateData.status_reservation = STATUS_RESERVATION.reservation.id;

        // restore rooms: vacant + dirty
        const resvs = await prisma.reservations.findMany({
          where: { folio_id: id, deleted_at: null },
          select: { room_id: true, room_id_next: true },
        });
        const roomIds = resvs.map(r => r.room_id_next ?? r.room_id).filter((x): x is bigint => x != null);
        if (roomIds.length > 0) {
          await prisma.rooms.updateMany({
            where: { id: { in: roomIds } },
            data: { room_status: 0, maid_status: 1, updated_at: new Date() },
          });
        }

        updateData.data = JSON.stringify({
          ...(folio.data ? JSON.parse(folio.data as string) : {}),
          remark_un_check_in: reason,
        });

        // GIT parent → children back to reservation with room restore
        const isGitParent = String(folio.type_reservation || '').toLowerCase() === 'git' && Number(folio.parent) === 0;
        if (isGitParent) {
          const children = await prisma.folios.findMany({
            where: { parent: id, status_reservation: STATUS_RESERVATION.check_in.id },
          });
          for (const child of children) {
            await prisma.folios.update({ where: { id: child.id }, data: { status_reservation: STATUS_RESERVATION.reservation.id } });
            const childResvs = await prisma.reservations.findMany({ where: { folio_id: child.id, deleted_at: null }, select: { room_id: true, room_id_next: true } });
            const cRoomIds = childResvs.map(r => r.room_id_next ?? r.room_id).filter((x): x is bigint => x != null);
            if (cRoomIds.length > 0) {
              await prisma.rooms.updateMany({ where: { id: { in: cRoomIds } }, data: { room_status: 0, maid_status: 1, updated_at: new Date() } });
            }
          }
        }
      }

      if (status_reservation === 'un_check_out') {
        // Laravel parity (Folio.php:1823-1940)
        // Validate: must be in check_out status
        if (folio.status_reservation !== STATUS_RESERVATION.check_out.id) {
          badRequest(res, 'Status reservation is not check out');
          return;
        }
        if (!reason) {
          badRequest(res, 'Remark required');
          return;
        }
        const businessDate = await AuthController.getBusinessDate(req.user?.lastProperty ?? null);
        const bStart = new Date(businessDate + 'T00:00:00.000Z');
        const bEnd = new Date(bStart.getTime() + 86400000);
        const folioCheckoutStr = folio.check_out_date
          ? new Date(folio.check_out_date.getTime() - folio.check_out_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
          : '';

        // Laravel :1843-1848 — compare against BUSINESS DATE (not wall clock);
        // stale checkout → re-date to business date + convert to virtual.
        if (folio.check_out_date && folioCheckoutStr < businessDate) {
          updateData.check_out_date = bStart;
          updateData.type_reservation = 'vr';
          updateData.is_virtual = true;
        }
        if (to_virtual) {
          updateData.type_reservation = 'vr';
          updateData.is_virtual = true;
        }
        updateData.status_reservation = STATUS_RESERVATION.check_in.id;
        updateData.data = JSON.stringify({
          ...(folio.data ? JSON.parse(folio.data as string) : {}),
          remark_un_check_out: reason,
        });

        // NOTE: Laravel's main-folio room-status block here (:1858-1894) is DEAD CODE —
        // `$room` is only assigned inside other action branches (un_check_in/confirm_change_room/
        // check_out), so `if ($room && ...)` short-circuits false on every un_check_out request.
        // Room status stays whatever check-out left behind (vacant+dirty). Not emulated.

        // GIT parent → children back to check_in with due_out rooms (= Laravel :1902-1935).
        // Includes AvailableRoom 400-guard per child room.
        const isGitParent = String(folio.type_reservation || '').toLowerCase() === 'git' && Number(folio.parent) === 0;
        if (isGitParent) {
          const children = await prisma.folios.findMany({
            where: { parent: id, status_reservation: STATUS_RESERVATION.check_out.id },
          });
          for (const child of children) {
            const data: any = { status_reservation: STATUS_RESERVATION.check_in.id };
            if (to_virtual == 1 && child.check_out_date
              && new Date(child.check_out_date.getTime() - child.check_out_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10) === businessDate) {
              data.type_reservation = 'vr';
            }
            await prisma.folios.update({ where: { id: child.id }, data });
            const childResvs = await prisma.reservations.findMany({ where: { folio_id: child.id, deleted_at: null }, select: { room_id: true, room_id_next: true } });
            for (const r of childResvs) {
              const rid = r.room_id_next ?? r.room_id;
              if (rid == null) continue;
              const ok = await availableRoom(prisma, rid, bStart, bEnd, id);
              if (!ok) {
                badRequest(res, 'Room Not Available');
                return;
              }
              await prisma.rooms.update({ where: { id: rid }, data: { room_status: 2, updated_at: new Date() } });
            }
          }
        }
      }

      if (status_reservation === 'check_in' && !check_in_date) {
        updateData.check_in_date = new Date();
      }

      if (status_reservation === 'check_out' && !check_out_date) {
        updateData.check_out_date = new Date();
      }

      await prisma.folios.update({ where: { id }, data: updateData });

      const updated: any = await prisma.folios.findUnique({ where: { id } });
      // Laravel Folio::setUpdateStatus dispatches SyncStaahRoomAvailability (:2100)
      enqueueJob('sync-staah-room-availability', {
        propertyId: Number(updated?.property_id ?? 0),
        dateFrom: updated?.check_in_date ? formatDate(updated.check_in_date) : undefined,
        dateTo: updated?.check_out_date ? formatDate(updated.check_out_date) : undefined,
      });
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
