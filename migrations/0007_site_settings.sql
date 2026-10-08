-- migrations/0007_site_settings.sql
-- F8: جدول تنظیمات سایت برای ذخیره اتمیک تنظیمات (لوگو، کاور، تعداد میز و ...) و حذف race condition

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
