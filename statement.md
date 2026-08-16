<Copied from workspace root statement.md>
# Project Statement: HMS Anyaman Node.js Migration

## Overview
This document outlines the migration of the HMS Anyaman project from a PHP Laravel & MySQL backend to a Node.js Express & PostgreSQL backend. 

## Repositories
- **Original Backend (Laravel):** `C:\Users\uzuma\Documents\hms-anyaman\backend` Reference
- **Original Frontend (React):** `C:\Users\uzuma\Documents\hms-anyaman\frontend` Reference
- **New Backend (Node.js/Express):** `C:\Users\uzuma\Documents\hms-anyaman\backend-node`
- **New Frontend (React for Node.js):** `C:\Users\uzuma\Documents\hms-anyaman\frontend-node`

Each *-node folder contains its own `README.md` with links to their respective Git repositories for issue tracking, pull requests, and collaboration.

## Security & Version Control
**DO NOT COMMIT SENSITIVE DATA.** The following files must be kept out of version control and are explicitly excluded via `.gitignore`:
- `.env` files (Database credentials, API keys, JWT secrets, etc.)
- `next.config.js` (if it contains sensitive runtime/build-time environments)
- `node_modules` and any build artifacts (`dist`, `build`, etc.)

## Milestones
1. **Debug & Stabilize ✅ (2026-08-14):** 500/404 errors in CRUD resolved; cross-sector route + master-meta audit complete (commits df65184, bd00320). Remaining live verification pending user restart of `watchlogs.js`.
2. **Data Layer Completion ✅:** 80+ Eloquent models migrated to Prisma schema (186 tables in PostgreSQL).
3. **Authentication & Permissions ✅:** Sanctum-style token auth + RBAC menuId permission implemented (login/logout/change-password/forget-password/refresh).
4. **Core Business Logic & Jobs 🔄:** STAAH OTA integration ported (content sync, reservation pull, webhook, sync logs); ARI push verification + background jobs (queue) still pending.
5. **Frontend Integration 🔄:** `frontend-node` running against backend-node; per-module browser verification in progress.

## Recent updates (2026-08-16)

- Generated migration audit artifacts: `frontend-node/migration_menu_list.csv`, `frontend_vs_backend_routes.csv`, `frontend_crud_parity.csv`, and `frontend_crud_detailed.csv`.
- Placed `backend-node/migration_reports/frontend_crud_detailed_marked.csv` to help triage false-negatives before opening issues.
- Implemented report helper fixes and Excel export support in `backend-node/src/controllers/report.controller.ts` and adjusted frontend permission checks to accept truthy values (1, "true").
- Committed and pushed changes to `migration-progress` branches in `backend-node` and `frontend-node`; created GitHub issue `ianocent/nodeHMS#9` and closed frontend issue #2.

Recommendation: run manual review on `backend-node/migration_reports/frontend_crud_detailed_marked.csv` and convert confirmed missing endpoints into focused tasks.
