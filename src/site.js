// تنظیمات کلی سایت (لوگو + عکس بالای سایت) — توی KV نگه داشته میشه، مستقل از محصولات (D1)

const DEFAULTS = {
  logo: "images/logo.png",
  cover: null, // تا وقتی از ربات آپلود نشده، سایت یه پس‌زمینه‌ی ساده نشون میده
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
  return next;
}

export const setSiteLogo = (env, path) => updateSiteConfig(env, { logo: path });
export const setSiteCover = (env, path) => updateSiteConfig(env, { cover: path });
