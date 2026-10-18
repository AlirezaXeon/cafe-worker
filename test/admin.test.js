import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAdminAPI } from "../src/handlers/admin.js";
import { signToken } from "../src/middleware/adminAuth.js";
import { listOrders, getOrdersSummary } from "../src/data/orders.js";

const JWT_SECRET = "test-secret-min-32-chars-long-security-key";

async function authHeaders() {
  const token = await signToken({ sub: "admin", role: "admin" }, JWT_SECRET);
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function makeEnv(overrides = {}) {
  const categories = overrides.categories || new Map([["cat1", { id: "cat1", label: "نوشیدنی", image: null }]]);
  const products = overrides.products || new Map();
  const siteSettings = overrides.siteSettings || new Map();
  const kv = new Map();
  const botState = new Map();

  const env = {
    JWT_SECRET,
    ADMIN_PASSWORD: "test-admin-password",
    PRODUCTS_KV: {
      get: async (k) => kv.get(k) || null,
      put: async (k, v) => kv.set(k, v),
      delete: async (k) => kv.delete(k),
    },
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => {
            if (/SELECT.*FROM categories/.test(sql)) {
              return { results: Array.from(categories.values()) };
            }
            if (/SELECT.*FROM products WHERE category = \?/.test(sql)) {
              const catId = args[0];
              const list = Array.from(products.values()).filter((p) => p.category === catId);
              return { results: list };
            }
            if (/SELECT.*FROM products/.test(sql)) {
              return { results: Array.from(products.values()) };
            }
            if (/SELECT.*FROM site_settings/.test(sql)) {
              return { results: Array.from(siteSettings.entries()).map(([key, value]) => ({ key, value })) };
            }
            return { results: [] };
          },
          first: async (col) => {
            if (/SELECT.*FROM categories WHERE id = \?/.test(sql)) {
              return categories.get(args[0]) || null;
            }
            if (/SELECT.*FROM products WHERE id = \?/.test(sql)) {
              return products.get(args[0]) || null;
            }
            if (/SELECT COUNT\(\*\) AS c FROM products WHERE category = \?/.test(sql)) {
              const count = Array.from(products.values()).filter((p) => p.category === args[0]).length;
              return { c: count };
            }
            if (/SELECT COUNT\(\*\) AS c FROM orders WHERE status = 'pending'/.test(sql)) {
              return { c: overrides.pendingCount ?? 3 };
            }
            if (/SELECT COALESCE\(MAX\(id\), 0\) AS max_id FROM orders/.test(sql)) {
              return { max_id: overrides.latestId ?? 1042 };
            }
            if (/SELECT value, expires_at FROM bot_state/.test(sql)) {
              const r = botState.get(args[0]);
              return r ? { ...r } : null;
            }
            return null;
          },
          run: async () => {
            if (/INSERT INTO products/.test(sql)) {
              const [id, category, name, note, price, original_price, image, available] = args;
              products.set(id, { id, category, name, note, price, original_price, image, available });
              return { meta: { last_row_id: 1 } };
            }
            if (/UPDATE products/.test(sql)) {
              const [name, category, note, price, original_price, image, available, id] = args;
              products.set(id, { id, category, name, note, price, original_price, image, available });
              return { meta: { changes: 1 } };
            }
            if (/DELETE FROM products WHERE id = \?/.test(sql)) {
              products.delete(args[0]);
              return { meta: { changes: 1 } };
            }
            if (/DELETE FROM categories WHERE id = \?/.test(sql)) {
              categories.delete(args[0]);
              return { meta: { changes: 1 } };
            }
            if (/INSERT OR REPLACE INTO site_settings/.test(sql)) {
              const [key, value] = args;
              siteSettings.set(key, value);
              return { meta: { changes: 1 } };
            }
            if (/INSERT OR REPLACE INTO bot_state/.test(sql)) {
              const [key, value, expires_at] = args;
              botState.set(key, { value, expires_at });
              return { meta: { changes: 1 } };
            }
            if (/DELETE FROM bot_state/.test(sql)) {
              botState.delete(args[0]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        }),
      }),
    },
  };
  return { env, products, categories, siteSettings, botState };
}

