// Folio documents ×9 — port of Laravel Report/Batch/Folio/*Controller (SnappyPDF
// + blade views) rendered via puppeteer renderPdf. Each builder mirrors the
// standard blade layout sections; property 1002/1003 "-olive" variants share the
// same data with minor label differences folded into the standard layout.
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, notFound, badRequest } from '../../utils/response';
import { renderPdf } from './excel';
import { AuthController } from '../auth.controller';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export const FOLIO_DOCUMENT_TYPES = [
  'pre-registration',
  'registration-form',
  'guest-folio',
  'letter-of-aggrement',
  'confirmation',
  'guest-invoice',
  'proforma-invoice',
  'company-invoice',
  'official-receipt',
] as const;

type FolioDocumentType = (typeof FOLIO_DOCUMENT_TYPES)[number];

function esc(v: any): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtD(d: any): string {
  if (!d) return '-';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
}

function fmtDM(d: any): string {
  if (!d) return '-';
  const x = new Date(d);
  return `${fmtD(d)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

function money(v: any): string {
  return Number(v ?? 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface DocContext {
  folio: any;
  property: any;
  guest: any;
  company: any;
  reservations: any[];
  lastReservation: any;
  transactions: any[];
  inclusivesByReservation: Map<number, { name: string; pax: number; is_room?: boolean }[]>;
}

async function loadFolioDocContext(folioId: bigint): Promise<DocContext | null> {
  const folio: any = await prisma.folios.findUnique({
    where: { id: folioId },
    include: {
      guest_profiles: true,
      reservations: {
        where: { deleted_at: null },
        orderBy: { date: 'asc' },
        include: {
          rooms: { select: { name: true } },
          room_types: { select: { name: true } },
          rates: { select: { id: true, name: true } },
        },
      },
      transactions: {
        where: { deleted_at: null },
        orderBy: { date: 'asc' },
        include: {
          type_payments: { select: { name: true } },
        },
      },
    },
  });
  if (!folio || folio.deleted_at) return null;

  const pid = Number(folio.property_id);
  const property = await prisma.properties.findUnique({ where: { id: BigInt(pid) } });
  const company = folio.company_profile_id
    ? await prisma.company_profiles.findUnique({
        where: { id: BigInt(folio.company_profile_id) },
        select: { name: true, account: true, billing_address: true, telp: true },
      })
    : null;

  let bussinesDate = '';
  try {
    bussinesDate = await AuthController.getBusinessDate(BigInt(pid));
  } catch { /* fallback below */ }
  const bd = bussinesDate ? new Date(`${bussinesDate}T00:00:00`) : null;

  const reservations = folio.reservations ?? [];
  const lastReservation =
    reservations.find((r: any) => bd && r.date && new Date(r.date).toISOString().slice(0, 10) === bd.toISOString().slice(0, 10)) ||
    reservations[reservations.length - 1] ||
    null;

  // Inclusive pax rows (Laravel PreRegistrationController :33-100):
  // frequency Daily always, Once once, Twice up to twice × calculator adult/child/room.
  const inclusivesByReservation = new Map<number, { name: string; pax: number; is_room?: boolean }[]>();
  const rateIds = [...new Set(reservations.map((r: any) => Number(r.rate_id)).filter(Boolean))] as number[];
  if (rateIds.length) {
    const incRows = await prisma.rate_inclusives.findMany({
      where: { rate_id: { in: rateIds.map((id) => BigInt(id)) }, deleted_at: null },
      select: { rate_id: true, frequency: true, cost: true, stock: true },
    });
    const ciIds = [...new Set(incRows.map((i) => i.stock).filter((s): s is string => !!s && /^\d+$/.test(s)))].map((s) => BigInt(s));
    const ciRows = ciIds.length
      ? await prisma.code_items.findMany({ where: { id: { in: ciIds } }, select: { id: true, name: true, calculator: true } })
      : [];
    const ciById = new Map(ciRows.map((c) => [Number(c.id), c]));
    // count Once/Twice occurrences per rate like the Laravel closure counters
    const seenOnce = new Map<number, number>();
    const seenTwice = new Map<number, number>();
    for (const r of reservations) {
      const rows: { name: string; pax: number; is_room?: boolean }[] = [];
      const rateKey = Number(r.rate_id ?? -1);
      for (const inc of incRows.filter((i) => Number(i.rate_id) === rateKey)) {
        const ci: any = ciById.get(Number(inc.stock));
        if (!ci) continue;
        const freq = String(inc.frequency ?? '');
        const calc = String(ci.calculator ?? '');
        let include = false;
        if (freq === 'Daily') include = true;
        else if (freq === 'Once') {
          const n = seenOnce.get(rateKey) ?? 0;
          include = n === 0;
          seenOnce.set(rateKey, n + 1);
        } else if (freq === 'Twice') {
          const n = seenTwice.get(rateKey) ?? 0;
          include = n < 2;
          seenTwice.set(rateKey, n + 1);
        }
        if (!include) continue;
        if (calc === 'Adult') rows.push({ name: ci.name, pax: Number(r.adult ?? 0) });
        else if (calc === 'Child') rows.push({ name: ci.name, pax: Number(r.child ?? 0) });
        else if (calc === 'Room') rows.push({ name: ci.name, pax: 1, is_room: true });
      }
      inclusivesByRate_set(inclusivesByReservation, Number(r.id), rows);
    }
  }

  return {
    folio,
    property,
    guest: folio.guest_profiles,
    company,
    reservations,
    lastReservation,
    transactions: folio.transactions ?? [],
    inclusivesByReservation,
  };
}

// small helper to avoid Map constructor confusion above
function inclusivesByRate_set(map: Map<number, any>, key: number, value: any) {
  map.set(key, value);
}

function docShell(title: string, body: string, opts: { landscape?: boolean; uppercaseMain?: boolean } = {}): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:24px;}
  .header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:14px;}
  .hotel-name{font-size:20px;font-weight:bold;letter-spacing:.5px;}
  .hotel-sub{font-size:9px;color:#555;}
  .doc-title{font-size:18px;font-weight:bold;text-align:right;text-transform:uppercase;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}
  th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top;}
  th{background:#f0f0f0;font-weight:bold;}
  .no-border td,.no-border th{border:none;padding:2px 4px;}
  .text-right{text-align:right;} .text-center{text-align:center;}
  .strong{font-weight:bold;}
  .section-title{margin-top:14px;font-weight:bold;font-size:12px;text-transform:uppercase;border-bottom:1px solid #333;padding-bottom:2px;}
  .signatures{display:flex;justify-content:space-between;margin-top:48px;}
  .signature{width:45%;text-align:center;}
  .sign-line{border-top:1px solid #333;margin-top:36px;padding-top:4px;}
  main{text-transform:${opts.uppercaseMain === false ? 'none' : 'uppercase'};}
  @media print { .page-break{page-break-before:always;} }
</style></head>
<body><div class="header">
  <div><div class="hotel-name">${esc(title)}</div></div>
</div>
${body}
</body></html>`;
}

