// Shared room availability engine — Laravel Room::AvailableRoom parity.
// A room is UNAVAILABLE for the given night when any of:
//  - it has a room_availabilities hold overlapping the date
//  - it has an active work order covering the date
//  - another folio's reservation (check_in / reservation status) occupies it
//  - it is out_of_order(4) or blocked(3)
import { PrismaClient } from '@prisma/client';
import { ROOM_STATUSES } from './cmsStatus';

// Unsellable room states. Only checking out_of_order let a room the grid shows
// as Blocked be assigned to a guest through any path that used this helper.
const UNSELLABLE_ROOM_STATUSES: number[] = [
  ROOM_STATUSES.out_of_order.id,
  ROOM_STATUSES.block.id,
];

export async function availableRoom(
  prisma: PrismaClient,
  roomId: bigint,
  dateStart: Date,
  dateEnd?: Date,
  excludeFolioId?: bigint,
): Promise<boolean> {
  const end = dateEnd ?? new Date(dateStart.getTime() + 86400000);
  const room = await prisma.rooms.findUnique({ where: { id: roomId }, select: { deleted_at: true, room_status: true } });
  if (!room || room.deleted_at || UNSELLABLE_ROOM_STATUSES.includes(room.room_status)) return false;

  const [holds, workOrders, overlapping] = await Promise.all([
    prisma.room_availabilities.count({
      where: { deleted_at: null, room_id: Number(roomId), date: { gte: dateStart, lt: end } },
    }),
    prisma.work_orders.count({
      where: {
        deleted_at: null, status: 1, room_id: roomId,
        OR: [{ end_date: null }, { end_date: { gt: dateStart } }],
        start_date: { lte: end },
      },
    }),
    prisma.reservations.count({
      where: {
        date: { gte: dateStart, lt: end },
        deleted_at: null,
        ...(excludeFolioId ? { folio_id: { not: excludeFolioId } } : {}),
        folios: { is: { status_reservation: { in: [0, 3] }, deleted_at: null } },
        OR: [{ room_id: roomId }, { room_id_next: roomId }],
      },
    }),
  ]);
  return holds === 0 && workOrders === 0 && overlapping === 0;
}
