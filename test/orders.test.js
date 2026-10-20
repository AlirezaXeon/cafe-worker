import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOrdersAPI, hashIp, formatOrderMessage, notifyAdmins } from "../src/handlers/orders.js";
import { ORDER_RATE_LIMIT_MAX, TABLE_PENDING_ORDER_LIMIT_MAX, TABLE_PENDING_ORDER_PER_IP_MAX } from "../src/config.js";
import { clearMemo, SITE_CACHE_KEY } from "../src/data/cache.js";
import { tehranBoundaries, getSalesStats, getPendingOrdersNeedingNotification } from "../src/data/orders.js";
import { signTable } from "../src/lib/tableSig.js";

function makeEnv(opts = {}) {
  const kv = new Map();
  const orders = [];
  const rateLimitCount = opts.rateLimitCount ?? null;

  const env = {
    ENFORCE_ORDER_HOURS: opts.enforceHours ? "1" : "0",
    PRODUCTS_KV: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => void kv.set(k, v),
    },
    DB: {
      prepare: (sql) => {
        const createStmt = (args = []) => ({
          all: async () => {
            if (/SELECT id, table_number, items, total(?:, created_at)? FROM orders WHERE status = 'pending' AND tg_notified = 0/.test(sql)) {
              const [minCreatedAt, maxCreatedAt] = args;
              const filtered = orders.filter((o) =>
                (o.status ?? "pending") === "pending" &&
                (o.tg_notified ?? 0) === 0 &&
                o.created_at >= minCreatedAt &&
                o.created_at <= maxCreatedAt
              );
              return { results: filtered };
            }
            if (/SELECT.*FROM products/.test(sql)) {
              return { results: [{ id: "p1", name: "اسپرسو", price: 100000, available: 1 }] };
            }
            if (/SELECT key, value FROM site_settings/.test(sql)) {
              return { results: opts.siteSettings ?? [] };
            }
            return { results: [] };
          },
          first: async (col) => {
            if (/SELECT.*FROM orders WHERE request_id/.test(sql)) {
              const reqId = args[0];
              const found = orders.find((o) => o.request_id === reqId);
              return found ? { id: found.id, public_id: found.public_id } : null;
            }
            if (/SELECT status FROM orders WHERE public_id/.test(sql)) {
              const pId = args[0];
              const found = orders.find((o) => o.public_id === pId);
              return found ? { status: found.status } : null;
            }
            if (/SELECT COUNT\(\*\).*FROM orders WHERE ip_hash/.test(sql)) {
              const [ipHash, since] = args;
              if (rateLimitCount !== null) return { c: rateLimitCount };
              const count = orders.filter((o) => o.ip_hash === ipHash && o.created_at >= since).length;
              return { c: count };
            }
            if (/SELECT COUNT\(\*\).*FROM orders WHERE status = 'pending' AND table_number = \? AND ip_hash = \?/.test(sql)) {
              const [tableNumber, ipHash, since] = args;
              const count = orders.filter((o) => (o.status ?? "pending") === "pending" && o.table_number === tableNumber && o.ip_hash === ipHash && o.created_at >= since).length;
              return { c: count };
            }
            if (/SELECT COUNT\(\*\).*FROM orders WHERE status = 'pending' AND table_number/.test(sql)) {
              const [tableNumber, since] = args;
              const count = orders.filter((o) => (o.status ?? "pending") === "pending" && o.table_number === tableNumber && o.created_at >= since).length;
              return { c: count };
            }
            if (/SELECT tg_messages FROM orders WHERE id = \?/.test(sql)) {
              const id = args[0];
              const found = orders.find((o) => o.id === id);
              return found ? { tg_messages: found.tg_messages || null } : null;
            }
            return null;
          },
          run: async () => {
            if (/UPDATE orders SET tg_messages = \?, tg_notified = \? WHERE id = \?/.test(sql)) {
              const [tgPayload, tgNotified, id] = args;
              const found = orders.find((o) => o.id === id);
              if (found) {
                found.tg_messages = tgPayload;
                found.tg_notified = tgNotified;
              }
              return { meta: { changes: 1 } };
            }
            if (/INSERT INTO orders/.test(sql)) {
              const [table_number, items, total, request_id, ip_hash, public_id] = args;
              const id = 42 + orders.length;
              orders.push({
                id,
                table_number,
                items,
                total,
                request_id,
                ip_hash,
                public_id: public_id || `mock-uuid-${id}`,
                status: "pending",
                tg_messages: null,
                tg_notified: 0,
                created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
              });
              return { meta: { last_row_id: id } };
            }
            return { meta: { changes: 1 } };
          },
        });
        const stmt = createStmt([]);
        stmt.bind = (...args) => createStmt(args);
        return stmt;
      },
    },
    JWT_SECRET: "test-default-jwt-secret-for-orders",
  };
  return { env, orders: () => orders, inserts: () => orders.length, rawOrders: orders };
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
  assert.equal(stored.ip_hash, await hashIp(rawIp, env.JWT_SECRET));
  assert.equal(JSON.stringify(stored).includes(rawIp), false, "رشته IP خام در هیچ فیلدی نباید باشد");
});

