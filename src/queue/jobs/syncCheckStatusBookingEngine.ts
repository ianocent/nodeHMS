import { prisma } from '../../config/prisma';
// Laravel Jobs/SyncCheckStatusBookingEngine.php parity — polls the Booking
// Engine for pending payment folios (is_payment_booking_engine=1), books the
// payment as a MINUS transaction on success, cancels the folio on expiry.
// Confirmation emails/PDF generation are not ported (no mail infra in node yet).
import { calculateCodePost } from '../../utils/cmsConfig';
import { sendBookingConfirmationEmails } from '../../services/mail.service';
import { issuePreRegistrationLink } from '../../services/preRegistrationLink.service';
import { notifyPaymentConfirmed } from '../../services/guestEvents.service';


export async function processSyncCheckStatusBookingEngine(_job: any) {
  const baseUrl = process.env.BOOKING_ENGINE_URL;
  if (!baseUrl) {
    console.error('[SyncCheckStatusBookingEngine] BOOKING_ENGINE_URL not configured');
    return 'error';
  }

  const folios = await prisma.folios.findMany({
    where: { is_payment_booking_engine: true },
    take: 5,
    orderBy: { id: 'asc' },
  });
  if (!folios.length) return 'no folio';

  for (const folio of folios) {
    try {
      if (!folio.booking_engine_uuid) continue;

      const res: any = await fetch(`${baseUrl}/webhook/check-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid: folio.booking_engine_uuid }),
      });
      const raw = await res.text();
      let decoded: any;
      try {
        // BE answers AES-encrypted like Laravel expects (decryptAES); fall back to plain JSON.
        const { decrypt } = await import('../../utils/encryption');
        decoded = JSON.parse(decrypt(raw));
      } catch {
        try {
          decoded = JSON.parse(raw);
        } catch {
          console.error('[SyncCheckStatusBookingEngine] unreadable response for', folio.folio_number);
          continue;
        }
      }
      if (decoded?.code !== 200 && res.status !== 200) continue;
      const status = decoded?.data?.status;

      if (status === 'success') {
        await handleSuccessfulPayment(folio, decoded);

        // Laravel sendConfirmationEmails (:349-421) — guest + hotel confirmation.
        // SMTP dibaca dari env (lihat services/mail.service.ts); skip aman bila kosong.
        //
        // Issue the guest's pre-registration link first: the mail is the only place the
        // token ever reaches them, and the token has to exist before the mail renders.
        let preRegistrationUrl: string | null = null;
        try {
          const link = await issuePreRegistrationLink(folio as any);
          preRegistrationUrl = link?.url ?? null;
          if (!link) {
            console.warn(
              `[SyncCheckStatusBookingEngine] folio ${folio.folio_number ?? folio.id}: no pre-registration link issued`
            );
          }
        } catch (linkErr: any) {
          // Never let the link failure cost the guest their confirmation mail.
          console.error('[SyncCheckStatusBookingEngine] pre-registration link failed:', linkErr?.message);
        }

        let propertyName = 'Hotel';
        try {
          const property: any = await prisma.properties.findUnique({
            where: { id: folio.property_id },
            select: { name: true },
          });
          propertyName = property?.name ?? 'Hotel';
          await sendBookingConfirmationEmails(
            folio,
            propertyName,
            undefined,
            preRegistrationUrl ?? undefined
          );
        } catch (mailErr: any) {
          console.error('[SyncCheckStatusBookingEngine] confirmation email failed:', mailErr?.message);
        }

        // Push it to the guest's open tabs. Last, because everything above is a
        // durable side effect that must happen whether or not anyone is listening —
        // `delivered: 0` is the normal case for a guest who has navigated away, and
        // their next poll finds the same folio.
        try {
          const delivered = await notifyPaymentConfirmed({
            email: folio.email,
            folioNumber: folio.folio_number,
            propertyName,
            checkInDate: folio.check_in_date,
            checkOutDate: folio.check_out_date,
            preRegistrationUrl,
          });
          if (delivered > 0) {
            console.log(
              `[SyncCheckStatusBookingEngine] folio ${folio.folio_number ?? folio.id}: pushed to ${delivered} open tab(s)`
            );
          }
        } catch (eventErr: any) {
          // Never let the notification bus cost the guest their payment booking or mail.
          console.error('[SyncCheckStatusBookingEngine] guest notification failed:', eventErr?.message);
        }
      } else if (status === 'expired') {
        // Expired: clear pending flag + cancel the reservation.
        // (Laravel writes int flags 2/3 into one column; node schema keeps a
        // boolean flag, so the numeric state lives in folios.data.be_status.)
        const dataObj = safeParse(folio.data) ?? {};
        await prisma.folios.update({
          where: { id: folio.id },
          data: {
            is_payment_booking_engine: false,
            status_reservation: 2,
            data: JSON.stringify({ ...dataObj, be_status: 3 }),
            updated_at: new Date(),
          },
        });
      }
    } catch (err: any) {
      console.error(`[SyncCheckStatusBookingEngine] folio ${folio.id} error:`, err?.message);
    }
  }
  return 'success';
}

/**
 * Book a paid booking-engine payment onto its folio.
 *
 * Exported because reconcileBookingEnginePayments.ts calls it for folios this job never
 * looked at (see that file for why the pending flag is not enough).
 *
 * Throws rather than returning early when the ledger cannot be written. An early return
 * here used to commit the folio update on its own — the folio got flagged paid with no
 * transaction against it, which is the exact failure reconciliation exists to catch, so
 * it must not be reachable from here. Rolling the folio update back keeps the pair
 * together: either both land or the folio stays flagged pending for the next run.
 */
export async function handleSuccessfulPayment(folio: any, checkStatus: any) {
  await prisma.$transaction(async (tx: any) => {
    // Laravel writes flag=2 (success); node keeps boolean pending flag + numeric
    // state in folios.data.be_status.
    const dataObj = safeParse(folio.data) ?? {};
    await tx.folios.update({
      where: { id: folio.id },
      data: {
        is_payment_booking_engine: false,
        data: JSON.stringify({ ...dataObj, be_status: 2 }),
        updated_at: new Date(),
      },
    });

    const propertyId = Number(folio.property_id);

    // Payment type: PaymentMatrix by xendit channel, else a "*ledger*" TypePayment.
    let paymentType: any = null;
    const channel = checkStatus?.data?.payment_channel;
    if (channel) {
      // Two queries, not an include: `payment_matrices` has no declared relation to
      // `type_payments` in schema.prisma (only the `payment_type_id` column), so
      // `include: { type_payments: true }` throws
      //   Unknown field `type_payments` for include statement on model `payment_matrices`
      // The moment Xendit reports a channel — which is exactly the moment a payment
      // succeeds — so this line made the whole success path unreachable and the
      // transaction never committed.
      const matrix = await tx.payment_matrices.findFirst({
        where: { property_id: BigInt(propertyId), payment_xendit_type: String(channel), deleted_at: null },
        select: { payment_type_id: true },
      });
      if (matrix?.payment_type_id) {
        paymentType = await tx.type_payments.findFirst({
          where: { id: BigInt(matrix.payment_type_id), deleted_at: null },
        });
      }
    }
    if (!paymentType || !paymentType.code_post_id) {
      // `mode: 'insensitive'` because the only ledger account on property 999 is named
      // "CITY LEDGER" — Prisma's `contains` is case-sensitive, so `contains: 'ledger'`
      // matched nothing and this fallback silently never ran. A channel with no
      // PaymentMatrix row (GCASH, OVO, anything new Xendit adds) depends entirely on it.
      paymentType = await tx.type_payments.findFirst({
        where: {
          property_id: BigInt(propertyId),
          name: { contains: 'ledger', mode: 'insensitive' },
          status: 1,
          deleted_at: null,
        },
      });
    }
    if (!paymentType || !paymentType.code_post_id) {
      // No ledger account to post to: refuse loudly instead of flagging the folio paid
      // and writing nothing. See the note above handleSuccessfulPayment.
      throw new Error(
        `folio ${folio.folio_number ?? folio.id}: no payment type with a code_post for property ` +
          `${folio.property_id} (channel "${channel ?? 'unknown'}") — payment not booked`,
      );
    }

    // Amounts: folio total_amount + add-ons from folio.data.addOnBO.
    const addOnBO: any[] = Array.isArray(dataObj?.addOnBO) ? dataObj.addOnBO : [];
    let totalAmount = Number(folio.total_amount ?? 0);
    for (const addOn of addOnBO) {
      if (Number(addOn.qty ?? 0) < 1) continue;
      totalAmount += Number(addOn.qty) * Number(addOn.sales ?? 0);
    }

    // Surcharge flat (type 1) or percent.
    const surcharge =
      Number(paymentType.surcharge_type) === 1
        ? Number(paymentType.surcharge ?? 0)
        : totalAmount * (Number(paymentType.surcharge ?? 0) / 100);

    const codePost = await tx.code_posts.findUnique({ where: { id: BigInt(paymentType.code_post_id) } });
    const calc = codePost
      ? calculateCodePost(
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
          totalAmount,
          false
        )
      : null;

    // Transaction date = next business date (LogAudit latest date + 1 day).
    const logAudit = await tx.log_audits.findFirst({
      where: { property_id: propertyId },
      orderBy: { date: 'desc' },
    });
    const txnDate = logAudit?.date ? new Date(new Date(logAudit.date).getTime() + 86400000) : new Date();

    const amount = totalAmount - surcharge;
    await tx.transactions.create({
      data: {
        type: 'payment',
        folio_id: folio.id,
        date: txnDate,
        code: String(codePost?.id ?? ''),
        type_payment_id: BigInt(paymentType.id),
        amount,
        total: Number(calc?.total ?? 0),
        pb1: 0,
        tax3: 0,
        surcharge,
        svr_chrg: 0,
        type_amount: 'MINUS',
        is_posting: 1,
        is_end_of_day: 0,
        is_endshift: 1,
        status: 1,
        property_id: BigInt(propertyId),
        created_at: new Date(),
      },
    });

    // Add-ons -> model_has_code_items (@@ignore table, raw SQL like Laravel DB::table insert).
    for (const addOn of addOnBO) {
      const qty = Number(addOn.qty ?? 0);
      if (qty < 1 || !addOn.id) continue;
      const codeItem: any = await tx.code_items.findUnique({ where: { id: BigInt(addOn.id) } });
      if (!codeItem) continue;
      await tx.$executeRaw`
        INSERT INTO model_has_code_items
          (model_id, model_type, code_item_id, reason, start_date, end_date, sales, process_on, code_post_id, upsales, name, description)
        VALUES
          (${folio.id}, ${'App\\Models\\Folio'}, ${BigInt(addOn.id)}, '',
           ${folio.check_in_date ?? new Date()}, ${folio.check_out_date ?? new Date()},
           ${Number(codeItem.sales ?? 0) * qty}, ${codeItem.process_on ?? null},
           ${codeItem.code_post_id ? Number(codeItem.code_post_id) : null},
           '', ${`${codeItem.name ?? ''}(${qty})`}, ${codeItem.description ?? null})
      `;
    }
  });
}

function safeParse(v: any): any {
  if (v && typeof v === 'object') return v;
  try {
    return v ? JSON.parse(String(v)) : null;
  } catch {
    return null;
  }
}
