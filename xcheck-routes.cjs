/**
 * Cross-check v2: frontend request paths vs node routes vs base Laravel routes.
 * Mount-aware + express-wildcard aware. READ-ONLY.
 */
const fs = require('fs');
const path = require('path');

const FE = 'C:/Users/uzuma/Documents/hms-anyaman/frontend-node';
const BE = 'C:/Users/uzuma/Documents/hms-anyaman/backend-node';
const BASE = 'C:/Users/uzuma/Documents/hmsBackend/backend';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

const norm = (p) =>
  p
    .replace(/\$\{[^}]*\}/g, '{X}')       // ${x} -> {X}
    .replace(/\{[^}]*\}/g, '{X}')          // {x}  -> {X}
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{X}') // :id -> {X}
    .replace(/\$$/, '')                     // trailing string-concat marker
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');

// ============ NODE ROUTES (mount-aware) ============
// router file -> mount prefixes. internal paths relative unless noted.
// report.routes.ts declares ABSOLUTE /cms/... paths and is mounted at root
// (app.use(reportRoutes)) plus /api. So no prefix for the root mount.
const MOUNTS = {
  'report.routes.ts': ['/@root', '/api'],
  'generic.routes.ts': ['/cms/generic', '/api/generic'],
  'pos.routes.ts': ['/@root'],
  'booking.routes.ts': ['/booking'],
};
const DEFAULT_MOUNT = '/cms';

const nodeRoutes = [];   // {method, path, file}
for (const f of walk(path.join(BE, 'src/routes')).filter((f) => f.endsWith('.ts'))) {
  const base = path.basename(f);
  if (base === 'pg-admin.routes.ts') continue;
  const src = fs.readFileSync(f, 'utf8');
  const mounts = MOUNTS[base] || [DEFAULT_MOUNT, '/api', '/api/cms'];
  for (const m of src.matchAll(/(?:router|posRoutes)\.(get|post|put|patch|delete)\('([^']*)'/g)) {
    const method = m[1].toUpperCase();
    let raw = m[2];
    const optional = /:\w+\?$/.test(raw) || /\?\(\?=/.test(raw);
    for (const mount of mounts) {
      let full;
      if (mount === '/@root') full = raw;
      else if (mount.endsWith('@abs')) full = mount.replace('@abs', '') + raw;
      else full = mount + raw;
      nodeRoutes.push({ method, path: norm(full), file: base, optional, raw });
    }
  }
}

// ============ MATCHING (express semantics: :param wildcard, {*rest} catch-all) ============
const segsOf = (p) => p.split('/').filter(Boolean);
const isParam = (s) => s === '{X}' || s.startsWith('{*');

function matchRoute(routes, pathname) {
  const s = segsOf(pathname);
  for (const r of routes) {
    const rs = segsOf(r.path);
    if (r.raw && /\{\*\w+\}/.test(r.raw)) {
      // express catch-all {*rest}: must consume >= 1 remaining segment,
      // so the request must have AT LEAST as many segments as the route parts.
      if (s.length < rs.length) continue;
      let ok = true;
      for (let i = 0; i < rs.length; i++) {
        if (isParam(rs[i])) continue;
        if (rs[i] !== s[i]) { ok = false; break; }
      }
      if (ok) return r;
      continue;
    }
    if (rs.length !== s.length) continue;
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      if (isParam(rs[i])) continue;
      if (rs[i] !== s[i]) { ok = false; break; }
    }
    if (ok) return r;
  }
  return null;
}

// ============ BASE LARAVEL ROUTES ============
const RES = {
  index: ['GET', ''], create: ['GET', '/create'], store: ['POST', ''],
  show: ['GET', '/{id}'], edit: ['GET', '/{id}/edit'], update: ['PUT', '/{id}'],
  updateP: ['PATCH', '/{id}'], destroy: ['DELETE', '/{id}'],
};
const baseRoutes = [];
const cms = fs.readFileSync(path.join(BASE, 'routes/cms.php'), 'utf8');
for (const m of cms.matchAll(/Route::(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
  baseRoutes.push({ method: m[1].toUpperCase(), path: norm('/cms/' + m[2]) });
}
// resource expansion — controller arg may be 'X' or XController::class
for (const m of cms.matchAll(/Route::(api)?[Rr]esource\(\s*'([^']*)'\s*,\s*[^,)]+/g)) {
  for (const [act, [method, suffix]] of Object.entries(RES)) {
    if (m[1] === 'api' && ['create', 'edit'].includes(act)) continue;
    baseRoutes.push({ method, path: norm('/cms/' + m[2] + suffix), res: `${act}` });
  }
}

// ============ FRONTEND PATHS ============
const fePaths = new Map();
for (const f of walk(FE).filter((f) => /\.(tsx|ts)$/.test(f))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/["'`](\/cms\/[A-Za-z0-9_\-/{}$.]*)["'`]/g)) {
    const p = norm(m[1]);
    if (!p || !p.startsWith('/cms')) continue;
    if (!fePaths.has(p)) fePaths.set(p, new Set());
    fePaths.get(p).add(path.relative(FE, f).replace(/\\/g, '/'));
  }
}

// ============ REPORT ============
const missingNode = [];
const missingBoth = [];
for (const [p, files] of [...fePaths].sort()) {
  const n = matchRoute(nodeRoutes, p);
  if (n) continue;
  const b = matchRoute(baseRoutes, p);
  const row = { p, base: b ? `${b.method} (res:${b.res || 'cms.php'})` : null, files: [...files] };
  (b ? missingNode : missingBoth).push(row);
}

console.log(`frontend paths: ${fePaths.size} | node routes: ${nodeRoutes.length} | base routes: ${baseRoutes.length}`);
console.log(`\n########## A. MISSING IN NODE (exists in base) — ${missingNode.length} ##########`);
for (const r of missingNode) console.log(`  ${r.p}\n      base: ${r.base}\n      used: ${r.files.join(', ')}`);
console.log(`\n########## B. IN NEITHER base nor node — ${missingBoth.length} ##########`);
for (const r of missingBoth) console.log(`  ${r.p}\n      used: ${r.files.join(', ')}`);
