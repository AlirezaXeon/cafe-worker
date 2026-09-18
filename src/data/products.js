// همه‌ی عملیات محصولات و دسته‌ها روی D1 (env.DB)

export function roundPrice(n) {
  return Math.round(n / 1000) * 1000;
}

// خوندن کامل محصولات+دسته‌ها (برای نمایش سایت و لیست‌های ادمین)
export async function getProducts(env) {
  const [catRes, prodRes] = await Promise.all([
    env.DB.prepare("SELECT id, label, image FROM categories").all(),
    env.DB
      .prepare(
        "SELECT id, category, name, note, price, original_price AS originalPrice, image, available FROM products"
      )
      .all(),
  ]);
  return { categories: catRes.results, products: prodRes.results };
}

export async function findCategory(env, catId) {
  return env.DB.prepare("SELECT id, label, image FROM categories WHERE id = ?")
    .bind(catId)
    .first();
}

export async function productsInCategory(env, catId) {
  const { results } = await env.DB
    .prepare(
      "SELECT id, category, name, note, price, original_price AS originalPrice, image, available FROM products WHERE category = ?"
    )
    .bind(catId)
    .all();
  return results;
}

export async function findProduct(env, productId) {
  return env.DB
    .prepare(
      "SELECT id, category, name, note, price, original_price AS originalPrice, image, available FROM products WHERE id = ?"
    )
    .bind(productId)
    .first();
}

// پیش‌نمایش اعمال درصد روی یه دسته، بدون نوشتن چیزی (برای تایید گرفتن از ادمین)
export async function previewCategoryPercent(env, catId, percent) {
  const products = await productsInCategory(env, catId);
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    oldPrice: p.price,
    newPrice: roundPrice(p.price * (1 + percent / 100)),
  }));
}

// اعمال واقعی درصد روی یه دسته؛ همه‌ی آپدیت‌ها با batch یعنی یا همه انجام میشن یا هیچکدوم
// درصد مثبت = افزایش قیمت واقعی (تخفیف قبلی پاک میشه)
// درصد منفی = تخفیف دسته‌جمعی (قیمت اصلی به عنوان original_price نگه داشته میشه)
export async function applyCategoryPercent(env, catId, percent) {
  const products = await productsInCategory(env, catId);
  if (products.length === 0) return;
  const stmts = products.map((p) => {
    const newPrice = roundPrice(p.price * (1 + percent / 100));
    const newOriginal = percent < 0 ? p.originalPrice ?? p.price : null;
    return env.DB.prepare("UPDATE products SET price = ?, original_price = ? WHERE id = ?").bind(
      newPrice,
      newOriginal,
      p.id
    );
  });
  await env.DB.batch(stmts);
}

export async function setProductPrice(env, productId, price) {
  await env.DB
    .prepare("UPDATE products SET price = ?, original_price = NULL WHERE id = ?")
    .bind(roundPrice(price), productId)
    .run();
}

export async function setProductImage(env, productId, image) {
  await env.DB.prepare("UPDATE products SET image = ? WHERE id = ?").bind(image, productId).run();
}

// پنهان/نمایان کردن محصول رو سایت مشتری، بدون حذف کردنش (برای وقتی موقتاً موجود نیست)
export async function toggleProductAvailability(env, productId) {
  const p = await env.DB.prepare("SELECT available FROM products WHERE id = ?").bind(productId).first();
  if (!p) return null;
  const next = p.available ? 0 : 1;
  await env.DB.prepare("UPDATE products SET available = ? WHERE id = ?").bind(next, productId).run();
  return next;
}

export async function setProductDiscount(env, productId, percent) {
  const p = await findProduct(env, productId);
  if (!p) return;
  const base = p.originalPrice ?? p.price;
  const newPrice = roundPrice(base * (1 - percent / 100));
  await env.DB
    .prepare("UPDATE products SET price = ?, original_price = ? WHERE id = ?")
    .bind(newPrice, base, productId)
    .run();
}

export async function removeProductDiscount(env, productId) {
  const p = await findProduct(env, productId);
  if (!p || p.originalPrice == null) return;
  await env.DB
    .prepare("UPDATE products SET price = ?, original_price = NULL WHERE id = ?")
    .bind(p.originalPrice, productId)
    .run();
}

