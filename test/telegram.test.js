import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUpdate } from "../src/telegram.js";
import { handleCallback } from "../src/telegram/callbacks.js";
import { handleTextStep } from "../src/telegram/steps.js";
import { handleImageStep } from "../src/telegram/images.js";

// ── Mock environment factory ───────────────────────────────────────────────────
// مشابه الگوی admin.test.js ولی با اضافه‌هایی برای تلگرام: tg calls, KV list, orders

function makeTgEnv(overrides = {}) {
  const categories = overrides.categories || new Map([
    ["cat1", { id: "cat1", label: "نوشیدنی", image: null }],
  ]);
  const products = overrides.products || new Map([
    ["p1", { id: "p1", category: "cat1", name: "اسپرسو", note: "تلخ", price: 85000, originalPrice: null, image: null, available: 1 }],
  ]);
  const siteSettings = overrides.siteSettings || new Map();
  const botState = new Map();
  const kv = new Map();
  const orders = overrides.orders || new Map();

  // لاگ تمام فراخوانی‌های API تلگرام (sendMessage, deleteMessage, …)
  const tgCalls = [];
  // آیدی پیام خودکار
  let nextMessageId = 1000;

  const env = {
    TELEGRAM_BOT_TOKEN: "123:TEST",
    ADMIN_IDS: overrides.adminIds || "111",
    PRODUCTS_KV: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v, opts) => kv.set(k, { value: v, metadata: opts?.metadata }),
      delete: async (k) => kv.delete(k),
      list: async ({ prefix, cursor } = {}) => {
        const keys = [];
        for (const [name, entry] of kv) {
          if (!prefix || name.startsWith(prefix)) {
            keys.push({ name, metadata: entry?.metadata });
          }
        }
        return { keys, list_complete: true };
      },
    },
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => {
            if (/SELECT.*FROM categories/.test(sql) && !/WHERE/.test(sql)) {
              return { results: Array.from(categories.values()) };
            }
            if (/SELECT.*FROM products WHERE category = \?/.test(sql)) {
              const catId = args[0];
              return { results: Array.from(products.values()).filter((p) => p.category === catId) };
            }
            if (/SELECT.*FROM products/.test(sql) && !/WHERE/.test(sql)) {
              return { results: Array.from(products.values()) };
            }
            if (/SELECT.*FROM site_settings/.test(sql)) {
              return { results: Array.from(siteSettings.entries()).map(([key, value]) => ({ key, value })) };
            }
            return { results: [] };
          },
          first: async (col) => {
            if (/SELECT.*FROM categories WHERE id = \?/.test(sql)) {
              const c = categories.get(args[0]);
              return c ? { ...c } : null;
            }
            if (/SELECT.*FROM products WHERE id = \?/.test(sql)) {
              const p = products.get(args[0]);
              return p ? { ...p } : null;
            }
            if (/SELECT COUNT\(\*\) AS c FROM products WHERE category = \?/.test(sql)) {
              return { c: Array.from(products.values()).filter((p) => p.category === args[0]).length };
            }
            if (/SELECT value, expires_at FROM bot_state/.test(sql)) {
              const r = botState.get(args[0]);
              return r ? { ...r } : null;
            }
            if (/SELECT \* FROM orders WHERE id = \?/.test(sql)) {
              return orders.get(args[0]) || null;
            }
            if (/UPDATE products SET available = 1 - available/.test(sql)) {
              const p = products.get(args[0]);
              if (!p) return null;
              p.available = p.available ? 0 : 1;
              return { available: p.available };
            }
            return null;
          },
          run: async () => {
            if (/INSERT INTO products/.test(sql)) {
              const [id, category, name, note, price, original_price, image, available] = args;
              products.set(id, { id, category, name, note, price, originalPrice: original_price, image, available });
              return { meta: { last_row_id: 1, changes: 1 } };
            }
            if (/INSERT INTO categories/.test(sql)) {
              const [id, label, image] = args;
              categories.set(id, { id, label, image });
              return { meta: { last_row_id: 1, changes: 1 } };
            }
            if (/UPDATE products SET price = \?, original_price = NULL/.test(sql)) {
              const [price, pid] = args;
              const p = products.get(pid);
              if (p) { p.price = price; p.originalPrice = null; }
              return { meta: { changes: 1 } };
            }
            if (/UPDATE products SET price = \?, original_price = \?/.test(sql)) {
              const [price, origPrice, pid] = args;
              const p = products.get(pid);
              if (p) { p.price = price; p.originalPrice = origPrice; }
              return { meta: { changes: 1 } };
            }
            if (/UPDATE products SET image = \?/.test(sql)) {
              const [image, pid] = args;
              const p = products.get(pid);
              if (p) p.image = image;
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
            if (/UPDATE categories SET image = \?/.test(sql)) {
              const cat = categories.get(args[1]);
              if (cat) cat.image = args[0];
              return { meta: { changes: 1 } };
            }
            if (/UPDATE categories SET label = \?, image = \?/.test(sql)) {
              const cat = categories.get(args[2]);
              if (cat) { cat.label = args[0]; cat.image = args[1]; }
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
            if (/INSERT OR REPLACE INTO site_settings/.test(sql)) {
              siteSettings.set(args[0], args[1]);
              return { meta: { changes: 1 } };
            }
            if (/UPDATE orders SET status = \?/.test(sql)) {
              const [status, orderId] = args;
              const o = orders.get(orderId);
              if (o && o.status === "pending") { o.status = status; return { meta: { changes: 1 } }; }
              return { meta: { changes: 0 } };
            }
            return { meta: { changes: 1, last_row_id: 1 } };
          },
        }),
        all: async () => {
          if (/SELECT.*FROM categories/.test(sql)) {
            return { results: Array.from(categories.values()) };
          }
          if (/SELECT.*FROM products/.test(sql)) {
            return { results: Array.from(products.values()) };
          }
          if (/SELECT.*FROM site_settings/.test(sql)) {
            return { results: Array.from(siteSettings.entries()).map(([key, value]) => ({ key, value })) };
          }
          return { results: [] };
        },
      }),
      batch: async (stmts) => {
        for (const s of stmts) await s.run();
      },
    },
  };

  // Monkey-patch fetch: تمام فراخوانی‌های API تلگرام رو ذخیره و جواب موفق برگردون
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes("api.telegram.org")) {
      const method = urlStr.split("/").pop();
      let payload = {};
      try { payload = JSON.parse(opts?.body || "{}"); } catch {}
      const msgId = nextMessageId++;
      tgCalls.push({ method, payload, msgId });
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: msgId } }),
      };
    }
    return origFetch(url, opts);
  };

  const restore = () => { globalThis.fetch = origFetch; };

  return { env, tgCalls, products, categories, siteSettings, botState, kv, orders, restore };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── handleUpdate (ورودی اصلی ربات) ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

