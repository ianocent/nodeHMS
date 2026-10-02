-- =====================================================================
--  Guest Profile: quick-create wizard + mandatory check-in fields
--  Target : PostgreSQL (Laragon)  db = hms_anyaman
--  Run    : psql -U postgres -h localhost -d hms_anyaman -f <this file>
--
--  Kenapa:
--  1) Front desk butuh bikin nama tamu cepat (title + first + last)
--     saat bikin reservasi. Data detail diisi menyusul.
--  2) Kalau tamu sudah di kamar, check-in WAJIB profile lengkap.
--     Gate ini sudah ada di backend (front-desk.controller.ts
--     performCheckIn) tapi kolomnya belum pernah ada di database,
--     jadi query-nya error dan di-swallow -> gate tidak pernah jalan.
--
--  CATATAN PENTING (wajib dibaca sebelum meng-enable):
--  Kolom ini berupa daftar NAMA KOLOM guest_profiles yang wajib
--  terisi sebelum check-in boleh jalan. Kalau daftarnya terlalu
--  panjang, tamu lama yang datanya tidak lengkap akan tertahan
--  check-in. Cek dulu pakai query verifikasi di bagian BAWAH.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Kolomnya
-- ---------------------------------------------------------------------
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS mandatory_check_in jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN properties.mandatory_check_in IS
  'Daftar kolom guest_profiles yang wajib terisi sebelum check-in (Laravel Property::$mandatory_check_in).';

-- ---------------------------------------------------------------------
-- 2) Backfill aman: semua property kosong (perilaku lama = tidak nge-block)
-- ---------------------------------------------------------------------
UPDATE properties
   SET mandatory_check_in = '[]'::jsonb
 WHERE mandatory_check_in IS NULL;

-- ---------------------------------------------------------------------
-- 3) Daftar field yang valid.
--    Hanya kolom yang benar-benar ada di tabel guest_profiles.
--    (label frontend "Mandatory Check-in" = list ini)
-- ---------------------------------------------------------------------
--  card_type        : tipe ID (KTP/Paspor/SIM)
--  card_number      : nomor ID
--  card_expiry      : tanggal berlaku ID
--  birth_of_date    : tanggal lahir
--  gender           : gender
--  nationality_id   : nationality
--  email            : email
--  mobile_phone     : nomor HP
--  telp             : nomor telepon
--  address          : alamat
--  region           : region
--  country_id       : negara
--  city_id          : kota
--  postal_code      : kode pos

-- ---------------------------------------------------------------------
-- 4)Contoh: menyalakan gate untuk satu property saja.
--    HAPUS / SESUAIKAN property id-nya, jangan langsung semua.
--
--    Ganti 1000 -> id property yang mau dipakai.
-- ---------------------------------------------------------------------
-- UPDATE properties
--    SET mandatory_check_in = '["card_type","card_number","card_expiry","birth_of_date","gender","nationality_id"]'::jsonb
--  WHERE id = 1000;

-- ---------------------------------------------------------------------
-- 5) Kalau data property lama sudah terlanjur tersimpan dengan nama
--    field yang SALAH (versi frontend lama: id_expired, birth_date,
--    nationality, phone, city, country), normalkan di sini.
--    Aman dijalankan berkali-kali.
-- ---------------------------------------------------------------------
UPDATE properties
   SET mandatory_check_in = (
         SELECT COALESCE(jsonb_agg(
                  CASE v
                    WHEN 'id_expired'   THEN '"card_expiry"'
                    WHEN 'birth_date'   THEN '"birth_of_date"'
                    WHEN 'nationality'  THEN '"nationality_id"'
                    WHEN 'phone'        THEN '"telp"'
                    WHEN 'city'         THEN '"city_id"'
                    WHEN 'country'      THEN '"country_id"'
                    ELSE to_jsonb(v::text)
                  END ORDER BY ord), '[]'::jsonb)
           FROM jsonb_array_elements_text(mandatory_check_in) WITH ORDINALITY AS t(v, ord)
        )
 WHERE jsonb_typeof(mandatory_check_in) = 'array';

