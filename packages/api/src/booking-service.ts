import type pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { dateRange, rentalDays, type CreateBookingInput, type RentalDomain } from '../../domain/src/booking.ts';
import type { AdminRole } from './auth.ts';

const MAX_RETRIES = 3;

export class BookingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; this.name = 'BookingError'; }
}

export interface BookingServiceOptions {
  now?: () => Date;
  allowPastDates?: boolean;
  maxRentalDays?: number;
}
export interface BookingPrincipal { id: string; role: AdminRole; ip?: string }
interface ResourceRow extends QueryResultRow { id: string; name: string; is_active: boolean; price: string; total_quantity?: number }
interface ActiveCountRow extends QueryResultRow { date: string; reserved_quantity: number | string }

function dayIso(now: Date): string { return now.toISOString().slice(0, 10); }
function priceToCents(value: string | number): bigint {
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Database returned a non-currency price');
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
}
function centsToSql(value: bigint): string { return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; }
function sqlState(error: unknown): string | undefined { return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined; }

async function transaction<T>(pool: pg.Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (attempt < MAX_RETRIES && ['40001', '40P01'].includes(sqlState(error) ?? '')) continue;
      throw error;
    } finally { client.release(); }
  }
}

export async function expirePendingBookings(pool: pg.Pool, batchSize = Number(process.env.BOOKING_EXPIRY_BATCH_SIZE ?? 500)): Promise<number> {
  const safeBatch = Number.isInteger(batchSize) ? Math.max(1,Math.min(batchSize,5000)) : 500;
  const result = await pool.query('SELECT booking_code FROM expire_pending_bookings($1)', [safeBatch]);
  return result.rowCount ?? result.rows.length;
}

async function expireDue(pool: pg.Pool): Promise<void> {
  while (await expirePendingBookings(pool,500) === 500) { /* commit due states independently of a subsequent business operation */ }
}

export function startBookingExpiryWorker(pool: pg.Pool, intervalMs = Number(process.env.BOOKING_EXPIRY_INTERVAL_MS ?? 60_000)): NodeJS.Timeout {
  const run = () => { void expirePendingBookings(pool).catch(() => console.error('Booking expiry worker failed')); };
  run();
  const safeInterval = Number.isFinite(intervalMs) ? Math.max(5_000,intervalMs) : 60_000;
  const timer = setInterval(run, safeInterval);
  timer.unref();
  return timer;
}

function assertBookingDates(input: CreateBookingInput, options: BookingServiceOptions): number {
  let days: number;
  try { days = rentalDays(input.start_date, input.end_date); }
  catch { throw new BookingError(400, 'INVALID_DATE_RANGE', 'end_date must be on or after start_date.'); }
  const configuredMax=Number(process.env.BOOKING_MAX_RENTAL_DAYS ?? 366);
  const maxDays=options.maxRentalDays ?? (Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : 366);
  if (days > maxDays) throw new BookingError(400, 'RENTAL_TOO_LONG', `A rental cannot exceed ${maxDays} days.`);
  const allowPast = options.allowPastDates ?? process.env.BOOKING_ALLOW_PAST_DATES === 'true';
  if (!allowPast && input.start_date < dayIso(options.now?.() ?? new Date())) {
    throw new BookingError(400, 'PAST_DATES_NOT_ALLOWED', 'start_date cannot be in the past.');
  }
  return days;
}

async function allocateBookingCode(client: PoolClient): Promise<string> {
  const result = await client.query<{ ymd: string; last_value: string }>(`
    WITH booking_day AS (SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date AS day)
    INSERT INTO booking_code_sequences(booking_date,last_value)
    SELECT day,1 FROM booking_day
    ON CONFLICT(booking_date) DO UPDATE SET last_value=booking_code_sequences.last_value+1
    RETURNING to_char(booking_date,'YYYYMMDD') AS ymd,last_value`, []);
  const row = result.rows[0]!;
  return `BK-${row.ymd}-${String(row.last_value).padStart(4, '0')}`;
}

async function getLockedResources(client: PoolClient, input: CreateBookingInput): Promise<Map<string, ResourceRow>> {
  const ids = input.items.map(line => input.domain === 'DANCE' ? line.service_id! : line.item_id!).sort();
  const resources = new Map<string, ResourceRow>();
  for (const id of ids) {
    const result = input.domain === 'DANCE'
      ? await client.query<ResourceRow>('SELECT id,name,is_active,price_per_performance::text AS price FROM dance_services WHERE id=$1 FOR UPDATE', [id])
      : await client.query<ResourceRow>('SELECT id,name,is_active,price_per_unit_per_day::text AS price,total_quantity FROM inventory_items WHERE id=$1 FOR UPDATE', [id]);
    const resource = result.rows[0];
    if (!resource) throw new BookingError(404, 'RESOURCE_NOT_FOUND', 'A requested rental resource was not found.');
    if (!resource.is_active) throw new BookingError(409, 'RESOURCE_UNAVAILABLE', 'A requested rental resource is not available.');
    resources.set(id, resource);
  }
  return resources;
}

