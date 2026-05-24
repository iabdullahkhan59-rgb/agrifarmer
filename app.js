// ============================================================
// AgriTrack - Agricultural Data Management System
// Data stored in db (with localStorage as local cache)
// ============================================================

// ===== SUPABASE CONFIG (using fetch/REST - compatible with publishable key) =====
const SUPABASE_URL = 'https://jnnbtvgobqzdqyafxxvp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpubmJ0dmdvYnF6ZHF5YWZ4eHZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NDA5MzIsImV4cCI6MjA5NTExNjkzMn0.BM16r68FoL3vwRBnenPL4W6rHNKG1MXl0N5kLe4ViFI';
const REST_URL = SUPABASE_URL + '/rest/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Prefer': 'return=representation'
};
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
    { id: 'yara_tropicote',   name: 'YaraLiva Tropicote',         brand: 'Yara International' },
    { id: 'yara_bortrac',     name: 'YaraVita Bortrac',           brand: 'Yara International' },
    { id: 'yara_cropboost',   name: 'YaraVita Crop Boost',        brand: 'Yara International' },
    { id: 'yara_frutrel',     name: 'YaraVita Frutrel',           brand: 'Yara International' },
    { id: 'yara_solatrel',    name: 'YaraVita Solatrel',          brand: 'Yara International' },
    { id: 'yara_amplix',      name: 'Yara Amplix Optitrac (Biostimulant)', brand: 'Yara International' }
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
    full_address: f.fullAddress || null,
    lat: f.lat || null,
    lng: f.lng || null,
    products: f.products || [],
    date: f.date
  };
}

// Map db row ? app farmer object
function rowToFarmer(r) {
  return {
    id: r.id,
    name: r.name,
    contact: r.contact,
    dealer: r.dealer,
    landArea: r.land_area,
    crops: r.crops || [],
    village: r.village || '',
    tehsil: r.tehsil || '',
    district: r.district || '',
    province: r.province || '',
    fullAddress: r.full_address || '',
    lat: r.lat,
    lng: r.lng,
    products: r.products || [],
    date: r.date
  };
}

// ===== SUPABASE REST HELPERS =====
async function sbFetch(path, method, body) {
  try {
    const opts = { method, headers: HEADERS };
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
async function saveFarmer(farmer) {
  localStorage.setItem('agritrack_farmers', JSON.stringify(farmers));
  const row = farmerToRow(farmer);
  console.log('[Supabase] Saving farmer:', row.name);
  const { data, error } = await sbFetch('/farmers?on_conflict=id', 'POST', row);
  if (error) {
    console.error('[Supabase] Save error:', error);
    showToast('Cloud sync failed: ' + (error.message || JSON.stringify(error)), 'error');
  } else {
    console.log('%c[Supabase] Saved OK', 'color:green;font-weight:bold', data);
  }
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
    showToast('Bulk sync failed: ' + (error.message || JSON.stringify(error)), 'error');
  } else {
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
  console.log('[Supabase] Loading farmers...');
  const { data, error } = await sbFetch('/farmers?order=date.desc', 'GET');
  if (error) {
    console.error('[Supabase] Load error:', error);
    try { farmers = JSON.parse(localStorage.getItem('agritrack_farmers') || '[]'); } catch(e) { farmers = []; }
  } else {
    console.log('%c[Supabase] Loaded ' + (data||[]).length + ' farmers', 'color:green;font-weight:bold');
    farmers = (data || []).map(rowToFarmer);
    localStorage.setItem('agritrack_farmers', JSON.stringify(farmers));
  }
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
  if (page === 'farmers') renderFarmersTable(farmers);
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
    attribution: '� OpenStreetMap contributors'
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
    container.innerHTML = products.map(p => `
      <div class="product-row" data-product-id="${p.id}">
        <span class="product-name">${p.name}</span>
        <label>Bags:</label>
        <input type="number" class="prod-bags" data-id="${p.id}" min="0" placeholder="0" />
        <label>Dealer:</label>
        <input type="text" class="prod-dealer" data-id="${p.id}" placeholder="Dealer name" />
      </div>
    `).join('');
  });
}

