// مدیریت یکپارچه مسیر و نام فایل تصاویر

export function imageFilename(path) {
  if (!path || typeof path !== "string") return "";
  return path.split("/").pop().trim();
}

export function imageUrl(filename) {
  if (!filename) return "";
  const clean = imageFilename(filename);
  return clean ? `/images/${clean}` : "";
}

// حذف کلیدهای مربوط به یک تصویر و مشتقات آن (thumb / med) از KV
export async function deleteImageKeys(env, filenameOrPath) {
  const filename = imageFilename(filenameOrPath);
  if (!filename || !env?.PRODUCTS_KV) return;
  await Promise.allSettled([
    env.PRODUCTS_KV.delete(`image:${filename}`),
    env.PRODUCTS_KV.delete(`image:thumb:${filename}`),
    env.PRODUCTS_KV.delete(`image:med:${filename}`),
  ]);
}
