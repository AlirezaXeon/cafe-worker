// منطق مشترک «الان باز هستیم یا نه» بر اساس OPENING_HOURS (src/config.js)
// ایران ساعت تابستانی نداره و همیشه +۳:۳۰ هست (همون روشی که tehranBoundaries تو src/data/orders.js استفاده میکنه)
// توجه: این منطق در کلاینت (public/js/script.js) نیز جداگانه پیاده شده است و در صورت تغییر باید هر دو با هم هماهنگ شوند.
import { TEHRAN_OFFSET_MS } from "./time.js";
import { OPENING_HOURS } from "../config.js";

export function buildOpeningHoursSpecification(openingHours = OPENING_HOURS) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (openingHours?.schedule || []).map((s) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: s.days.map((d) => dayNames[d]),
    opens: s.open,
    closes: s.close === "24:00" ? "23:59" : s.close,
  }));
}

// "08:30" ← 510 (دقیقه از ابتدای روز)؛ "24:00" ← 1440
export function toMinutes(hhmm) {
  const [h, m = 0] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

// روز هفته (۰=یکشنبه ... ۶=شنبه) و دقیقه‌ی گذشته از نیمه‌شب، به وقت تهران
export function tehranDayAndMinutes(now = Date.now()) {
  const d = new Date(now + TEHRAN_OFFSET_MS);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function slotForDay(hours, day) {
  return hours.schedule.find((s) => s.days.includes(day)) ?? null;
}

export function getOpenStatus(hours, now = Date.now()) {
  const { day, minutes } = tehranDayAndMinutes(now);
  const slot = slotForDay(hours, day);
  const open = !!slot && minutes >= toMinutes(slot.open) && minutes < toMinutes(slot.close);
  return { open, slot };
}

// اولین باز شدن بعدی: قبل از ساعت باز شدن «امروز»، وگرنه «فردا»
export function nextOpening(hours, now = Date.now()) {
  const { day, minutes } = tehranDayAndMinutes(now);
  const today = slotForDay(hours, day);
  if (today && minutes < toMinutes(today.open)) return { when: "امروز", time: today.open };
  const tomorrow = slotForDay(hours, (day + 1) % 7);
  return tomorrow ? { when: "فردا", time: tomorrow.open } : null;
}
