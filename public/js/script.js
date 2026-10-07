// ============ SCROLL LOCK (مطمئن، مخصوص موبایل/سافاری) ============
// فقط overflow:hidden رو body کافی نیست؛ تو سافاری موبایل صفحه‌ی پشت مودال بازم rubber-band
// اسکرول می‌کنه و باعث بهم‌ریختگی می‌شه. این تابع body رو واقعاً fixed می‌کنه و بعد از بسته شدن
// دقیقاً به همون نقطه‌ی اسکرول قبلی برمی‌گردونه.
let scrollLockCount = 0;
let savedScrollY = 0;

function lockScroll() {
  if (scrollLockCount === 0) {
    savedScrollY = window.scrollY || window.pageYOffset;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.documentElement.classList.add('nav-open');
    document.body.classList.add('nav-open');
  }
  scrollLockCount++;
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.documentElement.classList.remove('nav-open');
    document.body.classList.remove('nav-open');
    // چون scroll-behavior:smooth رو html ست شده، اسکرول مستقیم انیمیشن‌دار میشه
    // (از بالای صفحه به پایین میاد). برای یه لحظه smooth رو خاموش می‌کنیم تا پرش آنی باشه.
    const prevBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, savedScrollY);
    document.documentElement.style.scrollBehavior = prevBehavior;
  }
}

// تم روشن حذف شد (باگ داشت) — سایت همیشه تیره‌ست، نیازی به تنظیم data-theme نیست

// ============ MOBILE NAV ============
const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');

function closeMobileNav() {
  if (!mainNav.classList.contains('open')) return;
  mainNav.classList.remove('open');
  navToggle.classList.remove('active');
  navToggle.setAttribute('aria-expanded', 'false');
  navToggle.setAttribute('aria-label', 'باز کردن منو');
  unlockScroll();
}

navToggle.addEventListener('click', () => {
  if (mainNav.classList.contains('open')) { closeMobileNav(); return; }
  mainNav.classList.add('open');
  navToggle.classList.add('active');
  navToggle.setAttribute('aria-expanded', 'true');
  navToggle.setAttribute('aria-label', 'بستن منو');
  lockScroll();
});

mainNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', closeMobileNav);
});

// ============ PRICE FORMAT ============
// جلوگیری از XSS: اسم/توضیح محصول از دیتابیس میاد و ممکنه توسط ادمین وارد شده باشه؛
// قبل از گذاشتن تو innerHTML باید escape بشه (پنل ادمین خودش این تابع رو داره، اینجا هم لازمه)
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatPrice(price) {
  // عدد انگلیسی + جداکننده‌ی هزارگان + حرف T به‌جای «ت» (واحد: هزار تومان).
  // اگه قیمت مضرب ۱۰۰۰ نبود (مثلاً ۴۵٬۵۰۰) گرد نمی‌کنیم و ۴۵.۵ نشون میدیم تا جمع کل با جمع ردیف‌ها بخونه
  const val = Math.round((Number(price) || 0) / 10) / 100;
  return `<span class="price-amount">${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span><span class="price-suffix">T</span>`;
}
// ============ SPLASH SCREEN LOGIC ============
// از window.load استفاده نمی‌کنیم چون منتظر لود کامل همه‌ی عکس‌های محصولات هم می‌مونه
// و اگه نت کند باشه، اسپلش می‌تونه چند ثانیه (حتی بیشتر از ۱۰ ثانیه) گیر کنه.
// به‌جاش با DOMContentLoaded (فقط منتظر خود صفحه) + یه سقف زمانی مطمئن کار می‌کنیم.
// دیتای داخل HTML (سرور گذاشته)؛ اگه نبود یا خراب بود null برمی‌گردونه و fetch معمولی جواب میده
let bootCache;
function getBoot() {
  if (bootCache !== undefined) return bootCache;
  try {
    const el = document.getElementById('bootData');
    bootCache = el ? JSON.parse(el.textContent) : null;
  } catch { bootCache = null; }
  return bootCache;
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.dataset.hidden === 'true') return;
  splash.dataset.hidden = 'true';
  splash.classList.add('hide');
  // کلاس site-loaded برای استایل‌دهی بعد از رفتن اسپلش (و رویداد siteloaded برای پیش‌لود عکس‌ها)
  document.body.classList.add('site-loaded');
  window.dispatchEvent(new Event('siteloaded'));
  setTimeout(() => splash.remove(), 250);
}

document.addEventListener('DOMContentLoaded', () => {
  // اسپلش رو تا وقتی هم منو/محصولات و هم تنظیمات سایت (لوگو) کامل لود نشدن نگه می‌داریم،
  // تا کاربر هیچ‌وقت سایت نصفه‌کاره یا در حال لود رو نبینه. اگه لود بیشتر از ۴ ثانیه طول کشید
  // (نت کند، سرور کند، هرچی)، همون سقف ۴ ثانیه‌ای رعایت میشه و از رو اسپلش رد میشیم.
  // علاوه بر دیتا، منتظر عکس‌های اولِ منو و فونت‌ها هم می‌مونیم تا بعد از رفتن اسپلش،
  // عکس‌ها یکی‌یکی نپرن و متن‌ها فونتشون عوض نشه (همه‌ی این انتظارها سقف زمانی دارن).
  const allLoaded = Promise.all([productsLoadedPromise, siteConfigPromise])
    .then(() => waitForMenuImages(2000));
  const hardCap = new Promise((resolve) => setTimeout(resolve, 4500));
  Promise.race([allLoaded, hardCap]).then(hideSplash);
});

// شبکه‌ی ایمنی نهایی: مهم نیست چه اتفاقی بیفته (حتی اگه DOMContentLoaded خودش گیر کنه)،
// اسپلش بیشتر از ۴.۵ ثانیه رو صفحه نمی‌مونه.
setTimeout(hideSplash, 4500);

// ============ PRODUCT MODAL ============
const modal = document.getElementById('productModal');
const modalClose = document.getElementById('modalClose');
const modalImage = document.getElementById('modalImage');
const modalPlaceholder = document.getElementById('modalPlaceholder');
const modalCat = document.getElementById('modalCat');
const modalName = document.getElementById('modalName');
const modalNote = document.getElementById('modalNote');
const modalPrice = document.getElementById('modalPrice');
const modalAddBtn = document.getElementById('modalAddBtn');
let modalProductId = null;
let modalImgToken = 0;

const CAT_COLORS = {
  coffee: '#B58863',
  dessert: '#9DBA8F', // دیفالت سایت
  breakfast: '#E8A93E',
  sweets: '#D4918F'
};