test("hashIp: با دو secret متفاوت، هش یک IP یکسان متفاوت است", async () => {
  const ip = "192.168.1.100";
  const hash1 = await hashIp(ip, "secret-one");
  const hash2 = await hashIp(ip, "secret-two");

  assert.equal(hash1.length, 64);
  assert.equal(hash2.length, 64);
  assert.notEqual(hash1, hash2);
});

test("handleOrdersAPI: از env.IP_HASH_SECRET برای ساخت هش IP استفاده می‌کند", async () => {
  const { env, orders } = makeEnv();
  env.IP_HASH_SECRET = "custom-order-secret-salt";
  const rawIp = "192.168.1.100";
  const res = await handleOrdersAPI(req(order(), { "cf-connecting-ip": rawIp }), env);
  assert.equal(res.status, 200);

  const stored = orders()[0];
  assert.equal(stored.ip_hash, await hashIp(rawIp, "custom-order-secret-salt"));
});

test("handleOrdersAPI: اگر IP_HASH_SECRET ست نباشد از env.JWT_SECRET به عنوان فالبک استفاده می‌کند", async () => {
  const { env, orders } = makeEnv();
  env.JWT_SECRET = "jwt-secret-used-as-hash-salt";
  delete env.IP_HASH_SECRET;
  const rawIp = "192.168.1.105";
  const res = await handleOrdersAPI(req(order(), { "cf-connecting-ip": rawIp }), env);
  assert.equal(res.status, 200);

  const stored = orders()[0];
  assert.equal(stored.ip_hash, await hashIp(rawIp, "jwt-secret-used-as-hash-salt"));
});


