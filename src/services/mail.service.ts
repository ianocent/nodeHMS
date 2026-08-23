// Mail service — SMTP config placeholder untuk email konfirmasi Booking Engine
// (Laravel SyncCheckStatusBookingEngine::sendConfirmationEmails).
//
// Isi env berikut untuk mengaktifkan (jika semua kosong, email di-skip aman):
//   SMTP_HOST=smtp.example.com
//   SMTP_PORT=587
//   SMTP_SECURE=false          # true untuk port 465
//   SMTP_USER=no-reply@example.com
//   SMTP_PASS=secret
//   MAIL_FROM_NAME=Hotel Name
//   MAIL_FROM_ADDRESS=no-reply@example.com
//
// Renderer membutuhkan paket `nodemailer`:
//   npm install nodemailer
// Bila paket/env tidak tersedia, sendMail hanya mencatat log dan mengembalikan false.

export const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: process.env.MAIL_FROM_NAME || 'HMS Anyaman',
  fromAddress: process.env.MAIL_FROM_ADDRESS || 'no-reply@localhost',
};

export function smtpConfigured(): boolean {
  return Boolean(SMTP_CONFIG.host && SMTP_CONFIG.user && SMTP_CONFIG.pass);
}

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  attachmentName?: string;
  pdfBuffer?: Buffer;
}

export async function sendMail(payload: MailPayload): Promise<boolean> {
  if (!smtpConfigured()) {
    console.log(`[mail] skipped (SMTP not configured): "${payload.subject}" -> ${payload.to}`);
    return false;
  }

  let nodemailer: any;
  try {
    nodemailer = require('nodemailer');
  } catch {
    console.error('[mail] nodemailer tidak terpasang. Jalankan: npm install nodemailer');
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_CONFIG.host,
      port: SMTP_CONFIG.port,
      secure: SMTP_CONFIG.secure,
      auth: { user: SMTP_CONFIG.user, pass: SMTP_CONFIG.pass },
    });

    const attachments = payload.pdfBuffer
      ? [{ filename: payload.attachmentName ?? 'attachment.pdf', content: payload.pdfBuffer, contentType: 'application/pdf' }]
      : [];

    await transporter.sendMail({
      from: `"${SMTP_CONFIG.fromName}" <${SMTP_CONFIG.fromAddress}>`,
      to: payload.to.trim(),
      subject: payload.subject,
      html: payload.html,
      attachments,
    });
    return true;
  } catch (err: any) {
    console.error('[mail] send failed:', err?.message);
    return false;
  }
}

// Simple booking-confirmation templates (Laravel blade shortCodes diganti inline).
function esc(v: any): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendBookingConfirmationEmails(
  folio: { email?: string | null; first_name?: string | null; last_name?: string | null; folio_number?: string | null },
  hotelName: string,
  pdfBuffer?: Buffer
): Promise<void> {
  const guestName = `${folio.first_name ?? ''} ${folio.last_name ?? ''}`.trim();
  if (folio.email) {
    await sendMail({
      to: folio.email,
      subject: 'Booking Confirmation',
      html: `<p>Dear ${esc(guestName)},</p><p>Your booking <strong>${esc(folio.folio_number ?? '')}</strong> at <strong>${esc(hotelName)}</strong> has been confirmed. Please find the confirmation letter attached.</p>`,
      attachmentName: `booking-confirmation-${folio.folio_number ?? 'guest'}.pdf`,
      pdfBuffer,
    });
  }
}

// EmailBuilder template dispatch (Laravel Folio.php:1408-1419 / 1811-1820 parity):
// look up email_builders by template_name, render body HTML raw (blade view
// wraps it in a minimal HTML shell), send to the guest. Never throws —
// Laravel swallows Throwable too.
export async function sendTemplateEmail(
  prisma: any,
  templateName: string,
  to: string | null | undefined,
  fallbackSubject = templateName,
  fallbackBody = ''
): Promise<boolean> {
  if (!to || !String(to).trim()) return false;
  let subject = fallbackSubject;
  let html = fallbackBody;
  try {
    const tpl: any = await prisma.email_builders.findFirst({
      where: { template_name: templateName, deleted_at: null },
      select: { subject: true, body: true },
    });
    if (tpl) {
      subject = tpl.subject ?? fallbackSubject;
      html = tpl.body ?? fallbackBody;
    } else if (!html) {
      // Laravel check-in path sends nothing when the template is absent
      return false;
    }
  } catch {
    // template lookup failed — fall through with fallback content
  }
  const wrapped = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(subject)}</title></head><body><div style="font-family: Helvetica,Arial,sans-serif;min-width:1000px;overflow:auto;line-height:2"><div style="padding:20px 0">${html}</div></div></body></html>`;
  try {
    return await sendMail({ to, subject, html: wrapped });
  } catch (err: any) {
    console.error(`[mail] ${templateName} dispatch failed:`, err?.message);
    return false;
  }
}
