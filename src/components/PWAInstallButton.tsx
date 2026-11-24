import React, { useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Cài app</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Cài app</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Hướng dẫn cài đặt ứng dụng trên iOS"
          >
            <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-zinc-900">Thêm vào màn hình chính</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Đóng"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-zinc-600">
                <li>
                  Nhấn nút <strong className="text-zinc-900">Chia sẻ (Share)</strong> trên thanh công
                  cụ Safari.
                </li>
                <li>
                  Cuộn xuống và chọn{' '}
                  <strong className="text-zinc-900">Thêm vào MH chính (Add to Home Screen)</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 min-h-[42px] w-full rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white shadow-lg"
    >
      <WifiOff className="h-3.5 w-3.5 text-amber-400" />
      <span>Đang ngoại tuyến — giỏ hàng vẫn được lưu trên thiết bị</span>
    </div>
  );
}
