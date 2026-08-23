// Laravel Kernel :44-59 'check.request.status' (everyThirtySeconds) + Jobs/Report parity:
// pick requests.status=0 -> mark 1 (processing) -> run the mapped report service
// method -> mark 2 (done). status=3 is a node-extra FAILED marker so broken
// methods never wedge the queue.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { reportHandlers } from '../../controllers/report/handlers';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function resolveHandler(method: string | null): ((p: any) => Promise<any[]>) | null {
  if (!method) return null;
  const keys = Object.keys(reportHandlers);
  const cands = [method, method.replace(/_/g, '-'), method.toLowerCase(), method.toLowerCase().replace(/_/g, '-')];
  for (const c of cands) {
    if (reportHandlers[c]) return reportHandlers[c];
    const hit = keys.find((k) => k === c || k.endsWith('/' + c));
    if (hit) return reportHandlers[hit];
  }
  // last resort: token overlap on the tail segment
  for (const k of keys) {
    const tail = k.split('/').pop() ?? '';
    if (method.includes(tail.replace(/-/g, '_')) && tail.length > 6) return reportHandlers[k];
  }
  return null;
}

export async function processBatchReportRequest(_job?: any): Promise<string> {
  const pending = await prisma.requests.findFirst({ where: { status: 0 }, orderBy: { id: 'asc' } });
  if (!pending) return 'no-pending';
  await prisma.requests.update({ where: { id: pending.id }, data: { status: 1 } });

  let dataJson: any = {};
  try { dataJson = JSON.parse(pending.data ?? '{}'); } catch { /* ignore */ }

  const payload: any = {
    ...dataJson,
    method: pending.method,
    property_id: pending.property_id,
    start_date: pending.start_date,
    end_date: pending.end_date,
    request_id: pending.request_id,
  };

  try {
    const handler = resolveHandler(pending.method);
    if (!handler) throw new Error(`No report handler for method '${pending.method}'`);
    await handler(payload);
    await prisma.requests.update({ where: { id: pending.id }, data: { status: 2 } });
  } catch (err: any) {
    console.error('[BatchReportRequest] failed:', err?.message);
    await prisma.requests.update({
      where: { id: pending.id },
      data: { data: JSON.stringify({ ...payload, error: String(err?.message ?? err) }), status: 3 },
    });
  }
  return 'success';
}
