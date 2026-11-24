import React, { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatVnd,
  isValidMessengerUrl,
  isValidVietnamPhone,
  type CartItem,
  type Order,
} from '../shared/types.ts';
import { api } from '../lib/api.ts';
import { copyTextReliably, copyTextSyncFallback } from '../lib/clipboard.ts';
import { useToast } from '../context/ToastContext.tsx';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  shopName: string;
  shopSlug: string;
  items: CartItem[];
  totalAmount: number;
  onUpdateQuantity: (variantId: string, quantity: number) => void;
  onRemoveItem: (variantId: string) => void;
  onClearCart: () => void;
}

interface CompletedOrderState {
  order: Order;
  messengerLink: string;
  copied: boolean;
}

export function CartDrawer({
  open,
  onClose,
  shopName,
  shopSlug,
  items,
  totalAmount,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
}: CartDrawerProps) {
  const { showToast } = useToast();

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerNote, setCustomerNote] = useState('');

  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    phone?: string;
    address?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [completed, setCompleted] = useState<CompletedOrderState | null>(null);

  if (!open) return null;

  const validateForm = () => {
    const errors: { name?: string; phone?: string; address?: string } = {};
    if (customerName.trim().length < 2) {
      errors.name = 'Vui lòng nhập họ tên người nhận.';
    }
    if (!isValidVietnamPhone(customerPhone)) {
      errors.phone = 'Số điện thoại cần đủ 10 số hợp lệ (vd: 0901234567).';
    }
    if (customerAddress.trim().length < 5) {
      errors.address = 'Vui lòng nhập địa chỉ giao hàng đầy đủ.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (items.length === 0) {
      setSubmitError('Giỏ hàng đang trống.');
      return;
    }
    if (!validateForm()) return;

    setSubmitting(true);
    try {
      const result = await api.placeOrder(shopSlug, {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerAddress: customerAddress.trim(),
        customerNote: customerNote.trim(),
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        origin: window.location.origin,
      });

      // Attempt automatic clipboard copy right after order creation (F4)
      const copied = await copyTextReliably(result.order.messengerText);

      setCompleted({
        order: result.order,
        messengerLink: result.messengerLink,
        copied,
      });
      onClearCart();
      setCustomerName('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerNote('');
      setFieldErrors({});

      if (copied) {
        showToast(`Đã tạo đơn ${result.order.orderCode} và tự động sao chép nội dung`);
      } else {
        showToast(`Đã tạo đơn ${result.order.orderCode}. Bấm sao chép trước khi mở Messenger.`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Không thể gửi đơn hàng.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualCopy = async () => {
    if (!completed) return;
    const ok = await copyTextReliably(completed.order.messengerText);
    setCompleted((prev) => (prev ? { ...prev, copied: ok } : prev));
    if (ok) {
      showToast('Đã sao chép nội dung đơn hàng');
    } else {
      showToast('Không thể tự sao chép, bạn hãy nhấn giữ ô nội dung để copy.', 'error');
    }
  };

  const handleMessengerTap = () => {
    if (!completed) return;
    // Synchronous fallback copy inside direct tap gesture improves reliability on iOS WebView
    const ok = copyTextSyncFallback(completed.order.messengerText);
    if (ok) {
      setCompleted((prev) => (prev ? { ...prev, copied: true } : prev));
    }
  };

  const handleCloseDrawer = () => {
    setCompleted(null);
    setSubmitError(null);
    onClose();
  };

  const safeMessengerHref =
    completed && isValidMessengerUrl(completed.messengerLink) ? completed.messengerLink : null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-stretch sm:justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Giỏ hàng và đặt đơn"
    >
      <div className="fixed inset-0" onClick={handleCloseDrawer} aria-hidden="true" />

      <div className="relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white sm:h-full sm:max-h-none sm:max-w-lg sm:rounded-none sm:border-l sm:border-zinc-200">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-zinc-900">
              {completed ? `Đơn hàng #${completed.order.orderCode}` : 'Giỏ hàng & Đặt đơn'}
            </h2>
            <p className="text-xs text-zinc-500">{shopName}</p>
          </div>
          <button
            type="button"
            onClick={handleCloseDrawer}
            aria-label="Đóng"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {completed ? (
            <div className="space-y-5">
              {/* Success summary */}
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <Check className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-zinc-900">
                      Đã lưu đơn hàng{' '}
                      <span className="font-mono">{completed.order.orderCode}</span>
                    </p>
                    <p className="text-xs leading-relaxed text-zinc-600">
                      {completed.copied
                        ? 'Nội dung đơn đã được tự động sao chép. Bấm nút Mở Messenger bên dưới rồi dán và gửi cho shop.'
                        : 'Bấm Sao chép nội dung đơn trước, sau đó mở Messenger để dán và gửi cho shop.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Primary Messenger & Fallback Copy Actions (F4) */}
              <div className="space-y-2.5">
                {safeMessengerHref ? (
                  <a
                    href={safeMessengerHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleMessengerTap}
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#0084FF] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0073E6] active:scale-[0.99]"
                  >
                    <span>Mở Messenger để dán & gửi đơn</span>
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}

                <button
                  type="button"
                  onClick={handleManualCopy}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 active:scale-[0.99]"
                >
                  {completed.copied ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-600" />
                      <span>Đã sao chép — Bấm để sao chép lại</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      <span>Sao chép nội dung đơn (dự phòng)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Formatted message preview (F4) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span className="font-medium text-zinc-700">Nội dung tin nhắn đơn hàng</span>
                  <span>Sẵn sàng dán vào Messenger</span>
                </div>
                <pre className="max-h-60 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 font-mono text-xs leading-relaxed text-zinc-800 select-all">
                  {completed.order.messengerText}
                </pre>
              </div>

              {/* Continue shopping */}
              <div className="border-t border-zinc-200 pt-4">
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="min-h-[44px] w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Tiếp tục xem sản phẩm
                </button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingBag className="mb-3 h-8 w-8 text-zinc-300" />
              <p className="text-sm font-medium text-zinc-900">Giỏ hàng đang trống</p>
              <p className="mt-1 text-xs text-zinc-500">
                Chọn màu, chọn size rồi bấm thêm vào giỏ để bắt đầu đặt đơn.
              </p>
            </div>
          ) : (
            <form id="checkout-form" onSubmit={handleSubmitOrder} className="space-y-6" noValidate>
              {/* Cart Items List */}
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                {items.map((item) => (
                  <div key={item.variantId} className="flex items-start justify-between gap-3 p-3.5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {item.productName}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full border border-zinc-300"
                            style={{ backgroundColor: item.colorHex }}
                          />
                          {item.colorName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Size {item.size}</span>
                      </div>
                      <p className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
                        {formatVnd(item.unitPrice * item.quantity)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.variantId, item.quantity - 1)}
                        aria-label="Giảm số lượng"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-7 text-center font-mono text-sm font-medium tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.variantId, item.quantity + 1)}
                        aria-label="Tăng số lượng"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.variantId)}
                        aria-label="Xóa khỏi giỏ"
                        className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Order Total */}
              <div className="flex items-center justify-between border-y border-zinc-200 py-3.5">
                <span className="text-sm font-medium text-zinc-600">Tạm tính</span>
                <span className="font-mono text-lg font-bold tabular-nums text-zinc-900">
                  {formatVnd(totalAmount)}
                </span>
              </div>

              {/* Shipping Info Form (F3) */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-zinc-900">Thông tin giao hàng</h3>

                <div>
                  <label
                    htmlFor="checkout-name"
                    className="mb-1.5 block text-xs font-medium text-zinc-700"
                  >
                    Họ và tên <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="checkout-name"
                    type="text"
                    autoComplete="name"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                    placeholder="Nguyễn Văn A"
                    className={`min-h-[44px] w-full rounded-lg border px-3.5 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 ${
                      fieldErrors.name ? 'border-red-500 bg-red-50/40' : 'border-zinc-300 bg-white'
                    }`}
                  />
                  {fieldErrors.name && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="checkout-phone"
                    className="mb-1.5 block text-xs font-medium text-zinc-700"
                  >
                    Số điện thoại <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="checkout-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={customerPhone}
                    onChange={(e) => {
                      setCustomerPhone(e.target.value);
                      if (fieldErrors.phone)
                        setFieldErrors((prev) => ({ ...prev, phone: undefined }));
                    }}
                    placeholder="0901234567"
                    className={`min-h-[44px] w-full rounded-lg border px-3.5 font-mono text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 ${
                      fieldErrors.phone ? 'border-red-500 bg-red-50/40' : 'border-zinc-300 bg-white'
                    }`}
                  />
                  {fieldErrors.phone && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="checkout-address"
                    className="mb-1.5 block text-xs font-medium text-zinc-700"
                  >
                    Địa chỉ nhận hàng <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="checkout-address"
                    rows={2}
                    autoComplete="street-address"
                    value={customerAddress}
                    onChange={(e) => {
                      setCustomerAddress(e.target.value);
                      if (fieldErrors.address)
                        setFieldErrors((prev) => ({ ...prev, address: undefined }));
                    }}
                    placeholder="Số nhà, tên đường, phường/xã, quận/huyện, tỉnh/thành"
                    className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 ${
                      fieldErrors.address
                        ? 'border-red-500 bg-red-50/40'
                        : 'border-zinc-300 bg-white'
                    }`}
                  />
                  {fieldErrors.address && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.address}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="checkout-note"
                    className="mb-1.5 block text-xs font-medium text-zinc-700"
                  >
                    Ghi chú cho shop (tùy chọn)
                  </label>
                  <input
                    id="checkout-note"
                    type="text"
                    value={customerNote}
                    onChange={(e) => setCustomerNote(e.target.value)}
                    placeholder="Ví dụ: giao giờ hành chính, gọi trước khi giao..."
                    className="min-h-[44px] w-full rounded-lg border border-zinc-300 bg-white px-3.5 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900"
                  />
                </div>

                {submitError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                    {submitError}
                  </p>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Sticky Footer Submit Button when placing order */}
        {!completed && items.length > 0 && (
          <div className="border-t border-zinc-200 bg-white px-5 py-4">
            <button
              type="submit"
              form="checkout-form"
              disabled={submitting}
              className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? 'Đang tạo đơn...'
                : `Đặt đơn & Copy sang Messenger · ${formatVnd(totalAmount)}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
