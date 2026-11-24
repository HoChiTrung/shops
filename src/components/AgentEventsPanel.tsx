import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Radio,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import type {
  AgentDeliveryStatus,
  AgentNotification,
  AgentOrderPayload,
} from '../shared/types.ts';
import { api, resolveApiUrl } from '../lib/api.ts';
import { copyTextReliably } from '../lib/clipboard.ts';
import { useToast } from '../context/ToastContext.tsx';

const DELIVERY_STATUS_LABELS: Record<AgentDeliveryStatus, string> = {
  pending: 'Chờ gửi (pending)',
  delivered: 'Đã đẩy (delivered)',
  acked: 'Đã xác nhận (acked)',
  failed: 'Lỗi (failed)',
};

const DELIVERY_STATUS_COLORS: Record<AgentDeliveryStatus, string> = {
  pending: 'text-amber-700',
  delivered: 'text-blue-700',
  acked: 'text-emerald-700',
  failed: 'text-red-700',
};

interface AgentEventsPanelProps {
  shopId: string;
  shopSlug: string;
}

export function AgentEventsPanel({ shopId, shopSlug }: AgentEventsPanelProps) {
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentApiKey, setAgentApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [connections, setConnections] = useState({ sse: 0, ws: 0, total: 0 });
  const [notifications, setNotifications] = useState<AgentNotification[]>([]);
  const [filter, setFilter] = useState<'unacked' | 'all'>('unacked');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const loadNotifications = useCallback(async () => {
    setError(null);
    try {
      const res = await api.getShopAgentNotifications(shopId);
      setAgentApiKey(res.agentApiKey);
      setConnections(res.connections);
      setNotifications(res.notifications);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách thông báo Agent.');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Real live EventSource subscription to /api/agent/stream so new orders appear immediately
  useEffect(() => {
    if (!agentApiKey) return;
    const streamUrl = resolveApiUrl(
      `/api/agent/stream?shop_slug=${encodeURIComponent(shopSlug)}&api_key=${encodeURIComponent(agentApiKey)}`
    );
    const es = new EventSource(streamUrl);

    es.addEventListener('connected', () => {
      setSseConnected(true);
    });

    es.addEventListener('order.created', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as AgentOrderPayload;
        setNotifications((prev) => {
          // Idempotent check to prevent duplicates on reconnect
          if (prev.some((n) => n.notificationId === payload.notification_id)) {
            return prev;
          }
          const incoming: AgentNotification = {
            id: payload.notification_id,
            notificationId: payload.notification_id,
            orderId: payload.order_code,
            shopSlug: payload.shop_slug,
            payload,
            deliveryStatus: 'delivered',
            retryCount: 0,
            lastError: null,
            createdAt: payload.created_at,
            deliveredAt: new Date().toISOString(),
            ackedAt: null,
          };
          return [incoming, ...prev];
        });
        showToast(`Đã nhận event realtime: ${payload.order_code}`);
      } catch {
        // Ignore malformed frame
      }
    });

    es.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [agentApiKey, shopSlug, showToast]);

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    return notifications.filter((n) => n.deliveryStatus !== 'acked');
  }, [notifications, filter]);

  const unackedCount = useMemo(
    () => notifications.filter((n) => n.deliveryStatus !== 'acked').length,
    [notifications]
  );

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyTextReliably(text);
    if (ok) showToast(`Đã sao chép ${label}`);
  };

  const handleAck = async (notificationId: string) => {
    setBusyId(notificationId);
    try {
      const res = await api.ackShopAgentNotification(shopId, notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.notificationId === notificationId ? res.notification : n))
      );
      showToast(`Đã xác nhận (acked) ${notificationId}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể xác nhận thông báo.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRetry = async (notificationId: string) => {
    setBusyId(notificationId);
    try {
      const res = await api.retryShopAgentNotification(shopId, notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.notificationId === notificationId ? res.notification : n))
      );
      showToast(
        res.deliveredCount > 0
          ? `Đã đẩy lại tới ${res.deliveredCount} Agent đang kết nối`
          : 'Đã tăng retry_count (hiện chưa có Agent ngoài kết nối)'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể đẩy lại sự kiện.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRotateKey = async () => {
    setRotating(true);
    try {
      const res = await api.rotateShopAgentKey(shopId);
      setAgentApiKey(res.agentApiKey);
      showToast('Đã cấp mới Agent API Key');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Không thể đổi khóa.', 'error');
    } finally {
      setRotating(false);
    }
  };

  const origin = window.location.origin;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/agent?shop_slug=${shopSlug}`;
  const sseUrl = `${origin}/api/agent/stream?shop_slug=${shopSlug}`;
  const pendingUrl = `${origin}/api/agent/notifications/pending?shop_slug=${shopSlug}`;

  if (loading) {
    return (
      <div className="mt-6 space-y-3">
        {[1, 2].map((n) => (
          <div key={n} className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
        ))}
      </div>
    );
  }

  return (
    <section className="mt-6 space-y-5">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Connection Endpoints & Key */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-3.5">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">
              Kết nối Agent nhận sự kiện đơn hàng (Realtime)
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Luồng lắng nghe live: {sseConnected ? 'Đang kết nối SSE' : 'Chưa kết nối'}
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span>
                Agent trực tuyến: {connections.total} (SSE {connections.sse} / WS {connections.ws})
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={loadNotifications}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Làm mới</span>
          </button>
        </div>

        {/* Agent API Key */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-zinc-700">
            Agent API Key (truyền qua header <span className="font-mono">x-agent-key</span> hoặc{' '}
            <span className="font-mono">?api_key=...</span>)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-h-[40px] flex-1 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800">
              {showKey ? agentApiKey : `${agentApiKey.slice(0, 8)}••••••••••••••••••••••••`}
            </code>
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span>{showKey ? 'Ẩn' : 'Hiện'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleCopy(agentApiKey, 'Agent API Key')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </button>
            <button
              type="button"
              onClick={handleRotateKey}
              disabled={rotating}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Đổi khóa</span>
            </button>
          </div>
        </div>

        {/* Endpoint cheatsheet */}
        <div className="grid gap-2.5 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="font-semibold text-zinc-800">SSE Stream (Realtime)</p>
            <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">{sseUrl}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="font-semibold text-zinc-800">WebSocket Stream (Realtime)</p>
            <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">{wsUrl}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="font-semibold text-zinc-800">Lấy thông báo chưa ack (GET)</p>
            <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">{pendingUrl}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="font-semibold text-zinc-800">Xác nhận đã xử lý (POST)</p>
            <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">
              {origin}/api/agent/notifications/:notification_id/ack
            </p>
          </div>
        </div>
      </div>

      {/* Filter Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter('unacked')}
            className={`min-h-[38px] rounded-lg border px-3 text-xs font-medium transition-colors ${
              filter === 'unacked'
                ? 'border-zinc-900 bg-zinc-900 text-white'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'
            }`}
          >
            Chưa ack ({unackedCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`min-h-[38px] rounded-lg border px-3 text-xs font-medium transition-colors ${
              filter === 'all'
                ? 'border-zinc-900 bg-zinc-900 text-white'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400'
            }`}
          >
            Tất cả ({notifications.length})
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Mỗi đơn mới tự động tạo bản ghi <span className="font-mono">agent_notifications</span> và
          đẩy JSON chuẩn tới Agent.
        </p>
      </div>

      {/* Notifications List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-zinc-900">Không có thông báo nào trong mục này</p>
          <p className="mt-1 text-xs text-zinc-500">
            Khi khách đặt đơn mới tại /{shopSlug}, sự kiện <span className="font-mono">order.created</span>{' '}
            sẽ xuất hiện ngay tại đây.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const isExpanded = expandedId === item.notificationId;
            const jsonText = JSON.stringify(item.payload, null, 2);
            const busy = busyId === item.notificationId;

            return (
              <div
                key={item.notificationId}
                className="rounded-xl border border-zinc-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId((prev) =>
                      prev === item.notificationId ? null : item.notificationId
                    )
                  }
                  className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-zinc-50/70"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      <span className="font-mono text-sm font-bold text-zinc-900">
                        {item.payload.order_code}
                      </span>
                      <span aria-hidden="true" className="text-zinc-300">
                        ·
                      </span>
                      <span className={`text-xs font-semibold ${DELIVERY_STATUS_COLORS[item.deliveryStatus]}`}>
                        {DELIVERY_STATUS_LABELS[item.deliveryStatus]}
                      </span>
                      <span aria-hidden="true" className="text-zinc-300">
                        ·
                      </span>
                      <span className="font-mono text-xs text-zinc-500">{item.notificationId}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {item.payload.customer_name} · {item.payload.phone_or_contact} ·{' '}
                      {item.payload.items_summary}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-xs tabular-nums text-zinc-500">
                      retry: {item.retryCount}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-zinc-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-zinc-400" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="space-y-3 border-t border-zinc-200 px-4 py-4">
                    {item.lastError && (
                      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        Lỗi gần nhất: {item.lastError}
                      </p>
                    )}

                    <pre className="max-h-72 overflow-x-auto overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 font-mono text-xs leading-relaxed text-zinc-800">
                      {jsonText}
                    </pre>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopy(jsonText, 'agent_payload JSON')}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy JSON</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleRetry(item.notificationId)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
                        >
                          <Radio className="h-3.5 w-3.5" />
                          <span>Đẩy lại realtime</span>
                        </button>
                        {item.deliveryStatus !== 'acked' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleAck(item.notificationId)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-40"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Xác nhận (Ack)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