test("POST /products defaults available to 1 when omitted", async () => {
  const { env, products } = makeEnv();
  const headers = await authHeaders();

  const req = new Request("https://x.test/admin/api/products", {
    method: "POST",
    headers,
    body: JSON.stringify({
      category: "cat1",
      name: "اسپرسو دبل",
      price: 90000,
      // available is omitted
    }),
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);

  const saved = products.get(data.id);
  assert.equal(saved.available, 1, "available باید به طور پیش‌فرض ۱ باشد");
});

test("POST /products rejects unknown category with 400 and Persian message", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();

  const req = new Request("https://x.test/admin/api/products", {
    method: "POST",
    headers,
    body: JSON.stringify({
      category: "unknown-cat-id",
      name: "چای سبز",
      price: 50000,
    }),
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes("دسته‌بندی"));
});

test("PUT /products/:id defaults available to existing value when omitted", async () => {
  const existingProduct = {
    id: "p100",
    category: "cat1",
    name: "لته",
    note: "",
    price: 95000,
    available: 0, // قبلاً ناموجود بوده
  };
  const { env, products } = makeEnv({ products: new Map([["p100", existingProduct]]) });
  const headers = await authHeaders();

  const req = new Request("https://x.test/admin/api/products/p100", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      category: "cat1",
      name: "لته با شیر بادام",
      price: 110000,
      // available is omitted
    }),
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 200);

  const updated = products.get("p100");
  assert.equal(updated.available, 0, "available باید مقدار قبلی (۰) را حفظ کند");
});

test("DELETE /products/:id returns 404 when product does not exist", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();

  const req = new Request("https://x.test/admin/api/products/non-existent-id", {
    method: "DELETE",
    headers,
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(data.error.includes("پیدا نشد"));
});

test("DELETE /categories/:id returns 404 when category does not exist", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();

  const req = new Request("https://x.test/admin/api/categories/non-existent-cat", {
    method: "DELETE",
    headers,
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(data.error.includes("پیدا نشد"));
});

test("listOrders handles corrupted JSON items without throwing and supports beforeId pagination", async () => {
  const rows = [
    { id: 10, table_number: "1", items: JSON.stringify([{ id: "p1", name: "اسپرسو", price: 50000, quantity: 1 }]), total: 50000, status: "pending" },
    { id: 9, table_number: "2", items: "{corrupted-invalid-json", total: 40000, status: "pending" },
    { id: 8, table_number: "3", items: JSON.stringify([{ id: "p2", name: "کیک", price: 60000, quantity: 1 }]), total: 60000, status: "confirmed" },
  ];

  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => {
            let filtered = rows;
            if (/WHERE id < \?/.test(sql)) {
              const beforeId = args[0];
              filtered = filtered.filter((r) => r.id < beforeId);
            }
            return { results: filtered };
          },
        }),
      }),
    },
  };

  // ۱. بررسی ردیف‌های خراب: ردیف ۹ بدون خطا با items خالی برمی‌گردد
  const list = await listOrders(env);
  assert.equal(list.length, 3);
  assert.equal(list[0].items[0].name, "اسپرسو");
  assert.deepEqual(list[1].items, [], "ردیف با JSON نامعتبر باید آرایه خالی بدون پرتاب خطا باشد");
  assert.equal(list[2].items[0].name, "کیک");

  // ۲. صفحه‌بندی نشانگر (beforeId): ردیف‌های قبل از شناسه ۱۰
  const paginated = await listOrders(env, { beforeId: 10 });
  assert.equal(paginated.length, 2);
  assert.equal(paginated[0].id, 9);
  assert.equal(paginated[1].id, 8);
});

test("GET /admin/api/orders/summary rejects unauthenticated request with 401", async () => {
  const { env } = makeEnv();
  const req = new Request("https://cafe-roshan.workers.dev/admin/api/orders/summary", {
    method: "GET",
  });
  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 401);
});

test("GET /admin/api/orders/summary returns pending count and latestId with no-store cache control", async () => {
  const { env } = makeEnv({ pendingCount: 5, latestId: 1050 });
  const headers = await authHeaders();
  const req = new Request("https://cafe-roshan.workers.dev/admin/api/orders/summary", {
    method: "GET",
    headers,
  });
  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const data = await res.json();
  assert.deepEqual(data, { pending: 5, latestId: 1050 });
});

