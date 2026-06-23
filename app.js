// ============================================================
// AgriTrack - Agricultural Data Management System
// Data stored in db (with localStorage as local cache)
// ============================================================

// ===== SUPABASE CONFIG =====
// NOTE: This is the public anon key � safe for frontend use.
// Real security is enforced by Supabase Row Level Security (RLS) policies.
// Do NOT replace this with your service_role key.
const SUPABASE_URL = 'https://jnnbtvgobqzdqyafxxvp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpubmJ0dmdvYnF6ZHF5YWZ4eHZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NDA5MzIsImV4cCI6MjA5NTExNjkzMn0.BM16r68FoL3vwRBnenPL4W6rHNKG1MXl0N5kLe4ViFI';
const REST_URL = SUPABASE_URL + '/rest/v1';
// Headers use authToken when available (set by auth.js after login)
function getHeaders() {
  const token = (typeof authToken !== 'undefined' && authToken) ? authToken : SUPABASE_KEY;
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + token,
    'Prefer': 'return=representation'
  };
}
// ===== PRODUCT CATALOG =====
const PRODUCTS = {
  sona: [
    { id: 'sona_neem_urea',   name: 'Sona Neem Coated Urea',  brand: 'Sona (FFC)' },
    { id: 'sona_zinc_urea',   name: 'Sona Zinc Coated Urea',  brand: 'Sona (FFC)' },
    { id: 'sona_boron_dap',   name: 'Sona Boron DAP',         brand: 'Sona (FFC)' }
  ],
  engro: [
    { id: 'engro_generic',    name: 'Engro Product (Generic)', brand: 'Engro' }
  ],
  fatima: [
    { id: 'fatima_generic',   name: 'Sarsabz Product (Generic)', brand: 'Fatima (Sarsabz)' }
  ],
  yara: [
    { id: 'yara_tropicote',   name: 'YaraLiva Tropicote',                  brand: 'Yara International', unit: 'bags'    },
    { id: 'yara_bortrac',     name: 'YaraVita Bortrac',                    brand: 'Yara International', unit: 'bottles' },
    { id: 'yara_cropboost',   name: 'YaraVita Crop Boost',                 brand: 'Yara International', unit: 'bottles' },
    { id: 'yara_frutrel',     name: 'YaraVita Frutrel',                    brand: 'Yara International', unit: 'bottles' },
    { id: 'yara_solatrel',    name: 'YaraVita Solatrel',                   brand: 'Yara International', unit: 'bottles' },
    { id: 'yara_amplix',      name: 'Yara Amplix Optitrac (Biostimulant)', brand: 'Yara International', unit: 'bottles' }
  ]
};

const ALL_PRODUCTS = Object.values(PRODUCTS).flat();
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  'add-farmer': 'Add Farmer',
  farmers: 'Farmers List',
  upload: 'Upload Excel',
  insights: 'Insights',
  nearby: 'Nearby Farmers'
};

// ===== STATE =====
let farmers = [];
let pendingUploadData = [];
let mapInstance = null;
let mapMarker = null;
let chartInstances = {};
let currentPage = 'dashboard';

// ===== STORAGE (db + localStorage cache) =====

// Map app farmer object ? db row
function farmerToRow(f) {
  // Ensure user_id is always the current user — never null if logged in
  const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.id)
    ? currentUser.id
    : (typeof authToken !== 'undefined' && authToken
        ? (() => { try { return JSON.parse(atob(authToken.split('.')[1])).sub; } catch(e) { return null; } })()
        : null);
  return {
    id: f.id,
    name: f.name,
    contact: f.contact,
    dealer: f.dealer,
    land_area: f.landArea,
    crops: f.crops,
    village: f.village || null,
    tehsil: f.tehsil || null,
    district: f.district || null,
    province: f.province || null,
    lat: f.lat || null,
    lng: f.lng || null,
    products: f.products || [],
    date: f.date,
    user_id: uid
  };
}

// Map db row → app farmer object
function rowToFarmer(r) {
  // Defensively parse products — Supabase jsonb can sometimes come back
  // as a string if the column type or PostgREST config differs
  let products = r.products || [];
  if (typeof products === 'string') {
    try { products = JSON.parse(products); } catch(e) { products = []; }
  }
  if (!Array.isArray(products)) products = [];

  let crops = r.crops || [];
  if (typeof crops === 'string') {
    try { crops = JSON.parse(crops); } catch(e) { crops = crops.split(',').map(c => c.trim()).filter(Boolean); }
  }
  if (!Array.isArray(crops)) crops = [];

  return {
    id: r.id,
    name: r.name,
    contact: r.contact,
    dealer: r.dealer,
    landArea: r.land_area,
    crops,
    village: r.village || '',
    tehsil: r.tehsil || '',
    district: r.district || '',
    province: r.province || '',
    lat: r.lat,
    lng: r.lng,
    products,
    date: r.date
  };
}

// ===== SUPABASE REST HELPERS =====
async function sbFetch(path, method, body) {
  try {
    const opts = { method, headers: getHeaders() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(REST_URL + path, opts);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      console.error('[Supabase] HTTP ' + res.status, data);
      return { data: null, error: data };
    }
    return { data, error: null };
  } catch(e) {
    console.error('[Supabase] fetch exception:', e.message);
    return { data: null, error: { message: e.message } };
  }
}

// Save a single farmer (upsert by id)
// ===== PENDING SYNC QUEUE =====
// Stores farmer IDs that failed to save to Supabase so they retry automatically
const PENDING_KEY = 'agritrack_pending_sync';

function getPendingIds() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch(e) { return []; }
}
function addPending(id) {
  const ids = getPendingIds();
  if (!ids.includes(id)) { ids.push(id); localStorage.setItem(PENDING_KEY, JSON.stringify(ids)); }
  updateSyncIndicator();
}
function removePending(id) {
  const ids = getPendingIds().filter(x => x !== id);
  localStorage.setItem(PENDING_KEY, JSON.stringify(ids));
  updateSyncIndicator();
}

function updateSyncIndicator() {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  const count = getPendingIds().length;
  if (count > 0) {
    el.textContent = `⚠️ ${count} record${count > 1 ? 's' : ''} not yet synced — tap to retry`;
    el.classList.remove('hidden');
    el.onclick = () => flushPendingSync();
  } else {
    el.classList.add('hidden');
    el.onclick = null;
  }
}

async function flushPendingSync() {
  const ids = getPendingIds();
  if (!ids.length) return;
  console.log('[Sync] Retrying', ids.length, 'pending saves…');
  for (const id of ids) {
    const f = farmers.find(x => x.id === id);
    if (!f) { removePending(id); continue; }
    try {
      await saveFarmer(f);
      console.log('[Sync] Flushed:', f.name);
    } catch(e) {
      console.error('[Sync] Failed for:', f.name, e);
    }
  }
  const remaining = getPendingIds().length;
  if (remaining === 0) showToast('✅ All pending data synced!', 'success');
  else showToast(`⚠️ ${remaining} record(s) still pending.`, 'error');
}

async function saveFarmer(farmer) {
  // Always save to localStorage first — data is NEVER lost locally
  localStorage.setItem('agritrack_farmers', JSON.stringify(farmers));

  const row = farmerToRow(farmer);
  console.log('[Save] Farmer:', row.name, '| user_id:', row.user_id, '| products:', row.products.length);

  if (!row.user_id) {
    console.warn('[Save] user_id is null — will try anyway but RLS may block it');
  }

  // Try PATCH first for existing records (most reliable for updates)
  // PATCH only updates what you send — no conflict issues
  const isExisting = farmers.some(f => f.id === farmer.id && f !== farmer) ||
    (await (async () => {
      // Quick existence check
      const chk = await fetch(REST_URL + '/farmers?id=eq.' + encodeURIComponent(farmer.id) + '&select=id', {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + (typeof authToken !== 'undefined' && authToken ? authToken : SUPABASE_KEY)
        }
      });
      const chkData = await chk.json().catch(() => []);
      return Array.isArray(chkData) && chkData.length > 0;
    })());

  if (isExisting) {
    // Record exists — use PATCH to update all fields
    const patchRes = await fetch(REST_URL + '/farmers?id=eq.' + encodeURIComponent(farmer.id), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + (typeof authToken !== 'undefined' && authToken ? authToken : SUPABASE_KEY),
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(row)
    });
    const patchText = await patchRes.text();
    let patchData = null;
    try { patchData = JSON.parse(patchText); } catch(e) {}

    if (!patchRes.ok) {
      console.error('[Save] PATCH failed:', patchRes.status, patchText);
      addPending(farmer.id);
      showToast('⚠️ Saved locally — cloud sync failed (' + patchRes.status + '). Tap ⚠️ to retry.', 'error');
      return;
    }
    const saved = Array.isArray(patchData) ? patchData[0] : patchData;
    console.log('%c[Save] PATCH OK | products in DB:', 'color:green;font-weight:bold',
      saved && Array.isArray(saved.products) ? saved.products.length : '?');
  } else {
    // New record — use POST/INSERT
    const insertRes = await fetch(REST_URL + '/farmers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + (typeof authToken !== 'undefined' && authToken ? authToken : SUPABASE_KEY),
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(row)
    });
    const insertText = await insertRes.text();
    if (!insertRes.ok) {
      console.error('[Save] INSERT failed:', insertRes.status, insertText);
      addPending(farmer.id);
      showToast('⚠️ Saved locally — cloud sync failed (' + insertRes.status + '). Tap ⚠️ to retry.', 'error');
      return;
    }
    console.log('%c[Save] INSERT OK', 'color:green;font-weight:bold');
  }

  removePending(farmer.id);
  showToast('✅ Saved and synced!', 'success');
}

// Save all farmers (bulk upsert)
async function saveFarmers() {
  localStorage.setItem('agritrack_farmers', JSON.stringify(farmers));
  if (!farmers.length) return;
  const rows = farmers.map(farmerToRow);
  console.log('[Supabase] Bulk saving', rows.length, 'farmers');
  const { data, error } = await sbFetch('/farmers?on_conflict=id', 'POST', rows);
  if (error) {
    console.error('[Supabase] Bulk save error:', error);
    // Queue all as pending
    farmers.forEach(f => addPending(f.id));
    showToast('⚠️ Saved locally. Will sync to cloud when connection is restored.', 'error');
  } else {
    farmers.forEach(f => removePending(f.id));
    console.log('%c[Supabase] Bulk save OK', 'color:green;font-weight:bold');
  }
}

// Delete a farmer
async function deleteFarmerFromDB(id) {
  const { error } = await sbFetch('/farmers?id=eq.' + encodeURIComponent(id), 'DELETE');
  if (error) {
    console.error('[Supabase] Delete error:', error);
  } else {
    console.log('[Supabase] Deleted id:', id);
  }
}

