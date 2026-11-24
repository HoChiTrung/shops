-- Complete Multi-Tenant PostgreSQL Schema (compatible with Aiven PostgreSQL & local PostgreSQL)
-- Auto-applied lazily by server/pg-bridge.ts when DATABASE_URL is configured.

CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  order_prefix TEXT NOT NULL DEFAULT 'MM',
  order_seq INTEGER NOT NULL DEFAULT 0,
  messenger_link TEXT NOT NULL,
  agent_api_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'shop_owner', 'shop_staff')),
  shop_id TEXT REFERENCES shops(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_shop_id
  ON users (shop_id);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  description TEXT NOT NULL DEFAULT '',
  colors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sizes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, code)
);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color_name TEXT NOT NULL,
  color_code TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  size TEXT NOT NULL,
  sku TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (shop_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON product_variants (shop_id, product_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  shop_slug TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone_or_contact TEXT NOT NULL,
  shipping_address TEXT NOT NULL,
  customer_note TEXT NOT NULL DEFAULT '',
  items_json JSONB NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'confirmed', 'shipping', 'completed', 'cancelled')),
  tracking_code TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  messenger_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_shop_slug_created
  ON orders (shop_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_notifications (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shop_slug TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'delivered', 'acked', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  acked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_notifications_shop_status
  ON agent_notifications (shop_slug, delivery_status, created_at ASC);

-- Seed pilot shop row if missing
INSERT INTO shops (id, name, slug, order_prefix, order_seq, messenger_link, agent_api_key, is_active)
VALUES ('shop_mam_tuithic', 'tuithic studio', 'mam', 'MM', 2, 'https://m.me/tuithicstudio', 'pending_sync', TRUE)
ON CONFLICT (slug) DO NOTHING;