async function assertResourcesAvailable(client: PoolClient, input: CreateBookingInput, resources: Map<string, ResourceRow>): Promise<void> {
  for (const line of input.items) {
    const id = input.domain === 'DANCE' ? line.service_id! : line.item_id!;
    if (input.domain === 'DANCE') {
      const conflict = await client.query(`SELECT 1 FROM booking_items i JOIN bookings b ON b.id=i.booking_id
        WHERE i.service_id=$1 AND b.status IN ('PENDING_PAYMENT','CONFIRMED')
          AND (b.status='CONFIRMED' OR b.expires_at>clock_timestamp())
          AND b.start_date <= $3::date AND b.end_date >= $2::date LIMIT 1`, [id,input.start_date,input.end_date]);
      if (conflict.rowCount) throw new BookingError(409, 'DANCE_DATE_UNAVAILABLE', 'The dance service is already reserved for one or more requested dates.');
      continue;
    }
    const dates = await client.query<ActiveCountRow>(`SELECT days.day::date::text AS date,
      COALESCE(sum(i.quantity),0) AS reserved_quantity
      FROM generate_series($1::date,$2::date,interval '1 day') AS days(day)
      LEFT JOIN bookings b ON b.rental_domain='BRT' AND b.start_date<=days.day::date AND b.end_date>=days.day::date
        AND (b.status='CONFIRMED' OR (b.status='PENDING_PAYMENT' AND b.expires_at>clock_timestamp()))
      LEFT JOIN booking_items i ON i.booking_id=b.id AND i.item_id=$3
      GROUP BY days.day ORDER BY days.day`, [input.start_date,input.end_date,id]);
    const capacity = Number(resources.get(id)!.total_quantity);
    const shortage = dates.rows.find(day => Number(day.reserved_quantity) + line.quantity > capacity);
    if (shortage) throw new BookingError(409, 'INSUFFICIENT_INVENTORY', `Insufficient inventory on ${shortage.date}.`);
  }
}

export interface CreatedBooking {
  booking_code: string;
  customer_name: string;
  domain: RentalDomain;
  status: 'PENDING_PAYMENT';
  payment_status: 'UNPAID';
  start_date: string;
  end_date: string;
  rental_days: number;
  total_amount: number;
  expires_at: string;
  items: Array<{ resource_id: string; name: string; quantity: number; unit_price_snapshot: number; subtotal: number }>;
}

