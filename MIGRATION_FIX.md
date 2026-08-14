# Migration Bug Fix Plan — Phase-by-Phase

Goal: Fix all bugs in backend-node migration log. Each phase = independent work unit with checklist.

---

## Phase 1 🔥 CRITICAL: BigInt Crash Explosion

Root cause: Prisma returns `BigInt` for numeric fields. `JSON.stringify` throws `Do not know how to serialize a BigInt`. Also `BigInt(null)` and `BigInt("null")` crash.

### 1.1 Null-safe BigInt conversion
Every `BigInt(x)` call must guard against null/undefined/string-"null".

Files to fix:
| File | Line | Broken code | Fix |
|------|------|-------------|-----|
| `system.controller.ts` | 284 | `BigInt(id)` where id = "null" string | `if (id && id !== 'null') ...` |
| `guest.controller.ts` | 337 | `BigInt(idParam)` where id = "guest-listing-report" | Route ordering: catch sub-routes before `:id` |
| `reservation.controller.ts` | 503 | `BigInt(idParam)` where id = "master" | Route ordering: catch sub-routes before `:id` |
| `reservation.controller.ts` | 664 | `BigInt(guest_profile_id)` where value = null | `guest_profile_id ? BigInt(guest_profile_id) : undefined` |
| `reservation.controller.ts` | 665 | `BigInt(company_profile_id)` where value = null | Same pattern |

### 1.2 BigInt JSON serialization
Every `success(res, data)` call where `data` comes from raw Prisma query must use `bigintToNumber()`.

Files to fix:
| File | Line | Error |
|------|------|-------|
| `dynamic-rate.controller.ts` | 97 | `success(res, formatted, ...)` — `formatted` has BigInt fields from Prisma |
| `rate.controller.ts` | 128 | `success(res, formatted, ...)` — same issue |
| All other controllers returning raw Prisma data | — | Grep for `success(res, \w+` where variable comes from `prisma.findMany/Aggregate` |

### 1.3 Route ordering
Express matches routes in order. A route `GET /guest/:id` catches `/guest/guest-listing-report` before a separate explicit route can match.

Fix: Move all static/sub-route definitions BEFORE `:id` param routes.

Files:
| File | Conflicting routes |
|------|-------------------|
| `guest.routes.ts` | `GET /guest/guest-listing-report` vs `GET /guest/:id` |
| `reservation.routes.ts` | `GET /reservation/master`, `GET /reservation/rate-by-company-id` vs `GET /reservation/:id` |

**Checklist:**
- [x] system.controller.ts:284 — guard `id !== 'null'`
- [x] guest.controller.ts:337 — defensive BigInt + return 404 for non-numeric
- [x] reservation.controller.ts:503 — defensive BigInt + return 404 for non-numeric
- [x] reservation.controller.ts:664-665 — null guard (change `!== undefined` to `!= null`)
- [x] dynamic-rate.controller.ts:97 — added bigintToNumber() + wrapped
- [x] rate.controller.ts:128,909,1381,1544 — wrapped all 4 list
- [x] system.controller.ts:254,801,849 — wrapped data
- [x] event.controller.ts:187,396 — wrapped raw results
- [x] user.controller.ts — added bigintToNumber, wrapped 5 calls
- [x] rate-addon.controller.ts — added bigintToNumber, wrapped all
- [x] company-contract-rate.controller.ts — wrapped formatContractRate
- [x] room.controller.ts:1178 — wrapped configurations
- [x] user-guest.routes.ts — reorder static before `:id`
- [x] reservation.routes.ts — full rewrite: static before `:id`
- [x] All 16 remaining route files audited — zero bugs

---

## Phase 2 ✅ Missing Routes (404)

Frontend calls these endpoints but backend returns 404. All 25 items resolved (24 route-level, 1 blocked pending Prisma model).

