import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db/pool';

export const authRouter = Router();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid login request', details: parsed.error.flatten() });
      return;
    }

    const result = await pool.query(
      `SELECT u.id, u.email, u.password_hash,
              COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
              COALESCE(array_agg(DISTINCT pm.code) FILTER (WHERE pm.code IS NOT NULL), '{}') AS permissions,
              COALESCE(array_agg(DISTINCT us.store_id) FILTER (WHERE us.store_id IS NOT NULL), '{}') AS store_ids
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions pm ON pm.id = rp.permission_id
       LEFT JOIN user_stores us ON us.user_id = u.id
       WHERE lower(u.email) = lower($1) AND u.is_active = true
       GROUP BY u.id`,
      [parsed.data.email],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, roles: user.roles, permissions: user.permissions, storeIds: user.store_ids },
      process.env.JWT_SECRET!,
      { expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as jwt.SignOptions['expiresIn'] },
    );
    res.json({ accessToken: token, user: { id: user.id, email: user.email, roles: user.roles, permissions: user.permissions, storeIds: user.store_ids } });
  } catch (error) {
    next(error);
  }
});
