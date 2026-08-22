import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound, validationError } from '../utils/response';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { getStatusLabel } from '../utils/cmsConfig';
import { dataSearch } from '../utils/search';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
      const where: any = { deleted_at: null };

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
        where[searchField] = { contains: searchValue, mode: 'insensitive' };
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
          orderBy: { [sort]: order },
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
      const [titles, statusGuest, blackList, countries] = await Promise.all([
        prisma.types.findMany({ where: { group: 'guest-title', status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.types.findMany({ where: { group: 'guest-status', status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.types.findMany({ where: { group: 'guest-status', name: { contains: 'blacklist', mode: 'insensitive' }, status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.countries.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
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
        guest_status, guest_title, status, image
      } = req.body;

      const errors: Record<string, string[]> = {};
      if (!first_name) errors.first_name = ['The first name field is required.'];
      if (!last_name) errors.last_name = ['The last name field is required.'];

      if (card_type || card_number) {
        if (!card_type) errors.card_type = ['The card type field is required.'];
        if (!card_number) errors.card_number = ['The card number field is required.'];
      }

      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }

      const propertyId = req.user?.lastProperty;

      // Generate account number
      const lastAccount = await prisma.guest_profiles.findFirst({
        orderBy: { account: 'desc' },
        select: { account: true }
      });
      const lastNum = lastAccount?.account ? parseInt(lastAccount.account.replace('GA', '')) : 0;
      const newAccount = `GA${String(lastNum + 1).padStart(6, '0')}`;

      let imagePath = null;
      if (image) {
        imagePath = `guestProfile/image_${Date.now()}.jpg`;
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

      Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

      const guest = await prisma.guest_profiles.create({ data });

      if (card_type && card_number) {
        const existingCard = await prisma.guest_profiles.findFirst({
          where: { card_type, card_number, id: { not: guest.id } }
        });
        if (existingCard) {
          badRequest(res, 'Card number already exists');
          return;
        }
        await prisma.guest_profiles.update({
          where: { id: guest.id },
          data: { card_type, card_number, card_expiry: card_expiry || null }
        });
      }

      // Sync types via model_has_types
      const guestTitleId = guest_title?.value ?? guest_title;
      const guestStatusId = guest_status?.value ?? guest_status;
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
      success(res, GuestController.formatGuest(fullGuest), 'Profile created successfully');
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
      const [guest, titles, statusGuest, blackList, types, countries] = await Promise.all([
        this.getGuestWithRelations(id),
        prisma.types.findMany({ where: { group: 'guest-title', status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.types.findMany({ where: { group: 'guest-status', status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.types.findMany({ where: { group: 'guest-status', name: { contains: 'blacklist', mode: 'insensitive' }, status: 1, deleted_at: null }, select: { id: true, name: true } }),
        prisma.model_has_types.findMany({ where: { model_id: id, model_type: 'App\\Models\\GuestProfile' }, include: { types: true } }),
        prisma.countries.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
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
        statusBlacklist: blackList.map(b => ({ value: Number(b.id), label: b.name }))
      };

      success(res, { ...GuestController.formatGuest(guest), guest_title: guestTitle ? { value: Number(guestTitle.id), label: guestTitle.name } : null, guest_status: guestStatus ? { value: Number(guestStatus.id), label: guestStatus.name } : null, master }, 'Success');
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
        guest_status, guest_title, status, image
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
        imagePath = `guestProfile/image_${Date.now()}.jpg`;
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

      Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

      await prisma.guest_profiles.update({ where: { id }, data });

      if (card_type && card_number) {
        await prisma.guest_profiles.update({
          where: { id },
          data: { card_type, card_number, card_expiry: card_expiry || null }
        });
      }

      // Sync types
      await prisma.model_has_types.deleteMany({ where: { model_id: id, model_type: 'App\\Models\\GuestProfile' } });
      const guestTitleId = guest_title?.value ?? guest_title;
      const guestStatusId = guest_status?.value ?? guest_status;
      if (guestTitleId) {
        await prisma.model_has_types.create({
          data: { model_id: id, model_type: 'App\\Models\\GuestProfile', type_id: BigInt(guestTitleId) }
        });
      }
      if (guestStatusId) {
        await prisma.model_has_types.create({
          data: { model_id: id, model_type: 'App\\Models\\GuestProfile', type_id: BigInt(guestStatusId) }
        });
      }

      const updated = await this.getGuestWithRelations(id);
      success(res, GuestController.formatGuest(updated), 'Success');
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

      const where: any = { deleted_at: null };
      if (search) {
        where.OR = [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { account: { contains: search, mode: 'insensitive' } }
        ];
      }
      if (searchField && searchValue) {
        where[searchField] = { contains: searchValue, mode: 'insensitive' };
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
      const where: any = { status: 1, deleted_at: null };

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
        where,
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
      const where: any = { guest_profile_id: BigInt(guestIdRaw) };
      const [data, total] = await Promise.all([
        prisma.folios.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.folios.count({ where }),
      ]);
      success(res, bigintToNumber(data), 'Success', 200, {
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
        data.company_profile_id = (await prisma.company_profiles.findFirst({ where: { deleted_at: null }, orderBy: { id: 'asc' }, select: { id: true } }))?.id;
      }
      if (data.company_profile_id === undefined) { badRequest(res, 'company_profile_id is required'); return; }
      const record = await prisma.folios.create({ data });
      success(res, bigintToNumber(record), 'Folio created successfully', 201);
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
      const where: any = { guest_profile_id: guestId, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.guest_profile_documents.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.guest_profile_documents.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        permission: getPermissionFlags(req.user, 84),
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Document list error:', err); error(res, 'Failed to list documents', 500); }
  }

  static async documentStore(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const pid = req.user?.lastProperty ?? 0n;
      const { file, description, status } = req.body;
      const data = await prisma.guest_profile_documents.create({
        data: { property_id: pid, guest_profile_id: guestId, file, description, status: status ?? 0, created_at: new Date(), created_by: req.user?.id },
      });
      success(res, bigintToNumber(data), 'Document created', 201);
    } catch (err: any) { console.error('Document store error:', err); error(res, 'Failed to create document', 500); }
  }

  static async documentDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      await prisma.guest_profile_documents.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Document deleted');
    } catch (err: any) { error(res, 'Failed to delete document', 500); }
  }

  // ==================== FAMILY MEMBER ====================
  static async familyList(req: Request, res: Response): Promise<void> {
    try {
      const guestId = idParamBig(req.params.guestId);
      const data = await prisma.guest_profile_family_members.findMany({ where: { guest_profile_id: guestId, deleted_at: null } });
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
      success(res, bigintToNumber(data), 'Family member added', 201);
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
      const where: any = { id_guest_profile: guestId, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.guest_profile_histories.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.guest_profile_histories.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('History list error:', err); error(res, 'Failed to list history', 500); }
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
      success(res, bigintToNumber(data), 'Preference added', 201);
    } catch (err: any) { console.error('Preference store error:', err); error(res, 'Failed to add preference', 500); }
  }

  static async preferenceDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      await prisma.guest_profile_preferences.update({ where: { id }, data: { deleted_at: new Date() } });
      success(res, null, 'Preference deleted');
    } catch (err: any) { error(res, 'Failed to delete preference', 500); }
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
      success(res, bigintToNumber(data), 'Loyalty card created', 201);
    } catch (err: any) { console.error('Loyalty store error:', err); error(res, 'Failed to create loyalty card', 500); }
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

      const where: any = { deleted_at: null };
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
  static async mergeUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = BigInt(String(req.params.id));
      // Whitelist (Laravel mergeUpdate uses $user->only([...]) — never mass-assign raw body).
      const ALLOWED = [
        'title', 'first_name', 'last_name', 'email', 'mobile_phone', 'telp', 'gender',
        'birth_of_date', 'nationality_id', 'address', 'city_id', 'country_id', 'postal_code',
        'id_type', 'id_number', 'id_expiry', 'vip_status', 'source', 'remark',
        'status_profile', 'blacklist', 'is_subscribe',
      ];
      const data: any = {};
      for (const key of ALLOWED) {
        if (req.body[key] !== undefined) data[key] = req.body[key];
      }
      const existing = await prisma.guest_profiles.findUnique({ where: { id } });
      if (!existing) { notFound(res, 'Guest profile not found'); return; }

      const guest = await prisma.guest_profiles.update({
        where: { id },
        data: { ...data, updated_at: new Date(), updated_by: req.user?.id ?? null },
      });
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
      success(res, bigintToNumber(noteRow), 'Note created successfully.', 201);
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
        where[searchField] = { contains: searchValue, mode: 'insensitive' };
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
      success(res, bigintToNumber(reverse), 'Family member created successfully.', 201);
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
