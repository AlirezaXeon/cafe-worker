-- migrations/0011_normalize_image_paths.sql
-- یکپارچه‌سازی فرمت مسیر تصاویر در دیتابیس به فرمت /images/<filename>
-- مسیرهای قدیمی ربات (images/products/... و images/categories/...) و وب را نرمال می‌کند.

UPDATE products
SET image = '/images/' || replace(image, 'images/products/', '')
WHERE image LIKE 'images/products/%';

UPDATE products
SET image = '/' || image
WHERE image LIKE 'images/%';

UPDATE categories
SET image = '/images/' || replace(image, 'images/categories/', '')
WHERE image LIKE 'images/categories/%';

UPDATE categories
SET image = '/' || image
WHERE image LIKE 'images/%';

UPDATE site_settings
SET value = '/' || value
WHERE key IN ('logo', 'cover') AND value LIKE 'images/%';
