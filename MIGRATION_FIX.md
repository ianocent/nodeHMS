# Rencana Fix Bug Migrasi — Phase-by-Phase

Tujuan: Benerin semua bug di log migrasi backend-node. Tiap phase = unit kerja independen dengan checklist.

---

## Phase 1 🔥 KRITIS: Ledakan Crash BigInt

Akar masalah: Prisma balikin `BigInt` buat field numerik. `JSON.stringify` lempar `Do not know how to serialize a BigInt`. Selain itu `BigInt(null)` dan `BigInt("null")` juga crash.

### 1.1 Konversi BigInt yang null-safe
Setiap pemanggilan `BigInt(x)` wajib guard null/undefined/string-"null".

File yang dibenerin:
| File | Line | Code yang rusak | Fix |
|------|------|-------------|-----|
| `system.controller.ts` | 284 | `BigInt(id)` dengan id = string "null" | `if (id && id !== 'null') ...` |
| `guest.controller.ts` | 337 | `BigInt(idParam)` dengan id = "guest-listing-report" | Urutan route: tangkap sub-route sebelum `:id` |
| `reservation.controller.ts` | 503 | `BigInt(idParam)` dengan id = "master" | Urutan route: tangkap sub-route sebelum `:id` |
| `reservation.controller.ts` | 664 | `BigInt(guest_profile_id)` dengan value = null | `guest_profile_id ? BigInt(guest_profile_id) : undefined` |
| `reservation.controller.ts` | 665 | `BigInt(company_profile_id)` dengan value = null | Pattern yang sama |

### 1.2 Serialisasi JSON BigInt
Setiap pemanggilan `success(res, data)` di mana `data` dari query Prisma mentah wajib pake `bigintToNumber()`.

File yang dibenerin:
| File | Line | Error |
|------|------|-------|
| `dynamic-rate.controller.ts` | 97 | `success(res, formatted, ...)` — `formatted` punya field BigInt dari Prisma |
| `rate.controller.ts` | 128 | `success(res, formatted, ...)` — masalah yang sama |
| Controller lain yang balikin data Prisma mentah | — | Grep `success(res, \w+` di mana variabelnya dari `prisma.findMany/Aggregate` |

### 1.3 Urutan route
Express nyocokin route sesuai urutan. Route `GET /guest/:id` bakal nangkep `/guest/guest-listing-report` duluan sebelum route eksplisit yang lain sempet match.

Fix: Pindahin semua definisi static/sub-route SEBELUM route param `:id`.

File:
| File | Route yang bentrok |
|------|-------------------|
| `guest.routes.ts` | `GET /guest/guest-listing-report` vs `GET /guest/:id` |
| `reservation.routes.ts` | `GET /reservation/master`, `GET /reservation/rate-by-company-id` vs `GET /reservation/:id` |

**Checklist:**
- [x] system.controller.ts:284 — guard `id !== 'null'`
- [x] guest.controller.ts:337 — BigInt defensif + return 404 buat yang non-numeric
- [x] reservation.controller.ts:503 — BigInt defensif + return 404 buat yang non-numeric
- [x] reservation.controller.ts:664-665 — null guard (ganti `!== undefined` jadi `!= null`)
- [x] dynamic-rate.controller.ts:97 — tambahin `bigintToNumber()` + wrap
- [x] rate.controller.ts:128,909,1381,1544 — semua 4 list di-wrap
- [x] system.controller.ts:254,801,849 — data di-wrap
- [x] event.controller.ts:187,396 — hasil mentah di-wrap
- [x] user.controller.ts — tambahin bigintToNumber, 5 pemanggilan di-wrap
- [x] rate-addon.controller.ts — tambahin bigintToNumber, semua di-wrap
- [x] company-contract-rate.controller.ts — formatContractRate di-wrap
- [x] room.controller.ts:1178 — configurations di-wrap
- [x] user-guest.routes.ts — reorder static sebelum `:id`
- [x] reservation.routes.ts — rewrite penuh: static sebelum `:id`
- [x] Semua 16 file route sisa diaudit — zero bug

---

## Phase 2 ✅ Missing Routes (404)

Frontend manggil endpoint ini tapi backend balikin 404. Semua 25 item keberesin (24 di level route, 1 keblok pending model Prisma).

