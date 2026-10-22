import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { accessibleStoreIds, assertStoreAccess, asyncRoute, pageValues, sendValidationError, writeAudit } from '../domain/http';
import { pool } from '../db/pool';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/balances', requirePermission('inventory:read'), asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageValues(req);
  const stores = accessibleStoreIds(req);
  const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (storeId) await assertStoreAccess(req, storeId);
  const result = await pool.query(
    `SELECT sb.store_id AS "storeId", s.name AS "storeName", p.id AS "productId", p.sku, p.name AS "productName",
            u.abbreviation AS unit, sb.quantity, sb.reorder_level AS "reorderLevel", sb.updated_at AS "updatedAt"
     FROM stock_balances sb JOIN stores s ON s.id = sb.store_id JOIN products p ON p.id = sb.product_id JOIN units u ON u.id = p.base_unit_id
     WHERE ($1::uuid[] IS NULL OR sb.store_id = ANY($1)) AND ($2::uuid IS NULL OR sb.store_id = $2)
       AND ($3::boolean = false OR sb.quantity <= sb.reorder_level)
       AND ($4 = '' OR p.name ILIKE '%' || $4 || '%' OR p.sku ILIKE '%' || $4 || '%')
     ORDER BY s.name, p.name LIMIT $5 OFFSET $6`,
    [stores, storeId, req.query.lowStock === 'true', search, pageSize, offset],
  );
  res.json({ items: result.rows, page, pageSize });
}));

inventoryRouter.get('/movements', requirePermission('inventory:read'), asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageValues(req);
  const stores = accessibleStoreIds(req);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const result = await pool.query(
    `SELECT m.id, m.store_id AS "storeId", s.name AS "storeName", p.sku, p.name AS "productName",
            m.movement_type AS type, m.quantity_delta AS quantity, m.reference_type AS "referenceType",
            m.note, m.created_at AS "createdAt", u.full_name AS "createdBy"
     FROM stock_movements m JOIN stores s ON s.id = m.store_id JOIN products p ON p.id = m.product_id
     LEFT JOIN users u ON u.id = m.created_by WHERE ($1::uuid[] IS NULL OR m.store_id = ANY($1))
       AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%' OR s.name ILIKE '%' || $2 || '%')
     ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`, [stores, search, pageSize, offset],
  );
  res.json({ items: result.rows, page, pageSize });
}));

inventoryRouter.get('/expiring', requirePermission('inventory:read'), asyncRoute(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 180);
  const stores = accessibleStoreIds(req);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const result = await pool.query(
    `SELECT b.id, b.store_id AS "storeId", s.name AS "storeName", b.product_id AS "productId", p.sku,
            p.name AS "productName", b.batch_number AS "batchNumber", b.remaining_quantity AS quantity,
            b.expires_at AS "expiresAt", (b.expires_at - current_date) AS "daysRemaining"
     FROM product_batches b JOIN products p ON p.id = b.product_id JOIN stores s ON s.id = b.store_id
     WHERE b.remaining_quantity > 0 AND b.expires_at <= current_date + $1::int
       AND ($2::uuid[] IS NULL OR b.store_id = ANY($2))
       AND ($3 = '' OR p.name ILIKE '%' || $3 || '%' OR p.sku ILIKE '%' || $3 || '%' OR b.batch_number ILIKE '%' || $3 || '%')
     ORDER BY b.expires_at LIMIT 200`, [days, stores, search],
  );
  res.json(result.rows);
}));

inventoryRouter.get('/transfers', requirePermission('inventory:transfer'), asyncRoute(async (req, res) => {
  const stores = accessibleStoreIds(req);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const result = await pool.query(
    `SELECT t.id, t.reference, t.status, t.created_at AS "createdAt", src.name AS "sourceStore", dst.name AS "destinationStore"
     FROM stock_transfers t JOIN stores src ON src.id = t.source_store_id JOIN stores dst ON dst.id = t.destination_store_id
     WHERE ($1::uuid[] IS NULL OR t.source_store_id = ANY($1) OR t.destination_store_id = ANY($1))
       AND ($2::text IS NULL OR t.status = $2)
       AND ($3 = '' OR t.reference ILIKE '%' || $3 || '%' OR src.name ILIKE '%' || $3 || '%' OR dst.name ILIKE '%' || $3 || '%')
     ORDER BY t.created_at DESC LIMIT 100`, [stores, status, search],
  );
  res.json(result.rows);
}));

