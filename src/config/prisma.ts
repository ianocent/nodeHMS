import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import { Request } from 'express';
import { writeAudit } from '../utils/audit';

// 1. Async context to hold the current Express Request globally
export const requestContext = new AsyncLocalStorage<Request>();

// 2. Single DB pool for the whole app (fixes connection exhaustion)
// Exported because a few controllers still need raw SQL (company_profiles.remaining is
// a numeric column Prisma maps as Decimal and the ledger recalcs do arithmetic in SQL).
// It was module-private, which left `pool` undefined in company.controller.ts and made
// every company profile create/update throw `ReferenceError: pool is not defined` -> 500.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// 3. Base client
const basePrisma = new PrismaClient({ adapter });

// 4. Extended client with automatic audit logging (parity with Laravel HasLogs)
//
// STATUS: not wired into any controller. Every controller (including
// generic.controller.ts) instantiates its own plain PrismaClient, so the
// `$extends` hooks below never fire. Two reasons it is deliberately left as-is
// rather than switched on globally:
//
//   1. the `update` hook issues an extra findUnique on EVERY write, and
//   2. it would log every CRUD touch in `logs`, burying the handful of rows
//      that actually matter operationally.
//
// Operational events (check-in/out, void, refund, transfer, split, consolidate,
// room-status changes) are audited by explicit `writeAudit(...)` calls in the
// handlers, which name the event (`folio-checked-in`) instead of a CRUD slug.
// If you adopt this client, drop the ALS wiring in index.ts at the same time —
// `writeAudit` is passed `req` directly and does not need the context.
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async create({ model, operation, args, query }) {
        const result = await query(args);
        const req = requestContext.getStore();
        if (req && result && (result as any).id) {
          writeAudit(basePrisma, req, {
            table: model,
            event: 'created',
            subjectId: (result as any).id,
            attributes: result,
          }).catch(() => {}); // never fail the mutation
        }
        return result;
      },
      async update({ model, operation, args, query }) {
        const req = requestContext.getStore();
        let old: any = undefined;

        // Fetch old state before update if we have a request context
        if (req && args.where) {
          try {
            old = await (basePrisma as any)[model].findUnique({ where: args.where });
          } catch (e) {
            // ignore find errors
          }
        }

        const result = await query(args);

        if (req && result && (result as any).id) {
          writeAudit(basePrisma, req, {
            table: model,
            event: 'updated',
            subjectId: (result as any).id,
            old: old,
            attributes: result,
          }).catch(() => {});
        }
        return result;
      },
      async delete({ model, operation, args, query }) {
        const req = requestContext.getStore();
        let old: any = undefined;

        if (req && args.where) {
          try {
            old = await (basePrisma as any)[model].findUnique({ where: args.where });
          } catch (e) {
            // ignore
          }
        }

        const result = await query(args);

        if (req && result && (result as any).id) {
          writeAudit(basePrisma, req, {
            table: model,
            event: 'deleted',
            subjectId: (result as any).id,
            old: old,
          }).catch(() => {});
        }
        return result;
      }
    }
  }
});
