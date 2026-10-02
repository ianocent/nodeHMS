import { prisma } from '../config/prisma';
// @ts-ignore
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
// @ts-ignore
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { success, error, badRequest, notFound, forbidden } from '../utils/response';
import { decrypt, encrypt } from '../utils/encryption';
import { getPermissionFlags } from '../middleware/permission.middleware';
import { STATUSES, moneyFormat, calculateCodePost, DEPOSIT_REFERENCE_PREFIX } from '../utils/cmsConfig';
import { ROOM_STATUSES, MAID_STATUSES, getColorRoom, getColorMaid } from '../utils/cmsStatus';
import { dataSearch, applySearchField } from '../utils/search';
import { formatFolioActions } from '../utils/folioActions';
import { storedImageUrl } from '../utils/storage';
import { missingMandatoryFields, readPropertyMandatory } from '../utils/guestMandatory';
import { AuthController } from './auth.controller';
import { TokenService } from '../services/token.service';
import { enqueueJob } from '../config/queue';
import { sendTemplateEmail } from '../services/mail.service';
import { writeAudit, requireApproval, userHasTransactionAction, isApproverBypass } from '../utils/audit';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Domain rejection raised from inside a `$transaction` callback. Express error
 * middleware cannot see a throw from a transaction, so handlers catch this and
 * translate it into the real 4xx instead of swallowing it as a 500.
 */
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}


// Laravel Room::AvailableRoom parity: room blocked if availability hold, active work order, or overlapping reservation
//
// `db` is injectable so check-in can run the read inside the same serializable
// transaction that writes the occupancy. The old signature always used the
// module-level client, which made the check a plain read-then-write (TOCTOU):
// two concurrent check-ins could both observe a free room and both commit.
type Db = Pick<typeof prisma, 'rooms' | 'room_availabilities' | 'work_orders' | 'reservations'>;
async function isRoomAvailableFor(propertyId: bigint, roomId: bigint, start: string, end: string, excludeFolioId?: bigint, db: Db = prisma): Promise<boolean> {
  const s = new Date(start + 'T00:00:00.000Z');
  const e = new Date(end + 'T23:59:59.999Z');
  const [room, avail, workOrders, reservations] = await Promise.all([
    db.rooms.findUnique({ where: { id: roomId }, select: { id: true, deleted_at: true, room_status: true } }),
    db.room_availabilities.findMany({ where: { deleted_at: null, room_id: Number(roomId), date: { gte: s, lte: e } }, select: { id: true } }),
    db.work_orders.findMany({ where: { deleted_at: null, status: 1, room_id: roomId, date: { gte: s }, end_date: { lte: e } }, select: { id: true } }),
    db.reservations.findMany({
      where: {
        date: { gte: s, lte: e },
        status_reservation: { in: [STATUS_RESERVATION.check_in.id, STATUS_RESERVATION.reservation.id] },
        ...(excludeFolioId ? { folio_id: { not: excludeFolioId } } : {}),
        OR: [{ room_id: roomId }, { room_id_next: roomId }],
      },
      select: { id: true },
    }),
  ]);
  // out_of_order(4) and block(3) are both unsellable. Only rejecting 4 (the old
  // behaviour) let a room blocked on the grid be handed to a guest.
  const unsellable = room?.room_status === ROOM_STATUSES.out_of_order.id || room?.room_status === ROOM_STATUSES.block.id;
  return !!room && !room.deleted_at && !unsellable && avail.length === 0 && workOrders.length === 0 && reservations.length === 0;
}

// Laravel Allotment::checkAllotmentRoom (:31-82) — quota decrement per weekday is
// PERSISTED at check-in time. Returns error message or null when OK.
async function checkAllotmentRoom(folio: any): Promise<string | null> {
  const allot = await prisma.allotments.findFirst({
    where: {
      deleted_at: null,
      start_date: { lte: folio.check_in_date },
      end_date: { gte: folio.check_out_date },
      ...(folio.company_profile_id
        ? { model_id: folio.company_profile_id, model_type: 'App\\Models\\CompanyProfile' }
        : { model_id: folio.guest_profile_id ?? 0n, model_type: 'App\\Models\\GuestProfile' }),
    },
  });
  if (!allot) return 'No Allotment';

  const roomAllots = await prisma.room_allotments.findMany({ where: { allotment_id: allot.id, deleted_at: null } });
  const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const resv of folio.reservations) {
    // Laravel builds each night as date→date+1 → diffInDays is always 1
    const ra = roomAllots.find((x) => Number(x.room_type_id) === Number(resv.room_type_id));
    if (!ra) return 'No Room Allotment';
    let dataJson: any;
    try {
      dataJson = typeof ra.data === 'string' ? JSON.parse(ra.data || '{}') : (ra.data || {});
    } catch { dataJson = {}; }
    for (let i = 0; i < 1; i++) {
      const d = new Date(resv.date);
      d.setDate(d.getDate() + i);
      const dayName = DAY_NAMES[d.getUTCDay()];
      const quota = Number(dataJson[dayName] ?? 0);
      if (quota >= 1) dataJson[dayName] = quota - 1;
      else return `No Room Allotment In ${dataJson[dayName] ?? 0}`;
    }
    await prisma.room_allotments.update({ where: { id: ra.id }, data: { data: JSON.stringify(dataJson), updated_at: new Date() } });
  }
  return null;
}

const DAY_USE_REF = 'RESERVATION DAY USE';
const timeStr = (d: Date | null | undefined): string => (d ? d.toISOString().slice(11, 19) : '00:00:00');
const safeParseData = (raw: any): any => {
  try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { return {}; }
};

// Folio id resolution for the status endpoints. The path param wins; body and
// query are accepted so `?folio_id=` / `{ id }` callers keep working. Returns
// null instead of throwing so a bad id becomes a 400, not a 500.
function resolveFolioId(req: Request): bigint | null {
  const pathParam = Array.isArray(req.params?.id) ? req.params.id[0] : req.params?.id;
  const raw =
    pathParam ??
    (req.body as any)?.id ??
    (req.body as any)?.folio_id ??
    (req.query as any)?.folio_id ??
    (req.query as any)?.id;
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

// ── Folio settlement gate ────────────────────────────────────────────────
// Single source of truth for "may this folio check out?". The previous check
// was `[0, 1, -1].includes(Math.ceil(balance))`, which is a float comparison
// with an asymmetric band: it let a guest walk out owing up to 2.00 while
// blocking 1.01 of under-payment, and Math.ceil on a JS double is not
// precision-safe. This sums each row as integer minor units (2dp, the
// scale of transactions.total) and requires the result to settle inside a
// 1-minor-unit tolerance, so float drift can never fake a settlement.
const MINOR_UNITS = 100;
const SETTLE_TOLERANCE_MINOR = 1;

function toMinorUnits(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * MINOR_UNITS);
}

/** Sum a folio's transactions into integer minor units. */
function sumBalanceMinorUnits(rows: Array<{ type_amount: string | null; total: unknown }>): number {
  return rows.reduce((acc, r) => {
    const v = toMinorUnits(r.total);
    return r.type_amount === 'MINUS' ? acc - v : acc + v;
  }, 0);
}

/** true when the folio owes nothing (within rounding tolerance). */
function isFolioSettledMinor(balanceMinor: number): boolean {
  return Math.abs(balanceMinor) <= SETTLE_TOLERANCE_MINOR;
}

// Re-exported so the settlement rule has exactly one definition. folio.controller
// used to carry its own copy of the old float/`Math.ceil` band, which is how the
// cancel gate and the check-out gate ended up disagreeing.
export const isFolioSettledMinorPublic = isFolioSettledMinor;

/**
 * Verify a supervisor approved a destructive cashiering operation.
 *
 * The UI used to ask for `pin_enshift` via GET /cms/check-value and then simply
 * proceed — so the "authorisation" was the operator's own shift-close PIN, typed
 * by the operator. Nothing was actually gated. The approval is now re-verified
 * here, at the moment of the write, against a named approver who is not the
 * operator and who holds the action on some menu.
 */
async function verifySupervisorApproval(
  req: Request,
  transactionAction: 'void' | 'refund'
): Promise<{ ok: true; approver: { id: string; name: string } } | { ok: false; code: number; message: string }> {
  const outcome = await requireApproval(
    req.body,
    req.user?.id ?? null,
    async (userId, pin) => {
      const row = await prisma.users.findFirst({
        where: { id: userId, deleted_at: null },
        select: { id: true, name: true, pin_void_approve: true },
      });
      if (!row) return null;
      if (row.pin_void_approve === null || row.pin_void_approve === undefined) return null;
      if (String(row.pin_void_approve) !== String(pin).trim()) return null;
      return { id: String(row.id), name: row.name };
    },
    async (approver) => {
      if (isApproverBypass(approver.name, [])) return true;
      // @ts-ignore
      return userHasTransactionAction(prisma, BigInt(approver.id), transactionAction);
    }
  );
  if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message };
  return { ok: true, approver: outcome.approver! };
}

// Laravel ExtraDayUseService (:29-199) — ETD calc + extra-quantity manual_posting txn.
async function processExtraDayUse(folio: any, firstResv: any): Promise<{ code: number; message: string } | null> {
  if (!folio.is_day_use) return null;
  const quantityExtraDayUse = Number(firstResv.quantity_extra_day_use ?? 0);
  const quantityDayUse = Number(firstResv.quantity ?? 1);

  // Folio is already status check_in at call time → Laravel uses ATA as base.
  const eta = timeStr(firstResv.ata ?? firstResv.eta);

  const packageDayUse = firstResv.package_id
    ? await prisma.rate_day_uses.findFirst({ where: { id: BigInt(firstResv.package_id), deleted_at: null } })
    : null;
  if (!packageDayUse) return { code: 404, message: 'Day use Package Not Found.' };

  const timeDayUse = Number(packageDayUse.time ?? 0) * quantityDayUse;
  const [eh, em, es] = eta.split(':').map(Number);
  const etdBase = new Date();
  etdBase.setUTCHours(eh || 0, em || 0, es || 0, 0);
  const etd = new Date(etdBase.getTime() + timeDayUse * 60000);

  // Extra-quantity transaction (is_check_in → delta = full requested qty)
  if (quantityExtraDayUse !== 0) {
    const prop: any = await prisma.properties.findUnique({ where: { id: folio.property_id }, select: { id: true, day_use_item_code: true } });
    const itemCode = prop?.day_use_item_code ? await prisma.code_items.findUnique({ where: { id: BigInt(prop.day_use_item_code) } }) : null;
    const codePost = itemCode?.code_post_id ? await prisma.code_posts.findUnique({ where: { id: BigInt(itemCode.code_post_id) } }) : null;
    if (!itemCode || !codePost) return { code: 404, message: 'Item Code or Code Post not found for extra day use.' };

    const amount = Math.abs(quantityExtraDayUse) * Number(itemCode.sales ?? 0);
    const calc = calculateCodePost(
      {
        tax: codePost.tax ?? false,
        tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
        local_tax: codePost.local_tax ?? false,
        local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
        service_charge: codePost.service_charge ?? false,
        service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
        service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
        tax_include_local_tax: codePost.tax_include_local_tax ?? false,
      },
      amount,
      false
    );
    await prisma.transactions.create({
      data: {
        property_id: folio.property_id,
        folio_id: folio.id,
        type: 'manual_posting',
        type_amount: quantityExtraDayUse > 0 ? 'PLUS' : 'MINUS',
        date: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'),
        code: String(codePost.id),
        code_name: codePost.name,
        amount: calc.amount,
        svr_chrg: calc.service,
        tax3: calc.tax3,
        pb1: calc.pb1,
        total: calc.total,
        surcharge: 0,
        remark: 'EXTRA DAY USE',
        description: 'EXTRA DAY USE',
        reference: DAY_USE_REF,
        model_type: folio.guest_profile_id ? 'App\\Models\\GuestProfile' : 'App\\Models\\CompanyProfile',
        model_id: folio.guest_profile_id ?? folio.company_profile_id,
        is_posting: 1,
        status: 1,
        created_at: new Date(),
      },
    });
  }

  // New ETD: +30 min per extra quantity, else base ETD (= Laravel :77-96)
  const newEtd = quantityExtraDayUse > 0 ? new Date(etd.getTime() + 30 * 60000 * quantityExtraDayUse) : etd;
  await prisma.reservations.updateMany({ where: { folio_id: folio.id, deleted_at: null }, data: { etd: newEtd } });
  return null;
}

// Laravel ExtraDayUseService@postingRevenueDayUse (:201-407) — room_revenue + extra_bed +
// additional_item posting with DAY USE reference; marks rows posted.
async function postingRevenueDayUse(folioId: bigint, pid: bigint, businessDate: string): Promise<void> {
  const dateObj = new Date(businessDate + 'T00:00:00.000Z');
  const postOne = async (
    folio: any, codePost: any, amount: number, type: string, ledgerRow: any | null
  ) => {
    const calc = calculateCodePost(
      {
        tax: codePost.tax ?? false,
        tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
        local_tax: codePost.local_tax ?? false,
        local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
        service_charge: codePost.service_charge ?? false,
        service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
        service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
        tax_include_local_tax: codePost.tax_include_local_tax ?? false,
      },
      amount,
      false
    );
    let profileModelType: string | null = null;
    let profileId: bigint | null = null;
    if (ledgerRow) {
      profileModelType = String(ledgerRow.profileable_type ?? '').split('\\').pop() === 'GuestProfile'
        ? 'App\\Models\\GuestProfile' : 'App\\Models\\CompanyProfile';
      profileId = BigInt(Number(ledgerRow.profileable_id));
    } else if (folio.company_profile_id) {
      profileModelType = 'App\\Models\\CompanyProfile';
      profileId = folio.company_profile_id;
    }
    await prisma.transactions.create({
      data: {
        property_id: BigInt(pid),
        folio_id: folio.id,
        type,
        type_amount: 'PLUS',
        date: dateObj,
        code: String(codePost.id),
        code_name: codePost.name,
        amount: calc.amount,
        svr_chrg: calc.service,
        tax3: calc.tax3,
        pb1: calc.pb1,
        total: calc.total,
        surcharge: 0,
        reference: DAY_USE_REF,
        model_type: profileModelType ?? undefined,
        model_id: profileId ?? undefined,
        is_posting: 1,
        is_end_of_day: 1,
        is_endshift: 1,
        status: 1,
        created_at: new Date(),
      },
    });
  };

  const folios = await prisma.folios.findMany({
    where: { id: folioId, is_virtual: false, deleted_at: null },
    include: { reservations: { where: { is_posting: 0, deleted_at: null }, include: { rates: true } } },
  });
  // ledgers has no Prisma relation to folios — query by folio_id
  const folioLedgers = await prisma.ledgers.findMany({ where: { folio_id: Number(folioId) } });
  for (const folio of folios) {
    for (const value of folio.reservations) {
      const codePost = value.rates?.code_post_id ? await prisma.code_posts.findUnique({ where: { id: BigInt(value.rates.code_post_id) } }) : null;
      if (codePost) {
        const ledgerRow = codePost.code_billing_id
          ? folioLedgers.find((l: any) => Number(l.code_billing_id) === Number(codePost.code_billing_id)) ?? null
          : null;
        await postOne(folio, codePost, Number(value.total ?? 0), 'room_revenue', ledgerRow);
      }
      if (Number(value.total_extra_bed ?? 0) > 0 && value.rates?.code_post_extra_bed_id) {
        const cpExtra = await prisma.code_posts.findUnique({ where: { id: BigInt(value.rates.code_post_extra_bed_id) } });
        if (cpExtra) {
          const ledgerRow = cpExtra.code_billing_id
            ? folioLedgers.find((l: any) => Number(l.code_billing_id) === Number(cpExtra.code_billing_id)) ?? null
            : null;
          await postOne(folio, cpExtra, Number(value.total_extra_bed), 'extra_bed', ledgerRow);
        }
      }
      await prisma.reservations.update({ where: { id: value.id }, data: { is_posting: 1 } });
    }

    // additional_item loop for this folio (= Laravel :318-396)
    const items: any[] = await prisma.$queryRaw`
      SELECT * FROM model_has_code_items
      WHERE model_id = ${folio.id} AND model_type = 'App\\Models\\Folio'
        AND start_date <= ${dateObj} AND end_date >= ${dateObj}
    `;
    if (items.length > 0) {
      for (const item of items) {
        const codeItemId = Number(item.code_item_id);
        if (!codeItemId) continue;
        const codeItem = await prisma.code_items.findUnique({ where: { id: BigInt(codeItemId) } });
        if (!codeItem?.code_post_id) continue;
        const codePost = await prisma.code_posts.findUnique({ where: { id: BigInt(codeItem.code_post_id) } });
        if (!codePost) continue;
        const ledgerRow = codePost.code_billing_id
          ? folioLedgers.find((l: any) => Number(l.code_billing_id) === Number(codePost.code_billing_id)) ?? null
          : null;
        const upsales = Number(item.upsales ?? 0);
        const sales = Number(item.sales ?? 0);
        await postOne(folio, codePost, upsales > 0 ? upsales : sales, 'additional_item', ledgerRow);
      }
      await prisma.$executeRaw`
        UPDATE model_has_code_items SET is_posting = 1
        WHERE model_id = ${folio.id} AND model_type = 'App\\Models\\Folio'
          AND start_date <= ${dateObj} AND end_date >= ${dateObj}
      `;
    }
  }
}

// Tax calc helper — Laravel TransactionController@tax parity (:664-709) for non-payment types
async function calcTaxForCode(code: string | bigint | null, sumPrice: number) {
  const codePost = code ? await prisma.code_posts.findUnique({ where: { id: BigInt(code) } }) : null;
  const calc = codePost ? calculateCodePost(
    {
      tax: codePost.tax ?? false,
      tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
      local_tax: codePost.local_tax ?? false,
      local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
      service_charge: codePost.service_charge ?? false,
      service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
      service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
      tax_include_local_tax: codePost.tax_include_local_tax ?? false,
    },
    sumPrice,
    false
  ) : { amount: sumPrice, service: 0, tax3: 0, pb1: 0, total: sumPrice };
  return { amount: calc.amount, svr_chrg: calc.service, pb1: calc.pb1, tax3: calc.tax3, total: calc.total, code: codePost ? String(codePost.id) : String(code ?? '') };
}

