import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { assertStoreAccess, asyncRoute, pageValues, sendValidationError, writeAudit } from '../domain/http';
import { pool } from '../db/pool';

export const purchasingRouter = Router();
purchasingRouter.use(requireAuth);

purchasingRouter.get('/suppliers', requirePermission('purchasing:read'), asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT id, name, phone, email, tax_number AS "taxNumber", address FROM suppliers WHERE is_active = true ORDER BY name');
  res.json(result.rows);
}));

purchasingRouter.post('/suppliers', requirePermission('purchasing:write'), asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(200), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), taxNumber: z.string().max(80).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const d = parsed.data;
  const result = await pool.query('INSERT INTO suppliers(name, phone, email, tax_number) VALUES ($1,$2,$3,$4) RETURNING id, name, phone, email, tax_number AS "taxNumber"', [d.name, d.phone ?? null, d.email ?? null, d.taxNumber ?? null]);
  res.status(201).json(result.rows[0]);
}));

purchasingRouter.get('/', requirePermission('purchasing:read'), asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageValues(req);
  const storeIds = req.user!.roles.includes('super_admin') ? null : req.user!.storeIds;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const result = await pool.query(
    `SELECT p.id, p.store_id AS "storeId", s.name AS "storeName", p.reference, p.status,
            p.total_amount AS "totalAmount", p.created_at AS "createdAt", sp.name AS "supplierName"
     FROM purchases p JOIN stores s ON s.id = p.store_id JOIN suppliers sp ON sp.id = p.supplier_id
     WHERE ($1::uuid[] IS NULL OR p.store_id = ANY($1))
       AND ($2::text IS NULL OR p.status = $2)
       AND ($3 = '' OR p.reference ILIKE '%' || $3 || '%' OR sp.name ILIKE '%' || $3 || '%' OR s.name ILIKE '%' || $3 || '%')
     ORDER BY p.created_at DESC LIMIT $4 OFFSET $5`,
    [storeIds, status, search, pageSize, offset],
  );
  res.json({ items: result.rows, page, pageSize });
}));

