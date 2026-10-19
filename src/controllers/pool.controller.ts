import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { success, badRequest, notFound, error } from '../utils/response';
import { writeAudit } from '../utils/audit';
import { AuthController } from './auth.controller';

// ════════════════════════════════════════════════════════════════════════
// PoolController — Mobile-App-Optimize.md §5 + §M8 (LOGIK BARU, modul modul Swimming Pool)
// Menu: 1201 parent · 1202 area · 1203 setup · 1204 attendance · 1205 usage · 1206 recap
// (id digeser dari 1190-1195 — blok itu sudah dipakai modul Loyalty/Facility di DB)
// Repo pola:
//   - posting folio  = pos-mobile.controller.ts:480-605 (transactions + morph model_type)
//   - check-in/out   = shift flow (server time, "already checked in"/"not found")
//   - attendance     = pool_attendances.status 0-6 (§5.3), tolerance 30 menit
// ════════════════════════════════════════════════════════════════════════

const TOLERANCE_MINUTES = 30; // PRESENT vs LATE (§5.3: toleransi check-in)

export const POOL_STATUS = {
  DRAFT: 0,
  POSTED: 1,
  POSTED_PARTIAL: 2,
  VOID: 3,
} as const;

const POOL_CODE_POST_NAME = 'Pool Items';

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object') {
    if (val instanceof Date) return val.toISOString();
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

function parseTransactionActions(user: any, menuId: number): Record<string, boolean> {
  try {
    const crud = user?.permissions?.get(BigInt(menuId));
    if (!crud?.transactionActions) return {};
    return JSON.parse(crud.transactionActions);
  } catch {
    return {};
  }
}

function paginate(total: number, limit: number, page: number) {
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return {
    current_page: page,
    last_page: lastPage,
    per_page: limit,
    total,
    from: total === 0 ? 0 : (page - 1) * limit + 1,
    to: Math.min(page * limit, total),
  };
}

