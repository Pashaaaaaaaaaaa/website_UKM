import pg from 'pg';

const { Pool } = pg;
let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 });
  return pool;
}

export async function checkDatabase(): Promise<void> {
  await getPool().query('SELECT 1');
}