test("محدودیت نرخ: بیش از سقف مجاز سفارش در ۱۰ دقیقه منجر به خطای ۴۲۹ می‌شود", async () => {
  const { env } = makeEnv({ rateLimitCount: ORDER_RATE_LIMIT_MAX }); // سقف مجاز پر شده
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

test("سقف سفارش‌های در انتظار به ازای هر فرستنده و هر میز: سفارش چهارم یک IP روی همان میز رد و IP دیگر قبول می‌شود", async () => {
  const { env, inserts } = makeEnv();
  const ip1 = { "cf-connecting-ip": "1.1.1.1" };
  const ip2 = { "cf-connecting-ip": "2.2.2.2" };

  // ۳ سفارش اول برای میز ۱ با IP اول با موفقیت ثبت می‌شوند
  for (let i = 1; i <= TABLE_PENDING_ORDER_PER_IP_MAX; i++) {
    const res = await handleOrdersAPI(req(order({ table: "1", requestId: `req-table1-000${i}` }), ip1), env);
    assert.equal(res.status, 200);
  }
  assert.equal(inserts(), 3);

  // سفارش چهارم با همان IP برای همان میز ۱ رد می‌شود (۴۲۹)
  const res4 = await handleOrdersAPI(req(order({ table: "1", requestId: "req-table1-0004" }), ip1), env);
  assert.equal(res4.status, 429);
  const data4 = await res4.json();
  assert.ok(data4.error.includes("بیش از حد مجاز"));
  assert.equal(inserts(), 3, "سفارش چهارم از همان IP نباید در دیتابیس ثبت شود");

  // سفارش همان میز با IP دیگر (مشتری دیگر در همان میز) باید ثبت شود
  const resIp2 = await handleOrdersAPI(req(order({ table: "1", requestId: "req-table1-ip2-0001" }), ip2), env);
  assert.equal(resIp2.status, 200);
  assert.equal(inserts(), 4, "سفارش با IP دیگر روی همان میز باید ثبت شود");

  // سفارش برای یک میز دیگر (میز ۲) باید با موفقیت ثبت شود
  const resOther = await handleOrdersAPI(req(order({ table: "2", requestId: "req-table2-0001" }), ip1), env);
  assert.equal(resOther.status, 200);
  assert.equal(inserts(), 5, "سفارش میز دیگر باید ثبت شود");

  // سقف کل میز (TABLE_PENDING_ORDER_LIMIT_MAX): پر کردن ظرفیت میز با فرستنده‌های مجزا
  const remainingSlots = TABLE_PENDING_ORDER_LIMIT_MAX - (TABLE_PENDING_ORDER_PER_IP_MAX + 1);
  for (let i = 1; i <= remainingSlots; i++) {
    const res = await handleOrdersAPI(req(order({ table: "1", requestId: `req-table1-ip${i}` }), { "cf-connecting-ip": `10.0.0.${i}` }), env);
    assert.equal(res.status, 200);
  }
  // اکنون میز ۱ دقیقاً TABLE_PENDING_ORDER_LIMIT_MAX سفارش در انتظار دارد
  assert.equal(inserts(), TABLE_PENDING_ORDER_LIMIT_MAX + 1); // روی میز ۱ + ۱ روی میز ۲

  // سفارش یازدهم روی میز ۱ حتی با IP کاملاً جدید رد می‌شود
  const resTotalLimit = await handleOrdersAPI(req(order({ table: "1", requestId: "req-table1-overflow" }), { "cf-connecting-ip": "10.0.0.99" }), env);
  assert.equal(resTotalLimit.status, 429);
  const dataTotal = await resTotalLimit.json();
  assert.ok(dataTotal.error.includes("برای این میز بیش از حد مجاز است"));
  assert.equal(inserts(), 11, "سفارش بیش از سقف کل میز نباید ثبت شود");
});

test("POST /api/orders rejects oversized requests (>16KB) with 413", async () => {
  const { env } = makeEnv();
  const res = await handleOrdersAPI(
    req(order(), { "content-length": "20000" }),
    env
  );
  assert.equal(res.status, 413);
  const data = await res.json();
  assert.ok(data.error.includes("حجم درخواست"));
});

test("شماره میز باید در بازه ۱ تا tableCount تنظیمات سایت باشد", async () => {
  clearMemo(SITE_CACHE_KEY);
  // حالت پیش‌فرض: tableCount = 20
  const { env: env20 } = makeEnv();
  const res20 = await handleOrdersAPI(req(order({ table: "20" })), env20);
  assert.equal(res20.status, 200);

  const res21 = await handleOrdersAPI(req(order({ table: "21" })), env20);
  assert.equal(res21.status, 400);
  const data21 = await res21.json();
  assert.ok(data21.error.includes("شماره میز نامعتبر"));

  // حالت سفارشی: tableCount = 25 در site_settings
  clearMemo(SITE_CACHE_KEY);
  const { env: env25 } = makeEnv({
    siteSettings: [{ key: "tableCount", value: "25" }],
  });
  const res25 = await handleOrdersAPI(req(order({ table: "25" })), env25);
  assert.equal(res25.status, 200);

  const res26 = await handleOrdersAPI(req(order({ table: "26" })), env25);
  assert.equal(res26.status, 400);
  clearMemo(SITE_CACHE_KEY);
});

test("tehranBoundaries: محاسبه دقیق مرزهای روز، هفته (شنبه) و ماه به وقت تهران", () => {
  // چهارشنبه ۱۴ اکتبر ۲۰۲۶ ساعت ۱۵:۰۰ به وقت تهران = ساعت ۱۱:۳۰ UTC
  const midWeek = Date.parse("2026-10-14T11:30:00Z");
  const b = tehranBoundaries(midWeek);

  // آغاز روز: ۱۴ اکتبر ساعت ۰۰:۰۰ به وقت تهران = ۱۳ اکتبر ۲۰:۳۰ UTC
  assert.equal(b.startOfDay, "2026-10-13 20:30:00");

  // آغاز هفته: شنبه ۱۰ اکتبر ساعت ۰۰:۰۰ به وقت تهران = ۹ اکتبر ۲۰:۳۰ UTC
  assert.equal(b.startOfWeek, "2026-10-09 20:30:00");

  // آغاز ماه: ۱ مهر ساعت ۰۰:۰۰ به وقت تهران = ۲۲ سپتامبر ۲۰:۳۰ UTC
  assert.equal(b.startOfMonth, "2026-09-22 20:30:00");
});

test("tehranBoundaries: تغییر روز دقیقا در نیمه‌شب تهران (23:59:59 تا 00:00:00)", () => {
  // سه‌شنبه ۱۳ اکتبر ۲۳:۵۹:۵۹ به وقت تهران = ۲۰:۲۹:۵۹ UTC
  const beforeMidnight = Date.parse("2026-10-13T20:29:59Z");
  const b1 = tehranBoundaries(beforeMidnight);
  assert.equal(b1.startOfDay, "2026-10-12 20:30:00"); // آغاز روز سه‌شنبه ۱۳ اکتبر تهران

  // یک ثانیه بعد: چهارشنبه ۱۴ اکتبر ۰۰:۰۰:۰۰ به وقت تهران = ۲۰:۳۰:۰۰ UTC
  const atMidnight = Date.parse("2026-10-13T20:30:00Z");
  const b2 = tehranBoundaries(atMidnight);
  assert.equal(b2.startOfDay, "2026-10-13 20:30:00"); // آغاز روز چهارشنبه ۱۴ اکتبر تهران
});

test("tehranBoundaries: شروع هفته از شنبه مطابق تقویم ایران (جمعه 23:59:59 تا شنبه 00:00:00)", () => {
  // جمعه ۱۶ اکتبر ۲۳:۵۹:۵۹ به وقت تهران = ۲۰:۲۹:۵۹ UTC (آخرین لحظه هفته)
  const fridayEnd = Date.parse("2026-10-16T20:29:59Z");
  const bFri = tehranBoundaries(fridayEnd);
  assert.equal(bFri.startOfWeek, "2026-10-09 20:30:00"); // شنبه گذشته (۱۰ اکتبر)

  // شنبه ۱۷ اکتبر ۰۰:۰۰:۰۰ به وقت تهران = ۲۰:۳۰:۰۰ UTC (آغاز هفته جدید)
  const saturdayStart = Date.parse("2026-10-16T20:30:00Z");
  const bSat = tehranBoundaries(saturdayStart);
  assert.equal(bSat.startOfWeek, "2026-10-16 20:30:00"); // همان لحظه آغاز شنبه
  assert.equal(bSat.startOfDay, "2026-10-16 20:30:00");  // با startOfDay برابر است
});

test("tehranBoundaries: مرز آغاز ماه شمسی و تغییر ماه در نیمه‌شب تهران", () => {
  // ۳۱ شهریور ۱۴۰۵ ساعت ۲۳:۵۹:۵۹ تهران = ۲۲ سپتامبر ۲۰۲۶ ساعت ۲۰:۲۹:۵۹ UTC
  const shahrivarEnd = Date.parse("2026-09-22T20:29:59Z");
  const bShahrivar = tehranBoundaries(shahrivarEnd);
  assert.equal(bShahrivar.startOfMonth, "2026-08-22 20:30:00"); // آغاز شهریور: ۱ شهریور ۱۴۰۵ تهران

  // ۱ مهر ۱۴۰۵ ساعت ۰۰:۰۰:۰۰ تهران = ۲۲ سپتامبر ۲۰۲۶ ساعت ۲۰:۳۰:۰۰ UTC
  const mehrStart = Date.parse("2026-09-22T20:30:00Z");
  const bMehr = tehranBoundaries(mehrStart);
  assert.equal(bMehr.startOfMonth, "2026-09-22 20:30:00"); // آغاز مهر: ۱ مهر ۱۴۰۵ تهران

  // ۳۰ مهر ۱۴۰۵ ساعت ۲۳:۵۹:۵۹ تهران = ۲۲ اکتبر ۲۰۲۶ ساعت ۲۰:۲۹:۵۹ UTC
  const mehrEnd = Date.parse("2026-10-22T20:29:59Z");
  const bMehrEnd = tehranBoundaries(mehrEnd);
  assert.equal(bMehrEnd.startOfMonth, "2026-09-22 20:30:00"); // هنوز در ماه مهر

  // ۱ آبان ۱۴۰۵ ساعت ۰۰:۰۰:۰۰ تهران = ۲۲ اکتبر ۲۰۲۶ ساعت ۲۰:۳۰:۰۰ UTC
  const abanStart = Date.parse("2026-10-22T20:30:00Z");
  const bAban = tehranBoundaries(abanStart);
  assert.equal(bAban.startOfMonth, "2026-10-22 20:30:00"); // آغاز آبان: ۱ آبان ۱۴۰۵ تهران
});

test("getSalesStats: جمع فروش فقط سفارش‌های تاییدشده را در مرزهای روز/هفته/ماه محاسبه می‌کند", async () => {
  // تاریخ مبنا: چهارشنبه ۱۴ اکتبر ۲۰۲۶ ساعت ۱۲:۰۰ تهران (۲۲ مهر ۱۴۰۵)
  const now = Date.parse("2026-10-14T08:30:00Z");
  // مرزها:
  // startOfDay = "2026-10-13 20:30:00"
  // startOfWeek = "2026-10-09 20:30:00"
  // startOfMonth = "2026-09-22 20:30:00" (۱ مهر ۱۴۰۵)

  const mockOrders = [
    // امروز (تایید شده): 100,000
    { total: 100000, status: "confirmed", created_at: "2026-10-14 05:00:00" },
    // امروز اما رد شده (نباید حساب شود): 500,000
    { total: 500000, status: "rejected", created_at: "2026-10-14 06:00:00" },
    // امروز اما در انتظار (نباید حساب شود): 700,000
    { total: 700000, status: "pending", created_at: "2026-10-14 07:00:00" },
    // اوایل این هفته دوشنبه ۱۲ اکتبر (تایید شده): 200,000
    { total: 200000, status: "confirmed", created_at: "2026-10-12 10:00:00" },
    // اوایل این ماه یکشنبه ۴ اکتبر / ۱۳ مهر (تایید شده): 300,000
    { total: 300000, status: "confirmed", created_at: "2026-10-04 10:00:00" },
    // ماه قبل شهریور ۲۰ سپتامبر / ۲۹ شهریور (تایید شده): 400,000
    { total: 400000, status: "confirmed", created_at: "2026-09-20 10:00:00" },
  ];

  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async (col) => {
            const [since] = args;
            const sum = mockOrders
              .filter((o) => o.status === "confirmed" && o.created_at >= since)
              .reduce((acc, o) => acc + o.total, 0);
            return sum;
          },
        }),
      }),
    },
  };

  const stats = await getSalesStats(env, now);
  assert.equal(stats.today, 100000, "فروش امروز فقط شامل سفارش تایید شده امروز باشد");
  assert.equal(stats.week, 300000, "فروش هفته شامل سفارش امروز و اوایل هفته باشد (100k + 200k)");
  assert.equal(stats.month, 600000, "فروش ماه شامل همه سفارش‌های این ماه باشد (100k + 200k + 300k)");
});

