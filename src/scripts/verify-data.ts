import mysql from 'mysql2/promise';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mysqlConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'draft_rndhms',
};

const getTables = async (connection: any): Promise<string[]> => {
  const [rows]: any = await connection.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
    [mysqlConfig.database]
  );
  return rows.map((row: any) => row.TABLE_NAME);
};

const verifyTable = async (
  mysqlConn: any,
  tableName: string
): Promise<{ table: string; mysql: number; postgres: number; match: boolean }> => {
  try {
    // Get count from MySQL
    const [mysqlRows]: any = await mysqlConn.query(
      `SELECT COUNT(*) as count FROM \`${tableName}\``
    );
    const mysqlCount = mysqlRows[0].count;

    // Get count from PostgreSQL
    const postgresResult: any = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM "${tableName}"`
    );
    const postgresCount = parseInt(postgresResult[0].count);

    const match = mysqlCount === postgresCount;

    return {
      table: tableName,
      mysql: mysqlCount,
      postgres: postgresCount,
      match,
    };
  } catch (error: any) {
    console.error(`Error verifying ${tableName}: ${error.message}`);
    return {
      table: tableName,
      mysql: -1,
      postgres: -1,
      match: false,
    };
  }
};

const main = async () => {
  console.log('Verifying data migration integrity...\n');

  const mysqlConn = await mysql.createConnection(mysqlConfig);

  try {
    const tables = await getTables(mysqlConn);
    const results = [];
    let allMatch = true;

    for (const table of tables) {
      const result = await verifyTable(mysqlConn, table);
      results.push(result);
      if (!result.match) allMatch = false;

      const status = result.match ? '✓' : '✗';
      console.log(
        `${status} ${result.table.padEnd(30)} MySQL: ${result.mysql
          .toString()
          .padStart(6)} → PostgreSQL: ${result.postgres.toString().padStart(6)}`
      );
    }

    console.log('\n' + '='.repeat(70));

    if (allMatch) {
      console.log('✓ All tables verified successfully!');
    } else {
      const mismatches = results.filter(r => !r.match).length;
      console.log(
        `✗ Found ${mismatches}/${tables.length} table(s) with mismatched row counts`
      );
      process.exit(1);
    }
  } finally {
    await mysqlConn.end();
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
