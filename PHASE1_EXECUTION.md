# Panduan Eksekusi Phase 1
## Migrasi Database & Setup Arsitektur

**Status Sekarang**: Siap mulai

**Prasyarat**:
- ✅ PostgreSQL jalan di Laragon
- ✅ MySQL jalan di Laragon
- ✅ Node.js keinstall
- ✅ `.env` diatur buat Laragon

---

## Eksekusi Step-by-Step

### Step 1: Benerin Prisma Schema (Ekstrak dari MySQL)

```bash
# Update .env buat baca dari MySQL
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"

# Tarik schema dari MySQL dan generate Prisma schema yang bener
npm run phase1:schema

# Ini bakal:
# - Connect ke MySQL
# - Introspect semua 186 tabel
# - Generate Prisma schema dengan syntax yang bener
# - Generate Prisma client
```

**Output yang Diharapkan**:
```
Introspected 186 models from MySQL database
Generated Prisma schema with all models
Generated Prisma client
```

**Waktu**: ~2 menit

---

### Step 2: Migrasi Schema ke PostgreSQL

```bash
# Balikin ke PostgreSQL
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"

# Bikin tabel PostgreSQL dari Prisma schema
npm run phase1:tables

# Ini bakal:
# - Generate SQL migration dari schema
# - Apply migration ke PostgreSQL
# - Bikin semua 186 tabel dengan struktur yang bener
```

**Output yang Diharapkan**:
```
Creating migration from current schema
Executing migration
Migration applied successfully
```

**Waktu**: ~1-2 menit

---

### Step 3: Install Dependensi

```bash
# Install konektor MySQL buat script migrasi data
npm install

# Ini nambahin mysql2 ke node_modules
```

**Waktu**: ~3-5 menit

---

### Step 4: Compile TypeScript

```bash
# Compile script ke JavaScript
npm run build

# Ini ngasilin folder dist/ berisi script yang udah kecompile
```

**Waktu**: ~1 menit

---

### Step 5: Migrasi Data

```bash
# Jalanin migrasi data dari MySQL ke PostgreSQL
npm run phase1:data

# Ini bakal:
# - Connect ke MySQL dan PostgreSQL
# - Baca semua data dari MySQL (186 tabel)
# - Insert data ke PostgreSQL
# - Handle konversi tipe (decimal, datetime, dll)
# - Skip error duplicate key
# - Report progress
```

**Output yang Diharapkan**:
```
Found 186 tables to migrate

accountings: 32360 rows migrated
allocation_accountings: 0 rows
... (masih banyak tabel lain) ...

✓ Migration complete: XXXXX total rows migrated
```

**Waktu**: 5-15 menit (tergantung volume data)

---

### Step 6: Verifikasi Integritas Data

```bash
# Bandingin jumlah row antara MySQL dan PostgreSQL
npm run phase1:verify

# Ini bakal:
# - Hitung row di tiap tabel MySQL
# - Hitung row di tabel PostgreSQL yang sama
# - Bandingin dan report selisihnya
# - Exit dengan error kalau ada yang ga cocok
```

**Output yang Diharapkan**:
```
Verifying data migration integrity...

✓ accountings                    MySQL:  32360 → PostgreSQL:  32360
✓ allocation_accountings         MySQL:      0 → PostgreSQL:      0
... (semua cocok) ...

======================================================================
✓ All tables verified successfully!
```

**Waktu**: ~2 menit

---

## Troubleshooting

### Masalah: "Cannot find module 'mysql2'"
**Solusi**: Jalanin `npm install` dulu

### Masalah: "ECONNREFUSED" di MySQL
**Solusi**: Pastiin Laragon MySQL jalan, cek kredensial di `.env`

### Masalah: "ECONNREFUSED" di PostgreSQL
**Solusi**: Pastiin Laragon PostgreSQL jalan. Cek port-nya 5432

### Masalah: Tarik schema gagal
**Solusi**: Cek `.env` udah pake connection string MySQL yang bener apa belum

### Masalah: Migrasi data nyisain tabel kosong
**Solusi**: Cek pelanggaran foreign key constraint, liat error log

---

## Setelah Phase 1 Kelar

Abis 6 step di atas beres:

1. PostgreSQL punya semua 186 tabel dengan data lengkap
2. Pastiin ga ada error di log
3. Cek manual beberapa tabel di PostgreSQL:
   ```bash
   psql -U postgres -h localhost -d hms_anyaman
   hms_anyaman=# SELECT COUNT(*) FROM accountings;
   ```
4. Lanjut Phase 2 (Architecture & Permissions)

---

## Rollback Phase 1 (kalau perlu)

Kalau migrasi gagal dan mau mulai ulang:

```bash
# Hapus schema PostgreSQL
psql -U postgres -h localhost -d hms_anyaman -c "DROP SCHEMA public CASCADE;"

# Bikin ulang schema kosong
psql -U postgres -h localhost -d hms_anyaman -c "CREATE SCHEMA public;"

# Hapus folder migrations
rm -rf prisma/migrations

# Mulai dari Step 1
```

---

## Estimasi Waktu

| Step | Waktu | Kumulatif |
|------|------|-----------|
| 1: Ekstrak Schema | 2 mnt | 2 mnt |
| 2: Setup PostgreSQL | 2 mnt | 4 mnt |
| 3: Dependensi | 5 mnt | 9 mnt |
| 4: Build | 1 mnt | 10 mnt |
| 5: Migrasi Data | 10 mnt | 20 mnt |
| 6: Verifikasi | 2 mnt | 22 mnt |

**Total Phase 1**: ~22 menit (plus troubleshooting kalau ada)

---

## Kriteria Sukses

✅ Phase 1 dibilang kelar kalau:
1. `npm run phase1:verify` nunjukin "All tables verified successfully!"
2. Jumlah row persis cocok antara MySQL dan PostgreSQL
3. Ga ada error foreign key constraint
4. Ga ada error konversi tipe data
5. Database PostgreSQL siap buat Phase 2

---

**Lanjut**: Abis Phase 1 beres, mulai Phase 2 (Core Architecture & Permissions)