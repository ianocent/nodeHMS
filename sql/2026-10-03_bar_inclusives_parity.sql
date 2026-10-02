-- =============================================================================
-- bar_inclusives: bring the table up to Laravel parity
-- =============================================================================
-- Why:
--   Laravel 2024_03_01_000000_create_bar_table.php defines bar_inclusives with
--   stock / created_at / deleted_at / userstamps / sort / status, and
--   App\Models\BarInclusive::formatTable() renders a "Stock" select column whose
--   options are CodeItem rows. The table that actually exists in Postgres is
--   missing all of those columns, so a BAR Setup "Inclusive" row can never be
--   stored: the Node handler writes to prisma.rate_inclusives, and even a direct
--   bar_inclusives insert has nowhere to put `stock`.
--
--   Symptoms: POST /api/cms/bar/inclusives -> HTTP 500 "Failed to create rate
--   inclusive"; the Stock column renders (it comes from the `table` metadata in
--   the response) but nothing can be saved against it.
--
-- Safe to run more than once: every statement is IF NOT EXISTS.
-- Verified against: Postgres (hms_anyaman), checked 2026-10-03.
-- =============================================================================

BEGIN;

-- --- Item Code the inclusive row draws stock from -----------------------------
-- Laravel: $table->integer('stock')->default(0);
-- BarInclusive::codeItem() belongsTo(CodeItem::class, 'stock'), so this holds a
-- code_items.id. BigInt rather than integer to match every other id column in
-- this schema and to avoid an overflow on a large code_items table.
ALTER TABLE bar_inclusives
  ADD COLUMN IF NOT EXISTS stock bigint DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bar_inclusives_stock_fkey'
  ) THEN
    ALTER TABLE bar_inclusives
      ADD CONSTRAINT bar_inclusives_stock_fkey
      FOREIGN KEY (stock) REFERENCES code_items(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- --- Timestamps --------------------------------------------------------------
-- Laravel: $table->timestamps();
-- updated_at already exists; created_at does not.
ALTER TABLE bar_inclusives
  ADD COLUMN IF NOT EXISTS created_at timestamp(3) without time zone;

-- --- Soft deletes ------------------------------------------------------------
-- Laravel: $table->softDeletes();
-- BarInclusive uses the SoftDeletes trait, so the list query needs to filter
-- deleted_at IS NULL once rows can be removed.
ALTER TABLE bar_inclusives
  ADD COLUMN IF NOT EXISTS deleted_at timestamp(3) without time zone;

-- --- User stamps -------------------------------------------------------------
-- Laravel: $table->userstamps()  ->  created_by / updated_by / deleted_by.
-- updated_by already exists; the other two do not.
ALTER TABLE bar_inclusives
  ADD COLUMN IF NOT EXISTS created_by bigint;
ALTER TABLE bar_inclusives
  ADD COLUMN IF NOT EXISTS deleted_by bigint;

-- --- Ordering ----------------------------------------------------------------
-- Laravel: $table->integer('sort')->default(0);
ALTER TABLE bar_inclusives
  ADD COLUMN IF NOT EXISTS sort integer NOT NULL DEFAULT 0;

-- --- Status ------------------------------------------------------------------
-- Laravel: $table->integer('status')->default(0);
-- BarInclusive uses the HasStatus trait. Existing rows keep status 0 (Inactive),
-- matching the Laravel default rather than being silently activated.
ALTER TABLE bar_inclusives
  ADD COLUMN IF NOT EXISTS status integer NOT NULL DEFAULT 0;

-- --- Indexes used by the list query -----------------------------------------
CREATE INDEX IF NOT EXISTS bar_inclusives_bar_id_deleted_at_idx
  ON bar_inclusives (bar_id, deleted_at);

-- --- Keep the id sequence aligned with the current max id -------------------
-- Without this the next insert collides with an existing id whenever rows were
-- loaded by an import or a dump restore.
SELECT setval(
  pg_get_serial_sequence('bar_inclusives', 'id'),
  COALESCE((SELECT MAX(id) FROM bar_inclusives), 1),
  EXISTS (SELECT 1 FROM bar_inclusives)
);

COMMIT;


-- =============================================================================
-- Verification — run after applying, all of these should hold
-- =============================================================================
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'bar_inclusives'
--  ORDER BY ordinal_position;
--   Expect 15 columns: the 9 that already existed plus stock, created_at,
--   deleted_at, created_by, deleted_by, sort, status.
--
-- SELECT indexname FROM pg_indexes WHERE tablename = 'bar_inclusives';
--   Expect bar_inclusives_bar_id_deleted_at_idx in addition to the 3 that
--   already existed.
--
-- Confirm the new FK is present and usable:
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'bar_inclusives'::regclass
--    AND conname = 'bar_inclusives_stock_fkey';
--
-- After the Node handler is pointed at this table (see
-- src/controllers/rate-addon.controller.ts), POST /api/cms/bar/inclusives with a
-- real bar_id should return 200 and the row should be readable back from
-- bar_inclusives.
