import { createOrder } from "../data/orders.js";
import { sendRaw, getAdminIds } from "../telegram/api.js";
import { formatToman, escapeHtml } from "../telegram/format.js";
import { ORDER_RATE_LIMIT_MAX, ORDER_RATE_LIMIT_WINDOW_SEC } from "../config.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const MAX_QTY = 50;
const MAX_LINES = 30; // سقف تعداد ردیف سبد؛ هم جلوی سوءاستفاده رو می‌گیره هم IN(...) رو کوچیک نگه می‌داره
const TABLE_COUNT = 20; // باید با TABLE_COUNT تو public/js/script.js یکی باشه

// جلوگیری از سفارش تکراری: کلاینت برای هر «تلاش ثبت» یه کلید یکتا می‌فرسته. اگه سفارش ثبت بشه ولی جواب به
// گوشی نرسه و مشتری دوباره بزنه، همون سفارش قبلی برمی‌گرده و دوباره ثبت (و به گارسون اطلاع) نمیشه.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

export async function hashIp(ip) {
  if (!ip) return "";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatOrderMessage({ orderId, tableNumber, items, total }) {
  const lines = items
    .map((it) => `• ${escapeHtml(it.name)} × ${it.quantity} — ${formatToman(it.price * it.quantity)}`)
    .join("\n");
  const time = new Date().toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tehran",
  });
  return (
    `🧾 <b>سفارش جدید #${orderId}</b> — میز ${escapeHtml(tableNumber)}\n\n` +
    `${lines}\n\n` +
    `<b>جمع کل:</b> ${formatToman(total)}\n` +
    `⏰ ساعت ثبت: ${time}`
  );
}

