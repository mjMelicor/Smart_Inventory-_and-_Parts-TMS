import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { router } from './routes.js';
import { prisma } from './db.js';

export const app = express();

app.disable('x-powered-by');
app.set('json replacer', (_key, value) => typeof value === 'bigint' ? String(value) : value);
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN?.split(',').map(value => value.trim()) || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: 'ok' });
  } catch {
    return res.status(503).json({ status: 'unavailable', error: 'Database connection is unavailable.' });
  }
});
app.use('/api', router);

app.use((error, _req, res, _next) => {
  if (error?.name === 'ZodError') {
    return res.status(400).json({ error: 'Invalid request data.', details: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) });
  }
  if (error?.code === 'P2002') return res.status(409).json({ error: 'A record with that unique value already exists.' });
  if (error?.code === 'P2025') return res.status(404).json({ error: 'The requested record was not found.' });
  if (error?.code === 'P2003' || error?.code === 'P2014') return res.status(409).json({ error: 'This record cannot be changed because it is in use.' });
  if (error?.code === 'P2021' || error?.code === 'P2022') {
    console.error('Database schema is missing required tables or columns:', error.message);
    return res.status(503).json({ error: 'Database schema is not up to date. Apply the pending database scripts, including database/09_transfer_receipt_idempotency.sql, and retry.' });
  }
  if (error?.status && error.status < 500) {
    return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  }
  console.error(error);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }));
