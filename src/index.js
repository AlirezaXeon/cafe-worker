import { handleUpdate } from "./telegram.js";
import { getProducts } from "./data/products.js";
import { getSiteConfig } from "./data/site.js";
import { getCached, PRODUCTS_CACHE_KEY, SITE_CACHE_KEY } from "./data/cache.js";
import { handleAdminAPI } from './handlers/admin.js';
import { handleOrdersAPI } from './handlers/orders.js';
import { withSecurityHeaders } from "./middleware/security.js";

const IMAGE_CONTENT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", gif: "image/gif",
};

// اسم فایل عکس‌ها تایم‌استمپ‌دار و تغییرناپذیره، پس کش یک‌ساله امنه.
// جواب‌های «فالبک» (مثلاً عکس اصلی به‌جای thumbnail) کش کوتاه می‌گیرن تا اگه بعداً
// ریسایز درست شد، مرورگر/کش یه سال روی نسخه‌ی سنگین گیر نکنه.
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const SHORT_CACHE = "public, max-age=600";

// ── کش حافظه‌ی همین ایزوله (isolate) ───────────────────────────────────────────
// هر خوندن از KV تو سقف روزانه‌ی پلن رایگان حساب میشه. با این لایه، درخواست‌های پشت‌سرهمِ
// چند ثانیه‌ی اخیر (و درخواست‌های هم‌زمان) فقط یه بار KV/D1 رو می‌زنن.
// نکته: تغییرات ادمین ممکنه تا MEMO_TTL_MS ثانیه تو ایزوله‌های دیگه دیر دیده بشه.
const MEMO_TTL_MS = 10_000;
const memoStore = new Map();

function memo(key, fetcher) {
  const now = Date.now();
  const hit = memoStore.get(key);
  if (hit && hit.exp > now) return hit.promise;
  // خود promise ذخیره میشه، پس چند درخواست هم‌زمان یه fetch مشترک دارن
  const promise = fetcher().catch((err) => {
    memoStore.delete(key); // خطا نباید کش بشه
    throw err;
  });
  memoStore.set(key, { exp: now + MEMO_TTL_MS, promise });
  return promise;
}

const loadProductsData = (env) =>
  memo(PRODUCTS_CACHE_KEY, () =>
    getCached(env, PRODUCTS_CACHE_KEY, async () => {
      const fresh = await getProducts(env);
      fresh.products = fresh.products.filter((p) => p.available !== 0);
      return fresh;
    })
  );

// هم برای /data/site.json هم برای تزریق لوگو/کاور تو HTML؛ هر دو یه کش مشترک دارن
const loadSiteData = (env) =>
  memo(SITE_CACHE_KEY, () => getCached(env, SITE_CACHE_KEY, () => getSiteConfig(env)));

// ── کش لبه (Cache API) ────────────────────────────────────────────────────────
// عکس‌ها از KV خونده میشن و هر خوندن حساب میشه؛ با کش لبه فقط بار اول (هر دیتاسنتر) KV خونده میشه.
// توجه: Cache API روی دامنه‌ی workers.dev کار نمی‌کنه (بی‌صدا هیچی ذخیره نمیشه)؛ روی دامنه‌ی
// اختصاصی فعال میشه. کدش بی‌خطر نوشته شده، پس روی workers.dev فقط بی‌اثره.
// فقط جواب‌های immutable کش میشن (نه فالبک‌های کوتاه‌مدت).
async function withEdgeCache(request, ctx, produce) {
  if (request.method !== "GET") return produce();

  const keyUrl = new URL(request.url);
  keyUrl.search = "";
  const cacheKey = new Request(keyUrl.toString(), { method: "GET" });
  const cache = caches.default;

  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch { /* کش در دسترس نیست؛ مستقیم می‌ریم سراغ منبع */ }

  const response = await produce();
  if (response && response.ok && (response.headers.get("Cache-Control") || "").includes("immutable")) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => { }));
  }
  return response;
}

