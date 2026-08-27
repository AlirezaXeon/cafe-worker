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

// ============ THEME TOGGLE ============
const themeToggle = document.getElementById('themeToggle');
const htmlEl = document.documentElement;
const savedTheme = localStorage.getItem('theme') || 'dark';
htmlEl.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

themeToggle.addEventListener('click', () => {
  const currentTheme = htmlEl.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  htmlEl.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
});

function updateThemeIcon(theme) {
  themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
}

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
function formatPrice(price) {
  // عدد انگلیسی + جداکننده‌ی هزارگان + حرف T به‌جای «ت»
  const val = Math.round(price / 1000);
  return `<span class="price-amount">${val.toLocaleString('en-US')}</span><span class="price-suffix">T</span>`;
}
// ============ SPLASH SCREEN LOGIC ============
// از window.load استفاده نمی‌کنیم چون منتظر لود کامل همه‌ی عکس‌های محصولات هم می‌مونه
// و اگه نت کند باشه، اسپلش می‌تونه چند ثانیه (حتی بیشتر از ۱۰ ثانیه) گیر کنه.
// به‌جاش با DOMContentLoaded (فقط منتظر خود صفحه) + یه سقف زمانی مطمئن کار می‌کنیم.
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.dataset.hidden === 'true') return;
  splash.dataset.hidden = 'true';
  splash.classList.add('hide');
  // درست همین لحظه که اسپلش محو میشه، متن‌های هیرو با انیمیشن پلکانی ظاهر میشن
  document.body.classList.add('site-loaded');
  setTimeout(() => splash.remove(), 250);
}

document.addEventListener('DOMContentLoaded', () => {
  // اسپلش رو تا وقتی هم منو/محصولات و هم تنظیمات سایت (لوگو) کامل لود نشدن نگه می‌داریم،
  // تا کاربر هیچ‌وقت سایت نصفه‌کاره یا در حال لود رو نبینه. اگه لود بیشتر از ۳ ثانیه طول کشید
  // (نت کند، سرور کند، هرچی)، همون سقف ۳ ثانیه‌ای رعایت میشه و از رو اسپلش رد میشیم.
  const allLoaded = Promise.all([productsLoadedPromise, siteConfigPromise]);
  const hardCap = new Promise((resolve) => setTimeout(resolve, 3000));
  Promise.race([allLoaded, hardCap]).then(hideSplash);
});

// شبکه‌ی ایمنی نهایی: مهم نیست چه اتفاقی بیفته (حتی اگه DOMContentLoaded خودش گیر کنه)،
// اسپلش بیشتر از ۳ ثانیه رو صفحه نمی‌مونه.
setTimeout(hideSplash, 3000);

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

const CAT_COLORS = {
  coffee: '#B58863',
  dessert: '#9DBA8F', // دیفالت سایت
  breakfast: '#E8A93E'
};

function openModal(product, catLabelText) {
  modalProductId = product.id;
  modalImage.querySelectorAll('img').forEach(el => el.remove());
  modalPlaceholder.style.display = 'none';
  modalPlaceholder.textContent = product.name.charAt(0);

  const imgSrc = product.image || getCategoryImage(product.category);
  if (imgSrc) {
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = product.name;
    img.onerror = () => {
      img.remove();
      modalPlaceholder.style.display = 'flex';
    };
    modalImage.prepend(img);
  } else {
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
    if (modal.classList.contains('open')) handleClose();
    if (cartDrawer.classList.contains('open')) closeCart();
    if (sortModal.classList.contains('open')) closeSortModal();
  }
});
window.addEventListener('popstate', (e) => {
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

async function loadProducts() {
  try {
    const res = await fetch('data/products.json');
    productsData = await res.json();
  } catch (err) {
    console.error('محصولات لود نشدند:', err);
    return;
  }
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
      ? `<img src="${img}" alt="${c.label}" onerror="this.remove(); this.parentElement.textContent='${c.label.charAt(0)}';">`
      : c.label.charAt(0);
    return `<button class="cat-card" data-cat="${c.id}">
      <span class="cat-card-img">${imgHtml}</span>
      <span class="cat-card-label">${c.label}</span>
    </button>`;
  }).join('');

  tabsEl.innerHTML = allBtn + catBtns;

  tabsEl.querySelectorAll('.cat-card').forEach(btn => {
    btn.addEventListener('click', () => {
      tabsEl.querySelectorAll('.cat-card').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.cat;
      renderProducts();
    });
  });
}

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

