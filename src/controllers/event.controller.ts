import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function toId(v: any): number { return Number(Array.isArray(v) ? v[0] : v); }
function parsePagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 10;
  const search = query.search as string;
  const sort = query.sort as string || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  return { page, limit, search, sort, order };
}

export class EventController {

  // ==================== VENUE ====================
  static async venueList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = {};
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.event_venues.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.event_venues.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Venue list error:', err); error(res, 'Failed to list venues', 500); }
  }

  static async venueStore(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const data = await prisma.event_venues.create({
        data: { property_id: req.user?.lastProperty ? Number(req.user.lastProperty) : 0, name, description, status: status ?? true, created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Venue created', 201);
    } catch (err: any) { console.error('Venue store error:', err); error(res, 'Failed to create venue', 500); }
  }

  static async venueUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const { name, description, status } = req.body;
      await prisma.event_venues.update({ where: { id }, data: { name, description, status, updated_at: new Date() } });
      success(res, null, 'Venue updated');
    } catch (err: any) { error(res, 'Failed to update venue', 500); }
  }

  static async venueDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_venues.delete({ where: { id } });
      success(res, null, 'Venue deleted');
    } catch (err: any) { error(res, 'Failed to delete venue', 500); }
  }

  static async venueMaster(req: Request, res: Response): Promise<void> {
    try {
      const [venues, layouts] = await Promise.all([
        prisma.event_venues.findMany({ where: { status: true }, orderBy: { name: 'asc' } }),
        prisma.event_layouts.findMany({ where: { status: true }, orderBy: { name: 'asc' } }),
      ]);
      success(res, { venues: bigintToNumber(venues), layouts: bigintToNumber(layouts) }, 'Success');
    } catch (err: any) { error(res, 'Failed to load master data', 500); }
  }

  // ==================== LAYOUT ====================
  static async layoutList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = {};
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.event_layouts.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.event_layouts.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Layout list error:', err); error(res, 'Failed to list layouts', 500); }
  }

  static async layoutStore(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const data = await prisma.event_layouts.create({
        data: { name, description, status: status ?? true, created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Layout created', 201);
    } catch (err: any) { console.error('Layout store error:', err); error(res, 'Failed to create layout', 500); }
  }

  static async layoutUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const { name, description, status } = req.body;
      await prisma.event_layouts.update({ where: { id }, data: { name, description, status, updated_at: new Date() } });
      success(res, null, 'Layout updated');
    } catch (err: any) { error(res, 'Failed to update layout', 500); }
  }

  static async layoutDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_layouts.delete({ where: { id } });
      success(res, null, 'Layout deleted');
    } catch (err: any) { error(res, 'Failed to delete layout', 500); }
  }

  // ==================== EVENT ====================
  static async eventList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.event_events.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: { event_venues: { select: { name: true } }, event_packages: { select: { name: true } }, event_layouts: { select: { name: true } } } }),
        prisma.event_events.count({ where }),
      ]);

      const permFlags = getPermissionFlags(req.user, 211);
      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: req.user?.superUser || permFlags.add, edit: req.user?.superUser || permFlags.edit, delete: req.user?.superUser || permFlags.delete },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Event list error:', err); error(res, 'Failed to list events', 500); }
  }

  static async eventCreate(req: Request, res: Response): Promise<void> {
    try {
      const [venues, layouts, packages] = await Promise.all([
        prisma.event_venues.findMany({ where: { status: true }, orderBy: { name: 'asc' } }),
        prisma.event_layouts.findMany({ where: { status: true }, orderBy: { name: 'asc' } }),
        prisma.event_packages.findMany({ where: { status: true }, orderBy: { name: 'asc' } }),
      ]);
      success(res, { venues: bigintToNumber(venues), layouts: bigintToNumber(layouts), packages: bigintToNumber(packages) }, 'Success');
    } catch (err: any) { error(res, 'Failed to load form data', 500); }
  }

  static async eventStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { event_no, name, event_start_time, event_end_time, guest_name, guest_phone, guest_email, company_profile_id, sales_in_charge, package_id, venue_id, layout_id, pax, folio_id, status, description, total_amount } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const data = await prisma.event_events.create({
        data: { property_id: pid, event_no: event_no || `EVT${Date.now()}`, name, event_start_time: new Date(event_start_time), event_end_time: new Date(event_end_time), guest_name, guest_phone, guest_email, company_profile_id: company_profile_id ? BigInt(company_profile_id) : null, sales_in_charge: sales_in_charge ? BigInt(sales_in_charge) : null, package_id: package_id || null, venue_id: venue_id || null, layout_id: layout_id || null, pax: pax || null, folio_id: folio_id ? BigInt(folio_id) : null, status: status || 'Tentative', description, total_amount: total_amount || 0, created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Event created', 201);
    } catch (err: any) { console.error('Event store error:', err); error(res, 'Failed to create event', 500); }
  }

  static async eventShow(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const data = await prisma.event_events.findUnique({ where: { id }, include: { event_venues: true, event_layouts: true, event_packages: true, event_deposit_plans: true, event_deposit_actuals: true, event_instructions: true, company_profiles: { select: { name: true } } } });
      if (!data) { notFound(res, 'Event not found'); return; }
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load event', 500); }
  }

  static async eventUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const { event_no, name, event_start_time, event_end_time, guest_name, guest_phone, guest_email, company_profile_id, sales_in_charge, package_id, venue_id, layout_id, pax, status, description, total_amount } = req.body;
      await prisma.event_events.update({
        where: { id },
        data: { event_no, name, event_start_time: event_start_time ? new Date(event_start_time) : undefined, event_end_time: event_end_time ? new Date(event_end_time) : undefined, guest_name, guest_phone, guest_email, company_profile_id: company_profile_id ? BigInt(company_profile_id) : null, sales_in_charge: sales_in_charge ? BigInt(sales_in_charge) : null, package_id, venue_id, layout_id, pax, status, description, total_amount, updated_at: new Date() },
      });
      success(res, null, 'Event updated');
    } catch (err: any) { error(res, 'Failed to update event', 500); }
  }

  static async eventDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_events.delete({ where: { id } });
      success(res, null, 'Event deleted');
    } catch (err: any) { error(res, 'Failed to delete event', 500); }
  }

  // ==================== PACKAGE ====================
  static async packageList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = { deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.event_packages.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit, include: { event_package_items: true } }),
        prisma.event_packages.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Package list error:', err); error(res, 'Failed to list packages', 500); }
  }

  static async packageStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { name, capacity_id, max_capacity, venue_id, layout_id, description, price, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const data = await prisma.event_packages.create({
        data: { property_id: pid ? Number(pid) : null, name, capacity_id: capacity_id || null, max_capacity: max_capacity || null, venue_id: venue_id || null, layout_id: layout_id || null, description, price: price || 0, status: status ?? true, created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Package created', 201);
    } catch (err: any) { console.error('Package store error:', err); error(res, 'Failed to create package', 500); }
  }

  static async packageUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const { name, capacity_id, max_capacity, venue_id, layout_id, description, price, status } = req.body;
      await prisma.event_packages.update({ where: { id }, data: { name, capacity_id: capacity_id || null, max_capacity: max_capacity || null, venue_id, layout_id, description, price, status, updated_at: new Date() } });
      success(res, null, 'Package updated');
    } catch (err: any) { error(res, 'Failed to update package', 500); }
  }

  static async packageDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_packages.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Package deleted');
    } catch (err: any) { error(res, 'Failed to delete package', 500); }
  }

  // ==================== INVENTORY ====================
  static async inventoryList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = {};
      if (search) where.description = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.event_inventories.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.event_inventories.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: { view: true, add: true, edit: true, delete: true },
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Inventory list error:', err); error(res, 'Failed to list inventory', 500); }
  }

  static async inventoryStore(req: Request, res: Response): Promise<void> {
    try {
      const { code_post_id, description, sales, quantity } = req.body;
      if (!description) { badRequest(res, 'description is required'); return; }

      const data = await prisma.event_inventories.create({
        data: { code_post_id: parseInt(code_post_id), description, sales: sales || 0, quantity: quantity || 0, created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Inventory created', 201);
    } catch (err: any) { console.error('Inventory store error:', err); error(res, 'Failed to create inventory', 500); }
  }

  static async inventoryUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const { code_post_id, description, sales, quantity } = req.body;
      await prisma.event_inventories.update({ where: { id }, data: { code_post_id: parseInt(code_post_id), description, sales, quantity, updated_at: new Date() } });
      success(res, null, 'Inventory updated');
    } catch (err: any) { error(res, 'Failed to update inventory', 500); }
  }

  static async inventoryDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_inventories.delete({ where: { id } });
      success(res, null, 'Inventory deleted');
    } catch (err: any) { error(res, 'Failed to delete inventory', 500); }
  }

  // ==================== ITEM ====================
  static async itemList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        prisma.event_management_items.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.event_management_items.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Item list error:', err); error(res, 'Failed to list items', 500); }
  }

  // ==================== DEPOSIT PLAN ====================
  static async depositPlanList(req: Request, res: Response): Promise<void> {
    try {
      const eventId = toId(req.params.eventId);
      const data = await prisma.event_deposit_plans.findMany({ where: { event_id: eventId }, orderBy: { id: 'asc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to list deposit plans', 500); }
  }

  static async depositPlanStore(req: Request, res: Response): Promise<void> {
    try {
      const eventId = toId(req.params.eventId);
      const { portion, date, amount } = req.body;
      const data = await prisma.event_deposit_plans.create({
        data: { event_id: eventId, portion: portion || '1', date: date ? new Date(date) as any : undefined, amount: amount || 0, created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Deposit plan created', 201);
    } catch (err: any) { error(res, 'Failed to create deposit plan', 500); }
  }

  static async depositPlanDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_deposit_plans.delete({ where: { id } });
      success(res, null, 'Deposit plan deleted');
    } catch (err: any) { error(res, 'Failed to delete deposit plan', 500); }
  }

  // ==================== DEPOSIT ACTUAL ====================
  static async depositActualList(req: Request, res: Response): Promise<void> {
    try {
      const eventId = toId(req.params.eventId);
      const data = await prisma.event_deposit_actuals.findMany({ where: { event_id: eventId }, orderBy: { id: 'asc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to list deposit actuals', 500); }
  }

  static async depositActualStore(req: Request, res: Response): Promise<void> {
    try {
      const eventId = toId(req.params.eventId);
      const { portion, date, amount } = req.body;
      const data = await prisma.event_deposit_actuals.create({
        data: { event_id: eventId, portion: portion || '1', date: date ? new Date(date) as any : undefined, amount: amount || 0, created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Deposit actual created', 201);
    } catch (err: any) { error(res, 'Failed to create deposit actual', 500); }
  }

  static async depositActualDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_deposit_actuals.delete({ where: { id } });
      success(res, null, 'Deposit actual deleted');
    } catch (err: any) { error(res, 'Failed to delete deposit actual', 500); }
  }

  // ==================== INSTRUCTION ====================
  static async instructionList(req: Request, res: Response): Promise<void> {
    try {
      const eventId = toId(req.params.eventId);
      const data = await prisma.event_instructions.findMany({ where: { event_id: eventId } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to list instructions', 500); }
  }

  static async instructionSave(req: Request, res: Response): Promise<void> {
    try {
      const eventId = toId(req.params.eventId);
      const { banquet, fo, kitchen, housekeeping, steward, engineering, restaurant, security, bar, mcm, sales_marketing, order_taken_by } = req.body;

      const existing = await prisma.event_instructions.findFirst({ where: { event_id: eventId } });
      if (existing) {
        await prisma.event_instructions.update({ where: { id: existing.id }, data: { banquet, fo, kitchen, housekeeping, steward, engineering, restaurant, security, bar, mcm, sales_marketing, order_taken_by, updated_at: new Date() } });
      } else {
        await prisma.event_instructions.create({ data: { event_id: eventId, banquet, fo, kitchen, housekeeping, steward, engineering, restaurant, security, bar, mcm, sales_marketing, order_taken_by, created_at: new Date() } });
      }
      success(res, null, 'Instructions saved');
    } catch (err: any) { error(res, 'Failed to save instructions', 500); }
  }

  // ==================== EVENT MANAGEMENT ====================
  static async managementList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.event_managements.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.event_managements.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Management list error:', err); error(res, 'Failed to list event managements', 500); }
  }
}
