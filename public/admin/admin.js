const BASE = '/admin/api';
// سقف حجم ورودی (قبل از فشرده‌سازی) و سقف نهایی سرور (باید با MAX_UPLOAD_BYTES تو src/config.js یکی باشه)
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
let editingProductId = null;
let editingProductOriginalPrice = null;
let editingProductPrice = null;
let editingProductInitialInputPrice = null;
let editingProductInitialDiscount = null;
let editingCatId = null;
let allProducts = [];
let allCategories = [];
let searchQ = '';

// ── Auth ──────────────────────────────────────────────────────────────────
async function doLogin() {
  const pw = document.getElementById('pw').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-err');
  if (!pw) { err.textContent = 'رمز عبور را وارد کنید'; return; }
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true; err.textContent = '';
  try {
    const r = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: pw })
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error; return; }
    initApp();
  } catch { err.textContent = 'خطا در اتصال به سرور'; }
  finally { btn.innerHTML = 'ورود به پنل'; btn.disabled = false; }
}

let isLoggedIn = false;

async function doLogout() {
  isLoggedIn = false;
  stopAdminPolling();
  try {
    await fetch(`${BASE}/logout`, { method: 'POST', credentials: 'same-origin' });
  } catch {}
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-err').textContent = '';
  const pw = document.getElementById('pw');
  if (pw) pw.value = '';
}

async function api(path, opts = {}) {
  const isFormData = opts.body instanceof FormData;
  const r = await fetch(`${BASE}${path}`, {
    ...opts,
    credentials: 'same-origin',
    headers: {
      ...(!isFormData && opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {})
    }
  });
  if (r.status === 401) { doLogout(); throw new Error('unauthorized'); }
  let data;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  if (!r.ok) {
    throw new Error((data && data.error) ? data.error : 'خطا در برقراری ارتباط');
  }
  return data;
}

function initApp() {
  isLoggedIn = true;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  showTab('dashboard', document.querySelector('.nav-btn'));
  startAdminPolling();
}

// ── کنترلر پولینگ سبک و هوشمند سفارش‌ها (جلوگیری از هدررفت سهمیه D1) ───────────
const ORDERS_POLL_MS = 30000; // هر ۳۰ ثانیه فقط درخواست خلاصه سبک ارسال می‌شود
const MAX_BACKOFF_MS = 300000; // سقف ۵ دقیقه برای کاهش تلاش در صورت خطای شبکه/سرور
let adminPollTimer = null;
let currentPollInterval = ORDERS_POLL_MS;
let isPollingActive = false;
let isPollInProgress = false;
let pendingPollRequested = false;
let lastKnownSummary = { pending: null, latestId: null };
let currentActiveTab = 'dashboard';
let currentOrderFilter = '';

function startAdminPolling() {
  if (isPollingActive) return;
  isPollingActive = true;
  currentPollInterval = ORDERS_POLL_MS;
  pollOrdersNow();
}

function stopAdminPolling() {
  isPollingActive = false;
  if (adminPollTimer) {
    clearTimeout(adminPollTimer);
    adminPollTimer = null;
  }
  isPollInProgress = false;
  pendingPollRequested = false;
}

function scheduleNextPoll(delayMs) {
  if (adminPollTimer) clearTimeout(adminPollTimer);
  if (!isPollingActive || !isLoggedIn) return;
  adminPollTimer = setTimeout(async () => {
    adminPollTimer = null;
    await executePollTick();
  }, delayMs);
}

async function executePollTick(forceImmediate = false) {
  if (!isPollingActive || !isLoggedIn) return;
  if (document.hidden && !forceImmediate) {
    // اگر تب مرورگر پنهان است، درخواست ارسال نمی‌کنیم
    scheduleNextPoll(currentPollInterval);
    return;
  }

  if (isPollInProgress) {
    pendingPollRequested = true;
    return;
  }

  isPollInProgress = true;
  try {
    const summary = await api('/orders/summary');
    currentPollInterval = ORDERS_POLL_MS; // بازنشانی فاصله به ۳۰ ثانیه بعد از دریافت موفق

    const pendingCount = Number(summary?.pending ?? 0);
    const latestId = Number(summary?.latestId ?? 0);

    updatePendingBadge(pendingCount);

    const hasChanged =
      lastKnownSummary.pending !== pendingCount ||
      lastKnownSummary.latestId !== latestId;

    lastKnownSummary = { pending: pendingCount, latestId };

    // فقط وقتی تب سفارش‌ها باز است و دیتای خلاصه تغییر کرده باشد، لیست دوباره خوانده می‌شود
    if (currentActiveTab === 'orders' && hasChanged && document.getElementById('order-list-wrap')) {
      const targetLimit = Math.min(Math.max(currentOrdersList.length, 50), 100);
      await loadOrders(false, targetLimit);
    }
  } catch (err) {
    if (err.message === 'unauthorized') {
      stopAdminPolling();
      return;
    }
    // در صورت بروز خطا: افزایش فاصله زمانی به صورت تصاعدی تا حداکثر ۵ دقیقه
    currentPollInterval = Math.min(currentPollInterval * 2, MAX_BACKOFF_MS);
  } finally {
    isPollInProgress = false;
    if (pendingPollRequested) {
      pendingPollRequested = false;
      executePollTick(true);
    } else if (isPollingActive && isLoggedIn) {
      scheduleNextPoll(currentPollInterval);
    }
  }
}

