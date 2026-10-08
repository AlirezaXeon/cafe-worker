-- migrations/0008_orders_summary_index.sql
-- بهبود عملکرد کوئری‌های سفارشات با ایندکس ترکیبی وضعیت و شناسه
-- حذف نیاز به TEMP B-TREE برای مرتب‌سازی ORDER BY id DESC در فیلتر وضعیت

CREATE INDEX IF NOT EXISTS idx_orders_status_id ON orders(status, id);