// Load all farmers
async function loadFarmers() {
  // Serve cached data instantly so UI shows while Supabase loads
  try {
    const cached = JSON.parse(localStorage.getItem('agritrack_farmers') || '[]');
    if (cached.length) {
      farmers = cached;
      farmers.sort((a, b) => {
        const dateDiff = new Date(a.date) - new Date(b.date);
        if (dateDiff !== 0) return dateDiff;
        return (a.id || '').localeCompare(b.id || ''); // secondary sort by id preserves import order
      });
    }
  } catch(e) {}

  console.log('[Supabase] Loading farmers...');
  const res = await fetch(REST_URL + '/farmers?order=date.asc,id.asc', {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + (typeof authToken !== 'undefined' && authToken ? authToken : SUPABASE_KEY),
      'Content-Type': 'application/json'
    }
  });

  const text = await res.text();
  if (!res.ok) {
    console.error('[Load] HTTP', res.status, text);
    console.log('[Cache] Using', farmers.length, 'farmers from localStorage');
    return;
  }

  let data = [];
  try { data = JSON.parse(text) || []; } catch(e) {}

  farmers = data.map(rowToFarmer);
  const withProducts = farmers.filter(f => f.products && f.products.length > 0).length;
  console.log('%c[Supabase] Loaded ' + farmers.length + ' farmers (' + withProducts + ' with products)', 'color:green;font-weight:bold');

  // Diagnostic: check for rows with missing user_id
  const nullUid = data.filter(r => !r.user_id).length;
  if (nullUid > 0) {
    console.warn('[Diagnostic] ' + nullUid + ' rows have NULL user_id — these will fail RLS on update!');
    console.warn('[Diagnostic] Run this in Supabase SQL Editor: UPDATE public.farmers SET user_id = auth.uid() WHERE user_id IS NULL;');
  }

  localStorage.setItem('agritrack_farmers', JSON.stringify(farmers));
}
// ===== TOAST =====
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// ===== NAVIGATION =====
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector('[data-page="' + page + '"]');
  if (navEl) navEl.classList.add('active');
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;
  currentPage = page;
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  const sidebarOverlay = document.querySelector('.sidebar-overlay');
  if (sidebarOverlay) sidebarOverlay.classList.remove('show');
  // Page-specific init
  if (page === 'dashboard') renderDashboard();
  if (page === 'farmers') { applyFilters(); populateFilterDropdowns(); }
  if (page === 'add-farmer') initMap();
  if (page === 'nearby') { initNearbyMap(); }
}

// ===== SIDEBAR MOBILE =====
function initSidebar() {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    overlay.classList.toggle('show');
  });
  overlay.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    overlay.classList.remove('show');
  });
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });
}

// ===== MAP PICKER =====
function initMap() {
  if (mapInstance) { mapInstance.invalidateSize(); return; }
  const defaultLat = 30.3753, defaultLng = 69.3451; // Pakistan center
  mapInstance = L.map('mapPicker').setView([defaultLat, defaultLng], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '? OpenStreetMap contributors'
  }).addTo(mapInstance);
  mapInstance.on('click', function(e) {
    const { lat, lng } = e.latlng;
    document.getElementById('latitude').value = lat.toFixed(6);
    document.getElementById('longitude').value = lng.toFixed(6);
    if (mapMarker) mapMarker.setLatLng(e.latlng);
    else mapMarker = L.marker(e.latlng).addTo(mapInstance);
  });
}

function setMapMarker(lat, lng) {
  if (!mapInstance) return;
  const latlng = L.latLng(lat, lng);
  mapInstance.setView(latlng, 10);
  if (mapMarker) mapMarker.setLatLng(latlng);
  else mapMarker = L.marker(latlng).addTo(mapInstance);
}

// ===== PRODUCT FORM RENDERING =====
function renderProductInputs() {
  Object.entries(PRODUCTS).forEach(([brand, products]) => {
    const container = document.getElementById(brand + 'Products');
    if (!container) return;
    container.innerHTML = products.map(p => {
      const unit = p.unit || 'bags';
      const label = unit.charAt(0).toUpperCase() + unit.slice(1); // "Bags" or "Bottles"
      return `
      <div class="product-row" data-product-id="${p.id}" data-unit="${unit}">
        <span class="product-name">${p.name}</span>
        <label>${label}:</label>
        <input type="number" class="prod-bags" data-id="${p.id}" min="0" placeholder="0" />
        <label>Dealer:</label>
        <input type="text" class="prod-dealer" data-id="${p.id}" placeholder="Dealer name" />
      </div>
    `}).join('');
  });
}

function getProductData() {
  const data = [];
  document.querySelectorAll('.product-row').forEach(row => {
    const id = row.dataset.productId;
    const unit = row.dataset.unit || 'bags';
    const qty = parseInt(row.querySelector('.prod-bags').value) || 0;
    const dealer = row.querySelector('.prod-dealer').value.trim();
    if (qty > 0) {
      const prod = ALL_PRODUCTS.find(p => p.id === id);
      data.push({ id, name: prod ? prod.name : id, brand: prod ? prod.brand : '', bags: qty, unit, dealer });
    }
  });
  return data;
}

function setProductData(products) {
  document.querySelectorAll('.product-row').forEach(row => {
    const id = row.dataset.productId;
    const entry = (products || []).find(p => p.id === id);
    row.querySelector('.prod-bags').value = entry ? entry.bags : '';
    row.querySelector('.prod-dealer').value = entry ? entry.dealer : '';
  });
}

// ===== DUMMY DATA FILL =====
function fillDummyData() {
  const names    = ['Muhammad Aslam', 'Ghulam Hussain', 'Abdul Razzaq', 'Tariq Mehmood', 'Zulfiqar Ali',
                    'Nasir Iqbal', 'Sajid Mahmood', 'Imran Khan', 'Khalid Pervez', 'Bashir Ahmad',
                    'Liaqat Ali', 'Rana Tahir', 'Asif Javed', 'Shahbaz Ahmad', 'Faisal Mehmood'];
  const contacts = ['0300-1234567', '0312-9876543', '0333-4561234', '0345-7890123', '0321-6543210',
                    '0311-2345678', '0301-8765432', '0344-3456789', '0322-5678901', '0313-4321098',
                    '0307-1112223', '0318-5556667', '0336-7778889', '0349-0001112', '0302-3334445'];
  const dealers  = ['Chaudhry Agri Store', 'Al-Madina Fertilizer', 'Pak Kissan Center',
                    'Green Field Traders', 'Rehman Agri Depot', 'Zafar & Co.', 'Tariq Fertilizers',
                    'Khan Brothers Agri', 'Bismillah Agro', 'Master Fertilizer'];
  const villages = ['Chak 45/WB', 'Chak 12/EB', 'Mauza Khanpur', 'Chak 88/ML', 'Basti Malook',
                    'Chak 33/WB', 'Mauza Tibba', 'Chak 101/EB', 'Basti Ahmad Pur', 'Chak 56/ML'];
  const tehsils  = ['Vehari', 'Multan', 'Sahiwal', 'Bahawalpur', 'Lodhran',
                    'Mailsi', 'Burewala', 'Khanewal', 'Pakpattan', 'Chishtian'];
  const districts= ['Vehari', 'Multan', 'Sahiwal', 'Bahawalpur', 'Lodhran',
                    'Khanewal', 'Pakpattan', 'Bahawalnagar', 'Okara', 'Faisalabad'];
  const provinces= ['Punjab', 'Punjab', 'Punjab', 'Sindh', 'KPK'];
  const cropSets = [
    ['Wheat', 'Cotton'],
    ['Rice', 'Sugarcane'],
    ['Maize', 'Wheat', 'Sunflower'],
    ['Cotton', 'Sunflower', 'Raya'],
    ['Wheat', 'Potato', 'Vegetables'],
    ['Wheat', 'Maize', 'Onion'],
    ['Rice', 'Wheat', 'Garlic'],
    ['Cotton', 'Tomato', 'Chilli'],
    ['Sugarcane', 'Wheat'],
    ['Maize', 'Raya', 'Garlic']
  ];
  const customCropOptions = [
    ['Mung', 'Moong'],
    ['Lentil', 'Mash'],
    ['Soybean'],
    ['Sesame', 'Til'],
    []
  ];
  const gpsPoints = [
    { lat: 30.0444, lng: 72.3512 }, // Vehari
    { lat: 30.1978, lng: 71.4681 }, // Multan
    { lat: 30.6706, lng: 73.1069 }, // Sahiwal
    { lat: 29.3956, lng: 71.6836 }, // Bahawalpur
    { lat: 29.5349, lng: 71.6365 }, // Lodhran
    { lat: 30.2083, lng: 72.1917 }, // Mailsi
    { lat: 30.1667, lng: 72.6833 }, // Burewala
    { lat: 30.3019, lng: 71.9239 }, // Khanewal
  ];

  const r    = n => Math.floor(Math.random() * n);
  const pick = arr => arr[r(arr.length)];

  // ── Basic fields ──────────────────────────────────────────
  document.getElementById('farmerName').value    = pick(names);
  document.getElementById('contactNumber').value = pick(contacts);
  document.getElementById('dealerName').value    = pick(dealers);
  document.getElementById('landArea').value      = (r(191) + 10) / 10; // 1.0–20.0 acres

  // ── Location ──────────────────────────────────────────────
  document.getElementById('villageName').value  = pick(villages);
  const tehIdx = r(tehsils.length);
  document.getElementById('tehsilName').value   = tehsils[tehIdx];
  document.getElementById('districtName').value = districts[tehIdx] || pick(districts);
  document.getElementById('provinceName').value = pick(provinces);

  // ── GPS coordinates with small random offset ──────────────
  const gps = pick(gpsPoints);
  const lat  = gps.lat + (Math.random() - 0.5) * 0.2;
  const lng  = gps.lng + (Math.random() - 0.5) * 0.2;
  document.getElementById('latitude').value  = lat.toFixed(6);
  document.getElementById('longitude').value = lng.toFixed(6);
  if (typeof mapInstance !== 'undefined' && mapInstance) setMapMarker(lat, lng);

  // ── Crops (predefined checkboxes) ─────────────────────────
  const chosenCrops = pick(cropSets);
  setSelectedCrops(chosenCrops);

  // ── Custom crops ──────────────────────────────────────────
  customCrops = pick(customCropOptions).slice(); // may be empty
  renderCustomCropTags();

  // ── Fertilizer products — fill ALL products with bags + dealer
  document.querySelectorAll('.product-row .prod-bags').forEach(i => i.value = '');
  document.querySelectorAll('.product-row .prod-dealer').forEach(i => i.value = '');

  // Pick 2–4 products to fill (always include at least one Sona product)
  const sonaProds  = ALL_PRODUCTS.filter(p => p.brand.includes('Sona'));
  const otherProds = ALL_PRODUCTS.filter(p => !p.brand.includes('Sona'));
  const numOther   = r(3) + 1; // 1–3 other products
  const chosen = [
    pick(sonaProds),
    ...otherProds.sort(() => Math.random() - 0.5).slice(0, numOther)
  ];
  const prodDealer = pick(dealers);
  chosen.forEach(prod => {
    const bagsEl   = document.querySelector(`.prod-bags[data-id="${prod.id}"]`);
    const dealerEl = document.querySelector(`.prod-dealer[data-id="${prod.id}"]`);
    if (bagsEl)   bagsEl.value   = r(20) + 1;      // 1–20 bags/bottles
    if (dealerEl) dealerEl.value = prodDealer;
  });
}

// ===== FORM HANDLING =====
function resetForm() {
  document.getElementById('farmerForm').reset();
  document.getElementById('editFarmerId').value = '';
  document.getElementById('submitFormBtn').textContent = '💾 Save Farmer';
  document.querySelectorAll('.product-row .prod-bags').forEach(i => i.value = '');
  document.querySelectorAll('.product-row .prod-dealer').forEach(i => i.value = '');
  customCrops = [];
  renderCustomCropTags();
  if (mapMarker) { mapMarker.remove(); mapMarker = null; }
}
// ===== CUSTOM CROPS =====
let customCrops = [];

function renderCustomCropTags() {
  const container = document.getElementById('customCropsTags');
  if (!customCrops.length) { container.innerHTML = ''; return; }
  container.innerHTML = customCrops.map((crop, i) => `
    <span class="custom-crop-tag">
      🌱 ${escHtml(crop)}
      <button type="button" onclick="removeCustomCrop(${i})" title="Remove">✕</button>
    </span>
  `).join('');
}

function addCustomCrop() {
  const input = document.getElementById('customCropInput');
  const crop = input.value.trim();
  if (!crop) { showToast('Enter a crop name', 'error'); return; }
  if (customCrops.includes(crop)) { showToast('Crop already added', 'error'); return; }
  customCrops.push(crop);
  input.value = '';
  renderCustomCropTags();
}

function removeCustomCrop(index) {
  customCrops.splice(index, 1);
  renderCustomCropTags();
}

