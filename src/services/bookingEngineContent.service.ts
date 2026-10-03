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