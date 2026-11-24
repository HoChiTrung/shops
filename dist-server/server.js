// server.ts
import "dotenv/config";
import http from "node:http";
import express from "express";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/shared/types.ts
function normalizeSkuToken(input) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 16);
}
function buildSku(productCode, colorCode, size) {
  const p = normalizeSkuToken(productCode) || "SP";
  const c = normalizeSkuToken(colorCode) || "MAU";
  const s = normalizeSkuToken(size) || "FS";
  return `${p}-${c}-${s}`;
}
function normalizePhone(phone) {
  const digits = phone.replace(/[\s.\-()]/g, "");
  if (digits.startsWith("+84")) {
    return "0" + digits.slice(3);
  }
  if (digits.startsWith("84") && digits.length === 11) {
    return "0" + digits.slice(2);
  }
  return digits;
}
function isValidVietnamPhone(phone) {
  const normalized = normalizePhone(phone);
  return /^0[35789][0-9]{8}$/.test(normalized);
}
function isValidMessengerUrl(url) {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "m.me" || host === "messenger.com" || host === "www.messenger.com";
  } catch {
    return false;
  }
}
function formatVnd(amount) {
  return `${amount.toLocaleString("vi-VN")}\u0111`;
}
function formatOrderMessengerText(params) {
  const itemLines = params.items.map(
    (item, index) => `${index + 1}. ${item.productName} (${item.colorName} / Size ${item.size}) x${item.quantity} = ${formatVnd(item.lineTotal)}`
  );
  const lines = [
    `\u0110\u01A0N H\xC0NG M\u1EDAI #${params.orderCode} \u2014 ${params.shopName}`,
    "--------------------",
    "S\u1EA3n ph\u1EA9m:",
    ...itemLines,
    "--------------------",
    `T\u1ED5ng c\u1ED9ng: ${formatVnd(params.totalAmount)}`,
    `Kh\xE1ch h\xE0ng: ${params.customerName}`,
    `S\u0110T: ${params.customerPhone}`,
    `\u0110\u1ECBa ch\u1EC9: ${params.customerAddress}`
  ];
  if (params.customerNote.trim()) {
    lines.push(`Ghi ch\xFA: ${params.customerNote.trim()}`);
  }
  return lines.join("\n");
}

// server/auth.ts
import crypto from "node:crypto";
var TOKEN_TTL_MS = 12 * 60 * 60 * 1e3;
var TOKEN_SECRET = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16 ? process.env.SESSION_SECRET : crypto.randomBytes(32).toString("hex");
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}
function verifyPassword(password, storedHash) {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(keyHex, "hex");
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}
function base64UrlEncode(input) {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - normalized.length % 4);
  return Buffer.from(normalized + pad, "base64").toString("utf8");
}
function signSegment(segment) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(segment).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function createAccessToken(user) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = {
    sub: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    shopId: user.shopId,
    exp: Date.now() + TOKEN_TTL_MS
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = signSegment(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}
function verifyAccessToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expectedSig = signSegment(`${header}.${body}`);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(body));
    if (!parsed.sub || !parsed.role || typeof parsed.exp !== "number") {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
var activeUserResolver = null;
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Vui l\xF2ng \u0111\u0103ng nh\u1EADp \u0111\u1EC3 ti\u1EBFp t\u1EE5c." });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: "Phi\xEAn \u0111\u0103ng nh\u1EADp kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 h\u1EBFt h\u1EA1n." });
    return;
  }
  if (activeUserResolver) {
    const liveUser = activeUserResolver(payload.sub);
    if (!liveUser || liveUser.role !== payload.role || liveUser.shopId !== payload.shopId) {
      res.status(401).json({ error: "T\xE0i kho\u1EA3n \u0111\xE3 b\u1ECB thu h\u1ED3i quy\u1EC1n ho\u1EB7c thay \u0111\u1ED5i ph\xE2n quy\u1EC1n." });
      return;
    }
  }
  req.auth = payload;
  next();
}
function requireSuperAdmin(req, res, next) {
  if (!req.auth) {
    res.status(401).json({ error: "Vui l\xF2ng \u0111\u0103ng nh\u1EADp \u0111\u1EC3 ti\u1EBFp t\u1EE5c." });
    return;
  }
  if (req.auth.role !== "super_admin") {
    res.status(403).json({ error: "Ch\u1EC9 Ch\u1EE7 h\u1EC7 th\u1ED1ng (Super Admin) m\u1EDBi c\xF3 quy\u1EC1n truy c\u1EADp m\u1EE5c n\xE0y." });
    return;
  }
  next();
}
function requireShopAccess(req, res, next) {
  if (!req.auth) {
    res.status(401).json({ error: "Vui l\xF2ng \u0111\u0103ng nh\u1EADp \u0111\u1EC3 ti\u1EBFp t\u1EE5c." });
    return;
  }
  if (req.auth.role === "super_admin") {
    res.status(403).json({
      error: "T\xE0i kho\u1EA3n Super Admin kh\xF4ng \u0111\u01B0\u1EE3c ph\xE9p xem hay thao t\xE1c d\u1EEF li\u1EC7u \u0111\u01A1n h\xE0ng c\u1EE7a t\u1EEBng gian h\xE0ng \u0111\u1EC3 \u0111\u1EA3m b\u1EA3o t\xEDnh ri\xEAng t\u01B0 kinh doanh."
    });
    return;
  }
  const targetShopId = req.params.shopId;
  if (!req.auth.shopId || req.auth.shopId !== targetShopId) {
    res.status(403).json({ error: "B\u1EA1n ch\u1EC9 c\xF3 quy\u1EC1n qu\u1EA3n l\xFD \u0111\xFAng gian h\xE0ng \u0111\u01B0\u1EE3c ph\xE2n c\xF4ng." });
    return;
  }
  next();
}

// server/store.ts
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";

