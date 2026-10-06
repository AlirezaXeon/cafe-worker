// ============ SCROLL LOCK (مطمئن، مخصوص موبایل/سافاری) ============
// فقط overflow:hidden رو body کافی نیست؛ تو سافاری موبایل صفحه‌ی پشت مودال بازم rubber-band
// اسکرول می‌کنه و باعث بهم‌ریختگی می‌شه. این تابع body رو واقعاً fixed می‌کنه و بعد از بسته شدن
// دقیقاً به همون نقطه‌ی اسکرول قبلی برمی‌گردونه.
let scrollLockCount = 0;
let savedScrollY = 0;

function lockScroll() {
  if (scrollLockCount === 0) {
    savedScrollY = window.scrollY || window.pageYOffset;
    // scroll-behavior:smooth رو خاموش می‌کنیم تا fixed کردن body پرش ایجاد نکنه
    document.documentElement.style.scrollBehavior = 'auto';
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
    // restore رو یه فریم عقب میندازیم تا مرورگر اول scroll آنی رو commit کنه
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = prevBehavior;
    });
  }
}

// تم روشن حذف شد (باگ داشت) — سایت همیشه تیره‌ست، نیازی به تنظیم data-theme نیست

// ============ MOBILE NAV ============
const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');

navToggle.addEventListener('click', () => {
  const isOpen = mainNav.classList.toggle('open');
  navToggle.classList.toggle('active', isOpen);
  if (isOpen) lockScroll(); else unlockScroll();
});

mainNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    if (mainNav.classList.contains('open')) unlockScroll();
    mainNav.classList.remove('open');
    navToggle.classList.remove('active');
  });
});

// ============ PRICE FORMAT ============
// جلوگیری از XSS: اسم/توضیح محصول از دیتابیس میاد و ممکنه توسط ادمین وارد شده باشه؛
// قبل از گذاشتن تو innerHTML باید escape بشه (پنل ادمین خودش این تابع رو داره، اینجا هم لازمه)
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPrice(price) {
  // عدد انگلیسی + جداکننده‌ی هزارگان + حرف T به‌جای «ت»
  const val = Math.round(price / 1000);
  return `<span class="price-amount">${val.toLocaleString('en-US')}</span><span class="price-suffix">T</span>`;
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
  // درست همین لحظه که اسپلش محو میشه، متن‌های هیرو با انیمیشن پلکانی ظاهر میشن
  document.body.classList.add('site-loaded');
  window.dispatchEvent(new Event('siteloaded'));
  setTimeout(() => splash.remove(), 250);
}

// بارگذاری و پنهان شدن اسپلش به صورت مرحله‌ای توسط initStagedLoading() در انتهای اسکریپت مدیریت می‌شود.

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
  breakfast: '#E8A93E'
};

// ============ پیش‌بارگذاری عکس مودال ============
// قبلاً عکس بزرگ محصول فقط بعد از کلیک شروع به دانلود می‌کرد؛ برای همین موبایل بعد از لمس چند ثانیه
// اسکلتون می‌دید. حالا: (۱) کارت‌هایی که کاربر واقعاً دیده تو پس‌زمینه با اولویت پایین و حداکثر ۲ تا
// همزمان پیش‌لود میشن، (۲) لحظه‌ی لمس کارت (قبل از رها کردن انگشت) دانلودش با اولویت بالا شروع میشه.
// تو حالت صرفه‌جویی داده یا نت 2G هیچ پیش‌لود پس‌زمینه‌ای انجام نمیشه.
function mediumUrlFor(imgSrc) {
  if (!imgSrc) return null;
  return /^https?:\/\//i.test(imgSrc) ? imgSrc : `images/med/${imgSrc.split('/').pop()}`;
}

