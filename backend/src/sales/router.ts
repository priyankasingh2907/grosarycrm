import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { assertStoreAccess, asyncRoute, pageValues, sendValidationError, writeAudit } from '../domain/http';
import { pool } from '../db/pool';

export const salesRouter = Router();
salesRouter.use(requireAuth);

salesRouter.get('/', requirePermission('sales:read'), asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageValues(req);
  const storeIds = req.user!.roles.includes('super_admin') ? null : req.user!.storeIds;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const result = await pool.query(
    `SELECT s.id, s.store_id AS "storeId", st.name AS "storeName", s.invoice_number AS "invoiceNumber",
            s.status, s.total_amount AS "totalAmount", s.created_at AS "createdAt", c.name AS "customerName"
     FROM sales s JOIN stores st ON st.id = s.store_id LEFT JOIN customers c ON c.id = s.customer_id
     WHERE ($1::uuid[] IS NULL OR s.store_id = ANY($1))
       AND ($2::text IS NULL OR s.status = $2)
       AND ($3 = '' OR s.invoice_number ILIKE '%' || $3 || '%' OR c.name ILIKE '%' || $3 || '%' OR st.name ILIKE '%' || $3 || '%')
     ORDER BY s.created_at DESC LIMIT $4 OFFSET $5`,
    [storeIds, status, search, pageSize, offset],
  );
  res.json({ items: result.rows, page, pageSize });
}));

salesRouter.get('/:id', requirePermission('sales:read'), asyncRoute(async (req, res) => {
  const sale = await pool.query(
    `SELECT s.id, s.store_id AS "storeId", s.invoice_number AS "invoiceNumber", s.status, s.subtotal,
            s.discount_amount AS "discountAmount", s.tax_amount AS "taxAmount", s.total_amount AS "totalAmount",
            s.created_at AS "createdAt", c.name AS "customerName"
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = $1`, [req.params.id],
  );
  if (!sale.rowCount) { res.status(404).json({ error: 'Sale not found' }); return; }
  await assertStoreAccess(req, sale.rows[0].storeId);
  const items = await pool.query(
    `SELECT si.id, si.product_id AS "productId", p.name AS "productName", si.quantity,
            si.line_total AS "lineTotal", si.unit_price AS "unitPrice", si.tax_rate AS "taxRate",
            COALESCE((SELECT sum(sri.quantity) FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
                      WHERE sri.sale_item_id = si.id AND sr.status = 'completed'),0) AS "returnedQuantity"
     FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1 ORDER BY p.name`, [req.params.id],
  );
  res.json({ ...sale.rows[0], items: items.rows });
}));

salesRouter.get('/invoices/:id', requirePermission('sales:read'), asyncRoute(async (req, res) => {
  const invoice = await pool.query(
    `SELECT i.id, i.invoice_number AS "invoiceNumber", i.issued_at AS "issuedAt", s.id AS "saleId",
            s.store_id AS "storeId", s.subtotal, s.discount_amount AS "discountAmount", s.tax_amount AS "taxAmount", s.total_amount AS "totalAmount",
            st.name AS "storeName", st.address AS "storeAddress", c.name AS "customerName", c.phone AS "customerPhone"
     FROM invoices i JOIN sales s ON s.id = i.sale_id JOIN stores st ON st.id = s.store_id LEFT JOIN customers c ON c.id = s.customer_id
     WHERE i.id = $1 OR i.sale_id = $1`, [req.params.id],
  );
  if (!invoice.rowCount) { res.status(404).json({ error: 'Invoice not found' }); return; }
  await assertStoreAccess(req, invoice.rows[0].storeId);
  const items = await pool.query(
    `SELECT p.sku, p.name, si.quantity, si.unit_price AS "unitPrice", si.discount_amount AS "discountAmount", si.tax_rate AS "taxRate", si.line_total AS "lineTotal"
     FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1 ORDER BY p.name`, [invoice.rows[0].saleId],
  );
  const payments = await pool.query('SELECT method, status, amount, provider_reference AS "providerReference", paid_at AS "paidAt" FROM payments WHERE sale_id = $1', [invoice.rows[0].saleId]);
  res.json({ ...invoice.rows[0], items: items.rows, payments: payments.rows });
}));

const checkoutSchema = z.object({
  storeId: z.string().uuid(), customerId: z.string().uuid().nullable().optional(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().positive(), discountAmount: z.number().min(0).default(0) })).min(1).max(100),
  payments: z.array(z.object({ method: z.enum(['cash', 'card', 'upi', 'other']), amount: z.number().positive(), providerReference: z.string().max(200).optional() })).min(1),
});

