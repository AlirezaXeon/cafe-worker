import { test } from "node:test";
import assert from "node:assert/strict";
import { memo, clearMemo, invalidateCache } from "../src/data/cache.js";

test("memo caches result within TTL and re-fetches when expired", async () => {
  clearMemo();
  let fetchCount = 0;
  const fetcher = async () => {
    fetchCount++;
    return { count: fetchCount };
  };

  // ۱. بار اول فراخوانی fetcher
  const r1 = await memo("test:key", fetcher, 50); // 50ms TTL
  assert.equal(r1.count, 1);
  assert.equal(fetchCount, 1);

  // ۲. بار دوم قبل از انقضا: از کش حافظه خوانده می‌شود
  const r2 = await memo("test:key", fetcher, 50);
  assert.equal(r2.count, 1);
  assert.equal(fetchCount, 1);

  // ۳. پس از انقضا (بیش از ۵۰ میلی‌ثانیه): دوباره fetcher فراخوانی می‌شود
  await new Promise((resolve) => setTimeout(resolve, 60));
  const r3 = await memo("test:key", fetcher, 50);
  assert.equal(r3.count, 2);
  assert.equal(fetchCount, 2);
});

test("clearMemo and invalidateCache immediately bust memory cache", async () => {
  clearMemo();
  let fetchCount = 0;
  const fetcher = async () => {
    fetchCount++;
    return { data: `v${fetchCount}` };
  };

  const r1 = await memo("test:bust", fetcher, 10000);
  assert.equal(r1.data, "v1");
  assert.equal(fetchCount, 1);

  // پاک کردن کش با clearMemo
  clearMemo("test:bust");

  // بلافاصله درخواست بعدی باید داده‌ی تازه دریافت کند
  const r2 = await memo("test:bust", fetcher, 10000);
  assert.equal(r2.data, "v2");
  assert.equal(fetchCount, 2);

  // پاک کردن با invalidateCache
  await invalidateCache(null, "test:bust");
  const r3 = await memo("test:bust", fetcher, 10000);
  assert.equal(r3.data, "v3");
  assert.equal(fetchCount, 3);
});

test("memo does not cache rejected promises on fetch error", async () => {
  clearMemo();
  let attempts = 0;
  const failingFetcher = async () => {
    attempts++;
    if (attempts === 1) throw new Error("شبکه قطع است");
    return "موفق";
  };

  await assert.rejects(async () => {
    await memo("test:fail", failingFetcher, 10000);
  }, /شبکه قطع است/);

  // درخواست بعدی نباید خطای قبلی را کش کرده باشد
  const success = await memo("test:fail", failingFetcher, 10000);
  assert.equal(success, "موفق");
  assert.equal(attempts, 2);
});
