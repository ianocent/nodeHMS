-- ===========================================================================
-- 2026-10-18_pool_tables.sql
--
-- Mobile-App-Optimize.md §5.3 — 7 tabel modul Swimming Pool:
--   pool_areas, pool_setups, pool_setup_areas, pool_attendances,
--   pool_attendance_checklists, pool_usages, pool_usage_items
-- Idempotent (CREATE TABLE IF NOT EXISTS — safe to run more than once).
--
-- Konvensi audit: kolom audit + deleted_at soft-delete seperti model hms lain.
-- FK ditulis sebagai referensi SQL (RESTRICT/SET NULL/CASCADE sesuai §5.3);
-- Prisma model-nya dibuat plain-column (style housekeeping_*) supaya model
-- existing tidak tersentuh.
-- Jalankan setelah memverifikasi: SELECT MAX(id) FROM menus; (lihat pool_menu.sql)
-- ===========================================================================

BEGIN;

-- 1. pool_areas — master area kolam -------------------------------------------
CREATE TABLE IF NOT EXISTS public.pool_areas (
  id             BIGSERIAL PRIMARY KEY,
  property_id    BIGINT      NOT NULL,
  code           VARCHAR(50) NOT NULL,
  name           VARCHAR(191) NOT NULL,
  area_type      VARCHAR(50),              -- 'main' | 'kids' | 'jacuzzi' | 'lounge'
  capacity       INTEGER DEFAULT 0,
  depth_meter    NUMERIC(5,2),
  location_note  TEXT,
  sort           INTEGER NOT NULL DEFAULT 0,
  status         BOOLEAN NOT NULL DEFAULT TRUE,
  current_status INTEGER NOT NULL DEFAULT 0,  -- 0=closed 1=open 2=maintenance
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
  created_by BIGINT, updated_by BIGINT, deleted_by BIGINT,
  CONSTRAINT pool_areas_code_per_property UNIQUE (code, property_id)
);
CREATE INDEX IF NOT EXISTS pool_areas_property_status_sort_idx
  ON public.pool_areas (property_id, status, sort);

-- 2. pool_setups — master checklist (mirror housekeeping_setups) ---------------
CREATE TABLE IF NOT EXISTS public.pool_setups (
  id            BIGSERIAL PRIMARY KEY,
  property_id   BIGINT      NOT NULL,
  code          VARCHAR(50) NOT NULL,
  item_name     VARCHAR(191) NOT NULL,
  category      VARCHAR(100),              -- 'equipment' | 'safety' | 'hygiene' | 'linen'
  used_by       VARCHAR(20) NOT NULL DEFAULT 'both',  -- 'attendant' | 'supervisor' | 'both'
  is_required   BOOLEAN NOT NULL DEFAULT TRUE,
  mandatory_check BOOLEAN NOT NULL DEFAULT FALSE,
  description   TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  status        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
  created_by BIGINT, updated_by BIGINT, deleted_by BIGINT,
  CONSTRAINT pool_setups_code_per_property UNIQUE (code, property_id)
);
CREATE INDEX IF NOT EXISTS pool_setups_property_category_sort_idx
  ON public.pool_setups (property_id, category, sort);

-- 3. pool_setup_areas — pivot (mirror housekeeping_setup_rooms) -----------------
CREATE TABLE IF NOT EXISTS public.pool_setup_areas (
  id            BIGSERIAL PRIMARY KEY,
  property_id   BIGINT NOT NULL,
  pool_setup_id BIGINT NOT NULL REFERENCES public.pool_setups(id) ON DELETE CASCADE,
  pool_area_id  BIGINT NOT NULL REFERENCES public.pool_areas(id)  ON DELETE CASCADE,
  qty           INTEGER NOT NULL DEFAULT 1,
  is_required   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  CONSTRAINT pool_setup_areas_unique UNIQUE (pool_setup_id, pool_area_id)
);
CREATE INDEX IF NOT EXISTS pool_setup_areas_property_idx
  ON public.pool_setup_areas (property_id);

