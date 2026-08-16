# menu-audit-phases.md — CRUD Parity Audit Phases (271 menus)

Source: `menus-database-postgre-node.txt` (271 rows).
Goal: verify each parent + sub-menu's CRUD (list/add/edit/delete) matches Laravel reference (`backend/`) via node handlers (`backend-node/`).
User must rebuild + restart backend after each phase, then live-probe.
Existing verification cache: `node-menus.md` Phase 1-2 done (Room Setting 1120, Reservation Setup 1122).

Legend: ✅ done · 🟡 partial · ❌ broken · ⏳ not started · ⚫ inactive(non-CRUD/nav-only/deleted)

---

## Phase 1 — Administrator + User/Role/Permission (parent 1, 1116, 1129) — 13 rows ✅ (audit 2026-08-17)
| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 5 Menu Settings | /navigation-menu | ✅ | ✅ | ✅ | ✅ | menuListAll + route /menu |
| 14 property | /property | ✅ | ✅ | ✅ | ✅ | propertyAuth parity (sesi 3) |
| 15 Client | /client | ✅ | ✅ | ✅ | ✅ | companies table (fix Phase 5) |
| 3 User Name | /user | ✅ | ✅ | ✅ | ✅ | 3 bugfix sesi ini (lihat bawah) |
| 4 Role Management | /role | ✅ | ✅ | ✅ | ✅ | full handler + 13 route |
| 13 Logs | /log | ✅ | — | — | — | logList |
| 6 Permission Settings | /permission | ⚫ | ⚫ | ⚫ | ⚫ | deleted_at (2024-08-03) |

### Bugfix Phase 1 (user.controller.ts)
- `create()`/`edit()`: `c.companies.id` → `c.id` (crash 500 saat property punya company; prisma.companies flat, tanpa nest).
- `update()`: validasi status `!status` → check undefined/null only (status=0 Inactive tadinya selalu 400).
- `store()`: sync property selalu — `property_ids` kosong → fallback `[lastProperty]` (Laravel `sync([last_property])` parity).

## Phase 2 — Master Setup 1: Room Setting (parent 1120) — ✅ (cache node-menus Phase 1 + Room Type fixed 2026-08-17)
34 room-type-grouping · 35/71 room-configurator · 36 in-room-equipment · 168 area · 174 floor · 175 building · 48 room-type(+1095 main/1099 image) · 50 room-setup(+177 audit)
→ cache node-menus.md Phase 1. Room Type (48) tambahan fix sesi ini:
- `typeCreate()`: master jadi top-level meta (tadinya di `data` → dropdown Room Type Grouping No Options).
- `typeEdit()`: master top-level + `roomTypeGroupings` + prefill `data.room_type_grouping` (Laravel serializes `type` relation).
- `typeStore()`: sync `room_type_grouping` → `model_has_types` (Laravel `type()->sync`), tadinya drop.
- `typeUpdate()`: guard status 1→0 bila ada reservation aktif (Laravel 400) + sync grouping.
- Image path (1099): route + handler imageList/form/store/update/destroy ada.

## Phase 3 — Master Setup 2: Billing Setup (parent 1117) — 8 rows ✅ (audit 2026-08-17)
| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 43 code-billing | /master-setup/billing-code | ✅ | ✅ | ✅ | ✅ | masterForm + statuses |
| 44 code-item | /master-setup/code-item | ✅ | ✅ | ✅ | ✅ | master.code_posts/statuses |
| 45 code-post | /master-setup/code-post | ✅ | ✅ | ✅ | ✅ | master code_billings/gls/statuses |
| 46 code-gls | /master-setup/code-gls | ✅ | ✅ | ✅ | ✅ | masterForm + statuses |
| 47 type-payment | /master-setup/type-payment | ✅ | ✅ | ✅ | ✅ | tableedit inline, no form |
| 1023 statistic-budget | /postcode-budget | ✅ | — | — | — | postCodeBudget type=static |
| 1024 budget | /postcode-budget/budget | ✅ | — | — | — | postCodeBudget type=budget |