// Laravel Folio@getBalanceWithOutPosting parity (Folio.php:761-779)
// GIT parent: children company-billed + own all; GIT sub: guest-billed only; else all txns.
//
// This is the SINGLE source of truth for the settlement gate. It sums each
// transaction as integer minor units; the float variant below is derived from
// it for display only, so the number the guest sees and the number the gate
// evaluates can no longer diverge by a rounding rule.
export async function folioBalanceMinorUnits(folio: { id: bigint; type_reservation: string | null; parent: number | bigint | null }): Promise<number> {
  const isGit = String(folio.type_reservation ?? '').toLowerCase() === 'git';
  const parentNum = Number(folio.parent ?? 0);

  if (isGit && parentNum === 0) {
    const children = await prisma.folios.findMany({
      where: { parent: folio.id, deleted_at: null },
      select: { transactions: { where: { model_type: 'App\\Models\\CompanyProfile' }, select: { type_amount: true, total: true } } },
    });
    let balance = 0;
    for (const c of children) balance += sumBalanceMinorUnits(c.transactions);
    const own = await prisma.transactions.findMany({ where: { folio_id: folio.id }, select: { type_amount: true, total: true } });
    balance += sumBalanceMinorUnits(own);
    // A deposit belongs to the p-block it was taken on, so the group total has
    // to include the children's deposits too.
    const childIds = children.length > 0
      ? (await prisma.folios.findMany({ where: { parent: folio.id, deleted_at: null }, select: { id: true } })).map((c) => c.id)
      : [];
    balance -= await legacyUnlinkedDepositMinor([folio.id, ...childIds]);
    return balance;
  }

  if (isGit && parentNum !== 0) {
    const own = await prisma.transactions.findMany({
      where: { folio_id: folio.id, model_type: 'App\\Models\\GuestProfile' },
      select: { type_amount: true, total: true },
    });
    return sumBalanceMinorUnits(own) - (await legacyUnlinkedDepositMinor([folio.id]));
  }

  const own = await prisma.transactions.findMany({ where: { folio_id: folio.id }, select: { type_amount: true, total: true } });
  return sumBalanceMinorUnits(own) - (await legacyUnlinkedDepositMinor([folio.id]));
}

/** Float balance for display. Derived from the integer sum, never accumulated separately. */
export async function folioBalanceWithoutPosting(folio: { id: bigint; type_reservation: string | null; parent: number | bigint | null }): Promise<number> {
  return (await folioBalanceMinorUnits(folio)) / MINOR_UNITS;
}

/**
 * Deposits recorded in `deposit_payments` that have NO matching transaction.
 *
 * New deposits write both a header row and a MINUS folio transaction, so they
 * are already covered by the transaction sum. Rows created before that (or by
 * any other writer) exist only in `deposit_payments` and were invisible to the
 * balance — the guest had paid a deposit and check-out still said "Payment
 * required". Counting only the orphans fixes that without double-counting.
 */
async function legacyUnlinkedDepositMinor(folioIds: bigint[]): Promise<number> {
  if (folioIds.length === 0) return 0;
  const rows = await prisma.deposit_payments.findMany({
    where: { folio_id: { in: folioIds }, deleted_at: null },
    select: { id: true, amount: true },
  });
  if (rows.length === 0) return 0;

  const linked = await prisma.transactions.findMany({
    where: {
      folio_id: { in: folioIds },
      deleted_at: null,
      reference: { startsWith: DEPOSIT_REFERENCE_PREFIX },
    },
    select: { reference: true },
  });
  const linkedIds = new Set<string>(
    linked
      .map((t) => String(t.reference ?? '').slice(DEPOSIT_REFERENCE_PREFIX.length))
      .filter((s) => s !== '')
  );

  return rows
    .filter((r) => !linkedIds.has(String(r.id)))
    .reduce((s, r) => s + toMinorUnits(r.amount), 0);
}

// Laravel Folio@getBalance parity (Folio.php:993-1013) — display balance.
// Same as folioBalanceWithoutPosting but GIT-parent children are NotCancel-filtered (status != 2).
export async function folioBalanceDisplay(folio: { id: bigint; type_reservation: string | null; parent: number | bigint | null }): Promise<number> {
  const isGit = String(folio.type_reservation ?? '').toLowerCase() === 'git';
  const parentNum = Number(folio.parent ?? 0);
  const sumNet = (rows: { type_amount: string | null; total: any }[]) =>
    rows.reduce((s, t) => s + (t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0)), 0);

  if (isGit && parentNum === 0) {
    const children = await prisma.folios.findMany({
      where: { parent: folio.id, deleted_at: null, status_reservation: { not: 2 } },
      select: { transactions: { where: { model_type: 'App\\Models\\CompanyProfile' }, select: { type_amount: true, total: true } } },
    });
    let balance = 0;
    for (const c of children) balance += sumNet(c.transactions);
    const own = await prisma.transactions.findMany({ where: { folio_id: folio.id }, select: { type_amount: true, total: true } });
    balance += sumNet(own);
    return balance;
  }

  return folioBalanceWithoutPosting(folio);
}

// Laravel Folio@transferTransaction parity (Folio.php:781-928) — runs during check-out.
// a) Sub-GIT: company-billed txns (+breakdowns) move to parent folio.
// b) auto_transfers where target_folio_id = this: pull source folio's company-billed txns into this folio
//    via void-reversal + new-row pattern (is_transfer 1/2), breakdowns copied.
// c) auto_transfers where folio_id = this: pull target folio's company-billed txns into this folio.
// Returns true when case (c) moved anything (Laravel is_auto_transfer flag → different error message).
export async function transferTransactionsForCheckout(
  folio: { id: bigint; type_reservation: string | null; parent: number | bigint | null; folio_number: string | null; company_profile_id: bigint | null },
  businessDate: string
): Promise<boolean> {
  const isGit = String(folio.type_reservation ?? '').toLowerCase() === 'git';
  const parentNum = Number(folio.parent ?? 0);
  const bDate = new Date(businessDate + 'T00:00:00.000Z');
  let isAutoTransfer = false;

  // Laravel replicates breakdowns with field-level control:
  //  • void copies   → keep original date + uuid (only txn/type/void_code/remark change)
  //  • transfer copies → date = businessDate + FRESH uuid (= Folio.php :835-837/:883-886)
  const copyBreakdowns = async (
    fromTxnId: bigint,
    toTxnId: bigint,
    targetFolioId: bigint | null,
    reversed: boolean,
    isTransfer: number,
    remarkSuffix: string,
    opts: { resetDateAndUuid?: boolean } = {}
  ) => {
    const rows = await prisma.transaction_breakdowns.findMany({ where: { transaction_id: fromTxnId } });
    for (const b of rows) {
      await prisma.transaction_breakdowns.create({
        data: {
          property_id: b.property_id,
          transaction_id: toTxnId,
          folio_id: targetFolioId ?? b.folio_id,
          type: b.type,
          date: opts.resetDateAndUuid ? bDate : b.date,
          code: b.code,
          type_payment_id: b.type_payment_id,
          rate_inclusive_id: b.rate_inclusive_id,
          code_item_id: b.code_item_id,
          description: b.description,
          amount: b.amount,
          total: b.total,
          type_amount: reversed ? (b.type_amount === 'MINUS' ? 'PLUS' : 'MINUS') : b.type_amount,
          pb1: b.pb1,
          svr_chrg: b.svr_chrg,
          surcharge: b.surcharge,
          tax3: b.tax3,
          time: b.time,
          bill_to: b.bill_to,
          model_type: b.model_type,
          model_id: b.model_id,
          remark: b.remark ? `${b.remark} - ${remarkSuffix}` : remarkSuffix,
          is_posting: b.is_posting,
          is_endshift: b.is_endshift,
          is_void: b.is_void,
          is_transfer: isTransfer,
          is_consolidate: b.is_consolidate,
          is_split: b.is_split,
          is_has_inclusive: b.is_has_inclusive,
          status: b.status,
          uuid: opts.resetDateAndUuid ? randomUUID() : b.uuid,
          created_at: new Date(),
        },
      });
    }
  };

  const replicateTxn = async (src: any, overrides: Record<string, any>) => {
    const d: any = {
      property_id: src.property_id,
      folio_id: src.folio_id,
      type: src.type,
      uuid: randomUUID(),
      date: bDate,
      code: src.code,
      code_name: src.code_name,
      type_payment_id: src.type_payment_id,
      code_item_id: src.code_item_id,
      description: src.description,
      amount: src.amount,
      total: src.total,
      type_amount: src.type_amount,
      pb1: src.pb1,
      svr_chrg: src.svr_chrg,
      surcharge: src.surcharge,
      tax3: src.tax3,
      time: src.time,
      bill_to: src.bill_to,
      model_type: src.model_type,
      model_id: src.model_id,
      remark: src.remark,
      reference: src.reference,
      pos: src.pos,
      receipt: src.receipt,
      card_name: src.card_name,
      last_digit_card: src.last_digit_card,
      voucher: src.voucher,
      booking: src.booking,
      is_posting: src.is_posting,
      is_endshift: src.is_endshift,
      is_void: src.is_void,
      is_transfer: src.is_transfer,
      is_consolidate: src.is_consolidate,
      is_split: src.is_split,
      is_has_inclusive: src.is_has_inclusive,
      is_end_of_day: 0,
      status: src.status,
      source: src.source,
      created_at: new Date(),
    };
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) d[k] = v;
    }
    return prisma.transactions.create({ data: d });
  };

  const FOR_TRANSFER = { is_consolidate: 0, is_void: 0, is_split: 0, NOT: { is_transfer: 1 } };

  // a) Sub-GIT → move company-billed txns to parent folio
  if (isGit && parentNum !== 0) {
    const parent = await prisma.folios.findUnique({ where: { id: BigInt(parentNum) }, select: { id: true } });
    if (parent) {
      const rows = await prisma.transactions.findMany({ where: { folio_id: folio.id, model_type: 'App\\Models\\CompanyProfile' }, select: { id: true } });
      for (const t of rows) {
        await prisma.transactions.update({ where: { id: t.id }, data: { folio_id: parent.id } });
        await prisma.transaction_breakdowns.updateMany({ where: { transaction_id: t.id }, data: { folio_id: parent.id } });
      }
    }
  }

  // b) Configs where this folio is the transfer TARGET: pull source folio's company-billed txns here
  const asTarget = await prisma.auto_transfers.findMany({ where: { target_folio_id: Number(folio.id) } });
  for (const cfg of asTarget) {
    const sourceFolio = await prisma.folios.findUnique({ where: { id: BigInt(cfg.folio_id) }, select: { id: true, folio_number: true, company_profile_id: true } });
    if (!sourceFolio) continue;
    const txns = await prisma.transactions.findMany({
      where: { folio_id: sourceFolio.id, model_type: 'App\\Models\\CompanyProfile', ...FOR_TRANSFER },
    });
    for (const t of txns) {
      // void row + reversed breakdown copies (= Laravel :798-816/:846-864)
      const voidRow = await replicateTxn(t, {
        folio_id: sourceFolio.id,
        void_code: String(t.id),
        type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
        is_transfer: 1,
        remark: `To - ${folio.folio_number ?? ''}`,
        uuid: randomUUID(),
      });
      await copyBreakdowns(t.id, voidRow.id, null, true, 1, `To - ${folio.folio_number ?? ''}`);

      if (t.type === 'room_revenue') {
        // Laravel room_revenue branch (:818-843): plain 'from -' remark (original NOT
        // preserved) on the new txn; breakdowns re-dated to business date + fresh uuid;
        // ORIGINAL txn left untouched (early return — no is_transfer=1 mark).
        const newRow = await replicateTxn(t, {
          folio_id: folio.id,
          void_code: String(t.id),
          is_transfer: 2,
          remark: `from - ${sourceFolio.folio_number ?? ''}`,
          uuid: randomUUID(),
        });
        await copyBreakdowns(t.id, newRow.id, folio.id, false, 2, `from - ${sourceFolio.folio_number ?? ''}`, { resetDateAndUuid: true });
        if (folio.company_profile_id) {
          await prisma.transactions.update({ where: { id: newRow.id }, data: { model_type: 'App\\Models\\CompanyProfile', model_id: folio.company_profile_id } });
        }
        continue;
      }

      // non-room_revenue (:866-893): original remark preserved; original marked transferred.
      const newRow = await replicateTxn(t, {
        folio_id: folio.id,
        void_code: String(t.id),
        is_transfer: 2,
        remark: t.remark ? `${t.remark} - from - ${sourceFolio.folio_number ?? ''}` : `from - ${sourceFolio.folio_number ?? ''}`,
        uuid: randomUUID(),
      });
      await copyBreakdowns(t.id, newRow.id, folio.id, false, 2, `from - ${sourceFolio.folio_number ?? ''}`, { resetDateAndUuid: true });

      // attach to target folio's company profile ledger
      if (folio.company_profile_id) {
        await prisma.transactions.update({ where: { id: newRow.id }, data: { model_type: 'App\\Models\\CompanyProfile', model_id: folio.company_profile_id } });
      }
      await prisma.transactions.update({ where: { id: t.id }, data: { is_transfer: 1, remark: `To - ${folio.folio_number ?? ''}` } });
    }
  }

  // c) Configs where this folio is the SOURCE: pull target folio's company-billed txns into this folio
  const asSource = await prisma.auto_transfers.findMany({ where: { folio_id: Number(folio.id) } });
  for (const cfg of asSource) {
    const targetFolio = await prisma.folios.findUnique({ where: { id: BigInt(cfg.target_folio_id) }, select: { id: true, folio_number: true, company_profile_id: true } });
    if (!targetFolio) continue;
    const txns = await prisma.transactions.findMany({
      where: { folio_id: targetFolio.id, model_type: 'App\\Models\\CompanyProfile', ...FOR_TRANSFER },
    });
    for (const t of txns) {
      // Laravel case (:900-927) moves BARE transactions only — no breakdown copies,
      // no fresh uuid (replicate keeps source uuid), void row keeps original date.
      const voidRow = await replicateTxn(t, {
        void_code: String(t.id),
        type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
        is_transfer: 1,
        remark: `To - ${folio.folio_number ?? ''}`,
      });

      const newRow = await replicateTxn(t, {
        folio_id: folio.id,
        is_transfer: 1,
      });

      if (folio.company_profile_id) {
        await prisma.transactions.update({ where: { id: newRow.id }, data: { model_type: 'App\\Models\\CompanyProfile', model_id: folio.company_profile_id } });
      }
      await prisma.transactions.update({ where: { id: t.id }, data: { is_transfer: 1, remark: `To - ${folio.folio_number ?? ''}` } });
      isAutoTransfer = true;
    }
  }

  return isAutoTransfer;
}


const STATUS_RESERVATION = {
  check_in: { id: 0, code: 'check_in', name: 'Check In' },
  check_out: { id: 1, code: 'check_out', name: 'Check Out' },
  cancel_reservation: { id: 2, code: 'cancel_reservation', name: 'Cancelled' },
  reservation: { id: 3, code: 'reservation', name: 'Reservation' },
  in_house: { id: 4, code: 'in_house', name: 'In House' },
  pending: { id: 5, code: 'pending', name: 'Pending' },
};

const TYPE_RESERVATION = {
  fit: { code: 'fit', name: 'FIT' },
  git: { code: 'git', name: 'GIT' },
  vr: { code: 'vr', name: 'VR' },
};

// Matches Laravel getColorReservation() + Folio formatData status_reservation_color
const COLOR_RESERVATION: Record<number, string> = {
  0: 'bg-green',
  1: 'bg-purple',
  2: 'bg-red',
  3: 'bg-cyan',
  4: 'bg-blue',
  5: 'bg-yellow',
};

function statusReservationLabel(status: number): string {
  const found = Object.values(STATUS_RESERVATION).find((s: any) => s.id === status);
  return (found ? found.name : String(status)).replace(/ /g, '-');
}

function statusReservationColor(folio: any): { label: string; color: string; is_color: boolean }[] {
  if (folio.status_reservation === STATUS_RESERVATION.reservation.id && folio.is_request_cancel) {
    return [{ label: 'Request-Cancel', color: 'bg-yellow', is_color: true }];
  }
  return [{
    label: statusReservationLabel(folio.status_reservation),
    color: COLOR_RESERVATION[folio.status_reservation] || 'bg-success',
    is_color: true,
  }];
}

const MENU_ID = 63;

// `is_search` mirrors Laravel Folio::formatTableFrontDesk() — table-edit only
// renders the search box when at least one column sets it (index.tsx checks
// `rw.is_search`), and `dataSearch()` resolves the selected field against it.
const TABLE_COLUMNS = [
  { key: 'res_date', label: 'Res Date', type: 'date', is_search: false },
  { key: 'type_reservation', label: 'Type', is_search: false },
  { key: 'message_bool', label: 'MSG', type: 'boolean', is_search: false },
  { key: 'ign', label: 'IGN', type: 'boolean', is_search: false },
  { key: 'is_do_not_disturb', label: 'DND', type: 'boolean', is_search: false },
  // Shortened to match MSG / IGN / DND. It already sits next to them; the full
  // word made this flag group noticeably wider than the rest of the header.
  { key: 'remark_bool', label: 'RMK', type: 'boolean', is_search: false },
  { key: 'status_reservation_color', label: 'Status', is_html: true, is_search: false },
  { key: 'folio_number', label: 'Folio', is_link: true, uri: '/reservation/fit/reservation', is_search: true, max_width: '130px' },
  // Free-text columns: a long guest/company name otherwise stretched the
  // `table-auto` + `whitespace-nowrap` grid and pushed every later column
  // off-screen. Capped here and truncated client-side via TableView.
  { key: 'guest_name', label: 'Guest Name', is_search: false, max_width: '180px' },
  { key: 'guest_status_color', label: 'Guest', is_html: true, is_search: false },
  { key: 'stay', label: 'Stay', is_search: false },
  { key: 'room', label: 'Room', is_search: false },
  { key: 'room_next', label: 'Room Next', is_search: false },
  { key: 'company', label: 'Company', is_search: false, max_width: '180px' },
  { key: 'room_type', label: 'Room Type', is_search: false, max_width: '150px' },
  { key: 'room_status_color', label: 'Room Status', is_html: true, is_search: false },
  { key: 'room_clean_status_color', label: 'Clean Status', is_html: true, is_search: false },
  { key: 'check_in_date', label: 'Check In', type: 'date', is_search: false },
  { key: 'check_out_date', label: 'Check Out', type: 'date', is_search: false },
  { key: 'balance', label: 'Balance', is_search: false },
  { key: 'sharer', label: 'Sharer', is_search: false },
  { key: 'aa', label: 'A', is_search: false },
  { key: 'cc', label: 'C', is_search: false },
];

