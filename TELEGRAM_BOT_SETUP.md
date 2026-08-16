# راه‌اندازی بات تلگرام مدیریت محصولات (نسخه‌ی دکمه‌ای)

## چه چیزی اضافه/تغییر کرد
- `migrations/0001_init.sql` — اسکیمای D1 (جداول `categories` و `products`) به‌همراه دیتای فعلی
- `src/telegram.js` — بازنویسی کامل با **دکمه‌های شیشه‌ای (inline keyboard)** و مکالمه‌ی مرحله‌به‌مرحله؛ دیگه نیازی به تایپ دستور و `|` نیست
- `src/index.js` — دو route جدید:
  - `GET /api/products` → محصولات رو از D1 برمی‌گردونه (جایگزین فایل استاتیک)
  - `POST /telegram-webhook` → پیام‌ها و کلیک دکمه‌های بات رو پردازش می‌کنه
- `public/js/script.js` → حالا از `/api/products` می‌خونه، نه از `data/products.json`
- `wrangler.jsonc` → باندینگ D1 **و KV** اضافه شد (باید `database_id` و KV `id` رو خودت جایگزین کنی)

### چرا KV اضافه شد؟
برای اینکه بات بتونه مکالمه‌ی مرحله‌به‌مرحله رو دنبال کنه (مثلاً وقتی داره اسم محصول جدید رو می‌پرسه، بعد قیمت، بعد عکس)،
باید بین پیام‌های مختلف "وضعیت فعلی مکالمه" هر کاربر رو یه‌جا نگه داریم. Cloudflare KV برای این کار سبک و مناسبه.

## مراحل راه‌اندازی

### ۱. ساخت دیتابیس D1
```bash
npx wrangler d1 create cafe-roshan-db
```
خروجی این دستور یه `database_id` می‌ده. اون رو داخل `wrangler.jsonc` جای
`REPLACE_WITH_YOUR_D1_DATABASE_ID` بذار.

### ۲. ساخت KV namespace (برای وضعیت مکالمه)
```bash
npx wrangler kv namespace create BOT_STATE
```
خروجی یه `id` می‌ده. اون رو داخل `wrangler.jsonc` جای
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID` بذار.

### ۳. اجرای migration (پر کردن دیتابیس با محصولات فعلی)
```bash
# لوکال (برای تست با wrangler dev)
npx wrangler d1 execute cafe-roshan-db --local --file=./migrations/0001_init.sql

# پروداکشن (روی خود Cloudflare)
npx wrangler d1 execute cafe-roshan-db --remote --file=./migrations/0001_init.sql
```

### ۴. تنظیم Secretهای بات (توکن و چت‌آیدی‌های مجاز)
هرگز توکن رو داخل کد، چت، یا `wrangler.jsonc` ننویس؛ به‌صورت secret ست کن:
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# وقتی پرسید، توکنی که از BotFather گرفتی رو پیست کن

npx wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS
# چت‌آیدی‌های مجاز رو با کاما جدا کن، مثلاً: 111111111,222222222
```
برای فهمیدن چت‌آیدی خودت: به بات @userinfobot تو تلگرام پیام بده.

### ۵. دیپلوی Worker
```bash
npm run deploy
```

### ۶. وصل کردن Webhook تلگرام به Worker
بعد از دیپلوی، آدرس Workerت چیزی شبیه این می‌شه:
`https://cafe-roshan.YOUR_SUBDOMAIN.workers.dev`

این URL رو به تلگرام معرفی کن (یه بار کافیه). **دقت کن که به‌جای `<TOKEN>` توکن واقعی رو
بدون علامت `< >` بذاری:**
```bash
curl "https://api.telegram.org/bot8433098266:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/setWebhook?url=https://cafe-roshan.YOUR_SUBDOMAIN.workers.dev/telegram-webhook"
```

برای چک کردن وضعیت webhook:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## نحوه‌ی کار بات (رابط دکمه‌ای)
- `/start` یا `/help` → منوی اصلی با ۳ دکمه: **📦 محصولات** | **➕ افزودن محصول** | **🏷 دسته‌بندی‌ها**
- **📦 محصولات** → لیست دکمه‌ای؛ روی هر محصول بزنی جزئیاتش با دکمه‌های **✏️ ویرایش** و **🗑 حذف** باز می‌شه
- **➕ افزودن محصول** → بات به‌ترتیب می‌پرسه: نام → دسته‌بندی (دکمه) → یادداشت (قابل رد کردن) → قیمت → عکس (قابل رد کردن)
- **✏️ ویرایش** → دکمه‌ی فیلد مورد نظر رو انتخاب می‌کنی (نام/قیمت/یادداشت/دسته‌بندی/عکس)، بعد مقدار جدید رو می‌فرستی
- **🗑 حذف** → یه پیام تاییدیه می‌پرسه قبل از حذف نهایی

هیچ‌جا لازم نیست دستور با `|` تایپ کنی؛ همه‌چیز با دکمه و پیام‌های راهنما پیش می‌ره.

## نکات امنیتی
- فقط چت‌آیدی‌های داخل `TELEGRAM_ALLOWED_CHAT_IDS` اجازه‌ی استفاده از بات رو دارن؛ بقیه پیام «⛔️ دسترسی ندارید» می‌گیرن.
- توکن بات هیچ‌وقت داخل کد commit نمی‌شه، فقط به‌صورت secret روی Cloudflare ذخیره‌ست.
- اگه فکر می‌کنی توکن فعلی جایی لو رفته (مثلاً تو یه چت یا لاگ)، از BotFather با `/revoke` توکن جدید بگیر و دوباره secret رو ست کن.

## تست سریع بدون دیپلوی واقعی
```bash
npm run dev
```
سپس با `curl` یه آپدیت جعلی تلگرام (پیام یا callback_query) به `/telegram-webhook` بفرست تا منطق DB/KV رو تست کنی.

