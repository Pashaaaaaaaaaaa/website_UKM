import 'dotenv/config';
import { getPool } from '../../database/src/client.ts';
import { expirePendingBookings } from './booking-service.ts';

const pool = getPool();
try {
  const total = await expirePendingBookings(pool, Number(process.env.BOOKING_EXPIRY_BATCH_SIZE ?? 500));
  console.log(`Expired ${total} pending booking(s).`);
} finally { await pool.end(); }