### Bugfix Phase 3 (master-data.controller.ts)
- `masterForm()`: master TAMBAH `statuses` (didapat dari STATUS_OPTIONS 1/0). Tadinya cuma code_posts/code_billings/code_gls → dropdown Status di create/edit form code-post/code-billing/code-item/code-gls No Options (Laravel master = statuses + code_billings + code_gls). code_posts extra node (deviasi superset, dipakai code-item).
- Routes + handler semua exist (CRUD penuh + list parity dari node-menus sessio 4).

## Phase 4 — Master Setup 3: Guest & Company (parent 1121) — 12 rows ✅ (audit 2026-08-17)
| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 19-22 market-segment-1..4 | /master-setup/market-and-source/... | ✅ | ✅ | ✅ | ✅ | Type-group setup (parity Phase 2) |
| 23 source | /master-setup/market-and-source/source | ✅ | ✅ | ✅ | ✅ | Type-group setup |
| 24 company-follow-up | /master-setup/company-follow-up | ✅ | ✅ | ✅ | ✅ | Type-group setup |
| 25 company-activity | /master-setup/company-activity | ✅ | ✅ | ✅ | ✅ | Type-group setup |
| 26 company-type | /master-setup/company-type | ✅ | ✅ | ✅ | ✅ | Type-group setup |
| 28 guest-title | /master-setup/guest-title | ✅ | ✅ | ✅ | ✅ | Type-group setup |
| 1016 guest-status | /master-setup/guest-status | ✅ | ✅ | ✅ | ✅ | Type-group setup |
| 29 country | /master-setup/country-and-city/country | ✅ | ✅ | ✅ | ✅ | countryList/Show/Store/Update/Destroy |
| 30 city | /master-setup/country-and-city/city | ✅ | ✅ | ✅ | ✅ | cityList/Show/Store/Update/Destroy |

Semua Type-group menu pakai jalur `setup()?group=` (SystemController) — sudah diverifikasi Phase 2 node-menus (28 distinct groups: property filter, Group Report/Action cols, Building/Floor links). Country/city handler CRUD penuh di master-data.controller (929-970), route di master-setup.routes 36-60. Tanpa bug baru.

## Phase 5 — Master Setup 4: Configurators (1123/1125/1126/1127/1128/1131/1133) — ~25 rows ✅ (done 2026-08-17)

| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 94 pabx | /utility/pabx-interface | ⚫ | ⚫ | ⚫ | ⚫ | nav only, no Laravel route |
| 95 channel-manager-interface | /module/channel-manager-interface | ✅ | ✅ | ✅ | ✅ | generic CRUD `channel_manager_interfaces` (tabledrag) |
| 96 hospitality-tv | /utility/hospitality-tv-interface | ⚫ | ⚫ | ⚫ | ⚫ | nav only, no Laravel route |
| 1124 pos-matrix-sales | /master-setup/pos-matrix-sales | ✅ | ✅ | ✅ | ✅ | generic CRUD `pos_matrix_sales` (tableedit), perm 1124 |
| 167 work-type | /house-keeping/work-type | ✅ | ✅ | ✅ | ✅ | Type-group `setup()` (Phase 2 parity) |
| 169 unit-of-measurement | /house-keeping/unit-of-measurement | ✅ | ✅ | ✅ | ✅ | Type-group `setup()` |
| 170 location | /house-keeping/location | ✅ | ✅ | ✅ | ✅ | Type-group `setup()` |
| 173 stock | /house-keeping/stock | ✅ | ✅ | ✅ | ✅ | generic CRUD `stocks` (housekeeping routes) |
| 1103 template-floor-plan | /master-setup/template-floor-plan | ✅ | ✅ | ✅ | ✅ | Type-group `setup()` (Group Report/Action cols) |
| 1107 master-report | /master-setup/master-report | ✅ | ✅ | ✅ | ✅ | Type-group `setup()` (Group Report/Action cols) |
| 1108 action-report | /master-setup/action-report | ✅ | ✅ | ✅ | ✅ | Type-group `setup()` |
| 1110 group-report | /master-setup/group-report | ✅ | ✅ | ✅ | ✅ | Type-group `setup()` |
| 1109 report-permission | /reporting/report-permission | ✅ | ✅ | ✅ | ✅ | master-extra ReportPermissionController |
| 97 email-builder | /utility/email-builder | ✅ | ✅ | ✅ | ✅ | content.routes CRUD |
| 98 email-log | /utility/email-log | ⚫ | ⚫ | ⚫ | ⚫ | no Laravel contract |
| 1088 email-group | /utility/email-group | ✅ | ✅ | ✅ | ✅ | content.routes CRUD |
| 138 phone-book-group-1 | /concierge/phone-book-group/group-1 | ✅ | ✅ | ✅ | ✅ | concierge.routes CRUD |
| 139 phone-book-group-2 | /concierge/phone-book-group/group-2 | ✅ | ✅ | ✅ | ✅ | concierge.routes CRUD |
| 140 phone-book-group-3 | /concierge/phone-book-group/group-3 | ✅ | ✅ | ✅ | ✅ | concierge.routes CRUD |
| 1036 hotel-competitor-other | /hotel-competitor?unique=other-configurator | ✅ | ✅ | ✅ | ✅ | generic CRUD `master_hotel_competitor` |
| 1131 consigment | /consigment | ⚫ | ⚫ | ⚫ | ⚫ | no Laravel contract, no model |
| 1155 master-venue | /module/master-venue | ✅ | ✅ | ✅ | ✅ | EventController CRUD (tableedit) |
| 1156 master-layout | /module/master-layout | ✅ | ✅ | ✅ | ✅ | EventController CRUD (tableedit) |
| 1157 master-inventory | /module/master-inventory | ✅ | ✅ | ✅ | ✅ | EventController CRUD (tableedit) |
| 1158 master-capacity | /module/master-capacity | ✅ | ✅ | ✅ | ✅ | EventController CRUD (tableedit) |

