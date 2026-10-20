// شنود خطای لود عکس‌ها بدون نیاز به هندلرهای اینلاین در HTML (سازگار با CSP سخت‌گیرانه)
document.addEventListener('error', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG') return;
  if (el.id === 'splashLogoImg') {
    if (typeof window.showSplashFallback === 'function') window.showSplashFallback();
    return;
  }
  if (el.id === 'headerLogoImg') {
    el.style.display = 'none';
    const fb = document.getElementById('logoFallback');
    if (fb) fb.style.display = 'flex';
    return;
  }
  if (el.id === 'heroCoverImg') {
    el.style.display = 'none';
    const cov = el.closest('.hero-cover');
    if (cov) cov.classList.add('no-cover');
    return;
  }
  if (el.id === 'heroCoverLogo') {
    el.style.display = 'none';
    return;
  }
  if (el.hasAttribute('data-fallback')) {
    const text = el.getAttribute('data-fallback');
    const parent = el.parentElement;
    el.remove();
    if (parent) parent.textContent = text;
    return;
  }
  if (el.classList.contains('product-card-img')) {
    const parent = el.parentElement;
    el.remove();
    if (parent) {
      parent.classList.add('img-ready');
      const ph = parent.querySelector('.placeholder');
      if (ph) ph.style.display = 'flex';
    }
    return;
  }
  if (el.classList.contains('cart-item-img')) {
    if (el.parentElement) el.parentElement.style.display = 'none';
  }
}, true);

document.addEventListener('load', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG') return;
  if (el.classList.contains('product-card-img')) {
    if (el.parentElement) el.parentElement.classList.add('img-ready');
  }
}, true);

// ============ SCROLL LOCK (مطمئن، مخصوص موبایل/سافاری) ============
// فقط overflow:hidden رو body کافی نیست؛ تو سافاری موبایل صفحه‌ی پشت مودال بازم rubber-band
// اسکرول می‌کنه و باعث بهم‌ریختگی می‌شه. این تابع body رو واقعاً fixed می‌کنه و بعد از بسته شدن
// دقیقاً به همون نقطه‌ی اسکرول قبلی برمی‌گردونه.
let scrollLockCount = 0;
let savedScrollY = 0;