async function serveImageFromKV(filename, env, cacheControl = IMMUTABLE_CACHE) {
  const imageBuffer = await env.PRODUCTS_KV.get(`image:${filename}`, { type: "arrayBuffer" });
  if (!imageBuffer) return null;
  const ext = filename.split('.').pop().toLowerCase();
  return new Response(imageBuffer, {
    headers: {
      "Content-Type": IMAGE_CONTENT_TYPES[ext] || "image/jpeg",
      "Cache-Control": cacheControl,
    },
  });
}

// عکس‌های اصلی که ادمین آپلود می‌کنه ممکنه چند مگابایت باشن، ولی توی منو فقط یه
// مربع ۱۱۶×۱۱۶ نمایش داده میشن؛ دانلود کردن فایل کامل فقط برای یه thumbnail خیلی
// حیف پهنای باند و کند کردن لود اولیه‌ی سایته. این تابع با قابلیت Image Resizing
// خود Cloudflare Workers یه نسخه‌ی کوچیک و فشرده می‌سازه. چون منبع اصلی (KV) از همین
// Worker سرو میشه، یه fetch داخلی به مسیر عادی /images/ می‌زنیم تا Cloudflare قبل از
// رسوندنش بهمون ریسایزش کنه.
//
// اگه ریسایز کار نکنه (مثلاً روی workers.dev فعال نیست)، هر بار تلاش مجدد یه subrequest
// بی‌فایده + خوندن اضافه از KV بود. حالا بعد از اولین شکست، ۱۰ دقیقه مستقیم عکس اصلی
// سرو میشه و بعدش دوباره تلاش می‌کنیم.
const RESIZE_BACKOFF_MS = 10 * 60 * 1000;
let resizeRetryAt = 0;

// تامبنیل کارت‌های منو (۲۴۰×۲۴۰) و نسخه‌ی متوسط مودال (حداکثر ۹۰۰ پیکسل عرض)
const THUMB_OPTS = { width: 240, height: 240, fit: "cover", quality: 72 };
const MEDIUM_OPTS = { width: 800, fit: "scale-down", quality: 74, format: "webp" };

async function serveThumbnail(filename, env, request, imageOpts = THUMB_OPTS) {
  if (Date.now() >= resizeRetryAt) {
    const originalUrl = new URL(request.url);
    originalUrl.pathname = `/images/${filename}`;
    originalUrl.search = '';

    try {
      const resized = await fetch(originalUrl.toString(), {
        cf: { image: imageOpts },
      });

      if (resized.ok) {
        return new Response(resized.body, {
          headers: {
            "Content-Type": resized.headers.get("content-type") || "image/jpeg",
            "Cache-Control": IMMUTABLE_CACHE,
          },
        });
      }
      // عکس اصلاً وجود نداره؛ این شکست ریسایز نیست، پس بک‌آف فعال نمیشه
      if (resized.status === 404) return null;
    } catch { /* پایین‌تر به فالبک می‌ریم */ }

    resizeRetryAt = Date.now() + RESIZE_BACKOFF_MS;
  }

  // فالبک: عکس اصلی، با کش کوتاه (تا بعداً که ریسایز درست شد، نسخه‌ی سنگین ماندگار نشه)
  return serveImageFromKV(filename, env, SHORT_CACHE);
}

