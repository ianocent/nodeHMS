import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';

const genericPool = new Pool({ connectionString: process.env.DATABASE_URL });
const genericAdapter = new PrismaPg(genericPool);
const genericPrisma = new PrismaClient({ adapter: genericAdapter });

function getPrisma() {
  return genericPrisma;
}

function parseJsonField(val: any, fallback: any): any {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return val; }
}

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

function parsePagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = Math.min(parseInt(query.limit as string) || 10, 100);
  const search = query.search as string;
  const sort = query.sort as string || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  const trash = query.trash === '1' || query.trash === 'true';
  return { page, limit, search, sort, order, trash };
}

export class GenericController {
  private getPrismaModel(modelName: string): any {
    const client = getPrisma();
    const model = (client as any)[this.toPlural(modelName)];
    if (!model) throw new Error(`Model "${modelName}" not found`);
    return model;
  }

  private toPlural(name: string): string {
    const irregular: Record<string, string> = {
      user: 'users',
      property: 'properties',
      role: 'roles',
      menu: 'menus',
      city: 'cities',
      country: 'countries',
      code_billing: 'code_billings',
      code_item: 'code_items',
      code_gl: 'code_gls',
      code_post: 'code_posts',
      type_payment: 'type_payments',
      company_profile: 'company_profiles',
      guest_profile: 'guest_profiles',
      guest_profile_preference: 'guest_profile_preferences',
      reservation: 'reservations',
      room: 'rooms',
      room_type: 'room_types',
      rate: 'rates',
      promotion: 'promotions',
    };
    if (Object.values(irregular).includes(name)) return name;
    return irregular[name] || (name.endsWith('y') ? name.slice(0, -1) + 'ies' : name + 's');
  }

  private parseSearchFields(modelName: string, search: string): any {
    const searchFields: Record<string, string[]> = {
      users: ['name', 'email', 'username'],
      properties: ['name', 'alias', 'email'],
      roles: ['name'],
      menus: ['name'],
      cities: ['name'],
      countries: ['name'],
      code_billings: ['name', 'code'],
      code_items: ['name', 'code'],
      code_gls: ['name', 'code'],
      code_posts: ['name', 'code'],
      type_payments: ['name', 'code'],
      company_profiles: ['name', 'email'],
      guest_profiles: ['name', 'email'],
      reservations: ['folio_number', 'guest_name'],
      rooms: ['name', 'room_number'],
      room_types: ['name', 'code'],
      rates: ['name', 'code'],
      promotions: ['name', 'code'],
    };
    return searchFields[modelName] || ['name'];
  }

  async list(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      console.log('Generic list request for model:', model);
      const { page, limit, search, sort, order, trash } = parsePagination(req.query);
      const modelDelegate = this.getPrismaModel(model);
      console.log('Model delegate:', modelDelegate ? 'found' : 'NOT FOUND');
      const searchFields = this.parseSearchFields(model, search || '');

      const where: any = trash ? { deleted_at: { not: null } } : { deleted_at: null };
      if (search && searchFields.length > 0) {
        where.OR = searchFields.map((f: string) => ({ [f]: { contains: search, mode: 'insensitive' } }));
      }

      const orderBy: any = {};
      orderBy[sort] = order;

      const [data, total] = await Promise.all([
        modelDelegate.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
        modelDelegate.count({ where }),
      ]);

      // Build default table config from first record's keys
      const firstRecord = data[0] || {};
      const table = Object.keys(firstRecord).slice(0, 6).map((key) => ({
        label: key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        key,
        type: key === 'id' || key.endsWith('_id') || key.endsWith('_by') ? 'none' : 'string',
        is_search: key === 'name' || key === 'code' || key === 'description',
      }));
      if (table.length > 0) table.push({ label: 'Action', key: 'action', type: 'action', is_search: false });

      const permission = { view: true, add: true, edit: true, delete: true };

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        permission,
        search_data: [],
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
      if (err.message.includes('not found')) notFound(res, err.message);
      else { console.error('Generic list error:', err.message, err.stack); error(res, 'Failed to list', 500); }
    }
  }

  async show(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const modelDelegate = this.getPrismaModel(model);
      const record = await modelDelegate.findUnique({ where: { id: idParam(String(req.params.id)) } });
      if (!record) { notFound(res, 'Record not found'); return; }
      const permission = { view: true, add: true, edit: true, delete: true };
      success(res, bigintToNumber(record), 'Success', 200, { table: [], search_data: [], permission });
    } catch (err: any) {
      if (err.message.includes('not found')) notFound(res, err.message);
      else { console.error('Generic show error:', err); error(res, 'Failed to load', 500); }
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const modelDelegate = this.getPrismaModel(model);
      const data = { ...req.body, created_at: new Date(), updated_at: new Date() };
      const record = await modelDelegate.create({ data });
      const permission = { view: true, add: true, edit: true, delete: true };
      success(res, bigintToNumber(record), 'Created', 201, { table: [], search_data: [], permission });
    } catch (err: any) {
      console.error('Generic create error:', err);
      if (err.code === 'P2002') badRequest(res, 'Duplicate entry');
      else error(res, 'Failed to create', 500);
    }
  }

async update(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const id = String(req.params.id);
      const modelDelegate = this.getPrismaModel(model);
      const existing = await modelDelegate.findUnique({ where: { id: idParam(String(id)) } });
      if (!existing) { notFound(res, 'Record not found'); return; }
      const data = { ...req.body, updated_at: new Date() };
      const record = await modelDelegate.update({ where: { id: idParam(String(id)) }, data });
      success(res, bigintToNumber(record), 'Updated');
    } catch (err: any) {
      console.error('Generic update error:', err);
      if (err.code === 'P2025') notFound(res, 'Record not found');
      else error(res, 'Failed to update', 500);
    }
  }

  async destroy(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const id = String(req.params.id);
      const modelDelegate = this.getPrismaModel(model);
      const existing = await modelDelegate.findUnique({ where: { id: idParam(String(id)) } });
      if (!existing) { notFound(res, 'Record not found'); return; }
      await modelDelegate.update({ where: { id: idParam(String(id)) }, data: { deleted_at: new Date() } });
      success(res, null, 'Deleted');
    } catch (err: any) {
      console.error('Generic destroy error:', err);
      if (err.code === 'P2025') notFound(res, 'Record not found');
      else error(res, 'Failed to delete', 500);
    }
  }

  async restore(req: Request, res: Response): Promise<void> {
    try {
      const model = String(req.params.model);
      const id = String(req.params.id);
      const modelDelegate = this.getPrismaModel(model);
      const existing = await modelDelegate.findUnique({ where: { id: idParam(String(id)) } });
      if (!existing) { notFound(res, 'Record not found'); return; }
      await modelDelegate.update({ where: { id: idParam(String(id)) }, data: { deleted_at: null } });
      success(res, null, 'Restored');
    } catch (err: any) {
      console.error('Generic restore error:', err);
      if (err.code === 'P2025') notFound(res, 'Record not found');
      else error(res, 'Failed to restore', 500);
    }
  }
}

export const genericController = new GenericController();
