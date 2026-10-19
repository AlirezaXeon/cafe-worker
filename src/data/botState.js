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

export async function incrementBotState(env, key, ttlSec = 900) {
  const now = Date.now();
  const expiresAt = ttlSec ? now + ttlSec * 1000 : null;
  try {
    const row = await env.DB
      .prepare(`
        INSERT INTO bot_state (key, value, expires_at) VALUES (?1, '1', ?2)
        ON CONFLICT(key) DO UPDATE SET
          value = CASE WHEN bot_state.expires_at IS NOT NULL AND bot_state.expires_at <= ?3
                       THEN '1' ELSE CAST(CAST(bot_state.value AS INTEGER) + 1 AS TEXT) END,
          expires_at = excluded.expires_at
        RETURNING value
      `)
      .bind(key, expiresAt, now)
      .first();
    return Number(row?.value) || 1;
  } catch {
    const currentVal = await getBotState(env, key, now);
    const next = currentVal ? Number(currentVal) + 1 : 1;
    await setBotState(env, key, String(next), ttlSec);
    return next;
  }
}

export async function deleteExpiredBotState(env, now = Date.now()) {
  return await env.DB
    .prepare("DELETE FROM bot_state WHERE expires_at IS NOT NULL AND expires_at < ?")
    .bind(now)
    .run();
}

export async function cleanupExpiredBotState(env, now = Date.now()) {
  const lastCleanup = await getBotState(env, "internal:last_bot_cleanup", now);
  if (lastCleanup && (now - Number(lastCleanup)) < 10 * 60 * 1000) {
    return { skipped: true };
  }
  const res = await deleteExpiredBotState(env, now);
  await setBotState(env, "internal:last_bot_cleanup", String(now), 3600);
  return { skipped: false, result: res };
}
