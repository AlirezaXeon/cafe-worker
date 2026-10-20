import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleProductAvailability } from "../src/data/products.js";
import { getSiteConfig, setSiteSetting } from "../src/data/site.js";
import { clearMemo, SITE_CACHE_KEY } from "../src/data/cache.js";

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

function makeSiteDb(d1Store) {
  return {
    prepare: (sql) => ({
      bind: (...args) => ({
        all: async () => {
          const results = Array.from(d1Store.entries()).map(([key, value]) => ({ key, value }));
          return { results };
        },
        first: async () => {
          if (/SELECT COUNT/.test(sql)) {
            return { c: d1Store.size };
          }
          return null;
        },
        run: async () => {
          const [k, v] = args;
          if (/INSERT OR IGNORE/.test(sql)) {
            if (!d1Store.has(k)) d1Store.set(k, v);
            return { meta: { changes: 1 } };
          }
          d1Store.set(k, v);
          return { meta: { changes: 1 } };
        },
      }),
      all: async () => {
        const results = Array.from(d1Store.entries()).map(([key, value]) => ({ key, value }));
        return { results };
      },
      first: async () => {
        if (/SELECT COUNT/.test(sql)) {
          return { c: d1Store.size };
        }
        return null;
      },
    }),
    batch: async (statements) => {
      for (const stmt of statements) {
        await stmt.run();
      }
      return [];
    },
  };
}

test("site_settings reads from D1 and falls back to KV if D1 empty", async () => {
  const d1Store = new Map();
  const kvStore = new Map([
    ["site:config", JSON.stringify({ logo: "/images/kv-logo.png", cover: null })],
  ]);

  const env = {
    DB: makeSiteDb(d1Store),
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

test("seedFromKvIfEmpty: KV دارای logo و cover است؛ فقط logo عوض می‌شود؛ cover در getSiteConfig همچنان وجود دارد", async () => {
  const d1Store = new Map();
  const kvStore = new Map([
    ["site:config", JSON.stringify({ logo: "/images/old-logo.png", cover: "/images/old-cover.png" })],
  ]);

  const env = {
    DB: makeSiteDb(d1Store),
    PRODUCTS_KV: {
      get: async (k) => kvStore.get(k) || null,
      put: async (k, v) => kvStore.set(k, v),
      delete: async (k) => kvStore.delete(k),
    },
  };

  // فقط لوگو تغییر می‌کند
  await setSiteSetting(env, "logo", "/images/new-logo.png");

  // بررسی می‌کنیم که cover هم از KV به D1 کپی شده و پاک نشده است
  const cfg = await getSiteConfig(env);
  assert.equal(cfg.logo, "/images/new-logo.png");
  assert.equal(cfg.cover, "/images/old-cover.png");
});

test("getSiteConfig throws on transient D1 error (e.g. connection failed) to prevent deleting active assets", async () => {
  clearMemo(SITE_CACHE_KEY);
  const env = {
    DB: {
      prepare: () => ({
        all: async () => {
          throw new Error("D1_ERROR: connection failed");
        },
      }),
    },
    PRODUCTS_KV: {
      get: async () => JSON.stringify({ logo: "/images/kv-logo.png" }),
    },
  };

  await assert.rejects(
    async () => {
      await getSiteConfig(env);
    },
    /D1_ERROR: connection failed/
  );
});

test("getSiteConfig falls back to KV when error is 'no such table'", async () => {
  clearMemo(SITE_CACHE_KEY);
  const env = {
    DB: {
      prepare: () => ({
        all: async () => {
          throw new Error("D1_ERROR: no such table: site_settings");
        },
      }),
    },
    PRODUCTS_KV: {
      get: async (k) => (k === "site:config" ? JSON.stringify({ logo: "/images/legacy-kv-logo.png" }) : null),
    },
  };

  const cfg = await getSiteConfig(env);
  assert.equal(cfg.logo, "/images/legacy-kv-logo.png");
});

test("getSiteConfig: signingEnabled و signingSecretPresent در ترکیب‌های سکرت/تنظیم", async () => {
  // ۱. سکرت دارد، تنظیم ندارد -> signingEnabled: true, signingSecretPresent: true
  clearMemo(SITE_CACHE_KEY);
  const d1_1 = new Map();
  const env1 = { DB: makeSiteDb(d1_1), TABLE_SIGNING_SECRET: "secret123" };
  const cfg1 = await getSiteConfig(env1);
  assert.equal(cfg1.signingSecretPresent, true);
  assert.equal(cfg1.signingEnabled, true);

  // ۲. سکرت دارد، تنظیم '0' -> signingEnabled: false, signingSecretPresent: true
  clearMemo(SITE_CACHE_KEY);
  const d1_2 = new Map([["requireTableSig", "0"]]);
  const env2 = { DB: makeSiteDb(d1_2), TABLE_SIGNING_SECRET: "secret123" };
  const cfg2 = await getSiteConfig(env2);
  assert.equal(cfg2.signingSecretPresent, true);
  assert.equal(cfg2.signingEnabled, false);

  // ۳. سکرت دارد، تنظیم '1' -> signingEnabled: true, signingSecretPresent: true
  clearMemo(SITE_CACHE_KEY);
  const d1_3 = new Map([["requireTableSig", "1"]]);
  const env3 = { DB: makeSiteDb(d1_3), TABLE_SIGNING_SECRET: "secret123" };
  const cfg3 = await getSiteConfig(env3);
  assert.equal(cfg3.signingSecretPresent, true);
  assert.equal(cfg3.signingEnabled, true);

  // ۴. سکرت ندارد، تنظیم '1' -> signingEnabled: false, signingSecretPresent: false
  clearMemo(SITE_CACHE_KEY);
  const d1_4 = new Map([["requireTableSig", "1"]]);
  const env4 = { DB: makeSiteDb(d1_4) };
  const cfg4 = await getSiteConfig(env4);
  assert.equal(cfg4.signingSecretPresent, false);
  assert.equal(cfg4.signingEnabled, false);
});


