// ---------- کمک‌کننده‌های فرمت متن/عدد فارسی ----------

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export const toFa = (v) => String(v).replace(/[0-9]/g, (d) => FA_DIGITS[d]);

export const formatToman = (n) =>
  toFa(Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")) + " تومان";

export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
