import { createOrder, getOrderStatusByPublicId } from "../data/orders.js";
import { getSiteConfig } from "../data/site.js";
import { memo, SITE_CACHE_KEY } from "../data/cache.js";
import { sendRaw, getAdminIds } from "../telegram/api.js";
import { formatToman, escapeHtml, toFa } from "../telegram/format.js";
import { getOpenStatus, nextOpening } from "../lib/hours.js";
import { verifyTableSig } from "../lib/tableSig.js";
import {
  ORDER_RATE_LIMIT_MAX,
  ORDER_RATE_LIMIT_WINDOW_SEC,
  TABLE_PENDING_ORDER_LIMIT_MAX,
  TABLE_PENDING_ORDER_WINDOW_SEC,
  OPENING_HOURS,
} from "../config.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const statusRateLimits = new Map();
function checkStatusRateLimit(ip) {
  const now = Date.now();
  const entry = statusRateLimits.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + 60000;
  } else {
    entry.count++;
  }
  statusRateLimits.set(ip, entry);
  if (statusRateLimits.size > 2000) {
    for (const [k, v] of statusRateLimits) {
      if (now > v.resetAt) statusRateLimits.delete(k);
    }
  }
  return entry.count <= 180;
}

const MAX_QTY = 50;
const MAX_LINES = 30; // سقف تعداد ردیف سبد؛ هم جلوی سوءاستفاده رو می‌گیره هم IN(...) رو کوچیک نگه می‌داره

// جلوگیری از سفارش تکراری: کلاینت برای هر «تلاش ثبت» یه کلید یکتا می‌فرسته. اگه سفارش ثبت بشه ولی جواب به
// گوشی نرسه و مشتری دوباره بزنه، همون سفارش قبلی برمی‌گرده و دوباره ثبت (و به گارسون اطلاع) نمیشه.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

const DEFAULT_IP_HASH_SECRET = "cafe-roshan-ip-hash-default-fallback-key";
let warnedMissingIpSecret = false;

export async function hashIp(ip, secret) {
  if (!ip) return "";
  let keyString = secret;
  if (!keyString) {
    if (!warnedMissingIpSecret) {
      console.warn("[orders:hashIp] IP_HASH_SECRET is not configured; using fallback secret.");
      warnedMissingIpSecret = true;
    }
    keyString = DEFAULT_IP_HASH_SECRET;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyString),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(ip));
  return Array.from(new Uint8Array(sig))
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
export async function notifyAdmins(env, { orderId, tableNumber, items, total }) {
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
      const tgPayload = JSON.stringify({ text, entries });
      try {
        await env.DB
          .prepare("UPDATE orders SET tg_messages = ?, tg_notified = 1 WHERE id = ?")
          .bind(tgPayload, orderId)
          .run();
      } catch (err) {
        console.error("[orders:save_tg_messages]", err);
      }
    }
  } catch (err) {
    console.error(`[orders:notify] order ${orderId}:`, err);
  }
}

// پیام «کافه بسته‌ست»؛ سایت هم کنار دکمه‌ی ثبت سفارش همین متن رو نشون میده
function closedMessage(hours) {
  const next = nextOpening(hours);
  const nextTxt = next ? ` ${next.when} از ساعت ${toFa(next.time)} سفارش می‌گیریم.` : "";
  return `کافه الان بسته است و سفارش ثبت نمی‌شود.${nextTxt}`;
}

