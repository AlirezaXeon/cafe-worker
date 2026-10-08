-- migrations/0006_orders_hardening.sql
-- F1 & F5: بهینه‌سازی جدول سفارش‌ها، ضدتکرار با request_id، محدودیت نرخ با ip_hash و ذخیره پیام‌های تلگرام

ALTER TABLE orders ADD COLUMN request_id TEXT;
ALTER TABLE orders ADD COLUMN ip_hash TEXT;
ALTER TABLE orders ADD COLUMN tg_messages TEXT;
ALTER TABLE orders ADD COLUMN tg_notified INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id ON orders(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_ip_created_at ON orders(ip_hash, created_at);
