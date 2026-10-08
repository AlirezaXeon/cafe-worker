import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signToken,
  verifyToken,
  base64urlEncode,
  base64urlDecode,
  base64urlDecodeToString,
  requireAdmin,
} from "../src/middleware/adminAuth.js";

const SECRET = "test-super-secret-key-1234567890123456";

test("base64url handles unicode and padding correctly", () => {
  const original = "کافه روشن ☕ Cafe Roshan";
  const encoded = base64urlEncode(original);
  assert.equal(encoded.includes("+"), false);
  assert.equal(encoded.includes("/"), false);
  assert.equal(encoded.includes("="), false);
  const decoded = base64urlDecodeToString(encoded);
  assert.equal(decoded, original);
});

test("signToken and verifyToken roundtrip succeeds", async () => {
  const token = await signToken({ note: "تست" }, SECRET, "1");
  const payload = await verifyToken(token, SECRET, "1");
  assert.ok(payload);
  assert.equal(payload.role, "admin");
  assert.equal(payload.ver, "1");
  assert.equal(payload.note, "تست");
  assert.ok(typeof payload.jti === "string");
  assert.ok(typeof payload.exp === "number");
});

test("verifyToken rejects tampered token", async () => {
  const token = await signToken({}, SECRET, "1");
  const parts = token.split(".");
  // تغییر یک کاراکتر از پی‌لود
  const tamperedPayload = base64urlEncode(JSON.stringify({ role: "admin", hacked: true }));
  const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

  const res = await verifyToken(tamperedToken, SECRET, "1");
  assert.equal(res, null);
});

test("verifyToken rejects expired token", async () => {
  const pastExp = Math.floor(Date.now() / 1000) - 60; // ۶۰ ثانیه قبل
  const token = await signToken({ exp: pastExp }, SECRET, "1");
  const res = await verifyToken(token, SECRET, "1");
  assert.equal(res, null);
});

test("verifyToken rejects token with wrong version (revocation)", async () => {
  const token = await signToken({}, SECRET, "1");
  // اگر سرور نسخه را به ۲ ارتقا دهد
  const res = await verifyToken(token, SECRET, "2");
  assert.equal(res, null);
});

test("verifyToken rejects token with non-admin role", async () => {
  const token = await signToken({ role: "customer" }, SECRET, "1");
  const res = await verifyToken(token, SECRET, "1");
  assert.equal(res, null);
});

test("requireAdmin accepts valid Authorization Bearer header", async () => {
  const token = await signToken({}, SECRET, "1");
  const req = new Request("https://x.test/admin/api/stats", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const res = await requireAdmin(req, { JWT_SECRET: SECRET, TOKEN_VERSION: "1" });
  assert.ok(res);
  assert.equal(res.role, "admin");
});

test("requireAdmin accepts valid admin_token cookie", async () => {
  const token = await signToken({}, SECRET, "1");
  const req = new Request("https://x.test/admin/api/stats", {
    headers: { Cookie: `admin_token=${token}; other=123` },
  });
  const res = await requireAdmin(req, { JWT_SECRET: SECRET, TOKEN_VERSION: "1" });
  assert.ok(res);
  assert.equal(res.role, "admin");
});

test("requireAdmin enforces CSRF check on state-changing requests with mismatched Origin", async () => {
  const token = await signToken({}, SECRET, "1");
  const req = new Request("https://x.test/admin/api/products", {
    method: "POST",
    headers: {
      Cookie: `admin_token=${token}`,
      Origin: "https://evil.attacker.com",
    },
  });
  const res = await requireAdmin(req, { JWT_SECRET: SECRET, TOKEN_VERSION: "1" });
  assert.equal(res, null); // رد درخواست نامعتبر
});
