-- Optimistic concurrency versioning for high-contention entities.
-- Safe to run multiple times.

DO $$
BEGIN
  -- folios
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='folios' AND column_name='version') THEN
    ALTER TABLE folios ADD COLUMN version bigint NOT NULL DEFAULT 1;
  END IF;
  -- reservations
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reservations' AND column_name='version') THEN
    ALTER TABLE reservations ADD COLUMN version bigint NOT NULL DEFAULT 1;
  END IF;
  -- transactions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='version') THEN
    ALTER TABLE transactions ADD COLUMN version bigint NOT NULL DEFAULT 1;
  END IF;
  -- rooms
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rooms' AND column_name='version') THEN
    ALTER TABLE rooms ADD COLUMN version bigint NOT NULL DEFAULT 1;
  END IF;
  -- housekeeper_history
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='housekeeper_history' AND column_name='version') THEN
    ALTER TABLE housekeeper_history ADD COLUMN version bigint NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Backfill
UPDATE folios SET version = 1 WHERE version IS NULL;
UPDATE reservations SET version = 1 WHERE version IS NULL;
UPDATE transactions SET version = 1 WHERE version IS NULL;
UPDATE rooms SET version = 1 WHERE version IS NULL;
UPDATE housekeeper_history SET version = 1 WHERE version IS NULL;

-- Trigger function: increment version on any UPDATE.
CREATE OR REPLACE FUNCTION increment_row_version()
RETURNS trigger AS $$
BEGIN
  NEW.version = COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach triggers (drop first for idempotency)
DROP TRIGGER IF EXISTS trg_folios_version ON folios;
CREATE TRIGGER trg_folios_version BEFORE UPDATE ON folios
  FOR EACH ROW EXECUTE FUNCTION increment_row_version();

DROP TRIGGER IF EXISTS trg_reservations_version ON reservations;
CREATE TRIGGER trg_reservations_version BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION increment_row_version();

DROP TRIGGER IF EXISTS trg_transactions_version ON transactions;
CREATE TRIGGER trg_transactions_version BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION increment_row_version();

DROP TRIGGER IF EXISTS trg_rooms_version ON rooms;
CREATE TRIGGER trg_rooms_version BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION increment_row_version();

DROP TRIGGER IF EXISTS trg_housekeeper_history_version ON housekeeper_history;
CREATE TRIGGER trg_housekeeper_history_version BEFORE UPDATE ON housekeeper_history
  FOR EACH ROW EXECUTE FUNCTION increment_row_version();

-- Indexes to keep version lookups fast
CREATE INDEX IF NOT EXISTS idx_reservations_folio_version ON reservations (folio_id, version);
CREATE INDEX IF NOT EXISTS idx_transactions_folio_version ON transactions (folio_id, version);
CREATE INDEX IF NOT EXISTS idx_housekeeper_history_room_version ON housekeeper_history (room_id, version);
