import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { asyncRoute, pageValues, sendValidationError } from '../domain/http';
import { pool } from '../db/pool';

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get('/', requirePermission('customers:read'), asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageValues(req);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const phone = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
  const result = await pool.query(
    `SELECT id, name, phone, email, tax_number AS "taxNumber", loyalty_points AS "loyaltyPoints", created_at AS "createdAt"
     FROM customers WHERE is_active = true
       AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
       AND ($2 = '' OR phone ILIKE '%' || $2 || '%')
     ORDER BY name LIMIT $3 OFFSET $4`, [search, phone, pageSize, offset],
  );
  const count = await pool.query(
    `SELECT count(*)::int AS total FROM customers
     WHERE is_active = true AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
       AND ($2 = '' OR phone ILIKE '%' || $2 || '%')`, [search, phone],
  );
  res.json({ items: result.rows, page, pageSize, total: count.rows[0].total });
}));

customersRouter.post('/', requirePermission('customers:write'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(200), phone: z.string().trim().max(40).nullable().optional(),
    email: z.string().email().nullable().optional(), taxNumber: z.string().max(80).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const d = parsed.data;
  const result = await pool.query(
    'INSERT INTO customers(name, phone, email, tax_number) VALUES ($1,$2,$3,$4) RETURNING id, name, phone, email, tax_number AS "taxNumber"',
    [d.name, d.phone ?? null, d.email ?? null, d.taxNumber ?? null],
  );
  res.status(201).json(result.rows[0]);
}));
