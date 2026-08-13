import mysql from 'mysql2/promise';
import { Pool, PoolClient } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const mysqlConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'draft_rndhms',
};

const CHUNK_SIZE = 500;

// Time-only regex: HH:MM:SS or HH:MM
const TIME_ONLY_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

const getTables = async (mysqlConn: any): Promise<string[]> => {
  const [rows]: any = await mysqlConn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
    [mysqlConfig.database]
  );
  return rows.map((r: any) => r.TABLE_NAME);
};

// Get column names + types from MySQL schema
const getColumnInfo = async (
  mysqlConn: any,
  tableName: string
): Promise<{ name: string; type: string }[]> => {
  const [cols]: any = await mysqlConn.query(
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [mysqlConfig.database, tableName]
  );
  return cols.map((c: any) => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE }));
};

// Coerce MySQL value to PostgreSQL-compatible format
const coerceValue = (value: any, mysqlType: string): any => {
  if (value === null || value === undefined) return null;

  // Catch invalid Date objects (NaN time)
  if (value instanceof Date && isNaN(value.getTime())) return null;

  // Catch "0000-00-00" zero dates / invalid dates
  if (typeof value === 'string' && (value === '0000-00-00' || value.startsWith('0000-00-00'))) return null;

  // MySQL time type → convert to full timestamp (1970-01-01 HH:MM:SS)
  // Prisma maps MySQL time → DateTime, but time-only strings fail on PG TIMESTAMP
  if (mysqlType === 'time') {
    if (typeof value === 'string' && TIME_ONLY_RE.test(value)) {
      return `1970-01-01 ${value}`;
    }
    return value;
  }

  // Time-only strings on datetime/timestamp columns → prefix with epoch date
  if (
    (mysqlType === 'datetime' || mysqlType === 'timestamp' || mysqlType === 'date') &&
    typeof value === 'string' &&
    TIME_ONLY_RE.test(value)
  ) {
    return `1970-01-01 ${value}`;
  }

  // MySQL JSON type → pass through (pg handles JSON strings)
  if (mysqlType === 'json') {
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  }

  // MySQL tinyint columns → PostgreSQL may map to Boolean or Int
  // Boolean accepts 0/1 but not 2+. Coerce >1 to 1 for safety.
  if (mysqlType === 'tinyint') {
    const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!isNaN(n)) return n > 0 ? 1 : 0;
    return value;
  }

  // MySQL tinyint(1) comes as Buffer in some versions
  if (Buffer.isBuffer(value)) {
    return parseInt(value.toString(), 10);
  }

  return value;
};

const migrateTable = async (
  mysqlConn: any,
  pgClient: PoolClient,
  tableName: string
): Promise<number> => {
  try {
    const colInfo = await getColumnInfo(mysqlConn, tableName);
    const columns = colInfo.map(c => c.name);
    const types = colInfo.map(c => c.type);

    const [rows]: any = await mysqlConn.query(`SELECT * FROM \`${tableName}\``);

    if (rows.length === 0) {
      console.log(`  ✓ ${tableName}: 0 rows (empty)`);
      return 0;
    }

    const columnNames = columns.map(c => `"${c}"`).join(', ');
    const totalRows = rows.length;
    let migrated = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);

      const allValues: any[] = [];
      const valueGroups: string[] = [];
      let paramIdx = 1;

      for (const row of chunk) {
        const placeholders = columns.map(() => `$${paramIdx++}`).join(', ');
        valueGroups.push(`(${placeholders})`);
        for (let c = 0; c < columns.length; c++) {
          allValues.push(coerceValue(row[columns[c]], types[c]));
        }
      }

      const sql = `INSERT INTO "${tableName}" (${columnNames}) VALUES ${valueGroups.join(', ')}`;

      try {
        await pgClient.query(sql, allValues);
        migrated += chunk.length;
      } catch (e: any) {
        // Batch failed — fall back row-by-row for this chunk
        for (const row of chunk) {
          const rowValues: any[] = [];
          const phs: string[] = [];
          for (let c = 0; c < columns.length; c++) {
            phs.push(`$${c + 1}`);
            rowValues.push(coerceValue(row[columns[c]], types[c]));
          }
          const rowSql = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${phs.join(', ')})`;
          try {
            await pgClient.query(rowSql, rowValues);
            migrated++;
          } catch (rowErr: any) {
            if (rowErr.code === '23505') {
              // skip duplicates silently (common on resync — logging 100k+ rows is too slow)
            } else if (rowErr.code === '23502') {
              console.error(`  ! ${tableName} row ${row.id} skipped: ${rowErr.code} ${(rowErr.message || '').split('\n')[0]}`);
            } else {
              throw rowErr;
            }
          }
        }
      }
    }

    const status = migrated === totalRows ? '✓' : migrated > 0 ? '⚠' : '✗';
    console.log(`  ${status} ${tableName}: ${migrated}/${totalRows} rows migrated`);
    return migrated;
  } catch (error: any) {
    console.error(`  ✗ ${tableName}: ${error.message}`);
    return 0;
  }
};

const main = async () => {
  console.log('Starting data migration from MySQL to PostgreSQL...\n');

  const tableFilter = process.argv.find(a => a.startsWith('--table='))?.split('=')[1];

  const mysqlConn = await mysql.createConnection(mysqlConfig);
  const pgClient = await pgPool.connect();

  try {
    // Disable FK constraints on this connection
    await pgClient.query("SET session_replication_role = 'replica'");
    console.log('Foreign key checks disabled (single persistent connection)\n');

    const tables = await getTables(mysqlConn);
    console.log(`Found ${tables.length} tables to migrate\n`);

    let totalRows = 0;

    for (const table of tables) {
      if (tableFilter && table !== tableFilter) continue;
      const rowCount = await migrateTable(mysqlConn, pgClient, table);
      totalRows += rowCount;
    }

    await pgClient.query("SET session_replication_role = 'origin'");
    console.log(`\n✓ Migration complete: ${totalRows} total rows migrated`);
  } finally {
    await mysqlConn.end();
    pgClient.release();
    await pgPool.end();
  }
};

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
