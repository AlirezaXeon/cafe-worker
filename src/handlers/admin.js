import { signToken, requireAdmin } from '../middleware/adminAuth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

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
    const { password } = await request.json().catch(() => ({}));
    if (!password || password !== env.ADMIN_PASSWORD)
      return json({ error: 'رمز عبور اشتباه است' }, 401);
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
    } catch (e) { return json({ error: e.message }, 500); }
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
    } catch (e) { return json({ error: e.message }, 500); }
  }

  // ── Categories ────────────────────────────────────────────────────────
  if (path === '/categories') {
    if (method === 'GET') {
      try {
        const { results } = await env.DB.prepare('SELECT * FROM categories ORDER BY label').all();
        return json(results);
      } catch (e) { return json({ error: e.message }, 500); }
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
      } catch (e) { return json({ error: e.message }, 500); }
    }
  }

  const catMatch = path.match(/^\/categories\/(.+)$/);
  if (catMatch) {
    const id = catMatch[1];
    if (method === 'DELETE') {
      try {
        // اگه محصولی با این کتگوری داره، اجازه حذف نمیدیم
        const used = await env.DB
          .prepare("SELECT COUNT(*) as c FROM products WHERE category=(SELECT label FROM categories WHERE id=?)")
          .bind(id).first();
        if (used?.c > 0)
          return json({ error: `این دسته‌بندی ${used.c} محصول دارد. ابتدا محصولات را جابجا کنید.` }, 400);
        await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(id).run();
        return json({ success: true });
      } catch (e) { return json({ error: e.message }, 500); }
    }
    if (method === 'PUT') {
      try {
        const b = await request.json();
        await env.DB
          .prepare('UPDATE categories SET label=?, image=? WHERE id=?')
          .bind(b.label.trim(), b.image || '', id)
          .run();
        return json({ success: true });
      } catch (e) { return json({ error: e.message }, 500); }
    }
  }

  // ── Products ──────────────────────────────────────────────────────────
  if (path === '/products') {
    if (method === 'GET') {
      try {
        const { results } = await env.DB
          .prepare('SELECT * FROM products ORDER BY category, name').all();
        return json(results);
      } catch (e) { return json({ error: e.message }, 500); }
    }

    if (method === 'POST') {
      try {
        const b = await request.json();
        if (!b.name) return json({ error: 'نام محصول اجباری است' }, 400);
        if (!b.price) return json({ error: 'قیمت اجباری است' }, 400);
        if (!b.category) return json({ error: 'دسته‌بندی اجباری است' }, 400);

        const id = `p${Date.now()}`;
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
      } catch (e) { return json({ error: e.message }, 500); }
    }
  }

  const prodMatch = path.match(/^\/products\/(.+)$/);
  if (prodMatch) {
    const id = prodMatch[1];

    if (method === 'PUT') {
      try {
        const b = await request.json();
        const price = Number(b.price);
        const disc = Number(b.discount || 0);
        const orig = disc > 0 ? Math.round(price / (1 - disc / 100)) : null;

        await env.DB
          .prepare(
            `UPDATE products
             SET name=?, category=?, note=?, price=?, original_price=?, image=?, available=?
             WHERE id=?`
          )
          .bind(b.name.trim(), b.category, b.note || '', price, orig, b.image || '', b.available ?? 1, id)
          .run();
        return json({ success: true });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    if (method === 'DELETE') {
      try {
        await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();
        return json({ success: true });
      } catch (e) { return json({ error: e.message }, 500); }
    }
  }

  return json({ error: 'مسیر پیدا نشد' }, 404);
}