// همه‌ی محصولات سبد با یه کوئری (به‌جای یه کوئری برای هر آیتم)
async function loadProducts(env, ids) {
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB
    .prepare(`SELECT id, name, price, available FROM products WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();
  return new Map(results.map((p) => [p.id, p]));
}

// اطلاع به همه‌ی ادمین‌ها؛ با sendRaw (نه sendMessage) تا وارد چرخه‌ی
// پاک‌شدن خودکار پیام‌های منوی ربات نشه — هر سفارش پیام مستقل خودشو داره.
// سفارش قبلاً تو دیتابیس ثبت شده، پس هر خطایی اینجا (تلگرام قطع، KV و ...) فقط لاگ میشه
// و نباید به مشتری «خطا» نشون بده (وگرنه دوباره می‌زنه و سفارش تکراری ثبت میشه).
async function notifyAdmins(env, { orderId, tableNumber, items, total }) {
  try {
    const adminIds = getAdminIds(env);
    if (adminIds.length === 0) return;

    const text = formatOrderMessage({ orderId, tableNumber, items, total });
    const keyboard = [[
      { text: "✅ تایید سفارش", callback_data: `order:confirm:${orderId}` },
      { text: "❌ رد سفارش", callback_data: `order:reject:${orderId}` },
    ]];

    // allSettled: اگه برای یه ادمین ارسال شکست خورد، بقیه همچنان پیام می‌گیرن
    const results = await Promise.allSettled(
      adminIds.map((chatId) =>
        sendRaw(env, { chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } })
      )
    );
    const entries = adminIds
      .map((chatId, i) => ({
        chatId,
        messageId: results[i].status === "fulfilled" ? results[i].value?.result?.message_id : undefined,
      }))
      .filter((e) => e.messageId);

    if (entries.length > 0) {
      await env.PRODUCTS_KV.put(
        `order:msgs:${orderId}`,
        JSON.stringify({ text, entries }),
        { expirationTtl: 60 * 60 * 24 * 3 } // ۳ روز کافیه؛ بعدش پیام‌ها بی‌ربط شدن
      );
    }
  } catch (err) {
    console.error(`[orders:notify] order ${orderId}:`, err);
  }
}

// ctx اختیاریه: اگه index.js پاسش بده، اطلاع‌رسانی تلگرام بعد از جواب دادن به مشتری انجام میشه
// (مشتری منتظر رفت‌وبرگشت تلگرام نمی‌مونه)؛ وگرنه مثل قبل صبر می‌کنیم.
export async function handleOrdersAPI(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/orders" || request.method !== "POST") {
    return json({ error: "مسیر پیدا نشد" }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "درخواست نامعتبر است" }, 400);
  }

  // فیلد هانی‌پات ضد ربات: اگر پر شده باشد، پاسخ ۲۰۰ صوری برمی‌گردد بدون ثبت در دیتابیس یا نوتیفیکیشن
  if (body?.hp_website || body?.website || body?.honeypot) {
    return json({ ok: true, orderId: 0 });
  }

  // شماره‌ی میز باید یه عدد بین ۱ تا TABLE_COUNT باشه (همون چیزی که پاپ‌آپ سایت می‌فرسته)
  const tableRaw = String(body?.table ?? "").trim();
  if (!tableRaw) return json({ error: "شماره میز را وارد کنید" }, 400);
  const tableNum = /^\d{1,3}$/.test(tableRaw) ? Number(tableRaw) : NaN;
  if (!Number.isInteger(tableNum) || tableNum < 1 || tableNum > TABLE_COUNT) {
    return json({ error: "شماره میز نامعتبر است" }, 400);
  }
  const tableNumber = String(tableNum);

  // جلوگیری از سفارش تکراری: اول در D1 بررسی می‌کنیم (requestId یا idempotencyKey قدیمی)
  const reqIdRaw = typeof body?.requestId === "string"
    ? body.requestId
    : typeof body?.idempotencyKey === "string"
      ? body.idempotencyKey
      : "";
  const requestId = IDEMPOTENCY_KEY_RE.test(reqIdRaw) ? reqIdRaw : null;
  if (requestId) {
    try {
      const existing = await env.DB
        .prepare("SELECT id FROM orders WHERE request_id = ?")
        .bind(requestId)
        .first();
      if (existing?.id) {
        return json({ ok: true, orderId: existing.id, duplicate: true });
      }
    } catch (err) {
      console.error("[orders:requestId:check]", err);
    }
  }

  // محدودیت نرخ بر اساس هش IP (هرگز IP خام ذخیره نمی‌شود)
  const clientIp = request.headers.get("cf-connecting-ip") || "";
  const ipHash = clientIp ? await hashIp(clientIp) : null;

  if (ipHash) {
    if (env.RATE_LIMITER?.limit) {
      const { success } = await env.RATE_LIMITER.limit({ key: `order:${ipHash}` });
      if (!success) {
        return json({ error: "تعداد سفارش‌ها از حد مجاز بیشتر است. لطفاً چند دقیقه دیگر امتحان کنید." }, 429);
      }
    } else {
      try {
        const windowStart = new Date(Date.now() - ORDER_RATE_LIMIT_WINDOW_SEC * 1000)
          .toISOString()
          .slice(0, 19)
          .replace("T", " ");
        const countRow = await env.DB
          .prepare("SELECT COUNT(*) AS c FROM orders WHERE ip_hash = ? AND created_at >= ?")
          .bind(ipHash, windowStart)
          .first();
        if ((countRow?.c ?? 0) >= ORDER_RATE_LIMIT_MAX) {
          return json({ error: "تعداد سفارش‌ها از حد مجاز بیشتر است. لطفاً چند دقیقه دیگر امتحان کنید." }, 429);
        }
      } catch (err) {
        console.error("[orders:ratelimit:check]", err);
      }
    }
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length === 0) return json({ error: "سبد خرید خالی است" }, 400);
  if (rawItems.length > MAX_LINES) return json({ error: "تعداد آیتم‌های سبد بیش از حد مجاز است" }, 400);

  // آیتم‌های تکراری ادغام میشن (جمع تعدادشون هم نباید از سقف رد بشه)
  const qtyById = new Map();
  for (const raw of rawItems) {
    const id = String(raw?.id ?? "");
    const quantity = Number(raw?.quantity);
    if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return json({ error: "آیتم سبد خرید نامعتبر است" }, 400);
    }
    const merged = (qtyById.get(id) || 0) + quantity;
    if (merged > MAX_QTY) return json({ error: "آیتم سبد خرید نامعتبر است" }, 400);
    qtyById.set(id, merged);
  }

  // هیچ‌وقت به قیمت/اسمی که کلاینت فرستاده اعتماد نمی‌کنیم؛ همه‌چیز از خود دیتابیس خونده میشه
  const products = await loadProducts(env, [...qtyById.keys()]);
  const items = [];
  for (const [id, quantity] of qtyById) {
    const product = products.get(id);
    if (!product) return json({ error: `محصولی با این مشخصات پیدا نشد` }, 400);
    if (!product.available) return json({ error: `«${product.name}» در حال حاضر موجود نیست` }, 400);
    if (product.price <= 0) return json({ error: "قیمت محصول نامعتبر است" }, 400);
    items.push({ id: product.id, name: product.name, price: product.price, quantity });
  }

  const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);

  let orderId;
  try {
    orderId = await createOrder(env, { tableNumber, items, total, requestId, ipHash });
  } catch (err) {
    if (requestId && /UNIQUE constraint failed.*request_id/i.test(err?.message || "")) {
      const existing = await env.DB
        .prepare("SELECT id FROM orders WHERE request_id = ?")
        .bind(requestId)
        .first();
      if (existing?.id) {
        return json({ ok: true, orderId: existing.id, duplicate: true });
      }
    }
    throw err;
  }

  const notify = notifyAdmins(env, { orderId, tableNumber, items, total });
  if (ctx?.waitUntil) ctx.waitUntil(notify);
  else await notify;

  return json({ ok: true, orderId });
}