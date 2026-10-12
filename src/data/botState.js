// ذخیره‌ی key/value موقت ربات روی D1 (جایگزین KV برای کم کردن مصرف سهمیه‌ی write)

export async function getBotState(env, key, now = Date.now()) {
  const row = await env.DB
    .prepare("SELECT value, expires_at FROM bot_state WHERE key = ?")
    .bind(key)
    .first();
  if (!row) return null;
  if (row.expires_at != null && row.expires_at <= now) return null;
  return row.value;
}

// ttlSec خالی = بدون انقضا
export async function setBotState(env, key, value, ttlSec = null) {
  const expiresAt = ttlSec ? Date.now() + ttlSec * 1000 : null;
  await env.DB
    .prepare("INSERT OR REPLACE INTO bot_state (key, value, expires_at) VALUES (?, ?, ?)")
    .bind(key, String(value), expiresAt)
    .run();
}

export async function deleteBotState(env, key) {
  await env.DB.prepare("DELETE FROM bot_state WHERE key = ?").bind(key).run();
}
