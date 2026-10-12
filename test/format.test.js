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

test("error message containing a product name like 'A<b>&C' is escaped in the outgoing text", () => {
  const err = new Error("قیمت محصول A<b>&C تغییر کرده است");
  const outgoing = `⚠️ خطا: ${escapeHtml(err.message)}`;
  assert.equal(outgoing, "⚠️ خطا: قیمت محصول A&lt;b&gt;&amp;C تغییر کرده است");
  assert.equal(outgoing.includes("<b>"), false);
  assert.equal(outgoing.includes("&lt;b&gt;"), true);
});

