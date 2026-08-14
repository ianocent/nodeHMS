import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { success, error, notFound } from '../utils/response';
import { encrypt } from '../utils/encryption';
import { GenericController } from '../controllers/generic.controller';

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

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const router = Router();
const prisma = new PrismaClient({ adapter });
const generic = new GenericController();

// ─── Phase 4.10 - Remaining module aliases (auth-only, kebab URLs) ───
// Stop Sell Booking (StopSellController parity)
router.get('/stop-sell-booking', authMiddleware, (req, res) => { req.params.model = 'stop_sells'; generic.list(req, res); });
router.get('/stop-sell-booking/create', authMiddleware, (req, res) => { req.params.model = 'stop_sells'; generic.createForm(req, res); });
router.post('/stop-sell-booking', authMiddleware, (req, res) => { req.params.model = 'stop_sells'; generic.create(req, res); });
router.get('/stop-sell-booking/:id/update', authMiddleware, (req, res) => { req.params.model = 'stop_sells'; generic.editForm(req, res); });
router.put('/stop-sell-booking/:id', authMiddleware, (req, res) => { req.params.model = 'stop_sells'; generic.update(req, res); });
router.delete('/stop-sell-booking/:id', authMiddleware, (req, res) => { req.params.model = 'stop_sells'; generic.destroy(req, res); });
router.delete('/stop-sell-booking', authMiddleware, (req, res) => { req.params.model = 'stop_sells'; req.params.id = String((req.body && req.body.id) ?? ''); generic.destroy(req, res); });

// Channel Manager Interface
router.get('/channel-manager-interface', authMiddleware, (req, res) => { req.params.model = 'channel_manager_interfaces'; generic.list(req, res); });
router.get('/channel-manager-interface/create', authMiddleware, (req, res) => { req.params.model = 'channel_manager_interfaces'; generic.createForm(req, res); });
router.post('/channel-manager-interface', authMiddleware, (req, res) => { req.params.model = 'channel_manager_interfaces'; generic.create(req, res); });
router.get('/channel-manager-interface/:id/update', authMiddleware, (req, res) => { req.params.model = 'channel_manager_interfaces'; generic.editForm(req, res); });
router.put('/channel-manager-interface/:id', authMiddleware, (req, res) => { req.params.model = 'channel_manager_interfaces'; generic.update(req, res); });
router.delete('/channel-manager-interface/:id', authMiddleware, (req, res) => { req.params.model = 'channel_manager_interfaces'; generic.destroy(req, res); });

// Content Room
router.get('/content-room', authMiddleware, (req, res) => { req.params.model = 'content_rooms'; generic.list(req, res); });
router.get('/content-room/create', authMiddleware, (req, res) => { req.params.model = 'content_rooms'; generic.createForm(req, res); });
router.post('/content-room', authMiddleware, (req, res) => { req.params.model = 'content_rooms'; generic.create(req, res); });
router.get('/content-room/:id/update', authMiddleware, (req, res) => { req.params.model = 'content_rooms'; generic.editForm(req, res); });
router.put('/content-room/:id', authMiddleware, (req, res) => { req.params.model = 'content_rooms'; generic.update(req, res); });
router.delete('/content-room/:id', authMiddleware, (req, res) => { req.params.model = 'content_rooms'; generic.destroy(req, res); });

// Rate Room (RateRoomController parity -> rates)
router.get('/rate-room', authMiddleware, (req, res) => { req.params.model = 'rates'; generic.list(req, res); });
router.get('/rate-room/:id/update', authMiddleware, (req, res) => { req.params.model = 'rates'; generic.editForm(req, res); });