// تنها منبع رنگ دسته‌ها (CSS از متغیر --cat-color استفاده می‌کنه)؛ دسته‌ی جدیدی که از ادمین اضافه بشه
// هم یه رنگ ثابت (از روی hash اسمش) می‌گیره و بی‌رنگ نمی‌مونه
function catColor(id) {
  if (Object.prototype.hasOwnProperty.call(CAT_COLORS, id)) return CAT_COLORS[id];
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 38% 62%)`;
}

// ============ مدیریت فوکوس دیالوگ‌ها (سبد، مودال محصول، مرتب‌سازی) ============
// موقع باز شدن فوکوس میره داخل دیالوگ، با Tab از دیالوگ بیرون نمی‌زنه، و موقع بسته شدن به المان قبلی برمی‌گرده
const focusReturn = new Map();
function rememberFocus(key) { focusReturn.set(key, document.activeElement); }
function restoreFocus(key) {
  const el = focusReturn.get(key);
  focusReturn.delete(key);
  if (el && el.isConnected && typeof el.focus === 'function' && el !== document.body) el.focus({ preventScroll: true });
}
function focusInside(el) {
  requestAnimationFrame(() => el && el.focus({ preventScroll: true }));
}
function focusableIn(root) {
  return [...root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.getClientRects().length > 0);
}
function topDialog() {
  if (tableModal.classList.contains('open')) return tableModal;
  if (cartDrawer.classList.contains('open')) return cartDrawer;
  if (sortModal.classList.contains('open')) return sortModal;
  if (modal.classList.contains('open')) return modal.querySelector('.modal-box');
  return null;
}

// ============ پیش‌بارگذاری عکس مودال ============
// قبلاً عکس بزرگ محصول فقط بعد از کلیک شروع به دانلود می‌کرد؛ برای همین موبایل بعد از لمس چند ثانیه
// اسکلتون می‌دید. حالا: (۱) کارت‌هایی که کاربر واقعاً دیده تو پس‌زمینه با اولویت پایین و حداکثر ۲ تا
// همزمان پیش‌لود میشن، (۲) لحظه‌ی لمس کارت (قبل از رها کردن انگشت) دانلودش با اولویت بالا شروع میشه.
// تو حالت صرفه‌جویی داده یا نت 2G هیچ پیش‌لود پس‌زمینه‌ای انجام نمیشه.
const mediumPreload = new Map();   // آدرس ← <img> (برای اینکه GC نشه و بشه فهمید تموم شده یا نه)
const preloadQueue = [];
let preloadActive = 0;

function mediumUrlFor(imgSrc) {
  if (!imgSrc) return null;
  return /^https?:\/\//i.test(imgSrc) ? imgSrc : `images/med/${imgSrc.split('/').pop()}`;
}

function canBackgroundPreload() {
  const c = navigator.connection;
  return !(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
}

function pumpPreload() {
  while (preloadActive < 2 && preloadQueue.length) {
    const url = preloadQueue.shift();
    if (mediumPreload.has(url)) continue;
    const im = new Image();
    im.decoding = 'async';
    im.fetchPriority = 'low';
    preloadActive++;
    const done = () => { preloadActive--; pumpPreload(); };
    im.onload = done;
    im.onerror = () => { mediumPreload.delete(url); done(); };
    im.src = url;
    mediumPreload.set(url, im);
  }
}

function queueMediumPreload(imgSrc) {
  const url = mediumUrlFor(imgSrc);
  if (!url || mediumPreload.has(url) || preloadQueue.includes(url) || !canBackgroundPreload()) return;
  preloadQueue.push(url);
  if (window.requestIdleCallback) window.requestIdleCallback(pumpPreload, { timeout: 1500 });
  else setTimeout(pumpPreload, 200);
}

// لمس کارت = احتمال خیلی بالای کلیک؛ همین الان با اولویت بالا شروع کن
function boostMediumPreload(imgSrc) {
  const url = mediumUrlFor(imgSrc);
  if (!url || mediumPreload.has(url)) return;
  const im = new Image();
  im.decoding = 'async';
  im.fetchPriority = 'high';
  im.onerror = () => mediumPreload.delete(url);
  im.src = url;
  mediumPreload.set(url, im);
}

// افکت نئون دور کارت‌ها فقط وقتی کارت تو دیده که انیمیشنش اجرا بشه (تا با ۳۰+ کارت موبایل ضعیف نکشه)
let neonObserver = null;
function observeCardNeon() {
  if (neonObserver) neonObserver.disconnect();
  const cards = document.querySelectorAll('.product-card');
  if (!('IntersectionObserver' in window)) { cards.forEach(c => c.classList.add('neon-on')); return; }
  neonObserver = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle('neon-on', e.isIntersecting);
  }, { rootMargin: '60px 0px' });
  cards.forEach(c => neonObserver.observe(c));
}

let cardPreloadObserver = null;
function observeCardsForPreload() {
  if (!('IntersectionObserver' in window)) return;
  if (cardPreloadObserver) cardPreloadObserver.disconnect();
  const timers = new Map();
  cardPreloadObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const card = e.target;
      if (!e.isIntersecting) { clearTimeout(timers.get(card)); timers.delete(card); continue; }
      // فقط کارتی که حداقل نیم ثانیه تو دید بوده (اسکرول سریع، نصفه‌کاره‌ها رو پیش‌لود نکنه)
      timers.set(card, setTimeout(() => {
        timers.delete(card);
        cardPreloadObserver.unobserve(card);
        const product = productsData && productsData.products.find(p => p.id === card.dataset.id);
        if (product) queueMediumPreload(product.image || getCategoryImage(product.category));
      }, 500));
    }
  }, { rootMargin: '150px 0px' });
  document.querySelectorAll('.product-card').forEach(card => cardPreloadObserver.observe(card));
}

// ============ انیمیشن باز/بسته شدن محصول: خود کارت زوم میشه و میاد وسط صفحه ============
// ایده: کپیِ کارت (ghost) از جای کارت شروع می‌کنه و به‌اندازه‌ی پاپ‌آپ بزرگ میشه و محو میشه؛ هم‌زمان خودِ
// پاپ‌آپ از شکل و جای کارت (با clip-path) باز میشه و محتواش محو میاد. فقط scale یکنواخت داریم، پس متن کش نمیاد.
// موقع بستن همین مسیر برعکس میره و کارت سر جای اولش برمی‌گرده. با «کاهش حرکت» فقط پس‌زمینه محو/ظاهر میشه.
const MODAL_OPEN_MS = 400;
const MODAL_CLOSE_MS = 300; // کمتر از تأخیر visibility تو CSS (۰.۳۴ ثانیه) بمونه
const MODAL_EASE_OPEN = 'cubic-bezier(0.22, 1, 0.36, 1)';
const MODAL_EASE_CLOSE = 'cubic-bezier(0.4, 0, 0.2, 1)';
let modalCard = null;   // کارتی که پاپ‌آپ ازش باز شده (تا بسته شدن نیمه‌شفاف/مخفیه)
let modalGhost = null;
let modalAnims = [];

function cancelModalAnims() {
  modalAnims.forEach(a => { try { a.cancel(); } catch { /* مهم نیست */ } });
  modalAnims = [];
}

// همه‌ی حالت‌های انیمیشن رو پاک می‌کنه و کارت رو به حالت عادی برمی‌گردونه
function finishModalMotion() {
  cancelModalAnims();
  if (modalGhost) { modalGhost.remove(); modalGhost = null; }
  if (modalCard) { modalCard.style.opacity = ''; modalCard = null; }
}

// مختصات شروع (کارت) و پایان (پاپ‌آپ)؛ null یعنی انیمیشن ممکن نیست و بدون حرکت ادامه میدیم
function modalMotionGeometry(card) {
  const box = modal.querySelector('.modal-box');
  if (!card || !card.isConnected || !box || !box.animate || prefersReducedMotion()) return null;
  const cr = card.getBoundingClientRect();
  const fr = box.getBoundingClientRect();
  if (!cr.width || !cr.height || !fr.width || !fr.height) return null;
  const s = cr.width / fr.width;
  const dx = (cr.left + cr.width / 2) - (fr.left + fr.width / 2);
  const dy = (cr.top + cr.height / 2) - (fr.top + fr.height / 2);
  // پنجره‌ی دیدِ اولیه به‌اندازه‌ی کارته (بالا/پایین پاپ‌آپ بریده میشه)
  const v = Math.max(0, (fr.height - cr.height / s) / 2);
  return {
    box, cr, dx, dy, s,
    from: { transform: `translate(${dx}px, ${dy}px) scale(${s})`, clipPath: `inset(${v}px 0px ${v}px 0px round ${16 / s}px)` },
    to: { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px 0px 0px round 24px)' },
  };
}

function makeCardGhost(card, cr) {
  const g = card.cloneNode(true);
  g.removeAttribute('data-id');
  g.removeAttribute('tabindex');
  g.setAttribute('aria-hidden', 'true');
  g.classList.add('card-ghost');
  g.querySelectorAll('.card-neon').forEach(n => n.remove());
  Object.assign(g.style, {
    position: 'fixed', left: `${cr.left}px`, top: `${cr.top}px`,
    width: `${cr.width}px`, height: `${cr.height}px`,
    margin: '0', zIndex: '2', pointerEvents: 'none', opacity: '1',
  });
  modal.append(g);
  return g;
}

function modalContentEls() {
  return modal.querySelectorAll('.modal-image, .modal-body, .modal-close');
}

function playModalOpen(card) {
  cancelModalAnims();
  const m = modalMotionGeometry(card);
  if (!m) return;
  const { box, cr, dx, dy, s } = m;

  modalCard = card;
  card.style.opacity = '0'; // خود کارت تا بسته شدن پاپ‌آپ خالیه؛ همون کارته که بزرگ شده
  if (modalGhost) modalGhost.remove();
  const ghost = modalGhost = makeCardGhost(card, cr);

  modalAnims.push(box.animate([m.from, m.to], { duration: MODAL_OPEN_MS, easing: MODAL_EASE_OPEN }));
  modalContentEls().forEach(el => {
    modalAnims.push(el.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: 240, delay: 110, easing: 'ease-out', fill: 'backwards' }));
  });
  const ghostAnim = ghost.animate([
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0 },
    { opacity: 0, offset: 0.5 },
    { transform: `translate(${-dx}px, ${-dy}px) scale(${1 / s})`, opacity: 0, offset: 1 },
  ], { duration: MODAL_OPEN_MS, easing: MODAL_EASE_OPEN, fill: 'forwards' });
  ghostAnim.onfinish = () => { if (modalGhost === ghost) { ghost.remove(); modalGhost = null; } };
  modalAnims.push(ghostAnim);
}

function playModalClose() {
  cancelModalAnims();
  const card = modalCard;
  const m = modalMotionGeometry(card);
  if (!m) { finishModalMotion(); return; }
  const { box, cr, dx, dy, s } = m;

  if (modalGhost) modalGhost.remove();
  const ghost = modalGhost = makeCardGhost(card, cr);
  ghost.style.opacity = '0';

  // fill:forwards یعنی تا لحظه‌ای که overlay کامل مخفی میشه، پاپ‌آپ به حالت باز برنمی‌گرده (فلش نداریم)
  modalAnims.push(box.animate([m.to, m.from], { duration: MODAL_CLOSE_MS, easing: MODAL_EASE_CLOSE, fill: 'forwards' }));
  modalContentEls().forEach(el => {
    modalAnims.push(el.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 120, easing: 'ease-in', fill: 'forwards' }));
  });
  const ghostAnim = ghost.animate([
    { transform: `translate(${-dx}px, ${-dy}px) scale(${1 / s})`, opacity: 0, offset: 0 },
    { opacity: 0, offset: 0.45 },
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 1 },
  ], { duration: MODAL_CLOSE_MS, easing: MODAL_EASE_CLOSE, fill: 'forwards' });
  ghostAnim.onfinish = () => {
    // کپی و کارت اصلی دقیقاً هم‌شکل‌ان؛ هم‌زمان جابه‌جا میشن، پس هیچ پرشی دیده نمیشه
    if (modalGhost === ghost) { ghost.remove(); modalGhost = null; }
    if (modalCard === card) { card.style.opacity = ''; modalCard = null; }
  };
  modalAnims.push(ghostAnim);
}

function openModal(product, catLabelText, card) {
  finishModalMotion(); // اگه انیمیشن بسته‌شدنِ قبلی هنوز در جریانه، تمومش کن
  modalProductId = product.id;
  resetModalZoom();
  modalImage.dataset.fullSrc = product.image || getCategoryImage(product.category) || '';
  modalImage.querySelectorAll('img').forEach(el => el.remove());
  modalImage.classList.remove('img-ready');
  modalPlaceholder.style.display = 'none';
  modalPlaceholder.textContent = product.name.charAt(0);

  // مودال عکس اصلی چندمگابایتی رو نمی‌گیره؛ نسخه‌ی متوسط (≤۸۰۰px) رو می‌گیره که معمولاً قبل از کلیک
  // پیش‌لود شده. اگه هنوز نرسیده بود، تامبنیل کارت (که همین الان تو کش مرورگره) همون لحظه نشون داده
  // میشه و عکس واضح روش fade میشه (دو لایه‌ی روی هم؛ بدون تغییر اندازه، پس پرشی نداریم).
  // عکس اصلی فقط موقع زوم (data-full) لود میشه.
  const imgSrc = product.image || getCategoryImage(product.category);
  const token = ++modalImgToken;
  if (imgSrc) {
    const isLocal = !/^https?:\/\//i.test(imgSrc);
    const fname = imgSrc.split('/').pop();
    const medUrl = mediumUrlFor(imgSrc);
    const cardImg = card && card.querySelector('.product-image img');
    const thumbUrl = (cardImg && cardImg.getAttribute('src')) || (isLocal ? `images/thumb/${fname}` : null);
    const absFull = new URL(imgSrc, location.href).href;
    const alive = () => token === modalImgToken;

    const mk = (cls, src) => {
      const el = document.createElement('img');
      el.className = cls;
      el.alt = product.name;
      el.decoding = 'async';
      el.dataset.full = imgSrc;
      el.src = src;
      return el;
    };
    const showFailed = () => {
      modalImage.querySelectorAll('img').forEach(el => el.remove());
      modalImage.classList.add('img-ready');
      modalPlaceholder.style.display = 'flex';
    };

    const full = mk('m-full', medUrl);
    const showFull = () => {
      if (!alive()) return;
      modalImage.classList.add('img-ready');
      requestAnimationFrame(() => full.classList.add('shown'));
    };
    full.onload = showFull;
    full.onerror = () => {
      if (!alive()) return;
      if (full.src !== absFull) { full.src = absFull; return; }   // نسخه‌ی متوسط نبود ← عکس اصلی
      if (!modalImage.querySelector('.m-thumb.shown')) showFailed();
    };
    modalImage.append(full);

    const alreadyThere = full.complete && full.naturalWidth > 0;
    if (alreadyThere) {
      showFull();
    } else if (thumbUrl) {
      const th = mk('m-thumb', thumbUrl);
      const showThumb = () => {
        if (!alive()) return;
        modalImage.classList.add('img-ready');
        th.classList.add('shown');
      };
      th.onload = showThumb;
      th.onerror = () => th.remove();
      modalImage.prepend(th);
      if (th.complete && th.naturalWidth > 0) showThumb(); // از کش آماده‌ست؛ همون لحظه نشونش بده
    }
  } else {
    modalImage.classList.add('img-ready');
    modalPlaceholder.style.display = 'flex';
  }

  modalCat.textContent = catLabelText;
  modalCat.style.setProperty('--cat-color', catColor(product.category));
  modalName.textContent = product.name;
  modalNote.textContent = product.note;
  if (product.originalPrice && product.originalPrice > product.price) {
    modalPrice.innerHTML = `<span class="price-old mono">${formatPrice(product.originalPrice)}</span><span class="price-new">${formatPrice(product.price)}</span>`;
  } else {
    modalPrice.innerHTML = formatPrice(product.price);
  }

  rememberFocus('modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  lockScroll();
  history.pushState({ modal: true }, "");
  focusInside(modalClose);
  playModalOpen(card);
}

function closeModal() {
  if (!modal.classList.contains('open')) return;
  resetModalZoom();
  modalImgToken++; // دانلودهای نیمه‌کاره‌ی عکس مودال دیگه چیزی تغییر نمیدن
  playModalClose();
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  unlockScroll();
  restoreFocus('modal');
}

function handleClose() {
  if (history.state && history.state.modal) {
    history.back();
  } else {
    closeModal();
  }
}

modalClose.addEventListener('click', handleClose);
modal.addEventListener('click', (e) => {
  if (e.target === modal) handleClose();
});
modalAddBtn.addEventListener('click', () => {
  if (!modalProductId) return;
  addToCart(modalProductId);

  modalAddBtn.textContent = "افزوده شد ✓";
  modalAddBtn.classList.add('added');
  setTimeout(() => {
    modalAddBtn.textContent = "افزودن +";
    modalAddBtn.classList.remove('added');
  }, 1500);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // فقط بالاترین لایه بسته میشه (هر Escape یه لایه)
    if (tableModal.classList.contains('open')) { handleTableClose(); return; }
    if (cartDrawer.classList.contains('open')) { requestCloseCart(); return; }
    if (sortModal.classList.contains('open')) { requestCloseSort(); return; }
    if (modal.classList.contains('open')) { handleClose(); return; }
    closeMobileNav();
    return;
  }

  // تله‌ی فوکوس: Tab/Shift+Tab داخل بالاترین دیالوگ می‌چرخه
  if (e.key === 'Tab') {
    const dlg = topDialog();
    if (!dlg) return;
    const items = focusableIn(dlg);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
window.addEventListener('popstate', () => {
  // دکمه‌ی برگشت وقتی پاپ‌آپ میز بازه، فقط خود پاپ‌آپ رو می‌بنده و سبد خرید باز می‌مونه
  if (tableModal.classList.contains('open')) { closeTableModal(); return; }
  closeModal();
  closeCart();
  closeSortModal();
});

// ============ MENU RENDER & SORT ============
const grid = document.getElementById('productGrid');
const tabsEl = document.getElementById('categoryTabs');
const sortToggle = document.getElementById('sortToggle');
const sortOverlay = document.getElementById('sortOverlay');
const sortModal = document.getElementById('sortModal');
const sortModalClose = document.getElementById('sortModalClose');

let productsData = { categories: [], products: [] };
let activeCategory = 'all';
let currentSort = 'default';

// ============ لود عکس محصولات ============
// قبلاً عکس‌ها تا باز شدن یه «گیت» صبر می‌کردن و بعد یکی‌یکی (هر کدوم بعد از load قبلی) می‌اومدن؛
// نتیجه‌ش این بود که بعد از رفتن اسپلش، عکس‌ها یکی‌یکی روی صفحه می‌پریدن. حالا تامبنیل‌ها کوچیک‌ان
// (~۱۰ کیلوبایت) و همه با هم، از همون اول شروع می‌شن. فقط ۱۲ تای اول eager هستن؛ بقیه lazy.
const EAGER_IMAGE_COUNT = 12;
let productImgIndex = 0;

// منتظر می‌مونه عکس‌های دسته‌بندی و چند کارت اول واقعاً دانلود و دیکد بشن (یا سقف زمانی تموم بشه)
function waitForMenuImages(timeoutMs) {
  const imgs = Array.from(document.querySelectorAll('.cat-card-img img, .product-card img'))
    .slice(0, EAGER_IMAGE_COUNT + 6);
  return Promise.all(imgs.map(img => {
    if (img.loading === 'lazy' && !img.complete) return Promise.resolve();
    return waitForImage(img, timeoutMs);
  }));
}

// فونت‌ها از گوگل میان (CSS غیرمسدودکننده). قبلاً فقط document.fonts.ready رو صبر می‌کردیم که
// اگه هنوز هیچ فونتی درخواست نشده باشه همون لحظه resolve میشه؛ نتیجه: فونت وسط انیمیشن اسپلش
// می‌رسید، عرض عنوان عوض می‌شد و کل صفحه دوباره چیده می‌شد (پرش). حالا وجه‌های واقعی رو صراحتاً
// درخواست می‌کنیم و انیمیشن اسپلش فقط بعد از رسیدنشون (با سقف زمانی) شروع میشه.
let fontsPromise = null;
function waitForFonts(timeoutMs) {
  if (fontsPromise) return fontsPromise;
  const css = document.getElementById('fontCss');
  const cssReady = (!css || css.dataset.ready)
    ? Promise.resolve()
    : new Promise(resolve => {
        css.addEventListener('load', resolve, { once: true });
        css.addEventListener('error', resolve, { once: true });
      });
  const loadFaces = () => {
    if (!document.fonts || !document.fonts.load) return null;
    const fa = 'سلام کافه روشن';
    return Promise.all([
      document.fonts.load('400 16px Vazirmatn', fa),
      document.fonts.load('600 16px Vazirmatn', fa),
      document.fonts.load('700 16px Vazirmatn', fa),
      document.fonts.load('900 16px Estedad', fa),
      document.fonts.load('italic 500 16px "Cormorant Garamond"', 'Roshan Cafe'),
    ]).catch(() => {});
  };
  fontsPromise = Promise.race([
    cssReady.then(loadFaces),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ]);
  return fontsPromise;
}

async function loadProducts() {
  try {
    // Worker دیتا رو مستقیم تو HTML گذاشته؛ فقط اگه نبود (مثلاً خطای سرور) fetch می‌کنیم
    const boot = getBoot() && getBoot().products;
    if (boot) {
      productsData = boot;
    } else {
      const res = await fetch('data/products.json');
      productsData = await res.json();
    }
  } catch (err) {
    console.error('محصولات لود نشدند:', err);
    return;
  }
  renderTabs();
  renderProducts();
  restoreCart();
}

// اگه محصولی عکس نداشت، عکس دسته‌بندیش (یا اولین محصول دارای عکس تو همون دسته) رو نشون میده
function getCategoryImage(catId) {
  const cat = productsData.categories.find(c => c.id === catId);
  if (cat && cat.image) return cat.image;
  const withImg = productsData.products.find(p => p.category === catId && p.image);
  return withImg ? withImg.image : null;
}

function renderTabs() {
  const allBtn = `<button class="cat-card active" data-cat="all">
    <span class="cat-card-img cat-card-img--all">✦</span>
    <span class="cat-card-label">همه</span>
  </button>`;

  const catBtns = productsData.categories.map(c => {
    const img = getCategoryImage(c.id);
    const imgHtml = img
      ? `<img src="${productThumbSrc(img)}" alt="${esc(c.label)}" decoding="async" data-fallback="${esc(c.label.charAt(0))}" onerror="const t=this.getAttribute('data-fallback'); this.remove(); this.parentElement.textContent=t;">`
      : esc(c.label.charAt(0));
    return `<button class="cat-card" data-cat="${esc(c.id)}">
      <span class="cat-card-img">${imgHtml}</span>
      <span class="cat-card-label">${esc(c.label)}</span>
    </button>`;
  }).join('');

  tabsEl.innerHTML = allBtn + catBtns;

  // کلیک روی یه دسته‌بندی، بقیه رو حذف نمی‌کنه؛ کل منو همون‌جا می‌مونه و فقط نرم اسکرول می‌کنیم به اون بخش
  tabsEl.querySelectorAll('.cat-card').forEach(btn => {
    btn.addEventListener('click', () => scrollToCategory(btn.dataset.cat));
  });
}

// ============ اسکرول نرم به دسته‌بندی + هایلایت خودکار تب فعال موقع اسکرول ============
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let autoScrollRaf = null;
let removeScrollInterrupts = null;
window.__menuAutoScrolling = false; // هدر (مخفی‌شدن خودکار) این رو چک می‌کنه تا وسط اسکرول برنامه‌ای پرش نکنه

function menuBarOffset() {
  const bar = document.querySelector('.menu-controls');
  return bar ? bar.offsetHeight : 0;
}

function stopAutoScroll() {
  if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
  if (removeScrollInterrupts) { removeScrollInterrupts(); removeScrollInterrupts = null; }
  window.__menuAutoScrolling = false;
}

// انیمیشن اسکرول با منحنی easeInOutCubic؛ مدت‌زمان متناسب با فاصله‌ست تا هم فاصله‌ی کم تند نشه
// هم فاصله‌ی زیاد کش نیاد. اگه کاربر وسطش با ماوس/لمس/کیبورد دخالت کنه، همون لحظه قطع میشه.
function smoothScrollToY(targetY, { hideHeaderAtEnd = false } = {}) {
  stopAutoScroll();
  const startY = window.scrollY;
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  targetY = Math.max(0, Math.min(targetY, maxY));
  const dist = targetY - startY;
  if (Math.abs(dist) < 2) return;

  const html = document.documentElement;
  const prevBehavior = html.style.scrollBehavior;
  // CSS روی html مقدار scroll-behavior:smooth داره؛ اگه خاموشش نکنیم، هر فریم scrollTo خودش
  // دوباره انیمیشن می‌خوره و حرکت لرزون میشه
  html.style.scrollBehavior = 'auto';

  if (prefersReducedMotion()) {
    window.scrollTo(0, targetY);
    html.style.scrollBehavior = prevBehavior;
    if (hideHeaderAtEnd) document.body.classList.add('header-hidden');
    return;
  }

  const duration = Math.min(1100, Math.max(500, Math.abs(dist) * 0.5));
  const t0 = performance.now();
  window.__menuAutoScrolling = true;

  const interrupts = ['wheel', 'touchstart', 'mousedown', 'keydown'];
  const onInterrupt = () => finish(false);

  function finish(completed) {
    html.style.scrollBehavior = prevBehavior;
    stopAutoScroll(); // لیسنرهای دخالت کاربر رو هم برمی‌داره
    if (completed && hideHeaderAtEnd) document.body.classList.add('header-hidden');
    updateActiveFromScroll();
  }

  interrupts.forEach(ev => window.addEventListener(ev, onInterrupt, { passive: true }));
  removeScrollInterrupts = () => interrupts.forEach(ev => window.removeEventListener(ev, onInterrupt));

  function step(now) {
    const p = Math.min((now - t0) / duration, 1);
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    window.scrollTo(0, startY + dist * eased);
    if (p < 1) autoScrollRaf = requestAnimationFrame(step);
    else finish(true);
  }
  autoScrollRaf = requestAnimationFrame(step);
}

function centerTabInStrip(btn) {
  const tr = tabsEl.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  const delta = (br.left + br.width / 2) - (tr.left + tr.width / 2);
  if (Math.abs(delta) > 4) tabsEl.scrollBy({ left: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function setActiveTab(catId) {
  activeCategory = catId;
  let activeBtn = null;
  tabsEl.querySelectorAll('.cat-card').forEach(b => {
    const on = b.dataset.cat === catId;
    b.classList.toggle('active', on);
    if (on) activeBtn = b;
  });
  if (activeBtn) centerTabInStrip(activeBtn);
}

function scrollToCategory(catId) {
  setActiveTab(catId); // فوراً هایلایت میشه، نه اینکه منتظر برسیم

  if (catId === 'all') {
    const menu = document.getElementById('menu');
    if (menu) smoothScrollToY(menu.getBoundingClientRect().top + window.scrollY);
    return;
  }

  const group = grid.querySelector(`.menu-group[data-cat="${CSS.escape(catId)}"]`);
  if (!group) return;
  // وقتی وارد بخش منو شدیم هدر بالا قفل و مخفی میشه (همون منطق قبلی)، پس نوار کتگوری به top:0 می‌چسبه
  // و فقط ارتفاع خود نوار رو باید کم کنیم تا عنوان دسته زیرش گم نشه
  const y = group.getBoundingClientRect().top + window.scrollY - menuBarOffset() + 4;
  smoothScrollToY(y, { hideHeaderAtEnd: true });
}

// تب فعال رو با موقعیت اسکرول هماهنگ نگه می‌داره (بدون کلیک هم، با اسکرول عادی عوض میشه)
let spyTicking = false;
function updateActiveFromScroll() {
  spyTicking = false;
  if (window.__menuAutoScrolling) return;
  const groups = grid.querySelectorAll('.menu-group[data-cat]');
  if (!groups.length) return;

  const line = menuBarOffset() + 40; // خط مرجع: کمی زیر نوار چسبان
  let current = 'all';
  groups.forEach(g => {
    if (g.getBoundingClientRect().top <= line) current = g.dataset.cat;
  });
  if (current !== activeCategory) setActiveTab(current);
}

window.addEventListener('scroll', () => {
  if (!spyTicking) {
    spyTicking = true;
    requestAnimationFrame(updateActiveFromScroll);
  }
}, { passive: true });

function openSortModal() {
  if (sortModal.classList.contains('open')) return;
  rememberFocus('sort');
  sortModal.classList.add('open');
  sortOverlay.classList.add('open');
  sortToggle.classList.add('active');
  lockScroll();
  history.pushState({ sort: true }, "");
  focusInside(sortModal.querySelector('.sort-option.active') || sortModalClose);
}

function closeSortModal() {
  if (!sortModal.classList.contains('open')) return;
  sortModal.classList.remove('open');
  sortOverlay.classList.remove('open');
  sortToggle.classList.remove('active');
  unlockScroll();
  restoreFocus('sort');
}

function requestCloseSort() {
  if (history.state && history.state.sort) history.back();
  else closeSortModal();
}

sortToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  openSortModal();
});

sortModalClose.addEventListener('click', requestCloseSort);
sortOverlay.addEventListener('click', requestCloseSort);

sortModal.querySelectorAll('.sort-option').forEach(btn => {
  btn.addEventListener('click', () => {
    sortModal.querySelectorAll('.sort-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSort = btn.dataset.sort;
    renderProducts();
    requestCloseSort();
  });
});

// توی منو فقط یه مربع ۱۱۶×۱۱۶ نشون داده میشه، پس نیازی به دانلود عکس اصلی (که می‌تونه
// چند مگابایت باشه) نیست؛ به‌جاش نسخه‌ی کوچیک‌شده‌ی سرور (/images/thumb/...) رو می‌گیریم.
// عکس با کیفیت و سایز اصلی فقط وقتی کارت کلیک بشه و مودال باز بشه لود میشه (openModal).
function productThumbSrc(src) {
  if (!src || /^https?:\/\//i.test(src)) return src; // لینک خارجی رو دست‌نخورده می‌ذاریم
  const filename = src.split('/').pop();
  return `images/thumb/${filename}`;
}

function productCardHtml(p) {
  const imgSrc = p.image || getCategoryImage(p.category);
  const thumbSrc = productThumbSrc(imgSrc);
  const lazy = productImgIndex++ >= EAGER_IMAGE_COUNT ? 'lazy' : 'eager';
  return `
    <article class="product-card" data-id="${esc(p.id)}" tabindex="0" style="--cat-color:${catColor(p.category)}">
      <svg class="card-neon" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="1" y="1" width="98" height="98" rx="7" ry="7" pathLength="100"></rect>
      </svg>
      <div class="product-image">
        ${imgSrc ? `<img src="${thumbSrc}" alt="${esc(p.name)}" loading="${lazy}" decoding="async" onload="this.parentElement.classList.add('img-ready')" onerror="this.remove(); this.parentElement.classList.add('img-ready'); this.parentElement.querySelector('.placeholder').style.display='flex';">` : ''}
        <div class="placeholder" style="display:${imgSrc ? 'none' : 'flex'};">${esc(p.name.charAt(0))}</div>
      </div>
      <div class="product-info">
        <div class="product-header">
          <span class="cat-dot"></span>
          <div class="product-name">${esc(p.name)}</div>
          ${p.originalPrice ? '<span class="discount-badge">تخفیف</span>' : ''}
        </div>
        <div class="product-note">${esc(p.note)}</div>
        <div class="product-footer">
          <div class="price-group">
            ${p.originalPrice ? `<span class="price-old mono">${formatPrice(p.originalPrice)}</span>` : ''}
            <span class="product-price mono">${formatPrice(p.price)}</span>
          </div>
          <button class="add-to-cart-btn" data-id="${esc(p.id)}">افزودن +</button>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  productImgIndex = 0;
  // همه‌ی محصولات همیشه نمایش داده میشن؛ دسته‌بندی‌ها فقط برای اسکرول به همون بخش هستن، نه فیلتر
  let items = [...productsData.products];

  if (currentSort === 'low-high') {
    items.sort((a, b) => a.price - b.price);
  } else if (currentSort === 'high-low') {
    items.sort((a, b) => b.price - a.price);
  }

  const catLabel = id => {
    const c = productsData.categories.find(c => c.id === id);
    return c ? c.label : id;
  };

  // محصولات زیر عنوان دسته‌بندی خودشون گروه میشن؛ هر گروه data-cat داره تا کلیک روی تب دسته
  // (و هایلایت خودکار تب موقع اسکرول) بتونه همون بخش رو پیدا کنه
  const groups = productsData.categories
    .map(c => ({ cat: c, items: items.filter(p => p.category === c.id) }))
    .filter(g => g.items.length > 0);

  grid.innerHTML = groups.map(g => `
    <div class="menu-group" data-cat="${esc(g.cat.id)}">
      <h3 class="menu-group-title">${esc(g.cat.label)}</h3>
      <div class="product-list">
        ${g.items.map(productCardHtml).join('')}
      </div>
    </div>
  `).join('');

  updateActiveFromScroll();

  grid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('pointerdown', () => {
      const pr = productsData.products.find(p => p.id === card.dataset.id);
      if (pr) boostMediumPreload(pr.image || getCategoryImage(pr.category));
    }, { passive: true });
    card.addEventListener('click', (e) => {
      if (e.target.closest('.add-to-cart-btn')) return;
      const product = productsData.products.find(p => p.id === card.dataset.id);
      if (product) openModal(product, catLabel(product.category), card);
    });
    // دسترسی با کیبورد: Enter/Space روی خود کارت مودال محصول رو باز می‌کنه
    card.addEventListener('keydown', (e) => {
      if (e.target !== card || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      card.click();
    });
  });

  observeCardNeon();

  // پیش‌لود پس‌زمینه فقط بعد از رفتن اسپلش شروع میشه تا با لود اولیه‌ی صفحه سر پهنای باند دعوا نکنه
  if (document.body.classList.contains('site-loaded')) observeCardsForPreload();
  else window.addEventListener('siteloaded', observeCardsForPreload, { once: true });

  grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const productId = btn.dataset.id;
      addToCart(productId);

      btn.textContent = "افزوده شد ✓";
      btn.classList.add('added');
      setTimeout(() => {
        btn.textContent = "افزودن +";
        btn.classList.remove('added');
      }, 1500);
    });
  });
}

