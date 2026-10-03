import { Prisma } from '@prisma/client';
import { prisma, pool } from '../config/prisma';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { BILLINGS, REGIONS, STATUSES, TERMS, moneyFormat } from '../utils/cmsConfig';
import { badRequest, error, notFound, success } from '../utils/response';
import { uniqueExtendError } from '../utils/uniqueExtend';
import { storageRoot } from '../utils/storage';
import { TABLES, laravelPaging, listPermission } from '../utils/tableMeta';
import { activeWhere, applyStatusScope, pushCondition, searchPredicate } from '../utils/querySafety';


function bn(v: any): any {
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) {
    const u = v.getUTCFullYear();
    const iso = v.toISOString();
    if (u === 1970 && v.getUTCMonth() === 0 && v.getUTCDate() === 1) return iso.slice(11, 19);
    const s = iso.slice(0, 19).replace('T', ' ');
    return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
  }
  if (v && typeof v.toNumber === 'function') return Number(v.toNumber());
  if (Array.isArray(v)) return v.map(bn);
  if (v && typeof v === 'object') { const o: any = {}; for (const [k, val] of Object.entries(v)) o[k] = bn(val); return o; }
  return v;
}
function moneyN(x: any): number { const n = Number(typeof x === 'object' && x && 'value' in x ? x.value : x); return Number.isFinite(n) ? n : 0; }
function idP(v: any): bigint { return BigInt(Array.isArray(v) ? v[0] : v); }
function idParamBig(v: any): bigint { return BigInt(Array.isArray(v) ? v[0] : v); }

export class CompanyController {

  //  Company Profile 
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const isReservation = !!req.query.reservation;
      const lim = isReservation ? parseInt(req.query.limit as string) || 20 : parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const searchField = req.query.search_field as string;
      const searchValue = req.query.search_value as string;
      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const guestId = req.query.guest_id as string;
      const rateId = req.query.rate_id as string;

      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { deleted_at: trash ? { not: null } : null };
      if (pid) where.property_id = pid;
      applyStatusScope(where, req, 'company_profiles');

      if (isReservation) {
        where.deleted_at = null;
        where.status = 1;
      }

      if (s) {
        where.OR = ['account', 'type_company', 'short_code', 'name', 'status_company', 'billing_country', 'telp', 'mobile_phone', 'email'].map((f) => ({ [f]: { contains: s, mode: 'insensitive' } }));
      }

      if (searchField && searchValue) {
        pushCondition(where, searchPredicate('company_profiles', searchField, searchValue));
      }

      const orderBy: any = isReservation ? { account: 'asc' } : { id: 'desc' };

      const [data, total] = await Promise.all([
        prisma.company_profiles.findMany({ where, orderBy, skip: (page - 1) * lim, take: lim }),
        prisma.company_profiles.count({ where }),
      ]);

      let rows = bn(data).map((r: any, i: number) => ({ ...r, no: (page - 1) * lim + i + 1 }));

      if (guestId) {
        try {
          const guestProfile = await prisma.guest_profiles.findUnique({ where: { id: BigInt(guestId) } });
          if (guestProfile) {
            const recentFolios = await prisma.folios.findMany({
              where: { guest_profile_id: BigInt(guestId), deleted_at: null },
              orderBy: { id: 'desc' },
              take: 3,
              select: { company_profile_id: true },
            });
            const guestCompanyIds = recentFolios.map((f) => f.company_profile_id).filter(Boolean);
            if (guestCompanyIds.length > 0) {
              const guestCompanies = await prisma.company_profiles.findMany({
                where: { id: { in: guestCompanyIds as any } },
              });
              const guestRows = bn(guestCompanies).map((c: any) => ({ ...c, no: 0 }));
              const seen = new Set(guestRows.map((r: any) => r.id));
              const rest = rows.filter((r: any) => !seen.has(r.id));
              rows = [...guestRows, ...rest];
            }
          }
        } catch (e) { /* ignore */ }
      }

      if (rateId) {
        try {
          const rateCompanyLinks = await prisma.model_has_company_profiles.findMany({
            where: { model_type: 'rate', model_id: BigInt(rateId) },
            select: { company_profile_id: true },
          });
          const rateCompanyIds = rateCompanyLinks.map((r) => r.company_profile_id).filter(Boolean);
          if (rateCompanyIds.length > 0) {
            const rateCompaniesData = await prisma.company_profiles.findMany({
              where: { id: { in: rateCompanyIds as any } },
            });
            const rateRows = bn(rateCompaniesData).map((c: any) => ({ ...c, no: 0 }));
            const seen = new Set(rateRows.map((r: any) => r.id));
            const rest = rows.filter((r: any) => !seen.has(r.id));
            rows = [...rateRows, ...rest];
          }
        } catch (e) { /* ignore */ }
      }

      const table = isReservation ? [
        { label: 'Account', key: 'account', type: 'text', is_search: true },
        { label: 'Type', key: 'type_company', type: 'text', is_search: true },
        { label: 'Short Code', key: 'short_code', type: 'text', is_search: true },
        { label: 'Name', key: 'name', type: 'text', is_search: true },
        { label: 'Status', key: 'status_company', type: 'text', is_search: true },
        { label: 'Billing Country', key: 'billing_country', type: 'text', is_search: true },
        { label: 'Telephone', key: 'telp', type: 'text', is_search: true },
        { label: 'Mobile Phone', key: 'mobile_phone', type: 'text', is_search: true },
      ] : TABLES.company;

