-- migrations/0010_bot_state.sql
-- حالت موقت ربات تلگرام (سشن مکالمه‌ی ادمین‌ها و آیدی آخرین پیام ربات)
-- قبلاً تو KV بود و هر پیام ربات یه write مصرف می‌کرد (سقف ۱۰۰۰ در روز تو پلن رایگان)؛
-- D1 سقف نوشتن خیلی بالاتری داره (۱۰۰ هزار ردیف در روز).

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER  -- میلی‌ثانیه‌ی یونیکس؛ NULL یعنی بدون انقضا
);