// ============ CART SYSTEM ============
const cartDrawer = document.getElementById('cartDrawer');
const cartOverlay = document.getElementById('cartOverlay');
const cartClose = document.getElementById('cartClose');
const cartItemsEl = document.getElementById('cartItems');
const cartTotalPriceEl = document.getElementById('cartTotalPrice');
const tableSelectBtn = document.getElementById('tableSelectBtn');
const tableSelectValue = document.getElementById('tableSelectValue');
const tableOverlay = document.getElementById('tableOverlay');
const tableModal = document.getElementById('tableModal');
const tableModalClose = document.getElementById('tableModalClose');
const tableGrid = document.getElementById('tableGrid');
const checkoutBtn = document.getElementById('checkoutBtn');
const checkoutMsg = document.getElementById('checkoutMsg');

// المان‌های نوار شناور
const floatingCart = document.getElementById('floatingCart');
const floatCartImg = document.getElementById('floatCartImg');
const floatCartName = document.getElementById('floatCartName');
const floatCartCount = document.getElementById('floatCartCount');
const floatCartTotal = document.getElementById('floatCartTotal');

let cart = [];
const MAX_QTY = 50; // باید با MAX_QTY سمت سرور (src/handlers/orders.js) یکی باشه
const CART_STORAGE_KEY = 'cafe-roshan-cart-v1';

