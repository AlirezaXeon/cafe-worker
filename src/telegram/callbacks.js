import {
  productsInCategory,
  findProduct,
  findCategory,
  applyCategoryPercent,
  setProductImage,
  toggleProductAvailability,
  removeProductDiscount,
  deleteProduct,
  deleteCategory,
} from "../data/products.js";
import { getSession, setSession, clearSession } from "../data/session.js";
import { findOrphanImageKeys, deleteOrphanImages } from "../data/maintenance.js";
import { confirmOrder, rejectOrder } from "../data/orders.js";
import { sendMessage, forceReply, editMessageText } from "./api.js";
import { toFa } from "./format.js";
import {
  sendMainMenu,
  sendSiteImagesMenu,
  sendCategoryPicker,
  sendProductList,
  sendProductDetail,
  sendCategoriesMenu,
} from "./menus.js";

// ---------- دکمه‌ها (callback_query) ----------

export async function handleCallback(env, chatId, data, cq) {
  const [action, a, b] = data.split(":");

  // ── تایید/رد سفارش (از سایت مشتری‌ها) ────────────────────────────────
  // این پیام‌ها با sendRaw فرستاده شدن (نه sendMessage)، پس تو چرخه‌ی
  // پاک‌شدن خودکار پیام‌های منو نیستن؛ هر سفارش پیام مستقل خودشو داره.
  if (action === "order" && (a === "confirm" || a === "reject")) {
    const orderId = Number(b);
    const adminName = cq?.from?.first_name || "ادمین";
    const updated = a === "confirm" ? await confirmOrder(env, orderId) : await rejectOrder(env, orderId);

    const raw = await env.PRODUCTS_KV.get(`order:msgs:${orderId}`);
    const stored = raw ? JSON.parse(raw) : null;
    const baseText = stored?.text ?? cq?.message?.text ?? "سفارش";
    const entries = stored?.entries ?? (cq?.message?.message_id ? [{ chatId, messageId: cq.message.message_id }] : []);

    if (!updated) {
      // یه ادمین دیگه زودتر همین سفارش رو تایید/رد کرده
      const newText = `${baseText}\n\n⚠️ این سفارش قبلاً توسط ادمین دیگری بررسی شده.`;
      await Promise.all(entries.map((e) => editMessageText(env, e.chatId, e.messageId, newText, [])));
      return;
    }

    const verb = a === "confirm" ? "✅ تایید شد" : "❌ رد شد";
    const newText = `${baseText}\n\n${verb} توسط ${adminName}`;
    await Promise.all(entries.map((e) => editMessageText(env, e.chatId, e.messageId, newText, [])));
    return;
  }

  // ── لغو / بازگشت به منو ─────────────────────────────────────────────
  // این دکمه زیر همه‌ی forceReply‌ها نشون داده میشه تا کاربر بتونه
  // در هر مرحله‌ای انصراف بده و برگرده به منوی اصلی
  if (data === "cancel") {
    await clearSession(env, chatId);
    return sendMainMenu(env, chatId);
  }

  if (data === "menu:home") return sendMainMenu(env, chatId);
  if (data === "menu:products") return sendCategoryPicker(env, chatId, "browse");
  if (data === "menu:categories") return sendCategoriesMenu(env, chatId);
  if (data === "menu:bulk") return sendCategoryPicker(env, chatId, "bulk");
  if (data === "menu:siteimages") return sendSiteImagesMenu(env, chatId);

  if (data === "siteimg:logo") {
    await setSession(env, chatId, { step: "edit_site_logo" });
    return forceReply(env, chatId, "🖼 عکس جدید لوگو رو بفرست (ترجیحاً مربعی، با پس‌زمینه‌ی شفاف اگه PNG داری):");
  }
  if (data === "siteimg:cover") {
    await setSession(env, chatId, { step: "edit_site_cover" });
    return forceReply(env, chatId, "🖼 عکس جدید بالای سایت رو بفرست (افقی، عریض، از فضای کافه):");
  }

  if (data === "siteimg:cleanup") {
    const orphans = await findOrphanImageKeys(env);
    if (orphans.length === 0) {
      return sendMessage(env, chatId, "🧹 هیچ عکس اضافی‌ای پیدا نشد؛ همه‌چیز تمیزه.", [
        [{ text: "🔙 بازگشت", callback_data: "menu:siteimages" }],
      ]);
    }
    return sendMessage(
      env,
      chatId,
      `🧹 ${toFa(orphans.length)} عکس پیدا شد که دیگه به هیچ محصول/دسته/لوگو/کاوری وصل نیستن. حذفشون کنم؟`,
      [
        [{ text: "✅ آره، پاک کن", callback_data: "cleanupyes" }],
        [{ text: "❌ نه", callback_data: "menu:siteimages" }],
      ]
    );
  }

  if (data === "cleanupyes") {
    const count = await deleteOrphanImages(env);
    await sendMessage(env, chatId, `🧹 ${toFa(count)} عکس اضافی پاک شد.`);
    return sendSiteImagesMenu(env, chatId);
  }

  if (action === "catpick") {
    const mode = a;
    const catId = b;
    if (mode === "browse") return sendProductList(env, chatId, catId);
    if (mode === "bulk") {
      await setSession(env, chatId, { step: "bulk_percent", catId });
      return forceReply(env, chatId, "درصد تغییر قیمت رو بفرست (مثبت = افزایش، منفی = تخفیف). مثال: 20 یا -15");
    }
    if (mode === "newprod") {
      await setSession(env, chatId, { step: "new_product_name", catId });
      return forceReply(env, chatId, "اسم محصول جدید رو بفرست:");
    }
  }

  if (action === "prod") return sendProductDetail(env, chatId, a);

  if (action === "editprice") {
    await setSession(env, chatId, { step: "edit_price", productId: a });
    return forceReply(env, chatId, "قیمت جدید رو به تومان بفرست (فقط عدد):");
  }

  if (action === "discount") {
    await setSession(env, chatId, { step: "discount_percent", productId: a });
    return forceReply(env, chatId, "چند درصد تخفیف بدیم؟ (مثلاً 15):");
  }

  if (action === "rmdiscount") {
    await removeProductDiscount(env, a);
    return sendProductDetail(env, chatId, a);
  }

  if (action === "editimg") {
    await setSession(env, chatId, { step: "edit_product_image", productId: a });
    return forceReply(env, chatId, "📷 عکس جدید این محصول رو بفرست:");
  }

  if (action === "rmimg") {
    const p = await findProduct(env, a);
    await setProductImage(env, a, null);
    if (p && p.image) {
      const oldFilename = p.image.split("/").pop();
      if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
    }
    await sendMessage(env, chatId, "🗑 عکس محصول حذف شد.");
    return sendProductDetail(env, chatId, a);
  }

  if (action === "toggleavail") {
    const next = await toggleProductAvailability(env, a);
    if (next === 1) {
      await sendMessage(env, chatId, "✅ محصول برگشت رو سایت.");
    } else if (next === 0) {
      await sendMessage(env, chatId, "🚫 محصول از سایت پنهان شد.");
    }
    return sendProductDetail(env, chatId, a);
  }

  if (action === "delprod") {
    return sendMessage(env, chatId, "مطمئنی می‌خوای این محصول حذف بشه؟", [
      [{ text: "✅ آره، حذف کن", callback_data: `delprodyes:${a}` }],
      [{ text: "❌ نه", callback_data: `prod:${a}` }],
    ]);
  }

  if (action === "delprodyes") {
    const p = await findProduct(env, a);
    const catId = p ? p.category : null;
    await deleteProduct(env, a);
    if (p && p.image) {
      const oldFilename = p.image.split("/").pop();
      if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
    }
    await sendMessage(env, chatId, "🗑 محصول حذف شد.");
    return catId ? sendProductList(env, chatId, catId) : sendMainMenu(env, chatId);
  }

  if (data === "newcat") {
    // شناسه رو دیگه از ادمین نمی‌پرسیم؛ خودکار ساخته میشه (مثل پنل وب) تا فرمت شناسه‌ها یکی بمونه
    await setSession(env, chatId, { step: "new_category_label" });
    return forceReply(env, chatId, "اسم این دسته رو بفرست (مثلاً «نوشیدنی‌ها»):");
  }

  if (action === "catimg") {
    await setSession(env, chatId, { step: "edit_category_image", catId: a });
    return forceReply(env, chatId, "📷 عکس جدید این دسته رو بفرست:");
  }

  if (action === "delcat") {
    const count = (await productsInCategory(env, a)).length;
    if (count > 0) {
      return sendMessage(env, chatId, `این دسته ${toFa(count)} محصول داره. اول محصولاتش رو حذف یا جابه‌جا کن.`);
    }
    return sendMessage(env, chatId, "مطمئنی این دسته حذف بشه؟", [
      [{ text: "✅ آره", callback_data: `delcatyes:${a}` }],
      [{ text: "❌ نه", callback_data: "menu:categories" }],
    ]);
  }

  if (action === "delcatyes") {
    const cat = await findCategory(env, a);
    await deleteCategory(env, a);
    if (cat && cat.image) {
      const oldFilename = cat.image.split("/").pop();
      if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
    }
    await sendMessage(env, chatId, "🗑 دسته حذف شد.");
    return sendCategoriesMenu(env, chatId);
  }

  if (data === "bulkconfirm") {
    const session = await getSession(env, chatId);
    if (!session || session.step !== "bulk_confirm") return sendMainMenu(env, chatId);
    await applyCategoryPercent(env, session.catId, session.percent);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ قیمت‌ها به‌روزرسانی شدن.");
    return sendMainMenu(env, chatId);
  }

  if (data === "bulkcancel") {
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "لغو شد.");
    return sendMainMenu(env, chatId);
  }

  return sendMainMenu(env, chatId);
}