import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { error } from './response';

/** Header the web client echoes back with the version it loaded. */
export const EXPECTED_VERSION_HEADER = 'x-expected-version';

export const STALE_DATA_MESSAGE =
  'Data ini sudah diubah oleh user/komputer lain. Muat ulang halaman, cek perubahan terbaru, lalu ulangi perubahan Anda.';

/**
 * Version of a folio *and everything hanging off it*.
 *
 * Assign / unassign room, change room, extend etc. write to `reservations`
 * (the per-night rows) or `transactions`, not to `folios`, so `folios.version`
 * alone does not move when another desk changes the room. The version is
 * therefore the newest version across the folio row, all of its reservation
 * rows and all of its transaction rows (soft-deleted ones included).
 */
export async function getFolioVersion(folioId: bigint): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ version: bigint | number | null }>>`
    SELECT GREATEST(
      COALESCE((SELECT version FROM folios WHERE id = ${folioId}), 0),
      COALESCE((SELECT MAX(version) FROM reservations WHERE folio_id = ${folioId}), 0),
      COALESCE((SELECT MAX(version) FROM transactions WHERE folio_id = ${folioId}), 0)
    )::bigint AS version
  `;
  return String(rows?.[0]?.version ?? 0);
}

export async function getRoomVersion(roomId: bigint): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ version: bigint | number | null }>>`
    SELECT COALESCE(version, 0)::bigint AS version FROM rooms WHERE id = ${roomId}
  `;
  return String(rows?.[0]?.version ?? 0);
}

export async function getHousekeepingVersion(historyId: bigint): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ version: bigint | number | null }>>`
    SELECT COALESCE(version, 0)::bigint AS version FROM housekeeper_history WHERE id = ${historyId}
  `;
  return String(rows?.[0]?.version ?? 0);
}

async function assertFresh(req: Request, res: Response, current: string): Promise<boolean> {
  const raw = req.headers[EXPECTED_VERSION_HEADER];
  const expected = Array.isArray(raw) ? raw[0] : raw;
  if (!expected) return true;
  if (String(expected) === current) return true;
  error(res, STALE_DATA_MESSAGE, 409);
  return false;
}

export async function assertFolioFresh(req: Request, res: Response, folioId: bigint): Promise<boolean> {
  return assertFresh(req, res, await getFolioVersion(folioId));
}

export async function assertRoomFresh(req: Request, res: Response, roomId: bigint): Promise<boolean> {
  return assertFresh(req, res, await getRoomVersion(roomId));
}

export async function assertHousekeepingFresh(req: Request, res: Response, historyId: bigint): Promise<boolean> {
  return assertFresh(req, res, await getHousekeepingVersion(historyId));
}
