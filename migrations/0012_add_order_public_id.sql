-- migrations/0012_add_order_public_id.sql
-- شناسه عمومی امن تصادفی (UUID) برای پیگیری وضعیت سفارش توسط مشتری بدون افشای آی‌دی عددی ترتیبی

ALTER TABLE orders ADD COLUMN public_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_id ON orders(public_id) WHERE public_id IS NOT NULL;