function getProductData() {
  const data = [];
  document.querySelectorAll('.product-row').forEach(row => {
    const id = row.dataset.productId;
    const bags = parseInt(row.querySelector('.prod-bags').value) || 0;
    const dealer = row.querySelector('.prod-dealer').value.trim();
    if (bags > 0) {
      const prod = ALL_PRODUCTS.find(p => p.id === id);
      data.push({ id, name: prod ? prod.name : id, brand: prod ? prod.brand : '', bags, dealer });
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

// ===== FORM HANDLING =====
function resetForm() {
  document.getElementById('farmerForm').reset();
  document.getElementById('editFarmerId').value = '';
  document.getElementById('submitFormBtn').textContent = '?? Save Farmer';
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
      ?? ${escHtml(crop)}
      <button type="button" onclick="removeCustomCrop(${i})" title="Remove">?</button>
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
    fullAddress: document.getElementById('fullAddress').value.trim(),
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
  const submitBtn = document.getElementById('submitFormBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = '? Saving�';
  await saveFarmer(farmer);
  submitBtn.disabled = false;
  showToast(editId ? 'Farmer record updated!' : 'Farmer saved successfully!', 'success');
  resetForm();
  navigateTo('farmers');
}

// ===== FARMERS TABLE =====
function renderFarmersTable(data) {
  const tbody = document.getElementById('farmersTableBody');
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No farmers found.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map((f, i) => {
    const villageTehsil = [f.village, f.tehsil].filter(Boolean).join(', ') || '�';
    const district = f.district || '�';
    const addrShort = f.fullAddress ? (f.fullAddress.length > 30 ? f.fullAddress.slice(0,30) + '�' : f.fullAddress) : '�';
    const crops = (f.crops || []).map(c => `<span class="badge badge-green">${c}</span>`).join('');
    const date = f.date ? new Date(f.date).toLocaleDateString('en-PK') : '�';
    return `<tr>
      <td>${i + 1}</td>
      <td data-label="Name"><strong>${escHtml(f.name)}</strong></td>
      <td data-label="Contact">${escHtml(f.contact)}</td>
      <td data-label="Village/Tehsil" style="font-size:0.82rem">${escHtml(villageTehsil)}</td>
      <td data-label="District" style="font-size:0.82rem">${escHtml(district)}</td>
      <td data-label="Address" style="font-size:0.8rem;max-width:160px" title="${escHtml(f.fullAddress||'')}">${escHtml(addrShort)}</td>
      <td data-label="Land (Ac)">${f.landArea || '—'}</td>
      <td data-label="Crops">${crops}</td>
      <td data-label="Dealer">${escHtml(f.dealer)}</td>
      <td data-label="Date">${date}</td>
      <td data-label="Actions">
        <div class="action-btns">
          <button class="btn btn-outline btn-sm" onclick="viewFarmer('${f.id}')">👁 View</button>
          <button class="btn btn-outline btn-sm" onclick="editFarmer('${f.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteFarmer('${f.id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function viewFarmer(id) {
  const f = farmers.find(f => f.id === id);
  if (!f) return;
  const loc = (f.lat && f.lng) ? `${f.lat}, ${f.lng}` : 'Not set';
  const crops = (f.crops || []).join(', ') || '�';
  const prodRows = (f.products || []).map(p =>
    `<tr><td>${escHtml(p.name)}</td><td>${escHtml(p.brand)}</td><td>${p.bags}</td><td>${escHtml(p.dealer)}</td></tr>`
  ).join('') || '<tr><td colspan="4" style="text-align:center;color:#999">No products recorded</td></tr>';
  document.getElementById('modalTitle').textContent = f.name;
  document.getElementById('modalBody').innerHTML = `
    <div class="detail-row"><span class="detail-label">Contact:</span><span class="detail-value">${escHtml(f.contact)}</span></div>
    <div class="detail-row"><span class="detail-label">Dealer:</span><span class="detail-value">${escHtml(f.dealer)}</span></div>
    <div class="detail-row"><span class="detail-label">Land Area:</span><span class="detail-value">${f.landArea} Acres</span></div>
    <div class="detail-row"><span class="detail-label">Crops:</span><span class="detail-value">${escHtml(crops)}</span></div>
    <div class="detail-row"><span class="detail-label">Village / Mauza:</span><span class="detail-value">${escHtml(f.village || '�')}</span></div>
    <div class="detail-row"><span class="detail-label">Tehsil:</span><span class="detail-value">${escHtml(f.tehsil || '�')}</span></div>
    <div class="detail-row"><span class="detail-label">District:</span><span class="detail-value">${escHtml(f.district || '�')}</span></div>
    <div class="detail-row"><span class="detail-label">Province:</span><span class="detail-value">${escHtml(f.province || '�')}</span></div>
    <div class="detail-row"><span class="detail-label">Full Address:</span><span class="detail-value">${escHtml(f.fullAddress || '�')}</span></div>
    <div class="detail-row"><span class="detail-label">GPS Location:</span><span class="detail-value">${escHtml(loc)}</span></div>
    <div class="detail-row"><span class="detail-label">Date Added:</span><span class="detail-value">${f.date ? new Date(f.date).toLocaleString('en-PK') : '�'}</span></div>
    <h4 style="margin:16px 0 8px;color:#2e7d32">Fertilizer Usage</h4>
    <table class="fertilizer-table">
      <thead><tr><th>Product</th><th>Brand</th><th>Bags</th><th>Dealer</th></tr></thead>
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
    document.getElementById('fullAddress').value = f.fullAddress || '';
    document.getElementById('latitude').value = f.lat || '';
    document.getElementById('longitude').value = f.lng || '';
    setSelectedCrops(f.crops);
    setProductData(f.products);
    document.getElementById('submitFormBtn').textContent = '?? Update Farmer';
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

// ===== SEARCH =====
function initSearch() {
  document.getElementById('searchInput').addEventListener('input', function() {
    const q = this.value.toLowerCase();
    const filtered = farmers.filter(f =>
      f.name.toLowerCase().includes(q) || f.contact.toLowerCase().includes(q)
    );
    renderFarmersTable(filtered);
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
  return { totalBags, totalDealers: dealers.size, topBrand: topBrand ? topBrand[0] : '�' };
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
        backgroundColor: '#4caf50', borderRadius: 5 }]
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
  const brandColors = ['#ff8f00','#1565c0','#2e7d32','#283593','#c62828','#6a1b9a'];

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
  const cropColors = ['#4caf50','#ff9800','#2196f3','#9c27b0','#f44336','#00bcd4','#8bc34a','#ff5722','#607d8b'];

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
      <div class="ic-icon">?????</div>
      <div class="ic-value">${data.length}</div>
      <div class="ic-label">Farmers in Range</div>
    </div>
    <div class="insight-card">
      <div class="ic-icon">??</div>
      <div class="ic-value">${totalBags}</div>
      <div class="ic-label">Total Bags Sold</div>
    </div>
    <div class="insight-card">
      <div class="ic-icon">??</div>
      <div class="ic-value">${topProd ? topProd[0] : '�'}</div>
      <div class="ic-label">Most Used Product</div>
    </div>
    <div class="insight-card">
      <div class="ic-icon">??</div>
      <div class="ic-value">${topBrand ? topBrand[0] : '�'}</div>
      <div class="ic-label">Top Brand</div>
    </div>
    <div class="insight-card">
      <div class="ic-icon">??</div>
      <div class="ic-value">${topDealer ? topDealer[0] : '�'}</div>
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
      datasets: [{ label: 'Bags', data: pValues, backgroundColor: '#4caf50', borderRadius: 5 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { x: { ticks: { font: { size: 10 } } } } }
  });

  // Brand chart
  const bLabels = Object.keys(brandTotals);
  const bValues = Object.values(brandTotals);
  const bColors = ['#ff8f00','#1565c0','#2e7d32','#283593'];
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
      parsedUploadRows = rows;
      showUploadPreview(rows);
    } catch(err) {
      showToast('Error reading file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function showUploadPreview(rows) {
  const preview = rows.slice(0, 10);
  const headers = Object.keys(rows[0]);
  const tableHtml = `
    <table class="data-table">
      <thead><tr>${headers.map(h => '<th>' + escHtml(h) + '</th>').join('')}</tr></thead>
      <tbody>${preview.map(row =>
        '<tr>' + headers.map(h => '<td>' + escHtml(String(row[h])) + '</td>').join('') + '</tr>'
      ).join('')}</tbody>
    </table>`;
  document.getElementById('previewTableWrapper').innerHTML = tableHtml;
  document.getElementById('uploadPreview').classList.remove('hidden');
  showToast('File loaded: ' + rows.length + ' records found', 'success');
}

async function importUploadedData() {
  if (!parsedUploadRows.length) return;
  let imported = 0;
  parsedUploadRows.forEach(row => {
    // Auto-map common column names (case-insensitive)
    const get = (keys) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/[\s_]/g,'') === k.toLowerCase().replace(/[\s_]/g,''));
        if (found && row[found] !== '') return String(row[found]).trim();
      }
      return '';
    };
    const name = get(['farmername','name','farmer']);
    const contact = get(['contactnumber','contact','phone','mobile','tel']);
    const dealer = get(['dealername','dealer']);
    const landArea = parseFloat(get(['totallandarea','landarea','land','acres'])) || 0;
    const cropsRaw = get(['croppattern','crops','crop']);
    const crops = cropsRaw ? cropsRaw.split(/[,;\/]/).map(c => c.trim()).filter(Boolean) : [];
    const lat = parseFloat(get(['latitude','lat'])) || null;
    const lng = parseFloat(get(['longitude','lng','long'])) || null;
    const village = get(['village','mauza','villagemauza']);
    const tehsil = get(['tehsil']);
    const district = get(['district']);
    const province = get(['province']);
    const fullAddress = get(['fulladdress','address']);
    if (!name) return; // skip rows without a name
    const farmer = {
      id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      name, contact, dealer, landArea, crops,
      village, tehsil, district, province, fullAddress,
      lat, lng,
      products: [],
      date: new Date().toISOString()
    };
    farmers.push(farmer);
    imported++;
  });
  const confirmBtn = document.getElementById('confirmUploadBtn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '? Syncing�';
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
      'Full Address': f.fullAddress || '',
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

  // Form submit
  document.getElementById('farmerForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('resetFormBtn').addEventListener('click', resetForm);

  // Detect location
  document.getElementById('detectLocationBtn').addEventListener('click', detectLocation);

  // Dashboard filter
  document.getElementById('dashboardFilter').addEventListener('change', renderDashboard);

  // Export
  document.getElementById('exportBtn').addEventListener('click', exportToExcel);

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

  // Initial dashboard render (empty state while loading)
  renderDashboard();

  // Now load data from db (async � UI already works above)
  showToast('?? Loading data�');
  await loadFarmers();

  // Re-render dashboard and current page with loaded data
  renderDashboard();
  if (currentPage === 'farmers') renderFarmersTable(farmers);
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

// Haversine formula � returns distance in km between two lat/lng points
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
    attribution: '� OpenStreetMap contributors'
  }).addTo(nearbyMapInstance);

  // Tap on map to set "you are here"
  nearbyMapInstance.on('click', function(e) {
    setNearbyUserLocation(e.latlng.lat, e.latlng.lng, 'map');
  });
}

function setNearbyUserLocation(lat, lng, source) {
  nearbyUserLat = lat;
  nearbyUserLng = lng;

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
      .bindPopup('<strong>?? You are here</strong><br>' + lat.toFixed(5) + ', ' + lng.toFixed(5));
  }
  nearbyUserMarker.openPopup();

  const msg = source === 'gps'
    ? '?? GPS location detected � showing farmers nearby'
    : '?? Location set from map tap � showing farmers nearby';
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
    color: '#2e7d32', fillColor: '#4caf50', fillOpacity: 0.07,
    weight: 2, dashArray: '6 4'
  }).addTo(nearbyMapInstance);

  // Filter farmers that have coordinates
  const withCoords = farmers.filter(f => f.lat && f.lng);
  if (!withCoords.length) {
    setNearbyStatus('?? No farmers have location data saved yet. Add coordinates when registering farmers.', 'none');
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
        background:${isNear ? '#2e7d32' : '#9e9e9e'};
        border:2.5px solid #fff;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    const crops = (f.crops || []).join(', ') || '�';
    const totalBags = (f.products || []).reduce((s, p) => s + (p.bags || 0), 0);
    const addrLine = [f.village, f.tehsil, f.district].filter(Boolean).join(', ') || (f.fullAddress || '');
    const popup = `
      <div style="min-width:160px">
        <strong style="font-size:0.95rem">????? ${escHtml(f.name)}</strong><br>
        <span style="color:#555;font-size:0.82rem">?? ${escHtml(f.contact)}</span><br>
        ${addrLine ? `<span style="color:#555;font-size:0.82rem">?? ${escHtml(addrLine)}</span><br>` : ''}
        <span style="color:#555;font-size:0.82rem">?? ${escHtml(crops)}</span><br>
        <span style="color:#555;font-size:0.82rem">?? ${totalBags} bags total</span><br>
        <span style="color:${isNear ? '#2e7d32' : '#9e9e9e'};font-weight:600;font-size:0.85rem">
          ?? ${f.distKm.toFixed(2)} km away
        </span>
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
    setNearbyStatus(`? Found ${nearby.length} farmer${nearby.length > 1 ? 's' : ''} within ${radius} km`, 'found');
  } else {
    setNearbyStatus(`?? No farmers found within ${radius} km. Try increasing the radius.`, 'none');
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
    const crops = (f.crops || []).slice(0, 2).join(', ') + ((f.crops || []).length > 2 ? '�' : '');
    const totalBags = (f.products || []).reduce((s, p) => s + (p.bags || 0), 0);
    const addrShort = [f.village, f.district].filter(Boolean).join(', ') || f.fullAddress || '';
    const distDisplay = f.distKm < 1
      ? (f.distKm * 1000).toFixed(0) + ' m'
      : f.distKm.toFixed(2) + ' km';
    return `
      <div class="nearby-item" onclick="nearbyFlyTo('${f.id}')">
        <div class="nearby-rank ${rankClass}">${i + 1}</div>
        <div class="nearby-info">
          <div class="nearby-name">????? ${escHtml(f.name)}</div>
          <div class="nearby-meta">
            ?? ${escHtml(f.contact)} &nbsp;�&nbsp;
            ${addrShort ? `?? ${escHtml(addrShort)} &nbsp;�&nbsp;` : ''}
            ?? ${escHtml(crops) || '�'} &nbsp;�&nbsp;
            ?? ${totalBags} bags &nbsp;�&nbsp;
            ?? ${escHtml(f.dealer)}
          </div>
        </div>
        <div class="nearby-dist">
          <span class="nearby-dist-value">${distDisplay}</span>
          <span class="nearby-dist-label">away</span>
        </div>
        <button class="nearby-action-btn" onclick="event.stopPropagation(); viewFarmer('${f.id}')">?? View</button>
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
  setNearbyStatus('?? Detecting your GPS location�', 'info');
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

