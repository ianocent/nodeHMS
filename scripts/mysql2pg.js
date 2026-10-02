#!/usr/bin/env node
/**
 * MySQL/MariaDB dump  ->  PostgreSQL, additive, FK-safe.
 *
 *   node scripts/mysql2pg.js <dump.sql> [options]
 *
 *     --dry-run            parse + report only, writes nothing
 *     --only a,b           restrict to these tables
 *     --skip a,b           extra tables to leave alone
 *     --schema public      target schema (default: public)
 *     --allow-update a,b   tables to upsert even if normally local-wins
 *
 * Why this exists
 * ---------------
 * Production runs MySQL; the Node port runs PostgreSQL. `pg_restore` cannot
 * read a MySQL dump and `psql -f` chokes on backticks, MySQL string escapes,
 * zero dates and `ON DUPLICATE KEY UPDATE`. Every statement is translated here.
 *
 * Behaviour
 * ---------
 * Additive, never destructive: existing rows are UPDATED, missing ones INSERTed.
 *   - `properties`             insert-only (local hotel config always wins)
 *   - `personal_access_tokens` insert-only (local sessions are the working ones)
 *   - `users`                  upserted with credential columns excluded, so a
 *                              live password hash can never lock you out
 *
 * Tables are loaded parents-first (topological sort over the real FK graph), and
 * FK triggers are disabled for the duration because this schema's constraints are
 * not DEFERRABLE. Every resulting dangling reference is reported afterwards rather
 * than silently accepted.
 */
"use strict";

require("dotenv/config");
const fs = require("fs");
const { Client } = require("pg");
const copyStreams = require("pg-copy-streams");

// pg-copy-streams is CJS but exports the factory as `from`; require() itself is
// the module object. pg's query() only returns a stream for a submittable value,
// so this object (not a string) must be passed in.
const copyFrom = copyStreams.from || copyStreams.default || copyStreams;

const argv = process.argv.slice(2);
const FILE = argv[0];
const DRY = argv.includes("--dry-run");
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? String(argv[i + 1] || "").split(",").filter(Boolean) : [];
};
const SCHEMA = (() => { const i = argv.indexOf("--schema"); return i >= 0 ? argv[i + 1] : "public"; })();
const ONLY = opt("--only");
const EXTRA_SKIP = opt("--skip");
const ALLOW_UPDATE = new Set(opt("--allow-update"));

/** Local values win; only genuinely new rows are added. */
const LOCAL_WINS = new Set(["properties", "personal_access_tokens", ...EXTRA_SKIP]);

/** Never overwritten from a live snapshot — losing these ends your access. */
const CREDENTIAL_COLS = new Set([
  "password", "pin_enshift", "pin_void_approve",
  "force_change_password", "email_verified_at", "remember_token",
]);

const COPY_ROWS_PER_CHUNK = 2000;
const ZERO_DATE = /^0000-00-00( 00:00:00(\.0+)?)?$/;
const TIME_ONLY = /^(\d{1,2}):(\d{2})(:(\d{2}))?(\.\d+)?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// ── MySQL literal -> JS value ───────────────────────────────────────────────

/** MySQL treats \' and \\ as escapes; Postgres (standard_conforming_strings) does not. */
function decodeMysqlString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") { out += ch; continue; }
    const n = raw[++i];
    switch (n) {
      case "0": out += "\0"; break;
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "b": out += "\b"; break;
      case "Z": out += "\x1a"; break;
      case "\\": out += "\\"; break;
      case "'": out += "'"; break;
      case '"': out += '"'; break;
      case "%": case "_": out += n; break; // LIKE escapes are data, not escapes
      case undefined: out += "\\"; break;
      default: out += n; break;            // MySQL drops the backslash
    }
  }
  return out;
}

/**
 * Convert one literal for a specific target column type.
 *
 * The type matters. MySQL TIME columns (start_clean_time) hold `09:17:32` where
 * the Postgres port declares timestamp, and tinyint(1) holds values like 3 where
 * Postgres boolean accepts only 0/1.
 */