### Fixes applied (Phase 5)
- `master-system.routes.ts:85-93` — +7 routes pos-matrix-sales generic CRUD (menu 1124, perms view/add/edit/delete).
- `event.routes.ts:121-127` — venue/layout/inventory CRUD routes added (mirroring capacity, perm 211).
- All other sub-menus already wired via existing routes/controllers (Type-group setup, generic, content, concierge, master-extra).

### Files touched
`backend-node/src/routes/master-system.routes.ts`, `backend-node/src/routes/event.routes.ts`

---

## Phase 6 — Sales & Marketing (parent 1130) — 10 + nests ✅ (audit 2026-08-17)

| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 109 rate code detail | /rate-management/rate | ✅ | ✅ | ✅ | ✅ | RateController.list/create/store/show/edit/update |
| 110 rate link listing | /rate-management/rate/rate-link-listing | ✅ | ✅ | ✅ | — | RateController.rateLinkListing/Store/Update |
| 112 rate grid | /rate-management/rate/rate | ✅ | ✅ | ✅ | ✅ | generic `rates` CRUD (tableedit) |
| 113 channel manager | /rate-management/rate/channel-manager | ⚫ | ⚫ | ⚫ | ⚫ | Under Construction (frontend) |
| 115 information | /rate-management/rate/information | ✅ | ✅ | ✅ | ✅ | part of rate CRUD (term_condition/cancellation_policy/notes) |
| 116 company applicable | /rate-management/rate/company-applicable | ✅ | ✅ | ✅ | ✅ | RateController.rateCompany/Store/Delete |
| 117 promotion | /rate-management/rate/promotion | ✅ | ✅ | ✅ | ✅ | PromotionController.ratePromotionList/Store/Delete |
| 176 security audit | /rate-management/rate/security-audit | ⚫ | ⚫ | ⚫ | ⚫ | frontend only (SecurityAudit component) |
| 1161 day-use-rate | /module/day-use-rate | ✅ | ✅ | ✅ | ✅ | master-extra DayUseRateController |
| 99 bar code detail | /rate-management/bar | ✅ | ✅ | ✅ | ✅ | BarController.list/create/store/show/edit/update |
| 100 bar rate link | /rate-management/bar/rate-link-listing | ✅ | ✅ | ✅ | — | shared with rate |
| 102 bar rate | /rate-management/bar/rate | ✅ | ✅ | ✅ | ✅ | RateController.barRateIndex/Create/Store/Update |
| 103 bar channel manager | /rate-management/bar/channel-manager | ⚫ | ⚫ | ⚫ | ⚫ | Under Construction (frontend) |
| 178 bar security audit | /rate-management/bar/security-audit | ⚫ | ⚫ | ⚫ | ⚫ | frontend only |
| 118 promo detail | /rate-management/promo-setup/detail | ✅ | ✅ | ✅ | ✅ | PromotionController CRUD (/promotion, /promotions) |
| 119 promo security audit | /rate-management/promo-setup/security-audit | ⚫ | ⚫ | ⚫ | ⚫ | frontend only |
| 89 holiday-event | /rate-management/holiday-and-event-setup | ✅ | ✅ | ✅ | ✅ | MasterDataController.holidayList/Store/Update/Destroy |
| 90 allotment | /rate-management/allotment | ✅ | ✅ | ✅ | ✅ | generic CRUD `allotment` + `room_allotments` child |
| 91 overbooking | /rate-management/overbooking | ✅ | ✅ | ✅ | ✅ | generic CRUD `overbooking` |
| 1035 hotel competitor | /hotel-competitor | ✅ | ✅ | ✅ | ✅ | generic CRUD `hotel_competitor` |
| 1037 list hotel | /hotel-competitor/list-hotel | ✅ | ✅ | ✅ | ✅ | generic CRUD `master_hotel_competitor` |
| 1102 yield management | /rate-management/yield-management | ✅ | ✅ | ✅ | ✅ | generic CRUD `yield` |

