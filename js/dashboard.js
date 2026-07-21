/* dashboard.js */
let allCategories = [];
let activeMonthKey = '';
const txPager = { page: 1, size: 10 };

function getNowParts() {
  if (window.AppTime && typeof window.AppTime.getISTNowParts === 'function') return window.AppTime.getISTNowParts();
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function init() {
  populateYears();
  setDefaultFilters();
  applyFiltersFromQuery();
  activeMonthKey = getCurrentMonthKey();
  loadCategories();
  loadAll();
  setupMonthAutoShift();
}

function populateYears() {
  const sel = document.getElementById('f-year');
  const now = getNowParts().year;
  sel.innerHTML = '<option value="">All Years</option>';
  for (let y = now + 1; y >= now - 5; y--) {
    sel.innerHTML += `<option value="${y}" ${y === now ? 'selected' : ''}>${y}</option>`;
  }
}

function setDefaultFilters() {
  const now = getNowParts();
  document.getElementById('f-year').value = String(now.year);
  document.getElementById('f-month').value = String(now.month);
  document.getElementById('f-from').value = '';
  document.getElementById('f-to').value = '';
}

function applyFiltersFromQuery() {
  const params = new URLSearchParams(window.location.search || '');
  const y = params.get('year');
  const m = params.get('month');
  const openSummary = params.get('openSummary');
  if (y && /^\d{4}$/.test(y)) {
    const yearSel = document.getElementById('f-year');
    const has = Array.from(yearSel.options).some(o => o.value === y);
    if (!has) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearSel.appendChild(opt);
    }
    yearSel.value = y;
  }
  if (m && /^(?:[1-9]|1[0-2])$/.test(m)) {
    document.getElementById('f-month').value = String(Number(m));
  }
  if (openSummary === '1' || openSummary === 'true') {
    const panel = document.getElementById('summary-panel');
    const btn = document.getElementById('btn-toggle-summary');
    panel.classList.remove('hidden');
    btn.classList.add('open');
  }
}

function getCurrentMonthKey() {
  const now = getNowParts();
  return `${now.year}-${now.month}`;
}

function applyCurrentMonthFilters() {
  setDefaultFilters();
}

function setupMonthAutoShift() {
  const syncIfMonthChanged = () => {
    const current = getCurrentMonthKey();
    if (current === activeMonthKey) return;
    activeMonthKey = current;
    applyCurrentMonthFilters();
    loadAll();
    showToast('Dashboard auto-switched to current month', 'info');
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    syncIfMonthChanged();
  });

  setInterval(syncIfMonthChanged, 600000);
}

function loadCategories() {
  allCategories = DB.getAllCategories();
  const opt = allCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('f-category').innerHTML = '<option value="">All Categories</option>' + opt;
  document.getElementById('edit-cat').innerHTML = opt;
}

function getOthersCategoryId() {
  const exact = allCategories.find(c => String(c.name || '').trim().toLowerCase() === 'others');
  if (exact) return String(exact.id);
  const partial = allCategories.find(c => String(c.name || '').trim().toLowerCase().startsWith('other'));
  return partial ? String(partial.id) : '';
}

function syncEditCategoryForType() {
  const type = document.getElementById('edit-type').value;
  if (type !== 'credit') return;
  const othersId = getOthersCategoryId();
  if (othersId) document.getElementById('edit-cat').value = othersId;
}

function getFilters() {
  return {
    year:     document.getElementById('f-year').value,
    month:    document.getElementById('f-month').value,
    from:     document.getElementById('f-from').value,
    to:       document.getElementById('f-to').value,
    category: document.getElementById('f-category').value,
    search:   document.getElementById('f-search').value.trim()
  };
}

function loadAll() {
  const filters = getFilters();
  renderCashPosition(DB.getCashPosition(filters));
  renderSummary(DB.getSummary(filters));
  renderTable(DB.getExpenditures(filters));
}

