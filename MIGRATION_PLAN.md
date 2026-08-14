# HMS Anyaman Backend Migration Plan
## Laravel/MySQL → Node.js/PostgreSQL

**Goal**: Complete backend rewrite with 100% API compatibility. Frontend Next.js must work unchanged.

**Status**: Phase 6 — Cross-sector Parity Fixes & Testing 🔄 IN PROGRESS (live verification pending)
**Started**: 2026-07-13
**Last Updated**: 2026-08-14

---

## Current State

| Aspect | Value |
|--------|-------|
| Frontend | Next.js at `http://localhost:3002` (unchanged) |
| Frontend (migration) | `frontend-node/` — adapted for backend-node API |
| Backend | `backend-node/` — Node.js/Express/Prisma ✅ |
| Database | PostgreSQL `hms_anyaman` — 186 tables, all data migrated ✅ |
| API Base | `http://localhost:3001` |
| Login | Working (Sanctum-style tokens) ✅ |
| Sidebar menus | Working (menu tree loads) ✅ |
| Choose property | Working (property list + auth) ✅ |

---

## Tech Stack

- **Framework**: Express.js 5
- **ORM**: Prisma 7 + `@prisma/adapter-pg`
- **Database**: PostgreSQL 18 (Laragon), migrated from MySQL `draft_rndhms`
- **Language**: TypeScript (via ts-node)
- **Port**: 3001
- **Auth**: Sanctum-style tokens (SHA-256 hashed, stored in `personal_access_tokens`)
- **Encryption**: AES-256-CBC (text/plain handshake with Next.js frontend)

---

## Phased Roadmap

### Phase 1: Infra Setup & Database Migration ✅
- .env fixed (Laragon PostgreSQL)
- Prisma schema generated from MySQL (`prisma db pull`)
- PostgreSQL `hms_anyaman` created with all 186 tables
- 574MB data migrated from MySQL → PostgreSQL
- Data integrity verified (row counts match)

### Phase 2: Core Architecture & Permissions ✅
- Express.js setup with global middleware (CORS, logger, error handler)
- Permission system (role_menu_crud + model_has_menus)
- Sanctum-compatible token auth (SHA-256 hashing)
- AES-256-CBC request/response encryption middleware
- 404 catch-all returns encrypted JSON (not HTML)

### Phase 3: Authentication & Session ✅
- Login/lock — working with Sanctum tokens
- Logout — revokes all user tokens
- Token validation middleware (check both `x-token` and `Authorization: Bearer`)
- Auto-revoke on re-login (no more "User already logged in")
- Password change, forgot password endpoints

### Phase 4: API Endpoints (Modular) ✅
All 19 controllers implemented with CRUD operations:

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

### Phase 5: Bug Fixing & Frontend Integration ⏳ CURRENT

Frontend calls `/cms/...` routes but backend only mounted routes at `/api/...` during Phase 4. Phase 5 bridges this gap:

#### 5.1 Route Mount Alignment ✅
- [x] Dual-mount all route groups at both `/api` and `/cms`
- [x] Auth middleware accepts both `x-token` and `Authorization: Bearer`
- [x] Property list + auth endpoints for choose-property flow
- [x] Sidebar menu endpoint (`GET /cms/menu`) returns flat list with `relation.children`
- [x] Role, UALL, RALL endpoints
- [x] Property auth includes `access_token` (prevents logout after choose)

#### 5.2 Generic CRUD Engine ✅
Build reusable CRUD generator from Prisma models. Eliminates 80% of manual route work:
- Auto-generate list (paginated, searchable, trash filter)
- Auto-generate create (POST with body validation)
- Auto-generate show (GET by id)
- Auto-generate update (PUT/PATCH by id)
- Auto-generate destroy (soft delete + restore)
- Single `generic.controller.ts` + `generic.routes.ts`
- Mounted at `/api/generic/:model` + `/cms/generic/:model`

#### 5.3 Remaining Sidebar Routes ✅
| Route | Frontend component | Backend status |
|-------|-------------------|----------------|
| `GET /cms/user` | User list page | ✅ Implemented |
| `GET /cms/night-audit/audit` | Night audit | ✅ Implemented |
| `GET /cms/night-audit/shift` | Night audit shift list | ✅ Implemented |
| `POST /cms/night-audit/check-audit` | Night audit check/save | ✅ Implemented |
| `GET /cms/helper/task-notification` | Dashboard widget | ✅ Implemented |
| `GET /cms/helper/total-cancel-booking-engine` | Helper | ✅ Implemented |
| `POST /cms/helper/release-last-user-folio` | Helper | ✅ Implemented |
| `GET /cms/get-dashboard` | Dashboard data | ✅ Implemented |

#### 5.4 Module-by-Module Bug Fixing ✅
Added singular route aliases across all route files so frontend pages calling `/cms/singular` endpoints stop getting 404s.
Fix: Edit each route file to duplicate plural routes with singular path names.

Modules covered:
1. ✅ Dashboard widgets & stats
2. ✅ User Management
3. ✅ Role & Permission pages
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

## Known Issues

