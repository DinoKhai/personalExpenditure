/* ── Theme (dark default) ──────────────────────────────────────────── */
(function () {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') document.documentElement.classList.add('light');
  const perfSaved = localStorage.getItem('perf_mode_v1');
  const prefersReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lowPowerDevice = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4;
  if (perfSaved === 'on' || (perfSaved !== 'off' && (prefersReduced || lowPowerDevice))) {
    document.documentElement.classList.add('perf-mode');
  }
})();

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isLight = document.documentElement.classList.contains('light');
  btn.textContent = isLight ? '🌙' : '☀️';
  btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
}

function isPerformanceMode() {
  const perfSaved = localStorage.getItem('perf_mode_v1');
  if (perfSaved === 'on') return true;
  if (perfSaved === 'off') return false;
  const prefersReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lowPowerDevice = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4;
  return prefersReduced || lowPowerDevice;
}

function updatePerfIcon() {
  const btn = document.getElementById('perf-toggle');
  if (!btn) return;
  const on = isPerformanceMode();
  btn.textContent = on ? '⚡' : '⚪';
  btn.title = on ? 'Performance mode: On' : 'Performance mode: Off';
}

function applyPerformanceMode(on) {
  document.documentElement.classList.toggle('perf-mode', on);
  document.body.classList.toggle('perf-mode', on);
  updatePerfIcon();
}

function togglePerformanceMode() {
  const next = !isPerformanceMode();
  localStorage.setItem('perf_mode_v1', next ? 'on' : 'off');
  applyPerformanceMode(next);
}

function setupFileLinkedBadge() {
  const navRight = document.querySelector('.nav-right');
  if (!navRight) return;
  const badge = document.createElement('span');
  badge.id = 'file-linked-badge';
  badge.className = 'file-linked-badge';
  badge.textContent = 'File Linked';
  navRight.insertBefore(badge, navRight.firstChild);

  const updateBadge = () => {
    if (!window.DB || typeof window.DB.getPersistentExcelStatus !== 'function') {
      badge.style.display = 'none';
      return;
    }
    const status = window.DB.getPersistentExcelStatus();
    const isOn = !!status.linked;
    badge.style.display = isOn ? 'inline-flex' : 'none';
  };

  updateBadge();
  window.addEventListener('fintrack:persistent-excel-status', updateBadge);
}

/* ── INR formatting ─────────────────────────────────────────────────── */
function formatINR(amount, decimals = 2) {
  const n = parseFloat(amount) || 0;
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function getISTNowParts() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const out = {};
  formatter.formatToParts(new Date()).forEach(part => {
    if (part.type !== 'literal') out[part.type] = part.value;
  });
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second)
  };
}

function todayISO() {
  const now = getISTNowParts();
  const y = now.year;
  const m = String(now.month).padStart(2, '0');
  const day = String(now.day).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ── Amount input: live INR comma formatting ────────────────────────── */
function setupAmountInput(el) {
  el.addEventListener('input', function () {
    const raw = this.value.replace(/[^0-9.]/g, '');
    if (!raw) { this.value = ''; return; }
    const parts = raw.split('.');
    const intPart = parseInt(parts[0] || '0', 10);
    const decPart = parts.length > 1 ? '.' + parts[1].substring(0, 2) : '';
    this.value = intPart.toLocaleString('en-IN') + decPart;
  });
  el.addEventListener('paste', function (e) {
    e.preventDefault();
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    const clean = txt.replace(/[^0-9.]/g, '');
    if (!clean) return;
    const n = parseFloat(clean);
    this.value = isNaN(n) ? '' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  });
}

function getRawAmount(el) {
  return parseFloat(el.value.replace(/[^0-9.]/g, '')) || 0;
}

/* ── Toast notifications ────────────────────────────────────────────── */
(function () {
  const container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  window._toastContainer = container;
})();

function showToast(message, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  window._toastContainer.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

/* ── Navigation ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  applyPerformanceMode(isPerformanceMode());
  updateThemeIcon();
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const perfBtn = document.getElementById('perf-toggle');
  if (perfBtn) perfBtn.addEventListener('click', togglePerformanceMode);
  setupFileLinkedBadge();

  const toggle   = document.getElementById('menu-toggle');
  const navLinks = document.getElementById('nav-links');
  if (toggle && navLinks) {
    const NAV_STATE_KEY = 'nav_expanded_v1';
    const applyNavState = (isOpen) => {
      navLinks.classList.toggle('open', isOpen);
      toggle.classList.toggle('is-open', isOpen);
      document.body.classList.toggle('nav-expanded', isOpen);
      toggle.setAttribute('aria-label', isOpen ? 'Collapse navigation' : 'Expand navigation');
      localStorage.setItem(NAV_STATE_KEY, isOpen ? '1' : '0');
    };

    const saved = localStorage.getItem(NAV_STATE_KEY);
    applyNavState(saved === '1');
    requestAnimationFrame(() => document.body.classList.add('nav-ready'));

    toggle.addEventListener('click', () => {
      const isOpen = !navLinks.classList.contains('open');
      applyNavState(isOpen);
    });

    document.addEventListener('click', e => {
      if (!navLinks.classList.contains('open')) return;
      if (navLinks.contains(e.target) || toggle.contains(e.target)) return;
      applyNavState(false);
    });
  }

  // Active link — use just the filename so it works on GitHub Pages sub-paths
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = (link.getAttribute('href') || '').split('/').pop();
    const match = (href === '' || href === 'index.html')
      ? (page === '' || page === 'index.html')
      : href === page;
    if (match) link.classList.add('active');
  });
});

window.AppPrefs = {
  isPerformanceMode
};

window.AppTime = {
  getISTNowParts
};
