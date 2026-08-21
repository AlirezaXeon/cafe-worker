-- migrations/0002_add_original_price.sql
-- رفع باگ: ستون original_price هیچ‌وقت به جدول products اضافه نشده بود، در حالی که
-- products.js (نسخه‌ی D1) توی همه‌ی کوئری‌هاش (getProducts, findProduct, applyCategoryPercent, ...)
-- دنبال این ستون می‌گرده. چون دیتابیس روی کلودفلر از قبل ساخته شده، ویرایش خود 0001 کافی نیست
-- (مایگریشن‌های قبلی دوباره اجرا نمی‌شن)، برای همین این مایگریشن جدید فقط ستون رو اضافه می‌کنه.

ALTER TABLE products ADD COLUMN original_price INTEGER;