function pollOrdersNow() {
  if (!isLoggedIn) return;
  if (isPollInProgress) {
    pendingPollRequested = true;
    return;
  }
  if (adminPollTimer) {
    clearTimeout(adminPollTimer);
    adminPollTimer = null;
  }
  executePollTick(true);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isPollingActive && isLoggedIn) {
    pollOrdersNow();
  }
});

function updatePendingBadge(count) {
  const badge = document.getElementById('pending-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderOrders(m) {
  currentOrderFilter = '';
  m.innerHTML = `
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
        <h2>🧾 سفارش‌ها</h2>
        <button class="btn btn-ghost btn-sm" data-action="refresh-orders" title="تازه سازی کامل لیست سفارش‌ها">
          🔄 تازه‌سازی
        </button>
      </div>
      <div class="card-toolbar">
        <select class="search-input" style="max-width:180px" data-action="filter-orders">
          <option value="">همه</option>
          <option value="pending">در انتظار تایید</option>
          <option value="confirmed">تایید شده</option>
          <option value="rejected">رد شده</option>
        </select>
      </div>
      <div id="order-list-wrap"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
    </div>`;
  loadOrders(false, 50);
}

async function manualRefreshOrders() {
  toast('در حال به‌روزرسانی...');
  const targetLimit = Math.min(Math.max(currentOrdersList.length, 50), 100);
  await loadOrders(false, targetLimit);
  pollOrdersNow();
}

let currentOrdersList = [];
let hasMoreOrders = false;

function formatOrderDateTime(createdAt) {
  if (!createdAt) return '—';
  const d = new Date(createdAt.endsWith('Z') ? createdAt : (createdAt.replace(' ', 'T') + 'Z'));
  if (isNaN(d.getTime())) return createdAt;

  const now = new Date();
  const tehranDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
  const isToday = tehranDateFmt.format(now) === tehranDateFmt.format(d);

  const timeStr = d.toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tehran',
  });

  if (isToday) return timeStr;

  const isThisYear = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric' }).format(now) ===
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric' }).format(d);

  const dateStr = d.toLocaleDateString('fa-IR', {
    day: 'numeric',
    month: 'short',
    ...(isThisYear ? {} : { year: 'numeric' }),
    timeZone: 'Asia/Tehran',
  });

  return `${dateStr}، ${timeStr}`;
}

async function loadOrders(append = false, customLimit = null) {
  const wrap = document.getElementById('order-list-wrap');
  if (!wrap) return;
  try {
    const limit = customLimit ? Math.min(Math.max(customLimit, 50), 100) : 50;
    let qs = `?limit=${limit}`;
    if (currentOrderFilter) qs += `&status=${currentOrderFilter}`;
    if (append && currentOrdersList.length) {
      const oldestId = currentOrdersList[currentOrdersList.length - 1].id;
      qs += `&before_id=${oldestId}`;
    }
    const orders = await api('/orders' + qs);
    if (!append) {
      currentOrdersList = orders;
    } else {
      currentOrdersList = currentOrdersList.concat(orders);
    }
    hasMoreOrders = orders.length === limit;

    if (!currentOrdersList.length) {
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>سفارشی یافت نشد</div>';
      return;
    }
    const statusLabel = { pending: 'در انتظار', confirmed: 'تایید شده', rejected: 'رد شده' };
    wrap.innerHTML = `<div class="order-list">${currentOrdersList.map(o => {
      const time = formatOrderDateTime(o.created_at);
      return `
      <div class="order-card">
        <div class="order-card-head">
          <span class="order-table-no">سفارش #${o.id} — میز ${esc(o.table_number)}</span>
          <span class="order-status ${o.status}">${statusLabel[o.status] || o.status}</span>
          <span class="order-time">${time}</span>
        </div>
        <div class="order-items">${(o.items || []).map(it => `
          <div class="order-item-row"><span>${esc(it.name)} × ${it.quantity}</span><span>${Number(it.price * it.quantity).toLocaleString('fa-IR')} ت</span></div>
        `).join('')}</div>
        <div class="order-card-foot">
          <span class="order-total">جمع کل: ${Number(o.total).toLocaleString('fa-IR')} ت</span>
          ${o.status === 'pending' ? `
            <div class="actions">
              <button class="btn btn-primary btn-sm" data-action="order-resolve" data-order-id="${o.id}" data-order-status="confirmed">✅ تایید</button>
              <button class="btn btn-danger btn-sm" data-action="order-resolve" data-order-id="${o.id}" data-order-status="rejected">❌ رد</button>
            </div>` : ''}
        </div>
      </div>`;
    }).join('')}</div>
    ${hasMoreOrders ? `
      <div style="text-align:center;margin-top:16px;">
        <button class="btn btn-ghost" data-action="load-more-orders">بارگذاری بیشتر...</button>
      </div>
    ` : ''}`;
  } catch (e) {
    if (e.message !== 'unauthorized') wrap.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>خطا در بارگذاری</div>';
  }
}