test("ساعت کاری: خارج از ساعت کاری سفارش با ۴۰۳ رد میشه و تو ساعت کاری ثبت میشه", async () => {
  const origNow = Date.now;
  clearMemo(SITE_CACHE_KEY);
  try {
    const { env, inserts } = makeEnv({ enforceHours: true });

    Date.now = () => Date.parse("2026-10-13T23:30:00Z"); // چهارشنبه ۰۳:۰۰ بامداد تهران
    const closed = await handleOrdersAPI(req(order()), env);
    assert.equal(closed.status, 403);
    const closedData = await closed.json();
    assert.equal(closedData.closed, true);
    assert.ok(closedData.error.includes("بسته"));
    assert.equal(inserts(), 0);

    Date.now = () => Date.parse("2026-10-14T08:30:00Z"); // چهارشنبه ۱۲:۰۰ تهران
    const open = await handleOrdersAPI(req(order()), env);
    assert.equal(open.status, 200);
    assert.equal(inserts(), 1);
  } finally {
    Date.now = origNow;
  }
});

test("ساعت کاری: تلاش مجدد با همون requestId بعد از بسته شدن، سفارش قبلی رو برمیگردونه", async () => {
  const origNow = Date.now;
  clearMemo(SITE_CACHE_KEY);
  try {
    const { env, inserts } = makeEnv({ enforceHours: true });
    const key = "33333333-4444-5555-6666-777777777777";

    Date.now = () => Date.parse("2026-10-14T19:29:00Z"); // ۲۲:۵۹ تهران
    const first = await (await handleOrdersAPI(req(order({ requestId: key })), env)).json();
    assert.equal(first.ok, true);

    Date.now = () => Date.parse("2026-10-14T19:31:00Z"); // ۲۳:۰۱ تهران ← بسته
    const retry = await handleOrdersAPI(req(order({ requestId: key })), env);
    assert.equal(retry.status, 200);
    const retryData = await retry.json();
    assert.equal(retryData.duplicate, true);
    assert.equal(retryData.orderId, first.orderId);
    assert.equal(inserts(), 1);
  } finally {
    Date.now = origNow;
  }
});

