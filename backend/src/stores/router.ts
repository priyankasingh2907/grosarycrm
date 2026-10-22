import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { asyncRoute, sendValidationError, writeAudit } from '../domain/http';
import { pool } from '../db/pool';

export const storesRouter = Router();
storesRouter.use(requireAuth);

storesRouter.get('/', requirePermission('stores:read'), asyncRoute(async (req, res) => {
  const ids = req.user!.roles.includes('super_admin') ? null : req.user!.storeIds;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const result = await pool.query(
    `SELECT id, name, code, phone, email, address, timezone FROM stores
     WHERE is_active = true AND ($1::uuid[] IS NULL OR id = ANY($1))
       AND ($2 = '' OR name ILIKE '%' || $2 || '%' OR code ILIKE '%' || $2 || '%' OR phone ILIKE '%' || $2 || '%')
     ORDER BY name`, [ids, search],
  );
  res.json(result.rows);
}));

storesRouter.post('/', requirePermission('stores:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(160), code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
    phone: z.string().max(40).optional(), email: z.string().email().optional(), timezone: z.string().default('UTC'), address: z.record(z.unknown()).default({}),
  }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const d = parsed.data;
    const store = await client.query(
      `INSERT INTO stores(name, code, phone, email, timezone, address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.name, d.code, d.phone ?? null, d.email ?? null, d.timezone, JSON.stringify(d.address)],
    );
    await writeAudit(client, req, 'created', 'store', store.rows[0].id, store.rows[0].id, { code: d.code, name: d.name });
    await client.query('COMMIT');
    res.status(201).json(store.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

storesRouter.patch('/:id', requirePermission('stores:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(160).optional(), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), timezone: z.string().min(1).max(100).optional(), address: z.record(z.unknown()).optional(), isActive: z.boolean().optional() }).refine((data) => Object.keys(data).length > 0).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const d = parsed.data;
  const result = await pool.query(
    `UPDATE stores SET name = COALESCE($2,name), phone = CASE WHEN $3::boolean THEN $4::text ELSE phone END,
       email = CASE WHEN $5::boolean THEN $6::text ELSE email END, timezone = COALESCE($7,timezone),
       address = COALESCE($8::jsonb,address), is_active = COALESCE($9,is_active), updated_at = now()
     WHERE id = $1 RETURNING id,name,code,phone,email,address,timezone,is_active AS "isActive"`,
    [req.params.id,d.name ?? null,'phone' in d,d.phone ?? null,'email' in d,d.email ?? null,d.timezone ?? null,d.address ? JSON.stringify(d.address) : null,d.isActive ?? null],
  );
  if (!result.rowCount) { res.status(404).json({ error: 'Store not found' }); return; }
  res.json(result.rows[0]);
}));