| # | Endpoint | Perilaku yang diharapkan |
|---|----------|-------------------|
| 1 | `GET /cms/bar` | List Bar/Rate plan |
| 2 | `GET /cms/bar/create` | Form create bar |
| 3 | `GET /cms/allotment` | List allotment dengan filter range tanggal |
| 4 | `GET /cms/allotment/create` | Form create allotment |
| 5 | `GET /cms/overbooking` | List overbooking |
| 6 | `GET /cms/overbooking/create` | Form create overbooking |
| 7 | `GET /cms/yield` | List yield management |
| 8 | `GET /cms/hotel-competitor` | List kompetitor |
| 9 | `GET /cms/master-hotel-competitor` | List master kompetitor |
| 10 | `GET /cms/guest-request` | List guest request |
| 11 | `GET /cms/room-statistic` | Data room statistic |
| 12 | `POST /cms/room-statistic` | Update status room |
| 13 | `GET /cms/statistic/occupancy` | Statistik occupancy |
| 14 | `GET /cms/statistic/statistic-room-type` | Statistik room type |
| 15 | `GET /cms/statistic/statistic-room-type-grouping` | Grouping room type |
| 16 | `GET /cms/statistic/room-availability` | Chart room availability |
| 17 | `GET /cms/assign-room` | Assign room ke folio |
| 18 | `GET /cms/countryByRegion` | Dropdown country per region |
| 19 | `GET /cms/cityByCountry` | Dropdown city per country |
| 20 | `GET /cms/housekeeping-setup/create` | Form create housekeeping setup |
| 21 | `GET /cms/email/email-send/master` | Form email send |
| 22 | `GET /cms/room-type/get-configuration/:id` | Konfigurasi room type |
| 23 | `GET /cms/reservation/:id/update` | Form update reservation |
| 24 | `GET /cms/profile/guest` | List guest |
| 25 | `GET /cms/profile/guest/create` | Form create guest |

**Checklist:**
- [x] #1 bar — alias `/bar` + `/bar-rate` di rate.routes.ts
- [x] #2 bar/create — di rate.routes.ts (udah ada, line 64)
- [x] #3-4 allotment — GenericController di phase4.9.routes.ts
- [x] #5-6 overbooking — GenericController di phase4.9.routes.ts
- [x] #7-8 yield — GenericController di phase4.9.routes.ts (+ handler inline `/yield/create`)
- [x] #9 hotel-competitor — GenericController di phase4.9.routes.ts
- [x] #10 master-hotel-competitor — GenericController di phase4.9.routes.ts
- [x] #11 room-statistic — alias di room.routes.ts → `RoomController.statistics`
- [x] #12 POST /room-statistic — handler inline di phase4.9.routes.ts (bulk update status room)
- [x] #13 statistic/occupancy — handler inline di phase4.9.routes.ts
- [x] #14 statistic/statistic-room-type — alias di statistic.routes.ts → `StatisticController.byRoomType`
- [x] #15 statistic/statistic-room-type-grouping — alias di statistic.routes.ts → `StatisticController.byRoomType`
- [x] #16 statistic/room-availability — alias di statistic.routes.ts → `StatisticController.roomAvailability`
- [x] #17 assign-room — handler inline di phase4.9.routes.ts (GET, room yang available)
- [x] #18 countryByRegion — handler inline di phase4.9.routes.ts
- [x] #19 cityByCountry — udah ada di phase4.6.routes.ts
- [x] #20 housekeeping-setup/create — handler inline di housekeeping.routes.ts
- [x] #21 email/email-send/master — placeholder di phase4.9.routes.ts (butuh model Prisma buat impl penuh)
- [x] #22 room-type/get-configuration/:id — alias di room.routes.ts → `typeShow`
- [x] #23 reservation/:id/update — alias di reservation.routes.ts → `edit`
- [x] #24 profile/guest — lazy-import GuestController.list di phase4.9.routes.ts
- [x] #25 profile/guest/create — lazy-import GuestController.create di phase4.9.routes.ts
- [ ] guest-request — keblok (model Prisma `guest_requests` ga ada di schema.prisma)

---

## Phase 3 🔧 Mismatch Query Param (sebagian besar kelar)