salesRouter.post('/checkout', requirePermission('sales:write'), asyncRoute(async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const data = parsed.data;
  await assertStoreAccess(req, data.storeId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (data.payments.some((payment) => payment.method === 'cash')) {
      const drawer = await client.query("SELECT id FROM cash_sessions WHERE store_id = $1 AND status = 'open' FOR UPDATE", [data.storeId]);
      if (!drawer.rowCount) throw Object.assign(new Error('Open a cash session before accepting cash'), { status: 409 });
    }
    const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const sale = await client.query(
      `INSERT INTO sales(store_id, customer_id, invoice_number, status, created_by)
       VALUES ($1,$2,$3,'draft',$4) RETURNING id`,
      [data.storeId, data.customerId ?? null, invoiceNumber, req.user!.id],
    );
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let total = 0;
    for (const line of data.items) {
      const product = await client.query(
        'SELECT id, name, selling_price, tax_rate FROM products WHERE id = $1 AND is_active = true', [line.productId],
      );
      if (!product.rowCount) throw Object.assign(new Error('Product not found or inactive'), { status: 404 });
      const stockResult = await client.query(
        'SELECT quantity FROM stock_balances WHERE store_id = $1 AND product_id = $2 FOR UPDATE', [data.storeId, line.productId],
      );
      const stock = Number(stockResult.rows[0]?.quantity ?? 0);
      if (stock < line.quantity) throw Object.assign(new Error(`Insufficient stock for ${product.rows[0].name}`), { status: 409, available: stock });
      if (line.discountAmount > 0 && !req.user!.permissions.includes('sales:discount')) {
        throw Object.assign(new Error('Your role cannot apply checkout discounts'), { status: 403 });
      }
      const unitPrice = Number(product.rows[0].selling_price);
      const taxRate = Number(product.rows[0].tax_rate);
      const gross = Number((unitPrice * line.quantity).toFixed(2));
      if (line.discountAmount > gross) throw Object.assign(new Error('Line discount exceeds line value'), { status: 400 });
      const taxable = gross - line.discountAmount;
      const lineTax = Number((taxable * taxRate / 100).toFixed(2));
      const lineTotal = Number((taxable + lineTax).toFixed(2));
      subtotal += gross;
      discountTotal += line.discountAmount;
      taxTotal += lineTax;
      total += lineTotal;
      await client.query(
        `INSERT INTO sale_items(sale_id, product_id, quantity, unit_price, discount_amount, tax_rate, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sale.rows[0].id, line.productId, line.quantity, unitPrice, line.discountAmount, taxRate, lineTotal],
      );
      await client.query('UPDATE stock_balances SET quantity = quantity - $3, updated_at = now() WHERE store_id = $1 AND product_id = $2', [data.storeId, line.productId, line.quantity]);
      await client.query(
        `INSERT INTO stock_movements(store_id, product_id, movement_type, quantity_delta, reference_type, reference_id, created_by)
         VALUES ($1,$2,'sale',$3,'sale',$4,$5)`, [data.storeId, line.productId, -line.quantity, sale.rows[0].id, req.user!.id],
      );
    }
    subtotal = Number(subtotal.toFixed(2));
    discountTotal = Number(discountTotal.toFixed(2));
    taxTotal = Number(taxTotal.toFixed(2));
    total = Number(total.toFixed(2));
    const paymentTotal = Number(data.payments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2));
    if (paymentTotal !== total) throw Object.assign(new Error('Payment total must equal the sale total'), { status: 400, due: Number((total - paymentTotal).toFixed(2)) });
    for (const payment of data.payments) {
      await client.query(
        `INSERT INTO payments(sale_id, method, status, amount, provider_reference, paid_at)
         VALUES ($1,$2,'captured',$3,$4,now())`, [sale.rows[0].id, payment.method, payment.amount, payment.providerReference ?? null],
      );
    }
    await client.query(
      'UPDATE sales SET status = \'completed\', subtotal = $2, discount_amount = $3, tax_amount = $4, total_amount = $5 WHERE id = $1',
      [sale.rows[0].id, subtotal, discountTotal, taxTotal, total],
    );
    const invoice = await client.query('INSERT INTO invoices(sale_id, invoice_number) VALUES ($1,$2) RETURNING id', [sale.rows[0].id, invoiceNumber]);
    await writeAudit(client, req, 'checkout', 'sale', sale.rows[0].id, data.storeId, { invoiceNumber, total, itemCount: data.items.length });
    await client.query('COMMIT');
    res.status(201).json({ saleId: sale.rows[0].id, invoiceId: invoice.rows[0].id, invoiceNumber, subtotal, discountAmount: discountTotal, taxAmount: taxTotal, totalAmount: total });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));
