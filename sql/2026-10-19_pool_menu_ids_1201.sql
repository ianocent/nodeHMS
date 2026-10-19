-- ===========================================================================
-- 2026-10-19_pool_menu_ids_1201.sql
--
-- FIX: 2026-10-18_pool_menu.sql (ids 1190-1195) di-ABORT oleh guard DO $$ karena
-- id 1190-1195 SUDAH dipakai modul lain di DB ini (Loyalty Facility/Terms/
-- Reward/Redemption/Guest Point + Room Facility). Menu Pool tidak pernah masuk.
--
-- Fix: geser semua id Pool ke blok bebas 1201-1206 (MAX(id) lama = 1200,
-- "Initial Setup"). Konstanta menu id di kode backend/frontend ikut digeser:
--   1201 parent Pool · 1202 Area · 1203 Setup · 1204 Attendance
--   1205 Usage     · 1206 Recap
-- Idempotent & defensif (rollback bila id bentrok).
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  v_conflict TEXT;
BEGIN
  SELECT string_agg(id::text, ', ') INTO v_conflict
    FROM public.menus
   WHERE id BETWEEN 1201 AND 1206
     AND name::jsonb IS DISTINCT FROM '{"en":"Pool"}'::jsonb
     AND name::jsonb IS DISTINCT FROM '{"en":"Pool Area"}'::jsonb
     AND name::jsonb IS DISTINCT FROM '{"en":"Pool Setup"}'::jsonb
     AND name::jsonb IS DISTINCT FROM '{"en":"Pool Attendance"}'::jsonb
     AND name::jsonb IS DISTINCT FROM '{"en":"Pool Usage"}'::jsonb
     AND name::jsonb IS DISTINCT FROM '{"en":"Pool Recap"}'::jsonb;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'menu id % sudah terpakai modul lain - pool menu dibatalkan', v_conflict;
  END IF;
END $$;

-- ── 1. parent container -------------------------------------------------------
INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1201, 157,
       '{"en":"Pool","id":"Pool"}',
       '/house-keeping/pool', NULL, 0, NULL, NULL,
       (SELECT COALESCE(MAX("left"), 0) + 1 FROM public.menus),
       (SELECT COALESCE(MAX("right"), 0) + 2 FROM public.menus),
       NULL, 1, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1201);

-- ── 2. anak-anak (sort = urutan tampil) ----------------------------------------
INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1202, 1201, '{"en":"Pool Area","id":"Pool Area"}',
       '/house-keeping/pool/area',        NULL, 0, NULL, NULL, 0, 0, NULL, 1, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1202);

INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1203, 1201, '{"en":"Pool Setup","id":"Pool Setup"}',
       '/house-keeping/pool/setup',       NULL, 0, NULL, NULL, 0, 0, NULL, 2, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1203);

INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1204, 1201, '{"en":"Pool Attendance","id":"Pool Attendance"}',
       '/house-keeping/pool/attendance',  NULL, 0, NULL, NULL, 0, 0, NULL, 3, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1204);

INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1205, 1201, '{"en":"Pool Usage","id":"Pool Usage"}',
       '/house-keeping/pool/usage',       NULL, 0, NULL, NULL, 0, 0, NULL, 4, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1205);

INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1206, 1201, '{"en":"Pool Recap","id":"Pool Recap"}',
       '/house-keeping/pool/recap',       NULL, 0, NULL, NULL, 0, 0, NULL, 5, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1206);

-- ── 3. grant CRUD + transaction_actions ke super-admin ------------------------
-- 1201 parent: view saja (container)
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1201, true, false, false, false, NULL, now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1202 Pool Area: manage_pool_master
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1202, true, true, true, true,
       '{"manage_pool_master":true}', now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1203 Pool Setup: manage_pool_master
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1203, true, true, true, true,
       '{"manage_pool_master":true}', now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1204 Pool Attendance: check-in/out + override
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1204, true, true, true, true,
       '{"check_in_pool":true,"check_out_pool":true,"override_attendance":true}', now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1205 Pool Usage: post + void charge folio
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1205, true, true, true, true,
       '{"post_pool_usage":true,"void_pool_usage":true}', now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 1206 Pool Recap: view saja
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1206, true, false, false, false, NULL, now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ── 4. legacy pivot isaccess (Role::menu()) -----------------------------------
INSERT INTO public.model_has_menus (menu_id, model_type, model_id)
SELECT m.id, 'App\Models\Role', r.id
  FROM public.roles r
  JOIN (VALUES (1201),(1202),(1203),(1204),(1205),(1206)) AS m(id) ON TRUE
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ── report --------------------------------------------------------------------
SELECT m.id, m.name, m.parent_id, m.url,
       (SELECT count(*) FROM public.role_menu_crud c WHERE c.menu_id = m.id) AS roles_granted
 FROM public.menus m
 WHERE m.id BETWEEN 1201 AND 1206
 ORDER BY m.id;

COMMIT;