`Fetcher` frontend ngirim query param dengan format tertentu. Backend harus parse dengan bener.

### Mismatch yang diketahui:

**3.1 Param `group` → filter module/menu path**
Frontend ngirim `group=master-report`, `group=pos-matrix-saless`, `group=check-in`, dll.
Backend jarang pake `group` — mayoritas controller nge-ignore.
Fix: Map `group` ke filter yang pas di tiap list handler.

**3.2 Param `search`**
Frontend ngirim `search=` (kosong) atau `search=keyword`
Wajib jalan dengan Prisma `where: { field: { contains: keyword } }` di semua controller.

**3.3 Param `trash`**
Frontend ngirim `trash=0` (aktif) atau `trash=1` (soft-deleted)
Backend wajib apply `deleted_at: null` atau `deleted_at: { not: null }` sesuai nilai.
Banyak controller yang hardcode `deleted_at: null` nge-ignore param `trash`.

**3.4 Param range tanggal**
Beberapa halaman ngirim `start_date`, `end_date` sebagai query param (misal overbooking, statistic).
Backend wajib filter by range tanggal kalau ada.

**3.5 String `"null"` → null beneran**
Frontend ngirim `module=null`, `id=null`, `start=undefined` sebagai string literal.
Backend wajib konversi string `"null"` → `null`, string `"undefined"` → `undefined`.

**Checklist:**
- [x] Bikin `queryParamHelper.ts` — helper reusable buat pagination, search, trash, date range, group
- [x] `buildSearchWhere.ts` — digabung ke `queryParamHelper.ts` (`buildWhere`, `parseSearch`)
- [x] requestParser.middleware.ts — normalize string "null" → null, "undefined" → undefined (fix global)
- [x] Audit method `list()`: nambahin trash awareness ke 10 controller (reservation, rate, room, promotion, dynamic-rate, user, guest, accounting, company, company-contract-rate)
- [x] GenericController udah handle `search` + `trash` (diverifikasi)
- [x] Param `group` — front-desk/reservation udah handle per-controller; sisanya ga butuh
- [x] `date_range` — tambahin ke GenericController kalau ada error frontend spesifik yang muncul (field spesifik model)
- [x] Controller non-list sisanya — prioritas rendah, fix on-demand

---

## Phase 4 ✅ Penyelarasan Format Response Frontend

Frontend expect bentuk data tertentu. Backend balikin bentuk yang beda.

### 4.1 Crash breadcrumbs header
Fixed: `menuGetParentByIdChildren` sekarang nge-traverse rantai parent dan balikin array `breadcumbs` di response.

### 4.2 Crash table-drag
Fixed: GenericController `list()` sekarang ngeluarin `table`, `permission`, `search_data`, `pagging`.

### 4.3 Crash CheckBoxBase
Diminimalisir: GenericController `show()` sekarang balikin `table`, `search_data`, `permission` — response punya semua key yang diharapkan.

### 4.4 Struktur data form generic CRUD
Fixed: GenericController `list()`, `show()`, `create()` semua ngeluarin `table`, `search_data`, `permission`.

**Checklist:**
- [x] menu/get-parent-by-id-children — breadcrumbs + fix nama field `route` → `url`
- [x] Generic list — selalu emit `table`, `permission`, `search_data`, `pagging`
- [x] Generic show/create — selalu emit `table`, `search_data`, `permission`
- [x] Kompilasi TS bersih
- [ ] CheckBoxBase `options: []` — tergantung config field spesifik (fix lanjutan on-demand)

---

## Phase 5 ✅ Bug Logika Spesifik Module

### 5.1 Promotion — error validasi 422
Fixed: Tambahin fallback field camelCase/snake_case di `store` + `update`. Field rules handle array → string JSON.

### 5.2 Front Desk — route update reservation
Fixed di Phase 2: alias `/:id/update` + handler GET `/assign-room`.

### 5.3 Log list — param `id` dan `module`
Fixed di Phase 3: requestParser normalize string "null" → null secara global.

### 5.4 Dynamic rate BigInt
Fixed di Phase 1.2: di-wrap dengan `bigintToNumber()`.

### 5.5 Reservation update null/undefined
Fixed di Phase 1.1: guard `!= null`.

