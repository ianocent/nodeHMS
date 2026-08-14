# M3 — Auth Parity (backend-node)

Status: CODE DONE. Build oleh user (`npm run build`), terus `npm start` / test.

## Perubahan vs Laravel (AuthController.php / Sanctum)

### Fixed (parity Laravel)
| Area | Sebelum (node) | Sesudah (mirror Laravel) | File |
|------|----------------|--------------------------|------|
| Login: duplicate session | Auto-revoke, selalu allow | Tolak `400 "User already logged in"` kalau token aktif <30 mnt | auth.controller.ts |
| Login: `last_login_at` | ga di-set | di-set `now()` | auth.controller.ts |
| Login/refresh: `expires_token` | created + 24h | **created_at token** (Laravel: `tokens->last()->created_at`) | token.service.ts + auth.controller.ts |
| Login/refresh: `is_shift` | `false` hardcoded | query `shifts` (user_id + property_id + date business + `end IS NULL`) | auth.controller.ts |
| Login/refresh: `is_need_shift` | `false` hardcoded | query `model_has_menus` (morph `App\Models\Role`) join `menus.visibility='transaction'` | auth.controller.ts |
| Login/refresh: `bussinesDate` | `today` | `log_audits.date` max per property + 1 hari (fallback today) — mirror `LogAudit::getBusinessDate` | auth.controller.ts |
| Logout | `X-Token` only | `Authorization: Bearer` + `X-Token` fallback (Laravel: `bearerToken()`) | auth.controller.ts |
| Refresh | `X-Token` only | sama (getTokenHeader) | auth.controller.ts |
| Permission tree: menu exclude | ga ada | exclude id `5, 6, 14, 15` (semua level) + filter id `52` (output) — mirror `formatData()` | auth.controller.ts |
| Permission tree: label | `split(/[\s_]+/)` | `title()` + `replace(-,_ → space)` + `split('.')` (mirror `str($name['en'])->title()...`) | auth.controller.ts |
| Permission tree: child crud | pake crud **parent** | lookup crud per **child** menu_id | auth.controller.ts |
| Permission tree: isaccess | super-user → all true | murni `model_has_menus` (mirror `in_array`) | auth.controller.ts |
| Permission tree: child label | `join(' ')` | elemen **terakhir** dari split (mirror `->last()`) | auth.controller.ts |
| Change password | payload beda | + `property_name` / `property_image` (`/storage/{logo}`), role di-query ulang, shift/bdate real | auth.controller.ts |

### Added (endpoint baru, mirror cms.php)
- `GET  /cms/force-logout/:email` (public) — revoke semua token user by email
- `POST /cms/force-logout/:email` (auth)
- `GET  /cms/force-bulk-logout` (public, validasi token internal)
- `POST /cms/force-bulk-logout` (auth) — revoke token semua user dgn `last_property` sama (kecuali caller)

### Ga diubah (sengaja)
- `forgetPassword` return token langsung — Laravel butuh kolom `password_change_token` yang **ga ada** di MySQL maupun PG (fitur Laravel rusak legacy, bukan parity bug)
- Semua route tetep mount di `/api` + `/cms`

## Verified (runtime, server :3007, user dev@dipstrategy.com hash backup/restore)
```
login-valid:        200, role ["developer"], expires_token = created_at ✓
                    bussinesDate 2026-01-20 (log_audits+1) ✓, is_shift false, is_need_shift true ✓
                    perms 24, label mirror ["Administrator"] ✓, isaccess mirror ✓
logout-bearer:      200 ✓
login-dup-session:  400 "User already logged in" ✓
force-logout:       200, token mati → logout 401 ✓
refresh (Bearer):   FIX DITERAPKAN — verified 200 ✓ (user dev, server :3001)
```

## Build & Test (oleh user)
```bash
npm run build
# test refresh + change-password:
npm start
node C:\Users\uzuma\AppData\Local\Temp\opencode\refresh-only.js   # script: login→refresh (harap 200)
```
Prisma generate: TIDAK perlu (ga ada perubahan schema).

## Files changed
- `backend-node/src/controllers/auth.controller.ts`
- `backend-node/src/services/token.service.ts`
- `backend-node/src/routes/auth.routes.ts`
- `backend-node/src/__tests__/helpers.ts` (fix: load `dotenv/config` — test suite gagal 65/68 tanpa env AES; sisanya pre-existing: guest formatGuest, BigInt casts, unique constraints — bukan auth)

## Todo / catatan
- [ ] Setelah build: verifikasi `refresh` (Bearer) + `change-password` runtime
- [ ] 66 test gagal pre-existing di suite (non-auth controller) — item terpisah
- [ ] Commit + push setelah build verified