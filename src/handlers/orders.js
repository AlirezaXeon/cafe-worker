import { findProduct } from "../data/products.js";
import { createOrder } from "../data/orders.js";
import { sendRaw, getAdminIds } from "../telegram/api.js";
import { formatToman, escapeHtml } from "../telegram/format.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const MAX_QTY = 50;

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
    `🧾 <b>سفارش جدید</b> — میز ${escapeHtml(tableNumber)}\n\n` +
    `${lines}\n\n` +
    `<b>جمع کل:</b> ${formatToman(total)}\n` +
    `⏰ ساعت ثبت: ${time}`
  );
}

export async function handleOrdersAPI(request, env) {
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

  const tableNumber = String(body?.table ?? "").trim();
  if (!tableNumber) return json({ error: "شماره میز را وارد کنید" }, 400);
  if (tableNumber.length > 20) return json({ error: "شماره میز نامعتبر است" }, 400);

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length === 0) return json({ error: "سبد خرید خالی است" }, 400);

  // هیچ‌وقت به قیمت/اسمی که کلاینت فرستاده اعتماد نمی‌کنیم؛ همه‌چیز از خود دیتابیس دوباره خونده میشه
  const items = [];
  for (const raw of rawItems) {
    const id = String(raw?.id ?? "");
    const quantity = Number(raw?.quantity);
    if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return json({ error: "آیتم سبد خرید نامعتبر است" }, 400);
    }
    const product = await findProduct(env, id);
    if (!product) return json({ error: `محصولی با این مشخصات پیدا نشد` }, 400);
    if (!product.available) return json({ error: `«${product.name}» در حال حاضر موجود نیست` }, 400);
    items.push({ id: product.id, name: product.name, price: product.price, quantity });
  }

  const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);

  const orderId = await createOrder(env, { tableNumber, items, total });

  // اطلاع به همه‌ی ادمین‌ها؛ با sendRaw (نه sendMessage) تا وارد چرخه‌ی
  // پاک‌شدن خودکار پیام‌های منوی ربات نشه — هر سفارش پیام مستقل خودشو داره
  const adminIds = getAdminIds(env);
  const text = formatOrderMessage({ orderId, tableNumber, items, total });
  const keyboard = [[
    { text: "✅ تایید سفارش", callback_data: `order:confirm:${orderId}` },
    { text: "❌ رد سفارش", callback_data: `order:reject:${orderId}` },
  ]];

  const results = await Promise.all(
    adminIds.map((chatId) =>
      sendRaw(env, { chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } })
    )
  );
  const entries = adminIds
    .map((chatId, i) => ({ chatId, messageId: results[i]?.result?.message_id }))
    .filter((e) => e.messageId);
  if (entries.length > 0) {
    await env.PRODUCTS_KV.put(
      `order:msgs:${orderId}`,
      JSON.stringify({ text, entries }),
      { expirationTtl: 60 * 60 * 24 * 3 } // ۳ روز کافیه؛ بعدش پیام‌ها بی‌ربط شدن
    );
  }

  return json({ ok: true, orderId });
}