**Checklist:**
- [x] promotion — fallback camelCase + handling array rules
- [x] reservation.routes — route `/:id/update` (Phase 2)
- [x] reservation.routes — route `/assign-room` (Phase 2)
- [x] logList — null string guard via requestParser (Phase 3)
- [x] dynamic-rate — bigintToNumber (Phase 1.2)
- [x] reservation update — null guard di BigInt (Phase 1.1)

---

## Phase 6 ✅ Bersih-bersih & Polish

### 6.1 Audit alias route
226 route terdaftar di 18 file route. Bulk dari Phase 2 nyelesaiin semua route yang ilang.

### 6.2 Sistem permission — FIXED
`frontend/redux/auth/permissionHelper.ts`:
- Line 18: `=== true` → `!!` (truthy) buat `transaction_actions`
- Line 29: `=== true` → `!!` (truthy) buat aksi CRUD

### 6.3 Konsistensi response error — FIXED
404 catch-all di `index.ts`: `res.status(404).json(...)` → `notFound(res, 'Not Found')`.

### 6.4 Warning `source-maps` frontend
Minor — suppress di `next.config.js` on demand.

**Checklist:**
- [ ] Audit alias route — 226 route terdaftar; verifikasi on-demand
- [x] permissionHelper.ts — strict `=== true` → lenient truthy
- [x] Format response error — handler 404 disatukan via `notFound()`
- [ ] Warning source-maps Next.js — minor, fix on demand

---

## Phase 7 ✅ Parity CRUD Bar Master (2026-08-13)

Halaman Frontend Rate & Bar Sales Marketing: create/update gagal ("Failed to load form data", 404, "rate id is required").

### 7.1 `bar.controller.ts` baru — parity penuh dengan Laravel `BarController` (rates dengan module='bar')
- [x] `list` — search name/description/code, `whereBetween` created_at, join code_post, pagging, table, permission (menu 87), business_date default di baris start_date
- [x] `create` — master: statuses, code_posts, business_date (via `log_audits` tanggal terakhir +1)
- [x] `store` — validasi Laravel + cek overlap tanggal ("Date range is overlap with another bar") + duplicate code ("Code already exist")
- [x] `show` / `edit` — formatData + master
- [x] `update` — partial update, cek overlap kecuali diri sendiri
- [x] `destroy` (soft) / `forceDelete` (`/delete`) / `restore`
- [x] `getRoomType` (`/bar/minimum-rate`) + `updateRoomType` (`PUT /bar/minimum-rate/:id`)

### 7.2 Routes — remap `rate.routes.ts`
- [x] `/bar` list/create/store; `/bar/minimum-rate`; `/bar/inclusives` (wrapper map `?bar_id=` → `rateId`, reuse `RateAddonController`)
- [x] `/bar/:id` show; `/bar/:id/update` edit; `PUT /bar/:id`; `DELETE /bar/:id`; `/delete`; `/restore`
- [x] Path static (create/minimum-rate/inclusives) didaftarin SEBELUM `/bar/:id`
- [x] Alias `/rate/:id/update` → `RateController.edit` (URL form frontend)

### 7.3 Fix bug
- [x] `RateController.edit` — 500 serialisasi BigInt → konversi eksplisit `Number()` di semua field BigInt
- [x] `RateController.list` — tambah filter `module: 'rate'` (baris bar bocor ke list rate)
- [x] `RateController.create`/`edit` — master sekarang termasuk `comm_codes` (kosong), `company_types`, `cancelations` (grup type `company-type` / `cancellation-reservation`) sesuai Laravel
- [x] **Sequence DB basi abis import** — `rate_inclusives_id_seq` di 2 padahal MAX(id)=69 → P2002 unique pas insert. Diberesin SEMUA sequence schema public: `setval(seq, GREATEST(MAX(id),1))` (script `fix_sequences.sql`)

### 7.4 Diverifikasi (test-bar-crud.js, semua 200)
- [x] bar list/create-form/edit-form/show, POST store, PUT update, GET/POST/DELETE inclusives, soft delete, 404 setelah delete, restore, force delete
- [x] Form edit rate (`/rate/:id/update`), key master rate create
- [x] `tsc` bersih

---

## Phase 8 ✅ Cakupan alias route + audit probe (2026-08-13)

