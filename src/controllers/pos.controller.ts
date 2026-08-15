import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { success, error, badRequest, notFound } from '../utils/response';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function bigintToNumber(val: any): any {
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof val === 'object' && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = bigintToNumber(v);
    }
    return out;
  }
  return val;
}

function idParam(val: any): bigint {
  if (Array.isArray(val)) return BigInt(val[0]);
  return BigInt(val);
}

export class PosController {
  static async listTransactions(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = {
        property_id: pid,
        deleted_at: null,
      };

      const [data, total] = await Promise.all([
        prisma.transactions.findMany({
          where,
          include: {
            folios: { select: { id: true, folio_number: true } },
            type_payments: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.transactions.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      console.error('POS transaction list error:', err);
      error(res, 'Failed to fetch POS transactions', 500);
    }
  }

  static async listMatrixSales(req: Request, res: Response): Promise<void> {
    try {
      const pid = req.user?.lastProperty ?? 0n;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const where: any = {
        property_id: pid,
        deleted_at: null,
      };

      const [data, total] = await Promise.all([
        prisma.pos_matrix_sales.findMany({
          where,
          include: {
            code_posts: { select: { id: true, name: true } },
          },
          orderBy: { id: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.pos_matrix_sales.count({ where }),
      ]);

      success(res, bigintToNumber(data), 'Success', 200, { page, total } as any);
    } catch (err: any) {
      console.error('POS matrix sales list error:', err);
      error(res, 'Failed to fetch POS matrix sales', 500);
    }
  }
}
