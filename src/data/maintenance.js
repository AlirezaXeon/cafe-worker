// نگهداری/پاکسازی KV: پیدا کردن عکس‌هایی که دیگه به هیچ محصول/دسته/لوگو/کاوری وصل نیستن.
// این می‌تونه پیش بیاد اگه یه محصول/دسته حذف بشه یا عکسش عوض بشه، ولی فایل قدیمی از KV پاک نشه
// (مثلاً قبل از اینکه پاک‌سازی خودکار موقع آپلود اضافه بشه، یا هر باگ مشابه دیگه‌ای).

import { getProducts } from "./products.js";
import { getSiteConfig } from "./site.js";

const ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // ۲۴ ساعت مهلت برای آپلودهای تازه

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

// لیست کلیدهای KV (image:...) که به هیچ‌کدوم از موارد بالا وصل نیستن و بیش از ۲۴ ساعت عمر دارند
export async function findOrphanImageKeys(env, now = Date.now()) {
  const used = await usedImageFilenames(env);
  const orphans = [];
  let cursor;
  do {
    const page = await env.PRODUCTS_KV.list({ prefix: "image:", cursor });
    for (const k of page.keys) {
      const uploadedAt = k.metadata?.uploadedAt;
      // اگر عکس کمتر از ۲۴ ساعت پیش آپلود شده، هنوز ممکن است در حال ذخیره شدن باشد
      if (typeof uploadedAt === "number" && now - uploadedAt < ORPHAN_GRACE_PERIOD_MS) {
        continue;
      }
      const rawName = k.name.slice("image:".length);
      const filename = rawName.replace(/^(thumb|med):/, "");
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
