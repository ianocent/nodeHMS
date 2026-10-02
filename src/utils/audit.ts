/**
 * Audit log writer — Laravel `HasLogs` / Spatie Activitylog parity.
 *
 * Laravel attaches the `LogsActivity` trait to ~134 models, so any create /
 * update / delete automatically lands in the `logs` table. `tapActivity()`
 * fixes the row shape:
 *
 *   name        = trans(':table-:event')   → slug(table) + '-' + event
 *   description = trans(':table has been :event') → table('_'→' ') + ' has been ' + event
 *   properties  = { attributes, old, fingerprint: {...}, raw: {...} }
 *
 * The Node port had the read endpoint (`/cms/log`) and the table, but wrote
 * nothing: the newest row in a dev database was 62 days old, all of it written
 * by Laravel before the port. This module is the missing write side.
 *
 * The fingerprint keys are the ones Laravel's tapActivity actually populates
 * (the ip/method lines are commented out there, so they are omitted here too).
 */
import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
/** `company_profile` -> `company-profile` (Laravel `str()->slug('-')`). */
function slug(value: string): string {
  return String(value).replace(/[_\s]+/g, '-').toLowerCase();
}

/** `company_profiles` -> `CompanyProfile` for the morph `subject_type`. */
function studly(value: string): string {
  return String(value)
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/**
 * Table name -> singular, because Laravel's morph stores the MODEL class, not
 * the table: `folios` -> `App\Models\Folio`, not `...Folios`.
 *
 * The `-us` case is genuinely ambiguous (campus/campus vs menu/menus), so the
 * irregular tables this schema actually contains are listed rather than guessed.
 */
const IRREGULAR_SINGULAR: Record<string, string> = {
  menus: 'menu',
  cities: 'city',
  countries: 'country',
  properties: 'property',
  users: 'user',
  roles: 'role',
  statuses: 'status',
  analyses: 'analysis',
  addresses: 'address',
  categories: 'category',
  children: 'child',
  people: 'person',
  indices: 'index',
  matrices: 'matrix',
  vertices: 'vertex',
  data: 'datum',
};

function singular(value: string): string {
  const word = String(value);
  if (IRREGULAR_SINGULAR[word]) return IRREGULAR_SINGULAR[word];
  if (/(?:ss|is|us)$/i.test(word)) return word; // address, analysis, campus
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y'; // categories
  if (/(?:ch|sh|s|x|z)es$/i.test(word)) return word.slice(0, -2); // boxes, statuses
  if (/[^s]s$/i.test(word)) return word.slice(0, -1); // folios
  return word;
}

/** `folios` -> `Folio`, the class Laravel records in `subject_type`. */
function modelClass(table: string): string {
  return `App\\Models\\${studly(singular(table))}`;
}

/** Exposed for the subject_type mapping test. */
export const modelClassFor = modelClass;

export type AuditEvent = 'created' | 'updated' | 'deleted' | 'restored';

export interface AuditInput {
  /** DB table name, e.g. `company_profiles` (or a Prisma delegate plural). */
  table: string;
  event: AuditEvent;
  subjectId: bigint | number | null | undefined;
  /** New state — `attributes` in Laravel. Omitted for deletes. */
  attributes?: any;
  /** Previous state — `old` in Laravel. */
  old?: any;
  /** Set when nothing actually changed; Laravel's `logOnlyDirty()` skips those. */
  unchanged?: boolean;
  /**
   * Override the derived `folios-updated` name. Domain events need a name the
   * operations team can search for (`folio-checked-in`), not a CRUD slug.
   */
  name?: string;
  /** Override the derived description. */
  description?: string;
  /** Bucket in the `log_name` column. Defaults to `system`. */
  logName?: string;
  /** Extra keys merged into `properties` (e.g. `rooms`, `remark`, `ids`). */
  meta?: Record<string, any>;
}
/** Deep-clone + strip BigInt/Date so the payload survives JSON.stringify. */
function jsonSafe(value: any, seen = new WeakSet()): any {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v, seen));
  const out: any = {};
  for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v, seen);
  return out;
}

/** The request fields Laravel's `raw` snapshot keeps. */
function rawRequest(req: Request): any {
  const skip = new Set(['_token', '_method']);
  const out: any = {};
  for (const source of [req.body, req.query]) {
    if (source && typeof source === 'object') {
      for (const [k, v] of Object.entries(source as Record<string, any>)) {
        if (!skip.has(k)) out[k] = jsonSafe(v);
      }
    }
  }
  return out;
}

