import 'dotenv/config';
import http from 'node:http';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isValidMessengerUrl,
  isValidVietnamPhone,
  type OrderStatus,
} from './src/shared/types.ts';
import {
  createAccessToken,
  requireAuth,
  requireShopAccess,
  requireSuperAdmin,
  verifyAccessToken,
  type AuthedRequest,
} from './server/auth.ts';
import { store } from './server/store.ts';
import { agentHub } from './server/realtime.ts';
import { pgBridge } from './server/pg-bridge.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_ORDER_STATUSES: OrderStatus[] = ['new', 'completed'];

function extractAgentCredentials(req: Request): {
  apiKey: string | null;
  bearerJwt: string | null;
} {
  const headerKey =
    typeof req.headers['x-agent-key'] === 'string' ? req.headers['x-agent-key'].trim() : null;
  const queryKey = typeof req.query.api_key === 'string' ? req.query.api_key.trim() : null;
  const authHeader =
    typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : null;

  let bearerToken: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice('Bearer '.length).trim();
  }

  return {
    apiKey: headerKey || queryKey || bearerToken,
    bearerJwt: bearerToken,
  };
}

function isAuthorizedForShopAgent(
  shopSlug: string,
  apiKey: string | null,
  bearerJwt: string | null
): boolean {
  if (store.verifyShopAgentKey(shopSlug, apiKey)) {
    return true;
  }
  if (bearerJwt) {
    const tokenPayload = verifyAccessToken(bearerJwt);
    if (tokenPayload && tokenPayload.role !== 'super_admin' && tokenPayload.shopId) {
      const shop = store.getShopBySlug(shopSlug);
      if (shop && shop.id === tokenPayload.shopId) {
        return true;
      }
    }
  }
  return false;
}

