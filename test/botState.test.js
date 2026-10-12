import { test } from "node:test";
import assert from "node:assert/strict";
import { getBotState, setBotState, deleteBotState } from "../src/data/botState.js";
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
