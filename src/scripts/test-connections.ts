import mysql from 'mysql2/promise';
import { Pool } from 'pg';

async function testConnections() {
  console.log('Testing database connections...\n');

  // Test MySQL
  console.log('1. Testing MySQL (Laragon)...');
  try {
    const mysqlConn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'draft_rndhms',
    });
    const [result]: any = await mysqlConn.query('SELECT VERSION()');
    console.log(`   ✓ MySQL connected: ${result[0]['VERSION()']}`);
    const [tables]: any = await mysqlConn.query(
      "SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'draft_rndhms'"
    );
    console.log(`   ✓ Found ${tables[0].count} tables\n`);
    await mysqlConn.end();
  } catch (error: any) {
    console.error(`   ✗ MySQL connection failed: ${error.message}\n`);
    process.exit(1);
  }

  // Test PostgreSQL
  console.log('2. Testing PostgreSQL (Laragon)...');
  try {
    const pool = new Pool({
      host: 'localhost',
      port: 5432,
      database: 'hms_anyaman',
      user: 'postgres',
      password: '',
    });
    const result = await pool.query('SELECT version()');
    console.log(`   ✓ PostgreSQL connected: ${result.rows[0].version}`);
    const tableResult = await pool.query(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    );
    console.log(`   ✓ Found ${tableResult.rows[0].count} tables in public schema\n`);
    await pool.end();
  } catch (error: any) {
    console.error(`   ✗ PostgreSQL connection failed: ${error.message}\n`);
    console.log('   Tip: Ensure PostgreSQL is running on Laragon');
    process.exit(1);
  }

  console.log('✓ All database connections successful!');
}

testConnections().catch((error) => {
  console.error('Connection test failed:', error);
  process.exit(1);
});
