import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Plus,
  Power,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  isValidMessengerUrl,
  type ShopMemberSummary,
  type SuperAdminShopSummary,
} from '../shared/types.ts';
import { api } from '../lib/api.ts';
import { copyTextReliably } from '../lib/clipboard.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { AuthPanel } from './AuthPanel.tsx';
import { Link, useRouter } from '../lib/router.tsx';

function ShopControlCard({
  shop,
  onToggleShop,
  onSaveMessengerLink,
  onRotateAgentKey,
  onOpenAddMember,
  onOpenChangePassword,
  onRemoveMember,
}: {
  shop: SuperAdminShopSummary;
  onToggleShop: (shop: SuperAdminShopSummary) => Promise<void>;
  onSaveMessengerLink: (shopId: string, messengerLink: string) => Promise<void>;
  onRotateAgentKey: (shopId: string) => Promise<void>;
  onOpenAddMember: (shop: SuperAdminShopSummary) => void;
  onOpenChangePassword: (shop: SuperAdminShopSummary, member: ShopMemberSummary) => void;
  onRemoveMember: (shopId: string, userId: string, email: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [linkDraft, setLinkDraft] = useState(shop.messengerLink);
  const [savingLink, setSavingLink] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    setLinkDraft(shop.messengerLink);
  }, [shop.messengerLink]);

  const linkDirty = linkDraft.trim() !== shop.messengerLink.trim();

  const handleSaveLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = linkDraft.trim();
    if (!isValidMessengerUrl(cleaned)) {
      showToast(
        'Link FB / Messenger phải bắt đầu bằng https://m.me/..., https://messenger.com/... hoặc https://facebook.com/...',
        'error'
      );
      return;
    }
    setSavingLink(true);
    try {
      await onSaveMessengerLink(shop.id, cleaned);
    } finally {
      setSavingLink(false);
    }
  };

  const handleCopyKey = async () => {
    if (!shop.agentApiKey) return;
    const ok = await copyTextReliably(shop.agentApiKey);
    if (ok) {
      setCopiedKey(true);
      showToast(`Đã sao chép Agent Key của /${shop.slug}`);
      setTimeout(() => setCopiedKey(false), 1800);
    }
  };

  const handleRotate = async () => {
    setRotatingKey(true);
    try {
      await onRotateAgentKey(shop.id);
    } finally {
      setRotatingKey(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      {/* Header: Shop identity + quick controls */}
      <div className="flex flex-col justify-between gap-3 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <h2 className="text-base font-bold text-zinc-900">{shop.name}</h2>
            <span aria-hidden="true" className="text-zinc-300">
              ·
            </span>
            <span
              className={`text-xs font-semibold ${
                shop.isActive ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {shop.isActive ? 'Đang hoạt động' : 'Đang tạm khóa'}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Gian hàng: <span className="font-mono text-zinc-800">/{shop.slug}</span>
            <span className="mx-1.5" aria-hidden="true">
              ·
            </span>
            Mã đơn: <span className="font-mono text-zinc-800">{shop.orderPrefix}</span>
            <span className="mx-1.5" aria-hidden="true">
              ·
            </span>
            <span>{shop.productCount} sản phẩm</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/${shop.slug}`}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <span>Mở gian hàng</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>

          <button
            type="button"
            onClick={() => onToggleShop(shop)}
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 text-xs font-medium ${
              shop.isActive
                ? 'border-zinc-200 text-zinc-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            <span>{shop.isActive ? 'Khóa shop' : 'Mở lại shop'}</span>
          </button>
        </div>
      </div>

      {/* Control 1: Facebook / Messenger Link & Agent JSON config */}
      <div className="mt-4 space-y-3 border-b border-zinc-100 pb-4">
        <form onSubmit={handleSaveLink} className="space-y-1.5">
          <label
            htmlFor={`fb-link-${shop.id}`}
            className="block text-xs font-semibold text-zinc-700"
          >
            Link Facebook / Messenger (dùng để gửi đơn & truyền JSON tới Agent)
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`fb-link-${shop.id}`}
              type="url"
              required
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              placeholder="https://m.me/tenpage hoặc https://facebook.com/tenpage"
              className="min-h-[40px] flex-1 rounded-lg border border-zinc-300 px-3 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-900"
            />
            <button
              type="submit"
              disabled={!linkDirty || savingLink}
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{savingLink ? 'Đang lưu...' : 'Lưu link FB'}</span>
            </button>
          </div>
        </form>

        {/* Agent JSON API Key */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50/70 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <span className="font-medium text-zinc-600">Agent JSON Key: </span>
            <span className="break-all font-mono text-zinc-800">
              {shop.agentApiKey ?? 'Chưa khởi tạo'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyKey}
              disabled={!shop.agentApiKey}
              className="inline-flex min-h-[30px] items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              {copiedKey ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              <span>{copiedKey ? 'Đã chép' : 'Sao chép'}</span>
            </button>
            <button
              type="button"
              onClick={handleRotate}
              disabled={rotatingKey}
              className="inline-flex min-h-[30px] items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${rotatingKey ? 'animate-spin' : ''}`} />
              <span>Đổi key</span>
            </button>
          </div>
        </div>
      </div>

      {/* Control 2: Shop Accounts & Password Reset */}
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-700">
            Tài khoản đăng nhập shop ({shop.members.length})
          </p>
          <button
            type="button"
            onClick={() => onOpenAddMember(shop)}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Thêm tài khoản</span>
          </button>
        </div>

        {shop.members.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-400">
            Chưa có tài khoản đăng nhập cho shop này. Bấm &ldquo;Thêm tài khoản&rdquo; để cấp.
          </p>
        ) : (
          <div className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-100">
            {shop.members.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-zinc-900">{m.email}</span>
                  <span className="mx-1.5 text-zinc-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-zinc-600">{m.displayName}</span>
                  <span className="mx-1.5 text-zinc-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-zinc-500">
                    {m.role === 'shop_owner' ? 'Chủ shop' : 'Nhân viên'}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenChangePassword(shop, m)}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-200 px-2.5 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>Đổi mật khẩu</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveMember(shop.id, m.id, m.email)}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-zinc-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Xóa</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SuperAdminPage() {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const { navigate } = useRouter();

  const [shops, setShops] = useState<SuperAdminShopSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create shop modal state (supports creating shop + initial shop login in one step)
  const [createShopOpen, setCreateShopOpen] = useState(false);
  const [shopName, setShopName] = useState('');
  const [shopSlug, setShopSlug] = useState('');
  const [orderPrefix, setOrderPrefix] = useState('');
  const [messengerLink, setMessengerLink] = useState('https://m.me/');
  const [initUsername, setInitUsername] = useState('');
  const [initPassword, setInitPassword] = useState('');
  const [creatingShop, setCreatingShop] = useState(false);
  const [createShopError, setCreateShopError] = useState<string | null>(null);

  // Add shop member modal state
  const [memberModalShop, setMemberModalShop] = useState<SuperAdminShopSummary | null>(null);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [memberRole, setMemberRole] = useState<'shop_owner' | 'shop_staff'>('shop_owner');
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  // Change shop member password modal state
  const [passwordTarget, setPasswordTarget] = useState<{
    shop: SuperAdminShopSummary;
    member: ShopMemberSummary;
  } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const loadShops = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSuperAdminShops();
      setShops(res.shops);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách shop.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && user.role !== 'super_admin') {
      navigate('/admin', { replace: true });
      return;
    }
    if (user?.role === 'super_admin') {
      loadShops();
    }
  }, [user, loadShops, navigate]);

  const stats = useMemo(() => {
    const active = shops.filter((s) => s.isActive).length;
    return {
      total: shops.length,
      active,
      locked: shops.length - active,
    };
  }, [shops]);

  if (!user) {
    return <AuthPanel />;
  }

  if (user.role !== 'super_admin') {
    return null;
  }

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateShopError(null);
    if (!isValidMessengerUrl(messengerLink)) {
      setCreateShopError(
        'Link FB / Messenger phải bắt đầu bằng https://m.me/..., https://messenger.com/... hoặc https://facebook.com/...'
      );
      return;
    }
    if (initUsername.trim() && initPassword.length < 3) {
      setCreateShopError('Mật khẩu tài khoản shop cần tối thiểu 3 ký tự.');
      return;
    }

    setCreatingShop(true);
    try {
      const res = await api.createShop({
        name: shopName.trim(),
        slug: shopSlug.trim(),
        orderPrefix: orderPrefix.trim().toUpperCase(),
        messengerLink: messengerLink.trim(),
      });
      let createdShop = res.shop;

      if (initUsername.trim() && initPassword) {
        try {
          const memberRes = await api.addShopMember(createdShop.id, {
            email: initUsername.trim(),
            displayName: `Chủ shop ${createdShop.name}`,
            password: initPassword,
            role: 'shop_owner',
          });
          createdShop = { ...createdShop, members: [...createdShop.members, memberRes.member] };
        } catch (memberErr: unknown) {
          showToast(
            `Đã tạo shop /${createdShop.slug}, nhưng chưa tạo được tài khoản: ${
              memberErr instanceof Error ? memberErr.message : 'Lỗi không xác định'
            }`,
            'error'
          );
        }
      }

      setShops((prev) => [...prev, createdShop]);
      setCreateShopOpen(false);
      setShopName('');
      setShopSlug('');
      setOrderPrefix('');
      setMessengerLink('https://m.me/');
      setInitUsername('');
      setInitPassword('');
      showToast(`Đã tạo shop /${createdShop.slug}`);
    } catch (err: unknown) {
      setCreateShopError(err instanceof Error ? err.message : 'Không thể tạo gian hàng.');
    } finally {
      setCreatingShop(false);
    }
  };

  const handleToggleShop = async (shop: SuperAdminShopSummary) => {
    try {
      const res = await api.updateShop(shop.id, { isActive: !shop.isActive });
      setShops((prev) => prev.map((s) => (s.id === shop.id ? res.shop : s)));
      showToast(res.shop.isActive ? `Đã mở lại /${shop.slug}` : `Đã khóa /${shop.slug}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể cập nhật trạng thái shop.', 'error');
    }
  };

  const handleSaveMessengerLink = async (shopId: string, newLink: string) => {
    try {
      const res = await api.updateShop(shopId, { messengerLink: newLink });
      setShops((prev) => prev.map((s) => (s.id === shopId ? res.shop : s)));
      showToast(`Đã cập nhật link FB / Messenger cho /${res.shop.slug}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể lưu link FB.', 'error');
    }
  };

  const handleRotateAgentKey = async (shopId: string) => {
    try {
      const res = await api.rotateSuperAdminShopAgentKey(shopId);
      setShops((prev) =>
        prev.map((s) => (s.id === shopId ? { ...s, agentApiKey: res.agentApiKey } : s))
      );
      showToast('Đã tạo mới Agent JSON Key');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể đổi Agent Key.', 'error');
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberModalShop) return;
    setMemberError(null);
    setAddingMember(true);
    try {
      const res = await api.addShopMember(memberModalShop.id, {
        email: memberEmail.trim(),
        displayName: memberName.trim(),
        password: memberPassword,
        role: memberRole,
      });
      setShops((prev) =>
        prev.map((s) =>
          s.id === memberModalShop.id ? { ...s, members: [...s.members, res.member] } : s
        )
      );
      setMemberModalShop(null);
      setMemberEmail('');
      setMemberName('');
      setMemberPassword('');
      setMemberRole('shop_owner');
      showToast(`Đã cấp tài khoản ${res.member.email}`);
    } catch (err: unknown) {
      setMemberError(err instanceof Error ? err.message : 'Không thể cấp tài khoản.');
    } finally {
      setAddingMember(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordTarget) return;
    setPasswordError(null);
    if (newPassword.length < 3) {
      setPasswordError('Mật khẩu mới phải có ít nhất 3 ký tự.');
      return;
    }
    setSavingPassword(true);
    try {
      await api.updateShopMemberPassword(
        passwordTarget.shop.id,
        passwordTarget.member.id,
        newPassword
      );
      showToast(`Đã đổi mật khẩu cho tài khoản ${passwordTarget.member.email}`);
      setPasswordTarget(null);
      setNewPassword('');
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : 'Không thể đổi mật khẩu.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRemoveMember = async (shopId: string, userId: string, email: string) => {
    try {
      await api.removeShopMember(shopId, userId);
      setShops((prev) =>
        prev.map((s) =>
          s.id === shopId ? { ...s, members: s.members.filter((m) => m.id !== userId) } : s
        )
      );
      showToast(`Đã xóa tài khoản ${email}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể xóa tài khoản.', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] pb-16">
      <TopBar
        brandName="Admin hệ thống"
        brandTo="/super-admin"
        navItems={[{ label: 'Quản lý Shop', to: '/super-admin' }]}
        rightAction={{ label: 'Đăng xuất', onClick: logout, icon: 'logout' }}
      />

      <main className="mx-auto max-w-5xl px-4 pt-6 sm:px-6 sm:pt-8">
        {/* Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
              Kiểm soát hệ thống Shop
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {user.email} · Quản lý số lượng shop, mật khẩu đăng nhập shop và link FB / Agent JSON
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setCreateShopError(null);
              setCreateShopOpen(true);
            }}
            className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" />
            <span>Thêm shop mới</span>
          </button>
        </div>

        {/* Simple 3-metric overview strip */}
        <section className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3.5">
            <p className="text-xs text-zinc-500">Tổng số shop</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
              {stats.total}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3.5">
            <p className="text-xs text-zinc-500">Đang hoạt động</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-700">
              {stats.active}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3.5">
            <p className="text-xs text-zinc-500">Đang tạm khóa</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-700">
              {stats.locked}
            </p>
          </div>
        </section>

        {/* Privacy boundary notice */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <p>
            <strong className="font-semibold text-zinc-900">Phân quyền tách biệt:</strong> Admin hệ
            thống chỉ quản lý danh sách shop, mật khẩu đăng nhập và link Facebook/Agent; không can
            thiệp hay xem đơn hàng kinh doanh của từng shop.
          </p>
        </div>

        {error && (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="mt-6 space-y-4">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="h-44 animate-pulse rounded-xl border border-zinc-200 bg-white"
              />
            ))}
          </div>
        ) : (
          <section className="mt-6 space-y-4">
            {shops.map((shop) => (
              <ShopControlCard
                key={shop.id}
                shop={shop}
                onToggleShop={handleToggleShop}
                onSaveMessengerLink={handleSaveMessengerLink}
                onRotateAgentKey={handleRotateAgentKey}
                onOpenAddMember={(targetShop) => {
                  setMemberError(null);
                  setMemberModalShop(targetShop);
                }}
                onOpenChangePassword={(targetShop, targetMember) => {
                  setPasswordError(null);
                  setNewPassword('');
                  setPasswordTarget({ shop: targetShop, member: targetMember });
                }}
                onRemoveMember={handleRemoveMember}
              />
            ))}
          </section>
        )}
      </main>

      {/* Create Shop Modal */}
      {createShopOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fixed inset-0"
            onClick={() => setCreateShopOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-zinc-900">Thêm shop mới</h2>
              <button
                type="button"
                onClick={() => setCreateShopOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateShop} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-700">
                  Tên thương hiệu / Shop
                </label>
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="VD: Mây Studio"
                  className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">
                    Đường dẫn (Slug)
                  </label>
                  <input
                    type="text"
                    required
                    value={shopSlug}
                    onChange={(e) => setShopSlug(e.target.value.toLowerCase())}
                    placeholder="may-studio"
                    className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 font-mono text-sm outline-none focus:border-zinc-900"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">
                    Tiền tố mã đơn
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={orderPrefix}
                    onChange={(e) => setOrderPrefix(e.target.value.toUpperCase())}
                    placeholder="MS"
                    className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 font-mono text-sm uppercase outline-none focus:border-zinc-900"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-700">
                  Link Facebook / Messenger Page
                </label>
                <input
                  type="url"
                  required
                  value={messengerLink}
                  onChange={(e) => setMessengerLink(e.target.value)}
                  placeholder="https://m.me/tenpage hoặc https://facebook.com/tenpage"
                  className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 font-mono text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div className="space-y-3 border-t border-zinc-100 pt-3">
                <p className="text-xs font-semibold text-zinc-700">
                  Tài khoản đăng nhập cho shop (tùy chọn)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">
                      Tài khoản
                    </label>
                    <input
                      type="text"
                      value={initUsername}
                      onChange={(e) => setInitUsername(e.target.value)}
                      placeholder="VD: maystudio"
                      className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">
                      Mật khẩu
                    </label>
                    <input
                      type="password"
                      value={initPassword}
                      onChange={(e) => setInitPassword(e.target.value)}
                      placeholder="••••••"
                      className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                    />
                  </div>
                </div>
              </div>

              {createShopError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {createShopError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateShopOpen(false)}
                  className="min-h-[42px] rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={creatingShop}
                  className="min-h-[42px] rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {creatingShop ? 'Đang tạo...' : 'Tạo shop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {memberModalShop && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fixed inset-0"
            onClick={() => setMemberModalShop(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">Thêm tài khoản cho shop</h2>
                <p className="text-xs text-zinc-500">
                  {memberModalShop.name} (/{memberModalShop.slug})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMemberModalShop(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-700">
                  Tài khoản đăng nhập
                </label>
                <input
                  type="text"
                  required
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  placeholder="VD: shopmay hoặc shop@domain.com"
                  className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-700">Tên hiển thị</label>
                <input
                  type="text"
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Chủ shop / Nhân viên"
                  className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">Vai trò</label>
                  <select
                    value={memberRole}
                    onChange={(e) => setMemberRole(e.target.value as 'shop_owner' | 'shop_staff')}
                    className="min-h-[42px] w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900"
                  >
                    <option value="shop_owner">Chủ shop</option>
                    <option value="shop_staff">Nhân viên</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">Mật khẩu</label>
                  <input
                    type="password"
                    required
                    minLength={3}
                    value={memberPassword}
                    onChange={(e) => setMemberPassword(e.target.value)}
                    placeholder="••••••"
                    className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
              </div>

              {memberError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {memberError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMemberModalShop(null)}
                  className="min-h-[42px] rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={addingMember}
                  className="min-h-[42px] rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {addingMember ? 'Đang lưu...' : 'Tạo tài khoản'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {passwordTarget && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fixed inset-0"
            onClick={() => setPasswordTarget(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-sm rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">Đổi mật khẩu shop</h2>
                <p className="text-xs text-zinc-500">
                  {passwordTarget.shop.name} ·{' '}
                  <span className="font-mono text-zinc-800">{passwordTarget.member.email}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPasswordTarget(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label
                  htmlFor="reset-shop-pw"
                  className="mb-1 block text-xs font-medium text-zinc-700"
                >
                  Mật khẩu mới (tối thiểu 3 ký tự)
                </label>
                <input
                  id="reset-shop-pw"
                  type="password"
                  required
                  minLength={3}
                  autoFocus
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới cho shop"
                  className="min-h-[42px] w-full rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
                />
              </div>

              {passwordError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {passwordError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPasswordTarget(null)}
                  className="min-h-[42px] rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="min-h-[42px] rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {savingPassword ? 'Đang lưu...' : 'Lưu mật khẩu mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
