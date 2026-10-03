import { z } from 'zod';

export const RentalDomainSchema = z.enum(['DANCE', 'BRT']);
export const BookingStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED']);
export const PaymentStatusSchema = z.enum(['UNPAID', 'PENDING_CONFIRMATION', 'PAID', 'REJECTED', 'REFUNDED']);

export const BookingItemInputSchema = z.object({
  serviceId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
}).refine((item) => Number(Boolean(item.serviceId)) + Number(Boolean(item.itemId)) === 1, {
  message: 'Exactly one of serviceId or itemId is required',
});

export const CreateBookingSchema = z.object({
  customerName: z.string().trim().min(1).max(160),
  customerPhone: z.string().trim().min(5).max(40),
  customerEmail: z.string().email().optional(),
  domain: RentalDomainSchema,
  startDate: z.string().date(),
  endDate: z.string().date(),
  items: z.array(BookingItemInputSchema).min(1),
}).superRefine((booking, ctx) => {
  if (booking.endDate < booking.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate must be on or after startDate' });
  if (booking.items.some((item) => booking.domain === 'DANCE' ? !item.serviceId : !item.itemId)) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'Items must belong to the selected rental domain' });
  }
});

export type RentalDomain = z.infer<typeof RentalDomainSchema>;
export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;

/** Inclusive, date-only duration, avoiding local time-zone/DST arithmetic. */
export function rentalDays(startDate: string, endDate: string): number {
  const parse = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year!, month! - 1, day!);
  };
  const days = (parse(endDate) - parse(startDate)) / 86_400_000 + 1;
  if (!Number.isInteger(days) || days < 1) throw new RangeError('endDate must be on or after startDate');
  return days;
}
