import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { accessibleStoreIds, assertStoreAccess, asyncRoute, pageValues, sendValidationError, writeAudit } from '../domain/http';
import { pool } from '../db/pool';

export const operationsRouter = Router();
operationsRouter.use(requireAuth);

operationsRouter.get('/expenses', requirePermission('expenses:read'), asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageValues(req);
  const stores = accessibleStoreIds(req);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const result = await pool.query(
    `SELECT e.id, e.store_id AS "storeId", s.name AS "storeName", e.category, e.description, e.amount,
            e.payment_method AS "paymentMethod", e.reference, e.incurred_at AS "incurredAt", u.full_name AS "createdBy"
     FROM expenses e JOIN stores s ON s.id = e.store_id JOIN users u ON u.id = e.created_by
     WHERE ($1::uuid[] IS NULL OR e.store_id = ANY($1))
       AND ($2 = '' OR e.category ILIKE '%' || $2 || '%' OR e.description ILIKE '%' || $2 || '%' OR e.reference ILIKE '%' || $2 || '%' OR s.name ILIKE '%' || $2 || '%')
     ORDER BY e.incurred_at DESC LIMIT $3 OFFSET $4`, [stores, search, pageSize, offset],
  );
  res.json({ items: result.rows, page, pageSize });
}));