inventoryRouter.post('/transfers', requirePermission('inventory:transfer'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    sourceStoreId: z.string().uuid(), destinationStoreId: z.string().uuid(), reference: z.string().trim().max(80).optional(),
    items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().positive() })).min(1).max(200),
  }).refine((data) => data.sourceStoreId !== data.destinationStoreId, { message: 'Stores must be different' }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const d = parsed.data;
  await assertStoreAccess(req, d.sourceStoreId);
  await assertStoreAccess(req, d.destinationStoreId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reference = d.reference || `TR-${randomUUID().slice(0, 10).toUpperCase()}`;
    const transfer = await client.query(
      `INSERT INTO stock_transfers(source_store_id,destination_store_id,status,reference,created_by,shipped_at)
       VALUES ($1,$2,'shipped',$3,$4,now()) RETURNING id`, [d.sourceStoreId, d.destinationStoreId, reference, req.user!.id],
    );
    for (const item of d.items) {
      const balance = await client.query('SELECT quantity FROM stock_balances WHERE store_id = $1 AND product_id = $2 FOR UPDATE', [d.sourceStoreId, item.productId]);
      if (!balance.rowCount || Number(balance.rows[0].quantity) < item.quantity) throw Object.assign(new Error('Insufficient source stock for transfer'), { status: 409, available: Number(balance.rows[0]?.quantity ?? 0) });
      await client.query('UPDATE stock_balances SET quantity = quantity - $3, updated_at = now() WHERE store_id = $1 AND product_id = $2', [d.sourceStoreId, item.productId, item.quantity]);
      await client.query('INSERT INTO stock_transfer_items(transfer_id,product_id,quantity_sent) VALUES ($1,$2,$3)', [transfer.rows[0].id, item.productId, item.quantity]);
      await client.query(
        `INSERT INTO stock_movements(store_id,product_id,movement_type,quantity_delta,reference_type,reference_id,created_by)
         VALUES ($1,$2,'transfer_out',$3,'stock_transfer',$4,$5)`, [d.sourceStoreId, item.productId, -item.quantity, transfer.rows[0].id, req.user!.id],
      );
    }
    await writeAudit(client, req, 'shipped', 'stock_transfer', transfer.rows[0].id, d.sourceStoreId, { destinationStoreId: d.destinationStoreId, reference });
    await client.query('COMMIT');
    res.status(201).json({ id: transfer.rows[0].id, reference, status: 'shipped' });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

inventoryRouter.post('/transfers/:id/receive', requirePermission('inventory:transfer'), asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const transfer = await client.query('SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!transfer.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Transfer not found' }); return; }
    await assertStoreAccess(req, transfer.rows[0].destination_store_id);
    if (transfer.rows[0].status !== 'shipped') { await client.query('ROLLBACK'); res.status(409).json({ error: 'Transfer is not awaiting receipt' }); return; }
    const items = await client.query('SELECT product_id, quantity_sent FROM stock_transfer_items WHERE transfer_id = $1 FOR UPDATE', [req.params.id]);
    for (const item of items.rows) {
      await client.query(
        `INSERT INTO stock_balances(store_id,product_id,quantity) VALUES ($1,$2,$3)
         ON CONFLICT (store_id,product_id) DO UPDATE SET quantity = stock_balances.quantity + EXCLUDED.quantity, updated_at = now()`,
        [transfer.rows[0].destination_store_id, item.product_id, item.quantity_sent],
      );
      await client.query('UPDATE stock_transfer_items SET quantity_received = quantity_sent WHERE transfer_id = $1 AND product_id = $2', [req.params.id, item.product_id]);
      await client.query(
        `INSERT INTO stock_movements(store_id,product_id,movement_type,quantity_delta,reference_type,reference_id,created_by)
         VALUES ($1,$2,'transfer_in',$3,'stock_transfer',$4,$5)`, [transfer.rows[0].destination_store_id, item.product_id, item.quantity_sent, req.params.id, req.user!.id],
      );
    }
    await client.query("UPDATE stock_transfers SET status = 'received', received_at = now() WHERE id = $1", [req.params.id]);
    await writeAudit(client, req, 'received', 'stock_transfer', req.params.id, transfer.rows[0].destination_store_id, {});
    await client.query('COMMIT');
    res.json({ id: req.params.id, status: 'received' });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

const adjustmentSchema = z.object({
  storeId: z.string().uuid(), productId: z.string().uuid(), quantityDelta: z.number().finite().refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(500), reorderLevel: z.number().min(0).optional(),
});

inventoryRouter.post('/adjustments', requirePermission('inventory:write'), asyncRoute(async (req, res) => {
  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const data = parsed.data;
  await assertStoreAccess(req, data.storeId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO stock_balances(store_id, product_id, quantity, reorder_level) VALUES ($1,$2,0,COALESCE($3,0))
       ON CONFLICT (store_id, product_id) DO NOTHING`, [data.storeId, data.productId, data.reorderLevel ?? null],
    );
    const balance = await client.query('SELECT quantity, reorder_level FROM stock_balances WHERE store_id = $1 AND product_id = $2 FOR UPDATE', [data.storeId, data.productId]);
    const nextQuantity = Number(balance.rows[0].quantity) + data.quantityDelta;
    if (nextQuantity < 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Adjustment would make stock negative', available: balance.rows[0].quantity });
      return;
    }
    await client.query(
      'UPDATE stock_balances SET quantity = $3, reorder_level = COALESCE($4, reorder_level), updated_at = now() WHERE store_id = $1 AND product_id = $2',
      [data.storeId, data.productId, nextQuantity, data.reorderLevel ?? null],
    );
    const movement = await client.query(
      `INSERT INTO stock_movements(store_id, product_id, movement_type, quantity_delta, note, created_by)
       VALUES ($1,$2,'adjustment',$3,$4,$5) RETURNING *`,
      [data.storeId, data.productId, data.quantityDelta, data.reason, req.user!.id],
    );
    await writeAudit(client, req, 'adjusted', 'stock', data.productId, data.storeId, data);
    await client.query('COMMIT');
    res.status(201).json({ movement: movement.rows[0], quantity: nextQuantity });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));
