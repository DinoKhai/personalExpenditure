/* admin.js – Category manager + spending limits */

/* ── Tabs ──────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn, .tab-panel').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

/* ── Categories ──────────────────────────────────────────────────────── */
let categories = [];
const pagerState = {
  goals: { page: 1, size: 10 },
  sourceLogs: { page: 1, size: 10 }
};
let limitDrafts = {};

function escText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paginateRows(rows, key) {
  const state = pagerState[key];
  const size = Math.max(1, Number(state.size) || 10);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Number(state.page) || 1), pages);
  state.page = page;
  const start = (page - 1) * size;
  return {
    pageRows: rows.slice(start, start + size),
    total,
    page,
    pages,
    size,
    start
  };
}

function renderPager(containerId, key, total, onChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const state = pagerState[key];
  const size = Math.max(1, Number(state.size) || 10);
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Number(state.page) || 1), pages);
  state.page = page;
  const from = total ? ((page - 1) * size) + 1 : 0;
  const to = total ? Math.min(total, page * size) : 0;
  el.innerHTML = `
    <div class="pager-bar">
      <div class="pager-top">
        <div class="pager-meta">Showing ${from}-${to} of ${total}</div>
        <div class="pager-rows">
          <label>rows</label>
          <select data-pager-size="${key}">
            ${[5, 10, 20, 50].map(n => `<option value="${n}" ${n === size ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="pager-nav">
        <button class="btn btn-ghost btn-sm" data-pager-first="${key}" ${page <= 1 ? 'disabled' : ''} title="First page">«</button>
        <button class="btn btn-ghost btn-sm" data-pager-prev="${key}" ${page <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="pager-page">${page}/${pages}</span>
        <button class="btn btn-ghost btn-sm" data-pager-next="${key}" ${page >= pages ? 'disabled' : ''}>Next</button>
        <button class="btn btn-ghost btn-sm" data-pager-last="${key}" ${page >= pages ? 'disabled' : ''} title="Last page">»</button>
      </div>
    </div>`;

  const sizeSel = el.querySelector(`[data-pager-size="${key}"]`);
  const firstBtn = el.querySelector(`[data-pager-first="${key}"]`);
  const prevBtn = el.querySelector(`[data-pager-prev="${key}"]`);
  const nextBtn = el.querySelector(`[data-pager-next="${key}"]`);
  const lastBtn = el.querySelector(`[data-pager-last="${key}"]`);
  sizeSel.addEventListener('change', () => {
    state.size = Number(sizeSel.value) || 10;
    state.page = 1;
    onChange();
  });
  firstBtn.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page = 1;
    onChange();
  });
  prevBtn.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    onChange();
  });
  nextBtn.addEventListener('click', () => {
    if (state.page >= pages) return;
    state.page += 1;
    onChange();
  });
  lastBtn.addEventListener('click', () => {
    if (state.page >= pages) return;
    state.page = pages;
    onChange();
  });
}

function loadCategories() {
  categories = DB.getAllCategories();
  renderCategories();
}

function renderCategories() {
  const tbody = document.getElementById('cat-tbody');
  if (!categories.length) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty"><div class="empty-icon">🏷️</div><div class="empty-text">No categories yet</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = categories.map((c, i) => `
    <tr>
      <td style="color:var(--text-3);font-size:.8rem">${i + 1}</td>
      <td><span class="cat-swatch" style="--cat:${c.color || '#7c6af7'}"></span><strong>${c.name}</strong></td>
      <td style="text-align:center;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openRename(${c.id},'${escHtml(c.name)}')">Rename</button>
        <button class="btn btn-danger-ghost btn-sm" onclick="deleteCategory(${c.id},'${escHtml(c.name)}')">Delete</button>
      </td>
    </tr>`).join('');
}

function escHtml(s) { return s.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

document.getElementById('add-cat-btn').addEventListener('click', () => {
  const input = document.getElementById('new-cat-name');
  const name  = input.value.trim();
  if (!name) { input.focus(); return; }
  try {
    DB.insertCategory(name);
    input.value = '';
    showToast(`Category "${name}" added ✅`);
    loadCategories();
    loadLimits();
  } catch (e) {
    showToast(e.message, 'error');
  }
});

document.getElementById('new-cat-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-cat-btn').click(); }
});

function deleteCategory(id, name) {
  if (!confirm(`Delete category "${name}"?\n\nNote: categories with existing entries cannot be deleted.`)) return;
  try {
    DB.deleteCategory(id);
    showToast(`Category "${name}" deleted`);
    loadCategories();
    loadLimits();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ── Rename modal ────────────────────────────────────────────────────── */
function openRename(id, name) {
  document.getElementById('rename-id').value        = id;
  document.getElementById('rename-input').value     = name;
  document.getElementById('rename-err').textContent = '';
  document.getElementById('rename-err').classList.remove('visible');
  document.getElementById('rename-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('rename-input').focus(), 100);
}

function closeRename() {
  document.getElementById('rename-modal').classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('rename-close').addEventListener('click', closeRename);
document.getElementById('rename-cancel').addEventListener('click', closeRename);
document.getElementById('rename-backdrop').addEventListener('click', closeRename);

document.getElementById('rename-form').addEventListener('submit', e => {
  e.preventDefault();
  const id   = document.getElementById('rename-id').value;
  const name = document.getElementById('rename-input').value.trim();
  if (!name) return;
  try {
    DB.updateCategory(id, name);
    closeRename();
    showToast(`Renamed to "${name}" ✅`);
    loadCategories();
    loadLimits();
  } catch (e) {
    const errEl = document.getElementById('rename-err');
    errEl.textContent = e.message;
    errEl.classList.add('visible');
  }
});

/* ── Spending Limits ─────────────────────────────────────────────────── */
function loadLimits() {
  const cats   = DB.getAllCategories();
  const limits = DB.getSpendingLimits();
  const limitMap = {};
  limits.forEach(l => { limitMap[l.category_id] = l.monthly_limit; });
  cats.forEach(c => {
    const existing = limitMap[c.id] !== undefined ? parseFloat(limitMap[c.id]).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '';
    if (limitDrafts[c.id] === undefined) limitDrafts[c.id] = existing;
  });

  const tbody = document.getElementById('limits-tbody');
  if (!cats.length) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty"><div class="empty-icon">💰</div><div class="empty-text">Add categories first</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = cats.map(c => {
    const existing = limitDrafts[c.id] !== undefined ? limitDrafts[c.id] : '';
    return `
      <tr>
        <td class="limit-cell-cat"><span class="cat-swatch" style="--cat:${c.color || '#7c6af7'}"></span><strong>${c.name}</strong></td>
        <td>
          <div class="input-prefix limit-input-wrap">
            <span>₹</span>
            <input type="text" class="limit-input" data-cat="${c.id}"
                   value="${existing}" placeholder="No limit"
                   inputmode="decimal" style="font-variant-numeric:tabular-nums">
          </div>
        </td>
        <td class="limit-cell-action">
          ${limitMap[c.id] !== undefined
            ? `<button class="btn btn-danger-ghost btn-sm" onclick="removeLimit(${c.id})">Remove</button>`
            : '<span class="limit-empty">Not set</span>'
          }
        </td>
      </tr>`;
  }).join('');

  document.querySelectorAll('.limit-input').forEach(inp => {
    setupAmountInput(inp);
    inp.addEventListener('input', () => {
      limitDrafts[inp.dataset.cat] = inp.value;
    });
  });
}

function removeLimit(catId) {
  try {
    DB.deleteSpendingLimit(catId);
    showToast('Limit removed');
    loadLimits();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

document.getElementById('save-limits-btn').addEventListener('click', () => {
  const cats = DB.getAllCategories();
  const btn    = document.getElementById('save-limits-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  let saved = 0, skipped = 0;
  for (const c of cats) {
    const catId = String(c.id);
    const raw = String(limitDrafts[catId] || '').replace(/[^0-9.]/g, '');
    if (!raw) { skipped++; continue; }
    const limit = parseFloat(raw);
    if (isNaN(limit) || limit < 0) continue;
    try {
      DB.upsertSpendingLimit(catId, limit);
      saved++;
    } catch (e) {
      showToast(`Error saving limit: ${e.message}`, 'error');
    }
  }

  btn.disabled    = false;
  btn.textContent = 'Save All Limits';
  if (saved > 0) showToast(`${saved} limit(s) saved ✅`);
  else showToast('No changes to save', 'info');
  loadLimits();
});

/* ── Budget Goal ─────────────────────────────────────────────────────── */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
let selectedGoalKey = '';

function getNowParts() {
  if (window.AppTime && typeof window.AppTime.getISTNowParts === 'function') return window.AppTime.getISTNowParts();
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function populateGoalYears() {
  const currentYear = getNowParts().year;
  const years = [];
  for (let y = currentYear + 1; y >= currentYear - 5; y--) years.push(y);

  const goalYear = document.getElementById('goal-year');
  const filterYear = document.getElementById('goal-filter-year');
  goalYear.innerHTML = years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('');
  filterYear.innerHTML = '<option value="">All Years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
}

function loadGoalForSelection() {
  const year = document.getElementById('goal-year').value;
  const month = document.getElementById('goal-month').value;
  const goal = DB.getGeneralGoal({ year, month });
  const inp  = document.getElementById('goal-amount');
  inp.value = goal ? parseFloat(goal).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '';
}

function renderGoalList() {
  const year = document.getElementById('goal-filter-year').value;
  const month = document.getElementById('goal-filter-month').value;
  const rows = DB.getBudgetGoals({ year, month });
  const tbody = document.getElementById('goal-list-tbody');
  const page = paginateRows(rows, 'goals');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty"><div class="empty-icon">🎯</div><div class="empty-text">No goals found</div></div></td></tr>`;
    renderPager('goal-pager', 'goals', 0, renderGoalList);
    return;
  }

  tbody.innerHTML = page.pageRows.map(r => {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    const active = selectedGoalKey === key ? ' class="goal-row active"' : ' class="goal-row"';
    return `
    <tr${active} data-year="${r.year}" data-month="${r.month}">
      <td>${r.year}</td>
      <td>${MONTHS[r.month - 1]}</td>
      <td class="amount-col">₹${formatINR(r.amount)}</td>
    </tr>`;
  }).join('');
  renderPager('goal-pager', 'goals', rows.length, renderGoalList);
}

