import 'dotenv/config';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { getPool } from '../packages/database/src/client.ts';
import { CreateBookingSchema } from '../packages/domain/src/booking.ts';
import { createApp } from '../packages/api/src/server.ts';
import {
  BookingError, confirmBookingPayment, createBooking, expirePendingBookings, getAvailability, getBooking,
} from '../packages/api/src/booking-service.ts';
import type { CreateBookingInput } from '../packages/domain/src/booking.ts';

const configured = Boolean(process.env.DATABASE_URL);
const prefix = `booking-test:${randomUUID()}`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0,10);
let danceId = '';
let itemId = '';
let categoryId = '';
let managerId = '';
let brtAdminId = '';
let testOffset = 5;
const nextDates = (length = 1) => { const offset=testOffset; testOffset += length + 2; return { start_date: day(offset), end_date: day(offset + length - 1) }; };
const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0,10);
const input = (domain: 'DANCE'|'BRT', resourceId: string, range = nextDates(), quantity = 1): CreateBookingInput => ({
  customer_name: 'Guest Customer', customer_phone: '+628123456789', domain, start_date: range.start_date, end_date: range.end_date,
  notes: prefix, items: [domain === 'DANCE' ? { service_id: resourceId, quantity } : { item_id: resourceId, quantity }],
});
const manager = () => ({ id: managerId, role: 'MANAGER' as const });
const brtAdmin = () => ({ id: brtAdminId, role: 'BRT_ADMIN' as const });
const pool = () => getPool();
const createStock = async (quantity: number, price = '10.00') => {
  const result = await pool().query(`INSERT INTO inventory_items(category_id,name,slug,price_per_unit_per_day,total_quantity)
    VALUES($1,$2,$3,$4,$5) RETURNING id`, [categoryId,'Concurrent stock',`booking-test-${randomUUID()}`,price,quantity]);
  return result.rows[0]!.id as string;
};
async function callApi(roleAdminId: string, role: 'MANAGER'|'BRT_ADMIN'|null, path: string, method = 'GET', body?: unknown) {
  const token = randomBytes(32).toString('base64url');
  if (role) await pool().query('INSERT INTO admin_sessions(admin_user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'1 hour\')', [roleAdminId,createHash('sha256').update(token).digest('hex')]);
  const app = createApp(pool() as unknown as pg.Pool);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address=server.address(); if (!address || typeof address === 'string') throw new Error('Test API failed to bind');
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method, headers: { ...(role ? { cookie: `ukm_admin_session=${token}` } : {}), ...(body ? { 'content-type':'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } finally {
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    if (role) await pool().query('DELETE FROM admin_sessions WHERE token_hash=$1',[createHash('sha256').update(token).digest('hex')]);
  }
}

describe('PostgreSQL booking engine integration', { skip: !configured }, () => {
  before(async () => {
    const service = await pool().query(`INSERT INTO dance_services(name,slug,price_per_performance)
      VALUES('Booking integration dance',$1,125.50) RETURNING id`,[`booking-test-${randomUUID()}`]);
    danceId = service.rows[0]!.id;
    const category = await pool().query('INSERT INTO inventory_categories(name,slug) VALUES($1,$2) RETURNING id',
      [`Booking integration ${randomUUID()}`,`booking-test-${randomUUID()}`]);
    categoryId = category.rows[0]!.id;
    itemId = await createStock(10,'10.00');
    const users = await pool().query(`SELECT u.id,r.code FROM admin_users u JOIN roles r ON r.id=u.role_id
      WHERE r.code IN ('MANAGER','BRT_ADMIN') AND u.is_development_seed`);
    managerId = users.rows.find(row => row.code === 'MANAGER')!.id;
    brtAdminId = users.rows.find(row => row.code === 'BRT_ADMIN')!.id;
  });
  after(async () => {
    await pool().query('DELETE FROM bookings WHERE notes=$1',[prefix]);
    await pool().query("DELETE FROM inventory_items WHERE slug LIKE 'booking-test-%'");
    if (danceId) await pool().query('DELETE FROM dance_services WHERE id=$1',[danceId]);
    if (categoryId) await pool().query('DELETE FROM inventory_categories WHERE id=$1',[categoryId]);
    await pool().end();
  });

  it('creates a single-day dance booking as a guest with no customer account', async () => {
    const result = await createBooking(pool(),input('DANCE',danceId),{allowPastDates:true});
    assert.equal(result.status,'PENDING_PAYMENT'); assert.equal(result.payment_status,'UNPAID');
    assert.equal(result.rental_days,1); assert.equal(result.total_amount,125.5);
    assert.match(result.booking_code,/^BK-\d{8}-\d{4,}$/);
    const row = await pool().query('SELECT EXTRACT(EPOCH FROM expires_at-created_at) AS hold_seconds FROM bookings WHERE booking_code=$1',[result.booking_code]);
    assert.ok(Number(row.rows[0]!.hold_seconds)>=86_399);
  });

  it('creates multi-day dance bookings and prices each performance day', async () => {
    const range=nextDates(3); const result=await createBooking(pool(),input('DANCE',danceId,range),{allowPastDates:true});
    assert.equal(result.rental_days,3); assert.equal(result.total_amount,376.5);
    const lines=await pool().query('SELECT quantity,rental_days,unit_price_snapshot::text,subtotal::text FROM booking_items WHERE booking_id=(SELECT id FROM bookings WHERE booking_code=$1)',[result.booking_code]);
    assert.deepEqual(lines.rows[0],{quantity:1,rental_days:3,unit_price_snapshot:'125.50',subtotal:'376.50'});
  });

  it('rejects overlapping dance dates and allows an adjacent non-overlapping booking', async () => {
    const range=nextDates(2); await createBooking(pool(),input('DANCE',danceId,range),{allowPastDates:true});
    await assert.rejects(createBooking(pool(),input('DANCE',danceId,{start_date:range.start_date,end_date:range.start_date}),{allowPastDates:true}),
      (error: unknown) => error instanceof BookingError && error.code==='DANCE_DATE_UNAVAILABLE');
    const adjacent={start_date:addDays(range.end_date,1),end_date:addDays(range.end_date,1)};
    assert.equal((await createBooking(pool(),input('DANCE',danceId,adjacent),{allowPastDates:true})).status,'PENDING_PAYMENT');
  });

  it('returns dance availability independently for each calendar date', async () => {
    const range=nextDates(2); await createBooking(pool(),input('DANCE',danceId,range),{allowPastDates:true});
    const calendar=await getAvailability(pool(),'DANCE',danceId,addDays(range.start_date,-1),addDays(range.end_date,1));
    assert.deepEqual(calendar.dates.map(entry=>entry.available),[true,false,false,true]);
  });

  it('creates BRT quantity reservations and computes price per unit per day', async () => {
    const result=await createBooking(pool(),input('BRT',itemId,nextDates(3),3),{allowPastDates:true});
    assert.equal(result.total_amount,90); assert.equal(result.rental_days,3);
    const rows=await pool().query('SELECT quantity,unit_price_snapshot::text,rental_days,subtotal::text FROM booking_items WHERE booking_id=(SELECT id FROM bookings WHERE booking_code=$1)',[result.booking_code]);
    assert.deepEqual(rows.rows[0],{quantity:3,unit_price_snapshot:'10.00',rental_days:3,subtotal:'90.00'});
  });

  it('rejects inventory quantities beyond capacity', async () => {
    await assert.rejects(createBooking(pool(),input('BRT',itemId,nextDates(),11),{allowPastDates:true}),
      (error: unknown) => error instanceof BookingError && error.code==='INSUFFICIENT_INVENTORY');
  });

  it('checks stock on every day and rejects the whole booking when one date is short', async () => {
    const resource=await createStock(10); const start=nextDates(1);
    await createBooking(pool(),input('BRT',resource,start,8),{allowPastDates:true});
    const spanning={start_date:start.start_date,end_date:addDays(start.start_date,2)};
    await assert.rejects(createBooking(pool(),input('BRT',resource,spanning,5),{allowPastDates:true}),
      (error: unknown) => error instanceof BookingError && error.code==='INSUFFICIENT_INVENTORY');
    const count=await pool().query('SELECT count(*)::int AS count FROM bookings WHERE notes=$1 AND start_date=$2 AND end_date=$3',[prefix,spanning.start_date,spanning.end_date]);
    assert.equal(Number(count.rows[0]!.count),0);
  });

  it('returns BRT reservations and availability per date rather than per range', async () => {
    const resource=await createStock(10); const middle=nextDates(1); const start=addDays(middle.start_date,-1); const end=addDays(middle.start_date,1);
    await createBooking(pool(),input('BRT',resource,middle,3),{allowPastDates:true});
    const calendar=await getAvailability(pool(),'BRT',resource,start,end);
    assert.deepEqual(calendar.dates.map(entry=>entry.reserved_quantity),[0,3,0]);
    assert.deepEqual(calendar.dates.map(entry=>entry.available_quantity),[10,7,10]);
  });

  it('reserves inventory immediately while a booking is pending payment', async () => {
    const range=nextDates(); await createBooking(pool(),input('BRT',itemId,range,6),{allowPastDates:true});
    const result=await getAvailability(pool(),'BRT',itemId,range.start_date,range.end_date);
    assert.equal(result.dates[0]!.reserved_quantity,6); assert.equal(result.dates[0]!.available_quantity,4);
    await assert.rejects(createBooking(pool(),input('BRT',itemId,range,5),{allowPastDates:true}),BookingError);
  });

  it('keeps confirmed bookings reserved', async () => {
    const range=nextDates(); const booking=await createBooking(pool(),input('BRT',itemId,range,2),{allowPastDates:true});
    const confirmed=await confirmBookingPayment(pool(),booking.booking_code,brtAdmin());
    assert.equal(confirmed.status,'CONFIRMED');
    const result=await getAvailability(pool(),'BRT',itemId,range.start_date,range.end_date);
    assert.equal(result.dates[0]!.reserved_quantity,2);
    await assert.rejects(createBooking(pool(),input('BRT',itemId,range,9),{allowPastDates:true}),
      (error: unknown)=>error instanceof BookingError && error.code==='INSUFFICIENT_INVENTORY');
  });

  it('expires pending bookings, releases stock, and keeps expiration idempotent', async () => {
    const range=nextDates(); const booking=await createBooking(pool(),input('BRT',itemId,range,4),{allowPastDates:true});
    await pool().query("UPDATE bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE booking_code=$1",[booking.booking_code]);
    assert.equal(await expirePendingBookings(pool()),1); assert.equal(await expirePendingBookings(pool()),0);
    const status=await pool().query('SELECT status,payment_status FROM bookings WHERE booking_code=$1',[booking.booking_code]);
    assert.deepEqual(status.rows[0],{status:'EXPIRED',payment_status:'UNPAID'});
    const result=await getAvailability(pool(),'BRT',itemId,range.start_date,range.end_date);
    assert.equal(result.dates[0]!.reserved_quantity,0); assert.equal(result.dates[0]!.available_quantity,10);
    assert.equal((await createBooking(pool(),input('BRT',itemId,range,10),{allowPastDates:true})).status,'PENDING_PAYMENT');
  });

  it('commits lazy expiration even when the subsequent booking attempt is rejected', async () => {
    const range=nextDates(); const expired=await createBooking(pool(),input('BRT',itemId,range,2),{allowPastDates:true});
    await pool().query("UPDATE bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE booking_code=$1",[expired.booking_code]);
    await assert.rejects(createBooking(pool(),input('BRT',itemId,range,11),{allowPastDates:true}),BookingError);
    const status=await pool().query('SELECT status FROM bookings WHERE booking_code=$1',[expired.booking_code]);
    assert.equal(status.rows[0]!.status,'EXPIRED');
  });

  it('confirms payment before expiry with a paid status and timestamp', async () => {
    const booking=await createBooking(pool(),input('DANCE',danceId),{allowPastDates:true});
    const confirmed=await confirmBookingPayment(pool(),booking.booking_code,manager());
    assert.equal(confirmed.status,'CONFIRMED');
    const result=await pool().query('SELECT status,payment_status,payment_confirmed_at,confirmed_by FROM bookings WHERE booking_code=$1',[booking.booking_code]);
    assert.equal(result.rows[0]!.payment_status,'PAID'); assert.ok(result.rows[0]!.payment_confirmed_at); assert.equal(result.rows[0]!.confirmed_by,managerId);
  });

  it('rejects confirmation after payment expiry and lazily marks the hold expired', async () => {
    const booking=await createBooking(pool(),input('DANCE',danceId),{allowPastDates:true});
    await pool().query("UPDATE bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE booking_code=$1",[booking.booking_code]);
    await assert.rejects(confirmBookingPayment(pool(),booking.booking_code,manager()),
      (error: unknown) => error instanceof BookingError && error.code==='BOOKING_EXPIRED');
    const status=await pool().query('SELECT status FROM bookings WHERE booking_code=$1',[booking.booking_code]);
    assert.equal(status.rows[0]!.status,'EXPIRED');
  });

  it('rejects an unauthorized admin confirming the other rental domain', async () => {
    const booking=await createBooking(pool(),input('DANCE',danceId),{allowPastDates:true});
    await assert.rejects(confirmBookingPayment(pool(),booking.booking_code,brtAdmin()),
      (error: unknown) => error instanceof BookingError && error.status===403);
    const response=await callApi(brtAdminId,'BRT_ADMIN',`/api/admin/bookings/${booking.booking_code}/confirm-payment`,'POST');
    assert.equal(response.status,403);
  });

  it('lists and views only bookings in the signed-in admin domain and applies date filters', async () => {
    const range=nextDates(2); const booking=await createBooking(pool(),input('DANCE',danceId,range),{allowPastDates:true});
    const response=await callApi(managerId,'MANAGER',`/api/admin/bookings?status=PENDING_PAYMENT&start_date=${range.start_date}&end_date=${range.end_date}`);
    assert.equal(response.status,200);
    const payload=await response.json() as {data:Array<{booking_code:string;domain:string}>};
    assert.ok(payload.data.some(entry=>entry.booking_code===booking.booking_code && entry.domain==='DANCE'));
    assert.equal((await callApi(managerId,'MANAGER',`/api/admin/bookings/${booking.booking_code}/confirm-payment`,'POST',{})).status,200);
    const queue=await callApi(managerId,'MANAGER','/api/admin/bookings?status=PENDING_PAYMENT');const pending=await queue.json() as {data:Array<{booking_code:string}>};assert.ok(!pending.data.some(entry=>entry.booking_code===booking.booking_code));
    const history=await callApi(managerId,'MANAGER',`/api/admin/bookings?start_date=${range.start_date}&end_date=${range.start_date}`);const past=await history.json() as {data:Array<{booking_code:string;status:string}>};assert.ok(past.data.some(entry=>entry.booking_code===booking.booking_code&&entry.status==='CONFIRMED'));
    const detail=await callApi(managerId,'MANAGER',`/api/admin/bookings/${booking.booking_code}`);
    assert.equal(detail.status,200);
    const hidden=await callApi(brtAdminId,'BRT_ADMIN',`/api/admin/bookings/${booking.booking_code}`);
    assert.equal(hidden.status,404);
  });

  it('calculates totals server-side, stores price snapshots, and keeps old totals after price changes', async () => {
    const resource=await createStock(5,'12.34'); const range=nextDates(2);
    const booking=await createBooking(pool(),input('BRT',resource,range,2),{allowPastDates:true});
    assert.equal(booking.total_amount,49.36);
    await pool().query('UPDATE inventory_items SET price_per_unit_per_day=99.99 WHERE id=$1',[resource]);
    const historical=await getBooking(pool(),booking.booking_code,'BRT');
    assert.equal(Number(historical.total_amount),49.36); assert.equal(historical.items[0]!.unit_price_snapshot,'12.34');
  });

  it('generates unique human-readable codes and does not return internal booking IDs', async () => {
    const one=await createBooking(pool(),input('BRT',itemId),{allowPastDates:true});
    const two=await createBooking(pool(),input('BRT',itemId),{allowPastDates:true});
    assert.notEqual(one.booking_code,two.booking_code);
    assert.equal('id' in one,false);
    const database=await pool().query('SELECT id,booking_code FROM bookings WHERE booking_code=$1',[one.booking_code]);
    assert.match(database.rows[0]!.booking_code,/^BK-\d{8}-\d{4,}$/);
    assert.notEqual(database.rows[0]!.id,one.booking_code);
  });

  it('rejects mixed-domain bookings and has no customer cancellation route', async () => {
    const bad=CreateBookingSchema.safeParse({ customer_name:'Guest',customer_phone:'08123456789',domain:'DANCE',start_date:day(20),end_date:day(20),
      items:[{service_id:danceId,quantity:1},{item_id:itemId,quantity:1}] });
    assert.equal(bad.success,false);
    const response=await callApi('',null,'/api/public/bookings/BK-20261009-0001/cancel','POST');
    assert.equal(response.status,404);
  });

  it('rejects past rental dates unless explicitly configured', async () => {
    const old={start_date:'2020-01-01',end_date:'2020-01-01'};
    await assert.rejects(createBooking(pool(),input('BRT',itemId,old),{allowPastDates:false,now:()=>new Date('2026-10-09T00:00:00Z')}),
      (error: unknown) => error instanceof BookingError && error.code==='PAST_DATES_NOT_ALLOWED');
  });

  it('enforces state transitions at the database boundary', async () => {
    const booking=await createBooking(pool(),input('BRT',itemId),{allowPastDates:true});
    await pool().query("UPDATE bookings SET status='EXPIRED' WHERE booking_code=$1",[booking.booking_code]);
    const client=await pool().connect();
    try {
      await assert.rejects(client.query("UPDATE bookings SET status='CONFIRMED',payment_status='PAID',payment_confirmed_at=now() WHERE booking_code=$1",[booking.booking_code]),
        (error: { code?: string })=>error.code==='23514');
    } finally { client.release(); }
  });

  it('prevents concurrent BRT reservations from overbooking shared stock', async () => {
    const resource=await createStock(10); const range=nextDates();
    const attempts=await Promise.allSettled([
      createBooking(pool(),input('BRT',resource,range,8),{allowPastDates:true}),
      createBooking(pool(),input('BRT',resource,range,5),{allowPastDates:true}),
    ]);
    assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);
    const reserved=await pool().query(`SELECT COALESCE(sum(i.quantity),0) quantity FROM booking_items i JOIN bookings b ON b.id=i.booking_id
      WHERE i.item_id=$1 AND b.status IN ('PENDING_PAYMENT','CONFIRMED') AND b.start_date<=$2 AND b.end_date>=$2`,[resource,range.start_date]);
    assert.ok(Number(reserved.rows[0]!.quantity)<=10);
  });

  it('prevents concurrent overlapping dance reservations', async () => {
    const range=nextDates();
    const attempts=await Promise.allSettled([
      createBooking(pool(),input('DANCE',danceId,range),{allowPastDates:true}),
      createBooking(pool(),input('DANCE',danceId,range),{allowPastDates:true}),
    ]);
    assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);
  });

  it('serves guest bookings and availability from the public API without auth', async () => {
    const range=nextDates(); const availability=await callApi('',null,`/api/public/availability/items/${itemId}?start_date=${range.start_date}&end_date=${range.end_date}`);
    assert.equal(availability.status,200);
    const body={...input('BRT',itemId,range,1)};
    const created=await callApi('',null,'/api/public/bookings','POST',body);
    assert.equal(created.status,201);
    const payload=await created.json() as {data:{booking_code:string;customer_name:string;status:string;payment_status:string;expires_at:string;total_amount:number;rental_days:number;items:Array<{name:string;unit_price_snapshot:number;quantity:number;subtotal:number}>}};
    assert.match(payload.data.booking_code,/^BK-/); assert.equal(payload.data.customer_name,'Guest Customer'); assert.equal(payload.data.status,'PENDING_PAYMENT');assert.equal(payload.data.payment_status,'UNPAID');assert.ok(Date.parse(payload.data.expires_at)>Date.now());assert.equal(payload.data.rental_days,1);assert.ok(payload.data.total_amount>0);assert.equal(payload.data.items[0]!.name,'Concurrent stock');assert.equal(payload.data.items[0]!.quantity,1);assert.ok(payload.data.items[0]!.unit_price_snapshot>0);assert.equal(payload.data.items[0]!.subtotal,payload.data.total_amount);
    assert.equal('id' in payload.data,false);
    const reserved=await callApi('',null,`/api/public/availability/items/${itemId}?start_date=${range.start_date}&end_date=${range.end_date}`);const reservedData=await reserved.json() as {data:{dates:Array<{reserved_quantity:number;available_quantity:number}>}};assert.equal(reservedData.data.dates[0]!.reserved_quantity,1);assert.equal(reservedData.data.dates[0]!.available_quantity,9);
    assert.equal((await callApi('',null,'/api/public/bookings','POST',{...body,items:[{item_id:itemId,quantity:11}]})).status,409);
    assert.equal((await callApi('',null,'/api/public/bookings','POST',{...body,end_date:'2000-01-01'})).status,400);
  });
});
