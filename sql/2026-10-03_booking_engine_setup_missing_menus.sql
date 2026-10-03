-- Booking Engine Setup (menu parent 1091) — missing tabs.
--
-- Reference (hmsBackend/hms-backend/routes/cms.php:1432-1436) registers five
-- resources inside the `content` prefix that never made it into the node
-- migration, so they are absent from the `menus` table and unreachable in the UI:
--
--   Route::resource('lifestyle-facility',       LifestyleFacilityController::class);
--   Route::resource('lifestyle-terms',          LifestyleTermController::class);
--   Route::resource('loyalty-reward',           LoyaltyRewardController::class);
--   Route::resource('reward-redemption',        RewardRedemptionController::class);
--   Route::resource('guest-point-transaction',  GuestPointTransactionController::class);
--
-- The ids are FIXED (1190-1194) because the node routes gate on them
-- (backend-node/src/routes/content.routes.ts). Re-run is safe: every insert is
-- guarded by (parent_id, url) and the explicit id is skipped when already taken.

BEGIN;

CREATE TEMP TABLE be_setup_menus (label text PRIMARY KEY, url text NOT NULL, menu_id bigint) ON COMMIT DROP;

INSERT INTO be_setup_menus (label, url, menu_id) VALUES
  ('Lifestyle Facility',      '/content/lifestyle-facility',      1190),
  ('Lifestyle Terms',         '/content/lifestyle-terms',         1191),
  ('Loyalty Reward',          '/content/loyalty-reward',          1192),
  ('Reward Redemption',       '/content/reward-redemption',       1193),
  ('Guest Point Transaction', '/content/guest-point-transaction', 1194);

-- Nested-set bounds. Existing max(left)/max(right) is 491/492 and parent 1091 closes
-- at right=127, so 500+ keeps every new node outside the existing subtrees.
INSERT INTO menus (id, parent_id, name, url, visibility, uri_table, type_table, target,
                   media, data, "left", "right", sort, status, created_at, updated_at)
SELECT t.menu_id,
       1091,
       '{"en":"' || t.label || '","id":"' || t.label || '"}',
       t.url,
       '', '', '', 0, '',
       '{"image":{"icon":"https://rndhms.dipstrategy.co.id/theme/cms/images/Guest Requesst.svg"}}',
       500 + row_number() OVER (ORDER BY t.menu_id),
       501 + row_number() OVER (ORDER BY t.menu_id),
       10, 1, now(), now()
FROM be_setup_menus t
WHERE NOT EXISTS (
  SELECT 1 FROM menus m WHERE m.parent_id = 1091 AND m.url = t.url
)
ON CONFLICT (id) DO NOTHING;

-- If the url already existed under a different id, adopt that id for the permissions.
UPDATE be_setup_menus t
SET menu_id = m.id
FROM menus m
WHERE m.parent_id = 1091 AND m.url = t.url;

-- Permissions are copied from the Banner tab (menu 1094) so every role that can see
-- Booking Engine Setup also sees the new tabs. The CRUD flags follow the reference
-- controllers:
--   LifestyleFacility / LifestyleTerm / LoyaltyReward -> full CRUD
--   RewardRedemption       -> view + edit only  (store/destroy answer 400 by design)
--   GuestPointTransaction  -> view only         (read-only ledger)
INSERT INTO role_menu_crud (role_id, menu_id, view, add, edit, "delete")
SELECT r.role_id, t.menu_id, r.view, r.add, r.edit, r."delete"
FROM role_menu_crud r
JOIN be_setup_menus t ON t.label IN ('Lifestyle Facility', 'Lifestyle Terms', 'Loyalty Reward')
WHERE r.menu_id = 1094
ON CONFLICT (role_id, menu_id) DO NOTHING;

INSERT INTO role_menu_crud (role_id, menu_id, view, add, edit, "delete")
SELECT r.role_id, t.menu_id, r.view, false, r.edit, false
FROM role_menu_crud r
JOIN be_setup_menus t ON t.label = 'Reward Redemption'
WHERE r.menu_id = 1094
ON CONFLICT (role_id, menu_id) DO NOTHING;

INSERT INTO role_menu_crud (role_id, menu_id, view, add, edit, "delete")
SELECT r.role_id, t.menu_id, r.view, false, false, false
FROM role_menu_crud r
JOIN be_setup_menus t ON t.label = 'Guest Point Transaction'
WHERE r.menu_id = 1094
ON CONFLICT (role_id, menu_id) DO NOTHING;

SELECT setval('menus_id_seq', (SELECT max(id) FROM menus));

COMMIT;

-- Verification:
--   select id, name, url from menus where parent_id = 1091 order by sort;
--   select t.menu_id, m.url, count(*) as roles
--     from role_menu_crud t join menus m on m.id = t.menu_id
--    where m.parent_id = 1091 group by 1,2 order by 1;