export async function createBooking(pool: pg.Pool, input: CreateBookingInput, options: BookingServiceOptions = {}): Promise<CreatedBooking> {
  const days = assertBookingDates(input, options);
  await expireDue(pool);
  return transaction(pool, async client => {
    const resources = await getLockedResources(client, input);
    await assertResourcesAvailable(client, input, resources);

    const code = await allocateBookingCode(client);
    const created = await client.query<{ id: string; expires_at: Date }>(`WITH clock AS (SELECT clock_timestamp() AS created_at)
      INSERT INTO bookings(booking_code,customer_name,customer_phone,customer_email,rental_domain,start_date,end_date,notes,
        status,payment_status,created_at,updated_at,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,'PENDING_PAYMENT','UNPAID',clock.created_at,clock.created_at,
        clock.created_at + interval '24 hours' FROM clock RETURNING id,expires_at`,
    [code,input.customer_name,input.customer_phone,input.customer_email ?? null,input.domain,input.start_date,input.end_date,input.notes ?? null]);
    const bookingId = created.rows[0]!.id;
    let totalCents = 0n;
    const createdItems: CreatedBooking['items'] = [];
    for (const line of input.items) {
      const id = input.domain === 'DANCE' ? line.service_id! : line.item_id!;
      const unitCents = priceToCents(resources.get(id)!.price);
      const subtotalCents = unitCents * BigInt(line.quantity) * BigInt(days);
      totalCents += subtotalCents;
      const maxDatabaseCents = 99_999_999_999_999n;
      if (subtotalCents > maxDatabaseCents || totalCents > maxDatabaseCents) {
        throw new BookingError(400, 'PRICE_TOTAL_TOO_LARGE', 'The calculated booking total exceeds the supported payment amount.');
      }
      createdItems.push({ resource_id: id, name: resources.get(id)!.name, quantity: line.quantity, unit_price_snapshot: Number(unitCents) / 100, subtotal: Number(subtotalCents) / 100 });
      await client.query(`INSERT INTO booking_items(booking_id,service_id,item_id,quantity,unit_price_snapshot,rental_days,subtotal)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [bookingId,input.domain === 'DANCE' ? id : null,input.domain === 'BRT' ? id : null,
        line.quantity,centsToSql(unitCents),days,centsToSql(subtotalCents)]);
    }
    await client.query('UPDATE bookings SET total_amount=$2,updated_at=clock_timestamp() WHERE id=$1',[bookingId,centsToSql(totalCents)]);
    return {
      booking_code: code, customer_name: input.customer_name, domain: input.domain, status: 'PENDING_PAYMENT', payment_status: 'UNPAID',
      start_date: input.start_date, end_date: input.end_date, rental_days: days,
      total_amount: Number(totalCents) / 100, expires_at: created.rows[0]!.expires_at.toISOString(), items: createdItems,
    };
  });
}

export interface DayAvailability {
  date: string;
  available: boolean;
  total_quantity?: number;
  reserved_quantity?: number;
  available_quantity?: number;
}

export async function getAvailability(pool: pg.Pool, domain: RentalDomain, id: string, startDate: string, endDate: string): Promise<{ resource_id: string; domain: RentalDomain; dates: DayAvailability[] }> {
  await expireDue(pool);
  return transaction(pool, async client => {
    const result = domain === 'DANCE'
      ? await client.query<ResourceRow>('SELECT id,is_active,price_per_performance::text AS price FROM dance_services WHERE id=$1',[id])
      : await client.query<ResourceRow>('SELECT id,is_active,price_per_unit_per_day::text AS price,total_quantity FROM inventory_items WHERE id=$1',[id]);
    const resource = result.rows[0];
    if (!resource || !resource.is_active) throw new BookingError(404,'RESOURCE_NOT_FOUND','Rental resource was not found.');
    const days = dateRange(startDate,endDate);
    let dates: DayAvailability[];
    if (domain === 'DANCE') {
      const reserved = await client.query<{ start_date: string; end_date: string }>(`SELECT b.start_date::text,b.end_date::text
        FROM bookings b JOIN booking_items i ON i.booking_id=b.id
        WHERE i.service_id=$1 AND (b.status='CONFIRMED' OR (b.status='PENDING_PAYMENT' AND b.expires_at>clock_timestamp()))
          AND b.start_date <= $3::date AND b.end_date >= $2::date`,[id,startDate,endDate]);
      dates = days.map(date => ({ date, available: !reserved.rows.some(row => row.start_date <= date && row.end_date >= date) }));
    } else {
      const counts = await client.query<ActiveCountRow>(`SELECT days.day::date::text AS date,COALESCE(sum(i.quantity),0) AS reserved_quantity
        FROM generate_series($1::date,$2::date,interval '1 day') AS days(day)
        LEFT JOIN bookings b ON b.rental_domain='BRT' AND b.start_date<=days.day::date AND b.end_date>=days.day::date
          AND (b.status='CONFIRMED' OR (b.status='PENDING_PAYMENT' AND b.expires_at>clock_timestamp()))
        LEFT JOIN booking_items i ON i.booking_id=b.id AND i.item_id=$3
        GROUP BY days.day ORDER BY days.day`,[startDate,endDate,id]);
      const total = Number(resource.total_quantity);
      dates = counts.rows.map(row => {
        const reserved = Number(row.reserved_quantity);
        const available = Math.max(0,total-reserved);
        return { date: row.date, available: available > 0, total_quantity: total, reserved_quantity: reserved, available_quantity: available };
      });
    }
    return { resource_id: id, domain, dates };
  });
}

export interface BookingFilter { domain: RentalDomain; status?: 'PENDING_PAYMENT'|'CONFIRMED'|'EXPIRED'; start_date?: string; end_date?: string; limit: number; offset: number }
const bookingSelect = `SELECT b.booking_code,b.customer_name,b.customer_phone,b.customer_email,b.rental_domain AS domain,
  b.start_date::text,b.end_date::text,b.notes,b.status,b.payment_status,b.total_amount::text,b.expires_at,
  b.payment_confirmed_at,b.created_at,b.updated_at FROM bookings b`;

export async function listBookings(pool: pg.Pool, filter: BookingFilter) {
  await expireDue(pool);
  return transaction(pool, async client => {
    const result = await client.query(`${bookingSelect} WHERE b.rental_domain=$1
      AND ($2::text IS NULL OR b.status=$2) AND ($3::date IS NULL OR b.end_date >= $3)
      AND ($4::date IS NULL OR b.start_date <= $4) ORDER BY b.created_at DESC LIMIT $5 OFFSET $6`,
    [filter.domain,filter.status ?? null,filter.start_date ?? null,filter.end_date ?? null,filter.limit,filter.offset]);
    return result.rows;
  });
}

export async function getBooking(pool: pg.Pool, code: string, domain: RentalDomain) {
  await expireDue(pool);
  return transaction(pool, async client => {
    const result = await client.query(`${bookingSelect} WHERE b.booking_code=$1 AND b.rental_domain=$2`,[code,domain]);
    if (!result.rows[0]) throw new BookingError(404,'BOOKING_NOT_FOUND','Booking was not found.');
    const lines = await client.query(`SELECT bi.service_id,bi.item_id,bi.quantity,bi.unit_price_snapshot::text,
      bi.rental_days,bi.subtotal::text,COALESCE(ds.name,ii.name) AS resource_name
      FROM booking_items bi LEFT JOIN dance_services ds ON ds.id=bi.service_id LEFT JOIN inventory_items ii ON ii.id=bi.item_id
      WHERE bi.booking_id=(SELECT id FROM bookings WHERE booking_code=$1) ORDER BY bi.id`,[code]);
    return { ...result.rows[0], items: lines.rows };
  });
}

export async function confirmBookingPayment(pool: pg.Pool, code: string, actor: BookingPrincipal) {
  await expireDue(pool);
  const result = await transaction(pool, async client => {
    const found = await client.query<{ id: string; booking_code: string; domain: RentalDomain; status: string; hold_active: boolean }>(
      'SELECT id,booking_code,rental_domain AS domain,status,expires_at>clock_timestamp() AS hold_active FROM bookings WHERE booking_code=$1 FOR UPDATE',[code]);
    const booking = found.rows[0];
    if (!booking) throw new BookingError(404,'BOOKING_NOT_FOUND','Booking was not found.');
    const requiredRole = booking.domain === 'DANCE' ? 'MANAGER' : 'BRT_ADMIN';
    if (actor.role !== requiredRole) throw new BookingError(403,'FORBIDDEN','You cannot confirm payment for this rental domain.');
    if (booking.status === 'CONFIRMED') return { booking_code: code, status: 'CONFIRMED' as const, already_confirmed: true };
    if (booking.status === 'EXPIRED') return { conflict: new BookingError(409,'BOOKING_EXPIRED','The payment hold has expired.') };
    if (!booking.hold_active) {
      await client.query("SELECT set_config('app.actor_id',$1,true)",[actor.id]);
      await client.query("UPDATE bookings SET status='EXPIRED',updated_at=clock_timestamp() WHERE id=$1 AND status='PENDING_PAYMENT'",[booking.id]);
      return { conflict: new BookingError(409,'BOOKING_EXPIRED','The payment hold has expired.') };
    }
    await client.query("SELECT set_config('app.actor_id',$1,true)",[actor.id]);
    const updated = await client.query(`UPDATE bookings SET status='CONFIRMED',payment_status='PAID',
      payment_confirmed_at=clock_timestamp(),confirmed_by=$2,updated_at=clock_timestamp()
      WHERE id=$1 AND status='PENDING_PAYMENT' AND expires_at>clock_timestamp()
      RETURNING booking_code,status,payment_confirmed_at`,[booking.id,actor.id]);
    if (!updated.rows[0]) {
      await client.query("UPDATE bookings SET status='EXPIRED',updated_at=clock_timestamp() WHERE id=$1 AND status='PENDING_PAYMENT' AND expires_at<=clock_timestamp()",[booking.id]);
      return { conflict: new BookingError(409,'BOOKING_EXPIRED','The payment hold has expired.') };
    }
    await client.query(`INSERT INTO audit_logs(actor_id,actor_role,action,entity_type,entity_id,after_data,ip_address)
      VALUES($1,$2,'PAYMENT_CONFIRMED','booking',$3,jsonb_build_object('booking_code',$4::text,'payment_status','PAID'),$5)`,
    [actor.id,actor.role,booking.id,code,actor.ip ?? null]);
    return { ...updated.rows[0], already_confirmed: false };
  });
  if ('conflict' in result) throw result.conflict;
  return result;
}

export function isRentalDomain(value: unknown): value is RentalDomain { return value === 'DANCE' || value === 'BRT'; }