test("ENFORCE_ORDER_HOURS=0 چک ساعت کاری رو خاموش میکنه", async () => {
  const origNow = Date.now;
  clearMemo(SITE_CACHE_KEY);
  try {
    const { env, inserts } = makeEnv(); // پیشفرض تستها: ENFORCE_ORDER_HOURS = "0"
    Date.now = () => Date.parse("2026-10-13T23:30:00Z"); // ۰۳:۰۰ بامداد تهران
    const res = await handleOrdersAPI(req(order()), env);
    assert.equal(res.status, 200);
    assert.equal(inserts(), 1);
  } finally {
    Date.now = origNow;
  }
});

test("پاسخ ثبت سفارش شامل publicId است", async () => {
  const { env } = makeEnv();
  const res = await handleOrdersAPI(req(order()), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.publicId, "پاسخ باید حاوی publicId باشد");
  assert.equal(typeof data.publicId, "string");
  assert.notEqual(data.publicId, String(data.orderId), "publicId نباید برابر با id عددی ترتیبی باشد");
});

test("GET /api/orders/:publicId/status وضعیت سفارش‌های pending، confirmed و rejected را برمی‌گرداند", async () => {
  const { env, orders } = makeEnv();

  // ثبت یک سفارش جدید
  const res = await handleOrdersAPI(req(order()), env);
  const data = await res.json();
  const publicId = data.publicId;

  // وضعیت pending اولیه
  const statusReq1 = new Request(`https://x.test/api/orders/${publicId}/status`, { method: "GET" });
  const statusRes1 = await handleOrdersAPI(statusReq1, env);
  assert.equal(statusRes1.status, 200);
  assert.equal(statusRes1.headers.get("cache-control"), "no-store");
  const body1 = await statusRes1.json();
  assert.deepEqual(body1, { status: "pending" });
  assert.equal(Object.keys(body1).length, 1, "نباید هیچ فیلد حساس دیگری در پاسخ وجود داشته باشد");

  // تغییر وضعیت به confirmed
  const createdOrder = orders().find((o) => o.public_id === publicId);
  createdOrder.status = "confirmed";

  const statusRes2 = await handleOrdersAPI(new Request(`https://x.test/api/orders/${publicId}/status`, { method: "GET" }), env);
  assert.equal(statusRes2.status, 200);
  const body2 = await statusRes2.json();
  assert.deepEqual(body2, { status: "confirmed" });

  // تغییر وضعیت به rejected
  createdOrder.status = "rejected";
  const statusRes3 = await handleOrdersAPI(new Request(`https://x.test/api/orders/${publicId}/status`, { method: "GET" }), env);
  assert.equal(statusRes3.status, 200);
  const body3 = await statusRes3.json();
  assert.deepEqual(body3, { status: "rejected" });
});