// server/pg-bridge.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function buildPgPoolConfig(rawUrl) {
  const parsed = new URL(rawUrl.trim());
  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  const isAivenHost = parsed.hostname.toLowerCase().endsWith(".aivencloud.com");
  const needsSsl = sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full" || isAivenHost;
  parsed.searchParams.delete("sslmode");
  const caCert = process.env.DATABASE_CA_CERT?.trim();
  let ssl = false;
  if (needsSsl) {
    ssl = caCert ? { ca: caCert.replace(/\\n/g, "\n"), rejectUnauthorized: true } : { rejectUnauthorized: false };
  }
  return {
    connectionString: parsed.toString(),
    ssl,
    // Keep pool conservative (max 5) to stay well within Aiven Free's 20-connection limit
    max: 5,
    connectionTimeoutMillis: 1e4,
    idleTimeoutMillis: 3e4
  };
}
var PostgresBridge = class {
  constructor() {
    this.pool = null;
    this.schemaReadyPromise = null;
  }
  isConfigured() {
    return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
  }
  getPool() {
    if (!this.isConfigured()) return null;
    if (!this.pool) {
      try {
        this.pool = new Pool(buildPgPoolConfig(process.env.DATABASE_URL));
        this.pool.on("error", (err) => {
          console.error("PostgreSQL pool idle client error:", err.message);
        });
      } catch (err) {
        console.error(
          "Invalid DATABASE_URL configuration:",
          err instanceof Error ? err.message : err
        );
        return null;
      }
    }
    return this.pool;
  }
  async ensureSchema() {
    const pool = this.getPool();
    if (!pool) return false;
    if (!this.schemaReadyPromise) {
      this.schemaReadyPromise = (async () => {
        try {
          const schemaPath = path.resolve(__dirname, "schema.sql");
          const ddl = fs.readFileSync(schemaPath, "utf8");
          await pool.query(ddl);
          return true;
        } catch (err) {
          console.error(
            "PostgreSQL connection/schema init failed:",
            err instanceof Error ? err.message : err
          );
          this.schemaReadyPromise = null;
          return false;
        }
      })();
    }
    return this.schemaReadyPromise;
  }
  async upsertShop(shop) {
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
          shop.agentApiKey || "pending_sync",
          shop.isActive,
          shop.createdAt
        ]
      );
      return true;
    } catch (err) {
      console.error("PostgreSQL upsertShop failed:", err instanceof Error ? err.message : err);
      return false;
    }
  }
  async upsertUser(user) {
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
          user.createdAt
        ]
      );
      return true;
    } catch (err) {
      console.error("PostgreSQL upsertUser failed:", err instanceof Error ? err.message : err);
      return false;
    }
  }
  async deleteUser(userId) {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;
    try {
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
      return true;
    } catch (err) {
      console.error("PostgreSQL deleteUser failed:", err instanceof Error ? err.message : err);
      return false;
    }
  }
  async loadFullState() {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return null;
    try {
      const [shopsRes, usersRes, productsRes, variantsRes, ordersRes, notifsRes] = await Promise.all([
        pool.query(`SELECT * FROM shops ORDER BY created_at ASC`),
        pool.query(`SELECT * FROM users ORDER BY created_at ASC`),
        pool.query(`SELECT * FROM products ORDER BY created_at DESC`),
        pool.query(`SELECT * FROM product_variants`),
        pool.query(`SELECT * FROM orders ORDER BY created_at DESC`),
        pool.query(`SELECT * FROM agent_notifications ORDER BY created_at DESC`)
      ]);
      const shops = shopsRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        orderPrefix: r.order_prefix,
        orderSeq: Number(r.order_seq) || 0,
        messengerLink: r.messenger_link,
        agentApiKey: r.agent_api_key,
        isActive: Boolean(r.is_active),
        createdAt: new Date(r.created_at).toISOString()
      }));
      const shopIdBySlug = new Map(shops.map((s) => [s.slug, s.id]));
      const users = usersRes.rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        passwordHash: r.password_hash,
        role: r.role,
        shopId: r.shop_id ?? null,
        createdAt: new Date(r.created_at).toISOString()
      }));
      const products = productsRes.rows.map((r) => ({
        id: r.id,
        shopId: r.shop_id,
        name: r.name,
        code: r.code,
        price: Number(r.price) || 0,
        description: r.description ?? "",
        colors: Array.isArray(r.colors_json) ? r.colors_json : [],
        sizes: Array.isArray(r.sizes_json) ? r.sizes_json : [],
        isActive: Boolean(r.is_active),
        createdAt: new Date(r.created_at).toISOString()
      }));
      const variants = variantsRes.rows.map((r) => ({
        id: r.id,
        shopId: r.shop_id,
        productId: r.product_id,
        colorName: r.color_name,
        colorCode: r.color_code,
        colorHex: r.color_hex,
        size: r.size,
        sku: r.sku,
        isActive: Boolean(r.is_active)
      }));
      const orders = [];
      const orderItems = [];
      for (const r of ordersRes.rows) {
        const shopId = shopIdBySlug.get(r.shop_slug) ?? shops[0]?.id ?? "shop_mam_tuithic";
        orders.push({
          id: r.id,
          shopId,
          orderCode: r.order_code,
          customerName: r.customer_name,
          customerPhone: r.phone_or_contact,
          customerAddress: r.shipping_address,
          customerNote: r.customer_note ?? "",
          status: r.status,
          trackingCode: r.tracking_code ?? "",
          adminNote: r.admin_note ?? "",
          totalAmount: Number(r.total_amount) || 0,
          messengerText: r.messenger_text ?? "",
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString()
        });
        const parsedItems = Array.isArray(r.items_json) ? r.items_json : [];
        for (const item of parsedItems) {
          orderItems.push({ ...item, shopId, orderId: r.id });
        }
      }
      const agentNotifications = notifsRes.rows.map((r) => ({
        id: r.id,
        notificationId: r.notification_id,
        orderId: r.order_id,
        shopSlug: r.shop_slug,
        payload: r.payload_json,
        deliveryStatus: r.delivery_status,
        retryCount: Number(r.retry_count) || 0,
        lastError: r.last_error ?? null,
        createdAt: new Date(r.created_at).toISOString(),
        deliveredAt: r.delivered_at ? new Date(r.delivered_at).toISOString() : null,
        ackedAt: r.acked_at ? new Date(r.acked_at).toISOString() : null
      }));
      return {
        shops,
        users,
        products,
        variants,
        orders,
        orderItems,
        agentNotifications
      };
    } catch (err) {
      console.error("PostgreSQL loadFullState failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }
  async upsertProduct(product) {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
          product.createdAt
        ]
      );
      await client.query(`DELETE FROM product_variants WHERE shop_id = $1 AND product_id = $2`, [
        product.shopId,
        product.id
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
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
      });
      console.error("PostgreSQL upsertProduct failed:", err instanceof Error ? err.message : err);
      return false;
    } finally {
      client.release();
    }
  }
  async deleteProduct(shopId, productId) {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;
    try {
      await pool.query(`DELETE FROM products WHERE id = $1 AND shop_id = $2`, [productId, shopId]);
      return true;
    } catch (err) {
      console.error("PostgreSQL deleteProduct failed:", err instanceof Error ? err.message : err);
      return false;
    }
  }
  /**
   * Atomically persist an order + its agent_notification inside one PostgreSQL transaction.
   */
  async persistOrderAndNotificationTx(params) {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return false;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE shops SET order_seq = GREATEST(order_seq + 1, $1) WHERE slug = $2`,
        [
          Number.parseInt(params.order.orderCode.replace(/^\D+/, ""), 10) || 1,
          params.shopSlug
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
          params.order.updatedAt
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
          params.notification.ackedAt
        ]
      );
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
      });
      console.error("PostgreSQL transaction failed:", err instanceof Error ? err.message : err);
      return false;
    } finally {
      client.release();
    }
  }
  async updateNotificationStatus(params) {
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
          params.ackedAt ?? null
        ]
      );
      return true;
    } catch (err) {
      console.error(
        "PostgreSQL updateNotificationStatus failed:",
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }
  async updateOrderStatus(params) {
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
        "PostgreSQL updateOrderStatus failed:",
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }
  async fetchPendingNotifications(shopSlug) {
    const ready = await this.ensureSchema();
    const pool = this.getPool();
    if (!ready || !pool) return null;
    try {
      const res = await pool.query(
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
        ackedAt: r.acked_at ? r.acked_at.toISOString() : null
      }));
    } catch (err) {
      console.error(
        "PostgreSQL fetchPendingNotifications failed:",
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }
  async getConnectionHealth() {
    if (!this.isConfigured()) {
      return { mode: "local_store", connected: false };
    }
    const ok = await this.ensureSchema();
    return { mode: ok ? "postgresql" : "local_store", connected: ok };
  }
};
var pgBridge = new PostgresBridge();
function buildItemsSummary(items) {
  return items.map((item) => `${item.productName} (${item.colorName} / Size ${item.size}) x${item.quantity}`).join(", ");
}

// server/store.ts
var DATA_DIR = path2.resolve(process.cwd(), "data");
var DATA_FILE = path2.join(DATA_DIR, "db.json");
function genId(prefix) {
  return `${prefix}_${crypto2.randomBytes(6).toString("hex")}`;
}
function genAgentApiKey() {
  return `agk_${crypto2.randomBytes(24).toString("hex")}`;
}
function buildVariantsForProduct(shopId, productId, productCode, colors, sizes) {
  const variants = [];
  const seenSkus = /* @__PURE__ */ new Set();
  for (const color of colors) {
    for (const size of sizes) {
      const sku = buildSku(productCode, color.code || color.name, size);
      if (seenSkus.has(sku)) continue;
      seenSkus.add(sku);
      variants.push({
        id: genId("var"),
        shopId,
        productId,
        colorName: color.name.trim(),
        colorCode: normalizeSkuToken(color.code || color.name) || "MAU",
        colorHex: color.hex,
        size: size.trim().toUpperCase(),
        sku,
        isActive: true
      });
    }
  }
  return variants;
}
function createInitialSeedData() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const mamShopId = "shop_mam_tuithic";
  const mamShop = {
    id: mamShopId,
    name: "tuithic studio",
    slug: "mam",
    orderPrefix: "MM",
    orderSeq: 2,
    messengerLink: "https://m.me/tuithicstudio",
    agentApiKey: genAgentApiKey(),
    isActive: true,
    createdAt: now
  };
  const productDefs = [
    {
      id: "prod_ao_boxy",
      name: "\xC1o thun Basic Boxy 250gsm",
      code: "AO",
      price: 249e3,
      description: "Cotton 2 chi\u1EC1u d\xE0y d\u1EB7n 250gsm, form boxy \u0111\u1EE9ng d\xE1ng, m\u1EB7c m\xE1t h\u1EB1ng ng\xE0y.",
      colors: [
        { name: "Tr\u1EAFng kem", code: "KEM", hex: "#F3EFE6" },
        { name: "\u0110en than", code: "DEN", hex: "#1F2937" },
        { name: "Xanh cobalt", code: "XANH", hex: "#2563EB" },
        { name: "X\xE1m ti\xEAu", code: "XAM", hex: "#9CA3AF" }
      ],
      sizes: ["S", "M", "L", "XL"]
    },
    {
      id: "prod_os_tron",
      name: "\xC1o thun Oversize C\u1ED5 Tr\xF2n",
      code: "OS",
      price: 279e3,
      description: "Form r\u1ED9ng vai tr\u1EC5 tho\u1EA3i m\xE1i, bo c\u1ED5 d\xE0y ch\u1ED1ng gi\xE3n sau nhi\u1EC1u l\u1EA7n gi\u1EB7t.",
      colors: [
        { name: "\u0110en tuy\u1EC1n", code: "DEN", hex: "#111827" },
        { name: "Tr\u1EAFng tinh", code: "TRANG", hex: "#F9FAFB" },
        { name: "Xanh r\xEAu", code: "REU", hex: "#3F6212" },
        { name: "N\xE2u \u0111\u1EA5t", code: "NAU", hex: "#78350F" }
      ],
      sizes: ["S", "M", "L", "XL"]
    },
    {
      id: "prod_rg_raglan",
      name: "\xC1o thun Raglan Tay L\u1EE1",
      code: "RG",
      price: 295e3,
      description: "Thi\u1EBFt k\u1EBF ph\u1ED1i tay raglan tr\u1EBB trung, v\u1EA3i cotton m\u1EC1m m\u1ECBn th\u1EA5m h\xFAt m\u1ED3 h\xF4i.",
      colors: [
        { name: "Xanh navy", code: "NAVY", hex: "#1E3A8A" },
        { name: "\u0110\u1ECF \u0111\xF4", code: "DO", hex: "#991B1B" },
        { name: "Be c\xE1t", code: "BE", hex: "#D6C7B2" },
        { name: "X\xE1m kh\xF3i", code: "KHOI", hex: "#6B7280" }
      ],
      sizes: ["S", "M", "L", "XL"]
    },
    {
      id: "prod_bt_babytee",
      name: "\xC1o thun Baby Tee N\u1EEF",
      code: "BT",
      price: 225e3,
      description: "Form \xF4m nh\u1EB9 t\xF4n d\xE1ng, ch\u1EA5t cotton co gi\xE3n 4 chi\u1EC1u tho\xE1ng m\xE1t.",
      colors: [
        { name: "Tr\u1EAFng s\u1EEFa", code: "SUA", hex: "#FDFBF7" },
        { name: "H\u1ED3ng ph\u1EA5n", code: "HONG", hex: "#F472B6" },
        { name: "Xanh bi\u1EC3n", code: "BIEN", hex: "#60A5FA" },
        { name: "\u0110en", code: "DEN", hex: "#18181B" }
      ],
      sizes: ["S", "M", "L"]
    }
  ];
  const products = [];
  const variants = [];
  for (const def of productDefs) {
    products.push({
      id: def.id,
      shopId: mamShopId,
      name: def.name,
      code: def.code,
      price: def.price,
      description: def.description,
      colors: def.colors,
      sizes: def.sizes,
      isActive: true,
      createdAt: now
    });
    variants.push(...buildVariantsForProduct(mamShopId, def.id, def.code, def.colors, def.sizes));
  }
  const vAoXanhS = variants.find((v) => v.sku === "AO-XANH-S") ?? variants[0];
  const vOsReuM = variants.find((v) => v.sku === "OS-REU-M") ?? variants[1];
  const order1Id = "ord_seed_mm0001";
  const order1Items = [
    {
      id: "oi_seed_1",
      shopId: mamShopId,
      orderId: order1Id,
      productId: vAoXanhS.productId,
      variantId: vAoXanhS.id,
      productName: "\xC1o thun Basic Boxy 250gsm",
      colorName: vAoXanhS.colorName,
      colorHex: vAoXanhS.colorHex,
      size: vAoXanhS.size,
      sku: vAoXanhS.sku,
      quantity: 2,
      unitPrice: 249e3,
      lineTotal: 498e3
    }
  ];
  const order1Text = formatOrderMessengerText({
    shopName: mamShop.name,
    orderCode: "MM0001",
    items: order1Items,
    totalAmount: 498e3,
    customerName: "Nguy\u1EC5n Minh Anh",
    customerPhone: "0901234567",
    customerAddress: "45 Nguy\u1EC5n Hu\u1EC7, Qu\u1EADn 1, TP. H\u1ED3 Ch\xED Minh",
    customerNote: "Giao gi\u1EDD h\xE0nh ch\xEDnh gi\xFAp m\xECnh"
  });
  const order2Id = "ord_seed_mm0002";
  const order2Items = [
    {
      id: "oi_seed_2",
      shopId: mamShopId,
      orderId: order2Id,
      productId: vOsReuM.productId,
      variantId: vOsReuM.id,
      productName: "\xC1o thun Oversize C\u1ED5 Tr\xF2n",
      colorName: vOsReuM.colorName,
      colorHex: vOsReuM.colorHex,
      size: vOsReuM.size,
      sku: vOsReuM.sku,
      quantity: 1,
      unitPrice: 279e3,
      lineTotal: 279e3
    }
  ];
  const order2Text = formatOrderMessengerText({
    shopName: mamShop.name,
    orderCode: "MM0002",
    items: order2Items,
    totalAmount: 279e3,
    customerName: "Tr\u1EA7n Qu\u1ED1c B\u1EA3o",
    customerPhone: "0912345678",
    customerAddress: "120 C\u1EA7u Gi\u1EA5y, H\xE0 N\u1ED9i",
    customerNote: ""
  });
  const oneHourAgo = new Date(Date.now() - 3600 * 1e3).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1e3).toISOString();
  return {
    shops: [mamShop],
    users: [],
    products,
    variants,
    orders: [
      {
        id: order1Id,
        shopId: mamShopId,
        orderCode: "MM0001",
        customerName: "Nguy\u1EC5n Minh Anh",
        customerPhone: "0901234567",
        customerAddress: "45 Nguy\u1EC5n Hu\u1EC7, Qu\u1EADn 1, TP. H\u1ED3 Ch\xED Minh",
        customerNote: "Giao gi\u1EDD h\xE0nh ch\xEDnh gi\xFAp m\xECnh",
        status: "new",
        trackingCode: "",
        adminNote: "",
        totalAmount: 498e3,
        messengerText: order1Text,
        createdAt: oneHourAgo,
        updatedAt: oneHourAgo
      },
      {
        id: order2Id,
        shopId: mamShopId,
        orderCode: "MM0002",
        customerName: "Tr\u1EA7n Qu\u1ED1c B\u1EA3o",
        customerPhone: "0912345678",
        customerAddress: "120 C\u1EA7u Gi\u1EA5y, H\xE0 N\u1ED9i",
        customerNote: "",
        status: "shipping",
        trackingCode: "GHTK849201",
        adminNote: "\u0110\xE3 g\u1EEDi b\u01B0u c\u1EE5c bu\u1ED5i s\xE1ng",
        totalAmount: 279e3,
        messengerText: order2Text,
        createdAt: oneDayAgo,
        updatedAt: oneHourAgo
      }
    ],
    orderItems: [...order1Items, ...order2Items],
    agentNotifications: [
      {
        id: "an_seed_1",
        notificationId: "notif_seed_mm0001",
        orderId: order1Id,
        shopSlug: "mam",
        payload: {
          event: "order.created",
          notification_id: "notif_seed_mm0001",
          order_code: "MM0001",
          shop_slug: "mam",
          customer_name: "Nguy\u1EC5n Minh Anh",
          phone_or_contact: "0901234567",
          items_summary: buildItemsSummary(order1Items),
          total_amount: 498e3,
          message_text: order1Text,
          created_at: oneHourAgo
        },
        deliveryStatus: "pending",
        retryCount: 0,
        lastError: null,
        createdAt: oneHourAgo,
        deliveredAt: null,
        ackedAt: null
      },
      {
        id: "an_seed_2",
        notificationId: "notif_seed_mm0002",
        orderId: order2Id,
        shopSlug: "mam",
        payload: {
          event: "order.created",
          notification_id: "notif_seed_mm0002",
          order_code: "MM0002",
          shop_slug: "mam",
          customer_name: "Tr\u1EA7n Qu\u1ED1c B\u1EA3o",
          phone_or_contact: "0912345678",
          items_summary: buildItemsSummary(order2Items),
          total_amount: 279e3,
          message_text: order2Text,
          created_at: oneDayAgo
        },
        deliveryStatus: "acked",
        retryCount: 0,
        lastError: null,
        createdAt: oneDayAgo,
        deliveredAt: oneDayAgo,
        ackedAt: oneHourAgo
      }
    ]
  };
}
var MultiTenantStore = class {
  constructor() {
    this.data = this.load();
  }
  load() {
    try {
      if (fs2.existsSync(DATA_FILE)) {
        const raw = fs2.readFileSync(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.shops)) {
          let dirty = false;
          if (!Array.isArray(parsed.agentNotifications)) {
            parsed.agentNotifications = [];
            dirty = true;
          }
          for (const shop of parsed.shops) {
            if (!shop.agentApiKey) {
              shop.agentApiKey = genAgentApiKey();
              dirty = true;
            }
          }
          const hydrated = parsed;
          if (dirty) {
            this.saveData(hydrated);
          }
          return hydrated;
        }
      }
    } catch (error) {
      console.error("Failed to read existing data file, reinitializing:", error);
    }
    const seed = createInitialSeedData();
    this.saveData(seed);
    return seed;
  }
  saveData(data) {
    fs2.mkdirSync(DATA_DIR, { recursive: true });
    const tmpPath = `${DATA_FILE}.${process.pid}.tmp`;
    fs2.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs2.renameSync(tmpPath, DATA_FILE);
  }
  persist() {
    this.saveData(this.data);
  }
  // ---- Auth & Bootstrap ----
  hasEnvSuperAdmin() {
    return Boolean(process.env.SUPER_ADMIN_PASSWORD && process.env.SUPER_ADMIN_PASSWORD.trim().length >= 6);
  }
  getEnvSuperAdminEmail() {
    return (process.env.SUPER_ADMIN_EMAIL || "superadmin@tuithic.studio").trim().toLowerCase();
  }
  hasSuperAdmin() {
    return this.hasEnvSuperAdmin() || this.data.users.some((u) => u.role === "super_admin");
  }
  hasShopAdmin() {
    return this.data.users.some((u) => u.role === "shop_owner" || u.role === "shop_staff");
  }
  needsBootstrap() {
    return !this.hasSuperAdmin();
  }
  getAllStoredUsers() {
    return [...this.data.users];
  }
  getAllShops() {
    return [...this.data.shops];
  }
  getAllAgentNotifications() {
    return [...this.data.agentNotifications];
  }
  hydrateFromPostgres(pgState) {
    this.data = {
      shops: pgState.shops,
      users: pgState.users,
      products: pgState.products,
      variants: pgState.variants,
      orders: pgState.orders,
      orderItems: pgState.orderItems,
      agentNotifications: pgState.agentNotifications
    };
    this.persist();
  }
  bootstrapSuperAdminOnly(params) {
    if (this.hasSuperAdmin()) {
      throw new Error("T\xE0i kho\u1EA3n Admin h\u1EC7 th\u1ED1ng \u0111\xE3 \u0111\u01B0\u1EE3c thi\u1EBFt l\u1EADp t\u1EEB tr\u01B0\u1EDBc.");
    }
    const saEmail = params.superAdminEmail.trim().toLowerCase();
    if (this.data.users.some((u) => u.email === saEmail)) {
      throw new Error(`T\xE0i kho\u1EA3n "${saEmail}" \u0111\xE3 t\u1ED3n t\u1EA1i tr\xEAn h\u1EC7 th\u1ED1ng.`);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const superAdminRecord = {
      id: genId("usr"),
      email: saEmail,
      displayName: "Admin h\u1EC7 th\u1ED1ng",
      passwordHash: hashPassword(params.superAdminPassword),
      role: "super_admin",
      shopId: null,
      createdAt: now
    };
    this.data.users.push(superAdminRecord);
    this.persist();
    return this.toAuthUser(superAdminRecord);
  }
  bootstrapInitialAccounts(params) {
    if (this.hasSuperAdmin()) {
      throw new Error("H\u1EC7 th\u1ED1ng \u0111\xE3 \u0111\u01B0\u1EE3c thi\u1EBFt l\u1EADp qu\u1EA3n tr\u1ECB vi\xEAn t\u1EEB tr\u01B0\u1EDBc.");
    }
    const saEmail = params.superAdminEmail.trim().toLowerCase();
    const ownerEmail = params.shopOwnerEmail.trim().toLowerCase();
    if (saEmail === ownerEmail) {
      throw new Error(
        "T\xE0i kho\u1EA3n Admin h\u1EC7 th\u1ED1ng v\xE0 t\xE0i kho\u1EA3n Ch\u1EE7 shop c\u1EA7n kh\xE1c nhau \u0111\u1EC3 t\xE1ch bi\u1EC7t ph\xE2n quy\u1EC1n."
      );
    }
    const mamShop = this.data.shops.find((s) => s.slug === "mam") ?? this.data.shops[0];
    if (!mamShop) {
      throw new Error("Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng th\xED \u0111i\u1EC3m.");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const superAdminRecord = {
      id: genId("usr"),
      email: saEmail,
      displayName: "Admin h\u1EC7 th\u1ED1ng",
      passwordHash: hashPassword(params.superAdminPassword),
      role: "super_admin",
      shopId: null,
      createdAt: now
    };
    const shopOwnerRecord = {
      id: genId("usr"),
      email: ownerEmail,
      displayName: "Ch\u1EE7 shop (tuithic studio)",
      passwordHash: hashPassword(params.shopOwnerPassword),
      role: "shop_owner",
      shopId: mamShop.id,
      createdAt: now
    };
    this.data.users.push(superAdminRecord, shopOwnerRecord);
    this.persist();
    return {
      superAdmin: this.toAuthUser(superAdminRecord),
      shopOwner: this.toAuthUser(shopOwnerRecord)
    };
  }
  authenticateUser(emailInput, password) {
    const email = emailInput.trim().toLowerCase();
    if (this.hasEnvSuperAdmin() && email === this.getEnvSuperAdminEmail()) {
      const envPassword = process.env.SUPER_ADMIN_PASSWORD.trim();
      const inputBuf = Buffer.from(password);
      const envBuf = Buffer.from(envPassword);
      if (inputBuf.length === envBuf.length && crypto2.timingSafeEqual(inputBuf, envBuf)) {
        return {
          id: "env_super_admin",
          email,
          displayName: "Ch\u1EE7 h\u1EC7 th\u1ED1ng (Super Admin)",
          role: "super_admin",
          shopId: null,
          shopName: null,
          shopSlug: null
        };
      }
      return null;
    }
    const user = this.data.users.find((u) => u.email === email);
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return this.toAuthUser(user);
  }
  getUserById(userId) {
    if (userId === "env_super_admin" && this.hasEnvSuperAdmin()) {
      return {
        id: "env_super_admin",
        email: this.getEnvSuperAdminEmail(),
        displayName: "Ch\u1EE7 h\u1EC7 th\u1ED1ng (Super Admin)",
        role: "super_admin",
        shopId: null,
        shopName: null,
        shopSlug: null
      };
    }
    const found = this.data.users.find((u) => u.id === userId);
    return found ? this.toAuthUser(found) : null;
  }
  toAuthUser(user) {
    const shop = user.shopId ? this.data.shops.find((s) => s.id === user.shopId) : null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      shopId: user.shopId,
      shopName: shop?.name ?? null,
      shopSlug: shop?.slug ?? null
    };
  }
  // ---- Public Storefront ----
  getShopBySlug(slug) {
    const clean = slug.trim().toLowerCase();
    return this.data.shops.find((s) => s.slug === clean) ?? null;
  }
  getShopById(shopId) {
    return this.data.shops.find((s) => s.id === shopId) ?? null;
  }
  getProductsForShop(shopId, onlyActive) {
    const products = this.data.products.filter(
      (p) => p.shopId === shopId && (!onlyActive || p.isActive)
    );
    return products.map((p) => ({
      ...p,
      variants: this.data.variants.filter(
        (v) => v.shopId === shopId && v.productId === p.id && (!onlyActive || v.isActive)
      )
    }));
  }
  createOrderForShop(params) {
    const shop = this.getShopBySlug(params.slug);
    if (!shop) {
      throw new Error("Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng.");
    }
    if (!shop.isActive) {
      throw new Error("Gian h\xE0ng hi\u1EC7n \u0111ang t\u1EA1m \u0111\xF3ng, ch\u01B0a nh\u1EADn \u0111\u01A1n m\u1EDBi.");
    }
    if (!params.items.length) {
      throw new Error("Gi\u1ECF h\xE0ng tr\u1ED1ng.");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const orderId = genId("ord");
    const resolvedItems = [];
    let totalAmount = 0;
    for (const reqItem of params.items) {
      const qty = Math.floor(Number(reqItem.quantity));
      if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
        throw new Error("S\u1ED1 l\u01B0\u1EE3ng s\u1EA3n ph\u1EA9m kh\xF4ng h\u1EE3p l\u1EC7.");
      }
      const matchedVariant = reqItem.variantId ? this.data.variants.find(
        (v) => v.id === reqItem.variantId && v.shopId === shop.id && v.isActive
      ) : reqItem.sku ? this.data.variants.find(
        (v) => v.shopId === shop.id && v.isActive && v.sku.toUpperCase() === reqItem.sku.trim().toUpperCase()
      ) : void 0;
      if (matchedVariant) {
        const product = this.data.products.find(
          (p) => p.id === matchedVariant.productId && p.shopId === shop.id && p.isActive
        );
        if (!product) {
          throw new Error("M\u1ED9t s\u1EA3n ph\u1EA9m trong gi\u1ECF hi\u1EC7n \u0111ang \u1EA9n.");
        }
        const lineTotal = product.price * qty;
        totalAmount += lineTotal;
        resolvedItems.push({
          id: genId("oi"),
          shopId: shop.id,
          orderId,
          productId: product.id,
          variantId: matchedVariant.id,
          productName: product.name,
          colorName: matchedVariant.colorName,
          colorHex: matchedVariant.colorHex,
          size: matchedVariant.size,
          sku: matchedVariant.sku,
          quantity: qty,
          unitPrice: product.price,
          lineTotal
        });
      } else if (!reqItem.variantId && typeof reqItem.sku === "string" && reqItem.sku.trim().length > 0 && typeof reqItem.unitPrice === "number" && Number.isFinite(reqItem.unitPrice) && reqItem.unitPrice > 0) {
        const unitPrice = Math.round(reqItem.unitPrice);
        const lineTotal = unitPrice * qty;
        totalAmount += lineTotal;
        resolvedItems.push({
          id: genId("oi"),
          shopId: shop.id,
          orderId,
          productId: "custom",
          variantId: "custom",
          productName: (reqItem.productName || reqItem.sku).trim(),
          colorName: (reqItem.colorName || "M\u1EB7c \u0111\u1ECBnh").trim(),
          colorHex: "#18181B",
          size: (reqItem.size || "FS").trim().toUpperCase(),
          sku: reqItem.sku.trim().toUpperCase(),
          quantity: qty,
          unitPrice,
          lineTotal
        });
      } else {
        throw new Error("M\u1ED9t s\u1EA3n ph\u1EA9m trong gi\u1ECF \u0111\xE3 ng\u1EEBng b\xE1n ho\u1EB7c kh\xF4ng t\u1ED3n t\u1EA1i.");
      }
    }
    shop.orderSeq += 1;
    const padded = String(shop.orderSeq).padStart(4, "0");
    const orderCode = `${shop.orderPrefix}${padded}`;
    const normalizedPhone = normalizePhone(params.customerPhone);
    const messengerText = formatOrderMessengerText({
      shopName: shop.name,
      orderCode,
      items: resolvedItems,
      totalAmount,
      customerName: params.customerName.trim(),
      customerPhone: normalizedPhone,
      customerAddress: params.customerAddress.trim(),
      customerNote: params.customerNote.trim()
    });
    const orderRecord = {
      id: orderId,
      shopId: shop.id,
      orderCode,
      customerName: params.customerName.trim(),
      customerPhone: normalizedPhone,
      customerAddress: params.customerAddress.trim(),
      customerNote: params.customerNote.trim(),
      status: "new",
      trackingCode: "",
      adminNote: "",
      totalAmount,
      messengerText,
      createdAt: now,
      updatedAt: now
    };
    const notificationId = `notif_${crypto2.randomBytes(8).toString("hex")}`;
    const payload = {
      event: "order.created",
      notification_id: notificationId,
      order_code: orderCode,
      shop_slug: shop.slug,
      customer_name: orderRecord.customerName,
      phone_or_contact: normalizedPhone,
      items_summary: buildItemsSummary(resolvedItems),
      total_amount: totalAmount,
      message_text: messengerText,
      created_at: now
    };
    const notification = {
      id: genId("an"),
      notificationId,
      orderId,
      shopSlug: shop.slug,
      payload,
      deliveryStatus: "pending",
      retryCount: 0,
      lastError: null,
      createdAt: now,
      deliveredAt: null,
      ackedAt: null
    };
    this.data.orders.unshift(orderRecord);
    this.data.orderItems.push(...resolvedItems);
    this.data.agentNotifications.unshift(notification);
    this.persist();
    return {
      order: {
        ...orderRecord,
        items: resolvedItems
      },
      notification
    };
  }
  lookupOrder(slug, orderCode, phone) {
    const shop = this.getShopBySlug(slug);
    if (!shop) return null;
    const cleanCode = orderCode.trim().toUpperCase();
    const cleanPhone = normalizePhone(phone);
    if (!cleanCode || !cleanPhone) return null;
    const order = this.data.orders.find(
      (o) => o.shopId === shop.id && o.orderCode.toUpperCase() === cleanCode && normalizePhone(o.customerPhone) === cleanPhone
    );
    if (!order) return null;
    const items = this.data.orderItems.filter(
      (i) => i.shopId === shop.id && i.orderId === order.id
    );
    return {
      ...order,
      items
    };
  }
  // ---- Shop Admin (strictly scoped by shopId) ----
  createProduct(shopId, payload) {
    const baseToken = normalizeSkuToken(payload.code || "") || normalizeSkuToken(payload.name).slice(0, 6) || "SP";
    let cleanCode = baseToken;
    let suffix = 2;
    while (this.data.products.some((p) => p.shopId === shopId && p.code === cleanCode)) {
      cleanCode = `${baseToken}${suffix}`;
      suffix += 1;
    }
    const productId = genId("prod");
    const cleanColors = payload.colors.map((c) => ({
      name: c.name.trim(),
      code: normalizeSkuToken(c.code || c.name) || "MAU",
      hex: /^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : "#18181B"
    }));
    const cleanSizes = Array.from(
      new Set(payload.sizes.map((s) => s.trim().toUpperCase()).filter(Boolean))
    );
    const record = {
      id: productId,
      shopId,
      name: payload.name.trim(),
      code: cleanCode,
      price: Math.max(0, Math.round(payload.price)),
      description: payload.description.trim(),
      colors: cleanColors,
      sizes: cleanSizes,
      isActive: payload.isActive,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const variants = buildVariantsForProduct(shopId, productId, cleanCode, cleanColors, cleanSizes);
    this.data.products.unshift(record);
    this.data.variants.push(...variants);
    this.persist();
    return { ...record, variants };
  }
  updateProduct(shopId, productId, payload) {
    const product = this.data.products.find((p) => p.id === productId && p.shopId === shopId);
    if (!product) {
      throw new Error("Kh\xF4ng t\xECm th\u1EA5y s\u1EA3n ph\u1EA9m trong gian h\xE0ng c\u1EE7a b\u1EA1n.");
    }
    if (payload.name !== void 0) product.name = payload.name.trim();
    if (payload.description !== void 0) product.description = payload.description.trim();
    if (payload.price !== void 0) product.price = Math.max(0, Math.round(payload.price));
    if (payload.isActive !== void 0) product.isActive = Boolean(payload.isActive);
    let needRebuildVariants = false;
    if (payload.code !== void 0) {
      const cleanCode = normalizeSkuToken(payload.code);
      if (!cleanCode) throw new Error("M\xE3 s\u1EA3n ph\u1EA9m kh\xF4ng h\u1EE3p l\u1EC7.");
      const conflict = this.data.products.find(
        (p) => p.shopId === shopId && p.id !== productId && p.code === cleanCode
      );
      if (conflict) throw new Error(`M\xE3 s\u1EA3n ph\u1EA9m "${cleanCode}" \u0111\xE3 \u0111\u01B0\u1EE3c d\xF9ng cho m\u1EABu kh\xE1c.`);
      if (product.code !== cleanCode) {
        product.code = cleanCode;
        needRebuildVariants = true;
      }
    }
    if (payload.colors !== void 0) {
      product.colors = payload.colors.map((c) => ({
        name: c.name.trim(),
        code: normalizeSkuToken(c.code || c.name) || "MAU",
        hex: /^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : "#18181B"
      }));
      needRebuildVariants = true;
    }
    if (payload.sizes !== void 0) {
      product.sizes = Array.from(
        new Set(payload.sizes.map((s) => s.trim().toUpperCase()).filter(Boolean))
      );
      needRebuildVariants = true;
    }
    if (needRebuildVariants) {
      this.data.variants = this.data.variants.filter(
        (v) => !(v.shopId === shopId && v.productId === productId)
      );
      const rebuilt = buildVariantsForProduct(
        shopId,
        productId,
        product.code,
        product.colors,
        product.sizes
      );
      this.data.variants.push(...rebuilt);
    }
    this.persist();
    const variants = this.data.variants.filter(
      (v) => v.shopId === shopId && v.productId === productId
    );
    return { ...product, variants };
  }
  deleteProduct(shopId, productId) {
    const idx = this.data.products.findIndex((p) => p.id === productId && p.shopId === shopId);
    if (idx === -1) {
      throw new Error("Kh\xF4ng t\xECm th\u1EA5y s\u1EA3n ph\u1EA9m \u0111\u1EC3 x\xF3a.");
    }
    this.data.products.splice(idx, 1);
    this.data.variants = this.data.variants.filter(
      (v) => !(v.shopId === shopId && v.productId === productId)
    );
    this.persist();
  }
  getOrdersForShop(shopId) {
    return this.data.orders.filter((o) => o.shopId === shopId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((o) => ({
      ...o,
      items: this.data.orderItems.filter((i) => i.shopId === shopId && i.orderId === o.id)
    }));
  }
  updateOrderForShop(shopId, orderId, payload) {
    const order = this.data.orders.find((o) => o.id === orderId && o.shopId === shopId);
    if (!order) {
      throw new Error("Kh\xF4ng t\xECm th\u1EA5y \u0111\u01A1n h\xE0ng thu\u1ED9c gian h\xE0ng c\u1EE7a b\u1EA1n.");
    }
    if (payload.status !== void 0) order.status = payload.status;
    if (payload.trackingCode !== void 0) order.trackingCode = payload.trackingCode.trim();
    if (payload.adminNote !== void 0) order.adminNote = payload.adminNote.trim();
    order.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.persist();
    const items = this.data.orderItems.filter((i) => i.shopId === shopId && i.orderId === order.id);
    return { ...order, items };
  }
  // ---- Super Admin (NEVER touches orders or orderItems!) ----
  listShopsForSuperAdmin() {
    return this.data.shops.map((shop) => {
      const productCount = this.data.products.filter((p) => p.shopId === shop.id).length;
      const members = this.data.users.filter((u) => u.shopId === shop.id && u.role !== "super_admin").map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        shopId: shop.id,
        createdAt: u.createdAt
      }));
      return {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        orderPrefix: shop.orderPrefix,
        orderSeq: shop.orderSeq,
        messengerLink: shop.messengerLink,
        isActive: shop.isActive,
        createdAt: shop.createdAt,
        productCount,
        members
      };
    });
  }
  createShop(payload) {
    const cleanSlug = payload.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!cleanSlug || ["admin", "super-admin", "api"].includes(cleanSlug)) {
      throw new Error("Slug gian h\xE0ng kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c tr\xF9ng \u0111\u01B0\u1EDDng d\u1EABn h\u1EC7 th\u1ED1ng.");
    }
    if (this.data.shops.some((s) => s.slug === cleanSlug)) {
      throw new Error(`\u0110\u01B0\u1EDDng d\u1EABn "/${cleanSlug}" \u0111\xE3 t\u1ED3n t\u1EA1i.`);
    }
    const cleanPrefix = normalizeSkuToken(payload.orderPrefix).slice(0, 6);
    if (cleanPrefix.length < 2) {
      throw new Error("Ti\u1EC1n t\u1ED1 m\xE3 \u0111\u01A1n ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 2 k\xFD t\u1EF1 ch\u1EEF/s\u1ED1 (v\xED d\u1EE5: MM).");
    }
    const shop = {
      id: genId("shop"),
      name: payload.name.trim(),
      slug: cleanSlug,
      orderPrefix: cleanPrefix,
      orderSeq: 0,
      messengerLink: payload.messengerLink.trim(),
      agentApiKey: genAgentApiKey(),
      isActive: true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.data.shops.push(shop);
    this.persist();
    return {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      orderPrefix: shop.orderPrefix,
      orderSeq: shop.orderSeq,
      messengerLink: shop.messengerLink,
      isActive: shop.isActive,
      createdAt: shop.createdAt,
      productCount: 0,
      members: []
    };
  }
  updateShop(shopId, payload) {
    const shop = this.data.shops.find((s) => s.id === shopId);
    if (!shop) {
      throw new Error("Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng.");
    }
    if (payload.name !== void 0) shop.name = payload.name.trim();
    if (payload.orderPrefix !== void 0) {
      const cleanPrefix = normalizeSkuToken(payload.orderPrefix).slice(0, 6);
      if (cleanPrefix.length < 2) {
        throw new Error("Ti\u1EC1n t\u1ED1 m\xE3 \u0111\u01A1n ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 2 k\xFD t\u1EF1.");
      }
      shop.orderPrefix = cleanPrefix;
    }
    if (payload.messengerLink !== void 0) shop.messengerLink = payload.messengerLink.trim();
    if (payload.isActive !== void 0) shop.isActive = Boolean(payload.isActive);
    this.persist();
    return this.listShopsForSuperAdmin().find((s) => s.id === shopId);
  }
  addShopMember(shopId, payload) {
    const shop = this.data.shops.find((s) => s.id === shopId);
    if (!shop) {
      throw new Error("Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng.");
    }
    const email = payload.email.trim().toLowerCase();
    if (email.length < 3 || /\s/.test(email)) {
      throw new Error("T\xEAn t\xE0i kho\u1EA3n ho\u1EB7c email kh\xF4ng h\u1EE3p l\u1EC7 (t\u1ED1i thi\u1EC3u 3 k\xFD t\u1EF1, kh\xF4ng c\xF3 kho\u1EA3ng tr\u1EAFng).");
    }
    if (this.data.users.some((u) => u.email === email)) {
      throw new Error(`T\xE0i kho\u1EA3n "${email}" \u0111\xE3 \u0111\u01B0\u1EE3c c\u1EA5p quy\u1EC1n tr\xEAn h\u1EC7 th\u1ED1ng.`);
    }
    if (payload.password.length < 3) {
      throw new Error("M\u1EADt kh\u1EA9u ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 3 k\xFD t\u1EF1.");
    }
    const user = {
      id: genId("usr"),
      email,
      displayName: payload.displayName.trim() || email.split("@")[0],
      passwordHash: hashPassword(payload.password),
      role: payload.role,
      shopId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.data.users.push(user);
    this.persist();
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: payload.role,
      shopId,
      createdAt: user.createdAt
    };
  }
  removeShopMember(shopId, userId) {
    const idx = this.data.users.findIndex(
      (u) => u.id === userId && u.shopId === shopId && u.role !== "super_admin"
    );
    if (idx === -1) {
      throw new Error("Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n trong gian h\xE0ng n\xE0y.");
    }
    this.data.users.splice(idx, 1);
    this.persist();
  }
  // ---- Agent Notifications & Key Management ----
  verifyShopAgentKey(shopSlug, providedKey) {
    if (!providedKey || !providedKey.trim()) return false;
    const candidate = providedKey.trim();
    const safeCompare = (a, b) => {
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      return bufA.length === bufB.length && crypto2.timingSafeEqual(bufA, bufB);
    };
    const globalKey = process.env.AGENT_API_KEY?.trim();
    if (globalKey && globalKey.length >= 8 && safeCompare(candidate, globalKey)) {
      return true;
    }
    const shop = this.getShopBySlug(shopSlug);
    if (!shop?.agentApiKey) return false;
    return safeCompare(candidate, shop.agentApiKey);
  }
  rotateShopAgentKey(shopId) {
    const shop = this.getShopById(shopId);
    if (!shop) throw new Error("Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng.");
    shop.agentApiKey = genAgentApiKey();
    this.persist();
    return shop.agentApiKey;
  }
  listAgentNotifications(shopSlug, onlyUnacked) {
    const clean = shopSlug.trim().toLowerCase();
    const filtered = this.data.agentNotifications.filter(
      (n) => n.shopSlug === clean && (!onlyUnacked || n.deliveryStatus !== "acked")
    );
    return filtered.sort(
      (a, b) => onlyUnacked ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  getAgentNotification(notificationId) {
    return this.data.agentNotifications.find((n) => n.notificationId === notificationId) ?? null;
  }
  markNotificationDelivered(notificationId) {
    const notif = this.getAgentNotification(notificationId);
    if (!notif || notif.deliveryStatus === "acked") return notif;
    notif.deliveryStatus = "delivered";
    notif.deliveredAt = (/* @__PURE__ */ new Date()).toISOString();
    notif.lastError = null;
    this.persist();
    return notif;
  }
  incrementNotificationRetry(shopSlug, notificationId) {
    const clean = shopSlug.trim().toLowerCase();
    const notif = this.data.agentNotifications.find(
      (n) => n.notificationId === notificationId && n.shopSlug === clean
    );
    if (!notif) return null;
    notif.retryCount += 1;
    this.persist();
    return notif;
  }
  ackNotification(shopSlug, notificationId) {
    const notif = this.data.agentNotifications.find(
      (n) => n.notificationId === notificationId && (!shopSlug || n.shopSlug === shopSlug.trim().toLowerCase())
    );
    if (!notif) return null;
    if (notif.deliveryStatus !== "acked") {
      notif.deliveryStatus = "acked";
      notif.ackedAt = (/* @__PURE__ */ new Date()).toISOString();
      notif.lastError = null;
      this.persist();
    }
    return notif;
  }
  failNotification(shopSlug, notificationId, errorText) {
    const notif = this.data.agentNotifications.find(
      (n) => n.notificationId === notificationId && (!shopSlug || n.shopSlug === shopSlug.trim().toLowerCase())
    );
    if (!notif) return null;
    notif.deliveryStatus = "failed";
    notif.retryCount += 1;
    notif.lastError = errorText.trim().slice(0, 500) || "Delivery failed";
    this.persist();
    return notif;
  }
};
var store = new MultiTenantStore();

// server/realtime.ts
import { WebSocketServer, WebSocket } from "ws";
var AgentRealtimeHub = class {
  constructor() {
    this.sseClients = /* @__PURE__ */ new Map();
    this.wsClients = /* @__PURE__ */ new Map();
    this.heartbeatTimer = null;
    this.wss = null;
    this.heartbeatTimer = setInterval(() => {
      for (const [id, client] of this.sseClients.entries()) {
        try {
          client.res.write(`: ping ${Date.now()}

`);
        } catch {
          this.sseClients.delete(id);
        }
      }
      for (const [id, client] of this.wsClients.entries()) {
        if (client.socket.readyState === WebSocket.OPEN) {
          try {
            client.socket.ping();
          } catch {
            this.wsClients.delete(id);
          }
        } else {
          this.wsClients.delete(id);
        }
      }
    }, 25e3);
    this.heartbeatTimer.unref?.();
  }
  attachWebSocketServer(server, verifyAuth, onAck) {
    if (this.wss) return;
    this.wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const host = req.headers.host || "localhost:3000";
      let url;
      try {
        url = new URL(req.url || "/", `http://${host}`);
      } catch {
        socket.destroy();
        return;
      }
      if (url.pathname !== "/ws/agent") {
        return;
      }
      const shopSlug = (url.searchParams.get("shop_slug") || "").trim().toLowerCase();
      const apiKey = url.searchParams.get("api_key") || (typeof req.headers["x-agent-key"] === "string" ? req.headers["x-agent-key"] : null) || (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ") ? req.headers.authorization.slice("Bearer ".length).trim() : null);
      if (!shopSlug || !verifyAuth(shopSlug, req, apiKey)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        const clientId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.wsClients.set(clientId, { id: clientId, shopSlug, socket: ws });
        ws.send(
          JSON.stringify({
            event: "agent.connected",
            shop_slug: shopSlug,
            transport: "websocket",
            connected_at: (/* @__PURE__ */ new Date()).toISOString()
          })
        );
        ws.on("message", async (raw) => {
          try {
            const msg = JSON.parse(raw.toString("utf8"));
            if (msg.type === "ack" && typeof msg.notification_id === "string") {
              const ok = await onAck(shopSlug, msg.notification_id.trim());
              ws.send(
                JSON.stringify({
                  event: "notification.ack_result",
                  notification_id: msg.notification_id.trim(),
                  acked: ok
                })
              );
            } else if (msg.type === "ping") {
              ws.send(JSON.stringify({ event: "pong", ts: Date.now() }));
            }
          } catch {
          }
        });
        ws.on("close", () => {
          this.wsClients.delete(clientId);
        });
        ws.on("error", () => {
          this.wsClients.delete(clientId);
        });
      });
    });
  }
  registerSseClient(shopSlug, res) {
    const cleanSlug = shopSlug.trim().toLowerCase();
    const clientId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    this.sseClients.set(clientId, { id: clientId, shopSlug: cleanSlug, res });
    res.write(
      `event: connected
data: ${JSON.stringify({
        event: "agent.connected",
        shop_slug: cleanSlug,
        transport: "sse",
        connected_at: (/* @__PURE__ */ new Date()).toISOString()
      })}

`
    );
    res.on("close", () => {
      this.sseClients.delete(clientId);
    });
    return clientId;
  }
  getConnectedCount(shopSlug) {
    const clean = shopSlug.trim().toLowerCase();
    let sse = 0;
    let ws = 0;
    for (const c of this.sseClients.values()) {
      if (c.shopSlug === clean) sse += 1;
    }
    for (const c of this.wsClients.values()) {
      if (c.shopSlug === clean && c.socket.readyState === WebSocket.OPEN) ws += 1;
    }
    return { sse, ws, total: sse + ws };
  }
  /**
   * Push standardized agent_payload to all connected SSE and WebSocket Agents for shop_slug.
   * Returns number of live recipients that accepted the frame.
   */
  publishOrderCreated(payload) {
    const cleanSlug = payload.shop_slug.trim().toLowerCase();
    const serialized = JSON.stringify(payload);
    let deliveredCount = 0;
    for (const [id, client] of this.sseClients.entries()) {
      if (client.shopSlug !== cleanSlug) continue;
      try {
        client.res.write(
          `id: ${payload.notification_id}
event: ${payload.event}
data: ${serialized}

`
        );
        deliveredCount += 1;
      } catch {
        this.sseClients.delete(id);
      }
    }
    for (const [id, client] of this.wsClients.entries()) {
      if (client.shopSlug !== cleanSlug) continue;
      if (client.socket.readyState !== WebSocket.OPEN) {
        this.wsClients.delete(id);
        continue;
      }
      try {
        client.socket.send(serialized);
        deliveredCount += 1;
      } catch {
        this.wsClients.delete(id);
      }
    }
    return deliveredCount;
  }
};
var agentHub = new AgentRealtimeHub();

