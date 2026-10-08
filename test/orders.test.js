import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOrdersAPI, hashIp } from "../src/handlers/orders.js";

function makeEnv(opts = {}) {
  const kv = new Map();
  const orders = [];
  const rateLimitCount = opts.rateLimitCount ?? null;

  const env = {
    PRODUCTS_KV: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => void kv.set(k, v),
    },
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => {
            if (/SELECT.*FROM products/.test(sql)) {
              return { results: [{ id: "p1", name: "اسپرسو", price: 100000, available: 1 }] };
            }
            return { results: [] };
          },
          first: async (col) => {
            if (/SELECT id FROM orders WHERE request_id/.test(sql)) {
              const reqId = args[0];
              const found = orders.find((o) => o.request_id === reqId);
              return found ? { id: found.id } : null;
            }
            if (/SELECT COUNT\(\*\).*FROM orders WHERE ip_hash/.test(sql)) {
              const [ipHash, since] = args;
              if (rateLimitCount !== null) return { c: rateLimitCount };
              const count = orders.filter((o) => o.ip_hash === ipHash && o.created_at >= since).length;
              return { c: count };
            }
            return null;
          },
          run: async () => {
            if (/INSERT INTO orders/.test(sql)) {
              const [table_number, items, total, request_id, ip_hash] = args;
              const id = 42 + orders.length;
              orders.push({
                id,
                table_number,
                items,
                total,
                request_id,
                ip_hash,
                created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
              });
              return { meta: { last_row_id: id } };
            }
            return { meta: { changes: 1 } };
          },
        }),
      }),
    },
  };
  return { env, orders: () => orders, inserts: () => orders.length };
}

const req = (body, headers = {}) =>
  new Request("https://x.test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

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

test("همون requestId دوباره بیاد، سفارش تکراری ثبت نمیشه", async () => {
  const { env, inserts } = makeEnv();
  const key = "22222222-3333-4444-5555-666666666666";
  const first = await (await handleOrdersAPI(req(order({ requestId: key })), env)).json();
  const second = await (await handleOrdersAPI(req(order({ requestId: key })), env)).json();
  assert.equal(inserts(), 1);
  assert.equal(second.orderId, first.orderId);
  assert.equal(second.duplicate, true);
});

test("کلید متفاوت = سفارش جدید", async () => {
  const { env, inserts } = makeEnv();
  await handleOrdersAPI(req(order({ requestId: "aaaaaaaa-0001" })), env);
  await handleOrdersAPI(req(order({ requestId: "aaaaaaaa-0002" })), env);
  assert.equal(inserts(), 2);
});

test("کلید نامعتبر نادیده گرفته میشه (خطا نمیده)", async () => {
  const { env, inserts } = makeEnv();
  const res = await handleOrdersAPI(req(order({ requestId: "<script>" })), env);
  assert.equal(res.status, 200);
  assert.equal(inserts(), 1);
});

test("هش IP ذخیره می‌شود و هرگز IP خام در پایگاه داده ذخیره نمی‌شود", async () => {
  const { env, orders } = makeEnv();
  const rawIp = "192.168.1.100";
  const res = await handleOrdersAPI(req(order(), { "cf-connecting-ip": rawIp }), env);
  assert.equal(res.status, 200);

  const stored = orders()[0];
  assert.ok(stored.ip_hash, "ip_hash باید پر باشد");
  assert.notEqual(stored.ip_hash, rawIp, "IP خام نباید ذخیره شود");
  assert.equal(stored.ip_hash.length, 64, "هش SHA-256 باید ۶۴ کاراکتر باشد");
  assert.equal(stored.ip_hash, await hashIp(rawIp));
  assert.equal(JSON.stringify(stored).includes(rawIp), false, "رشته IP خام در هیچ فیلدی نباید باشد");
});

test("محدودیت نرخ: بیش از سقف مجاز سفارش در ۱۰ دقیقه منجر به خطای ۴۲۹ می‌شود", async () => {
  const { env } = makeEnv({ rateLimitCount: 5 }); // سقف ۵ سفارش پر شده
  const res = await handleOrdersAPI(req(order(), { "cf-connecting-ip": "1.2.3.4" }), env);
  assert.equal(res.status, 429);
  const data = await res.json();
  assert.ok(data.error.includes("حد مجاز"));
});

test("هانی‌پات ضد ربات: اگر فیلد مخفی پر باشد، پاسخی بدون ثبت سفارش برمی‌گردد", async () => {
  const { env, inserts } = makeEnv();
  const res = await handleOrdersAPI(req(order({ hp_website: "bot-payload.com" })), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.orderId, 0);
  assert.equal(inserts(), 0, "هیچ رکوردی نباید ثبت شده باشد");
});
