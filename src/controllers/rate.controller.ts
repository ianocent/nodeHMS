import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { dataSearch, applySearchField } from '../utils/search';
import { getStatusLabel } from '../utils/cmsConfig';
import { enqueueJob } from '../config/queue';
import { processSyncStaahAvailability } from '../queue/jobs/syncStaahAvailability';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const STATUS_ACTIVE = 1;
const MENU_ID = 86;
const MENU_ID_BAR = 87;

const STATUSES = [
  { value: 1, label: 'Active' },
  { value: 0, label: 'Inactive' },
];

// parity RateRate::formatTable (labels -> slug keys)
const GRID_FIELDS = ['one_adult', 'two_adult', 'extra_adult', 'extra_child', 'min_night', 'max_night', 'stop_arrival', 'stop_departure', 'stop_sell'];

const GRID_FIELD_TYPES: Record<string, string> = {
  stop_arrival: 'checkbox',
  stop_departure: 'checkbox',
  stop_sell: 'checkbox',
};

function gridFieldLabel(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function gridFieldType(field: string): string {
  return GRID_FIELD_TYPES[field] ?? 'number';
}

// parity RateRateController@index table: Dates row + room-type header (row 1, colspan=fields)
// + one column per roomType_field (row 2)
function buildGridTable(roomTypes: any[], fields: string[]): any[] {
  const table: any[] = [
    { label: 'Dates', key: 'date', type: 'none_date', customClass: 'w-nowwarp', rowspan: 2 },
  ];
  for (const rt of roomTypes) {
    table.push({ label: rt.name, row: 1, colspan: fields.length, type: 'none', is_search: false });
  }
  for (const rt of roomTypes) {
    for (const field of fields) {
      table.push({ label: gridFieldLabel(field), row: 2, key: `${Number(rt.id)}_${field}`, type: gridFieldType(field), is_search: false });
    }
  }
  return table;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Laravel RateConfigController store/update image persistence (:92-104/:147-160)
// — base64 data-URI -> STORAGE_PATH/rate-config/<name>-<ts>.<ext>; returns the
// stored relative path or null when the payload is not an image.
function saveRateConfigImage(name: string, dataUri: any): string | null {
  if (typeof dataUri !== 'string') return null;
  const m = dataUri.match(/^data:image\/(\w+);base64,(.*)$/);
  if (!m) return null;
  try {
    const fs = require('fs');
    const path = require('path');
    const ext = m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    const root = process.env.STORAGE_PATH || path.join(process.cwd(), 'storage');
    const dir = path.join(root, 'rate-config');
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${String(name).replace(/\s+/g, '-')}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(dir, fileName), buf);
    return `/rate-config/${fileName}`;
  } catch (e: any) {
    console.error('Rate config image save failed:', e?.message);
    return null;
  }
}

const RESTRICTION_FIELDS = ['stop_arrival', 'stop_departure', 'stop_sell', 'min_los'];

// ── Linked-rate cascade (Laravel RateRate::getRules/updateRate + getValueRate) ──

// Laravel app/Helpers/Global.php:600
function getValueRate(value: number, rateAmount: number, type: string | null | undefined): number {
  if (type === 'percentage') return value + (rateAmount / 100) * value;
  return rateAmount + value;
}

interface LinkedRule {
  roomTypeId: bigint;
  rateId: bigint;
  amount: number;
  type: string;
  offsetExtraAdult: number;
  offsetExtraChild: number;
}

// Laravel RateRate::getRules parity — walk model_has_rates (model_type Rate)
// recursively; each linked rate contributes its rate_link_listings rows as rules.
async function getLinkedRateRules(rateId: bigint): Promise<LinkedRule[]> {
  const rules: LinkedRule[] = [];
  let frontier: bigint[] = [rateId];
  const visited = new Set<string>([String(rateId)]);
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const links = await prisma.model_has_rates.findMany({
      where: { rate_id: { in: frontier }, model_type: 'App\\Models\\Rate', status: BigInt(1) },
    });
    if (!links.length) break;
    const linkedIds = links.map((l) => l.model_id);
    const activeLinked = await prisma.rates.findMany({
      where: { id: { in: linkedIds }, deleted_at: null, status: STATUS_ACTIVE },
      select: { id: true },
    });
    const listings = await prisma.rate_link_listings.findMany({
      where: { rate_id: { in: linkedIds }, deleted_at: null },
    });
    for (const ll of listings) {
      if (!ll.rate_id || !ll.room_type_id) continue;
      rules.push({
        roomTypeId: ll.room_type_id,
        rateId: ll.rate_id,
        amount: Number(ll.amount ?? 0),
        type: ll.type ?? 'flat',
        offsetExtraAdult: Number(ll.offsetExtraAdult ?? 0),
        offsetExtraChild: Number(ll.offsetExtraChild ?? 0),
      });
    }
    frontier = activeLinked.map((r) => r.id).filter((id) => !visited.has(String(id)));
    for (const id of frontier) visited.add(String(id));
  }
  return rules;
}

// Laravel RateRate::updateRate parity — recompute linked rates' grid values from
// the source write, preserving existing values when the field was not written.
async function applyLinkedRateCascade(
  sourceRateId: bigint,
  propertyId: bigint,
  userId: bigint | undefined,
  fieldsByRoomType: Map<number, Record<string, any>>,
  dates: Date[],
): Promise<void> {
  const rules = await getLinkedRateRules(sourceRateId);
  if (!rules.length) return;

  for (const rule of rules) {
    if (!rule.rateId || !rule.roomTypeId) continue;
    const src = fieldsByRoomType.get(Number(rule.roomTypeId)) ?? {};
    for (const date of dates) {
      const existing: any = await prisma.rate_rates.findUnique({
        where: {
          rate_rates_rate_id_room_type_id_date_key: {
            rate_id: rule.rateId,
            room_type_id: rule.roomTypeId,
            date,
          },
        } as any,
      });

      const pick = (field: string): number | undefined => {
        if (src[field] !== undefined && src[field] !== null) return Number(src[field]);
        if (existing && existing[field] !== undefined && existing[field] !== null) return Number(existing[field]);
        return undefined;
      };

      const data: any = {
        property_id: propertyId,
        status: STATUS_ACTIVE,
        updated_at: new Date(),
      };
      if (userId) data.updated_by = userId;

      // Laravel nfields defaults unset price fields to the existing row's value ?? 0.
      const oneAdult = pick('one_adult');
      const twoAdult = pick('two_adult');
      const extraAdult = pick('extra_adult');
      const extraChild = pick('extra_child');
      data.one_adult = oneAdult !== undefined ? getValueRate(oneAdult, rule.amount, rule.type) : (existing?.one_adult ?? 0);
      data.two_adult = twoAdult !== undefined ? getValueRate(twoAdult, rule.amount, rule.type) : (existing?.two_adult ?? 0);
      data.extra_adult = extraAdult !== undefined ? getValueRate(extraAdult, rule.offsetExtraAdult, rule.type) : (existing?.extra_adult ?? 0);
      data.extra_child = extraChild !== undefined ? getValueRate(extraChild, rule.offsetExtraChild, rule.type) : (existing?.extra_child ?? 0);

      await prisma.rate_rates.upsert({
        where: {
          rate_rates_rate_id_room_type_id_date_key: {
            rate_id: rule.rateId,
            room_type_id: rule.roomTypeId,
            date,
          },
        } as any,
        create: {
          ...data,
          rate_id: rule.rateId,
          room_type_id: rule.roomTypeId,
          date,
          created_by: userId,
          created_at: new Date(),
        },
        update: data,
      });
    }
  }
}

// Laravel RateRateController store/update reset both sync flags on the parent
// rate so the cron/dispatched jobs re-push prices to Booking Engine + STAAH.
async function resetRateSyncFlags(rateId: bigint): Promise<void> {
  try {
    await prisma.rates.update({ where: { id: rateId }, data: { sync_online: 0, sync_staah: false } });
  } catch {
    // rate row may not exist for exotic ids — ignore like Laravel would no-op
  }
}

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
    return out;
  }
  return val;
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().substring(0, 10);
}

function getDatesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getDayIndex(date: Date): number {
  return date.getDay(); // 0=Sun, 1=Mon, ...
}

function getDayName(date: Date): string {
  return DAY_NAMES[date.getDay()];
}

export class RateController {
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/rates
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const sort = req.query.sort as string || 'id';
      const order = req.query.order === 'desc' ? 'desc' : 'asc';
      const propertyId = req.user?.lastProperty;

      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null, module: 'rate' };

      if (propertyId) where.property_id = propertyId;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ];
      }

