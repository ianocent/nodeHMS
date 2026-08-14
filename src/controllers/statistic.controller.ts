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

  static async roomStatisticGrid(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
      const nd = new Date(d); nd.setDate(nd.getDate() + 1);

      const where: any = { property_id: pid, deleted_at: null };
      const [rooms, total] = await Promise.all([
        prisma.rooms.findMany({ where, orderBy: { sort: 'asc' }, include: { room_types: { select: { name: true } } } }),
        prisma.rooms.count({ where }),
      ]);

      const modelTypes = await prisma.model_has_types.findMany({
        where: { model_id: { in: rooms.map((r: any) => r.id) }, model_type: 'App\\Models\\Room' },
        include: { types: { select: { id: true, name: true, group: true } } },
      });
      const typeMap = new Map<bigint, any[]>();
      for (const mt of modelTypes) {
        if (!typeMap.has(mt.model_id)) typeMap.set(mt.model_id, []);
        typeMap.get(mt.model_id)!.push(mt.types);
      }

      const folios = await prisma.folios.findMany({
        where: {
          property_id: pid,
          status_reservation: { notIn: [4, 5] },
          check_in_date: { lt: nd },
          check_out_date: { gte: d },
          deleted_at: null,
        },
        select: { id: true, folio_number: true, status_reservation: true, check_in_date: true, check_out_date: true, reservations: { select: { room_id: true } } },
      });
      const folioMap = new Map<bigint, any>();
      for (const f of folios) {
        const roomId = (f as any).reservations?.[0]?.room_id;
        if (roomId && !folioMap.has(roomId)) folioMap.set(roomId, f);
      }

      const data = rooms.map((r: any) => {
        const types = typeMap.get(r.id) || [];
        const building = types.find((t: any) => t.group === 'building');
        const floor = types.find((t: any) => t.group === 'floor');
        const folio = folioMap.get(r.id);
        return {
          id: Number(r.id),
          name: r.name,
          room_type_name: r.room_types?.name || null,
          building: building ? { value: Number(building.id), label: building.name } : [],
          floor: floor ? { value: Number(floor.id), label: floor.name } : [],
          building_name: building?.name || '',
          floor_name: floor?.name || '',
          room_status: { value: r.room_status, label: '', colorCode: '' },
          maid_status: { value: r.maid_status, label: '' },
          max_pax: r.max_pax,
          total_bed: r.total_bed,
          folio: folio ? {
            folio_id: Number(folio.id),
            folio_number: folio.folio_number,
            folio_status: String(folio.status_reservation),
            folio_status_color_code: null,
            check_in_date: folio.check_in_date,
            check_out_date: folio.check_out_date,
            url: null,
          } : null,
        };
      });

      const building = [...new Set(data.map((x: any) => x.building_name))].filter(Boolean).map((bname: any) => ({
        value: bname, label: bname,
        floors: [...new Set(data.filter((x: any) => x.building_name === bname).map((x: any) => x.floor_name))].map((fname: any) => ({
          value: fname, label: fname, layout: '', code_image: '',
          rooms: data.filter((x: any) => x.building_name === bname && x.floor_name === fname),
        })),
      }));

      const meta: any = {
        building,
        data,
        table: [
          { label: 'Room Name', key: 'name', type: 'none', is_search: true },
          { label: 'Room Type', key: 'room_type_name', type: 'none', is_search: false },
          { label: 'Building', key: 'building_name', type: 'none', is_search: false },
          { label: 'Floor', key: 'floor_name', type: 'none', is_search: false },
          { label: 'Status', key: 'room_status', type: 'badge', is_search: false },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      };
      success(res, null, 'Success', 200, meta);
    } catch (err: any) { console.error('Room statistic grid error:', err); error(res, 'Failed to load room statistic', 500); }
  }
}
