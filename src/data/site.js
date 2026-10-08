// تنظیمات کلی سایت (لوگو + عکس بالای سایت) — توی KV نگه داشته میشه، مستقل از محصولات (D1)

import { invalidateCache, SITE_CACHE_KEY } from "./cache.js";

const DEFAULTS = {
  logo: null, // تا وقتی از ربات/پنل آپلود نشده، سایت فقط فالبک متنی نشون میده
  cover: null, // تا وقتی از ربات/پنل آپلود نشده، سایت یه پس‌زمینه‌ی ساده نشون میده
};

const EXT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", gif: "image/gif",
};

export async function getSiteConfig(env) {
  const raw = await env.PRODUCTS_KV.get("site:config");
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function updateSiteConfig(env, patch) {
  const current = await getSiteConfig(env);
  const next = { ...current, ...patch };
  await env.PRODUCTS_KV.put("site:config", JSON.stringify(next));
  await invalidateCache(env, SITE_CACHE_KEY);
  return next;
}

export const setSiteLogo = (env, path) => updateSiteConfig(env, { logo: path });
export const setSiteCover = (env, path) => updateSiteConfig(env, { cover: path });

const deleteOldImage = async (env, oldPath, keepFilename) => {
  if (!oldPath) return;
  const f = oldPath.split("/").pop();
  if (f && f !== keepFilename) await env.PRODUCTS_KV.delete(`image:${f}`);
};

// برای پنل وب: ذخیره‌ی لوگو/کاور (kind = "logo" | "cover") + پاک کردن فایل قبلی
export async function saveSiteImage(env, kind, buffer, ext) {
  const filename = `site-${kind}-${Date.now()}.${ext}`;
  await env.PRODUCTS_KV.put(`image:${filename}`, buffer, {
    metadata: { contentType: EXT_TYPES[ext] || "image/jpeg", uploadedAt: Date.now() },
  });
  const old = (await getSiteConfig(env))[kind];
  const path = `images/${filename}`;
  await updateSiteConfig(env, { [kind]: path });
  await deleteOldImage(env, old, filename);
  return path;
}

export async function removeSiteImage(env, kind) {
  const old = (await getSiteConfig(env))[kind];
  await updateSiteConfig(env, { [kind]: null });
  await deleteOldImage(env, old, null);
}