test("getOrdersSummary returns exact pending count with 60 orders (not capped at 50)", async () => {
  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => {
            if (/SELECT COUNT\(\*\) AS c FROM orders WHERE status = 'pending'/.test(sql)) {
              return { c: 60 };
            }
            if (/SELECT COALESCE\(MAX\(id\), 0\) AS max_id FROM orders/.test(sql)) {
              return { max_id: 1099 };
            }
            return null;
          },
        }),
      }),
    },
  };
  const summary = await getOrdersSummary(env);
  assert.equal(summary.pending, 60, "تعداد سفارش‌های در انتظار نباید سقف ۵۰ داشته باشد");
  assert.equal(summary.latestId, 1099);
});

test("listOrders omits sensitive columns (ip_hash, request_id, tg_messages)", async () => {
  const row = {
    id: 1,
    table_number: "5",
    items: JSON.stringify([{ name: "چای", price: 30000, quantity: 1 }]),
    total: 30000,
    status: "pending",
    created_at: "2026-10-08 12:00:00",
    request_id: "secret-req-id-123",
    ip_hash: "secret-ip-hash-abc",
    tg_messages: JSON.stringify({ entries: [] }),
    tg_notified: 1,
  };

  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [row] }),
        }),
      }),
    },
  };

  const [order] = await listOrders(env);
  assert.equal(order.id, 1);
  assert.equal(order.table_number, "5");
  assert.equal(order.ip_hash, undefined, "ip_hash نباید به کلاینت وب ارسال شود");
  assert.equal(order.request_id, undefined, "request_id نباید به کلاینت وب ارسال شود");
  assert.equal(order.tg_messages, undefined, "tg_messages نباید به کلاینت وب ارسال شود");
  assert.equal(order.tg_notified, undefined, "tg_notified نباید به کلاینت وب ارسال شود");
});

test("POST /admin/api/login returns 429 when failure threshold is reached", async () => {
  const { env, botState } = makeEnv();
  const testIp = "192.168.1.50";
  botState.set(`loginfail:${testIp}`, { value: "15", expires_at: null });

  const req = new Request("https://x.test/admin/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": testIp,
    },
    body: JSON.stringify({ password: "wrong-password" }),
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 429);
  const data = await res.json();
  assert.equal(data.error, "تعداد تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر امتحان کنید.");
});

test("POST /admin/api/login clears failure counter on successful login", async () => {
  const { env, botState } = makeEnv();
  const testIp = "192.168.1.51";
  botState.set(`loginfail:${testIp}`, { value: "3", expires_at: null });

  const req = new Request("https://x.test/admin/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": testIp,
    },
    body: JSON.stringify({ password: "test-admin-password" }),
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.token);

  assert.equal(botState.has(`loginfail:${testIp}`), false);
});

test("POST /admin/api/upload rejects PNG bytes named .webp with 400", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();
  // Remove content-type so fetch sets multipart boundary automatically
  delete headers["Content-Type"];

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const fd = new FormData();
  fd.append("file", new File([pngBytes], "fake.webp", { type: "image/webp" }));

  const req = new Request("https://x.test/admin/api/upload", {
    method: "POST",
    headers,
    body: fd,
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, "فرمت فایل با پسوند ارسالی همخوانی ندارد");
});

test("POST /admin/api/upload rejects text file named .jpg with 400", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();
  delete headers["Content-Type"];

  const textBytes = new TextEncoder().encode("not an image at all, just text");
  const fd = new FormData();
  fd.append("file", new File([textBytes], "malicious.jpg", { type: "image/jpeg" }));

  const req = new Request("https://x.test/admin/api/upload", {
    method: "POST",
    headers,
    body: fd,
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, "محتوای تصویر نامعتبر یا خراب است");
});