// JSON امن برای گذاشتن داخل <script>: اسم/توضیح محصول از ادمین میاد؛ بدون escape یه
// «</script>» توش کل صفحه رو می‌شکنه (و XSS میشه). U+2028/2029 هم تو بعضی مرورگرها خط جدید حساب میشن.
function safeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// عکس هیرو (و لوگوها) قبلاً هیچ src ای تو HTML نداشتن؛ script.js اول باید fetch('data/site.json')
// رو کامل می‌کرد و بعد src رو ست می‌کرد. این تابع همون src واقعی رو مستقیم تو HTML
// (سمت سرور) می‌ذاره تا دانلود عکس همون لحظه‌ی اول شروع بشه.
function injectSiteAssets(response, cfg, origin, products) {
  const rewriter = new HTMLRewriter();

  // دیتای سایت و محصولات رو مستقیم تو HTML می‌ذاریم تا مرورگر مجبور نباشه بعد از لود script.js
  // دو تا fetch جدا (site.json و products.json) بزنه؛ script.js اگه این رو ببینه fetch نمی‌کنه.
  if (cfg || products) {
    rewriter.on('head', {
      element(el) {
        el.append(`<script type="application/json" id="bootData">${safeInlineJson({ site: cfg || null, products: products || null })}</script>`, { html: true });
      },
    });
  }

  if (cfg && cfg.cover) {
    const coverHref = '/' + String(cfg.cover).replace(/^\//, '');
    // دانلود عکس از همون اولین بایت‌های HTML شروع می‌شه
    rewriter.on('head', {
      element(el) {
        el.append(`<link rel="preload" as="image" href="${coverHref}" fetchpriority="high">`, { html: true });
      },
    });
    // بدون این، عکس تا اجرای جاوااسکریپت و گرفتن site.json نامرئی می‌مونه
    rewriter.on('.hero-cover', {
      element(el) { el.setAttribute('class', 'hero-cover cover-ready'); },
    });
    rewriter.on('#heroCoverImg', {
      element(el) {
        el.setAttribute('src', cfg.cover);
        el.removeAttribute('style'); // پاک کردن display:none
      },
    });
  }
  if (cfg && cfg.logo) {
    const logoHref = /^https?:\/\//i.test(cfg.logo) ? cfg.logo : '/' + String(cfg.logo).replace(/^\//, '');
    rewriter.on('head', {
      element(el) {
        el.append(`<link rel="preload" as="image" href="${logoHref}" fetchpriority="high">`, { html: true });
      },
    });
    rewriter.on('#headerLogoImg', { element: (el) => el.setAttribute('src', logoHref) });
    rewriter.on('#splashLogoImg', { element: (el) => el.setAttribute('src', logoHref) });
    rewriter.on('#heroCoverLogo', {
      element(el) {
        el.setAttribute('src', logoHref);
        el.removeAttribute('style');
      },
    });
  }

  // فاویکون و آیکون اپل: از لوگوی ذخیره‌شده؛ اگه لوگو نیست، تگ‌ها حذف میشن (دیگه فایل ثابت نداریم)
  rewriter.on('link[rel="icon"], link[rel="apple-touch-icon"]', {
    element(el) {
      if (cfg && cfg.logo) {
        el.setAttribute('href', cfg.logo);
        el.removeAttribute('type');
        el.removeAttribute('sizes');
      } else {
        el.remove();
      }
    },
  });

  // عکس اشتراک‌گذاری (OG): کاور، وگرنه لوگو، وگرنه هیچی (باید آدرس کامل باشه)
  const share = cfg && (cfg.cover || cfg.logo);
  rewriter.on('meta[property="og:image"]', {
    element(el) {
      if (share) el.setAttribute('content', new URL(share, origin).toString());
      else el.remove();
    },
  });

  return rewriter.transform(response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await this.handleRoute(request, env, ctx, url);
    return withSecurityHeaders(response, url.pathname);
  },

  async handleRoute(request, env, ctx, url) {
    // ── Admin API ─────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/admin/api')) {
      return handleAdminAPI(request, env);
    }

    // ── ثبت سفارش (عمومی، بدون احراز هویت) ──────────────────────────────────
    // ctx پاس داده میشه تا اطلاع‌رسانی تلگرام بعد از جواب دادن به مشتری انجام بشه
    if (url.pathname === "/api/orders") {
      return handleOrdersAPI(request, env, ctx);
    }

    // ── محصولات (از D1، با کش حافظه + کش کوتاه‌مدت KV پشت صحنه) ─────────────────
    if (url.pathname === "/data/products.json") {
      const data = await loadProductsData(env);
      // هدر مرورگر عمداً no-store می‌مونه؛ کشی که بالا زدیم فقط سمت سرور هست
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // ── تنظیمات سایت (با همون الگوی کش) ────────────────────────────────────
    if (url.pathname === "/data/site.json") {
      const data = await loadSiteData(env);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // ── وبهوک تلگرام ──────────────────────────────────────────────────────
    if (url.pathname === "/tg-webhook" && request.method === "POST") {
      const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!env.WEBHOOK_SECRET || secretHeader !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      let update;
      try {
        update = await request.json();
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      // بدون catch، خطای هندلر بی‌صدا گم میشد؛ حالا تو لاگ دیده میشه
      ctx.waitUntil(
        handleUpdate(update, env).catch((err) => console.error("[tg-webhook]", err))
      );
      return new Response("OK");
    }

    // ── نسخه‌ی کوچیک‌شده‌ی عکس‌ها، مخصوص کارت‌های منو (/images/thumb/xxx.jpg) ──
    // باید قبل از چک عمومی /images/ باشه چون اون مسیر رو هم شامل میشه.
    if (url.pathname.startsWith('/images/thumb/')) {
      const filename = url.pathname.split('/').pop();
      const response = await withEdgeCache(request, ctx, () => serveThumbnail(filename, env, request));
      if (response) return response;
      return new Response("Not Found", { status: 404 });
    }

    // ── نسخه‌ی متوسط عکس برای مودال محصول (/images/med/xxx.jpg) ──────────────
    // قبلاً مودال عکس اصلی (چند مگابایت) رو تو موبایل می‌گرفت؛ دانلود کند + دیکد سنگین = پرش و لگ.
    // عکس اصلی فقط وقتی کاربر روی عکس بزنه و زوم کنه لود میشه.
    if (url.pathname.startsWith('/images/med/')) {
      const filename = url.pathname.split('/').pop();
      const response = await withEdgeCache(request, ctx, () => serveThumbnail(filename, env, request, MEDIUM_OPTS));
      if (response) return response;
      return new Response("Not Found", { status: 404 });
    }

    // ── عکس‌های KV (هم مسیر قدیمی ربات /admin/images/... هم مسیر معمولی /images/...) ──
    if (url.pathname.startsWith('/admin/images/') || url.pathname.startsWith('/images/')) {
      const filename = url.pathname.split('/').pop();
      const response = await withEdgeCache(request, ctx, () => serveImageFromKV(filename, env));
      if (response) return response;
      if (url.pathname.startsWith('/admin/images/')) return new Response("Not Found", { status: 404 });
      // برای /images/ اگه پیدا نشد، می‌ذاریم بره سراغ فایل‌های استاتیک (fallback قدیمی)
    }

    // ── فایل‌های استاتیک (public/) ────────────────────────────────────────
    // برای صفحه‌ی اصلی، خوندن دیتا هم‌زمان با گرفتن فایل HTML شروع میشه (نه بعدش)
    const isHome = url.pathname === '/';
    const bootPromise = isHome
      ? Promise.all([
          loadSiteData(env).catch((err) => { console.error('[boot:site]', err); return null; }),
          loadProductsData(env).catch((err) => { console.error('[boot:products]', err); return null; }),
        ])
      : null;
    const assetResponse = await env.ASSETS.fetch(request);

    const contentType = assetResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('text/css')) {
      let response = new Response(assetResponse.body, assetResponse);
      // فقط صفحه‌ی اصلی (سایت مشتری) عکس هیرو/لوگو داره؛ پنل ادمین و بقیه رو دست نمی‌زنیم
      if (isHome && contentType.includes('text/html')) {
        const [cfg, products] = await bootPromise;
        // اگه دیتا نیومد، صفحه همون‌طور که هست می‌ره و script.js خودش fetch می‌کنه
        response = injectSiteAssets(response, cfg, url.origin, products);
      }
      response.headers.set('Cache-Control', 'no-cache');
      return response;
    }

    return assetResponse;
  },
};