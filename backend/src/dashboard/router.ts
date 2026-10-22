import { Router } from 'express';
import { requireAuth, requirePermission } from '../auth/middleware';
import { pool } from '../db/pool';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', requireAuth, requirePermission('dashboard:read'), async (req, res, next) => {
  try {
    const isAdmin = req.user!.roles.includes('super_admin');
    const storeIds = req.user!.storeIds;
    if (!isAdmin && storeIds.length === 0) {
      res.json({ role: req.user!.roles, stores: 0, lowStockProducts: 0, todaySales: 0, pendingPurchases: 0 });
      return;
    }

    const storeFilter = isAdmin ? null : storeIds;
    const [stores, lowStock, sales, purchases] = await Promise.all([
      pool.query('SELECT count(*)::int AS value FROM stores WHERE ($1::uuid[] IS NULL OR id = ANY($1)) AND is_active = true', [storeFilter]),
      pool.query(`SELECT count(*)::int AS value FROM stock_balances sb
                  WHERE sb.quantity <= sb.reorder_level AND ($1::uuid[] IS NULL OR sb.store_id = ANY($1))`, [storeFilter]),
      pool.query(`SELECT COALESCE(sum(s.total_amount), 0)::numeric(14,2) AS value FROM sales s
                  WHERE s.status = 'completed' AND s.created_at >= current_date
                  AND ($1::uuid[] IS NULL OR s.store_id = ANY($1))`, [storeFilter]),
      pool.query(`SELECT count(*)::int AS value FROM purchases p
                  WHERE p.status IN ('draft', 'ordered', 'partially_received')
                  AND ($1::uuid[] IS NULL OR p.store_id = ANY($1))`, [storeFilter]),
    ]);

    res.json({
      role: req.user!.roles,
      stores: stores.rows[0].value,
      lowStockProducts: lowStock.rows[0].value,
      todaySales: sales.rows[0].value,
      pendingPurchases: purchases.rows[0].value,
    });
  } catch (error) {
    next(error);
  }
});
