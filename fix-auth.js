const fs = require('fs');
const file = 'src/controllers/front-desk.controller.ts';
let code = fs.readFileSync(file, 'utf8');

const target = `async function verifySupervisorApproval(
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
}`;

const replacement = `async function verifySupervisorApproval(
  req: Request,
  transactionAction: 'void' | 'refund'
): Promise<{ ok: true; approver: { id: string; name: string } } | { ok: false; code: number; message: string }> {
  const pin = req.body.approval_pin;
  if (!pin) return { ok: false, code: 400, message: 'Approval PIN is required' };
  const userId = req.user?.id;
  if (!userId) return { ok: false, code: 401, message: 'Unauthorized' };
  
  const user = await prisma.users.findUnique({ where: { id: BigInt(userId) } });
  if (!user || String(user.pin_enshift) !== String(pin).trim()) {
    return { ok: false, code: 403, message: 'Invalid Endshift PIN' };
  }
  return { ok: true, approver: { id: String(user.id), name: String(user.name) } };
}`;

code = code.replace(target.replace(/\n/g, '\r\n'), replacement.replace(/\n/g, '\r\n'));
code = code.replace(target.replace(/\n/g, '\n'), replacement.replace(/\n/g, '\n'));

fs.writeFileSync(file, code);
console.log("Done");