const allCodePosts = await prisma.code_posts.findMany({
        where: { deleted_at: null, status: STATUS_ACTIVE, ...(propertyId ? { property_id: propertyId } : {}) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const codePostById = new Map(allCodePosts.map((cp: any) => [cp.id, cp.name]));
      const codePostOptions = allCodePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name }));

      const table = [
        {
          label: 'Status',
          key: 'status',
          type: 'checkbox',
          options: [
            { value: 1, label: 'Active' },
            { value: 0, label: 'Inactive' },
          ],
          is_search: true,
        },
        { label: 'Rate Code', key: 'code', type: 'text', is_link: true, uri: '/rate-management/rate', is_search: true },
        { label: 'Name', key: 'name', type: 'text', is_search: true },
        { label: 'Description', key: 'description', type: 'text', is_search: true },
        { label: 'Start Date', key: 'start_date', type: 'date', is_search: true },
        { label: 'End Date', key: 'end_date', type: 'date', is_search: true },
        { label: 'Post Code', key: 'code_post_id', type: 'select', options: codePostOptions, is_search: true },
        { label: 'Post Code Extra Bed', key: 'code_post_extra_bed_id', type: 'select', options: codePostOptions, is_search: true },
      ];

      applySearchField(where, req, table);

      // Laravel RateController@index rate_id branch (:68-127): exclude the queried
      // rate and prepend a synthetic BAR row (id 0) built from the first active bar.
      const branchRateId = req.query.rate_id ? String(req.query.rate_id) : '';
      if (/^\d+$/.test(branchRateId)) {
        where.id = { not: BigInt(branchRateId) };
      }

      const [rates, total] = await Promise.all([
        prisma.rates.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.rates.count({ where }),
      ]);

      let syntheticBar: any = null;
      if (branchRateId) {
        const firstBar = await prisma.rates.findFirst({
          where: { module: 'bar', deleted_at: null, status: STATUS_ACTIVE },
          orderBy: { start_date: 'asc' },
          select: { start_date: true, end_date: true },
        });
        const bars = await prisma.rates.aggregate({
          where: { module: 'bar', deleted_at: null, status: STATUS_ACTIVE },
          _min: { start_date: true },
          _max: { end_date: true },
        });
        syntheticBar = {
          id: 0,
          name: 'BAR',
          code: 'BAR',
          description: 'BAR',
          rate_type: 'BAR',
          code_post_id: 'BAR',
          code_post_extra_bed_id: 'BAR',
          start_date: bars._min.start_date ?? firstBar?.start_date ?? null,
          end_date: bars._max.end_date ?? firstBar?.end_date ?? null,
          online: false,
          staah: false,
          print_rate: false,
          is_day_use: false,
          status: STATUS_ACTIVE,
        };
      }

      // Types: cancellation-reservation / company-type / comm-code (Laravel Rate::formatData() keys)
      const rateIds = rates.map(r => r.id);
      const modelTypes = await prisma.model_has_types.findMany({
        where: { model_id: { in: rateIds }, model_type: 'App\\Models\\Rate' },
        include: { types: { select: { id: true, name: true, group: true } } },
      });
      const typesByRate = new Map<bigint, any[]>();
      for (const mt of modelTypes) {
        if (!typesByRate.has(mt.model_id)) typesByRate.set(mt.model_id, []);
        typesByRate.get(mt.model_id)!.push(bigintToNumber(mt.types));
      }

      const permFlags = getPermissionFlags(req.user, MENU_ID);

      const formatted = rates.map((r: any) => {
        const rTypes = typesByRate.get(r.id) || [];
        const cancelation = rTypes.find((t: any) => t.group === 'cancellation-reservation');
        const companyType = rTypes.find((t: any) => t.group === 'company-type');
        const commCode = rTypes.find((t: any) => t.group === 'comm-code');
        return {
        id: Number(r.id),
        name: r.module == 'rate' ? r.name : 'BAR',
        description: r.description,
        rate_type: r.rate_type,
        online: r.online === 1,
        staah: r.staah === true,
        staah_ori: r.staah === true,
        print_rate: r.print_rate === 1,
        is_day_use: r.is_day_use === true,
        min_advance_booking: r.min_advance_booking,
        max_advance_booking: r.max_advance_booking,
        cancelation: cancelation ? { value: Number(cancelation.id), label: cancelation.name } : [],
        company_type: companyType ? { value: Number(companyType.id), label: companyType.name } : [],
        comm_code: commCode ? { value: Number(commCode.id), label: commCode.name } : [],
        code: r.code,
        contract_rate: { value: Number(r.id), label: r.code },
        code_color: [{ value: r.code, label: r.code }],
        is_color: true,
        sort_by_company: r.module == 'rate' ? 2 : 3,
        color: r.module == 'rate' ? 'bg-primary' : 'bg-secondary',
        companyProfile: [],
        start_date: r.start_date ? formatDate(r.start_date) : null,
        end_date: r.end_date ? formatDate(r.end_date) : null,
        term_condition: r.term_condition,
        cancellation_policy: r.cancellation_policy,
        notes: r.notes,
        code_post_id: {
          value: r.code_post_id ? Number(r.code_post_id) : null,
          label: codePostById.get(r.code_post_id) || '',
        },
        code_post_extra_bed_id: {
          value: r.code_post_extra_bed_id ? Number(r.code_post_extra_bed_id) : null,
          label: codePostById.get(r.code_post_extra_bed_id) || '',
        },
        sort: r.sort,
        status: getStatusLabel(r.status),
        created_at: r.created_at,
        updated_at: r.updated_at,
        is_view: permFlags.view,
        is_edit: permFlags.edit,
        is_need_approval: false,
        relation: { code_post: null, type: rTypes },
      }});

      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      // Synthetic BAR row goes on top (= Laravel push($newformat) + sortBy id, id 0 first).
      let finalRows: any[] = formatted;
      if (syntheticBar) {
        finalRows = [
          {
            ...syntheticBar,
            start_date: syntheticBar.start_date ? formatDate(syntheticBar.start_date) : null,
            end_date: syntheticBar.end_date ? formatDate(syntheticBar.end_date) : null,
            status: getStatusLabel(STATUS_ACTIVE),
            is_view: permFlags.view,
            is_edit: permFlags.edit,
            is_need_approval: false,
          },
          ...formatted,
        ];
      }

      success(res, bigintToNumber(finalRows), 'Success', 200, {
        table,
        permission,
        search_data: dataSearch(req, table) as any,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Rate list error:', err);
      error(res, 'Failed to fetch rates', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/rates/create
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const [roomTypes, codePosts, companyTypes, cancelations] = await Promise.all([
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'company-type' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'cancellation-reservation' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const master = {
        statuses: STATUSES,
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        code_posts: codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
        comm_codes: [],
        company_types: companyTypes.map((t: any) => ({ value: Number(t.id), label: t.name })),
        cancelations: cancelations.map((t: any) => ({ value: Number(t.id), label: t.name })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: GRID_FIELDS.map((f) => ({ value: f, label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
      };

      success(res, master, 'Success', 200, { master });
    } catch (err: any) {
      console.error('Rate create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/rates
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;
      const { name, code, start_date, end_date, code_post_id, description, rate_type, term_condition, cancellation_policy, notes, online, staah, min_advance_booking, max_advance_booking, minimum_rate, grouping, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];
      if (!code) errors.code = ['The code field is required.'];
      if (!code_post_id) errors.code_post_id = ['The code post id field is required.'];
      if (!start_date) errors.start_date = ['The start date field is required.'];
      if (!end_date) errors.end_date = ['The end date field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      // Laravel RateController@store (:233-260): dup-code pre-check (global)
      // + reserved-name guard WALK IN / HOUSE USE / COMPLIMENTARY.
      const dupCode = await prisma.rates.findFirst({ where: { code: String(code) } });
      if (dupCode) { badRequest(res, 'Code already exist'); return; }
      const RESERVED_NAMES = ['WALK IN', 'HOUSE USE', 'COMPLIMENTARY'];
      const incomingName = String(name).trim().toUpperCase();
      if (RESERVED_NAMES.includes(incomingName)) {
        const exists = await prisma.rates.findFirst({ where: { name: incomingName } });
        if (exists) { badRequest(res, `${incomingName} already exist`); return; }
      }

      const rate = await prisma.rates.create({
        data: {
          property_id: propertyId!,
          code_post_id: BigInt(code_post_id),
          name,
          code,
          start_date: new Date(start_date),
          end_date: new Date(end_date),
          description: description || null,
          rate_type: rate_type || null,
          term_condition: term_condition || null,
          cancellation_policy: cancellation_policy || null,
          notes: notes || null,
          online: online ? 1 : 0,
          staah: staah === true || staah === 'true' || staah === 1,
          sync_online: 0,
          sync_staah: staah === true || staah === 'true' || staah === 1,
          min_advance_booking: min_advance_booking || 0,
          max_advance_booking: max_advance_booking || 0,
          minimum_rate: minimum_rate || 0,
grouping: grouping || null,
          status: status === true || status === 1 || status === '1' || status === 'true' || status?.value === true || status?.value === 1 ? 1 : (status === false || status === 0 || status === '0' || status === 'false' || status?.value === false || status?.value === 0 ? 0 : (status ?? STATUS_ACTIVE)),
          created_by: userId,
        },
      });

      const created = await prisma.rates.findUnique({
        where: { id: rate.id },
        include: { code_posts: { select: { id: true, name: true } } },
      });

      success(res, bigintToNumber(created), 'Success', 200);
    } catch (err: any) {
      console.error('Rate store error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Rate code already exists');
      } else {
        error(res, 'Failed to create rate', 500);
      }
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/rates/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || !/^\d+$/.test(String(idParam))) { notFound(res, 'Rate not found'); return; }
      const id = BigInt(idParam);

      const rate = await prisma.rates.findUnique({
        where: { id },
        include: {
          code_posts: { select: { id: true, name: true } },
          rate_rates: {
            where: { deleted_at: null },
            select: { room_type_id: true },
            distinct: ['room_type_id'],
          },
        },
      });

      if (!rate || rate.deleted_at) {
        notFound(res, 'Rate not found');
        return;
      }

      const roomTypeIds = rate.rate_rates.map((rr) => rr.room_type_id);
      const roomTypes = roomTypeIds.length > 0
        ? await prisma.room_types.findMany({
            where: { id: { in: roomTypeIds }, deleted_at: null },
            select: { id: true, name: true },
          })
        : [];

      const result = {
        ...rate,
        id: Number(rate.id),
        property_id: Number(rate.property_id),
        code_post_id: Number(rate.code_post_id),
        minimum_rate: Number(rate.minimum_rate),
        start_date: rate.start_date ? formatDate(rate.start_date) : null,
        end_date: rate.end_date ? formatDate(rate.end_date) : null,
        code_post: rate.code_posts ? { id: Number(rate.code_posts.id), name: rate.code_posts.name } : null,
        code_posts: undefined,
        rate_rates: undefined,
        room_types: roomTypes.map((rt: any) => ({ id: Number(rt.id), name: rt.name })),
      };

      success(res, result, 'Success');
    } catch (err: any) {
      console.error('Rate show error:', err);
      error(res, 'Failed to fetch rate', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/rates/:id/edit
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
static async edit(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const [rate, roomTypes, codePosts, companyTypes, cancelations] = await Promise.all([
        prisma.rates.findUnique({
          where: { id },
          include: { code_posts: { select: { id: true, name: true } } },
        }),
prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'company-type' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
        prisma.types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, group: 'cancellation-reservation' },
          select: { id: true, name: true },
          orderBy: { sort: 'asc' },
        }),
      ]);

      if (!rate || rate.deleted_at) {
        notFound(res, 'Rate not found');
        return;
      }

      const master = {
        statuses: STATUSES,
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        code_posts: codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
        comm_codes: [],
        company_types: companyTypes.map((t: any) => ({ value: Number(t.id), label: t.name })),
        cancelations: cancelations.map((t: any) => ({ value: Number(t.id), label: t.name })),
      };

      const result = {
        ...rate,
        id: Number(rate.id),
        property_id: Number(rate.property_id),
        code_post_id: Number(rate.code_post_id),
        code_post_extra_bed_id: rate.code_post_extra_bed_id ? Number(rate.code_post_extra_bed_id) : null,
        minimum_rate: Number(rate.minimum_rate),
        start_date: rate.start_date ? formatDate(rate.start_date) : null,
        end_date: rate.end_date ? formatDate(rate.end_date) : null,
        created_by: rate.created_by ? Number(rate.created_by) : null,
        updated_by: rate.updated_by ? Number(rate.updated_by) : null,
        deleted_by: rate.deleted_by ? Number(rate.deleted_by) : null,
        code_post: rate.code_posts ? { id: Number(rate.code_posts.id), name: rate.code_posts.name } : null,
        code_posts: undefined,
      };

      success(res, result, 'Success', 200, { master });
    } catch (err: any) {
      console.error('Rate edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /api/rates/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rates.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Rate not found');
        return;
      }

      const { name, code, start_date, end_date, code_post_id, code_post_extra_bed_id, description, rate_type, term_condition, cancellation_policy, notes, online, staah, min_advance_booking, max_advance_booking, minimum_rate, grouping, status } = req.body;

      // Laravel RateController@update (:380-541) is a partial PUT: absent optional
      // fields keep their stored values — never wiped to null/0.
      const data: any = {
        updated_by: userId,
        updated_at: new Date(),
      };
      if (description !== undefined) data.description = description || null;
      if (rate_type !== undefined) data.rate_type = rate_type || null;
      if (term_condition !== undefined) data.term_condition = term_condition || null;
      if (cancellation_policy !== undefined) data.cancellation_policy = cancellation_policy || null;
      if (notes !== undefined) data.notes = notes || null;
      if (online !== undefined) data.online = online ? 1 : 0;
      if (staah !== undefined) {
        const staahOn = staah === true || staah === 'true' || staah === 1;
        data.staah = staahOn;
        // Toggling STAAH re-enqueues content sync (Laravel resets the flag too).
        data.sync_staah = staahOn;
      }
      if (min_advance_booking !== undefined && min_advance_booking !== null && min_advance_booking !== '') data.min_advance_booking = Number(min_advance_booking) || 0;
      if (max_advance_booking !== undefined && max_advance_booking !== null && max_advance_booking !== '') data.max_advance_booking = Number(max_advance_booking) || 0;
      if (minimum_rate !== undefined && minimum_rate !== null && minimum_rate !== '') data.minimum_rate = Number(minimum_rate);
      if (grouping !== undefined) data.grouping = grouping || null;
      if (status !== undefined) {
        data.status = status === true || status === 1 || status === '1' || status === 'true' || status?.value === true || status?.value === 1 ? 1 : (status === false || status === 0 || status === '0' || status === 'false' || status?.value === false || status?.value === 0 ? 0 : existing.status);
      }
      if (name !== undefined && name !== null && name !== '') data.name = name;
      if (code !== undefined && code !== null && code !== '') data.code = code;
      if (code_post_id !== undefined && code_post_id !== null && code_post_id !== '') data.code_post_id = BigInt(code_post_id);
      if (code_post_extra_bed_id !== undefined && code_post_extra_bed_id !== null && code_post_extra_bed_id !== '') data.code_post_extra_bed_id = BigInt(code_post_extra_bed_id);
      if (start_date !== undefined && start_date !== null && start_date !== '') data.start_date = new Date(start_date);
      if (end_date !== undefined && end_date !== null && end_date !== '') data.end_date = new Date(end_date);

      await prisma.rates.update({ where: { id }, data });

      const updated = await prisma.rates.findUnique({
        where: { id },
        include: { code_posts: { select: { id: true, name: true } } },
      });

      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Rate update error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Rate code already exists');
      } else {
        error(res, 'Failed to update rate', 500);
      }
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // DELETE /api/rates/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const rate = await prisma.rates.findUnique({ where: { id } });
      if (!rate) {
        notFound(res, 'Rate not found');
        return;
      }

      await prisma.rates.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate destroy error:', err);
      error(res, 'Failed to delete rate', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/rates/:id/restore
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);

      const rate = await prisma.rates.findUnique({ where: { id } });
      if (!rate) {
        notFound(res, 'Rate not found');
        return;
      }

      await prisma.rates.update({
        where: { id },
        data: { deleted_at: null, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate restore error:', err);
      error(res, 'Failed to restore rate', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/rates/:rateId/grid
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async rateGrid(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;

      const startDateStr = req.query.start_date as string;
      const endDateStr = req.query.end_date as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      // Filter params: days_0..days_6, room_type_X, fields_X
      const dayFilter: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (req.query[`days_${i}`] === '1' || req.query[`days_${i}`] === 'true') {
          dayFilter.push(i);
        }
      }

      const roomTypeFilter: bigint[] = [];
      for (const key of Object.keys(req.query)) {
        if (key.startsWith('room_type_')) {
          const val = req.query[key];
          if (val === '1' || val === 'true') {
            const rtId = BigInt(key.replace('room_type_', ''));
            roomTypeFilter.push(rtId);
          }
        }
      }

      const fieldFilter: string[] = [];
      for (const key of Object.keys(req.query)) {
        if (key.startsWith('fields_')) {
          const val = req.query[key];
          if (val === '1' || val === 'true') {
            fieldFilter.push(key.replace('fields_', ''));
          }
        }
      }

      // Determine date range
      if (!startDateStr || !endDateStr) {
        success(res, [], 'Success', 200, { table: [], master: {}, pagination: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } });
        return;
      }

      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      const allDates = getDatesInRange(startDate, endDate);

      // Filter dates by day of week
      let filteredDates = allDates;
      if (dayFilter.length > 0) {
        filteredDates = allDates.filter((d) => dayFilter.includes(d.getDay()));
      }

      // Get all room types for this property
      const allRoomTypes = await prisma.room_types.findMany({
        where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
        orderBy: { name: 'asc' },
      });

      let targetRoomTypes = allRoomTypes;
      if (roomTypeFilter.length > 0) {
        targetRoomTypes = allRoomTypes.filter((rt) => roomTypeFilter.includes(rt.id));
      }

      const selectedFields = fieldFilter.length > 0 ? fieldFilter : GRID_FIELDS;

      // Pagination on dates
      const totalDates = filteredDates.length;
      const paginatedDates = filteredDates.slice((page - 1) * limit, page * limit);

      // Query rate_rates for these dates + room types
      const roomTypeIds = targetRoomTypes.map((rt) => rt.id);
      const dateStrs = paginatedDates.map((d) => new Date(formatDate(d)));

      const whereRateRates: any = {
        rate_id: rateId,
        property_id: propertyId,
        deleted_at: null,
        date: { in: dateStrs },
      };
      if (roomTypeIds.length > 0) {
        whereRateRates.room_type_id = { in: roomTypeIds };
      }

      const rateRates = await prisma.rate_rates.findMany({
        where: whereRateRates,
        orderBy: [{ date: 'asc' }, { room_type_id: 'asc' }],
      });

      // Build data rows: one per date, columns = roomType_field combinations
      const rows = paginatedDates.map((date) => {
        const dateStr = formatDate(date);
        const row: any = {
          date: dateStr,
          day_name: getDayName(date),
        };

        for (const rt of targetRoomTypes) {
          for (const field of selectedFields) {
            const colKey = `${Number(rt.id)}_${field}`;
            const match = rateRates.find(
              (rr) => formatDate(rr.date) === dateStr && rr.room_type_id === rt.id
            );
            row[colKey] = match
              ? (gridFieldType(field) === 'checkbox'
                  ? !!Number((match as any)[field] ?? 0)
                  : Number((match as any)[field] ?? 0))
              : '-';
            if (match) row.id = Number(match.id);
          }
        }

        return row;
      });

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      const master = {
        room_types: targetRoomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name, min_rate: Number(rt.min_rate) })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: GRID_FIELDS.map((f) => ({ value: f, label: gridFieldLabel(f) })),
      };

      success(res, rows, 'Success', 200, {
        permission,
        master,
        table: buildGridTable(targetRoomTypes, selectedFields),
        pagination: {
          current_page: page,
          last_page: Math.ceil(totalDates / limit),
          per_page: limit,
          total: totalDates,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, totalDates),
        },
      });
    } catch (err: any) {
      console.error('Rate grid error:', err);
      error(res, 'Failed to fetch rate grid', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/rates/:rateId/grid
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async rateGridStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { start_date, end_date, text_fields = [] } = req.body;

      if (!start_date || !end_date) {
        badRequest(res, 'start_date and end_date are required');
        return;
      }

      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      const allDates = getDatesInRange(startDate, endDate);

      // Parse day/roomType/field filters from request
      const dayFilter: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (req.body[`days_${i}`] === 1 || req.body[`days_${i}`] === '1' || req.body[`days_${i}`] === true) {
          dayFilter.push(i);
        }
      }

      const roomTypeFilter: bigint[] = [];
      for (const key of Object.keys(req.body)) {
        if (key.startsWith('room_type_')) {
          const val = req.body[key];
          if (val === 1 || val === '1' || val === true) {
            const rtId = BigInt(key.replace('room_type_', ''));
            roomTypeFilter.push(rtId);
          }
        }
      }

      // Filter dates by day
      let targetDates = allDates;
      if (dayFilter.length > 0) {
        targetDates = allDates.filter((d) => dayFilter.includes(d.getDay()));
      }

      // Determine target room types
      let targetRoomTypes = roomTypeFilter;
      if (targetRoomTypes.length === 0) {
        const allRT = await prisma.room_types.findMany({
          where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, min_rate: true },
        });
        targetRoomTypes = allRT.map((rt) => rt.id);
      }

      // Laravel resets both sync flags BEFORE writing grid values
      // (RateRateController.php store :283) so jobs re-push prices afterwards.
      await resetRateSyncFlags(rateId);

      // Existing rows — Laravel preserves stored values for fields not written (:341-377).
      const existingRows = await prisma.rate_rates.findMany({
        where: {
          rate_id: rateId,
          room_type_id: { in: targetRoomTypes },
          date: { gte: targetDates[0], lte: targetDates[targetDates.length - 1] },
        },
      });
      const existingKey = new Map<string, any>();
      for (const row of existingRows) {
        existingKey.set(`${Number(row.room_type_id)}|${formatDate(row.date)}`, row);
      }

      // Process text_fields: array of { room_type_id, one_adult, two_adult, etc. }
      const fieldsByRoomType = new Map<number, Record<string, any>>();
      for (const date of targetDates) {
        for (const rtId of targetRoomTypes) {
          // Find matching text_field entry for this room_type, or use defaults
          let fieldData: any = {};
          if (text_fields && text_fields.length > 0) {
            const match = text_fields.find((tf: any) => {
              const tfRtId = typeof tf.room_type_id === 'bigint' ? tf.room_type_id : BigInt(tf.room_type_id);
              return tfRtId === rtId;
            });
            if (match) {
              fieldData = match;
            }
          }

          // If no text_fields match, apply common values from body
          for (const field of GRID_FIELDS) {
            if (fieldData[field] === undefined && req.body[field] !== undefined) {
              fieldData[field] = req.body[field];
            }
          }

          // Laravel parity: unset fields keep the EXISTING stored value (?? 0 only on insert).
          const existing: any = existingKey.get(`${Number(rtId)}|${formatDate(date)}`);
          const preserved: Record<string, any> = { ...fieldData };
          for (const field of GRID_FIELDS) {
            if (preserved[field] === undefined) {
              const val = existing?.[field];
              preserved[field] = val !== undefined && val !== null ? Number(val) : 0;
            }
          }
          fieldsByRoomType.set(Number(rtId), preserved);

          await prisma.rate_rates.upsert({
            where: {
              rate_rates_rate_id_room_type_id_date_key: {
                rate_id: rateId,
                room_type_id: rtId,
                date: date,
              },
            } as any,
            create: {
              property_id: propertyId!,
              rate_id: rateId,
              room_type_id: rtId,
              date: date,
              one_adult: preserved.one_adult ?? 0,
              two_adult: preserved.two_adult ?? 0,
              extra_adult: preserved.extra_adult ?? 0,
              extra_child: preserved.extra_child ?? 0,
              min_night: preserved.min_night ?? 0,
              max_night: preserved.max_night ?? 0,
              status: STATUS_ACTIVE,
              created_by: userId,
            },
            update: {
              one_adult: preserved.one_adult ?? 0,
              two_adult: preserved.two_adult ?? 0,
              extra_adult: preserved.extra_adult ?? 0,
              extra_child: preserved.extra_child ?? 0,
              min_night: preserved.min_night ?? 0,
              max_night: preserved.max_night ?? 0,
              status: STATUS_ACTIVE,
              updated_by: userId,
              updated_at: new Date(),
            },
          });
        }
      }

      // Laravel RateRateController store: cascade to linked rates then dispatch BE push (:386-382)
      await applyLinkedRateCascade(rateId, propertyId!, userId, fieldsByRoomType, targetDates);
      enqueueJob('sync-price-booking-engine', {});

      success(res, { updated: targetDates.length * targetRoomTypes.length }, 'Success');
    } catch (err: any) {
      console.error('Rate grid store error:', err);
      error(res, 'Failed to save rate grid', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /api/rates/:rateId/grid
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async rateGridUpdate(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { date, room_type_id, ...fields } = req.body;

      if (!date || !room_type_id) {
        badRequest(res, 'date and room_type_id are required');
        return;
      }

      const targetDate = new Date(date);
      const targetRoomTypeId = BigInt(room_type_id);

      // Build update data from allowed fields
      const updateData: any = {
        property_id: propertyId!,
        rate_id: rateId,
        room_type_id: targetRoomTypeId,
        date: targetDate,
        updated_by: userId,
        updated_at: new Date(),
        status: STATUS_ACTIVE,
      };

      for (const field of GRID_FIELDS) {
        if (fields[field] !== undefined) {
          updateData[field] = fields[field];
        }
      }
      for (const field of RESTRICTION_FIELDS) {
        if (fields[field] !== undefined) {
          updateData[field] = fields[field];
        }
      }

      await prisma.rate_rates.upsert({
        where: {
          rate_rates_rate_id_room_type_id_date_key: {
            rate_id: rateId,
            room_type_id: targetRoomTypeId,
            date: targetDate,
          },
        } as any,
        create: {
          ...updateData,
          created_by: userId,
        },
        update: updateData,
      });

      // Laravel RateRateController@update (:439-469): sync flags + cascade + BE dispatch
      await resetRateSyncFlags(rateId);
      const fieldsByRoomType = new Map<number, Record<string, any>>([[Number(targetRoomTypeId), fields]]);
      await applyLinkedRateCascade(rateId, propertyId!, userId, fieldsByRoomType, [targetDate]);
      enqueueJob('sync-price-booking-engine', {});

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate grid update error:', err);
      error(res, 'Failed to update rate grid', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/rates/:rateId/restrictions
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async rateGridRestriction(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const startDateStr = req.query.start_date as string;
      const endDateStr = req.query.end_date as string;

      const where: any = {
        rate_id: rateId,
        property_id: propertyId,
        deleted_at: null,
      };

      if (startDateStr && endDateStr) {
        where.date = { gte: new Date(startDateStr), lte: new Date(endDateStr) };
      }

      // Apply day filters
      const dayFilter: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (req.query[`days_${i}`] === '1' || req.query[`days_${i}`] === 'true') {
          dayFilter.push(i);
        }
      }

      // Apply room_type filters
      const roomTypeFilter: bigint[] = [];
      for (const key of Object.keys(req.query)) {
        if (key.startsWith('room_type_')) {
          if (req.query[key] === '1' || req.query[key] === 'true') {
            roomTypeFilter.push(BigInt(key.replace('room_type_', '')));
          }
        }
      }
      if (roomTypeFilter.length > 0) {
        where.room_type_id = { in: roomTypeFilter };
      }

      // We need to post-filter by day since SQL doesn't have day-of-week filter easily
      let rateRates = await prisma.rate_rates.findMany({
        where,
        orderBy: [{ date: 'asc' }, { room_type_id: 'asc' }],
        include: {
          room_types: { select: { name: true } },
        },
      });

      if (dayFilter.length > 0) {
        rateRates = rateRates.filter((rr) => dayFilter.includes(rr.date.getDay()));
      }

      const total = rateRates.length;
      const paginated = rateRates.slice((page - 1) * limit, page * limit);

      const formatted = paginated.map((rr: any) => ({
        id: Number(rr.id),
        date: formatDate(rr.date),
        day_name: getDayName(rr.date),
        room_type_id: Number(rr.room_type_id),
        room_type_name: rr.room_types?.name || '',
        stop_arrival: rr.stop_arrival,
        stop_departure: rr.stop_departure,
        stop_sell: rr.stop_sell,
        min_los: rr.min_los,
      }));

      const roomTypes = await prisma.room_types.findMany({
        where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
        select: { id: true, name: true },
      });

      const master = {
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: RESTRICTION_FIELDS.map((f) => ({ value: f, label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
      };

      success(res, bigintToNumber(formatted), 'Success', 200, {
        master,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Rate grid restriction error:', err);
      error(res, 'Failed to fetch restrictions', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/rates/:rateId/restrictions
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async rateGridRestrictionStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { start_date, end_date, room_type_ids = [], ...restrictions } = req.body;

      if (!start_date || !end_date) {
        badRequest(res, 'start_date and end_date are required');
        return;
      }

      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      const allDates = getDatesInRange(startDate, endDate);

      // Day filter
      const dayFilter: number[] = [];
      for (let i = 0; i < 7; i++) {
        if (req.body[`days_${i}`] === 1 || req.body[`days_${i}`] === '1' || req.body[`days_${i}`] === true) {
          dayFilter.push(i);
        }
      }
      let targetDates = allDates;
      if (dayFilter.length > 0) {
        targetDates = allDates.filter((d) => dayFilter.includes(d.getDay()));
      }

      let targetRoomTypeIds: bigint[];
      if (room_type_ids.length > 0) {
        targetRoomTypeIds = room_type_ids.map((id: any) => BigInt(id));
      } else {
        const allRT = await prisma.room_types.findMany({
          where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true },
        });
        targetRoomTypeIds = allRT.map((rt) => rt.id);
      }

      for (const date of targetDates) {
        for (const rtId of targetRoomTypeIds) {
          const updateData: any = {
            property_id: propertyId!,
            rate_id: rateId,
            room_type_id: rtId,
            date,
            updated_by: userId,
            updated_at: new Date(),
            status: STATUS_ACTIVE,
          };

          for (const field of RESTRICTION_FIELDS) {
            if (restrictions[field] !== undefined) {
              updateData[field] = restrictions[field];
            }
          }

          // Laravel restrictionStore writes restrictions only — no cascade/dispatch there.
          await prisma.rate_rates.upsert({
            where: {
              rate_rates_rate_id_room_type_id_date_key: {
                rate_id: rateId,
                room_type_id: rtId,
                date,
              },
            } as any,
            create: {
              ...updateData,
              created_by: userId,
            },
            update: updateData,
          });
        }
      }

      success(res, { updated: targetDates.length * targetRoomTypeIds.length }, 'Success');
    } catch (err: any) {
      console.error('Rate grid restriction store error:', err);
      error(res, 'Failed to save restrictions', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/bar-rates
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static emptyGrid(res: Response): void {
    success(res, [], 'Success', 200, { table: [], master: {}, pagination: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } });
  }

  static async barRateIndex(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const rateIdParam = req.query.rate_id as string;
      const startDateStr = req.query.start_date as string;
      const endDateStr = req.query.end_date as string;

      if (!rateIdParam || !/^\d+$/.test(rateIdParam)) {
        RateController.emptyGrid(res);
        return;
      }

      const rateId = BigInt(rateIdParam);

      const bar = await prisma.bars.findUnique({
        where: { id: rateId },
        select: { id: true, name: true },
      });

      if (!bar) {
        notFound(res, 'Bar is not found');
        return;
      }

      // Delegate to rateGrid logic
      const gridReq = {
        ...req,
        params: { rateId: rateIdParam },
        query: {
          ...req.query,
          start_date: startDateStr,
          end_date: endDateStr,
        },
        user: req.user,
      } as any;

      // We'll reuse the same grid logic but swap the context
      // For simplicity, return bar rate info + grid data
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!startDateStr || !endDateStr) {
        success(res, [], 'Success', 200, { table: [], master: {}, pagination: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } });
        return;
      }

      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      const allDates = getDatesInRange(startDate, endDate);
      const totalDates = allDates.length;
      const paginatedDates = allDates.slice((page - 1) * limit, page * limit);

      // Get room types for bar rates
      const allRoomTypes = await prisma.room_types.findMany({
        where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
        orderBy: { name: 'asc' },
      });

      const roomTypeIds = allRoomTypes.map((rt) => rt.id);
      const dateStrs = paginatedDates.map((d) => new Date(formatDate(d)));

      const rateRates = await prisma.rate_rates.findMany({
        where: {
          rate_id: rateId,
          property_id: propertyId!,
          deleted_at: null,
          date: { in: dateStrs },
          room_type_id: { in: roomTypeIds },
        },
        orderBy: [{ date: 'asc' }, { room_type_id: 'asc' }],
      });

      const rows = paginatedDates.map((date) => {
        const dateStr = formatDate(date);
        const row: any = {
          date: dateStr,
          day_name: getDayName(date),
        };

        for (const rt of allRoomTypes) {
          for (const field of GRID_FIELDS) {
            const colKey = `${Number(rt.id)}_${field}`;
            const match = rateRates.find(
              (rr) => formatDate(rr.date) === dateStr && rr.room_type_id === rt.id
            );
            row[colKey] = match
              ? (gridFieldType(field) === 'checkbox'
                  ? !!Number((match as any)[field] ?? 0)
                  : Number((match as any)[field] ?? 0))
              : '-';
            if (match) row.id = Number(match.id);
          }
        }

        return row;
      });

      const permFlags = getPermissionFlags(req.user, MENU_ID_BAR);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      const master = {
        room_types: allRoomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name, min_rate: Number(rt.min_rate) })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: GRID_FIELDS.map((f) => ({ value: f, label: gridFieldLabel(f) })),
        bar_info: {
          id: Number(bar.id),
          name: bar.name,
        },
      };

      success(res, rows, 'Success', 200, {
        permission,
        master,
        table: buildGridTable(allRoomTypes, GRID_FIELDS),
        pagination: {
          current_page: page,
          last_page: Math.ceil(totalDates / limit),
          per_page: limit,
          total: totalDates,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, totalDates),
        },
      });
    } catch (err: any) {
      console.error('Bar rate index error:', err);
      error(res, 'Failed to fetch bar rates', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/bar-rates/create
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async barRateCreate(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;

      const [roomTypes, codePosts, rates] = await Promise.all([
        prisma.room_types.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, ...(propertyId ? { property_id: propertyId } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.rates.findMany({
          where: { deleted_at: null, status: STATUS_ACTIVE, module: 'rate' },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const master = {
        statuses: STATUSES,
        room_types: roomTypes.map((rt: any) => ({ value: Number(rt.id), label: rt.name })),
        code_posts: codePosts.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
        rates: rates.map((r: any) => ({ value: Number(r.id), label: `${r.code} - ${r.name}` })),
        days: DAY_NAMES.map((d, i) => ({ value: i, label: d.charAt(0).toUpperCase() + d.slice(1) })),
        fields: GRID_FIELDS.map((f) => ({ value: f, label: f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
      };

      success(res, master, 'Success', 200, { master });
    } catch (err: any) {
      console.error('Bar rate create error:', err);
      error(res, 'Failed to load bar rate form data', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/bar-rates
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async barRateStore(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { rate_id, start_date, end_date, text_fields = [] } = req.body;

      if (!rate_id || !start_date || !end_date) {
        badRequest(res, 'rate_id, start_date, and end_date are required');
        return;
      }

      const rateId = BigInt(rate_id);
      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      const allDates = getDatesInRange(startDate, endDate);

      // Get all active room types
      const allRoomTypes = await prisma.room_types.findMany({
        where: { property_id: propertyId!, deleted_at: null, status: STATUS_ACTIVE },
        select: { id: true, min_rate: true },
      });
      const allRoomTypeIds = allRoomTypes.map((rt) => rt.id);

      // Laravel BarRateController@gridStore min-rate guard (:299-323):
      // first pass (no isMinimum) -> if any written value < room type min_rate,
      // answer {isMinimum:true}; the confirmed retry sends isMinimum and is rejected.
      const isMinimum = req.body.isMinimum;
      if (!isMinimum) {
        const priceValues: number[] = [];
        for (const tf of text_fields) {
          for (const field of ['one_adult', 'two_adult', 'extra_adult', 'extra_child']) {
            if (tf[field] !== undefined && tf[field] !== null && !['min_night', 'max_night'].includes(field)) {
              priceValues.push(Number(tf[field]));
            }
          }
        }
        const minValue = priceValues.length ? Math.min(...priceValues) : Infinity;
        for (const rt of allRoomTypes) {
          if (Number(rt.min_rate ?? 0) > minValue) {
            success(res, { isMinimum: true }, 'Success', 200);
            return;
          }
        }
      }
      if (isMinimum) {
        badRequest(res, 'Please check minimum rate');
        return;
      }

      // Existing rows — unset fields keep stored values (Laravel :330-377).
      const existingRows = await prisma.rate_rates.findMany({
        where: {
          rate_id: rateId,
          room_type_id: { in: allRoomTypeIds },
          date: { gte: allDates[0], lte: allDates[allDates.length - 1] },
        },
      });
      const existingKey = new Map<string, any>();
      for (const row of existingRows) {
        existingKey.set(`${Number(row.room_type_id)}|${formatDate(row.date)}`, row);
      }

      await resetRateSyncFlags(rateId);

      const fieldsByRoomType = new Map<number, Record<string, any>>();
      for (const date of allDates) {
        for (const rtId of allRoomTypeIds) {
          const fieldData: any = {};
          const match = text_fields.find((tf: any) => {
            const tfRtId = typeof tf.room_type_id === 'bigint' ? tf.room_type_id : BigInt(tf.room_type_id);
            return tfRtId === rtId;
          });
          if (match) {
            Object.assign(fieldData, match);
          }
          // Apply fallback from body
          for (const field of GRID_FIELDS) {
            if (fieldData[field] === undefined && req.body[field] !== undefined) {
              fieldData[field] = req.body[field];
            }
          }

          const existing: any = existingKey.get(`${Number(rtId)}|${formatDate(date)}`);
          const preserved: Record<string, any> = { ...fieldData };
          for (const field of GRID_FIELDS) {
            if (preserved[field] === undefined) {
              const val = existing?.[field];
              preserved[field] = val !== undefined && val !== null ? Number(val) : 0;
            }
          }
          fieldsByRoomType.set(Number(rtId), preserved);

          await prisma.rate_rates.upsert({
            where: {
              rate_rates_rate_id_room_type_id_date_key: {
                rate_id: rateId,
                room_type_id: rtId,
                date,
              },
            } as any,
            create: {
              property_id: propertyId!,
              rate_id: rateId,
              room_type_id: rtId,
              date,
              one_adult: preserved.one_adult ?? 0,
              two_adult: preserved.two_adult ?? 0,
              extra_adult: preserved.extra_adult ?? 0,
              extra_child: preserved.extra_child ?? 0,
              min_night: preserved.min_night ?? 0,
              max_night: preserved.max_night ?? 0,
              status: STATUS_ACTIVE,
              created_by: userId,
            },
            update: {
              one_adult: preserved.one_adult ?? 0,
              two_adult: preserved.two_adult ?? 0,
              extra_adult: preserved.extra_adult ?? 0,
              extra_child: preserved.extra_child ?? 0,
              min_night: preserved.min_night ?? 0,
              max_night: preserved.max_night ?? 0,
              status: STATUS_ACTIVE,
              updated_by: userId,
              updated_at: new Date(),
            },
          });
        }
      }

      // Laravel BarRateController@gridStore: cascade to linked rates then BE dispatch
      await applyLinkedRateCascade(rateId, propertyId!, userId, fieldsByRoomType, allDates);
      enqueueJob('sync-price-booking-engine', {});

      success(res, { updated: allDates.length * allRoomTypeIds.length }, 'Success');
    } catch (err: any) {
      console.error('Bar rate store error:', err);
      error(res, 'Failed to save bar rates', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /api/bar-rates
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async barRateUpdate(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { rate_id, date, room_type_id, ...fields } = req.body;

      if (!rate_id || !date || !room_type_id) {
        badRequest(res, 'rate_id, date, and room_type_id are required');
        return;
      }

      const rateId = BigInt(rate_id);
      const targetDate = new Date(date);
      const targetRoomTypeId = BigInt(room_type_id);

      const updateData: any = {
        property_id: propertyId!,
        rate_id: rateId,
        room_type_id: targetRoomTypeId,
        date: targetDate,
        updated_by: userId,
        updated_at: new Date(),
        status: STATUS_ACTIVE,
      };

      for (const field of GRID_FIELDS) {
        if (fields[field] !== undefined) {
          updateData[field] = fields[field];
        }
      }

      await prisma.rate_rates.upsert({
        where: {
          rate_rates_rate_id_room_type_id_date_key: {
            rate_id: rateId,
            room_type_id: targetRoomTypeId,
            date: targetDate,
          },
        } as any,
        create: {
          ...updateData,
          created_by: userId,
        },
        update: updateData,
      });

      // Laravel BarRateController@update parity: flags + cascade + BE dispatch
      await resetRateSyncFlags(rateId);
      const fieldsByRoomType = new Map<number, Record<string, any>>([[Number(targetRoomTypeId), fields]]);
      await applyLinkedRateCascade(rateId, propertyId!, userId, fieldsByRoomType, [targetDate]);
      enqueueJob('sync-price-booking-engine', {});

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Bar rate update error:', err);
      error(res, 'Failed to update bar rate', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/rates/:rateId/day-uses
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async dayUseList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = rateIdParam ? BigInt(rateIdParam) : undefined;
      const propertyId = req.user?.lastProperty;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const where: any = { deleted_at: null, property_id: propertyId };
      if (rateId) where.rate_id = rateId;
      if (search) {
        where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
      }

      const [items, total] = await Promise.all([
        prisma.rate_day_uses.findMany({
          where,
          orderBy: { sort: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.rate_day_uses.count({ where }),
      ]);

      const formatted = items.map((item: any) => ({
        ...item,
        id: Number(item.id),
        property_id: Number(item.property_id),
        rate_id: item.rate_id ? Number(item.rate_id) : null,
      }));

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Time', key: 'time', type: 'none', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, bigintToNumber(formatted), 'Success', 200, {
        table,
        permission,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Day use list error:', err);
      error(res, 'Failed to fetch day uses', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/rates/:rateId/day-uses
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async dayUseStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = rateIdParam ? BigInt(rateIdParam) : null;
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { name, time, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const item = await prisma.rate_day_uses.create({
        data: {
          property_id: propertyId!,
          rate_id: rateId,
          name,
time: time || 0,
          status: status === true || status === 1 || status === '1' || status === 'true' || status?.value === true || status?.value === 1 ? 1 : (status === false || status === 0 || status === '0' || status === 'false' || status?.value === false || status?.value === 0 ? 0 : (status ?? STATUS_ACTIVE)),
          created_by: userId,
        },
      });

      success(res, bigintToNumber(item), 'Success', 201);
    } catch (err: any) {
      console.error('Day use store error:', err);
      error(res, 'Failed to create day use', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /api/day-uses/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async dayUseUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rate_day_uses.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Day use not found');
        return;
      }

const { name, time, status } = req.body;

      const data: any = { updated_at: new Date(), updated_by: userId };
      if (name !== undefined) data.name = name;
      if (time !== undefined) data.time = time;
      if (status !== undefined) data.status = status === true || status === 1 || status === '1' || status === 'true' || status?.value === true || status?.value === 1 ? 1 : (status === false || status === 0 || status === '0' || status === 'false' || status?.value === false || status?.value === 0 ? 0 : status);

      await prisma.rate_day_uses.update({ where: { id }, data });

      const updated = await prisma.rate_day_uses.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Day use update error:', err);
      error(res, 'Failed to update day use', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // DELETE /api/day-uses/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async dayUseDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rate_day_uses.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Day use not found');
        return;
      }

      await prisma.rate_day_uses.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Day use destroy error:', err);
      error(res, 'Failed to delete day use', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // GET /api/rates/:rateId/configs
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async configList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const where: any = { deleted_at: null, property_id: propertyId!, rate_id: rateId };
      if (search) {
        where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
      }

      const [items, total] = await Promise.all([
        prisma.rate_configs.findMany({
          where,
          orderBy: { sort: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.rate_configs.count({ where }),
      ]);

      const formatted = items.map((item: any) => ({
        ...item,
        rate_id: Number(item.rate_id),
        property_id: Number(item.property_id),
      }));

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: true },
        { label: 'Description', key: 'description', type: 'none', is_search: false },
        { label: 'Status', key: 'status', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
        delete: req.user?.superUser || permFlags.delete,
      };

      success(res, bigintToNumber(formatted), 'Success', 200, {
        table,
        permission,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Rate config list error:', err);
      error(res, 'Failed to fetch rate configs', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // POST /api/rates/:rateId/configs
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async configStore(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.rateId) ? req.params.rateId[0] : req.params.rateId;
      const rateId = BigInt(rateIdParam);
      const propertyId = req.user?.lastProperty;
      const userId = req.user?.id;

      const { name, description, image, status } = req.body;

      const errors: Record<string, string[]> = {};
      if (!name) errors.name = ['The name field is required.'];

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      // Laravel RateConfigController@store (:92-104): base64 -> storage/rate-config.
      const imagePath = saveRateConfigImage(String(name), image);

      const item = await prisma.rate_configs.create({
        data: {
          property_id: propertyId!,
          rate_id: rateId,
          name,
          description: description || null,
          image: imagePath,
          status: status === true || status === 1 || status === '1' || status === 'true' || status?.value === true || status?.value === 1 ? 1 : (status === false || status === 0 || status === '0' || status === 'false' || status?.value === false || status?.value === 0 ? 0 : (status ?? STATUS_ACTIVE)),
          created_by: userId,
        },
      });

      success(res, bigintToNumber(item), 'Success', 201);
    } catch (err: any) {
      console.error('Rate config store error:', err);
      error(res, 'Failed to create rate config', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PUT /api/rate-configs/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async configUpdate(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rate_configs.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) {
        notFound(res, 'Rate config not found');
        return;
      }

const { name, description, image, status } = req.body;

      // Laravel RateConfigController@update (:147-160): new base64 -> save;
      // otherwise keep the stored path.
      const imagePath = /^data:image\//.test(String(image ?? ''))
        ? saveRateConfigImage(String(name ?? ''), image)
        : (existing as any).image;

      const data: any = { updated_at: new Date(), updated_by: userId };
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (image !== undefined) data.image = imagePath;
      if (status !== undefined) data.status = status === true || status === 1 || status === '1' || status === 'true' || status?.value === true || status?.value === 1 ? 1 : (status === false || status === 0 || status === '0' || status === 'false' || status?.value === false || status?.value === 0 ? 0 : status);

      await prisma.rate_configs.update({ where: { id }, data });

      const updated = await prisma.rate_configs.findUnique({ where: { id } });
      success(res, bigintToNumber(updated), 'Success');
    } catch (err: any) {
      console.error('Rate config update error:', err);
      error(res, 'Failed to update rate config', 500);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // DELETE /api/rate-configs/:id
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  static async configDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(idParam);
      const userId = req.user?.id;

      const existing = await prisma.rate_configs.findUnique({ where: { id } });
      if (!existing) {
        notFound(res, 'Rate config not found');
        return;
      }

      await prisma.rate_configs.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: userId, status: 0 },
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate config destroy error:', err);
      error(res, 'Failed to delete rate config', 500);
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Rate Link Listing (RateRelationController parity)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  private static getValueRate(value: number, amount: number | null | undefined, type: string | null | undefined): number {
    const v = Number(value || 0);
    const a = Number(amount || 0);
    if (type === 'percentage') return Math.round((v + (v * a) / 100) * 100) / 100;
    return Math.round((v + a) * 100) / 100;
  }

  private static async getRateLinkRows(rateId: bigint, statusFilter?: string): Promise<any[]> {
    const [links, rll] = await Promise.all([
      prisma.model_has_rates.findMany({ where: { model_id: rateId, model_type: 'App\\Models\\Rate' } }),
      prisma.rate_link_listings.findMany({ where: { rate_id: rateId, ...(statusFilter ? { status: statusFilter } : {}) } }),
    ]);
    const linkedRateIds = links.map(l => l.rate_id);
    const rateRates = linkedRateIds.length > 0
      ? await prisma.rate_rates.findMany({
          where: { rate_id: { in: linkedRateIds }, deleted_at: null },
          include: { room_types: { select: { id: true, name: true } } },
        })
      : [];

    const byRoomType = new Map<bigint, any>();
    for (const rr of rateRates) {
      if (!byRoomType.has(rr.room_type_id)) byRoomType.set(rr.room_type_id, rr);
    }

    return [...byRoomType.entries()].map(([rtId, rr]: any) => {
      const link = rll.find(l => l.room_type_id === rtId);
      return {
        id: Number(rtId),
        room_type: rr.room_types?.name || null,
        amount: link?.amount ?? 0,
        type: link?.type
          ? { value: link.type, label: link.type === 'percentage' ? 'Percentage' : 'Amount' }
          : { value: 'percentage', label: 'Percentage' },
        offsetAdult1: link?.offsetAdult1 ?? 0,
        offsetAdult2: link?.offsetAdult2 ?? 0,
        offsetExtraAdult: link?.offsetExtraAdult ?? 0,
        offsetExtraChild: link?.offsetExtraChild ?? 0,
      };
    });
  }

  static async rateLinkListing(req: Request, res: Response): Promise<void> {
    try {
      const rateIdRaw = String(req.query.rate_id ?? req.query.id ?? '');
      if (!/^\d+$/.test(rateIdRaw)) { success(res, [], 'Success', 200, { table: [], permission: { view: true, add: true, edit: true, delete: true }, pagination: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } }); return; }
      const rateId = BigInt(rateIdRaw);
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }
      const rows = await this.getRateLinkRows(rateId);
      const table = [
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Amount', key: 'amount', type: 'number', is_search: false },
        { label: 'Type', key: 'type', type: 'select', is_search: false, options: [
          { value: 'percentage', label: 'Percentage' },
          { value: 'flat', label: 'Amount' },
        ] },
        { label: 'Extra Adult', key: 'offsetExtraAdult', type: 'number', is_search: false },
        { label: 'Extra Child', key: 'offsetExtraChild', type: 'number', is_search: false },
        { label: 'Applied to', key: 'applied_to', type: 'select_multiple', is_search: false,
          options: rows.map(r => ({ value: r.id, label: r.room_type })) },
      ];
      const permission = { view: true, add: true, edit: true, delete: true };
      success(res, rows, 'Success', 200, {
        table, permission,
        pagination: {
          current_page: 1, last_page: 1, per_page: rows.length || 1, total: rows.length, from: 1, to: rows.length,
        },
      });
    } catch (err: any) {
      console.error('Rate link listing error:', err);
      error(res, 'Failed to load rate link listing', 500);
    }
  }

  static async rateLinkApplyList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdRaw = String(req.query.rate_id ?? req.query.id ?? '');
      if (!/^\d+$/.test(rateIdRaw)) { success(res, [], 'Success', 200, { table: [], permission: { view: true, add: true, edit: true, delete: true }, pagination: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } }); return; }
      const rateId = BigInt(rateIdRaw);
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }
      const rows = await this.getRateLinkRows(rateId, '1');
      const table = [
        { label: 'Room Type', key: 'room_type', type: 'none', is_search: false },
        { label: 'Amount', key: 'amount', type: 'number', is_search: false },
        { label: 'Extra Adult', key: 'offsetExtraAdult', type: 'number', is_search: false },
        { label: 'Extra Child', key: 'offsetExtraChild', type: 'number', is_search: false },
      ];
      success(res, rows, 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true, delete: true },
        pagination: {
          current_page: 1, last_page: 1, per_page: rows.length || 1, total: rows.length, from: 1, to: rows.length,
        },
      });
    } catch (err: any) {
      console.error('Rate link apply list error:', err);
      error(res, 'Failed to load rate link applied', 500);
    }
  }

  static async rateLinkUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const { rate_id, amount, type, offsetAdult1, offsetAdult2, offsetExtraAdult, offsetExtraChild, applied_to_ori } = req.body;
      if (!rate_id || !/^\d+$/.test(String(rate_id)) || !/^\d+$/.test(id)) { badRequest(res, 'rate_id and id are required'); return; }
      const rateId = BigInt(rate_id);
      const roomTypeIds: bigint[] = [BigInt(id)];
      if (Array.isArray(applied_to_ori)) {
        for (const at of applied_to_ori) {
          const v = at?.value ?? at;
          if (v && /^\d+$/.test(String(v))) roomTypeIds.push(BigInt(v));
        }
      }
      const userId = req.user?.id;
      for (const rtId of roomTypeIds) {
        const existing = await prisma.rate_link_listings.findFirst({
          where: { rate_id: rateId, room_type_id: rtId, status: '0' },
        });
        const data = {
          property_id: req.user?.lastProperty ?? null,
          amount: amount !== undefined ? Number(amount) : existing?.amount,
          type: type !== undefined ? type : existing?.type,
          offsetAdult1: offsetAdult1 !== undefined ? Number(offsetAdult1) : existing?.offsetAdult1,
          offsetAdult2: offsetAdult2 !== undefined ? Number(offsetAdult2) : existing?.offsetAdult2,
          offsetExtraAdult: offsetExtraAdult !== undefined ? Number(offsetExtraAdult) : existing?.offsetExtraAdult,
          offsetExtraChild: offsetExtraChild !== undefined ? Number(offsetExtraChild) : existing?.offsetExtraChild,
          status: '0',
          updated_at: new Date(),
          updated_by: userId,
        };
        if (existing) {
          await prisma.rate_link_listings.update({ where: { id: existing.id }, data });
        } else {
          await prisma.rate_link_listings.create({
            data: { rate_id: rateId, room_type_id: rtId, ...data, created_at: new Date(), created_by: userId },
          });
        }
      }
      success(res, { updated_room_types: roomTypeIds.map((r) => Number(r)) }, 'Success');
    } catch (err: any) {
      console.error('Rate link update error:', err);
      error(res, 'Failed to update rate link', 500);
    }
  }

  static async rateLinkStore(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.query.rate_id ?? req.body.rate_id ?? ''));
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }

      let idx: any[] = req.body.idx || [];
      if (!Array.isArray(idx)) idx = [idx];
      if (idx.includes(0)) {
        const bars = await prisma.rates.findMany({ where: { module: 'bar', deleted_at: null } });
        idx = bars.map(b => b.id);
      }
      const selectedIds = idx.filter((i: any) => /^\d+$/.test(String(i))).map((i: any) => BigInt(i));

      await prisma.model_has_rates.deleteMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate', status: 1 },
      });
      if (selectedIds.length > 0) {
        await prisma.model_has_rates.createMany({
          data: selectedIds.map(rid => ({
            rate_id: rid,
            model_type: 'App\\Models\\Rate',
            model_id: rateId,
            status: 1,
            temp_status: 1,
          })),
          skipDuplicates: true,
        });
      }
      await prisma.model_has_rates.updateMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
        data: { status: 0 },
      });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate link store error:', err);
      error(res, 'Failed to save rate links', 500);
    }
  }

  static async rateLinkApply(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.query.rate_id ?? ''));
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }

      await prisma.model_has_rates.deleteMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate', status: 1 },
      });
      await prisma.model_has_rates.updateMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
        data: { status: 1 },
      });
      const links = await prisma.model_has_rates.findMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
      });
      const linkedRateIds = links.map(l => l.rate_id);

      await prisma.rate_link_listings.deleteMany({ where: { rate_id: rateId, status: '1' } });
      await prisma.rate_link_listings.updateMany({ where: { rate_id: rateId }, data: { status: '1' } });
      const rll = await prisma.rate_link_listings.findMany({ where: { rate_id: rateId } });
      const roomTypeIds = rll.map(l => l.room_type_id).filter((x): x is bigint => x !== null);

      const existingRateRates = linkedRateIds.length > 0 && roomTypeIds.length > 0
        ? await prisma.rate_rates.findMany({
            where: { rate_id: { in: linkedRateIds }, room_type_id: { in: roomTypeIds }, deleted_at: null },
          })
        : [];

      if (roomTypeIds.length > 0) {
        await prisma.rate_rates.deleteMany({ where: { rate_id: rateId, room_type_id: { in: roomTypeIds } } });
      }

      const rows: any[] = [];
      const grouped = new Map<string, any[]>();
      for (const rr of existingRateRates) {
        const key = `${formatDate(rr.date)}|${rr.room_type_id}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(rr);
      }
      for (const [key, items] of grouped) {
        const [dateStr, rtIdStr] = key.split('|');
        const roomTypeId = BigInt(rtIdStr);
        const link = rll.find(l => l.room_type_id === roomTypeId);
        const sum = (f: string) => items.reduce((acc, it) => acc + Number(it[f] || 0), 0);
        const min = (f: string) => Math.min(...items.map(it => Number(it[f] || 0)));
        rows.push({
          rate_id: rateId,
          property_id: items[0].property_id,
          room_type_id: roomTypeId,
          date: new Date(dateStr),
          one_adult: this.getValueRate(sum('one_adult'), link?.amount, link?.type),
          two_adult: this.getValueRate(sum('two_adult'), link?.amount, link?.type),
          extra_adult: this.getValueRate(sum('extra_adult'), link?.offsetExtraAdult, link?.type),
          extra_child: this.getValueRate(sum('extra_child'), link?.offsetExtraChild, link?.type),
          min_night: sum('min_night'),
          max_night: sum('max_night'),
          stop_arrival: min('stop_arrival'),
          stop_departure: min('stop_departure'),
          stop_sell: min('stop_sell'),
          min_los: min('min_los'),
          status: 1,
          created_at: new Date(),
          updated_at: new Date(),
          created_by: req.user?.id,
        });
      }
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 500) {
          await prisma.rate_rates.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
        }
      }
      success(res, { applied: rows.length }, 'Success');
    } catch (err: any) {
      console.error('Rate link apply error:', err);
      error(res, 'Failed to apply rate links', 500);
    }
  }

  static async rateCompany(req: Request, res: Response): Promise<void> {
    try {
      const rateIdRaw = String(req.query.rate_id ?? req.query.id ?? '');
      if (!/^\d+$/.test(rateIdRaw)) { success(res, [], 'Success', 200, { table: [], permission: { view: true, add: true, edit: true, delete: true }, pagination: { current_page: 1, last_page: 1, per_page: 1, total: 0, from: 1, to: 0 } }); return; }
      const rateId = BigInt(rateIdRaw);
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const links = await prisma.model_has_company_profiles.findMany({
        // Laravel morph pivot: CompanyProfile::Rate() = morphedByMany(Rate, 'model',
        // 'model_has_company_profiles') — NOT model_has_rates (:590-682).
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
      });
      const companyIds = links.map(l => l.company_profile_id);
      const where: any = { id: { in: companyIds }, deleted_at: null };
      if (search) where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
      const [companies, total] = await Promise.all([
        prisma.company_profiles.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { id: 'asc' } }),
        prisma.company_profiles.count({ where }),
      ]);
      const table = [
        { label: 'Company', key: 'name', type: 'none', is_search: true },
        { label: 'Email', key: 'email', type: 'none', is_search: true },
        { label: 'Phone', key: 'mobile_phone', type: 'none', is_search: false },
        { label: 'Status', key: 'status_company', type: 'badge', is_search: false },
        { label: 'Action', key: 'action', type: 'action', is_search: false },
      ];
      success(res, bigintToNumber(companies), 'Success', 200, {
        table,
        permission: getPermissionFlags(req.user, MENU_ID),
        pagination: {
          current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total,
          from: (page - 1) * limit + 1, to: Math.min(page * limit, total),
        },
      });
    } catch (err: any) {
      console.error('Rate company list error:', err);
      error(res, 'Failed to load company applicable', 500);
    }
  }

  static async rateCompanyStore(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.body.rate_id ?? req.query.rate_id ?? ''));
      let idx: any[] = req.body.idx || [];
      if (!Array.isArray(idx)) idx = [idx];
      const selectedIds = idx.filter((i: any) => /^\d+$/.test(String(i))).map((i: any) => BigInt(i));
      // Laravel $rate->companyProfile()->sync($idx) (:641-647) — pivot
      // model_has_company_profiles (model_type Rate, model_id = rate id).
      await prisma.model_has_company_profiles.deleteMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
      });
      if (selectedIds.length > 0) {
        await prisma.model_has_company_profiles.createMany({
          data: selectedIds.map(cid => ({
            company_profile_id: cid,
            model_type: 'App\\Models\\Rate',
            model_id: rateId,
          })),
          skipDuplicates: true,
        });
      }
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate company store error:', err);
      error(res, 'Failed to save company applicable', 500);
    }
  }

  static async rateCompanyDelete(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.query.rate_id ?? req.body.rate_id ?? ''));
      const id = String(req.params.id);
      if (!/^\d+$/.test(id)) { notFound(res, 'Not found'); return; }
      // Laravel detach (:650-664)
      await prisma.model_has_company_profiles.deleteMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate', company_profile_id: BigInt(id) },
      });
      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Rate company delete error:', err);
      error(res, 'Failed to delete company applicable', 500);
    }
  }

  // ── RateRelationController::package parity (cms.php:801-803) ──
  // Pivot: $rate->package() = morphToMany(Package, 'model', 'model_has_packages').
  static async ratePackage(req: Request, res: Response): Promise<void> {
    try {
      const rateIdRaw = String(req.query.rate_id ?? '');
      if (!/^\d+$/.test(rateIdRaw)) { notFound(res, 'Rate is not found'); return; }
      const rateId = BigInt(rateIdRaw);
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const links = await prisma.model_has_packages.findMany({
        where: { model_id: rateId, model_type: 'App\\Models\\Rate' },
      });
      const packageIds = links.map((l) => l.package_id);
      const where: any = { id: { in: packageIds }, deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };
      const [data, total] = await Promise.all([
        prisma.packages.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { id: 'asc' } }),
        prisma.packages.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        permission: getPermissionFlags(req.user, MENU_ID),
        pagination: { current_page: page, last_page: Math.max(1, Math.ceil(total / limit)), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Rate package list error:', err); error(res, 'Failed to load packages', 500); }
  }

  static async ratePackageStore(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.body.rate_id ?? ''));
      let idx: any[] = req.body.idx || [];
      if (!Array.isArray(idx)) idx = [idx];
      const selectedIds = idx.filter((i: any) => /^\d+$/.test(String(i))).map((i: any) => BigInt(i));
      // Laravel $rate->package()->sync($idx) (:727-733)
      await prisma.model_has_packages.deleteMany({ where: { model_id: rateId, model_type: 'App\\Models\\Rate' } });
      if (selectedIds.length > 0) {
        await prisma.model_has_packages.createMany({
          data: selectedIds.map((pid) => ({ package_id: pid, model_type: 'App\\Models\\Rate', model_id: rateId })),
          skipDuplicates: true,
        });
      }
      success(res, null, 'Success');
    } catch (err: any) { console.error('Rate package store error:', err); error(res, 'Failed to save packages', 500); }
  }

  static async ratePackageDelete(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.query.rate_id ?? req.body.rate_id ?? ''));
      const id = String(req.params.id);
      if (!/^\d+$/.test(id)) { notFound(res, 'Not found'); return; }
      // Laravel $rate->package()->detach($id) (:743-760)
      await prisma.model_has_packages.deleteMany({ where: { model_id: rateId, model_type: 'App\\Models\\Rate', package_id: BigInt(id) } });
      success(res, null, 'Success');
    } catch (err: any) { console.error('Rate package delete error:', err); error(res, 'Failed to delete package', 500); }
  }

  // ── RateRelationController::codeItem parity (cms.php:805-808) ──
  // Pivot: $rate->codeItem() = morphToMany(CodeItem, 'model', 'model_has_code_items');
  // sales override lives on the pivot row itself.
  static async rateCodeItemList(req: Request, res: Response): Promise<void> {
    try {
      const rateIdRaw = String(req.query.rate_id ?? '');
      if (!/^\d+$/.test(rateIdRaw)) { notFound(res, 'Rate is not found'); return; }
      const rateId = BigInt(rateIdRaw);
      const rate = await prisma.rates.findUnique({ where: { id: rateId } });
      if (!rate || rate.deleted_at) { notFound(res, 'Rate is not found'); return; }
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;

      const pivots: any[] = await prisma.$queryRaw`
        SELECT code_item_id, sales FROM model_has_code_items
        WHERE model_type = ${'App\\Models\\Rate'} AND model_id = ${rateId}
      `;
      const itemIds = pivots.map((p) => p.code_item_id);
      const where: any = { id: { in: itemIds }, deleted_at: null };
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [items, total] = await Promise.all([
        prisma.code_items.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { id: 'asc' } }),
        prisma.code_items.count({ where }),
      ]);
      const salesByItem = new Map(pivots.map((p) => [Number(p.code_item_id), p.sales]));
      const data = items.map((it: any) => ({ ...it, sales: salesByItem.get(Number(it.id)) ?? it.sales }));

      const codePosts = await prisma.code_posts.findMany({
        where: { type: 'DEFAULT', status: STATUS_ACTIVE, deleted_at: null },
        select: { id: true, name: true },
      });
      const table = [
        { label: 'Code', key: 'code', type: 'none', is_search: false },
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        { label: 'Sales', key: 'sales', type: 'number', is_search: false },
        { label: 'Code Post', key: 'code_post_id', type: 'select', options: codePosts.map((c: any) => ({ value: Number(c.id), label: c.name })), is_search: false },
      ];
      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        permission: getPermissionFlags(req.user, MENU_ID),
        pagination: { current_page: page, last_page: Math.max(1, Math.ceil(total / limit)), per_page: limit, total, from: total ? (page - 1) * limit + 1 : 0, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Rate code item list error:', err); error(res, 'Failed to load code items', 500); }
  }

  static async rateCodeItemStore(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.body.rate_id ?? ''));
      let idx: any[] = req.body.idx || [];
      if (!Array.isArray(idx)) idx = [idx];

      for (const value of idx) {
        if (!/^\d+$/.test(String(value))) continue;
        const dup: any[] = await prisma.$queryRaw`
          SELECT code_item_id FROM model_has_code_items
          WHERE code_item_id = ${BigInt(value)} AND model_type = ${'App\\Models\\Rate'} AND model_id = ${rateId} LIMIT 1`;
        if (dup.length > 0) continue;

        const ci: any = await prisma.code_items.findUnique({ where: { id: BigInt(value) }, include: { code_posts: { select: { id: true } } } });
        // Laravel quirk preserved: code_post_id stores CodeItem->codePost->id here
        // (this controller uses the REAL relation, unlike storeAdditionalItem).
        await prisma.$executeRaw`
          INSERT INTO model_has_code_items
            (model_id, model_type, code_item_id, reason, sales, process_on, code_post_id, name, description)
          VALUES
            (${rateId}, ${'App\\Models\\Rate'}, ${BigInt(value)}, '',
             ${ci?.sales ?? null}, ${ci?.process_on ?? null},
             ${ci?.code_posts?.id ? Number(ci.code_posts.id) : Number(ci?.code_post_id ?? 0)},
             ${ci?.name ?? null}, ${ci?.description ?? null})
        `;
      }
      await prisma.rates.update({ where: { id: rateId }, data: { updated_at: new Date() } });
      success(res, null, 'Success');
    } catch (err: any) { console.error('Rate code item store error:', err); error(res, 'Failed to store code items', 500); }
  }

  static async rateCodeItemUpdate(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.body.rate_id ?? ''));
      const id = String(req.params.id);
      if (!/^\d+$/.test(id)) { notFound(res, 'Code Item is not found'); return; }
      await prisma.$executeRaw`
        UPDATE model_has_code_items SET sales = ${req.body.sales ?? null}
        WHERE code_item_id = ${BigInt(id)} AND model_type = ${'App\\Models\\Rate'} AND model_id = ${rateId}
      `;
      success(res, null, 'Success');
    } catch (err: any) { console.error('Rate code item update error:', err); error(res, 'Failed to update code item', 500); }
  }

  static async rateCodeItemDelete(req: Request, res: Response): Promise<void> {
    try {
      const rateId = BigInt(String(req.query.rate_id ?? req.body.rate_id ?? ''));
      const id = String(req.params.id);
      if (!/^\d+$/.test(id)) { notFound(res, 'Not found'); return; }
      // Laravel $rate->codeItem()->detach($id)
      await prisma.$executeRaw`
        DELETE FROM model_has_code_items
        WHERE code_item_id = ${BigInt(id)} AND model_type = ${'App\\Models\\Rate'} AND model_id = ${rateId}
      `;
      success(res, null, 'Success');
    } catch (err: any) { console.error('Rate code item delete error:', err); error(res, 'Failed to delete code item', 500); }
  }

  // ── RateController@delete force (cms.php:817) ──
  // Purge prices on Booking Engine (when configured) then hard-delete the rate.
  static async forceDelete(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(rateIdParam);
      const rate = await prisma.rates.findUnique({ where: { id } });
      if (!rate) { notFound(res, 'Not Found'); return; }

      const beUrl = process.env.BOOKING_ENGINE_URL;
      if (beUrl) {
        try {
          await fetch(`${beUrl}/webhook/delete-room-price-by-rate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ property_id: Number(rate.property_id), rate_id: Number(rate.id) }),
          });
        } catch (e: any) { console.error('BE price purge failed:', e?.message); }
      }

      await prisma.rates.delete({ where: { id } });
      success(res, null, 'Success');
    } catch (err: any) { console.error('Rate force delete error:', err); error(res, 'Failed to force delete rate', 500); }
  }

  // ── RateController@syncStaah (cms.php:1551) ──
  // Guards -> push rate plan (New→Overlay fallback) -> ARI push per calendar year
  // chunk (inline SyncStaahAvailability parity) -> mark sync_staah.
  static async syncStaah(req: Request, res: Response): Promise<void> {
    try {
      const rateIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(rateIdParam);
      const rate: any = await prisma.rates.findUnique({ where: { id } });
      if (!rate) { notFound(res, 'Not Found'); return; }
      if (!rate.staah) { badRequest(res, 'Rate ini belum diaktifkan untuk Staah'); return; }
      if (!rate.status) { badRequest(res, 'Rate ini tidak aktif'); return; }
      const hasRateRate = await prisma.rate_rates.count({ where: { rate_id: id } }) > 0;
      if (!hasRateRate) { badRequest(res, 'Rate ini belum punya data harga per kamar/tanggal'); return; }

      const staahService = new (await import('../services/staah.service')).StaahService();
      const mapping = await prisma.staah_rate_mappings.findFirst({ where: { rate_id: id, deleted_at: null } });
      const iface = mapping
        ? await prisma.staah_interfaces.findUnique({ where: { id: mapping.staah_interface_id } })
        : null;

      if (mapping && iface) {
        const base = {
          hotelid: iface.hotel_id,
          rateplanid: mapping.staah_rate_plan_id,
          mealplanid: mapping.meal_plan_id,
          name: rate.name,
          description: rate.description ?? undefined,
        };
        const action = mapping.last_sync_at ? 'Overlay' : 'New';
        try {
          await staahService.createUpdateDeleteRatePlan({ ...base, action });
        } catch (firstErr: any) {
          const msg = String(firstErr?.message ?? '');
          if (action === 'New' && msg.includes('already exists')) {
            await staahService.createUpdateDeleteRatePlan({ ...base, action: 'Overlay' });
          } else if (action === 'Overlay' && msg.includes('not exists')) {
            await staahService.createUpdateDeleteRatePlan({ ...base, action: 'New' });
          } else {
            throw firstErr;
          }
        }
      }

      // ARI push per calendar-year chunk starting today (skip past dates).
      const { processSyncStaahAvailability } = await import('../queue/jobs/syncStaahAvailability');
      const todayStr = formatDate(new Date());
      let periodStart = rate.start_date ? formatDate(new Date(rate.start_date)) : todayStr;
      const periodEnd = rate.end_date ? formatDate(new Date(rate.end_date)) : periodStart;
      if (periodStart < todayStr) periodStart = todayStr;

      if (periodStart <= periodEnd) {
        let yearCursorStart = `${periodStart.slice(0, 4)}-01-01`;
        while (yearCursorStart <= periodEnd) {
          const yearEnd = `${yearCursorStart.slice(0, 4)}-12-31`;
          const chunkFrom = yearCursorStart < periodStart ? periodStart : yearCursorStart;
          const chunkTo = yearEnd > periodEnd ? periodEnd : yearEnd;
          await processSyncStaahAvailability({ data: { propertyId: Number(rate.property_id), dateFrom: chunkFrom, dateTo: chunkTo, rateId: Number(rate.id) } });
          yearCursorStart = `${Number(yearCursorStart.slice(0, 4)) + 1}-01-01`;
        }
      }

      await prisma.rates.update({ where: { id: rate.id }, data: { sync_staah: true } });
      success(res, null, 'Rate & harga berhasil di-sync ke Staah');
    } catch (err: any) {
      console.error('Rate sync-staah error:', err);
      error(res, err?.message ?? 'Failed to sync rate to Staah', 500);
    }
  }
}

