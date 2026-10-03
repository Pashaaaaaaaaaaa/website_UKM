import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateBookingSchema, rentalDays } from '../packages/domain/src/booking.ts';

describe('booking domain validation', () => {
  it('counts rental dates inclusively, including leap days', () => {
    assert.equal(rentalDays('2024-02-28','2024-03-01'), 3);
  });
  it('rejects a booking that combines dance and inventory item IDs', () => {
    const result = CreateBookingSchema.safeParse({ customerName:'Test',customerPhone:'08123456789',domain:'DANCE',
      startDate:'2026-10-03',endDate:'2026-10-03',items:[{serviceId:'550e8400-e29b-41d4-a716-446655440000',itemId:'550e8400-e29b-41d4-a716-446655440001',quantity:1}] });
    assert.equal(result.success, false);
  });
  it('rejects a booking whose end date precedes its start date', () => {
    assert.equal(CreateBookingSchema.safeParse({ customerName:'Test',customerPhone:'08123456789',domain:'BRT',
      startDate:'2026-10-04',endDate:'2026-10-03',items:[{itemId:'550e8400-e29b-41d4-a716-446655440001',quantity:1}] }).success, false);
  });
});
