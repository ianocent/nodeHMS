# HMS Anyaman — Backend Node (Express + PostgreSQL)

Backend anyar hasil migrasi dari Laravel (MySQL) ke Node.js/Express (PostgreSQL). Targetnya satu: **bisa dioper tanpa frontend berubah** — respons API harus sama persis kayak backend Laravel lama, termasuk enkripsi AES dan format tokennya.

Repo: https://github.com/ianocent/nodeHMS · SSH `git@github.com:ianocent/nodeHMS.git`

## Repo lain yang nyambung

| Repo | Isinya |
|------|--------|
| `ianocent/hms-backend` | Backend Laravel lama (sumber referensi, jangan diedit) |
| `ianocent/hms-frontend` | Frontend Next.js asli (jangan diedit) |
| `ianocent/nodefeHMS` | Adaptasi frontend buat backend ini |

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

## Aturan main (baca dulu kalau mau nyumbang)

- `.env`, `cookie.txt`, `login_response.txt`, `*.log` **jangan pernah di-commit**. Udah ada di `.gitignore`, jangan dipaksa `git add -f` — percaya, nggak ada alasan buat itu.
- `APP_AES_PASSWORD` cuma dibaca dari environment. Dulu pernah ada fallback hardcoded di `aes.ts`/`encryption.ts`, itu udah dibuang karena bocor ke repo lama. Jangan ditambahin balik.
- Kalau nyentuh endpoint, cek dulu `AuthController.php` di repo Laravel — perilaku harus nyamain itu, bukan "perbaiki" seenaknya. Frontend lama nggak bakal diubah-ubah, jadi backend yang harus nurut.

## Status migrasi

- M1 Database ✅ (187 tabel, sisa mismatch cuma data yang emang ditulis app baru)
- M2 Core + middleware ✅
- M3 Auth ✅ (parity sama Laravel AuthController — lihat `M3_AUTH_PARITY.md`)
- M4 API endpoints 🔄 (26 controller, 14 grup route)
- Detail lengkap: `statement.md` di root `hms-anyaman/`
