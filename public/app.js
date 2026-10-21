// public/app.js

document.addEventListener('DOMContentLoaded', () => {
  initYear();
  initNav();
  initMobileMenu();
  initFooterSocial();

  if (document.getElementById('login-form'))        initLoginPage();
  if (document.getElementById('listing-form'))      initListingForm();
  if (document.getElementById('listings-grid'))     initHome();
  if (document.getElementById('listing-detail'))    initListingDetail();
  if (document.getElementById('admin-content'))     initAdmin();
  if (document.getElementById('dashboard-content')) initDashboard();
  if (document.getElementById('verify-form'))       initVerifyPage();
});

// ---------- SHARED ----------
function initYear() {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
}

function initFooterSocial() {
  const wa = document.getElementById('wa-contact');
  if (wa) wa.href = 'https://wa.me/254700000000';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatKes(n) {
  return 'KSh ' + Number(n).toLocaleString('en-KE');
}

function capitalize(s) {
  return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
}

async function getMe() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
  } catch { return null; }
}

async function initNav() {
  const userSpan = document.getElementById('nav-user');
  if (!userSpan) return;

  const loginLink  = document.getElementById('nav-login');
  const signupLink = document.getElementById('nav-signup');
  const dashLink   = document.getElementById('nav-dashboard');
  const adminLink  = document.getElementById('nav-admin');
  const nameSpan   = document.getElementById('nav-name');
  const logoutBtn  = document.getElementById('logout-btn');

  const user = await getMe();

  if (user) {
    loginLink?.classList.add('hidden');
    signupLink?.classList.add('hidden');
    userSpan.classList.remove('hidden');
    nameSpan.textContent = 'Hi, ' + user.full_name.split(' ')[0];
    dashLink?.classList.remove('hidden');

    if (user.role === 'admin' || user.role === 'super_admin') {
      adminLink?.classList.remove('hidden');
    } else {
      adminLink?.classList.add('hidden');
    }
  } else {
    dashLink?.classList.add('hidden');
    adminLink?.classList.add('hidden');
  }

  logoutBtn?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
  });
}

// ---------- MOBILE MENU ----------
async function initMobileMenu() {
  const btn = document.getElementById('hamburger');
  const menu = document.getElementById('mobile-menu');
  if (!btn || !menu) return;

  const user = await getMe();

  const mLogin    = menu.querySelector('#m-login');
  const mSignup   = menu.querySelector('#m-signup');
  const mDash     = menu.querySelector('#m-dashboard');
  const mAdmin    = menu.querySelector('#m-admin');
  const mUserInfo = menu.querySelector('#m-user-info');
  const mLogout   = menu.querySelector('#m-logout');

  if (user) {
    mLogin?.classList.add('hidden');
    mSignup?.classList.add('hidden');
    mUserInfo?.classList.remove('hidden');
    mDash?.classList.remove('hidden');

    const mName = document.getElementById('m-name');
    if (mName) mName.textContent = 'Hi, ' + user.full_name.split(' ')[0];

    if (user.role === 'admin' || user.role === 'super_admin') {
      mAdmin?.classList.remove('hidden');
    } else {
      mAdmin?.classList.add('hidden');
    }
  } else {
    mUserInfo?.classList.add('hidden');
    mDash?.classList.add('hidden');
    mAdmin?.classList.add('hidden');
    mLogout?.classList.add('hidden');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.classList.remove('open');
    }
  });

  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => menu.classList.remove('open'));
  });

  mLogout?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
  });
}

// ---------- LOGIN PAGE ----------
function initLoginPage() {
  const tabs = document.querySelectorAll('.tab');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      loginForm.classList.toggle('hidden', target !== 'login');
      signupForm.classList.toggle('hidden', target !== 'signup');
    });
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('login-msg');
    msg.textContent = ''; msg.classList.remove('ok');
    const btn = loginForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Logging in...';

    const formData = new FormData(loginForm);
    const body = { phone: formData.get('phone'), password: formData.get('password') };

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) msg.textContent = data.error || 'Login failed.';
      else { msg.classList.add('ok'); msg.textContent = 'Logged in. Redirecting...'; setTimeout(() => window.location.href = '/dashboard.html', 500); }
    } catch { msg.textContent = 'Network error. Try again.'; }
    finally { btn.disabled = false; btn.textContent = 'Log In'; }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('signup-msg');
    msg.textContent = ''; msg.classList.remove('ok');
    const btn = signupForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Creating account...';

    const formData = new FormData(signupForm);
    const body = {
      phone: formData.get('phone'),
      password: formData.get('password'),
      full_name: formData.get('full_name')
    };

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) msg.textContent = data.error || 'Signup failed.';
      else { msg.classList.add('ok'); msg.textContent = 'Account created. Redirecting...'; setTimeout(() => window.location.href = '/dashboard.html', 500); }
    } catch { msg.textContent = 'Network error. Try again.'; }
    finally { btn.disabled = false; btn.textContent = 'Create Account'; }
  });
}

