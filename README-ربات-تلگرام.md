# راه‌اندازی ربات مدیریت کافه روشن

این فایل‌ها رو داخل ریپوی فعلی‌ات جایگزین/اضافه کن (مسیرها دقیقاً همینایی هستن که باید باشن):

```
src/index.js
src/products.js
src/telegram.js
src/session.js
public/js/script.js       (جایگزین فایل قبلی)
public/css/style.css      (جایگزین فایل قبلی)
public/data/products.seed.json   (فقط برای seed کردن، فایل products.json قبلی رو نگه دار یا حذف کن)
wrangler.jsonc            (جایگزین فایل قبلی)
package.json              (جایگزین فایل قبلی)
```

## ۱. ساخت ربات و گرفتن توکن
تو تلگرام برو سراغ **@BotFather**، بزن `/newbot` و مراحلش رو طی کن. یه توکن شبیه
`123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` بهت میده.

## ۲. گرفتن آیدی عددی خودت
پیام بده به **@userinfobot**، آیدی عددیت رو بهت میده (یه عدد، نه یوزرنیم).
اگه چند نفر می‌خوان مدیر باشن، همه آیدی‌ها رو با کاما جدا کن.

## ۳. ساخت KV namespace
```bash
npx wrangler kv namespace create PRODUCTS_KV
```
خروجیش یه `id` میده؛ همون رو داخل `wrangler.jsonc` جای `PUT_YOUR_KV_NAMESPACE_ID_HERE` بذار.

## ۴. ست کردن Secret ها
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ADMIN_IDS
npx wrangler secret put WEBHOOK_SECRET
```
- `TELEGRAM_BOT_TOKEN`: همون توکن مرحله ۱
- `ADMIN_IDS`: آیدی عددی خودت (یا چندتا با کاما، مثلاً `111111,222222`)
- `WEBHOOK_SECRET`: یه رشته‌ی تصادفی دلخواه بساز (مثلاً با `openssl rand -hex 16`)

## ۵. پر کردن KV با محصولات فعلی (فقط یه بار)
```bash
npm run seed
```
این دستور همون `public/data/products.seed.json` رو (که همون محصولات قبلیت با فیلد `originalPrice: null` هست) توی KV می‌ریزه.

## ۶. دیپلوی
```bash
npx wrangler deploy
```
آدرس ورکرت چیزی شبیه `https://cafe-roshan.<subdomain>.workers.dev` میشه.

## ۷. وصل کردن وبهوک تلگرام
```bash
curl -X POST "https://api.telegram.org/bot8433098266:AAE_SYEItfLc_h0uQZy1bum09lncpua0N8w/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://cafe-roshan.alireza.pespc.workers.dev/tg-webhook", "secret_token": "<Azda0905.>"}'
```
جای `<TELEGRAM_BOT_TOKEN>`, `<subdomain>` و `<WEBHOOK_SECRET>` مقادیر واقعی خودت رو بذار.

## ۸. تست
تو تلگرام به ربات `/start` بزن. باید منوی «📦 محصولات / 🏷 دسته‌بندی‌ها / 💰 تغییر قیمت دسته‌جمعی» رو ببینی.

---

## چه کارهایی از ربات برمیاد
- مرور محصولات هر دسته و دیدن جزئیات
- ویرایش مستقیم قیمت یه محصول
- اعمال تخفیف درصدی روی یه محصول (قیمت قبلی خط‌خورده + قیمت جدید تو سایت نشون داده میشه)
- حذف تخفیف یه محصول
- افزودن/حذف محصول
- افزودن/حذف دسته (دسته‌ای که محصول داره حذف نمیشه، باید اول خالیش کنی)
- **افزایش/کاهش درصدی قیمت کل یه دسته** (مثلاً ۲۰٪ رو کل قهوه‌ها) — قبل از اعمال، پیش‌نمایش قیمت‌های قبل/بعد رو نشون میده و تاییدت رو می‌خواد

نکته: اگه درصد بزنی مثبت (مثلاً `20`)، یعنی قیمت واقعاً بالا رفته و دیگه به‌عنوان تخفیف نشون داده نمیشه.
اگه منفی بزنی (مثلاً `-15`)، به‌عنوان تخفیف حساب میشه و قیمت قبلی خط‌خورده می‌مونه رو سایت.
