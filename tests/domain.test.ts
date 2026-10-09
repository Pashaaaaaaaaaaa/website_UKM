import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateBookingSchema, rentalDays } from '../packages/domain/src/booking.ts';

describe('booking domain validation', () => {
  it('counts rental dates inclusively, including leap days', () => {
    assert.equal(rentalDays('2024-02-28','2024-03-01'), 3);
  });
  it('rejects a booking that combines dance and inventory item IDs', () => {
    const result = CreateBookingSchema.safeParse({ customer_name:'Test',customer_phone:'08123456789',domain:'DANCE',
      start_date:'2026-10-03',end_date:'2026-10-03',items:[{service_id:'550e8400-e29b-41d4-a716-446655440000',item_id:'550e8400-e29b-41d4-a716-446655440001',quantity:1}] });
    assert.equal(result.success, false);
  });
  it('rejects a booking whose end date precedes its start date', () => {
    assert.equal(CreateBookingSchema.safeParse({ customer_name:'Test',customer_phone:'08123456789',domain:'BRT',
      start_date:'2026-10-04',end_date:'2026-10-03',items:[{item_id:'550e8400-e29b-41d4-a716-446655440001',quantity:1}] }).success, false);
  });
  it('accepts public guest booking details without requiring a customer account or status', () => {
    const result = CreateBookingSchema.safeParse({ customer_name:'Guest',customer_phone:'08123456789',domain:'BRT',
      start_date:'2026-10-10',end_date:'2026-10-10',items:[{item_id:'550e8400-e29b-41d4-a716-446655440001',quantity:1}] });
    assert.equal(result.success, true);
  });
  it('rejects client submitted prices, totals, and status', () => {
    const result = CreateBookingSchema.safeParse({ customer_name:'Guest',customer_phone:'08123456789',domain:'BRT',
      start_date:'2026-10-10',end_date:'2026-10-10',total_amount:1,status:'CONFIRMED',
      items:[{item_id:'550e8400-e29b-41d4-a716-446655440001',quantity:1,unit_price_snapshot:1}] });
    assert.equal(result.success, false);
  });
  it('rejects duplicate resource lines and non-unit dance quantity', () => {
    const id='550e8400-e29b-41d4-a716-446655440000';
    assert.equal(CreateBookingSchema.safeParse({ customer_name:'Guest',customer_phone:'08123456789',domain:'DANCE',
      start_date:'2026-10-10',end_date:'2026-10-10',items:[{service_id:id,quantity:2}] }).success,false);
    assert.equal(CreateBookingSchema.safeParse({ customer_name:'Guest',customer_phone:'08123456789',domain:'BRT',
      start_date:'2026-10-10',end_date:'2026-10-10',items:[{item_id:id,quantity:1},{item_id:id,quantity:1}] }).success,false);
  });
});
