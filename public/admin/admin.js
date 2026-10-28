/* ═══════════════════════════════════════════════════════════════════════
   پنل مدیریت کافه روشن — منطق کامل (Vanilla JS، بدون ماژول و باندلر)
   فهرست بخش‌ها:
   ۰) ابزارهای پایه   ۱) وضعیت برنامه   ۲) تم   ۳) صدا   ۴) toast
   ۵) مودال/لایت‌باکس  ۶) لایه‌ی API    ۷) آپلود و ریسایز تصویر
   ۸) ورود/خروج و بوت  ۹) ناوبری        ۱۰) پولینگ سفارش‌ها
   ۱۱) داشبورد         ۱۲) سفارش‌ها      ۱۳) محصولات
   ۱۴) دسته‌بندی‌ها     ۱۵) QR میزها     ۱۶) تنظیمات سایت
   ۱۷) مدیریت خطای تصاویر  ۱۸) رویدادها  ۱۹) شروع
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── ۰) ابزارهای پایه ────────────────────────────────────────────────── */
const BASE = '/admin/api';
const BASE_TITLE = 'پنل مدیریت — کافه روشن';
const THEME_KEY = 'admin_theme';
const SOUND_KEY = 'admin_sound_enabled';
const VIEW_KEY = 'admin_prod_view_v2'; // نسخه‌ی ۲: پیش‌فرض جدید «گالری» است
const MAX_INPUT_BYTES = 5 * 1024 * 1024;   // سقف انتخاب فایل توسط کاربر
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;  // سقف حجم پس از فشرده‌سازی (سرور 413 می‌دهد)

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

// escape متن‌های سرور/کاربر پیش از innerHTML
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

const fmtNum = (n) => Number(n || 0).toLocaleString('fa-IR');
const fmtMoney = (n) => fmtNum(n) + ' ت';
const clampNum = (v, a, b) => Math.min(b, Math.max(a, v));

// مسیر تصویر: همیشه با اسلش اول (مسیرهای ذخیره‌شده ممکن است بدون اسلش بیایند)
function imgSrc(p) {
  return p ? '/' + String(p).replace(/^\/+/, '') : '';
}

// بندانگشتی سرور (با fallback به تصویر اصلی در data-fallback)
function thumbSrc(p) {
  const full = imgSrc(p);
  return full ? full.replace(/^\/images\//, '/images/thumb/') : '';
}

// تولید آیکون از اسپرایت SVG
function icon(name, cls) {
  return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// تبدیل «YYYY-MM-DD HH:MM:SS» (UTC) به Date
function parseOrderDate(s) {
  if (!s) return null;
  const str = String(s);
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

// نمایش زمان به وقت تهران؛ اگر امروز بود فقط ساعت، وگرنه «تاریخ، ساعت»
function fmtOrderTime(s) {
  const d = parseOrderDate(s);
  if (!d) return '—';
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' });
  if (ymd.format(d) === ymd.format(new Date())) return time;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString('fa-IR', sameYear
    ? { day: 'numeric', month: 'short', timeZone: 'Asia/Tehran' }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tehran' });
  return date + '، ' + time;
}

// زمان نسبی برای سفارش‌های در انتظار: «همین الان»، «۵ دقیقه پیش»، «۲ ساعت پیش»
function relTime(s) {
  const d = parseOrderDate(s);
  if (!d) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'همین الان';
  if (mins < 60) return fmtNum(mins) + ' دقیقه پیش';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return fmtNum(hours) + ' ساعت پیش';
  return '';
}

// شماره‌ی میز: اگر عددی بود با رقم فارسی، وگرنه escape‌شده
function tableLabel(n) {
  return /^\d+$/.test(String(n)) ? fmtNum(n) : esc(n);
}

/* ── ۱) وضعیت برنامه ────────────────────────────────────────────────── */
const state = {
  loggedIn: false,
  tab: 'dashboard',
  products: [],
  categories: [],
  site: null,          // پاسخ GET /site
  tableLinks: null,    // پاسخ GET /table-qr-links
  // فیلترهای محصولات
  prodSearch: '',
  prodCat: '',
  prodAvail: '',       // '' | '1' | '0' | 'disc'
  prodView: localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid',
  catSearch: '',
  // سفارش‌ها
  orderStatus: '',     // '' | pending | confirmed | rejected
  orderTable: '',      // فیلتر سمت کلاینت شماره میز
  orders: [],
  ordersHasMore: false,
  // سایر
  soundEnabled: localStorage.getItem(SOUND_KEY) !== 'false',
  editingProduct: null, // محصول در حال ویرایش
  editInit: null,       // {price, discount} اولیه برای تشخیص «دست‌نخورده»
  modalAvail: 1,        // موجودی داخل مودال محصول
  editingCat: null,
  siteUploadKind: '',   // 'logo' | 'cover'
};

const TABS = {
  dashboard: 'داشبورد',
  orders: 'سفارش‌ها',
  products: 'محصولات',
  categories: 'دسته‌بندی‌ها',
  qr: 'QR میزها',
  site: 'تصاویر و تنظیمات',
};

const ORDER_STATUS = {
  pending: 'در انتظار',
  confirmed: 'تایید شده',
  rejected: 'رد شده',
};

/* ── ۲) تم تیره / روشن ──────────────────────────────────────────────── */
function currentTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  // اگر ذخیره نشده بود: ترجیح سیستم؛ پیش‌فرض تیره
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

function applyTheme() {
  const t = currentTheme();
  document.body.dataset.theme = t;
  // سایدبار: آیکون = تم مقصد
  const ti = document.getElementById('theme-btn-icon');
  if (ti) ti.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  setText('theme-btn-label', t === 'dark' ? 'تم روشن' : 'تم تیره');
  // شیت بیشتر: وضعیت فعلی
  const si = document.getElementById('sheet-theme-icon');
  if (si) si.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  setText('sheet-theme-label', t === 'dark' ? 'تیره' : 'روشن');
}

function toggleTheme() {
  localStorage.setItem(THEME_KEY, document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  applyTheme();
}

/* ── ۳) صدای سفارش جدید (Web Audio API) ─────────────────────────────── */
let audioCtx = null;

// AudioContext باید پس از نخستین تعامل کاربر فعال شود
function primeAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audioCtx) {
    try { audioCtx = new AC(); } catch (e) { return; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () { });
}
document.addEventListener('pointerdown', primeAudio, { capture: true });

// بیپ ملایم: سینوسی از ۵۸۷Hz به ۸۸۰Hz در ~۰.۱۲ ثانیه، کل ~۰.۴۵ ثانیه
function playBeep() {
  if (!state.soundEnabled) return;
  try {
    primeAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, t0); // D5
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.12); // A5
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  } catch (e) { /* بی‌صدا رد شو */ }
}

function updateSoundUI() {
  const on = state.soundEnabled;
  const sIcon = document.getElementById('sound-btn-icon');
  if (sIcon) sIcon.innerHTML = icon(on ? 'vol' : 'vol-off');
  setText('sound-btn-label', on ? 'صدا: فعال' : 'صدا: غیرفعال');
  const shIcon = document.getElementById('sheet-sound-icon');
  if (shIcon) shIcon.innerHTML = icon(on ? 'vol' : 'vol-off');
  setText('sheet-sound-label', on ? 'فعال' : 'غیرفعال');
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem(SOUND_KEY, state.soundEnabled ? 'true' : 'false');
  updateSoundUI();
  if (state.soundEnabled) {
    primeAudio();
    playBeep();
    toast('هشدار صوتی فعال شد');
  } else {
    toast('هشدار صوتی غیرفعال شد', 'info');
  }
}

/* ── ۴) toast ───────────────────────────────────────────────────────── */
function toast(msg, type) {
  type = type || 'ok';
  const region = document.getElementById('toast-region');
  if (!region) return;
  // حداکثر ۴ toast هم‌زمان
  while (region.children.length >= 4) region.removeChild(region.firstChild);
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = icon(type === 'err' ? 'warn' : type === 'info' ? 'info' : 'check') + '<span></span>';
  el.querySelector('span').textContent = msg;
  region.appendChild(el);
  requestAnimationFrame(function () { el.classList.add('show'); });
  setTimeout(function () {
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 300);
  }, 3400);
}
/* ── ۵) مودال‌ها: باز/بسته، تله‌ی فوکوس، بازگشت فوکوس ────────────────── */
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalStack = [];

function visibleFocusables(root) {
  return $$(FOCUSABLE_SEL, root).filter(function (el) {
    return el.getClientRects().length > 0;
  });
}

function topLayer() {
  return modalStack[modalStack.length - 1] || null;
}

function openLayer(id, focusSel) {
  const ov = document.getElementById(id);
  if (!ov) return;
  ov.hidden = false;
  ov._returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalStack.push(ov);
  document.body.classList.add('no-scroll');
  const f = focusSel ? $(focusSel, ov) : null;
  const target = f || visibleFocusables(ov)[0] || ov;
  setTimeout(function () { target.focus({ preventScroll: true }); }, 50);
}

function closeLayer(id) {
  const idx = modalStack.findIndex(function (o) { return o.id === id; });
  if (idx === -1) return;
  const ov = modalStack.splice(idx, 1)[0];
  ov.hidden = true;
  if (!modalStack.length) document.body.classList.remove('no-scroll');
  if (ov._returnFocus && document.contains(ov._returnFocus)) {
    ov._returnFocus.focus({ preventScroll: true });
  }
  ov._returnFocus = null;
}

function closeAllLayers() {
  while (modalStack.length) closeLayer(modalStack[modalStack.length - 1].id);
}

/* مودال تایید (Promise-محور) — جایگزین confirm() مرورگر */
let confirmCleanup = null;

function confirmDialog(opts) {
  return new Promise(function (resolve) {
    const ov = document.getElementById('modal-confirm');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel-btn');
    const xBtn = document.getElementById('confirm-cancel'); // دکمه‌ی ✕ هدر
    if (confirmCleanup) confirmCleanup();
    document.getElementById('confirm-title').textContent = (opts && opts.title) || 'تایید عملیات';
    document.getElementById('confirm-message').textContent = (opts && opts.message) || 'آیا مطمئن هستید؟';
    ok.textContent = (opts && opts.confirmText) || 'تایید';
    ok.className = 'btn ' + (opts && opts.danger === false ? 'btn-primary' : 'btn-danger');
    cancel.textContent = (opts && opts.cancelText) || 'انصراف';

    function finish(v) {
      document.removeEventListener('click', onBackdrop, true);
      confirmCleanup = null;
      closeLayer('modal-confirm');
      resolve(v);
    }
    function onOk() { finish(true); }
    function onCancel() { finish(false); }
    function onBackdrop(e) { if (e.target === ov) finish(false); }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    if (xBtn) xBtn.addEventListener('click', onCancel);
    ov.addEventListener('click', onBackdrop);
    confirmCleanup = function () {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      if (xBtn) xBtn.removeEventListener('click', onCancel);
      ov.removeEventListener('click', onBackdrop);
    };
    openLayer('modal-confirm', '#confirm-cancel-btn');
  });
}

/* لایت‌باکس بزرگ‌نمایی تصاویر */
function openLightbox(src, caption) {
  if (!src) return;
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  img.removeAttribute('src');
  img.src = src;
  img.alt = caption || '';
  document.getElementById('lightbox-caption').textContent = caption || '';
  lb.hidden = false;
  lb._returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.classList.add('no-scroll');
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  const img = document.getElementById('lightbox-img');
  img.removeAttribute('src');
  if (!modalStack.length) document.body.classList.remove('no-scroll');
  if (lb._returnFocus && document.contains(lb._returnFocus)) lb._returnFocus.focus({ preventScroll: true });
  lb._returnFocus = null;
}

/* ── ۶) لایه‌ی API ──────────────────────────────────────────────────── */
function ApiError(message, status) {
  this.name = 'ApiError';
  this.message = message || 'خطا در برقراری ارتباط';
  this.status = status || 0;
}
ApiError.prototype = Object.create(Error.prototype);

async function api(path, opts) {
  opts = opts || {};
  const isForm = opts.body instanceof FormData;
  let res;
  try {
    res = await fetch(BASE + path, Object.assign({}, opts, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign(
        {},
        (!isForm && opts.body) ? { 'Content-Type': 'application/json' } : {},
        opts.headers || {}
      ),
    }));
  } catch (e) {
    throw new ApiError('خطا در برقراری ارتباط', 0);
  }
  // نشست تمام شده: پولینگ متوقف و صفحه‌ی ورود نمایش داده می‌شود
  if (res.status === 401) {
    handleSessionExpired();
    throw new ApiError('نشست شما پایان یافته است', 401);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* بدنه‌ی خالی */ }
  if (!res.ok) {
    throw new ApiError((data && data.error) ? data.error : 'خطا در برقراری ارتباط', res.status);
  }
  return data;
}