test("handleUpdate: /start پاک کردن سشن و نمایش منوی اصلی", async () => {
  const { env, tgCalls, botState, restore } = makeTgEnv();
  // سشن فعالی ست کن تا مطمئن بشیم /start پاکش می‌کنه
  botState.set("session:111", { value: JSON.stringify({ step: "edit_price" }), expires_at: null });

  try {
    await handleUpdate({
      message: {
        message_id: 1, chat: { id: 111 }, from: { id: 111 },
        text: "/start",
      },
    }, env);

    // سشن باید پاک شده باشه
    assert.equal(botState.has("session:111"), false, "سشن بعد از /start باید پاک بشه");

    // پین راهنما در D1 bot_state ذخیره شده باشه، نه KV
    assert.equal(botState.has("guidepinned:111"), true, "guidepinned باید در bot_state (D1) ثبت شده باشه");
    assert.equal(env.PRODUCTS_KV.get("guidepinned:111") instanceof Promise, true);
    assert.equal(await env.PRODUCTS_KV.get("guidepinned:111"), null, "guidepinned نباید در KV ثبت بشه");

    // حداقل یه پیام (deleteMessage + sendMessage) فرستاده شده باشه
    assert.ok(tgCalls.length >= 2, "باید پیام ربات حذف و منو فرستاده بشه");
    const sendCalls = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sendCalls.length >= 1, "حداقل یه sendMessage باید وجود داشته باشه");
  } finally {
    restore();
  }
});

test("handleUpdate: /start@botname و /start payload شناسایی می‌شوند", async () => {
  const { env, tgCalls, botState, restore } = makeTgEnv();
  try {
    botState.set("session:111", { value: JSON.stringify({ step: "edit_price" }), expires_at: null });
    await handleUpdate({
      message: {
        message_id: 10, chat: { id: 111 }, from: { id: 111 },
        text: "/start@cafe_roshan_bot",
      },
    }, env);
    assert.equal(botState.has("session:111"), false, "سشن بعد از /start@botname باید پاک بشه");
    assert.ok(tgCalls.some((c) => c.method === "sendMessage"));

    botState.set("session:111", { value: JSON.stringify({ step: "edit_price" }), expires_at: null });
    await handleUpdate({
      message: {
        message_id: 11, chat: { id: 111 }, from: { id: 111 },
        text: "/start table_5",
      },
    }, env);
    assert.equal(botState.has("session:111"), false, "سشن بعد از /start payload باید پاک بشه");
  } finally {
    restore();
  }
});

test("handleUpdate: پیام از غیرادمین نادیده گرفته میشه", async () => {
  const { env, tgCalls, restore } = makeTgEnv({ adminIds: "111" });
  try {
    await handleUpdate({
      message: {
        message_id: 2, chat: { id: 999 }, from: { id: 999 },
        text: "/start",
      },
    }, env);
    // هیچ پیامی نباید فرستاده بشه
    const sendCalls = tgCalls.filter((c) => c.method === "sendMessage");
    assert.equal(sendCalls.length, 0, "نباید به غیرادمین پاسخی فرستاده بشه");
  } finally {
    restore();
  }
});

test("handleUpdate: دکمه‌ی «📦 محصولات» سشن رو پاک و لیست دسته‌ها رو نشون میده", async () => {
  const { env, tgCalls, botState, restore } = makeTgEnv();
  botState.set("session:111", { value: JSON.stringify({ step: "edit_price" }), expires_at: null });

  try {
    await handleUpdate({
      message: {
        message_id: 3, chat: { id: 111 }, from: { id: 111 },
        text: "📦 محصولات",
      },
    }, env);
    assert.equal(botState.has("session:111"), false, "سشن باید پاک بشه");
    const sendCalls = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sendCalls.length >= 1);
    // بررسی وجود دکمه‌های دسته‌بندی
    const last = sendCalls[sendCalls.length - 1];
    assert.ok(last.payload.reply_markup?.inline_keyboard, "باید کیبورد inline داشته باشه");
  } finally {
    restore();
  }
});