function openModal(product, catLabelText) {
  modalProductId = product.id;
  resetModalZoom();
  modalImage.dataset.fullSrc = product.image || getCategoryImage(product.category) || '';
  modalImage.querySelectorAll('img').forEach(el => el.remove());
  modalImage.classList.remove('img-ready');
  modalPlaceholder.style.display = 'none';
  modalPlaceholder.textContent = product.name.charAt(0);

  const imgSrc = product.image || getCategoryImage(product.category);
  const token = ++modalImgToken;
  if (imgSrc) {
    const medUrl = mediumUrlFor(imgSrc);
    const absFull = new URL(imgSrc, location.href).href;
    const alive = () => token === modalImgToken;

    const img = document.createElement('img');
    img.className = 'm-full shown';
    img.alt = product.name;
    img.decoding = 'async';
    img.dataset.full = imgSrc;
    img.onload = () => {
      if (!alive()) return;
      modalImage.classList.add('img-ready');
    };
    img.onerror = () => {
      if (!alive()) return;
      if (img.src !== absFull) {
        img.src = absFull; // فالبک به عکس اصلی
        return;
      }
      img.remove();
      modalImage.classList.add('img-ready');
      modalPlaceholder.style.display = 'flex';
    };
    img.src = medUrl;
    modalImage.append(img);

    if (img.complete && img.naturalWidth > 0) {
      modalImage.classList.add('img-ready');
    }
  } else {
    modalImage.classList.add('img-ready');
    modalPlaceholder.style.display = 'flex';
  }

  modalCat.textContent = catLabelText;
  modalCat.style.setProperty('--cat-color', CAT_COLORS[product.category] || '#9DBA8F');
  modalName.textContent = product.name;
  modalNote.textContent = product.note;
  if (product.originalPrice && product.originalPrice > product.price) {
    modalPrice.innerHTML = `<span class="price-old mono">${formatPrice(product.originalPrice)}</span><span class="price-new">${formatPrice(product.price)}</span>`;
  } else {
    modalPrice.innerHTML = formatPrice(product.price);
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  lockScroll();
  history.pushState({ modal: true }, "");
}

function closeModal() {
  if (!modal.classList.contains('open')) return;
  resetModalZoom();
  modalImgToken++; // دانلودهای نیمه‌کاره‌ی عکس مودال دیگه چیزی تغییر نمیدن
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  unlockScroll();
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
    // پاپ‌آپ انتخاب میز بالای سبد خرید بازه؛ فقط همون بسته میشه، نه سبد خرید زیرش
    if (tableModal.classList.contains('open')) { handleTableClose(); return; }
    if (imageZoomOverlay.classList.contains('open')) closeImageZoom();
    if (modal.classList.contains('open')) handleClose();
    if (cartDrawer.classList.contains('open')) closeCart();
    if (sortModal.classList.contains('open')) closeSortModal();
  }
});
window.addEventListener('popstate', (e) => {
  // دکمه‌ی برگشت وقتی پاپ‌آپ میز بازه، فقط خود پاپ‌آپ رو می‌بنده و سبد خرید باز می‌مونه
  if (tableModal.classList.contains('open')) { closeTableModal(); return; }
  closeImageZoom();
  closeModal();
  closeCart();
  closeSortModal();
});

// ============ IMAGE ZOOM (روی عکس مودال محصول) ============
// دسکتاپ: کلیک برای باز شدن تمام‌صفحه + اسکرول ماوس برای زوم + درگ برای جابه‌جایی وقتی زوم شده
// موبایل: کلیک برای باز شدن + پینچ واقعی با دو انگشت + درگ برای جابه‌جایی — محدود به خود عکس،
// نه کل صفحه (صفحه‌ی اصلی همچنان user-scalable=no می‌مونه؛ این زوم کاملاً جدا و با ترنسفورم CSS انجام میشه)
const imageZoomOverlay = document.getElementById('imageZoomOverlay');
const imageZoomImg = document.getElementById('imageZoomImg');
const imageZoomClose = document.getElementById('imageZoomClose');
const imageZoomStage = document.getElementById('imageZoomStage');

let zoomScale = 1, zoomX = 0, zoomY = 0;
const zoomPointers = new Map();
let zoomStartDist = 0, zoomStartScale = 1, zoomLastPan = null;

function applyZoomTransform() {
  imageZoomImg.style.transform = `translate(${zoomX}px, ${zoomY}px) scale(${zoomScale})`;
  imageZoomImg.style.cursor = zoomScale > 1 ? 'zoom-out' : 'zoom-in';
}

function resetZoom() {
  zoomScale = 1; zoomX = 0; zoomY = 0;
  applyZoomTransform();
}

