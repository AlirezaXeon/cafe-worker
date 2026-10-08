import { test } from "node:test";
import assert from "node:assert/strict";
import { findOrphanImageKeys, deleteOrphanImages } from "../src/data/maintenance.js";

function makeEnv(images, usedImages = { categories: [], products: [], siteCfg: {} }) {
  const kv = new Map(images.map((img) => [img.name, img]));
  const deletedKeys = [];

  const env = {
    PRODUCTS_KV: {
      get: async (k) => {
        if (k === "site:config") return JSON.stringify(usedImages.siteCfg || {});
        return null;
      },
      list: async ({ prefix }) => {
        const keys = Array.from(kv.values()).filter((k) => k.name.startsWith(prefix));
        return { keys, list_complete: true };
      },
      delete: async (key) => {
        deletedKeys.push(key);
        kv.delete(key);
      },
    },
    DB: {
      prepare: (sql) => {
        const stmt = {
          all: async () => {
            if (/SELECT.*FROM categories/.test(sql)) {
              return { results: usedImages.categories || [] };
            }
            if (/SELECT.*FROM products/.test(sql)) {
              return { results: usedImages.products || [] };
            }
            return { results: [] };
          },
          first: async () => null,
          run: async () => ({ meta: { changes: 0 } }),
          bind: () => stmt,
        };
        return stmt;
      },
    },
  };
  return { env, deletedKeys, remaining: () => Array.from(kv.keys()) };
}

test("findOrphanImageKeys skips young orphans (<24h) and catches old or un-metadated orphans", async () => {
  const now = 1_700_000_000_000;
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  const images = [
    // 1. عکسی که در محصول استفاده شده (هرگز یتیم نیست)
    { name: "image:used_espresso.jpg", metadata: { uploadedAt: now - 2 * oneDay } },
    // 2. عکس یتیم تازه (۱ ساعت پیش آپلود شده - کاربر هنوز فرم ذخیره را نزده)
    { name: "image:young_in_flight.jpg", metadata: { uploadedAt: now - 1 * oneHour } },
    // 3. عکس یتیم قدیمی (۲۵ ساعت پیش آپلود شده و در هیچ محصولی نیست)
    { name: "image:old_abandoned.jpg", metadata: { uploadedAt: now - 25 * oneHour } },
    // 4. عکس یتیم بدون متادیتا (قدیمی فرض می‌شود)
    { name: "image:legacy_no_meta.jpg" },
  ];

  const used = {
    categories: [],
    products: [{ id: "p1", image: "/images/used_espresso.jpg" }],
    siteCfg: { logo: null, cover: null },
  };

  const { env } = makeEnv(images, used);
  const orphans = await findOrphanImageKeys(env, now);

  assert.deepEqual(orphans.sort(), [
    "image:legacy_no_meta.jpg",
    "image:old_abandoned.jpg",
  ]);
  assert.ok(!orphans.includes("image:young_in_flight.jpg"), "عکس آپلود شده‌ی کمتر از ۲۴ ساعت نباید حذف شود");
  assert.ok(!orphans.includes("image:used_espresso.jpg"), "عکس در حال استفاده نباید حذف شود");
});

test("deleteOrphanImages deletes only detected orphans and keeps young and used images", async () => {
  const now = 1_700_000_000_000;
  const oneHour = 60 * 60 * 1000;

  const images = [
    { name: "image:used.jpg", metadata: { uploadedAt: now - 100 * oneHour } },
    { name: "image:young_orphan.jpg", metadata: { uploadedAt: now - 2 * oneHour } },
    { name: "image:old_orphan.jpg", metadata: { uploadedAt: now - 48 * oneHour } },
  ];

  const used = {
    categories: [],
    products: [{ id: "p1", image: "/images/used.jpg" }],
    siteCfg: {},
  };

  const { env, deletedKeys, remaining } = makeEnv(images, used);
  // جایگزینی موقت Date.now برای deleteOrphanImages
  const origNow = Date.now;
  try {
    Date.now = () => now;
    const count = await deleteOrphanImages(env);
    assert.equal(count, 1);
    assert.deepEqual(deletedKeys, ["image:old_orphan.jpg"]);
    assert.deepEqual(remaining().sort(), ["image:used.jpg", "image:young_orphan.jpg"]);
  } finally {
    Date.now = origNow;
  }
});
