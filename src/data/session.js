// نگهداری موقت وضعیت مکالمه‌ی هر ادمین (برای مراحل چندقسمتی مثل «اسم محصول رو بفرست»)
// روی D1 (جدول bot_state) نگه داشته میشه تا سهمیه‌ی write پلن رایگان KV رو مصرف نکنه
import { getBotState, setBotState, deleteBotState } from "./botState.js";

const TTL_SECONDS = 600; // ۱۰ دقیقه؛ بعدش منقضی میشه

export async function getSession(env, chatId) {
  const raw = await getBotState(env, `session:${chatId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setSession(env, chatId, data) {
  await setBotState(env, `session:${chatId}`, JSON.stringify(data), TTL_SECONDS);
}

export async function clearSession(env, chatId) {
  await deleteBotState(env, `session:${chatId}`);
}
