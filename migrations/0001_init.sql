-- migrations/0001_init.sql
-- ساخت جدول‌های اصلی + seed کردن دیتای فعلی منو (همون چیزی که تو products.json بود)

CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
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

-- ============ دسته‌بندی‌ها ============
INSERT INTO categories (id, label) VALUES
  ('coffee',    'قهوه'),
  ('dessert',   'دسر'),
  ('breakfast', 'صبحانه');

-- ============ محصولات (دیتای فعلی از products.json) ============
INSERT INTO products (id, category, name, note, price, image) VALUES
  ('p1',  'coffee',    'اسپرسو',          'دان برزیل، تلخی متعادل',        85000,  'images/products/espresso.jpg'),
  ('p2',  'coffee',    'لاته',            'شیر بخارداده، اسپرسو دوبل',      115000, 'images/products/latte.jpg'),
  ('p3',  'coffee',    'فلت وایت',        'کرمای غلیظ، طعم قوی',           125000, 'images/products/flatwhite.jpg'),
  ('p4',  'coffee',    'قهوه دمی',        'روش V60، دان اتیوپی',           140000, 'images/products/pourover.jpg'),
  ('p5',  'dessert',   'تیرامیسو',        'دستی، رست تازه روزانه',         165000, 'images/products/tiramisu.jpg'),
  ('p6',  'dessert',   'چیزکیک لیمو',     'خامه‌ای، ترش‌وشیرین',            155000, 'images/products/cheesecake.jpg'),
  ('p7',  'dessert',   'براونی',          'شکلات تلخ ۷۰٪',                95000,  'images/products/brownie.jpg'),
  ('p8',  'breakfast', 'صبحانه کامل',     'تخم‌مرغ، نان، پنیر، مربا',       220000, 'images/products/breakfast.jpg'),
  ('p9',  'breakfast', 'کروسان',          'پخت تازه، کره‌ای',              90000,  'images/products/croissant.jpg'),
  ('p10', 'breakfast', 'املت سبزیجات',   'با نان تست',                    130000, 'images/products/omelette.jpg');