function lockScroll() {
  if (scrollLockCount === 0) {
    savedScrollY = window.scrollY || window.pageYOffset;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
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
    document.body.style.paddingRight = '';
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
  // عدد انگلیسی + جداکننده‌ی هزارگان + پسوند ظریف «هزار تومان»
  // اگه قیمت مضرب ۱۰۰۰ نبود (مثلاً ۴۵٬۵۰۰) گرد نمی‌کنیم و ۴۵.۵ نشون میدیم تا جمع کل با جمع ردیف‌ها بخونه
  const val = Math.round((Number(price) || 0) / 10) / 100;
  return `<span class="price-amount">${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span> <span class="price-suffix">هزار تومان</span>`;
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
  try {
    sessionStorage.setItem('cafe-roshan-splash-seen', '1');
  } catch {}
  splash.dataset.hidden = 'true';
  splash.classList.add('hide');
  document.body.classList.add('site-loaded');
  window.dispatchEvent(new Event('siteloaded'));
  setTimeout(() => splash.remove(), 250);
}

document.addEventListener('DOMContentLoaded', () => {
  let splashSeen = false;
  try {
    splashSeen = Boolean(sessionStorage.getItem('cafe-roshan-splash-seen'));
  } catch {}

  // اگر قبلاً اسپلش دیده شده، مکث کوتاه (۳۰۰ms) وگرنه ۲.۲ ثانیه برای ماندگاری اسپلش
  const minDisplayPromise = new Promise((resolve) => setTimeout(resolve, splashSeen ? 300 : 2200));

  const allLoaded = Promise.all([productsLoadedPromise, siteConfigPromise])
    .then(() => waitForMenuImages(4000));

  const hardCap = new Promise((resolve) => setTimeout(resolve, 6500));

  // اسپلش وقتی کنار می‌رود که هم لودینگ کامل شده باشد و هم حداقل زمان سپری شده باشد
  const readyPromise = Promise.all([allLoaded, minDisplayPromise]);
  Promise.race([readyPromise, hardCap]).then(hideSplash);
});

// شبکه‌ی ایمنی نهایی: در هر شرایطی بیش از ۶.۵ ثانیه روی صفحه نمی‌ماند
setTimeout(hideSplash, 6500);

// ============ PRODUCT MODAL ============
const modal = document.getElementById('productModal');
const modalClose = document.getElementById('modalClose');
const modalPrevBtn = document.getElementById('modalPrevBtn');
const modalNextBtn = document.getElementById('modalNextBtn');
const modalNavCounter = document.getElementById('modalNavCounter');
const modalContentSlider = document.getElementById('modalContentSlider');
const modalImage = document.getElementById('modalImage');
const modalPlaceholder = document.getElementById('modalPlaceholder');
const modalCat = document.getElementById('modalCat');
const modalName = document.getElementById('modalName');
const modalNote = document.getElementById('modalNote');
const modalPrice = document.getElementById('modalPrice');
const modalAddBtn = document.getElementById('modalAddBtn');
let modalProductId = null;
let modalImgToken = 0;
let isNavigatingModal = false;

function toFaDigits(n) {
  return String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

function catLabel(id) {
  const c = productsData && productsData.categories && productsData.categories.find(c => c.id === id);
  return c ? c.label : id;
}

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
  if (modal.classList.contains('open') && !modal.classList.contains('closing')) return modal.querySelector('.modal-box');
  return null;
}

// علامت‌گذاری پس‌زمینه به عنوان inert / aria-hidden هنگام باز بودن دیالوگ‌ها
function syncDialogInert() {
  const isDialogOpen = !!topDialog();
  const main = document.querySelector('main');
  const header = document.querySelector('header');
  const footer = document.querySelector('footer');
  const floatCart = document.getElementById('floatingCart');
  const bgElements = [main, header, footer, floatCart].filter(Boolean);

  for (const el of bgElements) {
    if (isDialogOpen) {
      if ('inert' in el) el.inert = true;
      el.setAttribute('aria-hidden', 'true');
    } else {
      if ('inert' in el) el.inert = false;
      el.removeAttribute('aria-hidden');
    }
  }
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
  return `images/med/${imgSrc.split('/').pop()}`;
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

let revealObserver = null;
function observeCardReveal() {
  if (revealObserver) revealObserver.disconnect();
  if (!('IntersectionObserver' in window) || prefersReducedMotion()) return;

  const cards = document.querySelectorAll('.product-card');
  revealObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top
                      || a.boundingClientRect.left - b.boundingClientRect.left);

    visible.forEach((e, i) => {
      const card = e.target;
      card.style.setProperty('--reveal-delay', `${Math.min(i, 5) * 70}ms`);
      card.classList.add('in');
      revealObserver.unobserve(card);

      const cleanup = () => {
        card.classList.remove('reveal', 'in');
        card.style.removeProperty('--reveal-delay');
      };
      card.addEventListener('transitionend', (ev) => {
        if (ev.target === card && ev.propertyName === 'transform') cleanup();
      }, { once: true });
      setTimeout(cleanup, 1500);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });

  cards.forEach((c) => {
    if (c.getBoundingClientRect().top < window.innerHeight) return;
    c.classList.add('reveal');
    revealObserver.observe(c);
  });
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

// ============ باز و بسته شدن فوق‌العاده نرم و مدرن محصول ============
let modalCloseTimer = null;

function getVisibleProductList() {
  if (grid) {
    const cards = Array.from(grid.querySelectorAll('.product-card'));
    if (cards.length > 0 && productsData && productsData.products) {
      const list = cards.map(c => productsData.products.find(p => p.id === c.dataset.id)).filter(Boolean);
      if (list.length > 0) return list;
    }
  }
  return (productsData && productsData.products) || [];
}

function updateModalNavState() {
  const list = getVisibleProductList();
  const total = list.length;
  if (total <= 1) {
    if (modalPrevBtn) modalPrevBtn.style.display = 'none';
    if (modalNextBtn) modalNextBtn.style.display = 'none';
    if (modalNavCounter) modalNavCounter.style.display = 'none';
    return;
  }

  if (modalPrevBtn) modalPrevBtn.style.display = '';
  if (modalNextBtn) modalNextBtn.style.display = '';
  if (modalNavCounter) modalNavCounter.style.display = '';

  const idx = list.findIndex(p => p.id === modalProductId);
  if (idx !== -1) {
    // شماره‌گذاری با اعداد انگلیسی طبق درخواست
    if (modalNavCounter) {
      modalNavCounter.textContent = `${idx + 1} / ${total}`;
    }
    // پیش‌بارگذاری هوشمند عکس محصول بعدی و قبلی جهت جابه‌جایی سریع و بدون لگ
    const nextP = list[(idx + 1) % total];
    const prevP = list[(idx - 1 + total) % total];
    if (nextP) queueMediumPreload(nextP.image || getCategoryImage(nextP.category));
    if (prevP) queueMediumPreload(prevP.image || getCategoryImage(prevP.category));
  }
}

function populateModalContent(product, card) {
  modalProductId = product.id;
  resetModalZoom();
  modalImage.dataset.fullSrc = product.image || getCategoryImage(product.category) || '';

  // حفظ عکس‌های قبلی تا زمان اضافه شدن عکس جدید، جهت جلوگیری مطلق از پرش یا خالی شدن کادر
  const oldImgs = Array.from(modalImage.querySelectorAll('img'));
  const imgSrc = product.image || getCategoryImage(product.category);
  const token = ++modalImgToken;
  const alive = () => token === modalImgToken;

  if (imgSrc) {
    const fname = imgSrc.split('/').pop();
    const medUrl = mediumUrlFor(imgSrc);
    const cardEl = card || (grid && grid.querySelector(`.product-card[data-id="${product.id}"]`));
    const cardImg = cardEl && cardEl.querySelector('.product-image img');
    const thumbUrl = (cardImg && (cardImg.currentSrc || cardImg.getAttribute('src'))) || `images/thumb/${fname}`;
    const absFull = new URL(imgSrc, location.href).href;

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
      modalPlaceholder.textContent = product.name.charAt(0);
      modalPlaceholder.style.display = 'flex';
    };

    modalPlaceholder.style.display = 'none';

    // تامبنیل موجود در کش کارت بلافاصله نمایش می‌یابد تا هیچ لحظه‌ای تصویر خالی نماند
    let th = null;
    if (thumbUrl) {
      th = mk('m-thumb shown', thumbUrl);
      modalImage.append(th);
      modalImage.classList.add('img-ready');
    }

    const full = mk('m-full', medUrl);
    const showFull = () => {
      if (!alive()) return;
      modalImage.classList.add('img-ready');
      full.classList.add('shown');
      if (th && th.isConnected) th.remove();
    };

    full.onload = showFull;
    full.onerror = () => {
      if (!alive()) return;
      if (full.src !== absFull) { full.src = absFull; return; }
      if (!modalImage.querySelector('.m-thumb.shown')) showFailed();
    };
    modalImage.append(full);

    // عکس قبلی بدون فریم خالی حذف می‌شود
    oldImgs.forEach(el => el.remove());

    if (full.complete && full.naturalWidth > 0) {
      showFull();
    }
  } else {
    oldImgs.forEach(el => el.remove());
    modalImage.classList.add('img-ready');
    modalPlaceholder.textContent = product.name.charAt(0);
    modalPlaceholder.style.display = 'flex';
  }

  const catLabelText = catLabel(product.category);
  modalCat.textContent = catLabelText;
  modalCat.style.setProperty('--cat-color', catColor(product.category));
  modalName.textContent = product.name;
  if (product.note && product.note.trim()) {
    modalNote.textContent = product.note;
    modalNote.style.display = '';
  } else {
    modalNote.textContent = '';
    modalNote.style.display = 'none';
  }
  if (product.originalPrice && product.originalPrice > product.price) {
    modalPrice.innerHTML = `<span class="price-old mono">${formatPrice(product.originalPrice)}</span><span class="price-new">${formatPrice(product.price)}</span>`;
  } else {
    modalPrice.innerHTML = formatPrice(product.price);
  }

  modalAddBtn.classList.remove('added');
  const initialBtnLabel = document.getElementById('modalAddBtnLabel');
  if (initialBtnLabel) initialBtnLabel.textContent = "افزودن به سبد خرید";

  updateModalNavState();
}

function navigateModalProduct(dir) {
  if (isNavigatingModal) return;
  if (!modal.classList.contains('open') || modal.classList.contains('closing')) return;

  const list = getVisibleProductList();
  if (list.length <= 1) return;

  const curIdx = list.findIndex(p => p.id === modalProductId);
  if (curIdx === -1) return;

  const nextIdx = dir === 'next'
    ? (curIdx + 1) % list.length
    : (curIdx - 1 + list.length) % list.length;

  const targetProduct = list[nextIdx];
  if (!targetProduct) return;

  isNavigatingModal = true;
  const slider = modalContentSlider || modal.querySelector('.modal-box');
  const modalBox = modal.querySelector('.modal-box');

  if (modalBox) modalBox.scrollTop = 0;

  // ۱. تغییر آنی اطلاعات و تصاویر در همان میلی‌ثانیه کلیک (بدون کوچکترین تاخیر)
  populateModalContent(targetProduct);

  // ۲. انیمیشن نرم، زنده و پیوسته اسلاید (بدون پرش، بدون تاخیر و بدون صفحه خالی)
  if (slider) {
    slider.style.transition = '';
    slider.style.transform = '';
    slider.classList.remove('slide-from-right', 'slide-from-left');
    void slider.offsetWidth; // Force Reflow

    const animClass = dir === 'next' ? 'slide-from-right' : 'slide-from-left';
    slider.classList.add(animClass);
  }

  setTimeout(() => {
    if (slider) {
      slider.classList.remove('slide-from-right', 'slide-from-left');
    }
    isNavigatingModal = false;
  }, 230);
}

function openModal(product, catLabelText, card) {
  clearTimeout(modalCloseTimer);
  isNavigatingModal = false;

  if (modalContentSlider) {
    modalContentSlider.className = 'modal-content-slider';
    modalContentSlider.style.transition = '';
    modalContentSlider.style.transform = '';
  }

  const modalBox = modal.querySelector('.modal-box');
  if (modalBox) modalBox.scrollTop = 0;

  populateModalContent(product, card);

  rememberFocus('modal');
  modal.classList.remove('closing');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  syncDialogInert();
  history.pushState({ modal: true }, "");
  focusInside(modalClose);
}

function closeModal() {
  if (!modal.classList.contains('open') || modal.classList.contains('closing')) return;
  resetModalZoom();
  isNavigatingModal = false;
  if (modalContentSlider) {
    modalContentSlider.className = 'modal-content-slider';
    modalContentSlider.style.transition = '';
    modalContentSlider.style.transform = '';
  }
  modalImgToken++; // دانلودهای نیمه‌کاره‌ی عکس مودال دیگه چیزی تغییر نمیدن
  modal.setAttribute('aria-hidden', 'true');
  restoreFocus('modal');

  // بسته شدن کاملاً روان و هماهنگ با تایمینگ CSS (۲۲۰ میلی‌ثانیه)
  clearTimeout(modalCloseTimer);
  modal.classList.add('closing');
  syncDialogInert();
  modalCloseTimer = setTimeout(() => {
    modal.classList.remove('open', 'closing');
    syncDialogInert();
  }, 220);
}

// جلوگیری از اسکرول خوردن ناخواسته پس‌زمینه هنگام تاچ روی فضای اطراف مودال در موبایل
modal.addEventListener('touchmove', (e) => {
  if (modal.classList.contains('open') && !e.target.closest('.modal-box')) {
    e.preventDefault();
  }
}, { passive: false });

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

if (modalPrevBtn) {
  modalPrevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateModalProduct('prev');
  });
}

