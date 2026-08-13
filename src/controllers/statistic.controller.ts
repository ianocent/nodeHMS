import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error } from '../utils/response';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

export class StatisticController {

  static async dashboard(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      const [totalRooms, availableRooms, checkIns, checkOuts, occupancy, inHouse] = await Promise.all([
        prisma.rooms.count({ where: { property_id: pid, deleted_at: null } }),
        prisma.rooms.count({ where: { property_id: pid, deleted_at: null, status: 0 } }),
        prisma.folios.count({ where: { property_id: pid, status_reservation: 2, check_in_date: { gte: today, lt: tomorrow }, deleted_at: null } }),
        prisma.folios.count({ where: { property_id: pid, status_reservation: 3, check_out_date: { gte: today, lt: tomorrow }, deleted_at: null } }),
        prisma.folios.count({ where: { property_id: pid, status_reservation: 2, deleted_at: null } }),
        prisma.folios.count({ where: { property_id: pid, status_reservation: { in: [1, 2] }, deleted_at: null } }),
      ]);

      const occupancyRate = totalRooms > 0 ? ((occupancy / totalRooms) * 100).toFixed(1) : '0.0';

      success(res, {
        total_rooms: totalRooms,
        available_rooms: availableRooms,
        check_ins: checkIns,
        check_outs: checkOuts,
        in_house: occupancy,
        occupancy_rate: `${occupancyRate}%`,
      }, 'Success');
    } catch (err: any) { console.error('Dashboard error:', err); error(res, 'Failed to load dashboard', 500); }
  }

  static async roomAvailability(req: Request, res: Response): Promise<void> {
    try {
      const pid = Number(req.user?.lastProperty ?? 0);
      const date = req.query.date as string;

      const where: any = { property_id: pid };
      if (date) {
        const d = new Date(date); d.setHours(0, 0, 0, 0);
        const nd = new Date(d); nd.setDate(nd.getDate() + 1);
        where.date = { gte: d, lt: nd };
      }

      const data = await prisma.room_availabilities.findMany({ where, orderBy: { date: 'desc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { console.error('Room availability error:', err); error(res, 'Failed to load room availability', 500); }
  }

  static async byRoomType(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const date = req.query.date as string || new Date().toISOString().split('T')[0];
      const d = new Date(date); d.setHours(0, 0, 0, 0);

      const roomTypes = await prisma.room_types.findMany({ where: { property_id: pid, deleted_at: null } });
      const stats = await Promise.all(roomTypes.map(async (rt: any) => {
        const totalRooms = await prisma.rooms.count({ where: { room_type_id: rt.id, deleted_at: null } });
        const occupied = await prisma.folios.count({
          where: {
            property_id: pid,
            status_reservation: { in: [1, 2] },
            check_in_date: { lte: d },
            check_out_date: { gte: d },
            deleted_at: null,
            reservations: { some: { room_type_id: rt.id, deleted_at: null } },
          },
        });
        return { room_type_id: Number(rt.id), room_type: rt.name, total: totalRooms, occupied, available: totalRooms - occupied };
      }));

      success(res, stats, 'Success');
    } catch (err: any) { console.error('Statistic by room type error:', err); error(res, 'Failed to load statistic', 500); }
  }

  static async messages(req: Request, res: Response): Promise<void> {
    try {
      const data = await prisma.statistic_messages.findMany({ orderBy: { id: 'desc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load statistic messages', 500); }
  }

  static async rateCodes(req: Request, res: Response): Promise<void> {
    try {
      const data = await prisma.statistic_rate_codes.findMany({ orderBy: { id: 'desc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load statistic rate codes', 500); }
  }
}
