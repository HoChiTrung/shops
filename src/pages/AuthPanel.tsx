import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { useRouter } from '../lib/router.tsx';
import { TopBar } from '../components/TopBar.tsx';

export function AuthPanel() {
  const { user, hasShopAdmin, hasSuperAdmin, loadingStatus, login, bootstrap } = useAuth();
  const { showToast } = useToast();
  const { navigate } = useRouter();

  const showBootstrap = !hasShopAdmin && !hasSuperAdmin;

  // Redirect automatically if already authenticated
  useEffect(() => {
    if (user) {
      navigate(user.role === 'super_admin' ? '/super-admin' : '/admin', { replace: true });
    }
  }, [user, navigate]);

  // Unified login state (accepts username like "admin", "mam" or email)
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // First-run bootstrap state (only shown if DB has zero users at all)
  const [superAdminId, setSuperAdminId] = useState('admin');
  const [superAdminPassword, setSuperAdminPassword] = useState('');
  const [shopOwnerId, setShopOwnerId] = useState('mam');
  const [shopOwnerPassword, setShopOwnerPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
      return;
    }
    setSubmitting(true);
    try {
      const signedIn = await login(identifier.trim(), password);
      showToast(`Đã đăng nhập: ${signedIn.displayName}`);
      navigate(signedIn.role === 'super_admin' ? '/super-admin' : '/admin', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (superAdminPassword.length < 3 || shopOwnerPassword.length < 3) {
      setError('Mật khẩu cần tối thiểu 3 ký tự.');
      return;
    }
    if (shopOwnerId.trim().toLowerCase() === superAdminId.trim().toLowerCase()) {
      setError('Tài khoản Admin và tài khoản Shop cần khác nhau để tách biệt phân quyền.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await bootstrap({
        superAdminEmail: superAdminId.trim(),
        superAdminPassword,
        shopOwnerEmail: shopOwnerId.trim(),
        shopOwnerPassword,
        loginAs: 'super_admin',
      });
      showToast(`Đã khởi tạo hệ thống (${created.email})`);
      navigate('/super-admin', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể thiết lập tài khoản.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <TopBar
        brandName="tuithic studio"
        brandTo="/mam"
        navItems={[
          { label: 'Gian hàng /mam', to: '/mam' },
          { label: 'Đăng nhập', to: '/login' },
        ]}
      />

      <main className="mx-auto max-w-md px-4 py-12 sm:px-6">
        {loadingStatus ? (
          <div className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-white p-6" />
        ) : showBootstrap ? (
          <section className="rounded-xl border border-zinc-200 bg-white p-6">
            <div className="mb-5 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-white">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-zinc-900">Thiết lập tài khoản lần đầu</h1>
                <p className="text-xs text-zinc-500">
                  Khởi tạo tài khoản Admin hệ thống và tài khoản Shop /mam
                </p>
              </div>
            </div>

            <form onSubmit={handleBootstrap} className="space-y-4">
              <div className="space-y-3 border-b border-zinc-200 pb-4">
                <p className="text-xs font-semibold text-zinc-800">
                  1. Tài khoản Admin hệ thống (quản lý danh sách shop)
                </p>
                <div>
                  <label htmlFor="boot-sa-id" className="mb-1 block text-xs font-medium text-zinc-700">
                    Tên đăng nhập Admin
                  </label>
                  <input
                    id="boot-sa-id"
                    type="text"
                    required
                    value={superAdminId}
                    onChange={(e) => setSuperAdminId(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-zinc-300 px-3.5 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div>
                  <label htmlFor="boot-sa-pass" className="mb-1 block text-xs font-medium text-zinc-700">
                    Mật khẩu Admin
                  </label>
                  <input
                    id="boot-sa-pass"
                    type="password"
                    required
                    minLength={3}
                    value={superAdminPassword}
                    onChange={(e) => setSuperAdminPassword(e.target.value)}
                    placeholder="Nhập mật khẩu Admin"
                    className="min-h-[44px] w-full rounded-lg border border-zinc-300 px-3.5 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-zinc-800">
                  2. Tài khoản Shop đầu tiên (tuithic studio — /mam)
                </p>
                <div>
                  <label htmlFor="boot-owner-id" className="mb-1 block text-xs font-medium text-zinc-700">
                    Tên đăng nhập Shop
                  </label>
                  <input
                    id="boot-owner-id"
                    type="text"
                    required
                    value={shopOwnerId}
                    onChange={(e) => setShopOwnerId(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-zinc-300 px-3.5 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                <div>
                  <label htmlFor="boot-owner-pass" className="mb-1 block text-xs font-medium text-zinc-700">
                    Mật khẩu Shop
                  </label>
                  <input
                    id="boot-owner-pass"
                    type="password"
                    required
                    minLength={3}
                    value={shopOwnerPassword}
                    onChange={(e) => setShopOwnerPassword(e.target.value)}
                    placeholder="Nhập mật khẩu Shop"
                    className="min-h-[44px] w-full rounded-lg border border-zinc-300 px-3.5 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="min-h-[46px] w-full rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                {submitting ? 'Đang khởi tạo...' : 'Lưu & Đăng nhập'}
              </button>
            </form>
          </section>
        ) : (
          <section className="rounded-xl border border-zinc-200 bg-white p-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-white">
                <Lock className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-zinc-900">Đăng nhập hệ thống</h1>
                <p className="text-xs text-zinc-500">
                  Tự động phân quyền vào trang Admin hoặc trang Shop
                </p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-id" className="mb-1.5 block text-xs font-medium text-zinc-700">
                  Tài khoản
                </label>
                <input
                  id="login-id"
                  type="text"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Nhập tài khoản Admin hoặc Shop"
                  className="min-h-[44px] w-full rounded-lg border border-zinc-300 px-3.5 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="mb-1.5 block text-xs font-medium text-zinc-700"
                >
                  Mật khẩu
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="min-h-[44px] w-full rounded-lg border border-zinc-300 px-3.5 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="min-h-[46px] w-full rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
              </button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
