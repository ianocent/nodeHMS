import { prisma } from '../config/prisma';
// Laravel parity: Booking Engine Setup (menu parent 1091) pushes content to the
// Booking Engine from Eloquent model hooks. Reference implementations:
//   App\Models\ContentBanner        -> /cms/content/banner[/{uuid}]
//   App\Models\CancelationRule      -> /cms/cancelation-rule/{uuid}
//   App\Models\CancelationRuleDate  -> /cms/cancelation-rule-date/{uuid}
//   App\Models\RoomType             -> /cms/room-type        (upsert by name+property)
//   App\Models\RateConfig           -> /cms/rate-config
//   App\Models\ContentRoom          -> /cms/room-type        (of its room_type_id)
// The booking engine answers plain JSON on /cms/* (web middleware group, no
// EncryptResponseMiddleware), but the decrypt fallback keeps parity with
// syncCheckStatusBookingEngine, which does the same for /webhook/*.
import { decrypt } from '../utils/encryption';
import { bookingQuery } from './booking-db.service';

export type BookingEngineSyncResult = {
  attempted: boolean;
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  status: number;
  body: any;
};

function bookingEngineBase(): string | null {
  const raw = process.env.BOOKING_ENGINE_URL;
  if (!raw || !raw.trim()) return null;
  return raw.trim().replace(/\/+$/, '');
}

// Laravel pushes `$model->toArray()`; JSON.stringify throws on BigInt and mangles
// Prisma.Decimal, so normalise before serialising.
function jsonSafe(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    if (typeof value.toNumber === 'function') {
      try {
        return Number(value.toNumber());
      } catch {
        return String(value);
      }
    }
    const out: any = {};
    for (const [key, val] of Object.entries(value)) out[key] = jsonSafe(val);
    return out;
  }
  return value;
}

async function beRequest(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  payload?: any
): Promise<BookingEngineSyncResult> {
  const base = bookingEngineBase();
  if (!base) {
    console.warn(`[booking-engine-sync] BOOKING_ENGINE_URL not configured - skipped ${method} ${path}`);
    return { attempted: false, method, path, status: 0, body: { error: 'BOOKING_ENGINE_URL not configured' } };
  }
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(jsonSafe(payload)),
    });
    const raw = await res.text();
    let body: any = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      try {
        body = JSON.parse(decrypt(raw));
      } catch {
        /* keep the raw text */
      }
    }
    if (!res.ok) {
      console.error(`[booking-engine-sync] ${method} ${path} -> HTTP ${res.status}`, body);
    }
    return { attempted: true, method, path, status: res.status, body };
  } catch (err: any) {
    console.error(`[booking-engine-sync] ${method} ${path} failed:`, err?.message);
    return { attempted: true, method, path, status: 0, body: { error: err?.message ?? 'request failed' } };
  }
}

function uuidOf(row: any): string | null {
  const uuid = row?.uuid;
  return uuid ? String(uuid) : null;
}

// ── content_banners ────────────────────────────────────────────────────────────
// The booking engine upserts nothing on store: `ContentBanner::create()` only, so a
// duplicated uuid would blow up. Update/delete address the row by uuid, therefore a
// row without uuid can never be updated remotely.
export async function syncContentBannerCreate(row: any): Promise<BookingEngineSyncResult> {
  return beRequest('POST', '/cms/content/banner', row);
}

export async function syncContentBannerUpdate(row: any): Promise<BookingEngineSyncResult> {
  const uuid = uuidOf(row);
  if (!uuid) {
    console.warn('[booking-engine-sync] content_banners row has no uuid - update skipped');
    return { attempted: false, method: 'PUT', path: '/cms/content/banner', status: 0, body: { error: 'missing uuid' } };
  }
  return beRequest('PUT', `/cms/content/banner/${encodeURIComponent(uuid)}`, row);
}

export async function syncContentBannerDelete(row: any): Promise<BookingEngineSyncResult> {
  const uuid = uuidOf(row);
  if (!uuid) {
    console.warn('[booking-engine-sync] content_banners row has no uuid - delete skipped');
    return { attempted: false, method: 'DELETE', path: '/cms/content/banner', status: 0, body: { error: 'missing uuid' } };
  }
  return beRequest('DELETE', `/cms/content/banner/${encodeURIComponent(uuid)}`);
}

