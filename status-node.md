# HMS Anyaman — Status & Panduan Handover Node Stack

> Terakhir update: 2026-08-13. File ini satu-satunya sumber kebenaran buat lanjut kerja di node stack (backend-node + frontend-node). Pasangin dengan `MIGRATION_FIX.md` (log fix per-phase) dan GitHub issues yang di-link di bawah.

---

## 1. Repos

| Repo (dir) | GitHub | Branch | Status |
|-----------|--------|--------|--------|
| `backend-node/` | `git@github.com:ianocent/nodeHMS.git` | `main` | Development aktif |
| `frontend-node/` | `git@github.com:ianocent/nodefeHMS.git` | `main` | Kerja dev server |
| `backend/` | `git@github.com:ianocent/hms-backend.git` | `main` | Bersih (ga disentuh, referensi Laravel) |
| `frontend/` | `git@github.com:ianocent/hms-frontend.git` | `main` | Bersih (ga disentuh, UI referensi Next.js) |

## 2. Arsitektur (backend-node)

- **Express + Prisma (PostgreSQL)**, TypeScript via ts-node, port **3001**.
- Semua response `/cms/*` **di-enkripsi AES-256-CBC** (`iv_hex:cipher_hex`, `Content-Type: text/plain`). Key: `lbwyBzfgzUIvXZFShJuikaWvLJhIVq36` (juga di `frontend-node/next.config.js` sebagai `passAes`).
- Auth: `POST /api/login` (body JSON terenkripsi `{email, password}`) → `data.access_token`; panggilan berikutnya kirim `X-Token: <token>`. Selalu `GET /cms/force-logout/dev@dipstrategy.com` sebelum login (single-session enforcement).
- Login test: `dev@dipstrategy.com` / `password`.
- API base frontend: `http://localhost:3001` (hardcoded di `frontend-node/next.config.js` `suriApi`).

## 3. Cara Jalanin

**Backend** (3001):
```powershell
# restart (detached, log ke file):
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'backend-node' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process cmd.exe "/c cd /d C:\Users\uzuma\Documents\hms-anyaman\backend-node && npm run dev > C:\Users\uzuma\AppData\Local\Temp\opencode\node-dev.log 2>&1" -WindowStyle Hidden
# tunggu ~20s; cek tail log buat baris "Phase 4.x ... active"
```
- Typecheck: `rtk tsc --noEmit` (rtk = wrapper pemampat token; `tsc` biasa juga fine).
- Pantau error di `C:\Users\uzuma\AppData\Local\Temp\opencode\node-dev.log`.

**Frontend** (3000):
```powershell
cd C:\Users\uzuma\Documents\hms-anyaman\frontend-node; npm run dev
```

## 4. Probing / Verifikasi

- Script probe: `C:\Users\uzuma\AppData\Local\Temp\opencode\probe-all.js` (login, hits semua GLOBALURI frontend: list `?page=1`, `/create`, `/1/update`, `/1`).
- Kriteria terima: **zero 5xx, semua list endpoint 200**. 404 itu wajar kalau:
  - **Halaman TableView-only** — frontend ga pernah manggil `/create` atau `/:id/update` (add inline = `POST uri`, edit = `PUT uri/:id`; liat `frontend/components/common/table-edit/index.tsx`). Halaman modal-form (dir dengan `form/`) justru BUTUH `/create` + `/:id/update`.
  - **404 data-miss** — probe hardcode `id=1`; pesan custom ("Rate is not found", "Dynamic rate config not found") artinya route jalan tapi record-nya ga ada.
- List URI probe ada entry basi yang ga ada di frontend (front-desk, pos-matrix-sales, batch-posting, shift-confirmation, post-code-budget, allocation-history, other-guest, dll). Route-nya tetap ada; JANGAN dikejar.

## 5. Log Fix (sesi terakhir)