async function handleCreateOrder(req: Request, res: Response, forcedSlug?: string) {
  try {
    const body = req.body ?? {};
    const slug = String(forcedSlug || body.shop_slug || body.shopSlug || 'mam')
      .trim()
      .toLowerCase();

    const customerName = body.customer_name ?? body.customerName;
    const customerPhone = body.phone_or_contact ?? body.customerPhone;
    const customerAddress = body.shipping_address ?? body.customerAddress;
    const customerNote = body.customer_note ?? body.customerNote ?? '';
    const rawItems = body.items;
    const origin = body.origin;

    if (typeof customerName !== 'string' || customerName.trim().length < 2) {
      res.status(400).json({ error: 'Vui lòng nhập họ tên người nhận (tối thiểu 2 ký tự).' });
      return;
    }
    if (typeof customerPhone !== 'string' || !isValidVietnamPhone(customerPhone)) {
      res.status(400).json({
        error: 'Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 03, 05, 07, 08 hoặc 09).',
      });
      return;
    }
    if (typeof customerAddress !== 'string' || customerAddress.trim().length < 5) {
      res.status(400).json({ error: 'Vui lòng nhập địa chỉ giao hàng chi tiết hơn.' });
      return;
    }
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(400).json({ error: 'Giỏ hàng của bạn đang trống.' });
      return;
    }

    const normalizedItems = rawItems.map((it: Record<string, unknown>) => ({
      variantId: typeof it.variantId === 'string' ? it.variantId : typeof it.variant_id === 'string' ? it.variant_id : undefined,
      sku: typeof it.sku === 'string' ? it.sku : undefined,
      productName:
        typeof it.productName === 'string'
          ? it.productName
          : typeof it.product_name === 'string'
            ? it.product_name
            : undefined,
      colorName:
        typeof it.colorName === 'string'
          ? it.colorName
          : typeof it.color_name === 'string'
            ? it.color_name
            : undefined,
      size: typeof it.size === 'string' ? it.size : undefined,
      unitPrice:
        typeof it.unitPrice === 'number'
          ? it.unitPrice
          : typeof it.unit_price === 'number'
            ? it.unit_price
            : undefined,
      quantity: Number(it.quantity ?? 1),
    }));

    // 1. Create order + agent_notification atomically in store
    const { order, notification } = store.createOrderForShop({
      slug,
      customerName,
      customerPhone,
      customerAddress,
      customerNote: typeof customerNote === 'string' ? customerNote : '',
      items: normalizedItems,
    });

    // 2. Persist orders + agent_notifications inside a PostgreSQL transaction when DATABASE_URL is configured
    await pgBridge.persistOrderAndNotificationTx({
      order,
      shopSlug: slug,
      notification,
    });

    // 3. Emit realtime event (SSE + WebSocket) to connected Agents for this shop_slug
    const deliveredCount = agentHub.publishOrderCreated(notification.payload);
    let finalDeliveryStatus = notification.deliveryStatus;

    if (deliveredCount > 0) {
      const updated = store.markNotificationDelivered(notification.notificationId);
      finalDeliveryStatus = updated?.deliveryStatus ?? 'delivered';
      await pgBridge.updateNotificationStatus({
        notificationId: notification.notificationId,
        deliveryStatus: 'delivered',
        deliveredAt: updated?.deliveredAt ?? new Date().toISOString(),
      });
    }

    const shop = store.getShopBySlug(slug)!;

    res.status(201).json({
      order,
      notification_id: notification.notificationId,
      delivery_status: finalDeliveryStatus,
      agent_payload: notification.payload,
      messengerLink: shop.messengerLink,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Không thể tạo đơn hàng.';
    res.status(400).json({ error: message });
  }
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '1mb' }));

  // Allowlist-only CORS for separate static frontend hosting (e.g. GitHub Pages -> Render API).
  // Never emits wildcard "*" on authenticated endpoints.
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (allowedOrigins.length > 0) {
    app.use('/api', (req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-agent-key');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  app.get('/api/health', async (_req, res) => {
    const db = await pgBridge.getConnectionHealth();
    res.json({ ok: true, db });
  });

  // Attach WebSocket server on /ws/agent?shop_slug=mam&api_key=...
  agentHub.attachWebSocketServer(
    httpServer,
    (shopSlug, _req, apiKey) => isAuthorizedForShopAgent(shopSlug, apiKey, apiKey),
    async (shopSlug, notificationId) => {
      const acked = store.ackNotification(shopSlug, notificationId);
      if (!acked) return false;
      await pgBridge.updateNotificationStatus({
        notificationId: acked.notificationId,
        deliveryStatus: 'acked',
        ackedAt: acked.ackedAt,
      });
      return true;
    }
  );

  // =========================================================================
  // AUTH ROUTES
  // =========================================================================

  app.get('/api/auth/status', (_req, res) => {
    res.json({
      needsBootstrap: store.needsBootstrap(),
      hasShopAdmin: store.hasShopAdmin(),
      hasSuperAdmin: store.hasSuperAdmin(),
    });
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    try {
      const { superAdminEmail, superAdminPassword, shopOwnerEmail, shopOwnerPassword } =
        req.body ?? {};
      const validId = (val: unknown) =>
        typeof val === 'string' && val.trim().length >= 3 && !/\s/.test(val.trim());

      if (
        !validId(superAdminEmail) ||
        typeof superAdminPassword !== 'string' ||
        superAdminPassword.length < 6
      ) {
        res.status(400).json({
          error:
            'Vui lòng nhập tài khoản/email Admin hệ thống (≥ 3 ký tự, không khoảng trắng) và mật khẩu từ 6 ký tự trở lên.',
        });
        return;
      }

      if (store.hasShopAdmin()) {
        const superAdmin = store.bootstrapSuperAdminOnly({
          superAdminEmail,
          superAdminPassword,
        });
        const storedUsers = store.getAllStoredUsers();
        const createdStored = storedUsers.find((u) => u.id === superAdmin.id);
        if (createdStored) await pgBridge.upsertUser(createdStored);

        const token = createAccessToken(superAdmin);
        res.status(201).json({ token, user: superAdmin });
        return;
      }

      if (
        !validId(shopOwnerEmail) ||
        typeof shopOwnerPassword !== 'string' ||
        shopOwnerPassword.length < 3
      ) {
        res.status(400).json({
          error: 'Vui lòng nhập tài khoản Chủ shop hợp lệ và mật khẩu.',
        });
        return;
      }

      const created = store.bootstrapInitialAccounts({
        superAdminEmail,
        superAdminPassword,
        shopOwnerEmail,
        shopOwnerPassword,
      });

      for (const storedUser of store.getAllStoredUsers()) {
        await pgBridge.upsertUser(storedUser);
      }

      const loginAs = req.body?.loginAs === 'super_admin' ? created.superAdmin : created.shopOwner;
      const token = createAccessToken(loginAs);
      res.status(201).json({
        token,
        user: loginAs,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Không thể thiết lập tài khoản.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.' });
      return;
    }
    const user = store.authenticateUser(email, password);
    if (!user) {
      res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không đúng.' });
      return;
    }
    const token = createAccessToken(user);
    res.json({ token, user });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const user = store.getUserById(req.auth!.sub);
    if (!user) {
      res.status(401).json({ error: 'Tài khoản không còn tồn tại hoặc đã bị gỡ quyền.' });
      return;
    }
    res.json({ user });
  });

  // =========================================================================
  // PUBLIC STOREFRONT & ORDER CREATION ROUTES (F1-F5, F7)
  // =========================================================================

  app.get('/api/shops/:slug', (req, res) => {
    const shop = store.getShopBySlug(req.params.slug);
    if (!shop) {
      res.status(404).json({ error: 'Không tìm thấy gian hàng này.' });
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
        isActive: shop.isActive,
      },
      products,
    });
  });

  // Standard unified order creation endpoint requested for Agent pipeline
  app.post('/api/orders', (req, res) => {
    void handleCreateOrder(req, res);
  });

  // Per-shop storefront order creation endpoint (same pipeline + agent_payload)
  app.post('/api/shops/:slug/orders', (req, res) => {
    void handleCreateOrder(req, res, req.params.slug);
  });

  // =========================================================================
  // AGENT REALTIME STREAM & NOTIFICATION PULL/ACK ENDPOINTS
  // Authenticated via x-agent-key / Authorization: Bearer <agent_key> / ?api_key=
  // =========================================================================

  app.get('/api/agent/stream', (req, res) => {
    const shopSlug = String(req.query.shop_slug || '').trim().toLowerCase();
    if (!shopSlug) {
      res.status(400).json({ error: 'Thiếu tham số shop_slug (ví dụ: ?shop_slug=mam).' });
      return;
    }
    const { apiKey, bearerJwt } = extractAgentCredentials(req);
    if (!isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt)) {
      res.status(401).json({
        error: 'Khóa xác thực Agent không hợp lệ. Truyền header x-agent-key hoặc ?api_key=...',
      });
      return;
    }
    agentHub.registerSseClient(shopSlug, res);
  });

  app.get('/api/agent/notifications/pending', async (req, res) => {
    const shopSlug = String(req.query.shop_slug || '').trim().toLowerCase();
    if (!shopSlug) {
      res.status(400).json({ error: 'Thiếu tham số shop_slug (ví dụ: ?shop_slug=mam).' });
      return;
    }
    const { apiKey, bearerJwt } = extractAgentCredentials(req);
    if (!isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt)) {
      res.status(401).json({
        error: 'Khóa xác thực Agent không hợp lệ. Truyền header x-agent-key hoặc Authorization: Bearer.',
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
        agent_payload: n.payload,
      })),
    });
  });

  app.post('/api/agent/notifications/:notification_id/ack', async (req, res) => {
    const notificationId = req.params.notification_id.trim();
    const existing = store.getAgentNotification(notificationId);
    const shopSlug = existing?.shopSlug || String(req.body?.shop_slug || req.query.shop_slug || 'mam').trim().toLowerCase();

    const { apiKey, bearerJwt } = extractAgentCredentials(req);
    if (!isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt)) {
      res.status(401).json({ error: 'Khóa xác thực Agent không hợp lệ.' });
      return;
    }

    if (req.body?.status === 'failed') {
      const errText = typeof req.body?.error === 'string' ? req.body.error : 'Agent reported failure';
      const failed = store.failNotification(shopSlug, notificationId, errText);
      if (!failed) {
        res.status(404).json({ error: 'Không tìm thấy thông báo này.' });
        return;
      }
      await pgBridge.updateNotificationStatus({
        notificationId: failed.notificationId,
        deliveryStatus: 'failed',
        retryCount: failed.retryCount,
        lastError: failed.lastError,
      });
      res.json({
        ok: true,
        notification_id: failed.notificationId,
        delivery_status: failed.deliveryStatus,
        retry_count: failed.retryCount,
        last_error: failed.lastError,
      });
      return;
    }

    const acked = store.ackNotification(shopSlug, notificationId);
    if (!acked) {
      res.status(404).json({ error: 'Không tìm thấy thông báo này.' });
      return;
    }
    await pgBridge.updateNotificationStatus({
      notificationId: acked.notificationId,
      deliveryStatus: 'acked',
      ackedAt: acked.ackedAt,
    });

    res.json({
      ok: true,
      notification_id: acked.notificationId,
      delivery_status: acked.deliveryStatus,
      acked_at: acked.ackedAt,
    });
  });

  app.post('/api/agent/notifications/:notification_id/fail', async (req, res) => {
    const notificationId = req.params.notification_id.trim();
    const existing = store.getAgentNotification(notificationId);
    const shopSlug = existing?.shopSlug || String(req.body?.shop_slug || req.query.shop_slug || 'mam').trim().toLowerCase();

    const { apiKey, bearerJwt } = extractAgentCredentials(req);
    if (!isAuthorizedForShopAgent(shopSlug, apiKey, bearerJwt)) {
      res.status(401).json({ error: 'Khóa xác thực Agent không hợp lệ.' });
      return;
    }

    const errText =
      typeof req.body?.error === 'string' ? req.body.error : 'Agent failed to deliver message';
    const failed = store.failNotification(shopSlug, notificationId, errText);
    if (!failed) {
      res.status(404).json({ error: 'Không tìm thấy thông báo này.' });
      return;
    }
    await pgBridge.updateNotificationStatus({
      notificationId: failed.notificationId,
      deliveryStatus: 'failed',
      retryCount: failed.retryCount,
      lastError: failed.lastError,
    });

    res.json({
      ok: true,
      notification_id: failed.notificationId,
      delivery_status: failed.deliveryStatus,
      retry_count: failed.retryCount,
      last_error: failed.lastError,
    });
  });

  // =========================================================================
  // SHOP ADMIN ROUTES — STRICTLY SCOPED TO ASSIGNED shop_id (F6, F8 + Agent Console)
  // Super Admin is explicitly denied with 403 by requireShopAccess!
  // =========================================================================

  app.get('/api/admin/shops/:shopId/summary', requireAuth, requireShopAccess, (req, res) => {
    const shop = store.getShopById(req.params.shopId);
    if (!shop) {
      res.status(404).json({ error: 'Không tìm thấy gian hàng.' });
      return;
    }
    res.json({ shop });
  });

  app.get('/api/admin/shops/:shopId/products', requireAuth, requireShopAccess, (req, res) => {
    const products = store.getProductsForShop(req.params.shopId, false);
    res.json({ products });
  });

  app.post('/api/admin/shops/:shopId/products', requireAuth, requireShopAccess, async (req, res) => {
    try {
      const { name, code, price, description, colors, sizes, isActive } = req.body ?? {};
      if (typeof name !== 'string' || name.trim().length < 2) {
        res.status(400).json({ error: 'Vui lòng nhập tên sản phẩm.' });
        return;
      }
      const numPrice = Number(price);
      if (!Number.isFinite(numPrice) || numPrice <= 0) {
        res.status(400).json({ error: 'Vui lòng nhập giá bán hợp lệ (> 0).' });
        return;
      }
      if (!Array.isArray(colors) || colors.length === 0) {
        res.status(400).json({ error: 'Vui lòng cấu hình ít nhất 1 màu sắc.' });
        return;
      }
      if (!Array.isArray(sizes) || sizes.length === 0) {
        res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 size.' });
        return;
      }

      const product = store.createProduct(req.params.shopId, {
        name,
        code: typeof code === 'string' && code.trim() ? code : undefined,
        price: numPrice,
        description: typeof description === 'string' ? description : '',
        colors,
        sizes,
        isActive: isActive !== false,
      });
      await pgBridge.upsertProduct(product);
      res.status(201).json({ product });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Không thể tạo sản phẩm.';
      res.status(400).json({ error: message });
    }
  });

  app.patch(
    '/api/admin/shops/:shopId/products/:productId',
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        const product = store.updateProduct(req.params.shopId, req.params.productId, req.body ?? {});
        await pgBridge.upsertProduct(product);
        res.json({ product });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Không thể cập nhật sản phẩm.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/admin/shops/:shopId/products/:productId',
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        store.deleteProduct(req.params.shopId, req.params.productId);
        await pgBridge.deleteProduct(req.params.shopId, req.params.productId);
        res.json({ ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Không thể xóa sản phẩm.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.get('/api/admin/shops/:shopId/orders', requireAuth, requireShopAccess, (req, res) => {
    const orders = store.getOrdersForShop(req.params.shopId);
    res.json({ orders });
  });

  app.patch(
    '/api/admin/shops/:shopId/orders/:orderId',
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        const { status, trackingCode, adminNote } = req.body ?? {};
        if (status !== undefined && !ALLOWED_ORDER_STATUSES.includes(status)) {
          res.status(400).json({ error: 'Trạng thái đơn hàng không hợp lệ.' });
          return;
        }
        const order = store.updateOrderForShop(req.params.shopId, req.params.orderId, {
          status,
          trackingCode: typeof trackingCode === 'string' ? trackingCode : undefined,
          adminNote: typeof adminNote === 'string' ? adminNote : undefined,
        });
        await pgBridge.updateOrderStatus({
          orderId: order.id,
          status: order.status,
          trackingCode: order.trackingCode,
          adminNote: order.adminNote,
          updatedAt: order.updatedAt,
        });
        res.json({ order });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Không thể cập nhật đơn hàng.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.post(
    '/api/admin/shops/:shopId/orders/bulk-status',
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        const { orderIds, status } = req.body ?? {};
        if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.length > 500) {
          res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 đơn hàng để cập nhật.' });
          return;
        }
        const cleanIds = Array.from(
          new Set(
            orderIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          )
        );
        if (cleanIds.length === 0) {
          res.status(400).json({ error: 'Danh sách đơn hàng không hợp lệ.' });
          return;
        }
        if (typeof status !== 'string' || !ALLOWED_ORDER_STATUSES.includes(status as OrderStatus)) {
          res.status(400).json({ error: 'Trạng thái đơn hàng không hợp lệ.' });
          return;
        }

        const nextStatus = status as OrderStatus;
        const updatedOrders = store.bulkUpdateOrdersStatus(
          req.params.shopId,
          cleanIds,
          nextStatus
        );
        const shop = store.getShopById(req.params.shopId);
        if (shop && updatedOrders.length > 0) {
          await pgBridge.bulkUpdateOrderStatus({
            shopSlug: shop.slug,
            orderIds: updatedOrders.map((o) => o.id),
            status: nextStatus,
            updatedAt: updatedOrders[0].updatedAt,
          });
        }

        res.json({
          orders: updatedOrders,
          updatedCount: updatedOrders.length,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Không thể cập nhật hàng loạt đơn hàng.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.get(
    '/api/admin/shops/:shopId/agent-notifications',
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      const shop = store.getShopById(req.params.shopId);
      if (!shop) {
        res.status(404).json({ error: 'Không tìm thấy gian hàng.' });
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
        notifications,
      });
    }
  );

  app.post(
    '/api/admin/shops/:shopId/agent-notifications/:notificationId/retry',
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      const shop = store.getShopById(req.params.shopId);
      if (!shop) {
        res.status(404).json({ error: 'Không tìm thấy gian hàng.' });
        return;
      }
      const notif = store.incrementNotificationRetry(shop.slug, req.params.notificationId);
      if (!notif) {
        res.status(404).json({ error: 'Không tìm thấy thông báo.' });
        return;
      }
      const deliveredCount = agentHub.publishOrderCreated(notif.payload);
      const updated =
        deliveredCount > 0 ? store.markNotificationDelivered(notif.notificationId) ?? notif : notif;

      await pgBridge.updateNotificationStatus({
        notificationId: updated.notificationId,
        deliveryStatus: updated.deliveryStatus,
        retryCount: updated.retryCount,
        deliveredAt: updated.deliveredAt,
      });

      res.json({
        notification: updated,
        deliveredCount,
      });
    }
  );

  app.post(
    '/api/admin/shops/:shopId/agent-notifications/:notificationId/ack',
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      const shop = store.getShopById(req.params.shopId);
      if (!shop) {
        res.status(404).json({ error: 'Không tìm thấy gian hàng.' });
        return;
      }
      const acked = store.ackNotification(shop.slug, req.params.notificationId);
      if (!acked) {
        res.status(404).json({ error: 'Không tìm thấy thông báo.' });
        return;
      }
      await pgBridge.updateNotificationStatus({
        notificationId: acked.notificationId,
        deliveryStatus: 'acked',
        ackedAt: acked.ackedAt,
      });
      res.json({ notification: acked });
    }
  );

  app.post(
    '/api/admin/shops/:shopId/agent-key/rotate',
    requireAuth,
    requireShopAccess,
    async (req, res) => {
      try {
        const agentApiKey = store.rotateShopAgentKey(req.params.shopId);
        const shop = store.getShopById(req.params.shopId);
        if (shop) await pgBridge.upsertShop(shop);
        res.json({ agentApiKey });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Không thể đổi khóa Agent.';
        res.status(400).json({ error: message });
      }
    }
  );

  // =========================================================================
  // SUPER ADMIN ROUTES — MULTI-TENANT MANAGEMENT ONLY (F9)
  // ZERO ORDER OR AGENT NOTIFICATION ACCESS BY DESIGN
  // =========================================================================

  app.get('/api/super-admin/shops', requireAuth, requireSuperAdmin, (_req, res) => {
    res.json({ shops: store.listShopsForSuperAdmin() });
  });

  app.post('/api/super-admin/shops', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, slug, orderPrefix, messengerLink } = req.body ?? {};
      if (typeof name !== 'string' || name.trim().length < 2) {
        res.status(400).json({ error: 'Vui lòng nhập tên gian hàng.' });
        return;
      }
      if (typeof slug !== 'string' || !slug.trim()) {
        res.status(400).json({ error: 'Vui lòng nhập đường dẫn (slug) gian hàng.' });
        return;
      }
      if (typeof orderPrefix !== 'string' || orderPrefix.trim().length < 2) {
        res.status(400).json({ error: 'Vui lòng nhập tiền tố mã đơn (tối thiểu 2 ký tự).' });
        return;
      }
      if (typeof messengerLink !== 'string' || !isValidMessengerUrl(messengerLink)) {
        res.status(400).json({
          error:
            'Link FB / Messenger phải bắt đầu bằng https://m.me/..., https://messenger.com/... hoặc https://facebook.com/...',
        });
        return;
      }

      const shop = store.createShop({ name, slug, orderPrefix, messengerLink });
      const rawShop = store.getShopById(shop.id);
      if (rawShop) await pgBridge.upsertShop(rawShop);
      res.status(201).json({ shop });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Không thể tạo gian hàng.';
      res.status(400).json({ error: message });
    }
  });

  app.patch('/api/super-admin/shops/:shopId', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, orderPrefix, messengerLink, isActive } = req.body ?? {};
      if (messengerLink !== undefined && !isValidMessengerUrl(String(messengerLink))) {
        res.status(400).json({
          error:
            'Link FB / Messenger phải bắt đầu bằng https://m.me/..., https://messenger.com/... hoặc https://facebook.com/...',
        });
        return;
      }
      const shop = store.updateShop(req.params.shopId, {
        name: typeof name === 'string' ? name : undefined,
        orderPrefix: typeof orderPrefix === 'string' ? orderPrefix : undefined,
        messengerLink: typeof messengerLink === 'string' ? messengerLink : undefined,
        isActive: typeof isActive === 'boolean' ? isActive : undefined,
      });
      const rawShop = store.getShopById(shop.id);
      if (rawShop) await pgBridge.upsertShop(rawShop);
      res.json({ shop });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Không thể cập nhật gian hàng.';
      res.status(400).json({ error: message });
    }
  });

  app.post(
    '/api/super-admin/shops/:shopId/agent-key/rotate',
    requireAuth,
    requireSuperAdmin,
    async (req, res) => {
      try {
        const agentApiKey = store.rotateShopAgentKey(req.params.shopId);
        const rawShop = store.getShopById(req.params.shopId);
        if (rawShop) await pgBridge.upsertShop(rawShop);
        res.json({ agentApiKey });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Không thể đổi khóa Agent.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.post('/api/super-admin/shops/:shopId/members', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { email, displayName, password, role } = req.body ?? {};
      if (typeof email !== 'string' || email.trim().length < 3 || /\s/.test(email.trim())) {
        res.status(400).json({
          error: 'Vui lòng nhập tên tài khoản hoặc email hợp lệ (≥ 3 ký tự, không khoảng trắng).',
        });
        return;
      }
      if (typeof password !== 'string' || password.length < 3) {
        res.status(400).json({ error: 'Mật khẩu phải có ít nhất 3 ký tự.' });
        return;
      }
      const cleanRole = role === 'shop_staff' ? 'shop_staff' : 'shop_owner';
      const member = store.addShopMember(req.params.shopId, {
        email,
        displayName: typeof displayName === 'string' ? displayName : '',
        password,
        role: cleanRole,
      });
      const storedUser = store.getAllStoredUsers().find((u) => u.id === member.id);
      if (storedUser) await pgBridge.upsertUser(storedUser);
      res.status(201).json({ member });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Không thể cấp quyền tài khoản.';
      res.status(400).json({ error: message });
    }
  });

  app.patch(
    '/api/super-admin/shops/:shopId/members/:userId/password',
    requireAuth,
    requireSuperAdmin,
    async (req, res) => {
      try {
        const { password } = req.body ?? {};
        if (typeof password !== 'string' || password.length < 3) {
          res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 3 ký tự.' });
          return;
        }
        const updatedUser = store.updateShopMemberPassword(
          req.params.shopId,
          req.params.userId,
          password
        );
        await pgBridge.upsertUser(updatedUser);
        res.json({ ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Không thể đổi mật khẩu tài khoản.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.delete(
    '/api/super-admin/shops/:shopId/members/:userId',
    requireAuth,
    requireSuperAdmin,
    async (req, res) => {
      try {
        store.removeShopMember(req.params.shopId, req.params.userId);
        await pgBridge.deleteUser(req.params.userId);
        res.json({ ok: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Không thể gỡ quyền tài khoản.';
        res.status(400).json({ error: message });
      }
    }
  );

  // Unknown API routes return clean JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API không tồn tại.' });
  });

  // =========================================================================
  // VITE DEV MIDDLEWARE OR PRODUCTION STATIC SPA SERVING
  // =========================================================================

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  if (pgBridge.isConfigured()) {
    const schemaReady = await pgBridge.ensureSchema();
    if (schemaReady) {
      const pgState = await pgBridge.loadFullState();
      if (pgState && (pgState.products.length > 0 || pgState.users.length > 0)) {
        // Ensure reserved "admin" account always operates with Admin hệ thống (super_admin) role
        const adminInPg = pgState.users.find((u) => u.email.trim().toLowerCase() === 'admin');
        if (adminInPg && adminInPg.role !== 'super_admin') {
          adminInPg.role = 'super_admin';
          adminInPg.shopId = null;
          adminInPg.displayName = 'Admin hệ thống';
          await pgBridge.upsertUser(adminInPg);
        }

        // Ensure any locally provisioned accounts not yet present in PostgreSQL are persisted
        const existingEmails = new Set(pgState.users.map((u) => u.email.trim().toLowerCase()));
        const existingShopIds = new Set(pgState.shops.map((s) => s.id));
        const fallbackShopId =
          pgState.shops.find((s) => s.slug === 'mam')?.id ?? pgState.shops[0]?.id ?? null;

        for (const localUser of store.getAllStoredUsers()) {
          const key = localUser.email.trim().toLowerCase();
          if (!existingEmails.has(key)) {
            const resolvedShopId =
              localUser.role === 'super_admin'
                ? null
                : localUser.shopId && existingShopIds.has(localUser.shopId)
                  ? localUser.shopId
                  : fallbackShopId;
            const userToSync = { ...localUser, shopId: resolvedShopId };
            const synced = await pgBridge.upsertUser(userToSync);
            if (synced) {
              pgState.users.push(userToSync);
              existingEmails.add(key);
            }
          }
        }

        store.hydrateFromPostgres(pgState);
        console.log(
          `Hydrated from PostgreSQL (${pgState.shops.length} shops, ${pgState.users.length} users, ${pgState.products.length} products, ${pgState.orders.length} orders).`
        );
      } else {
        // Fresh PostgreSQL database: push initial shops, products, users, and sample orders
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
                notification: notif,
              });
            }
          }
        }
        for (const storedUser of store.getAllStoredUsers()) {
          await pgBridge.upsertUser(storedUser);
        }
        console.log('PostgreSQL schema initialized and initial data synced to Aiven.');
      }
    } else {
      console.warn('PostgreSQL configured but unreachable; falling back to local store.');
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
