CREATE TABLE cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id),
  opened_by uuid NOT NULL REFERENCES users(id), closed_by uuid REFERENCES users(id), status text NOT NULL CHECK (status IN ('open','closed')) DEFAULT 'open',
  opening_cash numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0), expected_cash numeric(14,2), counted_cash numeric(14,2),
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, note text,
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX cash_sessions_one_open_per_store ON cash_sessions(store_id) WHERE status = 'open';

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id),
  category text NOT NULL, description text NOT NULL, amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash','card','upi','bank','other')),
  reference text, incurred_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_store_incurred_idx ON expenses(store_id, incurred_at DESC);

CREATE TABLE stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_store_id uuid NOT NULL REFERENCES stores(id), destination_store_id uuid NOT NULL REFERENCES stores(id),
  status text NOT NULL CHECK (status IN ('draft','shipped','received','cancelled')) DEFAULT 'draft',
  reference text NOT NULL UNIQUE, note text, created_by uuid REFERENCES users(id), shipped_at timestamptz, received_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_store_id <> destination_store_id)
);
CREATE TABLE stock_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id), quantity_sent numeric(14,4) NOT NULL CHECK (quantity_sent > 0),
  quantity_received numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0 AND quantity_received <= quantity_sent), UNIQUE(transfer_id, product_id)
);

CREATE TABLE sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL REFERENCES sales(id), store_id uuid NOT NULL REFERENCES stores(id),
  reference text NOT NULL UNIQUE, status text NOT NULL CHECK (status IN ('completed','cancelled')) DEFAULT 'completed',
  reason text NOT NULL, total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  refund_method text NOT NULL CHECK (refund_method IN ('cash','card','upi','other')),
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), return_id uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES sale_items(id), quantity numeric(14,4) NOT NULL CHECK (quantity > 0), refund_amount numeric(14,2) NOT NULL CHECK (refund_amount >= 0)
);

CREATE TABLE product_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), store_id uuid NOT NULL REFERENCES stores(id), product_id uuid NOT NULL REFERENCES products(id),
  batch_number text, received_quantity numeric(14,4) NOT NULL CHECK (received_quantity >= 0), remaining_quantity numeric(14,4) NOT NULL CHECK (remaining_quantity >= 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0), manufactured_at date, expires_at date, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_batches_expiry_idx ON product_batches(store_id, expires_at) WHERE remaining_quantity > 0 AND expires_at IS NOT NULL;

CREATE TABLE price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percentage','fixed')), discount_value numeric(14,2) NOT NULL CHECK (discount_value > 0),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, is_active boolean NOT NULL DEFAULT true,
  CHECK (ends_at > starts_at)
);
CREATE TABLE price_rule_products (
  price_rule_id uuid NOT NULL REFERENCES price_rules(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (price_rule_id, product_id)
);

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel text NOT NULL CHECK (channel IN ('whatsapp','email','sms')),
  recipient text NOT NULL, template text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('queued','processing','sent','failed')) DEFAULT 'queued',
  provider_reference text, attempt_count integer NOT NULL DEFAULT 0, last_error text, scheduled_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_outbox_pending_idx ON notification_outbox(scheduled_at) WHERE status IN ('queued','failed');

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, provider_event_id text NOT NULL,
  event_type text NOT NULL, signature_verified boolean NOT NULL DEFAULT false, payload jsonb NOT NULL,
  processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider, provider_event_id)
);
