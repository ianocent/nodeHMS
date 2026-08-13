import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { authMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/permission.middleware';
import { success, error, notFound } from '../utils/response';
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
router.get('/countryByRegion', authMiddleware, requirePermission(69, 'view'), async (req: Request, res: Response) => {
  try {
    const nameFilter = req.query.name as string;
    const where: any = { deleted_at: null };
    if (nameFilter) where.name = { contains: nameFilter };
    const countries = await prisma.countries.findMany({
      where,
      select: { id: true, iso2: true, name: true, region: true, phonecode: true },
      orderBy: { name: 'asc' },
    });
    success(res, bigintToNumber(countries), 'Success');
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

// ── Guest Requests (backed by guest_profile_preferences with remark) ──
router.get('/guest-request', authMiddleware, requirePermission(82, 'view'), async (req: Request, res: Response) => {
  try {
    const propertyId = req.user?.lastProperty;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const search = req.query.search as string;

    const where: any = {
      property_id: propertyId ? BigInt(propertyId) : undefined,
      deleted_at: null,
      remark: { not: null },
    };
    if (search) {
      where.remark = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      prisma.guest_profile_preferences.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updated_at: 'desc' },
        include: { guest_profiles: { select: { id: true, first_name: true, last_name: true } } },
      }),
      prisma.guest_profile_preferences.count({ where }),
    ]);

    const table = [
      { label: 'Guest', key: 'guest_name', type: 'none', is_search: false },
      { label: 'Request', key: 'remark', type: 'none', is_search: true },
      { label: 'Status', key: 'request_status', type: 'badge', is_search: false },
      { label: 'Date', key: 'updated_at', type: 'none', is_search: false },
      { label: 'Action', key: 'action', type: 'action', is_search: false },
    ];
    const permission = { view: true, add: true, edit: true, delete: true };
    const formatted = data.map((r: any) => ({
      ...bigintToNumber(r),
      guest_name: r.guest_profiles
        ? `${r.guest_profiles.first_name || ''} ${r.guest_profiles.last_name || ''}`.trim()
        : '-',
      guest_profiles: undefined,
    }));

    success(res, formatted, 'Success', 200, {
      table,
      permission,
      search_data: [{ field: 'remark', label: 'Request' }],
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

router.get('/guest-request/create', authMiddleware, requirePermission(82, 'add'), async (req: Request, res: Response) => {
  try {
    const propertyId = req.user?.lastProperty;
    const guests = await prisma.guest_profiles.findMany({
      where: { deleted_at: null, property_id: propertyId ? BigInt(propertyId) : undefined },
      select: { id: true, first_name: true, last_name: true },
      orderBy: { first_name: 'asc' },
      take: 100,
    });
    success(res, {
      guests: bigintToNumber(guests).map((g: any) => ({ value: g.id, label: `${g.first_name || ''} ${g.last_name || ''}`.trim() || `#${g.id}` })),
      statuses: [
        { value: 'pending', label: 'Pending' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    }, 'Success');
  } catch (err: any) {
    error(res, err.message || 'Failed to load form data', 500);
  }
});

router.post('/guest-request', authMiddleware, requirePermission(82, 'add'), async (req: Request, res: Response) => {
  try {
    const propertyId = req.user?.lastProperty;
    const { id_guest_profile, remark, preference } = req.body;
    if (!id_guest_profile || !remark) {
      const { badRequest } = await import('../utils/response');
      badRequest(res, 'Guest profile and remark are required');
      return;
    }
    const record = await prisma.guest_profile_preferences.create({
      data: {
        property_id: BigInt(propertyId ?? 0),
        id_guest_profile: BigInt(id_guest_profile),
        preference: preference || null,
        remark,
        request_status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        created_by: req.user?.id,
      },
    });
    success(res, bigintToNumber(record), 'Guest request created');
  } catch (err: any) {
    error(res, err.message || 'Failed to create guest request', 500);
  }
});

router.get('/guest-request/:id', authMiddleware, requirePermission(82, 'view'), async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id as string);
    const record = await prisma.guest_profile_preferences.findUnique({
      where: { id },
      include: { guest_profiles: { select: { id: true, first_name: true, last_name: true } } },
    });
    if (!record || record.deleted_at) { notFound(res, 'Not Found'); return; }
    success(res, bigintToNumber(record), 'Success');
  } catch (err: any) {
    error(res, err.message || 'Failed to fetch guest request', 500);
  }
});

router.get('/guest-request/:id/update', authMiddleware, requirePermission(82, 'edit'), async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id as string);
    const record = await prisma.guest_profile_preferences.findUnique({
      where: { id },
      include: { guest_profiles: { select: { id: true, first_name: true, last_name: true } } },
    });
    if (!record || record.deleted_at) { notFound(res, 'Not Found'); return; }
    success(res, bigintToNumber(record), 'Success');
  } catch (err: any) {
    error(res, err.message || 'Failed to fetch guest request', 500);
  }
});

router.put('/guest-request/:id', authMiddleware, requirePermission(82, 'edit'), async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id as string);
    const { remark, request_status, preference } = req.body;
    const updateData: any = { updated_at: new Date(), updated_by: req.user?.id };
    if (remark !== undefined) updateData.remark = remark;
    if (preference !== undefined) updateData.preference = preference;
    if (request_status !== undefined) {
      updateData.request_status = request_status;
      if (request_status === 'completed') updateData.completed_at = new Date();
    }
    await prisma.guest_profile_preferences.update({ where: { id }, data: updateData });
    success(res, null, 'Guest request updated');
  } catch (err: any) {
    error(res, err.message || 'Failed to update guest request', 500);
  }
});

router.delete('/guest-request/:id', authMiddleware, requirePermission(82, 'delete'), async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id as string);
    await prisma.guest_profile_preferences.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by: req.user?.id },
    });
    success(res, null, 'Deleted');
  } catch (err: any) {
    error(res, err.message || 'Failed to delete guest request', 500);
  }
});

// ── Email Send Master (placeholder, model pending) ──
router.post('/email/email-send/master', authMiddleware, requirePermission(69, 'view'), async (req: Request, res: Response) => {
  success(res, { message: 'Email endpoint registered (handler pending Prisma model)' }, 'Success');
});

export default router;
