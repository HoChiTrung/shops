import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatVnd,
  normalizeSkuToken,
  ORDER_STATUS_LABELS,
  UNFINISHED_STATUSES,
  type Order,
  type OrderStatus,
  type Product,
  type ProductColorOption,
  type Shop,
} from '../shared/types.ts';
import { api } from '../lib/api.ts';
import { copyTextReliably } from '../lib/clipboard.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { AgentEventsPanel } from '../components/AgentEventsPanel.tsx';
import { AuthPanel } from './AuthPanel.tsx';
import { useRouter } from '../lib/router.tsx';

const DEFAULT_SIZE_CHOICES = ['S', 'M', 'L', 'XL', 'XXL', 'FREESIZE'];

const DEFAULT_COLORS: ProductColorOption[] = [
  { name: 'Trắng', code: 'TRANG', hex: '#F9FAFB' },
  { name: 'Đen', code: 'DEN', hex: '#18181B' },
  { name: 'Xanh', code: 'XANH', hex: '#2563EB' },
  { name: 'Xám', code: 'XAM', hex: '#9CA3AF' },
];

type OrderFilter = 'unfinished' | 'all' | OrderStatus;

const ORDER_FILTERS: Array<{ value: OrderFilter; label: string }> = [
  { value: 'unfinished', label: 'Chưa xử lý xong' },
  { value: 'all', label: 'Tất cả' },
  { value: 'new', label: 'Mới đặt' },
  { value: 'confirmed', label: 'Đã chốt' },
  { value: 'shipping', label: 'Đang giao' },
  { value: 'completed', label: 'Hoàn tất' },
  { value: 'cancelled', label: 'Đã hủy' },
];

