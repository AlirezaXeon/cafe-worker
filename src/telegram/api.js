import { validateImage, ALLOWED_IMAGE_EXTS } from "../lib/images.js";
import { MAX_UPLOAD_BYTES } from "../config.js";

// ---------- ارتباط خام با API تلگرام ----------

export async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ---------- تمیز نگه داشتن چت (پاک کردن پیام‌های قبلی) ----------
export async function deleteMessageSafe(env, chatId, messageId) {
  if (!messageId) return;
  try {
    await tg(env, "deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch {
    // پیام قدیمی‌تر از ۴۸ ساعت یا از قبل حذف‌شده
  }
}

async function sendAndTrack(env, chatId, payload) {
  const [prevId, res] = await Promise.all([
    env.PRODUCTS_KV.get(`botmsg:${chatId}`),
    tg(env, "sendMessage", payload),
  ]);
  await Promise.all([
    prevId ? deleteMessageSafe(env, chatId, Number(prevId)) : Promise.resolve(),
    res.ok && res.result?.message_id
      ? env.PRODUCTS_KV.put(`botmsg:${chatId}`, String(res.result.message_id))
      : Promise.resolve(),
  ]);
  return res;
}

export async function downloadTelegramFile(env, fileId) {
  const fileRes = await tg(env, "getFile", { file_id: fileId });
  if (!fileRes.ok || !fileRes.result?.file_path) {
    return { error: "خطا در دریافت مشخصات فایل از تلگرام" };
  }
  const { file_path: filePath, file_size: fileSize } = fileRes.result;
  const ext = (filePath.split('.').pop() || "").toLowerCase();

  if (!ALLOWED_IMAGE_EXTS.has(ext)) {
    return { error: "فرمت فایل مجاز نیست (فقط jpg, png, webp, gif)" };
  }

  if (fileSize && fileSize > MAX_UPLOAD_BYTES) {
    return { error: `حجم عکس (${(fileSize / (1024 * 1024)).toFixed(1)} مگابایت) بیشتر از سقف مجاز (۲ مگابایت) است` };
  }

  const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const imgRes = await fetch(downloadUrl);
  if (!imgRes.ok) return { error: "خطا در دانلود فایل از سرور تلگرام" };

  const buffer = await imgRes.arrayBuffer();
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return { error: `حجم عکس (${(buffer.byteLength / (1024 * 1024)).toFixed(1)} مگابایت) بیشتر از سقف مجاز (۲ مگابایت) است` };
  }

  const validation = validateImage(buffer, ext);
  if (!validation.valid) {
    return { error: validation.error };
  }

  return { buffer, ext };
}

export async function pinMessage(env, chatId, messageId) {
  try {
    await tg(env, "pinChatMessage", { chat_id: chatId, message_id: messageId, disable_notification: true });
  } catch { }
}

export const sendRaw = (env, payload) => tg(env, "sendMessage", payload);

// برای ویرایش پیام‌های سفارش بعد از تایید/رد؛ کیبورد رو صریح [] بده تا دکمه‌ها حذف بشن
export const editMessageText = (env, chatId, messageId, text, keyboard) =>
  tg(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });

export const getAdminIds = (env) =>
  (env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

export const sendMessage = (env, chatId, text, keyboard) =>
  sendAndTrack(env, chatId, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });

export const MAIN_PANEL_BUTTONS = [
  ["📦 محصولات", "🏷 دسته‌بندی‌ها"],
  ["💰 تغییر قیمت دسته‌جمعی", "🖼 تصاویر سایت"],
];

const mainPanelKeyboard = () => ({
  keyboard: MAIN_PANEL_BUTTONS,
  resize_keyboard: true,
  is_persistent: false,
});

export const sendMessageWithPanel = (env, chatId, text) =>
  sendAndTrack(env, chatId, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: mainPanelKeyboard(),
  });

// ── forceReply تغییر کرد ──────────────────────────────────────────────────
// قبلاً از force_reply استفاده می‌کرد که روی موبایل کیبورد اصلی رو پنهان
// می‌کرد و کاربر راهی برای لغو نداشت. الان یه دکمه «🔙 بازگشت به منو»
// زیر هر سوال نشون میده که هر وقت خواست بتونه انصراف بده.
export const forceReply = (env, chatId, text) =>
  sendAndTrack(env, chatId, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 بازگشت به منو", callback_data: "cancel" }]],
    },
  });

export const answerCallback = (env, id, text) =>
  tg(env, "answerCallbackQuery", { callback_query_id: id, text, show_alert: false }); 