test("GET /api/orders/:publicId/status برای شناسه ناموجود و id ترتیبی ۴۰۴ می‌دهد", async () => {
  const { env } = makeEnv();

  // شناسه رندوم ناموجود
  const resNonExistent = await handleOrdersAPI(
    new Request("https://x.test/api/orders/non-existent-uuid/status", { method: "GET" }),
    env
  );
  assert.equal(resNonExistent.status, 404);

  // شناسه عددی ترتیبی هرگز نباید سفارش را پیدا کند
  const resNumeric = await handleOrdersAPI(
    new Request("https://x.test/api/orders/42/status", { method: "GET" }),
    env
  );
  assert.equal(resNumeric.status, 404);
});

test("TABLE_SIGNING_SECRET: اگر ست باشد، سفارش بدون sig معتبر با ۴۰۳ رد می‌شود", async () => {
  clearMemo(SITE_CACHE_KEY);
  const { env, inserts } = makeEnv();
  env.TABLE_SIGNING_SECRET = "super-table-secret";

  // بدون tableSig
  const resNoSig = await handleOrdersAPI(req(order({ table: "3" })), env);
  assert.equal(resNoSig.status, 403);
  const dataNoSig = await resNoSig.json();
  assert.ok(dataNoSig.error.includes("امضای میز نامعتبر"));
  assert.equal(inserts(), 0);

  // با tableSig اشتباه
  const resBadSig = await handleOrdersAPI(req(order({ table: "3", tableSig: "invalid-signature" })), env);
  assert.equal(resBadSig.status, 403);
  assert.equal(inserts(), 0);

  // با tableSig مربوط به یک میز دیگر (مثلاً میز 4 به جای 3)
  const sigForTable4 = await signTable("4", env.TABLE_SIGNING_SECRET);
  const resWrongTable = await handleOrdersAPI(req(order({ table: "3", tableSig: sigForTable4 })), env);
  assert.equal(resWrongTable.status, 403);
  assert.equal(inserts(), 0);

  // با tableSig معتبر میز 3
  const validSig = await signTable("3", env.TABLE_SIGNING_SECRET);
  const resValid = await handleOrdersAPI(req(order({ table: "3", tableSig: validSig })), env);
  assert.equal(resValid.status, 200);
  assert.equal(inserts(), 1);
});