purchasingRouter.get('/:id', requirePermission('purchasing:read'), asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT p.id, p.store_id AS "storeId", p.reference, p.status, p.subtotal, p.tax_amount AS "taxAmount", p.total_amount AS "totalAmount",
            sp.name AS "supplierName", pi.id AS "itemId", pi.product_id AS "productId", pr.name AS "productName",
            pi.quantity_ordered AS "quantityOrdered", pi.quantity_received AS "quantityReceived", pi.unit_cost AS "unitCost"
     FROM purchases p JOIN suppliers sp ON sp.id = p.supplier_id
     LEFT JOIN purchase_items pi ON pi.purchase_id = p.id LEFT JOIN products pr ON pr.id = pi.product_id WHERE p.id = $1`, [req.params.id],
  );
  if (!result.rowCount) { res.status(404).json({ error: 'Purchase not found' }); return; }
  await assertStoreAccess(req, result.rows[0].storeId);
  const { itemId, productId, productName, quantityOrdered, quantityReceived, unitCost, ...purchase } = result.rows[0];
  res.json({ ...purchase, items: result.rows.filter((row) => row.itemId).map((row) => ({ itemId: row.itemId, productId: row.productId, productName: row.productName, quantityOrdered: row.quantityOrdered, quantityReceived: row.quantityReceived, unitCost: row.unitCost })) });
}));

const purchaseSchema = z.object({
  storeId: z.string().uuid(), supplierId: z.string().uuid(), reference: z.string().trim().min(1).max(80),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().positive(), unitCost: z.number().nonnegative(), taxRate: z.number().min(0).max(100).default(0) })).min(1).max(500),
});

purchasingRouter.post('/', requirePermission('purchasing:write'), asyncRoute(async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const d = parsed.data;
  await assertStoreAccess(req, d.storeId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const purchase = await client.query(
      `INSERT INTO purchases(store_id, supplier_id, reference, status, created_by)
       VALUES ($1,$2,$3,'ordered',$4) RETURNING id`, [d.storeId, d.supplierId, d.reference, req.user!.id],
    );
    for (const item of d.items) {
      await client.query('INSERT INTO purchase_items(purchase_id, product_id, quantity_ordered, unit_cost, tax_rate) VALUES ($1,$2,$3,$4,$5)', [purchase.rows[0].id, item.productId, item.quantity, item.unitCost, item.taxRate]);
    }
    await client.query(
      `UPDATE purchases p SET subtotal = x.subtotal, tax_amount = x.tax, total_amount = x.subtotal + x.tax
       FROM (SELECT COALESCE(sum(quantity_ordered * unit_cost),0) AS subtotal,
                    COALESCE(sum(quantity_ordered * unit_cost * tax_rate / 100),0) AS tax
             FROM purchase_items WHERE purchase_id = $1) x WHERE p.id = $1`, [purchase.rows[0].id],
    );
    await writeAudit(client, req, 'created', 'purchase', purchase.rows[0].id, d.storeId, d);
    await client.query('COMMIT');
    res.status(201).json({ id: purchase.rows[0].id, status: 'ordered' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));

purchasingRouter.post('/:id/receive', requirePermission('purchasing:write'), asyncRoute(async (req, res) => {
  const parsed = z.object({ items: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().positive(), batchNumber: z.string().max(100).optional(), expiresAt: z.string().date().optional() })).min(1) }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const purchase = await client.query('SELECT id, store_id, status FROM purchases WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!purchase.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Purchase not found' }); return; }
    await assertStoreAccess(req, purchase.rows[0].store_id);
    if (['received', 'cancelled'].includes(purchase.rows[0].status)) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Purchase cannot receive items in its current status' }); return; }
    for (const received of parsed.data.items) {
      const itemResult = await client.query('SELECT id, product_id, quantity_ordered, quantity_received, unit_cost FROM purchase_items WHERE id = $1 AND purchase_id = $2 FOR UPDATE', [received.itemId, req.params.id]);
      if (!itemResult.rowCount || Number(itemResult.rows[0].quantity_received) + received.quantity > Number(itemResult.rows[0].quantity_ordered)) {
        await client.query('ROLLBACK'); res.status(409).json({ error: 'Received quantity exceeds the ordered quantity' }); return;
      }
      const item = itemResult.rows[0];
      await client.query('UPDATE purchase_items SET quantity_received = quantity_received + $2 WHERE id = $1', [item.id, received.quantity]);
      await client.query(
        `INSERT INTO stock_balances(store_id, product_id, quantity) VALUES ($1,$2,$3)
         ON CONFLICT (store_id, product_id) DO UPDATE SET quantity = stock_balances.quantity + EXCLUDED.quantity, updated_at = now()`,
        [purchase.rows[0].store_id, item.product_id, received.quantity],
      );
      await client.query(
        `INSERT INTO stock_movements(store_id, product_id, movement_type, quantity_delta, reference_type, reference_id, created_by)
         VALUES ($1,$2,'purchase',$3,'purchase',$4,$5)`,
        [purchase.rows[0].store_id, item.product_id, received.quantity, req.params.id, req.user!.id],
      );
      await client.query(
        `INSERT INTO product_batches(store_id, product_id, batch_number, received_quantity, remaining_quantity, unit_cost, expires_at)
         VALUES ($1,$2,$3,$4,$4,$5,$6)`,
        [purchase.rows[0].store_id, item.product_id, received.batchNumber ?? null, received.quantity, item.unit_cost, received.expiresAt ?? null],
      );
    }
    const remaining = await client.query('SELECT bool_and(quantity_received >= quantity_ordered) AS complete FROM purchase_items WHERE purchase_id = $1', [req.params.id]);
    const status = remaining.rows[0].complete ? 'received' : 'partially_received';
    await client.query('UPDATE purchases SET status = $2, received_at = CASE WHEN $2 = \'received\' THEN now() ELSE received_at END WHERE id = $1', [req.params.id, status]);
    await writeAudit(client, req, 'received', 'purchase', req.params.id, purchase.rows[0].store_id, parsed.data);
    await client.query('COMMIT');
    res.json({ id: req.params.id, status });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));
