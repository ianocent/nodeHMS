const fs = require('fs');
const path = 'C:/Users/uzuma/Documents/hms-anyaman/backend-node/src/controllers/reservation.controller.ts';
let content = fs.readFileSync(path, 'utf8');

// Replace unassignRoom
content = content.replace(
  /static async unassignRoom\(req: Request, res: Response\): Promise<void> \{([\s\S]*?)\} catch \(err: any\) \{/m,
`static async unassignRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const reservation = await prisma.reservations.findUnique({ where: { id } });
      if (!reservation || reservation.deleted_at) {
        notFound(res, 'Reservation Not Found');
        return;
      }

      const folio = await prisma.folios.findUnique({ where: { id: reservation.folio_id } });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Folio Not Found');
        return;
      }

      await prisma.reservations.updateMany({
        where: {
          folio_id: folio.id,
          deleted_at: null,
          date: { gte: reservation.date },
          room_type_id: reservation.room_type_id,
          status: 0
        },
        data: { room_id: null, updated_at: new Date(), updated_by: userId },
      });

      const updatedFolio = await prisma.folios.findUnique({
        where: { id: folio.id },
        include: { reservations: { where: { deleted_at: null } } },
      });

      success(res, bigintToNumber(updatedFolio), 'Success');
    } catch (err: any) {`
);

// Replace assignRoom
content = content.replace(
  /static async assignRoom\(req: Request, res: Response\): Promise<void> \{([\s\S]*?)\} catch \(err: any\) \{/m,
`static async assignRoom(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;
      const { room_id, room_type_id } = req.body;

      const reservation = await prisma.reservations.findUnique({ where: { id } });
      if (!reservation || reservation.deleted_at) {
        notFound(res, 'Reservation not found');
        return;
      }

      if (room_type_id && Number(room_type_id) !== Number(reservation.room_type_id)) {
        badRequest(res, 'Cannot change room type');
        return;
      }

      const folio = await prisma.folios.findUnique({ where: { id: reservation.folio_id } });
      if (!folio || folio.deleted_at) {
        notFound(res, 'Folio Not Found');
        return;
      }

      if (room_id) {
        const targetRoomId = BigInt(room_id);
        const ci = fmtDateOnly(folio.check_in_date);
        const co = fmtDateOnly(folio.check_out_date);
        if (!ci || !co) {
          badRequest(res, 'Reservation dates are required before assigning a room');
          return;
        }
        
        const room = await prisma.rooms.findUnique({ where: { id: targetRoomId }, select: { room_type_id: true } });
        if (!room) { badRequest(res, 'Room not found'); return; }
        if (Number(room.room_type_id) !== Number(reservation.room_type_id)) {
          badRequest(res, 'Room does not belong to the selected room type');
          return;
        }
        
        const propertyId = folio.property_id ?? req.user?.lastProperty;
        const availableIds = propertyId
          ? await onlyAvailableRoomIds(propertyId, ci, co, folio.id)
          : new Set<number>();
        if (!availableIds.has(Number(targetRoomId))) {
          badRequest(res, 'Room is not available for the selected dates');
          return;
        }
      }

      const preRoomIds = await prisma.reservations.findMany({
        where: { folio_id: folio.id, deleted_at: null },
        select: { room_id: true },
        orderBy: { date: 'asc' },
      });

      const updateData: any = {
        updated_at: new Date(),
        updated_by: userId,
      };
      if (room_id) updateData.room_id = BigInt(room_id);
      if (room_type_id) updateData.room_type_id = BigInt(room_type_id);

      await prisma.$transaction(
        async (tx) => {
          if (reservation.room_id && folio.status_reservation === 3) { // 3 is STATUS_RESERVATION.check_in.id
            await tx.rooms.update({
              where: { id: reservation.room_id },
              data: { room_status: 1, maid_status: 3 } // vacant, dirty
            });
          }

          await tx.reservations.updateMany({
            where: { 
              folio_id: folio.id, 
              deleted_at: null,
              date: { gte: reservation.date },
              room_type_id: reservation.room_type_id,
              status: 0
            },
            data: updateData,
          });
        },
        { timeout: 20000 }
      );

      const updatedFolio = await prisma.folios.findUnique({
        where: { id: folio.id },
        include: { reservations: { where: { deleted_at: null } } },
      });

      enqueueJob('sync-staah-room-availability', {
        propertyId: Number((updatedFolio as any)?.property_id ?? 0),
        dateFrom: (updatedFolio as any)?.check_in_date ? formatDate(new Date((updatedFolio as any).check_in_date)) : undefined,
        dateTo: (updatedFolio as any)?.check_out_date ? formatDate(new Date((updatedFolio as any).check_out_date)) : undefined,
      });
      await writeAudit(prisma, req, {
        table: 'folios',
        event: 'updated',
        subjectId: folio.id,
        name: 'folio-room-assigned',
        description: \`Room \${room_id ?? 'none'} assigned to folio \${folio.folio_number ?? folio.id}\`,
        logName: 'front_desk',
        old: { room_id: preRoomIds[0]?.room_id != null ? String(preRoomIds[0].room_id) : null },
        attributes: { room_id: room_id ? String(room_id) : null, room_type_id: room_type_id ? String(room_type_id) : null },
        meta: { folio_number: folio.folio_number, availability_checked: !!room_id },
      });

      success(res, bigintToNumber(updatedFolio), 'Success');
    } catch (err: any) {`
);

fs.writeFileSync(path, content, 'utf8');
console.log('done');