| Issue | Status | Fix |
|-------|--------|-----|
| `login.blade.php` → `login.tsx` `mapPermissions` import missing | ✅ Fixed | Created `permissionHelper.ts` + imported |
| `FetchData()` in `helper/index.tsx` missing | ✅ Fixed | Created with all utility functions |
| `passAes` env var not found in frontend | ✅ Fixed | Uses `env.passAes` from `next.config.js` |
| PrismaClient created before `dotenv.config()` | ✅ Fixed | `import 'dotenv/config'` loads first |
| `@prisma/adapter-pg` TableDoesNotExist (wrong DATABASE_URL) | ✅ Fixed | dotenv loads before PrismaClient init |
| `$2y$` bcrypt hashes from Laravel cause "Invalid input" | ✅ Fixed | System user password reset |
| "User already logged in" blocks re-login | ✅ Fixed | Auto-revoke old tokens on login |
| Auth middleware only checks `x-token`, not `Authorization` header | ✅ Fixed | Fallback to `Authorization: Bearer` |
| Property auth overwrites login data → loses access_token | ✅ Fixed | Property response includes token |
| `menuGetParentByIdChildren` 500 on `:id = "null"` | ✅ Fixed | Null check before BigInt() |
| Response `code` is string `"200"` but frontend checks `=== 200` (number) in some places | 🔲 Minor | Frontend uses loose comparison in most places |
| Toast errors for unimplemented routes | ✅ Fixed | All sidebar + module routes implemented. Remaining: night-audit/shift + check-audit done |

---

## File Structure

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

frontend-node/                           ← Copy of frontend/, modified for Node API
├── pages/                 (Next.js pages)
│   ├── front-desk/
│   │   ├── check-in/      (Check-in listing)
│   │   ├── check-out/     (Check-out listing)
│   │   ├── check-out-view/ ← NEW: Individual check-out detail with bill review
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

## Database Connection (Laragon)

```bash
# Test connection
psql -U postgres -h localhost -d hms_anyaman

# Info
# Host: localhost
# Port: 5432
# Database: hms_anyaman
# User: postgres
# Password: (empty or blank)
```

---

## API Contract Guarantee

Every endpoint response MUST match Laravel format exactly:

```json
{
  "success": true,
  "data": { ... },
  "message": "...",
  "meta": { ... }
}
```

Error responses must also match.

---

## Validation Checkpoints

| Phase | Checkpoint |
|-------|-----------|
| After 1.1 | Prisma schema validates without error |
| After 1.2 | PostgreSQL tables created |
| After 1.3 | Data row counts match MySQL |
| After 1.4 | No FK constraint errors |
| After 2 | Permission middleware works |
| After 3 | Login returns JWT token |
| After 4 | All endpoints return correct schema |
| After 5 | Frontend works without changes |

---

## Notes

- **No Docker**: Using Laragon PostgreSQL local
- **Staging**: Cannot test with real OTA until Phase 4.4
- **Parallel work**: Phases can overlap after Phase 2
- **Revert Plan**: Keep MySQL db backup in case needed

---

**Last Updated**: 2026-07-15  
**Next Review**: Frontend integration testing — confirm all modules load without toast errors

## Endpoint Summary

| Module | Controller | Routes | Status |
|--------|-----------|--------|--------|
| Auth | `auth.controller.ts` | 3 | ✅ |
| User | `user.controller.ts` | 11 | ✅ |
| Guest | `guest.controller.ts` | 19 (inc. sub-features) | ✅ |
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

**Status**: IN PROGRESS — audit + fix rounds complete, live verification pending (user restarts watchlogs.js)

### Completed (committed + pushed: df65184, bd00320)
- Route audit all form pages (frontend GLOBALURI vs node routes) — missing routes implemented:
  - `GET /housekeeping/room-status/master` (housekeeping room-status page crash)
  - `GET /transaction/create`, `GET /transaction/folio` (before `/transaction/:id`), `PUT /front-desk/data/:id`
  - `GET /code-post/get-charge`, `GET /code-post/get-code-items` (master-setup + master-system, before `/code-post/:id`)
  - `PUT /reservation/ledger/move/:id`
  - `POST/PUT/DELETE /event-management-item` (+ event_id filter + formatTable parity)
- Master meta parity (forms crashing/empty via CheckBoxBase options.map):
  - generic createForm/editForm per-model master (statuses; overbooking room_types+business_date; allotment company_guest)
  - lost-found form (statuses/itemsStatus/reservations/rooms/statusLost), company profile (17-key Laravel master), property form (is_taxs/market_segments/subscribe_types/regions/...)
  - email-builder templateTypes, email-group users + group_list emails, company-others code_posts
- New shared `src/utils/cmsConfig.ts` (config lists, moneyFormat, CodePost::calculate parity)
- Laravel upstream bugs kept as-is (holiday form /cms/rate, overbooking form /cms/allotment)

### Testing
- `npx tsc --noEmit` clean, jest 69/69 green, server boot clean
- Pending: live browser verification per module (user restarts watchlogs.js)

### Remaining (issue #3, #4, #5 open)
- STAAH: full ARI push flow verification, background jobs (queue) not yet ported
- Full 1:1 route:list diff Laravel vs node (partial audits done per module)
- Cutover: contract diff test, performance sanity, parallel run, rollback plan, decommission