Audit probe (`probe-all.js`) nge-hits semua GLOBALURI frontend; semua 5xx diberesin, semua list endpoint diverifikasi 200.

### 8.1 Alias route yang ditambahin (URI frontend → handler)
- [x] `/profile/guest-document|family|history|preference|loyalty-card` GET/POST/DELETE (query guest_id) — `user-guest.routes.ts`
- [x] `/profile/guest-folio` — `GuestController.folioList` (folio paginated by guest_id)
- [x] `/profile/company-contract-rate` GET/POST/PUT/DELETE — `rate.routes.ts`
- [x] `/company-profile-billing-setup` — `CompanyController.billingSetupList/Store/Destroy`
- [x] `/concierge/baggage` CRUD — `concierge.routes.ts`
- [x] `/master-capacity|inventory|layout|venue` — `event.routes.ts` (`capacityList` di event_capacities, sisanya GenericController)
- [x] `/reservation/code-item|inclusive|masterInclusive|subfolio/:id` — static `ReservationController` SEBELUM `/reservation/:id`
- [x] `/rate/code-item` — `ReservationController.codeItemList` (dipindah ke atas `/rate/:id`; tadinya ke-shadow → 500 "Failed to fetch rate")
- [x] `/transaction/pos` — `PosController.listTransactions` sebelum `/transaction/:id` (tadinya crash BigInt di id='pos')
- [x] `/housekeeping-setup/create` + singular `/housekeeping-setup/:id/update`
- [x] `/yield/:id/update` + `/yields/:id/update` — `extra.routes.ts`
- [x] `POST /dynamic-rate(s)/:id/disable` — `DynamicRateController.disable`
- [x] `GET /accounting/:type/create` (createForm) + `PUT /accounting/:type/:id` (updateStatus)

### 8.2 Fix serialisasi BigInt
- [x] `GuestController.edit` master (Number di t.id/s.id/b.id); `formatGuest` Number() di nationality/city/country/status/title/property id
- [x] `RoomController.show` room_configurations/in_room_equipments via bigintToNumber
- [x] `CompanyContractRateController.list` company + code_billing
- [x] `AccountingController.show` guard id numeric (matiin crash `BigInt('create')`)
- [x] `GenericController.toPlural` irregular: stocks, work_order_stocks, roster_list, shift_roster (fix 500 "Model not found")
- [x] `company.controller.ts` createForm — countries ga punya deleted_at; store guard BigInt pid
- [x] `content.controller.ts` otherGuestList — nationality → nationality_id

### 8.3 Handler toleran (grid query-param dengan param ilang → empty 200, bukan 500/404)
- [x] `RateController` — static emptyGrid; barRateIndex, rateLinkListing, rateLinkApplyList, rateCompany rate_id non-numeric/ilang → success kosong
- [x] Wrapper `/bar/rate-link-listing` numeric-check bar_id/rate_id → emptyGrid

### 8.4 Hasil probe (final)
- [x] LOGIN OK, zero 5xx, semua `list` = 200
- [x] 404 yang sisa itu artifact: halaman TableView-only (frontend ga pernah manggil /create atau /:id/update — add inline = POST uri, edit = PUT uri/:id) atau data-miss id=1 ("Dynamic rate config not found", "Rate is not found", dll)
- [x] `tsc --noEmit` bersih

---

## Ringkasan Analisis Error Log

| Kategori | Jumlah | Severity |
|----------|-------|----------|
| 🔴 500 — BigInt(null/string) | ~30+ | KRITIS |
| 🔴 500 — Serialisasi JSON BigInt | ~8 | KRITIS |
| 🟡 404 — Missing routes | ~25 | TINGGI |
| 🟡 404 — Urutan route (static vs :id) | ~15 | TINGGI |
| 🟡 422 — Mismatch validasi | ~8 | SEDANG |
| 🔴 Crash frontend — undefined.map | Kontinu | TINGGI |
| 🟢 200 — Route jalan | ~60 | ✅ |

---

**Mulai**: 2026-07-15
**Terakhir Update**: 2026-08-14
**Lanjut**: verifikasi fix sesi live (rate update, bar tab-rate, guest POST, dropdown form rate) setelah restart watchlogs; crosscheck halaman menu sisa (endpoint rate-bar/bar inclusive mungkin masih butuh mapping bar_inclusives/bar_rates); close issues #6 #7 #8.