-- ---------------------------------------------------------------------
-- 6) Buang entri yang bukan kolom guest_profiles (biar tidak ada
--    check-in yang mustahil fulfilled).
-- ---------------------------------------------------------------------
UPDATE properties p
   SET mandatory_check_in = (
         SELECT COALESCE(jsonb_agg(to_jsonb(t.v::text) ORDER BY t.ord), '[]'::jsonb)
           FROM jsonb_array_elements_text(p.mandatory_check_in) WITH ORDINALITY AS t(v, ord)
          WHERE t.v IN (
                'card_type','card_number','card_expiry','birth_of_date','gender',
                'nationality_id','email','mobile_phone','telp','address',
                'region','country_id','city_id','postal_code'
              )
        )
 WHERE jsonb_typeof(p.mandatory_check_in) = 'array';

-- ---------------------------------------------------------------------
-- 7) VERIFIKASI
-- ---------------------------------------------------------------------

-- 7a. Isi per property
SELECT id, name, mandatory_check_in
  FROM properties
 WHERE deleted_at IS NULL
 ORDER BY id;

-- 7b. Checklist komprehensivitas seluruh tamu existing.
--     Angka "filled" yang jauh di bawah total = banyak tamu yang akan
--     KENA gate. Jangan enable property itu sebelum data dibersihkan.
SELECT
  count(*) FILTER (WHERE deleted_at IS NULL)                                            AS total,
  count(*) FILTER (WHERE deleted_at IS NULL AND card_type     IS NOT NULL)             AS card_type,
  count(*) FILTER (WHERE deleted_at IS NULL AND card_number   IS NOT NULL)             AS card_number,
  count(*) FILTER (WHERE deleted_at IS NULL AND card_expiry   IS NOT NULL)             AS card_expiry,
  count(*) FILTER (WHERE deleted_at IS NULL AND birth_of_date IS NOT NULL)             AS birth_of_date,
  count(*) FILTER (WHERE deleted_at IS NULL AND gender        IS NOT NULL)             AS gender,
  count(*) FILTER (WHERE deleted_at IS NULL AND nationality_id IS NOT NULL)           AS nationality_id,
  count(*) FILTER (WHERE deleted_at IS NULL AND email         IS NOT NULL AND email <> '')    AS email,
  count(*) FILTER (WHERE deleted_at IS NULL AND mobile_phone  IS NOT NULL AND mobile_phone <> '') AS mobile_phone,
  count(*) FILTER (WHERE deleted_at IS NULL AND telp          IS NOT NULL AND telp <> '')      AS telp,
  count(*) FILTER (WHERE deleted_at IS NULL AND address       IS NOT NULL AND address <> '')   AS address,
  count(*) FILTER (WHERE deleted_at IS NULL AND postal_code   IS NOT NULL AND postal_code <> '') AS postal_code
FROM guest_profiles;

-- 7d. Yang akan TERTAHAN check-in per property, hanya untuk property
--     yang mandatory_check_in-nya sudah aktif.
--     "blocked" = tamu yang punya minimal 1 field wajib kosong.
SELECT p.id AS property_id,
       p.name,
       p.mandatory_check_in,
       count(*) FILTER (WHERE g.deleted_at IS NULL) AS total_guest,
       count(*) FILTER (
         WHERE g.deleted_at IS NULL
           AND NOT (
             ('card_type'     NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.card_type,     '')) <> '')
            AND ('card_number'   NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.card_number,   '')) <> '')
            AND ('card_expiry'   NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.card_expiry,   '')) <> '')
            AND ('birth_of_date' NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR g.birth_of_date                   IS NOT NULL)
            AND ('gender'        NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.gender,        '')) <> '')
            AND ('nationality_id' NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR g.nationality_id IS NOT NULL)
            AND ('email'         NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.email,         '')) <> '')
            AND ('mobile_phone'  NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.mobile_phone,  '')) <> '')
            AND ('telp'          NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.telp,          '')) <> '')
            AND ('address'       NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.address,       '')) <> '')
            AND ('postal_code'   NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR btrim(COALESCE(g.postal_code,   '')) <> '')
            AND ('country_id'    NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR g.country_id                     IS NOT NULL)
            AND ('city_id'       NOT IN (SELECT jsonb_array_elements_text(p.mandatory_check_in)) OR g.city_id                        IS NOT NULL)
           )
       ) AS blocked
  FROM properties p
  LEFT JOIN guest_profiles g ON g.property_id = p.id
 WHERE jsonb_array_length(COALESCE(p.mandatory_check_in, '[]'::jsonb)) > 0
 GROUP BY p.id, p.name, p.mandatory_check_in
 ORDER BY p.id;