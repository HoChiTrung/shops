import type {
  AgentDeliveryStatus,
  AgentNotification,
  AgentOrderPayload,
  AuthUser,
  Order,
  OrderStatus,
  Product,
  ProductColorOption,
  PublicShopResponse,
  Shop,
  ShopMemberSummary,
  SuperAdminShopSummary,
} from '../shared/types.ts';

// Keep auth token strictly in JS memory (never localStorage or sessionStorage)
let memoryAccessToken: string | null = null;

export function setAccessToken(token: string | null) {
  memoryAccessToken = token;
}

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

// Optional separate Backend API base URL (e.g. Render) when Frontend is hosted on GitHub Pages
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function resolveApiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryAccessToken) {
    headers.set('Authorization', `Bearer ${memoryAccessToken}`);
  }

  const response = await fetch(resolveApiUrl(url), {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof data?.error === 'string'
        ? data.error
        : `Yêu cầu thất bại (mã ${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  // Auth
  getAuthStatus: () =>
    request<{ needsBootstrap: boolean; hasShopAdmin: boolean; hasSuperAdmin: boolean }>(
      '/api/auth/status'
    ),
  bootstrapAuth: (payload: {
    superAdminEmail: string;
    superAdminPassword: string;
    shopOwnerEmail?: string;
    shopOwnerPassword?: string;
    loginAs: 'shop_owner' | 'super_admin';
  }) =>
    request<{ token: string; user: AuthUser }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  getMe: () => request<{ user: AuthUser }>('/api/auth/me'),

  // Public Storefront
  getPublicShop: (slug: string) =>
    request<PublicShopResponse>(`/api/shops/${encodeURIComponent(slug)}`),
  placeOrder: (
    slug: string,
    payload: {
      customerName: string;
      customerPhone: string;
      customerAddress: string;
      customerNote: string;
      items: Array<{ variantId: string; quantity: number }>;
      origin: string;
    }
  ) =>
    request<{
      order: Order;
      notification_id: string;
      delivery_status: AgentDeliveryStatus;
      agent_payload: AgentOrderPayload;
      messengerLink: string;
    }>(`/api/shops/${encodeURIComponent(slug)}/orders`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Shop Admin (strictly scoped by shopId)
  getShopSummary: (shopId: string) =>
    request<{ shop: Shop }>(`/api/admin/shops/${encodeURIComponent(shopId)}/summary`),
  getShopProducts: (shopId: string) =>
    request<{ products: Product[] }>(`/api/admin/shops/${encodeURIComponent(shopId)}/products`),
  createProduct: (
    shopId: string,
    payload: {
      name: string;
      code?: string;
      price: number;
      description: string;
      colors: ProductColorOption[];
      sizes: string[];
      isActive: boolean;
    }
  ) =>
    request<{ product: Product }>(`/api/admin/shops/${encodeURIComponent(shopId)}/products`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProduct: (
    shopId: string,
    productId: string,
    payload: Partial<{
      name: string;
      code: string;
      price: number;
      description: string;
      colors: ProductColorOption[];
      sizes: string[];
      isActive: boolean;
    }>
  ) =>
    request<{ product: Product }>(
      `/api/admin/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),
  deleteProduct: (shopId: string, productId: string) =>
    request<{ ok: boolean }>(
      `/api/admin/shops/${encodeURIComponent(shopId)}/products/${encodeURIComponent(productId)}`,
      { method: 'DELETE' }
    ),
  getShopOrders: (shopId: string) =>
    request<{ orders: Order[] }>(`/api/admin/shops/${encodeURIComponent(shopId)}/orders`),
  updateOrder: (
    shopId: string,
    orderId: string,
    payload: {
      status?: OrderStatus;
      adminNote?: string;
    }
  ) =>
    request<{ order: Order }>(
      `/api/admin/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),
  bulkUpdateOrderStatus: (
    shopId: string,
    payload: {
      orderIds: string[];
      status: OrderStatus;
    }
  ) =>
    request<{ orders: Order[]; updatedCount: number }>(
      `/api/admin/shops/${encodeURIComponent(shopId)}/orders/bulk-status`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  getShopAgentNotifications: (shopId: string) =>
    request<{
      shopSlug: string;
      agentApiKey: string;
      connections: { sse: number; ws: number; total: number };
      dbMode: 'postgresql' | 'local_store';
      notifications: AgentNotification[];
    }>(`/api/admin/shops/${encodeURIComponent(shopId)}/agent-notifications`),
  retryShopAgentNotification: (shopId: string, notificationId: string) =>
    request<{ notification: AgentNotification; deliveredCount: number }>(
      `/api/admin/shops/${encodeURIComponent(shopId)}/agent-notifications/${encodeURIComponent(notificationId)}/retry`,
      { method: 'POST' }
    ),
  ackShopAgentNotification: (shopId: string, notificationId: string) =>
    request<{ notification: AgentNotification }>(
      `/api/admin/shops/${encodeURIComponent(shopId)}/agent-notifications/${encodeURIComponent(notificationId)}/ack`,
      { method: 'POST' }
    ),
  rotateShopAgentKey: (shopId: string) =>
    request<{ agentApiKey: string }>(
      `/api/admin/shops/${encodeURIComponent(shopId)}/agent-key/rotate`,
      { method: 'POST' }
    ),

  // Super Admin (multi-tenant management only — zero order endpoints)
  listSuperAdminShops: () => request<{ shops: SuperAdminShopSummary[] }>('/api/super-admin/shops'),
  createShop: (payload: {
    name: string;
    slug: string;
    orderPrefix: string;
    messengerLink: string;
  }) =>
    request<{ shop: SuperAdminShopSummary }>('/api/super-admin/shops', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateShop: (
    shopId: string,
    payload: Partial<{
      name: string;
      orderPrefix: string;
      messengerLink: string;
      isActive: boolean;
    }>
  ) =>
    request<{ shop: SuperAdminShopSummary }>(
      `/api/super-admin/shops/${encodeURIComponent(shopId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    ),
  addShopMember: (
    shopId: string,
    payload: {
      email: string;
      displayName: string;
      password: string;
      role: 'shop_owner' | 'shop_staff';
    }
  ) =>
    request<{ member: ShopMemberSummary }>(
      `/api/super-admin/shops/${encodeURIComponent(shopId)}/members`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  updateShopMemberPassword: (shopId: string, userId: string, password: string) =>
    request<{ ok: boolean }>(
      `/api/super-admin/shops/${encodeURIComponent(shopId)}/members/${encodeURIComponent(userId)}/password`,
      {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      }
    ),
  rotateSuperAdminShopAgentKey: (shopId: string) =>
    request<{ agentApiKey: string }>(
      `/api/super-admin/shops/${encodeURIComponent(shopId)}/agent-key/rotate`,
      { method: 'POST' }
    ),
  removeShopMember: (shopId: string, userId: string) =>
    request<{ ok: boolean }>(
      `/api/super-admin/shops/${encodeURIComponent(shopId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    ),
};
