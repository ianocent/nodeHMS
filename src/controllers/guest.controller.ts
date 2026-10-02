import { prisma } from '../config/prisma';
import { Request, Response } from 'express';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { getStatusLabel } from '../utils/cmsConfig';
import { dataSearch } from '../utils/search';
import { activeWhere, applyStatusScope, pushCondition, safeOrderBy, searchPredicate } from '../utils/querySafety';
import {
  MANDATORY_FIELD_LABELS,
  mandatoryCheckInBlock,
  readPropertyMandatory,
} from '../utils/guestMandatory';
import { saveBase64Image, saveDocumentFromDataUri, storageRoot } from '../utils/storage';
import { TABLES } from '../utils/tableMeta';
import * as fs from 'fs';
import * as path from 'path';


// Static config values (from Laravel config/cms.php)
const STATUSES = [
  { id: 1, name: 'Active' },
  { id: 0, name: 'Inactive' }
];

const NRICS = [
  { name: 'NRIC' },
  { name: 'Passport' },
  { name: 'Other' }
];

const GENDERS = [
  { name: 'Male' },
  { name: 'Female' },
  { name: 'Other' }
];

const REGIONS = [
  { name: 'Asia' },
  { name: 'Europe' },
  { name: 'America' },
  { name: 'Africa' },
  { name: 'Oceania' }
];