function convertValue(tok, stats, ctx) {
  const t = (tok || "").trim();
  if (t === "" || t === "NULL") return null;
  const kind = (ctx && ctx.kind) || "text";

  let raw = t;
  if (t[0] === "'") {
    raw = decodeMysqlString(t.slice(1, t.length - 1));
    if (ZERO_DATE.test(raw)) { stats.zeroDates++; return null; }
  } else if (/^b'[01]'$/i.test(t)) {
    return t[2] === "1";
  } else if (/^0x[0-9a-fA-F]+$/.test(t)) {
    stats.hex++;
    const h = t.slice(2);
    if (h.length % 2 === 0 && /^[0-9a-fA-F]{2,}$/.test(h)) return Buffer.from(h, "hex").toString("utf8");
    return parseInt(h, 16);
  } else if (t === "true") return true;
  else if (t === "false") return false;
  else if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) && !/^-?\d+$/.test(t)) {
    return t; // bare enum/set token
  }

  if (kind === "timestamp" || kind === "date" || kind === "time") {
    const tm = TIME_ONLY.exec(raw);
    if (tm) {
      const hh = String(tm[1]).padStart(2, "0");
      const timePart = `${hh}:${tm[2]}:${tm[4] || "00"}`;
      if (kind === "time") return timePart;
      const day = DATE_ONLY.exec((ctx && ctx.rowDate) || "");
      stats.timeAnchored++;
      return `${day ? day[0] : "1970-01-01"} ${timePart}`;
    }
  }

  if (kind === "boolean") {
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw) !== 0;
    const low = raw.trim().toLowerCase();
    if (low === "f" || low === "false" || low === "n" || low === "no" || low === "off" || low === "") return false;
    return true;
  }

  return raw; // numerics and text pass through; Postgres casts them
}

/** Split one VALUES tuple on top-level commas, respecting quotes and parens. */
function splitTuple(s) {
  const out = [];
  let i = 0, depth = 0, cur = "";
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (s[j] === "\\") { j += 2; continue; }
        if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      cur += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === "(") { depth++; cur += ch; i++; continue; }
    if (ch === ")") { depth--; cur += ch; i++; continue; }
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

function extractTuples(body) {
  const rows = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    while (i < n && body[i] !== "(") i++;
    if (i >= n) break;
    let j = i + 1, depth = 1, inStr = false;
    while (j < n && depth > 0) {
      const ch = body[j];
      if (inStr) {
        if (ch === "\\") { j += 2; continue; }
        if (ch === "'") { if (body[j + 1] === "'") { j += 2; continue; } inStr = false; }
        j++; continue;
      }
      if (ch === "'") { inStr = true; j++; continue; }
      if (ch === "(") depth++; else if (ch === ")") depth--;
      j++;
    }
    rows.push(body.slice(i + 1, j - 1));
    i = j;
  }
  return rows;
}

