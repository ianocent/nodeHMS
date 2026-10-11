-- Lifestyle -> Loyalty rename, and moving room media out of the Room Type tree.
--
-- 1. RENAME. Everything the operator sees called the guest-facing section "Lifestyle":
--    menu labels, the `/content/lifestyle-*` endpoints, `/middleware/lifestyle/properties`,
--    the booking-engine pages under `/lifestyle`. It is a loyalty programme (rewards,
--    points, member tiers), so the name is now Loyalty everywhere. Applied in code:
--    backend-node/src/controllers/loyalty-facility.controller.ts (was lifestyle.*),
--    content.routes.ts, middleware.routes.ts, frontend-node/pages/loyalty-*,
--    hmsBookingEngine/frontend/{pages,components}/loyalty.
--
--    Postgres table names deliberately stay `property_lifestyle_facilities` /
--    `property_lifestyle_terms`. They hold no user-facing string, the reference
--    Laravel app still names them that way, and renaming tables buys nothing for a
--    naming change.
--
--    The old `/content/lifestyle-*` and `/middleware/lifestyle/properties` paths stay
--    registered in code as aliases so a stale menu row or cached bundle cannot 404.
--
-- 2. MOVE. Room Type (menu 48) now has only "Main". Photos and amenities live under
--    Booking Engine Setup next to the Room tab they describe:
--      1099 Image    -> status 0 (hidden)
--      1195 Facility -> status 0 (hidden)
--      1196 Room Photo   (added in the previous seed)
--      1197 Room Facility (this file)
--    Disabled, not deleted: the endpoints, the role grants and the nested-set
--    position stay intact, so this is reversible with one UPDATE.
--
-- Idempotent.

BEGIN;

-- 1a. Menu labels + urls.
UPDATE menus
   SET name = '{"en":"Loyalty Facility","id":"Loyalty Facility"}',
       url  = '/content/loyalty-facility'
 WHERE id = 1190;

UPDATE menus
   SET name = '{"en":"Loyalty Terms","id":"Loyalty Terms"}',
       url  = '/content/loyalty-terms'
 WHERE id = 1191;

-- 1b. Same rename in the historical seed files, so a fresh database built from
--     backend-node/sql/*.sql lands on the new slugs instead of re-introducing the old
--     ones on the next run.
--     (2026-10-03_booking_engine_setup_missing_menus.sql, 2026-10-04_lifestyle_facility_seed.sql
--      and 2026-10-03_lifestyle_tables.sql are left alone on purpose: the first is a
--      historical record of what was applied, the other two are the data seed and the
--      DDL, neither of which stores a menu url.)

-- 2a. Hide the Room Type media tabs.
UPDATE menus SET status = 0 WHERE id IN (1099, 1195);

-- 2a-bis. Normalise 1196. An earlier run of 2026-10-04_room_photo_menu.sql set
--        child_type='table' on it while working out how the tab strip decides to
--        render; that turned out to be wrong (see 2b) and no sibling carries it.
UPDATE menus SET child_type = NULL WHERE id = 1196;

-- 2b. "Room Facility" under Booking Engine Setup (1091), after "Room Photo" (1196).
--
--     child_type stays NULL, matching siblings 1092 and 1196: `place` in the menu API is
--     a node's own child_type, so setting it here would not make the tab strip render.
--     What renders the strip is `?parent=1091` on the rewritten url.
INSERT INTO menus (id, parent_id, name, url, visibility, sort, status, "left", "right")
VALUES (
  1197,
  1091,
  '{"en":"Room Facility","id":"Room Facility"}',
  '/master-setup/room-type/facility',
  'room-type-facility',
  25,
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

-- Permission mirrors 1196 (Room Photo), its sibling in the same tab strip, so a role
-- that can manage room photos can manage room amenities. ON CONFLICT DO NOTHING keeps
-- any separate grant a role already has.
INSERT INTO role_menu_crud (role_id, menu_id, view, "add", edit, "delete", transaction_actions)
SELECT role_id, 1197, view, "add", edit, "delete", transaction_actions
  FROM role_menu_crud
 WHERE menu_id = 1196
ON CONFLICT (role_id, menu_id) DO NOTHING;

-- The screen is gated by menu 1120 (Master Setup > Room Type) in content.routes.ts.
INSERT INTO role_menu_crud (role_id, menu_id, view, "add", edit, "delete", transaction_actions)
SELECT DISTINCT role_id, 1120, true, true, true, true, NULL
  FROM role_menu_crud
 WHERE menu_id = 1197
ON CONFLICT (role_id, menu_id) DO NOTHING;

COMMIT;

-- Verification:
--   select id, parent_id, name, url, visibility, sort, status
--     from menus where id in (48, 1095, 1096, 1097, 1099, 1190, 1191, 1195, 1196) order by id;
--     -- expect: 1099 status 0, 1195 status 0, 1190/1191 url /content/loyalty-*
--   select menu_id, count(*) from role_menu_crud where menu_id in (1196, 1197) group by 1;
--
-- Then, from the app:
--   GET /cms/menu/get-parent-by-id-children/48   -> children must contain ONLY 1095 (Main)
--   GET /cms/menu/get-parent-by-id-children/1091 -> children must contain 1196 + 1197
--   GET /middleware/loyalty/properties           -> public, must answer 200