// Payment Matrix
router.get('/payment-matrix', authMiddleware, (req, res) => { req.params.model = 'payment_matrices'; generic.list(req, res); });
router.get('/payment-matrix/create', authMiddleware, (req, res) => { req.params.model = 'payment_matrices'; generic.createForm(req, res); });
router.post('/payment-matrix', authMiddleware, (req, res) => { req.params.model = 'payment_matrices'; generic.create(req, res); });
router.get('/payment-matrix/:id/update', authMiddleware, (req, res) => { req.params.model = 'payment_matrices'; generic.editForm(req, res); });
router.put('/payment-matrix/:id', authMiddleware, (req, res) => { req.params.model = 'payment_matrices'; generic.update(req, res); });
router.delete('/payment-matrix/:id', authMiddleware, (req, res) => { req.params.model = 'payment_matrices'; generic.destroy(req, res); });

// STAAM Manager (StaahInterfaceController parity)
router.get('/staah-manager', authMiddleware, (req, res) => { req.params.model = 'staah_interfaces'; generic.list(req, res); });
router.get('/staah-manager/create', authMiddleware, (req, res) => { req.params.model = 'staah_interfaces'; generic.createForm(req, res); });
router.post('/staah-manager', authMiddleware, (req, res) => { req.params.model = 'staah_interfaces'; generic.create(req, res); });
router.get('/staah-manager/:id/update', authMiddleware, (req, res) => { req.params.model = 'staah_interfaces'; generic.editForm(req, res); });
router.put('/staah-manager/:id', authMiddleware, (req, res) => { req.params.model = 'staah_interfaces'; generic.update(req, res); });
router.delete('/staah-manager/:id', authMiddleware, (req, res) => { req.params.model = 'staah_interfaces'; generic.destroy(req, res); });

// STAAM Reservation
router.get('/staah-reservation', authMiddleware, (req, res) => { req.params.model = 'staah_reservations'; generic.list(req, res); });
router.get('/staah-reservation/:id', authMiddleware, (req, res) => { req.params.model = 'staah_reservations'; generic.show(req, res); });

// STAAM OTA Mapping (StaahOtaMappingController parity)
router.get('/staah-ota-mapping', authMiddleware, (req, res) => { req.params.model = 'staah_ota_company_mappings'; generic.list(req, res); });
router.get('/staah-ota-mapping/create', authMiddleware, (req, res) => { req.params.model = 'staah_ota_company_mappings'; generic.createForm(req, res); });
router.post('/staah-ota-mapping', authMiddleware, (req, res) => { req.params.model = 'staah_ota_company_mappings'; generic.create(req, res); });
router.get('/staah-ota-mapping/:id/update', authMiddleware, (req, res) => { req.params.model = 'staah_ota_company_mappings'; generic.editForm(req, res); });
router.put('/staah-ota-mapping/:id', authMiddleware, (req, res) => { req.params.model = 'staah_ota_company_mappings'; generic.update(req, res); });
router.delete('/staah-ota-mapping/:id', authMiddleware, (req, res) => { req.params.model = 'staah_ota_company_mappings'; generic.destroy(req, res); });

// Allotment Room child (AllotmentController@room parity; must precede /allotment/:id)
router.get('/allotment/room', authMiddleware, (req, res) => { req.params.model = 'room_allotments'; generic.list(req, res); });
router.post('/allotment/room', authMiddleware, (req, res) => { req.params.model = 'room_allotments'; generic.create(req, res); });
router.put('/allotment/room/:id', authMiddleware, (req, res) => { req.params.model = 'room_allotments'; generic.update(req, res); });
router.delete('/allotment/room/:id', authMiddleware, (req, res) => { req.params.model = 'room_allotments'; generic.destroy(req, res); });
router.get('/allotment-room', authMiddleware, (req, res) => { req.params.model = 'room_allotments'; generic.list(req, res); });

// ═══════════════════════════════════════════════
// Phase 4.9 — Remaining Modules
// ═══════════════════════════════════════════════