## 2026-08-14 (sesi 3)
- **rate.controller.ts update()**: validasi dilonggarin ke parity Laravel (name/start_date/end_date/code/code_post_id optional, cuma di-apply kalau ada) — fix PUT /cms/rate/:id 422 (form rate frontend ga ngirim name/start_date/end_date).
- **barRateIndex**: tadinya query rates by bar_id (rate not found -> 404 -> crash frontend "Tab Rate"); sekarang bars.findUnique parity dengan Laravel BarRateController.
- **extra.routes.ts**: route store POST /profile/guest ditambahin (tadinya 404 pas save form guest).
- **form rate frontend-node**: misalignment index options dibenerin (data[7]=code_posts, data[8]=company_types, data[9]=cancelations, data[11]=code_posts) — dropdown Post Code/Grouping/Extra Bed tadinya kosong.
- **prisma client di-regenerate** (generated types basi — model bars ilang).
- tsc bersih + jest 69/69. Commit c114e5b + 2d92e61 kepush; batch sekarang belum kecommit.

## 2026-08-14
- **guest.controller.ts**: method static kepanggil tanpa bind (GuestController.list) crash di `\this.formatGuest` → diganti `GuestController.formatGuest` (5 titik). List Guests tadinya 500 di prod.
- **front-desk.routes.ts**: /front-desk/:id nge-shadow /front-desk/shifts (static setelah param). Di-reorder.
- **Test suite**: 66/70 gagal di HEAD — response AES ciphertext (res.text, bukan res.body); helpers.ts sekarang decrypt. Path route yang salah dibenerin. TEST_USER.lastProperty 999n (property 1 ilang di dev DB). 69/69 hijau.
- **tsconfig.json**: isolatedModules dipindah dari config jest ke compilerOptions (mampusin warning deprecation ts-jest v30).
## 2026-08-14 (sesi 4)
- **Crash Floor Plan** (room-statistic): baris data ga ada map_id -> crash replaceAll frontend. /cms/room-statistic di-rewrite ke parity Laravel RoomStatisticController.index (baris formatData, folio per business date, tree building dari types template-floor-plan, master room_type_groups).
- **Room Availability "Not Data"**: /cms/statistic/room-availability di-rewrite ke parity Laravel StatisticController.roomAvailability (grid room x tanggal, sel reservation/blocked/OOO/vacant, logika colspan).
- **Dropdown Edit Rate Setup ga ada Options**: response rate edit() kurang master meta di top level (kelas bug yang sama kayak fix Tab Rate fd1503c).
- **Scope list Room Type**: room_types di rate create/edit/barRateCreate sekarang property-scoped.
- utils/cmsStatus.ts shared baru; ApiMeta diperpanjang dengan building/meta. tsc bersih + jest 69/69.
## 2026-08-14 (sesi 4b) audit cross-sector
- **Crash index housekeeping-room-status**: route GET /cms/housekeeping/room-status/master ILANG (frontend fetch ini) -> HousekeepingController.roomStatusMaster + route (parity masterFilter).
- **Form Lost & Found No Options**: lostFoundForm cuma balikin data, ga ada master -> + statuses/itemsStatus/reservations/rooms/statusLost.
- **Form Company Profile No Options**: path update createForm ga punya master; path create cuma countries+type_companies -> master Laravel lengkap (17 key).
- **Form Property No Options**: propertyCreate/propertyEdit master cuma cities+countries -> + statuses/companies/is_taxs/market_segments/subscribe_types/regions.
- **Form Overbooking/Allotment**: generic createForm/editForm master {} -> statuses default, overbooking + room_types/business_date, allotment + company_guest.
- **Halaman Reservation Fit Transaction 404**: /cms/transaction/create, /cms/transaction/folio, /cms/code-post/get-charge, /cms/code-post/get-code-items, /cms/reservation/ledger/move/:id semuanya salah route/404 -> keimplementasi (parity Laravel), PUT /front-desk/data/:id buat save remark.
- utils/cmsConfig.ts (list config + moneyFormat + parity CodePost::calculate). tsc bersih + jest 69/69.