import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { CreateBookingSchema } from '../../domain/src/booking.ts';
import { getPool } from '../../database/src/client.ts';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000','http://localhost:3001'] }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  try { await getPool().query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'unavailable', database: 'disconnected' }); }
});

app.post('/api/bookings', async (req, res, next) => {
  const parsed = CreateBookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  const booking = parsed.data;
  const dayMs = 86_400_000;
  const [sy, sm, sd] = booking.startDate.split('-').map(Number);
  const [ey, em, ed] = booking.endDate.split('-').map(Number);
  const rentalDays = (Date.UTC(ey!, em! - 1, ed!) - Date.UTC(sy!, sm! - 1, sd!)) / dayMs + 1;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const code = `UKM-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,8).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const created = await client.query<{ id: string }>(`INSERT INTO bookings
      (booking_code,customer_name,customer_phone,customer_email,rental_domain,start_date,end_date,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [code,booking.customerName,booking.customerPhone,booking.customerEmail ?? null,booking.domain,booking.startDate,booking.endDate,expiresAt]);
    let total = 0;
    for (const item of booking.items) {
      if (booking.domain === 'DANCE') {
        if (item.quantity !== 1) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'DANCE_QUANTITY_MUST_BE_ONE' }); }
        const service = await client.query<{ price_per_performance: string; is_active: boolean }>(
          'SELECT price_per_performance,is_active FROM dance_services WHERE id=$1 FOR UPDATE', [item.serviceId]);
        if (!service.rows[0]?.is_active) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'SERVICE_UNAVAILABLE' }); }
        const conflict = await client.query(`SELECT 1 FROM booking_items i JOIN bookings b ON b.id=i.booking_id
          WHERE i.service_id=$1 AND b.id<>$2 AND b.status IN ('PENDING','CONFIRMED','ACTIVE')
          AND (b.status<>'PENDING' OR b.expires_at>now()) AND daterange(b.start_date,b.end_date,'[]') && daterange($3::date,$4::date,'[]') LIMIT 1`,
        [item.serviceId,created.rows[0]!.id,booking.startDate,booking.endDate]);
        if (conflict.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'SERVICE_DATE_UNAVAILABLE' }); }
        const price = Number(service.rows[0]!.price_per_performance);
        const subtotal = price * item.quantity * rentalDays;
        await client.query('INSERT INTO booking_items(booking_id,service_id,quantity,unit_price_snapshot,rental_days,subtotal) VALUES($1,$2,$3,$4,$5,$6)',
          [created.rows[0]!.id,item.serviceId,item.quantity,price,rentalDays,subtotal]);
        total += subtotal;
      } else {
        const itemRow = await client.query<{ price_per_unit_per_day: string; is_active: boolean; total_quantity: number }>(
          'SELECT price_per_unit_per_day,is_active,total_quantity FROM inventory_items WHERE id=$1 FOR UPDATE', [item.itemId]);
        if (!itemRow.rows[0]?.is_active) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'ITEM_UNAVAILABLE' }); }
        const booked = await client.query<{ quantity: string }>(`SELECT COALESCE(sum(i.quantity),0) quantity FROM booking_items i
          JOIN bookings b ON b.id=i.booking_id WHERE i.item_id=$1 AND b.id<>$2 AND b.status IN ('PENDING','CONFIRMED','ACTIVE')
          AND (b.status<>'PENDING' OR b.expires_at>now()) AND daterange(b.start_date,b.end_date,'[]') && daterange($3::date,$4::date,'[]')`,
        [item.itemId,created.rows[0]!.id,booking.startDate,booking.endDate]);
        if (Number(booked.rows[0]!.quantity) + item.quantity > itemRow.rows[0]!.total_quantity) {
          await client.query('ROLLBACK'); return res.status(409).json({ error: 'INSUFFICIENT_INVENTORY' });
        }
        const price = Number(itemRow.rows[0]!.price_per_unit_per_day);
        const subtotal = price * item.quantity * rentalDays;
        await client.query('INSERT INTO booking_items(booking_id,item_id,quantity,unit_price_snapshot,rental_days,subtotal) VALUES($1,$2,$3,$4,$5,$6)',
          [created.rows[0]!.id,item.itemId,item.quantity,price,rentalDays,subtotal]);
        total += subtotal;
      }
    }
    await client.query('UPDATE bookings SET total_amount=$2 WHERE id=$1',[created.rows[0]!.id,total]);
    await client.query('COMMIT');
    return res.status(201).json({ id: created.rows[0]!.id, bookingCode: code, totalAmount: total, rentalDays, expiresAt });
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '40001') return res.status(409).json({ error: 'BOOKING_CONFLICT_RETRY' });
    return next(error);
  } finally { client.release(); }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void _next;
  console.error(error);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

const port = Number(process.env.API_PORT ?? 4000);
app.listen(port, () => console.log(`UKM API listening on :${port}`));
