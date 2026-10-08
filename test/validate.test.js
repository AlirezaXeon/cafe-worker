import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePrice, validatePercent, validateDiscount } from "../src/lib/validate.js";
import { roundPrice, resolvePrice, previewCategoryPercent, applyCategoryPercent } from "../src/data/products.js";
import { MIN_PRICE, MAX_PRICE, MIN_PERCENT, MAX_PERCENT } from "../src/config.js";

test("validatePrice: 400 rejected, 1e3 rejected, boundary values", () => {
  // 400 rejected (< MIN_PRICE)
  const r400 = validatePrice(400);
  assert.equal(r400.valid, false);
  assert.ok(r400.error.includes("حداقل قیمت"));

  // 1e3 rejected (علمی)
  const r1e3 = validatePrice("1e3");
  assert.equal(r1e3.valid, false);

  // منفی و صفر
  assert.equal(validatePrice(0).valid, false);
  assert.equal(validatePrice(-1000).valid, false);

  // مقادیر مرزی
  const minRes = validatePrice(MIN_PRICE);
  assert.equal(minRes.valid, true);
  assert.equal(minRes.price, MIN_PRICE);

  const maxRes = validatePrice(MAX_PRICE);
  assert.equal(maxRes.valid, true);
  assert.equal(maxRes.price, MAX_PRICE);

  const overMax = validatePrice(MAX_PRICE + 1);
  assert.equal(overMax.valid, false);
});

test("validatePercent: -95 rejected, 1e3 rejected, boundary values", () => {
  // 1e3 rejected
  assert.equal(validatePercent("1e3").valid, false);

  // -95 rejected (< MIN_PERCENT -90)
  const rMinus95 = validatePercent(-95);
  assert.equal(rMinus95.valid, false);
  assert.ok(rMinus95.error.includes("-90"));

  // 350 rejected (> MAX_PERCENT 300)
  assert.equal(validatePercent(350).valid, false);

  // مقادیر مرزی
  const minPercentRes = validatePercent(MIN_PERCENT);
  assert.equal(minPercentRes.valid, true);
  assert.equal(minPercentRes.percent, MIN_PERCENT);

  const maxPercentRes = validatePercent(MAX_PERCENT);
  assert.equal(maxPercentRes.valid, true);
  assert.equal(maxPercentRes.percent, MAX_PERCENT);

  // فرمت فارسی و علامت درصد
  assert.equal(validatePercent("20%").valid, true);
  assert.equal(validatePercent("20٪").valid, true);
});

test("validateDiscount: 0 to 99", () => {
  assert.equal(validateDiscount(0).valid, true);
  assert.equal(validateDiscount(50).valid, true);
  assert.equal(validateDiscount(99).valid, true);
  assert.equal(validateDiscount(100).valid, false);
  assert.equal(validateDiscount(-5).valid, false);
  assert.equal(validateDiscount("1e3").valid, false);
});

test("roundPrice never rounds positive price to 0 or below MIN_PRICE", () => {
  // قبلاً roundPrice(400) مساوی 0 می‌شد
  assert.equal(roundPrice(400), MIN_PRICE);
  assert.equal(roundPrice(100), MIN_PRICE);
  assert.equal(roundPrice(0), 0);
  assert.equal(roundPrice(123456), 123000);
});

test("resolvePrice respects MIN_PRICE boundary and handles discount rounding", () => {
  // تخفیف ۵۰٪ روی محصول ۲۰۰۰ تومانی -> ۱۰۰۰ تومان (حداقل قیمت)
  const r1 = resolvePrice(2000, 50);
  assert.equal(r1.price, 1000);
  assert.equal(r1.originalPrice, 2000);

  // تخفیف ۹۰٪ روی محصول ۲۰۰۰ تومانی -> ۲۰۰ تومان می‌شد ولی به MIN_PRICE محدود می‌شود
  const r2 = resolvePrice(2000, 90);
  assert.equal(r2.price, MIN_PRICE);
  assert.equal(r2.originalPrice, 2000);
});

test("previewCategoryPercent computes on originalPrice (does not compound on existing discount)", async () => {
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              // محصولی که در حال حاضر تخفیف دارد (قیمت ۸۰ هزار، قیمت اصلی ۱۰۰ هزار)
              { id: "p1", name: "قهوه", price: 80000, originalPrice: 100000 },
            ],
          }),
        }),
      }),
    },
  };

  // اعمال +20% افزایش قیمت
  const preview = await previewCategoryPercent(env, "c1", 20);
  assert.equal(preview.length, 1);
  // باید روی ۱۰۰ هزار اعمال شود نه روی ۸۰ هزار تخفیف‌خورده: 100,000 * 1.2 = 120,000
  assert.equal(preview[0].newPrice, 120000);
});

test("applyCategoryPercent rejects if prices changed between preview and confirmation", async () => {
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              { id: "p1", name: "قهوه", price: 90000, originalPrice: null }, // قیمت تغییر کرده (۹۰ به جای ۸۰)
            ],
          }),
        }),
      }),
    },
  };

  const previewedItems = [{ id: "p1", oldPrice: 80000, newPrice: 100000 }];
  await assert.rejects(
    async () => {
      await applyCategoryPercent(env, "c1", 20, previewedItems);
    },
    /تغییر کرده/
  );
});
