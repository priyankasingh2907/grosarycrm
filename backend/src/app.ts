import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './auth/router';
import { dashboardRouter } from './dashboard/router';
import { pool } from './db/pool';
import { catalogRouter } from './catalog/router';
import { inventoryRouter } from './inventory/router';
import { purchasingRouter } from './purchasing/router';
import { customersRouter } from './customers/router';
import { salesRouter } from './sales/router';
import { adminRouter } from './admin/router';
import { storesRouter } from './stores/router';
import { reportsRouter } from './reports/router';
import { operationsRouter } from './operations/router';

export const app = express();
const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
app.use(cors({ origin: (origin, callback) => {
  const localWebOrigin = process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? '');
  if (!origin || localWebOrigin || allowedOrigins.includes(origin)) callback(null, true);
  else callback(new Error('Origin is not allowed by CORS'));
} }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/catalog', catalogRouter);
app.use('/api/v1/inventory', inventoryRouter);
app.use('/api/v1/purchases', purchasingRouter);
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/sales', salesRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/stores', storesRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/operations', operationsRouter);
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 500;
  const message = status === 500 ? 'Internal server error' : error instanceof Error ? error.message : 'Request failed';
  const details = typeof error === 'object' && error !== null && 'available' in error ? { available: error.available } : undefined;
  res.status(status).json({ error: message, ...details });
});