function fingerprint(req: Request): any {
  return {
    agent: req.get?.('user-agent') ?? req.headers['user-agent'] ?? null,
    url: `${req.protocol}://${req.get?.('host') ?? ''}${req.originalUrl ?? ''}`,
    route: (req as any).route?.name ?? null,
    parent_id: (req.query as any)?.parent ?? null,
    menu_id: (req.query as any)?.menu_id ?? null,
    module: (req.query as any)?.module ?? null,
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}

/**
 * Append one audit row. Never throws: losing the audit trail must not fail the
 * business write that produced it, so callers can `await` this without a guard.
 *
 * `prisma` is injected (same convention as utils/reservationPricing.ts) so this
 * module does not open a second connection pool.
 */
export async function writeAudit(
  prisma: PrismaClient,
  req: Request,
  input: AuditInput
): Promise<void> {
  try {
    // Laravel LogOptions::dontSubmitEmptyLogs() + logOnlyDirty(): a no-op update
    // produces no activity row.
    if (input.unchanged) return;

    const table = input.table;
    const name = input.name ?? `${slug(table)}-${input.event}`;
    const description = input.description ?? `${table.replace(/_/g, ' ')} has been ${input.event}`;

    const properties: any = {
      fingerprint: fingerprint(req),
      raw: rawRequest(req),
    };
    if (input.attributes !== undefined) properties.attributes = jsonSafe(input.attributes);
    if (input.old !== undefined) properties.old = jsonSafe(input.old);
    if (input.meta !== undefined) properties.meta = jsonSafe(input.meta);

    const now = new Date();
    await (prisma as any).logs.create({
      data: {
        subject_type: modelClass(table),
        subject_id: input.subjectId != null ? BigInt(input.subjectId) : null,
        causer_type: 'App\\Models\\User',
        causer_id: req.user?.id != null ? BigInt(req.user.id) : null,
        name,
        log_name: input.logName ?? 'system',
        description,
        event: input.event,
        properties: JSON.stringify(properties),
        created_at: now,
        updated_at: now,
      },
    });
  } catch (err: any) {
    console.error('[audit] failed to write activity row:', err?.message);
  }
}

/** True when an update changed nothing, so `logOnlyDirty()` should suppress it. */
export function isUnchanged(before: any, after: any): boolean {
  const strip = (v: any) => JSON.stringify(jsonSafe(v));
  return strip(before) === strip(after);
}

// ─────────────────────────────────────────────────────────────────────────────
// Destructive-operation authorisation
// ─────────────────────────────────────────────────────────────────────────────

export interface Approver {
  id: string;
  name: string;
}

export interface ApprovalOutcome {
  ok: boolean;
  code: number;
  message: string;
  approver?: Approver;
}

/**
 * Loads the approver only when the supplied PIN matches their
 * `pin_void_approve`. Kept as an injected function so this module stays free of
 * a Prisma dependency and the permission rule lives with the caller.
 */
export type ApproverLoader = (userId: bigint, pin: string) => Promise<Approver | null>;

/**
 * Require a second pair of eyes for void / refund.
 *
 * The old gate asked for `pin_enshift` — the operator's OWN shift-close PIN —
 * so it authorised nothing: any cashier who could press "Void" approved their
 * own void with a PIN they had set themselves.
 *
 * The approver must
 *   1. not be the operator,
 *   2. present a PIN matching their `pin_void_approve`, and
 *   3. hold the destructive transaction action on some menu (`canAct`).
 *
 * Failure is always a 4xx. There is no path that returns ok without naming an
 * approver, so the audit row can never claim approval that did not happen.
 */
export async function requireApproval(
  payload: { approved_by?: any; approval_pin?: any } | undefined,
  operatorId: bigint | null | undefined,
  loadApprover: ApproverLoader,
  canAct: (approver: Approver) => boolean | Promise<boolean>
): Promise<ApprovalOutcome> {
  const userIdRaw = payload?.approved_by;
  const pinRaw = payload?.approval_pin;

  if (userIdRaw === undefined || userIdRaw === null || userIdRaw === '') {
    return { ok: false, code: 400, message: 'Supervisor approval is required for this operation' };
  }
  if (pinRaw === undefined || pinRaw === null || pinRaw === '') {
    return { ok: false, code: 400, message: 'Supervisor PIN is required' };
  }

  let approverId: bigint;
  try {
    approverId = BigInt(userIdRaw);
  } catch {
    return { ok: false, code: 400, message: 'Invalid approver id' };
  }
  if (operatorId != null && approverId === BigInt(operatorId)) {
    return { ok: false, code: 403, message: 'You cannot approve your own void. Ask a supervisor.' };
  }

  const approver = await loadApprover(approverId, String(pinRaw));
  if (!approver) {
    // Deliberately vague: do not confirm whether the id exists or only the PIN
    // was wrong.
    return { ok: false, code: 403, message: 'Invalid approver or PIN' };
  }
  if (!(await canAct(approver))) {
    return { ok: false, code: 403, message: `${approver.name} is not authorised to approve this operation` };
  }

  return { ok: true, code: 200, message: 'Approved', approver };
}

/**
 * Does this user hold `transactionAction` on any menu via any of their roles?
 *
 * Mirrors the merge in auth.controller (roles are unioned, and the JSON blob is
 * last-write-wins per menu there, so we union across every row here too).
 */
export async function userHasTransactionAction(
  prisma: PrismaClient,
  userId: bigint,
  transactionAction: string
): Promise<boolean> {
  try {
    const roleLinks = await (prisma as any).model_has_roles.findMany({
      where: { model_id: userId },
      select: { role_id: true },
    });
    const roleIds = roleLinks.map((r: any) => r.role_id).filter((x: any) => x != null);
    if (roleIds.length === 0) return false;

    const rows: any[] = await (prisma as any).role_menu_crud.findMany({
      where: { role_id: { in: roleIds } },
      select: { transaction_actions: true },
    });
    for (const row of rows) {
      if (!row?.transaction_actions) continue;
      let actions: any;
      try {
        actions = typeof row.transaction_actions === 'string'
          ? JSON.parse(row.transaction_actions)
          : row.transaction_actions;
      } catch {
        continue;
      }
      if (actions && actions[transactionAction]) return true;
    }
    return false;
  } catch (err: any) {
    console.error('[audit] transaction-action lookup failed:', err?.message);
    return false;
  }
}

/** Super-user roles bypass the action check, same as the permission middleware. */
export const APPROVER_BYPASS_ROLES = ['developer', 'administrator', 'anyaman'];

export function isApproverBypass(name: string, roleNames: string[]): boolean {
  const n = String(name ?? '').toLowerCase();
  if (APPROVER_BYPASS_ROLES.includes(n)) return true;
  return roleNames.some((r) => APPROVER_BYPASS_ROLES.includes(String(r ?? '').toLowerCase()));
}