if (modalNextBtn) {
  modalNextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateModalProduct('next');
  });
}

modalAddBtn.addEventListener('click', () => {
  if (!modalProductId) return;
  addToCart(modalProductId);

  modalAddBtn.classList.add('added');
  const addBtnLabel = document.getElementById('modalAddBtnLabel');
  if (addBtnLabel) {
    addBtnLabel.textContent = "به سبد خرید اضافه شد ✓";
  }

  setTimeout(() => {
    modalAddBtn.classList.remove('added');
    if (addBtnLabel) {
      addBtnLabel.textContent = "افزودن به سبد خرید";
    }
  }, 1500);
});
document.addEventListener('keydown', (e) => {
  // ناوبری با کلیدهای چپ و راست کیبورد هنگام باز بودن مودال محصول
  if (modal.classList.contains('open') && !modal.classList.contains('closing')) {
    if (!tableModal.classList.contains('open') && !cartDrawer.classList.contains('open') && !sortModal.classList.contains('open')) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateModalProduct('next');
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateModalProduct('prev');
        return;
      }
    }
  }

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

// فونت‌ها محلی لود می‌شوند (CSS غیرمسدودکننده). وجه‌های واقعی را صراحتاً
// درخواست می‌کنیم و انیمیشن اسپلش فقط بعد از رسیدنشان (با سقف زمانی) شروع می‌شود.
let fontsPromise = null;
function waitForFonts(timeoutMs) {
  if (fontsPromise) return fontsPromise;
  const css = document.getElementById('fontCss');
  const cssReady = (!css || css.dataset.ready || css.sheet)
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
    ]).catch(() => { });
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
    const grid = document.getElementById('productGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="menu-error-state" style="text-align: center; padding: 40px 20px; grid-column: 1 / -1;">
          <p style="margin-bottom: 16px; color: var(--text-muted, #aaa);">دریافت منوی محصولات با خطا مواجه شد.</p>
          <button id="retryLoadProductsBtn" type="button" class="btn btn-primary" style="padding: 10px 24px; border-radius: 8px; cursor: pointer;">تلاش مجدد</button>
        </div>
      `;
      const btn = document.getElementById('retryLoadProductsBtn');
      if (btn) {
        btn.onclick = () => {
          grid.innerHTML = '';
          loadProducts();
        };
      }
    }
    return;
  }
  const countEl = document.getElementById('menuItemCount');
  if (countEl && productsData?.products?.length) {
    countEl.textContent = `${productsData.products.length.toLocaleString('fa-IR')}+`;
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
  const allBtn = `<button class="cat-card active" data-cat="all" role="tab" aria-selected="true" aria-current="true">
    <span class="cat-card-img cat-card-img--all">✦</span>
    <span class="cat-card-label">همه</span>
  </button>`;

  // فقط دسته‌بندی‌هایی که حداقل یک محصول دارند در تب‌های ناوبری نمایش داده می‌شوند
  const activeCategories = (productsData?.categories || []).filter(c =>
    (productsData?.products || []).some(p => p.category === c.id)
  );

  const catBtns = activeCategories.map(c => {
    const img = getCategoryImage(c.id);
    const imgHtml = img
      ? `<img src="${esc(productThumbSrc(img))}" alt="${esc(c.label)}" decoding="async" data-fallback="${esc(c.label.charAt(0))}">`
      : esc(c.label.charAt(0));
    return `<button class="cat-card" data-cat="${esc(c.id)}" role="tab" aria-selected="false">
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
    b.setAttribute('aria-selected', String(on));
    if (on) {
      b.setAttribute('aria-current', 'true');
      activeBtn = b;
    } else {
      b.removeAttribute('aria-current');
    }
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
  syncDialogInert();
  lockScroll();
  history.pushState({ sort: true }, "");
  focusInside(sortModal.querySelector('.sort-option.active') || sortModalClose);
}

function closeSortModal() {
  if (!sortModal.classList.contains('open')) return;
  sortModal.classList.remove('open');
  sortOverlay.classList.remove('open');
  sortToggle.classList.remove('active');
  syncDialogInert();
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
  if (!src) return src;
  const filename = src.split('/').pop();
  return `images/thumb/${filename}`;
}

