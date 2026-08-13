import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { StaahService } from '../services/staah.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const staahService = new StaahService();

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

// ═══════════════════════════════════════════════
// STAah Interfaces CRUD
// ═══════════════════════════════════════════════

export class StaahController {
  static async interfaceList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.staah_interfaces.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_interfaces.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      console.error('Staah interface list error:', err);
      error(res, 'Failed to list interfaces', 500);
    }
  }

  static async interfaceCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { hotel_id, hotel_type, time_zone, language_code, currency_code, hotel_info, hotel_description } = req.body;

      if (!hotel_id) { badRequest(res, 'hotel_id is required'); return; }

      const existing = await prisma.staah_interfaces.findFirst({
        where: { hotel_id, deleted_at: null },
      });
      if (existing) { badRequest(res, 'hotel_id already registered'); return; }

      const result = await prisma.staah_interfaces.create({
        data: {
          property_id: pid,
          hotel_id,
          hotel_type: hotel_type || 'Hotel',
          time_zone: time_zone || 'Asia/Jakarta',
          language_code: language_code || 'en',
          currency_code: currency_code || 'IDR',
          hotel_info,
          hotel_description,
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Interface created');
    } catch (err: any) {
      console.error('Staah interface create error:', err);
      error(res, 'Failed to create interface', 500);
    }
  }

  static async interfaceShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Interface not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load interface', 500);
    }
  }

  static async interfaceEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Interface not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load interface', 500);
    }
  }

  static async interfaceUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { hotel_type, time_zone, language_code, currency_code, hotel_info, hotel_description, status } = req.body;

      const existing = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Interface not found'); return; }

      const data: any = { updated_at: new Date() };
      if (hotel_type !== undefined) data.hotel_type = hotel_type;
      if (time_zone !== undefined) data.time_zone = time_zone;
      if (language_code !== undefined) data.language_code = language_code;
      if (currency_code !== undefined) data.currency_code = currency_code;
      if (hotel_info !== undefined) data.hotel_info = hotel_info;
      if (hotel_description !== undefined) data.hotel_description = hotel_description;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_interfaces.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Interface updated');
    } catch (err: any) {
      error(res, 'Failed to update interface', 500);
    }
  }

  static async interfaceDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Interface not found'); return; }
      await prisma.staah_interfaces.update({ where: { id }, data: { deleted_at: new Date(), status: 'inactive' } });
      success(res, null, 'Interface deleted');
    } catch (err: any) {
      error(res, 'Failed to delete interface', 500);
    }
  }

  static async testConnection(req: Request, res: Response): Promise<void> {
    try {
      const result = await staahService.testConnection();
      success(res, result, result.success ? 'Connection successful' : 'Connection failed');
    } catch (err: any) {
      error(res, 'STAAH connection test failed: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Room Mappings
  // ═══════════════════════════════════════════════

  static async roomMappingList(req: Request, res: Response): Promise<void> {
    try {
      const interfaceId = req.params.hotel_id ? idParam(req.params.hotel_id) : null;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null };
      if (interfaceId) where.staah_interface_id = interfaceId;

      const [data, total] = await Promise.all([
        prisma.staah_room_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { room_types: { select: { id: true, name: true } } },
        }),
        prisma.staah_room_mappings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list room mappings', 500);
    }
  }

  static async roomMappingEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.staah_room_mappings.findUnique({
        where: { id },
        include: { room_types: { select: { id: true, name: true } }, staah_interfaces: { select: { id: true, hotel_id: true } } },
      });
      if (!result) { notFound(res, 'Room mapping not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load room mapping', 500);
    }
  }

  static async roomMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { room_type_id, max_occupancy, max_child_occupancy, quantity, staah_room_id, status } = req.body;

      const existing = await prisma.staah_room_mappings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Room mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (room_type_id !== undefined) data.room_type_id = BigInt(room_type_id);
      if (max_occupancy !== undefined) data.max_occupancy = max_occupancy;
      if (max_child_occupancy !== undefined) data.max_child_occupancy = max_child_occupancy;
      if (quantity !== undefined) data.quantity = quantity;
      if (staah_room_id !== undefined) data.staah_room_id = staah_room_id;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_room_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Room mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update room mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Rate Mappings
  // ═══════════════════════════════════════════════

  static async rateMappingList(req: Request, res: Response): Promise<void> {
    try {
      const interfaceId = req.params.hotel_id ? idParam(req.params.hotel_id) : null;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null };
      if (interfaceId) where.staah_interface_id = interfaceId;

      const [data, total] = await Promise.all([
        prisma.staah_rate_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { rates: { select: { id: true, name: true } } },
        }),
        prisma.staah_rate_mappings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list rate mappings', 500);
    }
  }

  static async rateMappingEdit(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.staah_rate_mappings.findUnique({
        where: { id },
        include: { rates: { select: { id: true, name: true } }, staah_interfaces: { select: { id: true, hotel_id: true } } },
      });
      if (!result) { notFound(res, 'Rate mapping not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load rate mapping', 500);
    }
  }

  static async rateMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { rate_id, staah_rate_plan_id, meal_plan_id, status } = req.body;

      const existing = await prisma.staah_rate_mappings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Rate mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (rate_id !== undefined) data.rate_id = BigInt(rate_id);
      if (staah_rate_plan_id !== undefined) data.staah_rate_plan_id = staah_rate_plan_id;
      if (meal_plan_id !== undefined) data.meal_plan_id = meal_plan_id;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_rate_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Rate mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update rate mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Reservations (Webhook-pulled)
  // ═══════════════════════════════════════════════

  static async reservationList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const status = req.query.status as string;

      const where: any = {};
      if (status) where.status = status;

      const [data, total] = await Promise.all([
        prisma.staah_reservations.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            staah_interfaces: { select: { hotel_id: true } },
            folios: { select: { id: true, folio_number: true, booking_no: true } },
          },
        }),
        prisma.staah_reservations.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list reservations', 500);
    }
  }

  static async reservationConfirm(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const staahRes = await prisma.staah_reservations.findUnique({ where: { id } });
      if (!staahRes) { notFound(res, 'Reservation not found'); return; }

      await prisma.staah_reservations.update({
        where: { id },
        data: { status: '1', message: 'Confirmed', updated_at: new Date() },
      });

      success(res, null, 'Reservation confirmed');
    } catch (err: any) {
      error(res, 'Failed to confirm reservation', 500);
    }
  }

  static async reservationCancel(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const staahRes = await prisma.staah_reservations.findUnique({ where: { id } });
      if (!staahRes) { notFound(res, 'Reservation not found'); return; }

      await prisma.staah_reservations.update({
        where: { id },
        data: { status: '2', message: 'Cancelled', updated_at: new Date() },
      });

      success(res, null, 'Reservation cancelled');
    } catch (err: any) {
      error(res, 'Failed to cancel reservation', 500);
    }
  }

  static async reservationPending(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const staahRes = await prisma.staah_reservations.findUnique({ where: { id } });
      if (!staahRes) { notFound(res, 'Reservation not found'); return; }

      await prisma.staah_reservations.update({
        where: { id },
        data: { status: '3', message: 'Pending Review', updated_at: new Date() },
      });

      success(res, null, 'Reservation set to pending');
    } catch (err: any) {
      error(res, 'Failed to update reservation', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Sync Logs
  // ═══════════════════════════════════════════════

  static async syncLogList(req: Request, res: Response): Promise<void> {
    try {
      const interfaceId = req.params.hotel_id ? idParam(req.params.hotel_id) : null;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = {};
      if (interfaceId) where.staah_interface_id = interfaceId;

      const [data, total] = await Promise.all([
        prisma.staah_sync_logs.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_sync_logs.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list sync logs', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah OTA Company Mappings
  // ═══════════════════════════════════════════════

  static async otaMappingList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        prisma.staah_ota_company_mappings.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.staah_ota_company_mappings.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list OTA mappings', 500);
    }
  }

  static async otaMappingCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { channel_id, company_profile_id, staah_interface_id } = req.body;

      if (!channel_id || !company_profile_id) {
        badRequest(res, 'channel_id and company_profile_id are required');
        return;
      }

      const result = await prisma.staah_ota_company_mappings.create({
        data: {
          property_id: pid,
          channel_id: String(channel_id),
          company_profile_id: BigInt(company_profile_id),
          staah_interface_id: staah_interface_id ? BigInt(staah_interface_id) : null,
          status: true,
        },
      });

      success(res, bigintToNumber(result), 'OTA mapping created');
    } catch (err: any) {
      console.error('OTA mapping create error:', err);
      error(res, 'Failed to create OTA mapping', 500);
    }
  }

  static async otaMappingUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { company_profile_id, status } = req.body;

      const existing = await prisma.staah_ota_company_mappings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'OTA mapping not found'); return; }

      const data: any = { updated_at: new Date() };
      if (company_profile_id !== undefined) data.company_profile_id = BigInt(company_profile_id);
      if (status !== undefined) data.status = Boolean(status);

      const result = await prisma.staah_ota_company_mappings.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'OTA mapping updated');
    } catch (err: any) {
      error(res, 'Failed to update OTA mapping', 500);
    }
  }

  static async otaMappingDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.staah_ota_company_mappings.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'OTA mapping not found'); return; }
      await prisma.staah_ota_company_mappings.delete({ where: { id } });
      success(res, null, 'OTA mapping deleted');
    } catch (err: any) {
      error(res, 'Failed to delete OTA mapping', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Room Content Breakdowns
  // ═══════════════════════════════════════════════

  static async contentBreakdownList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.staah_room_content_breakdowns.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { room_types: { select: { id: true, name: true } } },
        }),
        prisma.staah_room_content_breakdowns.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list content breakdowns', 500);
    }
  }

  static async contentBreakdownCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { staah_interface_id, room_type_id, description, adult, child } = req.body;

      if (!staah_interface_id || !room_type_id || !description) {
        badRequest(res, 'staah_interface_id, room_type_id, and description are required');
        return;
      }

      const result = await prisma.staah_room_content_breakdowns.create({
        data: {
          property_id: pid,
          staah_interface_id: BigInt(staah_interface_id),
          room_type_id: BigInt(room_type_id),
          description,
          adult: adult || 0,
          child: child || 0,
        },
      });

      success(res, bigintToNumber(result), 'Content breakdown created');
    } catch (err: any) {
      error(res, 'Failed to create content breakdown', 500);
    }
  }

  static async contentBreakdownUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { description, adult, child, status } = req.body;

      const existing = await prisma.staah_room_content_breakdowns.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Content breakdown not found'); return; }

      const data: any = { updated_at: new Date() };
      if (description !== undefined) data.description = description;
      if (adult !== undefined) data.adult = adult;
      if (child !== undefined) data.child = child;
      if (status !== undefined) data.status = status;

      const result = await prisma.staah_room_content_breakdowns.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Content breakdown updated');
    } catch (err: any) {
      error(res, 'Failed to update content breakdown', 500);
    }
  }

  static async contentBreakdownDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.staah_room_content_breakdowns.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Content breakdown not found'); return; }
      await prisma.staah_room_content_breakdowns.update({
        where: { id },
        data: { deleted_at: new Date() },
      });
      success(res, null, 'Content breakdown deleted');
    } catch (err: any) {
      error(res, 'Failed to delete content breakdown', 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Push/Pull/Sync Actions
  // ═══════════════════════════════════════════════

  static async syncAvailability(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const result = await staahService.listingProperty();
      success(res, result, 'Availability synced');
    } catch (err: any) {
      error(res, 'Sync failed: ' + err.message, 500);
    }
  }

  static async pullFromStaah(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const rooms = await staahService.listingRoomType(interface_.hotel_id);
      const rates = await staahService.listingRatePlan(interface_.hotel_id);

      success(res, { rooms, rates }, 'Data pulled from STAAH');
    } catch (err: any) {
      error(res, 'Pull failed: ' + err.message, 500);
    }
  }

  static async pushRoom(req: Request, res: Response): Promise<void> {
    try {
      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id: idParam(req.params.id) } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const mappings = await prisma.staah_room_mappings.findMany({
        where: { staah_interface_id: interface_.id, deleted_at: null },
        include: { room_types: true },
      });

      for (const mapping of mappings) {
        await staahService.createUpdateDeleteRoomType({
          hotelid: interface_.hotel_id,
          roomid: mapping.staah_room_id,
          room_type: (mapping as any).room_types?.name || 'Room',
          max_occupancy: mapping.max_occupancy,
          quantity: mapping.quantity,
        });
      }

      success(res, { pushed: mappings.length }, 'Room types pushed');
    } catch (err: any) {
      error(res, 'Push failed: ' + err.message, 500);
    }
  }

  static async pushRate(req: Request, res: Response): Promise<void> {
    try {
      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id: idParam(req.params.id) } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const mappings = await prisma.staah_rate_mappings.findMany({
        where: { staah_interface_id: interface_.id, deleted_at: null },
      });

      for (const mapping of mappings) {
        await staahService.createUpdateDeleteRatePlan({
          hotelid: interface_.hotel_id,
          rateplanid: mapping.staah_rate_plan_id,
          mealplanid: mapping.meal_plan_id,
        });
      }

      success(res, { pushed: mappings.length }, 'Rate plans pushed');
    } catch (err: any) {
      error(res, 'Push failed: ' + err.message, 500);
    }
  }

  // ═══════════════════════════════════════════════
  // STAah Master Data (config constants)
  // ═══════════════════════════════════════════════

  static async master(req: Request, res: Response): Promise<void> {
    const result = {
      meal_plans: [
        { value: 1, label: 'All inclusive' },
        { value: 2, label: 'Breakfast' },
        { value: 11, label: 'European plan' },
        { value: 15, label: 'Room only (Default)' },
      ],
      hotel_types: [
        { value: 1, label: 'Hotel' },
        { value: 2, label: 'Motel' },
        { value: 3, label: 'Vacational Rental' },
      ],
      languages: [
        { value: 'en', label: 'English' },
        { value: 'id', label: 'Bahasa Indonesia' },
      ],
      currencies: [
        { value: 'IDR', label: 'IDR' },
        { value: 'USD', label: 'USD' },
        { value: 'GBP', label: 'GBP' },
      ],
      time_zones: [
        { value: 'Asia/Jakarta', label: 'Asia/Jakarta (GMT+7)' },
        { value: 'Asia/Singapore', label: 'Asia/Singapore (GMT+8)' },
        { value: 'Europe/London', label: 'Europe/London' },
      ],
      status_reservations: [
        { value: '1', label: 'Confirmed' },
        { value: '2', label: 'Cancelled' },
        { value: '3', label: 'Pending' },
      ],
    };

    success(res, [], 'Success', 200, { master: result } as any);
  }

  // ═══════════════════════════════════════════════
  // ARI Push (Availability, Rate, Inventory)
  // ═══════════════════════════════════════════════

  static async ariPush(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { date_from, date_to } = req.body;

      const interface_ = await prisma.staah_interfaces.findUnique({ where: { id } });
      if (!interface_) { notFound(res, 'Interface not found'); return; }

      const roomMappings = await prisma.staah_room_mappings.findMany({
        where: { staah_interface_id: interface_.id, deleted_at: null, status: 'active' },
      });

      const rateMappings = await prisma.staah_rate_mappings.findMany({
        where: { staah_interface_id: interface_.id, deleted_at: null, status: 'active' },
      });

      const payload: any[] = [];
      for (const rm of roomMappings) {
        for (const rtm of rateMappings) {
          payload.push({
            hotelid: interface_.hotel_id,
            roomid: rm.staah_room_id,
            rateplanid: rtm.staah_rate_plan_id,
            date_from: date_from,
            date_to: date_to,
            roomstosell: rm.quantity,
        });
        }
      }

      if (payload.length === 0) {
        success(res, [], 'No data to push');
        return;
      }

      const result = await staahService.storeRates({ availability: payload });
      success(res, result, 'ARI pushed successfully');
    } catch (err: any) {
      error(res, 'ARI push failed: ' + err.message, 500);
    }
  }
}
