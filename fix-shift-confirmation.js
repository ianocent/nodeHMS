const fs = require('fs');
const content = fs.readFileSync('src/controllers/system.controller.ts', 'utf8');

// Find the shiftConfirmationSubmit method and replace it
const startMarker = 'static async shiftConfirmationSubmit(req: Request, res: Response): Promise<void> {';
const startIdx = content.indexOf(startMarker);
if (startIdx === -1) {
  console.log('Method not found');
  process.exit(1);
}

// Find the end of the method (next method or class end)
let braceCount = 0;
let endIdx = startIdx;
let inMethod = false;
for (let i = startIdx; i < content.length; i++) {
  if (content[i] === '{') {
    braceCount++;
    inMethod = true;
  } else if (content[i] === '}') {
    braceCount--;
    if (inMethod && braceCount === 0) {
      endIdx = i + 1;
      break;
    }
  }
}

if (endIdx === startIdx) {
  console.log('Could not find end of method');
  process.exit(1);
}

const oldMethod = content.substring(startIdx, endIdx);
console.log('Found method, length:', oldMethod.length);

const newMethod = `  static async shiftConfirmationSubmit(req: Request, res: Response): Promise<void> {
    try {
      const propertyId = req.user?.lastProperty ?? 0n;
      const userId = req.query.user_id as string;

      if (!userId) {
        badRequest(res, 'user_id is required');
        return;
      }

      const userIdBig = BigInt(userId);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const existingShift = await getPrisma().shifts.findFirst({
        where: {
          user_id: userIdBig,
          property_id: propertyId,
          date: { gte: today, lt: tomorrow },
          deleted_at: null,
        },
      });

      // Get business date
      const businessDate = today;

      // Get transactions for balance matching (Laravel parity)
      const transactions = await getPrisma().transactions.findMany({
        where: {
          property_id: propertyId,
          date: { gte: today, lt: tomorrow },
          is_posting: 0,
          is_endshift: 0,
          deleted_at: null,
        },
        include: { type_payments: true },
      });

      // Group by type_payment_id and calculate balances (Laravel ShiftConfirmationController parity)
      const typePaymentIds = [...new Set(transactions.map(t => t.type_payment_id).filter(Boolean))];
      const unbalanced = [];

      for (const typePaymentId of typePaymentIds) {
        const sum = transactions
          .filter(t => t.type_payment_id === typePaymentId)
          .reduce((acc, t) => {
            const total = Number(t.total || 0);
            return t.type_amount === 'PLUS' ? acc + total : acc - total;
          }, 0);

        if (Math.abs(sum) > 0.01) {
          const typePayment = await getPrisma().type_payments.findUnique({ where: { id: typePaymentId } });
          unbalanced.push({
            type_payment_id: Number(typePaymentId),
            name: typePayment?.name ?? 'Unknown',
            sum: sum,
          });
        }
      }

      if (unbalanced.length > 0) {
        badRequest(res, 'Balance not match', 400, { unbalanced });
        return;
      }

      // All balanced - mark transactions as posted and endshift
      await getPrisma().transactions.updateMany({
        where: {
          property_id: propertyId,
          date: { gte: today, lt: tomorrow },
          is_posting: 0,
          is_endshift: 0,
          deleted_at: null,
        },
        data: { is_posting: 1, is_endshift: 1, updated_at: new Date() },
      });

      // Update or create shift
      const existingShift = await getPrisma().shifts.findFirst({
        where: {
          user_id: req.user?.id ?? 0n,
          property_id: propertyId,
          date: { gte: today, lt: tomorrow },
          deleted_at: null,
        },
      });

      if (existingShift) {
        const updated = await getPrisma().shifts.update({
          where: { id: existingShift.id },
          data: {
            is_posting: true,
            end: new Date(),
            updated_at: new Date(),
          },
        });
        success(res, bigintToNumber(updated), 'Shift confirmed');
      } else {
        const created = await getPrisma().shifts.create({
          data: {
            property_id: propertyId,
            user_id: req.user?.id ?? 0n,
            start: new Date(),
            end: new Date(),
            date: today,
            is_posting: true,
            status: 0,
            created_at: new Date(),
          },
        });
        success(res, bigintToNumber(created), 'Shift created', 201);
      }
    } catch (err: any) {
      console.error('Shift confirmation submit error:', err);
      error(res, 'Failed to submit shift confirmation', 500);
    }
  }`;

const newContent = content.substring(0, startIdx) + newMethod + content.substring(endIdx);
fs.writeFileSync('src/controllers/system.controller.ts', newContent);
console.log('Fixed shiftConfirmationSubmit method');