// Columns the search box can actually target, i.e. real `folios` columns.
// Laravel's search_field macro guards with Schema::hasColumn(); the rest of
// TABLE_COLUMNS (room, guest_name, ...) are relation-derived and are skipped.
const FOLIO_SEARCH_COLUMNS = new Set([
  'folio_number', 'first_name', 'last_name', 'company_name', 'email', 'telp',
  'type_reservation', 'check_in_date', 'check_out_date', 'status_reservation',
]);

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
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Check-in / check-out as reusable operations.
//
// The HTTP handlers further down are thin wrappers around these. The group flow
// (ReservationController.updateBulk) drives the SAME functions per p-block, which
// is why it can honour the settlement gate, the room-availability check and the
// room-status writes instead of flipping a status column and hoping.
// ─────────────────────────────────────────────────────────────────────────────

export type OpResult =
  | { ok: true; rooms?: string[]; balance?: number; autoTransfer?: boolean }
  | { ok: false; code: number; message: string };

async function loadFolioForStay(id: bigint) {
  return prisma.folios.findUnique({
    where: { id },
    include: {
      reservations: {
        where: { deleted_at: null },
        select: {
          id: true, room_id: true, room_id_next: true, room_type_id: true, date: true,
          is_24_hour: true, package_id: true, quantity: true, quantity_extra_day_use: true,
          adult: true, child: true, add_bed: true, eta: true, etd: true,
        },
      },
    },
  });
}

export async function performCheckIn(
  id: bigint,
  opts: { propertyId: bigint; businessDate: string; remark?: string | null; userId?: bigint | null }
): Promise<OpResult> {
  const { propertyId: pid, businessDate, remark, userId } = opts;
  const folio = await loadFolioForStay(id);
  if (!folio || folio.deleted_at) return { ok: false, code: 404, message: 'Not Found' };

  // Laravel parity (Folio.php:1233): virtual reservation cannot be updated
  if (String(folio.type_reservation ?? '').toLowerCase() === 'vr') {
    return { ok: false, code: 400, message: 'Virtual reservation cannot be updated' };
  }
  // Laravel parity (Folio.php:1272): GIT master folio cannot check in directly
  const isGit = String(folio.type_reservation ?? '').toLowerCase() === 'git';
  if (isGit && Number(folio.parent ?? 0) === 0) {
    return { ok: false, code: 400, message: 'Action not allowed' };
  }
  // Already in house — nothing to do, and not an error for a bulk run.
  if (folio.status_reservation === STATUS_RESERVATION.check_in.id) {
    return { ok: true, rooms: [] };
  }

  // Laravel parity (Folio.php:1245-1269): mandatory guest profile fields.
  // Front desk creates guests with just title/first/last during a walk-in or
  // phone booking, so this is the gate that forces the rest of the profile to
  // be finished before the guest is actually checked in.
  if (folio.guest_profile_id) {
    const guest = await prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } });
    const mandatory = await readPropertyMandatory(prisma, pid);
    if (guest && mandatory.length > 0) {
      const missing = missingMandatoryFields(guest, mandatory);
      if (missing.length > 0) {
        return {
          ok: false,
          code: 400,
          message: 'Guest Profile is not complete. Missing: ' + missing.join(', '),
        };
      }
    }
  }

  // Laravel parity (Folio.php:1293-1299): check_in_date must equal business date
  const folioCheckIn = folio.check_in_date
    ? new Date(folio.check_in_date.getTime() - folio.check_in_date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    : null;
  if (!folio.is_virtual && folioCheckIn !== businessDate) {
    return { ok: false, code: 400, message: 'Check in date is not valid' };
  }

  // Resolve rooms BEFORE mutation (Laravel checks first, mutates last)
  const roomIds: bigint[] = [];
  for (const resv of folio.reservations) {
    const targetRoomId = resv.room_id_next ?? resv.room_id;
    if (targetRoomId != null) roomIds.push(targetRoomId);
  }

  if (!folio.is_virtual) {
    const missingRoom = folio.reservations.some((r) => (r.room_id_next ?? r.room_id) == null);
    if (missingRoom) return { ok: false, code: 400, message: 'Room not found' };
  }

  const checkInDateStr = folio.check_in_date ? folio.check_in_date.toISOString().slice(0, 10) : businessDate;
  const checkOutDateStr = folio.check_out_date
    ? folio.check_out_date.toISOString().slice(0, 10)
    : new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // Laravel parity (Folio.php:1301-1334): allotment quota check + decrement
  if (folio.use_allotment) {
    const allotErr = await checkAllotmentRoom(folio);
    if (allotErr) return { ok: false, code: 400, message: allotErr };
  }

  // The availability read and every occupancy write share one SERIALIZABLE
  // transaction. Previously the read happened outside any transaction, so two
  // clerks checking two folios into the same room could both pass the guard and
  // both commit.
  let occupied: string[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        if (!folio.is_virtual && roomIds.length > 0) {
          // Laravel parity (Folio.php:1285-1291): room maid_status must be Clean
          const rooms = await tx.rooms.findMany({ where: { id: { in: roomIds } }, select: { id: true, maid_status: true, name: true } });
          const notClean = rooms.filter(r => r.maid_status !== MAID_STATUSES.clean.id);
          if (notClean.length > 0) throw new HttpError(400, 'Room is not clean');

          for (const roomId of roomIds) {
            const available = await isRoomAvailableFor(pid, roomId, checkInDateStr, checkOutDateStr, id, tx as unknown as Db);
            if (!available) {
              const room = await tx.rooms.findUnique({ where: { id: roomId }, select: { name: true } });
              throw new HttpError(400, `Room ${room?.name ?? roomId} is not available for check-in`);
            }
          }
        }

        await tx.folios.update({
          where: { id },
          data: {
            status_reservation: STATUS_RESERVATION.check_in.id,
            // Laravel parity (Folio.php:1365-1367): remark_check_in in folio data JSON
            ...(remark ? { data: JSON.stringify({ ...(folio.data ? safeParseData(folio.data) : {}), remark_check_in: remark }) } : {}),
            updated_by: userId ?? null,
            updated_at: new Date(),
          },
        });

        // Laravel parity (Folio.php:1347-1354): set ATA now; 24h folios get ETD = now
        const ata = new Date();
        for (const resv of folio.reservations) {
          const data: any = { ata };
          if (resv.is_24_hour === 1) data.etd = ata;
          await tx.reservations.update({ where: { id: resv.id }, data });
        }
        await tx.reservations.updateMany({
          where: { folio_id: id, deleted_at: null },
          data: { status_reservation: STATUS_RESERVATION.check_in.id },
        });

        if (!folio.is_virtual && roomIds.length > 0) {
          const now = new Date();
          await tx.rooms.updateMany({
            where: { id: { in: roomIds } },
            data: {
              room_status: ROOM_STATUSES.occupied.id,
              maid_status: MAID_STATUSES.clean.id,
              last_check_in_date: now,
              last_check_in_time: now,
              updated_at: now,
            },
          });
          const names = await tx.rooms.findMany({ where: { id: { in: roomIds } }, select: { name: true } });
          occupied = names.map((n) => String(n.name ?? ''));
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 }
    );
  } catch (err: any) {
    if (err instanceof HttpError) return { ok: false, code: err.status, message: err.message };
    // P2034 = write conflict: another check-in got there first. Never retry
    // blindly into a double booking.
    if (err?.code === 'P2034' || err?.code === 'P2002') {
      return { ok: false, code: 409, message: 'Room is no longer available — another check-in took it. Please pick another room.' };
    }
    throw err;
  }

  // Laravel parity (Folio.php:1370-1406): day-use ETD calc + immediate posting
  if (folio.is_day_use && folio.reservations.length > 0) {
    const dayUseErr = await processExtraDayUse(folio, folio.reservations[0]);
    if (dayUseErr) return { ok: false, code: dayUseErr.code, message: dayUseErr.message };
    await postingRevenueDayUse(id, BigInt(folio.property_id), businessDate);
  }

  enqueueJob('sync-staah-room-availability', {
    propertyId: Number(folio.property_id),
    dateFrom: folio.check_in_date ? formatDate(new Date(folio.check_in_date)) : undefined,
    dateTo: folio.check_out_date ? formatDate(new Date(folio.check_out_date)) : undefined,
  });

  return { ok: true, rooms: occupied };
}

export async function performCheckOut(
  id: bigint,
  opts: { businessDate: string; userId?: bigint | null; skipAutoTransfer?: boolean }
): Promise<OpResult> {
  const { businessDate, userId, skipAutoTransfer } = opts;
  const folio = await prisma.folios.findUnique({
    where: { id },
    include: { reservations: { where: { deleted_at: null }, select: { room_id: true, room_id_next: true, date: true, is_posting: true } } },
  });
  if (!folio || folio.deleted_at) return { ok: false, code: 404, message: 'Not Found' };
  if (String(folio.type_reservation ?? '').toLowerCase() === 'vr') {
    return { ok: false, code: 400, message: 'Virtual reservation cannot be updated' };
  }
  // Already out — treat as a no-op success so a bulk run is idempotent.
  if (folio.status_reservation === STATUS_RESERVATION.check_out.id) {
    return { ok: true, balance: 0, autoTransfer: false };
  }
  // Laravel parity (Folio.php:1741): must be checked-in
  if (folio.status_reservation !== STATUS_RESERVATION.check_in.id) {
    return { ok: false, code: 400, message: 'Status reservation is not check in' };
  }

  // Laravel parity (Folio.php:1748): auto-transfer charges before the gate
  const autoTransfer = skipAutoTransfer ? false : await transferTransactionsForCheckout(folio as any, businessDate);

  // Laravel parity (Folio.php:1750): balance must be settled before checkout
  const balanceMinor = await folioBalanceMinorUnits(folio as any);
  if (!isFolioSettledMinor(balanceMinor)) {
    return {
      ok: false,
      code: 400,
      message: autoTransfer
        ? 'The auto transfer process is successful, please make payment on the remaining balance'
        : 'Payment required',
    };
  }
  const balance = balanceMinor / MINOR_UNITS;

  // Laravel parity (Folio.php:1760-1768): delete future unposted reservations
  const bDate = new Date(businessDate + 'T00:00:00.000Z');
  const roomIds: bigint[] = [];
  for (const resv of folio.reservations) {
    if (resv.room_id_next != null) roomIds.push(resv.room_id_next);
    else if (resv.room_id != null) roomIds.push(resv.room_id);
  }

  // Single transaction: night soft delete, folio flip, reservation status write
  // and room release either all land or none do.
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.reservations.updateMany({
          where: { folio_id: id, deleted_at: null, date: { gt: bDate }, is_posting: 0 },
          data: { deleted_at: new Date(), deleted_by: userId ?? null },
        });
        await tx.folios.update({
          where: { id },
          data: {
            status_reservation: STATUS_RESERVATION.check_out.id,
            check_out_date: bDate,
            updated_by: userId ?? null,
            updated_at: new Date(),
          },
        });
        await tx.reservations.updateMany({
          where: { folio_id: id, deleted_at: null },
          data: { status_reservation: STATUS_RESERVATION.check_out.id, atd: new Date() },
        });
        if (roomIds.length > 0) {
          const now = new Date();
          await tx.rooms.updateMany({
            where: { id: { in: roomIds } },
            data: {
              room_status: ROOM_STATUSES.vacant.id,
              maid_status: MAID_STATUSES.dirty.id,
              last_check_out_date: now,
              last_check_out_time: now,
              updated_at: now,
            },
          });
        }
      },
      { timeout: 20000 }
    );
  } catch (err: any) {
    console.error('performCheckOut transaction error:', err);
    return { ok: false, code: 500, message: 'Failed to check out' };
  }

  enqueueJob('sync-staah-room-availability', {
    propertyId: Number(folio.property_id),
    dateFrom: folio.check_in_date ? formatDate(new Date(folio.check_in_date)) : undefined,
    dateTo: folio.check_out_date ? formatDate(new Date(folio.check_out_date)) : undefined,
  });

  return { ok: true, balance, autoTransfer: !!autoTransfer };
}

/**
 * Reverse a completed stay: `un_check_in` puts an in-house folio back to
 * reservation, `un_check_out` puts a checked-out folio back to check-in.
 *
 * Both were reachable from the group Room tab, which routed them to
 * `updateBulk` — whose status switch did not list them, so every attempt came
 * back 400 and a group could not be reversed at all.
 */
export async function performReverseStay(
  id: bigint,
  opts: {
    businessDate: string;
    userId?: bigint | null;
    toVirtual?: any;
    remark?: string | null;
    reason?: string | null;
  }
): Promise<OpResult> {
  const { businessDate, userId, toVirtual, remark, reason } = opts;
  const folio: any = await prisma.folios.findUnique({
    where: { id },
    include: { reservations: { where: { deleted_at: null }, select: { id: true, room_id: true, room_id_next: true } } },
  });
  if (!folio || folio.deleted_at) return { ok: false, code: 404, message: 'Not Found' };
  if (String(folio.type_reservation ?? '').toLowerCase() === 'vr') {
    return { ok: false, code: 400, message: 'Virtual reservation cannot be updated' };
  }

  const now = new Date();
  const remarkKey = remark ? { remark: String(remark) } : {};

  if (folio.status_reservation === STATUS_RESERVATION.check_in.id) {
    // ── un_check_in: back to reservation, release the room ──
    await prisma.$transaction(async (tx) => {
      await tx.folios.update({
        where: { id },
        data: {
          status_reservation: STATUS_RESERVATION.reservation.id,
          data: JSON.stringify({ ...safeParseData(folio.data), remark_un_check_in: remark ?? null }),
          updated_by: userId ?? null,
          updated_at: now,
          ...remarkKey,
        },
      });
      await tx.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.reservation.id },
      });
      // The room goes back on sale. Leaving it occupied is what made an
      // un-checked-in room look unavailable to every other guest.
      const roomIds = [...new Set(folio.reservations.map((r: any) => r.room_id_next ?? r.room_id).filter((x: any) => x != null))] as bigint[];
      if (roomIds.length > 0) {
        await tx.rooms.updateMany({
          where: { id: { in: roomIds } },
          data: { room_status: ROOM_STATUSES.vacant.id, maid_status: MAID_STATUSES.dirty.id, updated_at: now },
        });
      }
    });
    enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
    return { ok: true };
  }

  if (folio.status_reservation === STATUS_RESERVATION.check_out.id) {
    // ── un_check_out: back to check-in, room becomes due_out ──
    // `to_virtual` stays virtual (Laravel parity) unless explicitly cleared.
    const keepVirtual = String(toVirtual ?? '') === '1' || String(toVirtual ?? '') === 'true';
    await prisma.$transaction(async (tx) => {
      await tx.folios.update({
        where: { id },
        data: {
          status_reservation: STATUS_RESERVATION.check_in.id,
          is_virtual: keepVirtual ? true : folio.is_virtual,
          data: JSON.stringify({ ...safeParseData(folio.data), remark_un_check_out: reason ?? remark ?? null }),
          updated_by: userId ?? null,
          updated_at: now,
          ...remarkKey,
        },
      });
      await tx.reservations.updateMany({
        where: { folio_id: id, deleted_at: null },
        data: { status_reservation: STATUS_RESERVATION.check_in.id },
      });
      const roomIds = [...new Set(folio.reservations.map((r: any) => r.room_id_next ?? r.room_id).filter((x: any) => x != null))] as bigint[];
      if (roomIds.length > 0) {
        await tx.rooms.updateMany({
          where: { id: { in: roomIds } },
          // due_out, not vacant: the guest has not physically left yet.
          data: { room_status: ROOM_STATUSES.due_out.id, updated_at: now },
        });
      }
    });
    enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
    return { ok: true };
  }

  return { ok: false, code: 400, message: 'Only a checked-in or checked-out folio can be reversed' };
}

/**
 * Shift a folio's whole stay.
 *
 * The group Room tab sends `change_date` here with absolute `check_in_date` /
 * `check_out_date`; a relative `days` shift is also accepted. Either way it was
 * unreachable: `change_date` was not in `updateBulk`'s status switch, so every
 * bulk date change on a group returned 400.
 */
