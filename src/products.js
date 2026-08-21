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
        "SELECT id, category, name, note, price, original_price AS originalPrice, image FROM products"
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
      "SELECT id, category, name, note, price, original_price AS originalPrice, image FROM products WHERE category = ?"
    )
    .bind(catId)
    .all();
  return results;
}

export async function findProduct(env, productId) {
  return env.DB
    .prepare(
      "SELECT id, category, name, note, price, original_price AS originalPrice, image FROM products WHERE id = ?"
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

export async function addProduct(env, { id, category, name, note, price, image }) {
  await env.DB
    .prepare(
      "INSERT INTO products (id, category, name, note, price, original_price, image) VALUES (?, ?, ?, ?, ?, NULL, ?)"
    )
    .bind(id, category, name, note, roundPrice(price), image)
    .run();
}

export async function deleteProduct(env, productId) {
  await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(productId).run();
}

export async function addCategory(env, id, label) {
  await env.DB.prepare("INSERT INTO categories (id, label) VALUES (?, ?)").bind(id, label).run();
}

export async function deleteCategory(env, catId) {
  await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(catId).run();
}

export async function nextProductId(env) {
  const { results } = await env.DB.prepare("SELECT id FROM products").all();
  const ids = new Set(results.map((r) => r.id));
  let n = ids.size + 1;
  while (ids.has(`p${n}`)) n++;
  return `p${n}`;
}
