// src/middleware/security.js
// تنظیم هدرهای امنیتی برای پاسخ‌های سرور و پنل مدیریت

export const CSP_REPORT_ONLY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';";

export function applySecurityHeaders(headers, pathname = "/") {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY);

  if (pathname.startsWith("/admin")) {
    headers.set("X-Frame-Options", "DENY");
  }
  return headers;
}

export function withSecurityHeaders(response, pathname = "/") {
  if (!response) return response;
  const newHeaders = new Headers(response.headers);
  applySecurityHeaders(newHeaders, pathname);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
