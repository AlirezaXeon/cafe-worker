import { getSiteConfig, saveSiteImage, removeSiteImage, setSiteSetting } from '../data/site.js';
import { signToken, requireAdmin } from '../middleware/adminAuth.js';
import {
  newProductId,
  newCategoryId,
  listProducts,
  listCategories,
  countProductsInCategory,
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
import { MAX_UPLOAD_BYTES, MIN_TABLE_COUNT, MAX_TABLE_COUNT } from '../config.js';
import { listOrders, resolveOrder, getSalesStats, getOrdersSummary } from '../data/orders.js';
import { validatePrice, validateDiscount } from '../lib/validate.js';
import { validateImage } from '../lib/images.js';
import { imagePath, imageFilename } from '../data/imagePaths.js';
import { signTable } from '../lib/tableSig.js';
import { deleteBotState, incrementBotState, setBotState } from '../data/botState.js';

// فقط درخواست‌های هم‌دامنه (یا بدون Origin، مثل curl و خود پنل) مجازن.
// قبلاً '*' بود؛ یعنی هر سایتی می‌تونست /admin/api/login رو با IP بازدیدکننده‌های خودش صدا بزنه
// و محدودیت ۵ تلاش per-IP رو روی صدها IP پخش کنه.
function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const sameOrigin = origin === new URL(request.url).origin;
  return sameOrigin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
}

const json = (request, data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request), ...extraHeaders },
  });

// پیام خطای عمومی برای کلاینت؛ جزئیات واقعی فقط تو لاگ سرور می‌مونه (نه تو جواب HTTP)
function serverError(request, e, context) {
  console.error(`[admin:${context}]`, e);
  return json(request, { error: 'خطای داخلی سرور رخ داد. لطفاً دوباره امتحان کنید.' }, 500);
}

// مقایسه‌ی constant-time برای جلوگیری از timing attack روی رمز عبور
import { safeCompare } from '../lib/safeCompare.js';
export { safeCompare };

const IMAGE_PATH_RE = /^\/images\/[\w.-]+\.(jpg|jpeg|png|webp|gif)$/i;

export function validateCategoryLabel(label) {
  if (typeof label !== 'string') return { valid: false, error: 'نام دسته‌بندی اجباری است' };
  const trimmed = label.trim();
  if (!trimmed) return { valid: false, error: 'نام دسته‌بندی اجباری است' };
  if (trimmed.length > 40) return { valid: false, error: 'نام دسته‌بندی نمی‌تواند بیشتر از ۴۰ نویسه باشد' };
  return { valid: true, label: trimmed };
}

