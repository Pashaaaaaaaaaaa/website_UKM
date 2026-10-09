import { z } from 'zod';

export const RentalDomainSchema = z.enum(['DANCE', 'BRT']);
export const BookingStatusSchema = z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED']);
export const PaymentStatusSchema = z.enum(['UNPAID', 'PAID']);

const DateSchema = z.string().date();
const BookingLineSchema = z.object({
  service_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  quantity: z.number().int().positive().max(10_000),
}).strict().refine(line => Number(Boolean(line.service_id)) + Number(Boolean(line.item_id)) === 1, {
  message: 'Each line must identify exactly one dance service or BRT item',
});

export const CreateBookingSchema = z.object({
  customer_name: z.string().trim().min(1).max(160),
  customer_phone: z.string().trim().min(5).max(40),
  customer_email: z.string().trim().email().max(254).optional(),
  domain: RentalDomainSchema,
  items: z.array(BookingLineSchema).min(1).max(50),
  start_date: DateSchema,
  end_date: DateSchema,
  notes: z.string().trim().max(2_000).optional(),
}).strict().superRefine((booking, ctx) => {
  if (booking.end_date < booking.start_date) {
    ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'end_date must be on or after start_date' });
  }
  const requiredKey = booking.domain === 'DANCE' ? 'service_id' : 'item_id';
  const forbiddenKey = booking.domain === 'DANCE' ? 'item_id' : 'service_id';
  if (booking.items.some(line => !line[requiredKey] || line[forbiddenKey])) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'All items must belong to the selected rental domain' });
  }
  if (booking.domain === 'DANCE' && booking.items.some(line => line.quantity !== 1)) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Dance services are booked one performance at a time' });
  }
  const resourceIds = booking.items.map(line => line.service_id ?? line.item_id);
  if (new Set(resourceIds).size !== resourceIds.length) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'A resource can only appear once per booking' });
  }
});

export const AvailabilityRangeSchema = z.object({ start_date: DateSchema, end_date: DateSchema }).strict().superRefine((range, ctx) => {
  if (range.end_date < range.start_date) {
    ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'end_date must be on or after start_date' });
  } else if (rentalDays(range.start_date, range.end_date) > 366) {
    ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'Availability range cannot exceed 366 days' });
  }
});

export type RentalDomain = z.infer<typeof RentalDomainSchema>;
export type BookingStatus = z.infer<typeof BookingStatusSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;

/** Inclusive, date-only duration, avoiding local time-zone/DST arithmetic. */
export function rentalDays(startDate: string, endDate: string): number {
  const parse = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year!, month! - 1, day!);
  };
  const days = (parse(endDate) - parse(startDate)) / 86_400_000 + 1;
  if (!Number.isInteger(days) || days < 1) throw new RangeError('end_date must be on or after start_date');
  return days;
}

export function dateRange(startDate: string, endDate: string): string[] {
  const days = rentalDays(startDate, endDate);
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, offset) => new Date(start + offset * 86_400_000).toISOString().slice(0, 10));
}
