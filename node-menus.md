<Copied from workspace root node-menus.md>
# node-menus.md — CRUD Parity Tracker (backend-node vs Laravel)

Track CRUD parity fix per parent menu. Each phase = 1 parent menu (Room Setting, Reservation Setup, etc).
Fix = node backend replicating Laravel controller behavior. After source edits, USER must rebuild (`npm run build`) + restart backend, then live-test.

Legend: ✅ done · 🟡 partial · ❌ broken · ⏳ not started

---

## Phase 1 — Room Setting (menu 1120) — `TypeController` parity ✅

| Sub-menu | Group / Page | List | Add | Edit | Delete | Notes |
|---|---|---|---|---|---|---|
| 34 Room Type Grouping | types `room-type-grouping` | ✅ | ✅ | ✅ | ✅ | sort column parity |
| 71 Room Configurator | types `room-configuration` (TableViewDocument config=true) | ✅ | ✅ | ✅ | ✅ | file upload `update-file` + multer |
| 36 In Room Equipment | types `in-room-equipment` | ✅ | ✅ | ✅ | ✅ | |
| 168 Master Area | types `area` | ✅ | ✅ | ✅ | ✅ | Building+Floor select + `model_has_types` sync |
| 174 Floor | types `floor` | ✅ | ✅ | ✅ | ✅ | |
| 175 Building | types `building` | ✅ | ✅ | ✅ | ✅ | |
| 48 Room Type | `RoomController.type*` (separate) | ⏳ | ⏳ | ⏳ | ⏳ | next sub-phase |
| 50 Room Setup | `RoomController` `/room` | ✅ | ✅ | ✅ | ✅ | edit/create master+formatData parity fixed |
| 177 Audit Log (child 50) | `SystemController.logList` | ✅ | — | — | — | |

### Fixes applied (Phase 1)
- `utils/tableMeta.ts` — `STATUS_OPTIONS` Inactive `value:2` → `0` (Laravel `config('cms.status')` = active 1 / inactive 0). Affects all setup tables + master-data.
- `controllers/system.controller.ts` — `setupCreate` statuses `{value:2}` → `{value:0}`.
- `controllers/system.controller.ts` — `setup()`: area/template-floor-plan rows + Building/Floor select options (Laravel parity — all properties).
- `controllers/system.controller.ts` — `setupGetType` → `{value,label}` (Laravel getType parity).
- `controllers/system.controller.ts` — `setupStore`/`setupUpdate`: multipart string normalize + Building/Floor sync via `model_has_types` (Type↔Type, `HasTypes::syncTypes` parity).
- `controllers/system.controller.ts` — NEW `setupUpdateWithFile` (`TypeController::updateWithFile` parity): multipart `file` → `storage/types/`, delete old image.
- `routes/master-system.routes.ts` — `POST /setup` multer `none()` (FormData add), NEW `POST /setup/:id/update-file` (Laravel route parity, `upload.single('file')`), setup perms 69→1125 (Laravel uses menu 1125 ENGINEERING SETUP).
- `index.ts` — static `/storage` → `backend-node/storage/` (Laravel public disk parity; frontend `file_document` opens `${uriApi}/storage/...`).
- `package.json` — added `multer` + `@types/multer`.
- `controllers/room.controller.ts` — `create()`/`edit()`: `master` → top-level meta (frontend `dataoption?.master?.*`); `edit()` returns Laravel `Room::formatData()` shape (`room_type_id`/`room_id`/`building`/`floor` `{value,label}`, `room_configuration` list, `status` object) — fixes empty form fields + frontend crash `room_configuration.forEach`.
- `controllers/room.controller.ts` — `store()`/`update()`: sync Building+Floor Type relations via `model_has_types` (previously dropped).

### Files touched
`backend-node/src/utils/tableMeta.ts`, `backend-node/src/controllers/system.controller.ts`, `backend-node/src/routes/master-system.routes.ts`, `backend-node/src/index.ts`, `package.json`

---

## Phase 2 — Reservation Setup (menu 1122) — `TypeController` parity ✅ (verified 2026-08-16)

| Sub-menu | Group | Status |
|---|---|---|
| 1087 Cancellation reservation | types `cancellation-reservation` | ✅ |
| 1020 Remark Additional Item | types `remark-additional-item` | ✅ |
| 1021 Remark Room | types `remark-room` | ✅ |

VERIFY NOTES:
- DB `types.group` values: `cancellation-reservation` (25 rows), `remark-additional-item` (8), `remark-room` (20) — Laravel `TypeController` uses RAW `where('group', $group)` → node raw group query MATCHES (config `cancelation` code = legacy 16 rows, unused).
- Frontend: menus visibility `master-setup`, url `/master-setup/<group>` → `master-setup/index.tsx` module=master-setup → `SetupPage groups={lastPath}` → `/cms/setup?group=<group>` ✓.
- Same path covers: `work-type` (167 work-order-type, url `/house-keeping/work-type` → `house-keeping/index.tsx` module=master-setup), `unit-of-measurement` (169), `location` (170), `company-follow-up` (24), `company-activity` (25), all `market-segment-*`, `source`, `in-room-equipment`, `guest-status` — all types groups in DB (28 distinct groups).
- Node `setup()` parity confirmed: property filter, normal-name rows first, guest-title name asc, room-type-grouping sort asc, area/template-floor-plan Building/Floor links, master-report Group Report/Action cols.

### Fixes applied (Phase 2)
- `utils/tableMeta.ts` — `setupTable()`: NEW master-report extra cols `Group Report` (select) + `Action` (select_multiple) — Laravel `TypeController@index` table merge parity (menu 1107).
- `controllers/system.controller.ts` — `setup()`: NEW master-report handling — `group_report`/`action_report` row values from `model_has_types` links (Laravel `Type::formatData` parity) + col options = ALL group-report/action-report types (no property filter, Laravel parity).
- `controllers/system.controller.ts` — `setup()`: area/template-floor-plan Building/Floor options NO LONGER property-scoped (was deliberate deviation; now Laravel parity — Laravel queries all properties).
- `setupUpdate`/`setupStore` Building/Floor sync via `model_has_types` (Phase 1) — applies to all groups incl. Phase 2.

---

## Recent updates (2026-08-16)

- Generated `frontend-node/migration_menu_list.csv` and `frontend_vs_backend_routes.csv` to enumerate frontend routes and map them to backend routes.
- Produced detailed CRUD parity reports: `frontend_crud_parity.csv` and `frontend_crud_detailed.csv`.
- Created `backend-node/migration_reports/frontend_crud_detailed_marked.csv` to help triage false-negatives before opening issues.
- Fixed report helper functions and added Excel export support in `backend-node/src/controllers/report.controller.ts` and patched frontend permission truthiness.
- Committed and pushed changes to `migration-progress` branches in `backend-node` and `frontend-node`; created backend GitHub issue `ianocent/nodeHMS#9` and closed frontend issue #2.

Next: manual review of marked parity rows and targeted implementation or issue closure.