// ---------- UPLOAD / EDIT FORM ----------
let editingListingId = null;

function initListingForm() {
  const form = document.getElementById('listing-form');
  const msg = document.getElementById('listing-msg');

  const params = new URLSearchParams(window.location.search);
  const editId = params.get('edit');
  if (editId) {
    editingListingId = editId;
    document.getElementById('upload-title').textContent = 'Edit Listing';
    document.getElementById('upload-hint').textContent = 'Update the details below and save.';
    document.getElementById('listing-submit').textContent = 'Save changes';
    loadListingForEdit(editId);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = ''; msg.classList.remove('ok');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = editingListingId ? 'Saving...' : 'Uploading...';

    const formData = new FormData(form);

    try {
      const url = editingListingId ? '/api/listings/' + encodeURIComponent(editingListingId) : '/api/listings';
      const method = editingListingId ? 'PUT' : 'POST';

      const res = await fetch(url, { method, body: formData });
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = data.error || 'Could not save listing.';
      } else if (editingListingId) {
        msg.classList.add('ok');
        msg.textContent = 'Listing updated. Redirecting...';
        setTimeout(() => window.location.href = '/dashboard.html', 800);
      } else {
        msg.classList.add('ok');
        msg.textContent = 'Listing saved as draft. Go to My Listings to pay and publish.';
        setTimeout(() => window.location.href = '/dashboard.html', 900);
      }
    } catch (err) { msg.textContent = 'Network error: ' + err.message; }
    finally { btn.disabled = false; btn.textContent = editingListingId ? 'Save changes' : 'Save listing'; }
  });
}

async function loadListingForEdit(id) {
  try {
    const res = await fetch('/api/listings/' + encodeURIComponent(id));
    if (!res.ok) return;
    const { listing } = await res.json();

    const form = document.getElementById('listing-form');
    ['make','model','year','engine_cc','mileage_km','price_kes','condition','intended_use','location_town','location_county','description','logbook_status'].forEach(k => {
      const el = form.elements[k];
      if (el && listing[k] != null) el.value = listing[k];
    });
  } catch {}
}

// ---------- HOMEPAGE SEARCH ----------
const state = {
  q: '', make: '', model: '', condition: '', town: '',
  price_min: '', price_max: '', cc_min: '', cc_max: '',
  use: '', sort: 'newest'
};

function initHome() {
  const params = new URLSearchParams(window.location.search);

  ['q','make','model','condition','town','price_min','price_max','cc_min','cc_max','use','sort'].forEach(k => {
    if (params.get(k)) state[k] = params.get(k);
  });

  document.getElementById('header-search-input').value = state.q;
  document.getElementById('filter-make').value = state.make;
  document.getElementById('filter-model').value = state.model;
  document.getElementById('filter-condition').value = state.condition;
  document.getElementById('filter-town').value = state.town;
  document.getElementById('filter-price-min').value = state.price_min;
  document.getElementById('filter-price-max').value = state.price_max;
  document.getElementById('filter-cc-min').value = state.cc_min;
  document.getElementById('filter-cc-max').value = state.cc_max;
  document.getElementById('filter-use').value = state.use;
  document.getElementById('sort-by').value = state.sort;

  document.getElementById('apply-filters').addEventListener('click', applyAndReload);
  document.getElementById('clear-filters').addEventListener('click', () => window.location.href = '/');
  document.getElementById('sort-by').addEventListener('change', (e) => { state.sort = e.target.value; applyAndReload(); });
  document.getElementById('header-search').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = document.getElementById('header-search-input').value.trim();
    applyAndReload();
  });

  loadListings();
}