// ctx اختیاریه: اگه index.js پاسش بده، اطلاع‌رسانی تلگرام بعد از جواب دادن به مشتری انجام میشه
// (مشتری منتظر رفت‌وبرگشت تلگرام نمی‌مونه)؛ وگرنه مثل قبل صبر می‌کنیم.
export async function handleOrdersAPI(request, env, ctx) {
  const url = new URL(request.url);

  // بررسی وضعیت سفارش با publicId
  const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (statusMatch && request.method === "GET") {
    const publicId = statusMatch[1];
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!checkStatusRateLimit(ip)) {
      return json({ error: "تعداد درخواست‌ها بیش از حد مجاز است." }, 429);
    }
    const order = await getOrderStatusByPublicId(env, publicId);
    if (!order) {
      return json({ error: "سفارش پیدا نشد" }, 404);
    }
    return json({ status: order.status }, 200);
  }

  if (url.pathname !== "/api/orders" || request.method !== "POST") {
    return json({ error: "مسیر پیدا نشد" }, 404);
  }

  const clHeader = request.headers.get("content-length");
  if (clHeader && Number(clHeader) > 16 * 1024) {
    return json({ error: "حجم درخواست بیش از حد مجاز است" }, 413);
  }

  let body;
  try {
    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > 16 * 1024) {
      return json({ error: "حجم درخواست بیش از حد مجاز است" }, 413);
    }
    body = JSON.parse(rawText);
  } catch {
    return json({ error: "درخواست نامعتبر است" }, 400);
  }

  // فیلد هانی‌پات ضد ربات: اگر پر شده باشد، پاسخ ۲۰۰ صوری برمی‌گردد بدون ثبت در دیتابیس یا نوتیفیکیشن
  if (body?.hp_website) {
    return json({ ok: true, orderId: 0 });
  }

  // شماره‌ی میز باید یه عدد بین ۱ تا tableCount تنظیمات سایت باشه (همون چیزی که پاپ‌آپ سایت می‌فرسته)
  const tableRaw = String(body?.table ?? "").trim();
  if (!tableRaw) return json({ error: "شماره میز را وارد کنید" }, 400);
  const tableNum = /^\d{1,3}$/.test(tableRaw) ? Number(tableRaw) : NaN;
  const siteCfg = await memo(SITE_CACHE_KEY, () => getSiteConfig(env)).catch(() => ({ tableCount: 20 }));
  const tableCount = siteCfg.tableCount ?? 20;
  if (!Number.isInteger(tableNum) || tableNum < 1 || tableNum > tableCount) {
    return json({ error: "شماره میز نامعتبر است" }, 400);
  }
  const tableNumber = String(tableNum);

  // در صورت فعال بودن TABLE_SIGNING_SECRET، امضای معتبر میز برای ثبت سفارش الزامی است
  if (env.TABLE_SIGNING_SECRET) {
    const tableSig = typeof body?.tableSig === "string" ? body.tableSig : "";
    const valid = await verifyTableSig(tableNumber, tableSig, env.TABLE_SIGNING_SECRET);
    if (!valid) {
      return json({ error: "امضای میز نامعتبر است. لطفاً کد QR روی میز را اسکن کنید." }, 403);
    }
  }

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
        .prepare("SELECT id, public_id, total FROM orders WHERE request_id = ?")
        .bind(requestId)
        .first();
      if (existing?.id) {
        return json({ ok: true, orderId: existing.id, publicId: existing.public_id, total: existing.total, duplicate: true });
      }
    } catch (err) {
      console.error("[orders:requestId:check]", err);
    }
  }

  // ثبت سفارش فقط تو ساعت کاری (به وقت تهران)؛ ساعت‌ها از OPENING_HOURS تو src/config.js میان.
  // عمداً بعد از چک ضدتکرار: اگه سفارشی درست قبل از بسته شدن ثبت شده و گوشی مشتری جوابش رو نگرفته،
  // تلاش مجدد بعد از بسته شدن همون سفارش قبلی رو برمی‌گردونه، نه خطای «بسته‌ایم».
  // برای تست خارج از ساعت کاری، متغیر ENFORCE_ORDER_HOURS رو "0" کن.
  if (String(env.ENFORCE_ORDER_HOURS ?? "1") !== "0") {
    const hours = siteCfg.hours ?? OPENING_HOURS;
    if (!getOpenStatus(hours).open) {
      return json({ error: closedMessage(hours), closed: true }, 403);
    }
  }

  // محدودیت نرخ بر اساس هش IP (هرگز IP خام ذخیره نمی‌شود)
  const clientIp = request.headers.get("cf-connecting-ip") || "";
  const ipHash = clientIp ? await hashIp(clientIp, env.IP_HASH_SECRET) : null;

  if (ipHash) {
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

  // سقف سفارش‌های در انتظار تایید به ازای هر میز: جلوگیری از ارسال سفارش‌های جعلی برای یک میز
  try {
    const tableWindowStart = new Date(Date.now() - TABLE_PENDING_ORDER_WINDOW_SEC * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const tablePendingRow = await env.DB
      .prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending' AND table_number = ? AND created_at >= ?")
      .bind(tableNumber, tableWindowStart)
      .first();
    if ((tablePendingRow?.c ?? 0) >= TABLE_PENDING_ORDER_LIMIT_MAX) {
      return json({ error: "تعداد سفارش‌های در انتظار بررسی برای این میز بیش از حد مجاز است. لطفاً منتظر بمانید." }, 429);
    }
  } catch (err) {
    console.error("[orders:table_pending:check]", err);
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

  let orderResult;
  try {
    orderResult = await createOrder(env, { tableNumber, items, total, requestId, ipHash });
  } catch (err) {
    if (requestId && /UNIQUE constraint failed.*request_id/i.test(err?.message || "")) {
      const existing = await env.DB
        .prepare("SELECT id, public_id, total FROM orders WHERE request_id = ?")
        .bind(requestId)
        .first();
      if (existing?.id) {
        return json({ ok: true, orderId: existing.id, publicId: existing.public_id, total: existing.total, duplicate: true });
      }
    }
    throw err;
  }

  const { orderId, publicId } = orderResult;

  const notify = notifyAdmins(env, { orderId, tableNumber, items, total });
  if (ctx?.waitUntil) ctx.waitUntil(notify);
  else await notify;

  return json({ ok: true, orderId, publicId, total });
}