function openImageZoom(src, alt) {
  if (!src) return;
  imageZoomImg.src = src;
  imageZoomImg.alt = alt || '';
  resetZoom();
  imageZoomOverlay.classList.add('open');
  lockScroll();
}

function closeImageZoom() {
  if (!imageZoomOverlay.classList.contains('open')) return;
  imageZoomOverlay.classList.remove('open');
  unlockScroll();
}

// زوم دیگه کلیک جداگانه نمی‌خواد: همون‌جا روی عکس مودال (پینچ، دابل‌تپ، چرخ ماوس) کار می‌کنه.
// پایین فایل: initModalZoom()

imageZoomClose.addEventListener('click', closeImageZoom);
imageZoomOverlay.addEventListener('click', (e) => {
  if (e.target === imageZoomOverlay || e.target === imageZoomStage) closeImageZoom();
});

let zoomLastTap = 0;
imageZoomImg.addEventListener('click', (e) => {
  e.stopPropagation();
  const now = Date.now();
  if (now - zoomLastTap < 300 || zoomScale > 1) {
    // دابل‌کلیک/دابل‌تپ، یا یه کلیک ساده وقتی از قبل زوم شده: toggle
    if (zoomScale > 1) resetZoom();
    else { zoomScale = 2.2; applyZoomTransform(); }
  }
  zoomLastTap = now;
});

imageZoomStage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.18 : -0.18;
  zoomScale = Math.min(4, Math.max(1, zoomScale + delta));
  if (zoomScale === 1) { zoomX = 0; zoomY = 0; }
  applyZoomTransform();
}, { passive: false });

imageZoomStage.addEventListener('pointerdown', (e) => {
  zoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (zoomPointers.size === 2) {
    const pts = [...zoomPointers.values()];
    zoomStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    zoomStartScale = zoomScale;
  } else if (zoomPointers.size === 1 && zoomScale > 1) {
    zoomLastPan = { x: e.clientX, y: e.clientY };
  }
});

imageZoomStage.addEventListener('pointermove', (e) => {
  if (!zoomPointers.has(e.pointerId)) return;
  zoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (zoomPointers.size === 2) {
    const pts = [...zoomPointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (zoomStartDist > 0) {
      zoomScale = Math.min(4, Math.max(1, zoomStartScale * (dist / zoomStartDist)));
      applyZoomTransform();
    }
  } else if (zoomPointers.size === 1 && zoomScale > 1 && zoomLastPan) {
    zoomX += e.clientX - zoomLastPan.x;
    zoomY += e.clientY - zoomLastPan.y;
    zoomLastPan = { x: e.clientX, y: e.clientY };
    applyZoomTransform();
  }
});

function endZoomPointer(e) {
  zoomPointers.delete(e.pointerId);
  if (zoomPointers.size < 2) zoomStartDist = 0;
  if (zoomPointers.size === 0) {
    zoomLastPan = null;
    if (zoomScale < 1.02) resetZoom();
  }
}
imageZoomStage.addEventListener('pointerup', endZoomPointer);
imageZoomStage.addEventListener('pointercancel', endZoomPointer);
imageZoomStage.addEventListener('pointerleave', endZoomPointer);

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

// منتظر می‌مونه عکس‌های دسته‌بندی‌ها واقعاً دانلود و دیکد بشن (مرحله دوم لودینگ)
function waitForCategoryImages(timeoutMs = 1500) {
  const imgs = Array.from(tabsEl.querySelectorAll('img'));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(imgs.map(img => waitForImage(img, timeoutMs)));
}

// منتظر می‌مونه عکس‌های کارت‌های اول منو واقعاً دانلود و دیکد بشن (مرحله سوم لودینگ)
function waitForMenuImages(timeoutMs = 2000) {
  const imgs = Array.from(grid.querySelectorAll('.product-card img'))
    .slice(0, EAGER_IMAGE_COUNT);
  if (!imgs.length) return Promise.resolve();
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

async function fetchProductsData() {
  if (productsData.products && productsData.products.length > 0) return productsData;
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
  }
  return productsData;
}

async function loadProducts() {
  await fetchProductsData();
  renderTabs();
  renderProducts();
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
    <span class="cat-card-label">All</span>
  </button>`;

  const catBtns = productsData.categories.map(c => {
    const img = getCategoryImage(c.id);
    const imgHtml = img
      ? `<img src="${productThumbSrc(img)}" alt="${esc(c.label)}" loading="eager" fetchpriority="high" decoding="async" data-fallback="${esc(c.label.charAt(0))}" onerror="const t=this.getAttribute('data-fallback'); this.remove(); this.parentElement.textContent=t;">`
      : esc(c.label.charAt(0));
    return `<button class="cat-card" data-cat="${c.id}">
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
  sortModal.classList.add('open');
  sortOverlay.classList.add('open');
  sortToggle.classList.add('active');
  lockScroll();
  history.pushState({ sort: true }, "");
}

function closeSortModal() {
  if (!sortModal.classList.contains('open')) return;
  sortModal.classList.remove('open');
  sortOverlay.classList.remove('open');
  sortToggle.classList.remove('active');
  unlockScroll();
}

sortToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  openSortModal();
});