// ── cancelation_rules / cancelation_rule_dates ────────────────────────────────
// Both booking engine endpoints upsert by uuid, so store and update share one call.
export async function syncCancelationRuleUpsert(row: any): Promise<BookingEngineSyncResult> {
  const uuid = uuidOf(row);
  if (!uuid) {
    console.warn('[booking-engine-sync] cancelation_rules row has no uuid - sync skipped');
    return { attempted: false, method: 'POST', path: '/cms/cancelation-rule', status: 0, body: { error: 'missing uuid' } };
  }
  return beRequest('POST', `/cms/cancelation-rule/${encodeURIComponent(uuid)}`, row);
}

export async function syncCancelationRuleDelete(row: any): Promise<BookingEngineSyncResult> {
  const uuid = uuidOf(row);
  if (!uuid) {
    console.warn('[booking-engine-sync] cancelation_rules row has no uuid - delete skipped');
    return { attempted: false, method: 'DELETE', path: '/cms/cancelation-rule', status: 0, body: { error: 'missing uuid' } };
  }
  return beRequest('DELETE', `/cms/cancelation-rule/${encodeURIComponent(uuid)}`);
}

export async function syncCancelationRuleDateUpsert(row: any): Promise<BookingEngineSyncResult> {
  const uuid = uuidOf(row);
  if (!uuid) {
    console.warn('[booking-engine-sync] cancelation_rule_dates row has no uuid - sync skipped');
    return { attempted: false, method: 'POST', path: '/cms/cancelation-rule-date', status: 0, body: { error: 'missing uuid' } };
  }
  return beRequest('POST', `/cms/cancelation-rule-date/${encodeURIComponent(uuid)}`, row);
}

export async function syncCancelationRuleDateDelete(row: any): Promise<BookingEngineSyncResult> {
  const uuid = uuidOf(row);
  if (!uuid) {
    console.warn('[booking-engine-sync] cancelation_rule_dates row has no uuid - delete skipped');
    return { attempted: false, method: 'DELETE', path: '/cms/cancelation-rule-date', status: 0, body: { error: 'missing uuid' } };
  }
  return beRequest('DELETE', `/cms/cancelation-rule-date/${encodeURIComponent(uuid)}`);
}

// ── room_types / content_rooms ────────────────────────────────────────────────
// Booking engine RoomTypeController@sync upserts on (name, property_id), so the
// same POST serves create and update.
export async function syncRoomType(row: any): Promise<BookingEngineSyncResult> {
  if (!row) {
    return { attempted: false, method: 'POST', path: '/cms/room-type', status: 0, body: { error: 'room type not found' } };
  }
  return beRequest('POST', '/cms/room-type', row);
}

// App\Models\ContentRoom pushes its room type (not itself) to /cms/room-type.
export async function syncRoomTypeForContentRoom(contentRoom: any): Promise<BookingEngineSyncResult> {
  const roomTypeId = contentRoom?.room_type_id;
  if (!roomTypeId) {
    return { attempted: false, method: 'POST', path: '/cms/room-type', status: 0, body: { error: 'content room has no room_type_id' } };
  }
  const roomType = await prisma.room_types.findUnique({ where: { id: BigInt(roomTypeId) } });
  return syncRoomType(roomType);
}

// App\Models\ContentRoom also flags every online rate of the property as
// unsynced so the next SyncPriceBookingEngine run re-pushes prices.
export async function resetOnlineRateSyncFlags(propertyId: any): Promise<void> {
  if (!propertyId) return;
  try {
    await prisma.rates.updateMany({
      where: { property_id: BigInt(propertyId), online: 1 },
      data: { sync_online: 0, sync_staah: false },
    });
  } catch (err: any) {
    console.error('[booking-engine-sync] failed to reset rate sync flags:', err?.message);
  }
}

