import { signToken, requireAdmin } from '../middleware/adminAuth.js';
import {
  newProductId,
  newCategoryId,
  listProducts,
  listCategories,
  countProductsInCategory,
  getStats,
  findProduct,
  findCategory,
  addProduct,
  updateProduct,
  deleteProduct,
  addCategory,
  updateCategory,
  deleteCategory,
  toggleProductAvailability,
} from '../data/products.js';

// سقف حجم عکس آپلودی. سقف خود KV روی ۲۵ مگه، ولی برای عکس منو حتی ۲ مگ هم زیاده؛
// بدون این سقف یه فایل بزرگ یا با خطای مبهم fail می‌شد یا سایت رو سنگین می‌کرد.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

// فقط درخواست‌های هم‌دامنه (یا بدون Origin، مثل curl و خود پنل) مجازن.
// قبلاً '*' بود؛ یعنی هر سایتی می‌تونست /admin/api/login رو با IP بازدیدکننده‌های خودش صدا بزنه
// و محدودیت ۵ تلاش per-IP رو روی صدها IP پخش کنه.
function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const sameOrigin = origin === new URL(request.url).origin;
  return sameOrigin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
}

const json = (request, data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  });

// پیام خطای عمومی برای کلاینت؛ جزئیات واقعی فقط تو لاگ سرور می‌مونه (نه تو جواب HTTP)
function serverError(request, e, context) {
  console.error(`[admin:${context}]`, e);
  return json(request, { error: 'خطای داخلی سرور رخ داد. لطفاً دوباره امتحان کنید.' }, 500);
}

// مقایسه‌ی constant-time برای جلوگیری از timing attack روی رمز عبور
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const maxLen = Math.max(a.length, b.length, 32);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// اعتبارسنجی مشترک بین ساخت و ویرایش محصول
function validateProductBody(b) {
  if (!b?.name?.trim()) return 'نام محصول اجباری است';
  if (!b.category) return 'دسته‌بندی اجباری است';
  const price = Number(b.price);
  if (!price || !Number.isFinite(price) || price <= 0) return 'قیمت باید یک عدد مثبت باشد';
  const discount = Number(b.discount || 0);
  if (!Number.isFinite(discount) || discount < 0 || discount >= 100)
    return 'درصد تخفیف باید بین ۰ تا ۹۹ باشد';
  return null;
}