// ── Allotment ──
router.get('/allotment', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'allotment'; generic.list(req, res); });
router.get('/allotment/create', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'allotment'; generic.createForm(req, res); });
router.post('/allotment', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'allotment'; generic.create(req, res); });
router.get('/allotment/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'allotment'; generic.show(req, res); });
router.get('/allotment/:id/update', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'allotment'; generic.editForm(req, res); });
router.put('/allotment/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'allotment'; generic.update(req, res); });
router.delete('/allotment/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'allotment'; generic.destroy(req, res); });
router.post('/allotment/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'allotment'; generic.restore(req, res); });

router.get('/allotments', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'allotment'; generic.list(req, res); });
router.get('/allotments/create', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'allotment'; generic.createForm(req, res); });
router.post('/allotments', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'allotment'; generic.create(req, res); });
router.get('/allotments/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'allotment'; generic.show(req, res); });
router.get('/allotments/:id/update', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'allotment'; generic.editForm(req, res); });
router.put('/allotments/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'allotment'; generic.update(req, res); });
router.delete('/allotments/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'allotment'; generic.destroy(req, res); });
router.post('/allotments/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'allotment'; generic.restore(req, res); });

// ── Overbooking ──
router.get('/overbooking', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'overbooking'; generic.list(req, res); });
router.get('/overbooking/create', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'overbooking'; generic.createForm(req, res); });
router.post('/overbooking', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'overbooking'; generic.create(req, res); });
router.get('/overbooking/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'overbooking'; generic.show(req, res); });
router.get('/overbooking/:id/update', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'overbooking'; generic.editForm(req, res); });
router.put('/overbooking/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'overbooking'; generic.update(req, res); });
router.delete('/overbooking/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'overbooking'; generic.destroy(req, res); });
router.post('/overbooking/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'overbooking'; generic.restore(req, res); });

router.get('/overbookings', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'overbooking'; generic.list(req, res); });
router.get('/overbookings/create', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'overbooking'; generic.createForm(req, res); });
router.post('/overbookings', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'overbooking'; generic.create(req, res); });
router.get('/overbookings/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'overbooking'; generic.show(req, res); });
router.get('/overbookings/:id/update', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'overbooking'; generic.editForm(req, res); });
router.put('/overbookings/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'overbooking'; generic.update(req, res); });
router.delete('/overbookings/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'overbooking'; generic.destroy(req, res); });
router.post('/overbookings/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'overbooking'; generic.restore(req, res); });

// ── Yield ──
router.get('/yield', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'yield'; generic.list(req, res); });
router.get('/yield/create', authMiddleware, requirePermission(80, 'add'), async (req: Request, res: Response) => {
  success(res, { fields: [], statuses: [] }, 'Success');
});
router.post('/yield', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'yield'; generic.create(req, res); });
router.get('/yield/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'yield'; generic.show(req, res); });
router.get('/yield/:id/update', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'yield'; generic.editForm(req, res); });
router.get('/yield/:id/edit', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'yield'; generic.show(req, res); });
router.put('/yield/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'yield'; generic.update(req, res); });
router.delete('/yield/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'yield'; generic.destroy(req, res); });
router.post('/yield/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'yield'; generic.restore(req, res); });

router.get('/yields', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'yield'; generic.list(req, res); });
router.get('/yields/create', authMiddleware, requirePermission(80, 'add'), async (req: Request, res: Response) => {
  success(res, { fields: [], statuses: [] }, 'Success');
});
router.post('/yields', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'yield'; generic.create(req, res); });
router.get('/yields/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'yield'; generic.show(req, res); });
router.get('/yields/:id/update', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'yield'; generic.editForm(req, res); });
router.get('/yields/:id/edit', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'yield'; generic.show(req, res); });
router.put('/yields/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'yield'; generic.update(req, res); });
router.delete('/yields/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'yield'; generic.destroy(req, res); });
router.post('/yields/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'yield'; generic.restore(req, res); });

// ── Hotel Competitor ──
router.get('/hotel-competitor', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'hotel_competitor'; generic.list(req, res); });
router.post('/hotel-competitor', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'hotel_competitor'; generic.create(req, res); });
router.get('/hotel-competitor/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'hotel_competitor'; generic.show(req, res); });
router.put('/hotel-competitor/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'hotel_competitor'; generic.update(req, res); });
router.delete('/hotel-competitor/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'hotel_competitor'; generic.destroy(req, res); });
router.post('/hotel-competitor/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'hotel_competitor'; generic.restore(req, res); });

router.get('/hotel-competitors', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'hotel_competitor'; generic.list(req, res); });
router.post('/hotel-competitors', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'hotel_competitor'; generic.create(req, res); });
router.get('/hotel-competitors/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'hotel_competitor'; generic.show(req, res); });
router.put('/hotel-competitors/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'hotel_competitor'; generic.update(req, res); });
router.delete('/hotel-competitors/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'hotel_competitor'; generic.destroy(req, res); });
router.post('/hotel-competitors/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'hotel_competitor'; generic.restore(req, res); });

// ── Master Hotel Competitor ──
router.get('/master-hotel-competitor', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.list(req, res); });
router.post('/master-hotel-competitor', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.create(req, res); });
router.get('/master-hotel-competitor/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.show(req, res); });
router.put('/master-hotel-competitor/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.update(req, res); });
router.delete('/master-hotel-competitor/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.destroy(req, res); });
router.post('/master-hotel-competitor/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.restore(req, res); });

router.get('/master-hotel-competitors', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.list(req, res); });
router.post('/master-hotel-competitors', authMiddleware, requirePermission(80, 'add'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.create(req, res); });
router.get('/master-hotel-competitors/:id', authMiddleware, requirePermission(80, 'view'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.show(req, res); });
router.put('/master-hotel-competitors/:id', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.update(req, res); });
router.delete('/master-hotel-competitors/:id', authMiddleware, requirePermission(80, 'delete'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.destroy(req, res); });
router.post('/master-hotel-competitors/:id/restore', authMiddleware, requirePermission(80, 'edit'), (req, res) => { req.params.model = 'master_hotel_competitor'; generic.restore(req, res); });

// ── Statistic Occupancy ──
router.get('/statistic/occupancy', authMiddleware, requirePermission(80, 'view'), async (req: Request, res: Response) => {
  try {
    const propertyId = req.user?.lastProperty;
    const dateParam = req.query.date as string;
    const businessDate = dateParam ? new Date(dateParam) : new Date();
    businessDate.setHours(0, 0, 0, 0);

    const pid = propertyId ? BigInt(propertyId) : undefined;
    const nextDate = new Date(businessDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const totalRooms = await prisma.rooms.count({
      where: { property_id: pid, deleted_at: null, is_physical: true },
    });

    const occupiedRooms = await prisma.folios.count({
      where: {
        property_id: pid,
        deleted_at: null,
        status_reservation: { in: [1, 2] },
        check_in_date: { lt: nextDate },
        check_out_date: { gte: nextDate },
      },
    });

    success(res, {
      date: businessDate,
      total_rooms: totalRooms,
      occupied_rooms: occupiedRooms,
      occupancy_pct: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 10000) / 100 : 0,
    }, 'Success');
  } catch (err: any) {
    error(res, err.message || 'Failed to fetch occupancy', 500);
  }
});

// ── Country By Region (master data lookup) ──
// Laravel parity (CountryController@getCountryByRegion): returns [{value, label}];
// region 'all'/'undefined'/'null' → all countries; else countries filtered by region_id
router.get('/countryByRegion', authMiddleware, requirePermission(69, 'view'), async (req: Request, res: Response) => {
  try {
    const region = (req.query.region as string) || 'all';
    const toOptions = (rows: any[]) => rows.map((c: any) => ({ value: Number(c.id), label: c.name }));

    if (region === 'all' || region === 'undefined' || region === 'null') {
      const countries = await prisma.countries.findMany({ orderBy: { name: 'asc' } });
      success(res, toOptions(countries), 'Success');
      return;
    }

    const regionRow = await prisma.regions.findFirst({ where: { name: { contains: region } } });
    if (!regionRow) {
      // Laravel: status 404 with code 200 + empty data
      res.status(404).type('text/plain').send(encrypt(JSON.stringify({ code: '200', message: 'Success', data: [] })));
      return;
    }

    const countries = await prisma.countries.findMany({
      where: { region_id: regionRow.id },
      orderBy: { name: 'asc' },
    });
    success(res, toOptions(countries), 'Success');
  } catch (err: any) {
    error(res, err.message || 'Failed to fetch countries', 500);
  }
});

// ── Assign Room (GET — fetch available rooms for assignment dropdown) ──
router.get('/assign-room', authMiddleware, requirePermission(80, 'view'), async (req: Request, res: Response) => {
  try {
    const propertyId = req.user?.lastProperty;
    const roomTypeId = req.query.room_type_id as string;
    const folioId = req.query.folio_id as string;
    const type = req.query.type as string || 'available';

    const where: any = { deleted_at: null, is_physical: true };
    if (propertyId) where.property_id = BigInt(propertyId);
    if (roomTypeId) where.room_type_id = BigInt(roomTypeId);

    if (type === 'available') {
      where.status = 0;
    }

    const rooms = await prisma.rooms.findMany({
      where,
      orderBy: { sort: 'asc' },
      include: { room_types: { select: { id: true, name: true } } },
    });

    success(res, bigintToNumber(rooms), 'Success');
  } catch (err: any) {
    error(res, err.message || 'Failed to fetch assignable rooms', 500);
  }
});

// ── POST Room Statistic (update room status in bulk) ──
router.post('/room-statistic', authMiddleware, requirePermission(1120, 'edit'), async (req: Request, res: Response) => {
  try {
    const { room_ids, room_status, maid_status } = req.body;
    const ids = (room_ids || []).map((id: any) => BigInt(id));
    const updateData: any = { updated_at: new Date(), updated_by: req.user?.id };
    if (room_status !== undefined) updateData.room_status = parseInt(room_status);
    if (maid_status !== undefined) updateData.maid_status = parseInt(maid_status);

    await prisma.rooms.updateMany({
      where: { id: { in: ids }, deleted_at: null },
      data: updateData,
    });

    success(res, { updated: ids.length }, 'Room status updated');
  } catch (err: any) {
    error(res, err.message || 'Failed to update room status', 500);
  }
});
// ── Profile Guest (alias for GuestController) ──
// Lazy-import GuestController to avoid circular deps
async function guestList(req: Request, res: Response): Promise<void> {
  const { GuestController } = await import('../controllers/guest.controller');
  await GuestController.list(req, res);
}

async function guestCreate(req: Request, res: Response): Promise<void> {
  const { GuestController } = await import('../controllers/guest.controller');
  await GuestController.create(req, res);
}

async function guestEdit(req: Request, res: Response): Promise<void> {
  const { GuestController } = await import('../controllers/guest.controller');
  await GuestController.edit(req, res);
}

async function guestUpdate(req: Request, res: Response): Promise<void> {
  const { GuestController } = await import('../controllers/guest.controller');
  await GuestController.update(req, res);
}

async function guestDelete(req: Request, res: Response): Promise<void> {
  const { GuestController } = await import('../controllers/guest.controller');
  await GuestController.destroy(req, res);
}
router.get('/profile/guest', authMiddleware, requirePermission(82, 'view'), guestList);
router.get('/profile/guest/create', authMiddleware, requirePermission(82, 'add'), guestCreate);
router.get('/profile/guest/:id/update', authMiddleware, requirePermission(82, 'edit'), guestEdit);
router.put('/profile/guest/:id', authMiddleware, requirePermission(82, 'edit'), guestUpdate);
router.delete('/profile/guest/:id', authMiddleware, requirePermission(82, 'delete'), guestDelete);

// ── Guest Requests (parity with Laravel GuestRequestController — Folio-based) ──
const GR_STATUS_RESERVATION: Record<number, string> = {
  0: 'Check In', 1: 'Check Out', 2: 'Cancelled', 3: 'Reservation', 4: 'In House', 5: 'Pending',
};
const GR_COLOR_RESERVATION: Record<number, string> = {
  0: 'bg-green', 1: 'bg-purple', 2: 'bg-red', 3: 'bg-cyan', 4: 'bg-blue', 5: 'bg-yellow',
};
const GR_STATUS_ROOM: Record<string, number> = {
  'Vacant': 0, 'Occupied': 1, 'Due Out': 2, 'Blocked': 3, 'Out of Order': 4,
};
const GR_COLOR_ROOM: Record<number, string> = {
  0: 'bg-cyan', 1: 'bg-green', 2: 'bg-purple', 3: 'bg-red', 4: 'bg-black-red',
};
const GR_STATUS_MAID: Record<string, number> = {
  'Clean': 0, 'Dirty': 1, 'Maid in Room': 2, 'Inspection Required': 3,
};
const GR_COLOR_MAID: Record<number, string> = {
  0: 'bg-cyan', 1: 'bg-red', 2: 'bg-yellow', 3: 'bg-green',
};

const GR_TABLE = [
  { label: 'Folio No.', key: 'folio_number', type: 'none', is_search: true },
  { label: 'Check In Instruction', key: 'check_in_instruction', type: 'none', is_search: true },
  { label: 'Check Out Instruction', key: 'check_out_instruction', type: 'none', is_search: true },
  { label: 'Posting Instruction', key: 'posting_instruction', type: 'none', is_search: true },
  { label: 'Remark', key: 'remark_ins', type: 'none', is_search: false },
  { label: 'Type', key: 'type_reservation', type: 'none', is_search: false },
  { label: 'Status', key: 'status_reservation_color', type: 'label', is_search: false },
  { label: 'Guest Name', key: 'guest_name', type: 'none', is_search: false },
  { label: 'Room', key: 'room', type: 'none', is_search: false },
  { label: 'Group Name/Company', key: 'company', type: 'none', is_search: false },
  { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
  { label: 'Room Status', key: 'room_status_color', type: 'none', is_search: false },
  { label: 'Clean Status', key: 'room_clean_status_color', type: 'none', is_search: false },
  { label: 'Check In', key: 'check_in_date', type: 'date', is_search: true },
  { label: 'Check out', key: 'check_out_date', type: 'date', is_search: true },
];

router.get('/guest-request', authMiddleware, requirePermission(82, 'view'), async (req: Request, res: Response) => {
  try {
    const propertyId = req.user?.lastProperty;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    const search_field = req.query.search_field as string;
    const search_value = req.query.search_value as string;

    const hasInstruction = (field: string) => ({
      AND: [{ [field]: { not: null } }, { [field]: { not: '' } }],
    });

    const where: any = {
      deleted_at: null,
      OR: [
        hasInstruction('check_in_instruction'),
        hasInstruction('check_out_instruction'),
        hasInstruction('posting_instruction'),
        hasInstruction('remark'),
      ],
    };
    if (propertyId) where.property_id = BigInt(propertyId);

    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { first_name: { contains: search, mode: 'insensitive' } },
            { last_name: { contains: search, mode: 'insensitive' } },
            { folio_number: { contains: search, mode: 'insensitive' } },
            { company_name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { telp: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }
    if (search_field && search_value) {
      where[search_field] = { contains: search_value, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      prisma.folios.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ id: 'desc' }, { created_at: 'asc' }],
        include: {
          company_profiles_folios_company_profile_idTocompany_profiles: { select: { name: true } },
          reservations: {
            where: { deleted_at: null, is_posting: 0 },
            orderBy: { date: 'asc' },
            take: 1,
            select: { room_name: true, room_type_name: true, room_status_name: true, maid_status_name: true },
          },
        },
      }),
      prisma.folios.count({ where }),
    ]);

    const guestIds = data.map((r: any) => r.guest_profile_id).filter((id: any) => id !== null && id !== undefined);
    const guests = guestIds.length
      ? await prisma.guest_profiles.findMany({
          where: { id: { in: guestIds } },
          select: { id: true, first_name: true, last_name: true, account: true },
        })
      : [];
    const guestMap = new Map(guests.map((g: any) => [g.id, g]));

    const formatted = data.map((r: any) => {
      const lastRes = r.reservations?.[0];
      const isVirtual = r.type_reservation === 'vr';
      const currentRoomName = isVirtual ? '' : lastRes?.room_name ?? '';
      const currentRoomType = isVirtual ? '' : lastRes?.room_type_name ?? '';
      const statusId = r.status_reservation ?? -1;
      const statusLabel = GR_STATUS_RESERVATION[statusId] ?? '';
      const gp = r.guest_profile_id ? guestMap.get(r.guest_profile_id) : undefined;
      const guestName =
        gp && ((gp.first_name ?? '') !== '' || (gp.last_name ?? '') !== '')
          ? `${gp.first_name ?? ''} ${gp.last_name ?? ''}`.trim()
          : gp?.account ?? '';
      const roomStatusId = lastRes?.room_status_name ? GR_STATUS_ROOM[lastRes.room_status_name] : undefined;
      const maidStatusId = lastRes?.maid_status_name ? GR_STATUS_MAID[lastRes.maid_status_name] : undefined;
      return {
        id: Number(r.id),
        type_reservation: (r.type_reservation || '').toUpperCase(),
        status_reservation_color: [
          {
            label: statusLabel.replace(/ /g, '-'),
            color: GR_COLOR_RESERVATION[statusId] ?? 'bg-success',
            is_color: true,
          },
        ],
        room_clean_status_color: lastRes?.maid_status_name
          ? [
              {
                label: lastRes.maid_status_name.replace(/ /g, '-'),
                color: maidStatusId !== undefined ? GR_COLOR_MAID[maidStatusId] : 'bg-success',
                is_color: true,
              },
            ]
          : [],
        room_status_color: lastRes?.room_status_name
          ? [
              {
                label: lastRes.room_status_name.replace(/ /g, '-'),
                color: roomStatusId !== undefined ? GR_COLOR_ROOM[roomStatusId] : 'bg-success',
                is_color: true,
              },
            ]
          : [],
        company: r.company_name && r.company_name !== '' ? r.company_name : r.company_profiles_folios_company_profile_idTocompany_profiles?.name ?? '',
        folio_number: r.folio_number,
        guest_name: guestName,
        room_type: currentRoomType,
        room: currentRoomName,
        check_in_date: r.check_in_date,
        check_out_date: r.check_out_date,
        check_in_instruction: r.check_in_instruction ?? '',
        check_out_instruction: r.check_out_instruction ?? '',
        posting_instruction: r.posting_instruction ?? '',
        remark_ins: r.remark ?? '',
      };
    });

    success(res, formatted, 'Success', 200, {
      table: GR_TABLE,
      permission: { view: true, add: true, edit: true, delete: true },
      search_data: [
        { field: 'folio_number', label: 'Folio No.' },
        { field: 'check_in_instruction', label: 'Check In Instruction' },
        { field: 'check_out_instruction', label: 'Check Out Instruction' },
        { field: 'posting_instruction', label: 'Posting Instruction' },
        { field: 'check_in_date', label: 'Check In' },
        { field: 'check_out_date', label: 'Check out' },
      ],
      pagging: {
        current_page: page,
        last_page: Math.ceil(total / limit),
        per_page: limit,
        total,
        from: (page - 1) * limit + 1,
        to: Math.min(page * limit, total),
      },
    });
  } catch (err: any) {
    error(res, err.message || 'Failed to fetch guest requests', 500);
  }
});

// ── Email Send Master (placeholder, model pending) ──
router.post('/email/email-send/master', authMiddleware, requirePermission(69, 'view'), async (req: Request, res: Response) => {
  success(res, { message: 'Email endpoint registered (handler pending Prisma model)' }, 'Success');
});

export default router;