// قیمت پایه + درصد تخفیف ← قیمتی که باید ذخیره بشه.
// تنها جایی که منطق تخفیف حساب میشه؛ ربات و پنل وب هر دو از همین رد میشن تا نتیجه‌شون یکی باشه.
// discount = 0 یعنی بدون تخفیف (original_price پاک میشه).
export function resolvePrice(basePrice, discountPercent = 0) {
  const base = roundPrice(basePrice);
  const d = Number(discountPercent) || 0;
  if (d <= 0 || d >= 100) return { price: base, originalPrice: null };
  return { price: roundPrice(base * (1 - d / 100)), originalPrice: base };
}

export async function addProduct(env, { id, category, name, note, price, image, discount = 0, available = 1 }) {
  const { price: finalPrice, originalPrice } = resolvePrice(price, discount);
  await env.DB
    .prepare(
      "INSERT INTO products (id, category, name, note, price, original_price, image, available) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, category, name, note ?? "", finalPrice, originalPrice, image ?? null, available)
    .run();
}

export async function updateProduct(env, id, { category, name, note, price, image, discount = 0, available = 1 }) {
  const { price: finalPrice, originalPrice } = resolvePrice(price, discount);
  await env.DB
    .prepare(
      `UPDATE products
       SET name = ?, category = ?, note = ?, price = ?, original_price = ?, image = ?, available = ?
       WHERE id = ?`
    )
    .bind(name, category, note ?? "", finalPrice, originalPrice, image ?? null, available, id)
    .run();
}

export async function deleteProduct(env, productId) {
  await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(productId).run();
}

// ---------- لیست‌ها و شمارش‌ها (برای پنل وب) ----------

export async function listProducts(env) {
  const { results } = await env.DB
    .prepare(
      "SELECT id, category, name, note, price, original_price, image, available FROM products ORDER BY category, name"
    )
    .all();
  return results;
}

export async function listCategories(env) {
  const { results } = await env.DB
    .prepare("SELECT id, label, image FROM categories ORDER BY label")
    .all();
  return results;
}

export async function countProductsInCategory(env, catId) {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS c FROM products WHERE category = ?")
    .bind(catId)
    .first();
  return row?.c ?? 0;
}

export async function getStats(env) {
  const [total, avail, cats] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS c FROM products").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM products WHERE available = 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM categories").first(),
  ]);
  return {
    totalProducts: total?.c ?? 0,
    availableProducts: avail?.c ?? 0,
    totalCategories: cats?.c ?? 0,
  };
}

export async function addCategory(env, id, label, image = null) {
  await env.DB.prepare("INSERT INTO categories (id, label, image) VALUES (?, ?, ?)")
    .bind(id, label, image)
    .run();
}

export async function setCategoryImage(env, catId, image) {
  await env.DB.prepare("UPDATE categories SET image = ? WHERE id = ?").bind(image, catId).run();
}

export async function updateCategory(env, catId, label, image = null) {
  await env.DB
    .prepare("UPDATE categories SET label = ?, image = ? WHERE id = ?")
    .bind(label, image, catId)
    .run();
}

export async function deleteCategory(env, catId) {
  await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(catId).run();
}

// ---------- تولید شناسه ----------
// قبلاً کل جدول محصولات خونده می‌شد تا شماره‌ی بعدی پیدا بشه؛ هم کند بود، هم اگه ربات و
// پنل وب هم‌زمان محصول می‌ساختن هر دو یه id می‌گرفتن و دومی روی کلید اصلی خطا می‌خورد.
// حالا از تایم‌استمپ استفاده می‌کنیم: بدون خوندن دیتابیس و بدون برخورد.
// ربات و پنل وب هر دو از همین دو تابع استفاده می‌کنن تا فرمت شناسه‌ها یکسان بمونه.
const idSuffix = () => Math.random().toString(36).slice(2, 6);

export function newProductId() {
  return `p-${Date.now().toString(36)}-${idSuffix()}`;
}

export function newCategoryId() {
  return `cat-${Date.now().toString(36)}-${idSuffix()}`;
}