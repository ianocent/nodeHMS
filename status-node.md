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