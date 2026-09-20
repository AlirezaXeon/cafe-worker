// کش کوتاه‌مدت روی KV برای کم‌کردن فشار خوندن از D1؛ نه برای کش مرورگر/کاربر نهایی
// (هدر cache-control خروجی همچنان no-store می‌مونه). با TTL کوتاه (۶۰ ثانیه، کمترین مقدار
// مجاز خود Cloudflare KV) و invalidate صریح بعد از هر نوشتن، داده‌ی قدیمی هیچ‌وقت بیشتر از
// این مدت دیده نمی‌شه.
//
// نکته‌ی مهم: Cloudflare KV به‌هیچ‌وجه expirationTtl کمتر از ۶۰ ثانیه رو قبول نمی‌کنه
// (رد می‌کنه با ارور «Invalid expiration_ttl»)؛ قبلاً اینجا ۴۵ بود که باعث می‌شد هر put
// شکست بخوره و کل Worker کرش کنه (Error 1101) روی هر دو مسیر products.json و site.json.

const TTL_SECONDS = 60;

export const PRODUCTS_CACHE_KEY = "cache:products.json";
export const SITE_CACHE_KEY = "cache:site.json";

export async function getCached(env, key, fetcher) {
  const cached = await env.PRODUCTS_KV.get(key, { type: "json" });
  if (cached !== null) return cached;
  const fresh = await fetcher();
  // نوشتن تو کش صرفاً یه بهینه‌سازیه، نه یه پیش‌نیاز؛ اگه به هر دلیلی (مثلاً محدودیت خود KV)
  // شکست بخوره، نباید کل درخواست رو کرش کنه — فقط این‌بار بدون کش جواب می‌دیم.
  try {
    await env.PRODUCTS_KV.put(key, JSON.stringify(fresh), { expirationTtl: TTL_SECONDS });
  } catch (err) {
    console.error(`cache write failed for ${key}:`, err);
  }
  return fresh;
}

export async function invalidateCache(env, key) {
  await env.PRODUCTS_KV.delete(key);
}