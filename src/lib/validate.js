import { MIN_PRICE, MAX_PRICE, MIN_PERCENT, MAX_PERCENT } from "../config.js";

// اعتبارسنجی قیمت (تومان)
export function validatePrice(input) {
  if (input === null || input === undefined || input === "") {
    return { valid: false, error: "قیمت نمی‌تواند خالی باشد" };
  }
  let str = String(input).trim().replace(/[,\s]/g, "");
  // رد کردن نماد علمی (مانند 1e3)
  if (/[eE]/.test(str)) {
    return { valid: false, error: "فرمت قیمت نامعتبر است" };
  }
  if (!/^\d+$/.test(str)) {
    return { valid: false, error: "قیمت باید یک عدد صحیح معتبر باشد" };
  }
  const price = Number(str);
  if (!Number.isSafeInteger(price)) {
    return { valid: false, error: "قیمت نامعتبر است" };
  }
  if (price < MIN_PRICE) {
    return {
      valid: false,
      error: `حداقل قیمت مجاز ${MIN_PRICE.toLocaleString("fa-IR")} تومان است`,
    };
  }
  if (price > MAX_PRICE) {
    return {
      valid: false,
      error: `حداکثر قیمت مجاز ${MAX_PRICE.toLocaleString("fa-IR")} تومان است`,
    };
  }
  return { valid: true, price };
}

// اعتبارسنجی درصد دسته‌جمعی (مثلاً 20 یا -10)
export function validatePercent(input) {
  if (input === null || input === undefined || input === "") {
    return { valid: false, error: "درصد نمی‌تواند خالی باشد" };
  }
  let str = String(input).trim().replace(/[٪%]/g, "").trim();
  // رد کردن نماد علمی
  if (/[eE]/.test(str)) {
    return { valid: false, error: "فرمت درصد نامعتبر است" };
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(str)) {
    return { valid: false, error: "درصد باید یک عدد معتبر باشد" };
  }
  const val = Number(str);
  if (!Number.isFinite(val)) {
    return { valid: false, error: "درصد نامعتبر است" };
  }
  if (val < MIN_PERCENT || val > MAX_PERCENT) {
    return {
      valid: false,
      error: `درصد باید بین ${MIN_PERCENT}٪ تا ${MAX_PERCENT}٪ باشد`,
    };
  }
  return { valid: true, percent: val };
}

// اعتبارسنجی درصد تخفیف تک‌محصول (۰ تا ۹۹)
export function validateDiscount(input) {
  if (input === null || input === undefined || input === "") {
    return { valid: true, discount: 0 };
  }
  let str = String(input).trim().replace(/[٪%]/g, "").trim();
  if (/[eE]/.test(str)) {
    return { valid: false, error: "فرمت تخفیف نامعتبر است" };
  }
  if (!/^\d+(\.\d+)?$/.test(str)) {
    return { valid: false, error: "درصد تخفیف باید یک عدد مثبت باشد" };
  }
  const val = Number(str);
  if (!Number.isFinite(val) || val < 0 || val >= 100) {
    return { valid: false, error: "درصد تخفیف باید بین ۰ تا ۹۹ باشد" };
  }
  return { valid: true, discount: val };
}
