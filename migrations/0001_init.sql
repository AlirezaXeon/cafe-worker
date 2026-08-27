-- migrations/0001_init.sql
-- ساخت جدول‌های اصلی + seed کردن دیتای فعلی منو (همون چیزی که تو products.json بود)

CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  image TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id       TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name     TEXT NOT NULL,
  note     TEXT,
  price    INTEGER NOT NULL,
  image    TEXT,
  FOREIGN KEY (category) REFERENCES categories(id)
);

-- دیتای اولیه: همون چیزی که تو public/data/products.json بود
-- نکته: image رو NULL گذاشتیم؛ عکس واقعی رو از ربات تلگرام برای هر دسته/محصول ست کن
INSERT INTO categories (id, label, image) VALUES
  ('coffee', 'قهوه', NULL),
  ('dessert', 'دسر', NULL),
  ('breakfast', 'صبحانه', NULL);

-- ============ محصولات (دیتای فعلی از products.json) ============
INSERT INTO products (id, category, name, note, price, image) VALUES
  ('p1',  'coffee',    'اسپرسو',          'دان برزیل، تلخی متعادل',        85000,  NULL),
  ('p2',  'coffee',    'لاته',            'شیر بخارداده، اسپرسو دوبل',      115000, NULL),
  ('p3',  'coffee',    'فلت وایت',        'کرمای غلیظ، طعم قوی',           125000, NULL),
  ('p4',  'coffee',    'قهوه دمی',        'روش V60، دان اتیوپی',           140000, NULL),
  ('p5',  'dessert',   'تیرامیسو',        'دستی، رست تازه روزانه',         165000, NULL),
  ('p6',  'dessert',   'چیزکیک لیمو',     'خامه‌ای، ترش‌وشیرین',            155000, NULL),
  ('p7',  'dessert',   'براونی',          'شکلات تلخ ۷۰٪',                95000,  NULL),
  ('p8',  'breakfast', 'صبحانه کامل',     'تخم‌مرغ، نان، پنیر، مربا',       220000, NULL),
  ('p9',  'breakfast', 'کروسان',          'پخت تازه، کره‌ای',              90000,  NULL),
  ('p10', 'breakfast', 'املت سبزیجات',   'با نان تست',                    130000, NULL);