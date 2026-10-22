CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, code text NOT NULL UNIQUE,
  phone text, email text, address jsonb NOT NULL DEFAULT '{}', timezone text NOT NULL DEFAULT 'UTC',
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, full_name text NOT NULL,
  phone text, password_hash text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE roles (id smallserial PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE permissions (id smallserial PRIMARY KEY, code text NOT NULL UNIQUE, description text NOT NULL);
CREATE TABLE role_permissions (role_id smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission_id smallint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE, PRIMARY KEY (role_id, permission_id));
CREATE TABLE user_roles (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_id smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE, PRIMARY KEY (user_id, role_id));
CREATE TABLE user_stores (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE, PRIMARY KEY (user_id, store_id));
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid REFERENCES categories(id), name text NOT NULL,
  code text UNIQUE, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, abbreviation text NOT NULL UNIQUE,
  precision smallint NOT NULL DEFAULT 0 CHECK (precision BETWEEN 0 AND 6)
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category_id uuid REFERENCES categories(id), base_unit_id uuid NOT NULL REFERENCES units(id),
  sku text NOT NULL UNIQUE, name text NOT NULL, description text, brand text, tax_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  cost_price numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_price >= 0), selling_price numeric(14,4) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  is_weighted boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode text NOT NULL UNIQUE, unit_id uuid NOT NULL REFERENCES units(id), quantity_per_barcode numeric(14,4) NOT NULL DEFAULT 1 CHECK (quantity_per_barcode > 0)
);
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, phone text, email text, tax_number text,
  address jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id), supplier_id uuid NOT NULL REFERENCES suppliers(id),
  reference text NOT NULL, status text NOT NULL CHECK (status IN ('draft','ordered','partially_received','received','cancelled')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0, tax_amount numeric(14,2) NOT NULL DEFAULT 0, total_amount numeric(14,2) NOT NULL DEFAULT 0,
  ordered_at timestamptz, received_at timestamptz, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(store_id, reference)
);
CREATE TABLE purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id), quantity_ordered numeric(14,4) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0), unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0), tax_rate numeric(7,4) NOT NULL DEFAULT 0
);
CREATE TABLE stock_balances (
  store_id uuid NOT NULL REFERENCES stores(id), product_id uuid NOT NULL REFERENCES products(id),
  quantity numeric(14,4) NOT NULL DEFAULT 0, reorder_level numeric(14,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (store_id, product_id)
);
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id), product_id uuid NOT NULL REFERENCES products(id),
  movement_type text NOT NULL CHECK (movement_type IN ('purchase','sale','adjustment','transfer_in','transfer_out','return')),
  quantity_delta numeric(14,4) NOT NULL CHECK (quantity_delta <> 0), unit_cost numeric(14,4), reference_type text, reference_id uuid,
  note text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, phone text UNIQUE, email text, tax_number text,
  address jsonb NOT NULL DEFAULT '{}', loyalty_points integer NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id), customer_id uuid REFERENCES customers(id),
  invoice_number text NOT NULL, status text NOT NULL CHECK (status IN ('draft','completed','cancelled','refunded')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0, discount_amount numeric(14,2) NOT NULL DEFAULT 0, tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, invoice_number)
);
CREATE TABLE sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id), quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0), discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(7,4) NOT NULL DEFAULT 0, line_total numeric(14,2) NOT NULL
);
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL UNIQUE REFERENCES sales(id), invoice_number text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz, pdf_storage_key text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL REFERENCES sales(id), method text NOT NULL CHECK (method IN ('cash','card','upi','razorpay','other')),
  status text NOT NULL CHECK (status IN ('pending','authorized','captured','failed','refunded')), amount numeric(14,2) NOT NULL CHECK (amount > 0),
  provider_reference text, idempotency_key text UNIQUE, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), store_id uuid REFERENCES stores(id), action text NOT NULL,
  entity_type text NOT NULL, entity_id uuid, changes jsonb NOT NULL DEFAULT '{}', ip_address inet, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_category_idx ON products(category_id);
CREATE INDEX stock_low_idx ON stock_balances(store_id, quantity) WHERE quantity <= reorder_level;
CREATE INDEX sales_store_created_idx ON sales(store_id, created_at DESC);
CREATE INDEX purchases_store_status_idx ON purchases(store_id, status);
CREATE INDEX stock_movements_product_created_idx ON stock_movements(store_id, product_id, created_at DESC);
CREATE INDEX audit_entity_created_idx ON audit_events(entity_type, entity_id, created_at DESC);