// کلید یکتای هر «تلاش ثبت سفارش»: اگه سرور سفارش رو ثبت کنه ولی جواب به گوشی نرسه و مشتری دوباره بزنه،
// سرور با همین کلید می‌فهمه سفارش تکراریه. با هر تغییر سبد/میز کلید عوض میشه (سفارش جدیده)
let orderAttemptKey = null;
function newOrderKey() {
  return (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// سبد (فقط id و تعداد) تو sessionStorage می‌مونه تا رفرش یا برگشت از تب دیگه سبد رو پاک نکنه؛
// قیمت و اسم هر بار از دیتای تازه‌ی منو خونده میشه
function saveCart() {
  orderAttemptKey = null;
  try {
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
      items: cart.map(i => ({ id: i.id, quantity: i.quantity })),
      table: selectedTable,
    }));
  } catch { /* حالت خصوصی/حافظه پر؛ مهم نیست */ }
}

function restoreCart() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) || 'null');
    for (const s of (Array.isArray(saved?.items) ? saved.items : [])) {
      const p = productsData.products.find(x => x.id === s?.id);
      const q = Math.min(MAX_QTY, Math.floor(Number(s?.quantity)));
      if (!p || !(q > 0)) continue; // محصولی که دیگه تو منو نیست حذف میشه
      cart.push({ ...p, image: p.image || getCategoryImage(p.category), quantity: q });
    }
    const t = String(saved?.table ?? '');
    if (/^\d{1,3}$/.test(t) && Number(t) >= 1 && Number(t) <= TABLE_COUNT) selectedTable = t;
  } catch { /* داده‌ی خراب؛ با سبد خالی شروع می‌کنیم */ }
  renderTableSelect();
  renderCart();
}