export async function handleAdminAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin\/api/, '') || '/';
  const method = request.method;

  if (method === 'OPTIONS') {
    const cors = corsHeaders(request);
    // اگه Origin غیرمجاز بود، هدر CORS برنمی‌گرده و مرورگر خودش جلوی درخواست رو می‌گیره
    return new Response(null, {
      headers: Object.keys(cors).length
        ? {
          ...cors,
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Max-Age': '86400',
        }
        : {},
    });
  }

  // ── گارد تنظیمات ──────────────────────────────────────────────────────
  // بدون این چک، اگه سکرت‌ها ست نشده باشن importKey با کلید صفر-طول استثنا می‌داد
  // و کاربر فقط یه ۵۰۰ مبهم می‌دید. حالا دلیلش تو لاگ مشخصه.
  if (!env.JWT_SECRET || !env.ADMIN_PASSWORD) {
    console.error('[admin:config] JWT_SECRET یا ADMIN_PASSWORD تنظیم نشده');
    return json(request, { error: 'پنل مدیریت هنوز پیکربندی نشده است.' }, 503);
  }

  // ── Login ─────────────────────────────────────────────────────────────
  if (path === '/login' && method === 'POST') {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const lockKey = `loginfail:${ip}`;
      const failCountRaw = await env.PRODUCTS_KV.get(lockKey);
      const failCount = failCountRaw ? Number(failCountRaw) : 0;
      if (failCount >= 5) {
        return json(request, { error: 'تعداد تلاش‌های ناموفق زیاد بود. چند دقیقه دیگه امتحان کن.' }, 429);
      }

      const { password } = await request.json().catch(() => ({}));
      if (!password || !safeCompare(password, env.ADMIN_PASSWORD)) {
        // شمارنده‌ی تلاش ناموفق؛ بعد از ۱۵ دقیقه خودش پاک میشه (expirationTtl)
        await env.PRODUCTS_KV.put(lockKey, String(failCount + 1), { expirationTtl: 900 });
        return json(request, { error: 'رمز عبور اشتباه است' }, 401);
      }

      // ورود موفق؛ شمارنده‌ی تلاش ناموفق این IP رو پاک می‌کنیم
      await env.PRODUCTS_KV.delete(lockKey);
      const token = await signToken(
        { role: 'admin', exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
        env.JWT_SECRET
      );
      return json(request, { token });
    } catch (e) { return serverError(request, e, 'login'); }
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const admin = await requireAdmin(request, env);
  if (!admin) return json(request, { error: 'دسترسی غیرمجاز' }, 401);

  // ── Upload Image ──────────────────────────────────────────────────────
  if (path === '/upload' && method === 'POST') {
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return json(request, { error: 'فایلی ارسال نشده' }, 400);

      const ext = file.name.split('.').pop().toLowerCase();
      if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext))
        return json(request, { error: 'فرمت فایل مجاز نیست' }, 400);

      if (file.size > MAX_UPLOAD_BYTES)
        return json(request, { error: 'حجم عکس نباید بیشتر از ۲ مگابایت باشد' }, 413);

      const buffer = await file.arrayBuffer();
      // حجم واقعی رو هم بعد از خوندن چک می‌کنیم، نه فقط چیزی که کلاینت ادعا کرده
      if (buffer.byteLength > MAX_UPLOAD_BYTES)
        return json(request, { error: 'حجم عکس نباید بیشتر از ۲ مگابایت باشد' }, 413);

      const filename = `p${Date.now()}.${ext}`;
      await env.PRODUCTS_KV.put(`image:${filename}`, buffer);
      return json(request, { url: `/images/${filename}` });
    } catch (e) { return serverError(request, e, 'upload'); }
  }

  // ── Stats ─────────────────────────────────────────────────────────────
  if (path === '/stats' && method === 'GET') {
    try {
      return json(request, await getStats(env));
    } catch (e) { return serverError(request, e, 'stats'); }
  }

  // ── Categories ────────────────────────────────────────────────────────
  if (path === '/categories') {
    if (method === 'GET') {
      try {
        return json(request, await listCategories(env));
      } catch (e) { return serverError(request, e, 'categories:get'); }
    }
    if (method === 'POST') {
      try {
        const b = await request.json();
        if (!b.label?.trim()) return json(request, { error: 'نام دسته‌بندی اجباری است' }, 400);
        const id = newCategoryId();
        await addCategory(env, id, b.label.trim(), b.image || null);
        return json(request, { success: true, id }, 201);
      } catch (e) { return serverError(request, e, 'categories:post'); }
    }
  }

  const catMatch = path.match(/^\/categories\/(.+)$/);
  if (catMatch) {
    const id = decodeURIComponent(catMatch[1]);

    if (method === 'DELETE') {
      try {
        // اگه محصولی با این کتگوری داره، اجازه حذف نمیدیم
        // (products.category همیشه آیدی دسته رو نگه می‌داره، نه برچسبش)
        const used = await countProductsInCategory(env, id);
        if (used > 0)
          return json(request, { error: `این دسته‌بندی ${used} محصول دارد. ابتدا محصولات را جابجا کنید.` }, 400);

        const cat = await findCategory(env, id);
        await deleteCategory(env, id);
        if (cat?.image) {
          const oldFilename = cat.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json(request, { success: true });
      } catch (e) { return serverError(request, e, 'categories:delete'); }
    }

    if (method === 'PUT') {
      try {
        const b = await request.json();
        if (!b.label?.trim()) return json(request, { error: 'نام دسته‌بندی اجباری است' }, 400);
        const old = await findCategory(env, id);
        await updateCategory(env, id, b.label.trim(), b.image || null);
        if (old?.image && old.image !== b.image) {
          const oldFilename = old.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json(request, { success: true });
      } catch (e) { return serverError(request, e, 'categories:put'); }
    }
  }

  // ── Products ──────────────────────────────────────────────────────────
  if (path === '/products') {
    if (method === 'GET') {
      try {
        return json(request, await listProducts(env));
      } catch (e) { return serverError(request, e, 'products:get'); }
    }

    if (method === 'POST') {
      try {
        const b = await request.json();
        const invalid = validateProductBody(b);
        if (invalid) return json(request, { error: invalid }, 400);

        const id = newProductId();
        // price که از پنل میاد «قیمت پایه» است؛ محاسبه‌ی تخفیف تو لایه‌ی داده انجام میشه
        await addProduct(env, {
          id,
          category: b.category,
          name: b.name.trim(),
          note: b.note || '',
          price: Number(b.price),
          discount: Number(b.discount || 0),
          image: b.image || null,
          available: b.available ? 1 : 0,
        });
        return json(request, { success: true, id }, 201);
      } catch (e) { return serverError(request, e, 'products:post'); }
    }
  }

  // ── فقط تغییر وضعیت موجودی ────────────────────────────────────────────
  // اندپوینت جدا لازم بود: قبلاً برای toggle کل محصول با PUT فرستاده می‌شد و درصد تخفیف
  // از روی قیمت‌ها بازسازی (و گرد) می‌شد، برای همین هر بار toggle قیمت اصلی چند تومن جابه‌جا می‌شد.
  const availMatch = path.match(/^\/products\/(.+)\/availability$/);
  if (availMatch && method === 'PATCH') {
    try {
      const id = decodeURIComponent(availMatch[1]);
      const next = await toggleProductAvailability(env, id);
      if (next === null) return json(request, { error: 'محصول پیدا نشد' }, 404);
      return json(request, { success: true, available: next });
    } catch (e) { return serverError(request, e, 'products:availability'); }
  }

  const prodMatch = path.match(/^\/products\/(.+)$/);
  if (prodMatch) {
    const id = decodeURIComponent(prodMatch[1]);

    if (method === 'PUT') {
      try {
        const b = await request.json();
        const invalid = validateProductBody(b);
        if (invalid) return json(request, { error: invalid }, 400);

        const old = await findProduct(env, id);
        if (!old) return json(request, { error: 'محصول پیدا نشد' }, 404);

        await updateProduct(env, id, {
          category: b.category,
          name: b.name.trim(),
          note: b.note || '',
          price: Number(b.price),
          discount: Number(b.discount || 0),
          image: b.image || null,
          available: b.available ? 1 : 0,
        });
        if (old.image && old.image !== b.image) {
          const oldFilename = old.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json(request, { success: true });
      } catch (e) { return serverError(request, e, 'products:put'); }
    }

    if (method === 'DELETE') {
      try {
        const prod = await findProduct(env, id);
        await deleteProduct(env, id);
        if (prod?.image) {
          const oldFilename = prod.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json(request, { success: true });
      } catch (e) { return serverError(request, e, 'products:delete'); }
    }
  }

  return json(request, { error: 'مسیر پیدا نشد' }, 404);
}