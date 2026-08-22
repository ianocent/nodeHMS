// Event reports — Laravel Report/Event/BanquetEventOrderController +
// EventBreakdownCalculationController parity. PDF via puppeteer renderPdf.
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { error, notFound } from '../../utils/response';
import { renderPdf } from './excel';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function esc(v: any): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money0(v: any): string {
  return Number(v ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

function money2(v: any): string {
  return Number(v ?? 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDMY(d: any): string {
  if (!d) return '-';
  const x = new Date(d);
  return `${x.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getMonth()]} ${x.getFullYear()}`;
}

const MEAL_KEYWORDS = ['BREAKFAST', 'LUNCH', 'DINNER', 'COFFEE BREAK', 'SNACK', 'BUFFET', 'WELCOME DRINK', 'TEA BREAK'];
const MEAL_CATEGORIES = ['FOOD', 'BEVERAGE', 'MEAL', 'F&B PACKAGE'];
const MEAL_DEFAULT_TIMES: Record<string, string> = {
  BREAKFAST: '07:00 - 10:00',
  'COFFEE BREAK': '10:00 - 10:30',
  LUNCH: '12:00 - 13:30',
  DINNER: '18:30 - 20:30',
};

interface EventContext {
  event: any;
  property: any;
  items: { item: string; rawName: string; quantity: number; amount: number; total: number; isRoom: boolean; description: string | null }[];
  venueName: string;
  layoutName: string;
  salesName: string;
  guestName: string;
  companyName: string;
  instructions: any | null;
  depositPlans: { date: string; amount: number }[];
  actualDeposits: { date: string; type: string; amount: number }[];
  lastReservation: any;
}

async function loadEventContext(eventId: number): Promise<EventContext | null> {
  const event: any = await prisma.event_events.findUnique({
    where: { id: eventId },
    include: {
      event_venues: { select: { name: true } },
      event_layouts: { select: { name: true } },
      company_profiles: { select: { name: true } },
      folios: {
        include: {
          guest_profiles: { select: { first_name: true, last_name: true, mobile_phone: true } },
          reservations: {
            orderBy: { date: 'asc' },
            include: { room_types: { select: { name: true } }, rooms: { select: { name: true } } },
          },
        },
      },
      event_instructions: { orderBy: { id: 'desc' }, take: 1 },
    },
  });
  if (!event || event.deleted_at) return null;

  const itemRows = await prisma.event_event_items.findMany({ where: { event_id: eventId } });
  const ciIds = [...new Set(itemRows.map((i) => i.code_item_id).filter(Boolean))] as number[];
  const ciRows = ciIds.length
    ? await prisma.code_items.findMany({ where: { id: { in: ciIds.map((id) => BigInt(id)) } }, select: { id: true, name: true, description: true } })
    : [];
  const ciById = new Map(ciRows.map((c) => [Number(c.id), c]));

  const items = itemRows.map((item) => {
    const ci: any = ciById.get(Number(item.code_item_id));
    const name = (ci?.name ?? '').toUpperCase();
    const isRoom =
      name.includes('ROOM') || name.includes('VENUE') || name.includes('RENTAL') ||
      String(ci?.category ?? '').toUpperCase() === 'ROOM';
    return {
      item: ci?.name ?? 'Unknown Item',
      rawName: name,
      quantity: item.quantity ?? 1,
      amount: Number(item.amount ?? 0),
      total: Number(item.total_amount ?? Number(item.amount ?? 0) * (item.quantity ?? 1)),
      isRoom,
      description: ci?.description ?? null,
    };
  });

  const salesUser = event.sales_in_charge
    ? await prisma.users.findUnique({ where: { id: BigInt(event.sales_in_charge) }, select: { name: true } })
    : null;

  const depositPlans = await prisma.event_deposit_plans.findMany({
    where: { event_id: eventId },
    orderBy: { date: 'asc' },
  });
  const planRows = depositPlans.map((p: any) => ({ date: p.date ? fmtDMY(p.date) : '-', amount: Number(p.amount ?? 0) }));

  let actualDeposits: { date: string; type: string; amount: number }[] = [];
  if (event.folio_id) {
    const deps = await prisma.deposit_events.findMany({
      where: { folio_id: event.folio_id, deleted_at: null },
      orderBy: { date: 'asc' },
    });
    // deposit_events has no relation to type_payments in Prisma — resolve names manually.
    const tpIds = [...new Set(deps.map((d: any) => Number(d.type_payment_id)).filter(Boolean))] as number[];
    const tps = tpIds.length
      ? await prisma.type_payments.findMany({ where: { id: { in: tpIds.map((id) => BigInt(id)) } }, select: { id: true, name: true } })
      : [];
    const tpNameById = new Map(tps.map((t) => [Number(t.id), t.name ?? '']));
    actualDeposits = deps
      .filter((d: any) => d.date)
      .map((d: any) => ({
        date: fmtDMY(d.date),
        type: tpNameById.get(Number(d.type_payment_id)) || 'Cash / Transfer',
        amount: Number(d.amount ?? 0),
      }));
  }

  return {
    event,
    property: null,
    items,
    venueName: event.event_venues?.name ?? 'N/A',
    layoutName: event.event_layouts?.name ?? 'N/A',
    salesName: salesUser?.name ?? '',
    guestName:
      (event.folios?.guest_profiles ? `${event.folios.guest_profiles.first_name ?? ''} ${event.folios.guest_profiles.last_name ?? ''}`.trim() : '') ||
      event.guest_name ||
      'N/A',
    companyName: event.company_profiles?.name ?? event.company ?? 'N/A',
    instructions: event.event_instructions?.[0] ?? null,
    depositPlans: planRows.length ? planRows : [{ date: '', amount: NaN }],
    actualDeposits,
    lastReservation:
      event.folios?.reservations?.length
        ? event.folios.reservations[event.folios.reservations.length - 1]
        : null,
  };
}

async function loadPropertyFor(propertyId: bigint | null): Promise<any> {
  if (!propertyId) return null;
  return prisma.properties.findUnique({ where: { id: propertyId } });
}

function stripHtmlTags(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ── Banquet Event Order ──

export async function generateBanquetEventOrder(req: Request, res: Response, eventId: number): Promise<void> {
  const ctx = await loadEventContext(eventId);
  if (!ctx) { notFound(res, 'Event not found'); return; }

  const property = await loadPropertyFor(ctx.event.property_id);
  const start = new Date(ctx.event.event_start_time);
  const end = new Date(ctx.event.event_end_time);
  const eventDate = `${start.getDate()} - ${end.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][end.getMonth()]} ${end.getFullYear()}`;
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const eventTime = `${hm(start)} - ${hm(end)}`;
  const refNo = `BEO/${String(start.getMonth() + 1).padStart(2, '0')}${String(start.getFullYear()).slice(-2)}/${String(ctx.event.id).padStart(4, '0')}`;

  // Meal plan from meal keyword/category items (Laravel :60-100)
  const mealItems = ctx.items.filter((it) => {
    const name = it.rawName.toUpperCase();
    const catMatch = MEAL_CATEGORIES.some((c) => it.rawName.includes(c));
    return MEAL_KEYWORDS.some((k) => name.includes(k)) || catMatch;
  });
  const mealRows = mealItems.map((it) => {
    let time = '';
    for (const [key, val] of Object.entries(MEAL_DEFAULT_TIMES)) {
      if (it.rawName.includes(key)) { time = val; break; }
    }
    return { meal: it.item, time, menu: it.description ?? 'As per standard menu' };
  });
  if (!mealRows.length) mealRows.push({ meal: '', time: '', menu: 'No meal plan defined.' });

  // Department instructions — two columns like the blade
  const departments: [string, string][] = [
    ['banquet', 'BANQUET'], ['fo', 'FRONT OFFICE'], ['kitchen', 'KITCHEN'],
    ['housekeeping', 'HOUSEKEEPING'], ['steward', 'STEWARD'], ['engineering', 'ENGINEERING'],
    ['restaurant', 'RESTAURANT'], ['security', 'SECURITY'], ['bar', 'BAR'],
    ['mcm', 'MICE / CONVENTION'], ['sales_marketing', 'SALES & MARKETING'],
  ];
  const instr = Array.isArray(ctx.instructions) ? ctx.instructions[0] : ctx.instructions;
  const notesLines: string[] = [];
  for (const [field, label] of departments) {
    const content = stripHtmlTags(instr?.[field]);
    if (content) notesLines.push(`<strong>${esc(label)}:</strong> ${esc(content)}`);
  }
  if (!notesLines.length) notesLines.push('<em>No special instructions.</em>');
  const half = Math.ceil(notesLines.length / 2);
  const col1 = notesLines.slice(0, half);
  const col2 = notesLines.slice(half);

  const roomItems = ctx.items.filter((i) => i.isRoom);
  const fbItems = ctx.items.filter((i) => !i.isRoom);
  const roomRate = Number(ctx.lastReservation?.total ?? 0);
  const subtotal = fbItems.reduce((s, i) => s + i.total, 0) + roomItems.reduce((s, i) => s + i.total, 0) + roomRate;

  const totalPlanning = ctx.depositPlans.reduce((s, d) => s + (isNaN(d.amount) ? 0 : d.amount), 0);
  const totalReceived = ctx.actualDeposits.reduce((s, d) => s + d.amount, 0);

  const roomType = ctx.lastReservation?.room_types?.name ?? 'N/A';
  const roomNumber = ctx.lastReservation?.rooms?.name ?? 'N/A';

  const itemRows = (list: typeof ctx.items) => list.map((i) =>
    `<tr><td>${esc(i.item)}</td><td class="text-center">${i.quantity}</td><td class="text-right">${money2(i.amount)}</td><td class="text-right">${money2(i.total)}</td></tr>`
  ).join('');

  const body = `
  <div class="doc-title">Banquet Event Order</div>
  <table class="no-border">
    <tr><td class="strong" style="width:14%">Ref No</td><td>: ${esc(refNo)}</td>
        <td class="strong" style="width:14%">Company / PIC</td><td>: ${esc(ctx.companyName)} / ${esc(ctx.guestName)}</td></tr>
    <tr><td class="strong">Event Name</td><td>: ${esc(ctx.event.name)}</td>
        <td class="strong">Phone</td><td>: ${esc(ctx.event.guest_phone ?? ctx.event.folios?.guest_profiles?.mobile_phone ?? 'N/A')}</td></tr>
    <tr><td class="strong">Venue</td><td>: ${esc(ctx.venueName)}</td>
        <td class="strong">Setup</td><td>: ${esc(ctx.layoutName)}</td></tr>
    <tr><td class="strong">Date</td><td>: ${esc(eventDate)}</td>
        <td class="strong">Time</td><td>: ${esc(eventTime)}</td></tr>
    <tr><td class="strong">Pax</td><td>: ${Number(ctx.event.pax ?? 0)}</td>
        <td class="strong">Issued</td><td>: ${fmtDMY(new Date())}</td></tr>
  </table>

  <div class="section-title">Room / Rental</div>
  <table><thead><tr><th>Item</th><th style="width:10%" class="text-center">Qty</th><th style="width:15%" class="text-right">Amount</th><th style="width:15%" class="text-right">Total</th></tr></thead>
  <tbody>${itemRows(roomItems)}<tr class="strong"><td colspan="3" class="text-right">Subtotal Room</td><td class="text-right">${money2(roomItems.reduce((s, i) => s + i.total, 0))}</td></tr></tbody></table>

  <div class="section-title">Food & Beverage</div>
  <table><thead><tr><th>Item</th><th style="width:10%" class="text-center">Qty</th><th style="width:15%" class="text-right">Amount</th><th style="width:15%" class="text-right">Total</th></tr></thead>
  <tbody>${itemRows(fbItems)}<tr class="strong"><td colspan="3" class="text-right">Subtotal F&B</td><td class="text-right">${money2(fbItems.reduce((s, i) => s + i.total, 0))}</td></tr></tbody></table>

  <div class="section-title">Meal Plan</div>
  <table><thead><tr><th>Meal</th><th style="width:22%">Time</th><th>Menu</th></tr></thead>
  <tbody>${mealRows.map((m) => `<tr><td>${esc(m.meal)}</td><td>${esc(m.time)}</td><td>${esc(m.menu)}</td></tr>`).join('')}</tbody></table>

  <div class="section-title">Deposit Planning vs Actual</div>
  <table><thead><tr><th>Planning Date</th><th class="text-right">Planning Amount</th><th>Actual Date</th><th>Type</th><th class="text-right">Actual Amount</th></tr></thead>
  <tbody>
  ${(() => {
    const maxLen = Math.max(ctx.depositPlans.length, ctx.actualDeposits.length, 1);
    const rowsHtml: string[] = [];
    for (let i = 0; i < maxLen; i++) {
      const p = ctx.depositPlans[i];
      const a = ctx.actualDeposits[i];
      rowsHtml.push(`<tr>
        <td>${p ? esc(p.date) : ''}</td><td class="text-right">${p && !isNaN(p.amount) ? money0(p.amount) : ''}</td>
        <td>${a ? esc(a.date) : ''}</td><td>${a ? esc(a.type) : ''}</td><td class="text-right">${a ? money0(a.amount) : ''}</td></tr>`);
    }
    rowsHtml.push(`<tr class="strong"><td colspan="1" class="text-right">Total Planning</td><td class="text-right">${money0(totalPlanning)}</td>
      <td colspan="2" class="text-right">Total Received</td><td class="text-right">${money0(totalReceived)}</td></tr>`);
    return rowsHtml.join('');
  })()}
  </tbody></table>

  <div class="section-title">Special Instructions</div>
  <table><tr>
    <td style="width:50%;vertical-align:top;">${col1.join('<br>')}</td>
    <td style="vertical-align:top;">${col2.join('<br>')}</td>
  </tr></table>

  <div class="section-title">Summary</div>
  <table class="no-border">
    <tr><td class="strong" style="width:70%">Room Rate (${esc(roomType)} / ${esc(roomNumber)})</td><td class="text-right">${money2(roomRate)}</td></tr>
    <tr><td class="strong text-right">Grand Total</td><td class="text-right strong">${money2(subtotal)}</td></tr>
  </table>

  <div class="signatures">
    <div class="signature"><div class="sign-line">Sales in Charge${ctx.salesName ? ` — ${esc(ctx.salesName)}` : ''}</div></div>
    <div class="signature"><div class="sign-line">F&B Manager</div></div>
    <div class="signature"><div class="sign-line">General Manager</div></div>
  </div>
  ${property ? `<div style="margin-top:10px;font-size:9px;color:#444;">${esc(property.name ?? '')} — ${esc(property.address ?? '')} — Phone: ${esc(property.phone ?? '')}</div>` : ''}`;

  const html = shellFor('Banquet Event Order', body);
  const pdf = await renderPdf(html, { landscape: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="BanquetEventOrder-${esc(ctx.event.event_no)}.pdf"`);
  res.send(pdf);
}

// ── Event Breakdown Calculation ──

export async function generateBreakdownCalculation(req: Request, res: Response, eventId: number): Promise<void> {
  const ctx = await loadEventContext(eventId);
  if (!ctx) { notFound(res, 'Event not found'); return; }

  const realRevenue = ctx.items.map((i) => ({
    item: i.item, amount: i.amount, pax: i.quantity, day: 1, total: i.total,
  }));
  const grandTotalRevenue = ctx.items.reduce((s, i) => s + i.total, 0);

  let grandTotalCost = 0;
  const realCost = ctx.items.map((i) => {
    let budgetCostPerUnit = i.amount * 0.3;
    if (i.rawName === 'ENERGY COST') budgetCostPerUnit = 8264; // Laravel fixed value
    const totalCost = budgetCostPerUnit * i.quantity;
    grandTotalCost += totalCost;
    return { item: i.item, amount: i.amount, budget_cost: budgetCostPerUnit, total: totalCost };
  });

  const hotelRevenue = grandTotalRevenue - grandTotalCost;
  const refundPercentage = 5.01;
  const refundToPic = hotelRevenue * (refundPercentage / 100);
  const serviceCharge = hotelRevenue * 0.1;
  const totalTax = hotelRevenue * 0.11;

  const start = new Date(ctx.event.event_start_time);
  const end = new Date(ctx.event.event_end_time);
  const eventDate = `${start.getDate()}-${end.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][end.getMonth()]} ${end.getFullYear()}`;

  const revRows = realRevenue.map((r) =>
    `<tr><td>${esc(r.item)}</td><td class="text-right">${money2(r.amount)}</td><td class="text-center">${r.pax}</td><td class="text-center">${r.day}</td><td class="text-right">${money2(r.total)}</td></tr>`
  ).join('');
  const costRows = realCost.map((r) =>
    `<tr><td>${esc(r.item)}</td><td class="text-right">${money2(r.amount)}</td><td class="text-right">${money2(r.budget_cost)}</td><td class="text-right">${money2(r.total)}</td></tr>`
  ).join('');

  const body = `
  <div class="doc-title">Event Breakdown Calculation</div>
  <table class="no-border">
    <tr><td class="strong" style="width:16%">Event Name</td><td>: ${esc(ctx.event.name)}</td>
        <td class="strong" style="width:16%">PIC Name</td><td>: ${esc(ctx.guestName)}</td></tr>
    <tr><td class="strong">Company</td><td>: ${esc(ctx.companyName)}</td>
        <td class="strong">Prepared By</td><td>: ${esc(ctx.salesName || 'System')}</td></tr>
    <tr><td class="strong">Event Date</td><td colspan="3">: ${esc(eventDate)}</td></tr>
  </table>

  <div class="section-title">Real Revenue</div>
  <table><thead><tr><th>Item</th><th style="width:15%" class="text-right">Amount</th><th style="width:8%" class="text-center">Pax</th><th style="width:8%" class="text-center">Day</th><th style="width:17%" class="text-right">Total</th></tr></thead>
  <tbody>${revRows}<tr class="strong"><td colspan="4" class="text-right">Grand Total Revenue</td><td class="text-right">${money2(grandTotalRevenue)}</td></tr></tbody></table>

  <div class="section-title">Real Cost</div>
  <table><thead><tr><th>Item</th><th style="width:15%" class="text-right">Amount</th><th style="width:17%" class="text-right">Budget Cost/Unit</th><th style="width:17%" class="text-right">Total Cost</th></tr></thead>
  <tbody>${costRows}<tr class="strong"><td colspan="3" class="text-right">Grand Total Cost</td><td class="text-right">${money2(grandTotalCost)}</td></tr></tbody></table>

  <div class="section-title">Sales Amount</div>
  <table class="no-border">
    <tr><td class="strong" style="width:40%">Offer (${esc(refundPercentage)}% refund to PIC)</td><td class="text-right">: ${money2(Number(ctx.event.total_amount ?? grandTotalRevenue))}</td></tr>
    <tr><td class="strong">Real Revenue</td><td class="text-right">: ${money2(grandTotalRevenue)}</td></tr>
    <tr><td class="strong">Hotel Revenue</td><td class="text-right">: ${money2(hotelRevenue)}</td></tr>
    <tr><td class="strong">Refund to PIC</td><td class="text-right">: ${money2(refundToPic)}</td></tr>
    <tr><td class="strong">Service Charge (10%)</td><td class="text-right">: ${money2(serviceCharge)}</td></tr>
    <tr><td class="strong">Total Tax (11%)</td><td class="text-right">: ${money2(totalTax)}</td></tr>
  </table>

  <div class="signatures">
    <div class="signature"><div class="sign-line">Sales Executive${ctx.salesName ? ` — ${esc(ctx.salesName)}` : ''}</div></div>
    <div class="signature"><div class="sign-line">Sales Manager</div></div>
    <div class="signature"><div class="sign-line">Chief Accounting</div></div>
    <div class="signature"><div class="sign-line">General Manager</div></div>
  </div>`;

  const html = shellFor('Event Breakdown Calculation', body);
  const pdf = await renderPdf(html, { landscape: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="event-breakdown-${esc(ctx.event.event_no)}.pdf"`);
  res.send(pdf);
}

function shellFor(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:20px;}
  .header{border-bottom:2px solid #222;padding-bottom:6px;margin-bottom:12px;}
  .doc-title{font-size:18px;font-weight:bold;text-transform:uppercase;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}
  th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top;}
  th{background:#f0f0f0;font-weight:bold;}
  .no-border td,.no-border th{border:none;padding:2px 4px;}
  .strong{font-weight:bold;} .text-right{text-align:right;} .text-center{text-align:center;}
  .section-title{margin-top:12px;font-weight:bold;font-size:12px;text-transform:uppercase;border-bottom:1px solid #333;padding-bottom:2px;}
  .signatures{display:flex;justify-content:space-between;margin-top:42px;gap:8px;}
  .signature{flex:1;text-align:center;}
  .sign-line{border-top:1px solid #333;margin-top:32px;padding-top:4px;}
</style></head><body>${body}</body></html>`;
}
