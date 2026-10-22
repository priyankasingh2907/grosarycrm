import { Router } from 'express';
import { requireAuth, requirePermission } from '../auth/middleware';
import { accessibleStoreIds, asyncRoute } from '../domain/http';
import { pool } from '../db/pool';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePermission('reports:read'));

reportsRouter.get('/sales-daily', asyncRoute(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const stores = accessibleStoreIds(req);
  const result = await pool.query(
    `SELECT date_trunc('day', created_at)::date AS date, count(*)::int AS "transactionCount",
            sum(total_amount)::numeric(14,2) AS sales, sum(tax_amount)::numeric(14,2) AS tax
     FROM sales WHERE status = 'completed' AND created_at >= current_date - ($1::int - 1)
       AND ($2::uuid[] IS NULL OR store_id = ANY($2))
     GROUP BY date_trunc('day', created_at)::date ORDER BY date`, [days, stores],
  );
  res.json(result.rows);
}));

reportsRouter.get('/top-products', asyncRoute(async (req, res) => {
  const stores = accessibleStoreIds(req);
  const result = await pool.query(
    `SELECT p.id, p.sku, p.name, sum(si.quantity)::numeric(14,4) AS quantity,
            sum(si.line_total)::numeric(14,2) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.status = 'completed' AND s.created_at >= current_date - interval '30 days'
       AND ($1::uuid[] IS NULL OR s.store_id = ANY($1))
     GROUP BY p.id ORDER BY revenue DESC LIMIT 20`, [stores],
  );
  res.json(result.rows);
}));

reportsRouter.get('/audit', asyncRoute(async (req, res) => {
  const stores = accessibleStoreIds(req);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const result = await pool.query(
    `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.changes,
            a.created_at AS "createdAt", u.full_name AS "actorName", st.name AS "storeName"
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN stores st ON st.id = a.store_id
     WHERE ($1::uuid[] IS NULL OR a.store_id IS NULL OR a.store_id = ANY($1))
     ORDER BY a.created_at DESC LIMIT $2`, [stores, limit],
  );
  res.json(result.rows);
}));