### Phase 8 (kecommit `ad20264`, kepush) — cakupan alias route + audit probe
- Route baru: `/profile/guest-document|family|history|preference|loyalty-card|folio`, `/profile/company-contract-rate`, `/company-profile-billing-setup`, `/concierge/baggage`, `/master-capacity|inventory|layout|venue`, `/reservation/code-item|inclusive|masterInclusive|subfolio/:id`, `/rate/code-item` (dipindah ke atas `/rate/:id` — tadinya ke-shadow → 500), `/transaction/pos`, `/housekeeping-setup/create` + `/housekeeping-setup/:id/update`, `/yield/:id/update`, `POST /dynamic-rate(s)/:id/disable`, `/accounting/:type/create` + `PUT /accounting/:type/:id`.
- Fix serialisasi BigInt (Number() / bigintToNumber): master guest edit, room show, company-contract-rate list, guard numeric accounting show, irregular toPlural GenericController (`stocks`, `work_order_stocks`, `roster_list`, `shift_roster`), company createForm (countries ga punya `deleted_at`), content otherGuestList (`nationality` → `nationality_id`).
- Handler toleran rate: static `RateController.emptyGrid`; barRateIndex / rateLinkListing / rateLinkApplyList / rateCompany tolerir param non-numeric/ilang → empty 200.
- Detail lengkap: `MIGRATION_FIX.md` Phase 8.

### Terbaru (kecommit `eebf2bc`, kepush) — user form 500
- `UserController.create` + `edit` balikin id BigInt di master (companies/properties/roles) → "Do not know how to serialize a BigInt" → `Number(c.id/p.id/r.id)`. Diverifikasi: `/cms/user/create`, `/cms/user/1/update`, `/cms/user?page=1&limit=10&name=&trash=0` semua 200.

### Frontend-node (LOCAL DOANG — `next.config.js` ke-gitignore, `.gitignore:5`)
- Key `apps` PM2 yang invalid dihapus (mampusin warning "Unrecognized key(s) in object: 'apps'").
- Webpack filesystem cache dimatiin di dev + watchOptions ignore node_modules/.next → fix `RangeError: Failed to allocate memory` (OOM serialize cache gzip, RAM mesin cuma ~9.8GB).
- Error Watchpack EINVAL di `C:\pagefile.sys` dll. itu harmless.

## 6. Kerjaan Belum Kelar (GitHub issues)

