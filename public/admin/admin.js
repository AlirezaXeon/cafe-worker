const BASE = '/admin/api';
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
let filterCat = '';
let filterAvail = '';
let productViewMode = localStorage.getItem('admin_prod_view') || 'table'; // 'table' | 'grid'
let catSearchQ = '';
let opsClockTimer = null;

// ── Theme (Dark / Light) ──────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('admin_theme');
  if (saved === 'dark') {
    document.body.classList.add('dark');
  }
  updateThemeBtn();
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('admin_theme', isDark ? 'dark' : 'light');
  updateThemeBtn();
}

function updateThemeBtn() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  btn.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
}

initTheme();

// ── Audio Alert (صدای سفارش جدید) ──────────────────────────────────────────
let soundEnabled = localStorage.getItem('admin_sound_enabled') !== 'false';
let audioCtx = null;

function initSound() {
  updateSoundBtn();
}

function updateSoundBtn() {
  const btn = document.getElementById('sound-toggle-btn');
  if (!btn) return;
  btn.textContent = soundEnabled ? '🔔' : '🔕';
  btn.title = soundEnabled ? 'هشدار صوتی سفارش جدید: فعال' : 'هشدار صوتی سفارش جدید: غیرفعال';
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('admin_sound_enabled', soundEnabled ? 'true' : 'false');
  updateSoundBtn();
  if (soundEnabled) {
    playOrderNotificationSound();
    toast('هشدار صوتی فعال شد 🔔');
  } else {
    toast('هشدار صوتی غیرفعال شد 🔕');
  }
}

function playOrderNotificationSound() {
  if (!soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.45);
  } catch (e) {
    console.warn('[sound] audio playback error:', e);
  }
}

initSound();

// ── Lightbox (بزرگ‌نمایی تصاویر) ───────────────────────────────────────────
function openLightbox(src, caption = '') {
  if (!src) return;
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  img.src = src;
  cap.textContent = caption;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.classList.remove('open');
  // اگه مودالی زیر لایت‌باکس بازه، اسکرول قفل بمونه
  document.body.style.overflow = document.querySelector('.overlay.open') ? 'hidden' : '';
}

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
  stopOpsClock();
  try {
    await fetch(`${BASE}/logout`, { method: 'POST', credentials: 'same-origin' });
  } catch { }
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
    cache: 'no-store',
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

// ── کنترلر پولینگ سفارش‌ها ────────────────────────────────────────────────
const ACTIVE_POLL_MS = 3000;    // هر ۳ ثانیه وقتی صفحه فعال است (همگام با ربات)
const HIDDEN_POLL_MS = 15000;   // هر ۱۵ ثانیه در پس‌زمینه
const MAX_BACKOFF_MS = 30000;   // حداکثر زمان انتظار در صورت خطا

let adminPollTimer = null;
let currentPollInterval = ACTIVE_POLL_MS;
let isPollingActive = false;
let isPollInProgress = false;
let pendingPollRequested = false;
let lastKnownSummary = { pending: null, latestId: null };
let currentActiveTab = 'dashboard';
let currentOrderFilter = '';
let orderTableFilter = '';   // فیلتر شماره میز (سمت کلاینت)
let ordersPreset = null;     // { status, table } برای باز کردن تب سفارش‌ها با فیلتر از پیش‌تعیین‌شده
const originalDocTitle = document.title;

function startAdminPolling() {
  if (isPollingActive) return;
  isPollingActive = true;
  currentPollInterval = document.hidden ? HIDDEN_POLL_MS : ACTIVE_POLL_MS;
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
  document.title = originalDocTitle;
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

  const targetInterval = document.hidden ? HIDDEN_POLL_MS : ACTIVE_POLL_MS;

  if (isPollInProgress) {
    pendingPollRequested = true;
    return;
  }
  isPollInProgress = true;
  try {
    const summary = await api('/orders/summary');
    currentPollInterval = targetInterval;

    const pendingCount = Number(summary?.pending ?? 0);
    const latestId = Number(summary?.latestId ?? 0);

    updatePendingBadge(pendingCount);

    const prevPending = lastKnownSummary.pending;
    const prevLatestId = lastKnownSummary.latestId;
    const isInitial = prevPending === null && prevLatestId === null;

    const hasChanged = !isInitial && (prevPending !== pendingCount || prevLatestId !== latestId);
    const hasNewOrder = !isInitial && (
      (latestId > (prevLatestId || 0)) ||
      (pendingCount > (prevPending || 0))
    );

    lastKnownSummary = { pending: pendingCount, latestId };

    if (hasNewOrder) {
      playOrderNotificationSound();
      toast('🔔 سفارش جدید ثبت شد!');
      if (document.hidden) {
        document.title = `(🔔 ${pendingCount} سفارش در انتظار) ${originalDocTitle}`;
      }
    }

    if (hasChanged) {
      if (currentActiveTab === 'orders' && document.getElementById('order-list-wrap')) {
        // تازه‌سازی لیست سفارش‌ها در تب مدیریت سفارش‌ها
        await refreshOrdersHead();
      } else if (currentActiveTab === 'dashboard') {
        // تازه‌سازی آنی آمار و ماتریس میزهای داشبورد باریستا
        await refreshDashboardOrders();
      }
    }
  } catch (err) {
    if (err.message === 'unauthorized') {
      stopAdminPolling();
      return;
    }
    currentPollInterval = Math.min(currentPollInterval * 1.5, MAX_BACKOFF_MS);
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
  if (!document.hidden) {
    document.title = originalDocTitle;
    if (isPollingActive && isLoggedIn) {
      pollOrdersNow();
    }
  }
});