function applyAndReload() {
  state.make = document.getElementById('filter-make').value.trim();
  state.model = document.getElementById('filter-model').value.trim();
  state.condition = document.getElementById('filter-condition').value;
  state.town = document.getElementById('filter-town').value.trim();
  state.price_min = document.getElementById('filter-price-min').value;
  state.price_max = document.getElementById('filter-price-max').value;
  state.cc_min = document.getElementById('filter-cc-min').value;
  state.cc_max = document.getElementById('filter-cc-max').value;
  state.use = document.getElementById('filter-use').value;

  const params = new URLSearchParams();
  Object.entries(state).forEach(([k, v]) => { if (v) params.set(k, v); });
  window.history.replaceState({}, '', '/?' + params.toString());
  loadListings();
}

async function loadListings() {
  const grid = document.getElementById('listings-grid');
  grid.innerHTML = '<p class="loading">Loading listings...</p>';

  const params = new URLSearchParams();
  Object.entries(state).forEach(([k, v]) => { if (v) params.set(k, v); });

  try {
    const res = await fetch('/api/listings?' + params.toString());
    const data = await res.json();
    renderListings(data.listings || []);
  } catch (err) {
    grid.innerHTML = '<p class="empty">Could not load listings. ' + escapeHtml(err.message) + '</p>';
  }
}

function renderListings(listings) {
  const grid = document.getElementById('listings-grid');
  const title = document.getElementById('results-title');

  if (listings.length === 0) {
    grid.innerHTML = '<p class="empty">No motorcycles found. Try adjusting filters.</p>';
    title.textContent = 'Motorcycles for sale';
    return;
  }

  title.textContent = listings.length + ' motorcycle' + (listings.length === 1 ? '' : 's') + ' for sale';

  grid.innerHTML = listings.map(l => {
    const cover = l.cover_key
      ? `<img src="${l.cover_key}" alt="${escapeHtml(l.make)} ${escapeHtml(l.model)}" loading="lazy">`
      : `<div class="placeholder">No photo</div>`;
    const featuredTag = l.is_featured ? '<span class="card-tag featured">★ Featured</span>' : '';
    return `
      <a class="card" href="/listing.html?id=${encodeURIComponent(l.id)}">
        <div class="card-img">${cover}</div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(l.make)} ${escapeHtml(l.model)}${l.year ? ' · ' + l.year : ''}</div>
          <div class="card-price">${formatKes(l.price_kes)}</div>
          <div class="card-meta">
            <span class="card-tag">${escapeHtml(l.condition)}</span>
            ${l.engine_cc ? `<span class="card-tag">${l.engine_cc}cc</span>` : ''}
            ${featuredTag}
            <span>${escapeHtml(l.location_town)}</span>
          </div>
        </div>
      </a>
    `;
  }).join('');
}

// ---------- LISTING DETAIL ----------
function initListingDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const container = document.getElementById('listing-detail');
  if (!id) { container.innerHTML = '<p class="empty">No listing specified.</p>'; return; }

  fetch('/api/listings/' + encodeURIComponent(id))
    .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
    .then(({ ok, data }) => {
      if (!ok) { container.innerHTML = '<p class="empty">' + escapeHtml(data.error || 'Not found') + '</p>'; return; }
      renderListingDetail(data.listing);
    })
    .catch(err => { container.innerHTML = '<p class="empty">Error: ' + escapeHtml(err.message) + '</p>'; });
}

