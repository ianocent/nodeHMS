# HMS Anyaman Backend Migration Plan
## Laravel/MySQL → Node.js/PostgreSQL

**Tujuan**: Rewrite backend total dengan kompatibilitas API 100%. Frontend Next.js harus jalan tanpa diubah.

**Status**: Phase 6 — Cross-sector Parity Fixes & Testing 🔄 IN PROGRESS (verifikasi live pending)
**Mulai**: 2026-07-13
**Terakhir Update**: 2026-08-14

---

## Kondisi Sekarang

| Aspek | Nilai |
|--------|-------|
| Frontend | Next.js di `http://localhost:3002` (ga diubah) |
| Frontend (migrasi) | `frontend-node/` — diadaptasi buat API backend-node |
| Backend | `backend-node/` — Node.js/Express/Prisma ✅ |
| Database | PostgreSQL `hms_anyaman` — 186 tabel, semua data kemigrasi ✅ |
| API Base | `http://localhost:3001` |
| Login | Jalan (token gaya Sanctum) ✅ |
| Sidebar menus | Jalan (menu tree ke-load) ✅ |
| Pilih property | Jalan (list property + auth) ✅ |

---

## Tech Stack

- **Framework**: Express.js 5
- **ORM**: Prisma 7 + `@prisma/adapter-pg`
- **Database**: PostgreSQL 18 (Laragon), migrasi dari MySQL `draft_rndhms`
- **Bahasa**: TypeScript (via ts-node)
- **Port**: 3001
- **Auth**: Token gaya Sanctum (di-hash SHA-256, disimpen di `personal_access_tokens`)
- **Enkripsi**: AES-256-CBC (handshake text/plain sama frontend Next.js)

---

## Roadmap Bertahap

### Phase 1: Infra Setup & Migrasi Database ✅
- `.env` dibenerin (Laragon PostgreSQL)
- Prisma schema di-generate dari MySQL (`prisma db pull`)
- PostgreSQL `hms_anyaman` dibuat dengan semua 186 tabel
- 574MB data dimigrasi dari MySQL → PostgreSQL
- Integritas data diverifikasi (jumlah row cocok)

### Phase 2: Core Architecture & Permissions ✅
- Setup Express.js dengan global middleware (CORS, logger, error handler)
- Sistem permission (role_menu_crud + model_has_menus)
- Token auth kompatibel Sanctum (hash SHA-256)
- Middleware enkripsi AES-256-CBC request/response
- 404 catch-all balikin JSON terenkripsi (bukan HTML)

### Phase 3: Authentication & Session ✅
- Login/lock — jalan dengan token Sanctum
- Logout — revoke semua token user
- Middleware validasi token (cek `x-token` dan `Authorization: Bearer`)
- Auto-revoke pas login ulang (ga ada lagi "User already logged in")
- Ganti password, endpoint lupa password

### Phase 4: API Endpoints (Modular) ✅
Semua 19 controller keimplementasi dengan operasi CRUD:

| Module | Controller | Routes | Lines |
|--------|-----------|--------|-------|
| Auth | `auth.controller.ts` | 5 | 456 |
| User | `user.controller.ts` | 11 | — |
| Guest | `guest.controller.ts` | 19+ | — |
| Reservation | `reservation.controller.ts` | ~20 | — |
| Rate | `rate.controller.ts` | ~15 | — |
| Room | `room.controller.ts` | ~10 | — |
| Front Desk | `front-desk.controller.ts` | 16 | — |
| Folio | `folio.controller.ts` | 14 | — |
| OTA/STAAH | `staah.controller.ts` | 30+ | — |
| POS | `pos.controller.ts` | 2 | — |
| Accounting | `accounting.controller.ts` | 9 | — |
| System | `system.controller.ts` | 12 | — |
| Reports | `report.controller.ts` | 15+ | — |
| Master Data | `master-data.controller.ts` | 25+ | — |
| Admin | `admin.controller.ts` | 30+ | 748 |
| Company | `company.controller.ts` | 20+ | — |
| Housekeeping | `housekeeping.controller.ts` | 14 | — |
| Concierge | `concierge.controller.ts` | 16 | — |
| Event | `event.controller.ts` | 22 | — |
| Statistic | `statistic.controller.ts` | 5 | — |

