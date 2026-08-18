import { handleUpdate } from "./telegram.js";
import { getProducts } from "./products.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // محصولات رو دیگه از فایل استاتیک نمی‌خونیم، از KV می‌خونیم تا ربات بتونه تغییرشون بده
    if (url.pathname === "/data/products.json") {
      const data = await getProducts(env);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // وبهوک تلگرام؛ فقط با هدر مخفی درست پذیرفته میشه (تلگرام خودش این هدر رو ست می‌کنه)
    if (url.pathname === "/tg-webhook" && request.method === "POST") {
      const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!env.WEBHOOK_SECRET || secretHeader !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const update = await request.json();
      // پاسخ سریع به تلگرام میدیم و پردازش رو در پس‌زمینه ادامه میدیم
      ctx.waitUntil(handleUpdate(update, env));
      return new Response("OK");
    }

    return env.ASSETS.fetch(request);
  },
};
