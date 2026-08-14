# HMS Anyaman Backend Migration — Status Phase 1

**Tanggal**: 2026-07-13
**Phase**: 1 dari 5
**Status**: 🟡 Siap Eksekusi

---

## Yang Udah Disiapin

### ✅ Infrastruktur
- Database PostgreSQL dibuat: `hms_anyaman` (Laragon)
- `.env` diatur buat Laragon (tanpa Docker)
- Project Node.js jalan dengan Express + Prisma + TypeScript
- 186 tabel ketemu di schema MySQL (jauh lebih gede dari perkiraan!)

### ✅ Dokumentasi
- `MIGRATION_PLAN.md` — Roadmap lengkap 5 phase
- `PHASE1_EXECUTION.md` — Panduan eksekusi step-by-step
- Script otomatis buat migrasi

### ✅ Script Otomatis
1. **Ekstrak schema** — Baca MySQL, generate Prisma schema
2. **Buat tabel** — Bikin tabel PostgreSQL dari schema
3. **Migrasi data** — Pindahin semua data MySQL → PostgreSQL
4. **Verifikasi data** — Bandingin jumlah row, pastiin ga ada yang ilang
5. **Test koneksi** — Pastiin dua database bisa diakses

---

## Quick Start (Phase 1)

### 1️⃣ Test Koneksi (cek setup)
```bash
cd backend-node
npm install
npm run build
npm run phase1:test
```

### 2️⃣ Eksekusi Phase 1 (migrasi otomatis)

**Step 1: Ekstrak Schema dari MySQL**
```bash
export DATABASE_URL="mysql://root:@localhost:3306/draft_rndhms"
npm run phase1:schema
```

**Step 2: Bikin Tabel di PostgreSQL**
```bash
export DATABASE_URL="postgresql://postgres:@localhost:5432/hms_anyaman?schema=public"
npm run phase1:tables
```

**Step 3: Migrasi Data**
```bash
npm run phase1:data
```

**Step 4: Verifikasi Data**
```bash
npm run phase1:verify
```

✅ Kalau command terakhir nunjukin "All tables verified successfully!" — **Phase 1 kelar!**

---

## Estimasi Waktu Phase 1

| Task | Durasi |
|------|--------|
| npm install | 5 mnt |
| npm run build | 1 mnt |
| npm run phase1:test | 1 mnt |
| Ekstrak schema | 2 mnt |
| Bikin tabel PostgreSQL | 2 mnt |
| Migrasi data (186 tabel) | 10-15 mnt |
| Verifikasi data | 2 mnt |
| **Total** | **~25-30 mnt** |

---

## Hasil Phase 1

Abis Phase 1 kelar:
- ✅ PostgreSQL kepenuhan data dari MySQL
- ✅ Semua 186 tabel kemigrasi dengan jumlah row persis
- ✅ Foreign key + relasi tetap utuh
- ✅ Siap lanjut Phase 2 (Architecture & Permissions)

---

## Setelah Phase 1 — Langkah Selanjutnya

Kalau Phase 1 sukses:

### Phase 2: Core Architecture (2 hari)
- Setup sistem permission
- Setup sistem role
- Bikin middleware auth & validation
- Bikin response formatter

### Phase 3: Authentication (2 hari)
- Endpoint login/logout
- JWT token generation
- Validasi session
- Cek permission

### Phase 4: API Endpoints (3-4 minggu)
- User management
- Reservations
- Room management
- Pricing/rates
- Integrasi OTA
- POS & accounting

### Phase 5: Testing (1 minggu)
- Integrasi frontend
- QA testing
- Bug fixes

---

## Dokumentasi Kunci

1. **Roadmap Lengkap**: `/backend-node/MIGRATION_PLAN.md`
2. **Panduan Phase 1**: `/backend-node/PHASE1_EXECUTION.md`
3. **Info Database**:
   - MySQL: `localhost:3306/draft_rndhms` (Laragon)
   - PostgreSQL: `localhost:5432/hms_anyaman` (Laragon)

---

## Arsitektur (Sekarang)

```
backend-node/
├── src/
│   ├── index.ts              (Express app - setup dasar)
│   ├── scripts/
│   │   ├── migrate-data.ts   (Migrasi data)
│   │   ├── verify-data.ts    (Verifikasi data)
│   │   └── test-connections.ts (Test koneksi)
│   ├── config/               (Kosong - Phase 2)
│   ├── middleware/           (Kosong - Phase 2)
│   ├── services/             (Kosong - Phase 2)
│   ├── controllers/          (Kosong - Phase 2)
│   └── routes/               (Kosong - Phase 2)
├── prisma/
│   ├── schema.prisma         (Models - bakal di-regenerate)
│   └── migrations/           (Kosong - bakal keisi)
├── .env                      (Laragon PostgreSQL)
├── package.json              (Dapet script baru)
└── PHASE1_EXECUTION.md       (Panduan step-by-step)
```

---

## Troubleshooting

### Masalah: "Cannot connect to MySQL"
```
Cek Laragon MySQL jalan apa ga:
- Buka Laragon
- Start service MySQL
- Cek: mysql -u root -h localhost
```

### Masalah: "Cannot connect to PostgreSQL"
```
Cek Laragon PostgreSQL jalan apa ga:
- Buka Laragon
- Start service PostgreSQL
- Cek: psql -U postgres -h localhost
```

### Masalah: "Module not found: mysql2"
```
Jalanin: npm install
Terus: npm run build
```

### Masalah: Migrasi data gagal di tengah jalan
```
Cek log PostgreSQL buat error constraint FK
Mungkin perlu truncate tabel dan ulang
Liat PHASE1_EXECUTION.md buat langkah rollback
```

---

## Indikator Sukses

Phase 1 dibilang kelar kalau:

```bash
$ npm run phase1:verify

Verifying data migration integrity...

✓ accountings                    MySQL:  32360 → PostgreSQL:  32360
✓ allocation_accountings         MySQL:      0 → PostgreSQL:      0
✓ allotments                      MySQL:    xxx → PostgreSQL:    xxx
... (semua tabel cocok) ...

======================================================================
✓ All tables verified successfully!
```

---

## Catatan Penting

- 🔴 **JANGAN mulai Phase 2 sebelum verifikasi Phase 1 lolos**
- 🟡 **Database MySQL ga disentuh** — aman buat rollback
- 🟢 **PostgreSQL = sumber kebenaran baru** — abis Phase 1 kelar
- 📝 **Simpen docs ini** — bakal kepake terus selama migrasi

---

## Command Cepat

```bash
# Test koneksi
npm run phase1:test

# Eksekusi Phase 1 lengkap (urut)
npm run phase1:schema     # Step 1
npm run phase1:tables     # Step 2
npm run phase1:data       # Step 3
npm run phase1:verify     # Step 4 (cek sukses)

# Kalau mau mulai dari awal
rm -rf prisma/migrations  # Hapus migrations
npm run build             # Compile ulang
npm run phase1:test       # Cek koneksi
npm run phase1:schema     # Mulai lagi
```

---

**Siap mulai Phase 1?** → Mulai dari `npm run phase1:test`