### Phase 5: Bug Fixing & Integrasi Frontend ⏳ CURRENT

Frontend manggil route `/cms/...` tapi backend cuma mount route di `/api/...` waktu Phase 4. Phase 5 nge-bridge celah ini:

#### 5.1 Penyelarasan Route Mount ✅
- [x] Dual-mount semua grup route di `/api` dan `/cms`
- [x] Auth middleware nerima `x-token` dan `Authorization: Bearer`
- [x] Endpoint list property + auth buat flow choose-property
- [x] Endpoint menu sidebar (`GET /cms/menu`) balikin flat list dengan `relation.children`
- [x] Endpoint Role, UALL, RALL
- [x] Auth property masukin `access_token` (cegah logout abis choose)

#### 5.2 Generic CRUD Engine ✅
Bikin generator CRUD reusable dari model Prisma. Ngilangin 80% kerja route manual:
- Auto-generate list (paginated, searchable, filter trash)
- Auto-generate create (POST dengan validasi body)
- Auto-generate show (GET by id)
- Auto-generate update (PUT/PATCH by id)
- Auto-generate destroy (soft delete + restore)
- Satu `generic.controller.ts` + `generic.routes.ts`
- Mount di `/api/generic/:model` + `/cms/generic/:model`

#### 5.3 Route Sidebar Sisanya ✅
| Route | Komponen frontend | Status backend |
|-------|-------------------|----------------|
| `GET /cms/user` | Halaman list User | ✅ Keimplementasi |
| `GET /cms/night-audit/audit` | Night audit | ✅ Keimplementasi |
| `GET /cms/night-audit/shift` | List shift night audit | ✅ Keimplementasi |
| `POST /cms/night-audit/check-audit` | Night audit check/save | ✅ Keimplementasi |
| `GET /cms/helper/task-notification` | Widget dashboard | ✅ Keimplementasi |
| `GET /cms/helper/total-cancel-booking-engine` | Helper | ✅ Keimplementasi |
| `POST /cms/helper/release-last-user-folio` | Helper | ✅ Keimplementasi |
| `GET /cms/get-dashboard` | Data dashboard | ✅ Keimplementasi |

#### 5.4 Bug Fixing Module-by-Module ✅
Alias route singular ditambahin di semua file route biar halaman frontend yang manggil endpoint `/cms/singular` ga 404 lagi.
Fix: Edit tiap file route, duplikat route plural dengan path singular.

Module yang ke-cover:
1. ✅ Widget & stats dashboard
2. ✅ User Management
3. ✅ Halaman Role & Permission
4. ✅ Property management
5. ✅ Master data (country, city, code-*, type-payment, holiday)
6. ✅ Company profiles
7. ✅ Guest profiles
8. ✅ Reservation & Front Desk
9. ✅ Rate & Pricing
10. ✅ Housekeeping, Concierge, Event
11. ✅ Accounting, POS, Reports
12. ✅ Night Audit, End of Day, Shift
13. ✅ STAAH OTA
14. ✅ Settings, Tasks, Logs

---

## Masalah yang Diketahui

| Masalah | Status | Fix |
|-------|--------|-----|
| `login.blade.php` → `login.tsx` import `mapPermissions` ilang | ✅ Fixed | Bikin `permissionHelper.ts` + import |
| `FetchData()` di `helper/index.tsx` ilang | ✅ Fixed | Dibuat dengan semua utility function |
| Env var `passAes` ga ketemu di frontend | ✅ Fixed | Pake `env.passAes` dari `next.config.js` |
| PrismaClient dibuat sebelum `dotenv.config()` | ✅ Fixed | `import 'dotenv/config'` ke-load duluan |
| `@prisma/adapter-pg` TableDoesNotExist (DATABASE_URL salah) | ✅ Fixed | dotenv load sebelum init PrismaClient |
| Hash bcrypt `$2y$` dari Laravel bikin "Invalid input" | ✅ Fixed | Password user system di-reset |
| "User already logged in" ngeblokir login ulang | ✅ Fixed | Auto-revoke token lama pas login |
| Auth middleware cuma cek `x-token`, ga cek `Authorization` | ✅ Fixed | Fallback ke `Authorization: Bearer` |
| Auth property nimpa data login → `access_token` ilang | ✅ Fixed | Response property masukin token |
| `menuGetParentByIdChildren` 500 pas `:id = "null"` | ✅ Fixed | Null check sebelum `BigInt()` |
| Response `code` string `"200"` tapi frontend cek `=== 200` (number) di beberapa tempat | 🔲 Minor | Frontend mayoritas pake loose comparison |
| Toast error buat route yang belum keimplementasi | ✅ Fixed | Semua route sidebar + module keimplementasi. Sisa: night-audit/shift + check-audit beres |

