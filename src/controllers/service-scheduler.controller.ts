import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success } from '../utils/response';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

function parseTransactionActions(user: any, menuId: number): Record<string, boolean> {
  try {
    const crud = user?.permissions?.get(BigInt(menuId));
    if (!crud?.transactionActions) return {};
    return JSON.parse(crud.transactionActions);
  } catch {
    return {};
  }
}

function paginate(total: number, limit: number, page: number) {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return {
    current_page: page,
    last_page: lastPage,
    per_page: limit,
    total,
    from: total === 0 ? 0 : (page - 1) * limit + 1,
    to: Math.min(page * limit, total),
  };
}

/**
 * Parity of Laravel ServiceSchedulerController (backend/app/Http/Controllers/Cms/Hotel/ServiceSchedulerController.php).
 */
export class ServiceSchedulerController {

  static async index(req: Request, res: Response): Promise<void> {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 1000;
    const now = new Date();
    const dateFrom = new Date((req.query.date_from as string) || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
    const dateTo = new Date((req.query.date_to as string) || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));

    const user = req.user as any;
    const pid = user?.lastProperty ?? user?.last_property ?? BigInt(0);

    const actions = parseTransactionActions(user, 172);
    const canClean = !!actions['perform_cleaning'];
    const canInspect = !!actions['perform_inspection'];

    const where: any = {
      date: { gte: dateFrom, lte: dateTo },
      property_id: pid,
      shift_id: { not: null },
    };
    if (canClean && !canInspect) {
      where.user_id = user.id;
    }

    const totalData = await prisma.rosters.count({ where });
    const rows = await prisma.rosters.findMany({
      where,
      orderBy: [{ date: 'asc' }, { shift_id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    });

    const shiftIds = [...new Set(rows.map((r: any) => r.shift_id).filter((v: any) => v !== null && v !== undefined))];
    const shifts = shiftIds.length
      ? await prisma.shift_roster.findMany({ where: { id: { in: shiftIds } } })
      : [];

    const userIds = [...new Set(rows.map((r: any) => r.user_id))];
    const users = userIds.length
      ? await prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const userMap = new Map(users.map((u: any) => [u.id, u]));

    // housekeeper_history_user rows for these users on these dates (property scoped)
    const hku = await prisma.housekeeper_history_user.findMany({
      where: {
        user_id: { in: userIds },
        property_id: pid,
        deleted_at: null,
      },
      select: { user_id: true, housekeeper_history_id: true },
    });
    const hids = [...new Set(hku.map((h: any) => h.housekeeper_history_id))];
    const hist = hids.length
      ? await prisma.housekeeper_history.findMany({
          where: { id: { in: hids }, deleted_at: null },
          select: { id: true, date: true, room_id: true },
        })
      : [];
    const roomIds = [...new Set(hist.map((h: any) => h.room_id).filter((v: any) => v !== null && v !== undefined))];
    const rooms = roomIds.length
      ? await prisma.rooms.findMany({
          where: { id: { in: roomIds } },
          select: { id: true, room_type_id: true },
        })
      : [];
    const roomTypeIds = [...new Set(rooms.map((r: any) => r.room_type_id).filter((v: any) => v !== null && v !== undefined))];
    const floorTypes = roomTypeIds.length
      ? await prisma.types.findMany({
          where: { id: { in: roomTypeIds }, group: 'floor' },
          select: { id: true, name: true },
        })
      : [];
    const floorNameById = new Map(floorTypes.map((t: any) => [t.id, t.name]));
    const roomTypeIdByRoom = new Map(rooms.map((r: any) => [r.id, r.room_type_id]));
    const histById = new Map(hist.map((h: any) => [h.id, h]));

    const mapped = rows.map((roster: any) => {
      const assignedUsers: any[] = [];
      const rosterUser = userMap.get(roster.user_id);
      if (rosterUser) {
        const myHist = hku
          .filter((h: any) => h.user_id === roster.user_id)
          .map((h: any) => histById.get(h.housekeeper_history_id))
          .filter(Boolean)
          .filter((h: any) => h.date && h.date.toISOString().slice(0, 10) === roster.date.toISOString().slice(0, 10));
        const totalRooms = myHist.length;
        const floors = [...new Set(
          myHist
            .map((h: any) => floorNameById.get(roomTypeIdByRoom.get(h.room_id)))
            .filter(Boolean)
        )];
        assignedUsers.push({
          id: Number(rosterUser.id),
          name: String(rosterUser.name || '').toUpperCase(),
          total_rooms: totalRooms,
          floors,
        });
      }

      const shift = roster.shift_id !== null && roster.shift_id !== undefined
        ? shifts.find((s: any) => s.id === BigInt(roster.shift_id))
        : undefined;

return {
        id: Number(roster.id),
        date: roster.date ? roster.date.toISOString().slice(0, 10) : null,
        shift_id: roster.shift_id,
        roster_list_id: roster.roster_list_id,
        user_id: Number(roster.user_id),
        is_assigned: roster.is_assigned,
        assigned_users: assignedUsers,
        shift: shift
          ? {
              id: Number(shift.id),
              name: String(shift.name || '').toUpperCase(),
              time_start: shift.time_start ? shift.time_start.toISOString().slice(11, 19) : null,
              time_end: shift.time_end ? shift.time_end.toISOString().slice(11, 19) : null,
              description: shift.description,
            }
          : null,
      };
    });

    success(res, bigintToNumber(mapped), 'Success', 200, {
      pagination: paginate(totalData, limit, page),
    });
  }

  static async shifts(req: Request, res: Response): Promise<void> {
    const user = req.user as any;
    const pid = user?.lastProperty ?? user?.last_property ?? BigInt(0);
    const data = await prisma.shift_roster.findMany({
      where: { property_id: pid, deleted_at: null },
      orderBy: { time_start: 'asc' },
    });
    success(res, bigintToNumber(data), 'Success', 200, {
      pagination: paginate(data.length, data.length, 1),
    });
  }

  static async housekeepers(req: Request, res: Response): Promise<void> {
    const user = req.user as any;
    const pid = user?.lastProperty ?? user?.last_property ?? BigInt(0);

    // roles whose role_menu_crud.transaction_actions contains perform_cleaning=true
    const cruds = await prisma.role_menu_crud.findMany({
      where: { transaction_actions: { contains: 'perform_cleaning' } },
      select: { role_id: true },
    });
    const roleIds = [...new Set(cruds.map((c: any) => c.role_id))];

    const memberships = roleIds.length
      ? await prisma.model_has_roles.findMany({
          where: { role_id: { in: roleIds }, model_type: { contains: 'User' } },
          select: { model_id: true },
        })
      : [];
    const userIds = [...new Set(memberships.map((m: any) => m.model_id))];

    const users = await prisma.users.findMany({
      where: {
        id: { in: userIds, not: user.id },
        property_id: pid,
        deleted_at: null,
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    success(res, bigintToNumber(users), 'Success', 200);
  }
}

