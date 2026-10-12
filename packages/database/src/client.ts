import pg from 'pg';

const { Pool } = pg;
let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, keepAlive: true });
    // pg-pool emits errors from idle clients on the Pool itself. Without a listener,
    // transient network resets become uncaught EventEmitter errors and terminate the API.
    pool.on('error', error => console.error('Idle PostgreSQL connection failed:', 'code' in error ? error.code : 'unknown'));
  }
  return pool;
}

export async function checkDatabase(): Promise<void> {
  await getPool().query('SELECT 1');
}
