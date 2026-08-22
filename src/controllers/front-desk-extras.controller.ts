import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest } from '../utils/response';
import { moneyFormat } from '../utils/cmsConfig';
import { STATUS_RESERVATION_MAP } from '../utils/cmsStatus';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MENU_ID = 63n; // Laravel hasCrudPermission(63, ...) used by these controllers
const COMPANY_TYPE = 'App\\Models\\CompanyProfile';
const GUEST_TYPE = 'App\\Models\\GuestProfile';
const CHECK_OUT_STATUS = 1;

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (val && typeof val === 'object' && val instanceof Date) return val;
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

function paging(totalData: number, limit: number, page: number) {
  const totalPages = Math.max(1, Math.ceil(totalData / Math.max(1, limit)));
  return {
    limit_data: limit,
    total_data: totalData,
    start_paging: page,
    end_paging: totalPages,
    prev_jump: page > 1 ? 1 : 0,
    prev: page > 1 ? page - 1 : 0,
    next: page < totalPages ? page + 1 : 0,
    next_jump: page < totalPages ? totalPages : 0,
  };
}

// Laravel HasPermissions: super-user -> all true, else role_menu_crud flags for menu 63.
function permFlags(req: Request): Record<string, boolean> {
  const user = req.user;
  if (user?.superUser) return { view: true, add: true, edit: true, delete: true };
  const crud = user?.permissions.get(MENU_ID);
  return { view: !!crud?.view, add: !!crud?.add, edit: !!crud?.edit, delete: !!crud?.delete };
}

function viewFlags(req: Request): Record<string, boolean> {
  const flags = permFlags(req);
  return { view: flags.view };
}

// Laravel GlobalResources single-resource row flags
function rowFlags(req: Request) {
  const flags = permFlags(req);
  return { is_view: flags.view, is_edit: flags.edit, is_need_approval: false };
}

