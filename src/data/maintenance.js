// نگهداری/پاکسازی KV: پیدا کردن عکس‌هایی که دیگه به هیچ محصول/دسته/لوگو/کاوری وصل نیستن.
// این می‌تونه پیش بیاد اگه یه محصول/دسته حذف بشه یا عکسش عوض بشه، ولی فایل قدیمی از KV پاک نشه
// (مثلاً قبل از اینکه پاک‌سازی خودکار موقع آپلود اضافه بشه، یا هر باگ مشابه دیگه‌ای).

import { getProducts } from "./products.js";
import { getSiteConfig } from "./site.js";

// اسم فایل همه‌ی عکس‌هایی که این لحظه واقعاً جایی استفاده میشن
async function usedImageFilenames(env) {
  const [{ categories, products }, siteCfg] = await Promise.all([
    getProducts(env),
    getSiteConfig(env),
  ]);
  const used = new Set();
  for (const c of categories) if (c.image) used.add(c.image.split("/").pop());
  for (const p of products) if (p.image) used.add(p.image.split("/").pop());
  if (siteCfg.logo) used.add(siteCfg.logo.split("/").pop());
  if (siteCfg.cover) used.add(siteCfg.cover.split("/").pop());
  return used;
}

// لیست کلیدهای KV (image:...) که به هیچ‌کدوم از موارد بالا وصل نیستن
export async function findOrphanImageKeys(env) {
  const used = await usedImageFilenames(env);
  const orphans = [];
  let cursor;
  do {
    const page = await env.PRODUCTS_KV.list({ prefix: "image:", cursor });
    for (const k of page.keys) {
      const filename = k.name.slice("image:".length);
      if (!used.has(filename)) orphans.push(k.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return orphans;
}

// واقعاً حذفشون می‌کنه؛ تعداد حذف‌شده‌ها رو برمی‌گردونه
export async function deleteOrphanImages(env) {
  const orphans = await findOrphanImageKeys(env);
  for (const key of orphans) {
    await env.PRODUCTS_KV.delete(key);
  }
  return orphans.length;
}
