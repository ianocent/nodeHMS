# Changelog — backend-node

All notable changes to this project are documented in this file.
Format based on [Conventional Commits](https://www.conventionalcommits.org/).

---

## 2026-08-23

### Docs
- `b45e947` 20:24 — fix Node.js logo URL in README
- `0cf312a` 20:22 — add Node.js introduction template to README

### Added
- `1f8f6be` 20:11 — **close parity gaps from migration audit**
  - multipart upload with Laravel `mimes:` validation (guest + company documents)
  - email dispatch on check-in/check-out via `email_builders` templates
  - company-AR stop-credit guard now enforced (Laravel dead-code made functional)
  - STAAH webhook rate limiter (10k/hour) + card/CVV redaction in third-party logs
  - property-scope sweep on HasProperties-scoped option lookups
  - AvailableRoom guard for GIT child un-check-out
  - saveReservation deep-diff fixes: persist `is_24_hour`/package/quantity/eta/etd,
    extra-bed pricing via RateExtraBedInclusive, posted nights protected on update,
    rebuilt nights repriced, due_out/occupied room fixup

### Fixed
- `1e79310` 17:32 — `/cms/staff` staff dropdown empty on reports
- `50a5cf5` 16:47 — property scoping on availability lookup + statistic masters; add scope scanner
- `eb6b40c` 15:43 — housekeeping room-status assign flow + reservation fixes
- `f4c3166` 12:13 — statistic room type
- `5a64262` 02:38 — rate company-applicable pivot to model_has_company_profiles

### Performance
- `ed8b937` 16:34 — security audit log property scoping moved to SQL

### Changed
- `39871b2` 14:18 — storage uploads, queued batch reports, statistic improvements
- `fbf3ad6` 13:38 — night-audit parity + folio/reservation write endpoints
- `7ff51f1` 11:17 — updateVR + moveReservation item-level ops
- `656166b` 11:13 — void reversal, cancel-flow restrict, GIT auto-checkout
- `5c483eb` 11:06 — guest sub-CRUD writes, dashboard widget, folio improvements
- `1cbe0e2` 10:35 — close remaining audit gaps
- `b5808a5` 03:03 — port remaining rate endpoints, WO images, report handlers
- `547e3d1` 02:30 — night-audit response contract, roster validation
- `802cdac` 02:16 — shift confirmation balancing parity
- `b50104f` 02:00 — port event reports, remove naive status-flip responses
- `769df91` 01:40 — port 9 folio documents as real PDFs
- `b61aa0d` 01:10 — port Laravel parity fixes across modules

## 2026-08-22

### Fixed
- `70fd736` 15:03 — hash auth Laravel to Node.js and added converter
- `d29dbb7` 12:55 — folio reservation etc
- `f540e25` 12:05 — reservation
- `a53018e` 00:10 — deleted unnecessary files after debugging

### Other
- `1352df4` / `8da6624` 00:14 — misc + new readme

## 2026-08-21

### Added
- `c3ab459` 15:13 — night audit cron job with pg-boss (runs daily)
- `d73a808` 14:14 — reservation list parity with front-desk folio list

### Fixed
- `cbdd28c` 16:45 — codeItemList filter by folio's rate via model_has_code_items
- `8d4f254` 16:07 — shift confirmation with balance matching (Laravel parity)
- `8f6ceef` 16:01 — additional-item page: filter code items/inclusives by rate
- `32ef5e6` 13:55 — cleanup: remove debug logs from getBusinessDate
- `60f52a2` 13:53 — night-audit/audit endpoint returns business date
- `6bb550f` 13:21 — add `deleted_at: null` filter to all log_audits queries
- `29d001f` 13:07 — front-desk list/show use rooms.name instead of room_name
- `7348422` 12:49 — work order real-time room_status=4 sync on create
- `acb2773` 11:34 — rate company_profiles relation + folio status sync

### Other
- `c54fd9c` 13:39 — debug: add logging to getBusinessDate

## 2026-08-20

### Changed
- `1bb4405` 20:04 — refactor: split report.controller.ts into report/{handlers,excel,...}

### Fixed
- `bc192f4` 12:00 — handle confirm_change_room/cancel_change_room in updateStatus
- `10277ea` 11:36 — front-desk BigInt serialize; rate status coercion
- `8242249` 11:01 — stop guest_status leaking into Prisma create
- `f3fd065` 10:32 — coerce Laravel-style status/pin_enshift payloads

## 2026-08-19

### Fixed
- `a42d85e` 19:38 — cleaning_time column type 'date' for table form
- `417085f` 19:04 — rateListHelper requires propertyId, MENU_ID 80→60
- `dd4cffa` 18:58 — updateStatus handles un_check_in/un_check_out actions
- `d646bdf` 18:35 — menuId 80→60 for reservation/folio routes
- `ec514fc` 17:02 — assign-room response format for frontend TableView