function handleSessionExpired() {
  if (!state.loggedIn) return;
  state.loggedIn = false;
  stopPolling();
  closeAllLayers();
  showLogin(true);
}

/* ── ۷) آپلود: اعتبارسنجی، ریسایز canvas و ارسال ────────────────────── */

// ریسایز سمت کلاینت + تبدیل به webp (کیفیت ۰.۸۲)؛ gif ریسایز نمی‌شود (حفظ انیمیشن)
function resizeToWebp(file, maxWidth) {
  return new Promise(function (resolve) {
    if (file.type === 'image/gif') return resolve(null);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(1, maxWidth / (img.naturalWidth || img.width));
        const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // برای jpeg پس‌زمینه سفید (جلوگیری از سیاه‌شدن شفافیت)
        if (file.type === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          resolve(blob || null);
        }, 'image/webp', 0.82);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// خروجی بزرگ‌تر از فایل اصلی شد → فایل اصلی ارسال می‌شود
async function processAndUpload(file, maxW, endpoint) {
  let payload = file;
  let name = file.name;
  const resized = await resizeToWebp(file, maxW).catch(function () { return null; });
  if (resized && resized.size < file.size) {
    payload = resized;
    name = String(file.name).replace(/\.[^.]+$/, '') + '.webp';
  }
  if (payload.size > MAX_UPLOAD_BYTES) {
    throw new ApiError('حجم تصویر پس از فشرده‌سازی بیش از ۲ مگابایت است؛ فایل کوچک‌تری انتخاب کنید.', 0);
  }
  const fd = new FormData();
  fd.append('file', payload, name);
  const data = await api(endpoint, { method: 'POST', body: fd });
  const url = data && (data.url || (data.success && data.url));
  if (!url) throw new ApiError('پاسخ نامعتبر از سرور', 0);
  return url;
}

function uploadStatusEl(kind) {
  return document.getElementById(kind === 'product' ? 'prod-upload-status' : kind === 'category' ? 'cat-upload-status' : null);
}

function setUploadStatus(kind, text) {
  const el = uploadStatusEl(kind);
  if (el) el.textContent = text || '';
}

// پیش‌نمایش آنی با FileReader
function showLocalPreview(kind, file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    if (kind === 'product' || kind === 'category') {
      const img = document.getElementById(kind === 'product' ? 'prod-preview-img' : 'cat-preview-img');
      const box = document.getElementById(kind === 'product' ? 'prod-upload-preview' : 'cat-upload-preview');
      if (img && box) {
        img.src = e.target.result;
        box.hidden = false;
      }
    } else if (kind === 'logo' || kind === 'cover') {
      const box = document.getElementById(kind === 'logo' ? 'logo-preview' : 'cover-preview');
      if (box) box.innerHTML = '<img src="' + e.target.result + '" alt="پیش‌نمایش ' + (kind === 'logo' ? 'لوگو' : 'کاور') + '">';
    }
  };
  reader.readAsDataURL(file);
}

async function handleFilePicked(kind, file) {
  if (!file) return;
  const okType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].indexOf(file.type) !== -1 ||
    /\.(jpe?g|png|webp|gif)$/i.test(file.name || '');
  if (!okType) {
    setUploadStatus(kind, 'فرمت مجاز نیست');
    toast('فرمت تصویر مجاز نیست؛ jpg، png، webp یا gif انتخاب کنید.', 'err');
    return;
  }
  if (file.size > MAX_INPUT_BYTES) {
    setUploadStatus(kind, 'حجم بیش از حد مجاز');
    toast('حجم فایل بیش از ۵ مگابایت است.', 'err');
    return;
  }
  setUploadStatus(kind, 'در حال بهینه‌سازی و آپلود…');
  showLocalPreview(kind, file);
  try {
    const maxW = kind === 'logo' ? 600 : kind === 'cover' ? 1600 : 1200;
    const endpoint = (kind === 'logo' || kind === 'cover') ? '/site/' + kind : '/upload';
    const url = await processAndUpload(file, maxW, endpoint);
    if (kind === 'product') {
      setProductImage(url);
    } else if (kind === 'category') {
      setCategoryImage(url);
    } else {
      toast('تصویر ذخیره شد');
      loadSiteSection();
    }
  } catch (err) {
    if (err.status === 401) return;
    setUploadStatus(kind, 'آپلود ناموفق');
    toast(err.message || 'آپلود ناموفق بود.', 'err');
  }
}
/* ── ۸) ورود / خروج و بوت ───────────────────────────────────────────── */
function showLogin(expired) {
  document.getElementById('app').hidden = true;
  document.getElementById('login-screen').hidden = false;
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = expired
    ? 'نشست شما پایان یافته است؛ دوباره وارد شوید.'
    : '';
  document.title = BASE_TITLE;
  setTimeout(function () { document.getElementById('login-password').focus(); }, 60);
}