test("handleUpdate: متن لغو سشن رو پاک و به منو برمیگردونه", async () => {
  const { env, tgCalls, botState, restore } = makeTgEnv();
  botState.set("session:111", { value: JSON.stringify({ step: "edit_price" }), expires_at: null });

  try {
    await handleUpdate({
      message: {
        message_id: 4, chat: { id: 111 }, from: { id: 111 },
        text: "لغو",
      },
    }, env);
    assert.equal(botState.has("session:111"), false, "سشن باید پاک بشه");
  } finally {
    restore();
  }
});

test("handleUpdate: callback_query از غیرادمین جواب «دسترسی نداری» میگیره", async () => {
  const { env, tgCalls, restore } = makeTgEnv({ adminIds: "111" });
  try {
    await handleUpdate({
      callback_query: {
        id: "cq1",
        message: { chat: { id: 999 } },
        from: { id: 999 },
        data: "menu:home",
      },
    }, env);
    const answer = tgCalls.find((c) => c.method === "answerCallbackQuery");
    assert.ok(answer, "باید answerCallbackQuery صدا زده بشه");
    assert.equal(answer.payload.text, "دسترسی نداری");
  } finally {
    restore();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── handleCallback (دکمه‌های inline) ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

test("handleCallback: cancel سشن رو پاک و منو رو نشون میده", async () => {
  const { env, tgCalls, botState, restore } = makeTgEnv();
  botState.set("session:111", { value: JSON.stringify({ step: "edit_price" }), expires_at: null });

  try {
    await handleCallback(env, 111, "cancel", null);
    assert.equal(botState.has("session:111"), false);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.length >= 1);
  } finally {
    restore();
  }
});

test("handleCallback: menu:products لیست دسته‌ها رو با inline keyboard نشون میده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "menu:products", null);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.length >= 1);
    const last = sends[sends.length - 1];
    const keyboard = last.payload.reply_markup?.inline_keyboard;
    assert.ok(keyboard, "باید کیبورد inline داشته باشه");
    // باید حداقل دکمه‌ی «نوشیدنی» و «بازگشت» رو داشته باشه
    const allTexts = keyboard.flat().map((b) => b.text);
    assert.ok(allTexts.some((t) => t === "نوشیدنی"), "دکمه‌ی دسته‌بندی باید وجود داشته باشه");
    assert.ok(allTexts.some((t) => t.includes("بازگشت")), "دکمه‌ی بازگشت باید وجود داشته باشه");
  } finally {
    restore();
  }
});

test("handleCallback: catpick:browse لیست محصولات دسته رو نشون میده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "catpick:browse:cat1", null);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    // متن باید شامل اسم دسته باشه
    assert.ok(last.payload.text.includes("نوشیدنی"), "باید اسم دسته تو متن باشه");
    // باید دکمه‌ی محصول و افزودن محصول جدید وجود داشته باشه
    const allTexts = last.payload.reply_markup.inline_keyboard.flat().map((b) => b.text);
    assert.ok(allTexts.some((t) => t.includes("اسپرسو")), "باید محصول نمایش داده بشه");
    assert.ok(allTexts.some((t) => t.includes("افزودن")), "دکمه‌ی افزودن محصول باید وجود داشته باشه");
  } finally {
    restore();
  }
});

test("handleCallback: prod:id جزئیات محصول و دکمه‌های عملیاتی رو نشون میده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "prod:p1", null);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("اسپرسو"), "باید اسم محصول تو متن باشه");
    const allTexts = last.payload.reply_markup.inline_keyboard.flat().map((b) => b.text);
    assert.ok(allTexts.some((t) => t.includes("ویرایش قیمت")));
    assert.ok(allTexts.some((t) => t.includes("تخفیف")));
    assert.ok(allTexts.some((t) => t.includes("تغییر عکس")));
    assert.ok(allTexts.some((t) => t.includes("حذف محصول")));
  } finally {
    restore();
  }
});

test("handleCallback: toggleavail وضعیت موجودی محصول رو عوض میکنه", async () => {
  const { env, tgCalls, products, restore } = makeTgEnv();
  assert.equal(products.get("p1").available, 1);

  try {
    await handleCallback(env, 111, "toggleavail:p1", null);
    assert.equal(products.get("p1").available, 0, "باید از ۱ به ۰ تغییر کرده باشه");

    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.some((c) => c.payload.text.includes("پنهان")), "باید پیام پنهان شدن فرستاده بشه");
  } finally {
    restore();
  }
});

test("handleCallback: delprod تاییدیه حذف میخواد و delprodyes حذف میکنه", async () => {
  const { env, tgCalls, products, restore } = makeTgEnv();
  try {
    // اول delprod: باید تاییدیه بخواد
    await handleCallback(env, 111, "delprod:p1", null);
    let sends = tgCalls.filter((c) => c.method === "sendMessage");
    let last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("مطمئنی"), "باید تاییدیه حذف بپرسه");
    const keyboard = last.payload.reply_markup.inline_keyboard.flat();
    assert.ok(keyboard.some((b) => b.callback_data === "delprodyes:p1"));

    // حالا delprodyes: واقعاً حذف میکنه
    assert.ok(products.has("p1"), "محصول هنوز باید موجود باشه");
    await handleCallback(env, 111, "delprodyes:p1", null);
    assert.equal(products.has("p1"), false, "محصول باید حذف شده باشه");
  } finally {
    restore();
  }
});

test("handleCallback: delcat وقتی دسته محصول داره خطا میده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "delcat:cat1", null);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("محصول"), "باید بگه دسته محصول داره");
  } finally {
    restore();
  }
});