test("POST /admin/api/upload accepts valid JPEG, PNG, WEBP and derives correct extension", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();
  delete headers["Content-Type"];

  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const fdJpeg = new FormData();
  fdJpeg.append("file", new File([jpegBytes], "photo.jpg", { type: "image/jpeg" }));

  const resJpeg = await handleAdminAPI(new Request("https://x.test/admin/api/upload", {
    method: "POST",
    headers,
    body: fdJpeg,
  }), env);
  assert.equal(resJpeg.status, 200);
  const dataJpeg = await resJpeg.json();
  assert.match(dataJpeg.url, /^\/images\/p\d+\.jpg$/);

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const fdPng = new FormData();
  fdPng.append("file", new File([pngBytes], "photo.png", { type: "image/png" }));

  const resPng = await handleAdminAPI(new Request("https://x.test/admin/api/upload", {
    method: "POST",
    headers,
    body: fdPng,
  }), env);
  assert.equal(resPng.status, 200);
  const dataPng = await resPng.json();
  assert.match(dataPng.url, /^\/images\/p\d+\.png$/);

  const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  const fdWebp = new FormData();
  fdWebp.append("file", new File([webpBytes], "photo.webp", { type: "image/webp" }));

  const resWebp = await handleAdminAPI(new Request("https://x.test/admin/api/upload", {
    method: "POST",
    headers,
    body: fdWebp,
  }), env);
  assert.equal(resWebp.status, 200);
  const dataWebp = await resWebp.json();
  assert.match(dataWebp.url, /^\/images\/p\d+\.webp$/);
});

test("POST /admin/api/site/logo rejects text file named .jpg with 400", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();
  delete headers["Content-Type"];

  const textBytes = new TextEncoder().encode("plain text pretending to be a logo");
  const fd = new FormData();
  fd.append("file", new File([textBytes], "logo.jpg", { type: "image/jpeg" }));

  const req = new Request("https://x.test/admin/api/site/logo", {
    method: "POST",
    headers,
    body: fd,
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, "محتوای تصویر نامعتبر یا خراب است");
});

test("POST /admin/api/site/logo rejects PNG bytes named .webp with 400", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();
  delete headers["Content-Type"];

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const fd = new FormData();
  fd.append("file", new File([pngBytes], "logo.webp", { type: "image/webp" }));

  const req = new Request("https://x.test/admin/api/site/logo", {
    method: "POST",
    headers,
    body: fd,
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, "فرمت فایل با پسوند ارسالی همخوانی ندارد");
});

test("POST /admin/api/site/logo accepts valid JPEG, saves image and updates site settings", async () => {
  const { env, siteSettings } = makeEnv();
  const headers = await authHeaders();
  delete headers["Content-Type"];

  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const fd = new FormData();
  fd.append("file", new File([jpegBytes], "logo.jpg", { type: "image/jpeg" }));

  const req = new Request("https://x.test/admin/api/site/logo", {
    method: "POST",
    headers,
    body: fd,
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.match(data.url, /^\/images\/site-logo-\d+\.jpg$/);
  assert.match(siteSettings.get("logo"), /^\/images\/site-logo-\d+\.jpg$/);
});

test("POST /admin/api/site/cover accepts valid JPEG and updates cover in site settings", async () => {
  const { env, siteSettings } = makeEnv();
  const headers = await authHeaders();
  delete headers["Content-Type"];

  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const fd = new FormData();
  fd.append("file", new File([jpegBytes], "cover.jpg", { type: "image/jpeg" }));

  const req = new Request("https://x.test/admin/api/site/cover", {
    method: "POST",
    headers,
    body: fd,
  });

  const res = await handleAdminAPI(req, env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.match(data.url, /^\/images\/site-cover-\d+\.jpg$/);
  assert.match(siteSettings.get("cover"), /^\/images\/site-cover-\d+\.jpg$/);
});test("GET /admin/api/table-qr-links returns list of table URLs with or without signature", async () => {
  const { env } = makeEnv();
  const headers = await authHeaders();

  // 1. Without secret
  const res1 = await handleAdminAPI(new Request("https://x.test/admin/api/table-qr-links", {
    method: "GET",
    headers,
  }), env);
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.equal(data1.signingEnabled, false);
  assert.equal(data1.links.length, 20);
  assert.equal(data1.links[0].table, 1);
  assert.equal(data1.links[0].url, "/?t=1");

  // 2. With secret
  env.TABLE_SIGNING_SECRET = "super-secret-key";
  const res2 = await handleAdminAPI(new Request("https://x.test/admin/api/table-qr-links", {
    method: "GET",
    headers,
  }), env);
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  assert.equal(data2.signingEnabled, true);
  assert.equal(data2.links.length, 20);
  assert.equal(data2.links[0].table, 1);
  assert.match(data2.links[0].url, /^\/\?t=1&sig=[a-f0-9]{64}$/);
});

