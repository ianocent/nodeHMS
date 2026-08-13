# HMS Anyaman — Backend Node (Express + PostgreSQL)

Backend baru hasil migrasi dari Laravel (MySQL) ke Node.js/Express (PostgreSQL).
Target: **100% API compatibility** dengan backend Laravel lama — frontend tidak perlu berubah.

## Git Repo (push / pull / issues)

- **Repo ini**: https://github.com/ianocent/nodeHMS
- SSH: `git@github.com:ianocent/nodeHMS.git`

## Repo Terkait

| Repo | Isi | Link |
|------|-----|------|
| `hms-backend` | Backend Laravel (sumber/kode lama, referensi) | https://github.com/ianocent/hms-backend |
| `hms-frontend` | Frontend Next.js asli (tidak diubah) | https://github.com/ianocent/hms-frontend |
| `frontend-node` (`nodefeHMS`) | Adaptasi frontend untuk backend-node | https://github.com/ianocent/nodefeHMS |

## Tech Stack

- Express 5 + TypeScript
- Prisma 7 + PostgreSQL (Laragon, port 5432)
- JWT auth (Sanctum-compatible), AES-256-CBC payload encryption (match Laravel)
- Jest + Supertest

## Struktur

```
src/
├── index.ts               # Entry point Express
├── config/permissions.ts  # menuId-based permission codes
├── controllers/           # 26 controller (auth, reservation, front-desk, folio, staah, ...)
├── middleware/            # auth, permission, errorHandler, requestParser, logger
├── routes/                # 14 route groups
├── services/              # staah.service, token.service
├── scripts/               # Phase 1: test-connections, migrate-data, verify-data
└── utils/                 # aes, encryption, response, queryParamHelper
```

## Scripts

```bash
npm run dev               # nodemon hot-reload
npm run build             # tsc compile
npm run start             # node dist/src/index.js
npm run phase1:test       # test koneksi MySQL + PostgreSQL
npm run phase1:schema     # prisma db pull (dari MySQL)
npm run phase1:tables     # prisma migrate dev --name init
npm run phase1:data       # migrasi data MySQL → PostgreSQL
npm run phase1:verify     # verifikasi row count 100%
npm test                  # jest smoke test
```

## Aturan Keamanan

- `.env`, `cookie.txt`, `login_response.txt`, `*.log` **tidak pernah di-commit**.
- `APP_AES_PASSWORD` wajib dari environment (fallback hardcoded sudah dihapus).
- Jangan commit credential apa pun ke repo ini.

## Status Migrasi

- M1 (Database): siap eksekusi — lihat `MIGRATION_STATUS.md` di root `hms-anyaman/`
- M2 (Core + auth middleware): ✅ ada
- M3 (Auth endpoints): ✅ ada (login, change-password, forget-password)
- M4 (API endpoints): 🔄 berjalan (26 controller, 14 route group)
- Detail fase: `statement.md` di root `hms-anyaman/`