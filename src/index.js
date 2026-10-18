import { handleUpdate } from "./telegram.js";
import { getProducts } from "./data/products.js";
import { getSiteConfig } from "./data/site.js";
import { memo, PRODUCTS_CACHE_KEY, SITE_CACHE_KEY } from "./data/cache.js";
import { handleAdminAPI } from './handlers/admin.js';
import { safeCompare } from './lib/safeCompare.js';
import { handleOrdersAPI, notifyAdmins } from './handlers/orders.js';
import { getPendingOrdersNeedingNotification } from './data/orders.js';
import { cleanupExpiredBotState } from './data/botState.js';
import { withSecurityHeaders } from "./middleware/security.js";
import { imageFilename } from "./data/imagePaths.js";

const IMAGE_CONTENT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", gif: "image/gif",
};

// اسم فایل عکس‌ها تایم‌استمپ‌دار و تغییرناپذیره، پس کش یک‌ساله امنه.
// جواب‌های «فالبک» (مثلاً عکس اصلی به‌جای thumbnail) کش کوتاه می‌گیرن تا اگه بعداً
// ریسایز درست شد، مرورگر/کش یه سال روی نسخه‌ی سنگین گیر نکنه.
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
// فالبک عکس (وقتی ریسایز کار نمیکنه و عکس اصلی سرو میشه). اسم فایلها تایماستمپدار و تغییرناپذیرن، پس کش مرورگر
// میتونه بلند باشه؛ هر بار که کش مرورگر منقضی بشه یه KV read مصرف میشه (سقف ۱۰۰ هزار در روز تو پلن رایگان).
// فقط یک روز میذاریم نه یک سال، تا اگه بعداً ریسایز (مثلاً با دامنهی اختصاصی) فعال شد، نسخهی سنگین ماندگار نشه.
const FALLBACK_CACHE = "public, max-age=86400";