async function resolveOrderWeb(id, status) {
  try {
    await api(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(status === 'confirmed' ? 'سفارش تایید شد' : 'سفارش رد شد');
    await loadOrders(false, Math.min(Math.max(currentOrdersList.length, 50), 100));
    pollOrdersNow();
  } catch (e) {
    if (e.message !== 'unauthorized') toast(e.message || 'خطا در ثبت', true);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  setTimeout(() => t.className = '', 3000);
}

// ── Tabs ──────────────────────────────────────────────────────────────────
function showTab(tab, btn) {
  currentActiveTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const m = document.getElementById('main-content');
  if (tab === 'dashboard') renderDashboard(m);
  if (tab === 'orders') renderOrders(m);
  if (tab === 'products') renderProducts(m);
  if (tab === 'categories') renderCategories(m);
  if (tab === 'qr') renderTableQr(m);
  if (tab === 'site') renderSite(m);
}

// ── Dashboard ─────────────────────────────────────────────────────────────
async function renderDashboard(m) {
  m.innerHTML = `
    <div class="stats">
      <div class="stat-card"><div class="stat-icon">🍽</div><div class="val" id="s-total">—</div><div class="lbl">کل محصولات</div></div>
      <div class="stat-card green"><div class="stat-icon">✅</div><div class="val" id="s-avail">—</div><div class="lbl">موجود</div></div>
      <div class="stat-card red"><div class="stat-icon">⛔️</div><div class="val" id="s-unavail">—</div><div class="lbl">ناموجود</div></div>
      <div class="stat-card gray"><div class="stat-icon">📂</div><div class="val" id="s-cats">—</div><div class="lbl">دسته‌بندی</div></div>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-icon">💰</div><div class="val" id="s-sales-today">—</div><div class="lbl">فروش امروز</div></div>
      <div class="stat-card"><div class="stat-icon">📅</div><div class="val" id="s-sales-week">—</div><div class="lbl">فروش این هفته</div></div>
      <div class="stat-card"><div class="stat-icon">🗓</div><div class="val" id="s-sales-month">—</div><div class="lbl">فروش این ماه</div></div>
    </div>
    <div class="quick-actions">
      <div class="quick-action" data-action="quick-add-prod">
        <div class="qa-icon">➕</div><div class="qa-label">محصول جدید</div>
      </div>
      <div class="quick-action" data-action="quick-add-cat">
        <div class="qa-icon">📂</div><div class="qa-label">دسته‌بندی جدید</div>
      </div>
      <a class="quick-action" href="/" target="_blank" rel="noopener">
        <div class="qa-icon">🔗</div><div class="qa-label">مشاهده‌ی سایت</div>
      </a>
    </div>
    <div class="card">
      <div class="card-header"><h2>📊 محصولات به تفکیک دسته‌بندی</h2></div>
      <div id="cat-breakdown" style="padding:1.25rem"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
    </div>`;
  try {
    const [cats, prods, sales] = await Promise.all([api('/categories'), api('/products'), api('/sales-stats')]);
    allCategories = cats; allProducts = prods;
    const total = allProducts.length;
    const avail = allProducts.filter(p => p.available).length;
    document.getElementById('s-total').textContent = total;
    document.getElementById('s-avail').textContent = avail;
    document.getElementById('s-unavail').textContent = total - avail;
    document.getElementById('s-cats').textContent = allCategories.length;
    document.getElementById('s-sales-today').textContent = Number(sales.today).toLocaleString('fa-IR') + ' ت';
    document.getElementById('s-sales-week').textContent = Number(sales.week).toLocaleString('fa-IR') + ' ت';
    document.getElementById('s-sales-month').textContent = Number(sales.month).toLocaleString('fa-IR') + ' ت';

    const breakdown = document.getElementById('cat-breakdown');
    const counts = allCategories
      .map(c => ({ label: c.label, count: allProducts.filter(p => p.category === c.id).length }))
      .sort((a, b) => b.count - a.count);
    const max = Math.max(1, ...counts.map(c => c.count));
    breakdown.innerHTML = counts.length
      ? counts.map(c => `
        <div class="cat-breakdown-item">
          <div class="cb-label" title="${esc(c.label)}">${esc(c.label)}</div>
          <div class="cb-bar-track"><div class="cb-bar-fill" style="width:${(c.count / max) * 100}%"></div></div>
          <div class="cb-count">${c.count}</div>
        </div>`).join('')
      : '<div class="empty"><div class="empty-icon">📭</div>هنوز دسته‌بندی‌ای ثبت نشده</div>';
  } catch (e) { if (e.message !== 'unauthorized') toast('خطا در بارگذاری آمار', true); }
}

// ترتیب دکمه‌های نوار: ۰=داشبورد، ۱=سفارش‌ها، ۲=محصولات، ۳=دسته‌بندی‌ها، ۴=تصاویر سایت
async function quickAddProduct() {
  const btns = document.querySelectorAll('.nav-btn');
  btns.forEach(b => b.classList.remove('active')); if (btns[2]) btns[2].classList.add('active');
  await renderProducts(document.getElementById('main-content'));
  openProductModal();
}

async function quickAddCategory() {
  const btns = document.querySelectorAll('.nav-btn');
  btns.forEach(b => b.classList.remove('active')); if (btns[3]) btns[3].classList.add('active');
  await renderCategories(document.getElementById('main-content'));
  openCatModal();
}

const imgSrc = (p) => p ? '/' + String(p).replace(/^\/+/, '') : '';

// ── Products ──────────────────────────────────────────────────────────────
async function renderProducts(m) {
  m.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>🍽 محصولات</h2>
        <button class="btn btn-primary btn-sm" data-action="open-prod-modal">+ محصول جدید</button></div>
      <div class="card-toolbar">
        <input class="search-input" placeholder="🔍 جستجو..." data-action="search-products" />
      </div>
      <div class="table-wrap" id="prod-table"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
    </div>`;
  try {
    [allProducts, allCategories] = await Promise.all([api('/products'), api('/categories')]);
    renderProductTable();
  } catch (e) {
    if (e.message !== 'unauthorized')
      document.getElementById('prod-table').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>خطا در بارگذاری</div>';
  }
}

function renderProductTable() {
  const t = document.getElementById('prod-table'); if (!t) return;
  const q = searchQ.toLowerCase();
  const rows = q ? allProducts.filter(p => p.name.toLowerCase().includes(q) || catLabel(p.category).toLowerCase().includes(q)) : allProducts;
  if (!rows.length) { t.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>محصولی یافت نشد</div>'; return; }
  t.innerHTML = `<table>
    <thead><tr><th>تصویر</th><th>محصول</th><th>دسته</th><th>قیمت</th><th>موجودی</th><th>عملیات</th></tr></thead>
    <tbody>${rows.map(p => `
      <tr>
        <td>${p.image ? `<img class="img-preview" src="${esc(imgSrc(p.image))}" alt="">` : `<div class="img-placeholder">🍽</div>`}</td>
        <td><div class="prod-name">${esc(p.name)}</div>${p.note ? `<div class="prod-note">${esc(p.note.slice(0, 55))}${p.note.length > 55 ? '…' : ''}</div>` : ''}</td>
        <td><span style="background:var(--bg);padding:.18rem .55rem;border-radius:20px;font-size:.77rem">${esc(catLabel(p.category))}</span></td>
        <td>
          ${p.original_price ? `<span class="price-orig">${Number(p.original_price).toLocaleString('fa-IR')} ت</span>` : ''}
          <span class="price-main">${Number(p.price).toLocaleString('fa-IR')} ت</span>
          ${p.original_price ? `<span class="disc-badge">٪${Math.round((1 - p.price / p.original_price) * 100)} تخفیف</span>` : ''}
        </td>
        <td><button class="toggle ${p.available ? 'on' : ''}" data-action="toggle-avail" data-prod-id="${p.id}" data-cur-avail="${p.available}" title="${p.available ? 'موجود' : 'ناموجود'}"></button></td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" data-action="open-prod-modal" data-prod-id="${p.id}">ویرایش</button>
          <button class="btn btn-danger btn-sm" data-action="delete-prod" data-prod-id="${p.id}">حذف</button>
        </div></td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function toggleAvail(id, cur) {
  const p = allProducts.find(x => x.id == id); if (!p) return;
  // فقط ستون available رو عوض می‌کنیم. قبلاً کل محصول با PUT فرستاده می‌شد و درصد تخفیف
  // از روی قیمت‌ها بازسازی می‌شد؛ چون درصد گرد می‌شد، هر بار toggle قیمت اصلی چند تومن جابه‌جا می‌شد.
  try {
    const res = await api(`/products/${id}/availability`, { method: 'PATCH' });
    p.available = res.available; renderProductTable();
    toast(p.available ? 'محصول موجود شد ✓' : 'محصول ناموجود شد');
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message || 'خطا در تغییر وضعیت', true); }
}

// ── Categories ────────────────────────────────────────────────────────────
async function renderCategories(m) {
  m.innerHTML = `
    <div class="card">
      <div class="card-header"><h2>📂 دسته‌بندی‌ها</h2>
        <button class="btn btn-primary btn-sm" data-action="open-cat-modal">+ دسته جدید</button></div>
      <div id="cat-list"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
    </div>`;
  await loadCategories();
}

async function loadCategories() {
  try {
    allCategories = await api('/categories');
    const prodData = await api('/products');
    allProducts = prodData;
    renderCategoryList();
  } catch (e) {
    if (e.message !== 'unauthorized')
      document.getElementById('cat-list').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>خطا</div>';
  }
}

function renderCategoryList() {
  const el = document.getElementById('cat-list'); if (!el) return;
  if (!allCategories.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>دسته‌بندی ثبت نشده</div>'; return; }
  el.innerHTML = `<div class="cat-grid">${allCategories.map(c => {
    const count = allProducts.filter(p => p.category === c.id).length;
    return `<div class="cat-item">
      ${c.image ? `<img src="${esc(imgSrc(c.image))}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" alt="">` : '<span style="font-size:1.2rem">📂</span>'}
      <div style="flex:1;min-width:0">
        <div class="cat-name" title="${esc(c.label)}">${esc(c.label)}</div>
        <div class="cat-count">${count} محصول</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-action="open-cat-modal" data-cat-id="${c.id}">ویرایش</button>
        <button class="btn btn-danger btn-sm" data-action="delete-cat" data-cat-id="${c.id}">×</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function openCatModal(id) {
  editingCatId = id || null;
  const c = id ? allCategories.find(x => x.id === id) : null;
  document.getElementById('cat-modal-title').textContent = c ? 'ویرایش دسته‌بندی' : 'دسته‌بندی جدید';
  document.getElementById('c-label').value = c ? c.label : '';
  document.getElementById('c-img').value = c ? (c.image || '') : '';
  document.getElementById('cat-err').textContent = '';
  const prev = document.getElementById('cat-upload-preview');
  if (c && c.image) { document.getElementById('cat-preview-img').src = imgSrc(c.image); prev.style.display = 'block'; }
  else { prev.style.display = 'none'; }
  openModal('cat-modal');
}

async function saveCat() {
  const label = document.getElementById('c-label').value.trim();
  const err = document.getElementById('cat-err');
  if (!label) { err.textContent = 'نام دسته‌بندی اجباری است'; return; }
  const btn = document.getElementById('save-cat-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
  try {
    const image = document.getElementById('c-img').value;
    if (editingCatId) {
      await api(`/categories/${editingCatId}`, { method: 'PUT', body: JSON.stringify({ label, image }) });
      toast('دسته‌بندی ویرایش شد ✓');
    } else {
      await api('/categories', { method: 'POST', body: JSON.stringify({ label, image }) });
      toast('دسته‌بندی اضافه شد ✓');
    }
    closeModal('cat-modal');
    await loadCategories();
  } catch (e) {
    if (e.message !== 'unauthorized') err.textContent = e.message || 'خطا در ذخیره';
  } finally { btn.innerHTML = 'ذخیره'; btn.disabled = false; }
}

// اسم از روی ID پیدا میشه (نه از onclick)، تا اسمی که ' یا کاراکتر خاص داره دکمه رو خراب نکنه
async function deleteCat(id) {
  const c = allCategories.find(x => x.id === id);
  if (!confirm(`حذف دسته‌بندی «${c ? c.label : ''}»؟`)) return;
  try {
    await api(`/categories/${id}`, { method: 'DELETE' });
    toast('دسته‌بندی حذف شد');
    await loadCategories();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message || 'خطا در حذف', true); }
}

// ── Image Upload ──────────────────────────────────────────────────────────
// Workers توانایی resize/بومی تصویر نداره (بدون Cloudflare Images یا سرویس خارجی)،
// پس قبل از آپلود، خود مرورگر عکس رو کوچیک و به WebP تبدیل می‌کنه — حجم نهایی خیلی کمتر میشه
function resizeImageForUpload(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(file);
        const mimeToExt = {
          'image/webp': '.webp',
          'image/jpeg': '.jpg',
          'image/png': '.png',
        };
        const ext = mimeToExt[blob.type];
        // اگر فرمت خروجی پشتیبانی نمی‌شد یا سایز ریسایز شده از فایل اصلی بزرگتر بود، همان فایل اصلی را بفرست
        if (!ext || blob.size >= file.size) return resolve(file);
        const baseName = file.name.replace(/\.[^.]+$/, '');
        resolve(new File([blob], `${baseName}${ext}`, { type: blob.type }));
      }, 'image/webp', quality);
    };
    img.onerror = () => resolve(file); // اگه به هر دلیلی لود نشد، فایل اصلی رو بفرست
    img.src = url;
  });
}

async function handleImageSelect(input, context) {
  let file = input.files[0]; if (!file) return;
  const statusEl = document.getElementById(`${context}-upload-status`);
  if (file.size > MAX_INPUT_BYTES) { toast('حجم فایل خیلی زیاده (حداکثر 5MB)', true); return; }
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById(`${context}-preview-img`).src = e.target.result;
    document.getElementById(`${context}-upload-preview`).style.display = 'block';
  };
  reader.readAsDataURL(file);
  statusEl.textContent = '⏳ در حال آپلود...';
  file = await resizeImageForUpload(file);
  // بعد از فشرده‌سازی باید زیر سقف سرور باشه؛ اینجا چک می‌کنیم تا پیام خطا واضح باشه
  if (file.size > MAX_UPLOAD_BYTES) {
    toast('حجم عکس بعد از فشرده‌سازی هم بیشتر از 2MB است', true);
    statusEl.textContent = '❌ حجم زیاد';
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const d = await api('/upload', { method: 'POST', body: fd });
    document.getElementById(context === 'prod' ? 'p-img' : 'c-img').value = imgSrc(d.url);
    statusEl.textContent = '✅ آپلود شد';
    toast('تصویر آپلود شد ✓');
  } catch (err) {
    if (err.message !== 'unauthorized') {
      toast(err.message || 'خطا در آپلود', true);
    }
    statusEl.textContent = '❌ ناموفق';
  }
}

// ── Product Modal ─────────────────────────────────────────────────────────
function openProductModal(id) {
  editingProductId = id || null;
  document.getElementById('modal-title').textContent = id ? 'ویرایش محصول' : 'محصول جدید';
  document.getElementById('prod-err').textContent = '';
  document.getElementById('prod-upload-preview').style.display = 'none';
  document.getElementById('disc-preview').style.display = 'none';

  const catSel = document.getElementById('p-cat');
  catSel.innerHTML = '<option value="">انتخاب کنید...</option>' +
    allCategories.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');

  if (id) {
    const p = allProducts.find(x => x.id == id);
    editingProductOriginalPrice = p.original_price != null ? Number(p.original_price) : null;
    editingProductPrice = Number(p.price);
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-note').value = p.note || '';
    document.getElementById('p-img').value = p.image || '';
    catSel.value = p.category || '';

    // محاسبه تخفیف از original_price
    if (p.original_price && p.original_price > p.price) {
      const disc = Math.round((1 - p.price / p.original_price) * 100);
      document.getElementById('p-price').value = p.original_price; // قیمت اصلی
      document.getElementById('p-discount').value = disc;
      editingProductInitialInputPrice = Number(p.original_price);
      editingProductInitialDiscount = disc;
      updateDiscPreview();
    } else {
      document.getElementById('p-price').value = p.price;
      document.getElementById('p-discount').value = '';
      editingProductInitialInputPrice = Number(p.price);
      editingProductInitialDiscount = 0;
    }

    if (p.image) {
      document.getElementById('prod-preview-img').src = imgSrc(p.image);
      document.getElementById('prod-upload-preview').style.display = 'block';
      document.getElementById('prod-upload-status').textContent = '✅ تصویر فعلی';
    }
    document.getElementById('p-avail').classList.toggle('on', !!p.available);
  } else {
    ['p-name', 'p-price', 'p-discount', 'p-note', 'p-img'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('p-avail').classList.add('on');
  }
  syncAvailLabel();
  openModal('product-modal');
}

function updateDiscPreview() {
  const price = Number(document.getElementById('p-price').value);
  const disc = Number(document.getElementById('p-discount').value || 0);
  const prev = document.getElementById('disc-preview');
  if (price > 0 && disc > 0 && disc < 100) {
    // بک‌اند به نزدیک‌ترین هزار تومن گرد می‌کنه؛ پیش‌نمایش هم همون‌طور
    const final = Math.round(price * (1 - disc / 100) / 1000) * 1000;
    prev.textContent = `قیمت اصلی: ${price.toLocaleString('fa-IR')} ت  ←  قیمت با تخفیف: ${final.toLocaleString('fa-IR')} ت`;
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }
}

function syncAvailLabel() {
  document.getElementById('p-avail-lbl').textContent =
    document.getElementById('p-avail').classList.contains('on') ? 'موجود' : 'ناموجود';
}

async function saveProduct() {
  const name = document.getElementById('p-name').value.trim();
  const price = document.getElementById('p-price').value;
  const cat = document.getElementById('p-cat').value;
  const err = document.getElementById('prod-err');
  if (!name) { err.textContent = 'نام محصول اجباری است'; return; }
  if (!price) { err.textContent = 'قیمت اجباری است'; return; }
  if (!cat) { err.textContent = 'دسته‌بندی اجباری است'; return; }

  const btn = document.getElementById('save-prod-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;

  const discVal = Number(document.getElementById('p-discount').value || 0);
  const isPriceUntouched = editingProductId &&
    editingProductOriginalPrice &&
    Number(price) === editingProductInitialInputPrice &&
    discVal === editingProductInitialDiscount;

  // اگر قیمت و تخفیف دست‌نخورده باقی مانده باشند، قیمت اصلی و ذخیره‌شده را می‌فرستیم
  // تا گرد کردن مجدد باعث جابه‌جایی جزئی قیمت نشود
  const body = {
    name, category: cat,
    price: isPriceUntouched ? editingProductPrice : Number(price),
    discount: discVal,
    note: document.getElementById('p-note').value.trim(),
    image: document.getElementById('p-img').value.trim(),
    available: document.getElementById('p-avail').classList.contains('on') ? 1 : 0,
  };
  if (isPriceUntouched) {
    body.original_price = editingProductOriginalPrice;
  }

  try {
    if (editingProductId) {
      await api(`/products/${editingProductId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('محصول ویرایش شد ✓');
    } else {
      await api('/products', { method: 'POST', body: JSON.stringify(body) });
      toast('محصول اضافه شد ✓');
    }
    closeModal('product-modal');
    allProducts = await api('/products');
    renderProductTable();
  } catch (e) {
    if (e.message !== 'unauthorized') err.textContent = e.message || 'خطا در ذخیره';
  } finally { btn.innerHTML = 'ذخیره محصول'; btn.disabled = false; }
}

// اسم از روی ID پیدا میشه (نه از onclick)، تا اسمی که ' یا کاراکتر خاص داره دکمه رو خراب نکنه
async function deleteProduct(id) {
  const p = allProducts.find(x => x.id == id);
  if (!confirm(`حذف «${p ? p.name : ''}»؟`)) return;
  try {
    await api(`/products/${id}`, { method: 'DELETE' });
    toast('محصول حذف شد');
    allProducts = await api('/products');
    renderProductTable();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message || 'خطا در حذف', true); }
}

// ── QR میزها ─────────────────────────────────────────────────────────────
async function renderTableQr(m) {
  m.innerHTML = `<div class="card">
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
      <h2>📱 لینک‌ها و کدهای QR میزها</h2>
      <button class="btn btn-primary btn-sm no-print" data-action="print-table-qr">🖨 چاپ صفحه میزها</button>
    </div>
    <div id="table-qr-wrap"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری لینک‌ها...</div></div>
  </div>`;
  await loadTableQr();
}

function generateQrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 4, scalable: true });
  } catch (err) {
    console.error('Failed to generate QR code SVG:', err);
    return '';
  }
}

async function loadTableQr() {
  const el = document.getElementById('table-qr-wrap');
  if (!el) return;
  try {
    const data = await api('/table-qr-links');
    const origin = window.location.origin;
    let html = `
      <div class="no-print" style="margin-bottom:1rem;font-size:0.9rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
        <span>تعداد کل میزها: <strong>${data.tableCount}</strong></span>
        <span>وضعیت امضای ضدجعل: 
          <strong style="color:${data.signingEnabled ? 'var(--success)' : 'var(--accent)'}">
            ${data.signingEnabled ? 'فعال ✓ (لینک‌ها دارای امضا هستند)' : 'غیرفعال (لینک‌ها بدون امضا هستند)'}
          </strong>
        </span>
      </div>
      <div id="qr-print-sheet">
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(260px, 1fr));gap:1rem;">
    `;
    data.links.forEach(l => {
      const fullUrl = `${origin}${l.url}`;
      const qrSvg = generateQrSvg(fullUrl);
      html += `
        <div class="print-card" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1rem;display:flex;flex-direction:column;gap:0.5rem;align-items:center;text-align:center;">
          <div style="font-weight:bold;font-size:1.15rem;">☕ کافه روشن</div>
          <div style="font-size:1.3rem;font-weight:bold;color:var(--accent-dark);">میز شماره ${l.table}</div>
          <div class="qr-svg-wrap" style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;margin:0.25rem auto;">
            ${qrSvg}
          </div>
          <div style="font-size:0.8rem;color:var(--muted);">برای ثبت سفارش، بارکد را اسکن کنید یا لینک را باز کنید:</div>
          <div style="font-family:monospace;direction:ltr;font-size:0.72rem;word-break:break-all;background:rgba(0,0,0,0.06);padding:0.4rem;border-radius:4px;width:100%;">${esc(fullUrl)}</div>
          <button class="btn btn-ghost btn-sm no-print" data-action="copy-table-url" data-url="${esc(fullUrl)}">📋 کپی لینک</button>
        </div>
      `;
    });
    html += `</div></div>`;
    el.innerHTML = html;
  } catch (e) {
    if (e.message !== 'unauthorized') el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>خطا در دریافت لینک‌ها</div>';
  }
}

function copyTableUrl(url) {
  navigator.clipboard.writeText(url).then(() => {
    toast('لینک میز کپی شد ✓');
  }).catch(() => {
    toast('خطا در کپی لینک', true);
  });
}

// ── Site images & settings (لوگو + عکس بالای سایت + تعداد میزها) ───────────
const SITE_IMG_LABELS = { logo: 'لوگو', cover: 'عکس بالای سایت' };

async function renderSite(m) {
  m.innerHTML = `<div class="card">
<div class="card-header"><h2>🖼 تصاویر و تنظیمات سایت</h2></div>
<div id="site-imgs"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
</div>`;
  await loadSiteImages();
}

async function loadSiteImages() {
  const el = document.getElementById('site-imgs'); if (!el) return;
  try {
    const cfg = await api('/site');
    el.innerHTML = `
      <div class="cat-grid">${['logo', 'cover'].map(kind => {
        const src = imgSrc(cfg[kind]);
        return `<div class="cat-item" style="flex-direction:column;align-items:stretch;gap:.7rem">
      <div class="cat-name">${SITE_IMG_LABELS[kind]}</div>
      ${src ? `<img src="${esc(src)}" alt="" style="max-height:110px;object-fit:contain;border-radius:8px;border:1px solid var(--border);background:#fff">`
            : '<div class="hint">هنوز آپلود نشده</div>'}
      <div class="upload-area" style="padding:.7rem">
        <input type="file" accept="image/*" data-upload-site="${kind}" />
        <p>انتخاب عکس جدید</p>
      </div>
      ${src ? `<button class="btn btn-danger btn-sm" data-action="remove-site-img" data-kind="${kind}">حذف</button>` : ''}
    </div>`;
      }).join('')}</div>
      <div class="card" style="margin-top:1.5rem">
        <div class="card-header"><h2>🪑 تنظیم تعداد میزها</h2></div>
        <div style="padding:1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <label for="table-count-input">تعداد میزهای فعال کافه:</label>
          <input type="number" id="table-count-input" min="1" max="100" value="${cfg.tableCount || 20}" style="width:100px;padding:.5rem;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
          <button class="btn btn-primary btn-sm" data-action="save-table-count">ذخیره تعداد میزها</button>
        </div>
      </div>
    `;
  } catch (e) {
    if (e.message !== 'unauthorized') el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>خطا در بارگذاری</div>';
  }
}

async function saveTableCount() {
  const val = Number(document.getElementById('table-count-input').value);
  if (!Number.isInteger(val) || val < 1 || val > 100) {
    toast('تعداد میز باید عددی بین ۱ تا ۱۰۰ باشد', true);
    return;
  }
  try {
    await api('/site/table-count', {
      method: 'PUT',
      body: JSON.stringify({ tableCount: val }),
    });
    toast('تعداد میزها با موفقیت به‌روزرسانی شد ✓');
  } catch (e) {
    if (e.message !== 'unauthorized') toast(e.message || 'خطا در ذخیره تعداد میزها', true);
  }
}

async function uploadSiteImage(input, kind) {
  let file = input.files[0]; if (!file) return;
  if (file.size > MAX_INPUT_BYTES) { toast('حجم فایل خیلی زیاده (حداکثر 5MB)', true); return; }
  toast('⏳ در حال آپلود...');
  file = await resizeImageForUpload(file, kind === 'logo' ? 600 : 1600);
  if (file.size > MAX_UPLOAD_BYTES) { toast('حجم عکس بعد از فشرده‌سازی هم بیشتر از 2MB است', true); return; }
  const fd = new FormData(); fd.append('file', file);
  try {
    await api(`/site/${kind}`, { method: 'POST', body: fd });
    toast('تصویر به‌روزرسانی شد ✓');
    loadSiteImages();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message || 'خطا در آپلود', true); }
}

