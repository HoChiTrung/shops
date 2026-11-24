import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser, UserRole } from '../src/shared/types.ts';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Use env signing key if provided, otherwise generate a strong ephemeral key in memory
const TOKEN_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(keyHex, 'hex');
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

export interface TokenPayload {
  sub: string;
  email: string;
  displayName: string;
  role: UserRole;
  shopId: string | null;
  exp: number;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function signSegment(segment: string): string {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(segment)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function createAccessToken(user: AuthUser): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    shopId: user.shopId,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = signSegment(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expectedSig = signSegment(`${header}.${body}`);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as TokenPayload;
    if (!parsed.sub || !parsed.role || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  auth?: TokenPayload;
}

let activeUserResolver: ((userId: string) => AuthUser | null) | null = null;

export function setActiveUserResolver(resolver: (userId: string) => AuthUser | null) {
  activeUserResolver = resolver;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    return;
  }
  if (activeUserResolver) {
    const liveUser = activeUserResolver(payload.sub);
    if (!liveUser || liveUser.role !== payload.role || liveUser.shopId !== payload.shopId) {
      res.status(401).json({ error: 'Tài khoản đã bị thu hồi quyền hoặc thay đổi phân quyền.' });
      return;
    }
  }
  req.auth = payload;
  next();
}

export function requireSuperAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    return;
  }
  if (req.auth.role !== 'super_admin') {
    res.status(403).json({ error: 'Chỉ Chủ hệ thống (Super Admin) mới có quyền truy cập mục này.' });
    return;
  }
  next();
}

export function requireShopAccess(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    return;
  }
  // Hard privacy rule (Spec Section 4 & F9): Super Admin NEVER accesses shop orders/operations
  if (req.auth.role === 'super_admin') {
    res.status(403).json({
      error:
        'Tài khoản Super Admin không được phép xem hay thao tác dữ liệu đơn hàng của từng gian hàng để đảm bảo tính riêng tư kinh doanh.',
    });
    return;
  }
  const targetShopId = req.params.shopId;
  if (!req.auth.shopId || req.auth.shopId !== targetShopId) {
    res.status(403).json({ error: 'Bạn chỉ có quyền quản lý đúng gian hàng được phân công.' });
    return;
  }
  next();
}
