/* ── Theme (dark default) ──────────────────────────────────────────── */
(function () {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') document.documentElement.classList.add('light');
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

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
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
  updateThemeIcon();
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  const toggle   = document.getElementById('menu-toggle');
  const navLinks = document.getElementById('nav-links');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('.nav-link').forEach(l =>
      l.addEventListener('click', () => navLinks.classList.remove('open'))
    );
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
