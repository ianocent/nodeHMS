<Copied from workspace root MIGRATION_STATUS.md>
# HMS Anyaman: Backend Migration Overview
## Phase 1 Status & Roadmap

**Project**: HMS Anyaman  
**Objective**: Migrate Backend from Laravel/MySQL → Node.js/PostgreSQL  
**Frontend**: Next.js (no changes needed)  
**Status**: Phase 1 ✅ COMPLETE — all 5 phases complete, Phase 6 parity & testing in progress (2026-08-14)  
**Date**: 2026-07-13

---

## 🔄 Current Status (2026-08-14)

| Phase | Status |
|-------|--------|
| 1 Database Migration | ✅ Complete (186 tables, 574MB, row counts verified) |
| 2 Core Architecture | ✅ Complete (response parity, middleware, env config) |
| 3 Authentication | ✅ Complete (login/logout/change-password/forget-password/refresh) |
| 4 API Endpoints | 🔄 Cross-sector audits done; full 1:1 route:list diff pending |
| 5 Testing & Integration | 🔄 jest 69/69 green; live per-module verification pending |
| 6 Parity Fixes | 🔄 Route + master meta audit done (df65184, bd00320); STAAH jobs pending |

### Live docs
- `backend-node/status-node.md` — session-by-session changelog
- `backend-node/MIGRATION_FIX.md` — bug/fix log
- `backend-node/MIGRATION_PLAN.md` — phased roadmap + Phase 6 detail
- GitHub issues `ianocent/nodeHMS` #1-#5 — milestone trackers (M2, M3 closed)

## Recent updates (2026-08-16)

- Generated route and CRUD parity artifacts: `frontend-node/migration_menu_list.csv`, `frontend_vs_backend_routes.csv`, `frontend_crud_parity.csv`, `frontend_crud_detailed.csv`.
- Added `backend-node/migration_reports/frontend_crud_detailed_marked.csv` to flag possible false-negatives for manual review.
- Fixed TypeScript errors and added Excel export support in `backend-node/src/controllers/report.controller.ts` (BigInt handling, `generateExcel()` with formulas).
- Patched frontend permission truthiness in `frontend-node/redux/auth/permissionHelper.ts` and updated `frontend-node/next.config.js` to use `NEXT_PUBLIC_API_URL`.
- Committed changes to `migration-progress` branches in `backend-node` and `frontend-node` and created backend GitHub issue summarizing remaining tasks (ianocent/nodeHMS#9).

Next: manual verification of marked parity rows and targeted implementation or issue closure.
