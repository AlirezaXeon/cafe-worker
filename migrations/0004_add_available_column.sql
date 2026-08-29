-- migrations/0004_add_available_column.sql
-- امکان پنهان کردن یه محصول از سایت مشتری بدون حذف کردنش (وقتی موقتاً موجود نیست).
-- پیش‌فرض 1 (موجود/نمایان) میذاریم تا محصولات فعلی همه همون‌طور که بودن نمایش داده بشن.

ALTER TABLE products ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
