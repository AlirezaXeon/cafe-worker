import { signToken, requireAdmin } from '../middleware/adminAuth.js';
import { nextProductId } from '../data/products.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

// پیام خطای عمومی برای کلاینت؛ جزئیات واقعی فقط تو لاگ سرور می‌مونه (نه تو جواب HTTP)
function serverError(e, context) {
  console.error(`[admin:${context}]`, e);
  return json({ error: 'خطای داخلی سرور رخ داد. لطفاً دوباره امتحان کنید.' }, 500);
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

export async function handleAdminAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin\/api/, '') || '/';
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      }
    });
  }

  // ── Login ─────────────────────────────────────────────────────────────
  if (path === '/login' && method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const lockKey = `loginfail:${ip}`;
    const failCountRaw = await env.PRODUCTS_KV.get(lockKey);
    const failCount = failCountRaw ? Number(failCountRaw) : 0;
    if (failCount >= 5) {
      return json({ error: 'تعداد تلاش‌های ناموفق زیاد بود. چند دقیقه دیگه امتحان کن.' }, 429);
    }

    const { password } = await request.json().catch(() => ({}));
    if (!password || !safeCompare(password, env.ADMIN_PASSWORD)) {
      // شمارنده‌ی تلاش ناموفق؛ بعد از ۱۵ دقیقه خودش پاک میشه (expirationTtl)
      await env.PRODUCTS_KV.put(lockKey, String(failCount + 1), { expirationTtl: 900 });
      return json({ error: 'رمز عبور اشتباه است' }, 401);
    }

    // ورود موفق؛ شمارنده‌ی تلاش ناموفق این IP رو پاک می‌کنیم
    await env.PRODUCTS_KV.delete(lockKey);
    const token = await signToken(
      { role: 'admin', exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
      env.JWT_SECRET
    );
    return json({ token });
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'دسترسی غیرمجاز' }, 401);

  // ── Upload Image ──────────────────────────────────────────────────────
  if (path === '/upload' && method === 'POST') {
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return json({ error: 'فایلی ارسال نشده' }, 400);
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext))
        return json({ error: 'فرمت فایل مجاز نیست' }, 400);
      const filename = `p${Date.now()}.${ext}`;
      await env.PRODUCTS_KV.put(`image:${filename}`, await file.arrayBuffer());
      return json({ url: `/images/${filename}` });
    } catch (e) { return serverError(e, 'upload'); }
  }

  // ── Stats ─────────────────────────────────────────────────────────────
  if (path === '/stats' && method === 'GET') {
    try {
      const [total, avail, cats] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as c FROM products').first(),
        env.DB.prepare('SELECT COUNT(*) as c FROM products WHERE available=1').first(),
        env.DB.prepare('SELECT COUNT(*) as c FROM categories').first(),
      ]);
      return json({
        totalProducts: total?.c ?? 0,
        availableProducts: avail?.c ?? 0,
        totalCategories: cats?.c ?? 0,
      });
    } catch (e) { return serverError(e, 'stats'); }
  }

  // ── Categories ────────────────────────────────────────────────────────
  if (path === '/categories') {
    if (method === 'GET') {
      try {
        const { results } = await env.DB.prepare('SELECT * FROM categories ORDER BY label').all();
        return json(results);
      } catch (e) { return serverError(e, 'categories:get'); }
    }
    if (method === 'POST') {
      try {
        const b = await request.json();
        if (!b.label) return json({ error: 'نام دسته‌بندی اجباری است' }, 400);
        const id = `cat${Date.now()}`;
        await env.DB
          .prepare('INSERT INTO categories (id, label, image) VALUES (?, ?, ?)')
          .bind(id, b.label.trim(), b.image || '')
          .run();
        return json({ success: true, id }, 201);
      } catch (e) { return serverError(e, 'categories:post'); }
    }
  }

  const catMatch = path.match(/^\/categories\/(.+)$/);
  if (catMatch) {
    const id = catMatch[1];
    if (method === 'DELETE') {
      try {
        // اگه محصولی با این کتگوری داره، اجازه حذف نمیدیم
        // (products.category همیشه آیدی دسته رو نگه می‌داره، نه برچسبش)
        const used = await env.DB
          .prepare("SELECT COUNT(*) as c FROM products WHERE category=?")
          .bind(id).first();
        if (used?.c > 0)
          return json({ error: `این دسته‌بندی ${used.c} محصول دارد. ابتدا محصولات را جابجا کنید.` }, 400);
        const cat = await env.DB.prepare('SELECT image FROM categories WHERE id=?').bind(id).first();
        await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(id).run();
        if (cat?.image) {
          const oldFilename = cat.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json({ success: true });
      } catch (e) { return serverError(e, 'categories:delete'); }
    }
    if (method === 'PUT') {
      try {
        const b = await request.json();
        if (!b.label) return json({ error: 'نام دسته‌بندی اجباری است' }, 400);
        const old = await env.DB.prepare('SELECT image FROM categories WHERE id=?').bind(id).first();
        await env.DB
          .prepare('UPDATE categories SET label=?, image=? WHERE id=?')
          .bind(b.label.trim(), b.image || '', id)
          .run();
        if (old?.image && old.image !== b.image) {
          const oldFilename = old.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json({ success: true });
      } catch (e) { return serverError(e, 'categories:put'); }
    }
  }

  // ── Products ──────────────────────────────────────────────────────────
  if (path === '/products') {
    if (method === 'GET') {
      try {
        const { results } = await env.DB
          .prepare('SELECT * FROM products ORDER BY category, name').all();
        return json(results);
      } catch (e) { return serverError(e, 'products:get'); }
    }

    if (method === 'POST') {
      try {
        const b = await request.json();
        if (!b.name) return json({ error: 'نام محصول اجباری است' }, 400);
        if (!b.price) return json({ error: 'قیمت اجباری است' }, 400);
        if (!b.category) return json({ error: 'دسته‌بندی اجباری است' }, 400);

        const id = await nextProductId(env);
        const price = Number(b.price);

        // اگه تخفیف داره، original_price = قیمت اصلی قبل از تخفیف
        const discount = Number(b.discount || 0);
        const origPrice = discount > 0
          ? Math.round(price / (1 - discount / 100))
          : null;

        const stmt = origPrice !== null
          ? env.DB.prepare(
            `INSERT INTO products (id, name, category, note, price, original_price, image, available)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(id, b.name.trim(), b.category, b.note || '', price, origPrice, b.image || '', b.available ?? 1)
          : env.DB.prepare(
            `INSERT INTO products (id, name, category, note, price, image, available)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(id, b.name.trim(), b.category, b.note || '', price, b.image || '', b.available ?? 1);

        await stmt.run();
        return json({ success: true, id }, 201);
      } catch (e) { return serverError(e, 'products:post'); }
    }
  }

  const prodMatch = path.match(/^\/products\/(.+)$/);
  if (prodMatch) {
    const id = prodMatch[1];

    if (method === 'PUT') {
      try {
        const b = await request.json();
        if (!b.name) return json({ error: 'نام محصول اجباری است' }, 400);
        if (!b.price) return json({ error: 'قیمت اجباری است' }, 400);
        if (!b.category) return json({ error: 'دسته‌بندی اجباری است' }, 400);
        const price = Number(b.price);
        const disc = Number(b.discount || 0);
        const orig = disc > 0 ? Math.round(price / (1 - disc / 100)) : null;
        const old = await env.DB.prepare('SELECT image FROM products WHERE id=?').bind(id).first();

        await env.DB
          .prepare(
            `UPDATE products
             SET name=?, category=?, note=?, price=?, original_price=?, image=?, available=?
             WHERE id=?`
          )
          .bind(b.name.trim(), b.category, b.note || '', price, orig, b.image || '', b.available ?? 1, id)
          .run();
        if (old?.image && old.image !== b.image) {
          const oldFilename = old.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json({ success: true });
      } catch (e) { return serverError(e, 'products:put'); }
    }

    if (method === 'DELETE') {
      try {
        const prod = await env.DB.prepare('SELECT image FROM products WHERE id=?').bind(id).first();
        await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();
        if (prod?.image) {
          const oldFilename = prod.image.split('/').pop();
          if (oldFilename) await env.PRODUCTS_KV.delete(`image:${oldFilename}`);
        }
        return json({ success: true });
      } catch (e) { return serverError(e, 'products:delete'); }
    }
  }

  return json({ error: 'مسیر پیدا نشد' }, 404);
}