operationsRouter.post('/expenses', requirePermission('expenses:write'), asyncRoute(async (req, res) => {
  const parsed = z.object({ storeId: z.string().uuid(), category: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(500), amount: z.number().positive(), paymentMethod: z.enum(['cash','card','upi','bank','other']), reference: z.string().max(100).optional() }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const d = parsed.data;
  await assertStoreAccess(req, d.storeId);
  if (d.paymentMethod === 'cash') {
    const drawer = await pool.query("SELECT id FROM cash_sessions WHERE store_id = $1 AND status = 'open'", [d.storeId]);
    if (!drawer.rowCount) { res.status(409).json({ error: 'Open a cash session before recording a cash expense' }); return; }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expense = await client.query(
      `INSERT INTO expenses(store_id, category, description, amount, payment_method, reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [d.storeId, d.category, d.description, d.amount, d.paymentMethod, d.reference ?? null, req.user!.id],
    );
    await writeAudit(client, req, 'created', 'expense', expense.rows[0].id, d.storeId, d);
    await client.query('COMMIT');
    res.status(201).json(expense.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

operationsRouter.get('/cash/current', requirePermission('cash:manage'), asyncRoute(async (req, res) => {
  const stores = accessibleStoreIds(req);
  const result = await pool.query(
    `SELECT cs.id, cs.store_id AS "storeId", s.name AS "storeName", cs.opening_cash AS "openingCash", cs.opened_at AS "openedAt",
            cs.opened_by AS "openedBy", COALESCE(sum(p.amount) FILTER (WHERE p.method = 'cash' AND p.status = 'captured'),0)::numeric(14,2) AS "cashSales"
     FROM cash_sessions cs JOIN stores s ON s.id = cs.store_id
     LEFT JOIN sales sale ON sale.store_id = cs.store_id AND sale.created_at >= cs.opened_at AND sale.status = 'completed'
     LEFT JOIN payments p ON p.sale_id = sale.id
     WHERE cs.status = 'open' AND ($1::uuid[] IS NULL OR cs.store_id = ANY($1))
     GROUP BY cs.id, s.name ORDER BY cs.opened_at DESC`, [stores],
  );
  res.json(result.rows);
}));

operationsRouter.post('/cash/open', requirePermission('cash:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({ storeId: z.string().uuid(), openingCash: z.number().min(0), note: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  await assertStoreAccess(req, parsed.data.storeId);
  const result = await pool.query(
    'INSERT INTO cash_sessions(store_id, opened_by, opening_cash, note) VALUES ($1,$2,$3,$4) RETURNING id, store_id AS "storeId", status, opening_cash AS "openingCash", opened_at AS "openedAt"',
    [parsed.data.storeId, req.user!.id, parsed.data.openingCash, parsed.data.note ?? null],
  );
  res.status(201).json(result.rows[0]);
}));

operationsRouter.post('/cash/:id/close', requirePermission('cash:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({ countedCash: z.number().min(0), note: z.string().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await client.query('SELECT * FROM cash_sessions WHERE id = $1 AND status = \'open\' FOR UPDATE', [req.params.id]);
    if (!session.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Open cash session not found' }); return; }
    await assertStoreAccess(req, session.rows[0].store_id);
    const cashSales = await client.query(
      `SELECT
         COALESCE((SELECT sum(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
           WHERE s.store_id = $1 AND s.status = 'completed' AND s.created_at >= $2 AND p.method = 'cash' AND p.status = 'captured'),0)
         - COALESCE((SELECT sum(p.amount) FROM payments p JOIN sales_returns r ON r.sale_id = p.sale_id
           WHERE r.store_id = $1 AND r.created_at >= $2 AND r.refund_method = 'cash' AND p.status = 'refunded'
             AND p.provider_reference = r.reference),0)
         - COALESCE((SELECT sum(e.amount) FROM expenses e WHERE e.store_id = $1 AND e.incurred_at >= $2 AND e.payment_method = 'cash'),0)
         AS total`,
      [session.rows[0].store_id, session.rows[0].opened_at],
    );
    const expected = Number(session.rows[0].opening_cash) + Number(cashSales.rows[0].total);
    const result = await client.query(
      `UPDATE cash_sessions SET status = 'closed', closed_by = $2, expected_cash = $3, counted_cash = $4, closed_at = now(), note = COALESCE($5,note)
       WHERE id = $1 RETURNING id, status, expected_cash AS "expectedCash", counted_cash AS "countedCash", closed_at AS "closedAt"`,
      [req.params.id, req.user!.id, expected, parsed.data.countedCash, parsed.data.note ?? null],
    );
    await writeAudit(client, req, 'closed', 'cash_session', req.params.id, session.rows[0].store_id, result.rows[0]);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

operationsRouter.post('/sales/returns', requirePermission('sales:return'), asyncRoute(async (req, res) => {
  const parsed = z.object({ saleId: z.string().uuid(), reason: z.string().trim().min(3).max(500), refundMethod: z.enum(['cash','card','upi','other']), items: z.array(z.object({ saleItemId: z.string().uuid(), quantity: z.number().positive() })).min(1) }).safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sale = await client.query('SELECT id, store_id, status FROM sales WHERE id = $1 FOR UPDATE', [parsed.data.saleId]);
    if (!sale.rowCount || !['completed','refunded'].includes(sale.rows[0].status)) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Completed sale not found' }); return; }
    await assertStoreAccess(req, sale.rows[0].store_id);
    if (parsed.data.refundMethod === 'cash') {
      const drawer = await client.query("SELECT id FROM cash_sessions WHERE store_id = $1 AND status = 'open' FOR UPDATE", [sale.rows[0].store_id]);
      if (!drawer.rowCount) throw Object.assign(new Error('Open a cash session before issuing a cash refund'), { status: 409 });
    }
    const returnId = randomUUID();
    const reference = `RET-${randomUUID().slice(0, 10).toUpperCase()}`;
    await client.query(
      'INSERT INTO sales_returns(id,sale_id,store_id,reference,reason,total_amount,created_by,refund_method) VALUES ($1,$2,$3,$4,$5,0,$6,$7)',
      [returnId, sale.rows[0].id, sale.rows[0].store_id, reference, parsed.data.reason, req.user!.id, parsed.data.refundMethod],
    );
    let refundTotal = 0;
    for (const line of parsed.data.items) {
      const saleItem = await client.query('SELECT id, product_id, quantity, line_total FROM sale_items WHERE id = $1 AND sale_id = $2 FOR UPDATE', [line.saleItemId, parsed.data.saleId]);
      if (!saleItem.rowCount) throw Object.assign(new Error('Sale line not found'), { status: 404 });
      const returned = await client.query('SELECT COALESCE(sum(quantity),0) AS quantity FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id WHERE sri.sale_item_id = $1 AND sr.status = \'completed\'', [line.saleItemId]);
      if (Number(returned.rows[0].quantity) + line.quantity > Number(saleItem.rows[0].quantity)) throw Object.assign(new Error('Return quantity exceeds the unreturned quantity'), { status: 409 });
      const unitNet = Number(saleItem.rows[0].line_total) / Number(saleItem.rows[0].quantity);
      const refund = Number((unitNet * line.quantity).toFixed(2));
      refundTotal += refund;
      await client.query('INSERT INTO sales_return_items(return_id, sale_item_id, quantity, refund_amount) VALUES ($1,$2,$3,$4)', [returnId, line.saleItemId, line.quantity, refund]);
      await client.query(
        `INSERT INTO stock_balances(store_id, product_id, quantity) VALUES ($1,$2,$3)
         ON CONFLICT (store_id, product_id) DO UPDATE SET quantity = stock_balances.quantity + EXCLUDED.quantity, updated_at = now()`,
        [sale.rows[0].store_id, saleItem.rows[0].product_id, line.quantity],
      );
      await client.query(
        `INSERT INTO stock_movements(store_id, product_id, movement_type, quantity_delta, reference_type, reference_id, created_by)
         VALUES ($1,$2,'return',$3,'sales_return',$4,$5)`, [sale.rows[0].store_id, saleItem.rows[0].product_id, line.quantity, returnId, req.user!.id],
      );
    }
    refundTotal = Number(refundTotal.toFixed(2));
    await client.query('UPDATE sales_returns SET total_amount = $2 WHERE id = $1', [returnId, refundTotal]);
    await client.query('INSERT INTO payments(sale_id,method,status,amount,provider_reference,paid_at) VALUES ($1,$2,\'refunded\',$3,$4,now())', [sale.rows[0].id, parsed.data.refundMethod, refundTotal, reference]);
    await writeAudit(client, req, 'returned', 'sales_return', returnId, sale.rows[0].store_id, { reference, refundTotal });
    await client.query('COMMIT');
    res.status(201).json({ id: returnId, reference, refundTotal, status: 'completed' });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
