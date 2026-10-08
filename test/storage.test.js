import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleProductAvailability } from "../src/data/products.js";
import { getSiteConfig, setSiteSetting } from "../src/data/site.js";

test("toggleProductAvailability toggles available atomically using RETURNING", async () => {
  let currentAvailable = 1;
  const env = {
    PRODUCTS_KV: {
      delete: async () => {},
    },
    DB: {
      prepare: (sql) => ({
        bind: (id) => ({
          first: async () => {
            if (id === "p1") {
              currentAvailable = 1 - currentAvailable;
              return { available: currentAvailable };
            }
            return null;
          },
        }),
      }),
    },
  };

  // اول موجود است (1) -> تبدیل به ناموجود (0)
  const res1 = await toggleProductAvailability(env, "p1");
  assert.equal(res1, 0);

  // دوباره می‌زنیم -> تبدیل به موجود (1)
  const res2 = await toggleProductAvailability(env, "p1");
  assert.equal(res2, 1);

  // محصول ناموجود در دیتابیس -> null
  const res3 = await toggleProductAvailability(env, "non-existent");
  assert.equal(res3, null);
});

test("site_settings reads from D1 and falls back to KV if D1 empty", async () => {
  const d1Store = new Map();
  const kvStore = new Map([
    ["site:config", JSON.stringify({ logo: "/images/kv-logo.png", cover: null })],
  ]);

  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => {
            const results = Array.from(d1Store.entries()).map(([key, value]) => ({ key, value }));
            return { results };
          },
          run: async () => {
            const [k, v] = args;
            d1Store.set(k, v);
            return { meta: { changes: 1 } };
          },
        }),
        all: async () => {
          const results = Array.from(d1Store.entries()).map(([key, value]) => ({ key, value }));
          return { results };
        },
      }),
    },
    PRODUCTS_KV: {
      get: async (k) => kvStore.get(k) || null,
      put: async (k, v) => kvStore.set(k, v),
      delete: async (k) => kvStore.delete(k),
    },
  };

  // بار اول: D1 خالی است، از KV می‌خواند
  const cfg1 = await getSiteConfig(env);
  assert.equal(cfg1.logo, "/images/kv-logo.png");
  assert.equal(cfg1.tableCount, 20);

  // ثبت اتمیک تنظیمات جدید در D1
  await setSiteSetting(env, "logo", "/images/d1-logo.png");
  await setSiteSetting(env, "cover", "/images/d1-cover.png");

  // حال باید از D1 خوانده شود
  const cfg2 = await getSiteConfig(env);
  assert.equal(cfg2.logo, "/images/d1-logo.png");
  assert.equal(cfg2.cover, "/images/d1-cover.png");
});