function pidOf(req: Request): bigint {
  const u = req.user as any;
  return BigInt(u?.lastProperty ?? u?.last_property ?? 0);
}
function dateStr(raw: any, fallback?: string | Date): string {
  const s = String(raw ?? '').replace(/\//g, '-').slice(0, 10);
  if (s && !Number.isNaN(new Date(s + 'T00:00:00.000Z').getTime())) return s;
  if (typeof fallback === 'string') return fallback; // business date fallback
  const d = fallback ?? new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Business date (audit-rollover aware) utk property request ini — sumber
 * kebenaran default tanggal SEMUA endpoint pool (bukan jam komputer/UTC).
 */
async function bizCd(req: Request): Promise<string> {
  return AuthController.getBusinessDate(pidOf(req));
}
function shiftDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// @ts-ignore area — writeAudit expects raw PrismaClient while config/prisma is an
// extended client (same workaround as housekeeping.controller.ts:1497)
const audit = (
  req: Request,
  input: {
    table: string;
    event: 'created' | 'updated' | 'deleted' | 'restored';
    subjectId: bigint | number | null | undefined;
    attributes?: any;
    old?: any;
    unchanged?: boolean;
    name?: string;
    description?: string;
    logName?: string;
    meta?: Record<string, any>;
  }
) => (writeAudit as any)(prisma, req, input);

export class PoolController {
  // ════════════════════════ MASTERS: AREA (menu 1202) ════════════════════════

  static async areaList(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const status = req.query.status;
      const where: any = { property_id: pid, deleted_at: null };
      if (status !== undefined && status !== '') where.status = status === '1' || status === 'true';
      const rows = await prisma.pool_areas.findMany({ where, orderBy: [{ sort: 'asc' }, { name: 'asc' }] });
      success(res, bigintToNumber(rows), 'Success', 200, {
        pagination: paginate(rows.length, rows.length, 1),
      });
    } catch (err: any) { console.error('pool area list:', err); error(res, 'Failed to fetch pool areas', 500); }
  }

  static async areaStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const b = req.body ?? {};
      if (!b?.code?.toString().trim() || !b?.name?.toString().trim()) {
        badRequest(res, 'code dan name wajib diisi.'); return;
      }
      const dup = await prisma.pool_areas.findFirst({ where: { property_id: pid, code: String(b.code), deleted_at: null } });
      if (dup) { badRequest(res, 'Code sudah dipakai di area lain.'); return; }
      const row = await prisma.pool_areas.create({
        data: {
          property_id: pid,
          code: String(b.code),
          name: String(b.name),
          area_type: b.area_type ? String(b.area_type) : null,
          capacity: Number(b.capacity) || 0,
          depth_meter: b.depth_meter != null && b.depth_meter !== '' ? new Prisma.Decimal(b.depth_meter) : null,
          location_note: b.location_note ? String(b.location_note) : null,
          sort: Number(b.sort) || 0,
          status: b.status !== undefined ? !!b.status : true,
          current_status: Number(b.current_status) || 0,
          created_at: new Date(), created_by: (req.user as any)?.id ?? null,
        },
      });
      await audit(req, { table: 'pool_areas', event: 'created', subjectId: row.id, attributes: row });
      success(res, bigintToNumber(row), 'Success', 200);
    } catch (err: any) { console.error('pool area store:', err); error(res, 'Failed to create pool area', 500); }
  }

  static async areaShow(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_areas.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool area not found'); return; }
      success(res, bigintToNumber(row), 'Success', 200);
    } catch (err: any) { console.error('pool area show:', err); error(res, 'Failed to fetch pool area', 500); }
  }

  static async areaUpdate(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_areas.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool area not found'); return; }
      const b = req.body ?? {};
      const data: any = { updated_at: new Date(), updated_by: (req.user as any)?.id ?? null };
      [
        ['code', (v: any) => String(v)], ['name', (v: any) => String(v)],
        ['area_type', (v: any) => (v ? String(v) : null)], ['capacity', (v: any) => Number(v) || 0],
        ['depth_meter', (v: any) => (v != null && v !== '' ? new Prisma.Decimal(v) : null)],
        ['location_note', (v: any) => (v ? String(v) : null)], ['sort', (v: any) => Number(v) || 0],
        ['status', (v: any) => !!v], ['current_status', (v: any) => Number(v) || 0],
      ].forEach(([k, fn]: any) => { if (b[k] !== undefined) data[k] = fn(b[k]); });
      if (data.code && String(data.code) !== row.code) {
        const dup = await prisma.pool_areas.findFirst({
          where: { property_id: row.property_id, code: String(data.code), deleted_at: null, id: { not: row.id } },
        });
        if (dup) { badRequest(res, 'Code sudah dipakai di area lain.'); return; }
      }
      const updated = await prisma.pool_areas.update({ where: { id: row.id }, data });
      await audit(req, { table: 'pool_areas', event: 'updated', subjectId: row.id, attributes: updated, old: row });
      success(res, bigintToNumber(updated), 'Success', 200);
    } catch (err: any) { console.error('pool area update:', err); error(res, 'Failed to update pool area', 500); }
  }

  static async areaDestroy(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_areas.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool area not found'); return; }
      await prisma.pool_areas.update({
        where: { id: row.id },
        data: {
          deleted_at: new Date(), deleted_by: (req.user as any)?.id ?? null,
          updated_by: (req.user as any)?.id ?? null,
        },
      });
      await audit(req, { table: 'pool_areas', event: 'deleted', subjectId: row.id, old: row });
      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('pool area destroy:', err); error(res, 'Failed to delete pool area', 500); }
  }

  // ════════════════════════ MASTERS: SETUP (menu 1203) ════════════════════════
  // Mirror housekeeping-setup: repeater detail pivot pool_setup_areas.

  static async setupList(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const where: any = { property_id: pid, deleted_at: null };
      if (req.query.used_by) where.used_by = String(req.query.used_by);
      if (req.query.category) where.category = String(req.query.category);
      const rows = await prisma.pool_setups.findMany({
        where, orderBy: [{ sort: 'asc' }, { code: 'asc' }],
      });
      const setupIds = rows.map((r) => r.id);
      const pivots = setupIds.length
        ? await prisma.pool_setup_areas.findMany({ where: { pool_setup_id: { in: setupIds } }, orderBy: { id: 'asc' } })
        : [];
      const withRows = rows.map((r) => ({ ...r, pool_areas_detail: pivots.filter((p) => p.pool_setup_id === r.id) }));
      success(res, bigintToNumber(withRows), 'Success', 200, {
        pagination: paginate(rows.length, rows.length, 1),
      });
    } catch (err: any) { console.error('pool setup list:', err); error(res, 'Failed to fetch pool setups', 500); }
  }

  static async setupCreate(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const areas = await prisma.pool_areas.findMany({
        where: { property_id: pid, status: true, deleted_at: null }, orderBy: { sort: 'asc' },
      });
      const master = {
        pool_areas: areas.map((a) => ({ value: Number(a.id), label: `${a.code} - ${a.name}`, code: a.code })),
      };
      success(res, { master }, 'Success', 200);
    } catch (err: any) { console.error('pool setup create:', err); error(res, 'Failed to fetch master', 500); }
  }

  static async setupShow(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_setups.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool setup not found'); return; }
      const pivots = await prisma.pool_setup_areas.findMany({
        where: { pool_setup_id: row.id }, orderBy: { id: 'asc' },
      });
      success(res, bigintToNumber({ ...row, pool_areas_detail: pivots }), 'Success', 200);
    } catch (err: any) { console.error('pool setup show:', err); error(res, 'Failed to fetch pool setup', 500); }
  }

  private static async replaceSetupAreas(
    tx: any, setupId: bigint, propertyId: bigint, rows: any[]
  ): Promise<void> {
    await tx.pool_setup_areas.deleteMany({ where: { pool_setup_id: setupId } });
    for (const r of rows ?? []) {
      const areaId = r?.pool_area_id ?? r?.value;
      if (areaId == null || areaId === '') continue;
      await tx.pool_setup_areas.create({
        data: {
          property_id: propertyId,
          pool_setup_id: setupId,
          pool_area_id: BigInt(areaId),
          qty: Number(r?.qty) || 1,
          is_required: r?.is_required !== undefined ? !!r.is_required : true,
        },
      });
    }
  }

  static async setupStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const b = req.body ?? {};
      if (!b?.code?.toString().trim() || !b?.item_name?.toString().trim()) {
        badRequest(res, 'code dan item_name wajib diisi.'); return;
      }
      const dup = await prisma.pool_setups.findFirst({ where: { property_id: pid, code: String(b.code), deleted_at: null } });
      if (dup) { badRequest(res, 'Code sudah dipakai setup lain.'); return; }
      const row = await prisma.pool_setups.create({
        data: {
          property_id: pid,
          code: String(b.code),
          item_name: String(b.item_name),
          category: b.category ? String(b.category) : null,
          used_by: b.used_by ? String(b.used_by) : 'both',
          is_required: b.is_required !== undefined ? !!b.is_required : true,
          mandatory_check: b.mandatory_check !== undefined ? !!b.mandatory_check : false,
          description: b.description ? String(b.description) : null,
          sort: Number(b.sort) || 0,
          status: b.status !== undefined ? !!b.status : true,
          created_at: new Date(), created_by: (req.user as any)?.id ?? null,
        },
      });
      await prisma.$transaction((tx) => PoolController.replaceSetupAreas(tx, row.id, pid, b.pool_areas_detail ?? []));
      await audit(req, { table: 'pool_setups', event: 'created', subjectId: row.id, attributes: row });
      const pivots = await prisma.pool_setup_areas.findMany({ where: { pool_setup_id: row.id }, orderBy: { id: 'asc' } });
      success(res, bigintToNumber({ ...row, pool_areas_detail: pivots }), 'Success', 200);
    } catch (err: any) { console.error('pool setup store:', err); error(res, 'Failed to create pool setup', 500); }
  }

  static async setupUpdate(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_setups.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool setup not found'); return; }
      const b = req.body ?? {};
      const data: any = { updated_at: new Date(), updated_by: (req.user as any)?.id ?? null };
      [
        ['code', (v: any) => String(v)], ['item_name', (v: any) => String(v)],
        ['category', (v: any) => (v ? String(v) : null)],
        ['used_by', (v: any) => (v ? String(v) : 'both')],
        ['is_required', (v: any) => !!v], ['mandatory_check', (v: any) => !!v],
        ['description', (v: any) => (v ? String(v) : null)], ['sort', (v: any) => Number(v) || 0],
        ['status', (v: any) => !!v],
      ].forEach(([k, fn]: any) => { if (b[k] !== undefined) data[k] = fn(b[k]); });
      if (data.code && String(data.code) !== row.code) {
        const dup = await prisma.pool_setups.findFirst({
          where: { property_id: row.property_id, code: String(data.code), deleted_at: null, id: { not: row.id } },
        });
        if (dup) { badRequest(res, 'Code sudah dipakai setup lain.'); return; }
      }
      const updated = await prisma.pool_setups.update({ where: { id: row.id }, data });
      await prisma.$transaction((tx) => PoolController.replaceSetupAreas(tx, row.id, row.property_id, b.pool_areas_detail ?? []));
      await audit(req, { table: 'pool_setups', event: 'updated', subjectId: row.id, attributes: updated, old: row });
      const pivots = await prisma.pool_setup_areas.findMany({ where: { pool_setup_id: row.id }, orderBy: { id: 'asc' } });
      success(res, bigintToNumber({ ...updated, pool_areas_detail: pivots }), 'Success', 200);
    } catch (err: any) { console.error('pool setup update:', err); error(res, 'Failed to update pool setup', 500); }
  }

  static async setupDestroy(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_setups.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool setup not found'); return; }
      await prisma.pool_setups.update({
        where: { id: row.id },
        data: { deleted_at: new Date(), deleted_by: (req.user as any)?.id ?? null },
      });
      await audit(req, { table: 'pool_setups', event: 'deleted', subjectId: row.id, old: row });
      success(res, null, 'Success', 200);
    } catch (err: any) { console.error('pool setup destroy:', err); error(res, 'Failed to delete pool setup', 500); }
  }

  // ════════════════════════ ATTENDANCE (menu 1204) ════════════════════════

  static async attendanceList(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const user = req.user as any;
      const ds = dateStr(req.query.date, await bizCd(req));
      const date = new Date(ds + 'T00:00:00.000Z');

      const actions = parseTransactionActions(user, 1204);
      const canOverride = !!actions['override_attendance'];

      // non-FO (tanpa check_in_pool/check_out_pool) hanya melihat absensinya sendiri
      const selfOnly = !actions['check_in_pool'] && !actions['check_out_pool'];
      const where: any = { property_id: pid, attendance_date: date, deleted_at: null };
      if (selfOnly) where.user_id = user.id;

      const rows = await prisma.pool_attendances.findMany({
        where,
        orderBy: [{ check_in_at: 'desc' }, { id: 'asc' }],
      });
      const userIds = [...new Set(rows.map((r) => Number(r.user_id)))];
      const users = userIds.length
        ? await prisma.users.findMany({ where: { id: { in: userIds.map((i) => BigInt(i)) } }, select: { id: true, name: true } })
        : [];
      const userMap = new Map(users.map((u: any) => [Number(u.id), u.name]));

      const data = rows.map((r) => ({
        ...r,
        user_name: userMap.get(Number(r.user_id)) ?? `#${r.user_id}`,
        can_override: canOverride,
      }));

      const summary = {
        total: rows.length,
        present: rows.filter((r) => Number(r.status) === 1).length,
        late: rows.filter((r) => Number(r.status) === 2).length,
        absent: rows.filter((r) => Number(r.status) === 3).length,
        leave: rows.filter((r) => Number(r.status) === 4).length,
        incomplete: rows.filter((r) => Number(r.status) === 5).length,
        overtime: rows.filter((r) => Number(r.status) === 6).length,
      };
      success(res, bigintToNumber(data), 'Success', 200, {
        meta: { summary, date: ds, can_override: canOverride },
        pagination: paginate(rows.length, rows.length, 1),
      });
    } catch (err: any) { console.error('pool attendance list:', err); error(res, 'Failed to fetch attendances', 500); }
  }

  private static async ensureChecklistRows(
    tx: any, attendanceId: bigint, propertyId: bigint, poolAreaId: bigint | null
  ): Promise<number> {
    if (!poolAreaId) return 0;
    const binds: any[] = await tx.pool_setup_areas.findMany({
      where: { property_id: propertyId, pool_area_id: poolAreaId },
    });
    const areaIdList = binds.map((b) => b.pool_setup_id);
    const setups: any[] = areaIdList.length
      ? await tx.pool_setups.findMany({ where: { id: { in: areaIdList } } })
      : [];
    const setupMap = new Map(setups.map((s) => [String(s.id), s]));
    let made = 0;
    for (const b of binds) {
      const setup = setupMap.get(String(b.pool_setup_id));
      if (!setup || setup.status !== true || setup.deleted_at != null) continue;
      await tx.pool_attendance_checklists.create({
        data: {
          pool_attendance_id: attendanceId,
          pool_setup_id: setup.id,
          qty_required: Number(b.qty) || 1,
          qty_checked: 0,
          is_checked: false,
        },
      });
      made++;
    }
    return made;
  }

  static async attendanceCheckIn(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const user = req.user as any;
      const b = req.body ?? {};
      // front office dengan izin check_in_pool boleh check-in-kan staf lain (scan)
      const actions = parseTransactionActions(user, 1204);
      const isFo = !!actions['check_in_pool'];
      if (!isFo && b?.user_id && Number(b.user_id) !== Number(user.id)) {
        badRequest(res, 'Hanya front office yang bisa check-in staf lain.'); return;
      }
      const staffId = b?.user_id != null && b.user_id !== '' ? BigInt(b.user_id) : user.id;
      if (b?.shift_id == null || b?.shift_id === '') { badRequest(res, 'shift_id wajib diisi.'); return; }
      const ds = dateStr(b?.date, await bizCd(req));
      const date = new Date(ds + 'T00:00:00.000Z');
      const now = new Date();

      const existing = await prisma.pool_attendances.findFirst({
        where: {
          property_id: pid, user_id: staffId, attendance_date: date,
          shift_id: b.shift_id ? BigInt(b.shift_id) : null, deleted_at: null,
        },
      });
      if (existing && existing.check_in_at) { badRequest(res, 'Sudah checked in untuk shift ini.'); return; }

      // status PRESENT/LATE server-side penuh — override ATAU absent hanya lewat /override
      const shift = b.shift_id ? await prisma.shift_roster.findUnique({ where: { id: BigInt(b.shift_id) } }) : null;
      let status = 1; // present
      if (shift?.time_start) {
        const start = new Date(date);
        const ts = new Date(shift.time_start);
        start.setUTCHours(ts.getUTCHours(), ts.getUTCMinutes(), 0, 0);
        if (now.getTime() > start.getTime() + TOLERANCE_MINUTES * 60 * 1000) status = 2; // late
      }

      const areaId = b?.pool_area_id != null && b.pool_area_id !== '' ? BigInt(b.pool_area_id) : null;
      const row = existing
        ? await prisma.pool_attendances.update({
            where: { id: existing.id },
            data: { check_in_at: now, check_in_by: user.id, status, pool_area_id: areaId ?? existing.pool_area_id, updated_at: now, updated_by: user.id },
          })
        : await prisma.pool_attendances.create({
            data: {
              property_id: pid, user_id: staffId,
              attendance_date: date,
              shift_id: b.shift_id ? BigInt(b.shift_id) : null,
              pool_area_id: areaId,
              check_in_at: now, check_in_by: user.id,
              status, is_override: false,
              created_at: now, created_by: user.id,
            },
          });

      const made = await prisma.$transaction((tx) =>
        PoolController.ensureChecklistRows(tx, row.id, pid, row.pool_area_id)
      );

      await audit(req, {
        table: 'pool_attendances', event: 'created', subjectId: row.id,
        name: 'pool-check-in', description: `Pool check-in status=${status} checklist_items=${made}`,
        meta: { user_id: Number(staffId), date: ds, shift_id: b?.shift_id ?? null },
      });
      success(res, { ...bigintToNumber(row), checklist_rows: made }, 'Success', 200);
    } catch (err: any) { console.error('pool check-in:', err); error(res, 'Failed to check in', 500); }
  }

  static async attendanceCheckOut(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const user = req.user as any;
      const b = req.body ?? {};
      const actions = parseTransactionActions(user, 1204);
      const isFo = !!actions['check_out_pool'];
      if (!isFo && b?.user_id && Number(b.user_id) !== Number(user.id)) {
        badRequest(res, 'Hanya front office yang bisa check-out staf lain.'); return;
      }
      const ds = dateStr(b?.date, await bizCd(req));
      const date = new Date(ds + 'T00:00:00.000Z');
      const now = new Date();

      const where: any = { property_id: pid, attendance_date: date, deleted_at: null };
      if (b?.attendance_id != null && b.attendance_id !== '') where.id = BigInt(b.attendance_id);
      else {
        where.user_id = b?.user_id != null && b.user_id !== '' ? BigInt(b.user_id) : user.id;
        where.check_in_at = { not: null };
      }
      const row = await prisma.pool_attendances.findFirst({
        where, orderBy: { id: 'desc' },
      });
      if (!row || !row.check_in_at) { notFound(res, 'Attendance / check-in tidak ditemukan'); return; }
      if (row.check_out_at) { badRequest(res, 'Sudah checked out.'); return; }

      const checks = await prisma.pool_attendance_checklists.findMany({ where: { pool_attendance_id: row.id } });
      const required = checks.length;
      const done = checks.filter((c) => c.is_checked).length;
      const complete = required === 0 || done >= required;

      let status = 1; // present
      if (row.shift_id) {
        const shift = await prisma.shift_roster.findUnique({ where: { id: row.shift_id } });
        if (shift?.time_end) {
          const ds0 = new Date(date);
          const te = new Date(shift.time_end);
          ds0.setUTCHours(te.getUTCHours(), te.getUTCMinutes(), 0, 0);
          if (now.getTime() > ds0.getTime()) status = 6; // overtime
        }
      }
      if (!complete) status = 5; // incomplete

      const updated = await prisma.pool_attendances.update({
        where: { id: row.id },
        data: {
          check_out_at: now, check_out_by: user.id, status,
          break_minutes: b?.break_minutes != null ? Number(b.break_minutes) || 0 : row.break_minutes,
          updated_at: now, updated_by: user.id,
        },
      });
      await audit(req, {
        table: 'pool_attendances', event: 'updated', subjectId: row.id,
        name: 'pool-check-out', description: `Pool check-out status=${status} checklist=${done}/${required}`,
        old: row, attributes: updated,
      });
      success(res, bigintToNumber(updated), 'Success', 200);
    } catch (err: any) { console.error('pool check-out:', err); error(res, 'Failed to check out', 500); }
  }

  static async attendanceShow(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_attendances.findFirst({
        where: { id: BigInt(String(req.params.id)), deleted_at: null },
      });
      if (!row) { notFound(res, 'Attendance not found'); return; }
      const checks = await prisma.pool_attendance_checklists.findMany({
        where: { pool_attendance_id: row.id },
        orderBy: { id: 'asc' },
      });
      const setupIds = checks.map((c) => c.pool_setup_id);
      const setups = setupIds.length
        ? await prisma.pool_setups.findMany({ where: { id: { in: setupIds } }, select: { id: true, code: true, item_name: true, category: true, is_required: true } })
        : [];
      const setupMap = new Map(setups.map((s: any) => [Number(s.id), s]));
      const data = {
        ...row,
        checklists: checks.map((c) => ({ ...c, setup: setupMap.get(Number(c.pool_setup_id)) ?? null })),
      };
      const actions = parseTransactionActions(req.user as any, 1204);
      success(res, { ...bigintToNumber(data), can_override: !!actions['override_attendance'] }, 'Success', 200);
    } catch (err: any) { console.error('pool attendance show:', err); error(res, 'Failed to fetch attendance', 500); }
  }

  static async attendanceSaveChecklist(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_attendances.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Attendance not found'); return; }
      const b = req.body ?? {};
      const checks: any[] = Array.isArray(b?.checklists) ? b.checklists : [];
      if (row.status === 3) { badRequest(res, 'Absensi ABSENT tidak bisa diubah lewat checklist.'); return; }

      await prisma.$transaction(async (tx) => {
        for (const c of checks) {
          if (c?.id == null) continue;
          await tx.pool_attendance_checklists.update({
            where: { id: BigInt(c.id) },
            data: {
              is_checked: !!c.is_checked,
              qty_checked: c.is_checked ? Number(c.qty_required) || 1 : 0,
              updated_at: new Date(),
            },
          });
        }
      });
      await audit(req, {
        table: 'pool_attendance_checklists', event: 'updated', subjectId: row.id,
        name: 'pool-attendance-checklist', description: `Checklist updated for attendance ${row.id}`,
        meta: { checklists: checks.length },
      });
      const fresh = await prisma.pool_attendance_checklists.findMany({ where: { pool_attendance_id: row.id } });
      const done = fresh.filter((c) => c.is_checked).length;
      // kalau sudah check-out dan checklist baru lengkap → INCOMPLETE jadi PRESENT/OVERTIME
      if (row.check_out_at && row.status === 5 && (fresh.length === 0 || done >= fresh.length)) {
        let restored = 1;
        if (row.shift_id) {
          const shift = await prisma.shift_roster.findUnique({ where: { id: row.shift_id } });
          const end = freshEndAt(row.attendance_date, shift?.time_end ?? null);
          if (end && row.check_out_at && new Date(row.check_out_at) > end) restored = 6;
        }
        await prisma.pool_attendances.update({
          where: { id: row.id }, data: { status: restored, updated_at: new Date() },
        });
      }
      success(res, { total: fresh.length, done }, 'Success', 200);
    } catch (err: any) { console.error('pool save checklist:', err); error(res, 'Failed to save checklist', 500); }
  }

  static async attendanceOverride(req: Request, res: Response): Promise<void> {
    try {
      const actions = parseTransactionActions(req.user as any, 1204);
      if (!actions['override_attendance']) {
        error(res, 'Tidak punya izin override_attendance.', 403); return;
      }
      const row = await prisma.pool_attendances.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Attendance not found'); return; }
      const b = req.body ?? {};
      if (b?.status == null) { badRequest(res, 'status wajib diisi.'); return; }
      if (Number(b.status) === 3 && !b?.reason?.toString()?.trim()) {
        badRequest(res, 'Wajib isi alasan untuk mark ABSENT.'); return;
      }
      const updated = await prisma.pool_attendances.update({
        where: { id: row.id },
        data: {
          status: Number(b.status), is_override: true,
          override_reason: b?.reason ? String(b.reason) : null,
          updated_at: new Date(), updated_by: (req.user as any)?.id ?? null,
        },
      });
      await audit(req, {
        table: 'pool_attendances', event: 'updated', subjectId: row.id,
        name: 'pool-attendance-override', description: `Override status ${row.status}→${updated.status}`,
        old: row, attributes: updated, logName: 'override',
      });
      success(res, bigintToNumber(updated), 'Success', 200);
    } catch (err: any) { console.error('pool override:', err); error(res, 'Failed to override attendance', 500); }
  }

  static async attendanceShifts(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const data = await prisma.shift_roster.findMany({ where: { property_id: pid, deleted_at: null } });
      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: paginate(data.length, data.length, 1),
      });
    } catch (err: any) { console.error('pool shifts:', err); error(res, 'Failed to fetch shifts', 500); }
  }

  static async staffSearch(req: Request, res: Response): Promise<void> {
    try {
      const q = String(req.query.q ?? '').trim();
      if (!q) { badRequest(res, 'q wajib diisi.'); return; }
      const users = await prisma.users.findMany({
        where: { name: { contains: q, mode: 'insensitive' }, deleted_at: null },
        select: { id: true, name: true },
        take: 20,
      });
      success(res, bigintToNumber(users.map((u: any) => ({ value: Number(u.id), label: u.name }))), 'Success', 200);
    } catch (err: any) { console.error('pool staff search:', err); error(res, 'Search gagal', 500); }
  }

  // ════════════════════════ USAGE / PILAR B (menu 1205) ════════════════════════

  static async guestSearch(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const ds = dateStr(req.query.date, await bizCd(req));
      const businessDate = new Date(ds + 'T00:00:00.000Z');
      const q = String(req.query.q ?? '').trim();
      const where: any = {
        property_id: pid,
        check_in_date: { lte: businessDate },
        check_out_date: { gte: businessDate },
        status_reservation: 0, // check_in (pos-mobile STATUS_RESERVATION)
      };
      if (q) {
        where.OR = [
          { folio_number: { contains: q, mode: 'insensitive' } },
          { first_name: { contains: q, mode: 'insensitive' } },
          { last_name: { contains: q, mode: 'insensitive' } },
        ];
      }
      const folios = await prisma.folios.findMany({ where, take: 20, orderBy: { id: 'desc' } });
      const data = folios.map((f: any) => ({
        value: Number(f.id),
        label: f.folio_number,
        guest_name: [f.first_name, f.last_name].filter(Boolean).join(' ') || f.company_name || '',
        room: null,
      }));
      success(res, bigintToNumber(data), 'Success', 200);
    } catch (err: any) { console.error('pool guest search:', err); error(res, 'Search gagal', 500); }
  }

  static async usageList(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const ds = dateStr(req.query.date, await bizCd(req));
      const date = new Date(ds + 'T00:00:00.000Z');
      const where: any = { property_id: pid, usage_date: date, deleted_at: null };
      if (req.query.posting_status !== undefined && req.query.posting_status !== '') {
        where.posting_status = Number(req.query.posting_status);
      }
      const search = String(req.query.search ?? '').trim();
      if (search) {
        where.OR = [
          { folio_number: { contains: search, mode: 'insensitive' } },
          { guest_name: { contains: search, mode: 'insensitive' } },
        ];
      }
      const rows = await prisma.pool_usages.findMany({ where, orderBy: { id: 'desc' } });
      const summary = {
        total: rows.length,
        draft: rows.filter((r) => Number(r.posting_status) === 0).length,
        posted: rows.filter((r) => [1, 2].includes(Number(r.posting_status))).length,
        void: rows.filter((r) => Number(r.posting_status) === 3).length,
        amount: rows
          .filter((r) => [0, 1, 2].includes(Number(r.posting_status)))
          .reduce((s, r) => s + Number(r.amount_total), 0),
      };
      success(res, bigintToNumber(rows), 'Success', 200, {
        meta: { summary, date: ds },
        pagination: paginate(rows.length, rows.length, 1),
      });
    } catch (err: any) { console.error('pool usage list:', err); error(res, 'Failed to fetch usages', 500); }
  }

  static async usageShow(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_usages.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool usage not found'); return; }
      const items = await prisma.pool_usage_items.findMany({
        where: { pool_usage_id: row.id, deleted_at: null }, orderBy: { id: 'asc' },
      });
      success(res, bigintToNumber({ ...row, items }), 'Success', 200);
    } catch (err: any) { console.error('pool usage show:', err); error(res, 'Failed to fetch usage', 500); }
  }

  private static insertItemsFromPayload(
    tx: any, usageId: bigint, propertyId: bigint, userId: bigint, items: any[]
  ): { qtyTotal: number; amountTotal: number; rows: any[] } {
    let qtyTotal = 0;
    let amountTotal = 0;
    const rows: any[] = [];
    for (const it of items ?? []) {
      const qty = Number(it?.qty) || 1;
      const unitPrice = Number(it?.unit_price) || 0;
      const total = qty * unitPrice;
      qtyTotal += qty;
      amountTotal += total;
      rows.push(
        tx.pool_usage_items.create({
          data: {
            property_id: propertyId,
            pool_usage_id: usageId,
            code_item_id: it?.code_item_id != null && it.code_item_id !== '' ? BigInt(it.code_item_id) : null,
            item_name: String(it?.item_name ?? ''),
            qty,
            unit_price: new Prisma.Decimal(unitPrice),
            total_amount: new Prisma.Decimal(total),
            created_at: new Date(), created_by: userId,
          },
        })
      );
    }
    return { qtyTotal, amountTotal, rows };
  }

  static async usageStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const user = req.user as any;
      const b = req.body ?? {};
      const biz = await bizCd(req);
      const ds = dateStr(b?.usage_date, biz);
      // guard: tidak boleh lebih dari business date (backdate masih boleh)
      if (ds > biz) {
        badRequest(res, `usage_date (${ds}) is after the current business date (${biz}) — the computer date is not used as a reference.`);
        return;
      }
      const usageDate = new Date(ds + 'T00:00:00.000Z');
      let folio: any = null;
      if (b?.folio_id != null && b.folio_id !== '') {
        folio = await prisma.folios.findUnique({ where: { id: BigInt(b.folio_id) } });
        if (!folio) { notFound(res, 'Folio not found'); return; }
      }

      const result = await prisma.$transaction(async (tx) => {
        const row = await tx.pool_usages.create({
          data: {
            property_id: pid,
            usage_date: usageDate,
            folio_id: folio?.id ?? null,
            folio_number: folio?.folio_number ?? (b?.folio_number ? String(b.folio_number) : null),
            guest_name: b?.guest_name ? String(b.guest_name) : folio ? [folio.first_name, folio.last_name].filter(Boolean).join(' ') || folio.company_name || null : null,
            guest_id_card: b?.guest_id_card ? String(b.guest_id_card) : null,
            pool_area_id: b?.pool_area_id != null && b.pool_area_id !== '' ? BigInt(b.pool_area_id) : null,
            swimmer_qty: Number(b?.swimmer_qty) || 1,
            usage_time: b?.usage_time ? new Date(b.usage_time) : new Date(),
            return_time: b?.return_time ? new Date(b.return_time) : null,
            notes: b?.notes ? String(b.notes) : null,
            created_at: new Date(), created_by: user.id,
          },
        });
        const ins = PoolController.insertItemsFromPayload(tx, row.id, pid, user.id, b?.items ?? []);
        if (ins.rows.length) await Promise.all(ins.rows);
        if (ins.rows.length) {
          await tx.pool_usages.update({
            where: { id: row.id },
            data: { qty_total: ins.qtyTotal, amount_total: new Prisma.Decimal(ins.amountTotal) },
          });
        }
        return { row, ins };
      });

      await audit(req, {
        table: 'pool_usages', event: 'created', subjectId: result.row.id, attributes: result.row,
        description: `Pool usage draft created (#${result.row.id}) items=${result.ins.rows.length}`,
      });
      const freshItems = await prisma.pool_usage_items.findMany({ where: { pool_usage_id: result.row.id } });
      success(res, bigintToNumber({ ...result.row, items: freshItems }), 'Success', 200);
    } catch (err: any) { console.error('pool usage store:', err); error(res, 'Failed to create usage', 500); }
  }

  static async usageUpdate(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_usages.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool usage not found'); return; }
      if (Number(row.posting_status) === POOL_STATUS.VOID) {
        badRequest(res, 'Usage sudah VOID — tidak bisa diubah.'); return;
      }
      if ([1, 2].includes(Number(row.posting_status))) {
        badRequest(res, 'Usage sudah POSTED — buat usage baru atau void dulu.'); return;
      }
      const user = req.user as any;
      const b = req.body ?? {};

      const updated = await prisma.$transaction(async (tx) => {
        const data: any = { updated_at: new Date(), updated_by: user.id };
        [
          ['guest_name', (v: any) => (v ? String(v) : null)],
          ['guest_id_card', (v: any) => (v ? String(v) : null)],
          ['swimmer_qty', (v: any) => Number(v) || 1],
          ['notes', (v: any) => (v ? String(v) : null)],
          ['usage_time', (v: any) => (v ? new Date(v) : null)],
          ['return_time', (v: any) => (v ? new Date(v) : null)],
          ['pool_area_id', (v: any) => (v != null && v !== '' ? BigInt(v) : null)],
          ['folio_id', (v: any) => (v != null && v !== '' ? BigInt(v) : null)],
        ].forEach(([k, fn]: any) => { if (b[k] !== undefined) data[k] = fn(b[k]); });
        await tx.pool_usages.update({ where: { id: row.id }, data });

        if (b?.items !== undefined) {
          await tx.pool_usage_items.deleteMany({
            where: { pool_usage_id: row.id, transaction_id: null }, // yang belum diposting
          });
          await Promise.all(
            PoolController.insertItemsFromPayload(tx, row.id, row.property_id, user.id, b.items).rows
          );
          // recount SEMUA item (draft + yang sudah pernah diposting)
          const allItems = await tx.pool_usage_items.findMany({ where: { pool_usage_id: row.id, deleted_at: null } });
          const qtyTotal = allItems.reduce((s, it) => s + (Number(it.qty) || 0), 0);
          const amountTotal = allItems.reduce((s, it) => s + Number(it.total_amount), 0);
          await tx.pool_usages.update({
            where: { id: row.id },
            data: {
              qty_total: qtyTotal,
              amount_total: new Prisma.Decimal(amountTotal),
            },
          });
        }
        return tx.pool_usages.findFirst({ where: { id: row.id } });
      });

      await audit(req, {
        table: 'pool_usages', event: 'updated', subjectId: row.id, old: row, attributes: updated,
      });
      success(res, bigintToNumber(updated), 'Success', 200);
    } catch (err: any) { console.error('pool usage update:', err); error(res, 'Failed to update usage', 500); }
  }

  /**
   * postToFolio — inti Pilar B (pola pos-mobile.controller.ts:480-605):
   * $transaction → insert transactions per item (type manual_posting, PLUS) +
   * morph model_type ke GuestProfile/CompanyProfile + set posting_status POSTED,
   * kembali kaitkan transaction_id di pool_usage_items.
   */
  static async usagePost(req: Request, res: Response): Promise<void> {
    try {
      const row = await prisma.pool_usages.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool usage not found'); return; }
      if (Number(row.posting_status) === POOL_STATUS.VOID) {
        badRequest(res, 'Usage sudah VOID.'); return;
      }
      if ([1, 2].includes(Number(row.posting_status))) {
        badRequest(res, 'Usage sudah pernah diposting.'); return;
      }
      if (!row.folio_id) {
        badRequest(res, 'Usage tanpa folio tidak bisa diposting (walk-in catat Native/foto manual).'); return;
      }
      const items = await prisma.pool_usage_items.findMany({
        where: { pool_usage_id: row.id, deleted_at: null, transaction_id: null },
        orderBy: { id: 'asc' },
      });
      if (!items.length) { badRequest(res, 'Tidak ada item untuk diposting.'); return; }

      const user = req.user as any;
      const folio = await prisma.folios.findUnique({ where: { id: row.folio_id } });
      if (!folio) { notFound(res, 'Folio not found'); return; }

      const codePost = await prisma.code_posts.findFirst({
        where: { property_id: row.property_id, type: 'DEFAULT', name: POOL_CODE_POST_NAME },
      });

      const businessDate = row.usage_date ?? new Date();
      const now = new Date();
      const description = `Pool Usage-${row.id}-`;
      const txnIds: bigint[] = [];

      await prisma.$transaction(async (tx) => {
        for (const it of items) {
          const total = Number(it.total_amount);
          const transaction = await tx.transactions.create({
            data: {
              svr_chrg: 0, pb1: 0, tax3: 0, surcharge: 0,
              amount: Math.abs(total),
              total: Math.abs(total),
              type_amount: 'PLUS',
              date: businessDate,
              created_at: now,
              type: 'manual_posting',
              model_type: 'App\\Models\\PoolUsage',
              model_id: row.id,
              code: codePost ? String(codePost.id) : null,
              code_name: codePost?.name ?? null,
              receipt: `PU-${row.id}`,
              is_posting: 1,
              is_endshift: 0,
              is_end_of_day: 0,
              description,
              status: 1,
              property_id: row.property_id,
              folio_id: folio.id,
              created_by: user.id,
            },
          });
          txnIds.push(transaction.id);
          // morph Guest/Company profile (pos-mobile morph precedent)
          if (folio.guest_profile_id) {
            await tx.transactions.update({
              where: { id: transaction.id },
              data: { model_type: 'App\\Models\\GuestProfile', model_id: folio.guest_profile_id },
            });
          } else if (folio.company_profile_id) {
            await tx.transactions.update({
              where: { id: transaction.id },
              data: { model_type: 'App\\Models\\CompanyProfile', model_id: folio.company_profile_id },
            });
          }
        }

        for (let i = 0; i < items.length; i++) {
          await tx.pool_usage_items.update({
            where: { id: items[i].id },
            data: { transaction_id: txnIds[i], updated_at: now },
          });
        }
        await tx.pool_usages.update({
          where: { id: row.id },
          data: {
            posting_status: POOL_STATUS.POSTED,
            posted_at: now,
            posted_by: user.id,
            updated_at: now, updated_by: user.id,
          },
        });
      });

      await audit(req, {
        table: 'pool_usages', event: 'updated', subjectId: row.id,
        name: 'pool-usage-posted', description: `Posted ${items.length} item(s) ke folio ${folio.folio_number}`,
        old: row, logName: 'posting',
        meta: { transaction_ids: txnIds.map(Number), folio_id: Number(folio.id) },
      });
      const freshItems = await prisma.pool_usage_items.findMany({
        where: { pool_usage_id: row.id, deleted_at: null }, orderBy: { id: 'asc' },
      });
      const fresh = await prisma.pool_usages.findFirst({ where: { id: row.id } });
      success(res, bigintToNumber({ ...fresh, items: freshItems }), 'Success', 200);
    } catch (err: any) { console.error('pool usage post:', err); error(res, 'Failed to post usage', 500); }
  }

  static async usageVoid(req: Request, res: Response): Promise<void> {
    try {
      const actions = parseTransactionActions(req.user as any, 1205);
      if (!actions['void_pool_usage']) {
        error(res, 'Tidak punya izin void_pool_usage.', 403); return;
      }
      const row = await prisma.pool_usages.findFirst({ where: { id: BigInt(String(req.params.id)), deleted_at: null } });
      if (!row) { notFound(res, 'Pool usage not found'); return; }
      if (Number(row.posting_status) === POOL_STATUS.VOID) {
        badRequest(res, 'Usage sudah VOID.'); return;
      }
      const user = req.user as any;
      const b = req.body ?? {};

      const updated = await prisma.$transaction(async (tx) => {
        // kalau sudah pernah posting → VOID transaksi folio terkait (set status false),
        // pola void transaksi accounting
        if ([1, 2].includes(Number(row.posting_status))) {
          const linked = await tx.pool_usage_items.findMany({ where: { pool_usage_id: row.id, transaction_id: { not: null } } });
          for (const li of linked) {
            if (li.transaction_id) {
              await tx.transactions.update({
                where: { id: li.transaction_id },
                data: { status: 0, updated_at: new Date(), updated_by: user.id },
              });
            }
          }
        }
        return tx.pool_usages.update({
          where: { id: row.id },
          data: {
            posting_status: POOL_STATUS.VOID,
            notes: [row.notes, b?.reason ? `VOID: ${b.reason}` : null].filter(Boolean).join(' | ') || null,
            updated_at: new Date(), updated_by: user.id,
          },
        });
      });
      await audit(req, {
        table: 'pool_usages', event: 'updated', subjectId: row.id,
        name: 'pool-usage-void', description: `VOID pool usage #${row.id}`,
        old: row, attributes: updated, logName: 'override',
      });
      success(res, bigintToNumber(updated), 'Success', 200);
    } catch (err: any) { console.error('pool usage void:', err); error(res, 'Failed to void usage', 500); }
  }

  static async usageCodeItems(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const post = await prisma.code_posts.findFirst({
        where: { property_id: pid, type: 'DEFAULT', name: POOL_CODE_POST_NAME },
      });
      if (!post) { success(res, [], 'Success', 200); return; }
      const items = await prisma.code_items.findMany({
        where: { code_post_id: post.id, property_id: pid, deleted_at: null, status: 1 },
        orderBy: { sort: 'asc' },
      });
      success(res, bigintToNumber(
        items.map((i: any) => ({
          value: Number(i.id), item_name: i.name, label: i.name,
          unit_price: Number(i.sales), description: i.description,
        }))
      ), 'Success', 200);
    } catch (err: any) { console.error('pool code items:', err); error(res, 'Failed to fetch code items', 500); }
  }

  // ════════════════════════ RECAP (menu 1206) ════════════════════════

  static async recap(req: Request, res: Response): Promise<void> {
    try {
      const pid = pidOf(req);
      const biz = await bizCd(req);
      // default range = 7 hari terakhir BERAKHIR di business date
      const defaultFrom = shiftDays(biz, -6);
      const from = dateStr(req.query.date_from, defaultFrom);
      const to = dateStr(req.query.date_to, biz);
      const fromDate = new Date(from + 'T00:00:00.000Z');
      const toDate = new Date(to + 'T00:00:00.000Z');

      const [usages, atts] = await Promise.all([
        prisma.pool_usages.findMany({
          where: { property_id: pid, usage_date: { gte: fromDate, lte: toDate }, deleted_at: null },
          orderBy: { usage_date: 'desc' },
        }),
        prisma.pool_attendances.findMany({
          where: { property_id: pid, attendance_date: { gte: fromDate, lte: toDate }, deleted_at: null },
        }),
      ]);

      const byDay = new Map<string, any>();
      const ensure = (ds: string) => {
        if (!byDay.has(ds)) {
          byDay.set(ds, { date: ds, usages: 0, amounts: 0, posted: 0, draft: 0, void: 0, swimmers: 0, attendances: 0, present: 0, late: 0, absent: 0 });
        }
        return byDay.get(ds);
      };
      usages.forEach((u) => {
        const d = ensure(u.usage_date.toISOString().slice(0, 10));
        d.usages++;
        d.swimmers += Number(u.swimmer_qty) || 0;
        const st = Number(u.posting_status);
        if (st === 3) { d.void++; return; }
        d.amounts += Number(u.amount_total);
        if (st === 0) { d.draft++; return; }
        d.posted++;
      });
      atts.forEach((a) => {
        const d = ensure(a.attendance_date.toISOString().slice(0, 10));
        d.attendances++;
        const st = Number(a.status);
        if (st === 1 || st === 6) d.present++;   // present / overtime termasuk 'datang'
        else if (st === 2) d.late++;
        else if (st === 3) d.absent++;
      });
      const rows = [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
      success(res, bigintToNumber({ rows, meta: { from, to } }), 'Success', 200);
    } catch (err: any) { console.error('pool recap:', err); error(res, 'Failed to fetch recap', 500); }
  }
}

function freshEndAt(day: Date, time: Date | null): Date | null {
  if (!time) return null;
  const d = new Date(day);
  d.setUTCHours(time.getUTCHours(), time.getUTCMinutes(), 0, 0);
  return d;
}