function setupGoalInput() {
  setupAmountInput(document.getElementById('goal-amount'));
}

document.getElementById('goal-year').addEventListener('change', loadGoalForSelection);
document.getElementById('goal-month').addEventListener('change', loadGoalForSelection);
document.getElementById('goal-filter-year').addEventListener('change', renderGoalList);
document.getElementById('goal-filter-month').addEventListener('change', renderGoalList);
document.getElementById('goal-list-tbody').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-year][data-month]');
  if (!tr) return;
  const year = tr.getAttribute('data-year');
  const month = tr.getAttribute('data-month');
  selectedGoalKey = `${year}-${String(month).padStart(2, '0')}`;

  document.getElementById('goal-year').value = year;
  document.getElementById('goal-month').value = String(Number(month));
  loadGoalForSelection();
  renderGoalList();
});

document.getElementById('save-goal-btn').addEventListener('click', () => {
  const year = document.getElementById('goal-year').value;
  const month = document.getElementById('goal-month').value;
  const inp = document.getElementById('goal-amount');
  const err = document.getElementById('goal-err');
  err.textContent = '';
  err.classList.remove('visible');

  const raw = inp.value.replace(/[^0-9.]/g, '');
  const val = parseFloat(raw);
  if (!raw || isNaN(val) || val < 1) {
    err.textContent = 'Enter a valid amount (≥ ₹1)';
    err.classList.add('visible');
    return;
  }

  try {
    DB.setGeneralGoal(val, year, month);
    selectedGoalKey = `${year}-${String(month).padStart(2, '0')}`;
    showToast(`Budget goal saved for ${MONTHS[Number(month) - 1]} ${year} ✅`);
    loadGoalForSelection();
    renderGoalList();
  } catch (e) {
    showToast(e.message, 'error');
  }
});

