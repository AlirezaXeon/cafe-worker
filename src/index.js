import { handleUpdate } from "./telegram.js";
import { getProducts } from "./products.js";
import { getSiteConfig } from "./site.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // محصولات رو دیگه از فایل استاتیک نمی‌خونیم، از D1 می‌خونیم تا ربات بتونه تغییرشون بده
    if (url.pathname === "/data/products.json") {
      const data = await getProducts(env);
      // محصولاتی که ادمین موقتاً «پنهان» کرده (چون الان تو کافه موجود نیست) رو از سایت مشتری حذف می‌کنیم؛
      // خود ربات جدا از این تابع، همه‌ی محصولات (حتی پنهان‌شده‌ها) رو می‌بینه تا بشه دوباره فعالشون کرد.
      data.products = data.products.filter((p) => p.available !== 0);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // تنظیمات سایت (لوگو + عکس بالای سایت)؛ اگه از ربات چیزی ست نشده باشه، دیفالت برمی‌گرده
    if (url.pathname === "/data/site.json") {
      const data = await getSiteConfig(env);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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
    const assetResponse = await env.ASSETS.fetch(request);

    // برای HTML/JS/CSS: به‌جای کش کورکورانه‌ی طولانی، مرورگر/Cloudflare هر بار چک کنن نسخه عوض شده یا نه
    // (no-cache یعنی بازم کش می‌کنه، ولی قبل از استفاده باید Revalidate کنه، نه اینکه کورکورانه قبول کنه).
    // این همون کلاس باگی بود که برای products.json داشتیم (سرورهای مختلف Cloudflare هرکدوم یه
    // نسخه‌ی قدیمی رو جدا کش کرده بودن)؛ این‌جا برای خودِ فایل‌های سایت هم پیش‌گیری‌ش می‌کنیم.
    // بر اساس content-type چک می‌کنیم (نه پسوند مسیر)، چون index.html هم باید همین رفتار رو داشته باشه
    // وگرنه اگه خودِ HTML قدیمی کش بمونه، بازم به آدرس قدیمی script.js اشاره می‌کنه.
    const contentType = assetResponse.headers.get('content-type') || '';
    if (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('text/css')) {
      const response = new Response(assetResponse.body, assetResponse);
      response.headers.set('Cache-Control', 'no-cache');
      return response;
    }

    return assetResponse;
  },
};