// Parse money possibly formatted Indonesian style ("1.234,56") or plain ("1234.56").
function parseAmount(raw: any): number {
  if (typeof raw === 'number') return raw;
  if (raw === null || raw === undefined) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(/,/g, '.');
  }
  const n = Number(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function folioNumberLabel(f: any): string {
  return f?.folio_number ?? '';
}

// ==================== WAKE UP CALL ====================

const WAKE_UP_TABLE = [
  { label: 'No', key: 'no', type: 'none', is_search: false },
  { label: 'Status', key: 'status', type: 'checkbox', is_search: false, options: [{ value: 1, label: 'Active' }, { value: 0, label: 'Inactive' }] },
  { label: 'Date', key: 'date', type: 'date', is_search: false },
  { label: 'Time', key: 'time', type: 'time', is_search: false },
  { label: 'Description', key: 'description', type: 'text', is_search: false },
  { label: 'Result', key: 'result', type: 'text', is_search: false },
];

function wakeUpRow(w: any, req: Request, no: number) {
  return {
    id: w.id,
    date: w.date,
    time: w.time,
    description: w.description,
    result: w.result,
    created_at: w.created_at,
    created_by: w.created_by,
    status: w.status === 1,
    ...rowFlags(req),
    relation: [],
    no,
  };
}

function wakeUpValidate(body: any): string | null {
  if (!body.folio_id) return 'The folio id field is required.';
  if (!body.date) return 'The date field is required.';
  if (!body.description) return 'The description field is required.';
  if (!body.result) return 'The result field is required.';
  return null;
}

export class FrontDeskExtrasController {
  // ==================== WAKE UP CALL ====================
  static async wakeUpCallIndex(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const folioId = req.query.folio_id as string;
      if (!folioId) {
        success(res, [], 'No guest ID provided.', 200, {
          table: WAKE_UP_TABLE,
          pagging: paging(0, limit, page),
          permission: viewFlags(req),
          search_data: [],
        });
        return;
      }
      const where: any = { property_id: pid, folio_id: BigInt(folioId), deleted_at: null };
      if (req.query.search) where.description = { contains: req.query.search, mode: 'insensitive' };

      let orderBy: any = [{ status: 'desc' }, { id: 'desc' }];
      const sort = req.query.sort as string;
      if (sort) {
        const desc = sort.startsWith('-');
        const col = desc ? sort.slice(1) : sort;
        orderBy = [{ [col]: desc ? 'desc' : 'asc' }];
      }

      // Laravel quirk preserved: paginate() result discarded, ->get() returns all rows.
      const [rows, total] = await Promise.all([
        prisma.wake_up_calls.findMany({ where, orderBy }),
        prisma.wake_up_calls.count({ where }),
      ]);

      const data = rows.map((w, i) => wakeUpRow(w, req, i + 1 + limit * (page - 1)));
      success(res, bigintToNumber(data), 'Success', 200, {
        table: WAKE_UP_TABLE,
        pagging: paging(total, limit, page),
        permission: { ...viewFlags(req), add: permFlags(req).add, edit: permFlags(req).edit },
        search_data: [],
      });
    } catch (err: any) {
      console.error('Wake-up-call index error:', err);
      error(res, 'Failed to list wake-up calls', 500);
    }
  }

  static async wakeUpCallStore(req: Request, res: Response): Promise<void> {
    try {
      const invalid = wakeUpValidate(req.body);
      if (invalid) { badRequest(res, invalid); return; }
      const pid = req.user?.lastProperty ?? 0n;
      const row = await prisma.wake_up_calls.create({
        data: {
          property_id: pid,
          folio_id: BigInt(req.body.folio_id),
          date: new Date(req.body.date),
          description: req.body.description,
          result: req.body.result,
          status: req.body.status !== undefined ? Number(req.body.status) : 1,
          created_at: new Date(),
          created_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(wakeUpRow(row, req, 1)), 'Success', 200);
    } catch (err: any) {
      console.error('Wake-up-call store error:', err);
      error(res, 'Failed to create wake-up call', 500);
    }
  }

  static async wakeUpCallShow(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const row = await prisma.wake_up_calls.findFirst({ where: { id: idParam(req.params.id), property_id: pid } });
      if (!row) { success(res, [], 'Not Found', 404); return; }
      success(res, bigintToNumber(wakeUpRow(row, req, 1)), 'Success', 200);
    } catch (err: any) {
      console.error('Wake-up-call show error:', err);
      error(res, 'Failed to get wake-up call', 500);
    }
  }

  static async wakeUpCallUpdate(req: Request, res: Response): Promise<void> {
    try {
      if (!req.body.date || !req.body.description || !req.body.result) {
        badRequest(res, 'Validation failed'); return;
      }
      const row = await prisma.wake_up_calls.update({
        where: { id: idParam(req.params.id) },
        data: {
          date: new Date(req.body.date),
          description: req.body.description,
          result: req.body.result,
          status: req.body.status !== undefined ? Number(req.body.status) : 1,
          updated_at: new Date(),
          updated_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(wakeUpRow(row, req, 1)), 'Success', 200);
    } catch (err: any) {
      console.error('Wake-up-call update error:', err);
      error(res, 'Failed to update wake-up call', 500);
    }
  }

  static async wakeUpCallDestroy(req: Request, res: Response): Promise<void> {
    try {
      const id = idParam(req.params.id);
      await prisma.wake_up_calls.update({ where: { id },         data: { deleted_at: new Date(), status: 0 } });
      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Wake-up-call destroy error:', err);
      error(res, 'Failed to delete wake-up call', 500);
    }
  }

  static async wakeUpCallDelete(req: Request, res: Response): Promise<void> {
    try {
      await prisma.wake_up_calls.delete({ where: { id: idParam(req.params.id) } });
      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Wake-up-call delete error:', err);
      error(res, 'Failed to force delete wake-up call', 500);
    }
  }

  static async wakeUpCallRestore(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity: restore clears deleted_at then sets status INACTIVE (0).
      await prisma.wake_up_calls.update({ where: { id: idParam(req.params.id) }, data: { deleted_at: null, status: 0 } });
      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Wake-up-call restore error:', err);
      error(res, 'Failed to restore wake-up call', 500);
    }
  }

  // ==================== AUTO TRANSFER ====================

  static async autoTransferIndex(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const folioId = req.query.folio_id as string;
      if (!folioId) { badRequest(res, 'Folio not found'); return; }
      const pid = req.user?.lastProperty ?? 0n;
      const folio = await prisma.folios.findFirst({ where: { id: BigInt(folioId), deleted_at: null } });
      if (!folio) { success(res, [], 'Folio not found', 404); return; }

      const table = [
        { label: 'Folio Number', key: 'target_folio_id', type: 'autocomplete', url_autocomplete: '/cms/reservation/folio?type-reservation=vr-fit', is_search: false },
        { label: 'Status Reservation', key: 'status_reservation', type: 'none', is_search: false },
      ];

      if (folio.type_reservation === 'git') {
        success(res, [], 'Success', 200, { table, pagging: paging(0, limit, page), permission: viewFlags(req) });
        return;
      }

      const rows = await prisma.auto_transfers.findMany({ where: { folio_id: Number(folio.id) }, orderBy: { id: 'desc' } });
      const targetIds = [...new Set(rows.map((r) => r.target_folio_id))];
      const targets = await prisma.folios.findMany({ where: { id: { in: targetIds } }, select: { id: true, folio_number: true, status_reservation: true } });
      const tMap = new Map(targets.map((t) => [Number(t.id), t]));

      const data = rows.map((r) => {
        const t: any = tMap.get(r.target_folio_id);
        return {
          id: r.id,
          property_id: r.property_id,
          'folio_id ': { value: r.folio_id, label: folioNumberLabel(folio) }, // trailing-space key = Laravel formatData parity
          action_table: t ? t.status_reservation !== CHECK_OUT_STATUS : true,
          status_reservation: t ? STATUS_RESERVATION_MAP[t.status_reservation ?? -1] ?? null : null,
          target_folio_id: { value: r.target_folio_id, label: folioNumberLabel(t) },
          date: r.date,
        };
      });

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        pagging: paging(rows.length, limit, page),
        permission: { ...viewFlags(req), add: permFlags(req).add, edit: permFlags(req).edit },
      });
    } catch (err: any) {
      console.error('Auto-transfer index error:', err);
      error(res, 'Failed to list auto transfers', 500);
    }
  }

  static async autoTransferStore(req: Request, res: Response): Promise<void> {
    try {
      const { folio_id, target_folio_id } = req.body;
      if (!folio_id || !target_folio_id) { badRequest(res, 'The folio id and target folio id fields are required.'); return; }
      const [folio, target] = await Promise.all([
        prisma.folios.findFirst({ where: { id: BigInt(folio_id), deleted_at: null } }),
        prisma.folios.findFirst({ where: { id: BigInt(target_folio_id), deleted_at: null } }),
      ]);
      if (!folio || !target) { badRequest(res, 'The selected folio id is invalid.'); return; }
      const dup = await prisma.auto_transfers.findFirst({ where: { target_folio_id: Number(target_folio_id) } });
      if (dup) { badRequest(res, 'Target folio id already used.'); return; }

      const row = await prisma.auto_transfers.create({
        data: { property_id: Number(req.user?.lastProperty ?? 0), folio_id: Number(folio_id), target_folio_id: Number(target_folio_id), date: new Date() },
      });
      success(res, bigintToNumber({
        id: row.id,
        property_id: row.property_id,
        'folio_id ': { value: row.folio_id, label: folioNumberLabel(folio) },
        action_table: target.status_reservation !== CHECK_OUT_STATUS,
        status_reservation: STATUS_RESERVATION_MAP[target.status_reservation ?? -1] ?? null,
        target_folio_id: { value: row.target_folio_id, label: folioNumberLabel(target) },
        date: row.date,
      }), 'Success', 200);
    } catch (err: any) {
      console.error('Auto-transfer store error:', err);
      error(res, 'Failed to create auto transfer', 500);
    }
  }

  static async autoTransferDestroy(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.auto_transfers.findUnique({ where: { id: Number(idParam(req.params.id)) } });
      if (!row) { badRequest(res, 'Not Found'); return; }
      const target = await prisma.folios.findFirst({ where: { id: BigInt(row.target_folio_id) } });
      if (target && target.status_reservation === CHECK_OUT_STATUS) {
        badRequest(res, 'Target folio already check out.');
        return;
      }
      await prisma.auto_transfers.delete({ where: { id: row.id } });
      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Auto-transfer destroy error:', err);
      error(res, 'Failed to delete auto transfer', 500);
    }
  }

  // ==================== BILLING TO ====================

  static async billingToIndex(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const folioId = req.query.folio_id as string;
      if (!folioId) {
        success(res, [], 'No guest ID provided.', 200, {
          table: [], pagging: paging(0, limit, page), permission: viewFlags(req),
        });
        return;
      }
      const pid = req.user?.lastProperty ?? 0n;
      const folio = await prisma.folios.findFirst({ where: { id: BigInt(folioId), deleted_at: null } });
      if (!folio) { badRequest(res, 'Folio not found'); return; }

      const [company, guest, codeBillings, others] = await Promise.all([
        folio.company_profile_id ? prisma.company_profiles.findFirst({ where: { id: folio.company_profile_id } }) : null,
        folio.guest_profile_id ? prisma.guest_profiles.findFirst({ where: { id: folio.guest_profile_id } }) : null,
        prisma.code_billings.findMany({ where: { property_id: pid, status: 1, deleted_at: null } }),
        prisma.other_guests.findMany({ where: { folio_id: Number(folio.id) }, orderBy: { id: 'desc' } }),
      ]);

      const otherGuestIds = others.map((o) => BigInt(o.guest_profile_id));
      const otherGuests = otherGuestIds.length
        ?         await prisma.guest_profiles.findMany({ where: { id: { in: otherGuestIds } }, select: { id: true, first_name: true, last_name: true } })
        : [];
      const ogMap = new Map(otherGuests.map((g) => [Number(g.id), g]));

      const companyName = company?.name ?? folio.company_name ?? '';
      const guestLabel = guest ? `${(guest as any).first_name ?? ''} ${(guest as any).last_name ?? ''}`.trim() : '';

      const options: any[] = [];
      if (folio.company_profile_id) options.push({ value: `${folio.company_profile_id}-company`, label: `1 - ${companyName}` });
      if (folio.guest_profile_id) options.push({ value: `${folio.guest_profile_id}-guest`, label: `2 - ${guestLabel}` });
      for (const o of others) {
        const g: any = ogMap.get(Number(o.guest_profile_id));
        if (g) options.push({ value: `${o.guest_profile_id}-guest`, label: `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() });
      }

      const ledgers = await prisma.ledgers.findMany({
        where: { folio_id: Number(folio.id), deleted_at: null, code_billing_id: { in: codeBillings.map((c) => c.id) } },
      });
      const ledgerMap = new Map(ledgers.map((l) => [Number(l.code_billing_id), l]));

      const data = codeBillings.map((cb) => {
        const ledger = ledgerMap.get(Number(cb.id));
        if (!ledger) {
          return { id: null, code_billing_id: cb.name, billing_to: { value: '1-company', label: `1 - ${companyName}` } };
        }
        const isCompany = ledger.profileable_type === COMPANY_TYPE;
        let label = '';
        let value = '';
        if (ledger.profileable_id) {
          if (isCompany) {
            value = `${ledger.profileable_id}-company`;
            // label resolved lazily: fetch company name
            label = `1 - ${companyName}`;
          } else {
            value = `${ledger.profileable_id}-guest`;
            const gp = ogMap.get(Number(ledger.profileable_id));
            label = `2 - ${gp ? `${gp.first_name ?? ''} ${gp.last_name ?? ''}`.trim() : ''}`;
          }
        }
        return { id: ledger.id, code_billing_id: cb.name, billing_to: { value, label } };
      });

      // Resolve company labels for company-attached ledgers (single batch query)
      const companyLedgerProfileIds = data
        .filter((d: any) => d.billing_to.value.endsWith('-company') && d.id !== null)
        .map((d: any) => Number(d.billing_to.value.split('-')[0]));
      if (companyLedgerProfileIds.length) {
        const cps = await prisma.company_profiles.findMany({ where: { id: { in: companyLedgerProfileIds } }, select: { id: true, name: true } });
        const cpMap = new Map(cps.map((c) => [Number(c.id), c.name]));
        for (const d of data as any[]) {
          if (d.id !== null && d.billing_to.value.endsWith('-company')) {
            const nm = cpMap.get(Number(d.billing_to.value.split('-')[0]));
            d.billing_to.label = `1 - ${nm ?? ''}`;
          }
        }
      }

      const table = [
        { label: 'No', key: 'no', type: 'none', is_search: false },
        { label: 'Billing Code', key: 'code_billing_id', type: 'none', is_search: false },
        { label: 'Billing To', key: 'billing_to', type: 'select', is_search: false, options },
      ];

      success(res, bigintToNumber(data), 'Success', 200, {
        table,
        pagging: paging(data.length, limit, page),
        permission: { ...viewFlags(req), add: permFlags(req).add, edit: permFlags(req).edit },
      });
    } catch (err: any) {
      console.error('Billing-to index error:', err);
      error(res, 'Failed to list billing-to', 500);
    }
  }

  static async billingToUpdate(req: Request, res: Response): Promise<void> {
    try {
      const billingTo = req.body.billing_to as string;
      if (!billingTo || typeof billingTo !== 'string') { badRequest(res, 'The billing to field is required.'); return; }
      const ledgerId = req.params.ledger as string;
      const ledger = await prisma.ledgers.findFirst({ where: { id: BigInt(ledgerId), deleted_at: null } });
      if (!ledger) { success(res, [], 'Not Found', 404); return; }

      const folioId = req.body.folio_id;
      if (!folioId) { success(res, [], 'Folio not found', 404); return; }
      const folio = await prisma.folios.findFirst({ where: { id: BigInt(folioId), deleted_at: null } });
      if (!folio) { success(res, [], 'Folio not found', 404); return; }

      const parts = billingTo.split('-');
      const suffix = parts[parts.length - 1];
      const targetId = parts[0];

      let profileable_type: string | null = null;
      let profileable_id: number | null = null;
      if (suffix === 'company') {
        const cp = await prisma.company_profiles.findFirst({ where: { id: BigInt(targetId) } });
        if (cp) { profileable_type = COMPANY_TYPE; profileable_id = Number(cp.id); }
      } else if (suffix === 'guest') {
        const gp = await prisma.guest_profiles.findFirst({ where: { id: BigInt(targetId) } });
        if (gp) { profileable_type = GUEST_TYPE; profileable_id = Number(gp.id); }
      }

      const updated = profileable_type
        ? await prisma.ledgers.update({
            where: { id: ledger.id },
            data: { profileable_type, profileable_id, updated_at: new Date(), updated_by: req.user?.id },
          })
        : ledger;

      success(res, bigintToNumber({
        id: updated.id,
        code_billing_id: updated.code_billing_id,
        billing_to: { value: billingTo, label: billingTo },
      }), 'Success', 200);
    } catch (err: any) {
      console.error('Billing-to update error:', err);
      error(res, 'Failed to update billing-to', 500);
    }
  }

  // ==================== DOOR LOCK ====================

  private static async buildDoorLockPayload(folioId: string, forceNoonCheckout: boolean): Promise<{ ok: boolean; payload?: any; folio?: any; property?: any; room?: any }> {
    const folio: any = await prisma.folios.findFirst({
      where: { id: BigInt(folioId), deleted_at: null },
      include: { guest_profiles: { select: { account: true } } },
    });
    if (!folio) return { ok: false };
    const property = await prisma.properties.findFirst({ where: { id: folio.property_id } });
    const lastReservation: any = await prisma.reservations.findFirst({
      where: { folio_id: folio.id, room_id: { not: null } },
      orderBy: { date: 'desc' },
    });
    let room: any = null;
    let floorId: any = '1';
    let buildingId: any = '1';
    if (lastReservation?.room_id) {
      room = await prisma.rooms.findFirst({ where: { id: lastReservation.room_id }, include: { room_types: { select: { id: true } } } });
      if (room) {
        const typeLinks = await prisma.model_has_types.findMany({
          where: { model_id: room.id, model_type: 'App\\Models\\Room' },
          include: { types: { select: { id: true, group: true } } },
        });
        floorId = typeLinks.find((t) => t.types?.group === 'floor')?.types?.id ?? '1';
        buildingId = typeLinks.find((t) => t.types?.group === 'building')?.types?.id ?? '1';
      }
    }
    const checkout = new Date(folio.check_out_date ?? Date.now());
    if (forceNoonCheckout) checkout.setHours(12, 0, 0, 0);

    const payload: any = {
      checkin: folio.check_in_date ? new Date(folio.check_in_date).toISOString() : null,
      checkout: checkout.toISOString(),
      roomcode: room?.name ?? '',
      roomtypecode: room?.room_types?.id ? Number(room.room_types.id) : '',
      floorcode: typeof floorId === 'bigint' ? Number(floorId) : floorId,
      buildingcode: typeof buildingId === 'bigint' ? Number(buildingId) : buildingId,
      holder: folio.guest_profiles?.account ?? '',
      idno: '',
      port: 0,
      breakfast: 1,
      overite: 0,
      ip_doorlock: (property as any)?.ip_doorlock ?? '',
      path: '/api/lock/new-key',
    };

    const propId = Number(folio.property_id);
    if (propId === 1002) {
      payload.roomcode = room?.address_code ?? '';
      payload.idno = '46E8EB';
      payload.port = 3;
    } else if (propId === 1003) {
      payload.roomcode = room?.address_code ?? '';
      payload.roomtypecode = '000';
      payload.floorcode = '000';
      payload.port = 1;
      payload.breakfast = 0;
      payload.overite = 1;
      payload.guestidx = 1;
    }
    return { ok: true, payload, folio, property, room };
  }

  static async doorLockNew(req: Request, res: Response): Promise<void> {
    try {
      const folioId = (req.query.folio_id ?? req.body?.folio_id) as string;
      if (!folioId) { success(res, { status: 'error', message: 'Folio ID is required' }, 'Success', 200); return; }
      const built = await FrontDeskExtrasController.buildDoorLockPayload(folioId, true);
      if (!built.ok) { success(res, { status: 'error', message: 'Folio ID is required' }, 'Success', 200); return; }
      success(res, built.payload, 'Set key success', 200);
    } catch (err: any) {
      console.error('Door-lock new error:', err);
      error(res, 'Failed to build key payload', 500);
    }
  }

  static async doorLockDuplicate(req: Request, res: Response): Promise<void> {
    try {
      const folioId = (req.query.folio_id ?? req.body?.folio_id) as string;
      if (!folioId) { success(res, { status: 'error', message: 'Folio ID is required' }, 'Success', 200); return; }
      const built = await FrontDeskExtrasController.buildDoorLockPayload(folioId, false);
      if (!built.ok) { success(res, { status: 'error', message: 'Folio ID is required' }, 'Success', 200); return; }
      const propId = Number(built.folio!.property_id);
      if (propId !== 999 && propId !== 1003) {
        success(res, { status: 'error', message: 'System not supported' }, 'Success', 200);
        return;
      }
      const payload = built.payload!;
      payload.path = '/api/lock/duplicate-key';
      // Laravel parity: guard above rejects everything except 999/1003, so only 1003 has overrides here.
      if (propId === 1003) {
        const existing = await prisma.doorlock_duplicate_counters.findFirst({ where: { folio_id: BigInt(folioId) } });
        let key: number;
        if (existing) {
          key = existing.count + 1;
          await prisma.doorlock_duplicate_counters.update({ where: { id: existing.id }, data: { count: key, updated_at: new Date() } });
        } else {
          key = 2;
          await prisma.doorlock_duplicate_counters.create({
            data: { property_id: built.folio!.property_id, folio_id: BigInt(folioId), count: key, created_at: new Date() },
          });
        }
        payload.guestidx = key;
      }
      success(res, payload, 'Duplicate key success', 200);
    } catch (err: any) {
      console.error('Door-lock duplicate error:', err);
      error(res, 'Failed to duplicate key', 500);
    }
  }

  static async doorLockErase(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty;
      if (!pid) { success(res, { status: 'error', message: 'Property not found' }, 'Success', 200); return; }
      const property = await prisma.properties.findFirst({ where: { id: pid } });
      if (!property) { success(res, { status: 'error', message: 'Property not found' }, 'Success', 200); return; }
      if (Number(property.id) !== 999) {
        success(res, { status: 'error', message: 'System not supported' }, 'Success', 200);
        return;
      }
      const payload = { port: 0, ip_doorlock: (property as any).ip_doorlock ?? '', path: '/api/lock/erase-key' };
      success(res, payload, 'Erase key success', 200);
    } catch (err: any) {
      console.error('Door-lock erase error:', err);
      error(res, 'Failed to erase key', 500);
    }
  }

  // ==================== DEPOSIT PAYMENT ====================

  private static depositRow(t: any) {
    return {
      id: t.id,
      date: t.date,
      payment_type: { value: t.type_payment_id, label: t.type_payments?.name ?? t.type_payment_name ?? '' },
      amount: moneyFormat(Number(t.total ?? 0)),
    };
  }

  static async depositPaymentIndex(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 9999;
      const folioId = req.query.folio_id as string;
      if (!folioId) { badRequest(res, 'The folio id field is required.'); return; }
      const pid = req.user?.lastProperty ?? 0n;

      const rows = await prisma.transactions.findMany({
        where: { type: 'payment', is_pos_deposit: 1, folio_id: BigInt(folioId), property_id: pid, deleted_at: null },
        include: { type_payments: { select: { name: true } } },
        orderBy: { id: 'desc' },
      });
      // Laravel quirk: pagging total from deposit_payments count (all folios), not the listed rows.
      const totalData = await prisma.deposit_payments.count({ where: { property_id: pid } });

      const table = [
        { label: 'Date', key: 'date', type: 'date', is_search: false },
        { label: 'Payment Type', key: 'payment_type', type: 'select', is_search: false },
        { label: 'Amount', key: 'amount', type: 'text', is_search: false },
      ];

      success(res, bigintToNumber(rows.map((r) => FrontDeskExtrasController.depositRow(r))), 'Success', 200, {
        table,
        pagging: paging(totalData, limit, page),
        permission: { ...viewFlags(req), add: permFlags(req).add, edit: permFlags(req).edit },
      });
    } catch (err: any) {
      console.error('Deposit-payment index error:', err);
      error(res, 'Failed to list deposit payments', 500);
    }
  }

  private static async depositFormatRow(id: bigint, req: Request, no: number) {
    const row: any = await prisma.deposit_payments.findUnique({
      where: { id },
      include: { folios: { select: { folio_number: true } } },
    });
    if (!row) return null;
    const codePost = await prisma.code_posts.findFirst({ where: { id: row.payment_type }, select: { name: true } });
    return {
      id: row.id,
      date: row.date,
      folio_id: row.folio_id,
      payment_type: { value: row.payment_type, label: codePost?.name ?? '' },
      amount: row.amount,
      created_at: row.created_at,
      created_by: row.created_by,
      status: row.status === 1,
      ...rowFlags(req),
      relation: [],
      no,
    };
  }

  static async depositPaymentStore(req: Request, res: Response): Promise<void> {
    try {
      const { date, folio_id, payment_type, amount } = req.body;
      if (!date) { badRequest(res, 'The date field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }
      if (!payment_type) { badRequest(res, 'The payment type field is required.'); return; }
      if (amount === undefined || amount === null || amount === '') { badRequest(res, 'The amount field is required.'); return; }

      const row = await prisma.deposit_payments.create({
        data: {
          property_id: req.user?.lastProperty ?? 0n,
          folio_id: BigInt(folio_id),
          date: new Date(date),
          payment_type: BigInt(payment_type),
          amount: Math.round(parseAmount(amount)),
          status: 1,
          created_at: new Date(),
          created_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(await FrontDeskExtrasController.depositFormatRow(row.id, req, 1)), 'Success', 200);
    } catch (err: any) {
      console.error('Deposit-payment store error:', err);
      error(res, 'Failed to create deposit payment', 500);
    }
  }

  static async depositPaymentUpdate(req: Request, res: Response): Promise<void> {
    try {
      const { date, payment_type, amount } = req.body;
      if (!date) { badRequest(res, 'The date field is required.'); return; }
      if (!payment_type) { badRequest(res, 'The payment type field is required.'); return; }
      if (amount === undefined || amount === null || amount === '') { badRequest(res, 'The amount field is required.'); return; }

      const id = idParam(req.params.id);
      await prisma.deposit_payments.update({
        where: { id },
        data: {
          date: new Date(date),
          payment_type: BigInt(payment_type),
          amount: Math.round(parseAmount(amount)),
          updated_at: new Date(),
          updated_by: req.user?.id,
        },
      });
      success(res, bigintToNumber(await FrontDeskExtrasController.depositFormatRow(id, req, 1)), 'Success', 200);
    } catch (err: any) {
      console.error('Deposit-payment update error:', err);
      error(res, 'Failed to update deposit payment', 500);
    }
  }

  static async depositPaymentDestroy(req: Request, res: Response): Promise<void> {
    try {
      await prisma.deposit_payments.update({
        where: { id: idParam(req.params.id) },
        data: { deleted_at: new Date(), deleted_by: req.user?.id, status: 0 },
      });
      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Deposit-payment destroy error:', err);
      error(res, 'Failed to delete deposit payment', 500);
    }
  }

  static async depositPaymentDelete(req: Request, res: Response): Promise<void> {
    try {
      await prisma.deposit_payments.delete({ where: { id: idParam(req.params.id) } });
      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Deposit-payment delete error:', err);
      error(res, 'Failed to force delete deposit payment', 500);
    }
  }

  static async depositPaymentRestore(req: Request, res: Response): Promise<void> {
    try {
      // Laravel parity: restore then status INACTIVE (0).
      await prisma.deposit_payments.update({
        where: { id: idParam(req.params.id) },
        data: { deleted_at: null, status: 0 },
      });
      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Deposit-payment restore error:', err);
      error(res, 'Failed to restore deposit payment', 500);
    }
  }
}