function hotelFooter(ctx: DocContext): string {
  return `<div style="margin-top:10px;font-size:9px;color:#444;">${esc(ctx.property?.name ?? '')} — ${esc(ctx.property?.address ?? '')} — Phone: ${esc(ctx.property?.phone ?? '')}</div>`;
}

function guestStayInfoRows(ctx: DocContext): [string, string, string, string][] {
  const f = ctx.folio;
  const guestName = ctx.guest ? `${ctx.guest.first_name ?? ''} ${ctx.guest.last_name ?? ''}`.trim() : `${f.first_name ?? ''} ${f.last_name ?? ''}`;
  return [
    ['Company', ctx.company?.name ?? f.company_name ?? '-', 'Guest', guestName],
    ['Tel', ctx.guest?.telp ?? ctx.guest?.mobile_phone ?? '-', 'Folio No.', f.folio_number ?? '-'],
    ['Number Of Person', String(reservationPax(ctx)), 'Arrival', fmtD(f.check_in_date)],
    ['Voucher No', f.voucher_no ?? '-', 'Departure', fmtD(f.check_out_date)],
    ['Email', ctx.guest?.email ?? '-', 'Room', roomLabel(ctx)],
  ];
}

function reservationPax(ctx: DocContext): number {
  if (!ctx.reservations.length) return 0;
  const maxAdult = Math.max(...ctx.reservations.map((r: any) => Number(r.adult ?? 0)));
  const maxChild = Math.max(...ctx.reservations.map((r: any) => Number(r.child ?? 0)));
  return maxAdult + maxChild;
}