// قالب‌بندی و خلاصه‌سازی توضیحات کارت محصول (محدود به ۵ کلمه/اسپیس تا کارت شلوغ نشود؛ در مودال کامل نمایش داده می‌شود)
function formatProductNote(note) {
  if (!note || !note.trim()) return '';
  const trimmed = note.trim();
  const words = trimmed.split(/\s+/);
  const MAX_WORDS = 5;
  const MAX_CHARS = 34;

  if (words.length > MAX_WORDS || trimmed.length > MAX_CHARS) {
    let preview = words.slice(0, MAX_WORDS).join(' ');
    if (preview.length > MAX_CHARS) {
      const cut = preview.slice(0, MAX_CHARS);
      const lastSp = cut.lastIndexOf(' ');
      preview = lastSp > 10 ? cut.slice(0, lastSp) : cut;
    }
    // پاک کردن کاما، ویرگول یا حرف «و» غیرضروری در انتهای متن بریده شده
    preview = preview.replace(/[،,؛;\s]+$/, '').replace(/\s+و$/, '').trim();
    return `<div class="product-note is-truncated" title="${esc(trimmed)}"><span class="note-text">${esc(preview)}</span><span class="note-dots">...</span></div>`;
  }
  return `<div class="product-note"><span class="note-text">${esc(trimmed)}</span></div>`;
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
        ${imgSrc ? `<img src="${esc(thumbSrc)}" alt="${esc(p.name)}" class="product-card-img" loading="${lazy}" decoding="async">` : ''}
        <div class="placeholder" style="display:${imgSrc ? 'none' : 'flex'};">${esc(p.name.charAt(0))}</div>
      </div>
      <div class="product-info">
        <div class="product-header">
          <span class="cat-dot"></span>
          <div class="product-name">${esc(p.name)}</div>
          ${p.originalPrice && p.originalPrice > p.price ? '<span class="discount-badge">تخفیف</span>' : ''}
        </div>
        ${formatProductNote(p.note)}
        <div class="product-footer">
          <div class="price-group">
            ${p.originalPrice && p.originalPrice > p.price ? `<span class="price-old mono">${formatPrice(p.originalPrice)}</span>` : ''}
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

  grid.style.minHeight = 'auto';
  grid.classList.add('loaded');

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
  observeCardReveal();

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

// ============ CART SYSTEM (MODERN BOTTOM SHEET) ============
const cartDrawer = document.getElementById('cartDrawer');
const cartOverlay = document.getElementById('cartOverlay');
const cartClose = document.getElementById('cartClose');
const cartItemsEl = document.getElementById('cartItems');
const cartTotalPriceEl = document.getElementById('cartTotalPrice');
const cartBadgeCount = document.getElementById('cartBadgeCount');
const cartClearBtn = document.getElementById('cartClearBtn');
const cartFooter = document.getElementById('cartFooter');
const cartSheetHandle = document.getElementById('cartSheetHandle');
const tableSelectBtn = document.getElementById('tableSelectBtn');
const tableSelectValue = document.getElementById('tableSelectValue');
const tableOverlay = document.getElementById('tableOverlay');
const tableModal = document.getElementById('tableModal');
const tableModalClose = document.getElementById('tableModalClose');
const tableGrid = document.getElementById('tableGrid');
const checkoutBtn = document.getElementById('checkoutBtn');
const checkoutMsg = document.getElementById('checkoutMsg');
const cartHoneypot = document.getElementById('cartHoneypot');
const cartClosedNote = document.getElementById('cartClosedNote');

// المان‌های نوار شناور
const floatingCart = document.getElementById('floatingCart');
const floatCartImg = document.getElementById('floatCartImg');
const floatCartName = document.getElementById('floatCartName');
const floatCartCount = document.getElementById('floatCartCount');
const floatCartTotal = document.getElementById('floatCartTotal');

let cart = [];
let checkoutBusy = false; // وقتی درخواست ثبت سفارش تو راهه
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
      tableSig: selectedTableSig,
    }));
  } catch { /* حالت خصوصی/حافظه پر؛ مهم نیست */ }
}

function restoreCart() {
  const droppedNames = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(CART_STORAGE_KEY) || 'null');
    for (const s of (Array.isArray(saved?.items) ? saved.items : [])) {
      const p = productsData.products.find(x => x.id === s?.id);
      const q = Math.min(MAX_QTY, Math.floor(Number(s?.quantity)));
      if (!p || !(q > 0)) continue; // محصولی که دیگه تو منو نیست حذف میشه
      if (p.available === 0) {
        droppedNames.push(p.name);
        continue;
      }
      cart.push({ ...p, image: p.image || getCategoryImage(p.category), quantity: q });
    }
    const t = String(saved?.table ?? '');
    if (/^\d{1,3}$/.test(t) && Number(t) >= 1) selectedTable = t;
    const sig = String(saved?.tableSig ?? '');
    if (sig) selectedTableSig = sig;
  } catch { /* داده‌ی خراب؛ با سبد خالی شروع می‌کنیم */ }

  // انتخاب خودکار میز و امضا از روی لینک QR در URL
  try {
    const params = new URLSearchParams(window.location.search);
    const urlTable = params.get('t');
    const urlSig = params.get('sig');
    if (urlTable && /^\d{1,3}$/.test(urlTable) && Number(urlTable) >= 1) {
      selectedTable = urlTable;
      selectedTableSig = urlSig || '';
      saveCart();
    }
  } catch {}

  renderTableSelect();
  renderCart();
  if (droppedNames.length > 0) {
    saveCart();
    const names = droppedNames.map(n => `«${n}»`).join(' و ');
    setCheckoutMsg(`${names} در حال حاضر موجود نیست و از سبد خرید حذف شد.`, 'warning');
  }
}

async function refreshCartProducts() {
  try {
    const res = await fetch('data/products.json');
    if (res.ok) {
      const fresh = await res.json();
      if (fresh?.products) {
        productsData = fresh;
        let changed = false;
        const dropped = [];
        for (let i = cart.length - 1; i >= 0; i--) {
          const item = cart[i];
          const freshP = fresh.products.find((x) => x.id === item.id);
          if (!freshP || freshP.available === 0) {
            dropped.push(item.name);
            cart.splice(i, 1);
            changed = true;
          } else {
            if (item.price !== freshP.price || item.name !== freshP.name || item.originalPrice !== freshP.originalPrice) {
              item.price = freshP.price;
              item.name = freshP.name;
              item.originalPrice = freshP.originalPrice;
              changed = true;
            }
          }
        }
        if (changed) {
          saveCart();
          renderCart();
          if (dropped.length > 0) {
            setCheckoutMsg(`«${dropped.join('» و «')}» دیگر موجود نیست و از سبد حذف شد.`, 'warning');
          }
        }
      }
    }
  } catch {}
}

function openCart() {
  if (cartDrawer.classList.contains('open')) return;
  rememberFocus('cart');
  cartDrawer.classList.add('open');
  cartDrawer.setAttribute('aria-hidden', 'false');
  cartOverlay.classList.add('open');
  syncDialogInert();
  history.pushState({ cart: true }, "");
  focusInside(cartClose);
  refreshCartProducts();
}

function closeCart() {
  if (!cartDrawer.classList.contains('open')) return;
  cartDrawer.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden', 'true');
  cartDrawer.style.transform = '';
  cartOverlay.classList.remove('open');
  syncDialogInert();
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

// دکمه خالی کردن کل سبد
if (cartClearBtn) {
  cartClearBtn.addEventListener('click', () => {
    if (!cart.length) return;
    cart = [];
    saveCart();
    renderCart();
  });
}

// پشتیبانی از اسوایپ به پایین روی دستگیره یا هدر شیت برای بستن سریع روی موبایل
(function initSheetSwipeGesture() {
  let startY = 0;
  let currentDelta = 0;
  let isSwiping = false;

  const target = cartSheetHandle || document.querySelector('.cart-header');
  if (!target) return;

  target.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    currentDelta = 0;
    isSwiping = true;
  }, { passive: true });

  target.addEventListener('touchmove', (e) => {
    if (!isSwiping) return;
    const y = e.touches[0].clientY;
    currentDelta = Math.max(0, y - startY);
    if (currentDelta > 0) {
      cartDrawer.style.transition = 'none';
      cartDrawer.style.transform = `translateY(${currentDelta}px)`;
    }
  }, { passive: true });

  const endSwipe = () => {
    if (!isSwiping) return;
    isSwiping = false;
    cartDrawer.style.transition = '';
    if (currentDelta > 75) {
      requestCloseCart();
    } else {
      cartDrawer.style.transform = '';
    }
    currentDelta = 0;
  };

  target.addEventListener('touchend', endSwipe, { passive: true });
  target.addEventListener('touchcancel', endSwipe, { passive: true });
})();

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

