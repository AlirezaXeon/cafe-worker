import { addProduct, findProduct, setProductImage, addCategory, findCategory, setCategoryImage } from "../data/products.js";
import { getSiteConfig, setSiteLogo, setSiteCover } from "../data/site.js";
import { clearSession } from "../data/session.js";
import { sendMessage, forceReply, downloadTelegramFile } from "./api.js";
import { sendSiteImagesMenu, sendCategoriesMenu, sendProductDetail, sendProductList } from "./menus.js";

// ---------- پردازش عکس ارسالی در تلگرام ----------

export async function handleImageStep(env, chatId, msg, session) {
  // عکس ممکنه فشرده (photo) یا به‌صورت فایل خام (document, مثلاً PNG شفاف بدون فشرده‌سازی) فرستاده شده باشه
  let fileId;
  if (msg.photo && msg.photo.length) {
    // تلگرام عکس رو در چند سایز می‌فرسته، بزرگترین رو برمی‌داریم (آخرین آیتم آرایه)
    fileId = msg.photo[msg.photo.length - 1].file_id;
  } else if (msg.document) {
    fileId = msg.document.file_id;
  } else {
    return forceReply(env, chatId, "❌ فرمت فایل شناسایی نشد. یه عکس (یا فایل تصویری) بفرست:");
  }

  await sendMessage(env, chatId, "⏳ در حال آپلود عکس...");

  const fileData = await downloadTelegramFile(env, fileId);
  if (!fileData) {
    return forceReply(env, chatId, "❌ خطا در دریافت عکس. لطفاً دوباره بفرست یا بنویس «بدون عکس»:");
  }

  // ---- لوگو / عکس بالای سایت ----
  if (session.step === "edit_site_logo" || session.step === "edit_site_cover") {
    const kind = session.step === "edit_site_logo" ? "logo" : "cover";
    const filename = `site-${kind}-${Date.now()}.${fileData.ext}`;

    await env.PRODUCTS_KV.put(`image:${filename}`, fileData.buffer, {
      metadata: { contentType: `image/${fileData.ext === 'jpg' ? 'jpeg' : fileData.ext}` }
    });

    const imagePath = `images/${filename}`;
    const oldConfig = await getSiteConfig(env);
    const oldPath = kind === "logo" ? oldConfig.logo : oldConfig.cover;

    if (kind === "logo") {
      await setSiteLogo(env, imagePath);
      await sendMessage(env, chatId, "✅ لوگوی سایت به‌روزرسانی شد.");
    } else {
      await setSiteCover(env, imagePath);
      await sendMessage(env, chatId, "✅ عکس بالای سایت به‌روزرسانی شد.");
    }

    // پاک کردن عکس قدیمی از KV تا هم جا اشغال نکنه، هم یتیم نمونه
    if (oldPath) {
      const oldFilename = oldPath.split("/").pop();
      if (oldFilename && oldFilename !== filename) {
        await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
      }
    }

    await clearSession(env, chatId);
    return sendSiteImagesMenu(env, chatId);
  }

  // ---- عکس دسته‌بندی (هم موقع ساخت دسته‌ی جدید، هم ویرایش دسته‌ی موجود) ----
  if (session.step === "new_category_image" || session.step === "edit_category_image") {
    const catId = session.step === "new_category_image" ? session.id : session.catId;
    // تایم‌استمپ توی اسم فایل لازمه: چون آدرس عکس رو "immutable" کش کردیم،
    // اگه اسم فایل موقع ویرایش عوض نشه مرورگر همیشه نسخه‌ی قدیمی رو نشون میده
    const filename = `cat_${catId}_${Date.now()}.${fileData.ext}`;

    await env.PRODUCTS_KV.put(`image:${filename}`, fileData.buffer, {
      metadata: { contentType: `image/${fileData.ext === 'jpg' ? 'jpeg' : fileData.ext}` }
    });

    const imagePath = `images/categories/${filename}`;

    if (session.step === "new_category_image") {
      await addCategory(env, session.id, session.label, imagePath);
      await sendMessage(env, chatId, "✅ دسته جدید همراه با عکس اضافه شد.");
    } else {
      const oldCat = await findCategory(env, catId);
      await setCategoryImage(env, catId, imagePath);
      await sendMessage(env, chatId, "✅ عکس دسته به‌روزرسانی شد.");
      if (oldCat && oldCat.image) {
        const oldFilename = oldCat.image.split("/").pop();
        if (oldFilename && oldFilename !== filename) {
          await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
      }
    }
    await clearSession(env, chatId);
    return sendCategoriesMenu(env, chatId);
  }

  // ---- عکس محصول موجود (ویرایش/جایگزینی) ----
  if (session.step === "edit_product_image") {
    // همینطور تایم‌استمپ‌دار، به همون دلیل بالا (کش immutable)
    const filename = `${session.productId}_${Date.now()}.${fileData.ext}`;
    await env.PRODUCTS_KV.put(`image:${filename}`, fileData.buffer, {
      metadata: { contentType: `image/${fileData.ext === 'jpg' ? 'jpeg' : fileData.ext}` }
    });
    const oldProduct = await findProduct(env, session.productId);
    await setProductImage(env, session.productId, `images/products/${filename}`);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ عکس محصول به‌روزرسانی شد.");
    if (oldProduct && oldProduct.image) {
      const oldFilename = oldProduct.image.split("/").pop();
      if (oldFilename && oldFilename !== filename) {
        await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
      }
    }
    return sendProductDetail(env, chatId, session.productId);
  }

  // ---- عکس محصول (رفتار قبلی، بدون تغییر) ----
  const filename = `${session.productId}.${fileData.ext}`;

  // ذخیره عکس در KV
  await env.PRODUCTS_KV.put(`image:${filename}`, fileData.buffer, {
    metadata: { contentType: `image/${fileData.ext === 'jpg' ? 'jpeg' : fileData.ext}` }
  });

  // ذخیره اطلاعات محصول در D1 (خود عکس همچنان توی KV می‌مونه)
  await addProduct(env, {
    id: session.productId,
    category: session.catId,
    name: session.name,
    note: session.note,
    price: session.price,
    image: `images/products/${filename}`, // آدرس نسبی برای سایت
  });
  await clearSession(env, chatId);

  await sendMessage(env, chatId, "✅ محصول جدید همراه با عکس اضافه شد.");
  return sendProductList(env, chatId, session.catId);
}
