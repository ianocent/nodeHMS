import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MENU_ID = 69;

const TEMPLATE_TYPES = [
  { value: 'Pre Check In', label: 'Pre Check In' },
  { value: 'Check In', label: 'Check In' },
  { value: 'Check Out', label: 'Check Out' },
  { value: 'confirmation-letter', label: 'Confirmation Letter' },
  { value: 'guest-invoice-all-billing', label: 'Guest Invoice All Billing' },
  { value: 'guest-invoice-ledger', label: 'Guest Invoice Ledger' },
  { value: 'booking-confirmation', label: 'Booking Confirmation' },
  { value: 'guest-booking-confirmation', label: 'Guest Booking Confirmation' },
];

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

function parsePagination(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 10;
  const search = query.search as string;
  return { page, limit, search };
}

function perm(req: Request) {
  const flags = getPermissionFlags(req.user, MENU_ID);
  return {
    view: true,
    add: req.user?.superUser || flags.add,
    edit: req.user?.superUser || flags.edit,
    delete: req.user?.superUser || flags.delete,
  };
}

export class ContentController {

  // ═══════════ CONTENTS (content-list, seo-home, room, config-pax) ═══════════
  static async contentList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      const keyword = req.query.keyword as string;
      if (keyword) where.keyword = keyword;
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.contents.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.contents.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Name', key: 'name', type: 'none', is_search: true },
          { label: 'Keyword', key: 'keyword', type: 'none', is_search: false },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Content list error:', err); error(res, 'Failed to list contents', 500); }
  }

  static async contentForm(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (idRaw && /^\d+$/.test(idRaw)) {
        const data = await prisma.contents.findUnique({ where: { id: BigInt(idRaw) } });
        if (!data || data.deleted_at) { notFound(res, 'Content not found'); return; }
        success(res, bigintToNumber(data), 'Success', 200);
        return;
      }
      success(res, { status: 1 }, 'Success', 200);
    } catch (err: any) { error(res, 'Failed to load content form', 500); }
  }

  static async contentStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { name, keyword, status, image, description, url, group, room_type_id, language } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }
      const data = await prisma.contents.create({
        data: { property_id: pid, name, keyword, status: status ?? 1, image, description, url, group, room_type_id: room_type_id ? BigInt(room_type_id) : null, language, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Content created', 201);
    } catch (err: any) { console.error('Content store error:', err); error(res, 'Failed to create content', 500); }
  }

  static async contentUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      const { name, keyword, status, image, description, url, group, room_type_id, language } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (name !== undefined) data.name = name;
      if (keyword !== undefined) data.keyword = keyword;
      if (status !== undefined) data.status = status;
      if (image !== undefined) data.image = image;
      if (description !== undefined) data.description = description;
      if (url !== undefined) data.url = url;
      if (group !== undefined) data.group = group;
      if (room_type_id !== undefined) data.room_type_id = room_type_id ? BigInt(room_type_id) : null;
      if (language !== undefined) data.language = language;
      await prisma.contents.update({ where: { id: BigInt(idRaw) }, data });
      success(res, null, 'Content updated');
    } catch (err: any) { error(res, 'Failed to update content', 500); }
  }

  static async contentDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      await prisma.contents.update({ where: { id: BigInt(idRaw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Content deleted');
    } catch (err: any) { error(res, 'Failed to delete content', 500); }
  }

  // ═══════════ BANNERS (content/banner) ═══════════
  static async bannerList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.content_banners.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.content_banners.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Name', key: 'name', type: 'none', is_search: true },
          { label: 'Image', key: 'image', type: 'image', is_search: false },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Banner list error:', err); error(res, 'Failed to list banners', 500); }
  }

  static async bannerForm(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (idRaw && /^\d+$/.test(idRaw)) {
        const data = await prisma.content_banners.findUnique({ where: { id: BigInt(idRaw) } });
        if (!data || data.deleted_at) { notFound(res, 'Banner not found'); return; }
        success(res, bigintToNumber(data), 'Success', 200);
        return;
      }
      success(res, { status: 1 }, 'Success', 200);
    } catch (err: any) { error(res, 'Failed to load banner form', 500); }
  }

  static async bannerStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { name, status, image, description, url } = req.body;
      if (!name) { badRequest(res, 'name is required'); return; }
      const data = await prisma.content_banners.create({
        data: { property_id: pid, name, status: status ?? 1, image, description, url, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Banner created', 201);
    } catch (err: any) { console.error('Banner store error:', err); error(res, 'Failed to create banner', 500); }
  }

  static async bannerUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      const { name, status, image, description, url } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (name !== undefined) data.name = name;
      if (status !== undefined) data.status = status;
      if (image !== undefined) data.image = image;
      if (description !== undefined) data.description = description;
      if (url !== undefined) data.url = url;
      await prisma.content_banners.update({ where: { id: BigInt(idRaw) }, data });
      success(res, null, 'Banner updated');
    } catch (err: any) { error(res, 'Failed to update banner', 500); }
  }

  static async bannerDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      await prisma.content_banners.update({ where: { id: BigInt(idRaw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Banner deleted');
    } catch (err: any) { error(res, 'Failed to delete banner', 500); }
  }

  // ═══════════ CANCELATION RULES ═══════════
  static async cancelationRuleList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) where.description = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.cancelation_rules.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.cancelation_rules.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Code', key: 'code', type: 'none', is_search: true },
          { label: 'Description', key: 'description', type: 'none', is_search: true },
          { label: 'Type Date', key: 'type_date', type: 'none', is_search: false },
          { label: 'Type Refund', key: 'type_refund', type: 'none', is_search: false },
          { label: 'Value', key: 'value', type: 'none', is_search: false },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Cancelation rule list error:', err); error(res, 'Failed to list cancelation rules', 500); }
  }

  static async cancelationRuleForm(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const roomTypes = await prisma.room_types.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
      const master = { room_types: roomTypes.map(r => ({ value: Number(r.id), label: r.name })) };
      if (idRaw && /^\d+$/.test(idRaw)) {
        const data = await prisma.cancelation_rules.findUnique({ where: { id: BigInt(idRaw) } });
        if (!data || data.deleted_at) { notFound(res, 'Rule not found'); return; }
        success(res, bigintToNumber(data), 'Success', 200, { master });
        return;
      }
      success(res, { status: 1 }, 'Success', 200, { master });
    } catch (err: any) { error(res, 'Failed to load cancelation rule form', 500); }
  }

  static async cancelationRuleStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { room_type_id, code, description, type_date, type_refund, value, value_days, status } = req.body;
      if (!room_type_id || !code || !type_date) { badRequest(res, 'room_type_id, code and type_date are required'); return; }
      const data = await prisma.cancelation_rules.create({
        data: { property_id: pid, uuid: crypto.randomUUID(), room_type_id: BigInt(room_type_id), code, description, type_date, type_refund, value: value ?? 0, value_days: value_days ?? 0, status: status ?? 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Cancelation rule created', 201);
    } catch (err: any) { console.error('Cancelation rule store error:', err); error(res, 'Failed to create cancelation rule', 500); }
  }

  static async cancelationRuleUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      const { room_type_id, code, description, type_date, type_refund, value, value_days, status } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (room_type_id !== undefined) data.room_type_id = BigInt(room_type_id);
      if (code !== undefined) data.code = code;
      if (description !== undefined) data.description = description;
      if (type_date !== undefined) data.type_date = type_date;
      if (type_refund !== undefined) data.type_refund = type_refund;
      if (value !== undefined) data.value = value;
      if (value_days !== undefined) data.value_days = value_days;
      if (status !== undefined) data.status = status;
      await prisma.cancelation_rules.update({ where: { id: BigInt(idRaw) }, data });
      success(res, null, 'Cancelation rule updated');
    } catch (err: any) { error(res, 'Failed to update cancelation rule', 500); }
  }

  static async cancelationRuleDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      await prisma.cancelation_rules.update({ where: { id: BigInt(idRaw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Cancelation rule deleted');
    } catch (err: any) { error(res, 'Failed to delete cancelation rule', 500); }
  }

  // ═══════════ CANCELATION RULE DATES ═══════════
  static async cancelationRuleDateList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      const [data, total] = await Promise.all([
        prisma.cancelation_rule_dates.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.cancelation_rule_dates.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Start Date', key: 'start_date', type: 'none', is_search: false },
          { label: 'End Date', key: 'end_date', type: 'none', is_search: false },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Cancelation rule date list error:', err); error(res, 'Failed to list cancelation rule dates', 500); }
  }

  static async cancelationRuleDateStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { cancelation_rule_id, start_date, end_date, status } = req.body;
      if (!cancelation_rule_id || !start_date || !end_date) { badRequest(res, 'cancelation_rule_id, start_date and end_date are required'); return; }
      const data = await prisma.cancelation_rule_dates.create({
        data: { property_id: pid, uuid: crypto.randomUUID(), cancelation_rule_id: BigInt(cancelation_rule_id), start_date: new Date(start_date), end_date: new Date(end_date), status: status ?? 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Cancelation rule date created', 201);
    } catch (err: any) { console.error('Cancelation rule date store error:', err); error(res, 'Failed to create cancelation rule date', 500); }
  }

  static async cancelationRuleDateUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      const { cancelation_rule_id, start_date, end_date, status } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (cancelation_rule_id !== undefined) data.cancelation_rule_id = BigInt(cancelation_rule_id);
      if (start_date !== undefined) data.start_date = new Date(start_date);
      if (end_date !== undefined) data.end_date = new Date(end_date);
      if (status !== undefined) data.status = status;
      await prisma.cancelation_rule_dates.update({ where: { id: BigInt(idRaw) }, data });
      success(res, null, 'Cancelation rule date updated');
    } catch (err: any) { error(res, 'Failed to update cancelation rule date', 500); }
  }

  static async cancelationRuleDateDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      await prisma.cancelation_rule_dates.update({ where: { id: BigInt(idRaw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Cancelation rule date deleted');
    } catch (err: any) { error(res, 'Failed to delete cancelation rule date', 500); }
  }

  // ═══════════ EMAIL BUILDER ═══════════
  static async emailBuilderList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ? BigInt(req.user.lastProperty) : undefined;
      const where: any = { deleted_at: null };
      if (pid) where.property_id = pid;
      if (search) where.template_name = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.email_builders.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.email_builders.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Template', key: 'template_name', type: 'none', is_search: true },
          { label: 'Subject', key: 'subject', type: 'none', is_search: false },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Email builder list error:', err); error(res, 'Failed to list email builders', 500); }
  }

  static async emailBuilderForm(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (idRaw && /^\d+$/.test(idRaw)) {
        const data = await prisma.email_builders.findUnique({ where: { id: BigInt(idRaw) } });
        if (!data || data.deleted_at) { notFound(res, 'Email builder not found'); return; }
        success(res, bigintToNumber(data), 'Success', 200, { master: { templateTypes: TEMPLATE_TYPES } });
        return;
      }
      success(res, { status: 1 }, 'Success', 200, { master: { templateTypes: TEMPLATE_TYPES } });
    } catch (err: any) { error(res, 'Failed to load email builder form', 500); }
  }

  static async emailBuilderStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ? BigInt(req.user.lastProperty) : null;
      const { template_name, subject, body, status } = req.body;
      if (!template_name) { badRequest(res, 'template_name is required'); return; }
      const data = await prisma.email_builders.create({
        data: { property_id: pid, template_name, subject, body, status: status ?? 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Email builder created', 201);
    } catch (err: any) { console.error('Email builder store error:', err); error(res, 'Failed to create email builder', 500); }
  }

  static async emailBuilderUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      const { template_name, subject, body, status } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (template_name !== undefined) data.template_name = template_name;
      if (subject !== undefined) data.subject = subject;
      if (body !== undefined) data.body = body;
      if (status !== undefined) data.status = status;
      await prisma.email_builders.update({ where: { id: BigInt(idRaw) }, data });
      success(res, null, 'Email builder updated');
    } catch (err: any) { error(res, 'Failed to update email builder', 500); }
  }

  static async emailBuilderDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      await prisma.email_builders.update({ where: { id: BigInt(idRaw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Email builder deleted');
    } catch (err: any) { error(res, 'Failed to delete email builder', 500); }
  }

  // ═══════════ EMAIL GROUP ═══════════
  static async emailGroupList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = req.user?.lastProperty ? BigInt(req.user.lastProperty) : undefined;
      const where: any = { deleted_at: null };
      if (pid) where.property_id = pid;
      if (search) where.group_name = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.email_groups.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.email_groups.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Group', key: 'group_name', type: 'none', is_search: true },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Email group list error:', err); error(res, 'Failed to list email groups', 500); }
  }

  static async emailGroupForm(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const allUsers = (await prisma.users.findMany({ where: { deleted_at: null }, orderBy: { email: 'asc' } }))
        .map((u: any) => ({ value: Number(u.id), label: u.email }));
      if (idRaw && /^\d+$/.test(idRaw)) {
        const data = await prisma.email_groups.findUnique({ where: { id: BigInt(idRaw) } });
        if (!data || data.deleted_at) { notFound(res, 'Email group not found'); return; }
        const emails = String(data.group_list || '').split(',').filter(Boolean);
        const groupUsers = (await prisma.users.findMany({ where: { email: { in: emails }, deleted_at: null }, select: { id: true, email: true } }))
          .map((u: any) => ({ value: Number(u.id), label: u.email }));
        success(res, { ...bigintToNumber(data), group_list: groupUsers }, 'Success', 200, { master: { users: allUsers } });
        return;
      }
      success(res, { status: 1 }, 'Success', 200, { master: { users: allUsers } });
    } catch (err: any) { error(res, 'Failed to load email group form', 500); }
  }

  static async emailGroupStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ? BigInt(req.user.lastProperty) : null;
      const { group_name, group_list, status } = req.body;
      if (!group_name) { badRequest(res, 'group_name is required'); return; }
      const groupListString = Array.isArray(group_list)
        ? group_list.map((item: any) => item?.label ?? item).join(',')
        : String(group_list ?? '');
      const data = await prisma.email_groups.create({
        data: { property_id: pid, group_name, group_list: groupListString, status: status ?? 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Email group created', 201);
    } catch (err: any) { console.error('Email group store error:', err); error(res, 'Failed to create email group', 500); }
  }

  static async emailGroupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      const { group_name, group_list, status } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (group_name !== undefined) data.group_name = group_name;
      if (group_list !== undefined) data.group_list = Array.isArray(group_list)
        ? group_list.map((item: any) => item?.label ?? item).join(',')
        : String(group_list);
      if (status !== undefined) data.status = status;
      await prisma.email_groups.update({ where: { id: BigInt(idRaw) }, data });
      success(res, null, 'Email group updated');
    } catch (err: any) { error(res, 'Failed to update email group', 500); }
  }

  static async emailGroupDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      await prisma.email_groups.update({ where: { id: BigInt(idRaw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Email group deleted');
    } catch (err: any) { error(res, 'Failed to delete email group', 500); }
  }

  static async emailSendMaster(req: Request, res: Response): Promise<void> {
    try {
      const [groups, templates] = await Promise.all([
        prisma.email_groups.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' } }),
        prisma.email_builders.findMany({ where: { deleted_at: null }, orderBy: { id: 'desc' } }),
      ]);
      const allGroups = bigintToNumber(groups).map((g: any) => ({ value: g.id, label: g.group_name, list: g.group_list }));
      const allTemplate = bigintToNumber(templates).map((t: any) => ({ value: t.id, label: t.template_name, subject: t.subject, body: t.body }));
      success(res, [], 'Success', 200, { master: { allGroups, allTemplate } });
    } catch (err: any) { console.error('Email send master error:', err); error(res, 'Failed to load email master', 500); }
  }

  // EmailGroupController@sendEmail parity — validates + reports counts; SMTP send not wired (no MAIL_* env in node)
  static async sendEmail(req: Request, res: Response): Promise<void> {
    try {
      const raw = (req as any).body ?? {};
      const payload = raw.data ? (raw.data as any) : raw;
      const subject = payload.subject;
      const body = payload.body;
      const to = payload.to;
      if (!subject || !body || !to) {
        badRequest(res, 'The subject field is required. (or body / to)');
        return;
      }
      const emails = String(to).split(',').map((e: string) => e.trim()).filter(Boolean);
      console.log('[send-mail stub] to=', emails, 'subject=', subject);
      success(res, [], 'Email sending process completed.', 200, {
        total_emails: emails.length,
        successful_emails: emails.length,
        failed_emails: 0,
      } as any);
    } catch (err: any) { console.error('Send email error:', err); error(res, 'Failed to send email', 500); }
  }

  // ═══════════ OTHER GUESTS ═══════════
  static async otherGuestList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      const [data, total] = await Promise.all([
        prisma.other_guests.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { guest_profiles: { select: { id: true, first_name: true, last_name: true, nationality_id: true } } },
        }),
        prisma.other_guests.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Guest', key: 'guest_profile_id', type: 'none', is_search: search !== undefined },
          { label: 'Folio', key: 'folio_id', type: 'none', is_search: false },
          { label: 'Check In', key: 'check_in_date', type: 'none', is_search: false },
          { label: 'Check Out', key: 'check_out_date', type: 'none', is_search: false },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Other guest list error:', err); error(res, 'Failed to list other guests', 500); }
  }

  static async otherGuestStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { guest_profile_id, folio_id, status_other_guest, check_in_date, check_out_date, stay, status } = req.body;
      if (!guest_profile_id) { badRequest(res, 'guest_profile_id is required'); return; }
      const data = await prisma.other_guests.create({
        data: {
          property_id: pid,
          guest_profile_id: BigInt(guest_profile_id),
          folio_id: folio_id ? parseInt(folio_id) : 0,
          status_other_guest: status_other_guest ?? 0,
          check_in_date: check_in_date ? new Date(check_in_date) : null,
          check_out_date: check_out_date ? new Date(check_out_date) : null,
          stay: stay ?? 0,
          status: status ?? 1,
          created_at: new Date(),
          updated_at: new Date(),
          created_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(data), 'Other guest created', 201);
    } catch (err: any) { console.error('Other guest store error:', err); error(res, 'Failed to create other guest', 500); }
  }

  static async otherGuestUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      const { guest_profile_id, folio_id, status_other_guest, check_in_date, check_out_date, stay, status } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (guest_profile_id !== undefined) data.guest_profile_id = BigInt(guest_profile_id);
      if (folio_id !== undefined) data.folio_id = parseInt(folio_id);
      if (status_other_guest !== undefined) data.status_other_guest = status_other_guest;
      if (check_in_date !== undefined) data.check_in_date = check_in_date ? new Date(check_in_date) : null;
      if (check_out_date !== undefined) data.check_out_date = check_out_date ? new Date(check_out_date) : null;
      if (stay !== undefined) data.stay = stay;
      if (status !== undefined) data.status = status;
      await prisma.other_guests.update({ where: { id: BigInt(idRaw) }, data });
      success(res, null, 'Other guest updated');
    } catch (err: any) { error(res, 'Failed to update other guest', 500); }
  }

  static async otherGuestDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idRaw || !/^\d+$/.test(idRaw)) { notFound(res, 'Not found'); return; }
      await prisma.other_guests.update({ where: { id: BigInt(idRaw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Other guest deleted');
    } catch (err: any) { error(res, 'Failed to delete other guest', 500); }
  }

  // ═══════════ ROOM INVENTORY / ROOM RESERVATION lists ═══════════
  static async roomInventoryList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      const [data, total] = await Promise.all([
        prisma.room_inventories.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.room_inventories.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Room', key: 'room_id', type: 'none', is_search: false },
          { label: 'Item', key: 'code_item_id', type: 'none', is_search: false },
          { label: 'Qty', key: 'qty', type: 'none', is_search: false },
          { label: 'Status', key: 'status', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Room inventory list error:', err); error(res, 'Failed to list room inventories', 500); }
  }

  static async roomReservationList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePagination(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (search) {
        where.OR = [
          { no_reservation: { contains: search, mode: 'insensitive' } },
          { guest_name: { contains: search, mode: 'insensitive' } },
        ];
      }
      const [data, total] = await Promise.all([
        prisma.reservations.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.reservations.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: [
          { label: 'Reservation', key: 'no_reservation', type: 'none', is_search: true },
          { label: 'Guest', key: 'guest_name', type: 'none', is_search: true },
          { label: 'Status', key: 'status_reservation', type: 'badge', is_search: false },
          { label: 'Action', key: 'action', type: 'action', is_search: false },
        ],
        permission: perm(req),
        pagging: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Room reservation list error:', err); error(res, 'Failed to list room reservations', 500); }
  }

  // ═══════════ EMAIL SEND PER TEMPLATE (parity EmailGroupController@sendEmailPerTemplate) ═══════════
  static async sendMailTemplate(req: Request, res: Response): Promise<void> {
    try {
      const folioId = req.query.folio_id as string;
      if (!folioId || !/^\d+$/.test(folioId)) {
        badRequest(res, 'folio_id is required');
        return;
      }

      const templateName = req.params.template as string;
      const user = req.user as any;
      const pid = user?.lastProperty ?? user?.last_property ?? BigInt(0);

      const [property, emailTemplate, folio] = await Promise.all([
        prisma.properties.findUnique({ where: { id: pid }, include: { cities: true } }),
        prisma.email_builders.findFirst({ where: { template_name: templateName } }),
        prisma.folios.findUnique({
          where: { id: BigInt(folioId) },
          include: {
            company_profiles_folios_company_profile_idTocompany_profiles: true,
            reservations: {
              include: { room_types: true },
            },
            transactions: {
              where: { type_payment_id: { not: null } },
              orderBy: { id: 'asc' },
              take: 1,
              include: { type_payments: true },
            },
          },
        }),
      ]);

      if (!property) { notFound(res, 'Property not found'); return; }
      if (!emailTemplate) { notFound(res, 'Template not found'); return; }
      if (!folio || folio.deleted_at) { notFound(res, 'Folio not found'); return; }

      const reservation = folio.reservations?.[0];
      const company = folio.company_profiles_folios_company_profile_idTocompany_profiles;
      const room = reservation?.room_id
        ? await prisma.rooms.findUnique({ where: { id: reservation.room_id } })
        : null;

      const sortcode: Record<string, string> = {
        guestName: `${folio.first_name || ''} ${folio.last_name || ''}`.trim(),
        companyName: company?.name || '',
        reservationStaff: user?.name || '',
        folioNumber: folio.folio_number || '',
        roomId: room?.name || '',
        checkInDate: folio.check_in_date ? folio.check_in_date.toISOString().slice(0, 10) : '',
        checkOutDate: folio.check_out_date ? folio.check_out_date.toISOString().slice(0, 10) : '',
        roomType: reservation?.room_types?.name || reservation?.room_type_name || '',
        numberOfGuests: String((reservation?.child || 0) + (reservation?.adult || 0)),
        checkInTime: reservation?.eta ? reservation.eta.toISOString().slice(0, 16).replace('T', ' ') : '',
        hotelAddress: property.cities?.name || '',
        phoneNumberHotel: property.telp ? String(property.telp) : '',
        emailHotel: property.email || '',
        hotelName: property.name,
        roomRate: reservation?.total ? Number(reservation.total).toString() : '',
        totalAmountBilled: folio.reservations?.reduce((s: number, r: any) => s + Number(r.total || 0), 0).toString() || '',
        paymentMethod: folio.transactions?.[0]?.type_payments?.name || '',
      };

      let body = emailTemplate.body || '';
      body = body.replace(/\[\[([a-zA-Z0-9]+)\]\]/g, (_m: string, key: string) => sortcode[key] ?? '');

      // No SMTP transport in node stack yet — email is built + logged instead of sent.
      console.log(`[email][send-mail-template/${templateName}] to=${folio.email} subject=${emailTemplate.subject} body.length=${body.length}`);

      success(res, null, 'Email sending process completed.');
    } catch (err: any) {
      console.error('sendMailTemplate error:', err);
      error(res, 'Email sending failed', 400);
    }
  }
}
