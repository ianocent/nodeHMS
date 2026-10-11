-- Assign react-icons names to the room facilities that already exist.
--
-- ── Why ───────────────────────────────────────────────────────────────────────
-- Every content_room_facilities row (232 of them, properties 1 / 999 / 1002) has a
-- human name and an `image` pointing at a pre-migration filename
-- (/facility/Mini-Coolbar-1751561819.png). None of those files exist on this machine
-- or on the production host — storageFallback.middleware.ts exists precisely because
-- the audit came back empty — so the booking engine rendered the generated
-- "ROOM / FACILITY" placeholder tile instead of a glyph on
-- http://localhost:3002/kuretakeso.
--
-- `icon` (added by 2026-10-04_room_type_images_facilities.sql) is the field the portal
-- can actually draw, so this backfill derives it from the name the operator already
-- typed. The HMS UI (Master Setup > Room Type > Facility, menu 1195) can override any
-- of these afterwards.
--
-- The image column is intentionally LEFT ALONE. It is the operator's column and the
-- fallback artwork still covers it; blanking 232 rows would destroy the record of
-- what was configured and gain nothing, because Facilities.tsx now prefers `icon`.
--
-- Match is on a lowercased, punctuation-stripped name against ordered rules, so
-- "43\" Smart TV" and "43-inch Smart TV" both land on `Tv`. First match wins, hence
-- the specific-before-general ordering.
--
-- Idempotent: only rows with a NULL/empty icon are touched.

BEGIN;

-- ── Property 999 (KURETAKESO, Japanese ryokan) — the property in the report ────
-- Both spellings occur in the data ("Non Smoking" and "Non-smoking"), and the Ban
-- rule has to run before the Smoking one or the hyphenated row matches '%smoking%'
-- and gets the wrong glyph.
UPDATE content_room_facilities SET icon = 'Ban' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%non smoking%';

UPDATE content_room_facilities SET icon = 'Ban' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%non-smoking%';

UPDATE content_room_facilities SET icon = 'Smoking' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%smoking%';

UPDATE content_room_facilities SET icon = 'GlassCheers' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%coolbar%' OR name ILIKE '%mini bar%' OR name ILIKE '%minibar%'
       OR name ILIKE '%fridge%' OR name ILIKE '%refrigerator%');

UPDATE content_room_facilities SET icon = 'Tv' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%tv%' OR name ILIKE '%television%');

UPDATE content_room_facilities SET icon = 'Wifi' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%wifi%' OR name ILIKE '%wi fi%' OR name ILIKE '%internet%');

UPDATE content_room_facilities SET icon = 'Snowflake' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%air condition%';

UPDATE content_room_facilities SET icon = 'HotTub' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%onsen%' OR name ILIKE '%bath%' OR name ILIKE '%jacuzzi%' OR name ILIKE '%sauna%');

UPDATE content_room_facilities SET icon = 'Bath' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%toilet%';

UPDATE content_room_facilities SET icon = 'Shower' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%shower%';

UPDATE content_room_facilities SET icon = 'Dumbbell' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%gym%' OR name ILIKE '%fitness%');

UPDATE content_room_facilities SET icon = 'Parking' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%parking%';

UPDATE content_room_facilities SET icon = 'Coffee' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%coffee%' OR name ILIKE '%tea%');

UPDATE content_room_facilities SET icon = 'ConciergeBell' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%service%' OR name ILIKE '%concierge%' OR name ILIKE '%reception%');

UPDATE content_room_facilities SET icon = 'Tshirt' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%yukata%' OR name ILIKE '%night wear%' OR name ILIKE '%amenit%'
       OR name ILIKE '%razor%' OR name ILIKE '%comb%' OR name ILIKE '%slipper%'
       OR name ILIKE '%bath salt%' OR name ILIKE '%snack%' OR name ILIKE '%towel%'
       OR name ILIKE '%laundry%' OR name ILIKE '%dental%');

UPDATE content_room_facilities SET icon = 'Utensils' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%meal%' OR name ILIKE '%breakfast%' OR name ILIKE '%restaurant%'
       OR name ILIKE '%buffet%' OR name ILIKE '%dine%');

UPDATE content_room_facilities SET icon = 'Briefcase' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%working space%';

UPDATE content_room_facilities SET icon = 'Lock' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%safe%';

UPDATE content_room_facilities SET icon = 'Suitcase' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%luggage%';

