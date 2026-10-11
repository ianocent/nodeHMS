-- Room Type > Facility tab.
--
-- Menu 1099 "Image" exists under menu 48 (Master Setup > Room Type) but there was
-- no sibling tab for the AMENITIES, even though the booking engine renders them per
-- room type (RoomType::getFacilitiesAttribute -> contentRoomFacility, keyed on
-- room_type_id). Without this tab the facility rows could not be maintained from the
-- HMS at all, which is what left http://localhost:3002/kuretakeso showing the
-- generated "ROOM FACILITY" placeholder instead of real amenities with icons.
--
-- id 1195 continues the block used by sql/2026-10-03_booking_engine_setup_missing_menus.sql
-- (1190-1194), which is the highest id allocated so far.
--
-- `visibility` is the free-text module key that pages/master-setup/index.tsx reads
-- from ?module=, and it must be the same string as `url` for the path-resolving
-- MODULE_PATH_SEGMENTS map to accept it (see the resolveModule comment there).
--
-- Idempotent.

BEGIN;

-- `status` is set explicitly. The first version omitted the column, so the row took the
-- table default of 0, the menu API reported it Inactive, and common/tab filtered it out —
-- the tab existed in the database and nowhere on screen. A later seed
-- (2026-10-04_room_photo_menu.sql) repairs an already-broken database, but a fresh one
-- runs this file, so the INSERT itself has to be correct.
INSERT INTO menus (id, parent_id, name, url, visibility, sort, status)
VALUES (
  1195,
  48,
  '{"en":"Facility","id":"Facility"}',
  '/master-setup/room-type/facility',
  'room-type-facility',
  1,
  1
)
ON CONFLICT (id) DO UPDATE
  SET parent_id = EXCLUDED.parent_id,
      name      = EXCLUDED.name,
      url       = EXCLUDED.url,
      visibility = EXCLUDED.visibility,
      sort      = EXCLUDED.sort,
      status    = EXCLUDED.status;

-- Permission mirrors menu 48 (Master Setup > Room Type) — the PARENT of this tab, and
-- not menu 1099 (its Image sibling, which has zero role_menu_crud rows of its own and
-- is reachable purely through 48). Copying from 48 is what actually grants access;
-- copying from 1099 would have inserted 0 rows, which is exactly what the first run
-- of this file did.
--
-- ON CONFLICT DO NOTHING rather than DO UPDATE: a role that was granted the tab
-- separately keeps whatever it has, and re-running the seed never revokes access.
INSERT INTO role_menu_crud (role_id, menu_id, view, "add", edit, "delete", transaction_actions)
SELECT role_id, 1195, view, "add", edit, "delete", transaction_actions
  FROM role_menu_crud
 WHERE menu_id = 48
ON CONFLICT (role_id, menu_id) DO NOTHING;

COMMIT;

-- Verification:
--   select id, parent_id, url, visibility from menus where id = 1195;
--   select count(*) from role_menu_crud where menu_id = 1195;   -- expect = menu 1099
