import { handleUpdate } from "./telegram.js";
import { getProducts } from "./data/products.js";
import { getSiteConfig } from "./data/site.js";
import { handleAdminAPI } from './handlers/admin.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── Admin API ─────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/admin/api')) {
      return handleAdminAPI(request, env);
    }

    // ── محصولات (از D1) ───────────────────────────────────────────────────
    if (url.pathname === "/data/products.json") {
      const data = await getProducts(env);
      data.products = data.products.filter((p) => p.available !== 0);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // ── تنظیمات سایت ─────────────────────────────────────────────────────
    if (url.pathname === "/data/site.json") {
      const data = await getSiteConfig(env);
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

    // ── عکس‌های دسته‌بندی (مسیر قدیمی ربات: /admin/images/...) ───────────
    // ربات تلگرام عکس‌های دسته رو با پسوند /admin/images/categories/ ذخیره کرده
    // اینجا اون‌ها رو از KV می‌خونیم و سرو می‌کنیم
    if (url.pathname.startsWith('/admin/images/')) {
      const filename = url.pathname.split('/').pop();
      const imageBuffer = await env.PRODUCTS_KV.get(`image:${filename}`, { type: "arrayBuffer" });
      if (imageBuffer) {
        const ext = filename.split('.').pop().toLowerCase();
        const types = {
          jpg: "image/jpeg", jpeg: "image/jpeg",
          png: "image/png", webp: "image/webp", gif: "image/gif"
        };
        return new Response(imageBuffer, {
          headers: {
            "Content-Type": types[ext] || "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable"
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    // ── عکس‌های معمولی (/images/...) ──────────────────────────────────────
    if (url.pathname.startsWith('/images/')) {
      const filename = url.pathname.split('/').pop();
      const imageBuffer = await env.PRODUCTS_KV.get(`image:${filename}`, { type: "arrayBuffer" });
      if (imageBuffer) {
        const ext = filename.split('.').pop().toLowerCase();
        const types = {
          jpg: "image/jpeg", jpeg: "image/jpeg",
          png: "image/png", webp: "image/webp", gif: "image/gif"
        };
        return new Response(imageBuffer, {
          headers: {
            "Content-Type": types[ext] || "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable"
          },
        });
      }
    }

    // ── فایل‌های استاتیک (public/) ────────────────────────────────────────
    const assetResponse = await env.ASSETS.fetch(request);

    const contentType = assetResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('text/css')) {
      const response = new Response(assetResponse.body, assetResponse);
      response.headers.set('Cache-Control', 'no-cache');
      return response;
    }

    return assetResponse;
  },
};