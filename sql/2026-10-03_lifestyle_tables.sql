-- Booking Engine Setup (menu parent 1091) — lifestyle tables.
--
-- Reference models App\Models\PropertyLifestyleFacility / PropertyLifestyleTerm
-- (hmsBackend/hms-backend/app/Models) read these tables; the booking engine pulls
-- them through GET /middleware/lifestyle/properties
-- (MiddlewareBookingEngineController::lifestyleProperties, web.php:139).
-- They were never ported into the node/Postgres schema.
--
-- Column set copied from the legacy MySQL `draft_rndhms` DDL:
--   property_lifestyle_facilities(id, property_id, facility_key, label, icon, sort, status, created_at, updated_at)
--   property_lifestyle_terms(id, property_id, type, title, content, language, sort, status, created_at, updated_at)

BEGIN;

CREATE TABLE IF NOT EXISTS property_lifestyle_facilities (
  id          BIGSERIAL PRIMARY KEY,
  property_id BIGINT       NOT NULL,
  facility_key VARCHAR(100) NOT NULL,
  label       VARCHAR(255),
  icon        VARCHAR(100),
  sort        INTEGER      NOT NULL DEFAULT 0,
  status      SMALLINT     NOT NULL DEFAULT 1,
  created_at  TIMESTAMP(3),
  updated_at  TIMESTAMP(3),
  deleted_at  TIMESTAMP(3),
  created_by  BIGINT,
  updated_by  BIGINT,
  deleted_by  BIGINT
);

CREATE INDEX IF NOT EXISTS property_lifestyle_facilities_property_id_idx
  ON property_lifestyle_facilities (property_id);

CREATE TABLE IF NOT EXISTS property_lifestyle_terms (
  id          BIGSERIAL PRIMARY KEY,
  property_id BIGINT       NOT NULL,
  type        VARCHAR(100) NOT NULL,
  title       VARCHAR(255),
  content     TEXT,
  language    VARCHAR(10)  NOT NULL DEFAULT 'id',
  sort        INTEGER      NOT NULL DEFAULT 0,
  status      SMALLINT     NOT NULL DEFAULT 1,
  created_at  TIMESTAMP(3),
  updated_at  TIMESTAMP(3),
  deleted_at  TIMESTAMP(3),
  created_by  BIGINT,
  updated_by  BIGINT,
  deleted_by  BIGINT
);

CREATE INDEX IF NOT EXISTS property_lifestyle_terms_property_id_idx
  ON property_lifestyle_terms (property_id);

COMMIT;

-- Verification:
--   \d property_lifestyle_facilities
--   \d property_lifestyle_terms