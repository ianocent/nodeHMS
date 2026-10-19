-- ===========================================================================
-- 2026-10-18_pool_code_items_seed.sql
--
-- Mobile-App-Optimize.md §5.6 — seed code_posts + code_items untuk item
-- pemakaian Pool (handuk, locker, dll). Property-scoped: dibuat untuk
-- SEMUA property yang belum punya code_post 'POOL'. Idempotent.
--
-- Jalankan SETELAH 2026-10-18_pool_tables.sql (tabel pool_* harus ada),
-- sebelum user mulai memakai modul Pool Usage.
-- ===========================================================================

BEGIN;

-- 1. code_post 'Pool Items' per property (type DEFAULT, status ON)
--    NOTE: tabel code_posts TIDAK punya kolom code/description —
--    identitas uniknya = (property_id, type, name).
INSERT INTO public.code_posts (property_id, type, name, status, sort, created_at, updated_at)
SELECT p.id, 'DEFAULT', 'Pool Items', 1, 900, now(), now()
  FROM public.properties p
 WHERE p.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.code_posts cp
      WHERE cp.property_id = p.id
        AND cp.type = 'DEFAULT'
        AND cp.name = 'Pool Items'
   );

-- 2. code_items contoh (§5.6 daftar item wajib ada)
--    sales = harga charge folio; cost = biaya internal. qty 0 = stok tidak
--    dilacak (hanya counter), sesuai keputusan §5.6.
INSERT INTO public.code_items
    (property_id, code_post_id, name, description, sales, cost, sort, status, is_online, is_event, created_at, updated_at)
SELECT cp.property_id, cp.id, v.name, v.description, v.sales, v.cost, v.sort, 1, false, false, now(), now()
  FROM public.code_posts cp
  JOIN (VALUES
        ('Handuk Kolam',      'Handuk besar kolam (deposit optional)', 15000.0000, 30000.0000, 1),
        ('Handuk Hand',       'Handuk kecil / hand towel',             10000.0000, 20000.0000, 2),
        ('Locker (Sewa)',     'Sewa locker per sesi',                  10000.0000,     0.0000, 3),
        ('Kursi Payung',      'Sewa kursi + payung poolside per sesi', 25000.0000,     0.0000, 4),
        ('Sampo / Sabun',     'Toiletries poolside',                    5000.0000,  3000.0000, 5),
        ('Kaos Selam',        'Sewa rashguard / kaos selam',           20000.0000, 25000.0000, 6)
       ) AS v(name, description, sales, cost, sort) ON TRUE
 WHERE cp.type = 'DEFAULT' AND cp.name = 'Pool Items'
   AND NOT EXISTS (
     SELECT 1 FROM public.code_items ci
      WHERE ci.code_post_id = cp.id AND ci.name = v.name
   );

COMMIT;

-- report
SELECT p.name AS property, cp.id AS code_post_id,
       (SELECT count(*) FROM public.code_items ci WHERE ci.code_post_id = cp.id) AS items
  FROM public.code_posts cp
  JOIN public.properties p ON p.id = cp.property_id
 WHERE cp.type = 'DEFAULT' AND cp.name = 'Pool Items';
