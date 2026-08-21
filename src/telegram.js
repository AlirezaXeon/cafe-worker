import {
  getProducts,
  productsInCategory,
  findProduct,
  findCategory,
  previewCategoryPercent,
  applyCategoryPercent,
  setProductPrice,
  setProductImage,
  setProductDiscount,
  removeProductDiscount,
  addProduct,
  deleteProduct,
  addCategory,
  setCategoryImage,
  deleteCategory,
  nextProductId,
} from "./products.js";
import { getSession, setSession, clearSession } from "./session.js";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toFa = (v) => String(v).replace(/[0-9]/g, (d) => FA_DIGITS[d]);
const formatToman = (n) =>
  toFa(Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")) + " تومان";
const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// دانلود فایل عکس از سرورهای تلگرام
async function downloadTelegramFile(env, fileId) {
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

const sendMessage = (env, chatId, text, keyboard) =>
  tg(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });

const forceReply = (env, chatId, text) =>
  tg(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { force_reply: true },
  });

const answerCallback = (env, id, text) =>
  tg(env, "answerCallbackQuery", { callback_query_id: id, text, show_alert: false });

// ---------- منوها ----------

async function sendMainMenu(env, chatId) {
  await sendMessage(env, chatId, "🍰 <b>مدیریت کافه روشن</b>\nیکی رو انتخاب کن:", [
    [{ text: "📦 محصولات", callback_data: "menu:products" }],
    [{ text: "🏷 دسته‌بندی‌ها", callback_data: "menu:categories" }],
    [{ text: "💰 تغییر قیمت دسته‌جمعی", callback_data: "menu:bulk" }],
  ]);
}

async function sendCategoryPicker(env, chatId, mode) {
  const data = await getProducts(env);
  const rows = data.categories.map((c) => [
    { text: c.label, callback_data: `catpick:${mode}:${c.id}` },
  ]);
  rows.push([{ text: "🔙 بازگشت", callback_data: "menu:home" }]);
  const title =
    mode === "bulk" ? "کدوم دسته رو می‌خوای قیمتش رو تغییر بدی؟" : "کدوم دسته رو می‌خوای ببینی؟";
  await sendMessage(env, chatId, title, rows);
}

async function sendProductList(env, chatId, catId) {
  const cat = await findCategory(env, catId);
  const products = await productsInCategory(env, catId);
  const rows = products.map((p) => [
    {
      text: p.originalPrice ? `${p.name} — ${formatToman(p.price)} 🏷` : `${p.name} — ${formatToman(p.price)}`,
      callback_data: `prod:${p.id}`,
    },
  ]);
  rows.push([{ text: "➕ افزودن محصول جدید", callback_data: `catpick:newprod:${catId}` }]);
  rows.push([{ text: "🔙 بازگشت", callback_data: "menu:products" }]);
  await sendMessage(env, chatId, `📦 محصولات دسته «${escapeHtml(cat ? cat.label : catId)}»`, rows);
}

async function sendProductDetail(env, chatId, productId) {
  const p = await findProduct(env, productId);
  if (!p) return sendMainMenu(env, chatId);
  const cat = await findCategory(env, p.category);

  const priceLine = p.originalPrice
    ? `💰 قیمت: <s>${formatToman(p.originalPrice)}</s> ← ${formatToman(p.price)}`
    : `💰 قیمت: ${formatToman(p.price)}`;

  const text = `<b>${escapeHtml(p.name)}</b>\nدسته: ${escapeHtml(cat ? cat.label : p.category)}\n${escapeHtml(
    p.note
  )}\n${priceLine}`;

  const rows = [
    [{ text: "✏️ ویرایش قیمت", callback_data: `editprice:${p.id}` }],
    [{ text: "🏷 اعمال تخفیف", callback_data: `discount:${p.id}` }],
    [{ text: "🖼 تغییر عکس", callback_data: `editimg:${p.id}` }],
  ];
  if (p.originalPrice) rows.push([{ text: "❌ حذف تخفیف", callback_data: `rmdiscount:${p.id}` }]);
  if (p.image) rows.push([{ text: "🗑 حذف عکس", callback_data: `rmimg:${p.id}` }]);
  rows.push([{ text: "🗑 حذف محصول", callback_data: `delprod:${p.id}` }]);
  rows.push([{ text: "🔙 بازگشت", callback_data: `catpick:browse:${p.category}` }]);

  await sendMessage(env, chatId, text, rows);
}

