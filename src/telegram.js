import {
  getProducts,
  saveProducts,
  productsInCategory,
  findProduct,
  findCategory,
  roundPrice,
  previewCategoryPercent,
  applyCategoryPercent,
  setProductDiscount,
  removeProductDiscount,
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
  const data = await getProducts(env);
  const cat = findCategory(data, catId);
  const rows = productsInCategory(data, catId).map((p) => [
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
  const data = await getProducts(env);
  const p = findProduct(data, productId);
  if (!p) return sendMainMenu(env, chatId);
  const cat = findCategory(data, p.category);

  const priceLine = p.originalPrice
    ? `💰 قیمت: <s>${formatToman(p.originalPrice)}</s> ← ${formatToman(p.price)}`
    : `💰 قیمت: ${formatToman(p.price)}`;

  const text = `<b>${escapeHtml(p.name)}</b>\nدسته: ${escapeHtml(cat ? cat.label : p.category)}\n${escapeHtml(
    p.note
  )}\n${priceLine}`;

  const rows = [
    [{ text: "✏️ ویرایش قیمت", callback_data: `editprice:${p.id}` }],
    [{ text: "🏷 اعمال تخفیف", callback_data: `discount:${p.id}` }],
  ];
  if (p.originalPrice) rows.push([{ text: "❌ حذف تخفیف", callback_data: `rmdiscount:${p.id}` }]);
  rows.push([{ text: "🗑 حذف محصول", callback_data: `delprod:${p.id}` }]);
  rows.push([{ text: "🔙 بازگشت", callback_data: `catpick:browse:${p.category}` }]);

  await sendMessage(env, chatId, text, rows);
}

async function sendCategoriesMenu(env, chatId) {
  const data = await getProducts(env);
  const rows = data.categories.map((c) => [
    { text: c.label, callback_data: `catpick:browse:${c.id}` },
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
    const data2 = await getProducts(env);
    const p = findProduct(data2, a);
    if (p) {
      removeProductDiscount(p);
      await saveProducts(env, data2);
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
    const data2 = await getProducts(env);
    const p = findProduct(data2, a);
    const catId = p ? p.category : null;
    data2.products = data2.products.filter((x) => x.id !== a);
    await saveProducts(env, data2);
    await sendMessage(env, chatId, "🗑 محصول حذف شد.");
    return catId ? sendProductList(env, chatId, catId) : sendMainMenu(env, chatId);
  }

  if (data === "newcat") {
    await setSession(env, chatId, { step: "new_category_id" });
    return forceReply(env, chatId, "یک شناسه‌ی انگلیسی کوتاه برای دسته بفرست (مثلاً drinks):");
  }

  if (action === "delcat") {
    const data2 = await getProducts(env);
    const count = productsInCategory(data2, a).length;
    if (count > 0) {
      return sendMessage(env, chatId, `این دسته ${toFa(count)} محصول داره. اول محصولاتش رو حذف یا جابه‌جا کن.`);
    }
    return sendMessage(env, chatId, "مطمئنی این دسته حذف بشه؟", [
      [{ text: "✅ آره", callback_data: `delcatyes:${a}` }],
      [{ text: "❌ نه", callback_data: "menu:categories" }],
    ]);
  }

  if (action === "delcatyes") {
    const data2 = await getProducts(env);
    data2.categories = data2.categories.filter((c) => c.id !== a);
    await saveProducts(env, data2);
    await sendMessage(env, chatId, "🗑 دسته حذف شد.");
    return sendCategoriesMenu(env, chatId);
  }

  if (data === "bulkconfirm") {
    const session = await getSession(env, chatId);
    if (!session || session.step !== "bulk_confirm") return sendMainMenu(env, chatId);
    const data2 = await getProducts(env);
    applyCategoryPercent(data2, session.catId, session.percent);
    await saveProducts(env, data2);
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
    const data = await getProducts(env);
    const preview = previewCategoryPercent(data, session.catId, percent);
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
    const data = await getProducts(env);
    const p = findProduct(data, session.productId);
    if (p) {
      p.price = roundPrice(price);
      p.originalPrice = null;
      await saveProducts(env, data);
    }
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ قیمت به‌روزرسانی شد.");
    return sendProductDetail(env, chatId, session.productId);
  }

  if (session.step === "discount_percent") {
    const percent = parseFloat(trimmed.replace(/[٪%]/g, ""));
    if (isNaN(percent) || percent <= 0 || percent >= 100) {
      return forceReply(env, chatId, "درصد باید بین ۱ تا ۹۹ باشه:");
    }
    const data = await getProducts(env);
    const p = findProduct(data, session.productId);
    if (p) {
      setProductDiscount(p, percent);
      await saveProducts(env, data);
    }
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
    const data = await getProducts(env);
    data.categories.push({ id: session.id, label: trimmed });
    await saveProducts(env, data);
    await clearSession(env, chatId);
    await sendMessage(env, chatId, "✅ دسته جدید اضافه شد.");
    return sendCategoriesMenu(env, chatId);
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
    const data = await getProducts(env);
    const newId = nextProductId(data);
    await setSession(env, chatId, { ...session, step: "new_product_image", price, productId: newId });
    return forceReply(env, chatId, "📷 حالا عکس محصول رو بفرست، یا اگر عکس نداره بنویس «بدون عکس»:");
  }

  if (session.step === "new_product_image") {
    if (trimmed === "بدون عکس") {
      const image = "images/products/placeholder.jpg";
      const data = await getProducts(env);
      data.products.push({
        id: session.productId,
        category: session.catId,
        name: session.name,
        note: session.note,
        price: roundPrice(session.price),
        originalPrice: null,
        image,
      });
      await saveProducts(env, data);
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

  const filename = `${session.productId}.${fileData.ext}`;

  // ذخیره عکس در KV
  await env.PRODUCTS_KV.put(`image:${filename}`, fileData.buffer, {
    metadata: { contentType: `image/${fileData.ext === 'jpg' ? 'jpeg' : fileData.ext}` }
  });

  // ذخیره اطلاعات محصول در دیتابیس
  const data = await getProducts(env);
  data.products.push({
    id: session.productId,
    category: session.catId,
    name: session.name,
    note: session.note,
    price: roundPrice(session.price),
    originalPrice: null,
    image: `images/products/${filename}`, // آدرس نسبی برای سایت
  });
  await saveProducts(env, data);
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
      if (msg.photo && session.step === "new_product_image") {
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