// ── content_room_images / content_room_facilities ──────────────────────────────
// The booking engine keeps its OWN MySQL copies of these two tables, keyed by
// room_type_id (see RoomType::getRoomTypeImageAttribute / getFacilitiesAttribute,
// and SearchController::buildRoomData which feeds the guest-facing room card).
//
// Both Laravel endpoints are addressed BY UUID, not by id:
//   ContentRoomImageController::store/destroy    -> ContentRoomImage::where('uuid', …)
//   ContentRoomFacilityController::store/destroy -> ContentRoomFacility::where('uuid', …)
// and store() filters the payload through Schema::hasColumn, so the node columns are
// pushed verbatim as long as the name matches (`icon` is a real column on both sides
// after sql/2026-10-04_room_type_images_facilities.sql).
//
// `image` is pushed as the '/'-prefixed relative path the HMS column holds, NOT as an
// absolute URL: RoomType::hmsStorageUrl() builds the guest-facing URL by
// concatenating config('cms.apihms_storage') with the stored value, and it already
// does `rtrim(…,'/') . '/' . ltrim($path,'/')`. An absolute URL stored there would be
// concatenated into "http://localhost:3001/storage/http://localhost:3001/…" and 404.
// So the relative path is the correct wire format, and this is why the BE was reading
// broken images in the first place.

// ── room_type_id translation ───────────────────────────────────────────────────
//
// `room_types.id` is NOT shared between the two databases. Each side has its own
// autoincrement sequence and the booking engine's `room_types` table is populated by
// RoomTypeController::sync, which upserts on (name, property_id) and lets MySQL assign
// whatever id is next on ITS sequence. Verified on this database:
//
//   room type                HMS Postgres id   BE MySQL id
//   MJS            (prop 999)              1              1   (coincidence)
//   standart king bed (prop 1002)         21             21   (coincidence)
//   SUPERIOR DOUBLE (prop 1000)           11             47   (BE sequence burned 10-46)
//
// Pushing the HMS id verbatim therefore either lands on a DIFFERENT room type (silent
// corruption) or violates the `content_room_facilities_ibfk_2` FK (HTTP 500). Both were
// observed: 229 rows "succeeded" only because they were uuid updates that never
// touched the FK, and 3 genuine inserts failed on it.
//
// (name, property_id) is the identity the booking engine itself uses — RoomTypeController
// @sync matches on exactly that pair — so it is the correct key to translate through.
// The lookup goes straight at the BE MySQL (booking-db.service already holds a pool for
// the loyalty tables), which avoids adding another Laravel endpoint for one join.
type RoomTypeKey = `${number}:${string}`;
const beRoomTypeCache = new Map<RoomTypeKey, number | null>();

async function resolveBeRoomTypeId(propertyId: number, name: string): Promise<number | null> {
  const key: RoomTypeKey = `${propertyId}:${name}`;
  if (beRoomTypeCache.has(key)) return beRoomTypeCache.get(key) ?? null;
  let resolved: number | null = null;
  try {
    const rows = await bookingQuery<{ id: number }>(
      'select id from room_types where property_id = ? and name = ? and deleted_at is null limit 1',
      [propertyId, name]
    );
    resolved = rows.length ? Number(rows[0].id) : null;
  } catch (err: any) {
    console.error('[booking-engine-sync] room type lookup failed:', err?.message);
    resolved = null;
  }
  beRoomTypeCache.set(key, resolved);
  return resolved;
}

/** Test/reset seam — the cache must not leak a stale id into a later sync run. */
export function clearBeRoomTypeCache(): void {
  beRoomTypeCache.clear();
}

// The row handed in carries the HMS room_type_id but not the room type NAME, and the
// name is what identifies the room type on the booking engine side.
async function roomTypeNameOf(roomTypeId: number): Promise<string | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    'select name from room_types where id = $1',
    String(roomTypeId)
  );
  return rows.length ? String(rows[0].name) : null;
}

/**
 * Build the wire payload for /cms/config-image and /cms/config-facility, translating
 * room_type_id into the booking engine's own id space. Returns null when the room type
 * does not exist there at all, which the callers surface as a skipped sync rather than
 * a 500.
 */