function getSelectedCrops() {
  const checked = Array.from(document.querySelectorAll('#cropPatternGroup input:checked')).map(c => c.value);
  return [...checked, ...customCrops];
}

function setSelectedCrops(crops) {
  if (!crops) crops = [];
  // Predefined crops
  const predefined = ['Wheat','Rice','Cotton','Sugarcane','Maize','Sunflower','Potato','Raya','Vegetables','Fruits','Onion','Garlic','Tomato','Chilli'];
  document.querySelectorAll('#cropPatternGroup input').forEach(cb => {
    cb.checked = crops.includes(cb.value);
  });
  // Custom crops (anything not in predefined list)
  customCrops = crops.filter(c => !predefined.includes(c));
  renderCustomCropTags();
}

function validateForm() {
  const name = document.getElementById('farmerName').value.trim();
  const contact = document.getElementById('contactNumber').value.trim();
  const dealer = document.getElementById('dealerName').value.trim();
  const land = document.getElementById('landArea').value;
  const district = document.getElementById('districtName').value.trim();
  const crops = getSelectedCrops();
  if (!name) { showToast('Farmer name is required', 'error'); return false; }
  if (!contact) { showToast('Contact number is required', 'error'); return false; }
  if (!dealer) { showToast('Dealer name is required', 'error'); return false; }
  if (!land || parseFloat(land) <= 0) { showToast('Valid land area is required', 'error'); return false; }
  if (!district) { showToast('District is required', 'error'); return false; }
  if (crops.length === 0) { showToast('Select at least one crop pattern', 'error'); return false; }
  return true;
}

async function handleFormSubmit(e) {
  e.preventDefault();
  if (!validateForm()) return;
  const editId = document.getElementById('editFarmerId').value;
  const farmer = {
    id: editId || 'f_' + Date.now(),
    name: document.getElementById('farmerName').value.trim(),
    contact: document.getElementById('contactNumber').value.trim(),
    dealer: document.getElementById('dealerName').value.trim(),
    landArea: parseFloat(document.getElementById('landArea').value),
    crops: getSelectedCrops(),
    village: document.getElementById('villageName').value.trim(),
    tehsil: document.getElementById('tehsilName').value.trim(),
    district: document.getElementById('districtName').value.trim(),
    province: document.getElementById('provinceName').value,
    lat: parseFloat(document.getElementById('latitude').value) || null,
    lng: parseFloat(document.getElementById('longitude').value) || null,
    products: getProductData(),
    date: editId ? (farmers.find(f => f.id === editId)?.date || new Date().toISOString()) : new Date().toISOString()
  };
  if (editId) {
    const idx = farmers.findIndex(f => f.id === editId);
    if (idx !== -1) farmers[idx] = farmer;
  } else {
    farmers.push(farmer);
  }
  // Re-sort to match Supabase's date.asc,id.asc order so the table position is stable
  farmers.sort((a, b) => {
    const dateDiff = new Date(a.date) - new Date(b.date);
    if (dateDiff !== 0) return dateDiff;
    return (a.id || '').localeCompare(b.id || '');
  });
  const submitBtn = document.getElementById('submitFormBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = '? Saving?';
  await saveFarmer(farmer);
  submitBtn.disabled = false;
  showToast(editId ? 'Farmer record updated!' : 'Farmer saved successfully!', 'success');
  resetForm();
  navigateTo('farmers');
}

// ===== FARMERS TABLE =====
let selectedFarmerIds = new Set();

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const count = selectedFarmerIds.size;
  if (count > 0) {
    bar.classList.remove('hidden');
    document.getElementById('bulkCount').textContent = count + ' selected';
  } else {
    bar.classList.add('hidden');
  }
  const allChk = document.getElementById('selectAllChk');
  if (!allChk) return;
  const rowChks = document.querySelectorAll('.row-chk');
  if (rowChks.length && count === rowChks.length) {
    allChk.checked = true; allChk.indeterminate = false;
  } else if (count === 0) {
    allChk.checked = false; allChk.indeterminate = false;
  } else {
    allChk.checked = false; allChk.indeterminate = true;
  }
}