sortModalClose.addEventListener('click', () => {
  if (history.state && history.state.sort) history.back();
  else closeSortModal();
});

sortOverlay.addEventListener('click', () => {
  if (history.state && history.state.sort) history.back();
  else closeSortModal();
});

sortModal.querySelectorAll('.sort-option').forEach(btn => {
  btn.addEventListener('click', () => {
    sortModal.querySelectorAll('.sort-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSort = btn.dataset.sort;
    renderProducts();
    if (history.state && history.state.sort) history.back();
    else closeSortModal();
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
    <article class="product-card" data-id="${p.id}">
      <svg class="card-neon" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="1" y="1" width="98" height="98" rx="7" ry="7" pathLength="100"></rect>
      </svg>
      <div class="product-image">
        ${imgSrc ? `<img src="${thumbSrc}" alt="${esc(p.name)}" loading="${lazy}" decoding="async" onload="this.parentElement.classList.add('img-ready')" onerror="this.remove(); this.parentElement.classList.add('img-ready'); this.parentElement.querySelector('.placeholder').style.display='flex';">` : ''}
        <div class="placeholder" style="display:${imgSrc ? 'none' : 'flex'};">${esc(p.name.charAt(0))}</div>
      </div>
      <div class="product-info">
        <div class="product-header">
          <span class="cat-dot" data-cat="${p.category}"></span>
          <div class="product-name">${esc(p.name)}</div>
          ${p.originalPrice ? '<span class="discount-badge">تخفیف</span>' : ''}
        </div>
        <div class="product-note">${esc(p.note)}</div>
        <div class="product-footer">
          <div class="price-group">
            ${p.originalPrice ? `<span class="price-old mono">${formatPrice(p.originalPrice)}</span>` : ''}
            <span class="product-price mono">${formatPrice(p.price)}</span>
          </div>
          <button class="add-to-cart-btn" data-id="${p.id}">افزودن +</button>
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
    card.addEventListener('click', (e) => {
      if (e.target.closest('.add-to-cart-btn')) return;
      const product = productsData.products.find(p => p.id === card.dataset.id);
      if (product) openModal(product, catLabel(product.category));
    });
  });

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

function openCart() {
  cartDrawer.classList.add('open');
  cartOverlay.classList.add('open');
  lockScroll();
  history.pushState({ cart: true }, "");
}

function closeCart() {
  if (!cartDrawer.classList.contains('open')) return;
  cartDrawer.classList.remove('open');
  cartOverlay.classList.remove('open');
  unlockScroll();
}

// باز شدن پنل با کلیک روی نوار شناور
floatingCart.addEventListener('click', openCart);
cartClose.addEventListener('click', () => {
  if (history.state && history.state.cart) history.back();
  else closeCart();
});
cartOverlay.addEventListener('click', () => {
  if (history.state && history.state.cart) history.back();
  else closeCart();
});

function addToCart(productId) {
  const product = productsData.products.find(p => p.id === productId);
  if (!product) return;

  const existingItem = cart.find(item => item.id === productId);
  if (existingItem) {
    existingItem.quantity++;
  } else {
    cart.push({ ...product, image: product.image || getCategoryImage(product.category), quantity: 1 });
  }
  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  renderCart();
}

function changeQty(productId, delta) {
  const item = cart.find(item => item.id === productId);
  if (item) {
    item.quantity += delta;
    if (item.quantity <= 0) {
      removeFromCart(productId);
    } else {
      renderCart();
    }
  }
}

function renderCart() {
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // مدیریت نوار شناور پایین صفحه
  if (cart.length > 0) {
    const lastItem = cart[cart.length - 1]; // آخرین محصول اضافه شده
    floatCartImg.src = lastItem.image;
    floatCartImg.onerror = () => floatCartImg.style.display = 'none';
    floatCartImg.style.display = 'block';
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
        <img src="${item.image}" alt="${esc(item.name)}" onerror="this.parentElement.style.display='none'">
      </div>
      <div class="cart-item-main">
        <div class="cart-item-line1">
          <span class="cart-item-name">${esc(item.name)}</span>
          <button class="remove-item" onclick="removeFromCart('${item.id}')" aria-label="حذف محصول">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
            </svg>
          </button>
        </div>
        <div class="cart-item-line2">
          <div class="qty-control">
            <button class="qty-btn" onclick="changeQty('${item.id}', -1)" aria-label="کم کردن">−</button>
            <span class="qty-value mono">${item.quantity.toLocaleString('fa-IR')}</span>
            <button class="qty-btn" onclick="changeQty('${item.id}', 1)" aria-label="اضافه کردن">+</button>
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
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'خطایی رخ داد، لطفاً دوباره امتحان کنید.');
    }
    cart = [];
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
      if (e.type === 'pointerup' && tap && !tap.moved && performance.now() - tap.t < 200) {
        const now = performance.now();
        if (now - lastTap.t < 250 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 20) {
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

// ============ بارگذاری مرحله‌ای آبشاری (Staged Loading Waterfall) ============
// طبق درخواست:
// ۱. اول فقط لوگو، عکس هیرو و متن‌های اسپلش لود و نمایش داده می‌شوند.
// ۲. پس از لود کامل و نمایش لوگو و هیرو، کاربر ۳ ثانیه در صفحه اسپلش می‌ماند.
// ۳. در طول این ۳ ثانیه، سایت در پس‌زمینه (Background) به ترتیب لود می‌شود:
//    - دوم: کتگوری‌ها لود و رندر می‌شوند.
//    - سوم: محصولات و عکس‌های کارت‌های منو لود می‌شوند.
// ۴. پس از پایان ۳ ثانیه (و اتمام لود بک‌گراند)، اسپلش محو شده و کاربر وارد سایت می‌شود.
async function initStagedLoading() {
  // سقف زمانی نهایی: در صورت بروز هرگونه مشکل شبکه، اسپلش حداکثر بعد از ۷.۵ ثانیه بسته می‌شود
  const hardCapTimer = setTimeout(hideSplash, 7500);

  try {
    // مرحله اول: ابتدا فقط لوگو، عکس هیرو و انیمیشن متن‌های اسپلش لود و کامل می‌شوند
    await loadSiteConfig();

    // مرحله دوم و سوم: شروع تایمر ۳ ثانیه + لود همزمان پس‌زمینه سایت
    const wait3SecondsPromise = new Promise((resolve) => setTimeout(resolve, 3000));

    const backgroundLoadingPromise = (async () => {
      // دریافت و آماده‌سازی دیتای منو
      await fetchProductsData();

      // دوم: لود کتگوری‌ها
      renderTabs();
      await waitForCategoryImages(1500);

      // سوم: لود عکس محصولات
      renderProducts();
      await waitForMenuImages(2000);
    })();

    // صبر می‌کنیم تا هم ۳ ثانیه تمام شود و هم لود پس‌زمینه کامل شود (سقف حداکثر ۴ ثانیه برای پس‌زمینه)
    await Promise.all([
      wait3SecondsPromise,
      Promise.race([
        backgroundLoadingPromise,
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]),
    ]);
  } catch (err) {
    console.error('خطا در بارگذاری مرحله‌ای:', err);
  } finally {
    clearTimeout(hardCapTimer);
    hideSplash();
  }
}

// Init
renderCart();
initStagedLoading();