function roomLabel(ctx: DocContext): string {
  const names = ctx.reservations.map((r: any) => r.rooms?.name).filter(Boolean);
  return names.length ? names.join(', ') : (ctx.folio.reservations?.[0]?.room_name ?? '-');
}

function infoTable(rows: [string, string, string, string][]): string {
  return `<table class="no-border">${rows.map(([l1, v1, l2, v2]) =>
    `<tr><td class="strong" style="width:16%">${esc(l1)}</td><td style="width:34%">: ${esc(v1)}</td><td class="strong" style="width:16%">${esc(l2)}</td><td>: ${esc(v2)}</td></tr>`
  ).join('')}</table>`;
}

function stayDetailsTable(ctx: DocContext): string {
  const rows = ctx.reservations.map((r: any, i: number) => `
    <tr>
      <td class="text-center">${i + 1}</td>
      <td>${fmtD(r.check_in_date)}</td>
      <td>${fmtD(r.check_out_date)}</td>
      <td>${esc(r.room_types?.name ?? '-')}</td>
      <td>${esc(r.rooms?.name ?? '-')}</td>
      <td class="text-center">${Number(r.adult ?? 0)}</td>
      <td class="text-center">${Number(r.child ?? 0)}</td>
      <td>${esc(r.rates?.name ?? r.rate_name ?? '-')}</td>
    </tr>`).join('');
  return `<table><thead><tr>
    <th style="width:5%">No</th><th>Arrival</th><th>Departure</th><th>Room Type</th><th>Room</th>
    <th style="width:7%">Adult</th><th style="width:7%">Child</th><th>Rate</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function inclusiveTable(ctx: DocContext): string {
  const rows: string[] = [];
  for (const r of ctx.reservations) {
    const incs = ctx.inclusivesByReservation.get(Number(r.id)) ?? [];
    for (const inc of incs) {
      rows.push(`<tr><td>${esc(inc.name)}</td><td class="text-center">${inc.is_room ? '-' : inc.pax}</td><td class="text-center">${inc.is_room ? '✓' : ''}</td></tr>`);
    }
  }
  if (!rows.length) return '';
  return `<div class="section-title">Inclusive Items</div>
  <table><thead><tr><th>Item</th><th style="width:15%" class="text-center">Pax</th><th style="width:15%" class="text-center">Per Room</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function signatureBlock(leftLabel: string, rightLabel: string): string {
  return `<div class="signatures">
    <div class="signature"><div class="sign-line">${esc(leftLabel)}</div></div>
    <div class="signature"><div class="sign-line">${esc(rightLabel)}</div></div>
  </div>`;
}

function balanceOf(transactions: any[]): number {
  return transactions.reduce(
    (s, t) => s + (t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0)),
    0
  );
}

function txnDebitCreditTable(transactions: any[]): { html: string; totalDebit: number; totalCredit: number } {
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = transactions.map((t: any) => {
    const total = Number(t.total ?? 0);
    const debit = t.type_amount !== 'MINUS' ? total : 0;
    const credit = t.type_amount === 'MINUS' ? total : 0;
    totalDebit += debit;
    totalCredit += credit;
    return `<tr>
      <td>${fmtD(t.date)}</td>
      <td>${esc(t.code_posts?.name ?? t.code_name ?? t.description ?? '')}</td>
      <td>${esc(t.remark ?? t.reference ?? '')}</td>
      <td class="text-right">${debit ? money(debit) : ''}</td>
      <td class="text-right">${credit ? money(credit) : ''}</td>
    </tr>`;
  }).join('');
  return {
    html: `<table><thead><tr><th style="width:12%">Date</th><th>Description</th><th>Remark</th>
      <th style="width:15%" class="text-right">Debet</th><th style="width:15%" class="text-right">Credit</th></tr></thead>
      <tbody>${rows}<tr class="strong"><td colspan="3" class="text-right">Total</td>
      <td class="text-right">${money(totalDebit)}</td><td class="text-right">${money(totalCredit)}</td></tr>
      <tr class="strong"><td colspan="3" class="text-right">Balance</td><td colspan="2" class="text-right">${money(totalDebit - totalCredit)}</td></tr>
      </tbody></table>`,
    totalDebit,
    totalCredit,
  };
}

