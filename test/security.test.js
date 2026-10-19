import { test } from "node:test";
import assert from "node:assert/strict";
import { applySecurityHeaders, withSecurityHeaders } from "../src/middleware/security.js";

test("applySecurityHeaders sets standard security headers on general routes", () => {
  const headers = new Headers();
  applySecurityHeaders(headers, "/");

  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()");
  const csp = headers.get("Content-Security-Policy");
  assert.ok(csp?.includes("default-src 'self'"));
  assert.ok(csp?.includes("script-src 'self'"));
  assert.ok(!csp?.includes("script-src 'self' 'unsafe-inline'"), "script-src نباید unsafe-inline داشته باشد");
  assert.equal(headers.get("Content-Security-Policy-Report-Only"), null, "CSP باید enforce باشه نه report-only");
  assert.equal(headers.get("X-Frame-Options"), null);
});

test("applySecurityHeaders sets X-Frame-Options DENY on /admin routes", () => {
  const headers = new Headers();
  applySecurityHeaders(headers, "/admin/index.html");

  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
});

test("withSecurityHeaders preserves status and body while adding headers", async () => {
  const original = new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });

  const modified = withSecurityHeaders(original, "/admin/api/products");
  assert.equal(modified.status, 201);
  assert.equal(modified.headers.get("content-type"), "application/json");
  assert.equal(modified.headers.get("X-Frame-Options"), "DENY");
  assert.equal(modified.headers.get("X-Content-Type-Options"), "nosniff");

  const json = await modified.json();
  assert.deepEqual(json, { ok: true });
});