| Issue | Repo | Ringkasan |
|-------|------|---------|
| [#6](https://github.com/ianocent/nodeHMS/issues/6) | nodeHMS | query route guest-request ilang model Prisma → 500. Tambahin model `guest_requests` (mirror tabel Laravel) atau remap handler. |
| [#7](https://github.com/ianocent/nodeHMS/issues/7) | nodeHMS | route report cuma ke-mount di root; `GET /api/cms/report` 404. Tambahin `app.use('/api', reportRoutes)` di `src/index.ts` + smoke test. |
| [#8](https://github.com/ianocent/nodeHMS/issues/8) | nodeHMS | warning source-maps ts-node pas boot (kosmetik). |
| [#2](https://github.com/ianocent/hms-frontend/issues/2) | hms-frontend | `permissionHelper` strict `=== true` gagal buat nilai `1`/`"true"` → butuh cek truthy yang longgar. Role super-user: developer/administrator/anyaman. |
| [#3](https://github.com/ianocent/hms-frontend/issues/3) | hms-frontend | API base hardcoded `http://192.168.143.50:8000` + key AES → pindahin ke .env/secrets. |

Catatan lain:
- Sequence DB basi abis import (unique-violation pas insert) — diberesin via `fix_sequences.sql` (setval semua seq schema public ke MAX(id)). Kalau error P2002 muncul lagi, jalanin ulang.
- Footer `MIGRATION_FIX.md` nge-track status phase keseluruhan — update setelah tiap phase baru.
- Repo `backend/` (Laravel) itu referensi parity buat endpoint/perilaku.

## 7. Konvensi / Gotcha

- Handler static Express ga nge-bind `this` → pake helper level module (preseden: `reservationBn` di reservation.controller.ts).
- Path static WAJIB didaftarin SEBELUM route param `/:id` di router yang sama.
- BigInt dari Prisma ada di mana-mana (field id) — wrap response dengan `bigintToNumber()` atau `Number()` eksplisit sebelum `success()`.
- Cek permission berbasis menuId di tiap route (`requirePermission(menuId, action)`); super-user bypass.
- Selalu `force-logout` sebelum login di script; rotasi token itu enforced.
## 2026-08-14 Sesi (lanjutan)

### Guest Requests (Issue #6) — parity folio (SELESAI)
- List di-rewrite di src/routes/extra.routes.ts: tadinya impl guest_profile_preferences yang salah → sekarang parity Laravel GuestRequestController di tabel folios.
- Query: folios dengan property_id, deleted_at null, OR dari 4 field instruksi (not null AND not ''), include reservations (deleted_at null, is_posting 0, orderBy date asc, take 1) + company_profiles_folios_company_profile_idTocompany_profiles.
- Nama/akun guest via join manual guest_profiles (ga ada relasi Prisma).
- Konstanta: GR_STATUS_RESERVATION 0=Check In,1=Check Out,2=Cancelled,3=Reservation,4=In House,5=Pending (diverifikasi vs config/cms.php + live DB).
- Warna cocok Laravel Global.php: reservation bg-green/purple/red/cyan/blue/yellow; room bg-cyan/green/purple/red/black-red; maid bg-cyan/red/yellow/green.
- Guest-request create/show/update/delete dihapus (Laravel cuma index).
- Cek live: GET /cms/guest-request?page=1&limit=2 -> 200, 2 rows.

### Mount Reports (Issue #7) — SELESAI
- src/index.ts sekarang mount reportRoutes di root DAN /api (parity Laravel).
- Cek live: GET /api/cms/report/batch -> 200, 1 row.

### Issue #8 (warning source-maps ts-node) — GA kebisa direproduksi di Node v24.14.0 + ts-node 10.9.2; boot bersih di PORT=3999. Tutup.

### Penyelamatan test suite (busuk lama, BUKAN dari perubahan sesi)
- Di HEAD: 66/70 test gagal. Akar masalah:
  1. Semua response /cms di-enkripsi AES (text/plain) → supertest taruh ciphertext di res.text, res.body={} → test ga pernah liat JSON. Fix: parseBody()/expectLaravelFormat() di src/__tests__/helpers.ts sekarang decrypt (APP_AES_PASSWORD dari .env).
  2. Kontrak itu code/data/message (frontend cek code=="200" di components/helper/index.tsx), BUKAN 'success' — helper diupdate.
  3. Bug beneran ketemu + dibenerin:
     - guest.controller.ts: `\this.formatGuest` ga ke-bind di static list/store/show/update → 500. Diganti `GuestController.formatGuest` (5 call site).
     - front-desk.routes.ts: /front-desk/:id didaftarin SEBELUM /front-desk/shifts → param shadowing 404/400. Route shift dipindah ke atas /:id (static-sebelum-param).
  4. Path test yang salah dibenerin: /api/code-post, /api/setup, /api/log, /api/room-changes, /api/log-audits, /api/shift-confirmation, /api/cms/report-permission, /api/status+/- ditambahin ke test app.
  5. TEST_USER.lastProperty 1n → 999n (property 1 ga ADA; 999 ada) — fix 500 FK guest documents.
- Hasil: npm test 69/69 PASS.
- Deprecation ts-jest isolatedModules: dipindah dari transform jest di package.json → compilerOptions tsconfig.json.

### Frontend (frontend-node)
- redux/store/store.ts: redux-persist yang SSR-safe (createNoopStorage + createWebStorage('local')).
- tailwind.config.js: borderRadius large + 2xl (1.5rem) — fix warning nilai theme invalid.
- next.config.js: experimental.optimizePackageImports (@nextui-org/react, framer-motion, apexcharts, tinymce, ckeditor). cache:false udah ada (fix OOM).
- package.json: packageManager yarn@1.22.22 (yarn.lock v1 ke-track).
- .gitignore: next.config.js di-un-ignore (next.config.local.js + next.config.qa.js yang di-ignore) — config sekarang bisa kecommit.

## 2026-08-14 Sesi (lanjutan)

### Fix batch 2 (kecommit `fc61455`, kepush) — parity menu list, trio night-audit, email master, statistic, listing guest
- `menuListBySlug` (admin.controller.ts): parity Laravel `MenuController.list` — `findFirst uri_table='/cms/'+slug`, meta `{typeTable, uriTable, label, isDrag:true, uriSaveDrag, breadcrumbs}`. Label parse `menus.name` JSON-translatable (`{"en":"Packages"}` → `en ?? id ?? raw`).
- **Helper response `success()` (response.ts): tadinya diem-diem nge-drop key meta** — cuma spread permission/pagging/table/master/search_data. Ditambahin `typeTable/uriTable/label/isDrag/uriSaveDrag/breadcrumbs` ke `ApiMeta` + spread. Tanpa ini, `/cms/list/:slug` balikin `{code,message,data:null}` tanpa meta → halaman tabledrag rusak.
- `emailSendMaster` (content.controller.ts): email_groups + email_builders → `master.allGroups`/`allTemplate`; route `GET /email/email-send/master` (content.routes.ts).
- Trio night-audit (system.controller.ts + master-system.routes.ts): `nightAuditRoomChange/NoShow/OverStay` — query folio, `is_posting:false` (Boolean! `0` → 500), noShow status in [1,0] + check_in_date<=date, overStay status=2 + check_out_date<=date, roomChange via `reservations.some room_type_id_next/room_id_next`; `date` wajib → 400 (parity Laravel).
- `workOrderSummary` (housekeeping.controller.ts): hitung all/open/on_process/finish; route sebelum `/work-order/:id`.
- `roomStatisticGrid` (statistic.controller.ts): rooms + building/floor via model_has_types + hitung folio via `reservations.room_id` (folios ga punya room_id); route `GET /statistic` (BUKAN `/`).
- `guestListingReport` (guest.controller.ts): filter status_profile/gender/min_age/max_age/search; route static sebelum `/guest/:id`.
- Diverifikasi live (verify3.js, base `http://localhost:3001` — base frontend, BUKAN `/api`): check-last-user-folio POST 200 status:0, no-show/over-stay 200 (10 rows dengan date), room-change 200, guest-listing-report 200 (5 rows), email-send/master 200, statistic 200, list/event-package + event-list 200 dengan label.
- Sweep: 186 URI → 24 gagal, SEMUA false positive (17 route POST-only yang ga bisa di-hit GET sweep — helper/check-last-user-folio POST diverifikasi 200; 2 400 butuh date; check-value 400; rate/promotion rate_id=1 ga ada → parity Laravel; dead code companyProfile; /cms/list polos; property/auth/ tanpa id).
- Gotcha: probe POST wajib kirim `Content-Type: application/json` — body `text/plain` mentah bakal di-coba decrypt AES (requestParser) dan tetep string → 400.
- Catatan: 404 `/api/cms/*` di sebagian file route (master-system/statistic/content/admin) padahal dist mount `/api` dan `/cms` dua-duanya; frontend + sweep cuma pake `/cms/*`, jadi BUKAN blocker. Penyebab belum ketemu. → **SELESAI 2026-08-14**: `report.routes.ts` pake path ber-prefix `/cms/...` yang di-mount di ROOT (`app.use(reportRoutes)` index.ts:106) + `/api` (108) — `/cms/guest/guest-listing-report`-nya (line 50) ngejelasin 200 liar `/api/cms/guest/...`. Router lain pake path tanpa prefix yang di-mount di `/api` + `/cms` → `/api/cms/...` ga bisa match (memang gitu desainnya); frontend cuma manggil `/cms/...` yang match via mount `/cms`. Bukan bug.

### Langkah berikutnya
- [x] Verifikasi guest-request + mount report live
- [x] Fix batch 2 (menu list, trio night-audit, email master, statistic, guest listing, meta success()) — `fc61455` kepush
- [ ] Hapus package-lock.json dari frontend-node (yarn itu sumber kebenaran)
- [ ] Bersihin frontend-node/.next yang basi
- [x] Root-cause 404 `/api/cms` buat mount master-system/statistic/content/admin — BUKAN bug; path legacy `/cms` report.routes di root+/api ngejelasin 200 liar; router tanpa prefix cuma match `/cms/...` via mount `/cms` (konvensi frontend).
- [ ] Commit + push dua repo; close issues #6 #7 #8 (nodeHMS)
## 2026-08-14 fix menu tabs (22ebdbc)
- menuGetParentByIdChildren di-rewrite: parity Laravel MenuResources (jalan ke root, children rekursif, 66/67/68->63, url ?parent=&module=, place form/table, flag permission per-menu, filter market_segment)
- route id optional (tanpa id -> 200 code 200 data [])
- kasus khusus /reservation/vr/reservation -> 69
- diverifikasi live: children/1116 -> 20 rows root children, kids 3,4 (User+Role); vr -> 12 rows id pertama 63
- verify4.js probe untracked

## 2026-08-14 url parent sidebar + 2 bugfix (5b4e3cc)
- menuListAll -> parity MenuResources: url ?parent=&module=, alias_url, children rekursif, pagging/permission/datas (halaman nav-menu admin), active-only, filter market_segment
- cityByCountry literal undefined/null -> [] bukan 500
- guest update: field virtual guest_status dihapus dari data (fix PUT profile/guest 500)
- diverifikasi: USER ACCOUNT 1116 -> /user?parent=1116&module= kids 3,4; cityByCountry undefined -> 200 []; PUT 71819 -> 200
- verify5.js probe untracked

## 2026-08-14 alias route + BigInt + CRUD property (c114e5b, kepush)
- Alias kebab CRUD di extra.routes.ts: stop-sell-booking->stop_sells, content-room->content_rooms, channel-manager-interface->channel_manager_interfaces, payment-matrix->payment_matrices, rate-room->rates, staah-manager->staah_interfaces, staah-reservation->staah_reservations, staah-ota-mapping->staah_ota_company_mappings; allotment/room->room_allotments (didaftarin sebelum /allotment/:id); DELETE /stop-sell-booking polos dengan body id
- generic.controller.ts: kebabOverrides di toPlural; sanitizeBody() nge-strip key audit + tanggal object kosong + coerce string tanggal; create inject property_id dari req.user.lastProperty (retry tanpa kalau unknown-arg); generic list hormati query filter _id via BigInt(String(v))
- Fix BigInt: barRelationLink rate-addon + hasil dynamic-rate di-wrap bigintToNumber (created_by/updated_by bocor); rate show guard id non-numeric
- rate.routes.ts: alias `/rate/inclusives` + `/rate/extra-beds` (query rate_id -> param rateId) didaftarin SEBELUM /rate/:id
- CRUD property di admin.controller.ts + admin.routes.ts (GET /property/create, POST /property, GET /property/:id/update, PUT/DELETE /property/:id)

## 2026-08-14 coercion master-data + master guest/room (2d92e61, kepush)
- master-data.controller.ts: helper `num(v, fallback=0)` + `bool(v, fallback=false)`; di-coerce code-billing/post/item/gls + type-payment + holidays create/update: sort/status/isPOS/pay_commission/tax*/sales/cost/pos/front_office/surcharge* -> num(), is_online/is_event -> bool(); field string dibiarin polos (num(name) dll. yang salah di-revert)
- Master guest.controller.ts create+edit: + countries (tanpa filter deleted_at) + cities: [] (fix dropdown Nationality)
- Master room.controller.ts create+edit: + floors + buildings (grup types) + alias in_room_equiptments (parity typo Laravel)
- Master Rate edit udah lengkap: statuses, room_types, code_posts, comm_codes:[], company_types, cancelations, days, fields

## 2026-08-14 rate update longgar + bar tab-rate + guest store (BELUM KECOMMIT)
- rate.controller.ts update(): validasi name/start_date/end_date/code/code_post_id yang wajib di-drop (parity Laravel - semua optional); field cuma di-apply kalau ada; guard Number() minimum_rate
- barRateIndex: tadinya rates.findUnique(rate_id=bar_id) -> 404 "Rate not found" -> crash halaman bar "Tab Rate"; sekarang bars.findUnique (parity Laravel BarRateController Bar::find), 404 "Bar is not found", master.bar_info dari bar
- extra.routes.ts: + POST /profile/guest (guestStore, requirePermission(82,'add')) - tadinya ilang -> 404 pas save form guest
- frontend-node/components/pages/rate/form/index.tsx: index options misaligned - data[5]=comm_codes, data[6]=code_posts, data[7]=company_types, data[8]=cancelations, data[10]=code_posts -> dropdown Post Code/Grouping/Extra Bed kosong; dibenerin: data[7]=code_posts, data[8]=company_types, data[9]=cancelations, data[11]=code_posts
- prisma client di-regenerate (basi sejak 2026-07-15; model bars ilang dari generated types)
- tsc bersih + jest 69/69

## 2026-08-14 master meta form rate + reservation-item + parity list rate (fd1503c)
- **rate.controller.ts create() (line ~188) + barRateCreate(): `success(res, master, 'Success')` tanpa meta { master }** -> response punya data=master tapi field `master` ABSENT -> `datauser?.master?.days` undefined -> crash CheckBoxBase.tsx:106 `options.map` (akar masalah crash "Tab Rate" Rate Bar). Fixed: success(res, master, 'Success', 200, { master }).
- **reservation-item** (parity ReservationItemController, grid room per folio): `reservationItemIndex` + `reservationItemUpdate` di reservation.controller.ts + route GET /reservation-item + PUT /reservation-item/:id (didaftarin di reservation.routes.ts). Tadinya 404 -> tab "Reservation/Room" detail folio loading selamanya. Rows: parity formatData (rate/room_type/room_id/remark_room/market_segment_1-4/source via grup morph model_has_types, company_id, total, map status_reservation 0-5). table = formatTableRom (12 kolom). meta folio/market_property/reasons ditambahin ke ApiMeta.
- **table list rate -> parity Laravel penuh**: kolom code is_link=true uri=/rate-management/rate (klik Code -> halaman form edit; branch is_link TableView), semua kolom inline-editable (checkbox status, text code/name/description, tanggal start/end, select code_post_id + code_post_extra_bed_id dengan options code_posts). Rows parity formatData (code_post_id {value,label}, bool online/staah/print_rate, contract_rate, code_color, sort_by_company/color).
- handler rate update: + support code_post_extra_bed_id.
- /bar/inclusives diverifikasi: Laravel BarRelationController.index juga pake rate_inclusives by rate_id=bar.id -> parity inclusiveList node OK (ga diubah).
- tsc bersih + jest 69/69.

## 2026-08-14 floor plan + room availability + master edit rate + scope room type (BELUM KECOMMIT)
- **Akar masalah crash Room Statistic (Floor Plan)**: GET /cms/room-statistic balikin tree buildingGrouped sebagai data + master tanpa building/templates + key meta DI-DROP (success() cuma emit key meta whitelist) -> frontend room-statistic/index.tsx:
  w?.map_id.replaceAll crash (data rows ga ada map_id). Di-rewrite ke parity RoomStatisticController.index: rows = formatData Room::formatData() (map_id ucfirst, floor/building {value,label}, room_status/room_status_color/maid_status/room_clean_status_color + kode warna, room_type_id {value,label}, room_type_grouping, status, property, room_id, room_configuration, folio {folio_id,url,folio_status_color_code,folio_number,folio_status}); reservation = business date satu hari, folio bukan cancelled(2)/checked-out(1); tree building dari types grup 'template-floor-plan' (link mht -> nama building/floor, layout = slug(description), code_image = text); master + room_type_groups (grup 'room-type-grouping') + templates. Filter dari GET ?key_X=1,2 DAN body POST keys room_types_1:true (parity srcstr Laravel).
- **Room Availability "Not Data"**: roomAvailability node cuma query room_availabilities (kosong). Di-rewrite ke parity Laravel StatisticController.roomAvailability: grid room x tanggal (business date +7 hari atau date_from/date_to), table = Unit(is_link)/Room Type/Room Status(is_drag)/Maid Status(is_drag) + kolom select per-tanggal (vacant/blocked), rows label room_status/maid_status berwarna, sel per-tanggal = reservation (colspan by grup folio, getColorReservation, tooltip HTML link) > blocked (room_availabilities uniqueCode colspan) > OOO (work_orders end_date null, colspan = diffDate atau diff ke end_date) > vacant (href Change ?parent=55&add=1&data=room&date=). Filter room_conf/room_type/room_type_group. master status_rooms/room_types/room_configurations/room_type_groups.
- **Meta master edit rate**: rate.controller.ts edit() success(res, result, 'Success') tanpa meta -> datauser?.master?.code_posts undefined -> dropdown Edit Rate No Options (kelas bug yang sama kayak Tab Rate). Fixed: success(res, result, 'Success', 200, { master }); master dihapus dari result. (create + barRateCreate udah ke-fix di fd1503c.)
- **Scope property room type**: query room_types rate create/edit/barRateCreate tanpa property_id -> daftar Room Type semua property. Fixed: property_id: propertyId (parity Laravel RoomType::onlyActive: status 1).
- **utils/cmsStatus.ts baru**: ROOM_STATUSES (0 vacant..4 out_of_order), MAID_STATUSES, STATUS_RESERVATION_MAP, getColorRoom/getColorCodeRoom/getColorMaid/getColorCodeMaid/getColorReservation/getColorCodeReservation, dashLabel, ucfirst, folioUrl (fit/git/vr). AuthController.getBusinessDate jadi public. ApiMeta + key building/meta.
- rate edit() termasuk code_gls invalid (schema cuma code_billings) -> select id/name.
- tsc bersih + jest 69/69.

## 2026-08-14 audit cross-sector: parity master meta + route ilang (df65184)
- Audit penuh (GLOBALURI frontend/read master vs route/handler node) SEMUA halaman form buat kelas bug yang sama: master meta ilang, route ilang.
- utils/cmsConfig.ts baru: STATUSES (Active/Inactive), REGIONS (6), SUBSCRIBE_TYPES (Monthly/Yearly), BILLINGS (By Company/By Department), TERMS (7), ITEM_LOST_FOUND_STATUS (4), STATUS_LOST (Lost/Found), IS_TAXS, IS_TAX_EXCLUDE_RESTAURANTS, moneyFormat (parity Laravel 1.234,56), calculateCodePost (parity CodePost::calculate inclusive/exclusive).
- generic.controller createForm/editForm: master {} -> master per-model. statuses default; overbooking + room_types (property-scoped) + business_date top-level; allotment + company_guest. (Laravel AllotmentController@create cuma statuses - company_guest dibutuhin form node.)
- HousekeepingController.roomStatusMaster (parity Laravel HouseKeepingRoomStatusController@masterFilter): statuses/maidStatuses/roomStatuses/housekeepers/houseKeeperHistory:null/builder/floor/business_date/roomTypes. Route GET /housekeeping/room-status/master (tadinya MISSING -> crash index housekeeping-room-status).
- ConciergeController.lostFoundForm: path create+edit sekarang return master {statuses, itemsStatus, reservations:[], rooms, statusLost} (parity Laravel LostAndFoundController@create/edit).
- CompanyController.createForm: master sekarang penuh (parity Laravel CompanyProfileController@create): statuses/statusGuest (normal-first)/regions/typeCompany/billings/terms/market_segment_1-4/source/staff/markets (formatData property)/statusBlacklist + countries/cities (dibaca form node). Path update (id) tadinya tanpa master -> No Options.
- AdminController propertyCreate/propertyEdit: master + statuses/companies/is_taxs/is_tax_exclude_restaurants/market_segments/subscribe_types/regions (parity Laravel PropertyController@create).
- FrontDeskController + routes: transactionCreate (parity Laravel TransactionController@create: master ledgers/code_posts(type_payments IS_PAYMENT)/postCodeManual(DEFAULT)/folios(transfer)/paid_out/payment/bussiness_date, data=folio), transactionFolio (folio check-in), updateData PUT /front-desk/data/:id (save remark; Laravel 404 upstream). GET /transaction/create + GET /transaction/folio didaftarin SEBELUM /transaction/:id (fix param shadow).
- MasterDataController + routes: getCharge (surcharge_type flat/%, calculateCodePost pb1/service/tax3, amount/total moneyFormat, ledger via billing_tos by code_billing) + getCodeItems (code_items aktif, search, amount=moneyFormat(sales)). Didaftarin sebelum /code-post/:id di master-setup + master-system routes.
- ReservationController.moveLedger (parity Laravel ReservationController@moveLedger: update bill_to) + PUT /reservation/ledger/move/:id.
- ApiMeta + key ledger.
- Ga diubah (bug upstream Laravel, frontend-node mirror Laravel): form holiday + overbooking GLOBALURI=/cms/rate dan /cms/allotment (sama di Laravel).
- tsc bersih + jest 69/69, boot bersih.
## 2026-08-14 penutup audit residual (bd00320)
- form email-builder: emailBuilderForm sekarang return master.templateTypes (8 static parity Laravel) di create+edit.
- form email-group: emailGroupForm master.users (semua user aktif id/email); edit + data.group_list (emails -> {value,label}); store/update convert array group_list -> email gabung koma (parity Laravel).
- select "Comm Code" company-others: buildCompanyMaster + code_posts (Laravel ga punya - gap upstream, node superset).
- event-management-item: itemList + event_id wajib (400 tanpa, parity Laravel), filter event_management_id, table parity formatTable (select Item code_items + description/cost/frequency/cost_on terkait, Description, Cost, Frequency Daily/Once/Twice, Cost On Actual Day, QTY) + permission 1133; baru itemStore (event_id dari query) + itemUpdate + itemDestroy + routes POST/PUT/DELETE /event-management-item.
- master housekeeping-room-status diverifikasi: halaman cuma fetch /housekeeping/room-status/master (udah ada, semua keys).
- smoke test /api/event-items + ?event_id=1. tsc bersih + jest 69/69.