document.getElementById('clear-goal-btn').addEventListener('click', () => {
  const year = document.getElementById('goal-year').value;
  const month = document.getElementById('goal-month').value;
  DB.setGeneralGoal(null, year, month);
  selectedGoalKey = '';
  document.getElementById('goal-amount').value = '';
  document.getElementById('goal-err').classList.remove('visible');
  showToast(`Budget goal cleared for ${MONTHS[Number(month) - 1]} ${year}`);
  renderGoalList();
});

/* ── Cash Flow ────────────────────────────────────────────────────────── */
function populateCashflowSelectors() {
  const now = getNowParts();
  const currentYear = now.year;
  const years = [];
  for (let y = currentYear + 1; y >= currentYear - 10; y--) years.push(y);
  const yearSel = document.getElementById('salary-year');
  yearSel.innerHTML = years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('');
  document.getElementById('salary-month').value = String(now.month);
}

function renderPersistentStatus() {
  const status = DB.getPersistentExcelStatus();
  const el = document.getElementById('persistent-status-text');
  const dashboardHint = document.getElementById('persistent-status-hint');
  if (!status.supported) {
    el.textContent = 'Persistent source unsupported in this browser. Use regular import/export.';
    if (dashboardHint) dashboardHint.textContent = '';
    renderPersistentLog();
    return;
  }
  if (!status.linked) {
    const stale = status.file_name ? `Last linked file: ${status.file_name}` : 'Persistent source not connected.';
    el.textContent = stale;
    if (dashboardHint) dashboardHint.textContent = status.file_name
      ? `Reconnect to resume auto-save. Last sync: ${status.last_sync_at || 'N/A'}`
      : '';
    renderPersistentLog();
    return;
  }
  const syncPart = status.syncing ? 'Syncing…' : (status.last_sync_at ? `Last sync: ${status.last_sync_at}` : 'Connected');
  const errPart = status.last_error ? ` · Error: ${status.last_error}` : '';
  el.innerHTML = `<span class="connected-file-label">Connected file: ${escText(status.file_name)}</span> · ${escText(syncPart)}${errPart ? ` · ${escText(errPart.replace(/^ · /, ''))}` : ''}`;
  if (dashboardHint) dashboardHint.textContent = `Location: ${status.location_label || 'Path unavailable in this browser (security restriction)'}`;
  renderPersistentLog();
}