UPDATE content_room_facilities SET icon = 'Users' WHERE icon IS NULL AND property_id = 999
  AND (name ILIKE '%extra bed%' OR name ILIKE '%crib%' OR name ILIKE '%family%');

UPDATE content_room_facilities SET icon = 'HandPaper' WHERE icon IS NULL AND property_id = 999
  AND name ILIKE '%massage%';

-- Anything still unmatched on 999 keeps a neutral glyph rather than NULL, so the card
-- never shows a bare label with no marker at all.
UPDATE content_room_facilities SET icon = 'ConciergeBell'
 WHERE icon IS NULL AND property_id = 999 AND deleted_at IS NULL;

-- ── Property 1002 (HOTEL OLIVE) ───────────────────────────────────────────────
UPDATE content_room_facilities SET icon = 'Ban' WHERE icon IS NULL AND property_id = 1002
  AND (name ILIKE '%non smoking%' OR name ILIKE '%non-smoking%');

-- Runs after the Ban rule above for the same reason as on property 999.
UPDATE content_room_facilities SET icon = 'Smoking' WHERE icon IS NULL AND property_id = 1002
  AND name ILIKE '%smoking%';

UPDATE content_room_facilities SET icon = 'GlassCheers' WHERE icon IS NULL AND property_id = 1002
  AND (name ILIKE '%coolbar%' OR name ILIKE '%mini bar%' OR name ILIKE '%minibar%');

UPDATE content_room_facilities SET icon = 'Wifi' WHERE icon IS NULL AND property_id = 1002
  AND (name ILIKE '%wifi%' OR name ILIKE '%wi fi%' OR name ILIKE '%internet%');

UPDATE content_room_facilities SET icon = 'Snowflake' WHERE icon IS NULL AND property_id = 1002
  AND name ILIKE '%air condition%';

UPDATE content_room_facilities SET icon = 'Tv' WHERE icon IS NULL AND property_id = 1002
  AND (name ILIKE '%tv%' OR name ILIKE '%television%');

UPDATE content_room_facilities SET icon = 'Parking' WHERE icon IS NULL AND property_id = 1002
  AND name ILIKE '%parking%';

UPDATE content_room_facilities SET icon = 'ConciergeBell' WHERE icon IS NULL AND property_id = 1002
  AND (name ILIKE '%service%' OR name ILIKE '%reception%' OR name ILIKE '%concierge%');

UPDATE content_room_facilities SET icon = 'ConciergeBell'
 WHERE icon IS NULL AND property_id = 1002 AND deleted_at IS NULL;

-- ── Property 1 (legacy, no property row in this database) ─────────────────────
UPDATE content_room_facilities SET icon = 'Ban' WHERE icon IS NULL AND property_id = 1
  AND (name ILIKE '%non smoking%' OR name ILIKE '%non-smoking%');

UPDATE content_room_facilities SET icon = 'Smoking' WHERE icon IS NULL AND property_id = 1
  AND name ILIKE '%smoking%';

UPDATE content_room_facilities SET icon = 'Wifi' WHERE icon IS NULL AND property_id = 1
  AND (name ILIKE '%wifi%' OR name ILIKE '%wi fi%');

UPDATE content_room_facilities SET icon = 'Snowflake' WHERE icon IS NULL AND property_id = 1
  AND name ILIKE '%air condition%';

UPDATE content_room_facilities SET icon = 'Shower' WHERE icon IS NULL AND property_id = 1
  AND name ILIKE '%shower%';

UPDATE content_room_facilities SET icon = 'Utensils' WHERE icon IS NULL AND property_id = 1
  AND name ILIKE '%meal%';

UPDATE content_room_facilities SET icon = 'ConciergeBell'
 WHERE icon IS NULL AND property_id = 1 AND deleted_at IS NULL;

COMMIT;

-- Verification — every row must now carry a drawable glyph:
--   select icon, count(*) from content_room_facilities
--    where deleted_at is null group by 1 order by 2 desc;
--   select count(*) as still_null
--     from content_room_facilities where deleted_at is null and icon is null;  -- expect 0
--
--   select rt.name, f.name, f.icon
--     from content_room_facilities f join room_types rt on rt.id = f.room_type_id
--    where f.property_id = 999 and f.deleted_at is null
--    order by f.room_type_id, f.sort limit 20;
