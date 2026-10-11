import { prisma } from '../../config/prisma';
import { handleSuccessfulPayment } from './syncCheckStatusBookingEngine';

/**
 * Reconciliation for booking-engine payments.
 *
 * `syncCheckStatusBookingEngine` only looks at folios with `is_payment_booking_engine`
 * still set, and it stops looking the moment that flag is cleared. The flag is cleared
 * on success (correct) and on expiry (also correct — nobody paid), but the booking
 * engine clears the *reservation* in a third case that leaves the money unaccounted:
 *
 *   Laravel PaymentController::payment creates the Xendit invoice (:164) and only then
 *   calls `syncReservationData` (:183). If that push to HMS fails, the guest is already
 *   holding a live `invoice_url` but HMS has no charge for it. Once the invoice expires,
 *   the status job parks the folio on `cancel_reservation` and drops the flag — so
 *   nothing ever asks again.
 *
 * Measured state of that failure, folio 47427:
 *
 *   folio_number F99926100004, booking_engine_uuid 814bf4c1-…, total_amount 499000
 *   reservations        1 row
 *   transactions        0 rows
 *   model_has_code_items 0 rows
 *
 * A retry would only hide the symptom, and the flag is the thing that makes the symptom
 * invisible: patching `syncReservationData` still leaves every folio that already fell
 * through unreconciled, with no signal that any of it happened. So this job does not
 * retry anything. It asks the booking engine what Xendit says about every
 * booking-engine folio that has no charge on it, regardless of the pending flag, and
 * books the payment when the money is real.
 *
 * The booking engine is asked rather than Xendit directly so the API key stays in the
 * one place that already has it (`hmsBookingEngine` `.env`) — this repo has no
 * XENDIT_API_KEY and adding a second copy of a payment credential is not worth saving
 * one HTTP hop.
 */
export async function processReconcileBookingEnginePayments(_job: any) {
  const baseUrl = process.env.BOOKING_ENGINE_URL;
  if (!baseUrl) {
    console.error('[ReconcileBookingEnginePayments] BOOKING_ENGINE_URL not configured');
    return 'error';
  }

  // Bounded per run. An unbounded sweep would hold a Prisma connection for as long as the
  // slowest guest's HTTP timeout, and the queue shares its pool with the HTTP server
  // (see config/queue.ts poolSize).
  const BATCH = 20;

  // Newest first, deliberately.
  //
  // 190 booking-engine folios have no transaction on them and all of them sit on
  // `status_reservation = 2` — cancelled because their invoice expired unpaid. Xendit
  // keeps answering `expired` for those and they will never gain a charge, so they are
  // permanent candidates. Ordering by id ASC with a LIMIT would therefore ask about the
  // same 20 dead folios every hour and never reach folio 47427 or any newer failure.
  // Newest-first means the folios that can still become a real loss are always in the
  // batch, and the long-dead ones age out of it.
  const folios: any[] = await prisma.$queryRaw`
    SELECT f.id
    FROM folios f
    WHERE f.is_booking_engine IS TRUE
      AND f.deleted_at IS NULL
      AND f.booking_engine_uuid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.folio_id = f.id)
    ORDER BY f.id DESC
    LIMIT ${BATCH}
  `;

  if (!folios.length) return 'nothing to reconcile';

  let booked = 0;
  let paidButUnbookable = 0;
  const unresolved: string[] = [];

  for (const { id } of folios) {
    const folio: any = await prisma.folios.findUnique({ where: { id: Number(id) } });
    if (!folio) continue;

    // Re-check inside the loop, not just in the SQL: the query above ran before these
    // HTTP calls, and handleSuccessfulPayment may already have booked a different folio
    // for the same booking in between. A second MINUS transaction for one payment is
    // worse than a missed one.
    const alreadyCharged = await prisma.transactions.findFirst({
      where: { folio_id: folio.id, type: 'payment', type_amount: 'MINUS' },
      select: { id: true },
    });
    if (alreadyCharged) continue;

    let status: string | null = null;
    let decoded: any = null;
    try {
      const res: any = await fetch(`${baseUrl}/webhook/check-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: folio.booking_engine_uuid }),
      });
      const raw = await res.text();
      try {
        const { decrypt } = await import('../../utils/encryption');
        decoded = JSON.parse(decrypt(raw));
      } catch {
        try {
          decoded = JSON.parse(raw);
        } catch {
          decoded = null;
        }
      }
      status = decoded?.data?.status ?? null;
    } catch (err: any) {
      console.error(
        `[ReconcileBookingEnginePayments] folio ${folio.folio_number ?? folio.id}: booking engine unreachable —`,
        err?.message,
      );
      continue;
    }

    if (status !== 'success') {
      // pending / expired / unreadable. Not an error: an unpaid folio correctly has no
      // charge. Recorded so the next run can tell "nothing happened" from "stuck".
      unresolved.push(`${folio.folio_number ?? folio.id}:${status ?? 'unreadable'}`);
      continue;
    }

    try {
      await handleSuccessfulPayment(folio, decoded);
      booked += 1;
      console.warn(
        `[ReconcileBookingEnginePayments] booked payment for folio ${folio.folio_number ?? folio.id} ` +
          `(uuid ${folio.booking_engine_uuid}) — it had no charge on it.`,
      );
    } catch (err: any) {
      console.error(
        `[ReconcileBookingEnginePayments] folio ${folio.folio_number ?? folio.id}: PAID at Xendit but booking the charge failed —`,
        err?.message,
      );
      paidButUnbookable += 1;
    }
  }

  if (unresolved.length) {
    console.log(`[ReconcileBookingEnginePayments] still waiting on ${unresolved.length}: ${unresolved.join(', ')}`);
  }
  if (paidButUnbookable) {
    // Money is in and the ledger does not show it. This is the case that must not pass
    // quietly — it needs a human to look at the folio.
    console.error(
      `[ReconcileBookingEnginePayments] ${paidButUnbookable} folio(s) are PAID at Xendit with no charge booked. ` +
        'Front desk has to settle them by hand; see OPTIMIZE-BE-HMS.md.',
    );
  }

  return booked || paidButUnbookable ? 'reconciled' : 'nothing to reconcile';
}