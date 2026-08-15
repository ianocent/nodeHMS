import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

// ═══════════════════════════════════════════════════
// Channel Manager Interfaces (Legacy)
// ═══════════════════════════════════════════════════

export class ChannelManagerController {
  static async interfaceList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { property_id: Number(pid), deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.channel_manager_interfaces.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.channel_manager_interfaces.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list channel manager interfaces', 500);
    }
  }

  static async interfaceShow(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const result = await prisma.channel_manager_interfaces.findUnique({ where: { id } });
      if (!result) { notFound(res, 'Channel manager interface not found'); return; }
      success(res, bigintToNumber(result), 'Success');
    } catch (err: any) {
      error(res, 'Failed to load interface', 500);
    }
  }

  static async interfaceCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { hotel_type, hotel_name, time_zone, language_code, currency_code, hotel_info, hotel_description, status } = req.body;

      if (!hotel_name) { badRequest(res, 'hotel_name is required'); return; }

      const result = await prisma.channel_manager_interfaces.create({
        data: {
          property_id: Number(pid),
          hotel_type: hotel_type || 'Hotel',
          hotel_name,
          time_zone: time_zone || 'Asia/Jakarta',
          language_code: language_code || 'en',
          currency_code: currency_code || 'IDR',
          hotel_info,
          hotel_description,
          status: status ?? 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Interface created');
    } catch (err: any) {
      error(res, 'Failed to create interface', 500);
    }
  }

  static async interfaceUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { hotel_type, hotel_name, time_zone, language_code, currency_code, hotel_info, hotel_description, status } = req.body;

      const existing = await prisma.channel_manager_interfaces.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Interface not found'); return; }

      const data: any = { updated_at: new Date() };
      if (hotel_type !== undefined) data.hotel_type = hotel_type;
      if (hotel_name !== undefined) data.hotel_name = hotel_name;
      if (time_zone !== undefined) data.time_zone = time_zone;
      if (language_code !== undefined) data.language_code = language_code;
      if (currency_code !== undefined) data.currency_code = currency_code;
      if (hotel_info !== undefined) data.hotel_info = hotel_info;
      if (hotel_description !== undefined) data.hotel_description = hotel_description;
      if (status !== undefined) data.status = status;

      const result = await prisma.channel_manager_interfaces.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Interface updated');
    } catch (err: any) {
      error(res, 'Failed to update interface', 500);
    }
  }

  static async interfaceDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const existing = await prisma.channel_manager_interfaces.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Interface not found'); return; }
      await prisma.channel_manager_interfaces.update({
        where: { id },
        data: { deleted_at: new Date(), status: 0 },
      });
      success(res, null, 'Interface deleted');
    } catch (err: any) {
      error(res, 'Failed to delete interface', 500);
    }
  }

  // ═══════════════════════════════════════════════════
  // Channel Manager Rate Plans
  // ═══════════════════════════════════════════════════

  static async ratePlanList(req: Request, res: Response): Promise<void> {
    try {
      const cmId = req.query.channel_manager_interface_id ? Number(req.query.channel_manager_interface_id as string) : null;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null };
      if (cmId) where.channel_manager_interface_id = cmId;

      const [data, total] = await Promise.all([
        prisma.channel_manager_rate_plans.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { rates: { select: { id: true, name: true } } },
        }),
        prisma.channel_manager_rate_plans.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list rate plans', 500);
    }
  }

  static async ratePlanCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { channel_manager_interface_id, rate_id, meal_plan_id, status } = req.body;

      if (!channel_manager_interface_id || !rate_id) {
        badRequest(res, 'channel_manager_interface_id and rate_id are required');
        return;
      }

      const result = await prisma.channel_manager_rate_plans.create({
        data: {
          property_id: pid,
          channel_manager_interface_id: BigInt(channel_manager_interface_id),
          rate_id: BigInt(rate_id),
          meal_plan_id: meal_plan_id ?? 15,
          status: status ?? 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Rate plan created');
    } catch (err: any) {
      error(res, 'Failed to create rate plan', 500);
    }
  }

  static async ratePlanUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      const { rate_id, meal_plan_id, status } = req.body;

      const existing = await prisma.channel_manager_rate_plans.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Rate plan not found'); return; }

      const data: any = { updated_at: new Date() };
      if (rate_id !== undefined) data.rate_id = BigInt(rate_id);
      if (meal_plan_id !== undefined) data.meal_plan_id = meal_plan_id;
      if (status !== undefined) data.status = status;

      const result = await prisma.channel_manager_rate_plans.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Rate plan updated');
    } catch (err: any) {
      error(res, 'Failed to update rate plan', 500);
    }
  }

  static async ratePlanDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      const existing = await prisma.channel_manager_rate_plans.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Rate plan not found'); return; }
      await prisma.channel_manager_rate_plans.update({
        where: { id },
        data: { deleted_at: new Date(), status: 0 },
      });
      success(res, null, 'Rate plan deleted');
    } catch (err: any) {
      error(res, 'Failed to delete rate plan', 500);
    }
  }

  // ═══════════════════════════════════════════════════
  // Channel Manager Room Types
  // ═══════════════════════════════════════════════════

  static async roomTypeList(req: Request, res: Response): Promise<void> {
    try {
      const cmId = req.query.channel_manager_interface_id ? idParam(req.query.channel_manager_interface_id as string) : null;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null };
      if (cmId) where.channel_manager_interface_id = cmId;

      const [data, total] = await Promise.all([
        prisma.channel_manager_room_types.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            room_types_channel_manager_room_types_room_type_idToroom_types: {
              select: { id: true, name: true },
            },
          },
        }),
        prisma.channel_manager_room_types.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      error(res, 'Failed to list room types', 500);
    }
  }

  static async roomTypeCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { channel_manager_interface_id, room_type_id, max_occupancy, max_child_occupancy, quantity, description, status } = req.body;

      if (!channel_manager_interface_id || !room_type_id) {
        badRequest(res, 'channel_manager_interface_id and room_type_id are required');
        return;
      }

      const result = await prisma.channel_manager_room_types.create({
        data: {
          property_id: Number(pid),
          channel_manager_interface_id: BigInt(channel_manager_interface_id),
          room_type_id: BigInt(room_type_id),
          room_type: BigInt(room_type_id),
          max_occupancy: max_occupancy ?? 2,
          max_child_occupancy: max_child_occupancy ?? 0,
          quantity: quantity ?? 1,
          size_measurement: 0,
          size_measurement_unit: 'sqm',
          description: description || null,
          status: status ?? 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      success(res, bigintToNumber(result), 'Room type created');
    } catch (err: any) {
      console.error('CM room type create error:', err);
      error(res, 'Failed to create room type', 500);
    }
  }

  static async roomTypeUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      const { room_type_id, max_occupancy, max_child_occupancy, quantity, description, status } = req.body;

      const existing = await prisma.channel_manager_room_types.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Room type not found'); return; }

      const data: any = { updated_at: new Date() };
      if (room_type_id !== undefined) {
        data.room_type_id = BigInt(room_type_id);
        data.room_type = BigInt(room_type_id);
      }
      if (max_occupancy !== undefined) data.max_occupancy = max_occupancy;
      if (max_child_occupancy !== undefined) data.max_child_occupancy = max_child_occupancy;
      if (quantity !== undefined) data.quantity = quantity;
      if (description !== undefined) data.description = description;
      if (status !== undefined) data.status = status;

      const result = await prisma.channel_manager_room_types.update({ where: { id }, data });
      success(res, bigintToNumber(result), 'Room type updated');
    } catch (err: any) {
      error(res, 'Failed to update room type', 500);
    }
  }

  static async roomTypeDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = Number(req.params.id);
      const existing = await prisma.channel_manager_room_types.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Room type not found'); return; }
      await prisma.channel_manager_room_types.update({
        where: { id },
        data: { deleted_at: new Date(), status: 0 },
      });
      success(res, null, 'Room type deleted');
    } catch (err: any) {
      error(res, 'Failed to delete room type', 500);
    }
  }

  // ═══════════════════════════════════════════════════
  // Channel Manager Master Data
  // ═══════════════════════════════════════════════════

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
      ],
      time_zones: [
        { value: 'Asia/Jakarta', label: 'Asia/Jakarta (GMT+7)' },
        { value: 'Asia/Singapore', label: 'Asia/Singapore (GMT+8)' },
      ],
    };

    success(res, [], 'Success', 200, { master: result } as any);
  }
}
