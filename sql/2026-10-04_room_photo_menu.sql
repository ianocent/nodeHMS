-- Room photos reachable from Booking Engine Setup, and the Room Type > Facility tab
-- turned on.
--
-- Two problems this file fixes:
--
-- 1. Menu 1195 "Facility" (Master Setup > Room Type) was inserted by
--    sql/2026-10-04_room_type_facility_menu.sql without a `status` column, so it took
--    the table default of 0. The API reports it as `status: {value: 0, label:
--    "Inactive"}` and common/tab filters inactive rows out, so the tab never appeared —
--    232 amenity rows existed in Postgres and the booking engine read them, but there
--    was no way to reach the editor from the UI. Same for `left`/`right`, which the
--    insert left at 0.
--
-- 2. Booking Engine Setup (menu 1091) has no room-photo entry. Its "Room" tab (1092)
--    edits the `content_rooms` record — name, description, discount — and carries no
--    picture, because photos live in `content_room_images` keyed by room_type_id. So
--    `http://localhost:3000/module/content-room` legitimately has no upload control,
--    and the operator looking for one there was looking in the wrong place. This adds
--    menu 1196 "Room Photo" next to it, pointing at the same screen menu 1099 uses.
--
-- `left`/`right` are nested-set columns but the tree endpoint does not use them for
--    ordering (menu 1190 sits at left 501 while its parent 1091 spans 118..127, and it
--    still resolves as a depth-1 child), so the values here are placeholders only.
--
-- `url` is stored without a query string: the menu endpoint rewrites it to
-- `<url>?parent=<id>&module=<visibility>`, which is the form the tab strip links to.
--
-- Idempotent.

BEGIN;

-- 1. Facility tab: repair a database where it was inserted without a `status` column.
--    A fresh database gets status 1 straight from
--    2026-10-04_room_type_facility_menu.sql; this UPDATE is the fix for the ones that
--    already ran the broken version.
--
--    NOTE: 2026-10-05_loyalty_rename_and_room_media_move.sql hides 1195 again on
--    purpose (room media moved to Booking Engine Setup) and sorts after this file, so
--    that decision wins on a fresh run.
UPDATE menus
   SET status = 1,
       sort   = 1
 WHERE id = 1195;

-- 2. "Room Photo" under Booking Engine Setup (1091), right after "Room" (1092).
--
--    child_type is left NULL, matching its sibling 1092. `place` in the menu API is the
--    node's OWN child_type, not its parent's, so setting it here would not make the tab
--    strip render. What makes the strip render is `?parent=1091` on the rewritten url:
--    common/tab looks up `place` of the node whose id equals ?parent= (1091, which is a
--    'table' menu) and shows the sibling tabs when it is 'table'.
--
--    id 1196 continues the 1190-1195 block, the highest id allocated so far.
INSERT INTO menus (id, parent_id, name, url, visibility, sort, status, "left", "right")
VALUES (
  1196,
  1091,
  '{"en":"Room Photo","id":"Room Photo"}',
  '/master-setup/room-type/image',
  'room-type-image',
  20,
  1,
  0,
  0
)
ON CONFLICT (id) DO UPDATE
   SET parent_id  = EXCLUDED.parent_id,
       name       = EXCLUDED.name,
       url        = EXCLUDED.url,
       visibility = EXCLUDED.visibility,
       sort       = EXCLUDED.sort,
       status     = EXCLUDED.status;

-- Permission mirrors its SIBLING 1092 ("Room"), not the Room Type tree. A role that
-- can open Booking Engine Setup > Room can now open Room Photo from the same strip.
-- ON CONFLICT DO NOTHING: a role granted the tab separately keeps whatever it has, and
-- re-running the seed never revokes access.
INSERT INTO role_menu_crud (role_id, menu_id, view, "add", edit, "delete", transaction_actions)
SELECT role_id, 1196, view, "add", edit, "delete", transaction_actions
  FROM role_menu_crud
 WHERE menu_id = 1092
ON CONFLICT (role_id, menu_id) DO NOTHING;

-- The screen it points at is gated by menu 1120 (Master Setup > Room Type) in
-- content.routes.ts. Any role that reaches Booking Engine Setup but not 1120 would get
-- a 403 on the list, so grant 1120 view/add/edit/delete to the same roles. Mirrors what
-- the reference does for every other cross-menu screen.
--
-- The flag columns are boolean in this schema (`role_menu_crud.view` is `boolean`, not
-- int), so the literals are `true`, not 1.
INSERT INTO role_menu_crud (role_id, menu_id, view, "add", edit, "delete", transaction_actions)
SELECT DISTINCT role_id, 1120, true, true, true, true, NULL
  FROM role_menu_crud
 WHERE menu_id = 1196
ON CONFLICT (role_id, menu_id) DO NOTHING;

COMMIT;

-- Verification:
--   select id, parent_id, url, visibility, status, child_type from menus where id in (1195, 1196);
--   select menu_id, count(*) from role_menu_crud where menu_id in (1195, 1196) group by 1;
--
-- Then, from the app:
--   GET /cms/menu/get-parent-by-id-children/1091  -> children must include 1196 with
--                                                    status {value: 1}
--   GET /cms/content/room/config-image?room_type_id=<id>  -> data must be an ARRAY