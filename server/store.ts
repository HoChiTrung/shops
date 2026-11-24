import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildSku,
  formatOrderMessengerText,
  normalizePhone,
  normalizeSkuToken,
  type AgentNotification,
  type AgentOrderPayload,
  type AuthUser,
  type Order,
  type OrderItem,
  type OrderStatus,
  type Product,
  type ProductColorOption,
  type ProductVariant,
  type Shop,
  type ShopMemberSummary,
  type SuperAdminShopSummary,
  type UserRole,
} from '../src/shared/types.ts';
import { hashPassword, verifyPassword } from './auth.ts';
import { buildItemsSummary } from './pg-bridge.ts';

export interface StoredUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  shopId: string | null;
  createdAt: string;
}

interface DatabaseSchema {
  shops: Shop[];
  users: StoredUser[];
  products: Omit<Product, 'variants'>[];
  variants: ProductVariant[];
  orders: Omit<Order, 'items'>[];
  orderItems: OrderItem[];
  agentNotifications: AgentNotification[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function genAgentApiKey(): string {
  return `agk_${crypto.randomBytes(24).toString('hex')}`;
}

function buildVariantsForProduct(
  shopId: string,
  productId: string,
  productCode: string,
  colors: ProductColorOption[],
  sizes: string[]
): ProductVariant[] {
  const variants: ProductVariant[] = [];
  const seenSkus = new Set<string>();
  for (const color of colors) {
    for (const size of sizes) {
      const sku = buildSku(productCode, color.code || color.name, size);
      if (seenSkus.has(sku)) continue;
      seenSkus.add(sku);
      variants.push({
        id: genId('var'),
        shopId,
        productId,
        colorName: color.name.trim(),
        colorCode: normalizeSkuToken(color.code || color.name) || 'MAU',
        colorHex: color.hex,
        size: size.trim().toUpperCase(),
        sku,
        isActive: true,
      });
    }
  }
  return variants;
}

function createInitialSeedData(): DatabaseSchema {
  const now = new Date().toISOString();
  const mamShopId = 'shop_mam_tuithic';

  const mamShop: Shop = {
    id: mamShopId,
    name: 'tuithic studio',
    slug: 'mam',
    orderPrefix: 'MM',
    orderSeq: 2,
    messengerLink: 'https://m.me/tuithicstudio',
    agentApiKey: genAgentApiKey(),
    isActive: true,
    createdAt: now,
  };

  const productDefs: Array<{
    id: string;
    name: string;
    code: string;
    price: number;
    description: string;
    colors: ProductColorOption[];
    sizes: string[];
  }> = [
    {
      id: 'prod_ao_boxy',
      name: 'Áo thun Basic Boxy 250gsm',
      code: 'AO',
      price: 249000,
      description: 'Cotton 2 chiều dày dặn 250gsm, form boxy đứng dáng, mặc mát hằng ngày.',
      colors: [
        { name: 'Trắng kem', code: 'KEM', hex: '#F3EFE6' },
        { name: 'Đen than', code: 'DEN', hex: '#1F2937' },
        { name: 'Xanh cobalt', code: 'XANH', hex: '#2563EB' },
        { name: 'Xám tiêu', code: 'XAM', hex: '#9CA3AF' },
      ],
      sizes: ['S', 'M', 'L', 'XL'],
    },
    {
      id: 'prod_os_tron',
      name: 'Áo thun Oversize Cổ Tròn',
      code: 'OS',
      price: 279000,
      description: 'Form rộng vai trễ thoải mái, bo cổ dày chống giãn sau nhiều lần giặt.',
      colors: [
        { name: 'Đen tuyền', code: 'DEN', hex: '#111827' },
        { name: 'Trắng tinh', code: 'TRANG', hex: '#F9FAFB' },
        { name: 'Xanh rêu', code: 'REU', hex: '#3F6212' },
        { name: 'Nâu đất', code: 'NAU', hex: '#78350F' },
      ],
      sizes: ['S', 'M', 'L', 'XL'],
    },
    {
      id: 'prod_rg_raglan',
      name: 'Áo thun Raglan Tay Lỡ',
      code: 'RG',
      price: 295000,
      description: 'Thiết kế phối tay raglan trẻ trung, vải cotton mềm mịn thấm hút mồ hôi.',
      colors: [
        { name: 'Xanh navy', code: 'NAVY', hex: '#1E3A8A' },
        { name: 'Đỏ đô', code: 'DO', hex: '#991B1B' },
        { name: 'Be cát', code: 'BE', hex: '#D6C7B2' },
        { name: 'Xám khói', code: 'KHOI', hex: '#6B7280' },
      ],
      sizes: ['S', 'M', 'L', 'XL'],
    },
    {
      id: 'prod_bt_babytee',
      name: 'Áo thun Baby Tee Nữ',
      code: 'BT',
      price: 225000,
      description: 'Form ôm nhẹ tôn dáng, chất cotton co giãn 4 chiều thoáng mát.',
      colors: [
        { name: 'Trắng sữa', code: 'SUA', hex: '#FDFBF7' },
        { name: 'Hồng phấn', code: 'HONG', hex: '#F472B6' },
        { name: 'Xanh biển', code: 'BIEN', hex: '#60A5FA' },
        { name: 'Đen', code: 'DEN', hex: '#18181B' },
      ],
      sizes: ['S', 'M', 'L'],
    },
  ];

  const products: Omit<Product, 'variants'>[] = [];
  const variants: ProductVariant[] = [];

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
      createdAt: now,
    });
    variants.push(...buildVariantsForProduct(mamShopId, def.id, def.code, def.colors, def.sizes));
  }

  // Seed 2 realistic sample orders for /mam so lookup (F7) & admin order management (F8) work immediately
  const vAoXanhS = variants.find((v) => v.sku === 'AO-XANH-S') ?? variants[0];
  const vOsReuM = variants.find((v) => v.sku === 'OS-REU-M') ?? variants[1];

  const order1Id = 'ord_seed_mm0001';
  const order1Items: OrderItem[] = [
    {
      id: 'oi_seed_1',
      shopId: mamShopId,
      orderId: order1Id,
      productId: vAoXanhS.productId,
      variantId: vAoXanhS.id,
      productName: 'Áo thun Basic Boxy 250gsm',
      colorName: vAoXanhS.colorName,
      colorHex: vAoXanhS.colorHex,
      size: vAoXanhS.size,
      sku: vAoXanhS.sku,
      quantity: 2,
      unitPrice: 249000,
      lineTotal: 498000,
    },
  ];

  const order1Text = formatOrderMessengerText({
    shopName: mamShop.name,
    orderCode: 'MM0001',
    items: order1Items,
    totalAmount: 498000,
    customerName: 'Nguyễn Minh Anh',
    customerPhone: '0901234567',
    customerAddress: '45 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
    customerNote: 'Giao giờ hành chính giúp mình',
  });

  const order2Id = 'ord_seed_mm0002';
  const order2Items: OrderItem[] = [
    {
      id: 'oi_seed_2',
      shopId: mamShopId,
      orderId: order2Id,
      productId: vOsReuM.productId,
      variantId: vOsReuM.id,
      productName: 'Áo thun Oversize Cổ Tròn',
      colorName: vOsReuM.colorName,
      colorHex: vOsReuM.colorHex,
      size: vOsReuM.size,
      sku: vOsReuM.sku,
      quantity: 1,
      unitPrice: 279000,
      lineTotal: 279000,
    },
  ];

  const order2Text = formatOrderMessengerText({
    shopName: mamShop.name,
    orderCode: 'MM0002',
    items: order2Items,
    totalAmount: 279000,
    customerName: 'Trần Quốc Bảo',
    customerPhone: '0912345678',
    customerAddress: '120 Cầu Giấy, Hà Nội',
    customerNote: '',
  });

  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  return {
    shops: [mamShop],
    users: [],
    products,
    variants,
    orders: [
      {
        id: order1Id,
        shopId: mamShopId,
        orderCode: 'MM0001',
        customerName: 'Nguyễn Minh Anh',
        customerPhone: '0901234567',
        customerAddress: '45 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
        customerNote: 'Giao giờ hành chính giúp mình',
        status: 'new',
        trackingCode: '',
        adminNote: '',
        totalAmount: 498000,
        messengerText: order1Text,
        createdAt: oneHourAgo,
        updatedAt: oneHourAgo,
      },
      {
        id: order2Id,
        shopId: mamShopId,
        orderCode: 'MM0002',
        customerName: 'Trần Quốc Bảo',
        customerPhone: '0912345678',
        customerAddress: '120 Cầu Giấy, Hà Nội',
        customerNote: '',
        status: 'shipping',
        trackingCode: 'GHTK849201',
        adminNote: 'Đã gửi bưu cục buổi sáng',
        totalAmount: 279000,
        messengerText: order2Text,
        createdAt: oneDayAgo,
        updatedAt: oneHourAgo,
      },
    ],
    orderItems: [...order1Items, ...order2Items],
    agentNotifications: [
      {
        id: 'an_seed_1',
        notificationId: 'notif_seed_mm0001',
        orderId: order1Id,
        shopSlug: 'mam',
        payload: {
          event: 'order.created',
          notification_id: 'notif_seed_mm0001',
          order_code: 'MM0001',
          shop_slug: 'mam',
          customer_name: 'Nguyễn Minh Anh',
          phone_or_contact: '0901234567',
          items_summary: buildItemsSummary(order1Items),
          total_amount: 498000,
          message_text: order1Text,
          created_at: oneHourAgo,
        },
        deliveryStatus: 'pending',
        retryCount: 0,
        lastError: null,
        createdAt: oneHourAgo,
        deliveredAt: null,
        ackedAt: null,
      },
      {
        id: 'an_seed_2',
        notificationId: 'notif_seed_mm0002',
        orderId: order2Id,
        shopSlug: 'mam',
        payload: {
          event: 'order.created',
          notification_id: 'notif_seed_mm0002',
          order_code: 'MM0002',
          shop_slug: 'mam',
          customer_name: 'Trần Quốc Bảo',
          phone_or_contact: '0912345678',
          items_summary: buildItemsSummary(order2Items),
          total_amount: 279000,
          message_text: order2Text,
          created_at: oneDayAgo,
        },
        deliveryStatus: 'acked',
        retryCount: 0,
        lastError: null,
        createdAt: oneDayAgo,
        deliveredAt: oneDayAgo,
        ackedAt: oneHourAgo,
      },
    ],
  };
}