test("handleCallback: delcatyes دسته خالی رو حذف میکنه", async () => {
  const { env, categories, tgCalls, restore } = makeTgEnv({
    categories: new Map([["empty-cat", { id: "empty-cat", label: "دسته خالی", image: null }]]),
    products: new Map(),
  });
  try {
    assert.ok(categories.has("empty-cat"));
    await handleCallback(env, 111, "delcatyes:empty-cat", null);
    assert.equal(categories.has("empty-cat"), false, "دسته باید حذف شده باشه");
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.some((c) => c.payload.text.includes("حذف شد")));
  } finally {
    restore();
  }
});

test("handleCallback: editprice سشن ویرایش قیمت رو ست میکنه", async () => {
  const { env, tgCalls, botState, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "editprice:p1", null);
    const session = JSON.parse(botState.get("session:111").value);
    assert.equal(session.step, "edit_price");
    assert.equal(session.productId, "p1");
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("قیمت"), "باید بپرسه قیمت بفرست");
  } finally {
    restore();
  }
});

test("handleCallback: discount سشن تخفیف رو ست میکنه", async () => {
  const { env, botState, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "discount:p1", null);
    const session = JSON.parse(botState.get("session:111").value);
    assert.equal(session.step, "discount_percent");
    assert.equal(session.productId, "p1");
  } finally {
    restore();
  }
});

test("handleCallback: rmdiscount تخفیف رو حذف و قیمت اصلی رو برمیگردونه", async () => {
  const { env, products, restore } = makeTgEnv({
    products: new Map([
      ["p1", { id: "p1", category: "cat1", name: "اسپرسو", note: "", price: 72000, originalPrice: 85000, image: null, available: 1 }],
    ]),
  });
  try {
    await handleCallback(env, 111, "rmdiscount:p1", null);
    assert.equal(products.get("p1").price, 85000, "قیمت باید به اصلی برگرده");
    assert.equal(products.get("p1").originalPrice, null, "original_price باید null بشه");
  } finally {
    restore();
  }
});

test("handleCallback: order:confirm سفارش pending رو تایید میکنه", async () => {
  const { env, orders, restore } = makeTgEnv({
    orders: new Map([[42, { id: 42, status: "pending", tg_messages: null }]]),
  });
  try {
    await handleCallback(env, 111, "order:confirm:42", { from: { first_name: "علی" } });
    assert.equal(orders.get(42).status, "confirmed");
  } finally {
    restore();
  }
});

test("handleCallback: order:reject سفارش pending رو رد میکنه", async () => {
  const { env, orders, restore } = makeTgEnv({
    orders: new Map([[43, { id: 43, status: "pending", tg_messages: null }]]),
  });
  try {
    await handleCallback(env, 111, "order:reject:43", { from: { first_name: "رضا" } });
    assert.equal(orders.get(43).status, "rejected");
  } finally {
    restore();
  }
});

test("handleCallback: newcat سشن ساخت دسته جدید رو شروع میکنه", async () => {
  const { env, botState, tgCalls, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "newcat", null);
    const session = JSON.parse(botState.get("session:111").value);
    assert.equal(session.step, "new_category_label");
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("اسم"), "باید بپرسه اسم دسته رو بفرست");
  } finally {
    restore();
  }
});

test("handleCallback: catpick:bulk سشن تغییر قیمت دسته‌جمعی رو شروع میکنه", async () => {
  const { env, botState, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "catpick:bulk:cat1", null);
    const session = JSON.parse(botState.get("session:111").value);
    assert.equal(session.step, "bulk_percent");
    assert.equal(session.catId, "cat1");
  } finally {
    restore();
  }
});

test("handleCallback: siteimg:logo سشن ویرایش لوگو رو ست میکنه", async () => {
  const { env, botState, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "siteimg:logo", null);
    const session = JSON.parse(botState.get("session:111").value);
    assert.equal(session.step, "edit_site_logo");
  } finally {
    restore();
  }
});

test("handleCallback: siteimg:cover سشن ویرایش کاور رو ست میکنه", async () => {
  const { env, botState, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "siteimg:cover", null);
    const session = JSON.parse(botState.get("session:111").value);
    assert.equal(session.step, "edit_site_cover");
  } finally {
    restore();
  }
});

test("handleCallback: rmimg عکس محصول رو حذف میکنه", async () => {
  const { env, products, kv, tgCalls, restore } = makeTgEnv({
    products: new Map([
      ["p1", { id: "p1", category: "cat1", name: "اسپرسو", note: "", price: 85000, originalPrice: null, image: "images/products/p1_123.jpg", available: 1 }],
    ]),
  });
  kv.set("image:p1_123.jpg", { value: new ArrayBuffer(8) });

  try {
    await handleCallback(env, 111, "rmimg:p1", null);
    assert.equal(products.get("p1").image, null, "عکس محصول باید null بشه");
    assert.equal(kv.has("image:p1_123.jpg"), false, "فایل عکس از KV حذف بشه");
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.some((c) => c.payload.text.includes("حذف شد")));
  } finally {
    restore();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── handleTextStep (مراحل متنی) ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

test("handleTextStep: edit_price قیمت معتبر رو ذخیره میکنه", async () => {
  const { env, products, tgCalls, botState, restore } = makeTgEnv();
  const session = { step: "edit_price", productId: "p1" };

  try {
    await handleTextStep(env, 111, "120000", session);
    assert.equal(products.get("p1").price, 120000);
    assert.equal(botState.has("session:111"), false, "سشن بعد از ذخیره باید پاک بشه");
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.some((c) => c.payload.text.includes("به‌روزرسانی")));
  } finally {
    restore();
  }
});

test("handleTextStep: edit_price قیمت نامعتبر رو رد میکنه و دوباره میپرسه", async () => {
  const { env, products, tgCalls, restore } = makeTgEnv();
  const session = { step: "edit_price", productId: "p1" };

  try {
    await handleTextStep(env, 111, "abc", session);
    // قیمت نباید عوض شده باشه
    assert.equal(products.get("p1").price, 85000);
    // باید دوباره سوال بپرسه (forceReply = sendMessage با inline keyboard بازگشت)
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("قیمت"), "باید دوباره قیمت بخواد");
  } finally {
    restore();
  }
});

