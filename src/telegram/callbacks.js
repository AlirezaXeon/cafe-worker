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
import { sendMessage, forceReply } from "./api.js";
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

export async function handleCallback(env, chatId, data) {
  const [action, a, b] = data.split(":");

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
      await sendMessage(env, chatId, "🚫 محصول از سایت پنهان شد (تا وقتی دوباره فعالش کنی، مشتری نمی‌بینتش).");
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
    await setSession(env, chatId, { step: "new_category_id" });
    return forceReply(env, chatId, "یک شناسه‌ی انگلیسی کوتاه برای دسته بفرست (مثلاً drinks):");
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