// لیسنر کلی روی آیتم‌های سبد خرید
cartItemsEl.addEventListener('click', (e) => {
  const cta = e.target.closest('#cartEmptyCta');
  if (cta) {
    requestCloseCart();
    const menuSection = document.getElementById('menu');
    if (menuSection) {
      setTimeout(() => {
        menuSection.scrollIntoView({ behavior: 'smooth' });
      }, 200);
    }
    return;
  }

  const receiptClose = e.target.closest('.receipt-close-btn');
  if (receiptClose) {
    requestCloseCart();
    return;
  }

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

  // بروزرسانی بج تعداد اقلام و دکمه خالی‌کردن
  if (cartBadgeCount) {
    cartBadgeCount.textContent = totalQty.toLocaleString('fa-IR');
    cartBadgeCount.style.display = totalQty > 0 ? 'inline-flex' : 'none';
  }
  if (cartClearBtn) {
    cartClearBtn.style.display = totalQty > 0 ? 'inline-flex' : 'none';
  }

  // مدیریت نوار شناور پایین صفحه
  if (cart.length > 0) {
    const lastItem = cart[cart.length - 1]; // آخرین محصول اضافه شده
    const thumb = lastItem.image ? productThumbSrc(lastItem.image) : null;
    if (thumb) {
      if (floatCartImg.getAttribute('src') !== thumb) {
        floatCartImg.dataset.failed = '';
        floatCartImg.onerror = () => { floatCartImg.dataset.failed = thumb; floatCartImg.style.display = 'none'; };
        floatCartImg.src = thumb;
      }
      floatCartImg.style.display = floatCartImg.dataset.failed === thumb ? 'none' : 'block';
    } else {
      floatCartImg.removeAttribute('src');
      floatCartImg.style.display = 'none';
    }
    floatCartName.textContent = lastItem.name;
    floatCartCount.textContent = `${totalQty.toLocaleString('fa-IR')} مورد در سبد`;
    floatCartTotal.innerHTML = formatPrice(totalPrice);
    floatingCart.classList.add('active');
  } else {
    floatingCart.classList.remove('active');
  }

  // آپدیت محتوای داخل پنل سبد خرید
  if (cart.length === 0) {
    cartItemsEl.innerHTML = `
      <div class="cart-empty-state">
        <div class="cart-empty-icon-wrap" aria-hidden="true">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
            <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
            <line x1="6" y1="1" x2="6" y2="4"></line>
            <line x1="10" y1="1" x2="10" y2="4"></line>
            <line x1="14" y1="1" x2="14" y2="4"></line>
          </svg>
        </div>
        <h4>سبد خرید شما خالی است</h4>
        <p>یک فنجان قهوه یا نوشیدنی دلخواه از منو انتخاب کنید</p>
        <button type="button" class="cart-empty-cta" id="cartEmptyCta">مشاهده منوی کافه</button>
      </div>
    `;
    cartTotalPriceEl.innerHTML = formatPrice(0);
    if (cartFooter) cartFooter.style.display = 'none';
    return;
  }

  if (cartFooter) cartFooter.style.display = 'block';

  cartItemsEl.innerHTML = cart.map((item, i) => `
    <div class="cart-item" style="animation-delay: ${i * 45}ms">
      <div class="cart-item-thumb">
        ${item.image
      ? `<img src="${esc(productThumbSrc(item.image))}" alt="${esc(item.name)}" class="cart-item-img" loading="lazy" decoding="async">`
      : `<span class="cart-item-ph" aria-hidden="true">${esc(item.name.charAt(0))}</span>`}
      </div>
      <div class="cart-item-info">
        <div class="cart-item-header">
          <span class="cart-item-name">${esc(item.name)}</span>
          <button type="button" class="cart-item-remove" data-action="remove" data-id="${esc(item.id)}" aria-label="حذف ${esc(item.name)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="cart-item-meta">
          <span>هر عدد: </span>
          <span class="mono">${formatPrice(item.price)}</span>
        </div>
        <div class="cart-item-bottom">
          <div class="qty-control">
            <button type="button" class="qty-btn" data-action="dec" data-id="${esc(item.id)}" aria-label="کم کردن">−</button>
            <span class="qty-value mono">${item.quantity.toLocaleString('fa-IR')}</span>
            <button type="button" class="qty-btn" data-action="inc" data-id="${esc(item.id)}" aria-label="اضافه کردن">+</button>
          </div>
          <span class="cart-item-total mono">${formatPrice(item.price * item.quantity)}</span>
        </div>
      </div>
    </div>
  `).join('');

  cartTotalPriceEl.innerHTML = formatPrice(totalPrice);
}

// ============ انتخاب شماره میز (پاپ‌آپ؛ بدون تایپ دستی) ============
let tableCount = Number(getBoot()?.site?.tableCount) || 20; // تعداد میزهای کافه (پیش‌فرض؛ از تنظیمات سایت خوانده می‌شود)
let selectedTable = '';
let selectedTableSig = '';

try {
  const urlParams = new URLSearchParams(window.location.search);
  const urlT = urlParams.get('t');
  const urlSig = urlParams.get('sig');
  if (urlT && /^\d{1,3}$/.test(urlT) && Number(urlT) >= 1) {
    selectedTable = urlT;
    selectedTableSig = urlSig || '';
  }
} catch {}

function renderTableSelect() {
  const signingEnabled = Boolean(getBoot()?.site?.signingEnabled);
  let qrMsgEl = document.getElementById('tableQrRequiredMsg');

  if (signingEnabled && !selectedTableSig) {
    tableSelectBtn.style.display = 'none';
    if (!qrMsgEl) {
      qrMsgEl = document.createElement('div');
      qrMsgEl.id = 'tableQrRequiredMsg';
      qrMsgEl.className = 'table-qr-required-msg';
      qrMsgEl.textContent = 'کد QR روی میز را اسکن کنید';
      qrMsgEl.style.padding = '10px 14px';
      qrMsgEl.style.borderRadius = '10px';
      qrMsgEl.style.background = 'rgba(212, 175, 55, 0.12)';
      qrMsgEl.style.color = 'var(--color-gold, #d4af37)';
      qrMsgEl.style.fontWeight = '600';
      qrMsgEl.style.fontSize = '0.92rem';
      qrMsgEl.style.textAlign = 'center';
      qrMsgEl.style.marginTop = '6px';
      qrMsgEl.style.border = '1px dashed rgba(212, 175, 55, 0.35)';
      tableSelectBtn.parentNode.appendChild(qrMsgEl);
    } else {
      qrMsgEl.style.display = 'block';
    }
    return;
  }

  tableSelectBtn.style.display = '';
  if (qrMsgEl) qrMsgEl.style.display = 'none';

  if (selectedTable) {
    const label = /^\d+$/.test(selectedTable) ? Number(selectedTable).toLocaleString('fa-IR') : selectedTable;
    tableSelectValue.textContent = `میز شماره ${label}`;
    tableSelectBtn.classList.add('has-value');
  } else {
    tableSelectValue.textContent = 'انتخاب شماره میز';
    tableSelectBtn.classList.remove('has-value');
  }
  tableSelectBtn.classList.remove('error');
}

function renderTableGrid() {
  tableGrid.innerHTML = Array.from({ length: tableCount }, (_, i) => {
    const n = String(i + 1);
    const on = n === selectedTable ? ' selected' : '';
    return `<button type="button" class="table-option${on}" data-table="${n}" aria-pressed="${n === selectedTable}">${(i + 1).toLocaleString('fa-IR')}</button>`;
  }).join('');
}

function openTableModal() {
  const signingEnabled = Boolean(getBoot()?.site?.signingEnabled);
  if (signingEnabled && !selectedTableSig) return;
  renderTableGrid();
  tableModal.classList.add('open');
  tableOverlay.classList.add('open');
  syncDialogInert();
  history.pushState({ table: true }, "");
  (tableGrid.querySelector('.selected') || tableModalClose).focus({ preventScroll: true });
}

function closeTableModal() {
  if (!tableModal.classList.contains('open')) return;
  tableModal.classList.remove('open');
  tableOverlay.classList.remove('open');
  syncDialogInert();
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
  selectedTableSig = ''; // انتخاب دستی میز، امضای قبلی QR را باطل می‌کند
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
  // کافه بسته‌ست؟ (سرور هم چک می‌کنه؛ اینجا فقط برای اینکه مشتری بیخود منتظر نمونه)
  const openState = getOpenState();
  if (openState && !openState.open) { applyOrderingState(); return; }

  const signingEnabled = Boolean(getBoot()?.site?.signingEnabled);
  if (signingEnabled && !selectedTableSig) {
    setCheckoutMsg('کد QR روی میز را اسکن کنید.', 'error');
    return;
  }

  const table = selectedTable;
  if (!table) {
    setCheckoutMsg('لطفاً شماره میز را انتخاب کنید.', 'error');
    tableSelectBtn.classList.add('error');
    openTableModal(); // مستقیم پاپ‌آپ رو باز می‌کنیم تا کاربر لازم نباشه دنبال فیلد بگرده
    return;
  }
  if (cart.length === 0) return;

  checkoutBusy = true;
  checkoutBtn.disabled = true;
  if (!orderAttemptKey) orderAttemptKey = newOrderKey();
  const originalLabel = checkoutBtn.innerHTML;
  checkoutBtn.innerHTML = '<span>در حال ثبت...</span>';
  setCheckoutMsg('');

  try {
    const hpVal = cartHoneypot ? cartHoneypot.value.trim() : '';
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table,
        ...(selectedTableSig ? { tableSig: selectedTableSig } : {}),
        items: cart.map(item => ({ id: item.id, quantity: item.quantity })),
        requestId: orderAttemptKey,
        idempotencyKey: orderAttemptKey,
        ...(hpVal ? { hp_website: hpVal } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'خطایی رخ داد، لطفاً دوباره امتحان کنید.');
    }

    const tableLabel = /^\d+$/.test(table) ? Number(table).toLocaleString('fa-IR') : table;
    cart = [];
    saveCart();
    floatingCart.classList.remove('active');
    if (cartBadgeCount) cartBadgeCount.style.display = 'none';
    if (cartClearBtn) cartClearBtn.style.display = 'none';
    if (cartFooter) cartFooter.style.display = 'none';

    // نمایش رسید لوکس ثبت سفارش در شیت
    cartItemsEl.innerHTML = `
      <div class="order-success-receipt">
        <div class="receipt-icon-wrap" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h3>سفارش شما با موفقیت ثبت شد</h3>
        <div class="receipt-table-badge">میز شماره ${tableLabel}</div>
        ${data.total ? `<div class="receipt-total-badge" style="margin: 8px 0; font-size: 1.05rem; color: var(--color-gold, #d4af37); font-weight: 600;">مبلغ کل: ${formatPrice(data.total)}</div>` : ''}
        <div id="receipt-status-badge" class="receipt-status-badge pending">در انتظار تایید</div>
        <p class="receipt-hint" id="receipt-status-hint">سفارش شما برای باریستای کافه ارسال شد و در انتظار تایید است. نیازی به مراجعه به صندوق نیست.</p>
        <button type="button" class="receipt-close-btn">متوجه شدم ✓</button>
      </div>
    `;

    if (data.publicId) {
      startOrderStatusPolling(data.publicId);
    }
  } catch (err) {
    const msg = err.message || 'خطایی رخ داد، لطفاً دوباره امتحان کنید.';
    const match = msg.match(/«([^»]+)»\s*در حال حاضر موجود نیست/);
    if (match) {
      const unavailName = match[1];
      const idx = cart.findIndex(it => it.name === unavailName);
      if (idx !== -1) {
        cart.splice(idx, 1);
        saveCart();
        renderCart();
      }
      setCheckoutMsg(`«${unavailName}» ناموجود است و از سبد خرید حذف شد.`, 'error');
    } else {
      setCheckoutMsg(msg, 'error');
    }
  } finally {
    checkoutBusy = false;
    applyOrderingState(); // دکمه فقط وقتی فعال میشه که کافه باز باشه
    checkoutBtn.innerHTML = originalLabel;
  }
}