async function removeSiteImg(kind) {
  if (!confirm(`حذف ${SITE_IMG_LABELS[kind]}؟`)) return;
  try {
    await api(`/site/${kind}`, { method: 'DELETE' });
    toast('حذف شد');
    loadSiteImages();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message || 'خطا در حذف', true); }
}

// ── Utils ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// آیدی دسته رو به اسمش تبدیل می‌کنه (اگه پیدا نشد، خود آیدی یا «—»)
function catLabel(id) {
  const c = allCategories.find(x => x.id === id);
  return c ? c.label : (id || '—');
}

function openModal(id) { document.getElementById(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; }

// شنود خطای لود عکس‌های پیش‌نمایش در پنل ادمین
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el && el.tagName === 'IMG' && el.classList.contains('img-preview')) {
    el.style.display = 'none';
  }
}, true);

// ── Document Event Listeners (بدون هندلرهای درون‌خطی در HTML) ────────────────
document.addEventListener('click', (e) => {
  const loginBtn = e.target.closest('#login-btn');
  if (loginBtn) {
    doLogin();
    return;
  }

  const logoutBtn = e.target.closest('#logout-btn');
  if (logoutBtn) {
    doLogout();
    return;
  }

  const navBtn = e.target.closest('.nav-btn');
  if (navBtn && navBtn.dataset.tab) {
    showTab(navBtn.dataset.tab, navBtn);
    return;
  }

  const closeBtn = e.target.closest('[data-close-modal]');
  if (closeBtn) {
    closeModal(closeBtn.dataset.closeModal);
    return;
  }

  const pAvail = e.target.closest('#p-avail');
  if (pAvail) {
    pAvail.classList.toggle('on');
    syncAvailLabel();
    return;
  }

  const saveProdBtn = e.target.closest('#save-prod-btn');
  if (saveProdBtn) {
    saveProduct();
    return;
  }

  const saveCatBtn = e.target.closest('#save-cat-btn');
  if (saveCatBtn) {
    saveCat();
    return;
  }

  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'refresh-orders') {
    manualRefreshOrders();
  } else if (action === 'load-more-orders') {
    loadOrders(true);
  } else if (action === 'order-resolve') {
    resolveOrderWeb(Number(actionEl.dataset.orderId), actionEl.dataset.orderStatus);
  } else if (action === 'quick-add-prod') {
    quickAddProduct();
  } else if (action === 'quick-add-cat') {
    quickAddCategory();
  } else if (action === 'open-prod-modal') {
    openProductModal(actionEl.dataset.prodId || null);
  } else if (action === 'delete-prod') {
    deleteProduct(actionEl.dataset.prodId);
  } else if (action === 'toggle-avail') {
    toggleAvail(actionEl.dataset.prodId, actionEl.dataset.curAvail === '1' || actionEl.dataset.curAvail === 'true');
  } else if (action === 'open-cat-modal') {
    openCatModal(actionEl.dataset.catId || null);
  } else if (action === 'delete-cat') {
    deleteCat(actionEl.dataset.catId);
  } else if (action === 'print-table-qr') {
    window.print();
  } else if (action === 'copy-table-url') {
    copyTableUrl(actionEl.dataset.url);
  } else if (action === 'remove-site-img') {
    removeSiteImg(actionEl.dataset.kind);
  } else if (action === 'save-table-count') {
    saveTableCount();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'p-price' || e.target.id === 'p-discount') {
    updateDiscPreview();
  } else if (e.target.matches('[data-action="search-products"]')) {
    searchQ = e.target.value;
    renderProductTable();
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'p-file-input') {
    handleImageSelect(e.target, 'prod');
  } else if (e.target.id === 'c-file-input') {
    handleImageSelect(e.target, 'cat');
  } else if (e.target.matches('[data-upload-site]')) {
    uploadSiteImage(e.target, e.target.dataset.uploadSite);
  } else if (e.target.matches('[data-action="filter-orders"]')) {
    currentOrderFilter = e.target.value;
    loadOrders(false, 50);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'pw' && e.key === 'Enter') {
    doLogin();
  }
});

// اعتبارسنجی وضعیت ورود با کوکی امن HttpOnly
(async function checkInitialAuth() {
  try {
    const r = await fetch(`${BASE}/me`, {
      credentials: 'same-origin',
    });
    if (r.ok) {
      initApp();
      return;
    }
  } catch {}
  doLogout();
})();
