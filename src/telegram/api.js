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
// چون کیبورد پنل هربار یه پیام جدید می‌سازه، بدون این کار چت خیلی زود شلوغ می‌شد.
// اینجا فقط همیشه آخرین پیام ربات رو نگه می‌داریم و قبل از فرستادن پیام جدید، قبلی رو پاک می‌کنیم.
export async function deleteMessageSafe(env, chatId, messageId) {
  if (!messageId) return;
  try {
    await tg(env, "deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch {
    // پیام قدیمی‌تر از ۴۸ ساعت یا از قبل حذف‌شده؛ مهم نیست، نادیده می‌گیریم
  }
}

async function sendAndTrack(env, chatId, payload) {
  // خوندن آی‌دی پیام قبلی و فرستادن پیام جدید به‌هم وابسته نیستن، پس هم‌زمان انجامشون می‌دیم
  const [prevId, res] = await Promise.all([
    env.PRODUCTS_KV.get(`botmsg:${chatId}`),
    tg(env, "sendMessage", payload),
  ]);
  // حذف پیام قبلی و ذخیره‌ی آی‌دی پیام جدید هم به‌هم وابسته نیستن؛ این‌ها هم موازی
  await Promise.all([
    prevId ? deleteMessageSafe(env, chatId, Number(prevId)) : Promise.resolve(),
    res.ok && res.result?.message_id
      ? env.PRODUCTS_KV.put(`botmsg:${chatId}`, String(res.result.message_id))
      : Promise.resolve(),
  ]);
  return res;
}

// دانلود فایل عکس از سرورهای تلگرام
export async function downloadTelegramFile(env, fileId) {
  // ۱. گرفتن مسیر فایل از تلگرام
  const fileRes = await tg(env, "getFile", { file_id: fileId });
  if (!fileRes.ok || !fileRes.result?.file_path) return null;

  // ۲. دانلود خود فایل باینری (عکس)
  const filePath = fileRes.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const imgRes = await fetch(downloadUrl);
  if (!imgRes.ok) return null;

  return {
    buffer: await imgRes.arrayBuffer(),
    ext: filePath.split('.').pop() // پسوند فایل (مثلا jpg یا webp)
  };
}

export const sendMessage = (env, chatId, text, keyboard) =>
  sendAndTrack(env, chatId, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });

// برچسب‌های دکمه‌های پنل اصلی؛ چون این دکمه‌ها روی خود کیبورد تلگرام میشینن (نه زیر پیام)،
// همیشه بالای صفحه‌ی تایپ در دسترسن، حتی وقتی چند تا پیام قبلی رو اسکرول کردی بره بالا.
export const MAIN_PANEL_BUTTONS = [
  ["📦 محصولات", "🏷 دسته‌بندی‌ها"],
  ["💰 تغییر قیمت دسته‌جمعی", "🖼 تصاویر سایت"],
];

const mainPanelKeyboard = () => ({
  keyboard: MAIN_PANEL_BUTTONS,
  resize_keyboard: true,
  is_persistent: true,
});

// نسخه‌ی sendMessage که به‌جای دکمه‌ی زیر پیام، همون کیبورد ثابت پنل رو ضمیمه می‌کنه
export const sendMessageWithPanel = (env, chatId, text) =>
  sendAndTrack(env, chatId, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: mainPanelKeyboard(),
  });

export const forceReply = (env, chatId, text) =>
  sendAndTrack(env, chatId, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { force_reply: true },
  });

export const answerCallback = (env, id, text) =>
  tg(env, "answerCallbackQuery", { callback_query_id: id, text, show_alert: false });
