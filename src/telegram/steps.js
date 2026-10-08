import {
  previewCategoryPercent,
  setProductPrice,
  setProductDiscount,
  addProduct,
  addCategory,
  newProductId,
  newCategoryId,
} from "../data/products.js";
import { setSession, clearSession } from "../data/session.js";
import { sendMessage, forceReply } from "./api.js";
import { toFa, formatToman, escapeHtml } from "./format.js";
import { sendMainMenu, sendCategoriesMenu, sendProductDetail, sendProductList } from "./menus.js";
import { validatePrice, validatePercent, validateDiscount } from "../lib/validate.js";

// ---------- پیام‌های متنی در میانه‌ی یه مرحله ----------

export async function handleTextStep(env, chatId, text, session) {
  const trimmed = (text || "").trim();

  if (session.step === "bulk_percent") {
    const check = validatePercent(trimmed);
    if (!check.valid || check.percent === 0) {
      return forceReply(env, chatId, check.error || "یه عدد معتبر بفرست (مثلاً 20 یا -10):");
    }
    const percent = check.percent;
    let preview;
    try {
      preview = await previewCategoryPercent(env, session.catId, percent);
    } catch (err) {
      return forceReply(env, chatId, `⚠️ ${err.message}\nیه عدد دیگر وارد کن:`);
    }
    if (preview.length === 0) {
      await clearSession(env, chatId);
      return sendMessage(env, chatId, "این دسته محصولی نداره.");
    }
    const lines = preview
      .map((p) => `• ${escapeHtml(p.name)}: ${formatToman(p.oldPrice)} ← ${formatToman(p.newPrice)}`)
      .join("\n");
    await setSession(env, chatId, {
      step: "bulk_confirm",
      catId: session.catId,
      percent,
      items: preview.map((p) => ({ id: p.id, oldPrice: p.oldPrice, newPrice: p.newPrice })),
    });
    return sendMessage(env, chatId, `پیش‌نمایش تغییر قیمت (${toFa(percent)}٪):\n\n${lines}\n\nتایید می‌کنی؟`, [
      [{ text: "✅ تایید و اعمال", callback_data: "bulkconfirm" }],
      [{ text: "❌ لغو", callback_data: "bulkcancel" }],
    ]);
  }

  if (session.step === "edit_price") {
    const check = validatePrice(trimmed);
    if (!check.valid) return forceReply(env, chatId, `${check.error}\nقیمت جدید رو به تومان بفرست:`);
    try {
      await setProductPrice(env, session.productId, check.price);
    } catch (err) {
      return forceReply(env, chatId, `⚠️ ${err.message}\nیه قیمت معتبر بفرست:`);
    }
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ قیمت به‌روزرسانی شد.");
    return sendProductDetail(env, chatId, session.productId);
  }

  if (session.step === "discount_percent") {
    const check = validateDiscount(trimmed);
    if (!check.valid || check.discount <= 0) {
      return forceReply(env, chatId, `${check.error || "درصد باید بین ۱ تا ۹۹ باشه"}:`);
    }
    await setProductDiscount(env, session.productId, check.discount);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ تخفیف اعمال شد.");
    return sendProductDetail(env, chatId, session.productId);
  }

  if (session.step === "new_category_label") {
    // شناسه همین‌جا ساخته میشه (همون تابعی که پنل وب استفاده می‌کنه)
    await setSession(env, chatId, {
      step: "new_category_image",
      id: newCategoryId(),
      label: trimmed,
    });
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
    const check = validatePrice(trimmed);
    if (!check.valid) return forceReply(env, chatId, `${check.error}\nقیمت رو به تومان بفرست:`);
    const newId = newProductId();
    await setSession(env, chatId, { ...session, step: "new_product_image", price: check.price, productId: newId });
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