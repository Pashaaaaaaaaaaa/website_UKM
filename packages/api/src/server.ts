import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import type pg from 'pg';
import { getPool } from '../../database/src/client.ts';
import { createAdminAuthRouter, type AuthOptions } from './auth.ts';
import { createAdminBookingRouter, createPublicBookingRouter } from './booking-routes.ts';
import { startBookingExpiryWorker } from './booking-service.ts';
import { createManagementRouter, createPublicContentRouter } from './management-routes.ts';
import { createPublicCatalogRouter } from './public-catalog-routes.ts';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

export function createApp(pool: pg.Pool = getPool(), authOptions: AuthOptions = {}) {
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://localhost:3001').split(',').map(value => value.trim());
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','X-Admin-Tab-ID'] }));
  app.use(express.json({ limit: '11mb', strict: true }));

  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ data: { status: 'ok', database: 'connected' } }); }
    catch { res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Service is unavailable.' } }); }
  });

  app.use('/api/admin', createAdminAuthRouter(pool, authOptions));
  app.use('/api/admin', createAdminBookingRouter(pool));
  app.use('/api/admin', createManagementRouter(pool));
  app.use('/api/public', createPublicContentRouter(pool));
  app.use('/api/public', createPublicCatalogRouter(pool));
  app.use('/api/public', createPublicBookingRouter(pool));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void error;
    void _next;
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.API_PORT ?? 4000);
  void getPool().query('SELECT 1').catch(error => console.error('Database connection check failed:', error));
  startBookingExpiryWorker(getPool());
  createApp().listen(port, () => console.log(`UKM API listening on :${port}`));
}
