import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentOrderPayload } from '../src/shared/types.ts';

interface SseClient {
  id: string;
  shopSlug: string;
  res: Response;
}

interface WsClient {
  id: string;
  shopSlug: string;
  socket: WebSocket;
}

type AckHandler = (shopSlug: string, notificationId: string) => Promise<boolean>;
type AuthVerifier = (shopSlug: string, req: IncomingMessage, apiKey: string | null) => boolean;

class AgentRealtimeHub {
  private sseClients = new Map<string, SseClient>();
  private wsClients = new Map<string, WsClient>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wss: WebSocketServer | null = null;

  constructor() {
    this.heartbeatTimer = setInterval(() => {
      for (const [id, client] of this.sseClients.entries()) {
        try {
          client.res.write(`: ping ${Date.now()}\n\n`);
        } catch {
          this.sseClients.delete(id);
        }
      }
      for (const [id, client] of this.wsClients.entries()) {
        if (client.socket.readyState === WebSocket.OPEN) {
          try {
            client.socket.ping();
          } catch {
            this.wsClients.delete(id);
          }
        } else {
          this.wsClients.delete(id);
        }
      }
    }, 25000);
    this.heartbeatTimer.unref?.();
  }

  attachWebSocketServer(
    server: HttpServer,
    verifyAuth: AuthVerifier,
    onAck: AckHandler
  ): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const host = req.headers.host || 'localhost:3000';
      let url: URL;
      try {
        url = new URL(req.url || '/', `http://${host}`);
      } catch {
        socket.destroy();
        return;
      }

      if (url.pathname !== '/ws/agent') {
        // Leave non-agent upgrade paths untouched
        return;
      }

      const shopSlug = (url.searchParams.get('shop_slug') || '').trim().toLowerCase();
      const apiKey =
        url.searchParams.get('api_key') ||
        (typeof req.headers['x-agent-key'] === 'string' ? req.headers['x-agent-key'] : null) ||
        (typeof req.headers.authorization === 'string' &&
        req.headers.authorization.startsWith('Bearer ')
          ? req.headers.authorization.slice('Bearer '.length).trim()
          : null);

      if (!shopSlug || !verifyAuth(shopSlug, req, apiKey)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        const clientId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.wsClients.set(clientId, { id: clientId, shopSlug, socket: ws });

        ws.send(
          JSON.stringify({
            event: 'agent.connected',
            shop_slug: shopSlug,
            transport: 'websocket',
            connected_at: new Date().toISOString(),
          })
        );

        ws.on('message', async (raw) => {
          try {
            const msg = JSON.parse(raw.toString('utf8')) as {
              type?: string;
              notification_id?: string;
            };
            if (msg.type === 'ack' && typeof msg.notification_id === 'string') {
              const ok = await onAck(shopSlug, msg.notification_id.trim());
              ws.send(
                JSON.stringify({
                  event: 'notification.ack_result',
                  notification_id: msg.notification_id.trim(),
                  acked: ok,
                })
              );
            } else if (msg.type === 'ping') {
              ws.send(JSON.stringify({ event: 'pong', ts: Date.now() }));
            }
          } catch {
            // Ignore malformed client frames
          }
        });

        ws.on('close', () => {
          this.wsClients.delete(clientId);
        });
        ws.on('error', () => {
          this.wsClients.delete(clientId);
        });
      });
    });
  }

  registerSseClient(shopSlug: string, res: Response): string {
    const cleanSlug = shopSlug.trim().toLowerCase();
    const clientId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    this.sseClients.set(clientId, { id: clientId, shopSlug: cleanSlug, res });

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        event: 'agent.connected',
        shop_slug: cleanSlug,
        transport: 'sse',
        connected_at: new Date().toISOString(),
      })}\n\n`
    );

    res.on('close', () => {
      this.sseClients.delete(clientId);
    });

    return clientId;
  }

  getConnectedCount(shopSlug: string): { sse: number; ws: number; total: number } {
    const clean = shopSlug.trim().toLowerCase();
    let sse = 0;
    let ws = 0;
    for (const c of this.sseClients.values()) {
      if (c.shopSlug === clean) sse += 1;
    }
    for (const c of this.wsClients.values()) {
      if (c.shopSlug === clean && c.socket.readyState === WebSocket.OPEN) ws += 1;
    }
    return { sse, ws, total: sse + ws };
  }

  /**
   * Push standardized agent_payload to all connected SSE and WebSocket Agents for shop_slug.
   * Returns number of live recipients that accepted the frame.
   */
  publishOrderCreated(payload: AgentOrderPayload): number {
    const cleanSlug = payload.shop_slug.trim().toLowerCase();
    const serialized = JSON.stringify(payload);
    let deliveredCount = 0;

    for (const [id, client] of this.sseClients.entries()) {
      if (client.shopSlug !== cleanSlug) continue;
      try {
        client.res.write(
          `id: ${payload.notification_id}\nevent: ${payload.event}\ndata: ${serialized}\n\n`
        );
        deliveredCount += 1;
      } catch {
        this.sseClients.delete(id);
      }
    }

    for (const [id, client] of this.wsClients.entries()) {
      if (client.shopSlug !== cleanSlug) continue;
      if (client.socket.readyState !== WebSocket.OPEN) {
        this.wsClients.delete(id);
        continue;
      }
      try {
        client.socket.send(serialized);
        deliveredCount += 1;
      } catch {
        this.wsClients.delete(id);
      }
    }

    return deliveredCount;
  }
}

export const agentHub = new AgentRealtimeHub();