// server.ts
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = path3.dirname(__filename2);
var ALLOWED_ORDER_STATUSES = [
  "new",
  "confirmed",
  "shipping",
  "completed",
  "cancelled"
];
function extractAgentCredentials(req) {
  const headerKey = typeof req.headers["x-agent-key"] === "string" ? req.headers["x-agent-key"].trim() : null;
  const queryKey = typeof req.query.api_key === "string" ? req.query.api_key.trim() : null;
  const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : null;
  let bearerToken = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    bearerToken = authHeader.slice("Bearer ".length).trim();
  }
  return {
    apiKey: headerKey || queryKey || bearerToken,
    bearerJwt: bearerToken
  };
}
function isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt) {
  if (store.verifyShopAgentKey(shopSlug, apiKey)) {
    return true;
  }
  if (bearerJwt) {
    const tokenPayload = verifyAccessToken(bearerJwt);
    if (tokenPayload && tokenPayload.role !== "super_admin" && tokenPayload.shopId) {
      const shop = store.getShopBySlug(shopSlug);
      if (shop && shop.id === tokenPayload.shopId) {
        return true;
      }
    }
  }
  return false;
}
async function handleCreateOrder(req, res, forcedSlug) {
  try {
    const body = req.body ?? {};
    const slug = String(forcedSlug || body.shop_slug || body.shopSlug || "mam").trim().toLowerCase();
    const customerName = body.customer_name ?? body.customerName;
    const customerPhone = body.phone_or_contact ?? body.customerPhone;
    const customerAddress = body.shipping_address ?? body.customerAddress;
    const customerNote = body.customer_note ?? body.customerNote ?? "";
    const rawItems = body.items;
    const origin = body.origin;
    if (typeof customerName !== "string" || customerName.trim().length < 2) {
      res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp h\u1ECD t\xEAn ng\u01B0\u1EDDi nh\u1EADn (t\u1ED1i thi\u1EC3u 2 k\xFD t\u1EF1)." });
      return;
    }
    if (typeof customerPhone !== "string" || !isValidVietnamPhone(customerPhone)) {
      res.status(400).json({
        error: "S\u1ED1 \u0111i\u1EC7n tho\u1EA1i kh\xF4ng h\u1EE3p l\u1EC7 (c\u1EA7n 10 s\u1ED1, b\u1EAFt \u0111\u1EA7u b\u1EB1ng 03, 05, 07, 08 ho\u1EB7c 09)."
      });
      return;
    }
    if (typeof customerAddress !== "string" || customerAddress.trim().length < 5) {
      res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp \u0111\u1ECBa ch\u1EC9 giao h\xE0ng chi ti\u1EBFt h\u01A1n." });
      return;
    }
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(400).json({ error: "Gi\u1ECF h\xE0ng c\u1EE7a b\u1EA1n \u0111ang tr\u1ED1ng." });
      return;
    }
    const normalizedItems = rawItems.map((it) => ({
      variantId: typeof it.variantId === "string" ? it.variantId : typeof it.variant_id === "string" ? it.variant_id : void 0,
      sku: typeof it.sku === "string" ? it.sku : void 0,
      productName: typeof it.productName === "string" ? it.productName : typeof it.product_name === "string" ? it.product_name : void 0,
      colorName: typeof it.colorName === "string" ? it.colorName : typeof it.color_name === "string" ? it.color_name : void 0,
      size: typeof it.size === "string" ? it.size : void 0,
      unitPrice: typeof it.unitPrice === "number" ? it.unitPrice : typeof it.unit_price === "number" ? it.unit_price : void 0,
      quantity: Number(it.quantity ?? 1)
    }));
    const { order, notification } = store.createOrderForShop({
      slug,
      customerName,
      customerPhone,
      customerAddress,
      customerNote: typeof customerNote === "string" ? customerNote : "",
      items: normalizedItems
    });
    await pgBridge.persistOrderAndNotificationTx({
      order,
      shopSlug: slug,
      notification
    });
    const deliveredCount = agentHub.publishOrderCreated(notification.payload);
    let finalDeliveryStatus = notification.deliveryStatus;
    if (deliveredCount > 0) {
      const updated = store.markNotificationDelivered(notification.notificationId);
      finalDeliveryStatus = updated?.deliveryStatus ?? "delivered";
      await pgBridge.updateNotificationStatus({
        notificationId: notification.notificationId,
        deliveryStatus: "delivered",
        deliveredAt: updated?.deliveredAt ?? (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const shop = store.getShopBySlug(slug);
    res.status(201).json({
      order,
      notification_id: notification.notificationId,
      delivery_status: finalDeliveryStatus,
      agent_payload: notification.payload,
      messengerLink: shop.messengerLink
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 t\u1EA1o \u0111\u01A1n h\xE0ng.";
    res.status(400).json({ error: message });
  }
}
async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3e3;
  app.use(express.json({ limit: "1mb" }));
  const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.use("/api", (req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-agent-key");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      }
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
      next();
    });
  }
  app.get("/api/health", async (_req, res) => {
    const db = await pgBridge.getConnectionHealth();
    res.json({ ok: true, db });
  });
  agentHub.attachWebSocketServer(
    httpServer,
    (shopSlug, _req, apiKey) => isAuthorizedForShopAgent(shopSlug, apiKey, apiKey),
    async (shopSlug, notificationId) => {
      const acked = store.ackNotification(shopSlug, notificationId);
      if (!acked) return false;
      await pgBridge.updateNotificationStatus({
        notificationId: acked.notificationId,
        deliveryStatus: "acked",
        ackedAt: acked.ackedAt
      });
      return true;
    }
  );
  app.get("/api/auth/status", (_req, res) => {
    res.json({
      needsBootstrap: store.needsBootstrap(),
      hasShopAdmin: store.hasShopAdmin(),
      hasSuperAdmin: store.hasSuperAdmin()
    });
  });
  app.post("/api/auth/bootstrap", async (req, res) => {
    try {
      const { superAdminEmail, superAdminPassword, shopOwnerEmail, shopOwnerPassword } = req.body ?? {};
      const validId = (val) => typeof val === "string" && val.trim().length >= 3 && !/\s/.test(val.trim());
      if (!validId(superAdminEmail) || typeof superAdminPassword !== "string" || superAdminPassword.length < 6) {
        res.status(400).json({
          error: "Vui l\xF2ng nh\u1EADp t\xE0i kho\u1EA3n/email Admin h\u1EC7 th\u1ED1ng (\u2265 3 k\xFD t\u1EF1, kh\xF4ng kho\u1EA3ng tr\u1EAFng) v\xE0 m\u1EADt kh\u1EA9u t\u1EEB 6 k\xFD t\u1EF1 tr\u1EDF l\xEAn."
        });
        return;
      }
      if (store.hasShopAdmin()) {
        const superAdmin = store.bootstrapSuperAdminOnly({
          superAdminEmail,
          superAdminPassword
        });
        const storedUsers = store.getAllStoredUsers();
        const createdStored = storedUsers.find((u) => u.id === superAdmin.id);
        if (createdStored) await pgBridge.upsertUser(createdStored);
        const token2 = createAccessToken(superAdmin);
        res.status(201).json({ token: token2, user: superAdmin });
        return;
      }
      if (!validId(shopOwnerEmail) || typeof shopOwnerPassword !== "string" || shopOwnerPassword.length < 3) {
        res.status(400).json({
          error: "Vui l\xF2ng nh\u1EADp t\xE0i kho\u1EA3n Ch\u1EE7 shop h\u1EE3p l\u1EC7 v\xE0 m\u1EADt kh\u1EA9u."
        });
        return;
      }
      const created = store.bootstrapInitialAccounts({
        superAdminEmail,
        superAdminPassword,
        shopOwnerEmail,
        shopOwnerPassword
      });
      for (const storedUser of store.getAllStoredUsers()) {
        await pgBridge.upsertUser(storedUser);
      }
      const loginAs = req.body?.loginAs === "super_admin" ? created.superAdmin : created.shopOwner;
      const token = createAccessToken(loginAs);
      res.status(201).json({
        token,
        user: loginAs
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 thi\u1EBFt l\u1EADp t\xE0i kho\u1EA3n.";
      res.status(400).json({ error: message });
    }
  });
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp \u0111\u1EA7y \u0111\u1EE7 t\xE0i kho\u1EA3n v\xE0 m\u1EADt kh\u1EA9u." });
      return;
    }
    const user = store.authenticateUser(email, password);
    if (!user) {
      res.status(401).json({ error: "T\xE0i kho\u1EA3n ho\u1EB7c m\u1EADt kh\u1EA9u kh\xF4ng \u0111\xFAng." });
      return;
    }
    const token = createAccessToken(user);
    res.json({ token, user });
  });
  app.get("/api/auth/me", requireAuth, (req, res) => {
    const user = store.getUserById(req.auth.sub);
    if (!user) {
      res.status(401).json({ error: "T\xE0i kho\u1EA3n kh\xF4ng c\xF2n t\u1ED3n t\u1EA1i ho\u1EB7c \u0111\xE3 b\u1ECB g\u1EE1 quy\u1EC1n." });
      return;
    }
    res.json({ user });
  });
  app.get("/api/shops/:slug", (req, res) => {
    const shop = store.getShopBySlug(req.params.slug);
    if (!shop) {
      res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng n\xE0y." });
      return;
    }
    const products = shop.isActive ? store.getProductsForShop(shop.id, true) : [];
    res.json({
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        orderPrefix: shop.orderPrefix,
        messengerLink: shop.messengerLink,
        isActive: shop.isActive
      },
      products
    });
  });
  app.post("/api/orders", (req, res) => {
    void handleCreateOrder(req, res);
  });
  app.post("/api/shops/:slug/orders", (req, res) => {
    void handleCreateOrder(req, res, req.params.slug);
  });
  app.get("/api/agent/stream", (req, res) => {
    const shopSlug = String(req.query.shop_slug || "").trim().toLowerCase();
    if (!shopSlug) {
      res.status(400).json({ error: "Thi\u1EBFu tham s\u1ED1 shop_slug (v\xED d\u1EE5: ?shop_slug=mam)." });
      return;
    }
    const { apiKey, bearerJwt } = extractAgentCredentials(req);
    if (!isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt)) {
      res.status(401).json({
        error: "Kh\xF3a x\xE1c th\u1EF1c Agent kh\xF4ng h\u1EE3p l\u1EC7. Truy\u1EC1n header x-agent-key ho\u1EB7c ?api_key=..."
      });
      return;
    }
    agentHub.registerSseClient(shopSlug, res);
  });
  app.get("/api/agent/notifications/pending", async (req, res) => {
    const shopSlug = String(req.query.shop_slug || "").trim().toLowerCase();
    if (!shopSlug) {
      res.status(400).json({ error: "Thi\u1EBFu tham s\u1ED1 shop_slug (v\xED d\u1EE5: ?shop_slug=mam)." });
      return;
    }
    const { apiKey, bearerJwt } = extractAgentCredentials(req);
    if (!isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt)) {
      res.status(401).json({
        error: "Kh\xF3a x\xE1c th\u1EF1c Agent kh\xF4ng h\u1EE3p l\u1EC7. Truy\u1EC1n header x-agent-key ho\u1EB7c Authorization: Bearer."
      });
      return;
    }
    const pgPending = await pgBridge.fetchPendingNotifications(shopSlug);
    const list = pgPending ?? store.listAgentNotifications(shopSlug, true);
    res.json({
      shop_slug: shopSlug,
      count: list.length,
      notifications: list.map((n) => ({
        notification_id: n.notificationId,
        order_id: n.orderId,
        shop_slug: n.shopSlug,
        delivery_status: n.deliveryStatus,
        retry_count: n.retryCount,
        last_error: n.lastError,
        created_at: n.createdAt,
        delivered_at: n.deliveredAt,
        acked_at: n.ackedAt,
        agent_payload: n.payload
      }))
    });
  });
  app.post("/api/agent/notifications/:notification_id/ack", async (req, res) => {
    const notificationId = req.params.notification_id.trim();
    const existing = store.getAgentNotification(notificationId);
    const shopSlug = existing?.shopSlug || String(req.body?.shop_slug || req.query.shop_slug || "mam").trim().toLowerCase();
    const { apiKey, bearerJwt } = extractAgentCredentials(req);
    if (!isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt)) {
      res.status(401).json({ error: "Kh\xF3a x\xE1c th\u1EF1c Agent kh\xF4ng h\u1EE3p l\u1EC7." });
      return;
    }
    if (req.body?.status === "failed") {
      const errText = typeof req.body?.error === "string" ? req.body.error : "Agent reported failure";
      const failed = store.failNotification(shopSlug, notificationId, errText);
      if (!failed) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y th\xF4ng b\xE1o n\xE0y." });
        return;
      }
      await pgBridge.updateNotificationStatus({
        notificationId: failed.notificationId,
        deliveryStatus: "failed",
        retryCount: failed.retryCount,
        lastError: failed.lastError
      });
      res.json({
        ok: true,
        notification_id: failed.notificationId,
        delivery_status: failed.deliveryStatus,
        retry_count: failed.retryCount,
        last_error: failed.lastError
      });
      return;
    }
    const acked = store.ackNotification(shopSlug, notificationId);
    if (!acked) {
      res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y th\xF4ng b\xE1o n\xE0y." });
      return;
    }
    await pgBridge.updateNotificationStatus({
      notificationId: acked.notificationId,
      deliveryStatus: "acked",
      ackedAt: acked.ackedAt
    });
    res.json({
      ok: true,
      notification_id: acked.notificationId,
      delivery_status: acked.deliveryStatus,
      acked_at: acked.ackedAt
    });
  });
  app.post("/api/agent/notifications/:notification_id/fail", async (req, res) => {
    const notificationId = req.params.notification_id.trim();
    const existing = store.getAgentNotification(notificationId);
    const shopSlug = existing?.shopSlug || String(req.body?.shop_slug || req.query.shop_slug || "mam").trim().toLowerCase();
    const { apiKey, bearerJwt } = extractAgentCredentials(req);
    if (!isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt)) {
      res.status(401).json({ error: "Kh\xF3a x\xE1c th\u1EF1c Agent kh\xF4ng h\u1EE3p l\u1EC7." });
      return;
    }
    const errText = typeof req.body?.error === "string" ? req.body.error : "Agent failed to deliver message";
    const failed = store.failNotification(shopSlug, notificationId, errText);
    if (!failed) {
      res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y th\xF4ng b\xE1o n\xE0y." });
      return;
    }
    await pgBridge.updateNotificationStatus({
      notificationId: failed.notificationId,
      deliveryStatus: "failed",
      retryCount: failed.retryCount,
      lastError: failed.lastError
    });
    res.json({
      ok: true,
      notification_id: failed.notificationId,
      delivery_status: failed.deliveryStatus,
      retry_count: failed.retryCount,
      last_error: failed.lastError
    });
  });
  app.get("/api/admin/shops/:shopId/summary", requireAuth, requireShopAccess, (req, res) => {
    const shop = store.getShopById(req.params.shopId);
    if (!shop) {
      res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng." });
      return;
    }
    res.json({ shop });
  });
  app.get("/api/admin/shops/:shopId/products", requireAuth, requireShopAccess, (req, res) => {
    const products = store.getProductsForShop(req.params.shopId, false);
    res.json({ products });
  });
  app.post("/api/admin/shops/:shopId/products", requireAuth, requireShopAccess, async (req, res) => {
    try {
      const { name, code, price, description, colors, sizes, isActive } = req.body ?? {};
      if (typeof name !== "string" || name.trim().length < 2) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp t\xEAn s\u1EA3n ph\u1EA9m." });
        return;
      }
      const numPrice = Number(price);
      if (!Number.isFinite(numPrice) || numPrice <= 0) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp gi\xE1 b\xE1n h\u1EE3p l\u1EC7 (> 0)." });
        return;
      }
      if (!Array.isArray(colors) || colors.length === 0) {
        res.status(400).json({ error: "Vui l\xF2ng c\u1EA5u h\xECnh \xEDt nh\u1EA5t 1 m\xE0u s\u1EAFc." });
        return;
      }
      if (!Array.isArray(sizes) || sizes.length === 0) {
        res.status(400).json({ error: "Vui l\xF2ng ch\u1ECDn \xEDt nh\u1EA5t 1 size." });
        return;
      }
      const product = store.createProduct(req.params.shopId, {
        name,
        code: typeof code === "string" && code.trim() ? code : void 0,
        price: numPrice,
        description: typeof description === "string" ? description : "",
        colors,
        sizes,
        isActive: isActive !== false
      });
      await pgBridge.upsertProduct(product);
      res.status(201).json({ product });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 t\u1EA1o s\u1EA3n ph\u1EA9m.";
      res.status(400).json({ error: message });
    }
  });
  app.patch(
    "/api/admin/shops/:shopId/products/:productId",
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        const product = store.updateProduct(req.params.shopId, req.params.productId, req.body ?? {});
        await pgBridge.upsertProduct(product);
        res.json({ product });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 c\u1EADp nh\u1EADt s\u1EA3n ph\u1EA9m.";
        res.status(400).json({ error: message });
      }
    }
  );
  app.delete(
    "/api/admin/shops/:shopId/products/:productId",
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        store.deleteProduct(req.params.shopId, req.params.productId);
        await pgBridge.deleteProduct(req.params.shopId, req.params.productId);
        res.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 x\xF3a s\u1EA3n ph\u1EA9m.";
        res.status(400).json({ error: message });
      }
    }
  );
  app.get("/api/admin/shops/:shopId/orders", requireAuth, requireShopAccess, (req, res) => {
    const orders = store.getOrdersForShop(req.params.shopId);
    res.json({ orders });
  });
  app.patch(
    "/api/admin/shops/:shopId/orders/:orderId",
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        const { status, trackingCode, adminNote } = req.body ?? {};
        if (status !== void 0 && !ALLOWED_ORDER_STATUSES.includes(status)) {
          res.status(400).json({ error: "Tr\u1EA1ng th\xE1i \u0111\u01A1n h\xE0ng kh\xF4ng h\u1EE3p l\u1EC7." });
          return;
        }
        const order = store.updateOrderForShop(req.params.shopId, req.params.orderId, {
          status,
          trackingCode: typeof trackingCode === "string" ? trackingCode : void 0,
          adminNote: typeof adminNote === "string" ? adminNote : void 0
        });
        await pgBridge.updateOrderStatus({
          orderId: order.id,
          status: order.status,
          trackingCode: order.trackingCode,
          adminNote: order.adminNote,
          updatedAt: order.updatedAt
        });
        res.json({ order });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 c\u1EADp nh\u1EADt \u0111\u01A1n h\xE0ng.";
        res.status(400).json({ error: message });
      }
    }
  );
  app.get(
    "/api/admin/shops/:shopId/agent-notifications",
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      const shop = store.getShopById(req.params.shopId);
      if (!shop) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng." });
        return;
      }
      const notifications = store.listAgentNotifications(shop.slug, false);
      const connections = agentHub.getConnectedCount(shop.slug);
      const dbHealth = await pgBridge.getConnectionHealth();
      res.json({
        shopSlug: shop.slug,
        agentApiKey: shop.agentApiKey,
        connections,
        dbMode: dbHealth.mode,
        notifications
      });
    }
  );
  app.post(
    "/api/admin/shops/:shopId/agent-notifications/:notificationId/retry",
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      const shop = store.getShopById(req.params.shopId);
      if (!shop) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng." });
        return;
      }
      const notif = store.incrementNotificationRetry(shop.slug, req.params.notificationId);
      if (!notif) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y th\xF4ng b\xE1o." });
        return;
      }
      const deliveredCount = agentHub.publishOrderCreated(notif.payload);
      const updated = deliveredCount > 0 ? store.markNotificationDelivered(notif.notificationId) ?? notif : notif;
      await pgBridge.updateNotificationStatus({
        notificationId: updated.notificationId,
        deliveryStatus: updated.deliveryStatus,
        retryCount: updated.retryCount,
        deliveredAt: updated.deliveredAt
      });
      res.json({
        notification: updated,
        deliveredCount
      });
    }
  );
  app.post(
    "/api/admin/shops/:shopId/agent-notifications/:notificationId/ack",
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      const shop = store.getShopById(req.params.shopId);
      if (!shop) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y gian h\xE0ng." });
        return;
      }
      const acked = store.ackNotification(shop.slug, req.params.notificationId);
      if (!acked) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y th\xF4ng b\xE1o." });
        return;
      }
      await pgBridge.updateNotificationStatus({
        notificationId: acked.notificationId,
        deliveryStatus: "acked",
        ackedAt: acked.ackedAt
      });
      res.json({ notification: acked });
    }
  );
  app.post(
    "/api/admin/shops/:shopId/agent-key/rotate",
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        const agentApiKey = store.rotateShopAgentKey(req.params.shopId);
        const shop = store.getShopById(req.params.shopId);
        if (shop) await pgBridge.upsertShop(shop);
        res.json({ agentApiKey });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 \u0111\u1ED5i kh\xF3a Agent.";
        res.status(400).json({ error: message });
      }
    }
  );
  app.get("/api/super-admin/shops", requireAuth, requireSuperAdmin, (_req, res) => {
    res.json({ shops: store.listShopsForSuperAdmin() });
  });
  app.post("/api/super-admin/shops", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, slug, orderPrefix, messengerLink } = req.body ?? {};
      if (typeof name !== "string" || name.trim().length < 2) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp t\xEAn gian h\xE0ng." });
        return;
      }
      if (typeof slug !== "string" || !slug.trim()) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp \u0111\u01B0\u1EDDng d\u1EABn (slug) gian h\xE0ng." });
        return;
      }
      if (typeof orderPrefix !== "string" || orderPrefix.trim().length < 2) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp ti\u1EC1n t\u1ED1 m\xE3 \u0111\u01A1n (t\u1ED1i thi\u1EC3u 2 k\xFD t\u1EF1)." });
        return;
      }
      if (typeof messengerLink !== "string" || !isValidMessengerUrl(messengerLink)) {
        res.status(400).json({
          error: "Link Messenger ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng https://m.me/... ho\u1EB7c https://messenger.com/..."
        });
        return;
      }
      const shop = store.createShop({ name, slug, orderPrefix, messengerLink });
      const rawShop = store.getShopById(shop.id);
      if (rawShop) await pgBridge.upsertShop(rawShop);
      res.status(201).json({ shop });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 t\u1EA1o gian h\xE0ng.";
      res.status(400).json({ error: message });
    }
  });
  app.patch("/api/super-admin/shops/:shopId", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, orderPrefix, messengerLink, isActive } = req.body ?? {};
      if (messengerLink !== void 0 && !isValidMessengerUrl(String(messengerLink))) {
        res.status(400).json({
          error: "Link Messenger ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng https://m.me/... ho\u1EB7c https://messenger.com/..."
        });
        return;
      }
      const shop = store.updateShop(req.params.shopId, {
        name: typeof name === "string" ? name : void 0,
        orderPrefix: typeof orderPrefix === "string" ? orderPrefix : void 0,
        messengerLink: typeof messengerLink === "string" ? messengerLink : void 0,
        isActive: typeof isActive === "boolean" ? isActive : void 0
      });
      const rawShop = store.getShopById(shop.id);
      if (rawShop) await pgBridge.upsertShop(rawShop);
      res.json({ shop });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 c\u1EADp nh\u1EADt gian h\xE0ng.";
      res.status(400).json({ error: message });
    }
  });
  app.post("/api/super-admin/shops/:shopId/members", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { email, displayName, password, role } = req.body ?? {};
      if (typeof email !== "string" || email.trim().length < 3 || /\s/.test(email.trim())) {
        res.status(400).json({
          error: "Vui l\xF2ng nh\u1EADp t\xEAn t\xE0i kho\u1EA3n ho\u1EB7c email h\u1EE3p l\u1EC7 (\u2265 3 k\xFD t\u1EF1, kh\xF4ng kho\u1EA3ng tr\u1EAFng)."
        });
        return;
      }
      if (typeof password !== "string" || password.length < 3) {
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 3 k\xFD t\u1EF1." });
        return;
      }
      const cleanRole = role === "shop_staff" ? "shop_staff" : "shop_owner";
      const member = store.addShopMember(req.params.shopId, {
        email,
        displayName: typeof displayName === "string" ? displayName : "",
        password,
        role: cleanRole
      });
      const storedUser = store.getAllStoredUsers().find((u) => u.id === member.id);
      if (storedUser) await pgBridge.upsertUser(storedUser);
      res.status(201).json({ member });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 c\u1EA5p quy\u1EC1n t\xE0i kho\u1EA3n.";
      res.status(400).json({ error: message });
    }
  });
  app.delete(
    "/api/super-admin/shops/:shopId/members/:userId",
    requireAuth,
    requireSuperAdmin,
    async (req, res) => {
      try {
        store.removeShopMember(req.params.shopId, req.params.userId);
        await pgBridge.deleteUser(req.params.userId);
        res.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Kh\xF4ng th\u1EC3 g\u1EE1 quy\u1EC1n t\xE0i kho\u1EA3n.";
        res.status(400).json({ error: message });
      }
    }
  );
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API kh\xF4ng t\u1ED3n t\u1EA1i." });
  });
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path3.resolve(__dirname2, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path3.join(distDir, "index.html"));
    });
  }
  if (pgBridge.isConfigured()) {
    const schemaReady = await pgBridge.ensureSchema();
    if (schemaReady) {
      const pgState = await pgBridge.loadFullState();
      if (pgState && (pgState.products.length > 0 || pgState.users.length > 0)) {
        store.hydrateFromPostgres(pgState);
        console.log(
          `Hydrated from PostgreSQL (${pgState.shops.length} shops, ${pgState.products.length} products, ${pgState.orders.length} orders).`
        );
      } else {
        for (const shop of store.getAllShops()) {
          await pgBridge.upsertShop(shop);
          const products = store.getProductsForShop(shop.id, false);
          for (const product of products) {
            await pgBridge.upsertProduct(product);
          }
          const orders = store.getOrdersForShop(shop.id);
          const notifications = store.listAgentNotifications(shop.slug, false);
          for (const order of orders) {
            const notif = notifications.find((n) => n.orderId === order.id);
            if (notif) {
              await pgBridge.persistOrderAndNotificationTx({
                order,
                shopSlug: shop.slug,
                notification: notif
              });
            }
          }
        }
        for (const storedUser of store.getAllStoredUsers()) {
          await pgBridge.upsertUser(storedUser);
        }
        console.log("PostgreSQL schema initialized and initial data synced to Aiven.");
      }
    } else {
      console.warn("PostgreSQL configured but unreachable; falling back to local store.");
    }
  }
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