All routes verified in `rate.routes.ts`, `extra.routes.ts`, `master-setup.routes.ts`. Channel Manager + Security Audit pages are frontend-only (no backend contract). No new code needed.

---

## Phase 7 — Reservation & Day Use (parent 60/1162) — ~20 rows ✅ (audit 2026-08-17)

| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 55 room-availability | /room-statistic/room-availability | ✅ | — | — | — | RoomController.statistics (read-only) |
| 56 floor-plan | /room-statistic/floor-plan | ✅ | — | — | — | RoomController.statistics (read-only) |
| 61 search-rate | /reservation/search-rate | ✅ | — | — | — | reservation-fit AddView (form only) |
| 62 FIT (parent) | /reservation/fit | — | — | — | — | container, children below |
| 141-146 FIT children | /reservation/fit/reservation, /other-guest, /room, /transaction, /additional-item, /security-audit | ✅ | ✅ | ✅ | ✅ | via `/cms/reservation` (ReservationController) + sub-pages |
| 63 GIT (parent) | /reservation/git | — | — | — | — | container |
| 154-156 GIT children | /reservation/git/reservation, /transaction, /security-audit | ✅ | ✅ | ✅ | ✅ | via `/cms/reservation` isType="git" |
| 69 VR (parent) | /reservation/vr | — | — | — | — | container |
| 1031-1033 VR children | /reservation/vr/reservation, /transaction, /security-audit | ✅ | ✅ | ✅ | ✅ | via `/cms/reservation` isType="vr" |
| 1089 send-email | /utility/send-email | ✅ | ✅ | — | — | content.routes email-send |
| 1162 Day Use (parent) | /reservation/day-use | — | — | — | — | container |
| 1164-1169 Day Use children | /reservation/day-use/reservation, /other-guest, /room, /transaction, /additional-item, /security-audit | ✅ | ✅ | ✅ | ✅ | via `/cms/reservation` isType="day-use" |

All core reservation CRUD handled by `reservation.routes.ts` + `ReservationController` (menu 80). FIT/GIT/VR/Day-Use share same backend routes, differentiated by frontend `isType`. Room-availability/floor-plan are read-only statistic views. Search-rate + send-email are form-only pages. No new routes needed.

---

## Phase 8 — Front Desk (parent 65) — 12 + nests 20 ✅ (audit 2026-08-17)

| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 66 check-in | /front-desk/check-in | — | ✅ | — | — | POST checkIn handler (menu 63) |
| 67 check-out | /front-desk/check-out | — | ✅ | — | — | POST checkOut handler |
| 68 folio | /front-desk/folio | ✅ | — | — | — | GET transactionFolio (read-only view) |
| 69 virtual folio | /reservation/vr | ✅ | ✅ | ✅ | ✅ | covered by Phase 7 (VR) |
| 70 batch-check-out | /front-desk/batch-check-out | — | ✅ | — | — | POST batchCheckOut |
| 73 batch-posting | /front-desk/batch-posting | ✅ | ✅ | — | — | batchPostingList/Store (menu 63) |
| 1113 guest-request | /guest-request | ✅ | — | — | — | read-only list (extra.routes) |
| 1114 pos-transactions | /transaction/pos | ✅ | — | — | — | read-only list (PosController.listTransactions) |
| 1140 search-rate | /reservation/search-rate | ✅ | — | — | — | alias (Phase 7) |
| 1141 room-availability | /room-statistic/room-availability | ✅ | — | — | — | alias (Phase 7) |
| 1142 floor-plan | /room-statistic/floor-plan | ✅ | — | — | — | alias (Phase 7) |
| 1143 send-email | /utility/send-email | ✅ | ✅ | — | — | alias (Phase 7) |

### Fixes applied (Phase 8)
- `front-desk.routes.ts:23-25` — added `POST /front-desk/check-in`, `POST /front-desk/check-out`, `GET /front-desk/folio` (menu 63 perms).

All handlers existed in `FrontDeskController`; only routes were missing. Guest-request + pos-transactions are read-only. Batch-posting has list+store. Aliases 1140-1143 already covered in Phase 7.

### Files touched
`backend-node/src/routes/front-desk.routes.ts`

---

## Phase 9 — Profile (parent 81) — 4 + nests 22 ✅ (done 2026-08-17)

| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 82 Guest (parent) | /profile/guest/main | — | — | — | — | container |
| 120 main | /profile/guest/main | ✅ | ✅ | ✅ | ✅ | extra.routes `/profile/guest` CRUD |
| 121 reservation/folio | /profile/guest/reservation | ✅ | ✅ | ✅ | ✅ | user-guest `/profile/guest-folio` |
| 122 document | /profile/guest/document | ✅ | ✅ | ✅ | ✅ | user-guest `/profile/guest-document` CRUD |
| 123 security audit | /profile/guest/security-audit | ⚫ | ⚫ | ⚫ | ⚫ | frontend only (SecurityAudit) |
| 83 Company (parent) | /profile/company/main | — | — | — | — | container |
| 124 main | /profile/company/main | ✅ | ✅ | ✅ | ✅ | company.routes `/profile/company` CRUD |
| 125 others | /profile/company/others | ✅ | ✅ | ✅ | ✅ | part of company profile form (same URI) |
| 126 department | /profile/company/department | ✅ | ✅ | ✅ | ✅ | company.routes `/profile/company-department` CRUD |
| 127 contact-person | /profile/company/contact-person | ✅ | ✅ | ✅ | ✅ | company.routes `/profile/company-contact` CRUD |
| 128 guest | /profile/company/guest | ✅ | ✅ | ✅ | — | company.routes `/profile/company-guest` (no delete) |
| 129 activity | /profile/company/activity | ✅ | ✅ | ✅ | ✅ | company.routes `/profile/company-activity` CRUD |
| 130 contract-rate | /profile/company/contract-rate | ✅ | ✅ | ✅ | ✅ | rate.routes `/profile/company-contract-rate` CRUD |
| 131 reservation/folio | /profile/company/reservation | ✅ | — | — | — | company.routes `/profile/company-folio` (list only) |
| 132 ar-transaction | /profile/company/ar-transaction | ✅ | ✅ | — | ✅ | company.routes `/profile/company-ar-transaction` |
| 133 document | /profile/company/document | ✅ | ✅ | ✅ | ✅ | company.routes `/profile/company-document` CRUD |
| 135 statistic | /profile/company/statistic | ✅ | — | — | — | company.routes `/profile/company-statistic` (list) |
| 136 billing-setup | /profile/company/billing-setup | ✅ | ✅ | — | ✅ | company.routes `/company-profile-billing-setup` |
| 137 security audit | /profile/company/security-audit | ⚫ | ⚫ | ⚫ | ⚫ | frontend only (SecurityAudit) |
| 84 merge-guest | /profile/merge | ✅ | ✅ | ✅ | — | `/cms/profile/guest` + PUT `/merge` + POST `/update-batch` |
| 1171 guest-listing-report | /guest/guest-listing-report | ✅ | — | — | — | report.routes PDF export |