export async function performChangeStayDate(
  id: bigint,
  opts: {
    userId?: bigint | null;
    days?: number;
    checkInDate?: string | null;
    checkOutDate?: string | null;
    reason?: string | null;
    remark?: string | null;
  }
): Promise<OpResult> {
  const { userId, days, checkInDate, checkOutDate, reason, remark } = opts;

  const folio: any = await prisma.folios.findUnique({
    where: { id },
    include: { reservations: { where: { deleted_at: null } } },
  });
  if (!folio || folio.deleted_at) return { ok: false, code: 404, message: 'Not Found' };

  const dayMs = 86400000;
  let ms: number;

  if (checkInDate) {
    if (!folio.check_in_date) return { ok: false, code: 400, message: 'Folio has no check-in date to move' };
    const currentDay = new Date(new Date(folio.check_in_date).toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
    const targetDay = new Date(String(checkInDate).slice(0, 10) + 'T00:00:00.000Z').getTime();
    if (Number.isNaN(targetDay)) return { ok: false, code: 400, message: 'Invalid check-in date' };
    ms = targetDay - currentDay;

    // An explicit departure date must keep the same length of stay, otherwise a
    // "date change" silently turns a 3-night booking into a 1-night one.
    if (checkOutDate) {
      const nights = Math.max(1, Math.round((new Date(new Date(folio.check_out_date).toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime() - currentDay) / dayMs));
      const wanted = new Date(new Date(String(checkOutDate).slice(0, 10) + 'T00:00:00.000Z').getTime() - targetDay).getTime();
      const wantedNights = Math.round(wanted / dayMs);
      if (wantedNights !== nights) {
        return {
          ok: false,
          code: 400,
          message: `Stay length must stay ${nights} night(s); the requested dates are ${wantedNights}`,
        };
      }
    }
  } else {
    const shift = Number(days ?? 0);
    if (!Number.isFinite(shift) || shift === 0) {
      return { ok: false, code: 400, message: 'A non-zero day shift or a target check-in date is required' };
    }
    ms = Math.trunc(shift) * dayMs;
  }

  if (ms === 0) return { ok: true };

  await prisma.$transaction(async (tx) => {
    await tx.folios.update({
      where: { id },
      data: {
        ...(folio.check_in_date ? { check_in_date: new Date(folio.check_in_date.getTime() + ms) } : {}),
        ...(folio.check_out_date ? { check_out_date: new Date(folio.check_out_date.getTime() + ms) } : {}),
        data: JSON.stringify({ ...safeParseData(folio.data), remark_change_date: reason ?? remark ?? null }),
        updated_by: userId ?? null,
        updated_at: new Date(),
      },
    });
    for (const r of folio.reservations) {
      await tx.reservations.update({
        where: { id: r.id },
        data: {
          date: new Date(new Date(r.date).getTime() + ms),
          check_in_date: r.check_in_date ? new Date(new Date(r.check_in_date).getTime() + ms) : null,
          check_out_date: r.check_out_date ? new Date(new Date(r.check_out_date).getTime() + ms) : null,
          updated_at: new Date(),
        },
      });
    }
  });
  enqueueJob('sync-staah-room-availability', { propertyId: Number(folio.property_id) });
  return { ok: true };
}

export class FrontDeskController {
  // GET /api/front-desk
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search_field = req.query.search_field as string;
      const search_value = req.query.search_value as string;
      const type = (req.query.type as string) || 'check_in';
      const group = req.query.group as string;
      const displayStatus = req.query.display_status as string;
      const stayDates = req.query.stay_dates as string;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const propertyId = req.user?.lastProperty;

      const where: any = {
        deleted_at: null,
        is_pos_trx: false,
      };

      if (propertyId) where.property_id = propertyId;

      // display_status filter (parity Laravel FrontDeskController@index L37-73):
      // comma-separated status_reservation codes; absent => exclude cancelled only
      const hasDisplayStatus = !!(displayStatus && displayStatus.trim() !== '');
      if (hasDisplayStatus) {
        const codes = displayStatus.split(',').map((c: string) => c.trim()).filter(Boolean);
        const ids = codes
          .map((code: string) => {
            const found = Object.values(STATUS_RESERVATION).find((s: any) => s.code === code);
            return found ? found.id : null;
          })
          .filter((v: any) => v !== null);
        if (ids.length > 0) {
          where.status_reservation = { in: ids };
        }
      }

      // stay date range (parity L55-60): only when start_date && end_date && stay_dates
      if (stayDates && startDate && endDate) {
        const sd = new Date(startDate);
        const ed = new Date(endDate);
        ed.setHours(23, 59, 59, 999);
        if (stayDates === 'check_in') {
          where.check_in_date = { gte: sd, lte: ed };
        } else if (stayDates === 'check_out') {
          where.check_out_date = { gte: sd, lte: ed };
        } else if (stayDates === 'between') {
          where.OR = [
            { check_in_date: { gte: sd, lte: ed } },
            { check_out_date: { gte: sd, lte: ed } },
            { check_in_date: { lte: sd }, check_out_date: { gte: ed } },
          ];
        } else {
          where.check_out_date = { gte: sd, lte: ed };
        }
      }

      // Type-based filtering (skip default check_in status+date filter when user
      // explicitly picked display_status so the filter actually filters)
      if (type === 'check_in') {
        where.status_reservation = where.status_reservation ?? {
          in: [STATUS_RESERVATION.check_in.id, STATUS_RESERVATION.reservation.id],
        };
        if (!hasDisplayStatus) {
          where.check_in_date = { gte: new Date() };
        }
      } else if (type === 'check_out' && group === 'check-out') {
        where.status_reservation = where.status_reservation ?? {
          in: [STATUS_RESERVATION.check_out.id, STATUS_RESERVATION.check_in.id],
        };
        where.check_out_date = { gte: new Date() };
      } else if (type === 'folio') {
        where.type_reservation = { in: [TYPE_RESERVATION.fit.code, TYPE_RESERVATION.git.code, TYPE_RESERVATION.vr.code] };
      } else if (type === 'vr') {
        where.type_reservation = TYPE_RESERVATION.vr.code;
      }

      if (group === 'batch-check-out') {
        where.status_reservation = STATUS_RESERVATION.check_in.id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        where.check_out_date = { gte: today };
      }

      where.status_reservation = where.status_reservation ?? { notIn: [STATUS_RESERVATION.cancel_reservation.id] };

      // Search — parity with Laravel Builder::macro('search_field') +
      // Folio::scopeSearchFolios. Both split on ';', AND their clauses, and
      // skip '-1' / 'undefined' / '' values. Anything is pushed onto where.AND
      // so it never clobbers the display_status / stay-dates filters above.
      const searchClauses: any[] = [];

      const searchFields = String(search_field || '').split(';').filter((f) => f.trim() !== '');
      const searchValues = String(search_value || '').split(';');
      searchFields.forEach((field, i) => {
        const raw = searchValues[i];
        if (raw === undefined || raw === '-1' || raw === 'undefined' || raw === '') return;
        if (field === 'room') {
          // Folio::scopeSearchFolios: room matches via reservation -> room name
          searchClauses.push({
            reservations: { some: { deleted_at: null, rooms: { name: { contains: raw, mode: 'insensitive' } } } },
          });
          return;
        }
        if (!FOLIO_SEARCH_COLUMNS.has(field)) return;
        if (field === 'check_in_date' || field === 'check_out_date') {
          const cmp = field === 'check_in_date' ? { gte: raw } : { lte: raw };
          searchClauses.push({ [field]: cmp });
          return;
        }
        searchClauses.push({ [field]: { contains: raw, mode: 'insensitive' } });
      });

      const keyword = String(req.query.search || '').trim();
      if (keyword) {
        const like = { contains: keyword, mode: 'insensitive' as const };
        searchClauses.push({
          OR: [
            { first_name: like },
            { last_name: like },
            { folio_number: like },
            { company_name: like },
            { email: like },
            { telp: like },
            // Long field name: Prisma had to disambiguate the two relations
            // that both point at company_profiles.
            { company_profiles_folios_company_profile_idTocompany_profiles: { is: { name: like } } },
          ],
        });
      }

      if (searchClauses.length > 0) {
        where.AND = [...(where.AND ?? []), ...searchClauses];
      }

const [folios, total] = await Promise.all([
        prisma.folios.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            properties: { select: { name: true } },
            reservations: {
              where: { deleted_at: null },
              orderBy: { date: 'asc' },
              select: {
                date: true,
                is_posting: true,
                room_name: true,
                room_type_name: true,
                room_id_next: true,
                adult: true,
                child: true,
                room_types: { select: { name: true } },
                rooms: { select: { name: true, room_status: true, maid_status: true } },
              },
            },
          },
        }),
        prisma.folios.count({ where }),
      ]);

      const folioIds = folios.map((f: any) => f.id);
      const businessDate = await AuthController.getBusinessDate(req.user?.lastProperty ?? 0n);
      const [batchTransactions, batchGuests, gitChildren] = await Promise.all([
        prisma.transactions.findMany({ where: { folio_id: { in: folioIds }, deleted_at: null }, select: { folio_id: true, type_amount: true, total: true, model_type: true } }),
        prisma.guest_profiles.findMany({
          where: { id: { in: folios.filter((f: any) => !((f.first_name || '').trim()) && f.guest_profile_id).map((f: any) => f.guest_profile_id) } },
          select: { id: true, first_name: true, last_name: true },
        }),
        prisma.folios.findMany({
          where: { parent: { in: folioIds }, deleted_at: null, status_reservation: { not: 2 } },
          select: { id: true, parent: true, status_reservation: true, transactions: { where: { model_type: 'App\\Models\\CompanyProfile' }, select: { type_amount: true, total: true } } },
        }),
      ]);
      const txnByFolio = new Map<string, { type_amount: string | null; total: any; model_type: string | null }[]>();
      for (const t of batchTransactions) {
        const key = String(t.folio_id);
        if (!txnByFolio.has(key)) txnByFolio.set(key, []);
        txnByFolio.get(key)!.push(t);
      }
      const guestByProfileId = new Map(batchGuests.map((g: any) => [String(g.id), g]));

      // GuestProfile::calculateTotalStay() — completed folios per guest.
      // Port of the Laravel query:
      //   status_reservation = check_out
      //   AND (folio_number LIKE 'F%' OR (type_reservation = 'git' AND parent != 0))
      //   AND status_reservation != cancelled
      // One grouped query for the whole page instead of a count per row.
      const pageGuestIds = [...new Set(folios.map((f: any) => f.guest_profile_id).filter(Boolean).map((v: any) => BigInt(v)))];
      const stayRows = pageGuestIds.length
        ? await prisma.folios.groupBy({
            by: ['guest_profile_id'],
            where: {
              guest_profile_id: { in: pageGuestIds },
              deleted_at: null,
              status_reservation: STATUS_RESERVATION.check_out.id,
              OR: [
                { folio_number: { startsWith: 'F' } },
                { type_reservation: 'git', parent: { not: 0 } },
              ],
            },
            _count: { _all: true },
          }).catch(() => [])
        : [];
      const stayMap = new Map<string, number>(
        (stayRows as any[]).map((r) => [String(r.guest_profile_id), Number(r._count?._all ?? 0)])
      );
      const childTxnByParent = new Map<string, { type_amount: string | null; total: any }[]>();
      const childStatusByParent = new Map<string, number[]>();
      for (const c of gitChildren) {
        const key = String(c.parent);
        if (!childTxnByParent.has(key)) childTxnByParent.set(key, []);
        for (const t of c.transactions) childTxnByParent.get(key)!.push(t);
        if (!childStatusByParent.has(key)) childStatusByParent.set(key, []);
        childStatusByParent.get(key)!.push(Number(c.status_reservation));
      }
      const sumNet = (rows: { type_amount: string | null; total: any }[]) =>
        rows.reduce((s, t) => s + (t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0)), 0);
      const balanceFor = (f: any): number => {
        const isGit = String(f.type_reservation ?? '').toLowerCase() === 'git';
        const parentNum = Number(f.parent ?? 0);
        if (isGit && parentNum === 0) {
          return sumNet(childTxnByParent.get(String(f.id)) || []) + sumNet(txnByFolio.get(String(f.id)) || []);
        }
        if (isGit && parentNum !== 0) {
          return sumNet((txnByFolio.get(String(f.id)) || []).filter(t => t.model_type === 'App\\Models\\GuestProfile'));
        }
        return sumNet(txnByFolio.get(String(f.id)) || []);
      };

      const formatted = folios.map((f: any) => {
        let guestName = `${f.first_name || ''} ${f.last_name || ''}`.trim();
        if (!guestName && f.guest_profile_id) {
          const gp = guestByProfileId.get(String(f.guest_profile_id));
          if (gp) guestName = `${gp.first_name || ''} ${gp.last_name || ''}`.trim();
        }

// Folio::lastReservation() parity: prefers the first reservation with
// is_posting = 0 ordered by date asc (Reservation::scopeLastReservation),
// and falls back to the most recent reservation when none qualifies.
        const reservations = f.reservations ?? [];
        const notPosted = reservations.filter((r: any) => Number(r.is_posting ?? 0) === 0);
        const lastReservation = notPosted.length > 0
          ? notPosted[0]
          : [...reservations].sort(
              (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            )[0];
        const roomName = lastReservation?.rooms?.name || lastReservation?.room_name || '';
        const roomTypeName = lastReservation?.room_types?.name || lastReservation?.room_type_name || '';

        // Folio::formatList() parity — Room/Clean Status come from the room the
        // last reservation points at, wrapped in a single-entry array so the
        // table renders a colour chip. Empty array when no room is attached.
        const attachedRoom = lastReservation?.rooms ?? null;
        const roomStatusId = attachedRoom ? Number(attachedRoom.room_status) : null;
        const maidStatusId = attachedRoom ? Number(attachedRoom.maid_status) : null;
        const roomStatusName = roomStatusId != null
          ? (Object.values(ROOM_STATUSES).find((s: any) => s.id === roomStatusId) as any)?.name
          : null;
        const maidStatusName = maidStatusId != null
          ? (Object.values(MAID_STATUSES).find((s: any) => s.id === maidStatusId) as any)?.name
          : null;

        // Laravel Folio@getBalance parity: MINUS subtracts, GIT parent/sub variants (batched)
        const balance = balanceFor(f);

        return {
          id: Number(f.id),
          value: Number(f.id),
          name: f.folio_number,
          res_date: f.res_date,
          type_reservation: f.type_reservation?.toUpperCase(),
          message_bool: false,
          ign: false,
          remark_bool: !!(f.remark || f.posting_instruction || f.check_out_instruction || f.check_in_instruction),
          is_do_not_disturb: !!f.is_do_not_disturb,
          status_reservation_color: statusReservationColor(f),
          room_clean_status_color: attachedRoom && maidStatusName && maidStatusId != null
            ? [{ label: maidStatusName.replace(/ /g, '-'), color: getColorMaid(maidStatusId), is_color: true }]
            : [],
          room_status_color: attachedRoom && roomStatusName && roomStatusId != null
            ? [{ label: roomStatusName.replace(/ /g, '-'), color: getColorRoom(roomStatusId), is_color: true }]
            : [],
          folio_number: f.folio_number,
          guest_name: guestName || '-',
          guest_status: { label: 'Regular', color: 'bg-green' },
          guest_status_color: [{ label: 'Regular', color: 'bg-green', is_color: true }],
          date_arrival: f.check_in_date,
          // GuestProfile::calculateTotalStay() — how many folios this guest has
          // already completed. It was hardcoded to 0, so the Stay column read 0
          // for every row.
          // Laravel: status = check_out, and (folio_number like 'F%' OR
          // (type_reservation = git AND parent != 0)), excluding cancelled.
          stay: stayMap.get(String(f.guest_profile_id)) ?? 0,
          room: roomName,
           room_next: lastReservation?.room_id_next ? (lastReservation.rooms?.name || '') : '',
          company: f.company_name || '',
          room_type: roomTypeName,
          check_in_date: f.check_in_date,
          check_out_date: f.check_out_date,
          balance: balance.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
          sharer: '',
          is_popup_other_guest: false,
          aa: lastReservation?.adult || 0,
          cc: lastReservation?.child || 0,
          // Was hardcoded to `[]`, which made the row action popup render as an
          // empty box. Now mirrors Folio::formatAction().
          actions: formatFolioActions({
            status_reservation: f.status_reservation,
            type_reservation: f.type_reservation,
            is_pending: Number(f.is_pending ?? 0) === 1 || Number(f.status_reservation ?? -1) === 5,
            hasRoomChange: !!lastReservation?.room_id_next && lastReservation.room_id_next !== null,
            childReservationCount: (childStatusByParent.get(String(f.id)) ?? []).filter((s) => s === 3).length,
            check_in_date: f.check_in_date ? new Date(f.check_in_date).toISOString() : null,
            businessDate,
            group,
            isParentGit: String(f.type_reservation ?? '').toLowerCase() === 'git' && Number(f.parent ?? 0) === 0,
            isGit: String(f.type_reservation ?? '').toLowerCase() === 'git',
            isFit: String(f.type_reservation ?? '').toLowerCase() === 'fit',
            nightAudit: String(req.query.night_audit ?? '') === '1',
            auditType: (req.query.audit_type as string) ?? null,
          }),
        };
      });

      // Table columns (filtered for batch-check-out)
      let table = [...TABLE_COLUMNS];
      if (group === 'batch-check-out') {
        const excludeKeys = ['message_bool', 'ign', 'remark_bool', 'is_do_not_disturb', 'stay', 'room_status_color', 'room_clean_status_color', 'sharer', 'aa', 'cc'];
        table = table.filter(c => !excludeKeys.includes(c.key));
      } else {
        table = table.filter(c => c.key !== 'res_date');
      }

      const permFlags = getPermissionFlags(req.user, MENU_ID);
      const permission = {
        view: true,
        add: req.user?.superUser || permFlags.add,
        edit: req.user?.superUser || permFlags.edit,
      };

      success(res, formatted, 'Success', 200, {
        permission,
        pagination: {
          current_page: page,
          last_page: Math.ceil(total / limit),
          per_page: limit,
          total,
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, total),
        },
        table,
        search_data: dataSearch(req, table) as any,
      });
    } catch (err: any) {
      console.error('FrontDesk list error:', err);
      error(res, 'Failed to fetch front-desk data', 500);
    }
  }

// POST /api/front-desk/{id}/check-in
  static async checkIn(req: Request, res: Response): Promise<void> {
    try {
      const id = resolveFolioId(req);
      if (id === null) {
        badRequest(res, 'Folio id is required');
        return;
      }

      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid);
      const result = await performCheckIn(id, {
        propertyId: pid,
        businessDate,
        remark: req.body?.remark ?? null,
        userId: req.user?.id ?? null,
      });
      if (!result.ok) {
        if (result.code === 404) notFound(res, result.message);
        else if (result.code === 409) error(res, result.message, 409);
        else badRequest(res, result.message);
        return;
      }

      const folio = await prisma.folios.findUnique({ where: { id }, select: { folio_number: true } });

      // Laravel parity (Folio.php:1408-1419): email builder "Check In" to guest.
      // Skipped silently when the template is absent; never blocks the response.
      if (folio) {
        const full = await prisma.folios.findUnique({ where: { id }, select: { guest_profile_id: true } });
        if (full?.guest_profile_id) {
          const guest = await prisma.guest_profiles.findUnique({
            where: { id: full.guest_profile_id },
            select: { email: true },
          }).catch(() => null);
          sendTemplateEmail(prisma, 'Check In', guest?.email).catch(() => {});
        }
      }

      // Audit AFTER the commit: the row must describe a change that actually
      // happened. Check-in previously left no trace at all — no log row, no
      // updated_by, only a mutated `folios` row with a wall-clock updated_at.
      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'folios',
        event: 'updated',
        subjectId: id,
        name: 'folio-checked-in',
        description: `Folio ${folio?.folio_number ?? id} checked in`,
        logName: 'front_desk',
        attributes: { status_reservation: STATUS_RESERVATION.check_in.id },
        meta: {
          folio_number: folio?.folio_number ?? null,
          rooms: result.rooms ?? [],
          remark: req.body?.remark ?? null,
          // The actual list the gate ran against — the old literal
          // 'enforced' said nothing about which fields were required.
          mandatory_check_in: await readPropertyMandatory(prisma, pid),
        },
      });

      success(res, {
        folio_id: Number(id),
        status_reservation: STATUS_RESERVATION.check_in.id,
        rooms: result.rooms ?? [],
      }, 'Check-in success');
    } catch (err: any) {
      console.error('FrontDesk checkIn error:', err);
      error(res, 'Failed to check in', 500);
    }
  }

