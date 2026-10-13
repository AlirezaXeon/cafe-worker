import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("global error handler catches errors on /api/* and returns generic Persian JSON 500", async (t) => {
  // Capture console.error to keep test output clean and verify logging
  const originalError = console.error;
  let loggedError = null;
  console.error = (...args) => {
    loggedError = args;
  };
  t.after(() => {
    console.error = originalError;
  });

  const request = new Request("https://example.com/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      table: "1",
      items: [{ id: "1", quantity: 1 }],
    }),
  });

  // Broken env missing DB and other properties to trigger unhandled exception in handleOrdersAPI
  const brokenEnv = {
    ENFORCE_ORDER_HOURS: "0",
    DB: {
      prepare() {
        throw new Error("D1 connection failed (secret internal db stack trace)");
      },
    },
  };

  const response = await worker.fetch(request, brokenEnv, { waitUntil() {} });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const bodyText = await response.text();
  assert.doesNotMatch(bodyText, /secret internal db stack trace/);
  assert.doesNotMatch(bodyText, /D1 connection failed/);
  assert.doesNotMatch(bodyText, /stack/i);

  const json = JSON.parse(bodyText);
  assert.equal(json.error, "خطای داخلی سرور رخ داد. لطفاً دوباره امتحان کنید.");
  assert.ok(loggedError, "console.error should have been called");
  assert.match(loggedError[0], /POST \/api\/orders/);
});

test("global error handler catches errors on /admin/api/* and applies admin security headers", async (t) => {
  const originalError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalError;
  });

  const request = new Request("https://example.com/admin/api/products", {
    method: "GET",
  });

  const brokenEnv = null; // triggers TypeError when accessing env

  const response = await worker.fetch(request, brokenEnv, { waitUntil() {} });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const json = await response.json();
  assert.equal(json.error, "خطای داخلی سرور رخ داد. لطفاً دوباره امتحان کنید.");
  assert.equal(json.stack, undefined);
});

test("global error handler returns plain 500 for non-API routes on unhandled exception", async (t) => {
  const originalError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalError;
  });

  const request = new Request("https://example.com/", {
    method: "GET",
  });

  const brokenEnv = {
    ASSETS: {
      fetch() {
        throw new Error("Asset fetcher failure");
      },
    },
  };

  const response = await worker.fetch(request, brokenEnv, { waitUntil() {} });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const text = await response.text();
  assert.equal(text, "Internal Server Error");
});

test("robots.txt و sitemap.xml آدرس رو از دامنه‌ی درخواست می‌سازن", async () => {
  const env = {}; // بدون SITE_URL

  const robots = await worker.fetch(new Request("https://cafe.example.ir/robots.txt"), env, { waitUntil() {} });
  assert.equal(robots.status, 200);
  const robotsText = await robots.text();
  assert.match(robotsText, /Disallow: \/admin\//);
  assert.match(robotsText, /Sitemap: https:\/\/cafe\.example\.ir\/sitemap\.xml/);

  const sitemap = await worker.fetch(new Request("https://cafe.example.ir/sitemap.xml"), env, { waitUntil() {} });
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type"), /application\/xml/);
  assert.match(await sitemap.text(), /<loc>https:\/\/cafe\.example\.ir\/<\/loc>/);
});

test("SITE_URL (اگه ست باشه) بر دامنه‌ی درخواست اولویت داره و اسلش آخرش حذف میشه", async () => {
  const env = { SITE_URL: "https://cafe.example.ir/" };

  const robots = await worker.fetch(new Request("https://cafe-roshan.workers.dev/robots.txt"), env, { waitUntil() {} });
  assert.match(await robots.text(), /Sitemap: https:\/\/cafe\.example\.ir\/sitemap\.xml/);

  const sitemap = await worker.fetch(new Request("https://cafe-roshan.workers.dev/sitemap.xml"), env, { waitUntil() {} });
  assert.match(await sitemap.text(), /<loc>https:\/\/cafe\.example\.ir\/<\/loc>/);
});