---

## Struktur File

```
backend-node/
├── prisma/
│   ├── schema.prisma      (Models + relations)
│   └── migrations/        (Auto-generated)
├── src/
│   ├── config/            (DB, env, constants)
│   ├── middleware/        (Auth, CORS, logger, error)
│   ├── services/          (Business logic)
│   ├── controllers/       (Route handlers)
│   │   ├── auth.controller.ts
│   │   ├── folio.controller.ts         ← Phase 4.2c
│   │   ├── front-desk.controller.ts    ← Phase 4.2
│   │   ├── reservation.controller.ts
│   │   ├── room.controller.ts
│   │   ├── rate.controller.ts
│   │   ├── admin.controller.ts         ← Phase 4.7
│   │   ├── company.controller.ts       ← Phase 4.7
│   │   ├── master-data.controller.ts   ← Phase 4.5 + 4.7
│   │   ├── housekeeping.controller.ts  ← Phase 4.8
│   │   ├── concierge.controller.ts     ← Phase 4.8
│   │   ├── event.controller.ts         ← Phase 4.8
│   │   ├── statistic.controller.ts     ← Phase 4.8
│   │   ├── generic.controller.ts       ← Phase 5.2 (generic CRUD)
│   │   └── ...
│   ├── routes/            (API routes)
│   │   ├── auth.routes.ts
│   │   ├── folio.routes.ts             ← Phase 4.2c
│   │   ├── front-desk.routes.ts        ← Phase 4.2
│   │   ├── reservation.routes.ts
│   │   ├── room.routes.ts
│   │   ├── admin.routes.ts             ← Phase 4.7
│   │   ├── company.routes.ts           ← Phase 4.7
│   │   ├── master-setup.routes.ts      ← Phase 4.7
│   │   ├── housekeeping.routes.ts      ← Phase 4.8
│   │   ├── concierge.routes.ts         ← Phase 4.8
│   │   ├── event.routes.ts             ← Phase 4.8
│   │   ├── statistic.routes.ts         ← Phase 4.8
│   │   ├── generic.routes.ts           ← Phase 5.2 (generic CRUD)
│   │   └── ...
│   ├── types/             (TypeScript interfaces)
│   └── index.ts           (App entry)
├── .env                   (Secrets)
├── package.json
└── tsconfig.json

frontend-node/                           ← Salinan frontend/, dimodif buat Node API
├── pages/                 (Next.js pages)
│   ├── front-desk/
│   │   ├── check-in/      (Listing check-in)
│   │   ├── check-out/     (Listing check-out)
│   │   ├── check-out-view/ ← BARU: Detail check-out per orang dengan review bill
│   │   ├── batch-check-out/
│   │   ├── batch-posting/
│   │   ├── folio/
│   │   └── virtual-folio/
│   └── ...
├── components/            (React components)
├── next.config.js         (API base → localhost:3000)
└── ...
```

---

## Koneksi Database (Laragon)

```bash
# Test koneksi
psql -U postgres -h localhost -d hms_anyaman

# Info
# Host: localhost
# Port: 5432
# Database: hms_anyaman
# User: postgres
# Password: (kosong atau blank)
```

---

## Jaminan Kontrak API

Response tiap endpoint WAJIB cocok persis format Laravel:

```json
{
  "success": true,
  "data": { ... },
  "message": "...",
  "meta": { ... }
}
```

Response error juga harus cocok.

---

## Checkpoint Validasi

| Phase | Checkpoint |
|-------|-----------|
| Setelah 1.1 | Prisma schema valid tanpa error |
| Setelah 1.2 | Tabel PostgreSQL kebuat |
| Setelah 1.3 | Jumlah row data cocok sama MySQL |
| Setelah 1.4 | Ga ada error FK constraint |
| Setelah 2 | Middleware permission jalan |
| Setelah 3 | Login balikin JWT token |
| Setelah 4 | Semua endpoint balikin schema yang bener |
| Setelah 5 | Frontend jalan tanpa perubahan |