async function sendCategoriesMenu(env, chatId) {
  const data = await getProducts(env);
  const rows = data.categories.map((c) => [
    { text: c.label, callback_data: `catpick:browse:${c.id}` },
    { text: "🖼 عکس", callback_data: `catimg:${c.id}` },
    { text: "🗑 حذف", callback_data: `delcat:${c.id}` },
  ]);
  rows.push([{ text: "➕ افزودن دسته جدید", callback_data: "newcat" }]);
  rows.push([{ text: "🔙 بازگشت", callback_data: "menu:home" }]);
  await sendMessage(env, chatId, "🏷 <b>دسته‌بندی‌ها</b>", rows);
}

// ---------- دکمه‌ها (callback_query) ----------

export async function handleCallback(env, chatId, data) {
  const [action, a, b] = data.split(":");

  if (data === "menu:home") return sendMainMenu(env, chatId);
  if (data === "menu:products") return sendCategoryPicker(env, chatId, "browse");
  if (data === "menu:categories") return sendCategoriesMenu(env, chatId);
  if (data === "menu:bulk") return sendCategoryPicker(env, chatId, "bulk");

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
    await setProductImage(env, a, null);
    await sendMessage(env, chatId, "🗑 عکس محصول حذف شد.");
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
    await deleteCategory(env, a);
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
        image: "images/products/placeholder.jpg",
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

// ---------- پردازش عکس ارسالی در تلگرام ----------

export async function handleImageStep(env, chatId, photoArray, session) {
  // تلگرام عکس رو در چند سایز می‌فرسته، ما بزرگترین رو برمی‌داریم (آخرین آیتم آرایه)
  const fileId = photoArray[photoArray.length - 1].file_id;

  await sendMessage(env, chatId, "⏳ در حال آپلود عکس...");

  const fileData = await downloadTelegramFile(env, fileId);
  if (!fileData) {
    return forceReply(env, chatId, "❌ خطا در دریافت عکس. لطفاً دوباره بفرست یا بنویس «بدون عکس»:");
  }

  // ---- عکس دسته‌بندی (هم موقع ساخت دسته‌ی جدید، هم ویرایش دسته‌ی موجود) ----
  if (session.step === "new_category_image" || session.step === "edit_category_image") {
    const catId = session.step === "new_category_image" ? session.id : session.catId;
    const filename = `cat_${catId}.${fileData.ext}`;

    await env.PRODUCTS_KV.put(`image:${filename}`, fileData.buffer, {
      metadata: { contentType: `image/${fileData.ext === 'jpg' ? 'jpeg' : fileData.ext}` }
    });

    const imagePath = `images/categories/${filename}`;

    if (session.step === "new_category_image") {
      await addCategory(env, session.id, session.label, imagePath);
      await clearSession(env, chatId);
      await sendMessage(env, chatId, "✅ دسته جدید همراه با عکس اضافه شد.");
    } else {
      await setCategoryImage(env, catId, imagePath);
      await clearSession(env, chatId);
      await sendMessage(env, chatId, "✅ عکس دسته به‌روزرسانی شد.");
    }
    return sendCategoriesMenu(env, chatId);
  }

  // ---- عکس محصول موجود (ویرایش/جایگزینی) ----
  if (session.step === "edit_product_image") {
    const filename = `${session.productId}.${fileData.ext}`;
    await env.PRODUCTS_KV.put(`image:${filename}`, fileData.buffer, {
      metadata: { contentType: `image/${fileData.ext === 'jpg' ? 'jpeg' : fileData.ext}` }
    });
    await setProductImage(env, session.productId, `images/products/${filename}`);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ عکس محصول به‌روزرسانی شد.");
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

// ---------- ورودی اصلی ----------

export async function handleUpdate(update, env) {
  const adminIds = (env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const fromId = String(msg.from.id);
    if (!adminIds.includes(fromId)) return; // کاربر غیرمجاز؛ نادیده گرفته میشه

    if (msg.text === "/start") {
      await clearSession(env, chatId);
      return sendMainMenu(env, chatId);
    }

    const session = await getSession(env, chatId);
    if (session) {
      // اگر منتظر عکس بودیم و کاربر عکس فرستاد
      const waitingForPhoto = ["new_product_image", "new_category_image", "edit_category_image", "edit_product_image"];
      if (msg.photo && waitingForPhoto.includes(session.step)) {
        return handleImageStep(env, chatId, msg.photo, session);
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
    await answerCallback(env, cq.id);
    return handleCallback(env, chatId, cq.data);
  }
}