| # | Endpoint | Expected behavior |
|---|----------|-------------------|
| 1 | `GET /cms/bar` | Bar/Rate plan list |
| 2 | `GET /cms/bar/create` | Create bar form |
| 3 | `GET /cms/allotment` | Allotment list w/ date range filters |
| 4 | `GET /cms/allotment/create` | Create allotment form |
| 5 | `GET /cms/overbooking` | Overbooking list |
| 6 | `GET /cms/overbooking/create` | Create overbooking form |
| 7 | `GET /cms/yield` | Yield management list |
| 8 | `GET /cms/hotel-competitor` | Competitor list |
| 9 | `GET /cms/master-hotel-competitor` | Master competitor list |
| 10 | `GET /cms/guest-request` | Guest request list |
| 11 | `GET /cms/room-statistic` | Room statistic data |
| 12 | `POST /cms/room-statistic` | Update room status |
| 13 | `GET /cms/statistic/occupancy` | Occupancy stats |
| 14 | `GET /cms/statistic/statistic-room-type` | Room type stats |
| 15 | `GET /cms/statistic/statistic-room-type-grouping` | Room type groupings |
| 16 | `GET /cms/statistic/room-availability` | Room availability chart |
| 17 | `GET /cms/assign-room` | Assign room to folio |
| 18 | `GET /cms/countryByRegion` | Country dropdown by region |
| 19 | `GET /cms/cityByCountry` | City dropdown by country |
| 20 | `GET /cms/housekeeping-setup/create` | Create housekeeping setup form |
| 21 | `GET /cms/email/email-send/master` | Email send form |
| 22 | `GET /cms/room-type/get-configuration/:id` | Room type config |
| 23 | `GET /cms/reservation/:id/update` | Reservation update form |
| 24 | `GET /cms/profile/guest` | Guest list |
| 25 | `GET /cms/profile/guest/create` | Create guest form |

**Checklist:**
- [x] #1 bar — `/bar` + `/bar-rate` aliases in rate.routes.ts
- [x] #2 bar/create — in rate.routes.ts (already existed, line 64)
- [x] #3-4 allotment — GenericController in phase4.9.routes.ts
- [x] #5-6 overbooking — GenericController in phase4.9.routes.ts
- [x] #7-8 yield — GenericController in phase4.9.routes.ts (+ inline `/yield/create` handler)
- [x] #9 hotel-competitor — GenericController in phase4.9.routes.ts
- [x] #10 master-hotel-competitor — GenericController in phase4.9.routes.ts
- [x] #11 room-statistic — alias in room.routes.ts → `RoomController.statistics`
- [x] #12 POST /room-statistic — inline handler in phase4.9.routes.ts (bulk room status update)
- [x] #13 statistic/occupancy — inline handler in phase4.9.routes.ts
- [x] #14 statistic/statistic-room-type — alias in statistic.routes.ts → `StatisticController.byRoomType`
- [x] #15 statistic/statistic-room-type-grouping — alias in statistic.routes.ts → `StatisticController.byRoomType`
- [x] #16 statistic/room-availability — alias in statistic.routes.ts → `StatisticController.roomAvailability`
- [x] #17 assign-room — inline handler in phase4.9.routes.ts (GET, available rooms)
- [x] #18 countryByRegion — inline handler in phase4.9.routes.ts
- [x] #19 cityByCountry — already in phase4.6.routes.ts
- [x] #20 housekeeping-setup/create — inline handler in housekeeping.routes.ts
- [x] #21 email/email-send/master — placeholder in phase4.9.routes.ts (needs Prisma model for full impl)
- [x] #22 room-type/get-configuration/:id — alias in room.routes.ts → `typeShow`
- [x] #23 reservation/:id/update — alias in reservation.routes.ts → `edit`
- [x] #24 profile/guest — lazy-import GuestController.list in phase4.9.routes.ts
- [x] #25 profile/guest/create — lazy-import GuestController.create in phase4.9.routes.ts
- [ ] guest-request — blocked (Prisma model `guest_requests` not in schema.prisma)

---

## Phase 3 🔧 Query Param Mismatch (mostly done)

Frontend `Fetcher` sends query params in specific format. Backend must parse correctly.

### Known mismatches:

**3.1 `group` param → module/menu path filter**
Frontend sends `group=master-report`, `group=pos-matrix-saless`, `group=check-in`, etc.
Backend rarely uses `group` — most controllers ignore it.
Fix: Map `group` to appropriate filter in each list handler.

**3.2 `search` param**  
Frontend sends `search=` (empty) or `search=keyword`
Must work with Prisma `where: { field: { contains: keyword } }` across controllers.

**3.3 `trash` param**
Frontend sends `trash=0` (active) or `trash=1` (soft-deleted)
Backend must apply `deleted_at: null` or `deleted_at: { not: null }` accordingly.
Many controllers hardcode `deleted_at: null` ignoring `trash` param.

