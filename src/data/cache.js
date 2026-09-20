// کش کوتاه‌مدت روی KV برای کم‌کردن فشار خوندن از D1؛ نه برای کش مرورگر/کاربر نهایی
// (هدر cache-control خروجی همچنان no-store می‌مونه). با TTL کوتاه (۴۵ ثانیه) و
// invalidate صریح بعد از هر نوشتن، داده‌ی قدیمی هیچ‌وقت بیشتر از این مدت دیده نمی‌شه.

const TTL_SECONDS = 45;

export const PRODUCTS_CACHE_KEY = "cache:products.json";
export const SITE_CACHE_KEY = "cache:site.json";

export async function getCached(env, key, fetcher) {
  const cached = await env.PRODUCTS_KV.get(key, { type: "json" });
  if (cached !== null) return cached;
  const fresh = await fetcher();
  await env.PRODUCTS_KV.put(key, JSON.stringify(fresh), { expirationTtl: TTL_SECONDS });
  return fresh;
}

export async function invalidateCache(env, key) {
  await env.PRODUCTS_KV.delete(key);
}
