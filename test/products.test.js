import { test } from "node:test";
import assert from "node:assert/strict";
import { roundPrice, resolvePrice } from "../src/data/products.js";

test("roundPrice rounds to nearest 1000 toman", () => {
  assert.equal(roundPrice(123456), 123000);
  assert.equal(roundPrice(123500), 124000);
  assert.equal(roundPrice(1000), 1000);
});

test("resolvePrice with no discount returns the base price, no originalPrice", () => {
  const r = resolvePrice(150000, 0);
  assert.equal(r.price, 150000);
  assert.equal(r.originalPrice, null);
});

test("resolvePrice with a discount keeps the base price as originalPrice", () => {
  const r = resolvePrice(200000, 20);
  assert.equal(r.originalPrice, 200000);
  assert.equal(r.price, roundPrice(200000 * 0.8));
});

test("resolvePrice treats out-of-range discount (>=100) as no discount", () => {
  const r = resolvePrice(100000, 100);
  assert.equal(r.originalPrice, null);
  assert.equal(r.price, 100000);
});
