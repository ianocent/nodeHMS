-- =============================================================================
-- Rate Link: de-duplicate rate_link_listings + lock the draft invariant
-- Date   : 2026-10-15
-- Target : PostgreSQL (Laragon) / hms_anyaman
-- Why    : QA - "Rate Setup > Rate Link : Room Type Applied To tidak tersimpan"
--          and "Rate Link bisa di simpan tapi Harga kamar tidak terupdate
--          (Rate Link dengan contoh percent sebesar 1% tidak sesuai)"
--
-- Cause  : rate_link_listings holds TWO rows per (rate_id, room_type_id):
--            status = '1'  the applied rule
--            status = '0'  the draft being edited
--          Rate Link grid + Apply read the row with `find()` on an unordered
--          result, so the applied row kept winning: the grid re-displayed the
--          old amount and Apply priced off that old amount, so a 1% rule left
--          the room price unchanged.
--
-- Safe   : the code fix (backend-node/src/controllers/rate.controller.ts)
--          already resolves drafts deterministically and de-duplicates on the
--          next Apply. This script just tidies the existing rows and stops the
--          same state from being recreated.
--
-- Run order: step 1 (report) -> step 2 (delete) -> step 3 (indexes).
-- Step 1 is read-only; check it before running step 2.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 - REPORT (read-only, safe to run first)
-- -----------------------------------------------------------------------------

-- 1a. Every (rate_id, room_type_id) holding more than one live row.
SELECT rate_id,
       room_type_id,
       count(*)                     AS live_rows,
       string_agg(status, ',' ORDER BY id) AS statuses
FROM rate_link_listings
WHERE deleted_at IS NULL
GROUP BY rate_id, room_type_id
HAVING count(*) > 1
ORDER BY rate_id, room_type_id;

-- 1b. Exact rows step 2 will delete (the oldest of each group is kept alive as
--     the newest draft). Review this before continuing.
SELECT l.id,
       l.rate_id,
       l.room_type_id,
       l.amount,
       l.type,
       l."offsetExtraAdult",
       l."offsetExtraChild",
       l.status,
       l.created_at,
       l.updated_at
FROM rate_link_listings l
WHERE l.deleted_at IS NULL
  AND l.id <> (
        SELECT max(k.id)
        FROM rate_link_listings k
        WHERE k.rate_id      = l.rate_id
          AND k.room_type_id = l.room_type_id
          AND k.deleted_at IS NULL
      )
ORDER BY l.rate_id, l.room_type_id, l.id;

-- 1c. Safety net: any duplicate group whose rows DISAGREE. The newest row wins
--     by design, but if any of these disagree you probably want to re-Apply
--     that rate from the UI before deleting anything.
SELECT rate_id,
       room_type_id,
       count(DISTINCT (amount, type, "offsetExtraAdult", "offsetExtraChild")) AS distinct_rules,
       count(*) AS live_rows
FROM rate_link_listings
WHERE deleted_at IS NULL
GROUP BY rate_id, room_type_id
HAVING count(*) > 1
   AND count(DISTINCT (amount, type, "offsetExtraAdult", "offsetExtraChild")) > 1
ORDER BY rate_id, room_type_id;


-- -----------------------------------------------------------------------------
-- STEP 2 - DE-DUPLICATE
-- Keeps the newest row per (rate_id, room_type_id); it is the most recent edit
-- and the one the fixed grid/Apply now resolves to.
-- Wrap in a transaction so you can roll back with ROLLBACK; change to COMMIT
-- once step 1b looks right.
-- -----------------------------------------------------------------------------

BEGIN;

DELETE FROM rate_link_listings l
WHERE l.deleted_at IS NULL
  AND l.id <> (
        SELECT max(k.id)
        FROM rate_link_listings k
        WHERE k.rate_id      = l.rate_id
          AND k.room_type_id = l.room_type_id
          AND k.deleted_at IS NULL
      );

-- Expected on the current data: DELETE 4  (rate_id 124, room types 21/22/25/28)
-- Confirm nothing is left:
SELECT rate_id, room_type_id, count(*)
FROM rate_link_listings
WHERE deleted_at IS NULL
GROUP BY rate_id, room_type_id
HAVING count(*) > 1;

COMMIT;
-- (use ROLLBACK; instead of COMMIT; to undo)


-- -----------------------------------------------------------------------------
-- STEP 3 - INDEXES
-- The table had no index at all, so every Rate Link grid load and every Apply
-- did a sequential scan of the whole table.
-- -----------------------------------------------------------------------------

-- 3a. Covers the grid + Apply lookups (WHERE rate_id = ? [AND status = ?]).
--     Declared in prisma/schema.prisma as @@index([rate_id, status]).
CREATE INDEX IF NOT EXISTS rate_link_listings_rate_id_status_idx
    ON rate_link_listings (rate_id, status);

-- 3b. Covers the per-room-type draft/applied resolution.
--     Declared in prisma/schema.prisma as @@index([rate_id, room_type_id]).
CREATE INDEX IF NOT EXISTS rate_link_listings_rate_id_room_type_id_idx
    ON rate_link_listings (rate_id, room_type_id);

-- 3c. Draft invariant: at most ONE status='0' row per rate + room type.
--     This is what let the duplicate pairs accumulate - the grid creates a draft
--     on edit, and nothing stopped a second one appearing next to it.
--     Prisma cannot express a partial index in schema.prisma, so it lives here
--     only; `prisma migrate dev` will not try to recreate it.
CREATE UNIQUE INDEX IF NOT EXISTS rate_link_listings_one_draft_per_room_type_idx
    ON rate_link_listings (rate_id, room_type_id)
    WHERE deleted_at IS NULL AND status = '0';