function renderFarmersTable(data) {
  const tbody = document.getElementById('farmersTableBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-state">No farmers found.</td></tr>';
    updateBulkBar();
    return;
  }
  tbody.innerHTML = data.map((f, i) => {
    const villageTehsil = [f.village, f.tehsil].filter(Boolean).join(', ') || '\u2014';
    const district = f.district || '\u2014';
    const crops = (f.crops || []).map(c => `<span class="badge badge-green">${c}</span>`).join('');
    const date = f.date ? new Date(f.date).toLocaleDateString('en-PK') : '\u2014';
    const checked = selectedFarmerIds.has(f.id) ? 'checked' : '';

    // Location cell
    const hasGps = f.lat && f.lng;
    const locationCell = hasGps
      ? `<a class="gps-link" href="https://www.google.com/maps?q=${f.lat},${f.lng}" target="_blank" rel="noopener" title="Open in Google Maps">
           📍 <span class="gps-coords">${parseFloat(f.lat).toFixed(4)}, ${parseFloat(f.lng).toFixed(4)}</span>
         </a>`
      : '<span class="gps-none">—</span>';

    // Product summary: show each product with bags and its dealer
    const products = (f.products || []).filter(p => p.bags > 0);
    const productSummary = products.length
      ? products.map(p => {
          const unit = p.unit || 'bags';
          const dealerTag = p.dealer ? ` <span class="prod-dealer-tag">${escHtml(p.dealer)}</span>` : '';
          return `<div class="prod-summary-row"><span class="prod-summary-name">${escHtml(p.name)}</span><span class="prod-summary-qty">${p.bags} ${unit}</span>${dealerTag}</div>`;
        }).join('')
      : '<span style="color:#bbb;font-size:0.78rem">—</span>';

    return `<tr class="${selectedFarmerIds.has(f.id) ? 'row-selected' : ''}">
      <td><input type="checkbox" class="row-chk" data-id="${f.id}" ${checked} /></td>
      <td>${i + 1}</td>
      <td data-label="Name"><strong>${escHtml(f.name)}</strong></td>
      <td data-label="Contact">${escHtml(f.contact)}</td>
      <td data-label="Village/Tehsil" style="font-size:0.82rem">${escHtml(villageTehsil)}</td>
      <td data-label="District" style="font-size:0.82rem">${escHtml(district)}</td>
      <td data-label="Location" class="location-cell">${locationCell}</td>
      <td data-label="Land (Ac)">${f.landArea || '\u2014'}</td>
      <td data-label="Crops">${crops}</td>
      <td data-label="Products" class="products-cell">${productSummary}</td>
      <td data-label="Dealer">${escHtml(f.dealer)}</td>
      <td data-label="Date">${date}</td>
      <td data-label="Actions">
        <div class="action-btns">
          <button class="btn btn-outline btn-sm" onclick="viewFarmer('${f.id}')">&#128065; View</button>
          <button class="btn btn-outline btn-sm" onclick="editFarmer('${f.id}')">&#9999;&#65039;</button>
          <button class="btn btn-danger btn-sm" onclick="deleteFarmer('${f.id}')">&#128465;&#65039;</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Wire row checkboxes
  document.querySelectorAll('.row-chk').forEach(chk => {
    chk.addEventListener('change', function() {
      const id = this.dataset.id;
      if (this.checked) {
        selectedFarmerIds.add(id);
        this.closest('tr').classList.add('row-selected');
      } else {
        selectedFarmerIds.delete(id);
        this.closest('tr').classList.remove('row-selected');
      }
      updateBulkBar();
    });
  });

  updateBulkBar();
}
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function viewFarmer(id) {
  const f = farmers.find(f => f.id === id);
  if (!f) return;
  const loc = (f.lat && f.lng) ? `${f.lat}, ${f.lng}` : 'Not set';
  const crops = (f.crops || []).join(', ') || '—';
  const prodRows = (f.products || []).map(p => {
    const unit = p.unit || 'bags';
    const qtyLabel = unit.charAt(0).toUpperCase() + unit.slice(1);
    return `<tr><td>${escHtml(p.name)}</td><td>${escHtml(p.brand)}</td><td>${p.bags} ${qtyLabel}</td><td>${escHtml(p.dealer)}</td></tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:#999">No products recorded</td></tr>';
  document.getElementById('modalTitle').textContent = f.name;
  document.getElementById('modalBody').innerHTML = `
    <div class="detail-row"><span class="detail-label">Contact:</span><span class="detail-value">${escHtml(f.contact)}</span></div>
    <div class="detail-row"><span class="detail-label">Dealer:</span><span class="detail-value">${escHtml(f.dealer)}</span></div>
    <div class="detail-row"><span class="detail-label">Land Area:</span><span class="detail-value">${f.landArea} Acres</span></div>
    <div class="detail-row"><span class="detail-label">Crops:</span><span class="detail-value">${escHtml(crops)}</span></div>
    <div class="detail-row"><span class="detail-label">Village / Mauza:</span><span class="detail-value">${escHtml(f.village || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Tehsil:</span><span class="detail-value">${escHtml(f.tehsil || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">District:</span><span class="detail-value">${escHtml(f.district || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Province:</span><span class="detail-value">${escHtml(f.province || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">GPS Location:</span><span class="detail-value">${escHtml(loc)}</span></div>
    <div class="detail-row"><span class="detail-label">Date Added:</span><span class="detail-value">${f.date ? new Date(f.date).toLocaleString('en-PK') : '—'}</span></div>
    <h4 style="margin:16px 0 8px;color:#0a1172">Fertilizer Usage</h4>
    <table class="fertilizer-table">
      <thead><tr><th>Product</th><th>Brand</th><th>Quantity</th><th>Dealer</th></tr></thead>
      <tbody>${prodRows}</tbody>
    </table>`;
  document.getElementById('modalOverlay').classList.remove('hidden');
}

function editFarmer(id) {
  const f = farmers.find(f => f.id === id);
  if (!f) return;
  navigateTo('add-farmer');
  setTimeout(() => {
    document.getElementById('editFarmerId').value = f.id;
    document.getElementById('farmerName').value = f.name;
    document.getElementById('contactNumber').value = f.contact;
    document.getElementById('dealerName').value = f.dealer;
    document.getElementById('landArea').value = f.landArea;
    document.getElementById('villageName').value = f.village || '';
    document.getElementById('tehsilName').value = f.tehsil || '';
    document.getElementById('districtName').value = f.district || '';
    document.getElementById('provinceName').value = f.province || '';
    document.getElementById('latitude').value = f.lat || '';
    document.getElementById('longitude').value = f.lng || '';
    setSelectedCrops(f.crops);
    setProductData(f.products);
    document.getElementById('submitFormBtn').textContent = '💾 Update Farmer';
    if (f.lat && f.lng) setMapMarker(f.lat, f.lng);
  }, 100);
}

async function deleteFarmer(id) {
  if (!confirm('Delete this farmer record? This cannot be undone.')) return;
  farmers = farmers.filter(f => f.id !== id);
  localStorage.setItem('agritrack_farmers', JSON.stringify(farmers));
  renderFarmersTable(farmers);
  await deleteFarmerFromDB(id);
  showToast('Farmer deleted.', 'success');
}

// ===== SEARCH & ADVANCED FILTERS =====
let activeFilters = { q: '', district: '', province: '', crop: '', dealer: '', dateFrom: '', dateTo: '' };

function populateFilterDropdowns() {
  const districts = [...new Set(farmers.map(f => f.district).filter(Boolean))].sort();
  const dealers   = [...new Set(farmers.map(f => f.dealer).filter(Boolean))].sort();
  const crops     = [...new Set(farmers.flatMap(f => f.crops || []))].sort();

  const distSel   = document.getElementById('filterDistrict');
  const dealerSel = document.getElementById('filterDealer');
  const cropSel   = document.getElementById('filterCrop');

  const prev = { d: distSel.value, dl: dealerSel.value, c: cropSel.value };

  distSel.innerHTML   = '<option value="">All Districts</option>'  + districts.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  dealerSel.innerHTML = '<option value="">All Dealers</option>'    + dealers.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');
  cropSel.innerHTML   = '<option value="">All Crops</option>'      + crops.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('');

  // Restore previous selections
  distSel.value   = prev.d;
  dealerSel.value = prev.dl;
  cropSel.value   = prev.c;
}

function applyFilters() {
  const q        = activeFilters.q.toLowerCase();
  const district = activeFilters.district;
  const province = activeFilters.province;
  const crop     = activeFilters.crop;
  const dealer   = activeFilters.dealer;
  const dateFrom = activeFilters.dateFrom ? new Date(activeFilters.dateFrom) : null;
  const dateTo   = activeFilters.dateTo   ? new Date(activeFilters.dateTo + 'T23:59:59') : null;

  const result = farmers.filter(f => {
    if (q && !f.name.toLowerCase().includes(q) && !f.contact.toLowerCase().includes(q)) return false;
    if (district && f.district !== district) return false;
    if (province && f.province !== province) return false;
    if (crop && !(f.crops || []).includes(crop)) return false;
    if (dealer && f.dealer !== dealer) return false;
    if (dateFrom && (!f.date || new Date(f.date) < dateFrom)) return false;
    if (dateTo   && (!f.date || new Date(f.date) > dateTo))   return false;
    return true;
  });

  renderFarmersTable(result);

  // Update result count
  const total = farmers.length;
  const shown = result.length;
  document.getElementById('filterResultCount').textContent =
    shown === total ? `Showing all ${total} farmers` : `Showing ${shown} of ${total} farmers`;

  // Update badge
  const activeCount = [district, province, crop, dealer, activeFilters.dateFrom, activeFilters.dateTo].filter(Boolean).length;
  const badge = document.getElementById('filterBadge');
  if (activeCount > 0) {
    badge.textContent = activeCount;
    badge.classList.remove('hidden');
    document.getElementById('clearFiltersBtn').style.display = '';
  } else {
    badge.classList.add('hidden');
    document.getElementById('clearFiltersBtn').style.display = 'none';
  }
}

function resetFilters() {
  activeFilters = { q: '', district: '', province: '', crop: '', dealer: '', dateFrom: '', dateTo: '' };
  document.getElementById('searchInput').value    = '';
  document.getElementById('filterDistrict').value = '';
  document.getElementById('filterProvince').value = '';
  document.getElementById('filterCrop').value     = '';
  document.getElementById('filterDealer').value   = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value   = '';
  applyFilters();
}

function initSearch() {
  // Live text search
  document.getElementById('searchInput').addEventListener('input', function() {
    activeFilters.q = this.value.trim();
    applyFilters();
  });

  // Toggle filter panel
  document.getElementById('toggleFiltersBtn').addEventListener('click', function() {
    const panel = document.getElementById('advFilterPanel');
    const isHidden = panel.classList.toggle('hidden');
    this.style.background = isHidden ? '' : 'var(--primary)';
    this.style.color = isHidden ? '' : '#fff';
    if (!isHidden) populateFilterDropdowns();
  });

  // Clear all filters (top bar button)
  document.getElementById('clearFiltersBtn').addEventListener('click', function() {
    resetFilters();
    // Close panel
    document.getElementById('advFilterPanel').classList.add('hidden');
    document.getElementById('toggleFiltersBtn').style.background = '';
    document.getElementById('toggleFiltersBtn').style.color = '';
  });

  // Apply button
  document.getElementById('applyFiltersBtn').addEventListener('click', function() {
    activeFilters.district = document.getElementById('filterDistrict').value;
    activeFilters.province = document.getElementById('filterProvince').value;
    activeFilters.crop     = document.getElementById('filterCrop').value;
    activeFilters.dealer   = document.getElementById('filterDealer').value;
    activeFilters.dateFrom = document.getElementById('filterDateFrom').value;
    activeFilters.dateTo   = document.getElementById('filterDateTo').value;
    applyFilters();
  });

  // Reset button inside panel
  document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);

  // Live filter on dropdown change (no need to click Apply)
  ['filterDistrict','filterProvince','filterCrop','filterDealer','filterDateFrom','filterDateTo'].forEach(id => {
    document.getElementById(id).addEventListener('change', function() {
      activeFilters.district = document.getElementById('filterDistrict').value;
      activeFilters.province = document.getElementById('filterProvince').value;
      activeFilters.crop     = document.getElementById('filterCrop').value;
      activeFilters.dealer   = document.getElementById('filterDealer').value;
      activeFilters.dateFrom = document.getElementById('filterDateFrom').value;
      activeFilters.dateTo   = document.getElementById('filterDateTo').value;
      applyFilters();
    });
  });
}

// ===== DASHBOARD =====
function getFilteredFarmers(filter) {
  if (filter === 'all') return farmers;
  const now = new Date();
  const cutoff = new Date();
  if (filter === 'week') cutoff.setDate(now.getDate() - 7);
  if (filter === 'month') cutoff.setMonth(now.getMonth() - 1);
  return farmers.filter(f => f.date && new Date(f.date) >= cutoff);
}

function calcStats(data) {
  const totalBags = data.reduce((s, f) => s + (f.products || []).reduce((a, p) => a + (p.bags || 0), 0), 0);
  const dealers = new Set(data.map(f => f.dealer).filter(Boolean));
  // brand totals
  const brandTotals = {};
  data.forEach(f => (f.products || []).forEach(p => {
    brandTotals[p.brand] = (brandTotals[p.brand] || 0) + (p.bags || 0);
  }));
  const topBrand = Object.entries(brandTotals).sort((a,b) => b[1]-a[1])[0];
  return { totalBags, totalDealers: dealers.size, topBrand: topBrand ? topBrand[0] : '—' };
}

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function renderDashboard() {
  const filter = document.getElementById('dashboardFilter').value;
  const data = getFilteredFarmers(filter);
  const stats = calcStats(data);

  document.getElementById('statTotalFarmers').textContent = data.length;
  document.getElementById('statTotalBags').textContent = stats.totalBags;
  document.getElementById('statTotalDealers').textContent = stats.totalDealers;
  document.getElementById('statTopBrand').textContent = stats.topBrand;

  // Product usage bar chart
  const prodTotals = {};
  data.forEach(f => (f.products || []).forEach(p => {
    prodTotals[p.name] = (prodTotals[p.name] || 0) + (p.bags || 0);
  }));
  const prodLabels = Object.keys(prodTotals);
  const prodValues = Object.values(prodTotals);

  destroyChart('chartProductBar');
  const ctxProd = document.getElementById('chartProductBar').getContext('2d');
  chartInstances['chartProductBar'] = new Chart(ctxProd, {
    type: 'bar',
    data: {
      labels: prodLabels.length ? prodLabels : ['No data'],
      datasets: [{ label: 'Bags', data: prodLabels.length ? prodValues : [0],
        backgroundColor: '#0a1172', borderRadius: 5 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { x: { ticks: { font: { size: 10 } } } } }
  });

  // Brand pie chart
  const brandTotals = {};
  data.forEach(f => (f.products || []).forEach(p => {
    brandTotals[p.brand] = (brandTotals[p.brand] || 0) + (p.bags || 0);
  }));
  const brandLabels = Object.keys(brandTotals);
  const brandValues = Object.values(brandTotals);
  const brandColors = ['#ff8f00','#1565c0','#0a1172','#283593','#c62828','#6a1b9a'];

  destroyChart('chartBrandPie');
  const ctxBrand = document.getElementById('chartBrandPie').getContext('2d');
  chartInstances['chartBrandPie'] = new Chart(ctxBrand, {
    type: 'doughnut',
    data: {
      labels: brandLabels.length ? brandLabels : ['No data'],
      datasets: [{ data: brandLabels.length ? brandValues : [1],
        backgroundColor: brandColors.slice(0, brandLabels.length || 1) }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
  });

  // Dealer bar chart
  const dealerTotals = {};
  data.forEach(f => {
    (f.products || []).forEach(p => {
      const d = p.dealer || f.dealer || 'Unknown';
      dealerTotals[d] = (dealerTotals[d] || 0) + (p.bags || 0);
    });
  });
  const dealerLabels = Object.keys(dealerTotals).slice(0, 10);
  const dealerValues = dealerLabels.map(d => dealerTotals[d]);

  destroyChart('chartDealerBar');
  const ctxDealer = document.getElementById('chartDealerBar').getContext('2d');
  chartInstances['chartDealerBar'] = new Chart(ctxDealer, {
    type: 'bar',
    data: {
      labels: dealerLabels.length ? dealerLabels : ['No data'],
      datasets: [{ label: 'Bags', data: dealerLabels.length ? dealerValues : [0],
        backgroundColor: '#1565c0', borderRadius: 5 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { x: { ticks: { font: { size: 10 } } } } }
  });

  // Crop pie chart
  const cropTotals = {};
  data.forEach(f => (f.crops || []).forEach(c => {
    cropTotals[c] = (cropTotals[c] || 0) + 1;
  }));
  const cropLabels = Object.keys(cropTotals);
  const cropValues = Object.values(cropTotals);
  const cropColors = ['#0a1172','#ff9800','#2196f3','#9c27b0','#f44336','#00bcd4','#8bc34a','#ff5722','#607d8b'];

  destroyChart('chartCropPie');
  const ctxCrop = document.getElementById('chartCropPie').getContext('2d');
  chartInstances['chartCropPie'] = new Chart(ctxCrop, {
    type: 'pie',
    data: {
      labels: cropLabels.length ? cropLabels : ['No data'],
      datasets: [{ data: cropLabels.length ? cropValues : [1],
        backgroundColor: cropColors.slice(0, cropLabels.length || 1) }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
  });
}

// ===== INSIGHTS =====
function runInsights() {
  const from = document.getElementById('insightFrom').value;
  const to = document.getElementById('insightTo').value;
  if (!from || !to) { showToast('Please select both From and To dates', 'error'); return; }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59);
  if (fromDate > toDate) { showToast('From date must be before To date', 'error'); return; }

  const data = farmers.filter(f => {
    if (!f.date) return false;
    const d = new Date(f.date);
    return d >= fromDate && d <= toDate;
  });

  if (!data.length) { showToast('No data found in selected range', 'error'); return; }

  // Compute
  const prodTotals = {}, brandTotals = {}, dealerTotals = {};
  data.forEach(f => {
    (f.products || []).forEach(p => {
      prodTotals[p.name] = (prodTotals[p.name] || 0) + (p.bags || 0);
      brandTotals[p.brand] = (brandTotals[p.brand] || 0) + (p.bags || 0);
      const d = p.dealer || f.dealer || 'Unknown';
      dealerTotals[d] = (dealerTotals[d] || 0) + (p.bags || 0);
    });
  });

  const totalBags = Object.values(prodTotals).reduce((a,b) => a+b, 0);
  const topProd = Object.entries(prodTotals).sort((a,b) => b[1]-a[1])[0];
  const topBrand = Object.entries(brandTotals).sort((a,b) => b[1]-a[1])[0];
  const topDealer = Object.entries(dealerTotals).sort((a,b) => b[1]-a[1])[0];

  // Render insight cards
  document.getElementById('insightCards').innerHTML = `
    <div class="insight-card">
      <div class="ic-icon">👨‍🌾</div>
      <div class="ic-value">${data.length}</div>
      <div class="ic-label">Farmers in Range</div>
    </div>
    <div class="insight-card">
      <div class="ic-icon">🧪</div>
      <div class="ic-value">${totalBags}</div>
      <div class="ic-label">Total Bags Sold</div>
    </div>
    <div class="insight-card">
      <div class="ic-icon">🏆</div>
      <div class="ic-value">${topProd ? topProd[0] : '—'}</div>
      <div class="ic-label">Most Used Product</div>
    </div>
    <div class="insight-card">
      <div class="ic-icon">⭐</div>
      <div class="ic-value">${topBrand ? topBrand[0] : '—'}</div>
      <div class="ic-label">Top Brand</div>
    </div>
    <div class="insight-card">
      <div class="ic-icon">🏪</div>
      <div class="ic-value">${topDealer ? topDealer[0] : '—'}</div>
      <div class="ic-label">Most Active Dealer</div>
    </div>
  `;

  // Product chart
  const pLabels = Object.keys(prodTotals);
  const pValues = Object.values(prodTotals);
  destroyChart('chartInsightProduct');
  const ctxIP = document.getElementById('chartInsightProduct').getContext('2d');
  chartInstances['chartInsightProduct'] = new Chart(ctxIP, {
    type: 'bar',
    data: {
      labels: pLabels,
      datasets: [{ label: 'Bags', data: pValues, backgroundColor: '#0a1172', borderRadius: 5 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { x: { ticks: { font: { size: 10 } } } } }
  });

  // Brand chart
  const bLabels = Object.keys(brandTotals);
  const bValues = Object.values(brandTotals);
  const bColors = ['#ff8f00','#1565c0','#0a1172','#283593'];
  destroyChart('chartInsightBrand');
  const ctxIB = document.getElementById('chartInsightBrand').getContext('2d');
  chartInstances['chartInsightBrand'] = new Chart(ctxIB, {
    type: 'doughnut',
    data: {
      labels: bLabels,
      datasets: [{ data: bValues, backgroundColor: bColors.slice(0, bLabels.length) }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  document.getElementById('insightsResult').classList.remove('hidden');
}

// ===== EXCEL UPLOAD =====
let parsedUploadRows = [];

function handleFileUpload(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx','csv'].includes(ext)) { showToast('Please upload .xlsx or .csv file', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('No data found in file', 'error'); return; }

      // Log exact column names to console for debugging
      const cols = Object.keys(rows[0]);
      console.log('[Upload] Exact column names in your Excel file:');
      cols.forEach((c, i) => console.log(`  [${i}] "${c}"  →  normalized: "${c.toLowerCase().replace(/[^a-z0-9]/g, '')}"`));

      parsedUploadRows = rows;
      showUploadPreview(rows);
    } catch(err) {
      showToast('Error reading file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function showUploadPreview(rows) {
  const preview = rows.slice(0, 5);
  const headers = Object.keys(rows[0]);

  // Same safe resolution logic as importUploadedData
  const norm = str => String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
  const normKeys = headers.map(k => ({ orig: k, norm: norm(k) }));

  const resolveCol = (aliases) => {
    for (const alias of aliases) {
      const na = norm(alias);
      const hit = normKeys.find(k => k.norm === na);
      if (hit) return hit.orig;
    }
    for (const alias of aliases) {
      const na = norm(alias);
      if (na.length < 5) continue;
      const hit = normKeys.find(k => k.norm.includes(na));
      if (hit) return hit.orig;
    }
    return null;
  };

  // App fields and their aliases (same as importUploadedData)
  const APP_FIELDS = [
    { key: 'name',     label: 'Farmer Name ★', aliases: ['farmername','name','farmer name','fullname','farmer'], required: true },
    { key: 'contact',  label: 'Contact',        aliases: ['contactno','contact no','contactnumber','contact number','phone number','mobile number','mobilenumber','phonenumber','contact','phone','mobile','tel','cell'] },
    { key: 'dealer',   label: 'Dealer',         aliases: ['dealername','dealer name','dealer','agentname','agent'] },
    { key: 'landArea', label: 'Land Area',      aliases: ['areaacre','area acre','areainacre','totallandarea','total land area','land area acres','landarea','land area','landareaacres','acres','area','land'] },
    { key: 'crops',    label: 'Crops',          aliases: ['cropplan','crop plan','croppattern','crop pattern','crops','crop','cultivation'] },
    { key: 'village',  label: 'Village / Address', aliases: ['address','villagemauza','village mauza','village/mauza','mauza','villagename','village name','village','locality','basti'] },
    { key: 'tehsil',   label: 'Tehsil',         aliases: ['tehsilname','tehsil name','tehsil','taluka','taluqa','taluk'] },
    { key: 'district', label: 'District / Region', aliases: ['region','districtname','district name','district','zila','zilaname'] },
    { key: 'province', label: 'Province',       aliases: ['provincename','province name','province','state'] },
    { key: 'lat',      label: 'Latitude',       aliases: ['latitude','lat'] },
    { key: 'lng',      label: 'Longitude',      aliases: ['longitude','long','lng'] },
    { key: 'location', label: 'Location (lat,lng combined)', aliases: ['location','gps','coordinates','coords','latlng','latlong'] },
  ];

  // Resolve each app field to a column
  const resolved = {};
  APP_FIELDS.forEach(f => { resolved[f.key] = resolveCol(f.aliases); });

  const unmatched = APP_FIELDS.filter(f => !resolved[f.key] && f.required);
  const allGood = APP_FIELDS.filter(f => f.required).every(f => resolved[f.key]);

  // Build the mapping table — each row is a dropdown so user can fix mismatches
  const blankOption = `<option value="">— not mapped —</option>`;
  const colOptions = headers.map(h => `<option value="${escHtml(h)}">${escHtml(h)}</option>`).join('');

  const mappingRows = APP_FIELDS.map(f => {
    const cur = resolved[f.key] || '';
    const opts = headers.map(h =>
      `<option value="${escHtml(h)}" ${h === cur ? 'selected' : ''}>${escHtml(h)}</option>`
    ).join('');
    const badge = cur
      ? `<span class="mapping-status mapping-status--ok">✓</span>`
      : `<span class="mapping-status mapping-status--miss">${f.required ? '★ required' : '—'}</span>`;
    return `
      <tr class="mapping-tr ${cur ? '' : (f.required ? 'mapping-tr--warn' : 'mapping-tr--none')}">
        <td class="mapping-field-label">${escHtml(f.label)}</td>
        <td>${badge}</td>
        <td>
          <select class="col-assign-select" data-field="${f.key}">
            ${blankOption}${opts}
          </select>
        </td>
      </tr>`;
  }).join('');

  const mappingHtml = `
    <div class="upload-mapping">
      <div class="upload-mapping-title">📋 Column mapping — ${rows.length} rows detected</div>
      <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 10px">
        Auto-detected below. Use the dropdowns to fix any wrong or missing mappings before importing.
      </p>
      <table class="mapping-table">
        <thead><tr><th>App Field</th><th></th><th>Your Excel Column</th></tr></thead>
        <tbody>${mappingRows}</tbody>
      </table>
      ${allGood
        ? `<div class="mapping-ok" style="margin-top:10px">✅ All required columns mapped — ready to import</div>`
        : `<div class="mapping-warn" style="margin-top:10px">⚠️ <strong>Farmer Name</strong> column not detected. Please assign it above before importing.</div>`}
    </div>`;

  // Data preview (first 5 rows)
  const tableHtml = `
    <div style="overflow-x:auto;margin-top:14px">
      <div style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin-bottom:6px">Preview (first ${preview.length} rows)</div>
      <table class="data-table" style="font-size:0.78rem">
        <thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${preview.map(row =>
          '<tr>' + headers.map(h => `<td>${escHtml(String(row[h]))}</td>`).join('') + '</tr>'
        ).join('')}</tbody>
      </table>
    </div>`;

  document.getElementById('previewTableWrapper').innerHTML = mappingHtml + tableHtml;
  document.getElementById('uploadPreview').classList.remove('hidden');

  // When user changes a dropdown, update parsedColAssignment
  document.querySelectorAll('.col-assign-select').forEach(sel => {
    sel.addEventListener('change', () => {
      // collect all current assignments into a global object
      window._colAssignment = {};
      document.querySelectorAll('.col-assign-select').forEach(s => {
        if (s.value) window._colAssignment[s.dataset.field] = s.value;
      });
    });
    // Init from auto-resolved
    if (resolved[sel.dataset.field]) sel.value = resolved[sel.dataset.field];
  });
  // Initialise global assignment from auto-resolved
  window._colAssignment = {};
  APP_FIELDS.forEach(f => { if (resolved[f.key]) window._colAssignment[f.key] = resolved[f.key]; });

  showToast('File loaded — ' + rows.length + ' rows. Check the column mapping below.', 'success');
}

async function importUploadedData() {
  if (!parsedUploadRows.length) return;
  let imported = 0;

  // Use the column assignment from the preview UI (user may have corrected it)
  // Fall back to auto-resolving if preview was skipped somehow
  const norm = str => String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
  const colKeys = Object.keys(parsedUploadRows[0]);
  const normKeys = colKeys.map(k => ({ orig: k, norm: norm(k) }));

  const resolveCol = (aliases) => {
    for (const alias of aliases) {
      const na = norm(alias);
      const hit = normKeys.find(k => k.norm === na);
      if (hit) return hit.orig;
    }
    for (const alias of aliases) {
      const na = norm(alias);
      if (na.length < 5) continue;
      const hit = normKeys.find(k => k.norm.includes(na));
      if (hit) return hit.orig;
    }
    return null;
  };

  // Prefer user's manual assignment from dropdowns, fall back to auto-resolve
  const assign = window._colAssignment || {};
  const COL = {
    name:     assign.name     || resolveCol(['farmername','name','farmer name','fullname','farmer']),
    contact:  assign.contact  || resolveCol(['contactno','contact no','contactnumber','contact number','phone number','mobile number','mobilenumber','phonenumber','contact','phone','mobile','tel','cell']),
    dealer:   assign.dealer   || resolveCol(['dealername','dealer name','dealer','agentname','agent']),
    landArea: assign.landArea || resolveCol(['areaacre','area acre','areainacre','totallandarea','total land area','land area acres','landarea','land area','landareaacres','acres','area','land']),
    crops:    assign.crops    || resolveCol(['cropplan','crop plan','croppattern','crop pattern','crops','crop','cultivation']),
    village:  assign.village  || resolveCol(['address','villagemauza','village mauza','village/mauza','mauza','villagename','village name','village','locality','basti']),
    tehsil:   assign.tehsil   || resolveCol(['tehsilname','tehsil name','tehsil','taluka','taluqa','taluk']),
    district: assign.district || resolveCol(['region','districtname','district name','district','zila','zilaname']),
    province: assign.province || resolveCol(['provincename','province name','province','state']),
    lat:      assign.lat      || resolveCol(['latitude','lat']),
    lng:      assign.lng      || resolveCol(['longitude','long','lng']),
    location: assign.location || resolveCol(['location','gps','coordinates','coords','latlng','latlong']),
  };

  console.log('[Import] Final column mapping:', COL);

  if (!COL.name) {
    showToast('Cannot import — Farmer Name column not mapped. Please assign it in the column mapper.', 'error');
    return;
  }

  // Safety check: warn if location/GPS columns couldn't be resolved
  const missing = [];
  if (!COL.village)  missing.push('Village/Mauza');
  if (!COL.tehsil)   missing.push('Tehsil');
  if (!COL.district) missing.push('District');
  if (!COL.lat)      missing.push('Latitude');
  if (!COL.lng)      missing.push('Longitude');
  if (missing.length) {
    console.warn('[Import] Could not map these columns (will be blank):', missing);
  }

  const getVal = (row, colKey) => {
    if (!colKey) return '';
    const v = row[colKey];
    if (v === undefined || v === null || v === '') return '';
    return String(v).trim();
  };

  // Use base timestamp + row index offset so date.asc sort = Excel row order
  const importBaseTime = Date.now();

  parsedUploadRows.forEach((row, rowIndex) => {
    const name     = getVal(row, COL.name);
    const contact  = getVal(row, COL.contact);
    const dealer   = getVal(row, COL.dealer);
    const landArea = parseFloat(getVal(row, COL.landArea)) || 0;
    const cropsRaw = getVal(row, COL.crops);
    const crops    = cropsRaw ? cropsRaw.split(/[,;\/|]/).map(c => c.trim()).filter(Boolean) : [];
    const village  = getVal(row, COL.village);
    const tehsil   = getVal(row, COL.tehsil);
    const district = getVal(row, COL.district);
    const province = getVal(row, COL.province);

    // GPS: try dedicated lat/lng columns first, then parse combined Location column
    let lat = parseFloat(getVal(row, COL.lat)) || null;
    let lng = parseFloat(getVal(row, COL.lng)) || null;
    if ((!lat || !lng) && COL.location) {
      const locRaw = getVal(row, COL.location);
      if (locRaw) {
        const parts = locRaw.split(/[\s,;]+/).map(p => parseFloat(p)).filter(n => !isNaN(n));
        if (parts.length >= 2) { lat = parts[0]; lng = parts[1]; }
      }
    }

    if (!name) return;
    const farmer = {
      id: 'f_' + (importBaseTime + rowIndex) + '_' + Math.random().toString(36).slice(2,6),
      name, contact, dealer, landArea, crops,
      village, tehsil, district, province,
      lat, lng,
      products: [],
      // Each row gets a unique timestamp 1ms apart — preserves Excel Sr. order
      date: new Date(importBaseTime + rowIndex).toISOString()
    };
    farmers.push(farmer);
    imported++;
  });
  // Sort to keep consistent date.asc, id.asc order (preserves Excel Sr. order)
  farmers.sort((a, b) => {
    const dateDiff = new Date(a.date) - new Date(b.date);
    if (dateDiff !== 0) return dateDiff;
    return (a.id || '').localeCompare(b.id || '');
  });
  const confirmBtn = document.getElementById('confirmUploadBtn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '? Syncing?';
  await saveFarmers();
  confirmBtn.disabled = false;
  confirmBtn.textContent = '? Import All Records';
  parsedUploadRows = [];
  document.getElementById('uploadPreview').classList.add('hidden');
  document.getElementById('fileInput').value = '';
  showToast(imported + ' farmers imported successfully!', 'success');
  navigateTo('farmers');
}

// ===== EXPORT TO EXCEL =====
function exportToExcel() {
  if (!farmers.length) { showToast('No data to export', 'error'); return; }
  const rows = farmers.map(f => {
    const base = {
      'Farmer Name': f.name,
      'Contact': f.contact,
      'Dealer': f.dealer,
      'Village / Mauza': f.village || '',
      'Tehsil': f.tehsil || '',
      'District': f.district || '',
      'Province': f.province || '',
      'Land Area (Acres)': f.landArea,
      'Crops': (f.crops || []).join(', '),
      'Latitude': f.lat || '',
      'Longitude': f.lng || '',
      'Date Added': f.date ? new Date(f.date).toLocaleDateString('en-PK') : ''
    };
    // Add product columns
    ALL_PRODUCTS.forEach(p => {
      const entry = (f.products || []).find(fp => fp.id === p.id);
      base[p.name + ' (Bags)'] = entry ? entry.bags : 0;
      base[p.name + ' (Dealer)'] = entry ? entry.dealer : '';
    });
    return base;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Farmers');
  XLSX.writeFile(wb, 'AgriTrack_Farmers_' + new Date().toISOString().slice(0,10) + '.xlsx');
  showToast('Excel file exported!', 'success');
}

// ===== PDF EXPORT =====
function exportToPDF() {
  if (!farmers.length) { showToast('No farmer data to export', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const today = new Date().toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalBags = farmers.reduce((s, f) => s + (f.products || []).reduce((ps, p) => ps + (p.bags || 0), 0), 0);
  const dealers = new Set(farmers.map(f => f.dealer).filter(Boolean)).size;

  // ── Header bar ──
  doc.setFillColor(10, 17, 114);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('AgriTrack – Farmer Data History', 14, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Generated: ' + today, 14, 17);

  // ── Summary stats ──
  doc.setTextColor(10, 17, 114);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  const stats = [
    { label: 'Total Farmers', value: farmers.length },
    { label: 'Total Bags Sold', value: totalBags },
    { label: 'Active Dealers', value: dealers }
  ];
  const colW = (pageW - 28) / stats.length;
  stats.forEach((s, i) => {
    const x = 14 + i * colW;
    doc.setFillColor(240, 242, 255);
    doc.roundedRect(x, 26, colW - 4, 14, 2, 2, 'F');
    doc.setFontSize(14);
    doc.setTextColor(10, 17, 114);
    doc.text(String(s.value), x + (colW - 4) / 2, 33, { align: 'center' });
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 100);
    doc.setFont('helvetica', 'normal');
    doc.text(s.label, x + (colW - 4) / 2, 38, { align: 'center' });
  });

  // ── Main farmer table ──
  const head = [['#', 'Name', 'Contact', 'Village / Mauza', 'Tehsil', 'District', 'Province', 'Land (Ac)', 'Crops', 'Dealer', 'Date Added']];
  const body = farmers.map((f, i) => [
    i + 1,
    f.name || '',
    f.contact || '',
    f.village || '—',
    f.tehsil || '—',
    f.district || '—',
    f.province || '—',
    f.landArea || '—',
    (f.crops || []).join(', ') || '—',
    f.dealer || '—',
    f.date ? new Date(f.date).toLocaleDateString('en-PK') : '—'
  ]);

  doc.autoTable({
    head,
    body,
    startY: 44,
    styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [10, 17, 114], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 255] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      7: { cellWidth: 16, halign: 'center' },
      10: { cellWidth: 22 }
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (data) => {
      // Footer on every page
      const pCount = doc.internal.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(
        'AgriTrack  |  Page ' + data.pageNumber + ' of ' + pCount,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 5,
        { align: 'center' }
      );
    }
  });

  // ── Per-farmer fertilizer detail pages ──
  farmers.forEach((f) => {
    const prods = (f.products || []).filter(p => p.bags > 0);
    if (!prods.length) return;

    doc.addPage();

    // Farmer name header
    doc.setFillColor(10, 17, 114);
    doc.rect(0, 0, pageW, 16, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Fertilizer Detail – ' + (f.name || ''), 14, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    const loc = [f.village, f.tehsil, f.district].filter(Boolean).join(', ');
    doc.text(loc || 'Location not specified', 14, 15);

    // Info row
    doc.setTextColor(40, 40, 60);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Contact: ' + (f.contact || '—'), 14, 23);
    doc.text('Dealer: ' + (f.dealer || '—'), 80, 23);
    doc.text('Land: ' + (f.landArea || '—') + ' Acres', 150, 23);
    doc.text('Crops: ' + ((f.crops || []).join(', ') || '—'), 14, 29);

    doc.autoTable({
      head: [['Product', 'Brand', 'Bags', 'Dealer']],
      body: prods.map(p => [p.name || '', p.brand || '', p.bags || 0, p.dealer || f.dealer || '']),
      startY: 34,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [34, 139, 34], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 255, 240] },
      columnStyles: {
        2: { halign: 'center', cellWidth: 20 }
      },
      margin: { left: 14, right: 14 },
      didDrawPage: (data) => {
        const pCount = doc.internal.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(
          'AgriTrack  |  Page ' + data.pageNumber + ' of ' + pCount,
          pageW / 2,
          doc.internal.pageSize.getHeight() - 5,
          { align: 'center' }
        );
      }
    });
  });

  doc.save('AgriTrack_History_' + new Date().toISOString().slice(0, 10) + '.pdf');
  showToast('PDF exported successfully!', 'success');
}

// ===== MODAL =====
function initModal() {
  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('modalOverlay').classList.add('hidden');
  });
  document.getElementById('modalOverlay').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
}

// ===== DETECT LOCATION =====
function detectLocation() {
  if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
  showToast('Detecting location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      document.getElementById('latitude').value = lat;
      document.getElementById('longitude').value = lng;
      setMapMarker(parseFloat(lat), parseFloat(lng));
      showToast('Location detected!', 'success');
    },
    err => showToast('Could not detect location: ' + err.message, 'error')
  );
}

// ===== MAIN INIT =====
document.addEventListener('DOMContentLoaded', async function() {
  // Wire up all UI immediately so navigation works before data loads
  renderProductInputs();
  initSidebar();
  initModal();
  initSearch();
  initRoutePanelEvents();

  // Select-all checkbox
  document.getElementById('selectAllChk').addEventListener('change', function() {
    const rowChks = document.querySelectorAll('.row-chk');
    rowChks.forEach(chk => {
      chk.checked = this.checked;
      const id = chk.dataset.id;
      if (this.checked) {
        selectedFarmerIds.add(id);
        chk.closest('tr').classList.add('row-selected');
      } else {
        selectedFarmerIds.delete(id);
        chk.closest('tr').classList.remove('row-selected');
      }
    });
    updateBulkBar();
  });

  // Bulk delete
  document.getElementById('bulkDeleteBtn').addEventListener('click', async function() {
    const count = selectedFarmerIds.size;
    if (!count) return;
    if (!confirm(`Delete ${count} selected farmer${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
    const ids = [...selectedFarmerIds];
    farmers = farmers.filter(f => !ids.includes(f.id));
    selectedFarmerIds.clear();
    localStorage.setItem('agritrack_farmers', JSON.stringify(farmers));
    renderFarmersTable(farmers);
    renderDashboard();
    showToast(`${count} farmer${count > 1 ? 's' : ''} deleted.`, 'success');
    // Delete from DB in parallel
    await Promise.all(ids.map(id => deleteFarmerFromDB(id)));
  });

  // Bulk clear selection
  document.getElementById('bulkClearBtn').addEventListener('click', function() {
    selectedFarmerIds.clear();
    document.querySelectorAll('.row-chk').forEach(chk => {
      chk.checked = false;
      chk.closest('tr').classList.remove('row-selected');
    });
    updateBulkBar();
  });

  // Form submit
  document.getElementById('farmerForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('resetFormBtn').addEventListener('click', resetForm);
  document.getElementById('fillDummyBtn').addEventListener('click', fillDummyData);

  // Detect location
  document.getElementById('detectLocationBtn').addEventListener('click', detectLocation);

  // Dashboard filter
  document.getElementById('dashboardFilter').addEventListener('change', renderDashboard);

  // Export
  document.getElementById('exportBtn').addEventListener('click', exportToExcel);
  document.getElementById('exportPdfBtn').addEventListener('click', exportToPDF);

  // Insights
  document.getElementById('runInsightBtn').addEventListener('click', runInsights);

  // File upload
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');

  fileInput.addEventListener('change', function() {
    if (this.files[0]) handleFileUpload(this.files[0]);
  });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]);
  });
  document.getElementById('confirmUploadBtn').addEventListener('click', importUploadedData);
  document.getElementById('cancelUploadBtn').addEventListener('click', () => {
    document.getElementById('uploadPreview').classList.add('hidden');
    document.getElementById('fileInput').value = '';
    parsedUploadRows = [];
  });

  // Nearby farmers
  document.getElementById('nearbyDetectBtn').addEventListener('click', nearbyDetectGPS);
  document.getElementById('nearbyRadius').addEventListener('change', runNearbySearch);

  // Custom crop
  document.getElementById('addCustomCropBtn').addEventListener('click', addCustomCrop);
  document.getElementById('customCropInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); addCustomCrop(); }
  });

  // Initial dashboard render (empty state)
  renderDashboard();

  // Auth handles data loading � initAuth() called from auth.js after DOM ready
});

// Make functions global for inline onclick handlers
window.viewFarmer = viewFarmer;
window.editFarmer = editFarmer;
window.deleteFarmer = deleteFarmer;
window.nearbyFlyTo = nearbyFlyTo;
window.removeCustomCrop = removeCustomCrop;

// ===== NEARBY FARMERS =====
let nearbyMapInstance = null;
let nearbyUserMarker = null;
let nearbyFarmerMarkers = [];
let nearbyCircle = null;
let nearbyUserLat = null;
let nearbyUserLng = null;

// ===== ROUTING STATE =====
let routePolyline = null;          // the drawn road line on the map
let routeStartMarker = null;       // animated start marker
let routeEndMarker = null;         // destination marker
let activeRouteFarmerId = null;    // which farmer is currently routed

// Haversine formula ? returns distance in km between two lat/lng points
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function initNearbyMap() {
  if (nearbyMapInstance) { nearbyMapInstance.invalidateSize(); return; }
  // Default center: Vehari, Punjab, Pakistan
  nearbyMapInstance = L.map('nearbyMap').setView([30.0444, 72.3512], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '? OpenStreetMap contributors'
  }).addTo(nearbyMapInstance);

  // Tap on map to set "you are here"
  nearbyMapInstance.on('click', function(e) {
    setNearbyUserLocation(e.latlng.lat, e.latlng.lng, 'map');
  });
}

function setNearbyUserLocation(lat, lng, source) {
  nearbyUserLat = lat;
  nearbyUserLng = lng;

  // If there was an active route, clear it since origin changed
  if (activeRouteFarmerId !== null) {
    clearRoute();
  }

  // Place / move the pulsing "You" marker
  const youIcon = L.divIcon({
    className: '',
    html: '<div class="you-marker"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
  if (nearbyUserMarker) {
    nearbyUserMarker.setLatLng([lat, lng]);
  } else {
    nearbyUserMarker = L.marker([lat, lng], { icon: youIcon, zIndexOffset: 1000 })
      .addTo(nearbyMapInstance)
      .bindPopup('<strong>📍 You are here</strong><br>' + lat.toFixed(5) + ', ' + lng.toFixed(5));
  }
  nearbyUserMarker.openPopup();

  const msg = source === 'gps'
    ? '✅ GPS location detected — showing farmers nearby'
    : '📍 Location set from map tap — showing farmers nearby';
  setNearbyStatus(msg, 'info');

  runNearbySearch();
}

function setNearbyStatus(msg, type) {
  const el = document.getElementById('nearbyStatus');
  const txt = document.getElementById('nearbyStatusText');
  el.classList.remove('hidden', 'found', 'none');
  if (type === 'found') el.classList.add('found');
  if (type === 'none')  el.classList.add('none');
  txt.textContent = msg;
}

function runNearbySearch() {
  if (nearbyUserLat === null) return;
  const radius = parseFloat(document.getElementById('nearbyRadius').value);

  // Clear old farmer markers and circle
  nearbyFarmerMarkers.forEach(m => nearbyMapInstance.removeLayer(m));
  nearbyFarmerMarkers = [];
  if (nearbyCircle) { nearbyMapInstance.removeLayer(nearbyCircle); nearbyCircle = null; }

  // Draw radius circle
  nearbyCircle = L.circle([nearbyUserLat, nearbyUserLng], {
    radius: radius * 1000,
    color: '#0a1172', fillColor: '#1a2fa0', fillOpacity: 0.07,
    weight: 2, dashArray: '6 4'
  }).addTo(nearbyMapInstance);

  // Filter farmers that have coordinates
  const withCoords = farmers.filter(f => f.lat && f.lng);
  if (!withCoords.length) {
    setNearbyStatus('ℹ️ No farmers have location data saved yet. Add coordinates when registering farmers.', 'none');
    document.getElementById('nearbyResults').classList.add('hidden');
    nearbyMapInstance.setView([nearbyUserLat, nearbyUserLng], 11);
    return;
  }

  // Compute distances and sort
  const withDist = withCoords.map(f => ({
    ...f,
    distKm: haversineKm(nearbyUserLat, nearbyUserLng, parseFloat(f.lat), parseFloat(f.lng))
  })).sort((a, b) => a.distKm - b.distKm);

  const nearby = withDist.filter(f => f.distKm <= radius);

  // Plot ALL farmers on map (grey = outside radius, green = inside)
  withDist.forEach(f => {
    const isNear = f.distKm <= radius;
    const farmerIcon = L.divIcon({
      className: '',
      html: `<div style="
        width:14px;height:14px;border-radius:50%;
        background:${isNear ? '#0a1172' : '#9e9e9e'};
        border:2.5px solid #fff;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    const crops = (f.crops || []).join(', ') || '—';
    const totalBags = (f.products || []).reduce((s, p) => s + (p.bags || 0), 0);
    const addrLine = [f.village, f.tehsil, f.district].filter(Boolean).join(', ') || '';
    const distDisplay = f.distKm < 1
      ? (f.distKm * 1000).toFixed(0) + ' m away'
      : f.distKm.toFixed(2) + ' km away';
    const canRoute = nearbyUserLat !== null;
    const popup = `
      <div style="min-width:175px;font-family:inherit">
        <strong style="font-size:0.95rem;display:block;margin-bottom:4px">👨‍🌾 ${escHtml(f.name)}</strong>
        <div style="color:#555;font-size:0.82rem;line-height:1.7">
          📞 ${escHtml(f.contact)}<br>
          ${addrLine ? `📍 ${escHtml(addrLine)}<br>` : ''}
          🌾 ${escHtml(crops)}<br>
          🧪 ${totalBags} bags total<br>
          <span style="color:${isNear ? '#0a1172' : '#9e9e9e'};font-weight:600">
            📏 ${distDisplay}
          </span>
        </div>
        ${canRoute ? `
        <div style="margin-top:8px;display:flex;gap:6px">
          <button onclick="getRouteToFarmer('${f.id}')"
            style="flex:1;padding:6px 8px;background:#0a1172;color:#fff;border:none;
                   border-radius:6px;font-size:0.8rem;cursor:pointer;font-weight:600">
            🗺 Directions
          </button>
          <button onclick="viewFarmer('${f.id}')"
            style="padding:6px 8px;background:none;color:#0a1172;border:1.5px solid #0a1172;
                   border-radius:6px;font-size:0.8rem;cursor:pointer;font-weight:600">
            👁 View
          </button>
        </div>` : ''}
      </div>`;
    const marker = L.marker([parseFloat(f.lat), parseFloat(f.lng)], { icon: farmerIcon })
      .addTo(nearbyMapInstance)
      .bindPopup(popup);
    nearbyFarmerMarkers.push(marker);
  });

  // Fit map to show user + all nearby farmers (or just the circle if none)
  if (nearby.length) {
    const bounds = L.latLngBounds([[nearbyUserLat, nearbyUserLng]]);
    nearby.forEach(f => bounds.extend([parseFloat(f.lat), parseFloat(f.lng)]));
    nearbyMapInstance.fitBounds(bounds.pad(0.2));
  } else {
    nearbyMapInstance.setView([nearbyUserLat, nearbyUserLng], 11);
  }

  // Update status
  if (nearby.length) {
    setNearbyStatus(`✅ Found ${nearby.length} farmer${nearby.length > 1 ? 's' : ''} within ${radius} km`, 'found');
  } else {
    setNearbyStatus(`🔍 No farmers found within ${radius} km. Try increasing the radius.`, 'none');
  }

  // Render results list
  renderNearbyList(nearby, radius);
}

function renderNearbyList(nearby, radius) {
  const resultsEl = document.getElementById('nearbyResults');
  const listEl = document.getElementById('nearbyList');
  const titleEl = document.getElementById('nearbyResultsTitle');
  const badgeEl = document.getElementById('nearbyCountBadge');

  titleEl.textContent = `Farmers within ${radius} km`;
  badgeEl.textContent = nearby.length;

  if (!nearby.length) {
    resultsEl.classList.add('hidden');
    return;
  }

  listEl.innerHTML = nearby.map((f, i) => {
    const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
    const crops = (f.crops || []).slice(0, 2).join(', ') + ((f.crops || []).length > 2 ? '…' : '');
    const totalBags = (f.products || []).reduce((s, p) => s + (p.bags || 0), 0);
    const addrShort = [f.village, f.district].filter(Boolean).join(', ') || '';
    const distDisplay = f.distKm < 1
      ? (f.distKm * 1000).toFixed(0) + ' m'
      : f.distKm.toFixed(2) + ' km';
    return `
      <div class="nearby-item ${activeRouteFarmerId === f.id ? 'nearby-item--active-route' : ''}" onclick="nearbyFlyTo('${f.id}')">
        <div class="nearby-rank ${rankClass}">${i + 1}</div>
        <div class="nearby-info">
          <div class="nearby-name">👨‍🌾 ${escHtml(f.name)}</div>
          <div class="nearby-meta">
            📞 ${escHtml(f.contact)} &nbsp;·&nbsp;
            ${addrShort ? `📍 ${escHtml(addrShort)} &nbsp;·&nbsp;` : ''}
            🌾 ${escHtml(crops) || '—'} &nbsp;·&nbsp;
            🧪 ${totalBags} bags &nbsp;·&nbsp;
            🏪 ${escHtml(f.dealer)}
          </div>
        </div>
        <div class="nearby-dist">
          <span class="nearby-dist-value">${distDisplay}</span>
          <span class="nearby-dist-label">away</span>
        </div>
        <div class="nearby-item-actions">
          <button class="nearby-route-btn ${activeRouteFarmerId === f.id ? 'nearby-route-btn--active' : ''}"
            onclick="event.stopPropagation(); getRouteToFarmer('${f.id}')"
            title="Get directions">
            ${activeRouteFarmerId === f.id ? '🔵 Routing…' : '🗺 Route'}
          </button>
          <button class="nearby-action-btn" onclick="event.stopPropagation(); viewFarmer('${f.id}')">👁 View</button>
        </div>
      </div>`;
  }).join('');

  resultsEl.classList.remove('hidden');
}

function nearbyFlyTo(farmerId) {
  const f = farmers.find(x => x.id === farmerId);
  if (!f || !f.lat || !f.lng) return;
  nearbyMapInstance.flyTo([parseFloat(f.lat), parseFloat(f.lng)], 14, { duration: 1 });
  // Open that farmer's popup
  const marker = nearbyFarmerMarkers.find(m => {
    const ll = m.getLatLng();
    return Math.abs(ll.lat - parseFloat(f.lat)) < 0.0001 && Math.abs(ll.lng - parseFloat(f.lng)) < 0.0001;
  });
  if (marker) setTimeout(() => marker.openPopup(), 1100);
}

function nearbyDetectGPS() {
  if (!navigator.geolocation) { showToast('Geolocation not supported by your browser', 'error'); return; }
  setNearbyStatus('📡 Detecting your GPS location…', 'info');
  document.getElementById('nearbyStatus').classList.remove('hidden');
  navigator.geolocation.getCurrentPosition(
    pos => {
      setNearbyUserLocation(pos.coords.latitude, pos.coords.longitude, 'gps');
    },
    err => {
      setNearbyStatus('? Could not get GPS: ' + err.message + '. Try tapping the map instead.', 'none');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ===== ROUTING =====

// OSRM turn instruction codes → human-readable with icons
const OSRM_TURN_ICONS = {
  'turn-slight-left':  '↙ Slight left',
  'turn-left':         '← Turn left',
  'turn-sharp-left':   '↰ Sharp left',
  'turn-slight-right': '↘ Slight right',
  'turn-right':        '→ Turn right',
  'turn-sharp-right':  '↱ Sharp right',
  'continue':          '↑ Continue',
  'roundabout':        '🔄 Roundabout',
  'depart':            '🚦 Start',
  'arrive':            '🏁 Arrive',
  'merge':             '↗ Merge',
  'fork':              '⑂ Fork',
  'on-ramp':           '↗ On ramp',
  'off-ramp':          '↘ Off ramp',
  'end-of-road':       '⊣ End of road',
  'use-lane':          '→ Use lane',
  'notification':      'ℹ',
};

function osrmIcon(maneuver) {
  if (!maneuver) return '↑';
  const key = maneuver.modifier
    ? maneuver.type + '-' + maneuver.modifier
    : maneuver.type;
  return OSRM_TURN_ICONS[key] || OSRM_TURN_ICONS[maneuver.type] || '↑ Continue';
}

function fmtDistance(m) {
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(1) + ' km';
}

function fmtDuration(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + ' hr ' + m + ' min';
  return m + ' min';
}

// ===== OFFLINE DETECTION =====
function isOnline() { return navigator.onLine; }

// ===== STRAIGHT-LINE OFFLINE ROUTE =====
// Generates a simple offline route object mimicking OSRM structure
function buildOfflineRoute(oLat, oLng, dLat, dLng, farmerName) {
  const distM = haversineKm(oLat, oLng, dLat, dLng) * 1000;

  // Cardinal bearing for a human-readable direction
  function bearing(lat1, lng1, lat2, lng2) {
    const dLngR = (lng2 - lng1) * Math.PI / 180;
    const lat1R  = lat1 * Math.PI / 180;
    const lat2R  = lat2 * Math.PI / 180;
    const y = Math.sin(dLngR) * Math.cos(lat2R);
    const x = Math.cos(lat1R) * Math.sin(lat2R) -
              Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLngR);
    const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const dirs = ['North','NE','East','SE','South','SW','West','NW'];
    return dirs[Math.round(deg / 45) % 8];
  }

  const dir = bearing(oLat, oLng, dLat, dLng);
  // Estimated drive time: 40 km/h average on rural roads
  const durationS = (distM / 1000) / 40 * 3600;

  // Straight-line GeoJSON coordinates (just two points)
  const geometry = {
    type: 'LineString',
    coordinates: [[oLng, oLat], [dLng, dLat]]
  };

  // Synthesise minimal OSRM-like steps
  const steps = [
    {
      maneuver: { type: 'depart', modifier: null },
      name: `Head ${dir} toward ${farmerName}`,
      distance: distM,
      duration: durationS,
      _offline: true
    },
    {
      maneuver: { type: 'arrive', modifier: null },
      name: farmerName,
      distance: 0,
      duration: 0,
      _offline: true
    }
  ];

  return {
    distance: distM,
    duration: durationS,
    geometry,
    legs: [{ steps }],
    _offline: true   // flag so UI can show the offline badge
  };
}

async function getRouteToFarmer(farmerId) {
  if (nearbyUserLat === null) {
    showToast('Set your location first — use GPS or tap the map', 'error');
    return;
  }
  const f = farmers.find(x => x.id === farmerId);
  if (!f || !f.lat || !f.lng) {
    showToast('This farmer has no location saved', 'error');
    return;
  }

  // Tap same farmer again → clear route
  if (activeRouteFarmerId === farmerId) {
    clearRoute();
    return;
  }

  activeRouteFarmerId = farmerId;
  const online = isOnline();

  setNearbyStatus(
    online ? '🔍 Calculating road route…' : '📡 Offline — calculating straight-line route…',
    'info'
  );
  document.getElementById('nearbyStatus').classList.remove('hidden');

  const oLat = nearbyUserLat, oLng = nearbyUserLng;
  const dLat = parseFloat(f.lat), dLng = parseFloat(f.lng);

  let route = null;

  if (online) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true&annotations=false`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Routing service error');
      const data = await res.json();
      if (!data.routes || !data.routes.length) throw new Error('No route found');
      route = data.routes[0];
    } catch (err) {
      // Network call failed even though navigator.onLine was true
      // (e.g. OSRM is down) — fall back to offline route
      route = buildOfflineRoute(oLat, oLng, dLat, dLng, f.name);
    }
  } else {
    // Fully offline — use straight-line fallback
    route = buildOfflineRoute(oLat, oLng, dLat, dLng, f.name);
  }

  drawRoute(route, f);
  showRoutePanel(route, f);

  // Refresh list to highlight active route card
  const radius = parseFloat(document.getElementById('nearbyRadius').value);
  const withCoords = farmers.filter(x => x.lat && x.lng);
  const withDist = withCoords.map(x => ({
    ...x,
    distKm: haversineKm(nearbyUserLat, nearbyUserLng, parseFloat(x.lat), parseFloat(x.lng))
  })).sort((a, b) => a.distKm - b.distKm);
  renderNearbyList(withDist.filter(x => x.distKm <= radius), radius);

  const offlineNote = route._offline ? ' (straight-line, offline)' : '';
  setNearbyStatus(
    `✅ Route to ${f.name} — ${fmtDistance(route.distance)}, ${fmtDuration(route.duration)}${offlineNote}`,
    'found'
  );
}

function drawRoute(route, farmer) {
  clearRoutePolyline();

  const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
  const isOffline = !!route._offline;

  if (isOffline) {
    // Offline: dashed amber straight line with animated pulse
    routePolyline = L.layerGroup([
      L.polyline(coords, {
        color: 'rgba(245,124,0,0.2)',
        weight: 12,
        lineCap: 'round'
      }),
      L.polyline(coords, {
        color: '#f57c00',
        weight: 4,
        lineCap: 'round',
        dashArray: '10 8',
        dashOffset: '0'
      }),
      L.polyline(coords, {
        color: '#fff',
        weight: 1.5,
        lineCap: 'round',
        opacity: 0.6,
        dashArray: '10 8'
      })
    ]).addTo(nearbyMapInstance);
  } else {
    // Online: solid navy road line
    routePolyline = L.layerGroup([
      L.polyline(coords, {
        color: 'rgba(10,17,114,0.15)',
        weight: 10,
        lineCap: 'round',
        lineJoin: 'round'
      }),
      L.polyline(coords, {
        color: '#0a1172',
        weight: 5,
        lineCap: 'round',
        lineJoin: 'round'
      }),
      L.polyline(coords, {
        color: '#fff',
        weight: 2,
        lineCap: 'round',
        lineJoin: 'round',
        opacity: 0.5
      })
    ]).addTo(nearbyMapInstance);
  }

  // Animated destination marker
  const destIcon = L.divIcon({
    className: '',
    html: `<div class="route-dest-marker">
      <div class="route-dest-pin"></div>
      <div class="route-dest-label">${escHtml(farmer.name)}</div>
    </div>`,
    iconSize: [120, 48],
    iconAnchor: [12, 40]
  });

  if (routeEndMarker) nearbyMapInstance.removeLayer(routeEndMarker);
  routeEndMarker = L.marker([parseFloat(farmer.lat), parseFloat(farmer.lng)], {
    icon: destIcon,
    zIndexOffset: 900
  }).addTo(nearbyMapInstance);

  // Fit map to show full route with padding
  const bounds = L.latLngBounds(coords);
  nearbyMapInstance.fitBounds(bounds, { padding: [50, 50] });
}

function showRoutePanel(route, farmer) {
  const panel = document.getElementById('routePanel');
  const isOffline = !!route._offline;

  document.getElementById('routeDestName').textContent = farmer.name;
  document.getElementById('routeDistance').textContent = fmtDistance(route.distance);
  document.getElementById('routeDuration').textContent = fmtDuration(route.duration);
  document.getElementById('routeMode').textContent = 'Driving';

  // Distance label — clarify offline is straight-line
  const distLabel = panel.querySelector('.route-stat:first-child .route-stat-label');
  if (distLabel) distLabel.textContent = isOffline ? 'Straight-line dist.' : 'Road distance';

  // Offline badge
  let badge = panel.querySelector('.route-offline-badge');
  if (isOffline) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'route-offline-badge';
      badge.innerHTML = '📵 Offline mode — straight-line route (approximate)';
      panel.querySelector('.route-panel-header').after(badge);
    }
  } else {
    if (badge) badge.remove();
  }

  // Google Maps deep-link as online fallback
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${nearbyUserLat},${nearbyUserLng}&destination=${farmer.lat},${farmer.lng}&travelmode=driving`;
  const gmapsEl = document.getElementById('routeOpenMaps');
  gmapsEl.href = mapsUrl;
  gmapsEl.textContent = isOffline ? 'Open Maps when online 🔗' : 'Open in Maps 🔗';

  // Build turn-by-turn steps
  const steps = route.legs.flatMap(leg => leg.steps);
  document.getElementById('routeStepsCount').textContent = steps.length + ' steps';

  const stepsEl = document.getElementById('routeSteps');
  stepsEl.innerHTML = steps.map((step, i) => {
    const icon = osrmIcon(step.maneuver);
    const streetName = step.name ? escHtml(step.name) : '<em style="color:#999">Unnamed road</em>';
    const dist = fmtDistance(step.distance);
    const isFirst = i === 0;
    const isLast = i === steps.length - 1;
    return `
      <div class="route-step ${isFirst ? 'route-step--first' : ''} ${isLast ? 'route-step--last' : ''}">
        <div class="route-step-icon">${icon.split(' ')[0]}</div>
        <div class="route-step-body">
          <div class="route-step-instruction">${icon.slice(icon.indexOf(' ')+1)} ${streetName}</div>
          ${!isLast ? `<div class="route-step-dist">${dist}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearRoute() {
  clearRoutePolyline();
  activeRouteFarmerId = null;

  // Hide panel
  document.getElementById('routePanel').classList.add('hidden');

  // Collapse steps
  document.getElementById('routeSteps').classList.add('hidden');
  const toggle = document.getElementById('routeStepsToggle');
  toggle.querySelector('span').textContent = '▶ Turn-by-turn directions';

  // Re-render list without active state
  const radius = parseFloat(document.getElementById('nearbyRadius').value);
  if (nearbyUserLat !== null) {
    const withCoords = farmers.filter(f => f.lat && f.lng);
    const withDist = withCoords.map(f => ({
      ...f,
      distKm: haversineKm(nearbyUserLat, nearbyUserLng, parseFloat(f.lat), parseFloat(f.lng))
    })).sort((a, b) => a.distKm - b.distKm);
    const nearby = withDist.filter(f => f.distKm <= radius);
    renderNearbyList(nearby, radius);
    setNearbyStatus(`✅ Found ${nearby.length} farmer${nearby.length !== 1 ? 's' : ''} within ${radius} km`, 'found');
  }
}

function clearRoutePolyline() {
  if (routePolyline) { nearbyMapInstance.removeLayer(routePolyline); routePolyline = null; }
  if (routeEndMarker) { nearbyMapInstance.removeLayer(routeEndMarker); routeEndMarker = null; }
}

// Route panel wiring — called from main DOMContentLoaded init
function initRoutePanelEvents() {
  const toggle = document.getElementById('routeStepsToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const stepsEl = document.getElementById('routeSteps');
      const isHidden = stepsEl.classList.toggle('hidden');
      toggle.querySelector('span').textContent = isHidden
        ? '▶ Turn-by-turn directions'
        : '▼ Turn-by-turn directions';
    });
  }
  const closeBtn = document.getElementById('routeCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', clearRoute);

  // ===== ONLINE / OFFLINE BANNER =====
  const banner = document.getElementById('offlineBanner');
  const bannerText = document.getElementById('offlineBannerText');

  function showOfflineBanner() {
    banner.classList.remove('online');
    bannerText.textContent = '📵 You\'re offline — map tiles served from cache, routing is approximate';
    banner.classList.add('show');
  }

  function showOnlineBanner() {
    banner.classList.add('online');
    bannerText.textContent = '✅ Back online — full routing and live map tiles restored';
    banner.classList.add('show');
    // Auto-dismiss after 3 s
    setTimeout(() => banner.classList.remove('show'), 3000);
    // Flush any records that failed to save while offline
    if (typeof flushPendingSync === 'function') flushPendingSync();
    // If there's an active offline route, silently re-fetch the real route
    if (activeRouteFarmerId !== null) {
      const fid = activeRouteFarmerId;
      activeRouteFarmerId = null; // reset so getRoute runs fresh
      getRouteToFarmer(fid);
    }
  }

  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online', showOnlineBanner);

  // Show banner immediately if already offline on page load
  if (!navigator.onLine) showOfflineBanner();
}

