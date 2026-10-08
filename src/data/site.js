// تنظیمات کلی سایت (لوگو، عکس بالای سایت، تعداد میز و ...)
// ذخیره‌سازی اتمیک در D1 (جدول site_settings) با فالبک خواندن از KV برای اجراهای اولیه

import { invalidateCache, SITE_CACHE_KEY } from "./cache.js";

const DEFAULTS = {
  logo: null, // تا وقتی از ربات/پنل آپلود نشده، سایت فقط فالبک متنی نشون میده
  cover: null, // تا وقتی از ربات/پنل آپلود نشده، سایت یه پس‌زمینه‌ی ساده نشون میده
  tableCount: 20,
};

const EXT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", gif: "image/gif",
};

export async function getSiteConfig(env) {
  // ۱. تلاش برای خواندن از جدول site_settings در D1
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare("SELECT key, value FROM site_settings").all();
      if (results && results.length > 0) {
        const config = { ...DEFAULTS };
        for (const row of results) {
          if (row.key === "tableCount" || row.key === "table_count") {
            config.tableCount = Number(row.value) || 20;
          } else {
            config[row.key] = row.value === "" ? null : row.value;
          }
        }
        return config;
      }
    } catch {
      // در صورت نبودن جدول هنوز، به مرحله بعد (فالبک KV) می‌رویم
    }
  }

  // ۲. فالبک: خواندن از کلید قدیمی site:config در KV
  if (env.PRODUCTS_KV) {
    try {
      const raw = await env.PRODUCTS_KV.get("site:config");
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULTS, ...parsed };
      }
    } catch {
      // داده نامعتبر یا خطا
    }
  }

  return { ...DEFAULTS };
}

export async function setSiteSetting(env, key, value) {
  const valStr = value === null || value === undefined ? "" : String(value);
  if (env.DB) {
    await env.DB
      .prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)")
      .bind(key, valStr)
      .run();
  }
  await invalidateCache(env, SITE_CACHE_KEY);
}

export async function updateSiteConfig(env, patch) {
  for (const [k, v] of Object.entries(patch)) {
    await setSiteSetting(env, k, v);
  }
  return getSiteConfig(env);
}

export const setSiteLogo = (env, path) => setSiteSetting(env, "logo", path);
export const setSiteCover = (env, path) => setSiteSetting(env, "cover", path);

const deleteOldImage = async (env, oldPath, keepFilename) => {
  if (!oldPath || !env.PRODUCTS_KV) return;
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
  await setSiteSetting(env, kind, path);
  await deleteOldImage(env, old, filename);
  return path;
}

export async function removeSiteImage(env, kind) {
  const old = (await getSiteConfig(env))[kind];
  await setSiteSetting(env, kind, null);
  await deleteOldImage(env, old, null);
}