function openCart() {
  if (cartDrawer.classList.contains('open')) return;
  rememberFocus('cart');
  cartDrawer.classList.add('open');
  cartDrawer.setAttribute('aria-hidden', 'false');
  cartOverlay.classList.add('open');
  lockScroll();
  history.pushState({ cart: true }, "");
  focusInside(cartClose);
}

function closeCart() {
  if (!cartDrawer.classList.contains('open')) return;
  cartDrawer.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden', 'true');
  cartOverlay.classList.remove('open');
  unlockScroll();
  restoreFocus('cart');
}

function requestCloseCart() {
  if (history.state && history.state.cart) history.back();
  else closeCart();
}

// باز شدن پنل با کلیک (یا Enter/Space) روی نوار شناور
floatingCart.addEventListener('click', openCart);
floatingCart.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCart(); }
});
cartClose.addEventListener('click', requestCloseCart);
cartOverlay.addEventListener('click', requestCloseCart);

function addToCart(productId) {
  const product = productsData.products.find(p => p.id === productId);
  if (!product) return;

  const existingItem = cart.find(item => item.id === productId);
  if (existingItem) {
    existingItem.quantity = Math.min(MAX_QTY, existingItem.quantity + 1);
  } else {
    cart.push({ ...product, image: product.image || getCategoryImage(product.category), quantity: 1 });
  }
  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  saveCart();
  renderCart();
}

