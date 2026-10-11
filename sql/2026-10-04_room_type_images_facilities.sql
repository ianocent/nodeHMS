-- Room-type-scoped images + facilities, and the facility `icon` column.
--
-- ── Why room_type_id ──────────────────────────────────────────────────────────
-- The booking engine renders a room CARD per room TYPE, not per physical room:
--   hmsBookingEngine/backend/app/Models/RoomType.php
--     getRoomTypeImageAttribute()  -> contentRoomImage()   (room_type_id)
--     getFacilitiesAttribute()     -> contentRoomFacility() (room_type_id)
--   .../Booking/Hotel/SearchController.php  buildRoomData() -> 'room_type_image', 'facilities'
-- and its own MySQL `content_room_images` / `content_room_facilities` are keyed by
-- room_type_id, not content_room_id.
--
-- The HMS Postgres tables were keyed by content_room_id (a physical room / unit).
-- That mismatch is why "Room Facility" placeholders showed up on
-- http://localhost:3002/kuretakeso: the operator configured a room TYPE in the
-- booking engine, but nothing in HMS could address a room type, so the rows the
-- BE reads never received an upload.
--
-- So: add room_type_id as the scope the new UI writes, and backfill it from
-- content_rooms.room_type_id so the 299 existing rows become reachable instead of
-- orphaned. content_room_id stays as-is (NOT NULL, still the physical-room link)
-- because dropping it would break the existing relation and every row that has no
-- room_type_id backfill would have nowhere to live.
--
-- A room type can have several physical rooms (content_rooms), each of which could
-- own rows. The new UI writes one row set per room type; facilityList/imageList
-- therefore resolve room_type_id -> the room type's FIRST content_room and reuse
-- that row set. Physical-room-level rows created before this migration stay
-- reachable through their own content_room_id.
--
-- ── Why icon ──────────────────────────────────────────────────────────────────
-- content_room_facilities rows only had `name` + `image`, and every `image` value
-- on disk is a pre-migration filename that exists nowhere (see
-- storageFallback.middleware.ts), so the portal rendered the generated "ROOM
-- FACILITY" placeholder instead of a glyph. `icon` carries a react-icons
-- component name chosen by the operator, which the BE renders directly and which
-- survives the image files being lost.
--
-- Idempotent. Safe to re-run.

BEGIN;

-- ── icon on facilities ────────────────────────────────────────────────────────
ALTER TABLE content_room_facilities ADD COLUMN IF NOT EXISTS icon TEXT;

-- ── room_type_id on both tables ───────────────────────────────────────────────
ALTER TABLE content_room_facilities ADD COLUMN IF NOT EXISTS room_type_id BIGINT;
ALTER TABLE content_room_images    ADD COLUMN IF NOT EXISTS room_type_id BIGINT;

-- Backfill: every existing row hangs off a content_room, and every content_room in
-- this database has a room_type_id (verified: 0 orphans of 232 / 67 rows).
UPDATE content_room_facilities f
   SET room_type_id = cr.room_type_id
  FROM content_rooms cr
 WHERE cr.id = f.content_room_id
   AND f.room_type_id IS NULL
   AND cr.room_type_id IS NOT NULL;

UPDATE content_room_images i
   SET room_type_id = cr.room_type_id
  FROM content_rooms cr
 WHERE cr.id = i.content_room_id
   AND i.room_type_id IS NULL
   AND cr.room_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_room_facilities_room_type_id_idx
  ON content_room_facilities (room_type_id);
CREATE INDEX IF NOT EXISTS content_room_images_room_type_id_idx
  ON content_room_images (room_type_id);

-- ── Backfill uuid ─────────────────────────────────────────────────────────────
-- Every Laravel side of this sync addresses the row BY uuid
-- (ContentRoomImageController::store/destroy, ContentRoomFacilityController::store/
-- destroy all do `Model::where('uuid', $request->uuid)`). A row without one is
-- write-only: the HMS keeps a copy the booking engine can never update or delete.
-- Verified on this database before adding the clause: 0 of 232 facility rows and 0 of
-- 67 image rows were missing a uuid, so this is a guard for future rows / other
-- environments rather than a repair.
UPDATE content_room_facilities SET uuid = md5(random()::text || clock_timestamp()::text || id::text)
 WHERE uuid IS NULL OR uuid = '';
UPDATE content_room_images SET uuid = md5(random()::text || clock_timestamp()::text || id::text)
 WHERE uuid IS NULL OR uuid = '';

COMMIT;

-- Mirror the ADD COLUMN into the Prisma schema. `prisma generate` is NOT required:
-- the controller reaches these columns through $queryRawUnsafe, exactly like
-- LifestyleController does for the lifestyle tables (see sql/2026-10-03_lifestyle_tables.sql).
--
--   model content_room_facilities {
--     ...
--     icon          String?
--     room_type_id  BigInt?
--     ...
--     @@index([content_room_id])
--     @@index([room_type_id])
--   }
--
--   model content_room_images {
--     ...
--     room_type_id  BigInt?
--     ...
--     @@index([room_type_id])
--   }
--
-- Verification:
--   select count(*) filter (where room_type_id is null) as unscoped,
--          count(*) as total
--     from content_room_facilities where deleted_at is null;
--   -- expect unscoped = 0
--
--   select room_type_id, count(*)
--     from content_room_facilities
--    where deleted_at is null and property_id = 999
--    group by 1 order by 1;
