import React from 'react';
import { ShoppingBag, LogOut } from 'lucide-react';
import { Link, useRouter } from '../lib/router.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface TopBarProps {
  brandName: string;
  brandTo: string;
  navItems: Array<{ label: string; to: string }>;
  cartCount?: number;
  onOpenCart?: () => void;
  rightAction?: {
    label: string;
    onClick: () => void;
    icon?: 'logout';
  };
}

export function TopBar({
  brandName,
  brandTo,
  navItems,
  cartCount,
  onOpenCart,
  rightAction,
}: TopBarProps) {
  const { pathname } = useRouter();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:gap-8 sm:px-6">
        {/* Zone 1: Single text element wordmark */}
        <Link
          to={brandTo}
          className="shrink-0 whitespace-nowrap text-base font-bold tracking-tight text-zinc-900 sm:text-lg"
        >
          {brandName}
        </Link>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          aria-label="Điều hướng chính"
          className="flex items-center gap-4 overflow-x-auto text-sm font-medium text-zinc-600 sm:gap-6"
        >
          {navItems.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`shrink-0 whitespace-nowrap border-b-2 py-4 transition-colors ${
                  active
                    ? 'border-zinc-900 text-zinc-900'
                    : 'border-transparent hover:border-zinc-300 hover:text-zinc-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Zone 3: PWA install (when eligible) + primary action */}
        <div className="flex shrink-0 items-center gap-2">
          <PWAInstallButton />
          {onOpenCart !== undefined ? (
            <button
              type="button"
              onClick={onOpenCart}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 active:scale-[0.98] sm:px-4 sm:text-sm"
            >
              <ShoppingBag className="h-4 w-4" />
              <span>Giỏ hàng</span>
              <span className="font-mono tabular-nums">({cartCount ?? 0})</span>
            </button>
          ) : rightAction ? (
            <button
              type="button"
              onClick={rightAction.onClick}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900 sm:text-sm"
            >
              {rightAction.icon === 'logout' && <LogOut className="h-4 w-4" />}
              <span>{rightAction.label}</span>
            </button>
          ) : (
            <div className="w-1" />
          )}
        </div>
      </div>
    </header>
  );
}
