# HMS Anyaman — Node Stack Status & Handover Guide

> Last updated: 2026-08-13. This file is the single source of truth for resuming work on the node stack (backend-node + frontend-node). Pair it with `MIGRATION_FIX.md` (per-phase fix log) and the GitHub issues linked below.

---

## 1. Repos

| Repo (dir) | GitHub | Branch | Status |
|-----------|--------|--------|--------|
| `backend-node/` | `git@github.com:ianocent/nodeHMS.git` | `main` | Active development |
| `frontend-node/` | `git@github.com:ianocent/nodefeHMS.git` | `main` | Dev server work |
| `backend/` | `git@github.com:ianocent/hms-backend.git` | `main` | Clean (untouched, Laravel reference) |
| `frontend/` | `git@github.com:ianocent/hms-frontend.git` | `main` | Clean (untouched, Next.js reference UI) |

## 2. Architecture (backend-node)

- **Express + Prisma (PostgreSQL)**, TypeScript via ts-node, port **3001**.
- All `/cms/*` responses **AES-256-CBC encrypted** (`iv_hex:cipher_hex`, `Content-Type: text/plain`). Key: `lbwyBzfgzUIvXZFShJuikaWvLJhIVq36` (also in `frontend-node/next.config.js` as `passAes`).
- Auth: `POST /api/login` (encrypted JSON body `{email, password}`) → `data.access_token`; subsequent calls send `X-Token: <token>`. Always `GET /cms/force-logout/dev@dipstrategy.com` before login (single-session enforcement).
- Test login: `dev@dipstrategy.com` / `password`.
- Frontend API base: `http://localhost:3001` (hardcoded in `frontend-node/next.config.js` `suriApi`).

## 3. How to Run

**Backend** (3001):
```powershell
# restart (detached, log to file):
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'backend-node' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process cmd.exe "/c cd /d C:\Users\uzuma\Documents\hms-anyaman\backend-node && npm run dev > C:\Users\uzuma\AppData\Local\Temp\opencode\node-dev.log 2>&1" -WindowStyle Hidden
# wait ~20s; check log tail for "Phase 4.x ... active" lines
```
- Typecheck: `rtk tsc --noEmit` (rtk = token-compressing wrapper; plain `tsc` also fine).
- Watch errors in `C:\Users\uzuma\AppData\Local\Temp\opencode\node-dev.log`.

**Frontend** (3000):
```powershell
cd C:\Users\uzuma\Documents\hms-anyaman\frontend-node; npm run dev
```

## 4. Probing / Verification

- Probe script: `C:\Users\uzuma\AppData\Local\Temp\opencode\probe-all.js` (logs in, hits every frontend GLOBALURI: list `?page=1`, `/create`, `/1/update`, `/1`).
- Acceptance: **zero 5xx, every list endpoint 200**. 404s are OK when:
  - **TableView-only pages** — frontend never calls `/create` or `/:id/update` (inline add = `POST uri`, edit = `PUT uri/:id`; see `frontend/components/common/table-edit/index.tsx`). Modal-form pages (dirs with `form/`) DO need `/create` + `/:id/update`.
  - **Data-miss 404s** — probe hardcodes `id=1`; custom messages ("Rate is not found", "Dynamic rate config not found") mean route works but record absent.
- Probe URI list includes stale entries not present in frontend (front-desk, pos-matrix-sales, batch-posting, shift-confirmation, post-code-budget, allocation-history, other-guest, etc.). Routes exist anyway; do NOT chase them.

## 5. Fix Log (recent sessions)

### Phase 8 (committed `ad20264`, pushed) — route alias coverage + probe audit
- New routes: `/profile/guest-document|family|history|preference|loyalty-card|folio`, `/profile/company-contract-rate`, `/company-profile-billing-setup`, `/concierge/baggage`, `/master-capacity|inventory|layout|venue`, `/reservation/code-item|inclusive|masterInclusive|subfolio/:id`, `/rate/code-item` (moved above `/rate/:id` — was shadowed → 500), `/transaction/pos`, `/housekeeping-setup/create` + `/housekeeping-setup/:id/update`, `/yield/:id/update`, `POST /dynamic-rate(s)/:id/disable`, `/accounting/:type/create` + `PUT /accounting/:type/:id`.
- BigInt serialization fixes (Number() / bigintToNumber): guest edit master, room show, company-contract-rate list, accounting show numeric guard, GenericController toPlural irregulars (`stocks`, `work_order_stocks`, `roster_list`, `shift_roster`), company createForm (countries has NO `deleted_at`), content otherGuestList (`nationality` → `nationality_id`).
- Rate tolerance handlers: `RateController.emptyGrid` static; barRateIndex / rateLinkListing / rateLinkApplyList / rateCompany tolerate missing/non-numeric params → empty 200.
- Full detail: `MIGRATION_FIX.md` Phase 8.

