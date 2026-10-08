// بررسی فرمت و بایت‌های جادویی (Magic Bytes) تصاویر برای جلوگیری از آپلود فایل‌های مخرب یا نامعتبر

export const ALLOWED_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export function detectImageFormat(buffer) {
  if (!buffer || buffer.byteLength < 12) return null;
  const bytes = new Uint8Array(buffer);

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }

  // GIF: 47 49 46 38 ("GIF8")
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "gif";
  }

  // WEBP: RIFF....WEBP (0..3: RIFF, 8..11: WEBP)
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

export function validateImage(buffer, ext) {
  const cleanExt = (ext || "").toLowerCase().replace(/^\./, "");
  if (!ALLOWED_IMAGE_EXTS.has(cleanExt)) {
    return { valid: false, error: "فرمت فایل مجاز نیست (فقط jpg, png, webp, gif)" };
  }
  const detected = detectImageFormat(buffer);
  if (!detected) {
    return { valid: false, error: "محتوای تصویر نامعتبر یا خراب است" };
  }
  // تطابق تقریبی فرمت با پسوند
  if (detected === "jpeg" && cleanExt !== "jpg" && cleanExt !== "jpeg") {
    return { valid: false, error: "فرمت فایل با پسوند ارسالی همخوانی ندارد" };
  }
  if (detected === "png" && cleanExt !== "png") {
    return { valid: false, error: "فرمت فایل با پسوند ارسالی همخوانی ندارد" };
  }
  if (detected === "gif" && cleanExt !== "gif") {
    return { valid: false, error: "فرمت فایل با پسوند ارسالی همخوانی ندارد" };
  }
  if (detected === "webp" && cleanExt !== "webp") {
    return { valid: false, error: "فرمت فایل با پسوند ارسالی همخوانی ندارد" };
  }
  return { valid: true, format: detected };
}