-- 4. pool_attendances — Pilar A absensi petugas (mirror shifts) -----------------
CREATE TABLE IF NOT EXISTS public.pool_attendances (
  id              BIGSERIAL PRIMARY KEY,
  property_id     BIGINT NOT NULL,
  user_id         BIGINT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  pool_area_id    BIGINT REFERENCES public.pool_areas(id) ON DELETE SET NULL,
  attendance_date DATE   NOT NULL,
  shift_id        BIGINT REFERENCES public.shift_roster(id) ON DELETE SET NULL,
  check_in_at     TIMESTAMPTZ,
  check_out_at    TIMESTAMPTZ,
  check_in_by     BIGINT REFERENCES public.users(id) ON DELETE SET NULL,  -- front office
  check_out_by    BIGINT REFERENCES public.users(id) ON DELETE SET NULL,  -- front office
  status          INTEGER NOT NULL DEFAULT 0,
     -- 0 = draft (belum check-in)
     -- 1 = PRESENT    (check_in_at ada, dalam tolerance)
     -- 2 = LATE       (check_in_at > shift.time_start + tolerance)
     -- 3 = ABSENT     (server: shift ended, tidak ada check_in_at)  ← DI-HITUNG SERVER
     -- 4 = LEAVE     (cuti/izin, wajib alasan)
     -- 5 = INCOMPLETE (sudah keluar tapi checklist belum lengkap)
     -- 6 = OVERTIME   (check_out_at > shift.time_end)
  is_override     BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT,
  break_minutes   INTEGER DEFAULT 0,
  notes           TEXT,
  photo_in        TEXT,      -- nullable, OPSIONAL (§10 jawaban #1)
  photo_out       TEXT,      -- nullable, OPSIONAL
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
  created_by BIGINT, updated_by BIGINT, deleted_by BIGINT,
  CONSTRAINT pool_attendances_uniq UNIQUE (property_id, user_id, attendance_date, shift_id)
);
CREATE INDEX IF NOT EXISTS pool_attendances_property_date_idx
  ON public.pool_attendances (property_id, attendance_date);
CREATE INDEX IF NOT EXISTS pool_attendances_user_date_idx
  ON public.pool_attendances (user_id, attendance_date);
CREATE INDEX IF NOT EXISTS pool_attendances_area_date_idx
  ON public.pool_attendances (pool_area_id, attendance_date);
CREATE INDEX IF NOT EXISTS pool_attendances_status_date_idx
  ON public.pool_attendances (status, attendance_date);  -- rekap

-- 5. pool_attendance_checklists (mirror housekeeping_history_checklists) --------
CREATE TABLE IF NOT EXISTS public.pool_attendance_checklists (
  id                 BIGSERIAL PRIMARY KEY,
  pool_attendance_id BIGINT NOT NULL REFERENCES public.pool_attendances(id) ON DELETE CASCADE,
  pool_setup_id      BIGINT NOT NULL REFERENCES public.pool_setups(id)      ON DELETE CASCADE,
  qty_required       INTEGER NOT NULL DEFAULT 1,
  qty_checked        INTEGER NOT NULL DEFAULT 0,
  is_checked         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pool_attendance_checklists_attendance_idx
  ON public.pool_attendance_checklists (pool_attendance_id);
CREATE INDEX IF NOT EXISTS pool_attendance_checklists_setup_idx
  ON public.pool_attendance_checklists (pool_setup_id);

-- 6. pool_usages — Pilar B pemakaian tamu + charge folio ------------------------
CREATE TABLE IF NOT EXISTS public.pool_usages (
  id            BIGSERIAL PRIMARY KEY,
  property_id   BIGINT NOT NULL,
  usage_date    DATE   NOT NULL,
  folio_id      BIGINT REFERENCES public.folios(id) ON DELETE RESTRICT,  -- tamu in-house
  folio_number  VARCHAR(50),                 -- denormalisasi, untuk tampilan
  guest_name    VARCHAR(191),
  guest_id_card VARCHAR(50),
  pool_area_id  BIGINT REFERENCES public.pool_areas(id) ON DELETE SET NULL,
  swimmer_qty   INTEGER NOT NULL DEFAULT 1,
  usage_time    TIMESTAMPTZ,
  return_time   TIMESTAMPTZ,
  -- ── item pemakaian (handuk/towel/locker/dll) ──────────────────
  -- qty_total / amount_total adalah DENORMALISASI dari pool_usage_items
  -- supaya rekap harian tidak perlu JOIN.
  qty_total         INTEGER NOT NULL DEFAULT 0,
  amount_total      NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- ── status folio ────────────────────────────────────────────────
  -- 0 = DRAFT (belum charge)   1 = POSTED (sudah masuk folio)
  -- 2 = POSTED_PARTIAL        3 = VOID
  posting_status    INTEGER NOT NULL DEFAULT 0,
  posted_at         TIMESTAMPTZ,
  posted_by         BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  notes             TEXT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
  created_by BIGINT, updated_by BIGINT, deleted_by BIGINT
);
CREATE INDEX IF NOT EXISTS pool_usages_property_date_idx
  ON public.pool_usages (property_id, usage_date);
CREATE INDEX IF NOT EXISTS pool_usages_folio_date_idx
  ON public.pool_usages (folio_id, usage_date);
CREATE INDEX IF NOT EXISTS pool_usages_posting_date_idx
  ON public.pool_usages (posting_status, usage_date);
CREATE INDEX IF NOT EXISTS pool_usages_id_card_idx
  ON public.pool_usages (guest_id_card);

-- 7. pool_usage_items — detail item (handuk/towel) -------------------------------
CREATE TABLE IF NOT EXISTS public.pool_usage_items (
  id            BIGSERIAL PRIMARY KEY,
  property_id   BIGINT NOT NULL,
  pool_usage_id BIGINT NOT NULL REFERENCES public.pool_usages(id) ON DELETE CASCADE,
  code_item_id  BIGINT REFERENCES public.code_items(id) ON DELETE SET NULL,
     -- NULL = item bebas (tanpa charge / sudah termasuk paket)
  item_name     VARCHAR(191) NOT NULL,      -- snapshot nama (code_items bisa berubah)
  qty           INTEGER NOT NULL DEFAULT 1,
  unit_price    NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- relasi ke transactions saat sudah diposting, untuk traceability
  transaction_id BIGINT REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ,
  created_by BIGINT, updated_by BIGINT, deleted_by BIGINT
);
CREATE INDEX IF NOT EXISTS pool_usage_items_usage_idx
  ON public.pool_usage_items (pool_usage_id);
CREATE INDEX IF NOT EXISTS pool_usage_items_code_item_idx
  ON public.pool_usage_items (code_item_id);

COMMIT;

-- report
SELECT 'pool_areas' AS tbl, count(*) FROM public.pool_areas
UNION ALL SELECT 'pool_setups', count(*) FROM public.pool_setups
UNION ALL SELECT 'pool_setup_areas', count(*) FROM public.pool_setup_areas
UNION ALL SELECT 'pool_attendances', count(*) FROM public.pool_attendances
UNION ALL SELECT 'pool_attendance_checklists', count(*) FROM public.pool_attendance_checklists
UNION ALL SELECT 'pool_usages', count(*) FROM public.pool_usages
UNION ALL SELECT 'pool_usage_items', count(*) FROM public.pool_usage_items;