function OrderRow({
  order,
  onSave,
}: {
  order: Order;
  onSave: (
    orderId: string,
    payload: { status: OrderStatus; trackingCode: string; adminNote: string }
  ) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [trackingCode, setTrackingCode] = useState(order.trackingCode);
  const [adminNote, setAdminNote] = useState(order.adminNote);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(order.status);
    setTrackingCode(order.trackingCode);
    setAdminNote(order.adminNote);
  }, [order]);

  const dirty =
    status !== order.status ||
    trackingCode.trim() !== order.trackingCode ||
    adminNote.trim() !== order.adminNote;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(order.id, {
        status,
        trackingCode: trackingCode.trim(),
        adminNote: adminNote.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyText = async () => {
    const ok = await copyTextReliably(order.messengerText);
    if (ok) showToast(`Đã sao chép nội dung đơn ${order.orderCode}`);
  };

  const statusTextColor: Record<OrderStatus, string> = {
    new: 'text-amber-700',
    confirmed: 'text-blue-700',
    shipping: 'text-indigo-700',
    completed: 'text-emerald-700',
    cancelled: 'text-red-700',
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-zinc-50/70"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="font-mono text-sm font-bold text-zinc-900">{order.orderCode}</span>
            <span aria-hidden="true" className="text-zinc-300">
              ·
            </span>
            <span className={`text-xs font-semibold ${statusTextColor[order.status]}`}>
              {ORDER_STATUS_LABELS[order.status]}
            </span>
            <span aria-hidden="true" className="text-zinc-300">
              ·
            </span>
            <span className="truncate text-sm font-medium text-zinc-800">{order.customerName}</span>
            <span className="font-mono text-xs text-zinc-500">{order.customerPhone}</span>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-500">
            {order.items
              .map((i) => `${i.productName} (${i.colorName}/${i.size}) ×${i.quantity}`)
              .join(', ')}
            {order.trackingCode ? ` · Vận đơn: ${order.trackingCode}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="font-mono text-sm font-bold tabular-nums text-zinc-900">
              {formatVnd(order.totalAmount)}
            </p>
            <p className="text-[11px] text-zinc-400">
              {new Date(order.createdAt).toLocaleDateString('vi-VN')}
            </p>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-zinc-200 px-4 py-4">
          {/* Customer & Items */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 text-xs text-zinc-600">
              <p className="font-semibold text-zinc-900">Thông tin giao hàng</p>
              <p>Người nhận: {order.customerName}</p>
              <p>
                SĐT:{' '}
                <a
                  href={`tel:${order.customerPhone}`}
                  className="font-mono text-zinc-900 underline"
                >
                  {order.customerPhone}
                </a>
              </p>
              <p>Địa chỉ: {order.customerAddress}</p>
              {order.customerNote && <p>Ghi chú khách: {order.customerNote}</p>}
            </div>

            <div className="space-y-1.5 text-xs">
              <p className="font-semibold text-zinc-900">Chi tiết sản phẩm</p>
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-zinc-700">
                  <span className="truncate">
                    <span className="font-medium text-zinc-900">{item.productName}</span> (
                    {item.colorName} / Size {item.size}) ×{item.quantity}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {formatVnd(item.lineTotal)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Update Controls (F8) */}
          <div className="grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-700">Trạng thái đơn</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as OrderStatus)}
                className="min-h-[42px] w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-900"
              >
                {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((key) => (
                  <option key={key} value={key}>
                    {ORDER_STATUS_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-700">Mã vận đơn</label>
              <input
                type="text"
                value={trackingCode}
                onChange={(e) => setTrackingCode(e.target.value)}
                placeholder="VD: GHTK849201"
                className="min-h-[42px] w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-700">
                Ghi chú nội bộ shop
              </label>
              <input
                type="text"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Đã thu CK, đợi bưu tá lấy..."
                className="min-h-[42px] w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-900"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleCopyText}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy nội dung tin nhắn đơn</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{saving ? 'Đang lưu...' : 'Lưu cập nhật'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ProductFormModalProps {
  open: boolean;
  editingProduct: Product | null;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    price: number;
    description: string;
    colors: ProductColorOption[];
    sizes: string[];
    isActive: boolean;
  }) => Promise<void>;
}

function ProductFormModal({ open, editingProduct, onClose, onSubmit }: ProductFormModalProps) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [colors, setColors] = useState<ProductColorOption[]>(DEFAULT_COLORS);
  const [sizes, setSizes] = useState<string[]>(['S', 'M', 'L', 'XL']);
  const [customSize, setCustomSize] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingProduct) {
      setName(editingProduct.name);
      setPrice(String(editingProduct.price));
      setDescription(editingProduct.description);
      setIsActive(editingProduct.isActive);
      setColors(editingProduct.colors.length ? editingProduct.colors : DEFAULT_COLORS);
      setSizes(editingProduct.sizes.length ? editingProduct.sizes : ['S', 'M', 'L', 'XL']);
    } else {
      setName('');
      setPrice('');
      setDescription('');
      setIsActive(true);
      setColors(DEFAULT_COLORS);
      setSizes(['S', 'M', 'L', 'XL']);
    }
    setCustomSize('');
  }, [open, editingProduct]);

  if (!open) return null;

  const updateColor = (idx: number, patch: Partial<ProductColorOption>) => {
    setColors((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const next = { ...c, ...patch };
        if (patch.name !== undefined) {
          next.code = normalizeSkuToken(patch.name) || c.code || 'MAU';
        }
        return next;
      })
    );
  };

  const addColorSlot = () => {
    setColors((prev) => [...prev, { name: 'Màu mới', code: 'MAU', hex: '#52525B' }]);
  };

  const removeColorSlot = (idx: number) => {
    if (colors.length <= 1) return;
    setColors((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleSize = (size: string) => {
    setSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  };

  const addCustomSize = () => {
    const clean = normalizeSkuToken(customSize);
    if (!clean) return;
    if (!sizes.includes(clean)) {
      setSizes((prev) => [...prev, clean]);
    }
    setCustomSize('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numPrice = Number(price);
    const validColors = colors.filter((c) => c.name.trim().length > 0);
    if (name.trim().length < 2) {
      setError('Vui lòng nhập tên sản phẩm.');
      return;
    }
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      setError('Vui lòng nhập giá bán hợp lệ.');
      return;
    }
    if (validColors.length === 0) {
      setError('Vui lòng giữ ít nhất 1 màu sắc.');
      return;
    }
    if (sizes.length === 0) {
      setError('Vui lòng chọn ít nhất 1 size.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        price: numPrice,
        description: description.trim(),
        colors: validColors.map((c) => ({
          name: c.name.trim(),
          code: normalizeSkuToken(c.code || c.name) || 'MAU',
          hex: c.hex,
        })),
        sizes,
        isActive,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể lưu sản phẩm.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editingProduct ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới'}
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="text-base font-bold text-zinc-900">
            {editingProduct ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form id="product-form" onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700">
              Tên sản phẩm <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Áo thun Basic Boxy"
              className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-700">
                Giá bán (VNĐ) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                min={1000}
                step={1000}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="249000"
                className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 font-mono text-sm outline-none focus:border-zinc-900"
              />
            </div>

            <div className="flex items-end">
              <label className="flex min-h-[42px] items-center gap-2 text-sm text-zinc-800">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 accent-zinc-900"
                />
                <span>Hiển thị trên gian hàng</span>
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700">
              Mô tả ngắn (tùy chọn)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="VD: Cotton 2 chiều 250gsm, form boxy đứng dáng"
              className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            />
          </div>

          {/* 4 Color Swatches Configuration (F1 & F6) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-800">
                Màu sắc hiển thị (chấm tròn chọn màu)
              </label>
              <button
                type="button"
                onClick={addColorSlot}
                className="text-xs font-medium text-zinc-700 underline hover:text-zinc-900"
              >
                + Thêm màu
              </button>
            </div>

            <div className="space-y-2">
              {colors.map((color, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`Chọn mã màu HEX ${idx + 1}`}
                    value={color.hex}
                    onChange={(e) => updateColor(idx, { hex: e.target.value })}
                    className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-zinc-300 bg-white p-0.5"
                  />
                  <input
                    type="text"
                    value={color.name}
                    onChange={(e) => updateColor(idx, { name: e.target.value })}
                    placeholder="Tên màu (VD: Xanh)"
                    className="min-h-[40px] flex-1 rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => removeColorSlot(idx)}
                    disabled={colors.length <= 1}
                    aria-label="Xóa màu"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Sizes */}
          <div className="space-y-2.5">
            <label className="block text-xs font-semibold text-zinc-800">Kích cỡ (Size)</label>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set([...DEFAULT_SIZE_CHOICES, ...sizes])).map((s) => {
                const selected = sizes.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSize(s)}
                    className={`min-h-[38px] rounded-lg border px-3 text-xs font-semibold transition-colors ${
                      selected
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customSize}
                onChange={(e) => setCustomSize(e.target.value.toUpperCase())}
                placeholder="Thêm size khác..."
                className="min-h-[38px] flex-1 rounded-lg border border-zinc-300 px-3 text-xs uppercase outline-none focus:border-zinc-900"
              />
              <button
                type="button"
                onClick={addCustomSize}
                className="min-h-[38px] rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Thêm size
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              {error}
            </p>
          )}
        </form>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Hủy
          </button>
          <button
            type="submit"
            form="product-form"
            disabled={saving}
            className="min-h-[42px] rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : editingProduct ? 'Lưu thay đổi' : 'Đăng sản phẩm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShopAdminPage() {
  const { user, logout } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'orders' | 'products' | 'agent'>('orders');
  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Order filters (F8 — default to unfinished orders)
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('unfinished');
  const [orderSearch, setOrderSearch] = useState('');

  // Product modal
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const loadShopData = useCallback(async (shopId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, productsRes, ordersRes] = await Promise.all([
        api.getShopSummary(shopId),
        api.getShopProducts(shopId),
        api.getShopOrders(shopId),
      ]);
      setShop(summaryRes.shop);
      setProducts(productsRes.products);
      setOrders(ordersRes.orders);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu gian hàng.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && user.role !== 'super_admin' && user.shopId) {
      loadShopData(user.shopId);
    }
  }, [user, loadShopData]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders.filter((o) => {
      const matchesFilter =
        orderFilter === 'all'
          ? true
          : orderFilter === 'unfinished'
            ? UNFINISHED_STATUSES.includes(o.status)
            : o.status === orderFilter;
      if (!matchesFilter) return false;
      if (!q) return true;
      return (
        o.orderCode.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerPhone.toLowerCase().includes(q) ||
        o.items.some((i) => i.productName.toLowerCase().includes(q))
      );
    });
  }, [orders, orderFilter, orderSearch]);

  const orderStats = useMemo(() => {
    let unfinished = 0;
    let newlyPlaced = 0;
    let shipping = 0;
    let completed = 0;
    for (const o of orders) {
      if (UNFINISHED_STATUSES.includes(o.status)) unfinished += 1;
      if (o.status === 'new') newlyPlaced += 1;
      if (o.status === 'shipping') shipping += 1;
      if (o.status === 'completed') completed += 1;
    }
    return { unfinished, newlyPlaced, shipping, completed };
  }, [orders]);

  const { navigate } = useRouter();

  useEffect(() => {
    if (user?.role === 'super_admin') {
      navigate('/super-admin', { replace: true });
    }
  }, [user, navigate]);

  if (!user) {
    return <AuthPanel />;
  }

  if (user.role === 'super_admin' || !user.shopId) {
    return null;
  }

  const shopId = user.shopId;

  const handleSaveOrder = async (
    orderId: string,
    payload: { status: OrderStatus; trackingCode: string; adminNote: string }
  ) => {
    const res = await api.updateOrder(shopId, orderId, payload);
    setOrders((prev) => prev.map((o) => (o.id === orderId ? res.order : o)));
    showToast(`Đã cập nhật đơn ${res.order.orderCode}`);
  };

  const handleSaveProduct = async (payload: {
    name: string;
    price: number;
    description: string;
    colors: ProductColorOption[];
    sizes: string[];
    isActive: boolean;
  }) => {
    if (editingProduct) {
      const res = await api.updateProduct(shopId, editingProduct.id, payload);
      setProducts((prev) => prev.map((p) => (p.id === editingProduct.id ? res.product : p)));
      showToast(`Đã cập nhật ${res.product.name}`);
    } else {
      const res = await api.createProduct(shopId, payload);
      setProducts((prev) => [res.product, ...prev]);
      showToast(`Đã thêm ${res.product.name}`);
    }
  };

  const handleToggleProduct = async (product: Product) => {
    try {
      const res = await api.updateProduct(shopId, product.id, { isActive: !product.isActive });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? res.product : p)));
      showToast(res.product.isActive ? `Đã hiện ${product.name}` : `Đã ẩn ${product.name}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể đổi trạng thái.', 'error');
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    try {
      await api.deleteProduct(shopId, product.id);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      showToast(`Đã xóa ${product.name}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể xóa sản phẩm.', 'error');
    }
  };

  const shopSlug = shop?.slug ?? user.shopSlug ?? 'mam';

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-16">
      <TopBar
        brandName={shop?.name ?? user.shopName ?? 'Quản lý Shop'}
        brandTo={`/${shopSlug}`}
        navItems={[
          { label: `Xem shop /${shopSlug}`, to: `/${shopSlug}` },
          { label: 'Quản lý shop', to: '/admin' },
        ]}
        rightAction={{ label: 'Đăng xuất', onClick: logout, icon: 'logout' }}
      />

      <main className="mx-auto max-w-5xl px-4 pt-6 sm:px-6 sm:pt-8">
        {/* Header & Tab Switch */}
        <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Quản trị {shop?.name ?? user.shopName}
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              <span>{user.email}</span>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span>{user.role === 'shop_owner' ? 'Chủ shop' : 'Nhân viên'}</span>
              {shop && (
                <>
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono">
                    /{shop.slug} · Tiền tố {shop.orderPrefix}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1">
            <button
              type="button"
              onClick={() => setTab('orders')}
              className={`min-h-[38px] whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors ${
                tab === 'orders'
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Đơn hàng ({orderStats.unfinished} chưa xong)
            </button>
            <button
              type="button"
              onClick={() => setTab('products')}
              className={`min-h-[38px] whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors ${
                tab === 'products'
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Sản phẩm ({products.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('agent')}
              className={`min-h-[38px] whitespace-nowrap rounded-md px-3.5 text-sm font-medium transition-colors ${
                tab === 'agent'
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Agent Events
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="mt-6 space-y-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-20 animate-pulse rounded-xl border border-zinc-200 bg-white"
              />
            ))}
          </div>
        ) : tab === 'agent' ? (
          <AgentEventsPanel shopId={shopId} shopSlug={shopSlug} />
        ) : tab === 'orders' ? (
          <section className="mt-6 space-y-5">
            {/* 4-column metric strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs text-zinc-500">Chưa xử lý xong</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
                  {orderStats.unfinished}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs text-zinc-500">Mới đặt</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-700">
                  {orderStats.newlyPlaced}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs text-zinc-500">Đang giao</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-indigo-700">
                  {orderStats.shipping}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <p className="text-xs text-zinc-500">Hoàn tất</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-700">
                  {orderStats.completed}
                </p>
              </div>
            </div>

            {/* Filter bar & Search */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {ORDER_FILTERS.map((f) => {
                  const active = orderFilter === f.value;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setOrderFilter(f.value)}
                      className={`min-h-[38px] whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
                        active
                          ? 'border-zinc-900 bg-zinc-900 text-white'
                          : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="search"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Tìm mã đơn, tên khách, SĐT..."
                  className="min-h-[40px] w-full rounded-lg border border-zinc-300 bg-white pr-3 pl-9 text-xs text-zinc-900 outline-none focus:border-zinc-900"
                />
              </div>
            </div>

            {/* Orders list */}
            {filteredOrders.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
                <p className="text-sm font-medium text-zinc-900">Không có đơn hàng phù hợp</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Thử đổi bộ lọc trạng thái hoặc từ khóa tìm kiếm.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((order) => (
                  <OrderRow key={order.id} order={order} onSave={handleSaveOrder} />
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="mt-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-zinc-600">
                Tự nhập giá, đăng sản phẩm với các chấm màu & size — không cần tải ảnh.
              </p>
              <button
                type="button"
                onClick={() => {
                  setEditingProduct(null);
                  setProductModalOpen(true);
                }}
                className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                <Plus className="h-4 w-4" />
                <span>Thêm sản phẩm</span>
              </button>
            </div>

            {products.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
                <p className="text-sm font-medium text-zinc-900">Chưa có sản phẩm nào</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Bấm &ldquo;Thêm sản phẩm&rdquo; để tạo mẫu đầu tiên cho gian hàng.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span className="text-sm font-semibold text-zinc-900">{product.name}</span>
                        <span aria-hidden="true" className="text-zinc-300">
                          ·
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            product.isActive ? 'text-emerald-700' : 'text-zinc-400'
                          }`}
                        >
                          {product.isActive ? 'Đang bán' : 'Đang ẩn'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span className="font-mono font-semibold tabular-nums text-zinc-900">
                          {formatVnd(product.price)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          {product.colors.map((c, idx) => (
                            <span
                              key={idx}
                              title={c.name}
                              className="inline-block h-3.5 w-3.5 rounded-full border border-zinc-300"
                              style={{ backgroundColor: c.hex }}
                            />
                          ))}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Size: {product.sizes.join(', ')}</span>
                        <span aria-hidden="true">·</span>
                        <span>{product.variants.length} phân loại</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleProduct(product)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        {product.isActive ? (
                          <>
                            <EyeOff className="h-3.5 w-3.5" />
                            <span>Ẩn</span>
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5" />
                            <span>Hiện</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingProduct(product);
                          setProductModalOpen(true);
                        }}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Sửa</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteProduct(product)}
                        aria-label={`Xóa ${product.name}`}
                        className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <ProductFormModal
        open={productModalOpen}
        editingProduct={editingProduct}
        onClose={() => setProductModalOpen(false)}
        onSubmit={handleSaveProduct}
      />
    </div>
  );
}
