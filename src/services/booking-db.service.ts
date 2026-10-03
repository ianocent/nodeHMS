import mysql from 'mysql2/promise';

// Laravel parity: config/database.php:66 `hmsbooking` connection. The reference
// reads and writes the guest-loyalty tables straight from the Booking Engine's
// MySQL database instead of pushing them over HTTP:
//
//   App\Models\HmsBooking\LoyaltyReward          -> loyalty_rewards
//   App\Models\HmsBooking\RewardRedemption       -> reward_redemptions
//   App\Models\HmsBooking\GuestPointTransaction  -> guest_point_transactions
//   App\Models\HmsBooking\HmsBookingUser         -> users
//
// Env names/defaults copied verbatim from the reference config so the same values
// work in both stacks.
let pool: mysql.Pool | null = null;
let poolKey = '';

export type BookingDbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export function bookingDbConfig(): BookingDbConfig {
  return {
    host: process.env.DB_HMSBOOK_HOST || '127.0.0.1',
    port: Number(process.env.DB_HMSBOOK_PORT || 3306),
    database: process.env.DB_HMSBOOK_DATABASE || 'draft_hmsbooking',
    user: process.env.DB_HMSBOOK_USERNAME || 'user_rndhms',
    password: process.env.DB_HMSBOOK_PASSWORD || '',
  };
}

export function isBookingDbConfigured(): boolean {
  return Boolean(process.env.DB_HMSBOOK_DATABASE || process.env.DB_HMSBOOK_USERNAME);
}

function getPool(): mysql.Pool {
  const cfg = bookingDbConfig();
  const key = `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  if (!pool || poolKey !== key) {
    if (pool) pool.end().catch(() => undefined);
    pool = mysql.createPool({
      ...cfg,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_HMSBOOK_POOL_SIZE || 5),
      charset: 'utf8mb4',
      // Mirrors the reference connection: strict mode off.
      decimalNumbers: true,
      dateStrings: false,
      multipleStatements: false,
    });
    poolKey = key;
  }
  return pool;
}

export async function bookingQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await getPool().query(sql, params);
  return rows as T[];
}

export async function bookingExecute(sql: string, params: any[] = []): Promise<any> {
  const [result] = await getPool().query(sql, params);
  return result;
}

/**
 * Escaped LIKE fragment. The reference passes the raw search term into
 * `where('name','like','%'.$term.'%')`; callers here build the pattern through
 * this helper so the term cannot inject SQL.
 */
export function likePattern(term: string): string {
  return `%${String(term).replace(/([\\%_])/g, '\\$1')}%`;
}

export async function closeBookingDb(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
    poolKey = '';
  }
}