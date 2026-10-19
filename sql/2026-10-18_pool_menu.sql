-- ===========================================================================
-- 2026-10-18_pool_menu.sql
--
-- Mobile-App-Optimize.md §5.5 — menu modul Swimming Pool (ids 1190–1195)
-- di bawah Housekeeping (parent 157) + grant super-admin (developer,
-- administrator, anyaman) + transaction_actions JSON.
--
-- PRE-FLIGHT (jalankan dulu, harap 1189 atau bebas 1190–1195):
--   SELECT MAX(id) FROM public.menus;
--
-- Idempotent & defensif: kalau salah satu id 1190–1195 sudah terpakai oleh
-- menu dengan nama BERBEDA, transaksi di-ROLLBACK (jangan timpa data lama).
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  v_conflict TEXT;
BEGIN
  SELECT string_agg(id::text, ', ') INTO v_conflict
    FROM public.menus
   WHERE id BETWEEN 1190 AND 1195
     AND name IS DISTINCT FROM '{"en":"Pool"}'::jsonb
     AND name IS DISTINCT FROM '{"en":"Pool Area"}'::jsonb
     AND name IS DISTINCT FROM '{"en":"Pool Setup"}'::jsonb
     AND name IS DISTINCT FROM '{"en":"Pool Attendance"}'::jsonb
     AND name IS DISTINCT FROM '{"en":"Pool Usage"}'::jsonb
     AND name IS DISTINCT FROM '{"en":"Pool Recap"}'::jsonb;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'menu id % sudah terpakai modul lain - pool menu dibatalkan', v_conflict;
  END IF;
END $$;

-- ── 1. parent container -------------------------------------------------------
INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1190, 157,
       '{"en":"Pool","id":"Pool"}',
       '/house-keeping/pool', NULL, 0, NULL, NULL,
       (SELECT COALESCE(MAX("left"), 0) + 1 FROM public.menus),
       (SELECT COALESCE(MAX("right"), 0) + 2 FROM public.menus),
       NULL, 1, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1190);

-- ── 2. anak-anak (sort = urutan tampil) ----------------------------------------
INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1191, 1190, '{"en":"Pool Area","id":"Pool Area"}',
       '/house-keeping/pool/area',        NULL, 0, NULL, NULL, 0, 0, NULL, 1, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1191);

INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1192, 1190, '{"en":"Pool Setup","id":"Pool Setup"}',
       '/house-keeping/pool/setup',       NULL, 0, NULL, NULL, 0, 0, NULL, 2, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1192);

INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1193, 1190, '{"en":"Pool Attendance","id":"Pool Attendance"}',
       '/house-keeping/pool/attendance',  NULL, 0, NULL, NULL, 0, 0, NULL, 3, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1193);

INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1194, 1190, '{"en":"Pool Usage","id":"Pool Usage"}',
       '/house-keeping/pool/usage',       NULL, 0, NULL, NULL, 0, 0, NULL, 4, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1194);

INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1195, 1190, '{"en":"Pool Recap","id":"Pool Recap"}',
       '/house-keeping/pool/recap',       NULL, 0, NULL, NULL, 0, 0, NULL, 5, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1195);

-- ── 3. grant CRUD + transaction_actions ke super-admin ------------------------
-- 1190 parent: view saja (container)
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1190, true, false, false, false, NULL, now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1191 Pool Area: manage_pool_master
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1191, true, true, true, true,
       '{"manage_pool_master":true}', now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1192 Pool Setup: manage_pool_master
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1192, true, true, true, true,
       '{"manage_pool_master":true}', now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1193 Pool Attendance: check-in/out + override
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1193, true, true, true, true,
       '{"check_in_pool":true,"check_out_pool":true,"override_attendance":true}', now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1194 Pool Usage: post + void charge folio
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1194, true, true, true, true,
       '{"post_pool_usage":true,"void_pool_usage":true}', now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1195 Pool Recap: view saja
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1195, true, false, false, false, NULL, now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ── 4. legacy pivot isaccess (Role::menu()) -----------------------------------
INSERT INTO public.model_has_menus (menu_id, model_type, model_id)
SELECT m.id, 'App\Models\Role', r.id
  FROM public.roles r
  JOIN (VALUES (1190),(1191),(1192),(1193),(1194),(1195)) AS m(id) ON TRUE
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

COMMIT;

-- report
SELECT m.id, m.parent_id, m.name, m.url,
       (SELECT count(*) FROM public.role_menu_crud c WHERE c.menu_id = m.id) AS roles_granted
  FROM public.menus m
 WHERE m.id BETWEEN 1190 AND 1195;
