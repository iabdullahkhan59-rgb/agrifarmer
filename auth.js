// ============================================================
// AgriTrack — Authentication Module
// Uses Supabase Auth REST API directly (no JS client needed)
// ============================================================

const AUTH_URL = SUPABASE_URL + '/auth/v1';
const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY
};

// ===== AUTH STATE =====
let currentUser = null;
let authToken   = null;

// ===== HELPERS =====
function authFetch(path, method, body) {
  const opts = {
    method,
    headers: { ...AUTH_HEADERS, ...(authToken ? { 'Authorization': 'Bearer ' + authToken } : {}) }
  };
  if (body) opts.body = JSON.stringify(body);

  // 8-second timeout so a slow/unreachable server never hangs the splash
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  opts.signal = controller.signal;

  return fetch(AUTH_URL + path, opts)
    .then(async res => {
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { data: null, error: data };
      return { data, error: null };
    })
    .catch(err => {
      clearTimeout(timer);
      return { data: null, error: { message: err.name === 'AbortError' ? 'Request timed out' : err.message } };
    });
}

function saveSession(session) {
  if (!session) return;
  authToken   = session.access_token;
  currentUser = session.user;
  localStorage.setItem('agritrack_session', JSON.stringify({ token: authToken, user: currentUser }));
}

function clearSession() {
  authToken   = null;
  currentUser = null;
  localStorage.removeItem('agritrack_session');
}

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem('agritrack_session') || 'null');
    if (s && s.token) {
      authToken   = s.token;
      currentUser = s.user;
      return true;
    }
  } catch(e) {}
  return false;
}

// ===== PUBLIC AUTH FUNCTIONS =====

async function signUp(email, password, fullName) {
  const { data, error } = await authFetch('/signup', 'POST', {
    email: email.trim().toLowerCase(),
    password,
    data: { full_name: fullName.trim() }
  });
  if (error) return { error: formatAuthError(error) };
  if (data.session) saveSession(data.session);
  return { data };
}

async function signIn(email, password) {
  const { data, error } = await authFetch('/token?grant_type=password', 'POST', {
    email: email.trim().toLowerCase(),
    password
  });
  if (error) return { error: formatAuthError(error) };
  saveSession(data);
  return { data };
}

async function signOut() {
  if (authToken) {
    await authFetch('/logout', 'POST').catch(() => {});
  }
  clearSession();
}

async function resetPassword(email) {
  const { data, error } = await authFetch('/recover', 'POST', {
    email: email.trim().toLowerCase()
  });
  if (error) return { error: formatAuthError(error) };
  return { data };
}

async function verifySession() {
  if (!authToken) return false;
  const { data, error } = await authFetch('/user', 'GET');
  if (error || !data?.id) {
    clearSession();
    return false;
  }
  currentUser = data;
  return true;
}

function formatAuthError(err) {
  const msg = err?.error_description || err?.msg || err?.message || 'Something went wrong';
  if (msg.includes('Invalid login')) return 'Incorrect email or password.';
  if (msg.includes('Email not confirmed')) return 'Please confirm your email first.';
  if (msg.includes('already registered')) return 'This email is already registered.';
  if (msg.includes('Password should')) return 'Password must be at least 6 characters.';
  if (msg.includes('valid email')) return 'Please enter a valid email address.';
  return msg;
}

// ===== AUTH UI =====

function showAuthScreen(view = 'signin') {
  hideSplash();
  document.getElementById('app').style.display = 'none';
  const screen = document.getElementById('authScreen');
  screen.classList.remove('hidden');
  switchAuthView(view);
}

function hideAuthScreen() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').style.display = 'flex';
}

function switchAuthView(view) {
  document.getElementById('signinView').classList.add('hidden');
  document.getElementById('signupView').classList.add('hidden');
  document.getElementById('resetView').classList.add('hidden');
  document.getElementById(view + 'View').classList.remove('hidden');
  clearAuthErrors();
}

