// Laravel Jobs/SyncCheckStatusBookingEngine.php parity — polls the Booking
// Engine for pending payment folios (is_payment_booking_engine=1), books the
// payment as a MINUS transaction on success, cancels the folio on expiry.
// Confirmation emails/PDF generation are not ported (no mail infra in node yet).
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { calculateCodePost } from '../../utils/cmsConfig';
import { sendBookingConfirmationEmails } from '../../services/mail.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
        try {
          const property: any = await prisma.properties.findUnique({
            where: { id: folio.property_id },
            select: { name: true },
          });
          await sendBookingConfirmationEmails(folio, property?.name ?? 'Hotel');
        } catch (mailErr: any) {
          console.error('[SyncCheckStatusBookingEngine] confirmation email failed:', mailErr?.message);
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

async function handleSuccessfulPayment(folio: any, checkStatus: any) {
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
      const matrix = await tx.payment_matrices.findFirst({
        where: { property_id: BigInt(propertyId), payment_xendit_type: String(channel), deleted_at: null },
        include: { type_payments: true },
      });
      paymentType = matrix?.type_payments ?? null;
    }
    if (!paymentType || !paymentType.code_post_id) {
      paymentType = await tx.type_payments.findFirst({
        where: { property_id: BigInt(propertyId), name: { contains: 'ledger' }, status: 1, deleted_at: null },
      });
    }
    if (!paymentType || !paymentType.code_post_id) return;

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
      where: { property_id: BigInt(propertyId) },
      orderBy: { date: 'desc' },
    });
    const txnDate = logAudit?.date ? new Date(new Date(logAudit.date).getTime() + 86400000) : new Date();

    const amount = totalAmount - surcharge;
    await tx.transactions.create({
      data: {
        type: 'payment',
        folio_id: folio.id,
        folio_no: folio.folio_number ?? null,
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