/** One CSV line per row; every value quoted so "" stays distinct from NULL. */
function csvChunk(rows) {
  const out = [];
  for (const r of rows) {
    const cells = new Array(r.length);
    for (let i = 0; i < r.length; i++) {
      const v = r[i];
      if (v === null || v === undefined) { cells[i] = "\\N"; continue; }
      const s = typeof v === "boolean" ? (v ? "t" : "f") : String(v);
      cells[i] = '"' + s.replace(/"/g, '""') + '"';
    }
    out.push(cells.join(","));
  }
  return out.join("\n") + "\n";
}

/** Parents before children; cycles are appended rather than dropped. */
function topoSort(tables, fks) {
  const set = new Set(tables);
  const indeg = new Map([...set].map((t) => [t, 0]));
  const adj = new Map([...set].map((t) => [t, []]));
  for (const fk of fks) {
    if (!set.has(fk.child) || !set.has(fk.parent) || fk.child === fk.parent) continue;
    adj.get(fk.parent).push(fk.child);
    indeg.set(fk.child, indeg.get(fk.child) + 1);
  }
  const q = [...set].filter((t) => indeg.get(t) === 0);
  const out = [];
  while (q.length) {
    const t = q.shift();
    out.push(t);
    for (const c of adj.get(t)) {
      indeg.set(c, indeg.get(c) - 1);
      if (indeg.get(c) === 0) q.push(c);
    }
  }
  for (const t of set) if (!out.includes(t)) out.push(t);
  return out;
}

// ── driver ──────────────────────────────────────────────────────────────────

async function main() {
  if (!FILE) {
    console.error("usage: node scripts/mysql2pg.js <dump.sql> [--dry-run] [--only a,b] [--skip a,b] [--schema public]");
    process.exit(2);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const q = (sql, params) => client.query(sql, params);

  const colsRes = await q(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = $1`, [SCHEMA]);
  const target = new Map();
  const colTypes = new Map();
  for (const r of colsRes.rows) {
    if (!target.has(r.table_name)) { target.set(r.table_name, new Set()); colTypes.set(r.table_name, new Map()); }
    target.get(r.table_name).add(r.column_name);
    let kind = r.data_type;
    if (kind === "timestamp without time zone" || kind === "timestamp with time zone") kind = "timestamp";
    colTypes.get(r.table_name).set(r.column_name, kind);
  }

  const pkRes = await q(`
    SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1
    ORDER BY tc.table_name, kcu.ordinal_position`, [SCHEMA]);
  const pk = new Map();
  for (const r of pkRes.rows) {
    if (!pk.has(r.table_name)) pk.set(r.table_name, []);
    pk.get(r.table_name).push(r.column_name);
  }

  const fkRes = await q(`
    SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`, [SCHEMA]);

  // NOT NULL with no default: MySQL accepted NULL where Postgres does not.
  const nnRes = await q(`
    SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = $1 AND is_nullable = 'NO' AND column_default IS NULL`, [SCHEMA]);
  const required = new Map();
  for (const r of nnRes.rows) {
    if (!required.has(r.table_name)) required.set(r.table_name, new Set());
    required.get(r.table_name).add(r.column_name);
  }

  // Secondary unique keys: ON CONFLICT can only name one target, so those tables
  // need the insert-then-update path.
  const uqRes = await q(`
    SELECT t.relname AS table_name
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_index ix ON ix.indrelid = t.oid AND ix.indisunique
    WHERE n.nspname = $1 AND NOT ix.indisprimary
      AND array_length(ix.indkey, 1) IS NOT NULL`, [SCHEMA]);
  const hasSecondaryUnique = new Set(uqRes.rows.map((r) => r.table_name));

  const rank = new Map(topoSort([...target.keys()], fkRes.rows).map((t, i) => [t, i]));

  const stats = {
    rows: 0, tables: 0, zeroDates: 0, timeAnchored: 0, hex: 0, skippedRows: 0,
    skippedByTable: {}, skippedTables: [], noPk: [], twoStep: [], dropped: {},
    droppedNotNull: 0, droppedNotNullDetail: {}, timing: [],
  };

  const buffer = new Map();
  let currentTable = null;
  const triggersOff = new Set();

  async function disableTriggers(table) {
    if (triggersOff.has(table)) return;
    try {
      await q(`ALTER TABLE "${SCHEMA}"."${table}" DISABLE TRIGGER ALL`);
      triggersOff.add(table);
    } catch (e) {
      console.error(`  ! cannot disable FK triggers on ${table} (${e.message.split("\n")[0]}) — run as the table owner`);
    }
  }
  async function enableTriggers(table) {
    if (!triggersOff.has(table)) return;
    triggersOff.delete(table);
    try { await q(`ALTER TABLE "${SCHEMA}"."${table}" ENABLE TRIGGER ALL`); } catch { /* ignore */ }
  }

  async function applyInner(table, b) {
    const tcols = target.get(table);
    const cols = b.cols.filter((c) => tcols.has(c));
    if (!cols.length) return;
    const keep = b.cols.map((c, i) => (tcols.has(c) ? i : -1)).filter((i) => i >= 0);
    let rows = b.rows.map((r) => keep.map((i) => (r[i] === undefined ? null : r[i])));

    const dropped = b.cols.filter((c) => !tcols.has(c));
    if (dropped.length) stats.dropped[table] = dropped;

    // A fabricated key (user_id = 0) would collide with the composite unique
    // constraints these tables carry, and it would be a lie about ownership.
    const req = required.get(table);
    if (req) {
      const kept = [];
      for (const r of rows) {
        let bad = false;
        for (let i = 0; i < cols.length; i++) {
          if (r[i] !== null && r[i] !== undefined) continue;
          if (!req.has(cols[i])) continue;
          const k = `${table}.${cols[i]}`;
          stats.droppedNotNull++;
          stats.droppedNotNullDetail[k] = (stats.droppedNotNullDetail[k] || 0) + 1;
          bad = true;
          break;
        }
        if (!bad) kept.push(r);
      }
      rows = kept;
    }
    if (!rows.length) return;

    const quoted = `"${SCHEMA}"."${table}"`;
    const colList = cols.map((c) => `"${c}"`).join(",");

    // Stage through a temp table: COPY is far faster than parameterised INSERTs
    // and the conflict resolution then runs once per table. CTAS WITH NO DATA
    // inherits the exact column types and carries no constraints to trip over.
    const stg = `stg_${table}`;
    await q(`DROP TABLE IF EXISTS ${stg}`);
    await q(`CREATE TEMP TABLE ${stg} AS SELECT ${colList} FROM ${quoted} WITH NO DATA`);

    for (let s = 0; s < rows.length; s += COPY_ROWS_PER_CHUNK) {
      const payload = csvChunk(rows.slice(s, s + COPY_ROWS_PER_CHUNK));
      await new Promise((resolve, reject) => {
        const stream = client.query(copyFrom(`COPY ${stg} (${colList}) FROM STDIN WITH (FORMAT csv, NULL '\\N')`));
        stream.on("error", reject);
        // v7 never emits 'end'; completion is the callback given to end(), which
        // pg-copy-streams calls from handleReadyForQuery().
        stream.end(payload, (err) => (err ? reject(err) : resolve()));
      });
    }

    const keyCols = pk.get(table);
    // The dump's pivots can repeat a key inside one statement, and ON CONFLICT
    // cannot arbitrate against a row inserted by the same command.
    const src = keyCols && keyCols.length
      ? `(SELECT DISTINCT ON (${keyCols.map((c) => `"${c}"`).join(",")}) * FROM ${stg})`
      : `${stg}`;
    const localWins = LOCAL_WINS.has(table) && !ALLOW_UPDATE.has(table);

    if (keyCols && !localWins && !hasSecondaryUnique.has(table)) {
      const updatable = cols.filter((c) => !keyCols.includes(c) && !(table === "users" && CREDENTIAL_COLS.has(c)));
      const sql = updatable.length
        ? `INSERT INTO ${quoted} (${colList}) SELECT ${colList} FROM ${src} ` +
          `ON CONFLICT (${keyCols.map((c) => `"${c}"`).join(",")}) DO UPDATE SET ` +
          updatable.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")
        : `INSERT INTO ${quoted} (${colList}) SELECT ${colList} FROM ${src} ` +
          `ON CONFLICT (${keyCols.map((c) => `"${c}"`).join(",")}) DO NOTHING`;
      const res = await q(sql);
      stats.rows += res.rowCount || 0;
      console.log(`  ${table.padEnd(40)} ${String(rows.length).padStart(8)} -> ${String(res.rowCount || 0).padStart(8)} ${updatable.length ? "upsert" : "insert-only"}`);
    } else if (keyCols) {
      if (localWins) {
        const res = await q(`INSERT INTO ${quoted} (${colList}) SELECT ${colList} FROM ${src} ON CONFLICT (${keyCols.map((c) => `"${c}"`).join(",")}) DO NOTHING`);
        stats.rows += res.rowCount || 0;
        stats.twoStep.push(`${table} (local-wins)`);
        console.log(`  ${table.padEnd(40)} ${String(rows.length).padStart(8)} -> ${String(res.rowCount || 0).padStart(8)} insert-only (local wins)`);
      } else {
        // Cannot name two conflict targets: insert what is genuinely new
        // (target-less DO NOTHING tolerates every unique index), then push live
        // values onto existing rows matched by PK. The SET target column must
        // stay unqualified — Postgres rejects `SET tbl.col = ...`.
        const updatable = cols.filter((c) => !keyCols.includes(c) && !(table === "users" && CREDENTIAL_COLS.has(c)));
        const upd = updatable.map((c) => `"${c}" = src."${c}"`).join(", ");
        const match = keyCols.map((c) => `${table}."${c}" = src."${c}"`).join(" AND ");
        const cte = `WITH src AS (SELECT DISTINCT ON (${keyCols.map((c) => `"${c}"`).join(",")}) * FROM ${stg})`;
        await q(`INSERT INTO ${quoted} (${colList}) SELECT ${colList} FROM ${src} ON CONFLICT DO NOTHING`);
        if (updatable.length) await q(`${cte} UPDATE ${quoted} SET ${upd} FROM src WHERE ${match}`);
        stats.twoStep.push(table);
        console.log(`  ${table.padEnd(40)} ${String(rows.length).padStart(8)}  insert+update (extra unique key)`);
      }
    } else {
      // No PK and no unique index: anti-join on the full row so re-runs are safe.
      const same = cols.map((c) => `t."${c}" IS NOT DISTINCT FROM s."${c}"`).join(" AND ");
      const res = await q(
        `INSERT INTO ${quoted} (${colList}) SELECT ${colList} FROM ${stg} s ` +
        `WHERE NOT EXISTS (SELECT 1 FROM ${quoted} t WHERE ${same})`
      );
      stats.rows += res.rowCount || 0;
      stats.noPk.push(table);
      console.log(`  ${table.padEnd(40)} ${String(rows.length).padStart(8)} -> ${String(res.rowCount || 0).padStart(8)} dedupe-insert (no PK)`);
    }

    await q(`DROP TABLE ${stg}`);
  }

  async function apply(table) {
    const b = buffer.get(table);
    buffer.delete(table);
    if (!b || b.rows.length === 0) return;
    const t0 = Date.now();
    await disableTriggers(table);
    try {
      await applyInner(table, b);
    } catch (err) {
      await enableTriggers(table);
      console.error(`\n### FAILED on table "${table}" (${b.rows.length} rows, ${b.cols.length} cols)`);
      console.error("   cols:", b.cols.join(","));
      console.error("   err :", err.message);
      throw err;
    }
    await enableTriggers(table);
    stats.timing.push({ table, ms: Date.now() - t0, rows: b.rows.length });
  }

  /** Flush buffered tables whose FK rank is at or below every still-pending one. */
  async function flushCompleted() {
    const pendingRanks = [...buffer.keys()].map((t) => rank.get(t) ?? 0);
    if (currentTable) pendingRanks.push(rank.get(currentTable) ?? 0);
    const ready = [...buffer.keys()]
      .filter((t) => t !== currentTable)
      .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    for (const t of ready) if (pendingRanks.every((r) => (rank.get(t) ?? 0) <= r)) await apply(t);
  }

  async function emit(table, cols, tuples, stmtHead) {
    if (!buffer.has(table)) buffer.set(table, { cols, rows: [] });
    const b = buffer.get(table);
    const dateIdx = cols.findIndex((c) => c === "date" || c === "check_in_date" || c === "business_date");
    const typeMap = colTypes.get(table) || new Map();

    for (const t of tuples) {
      const parts = splitTuple(t);
      if (parts.length !== cols.length) {
        stats.skippedRows++;
        stats.skippedByTable[table] = (stats.skippedByTable[table] || 0) + 1;
        if (!stats.skippedByTable[table] || stats.skippedByTable[table] === 1) {
          console.error(`  ! ${table}: cols=${cols.length} got=${parts.length} tuple=${t.slice(0, 120)}`);
          console.error(`    stmt=${String(stmtHead || "").replace(/\s+/g, " ").slice(0, 180)}`);
        }
        continue;
      }
      const rowDate = dateIdx >= 0 ? parts[dateIdx] : null;
      const row = new Array(cols.length);
      for (let i = 0; i < cols.length; i++) {
        row[i] = convertValue(parts[i], stats, {
          kind: typeMap.get(cols[i]),
          rowDate: rowDate ? String(rowDate).trim().replace(/^'|'$/g, "") || null : null,
        });
      }
      b.rows.push(row);
    }
    stats.tables++;
  }

  // Manual chunked reader rather than readline: a multi-MB statement plus a long
  // COPY can outlast the input stream, and readline then throws
  // ERR_USE_AFTER_CLOSE instead of ending the loop cleanly.
  let pending = "";
  const dryCounts = new Map();

  const handleStatement = async (stmt) => {
    const s = stmt.trim();
    if (!s) return;
    const head = s.match(/^INSERT INTO\s+`([^`]+)`\s*\(([\s\S]*?)\)\s*VALUES/i);
    if (!head) return;
    const table = head[1];
    if (!target.has(table)) { stats.skippedTables.push(table); return; }
    if (ONLY.length && !ONLY.includes(table)) return;

    const cols = head[2].split(",").map((c) => c.trim().replace(/^`|`$/g, ""));
    // Drop MySQL's trailing clause; it carries its own parenthesised groups that
    // the tuple scanner would count as bogus rows.
    const body = s.slice(head.index + head[0].length).split(/\nON DUPLICATE KEY UPDATE/i)[0];
    const tuples = extractTuples(body);
    if (DRY) { dryCounts.set(table, (dryCounts.get(table) || 0) + tuples.length); return; }

    if (table !== currentTable) { await flushCompleted(); currentTable = table; }
    await emit(table, cols, tuples, s.slice(0, 240));
  };

  const stream = fs.createReadStream(FILE, { encoding: "utf8", highWaterMark: 1 << 22 });
  await new Promise((resolve, reject) => {
    // Single connection, so statements must be applied strictly in order.
    let chain = Promise.resolve();
    let failed = false;
    const enqueue = (stmt) => {
      if (failed) return;
      chain = chain.then(() => handleStatement(stmt)).catch((e) => { failed = true; reject(e); });
    };
    stream.on("data", (chunk) => {
      pending += chunk;
      let idx;
      while ((idx = pending.indexOf(";\n")) !== -1) {
        const stmt = pending.slice(0, idx + 1);
        pending = pending.slice(idx + 2);
        enqueue(stmt);
      }
    });
    stream.on("end", () => {
      if (pending.trim()) enqueue(pending);
      chain.then(resolve, reject);
    });
    stream.on("error", reject);
  });

  if (DRY) {
    for (const [t, n] of [...dryCounts.entries()].sort((a, b) => (rank.get(a[0]) ?? 0) - (rank.get(b[0]) ?? 0))) {
      const mode = LOCAL_WINS.has(t) ? "insert-only" : "upsert";
      console.log(`  ${t.padEnd(40)} ${String(n).padStart(9)} rows  fk-rank ${String(rank.get(t) ?? "?").padStart(3)}  ${mode}`);
    }
    console.log("\ntotal rows:", [...dryCounts.values()].reduce((a, b) => a + b, 0));
    console.log("tables    :", dryCounts.size);
    await client.end();
    return;
  }

  currentTable = null;
  for (const t of [...buffer.keys()].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))) await apply(t);
  for (const t of triggersOff) await enableTriggers(t);

  console.log("\n=== summary ===");
  console.log("tables written  :", stats.tables);
  console.log("rows written    :", stats.rows);
  console.log("zero-dates->NULL:", stats.zeroDates);
  console.log("time->timestamp :", stats.timeAnchored);
  console.log("hex literals    :", stats.hex);
  console.log("skipped rows    :", stats.skippedRows, JSON.stringify(stats.skippedByTable));
  console.log("unknown tables  :", [...new Set(stats.skippedTables)]);
  console.log("no-PK tables    :", stats.noPk);
  console.log("2-step / local  :", stats.twoStep);
  console.log("NOT NULL drops  :", stats.droppedNotNull, JSON.stringify(stats.droppedNotNullDetail));
  console.log("dropped columns :", JSON.stringify(stats.dropped));

  // FK triggers were off during the load, so measure what the snapshot itself
  // left dangling instead of letting it abort the import.
  const dangling = [];
  for (const fk of fkRes.rows) {
    if (fk.child === fk.parent) continue;
    const r = await q(
      `SELECT count(*)::int AS n, array_agg(DISTINCT c."${fk.col}") AS vals
       FROM "${SCHEMA}"."${fk.child}" c
       WHERE c."${fk.col}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "${SCHEMA}"."${fk.parent}" p WHERE p.id = c."${fk.col}")`
    );
    if (r.rows[0].n > 0) dangling.push({ ...fk, n: r.rows[0].n, vals: r.rows[0].vals });
  }
  console.log("\n=== referential integrity (dangling references) ===");
  if (!dangling.length) console.log("  none - every foreign key resolves");
  else for (const d of dangling) console.log(`  ${d.child}.${d.col} -> ${d.parent}: ${d.n} row(s) ${JSON.stringify(d.vals)}`);
  console.log("\n  a value of 0 is MySQL's 'no parent' sentinel and should become NULL:");
  console.log("    UPDATE <table> SET <col> = NULL WHERE <col> = 0;");

  console.log("\n=== slowest tables ===");
  for (const s of stats.timing.sort((a, b) => b.ms - a.ms).slice(0, 8)) {
    console.log(`  ${s.table.padEnd(40)} ${(s.ms / 1000).toFixed(1)}s  ${s.rows} rows`);
  }

  await q("ANALYZE");
  await client.end();
}

main().catch((e) => { console.error("FATAL", e && e.stack ? e.stack : e); process.exit(1); });
