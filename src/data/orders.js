// همه‌ی عملیات سفارش‌ها روی D1 (env.DB)
import { editMessageText } from "../telegram/api.js";

export async function createOrder(env, { tableNumber, items, total }) {
  const res = await env.DB
    .prepare("INSERT INTO orders (table_number, items, total) VALUES (?, ?, ?)")
    .bind(tableNumber, JSON.stringify(items), total)
    .run();
  return res.meta.last_row_id;
}

export async function getOrder(env, id) {
  return env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
}

// لیست سفارش‌ها برای پنل وب؛ جدیدترین‌ها اول. items رو هم از رشته‌ی JSON خام دربیاریم
// که مستقیم قابل استفاده باشه (هم تو پنل وب هم هرجای دیگه‌ای که لازم شد).
export async function listOrders(env, { status, limit = 50 } = {}) {
  const query = status
    ? env.DB.prepare("SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT ?").bind(status, limit)
    : env.DB.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT ?").bind(limit);
  const { results } = await query.all();
  return results.map((o) => ({ ...o, items: JSON.parse(o.items) }));
}

// آپدیت وضعیت فقط وقتی هنوز pending باشه؛ اگه هیچ ردیفی آپدیت نشد یعنی یه ادمین دیگه
// زودتر تایید/رد کرده (race condition بین چندتا ادمین که هم‌زمان دکمه رو زدن)
async function setOrderStatus(env, id, status) {
  const res = await env.DB
    .prepare("UPDATE orders SET status = ? WHERE id = ? AND status = 'pending'")
    .bind(status, id)
    .run();
  return res.meta.changes > 0;
}

export const confirmOrder = (env, id) => setOrderStatus(env, id, "confirmed");
export const rejectOrder = (env, id) => setOrderStatus(env, id, "rejected");

// منطق مشترک «تایید/رد سفارش» — چه از دکمه‌ی زیر پیام تلگرام بیاد چه از پنل ادمین تو وب.
// هم وضعیت رو تو دیتابیس آپدیت می‌کنه، هم پیام‌های تلگرامی که موقع ثبت سفارش برای همه‌ی
// ادمین‌ها فرستاده شده بود رو ویرایش می‌کنه؛ این‌جوری تلگرام و پنل وب هیچ‌وقت با هم
// ناهماهنگ نمی‌شن (مثلاً از وب تایید کنی، ولی تو تلگرام هنوز دکمه‌ی تایید/رد نشون بده).
export async function resolveOrder(env, orderId, status, resolvedBy = "ادمین") {
  const updated = status === "confirmed" ? await confirmOrder(env, orderId) : await rejectOrder(env, orderId);

  const raw = await env.PRODUCTS_KV.get(`order:msgs:${orderId}`);
  const stored = raw ? JSON.parse(raw) : null;
  if (stored?.entries?.length) {
    let newText;
    if (updated) {
      newText = `${stored.text}\n\n${status === "confirmed" ? "✅ تایید شد" : "❌ رد شد"} توسط ${resolvedBy}`;
    } else {
      // آپدیت اعمال نشد؛ به‌جای حدس زدن «پس حتماً یکی دیگه بررسیش کرده»، وضعیت واقعی
      // سفارش رو از دیتابیس می‌خونیم تا پیام همیشه درست باشه، مهم نیست علتش چی بوده
      const current = await getOrder(env, orderId);
      if (current?.status === "confirmed") newText = `${stored.text}\n\n✅ تایید شد`;
      else if (current?.status === "rejected") newText = `${stored.text}\n\n❌ رد شد`;
      else newText = `${stored.text}\n\n⚠️ این سفارش پیدا نشد یا حذف شده.`;
    }
    await Promise.all(stored.entries.map((e) => editMessageText(env, e.chatId, e.messageId, newText, [])));
  }

  return updated;
}