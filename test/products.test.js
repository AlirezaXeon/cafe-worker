import { test } from "node:test";
import assert from "node:assert/strict";
import { imageFilename } from "../src/data/imagePaths.js";

test("imageFilename extracts file name from path and trims whitespace", () => {
  assert.equal(imageFilename("images/products/coffee.jpg"), "coffee.jpg");
  assert.equal(imageFilename("/images/thumb/cake.webp"), "cake.webp");
  assert.equal(imageFilename("site-logo-123.png"), "site-logo-123.png");
  assert.equal(imageFilename("  images/cover.jpg  "), "cover.jpg");
});

test("imageFilename returns empty string for falsy or non-string inputs", () => {
  assert.equal(imageFilename(null), "");
  assert.equal(imageFilename(undefined), "");
  assert.equal(imageFilename(""), "");
  assert.equal(imageFilename(123), "");
});