// اعتبارسنجی مشترک بین ساخت و ویرایش محصول
export function validateProductBody(b) {
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (!name) return { error: 'نام محصول اجباری است' };
  if (name.length > 80) return { error: 'نام محصول نمی‌تواند بیشتر از ۸۰ نویسه باشد' };
  const note = typeof b?.note === 'string' ? b.note.trim() : (b?.note ? String(b.note).trim() : '');
  if (note.length > 300) return { error: 'یادداشت محصول نمی‌تواند بیشتر از ۳۰۰ نویسه باشد' };
  if (!b?.category) return { error: 'دسته‌بندی اجباری است' };
  const category = String(b.category).trim();
  const priceCheck = validatePrice(b.price);
  if (!priceCheck.valid) return { error: priceCheck.error };
  const discountCheck = validateDiscount(b.discount);
  if (!discountCheck.valid) return { error: discountCheck.error };

  const rawOrigPrice = b.original_price !== undefined ? b.original_price : b.originalPrice;
  let originalPrice = undefined;
  if (rawOrigPrice !== undefined && rawOrigPrice !== null && rawOrigPrice !== '') {
    const origCheck = validatePrice(rawOrigPrice);
    if (!origCheck.valid) return { error: `قیمت اصلی نامعتبر است: ${origCheck.error}` };
    if (origCheck.price <= priceCheck.price) {
      return { error: 'قیمت اصلی باید بیشتر از قیمت با تخفیف باشد' };
    }
    originalPrice = origCheck.price;
  } else if (rawOrigPrice === null) {
    originalPrice = null;
  }

  const image = b?.image ? String(b.image).trim() : null;
  if (image && !IMAGE_PATH_RE.test(image)) return { error: 'مسیر تصویر نامعتبر است' };
  return {
    valid: true,
    name,
    note,
    category,
    price: priceCheck.price,
    discount: discountCheck.discount,
    originalPrice,
    image,
  };
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
      const attempts = await incrementBotState(env, lockKey, 900);
      if (attempts > 15) {
        return json(request, { error: 'تعداد تلاش‌های ناموفق زیاد بود. چند دقیقه دیگر امتحان کنید.' }, 429);
      }

      const delayMs = attempts > 5 ? Math.min(2000, (attempts - 5) * 200) : 0;
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      const { password } = await request.json().catch(() => ({}));
      if (!password || !safeCompare(password, env.ADMIN_PASSWORD)) {
        return json(request, { error: 'رمز عبور اشتباه است' }, 401);
      }

      // ورود موفق؛ شمارنده‌ی تلاش ناموفق برای این IP پاک می‌شود
      await deleteBotState(env, lockKey);
      const token = await signToken(
        { role: 'admin' },
        env.JWT_SECRET,
        env.TOKEN_VERSION || "1"
      );
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `admin_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`,
          ...corsHeaders(request),
        },
      });
    } catch (e) { return serverError(request, e, 'login'); }
  }

  // ── Logout ────────────────────────────────────────────────────────────
  if (path === '/logout' && method === 'POST') {
    try {
      const currentAdmin = await requireAdmin(request, env);
      if (currentAdmin?.jti) {
        const nowSec = Math.floor(Date.now() / 1000);
        const ttl = Math.max(60, (currentAdmin.exp || (nowSec + 43200)) - nowSec);
        await setBotState(env, `revoked:${currentAdmin.jti}`, '1', ttl);
      }
    } catch {}
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'admin_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0',
        ...corsHeaders(request),
      },
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const admin = await requireAdmin(request, env);
  if (!admin) return json(request, { error: 'دسترسی غیرمجاز' }, 401);

  if (path === '/me' && method === 'GET') {
    return json(request, { ok: true, role: admin.role });
  }

  // اعتبارسنجی مشترک آپلود تصویر (13g)
  async function readValidatedImage(req) {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return { error: json(request, { error: 'فایلی ارسال نشده یا نامعتبر است' }, 400) };
    }

    const clientExt = (file.name || '').split('.').pop().toLowerCase();
    if (file.size > MAX_UPLOAD_BYTES)
      return { error: json(request, { error: 'حجم عکس نباید بیشتر از ۲ مگابایت باشد' }, 413) };

    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES)
      return { error: json(request, { error: 'حجم عکس نباید بیشتر از ۲ مگابایت باشد' }, 413) };

    const val = validateImage(buffer, clientExt);
    if (!val.valid) {
      return { error: json(request, { error: val.error }, 400) };
    }

    const ext = val.format === 'jpeg' ? 'jpg' : val.format;
    return { buffer, ext, format: val.format };
  }

  // ── Upload Image ──────────────────────────────────────────────────────
  if (path === '/upload' && method === 'POST') {
    try {
      const imgRes = await readValidatedImage(request);
      if (imgRes.error) return imgRes.error;

      const { buffer, ext, format } = imgRes;
      const filename = `p${Date.now()}.${ext}`;
      await env.PRODUCTS_KV.put(`image:${filename}`, buffer, {
        metadata: {
          contentType: `image/${format}`,
          uploadedAt: Date.now(),
        },
      });
      return json(request, { url: imagePath(filename) });
    } catch (e) { return serverError(request, e, 'upload'); }
  }
  // ── تصاویر سایت (لوگو + عکس بالای سایت) ───────────────────────────────
  if (path === '/site' && method === 'GET') {
    try {
      return json(request, await getSiteConfig(env));
    } catch (e) { return serverError(request, e, 'site:get'); }
  }

  const siteImgMatch = path.match(/^\/site\/(logo|cover)$/);
  if (siteImgMatch) {
    const kind = siteImgMatch[1];

    if (method === 'DELETE') {
      try {
        await removeSiteImage(env, kind);
        return json(request, { success: true });
      } catch (e) { return serverError(request, e, 'site:delete'); }
    }

    if (method === 'POST') {
      try {
        const imgRes = await readValidatedImage(request);
        if (imgRes.error) return imgRes.error;

        const { buffer, ext } = imgRes;
        const url = await saveSiteImage(env, kind, buffer, ext);
        return json(request, { success: true, url: url.startsWith('/') ? url : '/' + url });
      } catch (e) { return serverError(request, e, 'site:post'); }
    }
  }

  // ── تنظیم تعداد میزها ───────────────────────────────────────────────
  if (path === '/site/table-count' && method === 'PUT') {
    try {
      const b = await request.json().catch(() => ({}));
      const count = Number(b.tableCount);
      if (!Number.isInteger(count) || count < MIN_TABLE_COUNT || count > MAX_TABLE_COUNT) {
        return json(request, { error: 'تعداد میز باید یک عدد صحیح بین ۱ تا ۱۰۰ باشد' }, 400);
      }
      await setSiteSetting(env, 'tableCount', count);
      return json(request, { success: true, tableCount: count });
    } catch (e) { return serverError(request, e, 'site:table-count'); }
  }

  // ── فروش (فقط سفارش‌های تایید‌شده) ────────────────────────────────────
  if (path === '/sales-stats' && method === 'GET') {
    try {
      return json(request, await getSalesStats(env));
    } catch (e) { return serverError(request, e, 'sales-stats'); }
  }

  // ── لینک‌های QR میزها با امضای معتبر ───────────────────────────────────
  if (path === '/table-qr-links' && method === 'GET') {
    try {
      const siteCfg = await getSiteConfig(env);
      const tableCount = siteCfg.tableCount ?? 20;
      const secret = env.TABLE_SIGNING_SECRET || '';
      const links = [];
      for (let i = 1; i <= tableCount; i++) {
        const sig = secret ? await signTable(i, secret) : '';
        const query = sig ? `?t=${i}&sig=${sig}` : `?t=${i}`;
        links.push({ table: i, sig, query, url: `/?t=${i}${sig ? `&sig=${sig}` : ''}` });
      }
      return json(request, { ok: true, tableCount, signingEnabled: Boolean(secret), links });
    } catch (e) { return serverError(request, e, 'table-qr-links'); }
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
        const b = await request.json().catch(() => ({}));
        const catCheck = validateCategoryLabel(b?.label);
        if (!catCheck.valid) return json(request, { error: catCheck.error }, 400);
        const image = b?.image ? String(b.image).trim() : null;
        if (image && !IMAGE_PATH_RE.test(image)) return json(request, { error: 'مسیر تصویر نامعتبر است' }, 400);
        const id = newCategoryId();
        await addCategory(env, id, catCheck.label, image);
        return json(request, { success: true, id }, 201);
      } catch (e) { return serverError(request, e, 'categories:post'); }
    }
  }

  const catMatch = path.match(/^\/categories\/(.+)$/);
  if (catMatch) {
    const id = decodeURIComponent(catMatch[1]);

    if (method === 'DELETE') {
      try {
        const cat = await findCategory(env, id);
        if (!cat) return json(request, { error: 'دسته‌بندی پیدا نشد' }, 404);

        const used = await countProductsInCategory(env, id);
        if (used > 0)
          return json(request, { error: `این دسته‌بندی ${used} محصول دارد. ابتدا محصولات را جابجا کنید.` }, 400);

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
        const b = await request.json().catch(() => ({}));
        const catCheck = validateCategoryLabel(b?.label);
        if (!catCheck.valid) return json(request, { error: catCheck.error }, 400);
        const image = b?.image ? String(b.image).trim() : null;
        if (image && !IMAGE_PATH_RE.test(image)) return json(request, { error: 'مسیر تصویر نامعتبر است' }, 400);
        const old = await findCategory(env, id);
        if (!old) return json(request, { error: 'دسته‌بندی پیدا نشد' }, 404);
        await updateCategory(env, id, catCheck.label, image);
        const oldFilename = imageFilename(old?.image);
        const newFilename = imageFilename(b?.image);
        if (oldFilename && oldFilename !== newFilename) {
          await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
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
        const b = await request.json().catch(() => ({}));
        const check = validateProductBody(b);
        if (check.error) return json(request, { error: check.error }, 400);

        const cat = await findCategory(env, check.category);
        if (!cat) return json(request, { error: 'دسته‌بندی انتخاب‌شده وجود ندارد' }, 400);

        const id = newProductId();
        const available = b.available === undefined ? 1 : (b.available ? 1 : 0);
        // price که از پنل میاد «قیمت پایه» است؛ محاسبه‌ی تخفیف تو لایه‌ی داده انجام میشه
        await addProduct(env, {
          id,
          category: check.category,
          name: check.name,
          note: check.note,
          price: check.price,
          discount: check.discount,
          image: check.image,
          available,
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
        const b = await request.json().catch(() => ({}));
        const check = validateProductBody(b);
        if (check.error) return json(request, { error: check.error }, 400);

        const old = await findProduct(env, id);
        if (!old) return json(request, { error: 'محصول پیدا نشد' }, 404);

        const cat = await findCategory(env, check.category);
        if (!cat) return json(request, { error: 'دسته‌بندی انتخاب‌شده وجود ندارد' }, 400);

        const available = b.available === undefined ? (old.available ? 1 : 0) : (b.available ? 1 : 0);
        await updateProduct(env, id, {
          category: check.category,
          name: check.name,
          note: check.note,
          price: check.price,
          discount: check.discount,
          originalPrice: check.originalPrice,
          image: check.image,
          available,
        });
        const oldFilename = imageFilename(old?.image);
        const newFilename = imageFilename(check.image);
        if (oldFilename && oldFilename !== newFilename) {
          await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json(request, { success: true });
      } catch (e) { return serverError(request, e, 'products:put'); }
    }

    if (method === 'DELETE') {
      try {
        const prod = await findProduct(env, id);
        if (!prod) return json(request, { error: 'محصول پیدا نشد' }, 404);
        await deleteProduct(env, id);
        if (prod?.image) {
          const oldFilename = prod.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json(request, { success: true });
      } catch (e) { return serverError(request, e, 'products:delete'); }
    }
  }

  // ── Orders (سفارش‌های ثبت‌شده از سایت) ───────────────────────────────────
  if (path === '/orders/summary' && method === 'GET') {
    try {
      const summary = await getOrdersSummary(env);
      return json(request, summary, 200, { 'Cache-Control': 'no-store' });
    } catch (e) { return serverError(request, e, 'orders:summary'); }
  }

  if (path === '/orders' && method === 'GET') {
    try {
      const status = url.searchParams.get('status') || undefined;
      const beforeId = url.searchParams.get('before_id') || url.searchParams.get('beforeId') || undefined;
      const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 50;
      return json(request, await listOrders(env, { status, beforeId, limit }));
    } catch (e) { return serverError(request, e, 'orders:get'); }
  }

  const orderMatch = path.match(/^\/orders\/(\d+)$/);
  if (orderMatch && method === 'PATCH') {
    try {
      const id = Number(orderMatch[1]);
      const { status } = await request.json().catch(() => ({}));
      if (status !== 'confirmed' && status !== 'rejected')
        return json(request, { error: 'وضعیت نامعتبر است' }, 400);

      const updated = await resolveOrder(env, id, status, 'پنل وب');
      if (!updated)
        return json(request, { error: 'این سفارش قبلاً بررسی شده یا وجود ندارد' }, 409);
      return json(request, { success: true });
    } catch (e) { return serverError(request, e, 'orders:patch'); }
  }

  return json(request, { error: 'مسیر پیدا نشد' }, 404);
}