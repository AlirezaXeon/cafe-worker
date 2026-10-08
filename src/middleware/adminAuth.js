// src/middleware/adminAuth.js
// احراز هویت توکن‌های ادمین با الگوریتم HMAC SHA-256 و فرمت استاندارد base64url

export function base64urlEncode(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64urlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64urlDecodeToString(str) {
  const bytes = base64urlDecode(str);
  return new TextDecoder().decode(bytes);
}

const enc = (s) => new TextEncoder().encode(s);

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

export async function signToken(payload = {}, secret, version = "1") {
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload = {
    role: 'admin',
    iat: nowSec,
    exp: nowSec + 12 * 3600, // ۱۲ ساعت
    jti: (typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    ver: version,
    ...payload,
  };

  const headerStr = JSON.stringify({ alg: 'HS256', typ: 'JWT' });
  const bodyStr = JSON.stringify(fullPayload);
  const header = base64urlEncode(headerStr);
  const body = base64urlEncode(bodyStr);
  const data = `${header}.${body}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc(data));
  return `${data}.${base64urlEncode(sig)}`;
}

export async function verifyToken(token, secret, expectedVersion = "1") {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(sig),
      enc(`${header}.${body}`)
    );
    if (!valid) return null;

    const payload = JSON.parse(base64urlDecodeToString(body));
    const nowSec = Math.floor(Date.now() / 1000);

    // بررسی تاریخ انقضا (پشتیبانی از ثانیه و میلی‌ثانیه‌ی قدیمی)
    if (payload.exp) {
      const expSec = payload.exp > 1e11 ? Math.floor(payload.exp / 1000) : payload.exp;
      if (nowSec > expSec) return null;
    }

    // بررسی نقش ادمین
    if (payload.role !== 'admin') return null;

    // بررسی نسخه‌ی توکن برای ابطال همگانی سشن‌ها
    if (payload.ver && String(payload.ver) !== String(expectedVersion)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k] = decodeURIComponent(v.join('='));
  }
  return cookies;
}

// Middleware: returns payload if valid, null otherwise
export async function requireAdmin(request, env) {
  const expectedVer = env?.TOKEN_VERSION || "1";
  let token = null;
  let isCookieAuth = false;

  // 1. بررسی هدر Authorization
  const auth = request.headers.get('Authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    token = auth.slice(7).trim();
  }

  // 2. بررسی کوکی HttpOnly
  if (!token) {
    const cookies = parseCookies(request.headers.get('Cookie'));
    if (cookies.admin_token) {
      token = cookies.admin_token;
      isCookieAuth = true;
    }
  }

  if (!token) return null;

  const payload = await verifyToken(token, env.JWT_SECRET, expectedVer);
  if (!payload) return null;

  // محافظت CSRF برای متدهای تغییردهنده‌ی وضعیت در صورت احراز هویت با کوکی
  const method = request.method?.toUpperCase();
  if (isCookieAuth && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const origin = request.headers.get('Origin');
    if (origin) {
      const reqOrigin = new URL(request.url).origin;
      if (origin !== reqOrigin) return null;
    }
  }

  return payload;
}
