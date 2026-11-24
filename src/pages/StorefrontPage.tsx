import React, { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, ShoppingBag } from 'lucide-react';
import {
  buildSku,
  formatVnd,
  type Product,
  type PublicShopResponse,
} from '../shared/types.ts';
import { api } from '../lib/api.ts';
import { useShopCart } from '../lib/cart.ts';
import { useToast } from '../context/ToastContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { CartDrawer } from '../components/CartDrawer.tsx';
import { Link } from '../lib/router.tsx';

function ProductCard({
  product,
  onAddToCart,
}: {
  product: Product;
  onAddToCart: (payload: {
    variantId: string;
    productId: string;
    productName: string;
    colorName: string;
    colorHex: string;
    size: string;
    sku: string;
    unitPrice: number;
    quantity: number;
  }) => void;
}) {
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string>(product.sizes[0] ?? 'M');
  const [quantity, setQuantity] = useState(1);

  const activeColor = product.colors[selectedColorIndex] ?? product.colors[0];

  const matchedVariant = useMemo(() => {
    if (!activeColor) return null;
    const expectedSku = buildSku(product.code, activeColor.code || activeColor.name, selectedSize);
    return (
      product.variants.find((v) => v.sku === expectedSku) ??
      product.variants.find(
        (v) =>
          v.colorName.toLowerCase() === activeColor.name.toLowerCase() &&
          v.size.toUpperCase() === selectedSize.toUpperCase()
      ) ??
      product.variants[0] ??
      null
    );
  }, [product, activeColor, selectedSize]);

  const handleAdd = () => {
    if (!matchedVariant) return;
    onAddToCart({
      variantId: matchedVariant.id,
      productId: product.id,
      productName: product.name,
      colorName: matchedVariant.colorName,
      colorHex: matchedVariant.colorHex,
      size: matchedVariant.size,
      sku: matchedVariant.sku,
      unitPrice: product.price,
      quantity,
    });
    setQuantity(1);
  };

  return (
    <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {/* Subtle color swatch header stripe — clean, zero images */}
      <div
        className="h-2 w-full transition-colors duration-200"
        style={{ backgroundColor: activeColor?.hex ?? '#18181B' }}
        aria-hidden="true"
      />

      <div className="flex flex-1 flex-col p-5">
        {/* Title & Price */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug text-zinc-900">{product.name}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              <span>{product.colors.length} màu</span>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span>Size {product.sizes.join(' / ')}</span>
            </p>
          </div>
          <p className="shrink-0 font-mono text-base font-bold tabular-nums text-zinc-900">
            {formatVnd(product.price)}
          </p>
        </div>

        {product.description && (
          <p className="mt-2.5 text-sm leading-relaxed text-zinc-600">{product.description}</p>
        )}

        {/* Color Selector — 4 circular swatches (F1) */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-zinc-700">
              Màu sắc: <span className="text-zinc-900">{activeColor?.name ?? '—'}</span>
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {product.colors.map((color, idx) => {
              const isSelected = idx === selectedColorIndex;
              return (
                <button
                  key={`${color.code}-${idx}`}
                  type="button"
                  onClick={() => setSelectedColorIndex(idx)}
                  aria-label={`Chọn màu ${color.name}`}
                  aria-pressed={isSelected}
                  title={color.name}
                  className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                >
                  <span
                    className={`block h-8 w-8 rounded-full border transition-transform ${
                      isSelected
                        ? 'scale-105 border-zinc-900 ring-2 ring-zinc-900 ring-offset-2'
                        : 'border-zinc-300 hover:scale-105'
                    }`}
                    style={{ backgroundColor: color.hex }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Size Selector (F1) */}
        <div className="mt-4">
          <p className="text-xs font-medium text-zinc-700">Kích cỡ (Size)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {product.sizes.map((size) => {
              const isSelected = size === selectedSize;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedSize(size)}
                  aria-pressed={isSelected}
                  className={`min-h-[42px] min-w-[48px] rounded-lg border px-3 text-sm font-medium transition-colors ${
                    isSelected
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </div>

        {/* Quantity + Add to Cart */}
        <div className="mt-5 flex items-center gap-2.5 pt-2">
          <div className="flex items-center rounded-lg border border-zinc-200 bg-white">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Giảm số lượng"
              className="flex h-11 w-10 items-center justify-center text-zinc-600 hover:text-zinc-900"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums text-zinc-900">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              aria-label="Tăng số lượng"
              className="flex h-11 w-10 items-center justify-center text-zinc-600 hover:text-zinc-900"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={!matchedVariant}
            className="min-h-[44px] flex-1 whitespace-nowrap rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-40"
          >
            Thêm vào giỏ
          </button>
        </div>
      </div>
    </article>
  );
}

export function StorefrontPage({ slug }: { slug: string }) {
  const { showToast } = useToast();
  const cart = useShopCart(slug);

  const [data, setData] = useState<PublicShopResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getPublicShop(slug)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Không thể tải gian hàng.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const shopName = data?.shop.name ?? slug;

  const handleAddToCart = (item: Parameters<typeof cart.addItem>[0]) => {
    cart.addItem(item);
    showToast(`Đã thêm ${item.productName} (${item.colorName} / ${item.size}) ×${item.quantity}`);
  };

  const { user } = useAuth();
  const authNav = !user
    ? { label: 'Đăng nhập', to: '/login' }
    : user.role === 'super_admin'
      ? { label: 'Admin hệ thống', to: '/super-admin' }
      : { label: 'Quản lý shop', to: '/admin' };

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-24 sm:pb-12">
      <TopBar
        brandName={shopName}
        brandTo={`/${slug}`}
        navItems={[
          { label: 'Sản phẩm', to: `/${slug}` },
          authNav,
        ]}
        cartCount={cart.totalItems}
        onOpenCart={() => setCartOpen(true)}
      />

      <main className="mx-auto max-w-5xl px-4 pt-6 sm:px-6 sm:pt-10">
        {loading ? (
          <div className="grid gap-5 md:grid-cols-2">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-72 animate-pulse rounded-xl border border-zinc-200 bg-white p-5"
              />
            ))}
          </div>
        ) : error || !data ? (
          <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <h1 className="text-lg font-bold text-zinc-900">Không tìm thấy gian hàng</h1>
            <p className="mt-2 text-sm text-zinc-600">
              {error ?? `Đường dẫn "/${slug}" không tồn tại.`}
            </p>
            <Link
              to="/mam"
              className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Về gian hàng tuithic studio (/mam)
            </Link>
          </div>
        ) : !data.shop.isActive ? (
          <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <h1 className="text-lg font-bold text-zinc-900">{data.shop.name} hiện đang tạm đóng</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Gian hàng tạm ngưng nhận đơn mới. Vui lòng quay lại sau hoặc nhắn tin trực tiếp cho
              shop.
            </p>
          </div>
        ) : (
          <>
            {/* Minimal Storefront Header */}
            <section className="mb-6 border-b border-zinc-200 pb-6 sm:mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                {data.shop.name}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
                Chọn màu, chọn size và thêm vào giỏ — không cần đăng nhập. Khi hoàn tất, đơn sẽ tự
                động sao chép nội dung chi tiết để bạn dán gửi nhanh qua Messenger của shop.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                <span>Link gian hàng: /{data.shop.slug}</span>
                <span aria-hidden="true">·</span>
                <span>{data.products.length} mẫu đang bán</span>
                <span aria-hidden="true">·</span>
                <span>Giỏ hàng tự lưu trên thiết bị</span>
              </div>
            </section>

            {/* Product List */}
            {data.products.length === 0 ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
                <p className="text-sm font-medium text-zinc-900">Chưa có sản phẩm nào đang mở bán</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Chủ shop có thể đăng sản phẩm mới trong mục Quản trị.
                </p>
              </div>
            ) : (
              <section aria-label="Danh sách sản phẩm" className="grid gap-5 md:grid-cols-2">
                {data.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAddToCart={handleAddToCart}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </main>

      {/* Mobile Sticky Bottom Cart Bar (<= 15% mobile viewport height) */}
      {data?.shop.isActive && cart.totalItems > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur-sm sm:hidden">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex min-h-[48px] w-full items-center justify-between rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" />
              <span>Xem giỏ hàng ({cart.totalItems})</span>
            </span>
            <span className="font-mono tabular-nums">{formatVnd(cart.totalAmount)}</span>
          </button>
        </div>
      )}

      {/* Cart & Checkout Drawer */}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        shopName={shopName}
        shopSlug={slug}
        items={cart.items}
        totalAmount={cart.totalAmount}
        onUpdateQuantity={cart.updateQuantity}
        onRemoveItem={cart.removeItem}
        onClearCart={cart.clearCart}
      />
    </div>
  );
}