window.addEventListener('focus', () => {
  document.title = originalDocTitle;
  if (isPollingActive && isLoggedIn) {
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
  const preset = ordersPreset;
  ordersPreset = null;
  currentOrderFilter = preset?.status || '';
  orderTableFilter = preset?.table || '';
  const sel = (v) => (currentOrderFilter === v ? 'selected' : '');
  m.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>🧾 مدیریت سفارش‌ها</h2>
        <button class="btn btn-ghost btn-sm" data-action="refresh-orders">🔄 تازه‌سازی</button>
      </div>
      <div class="card-toolbar">
        <select class="search-input" style="max-width:220px" data-action="filter-orders" aria-label="فیلتر وضعیت سفارش">
          <option value="" ${sel('')}>همه وضعیت‌ها</option>
          <option value="pending" ${sel('pending')}>⏳ در انتظار تایید</option>
          <option value="confirmed" ${sel('confirmed')}>✅ تایید شده</option>
          <option value="rejected" ${sel('rejected')}>❌ رد شده</option>
        </select>
        <span id="order-table-chip"></span>
      </div>
      <div id="order-list-wrap"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
    </div>`;
  loadOrders(false);
  pollOrdersNow();
}

async function manualRefreshOrders() {
  toast('در حال به‌روزرسانی...');
  try {
    await refreshOrdersHead();
  } catch (e) {
    if (e.message !== 'unauthorized') toast(e.message || 'خطا در به‌روزرسانی', true);
  }
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

function ordersQuery(limit, beforeId) {
  let qs = `?limit=${limit}`;
  if (currentOrderFilter) qs += `&status=${encodeURIComponent(currentOrderFilter)}`;
  if (beforeId) qs += `&before_id=${beforeId}`;
  return qs;
}

// بارگذاری اولیه (append=false) یا صفحه‌ی بعدی (append=true)
async function loadOrders(append = false) {
  const wrap = document.getElementById('order-list-wrap');
  if (!wrap) return;
  try {
    const limit = 50;
    const beforeId = append && currentOrdersList.length
      ? currentOrdersList[currentOrdersList.length - 1].id
      : null;
    const orders = await api('/orders' + ordersQuery(limit, beforeId));
    currentOrdersList = append ? currentOrdersList.concat(orders) : orders;
    hasMoreOrders = orders.length === limit;
    renderOrderList();
  } catch (e) {
    if (e.message !== 'unauthorized') wrap.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>خطا در بارگذاری</div>';
  }
}

// تازه‌سازی ابتدای لیست بدون از دست دادن سفارش‌های قدیمی‌تر که کاربر قبلاً بارگذاری کرده
async function refreshOrdersHead() {
  const limit = 100; // سقف سمت سرور
  const fresh = await api('/orders' + ordersQuery(limit));
  if (fresh.length < limit) {
    currentOrdersList = fresh;
    hasMoreOrders = false;
  } else {
    const minId = fresh[fresh.length - 1].id;
    const tail = currentOrdersList.filter((o) => o.id < minId);
    currentOrdersList = fresh.concat(tail);
    hasMoreOrders = true;
  }
  renderOrderList();
}

function renderOrderTableChip() {
  const chip = document.getElementById('order-table-chip');
  if (!chip) return;
  chip.innerHTML = orderTableFilter
    ? `<span class="prod-filter-pill"><span>میز ${esc(orderTableFilter)}</span><span class="remove-filter" role="button" tabindex="0" data-action="clear-order-table" title="حذف فیلتر میز">✕</span></span>`
    : '';
}

function renderOrderList() {
  const wrap = document.getElementById('order-list-wrap');
  if (!wrap) return;
  renderOrderTableChip();

  const list = orderTableFilter
    ? currentOrdersList.filter((o) => String(o.table_number) === orderTableFilter)
    : currentOrdersList;

  const moreBtn = hasMoreOrders ? `
      <div style="text-align:center;padding-bottom:1.25rem;">
        <button class="btn btn-ghost" data-action="load-more-orders">بارگذاری بیشتر...</button>
      </div>` : '';

  if (!list.length) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">📭</div>سفارشی یافت نشد</div>${moreBtn}`;
    return;
  }
  const statusLabel = { pending: 'در انتظار', confirmed: 'تایید شده', rejected: 'رد شده' };
  wrap.innerHTML = `<div class="order-list">${list.map(o => {
    const time = formatOrderDateTime(o.created_at);
    return `
      <div class="order-card">
        <div class="order-card-head">
          <span class="order-table-no">سفارش #${o.id} — میز ${esc(o.table_number)}</span>
          <span class="order-status ${esc(o.status)}">${statusLabel[o.status] || esc(o.status)}</span>
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
  }).join('')}</div>${moreBtn}`;
}

async function resolveOrderWeb(id, status) {
  try {
    await api(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(status === 'confirmed' ? 'سفارش تایید شد ✓' : 'سفارش رد شد');
    await refreshOrdersHead();
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

// ── Clock & Live Ops Helpers ──────────────────────────────────────────────
function updateOpsClock() {
  const el = document.getElementById('ops-clock');
  if (!el) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Tehran',
  });
  el.textContent = `ساعت: ${timeStr}`;
}

function startOpsClock() {
  if (opsClockTimer) clearInterval(opsClockTimer);
  updateOpsClock();
  opsClockTimer = setInterval(updateOpsClock, 1000);
}

function stopOpsClock() {
  if (opsClockTimer) {
    clearInterval(opsClockTimer);
    opsClockTimer = null;
  }
}

function switchTab(tabName) {
  const btn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
  showTab(tabName, btn);
}

// ── Tabs ──────────────────────────────────────────────────────────────────
function showTab(tab, btn) {
  currentActiveTab = tab;
  if (tab !== 'dashboard') stopOpsClock();
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

// ── Dashboard (Idea 3: High-Density Operations & Barista Dashboard) ────────
async function renderDashboard(m) {
  m.innerHTML = `
    <div class="ops-hero">
      <div class="ops-hero-info">
        <h2>داشبورد عملیات باریستا و سالن</h2>
        <div class="ops-hero-meta">
          <span class="ops-pill">🟢 سیستم آنلاین</span>
          <span class="ops-pill" id="ops-clock">ساعت: --:--</span>
          <span class="ops-pill" id="ops-pending-pill" data-action="quick-go-orders" style="cursor:pointer">
            در حال بارگذاری وضعیت صف...
          </span>
        </div>
      </div>
    </div>

    <div class="ops-kpi-grid">
      <div class="ops-kpi-card" data-kpi="sales">
        <div class="ops-kpi-head">
          <span class="ops-kpi-title">فروش تاییدشده امروز</span>
          <span class="ops-kpi-icon">💰</span>
        </div>
        <div class="ops-kpi-val" id="kpi-sales-today">—</div>
        <div class="ops-kpi-sub">
          <span id="kpi-sales-week">هفته: —</span>
          <span>•</span>
          <span id="kpi-sales-month">ماه: —</span>
        </div>
      </div>

      <div class="ops-kpi-card" data-kpi="orders" data-action="quick-go-orders" style="cursor:pointer" title="مشاهده سفارش‌ها">
        <div class="ops-kpi-head">
          <span class="ops-kpi-title">سفارش‌های در انتظار</span>
          <span class="ops-kpi-icon">🧾</span>
        </div>
        <div class="ops-kpi-val" id="kpi-orders-val">—</div>
        <div class="ops-kpi-sub" id="kpi-orders-sub">
          <span>وضعیت صف سالن</span>
          <span>مشاهده لیست ←</span>
        </div>
      </div>

      <div class="ops-kpi-card" data-kpi="menu">
        <div class="ops-kpi-head">
          <span class="ops-kpi-title">موجودی اقلام بار</span>
          <span class="ops-kpi-icon">☕</span>
        </div>
        <div class="ops-kpi-val" id="kpi-menu-val">—</div>
        <div class="ops-kpi-sub" id="kpi-menu-sub">
          <span>در دسته‌بندی‌ها</span>
        </div>
      </div>

      <div class="ops-kpi-card" data-kpi="tables" data-action="quick-go-qr" style="cursor:pointer" title="مشاهده بارکدهای QR">
        <div class="ops-kpi-head">
          <span class="ops-kpi-title">میزها و بارکد سالن</span>
          <span class="ops-kpi-icon">📱</span>
        </div>
        <div class="ops-kpi-val" id="kpi-tables-val">—</div>
        <div class="ops-kpi-sub" id="kpi-tables-sub">
          <span>امضای QR</span>
          <span>دریافت بارکد ←</span>
        </div>
      </div>
    </div>

    <div class="ops-quick-row">
      <button class="ops-quick-btn" data-action="quick-add-prod">
        <span class="btn-icon">⚡</span>
        <span>ثبت محصول جدید</span>
      </button>
      <button class="ops-quick-btn" data-action="quick-add-cat">
        <span class="btn-icon">📂</span>
        <span>دسته‌بندی جدید</span>
      </button>
      <button class="ops-quick-btn" data-action="quick-go-orders">
        <span class="btn-icon">🧾</span>
        <span id="quick-orders-label">صف سفارش‌ها</span>
      </button>
      <button class="ops-quick-btn" data-action="quick-go-qr">
        <span class="btn-icon">📱</span>
        <span>بارکد QR میزها</span>
      </button>
      <a class="ops-quick-btn" href="/" target="_blank" rel="noopener">
        <span class="btn-icon">🌐</span>
        <span>مشاهده منوی مشتری</span>
      </a>
    </div>

    <div class="ops-workspace">
      <div class="ops-panel">
        <div class="ops-panel-header">
          <h3>
            <span>🪑 ماتریس زنده وضعیت میزها</span>
          </h3>
          <span class="ops-pill" id="ops-table-matrix-pill">—</span>
        </div>
        <div class="table-matrix-grid" id="ops-table-grid">
          <div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری میزها...</div>
        </div>
      </div>

      <div class="ops-panel">
        <div class="ops-panel-header">
          <h3>
            <span>⚠️ اقلام ناموجود (تغییر وضعیت آنی)</span>
          </h3>
          <span class="ops-pill" id="ops-stock-pill">—</span>
        </div>
        <div class="stock-alert-list" id="ops-stock-list">
          <div class="empty"><div class="empty-icon">⏳</div>در حال بررسی موجودی...</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>📊 تراکم و موجودی محصولات در هر دسته‌بندی</h2>
        <span style="font-size:0.8rem;color:var(--muted)">کلیک روی هر دسته جهت فیلتر و مشاهده محصولات</span>
      </div>
      <div id="cat-breakdown" style="padding:1.2rem 1.35rem">
        <div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div>
      </div>
    </div>`;

  startOpsClock();

  try {
    const [cats, prods] = await Promise.all([
      api('/categories'),
      api('/products'),
    ]);

    allCategories = cats;
    allProducts = prods;

    // KPI 3 + لیست ناموجودها + تراکم دسته‌ها
    updateDashboardInventory();

    // سفارش‌ها، آمار فروش و ماتریس میزها
    await refreshDashboardOrders();
  } catch (e) {
    if (e.message !== 'unauthorized') toast('خطا در بارگذاری آمار داشبورد', true);
  }
}

// به‌روزرسانی زنده بخش سفارش‌ها، آمار فروش و ماتریس میزهای داشبورد بدون بازسازی کل صفحه
async function refreshDashboardOrders() {
  if (currentActiveTab !== 'dashboard') return;
  try {
    const [sales, siteCfg, pendingOrders] = await Promise.all([
      api('/sales-stats').catch(() => null),
      api('/site').catch(() => ({ tableCount: 20, signingEnabled: false })),
      api('/orders?status=pending&limit=100').catch(() => []),
    ]);

    const pendingList = Array.isArray(pendingOrders) ? pendingOrders : [];
    const pendingCount = pendingList.length;
    const tableCount = Number(siteCfg?.tableCount) || 20;

    updatePendingBadge(pendingCount);

    // Hero pending pill
    const pendingPill = document.getElementById('ops-pending-pill');
    if (pendingPill) {
      if (pendingCount > 0) {
        pendingPill.className = 'ops-pill alert';
        pendingPill.innerHTML = `🔔 ${pendingCount} سفارش در انتظار بررسی`;
      } else {
        pendingPill.className = 'ops-pill';
        pendingPill.innerHTML = '✓ تمامی سفارش‌ها پاسخ داده شدند';
      }
    }

    // KPI 1: Sales
    if (sales) {
      const sToday = document.getElementById('kpi-sales-today');
      if (sToday) sToday.textContent = Number(sales?.today || 0).toLocaleString('fa-IR') + ' ت';
      const sWeek = document.getElementById('kpi-sales-week');
      if (sWeek) sWeek.textContent = 'هفته: ' + Number(sales?.week || 0).toLocaleString('fa-IR') + ' ت';
      const sMonth = document.getElementById('kpi-sales-month');
      if (sMonth) sMonth.textContent = 'ماه: ' + Number(sales?.month || 0).toLocaleString('fa-IR') + ' ت';
    }

    // KPI 2: Orders
    const kOrdersVal = document.getElementById('kpi-orders-val');
    if (kOrdersVal) {
      kOrdersVal.textContent = pendingCount ? `${pendingCount} سفارش باز` : 'صف خلوت';
      kOrdersVal.className = 'ops-kpi-val' + (pendingCount > 0 ? ' highlight-alert' : '');
    }
    const kOrdersSub = document.getElementById('kpi-orders-sub');
    if (kOrdersSub) {
      kOrdersSub.innerHTML = pendingCount > 0
        ? '<span style="color:var(--danger);font-weight:700">اقدام سریع باریستا</span><span>مشاهده ←</span>'
        : '<span>همه سفارش‌ها تایید/رد شده‌اند</span><span>مشاهده لیست ←</span>';
    }

    // KPI 4: Tables
    const kTablesVal = document.getElementById('kpi-tables-val');
    if (kTablesVal) kTablesVal.textContent = `${tableCount} میز سالن`;
    const kTablesSub = document.getElementById('kpi-tables-sub');
    if (kTablesSub) {
      kTablesSub.innerHTML = `<span>امضا: ${siteCfg?.signingEnabled ? '✅ فعال' : 'غیرفعال'}</span><span>دانلود QR ←</span>`;
    }

    // Quick row order button label
    const quickOrdersLabel = document.getElementById('quick-orders-label');
    if (quickOrdersLabel) {
      quickOrdersLabel.textContent = pendingCount > 0 ? `صف سفارش‌ها (${pendingCount})` : 'صف سفارش‌ها';
    }

    // Workspace: Live Table Matrix Grid
    const pendingTables = new Map();
    pendingList.forEach(o => {
      const tNum = Number(o.table_number);
      if (!isNaN(tNum)) {
        pendingTables.set(tNum, (pendingTables.get(tNum) || 0) + 1);
      }
    });

    const tableGrid = document.getElementById('ops-table-grid');
    const tableMatrixPill = document.getElementById('ops-table-matrix-pill');
    if (tableMatrixPill) tableMatrixPill.textContent = `${tableCount} میز`;

    if (tableGrid) {
      const tilesHtml = [];
      for (let i = 1; i <= tableCount; i++) {
        const orderCount = pendingTables.get(i) || 0;
        const hasPending = orderCount > 0;
        tilesHtml.push(`
          <div class="table-tile ${hasPending ? 'has-pending' : ''}"
               data-action="ops-select-table"
               data-table="${i}"
               role="button" tabindex="0"
               title="${hasPending ? `میز ${i} — ${orderCount} سفارش در انتظار` : `میز ${i} — بدون سفارش در انتظار`}">
            <span class="table-tile-num">میز ${i}</span>
            <span class="table-tile-status">${hasPending ? `🔔 ${orderCount}` : 'خالی'}</span>
          </div>
        `);
      }
      tableGrid.innerHTML = tilesHtml.join('');
    }
  } catch (e) {
    if (e.message !== 'unauthorized') console.warn('[dashboard:refreshOrders]', e);
  }
}

// به‌روزرسانی بخش‌های وابسته به موجودی محصولات (KPI منو، لیست ناموجودها، تراکم دسته‌ها)
// بدون ساخت دوباره‌ی کل داشبورد و بدون درخواست اضافه به API
function updateDashboardInventory() {
  const total = allProducts.length;
  const avail = allProducts.filter(p => p.available).length;
  const unavail = total - avail;

  const kMenuVal = document.getElementById('kpi-menu-val');
  if (kMenuVal) {
    kMenuVal.innerHTML = `${avail} <span style="font-size:0.95rem;font-weight:600;color:var(--muted)">/ ${total} موجود</span>`;
  }
  const kMenuSub = document.getElementById('kpi-menu-sub');
  if (kMenuSub) {
    kMenuSub.innerHTML = unavail > 0
      ? `<span style="color:var(--danger);font-weight:700">⚠️ ${unavail} قلم ناموجود</span><span>در ${allCategories.length} دسته</span>`
      : `<span>✓ تمام ${total} قلم موجود</span><span>در ${allCategories.length} دسته</span>`;
  }

  const stockList = document.getElementById('ops-stock-list');
  const stockPill = document.getElementById('ops-stock-pill');
  if (stockPill) {
    stockPill.textContent = `${unavail} قلم`;
    stockPill.className = 'ops-pill' + (unavail > 0 ? ' alert' : '');
  }

  if (stockList) {
    const unavailList = allProducts.filter(p => !p.available);
    if (!unavailList.length) {
      stockList.innerHTML = `
          <div class="stock-empty-good">
            <div class="stock-empty-icon">☕✨</div>
            <div>تمام محصولات بار و انبار موجود هستند!</div>
            <div style="font-size:0.75rem;font-weight:normal;color:var(--muted)">هیچ محصول ناموجودی در منو ثبت نشده است.</div>
          </div>`;
    } else {
      stockList.innerHTML = unavailList.map(p => {
        const cat = allCategories.find(c => c.id === p.category);
        const catLabelText = cat ? cat.label : 'بدون دسته';
        return `
            <div class="stock-alert-item">
              <div style="min-width:0;flex:1">
                <div class="stock-alert-name" title="${esc(p.name)}">${esc(p.name)}</div>
                <div class="stock-alert-cat">${esc(catLabelText)} • ${Number(p.price).toLocaleString('fa-IR')} ت</div>
              </div>
              <button class="btn btn-primary btn-sm" data-action="ops-quick-avail" data-prod-id="${esc(p.id)}" title="تغییر وضعیت به موجود">
                ✓ موجود شد
              </button>
            </div>`;
      }).join('');
    }
  }

  const breakdown = document.getElementById('cat-breakdown');
  if (breakdown) {
    const counts = allCategories
      .map(c => {
        const prodsInCat = allProducts.filter(p => p.category === c.id);
        return {
          id: c.id,
          label: c.label,
          count: prodsInCat.length,
          avail: prodsInCat.filter(p => p.available).length
        };
      })
      .sort((a, b) => b.count - a.count);

    const max = Math.max(1, ...counts.map(c => c.count));
    breakdown.innerHTML = counts.length
      ? counts.map(c => `
          <div class="cat-breakdown-item" data-action="view-cat-products" data-cat-id="${esc(c.id)}" role="button" tabindex="0" style="cursor:pointer" title="مشاهده محصولات دسته «${esc(c.label)}»">
            <div class="cb-label" title="${esc(c.label)}">${esc(c.label)}</div>
            <div class="cb-bar-track"><div class="cb-bar-fill" style="width:${(c.count / max) * 100}%"></div></div>
            <div class="cb-count">${c.count} (${c.avail} موجود)</div>
          </div>`).join('')
      : '<div class="empty"><div class="empty-icon">📭</div>هنوز دسته‌بندی‌ای ثبت نشده است</div>';
  }
}

async function quickToggleAvail(id) {
  try {
    const res = await api(`/products/${encodeURIComponent(id)}/availability`, { method: 'PATCH' });
    const p = allProducts.find(x => x.id === id);
    if (p) p.available = res.available;
    toast(res.available ? 'محصول موجود شد ✓' : 'محصول ناموجود شد');
    updateDashboardInventory();
  } catch (e) {
    if (e.message !== 'unauthorized') toast(e.message || 'خطا در تغییر وضعیت', true);
  }
}

async function quickAddProduct() {
  switchTab('products');
  openProductModal();
}

async function quickAddCategory() {
  switchTab('categories');
  openCatModal();
}

const imgSrc = (p) => p ? '/' + String(p).replace(/^\/+/, '') : '';

// ── Products (با فیلتر، تغییر نما، آمار وضعیت و بزرگ‌نمایی عکس) ─────────────
async function renderProducts(m) {
  m.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
          <h2>🍽 مدیریت محصولات</h2>
          <span class="cat-count-badge" id="prod-total-badge">در حال بارگذاری...</span>
        </div>
        <div class="actions">
          <button class="btn btn-ghost btn-sm ${productViewMode === 'table' ? 'active' : ''}" data-action="set-prod-view" data-view="table" title="نمای جدولی">📋 جدول</button>
          <button class="btn btn-ghost btn-sm ${productViewMode === 'grid' ? 'active' : ''}" data-action="set-prod-view" data-view="grid" title="نمای کارتی بزرگ">🗂 گالری کارت</button>
          <button class="btn btn-primary btn-sm" data-action="open-prod-modal">+ محصول جدید</button>
        </div>
      </div>
      <div class="card-toolbar">
        <input class="search-input" placeholder="🔍 جستجوی نام یا توضیحات محصول..." value="${esc(searchQ)}" data-action="search-products" />
        <select class="search-input" style="max-width:190px" id="prod-cat-filter" data-action="filter-prod-cat" aria-label="فیلتر دسته‌بندی">
          <option value="">همه دسته‌بندی‌ها</option>
        </select>
        <select class="search-input" style="max-width:170px" id="prod-avail-filter" data-action="filter-prod-avail" aria-label="فیلتر وضعیت">
          <option value="" ${filterAvail === '' ? 'selected' : ''}>همه وضعیت‌ها</option>
          <option value="1" ${filterAvail === '1' ? 'selected' : ''}>✅ فقط موجود</option>
          <option value="0" ${filterAvail === '0' ? 'selected' : ''}>⛔ فقط ناموجود</option>
          <option value="disc" ${filterAvail === 'disc' ? 'selected' : ''}>🏷 فقط تخفیف‌دار</option>
        </select>
      </div>
      <div class="prod-stats-strip" id="prod-stats-strip">
        <div class="prod-stat-chip active">در حال بارگذاری آمار...</div>
      </div>
      <div class="table-wrap" id="prod-table"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
    </div>`;

  try {
    [allProducts, allCategories] = await Promise.all([api('/products'), api('/categories')]);
    const catFilterEl = document.getElementById('prod-cat-filter');
    if (catFilterEl) {
      catFilterEl.innerHTML = '<option value="">همه دسته‌بندی‌ها</option>' +
        allCategories.map(c => `<option value="${esc(c.id)}" ${filterCat === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
    }
    renderProductTable();
  } catch (e) {
    if (e.message !== 'unauthorized')
      document.getElementById('prod-table').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>خطا در بارگذاری محصولات</div>';
  }
}

function renderProductTable() {
  const t = document.getElementById('prod-table'); if (!t) return;
  const q = searchQ.trim().toLowerCase();

  const total = allProducts.length;
  const availCount = allProducts.filter(p => p.available).length;
  const unavailCount = total - availCount;
  const discCount = allProducts.filter(p => p.original_price && p.original_price > p.price).length;

  const totalBadge = document.getElementById('prod-total-badge');
  if (totalBadge) totalBadge.textContent = `${total} محصول`;

  const stripEl = document.getElementById('prod-stats-strip');
  if (stripEl) {
    const activeCat = allCategories.find(c => c.id === filterCat);
    stripEl.innerHTML = `
      <div class="prod-stat-chip ${filterAvail === '' ? 'active' : ''}" data-action="quick-filter-avail" data-avail="" title="نمایش همه محصولات">
        📋 همه (${total})
      </div>
      <div class="prod-stat-chip green ${filterAvail === '1' ? 'active' : ''}" data-action="quick-filter-avail" data-avail="1" title="فیلتر محصولات موجود">
        ✅ موجود (${availCount})
      </div>
      <div class="prod-stat-chip red ${filterAvail === '0' ? 'active' : ''}" data-action="quick-filter-avail" data-avail="0" title="فیلتر محصولات ناموجود">
        ⛔ ناموجود (${unavailCount})
      </div>
      <div class="prod-stat-chip gold ${filterAvail === 'disc' ? 'active' : ''}" data-action="quick-filter-avail" data-avail="disc" title="فیلتر محصولات تخفیف‌دار">
        🏷 دارای تخفیف (${discCount})
      </div>
      <div class="prod-active-filters">
        ${activeCat ? `
          <span class="prod-filter-pill">
            <span>دسته: ${esc(activeCat.label)}</span>
            <span class="remove-filter" data-action="clear-cat-filter" title="حذف فیلتر دسته">✕</span>
          </span>` : ''}
        ${q ? `
          <span class="prod-filter-pill">
            <span>جستجو: «${esc(searchQ)}»</span>
            <span class="remove-filter" data-action="clear-search-filter" title="حذف جستجو">✕</span>
          </span>` : ''}
      </div>`;
  }

  const rows = allProducts.filter(p => {
    if (q) {
      const matchName = (p.name || '').toLowerCase().includes(q);
      const matchCat = catLabel(p.category).toLowerCase().includes(q);
      const matchNote = (p.note || '').toLowerCase().includes(q);
      if (!matchName && !matchCat && !matchNote) return false;
    }
    if (filterCat && p.category !== filterCat) return false;
    if (filterAvail === '1' && !p.available) return false;
    if (filterAvail === '0' && p.available) return false;
    if (filterAvail === 'disc' && (!p.original_price || p.original_price <= p.price)) return false;
    return true;
  });

  if (!rows.length) {
    t.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔍</div>
        <div style="font-weight:700;font-size:1.05rem;margin-bottom:0.4rem">محصولی با این مشخصات یافت نشد</div>
        <div style="font-size:0.82rem;color:var(--muted)">می‌توانید فیلترها را پاک کنید یا محصول جدیدی اضافه نمایید.</div>
        ${(filterCat || filterAvail || q) ? `
          <button class="btn btn-ghost btn-sm" data-action="clear-all-prod-filters" style="margin-top:1rem">
            پاک کردن تمام فیلترها
          </button>` : ''}
      </div>`;
    return;
  }

  if (productViewMode === 'grid') {
    t.innerHTML = `<div class="prod-grid">${rows.map(p => {
      const fullImg = p.image ? imgSrc(p.image) : '';
      const hasDisc = p.original_price && p.original_price > p.price;
      const discPct = hasDisc ? Math.round((1 - p.price / p.original_price) * 100) : 0;
      return `
      <div class="prod-card ${!p.available ? 'is-unavail' : ''}">
        <div class="prod-card-img-wrap">
          <span class="prod-badge-floating ${p.available ? 'avail' : 'unavail'}">
            ${p.available ? '🟢 موجود' : '⛔ ناموجود'}
          </span>
          ${hasDisc ? `<span class="prod-disc-floating">٪${discPct} تخفیف</span>` : ''}
          ${fullImg
          ? `<img src="${esc(fullImg)}" alt="${esc(p.name)}" data-action="zoom-image" data-caption="${esc(p.name)}" loading="lazy">`
          : `<div class="prod-card-placeholder">☕</div>`}
        </div>
        <div class="prod-card-body">
          <div class="prod-card-cat">📂 ${esc(catLabel(p.category))}</div>
          <div class="prod-name" title="${esc(p.name)}">${esc(p.name)}</div>
          ${p.note ? `<div class="prod-note" title="${esc(p.note)}">${esc(p.note)}</div>` : ''}
          <div style="margin-top:auto;padding-top:0.65rem;">
            ${hasDisc ? `<span class="price-orig">${Number(p.original_price).toLocaleString('fa-IR')} ت</span>` : ''}
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span class="price-main">${Number(p.price).toLocaleString('fa-IR')} ت</span>
              ${hasDisc ? `<span class="disc-badge">٪${discPct}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="prod-card-foot">
          <div style="display:flex;align-items:center;gap:0.45rem">
            <button class="toggle ${p.available ? 'on' : ''}" role="switch" aria-checked="${p.available ? 'true' : 'false'}" aria-label="موجودی ${esc(p.name)}" data-action="toggle-avail" data-prod-id="${esc(p.id)}" data-cur-avail="${p.available}" title="${p.available ? 'کلیک جهت تغییر به ناموجود' : 'کلیک جهت تغییر به موجود'}"></button>
            <span style="font-size:0.75rem;font-weight:700;color:${p.available ? 'var(--success)' : 'var(--danger)'}">${p.available ? 'موجود' : 'ناموجود'}</span>
          </div>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" data-action="open-prod-modal" data-prod-id="${esc(p.id)}" title="ویرایش محصول">✏️ ویرایش</button>
            <button class="btn btn-danger btn-sm" data-action="delete-prod" data-prod-id="${esc(p.id)}" title="حذف محصول" aria-label="حذف ${esc(p.name)}">🗑</button>
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;
    return;
  }

  t.innerHTML = `<table>
    <thead>
      <tr>
        <th style="width:78px">تصویر</th>
        <th>محصول و توضیحات</th>
        <th>دسته‌بندی</th>
        <th>قیمت</th>
        <th>وضعیت</th>
        <th style="text-align:center">تغییر موجودی</th>
        <th style="text-align:center">عملیات</th>
      </tr>
    </thead>
    <tbody>${rows.map(p => {
    const fullImg = p.image ? imgSrc(p.image) : '';
    const hasDisc = p.original_price && p.original_price > p.price;
    const discPct = hasDisc ? Math.round((1 - p.price / p.original_price) * 100) : 0;
    return `
      <tr class="${!p.available ? 'prod-row-unavail' : ''}">
        <td>
          ${fullImg
        ? `<img class="img-preview" src="${esc(fullImg)}" alt="${esc(p.name)}" data-action="zoom-image" data-caption="${esc(p.name)}" loading="lazy">`
        : `<div class="img-placeholder">☕</div>`}
        </td>
        <td>
          <div class="prod-name">${esc(p.name)}</div>
          ${p.note ? `<div class="prod-note">${esc(p.note.slice(0, 75))}${p.note.length > 75 ? '…' : ''}</div>` : ''}
        </td>
        <td>
          <span style="background:var(--surface-alt);border:1px solid var(--border);padding:.22rem .65rem;border-radius:20px;font-size:.78rem;font-weight:700;color:var(--text)">
            📂 ${esc(catLabel(p.category))}
          </span>
        </td>
        <td>
          ${hasDisc ? `<div class="price-orig">${Number(p.original_price).toLocaleString('fa-IR')} ت</div>` : ''}
          <div style="display:flex;align-items:center;gap:0.35rem">
            <span class="price-main">${Number(p.price).toLocaleString('fa-IR')} ت</span>
            ${hasDisc ? `<span class="disc-badge">٪${discPct} تخفیف</span>` : ''}
          </div>
        </td>
        <td>
          <span class="prod-status-pill ${p.available ? 'avail' : 'unavail'}">
            ${p.available ? '🟢 موجود' : '⛔ ناموجود'}
          </span>
        </td>
        <td style="text-align:center">
          <button class="toggle ${p.available ? 'on' : ''}" role="switch" aria-checked="${p.available ? 'true' : 'false'}" aria-label="موجودی ${esc(p.name)}" data-action="toggle-avail" data-prod-id="${esc(p.id)}" data-cur-avail="${p.available}" title="${p.available ? 'کلیک جهت ناموجود کردن' : 'کلیک جهت موجود کردن'}"></button>
        </td>
        <td>
          <div class="actions" style="justify-content:center">
            <button class="btn btn-ghost btn-sm" data-action="open-prod-modal" data-prod-id="${esc(p.id)}" title="ویرایش محصول">✏️ ویرایش</button>
            <button class="btn btn-danger btn-sm" data-action="delete-prod" data-prod-id="${esc(p.id)}" title="حذف محصول" aria-label="حذف ${esc(p.name)}">🗑</button>
          </div>
        </td>
      </tr>`;
  }).join('')}
    </tbody></table>`;
}

async function toggleAvail(id) {
  const p = allProducts.find(x => x.id === id); if (!p) return;
  try {
    const res = await api(`/products/${encodeURIComponent(id)}/availability`, { method: 'PATCH' });
    p.available = res.available; renderProductTable();
    toast(p.available ? 'محصول موجود شد ✓' : 'محصول ناموجود شد');
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message || 'خطا در تغییر وضعیت', true); }
}

// ── Categories (نمای کارتی مدرن، جستجو، آمار موجودی و فیلتر سریع) ─────────
async function renderCategories(m) {
  m.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:0.75rem">
          <h2>📂 مدیریت دسته‌بندی‌ها</h2>
          <span class="cat-count-badge" id="cat-total-badge">در حال بارگذاری...</span>
        </div>
        <button class="btn btn-primary btn-sm" data-action="open-cat-modal">+ دسته‌بندی جدید</button>
      </div>
      <div class="card-toolbar">
        <input type="text" class="search-input" placeholder="🔍 جستجو در نام دسته‌بندی‌ها..." data-action="search-cats" value="${esc(catSearchQ)}" />
      </div>
      <div id="cat-list"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
    </div>`;
  await loadCategories();
}

async function loadCategories() {
  try {
    [allCategories, allProducts] = await Promise.all([api('/categories'), api('/products')]);
    renderCategoryList();
  } catch (e) {
    if (e.message !== 'unauthorized') {
      const el = document.getElementById('cat-list');
      if (el) el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>خطا در دریافت اطلاعات دسته‌بندی‌ها</div>';
    }
  }
}

function renderCategoryList() {
  const el = document.getElementById('cat-list');
  if (!el) return;
  const totalBadge = document.getElementById('cat-total-badge');
  if (totalBadge) {
    totalBadge.textContent = `${allCategories.length} دسته‌بندی`;
  }
  if (!allCategories.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>هنوز هیچ دسته‌بندی‌ای ثبت نشده است</div>';
    return;
  }

  const q = catSearchQ.trim().toLowerCase();
  const filtered = q
    ? allCategories.filter(c => (c.label || '').toLowerCase().includes(q))
    : allCategories;

  if (!filtered.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div>دسته‌بندی‌ای با عنوان «${esc(catSearchQ)}» یافت نشد</div>`;
    return;
  }

  el.innerHTML = `<div class="cat-grid">${filtered.map(c => {
    const prodsInCat = allProducts.filter(p => p.category === c.id);
    const count = prodsInCat.length;
    const availCount = prodsInCat.filter(p => p.available).length;
    const unavailCount = count - availCount;
    const fullImg = c.image ? imgSrc(c.image) : '';

    return `
      <div class="cat-item">
        <div class="cat-thumb-wrap">
          ${fullImg
        ? `<img class="cat-thumb" src="${esc(fullImg)}" alt="${esc(c.label)}" data-action="zoom-image" data-caption="${esc(c.label)}" loading="lazy">`
        : '<div class="cat-thumb-placeholder">☕</div>'}
        </div>
        <div class="cat-item-body">
          <div class="cat-item-header">
            <div class="cat-name" title="${esc(c.label)}">${esc(c.label)}</div>
            <span class="cat-count-badge">${count} محصول</span>
          </div>
          <div class="cat-item-meta">
            <span>✅ ${availCount} موجود</span>
            <span>•</span>
            <span style="${unavailCount > 0 ? 'color:var(--danger);font-weight:700' : ''}">⛔ ${unavailCount} ناموجود</span>
          </div>
          <div class="cat-actions">
            <button class="btn btn-ghost btn-sm" data-action="view-cat-products" data-cat-id="${esc(c.id)}" title="مشاهده محصولات این دسته‌بندی">🍽 محصولات</button>
            <button class="btn btn-ghost btn-sm" data-action="open-cat-modal" data-cat-id="${esc(c.id)}" title="ویرایش">✏️ ویرایش</button>
            <button class="btn btn-danger btn-sm" data-action="delete-cat" data-cat-id="${esc(c.id)}" title="حذف دسته‌بندی" aria-label="حذف ${esc(c.label)}">🗑</button>
          </div>
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
      await api(`/categories/${encodeURIComponent(editingCatId)}`, { method: 'PUT', body: JSON.stringify({ label, image }) });
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

async function deleteCat(id) {
  const c = allCategories.find(x => x.id === id);
  if (!confirm(`حذف دسته‌بندی «${c ? c.label : ''}»؟`)) return;
  try {
    await api(`/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('دسته‌بندی حذف شد');
    await loadCategories();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message || 'خطا در حذف', true); }
}

// ── Image Upload ──────────────────────────────────────────────────────────
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
        if (!ext || blob.size >= file.size) return resolve(file);
        const baseName = file.name.replace(/\.[^.]+$/, '');
        resolve(new File([blob], `${baseName}${ext}`, { type: blob.type }));
      }, 'image/webp', quality);
    };
    img.onerror = () => resolve(file);
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
    const p = allProducts.find(x => x.id === id);
    editingProductOriginalPrice = p.original_price != null ? Number(p.original_price) : null;
    editingProductPrice = Number(p.price);
    document.getElementById('p-name').value = p.name;
    document.getElementById('p-note').value = p.note || '';
    document.getElementById('p-img').value = p.image || '';
    catSel.value = p.category || '';

    if (p.original_price && p.original_price > p.price) {
      // با دقت یک رقم اعشار تا تخفیف‌های اعشاری (مثل ۱۲٫۵٪) با ویرایش بی‌تغییر گرد نشن
      const disc = Math.round((1 - p.price / p.original_price) * 1000) / 10;
      document.getElementById('p-price').value = p.original_price;
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
      document.getElementById('prod-upload-status').textContent = '✅ تصویر فعلی (برای بزرگ‌نمایی کلیک کنید)';
    }
    document.getElementById('p-avail').classList.toggle('on', !!p.available);
  } else {
    ['p-name', 'p-price', 'p-discount', 'p-note', 'p-img'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('p-avail').classList.add('on');
    if (filterCat) catSel.value = filterCat;
  }
  syncAvailLabel();
  openModal('product-modal');
}

function updateDiscPreview() {
  const price = Number(document.getElementById('p-price').value);
  const disc = Number(document.getElementById('p-discount').value || 0);
  const prev = document.getElementById('disc-preview');
  if (price > 0 && disc > 0 && disc < 100) {
    const final = Math.round(price * (1 - disc / 100) / 1000) * 1000;
    prev.textContent = `قیمت اصلی: ${price.toLocaleString('fa-IR')} ت  ←  با تخفیف: ${final.toLocaleString('fa-IR')} ت`;
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }
}

function syncAvailLabel() {
  const btn = document.getElementById('p-avail');
  const on = btn.classList.contains('on');
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  document.getElementById('p-avail-lbl').textContent = on ? 'موجود' : 'ناموجود';
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
      await api(`/products/${encodeURIComponent(editingProductId)}`, { method: 'PUT', body: JSON.stringify(body) });
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

async function deleteProduct(id) {
  const p = allProducts.find(x => x.id === id);
  if (!confirm(`حذف «${p ? p.name : ''}»؟`)) return;
  try {
    await api(`/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('محصول حذف شد');
    allProducts = await api('/products');
    renderProductTable();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message || 'خطا در حذف', true); }
}

// ── QR میزها (با قابلیت دانلود تکی فقط خود بارکد به صورت PNG و SVG) ──────────
async function renderTableQr(m) {
  m.innerHTML = `<div class="card">
    <div class="card-header">
      <h2>📱 لینک‌ها و کدهای QR میزها</h2>
      <div class="actions no-print">
        <button class="btn btn-primary btn-sm" data-action="print-table-qr">🖨 چاپ همه کارت‌ها</button>
      </div>
    </div>
    <div id="table-qr-wrap" style="padding:1.25rem"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری لینک‌ها...</div></div>
  </div>`;
  await loadTableQr();
}

function generateQrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  } catch (err) {
    console.error('Failed to generate QR code SVG:', err);
    return '';
  }
}

// دانلود تکی فقط مربع بارکد به صورت PNG با رزولوشن بالا (1000x1000) یا SVG وکتور
function downloadBarcodeOnly(tableNo, format = 'png') {
  const wrap = document.querySelector(`.qr-svg-wrap[data-table="${tableNo}"]`);
  const svgEl = wrap ? wrap.querySelector('svg') : null;
  if (!svgEl) {
    toast('بارکد یافت نشد', true);
    return;
  }

  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const size = 1000;
  clone.setAttribute('width', size);
  clone.setAttribute('height', size);

  const svgData = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });

  if (format === 'svg') {
    const url = URL.createObjectURL(svgBlob);
    triggerDownload(url, `table-${tableNo}-qr.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(`فایل SVG بارکد میز ${tableNo} دانلود شد ✓`);
    return;
  }

  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);

    canvas.toBlob((pngBlob) => {
      if (!pngBlob) {
        toast('خطا در ساخت تصویر بارکد', true);
        return;
      }
      const pngUrl = URL.createObjectURL(pngBlob);
      triggerDownload(pngUrl, `table-${tableNo}-qr.png`);
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1500);
      toast(`تصویر بارکد میز ${tableNo} دانلود شد ✓`);
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast('خطا در پردازش بارکد', true);
  };
  img.src = url;
}

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function loadTableQr() {
  const el = document.getElementById('table-qr-wrap');
  if (!el) return;
  try {
    const data = await api('/table-qr-links');
    const origin = window.location.origin;
    let html = `
      <div class="no-print" style="margin-bottom:1.25rem;padding:0.85rem 1.1rem;background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.88rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:1.25rem;align-items:center;">
        <span>🪑 تعداد کل میزها: <strong style="color:var(--text)">${data.tableCount}</strong></span>
        <span>🔐 وضعیت امضای ضدجعل: 
          <strong style="color:${data.signingEnabled ? 'var(--success)' : 'var(--accent)'}">
            ${!data.signingSecretPresent ? 'غیرفعال (سکرت ست نشده)' : data.signingEnabled ? 'فعال ✓ (الزامی برای ثبت سفارش)' : 'خاموش (لینک‌ها دارای امضا هستند ولی اسکن الزامی نیست)'}
          </strong>
        </span>
        <span style="margin-right:auto;font-size:0.8rem">💡 با دکمه‌های زیر هر کارت، می‌توانید <strong>فقط خود مربع بارکد</strong> را بدون نوشته‌های اطراف دانلود کنید.</span>
      </div>
      <div id="qr-print-sheet">
        <div class="qr-grid">
    `;
    data.links.forEach(l => {
      const fullUrl = `${origin}${l.url}`;
      const qrSvg = generateQrSvg(fullUrl);
      html += `
        <div class="print-card qr-card">
          <div style="font-weight:800;font-size:1.1rem;">☕ کافه روشن</div>
          <div style="font-size:1.25rem;font-weight:800;color:var(--accent);">میز شماره ${l.table}</div>
          <div class="qr-svg-wrap" data-table="${l.table}">
            ${qrSvg}
          </div>
          <div style="font-size:0.78rem;color:var(--muted);">برای ثبت سفارش، بارکد را اسکن کنید:</div>
          <div style="font-family:monospace;direction:ltr;font-size:0.72rem;word-break:break-all;background:var(--surface);border:1px solid var(--border);padding:0.45rem;border-radius:6px;width:100%;">${esc(fullUrl)}</div>
          <div class="qr-btn-group no-print">
            <button class="btn btn-primary btn-sm" data-action="download-qr-only" data-table="${l.table}" data-format="png" title="دانلود فقط بارکد با کیفیت بالا PNG">⬇ بارکد PNG</button>
            <button class="btn btn-ghost btn-sm" data-action="download-qr-only" data-table="${l.table}" data-format="svg" title="دانلود فایل وکتور فقط بارکد SVG">⬇ بارکد SVG</button>
          </div>
          <button class="btn btn-ghost btn-sm btn-block no-print" data-action="copy-table-url" data-url="${esc(fullUrl)}">📋 کپی لینک میز</button>
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

// ── Site images & settings ────────────────────────────────────────────────
const SITE_IMG_LABELS = { logo: 'لوگوی کافه', cover: 'تصویر کاور بالای منو' };

async function renderSite(m) {
  m.innerHTML = `<div class="card">
    <div class="card-header"><h2>🖼 تصاویر و تنظیمات سایت</h2></div>
    <div id="site-imgs" style="padding:1.25rem"><div class="empty"><div class="empty-icon">⏳</div>در حال بارگذاری...</div></div>
  </div>`;
  await loadSiteImages();
}

async function loadSiteImages() {
  const el = document.getElementById('site-imgs'); if (!el) return;
  try {
    const cfg = await api('/site');
    el.innerHTML = `
      <div class="cat-grid" style="padding:0;margin-bottom:1.5rem">${['logo', 'cover'].map(kind => {
      const src = imgSrc(cfg[kind]);
      return `<div class="cat-item" style="flex-direction:column;align-items:stretch;gap:.85rem;padding:1.25rem">
          <div class="cat-name" style="font-size:1rem">${SITE_IMG_LABELS[kind]}</div>${src
          ? `<img src="${esc(src)}" alt="${SITE_IMG_LABELS[kind]}" data-action="zoom-image" data-caption="${SITE_IMG_LABELS[kind]}" style="height:160px;width:100%;object-fit:contain;border-radius:10px;border:1px solid var(--border);background:#fff;cursor:zoom-in;padding:0.5rem">`
          : '<div class="hint" style="height:160px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--border);border-radius:10px">هنوز تصویری آپلود نشده</div>'}
          <div class="upload-area" style="padding:.85rem">
            <input type="file" accept="image/*" data-upload-site="${kind}" aria-label="آپلود ${SITE_IMG_LABELS[kind]}" />
            <p>📤 انتخاب و آپلود تصویر جدید</p>
          </div>
          ${src ? `<button class="btn btn-danger btn-sm" data-action="remove-site-img" data-kind="${kind}">🗑 حذف تصویر</button>` : ''}
        </div>`;
    }).join('')}</div>

      <div class="card">
        <div class="card-header"><h2>🪑 تنظیم تعداد میزها</h2></div>
        <div style="padding:1.25rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <label for="table-count-input" style="font-weight:600">تعداد میزهای فعال کافه:</label>
          <input type="number" id="table-count-input" min="1" max="100" value="${cfg.tableCount || 20}" style="width:110px;padding:.55rem .8rem;border-radius:8px;border:1.5px solid var(--border);background:var(--surface-alt);color:var(--text);font-weight:700" />
          <button class="btn btn-primary btn-sm" data-action="save-table-count">ذخیره تعداد میزها</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:0">
        <div class="card-header"><h2>🔐 الزام اسکن QR برای ثبت سفارش</h2></div>
        <div style="padding:1.25rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <button class="toggle ${cfg.signingEnabled ? 'on' : ''}" role="switch" aria-checked="${cfg.signingEnabled ? 'true' : 'false'}" aria-label="الزام اسکن QR" data-action="toggle-signing"
            data-enabled="${cfg.signingEnabled ? '1' : '0'}" ${cfg.signingSecretPresent ? '' : 'disabled'}></button>
          <span class="hint" style="font-size:0.86rem">${!cfg.signingSecretPresent
        ? 'سکرت TABLE_SIGNING_SECRET ست نشده؛ ابتدا آن را در Cloudflare ست کنید.'
        : cfg.signingEnabled
          ? 'روشن: فقط مشتریانی که بارکد QR روی میز را اسکن کرده‌اند می‌توانند سفارش ثبت کنند.'
          : 'خاموش: هر کسی با داشتن آدرس سایت می‌تواند برای هر میزی سفارش ثبت کند.'
      }</span>
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

async function toggleSigning(currentlyOn) {
  const next = !currentlyOn;
  if (!next && !confirm('با خاموش کردن، هر کسی با آدرس سایت می‌تواند از بیرون کافه برای هر میزی سفارش بدهد. مطمئنی؟')) return;
  try {
    await api('/site/signing', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
    toast(next ? 'الزام QR روشن شد ✓' : 'الزام QR خاموش شد');
    loadSiteImages();
  } catch (e) {
    if (e.message !== 'unauthorized') toast(e.message || 'خطا در تغییر تنظیم', true);
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

function catLabel(id) {
  const c = allCategories.find(x => x.id === id);
  return c ? c.label : (id || '—');
}

// ── مودال‌ها: مدیریت فوکوس (ورود، تله‌ی Tab، بازگشت فوکوس) ─────────────────
const modalFocusReturn = new Map();

function focusableIn(root) {
  return [...root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.getClientRects().length > 0);
}

function openModal(id) {
  const overlay = document.getElementById(id);
  modalFocusReturn.set(id, document.activeElement);
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  // فوکوس روی اولین فیلد قابل تایپ (وگرنه دکمه‌ی بستن)
  requestAnimationFrame(() => {
    const first = overlay.querySelector(
      '.modal-body input:not([type="hidden"]):not([type="file"]):not([disabled]), .modal-body select, .modal-body textarea'
    ) || overlay.querySelector('.modal-close');
    if (first) first.focus({ preventScroll: true });
  });
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = document.querySelector('.overlay.open') ? 'hidden' : '';
  const back = modalFocusReturn.get(id);
  modalFocusReturn.delete(id);
  if (back && back.isConnected && typeof back.focus === 'function' && back !== document.body) {
    back.focus({ preventScroll: true });
  }
}

document.addEventListener('error', (e) => {
  const el = e.target;
  if (el && el.tagName === 'IMG' && (el.classList.contains('img-preview') || el.classList.contains('cat-thumb'))) {
    el.style.display = 'none';
  }
}, true);

// ── Document Event Listeners ──────────────────────────────────────────────
document.addEventListener('click', (e) => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  if (e.target.closest('#sound-toggle-btn')) {
    toggleSound();
    return;
  }

  if (e.target.closest('#theme-toggle-btn')) {
    toggleTheme();
    return;
  }

  if (e.target.closest('#login-btn')) {
    doLogin();
    return;
  }

  if (e.target.closest('#logout-btn')) {
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

  if (e.target.closest('#save-prod-btn')) {
    saveProduct();
    return;
  }

  if (e.target.closest('#save-cat-btn')) {
    saveCat();
    return;
  }

  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'zoom-image') {
    openLightbox(actionEl.getAttribute('src'), actionEl.dataset.caption || '');
  } else if (action === 'close-lightbox') {
    if (e.target.id === 'lightbox' || e.target.id === 'lightbox-close') {
      closeLightbox();
    }
  } else if (action === 'set-prod-view') {
    productViewMode = actionEl.dataset.view;
    localStorage.setItem('admin_prod_view', productViewMode);
    document.querySelectorAll('[data-action="set-prod-view"]').forEach(b => {
      b.classList.toggle('active', b.dataset.view === productViewMode);
    });
    renderProductTable();
  } else if (action === 'quick-filter-avail') {
    filterAvail = actionEl.dataset.avail ?? '';
    const sel = document.getElementById('prod-avail-filter');
    if (sel) sel.value = filterAvail;
    renderProductTable();
  } else if (action === 'clear-cat-filter') {
    filterCat = '';
    const sel = document.getElementById('prod-cat-filter');
    if (sel) sel.value = '';
    renderProductTable();
  } else if (action === 'clear-search-filter') {
    searchQ = '';
    const input = document.querySelector('[data-action="search-products"]');
    if (input) input.value = '';
    renderProductTable();
  } else if (action === 'clear-all-prod-filters') {
    searchQ = '';
    filterCat = '';
    filterAvail = '';
    const input = document.querySelector('[data-action="search-products"]');
    if (input) input.value = '';
    const catSel = document.getElementById('prod-cat-filter');
    if (catSel) catSel.value = '';
    const availSel = document.getElementById('prod-avail-filter');
    if (availSel) availSel.value = '';
    renderProductTable();
  } else if (action === 'refresh-orders') {
    manualRefreshOrders();
  } else if (action === 'load-more-orders') {
    loadOrders(true);
  } else if (action === 'clear-order-table') {
    orderTableFilter = '';
    renderOrderList();
  } else if (action === 'order-resolve') {
    resolveOrderWeb(Number(actionEl.dataset.orderId), actionEl.dataset.orderStatus);
  } else if (action === 'quick-add-prod') {
    quickAddProduct();
  } else if (action === 'quick-add-cat') {
    quickAddCategory();
  } else if (action === 'quick-go-orders') {
    switchTab('orders');
  } else if (action === 'quick-go-qr') {
    switchTab('qr');
  } else if (action === 'ops-select-table') {
    // تب سفارش‌ها با فیلتر «در انتظار» + میز انتخاب‌شده باز میشه
    const tNum = actionEl.dataset.table;
    ordersPreset = { status: 'pending', table: String(tNum) };
    switchTab('orders');
  } else if (action === 'ops-quick-avail') {
    quickToggleAvail(actionEl.dataset.prodId);
  } else if (action === 'view-cat-products') {
    filterCat = actionEl.dataset.catId || '';
    switchTab('products');
  } else if (action === 'open-prod-modal') {
    openProductModal(actionEl.dataset.prodId || null);
  } else if (action === 'delete-prod') {
    deleteProduct(actionEl.dataset.prodId);
  } else if (action === 'toggle-avail') {
    toggleAvail(actionEl.dataset.prodId);
  } else if (action === 'open-cat-modal') {
    openCatModal(actionEl.dataset.catId || null);
  } else if (action === 'delete-cat') {
    deleteCat(actionEl.dataset.catId);
  } else if (action === 'print-table-qr') {
    window.print();
  } else if (action === 'download-qr-only') {
    downloadBarcodeOnly(actionEl.dataset.table, actionEl.dataset.format);
  } else if (action === 'copy-table-url') {
    copyTableUrl(actionEl.dataset.url);
  } else if (action === 'remove-site-img') {
    removeSiteImg(actionEl.dataset.kind);
  } else if (action === 'save-table-count') {
    saveTableCount();
  } else if (action === 'toggle-signing') {
    toggleSigning(actionEl.dataset.enabled === '1');
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'p-price' || e.target.id === 'p-discount') {
    updateDiscPreview();
  } else if (e.target.matches('[data-action="search-products"]')) {
    searchQ = e.target.value;
    renderProductTable();
  } else if (e.target.matches('[data-action="search-cats"]')) {
    catSearchQ = e.target.value;
    renderCategoryList();
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
    loadOrders(false);
  } else if (e.target.matches('[data-action="filter-prod-cat"]')) {
    filterCat = e.target.value;
    renderProductTable();
  } else if (e.target.matches('[data-action="filter-prod-avail"]')) {
    filterAvail = e.target.value;
    renderProductTable();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'pw' && e.key === 'Enter') {
    doLogin();
    return;
  }

  // اکشن‌های role="button" (مثل کاشی میزها) با Enter/Space هم کار کنن
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-action]')) {
    e.preventDefault();
    e.target.click();
    return;
  }

  if (e.key === 'Escape') {
    // هر Escape فقط بالاترین لایه رو می‌بنده: اول لایت‌باکس، بعد مودال
    const lb = document.getElementById('lightbox');
    if (lb && lb.classList.contains('open')) { closeLightbox(); return; }
    const openOverlays = document.querySelectorAll('.overlay.open');
    if (openOverlays.length) closeModal(openOverlays[openOverlays.length - 1].id);
    return;
  }

  // تله‌ی فوکوس داخل مودال باز
  if (e.key === 'Tab') {
    const openOverlays = document.querySelectorAll('.overlay.open');
    if (!openOverlays.length) return;
    const dlg = openOverlays[openOverlays.length - 1].querySelector('.modal');
    if (!dlg) return;
    const items = focusableIn(dlg);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

(async function checkInitialAuth() {
  try {
    const r = await fetch(`${BASE}/me`, {
      credentials: 'same-origin',
    });
    if (r.ok) {
      initApp();
      return;
    }
  } catch { }
  doLogout();
})();