function renderListingDetail(l) {
  const container = document.getElementById('listing-detail');
  document.title = `${l.make} ${l.model} — Senke Fiti`;

  const images = l.images || [];
  const heroImg = images[0]
    ? `<img id="detail-hero" src="${images[0].r2_key}" alt="" oncontextmenu="return false;" draggable="false">`
    : `<div class="placeholder" style="aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;color:#999">No photo</div>`;

  const thumbs = images.length > 1
    ? `<div class="detail-thumbs">${images.map((img, i) =>
        `<img src="${img.r2_key}" data-full="${img.r2_key}" class="${i === 0 ? 'active' : ''}" oncontextmenu="return false;" draggable="false">`
      ).join('')}</div>`
    : '';

  let docHtml = '';
  if (l.documents && l.documents.length > 0) {
    docHtml = `<div class="detail-description" style="margin-top:16px">
      <h3 style="margin-bottom:10px;font-size:15px">Documents</h3>
      <ul style="list-style:none;padding:0;">`;
    l.documents.forEach(doc => {
      docHtml += `
        <li style="margin-bottom:10px;">
          <button class="btn-secondary" onclick="document.getElementById('pdf-viewer').classList.toggle('hidden'); document.getElementById('pdf-frame').src='${doc.r2_key}';">
            📄 View ${escapeHtml(doc.doc_type)}
          </button>
        </li>
      `;
    });
    docHtml += `</ul>
      <div id="pdf-viewer" class="hidden" style="margin-top:10px; height: 500px;">
         <iframe id="pdf-frame" src="" style="width:100%; height:100%; border:1px solid #ccc;"></iframe>
      </div>
    </div>`;
  }

  const phone = l.seller_phone ? l.seller_phone.replace(/^254/, '0') : '';
  const waLink = l.seller_phone
    ? `https://wa.me/${l.seller_phone}?text=${encodeURIComponent('Hi, I saw your ' + l.make + ' ' + l.model + ' on Senke Fiti.')}`
    : '#';

  const statusNote = l.status !== 'active'
    ? `<div class="status-banner ${l.status}">This listing is ${escapeHtml(l.status)} and not publicly visible.</div>`
    : '';

  container.innerHTML = `
    ${statusNote}
    <div class="detail-grid">
      <div>
        <div class="detail-gallery">
          <div class="detail-hero-img">${heroImg}</div>
          ${thumbs}
        </div>

        ${l.description ? `<div class="detail-description" style="margin-top:16px">
          <h3 style="margin-bottom:10px;font-size:15px">Description</h3>
          <p>${escapeHtml(l.description).replace(/\n/g, '<br>')}</p>
        </div>` : ''}

        ${docHtml}
      </div>

      <div class="detail-info">
        <h1 class="detail-title">${escapeHtml(l.make)} ${escapeHtml(l.model)}</h1>
        <div class="detail-price">${formatKes(l.price_kes)}</div>

        <div class="detail-specs">
          <h3>Specifications</h3>
          ${specRow('Condition', capitalize(l.condition))}
          ${l.year ? specRow('Year', l.year) : ''}
          ${l.engine_cc ? specRow('Engine', l.engine_cc + ' cc') : ''}
          ${l.mileage_km ? specRow('Mileage', Number(l.mileage_km).toLocaleString() + ' km') : ''}
          ${l.intended_use ? specRow('Intended use', capitalize(l.intended_use)) : ''}
          ${specRow('Location', l.location_town + (l.location_county ? ', ' + l.location_county : ''))}
          ${l.logbook_status ? specRow('Logbook', capitalize(l.logbook_status.replace('_', ' '))) : ''}
        </div>

        <div class="seller-card">
          <div class="seller-name">
            ${escapeHtml(l.seller_name)}
            ${l.seller_verified ? '<span class="seller-badge">Verified</span>' : ''}
          </div>
          <div class="seller-actions">
            <a class="btn-whatsapp" href="${waLink}" target="_blank" rel="noopener">Chat on WhatsApp</a>
            ${phone ? `<a class="btn-primary" href="tel:${phone}">Call ${phone}</a>` : ''}
            <button class="btn-danger" id="report-btn">Report this listing</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('.detail-thumbs img').forEach(t => {
    t.addEventListener('click', () => {
      document.getElementById('detail-hero').src = t.dataset.full;
      document.querySelectorAll('.detail-thumbs img').forEach(i => i.classList.remove('active'));
      t.classList.add('active');
    });
  });

  document.getElementById('report-btn').addEventListener('click', async () => {
    const reason = prompt('Why are you reporting this listing?\n(e.g. stolen, fraud, wrong_specs)');
    if (!reason) return;
    const details = prompt('Any additional details? (optional)') || '';
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: l.id, reason, details })
      });
      const data = await res.json();
      if (res.ok) alert('Thank you. This listing has been hidden while we review.');
      else alert(data.error || 'Could not submit report.');
    } catch { alert('Network error.'); }
  });
}

function specRow(label, value) {
  return `<div class="spec-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

// ---------- DASHBOARD ----------
let currentDashboardTab = 'all';

async function initDashboard() {
  const guest = document.getElementById('dashboard-guest');
  const content = document.getElementById('dashboard-content');

  const user = await getMe();
  if (!user) { guest.classList.remove('hidden'); return; }
  content.classList.remove('hidden');

  if (!user.is_verified) {
    document.getElementById('verify-banner').classList.remove('hidden');
  }

  const tabContainer = document.getElementById('dashboard-tabs');
  if (tabContainer) {
    tabContainer.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabContainer.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentDashboardTab = tab.dataset.dashTab;
        loadDashboardListings();
      });
    });
  }

  loadDashboardListings();
}