function productCardHtml(p) {
  const imgSrc = p.image || getCategoryImage(p.category);
  return `
    <article class="product-card" data-id="${p.id}">
      <svg class="card-neon" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect x="1" y="1" width="98" height="98" rx="7" ry="7" pathLength="100"></rect>
      </svg>
      <div class="product-image">
        ${imgSrc ? `<img src="${imgSrc}" alt="${p.name}" onerror="this.remove(); this.parentElement.querySelector('.placeholder').style.display='flex';">` : ''}
        <div class="placeholder" style="display:${imgSrc ? 'none' : 'flex'};">${p.name.charAt(0)}</div>
      </div>
      <div class="product-info">
        <div class="product-header">
          <span class="cat-dot" data-cat="${p.category}"></span>
          <div class="product-name">${p.name}</div>
          ${p.originalPrice ? '<span class="discount-badge">تخفیف</span>' : ''}
        </div>
        <div class="product-note">${p.note}</div>
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
  let items = activeCategory === 'all'
    ? [...productsData.products]
    : productsData.products.filter(p => p.category === activeCategory);

  if (currentSort === 'low-high') {
    items.sort((a, b) => a.price - b.price);
  } else if (currentSort === 'high-low') {
    items.sort((a, b) => b.price - a.price);
  }

  const catLabel = id => {
    const c = productsData.categories.find(c => c.id === id);
    return c ? c.label : id;
  };

  if (activeCategory === 'all') {
    // تو حالت «همه»، محصولات رو زیر عنوان دسته‌بندی خودشون گروه می‌کنیم
    // تا موقع اسکرول کردن روی کل منو، کاربر گم نشه که الان چه دسته‌ای رو می‌بینه
    const groups = productsData.categories
      .map(c => ({ cat: c, items: items.filter(p => p.category === c.id) }))
      .filter(g => g.items.length > 0);

    grid.innerHTML = groups.map(g => `
      <div class="menu-group">
        <h3 class="menu-group-title">${g.cat.label}</h3>
        <div class="product-list">
          ${g.items.map(productCardHtml).join('')}
        </div>
      </div>
    `).join('');
  } else {
    grid.innerHTML = `<div class="product-list">${items.map(productCardHtml).join('')}</div>`;
  }

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

  cartItemsEl.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img src="${item.image}" alt="${item.name}" onerror="this.style.display='none'">
      <div class="cart-item-info">
        <span class="cart-item-name">${item.name}</span>
        <span class="cart-item-price">${formatPrice(item.price * item.quantity)}</span>
      </div>
      <div class="cart-item-actions">
        <button class="qty-btn" onclick="changeQty('${item.id}', -1)">-</button>
        <span class="mono">${item.quantity.toLocaleString('fa-IR')}</span>
        <button class="qty-btn" onclick="changeQty('${item.id}', 1)">+</button>
        <button class="remove-item" onclick="removeFromCart('${item.id}')">🗑</button>
      </div>
    </div>
  `).join('');

  cartTotalPriceEl.innerHTML = formatPrice(totalPrice);
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
function revealSplash(hasLogo) {
  const splashLogo = document.getElementById('splashLogoImg');
  const splashFallback = document.getElementById('splashFallback');
  const splashTitle = document.getElementById('splashTitle');
  const splashTagline = document.getElementById('splashTagline');

  if (hasLogo && splashLogo) {
    splashLogo.classList.add('show');
  } else if (splashFallback) {
    splashFallback.classList.add('show');
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

async function loadSiteConfig() {
  try {
    const res = await fetch('data/site.json');
    const cfg = await res.json();

    const headerLogo = document.getElementById('headerLogoImg');
    const coverLogo = document.getElementById('heroCoverLogo');
    const coverImg = document.getElementById('heroCoverImg');
    const splashLogo = document.getElementById('splashLogoImg');

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
      await revealSplash(true);
    } else {
      // هنوز از ربات لوگویی آپلود نشده؛ چون <img> از اول src نداره، به‌جای منتظر موندن
      // برای یه request ناموفق، مستقیم فالبک متنی رو نشون می‌دیم
      const logoFallback = document.getElementById('logoFallback');
      if (logoFallback) logoFallback.style.display = 'flex';
      if (headerLogo) headerLogo.style.display = 'none';
      if (coverLogo) coverLogo.style.display = 'none';
      await revealSplash(false);
    }

    if (cfg.cover && coverImg) {
      coverImg.src = cfg.cover;
      coverImg.style.display = '';
      coverImg.closest('.hero-cover')?.classList.remove('no-cover');
    } else {
      // هنوز از ربات عکسی آپلود نشده؛ فقط پس‌زمینه‌ی گرادینت دیده میشه
      document.querySelector('.hero-cover')?.classList.add('no-cover');
    }
  } catch (err) {
    console.error('تنظیمات سایت لود نشد:', err);
    await revealSplash(false);
  }
}

// ============ انیمیشن اسکرول: لوگوی وسط عکس با اسکرول به سمت لوگوی هدر «پرواز» می‌کنه ============
(function initHeroScrollIntro() {
  const heroCover = document.querySelector('.hero-cover');
  if (!heroCover) return;

  let ticking = false;

  function update() {
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

  function update() {
    const currentY = window.scrollY || 0;
    const delta = currentY - lastScrollY;

    if (currentY <= SHOW_NEAR_TOP) {
      document.body.classList.remove('header-hidden');
    } else if (delta > HIDE_THRESHOLD) {
      document.body.classList.add('header-hidden');
    } else if (delta < -HIDE_THRESHOLD) {
      document.body.classList.remove('header-hidden');
    }

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

// Init
const productsLoadedPromise = loadProducts();
const siteConfigPromise = loadSiteConfig();
renderCart();