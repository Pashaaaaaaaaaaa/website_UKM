import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type pg from 'pg';
import { CreateBookingSchema } from '../../domain/src/booking.ts';
import { getPool } from '../../database/src/client.ts';
import { createAdminAuthRouter, type AuthOptions } from './auth.ts';

export function createApp(pool: pg.Pool = getPool(), authOptions: AuthOptions = {}) {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3001').split(',').map(value => value.trim());
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type'] }));
  app.use(express.json({ limit: '1mb', strict: true }));

  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ data: { status: 'ok', database: 'connected' } }); }
    catch { res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Service is unavailable.' } }); }
  });

  app.use('/api/admin', createAdminAuthRouter(pool, authOptions));

  app.post('/api/bookings', async (req, res, next) => {
    const parsed = CreateBookingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid booking input.' } });
    const booking = parsed.data;
    const dayMs = 86_400_000;
    const [sy, sm, sd] = booking.startDate.split('-').map(Number);
    const [ey, em, ed] = booking.endDate.split('-').map(Number);
    const rentalDays = (Date.UTC(ey!, em! - 1, ed!) - Date.UTC(sy!, sm! - 1, sd!)) / dayMs + 1;
    const client = await pool.connect();
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
          if (item.quantity !== 1) { await client.query('ROLLBACK'); return res.status(400).json({ error: { code: 'DANCE_QUANTITY_MUST_BE_ONE', message: 'Invalid item quantity.' } }); }
          const service = await client.query<{ price_per_performance: string; is_active: boolean }>('SELECT price_per_performance,is_active FROM dance_services WHERE id=$1 FOR UPDATE', [item.serviceId]);
          if (!service.rows[0]?.is_active) { await client.query('ROLLBACK'); return res.status(409).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The requested service is unavailable.' } }); }
          const conflict = await client.query(`SELECT 1 FROM booking_items i JOIN bookings b ON b.id=i.booking_id
            WHERE i.service_id=$1 AND b.id<>$2 AND b.status IN ('PENDING','CONFIRMED','ACTIVE')
            AND (b.status<>'PENDING' OR b.expires_at>now()) AND daterange(b.start_date,b.end_date,'[]') && daterange($3::date,$4::date,'[]') LIMIT 1`,
          [item.serviceId,created.rows[0]!.id,booking.startDate,booking.endDate]);
          if (conflict.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: { code: 'SERVICE_DATE_UNAVAILABLE', message: 'The requested service is unavailable on these dates.' } }); }
          const price = Number(service.rows[0]!.price_per_performance);
          const subtotal = price * item.quantity * rentalDays;
          await client.query('INSERT INTO booking_items(booking_id,service_id,quantity,unit_price_snapshot,rental_days,subtotal) VALUES($1,$2,$3,$4,$5,$6)', [created.rows[0]!.id,item.serviceId,item.quantity,price,rentalDays,subtotal]);
          total += subtotal;
        } else {
          const itemRow = await client.query<{ price_per_unit_per_day: string; is_active: boolean; total_quantity: number }>('SELECT price_per_unit_per_day,is_active,total_quantity FROM inventory_items WHERE id=$1 FOR UPDATE', [item.itemId]);
          if (!itemRow.rows[0]?.is_active) { await client.query('ROLLBACK'); return res.status(409).json({ error: { code: 'ITEM_UNAVAILABLE', message: 'The requested item is unavailable.' } }); }
          const booked = await client.query<{ quantity: string }>(`SELECT COALESCE(sum(i.quantity),0) quantity FROM booking_items i
            JOIN bookings b ON b.id=i.booking_id WHERE i.item_id=$1 AND b.id<>$2 AND b.status IN ('PENDING','CONFIRMED','ACTIVE')
            AND (b.status<>'PENDING' OR b.expires_at>now()) AND daterange(b.start_date,b.end_date,'[]') && daterange($3::date,$4::date,'[]')`,
          [item.itemId,created.rows[0]!.id,booking.startDate,booking.endDate]);
          if (Number(booked.rows[0]!.quantity) + item.quantity > itemRow.rows[0]!.total_quantity) { await client.query('ROLLBACK'); return res.status(409).json({ error: { code: 'INSUFFICIENT_INVENTORY', message: 'There is not enough inventory for these dates.' } }); }
          const price = Number(itemRow.rows[0]!.price_per_unit_per_day);
          const subtotal = price * item.quantity * rentalDays;
          await client.query('INSERT INTO booking_items(booking_id,item_id,quantity,unit_price_snapshot,rental_days,subtotal) VALUES($1,$2,$3,$4,$5,$6)', [created.rows[0]!.id,item.itemId,item.quantity,price,rentalDays,subtotal]);
          total += subtotal;
        }
      }
      await client.query('UPDATE bookings SET total_amount=$2 WHERE id=$1',[created.rows[0]!.id,total]);
      await client.query('COMMIT');
      return res.status(201).json({ data: { id: created.rows[0]!.id, bookingCode: code, totalAmount: total, rentalDays, expiresAt } });
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '40001') return res.status(409).json({ error: { code: 'BOOKING_CONFLICT_RETRY', message: 'Please retry this booking.' } });
      return next(error);
    } finally { client.release(); }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void error;
    void _next;
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.API_PORT ?? 4000);
  createApp().listen(port, () => console.log(`UKM API listening on :${port}`));
}