function getPersistentLogFilters() {
  const parseHour = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const c = Math.min(Math.max(1, Math.floor(n)), 24);
    return c - 1;
  };
  const parseMinute = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const c = Math.min(Math.max(0, Math.floor(n)), 60);
    return c === 60 ? 59 : c;
  };
  const fmt2 = n => String(n).padStart(2, '0');
  const fromDate = document.getElementById('persistent-log-from-date').value;
  const fromHour = parseHour(document.getElementById('persistent-log-from-hour').value, 0);
  const fromMinute = parseMinute(document.getElementById('persistent-log-from-minute').value, 0);
  const toDate = document.getElementById('persistent-log-to-date').value;
  const toHour = parseHour(document.getElementById('persistent-log-to-hour').value, 0);
  const toMinute = parseMinute(document.getElementById('persistent-log-to-minute').value, 0);
  const normalizeFrom = fromDate
    ? `${fromDate} ${fmt2(fromHour)}:${fmt2(fromMinute)}:00`
    : '';
  const normalizeTo = toDate
    ? `${toDate} ${fmt2(toHour)}:${fmt2(toMinute)}:59`
    : '';
  return {
    from: normalizeFrom,
    to: normalizeTo,
    search: document.getElementById('persistent-log-search').value.trim()
  };
}

function populateLogTimeDropdowns() {
  const fromHourSel = document.getElementById('persistent-log-from-hour');
  const fromMinuteSel = document.getElementById('persistent-log-from-minute');
  const toHourSel = document.getElementById('persistent-log-to-hour');
  const toMinuteSel = document.getElementById('persistent-log-to-minute');
  if (!fromHourSel || !fromMinuteSel || !toHourSel || !toMinuteSel) return;
  const hourOptions = [];
  for (let h = 1; h <= 24; h++) {
    hourOptions.push(`<option value="${h}">${String(h).padStart(2, '0')}</option>`);
  }
  const minuteOptions = [];
  for (let m = 0; m <= 60; m++) {
    minuteOptions.push(`<option value="${m}">${String(m).padStart(2, '0')}</option>`);
  }
  fromHourSel.insertAdjacentHTML('beforeend', hourOptions.join(''));
  toHourSel.insertAdjacentHTML('beforeend', hourOptions.join(''));
  fromMinuteSel.insertAdjacentHTML('beforeend', minuteOptions.join(''));
  toMinuteSel.insertAdjacentHTML('beforeend', minuteOptions.join(''));
}

