-- migrations/0003_clear_dead_image_paths.sql
-- پوشه‌ی public/images حذف شده، ولی چون مایگریشن 0001 روی دیتابیس واقعی از قبل اجرا شده،
-- ویرایش خود 0001 تأثیری روی دیتابیس لایو نداره. این مایگریشن مسیرهای مرده‌ای که به عکس‌های
-- حذف‌شده اشاره می‌کردن رو NULL می‌کنه تا فرانت با فالبک خودش (عکس دسته یا حرف اول اسم) درست کار کنه.

UPDATE categories SET image = NULL WHERE image LIKE 'images/categories/%';

UPDATE products SET image = NULL WHERE image LIKE 'images/products/%';
