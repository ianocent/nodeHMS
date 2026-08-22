/**
 * refresh-from-mysql-dump.js
 * Load Adminer MySQL dump (INSERT-only) into PostgreSQL hms_anyaman.
 *
 * Mode: UPSERT (ON CONFLICT DO UPDATE on primary key) — NO truncate.
 * - Rows from the dump overwrite existing rows per-PK.
 * - Rows/tables NOT in the dump are left untouched.
 * - Columns present in MySQL but missing in PG are skipped (logged).
 * - Sequences are aligned to MAX(id) after load.
 *
 * Streams the dump in chunks (no full-file string) — safe for multi-GB files.
 *
 * Usage: node scripts/refresh-from-mysql-dump.js [path-to-dump.sql]
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DUMP = process.argv[2] || path.join(__dirname, '..', '..', 'new-database-from-live', 'draft_rndhms.sql');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/hms_anyaman';

const pool = new Pool({ connectionString: DATABASE_URL });

// ---------- MySQL escape handling ----------
function unescapeChar(c) {
  switch (c) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case 'b': return '\b';
    case '0': return '\0';
    case 'Z': return '\x1a';
    case '"': return '"';
    case "'": return "'";
    case '\\': return '\\';
    case '%': return '\\%';
    case '_': return '\\_';
    default: return c;
  }
}

// Parse a single "(v,v,...)" string into array of {v, s(isString)}
function parseTuple(str) {
  const values = [];
  let cur = '';
  let curIsStr = false;
  let i = 1; // skip '('
  while (i < str.length) {
    const ch = str[i];
    if (curIsStr) {
      if (ch === '\\') { cur += unescapeChar(str[i + 1]); i += 2; continue; }
      if (ch === "'") {
        if (str[i + 1] === "'") { cur += "'"; i += 2; continue; }
        curIsStr = false; i++; continue;
      }
      cur += ch; i++; continue;
    }
    if (ch === "'") { cur = ''; curIsStr = true; i++; continue; } // reset: drop separator tabs before quote
    if (ch === ',') { values.push({ v: cur, s: curIsStr }); cur = ''; curIsStr = false; i++; continue; }
    if (ch === ')') { values.push({ v: cur, s: curIsStr }); break; }
    cur += ch; i++;
  }
  return values;
}

// Find closing paren index of tuple starting at `start` (buf[start] must be '('), quote-aware.
// Returns -1 if not found in buffer.
function findTupleEnd(buf, start) {
  let i = start + 1;
  let inStr = false;
  while (i < buf.length) {
    const ch = buf[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === "'") {
        if (buf[i + 1] === "'") { i += 2; continue; }
        inStr = false;
      }
      i++; continue;
    }
    if (ch === "'") { inStr = true; i++; continue; }
    if (ch === ')') return i;
    i++;
  }
  return -1;
}

async function main() {
  console.log(`[load] streaming ${DUMP} ...`);

  // Single dedicated connection: session_replication_role is per-connection,
  // so FK-disable only works if every query uses the same client.
  const client = await pool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    console.log('[fk] session_replication_role=replica (FK checks off during load)');
  } catch (e) {
    console.error('[fk] could not disable FK checks (need superuser):', e.message.slice(0, 120));
  }

  const CHUNK = 16 * 1024 * 1024;
  const fd = fs.openSync(DUMP, 'r');
  let buf = '';
  let eof = false;
  let totalBytesRead = 0;

  function fill() {
    if (eof) return false;
    const b = Buffer.alloc(CHUNK);
    const bytes = fs.readSync(fd, b, 0, CHUNK, null);
    if (bytes === 0) { eof = true; return false; }
    totalBytesRead += bytes;
    buf += b.toString('utf8', 0, bytes);
    return true;
  }

  // cache: table -> {pgCols: Map(lower->{name,type}), pk: string[]}
  const metaCache = new Map();

  async function getMeta(table) {
    if (metaCache.has(table)) return metaCache.get(table);
    const colRes = await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    const pgCols = new Map(colRes.rows.map(r => [r.column_name.toLowerCase(), { name: r.column_name, type: r.data_type, nullable: r.is_nullable === 'YES' }]));
    const pkRes = await client.query(
      `SELECT a.attname AS name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey::int2[])
       WHERE i.indrelid = to_regclass($1) AND i.indisprimary
       ORDER BY array_position(i.indkey::int2[], a.attnum)`,
      [`public."${table}"`]
    );
    const meta = { pgCols, pk: pkRes.rows.map(r => r.name), exists: colRes.rowCount > 0 };
    metaCache.set(table, meta);
    return meta;
  }

  const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

  async function upsertBatch(table, meta, colNames, rows, forceDoNothing = false) {
    if (!rows.length) return;
    const quotedCols = colNames.map(q);
    const conflictCols = meta.pk.length ? meta.pk.map(q) : null;
    const updateCols = meta.pk.length ? colNames.filter(c => !meta.pk.includes(c.toLowerCase())) : [];

    let p = 1;
    const chunks = [];
    for (const row of rows) {
      const ph = row.map(() => `$${p++}`);
      chunks.push(`(${ph.join(',')})`);
    }
    let sqlText = `INSERT INTO ${q(table)} (${quotedCols.join(',')}) VALUES ${chunks.join(',')}`;
    if (forceDoNothing) {
      sqlText += ' ON CONFLICT DO NOTHING';
    } else if (conflictCols) {
      if (updateCols.length > 0) {
        sqlText += ` ON CONFLICT (${conflictCols.join(',')}) DO UPDATE SET ${updateCols.map(c => `${q(c)} = EXCLUDED.${q(c)}`).join(',')}`;
      } else {
        sqlText += ' ON CONFLICT DO NOTHING';
      }
    } else {
      sqlText += ' ON CONFLICT DO NOTHING';
    }
    await client.query(sqlText, rows.flat());
  }

  let stmtCount = 0;
  let totalRows = 0;
  const skippedColsLog = new Set();
  const noPkLog = new Set();
  const missingTables = new Set();
  const rowErrors = [];
  const nullNumSubstitutions = new Set();

  outer: while (true) {
    // find next statement
    const idx = buf.indexOf('INSERT INTO `');
    if (idx === -1) {
      if (!fill()) break;
      continue;
    }
    if (idx > 0) buf = buf.slice(idx);

    // header: table name
    while (buf.indexOf('`', 13) === -1) { if (!fill()) break outer; }
    const tbEnd = buf.indexOf('`', 13);
    const table = buf.slice(13, tbEnd);

    // column list
    while (true) {
      if (buf.indexOf('(', tbEnd) !== -1 && buf.indexOf(')', buf.indexOf('(', tbEnd)) !== -1) break;
      if (!fill()) break outer;
    }
    const openParen = buf.indexOf('(', tbEnd);
    const closeParen = buf.indexOf(')', openParen);
    const colRaw = buf.slice(openParen + 1, closeParen).replace(/`/g, '');
    const cols = colRaw.split(',').map(c => c.trim()).filter(Boolean);

    // VALUES keyword
    while (buf.indexOf('VALUES', closeParen) === -1) { if (!fill()) break outer; }
    let pos = buf.indexOf('VALUES', closeParen) + 'VALUES'.length;

    const meta = await getMeta(table);
    if (!meta.exists) missingTables.add(table);

    const colMap = [];
    const skipped = [];
    cols.forEach((c, idx2) => {
      const pg = meta.pgCols.get(c.toLowerCase());
      if (pg) colMap.push({ dumpIdx: idx2, pgName: pg.name, type: pg.type, nullable: pg.nullable });
      else skipped.push(c);
    });
    if (meta.exists && skipped.length) skippedColsLog.add(`${table}: ${skipped.join(', ')}`);
    if (meta.exists && !meta.pk.length) noPkLog.add(table);
    const outCols = colMap.map(c => c.pgName);
    const maxParams = 60000;
    const batchSize = Math.max(1, Math.floor(maxParams / Math.max(1, outCols.length)));
    let batch = [];
    let tableRowCount = 0;

    const flush = async () => {
      if (!batch.length) return;
      try {
        await upsertBatch(table, meta, outCols, batch);
      } catch (err) {
        console.error(`\n[error] ${table}: ${err.message.slice(0, 300)} — retrying row-by-row`);
        for (const row of batch) {
          try {
            await upsertBatch(table, meta, outCols, [row]);
          } catch (e2) {
            // duplicate key on secondary unique index (e.g. NULL->0 rosters) — keep existing row
            if (e2.code === '23505') {
              try {
                await upsertBatch(table, meta, outCols, [row], true);
                continue;
              } catch (_) { /* fall through to error log */ }
            }
            console.error(`[row-error] ${table}: ${e2.message.slice(0, 200)}`);
            const badIdx = [];
            row.forEach((v, i) => { if (typeof v === 'string' && /^\d{1,3}:\d{2}/.test(v)) badIdx.push(outCols[i] + '=' + v); });
            console.error(`  suspect time-values: ${badIdx.join(', ') || 'none visible'}`);
            console.error(`  cols: ${outCols.join(',')}`);
            console.error(`  row: ${JSON.stringify(row).slice(0, 500)}`);
            rowErrors.push(`${table} first-col=${row[0]}: ${e2.message.slice(0, 200)}`);
          }
        }
      }
      totalRows += batch.length;
      tableRowCount += batch.length;
      batch = [];
    };

    // consume tuples until ';'
    while (true) {
      // skip whitespace
      while (pos < buf.length && /\s/.test(buf[pos])) pos++;
      while (pos >= buf.length) {
        // trim consumed prefix to keep buffer small, adjust pos
        if (pos > 4 * 1024 * 1024) { buf = buf.slice(pos); pos = 0; }
        if (!fill()) break;
      }
      if (pos >= buf.length) break; // eof mid-statement — bail

      const ch = buf[pos];
      if (ch === ';') { pos++; break; }

      if (ch !== '(') {
        // Adminer appends "ON DUPLICATE KEY UPDATE `col`=VALUES(`col`), ..." after the last tuple.
        // Fast-forward to the statement-terminating ';' (quote-aware) instead of skipping char-by-char.
        const rest = buf.slice(pos, pos + 32);
        if (/^\s*ON\s+DUPLICATE/i.test(rest) || /^\s*[A-Za-z`]/.test(rest)) {
          let s = pos, inStr = false;
          let semi = -1;
          while (s < buf.length) {
            const c2 = buf[s];
            if (inStr) {
              if (c2 === '\\') { s += 2; continue; }
              if (c2 === "'") {
                if (buf[s + 1] === "'") { s += 2; continue; }
                inStr = false;
              }
              s++; continue;
            }
            if (c2 === "'") { inStr = true; s++; continue; }
            if (c2 === ';') { semi = s; break; }
            s++;
          }
          while (semi === -1) {
            if (pos > 4 * 1024 * 1024) { buf = buf.slice(pos); pos = 0; s = Math.max(0, s - pos); }
            if (!fill()) break;
            while (s < buf.length) {
              const c2 = buf[s];
              if (inStr) {
                if (c2 === '\\') { s += 2; continue; }
                if (c2 === "'") {
                  if (buf[s + 1] === "'") { s += 2; continue; }
                  inStr = false;
                }
                s++; continue;
              }
              if (c2 === "'") { inStr = true; s++; continue; }
              if (c2 === ';') { semi = s; break; }
              s++;
            }
          }
          if (semi !== -1) { pos = semi + 1; break; }
          break; // eof mid-clause
        }
        pos++; continue; // stray char fallback
      }

      // ensure full tuple available
      let end = findTupleEnd(buf, pos);
      while (end === -1) {
        if (pos > 4 * 1024 * 1024) { buf = buf.slice(pos); pos = 0; }
        if (!fill()) break;
        end = findTupleEnd(buf, pos);
      }
      if (end === -1) break; // eof mid-tuple

      const tupStr = buf.slice(pos, end + 1);
      pos = end + 1;
      buf_trim: if (pos > 4 * 1024 * 1024) { buf = buf.slice(pos); pos = 0; }

      if (meta.exists) {
        const vals = parseTuple(tupStr);
        const row = colMap.map(cm => {
          const raw = vals[cm.dumpIdx];
          let out = null;
          if (raw) {
            const v = raw.s ? raw.v : raw.v.trim();
            if (!raw.s && /^NULL$/i.test(v)) out = null;
            else if (/^0000-00-00/.test(v)) out = null;                     // MySQL zero-date
            else if (/^\d{1,3}:\d{2}(:\d{2}(\.\d{1,6})?)?$/.test(v)) out = null; // MySQL TIME-only
            else out = raw.v;
          }
          // NOT NULL date/timestamp columns: substitute sentinel instead of failing
          if (out === null && !cm.nullable && cm.type && /timestamp|date|^time$/.test(cm.type)) {
            out = cm.type === 'time' ? '00:00:00' : '1970-01-01';
          }
          // NOT NULL numeric columns (int/bigint/smallint/numeric/double): NULL -> 0; log it
          if (out === null && !cm.nullable && cm.type && /\d*int|numeric|decimal|double|real/.test(cm.type)) {
            out = '0';
            nullNumSubstitutions.add(`${table}.${cm.pgName}`);
          }
          // PG enum columns: MySQL values may carry leading tabs/spaces — trim
          if (out !== null && cm.type === 'USER-DEFINED') {
            out = String(out).trim();
          }
          // PG boolean columns: MySQL tinyint may hold any int — nonzero = true
          if (out !== null && cm.type === 'boolean') {
            const n = String(out).trim();
            out = (n === '' || n === '0' || /^false$/i.test(n)) ? 'false' : 'true';
          }
          return out;
        });
        batch.push(row);
        if (batch.length >= batchSize) await flush();
      }
      tableRowCount; // noop
    }
    await flush();

    // trim processed prefix
    if (pos > 0) buf = buf.slice(pos);
    stmtCount++;
    totalRows += 0;
    process.stdout.write(`\r[load] stmts=${stmtCount} rows=${totalRows} MB=${(totalBytesRead / 1048576).toFixed(0)} (last: ${table})          `);
  }

  console.log(`\n[load] done. statements=${stmtCount} totalRows=${totalRows}`);

  // ---------- sequence sync ----------
  console.log('[seq] aligning sequences ...');
  const tablesRes = await client.query(
    `SELECT DISTINCT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_default LIKE 'nextval%'`
  );
  let seqFixed = 0;
  for (const { table_name } of tablesRes.rows) {
    const seqColRes = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_default LIKE 'nextval%' LIMIT 1`,
      [table_name]
    );
    const colName = seqColRes.rows[0]?.column_name;
    if (!colName) continue;
    try {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${q(colName)}) FROM ${q(table_name)}), 1))`,
        [`public."${table_name}"`, colName]
      );
      seqFixed++;
    } catch (e) {
      console.error(`[seq-error] ${table_name}.${colName}: ${e.message.slice(0, 150)}`);
    }
  }
  console.log(`[seq] ${seqFixed} sequences aligned`);

  // restore FK enforcement
  try {
    await client.query('SET session_replication_role = origin');
    console.log('[fk] session_replication_role=origin (FK checks back on)');
  } catch (_) { /* ignore */ }

  if (missingTables.size) console.log(`[skip-tables] not in PG: ${[...missingTables].join(', ')}`);
  if (noPkLog.size) console.log(`[no-pk] insert-if-new only: ${[...noPkLog].join(', ')}`);
  for (const s of skippedColsLog) console.log(`[skip-cols] ${s}`);
  for (const s of nullNumSubstitutions) console.log(`[null->0] ${s}`);
  if (rowErrors.length) {
    console.log(`[row-errors] ${rowErrors.length}:`);
    for (const e of rowErrors.slice(0, 20)) console.log('  ' + e);
  }

  client.release();
  await pool.end();
  console.log('[done]');
}

main().catch(async (err) => {
  console.error('[fatal]', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
