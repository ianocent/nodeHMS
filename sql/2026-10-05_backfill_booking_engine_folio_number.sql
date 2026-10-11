-- Backfill folio_number for folios created without one.
--
-- Why this is needed
-- -----------------
-- The Laravel reference numbers folios in a model hook:
--
--   app/Models/Folio.php:52-68   static::creating() -> generateCodeReservation()
--   app/Models/Folio.php:298-304 -> folioNumberFormat($code, getLastResevation())
--   app/Helpers/Global.php:400   format: <code><property:3><ym><seq:4>
--                                  fit -> F, git -> G, day-use -> D, else V
--
-- The node port has no equivalent hook, so `storeReservation` (the booking engine sync)
-- inserted `booking_no` but never `folio_number`. Verified on this database: exactly one
-- row, id 47425, `booking_no = OL99926100001`, `folio_number = NULL`.
--
-- Knock-on effects that this fixes:
--   * /module/notification rendered the literal string "null" in the folio column.
--   * PreRegistrationController::findFolio looks the folio up by
--     `WHERE UPPER(folio_number) = ?`, so a guest who booked online could never be
--     matched by the folio number on their card.
--
-- Running this AFTER the code fix means new bookings are numbered on insert and only
-- the historical row needs help. Both paths produce the same series, so the numbering
-- stays continuous: the next generated folio for property 999 will read the highest
-- existing number in this table and continue from there.
--
-- Idempotent: `where folio_number is null` means a second run matches nothing.

BEGIN;

-- Report first, so the sequence can be eyeballed before anything is written.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, property_id, type_reservation, booking_no, created_at
      FROM folios
     WHERE folio_number IS NULL
       AND deleted_at IS NULL
     ORDER BY id
  LOOP
    RAISE NOTICE 'folio % (property %, %) booking_no=% -> %',
      r.id, r.property_id, r.type_reservation, r.booking_no,
      upper(substring(COALESCE(r.type_reservation, '') from 1 for 1))
        || lpad(r.property_id::text, 3, '0')
        || to_char(COALESCE(r.created_at, now()), 'YYMM')
        || lpad((
              SELECT COALESCE(MAX(right(f2.folio_number, 4)::int), 0) + 1
                FROM folios f2
               WHERE f2.folio_number LIKE
                     upper(substring(COALESCE(r.type_reservation, '') from 1 for 1))
                     || lpad(r.property_id::text, 3, '0')
                     || to_char(COALESCE(r.created_at, now()), 'YYMM')
                     || '%'
            )::text, 4, '0');
  END LOOP;
END $$;

UPDATE folios f
   SET folio_number = upper(substring(COALESCE(f.type_reservation, '') from 1 for 1))
                      || lpad(f.property_id::text, 3, '0')
                      || to_char(COALESCE(f.created_at, now()), 'YYMM')
                      || lpad((
                            SELECT COALESCE(MAX(right(f2.folio_number, 4)::int), 0) + 1
                              FROM folios f2
                             WHERE f2.folio_number LIKE
                                   upper(substring(COALESCE(f.type_reservation, '') from 1 for 1))
                                   || lpad(f.property_id::text, 3, '0')
                                   || to_char(COALESCE(f.created_at, now()), 'YYMM')
                                   || '%'
                      )::text, 4, '0')
 WHERE f.folio_number IS NULL
   AND f.deleted_at IS NULL
   -- `folios.folio_number` has a UNIQUE btree index; a collision here aborts the whole
   -- transaction, so the guard keeps the statement from touching anything unassignable.
   AND NOT EXISTS (
         SELECT 1 FROM folios f3
          WHERE f3.folio_number = upper(substring(COALESCE(f.type_reservation, '') from 1 for 1))
                               || lpad(f.property_id::text, 3, '0')
                               || to_char(COALESCE(f.created_at, now()), 'YYMM')
                               || lpad((
                                     SELECT COALESCE(MAX(right(f4.folio_number, 4)::int), 0) + 1
                                       FROM folios f4
                                      WHERE f4.folio_number LIKE
                                            upper(substring(COALESCE(f.type_reservation, '') from 1 for 1))
                                            || lpad(f.property_id::text, 3, '0')
                                            || to_char(COALESCE(f.created_at, now()), 'YYMM')
                                            || '%'
                                   )::text, 4, '0')
       );

COMMIT;

-- Verification:
--   select count(*) from folios where folio_number is null and deleted_at is null;
--     -- expect 0
--   select id, property_id, type_reservation, folio_number, booking_no
--     from folios where booking_engine_uuid is not null order by id desc limit 5;
--     -- folio_number must now be F9992610xxxx, booking_no stays OL9992610xxxx
--   select folio_number from folios where folio_number like 'F999%'
--     order by folio_number desc limit 5;
--     -- the new row must sit inside the existing series without duplicating it