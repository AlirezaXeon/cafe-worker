import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOrdersAPI } from "../src/handlers/orders.js";

// env ساختگی: D1 و KV کوچیک تو حافظه؛ فقط اون‌قدر که handleOrdersAPI لازم داره
function makeEnv() {
  const kv = new Map();
  let inserts = 0;
  const env = {
    PRODUCTS_KV: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => void kv.set(k, v),
    },
    DB: {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => ({ results: [{ id: "p1", name: "اسپرسو", price: 100000, available: 1 }] }),
          run: async () => {
            if (/INSERT INTO orders/.test(sql)) inserts++;
            return { meta: { last_row_id: 41 + inserts } };
          },
        }),
      }),
    },
  };
  return { env, inserts: () => inserts };
}

const req = (body) =>
  new Request("https://x.test/api/orders", { method: "POST", body: JSON.stringify(body) });
const order = (extra = {}) => ({ table: "3", items: [{ id: "p1", quantity: 2 }], ...extra });

test("سفارش معتبر بدون کلید ضدتکرار ثبت میشه", async () => {
  const { env, inserts } = makeEnv();
  const res = await handleOrdersAPI(req(order()), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(inserts(), 1);
});

test("همون idempotencyKey دوباره بیاد، سفارش تکراری ثبت نمیشه", async () => {
  const { env, inserts } = makeEnv();
  const key = "11111111-2222-3333-4444-555555555555";
  const first = await (await handleOrdersAPI(req(order({ idempotencyKey: key })), env)).json();
  const second = await (await handleOrdersAPI(req(order({ idempotencyKey: key })), env)).json();
  assert.equal(inserts(), 1);
  assert.equal(second.orderId, first.orderId);
  assert.equal(second.duplicate, true);
});

test("کلید متفاوت = سفارش جدید", async () => {
  const { env, inserts } = makeEnv();
  await handleOrdersAPI(req(order({ idempotencyKey: "aaaaaaaa-0001" })), env);
  await handleOrdersAPI(req(order({ idempotencyKey: "aaaaaaaa-0002" })), env);
  assert.equal(inserts(), 2);
});

test("کلید نامعتبر نادیده گرفته میشه (خطا نمیده)", async () => {
  const { env, inserts } = makeEnv();
  const res = await handleOrdersAPI(req(order({ idempotencyKey: "<script>" })), env);
  assert.equal(res.status, 200);
  assert.equal(inserts(), 1);
});