      // A company's market segment / source live in the model_has_types pivot,
      // not on company_profiles — `sync_mkt_segment_*` is the OTA sync string and
      // is usually empty. The reservation form needs the real selection to
      // pre-fill market segment when a company is picked, so attach it here
      // (PHP: CompanyProfile::formatData derives the same fields from `type`).
      // Batched on the page's ids — attachCompanyTypes() would be N+1.
      if (rows.length > 0) {
        try {
          const ids = rows.map((r: any) => r.id);
          const links = await prisma.model_has_types.findMany({
            where: {
              model_type: 'App\\Models\\CompanyProfile',
              model_id: { in: ids as any[] },
              types: { group: { in: ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'source'] } },
            },
            include: { types: { select: { id: true, name: true, group: true } } },
          });
          const byCompany = new Map<string, any[]>();
          for (const l of links) {
            const k = String(l.model_id);
            const arr = byCompany.get(k);
            if (arr) arr.push(l.types);
            else byCompany.set(k, [l.types]);
          }
          rows = rows.map((r: any) => {
            const types = byCompany.get(String(r.id)) || [];
            const out: any = { ...r };
            for (const t of types) {
              const g = t.group;
              const key = g === 'source' ? 'source' : g.startsWith('market-segment-') ? g.replace(/-/g, '_') : null;
              if (key) out[key] = { value: Number(t.id), label: t.name };
            }
            return out;
          });
        } catch (e) { /* pivot unavailable — leave rows as-is */ }
      }

      success(res, rows, 'Success', 200, {
        table,
        pagination: laravelPaging(total, lim, page),
        permission: isReservation
          ? { view: true, add: false, edit: false, delete: false }
          : listPermission(req, { add: true, edit: true, delete: true }),
      });
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async autocomplete(req: Request, res: Response): Promise<void> {
    try {
      const s = req.query.search as string;
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const where: any = { deleted_at: null };
      if (pid) where.property_id = pid;
      applyStatusScope(where, req, 'company_profiles');
      if (s) where.name = { contains: s, mode: 'insensitive' };
      const data = await prisma.company_profiles.findMany({ where, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 20 });
      success(res, bn(data), 'Success');
    } catch (err: any) { error(res, 'Failed', 500); }
  }

  static async show(req: Request, res: Response): Promise<void> {
    try { const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id; if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; } const id = BigInt(raw); const d = await prisma.company_profiles.findUnique({ where: { id } }); if (!d) { notFound(res); return; } success(res, bn(d), 'Success'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // Replicates Laravel CompanyProfileController@create/edit master.
  static async buildCompanyMaster(req: Request): Promise<{ [key: string]: any }> {
    const pid = BigInt(req.user?.lastProperty ?? 0);
    const groupFilter = ['market-segment-1', 'market-segment-2', 'market-segment-3', 'market-segment-4', 'company-type', 'guest-status', 'source'];
    const [mktSeg, staff, property, countries, cities, codePosts] = await Promise.all([
prisma.types.findMany({
        where: { deleted_at: null, status: 1, property_id: pid, group: { in: groupFilter } },
        select: { id: true, name: true, group: true },
        orderBy: { name: 'asc' },
      }),
      prisma.users.findMany({
        where: { deleted_at: null, ...(req.user?.lastProperty ? { property_id: pid } : {}) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.properties.findUnique({ where: { id: pid } }),
      prisma.countries.findMany({ where: activeWhere('countries'), select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      // Do not fetch all cities to avoid huge payload (413 Request Entity Too Large). Frontend should use autocomplete or filtered API.
      Promise.resolve([]),
      // CodePost is HasProperties-scoped in Laravel
      prisma.code_posts.findMany({ where: activeWhere('code_posts', req.user?.lastProperty ? { property_id: pid } : {}, req.user?.lastProperty), select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const byGroup = (g: string) =>
      mktSeg.filter((t: any) => t.group === g).map((t: any) => ({ value: Number(t.id), label: t.name }));
    const statusGuest = byGroup('guest-status');
    const statusGuestOrdered = [...statusGuest.filter((s: any) => String(s.label).toLowerCase().includes('normal')), ...statusGuest.filter((s: any) => !String(s.label).toLowerCase().includes('normal'))];
    const statusBlacklist = statusGuest.filter((s: any) => String(s.label).toLowerCase().includes('blacklist'));
    return {
      statuses: STATUSES,
      statusGuest: statusGuestOrdered,
      regions: REGIONS,
      typeCompany: byGroup('company-type'),
      billings: BILLINGS,
      terms: TERMS,
      market_segment_1: byGroup('market-segment-1'),
      market_segment_2: byGroup('market-segment-2'),
      market_segment_3: byGroup('market-segment-3'),
      market_segment_4: byGroup('market-segment-4'),
      source: byGroup('source'),
      staff: staff.map((u: any) => ({ value: Number(u.id), label: u.name })),
      markets: property
        ? {
            id: Number(property.id),
            name: property.name,
            email: property.email,
            telp: property.telp == null ? '' : String(property.telp),
            is_tax: { value: !!property.is_tax, label: property.is_tax ? 'Yes' : 'No' },
            is_tax_exclude_restaurant: { value: !!property.is_tax_exclude_restaurant, label: property.is_tax_exclude_restaurant ? 'Yes' : 'No' },
is_tax_exclude_room: { value: !!property.is_tax_exclude_room, label: property.is_tax_exclude_room ? 'Yes' : 'No' },
            is_market_segment_1: !!property.market_segment_1,
            is_market_segment_2: !!property.market_segment_2,
            is_market_segment_3: !!property.market_segment_3,
            is_market_segment_4: !!property.market_segment_4,
            is_source: !!property.source,
          }
        : null,
      statusBlacklist,
      countries: countries.map((c: any) => ({ value: Number(c.id), label: c.name })),
      cities: cities.map((c: any) => ({ value: Number(c.id), label: c.name })),
      code_posts: codePosts.map((c: any) => ({ value: Number(c.id), label: c.name })),
    };
  }

// Sync company type selections (company_type, market_segment_1-4, source, guest_status) via model_has_types
  static async syncCompanyTypes(companyId: bigint, body: any): Promise<void> {
    const groups: any = {
      company_type: 'company-type',
      market_segment_1: 'market-segment-1',
      market_segment_2: 'market-segment-2',
      market_segment_3: 'market-segment-3',
      market_segment_4: 'market-segment-4',
      source: 'source',
      guest_status: 'guest-status',
    };
    const keys = Object.keys(groups);
    if (!keys.some((k) => body[k] !== undefined && body[k] !== null)) return;
    await prisma.model_has_types.deleteMany({ where: { model_id: companyId, model_type: 'App\\Models\\CompanyProfile' } });
    const rows: any[] = [];
    for (const [k, group] of Object.entries(groups)) {
      const raw = body[k];
      if (raw === undefined || raw === null || raw === '') continue;
      const ids = Array.isArray(raw) ? raw.map((o: any) => (o && typeof o === 'object' && 'value' in o ? o.value : o)) : [(raw && typeof raw === 'object' && 'value' in raw) ? raw.value : raw];
      for (const t of ids) {
        if (t !== undefined && t !== null && t !== '') rows.push({ model_id: companyId, model_type: 'App\\Models\\CompanyProfile', type_id: t });
      }
    }
    if (rows.length) await prisma.model_has_types.createMany({ data: rows });
  }

  // Attach type selections to company data for edit form rendering
  static async attachCompanyTypes(d: any): Promise<any> {
    const out: any = { ...bn(d) };
    const types = await prisma.model_has_types.findMany({ where: { model_id: d.id, model_type: 'App\\Models\\CompanyProfile' }, include: { types: true } });
    for (const t of types) {
      const g = t.types?.group;
      if (g === 'company-type') out.company_type = { value: Number(t.type_id), label: t.types?.name };
      else if (g === 'guest-status') out.guest_status = { value: Number(t.type_id), label: t.types?.name };
      else if (g === 'source') out.source = { value: Number(t.type_id), label: t.types?.name };
      else if (g && g.startsWith('market-segment-')) out[g.replace(/-/g, '_')] = { value: Number(t.type_id), label: t.types?.name };
    }

    // Plain string/number selects whose option list uses the same raw value.
    const selectFields = ['type_company', 'billing_region', 'mailing_region', 'term'];
    selectFields.forEach(f => {
      if (out[f] !== null && out[f] !== undefined && out[f] !== '') out[f] = { value: out[f], label: out[f] };
    });

    // Country / city are stored as an id in a text column, so the id has to be
    // resolved to a name and coerced to a Number. Shaping them as
    // `{ value: "360", label: "360" }` never matched the option list (which is
    // `{ value: 360, label: "Indonesia" }`), so the selects rendered blank on
    // edit even though the values were stored correctly.
    const geoIds = (['billing_country', 'billing_city', 'mailing_country', 'mailing_city'] as const).map(
      (f) => ({ f, raw: out[f] }),
    );
    const numOf = (raw: any): number | null => {
      if (raw === null || raw === undefined || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    const countryIds = geoIds.filter((g) => g.f.endsWith('country')).map((g) => numOf(g.raw)).filter((n): n is number => n !== null);
    const cityIds = geoIds.filter((g) => g.f.endsWith('city')).map((g) => numOf(g.raw)).filter((n): n is number => n !== null);
    const [countryRows, cityRows] = await Promise.all([
      countryIds.length
        ? prisma.countries.findMany({ where: { id: { in: countryIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as any[]),
      cityIds.length
        ? prisma.cities.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true } })
        : Promise.resolve([] as any[]),
    ]);
    const countryName = new Map(countryRows.map((c: any) => [Number(c.id), c.name]));
    const cityName = new Map(cityRows.map((c: any) => [Number(c.id), c.name]));
    for (const g of geoIds) {
      const id = numOf(g.raw);
      if (id === null) {
        out[g.f] = null;
        continue;
      }
      const name = g.f.endsWith('country') ? countryName.get(id) : cityName.get(id);
      out[g.f] = { value: id, label: name ?? String(id) };
    }

    // `staff_in_charge` and `billing` are also rendered as selects but were
    // left as raw values, which react-select cannot render a selection for.
    if (out.staff_in_charge !== null && out.staff_in_charge !== undefined && out.staff_in_charge !== '') {
      const sid = Number(out.staff_in_charge);
      if (Number.isFinite(sid)) {
        const staffRow = await prisma.users
          .findFirst({ where: { id: BigInt(sid) }, select: { name: true } })
          .catch(() => null);
        out.staff_in_charge = { value: sid, label: staffRow?.name ?? String(sid) };
      }
    }
    if (out.billing !== null && out.billing !== undefined && out.billing !== '') {
      const billingVal = Number(out.billing);
      const billingOpt = BILLINGS.find((b: any) => b.value === billingVal);
      out.billing = { value: billingVal, label: billingOpt?.label ?? String(out.billing) };
    }

    // Booleans and `status` are rendered as toggles, not selects. Shaping them
    // as `{ value, label }` made React coerce the object to `checked` (always
    // truthy), so every toggle showed the wrong state and the next save wrote
    // the inverted value. They must go back as plain booleans.
    ['gst', 'is_stop_credit', 'is_pay_commission', 'is_charge_back', 'is_surcharge_opt_out'].forEach(f => {
      if (out[f] !== null && out[f] !== undefined) out[f] = !!out[f];
    });

    if (out.status !== null && out.status !== undefined) out.status = !!out.status;
    if (out.blacklist !== null && out.blacklist !== undefined) out.blacklist = !!out.blacklist;

    out.credit_limit = moneyFormat(d.credit_limit);
    try {
      // @ts-ignore
      const r = await pool.query('SELECT remaining FROM company_profiles WHERE id = $1', [String(d.id)]);
      const rem = r.rows?.[0]?.remaining;
      out.remaining = rem != null ? moneyFormat(Number(rem)) : 0;
    } catch { out.remaining = 0; }
    return out;
  }

  static async createForm(req: Request, res: Response): Promise<void> {
    try {
      const master = await CompanyController.buildCompanyMaster(req);
      if (req.params.id !== undefined) {
        const id = idP(req.params.id);
        const d = await prisma.company_profiles.findUnique({ where: { id } });
        if (!d) { notFound(res); return; }
        success(res, await CompanyController.attachCompanyTypes(d), 'Success', 200, { master });
        return;
      }
      success(res, { status: 1, guest_status: master.statusGuest?.[0] ?? null }, 'Success', 200, {
        master,
      });
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async store(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { name, email, telp, mobile_phone, billing_address, billing_city, billing_country, credit_limit, status } = req.body;
      const v = (k: string): any => { const x = req.body[k]; return x && typeof x === 'object' && 'value' in x ? x.value : x; };
      const b = (k: string): any => { const x = v(k); return x === true || x === 1 || x === '1' || x === 'true' ? true : (x === false || x === 0 || x === '0' || x === 'false' ? false : undefined); };
      if (!name) { badRequest(res, 'name required'); return; }
      // Laravel CompanyProfileController@store:253
      // 'name' => [... 'unique_extend:company_profiles,name,NULL,id,deleted_at,NULL']
      // Property-scoped: company_profiles carries property_id and each property keeps
      // its own book of companies (this dataset has 21 name groups duplicated
      // globally), so a literal global check would reject valid rows.
      const dupName = await uniqueExtendError(prisma, 'company_profiles', 'name', 'name', name, null, {
        property_id: pid,
      });
      if (dupName) { badRequest(res, dupName); return; }
      const d = await prisma.company_profiles.create({
        data: {
          property_id: pid, name, type_company: v('type_company') || 'Corporate', email, telp, mobile_phone,
          billing_address, billing_city, billing_country,
          billing_region: v('billing_region'), billing_postal_code: v('billing_postal_code'),
          mailing_address: v('mailing_address'), mailing_region: v('mailing_region'), mailing_country: v('mailing_country'), mailing_city: v('mailing_city'), mailing_postal_code: v('mailing_postal_code'),
          term: v('term'), remarks: v('remarks'), short_code: v('short_code'), description: v('description'),
          business_regional: v('business_regional'), IATA: v('IATA'),
          website: v('website'), fax: v('fax'), staff_in_charge: v('staff_in_charge'),
          // `billing` is a 0/1 flag (config cms.billing: By Company / By Department)
          // in a *string* column, and the form returns it as {value,label}. Passing
          // the raw number made Prisma reject it ("Expected String or Null,
          // provided Int"), so a new company could never be saved.
          billing: v('billing') === undefined || v('billing') === null ? v('billing') : String(v('billing')),
          gst: b('gst'), is_stop_credit: b('is_stop_credit'), is_pay_commission: b('is_pay_commission'), is_charge_back: b('is_charge_back'), is_surcharge_opt_out: b('is_surcharge_opt_out'), blacklist: b('blacklist'),
          commission_rate: v('commission_rate') ?? undefined, based_online_commission: v('based_online_commission') ?? undefined,
          // `status` is a toggle on the client, so it arrives as a boolean while
          // the column is a 0/1 int — Prisma rejected the boolean outright.
          credit_limit: moneyN(credit_limit),
          status: status === undefined ? 1 : (status === true || status === 1 || status === '1' ? 1 : 0),
          code_billing_id: '', created_at: new Date(), updated_at: new Date(), created_by: req.user?.id,
        },
      });
      // @ts-ignore
      await pool.query('UPDATE company_profiles SET remaining = $1 WHERE id = $2', [moneyN(credit_limit), String(d.id)]);
      await CompanyController.syncCompanyTypes(d.id, req.body);
      success(res, await CompanyController.attachCompanyTypes(d), 'Created');
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async update(req: Request, res: Response): Promise<void> {
    try {
      const id = idP(req.params.id); const existing = await prisma.company_profiles.findUnique({ where: { id } });
      if (!existing) { notFound(res); return; }
      const { name, email, telp, mobile_phone, billing_address, billing_city, billing_country, credit_limit, status } = req.body;
      const v = (k: string): any => { const x = req.body[k]; return x && typeof x === 'object' && 'value' in x ? x.value : x; };
      const b = (k: string): any => { const x = v(k); return x === true || x === 1 || x === '1' || x === 'true' ? true : (x === false || x === 0 || x === '0' || x === 'false' ? false : undefined); };
      // Laravel CompanyProfileController@update:503 (own id excluded).
      if (name !== undefined) {
        const dupName = await uniqueExtendError(prisma, 'company_profiles', 'name', 'name', name, id, {
          property_id: existing.property_id,
        });
        if (dupName) { badRequest(res, dupName); return; }
      }
      const data: any = { updated_at: new Date() };
      if (name !== undefined) data.name = name;
      // `type_company` is a select, so the form posts {value,label}. Assigning the
      // raw object made Prisma reject the whole update ("Unknown argument `value`"),
      // which is why editing a company always failed. Unwrap it like every other
      // shaped field.
      if (v('type_company') !== undefined) data.type_company = v('type_company');
      if (email !== undefined) data.email = email; if (telp !== undefined) data.telp = telp;
      if (mobile_phone !== undefined) data.mobile_phone = mobile_phone; if (billing_address !== undefined) data.billing_address = billing_address;
      if (billing_city !== undefined) data.billing_city = billing_city; if (billing_country !== undefined) data.billing_country = billing_country;
      for (const k of ['billing_region', 'billing_postal_code', 'mailing_address', 'mailing_region', 'mailing_country', 'mailing_city', 'mailing_postal_code', 'term', 'remarks', 'short_code', 'description', 'business_regional', 'IATA', 'website', 'fax', 'staff_in_charge']) {
        if (v(k) !== undefined) data[k] = v(k);
      }
      // `billing` is a 0/1 flag in a string column - see store() above.
      if (v('billing') !== undefined) data.billing = v('billing') === null ? null : String(v('billing'));
      for (const k of ['gst', 'is_stop_credit', 'is_pay_commission', 'is_charge_back', 'is_surcharge_opt_out', 'blacklist']) {
        if (b(k) !== undefined) data[k] = b(k);
      }
      if (v('commission_rate') !== undefined) data.commission_rate = Number(v('commission_rate'));
      if (v('based_online_commission') !== undefined) data.based_online_commission = Number(v('based_online_commission'));
      if (credit_limit !== undefined) data.credit_limit = moneyN(credit_limit);
      // `status` is a toggle, so the client sends a boolean. Normalise to the
      // 0/1 the column stores — passing an object here silently landed on 0.
      if (status !== undefined) data.status = status === true || status === 1 || status === '1' ? 1 : 0;
      const origCL = Number(existing.credit_limit ?? 0);
      const newCL = credit_limit !== undefined ? moneyN(credit_limit) : origCL;
      if (credit_limit !== undefined && newCL !== origCL) {
        // @ts-ignore
        const rr = await pool.query('SELECT remaining FROM company_profiles WHERE id = $1', [String(id)]);
        const oldRem = rr.rows?.[0]?.remaining != null ? Number(rr.rows[0].remaining) : 0;
        // @ts-ignore
        await pool.query('UPDATE company_profiles SET remaining = $1 WHERE id = $2', [(newCL - origCL) + oldRem, String(id)]);
      }
      await prisma.company_profiles.update({ where: { id }, data });
      await CompanyController.syncCompanyTypes(id, req.body);
      const d = await prisma.company_profiles.findUnique({ where: { id } });
      success(res, await CompanyController.attachCompanyTypes(d), 'Updated');
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async destroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profiles.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  //  Client (Client menu = Laravel CompanyController, table `companies`) 
  static async clientFormat(d: any, props: string): Promise<any> {
    return {
      id: Number(d.id),
      ip: d.ip,
      name: d.name,
      email: d.email,
      contract_expired: d.contract_expired,
      join_date: d.join_date,
      npwp: d.npwp,
      no_tlp: d.no_tlp,
      pic_name: d.pic_name,
      created_at: d.created_at,
      created_by: d.created_by ? Number(d.created_by) : null,
      properties: props,
      status: { value: !!d.status, label: d.status ? 'Active' : 'Inactive' },
    };
  }

  static async clientList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const trash = req.query.trash === '1' || req.query.trash === 'true';
      const where: any = { deleted_at: trash ? { not: null } : null };
      applyStatusScope(where, req, 'companies');
      if (s) where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { ip: { contains: s, mode: 'insensitive' } },
        { npwp: { contains: s, mode: 'insensitive' } },
        { no_tlp: { contains: s, mode: 'insensitive' } },
      ];
      const [data, total, links] = await Promise.all([
        prisma.companies.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }),
        prisma.companies.count({ where }),
        prisma.model_has_companies.findMany({ where: { model_type: 'App\\Models\\Property' }, include: { companies: { select: { id: true } } } }),
      ]);
      const propNames = await prisma.properties.findMany({ where: { id: { in: [...new Set(links.map((l: any) => l.model_id))] } }, select: { id: true, name: true } });
      const byCompany: any = {};
      for (const l of links) {
        const cid = Number(l.company_id);
        (byCompany[cid] = byCompany[cid] || []).push(propNames.find((p: any) => p.id === l.model_id)?.name || '');
      }
      const rows = bn(data).map((r: any, i: number) => ({
        no: (page - 1) * lim + i + 1,
        ...r,
        properties: (byCompany[r.id] || []).filter(Boolean).join(', '),
        status: { value: !!r.status, label: r.status ? 'Active' : 'Inactive' },
      }));
      success(res, rows, 'Success', 200, {
        table: TABLES.company,
        pagination: laravelPaging(total, lim, page),
        permission: listPermission(req, { add: true, edit: true, delete: true }),
      });
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async clientShow(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res); return; }
      const id = BigInt(raw);
      const d = await prisma.companies.findUnique({ where: { id } });
      if (!d) { notFound(res); return; }
      success(res, await CompanyController.clientFormat(d, ''), 'Success');
    } catch (err: any) { error(res, 'Failed', 500); }
  }

  static async clientCreateForm(req: Request, res: Response): Promise<void> {
    try {
      const master = { statuses: STATUSES };
      if (req.params.id !== undefined) {
        const id = idP(req.params.id);
        const d = await prisma.companies.findUnique({ where: { id } });
        if (!d) { notFound(res); return; }
        const links = await prisma.model_has_companies.findMany({ where: { company_id: id, model_type: 'App\\Models\\Property' } });
        const props = await prisma.properties.findMany({ where: { id: { in: links.map((l: any) => l.model_id) } }, select: { name: true } });
        success(res, await CompanyController.clientFormat(d, props.map((p: any) => p.name).join(', ')), 'Success', 200, { master });
        return;
      }
      success(res, {}, 'Success', 200, { master });
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async clientStore(req: Request, res: Response): Promise<void> {
    try {
      const { name, email, ip, contract_expired, join_date, npwp, no_tlp, pic_name, status } = req.body;
      if (!name) { badRequest(res, 'name required'); return; }
      if (email) {
        const dup = await prisma.companies.findFirst({ where: { email, deleted_at: null } });
        if (dup) { badRequest(res, 'The email has already been taken.'); return; }
      }
      const d = await prisma.companies.create({
        data: {
          name, email, ip, contract_expired: contract_expired || null, join_date: join_date || null,
          npwp, no_tlp, pic_name,
          status: status === true || status === 'true' || status === 1 || status?.value === 1 ? 1 : 0,
          created_at: new Date(), updated_at: new Date(), created_by: req.user?.id,
        },
      });
      success(res, await CompanyController.clientFormat(d, ''), 'Created');
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async clientUpdate(req: Request, res: Response): Promise<void> {
    try {
      const id = idP(req.params.id);
      const existing = await prisma.companies.findUnique({ where: { id } });
      if (!existing) { notFound(res); return; }
      const { name, email, ip, contract_expired, join_date, npwp, no_tlp, pic_name, status } = req.body;
      if (name !== undefined && !name) { badRequest(res, 'name required'); return; }
      if (email) {
        const dup = await prisma.companies.findFirst({ where: { email, deleted_at: null, NOT: { id } } });
        if (dup) { badRequest(res, 'The email has already been taken.'); return; }
      }
      const data: any = { updated_at: new Date() };
      if (name !== undefined) data.name = name;
      if (email !== undefined) data.email = email;
      if (ip !== undefined) data.ip = ip;
      if (contract_expired !== undefined) data.contract_expired = contract_expired || null;
      if (join_date !== undefined) data.join_date = join_date || null;
      if (npwp !== undefined) data.npwp = npwp;
      if (no_tlp !== undefined) data.no_tlp = no_tlp;
      if (pic_name !== undefined) data.pic_name = pic_name;
      if (status !== undefined) data.status = status === true || status === 'true' || status === 1 || status?.value === 1 ? 1 : 0;
      const d = await prisma.companies.update({ where: { id }, data });
      success(res, await CompanyController.clientFormat(d, ''), 'Updated');
    } catch (err: any) { console.error(err); error(res, 'Failed', 500); }
  }

  static async clientDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.companies.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  //  Contact Person 
  static async contactList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const companyId = req.query.company_id as string;
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const where: any = { deleted_at: null }; if (pid) where.property_id = pid;
      if (companyId) where.company_profile_id = BigInt(companyId);
      if (s) where.OR = [{ name: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }, { position: { contains: s, mode: 'insensitive' } }];
      const [data, total] = await Promise.all([prisma.company_profile_contact_persons.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }), prisma.company_profile_contact_persons.count({ where })]);
      let table = TABLES.companyContact;
      if (companyId) {
        const depts = await prisma.company_profile_departments.findMany({ where: { company_profile_id: BigInt(companyId) }, select: { id: true, department: true } });
        if (depts.length) table = table.map((c: any) => c.key === 'department' ? { ...c, options: depts.map((d: any) => ({ value: Number(d.id), label: d.department })) } : c);
      }
      success(res, bn(data), 'Success', 200, { table, permission: listPermission(req, { add: true, edit: true, delete: true }), search_data: s ? [{ field: s, value: s }] : [], pagination: laravelPaging(total, lim, page) });
    } catch (err: any) { console.error('Company contact list error:', err); error(res, 'Failed', 500); }
  }
  static async contactStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id = req.query.company_id as string, name, position, email, tel, mobile_phone, is_default } = req.body;
      const d = await prisma.company_profile_contact_persons.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), name, position, email, tel, mobile_phone, is_default: is_default ?? false, created_at: new Date(), updated_at: new Date() } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async contactUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); const { name, position, email, tel, mobile_phone, is_default } = req.body; const data: any = { updated_at: new Date() };
      if (name !== undefined) data.name = name; if (position !== undefined) data.position = position; if (email !== undefined) data.email = email;
      if (tel !== undefined) data.tel = tel; if (mobile_phone !== undefined) data.mobile_phone = mobile_phone; if (is_default !== undefined) data.is_default = is_default;
      await prisma.company_profile_contact_persons.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async contactDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_contact_persons.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }
  // Laravel CompanyProfileContactPersonController@getContactPerson (GET /profile/company/contactPerson/:id)
  static async contactPersonByCompany(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { badRequest(res, 'Company profile id is required'); return; }
      const data = await prisma.company_profile_contact_persons.findMany({
        where: { company_profile_id: BigInt(raw), status: 1, deleted_at: null },
        orderBy: { is_default: 'desc' },
        select: { id: true, name: true },
      });
      res.json({ code: 200, message: 'Success', data: data.map((c: any) => ({ value: Number(c.id), label: c.name })) });
    } catch (err: any) { console.error('Contact person by company error:', err); error(res, 'Failed', 500); }
  }

  //  Department 
  static async deptList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const companyId = req.query.company_id as string;
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const where: any = { deleted_at: null }; if (pid) where.property_id = pid;
      if (companyId) where.company_profile_id = BigInt(companyId);
      if (s) where.OR = [{ department: { contains: s, mode: 'insensitive' } }, { address: { contains: s, mode: 'insensitive' } }];
      const [data, total] = await Promise.all([prisma.company_profile_departments.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }), prisma.company_profile_departments.count({ where })]);
      success(res, bn(data), 'Success', 200, { table: TABLES.companyDepartment, permission: listPermission(req, { add: true, edit: true, delete: true }), search_data: s ? [{ field: s, value: s }] : [], pagination: laravelPaging(total, lim, page) });
    } catch (err: any) { console.error('Company department list error:', err); error(res, 'Failed', 500); }
  }
  static async deptStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id = req.query.company_id as string, department, country_id, city_id, address, postal_code } = req.body;
      const d = await prisma.company_profile_departments.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), department, country_id: country_id ? BigInt(country_id) : null, city_id: city_id ? BigInt(city_id) : null, address, postal_code, created_at: new Date(), updated_at: new Date() } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async deptUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); const { department, country_id, city_id, address, postal_code } = req.body; const data: any = { updated_at: new Date() };
      if (department !== undefined) data.department = department; if (country_id !== undefined) data.country_id = BigInt(country_id); if (city_id !== undefined) data.city_id = BigInt(city_id);
      if (address !== undefined) data.address = address; if (postal_code !== undefined) data.postal_code = postal_code;
      await prisma.company_profile_departments.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async deptDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_departments.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  //  Activity 
  static async activityList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const companyId = req.query.company_id as string;
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const where: any = { deleted_at: null }; if (pid) where.property_id = pid;
      if (companyId) where.company_profile_id = BigInt(companyId);
      if (s) where.OR = [{ subject: { contains: s, mode: 'insensitive' } }, { objective: { contains: s, mode: 'insensitive' } }];
      const [data, total] = await Promise.all([prisma.company_profile_activities.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }), prisma.company_profile_activities.count({ where })]);
      success(res, bn(data), 'Success', 200, { table: TABLES.companyActivity, permission: listPermission(req, { add: true, edit: true, delete: true }), search_data: s ? [{ field: s, value: s }] : [], pagination: laravelPaging(total, lim, page) });
    } catch (err: any) { console.error('Company activity list error:', err); error(res, 'Failed', 500); }
  }
  static async activityStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id = req.query.company_id as string, date, subject, objective, notes, status } = req.body;
      const d = await prisma.company_profile_activities.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), date: new Date(date || Date.now()), subject, objective, notes, status: status === true || status === 'true' || status === 1 ? 1 : 0, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id ? BigInt(req.user.id) : null } }); success(res, bn(d), 'Created');
    } catch (err: any) { console.error('activityStore error:', err); error(res, 'Failed', 500); }
  }
  static async activityUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); const { date, subject, objective, notes } = req.body; const data: any = { updated_at: new Date() };
      if (date !== undefined) data.date = new Date(date); if (subject !== undefined) data.subject = subject; if (objective !== undefined) data.objective = objective;
      if (notes !== undefined) data.notes = notes; await prisma.company_profile_activities.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async activityDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_activities.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  //  Document 
  static async documentList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const companyId = req.query.company_id as string;
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const where: any = { deleted_at: null }; if (pid) where.property_id = pid;
      if (companyId) where.company_profile_id = BigInt(companyId);
      if (s) where.OR = [{ file: { contains: s, mode: 'insensitive' } }, { description: { contains: s, mode: 'insensitive' } }];
      const [data, total] = await Promise.all([prisma.company_profile_documents.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }), prisma.company_profile_documents.count({ where })]);
      success(res, bn(data), 'Success', 200, { table: TABLES.companyDocument, permission: listPermission(req, { add: true, edit: true, delete: true }), search_data: s ? [{ field: s, value: s }] : [], pagination: laravelPaging(total, lim, page) });
    } catch (err: any) { console.error('Company document list error:', err); error(res, 'Failed', 500); }
  }
  static async documentStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { company_profile_id = req.query.company_id as string, file, description } = req.body;
      if (!company_profile_id) { badRequest(res, 'company_profile_id required'); return; }
      let fileName: string | null = file ?? null;
      let filePath: string | null = null;
      // Path A: multipart upload (= Laravel store('company-documents','public'))
      if ((req as any).file) {
        const f = (req as any).file as Express.Multer.File;
        const ext = f.originalname.split('.').pop()?.toLowerCase() || 'dat';
        fileName = f.originalname;
        filePath = `guest-documents/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const abs = path.join(storageRoot(), filePath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.buffer);
      }
      const d = await prisma.company_profile_documents.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), file: fileName, file_path: filePath, description, created_at: new Date(), updated_at: new Date() } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async documentUpdate(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); const { file, description } = req.body; const data: any = { updated_at: new Date() };
      if (file !== undefined) data.file = file; if (description !== undefined) data.description = description;
      await prisma.company_profile_documents.update({ where: { id }, data }); success(res, null, 'Updated');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async documentDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_documents.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  //  Guest 
  static async guestList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const companyId = req.query.company_id as string;
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const where: any = { deleted_at: null }; if (pid) where.property_id = pid;
      if (companyId) where.company_profile_id = BigInt(companyId);
      if (s) where.OR = [{ first_name: { contains: s, mode: 'insensitive' } }, { last_name: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }, { mobile_phone: { contains: s, mode: 'insensitive' } }];
      const [data, total] = await Promise.all([prisma.company_guests.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }), prisma.company_guests.count({ where })]);
      success(res, bn(data), 'Success', 200, { table: TABLES.companyGuest, permission: listPermission(req, { add: true, edit: true, delete: true }), search_data: s ? [{ field: s, value: s }] : [], pagination: laravelPaging(total, lim, page) });
    } catch (err: any) { console.error('Company guest list error:', err); error(res, 'Failed', 500); }
  }
  static async guestStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { company_profile_id = req.query.company_id as string, first_name, last_name, email, mobile_phone } = req.body;
      if (!company_profile_id) { badRequest(res, 'company_profile_id required'); return; }
      const d = await prisma.company_guests.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), first_name, last_name, email, mobile_phone, created_at: new Date(), updated_at: new Date() } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async guestDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_guests.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  //  Folio 
  static async folioList(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const companyId = req.query.company_id as string;
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const where: any = { property_id: pid, deleted_at: null };
      if (companyId) where.company_profile_id = BigInt(companyId);
      if (s) {
        where.OR = [
          { folio_number: { contains: s, mode: 'insensitive' } },
        ];
      }
      const [data, total] = await Promise.all([
        prisma.folios.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * lim, take: lim }),
        prisma.folios.count({ where })
      ]);
      success(res, bn(data), 'Success', 200, {
        table: TABLES.guestFolio,
        permission: listPermission(req, { add: true, edit: true, delete: true }),
        pagination: laravelPaging(total, lim, page)
      });
    } catch (err: any) { error(res, 'Failed', 500); }
  }

//  Statistic 
  // Laravel CompanyProfileStatisticController@index parity: group RESERVATIONS by month
  // (F Y) for the company's folios — ARR = room_revenue / room_night.
  static async statisticIndex(req: Request, res: Response): Promise<void> {
    try {
      const companyId = req.query.company_id as string;
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 99999;
      // Aggregate in SQL instead of loading every reservation row: the folio list
      // here is ~41k ids, and sending them as an `IN (...)` list made this the
      // slowest endpoint in the suite.
      const companyFilter = companyId ? Prisma.sql`AND f.company_profile_id = ${BigInt(companyId)}` : Prisma.empty;
      const rows: any[] = await prisma.$queryRaw`
        SELECT
          to_char(r.date, 'Month YYYY') AS month_key,
          to_char(r.date, 'MM') AS month_sort,
          to_char(r.date, 'YYYY') AS year_sort,
          COUNT(*)::bigint AS room_night,
          COALESCE(SUM(r.amount), 0) AS room_revenue
        FROM reservations r
        JOIN folios f ON f.id = r.folio_id
        WHERE f.status_reservation IS DISTINCT FROM 2
          AND ((f.parent = 0 AND f.type_reservation = 'fit')
               OR (f.type_reservation = 'git' AND f.parent IS DISTINCT FROM 0))
          ${companyFilter}
        GROUP BY month_key, month_sort, year_sort
        ORDER BY year_sort DESC, month_sort DESC
      `;
      const result = rows.map((r: any) => ({
        month: String(r.month_key).trim(),
        arr: moneyFormat(Number(r.room_night) ? Number(r.room_revenue) / Number(r.room_night) : 0),
        room_night: Number(r.room_night),
        room_revenue: moneyFormat(Number(r.room_revenue)),
      }));
      success(res, result, 'Success', 200, {
        table: TABLES.companyStatistic,
        permission: listPermission(req, { add: true }),
        search_data: [],
        pagination: laravelPaging(result.length, lim, page),
      });
    } catch (err: any) { console.error('Company statistic list error:', err); error(res, 'Failed', 500); }
  }

  //  Company Folio store/destroy (CompanyProfileFolioController parity) 
  static async folioStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { company_profile_id = req.query.company_id as string, check_in_date, check_out_date, name, booking_agent, folio, status } = req.body;
      if (!company_profile_id) { badRequest(res, 'company_profile_id is required'); return; }
      const d = await prisma.folios.create({ data: {
        property_id: pid,
        company_profile_id: BigInt(company_profile_id),
        check_in_date: check_in_date ? new Date(check_in_date) : undefined,
        check_out_date: check_out_date ? new Date(check_out_date) : undefined,
        first_name: name ?? undefined,
        booking_agent_id: booking_agent ? BigInt(booking_agent) : undefined,
        folio_number: folio ?? undefined,
        is_compliment_tour_leader: false,
        type_reservation: 'fit',
        status: status !== undefined ? Number(status) : 1,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: req.user?.id,
      } });
      success(res, bn(d), 'Folio created successfully', 200);
    } catch (err: any) { console.error('Company folio store error:', err); error(res, 'Failed to create folio', 500); }
  }

  static async folioDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const record = await prisma.folios.findUnique({ where: { id } });
      if (!record) { notFound(res, 'Not Found'); return; }
      await prisma.folios.update({ where: { id }, data: { deleted_at: new Date(), updated_at: new Date() } });
      success(res, [], 'Folio deleted successfully');
    } catch (err: any) { console.error('Company folio destroy error:', err); error(res, 'Failed to delete folio', 500); }
  }

  //  Statistic store/destroy (CompanyProfileStatisticController parity) 
  static async statisticStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { company_id = req.query.company_id as string, month, room_night, room_revenue, other_revenue } = req.body;
      if (!company_id) { badRequest(res, 'company_id is required'); return; }
      const d = await prisma.company_profile_statistics.create({ data: {
        property_id: pid,
        company_profile_id: BigInt(company_id),
        month: month ? new Date(month) : undefined,
        room_night: room_night !== undefined ? Number(room_night) : 0,
        room_revenue: room_revenue !== undefined ? Number(room_revenue) : 0,
        other_revenue: other_revenue !== undefined ? Number(other_revenue) : 0,
        status: 1,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: req.user?.id,
      } });
      success(res, bn(d), 'Statistic created successfully', 200);
    } catch (err: any) { console.error('Statistic store error:', err); error(res, 'Failed to create statistic', 500); }
  }

  static async statisticDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const record = await prisma.company_profile_statistics.findUnique({ where: { id } });
      if (!record) { notFound(res, 'Not Found'); return; }
      await prisma.company_profile_statistics.update({ where: { id }, data: { deleted_at: new Date(), updated_at: new Date() } });
      success(res, [], 'Statistic deleted successfully');
    } catch (err: any) { console.error('Statistic destroy error:', err); error(res, 'Failed to delete statistic', 500); }
  }

// — AR Transaction (Laravel parity: query `transactions` by model_type/model_id, folio not cancelled)
  static async arTransactionList(req: Request, res: Response): Promise<void> {
    try {
      const companyId = req.query.company_id as string;
      const page = parseInt(req.query.page as string) || 1;
      const lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const where: any = {
        model_type: 'App\\Models\\CompanyProfile',
        model_id: companyId ? BigInt(companyId) : undefined,
        type: { in: ['room_revenue', 'manual_posting', 'additional_item'] },
        folios: { is: { status_reservation: { not: 2 } } },
      };
      if (s) where.OR = [{ folios: { is: { folio_number: { contains: s, mode: 'insensitive' } } } }];
      const totalData = await prisma.transactions.count({ where });
      const data = await prisma.transactions.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * lim,
        take: lim,
        include: { folios: { select: { folio_number: true } } },
      });
      const result = data.map((t) => ({
        date: t.date ? t.date.toISOString().slice(0, 10) : '',
        folio_number: t.folios?.folio_number ?? '',
        total: moneyFormat(Number(t.amount)),
      }));
      success(res, result, 'Success', 200, {
        table: [
          { label: 'Date', key: 'date', type: 'none', is_search: true },
          { label: 'Description', key: 'folio_number', type: 'none', is_search: true },
          { label: 'Total', key: 'total', type: 'none', is_search: false },
        ],
        pagination: laravelPaging(totalData, lim, page),
        permission: listPermission(req, { add: true }),
        search_data: s ? [{ field: s, value: s }] : [],
      });
    } catch (err: any) { console.error('AR transaction list error:', err); error(res, 'Failed', 500); }
  }
  static async arTransactionStore(req: Request, res: Response): Promise<void> {
    try { const pid = BigInt(req.user?.lastProperty ?? 0); const { company_profile_id = req.query.company_id as string, transaction_code, document, date, description, amount } = req.body;
      const d = await prisma.company_profile_ar_transactions.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), transaction_code, document, date: new Date(date || Date.now()), description: description || '', amount: amount ?? 0, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id } }); success(res, bn(d), 'Created');
    } catch (err: any) { error(res, 'Failed', 500); }
  }
  static async arTransactionDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_ar_transactions.update({ where: { id }, data: { deleted_at: new Date() } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

// Company Profile Billing Setup
  // Laravel CompanyProfileBillingSetupController@index parity: row per ACTIVE code_billing,
  // billing flag = existing setup billing (default 1).
  static async billingSetupList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1, lim = parseInt(req.query.limit as string) || 10;
      const s = req.query.search as string;
      const companyId = req.query.company_id as string;
      const [companyBilling, codeBillings] = await Promise.all([
        prisma.company_profile_billing_setups.findMany({ where: activeWhere('company_profile_billing_setups', { ...(companyId ? { company_profile_id: BigInt(companyId) } : {}), ...(req.user?.lastProperty ? { property_id: req.user.lastProperty } : {}) }, req.user?.lastProperty) }),
        prisma.code_billings.findMany({ where: activeWhere('code_billings', req.user?.lastProperty ? { property_id: req.user.lastProperty } : {}, req.user?.lastProperty), orderBy: { sort: 'asc' } }),
      ]);
      let data = codeBillings.map((code) => {
        const setup = companyBilling.find((b) => String(b.code_billing_id) === String(code.id));
        return {
          id: Number(code.id),
          code_billing_id: { value: Number(code.id), label: code.name },
          billing: setup ? Number(setup.billing) : 1,
        };
      });
      if (s) data = data.filter((d) => String((d.code_billing_id as any).label).toLowerCase().includes(s.toLowerCase()));
      const total = data.length;
      success(res, data.slice((page - 1) * lim, page * lim), 'Success', 200, {
        table: TABLES.companyBillingSetup,
        permission: listPermission(req, { add: true, edit: true }),
        search_data: s ? [{ field: s, value: s }] : [],
        pagination: laravelPaging(total, lim, page),
      });
    } catch (err: any) { console.error('Billing setup list error:', err); error(res, 'Failed', 500); }
  }
  static async billingSetupStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const { company_profile_id = req.query.company_id as string, code_billing_id, billing } = req.body;
      const d = await prisma.company_profile_billing_setups.create({ data: { property_id: pid, company_profile_id: BigInt(company_profile_id), code_billing_id: BigInt(code_billing_id), billing, status: 1, created_at: new Date(), updated_at: new Date(), created_by: req.user?.id } });
      success(res, bn(d), 'Created');
    } catch (err: any) { console.error('Billing setup store error:', err); error(res, 'Failed', 500); }
  }
static async billingSetupDestroy(req: Request, res: Response): Promise<void> {
    try { const id = idP(req.params.id); await prisma.company_profile_billing_setups.update({ where: { id }, data: { deleted_at: new Date(), deleted_by: req.user?.id } }); success(res, null, 'Deleted'); } catch (err: any) { error(res, 'Failed', 500); }
  }

  // PUT /company-profile-billing-setup/:codeBillingId + ?company_id — Laravel
  // CompanyProfileBillingSetupController@update (:69-112): upsert billing flag per (code_billing, company).
  static async billingSetupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const codeBillingId = idP(req.params.id);
      const companyIdRaw = String(req.body?.company_id ?? req.query.company_id ?? '');
      if (!companyIdRaw || !/^\d+$/.test(companyIdRaw)) { badRequest(res, 'The company id field is required.'); return; }
      const companyId = BigInt(companyIdRaw);

      const codeBilling = await prisma.code_billings.findUnique({ where: { id: codeBillingId } });
      if (!codeBilling) { notFound(res, 'Code billing not found'); return; }

      const existing = await prisma.company_profile_billing_setups.findFirst({
        where: { code_billing_id: codeBillingId, company_profile_id: companyId, deleted_at: null },
      });
      if (!existing) {
        const created = await prisma.company_profile_billing_setups.create({
          data: {
            property_id: req.user?.lastProperty ?? 0n,
            company_profile_id: companyId,
            code_billing_id: codeBillingId,
            billing: req.body?.billing ?? null,
            status: 1,
            created_at: new Date(),
            updated_at: new Date(),
            created_by: req.user?.id,
          },
        });
        success(res, bn(created), 'Billing setup updated successfully.', 200);
        return;
      }
      if (!existing) { badRequest(res, 'Billing setup not found'); return; }
      await prisma.company_profile_billing_setups.update({
        where: { id: existing.id },
        data: { billing: req.body?.billing ?? existing.billing, updated_at: new Date(), updated_by: req.user?.id },
      });
      const updatedRow = await prisma.company_profile_billing_setups.findUnique({ where: { id: existing.id } });
      success(res, bn(updatedRow), 'Billing setup updated successfully.', 200);
    } catch (err: any) { console.error('Billing setup update error:', err); error(res, 'Failed', 500); }
  }
}

