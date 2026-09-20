// همه‌ی عملیات سفارش‌ها روی D1 (env.DB)

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
