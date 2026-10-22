import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { asyncRoute, sendValidationError, writeAudit } from '../domain/http';
import { pool } from '../db/pool';

export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.get('/roles', requirePermission('roles:manage'), asyncRoute(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const result = await pool.query(
    `SELECT r.code, r.name, COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
     FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE ($1 = '' OR r.name ILIKE '%' || $1 || '%' OR r.code ILIKE '%' || $1 || '%')
     GROUP BY r.id ORDER BY r.name`,
    [search],
  );
  res.json(result.rows);
}));

adminRouter.get('/permissions', requirePermission('roles:manage'), asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT code, description FROM permissions ORDER BY code');
  res.json(result.rows);
}));

adminRouter.post('/roles', requirePermission('roles:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{2,49}$/), name: z.string().trim().min(2).max(100), permissions: z.array(z.string()).max(100) }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = await client.query('INSERT INTO roles(code, name) VALUES ($1,$2) RETURNING id, code, name', [parsed.data.code, parsed.data.name]);
    if (parsed.data.permissions.length) {
      const known = await client.query('SELECT id, code FROM permissions WHERE code = ANY($1::text[])', [parsed.data.permissions]);
      if (known.rowCount !== new Set(parsed.data.permissions).size) throw Object.assign(new Error('One or more permissions are unknown'), { status: 400 });
      for (const permission of known.rows) await client.query('INSERT INTO role_permissions(role_id, permission_id) VALUES ($1,$2)', [role.rows[0].id, permission.id]);
    }
    await writeAudit(client, req, 'created', 'role', null, null, { code: parsed.data.code, permissions: parsed.data.permissions });
    await client.query('COMMIT');
    res.status(201).json(role.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

adminRouter.get('/users', requirePermission('users:manage'), asyncRoute(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const result = await pool.query(
    `SELECT u.id, u.email, u.full_name AS "fullName", u.phone, u.is_active AS "isActive",
            COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT us.store_id) FILTER (WHERE us.store_id IS NOT NULL), '{}') AS "storeIds"
     FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN user_stores us ON us.user_id = u.id
     WHERE ($1 = '' OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR u.phone ILIKE '%' || $1 || '%')
     GROUP BY u.id ORDER BY u.full_name`, [search],
  );
  res.json(result.rows);
}));

adminRouter.post('/users', requirePermission('users:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    email: z.string().email(), fullName: z.string().trim().min(1).max(160), phone: z.string().max(40).optional(),
    password: z.string().min(12).max(100), roleCode: z.string().min(3), storeIds: z.array(z.string().uuid()).max(100),
  }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const d = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = await client.query('SELECT id FROM roles WHERE code = $1', [d.roleCode]);
    if (!role.rowCount) throw Object.assign(new Error('Role not found'), { status: 400 });
    if (d.storeIds.length) {
      const storeCount = await client.query('SELECT count(*)::int AS count FROM stores WHERE id = ANY($1::uuid[]) AND is_active = true', [d.storeIds]);
      if (storeCount.rows[0].count !== new Set(d.storeIds).size) throw Object.assign(new Error('One or more stores are unavailable'), { status: 400 });
    }
    const user = await client.query(
      'INSERT INTO users(email, full_name, phone, password_hash) VALUES (lower($1),$2,$3,$4) RETURNING id, email, full_name AS "fullName"',
      [d.email, d.fullName, d.phone ?? null, await bcrypt.hash(d.password, 12)],
    );
    await client.query('INSERT INTO user_roles(user_id, role_id) VALUES ($1,$2)', [user.rows[0].id, role.rows[0].id]);
    for (const storeId of d.storeIds) await client.query('INSERT INTO user_stores(user_id, store_id) VALUES ($1,$2)', [user.rows[0].id, storeId]);
    await writeAudit(client, req, 'created', 'user', user.rows[0].id, null, { email: user.rows[0].email, roleCode: d.roleCode, storeIds: d.storeIds });
    await client.query('COMMIT');
    res.status(201).json({ ...user.rows[0], role: d.roleCode, storeIds: d.storeIds });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

adminRouter.patch('/users/:id', requirePermission('users:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({ isActive: z.boolean().optional(), roleCode: z.string().min(3).optional(), storeIds: z.array(z.string().uuid()).max(100).optional() }).refine((data) => Object.keys(data).length > 0).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  if (req.params.id === req.user!.id) { res.status(409).json({ error: 'Administrators cannot change their own access here' }); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!current.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'User not found' }); return; }
    if (parsed.data.roleCode) {
      const role = await client.query('SELECT id FROM roles WHERE code = $1', [parsed.data.roleCode]);
      if (!role.rowCount) throw Object.assign(new Error('Role not found'), { status: 400 });
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [req.params.id]);
      await client.query('INSERT INTO user_roles(user_id, role_id) VALUES ($1,$2)', [req.params.id, role.rows[0].id]);
    }
    if (parsed.data.storeIds) {
      const count = await client.query('SELECT count(*)::int AS value FROM stores WHERE id = ANY($1::uuid[]) AND is_active = true', [parsed.data.storeIds]);
      if (count.rows[0].value !== new Set(parsed.data.storeIds).size) throw Object.assign(new Error('One or more stores are unavailable'), { status: 400 });
      await client.query('DELETE FROM user_stores WHERE user_id = $1', [req.params.id]);
      for (const storeId of parsed.data.storeIds) await client.query('INSERT INTO user_stores(user_id, store_id) VALUES ($1,$2)', [req.params.id, storeId]);
    }
    if (parsed.data.isActive !== undefined) await client.query('UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1', [req.params.id, parsed.data.isActive]);
    await writeAudit(client, req, 'updated_access', 'user', req.params.id, null, parsed.data);
    await client.query('COMMIT');
    res.json({ id: req.params.id, ...parsed.data });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
