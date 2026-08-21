# HMS Anyaman — Backend Node (Express + PostgreSQL)

## Repo lain yang nyambung

| Repo                    | Isinya                                  |
| ----------------------- | --------------------------------------- |
| `ianocent/hms-backend`  | Backend Laravel lama (sumber referensi) |
| `ianocent/hms-frontend` | Frontend Next.js                        |
| `ianocent/nodefeHMS`    | Adaptasi frontend buat backend ini      |

## Stack

- Express 5 + TypeScript
- Prisma 7 + PostgreSQL (Laragon, port 5432, DB `hms_anyaman`)
- Auth Sanctum-compatible (token `id|40char`, di-hash SHA-256, dikirim lewat `Authorization: Bearer` — `X-Token` masih didukung buat aplikasi native)
- Payload response di-enkripsi AES-256-CBC biar bentuknya sama kayak Laravel

## Struktur

```
src/
├── index.ts               # entry point, mount semua route di /api dan /cms
├── config/permissions.ts  # menuId-based permission
├── controllers/           # 26 controller (auth, reservation, front-desk, folio, staah, ...)
├── middleware/            # auth, permission, errorHandler, requestParser, logger
├── routes/                # 14 grup route
├── services/              # staah.service, token.service
├── scripts/               # migrasi data & verifikasi (phase 1)
└── utils/                 # aes, encryption, response, queryParamHelper
```

## Command yang kepake

```bash
npm run dev               # nodemon, hot reload
npm run build             # tsc -> dist/
npm start                 # jalanin dist (PORT ambil dari .env, default 3000)
npm run phase1:data       # migrasi data MySQL -> PostgreSQL (ada flag --table=<nama>)
npm run phase1:verify     # bandingin row count MySQL vs PG
npm test                  # jest smoke test
npx prisma generate       # setelah schema berubah
npx prisma migrate dev    # hati-hati, riwayat migration manual — pake migrate diff kalau error
```

## Status migrasi

- M1 Database ✅ (187 tabel, sisa mismatch cuma data yang emang ditulis app baru)
- M2 Core + middleware ✅
- M3 Auth ✅ (parity sama Laravel AuthController)
- M4 API endpoints 🔄 (26 controller, 14 grup route)