// POST /api/front-desk/{id}/check-out
  static async checkOut(req: Request, res: Response): Promise<void> {
    try {
      const id = resolveFolioId(req);
      if (id === null) {
        badRequest(res, 'Folio id is required');
        return;
      }

      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid);
      const result = await performCheckOut(id, { businessDate, userId: req.user?.id ?? null });
      if (!result.ok) {
        if (result.code === 404) notFound(res, result.message);
        else if (result.code === 500) error(res, result.message, 500);
        else badRequest(res, result.message);
        return;
      }

      const folio = await prisma.folios.findUnique({
        where: { id },
        select: { folio_number: true, guest_profile_id: true, check_in_date: true, check_out_date: true },
      });

      // Laravel parity (Folio.php:1811-1820): email builder "Check Out" to guest
      // with hardcoded fallbacks; never blocks the response.
      if (folio?.guest_profile_id) {
        const guest = await prisma.guest_profiles.findUnique({
          where: { id: folio.guest_profile_id },
          select: { email: true },
        }).catch(() => null);
        sendTemplateEmail(prisma, 'Check Out', guest?.email, 'Check Out', 'Your reservation has been checked out').catch(() => {});
      }

      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'folios',
        event: 'updated',
        subjectId: id,
        name: 'folio-checked-out',
        description: `Folio ${folio?.folio_number ?? id} checked out`,
        logName: 'front_desk',
        attributes: { status_reservation: STATUS_RESERVATION.check_out.id },
        meta: {
          folio_number: folio?.folio_number ?? null,
          balance: result.balance,
          auto_transfer: !!result.autoTransfer,
          remark: req.body?.remark ?? null,
        },
      });

      success(res, { folio_id: Number(id), status_reservation: STATUS_RESERVATION.check_out.id, balance: result.balance }, 'Check-out success');
    } catch (err: any) {
      console.error('FrontDesk checkOut error:', err);
      error(res, 'Failed to check out', 500);
    }
  }