if (checkoutBtn) checkoutBtn.addEventListener('click', submitOrder);

let orderStatusPollTimer = null;
function startOrderStatusPolling(publicId) {
  if (orderStatusPollTimer) {
    clearTimeout(orderStatusPollTimer);
    orderStatusPollTimer = null;
  }
  if (!publicId) return;

  const maxDuration = 15 * 60 * 1000; // سقف ۱۵ دقیقه
  const startTime = Date.now();
  let pollInterval = 6000;

  async function poll() {
    if (!document.getElementById('receipt-status-badge')) return;
    if (Date.now() - startTime > maxDuration) return;
    if (document.visibilityState !== 'visible') {
      orderStatusPollTimer = setTimeout(poll, pollInterval);
      return;
    }
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(publicId)}/status`);
      if (res.status === 429) {
        pollInterval = Math.min(30000, pollInterval * 2);
      } else if (res.ok) {
        pollInterval = 6000;
        const d = await res.json();
        const badge = document.getElementById('receipt-status-badge');
        const hint = document.getElementById('receipt-status-hint');
        if (d.status === 'confirmed') {
          if (badge) {
            badge.className = 'receipt-status-badge confirmed';
            badge.textContent = 'تایید شد، در حال آماده‌سازی ✓';
          }
          if (hint) {
            hint.textContent = 'سفارش شما تایید شد و در حال آماده‌سازی است. نوش جان!';
          }
          return;
        } else if (d.status === 'rejected') {
          if (badge) {
            badge.className = 'receipt-status-badge rejected';
            badge.textContent = 'متأسفانه رد شد ✕';
          }
          if (hint) {
            hint.textContent = 'متأسفانه رد شد، لطفاً با پرسنل صحبت کنید.';
          }
          return;
        }
      }
    } catch {}
    orderStatusPollTimer = setTimeout(poll, pollInterval);
  }

  orderStatusPollTimer = setTimeout(poll, 5000);
}

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
    if (selectedTable && Number(selectedTable) > tableCount) {
      selectedTable = '';
      renderTableSelect();
    }
    document.querySelector('.hero-cover')?.classList.add('no-cover', 'cover-ready');
    await revealSplash(false);
    return;
  }

  if (cfg.signingEnabled !== undefined) {
    if (!bootCache) bootCache = {};
    if (!bootCache.site) bootCache.site = {};
    bootCache.site.signingEnabled = cfg.signingEnabled;
  }
  if (cfg.tableCount) {
    tableCount = Number(cfg.tableCount) || 20;
  }
  if (selectedTable && Number(selectedTable) > tableCount) {
    selectedTable = '';
  }
  renderTableSelect();
  renderTableGrid();

  if (cfg.hours) {
    siteHours = cfg.hours;
    renderHoursSection();
    refreshOpenState();
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
    coverReady = waitForImage(coverImg, 4500);
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
  // (۲ ثانیه برای لوگو و ۴.۵ ثانیه برای کاور) + سقف نهایی ۶.۵ ثانیه‌ی کل اسپلش تضمین می‌کنه تو نت کند هم گیر نکنیم.
  await Promise.all([revealDone, coverReady]);
}

// ============ ساعت کاری، وضعیت زنده کافه و قفل ثبت سفارش ============
// ساعت‌ها دیگه اینجا هاردکد نیست؛ سرور تو تنظیمات سایت می‌فرسته (cfg.hours ← OPENING_HOURS تو src/config.js)
// و نوار وضعیت هیرو، لیست ساعات کاری و دکمه‌ی ثبت سفارش همه از همون استفاده می‌کنن.
let siteHours = (getBoot() && getBoot().site && getBoot().site.hours) || null;

// اختلاف ساعت گوشی با ساعت سرور (سرور موقع ساخت صفحه ساعتش رو تو bootData می‌ذاره)؛
// تا ساعت اشتباه گوشی مشتری، دکمه‌ی سفارش رو بیخود قفل نکنه
const clockSkewMs = (() => {
  const serverNow = Number(getBoot() && getBoot().now);
  return Number.isFinite(serverNow) && serverNow > 0 ? serverNow - Date.now() : 0;
})();

const hhmmToMin = (hhmm) => {
  const [h, m = 0] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

function getTehranTimeParts(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date);

    let weekday = '';
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
      if (p.type === 'weekday') weekday = p.value;
      else if (p.type === 'hour') hour = Number(p.value) % 24;
      else if (p.type === 'minute') minute = Number(p.value);
    }
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[weekday] ?? date.getDay();
    return { day, hour, minute };
  } catch {
    return { day: date.getDay(), hour: date.getHours(), minute: date.getMinutes() };
  }
}

// توجه: منطق ساعت کاری در سرور (src/lib/hours.js) و کلاینت (public/js/script.js) به دلیل
// عدم امکان ایمپورت مستقیم ماژول ES سرور در کلاینت، جداگانه پیاده‌سازی شده‌اند و هر دو باید با هم هماهنگ بمانند.
// {open, slot, next} یا null اگه هنوز ساعتی نداریم. next = اولین باز شدن بعدی (امروز یا فردا)
function getOpenState(date = new Date(Date.now() + clockSkewMs)) {
  if (!siteHours || !Array.isArray(siteHours.schedule)) return null;
  const { day, hour, minute } = getTehranTimeParts(date);
  const cur = hour * 60 + minute;
  const slot = siteHours.schedule.find(s => s.days.includes(day));
  if (!slot) return { open: false, slot: null, next: null };

  const open = cur >= hhmmToMin(slot.open) && cur < hhmmToMin(slot.close);
  let next = null;
  if (!open) {
    if (cur < hhmmToMin(slot.open)) {
      next = { when: 'امروز', time: slot.open };
    } else {
      const tomorrow = siteHours.schedule.find(s => s.days.includes((day + 1) % 7));
      if (tomorrow) next = { when: 'فردا', time: tomorrow.open };
    }
  }
  return { open, slot, next };
}

function renderHoursSection() {
  if (!siteHours || !Array.isArray(siteHours.schedule)) return;
  const list = document.getElementById('hoursList');
  if (list) {
    list.innerHTML = siteHours.schedule.map(s =>
      `<li><span>${esc(s.label)}</span><span class="mono">${toFaDigits(s.open)} – ${toFaDigits(s.close)}</span></li>`
    ).join('');
  }
}

function updateHeroLiveStatus() {
  const badge = document.getElementById('heroLiveBadge');
  const text = document.getElementById('heroLiveStatusText');
  if (!badge || !text) return;
  const st = getOpenState();
  if (!st || !st.slot) { badge.style.display = 'none'; return; }
  badge.style.display = '';
  if (st.open) {
    badge.classList.remove('is-closed');
    text.textContent = `هم‌اکنون باز است • سرویس‌دهی تا ${toFaDigits(st.slot.close)}`;
  } else {
    badge.classList.add('is-closed');
    text.textContent = st.next
      ? `هم‌اکنون بسته است • ${st.next.when} از ${toFaDigits(st.next.time)}`
      : 'هم‌اکنون بسته است';
  }
}

function updateTodayHours() {
  const el = document.getElementById('hoursToday');
  if (!el) return;
  const st = getOpenState();
  if (!st || !st.slot) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.textContent = `امروز ${toFaDigits(st.slot.open)} تا ${toFaDigits(st.slot.close)}`;
}

// وقتی کافه بسته‌ست دکمه‌ی ثبت سفارش غیرفعال میشه و دلیلش بالای دکمه نشون داده میشه
// (سبد خرید همچنان قابل پر کردنه؛ فقط ثبت نهایی قفله). متن با پیام سرور یکیه.
function applyOrderingState() {
  const st = getOpenState();
  const closed = !!st && !st.open;
  if (checkoutBtn) checkoutBtn.disabled = closed || checkoutBusy;
  if (!cartClosedNote) return;
  if (closed) {
    const nextTxt = st.next ? ` ${st.next.when} از ساعت ${toFaDigits(st.next.time)} سفارش می‌گیریم.` : '';
    cartClosedNote.textContent = `کافه الان بسته است و سفارش ثبت نمی‌شود.${nextTxt}`;
    cartClosedNote.hidden = false;
  } else {
    cartClosedNote.hidden = true;
  }
}

function refreshOpenState() {
  updateHeroLiveStatus();
  updateTodayHours();
  applyOrderingState();
}

// دکمه‌ی «مشاهده منو» توی هیرو: اسکرول تا جایی که نوار دسته‌بندی‌ها بچسبه بالای صفحه
// و محصولات درست زیرش باشن. نوار دسته‌ها sticky هست و موقع اسکرول جاش عوض میشه، پس جای
// «طبیعی» (بدون چسبیدن) اون رو از روی بخش قبلی‌ش (.menu-section-head) حساب می‌کنیم.
function initHeroScrollButton() {
  const btn = document.getElementById('heroScrollBtn');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const head = document.querySelector('.menu-section-head');
    const bar = document.querySelector('.menu-controls');
    if (!head || !bar) return;
    const gap = parseFloat(getComputedStyle(head).marginBottom) || 0;
    const barNaturalTop = head.getBoundingClientRect().bottom + window.scrollY + gap;
    // hideHeaderAtEnd: هدر مخفی میشه و نوار دقیقاً به top:0 می‌چسبه (مثل کلیک روی دسته‌ها)
    smoothScrollToY(barNaturalTop, { hideHeaderAtEnd: true });
  });
}

// ============ انیمیشن اسکرول: لوگوی وسط عکس با اسکرول به سمت لوگوی هدر «پرواز» می‌کنه ============
(function initHeroScrollIntro() {
  const heroCover = document.querySelector('.hero-cover');
  renderHoursSection();
  refreshOpenState();
  setInterval(refreshOpenState, 60000);
  initHeroScrollButton();
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

let modalAnimTimer = null;
let modalWheelTimer = null;

function snapBackModalZoom() {
  clearTimeout(modalAnimTimer);
  if (zoomState.s > 1.005 || Math.abs(zoomState.tx) > 0.5 || Math.abs(zoomState.ty) > 0.5) {
    modalImage.classList.add('animating');
    zoomState.s = 1;
    zoomState.tx = 0;
    zoomState.ty = 0;
    applyModalZoom();
    modalAnimTimer = setTimeout(() => {
      modalImage.classList.remove('animating');
    }, 320);
  }
}

function resetModalZoom() {
  clearTimeout(modalAnimTimer);
  clearTimeout(modalWheelTimer);
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
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeStartTime = 0;
  let swipeIsHorizontal = null;
  let swipeActive = false;

  const rel = (e) => {
    const r = modalImage.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };
  const two = () => { const [a, b] = [...pointers.values()]; return { a, b }; };

  modalImage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { modalImage.setPointerCapture(e.pointerId); } catch { /* پوینتر ساختگی/منقضی؛ مهم نیست */ }
    pointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    clearTimeout(modalAnimTimer);
    modalImage.classList.remove('animating');

    if (pointers.size === 2) {
      const { a, b } = two();
      const mid = rel({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
      pinch = {
        d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        s0: zoomState.s,
        tx0: zoomState.tx,
        ty0: zoomState.ty,
        fx0: mid.x,
        fy0: mid.y
      };
      pan = null;
      swipeActive = false;
      swipeIsHorizontal = false;
      ensureHiresForZoom();
    } else if (pointers.size === 1) {
      pan = { x: e.clientX, y: e.clientY };
      swipeStartX = e.clientX;
      swipeStartY = e.clientY;
      swipeStartTime = Date.now();
      swipeIsHorizontal = null;
      swipeActive = (zoomState.s <= 1.01);
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
      clampModalZoom();
      applyModalZoom();
    } else if (pan && zoomState.s > 1.01 && !pinch) {
      zoomState.tx += e.clientX - pan.x;
      zoomState.ty += e.clientY - pan.y;
      pan = { x: e.clientX, y: e.clientY };
      clampModalZoom();
      applyModalZoom();
    } else if (swipeActive && pointers.size === 1 && zoomState.s <= 1.01 && !pinch) {
      const dx = e.clientX - swipeStartX;
      const dy = e.clientY - swipeStartY;
      if (swipeIsHorizontal === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          if (Math.abs(dx) > Math.abs(dy) * 1.1) {
            swipeIsHorizontal = true;
          } else {
            swipeIsHorizontal = false;
            swipeActive = false;
          }
        }
      }
      if (swipeIsHorizontal && modalContentSlider && !isNavigatingModal) {
        modalContentSlider.style.transition = 'none';
        modalContentSlider.style.transform = `translateX(${dx * 0.45}px)`;
      }
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    try { modalImage.releasePointerCapture(e.pointerId); } catch { /* هندلرهای پیش‌فرض */ }
    pointers.delete(e.pointerId);

    if (swipeIsHorizontal && swipeActive) {
      const dx = e.clientX - swipeStartX;
      const dt = Date.now() - swipeStartTime;
      const absX = Math.abs(dx);
      const velocity = absX / Math.max(1, dt);
      const slider = modalContentSlider;

      if (slider) {
        slider.style.transition = '';
        slider.style.transform = '';
      }

      if (absX > 45 || (absX > 25 && velocity > 0.3)) {
        if (dx < 0) {
          navigateModalProduct('next');
        } else {
          navigateModalProduct('prev');
        }
      } else if (slider) {
        slider.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        slider.style.transform = 'translateX(0)';
        setTimeout(() => {
          if (slider) {
            slider.style.transition = '';
            slider.style.transform = '';
          }
        }, 220);
      }
      swipeActive = false;
      swipeIsHorizontal = null;
    }

    if (pointers.size < 2) {
      pinch = null;
    }
    if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      pan = { x: p.clientX, y: p.clientY };
    }
    // وقتی دست کاربر از روی عکس برداشته شد، بلافاصله زوم اوت نرم انجام می‌شود
    if (pointers.size === 0) {
      pan = null;
      snapBackModalZoom();
    }
  };

  modalImage.addEventListener('pointerup', end);
  modalImage.addEventListener('pointercancel', end);

  // دسکتاپ: وقتی نشانگر ماوس از کادر خارج شد به حالت عادی برگردد
  modalImage.addEventListener('mouseleave', () => {
    if (pointers.size === 0) {
      snapBackModalZoom();
    }
  });

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
    clampModalZoom();
    applyModalZoom();

    // پس از پایان اسکرول با چرخ ماوس، عکس نرم به حالت بدون زوم برمی‌گردد
    clearTimeout(modalWheelTimer);
    modalWheelTimer = setTimeout(() => {
      snapBackModalZoom();
    }, 850);
  }, { passive: false });

  modalImage.addEventListener('dragstart', (e) => e.preventDefault());
}

// ============ سوایپ لمسی در بدنه و کادر مودال (مخصوص موبایل) ============
function initModalSwipe() {
  const modalBox = modal ? modal.querySelector('.modal-box') : null;
  if (!modalBox) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let touchDeltaX = 0;
  let touchDeltaY = 0;
  let isHorizontalSwipe = null;
  let isSwiping = false;

  modalBox.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) {
      isSwiping = false;
      return;
    }
    // اگر لمس روی عکس است، کنترل آن توسط پوینترهای عکس انجام می‌شود
    if (e.target.closest('.modal-image')) return;
    if (e.target.closest('.modal-add-btn, .modal-nav-btn, .modal-close')) return;

    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartTime = Date.now();
    touchDeltaX = 0;
    touchDeltaY = 0;
    isHorizontalSwipe = null;
    isSwiping = true;
  }, { passive: true });

  modalBox.addEventListener('touchmove', (e) => {
    if (!isSwiping || e.touches.length !== 1) return;

    const t = e.touches[0];
    touchDeltaX = t.clientX - touchStartX;
    touchDeltaY = t.clientY - touchStartY;

    if (isHorizontalSwipe === null) {
      const absX = Math.abs(touchDeltaX);
      const absY = Math.abs(touchDeltaY);
      if (absX > 8 || absY > 8) {
        if (absX > absY * 1.1) {
          isHorizontalSwipe = true;
        } else {
          isHorizontalSwipe = false;
          isSwiping = false;
          return;
        }
      }
    }

    if (isHorizontalSwipe) {
      if (e.cancelable) e.preventDefault();
      const slider = modalContentSlider;
      if (slider && !isNavigatingModal) {
        slider.style.transition = 'none';
        slider.style.transform = `translateX(${touchDeltaX * 0.45}px)`;
      }
    }
  }, { passive: false });

  const endSwipe = () => {
    if (!isSwiping) return;
    isSwiping = false;

    if (!isHorizontalSwipe) {
      isHorizontalSwipe = null;
      return;
    }

    const slider = modalContentSlider;
    const elapsed = Date.now() - touchStartTime;
    const absX = Math.abs(touchDeltaX);
    const velocity = absX / Math.max(1, elapsed);

    if (absX > 45 || (absX > 25 && velocity > 0.3)) {
      if (slider) {
        slider.style.transition = '';
        slider.style.transform = '';
      }
      if (touchDeltaX < 0) {
        navigateModalProduct('next');
      } else {
        navigateModalProduct('prev');
      }
    } else {
      if (slider) {
        slider.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        slider.style.transform = 'translateX(0)';
        setTimeout(() => {
          if (slider) {
            slider.style.transition = '';
            slider.style.transform = '';
          }
        }, 220);
      }
    }
    isHorizontalSwipe = null;
  };

  modalBox.addEventListener('touchend', endSwipe, { passive: true });
  modalBox.addEventListener('touchcancel', endSwipe, { passive: true });
}

initModalZoom();
initModalSwipe();

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