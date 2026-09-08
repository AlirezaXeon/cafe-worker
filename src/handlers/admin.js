import { signToken, requireAdmin } from '../middleware/adminAuth.js';

// ─── Helper ────────────────────────────────────────────────────────────────
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });

// ─── Main entry point ──────────────────────────────────────────────────────
export async function handleAdminAPI(request, env) {
  const url    = new URL(request.url);
  const path   = url.pathname.replace(/^\/admin\/api/, '') || '/';
  const method = request.method;

  // ── CORS preflight ────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
    });
  }

  // ── Login (public) ────────────────────────────────────────────────────
  if (path === '/login' && method === 'POST') {
    const { password } = await request.json().catch(() => ({}));
    if (!password || password !== env.ADMIN_PASSWORD) {
      return json({ error: 'رمز عبور اشتباه است' }, 401);
    }
    const token = await signToken(
      { role: 'admin', exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
      env.JWT_SECRET
    );
    return json({ token });
  }

  // ── All other routes require auth ─────────────────────────────────────
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'دسترسی غیرمجاز' }, 401);

  // ── PRODUCTS ──────────────────────────────────────────────────────────
  if (path === '/products') {
    if (method === 'GET') {
      const { results } = await env.DB
        .prepare('SELECT * FROM products ORDER BY category, name')
        .all();
      return json(results);
    }

    if (method === 'POST') {
      const b = await request.json();
      const { meta } = await env.DB
        .prepare(
          `INSERT INTO products (name, description, price, category, image, available)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(b.name, b.description ?? '', b.price, b.category ?? '', b.image ?? '', b.available ?? 1)
        .run();
      return json({ success: true, id: meta.last_row_id }, 201);
    }
  }

  // /products/:id
  const prodMatch = path.match(/^\/products\/(\d+)$/);
  if (prodMatch) {
    const id = prodMatch[1];

    if (method === 'PUT') {
      const b = await request.json();
      await env.DB
        .prepare(
          `UPDATE products
           SET name=?, description=?, price=?, category=?, image=?, available=?
           WHERE id=?`
        )
        .bind(b.name, b.description ?? '', b.price, b.category ?? '', b.image ?? '', b.available ?? 1, id)
        .run();
      return json({ success: true });
    }

    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();
      return json({ success: true });
    }
  }

  // ── ORDERS ────────────────────────────────────────────────────────────
  if (path === '/orders' && method === 'GET') {
    const status = url.searchParams.get('status');
    const query  = status
      ? 'SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM orders ORDER BY created_at DESC LIMIT 100';
    const { results } = await env.DB
      .prepare(query)
      .bind(...(status ? [status] : []))
      .all();
    return json(results);
  }

  // /orders/:id
  const orderMatch = path.match(/^\/orders\/(\d+)$/);
  if (orderMatch) {
    const id = orderMatch[1];

    if (method === 'PUT') {
      const { status } = await request.json();
      await env.DB
        .prepare('UPDATE orders SET status=? WHERE id=?')
        .bind(status, id)
        .run();
      return json({ success: true });
    }
  }

  // ── STATS (dashboard) ─────────────────────────────────────────────────
  if (path === '/stats' && method === 'GET') {
    const [products, orders, pending] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM products').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM orders').first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM orders WHERE status='pending'").first(),
    ]);
    return json({
      totalProducts: products?.count ?? 0,
      totalOrders:   orders?.count   ?? 0,
      pendingOrders: pending?.count  ?? 0,
    });
  }

  return json({ error: 'مسیر پیدا نشد' }, 404);
}
