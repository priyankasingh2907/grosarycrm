import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './pool';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO roles(code, name) VALUES ('super_admin','Super Admin'), ('store_manager','Store Manager'), ('inventory_staff','Inventory Staff'), ('seller','Seller'), ('cashier','Cashier'), ('data_entry','Data Entry'), ('accountant','Accountant') ON CONFLICT (code) DO NOTHING");
    await client.query(`
      INSERT INTO permissions(code, description) VALUES
        ('dashboard:read','View role-scoped dashboard'), ('stores:read','View stores'),
        ('inventory:read','View inventory'), ('inventory:write','Adjust inventory'),
        ('catalog:read','View product catalog'), ('catalog:write','Manage product catalog'),
        ('purchasing:read','View purchases'), ('purchasing:write','Manage purchases'),
        ('sales:read','View sales'), ('sales:write','Create and manage sales'), ('sales:discount','Apply checkout discounts'),
        ('customers:read','View customers'), ('customers:write','Manage customers'),
        ('reports:read','View reports'), ('users:manage','Manage users and roles'),
        ('roles:manage','Create and manage roles'), ('stores:manage','Create and manage stores'),
        ('cash:manage','Open and close cash sessions'), ('expenses:read','View store expenses'),
        ('expenses:write','Record store expenses'), ('sales:return','Process sales returns'),
        ('inventory:transfer','Transfer stock between stores')
      ON CONFLICT (code) DO NOTHING
    `);
    await client.query(`
      INSERT INTO role_permissions(role_id, permission_id)
      SELECT r.id, p.id
      FROM (VALUES
        ('super_admin', ARRAY['dashboard:read','stores:read','stores:manage','inventory:read','inventory:write','inventory:transfer','catalog:read','catalog:write','purchasing:read','purchasing:write','sales:read','sales:write','sales:discount','sales:return','customers:read','customers:write','reports:read','users:manage','roles:manage','cash:manage','expenses:read','expenses:write']::text[]),
        ('store_manager', ARRAY['dashboard:read','stores:read','inventory:read','inventory:write','inventory:transfer','catalog:read','catalog:write','purchasing:read','purchasing:write','sales:read','sales:write','sales:discount','sales:return','customers:read','customers:write','reports:read','cash:manage','expenses:read','expenses:write']::text[]),
        ('inventory_staff', ARRAY['dashboard:read','stores:read','inventory:read','inventory:write','inventory:transfer','catalog:read','purchasing:read','purchasing:write']::text[]),
        ('seller', ARRAY['dashboard:read','stores:read','catalog:read','sales:read','sales:write','customers:read','customers:write','cash:manage']::text[]),
        ('cashier', ARRAY['dashboard:read','stores:read','catalog:read','sales:read','sales:write','customers:read','customers:write','cash:manage']::text[]),
        ('data_entry', ARRAY['dashboard:read','stores:read','catalog:read','catalog:write','customers:read','customers:write']::text[]),
        ('accountant', ARRAY['dashboard:read','purchasing:read','sales:read','reports:read','expenses:read']::text[])
      ) AS grants(role_code, permission_codes)
      JOIN roles r ON r.code = grants.role_code
      CROSS JOIN LATERAL unnest(grants.permission_codes) AS granted(permission_code)
      JOIN permissions p ON p.code = granted.permission_code
      ON CONFLICT DO NOTHING
    `);
    await client.query("INSERT INTO stores(name, code) VALUES ('Main Store','MAIN') ON CONFLICT (code) DO NOTHING");
    await client.query("INSERT INTO units(name, abbreviation, precision) VALUES ('Each','ea',0),('Kilogram','kg',3),('Litre','L',3) ON CONFLICT (abbreviation) DO NOTHING");
    await client.query("INSERT INTO categories(name, code) VALUES ('Fresh Produce','PRODUCE'),('Pantry','PANTRY'),('Dairy','DAIRY') ON CONFLICT (code) DO NOTHING");
    const mainStore = await client.query("SELECT id FROM stores WHERE code = 'MAIN'");
    const produce = await client.query("SELECT id FROM categories WHERE code = 'PRODUCE'");
    const pantry = await client.query("SELECT id FROM categories WHERE code = 'PANTRY'");
    const each = await client.query("SELECT id FROM units WHERE abbreviation = 'ea'");
    const kilogram = await client.query("SELECT id FROM units WHERE abbreviation = 'kg'");
    const supplier = await client.query("SELECT id FROM suppliers WHERE name = 'Local Wholesale' LIMIT 1");
    const supplierId = supplier.rows[0]?.id ?? (await client.query("INSERT INTO suppliers(name, phone) VALUES ('Local Wholesale','0000000000') RETURNING id")).rows[0].id;
    const demoProducts = [
      ['APL-001','Apples',produce.rows[0].id,kilogram.rows[0].id,2.4,3.5,'APPLE-DEMO'],
      ['MLK-001','Whole Milk 1L',produce.rows[0].id,each.rows[0].id,1.1,1.75,'MILK-DEMO'],
      ['RIC-001','Long Grain Rice 1kg',pantry.rows[0].id,each.rows[0].id,2.1,3.25,'RICE-DEMO'],
    ] as const;
    for (const [sku, name, categoryId, unitId, cost, price, barcode] of demoProducts) {
      let product = await client.query('SELECT id FROM products WHERE sku = $1', [sku]);
      if (!product.rowCount) {
        product = await client.query(
          `INSERT INTO products(sku,name,category_id,base_unit_id,cost_price,selling_price) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [sku, name, categoryId, unitId, cost, price],
        );
        await client.query('INSERT INTO product_barcodes(product_id, barcode, unit_id) VALUES ($1,$2,$3) ON CONFLICT (barcode) DO NOTHING', [product.rows[0].id, barcode, unitId]);
      }
      await client.query(
        'INSERT INTO stock_balances(store_id,product_id,quantity,reorder_level) VALUES ($1,$2,50,10) ON CONFLICT (store_id,product_id) DO NOTHING',
        [mainStore.rows[0].id, product.rows[0].id],
      );
    }
    const user = await client.query(
      "INSERT INTO users(email, full_name, password_hash) VALUES ('admin@grocery.local','Local Admin',$1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id",
      [await bcrypt.hash('ChangeMe123!', 12)],
    );
    await client.query("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE code = 'super_admin' ON CONFLICT DO NOTHING", [user.rows[0].id]);
    await client.query("INSERT INTO user_stores(user_id, store_id) SELECT $1, id FROM stores WHERE code = 'MAIN' ON CONFLICT DO NOTHING", [user.rows[0].id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => { console.error(error); process.exitCode = 1; });
