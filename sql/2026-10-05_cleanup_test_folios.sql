-- Cleanup folio hasil uji coba payment/pre-registration.
-- Dijalankan di database HMS (backend-node DATABASE_URL).
--
-- 47420, 47425, 47426  -> tiga folio yang disebut user
-- 47419, 47421-47424  -> orphan dari tes resolusi property (1003 / 1002), bukan booking nyata
--
-- TIDAK dihapus: guest_profiles 93431 (Rianto Dwi Putra) — isinya data pre-registration asli.

BEGIN;

-- ---------------------------------------------------------------- 1. PREVIEW
SELECT id, folio_number, booking_no, property_id, status_reservation, total_amount
FROM folios
WHERE id IN (47419, 47420, 47421, 47422, 47423, 47424, 47425, 47426)
ORDER BY id;

SELECT 'reservations' AS child_table, count(*) AS rows FROM reservations
  WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426)
UNION ALL SELECT 'transactions', count(*) FROM transactions
  WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426)
UNION ALL SELECT 'model_has_types', count(*) FROM model_has_types
  WHERE model_type LIKE '%Folio' AND model_id IN (47419,47420,47421,47422,47423,47424,47425,47426)
UNION ALL SELECT 'transaction_breakdowns', count(*) FROM transaction_breakdowns
  WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426)
UNION ALL SELECT 'deposit_payments', count(*) FROM deposit_payments
  WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426);

-- ---------------------------------------------------------------- 2. HAPUS (child dulu)
DELETE FROM reservations            WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426);
DELETE FROM transaction_breakdowns  WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426);
DELETE FROM deposit_payments        WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426);
DELETE FROM transactions            WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426);
DELETE FROM accountings             WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426);
DELETE FROM messages                WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426);
DELETE FROM billing_tos             WHERE folio_id IN (47419,47420,47421,47422,47423,47424,47425,47426);
DELETE FROM model_has_types
  WHERE model_type LIKE '%Folio' AND model_id IN (47419,47420,47421,47422,47423,47424,47425,47426);

-- ---------------------------------------------------------------- 3. HAPUS folio
DELETE FROM folios WHERE id IN (47419,47420,47421,47422,47423,47424,47425,47426);

-- ---------------------------------------------------------------- 4. VERIFIKASI
SELECT count(*) AS remaining FROM folios
  WHERE id IN (47419,47420,47421,47422,47423,47424,47425,47426);
SELECT id, account, first_name, last_name FROM guest_profiles WHERE id = 93431;

COMMIT;