async function loadDashboardListings() {
  const container = document.getElementById('dashboard-listings');
  const stats = document.getElementById('dashboard-stats');
  const warningContainer = document.getElementById('dashboard-warning-container');

  try {
    const res = await fetch('/api/listings/mine');
    const data = await res.json();
    let listings = data.listings || [];

    const counts = { active: 0, draft: 0, expired: 0, hidden: 0 };
    listings.forEach(l => { if (counts[l.status] !== undefined) counts[l.status]++; });

    stats.innerHTML = `
      <div class="stat-card"><div class="stat-num">${listings.length}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-num">${counts.active}</div><div class="stat-label">Active</div></div>
      <div class="stat-card"><div class="stat-num">${counts.draft}</div><div class="stat-label">Awaiting payment</div></div>
      <div class="stat-card"><div class="stat-num">${counts.expired}</div><div class="stat-label">Expired</div></div>
    `;

    if (listings.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>You haven't posted any motorcycles yet.</p>
          <a href="/upload.html" class="btn-primary">Post your first bike</a>
        </div>
      `;
      if(warningContainer) warningContainer.innerHTML = '';
      return;
    }

    let filteredListings = listings;
    if (currentDashboardTab === 'active') filteredListings = listings.filter(l => l.status === 'active');
    else if (currentDashboardTab === 'draft') filteredListings = listings.filter(l => l.status === 'draft');
    else if (currentDashboardTab === 'expired') filteredListings = listings.filter(l => l.status === 'expired');

    if (currentDashboardTab === 'draft' && counts.draft > 0 && warningContainer) {
      warningContainer.innerHTML = `
        <div class="verify-banner" style="background:#ffe6e6; border-color:#ffcccc; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="color:#c02020;">Attention: You have ${counts.draft} unpaid draft(s).</strong>
            <p style="margin:4px 0 0 0; font-size:13px; color:#a00;">Drafts exceeding 60 days will be automatically deleted.</p>
          </div>
          <button class="btn-danger btn-sm" onclick="deleteAllDrafts()">Delete All Drafts</button>
        </div>
      `;
    } else if (warningContainer) {
      warningContainer.innerHTML = '';
    }

    if (filteredListings.length === 0) {
       container.innerHTML = '<p class="empty" style="grid-column: 1 / -1;">No listings found in this category.</p>';
       return;
    }

    container.innerHTML = filteredListings.map(l => {
      const cover = l.cover_key
        ? `<img src="${l.cover_key}" alt="" loading="lazy">`
        : `<div class="placeholder">No photo</div>`;

      let actions = '';
      if (l.status === 'draft') {
        actions = `
          <button class="btn-primary btn-sm" data-action="pay" data-id="${l.id}">Pay KSh 300</button>
          <a class="btn-secondary btn-sm" href="/listing.html?id=${encodeURIComponent(l.id)}">Preview</a>
          <a class="btn-secondary btn-sm" href="/upload.html?edit=${encodeURIComponent(l.id)}">Edit</a>
          <button class="btn-danger btn-sm" data-action="delete" data-id="${l.id}">Delete</button>
        `;
      } else if (l.status === 'active') {
        actions = `
          <button class="btn-secondary btn-sm" data-action="feature" data-id="${l.id}">Boost — KSh 1,000</button>
          <a class="btn-secondary btn-sm" href="/listing.html?id=${encodeURIComponent(l.id)}">View</a>
          <a class="btn-secondary btn-sm" href="/upload.html?edit=${encodeURIComponent(l.id)}">Edit</a>
          <button class="btn-danger btn-sm" data-action="delete" data-id="${l.id}">Delete</button>
        `;
      } else if (l.status === 'expired') {
        actions = `
          <button class="btn-primary btn-sm" data-action="renew" data-id="${l.id}">Renew — KSh 300</button>
          <a class="btn-secondary btn-sm" href="/upload.html?edit=${encodeURIComponent(l.id)}">Edit</a>
          <button class="btn-danger btn-sm" data-action="delete" data-id="${l.id}">Delete</button>
        `;
      } else {
        actions = `
          <a class="btn-secondary btn-sm" href="/listing.html?id=${encodeURIComponent(l.id)}">View</a>
          <button class="btn-danger btn-sm" data-action="delete" data-id="${l.id}">Delete</button>
        `;
      }

      return `
        <div class="dash-card">
          <div class="dash-card-img">${cover}</div>
          <div class="dash-card-body">
            <div class="dash-card-title">${escapeHtml(l.make)} ${escapeHtml(l.model)}${l.year ? ' · ' + l.year : ''}</div>
            <div class="dash-card-price">${formatKes(l.price_kes)}</div>
            <div class="dash-card-meta">
              <span class="status-badge status-${l.status}">${l.status}</span>
              <span>${escapeHtml(l.location_town)}</span>
              ${l.is_featured ? '<span class="card-tag featured">★ Featured</span>' : ''}
            </div>
            <div class="dash-card-actions">${actions}</div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleDashboardAction(btn.dataset.action, btn.dataset.id));
    });

  } catch (err) {
    container.innerHTML = '<p class="empty">Could not load listings. ' + escapeHtml(err.message) + '</p>';
  }
}

