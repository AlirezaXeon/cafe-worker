import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addCategory, addProduct, getProducts } from "../src/data/products.js";
import { getOrderStatusByPublicId, confirmOrder, getSalesStats } from "../src/data/orders.js";
import { handleOrdersAPI } from "../src/handlers/orders.js";
import { setSiteSetting, getSiteConfig } from "../src/data/site.js";
import { setBotState, getBotState, deleteExpiredBotState } from "../src/data/botState.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createD1Adapter(sqlite) {
  function createStatement(sql, boundArgs = []) {
    return {
      bind(...args) {
        return createStatement(sql, args);
      },
      async all() {
        const stmt = sqlite.prepare(sql);
        const results = stmt.all(...boundArgs);
        return { results };
      },
      async first(col) {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...boundArgs);
        if (!row) return null;
        if (col) return row[col];
        return row;
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        const info = stmt.run(...boundArgs);
        return {
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid),
          },
        };
      },
    };
  }

  return {
    prepare(sql) {
      return createStatement(sql);
    },
    async batch(statements) {
      const results = [];
      for (const s of statements) {
        results.push(await s.run());
      }
      return results;
    },
  };
}

test("D1 Smoke Test: اعمال ترتیبی همه migrations/*.sql روی دیتابیس واقعی SQLite و تست گردش کامل سفارش و فروش", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const migrationsDir = path.resolve(__dirname, "../migrations");
  const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  assert.ok(migrationFiles.length >= 12, "باید حداقل ۱۲ فایل مایگریشن وجود داشته باشد");

  // ۱) اعمال همه migrations/*.sql به ترتیب
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    sqlite.exec(sql);
  }

  const env = {
    DB: createD1Adapter(sqlite),
    PRODUCTS_KV: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    },
    ENFORCE_ORDER_HOURS: "0",
  };

  // ۲) درج یک دسته و محصول جدید
  await addCategory(env, "hot-drinks", "نوشیدنی‌های گرم", null);
  await addProduct(env, {
    id: "p_smoke_1",
    category: "hot-drinks",
    name: "چای ماسالا",
    note: "تند و معطر",
    price: 45000,
    discount: 0,
    available: 1,
  });

  const prods = await getProducts(env);
  const smokeProd = prods.products.find((p) => p.id === "p_smoke_1");
  assert.ok(smokeProd, "محصول درج‌شده باید در خروجی getProducts باشد");
  assert.equal(smokeProd.name, "چای ماسالا");
  assert.equal(smokeProd.price, 45000);
  assert.equal(smokeProd.originalPrice, null);

  // ۳) POST سفارش، بررسی وضعیت با publicId، تایید، و سپس getSalesStats
  const orderReq = new Request("https://x.test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      table: "5",
      items: [{ id: "p_smoke_1", quantity: 2 }],
    }),
  });

  const orderRes = await handleOrdersAPI(orderReq, env);
  assert.equal(orderRes.status, 200);
  const orderData = await orderRes.json();
  assert.equal(orderData.ok, true);
  assert.ok(orderData.orderId > 0);
  assert.ok(orderData.publicId);

  // بررسی وضعیت اولیه (pending)
  const statusBefore = await getOrderStatusByPublicId(env, orderData.publicId);
  assert.deepEqual(statusBefore, { status: "pending" });

  // تایید سفارش
  const confirmed = await confirmOrder(env, orderData.orderId);
  assert.equal(confirmed, true);

  // بررسی وضعیت پس از تایید (confirmed)
  const statusAfter = await getOrderStatusByPublicId(env, orderData.publicId);
  assert.deepEqual(statusAfter, { status: "confirmed" });

  // بررسی آمار فروش
  const sales = await getSalesStats(env);
  assert.equal(sales.today, 90000);
  assert.equal(sales.week, 90000);
  assert.equal(sales.month, 90000);

  // ۴) تست سایر جداول (site_settings و bot_state)
  await setSiteSetting(env, "logo", "/images/smoke-logo.png");
  const siteCfg = await getSiteConfig(env);
  assert.equal(siteCfg.logo, "/images/smoke-logo.png");

  await setBotState(env, "smoke_key", "smoke_val", 10);
  assert.equal(await getBotState(env, "smoke_key"), "smoke_val");
  await deleteExpiredBotState(env, Date.now() + 20000);
  assert.equal(await getBotState(env, "smoke_key"), null);
});