function showAuthError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function clearAuthErrors() {
  document.querySelectorAll('.auth-error').forEach(el => {
    el.textContent = '';
    el.classList.add('hidden');
  });
}

function setAuthLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.original = btn.dataset.original || btn.textContent;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.original;
}

// ===== AUTH EVENT HANDLERS =====

async function handleSignIn(e) {
  e.preventDefault();
  clearAuthErrors();
  const email    = document.getElementById('signinEmail').value.trim();
  const password = document.getElementById('signinPassword').value;
  if (!email || !password) { showAuthError('signinError', 'Please fill in all fields.'); return; }
  setAuthLoading('signinBtn', true);
  const { data, error } = await signIn(email, password);
  setAuthLoading('signinBtn', false);
  if (error) { showAuthError('signinError', error); return; }
  onAuthSuccess();
}

async function handleSignUp(e) {
  e.preventDefault();
  clearAuthErrors();
  const name     = document.getElementById('signupName').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm  = document.getElementById('signupConfirm').value;
  if (!name || !email || !password || !confirm) { showAuthError('signupError', 'Please fill in all fields.'); return; }
  if (password.length < 6) { showAuthError('signupError', 'Password must be at least 6 characters.'); return; }
  if (password !== confirm) { showAuthError('signupError', 'Passwords do not match.'); return; }
  setAuthLoading('signupBtn', true);
  const { data, error } = await signUp(email, password, name);
  setAuthLoading('signupBtn', false);
  if (error) { showAuthError('signupError', error); return; }
  // If email confirmation required
  if (!data?.session) {
    showAuthError('signupError', '');
    document.getElementById('signupSuccess').classList.remove('hidden');
    return;
  }
  onAuthSuccess();
}

async function handleResetPassword(e) {
  e.preventDefault();
  clearAuthErrors();
  const email = document.getElementById('resetEmail').value.trim();
  if (!email) { showAuthError('resetError', 'Please enter your email.'); return; }
  setAuthLoading('resetBtn', true);
  const { data, error } = await resetPassword(email);
  setAuthLoading('resetBtn', false);
  if (error) { showAuthError('resetError', error); return; }
  document.getElementById('resetSuccess').classList.remove('hidden');
}

async function handleSignOut() {
  await signOut();
  // Update sidebar user info
  document.getElementById('sidebarUserName').textContent = '';
  document.getElementById('sidebarUserEmail').textContent = '';
  showAuthScreen('signin');
}

function onAuthSuccess() {
  hideAuthScreen();
  // Update sidebar with user info
  if (currentUser) {
    const name  = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
    const email = currentUser.email;
    document.getElementById('sidebarUserName').textContent  = name;
    document.getElementById('sidebarUserEmail').textContent = email;
  }
  // Load app data, then flush any pending saves from previous offline sessions
  loadFarmers().then(() => {
    renderDashboard();
    if (currentPage === 'farmers') renderFarmersTable(farmers);
    // Retry any records that failed to sync previously
    const pending = getPendingIds();
    if (pending.length) {
      updateSyncIndicator();
      showToast(`📡 Syncing ${pending.length} unsaved record(s)…`, '');
      flushPendingSync();
    }
  });
}

// ===== INIT AUTH =====
async function initAuth() {
  // Hard safety net — splash can never stay visible more than 10 seconds
  const splashGuard = setTimeout(() => {
    hideSplash();
    showAuthScreen('signin');
  }, 10000);

  try {
    const hasSession = loadSession();
    if (hasSession) {
      const valid = await verifySession();
      clearTimeout(splashGuard);
      hideSplash();
      if (valid) { onAuthSuccess(); return; }
    } else {
      clearTimeout(splashGuard);
      hideSplash();
    }
  } catch (e) {
    clearTimeout(splashGuard);
    hideSplash();
  }
  showAuthScreen('signin');
}

function hideSplash() {
  const splash = document.getElementById('loadingSplash');
  if (splash) splash.style.display = 'none';
}

// Toggle password visibility
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁';
  }
}

// ===== BOOT =====
// Called after all scripts load
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
});