test("handleTextStep: edit_price ارقام فارسی رو قبول میکنه", async () => {
  const { env, products, restore } = makeTgEnv();
  const session = { step: "edit_price", productId: "p1" };

  try {
    await handleTextStep(env, 111, "۱۵۰۰۰۰", session);
    assert.equal(products.get("p1").price, 150000);
  } finally {
    restore();
  }
});

test("handleTextStep: discount_percent تخفیف معتبر رو اعمال میکنه", async () => {
  const { env, products, restore } = makeTgEnv();
  const session = { step: "discount_percent", productId: "p1" };

  try {
    await handleTextStep(env, 111, "15", session);
    // ۸۵,۰۰۰ × (۱ - ۰.۱۵) = ۷۲,۲۵۰ → رند به ۷۲,۰۰۰
    assert.equal(products.get("p1").price, 72000);
    assert.equal(products.get("p1").originalPrice, 85000, "قیمت اصلی باید ذخیره بشه");
  } finally {
    restore();
  }
});

test("handleTextStep: discount_percent صفر رو رد میکنه", async () => {
  const { env, products, tgCalls, restore } = makeTgEnv();
  const session = { step: "discount_percent", productId: "p1" };

  try {
    await handleTextStep(env, 111, "0", session);
    assert.equal(products.get("p1").price, 85000, "قیمت نباید تغییر کنه");
  } finally {
    restore();
  }
});

test("handleTextStep: bulk_percent پیش‌نمایش تغییر قیمت رو نشون میده", async () => {
  const { env, tgCalls, botState, restore } = makeTgEnv();
  const session = { step: "bulk_percent", catId: "cat1" };

  try {
    await handleTextStep(env, 111, "20", session);
    // باید سشن به bulk_confirm عوض شده باشه
    const newSession = JSON.parse(botState.get("session:111").value);
    assert.equal(newSession.step, "bulk_confirm");
    assert.equal(newSession.percent, 20);
    assert.ok(newSession.items.length > 0);

    // پیش‌نمایش باید اسم محصول و قیمت‌ها رو داشته باشه
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("پیش‌نمایش"));
    assert.ok(last.payload.text.includes("اسپرسو"));
    // دکمه‌های تایید و لغو
    const buttons = last.payload.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some((b) => b.callback_data === "bulkconfirm"));
    assert.ok(buttons.some((b) => b.callback_data === "bulkcancel"));
  } finally {
    restore();
  }
});

test("handleTextStep: bulk_percent درصد نامعتبر رو رد میکنه", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  const session = { step: "bulk_percent", catId: "cat1" };

  try {
    await handleTextStep(env, 111, "abc", session);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.reply_markup?.inline_keyboard, "باید forceReply (با دکمه بازگشت) باشه");
  } finally {
    restore();
  }
});

test("handleTextStep: new_category_label → new_category_image سشن رو آپدیت میکنه", async () => {
  const { env, botState, tgCalls, restore } = makeTgEnv();
  const session = { step: "new_category_label" };

  try {
    await handleTextStep(env, 111, "نوشیدنی سرد", session);
    const newSession = JSON.parse(botState.get("session:111").value);
    assert.equal(newSession.step, "new_category_image");
    assert.equal(newSession.label, "نوشیدنی سرد");
    assert.ok(newSession.id, "باید شناسه‌ی خودکار ساخته شده باشه");
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("عکس"), "باید عکس بخواد");
  } finally {
    restore();
  }
});

test("handleTextStep: new_category_image «بدون عکس» دسته رو بدون عکس میسازه", async () => {
  const { env, categories, botState, tgCalls, restore } = makeTgEnv();
  const catId = "cat-test-123";
  botState.set("session:111", {
    value: JSON.stringify({ step: "new_category_image", id: catId, label: "دسر‌ها" }),
    expires_at: null,
  });
  const session = { step: "new_category_image", id: catId, label: "دسر‌ها" };

  try {
    await handleTextStep(env, 111, "بدون عکس", session);
    assert.ok(categories.has(catId), "دسته باید ساخته شده باشه");
    assert.equal(categories.get(catId).label, "دسر‌ها");
    assert.equal(categories.get(catId).image, null);
    assert.equal(botState.has("session:111"), false, "سشن باید پاک بشه");
  } finally {
    restore();
  }
});

