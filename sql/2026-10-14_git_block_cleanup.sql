-- =====================================================================
--  Cleanup: GIT blocks created while the "qty defaults to 1" bug was live
-- =====================================================================
--  Run this yourself. Nothing below is applied automatically.
--
--  Background
--  ----------
--  backend-node/src/controllers/reservation.controller.ts used to do
--      const qty = Number(roomItem.qty) > 0 ? Number(roomItem.qty) : 1;
--  so every row of the room-git grid that the user never typed a Qty into
--  still produced one sub-folio. A block where the guest booked 2 rooms of
--  one room type came back with one sub-folio per room type in the hotel,
--  each priced 0,00 (the frontend was also dropping `rate_id`).
--  Laravel's `for ($i = 0; $i < $value['qty']; $i++)` creates nothing for a
--  blank Qty; the code now matches that.
--
--  Step 1 - LOOK FIRST. This is read-only; run it before anything else.
-- =====================================================================

SELECT
    p.id                                        AS parent_folio_id,
    p.folio_number                           AS parent_folio,
    p.property_id,
    p.company_profile_id,
    p.check_in_date,
    p.check_out_date,
    p.status_reservation,
    p.created_at,
    count(DISTINCT c.id)                     AS sub_folios,
    count(r.id)                              AS reservation_rows,
    count(r.id) FILTER (WHERE r.rate_id IS NULL) AS rows_without_rate,
    count(r.id) FILTER (WHERE r.amount = 0)     AS rows_zero_amount,
    string_agg(DISTINCT c.folio_number, ', ' ORDER BY c.folio_number) AS sub_folios_detail
FROM folios p
JOIN folios c  ON c.parent = p.id AND c.deleted_at IS NULL
LEFT JOIN reservations r ON r.folio_id = c.id AND r.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND p.type_reservation = 'git'
  AND p.parent = 0
  AND p.status_reservation <> 2          -- not cancelled
GROUP BY p.id, p.folio_number, p.property_id, p.company_profile_id,
         p.check_in_date, p.check_out_date, p.status_reservation, p.created_at
-- Only the null-rate fingerprint. Do NOT widen this to "more than one
-- sub-folio": a legitimate 5-room group block has more than one sub-folio and
-- would be swept up along with the broken ones.
HAVING count(r.id) FILTER (WHERE r.rate_id IS NULL) > 0
ORDER BY p.created_at DESC;


-- =====================================================================
--  Step 2 - DRY RUN the delete for ONE folio you picked from step 1.
--  Replace :parent_folio_id with the id you want to clean.
--  Read the rows back before running the real DELETE.
-- =====================================================================

-- 2a. what will be removed
SELECT c.id, c.folio_number, c.status_reservation, c.check_in_date, c.check_out_date,
       (SELECT count(*) FROM reservations r WHERE r.folio_id = c.id AND r.deleted_at IS NULL) AS resv_rows
FROM folios c
WHERE c.parent = :parent_folio_id
  AND c.deleted_at IS NULL;

-- 2b. any money already posted against those sub-folios? If this returns rows,
--     DO NOT delete - it means the folio was used. Cancel it through the UI instead.
SELECT t.id, t.folio_id, t.code_id, t.type_amount, t.total, t.created_at
FROM transactions t
WHERE t.folio_id IN (SELECT id FROM folios WHERE parent = :parent_folio_id AND deleted_at IS NULL)
  AND t.deleted_at IS NULL;

SELECT l.id, l.folio_id, l.code_billing_id
FROM ledgers l
WHERE l.folio_id IN (SELECT id FROM folios WHERE parent = :parent_folio_id AND deleted_at IS NULL)
  AND l.deleted_at IS NULL;


-- =====================================================================
--  Step 3 - ACTUAL DELETE. Soft-delete, same shape the app itself writes
--  (deleted_at + deleted_by), so nothing cascades destructively.
--  Only run this if 2b came back empty.
-- =====================================================================

BEGIN;

UPDATE reservations
SET deleted_at = now(),
    deleted_by = 185
WHERE deleted_at IS NULL
  AND folio_id IN (SELECT id FROM folios WHERE parent = :parent_folio_id AND deleted_at IS NULL);

UPDATE folios
SET deleted_at = now(),
    deleted_by = 185
WHERE deleted_at IS NULL
  AND parent = :parent_folio_id;

-- rollback;   -- change to COMMIT once the counts above look right

COMMIT;


-- =====================================================================
--  Step 4 - verify
-- =====================================================================

SELECT p.folio_number,
       count(c.id) AS remaining_sub_folios
FROM folios p
LEFT JOIN folios c ON c.parent = p.id AND c.deleted_at IS NULL
WHERE p.id = :parent_folio_id
GROUP BY p.folio_number;


-- =====================================================================
--  Optional: the parent block itself is only meaningful with rooms.
--  Find GIT parents with ZERO live sub-folios (created by an all-blank Qty
--  grid). Nothing in the app renders these, so they are safe to soft-delete.
-- =====================================================================

SELECT id, folio_number, property_id, guest_profile_id, company_profile_id,
       check_in_date, check_out_date, created_at
FROM folios p
WHERE p.deleted_at IS NULL
  AND p.type_reservation = 'git'
  AND p.parent = 0
  AND NOT EXISTS (
      SELECT 1 FROM folios c WHERE c.parent = p.id AND c.deleted_at IS NULL
  )
ORDER BY created_at DESC;