### Fixes applied (Phase 9)
- `user-guest.routes.ts:130-133` — added `PUT /profile/guest/:id/merge` and `POST /profile/guest/update-batch` (menu 84).
- `guest.controller.ts:1019-1052` — added `mergeUpdate()` (Laravel parity) and `batchUpdate()` (frontend custom) handlers.

Security audit pages (123, 137) remain frontend-only. Company "others" (125) is a form tab using main company URI.

### Files touched
`backend-node/src/routes/user-guest.routes.ts`, `backend-node/src/controllers/guest.controller.ts`

---

---

## Phase 10 — House Keeping + Engineering + Night Audit (157/1136/171) — ~15 rows ✅ (audit 2026-08-17)

| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 158 shift | /house-keeping/shift | ✅ | ✅ | ✅ | ✅ | generic CRUD `shift` (housekeeping.routes) |
| 164 roster (parent) | /house-keeping/roster | — | — | — | — | container |
| 165 roster view | /house-keeping/roster | ✅ | ✅ | ✅ | ✅ | generic CRUD `roster_list` + `shift_roster` |
| 166 roster security audit | /house-keeping/roster/security_audit | ⚫ | ⚫ | ⚫ | ⚫ | frontend only |
| 160 work-orders (parent) | /house-keeping/work-orders | — | — | — | — | container |
| 161 work-orders view | /house-keeping/work-orders | ✅ | ✅ | ✅ | ✅ | HousekeepingController.workOrderList/Store/Update/Destroy |
| 162 work-orders stock | /house-keeping/work-orders/stock | ✅ | ✅ | ✅ | ✅ | generic CRUD `work_order_stocks` |
| 163 work-orders security audit | /house-keeping/work-orders/security_audit | ⚫ | ⚫ | ⚫ | ⚫ | frontend only |
| 172 room-status | /house-keeping/room-status | ✅ | ✅ | ✅ | ✅ | HousekeepingController.roomStatus + RoomController CRUD |
| 1181 service-scheduler | /house-keeping/service-scheduler | ✅ | — | — | — | ServiceSchedulerController index/housekeepers/shifts (read-only) |
| 1137 work-order (worker) | /house-keeping/work-orders?unique=worker | ✅ | ✅ | ✅ | ✅ | same as 161, different visibility |
| 1027 night-audit | /night-audit | ✅ | ✅ | — | — | SystemController nightAuditAudit/Check/Post/Shift/RoomChange/NoShow/OverStay |

All routes verified in `housekeeping.routes.ts` and `master-system.routes.ts`. Security audit pages (163, 166) are frontend-only. Service-scheduler is read-only (list only). Night audit routes match Laravel `NightAuditController`.

### Files touched
None — all routes already present and verified.

---

## Phase 11 — Concierge + Statistic (74/53) — ~13 rows ✅ (audit 2026-08-17)

| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 76 phone-book | /concierge/phone-book | ✅ | ✅ | ✅ | ✅ | ConciergeController CRUD (menu 76) |
| 77 baggage | /concierge/baggage | ✅ | ✅ | ✅ | ✅ | ConciergeController CRUD (menu 77) |
| 78 carpark | /concierge/carpark | ✅ | ✅ | ✅ | ✅ | ConciergeController CRUD (menu 78) |
| 79 lost-and-found | /concierge/lost-and-found | ✅ | ✅ | ✅ | ✅ | ConciergeController CRUD (menu 79) |
| 75 phone-book-group-setup | (1128 configurator) | ✅ | ✅ | ✅ | ✅ | covered in Phase 5 |
| 59 occupancy | /room-statistic/occupancy | ✅ | — | — | — | `/statistic/occupancy` (read-only list, extra.routes) |
| 1100 room-types | /room-statistic/room-types | ✅ | — | — | — | `/statistic/statistic-room-type-grouping` (read-only) |
| 1101 room-type-groupings | /room-statistic/room-type-groupings | ✅ | — | — | — | same as 1100 |
| 1182 booking-engine-analytics | /room-statistic/booking-engine-analytics | ⚫ | ⚫ | ⚫ | ⚫ | no Laravel contract (only helper route) |

