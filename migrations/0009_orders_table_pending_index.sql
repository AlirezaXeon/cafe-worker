-- migrations/0009_orders_table_pending_index.sql
-- ایندکس ترکیبی برای محدود کردن تعداد سفارش‌های در انتظار تایید به ازای هر میز

CREATE INDEX IF NOT EXISTS idx_orders_table_status_created ON orders(table_number, status, created_at);
