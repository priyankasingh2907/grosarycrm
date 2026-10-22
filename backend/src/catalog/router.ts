import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { assertStoreAccess, asyncRoute, pageValues, sendValidationError, writeAudit } from '../domain/http';
import { pool } from '../db/pool';

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

catalogRouter.get('/categories', requirePermission('catalog:read'), asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT id, parent_id AS "parentId", name, code FROM categories WHERE is_active = true ORDER BY name');
  res.json(result.rows);
}));

catalogRouter.get('/units', requirePermission('catalog:read'), asyncRoute(async (_req, res) => {
  const result = await pool.query('SELECT id, name, abbreviation, precision FROM units ORDER BY name');
  res.json(result.rows);
}));

catalogRouter.get('/products', requirePermission('catalog:read'), asyncRoute(async (req, res) => {
  const { page, pageSize, offset } = pageValues(req);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : null;
  const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : null;
  if (storeId) await assertStoreAccess(req, storeId);
  const result = await pool.query(
    `SELECT p.id, p.sku, p.name, p.description, p.brand, p.tax_rate AS "taxRate",
            p.cost_price AS "costPrice", p.selling_price AS "sellingPrice", p.is_weighted AS "isWeighted",
            c.name AS "categoryName", u.abbreviation AS unit,
            (SELECT sb.quantity FROM stock_balances sb WHERE sb.product_id = p.id AND sb.store_id = $5::uuid) AS "stockQuantity"
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     JOIN units u ON u.id = p.base_unit_id
     WHERE p.is_active = true AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = $1))
       AND ($2::uuid IS NULL OR p.category_id = $2)
     ORDER BY p.name LIMIT $3 OFFSET $4`,
    [search, categoryId, pageSize, offset, storeId],
  );
  const count = await pool.query(
    `SELECT count(*)::int AS total FROM products p
     WHERE p.is_active = true AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = $1))
       AND ($2::uuid IS NULL OR p.category_id = $2)`,
    [search, categoryId],
  );
  res.json({ items: result.rows, page, pageSize, total: count.rows[0].total });
}));

const productSchema = z.object({
  sku: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200),
  categoryId: z.string().uuid().nullable().optional(), baseUnitId: z.string().uuid(),
  description: z.string().max(2000).nullable().optional(), brand: z.string().max(120).nullable().optional(),
  taxRate: z.number().min(0).max(100).default(0), costPrice: z.number().min(0), sellingPrice: z.number().min(0),
  isWeighted: z.boolean().default(false), barcode: z.string().trim().min(3).max(80).optional(),
});

catalogRouter.post('/products', requirePermission('catalog:write'), asyncRoute(async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) { sendValidationError(res, parsed.error); return; }
  const data = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO products(sku, name, category_id, base_unit_id, description, brand, tax_rate, cost_price, selling_price, is_weighted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [data.sku, data.name, data.categoryId ?? null, data.baseUnitId, data.description ?? null, data.brand ?? null, data.taxRate, data.costPrice, data.sellingPrice, data.isWeighted],
    );
    if (data.barcode) await client.query('INSERT INTO product_barcodes(product_id, barcode, unit_id) VALUES ($1,$2,$3)', [created.rows[0].id, data.barcode, data.baseUnitId]);
    await writeAudit(client, req, 'created', 'product', created.rows[0].id, null, data);
    await client.query('COMMIT');
    res.status(201).json(created.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));

catalogRouter.patch('/products/:id', requirePermission('catalog:write'), asyncRoute(async (req, res) => {
  const parsed = productSchema.partial().omit({ barcode: true }).safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    if (!parsed.success) sendValidationError(res, parsed.error);
    else res.status(400).json({ error: 'Provide at least one product field' });
    return;
  }
  const values = parsed.data;
  const result = await pool.query(
    `UPDATE products SET
       sku = COALESCE($2, sku), name = COALESCE($3, name), category_id = CASE WHEN $4::boolean THEN $5::uuid ELSE category_id END,
       base_unit_id = COALESCE($6, base_unit_id), description = CASE WHEN $7::boolean THEN $8::text ELSE description END,
       brand = CASE WHEN $9::boolean THEN $10::text ELSE brand END, tax_rate = COALESCE($11, tax_rate),
       cost_price = COALESCE($12, cost_price), selling_price = COALESCE($13, selling_price),
       is_weighted = COALESCE($14, is_weighted), updated_at = now()
     WHERE id = $1 AND is_active = true RETURNING *`,
    [req.params.id, values.sku ?? null, values.name ?? null, 'categoryId' in values, values.categoryId ?? null,
      values.baseUnitId ?? null, 'description' in values, values.description ?? null, 'brand' in values, values.brand ?? null,
      values.taxRate ?? null, values.costPrice ?? null, values.sellingPrice ?? null, values.isWeighted ?? null],
  );
  if (!result.rowCount) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json(result.rows[0]);
}));
