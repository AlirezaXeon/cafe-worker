import { test } from "node:test";
import assert from "node:assert/strict";
import { handleOrdersAPI, hashIp } from "../src/handlers/orders.js";
import { ORDER_RATE_LIMIT_MAX, TABLE_PENDING_ORDER_LIMIT_MAX } from "../src/config.js";
import { clearMemo, SITE_CACHE_KEY } from "../src/data/cache.js";
import { tehranBoundaries, getSalesStats } from "../src/data/orders.js";

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
            if (/SELECT.*FROM products/.test(sql)) {
              return { results: [{ id: "p1", name: "اسپرسو", price: 100000, available: 1 }] };
            }
            if (/SELECT key, value FROM site_settings/.test(sql)) {
              return { results: opts.siteSettings ?? [] };
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
            if (/SELECT COUNT\(\*\).*FROM orders WHERE status = 'pending' AND table_number/.test(sql)) {
              const [tableNumber, since] = args;
              const count = orders.filter((o) => (o.status ?? "pending") === "pending" && o.table_number === tableNumber && o.created_at >= since).length;
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
                status: "pending",
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

test("سقف سفارش‌های در انتظار به ازای هر میز: سفارش چهارم روی همان میز رد و روی میز دیگر قبول می‌شود", async () => {
  const { env, inserts } = makeEnv();

  // ۳ سفارش اول برای میز ۱ با موفقیت ثبت می‌شوند
  for (let i = 1; i <= TABLE_PENDING_ORDER_LIMIT_MAX; i++) {
    const res = await handleOrdersAPI(req(order({ table: "1", requestId: `req-table1-000${i}` })), env);
    assert.equal(res.status, 200);
  }
  assert.equal(inserts(), 3);

  // سفارش چهارم برای همان میز ۱ رد می‌شود (۴۲۹)
  const res4 = await handleOrdersAPI(req(order({ table: "1", requestId: "req-table1-0004" })), env);
  assert.equal(res4.status, 429);
  const data4 = await res4.json();
  assert.ok(data4.error.includes("بیش از حد مجاز"));
  assert.equal(inserts(), 3, "سفارش چهارم نباید در دیتابیس ثبت شود");

  // سفارش برای یک میز دیگر (میز ۲) باید با موفقیت ثبت شود
  const resOther = await handleOrdersAPI(req(order({ table: "2", requestId: "req-table2-0001" })), env);
  assert.equal(resOther.status, 200);
  assert.equal(inserts(), 4, "سفارش میز دیگر باید ثبت شود");
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

  // آغاز ماه: ۱ اکتبر ساعت ۰۰:۰۰ به وقت تهران = ۳۰ سپتامبر ۲۰:۳۰ UTC
  assert.equal(b.startOfMonth, "2026-09-30 20:30:00");
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

test("tehranBoundaries: مرز آغاز ماه میلادی به وقت تهران", () => {
  // ۳۱ اکتبر ۲۰۲۶ ساعت ۲۳:۵۹:۵۹ تهران = ۲۰:۲۹:۵۹ UTC
  const octEnd = Date.parse("2026-10-31T20:29:59Z");
  const bOct = tehranBoundaries(octEnd);
  assert.equal(bOct.startOfMonth, "2026-09-30 20:30:00"); // آغاز ماه اکتبر تهران

  // ۱ نوامبر ۲۰۲۶ ساعت ۰۰:۰۰:۰۰ تهران = ۲۰:۳۰:۰۰ UTC
  const novStart = Date.parse("2026-10-31T20:30:00Z");
  const bNov = tehranBoundaries(novStart);
  assert.equal(bNov.startOfMonth, "2026-10-31 20:30:00"); // آغاز ماه نوامبر تهران
});

test("getSalesStats: جمع فروش فقط سفارش‌های تاییدشده را در مرزهای روز/هفته/ماه محاسبه می‌کند", async () => {
  // تاریخ مبنا: چهارشنبه ۱۴ اکتبر ۲۰۲۶ ساعت ۱۲:۰۰ تهران
  const now = Date.parse("2026-10-14T08:30:00Z");
  // مرزها:
  // startOfDay = "2026-10-13 20:30:00"
  // startOfWeek = "2026-10-09 20:30:00"
  // startOfMonth = "2026-09-30 20:30:00"

  const mockOrders = [
    // امروز (تایید شده): 100,000
    { total: 100000, status: "confirmed", created_at: "2026-10-14 05:00:00" },
    // امروز اما رد شده (نباید حساب شود): 500,000
    { total: 500000, status: "rejected", created_at: "2026-10-14 06:00:00" },
    // امروز اما در انتظار (نباید حساب شود): 700,000
    { total: 700000, status: "pending", created_at: "2026-10-14 07:00:00" },
    // اوایل این هفته دوشنبه ۱۲ اکتبر (تایید شده): 200,000
    { total: 200000, status: "confirmed", created_at: "2026-10-12 10:00:00" },
    // اوایل این ماه یکشنبه ۴ اکتبر (تایید شده): 300,000
    { total: 300000, status: "confirmed", created_at: "2026-10-04 10:00:00" },
    // ماه قبل سپتامبر (تایید شده): 400,000
    { total: 400000, status: "confirmed", created_at: "2026-09-25 10:00:00" },
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



