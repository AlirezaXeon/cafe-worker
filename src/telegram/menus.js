import { getProducts, productsInCategory, findProduct, findCategory } from "../data/products.js";
import { getSiteConfig } from "../data/site.js";
import { sendMessage, sendMessageWithPanel, pinMessage, sendRaw } from "./api.js";
import { formatToman, escapeHtml } from "./format.js";

// راهنمای ساده و همیشه در دسترس؛ برخلاف بقیه‌ی پیام‌ها با پیام بعدی پاک نمی‌شه، چون
// پین می‌شه و از چرخه‌ی sendAndTrack خارجه. فقط یه‌بار (برای هر چت) فرستاده و پین می‌شه.
const GUIDE_TEXT =
  "📌 <b>راهنمای سریع</b>\n" +
  "برای تغییر قیمت یا عکس هر محصول:\n" +
  "📦 محصولات ← دسته موردنظر ← محصول موردنظر\n\n" +
  "🖼 تصاویر سایت ← لوگو یا عکس بالای سایت\n" +
  "💰 تغییر قیمت دسته‌جمعی ← تخفیف/افزایش قیمت یه دسته کامل\n\n" +
  "این پیام پین شده، هر وقت لازم شد از بالای چت بازش کن.";

async function ensureGuidePinned(env, chatId) {
  const already = await env.PRODUCTS_KV.get(`guidepinned:${chatId}`);
  if (already) return;
  const res = await sendRaw(env, { chat_id: chatId, text: GUIDE_TEXT, parse_mode: "HTML" });
  if (res.ok && res.result?.message_id) {
    await pinMessage(env, chatId, res.result.message_id);
    await env.PRODUCTS_KV.put(`guidepinned:${chatId}`, String(res.result.message_id));
  }
}

// ---------- منوها ----------

export async function sendMainMenu(env, chatId) {
  await ensureGuidePinned(env, chatId);
  await sendMessageWithPanel(env, chatId, "🍰 <b>مدیریت کافه روشن</b>");
}

export async function sendSiteImagesMenu(env, chatId) {
  const cfg = await getSiteConfig(env);
  const logoStatus = cfg.logo ? "✅ تنظیم شده" : "⛔️ هنوز آپلود نشده";
  const coverStatus = cfg.cover ? "✅ تنظیم شده" : "⛔️ هنوز آپلود نشده";
  await sendMessage(
    env,
    chatId,
    `🖼 <b>تصاویر سایت</b>\n\nلوگو: ${logoStatus}\nعکس بالای سایت: ${coverStatus}`,
    [
      [{ text: "🖼 تغییر لوگو", callback_data: "siteimg:logo" }],
      [{ text: "🖼 تغییر عکس بالای سایت", callback_data: "siteimg:cover" }],
      [{ text: "🧹 پاکسازی عکس‌های اضافی", callback_data: "siteimg:cleanup" }],
      [{ text: "🔙 بازگشت", callback_data: "menu:home" }],
    ]
  );
}

export async function sendCategoryPicker(env, chatId, mode) {
  const data = await getProducts(env);
  const rows = data.categories.map((c) => [
    { text: c.label, callback_data: `catpick:${mode}:${c.id}` },
  ]);
  rows.push([{ text: "🔙 بازگشت", callback_data: "menu:home" }]);
  const title =
    mode === "bulk" ? "کدوم دسته رو می‌خوای قیمتش رو تغییر بدی؟" : "کدوم دسته رو می‌خوای ببینی؟";
  await sendMessage(env, chatId, title, rows);
}

export async function sendProductList(env, chatId, catId) {
  const cat = await findCategory(env, catId);
  const products = await productsInCategory(env, catId);
  const rows = products.map((p) => {
    const hiddenMark = p.available ? "" : "🚫 ";
    const discountMark = p.originalPrice ? " 🏷" : "";
    return [
      {
        text: `${hiddenMark}${p.name} — ${formatToman(p.price)}${discountMark}`,
        callback_data: `prod:${p.id}`,
      },
    ];
  });
  rows.push([{ text: "➕ افزودن محصول جدید", callback_data: `catpick:newprod:${catId}` }]);
  rows.push([{ text: "🔙 بازگشت", callback_data: "menu:products" }]);
  await sendMessage(env, chatId, `📦 محصولات دسته «${escapeHtml(cat ? cat.label : catId)}»`, rows);
}

export async function sendProductDetail(env, chatId, productId) {
  const p = await findProduct(env, productId);
  if (!p) return sendMainMenu(env, chatId);
  const cat = await findCategory(env, p.category);

  const priceLine = p.originalPrice
    ? `💰 قیمت: <s>${formatToman(p.originalPrice)}</s> ← ${formatToman(p.price)}`
    : `💰 قیمت: ${formatToman(p.price)}`;

  const availabilityLine = p.available
    ? "🟢 وضعیت: رو سایت نمایش داده می‌شه"
    : "🔴 وضعیت: از سایت پنهانه (موجود نیست)";

  const text = `<b>${escapeHtml(p.name)}</b>\nدسته: ${escapeHtml(cat ? cat.label : p.category)}\n${escapeHtml(
    p.note
  )}\n${priceLine}\n${availabilityLine}`;

  const rows = [
    [{ text: "✏️ ویرایش قیمت", callback_data: `editprice:${p.id}` }],
    [{ text: "🏷 اعمال تخفیف", callback_data: `discount:${p.id}` }],
    [{ text: "🖼 تغییر عکس", callback_data: `editimg:${p.id}` }],
    [
      p.available
        ? { text: "🚫 پنهان کن (فعلاً موجود نیست)", callback_data: `toggleavail:${p.id}` }
        : { text: "✅ برگردون به سایت (موجود شد)", callback_data: `toggleavail:${p.id}` },
    ],
  ];
  if (p.originalPrice) rows.push([{ text: "❌ حذف تخفیف", callback_data: `rmdiscount:${p.id}` }]);
  if (p.image) rows.push([{ text: "🗑 حذف عکس", callback_data: `rmimg:${p.id}` }]);
  rows.push([{ text: "🗑 حذف محصول", callback_data: `delprod:${p.id}` }]);
  rows.push([{ text: "🔙 بازگشت", callback_data: `catpick:browse:${p.category}` }]);

  await sendMessage(env, chatId, text, rows);
}

export async function sendCategoriesMenu(env, chatId) {
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