test("handleTextStep: new_product_name → note → price → image (بدون عکس) فلوی کامل", async () => {
  const { env, products, botState, restore } = makeTgEnv();

  try {
    // مرحله ۱: اسم
    let session = { step: "new_product_name", catId: "cat1" };
    await handleTextStep(env, 111, "موکا", session);
    let s = JSON.parse(botState.get("session:111").value);
    assert.equal(s.step, "new_product_note");
    assert.equal(s.name, "موکا");

    // مرحله ۲: توضیح
    session = s;
    await handleTextStep(env, 111, "شکلاتی و خوشمزه", session);
    s = JSON.parse(botState.get("session:111").value);
    assert.equal(s.step, "new_product_price");
    assert.equal(s.note, "شکلاتی و خوشمزه");

    // مرحله ۳: قیمت
    session = s;
    await handleTextStep(env, 111, "95000", session);
    s = JSON.parse(botState.get("session:111").value);
    assert.equal(s.step, "new_product_image");
    assert.equal(s.price, 95000);
    assert.ok(s.productId, "باید شناسه محصول ساخته شده باشه");

    // مرحله ۴: بدون عکس
    session = s;
    await handleTextStep(env, 111, "بدون عکس", session);
    // محصول باید تو دیتابیس ذخیره شده باشه
    const saved = products.get(s.productId);
    assert.ok(saved, "محصول باید ذخیره شده باشه");
    assert.equal(saved.name, "موکا");
    assert.equal(saved.note, "شکلاتی و خوشمزه");
    assert.equal(saved.price, 95000);
    assert.equal(saved.image, null);
    assert.equal(botState.has("session:111"), false, "سشن باید پاک شده باشه");
  } finally {
    restore();
  }
});

test("handleTextStep: new_product_price قیمت نامعتبر رو رد و دوباره میپرسه", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  const session = { step: "new_product_price", catId: "cat1", name: "تست", note: "تست" };

  try {
    await handleTextStep(env, 111, "500", session); // کمتر از MIN_PRICE
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("قیمت"), "باید دوباره قیمت بخواد");
  } finally {
    restore();
  }
});

test("handleTextStep: بدون سشن معتبر به منوی اصلی برمیگرده", async () => {
  const { env, tgCalls, botState, restore } = makeTgEnv();
  const session = { step: "nonexistent_step" };

  try {
    await handleTextStep(env, 111, "سلام", session);
    assert.equal(botState.has("session:111"), false, "سشن باید پاک بشه");
  } finally {
    restore();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── handleImageStep (آپلود عکس) ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ساخت mock برای پیام عکس تلگرام — downloadTelegramFile یه fetch به API تلگرام میزنه
// پس باید fetch رو mock کنیم تا فایل بایت‌های JPEG برگردونه

function makeTgEnvWithImageFetch(overrides = {}) {
  const ctx = makeTgEnv(overrides);
  const origFetch = globalThis.fetch;
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);

    // فایل دانلود (file/bot.../photos/test.jpg)
    if (urlStr.includes("/file/bot")) {
      return {
        ok: true,
        arrayBuffer: async () => jpegBytes.buffer,
      };
    }

    if (urlStr.includes("api.telegram.org")) {
      const method = urlStr.split("/").pop();

      // getFile
      if (method === "getFile") {
        let payload = {};
        try { payload = JSON.parse(opts?.body || "{}"); } catch {}
        ctx.tgCalls.push({ method, payload });
        return {
          ok: true,
          json: async () => ({
            ok: true,
            result: { file_path: "photos/test.jpg", file_size: jpegBytes.length },
          }),
        };
      }

      // sendMessage/deleteMessage/etc
      let payload = {};
      try { payload = JSON.parse(opts?.body || "{}"); } catch {}
      const msgId = Date.now();
      ctx.tgCalls.push({ method, payload, msgId });
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: msgId } }),
      };
    }

    return origFetch(url, opts);
  };

  ctx.restore = () => { globalThis.fetch = origFetch; };
  return ctx;
}

test("handleImageStep: edit_site_logo عکس لوگو رو از تلگرام آپلود و ذخیره میکنه", async () => {
  const { env, kv, siteSettings, tgCalls, botState, restore } = makeTgEnvWithImageFetch();
  const session = { step: "edit_site_logo" };
  const msg = { photo: [{ file_id: "photo_small" }, { file_id: "photo_large" }] };

  try {
    await handleImageStep(env, 111, msg, session);
    // باید عکس تو KV ذخیره شده باشه
    const logoKeys = [...kv.keys()].filter((k) => k.startsWith("image:site-logo-"));
    assert.ok(logoKeys.length >= 1, "عکس لوگو باید تو KV ذخیره بشه");
    // باید تو site_settings ست شده باشه
    assert.ok(siteSettings.has("logo"), "لوگو باید تو تنظیمات سایت ست بشه");
    // باید پیام موفقیت فرستاده شده باشه
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.some((c) => c.payload.text.includes("لوگو")));
    // سشن باید پاک شده باشه
    assert.equal(botState.has("session:111"), false);
  } finally {
    restore();
  }
});

test("handleImageStep: edit_site_cover عکس کاور رو آپلود میکنه", async () => {
  const { env, kv, siteSettings, botState, restore } = makeTgEnvWithImageFetch();
  const session = { step: "edit_site_cover" };
  const msg = { photo: [{ file_id: "cover_photo" }] };

  try {
    await handleImageStep(env, 111, msg, session);
    const coverKeys = [...kv.keys()].filter((k) => k.startsWith("image:site-cover-"));
    assert.ok(coverKeys.length >= 1, "عکس کاور باید تو KV ذخیره بشه");
    assert.ok(siteSettings.has("cover"), "کاور باید تو تنظیمات سایت ست بشه");
    assert.equal(botState.has("session:111"), false);
  } finally {
    restore();
  }
});

