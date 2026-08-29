import { getSession, clearSession } from "./data/session.js";
import { deleteMessageSafe, answerCallback } from "./telegram/api.js";
import { sendMainMenu, sendCategoryPicker, sendCategoriesMenu, sendSiteImagesMenu } from "./telegram/menus.js";
import { handleCallback } from "./telegram/callbacks.js";
import { handleTextStep } from "./telegram/steps.js";
import { handleImageStep } from "./telegram/images.js";

// ---------- ورودی اصلی ----------

export async function handleUpdate(update, env) {
  const adminIds = (env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const fromId = String(msg.from.id);
    if (!adminIds.includes(fromId)) return; // کاربر غیرمجاز؛ نادیده گرفته میشه

    // پیام خود ادمین رو هم پاک می‌کنیم (چه فشردن دکمه‌ی کیبورد، چه تایپ متن) تا چت شلوغ نشه.
    // چون قبلش از msg خودمون کپی همه‌چیز (متن/عکس/فایل) رو داریم، حذف پیام تأثیری رو پردازش نداره.
    await deleteMessageSafe(env, chatId, msg.message_id);

    if (msg.text === "/start") {
      await clearSession(env, chatId);
      return sendMainMenu(env, chatId);
    }

    // دکمه‌های خود کیبورد (نه زیر پیام) به‌صورت متن ساده میان؛ چون این‌ها همیشه در دسترسن،
    // با فشردنشون هر مرحله‌ی نیمه‌کاره‌ای (منتظر عکس/متن) رو کنار می‌ذاریم و می‌ریم سراغ همون بخش.
    if (msg.text === "📦 محصولات") {
      await clearSession(env, chatId);
      return sendCategoryPicker(env, chatId, "browse");
    }
    if (msg.text === "🏷 دسته‌بندی‌ها") {
      await clearSession(env, chatId);
      return sendCategoriesMenu(env, chatId);
    }
    if (msg.text === "💰 تغییر قیمت دسته‌جمعی") {
      await clearSession(env, chatId);
      return sendCategoryPicker(env, chatId, "bulk");
    }
    if (msg.text === "🖼 تصاویر سایت") {
      await clearSession(env, chatId);
      return sendSiteImagesMenu(env, chatId);
    }

    const session = await getSession(env, chatId);
    if (session) {
      // اگر منتظر عکس بودیم و کاربر عکس فرستاد (چه فشرده/photo، چه فایل خام/document)
      const waitingForPhoto = ["new_product_image", "new_category_image", "edit_category_image", "edit_product_image", "edit_site_logo", "edit_site_cover"];
      const isImageDocument = msg.document && msg.document.mime_type && msg.document.mime_type.startsWith("image/");
      if ((msg.photo || isImageDocument) && waitingForPhoto.includes(session.step)) {
        return handleImageStep(env, chatId, msg, session);
      }
      // اگر متن فرستاد
      if (msg.text) return handleTextStep(env, chatId, msg.text, session);
    }

    return sendMainMenu(env, chatId);
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const fromId = String(cq.from.id);
    if (!adminIds.includes(fromId)) return answerCallback(env, cq.id, "دسترسی نداری");
    // خاموش کردن اسپینر دکمه (answerCallback) به نتیجه‌ی handleCallback نیازی نداره، پس هم‌زمان اجراشون می‌کنیم
    const [, result] = await Promise.all([answerCallback(env, cq.id), handleCallback(env, chatId, cq.data)]);
    return result;
  }
}
