import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthenticatedUser } from './types';
import { pool } from '../db/pool';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let claims: Pick<AuthenticatedUser, 'id'>;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET!) as Pick<AuthenticatedUser, 'id'>;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.email,
              COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
              COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions,
              COALESCE(array_agg(DISTINCT us.store_id) FILTER (WHERE us.store_id IS NOT NULL), '{}') AS "storeIds"
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
       LEFT JOIN user_stores us ON us.user_id = u.id
       WHERE u.id = $1 AND u.is_active = true GROUP BY u.id`,
      [claims.id],
    );
    if (!result.rowCount) {
      res.status(401).json({ error: 'Account is inactive or no longer exists' });
      return;
    }
    req.user = result.rows[0] as AuthenticatedUser;
    next();
  } catch {
    next(new Error('Unable to verify account permissions'));
  }
}

export function requireAnyRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !req.user.roles.some((role) => allowedRoles.includes(role))) {
      res.status(403).json({ error: 'Insufficient role permissions' });
      return;
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user?.permissions.includes(permission)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
