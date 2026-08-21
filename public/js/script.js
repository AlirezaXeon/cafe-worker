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
  mainNav.classList.toggle('open');
  navToggle.classList.toggle('active');
  document.body.classList.toggle('nav-open', mainNav.classList.contains('open'));
});

mainNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    mainNav.classList.remove('open');
    navToggle.classList.remove('active');
    document.body.classList.remove('nav-open');
  });
});

// ============ PRICE FORMAT ============
function formatPrice(price) {
  const toFa = (v) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
  // تقسیم بر 1000 و اضافه کردن حرف ت
  const val = Math.round(price / 1000);
  return `<span class="price-amount">${toFa(val)}</span><span class="price-suffix"> ت</span>`;
}
// ============ SPLASH SCREEN LOGIC ============
window.addEventListener('load', () => {
  const splash = document.getElementById('splash');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('hide');
      // بعد از اتمام انیمیشن محو شدن، کد رو کامل پاک میکنه تا جلوی اسکرول رو نگیره
      setTimeout(() => splash.remove(), 250);
    }, 700); // ~0.7 ثانیه نمایش لوگو
  }
});

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
  modalAddBtn.textContent = 'افزودن +';
  modalAddBtn.classList.remove('added');
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
  document.body.classList.add('nav-open');
  history.pushState({ modal: true }, "");
}

function closeModal() {
  if (!modal.classList.contains('open')) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('nav-open');
}

function handleClose() {
  if (history.state && history.state.modal) {
    history.back();
  } else {
    closeModal();
  }
}

modalClose.addEventListener('click', handleClose);
modalAddBtn.addEventListener('click', () => {
  if (!modalProductId) return;
  addToCart(modalProductId);
  modalAddBtn.textContent = 'افزوده شد ✓';
  modalAddBtn.classList.add('added');
  setTimeout(() => {
    modalAddBtn.textContent = 'افزودن +';
    modalAddBtn.classList.remove('added');
  }, 1500);
});
modal.addEventListener('click', (e) => {
  if (e.target === modal) handleClose();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modal.classList.contains('open')) handleClose();
    if (cartDrawer.classList.contains('open')) closeCart();
  }
});
window.addEventListener('popstate', (e) => {
  closeModal();
  closeCart();
});

// ============ MENU RENDER & SORT ============
const grid = document.getElementById('productGrid');
const tabsEl = document.getElementById('categoryTabs');
const sortSelect = document.getElementById('sortPrice');

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
    <span class="cat-card-label">همه</span>
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

sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  renderProducts();
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
  document.body.classList.add('nav-open');
  history.pushState({ cart: true }, "");
}

function closeCart() {
  if (!cartDrawer.classList.contains('open')) return;
  cartDrawer.classList.remove('open');
  cartOverlay.classList.remove('open');
  document.body.classList.remove('nav-open');
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

// Init
loadProducts();
renderCart();