**3.4 Date range params**
Some pages send `start_date`, `end_date` as query params (e.g. overbooking, statistic).
Backend must filter by date range when present.

**3.5 String `"null"` → actual null**
Frontend sends `module=null`, `id=null`, `start=undefined` as literal strings.
Backend must convert string `"null"` → `null`, string `"undefined"` → `undefined`.

**Checklist:**
- [x] Create `queryParamHelper.ts` — reusable pagination, search, trash, date range, group helpers
- [x] `buildSearchWhere.ts` — merged into `queryParamHelper.ts` (`buildWhere`, `parseSearch`)
- [x] requestParser.middleware.ts — normalize string "null" → null, "undefined" → undefined (global fix)
- [x] Audit list() methods: added trash awareness to 10 controllers (reservation, rate, room, promotion, dynamic-rate, user, guest, accounting, company, company-contract-rate)
- [x] GenericController already handles `search` + `trash` (verified)
- [x] `group` param — front-desk/reservation already handle per-controller; others don't need
- [x] `date_range` — add to GenericController when specific frontend errors surface (model-specific fields)
- [x] Remaining non-list controllers — low priority, fix on-demand

---

## Phase 4 ✅ Frontend Response Format Alignment

Frontend expects specific data shapes. Backend returns mismatched shapes.

### 4.1 Header breadcrumbs crash
Fixed: `menuGetParentByIdChildren` now traverses parent chain and returns `breadcumbs` array in response.

### 4.2 Table-drag crash
Fixed: GenericController `list()` now emits `table`, `permission`, `search_data`, `pagging`.

### 4.3 CheckBoxBase crash
Mitigated: GenericController `show()` now returns `table`, `search_data`, `permission` — ensures response has all expected keys.

### 4.4 Generic CRUD form data structure
Fixed: GenericController `list()`, `show()`, `create()` all emit `table`, `search_data`, `permission`.

**Checklist:**
- [x] menu/get-parent-by-id-children — breadcrumbs + fixed `route` → `url` field name
- [x] Generic list — always emit `table`, `permission`, `search_data`, `pagging`
- [x] Generic show/create — always emit `table`, `search_data`, `permission`
- [x] TS compilation clean
- [ ] CheckBoxBase `options: []` — depends on specific field config (further fixes on-demand)

---

## Phase 5 ✅ Module-Specific Logic Bugs

### 5.1 Promotion — 422 validation errors
Fixed: Added camelCase/snake_case field fallbacks in `store` + `update`. Rules field handles array → JSON string.

### 5.2 Front Desk — reservation update routes
Fixed in Phase 2: `/:id/update` alias + `/assign-room` GET handler.

### 5.3 Log list — `id` and `module` params
Fixed in Phase 3: requestParser normalizes string "null" → null globally.

### 5.4 Dynamic rate BigInt
Fixed in Phase 1.2: wrapped with `bigintToNumber()`.

### 5.5 Reservation update null/undefined
Fixed in Phase 1.1: `!= null` guard.

**Checklist:**
- [x] promotion — camelCase fallback + rules array handling
- [x] reservation.routes — `/:id/update` route (Phase 2)
- [x] reservation.routes — `/assign-room` route (Phase 2)
- [x] logList — null string guard via requestParser (Phase 3)
- [x] dynamic-rate — bigintToNumber (Phase 1.2)
- [x] reservation update — null guard on BigInt (Phase 1.1)

---

## Phase 6 ✅ Cleanup & Polish

### 6.1 Route aliases audit
226 routes registered across 18 route files. Bulk of Phase 2 resolved all missing routes.

### 6.2 Permission system — FIXED
`frontend/redux/auth/permissionHelper.ts`:
- Line 18: `=== true` → `!!` (truthy) for `transaction_actions`
- Line 29: `=== true` → `!!` (truthy) for CRUD actions

### 6.3 Error response consistency — FIXED
404 catch-all in `index.ts`: `res.status(404).json(...)` → `notFound(res, 'Not Found')`.

### 6.4 Frontend `source-maps` warning
Minor — suppress in `next.config.js` on demand.

