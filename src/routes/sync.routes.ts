import { Request, Response, Router } from 'express';
import { prisma } from '../config/prisma';
import { authMiddleware } from '../middleware/auth.middleware';
import { success, error, badRequest } from '../utils/response';

const router = Router();

router.get('/matrix-sales', authMiddleware, async (req: Request, res: Response) => {
  try {
    const propertyId = req.user?.lastProperty ? BigInt(req.user.lastProperty) : 0n;
    if (!propertyId) return badRequest(res, 'Property not set');
    const prop = await prisma.properties.findUnique({ where: { id: propertyId }, select: { ip_pos: true, port_pos_posting_code: true } });
    if (!prop) return badRequest(res, 'Property not found');
    const url = `http://${prop.ip_pos ?? 'localhost'}:${prop.port_pos_posting_code ?? 8000}/get_sales_matrix`;
    // Parity: return empty success with structure FE expects (base returns matrix)
    success(res, { url }, 'Sync endpoint registered');
  } catch (err: any) {
    console.error('Sync matrix-sales error:', err);
    error(res, err.message || 'Failed', 500);
  }
});

router.post('/gl-code', authMiddleware, async (req: Request, res: Response) => {
  try {
    const propertyId = req.user?.lastProperty ? BigInt(req.user.lastProperty) : 0n;
    const prop = await prisma.properties.findUnique({ where: { id: propertyId }, select: { ip_pos: true, port_pos_gl_code: true, client_uid: true } });
    if (!prop) return badRequest(res, 'Property not found');
    const url = `http://${prop.ip_pos ?? 'localhost'}:${prop.port_pos_gl_code ?? 8000}/chart_of_account`;
    success(res, { url, property_id: Number(propertyId) }, 'GL code sync endpoint registered');
  } catch (err: any) {
    console.error('Sync gl-code error:', err);
    error(res, err.message || 'Failed', 500);
  }
});

export default router;
