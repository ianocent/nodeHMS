-- ============================================================================
-- Repair Postgres id sequences that are behind the table MAX(id).
--
-- WHY THIS EXISTS
-- ---------------
-- The MySQL -> Postgres migration copied rows with explicit ids but never
-- advanced the Postgres sequences. Postgres then keeps handing out ids that
-- are already taken, so every INSERT fails with:
--
--   Invalid `prisma.folios.create()` invocation ...
--   Unique constraint failed on the (not available)
--
-- Underlying driver error is `23505 duplicate key value violates unique
-- constraint "folios_pkey"` — a PRIMARY KEY clash, not a folio_number clash.
--
-- Prisma 7 with the pg driver adapter does not populate `error.meta.target`,
-- so retry-on-duplicate-folio_number logic cannot detect this and it
-- surfaces as a raw 500.
--
-- SAFE / IDEMPOTENT
--   - Only touches sequences (metadata), never table data.
--   - GREATEST(...) means re-running it is harmless.
--   - Never lowers a sequence that is already ahead.
--
-- USAGE (psql)
--   psql -h localhost -p 5432 -U postgres -d hms_anyaman -v ON_ERROR_STOP=1 \
--        -c "SET client_min_messages = NOTICE" -f sql/fix_id_sequence_sync.sql
--
-- USAGE (HeidiSQL)
--   Open the hms_anyaman database -> Query tab -> paste -> F5.
-- ============================================================================

SET client_min_messages = NOTICE;

DO $$
DECLARE
  r      RECORD;
  mx     BIGINT;
  lv     BIGINT;
  fixed  INTEGER := 0;
  scanned INTEGER := 0;
BEGIN
  FOR r IN
    SELECT sequencename
    FROM pg_sequences
    WHERE schemaname = 'public'
    ORDER BY sequencename
  LOOP
    IF to_regclass('public.' || replace(r.sequencename, '_id_seq', '')) IS NOT NULL THEN
      scanned := scanned + 1;

      EXECUTE format('SELECT MAX(id) FROM public.%I', replace(r.sequencename, '_id_seq', '')) INTO mx;
      EXECUTE format('SELECT last_value FROM %I', r.sequencename) INTO lv;

      IF mx IS NOT NULL AND mx > lv THEN
        RAISE NOTICE 'BEHIND % : max_id=% seq_last=% gap=%  -> advancing',
          replace(r.sequencename, '_id_seq', ''), mx, lv, mx - lv;

        EXECUTE format(
          'SELECT setval(%L, GREATEST((SELECT MAX(id) FROM public.%I), (SELECT last_value FROM %I)), true)',
          r.sequencename,
          replace(r.sequencename, '_id_seq', ''),
          r.sequencename
        );

        fixed := fixed + 1;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'Sequences scanned : %', scanned;
  RAISE NOTICE 'Sequences repaired: %', fixed;

  IF fixed = 0 THEN
    RAISE NOTICE 'All sequences already in sync — nothing to do.';
  END IF;
END $$;