window.deleteAllDrafts = async function() {
  if (!confirm('Are you sure you want to delete ALL your draft listings? This cannot be undone.')) return;
  try {
    const res = await fetch('/api/listings/delete-drafts', { method: 'POST' });
    if (res.ok) {
      loadDashboardListings();
    } else {
      alert('Could not delete drafts.');
    }
  } catch {
    alert('Network error.');
  }
};

async function handleDashboardAction(action, id) {
  if (action === 'delete') {
    if (!confirm('Delete this listing? This cannot be undone.')) return;
    await fetch(`/api/listings/${encodeURIComponent(id)}/delete`, { method: 'POST' });
    loadDashboardListings();
    return;
  }

  if (action === 'renew') {
    const ok = confirm('Renew this listing for KSh 300? Payment will be requested on your phone.');
    if (!ok) return;
    try {
      const res = await fetch('/api/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: id, purpose: 'renewal' })
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Could not start payment.'); return; }
      alert('STK push sent to your phone. Enter your M-Pesa PIN to complete.');
    } catch { alert('Network error.'); }
    return;
  }

  if (action === 'pay') {
    const ok = confirm('Pay KSh 300 to publish this listing? Payment will be requested on your phone.');
    if (!ok) return;
    try {
      const res = await fetch('/api/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: id, purpose: 'standard_listing' })
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Could not start payment.'); return; }
      
      alert('STK push sent. Please enter your M-Pesa PIN.');

      let attempts = 0;
      const maxAttempts = 20; 
      
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const statusRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listing_id: id })
          });
          const statusData = await statusRes.json();
          
          if (statusData.status === 'success') {
            clearInterval(pollInterval);
            alert('Payment confirmed! Your listing is now active.');
            loadDashboardListings();
          } else if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            alert('Payment status check timed out. Please refresh the page in a minute.');
            loadDashboardListings();
          }
        } catch (e) {}
      }, 3000); 

    } catch { alert('Network error.'); }
    return;
  }

  if (action === 'feature') {
    const ok = confirm('Feature this listing for KSh 1,000/month? Payment will be requested on your phone.');
    if (!ok) return;
    try {
      const res = await fetch('/api/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: id, purpose: 'featured_listing' })
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Could not start payment.'); return; }
      alert('STK push sent to your phone. Enter your M-Pesa PIN to complete.');
    } catch { alert('Network error.'); }
    return;
  }
}

// ---------- VERIFY PAGE ----------
async function initVerifyPage() {
  const guest = document.getElementById('verify-guest');
  const already = document.getElementById('verify-already');
  const pending = document.getElementById('verify-pending');
  const form = document.getElementById('verify-form');
  const msg = document.getElementById('verify-msg');

  const user = await getMe();
  if (!user) { guest.classList.remove('hidden'); return; }
  if (user.is_verified) { already.classList.remove('hidden'); return; }

  try {
    const res = await fetch('/api/verify/status');
    const data = await res.json();
    if (data.status === 'pending') { pending.classList.remove('hidden'); return; }
  } catch {}

  form.classList.remove('hidden');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = ''; msg.classList.remove('ok');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Submitting...';

    const formData = new FormData(form);
    const body = {
      business_name: formData.get('business_name'),
      business_location: formData.get('business_location'),
      business_phone: formData.get('business_phone'),
      id_number: formData.get('id_number')
    };

    try {
      const res = await fetch('/api/verify/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) msg.textContent = data.error || 'Could not submit.';
      else { msg.classList.add('ok'); msg.textContent = 'Application submitted. Redirecting...'; setTimeout(() => window.location.href = '/dashboard.html', 900); }
    } catch { msg.textContent = 'Network error.'; }
    finally { btn.disabled = false; btn.textContent = 'Submit for review'; }
  });
}