test("TABLE_SIGNING_SECRET: اگر ست نباشد (backward compatible)، سفارش بدون sig ثبت می‌شود", async () => {
  clearMemo(SITE_CACHE_KEY);
  const { env, inserts } = makeEnv();
  // env.TABLE_SIGNING_SECRET تعریف نشده است
  const res = await handleOrdersAPI(req(order({ table: "3" })), env);
  assert.equal(res.status, 200);
  assert.equal(inserts(), 1);
});

test("امضا خاموش (requireTableSig=0) و سکرت ست: سفارش بدون sig ثبت می‌شود", async () => {
  clearMemo(SITE_CACHE_KEY);
  const { env, inserts } = makeEnv({ siteSettings: [{ key: "requireTableSig", value: "0" }] });
  env.TABLE_SIGNING_SECRET = "super-table-secret";

  const res = await handleOrdersAPI(req(order({ table: "3" })), env);
  assert.equal(res.status, 200);
  assert.equal(inserts(), 1);
});

test("امضا خاموش: سفارش با sig معتبر هم ثبت می‌شود", async () => {
  clearMemo(SITE_CACHE_KEY);
  const { env, inserts } = makeEnv({ siteSettings: [{ key: "requireTableSig", value: "0" }] });
  env.TABLE_SIGNING_SECRET = "super-table-secret";

  const validSig = await signTable("3", env.TABLE_SIGNING_SECRET);
  const res = await handleOrdersAPI(req(order({ table: "3", tableSig: validSig })), env);
  assert.equal(res.status, 200);
  assert.equal(inserts(), 1);
});

test("getPendingOrdersNeedingNotification: سفارش‌های pending با tg_notified=0 بین ۱ دقیقه تا ۲ ساعت قبل را برمی‌گرداند", async () => {
  const { env, rawOrders } = makeEnv();
  const now = Date.now();
  const toUtcSql = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

  // ۱. سفارش ۳۰ ثانیه قبل (زیر ۱ دقیقه، نباید بیاید)
  rawOrders.push({
    id: 1,
    table_number: "1",
    items: JSON.stringify([{ id: "p1", name: "قهوه", price: 50000, quantity: 1 }]),
    total: 50000,
    status: "pending",
    tg_notified: 0,
    created_at: toUtcSql(now - 30 * 1000),
  });

  // ۲. سفارش ۵ دقیقه قبل (بین ۱ دقیقه و ۲ ساعت، باید بیاید)
  rawOrders.push({
    id: 2,
    table_number: "2",
    items: JSON.stringify([{ id: "p1", name: "قهوه", price: 50000, quantity: 1 }]),
    total: 50000,
    status: "pending",
    tg_notified: 0,
    created_at: toUtcSql(now - 5 * 60 * 1000),
  });

  // ۳. سفارش ۵ دقیقه قبل اما قبلاً نوتیفای شده (tg_notified = 1)
  rawOrders.push({
    id: 3,
    table_number: "3",
    items: JSON.stringify([{ id: "p1", name: "قهوه", price: 50000, quantity: 1 }]),
    total: 50000,
    status: "pending",
    tg_notified: 1,
    created_at: toUtcSql(now - 5 * 60 * 1000),
  });

  // ۴. سفارش ۵ دقیقه قبل اما تایید شده (status = confirmed)
  rawOrders.push({
    id: 4,
    table_number: "4",
    items: JSON.stringify([{ id: "p1", name: "قهوه", price: 50000, quantity: 1 }]),
    total: 50000,
    status: "confirmed",
    tg_notified: 0,
    created_at: toUtcSql(now - 5 * 60 * 1000),
  });

  // ۵. سفارش ۳ ساعت قبل (قدیمی‌تر از ۲ ساعت، نباید بیاید)
  rawOrders.push({
    id: 5,
    table_number: "5",
    items: JSON.stringify([{ id: "p1", name: "قهوه", price: 50000, quantity: 1 }]),
    total: 50000,
    status: "pending",
    tg_notified: 0,
    created_at: toUtcSql(now - 3 * 60 * 60 * 1000),
  });

  const needingRetry = await getPendingOrdersNeedingNotification(env, now);
  assert.equal(needingRetry.length, 1);
  assert.equal(needingRetry[0].orderId, 2);
  assert.equal(needingRetry[0].tableNumber, "2");
  assert.equal(needingRetry[0].total, 50000);
  assert.equal(needingRetry[0].createdAt, rawOrders[1].created_at);
});