function changeQty(productId, delta) {
  const item = cart.find(item => item.id === productId);
  if (item) {
    item.quantity = Math.min(MAX_QTY, item.quantity + delta);
    if (item.quantity <= 0) {
      removeFromCart(productId);
    } else {
      saveCart();
      renderCart();
    }
  }
}

// به‌جای onclick درون‌خطی (که id رو مستقیم تو رشته‌ی جاوااسکریپت می‌ذاشت): یه لیسنر روی کل لیست
cartItemsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'remove') removeFromCart(id);
  else if (btn.dataset.action === 'inc') changeQty(id, 1);
  else if (btn.dataset.action === 'dec') changeQty(id, -1);
});

function renderCart() {
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // مدیریت نوار شناور پایین صفحه
  if (cart.length > 0) {
    const lastItem = cart[cart.length - 1]; // آخرین محصول اضافه شده
    // برای ۴۰ پیکسل همون تامبنیل کوچیک کافیه، نه عکس اصلی
    const thumb = lastItem.image ? productThumbSrc(lastItem.image) : null;
    if (thumb) {
      if (floatCartImg.getAttribute('src') !== thumb) {
        floatCartImg.dataset.failed = '';
        floatCartImg.onerror = () => { floatCartImg.dataset.failed = thumb; floatCartImg.style.display = 'none'; };
        floatCartImg.src = thumb;
      }
      floatCartImg.style.display = floatCartImg.dataset.failed === thumb ? 'none' : 'block';
    } else {
      floatCartImg.removeAttribute('src'); // نه src="null" که یه درخواست الکی می‌زنه
      floatCartImg.style.display = 'none';
    }
    floatCartName.textContent = lastItem.name;
    floatCartCount.textContent = `${totalQty.toLocaleString('fa-IR')} مورد در سبد`;
    floatCartTotal.innerHTML = formatPrice(totalPrice);
    floatingCart.classList.add('active'); // نمایش با انیمیشن
  } else {
    floatingCart.classList.remove('active'); // مخفی کردن وقتی سبد خالیه
  }

  // آپدیت محتوای داخل پنل سبد خرید
  if (cart.length === 0) {
    cartItemsEl.innerHTML = `<p class="cart-empty">سبد خرید شما خالی است.</p>`;
    cartTotalPriceEl.innerHTML = formatPrice(0);
    return;
  }

  cartItemsEl.innerHTML = cart.map((item, i) => `
    <div class="cart-item" style="animation-delay: ${i * 60}ms">
      <div class="cart-item-thumb">
        ${item.image
          ? `<img src="${esc(productThumbSrc(item.image))}" alt="${esc(item.name)}" loading="lazy" decoding="async" onerror="this.parentElement.style.display='none'">`
          : `<span class="cart-item-ph" aria-hidden="true">${esc(item.name.charAt(0))}</span>`}
      </div>
      <div class="cart-item-main">
        <div class="cart-item-line1">
          <span class="cart-item-name">${esc(item.name)}</span>
          <button type="button" class="remove-item" data-action="remove" data-id="${esc(item.id)}" aria-label="حذف ${esc(item.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
            </svg>
          </button>
        </div>
        <div class="cart-item-line2">
          <div class="qty-control">
            <button type="button" class="qty-btn" data-action="dec" data-id="${esc(item.id)}" aria-label="کم کردن">−</button>
            <span class="qty-value mono">${item.quantity.toLocaleString('fa-IR')}</span>
            <button type="button" class="qty-btn" data-action="inc" data-id="${esc(item.id)}" aria-label="اضافه کردن">+</button>
          </div>
          <span class="cart-item-price mono">${formatPrice(item.price * item.quantity)}</span>
        </div>
      </div>
    </div>
  `).join('');

  cartTotalPriceEl.innerHTML = formatPrice(totalPrice);
}

// ============ انتخاب شماره میز (پاپ‌آپ؛ بدون تایپ دستی) ============
const TABLE_COUNT = 20; // تعداد میزهای کافه — فقط همین عدد رو عوض کن
let selectedTable = '';

function renderTableSelect() {
  if (selectedTable) {
    // اگه شماره‌ی عددی بود با ارقام فارسی نشون میدیم؛ اگه مقدار غیرعددی بود، همون رو
    const label = /^\d+$/.test(selectedTable) ? Number(selectedTable).toLocaleString('fa-IR') : selectedTable;
    tableSelectValue.textContent = `میز ${label}`;
    tableSelectBtn.classList.add('has-value');
  } else {
    tableSelectValue.textContent = 'انتخاب شماره میز';
    tableSelectBtn.classList.remove('has-value');
  }
  tableSelectBtn.classList.remove('error');
}

function renderTableGrid() {
  tableGrid.innerHTML = Array.from({ length: TABLE_COUNT }, (_, i) => {
    const n = String(i + 1);
    const on = n === selectedTable ? ' selected' : '';
    return `<button type="button" class="table-option${on}" data-table="${n}" aria-pressed="${n === selectedTable}">${(i + 1).toLocaleString('fa-IR')}</button>`;
  }).join('');
}

function openTableModal() {
  renderTableGrid();
  tableModal.classList.add('open');
  tableOverlay.classList.add('open');
  lockScroll();
  history.pushState({ table: true }, "");
  (tableGrid.querySelector('.selected') || tableModalClose).focus({ preventScroll: true });
}

function closeTableModal() {
  if (!tableModal.classList.contains('open')) return;
  tableModal.classList.remove('open');
  tableOverlay.classList.remove('open');
  unlockScroll();
  tableSelectBtn.focus({ preventScroll: true });
}

// بستن از طریق UI (ضربدر/بک‌گراند/انتخاب)؛ ورودی history رو هم برمی‌گردونه تا دکمه‌ی برگشت گوشی خراب نشه
function handleTableClose() {
  if (history.state && history.state.table) history.back();
  else closeTableModal();
}

tableSelectBtn.addEventListener('click', openTableModal);
tableModalClose.addEventListener('click', handleTableClose);
tableOverlay.addEventListener('click', handleTableClose);
tableGrid.addEventListener('click', (e) => {
  const opt = e.target.closest('.table-option');
  if (!opt) return;
  selectedTable = opt.dataset.table;
  saveCart(); // میز هم ذخیره میشه و کلید ثبت سفارش عوض میشه
  tableGrid.querySelectorAll('.table-option').forEach(b => {
    const on = b === opt;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', String(on));
  });
  renderTableSelect();
  setCheckoutMsg('');
  setTimeout(handleTableClose, 180); // یه مکث کوتاه تا انتخاب دیده بشه، بعد خودش بسته میشه
});

renderTableSelect();

function setCheckoutMsg(text, type) {
  checkoutMsg.textContent = text;
  checkoutMsg.className = 'cart-checkout-msg' + (type ? ` ${type}` : '');
}

async function submitOrder() {
  const table = selectedTable;
  if (!table) {
    setCheckoutMsg('لطفاً شماره میز را انتخاب کنید.', 'error');
    tableSelectBtn.classList.add('error');
    openTableModal(); // مستقیم پاپ‌آپ رو باز می‌کنیم تا کاربر لازم نباشه دنبال فیلد بگرده
    return;
  }
  if (cart.length === 0) return;

  checkoutBtn.disabled = true;
  if (!orderAttemptKey) orderAttemptKey = newOrderKey();
  const originalLabel = checkoutBtn.textContent;
  checkoutBtn.textContent = 'در حال ثبت...';
  setCheckoutMsg('');

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table,
        items: cart.map(item => ({ id: item.id, quantity: item.quantity })),
        idempotencyKey: orderAttemptKey,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'خطایی رخ داد، لطفاً دوباره امتحان کنید.');
    }
    cart = [];
    saveCart(); // سبد خالی ذخیره میشه و کلید تلاش بعدی عوض میشه
    renderCart();
    setCheckoutMsg('سفارش شما ثبت شد. لطفاً منتظر تایید گارسون در میز بمونید.', 'success');
  } catch (err) {
    setCheckoutMsg(err.message || 'خطایی رخ داد، لطفاً دوباره امتحان کنید.', 'error');
  } finally {
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = originalLabel;
  }
}

