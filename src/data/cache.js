// کش در حافظه ایزوله (Per-isolate in-memory memoization)
// حذف کامل لایه KV getCached برای جلوگیری از سوزاندن سهمیه نوشتن/خواندن پلن رایگان Cloudflare

export const PRODUCTS_CACHE_KEY = "cache:products.json";
export const SITE_CACHE_KEY = "cache:site.json";

const MEMO_TTL_MS = 10 * 1000; // ۱۰ ثانیه در حافظه محلی
const memoStore = new Map();

export function memo(key, fetcher, ttlMs = MEMO_TTL_MS) {
  const now = Date.now();
  const hit = memoStore.get(key);
  if (hit && hit.exp > now) return hit.promise;

  // خود پرامیس کش می‌شود تا درخواست‌های هم‌زمان در یک ایزوله کوئری تکراری نزنند
  const promise = Promise.resolve().then(fetcher).catch((err) => {
    memoStore.delete(key); // در صورت بروز خطا کش پاک می‌شود
    throw err;
  });

  memoStore.set(key, { exp: now + ttlMs, promise });
  return promise;
}

export function clearMemo(key) {
  if (key) memoStore.delete(key);
  else memoStore.clear();
}

export async function invalidateCache(env, key) {
  clearMemo(key);
  if (env?.PRODUCTS_KV && key) {
    try {
      await env.PRODUCTS_KV.delete(key);
    } catch {}
  }
}