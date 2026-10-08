// چون Cloudflare Workers کتابخونه‌ی resize/بومی تصویر نداره (بدون Cloudflare Images binding یا
// سرویس خارجی)، برای جلوگیری از عکس‌های خیلی سنگین تو KV، حداقل یه سقف حجمی روشن با خطای
// واضح می‌ذاریم؛ هم تو آپلود از پنل وب هم از ربات تلگرام.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // ۲ مگابایت

// محدودیت نرخ ثبت سفارش بر اساس آی‌پی (حداکثر ۵ سفارش در هر ۱۰ دقیقه)
export const ORDER_RATE_LIMIT_MAX = 5;
export const ORDER_RATE_LIMIT_WINDOW_SEC = 10 * 60; // ۶۰۰ ثانیه (۱۰ دقیقه)

// محدوده‌های مجاز قیمت و درصد (تومان)
export const MIN_PRICE = 1000;
export const MAX_PRICE = 50_000_000;
export const MIN_PERCENT = -90;
export const MAX_PERCENT = 300;
