import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { badRequest, error, success } from '../utils/response';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function bigintToNumber(val: any): any {
  if (val instanceof Date) {
    const iso = val.toISOString();
    const s = iso.slice(0, 19).replace('T', ' ');
    return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
  }
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(bigintToNumber);
  if (val && typeof (val as any).toNumber === 'function') return Number((val as any).toNumber());
  if (val && typeof val === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(val)) out[k] = bigintToNumber(v);
    return out;
  }
  return val;
}

function safeParse(v: any): any {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return {}; }
}

function allotmentIdParam(req: Request): bigint | null {
  const raw = req.query.allotment_id ?? req.body?.allotment_id ?? req.params?.id;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s);
}

export class AllotmentController {
  // GET /allotment/room — Laravel AllotmentController@room (:412-514):
  // one row per active Room Type of the property, weekday quota columns merged
  // from room_allotments (0 when nothing saved yet).
  static async roomList(req: Request, res: Response): Promise<void> {
    try {
      const allotmentId = allotmentIdParam(req);
      if (!allotmentId) { badRequest(res, 'The allotment_id field is required.'); return; }
      const allotment = await prisma.allotments.findFirst({ where: { id: allotmentId, deleted_at: null } });
      if (!allotment) {
        success(res, [], 'Not Found', 200, {
          table: [],
          permission: { view: true, add: true, edit: true },
          pagination: { current_page: 1, last_page: 1, per_page: 99999, total: 0, from: 0, to: 0 },
        });
        return;
      }

      const pid = allotment.property_id;
      const [roomTypes, roomAllots] = await Promise.all([
        prisma.room_types.findMany({
          where: { property_id: pid, deleted_at: null, status: 1 },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.room_allotments.findMany({ where: { allotment_id: allotment.id, deleted_at: null } }),
      ]);

      const raByType = new Map<string, any>();
      for (const ra of roomAllots) raByType.set(String(ra.room_type_id), ra);

      const data = roomTypes.map((rt) => {
        const ra = raByType.get(String(rt.id));
        const json = safeParse(ra?.data);
        const row: any = {
          id: ra ? Number(ra.id) : undefined,
          name: rt.name,
          room_type_id: Number(rt.id),
          is_view: true,
          is_edit: true,
        };
        for (const d of DAYS) row[d] = String(json?.[d] ?? '0');
        return row;
      });

      const table = [
        { label: 'Name', key: 'name', type: 'none', is_search: false },
        ...DAYS.map((d) => ({ label: d.charAt(0).toUpperCase() + d.slice(1), key: d, type: 'number', is_search: false })),
      ];

      success(res, data, 'Success', 200, {
        table,
        permission: { view: true, add: true, edit: true },
        pagination: { current_page: 1, last_page: 1, per_page: 99999, total: data.length, from: data.length ? 1 : 0, to: data.length },
      });
    } catch (err: any) {
      console.error('Allotment roomList error:', err);
      error(res, 'Failed to list room allotments', 500);
    }
  }

  // POST /allotment/room — Laravel AllotmentController@roomStore (:516-561) /
  // roomUpdate (:563-608): upsert quota row by (property_id, room_type_id, allotment_id).
  static async roomUpsert(req: Request, res: Response): Promise<void> {
    try {
      const allotmentId = allotmentIdParam(req);
      if (!allotmentId) { badRequest(res, 'The allotment_id field is required.'); return; }
      const name = String(req.body?.name ?? '').trim();
      if (!name) { badRequest(res, 'The name field is required.'); return; }

      const allotment = await prisma.allotments.findFirst({ where: { id: allotmentId, deleted_at: null } });
      if (!allotment) { badRequest(res, 'Allotment not found.'); return; }

      const pid = allotment.property_id;
      const roomType = await prisma.room_types.findFirst({
        where: { name, property_id: pid, deleted_at: null, status: 1 },
        select: { id: true },
      });
      if (!roomType) { badRequest(res, 'Room Type Not Found'); return; }

      const dataObj: any = {};
      for (const d of DAYS) {
        const n = Number(req.body?.[d] ?? 0);
        dataObj[d] = Number.isFinite(n) ? String(n) : '0';
      }

      const existing = await prisma.room_allotments.findFirst({
        where: { property_id: pid, room_type_id: roomType.id, allotment_id: allotment.id, deleted_at: null },
      });

      const saved = existing
        ? await prisma.room_allotments.update({
            where: { id: existing.id },
            data: { data: JSON.stringify(dataObj), status: 1, updated_at: new Date(), updated_by: req.user?.id ?? null },
          })
        : await prisma.room_allotments.create({
            data: {
              property_id: pid,
              room_type_id: roomType.id,
              allotment_id: allotment.id,
              data: JSON.stringify(dataObj),
              status: 1,
              created_at: new Date(),
              created_by: req.user?.id ?? null,
            },
          });

      success(res, bigintToNumber(saved), 'Success', 200);
    } catch (err: any) {
      console.error('Allotment roomUpsert error:', err);
      error(res, 'Failed to save room allotment', 500);
    }
  }
}