function renderPersistentLog() {
  const logEl = document.getElementById('persistent-log');
  if (!logEl) return;
  const filters = getPersistentLogFilters();
  if (filters.from && filters.to && String(filters.from) > String(filters.to)) {
    logEl.innerHTML = '<div class="text-muted text-sm">Invalid filter range: "From" must be before "To".</div>';
    return;
  }
  const lines = DB.getPersistentLogEntries(filters);
  const page = paginateRows(lines, 'sourceLogs');
  const highlightLogMessage = (msg) => {
    const text = escText(msg);
    return text.replace(/reconnect failed|disconnected|disconnect|reconnected|reconnect/ig, (m) => {
      const key = String(m).toLowerCase();
      const negative = key === 'reconnect failed' || key === 'disconnected' || key === 'disconnect';
      return `<span class="${negative ? 'log-key-negative' : 'log-key-positive'}">${m}</span>`;
    });
  };
  if (!lines.length) {
    logEl.innerHTML = '<div class="text-muted text-sm">No matching log entries.</div>';
    renderPager('persistent-log-pager', 'sourceLogs', 0, renderPersistentLog);
    return;
  }
  logEl.innerHTML = `<ul class="source-log-list">${
    page.pageRows.map(row => `<li><span>${row.at}</span><strong>${highlightLogMessage(row.message)}</strong></li>`).join('')
  }</ul>`;
  renderPager('persistent-log-pager', 'sourceLogs', lines.length, renderPersistentLog);
}

function applyPersistentLogFilters() {
  pagerState.sourceLogs.page = 1;
  renderPersistentLog();
}

function resetPersistentLogFilters() {
  document.getElementById('persistent-log-from-date').value = '';
  document.getElementById('persistent-log-from-hour').value = '';
  document.getElementById('persistent-log-from-minute').value = '';
  document.getElementById('persistent-log-to-date').value = '';
  document.getElementById('persistent-log-to-hour').value = '';
  document.getElementById('persistent-log-to-minute').value = '';
  document.getElementById('persistent-log-search').value = '';
  pagerState.sourceLogs.page = 1;
  renderPersistentLog();
}

function clearPersistentLogEntries() {
  if (!confirm('Clear all persistent file activity logs?')) return;
  DB.clearPersistentLogEntries();
  showToast('Logs cleared');
  resetPersistentLogFilters();
}

