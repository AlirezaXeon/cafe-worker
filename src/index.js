// این Worker به‌جای Pages، کل سایت کافه رو مستقیم از edge Cloudflare سرو می‌کنه.
// چون از دامنه workers.dev استفاده می‌شه (نه pages.dev)، برای مواقعی که pages.dev فیلتره مناسبه.
//
// از این پس محصولات از D1 (دیتابیس SQL کلادفلر) خونده می‌شن، نه از فایل استاتیک
// public/data/products.json. مدیریت محصولات (افزودن/ویرایش/حذف) از طریق بات
// تلگرام روی مسیر /telegram-webhook انجام می‌شه.

import { handleTelegramUpdate } from "./telegram.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- Webhook تلگرام ---
    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      return handleTelegramUpdate(request, env);
    }

    // --- API محصولات: جایگزین public/data/products.json ---
    if (url.pathname === "/api/products" && request.method === "GET") {
      return getProductsFromDB(env);
    }

    // بقیه‌ی درخواست‌ها مستقیم از پوشه public سرو می‌شن (HTML, CSS, JS, عکس‌ها)
    return env.ASSETS.fetch(request);
  },
};

async function getProductsFromDB(env) {
  try {
    const [{ results: categories }, { results: products }] = await Promise.all([
      env.DB.prepare("SELECT id, label FROM categories").all(),
      env.DB.prepare("SELECT id, category, name, note, price, image FROM products").all(),
    ]);

    const body = JSON.stringify({ categories, products });
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store", // همیشه دیتای تازه (چون بات ممکنه تغییرش داده باشه)
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "خطا در خواندن محصولات", detail: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