### Latest (committed `eebf2bc`, pushed) — user form 500
- `UserController.create` + `edit` returned BigInt ids in master (companies/properties/roles) → "Do not know how to serialize a BigInt" → `Number(c.id/p.id/r.id)`. Verified: `/cms/user/create`, `/cms/user/1/update`, `/cms/user?page=1&limit=10&name=&trash=0` all 200.

### Frontend-node (LOCAL ONLY — `next.config.js` is gitignored, `.gitignore:5`)
- Removed invalid PM2 `apps` key (killed "Unrecognized key(s) in object: 'apps'" warning).
- Disabled webpack filesystem cache in dev + watchOptions ignore node_modules/.next → fixes `RangeError: Failed to allocate memory` (gzip cache serialize OOM, machine has only ~9.8GB RAM).
- Watchpack EINVAL errors on `C:\pagefile.sys` etc. are harmless.

## 6. Outstanding Work (GitHub issues)

| Issue | Repo | Summary |
|-------|------|---------|
| [#6](https://github.com/ianocent/nodeHMS/issues/6) | nodeHMS | guest-request routes query missing Prisma model → 500. Add `guest_requests` model (mirror Laravel table) or remap handler. |
| [#7](https://github.com/ianocent/nodeHMS/issues/7) | nodeHMS | report routes mounted at root only; `GET /api/cms/report` 404. Add `app.use('/api', reportRoutes)` in `src/index.ts` + smoke test. |
| [#8](https://github.com/ianocent/nodeHMS/issues/8) | nodeHMS | ts-node source-maps warning at boot (cosmetic). |
| [#2](https://github.com/ianocent/hms-frontend/issues/2) | hms-frontend | `permissionHelper` strict `=== true` fails for values `1`/`"true"` → lenient truthy check needed. Super-user roles: developer/administrator/anyaman. |
| [#3](https://github.com/ianocent/hms-frontend/issues/3) | hms-frontend | Hardcoded API base `http://192.168.143.50:8000` + AES key → move to .env/secrets. |

Other notes:
- DB sequences were stale after import (unique-violation on insert) — fixed via `fix_sequences.sql` (setval every public schema seq to MAX(id)). If new P2002 errors appear, re-run it.
- `MIGRATION_FIX.md` footer tracks overall phase state — update it after each new phase.
- The `backend/` (Laravel) repo is the parity reference for endpoints/behavior.

## 7. Conventions / Gotchas

- Express static handlers do NOT bind `this` → use module-level helpers (precedent: `reservationBn` in reservation.controller.ts).
- Static paths must be registered BEFORE `/:id` param routes in the same router.
- BigInt from Prisma is everywhere (id fields) — wrap responses with `bigintToNumber()` or explicit `Number()` before `success()`.
- MenuId-based permission checks on every route (`requirePermission(menuId, action)`); super-user bypasses.
- Always `force-logout` before login in scripts; token rotation is enforced.
## 2026-08-14 Session (continuation)

### Guest Requests (Issue #6) — Folio parity (DONE)
- Rewrote list in src/routes/extra.routes.ts: was wrong guest_profile_preferences impl → now Laravel GuestRequestController parity on folios table.
- Query: folios where property_id, deleted_at null, OR of 4 instruction fields (not null AND not ''), include reservations (deleted_at null, is_posting 0, orderBy date asc, take 1) + company_profiles_folios_company_profile_idTocompany_profiles.
- Guest name/account via manual guest_profiles join (no Prisma relation).
- Constants: GR_STATUS_RESERVATION 0=Check In,1=Check Out,2=Cancelled,3=Reservation,4=In House,5=Pending (verified vs config/cms.php + live DB).
- Colors match Laravel Global.php: reservation bg-green/purple/red/cyan/blue/yellow; room bg-cyan/green/purple/red/black-red; maid bg-cyan/red/yellow/green.
- Removed guest-request create/show/update/delete (Laravel index only).
- Live check: GET /cms/guest-request?page=1&limit=2 -> 200, 2 rows.

### Reports mount (Issue #7) — DONE
- src/index.ts now mounts reportRoutes at both root AND /api (Laravel parity).
- Live check: GET /api/cms/report/batch -> 200, 1 row.

### Issue #8 (ts-node source-maps warning) — NOT reproducible on Node v24.14.0 + ts-node 10.9.2; booted clean on PORT=3999. Close.

### Test suite rescue (pre-existing rot, NOT caused by session changes)
- At HEAD: 66/70 tests failed. Root causes:
  1. All /cms responses AES-encrypted (text/plain) → supertest puts ciphertext in res.text, res.body={} → tests never saw JSON. Fix: parseBody()/expectLaravelFormat() in src/__tests__/helpers.ts now decrypt (APP_AES_PASSWORD from .env).
  2. Contract is code/data/message (frontend checks code=="200" in components/helper/index.tsx), NOT 'success' — helper updated.
  3. Real bugs found + fixed:
     - guest.controller.ts: unbound 	his.formatGuest in static list/store/show/update → 500. Replaced with GuestController.formatGuest (5 call sites).
     - front-desk.routes.ts: /front-desk/:id registered BEFORE /front-desk/shifts → param shadowing 404/400. Shift routes moved above /:id (static-before-param).
  4. Wrong test paths fixed: /api/code-post, /api/setup, /api/log, /api/room-changes, /api/log-audits, /api/shift-confirmation, /api/cms/report-permission, /api/status+/- added to test app.
  5. TEST_USER.lastProperty 1n → 999n (property 1 does NOT exist; 999 does) — fixes guest documents FK 500.
- Result: npm test 69/69 PASS.
- ts-jest isolatedModules deprecation: moved from package.json jest transform → tsconfig.json compilerOptions.

### Frontend (frontend-node)
- redux/store/store.ts: SSR-safe redux-persist (createNoopStorage + createWebStorage('local')).
- tailwind.config.js: borderRadius large + 2xl (1.5rem) — fixes invalid theme value warning.
- next.config.js: experimental.optimizePackageImports (@nextui-org/react, framer-motion, apexcharts, tinymce, ckeditor). cache:false already present (OOM fix).
- package.json: packageManager yarn@1.22.22 (yarn.lock v1 tracked).
- .gitignore: next.config.js un-ignored (next.config.local.js + next.config.qa.js ignored instead) — config now committable.

## 2026-08-14 Session (continuation)

### Fix batch 2 (committed `fc61455`, pushed) — menu list parity, night-audit trio, email master, statistic, guest listing
- `menuListBySlug` (admin.controller.ts): Laravel `MenuController.list` parity — `findFirst uri_table='/cms/'+slug`, meta `{typeTable, uriTable, label, isDrag:true, uriSaveDrag, breadcrumbs}`. Label parses JSON-translatable `menus.name` (`{"en":"Packages"}` → `en ?? id ?? raw`).
- **`success()` response helper (response.ts): was silently dropping meta keys** — only spread permission/pagging/table/master/search_data. Added `typeTable/uriTable/label/isDrag/uriSaveDrag/breadcrumbs` to `ApiMeta` + spread. Without this, `/cms/list/:slug` returned `{code,message,data:null}` with no meta → tabledrag pages break.
- `emailSendMaster` (content.controller.ts): email_groups + email_builders → `master.allGroups`/`allTemplate`; route `GET /email/email-send/master` (content.routes.ts).
- Night-audit trio (system.controller.ts + master-system.routes.ts): `nightAuditRoomChange/NoShow/OverStay` — folio queries, `is_posting:false` (Boolean! `0` → 500), noShow status in [1,0] + check_in_date<=date, overStay status=2 + check_out_date<=date, roomChange via `reservations.some room_type_id_next/room_id_next`; `date` required → 400 (Laravel parity).
- `workOrderSummary` (housekeeping.controller.ts): all/open/on_process/finish counts; route before `/work-order/:id`.
- `roomStatisticGrid` (statistic.controller.ts): rooms + building/floor via model_has_types + folio count via `reservations.room_id` (folios has NO room_id); route `GET /statistic` (NOT `/`).
- `guestListingReport` (guest.controller.ts): status_profile/gender/min_age/max_age/search filters; static route before `/guest/:id`.
- Live verified (verify3.js, base `http://localhost:3001` — frontend base, NOT `/api`): check-last-user-folio POST 200 status:0, no-show/over-stay 200 (10 rows w/ date), room-change 200, guest-listing-report 200 (5 rows), email-send/master 200, statistic 200, list/event-package + event-list 200 with label.
- Sweep: 186 URIs → 24 fail, ALL false positives (17 POST-only routes the GET sweep can't hit — helper/check-last-user-folio POST verified 200; 2 date-required 400s; check-value 400; rate/promotion rate_id=1 absent → Laravel parity; companyProfile dead code; bare /cms/list; property/auth/ without id).
- Gotcha: POST probes must send `Content-Type: application/json` — raw `text/plain` bodies get AES-decrypt attempted (requestParser) and stay strings → 400.
- Note: `/api/cms/*` 404s for some route files (master-system/statistic/content/admin) despite dist mounting both `/api` and `/cms`; frontend + sweep use `/cms/*` only, so NOT a blocker. Cause unresolved. → **RESOLVED 2026-08-14**: `report.routes.ts` uses `/cms/...`-prefixed paths mounted at ROOT (`app.use(reportRoutes)` index.ts:106) + `/api` (108) — its `/cms/guest/guest-listing-report` (line 50) explains the stray `/api/cms/guest/...` 200s. All other routers use unprefixed paths mounted at `/api` + `/cms` → `/api/cms/...` cannot match them (by design); frontend only calls `/cms/...` which matches via the `/cms` mounts. No bug.

### Next steps
- [x] Verify guest-request + report mount live
- [x] Fix batch 2 (menu list, night-audit trio, email master, statistic, guest listing, success() meta) — `fc61455` pushed
- [ ] Remove package-lock.json from frontend-node (yarn is source of truth)
- [ ] Clean stale frontend-node/.next
- [x] Root-cause `/api/cms` 404 for master-system/statistic/content/admin mounts — NOT a bug; report.routes legacy `/cms`-prefixed paths at root+/api explain stray 200s; unprefixed routers only match `/cms/...` via their `/cms` mount (frontend convention).
- [ ] Commit + push both repos; close issues #6 #7 #8 (nodeHMS)
## 2026-08-14 menu tabs fix (22ebdbc)
- menuGetParentByIdChildren rewritten: Laravel MenuResources parity (walk to root, recursive children, 66/67/68->63, url ?parent=&module=, place form/table, per-menu permission flags, market_segment filters)
- route optional id (no-id -> 200 code 200 data [])
- special case /reservation/vr/reservation -> 69
- verified live: children/1116 -> 20 rows root children, kids 3,4 (User+Role); vr -> 12 rows first id=63
- verify4.js untracked probe

## 2026-08-14 sidebar parent urls + 2 bugfix (5b4e3cc)
- menuListAll -> MenuResources parity: url ?parent=&module=, alias_url, recursive children, pagging/permission/datas (admin nav-menu page), active-only, market_segment filter
- cityByCountry literal undefined/null -> [] not 500
- guest update: guest_status virtual field removed from data (PUT profile/guest 500 fix)
- verified: USER ACCOUNT 1116 -> /user?parent=1116&module= kids 3,4; cityByCountry undefined -> 200 []; PUT 71819 -> 200
- verify5.js untracked probe

## 2026-08-14 route aliases + BigInt + property CRUD (c114e5b, pushed)
- kebab alias CRUD in extra.routes.ts: stop-sell-booking->stop_sells, content-room->content_rooms, channel-manager-interface->channel_manager_interfaces, payment-matrix->payment_matrices, rate-room->rates, staah-manager->staah_interfaces, staah-reservation->staah_reservations, staah-ota-mapping->staah_ota_company_mappings; allotment/room->room_allotments (registered before /allotment/:id); DELETE /stop-sell-booking bare w/ body id
- generic.controller.ts: kebabOverrides in toPlural; sanitizeBody() strips audit keys + empty-object dates + coerces date strings; create injects property_id from req.user.lastProperty (retry without on unknown-arg); generic list honors _id query filters via BigInt(String(v))
- BigInt fixes: rate-addon barRelationLink + dynamic-rate results wrap bigintToNumber (created_by/updated_by leaking); rate show guards non-numeric id
- rate.routes.ts: /rate/inclusives + /rate/extra-beds aliases (query rate_id -> param rateId) registered BEFORE /rate/:id
- property CRUD in admin.controller.ts + admin.routes.ts (GET /property/create, POST /property, GET /property/:id/update, PUT/DELETE /property/:id)

## 2026-08-14 master-data coercion + guest/room masters (2d92e61, pushed)
- master-data.controller.ts: num(v, fallback=0) + bool(v, fallback=false) helpers; coerced code-billing/post/item/gls + type-payment + holidays create/update: sort/status/isPOS/pay_commission/tax*/sales/cost/pos/front_office/surcharge* -> num(), is_online/is_event -> bool(); string fields kept plain (bad num(name) etc. reverted)
- guest.controller.ts create+edit masters: + countries (no deleted_at filter) + cities: [] (Nationality dropdown fix)
- room.controller.ts create+edit masters: + floors + buildings (types groups) + in_room_equiptments alias (Laravel typo parity)
- Rate edit master already complete: statuses, room_types, code_posts, comm_codes:[], company_types, cancelations, days, fields

## 2026-08-14 rate update lenient + bar tab-rate + guest store (UNCOMMITTED)
- rate.controller.ts update(): dropped required name/start_date/end_date/code/code_post_id validation (Laravel parity - all optional); applies fields only when present; minimum_rate Number() guard
- barRateIndex: was rates.findUnique(rate_id=bar_id) -> "Rate not found" 404 -> bar "Tab Rate" page crash; now bars.findUnique (Laravel BarRateController Bar::find parity), "Bar is not found" 404, master.bar_info from bar
- extra.routes.ts: + POST /profile/guest (guestStore, requirePermission(82,'add')) - was missing -> 404 on guest form save
- frontend-node/components/pages/rate/form/index.tsx: options index misaligned - data[5]=comm_codes, data[6]=code_posts, data[7]=company_types, data[8]=cancelations, data[10]=code_posts -> Post Code/Grouping/Extra Bed dropdowns empty; fixed: data[7]=code_posts, data[8]=company_types, data[9]=cancelations, data[11]=code_posts
- prisma client regenerated (stale since 2026-07-15; bars model missing from generated types)
- tsc clean + jest 69/69

## 2026-08-14 rate form master meta + reservation-item + rate list parity (fd1503c)
- **rate.controller.ts create() (line ~188) + barRateCreate(): `success(res, master, 'Success')` tanpa meta { master }** -> response punya data=master tapi `master` field ABSENT -> frontend `datauser?.master?.days` undefined -> CheckBoxBase.tsx:106 `options.map` crash (Rate Bar "Tab Rate" crash root cause). Fixed: success(res, master, 'Success', 200, { master }).
- **reservation-item** (ReservationItemController parity, room grid per folio): `reservationItemIndex` + `reservationItemUpdate` in reservation.controller.ts + routes GET /reservation-item + PUT /reservation-item/:id (registered in reservation.routes.ts). Was 404 -> folio detail "Tab Reservation/Room" loading forever. Rows: formatData parity (rate/room_type/room_id/remark_room/market_segment_1-4/source via model_has_types morph groups, company_id, total, status_reservation map 0-5). table = formatTableRom (12 cols). meta folio/market_property/reasons added to ApiMeta.
- **rate list table -> full Laravel parity**: code column is_link=true uri=/rate-management/rate (klik Code -> edit form page; TableView is_link branch), all columns inline-editable (status checkbox, code/name/description text, start/end date, code_post_id + code_post_extra_bed_id select dgn options code_posts). Rows formatData parity (code_post_id {value,label}, online/staah/print_rate bools, contract_rate, code_color, sort_by_company/color).
- rate update handler: + code_post_extra_bed_id support.
- /bar/inclusives verified: Laravel BarRelationController.index juga pakai rate_inclusives by rate_id=bar.id -> node inclusiveList parity OK (no change).
- tsc clean + jest 69/69.