// POST /api/front-desk/batch-check-out
  static async batchCheckOut(req: Request, res: Response): Promise<void> {
    try {
      const { idx } = req.body;

      if (!idx || !Array.isArray(idx) || idx.length === 0) {
        badRequest(res, 'idx array is required');
        return;
      }

      const ids = idx.map((id: any) => BigInt(id));

      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid);
      const bDate = new Date(businessDate + 'T00:00:00.000Z');

      const folios = await prisma.folios.findMany({
        where: { id: { in: ids } },
        include: { reservations: { where: { deleted_at: null }, select: { room_id: true, room_id_next: true, date: true, is_posting: true } } }
      });

      // Laravel parity: per-folio guards + auto-transfer + balance check
      const failed: { folio_id: number; message: string }[] = [];
      const passed: bigint[] = [];
      for (const folio of folios) {
        if (String(folio.type_reservation ?? '').toLowerCase() === 'vr') {
          failed.push({ folio_id: Number(folio.id), message: 'Virtual reservation cannot be updated' });
          continue;
        }
        if (folio.status_reservation !== STATUS_RESERVATION.check_in.id) {
          failed.push({ folio_id: Number(folio.id), message: 'Status reservation is not check in' });
          continue;
        }
        try {
          await transferTransactionsForCheckout(folio as any, businessDate);
        } catch (e: any) {
          failed.push({ folio_id: Number(folio.id), message: e?.message ?? 'Auto transfer failed' });
          continue;
        }
        const balanceMinor = await folioBalanceMinorUnits(folio as any);
        if (!isFolioSettledMinor(balanceMinor)) {
          failed.push({ folio_id: Number(folio.id), message: 'Payment required' });
          continue;
        }
        passed.push(folio.id);
      }

      if (passed.length > 0) {
        await prisma.reservations.updateMany({
          where: { folio_id: { in: passed }, deleted_at: null, date: { gt: bDate }, is_posting: 0 },
          data: { deleted_at: new Date(), deleted_by: req.user?.id },
        });

        await prisma.folios.updateMany({
          where: { id: { in: passed } },
          data: {
            status_reservation: STATUS_RESERVATION.check_out.id,
            check_out_date: bDate,
            updated_at: new Date(),
          },
        });

        await prisma.reservations.updateMany({
          where: { folio_id: { in: passed }, deleted_at: null },
          data: { status_reservation: STATUS_RESERVATION.check_out.id, atd: new Date() },
        });

        // GIT master auto-checkout (Laravel FrontDeskController :187-195):
        // when ALL non-cancel children of a GIT parent are checked out,
        // auto-checkout the parent too.
        const gitParents = new Set<bigint>();
        for (const folioId of passed) {
          const f = folios.find((x) => x.id === folioId);
          if (!f || !f.parent) continue;
          const parentFolio = await prisma.folios.findUnique({ where: { id: f.parent }, select: { type_reservation: true, status_reservation: true } });
          if (parentFolio && String(parentFolio.type_reservation ?? '').toLowerCase() === 'git' && parentFolio.status_reservation === STATUS_RESERVATION.check_in.id) {
            gitParents.add(f.parent);
          }
        }
        for (const parentId of gitParents) {
          const openChildren = await prisma.folios.count({
            where: {
              parent: parentId,
              status_reservation: STATUS_RESERVATION.check_in.id,
              deleted_at: null,
            },
          });
          if (openChildren === 0) {
            await prisma.folios.update({
              where: { id: parentId },
              data: { status_reservation: STATUS_RESERVATION.check_out.id, check_out_date: bDate, updated_at: new Date() },
            });
            await prisma.reservations.updateMany({
              where: { folio_id: parentId, deleted_at: null },
              data: { status_reservation: STATUS_RESERVATION.check_out.id, atd: new Date() },
            });
          }
        }

        // Update room status for all rooms: vacant (0), maid_status: dirty (1)
        const roomIds: bigint[] = [];
        for (const folio of folios) {
          if (!passed.includes(folio.id)) continue;
          for (const resv of folio.reservations) {
            if (resv.room_id_next != null) roomIds.push(resv.room_id_next);
            else if (resv.room_id != null) roomIds.push(resv.room_id);
          }
        }
        if (roomIds.length > 0) {
          const now = new Date();
          await prisma.rooms.updateMany({
            where: { id: { in: roomIds } },
            data: {
              room_status: ROOM_STATUSES.vacant.id,
              maid_status: MAID_STATUSES.dirty.id,
              last_check_out_date: now,
              last_check_out_time: now,
              updated_at: now,
            },
          });
        }
      }

      enqueueJob('sync-staah-room-availability', { propertyId: Number(req.user?.lastProperty ?? 0) });
      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'folios',
        event: 'updated',
        subjectId: null,
        name: 'folio-batch-checked-out',
        description: `Batch check-out: ${passed.length} folio(s) closed, ${failed.length} rejected`,
        logName: 'front_desk',
        meta: { business_date: businessDate, checked_out: passed.map(String), failed },
      });

      success(res, { updated: passed.length, failed }, 'Batch check-out success');
    } catch (err: any) {
      console.error('FrontDesk batchCheckOut error:', err);
      error(res, 'Failed to batch check out', 500);
    }
  }

  // ==================== TRANSACTION ====================
  // Parity Laravel TransactionController@getData â€” GET /transaction?folio_id=&filter=
  static async transactionList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = 99999;
      const folioId = req.query.folio_id as string;
      const filter = req.query.filter as string;
      const ledger = req.query.ledger_id as string;
      const pid = req.user?.lastProperty ?? 0n;

      const table = [
        { label: 'Date', key: 'date', type: 'date', is_search: false },
        { label: 'Code', key: 'code', type: 'text', is_search: false },
        { label: 'Card Name', key: 'card_name', type: 'text', is_search: false },
        { label: 'Card Number', key: 'last_digit_card', type: 'text', is_search: false },
        { label: 'Voucher', key: 'voucher', type: 'text', is_search: false },
        { label: 'Description', key: 'description', type: 'text', is_search: false },
        { label: 'Total', key: 'total', type: 'number', is_search: false },
        { label: 'Rate', key: 'rate', type: 'number', is_search: false },
        { label: 'PB1', key: 'pb1', type: 'number', is_search: false },
        { label: 'Svr Chrg', key: 'svr_chrg', type: 'number', is_search: false },
        { label: 'Surcharge', key: 'surcharge', type: 'number', is_search: false },
        { label: 'Overwrite Reason', key: 'remark', type: 'text', is_search: false },
        { label: 'Staff', key: 'staff', type: 'text', is_search: false },
        { label: 'Overwrite Time', key: 'time', type: 'date', is_search: false },
        { label: 'Bill To', key: 'bill_to', type: 'text', is_search: false },
        { label: 'Reference', key: 'reference', type: 'text', is_search: false },
        { label: 'Receipt', key: 'receipt', type: 'text', is_search: false },
        { label: 'Balance', key: 'balance', type: 'text', is_search: false },
        { label: 'Status', key: 'status', type: 'text', is_search: false },
      ];
      const pagination = { current_page: page, last_page: 1, per_page: limit, total: 0, from: 0, to: 0 };
      const permission = {
        view: true,
        add: req.user?.superUser || true,
        edit: req.user?.superUser || true,
      };

      if (!folioId || !/^\d+$/.test(folioId)) {
        success(res, [], 'Folio Not Found', 200, {
          table, pagination, permission,
          search_data: [],
          total_transaction: moneyFormat(0),
          folio: null,
          ledger_id: ledger ?? null,
        });
        return;
      }

      const id = BigInt(folioId);
      const [folio, txns] = await Promise.all([
        prisma.folios.findUnique({ where: { id }, include: { reservations: { where: { deleted_at: null }, orderBy: { date: 'asc' } } } }),
        prisma.transactions.findMany({ where: { folio_id: id, deleted_at: null }, orderBy: { created_at: 'desc' }, include: { type_payments: { select: { name: true } } } }),
      ]);

      if (!folio) {
        success(res, [], 'Folio Not Found', 200, {
          table, pagination, permission,
          search_data: [],
          total_transaction: moneyFormat(0),
          folio: null,
          ledger_id: ledger ?? null,
        });
        return;
      }

      let filtered = txns;
      if (filter === 'void') filtered = filtered.filter((t: any) => t.is_void);
      // `filter=refund` feeds the refund PICKER, so it must list what can still
      // be refunded — live, un-voided payments. Listing existing refund rows
      // (the old behaviour) left the operator with nothing to pick, which is
      // why the UI had no row selection and posted a free-typed amount instead.
      if (filter === 'refund') {
        filtered = filtered.filter(
          (t: any) => t.type === 'payment' && !t.is_void && t.type_amount === 'MINUS'
        );
      }
      if (filter === 'split') filtered = filtered.filter((t: any) => t.is_split);
      if (filter === 'consolidate') filtered = filtered.filter((t: any) => t.is_consolidate);
      if (filter === 'transfer') filtered = filtered.filter((t: any) => t.is_transfer);

      const userIds = new Set<bigint>();
      filtered.forEach((t: any) => { if (t.created_by) userIds.add(BigInt(t.created_by)); if (t.updated_by) userIds.add(BigInt(t.updated_by)); });
      const users = userIds.size ? await prisma.users.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [];
      const userMap = new Map(users.map((u: any) => [String(u.id), u.name]));

      const modelIds = filtered.filter((t: any) => t.model_id).map((t: any) => t.model_id);
      const [companies, guests] = await Promise.all([
        prisma.company_profiles.findMany({ where: { id: { in: modelIds }, property_id: pid }, select: { id: true, name: true } }).catch(() => []),
        prisma.guest_profiles.findMany({ where: { id: { in: modelIds } }, select: { id: true, first_name: true, last_name: true } }).catch(() => []),
      ]);
      const modelMap = new Map<string, string>();
      companies.forEach((c: any) => modelMap.set(String(c.id), c.name));
      guests.forEach((g: any) => modelMap.set(String(g.id), `${g.first_name || ''} ${g.last_name || ''}`.trim()));

      const formatRow = (t: any): any => {
        const isMinus = t.type_amount === 'MINUS';
        const minus = (v: any) => (isMinus ? -Number(v || 0) : Number(v || 0));
        const systemTypes = ['room_revenue', 'extra_bed', 'room_inclusive', 'extra_bed_inclusive'];
        let staff = 'POS';
        if (t.is_void || t.is_transfer || t.is_split || t.is_consolidate) {
          staff = (t.updated_by && userMap.get(String(t.updated_by))) || (t.created_by && userMap.get(String(t.created_by))) || 'SYSTEM';
        } else if (systemTypes.includes(t.type)) {
          staff = 'SYSTEM';
        } else {
          staff = (t.created_by && userMap.get(String(t.created_by))) || 'POS';
        }
        const code = t.code_name ?? t.type_payment_name ?? null;
        return {
          id: Number(t.id),
          date: t.date ? new Date(t.date).toLocaleDateString('en-GB').replace(/\//g, '/') : '',
          folio_id: Number(t.folio_id),
          folio_number: folio.folio_number,
          type: t.type,
          code,
          description: t.description,
          card_name: t.card_name,
          last_digit_card: t.last_digit_card,
          voucher: t.voucher,
          total: minus(t.total),
          rate: minus(t.amount),
          pb1: minus(t.pb1),
          svr_chrg: minus(t.svr_chrg),
          surcharge: minus(t.surcharge),
          tax3: minus(t.tax3),
          remark: t.is_void || t.is_split || t.is_transfer ? (t.remark || '') : '',
          staff,
          time: t.created_at ? new Date(t.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
          bill_to: (t.model_id && modelMap.get(String(t.model_id))) || '',
          reference: t.reference,
          pos: t.pos,
          receipt: t.receipt,
          balance: '*****',
          closingFormat: '',
          created_at: t.created_at,
          created_by: Number(t.created_by ?? 0),
          is_void: !!t.is_void,
          is_transfer: !!t.is_transfer,
          is_consolidate: !!t.is_consolidate,
          is_split: !!t.is_split,
          status: t.status,
          is_view: true,
          is_edit: true,
          is_need_approval: false,
        };
      };

      const rows = filtered.map(formatRow);
      const totalTransaction = filtered.reduce((sum: number, t: any) => sum + (t.type_amount === 'MINUS' ? -Number(t.total || 0) : Number(t.total || 0)), 0);

      const lastReservation = folio.reservations?.[folio.reservations.length - 1] || null;
      success(res, rows, 'Success', 200, {
        folio: {
          id: Number(folio.id),
          folio_number: folio.folio_number,
          guest_name: `${folio.first_name || ''} ${folio.last_name || ''}`.trim() || null,
          is_cancel: folio.status_reservation === 2,
          is_parent_git: folio.type_reservation === 'git' && Number(folio.parent) === 0,
          is_sub_git: folio.type_reservation === 'git' && Number(folio.parent) !== 0,
          is_vr: folio.type_reservation === 'vr',
          status_reservation: folio.status_reservation,
          special_instruction: {
            remark: folio.remark || '',
            is_gh: !!folio.is_gh,
            check_in_instruction: folio.check_in_instruction || '',
            check_out_instruction: folio.check_out_instruction || '',
            posting_instruction: folio.posting_instruction || '',
            remark_ins: folio.remark || '',
          },
          check_in_date: folio.check_in_date,
          check_out_date: folio.check_out_date,
          room: lastReservation?.room_name || '',
          room_type: lastReservation?.room_type_name || '',
        },
        ledger_id: ledger ?? null,
        table,
        pagination: { current_page: page, last_page: 1, per_page: limit, total: rows.length, from: rows.length ? 1 : 0, to: rows.length },
        permission,
        search_data: [],
        total_transaction: moneyFormat(totalTransaction),
      });
    } catch (err: any) { console.error('Transaction list error:', err); error(res, 'Failed to list transactions', 500); }
  }

  // POST /transaction — Laravel TransactionController@store parity (:422-662)
  // Shift-open guard, amount>0, tax() via type_payment/code_post, payment→MINUS + guaranted,
  // card/voucher required per type_payment config, event deposit row, ledger attach via bill_to.
  static async transactionStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const body = req.body || {};
      const { folio_id, type, date, code, description, remark } = body;
      if (!type) { badRequest(res, 'The type field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }
      if (!code) { badRequest(res, 'The code field is required.'); return; }

      const folio = await prisma.folios.findUnique({ where: { id: BigInt(folio_id) }, select: { id: true, folio_number: true, company_profile_id: true, guest_profile_id: true } });
      if (!folio) { badRequest(res, 'The selected folio id is invalid.'); return; }

      // Laravel :459-478 parity — NO super-user bypass. First role of the user
      // (model_has_roles, no property scope) must have menus with visibility='transaction'
      // (role→menu morph via model_has_menus) AND an open shift on the business date;
      // otherwise 'Shift is not open'.
      const userId = req.user?.id ?? 0n;
      const userRole = await prisma.model_has_roles.findFirst({
        where: { model_type: 'App\\Models\\User', model_id: userId },
        select: { role_id: true },
      });
      const txnMenuCount = userRole
        ? await prisma.model_has_menus.count({
            where: { model_type: 'App\\Models\\Role', model_id: userRole.role_id, menus: { visibility: 'transaction' } },
          })
        : 0;
      if (txnMenuCount > 0) {
        const businessDate = await AuthController.getBusinessDate(pid);
        const bStart = new Date(businessDate + 'T00:00:00.000Z');
        const bEnd = new Date(bStart.getTime() + 86400000);
        const openShift = await prisma.shifts.findFirst({
          where: { property_id: pid, user_id: userId, date: { gte: bStart, lt: bEnd }, end: null, deleted_at: null },
          select: { id: true },
        });
        if (!openShift) { badRequest(res, 'Shift is not open'); return; }
      } else {
        badRequest(res, 'Shift is not open');
        return;
      }

      const sumPrice = Number(body.amount ?? 0);
      if (!(sumPrice > 0)) { badRequest(res, 'Amount must be greater than 0'); return; }

      const isPaymentLike = ['payment', 'paidout', 'refund'].includes(String(type));
      let surcharge = 0;
      let idPayment: bigint | null = null;
      let idCode = String(code);
      let calc: any;

      if (isPaymentLike) {
        // Laravel tax(): request.code is the type_payment id here
        const tp = await prisma.type_payments.findUnique({ where: { id: BigInt(code) }, include: { code_posts: { select: { id: true } } } });
        if (!tp) { badRequest(res, 'Type payment not found'); return; }
        idPayment = tp.id;
        surcharge = Number(tp.surcharge_type ?? 0) === 1 ? Number(tp.surcharge ?? 0) : sumPrice * (Number(tp.surcharge ?? 0) / 100);
        idCode = String(tp.code_post_id);
        if (tp.card_no && !body.last_digit_card) { badRequest(res, 'The card number field is required.'); return; }
        if (tp.card_name && !body.card_name) { badRequest(res, 'The card name field is required.'); return; }
        if (tp.voucher && !body.voucher) { badRequest(res, 'The voucher field is required.'); return; }

        // Laravel :553-575 — company AR stop-credit check.
        // Laravel computes $hasCredit but never uses it (dead code). Here we make
        // the flag meaningful: a company flagged is_stop_credit cannot receive
        // new company-AR payment postings.
        if (body.bill_to && String(body.bill_to).endsWith('-company')) {
          const cpId = String(body.bill_to).split('-')[0];
          const cp = await prisma.company_profiles.findUnique({
            where: { id: BigInt(cpId) },
            select: { is_stop_credit: true },
          });
          if (cp && tp.is_company_ar === true && cp.is_stop_credit === true) {
            badRequest(res, 'Cant make Transactions, credit is stopped for this company');
            return;
          }
        }
      }

      // tax calc via code post
      const codePost = await prisma.code_posts.findUnique({ where: { id: BigInt(idCode) } });
      calc = codePost ? calculateCodePost(
        {
          tax: codePost.tax ?? false,
          tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
          local_tax: codePost.local_tax ?? false,
          local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
          service_charge: codePost.service_charge ?? false,
          service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
          service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
          tax_include_local_tax: codePost.tax_include_local_tax ?? false,
        },
        sumPrice,
        false
      ) : { amount: sumPrice, service: 0, tax3: 0, pb1: 0, total: sumPrice };

      const finalAmount = isPaymentLike ? sumPrice - surcharge : calc.amount;

      // Laravel :502-515 — payment → MINUS + guaranted flag
      const typeAmount = String(type) === 'payment' ? 'MINUS' : (body.type_amount ?? 'PLUS');
      if (String(type) === 'payment' && body.guaranted) {
        await prisma.folios.update({ where: { id: folio.id }, data: { guaranted: true } });
      }

      // business date (Laravel uses getBusinessDate for the posting date)
      const postingDateStr = await AuthController.getBusinessDate(pid);
      const postingDate = date ? new Date(date) : new Date(postingDateStr + 'T00:00:00.000Z');

      // ledger attach via bill_to ('{id}-company' / '{id}-guest'), fallback folio company
      let modelType: string | null = null;
      let modelId: bigint | null = null;
      if (body.bill_to && String(body.bill_to).includes('-')) {
        const [bid, bkind] = String(body.bill_to).split('-');
        if (bkind === 'company') { modelType = 'App\\Models\\CompanyProfile'; modelId = BigInt(bid); }
        else if (bkind === 'guest') { modelType = 'App\\Models\\GuestProfile'; modelId = BigInt(bid); }
      }
      if (!modelType) {
        modelType = 'App\\Models\\CompanyProfile';
        modelId = folio.company_profile_id;
      }

      const created = await prisma.transactions.create({
        data: {
          property_id: pid,
          folio_id: folio.id,
          type,
          uuid: randomUUID(),
          date: postingDate,
          code: idCode,
          code_name: body.code_name ?? codePost?.name ?? null,
          type_payment_id: idPayment,
          code_item_id: body.code_item_id ? BigInt(body.code_item_id) : null,
          description: description ?? null,
          overwrite_reason: body.overwrite_reason ?? null,
          time: body.time ?? null,
          bill_to: body.bill_to ?? null,
          reference: body.reference ?? null,
          pos: body.pos ?? null,
          receipt: body.receipt ?? null,
          last_digit_card: body.last_digit_card ? parseInt(body.last_digit_card) : null,
          card_name: body.card_name ?? null,
          voucher: body.voucher ?? null,
          booking: body.booking ?? null,
          amount: finalAmount,
          total: calc.total,
          svr_chrg: calc.service,
          pb1: calc.pb1,
          tax3: calc.tax3,
          surcharge,
          type_amount: typeAmount,
          // Every posting must belong to a billing ledger. These were computed
          // above and then dropped on the floor, so manual postings, payments,
          // paid-outs and refunds all landed with model_type = NULL. That made
          // them invisible to the GIT balance roll-up (which filters on
          // model_type) and left the "Bill To" column blank in the grid.
          model_type: modelType,
          model_id: modelId,
          is_event_deposit: body.is_event_deposit ? 1 : 0,
          status: 1,
          is_pos_deposit: body.is_pos_deposit ? 1 : 0,
          source: body.is_pos_deposit ? 'pos' : 'hms',
          created_at: new Date(),
          created_by: req.user?.id ?? null,
        },
      });

      // Laravel :604-620 — event deposit side effect
      if (body.is_event_deposit) {
        await prisma.deposit_events.create({
          data: {
            property_id: pid,
            folio_id: folio.id,
            date: postingDate,
            type_payment_id: idPayment ?? BigInt(code),
            amount: Math.round(Number(body.raw_total ?? calc.total ?? sumPrice)),
            status: 1,
            created_by: req.user?.id ?? null,
          },
        }).catch(() => {});
      }

      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'transactions',
        event: 'created',
        subjectId: created.id,
        name: `transaction-${String(type)}-posted`,
        description: `${String(type)} posted to folio ${folio.folio_number ?? folio.id} for ${calc.total}`,
        logName: 'cashiering',
        attributes: {
          type, total: calc.total, amount: finalAmount,
          type_amount: typeAmount, code: idCode, model_type: modelType, model_id: modelId,
        },
        meta: {
          folio_id: String(folio.id),
          folio_number: folio.folio_number,
          bill_to: body.bill_to ?? null,
          is_event_deposit: !!body.is_event_deposit,
          is_pos_deposit: !!body.is_pos_deposit,
        },
      });

      success(res, { id: Number(created.id) }, 'Success');
    } catch (err: any) { console.error('Transaction store error:', err); error(res, 'Failed to create transaction', 500); }
  }

  static async transactionShow(req: Request, res: Response): Promise<void> {
    try {
      const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!raw || !/^\d+$/.test(raw)) { notFound(res, 'Transaction not found'); return; }
      const id = BigInt(raw);
      const data = await prisma.transactions.findUnique({ where: { id }, include: { type_payments: true, folios: { select: { folio_number: true } } } });
      if (!data) { notFound(res, 'Transaction not found'); return; }
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { error(res, 'Failed to load transaction', 500); }
  }

  // Replicates Laravel TransactionController@create (GET /transaction/create?folio_id=&type_button=)
  static async transactionCreate(req: Request, res: Response): Promise<void> {
    try {
      const folioId = String(req.query.folio_id ?? '');
      if (!folioId || !/^\d+$/.test(folioId)) { badRequest(res, 'The folio id field is required.'); return; }
      const id = BigInt(folioId);
      const folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          company_profiles_folios_company_profile_idTocompany_profiles: { select: { id: true, name: true } },
        },
      });
      if (!folio) { badRequest(res, 'The selected folio id is invalid.'); return; }
      const guest = folio.guest_profile_id ? await prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } }).catch(() => null) : null;

      const pid = BigInt(req.user?.lastProperty ?? 0);
      const [typePayments, postCodeManual, transferFolios] = await Promise.all([
        prisma.type_payments.findMany({
          where: { deleted_at: null, status: 1, ...(req.user?.lastProperty ? { property_id: pid } : {}), code_posts: { type: 'IS_PAYMENT' } },
          include: { code_posts: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
        }),
        prisma.code_posts.findMany({
          where: { deleted_at: null, status: 1, type: 'DEFAULT', ...(req.user?.lastProperty ? { property_id: pid } : {}) },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        String(req.query.type_button ?? '') === 'transfer'
          ? prisma.folios.findMany({
              where: { deleted_at: null, id: { not: id }, status_reservation: 0 },
              select: { id: true, folio_number: true },
              orderBy: { id: 'desc' },
            })
          : Promise.resolve([]),
      ]);

      const ledgers: { value: string; label: string }[] = [];
      const company = folio.company_profiles_folios_company_profile_idTocompany_profiles;
      if (company?.name) ledgers.push({ value: `${Number(company.id)}-company`, label: company.name });
      if (guest?.id) ledgers.push({ value: `${Number(guest.id)}-guest`, label: `${guest.first_name || ''} ${guest.last_name || ''}`.trim() });

      const txns = await prisma.transactions.findMany({ where: { folio_id: id }, select: { total: true, type_amount: true } });
      let total = txns.reduce((sum: number, t: any) => sum + (t.type_amount === 'MINUS' ? -Number(t.total) : Number(t.total)), 0);
      if (total === 0 && folio.cash_on_arrival) {
        const resv = await prisma.reservations.findMany({ where: { folio_id: id }, select: { total: true } });
        total = resv.reduce((sum: number, r: any) => sum + Number(r.total ?? 0), 0);
      }

      success(res, bigintToNumber(folio), 'Success', 200, {
        master: {
          statuses: STATUSES,
          ledgers,
          code_posts: typePayments.map((tp: any) => ({ value: Number(tp.id), label: `${tp.code_posts?.name || ''} - ${tp.name}` })),
          postCodeManual: postCodeManual.map((cp: any) => ({ value: Number(cp.id), label: cp.name })),
          folios: transferFolios.map((f: any) => ({ value: Number(f.id), label: f.folio_number })),
          paid_out: total < 0 ? moneyFormat(-total) : 0,
          payment: total > 0 ? moneyFormat(total) : 0,
          bussiness_date: await AuthController.getBusinessDate(req.user?.lastProperty ?? null),
        },
      });
    } catch (err: any) { console.error('Transaction create error:', err); error(res, 'Failed to load transaction form', 500); }
  }

  // Replicates Laravel TransactionController@folio (GET /transaction/folio?folio_id=)
  static async transactionFolio(req: Request, res: Response): Promise<void> {
    try {
      const folioId = String(req.query.folio_id ?? '');
      if (!folioId || !/^\d+$/.test(folioId)) { badRequest(res, 'The folio id field is required.'); return; }
      const id = BigInt(folioId);
      const pid = BigInt(req.user?.lastProperty ?? 0);
      const folios = await prisma.folios.findMany({
        where: { deleted_at: null, id: { not: id }, status_reservation: 0, ...(req.user?.lastProperty ? { property_id: pid } : {}) },
        include: {
          company_profiles_folios_company_profile_idTocompany_profiles: { select: { name: true } },
        },
        orderBy: { id: 'desc' },
      });
      const guestIds = folios.map((f: any) => f.guest_profile_id).filter(Boolean);
      const guests = guestIds.length
        ? await prisma.guest_profiles.findMany({ where: { id: { in: guestIds } }, select: { id: true, first_name: true, last_name: true } })
        : [];
      const guestMap = new Map(guests.map((g: any) => [Number(g.id), g]));
      success(res, folios.map((f: any) => ({
        value: Number(f.id),
        label: `${f.folio_number || ''} - ${f.company_profiles_folios_company_profile_idTocompany_profiles?.name || ''} - ${(guestMap.get(Number(f.guest_profile_id))?.first_name || '') + ' ' + (guestMap.get(Number(f.guest_profile_id))?.last_name || '')}`.trim(),
      })), 'Success');
    } catch (err: any) { console.error('Transaction folio error:', err); error(res, 'Failed to load folios', 500); }
  }

  // PUT /front-desk/data/:id - save folio remark/message fields (Laravel frontend flow)
  static async updateData(req: Request, res: Response): Promise<void> {
    try {
      const id = idParamBig(req.params.id);
      const whitelist = ['remark', 'remark_ins', 'check_in_instruction', 'check_out_instruction', 'posting_instruction', 'image'];
      const data: any = { updated_at: new Date(), updated_by: req.user?.id };
      for (const key of whitelist) {
        if (req.body && req.body[key] !== undefined) data[key] = req.body[key];
      }
      if (Object.keys(data).length <= 2) { badRequest(res, 'No fields to update'); return; }
      const folio = await prisma.folios.update({ where: { id }, data });
      success(res, bigintToNumber(folio), 'Success');
    } catch (err: any) { console.error('Front desk update data error:', err); error(res, 'Failed to update', 500); }
  }

  static async transactionVoid(req: Request, res: Response): Promise<void> {
    // Laravel parity: single-id void goes through the SAME reversal logic as bulk.
    // (was: bare is_void=1 without reversal row — breaks double-entry)
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    req.body = { idx: [id], remark: req.body?.reason ?? req.body?.remark ?? '' };
    return FrontDeskController.transactionVoidBulk(req, res);
  }

  // POST /transaction/void?folio_id= — Laravel TransactionController@void parity (:711-745)
  // Bulk idx → mark is_void + replicate REVERSAL row (type_amount flipped, void_code=orig id,
  // request remark, is_end_of_day=0) so ledger stays balanced.
  static async transactionVoidBulk(req: Request, res: Response): Promise<void> {
    try {
      const { idx, remark } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }
      if (!remark || typeof remark !== 'string') { badRequest(res, 'The remark field is required.'); return; }

      // A void restates recognised revenue, so it needs someone other than the
      // operator to authorise it. Checked before any read of the transactions so
      // a rejected void leaks nothing about the folio.
      const approval = await verifySupervisorApproval(req, 'void');
      if (!approval.ok) {
        if (approval.code === 403) forbidden(res, approval.message);
        else badRequest(res, approval.message);
        return;
      }

      const ids = idx.map((v: any) => BigInt(v));
      const txns = await prisma.transactions.findMany({ where: { id: { in: ids } } });
      if (txns.length === 0) { badRequest(res, 'No matching transactions found.'); return; }

      // Idempotency: the reversal is what keeps the folio balanced, and the
      // balance query ignores is_void. Voiding twice therefore appended a second
      // reversal and drove the balance to -2x the charge. Refuse instead.
      const alreadyVoided = txns.filter((t) => t.is_void);
      if (alreadyVoided.length > 0) {
        badRequest(
          res,
          'Already voided: ' + alreadyVoided.map((t) => String(t.id)).join(', ')
        );
        return;
      }

      // A reversal inherits is_posting from the source, so voiding after the
      // shift/night close would silently restate recognised revenue with no way
      // to reopen the period. Require an un-posted transaction.
      const posted = txns.filter((t) => t.is_posting === 1 || t.is_end_of_day === 1);
      if (posted.length > 0) {
        badRequest(
          res,
          'Cannot void a posted transaction: ' + posted.map((t) => String(t.id)).join(', ')
        );
        return;
      }

      // Whole batch in one transaction — void is two writes per row, and a
      // failure between them left the original flagged with no reversal.
      try {
        await prisma.$transaction(
          async (tx) => {
            for (const t of txns) {
              await tx.transactions.update({
                where: { id: t.id },
                data: { is_void: 1, updated_at: new Date(), updated_by: req.user?.id ?? null },
              });

              // Reversal entry (Laravel replicate with flipped type_amount)
              await tx.transactions.create({
                data: {
                  property_id: t.property_id,
                  folio_id: t.folio_id,
                  type: t.type,
                  uuid: randomUUID(),
                  date: t.date,
                  code: t.code,
                  code_name: t.code_name,
                  type_payment_id: t.type_payment_id,
                  code_item_id: t.code_item_id,
                  description: t.description,
                  amount: t.amount,
                  total: t.total,
                  type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
                  pb1: t.pb1,
                  svr_chrg: t.svr_chrg,
                  surcharge: t.surcharge,
                  tax3: t.tax3,
                  time: t.time,
                  bill_to: t.bill_to,
                  model_type: t.model_type,
                  model_id: t.model_id,
                  remark,
                  reference: t.reference,
                  pos: t.pos,
                  receipt: t.receipt,
                  card_name: t.card_name,
                  last_digit_card: t.last_digit_card,
                  voucher: t.voucher,
                  booking: t.booking,
                  is_posting: t.is_posting,
                  is_endshift: t.is_endshift,
                  is_void: 1,
                  is_transfer: t.is_transfer,
                  is_consolidate: t.is_consolidate,
                  is_split: t.is_split,
                  is_has_inclusive: t.is_has_inclusive,
                  is_end_of_day: 0,
                  void_code: String(t.id),
                  status: t.status,
                  source: t.source,
                  created_at: new Date(),
                  created_by: req.user?.id ?? null,
                },
              });
            }
          },
          { timeout: 20000 }
        );
      } catch (txErr: any) {
        console.error('Transaction void transaction error:', txErr);
        error(res, 'Failed to void transactions', 500);
        return;
      }

      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'transactions',
        event: 'updated',
        subjectId: txns[0].id,
        name: 'transactions-voided',
        description: `${txns.length} transaction(s) voided: ${txns.map((t) => t.id).join(', ')}`,
        logName: 'cashiering',
        meta: {
          transaction_ids: txns.map((t) => Number(t.id)),
          folio_ids: [...new Set(txns.map((t) => String(t.folio_id)))],
          remark,
          reversal_rows: txns.length,
          approved_by: approval.approver.id,
          approved_by_name: approval.approver.name,
        },
      });

      success(res, { voided: txns.map((t) => Number(t.id)), approved_by: approval.approver }, 'Success');
    } catch (err: any) { console.error('Transaction void bulk error:', err); error(res, 'Failed to void transactions', 500); }
  }

  // POST /transaction/transfer?folio_id= — Laravel TransactionController@transfer parity (:752-888)
  // body: { idx: number[], folio_id } — move charges to another folio via void/new replicate pair.
  static async transactionTransfer(req: Request, res: Response): Promise<void> {
    try {
      const { idx, folio_id } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }

      const targetFolio = await prisma.folios.findUnique({ where: { id: BigInt(folio_id) }, select: { id: true, folio_number: true, company_profile_id: true } });
      if (!targetFolio) { badRequest(res, 'The selected folio id is invalid.'); return; }

      const txns = await prisma.transactions.findMany({ where: { id: { in: idx.map((v: any) => BigInt(v)) } }, include: { folios: { select: { folio_number: true } } } });
      if (txns.length > 0 && String(txns[0].folio_id) === String(targetFolio.id)) {
        badRequest(res, 'Folio is required');
        return;
      }
      if (!targetFolio.company_profile_id) { badRequest(res, 'Company Profile Not Found'); return; }

      const pid = req.user?.lastProperty ?? 0n;
      const businessDate = await AuthController.getBusinessDate(pid);
      const bDate = new Date(businessDate + 'T00:00:00.000Z');

      const copyBreakdowns = async (fromTxnId: bigint, toTxnId: bigint, targetFid: bigint | null, reversed: boolean, isTransfer: number, remarkSuffix: string, db: Pick<typeof prisma, 'transaction_breakdowns'> = prisma) => {
        const rows = await db.transaction_breakdowns.findMany({ where: { transaction_id: fromTxnId } });
        for (const b of rows) {
          await db.transaction_breakdowns.create({
            data: {
              property_id: b.property_id,
              transaction_id: toTxnId,
              folio_id: targetFid ?? b.folio_id,
              type: b.type,
              date: bDate,
              code: b.code,
              type_payment_id: b.type_payment_id,
              code_item_id: b.code_item_id,
              description: b.description,
              amount: b.amount,
              total: b.total,
              type_amount: reversed ? (b.type_amount === 'MINUS' ? 'PLUS' : 'MINUS') : b.type_amount,
              pb1: b.pb1, svr_chrg: b.svr_chrg, surcharge: b.surcharge, tax3: b.tax3,
              time: b.time, bill_to: b.bill_to, model_type: b.model_type, model_id: b.model_id,
              remark: b.remark ? `${b.remark} - ${remarkSuffix}` : remarkSuffix,
              is_transfer: isTransfer,
              is_consolidate: b.is_consolidate, is_split: b.is_split, is_has_inclusive: b.is_has_inclusive,
              status: b.status,
              created_at: new Date(),
            },
          });
        }
      };

      // Transfer is a void+repost pair per row. All of it (3 transaction rows
      // plus breakdown copies per source) runs in ONE transaction so a failure
      // part-way cannot leave a reversal on the source with nothing on the
      // target — which is an unbalanced folio with no trace of why.
      const toSuffix = `To - ${targetFolio.folio_number ?? ''}`;
      const fromSuffix = `from - ${txns[0]?.folios?.folio_number ?? ''}`;
      try {
        await prisma.$transaction(
          async (tx) => {
            for (const t of txns) {
              const isRoomRevenue = t.type === 'room_revenue';
              const newDate = isRoomRevenue ? bDate : t.date;

              // reversal row on source folio
              const voidRow = await tx.transactions.create({
                data: {
                  property_id: t.property_id, folio_id: t.folio_id, type: t.type, uuid: randomUUID(),
                  date: newDate, code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id,
                  code_item_id: t.code_item_id, description: t.description, amount: t.amount, total: t.total,
                  type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
                  pb1: t.pb1, svr_chrg: t.svr_chrg, surcharge: t.surcharge, tax3: t.tax3,
                  time: t.time, bill_to: t.bill_to, model_type: t.model_type, model_id: t.model_id,
                  remark: toSuffix,
                  is_transfer: 1, is_end_of_day: 0, void_code: String(t.id),
                  status: t.status, source: t.source, created_at: new Date(), created_by: req.user?.id ?? null,
                },
              });
              await copyBreakdowns(t.id, voidRow.id, null, true, 1, toSuffix, tx);

              // new row on target folio. model_type/model_id follow the
              // transaction's own billing, falling back to the target company —
              // the old code hardcoded CompanyProfile regardless of what was
              // actually being moved.
              const movedType = t.model_type ?? 'App\\Models\\CompanyProfile';
              const movedId = t.model_id ?? targetFolio.company_profile_id;
              const newRow = await tx.transactions.create({
                data: {
                  property_id: t.property_id, folio_id: targetFolio.id, type: t.type, uuid: randomUUID(),
                  date: newDate, code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id,
                  code_item_id: t.code_item_id, description: t.description, amount: t.amount, total: t.total,
                  type_amount: t.type_amount,
                  pb1: t.pb1, svr_chrg: t.svr_chrg, surcharge: t.surcharge, tax3: t.tax3,
                  time: t.time, bill_to: t.bill_to,
                  model_type: movedType, model_id: movedId,
                  remark: t.remark ? `${t.remark} - ${fromSuffix}` : fromSuffix,
                  is_transfer: 2, is_end_of_day: 0, void_code: String(t.id),
                  status: t.status, source: t.source, created_at: new Date(), created_by: req.user?.id ?? null,
                },
              });
              await copyBreakdowns(t.id, newRow.id, targetFolio.id, false, 2, fromSuffix, tx);

              await tx.transactions.update({ where: { id: t.id }, data: { is_transfer: 1, remark: toSuffix } });
            }
          },
          { timeout: 30000 }
        );
      } catch (txErr: any) {
        console.error('Transaction transfer transaction error:', txErr);
        error(res, 'Failed to transfer transactions', 500);
        return;
      }

      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'transactions',
        event: 'updated',
        subjectId: txns[0].id,
        name: 'transactions-transferred',
        description: `${txns.length} transaction(s) transferred to folio ${targetFolio.folio_number ?? targetFolio.id}`,
        logName: 'cashiering',
        meta: {
          transaction_ids: txns.map((t) => Number(t.id)),
          from_folio_ids: [...new Set(txns.map((t) => String(t.folio_id)))],
          to_folio_id: String(targetFolio.id),
          to_folio_number: targetFolio.folio_number,
          target_company_id: String(targetFolio.company_profile_id),
        },
      });

      success(res, { transferred: txns.map((t) => Number(t.id)) }, 'Success');
    } catch (err: any) { console.error('Transaction transfer error:', err); error(res, 'Failed to transfer transactions', 500); }
  }

  // POST /transaction/refund — Laravel TransactionController@refund parity (:895-927)
  // body: { idx: number[], remark? } — void + replicate with type='refund' and reversed type_amount.
  //
  // A refund is a REVERSAL of a specific payment, never a free-typed amount.
  // The UI used to post straight to transactionStore with type='refund', which
  // produced a PLUS row linked to nothing: no void_code, no is_void on the
  // original, no cap against the amount actually taken, so the operator could
  // mint a credit by "refunding" money that was never received.
  static async transactionRefund(req: Request, res: Response): Promise<void> {
    try {
      const { idx, remark } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }

      // Refunding pays money back out, so it carries the same second-pair-of-eyes
      // requirement as a void.
      const approval = await verifySupervisorApproval(req, 'refund');
      if (!approval.ok) {
        if (approval.code === 403) forbidden(res, approval.message);
        else badRequest(res, approval.message);
        return;
      }

      const ids = idx.map((v: any) => {
        try { return BigInt(v); } catch { return null; }
      }).filter((v): v is bigint => v !== null);
      if (ids.length === 0) { badRequest(res, 'No valid transaction selected.'); return; }

      const txns = await prisma.transactions.findMany({ where: { id: { in: ids } } });
      if (txns.length !== ids.length) { badRequest(res, 'One or more selected transactions no longer exist.'); return; }

      // Only payments can be refunded, and only once.
      const notPayments = txns.filter((t) => t.type !== 'payment');
      if (notPayments.length > 0) {
        badRequest(res, 'Only payment transactions can be refunded.');
        return;
      }
      const alreadyVoided = txns.filter((t) => t.is_void);
      if (alreadyVoided.length > 0) {
        badRequest(res, 'One or more selected payments have already been voided or refunded.');
        return;
      }
      const posted = txns.filter((t) => t.is_end_of_day === 1);
      if (posted.length > 0) {
        badRequest(res, 'Cannot refund a transaction that has already been posted by night audit.');
        return;
      }

      // Whole transaction: flag + reversal must both land or neither, or the
      // folio balance is silently wrong.
      try {
        await prisma.$transaction(
          async (tx) => {
            for (const t of txns) {
              await tx.transactions.update({ where: { id: t.id }, data: { is_void: 1, updated_at: new Date(), updated_by: req.user?.id ?? null } });
              await tx.transactions.create({
                data: {
                  property_id: t.property_id, folio_id: t.folio_id, type: 'refund', uuid: randomUUID(),
                  date: t.date, code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id,
                  code_item_id: t.code_item_id, description: t.description, amount: t.amount, total: t.total,
                  type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
                  pb1: t.pb1, svr_chrg: t.svr_chrg, surcharge: t.surcharge, tax3: t.tax3,
                  time: t.time, bill_to: t.bill_to, model_type: t.model_type, model_id: t.model_id,
                  remark: remark ?? t.remark, void_code: String(t.id), is_void: 1,
                  is_transfer: t.is_transfer, is_consolidate: t.is_consolidate, is_split: t.is_split,
                  is_has_inclusive: t.is_has_inclusive, is_end_of_day: t.is_end_of_day,
                  status: t.status, source: t.source, created_at: new Date(), created_by: req.user?.id ?? null,
                },
              });
            }
          },
          { timeout: 20000 }
        );
      } catch (txErr: any) {
        console.error('Transaction refund transaction error:', txErr);
        error(res, 'Failed to refund transactions', 500);
        return;
      }
      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'transactions',
        event: 'updated',
        subjectId: txns[0].id,
        name: 'transactions-refunded',
        description: `${txns.length} payment(s) refunded: ${txns.map((t) => t.id).join(', ')}`,
        logName: 'cashiering',
        meta: {
          transaction_ids: txns.map((t) => Number(t.id)),
          refunded_total: txns.reduce((s, t) => s + Number(t.total ?? 0), 0),
          folio_ids: [...new Set(txns.map((t) => String(t.folio_id)))],
          remark: remark ?? null,
          approved_by: approval.approver.id,
          approved_by_name: approval.approver.name,
        },
      });
      success(res, { refunded: txns.map((t) => Number(t.id)), approved_by: approval.approver }, 'Success');
    } catch (err: any) { console.error('Transaction refund error:', err); error(res, 'Failed to refund transactions', 500); }
  }

  // POST /transaction/consolidate — Laravel TransactionController@consolidate parity (:966-1032)
  // body: { idx: number[], folio_id, code, remark? } — merge charges into one 'consolidate' transaction.
  static async transactionConsolidate(req: Request, res: Response): Promise<void> {
    try {
      const { idx, folio_id, code, remark } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }
      if (!code) { badRequest(res, 'The code field is required.'); return; }

      const folio = await prisma.folios.findUnique({ where: { id: BigInt(folio_id) }, select: { id: true } });
      if (!folio) { badRequest(res, 'The selected folio id is invalid.'); return; }

      const txns = await prisma.transactions.findMany({ where: { id: { in: idx.map((v: any) => BigInt(v)) } } });
      if (txns.length === 0) { badRequest(res, 'No matching transactions found.'); return; }
      const alreadyDone = txns.filter((t) => t.is_consolidate);
      if (alreadyDone.length > 0) {
        badRequest(res, 'Already consolidated: ' + alreadyDone.map((t) => String(t.id)).join(', '));
        return;
      }
      let totalMinor = 0;
      for (const t of txns) totalMinor += t.type_amount === 'MINUS' ? -toMinorUnits(t.total) : toMinorUnits(t.total);
      const amountAbs = Math.abs(totalMinor) / MINOR_UNITS;

      const calc = await calcTaxForCode(code, amountAbs);

      // The merged line inherits the billing ledger of the rows it replaces.
      // It used to be created with no model_type/model_id, so a consolidated
      // charge was billed to nobody and vanished from the GIT roll-up.
      const lead = txns[0];

      // One merged row + a reversal per source. All-or-nothing.
      let newTxnId: bigint;
      try {
        newTxnId = await prisma.$transaction(
          async (tx) => {
            const merged = await tx.transactions.create({
              data: {
                property_id: req.user?.lastProperty ?? 0n,
                folio_id: folio.id,
                date: new Date(),
                code: calc.code,
                code_name: lead.code_name ?? null,
                type: 'consolidate',
                total: calc.total,
                svr_chrg: calc.svr_chrg,
                pb1: calc.pb1,
                surcharge: 0,
                tax3: calc.tax3,
                amount: calc.amount,
                type_amount: totalMinor > 0 ? 'PLUS' : 'MINUS',
                bill_to: lead.bill_to,
                model_type: lead.model_type ?? 'App\\Models\\CompanyProfile',
                model_id: lead.model_id,
                status: 1,
                is_consolidate: 1,
                created_at: new Date(),
                created_by: req.user?.id ?? null,
              },
            });

            for (const t of txns) {
              await tx.transactions.update({ where: { id: t.id }, data: { is_consolidate: 1, remark: remark ?? t.remark, updated_at: new Date() } });
              await tx.transactions.create({
                data: {
                  property_id: t.property_id, folio_id: t.folio_id, type: t.type, uuid: randomUUID(),
                  date: t.date, code: t.code, code_name: t.code_name, type_payment_id: t.type_payment_id,
                  code_item_id: t.code_item_id, description: t.description, amount: t.amount, total: t.total,
                  type_amount: t.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
                  pb1: t.pb1, svr_chrg: t.svr_chrg, surcharge: t.surcharge, tax3: t.tax3,
                  time: t.time, bill_to: t.bill_to, model_type: t.model_type, model_id: t.model_id,
                  remark: remark ?? t.remark, void_code: String(t.id), is_void: 1, is_consolidate: 1,
                  is_transfer: t.is_transfer, is_split: t.is_split, is_has_inclusive: t.is_has_inclusive,
                  is_end_of_day: t.is_end_of_day, status: t.status, source: t.source,
                  created_at: new Date(), created_by: req.user?.id ?? null,
                },
              });
            }
            return merged.id;
          },
          { timeout: 30000 }
        );
      } catch (txErr: any) {
        console.error('Transaction consolidate transaction error:', txErr);
        error(res, 'Failed to consolidate transactions', 500);
        return;
      }

      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'transactions',
        event: 'created',
        subjectId: newTxnId,
        name: 'transactions-consolidated',
        description: `${txns.length} transaction(s) consolidated into #${newTxnId} on folio ${folio.id}`,
        logName: 'cashiering',
        attributes: { total: calc.total, amount: calc.amount, type_amount: totalMinor > 0 ? 'PLUS' : 'MINUS' },
        meta: {
          source_ids: txns.map((t) => Number(t.id)),
          folio_id: String(folio.id),
          merged_into_code: calc.code,
        },
      });

      success(res, { id: Number(newTxnId) }, 'Success');
    } catch (err: any) { console.error('Transaction consolidate error:', err); error(res, 'Failed to consolidate transactions', 500); }
  }

  // POST /transaction/split — Laravel TransactionController@split parity (:1035-1140)
  // body: { idx: number[], folio_id, amount, code, remark? } — split last selected transaction into two.
  static async transactionSplit(req: Request, res: Response): Promise<void> {
    try {
      const { idx, folio_id, amount, code, remark } = req.body;
      if (!Array.isArray(idx) || idx.length === 0) { badRequest(res, 'The idx field is required.'); return; }
      if (!folio_id) { badRequest(res, 'The folio id field is required.'); return; }
      if (amount === undefined || amount === null || Number(amount) < 0) { badRequest(res, 'The amount must be at least 0'); return; }
      if (!code) { badRequest(res, 'The code field is required.'); return; }

      // The UI renders this as a radio, but a request can still carry several
      // ids. Silently splitting only the last one and ignoring the rest made the
      // caller believe every selected row was split.
      if (idx.length > 1) {
        badRequest(res, 'Split works on one transaction at a time. Select a single row.');
        return;
      }

      const trxId = BigInt(idx[0]);
      const orig = await prisma.transactions.findFirst({ where: { id: trxId, folio_id: BigInt(folio_id) } });
      if (!orig) { badRequest(res, 'Transaction Not Found'); return; }
      if (orig.is_split || orig.is_void) { badRequest(res, 'Transaction was already split or voided.'); return; }

      // Validate BEFORE mutating. The old order wrote is_split=1 first, so a
      // rejected split left the original permanently flagged with no children.
      if (Number(amount) > Number(orig.total ?? 0)) {
        badRequest(res, 'Total Input is more than transaction total');
        return;
      }

      const amountOrigin = Number(amount);
      const remainder = Number(orig.total ?? 0) - amountOrigin;

      // Both halves get their own tax computation. The remainder previously used
      // the raw figure and copied the original's pb1/svr_chrg/tax3 verbatim, so
      // the two children did not add up to the parent's tax.
      const calc1 = await calcTaxForCode(code, amountOrigin);
      const calc2 = await calcTaxForCode(orig.code, remainder);

      // split-off + remainder + reversal, atomically.
      try {
        await prisma.$transaction(
          async (tx) => {
            await tx.transactions.update({ where: { id: orig.id }, data: { is_split: 1, updated_at: new Date() } });

            // first: new txn for the split-off amount with the requested code post
            await tx.transactions.create({
              data: {
                property_id: orig.property_id, folio_id: orig.folio_id, type: orig.type, uuid: randomUUID(),
                date: orig.date, code: calc1.code, code_name: orig.code_name, type_payment_id: orig.type_payment_id,
                description: orig.description,
                amount: calc1.amount, total: calc1.total, pb1: calc1.pb1, svr_chrg: calc1.svr_chrg,
                surcharge: 0, tax3: calc1.tax3,
                time: orig.time, bill_to: orig.bill_to, model_type: orig.model_type, model_id: orig.model_id,
                remark: remark ?? orig.remark,
                type_amount: orig.type_amount,
                // is_split: 1 marks these as the children of a split, so the
                // folio view can still tell them apart from ordinary postings.
                is_split: 1, is_posting: orig.is_posting, is_endshift: orig.is_endshift,
                status: orig.status, source: orig.source, created_at: new Date(), created_by: req.user?.id ?? null,
              },
            });

            // second: remainder on the original code post
            await tx.transactions.create({
              data: {
                property_id: orig.property_id, folio_id: orig.folio_id, type: orig.type, uuid: randomUUID(),
                date: orig.date, code: String(orig.code ?? calc2.code), code_name: orig.code_name, type_payment_id: orig.type_payment_id,
                code_item_id: orig.code_item_id,
                description: orig.description,
                amount: calc2.amount, total: calc2.total, pb1: calc2.pb1, svr_chrg: calc2.svr_chrg,
                surcharge: 0, tax3: calc2.tax3,
                time: orig.time, bill_to: orig.bill_to, model_type: orig.model_type, model_id: orig.model_id,
                remark: remark ?? orig.remark,
                type_amount: orig.type_amount,
                is_split: 1, is_posting: orig.is_posting, is_endshift: orig.is_endshift,
                status: orig.status, source: orig.source, created_at: new Date(), created_by: req.user?.id ?? null,
              },
            });

            // third: reversal of the original
            await tx.transactions.create({
              data: {
                property_id: orig.property_id, folio_id: orig.folio_id, type: orig.type, uuid: randomUUID(),
                date: orig.date, code: orig.code, code_name: orig.code_name, type_payment_id: orig.type_payment_id,
                code_item_id: orig.code_item_id, description: orig.description, amount: orig.amount, total: orig.total,
                type_amount: orig.type_amount === 'MINUS' ? 'PLUS' : 'MINUS',
                pb1: orig.pb1, svr_chrg: orig.svr_chrg, surcharge: orig.surcharge, tax3: orig.tax3,
                time: orig.time, bill_to: orig.bill_to, model_type: orig.model_type, model_id: orig.model_id,
                remark: orig.remark, void_code: String(orig.id), is_void: 1,
                is_transfer: orig.is_transfer, is_consolidate: orig.is_consolidate, is_split: orig.is_split,
                is_has_inclusive: orig.is_has_inclusive, is_end_of_day: orig.is_end_of_day,
                status: orig.status, source: orig.source, created_at: new Date(), created_by: req.user?.id ?? null,
              },
            });
          },
          { timeout: 20000 }
        );
      } catch (txErr: any) {
        console.error('Transaction split transaction error:', txErr);
        error(res, 'Failed to split transaction', 500);
        return;
      }

      // @ts-ignore
      await writeAudit(prisma, req, {
        table: 'transactions',
        event: 'updated',
        subjectId: orig.id,
        name: 'transaction-split',
        description: `Transaction #${orig.id} split into ${amountOrigin} + ${remainder} on folio ${orig.folio_id}`,
        logName: 'cashiering',
        old: { total: orig.total, is_split: orig.is_split },
        attributes: { total: orig.total, is_split: 1 },
        meta: {
          split_amount: amountOrigin,
          remainder,
          new_code: calc1.code,
          remark: remark ?? null,
        },
      });

      success(res, { id: Number(orig.id) }, 'Success');
    } catch (err: any) { console.error('Transaction split error:', err); error(res, 'Failed to split transaction', 500); }
  }

  // ==================== BATCH POSTING ====================