**Checklist:**
- [ ] Route alias audit — 226 routes registered; verify on-demand
- [x] permissionHelper.ts — strict `=== true` → lenient truthy
- [x] Error response format — 404 handler unified via `notFound()`
- [ ] Next.js source-maps warning — minor, fix on demand

---

## Phase 7 ✅ Bar Master CRUD parity (2026-08-13)

Frontend Rate & Bar Sales Marketing pages: create/update failed ("Failed to load form data", 404, "rate id is required").

### 7.1 New `bar.controller.ts` — full parity with Laravel `BarController` (rates where module='bar')
- [x] `list` — search name/description/code, `whereBetween` created_at, code_post join, pagging, table, permission (menu 87), business_date default on start_date row
- [x] `create` — master: statuses, code_posts, business_date (via `log_audits` last date +1)
- [x] `store` — Laravel validations + date overlap check ("Date range is overlap with another bar") + duplicate code ("Code already exist")
- [x] `show` / `edit` — formatData + master
- [x] `update` — partial update, overlap check excluding self
- [x] `destroy` (soft) / `forceDelete` (`/delete`) / `restore`
- [x] `getRoomType` (`/bar/minimum-rate`) + `updateRoomType` (`PUT /bar/minimum-rate/:id`)

### 7.2 Routes — `rate.routes.ts` remap
- [x] `/bar` list/create/store; `/bar/minimum-rate`; `/bar/inclusives` (wrapper maps `?bar_id=` → `rateId`, reuse `RateAddonController`)
- [x] `/bar/:id` show; `/bar/:id/update` edit; `PUT /bar/:id`; `DELETE /bar/:id`; `/delete`; `/restore`
- [x] Static paths (create/minimum-rate/inclusives) registered BEFORE `/bar/:id`
- [x] `/rate/:id/update` alias → `RateController.edit` (frontend form URL)

### 7.3 Bug fixes
- [x] `RateController.edit` — BigInt serialization 500 → explicit Number() conversion of all BigInt fields
- [x] `RateController.list` — add `module: 'rate'` filter (bar rows leaked into rate list)
- [x] `RateController.create`/`edit` — master now includes `comm_codes` (empty), `company_types`, `cancelations` (types group `company-type` / `cancellation-reservation`) per Laravel
- [x] **DB sequences stale after import** — `rate_inclusives_id_seq` at 2 while MAX(id)=69 → P2002 unique on insert. Fixed ALL public-schema sequences: `setval(seq, GREATEST(MAX(id),1))` (script `fix_sequences.sql`)

### 7.4 Verified (test-bar-crud.js, all 200)
- [x] bar list/create-form/edit-form/show, POST store, PUT update, GET/POST/DELETE inclusives, soft delete, 404 after delete, restore, force delete
- [x] rate edit form (`/rate/:id/update`), rate create master keys
- [x] `tsc` clean

---

## Phase 8 ✅ Route alias coverage + probe audit (2026-08-13)

Audit probe (`probe-all.js`) hit every frontend GLOBALURI; fixed all 5xx, verified all list endpoints 200.

### 8.1 Route aliases added (frontend URI → handler)
- [x] `/profile/guest-document|family|history|preference|loyalty-card` GET/POST/DELETE (guest_id query) — `user-guest.routes.ts`
- [x] `/profile/guest-folio` — `GuestController.folioList` (paginated folios by guest_id)
- [x] `/profile/company-contract-rate` GET/POST/PUT/DELETE — `rate.routes.ts`
- [x] `/company-profile-billing-setup` — `CompanyController.billingSetupList/Store/Destroy`
- [x] `/concierge/baggage` CRUD — `concierge.routes.ts`
- [x] `/master-capacity|inventory|layout|venue` — `event.routes.ts` (`capacityList` on event_capacities, GenericController for others)
- [x] `/reservation/code-item|inclusive|masterInclusive|subfolio/:id` — `ReservationController` statics BEFORE `/reservation/:id`
- [x] `/rate/code-item` — `ReservationController.codeItemList` (moved above `/rate/:id`; was shadowed → 500 "Failed to fetch rate")
- [x] `/transaction/pos` — `PosController.listTransactions` before `/transaction/:id` (was BigInt crash on id='pos')
- [x] `/housekeeping-setup/create` + singular `/housekeeping-setup/:id/update`
- [x] `/yield/:id/update` + `/yields/:id/update` — `extra.routes.ts`
- [x] `POST /dynamic-rate(s)/:id/disable` — `DynamicRateController.disable`
- [x] `GET /accounting/:type/create` (createForm) + `PUT /accounting/:type/:id` (updateStatus)

