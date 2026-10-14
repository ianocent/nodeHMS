-- ===========================================================================
-- 2026-10-12_initial_setup_menu.sql
--
-- Adds the "Initial Setup" menu (id 1200) under Master Setup, plus full CRUD
-- grants for the super-admin roles. Idempotent - safe to run more than once.
-- ===========================================================================

BEGIN;

-- 1. the menu itself
INSERT INTO public.menus
    (id, parent_id, name, url, visibility, target, media, data,
     "left", "right", child_type, sort, status, created_at, updated_at)
SELECT 1200, 9,
       '{"en":"Initial Setup","id":"Initial Setup"}',
       '/initial-setup', NULL, 0, NULL, NULL,
       (SELECT COALESCE(MAX("left"), 0) + 1 FROM public.menus),
       (SELECT COALESCE(MAX("right"), 0) + 2 FROM public.menus),
       NULL, 1, 1, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.menus WHERE id = 1200);

UPDATE public.menus
   SET parent_id = 9, url = '/initial-setup', status = 1, sort = 1, updated_at = now()
 WHERE id = 1200;

-- 2. attach it to every super-admin role (view / add / edit / delete)
INSERT INTO public.role_menu_crud (role_id, menu_id, view, add, edit, delete, transaction_actions, created_at, updated_at)
SELECT r.id, 1200, true, true, true, true, NULL, now(), now()
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 3. legacy "isaccess" pivot (Role::menu()) - required by RoleController
INSERT INTO public.model_has_menus (menu_id, model_type, model_id)
SELECT 1200, 'App\Models\Role', r.id
  FROM public.roles r
 WHERE r.name IN ('developer', 'administrator', 'anyaman')
   AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 4. make sure every role has a "Initial Setup" parent entry in the tree
--    (roles get the row only when an admin ticks it in Role Settings)

COMMIT;

-- 5. report
SELECT m.id, m.parent_id, m.name, m.url,
       (SELECT count(*) FROM public.role_menu_crud c WHERE c.menu_id = m.id) AS roles_granted
  FROM public.menus m
 WHERE m.id = 1200;
