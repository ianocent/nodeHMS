import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Simple auth middleware - only allow in development or with secret token
const pgAdminAuth = (req: Request, res: Response, next: Function) => {
  const token = (Array.isArray(req.query.token) ? req.query.token[0] : req.query.token) 
    || req.headers['x-pg-admin-token'];
  const allowedToken = process.env.PG_ADMIN_TOKEN || 'dev-secret-change-me';
  
  if (process.env.NODE_ENV === 'production' && token !== allowedToken) {
    return res.status(403).send(`
      <html><body style="font-family: monospace; padding: 2rem;">
        <h1>403 Forbidden</h1>
        <p>Set PG_ADMIN_TOKEN env var and pass ?token=xxx or header X-Pg-Admin-Token</p>
        <p>Example: <code>localhost:3001/pg-admin?token=your-token</code></p>
      </body></html>
    `);
  }
  next();
};

router.use(pgAdminAuth);

// HTML UI
const htmlUI = (title: string, content: string, extraHead = '') => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — pg-admin</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; margin: 0; background: #f5f5f5; }
    .header { background: #1a1a2e; color: #eee; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { margin: 0; font-size: 1.2rem; }
    .header a { color: #4fc3f7; text-decoration: none; margin-left: 1rem; }
    .container { max-width: 1400px; margin: 0 auto; padding: 1rem; }
    .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1rem; overflow: hidden; }
    .card-header { background: #fafafa; border-bottom: 1px solid #eee; padding: 1rem; font-weight: 600; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #eee; white-space: nowrap; }
    th { background: #fafafa; font-weight: 600; cursor: pointer; user-select: none; }
    th:hover { background: #f0f0f0; }
    tr:hover td { background: #fafafa; }
    .null { color: #999; font-style: italic; }
    .bool { text-align: center; }
    .actions { white-space: nowrap; }
    .btn { padding: 0.25rem 0.5rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; margin-right: 0.25rem; }
    .btn-primary { background: #1976d2; color: white; }
    .btn-danger { background: #d32f2f; color: white; }
    .btn-secondary { background: #757575; color: white; }
    input, select, textarea { padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px; font-family: inherit; }
    textarea { min-height: 100px; width: 100%; font-family: monospace; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .pagination { display: flex; gap: 0.5rem; padding: 1rem; justify-content: center; }
    .pagination a, .pagination span { padding: 0.4rem 0.8rem; border: 1px solid #ddd; border-radius: 4px; text-decoration: none; color: #333; }
    .pagination .active { background: #1976d2; color: white; border-color: #1976d2; }
    .sql-editor { font-family: monospace; width: 100%; min-height: 150px; }
    .result-count { padding: 1rem; color: #666; font-size: 0.9rem; }
    .tabs { display: flex; border-bottom: 2px solid #eee; margin-bottom: 1rem; }
    .tab { padding: 0.75rem 1.5rem; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; }
    .tab.active { border-bottom-color: #1976d2; color: #1976d2; font-weight: 600; }
    .tab:hover { background: #f5f5f5; }
    .hidden { display: none; }
    .alert { padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
    .alert-error { background: #ffebee; color: #c62828; border: 1px solid #ef9a9a; }
    .alert-success { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
    .schema-info { font-size: 0.8rem; color: #666; margin-top: 0.5rem; }
  </style>
  ${extraHead}
</head>
<body>
  <div class="header">
    <h1>🐘 pg-admin <span style="font-weight: normal; opacity: 0.7;">${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'PostgreSQL'}</span></h1>
    <div>
      <a href="/pg-admin">📋 Tables</a>
      <a href="/pg-admin/query">🔍 Query</a>
      <a href="/pg-admin/schema">📐 Schema</a>
    </div>
  </div>
  <div class="container">${content}</div>
</body>
</html>
`;

// List all tables
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        (SELECT pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename))) as size,
        (SELECT obj_description(oid, 'pg_class') FROM pg_class WHERE relname = tablename AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = schemaname)) as comment
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    
    const tables = result.rows.map(r => ({
      name: r.tablename,
      schema: r.schemaname,
      size: r.size,
      comment: r.comment || ''
    }));
    
    res.send(htmlUI('Tables', `
      <div class="card">
        <div class="card-header">📋 Tables (${tables.length})</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Table</th><th>Schema</th><th>Size</th><th>Comment</th><th class="actions">Actions</th></tr></thead>
            <tbody>
              ${tables.map(t => `
                <tr>
                  <td><strong>${t.name}</strong></td>
                  <td>${t.schema}</td>
                  <td>${t.size}</td>
                  <td>${t.comment}</td>
                  <td class="actions">
                    <a href="/pg-admin/table/${encodeURIComponent(t.name)}" class="btn btn-primary">Browse</a>
                    <a href="/pg-admin/structure/${encodeURIComponent(t.name)}" class="btn btn-secondary">Structure</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `));
  } catch (err: any) {
    res.status(500).send(htmlUI('Error', `<div class="alert alert-error">${err.message}</div>`));
  }
});

// Table structure
router.get('/structure/:table', async (req: Request, res: Response) => {
  const table = req.params.table;
  try {
    const cols = await pool.query(`
      SELECT 
        column_name, data_type, is_nullable, column_default,
        character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);
    
    const indexes = await pool.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
    `, [table]);
    
    const fks = await pool.query(`
      SELECT 
        conname, 
        pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'f'
    `, [table]);
    
    res.send(htmlUI(`Structure: ${table}`, `
      <div class="card">
        <div class="card-header">📐 Columns</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Column</th><th>Type</th><th>Nullable</th><th>Default</th></tr></thead>
            <tbody>
              ${cols.rows.map((c, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td><strong>${c.column_name}</strong></td>
                  <td>${c.data_type}${c.character_maximum_length ? `(${c.character_maximum_length})` : ''}${c.numeric_precision ? `(${c.numeric_precision},${c.numeric_scale})` : ''}</td>
                  <td>${c.is_nullable === 'YES' ? '✓' : '✗'}</td>
                  <td>${c.column_default || '<span class="null">—</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header">🔑 Indexes</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Definition</th></tr></thead>
            <tbody>
              ${indexes.rows.map(i => `
                <tr><td>${i.indexname}</td><td><code>${i.indexdef}</code></td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header">🔗 Foreign Keys</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Definition</th></tr></thead>
            <tbody>
              ${fks.rows.map(f => `
                <tr><td>${f.conname}</td><td><code>${f.definition}</code></td></tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `));
  } catch (err: any) {
    res.status(500).send(htmlUI('Error', `<div class="alert alert-error">${err.message}</div>`));
  }
});

// Browse table data
router.get('/table/:table', async (req: Request, res: Response) => {
  const table = req.params.table as string;
  const pageStr = (Array.isArray(req.query.page) ? req.query.page[0] : req.query.page) as string || '1';
  const page = Math.max(1, parseInt(pageStr) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const searchRaw = (Array.isArray(req.query.search) ? req.query.search[0] : req.query.search) as string || '';
  const search = searchRaw;
  const whereClause = search ? `WHERE ${search}` : '';
  
  try {
    // Get total count
    const countResult = await pool.query(`SELECT COUNT(*) FROM "${table}" ${whereClause}`);
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);
    
    // Get columns
    const colsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);
    const columns = colsResult.rows.map(r => r.column_name);
    
    // Get data
    const dataResult = await pool.query(
      `SELECT * FROM "${table}" ${whereClause} ORDER BY 1 LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    
    res.send(htmlUI(`Browse: ${table}`, `
      <div class="card">
        <div class="card-header">
          📄 ${table} 
          <span style="font-weight: normal; margin-left: 1rem;">
            Showing ${offset + 1}–${Math.min(offset + limit, total)} of ${total} rows
          </span>
        </div>
        <form method="GET" style="padding: 1rem; display: flex; gap: 1rem; flex-wrap: wrap;">
          <input type="text" name="search" placeholder="WHERE clause (e.g. id > 100)" value="${search}" style="flex: 1; min-width: 200px;">
          <button type="submit" class="btn btn-primary">Filter</button>
          <a href="/pg-admin/table/${encodeURIComponent(table)}" class="btn btn-secondary">Clear</a>
        </form>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                ${columns.map(c => `<th>${c}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${dataResult.rows.map((row: any) => `
                <tr>
                  ${columns.map(c => {
                    const val = row[c];
                    if (val === null) return '<td class="null">NULL</td>';
                    if (typeof val === 'boolean') return `<td class="bool">${val ? '✓' : '✗'}</td>`;
                    if (typeof val === 'object') return `<td><pre style="margin:0; font-size:0.75rem;">${JSON.stringify(val)}</pre></td>`;
                    return `<td>${String(val).replace(/</g, '<').replace(/>/g, '>')}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${totalPages > 1 ? `
          <div class="pagination">
            ${page > 1 ? `<a href="?page=${page - 1}&search=${encodeURIComponent(search)}">« Prev</a>` : ''}
            ${Array.from({length: Math.min(5, totalPages)}, (_, i) => {
              const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
              return p <= totalPages ? `<a href="?page=${p}&search=${encodeURIComponent(search)}" class="${p === page ? 'active' : ''}">${p}</a>` : '';
            }).join('')}
            ${page < totalPages ? `<a href="?page=${page + 1}&search=${encodeURIComponent(search)}">Next »</a>` : ''}
          </div>
        ` : ''}
      </div>
    `));
  } catch (err: any) {
    res.status(500).send(htmlUI('Error', `<div class="alert alert-error">${err.message}</div>`));
  }
});

// SQL Query editor (GET)
router.get('/query', (req: Request, res: Response) => {
  const sql = (Array.isArray(req.query.sql) ? req.query.sql[0] : req.query.sql) as string || 'SELECT * FROM properties LIMIT 10;';
  res.send(htmlUI('Query Editor', `
    <div class="card">
      <div class="card-header">🔍 SQL Query</div>
      <form method="POST" action="/pg-admin/query/execute" style="padding: 1rem;">
        <textarea name="sql" class="sql-editor">${sql.replace(/</g, '<').replace(/>/g, '>')}</textarea>
        <div style="margin-top: 0.5rem; display: flex; gap: 1rem; align-items: center;">
          <button type="submit" class="btn btn-primary">Execute (Ctrl+Enter)</button>
          <label><input type="checkbox" name="explain" ${req.query.explain ? 'checked' : ''}> EXPLAIN ANALYZE</label>
          <span style="font-size: 0.8rem; color: #666;">Tip: Use semicolon to separate multiple statements</span>
        </div>
      </form>
    </div>
    <script>
      document.querySelector('textarea').addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.target.form.requestSubmit();
        }
      });
    </script>
  `));
});

// Execute query (POST)
router.post('/query/execute', async (req: Request, res: Response) => {
  const sql = (Array.isArray(req.body.sql) ? req.body.sql[0] : req.body.sql) as string;
  const explain = req.body.explain === 'true' || req.body.explain === 'on';
  
  if (!sql) {
    return res.redirect('/pg-admin/query');
  }
  
  const statements = sql.split(';').map((s: string) => s.trim()).filter((s: string) => s);
  let output = '';
  let hasResults = false;
  
  for (const stmt of statements) {
    const start = Date.now();
    try {
      const execSql = explain ? `EXPLAIN ANALYZE ${stmt}` : stmt;
      const result = await pool.query(execSql);
      const duration = Date.now() - start;
      const rowCount = result.rowCount ?? 0;
      
      if (result.rows && result.rows.length > 0) {
        hasResults = true;
        const columns = Object.keys(result.rows[0]);
        output += `
          <div class="card">
            <div class="card-header">
              Query executed in ${duration}ms (${rowCount} rows)
              <span style="float: right; font-weight: normal; font-size: 0.8rem; opacity: 0.7;">
                <code>${stmt.substring(0, 80)}${stmt.length > 80 ? '…' : ''}</code>
              </span>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
                <tbody>
                  ${result.rows.slice(0, 100).map((row: any) => `
                    <tr>${columns.map(c => {
                      const val = row[c];
                      if (val === null) return '<td class="null">NULL</td>';
                      if (typeof val === 'boolean') return `<td class="bool">${val ? '✓' : '✗'}</td>`;
                      if (typeof val === 'object') return `<td><pre style="margin:0; font-size:0.7rem;">${JSON.stringify(val)}</pre></td>`;
                      return `<td>${String(val).replace(/</g, '<').replace(/>/g, '>')}</td>`;
                    }).join('')}</tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ${(result.rowCount ?? 0) > 100 ? `<div class="result-count">Showing 100 of ${result.rowCount} rows</div>` : ''}
          </div>
        `;
      } else if (result.rowCount !== undefined) {
        output += `
          <div class="alert alert-success">
            ✓ Query OK — ${result.rowCount} row(s) affected (${duration}ms)
            <br><code>${stmt}</code>
          </div>
        `;
      }
    } catch (err: any) {
      output += `
        <div class="alert alert-error">
          ✗ Error: ${err.message}
          <br><code>${stmt}</code>
        </div>
      `;
      break;
    }
  }
  
  if (!hasResults && !output) {
    output = '<div class="alert alert-success">✓ Query executed successfully (no results returned)</div>';
  }
  
  res.send(htmlUI('Query Results', output, `
    <script>
      document.querySelector('textarea')?.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.target.form.requestSubmit();
        }
      });
    </script>
  `));
});

// Schema overview
router.get('/schema', async (req: Request, res: Response) => {
  try {
    const tables = await pool.query(`
      SELECT 
        t.tablename,
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.tablename) as col_count,
        (SELECT pg_size_pretty(pg_total_relation_size('public.' || t.tablename))) as size
      FROM pg_tables t
      WHERE t.schemaname = 'public'
      ORDER BY t.tablename
    `);
    
    const enums = await pool.query(`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) as values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public'
      GROUP BY t.typname
      ORDER BY t.typname
    `);
    
    res.send(htmlUI('Schema Overview', `
      <div class="card">
        <div class="card-header">📊 Tables (${tables.rows.length})</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Table</th><th>Columns</th><th>Size</th></tr></thead>
            <tbody>
              ${tables.rows.map(t => `
                <tr>
                  <td><a href="/pg-admin/table/${encodeURIComponent(t.tablename)}">${t.tablename}</a></td>
                  <td>${t.col_count}</td>
                  <td>${t.size}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header">🎯 Enums (${enums.rows.length})</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Values</th></tr></thead>
            <tbody>
              ${enums.rows.map(e => `
                <tr>
                  <td>${e.typname}</td>
                  <td>${e.values.map((v: string) => `<code>${v}</code>`).join(', ')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `));
  } catch (err: any) {
    res.status(500).send(htmlUI('Error', `<div class="alert alert-error">${err.message}</div>`));
  }
});

// Logs viewer
router.get('/logs', async (req: Request, res: Response) => {
  const logDir = path.join(process.cwd(), 'logs');
  const type = (req.query.type as string) || 'backend';
  const lines = Math.min(parseInt((req.query.lines as string) || '200'), 2000);
  const file = type === 'frontend' ? 'latest-frontend.log' : 'latest-backend.log';
  const filePath = path.join(logDir, file);
  
  let content = '';
  let error = '';
  
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024)); // max 1MB
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, stat.size - buffer.length));
      fs.closeSync(fd);
      
      const allLines = buffer.toString('utf8').split('\n').filter(l => l.trim());
      content = allLines.slice(-lines).join('\n');
    } else {
      error = `Log file not found: ${filePath}`;
    }
  } catch (err: any) {
    error = err.message;
  }
  
  // List available log files
  let logFiles: string[] = [];
  try {
    logFiles = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();
  } catch {}
  
  res.send(htmlUI('Logs', `
    <div class="card">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <span>📜 ${type} logs (last ${lines} lines)</span>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <a href="/pg-admin/logs?type=backend&lines=${lines}" class="btn ${type === 'backend' ? 'btn-primary' : 'btn-secondary'}">Backend</a>
          <a href="/pg-admin/logs?type=frontend&lines=${lines}" class="btn ${type === 'frontend' ? 'btn-primary' : 'btn-secondary'}">Frontend</a>
          <form method="GET" style="display: flex; gap: 0.5rem; align-items: center;">
            <input type="hidden" name="type" value="${type}">
            <input type="number" name="lines" value="${lines}" min="50" max="2000" step="50" style="width: 80px;">
            <button type="submit" class="btn btn-secondary">Reload</button>
          </form>
          <a href="/pg-admin/logs/files" class="btn btn-secondary">📁 All Files</a>
        </div>
      </div>
      <pre style="margin: 0; padding: 1rem; background: #1e1e1e; color: #d4d4d4; font-size: 0.75rem; line-height: 1.5; overflow-x: auto; max-height: 70vh; white-space: pre-wrap;">${error ? `<span style="color: #f44336;">${error}</span>` : content.replace(/</g, '<').replace(/>/g, '>')}</pre>
      ${error ? '' : `<div class="result-count">Showing last ${lines} lines of ${file} (${logFiles.length} log files available)</div>`}
    </div>
  `));
});

// List all log files
router.get('/logs/files', async (req: Request, res: Response) => {
  const logDir = path.join(process.cwd(), 'logs');
  
  let files: { name: string; size: string; mtime: string }[] = [];
  try {
    const entries = fs.readdirSync(logDir);
    for (const name of entries) {
      const filePath = path.join(logDir, name);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && name.endsWith('.log')) {
        files.push({
          name,
          size: (stat.size / 1024).toFixed(1) + ' KB',
          mtime: stat.mtime.toISOString().replace('T', ' ').substring(0, 19)
        });
      }
    }
    files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch (err: any) {
    return res.status(500).send(htmlUI('Error', `<div class="alert alert-error">${err.message}</div>`));
  }
  
  res.send(htmlUI('Log Files', `
    <div class="card">
      <div class="card-header">📁 Log Files (${files.length})</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>File</th><th>Size</th><th>Modified</th><th>Actions</th></tr></thead>
          <tbody>
            ${files.map(f => `
              <tr>
                <td><code>${f.name}</code></td>
                <td>${f.size}</td>
                <td>${f.mtime}</td>
                <td class="actions">
                  <a href="/pg-admin/logs?type=${f.name.includes('frontend') ? 'frontend' : 'backend'}&lines=200" class="btn btn-primary">View</a>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `));
});

export default router;