function txnAmountTable(transactions: any[], amountLabel = 'Amount'): { html: string; total: number } {
  let total = 0;
  const rows = transactions.map((t: any) => {
    const amt = t.type_amount === 'MINUS' ? -Number(t.total ?? 0) : Number(t.total ?? 0);
    total += amt;
    return `<tr>
      <td>${fmtD(t.date)}</td>
      <td>${esc(t.type_payments?.name ?? t.code_name ?? '')}</td>
      <td>${esc(t.reference ?? '')}</td>
      <td class="text-right">${money(amt)}</td>
    </tr>`;
  }).join('');
  return {
    html: `<table><thead><tr><th style="width:12%">Date</th><th>Description</th><th>Reference</th>
      <th style="width:18%" class="text-right">${amountLabel}</th></tr></thead>
      <tbody>${rows}<tr class="strong"><td colspan="3" class="text-right">Total Amount</td>
      <td class="text-right">${money(total)}</td></tr></tbody></table>`,
    total,
  };
}

// ── Per-document bodies ──

function buildPreRegistration(ctx: DocContext, title: string): string {
  const g = ctx.guest ?? {};
  const body = `
  <div class="doc-title">${esc(title)}</div>
  <div class="section-title">Guest Information</div>
  ${infoTable([
    ['Name', `${g.first_name ?? ctx.folio.first_name ?? ''} ${g.last_name ?? ctx.folio.last_name ?? ''}`.trim(), 'Nationality', g.nationality_id ?? '-'],
    ['Address', g.address ?? ctx.folio.address ?? '-', 'City', g.city_id ?? '-'],
    ['Phone', g.mobile_phone ?? g.telp ?? '-', 'Email', g.email ?? '-'],
    ['ID Type', g.id_type ?? '-', 'ID Number', g.id_number ?? '-'],
  ])}
  <div class="section-title">Stay Details</div>
  ${stayDetailsTable(ctx)}
  ${inclusiveTable(ctx)}
  <div class="section-title">Remarks</div>
  <table class="no-border"><tr><td>${esc(ctx.folio.remark ?? '-')}</td></tr></table>
  ${signatureBlock('Guest Signature', 'Front Office')}
  ${hotelFooter(ctx)}`;
  return docShell(title, body);
}

function buildRegistrationForm(ctx: DocContext): string {
  return buildPreRegistration(ctx, 'Registration Form');
}

function buildGuestFolio(ctx: DocContext): string {
  const { html } = txnDebitCreditTable(ctx.transactions);
  const body = `
  <div class="doc-title">Guest Folio</div>
  ${infoTable(guestStayInfoRows(ctx))}
  <div class="section-title">Transactions</div>
  ${html}
  ${signatureBlock('Guest Signature', 'Authorized Signature')}
  ${hotelFooter(ctx)}`;
  return docShell('Guest Folio', body);
}

function buildLetterOfAggrement(ctx: DocContext): string {
  const f = ctx.folio;
  const company = ctx.company;
  const body = `
  <div class="doc-title">Accommodation Confirmation</div>
  <p>Dear ${esc(company?.name ?? `${ctx.guest?.first_name ?? ''} ${ctx.guest?.last_name ?? ''}`.trim())},</p>
  <p>We are pleased to confirm the following accommodation arrangement:</p>
  ${infoTable([
    ['Company', company?.name ?? '-', 'Contact', company?.pic_name ?? '-'],
    ['Folio No.', f.folio_number ?? '-', 'Group Name', f.company_name ?? '-'],
    ['Arrival', fmtD(f.check_in_date), 'Departure', fmtD(f.check_out_date)],
  ])}
  <div class="section-title">Rooming Details</div>
  ${stayDetailsTable(ctx)}
  ${inclusiveTable(ctx)}
  <p style="margin-top:12px">Should you require any further assistance, please do not hesitate to contact us.</p>
  ${signatureBlock('Approved By', 'Received By')}
  ${hotelFooter(ctx)}`;
  return docShell('Letter Of Aggrement', body);
}