function bigintToNumber(val: any): any {
    if (val instanceof Date) {
      const u = val.getUTCFullYear();
      const iso = val.toISOString();
      if (u === 1970 && val.getUTCMonth() === 0 && val.getUTCDate() === 1) return iso.slice(11, 19);
      const s = iso.slice(0, 19).replace('T', ' ');
      return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
    }
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

function idParamBig(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

function parsePaginationFn(query: any) {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 10;
  const search = query.search as string;
  const sort = query.sort as string || 'id';
  const order = query.order === 'desc' ? 'desc' : 'asc';
  return { page, limit, search, sort, order };
}

function paggingFn(total: number, limit: number, page: number) {
  const lastPage = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  return { current_page: page, last_page: lastPage, per_page: limit, total, from, to: Math.min(total, page * limit) };
}

// Laravel GuestProfile::calculateAge() parity (Carbon age = full years)
function ageOf(date: any): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export class GuestController {
  /**
   * GET /api/guests
   * List guests with pagination, search, sort
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const searchField = req.query.search_field as string;
      const searchValue = req.query.search_value as string;
      const status = req.query.status as string;
      const sort = req.query.sort as string || 'account';
      const order = req.query.order === 'desc' ? 'desc' : 'asc';
      const hasFolioId = req.query.folio_id || req.query.reservation;

      // Laravel GuestProfileController@index ignores trash param; always active scope
      const where: any = { deleted_at: null, property_id: BigInt(req.user?.lastProperty ?? 0) };
      applyStatusScope(where, req, 'guest_profiles');

      if (search) {
        where.OR = [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { account: { contains: search, mode: 'insensitive' } },
          { short_code: { contains: search, mode: 'insensitive' } },
          { telp: { contains: search, mode: 'insensitive' } },
          { mobile_phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ];
      }

      if (searchField && searchValue) {
        pushCondition(where, searchPredicate('guest_profiles', searchField, searchValue));
      }

      if (status) {
        where.status = parseInt(status);
      }

      if (hasFolioId) {
        where.status = 1;
      }

      const [guests, total] = await Promise.all([
        prisma.guest_profiles.findMany({
          where,
          orderBy: safeOrderBy('guest_profiles', sort, { account: order }),
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.guest_profiles.count({ where })
      ]);

      // Get nationalities + countries (Laravel relatedNationality/relatedCountry)
      const guestIds = guests.map(g => g.id);
      const nationalityIds = guests
        .filter(g => g.nationality_id)
        .map(g => g.nationality_id!);
      const countryIds = guests
        .filter((g: any) => g.country_id)
        .map((g: any) => g.country_id!);
      const allCountryIds = Array.from(new Set([...nationalityIds, ...countryIds]));
      const countries = allCountryIds.length > 0
        ? await prisma.countries.findMany({ where: { id: { in: allCountryIds as any } } })
        : [];
      const nationalityMap = new Map(countries.map(n => [n.id, n]));

      // Get cities (Laravel relatedCity)
      const cityIds = guests.filter(g => g.city_id).map(g => g.city_id!);
      const cities = cityIds.length > 0
        ? await prisma.cities.findMany({ where: { id: { in: cityIds as any } } })
        : [];
      const cityMap = new Map(cities.map(c => [c.id, c]));

      // Get types via model_has_types
      const types = await prisma.model_has_types.findMany({
        where: { model_id: { in: guestIds }, model_type: 'App\\Models\\GuestProfile' },
        include: { types: true }
      });
      const typesMap = new Map<bigint, any[]>();
      for (const t of types) {
        if (!typesMap.has(t.model_id)) typesMap.set(t.model_id, []);
        typesMap.get(t.model_id)!.push(t.types);
      }

      // Get folios
      const folios = await prisma.folios.findMany({
        where: { guest_profile_id: { in: guestIds } }
      });
      const foliosMap = new Map<bigint, any[]>();
      for (const f of folios) {
        if (f.guest_profile_id) {
          if (!foliosMap.has(f.guest_profile_id)) foliosMap.set(f.guest_profile_id, []);
          foliosMap.get(f.guest_profile_id)!.push(f);
        }
      }

      // Laravel GuestProfile::formatTable() parity (9 kolom)
      const table = [
        { label: 'Active', key: 'status', type: 'select', is_search: true },
        { label: 'Account No.', key: 'account', type: 'text', is_search: true },
        { label: 'Status', key: 'guest_status', type: 'select', is_search: true },
        { label: 'Name', key: 'name_combine', type: 'text', is_search: false },
        { label: 'Nationality', key: 'nationality_id', type: 'none', is_search: false },
        { label: 'Telephone', key: 'telp', type: 'text', is_search: true },
        { label: 'Mobile Phone', key: 'mobile_phone', type: 'text', is_search: true },
        { label: 'NRIC', key: 'card_type', type: 'select', is_search: true },
        { label: 'Card Number', key: 'card_number', type: 'text', is_search: true }
      ];

      const filteredTable = hasFolioId
        ? table.filter(t => t.key !== 'status')
        : table;

      const permFlags = getPermissionFlags(req.user, 82);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit
      };

      // Laravel GuestProfile::formatData() parity rows
      const rows = guests.map((g, idx) => {
        const gTypes = typesMap.get(g.id) || [];
        const gTitle = gTypes.find((t: any) => t.group === 'guest-title');
        const gStatus = gTypes.find((t: any) => t.group === 'guest-status');
        const nat = g.nationality_id ? nationalityMap.get(g.nationality_id as any) : null;
        const city = g.city_id ? cityMap.get(g.city_id as any) : null;
        const gFolios = foliosMap.get(g.id) || [];
        const stay = gFolios.filter((f: any) =>
          f.status_reservation === 1 &&
          (String(f.folio_number || '').startsWith('F') ||
            (f.type_reservation === 'git' && Number(f.parent) !== 0))
        ).length;
        const fullName = `${g.first_name || ''} ${g.last_name || ''}`.trim();
        return {
          id: Number(g.id),
          property_id: g.property_id ? Number(g.property_id) : null,
          guest_name: fullName,
          card_type: g.card_type ? { value: g.card_type, label: g.card_type } : [],
          stay,
          guest_stay: stay,
          card_number: g.card_number ?? ' ',
          card_expiry: g.card_expiry ?? ' ',
          email: g.email ?? ' ',
          status_profile: gStatus ? { value: Number(gStatus.id), label: gStatus.name } : [],
          guest_status: gStatus ? { value: Number(gStatus.id), label: gStatus.name } : [],
          gender: g.gender ? { value: g.gender, label: g.gender } : [],
          birth_of_date: g.birth_of_date ? new Date(g.birth_of_date).toISOString().slice(0, 10) : ' ',
          age: ageOf(g.birth_of_date),
          telp: g.telp ?? ' ',
          mobile_phone: g.mobile_phone ?? ' ',
          nationality_id: nat ? { value: Number(g.nationality_id), label: nat.name } : [],
          is_subscribe: !!g.is_subscribe,
          is_do_not_contact: !!g.is_subscribe,
          address: g.address ?? ' ',
          city_id: city ? { value: Number(g.city_id), label: city.name } : [],
          country_id: (g as any).country_id ? { value: Number((g as any).country_id), label: nat?.name ?? Number((g as any).country_id) } : [],
          postal_code: g.postal_code !== '' ? (g.postal_code ?? ' ') : ' ',
          account: g.account ?? ' ',
          short_code: g.short_code ?? ' ',
          first_name: g.first_name ?? ' ',
          last_name: g.last_name ?? ' ',
          guest_title: gTitle ? { value: Number(gTitle.id), label: gTitle.name } : [],
          title: gTitle ? { value: Number(gTitle.id), label: gTitle.name } : [],
          region: g.region ? { value: g.region, label: REGIONS.find(r => r.name === g.region)?.name ?? g.region } : [],
          nationality: nat ? nat.name : null,
          fax: g.fax ?? ' ',
          car_reg_number: g.car_reg_number ?? ' ',
          name_combine: `${gTitle ? gTitle.name + ' ' : ''}${fullName}`.trim(),
          image: g.image,
          created_at: g.created_at,
          updated_at: g.updated_at,
          deleted_at: g.deleted_at,
          updated_by: (g as any).updated_by ? Number((g as any).updated_by) : null,
          deleted_by: (g as any).deleted_by ? Number((g as any).deleted_by) : null,
          status: { value: !!g.status, label: getStatusLabel(g.status).label },
          blacklist: g.blacklist,
          no: (page - 1) * limit + idx + 1
        };
      });

      success(res, bigintToNumber(rows), 'Success', 200, {
        table: filteredTable,
        permission,
        search_data: dataSearch(req, table) as any,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total)
        }
      });
    } catch (err: any) {
      console.error('Guest list error:', err);
      error(res, 'Failed to fetch guests', 500);
    }
  }

  /**
   * GET /api/guests/create
   * Get master data for guest creation form
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      // Type lookups are property-scoped (Laravel Type uses the HasProperties
      // global scope), otherwise the status dropdown lists every property's rows
      // — including several near-duplicate "normal"/"NORMAL" entries.
      const tp = req.user?.lastProperty ?? 0;
      const [titles, statusGuest, blackList, countries, mandatory] = await Promise.all([
        prisma.types.findMany({ where: { group: 'guest-title', status: 1, deleted_at: null, property_id: tp }, select: { id: true, name: true } }),
        prisma.types.findMany({ where: { group: 'guest-status', status: 1, deleted_at: null, property_id: tp }, select: { id: true, name: true } }),
        prisma.types.findMany({ where: { group: 'guest-status', name: { contains: 'blacklist', mode: 'insensitive' }, status: 1, deleted_at: null, property_id: tp }, select: { id: true, name: true } }),
        prisma.countries.findMany({ where: activeWhere('countries'), orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        readPropertyMandatory(prisma, tp),
      ]);

      const normal = statusGuest.filter((s: any) => s.name.toLowerCase().includes('normal'));
      const filteredStatusGuest = [...normal, ...statusGuest.filter((s: any) => !s.name.toLowerCase().includes('normal'))];

      const master = {
        statuses: STATUSES.map(s => ({ value: s.id, label: s.name })),
        titles: titles.map(t => ({ value: Number(t.id), label: t.name })),
        nrics: NRICS.map(n => ({ value: n.name, label: n.name })),
        statusGuest: filteredStatusGuest.map(s => ({ value: Number(s.id), label: s.name })),
        genders: GENDERS.map(g => ({ value: g.name, label: g.name })),
        regions: REGIONS.map(r => ({ value: r.name, label: r.name })),
        countries: countries.map(c => ({ value: Number(c.id), label: c.name })),
        cities: [],
        statusBlacklist: blackList.map(b => ({ value: Number(b.id), label: b.name }))
      };

      success(res, { status: 1, status_profile: 'Normal' }, 'Success', 200, { master });
    } catch (err: any) {
      console.error('Guest create form error:', err);
      error(res, 'Failed to load form data', 500);
    }
  }

  /**
   * POST /api/guests
   * Create new guest
   */
  static async store(req: Request, res: Response): Promise<void> {
    try {
      const {
        short_code, first_name, last_name, region, nationality_id, city_id, country_id,
        telp, mobile_phone, card_type, card_number, card_expiry, email,
        gender, birth_of_date, fax, address, postal_code, car_reg_number,
        guest_status, guest_title, status, image,
        status_profile, blacklist, is_subscribe
      } = req.body;

      const errors: Record<string, string[]> = {};
      if (!first_name) errors.first_name = ['The first name field is required.'];
      if (!last_name) errors.last_name = ['The last name field is required.'];

      if (card_type || card_number) {
        if (!card_type) errors.card_type = ['The card type field is required.'];
        if (!card_number) errors.card_number = ['The card number field is required.'];
      }

      // Laravel parity — card uniqueness BEFORE create (no orphan row on duplicate)
      if (card_type && card_number) {
        const dupCard = await prisma.guest_profiles.findFirst({
          where: { card_type, card_number, deleted_at: null },
          select: { id: true },
        });
        if (dupCard) {
          badRequest(res, 'Card number already exists');
          return;
        }
      }

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const propertyId = req.user?.lastProperty;

      // Generate account number — active rows only (soft-deleted excluded so
      // numbers can't collide with a restored profile)
      const lastAccount = await prisma.guest_profiles.findFirst({
        where: { deleted_at: null },
        orderBy: { account: 'desc' },
        select: { account: true }
      });
      const lastNum = lastAccount?.account ? parseInt(lastAccount.account.replace('GA', '')) : 0;
      const newAccount = `GA${String(lastNum + 1).padStart(6, '0')}`;

      let imagePath = null;
      if (image) {
        if (typeof image === 'string' && image.startsWith('data:image')) {
          const saved = saveBase64Image(image, 'guestProfile');
          imagePath = saved ? saved.filePath : null;
        } else if (typeof image === 'string') {
          // Legacy passthrough: already a stored relative path
          imagePath = image;
        }
      }

      const data: any = {
        short_code,
        first_name,
        last_name,
        region,
        nationality_id,
        city_id,
        country_id,
        telp,
        mobile_phone,
        email,
        gender,
        birth_of_date: birth_of_date ? new Date(birth_of_date) : null,
        fax,
        address,
        postal_code,
        car_reg_number,
        status: status === true || status === 1 || status === '1' || status?.value === true || status?.value === 1 ? 1 : (status === false || status === 0 || status === '0' || status?.value === false || status?.value === 0 ? 0 : (status ?? 1)),
        image: imagePath,
        property_id: propertyId,
        account: newAccount
      };
      if (status_profile !== undefined) data.status_profile = Number(status_profile) || 0;
      if (blacklist !== undefined) data.blacklist = Number(blacklist) || 0;
      if (is_subscribe !== undefined) data.is_subscribe = is_subscribe === true || is_subscribe === 1 || is_subscribe === '1';
      // `guest_profiles.status_profile` IS the guest status column in the
      // reference — GuestProfileController@update writes it in `only([...])`
      // and GuestProfile's accessor resolves the label from it. The form posts
      // the selection as `guest_status`, so mirror it into the column as well
      // as the pivot; leaving it at its 0 default makes the list/search show
      // "Unknown" for every guest.
      const statusPick = guest_status ?? status_profile;
      if (statusPick !== undefined && statusPick !== null && statusPick !== '') {
        const statusId = Number(statusPick?.value ?? statusPick);
        if (!Number.isNaN(statusId)) data.status_profile = statusId;
      }
      if (card_type && card_number) {
        data.card_type = card_type;
        data.card_number = card_number;
        data.card_expiry = card_expiry || null;
      }

      Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

      const guest = await prisma.guest_profiles.create({ data });

      // Sync types via model_has_types
      const guestTitleId = guest_title?.value ?? guest_title;
      const guestStatusId = guest_status?.value ?? guest_status;
      // Validate before writing: a stale type id raised a foreign-key error after
      // the guest row already existed, leaving an orphan profile behind.
      for (const raw of [guestTitleId, guestStatusId]) {
        if (raw === undefined || raw === null || raw === '') continue;
        if (!/^\d+$/.test(String(raw))) {
          await prisma.guest_profiles.delete({ where: { id: guest.id } });
          badRequest(res, 'Invalid type id: ' + raw);
          return;
        }
        const exists = await prisma.types.findUnique({ where: { id: BigInt(String(raw)) }, select: { id: true } });
        if (!exists) {
          await prisma.guest_profiles.delete({ where: { id: guest.id } });
          badRequest(res, 'Invalid type id: ' + raw);
          return;
        }
      }
      if (guestTitleId) {
        await prisma.model_has_types.create({
          data: { model_id: guest.id, model_type: 'App\\Models\\GuestProfile', type_id: BigInt(guestTitleId) }
        });
      }
      if (guestStatusId) {
        await prisma.model_has_types.create({
          data: { model_id: guest.id, model_type: 'App\\Models\\GuestProfile', type_id: BigInt(guestStatusId) }
        });
      }

      const fullGuest = await this.getGuestWithRelations(guest.id);
      // Quick-create from a reservation only fills title/first/last, so hand the
      // caller exactly what check-in will still ask for. The popup shows this
      // as "incomplete" plus a link to the full profile form.
      //
      // The relational ids (guest_title / guest_status) must come back as
      // `{ value, label }` like GET edit does: the reservation form writes the
      // whole response straight into its guest_status select, and a bare number
      // leaves that dropdown blank after a quick save.
      success(res, {
        ...GuestController.formatGuest(fullGuest),
        ...GuestController.relationOptions(fullGuest),
        mandatory_check_in: mandatoryCheckInBlock(
          fullGuest,
          await readPropertyMandatory(prisma, propertyId),
        ),
      }, 'Profile created successfully');
    } catch (err: any) {
      console.error('Guest store error:', err);
      if (err.code === 'P2002') {
        badRequest(res, 'Duplicate entry');
      } else {
        error(res, 'Failed to create guest', 500);
      }
    }
  }

  /**
   * GET /api/guests/:id
   * Show single guest
   */
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!idParam || idParam === 'null' || idParam === 'undefined' || !/^\d+$/.test(idParam)) {
        notFound(res, 'Guest not found');
        return;
      }
      const id = BigInt(idParam);
      const guest = await this.getGuestWithRelations(id);

      if (!guest || guest.deleted_at) {
        notFound(res, 'Guest not found');
        return;
      }

      success(res, GuestController.formatGuest(guest), 'Success');
    } catch (err: any) {
      console.error('Guest show error:', err);
      error(res, 'Failed to fetch guest', 500);
    }
  }

  /**
   * GET /api/guests/:id/edit
   * Get guest with master data for edit form
   */
  static async edit(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const tp = req.user?.lastProperty ?? 0;
      const [guest, titles, statusGuest, blackList, types, countries, mandatory] = await Promise.all([
        this.getGuestWithRelations(id),
        prisma.types.findMany({ where: { group: 'guest-title', status: 1, deleted_at: null, property_id: tp }, select: { id: true, name: true } }),
        prisma.types.findMany({ where: { group: 'guest-status', status: 1, deleted_at: null, property_id: tp }, select: { id: true, name: true } }),
        prisma.types.findMany({ where: { group: 'guest-status', name: { contains: 'blacklist', mode: 'insensitive' }, status: 1, deleted_at: null, property_id: tp }, select: { id: true, name: true } }),
        prisma.model_has_types.findMany({ where: { model_id: id, model_type: 'App\\Models\\GuestProfile' }, include: { types: true } }),
        prisma.countries.findMany({ where: activeWhere('countries'), orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        readPropertyMandatory(prisma, tp),
      ]);

      if (!guest || guest.deleted_at) {
        notFound(res, 'Guest not found');
        return;
      }

      const normal = statusGuest.filter((s: any) => s.name.toLowerCase().includes('normal'));
      const filteredStatusGuest = [...normal, ...statusGuest.filter((s: any) => !s.name.toLowerCase().includes('normal'))];

      const guestTitle = types.find(t => t.types.group === 'guest-title')?.types;
      const guestStatus = types.find(t => t.types.group === 'guest-status')?.types;

      const master = {
        statuses: STATUSES.map(s => ({ value: s.id, label: s.name })),
        titles: titles.map(t => ({ value: Number(t.id), label: t.name })),
        nrics: NRICS.map(n => ({ value: n.name, label: n.name })),
        statusGuest: filteredStatusGuest.map(s => ({ value: Number(s.id), label: s.name })),
        genders: GENDERS.map(g => ({ value: g.name, label: g.name })),
        regions: REGIONS.map(r => ({ value: r.name, label: r.name })),
        countries: countries.map(c => ({ value: Number(c.id), label: c.name })),
        cities: [],
        statusBlacklist: blackList.map(b => ({ value: Number(b.id), label: b.name })),
        // Same list as GET create so the wizard and the profile page agree on
        // what "complete" means.
        mandatory_check_in: mandatory.map(field => ({
          value: field,
          label: MANDATORY_FIELD_LABELS[field] ?? field,
        })),
      };

      const fmt = GuestController.formatGuest(guest);

      // City label needs its own lookup — the form renders a `{value,label}`
      // pair and a bare id would show as "12345" in the dropdown.
      const cityRow = fmt.city_id
        ? await prisma.cities.findUnique({ where: { id: BigInt(fmt.city_id) }, select: { name: true } }).catch(() => null)
        : null;

      // `!= null` instead of a truthy test: id 0 is a legal value and a plain
      // `? :` would silently blank the field.
      // Note these stay in their native type — `card_type` and `gender` are
      // strings ('NRIC', 'Male'), so Number() would yield NaN and break the
      // option match in the select.
      const opt = (v: any, label?: string | null) =>
        v !== null && v !== undefined ? { value: v, label: label ?? String(v) } : null;

      const guestObj = {
        ...fmt,
        guest_title: guestTitle ? { value: Number(guestTitle.id), label: guestTitle.name } : null,
        guest_status: guestStatus ? { value: Number(guestStatus.id), label: guestStatus.name } : null,
        gender: opt(fmt.gender, fmt.gender),
        region: opt(fmt.region, fmt.region),
        card_type: opt(fmt.card_type, fmt.card_type),
        nationality_id: opt(fmt.nationality_id, guest.nationality?.name ?? null),
        country_id: opt(fmt.country_id, countries.find(c => Number(c.id) === fmt.country_id)?.name ?? null),
        city_id: opt(fmt.city_id, cityRow?.name ?? null),
        status: fmt.status !== null ? { value: fmt.status, label: STATUSES.find(s => s.id === fmt.status)?.name || String(fmt.status) } : null,
      };
      // `master` must travel as response meta, exactly like GET create does.
      // Nesting it inside the data payload put it at `resp.data.master` while
      // the form reads `resp.master`, so every master-driven dropdown (region,
      // nric, gender, guest status, nationality) came up empty on edit while
      // add worked.
      success(res, guestObj, 'Success', 200, { master });
    } catch (err: any) {
      console.error('Guest edit error:', err);
      error(res, 'Failed to load edit data', 500);
    }
  }

  /**
   * PUT /api/guests/:id
   * Update guest
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const {
        short_code, first_name, last_name, region, nationality_id, city_id, country_id,
        telp, mobile_phone, card_type, card_number, card_expiry, email,
        gender, birth_of_date, fax, address, postal_code, car_reg_number,
        guest_status, guest_title, status, status_profile, blacklist, is_subscribe, image
      } = req.body;

      const guest = await prisma.guest_profiles.findUnique({ where: { id } });
      if (!guest || guest.deleted_at) {
        notFound(res, 'Guest not found');
        return;
      }

      const errors: Record<string, string[]> = {};
      if (!first_name) errors.first_name = ['The first name field is required.'];
      if (!last_name) errors.last_name = ['The last name field is required.'];
      if (!birth_of_date) errors.birth_of_date = ['The birth of date field is required.'];

      if (card_type || card_number) {
        if (!card_type) errors.card_type = ['The card type field is required.'];
        if (!card_number) errors.card_number = ['The card number field is required.'];
      }

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      if (card_type && card_number) {
        const existingCard = await prisma.guest_profiles.findFirst({
          where: { card_type, card_number, id: { not: id } }
        });
        if (existingCard) {
          badRequest(res, 'Card number already exists');
          return;
        }
      }

      let imagePath = guest.image;
      if (image) {
        if (typeof image === 'string' && image.startsWith('data:image')) {
          const saved = saveBase64Image(image, 'guestProfile');
          imagePath = saved ? saved.filePath : imagePath;
        } else if (typeof image === 'string') {
          imagePath = image; // already a stored relative path
        }
      }

      const data: any = {
        short_code,
        first_name,
        last_name,
        region,
        nationality_id,
        city_id,
        country_id,
        telp,
        mobile_phone,
        email,
        gender,
        birth_of_date: birth_of_date ? new Date(birth_of_date) : null,
        fax,
        address,
        postal_code,
        car_reg_number,
        status: status === true || status === 1 || status === '1' || status?.value === true || status?.value === 1 ? 1 : (status === false || status === 0 || status === '0' || status?.value === false || status?.value === 0 ? 0 : status),
        image: imagePath
      };

      // The card fields are written here rather than in a second update after the
      // transaction. They used to be applied by a follow-up `guest_profiles.update`
      // outside the transaction, which meant the guest row could be committed with
      // the new name/address while the card columns still held the old values if
      // that second write failed -- and the folio mirror inside the transaction had
      // already copied the NEW card, so the three copies drifted apart.
      if (card_type) data.card_type = card_type;
      if (card_number) data.card_number = card_number;
      if (card_expiry !== undefined) data.card_expiry = card_expiry || null;

      // Same as store: `status_profile` is the guest-status column in the
      // reference, and the form posts the selection as `guest_status`.
      const statusPick = guest_status ?? status_profile;
      if (statusPick !== undefined && statusPick !== null && statusPick !== '') {
        const statusId = Number(statusPick?.value ?? statusPick);
        if (!Number.isNaN(statusId)) data.status_profile = statusId;
      }

      // `blacklist` / `is_subscribe` were destructured but never applied, so
      // toggling them on the profile form silently did nothing.
      if (blacklist !== undefined) {
        data.blacklist = blacklist === true || blacklist === 1 || blacklist === '1' ? 1 : 0;
      }
      if (is_subscribe !== undefined) {
        data.is_subscribe = is_subscribe === true || is_subscribe === 1 || is_subscribe === '1';
      }

      // `status` must be an explicit 0/1. An untouched checkbox can still carry
      // the `{ value, label }` pair the edit endpoint returned, and passing that
      // object to an Int column silently lands on 0 (inactive).
      if (data.status !== undefined && typeof data.status === 'object') {
        data.status = data.status?.value ? 1 : 0;
      }

      Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

      // Sync types.
      //
      // This used to `deleteMany` the pivot unconditionally and only re-create
      // rows for the values that happened to be in the payload. A caller that
      // sent `guest_status` without `guest_title` (the reservation screen does
      // exactly this) therefore wiped the guest's title for good, and an id that
      // no longer existed produced a foreign-key 500 after the column updates had
      // already been written. Resolve both ids first, validate them, then
      // replace the pivot inside a transaction with the row update.
      const guestTitleId = guest_title?.value ?? guest_title;
      const guestStatusId = guest_status?.value ?? guest_status;
      const validTypeIds: bigint[] = [];
      for (const raw of [guestTitleId, guestStatusId]) {
        if (raw === undefined || raw === null || raw === '') continue;
        const tid = BigInt(String(raw));
        if (!/^\d+$/.test(String(raw))) throw new Error('Invalid type id: ' + raw);
        const exists = await prisma.types.findUnique({ where: { id: tid }, select: { id: true } });
        if (!exists) {
          badRequest(res, 'Invalid type id: ' + raw);
          return;
        }
        validTypeIds.push(tid);
      }

      await prisma.$transaction(async (tx) => {
        await tx.guest_profiles.update({ where: { id }, data });

        // Mirror the guest fields back onto every folio that belongs to this
        // guest.
        //
        // The folio keeps its own copy of the guest details, and the reservation
        // side already mirrors folio -> guest (see ReservationController.update).
        // Without this leg, saving a change on the Guest Profile page updated
        // `guest_profiles` and left the folio showing the old name / phone /
        // address, so the two screens disagreed -- editing one then the other
        // looked like the save "did not stick".
        //
        // Only the fields present in the payload are written, so this is a no-op
        // for partial callers (the reservation screen sends guest_status without
        // the profile fields).
        const folioPatch: any = {};
        if (first_name !== undefined) folioPatch.first_name = first_name;
        if (last_name !== undefined) folioPatch.last_name = last_name;
        if (email !== undefined) folioPatch.email = email;
        if (telp !== undefined) folioPatch.telp = telp;
        if (mobile_phone !== undefined) folioPatch.mobile_phone = mobile_phone;
        if (address !== undefined) folioPatch.address = address;
        if (postal_code !== undefined) folioPatch.postal_code = postal_code;
        if (city_id !== undefined && city_id !== null && city_id !== '') folioPatch.city_id = Number(city_id);
        if (country_id !== undefined && country_id !== null && country_id !== '') folioPatch.country_id = Number(country_id);
        if (nationality_id !== undefined && nationality_id !== null && nationality_id !== '') folioPatch.nationality_id = Number(nationality_id);
        if (gender !== undefined && gender !== null && gender !== '') folioPatch.gender = gender;
        if (birth_of_date !== undefined) folioPatch.birth_of_date = birth_of_date ? new Date(birth_of_date) : null;
        // Card Type / NRIC / expiry live on both tables. guest_profiles is the
        // master copy, so a change made here has to reach the folio too -- the
        // reservation detail form reads these off the folio and otherwise showed
        // a stale (or empty) card next to the profile's current one.
        if (card_type !== undefined) folioPatch.card_type = card_type;
        if (card_number !== undefined) folioPatch.card_number = card_number;
        if (card_expiry !== undefined) folioPatch.card_expiry = card_expiry || null;

        if (Object.keys(folioPatch).length > 0) {
          folioPatch.updated_at = new Date();
          folioPatch.updated_by = req.user?.id ? BigInt(req.user.id) : undefined;
          await tx.folios.updateMany({
            where: { guest_profile_id: id, deleted_at: null },
            data: folioPatch,
          });
        }

        // Resolve which groups are being replaced. A group with no replacement
        // in the payload is left alone, so a partial update (reservation screen
        // sends `guest_status` but no `guest_title`) cannot erase the title.
        const titleId = guestTitleId !== undefined && guestTitleId !== null && guestTitleId !== ''
          ? BigInt(String(guestTitleId)) : null;
        const statusId = guestStatusId !== undefined && guestStatusId !== null && guestStatusId !== ''
          ? BigInt(String(guestStatusId)) : null;

        if (titleId) {
          await tx.model_has_types.deleteMany({
            where: { model_id: id, model_type: 'App\\Models\\GuestProfile', type_id: { not: titleId } },
          });
          await tx.model_has_types.create({
            data: { model_id: id, model_type: 'App\\Models\\GuestProfile', type_id: titleId },
          });
        }
        if (statusId) {
          await tx.model_has_types.deleteMany({
            where: { model_id: id, model_type: 'App\\Models\\GuestProfile', type_id: { not: statusId } },
          });
          await tx.model_has_types.create({
            data: { model_id: id, model_type: 'App\\Models\\GuestProfile', type_id: statusId },
          });
        }
      });

      const updated = await this.getGuestWithRelations(id);
      success(res, {
        ...GuestController.formatGuest(updated),
        ...GuestController.relationOptions(updated),
        mandatory_check_in: mandatoryCheckInBlock(
          updated,
          await readPropertyMandatory(prisma, req.user?.lastProperty),
        ),
      }, 'Success');
    } catch (err: any) {
      console.error('Guest update error:', err);
      error(res, 'Failed to update guest', 500);
    }
  }

  /**
   * DELETE /api/guests/:id
   * Soft delete guest
   */
  static async destroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const guest = await prisma.guest_profiles.findUnique({ where: { id } });

      if (!guest) {
        notFound(res, 'Guest not found');
        return;
      }

      await prisma.guest_profiles.update({
        where: { id },
        data: { deleted_at: new Date() }
      });

      success(res, null, 'Guest deleted successfully');
    } catch (err: any) {
      console.error('Guest destroy error:', err);
      error(res, 'Failed to delete guest', 500);
    }
  }

  /**
   * POST /api/guests/:id/restore
   * Restore soft-deleted guest
   */
  static async restore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = BigInt(idParam);
      const guest = await prisma.guest_profiles.findUnique({ where: { id } });

      if (!guest) {
        notFound(res, 'Guest not found');
        return;
      }

      await prisma.guest_profiles.update({
        where: { id },
        data: { deleted_at: null }
      });

      success(res, null, 'Success');
    } catch (err: any) {
      console.error('Guest restore error:', err);
      error(res, 'Failed to restore guest', 500);
    }
  }

  /**
   * GET /api/guests/simple/list
   * Simple guest list for dropdowns
   */
  static async simpleList(req: Request, res: Response): Promise<void> {
    try {
      const search = req.query.search as string;
      const searchField = req.query.search_field as string;
      const searchValue = req.query.search_value as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = { deleted_at: null, property_id: BigInt(req.user?.lastProperty ?? 0) };
      if (search) {
        where.OR = [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { account: { contains: search, mode: 'insensitive' } }
        ];
      }
      if (searchField && searchValue) {
        pushCondition(where, searchPredicate('guest_profiles', searchField, searchValue));
      }

      const guests = await prisma.guest_profiles.findMany({
        where,
        select: { id: true, first_name: true, account: true },
        orderBy: { account: 'asc' },
        skip: (page - 1) * limit,
        take: limit
      });

      const total = await prisma.guest_profiles.count({ where });

      const data = guests.map(g => ({ id: Number(g.id), name: g.first_name, account: g.account }));
      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        { label: 'Account', key: 'account', type: 'none', is_search: false }
      ];

      success(res, data, 'Success', 200, {
        table,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total)
        }
      });
    } catch (err: any) {
      console.error('Simple guest list error:', err);
      error(res, 'Failed to fetch guests', 500);
    }
  }

  /**
   * GET /api/guests/autocomplete
   * Autocomplete for guest search
   */
  static async autocomplete(req: Request, res: Response): Promise<void> {
    try {
      const search = req.query.search as string;
      const where: any = { status: 1, deleted_at: null, property_id: BigInt(req.user?.lastProperty ?? 0) };

      if (search) {
        where.OR = [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { account: { contains: search, mode: 'insensitive' } }
        ];
      }

      const guests = await prisma.guest_profiles.findMany({
        where,
        select: { id: true, first_name: true, last_name: true },
        take: 10
      });

      const data = guests.map(g => ({
        value: Number(g.id),
        label: `${g.first_name} ${g.last_name}`
      }));

      success(res, data, 'Success');
    } catch (err: any) {
      console.error('Guest autocomplete error:', err);
      error(res, 'Failed to fetch guests', 500);
    }
  }

  /**
   * GET /api/guests/countries
   * Get countries list
   */
  static async countries(req: Request, res: Response): Promise<void> {
    try {
      const countries = await prisma.countries.findMany({
        where: activeWhere('countries'),
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
      });

      success(res, countries.map(c => ({ id: Number(c.id), name: c.name })), 'Success');
    } catch (err: any) {
      console.error('Countries error:', err);
      error(res, 'Failed to fetch countries', 500);
    }
  }

  /**
   * GET /api/guests/cities
   * Get cities list (optionally filtered by country)
   */
  static async cities(req: Request, res: Response): Promise<void> {
    try {
      const countryId = req.query.country_id ? BigInt(req.query.country_id as string) : null;

      const where: any = {};
      if (countryId) where.country_id = countryId;

      const cities = await prisma.cities.findMany({
        where: activeWhere('cities', where),
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
      });

      success(res, cities.map(c => ({ id: Number(c.id), name: c.name })), 'Success');
    } catch (err: any) {
      console.error('Cities error:', err);
      error(res, 'Failed to fetch cities', 500);
    }
  }

  /**
   * Get guest with related data
   */
  private static async getGuestWithRelations(id: bigint) {
    const guest = await prisma.guest_profiles.findUnique({ where: { id } });
    if (!guest) return null;

    // Get nationality
    let nationality = null;
    if (guest.nationality_id) {
      nationality = await prisma.countries.findUnique({ where: { id: guest.nationality_id } });
    }

    // Get types
    const types = await prisma.model_has_types.findMany({
      where: { model_id: id, model_type: 'App\\Models\\GuestProfile' },
      include: { types: true }
    });

    // Get folios
    const folios = await prisma.folios.findMany({ where: { guest_profile_id: id } });

    return { ...guest, nationality, types: types.map(t => t.types), folios };
  }

  static async folioList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const guestIdRaw = String(req.query.guest_id ?? req.query.guestId ?? '');
      if (!/^\d+$/.test(guestIdRaw)) { success(res, [], 'Success', 200, { pagination: { current_page: 1, last_page: 1, per_page: limit, total: 0, from: 1, to: 0 } }); return; }
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, guest_profile_id: BigInt(guestIdRaw) };
      const [data, total] = await Promise.all([
        prisma.folios.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.folios.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
        table: TABLES.guestFolio,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Guest folio list error:', err); error(res, 'Failed to list folios', 500); }
  }

  // ==================== FOLIO STORE/DESTROY (GuestFolioController parity) ====================
  static async folioStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty;
      const { guest_profile_id, company_profile_id, room_type_id, rate_id, room_id, check_in_date, check_out_date, status_folio, folio, first_name, last_name } = req.body;
      const data: any = {
        property_id: pid,
        guest_profile_id: guest_profile_id !== undefined ? BigInt(guest_profile_id) : undefined,
        check_in_date: check_in_date ? new Date(check_in_date) : undefined,
        check_out_date: check_out_date ? new Date(check_out_date) : undefined,
        is_compliment_tour_leader: false,
        type_reservation: 'fit',
        folio_number: folio ?? undefined,
        created_at: new Date(),
        updated_at: new Date(),
      };
      if (first_name !== undefined) data.first_name = first_name;
      if (last_name !== undefined) data.last_name = last_name;
      if (data.guest_profile_id === undefined) { badRequest(res, 'guest_profile_id is required'); return; }
      if (company_profile_id !== undefined) {
        data.company_profile_id = BigInt(company_profile_id);
      } else {
        data.company_profile_id = (await prisma.company_profiles.findFirst({ where: activeWhere('company_profiles', req.user?.lastProperty ? { property_id: req.user.lastProperty } : {}, req.user?.lastProperty), orderBy: { id: 'asc' }, select: { id: true } }))?.id;
      }
      if (data.company_profile_id === undefined) { badRequest(res, 'company_profile_id is required'); return; }
      const record = await prisma.folios.create({ data });
      success(res, bigintToNumber(record), 'Folio created successfully', 200);
    } catch (err: any) { console.error('Guest folio store error:', err); error(res, 'Failed to create folio', 500); }
  }

  static async folioDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const record = await prisma.folios.findUnique({ where: { id } });
      if (!record) { notFound(res, 'Not Found'); return; }
      await prisma.folios.update({ where: { id }, data: { deleted_at: new Date(), updated_at: new Date() } });
      success(res, [], 'Folio deleted successfully');
    } catch (err: any) { console.error('Guest folio destroy error:', err); error(res, 'Failed to delete folio', 500); }
  }

  // ==================== DOCUMENT ====================
  static async documentList(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const { page, limit } = parsePaginationFn(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, guest_profile_id: guestId, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.guest_profile_documents.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.guest_profile_documents.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        table: TABLES.guestDocument,
        permission: getPermissionFlags(req.user, 84),
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Document list error:', err); error(res, 'Failed to list documents', 500); }
  }

  static async documentStore(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = req.user?.lastProperty ?? 0n;
      let { file, description, status, file_path } = req.body;

      // Path A: multipart upload (= Laravel store('guest-documents','public'))
      if ((req as any).file) {
        const f = (req as any).file as Express.Multer.File;
        const ext = path.extname(f.originalname).slice(1).toLowerCase() || 'dat';
        file = f.originalname;
        file_path = `guest-documents/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const abs = path.join(storageRoot(), file_path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.buffer);
      }

      // Path B: base64 data-URI in JSON
      if (typeof file === 'string' && file.startsWith('data:')) {
        const saved = saveDocumentFromDataUri(file);
        if (!saved) {
          badRequest(res, 'Validation failed: file must be jpeg/png/jpg/pdf/doc/docx/xls/xlsx/ppt/pptx/txt');
          return;
        }
        file = saved.originalName; // display name (= client original name slot)
        file_path = saved.filePath;
      }

      if (!file && !file_path) {
        badRequest(res, 'The file field is required.');
        return;
      }

      const data = await prisma.guest_profile_documents.create({
        data: { property_id: pid, guest_profile_id: guestId, file, description, file_path: file_path ?? null, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Document created', 200);
    } catch (err: any) { console.error('Document store error:', err); error(res, 'Failed to create document', 500); }
  }

  static async documentDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      await prisma.guest_profile_documents.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Document deleted');
    } catch (err: any) { error(res, 'Failed to delete document', 500); }
  }

  static async documentUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const { file, description, status } = req.body;
      const row = await prisma.guest_profile_documents.findUnique({ where: { id } });
      if (!row || row.deleted_at) { notFound(res, 'Not Found'); return; }
      await prisma.guest_profile_documents.update({
        where: { id },
        data: {
          ...(file !== undefined ? { file } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(status !== undefined ? { status } : {}),
          updated_at: new Date(),
          updated_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(await prisma.guest_profile_documents.findUnique({ where: { id } })), 'Document updated');
    } catch (err: any) { console.error('Document update error:', err); error(res, 'Failed to update document', 500); }
  }

  static async documentRestore(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const row = await prisma.guest_profile_documents.findUnique({ where: { id } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.guest_profile_documents.update({ where: { id }, data: { deleted_at: null } });
      success(res, null, 'Document restored');
    } catch (err: any) { error(res, 'Failed to restore document', 500); }
  }

  // ==================== FAMILY MEMBER ====================
  static async familyList(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const data = await prisma.guest_profile_family_members.findMany({ where: { property_id: pid, guest_profile_id: guestId, deleted_at: null } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { console.error('Family list error:', err); error(res, 'Failed to list family', 500); }
  }

  static async familyStore(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = req.user?.lastProperty ?? 0n;
      const { has_guest_profile_id, relationship, status } = req.body;
      if (!has_guest_profile_id) { badRequest(res, 'has_guest_profile_id is required'); return; }
      const data = await prisma.guest_profile_family_members.create({
        data: { property_id: pid, guest_profile_id: guestId, has_guest_profile_id: BigInt(has_guest_profile_id), relationship, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Family member added', 200);
    } catch (err: any) { console.error('Family store error:', err); error(res, 'Failed to add family', 500); }
  }

  static async familyDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      await prisma.guest_profile_family_members.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Family member removed');
    } catch (err: any) { error(res, 'Failed to remove family member', 500); }
  }

  // ==================== HISTORY ====================
  static async historyList(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const { page, limit } = parsePaginationFn(req.query);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, id_guest_profile: guestId, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.guest_profile_histories.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.guest_profile_histories.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('History list error:', err); error(res, 'Failed to list history', 500); }
  }

  // Laravel GuestProfileHistoryController@store — fields: remark (required), is_arrival
  static async historyStore(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = req.user?.lastProperty ?? 0n;
      const { remark, is_arrival } = req.body;
      if (!remark) { badRequest(res, 'The remark field is required.'); return; }
      if (is_arrival === undefined) { badRequest(res, 'The is arrival field is required.'); return; }
      const data = await prisma.guest_profile_histories.create({
        data: {
          property_id: pid,
          id_guest_profile: guestId,
          remark,
          is_arrival: !!is_arrival,
          status: 1,
          created_at: new Date(),
          created_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(data), 'Note created successfully.', 200);
    } catch (err: any) { console.error('History store error:', err); error(res, 'Failed to add history', 500); }
  }

  // Laravel GuestProfileHistoryController@update — remark required
  static async historyUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const existing = await prisma.guest_profile_histories.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) { notFound(res, 'History not found'); return; }
      if (!req.body.remark) { badRequest(res, 'The remark field is required.'); return; }
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      data.remark = req.body.remark;
      if (req.body.is_arrival !== undefined) data.is_arrival = !!req.body.is_arrival;
      await prisma.guest_profile_histories.update({ where: { id }, data });
      success(res, bigintToNumber(existing), 'Success');
    } catch (err: any) { console.error('History update error:', err); error(res, 'Failed to update history', 500); }
  }

  // Laravel GuestProfileHistoryController@destroy
  static async historyDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      await prisma.guest_profile_histories.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'History deleted');
    } catch (err: any) { error(res, 'Failed to delete history', 500); }
  }

  // ==================== PREFERENCE ====================
  static async preferenceList(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = req.user?.lastProperty ?? 0n;
      const data = await prisma.guest_profile_preferences.findMany({ where: { id_guest_profile: guestId, property_id: pid, deleted_at: null } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { console.error('Preference list error:', err); error(res, 'Failed to list preferences', 500); }
  }

  static async preferenceStore(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = req.user?.lastProperty ?? 0n;
      const { preference, remark, status } = req.body;
      if (!preference) { badRequest(res, 'preference is required'); return; }
      const data = await prisma.guest_profile_preferences.create({
        data: { property_id: pid, id_guest_profile: guestId, preference, remark, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Preference added', 200);
    } catch (err: any) { console.error('Preference store error:', err); error(res, 'Failed to add preference', 500); }
  }

  static async preferenceDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      await prisma.guest_profile_preferences.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Preference deleted');
    } catch (err: any) { error(res, 'Failed to delete preference', 500); }
  }

  // Laravel GuestProfilePreferenceController@update
  static async preferenceUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const existing = await prisma.guest_profile_preferences.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) { notFound(res, 'Preference not found'); return; }
      const { preference, remark } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (preference !== undefined) data.preference = preference;
      if (remark !== undefined) data.remark = remark;
      await prisma.guest_profile_preferences.update({ where: { id }, data });
      success(res, bigintToNumber(existing), 'Success');
    } catch (err: any) { console.error('Preference update error:', err); error(res, 'Failed to update preference', 500); }
  }

  // Laravel GuestProfilePreferenceController@markAsDone
  static async preferenceMarkDone(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const existing = await prisma.guest_profile_preferences.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) { notFound(res, 'Preference not found'); return; }
      const done = req.body?.done !== false;
      await prisma.guest_profile_preferences.update({
        where: { id },
        data: {
          request_status: done ? 'done' : 'pending',
          completed_at: done ? new Date() : null,
          updated_at: new Date(),
          updated_by: req.user?.id,
        },
      });
      success(res, null, 'Success');
    } catch (err: any) { console.error('Preference mark-done error:', err); error(res, 'Failed to mark preference done', 500); }
  }

  // Laravel GuestProfilePreferenceController@listAll — all preferences across
  // guests for the property (dashboard / global list).
  static async preferenceListAll(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const where: any = { property_id: pid, deleted_at: null };
      if (req.query.request_status) where.request_status = req.query.request_status;

      const [rows, total] = await Promise.all([
        prisma.guest_profile_preferences.findMany({
          where,
          orderBy: { updated_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { guest_profiles: { select: { first_name: true, last_name: true } } },
        }),
        prisma.guest_profile_preferences.count({ where }),
      ]);
      const mapped = rows.map((p: any) => ({
        ...bigintToNumber(p),
        guest: p.guest_profiles ? `${p.guest_profiles.first_name ?? ''} ${p.guest_profiles.last_name ?? ''}`.trim() : '',
      }));
      success(res, mapped, 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Preference list-all error:', err); error(res, 'Failed to list all preferences', 500); }
  }

  // ==================== LOYALTY CARD ====================
  static async loyaltyList(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = req.user?.lastProperty ?? 0n;
      const data = await prisma.guest_profile_loyalty_cards.findMany({ where: { guest_profile_id: guestId, property_id: pid, deleted_at: null } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { console.error('Loyalty list error:', err); error(res, 'Failed to list loyalty cards', 500); }
  }

  static async loyaltyStore(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = req.user?.lastProperty ?? 0n;
      const { card_type, card_number, join_date, card_expiry, is_default, status } = req.body;
      const data = await prisma.guest_profile_loyalty_cards.create({
        data: { property_id: pid, guest_profile_id: guestId, card_type, card_number, join_date, card_expiry: card_expiry ? new Date(card_expiry) : null, is_default: is_default ?? false, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Loyalty card created', 200);
    } catch (err: any) { console.error('Loyalty store error:', err); error(res, 'Failed to create loyalty card', 500); }
  }

  // Laravel GuestProfileLoyaltyCardController@update
  static async loyaltyUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const existing = await prisma.guest_profile_loyalty_cards.findUnique({ where: { id } });
      if (!existing || existing.deleted_at) { notFound(res, 'Loyalty card not found'); return; }
      const { card_type, card_number, join_date, card_expiry, is_default } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (card_type !== undefined) data.card_type = card_type;
      if (card_number !== undefined) data.card_number = card_number;
      if (join_date !== undefined) data.join_date = join_date;
      if (card_expiry !== undefined) data.card_expiry = card_expiry ? new Date(card_expiry) : null;
      if (is_default !== undefined) data.is_default = is_default;
      await prisma.guest_profile_loyalty_cards.update({ where: { id }, data });
      success(res, bigintToNumber(existing), 'Success');
    } catch (err: any) { console.error('Loyalty update error:', err); error(res, 'Failed to update loyalty card', 500); }
  }

  static async loyaltyDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      await prisma.guest_profile_loyalty_cards.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Loyalty card deleted');
    } catch (err: any) { error(res, 'Failed to delete loyalty card', 500); }
  }

  /**
   * Format guest data to match Laravel formatData()
   */
  /**
   * Shape the pivot-backed ids as `{ value, label }`.
   *
   * `guest_title` and `guest_status` live in `model_has_types`, not as columns,
   * so `formatGuest` can only return the raw id. Selects on the client expect
   * `{ value, label }` — GET edit builds them here too, and without this the
   * reservation form's Guest Status select goes blank right after a quick save.
   */
  private static relationOptions(guest: any): Record<string, { value: any; label: string } | null> {
    const types: any[] = Array.isArray(guest?.types) ? guest.types : [];
    const pick = (group: string) => {
      const hit = types.find((t: any) => t?.group === group);
      return hit ? { value: Number(hit.id), label: hit.name } : null;
    };
    // These two are stored as columns and keep their native type — card_type
    // and gender are strings ('NRIC', 'Male'), not ids.
    const plain = (v: any) => (v !== null && v !== undefined ? { value: v, label: String(v) } : null);
    return {
      guest_title: pick('guest-title'),
      guest_status: pick('guest-status'),
      card_type: plain(guest?.card_type),
      gender: plain(guest?.gender),
      region: plain(guest?.region),
    };
  }

  private static formatGuest(guest: any, nationalityMap?: Map<any, any>, typesMap?: Map<any, any>, foliosMap?: Map<any, any>): any {
    // If guest already has relations from getGuestWithRelations
    const nationality = guest.nationality || (guest.nationality_id && nationalityMap ? nationalityMap.get(guest.nationality_id) : null);
    const types = guest.types || (typesMap ? typesMap.get(guest.id) : []);
    const folios = guest.folios || (foliosMap ? foliosMap.get(guest.id) : []);

    return {
      id: Number(guest.id),
      account: guest.account,
      short_code: guest.short_code,
      first_name: guest.first_name,
      last_name: guest.last_name,
      name: `${guest.first_name} ${guest.last_name}`,
      region: guest.region,
      nationality_id: guest.nationality_id !== null && guest.nationality_id !== undefined ? Number(guest.nationality_id) : null,
      nationality: nationality ? bigintToNumber(nationality) : null,
      city_id: guest.city_id !== null && guest.city_id !== undefined ? Number(guest.city_id) : null,
      country_id: guest.country_id !== null && guest.country_id !== undefined ? Number(guest.country_id) : null,
      telp: guest.telp,
      mobile_phone: guest.mobile_phone,
      card_type: guest.card_type,
      card_number: guest.card_number,
      card_expiry: guest.card_expiry,
      email: guest.email,
      gender: guest.gender,
      birth_of_date: guest.birth_of_date ? new Date(guest.birth_of_date).toISOString().slice(0, 10) : null,
      fax: guest.fax,
      address: guest.address,
      postal_code: guest.postal_code,
      car_reg_number: guest.car_reg_number,
      guest_status: guest.guest_status !== null && guest.guest_status !== undefined ? Number(guest.guest_status) : null,
      guest_title: guest.guest_title !== null && guest.guest_title !== undefined ? Number(guest.guest_title) : null,
      // `status_profile` is the guest-status column; surface it under the name
      // the reference uses so the list/search columns keep working.
      status_profile: guest.status_profile !== null && guest.status_profile !== undefined ? Number(guest.status_profile) : null,
      status: guest.status !== null && guest.status !== undefined ? Number(guest.status) : null,
      image: guest.image,
      property_id: guest.property_id !== null && guest.property_id !== undefined ? Number(guest.property_id) : null,
      types: types ? bigintToNumber(types) : [],
      folios: folios ? bigintToNumber(folios) : []
    };
  }

  /**
   * GET /api/guest/guest-listing-report
   * Guest listing report (Laravel GuestListingController@index parity)
   */
  static async guestListingReport(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const status = req.query.status as string;
      const gender = req.query.gender as string;
      const minAge = req.query.min_age as string;
      const maxAge = req.query.max_age as string;

      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { property_id: pid, deleted_at: null };
      if (status !== undefined && status !== '') where.status_profile = parseInt(status);
      if (gender && gender !== 'all') where.gender = gender;

      const now = new Date();
      if (minAge) {
        const cut = new Date(now); cut.setFullYear(cut.getFullYear() - parseInt(minAge));
        where.birth_of_date = { ...(where.birth_of_date || {}), lte: cut };
      }
      if (maxAge) {
        const cut = new Date(now); cut.setFullYear(cut.getFullYear() - parseInt(maxAge));
        where.birth_of_date = { ...(where.birth_of_date || {}), gte: cut };
      }

      if (search) {
        where.OR = [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { account: { contains: search, mode: 'insensitive' } },
          { short_code: { contains: search, mode: 'insensitive' } },
          { telp: { contains: search, mode: 'insensitive' } },
          { mobile_phone: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.guest_profiles.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.guest_profiles.count({ where }),
      ]);

      const rows = bigintToNumber(data).map((g: any) => ({
        id: g.id,
        account: g.account,
        name_combine: [g.first_name, g.last_name].filter(Boolean).join(' '),
        nationality_id: g.nationality_id ?? null,
        gender: g.gender,
        birth_of_date: g.birth_of_date,
        telp: g.telp,
        mobile_phone: g.mobile_phone,
        email: g.email,
        address: g.address,
        status_profile: g.status_profile,
        status: getStatusLabel(g.status),
      }));

      const table = [
        { label: 'Account No.', key: 'account', type: 'text', is_search: true },
        { label: 'Guest Name', key: 'name_combine', type: 'text', is_search: true },
        { label: 'Nationality', key: 'nationality_id', type: 'text', is_search: false },
        { label: 'Gender', key: 'gender', type: 'text', is_search: false },
        { label: 'DOB', key: 'birth_of_date', type: 'date', is_search: false },
        { label: 'Address', key: 'address', type: 'text', is_search: false },
        { label: 'Status Profile', key: 'status_profile', type: 'badge', is_search: false },
      ];

      success(res, rows, 'Success', 200, {
        table,
        permission: { view: true, edit: true, delete: true },
        search_data: [],
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) {
      console.error('Guest listing report error:', err);
      error(res, 'Failed to load guest listing report', 500);
    }
  }

  // Merge Guest (menu 84) — Laravel GuestProfileController@mergeUpdate parity
  // Row dari TableMergeGuest berbentuk dataObjectFormat ({value,label}); whitelist field harus
  // match kolom schema guest_profiles + koersi tipe (title disimpan via model_has_types).
  static async mergeUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      const has = (k: string): boolean => req.body[k] !== undefined && req.body[k] !== null;
      const pick = (k: string): any => {
        const v = req.body[k];
        if (v && typeof v === 'object' && 'value' in v) return v.value;
        return v;
      };

      const data: any = {};
      for (const key of ['status_profile', 'nationality_id', 'city_id', 'country_id', 'blacklist', 'status']) {
        if (has(key)) data[key] = Number(pick(key));
      }
      if (has('is_subscribe')) data.is_subscribe = !!pick('is_subscribe');
      for (const key of [
        'short_code', 'first_name', 'last_name', 'region', 'telp', 'mobile_phone',
        'card_type', 'card_number', 'card_expiry', 'email', 'gender', 'fax',
        'address', 'postal_code', 'car_reg_number',
      ]) {
        if (has(key)) data[key] = pick(key);
      }
      if (has('birth_of_date')) {
        const b = new Date(pick('birth_of_date'));
        if (!isNaN(b.getTime())) data.birth_of_date = b;
      }

      const existing = await prisma.guest_profiles.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Guest profile not found'); return; }

      const guest = await prisma.guest_profiles.update({
        where: { id },
        data: { ...data, updated_at: new Date(), updated_by: req.user?.id ?? null },
      });

      // syncTypes parity — guest-title disimpan via model_has_types, bukan kolom guest_profiles.
      if (has('title')) {
        const titleId = pick('title');
        if (titleId !== undefined && titleId !== null && titleId !== '') {
          await prisma.model_has_types.deleteMany({ where: { model_id: id, model_type: 'App\\Models\\GuestProfile' } });
          await prisma.model_has_types.create({
            data: { model_id: id, model_type: 'App\\Models\\GuestProfile', type_id: BigInt(String(titleId)) },
          });
        }
      }

      success(res, bigintToNumber(guest), 'Guest merged', 200);
    } catch (err: any) {
      console.error('Merge guest error:', err);
      error(res, 'Failed to merge guest', 500);
    }
  }

  // Batch finalize after merge — Laravel GuestProfileController@updateBatchStatus parity
  // (:586-633): sources set INACTIVE (status=0, NOT soft-deleted) and their folios are
  // reassigned to the surviving target so financial records stay attached.
  static async batchUpdate(req: Request, res: Response): Promise<void> {
    try {
      const { guest_profiles, guest_updates } = req.body;
      if (!Array.isArray(guest_profiles) || guest_profiles.length === 0 || !guest_updates) {
        badRequest(res, 'guest_profiles array and guest_updates target id are required');
        return;
      }
      const ids = guest_profiles.map((p: any) => BigInt(String(p.id)));
      const targetId = BigInt(String(guest_updates));
      const target = await prisma.guest_profiles.findUnique({ where: { id: targetId } });
      if (!target) { badRequest(res, 'The selected guest updates is invalid.'); return; }

      await prisma.$transaction(async (tx: any) => {
        // Sources -> inactive
        await tx.guest_profiles.updateMany({
          where: { id: { in: ids } },
          data: { status: 0, updated_at: new Date(), updated_by: req.user?.id ?? null },
        });
        // Reassign folios to the surviving profile
        await tx.folios.updateMany({
          where: { guest_profile_id: { in: ids } },
          data: { guest_profile_id: targetId, updated_at: new Date(), updated_by: req.user?.id ?? null },
        });
      });

      res.json({
        code: 200,
        message: 'Guest profiles and folios updated successfully.',
        updated_profiles_count: ids.length,
        main_profile_id: Number(targetId),
      });
    } catch (err: any) {
      console.error('Batch update guest error:', err);
      error(res, 'Failed to batch update guests', 500);
    }
  }

  // ==================== REQUEST NOTES (Laravel GuestProfileRequestNoteController parity) ====================
  static async notesList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit, search } = parsePaginationFn(req.query);
      const guestId = String(req.query.guest_id ?? '');
      if (!guestId) {
        success(res, [], 'No guest ID provided.', 200, {
          table: GuestController.notesTable(),
          pagination: paggingFn(0, limit, page),
          permission: { view: true, delete: true },
          search_data: [],
        });
        return;
      }
      const where: any = { id_guest_profile: BigInt(guestId), deleted_at: null };
      if (search) where.OR = [{ note: { contains: search, mode: 'insensitive' } }, { username: { contains: search, mode: 'insensitive' } }];
      const [data, total] = await Promise.all([
        prisma.guest_profile_request_notes.findMany({ where, orderBy: { id: 'asc' }, skip: (page - 1) * limit, take: limit }),
        prisma.guest_profile_request_notes.count({ where }),
      ]);
      const permFlags = getPermissionFlags(req.user, 82);
      const permission = { view: true, add: req.user?.superUser || permFlags.add, edit: req.user?.superUser || permFlags.edit };
      success(res, bigintToNumber(data), 'Success', 200, { table: GuestController.notesTable(), pagination: paggingFn(total, limit, page), permission, search_data: [] });
    } catch (err: any) { console.error('Notes list error:', err); error(res, 'Failed to list notes', 500); }
  }

  static async notesStore(req: Request, res: Response): Promise<void> {
    try {
      const { guest_id, note, frequency, time, arrival } = req.body;
      if (!guest_id) { badRequest(res, 'The guest id field is required.'); return; }
      if (!frequency) { badRequest(res, 'The frequency field is required.'); return; }
      if (!time) { badRequest(res, 'The time field is required.'); return; }
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const noteRow = await prisma.guest_profile_request_notes.create({
        data: {
          id_guest_profile: BigInt(guest_id), property_id: pid, frequency, time, note: note ?? null,
          username: req.user?.name ?? '', arrival: arrival ?? false, status: 1,
          created_at: new Date(), updated_at: new Date(), created_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(noteRow), 'Note created successfully.', 200);
    } catch (err: any) { console.error('Notes store error:', err); error(res, 'Failed to create note', 500); }
  }

  static async notesUpdate(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Note not found'); return; }
      const { note, frequency, time, arrival } = req.body;
      const data: any = { username: req.user?.name ?? '', updated_at: new Date(), updated_by: req.user?.id };
      if (note !== undefined) data.note = note;
      if (frequency !== undefined) data.frequency = frequency;
      if (time !== undefined) data.time = time;
      if (arrival !== undefined) data.arrival = arrival;
      const updated = await prisma.guest_profile_request_notes.update({ where: { id: BigInt(raw) }, data });
      success(res, bigintToNumber(updated), 'Note updated successfully.');
    } catch (err: any) { console.error('Notes update error:', err); error(res, 'Failed to update note', 500); }
  }

  static async notesDestroy(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Note not found'); return; }
      await prisma.guest_profile_request_notes.update({ where: { id: BigInt(raw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Note deleted successfully.');
    } catch (err: any) { console.error('Notes destroy error:', err); error(res, 'Failed to delete note', 500); }
  }

  private static notesTable(): any[] {
    const frequencyOptions = ['Daily', 'Once', 'Twice'].map((v) => ({ value: v, label: v }));
    const timeOptions = ['Morning', 'Evening', 'Everyday', 'Arrival'].map((v) => ({ value: v, label: v }));
    return [
      { label: 'Frequency', key: 'frequency', type: 'select', is_search: false, options: frequencyOptions },
      { label: 'Time', key: 'time', type: 'select', is_search: false, options: timeOptions },
      { label: 'Note', key: 'note', type: 'text', is_search: false },
      { label: 'Username', key: 'username', type: 'none', is_search: false },
      { label: 'Arrival', key: 'arrival', type: 'checkbox', is_search: false },
    ];
  }

  // ==================== FAMILY MEMBER (Laravel GuestProfileFamilyMemberController parity) ====================
  static async familyMemberList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePaginationFn(req.query);
      const guestId = String(req.query.guest_id ?? '');
      const pid = BigInt(req.user?.lastProperty ?? 0);
      if (!guestId) {
        success(res, [], 'No guest ID provided.', 200, {
          table: GuestController.familyMemberTable(),
          pagination: paggingFn(0, limit, page),
          permission: { edit: true },
          search_data: [],
        });
        return;
      }
      const searchField = req.query.search_field as string;
      const searchValue = String(req.query.search_value ?? '');
      const where: any = { guest_profile_id: BigInt(guestId), property_id: pid, deleted_at: null };
      if (searchField && searchValue && ['relationship', 'status'].includes(searchField)) {
        pushCondition(where, searchPredicate('guest_profile_family_members', searchField, searchValue));
      }
      const [data, total] = await Promise.all([
        prisma.guest_profile_family_members.findMany({ where, orderBy: { updated_at: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.guest_profile_family_members.count({ where }),
      ]);
      const permFlags = getPermissionFlags(req.user, 82);
      const permission = { view: true, add: req.user?.superUser || permFlags.add, edit: req.user?.superUser || permFlags.edit, delete: req.user?.superUser || permFlags.delete };
      success(res, bigintToNumber(data), 'Success', 200, { table: GuestController.familyMemberTable(), pagination: paggingFn(total, limit, page), permission, search_data: [] });
    } catch (err: any) { console.error('Family member list error:', err); error(res, 'Failed to list family members', 500); }
  }

  static async familyMemberStore(req: Request, res: Response): Promise<void> {
    try {
      const { guest_id, has_guest_profile_id, relationship } = req.body;
      if (!guest_id || !has_guest_profile_id) { badRequest(res, 'The guest id field is required.'); return; }
      if (!relationship) { badRequest(res, 'The relationship field is required.'); return; }
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const guestId = BigInt(guest_id);
      const memberId = BigInt(has_guest_profile_id);
      await prisma.guest_profile_family_members.create({
        data: { property_id: pid, guest_profile_id: guestId, has_guest_profile_id: memberId, relationship, status: 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      const reverse = await prisma.guest_profile_family_members.create({
        data: { property_id: pid, guest_profile_id: memberId, has_guest_profile_id: guestId, relationship, status: 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(reverse), 'Family member created successfully.', 200);
    } catch (err: any) { console.error('Family member store error:', err); error(res, 'Failed to create family member', 500); }
  }

  static async familyMemberUpdate(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Family member not found'); return; }
      const { relationship, status } = req.body;
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      if (relationship !== undefined) data.relationship = relationship;
      if (status !== undefined) data.status = Number(status);
      const updated = await prisma.guest_profile_family_members.update({ where: { id: BigInt(raw) }, data });
      success(res, bigintToNumber(updated), 'Family member updated successfully.');
    } catch (err: any) { console.error('Family member update error:', err); error(res, 'Failed to update family member', 500); }
  }

  static async familyMemberDestroy(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Family member not found'); return; }
      await prisma.guest_profile_family_members.update({ where: { id: BigInt(raw) }, data: { deleted_at: new Date(), deleted_by: req.user?.id } });
      success(res, null, 'Family member deleted successfully.');
    } catch (err: any) { console.error('Family member destroy error:', err); error(res, 'Failed to delete family member', 500); }
  }

  private static familyMemberTable(): any[] {
    const relationshipOptions = ['Father', 'Mother', 'Children', 'Grandfather', 'Grandmother', 'Grandchildren', 'Brother', 'Sister', 'Uncle', 'Aunt', 'Cousin', 'Nephew', 'Niece', 'Other'].map((v) => ({ value: v, label: v }));
    return [
      { label: 'Family Member Name', key: 'has_guest_profile_id', type: 'autocomplete', url_autocomplete: '/cms/profile/guest-v2', is_search: true },
      { label: 'Relationship', key: 'relationship', type: 'select', is_search: false, options: relationshipOptions },
    ];
  }
}