if (checkoutBtn) checkoutBtn.addEventListener('click', submitOrder);

// ============ BACK TO TOP BUTTON ============
const backToTopBtn = document.getElementById('backToTopBtn');
if (backToTopBtn) {
  backToTopBtn.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ============ تنظیمات سایت: لوگو + عکس بالای سایت (قابل تغییر از ربات تلگرام) ============

// اسپلش رو مرحله‌به‌مرحله نشون می‌ده: اول لوگو/فالبک، بعد عنوان، بعد شعار.
// این تابع فقط وقتی صدا زده میشه که واقعاً بدونیم لوگو هست یا نه — پس هیچ متن
// اشتباهی قبل از تصمیم نهایی فلش نمی‌زنه.
async function revealSplash(hasLogo) {
  const splashLogo = document.getElementById('splashLogoImg');
  const splashFallback = document.getElementById('splashFallback');
  const splashTitle = document.getElementById('splashTitle');
  const splashTagline = document.getElementById('splashTagline');
  const splashRing = document.getElementById('splashRing');

  // لوگوی تصویری به فونت نیازی نداره؛ همون لحظه نشون داده میشه. فقط متن‌ها (عنوان، شعار، فالبک
  // متنی) منتظر فونت می‌مونن تا وسط انیمیشن فونتشون عوض نشه و صفحه نپره.
  if (hasLogo && splashLogo) {
    splashLogo.classList.add('show');
    if (splashRing) splashRing.classList.add('show');
    await waitForFonts(1200);
  } else {
    await waitForFonts(1200);
    if (splashFallback) splashFallback.classList.add('show');
    if (splashRing) splashRing.classList.add('show');
  }
  setTimeout(() => splashTitle && splashTitle.classList.add('show'), 350);
  return new Promise((resolve) => {
    setTimeout(() => {
      if (splashTagline) splashTagline.classList.add('show');
      resolve();
    }, 900);
  });
}

// اگه مسیر واقعی لوگو (اونی که از ربات اومده) هم لود نشد، به فالبک متنی برمی‌گردیم
window.showSplashFallback = function () {
  const splashLogo = document.getElementById('splashLogoImg');
  const splashFallback = document.getElementById('splashFallback');
  if (splashLogo) splashLogo.classList.remove('show');
  if (splashFallback) splashFallback.classList.add('show');
};

// صبر می‌کنه یه <img> واقعاً دانلود/دیکد بشه (نه فقط src ست شده باشه)؛ اگه خطا خورد یا بیشتر
// از سقف زمانی طول کشید، بازم ادامه میده (که یه‌جا برای همیشه گیر نکنیم)
function waitForImage(img, timeoutMs) {
  if (!img || !img.getAttribute('src')) return Promise.resolve();
  if (img.complete) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function loadSiteConfig() {
  let cfg;
  try {
    const boot = getBoot() && getBoot().site;
    if (boot) {
      cfg = boot;
    } else {
      const res = await fetch('data/site.json');
      cfg = await res.json();
    }
  } catch (err) {
    console.error('تنظیمات سایت لود نشد:', err);
    document.querySelector('.hero-cover')?.classList.add('no-cover', 'cover-ready');
    await revealSplash(false);
    return;
  }

  const headerLogo = document.getElementById('headerLogoImg');
  const coverLogo = document.getElementById('heroCoverLogo');
  const coverImg = document.getElementById('heroCoverImg');
  const splashLogo = document.getElementById('splashLogoImg');
  const heroCover = document.querySelector('.hero-cover');

  // شروع دانلود واقعی عکس هیرو همزمان با لوگو (نه بعد از محو شدن اسپلش)؛ چون اسپلش
  // قراره واقعاً منتظرش بمونه، نه اینکه فقط یه انیمیشن نمایشی اجرا کنه و زودتر کنار بره.
  let coverReady;
  if (cfg.cover && coverImg) {
    coverImg.src = cfg.cover;
    coverImg.style.display = '';
    heroCover?.classList.remove('no-cover');
    // اگه HTMLRewriter سمت سرور از قبل src رو ست کرده بود و مرورگر زودتر از اجرای این
    // اسکریپت عکس رو کامل گرفته، رویداد load دیگه فایر نمیشه؛ پس اول خود complete رو چک می‌کنیم
    if (coverImg.complete && coverImg.naturalWidth > 0) {
      heroCover?.classList.add('cover-ready');
    } else {
      coverImg.addEventListener('load', () => heroCover?.classList.add('cover-ready'), { once: true });
      coverImg.addEventListener('error', () => heroCover?.classList.add('cover-ready'), { once: true });
    }
    coverReady = waitForImage(coverImg, 2500);
  } else {
    heroCover?.classList.add('no-cover', 'cover-ready');
    coverReady = Promise.resolve();
  }

  let revealDone;
  if (cfg.logo) {
    const logoFallback = document.getElementById('logoFallback');

    if (headerLogo) {
      headerLogo.src = cfg.logo;
      headerLogo.style.display = '';
    }
    if (coverLogo) {
      coverLogo.src = cfg.logo;
      coverLogo.style.display = '';
    }
    if (splashLogo) splashLogo.src = cfg.logo;
    // چون عکس واقعی (از ربات) داریم، فالبک متنی هدر (اگه قبلاً به‌خاطر 404 نشون داده شده) رو مخفی می‌کنیم
    if (logoFallback) logoFallback.style.display = 'none';
    // قبل از اجرای انیمیشن ورود، صبر می‌کنیم عکس واقعی لوگو کامل دانلود بشه؛ وگرنه
    // فید-این روی یه لوگوی نصفه/خالی اجرا می‌شد و بعد یهو عکس واقعی می‌پرید توش
    await waitForImage(splashLogo, 2000);
    revealDone = revealSplash(true);
  } else {
    // هنوز از ربات لوگویی آپلود نشده؛ چون <img> از اول src نداره، به‌جای منتظر موندن
    // برای یه request ناموفق، مستقیم فالبک متنی رو نشون می‌دیم
    const logoFallback = document.getElementById('logoFallback');
    if (logoFallback) logoFallback.style.display = 'flex';
    if (headerLogo) headerLogo.style.display = 'none';
    if (coverLogo) coverLogo.style.display = 'none';
    revealDone = revealSplash(false);
  }

  // اسپلش («لودینگ») فقط وقتی واقعاً کارش تمومه که هم انیمیشن ورودی لوگو تموم شده باشه
  // هم عکس هیرو واقعاً دانلود شده باشه (یا خطا خورده باشه) — نه یه چیز نمایشی که همیشه با
  // یه زمان ثابت محو بشه صرف‌نظر از اینکه عکس واقعاً رسیده یا نه. سقف‌های زمانی waitForImage
  // (۲ و ۲.۵ ثانیه) + سقف نهایی ۴ ثانیه‌ی کل اسپلش (پایین‌تر) تضمین می‌کنه تو نت کند هم گیر نکنیم.
  await Promise.all([revealDone, coverReady]);
}

// ============ انیمیشن اسکرول: لوگوی وسط عکس با اسکرول به سمت لوگوی هدر «پرواز» می‌کنه ============
(function initHeroScrollIntro() {
  const heroCover = document.querySelector('.hero-cover');
  if (!heroCover) return;

  let ticking = false;

  function update() {
    // وقتی اسکرول قفله (مودال/سبد/منو باز)، window.scrollY صفر میشه؛ بدون این چک هیرو و هدر
    // پشت مودال به حالت بالای صفحه برمی‌گشتن و صفحه «می‌پرید»
    if (document.body.classList.contains('nav-open')) { ticking = false; return; }
    const h = heroCover.offsetHeight || 1;
    // ۷۵٪ از ارتفاع عکس رو اسکرول کنیم، انیمیشن کامل شده
    const progress = Math.min(Math.max(window.scrollY / (h * 0.75), 0), 1);
    document.documentElement.style.setProperty('--intro-progress', progress.toFixed(3));
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  window.addEventListener('resize', update);
  update();

  // انیمیشن درخشش عنوان هیرو بی‌نهایته؛ وقتی هیرو از دید رفت، CSS متوقفش می‌کنه (صرفه‌جویی باتری)
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      document.documentElement.classList.toggle('hero-offscreen', !entry.isIntersecting);
    }).observe(heroCover);
  }
})();

