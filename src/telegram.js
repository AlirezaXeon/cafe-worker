import { getSession, clearSession } from "./data/session.js";
import { deleteMessageSafe, answerCallback, getAdminIds } from "./telegram/api.js";
import { sendMainMenu, sendCategoryPicker, sendCategoriesMenu, sendSiteImagesMenu } from "./telegram/menus.js";
import { handleCallback } from "./telegram/callbacks.js";
import { handleTextStep } from "./telegram/steps.js";
import { handleImageStep } from "./telegram/images.js";

// ---------- ورودی اصلی ----------

export async function handleUpdate(update, env) {
  const adminIds = getAdminIds(env);

  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const fromId = String(msg.from.id);
    if (!adminIds.includes(fromId)) return;

    await deleteMessageSafe(env, chatId, msg.message_id);

    if (msg.text === "/start") {
      await clearSession(env, chatId);
      return sendMainMenu(env, chatId);
    }

    // ── دکمه‌های کیبورد اصلی (پاک کردن سشن و رفتن به منو) ────────────
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

    // ── لغو متنی — کاربر می‌تونه در هر مرحله‌ای تایپ کنه تا انصراف بده ──
    // این برای مواردیه که کاربر روی موبایل بک زده و کیبورد اصلی برگشته
    // ولی سشن هنوز فعاله؛ با فشردن هر دکمه‌ی کیبورد اصلی سشن پاک میشه
    const cancelTexts = ["لغو", "بازگشت", "❌", "❌ لغو", "/cancel", "cancel"];
    if (msg.text && cancelTexts.includes(msg.text.trim())) {
      await clearSession(env, chatId);
      return sendMainMenu(env, chatId);
    }

    const session = await getSession(env, chatId);
    if (session) {
      const waitingForPhoto = [
        "new_product_image", "new_category_image", "edit_category_image",
        "edit_product_image", "edit_site_logo", "edit_site_cover"
      ];
      const isImageDocument = msg.document && msg.document.mime_type && msg.document.mime_type.startsWith("image/");
      if ((msg.photo || isImageDocument) && waitingForPhoto.includes(session.step)) {
        return handleImageStep(env, chatId, msg, session);
      }
      if (msg.text) return handleTextStep(env, chatId, msg.text, session);
    }

    return sendMainMenu(env, chatId);
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const fromId = String(cq.from.id);
    if (!adminIds.includes(fromId)) return answerCallback(env, cq.id, "دسترسی نداری");
    const [, result] = await Promise.all([answerCallback(env, cq.id), handleCallback(env, chatId, cq.data, cq)]);
    return result;
  }
}