All concierge routes in `concierge.routes.ts` (menus 76,77,78,79). Statistic occupancy read-only in `extra.routes.ts`. Room-types/groupings in `statistic.routes.ts`. Booking-engine-analytics (1182) has no backend contract — frontend only.

---

## Phase 12 — Accounting + Reporting (1038/1046) — ~16 rows ✅ (audit 2026-08-17)

| Menu | URL | List | Add | Edit | Delete | Note |
|---|---|---|---|---|---|---|
| 1039 invoice | /accounting/invoice | ✅ | ✅ | ✅ | ✅ | AccountingController list/create/store/show/updateStatus |
| 1040 credit-note | /accounting/credit-note | ✅ | ✅ | ✅ | ✅ | same generic accounting route |
| 1041 debit-note | /accounting/debit-note | ✅ | ✅ | ✅ | ✅ | same |
| 1042 adjustment | /accounting/adjustment | ✅ | ✅ | ✅ | ✅ | same |
| 1043 payment | /accounting/payment | ✅ | ✅ | ✅ | ✅ | same |
| 1044 refund | /accounting/refund | ✅ | ✅ | ✅ | ✅ | same |
| 1045 allocation | /accounting/allocation | ✅ | ✅ | — | — | allocationList/Store/GetDoc (no delete) |
| 1028 system-balance | /system-balance | ✅ | — | — | — | SystemController.systemBalance (read-only) |
| 1047 batch | /reporting/batch | ✅ | ✅ | — | — | ReportController batchList/batchSave |
| 1048 account | /reporting/account | ✅ | — | — | — | wildcard handleReport (PDF) |
| 1049 before-night-audit | /reporting/before-night-audit | ✅ | — | — | — | wildcard handleReport (PDF) |
| 1050 after-night-audit | /reporting/after-night-audit | ✅ | — | — | — | wildcard handleReport (PDF) |
| 1096 front-office | /reporting/front-office | ✅ | — | — | — | wildcard handleReport (PDF) |
| 1097 housekeeping | /reporting/housekeeping | ✅ | — | — | — | wildcard handleReport (PDF) |
| 1098 sales-marketing | /reporting/sales-marketing | ✅ | — | — | — | wildcard handleReport (PDF) |
| 1109 report-permission | /reporting/report-permission | ✅ | ✅ | ✅ | ✅ | master-extra ReportPermissionController (Phase 6) |

All accounting routes in `master-system.routes.ts` (generic `/accounting/:type`). Allocation separate. System-balance read-only. Reporting wildcard `/cms/report/{*path}` in `report.routes.ts` covers all batch/account/frontoffice reports via `handleReport` (PDF export). Report-permission done in Phase 6.

---

## Execution rules
1. Per phase: read `backend-node/src/controllers/* + routes/*` vs `backend/app/Http/Controllers/**` (Laravel). Verify Handler exists + shape (formatData/table/master) parity.
2. Fill cell with ✅/🟡/❌/⏳/⚫.
3. Psyched false-negative guard: non-CRUD pages (tabledrag static, report view, nav-only) → ⚫, skip.
4. After edits: `backend-node/src` tsc bersih + jest 73/73. USER restart + probe.
5. Update this file + `node-menus.md`. Commit per phase.

## Build order (propose)
Phase 1 first (auth/admin core), then 2/3/4/5 (master setup), 11 (statistic/concierge), 12 (reporting) — smallest/leaf-heavy first, heaviest (7/8/9) last.

Core anchor sudah known-OK (Phase 1-2 dari node-menus.md, cru D audit zero-5xx). Focus = cells kosong di atas.