static async batchPostingList(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const pid = req.user?.lastProperty ?? 0n;

      const where: any = { property_id: pid, deleted_at: null };
      if (req.query.search) {
        where.description = { contains: String(req.query.search), mode: 'insensitive' };
      }

      // parity TransactionTemp::formatTable (options: folios check-in, code items active)
      const [folioOptions, codeItemOptions] = await Promise.all([
        prisma.folios.findMany({
          where: { status_reservation: STATUS_RESERVATION.check_in.id, deleted_at: null },
          select: { id: true, folio_number: true },
          orderBy: { id: 'desc' },
          take: 100,
        }),
        prisma.code_items.findMany({
          where: { deleted_at: null, status: 1 },
          select: { id: true, name: true, sales: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      const table = [
        {
          label: 'Folio', key: 'folio_id', type: 'select',
          options: folioOptions.map((f: any) => ({ value: Number(f.id), label: f.folio_number })),
          is_search: false,
        },
        { label: 'Date', key: 'date', type: 'none', is_search: false },
        {
          label: 'Item Code', key: 'code_item_id', type: 'select',
          options: codeItemOptions.map((c: any) => ({ value: Number(c.id), label: c.name, amount: moneyFormat(c.sales) })),
          related: ['amount'], is_related: true, is_search: false,
        },
        { label: 'Remark', key: 'description', type: 'text', is_search: true },
        { label: 'Total Amount', key: 'amount', type: 'number', is_search: false },
        { label: 'Staff', key: 'staff', type: 'none', is_search: false },
        { label: 'Overwrite Time', key: 'time', type: 'none', is_search: false },
      ];

      applySearchField(where, req, table, 'transaction_temps');

      const [data, total] = await Promise.all([
        prisma.transaction_temps.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { folios: { select: { folio_number: true } } },
        }),
        prisma.transaction_temps.count({ where }),
      ]);

      const userIds = [...new Set(data.map((d) => d.created_by).filter((x): x is bigint => x !== null))];
      const users = userIds.length > 0
        ? await prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [];
      const userMap = new Map(users.map((u) => [Number(u.id), u.name]));

      const formatted = bigintToNumber(data).map((r: any) => ({
        ...r,
        folio_id: { value: r.folio_id, label: r.folios?.folio_number ?? '' },
        code: { value: r.code_item_id, label: r.code_item_name ?? '' },
        code_item_id: { value: r.code_item_id, label: r.code_item_name ?? '' },
        description: (r.description || '').toUpperCase(),
        total: r.type_amount === 'MINUS' ? -Math.abs(r.total) : r.total,
        amount: r.total,
        staff: r.created_by ? userMap.get(Number(r.created_by)) || '' : '',
        time: r.created_at ? new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
        folios: undefined,
      }));

      success(res, formatted, 'Success', 200, {
        table,
        search_data: dataSearch(req, table) as any,
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Batch posting list error:', err); error(res, 'Failed to list batch postings', 500); }
  }

  // Laravel BatchPostingController@batchPosting parity (:385-428):
  // promote all current user's temps into transactions, then forceDelete temps — atomically.
  static async batchPostingCommit(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const temps = await prisma.transaction_temps.findMany({ where: { created_by: userId, deleted_at: null } });
      if (temps.length === 0) { notFound(res, 'Data not found'); return; }

      await prisma.$transaction(async (tx: any) => {
        for (const t of temps) {
          await tx.transactions.create({
            data: {
              property_id: t.property_id,
              folio_id: t.folio_id,
              type: t.type,
              type_amount: t.type_amount ?? 'PLUS',
              date: t.date,
              code: String(t.code ?? ''),
              code_item_id: t.code_item_id ?? undefined,
              description: t.description,
              overwrite_reason: t.overwrite_reason,
              time: t.time ? new Date(`1970-01-01T${String(t.time).substring(0, 8)}Z`) : undefined,
              bill_to: t.bill_to != null ? String(t.bill_to) : undefined,
              amount: t.amount ?? 0,
              pb1: t.pb1 ?? 0,
              svr_chrg: t.svr_chrg ?? 0,
              tax3: t.tax3 ?? 0,
              total: t.total ?? 0,
              surcharge: t.surcharge ?? 0,
              reference: t.reference,
              pos: t.pos,
              receipt: t.receipt,
              last_digit_card: t.last_digit_card ? Number(t.last_digit_card) : undefined,
              card_name: t.card_name,
              remark: t.remark,
              voucher: t.voucher,
              booking: t.booking,
              status: t.status ?? 1,
              created_at: new Date(),
              created_by: userId ?? null,
            },
          });
        }
        await tx.transaction_temps.deleteMany({ where: { created_by: userId, deleted_at: null } });
      });

      success(res, [], 'Success', 200);
    } catch (err: any) {
      console.error('Batch posting commit error:', err);
      error(res, err?.message ?? 'Failed to commit batch postings', 500);
    }
  }


static async batchPostingStore(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const { transactions: txns } = req.body;
      if (!txns || !Array.isArray(txns) || txns.length === 0) { badRequest(res, 'transactions array is required'); return; }

      const created = [];
      for (const t of txns) {
        // parity Laravel: validate code_item_id, get code_post, calculate charges
        const codeItemId = BigInt(t.code_item_id ?? t.code);
        const codeItem = await prisma.code_items.findUnique({ where: { id: codeItemId }, include: { code_posts: true } });
        if (!codeItem) { badRequest(res, 'Code Item not found'); return; }

        const codePost = codeItem.code_posts;
        const sumPrice = Number(t.amount ?? t.total ?? 0);
        const calc = codePost ? calculateCodePost(
          {
            tax: codePost.tax ?? false,
            tax_percentage: codePost.tax_percentage ? Number(codePost.tax_percentage) : 0,
            local_tax: codePost.local_tax ?? false,
            local_tax_percentage: codePost.local_tax_percentage ? Number(codePost.local_tax_percentage) : 0,
            service_charge: codePost.service_charge ?? false,
            service_charge_percentage: codePost.service_charge_percentage ? Number(codePost.service_charge_percentage) : 0,
            service_charge_include_local_tax: codePost.service_charge_include_local_tax ?? false,
            tax_include_local_tax: codePost.tax_include_local_tax ?? false,
          },
          sumPrice,
          false
        ) : { amount: sumPrice, service: 0, tax3: 0, pb1: 0, total: sumPrice };

        const businessDate = await AuthController.getBusinessDate(pid);

        const data = await prisma.transaction_temps.create({
          data: {
            property_id: pid,
            folio_id: BigInt(t.folio_id),
            type: 'manual_posting',
            type_amount: 'PLUS',
            date: new Date(businessDate),
            code: codePost ? BigInt(codePost.id) : BigInt(t.code),
            code_item_id: codeItemId,
            description: t.description,
            overwrite_reason: t.overwrite_reason,
            time: t.time,
            bill_to: t.bill_to ? Number(t.bill_to) : null,
            reference: t.reference,
            pos: t.pos,
            receipt: t.receipt,
            last_digit_card: t.last_digit_card,
            card_name: t.card_name,
            remark: t.remark,
            voucher: t.voucher,
            booking: t.booking,
            amount: calc.amount,
            svr_chrg: calc.service,
            tax3: calc.tax3,
            pb1: calc.pb1,
            total: calc.total,
            rate: sumPrice,
            surcharge: 0,
            gst: 0,
            status: 1,
            created_at: new Date(),
            created_by: req.user?.id ?? null,
          },
        });
        created.push(data);
      }
      success(res, bigintToNumber(created), 'Batch posting created', 200);
    } catch (err: any) { console.error('Batch posting error:', err); error(res, 'Failed to create batch posting', 500); }
  }

  // GET /transaction/print — Laravel TransactionController@print (:50-57): decrypt
  // AES folio_id query param then delegate to the list handler.
  static async transactionPrint(req: Request, res: Response): Promise<void> {
    try {
      const raw = req.query.folio_id as string | undefined;
      if (raw) {
        let folioId = raw;
        try { folioId = decrypt(raw); } catch { /* plain id passthrough */ }
        if (/^\d+$/.test(folioId.trim())) {
          req.query.folio_id = folioId.trim();
        }
      }
      return await FrontDeskController.transactionList(req, res);
    } catch (err: any) { console.error('Transaction print error:', err); error(res, 'Failed to print transactions', 500); }
  }

  // DELETE /batch-posting/:id — soft delete + status inactive (= BatchPostingController@destroy :328)
  static async batchPostingDestroy(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.transaction_temps.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.transaction_temps.update({ where: { id: row.id }, data: { deleted_at: new Date(), status: 0 } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('Batch posting destroy error:', err); error(res, 'Failed to delete batch posting', 500); }
  }

  // DELETE /batch-posting/:id/delete — force delete (= BatchPostingController@delete :346)
  static async batchPostingDeleteForce(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.transaction_temps.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.transaction_temps.delete({ where: { id: row.id } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('Batch posting force-delete error:', err); error(res, 'Failed to delete batch posting', 500); }
  }

  // PATCH /batch-posting/:id/restore — restore + status inactive (= BatchPostingController@restore :367)
  static async batchPostingRestore(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const row = await prisma.transaction_temps.findUnique({ where: { id: BigInt(idParam) } });
      if (!row) { notFound(res, 'Not Found'); return; }
      await prisma.transaction_temps.update({ where: { id: row.id }, data: { deleted_at: null, status: 0 } });
      success(res, [], 'Success', 200);
    } catch (err: any) { console.error('Batch posting restore error:', err); error(res, 'Failed to restore batch posting', 500); }
  }

  // ==================== DEPOSIT ====================
  static async depositList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePaginationFn(req.query);

      const paymentsWhere: any = { deleted_at: null };
      const eventsWhere: any = {};

      const [payments, events, totalPayments, totalEvents] = await Promise.all([
        prisma.deposit_payments.findMany({ where: paymentsWhere, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.deposit_events.findMany({ where: eventsWhere, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.deposit_payments.count({ where: paymentsWhere }),
        prisma.deposit_events.count({ where: eventsWhere }),
      ]);

      success(res, { payments: bigintToNumber(payments), events: bigintToNumber(events) }, 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil((totalPayments + totalEvents) / 2 / limit), per_page: limit, total: totalPayments + totalEvents, from: (page - 1) * limit + 1, to: Math.min(page * limit, totalPayments + totalEvents) },
      });
    } catch (err: any) { console.error('Deposit list error:', err); error(res, 'Failed to list deposits', 500); }
  }

  // ==================== SHIFT ====================
  static async shiftList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePaginationFn(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid, deleted_at: null };

      const [data, total] = await Promise.all([
        prisma.shifts.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit, include: { users: { select: { name: true } } } }),
        prisma.shifts.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Shift list error:', err); error(res, 'Failed to list shifts', 500); }
  }

  static async shiftStart(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id ?? 0n;
      const bussinesDate = await AuthController.getBusinessDate(pid);

      // PHP stores date as DATE column ('2026-08-22'), not DATETIME.
      // Use raw SQL to avoid timezone issues with JS Date objects.
      const existing = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
        `SELECT COUNT(*)::int AS cnt FROM shifts
         WHERE user_id = $1 AND property_id = $2
           AND date::date = $3::date AND "end" IS NULL AND deleted_at IS NULL`,
        userId, pid, bussinesDate,
      );
      if (Number(existing?.[0]?.cnt ?? 0) > 0) { badRequest(res, 'Shift already started for today'); return; }

      // Create shift record — store date as UTC midnight to match date::date comparison
      const day = new Date(bussinesDate + 'T00:00:00Z');
      await prisma.shifts.create({
        data: { property_id: pid, user_id: userId, start: new Date(), date: day, status: 0, created_at: new Date(), created_by: userId },
      });

      // PHP parity: return full login data with new token + is_shift: true
      const user = await prisma.users.findUnique({ where: { id: userId } });
      if (!user) { error(res, 'User not found', 404); return; }

      const modelRoles = await prisma.model_has_roles.findMany({
        where: { model_id: userId, model_type: 'App\\Models\\User' },
        include: { roles: true },
      });
      const roleNames = modelRoles.map((mr: any) => mr.roles.name);
      const roleIds = modelRoles.map((mr: any) => mr.roles.id);

      // Generate new token (PHP: $user->createToken(...))
      const { plainTextToken, createdAt } = await TokenService.createToken(userId, user.email);

      const loginData = await AuthController.buildLoginData(user, roleIds, roleNames, plainTextToken, createdAt, pid);

      // PHP ShiftController::start() returns { code, message, name, image, data }
      // where name/image are PROPERTY name/image at top level
      const property = await prisma.properties.findUnique({ where: { id: pid } });
      const propertyName = (property as any)?.name ?? '';
      const storedLogo = storedImageUrl((property as any)?.logo);
      // storedImageUrl() -> null for legacy base64 columns, so this no longer
      // emits APP_URL + '/storage' + <base64>. Swap in the id-based fallback so
      // the shift-start payload still carries a usable image.
      const propertyImage = storedLogo
        ? `${process.env.APP_URL || ''}${storedLogo}`
        : `${process.env.APP_URL || ''}/cms/property/${pid}/image`;

      const payload = {
        code: 200,
        message: 'Success',
        name: propertyName,
        image: propertyImage,
        data: loginData,
      };

      const body = JSON.stringify(payload);
      const encrypted = encrypt(body);
      res.status(200).type('text/plain').send(encrypted);
    } catch (err: any) { console.error('Shift start error:', err); error(res, 'Failed to start shift', 500); }
  }

  static async shiftEnd(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const userId = req.user?.id;
      const bussinesDate = await AuthController.getBusinessDate(pid);

      const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
        `SELECT id FROM shifts
         WHERE user_id = $1 AND property_id = $2
           AND date::date = $3::date AND "end" IS NULL AND deleted_at IS NULL
         LIMIT 1`,
        userId, pid, bussinesDate,
      );
      if (!rows?.length) { badRequest(res, 'No active shift found'); return; }

      // Laravel sets ONLY `end` here (:452-456) — writing is_posting=true would
      // weaken the night-audit close guard.
      await prisma.shifts.update({ where: { id: rows[0].id }, data: { end: new Date(), updated_at: new Date(), updated_by: userId } });
      success(res, null, 'Shift ended');
    } catch (err: any) { console.error('Shift end error:', err); error(res, 'Failed to end shift', 500); }
  }

  // ==================== SHIFT ROSTER ====================
  static async shiftRosterList(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const data = await prisma.shift_roster.findMany({ where: { property_id: pid, deleted_at: null }, orderBy: { id: 'desc' } });
      success(res, bigintToNumber(data), 'Success');
    } catch (err: any) { console.error('Shift roster list error:', err); error(res, 'Failed to list shift rosters', 500); }
  }

  // ==================== DOOR LOCK ====================
  static async doorLockList(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePaginationFn(req.query);
      const pid = req.user?.lastProperty ?? 0n;
      const where: any = { property_id: pid };

      const [data, total] = await Promise.all([
        prisma.doorlock_configs.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.doorlock_configs.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, {
        pagination: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total, from: (page - 1) * limit + 1, to: Math.min(page * limit, total) },
      });
    } catch (err: any) { console.error('Door lock list error:', err); error(res, 'Failed to list door locks', 500); }
  }

  // GET /api/front-desk/:id
  static async show(req: Request, res: Response): Promise<void> {
    try {
      const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (idParam === undefined || !/^\d+$/.test(String(idParam))) {
        notFound(res, 'Not Found');
        return;
      }
      const id = BigInt(idParam);

const folio = await prisma.folios.findUnique({
        where: { id },
        include: {
          reservations: { 
            where: { deleted_at: null }, 
            orderBy: { date: 'asc' },
            include: { rooms: { select: { name: true } } }
          },
          properties: { select: { name: true } },
        },
      });

      if (!folio || folio.deleted_at) {
        notFound(res, 'Not Found');
        return;
      }

      let guestName = `${folio.first_name || ''} ${folio.last_name || ''}`.trim();
      if (!guestName && folio.guest_profile_id) {
        const gp = await prisma.guest_profiles.findUnique({ where: { id: folio.guest_profile_id } });
        if (gp) guestName = `${gp.first_name || ''} ${gp.last_name || ''}`.trim();
      }

      const lastReservation = folio.reservations?.[folio.reservations.length - 1];

      // Laravel Folio@getBalance parity: MINUS subtracts, GIT variants
      const balance = await folioBalanceDisplay(folio);

const data = {
        id: Number(folio.id),
        folio_number: folio.folio_number,
        guest_name: guestName || '-',
        room: lastReservation?.rooms?.name || lastReservation?.room_name || '',
        room_type: lastReservation?.room_type_name || '',
        check_in_date: folio.check_in_date,
        check_out_date: folio.check_out_date,
        company: folio.company_name || '',
        balance: balance.toLocaleString('id-ID', { minimumFractionDigits: 2 }),
        status_reservation: folio.status_reservation,
        type_reservation: folio.type_reservation,
        status_reservation_color: statusReservationColor(folio),
      };

      success(res, data, 'Success');
    } catch (err: any) {
      console.error('FrontDesk show error:', err);
      error(res, 'Failed to fetch folio detail', 500);
    }
  }
}

