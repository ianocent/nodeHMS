const fs = require('fs');
const p = 'c:/Users/uzuma/Documents/hms-anyaman/backend-node/src/controllers/concierge.controller.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/static async lostFoundStore[\s\S]*?static async lostFoundUpdate/m, `static async lostFoundStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { ref_no, report_date, item, room, room_founder, owner_item, item_status, hotel_location, description, instruction, status, status_lost, photo_1, photo_2, photo_3, photo_4, photo_5 } = req.body;
      if (!item) { badRequest(res, 'item is required'); return; }

      const data = await prisma.lost_and_founds.create({
        data: { property_id: pid, ref_no, report_date: report_date ? new Date(report_date) : null, item, room: room ? parseInt(room) : null, room_founder: room_founder ? parseInt(room_founder) : null, owner_item, item_status, hotel_location, item_description: description, instruction, status: status !== undefined ? statusFlag(status) : 1, status_lost, created_at: new Date(), created_by: req.user?.id },
      });

      const updatePhotos: any = {};
      if (photo_1) updatePhotos.photo_1 = saveLostFoundImage(data.id, photo_1, 'photo_1');
      if (photo_2) updatePhotos.photo_2 = saveLostFoundImage(data.id, photo_2, 'photo_2');
      if (photo_3) updatePhotos.photo_3 = saveLostFoundImage(data.id, photo_3, 'photo_3');
      if (photo_4) updatePhotos.photo_4 = saveLostFoundImage(data.id, photo_4, 'photo_4');
      if (photo_5) updatePhotos.photo_5 = saveLostFoundImage(data.id, photo_5, 'photo_5');
      if (Object.keys(updatePhotos).length > 0) {
        await prisma.lost_and_founds.update({ where: { id: data.id }, data: updatePhotos });
      }

      success(res, bigintToNumber(data), 'Lost & found created', 200);
    } catch (err: any) { console.error('Lost & found store error:', err); error(res, 'Failed to create lost & found', 500); }
  }

  static async lostFoundUpdate`);

c = c.replace(/static async lostFoundUpdate[\s\S]*?static async lostFoundDestroy/m, `static async lostFoundUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      const { ref_no, report_date, item, room, room_founder, owner_item, item_status, hotel_location, description, instruction, status, status_lost, photo_1, photo_2, photo_3, photo_4, photo_5 } = req.body;
      const updateData: any = { report_date: report_date ? new Date(report_date) : undefined, item, room: room ? parseInt(room) : null, room_founder: room_founder ? parseInt(room_founder) : null, owner_item, item_status, hotel_location, item_description: description, instruction, status_lost, updated_at: new Date(), updated_by: req.user?.id };
      if (status !== undefined) updateData.status = statusFlag(status);
      if (ref_no !== undefined) updateData.ref_no = ref_no;
      
      if (photo_1 !== undefined) updateData.photo_1 = saveLostFoundImage(id, photo_1, 'photo_1');
      if (photo_2 !== undefined) updateData.photo_2 = saveLostFoundImage(id, photo_2, 'photo_2');
      if (photo_3 !== undefined) updateData.photo_3 = saveLostFoundImage(id, photo_3, 'photo_3');
      if (photo_4 !== undefined) updateData.photo_4 = saveLostFoundImage(id, photo_4, 'photo_4');
      if (photo_5 !== undefined) updateData.photo_5 = saveLostFoundImage(id, photo_5, 'photo_5');

      await prisma.lost_and_founds.update({ where: { id }, data: updateData });
      success(res, null, 'Lost & found updated');
    } catch (err: any) { error(res, 'Failed to update lost & found', 500); }
  }

  static async lostFoundDestroy`);

fs.writeFileSync(p, c);