function buildConfirmationFO(ctx: DocContext): string {
  const f = ctx.folio;
  const body = `
  <div class="doc-title">Confirmation Slip — Front Office</div>
  ${infoTable([
    ['Guest', `${ctx.guest?.first_name ?? f.first_name ?? ''} ${ctx.guest?.last_name ?? f.last_name ?? ''}`.trim(), 'Folio No.', f.folio_number ?? '-'],
    ['Company', ctx.company?.name ?? f.company_name ?? '-', 'Voucher No', f.voucher_no ?? '-'],
    ['Arrival', fmtDM(f.check_in_date), 'Departure', fmtDM(f.check_out_date)],
  ])}
  <div class="section-title">Stay Details</div>
  ${stayDetailsTable(ctx)}
  ${inclusiveTable(ctx)}
  <div class="section-title">Special Request</div>
  <table class="no-border"><tr><td>${esc(f.remark ?? '-')}</td></tr></table>
  ${signatureBlock('Confirmed By', 'Guest Acknowledgement')}
  ${hotelFooter(ctx)}`;
  return docShell('Confirmation', body);
}

function buildInvoiceLike(ctx: DocContext, title: string, proforma: boolean): string {
  const { html, total } = txnAmountTable(ctx.transactions, proforma ? 'Estimated Amount' : 'Amount');
  const billTo = ctx.company?.name ?? `${ctx.guest?.first_name ?? ctx.folio.first_name ?? ''} ${ctx.guest?.last_name ?? ctx.folio.last_name ?? ''}`.trim();
  const address = ctx.company?.billing_address ?? ctx.guest?.address ?? '-';
  const body = `
  <div class="doc-title">${proforma ? 'Proforma Invoice' : 'Invoice'}${proforma ? '' : ''}</div>
  <table class="no-border">
    <tr><td class="strong" style="width:20%">Bill To</td><td>: ${esc(billTo)}</td>
        <td class="strong" style="width:20%">${proforma ? 'Proforma No' : 'Invoice No'}</td><td>: ${esc(ctx.folio.folio_number ?? '-')}</td></tr>
    <tr><td class="strong">Address</td><td>: ${esc(address)}</td>
        <td class="strong">Date</td><td>: ${fmtD(new Date())}</td></tr>
    <tr><td class="strong">Guest</td><td>: ${esc(`${ctx.guest?.first_name ?? ctx.folio.first_name ?? ''} ${ctx.guest?.last_name ?? ctx.folio.last_name ?? ''}`.trim())}</td>
        <td class="strong">Period</td><td>: ${fmtD(ctx.folio.check_in_date)} — ${fmtD(ctx.folio.check_out_date)}</td></tr>
  </table>
  <div class="section-title">${proforma ? 'Proforma Charges' : 'Charges'}</div>
  ${html}
  ${proforma ? '<p style="margin-top:10px;font-style:italic;">This is a proforma invoice — final charges may vary.</p>' : ''}
  ${signatureBlock('Prepared By', 'Approved By')}
  ${hotelFooter(ctx)}`;
  void title;
  return docShell(title, body);
}

function buildCompanyInvoice(ctx: DocContext): string {
  const company = ctx.company;
  const { html, total } = txnAmountTable(ctx.transactions);
  const body = `
  <div class="doc-title">Company Invoice</div>
  <table class="no-border">
    <tr><td class="strong" style="width:20%">Company</td><td>: ${esc(company?.name ?? ctx.folio.company_name ?? '-')}</td>
        <td class="strong" style="width:20%">Invoice No</td><td>: ${esc(ctx.folio.folio_number ?? '-')}</td></tr>
    <tr><td class="strong">Account No</td><td>: ${esc(company?.account ?? '-')}</td>
        <td class="strong">Date</td><td>: ${fmtD(new Date())}</td></tr>
    <tr><td class="strong">Address</td><td>: ${esc(company?.billing_address ?? '-')}</td>
        <td class="strong">Period</td><td>: ${fmtD(ctx.folio.check_in_date)} — ${fmtD(ctx.folio.check_out_date)}</td></tr>
  </table>
  <div class="section-title">Billing Details</div>
  ${html}
  <table class="no-border"><tr><td class="strong text-right" style="width:70%">Total Due</td>
  <td class="strong text-right">${money(total)}</td></tr></table>
  ${signatureBlock('Company Stamp', 'Hotel Authorized')}
  ${hotelFooter(ctx)}`;
  return docShell('Company Invoice', body);
}