test("formatOrderMessage: ساعت ثبت سفارش را بر اساس createdAt (UTC به تهران) نمایش می‌دهد", () => {
  const msg = formatOrderMessage({
    orderId: 42,
    tableNumber: "5",
    items: [{ id: "p1", name: "اسپرسو", price: 60000, quantity: 2 }],
    total: 120000,
    createdAt: "2026-10-18 10:15:00",
  });

  assert.match(msg, /سفارش جدید #42/);
  assert.match(msg, /میز 5/);
  assert.match(msg, /اسپرسو × 2/);
  assert.match(msg, /۱۳:۴۵/); // 10:15 UTC -> 13:45 Tehran
});

test("notifyAdmins: با ارسال ناموفق به یکی از ادمین‌ها، tg_notified صفر می‌ماند و در تلاش بعدی پیام تکراری فرستاده نمی‌شود", async () => {
  const { env, rawOrders } = makeEnv();
  env.ADMIN_IDS = "1001,1002";
  rawOrders.push({
    id: 99,
    table_number: "4",
    items: JSON.stringify([{ id: "p1", name: "قهوه", price: 50000, quantity: 1 }]),
    total: 50000,
    status: "pending",
    tg_messages: null,
    tg_notified: 0,
    created_at: new Date().toISOString(),
  });

  const origFetch = globalThis.fetch;
  const calls = [];
  try {
    // بار اول: ارسال به 1001 موفق (message_id: 111)، ارسال به 1002 ناموفق
    globalThis.fetch = async (url, opts) => {
      const payload = JSON.parse(opts.body);
      calls.push({ chatId: payload.chat_id, method: url.split("/").pop() });
      if (String(payload.chat_id) === "1001") {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 111 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: false, error_code: 500, description: "Network error" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await notifyAdmins(env, {
      orderId: 99,
      tableNumber: "4",
      items: [{ id: "p1", name: "قهوه", price: 50000, quantity: 1 }],
      total: 50000,
    });

    const o = rawOrders.find((x) => x.id === 99);
    assert.equal(o.tg_notified, 0, "وقتی همه ادمین‌ها دریافت نکرده‌اند tg_notified باید 0 بماند");
    const parsed1 = JSON.parse(o.tg_messages);
    assert.equal(parsed1.entries.length, 1);
    assert.equal(String(parsed1.entries[0].chatId), "1001");
    assert.equal(parsed1.entries[0].messageId, 111);

    // بار دوم (Retry کران‌جاب): ارسال فقط برای 1002 انجام می‌شود و به 1001 پیام تکراری نمی‌رود
    calls.length = 0;
    globalThis.fetch = async (url, opts) => {
      const payload = JSON.parse(opts.body);
      calls.push({ chatId: payload.chat_id, method: url.split("/").pop() });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 222 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await notifyAdmins(env, {
      orderId: 99,
      tableNumber: "4",
      items: [{ id: "p1", name: "قهوه", price: 50000, quantity: 1 }],
      total: 50000,
    });

    assert.equal(calls.length, 1, "در تلاش مجدد فقط باید به ادمین دوم ارسال شود");
    assert.equal(String(calls[0].chatId), "1002");
    assert.equal(o.tg_notified, 1, "پس از تحویل به همه ادمین‌ها tg_notified باید 1 شود");
    const parsed2 = JSON.parse(o.tg_messages);
    assert.equal(parsed2.entries.length, 2);
    assert.equal(String(parsed2.entries[0].chatId), "1001");
    assert.equal(String(parsed2.entries[1].chatId), "1002");
  } finally {
    globalThis.fetch = origFetch;
  }
});





