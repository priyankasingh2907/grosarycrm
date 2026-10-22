import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';

export function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => { void handler(req, res).catch(next); };
}

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function pageValues(req: Request) {
  const { page, pageSize } = pageSchema.parse(req.query);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function accessibleStoreIds(req: Request): string[] | null {
  return req.user!.roles.includes('super_admin') ? null : req.user!.storeIds;
}

export async function assertStoreAccess(req: Request, storeId: string): Promise<void> {
  if (req.user!.roles.includes('super_admin')) return;
  if (!req.user!.storeIds.includes(storeId)) {
    const error = new Error('Store is outside your assigned access');
    Object.assign(error, { status: 403 });
    throw error;
  }
}

export async function writeAudit(
  client: PoolClient,
  req: Request,
  action: string,
  entityType: string,
  entityId: string | null,
  storeId: string | null,
  changes: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(actor_id, store_id, action, entity_type, entity_id, changes, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::inet)`,
    [req.user?.id ?? null, storeId, action, entityType, entityId, JSON.stringify(changes ?? {}), req.ip ?? null],
  );
}

export function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: 'Invalid request', details: error.flatten() });
}
