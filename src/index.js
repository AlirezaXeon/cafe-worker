import { handleUpdate } from "./telegram.js";
import { getProducts } from "./products.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // محصولات رو دیگه از فایل استاتیک نمی‌خونیم، از KV می‌خونیم تا ربات بتونه تغییرشون بده
    if (url.pathname === "/data/products.json") {
      const data = await getProducts(env);
      // خواندن تنظیمات چیدمان از ربات (اگر نبود، پیش‌فرض رو ۲ ستونه در نظر می‌گیره)
      const layoutSetting = await env.PRODUCTS_KV.get("settings:layout") || "2col";
      data.layout = layoutSetting; // اضافه کردن به خروجی جیسون
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // وبهوک تلگرام؛ فقط با هدر مخفی درست پذیرفته میشه
    if (url.pathname === "/tg-webhook" && request.method === "POST") {
      const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!env.WEBHOOK_SECRET || secretHeader !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const update = await request.json();
      ctx.waitUntil(handleUpdate(update, env));
      return new Response("OK");
    }

    // سرو عکس‌ها (هم KV و هم استاتیک)
    if (url.pathname.startsWith('/images/')) {
      const filename = url.pathname.split('/').pop(); // مثلا p11.jpg

      // ۱. اول چک میکنیم ببینیم آیا این عکس توسط ربات تو KV ذخیره شده یا نه
      // از get ساده استفاده میکنیم چون getWithMetadata تو فایل‌های باینری گاهی باگ داره
      const imageBuffer = await env.PRODUCTS_KV.get(`image:${filename}`, { type: "arrayBuffer" });

      // اگر عکس تو KV بود، مستقیم نشون میدیم
      if (imageBuffer) {
        const ext = filename.split('.').pop().toLowerCase();
        const types = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
          gif: "image/gif"
        };

        return new Response(imageBuffer, {
          headers: {
            "Content-Type": types[ext] || "image/jpeg",
            // چون عکس دیگه تغییر نمیکنه، به مرورگر میگیم تا ابد کشش کنه تا سایت سریع لود بشه
            "Cache-Control": "public, max-age=31536000, immutable"
          },
        });
      }

      /* 
      ---- کد دیباگ (فقط برای تست) ----
      اگر بعد از دیپلوی کردن، عکس هنوز نیومد، خطوط پایین رو از کامنت دربیار تا بفهمی مشکل از کجاست:
      
      return new Response("Debug: Image not in KV. Filename: " + filename, { status: 404 });
      
      اگر پیام بالا رو دیدی یعنی کد درست اجرا میشه ولی کلید (Key) تو KV اشتباه ذخیره شده.
      اگر پیام بالا رو ندیدی و ارور 404 دیفالت کلودفلر رو دیدی، یعنی فایل index.js اصلاً اجرا نمیشه و مشکل از تنظیمات مسیر (Routing) کلودفلره.
      */
    }

    // ۲. اگر عکس تو KV نبود (یعنی عکس‌های پیش‌فرض و استاتیک سایت هستند)، میدیم به کلودفلر از فایل‌های هارد بخونه
    return env.ASSETS.fetch(request);
  },
};