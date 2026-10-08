import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAdminAPI } from "../src/handlers/admin.js";
import { signToken } from "../src/middleware/adminAuth.js";
import { listOrders } from "../src/data/orders.js";

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
  const kv = new Map();

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
            return { meta: { changes: 1 } };
          },
        }),
      }),
    },
  };
  return { env, products, categories };
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
