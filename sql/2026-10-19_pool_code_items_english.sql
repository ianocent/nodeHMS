-- ===========================================================================
-- 2026-10-19_pool_code_items_english.sql
-- Ganti label seed code_items "Pool Items" ke English (data, bukan UI).
-- Idempotent; hanya sentuh item yang masih pakai label Indonesia bawaan seed.
-- All-time guard: manapun qty/price plat tidak diubah — hanya name/description.
-- ===========================================================================

BEGIN;

UPDATE public.code_items
   SET name = 'Pool Towel (Large)', description = 'Large pool towel (optional deposit)'
 WHERE name = 'Handuk Kolam'
   AND description = 'Handuk besar kolam (deposit optional)';

UPDATE public.code_items
   SET name = 'Hand Towel', description = 'Small hand towel'
 WHERE name = 'Handuk Hand'
   AND description = 'Handuk kecil / hand towel';

UPDATE public.code_items
   SET name = 'Locker (Rental)', description = 'Locker rental per session'
 WHERE name = 'Locker (Sewa)'
   AND description = 'Sewa locker per sesi';

UPDATE public.code_items
   SET name = 'Umbrella Chair', description = 'Poolside chair + umbrella rental per session'
 WHERE name = 'Kursi Payung'
   AND description = 'Sewa kursi + payung poolside per sesi';

UPDATE public.code_items
   SET name = 'Shampoo / Soap', description = 'Poolside toiletries'
 WHERE name = 'Sampo / Sabun'
   AND description = 'Toiletries poolside';

UPDATE public.code_items
   SET name = 'Dive Rashguard', description = 'Rashguard / dive shirt rental'
 WHERE name = 'Kaos Selam'
   AND description = 'Sewa rashguard / kaos selam';

-- foot report
SELECT ci.name, ci.description FROM public.code_items ci
JOIN public.code_posts cp ON cp.id = ci.code_post_id
WHERE cp.name = 'Pool Items'
ORDER BY ci.sort;

COMMIT;