// آدرس پایه‌ی سایت برای sitemap/robots/canonical/og:url.
// اگه SITE_URL تو تنظیمات Worker ست شده باشه همون استفاده میشه (برای وقتی که سایت روی چند دامنه باز میشه)،
// وگرنه دامنه‌ای که درخواست ازش اومده؛ پس با دامنه‌ی اختصاصی دیگه چیزی برای عوض کردن نیست.
function siteBase(env, url) {
  const configured = String(env?.SITE_URL || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(configured) ? configured : url.origin;
}

const TEXT_CACHE = "public, max-age=3600";

// کش محصولات در حافظه‌ی رم ورکر (per-isolate memo) بدون بار روی سهمیه KV
const loadProductsData = (env) =>
  memo(PRODUCTS_CACHE_KEY, async () => {
    const fresh = await getProducts(env);
    fresh.products = fresh.products.filter((p) => p.available !== 0);
    return fresh;
  });

// هم برای /data/site.json هم برای تزریق لوگو/کاور تو HTML؛ هر دو یه کش مشترک دارن
const loadSiteData = (env) =>
  memo(SITE_CACHE_KEY, () => getSiteConfig(env));

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
  return serveImageFromKV(filename, env, FALLBACK_CACHE);
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
// base: آدرس پایه‌ی سایت (بدون اسلش آخر) برای canonical / og:url / og:image
function injectSiteAssets(response, cfg, base, products, env) {
  const rewriter = new HTMLRewriter();

  // canonical و og:url با دامنه‌ی واقعی (نه مقدار هاردکد داخل index.html)
  rewriter.on('link[rel="canonical"]', {
    element(el) { el.setAttribute('href', `${base}/`); },
  });
  rewriter.on('meta[property="og:url"]', {
    element(el) { el.setAttribute('content', `${base}/`); },
  });

  // دیتای سایت و محصولات رو مستقیم تو HTML می‌ذاریم تا مرورگر مجبور نباشه بعد از لود script.js
  // دو تا fetch جدا (site.json و products.json) بزنه؛ script.js اگه این رو ببینه fetch نمی‌کنه.
  if (cfg || products) {
    const siteConfig = cfg
      ? { ...cfg, signingEnabled: cfg.signingEnabled ?? Boolean(env?.TABLE_SIGNING_SECRET) }
      : { signingEnabled: Boolean(env?.TABLE_SIGNING_SECRET) };
    rewriter.on('head', {
      element(el) {
        el.append(`<script type="application/json" id="bootData">${safeInlineJson({ site: siteConfig, products: products || null, now: Date.now() })}</script>`, { html: true });
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
      if (share) el.setAttribute('content', new URL(share, `${base}/`).toString());
      else el.remove();
    },
  });

  return rewriter.transform(response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let response;
    try {
      response = await this.handleRoute(request, env, ctx, url);
    } catch (err) {
      console.error(`[unhandled-error] ${request.method} ${url.pathname}:`, err);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/api')) {
        response = new Response(
          JSON.stringify({ error: 'خطای داخلی سرور رخ داد. لطفاً دوباره امتحان کنید.' }),
          {
            status: 500,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          }
        );
      } else {
        response = new Response('Internal Server Error', {
          status: 500,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }
    }
    return withSecurityHeaders(response, url.pathname);
  },

  async handleRoute(request, env, ctx, url) {
    // ── Admin API ─────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/admin/api')) {
      return handleAdminAPI(request, env);
    }

    // ── ثبت و پیگیری سفارش (عمومی، بدون احراز هویت) ─────────────────────────
    // ctx پاس داده میشه تا اطلاع‌رسانی تلگرام بعد از جواب دادن به مشتری انجام بشه
    if (url.pathname === "/api/orders" || url.pathname.startsWith("/api/orders/")) {
      return handleOrdersAPI(request, env, ctx);
    }

    // ── robots.txt و sitemap.xml (آدرس از دامنه‌ی واقعی ساخته میشه، نه هاردکد) ──
    if (url.pathname === "/robots.txt" && (request.method === "GET" || request.method === "HEAD")) {
      const base = siteBase(env, url);
      return new Response(`User-agent: *\nDisallow: /admin/\nSitemap: ${base}/sitemap.xml\n`, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": TEXT_CACHE },
      });
    }
    if (url.pathname === "/sitemap.xml" && (request.method === "GET" || request.method === "HEAD")) {
      const base = siteBase(env, url);
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `  <url>\n` +
        `    <loc>${base}/</loc>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>1.0</priority>\n` +
        `  </url>\n` +
        `</urlset>\n`;
      return new Response(xml, {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": TEXT_CACHE },
      });
    }

    // ── محصولات (از D1، با کش حافظه اختصاصی هر isolate) ─────────────────
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
      if (!env.WEBHOOK_SECRET || !safeCompare(secretHeader, env.WEBHOOK_SECRET)) {
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
      const filename = imageFilename(url.pathname);
      const response = await withEdgeCache(request, ctx, () => serveThumbnail(filename, env, request));
      if (response) return response;
      return new Response("Not Found", { status: 404 });
    }

    // ── نسخه‌ی متوسط عکس برای مودال محصول (/images/med/xxx.jpg) ──────────────
    // قبلاً مودال عکس اصلی (چند مگابایت) رو تو موبایل می‌گرفت؛ دانلود کند + دیکد سنگین = پرش و لگ.
    // عکس اصلی فقط وقتی کاربر روی عکس بزنه و زوم کنه لود میشه.
    if (url.pathname.startsWith('/images/med/')) {
      const filename = imageFilename(url.pathname);
      const response = await withEdgeCache(request, ctx, () => serveThumbnail(filename, env, request, MEDIUM_OPTS));
      if (response) return response;
      return new Response("Not Found", { status: 404 });
    }

    // ── عکس‌های KV ───────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/images/')) {
      const filename = imageFilename(url.pathname);
      const response = await withEdgeCache(request, ctx, () => serveImageFromKV(filename, env));
      if (response) return response;
      // برای /images/ اگه در KV نبود، می‌ذاریم بره سراغ فایل‌های استاتیک
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
        response = injectSiteAssets(response, cfg, siteBase(env, url), products, env);
      }
      response.headers.set('Cache-Control', 'no-cache');
      return response;
    }

    return assetResponse;
  },

  async scheduled(event, env, _ctx) {
    try {
      const pendingOrders = await getPendingOrdersNeedingNotification(env);
      for (const order of pendingOrders) {
        try {
          await notifyAdmins(env, order);
        } catch (err) {
          console.error(`[scheduled:retry-notify] order ${order.orderId}:`, err);
        }
      }
    } catch (err) {
      console.error("[scheduled:retry-orders-failed]", err);
    }

    try {
      await cleanupExpiredBotState(env);
    } catch (err) {
      console.error("[scheduled:cleanup-bot-state-failed]", err);
    }
  },
};