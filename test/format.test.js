import { test } from "node:test";
import assert from "node:assert/strict";
import { toFa, formatToman, escapeHtml } from "../src/telegram/format.js";

test("toFa converts western digits to Persian digits", () => {
  assert.equal(toFa("2024"), "۲۰۲۴");
});

test("formatToman adds thousand separators and the toman suffix, in Persian digits", () => {
  assert.equal(formatToman(150000), "۱۵۰,۰۰۰ تومان");
  assert.equal(formatToman(1000), "۱,۰۰۰ تومان");
});

test("escapeHtml escapes the basic dangerous characters", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(\"x\")&lt;/script&gt;");
});
