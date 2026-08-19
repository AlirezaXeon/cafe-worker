const KEY = "products";

export async function getProducts(env) {
  const raw = await env.PRODUCTS_KV.get(KEY);
  return raw ? JSON.parse(raw) : { categories: [], products: [] };
}

export async function saveProducts(env, data) {
  await env.PRODUCTS_KV.put(KEY, JSON.stringify(data));
}

// قیمت رو به نزدیک‌ترین هزار تومان گرد می‌کنه (هماهنگ با استایل قیمت‌گذاری فعلی سایت)
export function roundPrice(n) {
  return Math.round(n / 1000) * 1000;
}

export function findCategory(data, catId) {
  return data.categories.find((c) => c.id === catId);
}

export function productsInCategory(data, catId) {
  return data.products.filter((p) => p.category === catId);
}

export function findProduct(data, productId) {
  return data.products.find((p) => p.id === productId);
}

// پیش‌نمایش اعمال درصد روی یه دسته، بدون ذخیره کردن (برای تایید گرفتن از ادمین)
export function previewCategoryPercent(data, catId, percent) {
  return productsInCategory(data, catId).map((p) => ({
    id: p.id,
    name: p.name,
    oldPrice: p.price,
    newPrice: roundPrice(p.price * (1 + percent / 100)),
  }));
}

// اعمال واقعی درصد روی یه دسته
// درصد مثبت = افزایش قیمت واقعی (تخفیف قبلی پاک میشه، این قیمت جدیدِ رسمیه)
// درصد منفی = تخفیف دسته‌جمعی (قیمت اصلی به عنوان originalPrice نگه داشته میشه)
export function applyCategoryPercent(data, catId, percent) {
  data.products.forEach((p) => {
    if (p.category !== catId) return;
    const newPrice = roundPrice(p.price * (1 + percent / 100));
    if (percent < 0) {
      if (p.originalPrice == null) p.originalPrice = p.price;
    } else if (percent > 0) {
      p.originalPrice = null;
    }
    p.price = newPrice;
  });
  return data;
}

export function setProductDiscount(product, percent) {
  if (product.originalPrice == null) product.originalPrice = product.price;
  product.price = roundPrice(product.originalPrice * (1 - percent / 100));
}

export function removeProductDiscount(product) {
  if (product.originalPrice != null) {
    product.price = product.originalPrice;
    product.originalPrice = null;
  }
}

export function nextProductId(data) {
  let n = data.products.length + 1;
  while (data.products.some((p) => p.id === `p${n}`)) n++;
  return `p${n}`;
}