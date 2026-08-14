# Checklist Phase 1 & Ringkasan Setup
## HMS Anyaman Backend Migration

---

## ✅ Yang Udah Di-Setup

### Dokumentasi (3 file dibuat)
- ✅ `/backend-node/MIGRATION_PLAN.md` — Roadmap lengkap 5 phase
- ✅ `/backend-node/PHASE1_EXECUTION.md` — Panduan Phase 1 step-by-step (6 step)
- ✅ `/backend-node/PHASE1_README.md` — Quick start + troubleshooting

### Konfigurasi
- ✅ `.env` diupdate pake Laragon PostgreSQL (tanpa Docker)
- ✅ `package.json` dapet script npm Phase 1
- ✅ `package.json` dependensi: mysql2, pg, @prisma/client

### Script Otomatis (3 script dibuat)
- ✅ `/src/scripts/test-connections.ts` — Cek koneksi MySQL & PostgreSQL
- ✅ `/src/scripts/migrate-data.ts` — Migrasi semua data MySQL → PostgreSQL
- ✅ `/src/scripts/verify-data.ts` — Bandingin jumlah row, verifikasi integritas

### Struktur Project
```
backend-node/
├── src/scripts/
│   ├── test-connections.ts    ✅ BARU
│   ├── migrate-data.ts        ✅ BARU
│   └── verify-data.ts         ✅ BARU
├── .env                       ✅ DIUPDATE
├── package.json               ✅ DIUPDATE
├── MIGRATION_PLAN.md          ✅ BARU
├── PHASE1_EXECUTION.md        ✅ BARU
└── PHASE1_README.md           ✅ BARU
```

---

## 🎯 Status Sekarang: Siap Eksekusi Phase 1

### Status Database
- ✅ MySQL (Laragon): `draft_rndhms` jalan, 186 tabel berisi data
- ✅ PostgreSQL (Laragon): `hms_anyaman` dibuat, masih kosong, siap migrasi

### Status Code
- ✅ Express app keinit
- ✅ Prisma keconfigure
- ✅ TypeScript keconfigure
- ✅ Semua script Phase 1 siap compile

---

## 🚀 Lanjut: Eksekusi Phase 1 (4 Step)

### Cek Prasyarat
Sebelum jalanin command, pastiin:
- [ ] Laragon jalan
- [ ] Service MySQL start di Laragon
- [ ] Service PostgreSQL start di Laragon
- [ ] Terminal kebuka di folder `backend-node`

### Eksekusi Phase 1

**Step 1: Install Dependensi & Cek Setup**
```bash
cd backend-node
npm install
npm run build
npm run phase1:test
```
Harapannya: "✓ All database connections successful!"

---

**Step 2: Ekstrak Schema dari MySQL**
```bash
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"
npm run phase1:schema
```
Harapannya: "Introspected 186 models from MySQL database"

---

**Step 3: Bikin Tabel PostgreSQL**
```bash
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"
npm run phase1:tables
```
Harapannya: "Migration applied successfully"

---

**Step 4: Migrasi Data & Verifikasi**
```bash
npm run phase1:data
npm run phase1:verify
```
Harapannya: "✓ All tables verified successfully!"

---

## 📊 Angka Kunci Phase 1

| Item | Jumlah |
|------|-------|
| Tabel yang dimigrasi | 186 |
| Baris data MySQL | ~574MB total |
| Estimasi waktu migrasi | 10-15 mnt |
| Total waktu Phase 1 (dengan setup) | ~25-30 mnt |

---

## 🔍 Checklist Verifikasi

Abis jalanin semua 4 step, cek:

- [ ] `npm run phase1:test` nunjukin dua database connect
- [ ] Ekstraksi schema nunjukin "Introspected 186 models"
- [ ] Pembuatan tabel PostgreSQL sukses
- [ ] Migrasi data kelar dengan jumlah row
- [ ] Verifikasi data nunjukin "All tables verified successfully!"

Kalau semua ✅, **Phase 1 kelar!**

---

## 📝 Catatan Penting

### Sebelum Mulai Phase 1

1. **Backup**: Database MySQL Laragon `draft_rndhms` punya backup di `draft_rndhms.sql`
2. **Mulai Ulang**: Kalau perlu mulai dari awal, jalanin ini:
   ```bash
   psql -U postgres -h localhost -d hms_anyaman -c "DROP SCHEMA public CASCADE;"
   psql -U postgres -h localhost -d hms_anyaman -c "CREATE SCHEMA public;"
   rm -rf prisma/migrations
   npm run build
   ```

### Environment Variables

Selama Phase 1, `DATABASE_URL` diganti dua kali:

```bash
# Waktu ekstraksi schema (Step 2)
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"

# Waktu bikin tabel & migrasi data (Step 3-4)
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"
```

File `.env` default-nya pake versi PostgreSQL.

---

## 🎓 Bahan Belajar

Kalau mau ngerti tiap script ngapain:

- `test-connections.ts`: Connect ke dua DB, cek bisa diakses
- `migrate-data.ts`: Baca tabel MySQL, insert ke PostgreSQL
- `verify-data.ts`: Bandingin jumlah row biar yakin ga ada yang ilang

Semuanya di `/src/scripts/` dan bisa dijalanin sendiri-sendiri.

---

## ⏭️ Setelah Phase 1 Kelar

Abis verifikasi Phase 1 lolos:

1. PostgreSQL punya 186 tabel dengan semua data
2. Bisa mulai Phase 2 (Core Architecture)
3. Database MySQL bisa diarsip (ga kepake buat migrasi lagi)
4. Frontend bisa dibiarin apa adanya sampe Phase 3

---

## 🆘 Troubleshooting Cepat

| Masalah | Solusi |
|---------|--------|
| "Cannot connect to MySQL" | Start MySQL di Laragon |
| "Cannot connect to PostgreSQL" | Start PostgreSQL di Laragon |
| "Module not found: mysql2" | Jalanin `npm install` |
| "Command not found: npm" | Install Node.js atau tambahin ke PATH |
| "Migrasi data gagal" | Cek error log PostgreSQL, liat langkah rollback |

---

## 📖 Dokumentasi Lengkap

Buat detail lengkap, liat:
- `MIGRATION_PLAN.md` — Semua 5 phase dengan roadmap lengkap
- `PHASE1_EXECUTION.md` — Troubleshooting detail tiap step
- `PHASE1_README.md` — Arsitektur dan command referensi

---

**Status**: Setup Phase 1 kelar, siap eksekusi

**Waktu ngerjain Phase 1**: ~25-30 menit

**Aksi selanjutnya**: Jalanin `npm run phase1:test` buat cek koneksi database