-- migrations/0005_add_orders_table.sql
-- سفارش‌های ثبت‌شده از سایت؛ چون لاگین/پرداختی نیست، هر سفارش تا وقتی گارسون
-- با چک کردن شماره‌ی میز تاییدش نکنه، «در انتظار تایید» (pending) می‌مونه.

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_number TEXT NOT NULL,
  items TEXT NOT NULL,          -- JSON array: [{id, name, price, quantity}]
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
