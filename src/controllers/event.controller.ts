import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { moneyFormat, STATUSES } from '../utils/cmsConfig';

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

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function toId(v: any): number { return Number(Array.isArray(v) ? v[0] : v); }
function num(v: any, fallback: any = null): any {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}
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
        table: [
          { label: 'Venue Name', key: 'name', type: 'text', is_search: true },
          { label: 'Description', key: 'description', type: 'text', is_search: true },
          { label: 'Status', key: 'status', type: 'checkbox', is_search: true, options: STATUSES },
        ],
        search_data: [
          { label: 'Venue Name', key: 'name', type: 'text', is_search: true },
          { label: 'Description', key: 'description', type: 'text', is_search: true },
          { label: 'Status', key: 'status', type: 'select', valueOptions: STATUSES },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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

  static async capacityList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const where: any = {};
      if (search) where.description = { contains: search, mode: 'insensitive' };

      const [data, total, venues, layouts] = await Promise.all([
        prisma.event_capacities.findMany({
          where,
          include: { event_venues: { select: { id: true, name: true } }, event_layouts: { select: { id: true, name: true } } },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.event_capacities.count({ where }),
        prisma.event_venues.findMany({ where: { status: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.event_layouts.findMany({ where: { status: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'No', key: 'sort', type: 'number', is_search: false },
          { label: 'Venue', key: 'venue_id', type: 'select', is_search: true, options: venues.map((v: any) => ({ value: Number(v.id), label: v.name })) },
          { label: 'Layout', key: 'layout_id', type: 'select', is_search: true, options: layouts.map((l: any) => ({ value: Number(l.id), label: l.name })) },
          { label: 'Pax', key: 'pax', type: 'number', is_search: true },
          { label: 'Description', key: 'description', type: 'text', is_search: true },
          { label: 'Status', key: 'status', type: 'checkbox', is_search: true },
        ],
        search_data: [
          { label: 'Venue', key: 'venue_id', type: 'select', valueOptions: venues.map((v: any) => ({ value: Number(v.id), label: v.name })) },
          { label: 'Layout', key: 'layout_id', type: 'select', valueOptions: layouts.map((l: any) => ({ value: Number(l.id), label: l.name })) },
          { label: 'Status', key: 'status', type: 'select', valueOptions: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }] },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Capacity list error:', err); error(res, 'Failed to list capacities', 500); }
  }

  static async capacityStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { pax, venue_id, layout_id, description, status } = req.body;
      if (pax === undefined || pax === null || pax === '') { badRequest(res, 'pax is required'); return; }
      const data = await prisma.event_capacities.create({
        data: { property_id: pid, pax: num(pax, 0), venue_id: num(venue_id, 0), layout_id: num(layout_id, 0), description, status: num(status, 1), created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Capacity created', 201);
    } catch (err: any) { console.error('Capacity store error:', err); error(res, 'Failed to create capacity', 500); }
  }

  static async capacityUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const { pax, venue_id, layout_id, description, status } = req.body;
      const data: any = {};
      if (pax !== undefined) data.pax = num(pax, 0);
      if (venue_id !== undefined) data.venue_id = num(venue_id, 0);
      if (layout_id !== undefined) data.layout_id = num(layout_id, 0);
      if (description !== undefined) data.description = description;
      if (status !== undefined) data.status = num(status, 1);
      data.updated_at = new Date();
      await prisma.event_capacities.update({ where: { id }, data });
      success(res, null, 'Capacity updated');
    } catch (err: any) { error(res, 'Failed to update capacity', 500); }
  }

  static async capacityDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_capacities.delete({ where: { id } });
      success(res, null, 'Capacity deleted');
    } catch (err: any) { error(res, 'Failed to delete capacity', 500); }
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
        table: [
          { label: 'Layout Name', key: 'name', type: 'text', is_search: true },
          { label: 'Description', key: 'description', type: 'text', is_search: true },
          { label: 'Image', key: 'image', type: 'fileimage', is_search: false, is_html: true },
          { label: 'Status', key: 'status', type: 'checkbox', is_search: true, options: STATUSES },
        ],
        search_data: [
          { label: 'Layout Name', key: 'name', type: 'text', is_search: true },
          { label: 'Description', key: 'description', type: 'text', is_search: true },
          { label: 'Status', key: 'status', type: 'select', valueOptions: STATUSES },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const include = {
        event_venues: { select: { name: true } },
        event_packages: { select: { name: true } },
        event_layouts: { select: { name: true } },
      };
      const [data, total] = await Promise.all([
        prisma.event_events.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include }),
        prisma.event_events.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'No', key: 'sort', type: 'number', is_search: false },
          { label: 'Name', key: 'name', type: 'text', is_search: true },
          { label: 'Venue', key: 'event_venues.name', type: 'text', is_search: true },
          { label: 'Package', key: 'event_packages.name', type: 'text', is_search: true },
          { label: 'Status', key: 'status', type: 'checkbox', is_search: true },
        ],
        search_data: [
          { label: 'Status', key: 'status', type: 'select', valueOptions: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }] },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Event list error:', err); error(res, 'Failed to list events', 500); }
  }

  static async timeline(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const today = new Date();
      const defaultStart = new Date(today); defaultStart.setDate(today.getDate() - 7);
      const defaultEnd = new Date(today); defaultEnd.setDate(today.getDate() + 14);
      const start = req.query.start ? new Date(String(req.query.start)) : defaultStart;
      const end = req.query.end ? new Date(String(req.query.end)) : defaultEnd;
      end.setHours(23, 59, 59, 999);

      const events = await prisma.event_events.findMany({
        where: { property_id: pid, deleted_at: null, event_start_time: { gte: start }, event_end_time: { lte: end } },
        orderBy: { event_start_time: 'asc' },
        include: { event_venues: { select: { name: true } } },
      });

      const dates: string[] = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10));
      }
      const timeline = dates.map((dateStr) => {
        const dayStart = new Date(`${dateStr}T00:00:00`);
        const dayEnd = new Date(`${dateStr}T23:59:59`);
        const items = events
          .filter((e) => e.event_start_time <= dayEnd && e.event_end_time >= dayStart)
          .map((e) => ({
            id: e.id,
            event_no: e.event_no,
            name: e.name,
            start: e.event_start_time,
            end: e.event_end_time,
            status: e.status,
            venue: e.event_venues?.name ?? null,
            pax: e.pax,
            guest: e.guest_name,
          }));
        return { date: dateStr, events: items };
      });

      success(res, { dates, timeline, default_start: defaultStart.toISOString().slice(0, 10), default_end: defaultEnd.toISOString().slice(0, 10) }, 'Success');
    } catch (err: any) { console.error('Event timeline error:', err); error(res, 'Failed to load event timeline', 500); }
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
        data: { property_id: pid, event_no: event_no || `EVT${Date.now()}`, name, event_start_time: new Date(event_start_time), event_end_time: new Date(event_end_time), guest_name, guest_phone, guest_email, company_profile_id: company_profile_id ? BigInt(company_profile_id) : null, sales_in_charge: sales_in_charge ? BigInt(sales_in_charge) : null, package_id: num(package_id), venue_id: num(venue_id), layout_id: num(layout_id), pax: num(pax), folio_id: folio_id ? BigInt(folio_id) : null, status: status || 'Tentative', description, total_amount: num(total_amount, 0), created_at: new Date() },
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
        data: { event_no, name, event_start_time: event_start_time ? new Date(event_start_time) : undefined, event_end_time: event_end_time ? new Date(event_end_time) : undefined, guest_name, guest_phone, guest_email, company_profile_id: company_profile_id ? BigInt(company_profile_id) : null, sales_in_charge: sales_in_charge ? BigInt(sales_in_charge) : null, package_id: package_id !== undefined ? num(package_id) : undefined, venue_id: venue_id !== undefined ? num(venue_id) : undefined, layout_id: layout_id !== undefined ? num(layout_id) : undefined, pax: pax !== undefined ? num(pax) : undefined, status, description, total_amount: total_amount !== undefined ? num(total_amount, 0) : undefined, updated_at: new Date() },
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

  static async eventSort(req: Request, res: Response): Promise<void> {
    try {
      const { items } = req.body;
      if (items && Array.isArray(items)) {
        for (const item of items) {
          await prisma.$executeRawUnsafe(`UPDATE event_events SET updated_at = NOW() WHERE id = ${Number(item.id)}`);
        }
      }
      success(res, null, 'Event sorted');
    } catch (err: any) { error(res, 'Failed to sort events', 500); }
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
        table: [
          { label: 'No', key: 'sort', type: 'number', is_search: false },
          { label: 'Name', key: 'name', type: 'text', is_search: true },
          { label: 'Venue', key: 'venue_id', type: 'number', is_search: true },
          { label: 'Layout', key: 'layout_id', type: 'number', is_search: true },
          { label: 'Capacity', key: 'max_capacity', type: 'number', is_search: true },
          { label: 'Status', key: 'status', type: 'checkbox', is_search: true },
        ],
        search_data: [
          { label: 'Status', key: 'status', type: 'select', valueOptions: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }] },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Package list error:', err); error(res, 'Failed to list packages', 500); }
  }

  static async packageStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { name, capacity_id, max_capacity, venue_id, layout_id, description, price, status } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }

      const data = await prisma.event_packages.create({
        data: { property_id: pid ? Number(pid) : null, name, capacity_id: num(capacity_id), max_capacity: num(max_capacity), venue_id: num(venue_id), layout_id: num(layout_id), description, price: num(price, 0), status: status ?? true, created_at: new Date() },
      });
      success(res, bigintToNumber(data), 'Package created', 201);
    } catch (err: any) { console.error('Package store error:', err); error(res, 'Failed to create package', 500); }
  }

  static async packageUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const { name, capacity_id, max_capacity, venue_id, layout_id, description, price, status } = req.body;
      const data: any = {};
      if (name !== undefined) data.name = name;
      if (capacity_id !== undefined) data.capacity_id = num(capacity_id);
      if (max_capacity !== undefined) data.max_capacity = num(max_capacity);
      if (venue_id !== undefined) data.venue_id = num(venue_id);
      if (layout_id !== undefined) data.layout_id = num(layout_id);
      if (description !== undefined) data.description = description;
      if (price !== undefined) data.price = num(price, 0);
      if (status !== undefined) data.status = status;
      data.updated_at = new Date();
      await prisma.event_packages.update({ where: { id }, data });
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
      const pidInv = BigInt(req.user?.lastProperty ?? 0);
      const where: any = {};
      if (search) where.description = { contains: search, mode: 'insensitive' };

      const [data, total, codePosts] = await Promise.all([
        prisma.event_inventories.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.event_inventories.count({ where }),
        // CodePost is HasProperties-scoped in Laravel
        prisma.code_posts.findMany({ where: { deleted_at: null, status: 1, type: 'DEFAULT', ...(req.user?.lastProperty ? { property_id: pidInv } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      ]);

      const rows = bigintToNumber(data).map((r: any) => ({
        ...r,
        code_post_id: r.code_post_id != null ? { value: Number(r.code_post_id), label: (codePosts as any).find((c: any) => Number(c.id) === Number(r.code_post_id))?.name ?? null } : null,
      }));

      success(res, rows, 'Success', 200, {
        table: [
          { label: 'Item', key: 'code_post_id', type: 'select', is_search: true, options: codePosts.map((c: any) => ({ value: Number(c.id), label: c.name })) },
          { label: 'Description', key: 'description', type: 'text', is_search: true },
          { label: 'Sales', key: 'sales', type: 'number', is_search: false },
          { label: 'Qty', key: 'quantity', type: 'number', is_search: false },
        ],
        search_data: [
          { label: 'Item', key: 'code_post_id', type: 'select', valueOptions: codePosts.map((c: any) => ({ value: Number(c.id), label: c.name })) },
          { label: 'Description', key: 'description', type: 'text', is_search: true },
        ],
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
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
      const data: any = {};
      if (code_post_id !== undefined) data.code_post_id = parseInt(code_post_id, 10) || 0;
      if (description !== undefined) data.description = description;
      if (sales !== undefined) data.sales = num(sales, 0);
      if (quantity !== undefined) data.quantity = num(quantity, 0);
      data.updated_at = new Date();
      await prisma.event_inventories.update({ where: { id }, data });
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
      const eventIdRaw = String(req.query.event_id ?? '').replace('?sort=', '');
      if (!req.query.event_id) {
        success(res, [], 'event_management_id is required', 400);
        return;
      }
      const eventId = parseInt(eventIdRaw, 10) || 0;
      const where: any = { property_id: pid };
      if (eventId) where.event_management_id = BigInt(eventId);

      const [data, total] = await Promise.all([
        prisma.event_management_items.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.event_management_items.count({ where }),
      ]);

      // CodeItem is HasProperties-scoped in Laravel
      const codeItems = await prisma.code_items.findMany({ where: { deleted_at: null, ...(req.user?.lastProperty ? { property_id: pid } : {}) }, orderBy: { name: 'asc' } });
      const table = [
        {
          label: 'Item', key: 'code_item_id', type: 'select', is_search: false, is_related: true,
          related: ['description', 'cost', 'frequency', 'cost_on'],
          options: codeItems.map((c: any) => ({
            value: Number(c.id), label: c.name, description: c.description,
            cost: moneyFormat(Number(c.sales)),
            frequency: { value: 'Daily', label: 'Daily' },
            cost_on: { value: 'Actual Day', label: 'Actual Day' },
          })),
        },
        { label: 'Description', key: 'description', type: 'text', is_search: false },
        { label: 'Cost', key: 'cost', type: 'number', is_search: false },
        {
          label: 'Frequency', key: 'frequency', type: 'select', is_search: false,
          options: [
            { value: 'Daily', label: 'Daily' },
            { value: 'Once', label: 'Once' },
            { value: 'Twice', label: 'Twice' },
          ],
        },
        {
          label: 'Cost On', key: 'cost_on', type: 'select', is_search: false,
          options: [{ value: 'Actual Day', label: 'Actual Day' }],
        },
        { label: 'QTY', key: 'qty', type: 'number', is_search: false },
      ];

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        permission: getPermissionFlags(req.user, 1133),
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Item list error:', err); error(res, 'Failed to list items', 500); }
  }

  static async itemStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ? BigInt(req.user.lastProperty) : 0n;
      const { code_item_id, frequency, description, cost_on, cost, qty } = req.body;
      const eventIdRaw = String(req.query.event_id ?? '').replace('?sort=', '');
      const eventId = parseInt(eventIdRaw, 10) || 0;
      if (!eventId) { badRequest(res, 'event_id is required'); return; }
      if (code_item_id === undefined || frequency === undefined || description === undefined || cost_on === undefined || cost === undefined || qty === undefined) {
        badRequest(res, 'code_item_id, frequency, description, cost_on, cost, qty are required'); return;
      }
      const data = await prisma.event_management_items.create({
        data: {
          property_id: pid,
          event_management_id: BigInt(eventId),
          code_item_id: BigInt(code_item_id),
          frequency: String(frequency),
          description: description ?? null,
          cost_on: cost_on ?? 0,
          cost: cost ?? 0,
          qty: Number(qty) || 0,
        },
      });
      success(res, bigintToNumber(data), 'Success', 200);
    } catch (err: any) { console.error('Item store error:', err); error(res, 'Failed to create item', 500); }
  }

  static async itemUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      const { code_item_id, frequency, description, cost_on, cost, qty } = req.body;
      const data: any = {};
      if (code_item_id !== undefined) data.code_item_id = BigInt(code_item_id);
      if (frequency !== undefined) data.frequency = String(frequency);
      if (description !== undefined) data.description = description;
      if (cost_on !== undefined) data.cost_on = cost_on;
      if (cost !== undefined) data.cost = cost;
      if (qty !== undefined) data.qty = Number(qty);
      await prisma.event_management_items.update({ where: { id: BigInt(id) }, data });
      success(res, null, 'Success');
    } catch (err: any) { console.error('Item update error:', err); error(res, 'Failed to update item', 500); }
  }

  static async itemDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = toId(req.params.id);
      await prisma.event_management_items.delete({ where: { id: BigInt(id) } });
      success(res, [], 'Success');
    } catch (err: any) { console.error('Item delete error:', err); error(res, 'Failed to delete item', 500); }
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
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Management list error:', err); error(res, 'Failed to list event managements', 500); }
  }
}