function renderCashPosition(snapshot) {
  const grid = document.getElementById('cash-position-grid');
  const isPositive = snapshot.current_cash >= 0;
  const currentClass = isPositive ? 'ok' : 'over';
  const periodClass = snapshot.period_net >= 0 ? 'ok' : 'over';
  grid.innerHTML = `
    <div class="cash-metric ${currentClass}">
      <span class="cash-metric-label">Current Cash (as of ${formatDate(snapshot.as_of_date)})</span>
      <strong class="cash-metric-value">₹${formatINR(snapshot.current_cash)}</strong>
      <span class="cash-metric-sub">Opening ₹${formatINR(snapshot.opening_cash)} from ${formatDate(snapshot.opening_effective_date)}</span>
    </div>
    <div class="cash-metric">
      <span class="cash-metric-label">Income to Date</span>
      <strong class="cash-metric-value">₹${formatINR(snapshot.total_income_to_date)}</strong>
    </div>
    <div class="cash-metric">
      <span class="cash-metric-label">Expenses to Date</span>
      <strong class="cash-metric-value">₹${formatINR(snapshot.total_expense_to_date)}</strong>
    </div>
    <div class="cash-metric ${periodClass}">
      <span class="cash-metric-label">Net Change (Current Filter)</span>
      <strong class="cash-metric-value">${snapshot.period_net >= 0 ? '+' : '-'}₹${formatINR(Math.abs(snapshot.period_net))}</strong>
      <span class="cash-metric-sub">Income ₹${formatINR(snapshot.period_income)} · Expense ₹${formatINR(snapshot.period_expense)}</span>
    </div>`;
}

/* ── Summary cards ──────────────────────────────────────────────────── */
function renderSummary(rows) {
  const grid      = document.getElementById('summary-grid');
  const filters   = getFilters();
  const goal      = DB.getGeneralGoal(filters);
  const goalLabel = DB.getGoalScopeLabel(filters);
  const withSpend = rows.filter(r => r.total > 0);
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  let goalHtml = '';
  if (goal) {
    const pct       = Math.min(150, (grandTotal / goal) * 100);
    const fillClass = pct > 95 ? 'over' : pct >= 60 ? 'warn' : 'ok';
    const dotColor  = pct > 95 ? 'var(--danger)' : pct >= 60 ? 'var(--warning)' : 'var(--success)';
    const subText   = pct >= 100
      ? `Over by ₹${formatINR(grandTotal - goal)}`
      : `${Math.round((grandTotal / goal) * 100)}% of goal used`;
    goalHtml = `
      <div class="summary-line goal-line ${fillClass}">
        <div class="sl-main">
          <div class="sl-label"><span class="sl-dot" style="background:${dotColor}"></span>Overall Goal (${goalLabel})</div>
          <div class="sl-amount">₹${formatINR(grandTotal)} / ₹${formatINR(goal, 0)}</div>
        </div>
        <div class="sl-sub ${pct > 95 ? 'warn' : ''}">${subText}</div>
        <div class="progress-bar compact"><div class="progress-fill ${fillClass}" style="width:${Math.min(100, pct)}%"></div></div>
      </div>`;
  }

  if (!withSpend.length && grandTotal === 0 && !goal) {
    grid.innerHTML = `<div class="summary-line"><div class="sl-main"><div class="sl-label">No summary yet</div></div><div class="sl-sub">No transactions in this period</div></div>`;
    return;
  }

  const limitCards = [];
  const noLimitRows = [];

  withSpend.forEach(row => {
    if (row.monthly_limit) {
      let statusClass = '', progressHtml = '', dotColor = 'var(--text-3)', subText = '';
      const pct       = Math.min(150, (row.total / row.monthly_limit) * 100);
      statusClass     = pct > 95 ? 'over' : pct >= 60 ? 'warn' : 'ok';
      dotColor        = pct > 95 ? 'var(--danger)' : pct >= 60 ? 'var(--warning)' : 'var(--success)';
      subText         = pct >= 100
        ? `Over by ₹${formatINR(row.total - row.monthly_limit)}`
        : `Limit ₹${formatINR(row.monthly_limit, 0)} · ${Math.round((row.total / row.monthly_limit) * 100)}%`;
      progressHtml = `
        <div class="sl-sub ${pct > 95 ? 'warn' : ''}">${subText}</div>
        <div class="progress-bar compact"><div class="progress-fill ${statusClass}" style="width:${Math.min(100, pct)}%"></div></div>`;
      limitCards.push(`
      <div class="summary-line ${statusClass}">
        <div class="sl-main">
          <div class="sl-label"><span class="sl-dot" style="background:${dotColor}"></span>${row.category_name}</div>
          <div class="sl-amount">₹${formatINR(row.total)}</div>
        </div>
        ${progressHtml}
      </div>`);
    } else {
      noLimitRows.push(`
        <div class="sl-value-row">
          <span class="sl-value-name">${row.category_name}</span>
          <span class="sl-value-amt">₹${formatINR(row.total)}</span>
        </div>`);
    }
  });

  const noLimitBlock = noLimitRows.length
    ? `
      <div class="summary-line no-limit-bucket">
        <div class="sl-main">
          <div class="sl-label"><span class="sl-dot" style="background:var(--text-3)"></span>Other Categories</div>
        </div>
        <div class="sl-values">${noLimitRows.join('')}</div>
      </div>`
    : '';

  const limitBlock = limitCards.length
    ? `<div class="limit-grid">${limitCards.join('')}</div>`
    : '';

  grid.innerHTML = goalHtml + limitBlock + noLimitBlock;
}

