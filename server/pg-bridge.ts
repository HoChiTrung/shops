import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolConfig } from 'pg';
import {
  normalizeOrderStatus,
  type AgentDeliveryStatus,
  type AgentNotification,
  type AgentOrderPayload,
  type Order,
  type OrderItem,
  type OrderStatus,
  type Product,
  type Shop,
} from '../src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build a pg PoolConfig that handles both Aiven PostgreSQL (sslmode=require, self-signed CA,
 * connection limit 20) and local PostgreSQL cleanly without ever hardcoding credentials.
 */
function sanitizeDatabaseUrl(rawUrl: string): string {
  const lines = rawUrl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  let cleaned = lines[0] ?? rawUrl.trim();
  cleaned = cleaned.replace(/^export\s+/i, '').trim();
  cleaned = cleaned.replace(/^DATABASE_URL\s*=\s*/i, '').trim();
  cleaned = cleaned.replace(/^psql\s+/i, '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

function classifyDatabaseHost(rawUrl?: string): 'aiven' | 'localhost' | 'remote' | 'invalid' | 'none' {
  if (!rawUrl || !rawUrl.trim()) return 'none';
  try {
    const parsed = new URL(sanitizeDatabaseUrl(rawUrl));
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'localhost';
    if (host.endsWith('.aivencloud.com')) return 'aiven';
    return 'remote';
  } catch {
    return 'invalid';
  }
}

function buildPgPoolConfig(rawUrl: string): PoolConfig {
  const parsed = new URL(sanitizeDatabaseUrl(rawUrl));
  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
  const isAivenHost = parsed.hostname.toLowerCase().endsWith('.aivencloud.com');
  const needsSsl =
    sslMode === 'require' ||
    sslMode === 'verify-ca' ||
    sslMode === 'verify-full' ||
    isAivenHost;

  // Strip sslmode from URL query string so explicit ssl object below takes precedence in pg v8
  parsed.searchParams.delete('sslmode');

  const caCert = process.env.DATABASE_CA_CERT?.trim();
  let ssl: PoolConfig['ssl'] = false;
  if (needsSsl) {
    ssl = caCert
      ? { ca: caCert.replace(/\\n/g, '\n'), rejectUnauthorized: true }
      : { rejectUnauthorized: false };
  }

  return {
    connectionString: parsed.toString(),
    ssl,
    // Keep pool conservative (max 5) to stay well within Aiven Free's 20-connection limit
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  };
}

/**
 * PostgreSQL persistence bridge activated whenever process.env.DATABASE_URL is configured.
 * - Uses parameterized SQL queries exclusively ($1, $2, ...).
 * - Executes orders + agent_notifications inside an explicit BEGIN ... COMMIT transaction.
 * - Supports Aiven PostgreSQL TLS (`sslmode=require` + optional `DATABASE_CA_CERT`).
 * - Falls back gracefully when DATABASE_URL is not configured yet.
 */
class PostgresBridge {
  private pool: Pool | null = null;
  private schemaReadyPromise: Promise<boolean> | null = null;
  private lastErrorMessage: string | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
  }

  private getPool(): Pool | null {
    if (!this.isConfigured()) return null;
    if (!this.pool) {
      try {
        this.pool = new Pool(buildPgPoolConfig(process.env.DATABASE_URL!));
        this.pool.on('error', (err) => {
          this.lastErrorMessage = err.message;
          console.error('PostgreSQL pool idle client error:', err.message);
        });
      } catch (err) {
        this.lastErrorMessage = err instanceof Error ? err.message : 'Invalid DATABASE_URL';
        console.error('Invalid DATABASE_URL configuration:', this.lastErrorMessage);
        return null;
      }
    }
    return this.pool;
  }

  async ensureSchema(): Promise<boolean> {
    const pool = this.getPool();
    if (!pool) return false;
    if (!this.schemaReadyPromise) {
      this.schemaReadyPromise = (async () => {
        try {
          const schemaPath = path.resolve(__dirname, 'schema.sql');
          const ddl = fs.readFileSync(schemaPath, 'utf8');
          await pool.query(ddl);
          this.lastErrorMessage = null;
          return true;
        } catch (err) {
          this.lastErrorMessage = err instanceof Error ? err.message : String(err);
          console.error('PostgreSQL connection/schema init failed:', this.lastErrorMessage);
          this.schemaReadyPromise = null;
          return false;
        }
      })();
    }
    return this.schemaReadyPromise;
  }

  async upsertShop(shop: Shop): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;

    try {
      await pool.query(
        `INSERT INTO shops (id, name, slug, order_prefix, order_seq, messenger_link, agent_api_key, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           order_prefix = EXCLUDED.order_prefix,
           messenger_link = EXCLUDED.messenger_link,
           agent_api_key = EXCLUDED.agent_api_key,
           is_active = EXCLUDED.is_active`,
        [
          shop.id,
          shop.name,
          shop.slug,
          shop.orderPrefix,
          shop.orderSeq,
          shop.messengerLink,
          shop.agentApiKey || 'pending_sync',
          shop.isActive,
          shop.createdAt,
        ]
      );
      return true;
    } catch (err) {
      console.error('PostgreSQL upsertShop failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  async upsertUser(user: {
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
    role: 'super_admin' | 'shop_owner' | 'shop_staff';
    shopId: string | null;
    createdAt: string;
  }): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;

    try {
      await pool.query(
        `INSERT INTO users (id, email, display_name, password_hash, role, shop_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (email) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           shop_id = EXCLUDED.shop_id`,
        [
          user.id,
          user.email,
          user.displayName,
          user.passwordHash,
          user.role,
          user.shopId,
          user.createdAt,
        ]
      );
      return true;
    } catch (err) {
      console.error('PostgreSQL upsertUser failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  async deleteUser(userId: string): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;

    try {
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
      return true;
    } catch (err) {
      console.error('PostgreSQL deleteUser failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  async loadFullState(): Promise<{
    shops: Shop[];
    users: Array<{
      id: string;
      email: string;
      displayName: string;
      passwordHash: string;
      role: 'super_admin' | 'shop_owner' | 'shop_staff';
      shopId: string | null;
      createdAt: string;
    }>;
    products: Array<Omit<Product, 'variants'>>;
    variants: Product['variants'];
    orders: Array<Omit<Order, 'items'>>;
    orderItems: OrderItem[];
    agentNotifications: AgentNotification[];
  } | null> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return null;

    try {
      const [shopsRes, usersRes, productsRes, variantsRes, ordersRes, notifsRes] =
        await Promise.all([
          pool.query(`SELECT * FROM shops ORDER BY created_at ASC`),
          pool.query(`SELECT * FROM users ORDER BY created_at ASC`),
          pool.query(`SELECT * FROM products ORDER BY created_at DESC`),
          pool.query(`SELECT * FROM product_variants`),
          pool.query(`SELECT * FROM orders ORDER BY created_at DESC`),
          pool.query(`SELECT * FROM agent_notifications ORDER BY created_at DESC`),
        ]);

      const shops: Shop[] = shopsRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        orderPrefix: r.order_prefix,
        orderSeq: Number(r.order_seq) || 0,
        messengerLink: r.messenger_link,
        agentApiKey: r.agent_api_key,
        isActive: Boolean(r.is_active),
        createdAt: new Date(r.created_at).toISOString(),
      }));

      const shopIdBySlug = new Map(shops.map((s) => [s.slug, s.id]));

      const users = usersRes.rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        passwordHash: r.password_hash,
        role: r.role as 'super_admin' | 'shop_owner' | 'shop_staff',
        shopId: r.shop_id ?? null,
        createdAt: new Date(r.created_at).toISOString(),
      }));

      const products: Array<Omit<Product, 'variants'>> = productsRes.rows.map((r) => ({
        id: r.id,
        shopId: r.shop_id,
        name: r.name,
        code: r.code,
        price: Number(r.price) || 0,
        description: r.description ?? '',
        colors: Array.isArray(r.colors_json) ? r.colors_json : [],
        sizes: Array.isArray(r.sizes_json) ? r.sizes_json : [],
        isActive: Boolean(r.is_active),
        createdAt: new Date(r.created_at).toISOString(),
      }));

      const variants: Product['variants'] = variantsRes.rows.map((r) => ({
        id: r.id,
        shopId: r.shop_id,
        productId: r.product_id,
        colorName: r.color_name,
        colorCode: r.color_code,
        colorHex: r.color_hex,
        size: r.size,
        sku: r.sku,
        isActive: Boolean(r.is_active),
      }));

      const orders: Array<Omit<Order, 'items'>> = [];
      const orderItems: OrderItem[] = [];

      for (const r of ordersRes.rows) {
        const shopId = shopIdBySlug.get(r.shop_slug) ?? shops[0]?.id ?? 'shop_mam_tuithic';
        orders.push({
          id: r.id,
          shopId,
          orderCode: r.order_code,
          customerName: r.customer_name,
          customerPhone: r.phone_or_contact,
          customerAddress: r.shipping_address,
          customerNote: r.customer_note ?? '',
          status: normalizeOrderStatus(String(r.status ?? 'new')),
          trackingCode: r.tracking_code ?? '',
          adminNote: r.admin_note ?? '',
          totalAmount: Number(r.total_amount) || 0,
          messengerText: r.messenger_text ?? '',
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
        });
        const parsedItems: OrderItem[] = Array.isArray(r.items_json) ? r.items_json : [];
        for (const item of parsedItems) {
          orderItems.push({ ...item, shopId, orderId: r.id });
        }
      }

      const agentNotifications: AgentNotification[] = notifsRes.rows.map((r) => ({
        id: r.id,
        notificationId: r.notification_id,
        orderId: r.order_id,
        shopSlug: r.shop_slug,
        payload: r.payload_json as AgentOrderPayload,
        deliveryStatus: r.delivery_status as AgentDeliveryStatus,
        retryCount: Number(r.retry_count) || 0,
        lastError: r.last_error ?? null,
        createdAt: new Date(r.created_at).toISOString(),
        deliveredAt: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
        ackedAt: r.acked_at ? new Date(r.acked_at).toISOString() : null,
      }));

      return {
        shops,
        users,
        products,
        variants,
        orders,
        orderItems,
        agentNotifications,
      };
    } catch (err) {
      console.error('PostgreSQL loadFullState failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async upsertProduct(product: Product): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO products (id, shop_id, name, code, price, description, colors_json, sizes_json, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           code = EXCLUDED.code,
           price = EXCLUDED.price,
           description = EXCLUDED.description,
           colors_json = EXCLUDED.colors_json,
           sizes_json = EXCLUDED.sizes_json,
           is_active = EXCLUDED.is_active`,
        [
          product.id,
          product.shopId,
          product.name,
          product.code,
          product.price,
          product.description,
          JSON.stringify(product.colors),
          JSON.stringify(product.sizes),
          product.isActive,
          product.createdAt,
        ]
      );

      await client.query(`DELETE FROM product_variants WHERE shop_id = $1 AND product_id = $2`, [
        product.shopId,
        product.id,
      ]);

      for (const v of product.variants) {
        await client.query(
          `INSERT INTO product_variants (id, shop_id, product_id, color_name, color_code, color_hex, size, sku, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (shop_id, sku) DO UPDATE SET
             color_name = EXCLUDED.color_name,
             color_code = EXCLUDED.color_code,
             color_hex = EXCLUDED.color_hex,
             size = EXCLUDED.size,
             is_active = EXCLUDED.is_active`,
          [v.id, v.shopId, v.productId, v.colorName, v.colorCode, v.colorHex, v.size, v.sku, v.isActive]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('PostgreSQL upsertProduct failed:', err instanceof Error ? err.message : err);
      return false;
    } finally {
      client.release();
    }
  }

  async deleteProduct(shopId: string, productId: string): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;

    try {
      await pool.query(`DELETE FROM products WHERE id = $1 AND shop_id = $2`, [productId, shopId]);
      return true;
    } catch (err) {
      console.error('PostgreSQL deleteProduct failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * Atomically persist an order + its agent_notification inside one PostgreSQL transaction.
   */
  async persistOrderAndNotificationTx(params: {
    order: Order;
    shopSlug: string;
    notification: AgentNotification;
  }): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE shops SET order_seq = GREATEST(order_seq + 1, $1) WHERE slug = $2`,
        [
          Number.parseInt(params.order.orderCode.replace(/^\D+/, ''), 10) || 1,
          params.shopSlug,
        ]
      );

      await client.query(
        `INSERT INTO orders (
          id, order_code, shop_slug, customer_name, phone_or_contact,
          shipping_address, customer_note, items_json, total_amount,
          status, tracking_code, admin_note, messenger_text, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8::jsonb, $9,
          $10, $11, $12, $13, $14::timestamptz, $15::timestamptz
        )
        ON CONFLICT (order_code) DO NOTHING`,
        [
          params.order.id,
          params.order.orderCode,
          params.shopSlug,
          params.order.customerName,
          params.order.customerPhone,
          params.order.customerAddress,
          params.order.customerNote,
          JSON.stringify(params.order.items),
          params.order.totalAmount,
          params.order.status,
          params.order.trackingCode,
          params.order.adminNote,
          params.order.messengerText,
          params.order.createdAt,
          params.order.updatedAt,
        ]
      );

      await client.query(
        `INSERT INTO agent_notifications (
          id, notification_id, order_id, shop_slug, payload_json,
          delivery_status, retry_count, last_error, created_at, delivered_at, acked_at
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb,
          $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::timestamptz
        )
        ON CONFLICT (notification_id) DO NOTHING`,
        [
          params.notification.id,
          params.notification.notificationId,
          params.notification.orderId,
          params.notification.shopSlug,
          JSON.stringify(params.notification.payload),
          params.notification.deliveryStatus,
          params.notification.retryCount,
          params.notification.lastError,
          params.notification.createdAt,
          params.notification.deliveredAt,
          params.notification.ackedAt,
        ]
      );

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('PostgreSQL transaction failed:', err instanceof Error ? err.message : err);
      return false;
    } finally {
      client.release();
    }
  }

  async updateNotificationStatus(params: {
    notificationId: string;
    deliveryStatus: AgentDeliveryStatus;
    retryCount?: number;
    lastError?: string | null;
    deliveredAt?: string | null;
    ackedAt?: string | null;
  }): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;

    try {
      await pool.query(
        `UPDATE agent_notifications
         SET delivery_status = $2,
             retry_count = COALESCE($3, retry_count),
             last_error = $4,
             delivered_at = COALESCE($5::timestamptz, delivered_at),
             acked_at = COALESCE($6::timestamptz, acked_at)
         WHERE notification_id = $1`,
        [
          params.notificationId,
          params.deliveryStatus,
          params.retryCount ?? null,
          params.lastError ?? null,
          params.deliveredAt ?? null,
          params.ackedAt ?? null,
        ]
      );
      return true;
    } catch (err) {
      console.error(
        'PostgreSQL updateNotificationStatus failed:',
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  async updateOrderStatus(params: {
    orderId: string;
    status: OrderStatus;
    trackingCode: string;
    adminNote: string;
    updatedAt: string;
  }): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;

    try {
      await pool.query(
        `UPDATE orders
         SET status = $2, tracking_code = $3, admin_note = $4, updated_at = $5::timestamptz
         WHERE id = $1`,
        [params.orderId, params.status, params.trackingCode, params.adminNote, params.updatedAt]
      );
      return true;
    } catch (err) {
      console.error(
        'PostgreSQL updateOrderStatus failed:',
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  async bulkUpdateOrderStatus(params: {
    shopSlug: string;
    orderIds: string[];
    status: OrderStatus;
    updatedAt: string;
  }): Promise<boolean> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool || params.orderIds.length === 0) return false;

    try {
      await pool.query(
        `UPDATE orders
         SET status = $2, updated_at = $3::timestamptz
         WHERE shop_slug = $1 AND id = ANY($4::text[])`,
        [params.shopSlug.trim().toLowerCase(), params.status, params.updatedAt, params.orderIds]
      );
      return true;
    } catch (err) {
      console.error(
        'PostgreSQL bulkUpdateOrderStatus failed:',
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }

  async fetchPendingNotifications(shopSlug: string): Promise<AgentNotification[] | null> {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return null;

    try {
      const res = await pool.query<{
        id: string;
        notification_id: string;
        order_id: string;
        shop_slug: string;
        payload_json: AgentOrderPayload;
        delivery_status: AgentDeliveryStatus;
        retry_count: number;
        last_error: string | null;
        created_at: Date;
        delivered_at: Date | null;
        acked_at: Date | null;
      }>(
        `SELECT id, notification_id, order_id, shop_slug, payload_json,
                delivery_status, retry_count, last_error, created_at, delivered_at, acked_at
         FROM agent_notifications
         WHERE shop_slug = $1 AND delivery_status <> 'acked'
         ORDER BY created_at ASC`,
        [shopSlug.trim().toLowerCase()]
      );

      return res.rows.map((r) => ({
        id: r.id,
        notificationId: r.notification_id,
        orderId: r.order_id,
        shopSlug: r.shop_slug,
        payload: r.payload_json,
        deliveryStatus: r.delivery_status,
        retryCount: r.retry_count,
        lastError: r.last_error,
        createdAt: r.created_at.toISOString(),
        deliveredAt: r.delivered_at ? r.delivered_at.toISOString() : null,
        ackedAt: r.acked_at ? r.acked_at.toISOString() : null,
      }));
    } catch (err) {
      console.error(
        'PostgreSQL fetchPendingNotifications failed:',
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  async getConnectionHealth(): Promise<{
    mode: 'postgresql' | 'local_store';
    connected: boolean;
    configured: boolean;
    targetHostType: 'aiven' | 'localhost' | 'remote' | 'invalid' | 'none';
  }> {
    const targetHostType = classifyDatabaseHost(process.env.DATABASE_URL);
    if (!this.isConfigured()) {
      return { mode: 'local_store', connected: false, configured: false, targetHostType };
    }
    const ok = await this.ensureSchema();
    return {
      mode: ok ? 'postgresql' : 'local_store',
      connected: ok,
      configured: true,
      targetHostType,
    };
  }
}

export const pgBridge = new PostgresBridge();

export function buildItemsSummary(items: OrderItem[]): string {
  return items
    .map((item) => `${item.productName} (${item.colorName} / Size ${item.size}) x${item.quantity}`)
    .join(', ');
}
