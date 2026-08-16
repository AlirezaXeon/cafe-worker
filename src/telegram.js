// ============ بات تلگرام مدیریت محصولات (نسخه‌ی دکمه‌ای) ============
// این فایل مسئول پردازش پیام‌ها و کلیک‌های دکمه از تلگرام (webhook) و
// تعامل با D1 (محصولات) و KV (وضعیت مکالمه‌ی هر کاربر) هست.

const TELEGRAM_API = "https://api.telegram.org/bot";
const STATE_TTL_SECONDS = 60 * 30; // وضعیت ناتمام بعد از ۳۰ دقیقه بی‌استفاده پاک می‌شه

// ============ ابزارهای پایه‌ی تلگرام ============

async function tgCall(env, method, payload) {
  const url = `${TELEGRAM_API}${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function sendMessage(env, chatId, text, keyboard) {
  return tgCall(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

function editMessage(env, chatId, messageId, text, keyboard) {
  return tgCall(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

function answerCallback(env, callbackQueryId, text) {
  return tgCall(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

function isAuthorized(env, chatId) {
  const allowed = (env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(String(chatId));
}

function formatPrice(price) {
  return Number(price).toLocaleString("fa-IR") + " تومان";
}

// ============ مدیریت وضعیت مکالمه (KV) ============

function stateKey(chatId) {
  return `state:${chatId}`;
}

async function getState(env, chatId) {
  const raw = await env.BOT_STATE.get(stateKey(chatId));
  return raw ? JSON.parse(raw) : null;
}

async function setState(env, chatId, state) {
  await env.BOT_STATE.put(stateKey(chatId), JSON.stringify(state), {
    expirationTtl: STATE_TTL_SECONDS,
  });
}

async function clearState(env, chatId) {
  await env.BOT_STATE.delete(stateKey(chatId));
}

// ============ کیبوردهای شیشه‌ای (Inline Keyboards) ============

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📦 محصولات", callback_data: "menu:products" }],
      [{ text: "➕ افزودن محصول", callback_data: "menu:add" }],
      [{ text: "🏷 دسته‌بندی‌ها", callback_data: "menu:categories" }],
    ],
  };
}

function backToMainKeyboard() {
  return {
    inline_keyboard: [[{ text: "🔙 منوی اصلی", callback_data: "menu:main" }]],
  };
}

function productListKeyboard(products) {
  const rows = products.map((p) => [
    { text: `${p.name} — ${formatPrice(p.price)}`, callback_data: `product:view:${p.id}` },
  ]);
  rows.push([{ text: "🔙 منوی اصلی", callback_data: "menu:main" }]);
  return { inline_keyboard: rows };
}

function productDetailKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: "✏️ ویرایش", callback_data: `product:edit:${id}` },
        { text: "🗑 حذف", callback_data: `product:delete:${id}` },
      ],
      [{ text: "🔙 لیست محصولات", callback_data: "menu:products" }],
    ],
  };
}

function editFieldKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: "نام", callback_data: `editfield:${id}:name` },
        { text: "قیمت", callback_data: `editfield:${id}:price` },
      ],
      [
        { text: "یادداشت", callback_data: `editfield:${id}:note` },
        { text: "دسته‌بندی", callback_data: `editfield:${id}:category` },
      ],
      [{ text: "عکس", callback_data: `editfield:${id}:image` }],
      [{ text: "🔙 انصراف", callback_data: `product:view:${id}` }],
    ],
  };
}

function categoryPickerKeyboard(categories, prefix) {
  const rows = categories.map((c) => [{ text: c.label, callback_data: `${prefix}:${c.id}` }]);
  rows.push([{ text: "🔙 انصراف", callback_data: "menu:main" }]);
  return { inline_keyboard: rows };
}

function confirmDeleteKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: "✅ بله، حذف شود", callback_data: `product:confirmdelete:${id}` },
        { text: "❌ انصراف", callback_data: `product:view:${id}` },
      ],
    ],
  };
}

function skipOrCancelKeyboard(skipData) {
  return {
    inline_keyboard: [
      [{ text: "رد کردن ⏭", callback_data: skipData }],
      [{ text: "❌ انصراف", callback_data: "menu:main" }],
    ],
  };
}

// ============ دسترسی به دیتابیس ============

async function fetchProducts(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, category, name, note, price, image FROM products ORDER BY category, id"
  ).all();
  return results;
}

async function fetchCategories(env) {
  const { results } = await env.DB.prepare("SELECT id, label FROM categories").all();
  return results;
}

async function fetchProduct(env, id) {
  return env.DB.prepare(
    "SELECT id, category, name, note, price, image FROM products WHERE id = ?"
  )
    .bind(id)
    .first();
}

async function categoryLabel(env, categoryId) {
  const cat = await env.DB.prepare("SELECT label FROM categories WHERE id = ?")
    .bind(categoryId)
    .first();
  return cat ? cat.label : categoryId;
}

// ============ رندر پیام‌ها ============

async function renderMainMenu(env, chatId, messageId) {
  const text = "به پنل مدیریت محصولات خوش اومدی 👋\nیکی از گزینه‌ها رو انتخاب کن:";
  const kb = mainMenuKeyboard();
  if (messageId) await editMessage(env, chatId, messageId, text, kb);
  else await sendMessage(env, chatId, text, kb);
}

async function renderProductList(env, chatId, messageId) {
  const products = await fetchProducts(env);
  if (!products.length) {
    const text = "هنوز محصولی ثبت نشده.";
    const kb = backToMainKeyboard();
    if (messageId) await editMessage(env, chatId, messageId, text, kb);
    else await sendMessage(env, chatId, text, kb);
    return;
  }
  const text = "📦 روی هر محصول بزن تا جزئیات و گزینه‌های ویرایش/حذف رو ببینی:";
  const kb = productListKeyboard(products);
  if (messageId) await editMessage(env, chatId, messageId, text, kb);
  else await sendMessage(env, chatId, text, kb);
}

async function renderCategories(env, chatId, messageId) {
  const categories = await fetchCategories(env);
  const text = categories.length
    ? "🏷 دسته‌بندی‌های موجود:\n\n" +
      categories.map((c) => `<code>${c.id}</code> — ${c.label}`).join("\n")
    : "هیچ دسته‌بندی‌ای ثبت نشده.";
  const kb = backToMainKeyboard();
  if (messageId) await editMessage(env, chatId, messageId, text, kb);
  else await sendMessage(env, chatId, text, kb);
}

async function renderProductDetail(env, chatId, messageId, id) {
  const p = await fetchProduct(env, id);
  if (!p) {
    await editMessage(env, chatId, messageId, "این محصول دیگه وجود نداره.", backToMainKeyboard());
    return;
  }
  const catLabel = await categoryLabel(env, p.category);
  const text = [
    `<b>${p.name}</b>`,
    `دسته‌بندی: ${catLabel}`,
    p.note ? `یادداشت: ${p.note}` : null,
    `قیمت: ${formatPrice(p.price)}`,
    p.image ? `عکس: <code>${p.image}</code>` : "عکس: ثبت نشده",
  ]
    .filter(Boolean)
    .join("\n");
  await editMessage(env, chatId, messageId, text, productDetailKeyboard(id));
}

// ============ جریان «افزودن محصول» (مرحله‌به‌مرحله) ============

async function startAddFlow(env, chatId, messageId) {
  await setState(env, chatId, { flow: "add", step: "name", data: {} });
  await editMessage(
    env,
    chatId,
    messageId,
    "بیا محصول جدید رو اضافه کنیم.\n\nاول: <b>اسم محصول</b> رو بفرست.",
    { inline_keyboard: [[{ text: "❌ انصراف", callback_data: "menu:main" }]] }
  );
}

async function handleAddFlowText(env, chatId, state, text) {
  const { data } = state;

  if (state.step === "name") {
    data.name = text;
    state.step = "category";
    await setState(env, chatId, state);
    const categories = await fetchCategories(env);
    await sendMessage(env, chatId, "دسته‌بندی رو انتخاب کن:", categoryPickerKeyboard(categories, "addcat"));
    return;
  }

  if (state.step === "note") {
    data.note = text;
    state.step = "price";
    await setState(env, chatId, state);
    await sendMessage(env, chatId, "قیمت رو به تومان بفرست (فقط عدد، مثلاً 95000):", {
      inline_keyboard: [[{ text: "❌ انصراف", callback_data: "menu:main" }]],
    });
    return;
  }

  if (state.step === "price") {
    const price = parseInt(text.replace(/[^\d]/g, ""), 10);
    if (isNaN(price) || price <= 0) {
      await sendMessage(env, chatId, "قیمت باید یه عدد معتبر باشه. دوباره بفرست:");
      return;
    }
    data.price = price;
    state.step = "image";
    await setState(env, chatId, state);
    await sendMessage(
      env,
      chatId,
      "مسیر عکس محصول رو بفرست (مثلاً images/products/latte.jpg)\nیا رد کن:",
      skipOrCancelKeyboard("addimg:skip")
    );
    return;
  }

  if (state.step === "image") {
    data.image = text;
    await finalizeAddProduct(env, chatId, data);
    return;
  }
}

async function finalizeAddProduct(env, chatId, data) {
  const id = "p" + Date.now().toString(36);
  await env.DB.prepare(
    "INSERT INTO products (id, category, name, note, price, image) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, data.category, data.name, data.note || "", data.price, data.image || "")
    .run();

  await clearState(env, chatId);

  const catLabel = await categoryLabel(env, data.category);
  const text = [
    "✅ محصول با موفقیت اضافه شد!",
    "",
    `<b>${data.name}</b>`,
    `دسته‌بندی: ${catLabel}`,
    data.note ? `یادداشت: ${data.note}` : null,
    `قیمت: ${formatPrice(data.price)}`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendMessage(env, chatId, text, mainMenuKeyboard());
}

// ============ جریان «ویرایش محصول» ============

async function startEditFlow(env, chatId, messageId, id, field) {
  const p = await fetchProduct(env, id);
  if (!p) {
    await editMessage(env, chatId, messageId, "این محصول دیگه وجود نداره.", backToMainKeyboard());
    return;
  }

  if (field === "category") {
    const categories = await fetchCategories(env);
    await editMessage(env, chatId, messageId, "دسته‌بندی جدید رو انتخاب کن:", categoryPickerKeyboard(categories, `editcat:${id}`));
    return;
  }

  await setState(env, chatId, { flow: "edit", productId: id, field });

  const fieldLabels = { name: "اسم جدید", price: "قیمت جدید (فقط عدد)", note: "یادداشت جدید", image: "مسیر عکس جدید" };
  await editMessage(
    env,
    chatId,
    messageId,
    `${fieldLabels[field]} رو بفرست:`,
    { inline_keyboard: [[{ text: "❌ انصراف", callback_data: `product:view:${id}` }]] }
  );
}

async function handleEditFlowText(env, chatId, state, text) {
  const { productId, field } = state;
  let value = text;

  if (field === "price") {
    const price = parseInt(text.replace(/[^\d]/g, ""), 10);
    if (isNaN(price) || price <= 0) {
      await sendMessage(env, chatId, "قیمت باید یه عدد معتبر باشه. دوباره بفرست:");
      return;
    }
    value = price;
  }

  await env.DB.prepare(`UPDATE products SET ${field} = ? WHERE id = ?`).bind(value, productId).run();
  await clearState(env, chatId);

  await sendMessage(env, chatId, "✅ محصول ویرایش شد.");
  const p = await fetchProduct(env, productId);
  if (p) {
    const catLabel = await categoryLabel(env, p.category);
    const text2 = [
      `<b>${p.name}</b>`,
      `دسته‌بندی: ${catLabel}`,
      p.note ? `یادداشت: ${p.note}` : null,
      `قیمت: ${formatPrice(p.price)}`,
      p.image ? `عکس: <code>${p.image}</code>` : "عکس: ثبت نشده",
    ]
      .filter(Boolean)
      .join("\n");
    await sendMessage(env, chatId, text2, productDetailKeyboard(productId));
  }
}

// ============ هندلر اصلی پیام‌های متنی ============

async function handleTextMessage(env, chatId, text) {
  if (text === "/start" || text === "/help") {
    await clearState(env, chatId);
    await renderMainMenu(env, chatId, null);
    return;
  }

  const state = await getState(env, chatId);
  if (!state) {
    await sendMessage(env, chatId, "برای شروع /start رو بفرست.", mainMenuKeyboard());
    return;
  }

  if (state.flow === "add") {
    await handleAddFlowText(env, chatId, state, text);
  } else if (state.flow === "edit") {
    await handleEditFlowText(env, chatId, state, text);
  }
}

// ============ هندلر اصلی کلیک روی دکمه‌ها (callback_query) ============

async function handleCallbackQuery(env, callback) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const data = callback.data;

  await answerCallback(env, callback.id, "");

  if (data === "menu:main") {
    await clearState(env, chatId);
    await renderMainMenu(env, chatId, messageId);
    return;
  }

  if (data === "menu:products") {
    await clearState(env, chatId);
    await renderProductList(env, chatId, messageId);
    return;
  }

  if (data === "menu:categories") {
    await clearState(env, chatId);
    await renderCategories(env, chatId, messageId);
    return;
  }

  if (data === "menu:add") {
    await startAddFlow(env, chatId, messageId);
    return;
  }

  if (data.startsWith("product:view:")) {
    const id = data.split(":")[2];
    await clearState(env, chatId);
    await renderProductDetail(env, chatId, messageId, id);
    return;
  }

  if (data.startsWith("product:edit:")) {
    const id = data.split(":")[2];
    await editMessage(env, chatId, messageId, "کدوم فیلد رو می‌خوای ویرایش کنی؟", editFieldKeyboard(id));
    return;
  }

  if (data.startsWith("product:delete:")) {
    const id = data.split(":")[2];
    const p = await fetchProduct(env, id);
    if (!p) {
      await editMessage(env, chatId, messageId, "این محصول دیگه وجود نداره.", backToMainKeyboard());
      return;
    }
    await editMessage(
      env,
      chatId,
      messageId,
      `مطمئنی می‌خوای «${p.name}» رو حذف کنی؟`,
      confirmDeleteKeyboard(id)
    );
    return;
  }

  if (data.startsWith("product:confirmdelete:")) {
    const id = data.split(":")[2];
    const p = await fetchProduct(env, id);
    await env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
    await editMessage(
      env,
      chatId,
      messageId,
      `🗑 محصول «${p ? p.name : id}» حذف شد.`,
      backToMainKeyboard()
    );
    return;
  }

  if (data.startsWith("editfield:")) {
    const [, id, field] = data.split(":");
    await startEditFlow(env, chatId, messageId, id, field);
    return;
  }

  if (data.startsWith("editcat:")) {
    // فرمت: editcat:<productId>:<newCategoryId>
    const parts = data.split(":");
    const productId = parts[1];
    const newCategory = parts[2];
    await env.DB.prepare("UPDATE products SET category = ? WHERE id = ?")
      .bind(newCategory, productId)
      .run();
    await renderProductDetail(env, chatId, messageId, productId);
    return;
  }

  if (data.startsWith("addcat:")) {
    // فرمت: addcat:<categoryId>  — انتخاب دسته حین جریان افزودن محصول
    const categoryId = data.split(":")[1];
    const state = await getState(env, chatId);
    if (!state || state.flow !== "add") {
      await renderMainMenu(env, chatId, messageId);
      return;
    }
    state.data.category = categoryId;
    state.step = "note";
    await setState(env, chatId, state);
    await editMessage(
      env,
      chatId,
      messageId,
      "یادداشت کوتاه محصول رو بفرست (مثلاً «دان برزیل، تلخی متعادل»)\nیا رد کن:",
      skipOrCancelKeyboard("addnote:skip")
    );
    return;
  }

  if (data === "addnote:skip") {
    const state = await getState(env, chatId);
    if (!state || state.flow !== "add") return;
    state.data.note = "";
    state.step = "price";
    await setState(env, chatId, state);
    await editMessage(env, chatId, messageId, "قیمت رو به تومان بفرست (فقط عدد، مثلاً 95000):", {
      inline_keyboard: [[{ text: "❌ انصراف", callback_data: "menu:main" }]],
    });
    return;
  }

  if (data === "addimg:skip") {
    const state = await getState(env, chatId);
    if (!state || state.flow !== "add") return;
    state.data.image = "";
    await finalizeAddProduct(env, chatId, state.data);
    return;
  }
}

// ============ ورودی اصلی وبهوک ============

export async function handleTelegramUpdate(request, env) {
  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!chatId) return new Response("ok");

  if (!isAuthorized(env, chatId)) {
    if (update.message) {
      await sendMessage(env, chatId, "⛔️ شما اجازه دسترسی به این بات رو ندارید.");
    } else if (update.callback_query) {
      await answerCallback(env, update.callback_query.id, "⛔️ دسترسی ندارید");
    }
    return new Response("ok");
  }

  try {
    if (update.callback_query) {
      await handleCallbackQuery(env, update.callback_query);
    } else if (update.message && update.message.text) {
      await handleTextMessage(env, chatId, update.message.text.trim());
    }
  } catch (err) {
    await sendMessage(env, chatId, `خطا: ${err.message}`);
  }

  return new Response("ok");
}