/* ── Transactions table ─────────────────────────────────────────────── */
function renderTable(rows) {
  const tbody = document.getElementById('exp-tbody');
  const totalDebitEl = document.getElementById('exp-total-debit');
  const totalCreditEl = document.getElementById('exp-total-credit');
  const countEl = document.getElementById('exp-count');
  const pagerEl = document.getElementById('exp-pager');
  const pages = Math.max(1, Math.ceil(rows.length / txPager.size));
  txPager.page = Math.min(Math.max(1, txPager.page), pages);
  const start = (txPager.page - 1) * txPager.size;
  const pageRows = rows.slice(start, start + txPager.size);
  countEl.textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty"><div class="empty-icon">🧾</div><div class="empty-text">No transactions found for this filter</div></div></td></tr>`;
    totalDebitEl.textContent = '₹0.00';
    totalCreditEl.textContent = '₹0.00';
    pagerEl.innerHTML = '';
    return;
  }

  const totalDebit = rows.filter(r => (r.type || 'debit') === 'debit').reduce((s, r) => s + r.amount, 0);
  const totalCredit = rows.filter(r => (r.type || 'debit') === 'credit').reduce((s, r) => s + r.amount, 0);
  tbody.innerHTML = pageRows.map(r => `
    <tr class="tx-row ${(r.type || 'debit') === 'credit' ? 'tx-row-credit' : ''}" onclick="toggleTxRow(this)" data-id="${r.id}">
      <td class="tx-date">${formatDate(r.date)}</td>
      <td class="tx-cat">${(r.type || 'debit') === 'credit'
        ? '<span class="badge badge-credit">Credit</span>'
        : `<span class="badge badge-cat" style="--cat:${r.category_color || '#7c6af7'}">${r.category_name}</span>`}
      </td>
      <td class="tx-amt amount-col">₹${formatINR(r.amount)}</td>
    </tr>
    <tr class="tx-expand" id="txe-${r.id}">
      <td colspan="3">
        <div class="tx-expand-inner">
          <span class="tx-notes">${r.notes ? `📝 ${r.notes}` : '<span style="color:var(--text-3)">No notes</span>'}</span>
          <div class="btn-group">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEdit(${r.id})">Edit</button>
            <button class="btn btn-danger-ghost btn-sm" onclick="event.stopPropagation();deleteEntry(${r.id})">Delete</button>
          </div>
        </div>
      </td>
    </tr>`).join('');
  totalDebitEl.textContent = '₹' + formatINR(totalDebit);
  totalCreditEl.textContent = '₹' + formatINR(totalCredit);
  const from = start + 1;
  const to = Math.min(rows.length, start + txPager.size);
  pagerEl.innerHTML = `
    <div class="pager-bar">
      <div class="pager-top">
        <div class="pager-meta">Showing ${from}-${to} of ${rows.length}</div>
        <div class="pager-rows">
          <label>rows</label>
          <select id="exp-pager-size">
            ${[5, 10, 20, 50].map(n => `<option value="${n}" ${n === txPager.size ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="pager-nav">
        <button class="btn btn-ghost btn-sm" id="exp-pager-first" ${txPager.page <= 1 ? 'disabled' : ''} title="First page">«</button>
        <button class="btn btn-ghost btn-sm" id="exp-pager-prev" ${txPager.page <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="pager-page">${txPager.page}/${pages}</span>
        <button class="btn btn-ghost btn-sm" id="exp-pager-next" ${txPager.page >= pages ? 'disabled' : ''}>Next</button>
        <button class="btn btn-ghost btn-sm" id="exp-pager-last" ${txPager.page >= pages ? 'disabled' : ''} title="Last page">»</button>
      </div>
    </div>`;
  document.getElementById('exp-pager-size').addEventListener('change', e => {
    txPager.size = Number(e.target.value) || 10;
    txPager.page = 1;
    loadAll();
  });
  document.getElementById('exp-pager-first').addEventListener('click', () => {
    if (txPager.page <= 1) return;
    txPager.page = 1;
    loadAll();
  });
  document.getElementById('exp-pager-prev').addEventListener('click', () => {
    if (txPager.page <= 1) return;
    txPager.page -= 1;
    loadAll();
  });
  document.getElementById('exp-pager-next').addEventListener('click', () => {
    if (txPager.page >= pages) return;
    txPager.page += 1;
    loadAll();
  });
  document.getElementById('exp-pager-last').addEventListener('click', () => {
    if (txPager.page >= pages) return;
    txPager.page = pages;
    loadAll();
  });
}

/* ── Row expand/collapse ─────────────────────────────────────────────── */
function toggleTxRow(row) {
  const id     = row.dataset.id;
  const detail = document.getElementById('txe-' + id);
  const isOpen = detail.classList.toggle('open');
  row.classList.toggle('tx-row-open', isOpen);
}

/* ── Delete ─────────────────────────────────────────────────────────── */
function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  try {
    DB.deleteExpenditure(id);
    showToast('Entry deleted');
    loadAll();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ── Edit modal ─────────────────────────────────────────────────────── */
function openModal()  { document.getElementById('edit-modal').classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeModal() { document.getElementById('edit-modal').classList.remove('open'); document.body.style.overflow = ''; }

function openEdit(id) {
  const entry = DB.getExpenditureById(id);
  if (!entry) { showToast('Entry not found', 'error'); return; }
  document.getElementById('edit-id').value     = entry.id;
  document.getElementById('edit-date').value   = entry.date;
  document.getElementById('edit-cat').value    = entry.category_id;
  document.getElementById('edit-type').value   = entry.type || 'debit';
  syncEditCategoryForType();
  document.getElementById('edit-amount').value = parseFloat(entry.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  document.getElementById('edit-notes').value  = entry.notes || '';
  openModal();
}

document.getElementById('edit-form').addEventListener('submit', e => {
  e.preventDefault();
  const amt   = getRawAmount(document.getElementById('edit-amount'));
  const errEl = document.getElementById('edit-amt-err');
  if (amt < 1) { errEl.classList.add('visible'); return; }
  errEl.classList.remove('visible');
  try {
    DB.updateExpenditure(document.getElementById('edit-id').value, {
      date:        document.getElementById('edit-date').value,
      category_id: document.getElementById('edit-cat').value,
      type:        document.getElementById('edit-type').value,
      amount:      amt,
      notes:       document.getElementById('edit-notes').value
    });
    closeModal();
    showToast('Entry updated ✅');
    loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);
document.getElementById('edit-type').addEventListener('change', syncEditCategoryForType);
setupAmountInput(document.getElementById('edit-amount'));

/* ── Summary toggle ─────────────────────────────────────────────────── */
document.getElementById('btn-toggle-summary').addEventListener('click', () => {
  const panel = document.getElementById('summary-panel');
  const btn   = document.getElementById('btn-toggle-summary');
  const isHidden = panel.classList.toggle('hidden');
  btn.classList.toggle('open', !isHidden);
});

/* ── Filter toggle ──────────────────────────────────────────────────── */
document.getElementById('btn-toggle-filters').addEventListener('click', () => {
  const bar = document.getElementById('filter-bar');
  const btn = document.getElementById('btn-toggle-filters');
  const isHidden = bar.classList.toggle('hidden');
  btn.textContent = isHidden ? 'Filters' : 'Hide Filters';
});

/* ── Filter controls ────────────────────────────────────────────────── */
document.getElementById('btn-apply').addEventListener('click', () => {
  txPager.page = 1;
  loadAll();
});
document.getElementById('btn-clear').addEventListener('click', () => {
  document.getElementById('f-from').value = '';
  document.getElementById('f-to').value   = '';
  document.getElementById('f-category').value = '';
  document.getElementById('f-search').value = '';
  populateYears();
  setDefaultFilters();
  activeMonthKey = getCurrentMonthKey();
  txPager.page = 1;
  loadAll();
});

let searchDebounceId = null;
document.getElementById('f-search').addEventListener('input', () => {
  clearTimeout(searchDebounceId);
  searchDebounceId = setTimeout(() => {
    txPager.page = 1;
    loadAll();
  }, 180);
});
document.getElementById('f-search').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(searchDebounceId);
  txPager.page = 1;
  loadAll();
});

/* ── Excel export ───────────────────────────────────────────────────── */
document.getElementById('btn-export').addEventListener('click', () => {
  try {
    DB.exportToExcel();
    showToast('Exported finance.xlsx ✅');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  }
});

/* ── Excel import ───────────────────────────────────────────────────── */
document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  DB.importFromExcel(file, err => {
    if (err) {
      showToast('Import failed: ' + err.message, 'error');
    } else {
      showToast('Data imported ✅');
      loadCategories();
      loadAll();
    }
    e.target.value = '';
  });
});

init();