export async function roomConfigPayload(row: any): Promise<any | null> {
  const out: any = { ...row };
  // The BE table is keyed by room_type_id only; content_room_id has no column there
  // and the Schema::hasColumn filter would drop it anyway.
  delete out.content_room_id;
  delete out.sync;

  if (out.property_id !== undefined && out.property_id !== null) {
    out.property_id = Number(out.property_id);
  }

  if (out.room_type_id !== undefined && out.room_type_id !== null) {
    const hmsRoomTypeId = Number(out.room_type_id);
    const propertyId = Number(out.property_id);
    const name = await roomTypeNameOf(hmsRoomTypeId);
    if (!name) {
      console.warn(`[booking-engine-sync] HMS room_types.id ${hmsRoomTypeId} does not exist - sync skipped`);
      return null;
    }
    const beId = await resolveBeRoomTypeId(propertyId, name);
    if (beId === null) {
      // Creating the room type on the booking engine is a separate flow
      // (`POST /cms/room-type`, i.e. syncRoomType). Guessing an id here would either
      // violate the FK or, worse, attach the media to an unrelated room type.
      console.warn(
        `[booking-engine-sync] no booking-engine room_types row for (property ${propertyId}, name "${name}") - sync skipped. ` +
        'Push the room type first.'
      );
      return null;
    }
    if (beId !== hmsRoomTypeId) {
      console.log(
        `[booking-engine-sync] room_type_id ${hmsRoomTypeId} -> ${beId} (property ${propertyId}, "${name}")`
      );
    }
    out.room_type_id = beId;
  }

  return out;
}

export async function syncRoomConfigImage(
  row: any,
  isDelete = false
): Promise<BookingEngineSyncResult> {
  if (!row) {
    return { attempted: false, method: 'POST', path: '/cms/config-image', status: 0, body: { error: 'row not found' } };
  }
  const uuid = uuidOf(row);
  if (!uuid) {
    console.warn('[booking-engine-sync] content_room_images row has no uuid - sync skipped');
    return { attempted: false, method: 'POST', path: '/cms/config-image', status: 0, body: { error: 'missing uuid' } };
  }
  if (isDelete) return beRequest('DELETE', '/cms/config-image', { uuid });
  const payload = await roomConfigPayload(row);
  if (payload === null) {
    return { attempted: false, method: 'POST', path: '/cms/config-image', status: 0, body: { error: 'room type not resolvable on booking engine' } };
  }
  return beRequest('POST', '/cms/config-image', payload);
}

export async function syncRoomConfigFacility(
  row: any,
  isDelete = false
): Promise<BookingEngineSyncResult> {
  if (!row) {
    return { attempted: false, method: 'POST', path: '/cms/config-facility', status: 0, body: { error: 'row not found' } };
  }
  const uuid = uuidOf(row);
  if (!uuid) {
    console.warn('[booking-engine-sync] content_room_facilities row has no uuid - sync skipped');
    return { attempted: false, method: 'POST', path: '/cms/config-facility', status: 0, body: { error: 'missing uuid' } };
  }
  if (isDelete) return beRequest('DELETE', '/cms/config-facility', { uuid });
  const payload = await roomConfigPayload(row);
  if (payload === null) {
    return { attempted: false, method: 'POST', path: '/cms/config-facility', status: 0, body: { error: 'room type not resolvable on booking engine' } };
  }
  return beRequest('POST', '/cms/config-facility', payload);
}

// ── rate_configs ──────────────────────────────────────────────────────────────
export async function syncRateConfigUpsert(row: any): Promise<BookingEngineSyncResult> {
  return beRequest('POST', '/cms/rate-config', row);
}

export async function syncRateConfigDelete(row: any): Promise<BookingEngineSyncResult> {
  return beRequest('DELETE', '/cms/rate-config', row);
}

// Laravel stores the pushed response on the model (`$model->sync`); only
// content_banners and properties carry that column in the node schema.
export async function persistSyncColumn(
  model: 'content_banners' | 'properties',
  id: any,
  result: BookingEngineSyncResult | null
): Promise<void> {
  if (!result || !id) return;
  try {
    let payload: any;
    try {
      payload = JSON.stringify(result.body ?? null);
    } catch {
      payload = JSON.stringify({ error: 'unserializable booking engine response' });
    }
    await (prisma as any)[model].update({ where: { id: BigInt(id) }, data: { sync: payload } });
  } catch (err: any) {
    console.error(`[booking-engine-sync] failed to persist ${model}.sync:`, err?.message);
  }
}