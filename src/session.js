// نگهداری موقت وضعیت مکالمه‌ی هر ادمین (برای مراحل چندقسمتی مثل «اسم محصول رو بفرست»)
const TTL_SECONDS = 600; // ۱۰ دقیقه؛ بعدش خودش پاک میشه

export async function getSession(env, chatId) {
  const raw = await env.PRODUCTS_KV.get(`session:${chatId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function setSession(env, chatId, data) {
  await env.PRODUCTS_KV.put(`session:${chatId}`, JSON.stringify(data), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function clearSession(env, chatId) {
  await env.PRODUCTS_KV.delete(`session:${chatId}`);
}
