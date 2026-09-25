import { handleUpdate } from "./telegram.js";
import { getProducts } from "./data/products.js";
import { getSiteConfig } from "./data/site.js";
import { getCached, PRODUCTS_CACHE_KEY, SITE_CACHE_KEY } from "./data/cache.js";
import { handleAdminAPI } from './handlers/admin.js';
import { handleOrdersAPI } from './handlers/orders.js';

const IMAGE_CONTENT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", gif: "image/gif",
};

async function serveImageFromKV(filename, env) {
  const imageBuffer = await env.PRODUCTS_KV.get(`image:${filename}`, { type: "arrayBuffer" });
  if (!imageBuffer) return null;
  const ext = filename.split('.').pop().toLowerCase();
  return new Response(imageBuffer, {
    headers: {
      "Content-Type": IMAGE_CONTENT_TYPES[ext] || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

// عکس هیرو (و لوگوها) قبلاً هیچ src ای تو HTML نداشتن؛ script.js اول باید fetch('data/site.json')
// رو کامل می‌کرد و بعد src رو ست می‌کرد. یعنی مرورگر تا وسط اجرای جاوااسکریپت اصلاً نمی‌دونست
// همچین عکسی قراره لود بشه (preload scanner چیزی برای پیدا کردن نداشت) — همین باعث LCP خیلی بد
// می‌شد (چند ثانیه فقط صرف رفت‌وبرگشت گرفتن آدرس عکس، قبل از اینکه اصلاً درخواست عکس شروع بشه).
// این تابع همون src واقعی رو مستقیم تو HTML (سمت سرور) می‌ذاره تا دانلود عکس همون لحظه‌ی اول شروع بشه.
function injectSiteAssets(response, cfg) {
  const rewriter = new HTMLRewriter();
  if (cfg.cover) {
    rewriter.on('#heroCoverImg', {
      element(el) {
        el.setAttribute('src', cfg.cover);
        el.removeAttribute('style'); // پاک کردن display:none
      },
    });
  }
  if (cfg.logo) {
    rewriter.on('#headerLogoImg', { element: (el) => el.setAttribute('src', cfg.logo) });
    rewriter.on('#splashLogoImg', { element: (el) => el.setAttribute('src', cfg.logo) });
    rewriter.on('#heroCoverLogo', {
      element(el) {
        el.setAttribute('src', cfg.logo);
        el.removeAttribute('style');
      },
    });
  }
  return rewriter.transform(response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── Admin API ─────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/admin/api')) {
      return handleAdminAPI(request, env);
    }

    // ── ثبت سفارش (عمومی، بدون احراز هویت) ──────────────────────────────────
    if (url.pathname === "/api/orders") {
      return handleOrdersAPI(request, env);
    }

    // ── محصولات (از D1، با کش کوتاه‌مدت KV پشت صحنه) ────────────────────────
    if (url.pathname === "/data/products.json") {
      const data = await getCached(env, PRODUCTS_CACHE_KEY, async () => {
        const fresh = await getProducts(env);
        fresh.products = fresh.products.filter((p) => p.available !== 0);
        return fresh;
      });
      // هدر مرورگر عمداً no-store می‌مونه؛ کشی که بالا زدیم فقط سمت سرور/KV هست
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // ── تنظیمات سایت (با همون الگوی کش کوتاه‌مدت) ────────────────────────
    if (url.pathname === "/data/site.json") {
      const data = await getCached(env, SITE_CACHE_KEY, () => getSiteConfig(env));
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
      const update = await request.json();
      ctx.waitUntil(handleUpdate(update, env));
      return new Response("OK");
    }

    // ── عکس‌های KV (هم مسیر قدیمی ربات /admin/images/... هم مسیر معمولی /images/...) ──
    if (url.pathname.startsWith('/admin/images/') || url.pathname.startsWith('/images/')) {
      const filename = url.pathname.split('/').pop();
      const response = await serveImageFromKV(filename, env);
      if (response) return response;
      if (url.pathname.startsWith('/admin/images/')) return new Response("Not Found", { status: 404 });
      // برای /images/ اگه پیدا نشد، می‌ذاریم بره سراغ فایل‌های استاتیک (fallback قدیمی)
    }

    // ── فایل‌های استاتیک (public/) ────────────────────────────────────────
    const assetResponse = await env.ASSETS.fetch(request);

    const contentType = assetResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('text/css')) {
      let response = new Response(assetResponse.body, assetResponse);
      // فقط صفحه‌ی اصلی (سایت مشتری) عکس هیرو/لوگو داره؛ پنل ادمین و بقیه رو دست نمی‌زنیم
      if (url.pathname === '/' && contentType.includes('text/html')) {
        const cfg = await getCached(env, SITE_CACHE_KEY, () => getSiteConfig(env));
        response = injectSiteAssets(response, cfg);
      }
      response.headers.set('Cache-Control', 'no-cache');
      return response;
    }

    return assetResponse;
  },
};