function buildOfficialReceipt(ctx: DocContext): string {
  const payments = ctx.transactions.filter((t: any) => t.type_amount === 'MINUS');
  const { html, total } = txnAmountTable(payments.length ? payments : ctx.transactions);
  const guestName = `${ctx.guest?.first_name ?? ctx.folio.first_name ?? ''} ${ctx.guest?.last_name ?? ctx.folio.last_name ?? ''}`.trim();
  const body = `
  <div class="doc-title">Official Receipt</div>
  <table class="no-border">
    <tr><td class="strong" style="width:22%">Receipt No</td><td>: ${esc(ctx.folio.folio_number ?? '-')}</td>
        <td class="strong" style="width:20%">Date</td><td>: ${fmtD(new Date())}</td></tr>
    <tr><td class="strong">Received From</td><td>: ${esc(guestName)}</td>
        <td class="strong">Folio No</td><td>: ${esc(ctx.folio.folio_number ?? '-')}</td></tr>
    <tr><td class="strong">Being Payment Of</td><td colspan="3">: Room charge and miscellaneous for period ${fmtD(ctx.folio.check_in_date)} — ${fmtD(ctx.folio.check_out_date)}</td></tr>
  </table>
  <div class="section-title">Payment Details</div>
  ${html}
  ${signatureBlock('Guest', 'Received By')}
  ${hotelFooter(ctx)}`;
  return docShell('Official Receipt', body);
}

export async function generateFolioDocumentPdf(req: Request, res: Response, folioId: string, documentType: string): Promise<void> {
  if (!(FOLIO_DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
    badRequest(res, `Unknown folio document type: ${documentType}`);
    return;
  }

  const ctx = await loadFolioDocContext(BigInt(folioId));
  if (!ctx) {
    notFound(res, 'Folio not found');
    return;
  }

  let html: string;
  switch (documentType) {
    case 'pre-registration': html = buildPreRegistration(ctx, 'Pre Registration'); break;
    case 'registration-form': html = buildRegistrationForm(ctx); break;
    case 'guest-folio': html = buildGuestFolio(ctx); break;
    case 'letter-of-aggrement': html = buildLetterOfAggrement(ctx); break;
    case 'confirmation': html = buildConfirmationFO(ctx); break;
    case 'guest-invoice': html = buildInvoiceLike(ctx, 'Guest Invoice', false); break;
    case 'proforma-invoice': html = buildInvoiceLike(ctx, 'Proforma Invoice', true); break;
    case 'company-invoice': html = buildCompanyInvoice(ctx); break;
    case 'official-receipt': html = buildOfficialReceipt(ctx); break;
    default:
      badRequest(res, `Unknown folio document type: ${documentType}`);
      return;
  }

  const pdf = await renderPdf(html, { landscape: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${documentType}-${ctx.folio.folio_number ?? folioId}.pdf"`
  );
  res.send(pdf);
}

// JSON preview of assembled context (kept for debugging parity checks)
export async function folioDocumentPreview(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const ctx = await loadFolioDocContext(BigInt(id));
    if (!ctx) { notFound(res, 'Folio not found'); return; }
    success(res, {
      folio_number: ctx.folio.folio_number,
      guest: ctx.guest ? `${ctx.guest.first_name ?? ''} ${ctx.guest.last_name ?? ''}`.trim() : '',
      company: ctx.company?.name ?? null,
      reservations: ctx.reservations.length,
      transactions: ctx.transactions.length,
    }, 'Success');
  } catch (err: any) {
    console.error('Folio document preview error:', err);
    error(res, 'Failed to load folio document', 500);
  }
}
