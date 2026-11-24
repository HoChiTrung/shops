export type UserRole = 'super_admin' | 'shop_owner' | 'shop_staff';

export type OrderStatus = 'new' | 'completed';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Chưa xử lý',
  completed: 'Đã xử lý',
};

export function normalizeOrderStatus(status: string): OrderStatus {
  return status === 'completed' ? 'completed' : 'new';
}

export type AgentDeliveryStatus = 'pending' | 'delivered' | 'acked' | 'failed';

export interface AgentOrderPayload {
  event: 'order.created';
  notification_id: string;
  order_code: string;
  shop_slug: string;
  customer_name: string;
  phone_or_contact: string;
  items_summary: string;
  total_amount: number;
  message_text: string;
  messenger_link?: string;
  created_at: string;
}

export interface AgentNotification {
  id: string;
  notificationId: string;
  orderId: string;
  shopSlug: string;
  payload: AgentOrderPayload;
  deliveryStatus: AgentDeliveryStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  ackedAt: string | null;
}

export interface Shop {
  id: string;
  name: string;
  slug: string;
  orderPrefix: string;
  orderSeq: number;
  messengerLink: string;
  agentApiKey?: string;
  isActive: boolean;
  createdAt: string;
}

export interface ProductColorOption {
  name: string;
  code: string;
  hex: string;
}

export interface ProductVariant {
  id: string;
  shopId: string;
  productId: string;
  colorName: string;
  colorCode: string;
  colorHex: string;
  size: string;
  sku: string;
  isActive: boolean;
}

export interface Product {
  id: string;
  shopId: string;
  name: string;
  code: string;
  price: number;
  description: string;
  colors: ProductColorOption[];
  sizes: string[];
  isActive: boolean;
  createdAt: string;
  variants: ProductVariant[];
}

export interface OrderItem {
  id: string;
  shopId: string;
  orderId: string;
  productId: string;
  variantId: string;
  productName: string;
  colorName: string;
  colorHex: string;
  size: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  shopId: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNote: string;
  status: OrderStatus;
  trackingCode: string;
  adminNote: string;
  totalAmount: number;
  messengerText: string;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  variantId: string;
  productId: string;
  productName: string;
  colorName: string;
  colorHex: string;
  size: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

export interface PublicShopResponse {
  shop: {
    id: string;
    name: string;
    slug: string;
    orderPrefix: string;
    messengerLink: string;
    isActive: boolean;
  };
  products: Product[];
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  shopId: string | null;
  shopName?: string | null;
  shopSlug?: string | null;
}

export interface ShopMemberSummary {
  id: string;
  email: string;
  displayName: string;
  role: 'shop_owner' | 'shop_staff';
  shopId: string;
  createdAt: string;
}

export interface SuperAdminShopSummary extends Shop {
  productCount: number;
  members: ShopMemberSummary[];
}

/**
 * Remove Vietnamese diacritics and normalize a string into an uppercase SKU token.
 * Example: "Xanh dương" -> "XANHDUONG", "Áo thun" -> "AOTHUN"
 */
export function normalizeSkuToken(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 16);
}

/**
 * Build standardized SKU: PRODUCTCODE-COLORCODE-SIZE (e.g. AO-XANH-S)
 */
export function buildSku(productCode: string, colorCode: string, size: string): string {
  const p = normalizeSkuToken(productCode) || 'SP';
  const c = normalizeSkuToken(colorCode) || 'MAU';
  const s = normalizeSkuToken(size) || 'FS';
  return `${p}-${c}-${s}`;
}

/**
 * Normalize Vietnamese phone number for consistent validation & lookup.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[\s.\-()]/g, '');
  if (digits.startsWith('+84')) {
    return '0' + digits.slice(3);
  }
  if (digits.startsWith('84') && digits.length === 11) {
    return '0' + digits.slice(2);
  }
  return digits;
}

export function isValidVietnamPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^0[35789][0-9]{8}$/.test(normalized);
}

export function isValidMessengerUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'm.me' ||
      host === 'messenger.com' ||
      host === 'www.messenger.com' ||
      host === 'facebook.com' ||
      host === 'www.facebook.com' ||
      host === 'fb.com' ||
      host === 'www.fb.com'
    );
  } catch {
    return false;
  }
}

export function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')}đ`;
}

export function formatOrderMessengerText(params: {
  shopName: string;
  orderCode: string;
  items: Array<{
    sku?: string;
    productName: string;
    colorName: string;
    size: string;
    quantity: number;
    lineTotal: number;
  }>;
  totalAmount: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerNote: string;
}): string {
  const itemLines = params.items.map(
    (item, index) =>
      `${index + 1}. ${item.productName} (${item.colorName} / Size ${item.size}) x${item.quantity} = ${formatVnd(item.lineTotal)}`
  );

  const lines = [
    `ĐƠN HÀNG MỚI #${params.orderCode} — ${params.shopName}`,
    '--------------------',
    'Sản phẩm:',
    ...itemLines,
    '--------------------',
    `Tổng cộng: ${formatVnd(params.totalAmount)}`,
    `Khách hàng: ${params.customerName}`,
    `SĐT: ${params.customerPhone}`,
    `Địa chỉ: ${params.customerAddress}`,
  ];

  if (params.customerNote.trim()) {
    lines.push(`Ghi chú: ${params.customerNote.trim()}`);
  }

  return lines.join('\n');
}
