import {
  previewCategoryPercent,
  setProductPrice,
  setProductDiscount,
  addProduct,
  addCategory,
  nextProductId,
} from "../data/products.js";
import { setSession, clearSession } from "../data/session.js";
import { sendMessage, forceReply } from "./api.js";
import { toFa, formatToman, escapeHtml } from "./format.js";
import { sendMainMenu, sendCategoriesMenu, sendProductDetail, sendProductList } from "./menus.js";

// ---------- پیام‌های متنی در میانه‌ی یه مرحله ----------

export async function handleTextStep(env, chatId, text, session) {
  const trimmed = (text || "").trim();

  if (session.step === "bulk_percent") {
    const percent = parseFloat(trimmed.replace(/[٪%]/g, ""));
    if (isNaN(percent) || percent === 0) {
      return forceReply(env, chatId, "یه عدد معتبر بفرست (مثلاً 20 یا -10):");
    }
    const preview = await previewCategoryPercent(env, session.catId, percent);
    if (preview.length === 0) {
      await clearSession(env, chatId);
      return sendMessage(env, chatId, "این دسته محصولی نداره.");
    }
    const lines = preview
      .map((p) => `• ${escapeHtml(p.name)}: ${formatToman(p.oldPrice)} ← ${formatToman(p.newPrice)}`)
      .join("\n");
    await setSession(env, chatId, { step: "bulk_confirm", catId: session.catId, percent });
    return sendMessage(env, chatId, `پیش‌نمایش تغییر قیمت (${toFa(percent)}٪):\n\n${lines}\n\nتایید می‌کنی؟`, [
      [{ text: "✅ تایید و اعمال", callback_data: "bulkconfirm" }],
      [{ text: "❌ لغو", callback_data: "bulkcancel" }],
    ]);
  }

  if (session.step === "edit_price") {
    const price = parseInt(trimmed.replace(/[^\d]/g, ""), 10);
    if (!price) return forceReply(env, chatId, "یه عدد معتبر برای قیمت بفرست:");
    await setProductPrice(env, session.productId, price);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ قیمت به‌روزرسانی شد.");
    return sendProductDetail(env, chatId, session.productId);
  }

  if (session.step === "discount_percent") {
    const percent = parseFloat(trimmed.replace(/[٪%]/g, ""));
    if (isNaN(percent) || percent <= 0 || percent >= 100) {
      return forceReply(env, chatId, "درصد باید بین ۱ تا ۹۹ باشه:");
    }
    await setProductDiscount(env, session.productId, percent);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ تخفیف اعمال شد.");
    return sendProductDetail(env, chatId, session.productId);
  }

  if (session.step === "new_category_id") {
    const id = trimmed.toLowerCase().replace(/\s+/g, "-");
    if (!/^[a-z0-9-]+$/.test(id)) {
      return forceReply(env, chatId, "فقط حروف انگلیسی، عدد و خط تیره مجازه. دوباره بفرست:");
    }
    await setSession(env, chatId, { step: "new_category_label", id });
    return forceReply(env, chatId, "اسم فارسی این دسته رو بفرست (مثلاً «نوشیدنی‌ها»):");
  }

  if (session.step === "new_category_label") {
    await setSession(env, chatId, { step: "new_category_image", id: session.id, label: trimmed });
    return forceReply(env, chatId, "📷 عکس این دسته رو بفرست، یا اگه نمی‌خوای بنویس «بدون عکس»:");
  }

  if (session.step === "new_category_image") {
    if (trimmed === "بدون عکس") {
      await addCategory(env, session.id, session.label);
      await clearSession(env, chatId);
      await sendMessage(env, chatId, "✅ دسته جدید اضافه شد (بدون عکس).");
      return sendCategoriesMenu(env, chatId);
    }
    return forceReply(env, chatId, "لطفاً فقط عکس بفرست یا بنویس «بدون عکس»:");
  }

  if (session.step === "edit_category_image") {
    return forceReply(env, chatId, "لطفاً فقط عکس بفرست:");
  }

  if (session.step === "edit_product_image") {
    return forceReply(env, chatId, "لطفاً فقط عکس بفرست:");
  }

  if (session.step === "new_product_name") {
    await setSession(env, chatId, { ...session, step: "new_product_note", name: trimmed });
    return forceReply(env, chatId, "توضیح کوتاه محصول رو بفرست:");
  }

  if (session.step === "new_product_note") {
    await setSession(env, chatId, { ...session, step: "new_product_price", note: trimmed });
    return forceReply(env, chatId, "قیمت رو به تومان بفرست (فقط عدد):");
  }

  if (session.step === "new_product_price") {
    const price = parseInt(trimmed.replace(/[^\d]/g, ""), 10);
    if (!price) return forceReply(env, chatId, "یه عدد معتبر بفرست:");
    const newId = await nextProductId(env);
    await setSession(env, chatId, { ...session, step: "new_product_image", price, productId: newId });
    return forceReply(env, chatId, "📷 حالا عکس محصول رو بفرست، یا اگر عکس نداره بنویس «بدون عکس»:");
  }

  if (session.step === "new_product_image") {
    if (trimmed === "بدون عکس") {
      await addProduct(env, {
        id: session.productId,
        category: session.catId,
        name: session.name,
        note: session.note,
        price: session.price,
        image: null,
      });
      await clearSession(env, chatId);
      await sendMessage(env, chatId, "✅ محصول جدید اضافه شد (بدون عکس).");
      return sendProductList(env, chatId, session.catId);
    }
    return forceReply(env, chatId, "لطفاً فقط عکس بفرست یا بنویس «بدون عکس»:");
  }

  await clearSession(env, chatId);
  return sendMainMenu(env, chatId);
}
