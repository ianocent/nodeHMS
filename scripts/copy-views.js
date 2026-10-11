/**
 * Copy the EJS templates into `dist` after `tsc`.
 *
 * `tsc` only emits `.js`/`.d.ts`; the PDF templates in `src/views/pdf` are data, not
 * code, so they are invisible to it. `PdfService` resolves them relative to its own
 * compiled location (`dist/src/services` → `../views/pdf` → `dist/src/views/pdf`), which
 * means every PDF request throws `ENOENT` in production while working fine under
 * `ts-node`/`dev` — the exact class of bug that only shows up after a build.
 *
 * Runs as an npm `postbuild` hook so `npm run build` stays a single command. If
 * `src/views` does not exist (a checkout without the templates) it is a no-op rather
 * than a build failure.
 */
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', 'src', 'views');
const to = path.join(__dirname, '..', 'dist', 'src', 'views');

if (!fs.existsSync(from)) {
  console.log('[copy-views] src/views not found, nothing to copy');
  process.exit(0);
}

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`[copy-views] copied ${from} -> ${to}`);