test("handleImageStep: edit_site_logo عکس قبلی رو از KV حذف میکنه", async () => {
  const { env, kv, siteSettings, restore } = makeTgEnvWithImageFetch({
    siteSettings: new Map([["logo", "images/site-logo-old.jpg"]]),
  });
  kv.set("image:site-logo-old.jpg", { value: new ArrayBuffer(8) });
  const session = { step: "edit_site_logo" };
  const msg = { photo: [{ file_id: "new_logo" }] };

  try {
    await handleImageStep(env, 111, msg, session);
    assert.equal(kv.has("image:site-logo-old.jpg"), false, "عکس قبلی باید از KV حذف بشه");
    // عکس جدید باید باشه
    const newKeys = [...kv.keys()].filter((k) => k.startsWith("image:site-logo-") && k !== "image:site-logo-old.jpg");
    assert.ok(newKeys.length >= 1, "عکس جدید باید اضافه شده باشه");
  } finally {
    restore();
  }
});

test("handleImageStep: edit_product_image عکس محصول رو آپلود و ذخیره میکنه", async () => {
  const { env, products, kv, botState, restore } = makeTgEnvWithImageFetch();
  const session = { step: "edit_product_image", productId: "p1" };
  const msg = { photo: [{ file_id: "prod_photo" }] };

  try {
    await handleImageStep(env, 111, msg, session);
    const p = products.get("p1");
    assert.ok(p.image, "محصول باید عکس داشته باشه");
    assert.match(p.image, /^\/images\/p1_\d+\.jpg$/);
    assert.equal(botState.has("session:111"), false);
  } finally {
    restore();
  }
});

test("handleImageStep: edit_category_image عکس دسته رو آپلود و ذخیره میکنه", async () => {
  const { env, categories, kv, botState, restore } = makeTgEnvWithImageFetch();
  const session = { step: "edit_category_image", catId: "cat1" };
  const msg = { photo: [{ file_id: "cat_photo" }] };

  try {
    await handleImageStep(env, 111, msg, session);
    const cat = categories.get("cat1");
    assert.ok(cat.image, "دسته باید عکس داشته باشه");
    assert.match(cat.image, /^\/images\/cat_cat1_\d+\.jpg$/);
    assert.equal(botState.has("session:111"), false);
  } finally {
    restore();
  }
});

test("handleImageStep: new_category_image دسته جدید رو با عکس میسازه", async () => {
  const { env, categories, botState, restore } = makeTgEnvWithImageFetch();
  const session = { step: "new_category_image", id: "cat-new-1", label: "نوشیدنی گرم" };
  const msg = { photo: [{ file_id: "new_cat_photo" }] };

  try {
    await handleImageStep(env, 111, msg, session);
    assert.ok(categories.has("cat-new-1"), "دسته جدید باید ساخته شده باشه");
    assert.equal(categories.get("cat-new-1").label, "نوشیدنی گرم");
    assert.ok(categories.get("cat-new-1").image, "عکس دسته باید ست شده باشه");
    assert.match(categories.get("cat-new-1").image, /^\/images\/cat_cat-new-1_\d+\.jpg$/);
    assert.equal(botState.has("session:111"), false);
  } finally {
    restore();
  }
});

test("handleImageStep: new_product_image محصول جدید رو با عکس ذخیره میکنه", async () => {
  const { env, products, botState, restore } = makeTgEnvWithImageFetch();
  const session = {
    step: "new_product_image",
    productId: "p-new-1",
    catId: "cat1",
    name: "کاپوچینو",
    note: "کف شیر غلیظ",
    price: 110000,
  };
  const msg = { photo: [{ file_id: "new_prod_photo" }] };

  try {
    await handleImageStep(env, 111, msg, session);
    const p = products.get("p-new-1");
    assert.ok(p, "محصول جدید باید ساخته شده باشه");
    assert.equal(p.name, "کاپوچینو");
    assert.equal(p.note, "کف شیر غلیظ");
    assert.equal(p.price, 110000);
    assert.equal(p.image, "/images/p-new-1.jpg");
    assert.equal(botState.has("session:111"), false);
  } finally {
    restore();
  }
});

test("handleImageStep: فایل document (نه photo) هم قبول میشه", async () => {
  const { env, products, restore } = makeTgEnvWithImageFetch();
  const session = { step: "edit_product_image", productId: "p1" };
  const msg = { document: { file_id: "doc_photo", mime_type: "image/png" } };

  try {
    await handleImageStep(env, 111, msg, session);
    assert.ok(products.get("p1").image, "عکس باید از document هم ذخیره بشه");
  } finally {
    restore();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── handleCallback: bulkconfirm / bulkcancel ────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

test("handleCallback: bulkconfirm قیمت‌ها رو اعمال و سشن رو پاک میکنه", async () => {
  const { env, products, botState, tgCalls, restore } = makeTgEnv();
  // سشن bulk_confirm با پیش‌نمایش‌ها
  const sessionData = {
    step: "bulk_confirm",
    catId: "cat1",
    percent: 20,
    items: [{ id: "p1", oldPrice: 85000, newPrice: 102000 }],
  };
  botState.set("session:111", { value: JSON.stringify(sessionData), expires_at: null });

  try {
    await handleCallback(env, 111, "bulkconfirm", null);
    assert.equal(products.get("p1").price, 102000, "قیمت باید آپدیت شده باشه");
    assert.equal(botState.has("session:111"), false, "سشن باید پاک شده باشه");
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.some((c) => c.payload.text.includes("به‌روزرسانی")));
  } finally {
    restore();
  }
});

test("handleCallback: bulkcancel سشن رو پاک و پیام لغو میفرسته", async () => {
  const { env, botState, tgCalls, restore } = makeTgEnv();
  botState.set("session:111", {
    value: JSON.stringify({ step: "bulk_confirm", catId: "cat1", percent: 10, items: [] }),
    expires_at: null,
  });

  try {
    await handleCallback(env, 111, "bulkcancel", null);
    assert.equal(botState.has("session:111"), false);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.some((c) => c.payload.text.includes("لغو")));
  } finally {
    restore();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── handleCallback: siteimg:cleanup ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

test("handleCallback: siteimg:cleanup وقتی عکس اضافی نداریم پیام تمیز بودن میده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleCallback(env, 111, "siteimg:cleanup", null);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("تمیز"), "باید بگه همه‌چیز تمیزه");
  } finally {
    restore();
  }
});

test("handleCallback: siteimg:cleanup وقتی عکس یتیم داریم تاییدیه حذف میخواد", async () => {
  const { env, kv, tgCalls, restore } = makeTgEnv();
  // یه عکس یتیم بدون metadata اضافه کن (بدون uploadedAt ← grace period رد شده حساب میشه)
  kv.set("image:orphan_old.jpg", { value: new ArrayBuffer(8) });

  try {
    await handleCallback(env, 111, "siteimg:cleanup", null);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("پیدا شد"), "باید تعداد عکس‌های یتیم رو بگه");
    const buttons = last.payload.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some((b) => b.callback_data === "cleanupyes"), "دکمه‌ی تایید حذف باید باشه");
  } finally {
    restore();
  }
});