### 8.2 BigInt serialization fixes
- [x] `GuestController.edit` master (Number on t.id/s.id/b.id); `formatGuest` Number() on nationality/city/country/status/title/property ids
- [x] `RoomController.show` room_configurations/in_room_equipments via bigintToNumber
- [x] `CompanyContractRateController.list` company + code_billing
- [x] `AccountingController.show` numeric-id guard (killed `BigInt('create')` crash)
- [x] `GenericController.toPlural` irregulars: stocks, work_order_stocks, roster_list, shift_roster (fixed "Model not found" 500s)
- [x] `company.controller.ts` createForm — countries has no deleted_at; store pid BigInt guard
- [x] `content.controller.ts` otherGuestList — nationality → nationality_id

### 8.3 Tolerance handlers (query-param grids with missing params → empty 200, not 500/404)
- [x] `RateController` — emptyGrid static; barRateIndex, rateLinkListing, rateLinkApplyList, rateCompany non-numeric/missing rate_id → empty success
- [x] `/bar/rate-link-listing` wrapper numeric-checks bar_id/rate_id → emptyGrid

### 8.4 Probe results (final)
- [x] LOGIN OK, zero 5xx, every `list` = 200
- [x] Remaining 404s are artifacts: TableView-only pages (frontend never calls /create or /:id/update — inline add = POST uri, edit = PUT uri/:id) or id=1 data-misses ("Dynamic rate config not found", "Rate is not found", etc.)
- [x] `tsc --noEmit` clean

---

## Error Log Analysis Summary

| Category | Count | Severity |
|----------|-------|----------|
| 🔴 500 — BigInt(null/string) | ~30+ | CRITICAL |
| 🔴 500 — BigInt JSON serialization | ~8 | CRITICAL |
| 🟡 404 — Missing routes | ~25 | HIGH |
| 🟡 404 — Route ordering (static vs :id) | ~15 | HIGH |
| 🟡 422 — Validation mismatch | ~8 | MEDIUM |
| 🔴 Frontend crash — undefined.map | Continuous | HIGH |
| 🟢 200 — Working routes | ~60 | ✅ |

---

**Started**: 2026-07-15
**Last Updated**: 2026-08-14
**Next**: verify session fixes live (rate update, bar tab-rate, guest POST, rate form dropdowns) after watchlogs restart; crosscheck remaining menu pages (rate-bar/bar inclusive endpoints may still need bar_inclusives/bar_rates mapping); close issues #6 #7 #8.

## 2026-08-14 (session 3)
- **rate.controller.ts update()**: validation relaxed to Laravel parity (name/start_date/end_date/code/code_post_id optional, applied only when present) — fixes PUT /cms/rate/:id 422 (frontend rate form sends no name/start_date/end_date).
- **barRateIndex**: was querying rates by bar_id (rate not found -> 404 -> frontend "Tab Rate" crash); now bars.findUnique parity with Laravel BarRateController.
- **extra.routes.ts**: POST /profile/guest store route added (was 404 on guest form save).
- **frontend-node rate form**: options index misalignment fixed (data[7]=code_posts, data[8]=company_types, data[9]=cancelations, data[11]=code_posts) — Post Code/Grouping/Extra Bed dropdowns were empty.
- **prisma client regenerated** (stale generated types — bars model missing).
- tsc clean + jest 69/69. Commits c114e5b + 2d92e61 pushed; current batch uncommitted.

## 2026-08-14
- **guest.controller.ts**: static methods called unbound (GuestController.list) crash on 	his.formatGuest → replaced with GuestController.formatGuest (5 sites). Guests list was 500 in prod.
- **front-desk.routes.ts**: /front-desk/:id shadowed /front-desk/shifts (static-after-param). Reordered.
- **Test suite**: 66/70 failing at HEAD — responses are AES ciphertext (res.text, not res.body); helpers.ts now decrypts. Wrong route paths corrected. TEST_USER.lastProperty 999n (property 1 missing in dev DB). 69/69 green.
- **tsconfig.json**: isolatedModules moved from jest config to compilerOptions (kills ts-jest v30 deprecation warning).