// ---------- ADMIN ----------
function initAdmin() {
  const denied = document.getElementById('admin-denied');
  const content = document.getElementById('admin-content');

  getMe().then(user => {
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      denied.classList.remove('hidden');
      return;
    }
    content.classList.remove('hidden');

    window.__adminUser = user;

    loadReports();
    loadVerifications();
    loadAllListings();
    loadAllUsers();

    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        ['reports','verifications','listings','users'].forEach(k => {
          document.getElementById('admin-' + k).classList.toggle('hidden', k !== tab.dataset.tab);
        });
      });
    });

    const searchListings = document.getElementById('search-listings');
    const searchUsers = document.getElementById('search-users');
    let listingsTimer, usersTimer;
    searchListings?.addEventListener('input', () => {
      clearTimeout(listingsTimer);
      listingsTimer = setTimeout(() => loadAllListings(searchListings.value.trim()), 250);
    });
    searchUsers?.addEventListener('input', () => {
      clearTimeout(usersTimer);
      usersTimer = setTimeout(() => loadAllUsers(searchUsers.value.trim()), 250);
    });
  }).catch(() => denied.classList.remove('hidden'));
}

async function loadReports() {
  const container = document.getElementById('reports-list');
  try {
    const res = await fetch('/api/admin/reports');
    const data = await res.json();
    const reports = data.reports || [];
    if (reports.length === 0) { container.innerHTML = '<p class="loading">No open reports.</p>'; return; }
    container.innerHTML = reports.map(r => `
      <div class="admin-item">
        <div>
          <strong>${escapeHtml(r.reason)}</strong> — ${escapeHtml(r.make || '')} ${escapeHtml(r.model || '')}<br>
          <small style="color:#777">${escapeHtml(r.details || '')} · ${new Date(r.created_at).toLocaleString()}</small>
        </div>
        <div class="admin-item-actions">
          <a href="/listing.html?id=${encodeURIComponent(r.listing_id)}" target="_blank" class="btn-secondary btn-sm">View</a>
          <button class="danger btn-sm" data-action="hide" data-id="${r.listing_id}">Hide listing</button>
          <button class="btn-sm" data-action="dismiss" data-id="${r.id}">Dismiss & restore</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/admin/reports/${encodeURIComponent(btn.dataset.id)}/${btn.dataset.action}`, { method: 'POST' });
        loadReports();
      });
    });
  } catch { container.innerHTML = '<p class="loading">Could not load reports.</p>'; }
}

async function loadVerifications() {
  const container = document.getElementById('verifications-list');
  try {
    const res = await fetch('/api/admin/verifications');
    const data = await res.json();
    const items = data.verifications || [];
    if (items.length === 0) { container.innerHTML = '<p class="loading">No pending verifications.</p>'; return; }
    container.innerHTML = items.map(v => `
      <div class="admin-item">
        <div>
          <strong>${escapeHtml(v.business_name)}</strong> — ${escapeHtml(v.business_location)}<br>
          <small style="color:#777">${escapeHtml(v.applicant_name)} · ${escapeHtml(v.business_phone)} · ID ${escapeHtml(v.id_number)}</small>
        </div>
        <div class="admin-item-actions">
          <button class="btn-sm" data-action="approve" data-id="${v.id}">Approve</button>
          <button class="danger btn-sm" data-action="reject" data-id="${v.id}">Reject</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/admin/verifications/${encodeURIComponent(btn.dataset.id)}/${btn.dataset.action}`, { method: 'POST' });
        loadVerifications();
      });
    });
  } catch { container.innerHTML = '<p class="loading">Could not load verifications.</p>'; }
}