class MultiTenantStore {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.load();
  }

  private load(): DatabaseSchema {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
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
          const hydrated = parsed as DatabaseSchema;
          if (dirty) {
            this.saveData(hydrated);
          }
          return hydrated;
        }
      }
    } catch (error) {
      console.error('Failed to read existing data file, reinitializing:', error);
    }
    const seed = createInitialSeedData();
    this.saveData(seed);
    return seed;
  }

  private saveData(data: DatabaseSchema) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpPath = `${DATA_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, DATA_FILE);
  }

  private persist() {
    this.saveData(this.data);
  }

  // ---- Auth & Bootstrap ----

  private hasEnvSuperAdmin(): boolean {
    return Boolean(process.env.SUPER_ADMIN_PASSWORD && process.env.SUPER_ADMIN_PASSWORD.trim().length >= 6);
  }

  private getEnvSuperAdminEmail(): string {
    return (process.env.SUPER_ADMIN_EMAIL || 'superadmin@tuithic.studio').trim().toLowerCase();
  }

  hasSuperAdmin(): boolean {
    return this.hasEnvSuperAdmin() || this.data.users.some((u) => u.role === 'super_admin');
  }

  hasShopAdmin(): boolean {
    return this.data.users.some((u) => u.role === 'shop_owner' || u.role === 'shop_staff');
  }

  needsBootstrap(): boolean {
    return !this.hasSuperAdmin();
  }

  getAllStoredUsers(): StoredUser[] {
    return [...this.data.users];
  }

  getAllShops(): Shop[] {
    return [...this.data.shops];
  }

  getAllAgentNotifications(): AgentNotification[] {
    return [...this.data.agentNotifications];
  }

  hydrateFromPostgres(pgState: {
    shops: Shop[];
    users: StoredUser[];
    products: Omit<Product, 'variants'>[];
    variants: ProductVariant[];
    orders: Omit<Order, 'items'>[];
    orderItems: OrderItem[];
    agentNotifications: AgentNotification[];
  }): void {
    this.data = {
      shops: pgState.shops,
      users: pgState.users,
      products: pgState.products,
      variants: pgState.variants,
      orders: pgState.orders,
      orderItems: pgState.orderItems,
      agentNotifications: pgState.agentNotifications,
    };
    this.persist();
  }

  bootstrapSuperAdminOnly(params: {
    superAdminEmail: string;
    superAdminPassword: string;
  }): AuthUser {
    if (this.hasSuperAdmin()) {
      throw new Error('Tài khoản Admin hệ thống đã được thiết lập từ trước.');
    }
    const saEmail = params.superAdminEmail.trim().toLowerCase();
    if (this.data.users.some((u) => u.email === saEmail)) {
      throw new Error(`Tài khoản "${saEmail}" đã tồn tại trên hệ thống.`);
    }
    const now = new Date().toISOString();
    const superAdminRecord: StoredUser = {
      id: genId('usr'),
      email: saEmail,
      displayName: 'Admin hệ thống',
      passwordHash: hashPassword(params.superAdminPassword),
      role: 'super_admin',
      shopId: null,
      createdAt: now,
    };
    this.data.users.push(superAdminRecord);
    this.persist();
    return this.toAuthUser(superAdminRecord);
  }

  bootstrapInitialAccounts(params: {
    superAdminEmail: string;
    superAdminPassword: string;
    shopOwnerEmail: string;
    shopOwnerPassword: string;
  }): { superAdmin: AuthUser; shopOwner: AuthUser } {
    if (this.hasSuperAdmin()) {
      throw new Error('Hệ thống đã được thiết lập quản trị viên từ trước.');
    }

    const saEmail = params.superAdminEmail.trim().toLowerCase();
    const ownerEmail = params.shopOwnerEmail.trim().toLowerCase();

    if (saEmail === ownerEmail) {
      throw new Error(
        'Tài khoản Admin hệ thống và tài khoản Chủ shop cần khác nhau để tách biệt phân quyền.'
      );
    }

    const mamShop = this.data.shops.find((s) => s.slug === 'mam') ?? this.data.shops[0];
    if (!mamShop) {
      throw new Error('Không tìm thấy gian hàng thí điểm.');
    }

    const now = new Date().toISOString();
    const superAdminRecord: StoredUser = {
      id: genId('usr'),
      email: saEmail,
      displayName: 'Admin hệ thống',
      passwordHash: hashPassword(params.superAdminPassword),
      role: 'super_admin',
      shopId: null,
      createdAt: now,
    };

    const shopOwnerRecord: StoredUser = {
      id: genId('usr'),
      email: ownerEmail,
      displayName: 'Chủ shop (tuithic studio)',
      passwordHash: hashPassword(params.shopOwnerPassword),
      role: 'shop_owner',
      shopId: mamShop.id,
      createdAt: now,
    };

    this.data.users.push(superAdminRecord, shopOwnerRecord);
    this.persist();

    return {
      superAdmin: this.toAuthUser(superAdminRecord),
      shopOwner: this.toAuthUser(shopOwnerRecord),
    };
  }

  authenticateUser(emailInput: string, password: string): AuthUser | null {
    const email = emailInput.trim().toLowerCase();

    // Configured process.env SUPER_ADMIN_PASSWORD always overrides any claimed fallback hash
    if (this.hasEnvSuperAdmin() && email === this.getEnvSuperAdminEmail()) {
      const envPassword = process.env.SUPER_ADMIN_PASSWORD!.trim();
      const inputBuf = Buffer.from(password);
      const envBuf = Buffer.from(envPassword);
      if (inputBuf.length === envBuf.length && crypto.timingSafeEqual(inputBuf, envBuf)) {
        return {
          id: 'env_super_admin',
          email,
          displayName: 'Chủ hệ thống (Super Admin)',
          role: 'super_admin',
          shopId: null,
          shopName: null,
          shopSlug: null,
        };
      }
      return null;
    }

    const user = this.data.users.find((u) => u.email === email);
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return this.toAuthUser(user);
  }

  getUserById(userId: string): AuthUser | null {
    if (userId === 'env_super_admin' && this.hasEnvSuperAdmin()) {
      return {
        id: 'env_super_admin',
        email: this.getEnvSuperAdminEmail(),
        displayName: 'Chủ hệ thống (Super Admin)',
        role: 'super_admin',
        shopId: null,
        shopName: null,
        shopSlug: null,
      };
    }
    const found = this.data.users.find((u) => u.id === userId);
    return found ? this.toAuthUser(found) : null;
  }

  private toAuthUser(user: StoredUser): AuthUser {
    const shop = user.shopId ? this.data.shops.find((s) => s.id === user.shopId) : null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      shopId: user.shopId,
      shopName: shop?.name ?? null,
      shopSlug: shop?.slug ?? null,
    };
  }

  // ---- Public Storefront ----

  getShopBySlug(slug: string): Shop | null {
    const clean = slug.trim().toLowerCase();
    return this.data.shops.find((s) => s.slug === clean) ?? null;
  }

  getShopById(shopId: string): Shop | null {
    return this.data.shops.find((s) => s.id === shopId) ?? null;
  }

  getProductsForShop(shopId: string, onlyActive: boolean): Product[] {
    const products = this.data.products.filter(
      (p) => p.shopId === shopId && (!onlyActive || p.isActive)
    );
    return products.map((p) => ({
      ...p,
      variants: this.data.variants.filter(
        (v) => v.shopId === shopId && v.productId === p.id && (!onlyActive || v.isActive)
      ),
    }));
  }

  createOrderForShop(params: {
    slug: string;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    customerNote: string;
    items: Array<{
      variantId?: string;
      sku?: string;
      productName?: string;
      colorName?: string;
      size?: string;
      unitPrice?: number;
      quantity: number;
    }>;
    lookupUrl?: string;
  }): { order: Order; notification: AgentNotification } {
    const shop = this.getShopBySlug(params.slug);
    if (!shop) {
      throw new Error('Không tìm thấy gian hàng.');
    }
    if (!shop.isActive) {
      throw new Error('Gian hàng hiện đang tạm đóng, chưa nhận đơn mới.');
    }
    if (!params.items.length) {
      throw new Error('Giỏ hàng trống.');
    }

    const now = new Date().toISOString();
    const orderId = genId('ord');
    const resolvedItems: OrderItem[] = [];
    let totalAmount = 0;

    for (const reqItem of params.items) {
      const qty = Math.floor(Number(reqItem.quantity));
      if (!Number.isFinite(qty) || qty < 1 || qty > 99) {
        throw new Error('Số lượng sản phẩm không hợp lệ.');
      }

      // Resolve by variantId or SKU against catalog first (server-authoritative pricing)
      const matchedVariant = reqItem.variantId
        ? this.data.variants.find(
            (v) => v.id === reqItem.variantId && v.shopId === shop.id && v.isActive
          )
        : reqItem.sku
          ? this.data.variants.find(
              (v) =>
                v.shopId === shop.id &&
                v.isActive &&
                v.sku.toUpperCase() === reqItem.sku!.trim().toUpperCase()
            )
          : undefined;

      if (matchedVariant) {
        const product = this.data.products.find(
          (p) => p.id === matchedVariant.productId && p.shopId === shop.id && p.isActive
        );
        if (!product) {
          throw new Error('Một sản phẩm trong giỏ hiện đang ẩn.');
        }

        const lineTotal = product.price * qty;
        totalAmount += lineTotal;
        resolvedItems.push({
          id: genId('oi'),
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
          lineTotal,
        });
      } else if (
        !reqItem.variantId &&
        typeof reqItem.sku === 'string' &&
        reqItem.sku.trim().length > 0 &&
        typeof reqItem.unitPrice === 'number' &&
        Number.isFinite(reqItem.unitPrice) &&
        reqItem.unitPrice > 0
      ) {
        // Direct API order creation with custom SKU item
        const unitPrice = Math.round(reqItem.unitPrice);
        const lineTotal = unitPrice * qty;
        totalAmount += lineTotal;
        resolvedItems.push({
          id: genId('oi'),
          shopId: shop.id,
          orderId,
          productId: 'custom',
          variantId: 'custom',
          productName: (reqItem.productName || reqItem.sku).trim(),
          colorName: (reqItem.colorName || 'Mặc định').trim(),
          colorHex: '#18181B',
          size: (reqItem.size || 'FS').trim().toUpperCase(),
          sku: reqItem.sku.trim().toUpperCase(),
          quantity: qty,
          unitPrice,
          lineTotal,
        });
      } else {
        throw new Error('Một sản phẩm trong giỏ đã ngừng bán hoặc không tồn tại.');
      }
    }

    // Increment per-shop atomic sequence
    shop.orderSeq += 1;
    const padded = String(shop.orderSeq).padStart(4, '0');
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
      customerNote: params.customerNote.trim(),
    });

    const orderRecord: Omit<Order, 'items'> = {
      id: orderId,
      shopId: shop.id,
      orderCode,
      customerName: params.customerName.trim(),
      customerPhone: normalizedPhone,
      customerAddress: params.customerAddress.trim(),
      customerNote: params.customerNote.trim(),
      status: 'new',
      trackingCode: '',
      adminNote: '',
      totalAmount,
      messengerText,
      createdAt: now,
      updatedAt: now,
    };

    const notificationId = `notif_${crypto.randomBytes(8).toString('hex')}`;
    const payload: AgentOrderPayload = {
      event: 'order.created',
      notification_id: notificationId,
      order_code: orderCode,
      shop_slug: shop.slug,
      customer_name: orderRecord.customerName,
      phone_or_contact: normalizedPhone,
      items_summary: buildItemsSummary(resolvedItems),
      total_amount: totalAmount,
      message_text: messengerText,
      messenger_link: shop.messengerLink,
      created_at: now,
    };

    const notification: AgentNotification = {
      id: genId('an'),
      notificationId,
      orderId,
      shopSlug: shop.slug,
      payload,
      deliveryStatus: 'pending',
      retryCount: 0,
      lastError: null,
      createdAt: now,
      deliveredAt: null,
      ackedAt: null,
    };

    this.data.orders.unshift(orderRecord);
    this.data.orderItems.push(...resolvedItems);
    this.data.agentNotifications.unshift(notification);
    this.persist();

    return {
      order: {
        ...orderRecord,
        items: resolvedItems,
      },
      notification,
    };
  }

  lookupOrder(slug: string, orderCode: string, phone: string): Order | null {
    const shop = this.getShopBySlug(slug);
    if (!shop) return null;
    const cleanCode = orderCode.trim().toUpperCase();
    const cleanPhone = normalizePhone(phone);
    if (!cleanCode || !cleanPhone) return null;

    const order = this.data.orders.find(
      (o) =>
        o.shopId === shop.id &&
        o.orderCode.toUpperCase() === cleanCode &&
        normalizePhone(o.customerPhone) === cleanPhone
    );
    if (!order) return null;

    const items = this.data.orderItems.filter(
      (i) => i.shopId === shop.id && i.orderId === order.id
    );
    return {
      ...order,
      items,
    };
  }

  // ---- Shop Admin (strictly scoped by shopId) ----

  createProduct(
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
  ): Product {
    const baseToken =
      normalizeSkuToken(payload.code || '') ||
      normalizeSkuToken(payload.name).slice(0, 6) ||
      'SP';
    let cleanCode = baseToken;
    let suffix = 2;
    while (this.data.products.some((p) => p.shopId === shopId && p.code === cleanCode)) {
      cleanCode = `${baseToken}${suffix}`;
      suffix += 1;
    }

    const productId = genId('prod');
    const cleanColors = payload.colors.map((c) => ({
      name: c.name.trim(),
      code: normalizeSkuToken(c.code || c.name) || 'MAU',
      hex: /^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : '#18181B',
    }));
    const cleanSizes = Array.from(
      new Set(payload.sizes.map((s) => s.trim().toUpperCase()).filter(Boolean))
    );

    const record: Omit<Product, 'variants'> = {
      id: productId,
      shopId,
      name: payload.name.trim(),
      code: cleanCode,
      price: Math.max(0, Math.round(payload.price)),
      description: payload.description.trim(),
      colors: cleanColors,
      sizes: cleanSizes,
      isActive: payload.isActive,
      createdAt: new Date().toISOString(),
    };

    const variants = buildVariantsForProduct(shopId, productId, cleanCode, cleanColors, cleanSizes);
    this.data.products.unshift(record);
    this.data.variants.push(...variants);
    this.persist();

    return { ...record, variants };
  }

  updateProduct(
    shopId: string,
    productId: string,
    payload: {
      name?: string;
      code?: string;
      price?: number;
      description?: string;
      colors?: ProductColorOption[];
      sizes?: string[];
      isActive?: boolean;
    }
  ): Product {
    const product = this.data.products.find((p) => p.id === productId && p.shopId === shopId);
    if (!product) {
      throw new Error('Không tìm thấy sản phẩm trong gian hàng của bạn.');
    }

    if (payload.name !== undefined) product.name = payload.name.trim();
    if (payload.description !== undefined) product.description = payload.description.trim();
    if (payload.price !== undefined) product.price = Math.max(0, Math.round(payload.price));
    if (payload.isActive !== undefined) product.isActive = Boolean(payload.isActive);

    let needRebuildVariants = false;

    if (payload.code !== undefined) {
      const cleanCode = normalizeSkuToken(payload.code);
      if (!cleanCode) throw new Error('Mã sản phẩm không hợp lệ.');
      const conflict = this.data.products.find(
        (p) => p.shopId === shopId && p.id !== productId && p.code === cleanCode
      );
      if (conflict) throw new Error(`Mã sản phẩm "${cleanCode}" đã được dùng cho mẫu khác.`);
      if (product.code !== cleanCode) {
        product.code = cleanCode;
        needRebuildVariants = true;
      }
    }

    if (payload.colors !== undefined) {
      product.colors = payload.colors.map((c) => ({
        name: c.name.trim(),
        code: normalizeSkuToken(c.code || c.name) || 'MAU',
        hex: /^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : '#18181B',
      }));
      needRebuildVariants = true;
    }

    if (payload.sizes !== undefined) {
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

  deleteProduct(shopId: string, productId: string): void {
    const idx = this.data.products.findIndex((p) => p.id === productId && p.shopId === shopId);
    if (idx === -1) {
      throw new Error('Không tìm thấy sản phẩm để xóa.');
    }
    this.data.products.splice(idx, 1);
    this.data.variants = this.data.variants.filter(
      (v) => !(v.shopId === shopId && v.productId === productId)
    );
    this.persist();
  }

  getOrdersForShop(shopId: string): Order[] {
    return this.data.orders
      .filter((o) => o.shopId === shopId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((o) => ({
        ...o,
        items: this.data.orderItems.filter((i) => i.shopId === shopId && i.orderId === o.id),
      }));
  }

  updateOrderForShop(
    shopId: string,
    orderId: string,
    payload: {
      status?: OrderStatus;
      trackingCode?: string;
      adminNote?: string;
    }
  ): Order {
    const order = this.data.orders.find((o) => o.id === orderId && o.shopId === shopId);
    if (!order) {
      throw new Error('Không tìm thấy đơn hàng thuộc gian hàng của bạn.');
    }
    if (payload.status !== undefined) order.status = payload.status;
    if (payload.trackingCode !== undefined) order.trackingCode = payload.trackingCode.trim();
    if (payload.adminNote !== undefined) order.adminNote = payload.adminNote.trim();
    order.updatedAt = new Date().toISOString();
    this.persist();

    const items = this.data.orderItems.filter((i) => i.shopId === shopId && i.orderId === order.id);
    return { ...order, items };
  }

  // ---- Super Admin (NEVER touches orders or orderItems!) ----

  listShopsForSuperAdmin(): SuperAdminShopSummary[] {
    return this.data.shops.map((shop) => {
      const productCount = this.data.products.filter((p) => p.shopId === shop.id).length;
      const members: ShopMemberSummary[] = this.data.users
        .filter((u) => u.shopId === shop.id && u.role !== 'super_admin')
        .map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          role: u.role as 'shop_owner' | 'shop_staff',
          shopId: shop.id,
          createdAt: u.createdAt,
        }));
      return {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        orderPrefix: shop.orderPrefix,
        orderSeq: shop.orderSeq,
        messengerLink: shop.messengerLink,
        agentApiKey: shop.agentApiKey,
        isActive: shop.isActive,
        createdAt: shop.createdAt,
        productCount,
        members,
      };
    });
  }

  createShop(payload: {
    name: string;
    slug: string;
    orderPrefix: string;
    messengerLink: string;
  }): SuperAdminShopSummary {
    const cleanSlug = payload.slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!cleanSlug || ['admin', 'super-admin', 'login', 'api'].includes(cleanSlug)) {
      throw new Error('Slug gian hàng không hợp lệ hoặc trùng đường dẫn hệ thống.');
    }
    if (this.data.shops.some((s) => s.slug === cleanSlug)) {
      throw new Error(`Đường dẫn "/${cleanSlug}" đã tồn tại.`);
    }

    const cleanPrefix = normalizeSkuToken(payload.orderPrefix).slice(0, 6);
    if (cleanPrefix.length < 2) {
      throw new Error('Tiền tố mã đơn phải có ít nhất 2 ký tự chữ/số (ví dụ: MM).');
    }

    const shop: Shop = {
      id: genId('shop'),
      name: payload.name.trim(),
      slug: cleanSlug,
      orderPrefix: cleanPrefix,
      orderSeq: 0,
      messengerLink: payload.messengerLink.trim(),
      agentApiKey: genAgentApiKey(),
      isActive: true,
      createdAt: new Date().toISOString(),
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
      agentApiKey: shop.agentApiKey,
      isActive: shop.isActive,
      createdAt: shop.createdAt,
      productCount: 0,
      members: [],
    };
  }

  updateShop(
    shopId: string,
    payload: {
      name?: string;
      orderPrefix?: string;
      messengerLink?: string;
      isActive?: boolean;
    }
  ): SuperAdminShopSummary {
    const shop = this.data.shops.find((s) => s.id === shopId);
    if (!shop) {
      throw new Error('Không tìm thấy gian hàng.');
    }
    if (payload.name !== undefined) shop.name = payload.name.trim();
    if (payload.orderPrefix !== undefined) {
      const cleanPrefix = normalizeSkuToken(payload.orderPrefix).slice(0, 6);
      if (cleanPrefix.length < 2) {
        throw new Error('Tiền tố mã đơn phải có ít nhất 2 ký tự.');
      }
      shop.orderPrefix = cleanPrefix;
    }
    if (payload.messengerLink !== undefined) shop.messengerLink = payload.messengerLink.trim();
    if (payload.isActive !== undefined) shop.isActive = Boolean(payload.isActive);

    this.persist();
    return this.listShopsForSuperAdmin().find((s) => s.id === shopId)!;
  }

  addShopMember(
    shopId: string,
    payload: {
      email: string;
      displayName: string;
      password: string;
      role: 'shop_owner' | 'shop_staff';
    }
  ): ShopMemberSummary {
    const shop = this.data.shops.find((s) => s.id === shopId);
    if (!shop) {
      throw new Error('Không tìm thấy gian hàng.');
    }
    const email = payload.email.trim().toLowerCase();
    if (email.length < 3 || /\s/.test(email)) {
      throw new Error('Tên tài khoản hoặc email không hợp lệ (tối thiểu 3 ký tự, không có khoảng trắng).');
    }
    if (this.data.users.some((u) => u.email === email)) {
      throw new Error(`Tài khoản "${email}" đã được cấp quyền trên hệ thống.`);
    }
    if (payload.password.length < 3) {
      throw new Error('Mật khẩu phải có ít nhất 3 ký tự.');
    }

    const user: StoredUser = {
      id: genId('usr'),
      email,
      displayName: payload.displayName.trim() || email.split('@')[0],
      passwordHash: hashPassword(payload.password),
      role: payload.role,
      shopId,
      createdAt: new Date().toISOString(),
    };

    this.data.users.push(user);
    this.persist();

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: payload.role,
      shopId,
      createdAt: user.createdAt,
    };
  }

  updateShopMemberPassword(shopId: string, userId: string, newPassword: string): StoredUser {
    const user = this.data.users.find(
      (u) => u.id === userId && u.shopId === shopId && u.role !== 'super_admin'
    );
    if (!user) {
      throw new Error('Không tìm thấy tài khoản trong gian hàng này.');
    }
    if (newPassword.length < 3) {
      throw new Error('Mật khẩu mới phải có ít nhất 3 ký tự.');
    }
    user.passwordHash = hashPassword(newPassword);
    this.persist();
    return user;
  }

  removeShopMember(shopId: string, userId: string): void {
    const idx = this.data.users.findIndex(
      (u) => u.id === userId && u.shopId === shopId && u.role !== 'super_admin'
    );
    if (idx === -1) {
      throw new Error('Không tìm thấy tài khoản trong gian hàng này.');
    }
    this.data.users.splice(idx, 1);
    this.persist();
  }

  // ---- Agent Notifications & Key Management ----

  verifyShopAgentKey(shopSlug: string, providedKey: string | null): boolean {
    if (!providedKey || !providedKey.trim()) return false;
    const candidate = providedKey.trim();

    const safeCompare = (a: string, b: string) => {
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    };

    const globalKey = process.env.AGENT_API_KEY?.trim();
    if (globalKey && globalKey.length >= 8 && safeCompare(candidate, globalKey)) {
      return true;
    }

    const shop = this.getShopBySlug(shopSlug);
    if (!shop?.agentApiKey) return false;
    return safeCompare(candidate, shop.agentApiKey);
  }

  rotateShopAgentKey(shopId: string): string {
    const shop = this.getShopById(shopId);
    if (!shop) throw new Error('Không tìm thấy gian hàng.');
    shop.agentApiKey = genAgentApiKey();
    this.persist();
    return shop.agentApiKey;
  }

  listAgentNotifications(shopSlug: string, onlyUnacked: boolean): AgentNotification[] {
    const clean = shopSlug.trim().toLowerCase();
    const filtered = this.data.agentNotifications.filter(
      (n) => n.shopSlug === clean && (!onlyUnacked || n.deliveryStatus !== 'acked')
    );
    return filtered.sort((a, b) =>
      onlyUnacked
        ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getAgentNotification(notificationId: string): AgentNotification | null {
    return (
      this.data.agentNotifications.find((n) => n.notificationId === notificationId) ?? null
    );
  }

  markNotificationDelivered(notificationId: string): AgentNotification | null {
    const notif = this.getAgentNotification(notificationId);
    if (!notif || notif.deliveryStatus === 'acked') return notif;
    notif.deliveryStatus = 'delivered';
    notif.deliveredAt = new Date().toISOString();
    notif.lastError = null;
    this.persist();
    return notif;
  }

  incrementNotificationRetry(
    shopSlug: string,
    notificationId: string
  ): AgentNotification | null {
    const clean = shopSlug.trim().toLowerCase();
    const notif = this.data.agentNotifications.find(
      (n) => n.notificationId === notificationId && n.shopSlug === clean
    );
    if (!notif) return null;
    notif.retryCount += 1;
    this.persist();
    return notif;
  }

  ackNotification(shopSlug: string | null, notificationId: string): AgentNotification | null {
    const notif = this.data.agentNotifications.find(
      (n) =>
        n.notificationId === notificationId &&
        (!shopSlug || n.shopSlug === shopSlug.trim().toLowerCase())
    );
    if (!notif) return null;
    if (notif.deliveryStatus !== 'acked') {
      notif.deliveryStatus = 'acked';
      notif.ackedAt = new Date().toISOString();
      notif.lastError = null;
      this.persist();
    }
    return notif;
  }

  failNotification(
    shopSlug: string | null,
    notificationId: string,
    errorText: string
  ): AgentNotification | null {
    const notif = this.data.agentNotifications.find(
      (n) =>
        n.notificationId === notificationId &&
        (!shopSlug || n.shopSlug === shopSlug.trim().toLowerCase())
    );
    if (!notif) return null;
    notif.deliveryStatus = 'failed';
    notif.retryCount += 1;
    notif.lastError = errorText.trim().slice(0, 500) || 'Delivery failed';
    this.persist();
    return notif;
  }
}

export const store = new MultiTenantStore();