---

## Catatan

- **Tanpa Docker**: Pake Laragon PostgreSQL lokal
- **Staging**: Ga bisa test OTA beneran sampe Phase 4.4
- **Kerja paralel**: Phase bisa overlap setelah Phase 2
- **Rencana Revert**: Keep backup DB MySQL kalau-kalau dibutuhin

---

**Terakhir Update**: 2026-07-15
**Review Berikutnya**: Testing integrasi frontend — konfirmasi semua module ke-load tanpa toast error

## Ringkasan Endpoint

| Module | Controller | Routes | Status |
|--------|-----------|--------|--------|
| Auth | `auth.controller.ts` | 3 | ✅ |
| User | `user.controller.ts` | 11 | ✅ |
| Guest | `guest.controller.ts` | 19 (termasuk sub-features) | ✅ |
| Reservation | `reservation.controller.ts` | ~20 | ✅ |
| Rate | `rate.controller.ts` | ~15 | ✅ |
| Room | `room.controller.ts` | ~10 | ✅ |
| Front Desk | `front-desk.controller.ts` | 16 | ✅ |
| Folio | `folio.controller.ts` | 14 | ✅ |
| OTA/STAAH | `staah.controller.ts` | 30+ | ✅ |
| POS | `pos.controller.ts` | 2 | ✅ |
| Accounting | `accounting.controller.ts` | 9 | ✅ |
| System | `system.controller.ts` | 14 (night audit + dashboard + helpers) | ✅ |
| Reports | `report.controller.ts` | 15+ | ✅ |
| Master Data | `master-data.controller.ts` | 25+ | ✅ |
| Admin | `admin.controller.ts` | 25+ | ✅ |
| Company | `company.controller.ts` | 20+ | ✅ |
| Housekeeping | `housekeeping.controller.ts` | 14 | ✅ |
| Concierge | `concierge.controller.ts` | 16 | ✅ |
| Event | `event.controller.ts` | 22 | ✅ |
| Statistic | `statistic.controller.ts` | 5 | ✅ |

---

## Phase 6: Cross-sector Parity Fixes & Testing (2026-08-14)

**Status**: IN PROGRESS — ronde audit + fix kelar, verifikasi live pending (user restart watchlogs.js)

### Kelar (kecommit + kepush: df65184, bd00320)
- Audit route semua halaman form (GLOBALURI frontend vs route node) — route yang ilang keimplementasi:
  - `GET /housekeeping/room-status/master` (crash halaman housekeeping room-status)
  - `GET /transaction/create`, `GET /transaction/folio` (sebelum `/transaction/:id`), `PUT /front-desk/data/:id`
  - `GET /code-post/get-charge`, `GET /code-post/get-code-items` (master-setup + master-system, sebelum `/code-post/:id`)
  - `PUT /reservation/ledger/move/:id`
  - `POST/PUT/DELETE /event-management-item` (+ filter event_id + parity formatTable)
- Parity master meta (form crash/kosong lewat CheckBoxBase options.map):
  - generic createForm/editForm master per-model (statuses; overbooking room_types+business_date; allotment company_guest)
  - form lost-found (statuses/itemsStatus/reservations/rooms/statusLost), company profile (master Laravel 17-key), form property (is_taxs/market_segments/subscribe_types/regions/...)
  - email-builder templateTypes, email-group users + email group_list, company-others code_posts
- `src/utils/cmsConfig.ts` shared baru (list config, moneyFormat, parity CodePost::calculate)
- Bug upstream Laravel dibiarin apa adanya (form holiday /cms/rate, form overbooking /cms/allotment)

### Testing
- `npx tsc --noEmit` bersih, jest 69/69 hijau, boot server bersih
- Pending: verifikasi browser live per module (user restart watchlogs.js)

### Sisa (issue #3, #4, #5 masih open)
- STAAH: verifikasi full flow ARI push, background jobs (queue) belum diporting
- Diff 1:1 route:list Laravel vs node (audit parsial per module udah)
- Cutover: test contract diff, sanity performa, run paralel, rencana rollback, decommission