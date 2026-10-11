/**
 * One-off backfill: push the room-type images + facilities that already exist in the
 * HMS Postgres into the Booking Engine's MySQL copy.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `sql/2026-10-04_room_type_images_facilities.sql` added `icon` + `room_type_id` to
 * content_room_facilities / content_room_images, and
 * `sql/2026-10-04_room_facility_icon_backfill.sql` derived 232 `icon` values from the
 * names operators had already typed. None of that reached the booking engine, because
 * the dual-write (ContentRoomController -> syncRoomConfigImage / syncRoomConfigFacility)
 * only fires on a UI write. The BE tables still hold their pre-migration state:
 * `icon` empty on all 229 rows, and images pointing at filenames that exist nowhere.
 *
 * That is why http://localhost:3002/kuretakeso still rendered the generated
 * "ROOM FACILITY" placeholder after the schema work: the portal reads the BE copy,
 * not Postgres.
 *
 * The Laravel side addresses rows by uuid and upserts
 * (ContentRoomImageController::store / ContentRoomFacilityController::store both do
 * `where('uuid', …)->update()` else `forceCreate()`), and the uuids are identical on
 * both sides, so this is an idempotent re-push: running it twice changes nothing.
 *
 * Usage (from backend-node):
 *   npx ts-node src/scripts/backfill-room-media.ts
 *   npm run backfill:room-media
 */

import 'dotenv/config';
import { prisma } from '../config/prisma';
import {
  clearBeRoomTypeCache,
  syncRoomConfigFacility,
  syncRoomConfigImage,
  BookingEngineSyncResult,
} from '../services/bookingEngineContent.service';
import { closeBookingDb } from '../services/booking-db.service';

interface Stats {
  attempted: number;
  ok: number;
  failed: number;
  skipped: number;
}

const newStats = (): Stats => ({ attempted: 0, ok: 0, failed: 0, skipped: 0 });

function tally(stats: Stats, result: BookingEngineSyncResult): void {
  if (!result.attempted) {
    stats.skipped += 1;
    // `attempted: false` carries a machine-readable reason; surface it once per kind
    // rather than 200 identical lines when a whole room type is missing on the BE.
    const reason = (result.body as any)?.error;
    if (reason && !tally.reported.has(reason)) {
      tally.reported.add(reason);
      console.warn(`[backfill] skipped: ${reason}`);
    }
    return;
  }
  stats.attempted += 1;
  // Laravel answers {code: 200} on both the upsert and the delete branches.
  if (result.status >= 200 && result.status < 300) stats.ok += 1;
  else stats.failed += 1;
}
// Dedupe set hung off the function so the signature stays compatible with callers.
tally.reported = new Set<string>();

async function main(): Promise<void> {
  console.log('[backfill] room media -> booking engine');
  console.log(`[backfill] BOOKING_ENGINE_URL = ${process.env.BOOKING_ENGINE_URL ?? '(unset)'}`);
  if (!process.env.BOOKING_ENGINE_URL) {
    console.error('[backfill] BOOKING_ENGINE_URL is not set - nothing would be sent. Aborting.');
    process.exit(1);
  }

  const images: any[] = await prisma.$queryRawUnsafe(`
    select id, uuid, room_type_id, property_id, name, image, sort, status
      from content_room_images
     where deleted_at is null and room_type_id is not null
     order by id asc
  `);

  const facilities: any[] = await prisma.$queryRawUnsafe(`
    select id, uuid, room_type_id, property_id, name, icon, image, sort, status
      from content_room_facilities
     where deleted_at is null and room_type_id is not null
     order by id asc
  `);

  console.log(`[backfill] ${images.length} images, ${facilities.length} facilities to push`);

  // The id translation caches per (property_id, room type name); a second run in the
  // same process would otherwise reuse ids resolved against a moved sequence.
  clearBeRoomTypeCache();

  const imageStats = newStats();
  for (const row of images) {
    const result = await syncRoomConfigImage(row);
    tally(imageStats, result);
    if (imageStats.failed > 0 && result.status >= 400) {
      console.error(`[backfill] image ${row.id} (${row.name}) -> HTTP ${result.status}`, result.body);
    }
  }

  const facilityStats = newStats();
  for (const row of facilities) {
    const result = await syncRoomConfigFacility(row);
    tally(facilityStats, result);
    if (facilityStats.failed > 0 && result.status >= 400) {
      console.error(`[backfill] facility ${row.id} (${row.name}) -> HTTP ${result.status}`, result.body);
    }
  }

  console.log('[backfill] images    ', imageStats);
  console.log('[backfill] facilities', facilityStats);

  if (imageStats.failed || facilityStats.failed) {
    console.error('[backfill] finished with failures - see the lines above.');
    process.exitCode = 1;
  } else {
    console.log('[backfill] done.');
  }
}

main()
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await closeBookingDb();
  });