// ============ مخفی/نمایش هدر با جهت اسکرول (فضای بیشتر برای منو تو موبایل) ============
// اسکرول به پایین → هدر می‌ره بالا و محو میشه. اسکرول به بالا → برمی‌گرده.
// نزدیک بالای صفحه همیشه نمایش داده میشه تا حس گم‌شدن نده.
(function initHeaderAutoHide() {
  let lastScrollY = window.scrollY || 0;
  let ticking = false;
  const SHOW_NEAR_TOP = 80; // زیر این مقدار همیشه هدر دیده میشه
  const HIDE_THRESHOLD = 8; // کمتر از این مقدار جابجایی، نادیده گرفته میشه (لرزش جزئی اسکرول)

  // وقتی کاربر وارد بخش منو/محصولات شد، هدر قفل میشه بالا (حتی با اسکرول به بالا برنمی‌گرده)
  // تا فضای بیشتری برای دیدن محصولات داشته باشیم؛ فقط با برگشتن به بالای هیرو دوباره ظاهر میشه.
  function getMenuSectionTop() {
    const menuSection = document.getElementById('menu');
    return menuSection ? menuSection.offsetTop : Infinity;
  }

  function update() {
    if (document.body.classList.contains('nav-open')) { ticking = false; return; }
    const currentY = window.scrollY || 0;
    const delta = currentY - lastScrollY;
    const menuTop = getMenuSectionTop();

    // وسط اسکرول نرم به دسته‌بندی: به‌محض عبور از بالای صفحه هدر مخفی میشه و تا آخر مخفی می‌مونه
    // (وگرنه اول اسکرول، هدر یه لحظه برمی‌گشت و دوباره می‌رفت = پرش)
    if (window.__menuAutoScrolling) {
      if (currentY > SHOW_NEAR_TOP && delta > 0) document.body.classList.add('header-hidden');
      lastScrollY = currentY;
      ticking = false;
      return;
    }

    if (currentY <= SHOW_NEAR_TOP) {
      // بالای صفحه (هیرو) — هدر همیشه دیده میشه
      document.body.classList.remove('header-hidden');
    } else if (delta > HIDE_THRESHOLD) {
      // اسکرول به پایین — مخفی کن
      document.body.classList.add('header-hidden');
    } else if (delta < -HIDE_THRESHOLD && currentY < menuTop) {
      // اسکرول به بالا ولی هنوز بالاتر از بخش منو — نشون بده
      document.body.classList.remove('header-hidden');
    }
    // اگه در بخش منو یا پایین‌تر هستیم و داریم اسکرول می‌کنیم بالا — هدر همون‌جا قفل میمونه

    lastScrollY = currentY;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
})();

// ============ زوم داخل مودال (پینچ / دابل‌تپ / ctrl+چرخ) ============
// transform روی خود عکس‌ها (CSS variable) اعمال میشه؛ کادر ثابت می‌مونه و overflow:hidden برش میده.
// وقتی زوم نیست، touch-action: pan-y یعنی اسکرول عمودی مودال مثل قبل کار می‌کنه؛ وقتی زوم هست،
// touch-action: none میشه تا کشیدن، عکس رو جابه‌جا کنه نه مودال رو.
const ZOOM_MAX = 4;
const zoomState = { s: 1, tx: 0, ty: 0 };

function applyModalZoom() {
  modalImage.style.setProperty('--zs', zoomState.s);
  modalImage.style.setProperty('--zx', zoomState.tx + 'px');
  modalImage.style.setProperty('--zy', zoomState.ty + 'px');
  modalImage.classList.toggle('zoomed', zoomState.s > 1.01);
}

function clampModalZoom() {
  const r = modalImage.getBoundingClientRect();
  zoomState.s = Math.min(ZOOM_MAX, Math.max(1, zoomState.s));
  const mx = (zoomState.s - 1) * r.width / 2;
  const my = (zoomState.s - 1) * r.height / 2;
  zoomState.tx = Math.min(mx, Math.max(-mx, zoomState.tx));
  zoomState.ty = Math.min(my, Math.max(-my, zoomState.ty));
}

function resetModalZoom() {
  zoomState.s = 1; zoomState.tx = 0; zoomState.ty = 0;
  modalImage.classList.remove('animating');
  applyModalZoom();
}

// وقتی کاربر واقعاً زوم کرد، نسخه‌ی با کیفیت (عکس اصلی) رو روی نسخه‌ی متوسط می‌ذاریم؛
// برای کسی که زوم نمی‌کنه هیچ بایت اضافه‌ای دانلود نمیشه.
function ensureHiresForZoom() {
  const src = modalImage.dataset.fullSrc;
  if (!src || modalImage.querySelector('.m-hires')) return;
  const token = modalImgToken;
  const hi = document.createElement('img');
  hi.className = 'm-hires';
  hi.decoding = 'async';
  hi.alt = '';
  hi.onload = () => { if (token === modalImgToken) requestAnimationFrame(() => hi.classList.add('shown')); };
  hi.onerror = () => hi.remove();
  hi.src = src;
  modalImage.append(hi);
}

function initModalZoom() {
  const pointers = new Map();
  let pinch = null;          // { d0, s0, tx0, ty0, fx0, fy0 }
  let pan = null;            // آخرین مختصات تک‌انگشتی
  let tap = null;            // برای تشخیص تپ
  let lastTap = { t: 0, x: 0, y: 0 };

  const rel = (e) => {
    const r = modalImage.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };
  const two = () => { const [a, b] = [...pointers.values()]; return { a, b }; };

  modalImage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { modalImage.setPointerCapture(e.pointerId); } catch { /* پوینتر ساختگی/منقضی؛ مهم نیست */ }
    pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    modalImage.classList.remove('animating');
    if (pointers.size === 2) {
      const { a, b } = two();
      const mid = rel({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
      pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, s0: zoomState.s, tx0: zoomState.tx, ty0: zoomState.ty, fx0: mid.x, fy0: mid.y };
      pan = null; tap = null;
      ensureHiresForZoom();
    } else if (pointers.size === 1) {
      pan = { x: e.clientX, y: e.clientY };
      tap = { t: performance.now(), x: e.clientX, y: e.clientY, moved: false };
    }
  });

  modalImage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    if (pinch && pointers.size >= 2) {
      const { a, b } = two();
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mid = rel({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
      const s = Math.min(ZOOM_MAX, Math.max(1, pinch.s0 * d / pinch.d0));
      zoomState.s = s;
      zoomState.tx = mid.x - s * (pinch.fx0 - pinch.tx0) / pinch.s0;
      zoomState.ty = mid.y - s * (pinch.fy0 - pinch.ty0) / pinch.s0;
      clampModalZoom(); applyModalZoom();
    } else if (pan && zoomState.s > 1.01) {
      zoomState.tx += e.clientX - pan.x;
      zoomState.ty += e.clientY - pan.y;
      pan = { x: e.clientX, y: e.clientY };
      clampModalZoom(); applyModalZoom();
    }
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap.moved = true;
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) { const [p] = [...pointers.values()]; pan = { x: p.clientX, y: p.clientY }; }
    if (pointers.size === 0) {
      pan = null;
      if (e.type === 'pointerup' && tap && !tap.moved && performance.now() - tap.t < 300) {
        const now = performance.now();
        if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
          // دابل‌تپ: اگه زوم هست برگرد، اگه نه ۲.۵ برابر دور همون نقطه
          const f = rel(e);
          modalImage.classList.add('animating');
          if (zoomState.s > 1.05) { zoomState.s = 1; zoomState.tx = 0; zoomState.ty = 0; }
          else { ensureHiresForZoom(); zoomState.s = 2.5; zoomState.tx = -1.5 * f.x; zoomState.ty = -1.5 * f.y; }
          clampModalZoom(); applyModalZoom();
          lastTap = { t: 0, x: 0, y: 0 };
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
      tap = null;
      if (zoomState.s < 1.02) { zoomState.s = 1; zoomState.tx = 0; zoomState.ty = 0; applyModalZoom(); }
    }
  };
  modalImage.addEventListener('pointerup', end);
  modalImage.addEventListener('pointercancel', end);

  // دسکتاپ: ctrl+چرخ (و پینچ تاچ‌پد) یا چرخ وقتی از قبل زوم شده
  modalImage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || zoomState.s > 1.01)) return;
    e.preventDefault();
    const f = rel(e);
    const s0 = zoomState.s;
    const s = Math.min(ZOOM_MAX, Math.max(1, s0 * Math.exp(-e.deltaY * 0.0025)));
    zoomState.s = s;
    zoomState.tx = f.x - s * (f.x - zoomState.tx) / s0;
    zoomState.ty = f.y - s * (f.y - zoomState.ty) / s0;
    if (s > 1.3) ensureHiresForZoom();
    clampModalZoom(); applyModalZoom();
  }, { passive: false });

  modalImage.addEventListener('dragstart', (e) => e.preventDefault());
}
initModalZoom();

// سال فوتر (شمسی)؛ اگه مرورگر Intl فارسی نداشت، همون مقدار ثابت داخل HTML می‌مونه
(function setFooterYear() {
  const el = document.getElementById('footerYear');
  if (!el) return;
  try { el.textContent = new Intl.DateTimeFormat('fa-IR', { year: 'numeric' }).format(new Date()); } catch { /* مقدار پیش‌فرض HTML */ }
})();

// Init
const productsLoadedPromise = loadProducts();
const siteConfigPromise = loadSiteConfig();
renderCart();