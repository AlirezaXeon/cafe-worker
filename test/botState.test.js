import { test } from "node:test";
import assert from "node:assert/strict";
import { getBotState, setBotState, deleteBotState, deleteExpiredBotState, cleanupExpiredBotState } from "../src/data/botState.js";
import { getSession, setSession, clearSession } from "../src/data/session.js";

function makeEnv() {
  const rows = new Map();
  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => {
            if (/SELECT value, expires_at FROM bot_state/.test(sql)) {
              const r = rows.get(args[0]);
              return r ? { ...r } : null;
            }
            return null;
          },
          run: async () => {
            if (/INSERT OR REPLACE INTO bot_state/.test(sql)) {
              const [key, value, expires_at] = args;
              rows.set(key, { value, expires_at });
            } else if (/DELETE FROM bot_state WHERE expires_at IS NOT NULL AND expires_at < \?/.test(sql)) {
              const cutoff = args[0];
              let deleted = 0;
              for (const [k, v] of rows.entries()) {
                if (v.expires_at != null && v.expires_at < cutoff) {
                  rows.delete(k);
                  deleted++;
                }
              }
              return { meta: { changes: deleted } };
            } else if (/DELETE FROM bot_state/.test(sql)) {
              rows.delete(args[0]);
            }
            return { meta: { changes: 1 } };
          },
        }),
      }),
    },
  };
  return { env, rows };
}

test("botState: set/get/delete roundtrip، مقدار همیشه رشته برمی‌گرده", async () => {
  const { env } = makeEnv();
  assert.equal(await getBotState(env, "botmsg:1"), null);
  await setBotState(env, "botmsg:1", 12345);
  assert.equal(await getBotState(env, "botmsg:1"), "12345");
  await deleteBotState(env, "botmsg:1");
  assert.equal(await getBotState(env, "botmsg:1"), null);
});

test("botState: بعد از انقضای TTL مقدار null برمی‌گرده", async () => {
  const { env } = makeEnv();
  await setBotState(env, "k", "v", 600);
  assert.equal(await getBotState(env, "k", Date.now()), "v");
  assert.equal(await getBotState(env, "k", Date.now() + 601 * 1000), null);
});

test("deleteExpiredBotState: ردیف‌های منقضی را حذف می‌کند و ردیف‌های زنده را نگه می‌دارد", async () => {
  const { env, rows } = makeEnv();
  const now = 1000000;
  rows.set("k1", { value: "v1", expires_at: now - 500 });
  rows.set("k2", { value: "v2", expires_at: now + 500 });
  rows.set("k3", { value: "v3", expires_at: null });

  const res = await deleteExpiredBotState(env, now);
  assert.equal(res.meta.changes, 1);
  assert.equal(rows.has("k1"), false);
  assert.equal(rows.has("k2"), true);
  assert.equal(rows.has("k3"), true);
});

test("cleanupExpiredBotState: بین دو اجرا حداقل ۱۰ دقیقه فاصله می‌اندازد", async () => {
  const { env, rows } = makeEnv();
  const now = 2000000;
  rows.set("old", { value: "x", expires_at: now - 100 });

  const run1 = await cleanupExpiredBotState(env, now);
  assert.equal(run1.skipped, false);
  assert.equal(rows.has("old"), false);

  rows.set("old2", { value: "y", expires_at: now + 1000 });
  const run2 = await cleanupExpiredBotState(env, now + 60 * 1000);
  assert.equal(run2.skipped, true);
  assert.equal(rows.has("old2"), true);

  const run3 = await cleanupExpiredBotState(env, now + 11 * 60 * 1000);
  assert.equal(run3.skipped, false);
});

test("session: ذخیره، خوندن و پاک کردن", async () => {
  const { env } = makeEnv();
  assert.equal(await getSession(env, 7), null);
  await setSession(env, 7, { step: "edit_price", productId: "p1" });
  assert.deepEqual(await getSession(env, 7), { step: "edit_price", productId: "p1" });
  await clearSession(env, 7);
  assert.equal(await getSession(env, 7), null);
});

test("session: JSON خراب باعث خطا نمیشه و null برمی‌گردونه", async () => {
  const { env, rows } = makeEnv();
  rows.set("session:9", { value: "{broken", expires_at: null });
  assert.equal(await getSession(env, 9), null);
});

