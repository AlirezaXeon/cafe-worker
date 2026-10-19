import { test } from "node:test";
import assert from "node:assert/strict";
import { OPENING_HOURS } from "../src/config.js";
import { toMinutes, tehranDayAndMinutes, getOpenStatus, nextOpening, buildOpeningHoursSpecification } from "../src/lib/hours.js";

// ساعت‌های تستی جدا از config.js، تا عوض کردن ساعت واقعی کافه تست‌ها رو خراب نکنه
const HOURS = {
  schedule: [
    { label: "شنبه تا چهارشنبه", days: [6, 0, 1, 2, 3], open: "08:00", close: "23:00" },
    { label: "پنج‌شنبه و جمعه", days: [4, 5], open: "09:00", close: "24:00" },
  ],
};
const at = (iso) => Date.parse(iso);

test("OPENING_HOURS واقعی: هر روز هفته دقیقاً تو یک ردیفه و close بعد از open میاد", () => {
  const days = OPENING_HOURS.schedule.flatMap((s) => s.days).sort((a, b) => a - b);
  assert.deepEqual(days, [0, 1, 2, 3, 4, 5, 6]);
  for (const s of OPENING_HOURS.schedule) {
    assert.ok(toMinutes(s.open) < toMinutes(s.close), `${s.label}: close باید بعد از open باشه`);
    assert.ok(toMinutes(s.close) <= 24 * 60, `${s.label}: close نباید از ۲۴:۰۰ بیشتر باشه`);
  }
});

test("buildOpeningHoursSpecification: خروجی استاندارد schema.org تولید می‌کند و 24:00 را به 23:59 تبدیل می‌کند", () => {
  const spec = buildOpeningHoursSpecification(HOURS);
  assert.equal(spec.length, 2);
  assert.deepEqual(spec[0], {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"],
    opens: "08:00",
    closes: "23:00",
  });
  assert.deepEqual(spec[1], {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Thursday", "Friday"],
    opens: "09:00",
    closes: "23:59",
  });
});

test("tehranDayAndMinutes: روز و دقیقه رو به وقت تهران حساب می‌کنه (حتی وقتی تاریخ UTC فرق داره)", () => {
  // ۲۱:۰۰ UTC سه‌شنبه ۱۳ اکتبر = ۰۰:۳۰ چهارشنبه ۱۴ اکتبر تهران
  assert.deepEqual(tehranDayAndMinutes(at("2026-10-13T21:00:00Z")), { day: 3, minutes: 30 });
});

test("getOpenStatus: مرز باز و بسته شدن شنبه تا چهارشنبه (close حساب نمیشه)", () => {
  assert.equal(getOpenStatus(HOURS, at("2026-10-14T04:29:00Z")).open, false); // ۰۷:۵۹ تهران
  assert.equal(getOpenStatus(HOURS, at("2026-10-14T04:30:00Z")).open, true); // ۰۸:۰۰
  assert.equal(getOpenStatus(HOURS, at("2026-10-14T19:29:00Z")).open, true); // ۲۲:۵۹
  assert.equal(getOpenStatus(HOURS, at("2026-10-14T19:30:00Z")).open, false); // ۲۳:۰۰
});

test("getOpenStatus: پنج‌شنبه و جمعه ساعت متفاوت دارن و close=24:00 تا نیمه‌شب باز می‌مونه", () => {
  assert.equal(getOpenStatus(HOURS, at("2026-10-15T05:00:00Z")).open, false); // پنج‌شنبه ۰۸:۳۰
  assert.equal(getOpenStatus(HOURS, at("2026-10-15T05:30:00Z")).open, true); // ۰۹:۰۰
  assert.equal(getOpenStatus(HOURS, at("2026-10-15T20:00:00Z")).open, true); // پنج‌شنبه ۲۳:۳۰
  assert.equal(getOpenStatus(HOURS, at("2026-10-15T20:30:00Z")).open, false); // جمعه ۰۰:۰۰
});

test("nextOpening: قبل از باز شدن «امروز»، بعد از بسته شدن «فردا» با ساعت باز شدن فردا", () => {
  assert.deepEqual(nextOpening(HOURS, at("2026-10-13T23:30:00Z")), { when: "امروز", time: "08:00" }); // چهارشنبه ۰۳:۰۰
  assert.deepEqual(nextOpening(HOURS, at("2026-10-14T20:00:00Z")), { when: "فردا", time: "09:00" }); // چهارشنبه ۲۳:۳۰ ← پنج‌شنبه
});
