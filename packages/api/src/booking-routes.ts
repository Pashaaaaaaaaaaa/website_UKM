import { Router, type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { AvailabilityRangeSchema, CreateBookingSchema, type RentalDomain } from '../../domain/src/booking.ts';
import { createAdminAuthMiddleware, type AdminRole } from './auth.ts';
import {
  BookingError, confirmBookingPayment, createBooking, getAvailability, getBooking, listBookings,
  type BookingFilter, type BookingServiceOptions,
} from './booking-service.ts';

const sendError = (res: Response, error: unknown) => {
  if (error instanceof BookingError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (typeof error === 'object' && error !== null && 'code' in error && String(error.code) === '23514') {
    return res.status(409).json({ error: { code: 'RESOURCE_CONFLICT', message: 'A requested resource is no longer available for these dates.' } });
  }
  console.error(error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
};
const roleDomain = (role: AdminRole): RentalDomain | null => role === 'MANAGER' ? 'DANCE' : role === 'BRT_ADMIN' ? 'BRT' : null;
const parseAvailabilityRange = (req: Request) => AvailabilityRangeSchema.safeParse({ start_date: req.query.start_date, end_date: req.query.end_date });
const ResourceIdSchema = z.string().uuid();
const isValidCode = (value: string) => /^BK-\d{8}-\d{4,}$/.test(value);

export function createPublicBookingRouter(pool: pg.Pool, options: BookingServiceOptions = {}): Router {
  const router = Router();
  router.post('/bookings', async (req, res) => {
    const parsed = CreateBookingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid booking input.', details: parsed.error.flatten() } });
    try { return res.status(201).json({ data: await createBooking(pool, parsed.data, options) }); }
    catch (error) { return sendError(res, error); }
  });
  router.get('/availability/dance/:id', async (req, res) => {
    if (!ResourceIdSchema.safeParse(req.params.id).success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid service ID.' } });
    const range = parseAvailabilityRange(req);
    if (!range.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date range.' } });
    try { return res.json({ data: await getAvailability(pool,'DANCE',req.params.id!,range.data.start_date,range.data.end_date) }); }
    catch (error) { return sendError(res,error); }
  });
  router.get('/availability/items/:id', async (req, res) => {
    if (!ResourceIdSchema.safeParse(req.params.id).success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid item ID.' } });
    const range = parseAvailabilityRange(req);
    if (!range.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date range.' } });
    try { return res.json({ data: await getAvailability(pool,'BRT',req.params.id!,range.data.start_date,range.data.end_date) }); }
    catch (error) { return sendError(res,error); }
  });
  return router;
}

export function createAdminBookingRouter(pool: pg.Pool): Router {
  const router = Router();
  const authenticate = createAdminAuthMiddleware(pool);
  router.use(authenticate);

  router.get('/bookings', async (req, res) => {
    const domain = roleDomain(req.admin!.role);
    if (!domain) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Your role cannot access rental bookings.' } });
    const status = req.query.status === undefined ? undefined : req.query.status;
    if (status !== undefined && !['PENDING_PAYMENT','CONFIRMED','EXPIRED'].includes(String(status))) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid booking status filter.' } });
    }
    const limit = Number(req.query.limit ?? 50); const offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid pagination.' } });
    }
    const rangeQuery: Record<string,string> = {};
    if (req.query.start_date !== undefined) rangeQuery.start_date = String(req.query.start_date);
    if (req.query.end_date !== undefined) rangeQuery.end_date = String(req.query.end_date);
    if (rangeQuery.start_date && rangeQuery.end_date) {
      const range = AvailabilityRangeSchema.safeParse(rangeQuery);
      if (!range.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date range.' } });
    } else {
      for (const value of Object.values(rangeQuery)) {
        if (!z.iso.date().safeParse(value).success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date filter.' } });
      }
    }
    const filter: BookingFilter = { domain, ...(status ? { status: status as NonNullable<BookingFilter['status']> } : {}),
      ...(rangeQuery.start_date ? { start_date: rangeQuery.start_date } : {}), ...(rangeQuery.end_date ? { end_date: rangeQuery.end_date } : {}), limit, offset };
    try { return res.json({ data: await listBookings(pool,filter) }); }
    catch (error) { return sendError(res,error); }
  });

  router.get('/bookings/:code', async (req,res) => {
    const domain = roleDomain(req.admin!.role);
    if (!domain) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Your role cannot access rental bookings.' } });
    const code = req.params.code!;
    if (!isValidCode(code)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid booking code.' } });
    try { return res.json({ data: await getBooking(pool,code,domain) }); }
    catch (error) { return sendError(res,error); }
  });

  router.post('/bookings/:code/confirm-payment', async (req,res) => {
    const code = req.params.code!;
    if (!isValidCode(code)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid booking code.' } });
    try {
      return res.json({ data: await confirmBookingPayment(pool,code,{ id: req.admin!.id, role: req.admin!.role, ...(req.ip ? { ip: req.ip } : {}) }) });
    } catch (error) { return sendError(res,error); }
  });

  router.get('/availability/dance/:id', async (req,res) => {
    if (req.admin!.role !== 'MANAGER') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only MANAGER may view dance availability.' } });
    if (!ResourceIdSchema.safeParse(req.params.id).success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid service ID.' } });
    const range = parseAvailabilityRange(req);
    if (!range.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date range.' } });
    try { return res.json({ data: await getAvailability(pool,'DANCE',req.params.id!,range.data.start_date,range.data.end_date) }); }
    catch (error) { return sendError(res,error); }
  });
  router.get('/availability/items/:id', async (req,res) => {
    if (req.admin!.role !== 'BRT_ADMIN') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only BRT_ADMIN may view BRT availability.' } });
    if (!ResourceIdSchema.safeParse(req.params.id).success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid item ID.' } });
    const range = parseAvailabilityRange(req);
    if (!range.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date range.' } });
    try { return res.json({ data: await getAvailability(pool,'BRT',req.params.id!,range.data.start_date,range.data.end_date) }); }
    catch (error) { return sendError(res,error); }
  });

  return router;
}