function showApp() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app').hidden = false;
  state.loggedIn = true;
  // بازیابی تب از hash (#/orders) پس از رفرش
  const initial = (location.hash || '').replace(/^#\/?/, '');
  switchTab(TABS[initial] ? initial : 'dashboard');
  startPolling();
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('login-password');
  const err = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const pw = input.value.trim();
  err.textContent = '';
  if (!pw) {
    err.textContent = 'رمز عبور را وارد کنید.';
    input.focus();
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span class="btn-label">در حال ورود…</span>';
  try {
    const res = await fetch(BASE + '/login', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    let data = null;
    try { data = await res.json(); } catch (e2) { /* بدون بدنه */ }
    if (res.ok) {
      input.value = '';
      showApp();
    } else {
      err.textContent = (data && data.error) ||
        (res.status === 401 ? 'رمز عبور اشتباه است.'
          : res.status === 429 ? 'تلاش‌های ناموفق زیاد است؛ کمی صبر کنید.'
            : res.status === 503 ? 'پنل پیکربندی نشده است.'
              : 'خطا در برقراری ارتباط');
      input.focus();
      input.select();
    }
  } catch (e3) {
    err.textContent = 'خطا در برقراری ارتباط با سرور';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-label">ورود به پنل</span>';
  }
}

async function doLogout() {
  state.loggedIn = false;
  stopPolling();
  closeAllLayers();
  try {
    await fetch(BASE + '/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  } catch (e) { /* مهم نیست */ }
  showLogin(false);
}

async function boot() {
  applyTheme();
  updateSoundUI();
  try {
    await api('/me');
    showApp();
  } catch (e) {
    showLogin(false);
  }
}

/* ── ۹) ناوبری تب‌ها (با hash) ──────────────────────────────────────── */
function switchTab(tab) {
  if (!TABS[tab]) tab = 'dashboard';
  state.tab = tab;
  try { history.replaceState(null, '', '#/' + tab); } catch (e) { /* نادیده */ }
  document.title = TABS[tab] + ' — کافه روشن';
  setText('page-title', TABS[tab]);
  // همگام‌سازی حالت فعال سایدبار و نوار پایین
  $$('.sidebar [data-tab], .bottom-tabs [data-tab]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  closeLayer('sheet-overlay');
  // حالت چاپ QR فقط هنگام حضور در تب QR
  document.body.classList.toggle('qr-print-mode', tab === 'qr');
  const m = document.getElementById('main-content');
  if (tab === 'dashboard') renderDashboard(m);
  else if (tab === 'orders') renderOrders(m);
  else if (tab === 'products') renderProducts(m);
  else if (tab === 'categories') renderCategories(m);
  else if (tab === 'qr') renderQr(m);
  else if (tab === 'site') renderSite(m);
}

window.addEventListener('hashchange', function () {
  if (!state.loggedIn) return;
  const t = (location.hash || '').replace(/^#\/?/, '');
  if (TABS[t] && t !== state.tab) switchTab(t);
});

/* ── ۱۰) پولینگ سفارش‌ها ────────────────────────────────────────────── */
const POLL_ACTIVE = 3000;    // صفحه فعال
const POLL_HIDDEN = 15000;   // تب در پس‌زمینه
const POLL_MAX = 30000;      // سقف backoff
const poll = { active: false, timer: null, busy: false, queued: false, interval: POLL_ACTIVE, base: null };

function startPolling() {
  if (poll.active) return;
  poll.active = true;
  poll.interval = document.hidden ? POLL_HIDDEN : POLL_ACTIVE;
  schedulePoll(500);
}

function stopPolling() {
  poll.active = false;
  if (poll.timer) { clearTimeout(poll.timer); poll.timer = null; }
  poll.busy = false;
  poll.queued = false;
  document.title = TABS[state.tab] ? TABS[state.tab] + ' — کافه روشن' : BASE_TITLE;
}

function schedulePoll(delay) {
  if (!poll.active) return;
  if (poll.timer) clearTimeout(poll.timer);
  poll.timer = setTimeout(function () {
    poll.timer = null;
    pollTick();
  }, delay);
}

// درخواست فوری (پس از تغییرات محلی یا بازگشت به تب)
function pollNow() {
  if (!poll.active || !state.loggedIn) return;
  if (poll.timer) { clearTimeout(poll.timer); poll.timer = null; }
  pollTick();
}

async function pollTick() {
  if (!poll.active || !state.loggedIn) return;
  if (poll.busy) { poll.queued = true; return; } // فقط یک درخواست هم‌زمان
  poll.busy = true;
  const wantInterval = document.hidden ? POLL_HIDDEN : POLL_ACTIVE;
  try {
    const s = await api('/orders/summary');
    poll.interval = wantInterval;
    const pending = Number((s && s.pending) || 0);
    const latestId = Number((s && s.latestId) || 0);
    updateBadge(pending);

    const isBase = poll.base === null;
    const changed = !isBase && (poll.base.pending !== pending || poll.base.latestId !== latestId);
    const isNew = !isBase && (latestId > poll.base.latestId || pending > poll.base.pending);
    poll.base = { pending: pending, latestId: latestId };

    if (isNew) {
      playBeep();
      toast('سفارش جدید ثبت شد', 'info');
      if (document.hidden) {
        document.title = '(🔔 ' + fmtNum(pending) + ' سفارش در انتظار) کافه روشن';
      }
    }
    if (changed) {
      // فقط محتوای تب جاری تازه شود (بدون بازسازی کل صفحه و بدون پرش اسکرول)
      if (state.tab === 'dashboard') refreshDashboardLive();
      else if (state.tab === 'orders') refreshOrdersHead().catch(function () { });
    }
  } catch (err) {
    if (err.status === 401) return; // پولینگ در handleSessionExpired متوقف شده است
    poll.interval = Math.min(Math.ceil(poll.interval * 1.5), POLL_MAX);
  } finally {
    poll.busy = false;
    if (poll.queued) {
      poll.queued = false;
      pollTick();
    } else if (poll.active && state.loggedIn) {
      schedulePoll(poll.interval);
    }
  }
}

document.addEventListener('visibilitychange', function () {
  if (!document.hidden && poll.active && state.loggedIn) {
    document.title = TABS[state.tab] + ' — کافه روشن';
    pollNow();
  }
});

window.addEventListener('focus', function () {
  if (poll.active && state.loggedIn) {
    document.title = TABS[state.tab] + ' — کافه روشن';
    pollNow();
  }
});

function updateBadge(n) {
  ['badge-sidebar', 'badge-mobile'].forEach(function (id) {
    const b = document.getElementById(id);
    if (!b) return;
    if (n > 0) {
      b.hidden = false;
      b.textContent = n > 99 ? '۹۹+' : fmtNum(n);
    } else {
      b.hidden = true;
    }
  });
}

// تازه‌سازی محتوای وابسته به تغییر پولینگ
function refreshActiveTabData() {
  if (state.tab === 'dashboard') refreshDashboardLive();
  else if (state.tab === 'orders') refreshOrdersHead().catch(function () { });
}
/* ── ابزارهای رندر مشترک ────────────────────────────────────────────── */
function skeletonListHTML(n) {
  let rows = '';
  for (let i = 0; i < (n || 4); i++) {
    rows += '<div class="sk-row"><div class="skeleton sk-avatar"></div><div class="sk-lines"><div class="skeleton sk-line w60"></div><div class="skeleton sk-line w35"></div></div></div>';
  }
  return '<div class="skeleton-list">' + rows + '</div>';
}

function emptyStateHTML(ic, title, sub, actionsHTML) {
  return '<div class="empty">' + icon(ic, 'empty-icon') +
    '<p class="empty-title">' + title + '</p>' +
    (sub ? '<p class="empty-sub">' + sub + '</p>' : '') +
    (actionsHTML || '') + '</div>';
}

function errorStateHTML(msg) {
  return emptyStateHTML('warn', 'خطا در بارگذاری', esc(msg || 'دوباره تلاش کنید.'),
    '<button type="button" class="btn btn-ghost btn-sm" data-action="retry">' + icon('refresh') + ' تلاش مجدد</button>');
}

function catLabelOf(id) {
  const c = state.categories.find(function (x) { return String(x.id) === String(id); });
  return c ? c.label : 'بدون دسته';
}

/* ── ۱۱) داشبورد ────────────────────────────────────────────────────── */
async function renderDashboard(m) {
  m.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">داشبورد</h1>
        <p class="page-sub">نمای سریع باریستا — فروش، سفارش‌های در انتظار و اقلام ناموجود</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="refresh-dashboard">${icon('refresh')} تازه‌سازی</button>
      </div>
    </div>

    <section class="sales-grid" aria-label="فروش تاییدشده">
      <div class="sale-card sale-today">
        <div class="sale-label">${icon('wallet')} فروش تاییدشده‌ی امروز</div>
        <div class="sale-val num" id="sales-today">…</div>
        <div class="sale-hint">فقط سفارش‌های تاییدشده محاسبه می‌شود</div>
      </div>
      <div class="sale-card">
        <div class="sale-label">${icon('cal')} فروش این هفته</div>
        <div class="sale-val num" id="sales-week">…</div>
        <div class="sale-hint">از شنبه تا امروز — سفارش‌های تاییدشده</div>
      </div>
      <div class="sale-card">
        <div class="sale-label">${icon('cal')} فروش این ماه</div>
        <div class="sale-val num" id="sales-month">…</div>
        <div class="sale-hint">ماه جاری — سفارش‌های تاییدشده</div>
      </div>
    </section>

    <div class="dash-grid">
      <section class="card" aria-label="سفارش‌های در انتظار">
        <div class="card-header">
          <h2>${icon('receipt')} سفارش‌های در انتظار</h2>
          <span class="count-badge" id="dash-pending-count">…</span>
        </div>
        <div class="card-body" id="dash-pending-list">${skeletonListHTML(3)}</div>
      </section>
      <section class="card" aria-label="اقلام ناموجود">
        <div class="card-header">
          <h2>${icon('box')} اقلام ناموجود</h2>
          <span class="count-badge" id="dash-unavail-count">…</span>
        </div>
        <div class="card-body" id="dash-unavail-list">${skeletonListHTML(3)}</div>
      </section>
    </div>`;
  await refreshDashboardLive({ full: true });
}

// تازه‌سازی زنده‌ی داشبورد (بدون بازسازی کل صفحه)
async function refreshDashboardLive(opts) {
  if (state.tab !== 'dashboard' || !state.loggedIn) return;
  const full = !!(opts && opts.full);
  const needMenu = full || !state.products.length || !state.categories.length;
  const pSales = api('/sales-stats').catch(function () { return null; });
  const pPend = api('/orders?status=pending&limit=100').catch(function () { return null; });
  const pCats = needMenu ? api('/categories').catch(function () { return null; }) : null;
  const pProds = needMenu ? api('/products').catch(function () { return null; }) : null;

  const sales = await pSales;
  const pend = await pPend;
  if (pCats) { const c = await pCats; if (c) state.categories = c; }
  if (pProds) { const p = await pProds; if (p) state.products = p; }
  if (state.tab !== 'dashboard') return;

  const wrapP = document.getElementById('dash-pending-list');
  if (!wrapP) return; // تب عوض شده است

  if (sales) {
    setText('sales-today', fmtMoney(sales.today));
    setText('sales-week', fmtMoney(sales.week));
    setText('sales-month', fmtMoney(sales.month));
  } else {
    setText('sales-today', '—');
    setText('sales-week', '—');
    setText('sales-month', '—');
  }
  renderPendingList(Array.isArray(pend) ? pend : []);
  renderUnavailList();
}

// کارت سفارش: میز درشت ← اقلام (تعداد، نام، قیمت ردیف) ← جمع کل و دکمه‌ها
function orderCardHTML(o) {
  const stLabel = ORDER_STATUS[o.status] || o.status;
  const items = (o.items || []).map(function (it) {
    const qty = Number(it.quantity) || 0;
    const unit = qty > 1
      ? '<span class="oi-unit">هر عدد: ' + fmtMoney(it.price) + '</span>'
      : '';
    return '<li>' +
      '<span class="oi-qty num">×' + fmtNum(qty) + '</span>' +
      '<span class="oi-info"><span class="oi-name">' + esc(it.name) + '</span>' + unit + '</span>' +
      '<span class="oi-price num">' + fmtMoney(it.price * qty) + '</span>' +
      '</li>';
  }).join('');
  const ago = o.status === 'pending' ? relTime(o.created_at) : '';
  const agoHTML = ago
    ? '<span class="order-ago" data-created="' + esc(o.created_at) + '">' + ago + '</span>'
    : '';
  const acts = o.status === 'pending' ? `
      <div class="order-actions">
        <button type="button" class="btn btn-success" data-action="order-resolve" data-id="${o.id}" data-status="confirmed">${icon('check')} تایید</button>
        <button type="button" class="btn btn-danger" data-action="order-resolve" data-id="${o.id}" data-status="rejected">${icon('x')} رد</button>
      </div>` : '';
  return `
    <article class="order-card os-${esc(o.status)}" data-order-id="${o.id}">
      <div class="order-head">
        <div class="order-table-big" title="شماره میز">
          <span class="ot-label">میز</span>
          <span class="ot-num num">${tableLabel(o.table_number)}</span>
        </div>
        <div class="order-meta">
          <span class="order-no num">سفارش #${fmtNum(o.id)}</span>
          <span class="order-time">
            <span>${icon('clock')} ${fmtOrderTime(o.created_at)}</span>
            ${agoHTML}
          </span>
        </div>
        <span class="status-pill st-${esc(o.status)}">${stLabel}</span>
      </div>
      <ul class="order-items">${items}</ul>
      <div class="order-foot">
        <div class="order-total">
          <span>جمع کل</span>
          <b class="num">${fmtMoney(o.total)}</b>
        </div>
        ${acts}
      </div>
    </article>`;
}

function renderPendingList(list) {
  const wrap = document.getElementById('dash-pending-list');
  if (!wrap) return;
  const cnt = document.getElementById('dash-pending-count');
  if (cnt) {
    cnt.textContent = fmtNum(list.length) + ' سفارش';
    cnt.classList.toggle('warn', list.length > 0);
  }
  if (!list.length) {
    wrap.innerHTML = emptyStateHTML('check', 'سفارش در انتظاری نیست', 'سفارش‌های جدید به‌محض ثبت اینجا ظاهر می‌شوند.');
    return;
  }
  wrap.innerHTML = '<div class="order-list">' + list.map(orderCardHTML).join('') + '</div>';
}

function renderUnavailList() {
  const wrap = document.getElementById('dash-unavail-list');
  if (!wrap) return;
  const cnt = document.getElementById('dash-unavail-count');
  const items = state.products.filter(function (p) { return Number(p.available) === 0; });
  if (cnt) {
    cnt.textContent = fmtNum(items.length) + ' قلم';
    cnt.classList.toggle('warn', items.length > 0);
  }
  if (!items.length) {
    wrap.innerHTML = emptyStateHTML('check', 'همه چیز موجود است', 'هیچ محصول ناموجودی در منو ندارید.');
    return;
  }
  wrap.innerHTML = '<div class="unavail-list">' + items.map(function (p) {
    return `<div class="unavail-row">
      <div class="unavail-info">
        <span class="unavail-name">${esc(p.name)}</span>
        <span class="unavail-meta">${esc(catLabelOf(p.category))} • ${fmtMoney(p.price)}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="make-available" data-id="${p.id}">${icon('check')} موجود شد</button>
    </div>`;
  }).join('') + '</div>';
}

// تایید/رد سفارش (از داشبورد یا تب سفارش‌ها)
async function resolveOrder(id, status) {
  const card = document.querySelector('.order-card[data-order-id="' + String(id).replace(/"/g, '') + '"]');
  if (card) {
    $$('button[data-action="order-resolve"]', card).forEach(function (b) { b.disabled = true; });
  }
  try {
    await api('/orders/' + id, { method: 'PATCH', body: JSON.stringify({ status: status }) });
    toast(status === 'confirmed' ? 'سفارش تایید شد' : 'سفارش رد شد');
    // خروج انیمیشنی آیتم از لیست + تازه‌سازی آمار
    if (card) {
      card.classList.add('leaving');
      setTimeout(function () { card.remove(); }, 230);
    }
    pollNow();
    if (state.tab === 'dashboard') {
      setTimeout(function () { refreshDashboardLive(); }, 240);
    } else if (state.tab === 'orders') {
      refreshOrdersHead().catch(function () { });
    }
  } catch (err) {
    if (err.status === 401) return;
    // مثلاً 409: قبلاً توسط ربات بررسی شده است
    toast(err.message || 'خطا در ثبت وضعیت', 'err');
    refreshActiveTabData();
    pollNow();
  }
}

// دکمه‌ی «موجود شد» داشبورد
async function makeAvailable(id) {
  try {
    const res = await api('/products/' + id + '/availability', { method: 'PATCH' });
    const p = state.products.find(function (x) { return String(x.id) === String(id); });
    if (p) p.available = res.available;
    toast('محصول موجود شد');
    renderUnavailList();
  } catch (err) {
    if (err.status !== 401) toast(err.message || 'خطا در تغییر وضعیت', 'err');
  }
}

/* ── ۱۲) تب سفارش‌ها ────────────────────────────────────────────────── */
async function ensureSite() {
  if (state.site) return state.site;
  try { state.site = await api('/site'); } catch (e) { state.site = null; }
  return state.site;
}

function renderOrders(m) {
  m.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">سفارش‌ها</h1>
        <p class="page-sub">بررسی و مدیریت سفارش‌های ثبت‌شده</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost" data-action="refresh-orders">${icon('refresh')} تازه‌سازی</button>
      </div>
    </div>
    <section class="card">
      <div class="orders-toolbar">
        <label class="toolbar-field">
          <span>وضعیت</span>
          <select id="order-status-filter" data-change="order-status">
            <option value="">همه</option>
            <option value="pending">در انتظار</option>
            <option value="confirmed">تایید شده</option>
            <option value="rejected">رد شده</option>
          </select>
        </label>
        <label class="toolbar-field">
          <span>میز</span>
          <select id="order-table-filter" data-change="order-table"><option value="">همه میزها</option></select>
        </label>
        <span class="toolbar-spacer"></span>
        <span class="count-badge" id="orders-count-badge">…</span>
      </div>
      <div class="card-body" id="orders-list">${skeletonListHTML(4)}</div>
    </section>`;
  const statusSel = document.getElementById('order-status-filter');
  if (statusSel) statusSel.value = state.orderStatus;
  fillTableFilter();
  loadOrders(false);
}

// فیلتر شماره میز: ۱..tableCount (سمت کلاینت روی لیست بارگذاری‌شده)
function fillTableFilter() {
  const sel = document.getElementById('order-table-filter');
  if (!sel) return;
  const cur = state.orderTable;
  ensureSite().then(function (site) {
    if (!site || !sel.isConnected) return;
    const n = clampNum(Number(site.tableCount) || 0, 0, 100);
    let html = '<option value="">همه میزها</option>';
    for (let i = 1; i <= n; i++) html += '<option value="' + i + '">میز ' + fmtNum(i) + '</option>';
    sel.innerHTML = html;
    sel.value = cur;
    if (sel.value !== cur) { sel.value = ''; state.orderTable = ''; }
  });
}

function ordersQueryString(limit, beforeId) {
  let qs = '?limit=' + limit;
  if (state.orderStatus) qs += '&status=' + encodeURIComponent(state.orderStatus);
  if (beforeId) qs += '&before_id=' + beforeId;
  return qs;
}

async function loadOrders(append) {
  const wrap = document.getElementById('orders-list');
  if (!wrap) return;
  if (!append) wrap.innerHTML = skeletonListHTML(4);
  try {
    const limit = 50;
    const before = append && state.orders.length ? state.orders[state.orders.length - 1].id : null;
    const rows = await api('/orders' + ordersQueryString(limit, before));
    if (state.tab !== 'orders') return;
    state.orders = append ? state.orders.concat(rows) : rows;
    // دکمه‌ی «بارگذاری بیشتر» فقط وقتی پاسخ دقیقاً ۵۰ تا بود نمایش داده می‌شود
    state.ordersHasMore = rows.length === limit;
    renderOrderList();
  } catch (err) {
    if (err.status === 401) return;
    if (state.tab !== 'orders') return;
    const w = document.getElementById('orders-list');
    if (w) w.innerHTML = errorStateHTML(err.message);
  }
}

// تازه‌سازی ابتدای لیست در پولینگ بدون از بین بردن سفارش‌های قدیمی‌ترِ بارگذاری‌شده
async function refreshOrdersHead() {
  if (state.tab !== 'orders' || !state.loggedIn) return;
  const wrap = document.getElementById('orders-list');
  if (!wrap) return;
  const limit = 100; // سقف سمت سرور
  const fresh = await api('/orders' + ordersQueryString(limit, null));
  if (state.tab !== 'orders') return;
  if (fresh.length < limit) {
    state.orders = fresh;
    state.ordersHasMore = false;
  } else {
    const minId = fresh[fresh.length - 1].id;
    const tail = state.orders.filter(function (o) { return o.id < minId; });
    state.orders = fresh.concat(tail);
    state.ordersHasMore = true;
  }
  renderOrderList({ preserveScroll: true });
}

function renderOrderList(opts) {
  const wrap = document.getElementById('orders-list');
  if (!wrap) return;
  const keepScroll = !!(opts && opts.preserveScroll);
  const y = window.scrollY;
  const rows = state.orderTable
    ? state.orders.filter(function (o) { return String(o.table_number) === String(state.orderTable); })
    : state.orders;
  const cnt = document.getElementById('orders-count-badge');
  if (cnt) cnt.textContent = fmtNum(rows.length) + ' سفارش';
  let html = '';
  if (!rows.length) {
    html = emptyStateHTML('receipt', 'سفارشی یافت نشد', 'با تغییر فیلترها یا تازه‌سازی، لیست را بررسی کنید.',
      '<button type="button" class="btn btn-ghost btn-sm" data-action="refresh-orders">' + icon('refresh') + ' تازه‌سازی</button>');
  } else {
    html = '<div class="order-list">' + rows.map(orderCardHTML).join('') + '</div>';
    if (state.ordersHasMore) {
      html += '<div class="load-more"><button type="button" class="btn btn-ghost" data-action="load-more-orders">بارگذاری سفارش‌های قدیمی‌تر</button></div>';
    }
  }
  wrap.innerHTML = html;
  if (keepScroll) requestAnimationFrame(function () { window.scrollTo(0, y); });
}
/* ── ۱۳) تب محصولات ─────────────────────────────────────────────────── */
function renderProducts(m) {
  m.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">محصولات</h1>
        <p class="page-sub" id="prod-sub">مدیریت منو، قیمت‌ها و موجودی</p>
      </div>
      <div class="page-actions">
        <div class="view-switch" role="group" aria-label="نوع نمایش محصولات">
          <button type="button" class="view-btn ${state.prodView === 'table' ? 'active' : ''}" data-action="prod-view" data-view="table" aria-label="نمای جدولی" title="نمای جدولی">${icon('list')}</button>
          <button type="button" class="view-btn ${state.prodView === 'grid' ? 'active' : ''}" data-action="prod-view" data-view="grid" aria-label="نمای گالری" title="نمای گالری">${icon('grid')}</button>
        </div>
        <button type="button" class="btn btn-primary" data-action="open-product-modal">${icon('plus')} محصول جدید</button>
      </div>
    </div>
    <section class="card">
      <div class="orders-toolbar prod-toolbar">
        <div class="search-field">
          ${icon('search')}
          <input type="search" id="prod-search" placeholder="جستجوی نام، توضیحات یا دسته…" value="${esc(state.prodSearch)}" data-input="prod-search" aria-label="جستجوی محصولات" />
        </div>
        <label class="toolbar-field">
          <span>دسته</span>
          <select id="prod-cat-filter" data-change="prod-cat"><option value="">همه دسته‌ها</option></select>
        </label>
        <label class="toolbar-field">
          <span>وضعیت</span>
          <select id="prod-avail-filter" data-change="prod-avail">
            <option value="">همه</option>
            <option value="1">فقط موجود</option>
            <option value="0">فقط ناموجود</option>
            <option value="disc">فقط تخفیف‌دار</option>
          </select>
        </label>
      </div>
      <div class="chip-row" id="prod-chips"></div>
      <div class="card-body" id="prod-list">${skeletonListHTML(5)}</div>
    </section>`;
  fillProdCatFilter(document.getElementById('prod-cat-filter'));
  const availSel = document.getElementById('prod-avail-filter');
  if (availSel) availSel.value = state.prodAvail;
  loadProductsData();
}

function fillProdCatFilter(sel) {
  if (!sel) return;
  const cur = state.prodCat;
  sel.innerHTML = '<option value="">همه دسته‌ها</option>' + state.categories.map(function (c) {
    return '<option value="' + esc(c.id) + '">' + esc(c.label) + '</option>';
  }).join('');
  sel.value = cur;
  if (sel.value !== cur) { sel.value = ''; state.prodCat = ''; }
}

async function loadProductsData() {
  try {
    const results = await Promise.all([api('/products'), api('/categories')]);
    state.products = results[0];
    state.categories = results[1];
    if (state.tab !== 'products') return;
    fillProdCatFilter(document.getElementById('prod-cat-filter'));
    renderProductList();
  } catch (err) {
    if (err.status === 401) return;
    if (state.tab !== 'products') return;
    const wrap = document.getElementById('prod-list');
    if (wrap) wrap.innerHTML = errorStateHTML(err.message);
  }
}

function activeFilterPillsHTML() {
  const cat = state.categories.find(function (c) { return String(c.id) === String(state.prodCat); });
  let html = '';
  if (cat) {
    html += `<span class="filter-pill"><span>دسته: ${esc(cat.label)}</span><button type="button" class="pill-x" data-action="clear-prod-cat" aria-label="حذف فیلتر دسته">${icon('x')}</button></span>`;
  }
  if (state.prodSearch.trim()) {
    html += `<span class="filter-pill"><span>جستجو: ${esc(state.prodSearch.trim())}</span><button type="button" class="pill-x" data-action="clear-prod-search" aria-label="پاک کردن جستجو">${icon('x')}</button></span>`;
  }
  return html;
}

function renderProductList() {
  const wrap = document.getElementById('prod-list');
  if (!wrap) return;
  const prods = state.products;
  const total = prods.length;
  const availN = prods.filter(function (p) { return Number(p.available) === 1; }).length;
  const unavailN = total - availN;
  const discN = prods.filter(function (p) { return p.original_price && Number(p.original_price) > Number(p.price); }).length;

  const chips = document.getElementById('prod-chips');
  if (chips) {
    function chip(val, label, n, cls) {
      return `<button type="button" class="chip ${cls || ''} ${state.prodAvail === val ? 'active' : ''}" data-action="prod-avail-chip" data-val="${val}">${label} <b class="num">${fmtNum(n)}</b></button>`;
    }
    chips.innerHTML = chip('', 'همه', total) +
      chip('1', 'موجود', availN, 'chip-success') +
      chip('0', 'ناموجود', unavailN, 'chip-danger') +
      chip('disc', 'تخفیف‌دار', discN, 'chip-accent') +
      activeFilterPillsHTML();
  }

  const q = state.prodSearch.trim().toLowerCase();
  const rows = prods.filter(function (p) {
    if (state.prodCat && String(p.category) !== String(state.prodCat)) return false;
    const hasDisc = p.original_price && Number(p.original_price) > Number(p.price);
    if (state.prodAvail === '1' && Number(p.available) !== 1) return false;
    if (state.prodAvail === '0' && Number(p.available) !== 0) return false;
    if (state.prodAvail === 'disc' && !hasDisc) return false;
    if (q) {
      const hay = (p.name + ' ' + (p.note || '') + ' ' + catLabelOf(p.category)).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  setText('prod-sub', fmtNum(total) + ' محصول در منو' + (rows.length !== total ? ' — ' + fmtNum(rows.length) + ' نتیجه' : ''));

  if (!rows.length) {
    wrap.innerHTML = emptyStateHTML('search', 'محصولی یافت نشد', 'فیلترها را پاک کنید یا محصول جدیدی بسازید.',
      '<button type="button" class="btn btn-ghost btn-sm" data-action="clear-prod-filters">' + icon('x') + ' پاک کردن فیلترها</button>');
    return;
  }
  wrap.innerHTML = state.prodView === 'grid' ? productGridHTML(rows) : productTableHTML(rows);
}

function productImageHTML(p, cls) {
  if (!p.image) {
    return `<span class="${cls} thumb-ph">${icon('cup')}</span>`;
  }
  return `<img class="${cls}" src="${esc(thumbSrc(p.image))}" data-fallback="${esc(imgSrc(p.image))}" alt="${esc(p.name)}" loading="lazy" data-action="zoom" data-src="${esc(imgSrc(p.image))}" data-caption="${esc(p.name)}">`;
}

function priceHTML(p) {
  const hasDisc = p.original_price && Number(p.original_price) > Number(p.price);
  const discPct = hasDisc ? Math.round((1 - Number(p.price) / Number(p.original_price)) * 100) : 0;
  return (hasDisc ? '<span class="price-old num">' + fmtMoney(p.original_price) + '</span> ' : '') +
    '<span class="price num">' + fmtMoney(p.price) + '</span>' +
    (hasDisc ? ' <span class="disc-badge">' + fmtNum(discPct) + '٪ تخفیف</span>' : '');
}

function productTableHTML(rows) {
  return `<div class="table-responsive table-cards"><table class="prod-table">
    <thead><tr>
      <th>تصویر</th><th>محصول</th><th>دسته</th><th>قیمت</th><th>وضعیت</th><th>موجودی</th><th>عملیات</th>
    </tr></thead>
    <tbody>${rows.map(productRowHTML).join('')}</tbody></table></div>`;
}

function productRowHTML(p) {
  const avail = Number(p.available) === 1;
  return `<tr class="${avail ? '' : 'is-unavail'}">
    <td data-label="تصویر">${productImageHTML(p, 'thumb')}</td>
    <td data-label="محصول"><div class="p-name">${esc(p.name)}</div>${p.note ? '<div class="p-note">' + esc(p.note) + '</div>' : ''}</td>
    <td data-label="دسته"><span class="cat-chip">${esc(catLabelOf(p.category))}</span></td>
    <td data-label="قیمت">${priceHTML(p)}</td>
    <td data-label="وضعیت"><span class="status-pill ${avail ? 'st-confirmed' : 'st-unavail'}">${avail ? 'موجود' : 'ناموجود'}</span></td>
    <td data-label="موجودی"><button type="button" class="toggle ${avail ? 'on' : ''}" role="switch" aria-checked="${avail ? 'true' : 'false'}" aria-label="تغییر موجودی ${esc(p.name)}" data-action="toggle-avail" data-id="${p.id}"></button></td>
    <td data-label="عملیات"><div class="row-actions">
      <button type="button" class="icon-btn" data-action="edit-product" data-id="${p.id}" aria-label="ویرایش ${esc(p.name)}" title="ویرایش">${icon('edit')}</button>
      <button type="button" class="icon-btn danger" data-action="delete-product" data-id="${p.id}" aria-label="حذف ${esc(p.name)}" title="حذف">${icon('trash')}</button>
    </div></td>
  </tr>`;
}

// کارت محصول با همان ساختار کارت دسته‌بندی (cat-card / cat-media / cat-body)
function productCardHTML(p) {
  const avail = Number(p.available) === 1;
  const hasDisc = p.original_price && Number(p.original_price) > Number(p.price);
  const discPct = hasDisc ? Math.round((1 - Number(p.price) / Number(p.original_price)) * 100) : 0;
  const zoomAttrs = p.image
    ? ` data-action="zoom" data-src="${esc(imgSrc(p.image))}" data-caption="${esc(p.name)}" role="button" tabindex="0" aria-label="بزرگ‌نمایی ${esc(p.name)}"`
    : '';
  return `<article class="cat-card prod-card ${avail ? '' : 'is-unavail'}">
    <div class="cat-media"${zoomAttrs}>
      ${p.image
      ? `<img src="${esc(thumbSrc(p.image))}" data-fallback="${esc(imgSrc(p.image))}" alt="${esc(p.name)}" loading="lazy">`
      : `<div class="cat-ph">${icon('cup')}</div>`}
      <span class="float-badge fb-avail ${avail ? 'ok' : 'no'}">${avail ? 'موجود' : 'ناموجود'}</span>
      ${hasDisc ? `<span class="float-badge fb-disc">${fmtNum(discPct)}٪ تخفیف</span>` : ''}
    </div>
    <div class="cat-body">
      <h3 class="cat-name" title="${esc(p.name)}">${esc(p.name)}</h3>
      ${p.note ? `<p class="p-note">${esc(p.note)}</p>` : ''}
      <div class="prod-card-price">${priceHTML(p)}</div>
      <div class="prod-card-foot">
        <div class="toggle-wrap">
          <button type="button" class="toggle ${avail ? 'on' : ''}" role="switch" aria-checked="${avail ? 'true' : 'false'}" aria-label="تغییر موجودی ${esc(p.name)}" data-action="toggle-avail" data-id="${p.id}"></button>
          <span class="prod-avail-label ${avail ? 'ok' : 'no'}">${avail ? 'موجود' : 'ناموجود'}</span>
        </div>
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="edit-product" data-id="${p.id}" aria-label="ویرایش ${esc(p.name)}" title="ویرایش">${icon('edit')}</button>
          <button type="button" class="icon-btn danger" data-action="delete-product" data-id="${p.id}" aria-label="حذف ${esc(p.name)}" title="حذف">${icon('trash')}</button>
        </div>
      </div>
    </div>
  </article>`;
}

// نمای گالری: محصولات زیر عنوان دسته‌ی خودشان گروه می‌شوند (به ترتیب دسته‌بندی‌ها)
function productGridHTML(rows) {
  const groups = [];
  const placed = new Set();
  state.categories.forEach(function (c) {
    const items = rows.filter(function (p) { return String(p.category) === String(c.id); });
    if (!items.length) return;
    items.forEach(function (p) { placed.add(p.id); });
    groups.push({ label: c.label, items: items });
  });
  const rest = rows.filter(function (p) { return !placed.has(p.id); });
  if (rest.length) groups.push({ label: 'بدون دسته', items: rest });

  return groups.map(function (g) {
    const unavailN = g.items.filter(function (p) { return Number(p.available) !== 1; }).length;
    return '<section class="prod-group">' +
      '<div class="prod-group-head"><h3>' + esc(g.label) + '</h3>' +
      '<span class="count-badge">' + fmtNum(g.items.length) + ' محصول</span>' +
      (unavailN ? '<span class="count-badge warn">' + fmtNum(unavailN) + ' ناموجود</span>' : '') +
      '</div>' +
      '<div class="prod-grid">' + g.items.map(productCardHTML).join('') + '</div>' +
      '</section>';
  }).join('');
}

// تغییر موجودی با PATCH (بدون ریلود کل صفحه)
async function toggleAvailability(id) {
  const p = state.products.find(function (x) { return String(x.id) === String(id); });
  if (!p) return;
  try {
    const res = await api('/products/' + id + '/availability', { method: 'PATCH' });
    p.available = res.available;
    if (state.tab === 'products') renderProductList();
    if (state.tab === 'dashboard') renderUnavailList();
    toast(Number(res.available) === 1 ? 'محصول موجود شد' : 'محصول ناموجود شد');
  } catch (err) {
    if (err.status !== 401) toast(err.message || 'خطا در تغییر موجودی', 'err');
  }
}

/* ── مودال محصول (با منطق دقیق تخفیف) ───────────────────────────────── */
function updateAvailToggleUI() {
  const t = document.getElementById('p-avail');
  if (!t) return;
  t.classList.toggle('on', state.modalAvail === 1);
  t.setAttribute('aria-checked', state.modalAvail === 1 ? 'true' : 'false');
  setText('p-avail-label', state.modalAvail === 1 ? 'محصول موجود است' : 'محصول ناموجود است');
}

function setProductImage(val) {
  const hidden = document.getElementById('prod-image-value');
  const img = document.getElementById('prod-preview-img');
  const box = document.getElementById('prod-upload-preview');
  if (!hidden || !img || !box) return;
  hidden.value = val || '';
  if (val) {
    img.src = imgSrc(val);
    box.hidden = false;
    setUploadStatus('product', 'تصویر آماده است (برای بزرگ‌نمایی کلیک کنید)');
  } else {
    img.removeAttribute('src');
    box.hidden = true;
    setUploadStatus('product', '');
  }
}

// پیش‌نمایش زنده‌ی تخفیف: «قیمت اصلی X ← با تخفیف Y» (Y گرد به نزدیک‌ترین ۱۰۰۰)
function updateDiscPreview() {
  const box = document.getElementById('disc-preview');
  if (!box) return;
  const price = Number(document.getElementById('p-price').value);
  const discRaw = document.getElementById('p-discount').value.trim();
  const disc = discRaw === '' ? 0 : Number(discRaw);
  if (!price || price < 1000 || !(disc > 0) || disc >= 100) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  const final = Math.round(price * (1 - clampNum(disc, 0, 99) / 100) / 1000) * 1000;
  box.hidden = false;
  box.innerHTML = 'قیمت اصلی <b class="num">' + fmtMoney(price) + '</b> ← با تخفیف <b class="num">' + fmtMoney(final) + '</b>';
}

function openProductModal(id) {
  const p = id ? state.products.find(function (x) { return String(x.id) === String(id); }) : null;
  state.editingProduct = p || null;
  state.editInit = null;
  document.getElementById('prod-form-error').textContent = '';
  setText('prod-modal-title', p ? 'ویرایش محصول' : 'محصول جدید');

  // پر کردن دسته‌ها
  const sel = document.getElementById('p-cat');
  sel.innerHTML = '<option value="">انتخاب دسته…</option>' + state.categories.map(function (c) {
    return '<option value="' + esc(c.id) + '">' + esc(c.label) + '</option>';
  }).join('');

  if (p) {
    document.getElementById('p-name').value = p.name || '';
    sel.value = String(p.category);
    const op = p.original_price != null ? Number(p.original_price) : null;
    if (op && Number(p.price) < op) {
      // محصول تخفیف‌دار: فرم «قیمت پایه» و درصد با یک رقم اعشار نشان می‌دهد
      $('#p-price').value = op;
      $('#p-discount').value = Math.round((1 - Number(p.price) / op) * 1000) / 10;
    } else {
      $('#p-price').value = p.price;
      $('#p-discount').value = '';
    }
    document.getElementById('p-note').value = p.note || '';
    state.modalAvail = Number(p.available) === 1 ? 1 : 0;
    setProductImage(p.image || '');
    state.editInit = { price: Number($('#p-price').value), discount: Number($('#p-discount').value || 0) };
  } else {
    document.getElementById('p-name').value = '';
    $('#p-price').value = '';
    $('#p-discount').value = '';
    document.getElementById('p-note').value = '';
    state.modalAvail = 1;
    setProductImage('');
    // هنگام باز شدن از فیلتر دسته‌ی فعال، همان دسته پیش‌انتخاب شود
    if (state.prodCat) sel.value = String(state.prodCat);
  }
  updateAvailToggleUI();
  updateDiscPreview();
  openLayer('modal-product', '#p-name');
}

async function saveProduct() {
  const errBox = document.getElementById('prod-form-error');
  errBox.textContent = '';
  const name = document.getElementById('p-name').value.trim();
  const cat = document.getElementById('p-cat').value;
  const priceRaw = document.getElementById('p-price').value.trim();
  const price = Number(priceRaw);
  const discRaw = document.getElementById('p-discount').value.trim();
  const disc = discRaw === '' ? 0 : Number(discRaw);
  const note = document.getElementById('p-note').value.trim();
  const image = document.getElementById('prod-image-value').value.trim();

  // اعتبارسنجی سمت کلاینت
  if (!name) { errBox.textContent = 'نام محصول الزامی است.'; document.getElementById('p-name').focus(); return; }
  if (name.length > 80) { errBox.textContent = 'نام محصول حداکثر ۸۰ نویسه است.'; return; }
  if (!cat) { errBox.textContent = 'انتخاب دسته‌بندی الزامی است.'; document.getElementById('p-cat').focus(); return; }
  if (!Number.isFinite(price) || price < 1000 || price > 50000000) {
    errBox.textContent = 'قیمت باید بین ۱٬۰۰۰ تا ۵۰٬۰۰۰٬۰۰۰ تومان باشد.';
    document.getElementById('p-price').focus();
    return;
  }
  if (discRaw !== '' && (!Number.isFinite(disc) || disc < 0 || disc > 99)) {
    errBox.textContent = 'تخفیف باید عددی بین ۰ تا ۹۹ باشد.';
    document.getElementById('p-discount').focus();
    return;
  }
  if (image && !/^\/images\/[\w.-]+\.(jpg|jpeg|png|webp|gif)$/i.test(image)) {
    errBox.textContent = 'آدرس تصویر معتبر نیست.';
    return;
  }

  const btn = document.getElementById('prod-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span class="btn-label">در حال ذخیره…</span>';
  try {
    // منطق «دست‌نخورده»: اگر قیمت و تخفیف تغییر نکرده باشند، قیمت نهایی فعلی +
    // original_price فعلی ارسال می‌شود تا گردکردن چندتومانی رخ ندهد.
    const untouched = state.editingProduct && state.editInit &&
      Number(document.getElementById('p-price').value) === state.editInit.price &&
      Number(document.getElementById('p-discount').value || 0) === state.editInit.discount;

    let body;
    if (untouched) {
      body = { name: name, category: cat, note: note, image: image, available: state.modalAvail, price: state.editingProduct.price };
      if (state.editingProduct.original_price != null) body.original_price = state.editingProduct.original_price;
    } else {
      body = { name: name, category: cat, price: price, discount: disc, note: note, image: image, available: state.modalAvail };
    }

    if (state.editingProduct) {
      await api('/products/' + state.editingProduct.id, { method: 'PUT', body: JSON.stringify(body) });
      toast('محصول ویرایش شد');
    } else {
      await api('/products', { method: 'POST', body: JSON.stringify(body) });
      toast('محصول اضافه شد');
    }
    state.editingProduct = null;
    state.editInit = null;
    closeLayer('modal-product');
    // پس از ذخیره، لیست دوباره از سرور گرفته و رندر می‌شود
    await loadProductsData();
  } catch (err) {
    if (err.status === 401) return;
    errBox.textContent = err.message || 'خطا در ذخیره‌ی محصول';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-label">ذخیره</span>';
  }
}

async function deleteProduct(id) {
  const p = state.products.find(function (x) { return String(x.id) === String(id); });
  const ok = await confirmDialog({
    title: 'حذف محصول',
    message: 'محصول «' + (p ? p.name : '') + '» برای همیشه حذف می‌شود. مطمئن هستید؟',
    confirmText: 'حذف محصول',
  });
  if (!ok) return;
  try {
    await api('/products/' + id, { method: 'DELETE' });
    toast('محصول حذف شد');
    await loadProductsData();
  } catch (err) {
    if (err.status !== 401) toast(err.message || 'خطا در حذف محصول', 'err');
  }
}
/* ── ۱۴) دسته‌بندی‌ها ────────────────────────────────────────────────── */
function renderCategories(m) {
  m.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">دسته‌بندی‌ها</h1>
        <p class="page-sub" id="cat-sub">سازمان‌دهی منو</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-primary" data-action="open-category-modal">${icon('plus')} دسته‌بندی جدید</button>
      </div>
    </div>
    <section class="card">
      <div class="orders-toolbar">
        <div class="search-field">
          ${icon('search')}
          <input type="search" id="cat-search" placeholder="جستجوی نام دسته‌بندی…" value="${esc(state.catSearch)}" data-input="cat-search" aria-label="جستجوی دسته‌بندی‌ها" />
        </div>
      </div>
      <div class="card-body" id="cat-list">${skeletonListHTML(4)}</div>
    </section>`;
  loadCategoriesData();
}

// برای شمارش‌ها هم /categories و هم /products لازم است
async function loadCategoriesData() {
  try {
    const results = await Promise.all([api('/categories'), api('/products')]);
    state.categories = results[0];
    state.products = results[1];
    if (state.tab !== 'categories') return;
    renderCategoryList();
  } catch (err) {
    if (err.status === 401) return;
    if (state.tab !== 'categories') return;
    const wrap = document.getElementById('cat-list');
    if (wrap) wrap.innerHTML = errorStateHTML(err.message);
  }
}

function renderCategoryList() {
  const wrap = document.getElementById('cat-list');
  if (!wrap) return;
  setText('cat-sub', fmtNum(state.categories.length) + ' دسته‌بندی');
  if (!state.categories.length) {
    wrap.innerHTML = emptyStateHTML('tag', 'هنوز دسته‌بندی‌ای ندارید', 'برای شروع، اولین دسته‌بندی را بسازید.',
      '<button type="button" class="btn btn-primary btn-sm" data-action="open-category-modal">' + icon('plus') + ' دسته‌بندی جدید</button>');
    return;
  }
  const q = state.catSearch.trim().toLowerCase();
  const rows = q ? state.categories.filter(function (c) {
    return (c.label || '').toLowerCase().indexOf(q) !== -1;
  }) : state.categories;
  if (!rows.length) {
    wrap.innerHTML = emptyStateHTML('search', 'دسته‌ای یافت نشد', 'عبارت جستجو را تغییر دهید.');
    return;
  }
  wrap.innerHTML = '<div class="cat-grid">' + rows.map(function (c) {
    const inCat = state.products.filter(function (p) { return String(p.category) === String(c.id); });
    const availN = inCat.filter(function (p) { return Number(p.available) === 1; }).length;
    const unavailN = inCat.length - availN;
    const meta = fmtNum(inCat.length) + ' محصول' +
      (unavailN > 0 ? ' • <span class="txt-danger">' + fmtNum(unavailN) + ' ناموجود</span>' : ' • همه موجود');
    return `<article class="cat-card">
      <div class="cat-media" ${c.image ? `data-action="zoom" data-src="${esc(imgSrc(c.image))}" data-caption="${esc(c.label)}" role="button" tabindex="0" aria-label="بزرگ‌نمایی ${esc(c.label)}"` : ''}>
        ${c.image
        ? `<img src="${esc(thumbSrc(c.image))}" data-fallback="${esc(imgSrc(c.image))}" alt="${esc(c.label)}" loading="lazy">`
        : `<div class="cat-ph">${icon('cup')}</div>`}
      </div>
      <div class="cat-body">
        <h3 class="cat-name">${esc(c.label)}</h3>
        <p class="cat-meta">${meta}</p>
        <div class="row-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="goto-cat-products" data-id="${c.id}">${icon('cup')} محصولات</button>
          <button type="button" class="icon-btn" data-action="edit-category" data-id="${c.id}" aria-label="ویرایش ${esc(c.label)}" title="ویرایش">${icon('edit')}</button>
          <button type="button" class="icon-btn danger" data-action="delete-category" data-id="${c.id}" aria-label="حذف ${esc(c.label)}" title="حذف">${icon('trash')}</button>
        </div>
      </div>
    </article>`;
  }).join('') + '</div>';
}

function setCategoryImage(val) {
  const hidden = document.getElementById('cat-image-value');
  const img = document.getElementById('cat-preview-img');
  const box = document.getElementById('cat-upload-preview');
  if (!hidden || !img || !box) return;
  hidden.value = val || '';
  if (val) {
    img.src = imgSrc(val);
    box.hidden = false;
    setUploadStatus('category', 'تصویر آماده است (برای بزرگ‌نمایی کلیک کنید)');
  } else {
    img.removeAttribute('src');
    box.hidden = true;
    setUploadStatus('category', '');
  }
}

function openCategoryModal(id) {
  const c = id ? state.categories.find(function (x) { return String(x.id) === String(id); }) : null;
  state.editingCat = c || null;
  document.getElementById('cat-form-error').textContent = '';
  setText('cat-modal-title', c ? 'ویرایش دسته‌بندی' : 'دسته‌بندی جدید');
  document.getElementById('c-label').value = c ? (c.label || '') : '';
  setCategoryImage(c ? (c.image || '') : '');
  openLayer('modal-category', '#c-label');
}

async function saveCategory() {
  const errBox = document.getElementById('cat-form-error');
  errBox.textContent = '';
  const label = document.getElementById('c-label').value.trim();
  const image = document.getElementById('cat-image-value').value.trim();
  if (!label) { errBox.textContent = 'نام دسته‌بندی الزامی است.'; document.getElementById('c-label').focus(); return; }
  if (label.length > 40) { errBox.textContent = 'نام دسته‌بندی حداکثر ۴۰ نویسه است.'; return; }
  if (image && !/^\/images\/[\w.-]+\.(jpg|jpeg|png|webp|gif)$/i.test(image)) {
    errBox.textContent = 'آدرس تصویر معتبر نیست.';
    return;
  }
  const btn = document.getElementById('cat-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span class="btn-label">در حال ذخیره…</span>';
  try {
    if (state.editingCat) {
      await api('/categories/' + state.editingCat.id, { method: 'PUT', body: JSON.stringify({ label: label, image: image }) });
      toast('دسته‌بندی ویرایش شد');
    } else {
      await api('/categories', { method: 'POST', body: JSON.stringify({ label: label, image: image }) });
      toast('دسته‌بندی اضافه شد');
    }
    state.editingCat = null;
    closeLayer('modal-category');
    await loadCategoriesData();
  } catch (err) {
    if (err.status === 401) return;
    errBox.textContent = err.message || 'خطا در ذخیره‌ی دسته‌بندی';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-label">ذخیره</span>';
  }
}

async function deleteCategory(id) {
  const c = state.categories.find(function (x) { return String(x.id) === String(id); });
  const ok = await confirmDialog({
    title: 'حذف دسته‌بندی',
    message: 'دسته‌بندی «' + (c ? c.label : '') + '» حذف شود؟ اگر محصول داشته باشد، حذف انجام نمی‌شود.',
    confirmText: 'حذف',
  });
  if (!ok) return;
  try {
    await api('/categories/' + id, { method: 'DELETE' });
    toast('دسته‌بندی حذف شد');
    await loadCategoriesData();
  } catch (err) {
    if (err.status !== 401) toast(err.message || 'خطا در حذف دسته‌بندی', 'err');
  }
}

/* ── ۱۵) QR میزها ───────────────────────────────────────────────────── */
function signingState(site) {
  if (!site) return { label: 'نامشخص', cls: '' };
  if (!site.signingSecretPresent) return { label: 'غیرفعال (سکرت ست نشده)', cls: 'st-rejected' };
  if (site.signingEnabled) return { label: 'فعال (الزامی)', cls: 'st-confirmed' };
  return { label: 'خاموش (اسکن الزامی نیست)', cls: 'st-pending' };
}

function qrSvgTag(url, scalable) {
  if (typeof qrcode !== 'function') {
    return '<p class="txt-danger">کتابخانه‌ی QR بارگذاری نشده است.</p>';
  }
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createSvgTag(scalable ? { cellSize: 6, margin: 4, scalable: true } : { cellSize: 6, margin: 4 });
  } catch (e) {
    return '<p class="txt-danger">خطا در ساخت QR</p>';
  }
}

function qrSvgString(url) {
  if (typeof qrcode !== 'function') return '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    // بدون scalable تا SVG اندازه‌ی ذاتی داشته باشد (برای رندر PNG قابل اطمینان است)
    return qr.createSvgTag({ cellSize: 6, margin: 4 });
  } catch (e) {
    return '';
  }
}

async function renderQr(m) {
  m.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">QR میزها</h1>
        <p class="page-sub">کارت هر میز را چاپ کنید یا لینکش را پخش کنید</p>
      </div>
      <div class="page-actions no-print">
        <button type="button" class="btn btn-ghost" data-action="qr-print">${icon('print')} چاپ همه‌ی کارت‌ها</button>
      </div>
    </div>
    <section class="card no-print">
      <div class="card-body qr-banner-body">
        <span class="count-badge" id="qr-table-count">…</span>
        <span class="status-pill" id="qr-sign-state">…</span>
        <span class="qr-banner-hint">برای تغییر تعداد میزها یا وضعیت امضا به «تصاویر و تنظیمات» بروید.</span>
      </div>
    </section>
    <section class="card no-print">
      <div class="card-body" id="qr-grid">${skeletonListHTML(4)}</div>
    </section>
    <!-- شیت چاپ: فقط هنگام چاپ نمایش داده می‌شود -->
    <div id="qr-print-sheet" aria-hidden="true"></div>`;
  try {
    const data = await api('/table-qr-links');
    state.tableLinks = data;
    if (state.tab !== 'qr') return;
    setText('qr-table-count', fmtNum(data.tableCount) + ' میز');
    const stEl = document.getElementById('qr-sign-state');
    if (stEl) {
      const st = signingState(data);
      stEl.textContent = st.label;
      stEl.className = 'status-pill ' + (st.cls || '');
    }
    const grid = document.getElementById('qr-grid');
    if (!grid) return;
    if (!data.links || !data.links.length) {
      grid.innerHTML = emptyStateHTML('qr', 'میز تعریف نشده است', 'ابتدا تعداد میزها را در «تصاویر و تنظیمات» مشخص کنید.');
      return;
    }
    grid.innerHTML = '<div class="qr-grid">' + data.links.map(qrCardHTML).join('') + '</div>';
  } catch (err) {
    if (err.status === 401) return;
    if (state.tab !== 'qr') return;
    const grid = document.getElementById('qr-grid');
    if (grid) grid.innerHTML = errorStateHTML(err.message);
  }
}

function qrCardHTML(link) {
  const full = window.location.origin + link.url;
  return `<article class="qr-card" data-table="${link.table}">
    <span class="qr-cafe">کافه روشن</span>
    <h3 class="qr-table">میز شماره ${fmtNum(link.table)}</h3>
    <div class="qr-box">${qrSvgTag(full, true)}</div>
    <p class="qr-hint">برای مشاهده‌ی منو و ثبت سفارش، با دوربین گوشی اسکن کنید</p>
    <p class="qr-url">${esc(full)}</p>
    <div class="qr-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-action="qr-png" data-table="${link.table}" data-url="${esc(full)}">${icon('download')} PNG</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="qr-svg" data-table="${link.table}" data-url="${esc(full)}">${icon('download')} SVG</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="qr-copy" data-url="${esc(full)}">${icon('copy')} کپی لینک</button>
    </div>
  </article>`;
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  const u = URL.createObjectURL(blob);
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
}

// دانلود PNG ۱۰۰۰×۱۰۰۰ با پس‌زمینه‌ی سفید: SVG → Image → canvas → toBlob
async function downloadQrPng(table, url) {
  try {
    const svg = qrSvgString(url);
    if (!svg) throw new Error('no svg');
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise(function (resolve, reject) {
      img.onload = resolve;
      img.onerror = reject;
      img.src = blobUrl;
    });
    const size = 1000;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const ratio = Math.min(size / img.width, size / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    URL.revokeObjectURL(blobUrl);
    const pngBlob = await new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
    if (!pngBlob) throw new Error('no blob');
    saveBlob(pngBlob, 'table-' + table + '-qr.png');
    toast('تصویر PNG ذخیره شد');
  } catch (e) {
    toast('ساخت تصویر PNG ممکن نشد', 'err');
  }
}

function downloadQrSvg(table, url) {
  const svg = qrSvgString(url);
  if (!svg) { toast('ساخت فایل SVG ممکن نشد', 'err'); return; }
  saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'table-' + table + '-qr.svg');
  toast('فایل SVG ذخیره شد');
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise(function (resolve, reject) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      ok ? resolve() : reject(new Error('copy failed'));
    } catch (e) {
      reject(e);
    }
  });
}

// ساخت شیت چاپ (بار اول ساخته می‌شود و کش می‌شود)
function printQrCards() {
  const data = state.tableLinks;
  if (!data || !data.links || !data.links.length) {
    toast('کارت‌ها هنوز بارگذاری نشده‌اند', 'err');
    return;
  }
  const sheet = document.getElementById('qr-print-sheet');
  if (!sheet) return;
  if (!sheet.innerHTML) {
    sheet.innerHTML = '<h1 class="print-title">کافه روشن — کارت QR میزها</h1><div class="print-grid">' +
      data.links.map(function (l) {
        const full = window.location.origin + l.url;
        return '<div class="print-card">' +
          '<div class="print-cafe">کافه روشن</div>' +
          '<div class="print-table">میز شماره ' + fmtNum(l.table) + '</div>' +
          qrSvgString(full) +
          '<div class="print-url">' + esc(full) + '</div>' +
          '</div>';
      }).join('') + '</div>';
  }
  window.print();
}

/* ── ۱۶) تنظیمات سایت ──────────────────────────────────────────────── */
async function renderSite(m) {
  m.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">تصاویر و تنظیمات</h1>
        <p class="page-sub">لوگو و کاور سایت، تعداد میزها و امنیت QR</p>
      </div>
    </div>

    <div class="site-grid">
      <section class="card">
        <div class="card-header"><h2>${icon('image')} لوگوی سایت</h2></div>
        <div class="card-body">
          <div class="site-preview" id="logo-preview">${skeletonListHTML(1)}</div>
          <div class="site-media-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="pick-site-image" data-kind="logo">${icon('plus')} آپلود لوگوی جدید</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="delete-site-image" data-kind="logo">${icon('trash')} حذف لوگو</button>
          </div>
          <p class="hint">حداکثر عرض توصیه‌شده ۶۰۰ پیکسل؛ jpg، png، webp یا gif.</p>
        </div>
      </section>
      <section class="card">
        <div class="card-header"><h2>${icon('image')} تصویر کاور</h2></div>
        <div class="card-body">
          <div class="site-preview" id="cover-preview">${skeletonListHTML(1)}</div>
          <div class="site-media-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="pick-site-image" data-kind="cover">${icon('plus')} آپلود کاور جدید</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="delete-site-image" data-kind="cover">${icon('trash')} حذف کاور</button>
          </div>
          <p class="hint">حداکثر عرض توصیه‌شده ۱۶۰۰ پیکسل؛ jpg، png، webp یا gif.</p>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-header"><h2>${icon('pin')} تعداد میزها</h2></div>
      <div class="card-body">
        <form id="table-count-form" class="inline-form" novalidate>
          <label class="toolbar-field">
            <span>تعداد میزها (۱ تا ۱۰۰)</span>
            <input type="number" id="table-count-input" min="1" max="100" step="1" inputmode="numeric" />
          </label>
          <button type="submit" class="btn btn-primary" id="table-count-btn"><span class="btn-label">ذخیره</span></button>
        </form>
        <p class="form-error" id="table-count-err" role="alert"></p>
        <p class="hint">تعداد میزها روی صفحه‌ی QR و فیلتر میز در سفارش‌ها اثر می‌گذارد.</p>
      </div>
    </section>

    <section class="card">
      <div class="card-header"><h2>${icon('qr')} الزام اسکن QR برای ثبت سفارش</h2></div>
      <div class="card-body">
        <div class="switch-row">
          <div>
            <p id="signing-label">سفارش فقط با اسکن QR از روی میز</p>
            <p class="hint" id="signing-hint"></p>
          </div>
          <button type="button" class="toggle" id="signing-toggle" role="switch" aria-checked="false" aria-labelledby="signing-label" data-action="toggle-signing"></button>
        </div>
      </div>
    </section>

    <!-- ورودی فایل مشترک برای لوگو/کاور -->
    <input type="file" id="site-file-input" accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif" hidden data-site-kind="" />`;
  await loadSiteSection();
}

async function loadSiteSection() {
  let site;
  try {
    site = await api('/site');
  } catch (err) {
    if (err.status === 401) return;
    if (state.tab !== 'site') return;
    toast(err.message || 'خطا در بارگذاری تنظیمات سایت', 'err');
    return;
  }
  state.site = site;
  if (state.tab !== 'site') return;

  const logoBox = document.getElementById('logo-preview');
  if (logoBox) {
    logoBox.innerHTML = site.logo
      ? `<img src="${esc(imgSrc(site.logo))}" alt="لوگوی کافه" data-action="zoom" data-src="${esc(imgSrc(site.logo))}" data-caption="لوگو">`
      : `<div class="site-ph">${icon('image')}<span>لوگویی آپلود نشده است</span></div>`;
  }
  const coverBox = document.getElementById('cover-preview');
  if (coverBox) {
    coverBox.innerHTML = site.cover
      ? `<img src="${esc(imgSrc(site.cover))}" alt="کاور منو" data-action="zoom" data-src="${esc(imgSrc(site.cover))}" data-caption="کاور">`
      : `<div class="site-ph">${icon('image')}<span>کاوری آپلود نشده است</span></div>`;
  }
  const tci = document.getElementById('table-count-input');
  if (tci && document.activeElement !== tci) tci.value = site.tableCount || '';

  const tg = document.getElementById('signing-toggle');
  if (tg) {
    const hasSecret = !!site.signingSecretPresent;
    tg.disabled = !hasSecret;
    tg.classList.toggle('on', !!site.signingEnabled);
    tg.setAttribute('aria-checked', site.signingEnabled ? 'true' : 'false');
    setText('signing-hint', !hasSecret
      ? 'سکرت TABLE_SIGNING_SECRET در ورکر ست نشده است؛ امکان فعال‌سازی وجود ندارد.'
      : site.signingEnabled
        ? 'الزام فعال است؛ سفارش فقط با لینک امضاشده‌ی هر میز پذیرفته می‌شود.'
        : 'الزام خاموش است؛ هر کسی با آدرس سایت می‌تواند برای هر میزی سفارش دهد.');
  }
}

async function handleTableCountSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('table-count-err');
  const btn = document.getElementById('table-count-btn');
  errBox.textContent = '';
  const raw = document.getElementById('table-count-input').value;
  const val = Number(raw);
  if (!raw || !Number.isInteger(val) || val < 1 || val > 100) {
    errBox.textContent = 'تعداد میز باید عدد صحیح بین ۱ تا ۱۰۰ باشد.';
    return;
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span class="btn-label">در حال ذخیره…</span>';
  try {
    await api('/site/table-count', { method: 'PUT', body: JSON.stringify({ tableCount: val }) });
    if (state.site) state.site.tableCount = val;
    state.tableLinks = null; // لینک‌های QR باید دوباره ساخته شوند
    document.getElementById('table-count-input').value = val;
    toast('تعداد میزها ذخیره شد');
  } catch (err) {
    if (err.status !== 401) errBox.textContent = err.message || 'خطا در ذخیره‌ی تعداد میزها';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-label">ذخیره</span>';
  }
}

async function toggleSigning() {
  const tg = document.getElementById('signing-toggle');
  if (!tg || tg.disabled) return;
  const turningOff = tg.classList.contains('on');
  if (turningOff) {
    // خاموش کردن نیاز به تایید دارد
    const ok = await confirmDialog({
      title: 'خاموش کردن الزام QR',
      message: 'با خاموش کردن الزام، هر کسی با داشتن آدرس سایت می‌تواند از بیرون کافه برای هر میزی سفارش ثبت کند. مطمئن هستید؟',
      confirmText: 'بله، خاموش کن',
    });
    if (!ok) return;
  }
  tg.disabled = true;
  try {
    await api('/site/signing', { method: 'PUT', body: JSON.stringify({ enabled: !turningOff }) });
    toast(turningOff ? 'الزام QR خاموش شد' : 'الزام QR فعال شد');
    if (state.tableLinks) state.tableLinks = null;
    await loadSiteSection(); // همین بخش دوباره بارگذاری می‌شود
  } catch (err) {
    if (err.status !== 401) toast(err.message || 'خطا در تغییر تنظیم امضا', 'err');
    tg.disabled = false;
  }
}

async function deleteSiteImage(kind) {
  const label = kind === 'logo' ? 'لوگو' : 'کاور';
  const ok = await confirmDialog({
    title: 'حذف ' + label,
    message: 'تصویر ' + label + ' از سایت حذف شود؟',
    confirmText: 'حذف',
  });
  if (!ok) return;
  try {
    await api('/site/' + kind, { method: 'DELETE' });
    toast(label + ' حذف شد');
    await loadSiteSection();
  } catch (err) {
    if (err.status !== 401) toast(err.message || 'خطا در حذف تصویر', 'err');
  }
}
/* ── ۱۷) مدیریت خطای تصاویر (فاز capture روی document) ──────────────── */
document.addEventListener('error', function (e) {
  const el = e.target;
  if (!(el instanceof HTMLImageElement)) return;
  // اول fallback به تصویر اصلی، سپس placeholder
  const fb = el.dataset.fallback;
  if (fb) {
    let abs = fb;
    try { abs = new URL(fb, location.href).href; } catch (e2) { /* نسبی بماند */ }
    if (el.src !== abs) {
      el.removeAttribute('data-fallback');
      el.src = fb;
      return;
    }
  }
  const ph = document.createElement('div');
  ph.className = (el.className || '') + ' thumb-ph';
  ph.setAttribute('role', 'img');
  ph.setAttribute('aria-label', 'تصویر در دسترس نیست');
  ph.innerHTML = icon('cup');
  if (el.parentNode) el.parentNode.replaceChild(ph, el);
}, true);

/* ── ۱۸) رویدادها: delegation با data-action ────────────────────────── */
const actions = {
  // ناوبری
  'nav': function (el) { switchTab(el.dataset.tab); },
  'sheet-nav': function (el) { closeLayer('sheet-overlay'); switchTab(el.dataset.tab); },
  'open-sheet': function () { openLayer('sheet-overlay', '.sheet-item'); },
  'overlay-close': function (el, e) { if (e.target === el) closeLayer(el.id); },
  'close-modal': function (el) { closeLayer(el.dataset.modal || (el.closest('.overlay') || {}).id); },
  'toggle-theme': function () { toggleTheme(); },
  'toggle-sound': function () { toggleSound(); },
  'logout': function () { doLogout(); },

  // داشبورد و سفارش‌ها
  'refresh-dashboard': function () { refreshDashboardLive({ full: true }); },
  'refresh-orders': function () {
    refreshOrdersHead().catch(function (err) {
      if (err.status !== 401) toast(err.message || 'خطا در تازه‌سازی', 'err');
    });
    pollNow();
  },
  'load-more-orders': function () { loadOrders(true); },
  'order-resolve': function (el) { resolveOrder(el.dataset.id, el.dataset.status); },
  'make-available': function (el) { makeAvailable(el.dataset.id); },
  'retry': function () { switchTab(state.tab); },

  // محصولات
  'prod-view': function (el) {
    state.prodView = el.dataset.view === 'grid' ? 'grid' : 'table';
    localStorage.setItem(VIEW_KEY, state.prodView);
    $$('.view-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === state.prodView); });
    renderProductList();
  },
  'prod-avail-chip': function (el) {
    state.prodAvail = el.dataset.val || '';
    const sel = document.getElementById('prod-avail-filter');
    if (sel) sel.value = state.prodAvail;
    renderProductList();
  },
  'clear-prod-cat': function () {
    state.prodCat = '';
    const sel = document.getElementById('prod-cat-filter');
    if (sel) sel.value = '';
    renderProductList();
  },
  'clear-prod-search': function () {
    state.prodSearch = '';
    const input = document.getElementById('prod-search');
    if (input) input.value = '';
    renderProductList();
  },
  'clear-prod-filters': function () {
    state.prodSearch = '';
    state.prodCat = '';
    state.prodAvail = '';
    const input = document.getElementById('prod-search');
    if (input) input.value = '';
    const catSel = document.getElementById('prod-cat-filter');
    if (catSel) catSel.value = '';
    const availSel = document.getElementById('prod-avail-filter');
    if (availSel) availSel.value = '';
    renderProductList();
  },
  'open-product-modal': function () { openProductModal(null); },
  'edit-product': function (el) { openProductModal(el.dataset.id); },
  'save-product': function () { saveProduct(); },
  'delete-product': function (el) { deleteProduct(el.dataset.id); },
  'toggle-avail': function (el) { toggleAvailability(el.dataset.id); },
  'toggle-prod-avail': function () {
    state.modalAvail = state.modalAvail === 1 ? 0 : 1;
    updateAvailToggleUI();
  },
  'clear-prod-image': function () { setProductImage(''); },
  'zoom-self': function (el) {
    const src = el.getAttribute('src');
    if (src) openLightbox(src, el.alt || 'پیش‌نمایش تصویر');
  },
  'zoom': function (el) { openLightbox(el.dataset.src, el.dataset.caption || ''); },
  'close-lightbox': function () { closeLightbox(); },

  // دسته‌بندی‌ها
  'open-category-modal': function () { openCategoryModal(null); },
  'edit-category': function (el) { openCategoryModal(el.dataset.id); },
  'save-category': function () { saveCategory(); },
  'delete-category': function (el) { deleteCategory(el.dataset.id); },
  'goto-cat-products': function (el) {
    state.prodCat = String(el.dataset.id || '');
    switchTab('products');
  },
  'clear-cat-image': function () { setCategoryImage(''); },

  // QR
  'qr-print': function () { printQrCards(); },
  'qr-png': function (el) { downloadQrPng(el.dataset.table, el.dataset.url); },
  'qr-svg': function (el) { downloadQrSvg(el.dataset.table, el.dataset.url); },
  'qr-copy': function (el) {
    copyText(el.dataset.url).then(function () {
      toast('لینک میز کپی شد');
    }).catch(function () {
      toast('کپی لینک ممکن نشد', 'err');
    });
  },

  // تنظیمات سایت
  'pick-site-image': function (el) {
    state.siteUploadKind = el.dataset.kind;
    const input = document.getElementById('site-file-input');
    if (input) {
      input.dataset.siteKind = el.dataset.kind;
      input.value = '';
      input.click();
    }
  },
  'delete-site-image': function (el) { deleteSiteImage(el.dataset.kind); },
  'toggle-signing': function () { toggleSigning(); },
};

document.addEventListener('click', function (e) {
  // لایت‌باکس: کلیک روی پس‌زمینه می‌بندد
  const lb = document.getElementById('lightbox');
  if (lb && !lb.hidden && e.target === lb) {
    closeLightbox();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const handler = actions[el.dataset.action];
  if (handler) handler(el, e);
});

document.addEventListener('input', function (e) {
  const el = e.target;
  if (el.dataset.input === 'prod-search') {
    state.prodSearch = el.value;
    renderProductList();
  } else if (el.dataset.input === 'cat-search') {
    state.catSearch = el.value;
    renderCategoryList();
  } else if (el.id === 'p-price' || el.id === 'p-discount') {
    updateDiscPreview();
  }
});

document.addEventListener('change', function (e) {
  const el = e.target;
  if (el.id === 'prod-file-input') {
    handleFilePicked('product', el.files[0]);
    el.value = '';
  } else if (el.id === 'cat-file-input') {
    handleFilePicked('category', el.files[0]);
    el.value = '';
  } else if (el.id === 'site-file-input') {
    handleFilePicked(el.dataset.siteKind || state.siteUploadKind, el.files[0]);
    el.value = '';
  } else if (el.dataset.change === 'order-status') {
    state.orderStatus = el.value;
    state.orders = [];
    loadOrders(false);
  } else if (el.dataset.change === 'order-table') {
    state.orderTable = el.value;
    renderOrderList();
  } else if (el.dataset.change === 'prod-cat') {
    state.prodCat = el.value;
    renderProductList();
  } else if (el.dataset.change === 'prod-avail') {
    state.prodAvail = el.value;
    renderProductList();
  }
});

document.addEventListener('submit', function (e) {
  if (e.target.id === 'login-form') handleLoginSubmit(e);
  else if (e.target.id === 'table-count-form') handleTableCountSubmit(e);
});

// Esc برای بستن لایه‌ها + تله‌ی فوکوس با Tab
document.addEventListener('keydown', function (e) {
  const lb = document.getElementById('lightbox');
  if (lb && !lb.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === 'Tab') {
      e.preventDefault(); // لایت‌باکس فقط یک دکمه دارد
    }
    return;
  }
  const top = topLayer();
  if (!top) {
    // عناصر role="button" (مثل رسانه‌ی کارت محصول) با Enter/Space هم فعال شوند
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-action]')) {
      e.preventDefault();
      e.target.click();
    }
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (top.id === 'modal-confirm') {
      const c = document.getElementById('confirm-cancel-btn');
      if (c) c.click();
    } else {
      closeLayer(top.id);
    }
  } else if (e.key === 'Tab') {
    const items = visibleFocusables(top);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (!top.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

// اتصال یک‌باره‌ی نواحی آپلود (کلیک، درگ‌ودراپ و Enter/Space)
function bindStaticUploads() {
  [['prod-upload-area', 'prod-file-input', 'product'], ['cat-upload-area', 'cat-file-input', 'category']].forEach(function (pair) {
    const area = document.getElementById(pair[0]);
    const input = document.getElementById(pair[1]);
    if (!area || !input) return;
    area.addEventListener('click', function () { input.click(); });
    area.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      area.addEventListener(ev, function (e) {
        e.preventDefault();
        area.classList.add('drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      area.addEventListener(ev, function (e) {
        e.preventDefault();
        area.classList.remove('drag');
      });
    });
    area.addEventListener('drop', function (e) {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFilePicked(pair[2], file);
    });
  });
}

/* ── ۱۹) شروع ───────────────────────────────────────────────────────── */
// زمان نسبی سفارش‌های در انتظار («۵ دقیقه پیش») هر ۳۰ ثانیه بدون رندر مجدد کل لیست تازه می‌شود
setInterval(function () {
  $$('.order-ago').forEach(function (el) {
    const t = relTime(el.dataset.created);
    if (t && el.textContent !== t) el.textContent = t;
  });
}, 30000);

bindStaticUploads();
boot();