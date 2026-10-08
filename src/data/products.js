// همه‌ی عملیات محصولات و دسته‌ها روی D1 (env.DB)

import { invalidateCache, PRODUCTS_CACHE_KEY } from "./cache.js";
import { MIN_PRICE, MAX_PRICE } from "../config.js";
const invalidate = (env) => invalidateCache(env, PRODUCTS_CACHE_KEY);

export function roundPrice(n) {
  if (n <= 0) return 0;
  const rounded = Math.round(n / 1000) * 1000;
  return rounded < MIN_PRICE ? MIN_PRICE : rounded;
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
  const items = [];
  for (const p of products) {
    const base = p.originalPrice ?? p.price;
    const newPrice = roundPrice(base * (1 + percent / 100));
    if (newPrice < MIN_PRICE) {
      throw new Error(`قیمت محصول «${p.name}» پس از اعمال درصد کمتر از حداقل مجاز (${MIN_PRICE.toLocaleString("fa-IR")} تومان) می‌شود.`);
    }
    if (newPrice > MAX_PRICE) {
      throw new Error(`قیمت محصول «${p.name}» پس از اعمال درصد بیشتر از حداکثر مجاز (${MAX_PRICE.toLocaleString("fa-IR")} تومان) می‌شود.`);
    }
    items.push({
      id: p.id,
      name: p.name,
      oldPrice: p.price,
      newPrice,
    });
  }
  return items;
}

// اعمال واقعی درصد روی یه دسته؛ همه‌ی آپدیت‌ها با batch یعنی یا همه انجام میشن یا هیچکدوم
// درصد مثبت = افزایش قیمت واقعی (تخفیف قبلی پاک میشه)
// درصد منفی = تخفیف دسته‌جمعی (قیمت اصلی به عنوان original_price نگه داشته میشه)
// اگر previewedItems ارسال شود، بررسی می‌شود که قیمت‌ها از زمان پیش‌نمایش تغییری نکرده باشند
export async function applyCategoryPercent(env, catId, percent, previewedItems = null) {
  const products = await productsInCategory(env, catId);
  if (products.length === 0) return;
  const productMap = new Map(products.map((p) => [p.id, p]));

  if (previewedItems && Array.isArray(previewedItems)) {
    for (const item of previewedItems) {
      const current = productMap.get(item.id);
      if (!current || current.price !== item.oldPrice) {
        throw new Error("قیمت برخی محصولات از زمان پیش‌نمایش تغییر کرده است. لطفاً مجدداً امتحان کنید.");
      }
    }
  }

  const itemsToApply = previewedItems || products;
  const stmts = itemsToApply.map((item) => {
    const p = productMap.get(item.id);
    const base = p.originalPrice ?? p.price;
    const newPrice = item.newPrice ?? roundPrice(base * (1 + percent / 100));
    const newOriginal = percent < 0 ? base : null;
    return env.DB.prepare("UPDATE products SET price = ?, original_price = ? WHERE id = ?").bind(
      newPrice,
      newOriginal,
      item.id
    );
  });
  await env.DB.batch(stmts);
  await invalidate(env);
}

export async function setProductPrice(env, productId, price) {
  const finalPrice = roundPrice(price);
  if (finalPrice < MIN_PRICE || finalPrice > MAX_PRICE) {
    throw new Error(`قیمت باید بین ${MIN_PRICE.toLocaleString("fa-IR")} تا ${MAX_PRICE.toLocaleString("fa-IR")} تومان باشد.`);
  }
  await env.DB
    .prepare("UPDATE products SET price = ?, original_price = NULL WHERE id = ?")
    .bind(finalPrice, productId)
    .run();
  await invalidate(env);
}

export async function setProductImage(env, productId, image) {
  await env.DB.prepare("UPDATE products SET image = ? WHERE id = ?").bind(image, productId).run();
  await invalidate(env);
}

// پنهان/نمایان کردن محصول رو سایت مشتری، بدون حذف کردنش (برای وقتی موقتاً موجود نیست)
export async function toggleProductAvailability(env, productId) {
  const row = await env.DB
    .prepare("UPDATE products SET available = 1 - available WHERE id = ? RETURNING available")
    .bind(productId)
    .first();
  if (!row) return null;
  await invalidate(env);
  return row.available;
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
  await invalidate(env);
}

export async function removeProductDiscount(env, productId) {
  const p = await findProduct(env, productId);
  if (!p || p.originalPrice == null) return;
  await env.DB
    .prepare("UPDATE products SET price = ?, original_price = NULL WHERE id = ?")
    .bind(p.originalPrice, productId)
    .run();
  await invalidate(env);
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
  await invalidate(env);
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
  await invalidate(env);
}

export async function deleteProduct(env, productId) {
  await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(productId).run();
  await invalidate(env);
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
  await invalidate(env);
}

export async function setCategoryImage(env, catId, image) {
  await env.DB.prepare("UPDATE categories SET image = ? WHERE id = ?").bind(image, catId).run();
  await invalidate(env);
}

export async function updateCategory(env, catId, label, image = null) {
  await env.DB
    .prepare("UPDATE categories SET label = ?, image = ? WHERE id = ?")
    .bind(label, image, catId)
    .run();
  await invalidate(env);
}

export async function deleteCategory(env, catId) {
  await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(catId).run();
  await invalidate(env);
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