function loadOpeningCash() {
  const opening = DB.getOpeningCash();
  document.getElementById('cash-opening-date').value = Number(opening.amount || 0) > 0 ? (opening.effective_date || '') : '';
  document.getElementById('cash-opening-amount').value = parseFloat(opening.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function monthLastDay(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function syncSalaryDateToSelection() {
  const year = Number(document.getElementById('salary-year').value);
  const month = Number(document.getElementById('salary-month').value);
  const dateEl = document.getElementById('salary-received-date');
  const current = dateEl.value;
  if (!current || !/^\d{4}-\d{2}-\d{2}$/.test(current)) return;
  const day = Math.min(Number(current.slice(8, 10)), monthLastDay(year, month));
  dateEl.value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function loadSalaryForSelection() {
  const year = Number(document.getElementById('salary-year').value);
  const month = Number(document.getElementById('salary-month').value);
  const rows = DB.getMonthlyIncomes({ year, month });
  const amountEl = document.getElementById('salary-amount');
  const notesEl = document.getElementById('salary-notes');
  const dateEl = document.getElementById('salary-received-date');
  if (!rows.length) {
    amountEl.value = '';
    notesEl.value = '';
    return;
  }
  const row = rows[0];
  amountEl.value = parseFloat(row.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  notesEl.value = row.notes || '';
  dateEl.value = row.received_date;
}

function refreshCashflowPanels() {
  renderPersistentStatus();
  loadOpeningCash();
}

async function handlePersistentOpen() {
  try {
    await DB.connectPersistentExcelFile();
    showToast('Persistent Excel source loaded ✅');
    loadCategories();
    loadLimits();
    loadGoalForSelection();
    renderGoalList();
    refreshCashflowPanels();
    loadSalaryForSelection();
  } catch (e) {
    showToast(e.message, 'error');
    renderPersistentStatus();
  }
}

async function handlePersistentSave() {
  try {
    await DB.syncPersistentExcelNow();
    showToast('Saved to loaded Excel file ✅');
    renderPersistentStatus();
  } catch (e) {
    showToast(e.message, 'error');
    renderPersistentStatus();
  }
}

async function handlePersistentDisconnect() {
  try {
    await DB.disconnectPersistentExcelFile();
    showToast('Persistent Excel source disconnected');
  } catch (e) {
    showToast(e.message, 'error');
  }
  renderPersistentStatus();
}

document.getElementById('save-opening-cash-btn').addEventListener('click', () => {
  const amountEl = document.getElementById('cash-opening-amount');
  const dateEl = document.getElementById('cash-opening-date');
  const err = document.getElementById('cash-opening-err');
  err.textContent = '';
  err.classList.remove('visible');
  const amount = getRawAmount(amountEl);
  if (amount < 0) {
    err.textContent = 'Opening cash cannot be negative';
    err.classList.add('visible');
    return;
  }
  if (!dateEl.value) {
    err.textContent = 'Choose an effective date';
    err.classList.add('visible');
    return;
  }
  try {
    DB.setOpeningCash(amount, dateEl.value);
    showToast('Opening cash saved ✅');
    loadOpeningCash();
  } catch (e) {
    showToast(e.message, 'error');
  }
});

document.getElementById('save-salary-btn').addEventListener('click', () => {
  const yearEl = document.getElementById('salary-year');
  const monthEl = document.getElementById('salary-month');
  const dateEl = document.getElementById('salary-received-date');
  const amountEl = document.getElementById('salary-amount');
  const notesEl = document.getElementById('salary-notes');
  const err = document.getElementById('salary-err');
  err.textContent = '';
  err.classList.remove('visible');

  const amount = getRawAmount(amountEl);
  if (!yearEl.value || !monthEl.value) {
    err.textContent = 'Choose a year and month';
    err.classList.add('visible');
    return;
  }
  if (!dateEl.value) {
    err.textContent = 'Choose salary received date';
    err.classList.add('visible');
    return;
  }
  if (amount < 1) {
    err.textContent = 'Enter a valid amount (≥ ₹1)';
    err.classList.add('visible');
    return;
  }

  try {
    DB.setMonthlyIncome({
      year: yearEl.value,
      month: monthEl.value,
      received_date: dateEl.value,
      amount,
      notes: notesEl.value
    });
    showToast('Monthly salary saved ✅');
    refreshCashflowPanels();
    loadSalaryForSelection();
  } catch (e) {
    showToast(e.message, 'error');
  }
});

document.getElementById('salary-year').addEventListener('change', () => {
  syncSalaryDateToSelection();
  loadSalaryForSelection();
});
document.getElementById('salary-month').addEventListener('change', () => {
  syncSalaryDateToSelection();
  loadSalaryForSelection();
});
document.getElementById('persistent-open-btn').addEventListener('click', handlePersistentOpen);
document.getElementById('persistent-save-btn').addEventListener('click', handlePersistentSave);
document.getElementById('persistent-disconnect-btn').addEventListener('click', handlePersistentDisconnect);
document.getElementById('persistent-log-apply-btn').addEventListener('click', applyPersistentLogFilters);
document.getElementById('persistent-log-reset-btn').addEventListener('click', resetPersistentLogFilters);
document.getElementById('persistent-log-clear-btn').addEventListener('click', clearPersistentLogEntries);
document.getElementById('persistent-log-search').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyPersistentLogFilters();
});
window.addEventListener('fintrack:persistent-excel-status', renderPersistentStatus);

/* ── Init ──────────────────────────────────────────────────────────── */
loadCategories();
loadLimits();
populateGoalYears();
document.getElementById('goal-month').value = String(getNowParts().month);
loadGoalForSelection();
renderGoalList();
setupGoalInput();
populateCashflowSelectors();
setupAmountInput(document.getElementById('cash-opening-amount'));
setupAmountInput(document.getElementById('salary-amount'));
populateLogTimeDropdowns();
resetPersistentLogFilters();
refreshCashflowPanels();
loadSalaryForSelection();