async function loadAllListings(q = '') {
  const container = document.getElementById('all-listings');
  container.innerHTML = '<p class="loading">Loading listings...</p>';
  try {
    const url = '/api/admin/listings' + (q ? '?q=' + encodeURIComponent(q) : '');
    const res = await fetch(url);
    const data = await res.json();
    const items = data.listings || [];
    if (items.length === 0) { container.innerHTML = '<p class="loading">No listings found.</p>'; return; }
    
    container.innerHTML = items.map(l => {
      const approveBtn = (l.status === 'draft' || l.status === 'hidden')
        ? `<button class="btn-primary btn-sm" data-action="approve" data-id="${l.id}">Approve</button>` 
        : '';
        
      const suspendBtn = l.status === 'active'
        ? `<button class="danger btn-sm" data-action="suspend" data-id="${l.id}">Suspend</button>`
        : '';

      return `
        <div class="admin-item">
          <div>
            <strong>${escapeHtml(l.make)} ${escapeHtml(l.model)}</strong> — ${formatKes(l.price_kes)}<br>
            <small style="color:#777">${escapeHtml(l.seller_name)} · ${escapeHtml(l.seller_phone || '')} · <span class="status-badge status-${l.status}">${l.status}</span> · ${l.is_featured ? '★ Featured' : ''}</small>
          </div>
          <div class="admin-item-actions">
            ${approveBtn}
            ${suspendBtn}
            <a href="/listing.html?id=${encodeURIComponent(l.id)}" target="_blank" class="btn-secondary btn-sm">View</a>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.action === 'approve') {
          if (!confirm('Approve this listing and make it active?')) return;
          await fetch(`/api/admin/listings/${btn.dataset.id}/approve`, { method: 'POST' });
        } else if (btn.dataset.action === 'suspend') {
          if (!confirm('Suspend this listing? It will be hidden from the public.')) return;
          await fetch(`/api/admin/listings/${btn.dataset.id}/suspend`, { method: 'POST' });
        }
        loadAllListings(q); 
      });
    });

  } catch { container.innerHTML = '<p class="loading">Could not load listings.</p>'; }
}

async function loadAllUsers(q = '') {
  const container = document.getElementById('all-users');
  container.innerHTML = '<p class="loading">Loading users...</p>';
  try {
    const url = '/api/admin/users' + (q ? '?q=' + encodeURIComponent(q) : '');
    const res = await fetch(url);
    const data = await res.json();
    const items = data.users || [];
    if (items.length === 0) { container.innerHTML = '<p class="loading">No users found.</p>'; return; }

    const me = window.__adminUser || {};
    const isSuper = me.role === 'super_admin';

    container.innerHTML = items.map(u => {
      const isSelf = u.id === me.id;
      const targetIsAdmin = u.role === 'admin' || u.role === 'super_admin';
      const canModerate = !isSelf && (isSuper || (!targetIsAdmin && u.role !== 'super_admin'));

      let roleActions = '';
      if (isSuper && !isSelf) {
        if (u.role === 'user') {
          roleActions += `<button class="btn-sm" data-action="promote" data-id="${u.id}" data-role="admin">Make admin</button>`;
        } else if (u.role === 'admin') {
          roleActions += `<button class="btn-sm" data-action="demote" data-id="${u.id}" data-role="user">Remove admin</button>`;
        } else if (u.role === 'super_admin') {
          roleActions += `<button class="btn-sm" data-action="demote" data-id="${u.id}" data-role="admin">Demote to admin</button>`;
        }
      }

      let statusActions = '';
      if (canModerate) {
        if (u.status === 'active') {
          statusActions += `<button class="btn-sm danger" data-action="suspend" data-id="${u.id}">Suspend</button>`;
          statusActions += `<button class="btn-sm danger" data-action="ban" data-id="${u.id}">Ban</button>`;
        } else {
          statusActions += `<button class="btn-sm" data-action="activate" data-id="${u.id}">Reactivate</button>`;
        }
      }

      return `
        <div class="admin-item">
          <div>
            <strong>${escapeHtml(u.full_name)}</strong> — ${escapeHtml(u.phone)}<br>
            <small style="color:#777">
              Role: <strong>${escapeHtml(u.role)}</strong>
              · Status: <strong>${escapeHtml(u.status || 'active')}</strong>
              · ${u.is_verified ? 'Verified' : 'Not verified'}
              ${isSelf ? ' · <em>You</em>' : ''}
            </small>
          </div>
          <div class="admin-item-actions">
            ${roleActions}
            ${statusActions}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'promote') {
          if (!confirm('Make this user an admin?')) return;
          await fetch(`/api/admin/users/${id}/role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin' })
          });
        } else if (action === 'demote') {
          const targetRole = btn.dataset.role;
          if (!confirm(`Change this admin's role to "${targetRole}"?`)) return;
          await fetch(`/api/admin/users/${id}/role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: targetRole })
          });
        } else if (action === 'suspend') {
          if (!confirm('Suspend this user? They will be logged out and their listings hidden.')) return;
          await fetch(`/api/admin/users/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'suspended' })
          });
        } else if (action === 'ban') {
          if (!confirm('Ban this user? They will be permanently blocked.')) return;
          await fetch(`/api/admin/users/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'banned' })
          });
        } else if (action === 'activate') {
          await fetch(`/api/admin/users/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' })
          });
        }

        const searchBox = document.getElementById('search-users');
        loadAllUsers(searchBox?.value.trim() || '');
      });
    });
  } catch { container.innerHTML = '<p class="loading">Could not load users.</p>'; }
}