test("handleCallback: cleanupyes عکس‌های یتیم رو واقعاً حذف میکنه", async () => {
  const { env, kv, tgCalls, restore } = makeTgEnv();
  kv.set("image:orphan1.jpg", { value: new ArrayBuffer(8) });
  kv.set("image:orphan2.png", { value: new ArrayBuffer(8) });

  try {
    await handleCallback(env, 111, "cleanupyes", null);
    assert.equal(kv.has("image:orphan1.jpg"), false, "عکس یتیم ۱ باید حذف شده باشه");
    assert.equal(kv.has("image:orphan2.png"), false, "عکس یتیم ۲ باید حذف شده باشه");
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.some((c) => c.payload.text.includes("پاک شد")));
  } finally {
    restore();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── handleUpdate: دکمه‌های کیبورد اصلی ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

test("handleUpdate: دکمه‌ی «🏷 دسته‌بندی‌ها» منوی دسته‌ها رو نشون میده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleUpdate({
      message: {
        message_id: 10, chat: { id: 111 }, from: { id: 111 },
        text: "🏷 دسته‌بندی‌ها",
      },
    }, env);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("دسته‌بندی"), "باید عنوان دسته‌بندی‌ها رو نشون بده");
    const buttons = last.payload.reply_markup?.inline_keyboard?.flat() || [];
    assert.ok(buttons.some((b) => b.text.includes("افزودن")), "دکمه‌ی افزودن دسته جدید باید باشه");
  } finally {
    restore();
  }
});

test("handleUpdate: دکمه‌ی «💰 تغییر قیمت دسته‌جمعی» لیست دسته‌ها رو با مد bulk نشون میده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleUpdate({
      message: {
        message_id: 11, chat: { id: 111 }, from: { id: 111 },
        text: "💰 تغییر قیمت دسته‌جمعی",
      },
    }, env);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    // دکمه‌ها باید callback_data شامل catpick:bulk داشته باشن
    const buttons = last.payload.reply_markup?.inline_keyboard?.flat() || [];
    assert.ok(buttons.some((b) => b.callback_data?.includes("catpick:bulk")), "باید مد bulk باشه");
  } finally {
    restore();
  }
});

test("handleUpdate: دکمه‌ی «🖼 تصاویر سایت» منوی تصاویر رو نشون میده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleUpdate({
      message: {
        message_id: 12, chat: { id: 111 }, from: { id: 111 },
        text: "🖼 تصاویر سایت",
      },
    }, env);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    const last = sends[sends.length - 1];
    assert.ok(last.payload.text.includes("تصاویر"), "باید عنوان تصاویر رو نشون بده");
    const buttons = last.payload.reply_markup?.inline_keyboard?.flat() || [];
    assert.ok(buttons.some((b) => b.callback_data === "siteimg:logo"), "دکمه‌ی لوگو باید باشه");
    assert.ok(buttons.some((b) => b.callback_data === "siteimg:cover"), "دکمه‌ی کاور باید باشه");
  } finally {
    restore();
  }
});

test("handleUpdate: پیام بدون سشن فعال به منوی اصلی برمیگرده", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleUpdate({
      message: {
        message_id: 13, chat: { id: 111 }, from: { id: 111 },
        text: "یه متن تصادفی",
      },
    }, env);
    const sends = tgCalls.filter((c) => c.method === "sendMessage");
    assert.ok(sends.length >= 1, "باید منوی اصلی فرستاده بشه");
  } finally {
    restore();
  }
});

test("handleUpdate: callback_query از ادمین معتبر answerCallback میزنه و هندل میشه", async () => {
  const { env, tgCalls, restore } = makeTgEnv();
  try {
    await handleUpdate({
      callback_query: {
        id: "cq100",
        message: { chat: { id: 111 } },
        from: { id: 111 },
        data: "menu:home",
      },
    }, env);
    const answers = tgCalls.filter((c) => c.method === "answerCallbackQuery");
    assert.ok(answers.length >= 1, "باید answerCallbackQuery صدا زده بشه");
  } finally {
    restore();
  }
});
