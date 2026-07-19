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

  const tbody = document.getElementById('limits-tbody');
  if (!cats.length) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty"><div class="empty-icon">💰</div><div class="empty-text">Add categories first</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = cats.map(c => {
    const existing = limitMap[c.id] !== undefined
      ? parseFloat(limitMap[c.id]).toLocaleString('en-IN', { maximumFractionDigits: 2 })
      : '';
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

  document.querySelectorAll('.limit-input').forEach(inp => setupAmountInput(inp));
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
  const inputs = document.querySelectorAll('.limit-input');
  const btn    = document.getElementById('save-limits-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  let saved = 0, skipped = 0;
  for (const inp of inputs) {
    const raw   = inp.value.replace(/[^0-9.]/g, '');
    const catId = inp.dataset.cat;
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

function populateGoalYears() {
  const now = new Date();
  const currentYear = now.getFullYear();
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

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3"><div class="empty"><div class="empty-icon">🎯</div><div class="empty-text">No goals found</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    const active = selectedGoalKey === key ? ' class="goal-row active"' : ' class="goal-row"';
    return `
    <tr${active} data-year="${r.year}" data-month="${r.month}">
      <td>${r.year}</td>
      <td>${MONTHS[r.month - 1]}</td>
      <td class="amount-col">₹${formatINR(r.amount)}</td>
    </tr>`;
  }).join('');
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

/* ── Init ──────────────────────────────────────────────────────────── */
loadCategories();
loadLimits();
populateGoalYears();
document.getElementById('goal-month').value = String(new Date().getMonth() + 1);
loadGoalForSelection();
renderGoalList();
setupGoalInput();
